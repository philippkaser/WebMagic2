import { describe, expect, test } from "bun:test";
import { RUN } from "../../../run/rules";
import { OMEN_DEFS, rollOmen } from "../../../world/omens";
import { apx, fontPx, plateSize } from "./ap";
import {
  arrivalTitle,
  bossTitle,
  coinsFor,
  heartbeat,
  heartRate,
  mixHex,
  netStatus,
  presenceMood,
  titheLine,
  titheRunes,
  titheStones,
  VILLAGE_LORE,
  vitalText,
} from "./copy";
import { stepRamp } from "./fade";
import { hudUnit } from "./HudAnchor";
import { apFrac, slotStrip, VITALS } from "./layout";
import { pactParts } from "./PactPrompt";
import { RUNES, spriteRows, type SpriteName } from "./sprites";
import { edgeSpot, screenToWorld, tanHalf, undistortion, viewPoint } from "./frame";
import { HEAP_CAPACITY, heapSlots } from "./heap";
import { settleDelay } from "./useSettled";
import { GAUGE, kickSlosh, makeGauge, makeSlosh, resetGauge, SLOSH, stepGauge, stepSlosh } from "./gauge";

const T = tanHalf(78);

describe("frame", () => {
  test("NDC corners land on the frustum edges", () => {
    const [x, y, z] = viewPoint(1, 1, 2, 1.6, T);
    expect(z).toBe(-2);
    expect(y).toBeCloseTo(2 * T);
    expect(x).toBeCloseTo(2 * T * 1.6);
  });

  test("edge insets are fractions of the screen height on both axes", () => {
    const d = 1;
    const aspect = 1.6;
    const [x, y] = edgeSpot(-1, -1, 0.05, 0.05, d, aspect, T);
    const screenH = 2 * d * T;
    // Distance from the left edge equals distance from the bottom edge.
    const fromLeft = x - -(d * T * aspect);
    const fromBottom = y - -(d * T);
    expect(fromLeft).toBeCloseTo(0.05 * screenH);
    expect(fromBottom).toBeCloseTo(0.05 * screenH);
  });

  test("centred axes treat the inset as an offset", () => {
    const [x, y] = edgeSpot(0, 1, 0, 0.1, 1, 1.6, T);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(T * (1 - 0.2));
  });

  test("screenToWorld is the inverse of a screen fraction", () => {
    expect(screenToWorld(0.5, 1, T)).toBeCloseTo(T);
  });

  test("undistortion: none on axis, cos θ off axis, pointing away from centre", () => {
    expect(undistortion(0, 0, -1)).toEqual({ angle: 0, tilt: 0, squash: 1 });
    const u = undistortion(-1, -1, -1);
    expect(u.squash).toBeCloseTo(1 / Math.sqrt(3));
    expect(u.tilt).toBeCloseTo(Math.atan(Math.SQRT2));
    expect(u.angle).toBeCloseTo(-0.75 * Math.PI);
  });

  test("undistortion makes a sphere at the corner image as a circle", () => {
    // Same composition as <Undistort>: Rz(φ)·Ry(-θ)·Sx(cos θ)·Ry(θ)·Rz(-φ),
    // with three.js's rotation conventions.
    type V = [number, number, number];
    const rz = (a: number, [x, y, z]: V): V => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];
    const ry = (a: number, [x, y, z]: V): V => [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
    const centre: V = [-1.1, -0.62, -1];
    const { angle, tilt, squash } = undistortion(...centre);
    const extents = (correct: boolean) => {
      let rMin = Infinity, rMax = -Infinity, tMin = Infinity, tMax = -Infinity;
      const c = [centre[0] / -centre[2], centre[1] / -centre[2]];
      const ru = [Math.cos(angle), Math.sin(angle)];
      for (let i = 0; i < 400; i++) {
        for (let j = 0; j < 200; j++) {
          const a = (i / 400) * Math.PI * 2;
          const b = (j / 199) * Math.PI - Math.PI / 2;
          let p: V = [0.02 * Math.cos(b) * Math.cos(a), 0.02 * Math.cos(b) * Math.sin(a), 0.02 * Math.sin(b)];
          if (correct) {
            p = rz(-angle, p);
            p = ry(tilt, p);
            p = [p[0] * squash, p[1], p[2]];
            p = ry(-tilt, p);
            p = rz(angle, p);
          }
          const w: V = [p[0] + centre[0], p[1] + centre[1], p[2] + centre[2]];
          const sx = w[0] / -w[2] - c[0]!;
          const sy = w[1] / -w[2] - c[1]!;
          const r = sx * ru[0]! + sy * ru[1]!;
          const t = -sx * ru[1]! + sy * ru[0]!;
          rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
          tMin = Math.min(tMin, t); tMax = Math.max(tMax, t);
        }
      }
      return (rMax - rMin) / (tMax - tMin);
    };
    expect(extents(false)).toBeGreaterThan(1.4); // an egg without it
    expect(extents(true)).toBeCloseTo(1, 1); // a circle with it
  });
});

describe("gauge", () => {
  test("a loss leaves a ghost that holds, then drains down to the level", () => {
    const g = makeGauge(1);
    stepGauge(g, 0.6, 1 / 60);
    expect(g.ghost).toBeCloseTo(1, 5);
    for (let i = 0; i < 20; i++) stepGauge(g, 0.6, 1 / 60); // 1/3 s
    expect(g.level).toBeCloseTo(0.6, 2);
    expect(g.ghost).toBeGreaterThan(0.95); // still holding
    for (let i = 0; i < 240; i++) stepGauge(g, 0.6, 1 / 60); // 4 s
    expect(g.ghost).toBeCloseTo(0.6, 5);
    expect(g.level).toBeCloseTo(0.6, 5);
  });

  test("gains pour in (slower than losses) and never leave a ghost", () => {
    const g = makeGauge(0.2);
    stepGauge(g, 0.9, 0.1);
    expect(g.level).toBeGreaterThan(0.2);
    expect(g.level).toBeLessThan(0.9);
    expect(g.ghost).toBeCloseTo(g.level, 6);
    for (let i = 0; i < 120; i++) stepGauge(g, 0.9, 1 / 60);
    expect(g.level).toBeCloseTo(0.9, 3);
  });

  test("tiny losses (mana ticks) don't arm a ghost", () => {
    const g = makeGauge(0.5);
    stepGauge(g, 0.5 - GAUGE.minLoss / 2, 1 / 60);
    expect(g.hold).toBe(0);
  });

  test("frame-rate independent within a few percent", () => {
    const a = makeGauge(1);
    const b = makeGauge(1);
    for (let i = 0; i < 30; i++) stepGauge(a, 0.3, 1 / 30);
    for (let i = 0; i < 120; i++) stepGauge(b, 0.3, 1 / 120);
    expect(Math.abs(a.level - b.level)).toBeLessThan(0.02);
    expect(Math.abs(a.ghost - b.ghost)).toBeLessThan(0.03);
  });

  test("reset jumps without a ghost; values clamp to 0..1", () => {
    const g = makeGauge(1);
    stepGauge(g, 0.1, 0.05);
    resetGauge(g, 1.4);
    expect(g).toEqual({ level: 1, ghost: 1, hold: 0 });
    stepGauge(g, -3, 10);
    expect(g.level).toBeGreaterThanOrEqual(0);
  });
});

describe("slosh", () => {
  test("a kick rocks and settles back to level", () => {
    const s = makeSlosh();
    kickSlosh(s, 3, -2, 0.5);
    let crossed = false;
    let prev = 0;
    for (let i = 0; i < 60; i++) {
      stepSlosh(s, 0, 0, 1 / 60);
      if (prev > 0 && s.x < 0) crossed = true;
      prev = s.x;
    }
    expect(crossed).toBe(true); // it overshoots — liquid, not syrup
    for (let i = 0; i < 600; i++) stepSlosh(s, 0, 0, 1 / 60);
    expect(Math.abs(s.x)).toBeLessThan(1e-3);
    expect(Math.abs(s.z)).toBeLessThan(1e-3);
    expect(s.wave).toBeLessThan(1e-3);
  });

  test("a steady push leans the surface to push/ω² and stays bounded", () => {
    const s = makeSlosh();
    for (let i = 0; i < 1200; i++) stepSlosh(s, 20, 0, 1 / 60);
    expect(s.x).toBeCloseTo(Math.min(SLOSH.max, 20 / SLOSH.omega ** 2), 3);
    for (let i = 0; i < 100; i++) stepSlosh(s, 1e4, -1e4, 0.25);
    expect(Math.abs(s.x)).toBeLessThanOrEqual(SLOSH.max);
    expect(Math.abs(s.z)).toBeLessThanOrEqual(SLOSH.max);
    expect(Number.isFinite(s.vx)).toBe(true);
  });
});

describe("heap", () => {
  test("deterministic, full capacity, grows from the middle out and up", () => {
    const a = heapSlots(3);
    expect(a).toEqual(heapSlots(3));
    expect(a).toHaveLength(HEAP_CAPACITY);
    expect(HEAP_CAPACITY).toBeGreaterThanOrEqual(coinsFor(1e12));
    // The first few coins sit near the centre and low; the last ones ring
    // the heap or crown it.
    const spread = (s: (typeof a)[number]) => Math.hypot(s.x, s.z) + s.y;
    const early = a.slice(0, 5).reduce((m, s) => Math.max(m, spread(s)), 0);
    const late = a.slice(-5).reduce((m, s) => Math.min(m, spread(s)), Infinity);
    expect(early).toBeLessThan(late);
    for (const s of a) {
      expect(Math.hypot(s.x, s.z)).toBeLessThanOrEqual(3.2);
      expect(s.y).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("settle", () => {
  test("drops show at once, rises wait out the interval, equal never re-shows", () => {
    expect(settleDelay(40, 60, 1000, 1010, 450)).toBe(0);
    expect(settleDelay(61, 60, 1000, 1100, 450)).toBe(350);
    expect(settleDelay(61, 60, 1000, 2000, 450)).toBe(0);
    expect(settleDelay(60, 60, 0, 0, 450)).toBe(Infinity);
  });
});

describe("copy", () => {
  test("vital text rounds the value up and the max to nearest (artpass '87 / 100')", () => {
    expect(vitalText(86.2, 100)).toBe("87 / 100");
    expect(vitalText(0.001, 120.4)).toBe("1 / 120");
    expect(vitalText(-5, 100)).toBe("0 / 100");
    expect(vitalText(100, 100)).toBe("100 / 100");
  });

  test("coin heaps grow logarithmically and cap", () => {
    expect(coinsFor(0)).toBe(0);
    expect(coinsFor(1)).toBeGreaterThanOrEqual(1);
    expect(coinsFor(100)).toBeGreaterThan(coinsFor(10));
    expect(coinsFor(1e9)).toBe(34);
    expect(coinsFor(1e9, 12)).toBe(12);
  });

  test("the tithe kindles one stone per floor played", () => {
    expect(titheStones(0)).toEqual([false, false, false, false, false]);
    expect(titheStones(3)).toEqual([true, true, true, false, false]);
    expect(titheStones(9).every(Boolean)).toBe(true);
    expect(titheStones(1)).toHaveLength(RUN.floorsBeforeExit);
  });

  test("tithe runes: kindled behind you, pulsing underfoot, all gold once home is open", () => {
    expect(titheRunes(0)).toEqual(["dark", "dark", "dark", "dark", "dark"]);
    expect(titheRunes(1)).toEqual(["now", "dark", "dark", "dark", "dark"]);
    expect(titheRunes(3)).toEqual(["done", "done", "now", "dark", "dark"]);
    expect(titheRunes(5).every((r) => r === "home")).toBe(true);
    expect(titheRunes(8).every((r) => r === "home")).toBe(true);
    expect(titheLine(1)).toBe("Survive 4 more to open the way home");
    expect(titheLine(5)).toContain("way home is open");
  });

  test("net status", () => {
    expect(netStatus("online", true, true).text).toBe("◉ online · host");
    expect(netStatus("online", true, false).text).toBe("◉ online");
    expect(netStatus("offline", false, true).text).toBe("○ offline");
    expect(netStatus("online", false, true).color).not.toBe(netStatus("offline", false, true).color);
    expect(netStatus("connecting", false, false).text).toContain("connecting");
  });

  test("arrival titles: village, calm floor, omen floor", () => {
    const village = arrivalTitle(false, 0, 0);
    expect(village).toMatchObject({ label: "Sanctuary", title: "The Village", subtitle: null, lore: VILLAGE_LORE, omen: null });
    const calm = arrivalTitle(true, 1, 12345);
    expect(calm.label).toBe("You descend to");
    expect(calm.title).toBe("Floor 1");
    expect(calm.subtitle).toBe("The Catacombs");
    expect(calm.lore.length).toBeGreaterThan(10); // the biome's epithet
    expect(calm.omen).toBeNull(); // floor 1 is always calm
    // Find a seed whose floor 12 carries an omen and check it's reported.
    let seed = 1;
    while (!rollOmen(seed, 12)) seed++;
    const omen = arrivalTitle(true, 12, seed).omen;
    expect(omen).not.toBeNull();
    expect(OMEN_DEFS.some((o) => o.name === omen!.name && o.whisper === omen!.whisper)).toBe(true);
  });

  test("presence mood: silent alone, calm for allies, redder and wider as a hostile closes", () => {
    expect(presenceMood(0, null).open).toBe(0);
    expect(presenceMood(1, null).ally).toBe(true);
    const far = presenceMood(1, 38);
    const near = presenceMood(1, 3);
    expect(near.threat).toBeGreaterThan(far.threat);
    expect(near.open).toBeGreaterThan(far.open);
    expect(near.line).toBe("It is close");
    expect(far.line).toBe("Something else walks these halls");
    expect(presenceMood(2, 20).line).toBe("It draws nearer…");
    expect(presenceMood(1, null).line).toBe("An ally walks with you");
  });

  test("boss names shouted in caps read as blackletter titles", () => {
    expect(bossTitle("WARDEN OF THE DEEP")).toBe("Warden of the Deep");
    expect(bossTitle("THE HOLLOW KING")).toBe("The Hollow King");
    expect(bossTitle("Morgana the Pale")).toBe("Morgana the Pale");
  });

  test("pact prompt: key cap, words, the name picked out", () => {
    const p = pactParts("F — Offer a pact to Morgana");
    expect(p.key).toBe("F");
    expect(p.spans.map((s) => s.text).join("")).toBe("Offer a pact to Morgana");
    expect(p.spans[1]!.text).toBe("Morgana");
    expect(pactParts("Hello").key).toBeNull();
  });

  test("mixHex", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#ff0000", "#0000ff", 0)).toBe("#ff0000");
    expect(mixHex("#ff0000", "#0000ff", 2)).toBe("#0000ff");
  });

  test("heartbeat quickens with threat and pulses twice per beat", () => {
    expect(heartRate(1)).toBeGreaterThan(heartRate(0));
    const bpm = 60;
    expect(heartbeat(0.05, bpm)).toBeGreaterThan(0.9);
    expect(heartbeat(0.25, bpm)).toBeGreaterThan(0.5);
    expect(heartbeat(0.6, bpm)).toBeLessThan(0.05);
    expect(heartbeat(1.05, bpm)).toBeCloseTo(heartbeat(0.05, bpm), 5);
  });
});

describe("artpass pixels", () => {
  test("one ap pixel is HUD_SCALE/800 of the screen height, at any distance", () => {
    expect(apx(1) / hudUnit(1)).toBeCloseTo(1.25 / 800, 8);
    expect(apx(2.4) / apx(1.2)).toBeCloseTo(2, 8);
    expect(apFrac(800 / 1.25)).toBeCloseTo(1, 8);
  });

  test("font sizes: an 8 px label has a 5 px cap, Jacquard 21 px a 12 px cap", () => {
    expect(fontPx(8, "label", 1) * 7).toBeCloseTo(5 * apx(1), 10);
    expect(fontPx(21, "title", 1) * 7).toBeCloseTo(12 * apx(1), 10);
  });

  test("panels: plate size wraps a CSS padding box in the 8 px frame", () => {
    const [w, h] = plateSize(264, 82);
    // Plate draws its frame one texel (2 px) outside its size: border-box.
    expect(w + 4).toBe(280); // artpass .wm-vitals
    expect(h + 4).toBe(98);
    expect(slotStrip(4).outerW).toBe(252); // artpass .wm-equip, four small cards
  });

  test("the vitals flasks fit side by side with their numbers", () => {
    expect(VITALS.flaskW).toBeCloseTo(26 * VITALS.texel, 10);
    expect(VITALS.outerW).toBeCloseTo(2 * (VITALS.flaskW + VITALS.gap + VITALS.numW) + VITALS.between, 10);
    expect(VITALS.outerH).toBeCloseTo(34 * VITALS.texel, 10);
  });

  test("stepped ramps hit their steps exactly", () => {
    expect(stepRamp(0, 1, 4)).toBe(0);
    expect(stepRamp(0.01, 1, 4)).toBe(0.25);
    expect(stepRamp(0.5, 1, 4)).toBe(0.5);
    expect(stepRamp(2, 1, 4)).toBe(1);
  });

  test("sprites are rectangular and only use palette keys", () => {
    const names: SpriteName[] = ["heart", "drop", "gem", "skull", "pact", "staff", "amulet", "cloak", "boots", "flask", "hourglass", "coin", ...RUNES];
    for (const n of names) {
      const rows = spriteRows(n);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.length).toBe(rows[0]!.length);
        expect(/^[.oabcwWdmMnksSg]+$/.test(r)).toBe(true);
      }
    }
  });
});
