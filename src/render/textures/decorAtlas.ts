import { Rng, hashSeed } from "../../core/rng";
import type { BiomeId } from "../../world/types";
import { blank, glow, putRgb, setRough, type Painted } from "./canvas";
import { fbm, hash2, ridge } from "./noise";
import { hex, mix, ramp, scale, type Rgb } from "./palette";

/** Every texture the set dressing needs, painted texel by texel into ONE
 * atlas (so every piece of decor on a floor shares one material, one
 * texture set and one or two draw calls): bone, iron and rust, old wood,
 * candle wax, glazed clay, rope, coals, barnacles, slag with its cracks
 * still glowing, crystal in two colours, pale root, kelp, standing water,
 * cobweb, and one ragged banner per band — the Founders' seal, a ring over
 * a well, faded into each band's cloth.
 *
 * Same recipe as the world's surfaces: small stepped palette ramps, a
 * height field for the normal map, roughness where it matters (wet water,
 * waxy candles, polished crystal), an emissive layer for what glows. Unlike
 * them it has an alpha channel: unpainted texels are transparent, which is
 * what the cut-out pieces (webs, kelp, torn banner edges, puddles) are cut
 * along. Pure and deterministic, like every painter. */

export const DECOR_ATLAS_W = 256;
export const DECOR_ATLAS_H = 128;

export type DecorTile =
  | "bone"
  | "iron"
  | "rust"
  | "wood"
  | "wax"
  | "clay"
  | "void"
  | "coal"
  | "cord"
  | "barnacle"
  | "slag"
  | "crystalViolet"
  | "crystalCyan"
  | "root"
  | "kelp"
  | "water"
  | "web"
  | "bannerCatacombs"
  | "bannerDrowned"
  | "bannerForge"
  | "bannerCrystal"
  | "bannerHollow";

/** Where each tile lies in the atlas: [x, y, w, h] in texels, y down. */
export const DECOR_TILES: Readonly<Record<DecorTile, readonly [number, number, number, number]>> = {
  bone: [0, 0, 32, 32],
  iron: [32, 0, 32, 32],
  rust: [64, 0, 32, 32],
  wood: [96, 0, 32, 32],
  wax: [128, 0, 32, 32],
  clay: [160, 0, 32, 32],
  void: [192, 0, 16, 16],
  coal: [208, 0, 16, 16],
  cord: [224, 0, 16, 16],
  barnacle: [0, 32, 32, 32],
  slag: [32, 32, 32, 32],
  crystalViolet: [64, 32, 32, 32],
  crystalCyan: [96, 32, 32, 32],
  root: [128, 32, 32, 32],
  kelp: [160, 32, 32, 64],
  water: [192, 32, 32, 32],
  web: [192, 64, 64, 64],
  bannerCatacombs: [0, 64, 32, 64],
  bannerDrowned: [32, 64, 32, 64],
  bannerForge: [64, 64, 32, 64],
  bannerCrystal: [96, 64, 32, 64],
  bannerHollow: [128, 64, 32, 64],
};

export function bannerTile(biome: BiomeId): DecorTile {
  const map: Record<BiomeId, DecorTile> = {
    catacombs: "bannerCatacombs",
    drowned: "bannerDrowned",
    forge: "bannerForge",
    crystal: "bannerCrystal",
    hollow: "bannerHollow",
  };
  return map[biome];
}

/** The tiles that are cut-outs (drawn double-sided, alpha-tested). */
export const SHEET_TILES: ReadonlySet<DecorTile> = new Set([
  "kelp",
  "water",
  "web",
  "bannerCatacombs",
  "bannerDrowned",
  "bannerForge",
  "bannerCrystal",
  "bannerHollow",
]);

/** A painter writes into its tile through this view: local x, y. */
interface TileView {
  w: number;
  h: number;
  put(x: number, y: number, c: Rgb, height: number, rough?: number): void;
  glow(x: number, y: number, c: Rgb, amount?: number): void;
}

function view(p: Painted, tile: DecorTile): TileView {
  const [x0, y0, w, h] = DECOR_TILES[tile];
  return {
    w,
    h,
    put(x, y, c, height, rough) {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      putRgb(p, x0 + x, y0 + y, c, height);
      if (rough !== undefined) setRough(p, x0 + x, y0 + y, rough);
    },
    glow(x, y, c, amount = 1) {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      glow(p, x0 + x, y0 + y, c, amount);
    },
  };
}

type Painter = (t: TileView, rng: Rng) => void;

/** Fill a tile from a ramp and a 0..1 field. */
function fill(t: TileView, tone: (v: number) => Rgb, field: (x: number, y: number) => number, rough: number): void {
  for (let y = 0; y < t.h; y++)
    for (let x = 0; x < t.w; x++) {
      const v = field(x, y);
      t.put(x, y, tone(v), 0.3 + v * 0.5, rough);
    }
}

const BONE = ramp(["#5e5442", "#857a60", "#a89c7c", "#c8bc98", "#e2d8b6"]);
// Iron and rust are painted lighter than they'd be in daylight: under a
// dark vault they only read by their highlights.
const IRON = ramp(["#2a292f", "#3a3940", "#4d4b55", "#64626e", "#827f8c"]);
const RUST = ramp(["#3e1e10", "#5a2c14", "#7a3e1c", "#985426", "#b46e34"]);
const WOOD = ramp(["#1e130a", "#2c1c0e", "#3d2814", "#4f351b", "#664624"]);
const WAX = ramp(["#7a6a4c", "#a69270", "#c9b58e", "#e4d4ac", "#f4ead0"]);
const CLAY = ramp(["#3a1c10", "#552a18", "#713a22", "#8c4c2e", "#a6623c"]);
const BARN = ramp(["#232a26", "#3a443d", "#56625a", "#788478", "#9ca698"]);
const SLAG = ramp(["#0c090a", "#161012", "#221818", "#30221e", "#3e2c24"]);
const ROOT = ramp(["#5a5246", "#7e7464", "#a29884", "#c2b8a2", "#ddd4be"]);
const KELP = ramp(["#0f1a0b", "#172810", "#213a15", "#2e4e1b", "#3e6422"]);

const PAINTERS: Record<DecorTile, Painter> = {
  bone(t) {
    fill(t, BONE, (x, y) => fbm(x, y, t.w, t.h, 4, 901) * 0.8 + 0.2 + (hash2(x, y, 902) > 0.93 ? -0.35 : 0), 0.7);
  },
  iron(t) {
    fill(
      t,
      IRON,
      (x, y) => {
        const hammer = Math.sin(x * 0.9) * Math.sin(y * 0.9) * 0.12;
        const scratch = (x + y * 3) % 17 === 0 ? 0.25 : 0;
        return fbm(x, y, t.w, t.h, 6, 911) * 0.6 + 0.2 + hammer + scratch;
      },
      0.45,
    );
    for (let i = 0; i < 18; i++) t.put(Math.floor(hash2(i, 1, 912) * t.w), Math.floor(hash2(i, 2, 912) * t.h), RUST(0.5), 0.4, 0.9);
  },
  rust(t) {
    for (let y = 0; y < t.h; y++)
      for (let x = 0; x < t.w; x++) {
        const n = fbm(x, y, t.w, t.h, 5, 921);
        const c = n > 0.5 ? RUST(n * 1.2 - 0.3) : IRON(n + 0.2);
        t.put(x, y, c, 0.3 + n * 0.5, n > 0.5 ? 0.95 : 0.5);
      }
  },
  wood(t) {
    for (let y = 0; y < t.h; y++)
      for (let x = 0; x < t.w; x++) {
        const seam = x % 8 === 0;
        const grain = Math.sin(y * 0.55 + Math.floor(x / 8) * 2.1 + Math.sin(x * 0.7) * 0.6) * 0.15;
        const v = seam ? 0.02 : 0.35 + grain + fbm(x, y, t.w, t.h, 4, 931) * 0.4;
        t.put(x, y, WOOD(v), seam ? 0.05 : 0.5 + grain, 0.9);
      }
  },
  wax(t) {
    for (let y = 0; y < t.h; y++)
      for (let x = 0; x < t.w; x++) {
        const drip = Math.sin(x * 1.3) * 0.5 + 0.5 > 0.7 && y < 10 + hash2(x, 0, 941) * 14 ? 0.15 : 0;
        const v = 0.45 + fbm(x, y, t.w, t.h, 4, 942) * 0.35 + drip;
        t.put(x, y, WAX(v), 0.5 + drip, 0.55);
      }
    // The top rows: the wick and the warm glow round it.
    for (let x = 0; x < t.w; x++) {
      t.put(x, 0, hex("#1a120a"), 0.6, 0.9);
      t.glow(x, 1, hex("#ff9a3a"), 0.6);
    }
  },
  clay(t) {
    for (let y = 0; y < t.h; y++)
      for (let x = 0; x < t.w; x++) {
        const band = y % 12 < 2;
        const meander = y % 12 === 5 && (x + Math.floor(y / 12) * 3) % 6 < 3;
        const v = 0.35 + fbm(x, y, t.w, t.h, 4, 951) * 0.4;
        const c = band || meander ? hex("#1e120c") : CLAY(v);
        t.put(x, y, c, band ? 0.3 : 0.55, 0.6);
      }
  },
  void(t) {
    for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) t.put(x, y, hex("#030203"), 0, 1);
  },
  coal(t) {
    for (let y = 0; y < t.h; y++)
      for (let x = 0; x < t.w; x++) {
        const n = hash2(x, y, 961);
        t.put(x, y, n > 0.6 ? hex("#3a1206") : hex("#120c0a"), n, 0.9);
        if (n > 0.6) t.glow(x, y, mix(hex("#ff3a0a"), hex("#ffb040"), n), 1);
      }
  },
  cord(t) {
    for (let y = 0; y < t.h; y++)
      for (let x = 0; x < t.w; x++) {
        const twist = (x + y) % 4 < 2;
        t.put(x, y, twist ? hex("#5a4630") : hex("#3a2c1c"), twist ? 0.7 : 0.3, 0.95);
      }
  },
  barnacle(t) {
    fill(t, BARN, (x, y) => fbm(x, y, t.w, t.h, 5, 971) * 0.7 + 0.15, 0.85);
    // Shell mouths: dark holes ringed in pale.
    for (let i = 0; i < 9; i++) {
      const cx = 3 + Math.floor(hash2(i, 0, 972) * (t.w - 6));
      const cy = 3 + Math.floor(hash2(i, 1, 972) * (t.h - 6));
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const d = Math.hypot(dx, dy);
          if (d < 1) t.put(cx + dx, cy + dy, hex("#0a0d0b"), 0, 1);
          else if (d < 2.3) t.put(cx + dx, cy + dy, BARN(0.95), 0.9, 0.7);
        }
    }
  },
  slag(t) {
    for (let y = 0; y < t.h; y++)
      for (let x = 0; x < t.w; x++) {
        const r = ridge(x, y, t.w, t.h, 3, 981);
        const n = fbm(x, y, t.w, t.h, 6, 982);
        if (r > 0.86) {
          t.put(x, y, hex("#5a1a06"), 0.05, 0.9);
          t.glow(x, y, mix(hex("#ff3a0a"), hex("#ffa030"), (r - 0.86) * 7), 1);
        } else t.put(x, y, SLAG(n), 0.4 + n * 0.4, 0.75);
      }
  },
  crystalViolet(t) {
    crystal(t, ramp(["#2c1650", "#4a2a8a", "#7a4ad8", "#b08cff", "#e8d8ff"]), hex("#a46bff"));
  },
  crystalCyan(t) {
    crystal(t, ramp(["#0e2a3a", "#18506a", "#2c8ab0", "#62c8ff", "#c8f4ff"]), hex("#4fd8ff"));
  },
  root(t) {
    for (let y = 0; y < t.h; y++)
      for (let x = 0; x < t.w; x++) {
        const fibre = Math.sin(x * 1.7 + Math.sin(y * 0.25) * 2) * 0.5 + 0.5;
        const v = 0.25 + fibre * 0.45 + fbm(x, y, t.w, t.h, 4, 991) * 0.25;
        t.put(x, y, ROOT(v), 0.3 + fibre * 0.5, 0.8);
      }
  },
  kelp(t, rng) {
    // Three fronds rising, each a wavering strip narrowing to its tip.
    for (let f = 0; f < 3; f++) {
      const cx = 5 + f * 11 + rng.int(-1, 1);
      const phase = rng.range(0, 6);
      for (let y = 0; y < t.h; y++) {
        const up = 1 - y / t.h; // 1 at the top
        const half = 1 + (1 - up) * 3.2 + Math.sin(y * 0.4 + phase) * 0.6;
        const mid = cx + Math.sin(y * 0.18 + phase) * 2.5;
        for (let x = Math.floor(mid - half); x <= Math.ceil(mid + half); x++) {
          const edge = Math.abs(x - mid) / half;
          if (edge > 1 || (up > 0.92 && edge > 0.5)) continue;
          const v = 0.3 + (1 - edge) * 0.5 + (y % 7 === 0 ? -0.2 : 0);
          t.put(x, y, KELP(v), 0.4 + (1 - edge) * 0.4, 0.5);
        }
      }
      // A few lume beads on the fronds.
      for (let i = 0; i < 3; i++) t.glow(Math.round(cx + rng.range(-1, 1)), rng.int(6, t.h - 6), hex("#5cffd8"), 0.8);
    }
  },
  water(t) {
    // A pool with a ragged edge and a rim of silt: alpha where it isn't.
    const c = t.w / 2 - 0.5;
    for (let y = 0; y < t.h; y++)
      for (let x = 0; x < t.w; x++) {
        const d = Math.hypot(x - c, y - c) / (t.w / 2);
        const edge = 0.78 + (fbm(x, y, t.w, t.h, 4, 1001) - 0.5) * 0.5;
        if (d > edge + 0.12) continue;
        if (d > edge) t.put(x, y, hex("#2a3328"), 0.4, 0.95); // silt rim
        else {
          const glint = hash2(x, y, 1002) > 0.985;
          t.put(x, y, glint ? hex("#3a6a6a") : mix(hex("#061016"), hex("#0c1e22"), fbm(x, y, t.w, t.h, 3, 1003)), 0.3, 0.04);
        }
      }
  },
  web(t, rng) {
    // Threads fanning from the top-left corner, crossed by sagging rings.
    const silk = hex("#b8b4aa");
    const R = t.w;
    const spokes = 9;
    for (let s = 0; s <= spokes; s++) {
      const a = (s / spokes) * (Math.PI / 2) + rng.range(-0.04, 0.04);
      for (let r = 0; r < R * 1.4; r += 0.5) {
        const x = Math.round(Math.cos(a) * r);
        const y = Math.round(Math.sin(a) * r);
        if (hash2(x, y, 1011) > 0.9) continue; // broken here and there
        t.put(x, y, silk, 0.6, 0.9);
      }
    }
    for (let ring = 1; ring < 9; ring++) {
      const r0 = ring * 7 + rng.range(-1, 1);
      for (let a = 0; a <= Math.PI / 2; a += 0.6 / r0) {
        const sag = Math.sin(((a * spokes) / (Math.PI / 2)) * Math.PI) * 1.2;
        const r = r0 - sag;
        const x = Math.round(Math.cos(a) * r);
        const y = Math.round(Math.sin(a) * r);
        if (hash2(x, y, 1012 + ring) > 0.82) continue;
        t.put(x, y, scale(silk, 0.85), 0.5, 0.9);
      }
    }
    // Dust caught in the middle.
    for (let i = 0; i < 40; i++) {
      const r = rng.range(2, 20);
      const a = rng.range(0, Math.PI / 2);
      t.put(Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r), hex("#8a8478"), 0.6, 0.95);
    }
  },
  // Faded, but still the strongest colour in a room: a banner is a landmark.
  bannerCatacombs: (t, rng) => banner(t, rng, ramp(["#4a1410", "#661c16", "#86281e", "#a43628"]), hex("#e8c068")),
  bannerDrowned: (t, rng) => banner(t, rng, ramp(["#14463c", "#1c5c4e", "#287262", "#388a76"]), hex("#e0ecc8")),
  bannerForge: (t, rng) => banner(t, rng, ramp(["#22140f", "#321c15", "#46271c", "#5a3222"]), hex("#ff8a3a"), true),
  bannerCrystal: (t, rng) => banner(t, rng, ramp(["#24205e", "#302c7a", "#3e3a96", "#504cb2"]), hex("#eef2ff")),
  bannerHollow: (t, rng) => banner(t, rng, ramp(["#6e665a", "#887e6c", "#a29682", "#bcb098"]), hex("#8a1424")),
};

function crystal(t: TileView, tone: (v: number) => Rgb, light: Rgb): void {
  for (let y = 0; y < t.h; y++)
    for (let x = 0; x < t.w; x++) {
      // Long facet bands, brighter toward the tip (row 0).
      const facet = Math.floor(x / 5) % 2 ? 0.12 : 0;
      const v = 0.25 + (1 - y / t.h) * 0.5 + facet + (hash2(x, y, 1021) > 0.95 ? 0.3 : 0);
      t.put(x, y, tone(v), 0.5 + facet, 0.15);
      t.glow(x, y, light, 0.25 + (1 - y / t.h) * 0.5);
    }
}

/** A Founders' banner gone to rags: a sleeve at the top for the rod,
 * vertical folds, a border, the seal (a ring over a well — a lid on the
 * deep), stains, holes, and a torn hem. Alpha where it's torn away. */
function banner(t: TileView, rng: Rng, cloth: (v: number) => Rgb, ink: Rgb, embers = false): void {
  const hem = Array.from({ length: t.w }, (_, x) => t.h - 4 - Math.floor(hash2(x >> 1, 0, rng.int(0, 999)) * 12));
  for (let y = 0; y < t.h; y++)
    for (let x = 0; x < t.w; x++) {
      if (y > hem[x]) continue;
      if (y > 10 && hash2(x >> 1, y >> 1, 1031) > 0.965) continue; // moth holes
      const fold = Math.sin(x * 0.75) * 0.5 + 0.5;
      const sleeve = y < 4;
      const border = x < 2 || x > t.w - 3 || (y >= 4 && y < 6);
      let v = 0.2 + fold * 0.45 + fbm(x, y, t.w, t.h, 5, 1032) * 0.25 - (y / t.h) * 0.15;
      if (sleeve) v -= 0.15;
      const c = border && !sleeve ? mix(cloth(v), ink, 0.45) : cloth(v);
      t.put(x, y, c, sleeve ? 0.8 : 0.35 + fold * 0.35, 0.95);
    }
  // The seal: a ring, a bar across its foot, a mark at its heart.
  const cx = t.w / 2 - 0.5;
  const cy = 22;
  for (let y = 10; y < 36; y++)
    for (let x = 0; x < t.w; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const ring = d > 6.5 && d < 8.6;
      const bar = y >= cy + 8 && y <= cy + 9 && Math.abs(x - cx) < 11;
      const heart = d < 2;
      if (!(ring || bar || heart) || y > hem[x]) continue;
      if (hash2(x, y, 1033) > 0.85) continue; // faded
      t.put(x, y, mix(ink, hex("#000000"), 0.15), 0.6, 0.9);
      if (embers && hash2(x, y, 1034) > 0.6) t.glow(x, y, hex("#ff5a10"), 0.5);
    }
}

/** Paint the whole atlas (pure, deterministic). */
export function paintDecorAtlas(): Painted {
  const p = blank(DECOR_ATLAS_W, DECOR_ATLAS_H, { rough: true, emit: true });
  // blank() leaves every texel transparent black; tiles paint what's there.
  for (const tile of Object.keys(DECOR_TILES) as DecorTile[]) {
    PAINTERS[tile](view(p, tile), new Rng(hashSeed(`decor/${tile}`)));
  }
  return p;
}

/** UV rectangle [u0, v0, u1, v1] of a tile (v up, three's convention),
 * pulled in by a quarter texel so Nearest sampling never bleeds. */
export function decorTileUv(tile: DecorTile): [number, number, number, number] {
  const [x, y, w, h] = DECOR_TILES[tile];
  const iu = 0.25 / DECOR_ATLAS_W;
  const iv = 0.25 / DECOR_ATLAS_H;
  return [x / DECOR_ATLAS_W + iu, 1 - (y + h) / DECOR_ATLAS_H + iv, (x + w) / DECOR_ATLAS_W - iu, 1 - y / DECOR_ATLAS_H - iv];
}
