import { Rng } from "../core/rng";
import type { FloorRules } from "../game/floorRules";
import { STREAM_SALT, streamSeed } from "./gen/seeds";
import type { OmenId } from "./types";

/** Omens as pure data — the dungeon's moods. Some floors arrive in a mood
 * that bends the usual numbers: gravity slackens, torches gutter, monsters
 * turn savage and hoards spill open. An omen has two halves:
 *
 * - `rules`: runtime multipliers, installed through game/floorRules while the
 *   floor is live (the systems that care read them there).
 * - `gen`: generation knobs the floor generator (and, for fog, the renderer)
 *   reads — so a lightless floor really has fewer torches for everyone.
 *
 * The roll comes from its own seeded stream, so every wizard sharing a floor
 * instance agrees on the mood, and rolling it never perturbs the layout. */

export interface OmenGenMods {
  /** Scales how many torches the floor gets (never fewer than 2). */
  torchMult?: number;
  /** Scales fog distances (renderer): below 1 the dark closes in. */
  fogMult?: number;
  /** Added to the barrel share of props. */
  barrelBias?: number;
  /** Scales the floor's enemy budget. */
  enemyCountMult?: number;
}

export interface OmenDef {
  id: OmenId;
  name: string;
  /** Shown on arrival. Mystical, one breath, at most 90 characters. */
  whisper: string;
  /** Relative weight among the omens eligible at a depth. */
  weight: number;
  /** Shallowest floor the omen can appear on. */
  minFloor: number;
  rules: Partial<FloorRules>;
  gen: OmenGenMods;
}

/** Share of floors (from floor 2 down) that arrive under an omen. Rare enough
 * to feel like an event, common enough that a run meets a few. */
export const OMEN_CHANCE = 0.28;
/** Floor 1 is always calm: a wizard's first steps shouldn't be a mood. */
const FIRST_OMEN_FLOOR = 2;

export const OMEN_DEFS: readonly OmenDef[] = [
  {
    id: "weightless",
    name: "The Weightless Hour",
    whisper: "The deep forgets its own weight. Step lightly — the stones are listening.",
    weight: 1,
    minFloor: 2,
    rules: { gravityMult: 0.42 },
    gen: {},
  },
  {
    id: "manatide",
    name: "The Manatide",
    whisper: "The old wells run over. Power rises in you like the sea through a drowned hall.",
    weight: 1,
    minFloor: 2,
    rules: { manaRegenMult: 2.2 },
    gen: {},
  },
  {
    id: "lightless",
    name: "The Lightless Vigil",
    whisper: "Something has drunk the torchlight. What remains burns low, and afraid.",
    weight: 1,
    minFloor: 3,
    rules: {},
    gen: { torchMult: 0.35, fogMult: 0.55 },
  },
  {
    id: "volatile",
    name: "The Volatile Air",
    whisper: "The air tastes of pitch and sparks. Mind the barrels. Mind your breath.",
    weight: 1,
    minFloor: 3,
    rules: { explosionRadiusMult: 1.35 },
    gen: { barrelBias: 0.35 },
  },
  {
    id: "teeming",
    name: "The Teeming Dark",
    whisper: "The walls crawl. Many have woken — thin of blood, and very many.",
    weight: 0.9,
    minFloor: 4,
    rules: { enemyHealthMult: 0.75 },
    gen: { enemyCountMult: 1.5 },
  },
  {
    id: "crimson",
    name: "The Crimson Omen",
    whisper: "Blood on the air. The deep's children are savage tonight, and its hoards lie open.",
    weight: 0.8,
    minFloor: 6,
    rules: { enemyDamageMult: 1.25, enemySpeedMult: 1.2, lootChanceMult: 1.7, goldMult: 1.5 },
    gen: {},
  },
];

const byId = new Map(OMEN_DEFS.map((d) => [d.id, d]));

export function getOmenDef(id: OmenId): OmenDef {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown omen id: ${id}`);
  return def;
}

/** The omen (if any) hanging over a floor instance. Pure and deterministic,
 * on a stream of its own: the generator calls it before laying out the floor,
 * and anything else (HUD, renderer) may call it again and get the same answer. */
export function rollOmen(seed: number, floor: number): OmenId | null {
  if (floor < FIRST_OMEN_FLOOR) return null;
  const rng = new Rng(streamSeed(seed, floor, STREAM_SALT.omen));
  if (!rng.chance(OMEN_CHANCE)) return null;
  const eligible = OMEN_DEFS.filter((o) => floor >= o.minFloor);
  const total = eligible.reduce((s, o) => s + o.weight, 0);
  let r = rng.next() * total;
  for (const o of eligible) {
    r -= o.weight;
    if (r <= 0) return o.id;
  }
  return eligible[0]?.id ?? null;
}

/** The FloorRules overrides an omen imposes — `{}` for a calm floor, ready
 * for setFloorRules(). A fresh object, so callers can't mutate the table. */
export function omenRules(id: OmenId | null): Partial<FloorRules> {
  return id ? { ...getOmenDef(id).rules } : {};
}

/** An omen's generation knobs with every default filled in (1× / +0), so the
 * generator and renderer never branch on a missing field. */
export function omenGenMods(id: OmenId | null): Required<OmenGenMods> {
  const gen = id ? getOmenDef(id).gen : {};
  return {
    torchMult: gen.torchMult ?? 1,
    fogMult: gen.fogMult ?? 1,
    barrelBias: gen.barrelBias ?? 0,
    enemyCountMult: gen.enemyCountMult ?? 1,
  };
}
