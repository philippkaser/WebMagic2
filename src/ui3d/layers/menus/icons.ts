import { DataTexture, NearestFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType } from "three";
import { ink, shade } from "../../theme";

/** The grimoire's little pixel sprites (after artpass `ui/pixelArt.ts`):
 * the gem, hourglass and pact rings of the title cards, the skulls of the
 * death rites, and the four gear slots an empty card shows faintly. Each
 * sprite is rows of palette keys painted into a tiny DataTexture once per
 * tint and drawn with nearest sampling, so a pixel stays a pixel at any
 * size — the same zero-asset trick as the world's textures.
 *
 * Palette keys: `a/b/c` are the tint (base, light, dark), so one bitmap
 * serves every colour; `o` is the ink outline; the rest are fixed (wood,
 * brass, bone, arcane). `.` is transparent. */

/** The pact sigil: two interlocked rings, rasterised from circle maths (the
 * left ring passes over the right at the top crossing, under at the bottom). */
function ringsRows(): string[] {
  const W = 15;
  const H = 9;
  const rows: string[] = [];
  const ring = (x: number, y: number, cx: number) => Math.abs(Math.hypot(x - cx, (y - 4) * 1.05) - 3.6) < 0.75;
  for (let y = 0; y < H; y++) {
    let row = "";
    for (let x = 0; x < W; x++) {
      const l = ring(x, y, 4.5);
      const r = ring(x, y, 9.5);
      if (l && r) row += y < 4 ? "b" : "c";
      else if (l) row += "b";
      else if (r) row += "a";
      else row += ".";
    }
    rows.push(row);
  }
  return rows;
}

export const SPRITES = {
  staff: [
    "...........oo...",
    "..........obbo..",
    ".........obbaao.",
    "........mobaaco.",
    "........mMoacco.",
    ".........nmoco..",
    "........oWnmo...",
    ".......oWwo.....",
    "......oWwo......",
    ".....oWwo.......",
    "....oWwo........",
    "...oWwo.........",
    "..oWwo..........",
    ".oWdo...........",
    ".odo............",
    "..o.............",
  ],
  amulet: [
    "....mn....nm....",
    "...n........n...",
    "..m..........m..",
    "..n..........n..",
    "...m........m...",
    "....n......n....",
    ".....m....m.....",
    "......oMMo......",
    ".....omMMmo.....",
    "....omoooomo....",
    "...omobbaaomo...",
    "...omobaaacmo...",
    "...omoaaaccmo...",
    "....omoccomo....",
    ".....ommmmo.....",
    "......oooo......",
  ],
  cloak: [
    "......oooo......",
    ".....obbaao.....",
    "....obakkaco....",
    "....obkkkkco....",
    "...obakkkkaco...",
    "...obaakkaacco..",
    "..obaaaMMaaaco..",
    "..obaaaaaaaacco.",
    "..obaaaaaaaacco.",
    ".obaaaaaaaaaacco",
    ".obaaaaaaaaaacco",
    ".obaacaaaacaacco",
    "obaaacaaaacaaacc",
    "obaaacaaaacaaaco",
    "occcoccocccoccco",
    ".ooo.oo.ooo.ooo.",
  ],
  boots: [
    "................",
    ".....oooooo.....",
    ".....obbaco.....",
    ".....mMmmmo.....",
    ".....obaaco.....",
    ".....obaaco.....",
    ".....obaaco.....",
    ".....obaaco.....",
    ".....obaacoo....",
    "....obaaaaacoo..",
    "....obaaaaaaaco.",
    "....obaaaaaaaaco",
    "....oddddddddddo",
    ".....oooooooooo.",
    "................",
    "................",
  ],
  skull: [
    "..oooooooo..",
    ".osssssssSo.",
    "ossssssssSSo",
    "ossssssssSSo",
    "oskkssskksSo",
    "oskkssskksSo",
    "osssskkssSSo",
    ".osssssssSo.",
    "..osssssSo..",
    "..oskskskso.",
    "...oooooo...",
  ],
  gem: ["..ooo..", ".obbao.", "obbaaco", "oaaaaco", ".oacco.", "..oco..", "...o..."],
  hourglass: ["ommmmmo", ".obbbo.", "..oao..", "...o...", "..oao..", ".oaaao.", "ommmmmo"],
  pact: ringsRows(),
} satisfies Record<string, string[]>;

export type SpriteName = keyof typeof SPRITES;

function palette(tint: string): Record<string, string> {
  return {
    o: ink.ink,
    a: tint,
    b: shade(tint, 0.45),
    c: shade(tint, -0.45),
    w: "#6b4426",
    W: "#9c6a3c",
    d: "#3f2614",
    m: ink.brass,
    M: ink.brassLight,
    n: ink.brassDark,
    k: "#140c14",
    s: "#e9dfc8",
    S: "#9d917c",
    g: ink.arcane,
  };
}

/** Size of a sprite in its own pixels. */
export function spriteSize(name: SpriteName): { w: number; h: number } {
  const rows: readonly string[] = SPRITES[name];
  return { w: rows.reduce((w, r) => Math.max(w, r.length), 0), h: rows.length };
}

/** RGBA bytes of a sprite, row 0 at the BOTTOM (texture order). Pure, so
 * tests can check the painting without a GPU. */
export function spritePixels(name: SpriteName, tint: string): Uint8Array {
  const rows: readonly string[] = SPRITES[name];
  const { w, h } = spriteSize(name);
  const pal = palette(tint);
  const data = new Uint8Array(w * h * 4);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const hex = pal[row[x]!];
      if (!hex) continue;
      const n = parseInt(hex.slice(1, 7), 16);
      const i = ((h - 1 - y) * w + x) * 4;
      data[i] = (n >> 16) & 255;
      data[i + 1] = (n >> 8) & 255;
      data[i + 2] = n & 255;
      data[i + 3] = 255;
    }
  });
  return data;
}

const cache = new Map<string, DataTexture>();

/** The sprite as a nearest-filtered texture, cached per tint. */
export function spriteTexture(name: SpriteName, tint: string): DataTexture {
  const key = `${name}|${tint}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { w, h } = spriteSize(name);
  const t = new DataTexture(spritePixels(name, tint), w, h, RGBAFormat, UnsignedByteType);
  t.magFilter = t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}
