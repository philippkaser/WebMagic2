import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { playPactBroken, playPactSworn } from "../audio/sound";
import { gameEvents } from "../core/events";
import { playerPosition } from "../game/player-state";
import { setRelationResolver } from "../game/hostility";
import { netBus } from "../net/bus";
import { peerMessage } from "../net/channels";
import { netClock } from "../net/clock";
import { useNet } from "../net/netStore";
import { estimatePeer, peerIds, peerName } from "../net/players";
import { input } from "../player/input";
import { useGame } from "../state/gameStore";
import { resetEncounters, useEncounters } from "./encounterStore";
import {
  isHostileRelation,
  newRelation,
  pactNoticeText,
  pactPrompt,
  pactStep,
  type PactEvent,
  type PactNotice,
  type PactWire,
} from "./pacts";

/** Pacts, live: the network messages, the F key, and the hostility answer
 * every PvP-aware system asks (game/hostility.ts). The rules themselves are
 * the pure state machine in pacts.ts.
 *
 * Pact messages are peer broadcasts addressed to one wizard (`to`); everyone
 * else ignores them. Each side keeps its own view of the relation, and the
 * messages keep the two views in step — worst case (a lost message) one side
 * stays wary a moment longer, which is the safe direction. */

/** How close you must stand to swear, accept or break a pact. */
const PACT_RANGE = 4.5;

interface PactMsg {
  to: string;
  kind: PactWire;
}

const pactMsg = peerMessage<PactMsg>("pact", (msg, meta) => {
  if (!msg || msg.to !== selfId()) return;
  if (msg.kind !== "offer" && msg.kind !== "accept" && msg.kind !== "break") return;
  apply(meta.from, { kind: "received", msg: msg.kind });
});

function selfId(): string {
  return useNet.getState().playerId || "self";
}

/** Feed one event into the relation with `peerId`, then act on the result. */
function apply(peerId: string, event: PactEvent): void {
  const relations = useEncounters.getState().relations;
  const current = relations[peerId] ?? newRelation();
  const step = pactStep(current, event, netClock.serverNow());
  if (step.relation !== current) {
    useEncounters.setState({ relations: { ...relations, [peerId]: step.relation } });
  }
  if (step.send) pactMsg.send({ to: peerId, kind: step.send });
  if (step.notice) announce(step.notice, peerId);
}

function announce(notice: PactNotice, peerId: string): void {
  gameEvents.emit("message", pactNoticeText(notice, peerName(peerId) || "A wizard"));
  if (notice === "sworn") playPactSworn();
  if (notice === "broke" || notice === "betrayed") playPactBroken();
}

// Everyone starts hostile; only a sworn pact makes a wizard safe.
setRelationResolver((id) => {
  const rel = useEncounters.getState().relations[id];
  if (!isHostileRelation(rel)) return "ally";
  return rel?.oathbreaker ? "oathbreaker" : "stranger";
});

netBus.on("peerLeft", ({ playerId }) => {
  // Deferred so every other peerLeft listener still sees the relation (the
  // departure message names allies, not strangers).
  queueMicrotask(() => {
    const { [playerId]: _gone, ...rest } = useEncounters.getState().relations;
    useEncounters.setState({ relations: rest });
  });
});
// A new floor is a new set of strangers — pacts never follow you down. A
// reconnect resets too, and that's consistent on both sides: the server
// hands every connection a fresh player id, so the other wizard sees us as a
// newcomer (their relation to our old id left with it).
netBus.on("assigned", () => resetEncounters());
netBus.on("leftDungeon", () => resetEncounters());

// Dev-only hook for end-to-end scripts (the F key needs pointer lock).
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__pact = (peerId: string) =>
    apply(peerId, { kind: "press" });
}

/** Mounted once in the scene: nearest-wizard prompt, the F key, and the
 * lapsing of unanswered offers. */
export function PactSystem() {
  const tickClock = useRef(0);

  useEffect(() => () => useEncounters.setState({ pactPrompt: null }), []);

  useFrame((_, dt) => {
    const state = useGame.getState();
    const net = useNet.getState();
    const active = state.phase === "dungeon" && net.mode === "online";
    if (!active) {
      input.consume("KeyF");
      if (useEncounters.getState().pactPrompt !== null) useEncounters.setState({ pactPrompt: null });
      return;
    }

    // Lapse stale offers a few times a second.
    tickClock.current -= dt;
    if (tickClock.current <= 0) {
      tickClock.current = 0.5;
      for (const id of Object.keys(useEncounters.getState().relations)) apply(id, { kind: "tick" });
    }

    // Nearest wizard within reach gets the prompt.
    let best: string | null = null;
    let bestD2 = PACT_RANGE * PACT_RANGE;
    for (const id of peerIds()) {
      const est = estimatePeer(id);
      if (!est) continue;
      const d2 =
        (est.p[0] - playerPosition.x) ** 2 +
        (est.p[1] - playerPosition.y) ** 2 +
        (est.p[2] - playerPosition.z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = id;
      }
    }
    const prompt = best
      ? pactPrompt(useEncounters.getState().relations[best], peerName(best) || "the wizard")
      : null;
    if (useEncounters.getState().pactPrompt !== prompt) useEncounters.setState({ pactPrompt: prompt });

    const pressed = input.consume("KeyF");
    if (pressed && best && state.overlay === "none" && document.pointerLockElement) {
      apply(best, { kind: "press" });
    }
  });

  return null;
}
