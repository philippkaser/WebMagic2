import type { Rng } from "../core/rng";
import { rollReward } from "../items/loot";
import { bandReagent, RIFTGLASS, type MaterialDrop } from "../items/materials";
import type { BuffId } from "../items/types";
import type { RoomEventKind } from "../world/types";

/** What a room can hold besides monsters — the table the generator draws
 * from (world/gen/eventPlacement.ts) and the numbers the rules run on
 * (roomEvents/rules.ts). Pure data; adding a kind is a row here, a branch in
 * the rules and a view.
 *
 *  - VAULT: an iron-bound chest. Step into its room and its guardians wake;
 *    when the last falls the lid unseals. Gear, gold, reagents, and often
 *    riftglass.
 *  - WARD: a ring of standing stones. Kindle it and hold the circle while
 *    the deep sends waves at you; leave it empty too long and it breaks.
 *    The best of the room rewards, with riftglass for certain.
 *  - SHRINE: one of the old powers offers a bargain — a strong blessing for
 *    a while, and something taken back. Once per wizard.
 *  - FOUNTAIN: clear water that mends body and mana. Once per wizard. */

export interface RoomEventDef {
  kind: RoomEventKind;
  name: string;
  /** Relative odds among the kinds that fit. */
  weight: number;
  minFloor: number;
  /** Smallest room side (tiles) it fits in. */
  minRoom: number;
  /** Its colour on the cast map and in its light. */
  color: string;
}

export const ROOM_EVENTS: readonly RoomEventDef[] = [
  { kind: "vault", name: "Vault", weight: 3, minFloor: 2, minRoom: 5, color: "#ffcf6a" },
  { kind: "ward", name: "Ward Circle", weight: 2, minFloor: 4, minRoom: 6, color: "#46ffd0" },
  { kind: "shrine", name: "Shrine", weight: 3, minFloor: 1, minRoom: 3, color: "#ff5a6a" },
  { kind: "fountain", name: "Fountain", weight: 2, minFloor: 1, minRoom: 3, color: "#5db9ff" },
];

const byKind = new Map(ROOM_EVENTS.map((d) => [d.kind, d]));

export function roomEventDef(kind: RoomEventKind): RoomEventDef {
  return byKind.get(kind)!;
}

/** The bargains a shrine may offer (items/buffs.ts), picked by its variant. */
export const SHRINE_BOONS: readonly BuffId[] = ["blood_oath", "glass_hour", "wellspring", "storm_pact", "ricochet_rite"];

export function shrineBoon(variant: number): BuffId {
  return SHRINE_BOONS[Math.abs(Math.floor(variant)) % SHRINE_BOONS.length]!;
}

/** How a floor's events are counted and fought. */
export const ROOM_EVENT_RULES = {
  /** Chance a floor has any event at all, and (from `secondFrom`) a second. */
  anyChance: 0.85,
  secondFrom: 5,
  secondChance: 0.5,
  /** Vault guardians: 2, one more every 15 floors, at most 5. */
  vaultGuards: (floor: number) => Math.min(5, 2 + Math.floor(floor / 15)),
  /** Seconds after the guardians wake before the vault counts them (their
   * spawns need a beat to arrive everywhere). */
  vaultGrace: 1.5,
  /** Seconds of a held circle to win the ward. */
  wardSeconds: 35,
  /** The ward's waves land as its progress passes these marks. */
  wardWaves: [0, 0.34, 0.68] as readonly number[],
  wardWaveSize: (floor: number) => Math.min(5, 2 + Math.floor(floor / 20)),
  /** Radius (m) of the ring a wizard must stand in. */
  wardRadius: 3.2,
  /** An empty circle drains this many times slower than a held one fills… */
  wardDrain: 0.5,
  /** …and breaks after this many seconds with nobody in it. */
  wardAbandon: 12,
} as const;

/** What a vault or a won ward gives — one piece of gear, gold, a clutch of
 * the band's reagent, and riftglass (certain from a ward, a coin-toss from a
 * vault). Pure: the authority rolls it with its own dice. */
export interface RoomReward {
  item: string;
  /** Coin, as so many of the floor's enemy purses. */
  purses: number;
  materials: MaterialDrop[];
}

export function rollRoomReward(rng: Rng, kind: "vault" | "ward", floor: number): RoomReward {
  const ward = kind === "ward";
  const legendary = (ward ? 0.06 : 0.03) + floor * 0.0005;
  const materials: MaterialDrop[] = [{ id: bandReagent(floor), qty: rng.int(2, ward ? 4 : 3) }];
  const glass = ward ? rng.int(1, 2) : rng.next() < 0.5 ? 1 : 0;
  if (glass > 0) materials.push({ id: RIFTGLASS, qty: glass });
  return { item: rollReward(rng, floor, legendary, ward ? 0.45 : 0.35), purses: ward ? 6 : 4, materials };
}
