/** The ledger's rules for a username and a password — shared by the client
 * (it checks before sending, so a typo never costs a round trip) and the
 * server (which checks again, because the client is never trusted). Pure.
 *
 * The username is how a wizard signs in; it is never shown to anyone else
 * (the display name, chosen on the title screen, is what floor-mates see). */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;
export const PASSWORD_MIN = 8;
/** Generous for passphrases, small enough that hashing it costs nothing extra. */
export const PASSWORD_MAX = 128;

const USERNAME_RE = /^[A-Za-z0-9_-]+$/;

/** Why the ledger refused. The server sends these; the client words them
 * (ui3d/layers/menus/ledgerText.ts). */
export type AuthErrorReason =
  /** Username isn't 3–16 of A–Z a–z 0–9 _ -. */
  | "bad-username"
  /** Password shorter than PASSWORD_MIN or longer than PASSWORD_MAX. */
  | "bad-password"
  | "username-taken"
  /** Unknown username or wrong password — deliberately indistinguishable. */
  | "bad-credentials"
  /** Too many failures; `retryAfterMs` says how long to wait. */
  | "rate-limited"
  /** Claim refused: this wizard already has a username. */
  | "already-claimed"
  /** Claim refused: no wizard is bound to this connection yet. */
  | "no-wizard"
  /** Sign-in changes wait until you are out of the dungeon. */
  | "in-dungeon"
  /** One ledger request at a time per connection. */
  | "busy"
  /** The stored sign-in token lapsed (30 days unused) or was revoked. */
  | "session-expired"
  /** No server reachable — the ledger is shut (offline loopback). */
  | "offline"
  | "server-error";

/** Null if fine, else the refusal. */
export function checkUsername(raw: unknown): AuthErrorReason | null {
  if (typeof raw !== "string") return "bad-username";
  if (raw.length < USERNAME_MIN || raw.length > USERNAME_MAX) return "bad-username";
  return USERNAME_RE.test(raw) ? null : "bad-username";
}

export function checkPassword(raw: unknown): AuthErrorReason | null {
  if (typeof raw !== "string") return "bad-password";
  return raw.length >= PASSWORD_MIN && raw.length <= PASSWORD_MAX ? null : "bad-password";
}

/** Usernames are unique ignoring case ("Orla" and "orla" are one wizard);
 * the chosen spelling is kept for display. */
export function usernameKey(username: string): string {
  return username.toLowerCase();
}

/** What a username field may hold while typing (the same alphabet, capped). */
export function sanitizeUsernameDraft(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, USERNAME_MAX);
}

/** Sign-in session tokens are 32 random bytes in hex. Guests' older device
 * tokens are UUIDs, so the two never collide and a lapsed session is
 * recognisable as one. */
export const SESSION_TOKEN_RE = /^[0-9a-f]{64}$/;

export function isSessionToken(token: unknown): token is string {
  return typeof token === "string" && SESSION_TOKEN_RE.test(token);
}
