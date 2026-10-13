import { describe, expect, test } from "bun:test";
import { DECAL_KINDS, DECAL_VARIANTS, DecalKind } from "../../fx/decals/decalPool";
import { MARK_CELL, MARK_KINDS, MARK_ROWS, MARK_VARIANTS, marksDataRgba, paintFloorMarks } from "./marks";

describe("floor marks atlas", () => {
  const p = paintFloorMarks();

  test("laid out the way the decal pool counts", () => {
    expect(p.w).toBe(MARK_CELL * MARK_VARIANTS);
    expect(p.h).toBe(MARK_CELL * MARK_KINDS);
    expect(MARK_KINDS).toBe(DECAL_KINDS);
    expect(MARK_VARIANTS).toBe(DECAL_VARIANTS);
    MARK_ROWS.forEach((name, row) => expect<number>(DecalKind[name]).toBe(row));
  });

  test("deterministic", () => {
    expect(paintFloorMarks().color).toEqual(p.color);
  });

  test("alpha-cut: every texel solid or absent", () => {
    for (let i = 0; i < p.w * p.h; i++) expect([0, 255]).toContain(p.color[i * 4 + 3]);
  });

  /** Coverage, glowing specks and grey-ness of one cell. */
  function cell(row: number, v: number) {
    let on = 0;
    let glow = 0;
    let grey = 0;
    let edge = 0;
    for (let y = 0; y < MARK_CELL; y++)
      for (let x = 0; x < MARK_CELL; x++) {
        const i = (row * MARK_CELL + y) * p.w + v * MARK_CELL + x;
        if (p.color[i * 4 + 3] !== 255) continue;
        on++;
        if (p.emit![i * 4] > 0) glow++;
        if (p.color[i * 4] === p.color[i * 4 + 1] && p.color[i * 4 + 1] === p.color[i * 4 + 2]) grey++;
        if (x === 0 || y === 0 || x === MARK_CELL - 1 || y === MARK_CELL - 1) edge++;
      }
    return { on, glow, grey, edge, frac: on / (MARK_CELL * MARK_CELL) };
  }

  test("every cell is a mark: a fair share covered, never touching the cell's edge", () => {
    for (let row = 0; row < MARK_KINDS; row++)
      for (let v = 0; v < MARK_VARIANTS; v++) {
        const c = cell(row, v);
        expect(c.frac).toBeGreaterThan(0.06);
        expect(c.frac).toBeLessThan(0.85);
        expect(c.edge).toBe(0);
      }
  });

  test("scorches and ash glow with specks; goo is painted grey for the tint", () => {
    for (let v = 0; v < MARK_VARIANTS; v++) {
      expect(cell(DecalKind.scorch, v).glow).toBeGreaterThan(20);
      expect(cell(DecalKind.ash, v).glow).toBeGreaterThan(20);
      const g = cell(DecalKind.goo, v);
      expect(g.grey).toBe(g.on);
    }
  });

  test("variants differ", () => {
    const sig = (v: number) => cell(DecalKind.scorch, v).on;
    expect(new Set([0, 1, 2, 3].map(sig)).size).toBeGreaterThan(1);
  });

  test("data map: roughness in R, speck lifetime in G, sheen in B", () => {
    const d = marksDataRgba(p);
    expect(d.length).toBe(p.w * p.h * 4);
    let glassy = 0;
    for (let i = 0; i < p.w * p.h; i++) {
      expect(d[i * 4 + 1]).toBe(p.emit![i * 4]);
      if (p.color[i * 4 + 3] !== 255) continue;
      if (d[i * 4] < 100) glassy++;
      // Matte texels (soot, ash) keep little sheen; glossy ones all of it.
      if (d[i * 4] >= 230) expect(d[i * 4 + 2]).toBeLessThan(60);
      else expect(d[i * 4 + 2]).toBe(255);
    }
    expect(glassy).toBeGreaterThan(100);
  });
});
