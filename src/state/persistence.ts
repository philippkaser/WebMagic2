import { BASIC_BOOTS_ID, BASIC_STAFF_ID } from "../items/catalog";
import type { Equipment } from "../items/types";

/** Saved between sessions: checkpoint progress and banked equipment.
 * (When the authoritative server exists this moves server-side.) */
export interface SaveData {
  checkpoint: number;
  equipment: Equipment;
}

const KEY = "webmagic.save.v1";

export function defaultEquipment(): Equipment {
  return {
    staff: { defId: BASIC_STAFF_ID, runLoot: false },
    amulet: null,
    cloak: null,
    boots: { defId: BASIC_BOOTS_ID, runLoot: false },
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw) as SaveData;
      if (data.checkpoint >= 1 && data.equipment?.staff) return data;
    }
  } catch {
    // Corrupt save — fall through to defaults.
  }
  return { checkpoint: 1, equipment: defaultEquipment() };
}

export function persistSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage unavailable (private mode etc.) — progress is session-only.
  }
}
