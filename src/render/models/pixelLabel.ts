import { CanvasTexture, NearestFilter, SpriteMaterial } from "three";

/** Floating world labels (wizard name tags, death-chest plaques) drawn with
 * a built-in 5x7 bitmap font onto tiny canvases and magnified with
 * NearestFilter — so they share the game's chunky pixel grain instead of
 * looking like smooth browser text pasted into the world. */

/** Glyph rows, top to bottom, each a base-32 digit whose 5 bits are pixels. */
const GLYPHS: Record<string, string> = {
  "A": "ehhvhhh",
  "B": "uhhuhhu",
  "C": "ehggghe",
  "D": "uhhhhhu",
  "E": "vgguggv",
  "F": "vgguggg",
  "G": "ehgnhhf",
  "H": "hhhvhhh",
  "I": "e44444e",
  "J": "72222ic",
  "K": "hikokih",
  "L": "ggggggv",
  "M": "hrllhhh",
  "N": "hhpljhh",
  "O": "ehhhhhe",
  "P": "uhhuggg",
  "Q": "ehhhlid",
  "R": "uhhukih",
  "S": "fgge11u",
  "T": "v444444",
  "U": "hhhhhhe",
  "V": "hhhhha4",
  "W": "hhhllla",
  "X": "hha4ahh",
  "Y": "hha4444",
  "Z": "v1248gv",
  "0": "ehjlphe",
  "1": "4c4444e",
  "2": "eh1248v",
  "3": "v2421he",
  "4": "26aiv22",
  "5": "vgu11he",
  "6": "68guhhe",
  "7": "v124888",
  "8": "ehhehhe",
  "9": "ehhf12c",
  " ": "0000000",
  ".": "00000cc",
  ",": "0000c48",
  "'": "4480000",
  "-": "000v000",
  ":": "0cc0cc0",
  "!": "4444404",
  "?": "eh12404",
  "·": "000cc00",
  "✝": "4e44440",
  "_": "000000v",
  "/": "122488g",
  "◆": "04eve40",
  "#": "avaava0",
  "+": "044v440",
  "(": "2488842",
  ")": "8422248",
};

const GLYPH_W = 5;
const GLYPH_H = 7;
const ADVANCE = GLYPH_W + 1;
/** World units per label pixel. */
export const LABEL_PIXEL = 0.022;

function glyph(ch: string): string {
  return GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? GLYPHS["?"];
}

function textWidth(text: string): number {
  return Math.max(0, text.length * ADVANCE - 1);
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  // One-pixel drop shadow first, then the letters.
  for (const [dx, dy, c] of [
    [1, 1, "rgba(0,0,0,0.85)"],
    [0, 0, color],
  ] as const) {
    ctx.fillStyle = c;
    for (let i = 0; i < text.length; i++) {
      const rows = glyph(text[i]);
      for (let r = 0; r < GLYPH_H; r++) {
        const bits = parseInt(rows[r], 32);
        for (let b = 0; b < GLYPH_W; b++) {
          if (bits & (1 << (GLYPH_W - 1 - b))) ctx.fillRect(x + i * ADVANCE + b + dx, y + r + dy, 1, 1);
        }
      }
    }
  }
}

/** Tiny 3x3 diamond flourish. */
function rune(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(cx, cy - 1, 1, 3);
  ctx.fillRect(cx - 1, cy, 3, 1);
}

export interface LabelLine {
  text: string;
  color: string;
}

export interface LabelSpec {
  lines: LabelLine[];
  /** Border / flourish color. */
  accent: string;
  /** Optional health pips under the text. */
  pips?: { filled: number; total: number; color: string };
}

const cache = new Map<string, SpriteMaterial>();

/** A sprite material for a label, cached by content. `userData.size` holds
 * the label's [width, height] in world units for the sprite's scale. */
export function pixelLabel(spec: LabelSpec): SpriteMaterial {
  const lines = spec.lines.map((l) => ({ ...l, text: l.text.slice(0, 20) }));
  const key = JSON.stringify([lines, spec.accent, spec.pips]);
  const hit = cache.get(key);
  if (hit) return hit;

  const padX = 7;
  const lineH = GLYPH_H + 3;
  const pipRow = spec.pips ? 6 : 0;
  const pipW = spec.pips ? spec.pips.total * 4 - 1 : 0;
  const inner = Math.max(pipW, ...lines.map((l) => textWidth(l.text)));
  const w = inner + padX * 2;
  const h = lines.length * lineH + pipRow + 5;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // Plate with notched corners and a thin accent border.
  ctx.fillStyle = "rgba(8,6,16,0.8)";
  ctx.fillRect(1, 0, w - 2, h);
  ctx.fillRect(0, 1, w, h - 2);
  ctx.fillStyle = spec.accent;
  ctx.globalAlpha = 0.7;
  ctx.fillRect(2, 0, w - 4, 1);
  ctx.fillRect(2, h - 1, w - 4, 1);
  ctx.fillRect(0, 2, 1, h - 4);
  ctx.fillRect(w - 1, 2, 1, h - 4);
  ctx.globalAlpha = 1;
  rune(ctx, 3, 4 + Math.floor(GLYPH_H / 2) - 1, spec.accent);
  rune(ctx, w - 4, 4 + Math.floor(GLYPH_H / 2) - 1, spec.accent);

  lines.forEach((l, i) => {
    drawText(ctx, l.text, Math.floor((w - textWidth(l.text)) / 2), 3 + i * lineH, l.color);
  });

  if (spec.pips) {
    const y = 3 + lines.length * lineH;
    const x0 = Math.floor((w - pipW) / 2);
    for (let i = 0; i < spec.pips.total; i++) {
      ctx.fillStyle = i < spec.pips.filled ? spec.pips.color : "rgba(60,50,70,0.9)";
      ctx.fillRect(x0 + i * 4, y, 3, 3);
    }
  }

  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  const material = new SpriteMaterial({ map: tex, depthWrite: false, transparent: true });
  material.userData.size = [w * LABEL_PIXEL, h * LABEL_PIXEL];
  if (cache.size > 200) {
    for (const m of cache.values()) {
      m.map?.dispose();
      m.dispose();
    }
    cache.clear();
  }
  cache.set(key, material);
  return material;
}
