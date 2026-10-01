import type { DataTexture } from "three";
import jacquardUrl from "@fontsource/jacquard-12/files/jacquard-12-latin-400-normal.woff2?url";
import jerseyUrl from "@fontsource/jersey-15/files/jersey-15-latin-400-normal.woff2?url";
import silkscreenUrl from "@fontsource/silkscreen/files/silkscreen-latin-400-normal.woff2?url";
import tiny5Url from "@fontsource/tiny5/files/tiny5-latin-400-normal.woff2?url";
import { ATLAS_COLS, ATLAS_PAD, CELL_H, CELL_W, atlasTexture, glyphAtlas, inkToAtlas } from "./atlas";
import { GLYPH_H, GLYPH_W, RUNE_BASE, RUNE_COUNT, glyphBitmap, glyphSlot, type Bitmap } from "./glyphs";
import { PIXEL_METRICS, type FontMetrics } from "./metrics";

/** The UI's typefaces:
 *
 *   title    Jacquard 12 — pixel blackletter for the BIG moments only
 *            ("WebMagic", "Floor 12", "You Died"); blackletter turns to
 *            lace below ~3 % of the screen height
 *   heading  Jersey 15 — a sturdy pixel face for every smaller title (biome
 *            names, panel headlines, boss and item names): reads at a glance
 *   body     Tiny5 — crisp pixel sans for everything you read
 *   label  Silkscreen — tiny all-caps labels and numbers
 *   pixel  the hand-set 5×7 fallback (glyphs.ts): symbols the web fonts
 *          lack, tests, and anything before the fonts arrive
 *
 * The web fonts come from @fontsource (bundled by Vite — the one exception
 * to "everything procedural": type is craft we don't redraw). They are
 * pixel fonts, so rasterized at their NATIVE size (measured: Jacquard 12 is
 * pixel-exact at 21 px with a 12 px cap, Jersey 15 at 27 px with a 15 px
 * cap, Tiny5 and Silkscreen at 8 px with a 5 px cap) and thresholded to 1 bit, every glyph is its designer's exact
 * pixels — then packed into the same halo/outline atlas the rune shader
 * already reads. Glyphs the font lacks (arrows, ◆, ○…) and the sixteen
 * materialize runes are drawn from the hand-set bitmaps, scaled by whole
 * pixels to the face's cap height. */

export type FontId = "title" | "heading" | "body" | "label" | "pixel";

/** Everything RuneText needs: layout metrics plus where glyphs sit in the
 * atlas texture. All in font pixels. */
export interface Face extends FontMetrics {
  id: FontId;
  texture: DataTexture;
  cellW: number;
  cellH: number;
  cols: number;
  /** Where a glyph's layout origin (pen x, line-box top) sits inside its
   * cell — the shader offsets each quad by this. */
  originX: number;
  originY: number;
  /** Half the typical glyph box — the pivot glyphs tumble around. */
  halfGlyphW: number;
  halfGlyphH: number;
}

interface WebFaceSpec {
  id: Exclude<FontId, "pixel">;
  family: string;
  url: string;
  /** Native rasterization size (px) — where the font is pixel-exact. */
  size: number;
  /** Line pitch, font pixels. */
  lineHeight: number;
}

const SPECS: WebFaceSpec[] = [
  // Line pitches are tight on purpose: a 5 px cap with 3 px of air reads as
  // a page of a grimoire, not a spreadsheet.
  { id: "title", family: "Jacquard 12", url: jacquardUrl, size: 21, lineHeight: 21 },
  { id: "heading", family: "Jersey 15", url: jerseyUrl, size: 27, lineHeight: 22 },
  { id: "body", family: "Tiny5", url: tiny5Url, size: 8, lineHeight: 8 },
  { id: "label", family: "Silkscreen", url: silkscreenUrl, size: 8, lineHeight: 8 },
];

/** Characters rasterized from each web font (when the font has them). */
const CHARSET: string[] = (() => {
  const chars: string[] = [];
  for (let c = 0x20; c < 0x7f; c++) chars.push(String.fromCharCode(c));
  for (let c = 0xa1; c <= 0xff; c++) if (c !== 0xad) chars.push(String.fromCharCode(c));
  chars.push(..."—–…‘’“”•€™");
  return chars;
})();

/** Symbols always drawn from the hand-set font (pixel fonts rarely carry
 * them, and the fallback's versions match the pixel look). */
const SYMBOLS = "←→↑↓▲▼◆◇○●◉♥✦□■°×·";

let pixelFace: Face | null = null;

/** The hand-set fallback as a Face (synchronous, no DOM). */
export function getPixelFace(): Face {
  return (pixelFace ??= {
    ...PIXEL_METRICS,
    id: "pixel",
    texture: glyphAtlas(),
    cellW: CELL_W,
    cellH: CELL_H,
    cols: ATLAS_COLS,
    originX: ATLAS_PAD,
    originY: ATLAS_PAD,
    halfGlyphW: GLYPH_W / 2,
    halfGlyphH: GLYPH_H / 2,
  });
}

// ── Web faces ────────────────────────────────────────────────────────────────

const faces = new Map<FontId, Face>();
let ready: Promise<void> | null = null;
let isReady = false;

/** Load and rasterize every web face (idempotent). Resolves even if a font
 * fails to load — that face then falls back to the pixel font. */
export function loadFaces(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    if (typeof document === "undefined" || typeof FontFace === "undefined") return;
    await Promise.all(
      SPECS.map(async (spec) => {
        try {
          const ff = new FontFace(spec.family, `url(${spec.url})`);
          await ff.load();
          document.fonts.add(ff);
          faces.set(spec.id, rasterize(spec));
        } catch (err) {
          console.warn(`[ui3d] font ${spec.family} unavailable, using the pixel fallback`, err);
        }
      }),
    );
  })().finally(() => {
    isReady = true;
  });
  return ready;
}

export function facesReady(): boolean {
  return isReady;
}

/** A face by id (the pixel fallback until/unless the web font is ready). */
export function getFace(id: FontId = "body"): Face {
  return (id !== "pixel" && faces.get(id)) || getPixelFace();
}

/** Suspend a React subtree until the fonts are rasterized (UiCanvas wraps
 * the UI in Suspense), so every layout measures with the real faces. */
export function useFacesReady(): void {
  if (isReady) return;
  throw loadFaces();
}

const PAD = 4; // ≥ halo radius + 1: halos never bleed between cells

function rasterize(spec: WebFaceSpec): Face {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const font = `${spec.size}px "${spec.family}"`;
  const probe = (f: string, ch: string) => {
    ctx.font = f;
    return ctx.measureText(ch).width;
  };
  // A glyph the font lacks renders in a fallback family — its width then
  // differs between two different fallbacks. Pixel-font glyphs don't care.
  const has = (ch: string) =>
    ch === " " || probe(`${font}, monospace`, ch) === probe(`${font}, serif`, ch);

  ctx.font = font;
  const hm = ctx.measureText("H");
  const capHeight = Math.max(1, Math.round(hm.actualBoundingBoxAscent));
  const fm = ctx.measureText("ÅÉgjpqy|");
  const ascent = Math.ceil(fm.fontBoundingBoxAscent);
  const descent = Math.ceil(Math.max(fm.fontBoundingBoxDescent, ctx.measureText("gjpqy").actualBoundingBoxDescent));
  const inkDescent = Math.ceil(ctx.measureText("gjpqy,;").actualBoundingBoxDescent);

  // Which characters come from the font, which from the hand-set bitmaps.
  const fromFont = CHARSET.filter((ch) => !SYMBOLS.includes(ch) && has(ch));
  const symbolChars = [...SYMBOLS].filter((ch) => !fromFont.includes(ch));
  const runeScale = Math.max(1, Math.round(capHeight / 7));

  let left = 0;
  let boxW = 0;
  const advances: number[] = [];
  for (const ch of fromFont) {
    const m = ctx.measureText(ch);
    left = Math.max(left, Math.ceil(m.actualBoundingBoxLeft));
    boxW = Math.max(boxW, Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight));
    advances.push(Math.round(m.width));
  }
  boxW = Math.max(boxW, GLYPH_W * runeScale);
  const cellW = boxW + left + PAD * 2;
  const cellH = ascent + descent + PAD * 2;
  const baseline = PAD + ascent; // within a cell

  const slots = new Map<string, number>();
  const bitmapSlots: Bitmap[] = [];
  fromFont.forEach((ch, i) => slots.set(ch, i));
  const symbolBase = fromFont.length;
  symbolChars.forEach((ch, i) => {
    slots.set(ch, symbolBase + i);
    bitmapSlots.push(glyphBitmap(glyphSlot(ch)));
    advances.push((GLYPH_W - 0) * runeScale);
  });
  const runeBase = symbolBase + symbolChars.length;
  for (let r = 0; r < RUNE_COUNT; r++) {
    bitmapSlots.push(glyphBitmap(RUNE_BASE + r));
    advances.push(GLYPH_W * runeScale);
  }
  const count = runeBase + RUNE_COUNT;
  const cols = 16;
  const rows = Math.ceil(count / cols);
  const width = cols * cellW;
  const height = rows * cellH;
  const ink = new Uint8Array(width * height);

  // Font glyphs: draw each alone, threshold to 1 bit, copy into its cell.
  canvas.width = cellW;
  canvas.height = cellH;
  fromFont.forEach((ch, slot) => {
    ctx.clearRect(0, 0, cellW, cellH);
    ctx.font = font;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#fff";
    ctx.fillText(ch, PAD + left, baseline);
    const px = ctx.getImageData(0, 0, cellW, cellH).data;
    const ox = (slot % cols) * cellW;
    const oy = Math.floor(slot / cols) * cellH;
    for (let y = 0; y < cellH; y++)
      for (let x = 0; x < cellW; x++) if (px[(y * cellW + x) * 4 + 3]! >= 128) ink[(oy + y) * width + ox + x] = 1;
  });

  // Hand-set bitmaps (symbols, runes): scaled by whole pixels, standing on
  // the baseline (their 7-row body = cap height, row 8 = descender).
  bitmapSlots.forEach((bmp, i) => {
    const slot = symbolBase + i;
    const ox = (slot % cols) * cellW + PAD + left;
    const oy = Math.floor(slot / cols) * cellH + baseline - 7 * runeScale;
    for (let y = 0; y < GLYPH_H; y++)
      for (let x = 0; x < GLYPH_W; x++) {
        if (!bmp[y]![x]) continue;
        for (let sy = 0; sy < runeScale; sy++)
          for (let sx = 0; sx < runeScale; sx++) {
            const tx = ox + x * runeScale + sx;
            const ty = oy + y * runeScale + sy;
            if (ty >= 0 && ty < height) ink[ty * width + tx] = 1;
          }
      }
  });

  const texture = atlasTexture(inkToAtlas(ink, width, height), width, height);
  const space = slots.get(" ") ?? 0;
  const box = slots.get("□") ?? slots.get("?") ?? 0;
  const avgSample = "etaoinshrdlucmfw";
  const avgAdvance = [...avgSample].reduce((s, ch) => s + (advances[slots.get(ch) ?? space] ?? 0), 0) / avgSample.length;
  const lineHeight = spec.lineHeight;

  const slotOf = (char: string): number => {
    const direct = slots.get(char);
    if (direct !== undefined) return direct;
    const base = char.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return slots.get(base) ?? box;
  };

  return {
    id: spec.id,
    texture,
    cellW,
    cellH,
    cols,
    // Layout boxes start one pixel above the cap, so blocks centre on what
    // you actually read rather than on the font's (tall) ascender room.
    originX: PAD + left,
    originY: baseline - capHeight - 1,
    halfGlyphW: avgAdvance / 2,
    halfGlyphH: (capHeight + 1) / 2,
    slotOf,
    advanceOf: (slot) => advances[slot] ?? avgAdvance,
    isBlank: (slot) => slot === space,
    lineHeight,
    boxHeight: capHeight + 1 + inkDescent,
    capHeight,
    avgAdvance,
    runeBase,
    runeCount: RUNE_COUNT,
  };
}
