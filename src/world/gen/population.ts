import { TILE, floorScale } from "../../core/config";
import type { Rng } from "../../core/rng";
import type { EnemyKind, EnemySpawn, PropKind, PropSpawn, Rect, Vec3 } from "../types";
import { type Grid, type Tile, SOLID, dist2World, toWorld } from "./grid";
import type { Pois } from "./pois";
import { randomInRoom } from "./rooms";

/** Stage 5 — population: torches on the room walls, then props and enemies
 * room by room. On a calm floor (no omen) the draws are exactly the ones the
 * generator has always made, so a seed keeps the layout it always produced;
 * biome weights only change which kind an enemy draw lands on, and omens
 * scale counts and thresholds on top. */

// ── Torches ──────────────────────────────────────────────────────────────────

/** Torches a floor gets before any omen bends it. */
const TORCH_CAP = 16;
/** The fewest torches any floor may have: even a lightless floor must give a
 * wizard something to navigate by. */
const MIN_TORCHES = 2;
/** Mounted well above head height: under a 7 m vault a torch at 3.1 m throws
 * its light up the wall as well as down across the floor, and its
 * reflection lands further out on the wet flags. */
const TORCH_HEIGHT = 3.1;
/** Pushes a torch from its tile centre toward the wall it's mounted on. */
const TORCH_INSET = TILE * 0.42;

export interface TorchPlacement {
  torches: Vec3[];
  /** The tile each torch is mounted on (same order), so later stages — lore
   * runes — can keep clear of them. */
  tiles: Tile[];
}

interface TorchCandidate {
  pos: Vec3;
  tile: Tile;
  room: Rect;
}

/** Torches on the north/south edges of rooms. `torchMult` (an omen's) scales
 * the count: below 1 the normal set is thinned — one per room first, so what
 * light remains is spread out as islands rather than bunched — and above 1 a
 * second pass tops it up. */
export function placeTorches(grid: Grid, rng: Rng, rooms: Rect[], torchMult: number): TorchPlacement {
  let picked = torchPass(grid, rng, rooms, TORCH_CAP, []);
  if (torchMult < 1) {
    const keep = Math.min(picked.length, Math.max(MIN_TORCHES, Math.round(picked.length * torchMult)));
    picked = spreadAcrossRooms(picked, keep);
  } else if (torchMult > 1) {
    const target = Math.round(picked.length * torchMult);
    for (let pass = 0; pass < 3 && picked.length < target; pass++) {
      torchPass(grid, rng, rooms, target - picked.length, picked);
    }
  }
  return { torches: picked.map((c) => c.pos), tiles: picked.map((c) => c.tile) };
}

/** One sweep over the rooms in a shuffled order, two mounting attempts each,
 * until `slots` mounting spots on room edges have been tried. Appends to and
 * returns `out`.
 *
 * The budget counts spots tried, not torches lit: a spot with no rock behind
 * it (a corridor mouth) just stays dark. Counting it anyway keeps the number
 * of rng draws independent of where corridors happen to cut in, so rejecting
 * a bad spot never reshuffles the props and enemies rolled after. */
function torchPass(
  grid: Grid,
  rng: Rng,
  rooms: Rect[],
  slots: number,
  out: TorchCandidate[],
): TorchCandidate[] {
  let tried = 0;
  for (const room of rng.shuffle([...rooms])) {
    if (tried >= slots) break;
    for (let i = 0; i < 2; i++) {
      const onNorth = rng.chance(0.5);
      const tx = rng.int(room.x + 1, room.x + room.w - 2);
      const ty = onNorth ? room.y : room.y + room.h - 1;
      if (!grid.isFloor(tx, ty)) continue;
      tried++;
      // A torch needs rock behind it — never float one in a corridor mouth.
      if (grid.at(tx, onNorth ? ty - 1 : ty + 1) !== SOLID) continue;
      const [wx, , wz] = toWorld(tx, ty, grid.size);
      out.push({
        pos: [wx, TORCH_HEIGHT, wz + (onNorth ? -TORCH_INSET : TORCH_INSET)],
        tile: [tx, ty],
        room,
      });
    }
  }
  return out;
}

function spreadAcrossRooms(cands: TorchCandidate[], keep: number): TorchCandidate[] {
  const chosen: TorchCandidate[] = [];
  const litRooms = new Set<Rect>();
  for (const c of cands) {
    if (chosen.length >= keep) break;
    if (litRooms.has(c.room)) continue;
    litRooms.add(c.room);
    chosen.push(c);
  }
  for (const c of cands) {
    if (chosen.length >= keep) break;
    if (!chosen.includes(c)) chosen.push(c);
  }
  return chosen;
}

// ── Props & enemies ──────────────────────────────────────────────────────────

/** Props and enemies keep this far (squared world units) from the spawn, so
 * nothing is shoved into or fired at a wizard the instant they arrive. */
const PROP_SPAWN_CLEARANCE2 = 16;
const ENEMY_SPAWN_CLEARANCE2 = 100;

/** Baseline prop mix. Barrels are the sandbox's explosive fun, so omens bend
 * the barrel share and pots/crates split what's left in their usual ratio. */
const POT_SHARE = 0.4;
const BARREL_SHARE = 0.25;

/** Body-centre height each kind spawns at (wisps hover at eye level). */
const ENEMY_SPAWN_HEIGHT: Record<EnemyKind, number> = {
  wisp: 1.6,
  sentry: 0.9,
  shadow: 0.8,
  slime: 0.6,
};

/** Enemy roster with staggered introduction: each kind appears from a later
 * floor and its weight ramps in slowly, so early floors stay mostly wisps and
 * new threats are eased in one at a time as you descend. The wisp is the
 * constant backbone (weight 1); the others start rare and grow with depth. */
const ENEMY_INTRO: { kind: EnemyKind; from: number; weight: (f: number) => number }[] = [
  { kind: "wisp", from: 1, weight: () => 1 },
  { kind: "slime", from: 3, weight: (f) => Math.min(0.8, 0.1 + (f - 3) * 0.06) },
  { kind: "sentry", from: 5, weight: (f) => Math.min(0.6, 0.1 + (f - 5) * 0.05) },
  { kind: "shadow", from: 8, weight: (f) => Math.min(0.55, 0.08 + (f - 8) * 0.04) },
];

export interface PopulationMods {
  /** Added to the barrel share of props (omen). */
  barrelBias: number;
  /** Scales the enemy budget and each room's share of it (omen). */
  enemyCountMult: number;
  /** Per-kind multipliers on the intro weights (biome). A kind that hasn't
   * been introduced yet stays absent whatever its multiplier. */
  enemyWeights: Partial<Record<EnemyKind, number>>;
}

export interface Population {
  props: PropSpawn[];
  enemies: EnemySpawn[];
}

export function populateRooms(
  rng: Rng,
  rooms: Rect[],
  pois: Pois,
  floor: number,
  size: number,
  mods: PopulationMods,
): Population {
  const props: PropSpawn[] = [];
  const enemies: EnemySpawn[] = [];
  const { spawn, spawnRoom, exitRoom, isBossFloor } = pois;
  let enemyBudget = Math.round(floorScale(floor).enemyCount * mods.enemyCountMult);

  for (const room of rooms) {
    const propCount = rng.int(1, 4);
    for (let i = 0; i < propCount; i++) {
      const pos = randomInRoom(rng, room, size, 1);
      if (dist2World(pos, spawn) < PROP_SPAWN_CLEARANCE2) continue;
      props.push({ kind: propKind(rng.next(), mods.barrelBias), pos });
    }
    if (room === spawnRoom || enemyBudget <= 0) continue;
    // Boss floors keep the arena clear of regular enemies.
    if (isBossFloor && room === exitRoom) continue;
    const roomShare = Math.ceil((rng.int(1, 3) + Math.floor(floor / 6)) * mods.enemyCountMult);
    const share = Math.min(enemyBudget, roomShare);
    for (let i = 0; i < share; i++) {
      const pos = randomInRoom(rng, room, size, 1.6);
      if (dist2World(pos, spawn) < ENEMY_SPAWN_CLEARANCE2) continue;
      const kind = pickEnemyKind(rng, floor, mods.enemyWeights);
      enemies.push({ kind, pos: [pos[0], ENEMY_SPAWN_HEIGHT[kind], pos[2]] });
      enemyBudget--;
    }
  }
  return { props, enemies };
}

/** Maps one uniform roll to a prop kind. With no bias the cut points are
 * exactly the historical 0.4 / 0.75, so unbiased floors keep their props. */
function propKind(roll: number, barrelBias: number): PropKind {
  const barrel = Math.min(1, Math.max(0, BARREL_SHARE + barrelBias));
  const rest = 1 - barrel;
  const potCut = POT_SHARE * (rest / (1 - BARREL_SHARE));
  return roll < potCut ? "pot" : roll < rest ? "crate" : "barrel";
}

/** Weighted pick over the kinds available at this depth (one rng draw). */
function pickEnemyKind(
  rng: Rng,
  floor: number,
  weights: Partial<Record<EnemyKind, number>>,
): EnemyKind {
  const eligible = ENEMY_INTRO.filter((e) => floor >= e.from);
  const weightOf = (e: (typeof ENEMY_INTRO)[number]) => e.weight(floor) * (weights[e.kind] ?? 1);
  const total = eligible.reduce((s, e) => s + weightOf(e), 0);
  let r = rng.next() * total;
  for (const e of eligible) {
    r -= weightOf(e);
    if (r <= 0) return e.kind;
  }
  return "wisp";
}
