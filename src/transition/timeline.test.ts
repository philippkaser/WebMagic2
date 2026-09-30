import { describe, expect, test } from "bun:test";
import {
  TRAVEL_STYLES,
  newCameraFx,
  newOverlayFx,
  sampleCamera,
  sampleOverlay,
  stageProgress,
  travelOverheadMs,
  type TravelKind,
} from "./timeline";

const KINDS = Object.keys(TRAVEL_STYLES) as TravelKind[];

describe("travel styles", () => {
  test("every journey adds well under two seconds on top of the switch", () => {
    for (const kind of KINDS) expect(travelOverheadMs(kind)).toBeLessThan(2000);
  });

  test("every journey has a real tunnel beat", () => {
    for (const kind of KINDS) expect(TRAVEL_STYLES[kind].minTunnelMs).toBeGreaterThanOrEqual(200);
  });

  test("death dissolves instead of opening a vortex; respawn starts from the dark", () => {
    expect(TRAVEL_STYLES.death.look).toBe("dissolve");
    expect(TRAVEL_STYLES.respawn.look).toBe("fromDark");
    for (const kind of ["gate", "descend", "home", "feather"] as const) {
      expect(TRAVEL_STYLES[kind].look).toBe("portal");
    }
  });
});

describe("stageProgress", () => {
  test("clamps to [0, 1] and treats zero-length stages as done", () => {
    expect(stageProgress(100, 200, 50)).toBe(0);
    expect(stageProgress(100, 200, 200)).toBe(0.5);
    expect(stageProgress(100, 200, 900)).toBe(1);
    expect(stageProgress(100, 0, 100)).toBe(1);
  });
});

describe("camera", () => {
  test("idle is exactly the identity", () => {
    const fx = sampleCamera("idle", 0.5, TRAVEL_STYLES.descend, newCameraFx());
    expect(fx).toEqual({ fovMult: 1, roll: 0, pull: 0, lift: 0, aim: 0 });
  });

  test("ENTER starts from rest (no pop when a journey begins)", () => {
    for (const kind of KINDS) {
      const fx = sampleCamera("entering", 0, TRAVEL_STYLES[kind], newCameraFx());
      expect(fx.fovMult).toBeCloseTo(1, 6);
      expect(fx.roll).toBeCloseTo(0, 6);
      expect(fx.pull).toBeCloseTo(0, 6);
      expect(fx.lift).toBeCloseTo(0, 6);
    }
  });

  test("ENTER ends where the TUNNEL holds", () => {
    for (const kind of KINDS) {
      const s = TRAVEL_STYLES[kind];
      const end = sampleCamera("entering", 1, s, newCameraFx());
      const hold = sampleCamera("tunnel", 0.3, s, newCameraFx());
      expect(end.fovMult).toBeCloseTo(hold.fovMult, 6);
      expect(end.roll).toBeCloseTo(hold.roll, 6);
      expect(end.pull).toBeCloseTo(hold.pull, 6);
      expect(end.lift).toBeCloseTo(hold.lift, 6);
    }
  });

  test("ARRIVE ends exactly at rest, so the base FOV is restored bit-for-bit", () => {
    for (const kind of KINDS) {
      const fx = sampleCamera("arriving", 1, TRAVEL_STYLES[kind], newCameraFx());
      expect(fx.fovMult).toBe(1);
      expect(Math.abs(fx.roll)).toBe(0);
      expect(fx.pull).toBe(0);
      expect(Math.abs(fx.lift)).toBe(0);
    }
  });

  test("portal ENTER stretches the view and drags it in; death narrows and drops it", () => {
    const d = sampleCamera("entering", 1, TRAVEL_STYLES.descend, newCameraFx());
    expect(d.fovMult).toBeGreaterThan(1.3);
    expect(d.pull).toBeGreaterThan(1);
    const death = sampleCamera("entering", 1, TRAVEL_STYLES.death, newCameraFx());
    expect(death.fovMult).toBeLessThan(1);
    expect(death.lift).toBeLessThan(-0.5);
    expect(death.aim).toBe(0);
  });

  test("the FOV stays within sane bounds everywhere", () => {
    const fx = newCameraFx();
    for (const kind of KINDS) {
      for (const stage of ["entering", "tunnel", "arriving"] as const) {
        for (let i = 0; i <= 50; i++) {
          sampleCamera(stage, i / 50, TRAVEL_STYLES[kind], fx);
          expect(fx.fovMult).toBeGreaterThan(0.7);
          expect(fx.fovMult).toBeLessThan(1.7);
          expect(Math.abs(fx.roll)).toBeLessThan(0.8);
        }
      }
    }
  });

  test("samplers write into the caller's object (no per-frame allocation)", () => {
    const fx = newCameraFx();
    expect(sampleCamera("entering", 0.5, TRAVEL_STYLES.gate, fx)).toBe(fx);
    const ov = newOverlayFx();
    expect(sampleOverlay("entering", 0.5, TRAVEL_STYLES.gate, ov)).toBe(ov);
  });
});

describe("overlay", () => {
  test("idle draws nothing", () => {
    const ov = sampleOverlay("idle", 0.7, TRAVEL_STYLES.gate, newOverlayFx());
    expect(ov.cover).toBe(0);
  });

  test("the portal iris grows monotonically and closes over the whole view", () => {
    for (const kind of ["gate", "descend", "home", "feather"] as const) {
      const s = TRAVEL_STYLES[kind];
      const ov = newOverlayFx();
      let last = -1;
      for (let i = 0; i <= 40; i++) {
        sampleOverlay("entering", i / 40, s, ov);
        expect(ov.iris).toBeGreaterThanOrEqual(last);
        last = ov.iris;
      }
      expect(sampleOverlay("entering", 0, s, ov).iris).toBe(0);
      expect(sampleOverlay("entering", 1, s, ov).iris).toBe(1);
      expect(sampleOverlay("tunnel", 0, s, ov).iris).toBe(1);
    }
  });

  test("the tunnel fully covers the view", () => {
    for (const kind of KINDS) {
      const ov = sampleOverlay("tunnel", 0.5, TRAVEL_STYLES[kind], newOverlayFx());
      expect(ov.cover).toBe(1);
      expect(ov.reveal).toBe(0);
      expect(ov.fade).toBe(1);
      expect(ov.dark).toBe(0);
    }
  });

  test("ARRIVE opens a reveal from closed to past the corners, then hides", () => {
    const s = TRAVEL_STYLES.descend;
    const ov = newOverlayFx();
    expect(sampleOverlay("arriving", 0, s, ov).reveal).toBe(0);
    let last = -1;
    for (let i = 0; i <= 40; i++) {
      sampleOverlay("arriving", i / 40, s, ov);
      expect(ov.reveal).toBeGreaterThanOrEqual(last);
      last = ov.reveal;
    }
    expect(sampleOverlay("arriving", 1, s, ov).reveal).toBe(1);
    expect(ov.cover).toBe(0);
  });

  test("death burns the world away instead of swirling it", () => {
    const s = TRAVEL_STYLES.death;
    const ov = newOverlayFx();
    expect(sampleOverlay("entering", 0, s, ov).dissolve).toBe(0);
    expect(sampleOverlay("entering", 1, s, ov).dissolve).toBeCloseTo(1, 6);
    expect(ov.iris).toBe(0);
    expect(ov.swirl).toBe(0);
    expect(sampleOverlay("arriving", 1, s, ov).fade).toBeCloseTo(0, 6);
  });

  test("respawn begins fully dark (continuing the death screen) and clears", () => {
    const s = TRAVEL_STYLES.respawn;
    const ov = newOverlayFx();
    expect(sampleOverlay("entering", 0, s, ov).dark).toBe(1);
    expect(ov.cover).toBe(1);
    expect(sampleOverlay("entering", 1, s, ov).dark).toBe(0);
  });
});
