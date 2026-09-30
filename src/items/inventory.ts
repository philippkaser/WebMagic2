import { BASIC_BOOTS_ID, BASIC_STAFF_ID, getItemDef } from "./catalog";
import { itemPower } from "./stats";
import type { Equipment, ItemInstance, Slot } from "./types";

/** Inventory rules — pure functions over an immutable Loadout, so the whole
 * risk/reward economy (what you keep, what the dungeon takes) is unit-tested.
 *
 *  - `stash`: everything you own back in the village. Only reachable there.
 *  - `satchel`: what you carry in the dungeon — loot picked up this run, plus
 *    anything you unequipped mid-run.
 *  - `runLoot` flag: set on everything found this run. Death takes every
 *    runLoot item (equipped or carried); extraction makes them yours. */
export interface Loadout {
  equipment: Equipment;
  satchel: ItemInstance[];
  stash: ItemInstance[];
}

export type Source = "satchel" | "stash";

let starterCounter = 0;

export function starterItem(defId: string): ItemInstance {
  return { uid: `s${Date.now().toString(36)}${starterCounter++}`, defId, level: 1, rarity: "common", runLoot: false };
}

export function defaultEquipment(): Equipment {
  return {
    staff: starterItem(BASIC_STAFF_ID),
    amulet: null,
    cloak: null,
    boots: starterItem(BASIC_BOOTS_ID),
  };
}

export function emptyLoadout(): Loadout {
  return { equipment: defaultEquipment(), satchel: [], stash: [] };
}

export function slotOf(item: ItemInstance): Slot {
  return getItemDef(item.defId).slot;
}

/** Equip an item from the satchel or stash. Whatever it replaces goes back
 * into the same container. */
export function equipFrom(loadout: Loadout, uid: string, source: Source): Loadout {
  const list = loadout[source];
  const item = list.find((i) => i.uid === uid);
  if (!item) return loadout;
  const slot = slotOf(item);
  const previous = loadout.equipment[slot];
  const rest = list.filter((i) => i.uid !== uid);
  return {
    ...loadout,
    equipment: { ...loadout.equipment, [slot]: item },
    [source]: previous ? [...rest, previous] : rest,
  };
}

/** Only the optional slots can be emptied. */
export function unequip(loadout: Loadout, slot: "amulet" | "cloak", dest: Source): Loadout {
  const item = loadout.equipment[slot];
  if (!item) return loadout;
  return {
    ...loadout,
    equipment: { ...loadout.equipment, [slot]: null },
    [dest]: [...loadout[dest], item],
  };
}

/** Pick up loot. Fills an empty optional slot directly (no reason to make you
 * open the satchel for your first amulet); otherwise it goes in the satchel. */
export function pickUp(loadout: Loadout, item: ItemInstance): { loadout: Loadout; equipped: boolean } {
  const slot = slotOf(item);
  if ((slot === "amulet" || slot === "cloak") && !loadout.equipment[slot]) {
    return { loadout: { ...loadout, equipment: { ...loadout.equipment, [slot]: item } }, equipped: true };
  }
  return { loadout: { ...loadout, satchel: [...loadout.satchel, item] }, equipped: false };
}

function bestOf(items: ItemInstance[], slot: Slot): ItemInstance | null {
  let best: ItemInstance | null = null;
  for (const item of items) {
    if (slotOf(item) !== slot) continue;
    if (!best || itemPower(item) > itemPower(best)) best = item;
  }
  return best;
}

/** Death: the dungeon keeps every runLoot item. Surviving carried items go
 * home to the stash; an empty staff/boots slot is refilled from the stash
 * (best first) or with fresh starter gear. */
export function settleDeath(loadout: Loadout): { loadout: Loadout; lost: ItemInstance[] } {
  const lost: ItemInstance[] = [];
  const keep = (item: ItemInstance | null) => {
    if (item?.runLoot) {
      lost.push(item);
      return null;
    }
    return item;
  };
  const staff = keep(loadout.equipment.staff);
  const amulet = keep(loadout.equipment.amulet);
  const cloak = keep(loadout.equipment.cloak);
  const boots = keep(loadout.equipment.boots);
  let stash = [...loadout.stash, ...loadout.satchel.filter((i) => keep(i) !== null)];

  const refill = (slot: "staff" | "boots", fallbackId: string): ItemInstance => {
    const best = bestOf(stash, slot);
    if (best) {
      stash = stash.filter((i) => i !== best);
      return best;
    }
    return starterItem(fallbackId);
  };
  return {
    loadout: {
      equipment: {
        staff: staff ?? refill("staff", BASIC_STAFF_ID),
        amulet,
        cloak,
        boots: boots ?? refill("boots", BASIC_BOOTS_ID),
      },
      satchel: [],
      stash,
    },
    lost,
  };
}

/** Extraction: every run item becomes permanently yours; the satchel is
 * unpacked into the stash. */
export function settleExtraction(loadout: Loadout): { loadout: Loadout; gained: ItemInstance[] } {
  const bank = (i: ItemInstance): ItemInstance => (i.runLoot ? { ...i, runLoot: false } : i);
  const gained = [
    ...[loadout.equipment.staff, loadout.equipment.amulet, loadout.equipment.cloak, loadout.equipment.boots],
    ...loadout.satchel,
  ].filter((i): i is ItemInstance => !!i?.runLoot);
  const e = loadout.equipment;
  return {
    loadout: {
      equipment: {
        staff: bank(e.staff),
        amulet: e.amulet && bank(e.amulet),
        cloak: e.cloak && bank(e.cloak),
        boots: bank(e.boots),
      },
      satchel: [],
      stash: [...loadout.stash, ...loadout.satchel.map(bank)],
    },
    gained,
  };
}

/** Throw an item from the stash away for good (village housekeeping). */
export function discard(loadout: Loadout, uid: string): Loadout {
  return { ...loadout, stash: loadout.stash.filter((i) => i.uid !== uid) };
}

/** Display name: "Rare Ember Staff". */
export function itemTitle(item: ItemInstance): string {
  const name = getItemDef(item.defId).name;
  return item.rarity === "common" ? name : `${item.rarity[0].toUpperCase()}${item.rarity.slice(1)} ${name}`;
}
