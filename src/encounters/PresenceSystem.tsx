import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { playHeartbeat, playPresence } from "../audio/sound";
import { gameEvents } from "../core/events";
import { playerPosition } from "../game/player-state";
import { isHostileWizard } from "../game/hostility";
import { netBus } from "../net/bus";
import { useNet } from "../net/netStore";
import { estimatePeer, peerIds } from "../net/players";
import { useGame } from "../state/gameStore";
import { useEncounters } from "./encounterStore";

/** The sense of not being alone — the "keep them on edge" layer.
 *
 * Wizards who share a floor are not announced by name or shown on any map.
 * You learn only that SOMEONE is here (a low swell when they arrive), and
 * then, as a hostile wizard closes in, you hear your own heartbeat quicken.
 * Their name only appears over their head once they're close enough to see
 * (game/wizardLook.ts NAME_RANGE). A sworn ally's approach is silent. */

/** A hostile wizard inside this range makes your heart race. */
const HEARTBEAT_RANGE = 24;

// Arrivals: only "someone", never who.
netBus.on("peerJoined", () => {
  if (useGame.getState().phase !== "dungeon") return;
  playPresence();
  gameEvents.emit("message", "A presence stirs. Another wizard walks this floor.");
});
netBus.on("peerLeft", ({ playerId, name }) => {
  if (useGame.getState().phase !== "dungeon") return;
  // An ally's departure has a name; a stranger's is just a fading.
  const ally = !isHostileWizard(playerId) && name;
  gameEvents.emit("message", ally ? `${name} has left the floor.` : "The presence fades.");
});
netBus.on("assigned", (a) => {
  if (a.members.length <= 1) return;
  // We walked into someone else's floor. Let the load settle first.
  setTimeout(() => {
    playPresence();
    gameEvents.emit("message", "This floor is not empty. Someone else is down here.");
  }, 1200);
});

export function PresenceSystem() {
  const sampleClock = useRef(0);
  const beatClock = useRef(0);
  const hostileDist = useRef<number | null>(null);

  useFrame((_, dt) => {
    const inDungeon = useGame.getState().phase === "dungeon" && useNet.getState().mode === "online";
    sampleClock.current -= dt;
    if (sampleClock.current <= 0) {
      sampleClock.current = 0.25;
      let others = 0;
      let nearest: number | null = null;
      let nearestHostile: number | null = null;
      if (inDungeon) {
        for (const id of peerIds()) {
          const est = estimatePeer(id);
          if (!est) continue;
          others++;
          const d = Math.hypot(
            est.p[0] - playerPosition.x,
            est.p[1] - playerPosition.y,
            est.p[2] - playerPosition.z,
          );
          if (nearest === null || d < nearest) nearest = d;
          if (isHostileWizard(id) && (nearestHostile === null || d < nearestHostile)) nearestHostile = d;
        }
      }
      hostileDist.current = nearestHostile;
      const q = (d: number | null) => (d === null ? null : Math.round(d));
      const s = useEncounters.getState();
      if (s.others !== others || s.nearest !== q(nearest) || s.nearestHostile !== q(nearestHostile)) {
        useEncounters.setState({ others, nearest: q(nearest), nearestHostile: q(nearestHostile) });
      }
    }

    // Heartbeat: quickens and hardens as a hostile wizard closes in.
    const d = hostileDist.current;
    beatClock.current -= dt;
    if (inDungeon && d !== null && d < HEARTBEAT_RANGE && beatClock.current <= 0) {
      const closeness = 1 - d / HEARTBEAT_RANGE; // 0 at the edge, 1 face to face
      beatClock.current = 1.5 - closeness * 1.05;
      playHeartbeat(closeness);
    }
  });

  return null;
}
