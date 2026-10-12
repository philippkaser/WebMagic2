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

/** The subset of DerivedStats that changes what a cast does (and so what a
 * floor-mate must replay: a ricocheting volley must ricochet for them too). */
export type CastStats = Pick<
  DerivedStats,
  | "damageMult"
  | "extraProjectiles"
  | "homing"
  | "bounces"
  | "pierce"
  | "splitShards"
  | "blastRadiusMult"
  | "projectileSpeedMult"
  | "chain"
  | "knockbackMult"
>;

const CAST_STAT_KEYS = [
  "damageMult",
  "extraProjectiles",
  "homing",
  "bounces",
  "pierce",
  "splitShards",
  "blastRadiusMult",
  "projectileSpeedMult",
  "chain",
  "knockbackMult",
] as const satisfies readonly (keyof CastStats)[];

/** Whole-number stats (counts) are rounded after clamping. */
const INTEGER_STATS = new Set<keyof CastStats>(["extraProjectiles", "bounces", "pierce", "splitShards", "chain"]);

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
export const CAST_STAT_LIMITS: Readonly<Record<keyof CastStats, { min: number; max: number }>> = {
  // Deep staffs alone reach ~9× (items/power.ts staffPotency at level 120)
  // before amulets, affixes, the forge and elixirs; the ceiling sits above
  // every legit build.
  damageMult: { min: 0, max: 24 },
  extraProjectiles: { min: 0, max: 4 },
  homing: { min: 0, max: 2 },
  bounces: { min: 0, max: 6 },
  pierce: { min: 0, max: 6 },
  splitShards: { min: 0, max: 8 },
  blastRadiusMult: { min: 0.3, max: 4 },
  projectileSpeedMult: { min: 0.3, max: 4 },
  chain: { min: 0, max: 6 },
  knockbackMult: { min: 0, max: 4 },
};

/** What a replay assumes for a missing/garbled stat: bare-handed casting. */
export const NEUTRAL_CAST_STATS: Readonly<CastStats> = Object.freeze({
  damageMult: 1,
  extraProjectiles: 0,
  homing: 0,
  bounces: 0,
  pierce: 0,
  splitShards: 0,
  blastRadiusMult: 1,
  projectileSpeedMult: 1,
  chain: 0,
  knockbackMult: 1,
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
    stats: pickCastStats(stats),
  };
}

/** Just the cast-shaping stats of a full stat block. */
export function pickCastStats(stats: CastStats): CastStats {
  const out = {} as CastStats;
  for (const k of CAST_STAT_KEYS) out[k] = stats[k];
  return out;
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
  const out = {} as CastStats;
  for (const k of CAST_STAT_KEYS) {
    const v = clampStat(s[k], NEUTRAL_CAST_STATS[k], CAST_STAT_LIMITS[k]);
    out[k] = INTEGER_STATS.has(k) ? Math.round(v) : v;
  }
  return out;
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
