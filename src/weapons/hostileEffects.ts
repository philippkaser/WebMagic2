import { gameEvents } from "../core/events";
import { ENEMY_SOURCE, WORLD_SOURCE, wizardSource, type DamageSource } from "../game/damageSource";
import { getPlayerBody } from "../game/player-state";
import { hostEvent, onAuthority } from "../net/channels";
import { FLOOR, type VitalsMsg, type WizardHitMsg, type YouFellMsg } from "../net/floorProtocol";
import { useGame } from "../state/gameStore";
import type { BoomData, CastData } from "../sim/world";
import { explode } from "./explosions";
import { fireProjectile } from "./projectiles";

/** Authoritative combat effects (enemy shots, boss slams, trap darts) as host
 * events.
 *
 * One handler covers every machine: on the host (`meta.self`) the effect is
 * real and damages entities; on replicas it replays cosmetically vs entities
 * (host authority — nothing is double-counted) while still hurting and
 * shoving the LOCAL player, so your survival never waits on a round trip. */

/** Who a dungeon effect is blamed on when it hurts a wizard: a monster
 * ("enemy", the default) or the dungeon itself ("world" — traps). Sent as a
 * tag rather than a DamageSource so the wire stays a closed, tiny vocabulary. */
export type DungeonSourceTag = "enemy" | "world";

function dungeonSource(tag: DungeonSourceTag | undefined): DamageSource {
  return tag === "world" ? WORLD_SOURCE : ENEMY_SOURCE;
}

/** An enemy bolt — the sim's CastData (sim/world.ts), trap darts included. */
export type EnemyCastData = CastData;

export const enemyCast = hostEvent<EnemyCastData>(FLOOR.enemyCast, (d, meta) => {
  fireProjectile({
    team: "enemy",
    source: dungeonSource(d.source),
    position: d.origin,
    velocity: d.velocity,
    damage: d.damage,
    color: d.color,
    size: d.size,
    blastRadius: d.blastRadius,
    blastImpulse: d.blastImpulse,
    cosmetic: !meta.self,
  });
});

export type { BoomData };

// ── Duels a server host decides ───────────────────────────────────────────────

/** Another wizard's spell hurt us — the server's copy of it, judged as its
 * caster saw us (lag compensation). The hit's feel (sound, shake, who to
 * credit) and the shove are ours; the health it cost comes with the
 * server's vitals (takeDamage counts nothing on a floor the server hosts). */
onAuthority<WizardHitMsg>(FLOOR.wizardHit, (d) => {
  const i = d?.impulse;
  if (typeof d?.by !== "string" || !(d.damage >= 0) || !Array.isArray(i) || !i.every(Number.isFinite)) return;
  useGame.getState().takeDamage(d.damage, wizardSource(d.by));
  getPlayerBody()?.applyImpulse({ x: i[0], y: i[1], z: i[2] }, true);
  gameEvents.emit("shake", Math.min(Math.hypot(i[0], i[1], i[2]) / 12, 1));
});

/** Our health and mana as the server keeps them, on a floor it hosts:
 * what our bar shows there. */
onAuthority<VitalsMsg>(FLOOR.vitals, (d) => {
  if (!Number.isFinite(d?.hp)) return;
  useGame.getState().applyVitals({ hp: d.hp, mana: Number.isFinite(d.mana) ? d.mana : NaN });
});

/** The server's count of our health reached zero: fall — credited to the
 * wizard who brought it there, or to the dungeon. */
onAuthority<YouFellMsg>(FLOOR.youFell, (d) => {
  useGame.getState().fallByServer(typeof d?.killer === "string" ? d.killer : null);
});

export const enemyBoom = hostEvent<BoomData>(FLOOR.enemyBoom, (d, meta) => {
  explode({
    position: d.pos,
    radius: d.radius,
    damage: d.damage,
    impulse: d.impulse,
    team: "enemy",
    source: dungeonSource(d.source),
    color: d.color,
    particles: 50,
    light: 50,
    remote: !meta.self,
  });
});
