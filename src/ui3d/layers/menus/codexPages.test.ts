import { describe, expect, test } from "bun:test";
import { BIOME_DEFS, biomeForFloor } from "../../../world/biomes";
import { allLoreFragments } from "../../../world/lore";
import {
  chapters,
  codexSpreads,
  linesOf,
  pageText,
  paginate,
  splitToFit,
  type CodexBand,
  type CodexFragment,
} from "./codexPages";

const SIZE = { cols: 30, lines: 16 };
const bands: CodexBand[] = [
  { id: "a", name: "Upper", floors: [1, 9] },
  { id: "b", name: "Lower", floors: [10, 20] },
];
const bandOf = (floor: number) => (floor <= 9 ? "a" : "b");
const frag = (id: string, minFloor: number, words = 20): CodexFragment => ({
  id,
  title: `Fragment ${id}`,
  text: Array.from({ length: words }, (_, i) => `word${i}`).join(" "),
  minFloor,
});

describe("codex pagination", () => {
  test("groups by band in depth order, shallowest first within a band, drops empty bands", () => {
    const read = [frag("x", 12), frag("y", 3), frag("z", 1)];
    const groups = chapters(read, bands, bandOf);
    expect(groups.map((g) => g.band.id)).toEqual(["a", "b"]);
    expect(groups[0]!.entries.map((e) => e.id)).toEqual(["z", "y"]);
    expect(chapters([frag("q", 15)], bands, bandOf).map((g) => g.band.id)).toEqual(["b"]);
  });

  test("no page overflows its line budget, measured the way the font renders", () => {
    const read = Array.from({ length: 9 }, (_, i) => frag(`f${i}`, 1 + i * 2, 10 + i * 7));
    const pages = paginate(chapters(read, bands, bandOf), SIZE);
    for (const p of pages) {
      expect(p.lines).toBeLessThanOrEqual(SIZE.lines);
      expect(linesOf(pageText(p), SIZE.cols)).toBe(p.lines);
    }
  });

  test("every fragment appears exactly once, and chapters start on a fresh page", () => {
    const read = Array.from({ length: 6 }, (_, i) => frag(`f${i}`, i < 3 ? 2 : 14, 12));
    const pages = paginate(chapters(read, bands, bandOf), SIZE);
    const all = pages.map(pageText).join("|");
    for (const f of read) expect(all.split(f.title.toUpperCase()).length - 1).toBe(1);
    for (const p of pages) {
      const heads = new Set([p.head[0]?.text]);
      expect(heads.size).toBe(1);
    }
    const upper = pages.filter((p) => p.head[0]?.text === "UPPER");
    const lower = pages.filter((p) => p.head[0]?.text === "LOWER");
    expect(upper.length).toBeGreaterThan(0);
    expect(lower.length).toBeGreaterThan(0);
    expect(pages.indexOf(lower[0]!)).toBe(upper.length);
  });

  test("a fragment that fits a page is never split; one that doesn't continues overleaf", () => {
    const small = paginate(chapters([frag("a", 1, 30), frag("b", 2, 30)], bands, bandOf), SIZE);
    for (const p of small) {
      const t = pageText(p);
      // Each page holds whole fragments: the words come in complete runs.
      if (t.includes("FRAGMENT A")) expect(t).toContain("word29");
    }
    const huge = frag("h", 1, 200);
    const pages = paginate(chapters([huge], bands, bandOf), SIZE);
    expect(pages.length).toBeGreaterThan(1);
    const words = pages.map(pageText).join(" ").match(/word\d+/g)!;
    expect(words.length).toBe(200);
    expect(words[0]).toBe("word0");
    expect(words[199]).toBe("word199");
    for (const p of pages) expect(p.lines).toBeLessThanOrEqual(SIZE.lines);
  });

  test("folios count content pages from 1", () => {
    const pages = paginate(chapters([frag("a", 1, 120), frag("b", 12, 10)], bands, bandOf), SIZE);
    expect(pages.map((p) => p.folio)).toEqual(pages.map((_, i) => i + 1));
  });

  test("splitToFit breaks at a word and respects the budget", () => {
    const text = "the deep lets go only after five floors and not one sooner";
    const [a, b] = splitToFit(text, 12, 2)!;
    expect(linesOf(a, 12)).toBeLessThanOrEqual(2);
    expect(`${a} ${b}`).toBe(text);
    expect(splitToFit("x", 12, 0)).toBeNull();
  });
});

describe("codex spreads", () => {
  test("empty codex: title page + the invitation to go read", () => {
    const spreads = codexSpreads([], 35, bands, bandOf, SIZE);
    expect(spreads.length).toBe(1);
    expect(pageText(spreads[0]![0])).toContain("0 of 35 carvings read");
    expect(pageText(spreads[0]![1])).toContain("press E");
  });

  test("title page lists every band and the page each read chapter starts on", () => {
    const spreads = codexSpreads([frag("a", 1), frag("b", 12)], 35, bands, bandOf, SIZE);
    const title = pageText(spreads[0]![0]);
    expect(title).toContain("2 of 35 carvings read");
    expect(title).toMatch(/UPPER \.+ 1/);
    expect(title).toMatch(/LOWER \.+ 2/);
    for (const line of title.split("\n")) expect(line.length).toBeLessThanOrEqual(SIZE.cols);
  });

  test("the real lore paginates cleanly", () => {
    const all = allLoreFragments();
    const spreads = codexSpreads(all, all.length, BIOME_DEFS, biomeForFloor, SIZE);
    const text = spreads.flatMap((s) => [pageText(s[0]), pageText(s[1])]).join("\n");
    for (const f of all) expect(text).toContain(f.title.toUpperCase());
    for (const s of spreads) for (const p of s) expect(p.lines).toBeLessThanOrEqual(SIZE.lines);
  });
});
