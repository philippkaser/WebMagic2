import type { TextSpan } from "../../font/layout";
import { ink } from "../../theme";

/** Pure copy + formatting for the in-world menus — kept out of the
 * components so it can be unit-tested and so the words live in one place
 * (a screen's layout shouldn't have to know how a death is phrased). */

/** Colours shared by the menu screens — the grimoire's (theme.ts), named
 * for what they do here. The pixel fonts have no weights inside a block, so
 * colour (and the face) is the only emphasis. */
export const MENU_INK = {
  bright: ink.parchment,
  body: ink.parchmentDim,
  dim: ink.faded,
  faint: "#5a5262",
  accent: ink.arcane,
  gold: ink.gold,
  loot: ink.brassLight,
  violet: ink.violet,
  blood: ink.blood,
  /** Death's lighter red (labels and numbers on the blood screen). */
  wound: "#ff8a7a",
} as const;

/** The title screen's premise: the breath of lore under the logo. The
 * rules themselves are on the three cards below it. */
export const PREMISE =
  "Beneath the village, the portal opens onto a hundred floors of hungry dark. " +
  "Wizards go down for glory, for riches — and for the god said to wait at the bottom. Few come back up.";

/** The title's three cards: the laws of the dungeon, one each. */
export const TENETS: readonly { icon: "gem" | "hourglass" | "pact"; tint: string; title: string; text: string }[] = [
  {
    icon: "gem",
    tint: ink.brassLight,
    title: "The Weighing Gate",
    text: "The portal weighs the gear you wear and casts you as deep as it belongs.",
  },
  {
    icon: "hourglass",
    tint: "#ff8e5a",
    title: "The Tithe of Five",
    text: "The deep lets go only after five floors. Die before, and all you found stays below.",
  },
  {
    icon: "pact",
    tint: ink.ally,
    title: "Friend or Foe",
    text: "Now and then another wizard walks your floor. Seal a pact — or take what they carry.",
  },
];

/** The controls, in the order a new player needs them: the keys (each one
 * key cap) and what they do. */
export const CONTROLS: readonly { keys: readonly string[]; action: string }[] = [
  { keys: ["W", "A", "S", "D"], action: "move" },
  { keys: ["Space"], action: "jump" },
  { keys: ["L", "R"], action: "cast" },
  { keys: ["Shift"], action: "dash" },
  { keys: ["E"], action: "interact" },
  { keys: ["F"], action: "pact" },
  { keys: ["Q", "E"], action: "belt" },
  { keys: ["Tab"], action: "satchel" },
  { keys: ["C"], action: "codex" },
  { keys: ["P"], action: "fps" },
  { keys: ["O"], action: "shadows" },
];

/** Greedy row wrap for things laid side by side (key-cap legends, card
 * rows): indices per row, each row's widths plus gaps ≤ `maxWidth` (an
 * item wider than a row gets a row of its own). */
export function wrapRows(widths: readonly number[], maxWidth: number, gap: number): number[][] {
  const rows: number[][] = [];
  let row: number[] = [];
  let w = 0;
  widths.forEach((iw, i) => {
    const next = row.length === 0 ? iw : w + gap + iw;
    if (row.length > 0 && next > maxWidth) {
      rows.push(row);
      row = [i];
      w = iw;
    } else {
      row.push(i);
      w = next;
    }
  });
  if (row.length > 0) rows.push(row);
  return rows;
}

/** The same filter setPlayerName applies on commit, minus the trim — so
 * what the plaque shows while you type is exactly what gets carved (a
 * trailing space mid-word must survive until the next letter). */
export const NAME_MAX = 16;
export function sanitizeNameDraft(raw: string): string {
  return raw.replace(/[^\w \-']/g, "").slice(0, NAME_MAX);
}

/** The Weighing's resonance, as the gate speaks it. */
export function formatResonance(level: number): string {
  return (Math.round(level * 10) / 10).toFixed(1);
}

export interface DeathFacts {
  floor: number;
  killer: string | null;
  lostItems: readonly string[];
  lostGold: number;
  grave: boolean;
}

/** "Slain by Morgana on floor 12 — The Drowned Halls": who and where, one
 * line (the killer in violet, like artpass's death rites). */
export function deathHeadline(d: Pick<DeathFacts, "floor" | "killer"> | null, biomeName: string | null): TextSpan[] {
  const floor = d ? String(d.floor) : "?";
  const spans: TextSpan[] = d?.killer
    ? [{ text: "Slain by " }, { text: d.killer, color: MENU_INK.violet }, { text: " on floor " }]
    : [{ text: "The dungeon claimed you on floor " }];
  spans.push({ text: floor, color: MENU_INK.bright });
  if (biomeName) spans.push({ text: ` — ${biomeName}` });
  return spans;
}

/** Everything the death took, named: items first, gold last. */
export function lostList(d: Pick<DeathFacts, "lostItems" | "lostGold"> | null): string[] {
  if (!d) return [];
  return [...d.lostItems, ...(d.lostGold > 0 ? [`${d.lostGold} gold`] : [])];
}

/** The verdict over the lost things: a caption and a line of lore — legible,
 * not a vague shrug: what went, and whether it is gone for good or waiting
 * in a grave. */
export function lossVerdict(d: DeathFacts | null): { label: string | null; lore: string } {
  if (lostList(d).length === 0) return { label: null, lore: "You carried nothing the dungeon could take." };
  if (d?.grave) {
    return {
      label: "Your grave keeps what you carried",
      lore: "Other wizards stood witness. It waits below — for whoever reaches it first.",
    };
  }
  return {
    label: "The dungeon keeps what you carried",
    lore: "No one stood witness. It crumbles into the dark, and nothing of it waits below.",
  };
}

/** A plain-text rendering of spans (for tests and logs). */
export function spansText(spans: readonly TextSpan[]): string {
  return spans.map((s) => s.text).join("");
}
