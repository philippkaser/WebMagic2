import { ADVANCE, GLYPH_H, LINE_HEIGHT, glyphSlot, isBlank } from "./glyphs";

/** Pure text layout for the pixel font: wrapping, alignment and reading
 * order, in font pixels. No three.js here — RuneText turns the result into
 * instances, tests read it directly. */

/** A run of text in one colour. Plain strings are one span in the default
 * colour; `color: undefined` also means "the default". */
export interface TextSpan {
  text: string;
  color?: string;
}

export type TextInput = string | readonly TextSpan[];

export type Align = "left" | "center" | "right";

export interface LayoutOptions {
  /** Wrap width in characters (default: never wrap except at "\n"). */
  maxCols?: number;
  align?: Align;
}

export interface PlacedGlyph {
  /** Top-left of the glyph cell, font pixels; y grows DOWN. */
  x: number;
  y: number;
  /** Atlas slot (glyphs.ts). */
  slot: number;
  /** The span's colour, or undefined for the text's default colour. */
  color: string | undefined;
  /** 0..1 position in reading order — drives the materialize stagger. */
  order: number;
}

export interface TextLayout {
  glyphs: PlacedGlyph[];
  /** Block size in font pixels (width of the widest line, all lines tall). */
  width: number;
  height: number;
  lines: number;
}

interface Cell {
  char: string;
  color: string | undefined;
}

function toCells(input: TextInput): Cell[] {
  const spans: readonly TextSpan[] = typeof input === "string" ? [{ text: input }] : input;
  const cells: Cell[] = [];
  for (const span of spans) {
    // Array.from walks code points, so astral characters stay one cell.
    for (const char of Array.from(span.text)) cells.push({ char, color: span.color });
  }
  return cells;
}

/** Greedy word wrap. Spaces at a break are dropped; a word longer than the
 * whole line is hard-split rather than overflowing. */
export function wrapCells(cells: Cell[], maxCols: number): Cell[][] {
  const lines: Cell[][] = [];
  let line: Cell[] = [];
  let i = 0;
  const flush = () => {
    while (line.length > 0 && line[line.length - 1]!.char === " ") line.pop();
    lines.push(line);
    line = [];
  };
  while (i < cells.length) {
    const cell = cells[i]!;
    if (cell.char === "\n") {
      flush();
      i++;
      continue;
    }
    if (cell.char === " ") {
      if (line.length > 0 && line.length < maxCols) line.push(cell);
      i++;
      continue;
    }
    // Measure the word starting here.
    let end = i;
    while (end < cells.length && cells[end]!.char !== " " && cells[end]!.char !== "\n") end++;
    const word = cells.slice(i, end);
    if (line.length + word.length <= maxCols) {
      line.push(...word);
      i = end;
    } else if (line.length === 0) {
      line.push(...word.slice(0, maxCols)); // longer than a line: split it
      i += maxCols;
      flush();
    } else {
      flush();
    }
  }
  if (line.length > 0 || lines.length === 0) flush();
  return lines;
}

export function layoutText(input: TextInput, options: LayoutOptions = {}): TextLayout {
  const maxCols = Math.max(1, options.maxCols ?? Number.MAX_SAFE_INTEGER);
  const align = options.align ?? "left";
  const lines = wrapCells(toCells(input), maxCols);
  const widest = lines.reduce((w, l) => Math.max(w, l.length), 0);
  const width = Math.max(0, widest * ADVANCE - 1);
  const height = (lines.length - 1) * LINE_HEIGHT + GLYPH_H;

  const glyphs: PlacedGlyph[] = [];
  lines.forEach((line, row) => {
    const lineWidth = Math.max(0, line.length * ADVANCE - 1);
    const x0 = align === "left" ? 0 : align === "center" ? Math.floor((width - lineWidth) / 2) : width - lineWidth;
    line.forEach((cell, col) => {
      const slot = glyphSlot(cell.char);
      if (isBlank(slot)) return;
      glyphs.push({ x: x0 + col * ADVANCE, y: row * LINE_HEIGHT, slot, color: cell.color, order: 0 });
    });
  });
  const n = glyphs.length;
  glyphs.forEach((g, i) => (g.order = n > 1 ? i / (n - 1) : 0));
  return { glyphs, width, height, lines: lines.length };
}

/** Plain text of an input (for keys, logs and accessibility mirrors). */
export function plainText(input: TextInput): string {
  return typeof input === "string" ? input : input.map((s) => s.text).join("");
}
