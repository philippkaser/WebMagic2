import { resolveItem } from "../items/catalog";
import { markBanked, stripRunLoot, type Grid } from "../items/inventory";
import type { Equipment, GearSlot } from "../items/types";

/** How a run ends, as pure functions over what the wizard carries:
 *
 *  - walking home (or a feather): everything carried becomes banked;
 *  - dying: everything found THIS run is lost — the dungeon keeps it (or, on
 *    a shared floor, it stays behind in a grave). Gear brought from home
 *    survives; a lost run staff falls back to the starter staff, because a
 *    wizard without a staff isn't a wizard. */

export interface CarriedKit {
  equipment: Equipment;
  bag: Grid;
  belt: Grid;
}

/** One lost stack, by item id (grave contents, death screen). */
export interface LostStack {
  id: string;
  qty: number;
}

export interface DeathOutcome {
  kept: CarriedKit;
  lost: LostStack[];
  /** Display names ("Keen Ember Staff", "Weak Healing Draught ×3"). */
  lostNames: string[];
}

/** Everything carried becomes safe. */
export function bankKit(kit: CarriedKit): CarriedKit {
  const safe = <T extends { runLoot: boolean } | null>(item: T): T =>
    (item ? { ...item, runLoot: false } : item) as T;
  return {
    equipment: {
      staff: safe(kit.equipment.staff),
      amulet: safe(kit.equipment.amulet),
      cloak: safe(kit.equipment.cloak),
      boots: safe(kit.equipment.boots),
    },
    bag: markBanked(kit.bag),
    belt: markBanked(kit.belt),
  };
}

/** Strip this run's loot. `starterStaffId` replaces a lost run staff. */
export function settleDeath(kit: CarriedKit, starterStaffId: string): DeathOutcome {
  const lost: LostStack[] = [];
  const lostNames: string[] = [];
  const lose = (id: string, qty: number) => {
    lost.push({ id, qty });
    const name = resolveItem(id).name;
    lostNames.push(qty > 1 ? `${name} ×${qty}` : name);
  };

  const strip = (slot: Exclude<GearSlot, "staff">) => {
    const item = kit.equipment[slot];
    if (item?.runLoot) {
      lose(item.defId, 1);
      return null;
    }
    return item;
  };
  const staffLost = kit.equipment.staff.runLoot;
  if (staffLost) lose(kit.equipment.staff.defId, 1);

  const equipment: Equipment = {
    staff: staffLost ? { defId: starterStaffId, runLoot: false } : kit.equipment.staff,
    amulet: strip("amulet"),
    cloak: strip("cloak"),
    boots: strip("boots"),
  };
  const bag = stripRunLoot(kit.bag);
  const belt = stripRunLoot(kit.belt);
  for (const s of [...bag.lost, ...belt.lost]) lose(s.defId, s.qty);

  return { kept: { equipment, bag: bag.grid, belt: belt.grid }, lost, lostNames };
}
