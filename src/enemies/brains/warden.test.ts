import { describe, expect, test } from "bun:test";
import { createMove } from "./common";
import {
  createWardenBrain,
  createWardenMoveInput,
  isEnraged,
  pickWardenAttack,
  tickWardenAttack,
  tickWardenMove,
  WARDEN,
  wardenChargeVelocity,
  wardenRangeFactor,
  wardenRingBolt,
  wardenRingCount,
  wardenVolleyAim,
  wardenVolleyBolt,
  wardenVolleyCount,
  type WardenMoveInput,
} from "./warden";

const SETTLED_DT = 10;

function dice(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

/** Warden at its home height, target `dist` away along +x. */
function sense(dist: number, overrides: Partial<WardenMoveInput> = {}): WardenMoveInput {
  return Object.assign(createWardenMoveInput(), {
    pos: { x: 0, y: 1.8, z: 0 },
    aim: { x: dist, y: 0, z: 0 },
    dist,
    homeY: 1.8,
    dt: SETTLED_DT,
    ...overrides,
  });
}

describe("warden attack picker", () => {
  test("up close: slam or ring", () => {
    expect(pickWardenAttack(3, dice(0))).toBe("slam");
    expect(pickWardenAttack(3, dice(0.9))).toBe("ring");
  });

  test("far away: charge or volley", () => {
    expect(pickWardenAttack(15, dice(0))).toBe("charge");
    expect(pickWardenAttack(15, dice(0.9))).toBe("volley");
  });

  test("mid range: volley, ring or charge", () => {
    expect(pickWardenAttack(8, dice(0.1))).toBe("volley");
    expect(pickWardenAttack(8, dice(0.6))).toBe("ring");
    expect(pickWardenAttack(8, dice(0.9))).toBe("charge");
  });
});

describe("warden attack clock", () => {
  test("waits out its opening delay, then attacks on its cooldown", () => {
    const b = createWardenBrain(dice(0.1)); // mid-range volley
    expect(tickWardenAttack(b, 8, false, WARDEN.firstAttack - 0.1)).toBeNull();
    expect(tickWardenAttack(b, 8, false, 0.11)).toBe("volley");
    expect(b.attackTimer).toBe(WARDEN.cooldown);
  });

  test("enraged shortens the cooldown", () => {
    const b = createWardenBrain(dice(0.1));
    b.attackTimer = 0;
    tickWardenAttack(b, 8, true, 0.01);
    expect(b.attackTimer).toBe(WARDEN.enragedCooldown);
    expect(isEnraged(40, 100)).toBe(true);
    expect(isEnraged(60, 100)).toBe(false);
  });

  test("holds fire out of range, and fires the moment a wizard steps in", () => {
    const b = createWardenBrain(dice(0.1));
    b.attackTimer = 0;
    expect(tickWardenAttack(b, WARDEN.attackRange + 1, false, 0.1)).toBeNull();
    expect(tickWardenAttack(b, 8, false, 0.1)).toBe("volley");
  });

  test("a slam arms a telegraph, detonates after it, and blocks other attacks", () => {
    const b = createWardenBrain(dice(0)); // close range → slam
    b.attackTimer = 0;
    expect(tickWardenAttack(b, 3, false, 0.01)).toBe("slam");
    expect(b.slamTelegraph).toBe(WARDEN.slamTelegraph);

    b.attackTimer = -5; // even with the cooldown long done…
    expect(tickWardenAttack(b, 3, false, WARDEN.slamTelegraph / 2)).toBeNull();
    expect(tickWardenAttack(b, 3, false, WARDEN.slamTelegraph / 2)).toBe("boom");
    expect(b.attackTimer).toBe(-5); // …the clock was frozen during the wind-up
  });

  test("a charge suspends steering for its duration", () => {
    const b = createWardenBrain(dice(0)); // far → charge
    b.attackTimer = 0;
    expect(tickWardenAttack(b, 15, false, 0.01)).toBe("charge");
    const out = createMove();
    tickWardenMove(b, sense(15, { dt: WARDEN.chargeTime / 2 }), out);
    expect(out.apply).toBe(false);
    tickWardenMove(b, sense(15, { dt: WARDEN.chargeTime / 2 }), out);
    expect(out.apply).toBe(false);
    tickWardenMove(b, sense(15, { dt: 1 / 60 }), out);
    expect(out.apply).toBe(true);
  });
});

describe("warden movement", () => {
  test("closes in when far, backs off when crowded, holds in between", () => {
    expect(wardenRangeFactor(10)).toBe(1);
    expect(wardenRangeFactor(5)).toBe(0);
    expect(wardenRangeFactor(2)).toBe(-WARDEN.retreatFactor);

    const b = createWardenBrain(dice(0));
    const out = createMove();
    expect(tickWardenMove(b, sense(10), out).vel.x).toBeCloseTo(WARDEN.walkSpeed);
    expect(tickWardenMove(b, sense(5), out).vel.x).toBeCloseTo(0);
    expect(tickWardenMove(b, sense(2), out).vel.x).toBeCloseTo(-WARDEN.walkSpeed * WARDEN.retreatFactor);
  });

  test("enrage and the floor's speed rule both speed it up", () => {
    const b = createWardenBrain(dice(0));
    const out = createMove();
    expect(tickWardenMove(b, sense(10, { enraged: true }), out).vel.x).toBeCloseTo(WARDEN.enragedWalkSpeed);
    expect(tickWardenMove(b, sense(10, { speedMult: 1.5 }), out).vel.x).toBeCloseTo(WARDEN.walkSpeed * 1.5);
  });

  test("hovers back toward its home height", () => {
    const b = createWardenBrain(dice(0));
    const out = tickWardenMove(b, sense(5, { pos: { x: 0, y: 0.8, z: 0 } }), createMove());
    expect(out.vel.y).toBeGreaterThan(0);
  });

  test("charge launches along the planar aim, scaled by the speed rule", () => {
    const v = wardenChargeVelocity({ x: 3, y: 5, z: 4 }, 1, { x: 0, y: 0, z: 0 });
    expect(v.x).toBeCloseTo(WARDEN.chargeSpeed * 0.6);
    expect(v.z).toBeCloseTo(WARDEN.chargeSpeed * 0.8);
    expect(v.y).toBe(WARDEN.chargeLift);
    const fast = wardenChargeVelocity({ x: 1, y: 0, z: 0 }, 2, { x: 0, y: 0, z: 0 });
    expect(fast.x).toBeCloseTo(WARDEN.chargeSpeed * 2);
  });
});

describe("warden projectiles", () => {
  test("volley aim leads a moving target", () => {
    const still = wardenVolleyAim({ x: 0, y: 0, z: 10 }, 10, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    expect(still.z).toBeCloseTo(1);
    const moving = wardenVolleyAim({ x: 0, y: 0, z: 10 }, 10, { x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    expect(moving.x).toBeGreaterThan(0);
    expect(Math.hypot(moving.x, moving.y, moving.z)).toBeCloseTo(1);
    expect(moving.x / moving.z).toBeCloseTo((5 * WARDEN.volleyLead) / 10);
  });

  test("volley spread is centred on the aim", () => {
    const dir = { x: 0, y: 0, z: 1 };
    const centred = wardenVolleyBolt(dir, dice(0.5), { x: 0, y: 0, z: 0 });
    expect(centred).toEqual({ x: 0, y: 0, z: WARDEN.volleySpeed });
    const skewed = wardenVolleyBolt(dir, dice(1), { x: 0, y: 0, z: 0 });
    expect(skewed.x).toBeCloseTo(0.5 * WARDEN.volleySpreadXZ * WARDEN.volleySpeed);
  });

  test("enraged volleys and rings are denser", () => {
    expect(wardenVolleyCount(true)).toBeGreaterThan(wardenVolleyCount(false));
    expect(wardenRingCount(true)).toBeGreaterThan(wardenRingCount(false));
  });

  test("ring bolts are evenly spaced and rising", () => {
    const n = wardenRingCount(false);
    const first = wardenRingBolt(0, n, { x: 0, y: 0, z: 0 });
    expect(first.x).toBeCloseTo(WARDEN.ringSpeed);
    expect(first.z).toBeCloseTo(0);
    const half = wardenRingBolt(n / 2, n, { x: 0, y: 0, z: 0 });
    expect(half.x).toBeCloseTo(-WARDEN.ringSpeed);
    expect(half.y).toBe(WARDEN.ringLift);
  });
});
