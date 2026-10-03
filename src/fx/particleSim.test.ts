import { describe, expect, test } from "bun:test";
import {
  COLOR_BANDS,
  createInstanceArrays,
  createParticleInit,
  ParticleSim,
  SHAPE,
  STYLE_DEFS,
  styleDef,
  styleId,
  type ParticleInit,
} from "./particleSim";

function init(style: Parameters<typeof styleId>[0], over: Partial<ParticleInit> = {}): ParticleInit {
  const p = createParticleInit();
  const def = styleDef(style);
  p.style = styleId(style);
  p.gravity = def.gravity;
  p.drag = def.drag;
  p.size1 = p.size0 * def.endSize;
  return Object.assign(p, over);
}

describe("styles", () => {
  test("every style id resolves, debris aliases shard, unknown → pixel", () => {
    expect(styleDef("debris")).toBe(styleDef("shard"));
    expect(styleId(undefined)).toBe(styleId("pixel"));
    for (const s of ["pixel", "glow", "spark", "ember", "smoke", "shard", "mote", "flame", "ring", "flare", "soul"] as const) {
      expect(STYLE_DEFS[styleId(s)]).toBeDefined();
    }
  });
  test("rings and flares are pure added light; everything else draws solid pixels", () => {
    for (const s of ["ring", "flare"] as const) expect(styleDef(s).additive).toBe(1);
    for (const s of ["pixel", "glow", "spark", "ember", "smoke", "shard", "mote", "flame", "soul"] as const) {
      expect(styleDef(s).additive).toBe(0);
    }
  });
  test("light is emissive, smoke and debris are lit by the light pool", () => {
    for (const s of ["glow", "spark", "ember", "mote", "flame", "ring", "flare", "soul", "pixel"] as const) {
      expect(styleDef(s).lit).toBe(0);
    }
    for (const s of ["smoke", "shard"] as const) expect(styleDef(s).lit).toBe(1);
  });
  test("the legacy default keeps the original physics", () => {
    const d = styleDef("pixel");
    expect(d.shape).toBe(SHAPE.chunk);
    expect(d.gravity).toBe(-14);
    expect(d.drag).toBe(1.6);
    expect(d.bounce).toBeCloseTo(0.35);
  });
});

describe("ParticleSim", () => {
  test("spawn → step integrates and writes a live instance", () => {
    const sim = new ParticleSim(8);
    const out = createInstanceArrays(8);
    sim.spawn(init("glow", { x: 1, y: 2, z: 3, vx: 1, life: 1, size0: 0.5, size1: 0.5 }));
    const n = sim.step(0.1, out);
    expect(n).toBe(1);
    expect(out.posSize[0]).toBeGreaterThan(1); // moved +x
    expect(out.posSize[1]).toBeCloseTo(2);
    expect(out.misc[0]).toBe(SHAPE.glow);
    expect(out.misc[1]).toBe(0); // solid core (its rim adds light in the shader)
  });

  test("particles die at the end of their life and the pool stays dense", () => {
    const sim = new ParticleSim(8);
    const out = createInstanceArrays(8);
    sim.spawn(init("glow", { life: 0.05, x: 10 }));
    sim.spawn(init("glow", { life: 1, x: 20 }));
    sim.spawn(init("glow", { life: 0.05, x: 30 }));
    expect(sim.step(0.1, out)).toBe(1);
    // The survivor was swapped into slot 0.
    expect(out.posSize[0]).toBeCloseTo(20, 0);
    expect(sim.count).toBe(1);
  });

  test("a full pool evicts rather than refusing, and never exceeds capacity", () => {
    const sim = new ParticleSim(4);
    const out = createInstanceArrays(4);
    for (let i = 0; i < 10; i++) sim.spawn(init("glow", { life: 5, x: i }));
    expect(sim.count).toBe(4);
    expect(sim.step(0.01, out)).toBe(4);
    const xs = Array.from({ length: 4 }, (_, i) => Math.round(out.posSize[i * 4]));
    // The newest spawns are present.
    expect(xs).toContain(9);
  });

  test("gravity pulls down, the floor bounces bouncing styles", () => {
    const sim = new ParticleSim(4);
    const out = createInstanceArrays(4);
    sim.spawn(init("spark", { y: 0.2, vy: -5, life: 2, floorY: 0.03 }));
    for (let i = 0; i < 10; i++) sim.step(0.02, out);
    expect(out.posSize[1]).toBeGreaterThanOrEqual(0.03 - 1e-6);
    // Glows ignore the floor.
    const g = new ParticleSim(4);
    g.spawn(init("glow", { y: 0.2, vy: -5, life: 2, drag: 0 }));
    for (let i = 0; i < 10; i++) g.step(0.02, out);
    expect(out.posSize[1]).toBeLessThan(0);
  });

  test("an attractor pulls particles in and swallows them", () => {
    const sim = new ParticleSim(4);
    const out = createInstanceArrays(4);
    sim.spawn(init("glow", { x: 2, life: 10, ax: 0, ay: 0, az: 0, attract: 40, drag: 0 }));
    let alive = 1;
    for (let i = 0; i < 200 && alive > 0; i++) alive = sim.step(0.02, out);
    expect(alive).toBe(0);
  });

  test("streaks carry stretch in axis.w, other shapes carry a seed", () => {
    const sim = new ParticleSim(4);
    const out = createInstanceArrays(4);
    sim.spawn(init("spark", { vx: 3, life: 1 }));
    sim.spawn(init("smoke", { life: 1 }));
    sim.step(0.01, out);
    expect(out.axis[3]).toBeCloseTo(styleDef("spark").stretch);
    expect(out.axis[0]).toBeGreaterThan(0); // velocity for the stretch
    expect(out.axis[7]).toBeGreaterThan(0); // seed ∈ (0, 1)
    expect(out.axis[7]).toBeLessThan(1);
  });

  test("a stretch override wins over the style's", () => {
    const sim = new ParticleSim(2);
    const out = createInstanceArrays(2);
    sim.spawn(init("spark", { vx: 3, life: 1, stretch: 0.2 }));
    sim.step(0.01, out);
    expect(out.axis[3]).toBeCloseTo(0.2);
  });

  test("rings write their plane normal and keep thickness in rotation", () => {
    const sim = new ParticleSim(2);
    const out = createInstanceArrays(2);
    sim.spawn(init("ring", { ny: 1, rotation: 0.12, life: 1, size0: 0.1, size1: 2 }));
    sim.step(0.5, out);
    expect(out.axis[1]).toBe(1);
    expect(out.misc[2]).toBeCloseTo(0.12);
    expect(out.posSize[3]).toBeGreaterThan(0.1); // grew
  });

  test("colour steps through flat bands over life (no smooth gradient)", () => {
    const sim = new ParticleSim(2);
    const out = createInstanceArrays(2);
    sim.spawn(init("ring", { r0: 4, g0: 4, b0: 4, r1: 0, g1: 0, b1: 0, life: 1 }));
    const seen = new Set<number>();
    for (let i = 0; i < 99; i++) {
      sim.step(0.01, out);
      seen.add(Math.round(out.color[0] * 1000));
    }
    expect(seen.size).toBeLessThanOrEqual(COLOR_BANDS);
    expect(seen.size).toBeGreaterThan(1);
  });

  test("streaks carry their seed in misc.z (axis.w holds the stretch)", () => {
    const sim = new ParticleSim(2);
    const out = createInstanceArrays(2);
    sim.spawn(init("spark", { vx: 3, life: 1, rotation: 5 }));
    sim.step(0.01, out);
    expect(out.misc[2]).toBeGreaterThan(0);
    expect(out.misc[2]).toBeLessThan(1);
  });

  test("colour runs from start to end over life, HDR preserved", () => {
    const sim = new ParticleSim(2);
    const out = createInstanceArrays(2);
    sim.spawn(init("glow", { r0: 3, g0: 3, b0: 3, r1: 0, g1: 0, b1: 0, life: 1 }));
    sim.step(0.01, out);
    const early = out.color[0];
    expect(early).toBeGreaterThan(2);
    sim.step(0.9, out);
    expect(out.color[0]).toBeLessThan(early);
  });

  test("a long run never allocates new slots beyond capacity (stress)", () => {
    const sim = new ParticleSim(256);
    const out = createInstanceArrays(256);
    for (let f = 0; f < 300; f++) {
      for (let i = 0; i < 20; i++) sim.spawn(init("spark", { vx: Math.sin(i), vy: 2, life: 0.2 + (i % 5) * 0.1 }));
      const n = sim.step(1 / 60, out);
      expect(n).toBeLessThanOrEqual(256);
      for (let i = 0; i < n * 4; i++) expect(Number.isFinite(out.posSize[i])).toBe(true);
    }
  });
});
