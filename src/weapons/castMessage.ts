import { BASIC_STAFF_ID, getItemDef } from "../items/catalog";
import type { DerivedStats } from "../items/types";
import { isSpellId } from "./spellCatalog";

/** The `p:cast` wire format: everything a floor-mate needs to replay our
 * cast through the identical spell code — WHAT (ability), WHERE (origin,
 * aim) and WITH WHAT (staff + the gear stats that shape a cast), so a replay
 * of a Keen Splinterstaff volley has the caster's color, bolt count and
 * damage — not a bare apprentice's.
 *
 * Peer messages are untrusted (anyone may send `p:`), and replays matter
 * beyond cosmetics — a hostile wizard's replayed volley is what hurts us —
 * so every received message goes through sanitizeCastMsg. Pure; unit-tested. */

/** The subset of DerivedStats that changes what a cast does. */
export type CastStats = Pick<DerivedStats, "damageMult" | "extraProjectiles" | "homing">;

export type Vec3Tuple = [number, number, number];

export interface CastMsg {
  abilityId: string;
  origin: Vec3Tuple;
  /** Unit aim direction. */
  dir: Vec3Tuple;
  /** Base staff def id (no affix) — its color tints the replayed spell. */
  staffId: string;
  stats: CastStats;
}

/** Plausible ranges for replayed gear stats. Generous against legit gear
 * stacking, but a hacked client can't send a 1000× volley. */
export const CAST_STAT_LIMITS = {
  damageMult: { min: 0, max: 8 },
  extraProjectiles: { min: 0, max: 4 },
  homing: { min: 0, max: 2 },
} as const;

/** What a replay assumes for a missing/garbled stat: bare-handed casting. */
export const NEUTRAL_CAST_STATS: Readonly<CastStats> = Object.freeze({
  damageMult: 1,
  extraProjectiles: 0,
  homing: 0,
});

interface XYZ {
  x: number;
  y: number;
  z: number;
}

/** Build the message for one of our casts (the inverse of sanitizeCastMsg). */
export function encodeCastMsg(
  abilityId: string,
  origin: XYZ,
  dir: XYZ,
  staffId: string,
  stats: CastStats,
): CastMsg {
  return {
    abilityId,
    origin: [origin.x, origin.y, origin.z],
    dir: [dir.x, dir.y, dir.z],
    staffId,
    stats: {
      damageMult: stats.damageMult,
      extraProjectiles: stats.extraProjectiles,
      homing: stats.homing,
    },
  };
}

/** Validate a received cast. Returns a clean copy, or null when the message
 * can't be replayed at all (unknown spell, non-finite or zero-length vectors).
 * Softer problems degrade instead of dropping the cast: an unknown staff
 * (e.g. from a newer client) replays as the Apprentice Staff, and each gear
 * stat is clamped into CAST_STAT_LIMITS (non-finite → neutral). */
export function sanitizeCastMsg(raw: unknown): CastMsg | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Partial<Record<keyof CastMsg, unknown>>;
  if (typeof m.abilityId !== "string" || !isSpellId(m.abilityId)) return null;
  const origin = finiteVec3(m.origin);
  const dir = finiteVec3(m.dir);
  if (!origin || !dir) return null;
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (!(len > 1e-6) || !Number.isFinite(len)) return null;
  return {
    abilityId: m.abilityId,
    origin,
    dir: [dir[0] / len, dir[1] / len, dir[2] / len],
    staffId: staffIdOrDefault(m.staffId),
    stats: sanitizeCastStats(m.stats),
  };
}

export function sanitizeCastStats(raw: unknown): CastStats {
  const s = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<
    Record<keyof CastStats, unknown>
  >;
  const L = CAST_STAT_LIMITS;
  return {
    damageMult: clampStat(s.damageMult, NEUTRAL_CAST_STATS.damageMult, L.damageMult),
    extraProjectiles: Math.round(
      clampStat(s.extraProjectiles, NEUTRAL_CAST_STATS.extraProjectiles, L.extraProjectiles),
    ),
    homing: clampStat(s.homing, NEUTRAL_CAST_STATS.homing, L.homing),
  };
}

function clampStat(v: unknown, neutral: number, range: { min: number; max: number }): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return neutral;
  return Math.min(range.max, Math.max(range.min, v));
}

function finiteVec3(v: unknown): Vec3Tuple | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const [x, y, z] = v as unknown[];
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof z !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z)
  ) {
    return null;
  }
  return [x, y, z];
}

/** A known staff's base id, else the Apprentice Staff. Accepts enchanted ids
 * ("ember_staff+keen") — the affix's stats already travel in `stats`. */
function staffIdOrDefault(v: unknown): string {
  if (typeof v !== "string") return BASIC_STAFF_ID;
  try {
    const def = getItemDef(v);
    return def.slot === "staff" ? def.id : BASIC_STAFF_ID;
  } catch {
    return BASIC_STAFF_ID;
  }
}
