import { describe, expect, test } from "bun:test";
import { ADVANCE, FONT_CHARS, GLYPH_COUNT, GLYPH_H, GLYPH_W, LINE_HEIGHT, RUNE_BASE, glyphBitmap, glyphSlot } from "./glyphs";
import { layoutText, plainText } from "./layout";

describe("pixel font", () => {
  test("every glyph parses to a full cell and ASCII is complete", () => {
    for (let slot = 0; slot < GLYPH_COUNT; slot++) {
      const bmp = glyphBitmap(slot);
      expect(bmp.length).toBe(GLYPH_H);
      for (const row of bmp) expect(row.length).toBe(GLYPH_W);
    }
    for (let c = 0x20; c < 0x7f; c++) expect(FONT_CHARS).toContain(String.fromCharCode(c));
  });

  test("letters have ink, runes live after the font", () => {
    const ink = (slot: number) => glyphBitmap(slot).flat().filter(Boolean).length;
    expect(ink(glyphSlot("A"))).toBeGreaterThan(8);
    expect(ink(glyphSlot(" "))).toBe(0);
    expect(ink(RUNE_BASE)).toBeGreaterThan(8);
  });

  test("unknown characters fall back sensibly", () => {
    expect(glyphSlot("é")).toBe(glyphSlot("e"));
    expect(glyphSlot("’")).toBe(glyphSlot("'"));
    expect(glyphSlot("✕")).toBe(glyphSlot("×"));
    expect(glyphSlot("漢")).toBe(glyphSlot("□"));
  });

  test("glyphs that descend use the eighth row, others don't", () => {
    expect(glyphBitmap(glyphSlot("g"))[7]!.some(Boolean)).toBe(true);
    expect(glyphBitmap(glyphSlot("a"))[7]!.some(Boolean)).toBe(false);
  });
});

describe("layoutText", () => {
  test("one line: glyphs advance by a cell and spaces draw nothing", () => {
    const l = layoutText("AB C");
    expect(l.lines).toBe(1);
    expect(l.glyphs.map((g) => g.x)).toEqual([0, ADVANCE, 3 * ADVANCE]);
    expect(l.width).toBe(4 * ADVANCE - 1);
    expect(l.height).toBe(GLYPH_H);
  });

  test("wraps at word boundaries and drops the breaking space", () => {
    const l = layoutText("the deep lets go", { maxCols: 8 });
    expect(l.lines).toBe(2);
    const rows = [...new Set(l.glyphs.map((g) => g.y))];
    expect(rows).toEqual([0, LINE_HEIGHT]);
    expect(l.height).toBe(LINE_HEIGHT + GLYPH_H);
  });

  test("hard-splits a word longer than the line", () => {
    const l = layoutText("ABCDEFGHIJ", { maxCols: 4 });
    expect(l.lines).toBe(3);
  });

  test("newlines break, and blank lines are kept", () => {
    expect(layoutText("A\n\nB").lines).toBe(3);
  });

  test("alignment shifts shorter lines", () => {
    const center = layoutText("AAAA\nBB", { align: "center" });
    const right = layoutText("AAAA\nBB", { align: "right" });
    const firstB = (l: ReturnType<typeof layoutText>) => l.glyphs.find((g) => g.y > 0)!.x;
    expect(firstB(center)).toBe(ADVANCE);
    expect(firstB(right)).toBe(2 * ADVANCE);
  });

  test("spans keep their colours through wrapping; order runs 0..1", () => {
    const l = layoutText([{ text: "take " }, { text: "Ember Staff", color: "#ff6a2a" }], { maxCols: 6 });
    expect(l.glyphs[0]!.color).toBeUndefined();
    expect(l.glyphs.at(-1)!.color).toBe("#ff6a2a");
    expect(l.glyphs[0]!.order).toBe(0);
    expect(l.glyphs.at(-1)!.order).toBe(1);
    expect(plainText([{ text: "a" }, { text: "b" }])).toBe("ab");
  });

  test("empty text is a valid, empty block", () => {
    const l = layoutText("");
    expect(l.glyphs.length).toBe(0);
    expect(l.lines).toBe(1);
  });
});
