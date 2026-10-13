import { foldPassives } from "./stats";
import type { BuffId, DerivedStats, Passives } from "./types";

/** Timed blessings — what an elixir (or a shrine) lays on a wizard for a
 * while. Pure data plus the fold into derived stats; the store keeps the
 * active list (id + when it ends) and getStats() folds them over the gear's
 * stats, so every system that reads stats sees a blessing at once. */

export interface BuffDef {
  id: BuffId;
  name: string;
  /** Seconds a draught lasts. */
  seconds: number;
  color: string;
  passives: Partial<Passives>;
  /** The bargain in words, gift first ("+40% damage · −30 max health"). */
  terms?: string;
}

const defs: BuffDef[] = [
  { id: "haste", name: "Haste", seconds: 30, color: "#ffe36a", passives: { fireRateMult: 1.3, speedMult: 1.15 } },
  { id: "ironskin", name: "Ironskin", seconds: 30, color: "#a8b4c8", passives: { damageTakenMult: 0.6 } },
  { id: "fury", name: "Fury", seconds: 30, color: "#ff6a3d", passives: { damageMult: 1.35 } },
  { id: "clarity", name: "Clarity", seconds: 25, color: "#8ff0ff", passives: { manaCostMult: 0.5 } },
  { id: "swiftness", name: "Swiftness", seconds: 20, color: "#a8ffe3", passives: { speedMult: 1.25 } },
  // Shrine bargains: long, strong, and each takes something back.
  { id: "blood_oath", name: "Oath of Blood", seconds: 150, color: "#ff3b3b", passives: { damageMult: 1.4, maxHealth: -30 }, terms: "+40% damage · −30 max health" },
  { id: "glass_hour", name: "The Glass Hour", seconds: 150, color: "#c8f4ff", passives: { fireRateMult: 1.35, damageTakenMult: 1.25 }, terms: "+35% cast speed · take 25% more harm" },
  { id: "wellspring", name: "Wellspring", seconds: 150, color: "#5db9ff", passives: { manaRegenMult: 2, speedMult: 0.85 }, terms: "double mana flow · 15% slower" },
  { id: "storm_pact", name: "Storm Pact", seconds: 150, color: "#9fd8ff", passives: { chain: 1, manaCostMult: 1.4 }, terms: "every hit arcs on · spells cost 40% more" },
  { id: "ricochet_rite", name: "Ricochet Rite", seconds: 150, color: "#ffd27a", passives: { bounces: 2, damageMult: 0.85 }, terms: "bolts bounce twice more · 15% less damage" },
];

const byId = new Map(defs.map((d) => [d.id, d]));

export function getBuffDef(id: BuffId): BuffDef {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown buff: ${id}`);
  return def;
}

export function isBuffId(id: string): id is BuffId {
  return byId.has(id as BuffId);
}

/** An active blessing: which, and when it runs out (ms, the caller's clock). */
export interface ActiveBuff {
  id: BuffId;
  until: number;
}

/** Re-drinking refreshes rather than stacks: the later end wins. */
export function addBuff(active: readonly ActiveBuff[], id: BuffId, now: number): ActiveBuff[] {
  const until = now + getBuffDef(id).seconds * 1000;
  const rest = active.filter((b) => b.id !== id);
  const prev = active.find((b) => b.id === id);
  return [...rest, { id, until: Math.max(until, prev?.until ?? 0) }];
}

export function liveBuffs(active: readonly ActiveBuff[], now: number): ActiveBuff[] {
  return active.filter((b) => b.until > now);
}

/** Fold blessings (and any extra passive blocks, e.g. a shrine's) over a
 * stat block. Returns a new block. */
export function withBlessings(
  stats: DerivedStats,
  active: readonly ActiveBuff[],
  now: number,
  extra: readonly Partial<Passives>[] = [],
): DerivedStats {
  const live = liveBuffs(active, now);
  if (live.length === 0 && extra.length === 0) return stats;
  const out: DerivedStats = { ...stats, procs: [...stats.procs] };
  for (const b of live) foldPassives(out, getBuffDef(b.id).passives);
  for (const block of extra) foldPassives(out, block);
  return out;
}
