import type { Rng } from "../core/rng";
import type { EnemyKind } from "../world/types";

/** Which enemies haunt which depths. Pure data + a weighted pick, consumed by
 * the (deterministic) floor generator — so it must only use the given rng.
 *
 * The bands mirror the biome bands in world/biomes.ts: each depth has its
 * signature horrors, plus a thinning tail of the ones from above. */

export interface SpawnRow {
  kind: EnemyKind;
  weight: number;
  /** Introduced partway into a band (defaults to the band's first floor). */
  minFloor?: number;
}

export interface EnemyBand {
  id: "catacombs" | "drowned" | "ember" | "crystal" | "abyss";
  fromFloor: number;
  rows: readonly SpawnRow[];
}

export const ENEMY_BANDS: readonly EnemyBand[] = [
  {
    // Bones and wisps. Floor 1 is wisps only; skitters join on 2, the
    // warding obelisks on 4, and the first mimic lies in wait from 6.
    id: "catacombs",
    fromFloor: 1,
    rows: [
      { kind: "wisp", weight: 58 },
      { kind: "skitter", weight: 30, minFloor: 2 },
      { kind: "sentry", weight: 14, minFloor: 4 },
      { kind: "mimic", weight: 3, minFloor: 6 },
    ],
  },
  {
    id: "drowned",
    fromFloor: 15,
    rows: [
      { kind: "drowned", weight: 34 },
      { kind: "wisp", weight: 24 },
      { kind: "skitter", weight: 16 },
      { kind: "shade", weight: 14, minFloor: 18 },
      { kind: "sentry", weight: 10 },
      { kind: "mimic", weight: 3 },
    ],
  },
  {
    id: "ember",
    fromFloor: 30,
    rows: [
      { kind: "imp", weight: 38 },
      { kind: "sentry", weight: 16 },
      { kind: "wisp", weight: 16 },
      { kind: "drowned", weight: 12 },
      { kind: "skitter", weight: 10 },
      { kind: "shade", weight: 8 },
      { kind: "mimic", weight: 3 },
    ],
  },
  {
    id: "crystal",
    fromFloor: 50,
    rows: [
      { kind: "golem", weight: 28 },
      { kind: "shade", weight: 18 },
      { kind: "imp", weight: 14 },
      { kind: "sentry", weight: 14 },
      { kind: "wisp", weight: 14 },
      { kind: "skitter", weight: 8 },
      { kind: "mimic", weight: 4 },
    ],
  },
  {
    id: "abyss",
    fromFloor: 75,
    rows: [
      { kind: "shade", weight: 30 },
      { kind: "golem", weight: 18 },
      { kind: "drowned", weight: 16 },
      { kind: "imp", weight: 12 },
      { kind: "skitter", weight: 12 },
      { kind: "wisp", weight: 10 },
      { kind: "mimic", weight: 5 },
    ],
  },
];

/** Spawn height above the floor: fliers hover, walkers drop in. */
export const SPAWN_HEIGHT: Record<EnemyKind, number> = {
  wisp: 1.6,
  sentry: 0,
  skitter: 0.5,
  drowned: 1.1,
  shade: 1.5,
  imp: 0.6,
  golem: 1.3,
  mimic: 0.05,
};

export function bandFor(floor: number): EnemyBand {
  let band = ENEMY_BANDS[0];
  for (const b of ENEMY_BANDS) if (floor >= b.fromFloor) band = b;
  return band;
}

export function pickEnemy(floor: number, rng: Rng): { kind: EnemyKind; y: number } {
  const rows = bandFor(floor).rows.filter((r) => floor >= (r.minFloor ?? 0));
  const total = rows.reduce((s, r) => s + r.weight, 0);
  let roll = rng.next() * total;
  let kind = rows[rows.length - 1].kind;
  for (const row of rows) {
    roll -= row.weight;
    if (roll <= 0) {
      kind = row.kind;
      break;
    }
  }
  return { kind, y: SPAWN_HEIGHT[kind] };
}
