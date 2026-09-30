import { Rng, hashSeed } from "../core/rng";
import { color } from "./theme";

/** Procedural pixel art for the DOM chrome: tiny bitmaps painted on canvases
 * once and cached as data URLs, then scaled up with `image-rendering:
 * pixelated` — the same zero-asset trick the world textures use. */

// ── Colour helpers ────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mix `hex` toward white (t > 0) or black (t < 0). */
export function shade(hex: string, t: number): string {
  const [r, g, b] = hexToRgb(hex);
  const target = t > 0 ? 255 : 0;
  const k = Math.abs(t);
  const mix = (c: number) => Math.round(c + (target - c) * k);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Sprites ───────────────────────────────────────────────────────────────────

/** Palette keys used by every sprite. `a/b/c` are the tint (base, light,
 * dark) so one bitmap serves every item color. */
function palette(tint: string): Record<string, string> {
  return {
    o: color.ink,
    a: tint,
    b: shade(tint, 0.45),
    c: shade(tint, -0.45),
    w: "#6b4426",
    W: "#9c6a3c",
    d: "#3f2614",
    m: color.brass,
    M: color.brassLight,
    n: color.brassDark,
    k: "#140c14",
    s: "#e9dfc8",
    S: "#9d917c",
    g: color.arcane,
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

/** Each string row is one pixel row; `.` is transparent. */
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
  heart: [
    ".oo...oo.",
    "obbo.obao",
    "obaaoaaco",
    "oaaaaaaco",
    ".oaaaaco.",
    "..oaaco..",
    "...oco...",
    "....o....",
  ],
  drop: [
    "....o....",
    "...obo...",
    "..obao...",
    ".obaaco..",
    "obaaaaco.",
    "obaaaaco.",
    "oaaaaacco",
    ".oaaacco.",
    "..ooooo..",
  ],
  gem: [
    "..ooo..",
    ".obbao.",
    "obbaaco",
    "oaaaaco",
    ".oacco.",
    "..oco..",
    "...o...",
  ],
  hourglass: [
    "ommmmmo",
    ".obbbo.",
    "..oao..",
    "...o...",
    "..oao..",
    ".oaaao.",
    "ommmmmo",
  ],
  wizard: [
    "........o.......",
    ".......obo......",
    "......obao......",
    "......oaao......",
    ".....obaaco.....",
    ".....oaaaco.....",
    "....obaaaacco...",
    "..oooooooooooo..",
    "...okkkkkkkko...",
    "...okkgkkgkko...",
    "....okkkkkko....",
    "....obaaaaco....",
    "...obaaMaaaco...",
    "...obaaaaaaco...",
    "..obaaaaaaacco..",
    "..obaaaaaaacco..",
    "..obaaaaaaacco..",
    ".obaaaaaaaaacco.",
    ".obaaaaaaaaacco.",
    ".obaaaaaaaaacco.",
    "obaaaaaaaaaaacco",
    "occccccccccccco.",
    ".oooooooooooooo.",
  ],
  pact: ringsRows(),
  runeA: ["a...a", "aa.aa", "a.a.a", "a...a", "a...a", "a...a", "a...a"],
  runeB: ["aaaa.", "a..a.", "aaaa.", "a.a..", "a..a.", "a...a", "a...a"],
  runeC: ["..a..", ".a.a.", "a...a", ".a.a.", "..a..", "..a..", "..a.."],
  runeD: ["a...a", ".a.a.", "..a..", ".a.a.", "a...a", "a...a", "aaaaa"],
  runeE: ["..a..", "..a..", "aaaaa", "..a..", ".aaa.", "a.a.a", "..a.."],
} satisfies Record<string, string[]>;

export type SpriteName = keyof typeof SPRITES;
export const RUNES: readonly SpriteName[] = ["runeA", "runeB", "runeC", "runeD", "runeE"];

const spriteCache = new Map<string, { url: string; w: number; h: number }>();

/** Data URL + native size of a sprite painted in `tint`. Cached. */
export function sprite(name: SpriteName, tint: string = color.parchment): { url: string; w: number; h: number } {
  const key = `${name}|${tint}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const rows: string[] = SPRITES[name];
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const pal = palette(tint);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const fill = pal[row[x]];
      if (!fill) continue;
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  const entry = { url: canvas.toDataURL(), w, h };
  spriteCache.set(key, entry);
  return entry;
}

// ── The presence eye ──────────────────────────────────────────────────────────

/** The eye sigil in three states. Painted procedurally (ellipse maths) so the
 * lids can close over the same iris. `open` 0 = shut, 1 = wide. */
export function eyeSprite(open: number, tint: string): string {
  const key = `eye|${open}|${tint}`;
  const hit = spriteCache.get(key);
  if (hit) return hit.url;
  const W = 21;
  const H = 13;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const cx = 10;
  const cy = 6;
  const px = (x: number, y: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, 1, 1);
  };
  const lidH = 5.6 * open;
  for (let y = 0; y < H && open > 0; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - cx) / 10.2;
      // Almond: the vertical half-height tapers toward the corners.
      const half = lidH * (1 - dx * dx);
      const dy = y - cy;
      const inside = Math.abs(dy) <= half && Math.abs(dx) <= 1;
      const edge = Math.abs(dy) <= half + 1 && Math.abs(dx) <= 1.05;
      if (inside) {
        const r = Math.hypot(x - cx, (y - cy) * 1.1);
        if (Math.abs(x - cx) <= 0 && Math.abs(dy) <= 3) px(x, y, color.ink); // slit pupil
        else if (r < 3.2) px(x, y, shade(tint, 0.35));
        else if (r < 4.4) px(x, y, tint);
        else px(x, y, shade(tint, -0.72));
      } else if (edge) {
        px(x, y, open > 0 ? color.brass : color.brassDark);
      }
    }
  }
  if (open === 0) {
    // Shut: a sleeping lid — a brass smile of a curve with hanging lashes.
    for (let x = 1; x < W - 1; x++) {
      const dx = (x - cx) / 9.5;
      const y = cy - 1 + Math.round(2.4 * (1 - dx * dx));
      px(x, y - 1, color.ink);
      px(x, y, tint);
      px(x, y + 1, color.ink);
      if (x % 3 === 1 && x > 2 && x < W - 3) {
        px(x, y + 2, tint);
        px(x + (x < cx ? -1 : x > cx ? 1 : 0), y + 3, shade(tint, -0.3));
      }
    }
  }
  const url = canvas.toDataURL();
  spriteCache.set(key, { url, w: W, h: H });
  return url;
}

// ── Frames and surfaces ───────────────────────────────────────────────────────

export interface FrameColors {
  trim: string;
  light: string;
  dark: string;
}

export const FRAMES = {
  brass: { trim: color.brass, light: color.brassLight, dark: color.brassDark },
  arcane: { trim: color.arcaneDim, light: color.arcane, dark: "#0f3f36" },
  iron: { trim: "#4a4152", light: "#7d7288", dark: "#241e2a" },
  blood: { trim: "#8a2424", light: "#ff6a5a", dark: "#3a0c0c" },
  gold: { trim: "#c9951f", light: color.gold, dark: "#5a3d0a" },
  violet: { trim: "#6c34a0", light: color.violet, dark: "#2a1242" },
} satisfies Record<string, FrameColors>;

/** A 12×12 nine-slice source (slice 4): ink outline, trim band, inner shadow,
 * notched corners with a bright rivet. Used as a CSS `border-image`. */
export function frameImage(c: FrameColors): string {
  const key = `frame|${c.trim}|${c.light}|${c.dark}`;
  const hit = spriteCache.get(key);
  if (hit) return hit.url;
  const S = 12;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  const px = (x: number, y: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, 1, 1);
  };
  // Edge profile from the outside in.
  const band = [color.ink, c.trim, c.dark, "rgba(0,0,0,0.45)"];
  for (let i = 0; i < S; i++) {
    for (let d = 0; d < 4; d++) {
      px(i, d, band[d]);
      px(i, S - 1 - d, band[d]);
      px(d, i, band[d]);
      px(S - 1 - d, i, band[d]);
    }
  }
  // Top/left trim catches the light.
  for (let i = 4; i < S - 4; i++) {
    px(i, 1, c.light);
    px(1, i, shade(c.trim, 0.2));
  }
  // Notched corners with rivets.
  const corner = ["..oo", ".oLT", "oLMt", "oTtd"];
  const pal: Record<string, string> = { o: color.ink, L: c.light, M: "#fff6d8", T: c.trim, t: c.trim, d: c.dark };
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const ch = corner[y][x];
      const fill = ch === "." ? null : pal[ch];
      const put = (px2: number, py2: number) => {
        if (fill) px(px2, py2, fill);
        else ctx.clearRect(px2, py2, 1, 1);
      };
      put(x, y);
      put(S - 1 - x, y);
      put(x, S - 1 - y);
      put(S - 1 - x, S - 1 - y);
    }
  }
  const url = canvas.toDataURL();
  spriteCache.set(key, { url, w: S, h: S });
  return url;
}

/** Gritty stone tile for panel backgrounds — the world's pixel family. */
export function stoneImage(): string {
  const hit = spriteCache.get("stone");
  if (hit) return hit.url;
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rng = new Rng(hashSeed("hud-stone"));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = rng.next();
      const v = n > 0.95 ? 8 : 18 + n * 12;
      ctx.fillStyle = `rgb(${v | 0},${(v * 0.86) | 0},${(v * 1.2) | 0})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const url = canvas.toDataURL();
  spriteCache.set("stone", { url, w: size, h: size });
  return url;
}

/** Aged parchment tile for tooltips and lore. */
export function parchmentImage(): string {
  const hit = spriteCache.get("parchment");
  if (hit) return hit.url;
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rng = new Rng(hashSeed("hud-parchment"));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = rng.next();
      const v = 26 + n * 9 + (n > 0.97 ? 8 : 0);
      ctx.fillStyle = `rgb(${(v * 1.12) | 0},${(v * 0.95) | 0},${(v * 0.8) | 0})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const url = canvas.toDataURL();
  spriteCache.set("parchment", { url, w: size, h: size });
  return url;
}
