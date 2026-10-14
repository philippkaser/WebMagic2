import { describe, expect, test } from "bun:test";
import type { EnemyId } from "../roster";
import { claimCorpse, createCorpsePool, SLOTS, stepCorpses } from "./corpsePool";
import {
  CorpseState,
  CUE,
  DURATION,
  GIB_OVER,
  startCorpse,
  stepCorpse,
  WARDEN_FINAL_AT,
  type CorpseInit,
} from "./corpseScripts";

const KINDS: EnemyId[] = ["wisp", "shadow", "slime", "sentry", "boss"];

const init = (kind: EnemyId, over = 0, dir: [number, number] | null = [1, 0]): CorpseInit => ({
  kind,
  x: 2,
  y: kind === "sentry" ? 0 : 1.4,
  z: -3,
  yaw: 0.5,
  size: 1,
  dir,
  over,
  seed: 0.37,
});

/** Play a death to the end at 60 fps, recording every cue. */
function play(i: CorpseInit, dt = 1 / 60) {
  const c = startCorpse(new CorpseState(), i);
  const cues: { cue: number; arg: number; t: number; x: number; y: number }[] = [];
  const poses: number[][] = [];
  let frames = 0;
  while (stepCorpse(c, dt, (s, cue, x, y, _z, arg) => cues.push({ cue, arg, t: s.t, x, y })) && frames++ < 1000) {
    poses.push([c.x, c.y, c.z, c.yaw, c.sx, c.sy, c.sz, c.white, c.glow, c.fade, c.px, c.py, c.pz, c.pfade, ...c.shards]);
  }
  return { c, cues, poses, frames };
}

describe("death scripts", () => {
  test("every death is finite throughout and ends gone", () => {
    for (const kind of KINDS) {
      for (const over of [0, 0.3, GIB_OVER, 4]) {
        const { c, poses } = play(init(kind, over));
        for (const p of poses) for (const v of p) expect(Number.isFinite(v)).toBe(true);
        expect(c.live).toBe(false);
        expect(c.fade).toBe(0);
        expect(c.t).toBeLessThanOrEqual(DURATION[kind] + 1 / 30);
      }
    }
  });

  test("the main beat fires exactly once, within the death", () => {
    for (const kind of KINDS) {
      const { cues, c } = play(init(kind));
      const main = cues.filter((q) => q.cue === CUE.main);
      expect(main.length).toBe(1);
      expect(main[0].t).toBeLessThanOrEqual(c.dur + 1e-9);
    }
  });

  test("a big overkill skips the build-up", () => {
    for (const kind of ["wisp", "shadow", "slime"] as EnemyId[]) {
      const calm = play(init(kind, 0));
      const gib = play(init(kind, GIB_OVER + 0.2));
      expect(gib.c.dur).toBeLessThan(calm.c.dur);
      const at = (r: ReturnType<typeof play>) => r.cues.find((q) => q.cue === CUE.main)!.t;
      expect(at(gib)).toBeLessThanOrEqual(at(calm));
    }
  });

  test("overkill flings a wisp further along the blow", () => {
    const soft = play(init("wisp", 0));
    const rail = play(init("wisp", 1.5));
    const pop = (r: ReturnType<typeof play>) => r.cues.find((q) => q.cue === CUE.main)!;
    expect(pop(rail).x - 2).toBeGreaterThan(pop(soft).x - 2);
    expect(pop(soft).x).toBeGreaterThan(2); // along +x, the blow's way
  });

  test("the wisp swells white-hot, then implodes", () => {
    const c = startCorpse(new CorpseState(), init("wisp"));
    stepCorpse(c, 0.05, () => {});
    expect(c.sx).toBeGreaterThan(1.1);
    expect(c.white).toBe(1);
    stepCorpse(c, 0.2, () => {});
    expect(c.sx).toBeLessThan(0.5);
  });

  test("the sentry's head flies off along the blow, bounces once, then shatters", () => {
    const { cues } = play(init("sentry", 0.2, [0, 1]));
    const kinds = cues.map((q) => q.cue);
    expect(kinds.filter((k) => k === CUE.crack).length).toBe(1);
    expect(kinds.filter((k) => k === CUE.bounce).length).toBeLessThanOrEqual(1);
    const shatter = cues.find((q) => q.cue === CUE.main)!;
    expect(shatter.y).toBeLessThan(1.05); // on (or near) the stone
    expect(kinds.indexOf(CUE.crack)).toBeLessThan(kinds.indexOf(CUE.main));
  });

  test("the shadow's eyes outlast its body, and go out one by one", () => {
    const c = startCorpse(new CorpseState(), init("shadow"));
    let bodyGone = -1;
    let eye0Out = -1;
    let eye1Out = -1;
    for (let i = 0; i < 200 && c.live; i++) {
      stepCorpse(c, 1 / 60, () => {});
      if (bodyGone < 0 && c.fade <= 0.02) bodyGone = c.t;
      if (eye0Out < 0 && c.eye0 === 0) eye0Out = c.t;
      if (eye1Out < 0 && c.eye1 === 0) eye1Out = c.t;
    }
    expect(eye0Out).toBeGreaterThan(0);
    expect(eye1Out).toBeGreaterThan(eye0Out);
    expect(eye0Out).toBeGreaterThan(bodyGone - 0.25);
  });

  test("the slime splats flat onto the floor", () => {
    const c = startCorpse(new CorpseState(), init("slime"));
    let splat = false;
    for (let i = 0; i < 30; i++) stepCorpse(c, 1 / 60, (_s, cue) => (splat ||= cue === CUE.main));
    expect(splat).toBe(true);
    expect(c.sy).toBeLessThan(0.2);
    expect(c.sx).toBeGreaterThan(1.5);
    expect(c.y).toBeLessThan(0.1);
  });

  test("the Warden sheds three shards, then goes critical", () => {
    const { cues } = play(init("boss"));
    const shards = cues.filter((q) => q.cue === CUE.shard).map((q) => q.arg);
    expect(shards).toEqual([0, 1, 2]);
    const final = cues.find((q) => q.cue === CUE.main)!;
    expect(final.t).toBeGreaterThanOrEqual(WARDEN_FINAL_AT);
    expect(cues.indexOf(final)).toBe(cues.length - 1);
  });

  test("a death is the same on every client (deterministic per seed)", () => {
    expect(play(init("sentry", 0.4)).poses).toEqual(play(init("sentry", 0.4)).poses);
    expect(play(init("boss")).poses).toEqual(play(init("boss")).poses);
  });

  test("hitstop holds a corpse where it is", () => {
    const c = startCorpse(new CorpseState(), init("wisp"));
    stepCorpse(c, 0.1, () => {});
    const t = c.t;
    const sx = c.sx;
    expect(stepCorpse(c, 0, () => {})).toBe(true);
    expect(c.t).toBe(t);
    expect(c.sx).toBe(sx);
  });
});

describe("the corpse pool", () => {
  test("steals the oldest slot when full, still firing its main beat", () => {
    const pool = createCorpsePool();
    const mains: number[] = [];
    const sink = (_c: CorpseState, cue: number) => {
      if (cue === CUE.main) mains.push(1);
    };
    for (let i = 0; i < SLOTS.slime; i++) {
      claimCorpse(pool, init("slime"), sink);
      stepCorpses(pool, 0.01, sink);
    }
    expect(pool.slime.every((c) => c.live)).toBe(true);
    const before = mains.length;
    const slot = claimCorpse(pool, init("slime"), sink);
    expect(slot).toBe(0); // the first one started is the oldest
    expect(mains.length).toBe(before + 1);
  });

  test("runs every live death and lets them finish", () => {
    const pool = createCorpsePool();
    for (const kind of KINDS) claimCorpse(pool, init(kind), () => {});
    expect(stepCorpses(pool, 0.01, () => {})).toBe(KINDS.length);
    let n = 1;
    for (let i = 0; i < 400 && n > 0; i++) n = stepCorpses(pool, 1 / 60, () => {});
    expect(n).toBe(0);
  });
});
