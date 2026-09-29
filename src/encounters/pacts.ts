/** Pacts — how two wizards who meet below decide not to kill each other.
 *
 * Every other wizard starts WARY: your spells can hurt them and theirs can
 * hurt you. Standing close, either can offer a pact (F); if the other
 * accepts, both are BOUND — magic passes harmlessly between you until one of
 * you breaks it. Breaking is instant and one-sided, and the floor remembers:
 * an oathbreaker's name burns red for as long as they share it.
 *
 * This module is the pure per-peer state machine (no net, no React): feed it
 * events, it returns the new relation plus what to tell the other wizard and
 * what to tell the player. encounters/PactSystem wires it to the network,
 * the F key and the hostility seam (game/hostility.ts). */

export type PactState =
  /** Default: hostile. */
  | "wary"
  /** We offered; waiting for their answer. Still hostile meanwhile. */
  | "offered"
  /** They offered; ours to accept. Still hostile meanwhile. */
  | "invited"
  /** Sworn — no harm passes between us. */
  | "bound";

export interface PactRelation {
  state: PactState;
  /** Server-ish time (ms) an offer/invitation lapses. */
  expiresAt: number;
  /** They broke a pact with us on this floor. */
  oathbreaker: boolean;
}

export type PactWire = "offer" | "accept" | "break";

export type PactEvent =
  /** The local player pressed the pact key at this wizard. */
  | { kind: "press" }
  /** A pact message arrived from this wizard. */
  | { kind: "received"; msg: PactWire }
  /** Time passes (lapses stale offers). */
  | { kind: "tick" };

export type PactNotice =
  | "offered" // you offered
  | "invited" // they offered
  | "sworn" // pact formed
  | "broke" // you broke it
  | "betrayed" // they broke it
  | "lapsed"; // an offer expired unanswered

export interface PactStep {
  relation: PactRelation;
  /** Message to send to the other wizard, if any. */
  send: PactWire | null;
  notice: PactNotice | null;
}

/** How long an unanswered offer stands (the offerer's clock). */
export const PACT_OFFER_MS = 20_000;
/** The invitee's window closes this much earlier, so an accept always lands
 * while the offer still stands on the other side (each side times the offer
 * on its own clock, a network hop apart). */
export const PACT_ACCEPT_MARGIN_MS = 3_000;

export function newRelation(): PactRelation {
  return { state: "wary", expiresAt: 0, oathbreaker: false };
}

export function isHostileRelation(r: PactRelation | undefined): boolean {
  return !r || r.state !== "bound";
}

export function pactStep(rel: PactRelation, event: PactEvent, now: number): PactStep {
  const next = (state: PactState, extra: Partial<PactRelation> = {}): PactRelation => ({
    ...rel,
    state,
    expiresAt:
      state === "offered"
        ? now + PACT_OFFER_MS
        : state === "invited"
          ? now + PACT_OFFER_MS - PACT_ACCEPT_MARGIN_MS
          : 0,
    ...extra,
  });
  const stay: PactStep = { relation: rel, send: null, notice: null };

  switch (event.kind) {
    case "tick":
      if ((rel.state === "offered" || rel.state === "invited") && now >= rel.expiresAt) {
        return { relation: next("wary"), send: null, notice: rel.state === "offered" ? "lapsed" : null };
      }
      return stay;

    case "press":
      switch (rel.state) {
        case "wary":
          return { relation: next("offered"), send: "offer", notice: "offered" };
        case "invited":
          return { relation: next("bound"), send: "accept", notice: "sworn" };
        case "bound":
          return { relation: next("wary"), send: "break", notice: "broke" };
        case "offered":
          return stay; // already waiting on them
      }
      return stay;

    case "received":
      switch (event.msg) {
        case "offer":
          if (rel.state === "wary") return { relation: next("invited"), send: null, notice: "invited" };
          // Both reached out at once — that's a pact.
          if (rel.state === "offered") return { relation: next("bound"), send: "accept", notice: "sworn" };
          if (rel.state === "invited") return { relation: next("invited"), send: null, notice: null };
          return stay;
        case "accept":
          if (rel.state === "offered") return { relation: next("bound"), send: null, notice: "sworn" };
          return stay; // unsolicited accepts are ignored
        case "break":
          if (rel.state === "bound") {
            return { relation: next("wary", { oathbreaker: true }), send: null, notice: "betrayed" };
          }
          return stay;
      }
  }
  return stay;
}

/** The prompt shown when standing near this wizard. */
export function pactPrompt(rel: PactRelation | undefined, name: string, key = "F"): string {
  switch (rel?.state ?? "wary") {
    case "wary":
      return `${key} — Offer ${name} a pact`;
    case "offered":
      return `Waiting for ${name} to accept your pact…`;
    case "invited":
      return `${key} — Accept ${name}'s pact`;
    case "bound":
      return `${key} — Break your pact with ${name}`;
  }
}

/** One-line story beats for the message feed. */
export function pactNoticeText(notice: PactNotice, name: string): string {
  switch (notice) {
    case "offered":
      return `You offer ${name} a pact.`;
    case "invited":
      return `${name} offers you a pact. Stand close and press F to swear it.`;
    case "sworn":
      return `A pact is sworn with ${name}. Your magic will not harm each other.`;
    case "broke":
      return `You break your pact with ${name}. The floor remembers.`;
    case "betrayed":
      return `${name} breaks your pact! Oathbreaker.`;
    case "lapsed":
      return `${name} did not answer your pact.`;
  }
}
