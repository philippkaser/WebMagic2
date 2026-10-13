import type { AuthErrorReason } from "../../../net/credentials";
import { PASSWORD_MAX, PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN } from "../../../net/credentials";
import type { LedgerForm } from "../../../state/account";
import type { TextSpan } from "../../font/layout";
import { MENU_INK } from "./menuText";

/** The Wizard's Ledger in words — the title screen's sign-in, kept pure so
 * it can be tested and so the screens only lay it out. */

/** The forms the ledger tablet can show. */
export type LedgerMode = LedgerForm;

/** Things the title's ledger line offers. */
export type LedgerOffer = "signIn" | "register" | "claim" | "signOut" | "retry";

export interface LedgerLineFacts {
  status: "unknown" | "anonymous" | "guest" | "member";
  username: string | null;
  mode: "connecting" | "online" | "offline";
  lapsed: boolean;
}

/** The line under the title: who you are to the ledger, and what you may do. */
export function ledgerLine(f: LedgerLineFacts): { text: TextSpan[]; offers: LedgerOffer[] } {
  if (f.mode === "offline") {
    return {
      text: [{ text: "NO SERVER ANSWERS — THE LEDGER IS SHUT. YOU PLAY OFFLINE.", color: MENU_INK.dim }],
      offers: ["retry"],
    };
  }
  if (f.mode === "connecting" || f.status === "unknown") {
    return { text: [{ text: "READING THE LEDGER…", color: MENU_INK.faint }], offers: [] };
  }
  if (f.status === "member") {
    return {
      text: [
        { text: "IN THE LEDGER AS ", color: MENU_INK.dim },
        { text: (f.username ?? "").toUpperCase(), color: MENU_INK.accent },
      ],
      offers: ["signOut"],
    };
  }
  if (f.status === "guest") {
    return {
      text: [{ text: "A GUEST — THIS WIZARD LIVES IN THIS BROWSER ONLY", color: MENU_INK.dim }],
      offers: ["claim", "signIn"],
    };
  }
  return {
    text: f.lapsed
      ? [{ text: "YOUR SIGN-IN HAS LAPSED — SIGN IN AGAIN", color: MENU_INK.wound }]
      : [{ text: "NOT IN THE LEDGER — YOU WILL PLAY AS A GUEST", color: MENU_INK.dim }],
    offers: ["signIn", "register"],
  };
}

/** Button words for each offer. */
export const OFFER_LABEL: Record<LedgerOffer, string> = {
  signIn: "Sign in",
  register: "Create account",
  claim: "Claim this wizard",
  signOut: "Sign out",
  retry: "Try again",
};

export interface LedgerFormCopy {
  title: string;
  lore: string;
  submit: string;
  /** The other form, offered beside the submit button (null: none). */
  alternative: { mode: LedgerMode; label: string } | null;
  /** Under the fields before anything is refused. */
  hint: string | null;
}

export const RULES_HINT = `Username ${USERNAME_MIN}–${USERNAME_MAX} of A–Z 0–9 _ -  ·  password ${PASSWORD_MIN}+`;

export function ledgerForm(mode: LedgerMode): LedgerFormCopy {
  switch (mode) {
    case "signIn":
      return {
        title: "The Wizard's Ledger",
        lore: "Write your name and your secret word, and your wizard answers — at any hearth, in any browser.",
        submit: "Sign in",
        alternative: { mode: "register", label: "Create account" },
        hint: null,
      };
    case "register":
      return {
        title: "A New Name in the Ledger",
        lore: "A new wizard in the ledger. Your username is only for signing in — others see your plaque.",
        submit: "Create account",
        alternative: { mode: "signIn", label: "I have one" },
        hint: RULES_HINT,
      };
    case "claim":
      return {
        title: "Claim this Wizard",
        lore: "Seal this wizard with a username and a secret word — all it has banked comes along.",
        submit: "Claim",
        alternative: null,
        hint: RULES_HINT,
      };
  }
}

/** Shown in a sign-in/register form while this browser plays a guest: it
 * would be left behind. */
export const GUEST_LEFT_BEHIND = "This guest wizard stays behind — claim it instead to keep it.";

/** Words for a refusal (blood ink on the tablet). */
export function ledgerErrorText(reason: AuthErrorReason, retryAfterMs?: number): string {
  switch (reason) {
    case "bad-username":
      return `A username is ${USERNAME_MIN}–${USERNAME_MAX} letters, digits, _ or -.`;
    case "bad-password":
      return `A password needs ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`;
    case "username-taken":
      return "That username is already written in the ledger.";
    case "bad-credentials":
      return "The ledger knows no such name and password.";
    case "rate-limited":
      return `Too many tries — the ledger rests for ${waitText(retryAfterMs ?? 0)}.`;
    case "already-claimed":
      return "This wizard is already in the ledger.";
    case "no-wizard":
      return "There is no wizard here to claim yet.";
    case "in-dungeon":
      return "The ledger is shut while you walk the dungeon.";
    case "busy":
      return "The ledger is still writing — a moment.";
    case "session-expired":
      return "Your sign-in has lapsed — sign in again.";
    case "offline":
      return "No server answers — the ledger is shut.";
    case "server-error":
      return "The ledger did not answer. Try again.";
  }
}

/** "4 s", "2 min". */
export function waitText(ms: number): string {
  const s = Math.max(1, Math.ceil(ms / 1000));
  return s < 90 ? `${s} s` : `${Math.ceil(s / 60)} min`;
}
