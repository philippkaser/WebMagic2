import { getAbility } from "../combat/abilities";
import type { ItemDef, Passives, Slot } from "../items/types";

/** One glyph per item family — the same everywhere an item appears (equipment
 * HUD, inventory cells, merchant list), so items are recognizable at a glance. */
export const ITEM_ICONS: Record<Slot, string> = {
  staff: "⚚",
  amulet: "◈",
  cloak: "▲",
  boots: "⬢",
  consumable: "⚗",
};

export function iconOf(def: ItemDef): string {
  return ITEM_ICONS[def.slot];
}

/** Human-readable stat lines for an item — what the inventory screen and
 * merchant list show. Lives in ui/ (not items/) because it reads ability
 * data from combat/, which itself depends on items/. */
export function statLines(def: ItemDef): string[] {
  const lines: string[] = [];
  if (def.primary) {
    const a = getAbility(def.primary);
    lines.push(`LMB ${a.name} — ${a.info} · ${a.mana} MP`);
  }
  if (def.secondary) {
    const a = getAbility(def.secondary);
    lines.push(`RMB ${a.name} — ${a.info} · ${a.mana} MP`);
  }
  if (def.passives) lines.push(...passiveLines(def.passives));
  if (def.jump === "double") lines.push("Double jump");
  if (def.jump === "hover") lines.push("Hold Space to hover");
  if (def.dash) lines.push("Shift: blink-dash");
  if (def.consumable) {
    if (def.consumable.heal) lines.push(`Restores ${def.consumable.heal} health`);
    if (def.consumable.mana) lines.push(`Restores ${def.consumable.mana} mana`);
    if (def.consumable.escape) lines.push("Return to the village, banking this run's loot");
    lines.push("Consumed on use (Q/E)");
  }
  return lines;
}

function pct(mult: number): string {
  return `${Math.round(Math.abs(mult - 1) * 100)}%`;
}

function passiveLines(p: Partial<Passives>): string[] {
  const lines: string[] = [];
  if (p.maxHealth) lines.push(`+${p.maxHealth} max health`);
  if (p.speedMult && p.speedMult !== 1)
    lines.push(`${p.speedMult > 1 ? "+" : "-"}${pct(p.speedMult)} movement speed`);
  if (p.manaRegenMult && p.manaRegenMult !== 1)
    lines.push(`${p.manaRegenMult > 1 ? "+" : "-"}${pct(p.manaRegenMult)} mana regeneration`);
  if (p.damageMult && p.damageMult !== 1)
    lines.push(`${p.damageMult > 1 ? "+" : "-"}${pct(p.damageMult)} spell damage`);
  if (p.damageTakenMult && p.damageTakenMult !== 1)
    lines.push(`${p.damageTakenMult < 1 ? "-" : "+"}${pct(p.damageTakenMult)} damage taken`);
  if (p.aggroMult && p.aggroMult !== 1)
    lines.push(`${p.aggroMult < 1 ? "-" : "+"}${pct(p.aggroMult)} enemy notice range`);
  return lines;
}
