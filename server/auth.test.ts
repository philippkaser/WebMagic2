import { beforeEach, describe, expect, test } from "bun:test";
import { checkPassword, checkUsername, isSessionToken, sanitizeUsernameDraft } from "../src/net/credentials";
import { ACCOUNTS_FILE_VERSION, AccountStore, checkAccountsFile } from "./accounts";
import {
  AccountAuth,
  argon2Hasher,
  Backoff,
  DEFAULT_LIMITS,
  hashSessionToken,
  MAX_REGISTRATIONS_PER_CONNECTION,
  MAX_SESSIONS,
  newSessionToken,
  SESSION_TTL_MS,
  type AuthOutcome,
  type PasswordHasher,
} from "./auth";

/** The ledger's spec. A fake hasher stands in for argon2 (which is slow on
 * purpose); it counts its calls so the timing-equaliser can be checked. */

let hashes = 0;
let verifies = 0;
const fakeHasher: PasswordHasher = {
  async hash(password) {
    hashes++;
    return `fake$${password}`;
  },
  async verify(password, hash) {
    verifies++;
    return hash === `fake$${password}`;
  },
};

let now = 1_000_000;
let json = "";
let store: AccountStore;
let auth: AccountAuth;
let seq = 0;
/** Deterministic but distinct "random" bytes. */
const random = (b: Uint8Array) => {
  seq++;
  for (let i = 0; i < b.length; i++) b[i] = (seq * 31 + i * 7) & 0xff;
  return b;
};

function fresh(): void {
  hashes = 0;
  verifies = 0;
  now = 1_000_000;
  json = "";
  store = new AccountStore((s) => (json = s()));
  auth = new AccountAuth(store, { hasher: fakeHasher, now: () => now, random });
}

beforeEach(fresh);

function ok(outcome: AuthOutcome) {
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.reason}`);
  return outcome;
}

function refused(outcome: AuthOutcome) {
  if (outcome.ok) throw new Error("expected a refusal");
  return outcome;
}

describe("credential rules (shared with the client)", () => {
  test("usernames are 3–16 of A–Z a–z 0–9 _ -", () => {
    expect(checkUsername("Orla")).toBeNull();
    expect(checkUsername("a_b-9")).toBeNull();
    expect(checkUsername("ab")).toBe("bad-username");
    expect(checkUsername("x".repeat(17))).toBe("bad-username");
    expect(checkUsername("has space")).toBe("bad-username");
    expect(checkUsername("émile")).toBe("bad-username");
    expect(checkUsername(42)).toBe("bad-username");
    expect(sanitizeUsernameDraft("Or la!é_x".repeat(3))).toBe("Orla_xOrla_xOrla");
  });

  test("passwords are 8–128 characters", () => {
    expect(checkPassword("1234567")).toBe("bad-password");
    expect(checkPassword("12345678")).toBeNull();
    expect(checkPassword("p".repeat(129))).toBe("bad-password");
    expect(checkPassword(undefined)).toBe("bad-password");
  });

  test("the real hasher is argon2id and round-trips (Bun.password)", async () => {
    const hash = await argon2Hasher.hash("correct horse");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).not.toContain("correct horse");
    expect(await argon2Hasher.verify("correct horse", hash)).toBe(true);
    expect(await argon2Hasher.verify("wrong horse", hash)).toBe(false);
  });

  test("session tokens are 64 hex chars (256 random bits), distinct from device UUIDs", () => {
    const token = newSessionToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(newSessionToken()).not.toBe(token);
    expect(isSessionToken(token)).toBe(true);
    expect(isSessionToken(crypto.randomUUID())).toBe(false);
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).not.toBe(token);
  });
});

describe("register", () => {
  test("writes a new wizard: hashed password, a session token, nothing in plain text", async () => {
    const out = ok(await auth.register("c1", "Orla", "correct horse", "Orla the Grey"));
    expect(out.account.username).toBe("Orla");
    expect(out.account.name).toBe("Orla the Grey");
    expect(out.account.passwordHash).toBe("fake$correct horse");
    expect(isSessionToken(out.token)).toBe(true);
    expect(out.account.sessions).toHaveLength(1);
    expect(out.account.sessions![0]!.hash).toBe(hashSessionToken(out.token));
    // Persisted: hash of the token, never the token or the password.
    expect(json).toContain(hashSessionToken(out.token));
    expect(json).not.toContain(out.token);
    expect(json).not.toContain('"correct horse"');
  });

  test("usernames are unique ignoring case; the chosen spelling is kept", async () => {
    ok(await auth.register("c1", "Orla", "password1", "A"));
    const dup = refused(await auth.register("c2", "ORLA", "password2", "B"));
    expect(dup.reason).toBe("username-taken");
    expect(auth.member("orla")!.username).toBe("Orla");
  });

  test("bad usernames and passwords are refused before any hashing", async () => {
    expect(refused(await auth.register("c1", "x", "password1", "A")).reason).toBe("bad-username");
    expect(refused(await auth.register("c1", "Orla", "short", "A")).reason).toBe("bad-password");
    expect(refused(await auth.register("c1", { evil: true }, "password1", "A")).reason).toBe("bad-username");
    expect(hashes).toBe(0);
    expect(store.size).toBe(0);
  });

  test("a connection may only create a few accounts", async () => {
    for (let i = 0; i < MAX_REGISTRATIONS_PER_CONNECTION; i++) {
      ok(await auth.register("c1", `wiz${i}`, "password1", "W"));
    }
    expect(refused(await auth.register("c1", "onemore", "password1", "W")).reason).toBe("rate-limited");
    ok(await auth.register("c2", "onemore", "password1", "W"));
  });

  test("one hash at a time per connection", async () => {
    const first = auth.register("c1", "Orla", "password1", "A");
    const second = await auth.register("c1", "Bram", "password1", "B");
    expect(refused(second).reason).toBe("busy");
    ok(await first);
  });

  test("a connection that closes mid-hash gets nothing minted", async () => {
    const pending = auth.register("c1", "Orla", "password1", "A");
    auth.forget("c1");
    expect(refused(await pending).reason).toBe("server-error");
    expect(store.size).toBe(0);
  });

  test("a throwing hasher is a refusal, not a crash", async () => {
    const broken = new AccountAuth(store, {
      hasher: { hash: () => Promise.reject(new Error("boom")), verify: () => Promise.resolve(false) },
      now: () => now,
    });
    expect(refused(await broken.register("c1", "Orla", "password1", "A")).reason).toBe("server-error");
  });
});

describe("sign in", () => {
  test("right password → a NEW session token for the same wizard", async () => {
    const reg = ok(await auth.register("c1", "Orla", "password1", "Orla"));
    reg.account.deepest = 12;
    const signed = ok(await auth.login("c2", "orla", "password1"));
    expect(signed.account).toBe(reg.account);
    expect(signed.token).not.toBe(reg.token);
    expect(signed.account.sessions).toHaveLength(2);
  });

  test("wrong password and unknown username read the same, and both cost a hash", async () => {
    ok(await auth.register("c1", "Orla", "password1", "Orla"));
    verifies = 0;
    expect(refused(await auth.login("c2", "Orla", "password2")).reason).toBe("bad-credentials");
    expect(refused(await auth.login("c2", "Nobody", "password1")).reason).toBe("bad-credentials");
    expect(verifies).toBe(2);
  });

  test("junk payloads are refused without hashing", async () => {
    verifies = 0;
    expect(refused(await auth.login("c1", null, "password1")).reason).toBe("bad-credentials");
    expect(refused(await auth.login("c1", "Orla", "p".repeat(5000))).reason).toBe("bad-credentials");
    expect(verifies).toBe(0);
  });

  test("failures back off per connection: five free, then exponential waits", async () => {
    ok(await auth.register("c0", "Orla", "password1", "Orla"));
    for (let i = 0; i < DEFAULT_LIMITS.connection.free; i++) {
      expect(refused(await auth.login("c1", `ghost${i}`, "wrongpass")).reason).toBe("bad-credentials");
    }
    // The sixth failure sets a 1 s wait …
    expect(refused(await auth.login("c1", "ghost9", "wrongpass")).reason).toBe("bad-credentials");
    const limited = refused(await auth.login("c1", "Orla", "password1"));
    expect(limited.reason).toBe("rate-limited");
    expect(limited.retryAfterMs).toBe(1000);
    // … that passes; the next failure doubles it.
    now += 1000;
    expect(refused(await auth.login("c1", "ghost10", "wrongpass")).reason).toBe("bad-credentials");
    expect(refused(await auth.login("c1", "Orla", "password1")).retryAfterMs).toBe(2000);
    // Another connection is unaffected (different usernames were guessed).
    ok(await auth.login("c2", "Orla", "password1"));
  });

  test("failures back off per username, across connections; success clears it", async () => {
    ok(await auth.register("c0", "Orla", "password1", "Orla"));
    for (let i = 0; i <= DEFAULT_LIMITS.username.free; i++) {
      refused(await auth.login(`attacker${i}`, "Orla", `guess${i}xx`));
    }
    const limited = refused(await auth.login("honest", "Orla", "password1"));
    expect(limited.reason).toBe("rate-limited");
    now += limited.retryAfterMs!;
    ok(await auth.login("honest", "Orla", "password1"));
    // Cleared: the next wrong guess is "free" again.
    expect(refused(await auth.login("attacker99", "Orla", "nopenope")).reason).toBe("bad-credentials");
  });

  test("waits are capped and forgotten after a quiet spell", () => {
    const b = new Backoff({ free: 1, baseMs: 1000, maxMs: 8000, forgetMs: 60_000 });
    b.fail("k", 0);
    expect(b.wait("k", 0)).toBe(0);
    for (let i = 0; i < 20; i++) b.fail("k", 0);
    expect(b.wait("k", 0)).toBe(8000);
    expect(b.wait("k", 5000)).toBe(3000);
    expect(b.wait("k", 61_000)).toBe(0);
    expect(b.size).toBe(0);
  });
});

describe("sessions", () => {
  test("a stored session token resumes the member and slides its expiry", async () => {
    const reg = ok(await auth.register("c1", "Orla", "password1", "Orla"));
    now += SESSION_TTL_MS - 1;
    const back = auth.resume("c2", reg.token, "Orla")!;
    expect(back.account).toBe(reg.account);
    expect(back.token).toBe(reg.token);
    // Used just now, so it lives another full TTL.
    now += SESSION_TTL_MS - 1;
    expect(auth.resume("c3", reg.token, "Orla")).not.toBeNull();
  });

  test("an unused session lapses after the TTL and is dropped", async () => {
    const reg = ok(await auth.register("c1", "Orla", "password1", "Orla"));
    now += SESSION_TTL_MS + 1;
    expect(auth.resume("c2", reg.token, "Orla")).toBeNull();
    expect(reg.account.sessions).toHaveLength(0);
    // A garbage session-shaped token is also simply "expired" — no new guest.
    const before = store.size;
    expect(auth.resume("c3", "ab".repeat(32), "Orla")).toBeNull();
    expect(store.size).toBe(before);
  });

  test("resuming updates the display name, never the username", async () => {
    const reg = ok(await auth.register("c1", "Orla", "password1", "Orla"));
    const back = auth.resume("c2", reg.token, "Grey Orla")!;
    expect(back.account.name).toBe("Grey Orla");
    expect(back.account.username).toBe("Orla");
  });

  test("sessions are capped per account, the least recently used dropped first", async () => {
    const tokens: string[] = [];
    tokens.push(ok(await auth.register("c0", "Orla", "password1", "Orla")).token);
    for (let i = 1; i < MAX_SESSIONS + 3; i++) {
      now += 1000;
      tokens.push(ok(await auth.login(`c${i}`, "Orla", "password1")).token);
    }
    expect(auth.member("Orla")!.sessions).toHaveLength(MAX_SESSIONS);
    expect(auth.resume("x", tokens[0], "Orla")).toBeNull();
    expect(auth.resume("y", tokens.at(-1), "Orla")).not.toBeNull();
  });

  test("logout revokes this connection's token only; everywhere revokes all", async () => {
    const a = ok(await auth.register("c1", "Orla", "password1", "Orla"));
    const b = ok(await auth.login("c2", "Orla", "password1"));
    auth.logout("c1", a.account);
    expect(auth.resume("c3", a.token, "Orla")).toBeNull();
    expect(auth.resume("c4", b.token, "Orla")).not.toBeNull();
    const c = ok(await auth.login("c5", "Orla", "password1"));
    auth.logout("c5", c.account, true);
    expect(auth.resume("c6", b.token, "Orla")).toBeNull();
    expect(auth.resume("c7", c.token, "Orla")).toBeNull();
    // The password still works.
    ok(await auth.login("c8", "Orla", "password1"));
  });
});

describe("guests and claiming", () => {
  test("guests keep the device-token flow exactly: none mints, presenting resumes", () => {
    const first = auth.resume("c1", undefined, "Dana")!;
    expect(first.token).toBe(first.account.token);
    expect(isSessionToken(first.token)).toBe(false);
    const again = auth.resume("c2", first.token, "Dana")!;
    expect(again.account).toBe(first.account);
    // An unknown device token mints a fresh guest, as it always has.
    expect(auth.resume("c3", "lost-token", "Dana")!.account).not.toBe(first.account);
  });

  test("a guest claims its wizard: progress carries over, a session replaces the device token", async () => {
    const guest = auth.resume("c1", undefined, "Dana")!.account;
    guest.deepest = 9;
    guest.inventory.gold = 120;
    const deviceToken = guest.token;
    const claimed = ok(await auth.claim("c1", guest, "Dana", "password1"));
    expect(claimed.account).toBe(guest);
    expect(claimed.account.deepest).toBe(9);
    expect(claimed.account.inventory.gold).toBe(120);
    expect(isSessionToken(claimed.token)).toBe(true);
    // The old device token no longer opens the wizard …
    expect(auth.resume("c2", deviceToken, "Dana")).toBeNull();
    // … the username and password do.
    expect(ok(await auth.login("c3", "dana", "password1")).account).toBe(guest);
  });

  test("claims are refused for members, nobodies and taken names", async () => {
    const member = ok(await auth.register("c0", "Orla", "password1", "Orla")).account;
    expect(refused(await auth.claim("c1", member, "Orla2", "password1")).reason).toBe("already-claimed");
    expect(refused(await auth.claim("c1", null, "Orla2", "password1")).reason).toBe("no-wizard");
    const guest = auth.resume("c2", undefined, "Dana")!.account;
    expect(refused(await auth.claim("c2", guest, "orla", "password1")).reason).toBe("username-taken");
    expect(refused(await auth.claim("c2", guest, "Dana", "pw")).reason).toBe("bad-password");
    expect(guest.username).toBeUndefined();
  });
});

describe("persistence of the ledger", () => {
  test("credentials and sessions survive a restart (and the file is versioned)", async () => {
    const reg = ok(await auth.register("c1", "Orla", "password1", "Orla"));
    expect(JSON.parse(json).version).toBe(ACCOUNTS_FILE_VERSION);
    const restored = new AccountStore(null, json);
    const auth2 = new AccountAuth(restored, { hasher: fakeHasher, now: () => now, random });
    const back = auth2.resume("c9", reg.token, "Orla")!;
    expect(back.account.username).toBe("Orla");
    ok(await auth2.login("c10", "ORLA", "password1"));
  });

  test("old bare-array files load; their device tokens keep working for guests", () => {
    const legacy = JSON.stringify([{ token: "old-device-token", name: "Vet", deepest: 7, inventory: {}, runGrants: [] }]);
    const old = new AccountStore(null, legacy);
    const auth2 = new AccountAuth(old, { hasher: fakeHasher, now: () => now });
    const back = auth2.resume("c1", "old-device-token", "Vet")!;
    expect(back.account.deepest).toBe(7);
    expect(back.token).toBe("old-device-token");
  });

  test("malformed sign-in fields are dropped on load (the record stays a guest)", () => {
    const rows = [
      { token: "t1", name: "A", username: "no spaces allowed", passwordHash: "x" },
      { token: "t2", name: "B", username: "Bram", passwordHash: "fake$pw", sessions: [{ hash: "nothex", created: 1, lastUsed: 1 }] },
    ];
    const s = new AccountStore(null, JSON.stringify({ version: 2, accounts: rows }));
    expect(s.get("t1")!.username).toBeUndefined();
    expect(s.get("t2")!.username).toBe("Bram");
    expect(s.get("t2")!.sessions).toEqual([]);
  });

  test("checkAccountsFile: either shape is fine, junk is corrupt, a newer version refuses", () => {
    expect(checkAccountsFile([])).toBeNull();
    expect(checkAccountsFile({ version: 2, accounts: [] })).toBeNull();
    expect(checkAccountsFile({ hello: "world" })).not.toBeNull();
    expect(checkAccountsFile(null)).not.toBeNull();
    expect(() => checkAccountsFile({ version: ACCOUNTS_FILE_VERSION + 1, accounts: [] })).toThrow();
  });
});
