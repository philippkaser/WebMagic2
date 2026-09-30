import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  OctahedronGeometry,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { WALL_HEIGHT } from "../../core/config";
import { Rng } from "../../core/rng";

/** Low-poly meshes for the dressing, each built once and shared by every
 * floor. Multi-piece objects (a bone pile, a crystal cluster) are merged
 * into one geometry so each kind costs one instanced draw call. */

const cache = new Map<string, BufferGeometry>();

function once(key: string, build: () => BufferGeometry): BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    g = build();
    cache.set(key, g);
  }
  return g;
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  // Polyhedra are non-indexed; flatten everything so they merge.
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
  g.computeBoundingSphere();
  return g;
}

const LINTEL_BOTTOM = WALL_HEIGHT - 0.9;

export const geometry = {
  pillar: () =>
    once("pillar", () =>
      merge([
        new BoxGeometry(1.0, 0.4, 1.0).translate(0, 0.2, 0),
        new BoxGeometry(0.82, 0.18, 0.82).translate(0, 0.49, 0),
        new CylinderGeometry(0.34, 0.38, WALL_HEIGHT - 1.1, 8).translate(0, WALL_HEIGHT / 2, 0),
        new BoxGeometry(0.82, 0.18, 0.82).translate(0, WALL_HEIGHT - 0.49, 0),
        new BoxGeometry(1.0, 0.4, 1.0).translate(0, WALL_HEIGHT - 0.2, 0),
      ]),
    ),

  /** Unit length along x — instances scale x to the span. */
  beam: () => once("beam", () => new BoxGeometry(1, 0.34, 0.42)),

  lintel: () =>
    once("lintel", () =>
      merge([
        new BoxGeometry(1, 0.9, 0.5),
        // Keystone.
        new BoxGeometry(0.34, 1.0, 0.6).translate(0, -0.05, 0.02),
      ]),
    ),

  pilaster: () =>
    once("pilaster", () =>
      merge([
        new BoxGeometry(0.5, LINTEL_BOTTOM, 0.42).translate(0, LINTEL_BOTTOM / 2, 0),
        new BoxGeometry(0.62, 0.22, 0.52).translate(0, 0.11, 0),
        new BoxGeometry(0.62, 0.18, 0.52).translate(0, LINTEL_BOTTOM - 0.09, 0),
      ]),
    ),

  rubble: () =>
    once("rubble", () => {
      const rng = new Rng(5);
      const parts: BufferGeometry[] = [];
      for (let i = 0; i < 7; i++) {
        const r = rng.range(0.08, 0.24);
        parts.push(
          new DodecahedronGeometry(r, 0)
            .scale(1, rng.range(0.5, 0.9), rng.range(0.7, 1.2))
            .rotateY(rng.range(0, 6.28))
            .translate(rng.range(-0.4, 0.4), r * 0.4, rng.range(-0.25, 0.25)),
        );
      }
      return merge(parts);
    }),

  bones: () =>
    once("bones", () => {
      const rng = new Rng(9);
      const parts: BufferGeometry[] = [
        new SphereGeometry(0.12, 6, 5).scale(1, 0.85, 1.15).translate(0, 0.11, 0),
        new BoxGeometry(0.14, 0.06, 0.1).translate(0, 0.04, 0.1),
      ];
      for (let i = 0; i < 5; i++) {
        parts.push(
          new CylinderGeometry(0.022, 0.028, rng.range(0.3, 0.5), 4)
            .rotateZ(Math.PI / 2)
            .rotateY(rng.range(0, 6.28))
            .translate(rng.range(-0.35, 0.35), 0.03 + i * 0.02, rng.range(-0.3, 0.3)),
        );
      }
      return merge(parts);
    }),

  web: () => once("web", () => new PlaneGeometry(1, 1)),

  /** Hangs from y=0 down to y≈-1; instances scale y to the drop. */
  chain: () =>
    once("chain", () => {
      const parts: BufferGeometry[] = [];
      for (let i = 0; i < 8; i++) {
        const link = new TorusGeometry(0.06, 0.018, 4, 6).scale(1, 1.4, 1);
        if (i % 2) link.rotateY(Math.PI / 2);
        parts.push(link.translate(0, -0.06 - i * 0.12, 0));
      }
      parts.push(new TorusGeometry(0.13, 0.025, 4, 8).translate(0, -1.08, 0)); // shackle
      return merge(parts);
    }),

  stalactite: () =>
    once("stalactite", () =>
      merge([
        new ConeGeometry(0.2, 1, 5).rotateX(Math.PI).translate(0, -0.5, 0),
        new ConeGeometry(0.1, 0.55, 4).rotateX(Math.PI).translate(0.18, -0.27, 0.06),
      ]),
    ),

  pool: () => once("pool", () => new CircleGeometry(1, 12).rotateX(-Math.PI / 2)),

  runeCircle: () => once("rune", () => new CircleGeometry(1, 32).rotateX(-Math.PI / 2)),

  brazierIron: () =>
    once("brazierIron", () =>
      merge([
        new CylinderGeometry(0.36, 0.2, 0.26, 8, 1, true).translate(0, 1.0, 0),
        new CylinderGeometry(0.2, 0.2, 0.05, 8).translate(0, 0.87, 0),
        new CylinderGeometry(0.04, 0.05, 0.85, 5).translate(0, 0.45, 0),
        new CylinderGeometry(0.26, 0.3, 0.08, 8).translate(0, 0.04, 0),
      ]),
    ),

  brazierCoals: () =>
    once("brazierCoals", () => new IcosahedronGeometry(0.27, 0).scale(1, 0.35, 1).translate(0, 1.07, 0)),

  // ── growths: [body, glowing part] per style ──────────────────────────────

  mushroomStems: () => once("mStems", () => merge(mushrooms().map((m) => m.stem))),
  mushroomCaps: () => once("mCaps", () => merge(mushrooms().map((m) => m.cap))),

  crystals: () =>
    once("crystals", () => {
      const rng = new Rng(21);
      const parts: BufferGeometry[] = [];
      for (let i = 0; i < 6; i++) {
        const h = rng.range(0.3, 0.9);
        parts.push(
          new OctahedronGeometry(0.1, 0)
            .scale(1, h / 0.2, 1)
            .translate(0, h * 0.4, 0)
            .rotateX(rng.range(-0.5, 0.5))
            .rotateZ(rng.range(-0.5, 0.5))
            .translate(rng.range(-0.2, 0.2), 0, rng.range(-0.2, 0.2)),
        );
      }
      return merge(parts);
    }),

  slagRocks: () =>
    once("slagRocks", () => {
      const rng = new Rng(33);
      return merge(
        Array.from({ length: 4 }, () =>
          new DodecahedronGeometry(rng.range(0.14, 0.26), 0)
            .scale(1, 0.7, 1)
            .translate(rng.range(-0.3, 0.3), 0.1, rng.range(-0.2, 0.2)),
        ),
      );
    }),

  slagEmbers: () =>
    once("slagEmbers", () => {
      const rng = new Rng(34);
      return merge(
        Array.from({ length: 5 }, () =>
          new IcosahedronGeometry(rng.range(0.05, 0.1), 0).translate(
            rng.range(-0.3, 0.3),
            rng.range(0.02, 0.2),
            rng.range(-0.25, 0.25),
          ),
        ),
      );
    }),

  eyeStalks: () => once("eyeStalks", () => merge(eyes().map((e) => e.stalk))),
  eyeBalls: () => once("eyeBalls", () => merge(eyes().map((e) => e.ball))),
};

/** Stems and caps are separate meshes (different materials) built from the
 * same seeded layout so they line up. */
function mushrooms() {
  const rng = new Rng(13);
  return Array.from({ length: 4 }, (_, i) => {
    const h = rng.range(0.12, 0.38) * (i === 0 ? 1.4 : 1);
    const r = rng.range(0.07, 0.14) * (i === 0 ? 1.4 : 1);
    const x = rng.range(-0.25, 0.25);
    const z = rng.range(-0.2, 0.2);
    return {
      stem: new CylinderGeometry(r * 0.3, r * 0.4, h, 5).translate(x, h / 2, z),
      cap: new SphereGeometry(r, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1).translate(x, h, z),
    };
  });
}

function eyes() {
  const rng = new Rng(17);
  return Array.from({ length: 3 }, () => {
    const h = rng.range(0.3, 0.9);
    const x = rng.range(-0.25, 0.25);
    const z = rng.range(-0.2, 0.2);
    const lean = rng.range(-0.3, 0.3);
    return {
      stalk: new ConeGeometry(0.07, h, 5).translate(0, h / 2, 0).rotateZ(lean).translate(x, 0, z),
      ball: new SphereGeometry(0.1, 7, 5)
        .translate(0, h + 0.04, 0)
        .rotateZ(lean)
        .translate(x, 0, z),
    };
  });
}
