import { playThunder } from "../audio/spellSounds";
import { gameEvents } from "../core/events";
import { playerPosition } from "../game/player-state";
import { explode } from "./explosions";
import { flashLight } from "../fx/DynamicLights";
import { stormStrikeFx } from "../fx/spellFx";
import { wizardSource } from "../game/damageSource";
import { forEachHittable, type Hittable } from "../game/registry";
import { hasProc } from "../items/catalog";
import { peerMessage } from "../net/channels";
import { getStats, useGame } from "../state/gameStore";
import { localWizardId } from "./localWizard";
import { fireProjectile } from "./projectiles";

/** What happens when YOUR magic lands — lifesteal and the legendaries'
 * on-hit powers. Every local hit on a creature (blast falloff, beam tick,
 * lightning leap, flame lick, piercing pass) reports here once with the
 * damage it dealt; nothing here runs for replays (a floor-mate's procs run
 * on their own machine, and their effects reach us as peer messages).
 *
 * Powers are rolled with an internal cooldown so a beam ticking 12 times a
 * second can't call 12 storms. Hits made BY a power never report (no
 * storms calling storms). */

interface V {
  x: number;
  y: number;
  z: number;
}

const STORM = { chance: 0.16, cooldownMs: 700, damage: 30, radius: 9, color: "#9fe8ff" } as const;
const SHARDS = { chance: 0.22, cooldownMs: 450, count: 3, damage: 9, color: "#b8a6ff" } as const;

let nextStorm = 0;
let nextShards = 0;
/** Lifesteal accumulates and flushes in chunks (a beam heals ~a dozen times
 * a second; the store needn't re-render each time). */
let stolen = 0;

/** A cosmetic replay of a floor-mate's power, so everyone sees the storm. */
const procFx = peerMessage<{ kind: "storm" | "shards"; at: [number, number, number]; dir?: [number, number, number][] }>(
  "procFx",
  (d, meta) => {
    if (!Array.isArray(d?.at) || d.at.length !== 3 || !d.at.every(Number.isFinite)) return;
    const at = { x: d.at[0], y: d.at[1], z: d.at[2] };
    if (d.kind === "storm") strikeFx(at);
    else if (d.kind === "shards" && Array.isArray(d.dir)) {
      for (const v of d.dir.slice(0, 6)) {
        if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) continue;
        fireShard(at, v as [number, number, number], 0, meta.from);
      }
    }
  },
);

/** Report damage our own magic just dealt to a creature at `at`. */
export function reportLocalHit(at: V, damage: number): void {
  if (!(damage > 0)) return;
  const stats = getStats();
  if (stats.lifesteal > 0) {
    stolen += damage * stats.lifesteal;
    if (stolen >= 1) {
      useGame.getState().heal(Math.floor(stolen));
      stolen -= Math.floor(stolen);
    }
  }
  if (stats.procs.length === 0) return;
  const now = performance.now();
  if (hasProc(stats, "stormcall") && now >= nextStorm && Math.random() < STORM.chance) {
    nextStorm = now + STORM.cooldownMs;
    const target = randomEnemyNear(at, STORM.radius);
    if (target) {
      const p = target.getPosition();
      const strikeAt = { x: p.x, y: p.y, z: p.z };
      // A beat after the hit, the sky answers.
      setTimeout(() => {
        strikeFx(strikeAt);
        procFx.send({ kind: "storm", at: [strikeAt.x, strikeAt.y, strikeAt.z] });
        target.hit(STORM.damage * getStats().damageMult, { x: 0, y: -4, z: 0 });
      }, 120);
    }
  }
  if (hasProc(stats, "soulshards") && now >= nextShards && Math.random() < SHARDS.chance) {
    nextShards = now + SHARDS.cooldownMs;
    const origin = { x: at.x, y: at.y + 0.4, z: at.z };
    const dirs: [number, number, number][] = [];
    for (let i = 0; i < SHARDS.count; i++) {
      const a = Math.random() * Math.PI * 2;
      dirs.push([Math.cos(a) * 0.7, 0.7, Math.sin(a) * 0.7]);
    }
    for (const d of dirs) fireShard(origin, d, SHARDS.damage * stats.damageMult, null);
    procFx.send({ kind: "shards", at: [origin.x, origin.y, origin.z], dir: dirs });
  }
}

function strikeFx(at: V): void {
  stormStrikeFx(at, STORM.color);
  flashLight([at.x, at.y + 1, at.z], STORM.color, 40, 14);
  playThunder([at.x, at.y, at.z]);
}

/** `replayOf`: the floor-mate whose power this is (a cosmetic copy), or null
 * for our own. */
function fireShard(at: V, dir: [number, number, number], damage: number, replayOf: string | null): void {
  const speed = 13;
  const cosmetic = replayOf !== null;
  fireProjectile({
    team: "player",
    source: wizardSource(replayOf ?? localWizardId()),
    position: [at.x, at.y, at.z],
    velocity: [dir[0] * speed, dir[1] * speed, dir[2] * speed],
    damage,
    color: SHARDS.color,
    size: 0.08,
    blastRadius: 1.2,
    blastImpulse: 6,
    homing: 1.6,
    cosmetic,
    noProc: true,
  });
}

function randomEnemyNear(at: V, radius: number): Hittable | null {
  const near: Hittable[] = [];
  forEachHittable((h) => {
    if (h.team !== "enemy") return;
    const p = h.getPosition();
    if ((p.x - at.x) ** 2 + (p.y - at.y) ** 2 + (p.z - at.z) ** 2 <= radius * radius) near.push(h);
  });
  return near.length > 0 ? near[Math.floor(Math.random() * near.length)]! : null;
}

// Heart of the Phoenix: the refused death bursts out of you as flame —
// your own magic, so it burns what's round you and only lifts you.
gameEvents.on("phoenix", () => {
  explode({
    position: [playerPosition.x, playerPosition.y, playerPosition.z],
    radius: 5.5,
    damage: 60 * getStats().damageMult,
    impulse: 34,
    team: "player",
    source: wizardSource(localWizardId()),
    color: "#ff8a3d",
    particles: 70,
    light: 70,
    noProc: true,
  });
  gameEvents.emit("shake", 0.8);
});
