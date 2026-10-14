import { create } from "zustand";
import { gameEvents } from "../core/events";
import { netBus } from "../net/bus";
import { useNet } from "../net/netStore";
import { resetPeers } from "../net/players";
import type { PartyError } from "../net/party";
import type { PartyInfo } from "../net/protocol";
import { session } from "../net/session";
import { useGame } from "../state/gameStore";

/** The social layer's client state: your fellowship, an invite waiting for
 * you, what's been said lately, and who said what over their heads. The
 * relay is the truth (server/relay.ts, net/party.ts); this mirrors it for the
 * in-world UI (the guild board, the chat feed, speech over heads, the party
 * runes on the HUD). */

export interface ChatLine {
  id: number;
  from: string;
  name: string;
  text: string;
  /** Said to the fellowship (wherever they are), not to the room. */
  party: boolean;
  at: number;
}

export interface SocialState {
  party: PartyInfo | null;
  invite: { from: string; name: string; until: number } | null;
  lines: ChatLine[];
  /** playerId → what they last said aloud (speech over their head). */
  said: Record<string, { text: string; until: number }>;
}

export const useSocial = create<SocialState>(() => ({ party: null, invite: null, lines: [], said: {} }));

/** How long words hang over a speaker's head, and how many lines are kept. */
export const SPEECH_MS = 6000;
const KEEP_LINES = 40;
const INVITE_MS = 30_000;

let lineId = 1;

export function isPartyMember(playerId: string): boolean {
  return !!useSocial.getState().party?.members.some((m) => m.id === playerId);
}

const ERROR_TEXT: Record<PartyError, string> = {
  "no-such-party": "No fellowship answers to those runes",
  "party-full": "That fellowship is full (four at most)",
  "no-invite": "No invitation waits for you",
  "already-in-it": "You're already of that fellowship",
  "not-in-a-party": "You have no fellowship to speak to",
};

netBus.on("chat", (c) => {
  const now = performance.now();
  const lines = [...useSocial.getState().lines, { id: lineId++, ...c, at: now }].slice(-KEEP_LINES);
  const said = c.party ? useSocial.getState().said : { ...useSocial.getState().said, [c.from]: { text: c.text, until: now + SPEECH_MS } };
  useSocial.setState({ lines, said });
});

netBus.on("party", (party) => {
  const before = useSocial.getState().party;
  useSocial.setState({ party, invite: null });
  if (!party) {
    if (before) gameEvents.emit("message", "You walk alone again");
    return;
  }
  if (!before) gameEvents.emit("message", `A fellowship is sworn · its runes: ${party.code}`);
  else if (party.members.length > before.members.length) {
    const joined = party.members.find((m) => !before.members.some((b) => b.id === m.id));
    if (joined) gameEvents.emit("message", `${joined.name} joins your fellowship`);
  } else if (party.members.length < before.members.length) {
    const left = before.members.find((m) => !party.members.some((p) => p.id === m.id));
    if (left) gameEvents.emit("message", `${left.name} leaves your fellowship`);
  }
});

netBus.on("partyInvited", ({ from, name }) => {
  // A pact partner's invitation is the pact made lasting: take it at once.
  if (pactPartners.has(from)) {
    pactPartners.delete(from);
    session.partyAccept();
    return;
  }
  useSocial.setState({ invite: { from, name, until: performance.now() + INVITE_MS } });
  gameEvents.emit("message", `${name} invites you into their fellowship — F to accept`);
});

netBus.on("partyError", (reason) => gameEvents.emit("message", ERROR_TEXT[reason] ?? "The fellowship refuses"));

/** Accept the invitation waiting for you, if it's still good. */
export function acceptInvite(): boolean {
  const inv = useSocial.getState().invite;
  if (!inv || inv.until < performance.now()) return false;
  session.partyAccept();
  useSocial.setState({ invite: null });
  return true;
}

/** Say something aloud (to your room), or — `party` — to your fellowship. */
export function say(text: string, party = false): void {
  const t = text.trim();
  if (t) session.sendChat(t, party);
}

// ── Pacts become fellowships ────────────────────────────────────────────────
// Two wizards who swear a pact in the deep stay together: the one with the
// lower id invites, the other accepts its partner's invitation on sight.

const pactPartners = new Set<string>();

gameEvents.on("pactSworn", ({ with: other }) => {
  const me = useNet.getState().playerId;
  if (!me || isPartyMember(other)) return;
  if (me < other) session.partyInvite(other);
  else {
    pactPartners.add(other);
    setTimeout(() => pactPartners.delete(other), 10_000);
  }
});

// ── Home is the camp ────────────────────────────────────────────────────────
// Whenever the wizard comes home (first start, a walk home, a respawn), they
// take a seat in the camp among whoever else is there.

useGame.subscribe((s, prev) => {
  if (s.phase === "village" && prev.phase !== "village") session.enterCamp();
});

// A new seat: forget whoever we saw before (the camp's wizards appear as
// their poses arrive).
netBus.on("camp", () => resetPeers());
