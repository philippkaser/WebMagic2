import { Rng, hashSeed } from "../../core/rng";
import { blank, fbm, glowAt, hex, mix, putRgb, ramp, setRough, tint, toMaps, worley, type Painted, type PixelMaps } from "./pixelKit";

/** Painters for the village above the dungeon: night grass, cobbles,
 * half-timbered plaster, shingle roofs, pine bark, warm leaded windows and
 * the rune-grooved basalt of the standing stones. Each picks its tones from
 * a short stepped ramp, so the whole hamlet shares one moonlit palette.
 * Village-only; the dungeon's surfaces live in painters/. */

export type VillageTexture = "grass" | "cobble" | "timber" | "shingles" | "treeBark" | "window" | "basalt";

const GRASS = ramp(["#131d12", "#1a2716", "#22321b", "#2c3f20", "#374b26"]);
const EARTH = ramp(["#1f1810", "#2a2015", "#35291b", "#433422"]);
const OAK = ramp(["#1a120b", "#24190f", "#2f2114", "#3a2a19"]);

function grass(rng: Rng): Painted {
  const p = blank();
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const patch = fbm(x, y, 64, 64, 3, 301);
      const n = rng.next();
      if (patch > 0.6) {
        putRgb(p, x, y, EARTH(n * 0.7 + (patch - 0.6)), 0.3 + n * 0.3);
        if (n > 0.97) putRgb(p, x, y, hex("#5a5248"), 0.8); // pebble
      } else {
        // Blades: vertical 2px strokes read as grass even at this size.
        const blade = (x * 7 + Math.floor(y / 2) * 3) % 5 === 0 ? 0.25 : 0;
        putRgb(p, x, y, GRASS(n * 0.6 + blade + (0.6 - patch) * 0.4), 0.4 + n * 0.5 + blade);
      }
    }
  return p;
}

/** Domed cobbles with grass and earth in the joints; the stone tops are a
 * little smoother, so the moon catches them. */
function cobble(rng: Rng): Painted {
  const p = blank(64, 64, { rough: true });
  const stone = ramp(["#2a2a2e", "#35353a", "#424147", "#504e53", "#5e5b5e"]);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const c = worley(x, y, 64, 64, 6, 6, 311);
      const edge = c.f2 - c.f1;
      const n = rng.next();
      if (edge < 0.1) {
        putRgb(p, x, y, fbm(x, y, 64, 64, 8, 312) > 0.55 ? GRASS(n * 0.5) : EARTH(n * 0.4), 0.05);
        setRough(p, x, y, 1);
      } else {
        const dome = 1 - c.f1;
        putRgb(p, x, y, stone(c.id * 0.6 + dome * 0.3 + (n - 0.5) * 0.15), 0.3 + dome * 0.7);
        setRough(p, x, y, 0.55 + n * 0.3);
      }
    }
  return p;
}

/** Half-timbered wall: plaster panels, oak frame with braces, fieldstone
 * plinth. One texture spans a whole cottage face. */
function timber(rng: Rng): Painted {
  const p = blank();
  const plaster = ramp(["#5e5647", "#6e6553", "#7c725d", "#877c65"]);
  const stone = ramp(["#2c2a2a", "#3a3634", "#48423e"]);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const n = rng.next();
      const f = fbm(x, y, 64, 64, 6, 321);
      if (y >= 54) {
        const c = worley(x, y, 64, 64, 8, 8, 322);
        const seam = c.f2 - c.f1 < 0.1;
        putRgb(p, x, y, seam ? hex("#141210") : stone(c.id * 0.8 + n * 0.2), seam ? 0.1 : 0.7);
        continue;
      }
      const post = x < 3 || x > 60 || (x >= 30 && x < 34);
      const beam = y < 3 || (y >= 26 && y < 30) || (y >= 51 && y < 54);
      // Diagonal braces in the lower panels.
      const lx = x < 32 ? x - 3 : 60 - x;
      const brace = y > 30 && y < 51 && Math.abs(lx - (y - 30)) < 2.2;
      if (post || beam || brace) {
        const grain = Math.sin((post ? y : x) * 0.9 + x * 0.2) > 0.7 ? -0.2 : 0;
        putRgb(p, x, y, OAK(0.4 + n * 0.5 + grain), 0.8);
      } else {
        const stain = y > 40 ? (y - 40) / 14 : 0;
        putRgb(p, x, y, mix(plaster(f * 0.8 + n * 0.25), hex("#3a3226"), stain * 0.5 * f), 0.45 + n * 0.1);
        if (n > 0.985) putRgb(p, x, y, hex("#3e372d"), 0.2); // crack pit
      }
    }
  return p;
}

/** Overlapping shingles, the lower rows furred with moss. */
function shingles(rng: Rng): Painted {
  const p = blank();
  const slate = ramp(["#14121a", "#1c1924", "#25212e", "#2f2a39"]);
  const moss = ramp(["#1d2a16", "#2a3b1c"]);
  for (let y = 0; y < 64; y++) {
    const row = Math.floor(y / 6);
    const v = y % 6;
    for (let x = 0; x < 64; x++) {
      const u = (x + (row % 2) * 4) % 8;
      const id = ((row * 13 + Math.floor((x + (row % 2) * 4) / 8) * 7) % 5) / 5;
      const n = rng.next();
      if (v === 5 || u === 0) {
        putRgb(p, x, y, hex("#07060a"), 0.1);
        continue;
      }
      const mossy = fbm(x, y, 64, 64, 5, 331) > 0.6;
      const col = mossy ? moss(n) : slate(id * 0.7 + n * 0.3 + (v === 0 ? 0.2 : 0));
      putRgb(p, x, y, col, 0.4 + (5 - v) * 0.1);
    }
  }
  return p;
}

/** Deep-furrowed pine bark with lichen on the ridges. */
function treeBark(rng: Rng): Painted {
  const p = blank();
  const tone = ramp(["#0f0b08", "#18120c", "#221a12", "#2c2218"]);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const furrow = Math.sin(x * 0.8 + fbm(x, y, 64, 64, 4, 341) * 7);
      const n = rng.next();
      putRgb(p, x, y, tone(furrow * 0.35 + 0.4 + (n - 0.5) * 0.3), 0.3 + furrow * 0.35);
      if (furrow > 0.6 && fbm(x, y, 64, 64, 6, 342) > 0.64) tint(p, x, y, hex("#3a4a30"), 0.6); // lichen
    }
  return p;
}

/** Leaded window: four warm panes, dark mullions, a little uneven glass. */
function windowPane(rng: Rng): Painted {
  const p = blank(16, 16, { emit: true });
  const warm = ramp(["#ff8a2a", "#ffb04a", "#ffd27a"]);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const frame = x < 1 || x > 14 || y < 1 || y > 14 || x === 7 || x === 8 || y === 7 || y === 8;
      if (frame) {
        putRgb(p, x, y, hex("#120b06"), 0.9);
        continue;
      }
      const c = warm(0.3 + rng.next() * 0.5 + (y > 8 ? 0.2 : 0));
      putRgb(p, x, y, c, 0.3);
      glowAt(p, x, y, c);
    }
  return p;
}

/** Dark basalt with carved grooves, like weathered glyph rows. */
function basalt(rng: Rng): Painted {
  const p = blank();
  const groove = (x: number, y: number) => y % 11 > 7 && Math.sin(x * 0.9 + y * 4.7) > -0.35 && x % 13 !== 0;
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const n = rng.next();
      if (groove(x, y)) {
        const v = 14 + n * 8;
        putRgb(p, x, y, [v, v * 1.05, v * 1.3], 0.12);
      } else {
        const fleck = n > 0.96 ? 1.9 : 1;
        const v = (30 + n * 16) * fleck;
        putRgb(p, x, y, [v * 0.95, v * 0.97, v * 1.12], 0.6 + n * 0.3);
      }
    }
  return p;
}

const PAINTERS: Record<VillageTexture, (rng: Rng) => Painted> = {
  grass,
  cobble,
  timber,
  shingles,
  treeBark,
  window: windowPane,
  basalt,
};

const base = new Map<VillageTexture, PixelMaps>();
const variants = new Map<string, PixelMaps>();

/** Village maps. Painted once per kind; a repeat variant is a set of clones
 * sharing the base images, so the GPU gets each picture exactly once. */
export function getVillageTextures(kind: VillageTexture, repeatX = 1, repeatY = 1): PixelMaps {
  let b = base.get(kind);
  if (!b) {
    b = toMaps(PAINTERS[kind](new Rng(hashSeed(`village:${kind}`))));
    base.set(kind, b);
  }
  if (repeatX === 1 && repeatY === 1) return b;
  const key = `${kind}:${repeatX}:${repeatY}`;
  let v = variants.get(key);
  if (!v) {
    const rep = <T extends PixelMaps[keyof PixelMaps]>(t: T): T => {
      if (!t) return t;
      const c = t.clone();
      c.repeat.set(repeatX, repeatY);
      return c as T;
    };
    v = { map: rep(b.map), normalMap: rep(b.normalMap), roughnessMap: rep(b.roughnessMap), emissiveMap: rep(b.emissiveMap) };
    variants.set(key, v);
  }
  return v;
}
