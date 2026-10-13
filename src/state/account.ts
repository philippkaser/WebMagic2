import { create } from "zustand";
import { netBus } from "../net/bus";
import { checkPassword, checkUsername, type AuthErrorReason } from "../net/credentials";
import { useNet } from "../net/netStore";
import { session } from "../net/session";
import { useGame } from "./gameStore";
import { defaultSave, toWireInventory } from "./persistence";

/** Who this browser plays as, in the ledger's terms — what the title
 * screen's Wizard's Ledger shows. The session (net/session.ts) talks to the
 * server and stores the token; this turns its answers (netBus "ledger")
 * into state a screen can read, and offers the four things a wizard can do
 * with the ledger. Passwords pass straight through to the server and are
 * never kept. */

export type LedgerStatus =
  /** Not heard yet (connecting) — or offline, where the ledger is shut. */
  | "unknown"
  /** Online with no wizard on this browser yet: playing makes a guest. */
  | "anonymous"
  /** A guest: the wizard lives on this browser's device token only. */
  | "guest"
  /** Signed in: the wizard follows its username anywhere. */
  | "member";

export type LedgerAction = "signIn" | "register" | "claim" | "signOut";

/** The ledger's forms (the title's ledger tablet). */
export type LedgerForm = "signIn" | "register" | "claim";

export interface LedgerError {
  reason: AuthErrorReason;
  retryAfterMs?: number;
}

export interface AccountState {
  status: LedgerStatus;
  /** The member's username (null for guests). */
  username: string | null;
  /** A request awaiting the server's answer. */
  pending: LedgerAction | null;
  /** The last refusal, until the next request. */
  error: LedgerError | null;
  /** The stored sign-in had lapsed (or was revoked) when we came back. */
  lapsed: boolean;
  /** The form standing open on the title screen (null: none). */
  form: LedgerForm | null;
}

export const useAccount = create<AccountState>(() => ({
  status: "unknown",
  username: null,
  pending: null,
  error: null,
  lapsed: false,
  form: null,
}));

/** No answer in this long = the request is given up on (dropped socket…). */
const REPLY_TIMEOUT_MS = 15_000;
let replyTimer: ReturnType<typeof setTimeout> | null = null;

function begin(action: LedgerAction, send: () => void): void {
  if (useAccount.getState().pending) return;
  useAccount.setState({ pending: action, error: null });
  if (replyTimer !== null) clearTimeout(replyTimer);
  replyTimer = setTimeout(() => {
    replyTimer = null;
    if (useAccount.getState().pending === action) {
      useAccount.setState({ pending: null, error: { reason: "server-error" } });
    }
  }, REPLY_TIMEOUT_MS);
  send();
}

function settle(patch: Partial<AccountState>): void {
  if (replyTimer !== null) clearTimeout(replyTimer);
  replyTimer = null;
  useAccount.setState({ pending: null, ...patch });
}

/** Checked here first so a typo never costs a round trip (the server
 * checks again). False = refused locally (the error is set). */
function credentialsOk(username: string, password: string): boolean {
  const bad = checkUsername(username) ?? checkPassword(password);
  if (bad) useAccount.setState({ error: { reason: bad } });
  return bad === null;
}

/** The title screen opens the ledger: connect, and if this browser already
 * has a wizard, log it in (its save becomes the one shown). */
export async function openLedger(): Promise<void> {
  const resumed = await session.resume(useGame.getState().playerName);
  if (!resumed && useNet.getState().mode === "online" && useAccount.getState().status === "unknown") {
    useAccount.setState({ status: "anonymous" });
  }
}

/** Offline: knock on the server's door again. */
export async function retryLedger(): Promise<void> {
  await session.retryOnline();
  await openLedger();
}

export function signIn(username: string, password: string): void {
  if (!credentialsOk(username, password)) return;
  begin("signIn", () => session.sendSignIn(username, password));
}

export function createAccount(username: string, password: string): void {
  if (!credentialsOk(username, password)) return;
  begin("register", () => session.sendRegister(username, password, useGame.getState().playerName));
}

/** Seal the guest wizard this browser plays — it keeps everything. */
export function claimWizard(username: string, password: string): void {
  if (!credentialsOk(username, password)) return;
  begin("claim", () => session.sendClaim(username, password));
}

export function signOut(): void {
  begin("signOut", () => session.sendLogout());
}

export function clearLedgerError(): void {
  if (useAccount.getState().error) useAccount.setState({ error: null });
}

/** Open a form of the ledger (or switch to another), starting clean. */
export function showLedgerForm(form: LedgerForm): void {
  useAccount.setState({ form, error: null });
}

export function hideLedgerForm(): void {
  if (useAccount.getState().form !== null) useAccount.setState({ form: null });
}

netBus.on("ledger", (e) => {
  const { pending } = useAccount.getState();
  switch (e.kind) {
    case "guest":
      useAccount.setState({ status: "guest", username: null });
      break;
    case "member":
      // Signing in to a wizard brings its display name with it (a register
      // or claim keeps the one on this plaque, which the server now holds
      // or learns at the next login).
      if (e.name && pending === "signIn") useGame.getState().setPlayerName(e.name);
      // Answering a form: the form closes.
      if (pending && pending !== "signOut") {
        settle({ status: "member", username: e.username, error: null, lapsed: false, form: null });
      } else {
        useAccount.setState({ status: "member", username: e.username, lapsed: false });
      }
      break;
    case "signedOut":
      // The wizard left with its owner: this browser starts over (the
      // gameStore listener applies and caches the blank save).
      netBus.emit("serverSave", { deepest: 0, inventory: toWireInventory(defaultSave()) });
      settle({ status: "anonymous", username: null, error: null });
      break;
    case "refused":
      if (e.reason === "session-expired") {
        useAccount.setState({ status: "anonymous", username: null, lapsed: true });
        break;
      }
      settle({ error: { reason: e.reason, retryAfterMs: e.retryAfterMs } });
      break;
  }
});

// Dev-only hook for debugging and end-to-end scripts.
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__ledger = {
    state: () => useAccount.getState(),
    show: showLedgerForm,
    hide: hideLedgerForm,
    signIn,
    createAccount,
    claimWizard,
    signOut,
  };
}
