import { GROUPS, PVP } from "../core/config";
import {
  ENEMY_SOURCE,
  WORLD_SOURCE,
  wizardSource,
  type DamageSource,
} from "../game/damageSource";

/** Who is on whose side — the pure rules every weapon asks before it hurts,
 * shoves or even touches the LOCAL wizard.
 *
 * One classification (`relationToLocal`) drives three decisions, so they can
 * never disagree about who is an enemy:
 *  - which Rapier groups a projectile flies with (PROJECTILE_GROUPS),
 *  - what a blast does to the local wizard (localBlastEffect),
 *  - whether a black hole tugs the local wizard (holePullsLocal).
 *
 * Every function takes the local wizard's id and the hostility check as
 * parameters (no store reads, no three.js), so the whole truth table is
 * unit-tested; call sites pass `localWizardId()` and `isHostileWizard`. */

/** Which side caused an effect. Decides who gets hurt: player magic hurts
 * enemies, enemy magic hurts wizards, neutral (barrels, traps) hurts all. */
export type DamageTeam = "player" | "enemy" | "neutral";

/** An effect's relationship to the local wizard:
 *  - own:     our magic (blast-jumps, never hurts us)
 *  - ally:    a floor-mate's magic while we're not hostile — co-op as before
 *  - hostile: a wizard whose spells may hurt us (pacts decide; see hostility.ts)
 *  - dungeon: monsters and the world itself (enemy/neutral team) */
export type LocalRelation = "own" | "ally" | "hostile" | "dungeon";

/** "May this other wizard's magic hurt me?" — `isHostileWizard` at runtime. */
export type HostilityCheck = (wizardId: string) => boolean;

export function relationToLocal(
  team: DamageTeam,
  source: DamageSource | undefined,
  localId: string,
  isHostile: HostilityCheck,
): LocalRelation {
  if (team !== "player") return "dungeon";
  // Player-team magic without a wizard source can only be our own (legacy
  // call sites, dev hooks) — treating it as ours keeps it harmless to us.
  if (source?.kind !== "wizard" || source.id === localId) return "own";
  return isHostile(source.id) ? "hostile" : "ally";
}

/** Who to blame when a caller didn't say: monsters for enemy-team effects,
 * the world for neutral ones (barrels, traps), ourselves for player magic. */
export function defaultSource(team: DamageTeam, localId: string): DamageSource {
  if (team === "enemy") return ENEMY_SOURCE;
  if (team === "neutral") return WORLD_SOURCE;
  return wizardSource(localId);
}

// ── Blasts ───────────────────────────────────────────────────────────────────

/** Share of a blast's impulse that shoves the local wizard. Hostile blasts
 * throw you around; friendly ones only nudge — enough to blast-jump off your
 * own Force Blast without allies' spells ruining your footing. */
export const STRONG_PUSH = 0.32;
export const GENTLE_PUSH = 0.16;

const BLAST_DAMAGE: Record<LocalRelation, number> = {
  dungeon: 1,
  // Duels are fights, not one-shots — decided on the victim's machine.
  hostile: PVP.damageMult,
  own: 0,
  ally: 0,
};

const BLAST_PUSH: Record<LocalRelation, number> = {
  dungeon: STRONG_PUSH,
  hostile: STRONG_PUSH,
  own: GENTLE_PUSH,
  ally: GENTLE_PUSH,
};

export interface BlastEffect {
  relation: LocalRelation;
  /** Multiplier on the blast's falloff damage (0 = harmless to us). */
  damageMult: number;
  /** Multiplier on the blast's falloff impulse applied to our capsule. */
  pushMult: number;
  /** Passed to takeDamage so deaths name their killer. */
  source: DamageSource;
}

/** What a blast inside our radius does to the local wizard. Explosions run on
 * every machine (the caster's real one, everyone else's replay), and each
 * victim applies this to themselves — so every wizard is hurt exactly once,
 * by their own copy, and never by their own or an ally's magic. */
export function localBlastEffect(
  team: DamageTeam,
  source: DamageSource | undefined,
  localId: string,
  isHostile: HostilityCheck,
): BlastEffect {
  const relation = relationToLocal(team, source, localId, isHostile);
  return {
    relation,
    damageMult: BLAST_DAMAGE[relation],
    pushMult: BLAST_PUSH[relation],
    source: source ?? defaultSource(team, localId),
  };
}

// ── Black holes ──────────────────────────────────────────────────────────────

/** Does a black hole tug the local wizard? Our own holes do (stand too close
 * and your own well grabs you) and so do hostile wizards' — pulling a rival
 * into the implosion is the point. An ally's hole leaves us alone. */
export function holePullsLocal(
  team: DamageTeam,
  source: DamageSource | undefined,
  localId: string,
  isHostile: HostilityCheck,
): boolean {
  return relationToLocal(team, source, localId, isHostile) !== "ally";
}

// ── Projectile collision groups ──────────────────────────────────────────────

export interface ProjectileGroups {
  membership: readonly number[];
  filter: readonly number[];
}

/** Rapier groups per relation (see GROUPS in core/config.ts):
 *  - own: our bolts also burst on HOSTILE peers' capsules (PEER_HOSTILE) —
 *    the damage itself is decided by the victim's replay of the same bolt.
 *  - ally: a floor-mate's replayed bolt, exactly as in co-op.
 *  - hostile: a hostile floor-mate's replayed bolt bursts on US
 *    (LOCAL_PLAYER), never on peer capsules (so never on its own caster).
 *    It is ALSO a FRIENDLY_PROJECTILE member: Rapier needs both sides to
 *    accept a contact, and the dungeon's walls, props and enemies already
 *    accept friendly projectiles — so hostile spells collide with the world
 *    without every static collider having to list HOSTILE_SPELL. Its filter
 *    is what keeps it off peer capsules.
 *  - dungeon: enemy/trap bolts hit any wizard (PLAYER), as before. */
export const PROJECTILE_GROUPS: Readonly<Record<LocalRelation, ProjectileGroups>> = {
  own: {
    membership: [GROUPS.FRIENDLY_PROJECTILE],
    filter: [GROUPS.WORLD, GROUPS.ENEMY, GROUPS.PROP, GROUPS.PEER_HOSTILE],
  },
  ally: {
    membership: [GROUPS.FRIENDLY_PROJECTILE],
    filter: [GROUPS.WORLD, GROUPS.ENEMY, GROUPS.PROP],
  },
  hostile: {
    membership: [GROUPS.FRIENDLY_PROJECTILE, GROUPS.HOSTILE_SPELL],
    filter: [GROUPS.WORLD, GROUPS.ENEMY, GROUPS.PROP, GROUPS.LOCAL_PLAYER],
  },
  dungeon: {
    membership: [GROUPS.ENEMY_PROJECTILE],
    filter: [GROUPS.WORLD, GROUPS.PLAYER, GROUPS.PROP],
  },
};
