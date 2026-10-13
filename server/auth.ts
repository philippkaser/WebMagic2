import { createHash } from "node:crypto";
import {
  checkPassword,
  checkUsername,
  isSessionToken,
  PASSWORD_MAX,
  USERNAME_MAX,
  usernameKey,
  type AuthErrorReason,
} from "../src/net/credentials";
import type { AccountRecord, AccountStore } from "./accounts";

/** The ledger: real accounts on top of the guest device tokens.
 *
 *  - **Guests** work exactly as before: `login` with no token mints an
 *    account whose id doubles as its device token; presenting it resumes.
 *  - **Members** have a username (3–16 of A–Z a–z 0–9 _ -, unique ignoring
 *    case) and a password, stored only as an argon2id hash. Registering,
 *    signing in and claiming a guest all answer with a fresh **sign-in
 *    token** (32 random bytes, hex) that the client keeps instead of the
 *    device token. Only its SHA-256 is stored, so a leaked data file holds
 *    no live sessions. Up to MAX_SESSIONS per account (one per device),
 *    each lapsing after SESSION_TTL_MS unused; `logout` revokes one, or all.
 *  - **Claiming** writes credentials onto the guest's own record, so its
 *    progress is simply still there; the old device token stops working.
 *  - **Rate limits**: failures back off exponentially per connection and per
 *    username (in memory), and one hash runs per connection at a time.
 *    Unknown usernames still pay for a hash, so timing doesn't tell which
 *    usernames exist.
 *
 * Pure rules over the AccountStore with injected hasher, clock and
 * randomness — auth.test.ts runs it with a fake hasher. The relay only binds
 * connections to the answers. */

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

/** argon2id via Bun's built-in, at OWASP's baseline cost (19 MiB, 2 passes)
 * — a hash takes tens of milliseconds and never holds 64 MiB per login. */
export const argon2Hasher: PasswordHasher = {
  hash: (password) => Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 }),
  verify: (password, hash) => Bun.password.verify(password, hash),
};

/** One signed-in device. */
export interface SessionRecord {
  /** SHA-256 (hex) of the bearer token — never the token itself. */
  hash: string;
  created: number;
  lastUsed: number;
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_SESSIONS = 10;
/** Accounts one connection may create (bounds signup spam per socket). */
export const MAX_REGISTRATIONS_PER_CONNECTION = 3;

export function newSessionToken(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = random(new Uint8Array(32));
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const SESSION_HASH_RE = /^[0-9a-f]{64}$/;
const MAX_PASSWORD_HASH = 512;

/** Carry the sign-in fields of a persisted record onto its loaded account,
 * dropping anything malformed (a bad username or hash leaves a guest; bad
 * sessions are simply gone). */
export function restoreSignIn(account: AccountRecord, raw: unknown): void {
  const r = (raw ?? {}) as Partial<Record<keyof AccountRecord, unknown>>;
  if (
    checkUsername(r.username) === null &&
    typeof r.passwordHash === "string" &&
    r.passwordHash.length > 0 &&
    r.passwordHash.length <= MAX_PASSWORD_HASH
  ) {
    account.username = r.username as string;
    account.passwordHash = r.passwordHash;
    const sessions = Array.isArray(r.sessions) ? (r.sessions as Partial<SessionRecord>[]) : [];
    account.sessions = sessions
      .filter(
        (s): s is SessionRecord =>
          typeof s?.hash === "string" &&
          SESSION_HASH_RE.test(s.hash) &&
          Number.isFinite(s.created) &&
          Number.isFinite(s.lastUsed),
      )
      .map((s) => ({ hash: s.hash, created: s.created, lastUsed: s.lastUsed }))
      .slice(0, MAX_SESSIONS);
  }
}

// ── Backoff ──────────────────────────────────────────────────────────────────

export interface BackoffPolicy {
  /** Failures allowed before any wait. */
  free: number;
  /** First wait after the free ones; doubles per further failure… */
  baseMs: number;
  /** …up to this. */
  maxMs: number;
  /** A key with no failure for this long starts clean again. */
  forgetMs: number;
}

/** Exponential backoff after repeated failures, per key (a connection, a
 * username). In memory: a restart forgives everyone, which is fine. */
export class Backoff {
  private entries = new Map<string, { fails: number; until: number; last: number }>();

  constructor(private policy: BackoffPolicy) {}

  /** Milliseconds until `key` may try again (0 = now). */
  wait(key: string, now: number): number {
    const e = this.entries.get(key);
    if (!e) return 0;
    if (now - e.last > this.policy.forgetMs) {
      this.entries.delete(key);
      return 0;
    }
    return Math.max(0, e.until - now);
  }

  fail(key: string, now: number): void {
    let e = this.entries.get(key);
    if (!e || now - e.last > this.policy.forgetMs) e = { fails: 0, until: 0, last: now };
    e.fails += 1;
    e.last = now;
    const over = e.fails - this.policy.free;
    e.until = over > 0 ? now + Math.min(this.policy.maxMs, this.policy.baseMs * 2 ** (over - 1)) : 0;
    this.entries.set(key, e);
    if (this.entries.size > 4096) this.prune(now);
  }

  clear(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }

  private prune(now: number): void {
    for (const [key, e] of this.entries) {
      if (now - e.last > this.policy.forgetMs && e.until <= now) this.entries.delete(key);
    }
  }
}

export const DEFAULT_LIMITS: { connection: BackoffPolicy; username: BackoffPolicy } = {
  connection: { free: 5, baseMs: 1000, maxMs: 5 * 60_000, forgetMs: 15 * 60_000 },
  username: { free: 5, baseMs: 1000, maxMs: 5 * 60_000, forgetMs: 15 * 60_000 },
};

// ── The desk ─────────────────────────────────────────────────────────────────

export interface AuthDeps {
  hasher: PasswordHasher;
  now: () => number;
  /** Fills the buffer with random bytes (crypto.getRandomValues). */
  random?: (bytes: Uint8Array) => Uint8Array;
  limits?: typeof DEFAULT_LIMITS;
  log?: (text: string) => void;
}

export type AuthOutcome =
  | { ok: true; account: AccountRecord; token: string }
  | { ok: false; reason: AuthErrorReason; retryAfterMs?: number };

interface Connection {
  /** The sign-in token this connection presented or was issued (null: a
   * guest's device token, or nobody yet). */
  token: string | null;
  busy: boolean;
  gone: boolean;
  registrations: number;
}

const fail = (reason: AuthErrorReason, retryAfterMs?: number): AuthOutcome =>
  retryAfterMs === undefined ? { ok: false, reason } : { ok: false, reason, retryAfterMs };

export class AccountAuth {
  private byUsername = new Map<string, AccountRecord>();
  private bySession = new Map<string, AccountRecord>();
  private connections = new Map<string, Connection>();
  private perConnection: Backoff;
  private perUsername: Backoff;
  /** A real hash of nothing, so a sign-in for an unknown username costs what
   * a real one does. */
  private decoy: Promise<string> | null = null;

  constructor(
    private store: AccountStore,
    private deps: AuthDeps,
  ) {
    const limits = deps.limits ?? DEFAULT_LIMITS;
    this.perConnection = new Backoff(limits.connection);
    this.perUsername = new Backoff(limits.username);
    for (const account of store.all()) this.index(account);
  }

  /** `login`: a stored token comes back. A live sign-in token resumes its
   * member (and keeps the session alive for another SESSION_TTL_MS); a
   * guest's device token resumes the guest. Null = a lapsed or revoked
   * sign-in token, or the device token of a wizard that has since been
   * claimed — the client must sign in. No token, or an unknown non-session
   * token, mints a fresh guest as it always has. */
  resume(conn: string, token: string | undefined, name: string): { account: AccountRecord; token: string } | null {
    const c = this.connection(conn);
    if (isSessionToken(token)) {
      const account = this.sessionAccount(token, this.deps.now());
      if (!account) return null;
      c.token = token;
      return { account: this.store.login(account.token, name), token };
    }
    if (token && this.store.get(token)?.passwordHash) return null;
    const account = this.store.login(token, name);
    c.token = null;
    return { account, token: account.token };
  }

  /** A new wizard, written into the ledger. */
  register(conn: string, username: unknown, password: unknown, name: string): Promise<AuthOutcome> {
    return this.guarded(conn, async (c) => {
      const bad = checkUsername(username) ?? checkPassword(password);
      if (bad) return fail(bad);
      const user = username as string;
      const now = this.deps.now();
      const wait = this.perConnection.wait(conn, now);
      if (wait > 0) return fail("rate-limited", wait);
      if (c.registrations >= MAX_REGISTRATIONS_PER_CONNECTION) return fail("rate-limited", 60_000);
      if (this.byUsername.has(usernameKey(user))) {
        this.perConnection.fail(conn, now);
        return fail("username-taken");
      }
      const hash = await this.deps.hasher.hash(password as string);
      if (c.gone) return fail("server-error");
      // Someone may have taken the name while the hash ran.
      if (this.byUsername.has(usernameKey(user))) return fail("username-taken");
      const account = this.store.login(undefined, name);
      this.setCredentials(account, user, hash);
      c.registrations += 1;
      return { ok: true, account, token: this.openSession(c, account) };
    });
  }

  /** Sign in with a username and password. */
  login(conn: string, username: unknown, password: unknown): Promise<AuthOutcome> {
    return this.guarded(conn, async (c) => {
      if (typeof username !== "string" || typeof password !== "string") return fail("bad-credentials");
      // Over-long input is refused before any hashing (and can't exist).
      if (username.length > USERNAME_MAX || password.length > PASSWORD_MAX) return fail("bad-credentials");
      const key = usernameKey(username);
      const now = this.deps.now();
      const wait = Math.max(this.perConnection.wait(conn, now), this.perUsername.wait(key, now));
      if (wait > 0) return fail("rate-limited", wait);
      const account = this.byUsername.get(key);
      let ok = false;
      if (account?.passwordHash) ok = await this.deps.hasher.verify(password, account.passwordHash);
      else await this.deps.hasher.verify(password, await this.decoyHash());
      if (c.gone) return fail("server-error");
      if (!ok || !account) {
        const at = this.deps.now();
        this.perConnection.fail(conn, at);
        this.perUsername.fail(key, at);
        this.deps.log?.(`${conn} failed sign-in as ${key}`);
        return fail("bad-credentials");
      }
      this.perConnection.clear(conn);
      this.perUsername.clear(key);
      return { ok: true, account, token: this.openSession(c, account) };
    });
  }

  /** A guest seals the wizard bound to this connection with credentials —
   * everything it owns stays (it's the same record). */
  claim(conn: string, account: AccountRecord | null, username: unknown, password: unknown): Promise<AuthOutcome> {
    return this.guarded(conn, async (c) => {
      if (!account) return fail("no-wizard");
      if (account.passwordHash || account.username) return fail("already-claimed");
      const bad = checkUsername(username) ?? checkPassword(password);
      if (bad) return fail(bad);
      const user = username as string;
      const now = this.deps.now();
      const wait = this.perConnection.wait(conn, now);
      if (wait > 0) return fail("rate-limited", wait);
      if (this.byUsername.has(usernameKey(user))) {
        this.perConnection.fail(conn, now);
        return fail("username-taken");
      }
      const hash = await this.deps.hasher.hash(password as string);
      if (c.gone) return fail("server-error");
      if (this.byUsername.has(usernameKey(user))) return fail("username-taken");
      if (account.passwordHash) return fail("already-claimed");
      this.setCredentials(account, user, hash);
      return { ok: true, account, token: this.openSession(c, account) };
    });
  }

  /** Sign out: revoke the token this connection signed in with (or, with
   * `everywhere`, every token of the account). A guest has nothing to
   * revoke — its device token is the wizard. */
  logout(conn: string, account: AccountRecord | null, everywhere = false): void {
    const c = this.connections.get(conn);
    if (account && everywhere) {
      for (const s of account.sessions ?? []) this.bySession.delete(s.hash);
      if (account.sessions?.length) {
        account.sessions = [];
        this.store.touch();
      }
    } else if (c?.token) {
      this.revoke(c.token);
    }
    if (c) c.token = null;
  }

  /** Revoke one sign-in token (also used when an issued token never reached
   * its connection). */
  revoke(token: string): void {
    const hash = hashSessionToken(token);
    const account = this.bySession.get(hash);
    this.bySession.delete(hash);
    if (!account?.sessions) return;
    account.sessions = account.sessions.filter((s) => s.hash !== hash);
    this.store.touch();
  }

  /** The connection closed: forget it (an in-flight hash finds it gone). */
  forget(conn: string): void {
    const c = this.connections.get(conn);
    if (c) c.gone = true;
    this.connections.delete(conn);
  }

  /** Member lookup by username (any case). */
  member(username: string): AccountRecord | null {
    return this.byUsername.get(usernameKey(username)) ?? null;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private connection(conn: string): Connection {
    let c = this.connections.get(conn);
    if (!c) {
      c = { token: null, busy: false, gone: false, registrations: 0 };
      this.connections.set(conn, c);
    }
    return c;
  }

  /** One hash at a time per connection; a throwing hasher is a refusal, not
   * a crash. */
  private async guarded(conn: string, op: (c: Connection) => Promise<AuthOutcome>): Promise<AuthOutcome> {
    const c = this.connection(conn);
    if (c.busy) return fail("busy");
    c.busy = true;
    try {
      return await op(c);
    } catch (err) {
      this.deps.log?.(`auth error for ${conn}: ${String(err)}`);
      return fail("server-error");
    } finally {
      c.busy = false;
    }
  }

  private decoyHash(): Promise<string> {
    return (this.decoy ??= this.deps.hasher.hash(newSessionToken(this.deps.random)));
  }

  private index(account: AccountRecord): void {
    if (account.username) {
      const key = usernameKey(account.username);
      if (this.byUsername.has(key)) {
        this.deps.log?.(`duplicate username "${account.username}" in the store — the first one keeps it`);
      } else {
        this.byUsername.set(key, account);
      }
    }
    for (const s of account.sessions ?? []) this.bySession.set(s.hash, account);
  }

  private setCredentials(account: AccountRecord, username: string, passwordHash: string): void {
    account.username = username;
    account.passwordHash = passwordHash;
    this.byUsername.set(usernameKey(username), account);
    this.store.touch();
  }

  /** Issue a token: drop lapsed sessions, keep the most recently used ones
   * under the cap, remember which token this connection holds. */
  private openSession(c: Connection, account: AccountRecord): string {
    const now = this.deps.now();
    const token = newSessionToken(this.deps.random);
    const all = [
      { hash: hashSessionToken(token), created: now, lastUsed: now },
      ...(account.sessions ?? []).filter((s) => now - s.lastUsed <= SESSION_TTL_MS),
    ].sort((x, y) => y.lastUsed - x.lastUsed);
    const kept = all.slice(0, MAX_SESSIONS);
    for (const s of account.sessions ?? []) {
      if (!kept.includes(s)) this.bySession.delete(s.hash);
    }
    for (const s of kept) this.bySession.set(s.hash, account);
    account.sessions = kept;
    this.store.touch();
    c.token = token;
    return token;
  }

  /** The member a sign-in token belongs to, if it's live; a lapsed one is
   * dropped on sight. Using it slides its expiry. */
  private sessionAccount(token: string, now: number): AccountRecord | null {
    const hash = hashSessionToken(token);
    const account = this.bySession.get(hash);
    const session = account?.sessions?.find((s) => s.hash === hash);
    if (!account || !session) return null;
    if (now - session.lastUsed > SESSION_TTL_MS) {
      this.revoke(token);
      return null;
    }
    session.lastUsed = now;
    return account;
  }
}
