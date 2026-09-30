import { BASIC_BOOTS_ID, BASIC_STAFF_ID, hasItemDef } from "../items/catalog";
import { defaultEquipment, starterItem } from "../items/inventory";
import type { Equipment, ItemInstance } from "../items/types";

/** Saved between sessions: banked equipment, the stash and lifetime records.
 * Only ever written from a safe state (village, death, extraction) — closing
 * the tab mid-run forfeits that run's loot, exactly like dying would.
 * (When accounts exist this moves server-side; this file is the one seam.) */
export interface SaveData {
  version: 2;
  equipment: Equipment;
  stash: ItemInstance[];
  records: {
    deepest: number;
    runs: number;
    extractions: number;
    deaths: number;
    wizardsSlain: number;
  };
}

const KEY = "webmagic.save.v2";
const LEGACY_KEY = "webmagic.save.v1";

export function freshSave(): SaveData {
  return {
    version: 2,
    equipment: defaultEquipment(),
    stash: [],
    records: { deepest: 0, runs: 0, extractions: 0, deaths: 0, wizardsSlain: 0 },
  };
}

function valid(item: ItemInstance | null | undefined): item is ItemInstance {
  return !!item && typeof item.uid === "string" && hasItemDef(item.defId) && item.level >= 1;
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw) as SaveData;
      const e = data.equipment;
      if (data.version === 2 && valid(e?.staff) && valid(e?.boots)) {
        return {
          ...freshSave(),
          ...data,
          equipment: {
            staff: e.staff,
            boots: e.boots,
            amulet: valid(e.amulet) ? e.amulet : null,
            cloak: valid(e.cloak) ? e.cloak : null,
          },
          stash: (data.stash ?? []).filter(valid),
        };
      }
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) return migrateV1(JSON.parse(legacy));
  } catch {
    // Corrupt save — fall through to defaults.
  }
  return freshSave();
}

/** v1 stored bare def ids per slot; they become level-1 commons. */
function migrateV1(v1: { checkpoint?: number; equipment?: Record<string, { defId: string } | null> }): SaveData {
  const save = freshSave();
  const conv = (slot: string, fallback: string | null) => {
    const id = v1.equipment?.[slot]?.defId;
    return id && hasItemDef(id) ? starterItem(id) : fallback ? starterItem(fallback) : null;
  };
  save.equipment = {
    staff: conv("staff", BASIC_STAFF_ID)!,
    amulet: conv("amulet", null),
    cloak: conv("cloak", null),
    boots: conv("boots", BASIC_BOOTS_ID)!,
  };
  save.records.deepest = v1.checkpoint ?? 0;
  return save;
}

export function persistSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage unavailable (private mode etc.) — progress is session-only.
  }
}
