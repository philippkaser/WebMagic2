import { PIXEL_METRICS, type FontMetrics } from "./metrics";

/** Pure text layout: wrapping, alignment and reading order, in font pixels,
 * for any face described by FontMetrics (proportional pixel fonts included).
 * No three.js here — RuneText turns the result into instances, tests read it
 * directly. */

/** A run of text in one colour. Plain strings are one span in the default
 * colour; `color: undefined` also means "the default". */
export interface TextSpan {
  text: string;
  color?: string;
}

export type TextInput = string | readonly TextSpan[];

export type Align = "left" | "center" | "right";

export interface LayoutOptions {
  /** Wrap width in characters of the face's typical advance (default: never
   * wrap except at "\n"). */
  maxCols?: number;
  /** Wrap width in font pixels (wins over maxCols). */
  maxWidth?: number;
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
  slot: number;
  advance: number;
}

function toCells(input: TextInput, m: FontMetrics): Cell[] {
  const spans: readonly TextSpan[] = typeof input === "string" ? [{ text: input }] : input;
  const cells: Cell[] = [];
  for (const span of spans) {
    // Array.from walks code points, so astral characters stay one cell.
    for (const char of Array.from(span.text)) {
      const slot = m.slotOf(char);
      cells.push({ char, color: span.color, slot, advance: char === "\n" ? 0 : m.advanceOf(slot) });
    }
  }
  return cells;
}

const widthOf = (cells: readonly Cell[]) => cells.reduce((w, c) => w + c.advance, 0);

/** Greedy word wrap by pixel width. Spaces at a break are dropped; a word
 * wider than the whole line is hard-split rather than overflowing. */
function wrapCells(cells: Cell[], maxWidth: number): Cell[][] {
  const lines: Cell[][] = [];
  let line: Cell[] = [];
  let lineW = 0;
  let i = 0;
  const flush = () => {
    while (line.length > 0 && line[line.length - 1]!.char === " ") line.pop();
    lines.push(line);
    line = [];
    lineW = 0;
  };
  while (i < cells.length) {
    const cell = cells[i]!;
    if (cell.char === "\n") {
      flush();
      i++;
      continue;
    }
    if (cell.char === " ") {
      if (line.length > 0 && lineW + cell.advance < maxWidth) {
        line.push(cell);
        lineW += cell.advance;
      }
      i++;
      continue;
    }
    // Measure the word starting here.
    let end = i;
    while (end < cells.length && cells[end]!.char !== " " && cells[end]!.char !== "\n") end++;
    const word = cells.slice(i, end);
    const wordW = widthOf(word);
    if (lineW + wordW <= maxWidth) {
      line.push(...word);
      lineW += wordW;
      i = end;
    } else if (line.length === 0) {
      // Wider than a line: take what fits (at least one glyph) and break.
      let n = 0;
      let w = 0;
      while (n < word.length && (n === 0 || w + word[n]!.advance <= maxWidth)) w += word[n++]!.advance;
      line.push(...word.slice(0, n));
      i += n;
      flush();
    } else {
      flush();
    }
  }
  if (line.length > 0 || lines.length === 0) flush();
  return lines;
}

export function layoutText(input: TextInput, options: LayoutOptions = {}, metrics: FontMetrics = PIXEL_METRICS): TextLayout {
  const maxWidth = Math.max(
    1,
    options.maxWidth ?? (options.maxCols !== undefined ? options.maxCols * metrics.avgAdvance : Number.MAX_SAFE_INTEGER),
  );
  const align = options.align ?? "left";
  const lines = wrapCells(toCells(input, metrics), maxWidth);
  // The last glyph's advance includes the letter gap; the block ends at ink.
  const lineWidths = lines.map((l) => Math.max(0, widthOf(l) - 1));
  const width = lineWidths.reduce((w, lw) => Math.max(w, lw), 0);
  const height = (lines.length - 1) * metrics.lineHeight + metrics.boxHeight;

  const glyphs: PlacedGlyph[] = [];
  lines.forEach((line, row) => {
    const lineWidth = lineWidths[row]!;
    let x = align === "left" ? 0 : align === "center" ? Math.floor((width - lineWidth) / 2) : width - lineWidth;
    for (const cell of line) {
      if (!metrics.isBlank(cell.slot)) {
        glyphs.push({ x, y: row * metrics.lineHeight, slot: cell.slot, color: cell.color, order: 0 });
      }
      x += cell.advance;
    }
  });
  const n = glyphs.length;
  glyphs.forEach((g, i) => (g.order = n > 1 ? i / (n - 1) : 0));
  return { glyphs, width, height, lines: lines.length };
}

/** Plain text of an input (for keys, logs and accessibility mirrors). */
export function plainText(input: TextInput): string {
  return typeof input === "string" ? input : input.map((s) => s.text).join("");
}
