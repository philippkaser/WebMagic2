import type { Rng } from "../core/rng";
import type { EnemyKind } from "../world/types";

/** Which enemies haunt which depths. Pure data + a weighted pick, consumed by
 * the (deterministic) floor generator — so it must only use the given rng. */
interface SpawnRow {
  kind: EnemyKind;
  minFloor: number;
  maxFloor?: number;
  weight: number;
  /** Spawn height above the floor. */
  y: number;
}

export const SPAWN_TABLE: readonly SpawnRow[] = [
  { kind: "wisp", minFloor: 1, weight: 78, y: 1.6 },
  { kind: "sentry", minFloor: 2, weight: 22, y: 0.9 },
];

export function pickEnemy(floor: number, rng: Rng): SpawnRow {
  const rows = SPAWN_TABLE.filter((r) => floor >= r.minFloor && floor <= (r.maxFloor ?? Infinity));
  const total = rows.reduce((s, r) => s + r.weight, 0);
  let roll = rng.next() * total;
  for (const row of rows) {
    roll -= row.weight;
    if (roll <= 0) return row;
  }
  return rows[rows.length - 1];
}
