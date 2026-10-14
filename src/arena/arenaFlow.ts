import { playPickup } from "../audio/sound";
import { PLAYER } from "../core/config";
import { gameEvents } from "../core/events";
import { flashLight } from "../fx/DynamicLights";
import { soulDissolveFx, soulRiseFx } from "../fx/effects";
import { getPlayerBody, playerPosition } from "../game/player-state";
import { netBus } from "../net/bus";
import { useNet } from "../net/netStore";
import { estimatePeer, peerIds, resetPeers } from "../net/players";
import { session } from "../net/session";
import { getStats, setFallRule, useGame } from "../state/gameStore";
import { toWireInventory } from "../state/persistence";
import { travel } from "../transition/travel";
import { getCurrentLayout } from "../world/currentFloor";
import type { Vec3 } from "../world/types";
import { inArena, isFallen, leaveBout, useArena } from "./arenaStore";
import type { ArenaLayout } from "./layout";
import { pickSpawn } from "./layout";
import { ARENA } from "./rules";

/** The Proving Ground's journeys and its one rule of the body: dealt into a
 * bout, the obelisk takes you there (wherever you stand in the camp); in
 * the hall you never die — you YIELD, the one who struck last takes it,
 * and a few breaths later you rise at the spawn stone farthest from every
 * foe; when the bout is over, Varr reads the board and the hall sends you
 * home. Nothing is lost here: no grave, no run, nothing carried is at risk
 * (draughts drunk in the hall are drunk, though). */

/** Varr's ember-gold: the yield's dust, the rising's light. */
export const VARR_GOLD = "#ff9a3c";

let riseTimer: ReturnType<typeof setTimeout> | null = null;
let homeTimer: ReturnType<typeof setTimeout> | null = null;

function clearTimers(): void {
  if (riseTimer) clearTimeout(riseTimer);
  if (homeTimer) clearTimeout(homeTimer);
  riseTimer = homeTimer = null;
}

// ── In ───────────────────────────────────────────────────────────────────────

netBus.on("arenaAssigned", (a) => {
  clearTimers();
  // A fresh hall: nobody's pose from the camp carries over.
  resetPeers();
  useGame.setState({ phase: "loading", prompt: null, overlay: "none" });
  void travel("arena", () => {
    useGame.setState({
      phase: "dungeon",
      floor: 0,
      floorSeed: a.seed,
      instanceId: a.instanceId,
      run: null,
      health: getStats().maxHealth,
      mana: PLAYER.maxMana,
      prompt: null,
      overlay: "none",
    });
    const foes = a.members.filter((m) => m.id !== useNet.getState().playerId).map((m) => m.name);
    gameEvents.emit("message", `The Proving Ground — you face ${listOf(foes)}. To the yield!`);
  });
});

/** Where this wizard first stands: their own stone, dealt in member order. */
export function startingStone(layout: ArenaLayout): Vec3 {
  const bout = useArena.getState().bout;
  const me = useNet.getState().playerId;
  const i = Math.max(0, bout?.members.findIndex((m) => m.id === me) ?? 0);
  return layout.spawns[i % layout.spawns.length]!;
}

// ── The yield ────────────────────────────────────────────────────────────────

// In the hall a killing blow is a yield, never a death.
setFallRule((killerId) => {
  const bout = useArena.getState().bout;
  if (!bout) return false;
  if (useGame.getState().phase !== "dungeon") return true;
  const me = useNet.getState().playerId;
  const by = killerId && killerId !== me && bout.members.some((m) => m.id === killerId) ? killerId : null;
  if (!bout.ended) session.arenaFell(by);
  // Down at once (no input, no casting, no more harm) while the hall holds
  // its breath; the server's score marks us fallen for everyone.
  useGame.setState({ phase: "loading", prompt: null, overlay: "none" });
  useArena.setState({ bout: { ...bout, fallen: { ...bout.fallen, [me]: performance.now() + ARENA.respawnMs } } });
  soulDissolveFx(playerPosition, VARR_GOLD, 1.2);
  flashLight([playerPosition.x, playerPosition.y, playerPosition.z], VARR_GOLD, 14, 6);
  if (riseTimer) clearTimeout(riseTimer);
  riseTimer = setTimeout(rise, ARENA.respawnMs);
  return true;
});

function rise(): void {
  riseTimer = null;
  const layout = getCurrentLayout() as ArenaLayout | null;
  if (!inArena() || !layout?.spawns) return;
  const foes: Vec3[] = [];
  for (const id of peerIds()) {
    const p = estimatePeer(id);
    if (p && !isFallen(id)) foes.push([p.p[0], p.p[1], p.p[2]]);
  }
  const at = pickSpawn(layout.spawns, foes);
  const body = getPlayerBody() as unknown as {
    setTranslation(v: { x: number; y: number; z: number }, wake: boolean): void;
    setLinvel(v: { x: number; y: number; z: number }, wake: boolean): void;
  } | null;
  body?.setTranslation({ x: at[0], y: at[1], z: at[2] }, true);
  body?.setLinvel({ x: 0, y: 0, z: 0 }, true);
  useGame.setState({ phase: "dungeon", health: getStats().maxHealth, mana: PLAYER.maxMana });
  soulRiseFx([at[0], at[1] - 0.6, at[2]], VARR_GOLD, 26);
  flashLight(at, VARR_GOLD, 22, 8);
  playPickup();
}

// What everyone sees of a fall: the fallen dissolve where they stood, and
// whoever took the yield hears it.
netBus.on("arenaScore", ({ fell }) => {
  const me = useNet.getState().playerId;
  const bout = useArena.getState().bout;
  if (!bout) return;
  const name = (id: string | null) => (id ? (bout.members.find((m) => m.id === id)?.name ?? "a wizard") : null);
  if (fell.victim !== me) {
    const p = estimatePeer(fell.victim);
    if (p) soulDissolveFx(p.p, VARR_GOLD, 1.2);
  }
  if (fell.by === me) {
    gameEvents.emit("arenaYield", { victim: fell.victim, name: name(fell.victim) ?? "a wizard" });
  } else if (fell.victim === me) {
    gameEvents.emit("message", fell.by ? `You yield to ${name(fell.by)}` : "You yield to the hall");
  } else {
    gameEvents.emit("message", fell.by ? `${name(fell.victim)} yields to ${name(fell.by)}` : `${name(fell.victim)} yields`);
  }
});

// ── Out ──────────────────────────────────────────────────────────────────────

netBus.on("arenaEnded", ({ winner }) => {
  const me = useNet.getState().playerId;
  const bout = useArena.getState().bout;
  const name = winner ? (bout?.members.find((m) => m.id === winner)?.name ?? "a wizard") : null;
  gameEvents.emit("message", winner === me ? "The hall is yours!" : name ? `${name} takes the hall` : "Nobody took a yield — the hall keeps its own counsel");
  if (homeTimer) clearTimeout(homeTimer);
  homeTimer = setTimeout(goHome, ARENA.afterMs);
});

// A dropped connection loses the bout (the server has already seated us
// back in the camp).
netBus.on("reconnected", () => {
  if (inArena()) void goHome();
});

/** Home from the Proving Ground, through the tunnel. */
export async function goHome(): Promise<void> {
  clearTimers();
  if (!inArena()) return;
  useGame.setState({ phase: "loading", prompt: null, overlay: "none" });
  await travel("home", () => {
    leaveBout();
    const state = useGame.getState();
    useGame.setState({
      phase: "village",
      floor: 0,
      health: getStats().maxHealth,
      mana: PLAYER.maxMana,
      prompt: null,
      overlay: "none",
    });
    // What was drunk in the hall is drunk: the bank hears of it (a
    // rearrangement it checks, never anything new).
    session.sendStash(toWireInventory(state));
  });
}

function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "the hall";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
