import { BASIC_BOOTS_ID, BASIC_STAFF_ID, getItemDef } from "../items/catalog";
import type { Equipment, Slot } from "../items/types";
import type { WireEquipment } from "../net/protocol";

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

// ── Server-save wire conversion ──────────────────────────────────────────────
// The server stores equipment as opaque item-id strings (it validates
// provenance, not meaning); the client validates meaning here — an id must
// exist in the catalog and belong to the slot it claims.

export function toWireEquipment(equipment: Equipment): WireEquipment {
  return {
    staff: equipment.staff.defId,
    amulet: equipment.amulet?.defId ?? null,
    cloak: equipment.cloak?.defId ?? null,
    boots: equipment.boots.defId,
  };
}

function validId(id: string | null, slot: Slot): string | null {
  if (!id) return null;
  try {
    return getItemDef(id).slot === slot ? id : null;
  } catch {
    return null; // unknown id (older/newer catalog) — drop it
  }
}

export function fromWireEquipment(wire: WireEquipment): Equipment {
  const staff = validId(wire.staff, "staff") ?? BASIC_STAFF_ID;
  const boots = validId(wire.boots, "boots") ?? BASIC_BOOTS_ID;
  const amulet = validId(wire.amulet, "amulet");
  const cloak = validId(wire.cloak, "cloak");
  return {
    staff: { defId: staff, runLoot: false },
    amulet: amulet ? { defId: amulet, runLoot: false } : null,
    cloak: cloak ? { defId: cloak, runLoot: false } : null,
    boots: { defId: boots, runLoot: false },
  };
}
