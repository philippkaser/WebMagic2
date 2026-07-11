import { BASIC_BOOTS_ID, BASIC_STAFF_ID, getItemDef, maxStackOf } from "../items/catalog";
import { BAG_SLOTS, BELT_SLOTS, CHEST_SLOTS, emptyGrid, type Grid } from "../items/inventory";
import type { Equipment, GearSlot, ItemStack } from "../items/types";
import type { WireInventory, WireStack } from "../net/protocol";

/** Saved between sessions: checkpoint progress and the banked inventory
 * (equipment, Q/E belt, bag, village chest, gold). Online this is a cache of
 * the server-authoritative save; offline it's the save of record. */
export interface SaveData {
  checkpoint: number;
  equipment: Equipment;
  bag: Grid;
  belt: Grid;
  chest: Grid;
  gold: number;
}

const KEY = "webmagic.save.v2";
const LEGACY_KEY = "webmagic.save.v1";

export function defaultEquipment(): Equipment {
  return {
    staff: { defId: BASIC_STAFF_ID, runLoot: false },
    amulet: null,
    cloak: null,
    boots: { defId: BASIC_BOOTS_ID, runLoot: false },
  };
}

export function defaultSave(): SaveData {
  return {
    checkpoint: 1,
    equipment: defaultEquipment(),
    bag: emptyGrid(BAG_SLOTS),
    belt: emptyGrid(BELT_SLOTS),
    chest: emptyGrid(CHEST_SLOTS),
    gold: 0,
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw) as Partial<SaveData>;
      if ((data.checkpoint ?? 0) >= 1 && data.equipment?.staff) {
        return {
          ...defaultSave(),
          ...data,
          bag: coerceGrid(data.bag, BAG_SLOTS),
          belt: coerceGrid(data.belt, BELT_SLOTS),
          chest: coerceGrid(data.chest, CHEST_SLOTS),
          gold: Math.max(0, Math.floor(Number(data.gold) || 0)),
        };
      }
    }
    // Pre-inventory save (checkpoint + equipment only) — upgrade in place.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const data = JSON.parse(legacy) as { checkpoint: number; equipment: Equipment };
      if (data.checkpoint >= 1 && data.equipment?.staff) {
        return { ...defaultSave(), checkpoint: data.checkpoint, equipment: data.equipment };
      }
    }
  } catch {
    // Corrupt save — fall through to defaults.
  }
  return defaultSave();
}

export function persistSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage unavailable (private mode etc.) — progress is session-only.
  }
}

function coerceGrid(raw: unknown, size: number): Grid {
  const arr = Array.isArray(raw) ? (raw as (ItemStack | null)[]) : [];
  return Array.from({ length: size }, (_, i) => {
    const s = arr[i];
    if (!s || typeof s.defId !== "string" || !validId(s.defId)) return null;
    const qty = Math.max(1, Math.min(Math.floor(Number(s.qty) || 1), maxStackOf(s.defId)));
    return { defId: s.defId, qty, runLoot: s.runLoot === true };
  });
}

// ── Server-save wire conversion ──────────────────────────────────────────────
// The server stores inventories as opaque item-id strings (it validates
// provenance, not meaning); the client validates meaning here — an id must
// exist in the catalog and belong to the container it claims.

export function toWireInventory(save: Omit<SaveData, "checkpoint">): WireInventory {
  const stack = (s: ItemStack | null): WireStack | null => (s ? { id: s.defId, qty: s.qty } : null);
  return {
    equipment: {
      staff: save.equipment.staff.defId,
      amulet: save.equipment.amulet?.defId ?? null,
      cloak: save.equipment.cloak?.defId ?? null,
      boots: save.equipment.boots?.defId ?? null,
    },
    bag: save.bag.map(stack),
    belt: save.belt.map(stack),
    chest: save.chest.map(stack),
    gold: save.gold,
  };
}

function validId(id: string): boolean {
  try {
    getItemDef(id);
    return true;
  } catch {
    return false; // unknown id (older/newer catalog) — drop it
  }
}

function validGearId(id: string | null, slot: GearSlot): string | null {
  if (!id || !validId(id)) return null;
  return getItemDef(id).slot === slot ? id : null;
}

/** Everything from the wire is banked (runLoot false) by definition. */
export function fromWireInventory(wire: WireInventory): Omit<SaveData, "checkpoint"> {
  const grid = (cells: (WireStack | null)[], size: number): Grid =>
    Array.from({ length: size }, (_, i) => {
      const s = cells[i];
      if (!s || !validId(s.id)) return null;
      const qty = Math.max(1, Math.min(s.qty, maxStackOf(s.id)));
      return { defId: s.id, qty, runLoot: false };
    });
  const staff = validGearId(wire.equipment.staff, "staff") ?? BASIC_STAFF_ID;
  const boots = validGearId(wire.equipment.boots, "boots");
  const amulet = validGearId(wire.equipment.amulet, "amulet");
  const cloak = validGearId(wire.equipment.cloak, "cloak");
  return {
    equipment: {
      staff: { defId: staff, runLoot: false },
      amulet: amulet ? { defId: amulet, runLoot: false } : null,
      cloak: cloak ? { defId: cloak, runLoot: false } : null,
      boots: boots ? { defId: boots, runLoot: false } : null,
    },
    bag: grid(wire.bag, BAG_SLOTS),
    belt: grid(wire.belt, BELT_SLOTS),
    chest: grid(wire.chest, CHEST_SLOTS),
    gold: Math.max(0, Math.floor(wire.gold) || 0),
  };
}
