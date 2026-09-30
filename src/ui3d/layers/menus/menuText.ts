import type { TextSpan } from "../../font/layout";

/** Pure copy + formatting for the in-world menus — kept out of the
 * components so it can be unit-tested and so the words live in one place
 * (a screen's layout shouldn't have to know how a death is phrased). */

/** Colours shared by the menu screens. The pixel font has no weights or
 * sizes to lean on inside a block, so colour is the only emphasis. */
export const MENU_INK = {
  bright: "#efe6cf",
  body: "#cfc5b0",
  dim: "#958b7a",
  faint: "#6f6878",
  lavender: "#b3a7cc",
  accent: "#46ffd0",
  gold: "#ffcf4d",
  loot: "#e0b54a",
  violet: "#c3a6ff",
  blood: "#d0142a",
} as const;

/** The title screen's premise, as the old DOM menu told it. */
export const PREMISE =
  "For glory, fame and riches — and to find god at the bottom — the wizards of the village step through the portal. " +
  "It weighs your gear and casts you as deep as you belong. The deep lets go only after five floors. " +
  "Die, and everything you found stays below. You may not be alone down there.";

/** The controls, key → what it does, in the order a new player needs them. */
export const CONTROLS: readonly (readonly [key: string, action: string])[] = [
  ["WASD", "move"],
  ["SPACE", "jump"],
  ["MOUSE", "cast (L / R)"],
  ["SHIFT", "dash (cloak)"],
  ["E", "interact"],
  ["F", "pact"],
  ["C", "codex"],
  ["I, TAB", "inventory"],
  ["Q, E", "belt items"],
  ["P", "fps overlay"],
  ["O", "shadows"],
];

/** The legend as one block of spans: keys in the accent colour, padded into
 * a column (the font is monospaced, so spaces align), actions dim. One
 * RuneText = one draw call for the whole carving. */
export function controlsLegend(
  controls: readonly (readonly [string, string])[] = CONTROLS,
  keyColor: string = MENU_INK.accent,
  actionColor: string = MENU_INK.dim,
): TextSpan[] {
  const width = controls.reduce((w, [k]) => Math.max(w, k.length), 0) + 1;
  const spans: TextSpan[] = [];
  controls.forEach(([key, action], i) => {
    spans.push({ text: key.padEnd(width, " "), color: keyColor });
    spans.push({ text: action + (i < controls.length - 1 ? "\n" : ""), color: actionColor });
  });
  return spans;
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

/** "ON FLOOR 12 · SLAIN BY MORGANA" — where and by whom, one line. */
export function deathHeadline(d: Pick<DeathFacts, "floor" | "killer"> | null): TextSpan[] {
  const floor = d ? String(d.floor) : "?";
  const spans: TextSpan[] = [{ text: "ON FLOOR " }, { text: floor, color: MENU_INK.bright }, { text: " · " }];
  if (d?.killer) spans.push({ text: "SLAIN BY " }, { text: d.killer.toUpperCase(), color: "#ff6a6a" });
  else spans.push({ text: "THE DUNGEON TOOK YOU" });
  return spans;
}

/** Everything the death took, named: items first, gold last. */
export function lostList(d: Pick<DeathFacts, "lostItems" | "lostGold"> | null): string[] {
  if (!d) return [];
  return [...d.lostItems, ...(d.lostGold > 0 ? [`${d.lostGold} gold`] : [])];
}

/** The verdict under the lost things: legible, not a vague shrug — what
 * went, and whether it's gone for good or waiting in a grave. */
export function lossSentence(d: DeathFacts | null): TextSpan[] {
  const lost = lostList(d);
  if (lost.length === 0) return [{ text: "You carried nothing the dungeon could take." }];
  const names: TextSpan = { text: lost.join(", "), color: MENU_INK.loot };
  if (d?.grave) {
    return [
      { text: "Other wizards stood witness, and the dungeon could not swallow it all. Your grave holds " },
      names,
      { text: " — for whoever reaches it first." },
    ];
  }
  return [{ text: "The dungeon keeps what you carried: " }, names, { text: "." }];
}

/** A plain-text rendering of spans (for tests and logs). */
export function spansText(spans: readonly TextSpan[]): string {
  return spans.map((s) => s.text).join("");
}
