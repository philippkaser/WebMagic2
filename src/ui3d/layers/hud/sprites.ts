import { DataTexture, NearestFilter, RGBAFormat, UnsignedByteType } from "three";
import { ink, shade } from "../../theme";

/** The grimoire's little pixel sprites — heart, drop, gem, skull, the pact
 * rings, the five run runes and the four gear silhouettes — ported from
 * artpass's ui/pixelArt.ts. Each is a few rows of characters painted once
 * per tint into a tiny nearest-filtered texture, so it stays hard-edged at
 * any size in the world (PixelSprite draws it). */

/** Palette keys every sprite uses. `a/b/c` are the tint (base, light,
 * dark), so one bitmap serves every colour. */
function paletteFor(tint: string): Record<string, string> {
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

/** Each string is one pixel row, top first; `.` is transparent. */
const SPRITES = {
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
  flask: [
    "....oooo....",
    "....owwo....",
    "....oSso....",
    "....oSso....",
    "...osSSso...",
    "..osbaaaSo..",
    ".osbaaaaaco.",
    ".obaaaaaaco.",
    ".oaaaaaaaco.",
    ".oaaaaaacco.",
    "..oaaaacco..",
    "...oooooo...",
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
  heart: [".oo...oo.", "obbo.obao", "obaaoaaco", "oaaaaaaco", ".oaaaaco.", "..oaaco..", "...oco...", "....o...."],
  drop: ["....o....", "...obo...", "..obao...", ".obaaco..", "obaaaaco.", "obaaaaco.", "oaaaaacco", ".oaaacco.", "..ooooo.."],
  gem: ["..ooo..", ".obbao.", "obbaaco", "oaaaaco", ".oacco.", "..oco..", "...o..."],
  hourglass: ["ommmmmo", ".obbbo.", "..oao..", "...o...", "..oao..", ".oaaao.", "ommmmmo"],
  coin: [".oooo.", "obbaao", "obaaco", "oaaaco", "oaccco", ".oooo."],
  pact: ringsRows(),
  runeA: ["a...a", "aa.aa", "a.a.a", "a...a", "a...a", "a...a", "a...a"],
  runeB: ["aaaa.", "a..a.", "aaaa.", "a.a..", "a..a.", "a...a", "a...a"],
  runeC: ["..a..", ".a.a.", "a...a", ".a.a.", "..a..", "..a..", "..a.."],
  runeD: ["a...a", ".a.a.", "..a..", ".a.a.", "a...a", "a...a", "aaaaa"],
  runeE: ["..a..", "..a..", "aaaaa", "..a..", ".aaa.", "a.a.a", "..a.."],
} satisfies Record<string, string[]>;

export type SpriteName = keyof typeof SPRITES;

/** The Tithe's five runes, one per floor a run must survive. */
export const RUNES: readonly SpriteName[] = ["runeA", "runeB", "runeC", "runeD", "runeE"];

export interface SpriteTexture {
  texture: DataTexture;
  /** Size in sprite pixels. */
  w: number;
  h: number;
}

const cache = new Map<string, SpriteTexture>();

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Rows of a sprite (for tests and sizing). */
export function spriteRows(name: SpriteName): readonly string[] {
  return SPRITES[name];
}

/** The sprite painted in `tint`, cached per (name, tint). */
export function spriteTexture(name: SpriteName, tint: string = ink.parchment): SpriteTexture {
  const key = `${name}|${tint}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rows: readonly string[] = SPRITES[name];
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const data = new Uint8Array(w * h * 4);
  const pal = paletteFor(tint);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const hex = pal[row[x]!];
      if (!hex) continue;
      // DataTexture row 0 is the BOTTOM of the quad's uv space.
      const i = ((h - 1 - y) * w + x) * 4;
      const [r, g, b] = rgb(hex);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  });
  const texture = new DataTexture(data, w, h, RGBAFormat, UnsignedByteType);
  texture.magFilter = texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const entry = { texture, w, h };
  cache.set(key, entry);
  return entry;
}
