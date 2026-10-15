import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { allocId, registerHittable, resetRegistries, type Hittable, type HitTeam } from "../game/registry";
import { burstOn, struckBy } from "./land";

function body(team: HitTeam, x: number, y: number, z: number, radius = 0.5): Hittable {
  const h: Hittable = { id: allocId(), team, radius, getPosition: () => ({ x, y, z }), hit: () => {} };
  registerHittable(h);
  return h;
}

beforeEach(resetRegistries);
afterEach(resetRegistries);

describe("what a bolt burst on", () => {
  // A creature (0.5 m) pressed against a wall; a bolt of 0.13 touches the
  // wall with its skin 2 cm from the creature's.
  const wall = { x: 2, y: 1, z: 0 };
  const at = { x: 0.5 + 0.02 + 0.13, y: 1, z: 0 };
  const slack = 0.13 + 0.05;

  test("a wall touched right beside a creature bursts on the creature", () => {
    const sentry = body("enemy", 0, 1, 0);
    expect(struckBy(wall, at, slack)).toBe(sentry);
    expect(burstOn(wall, at, slack, new Set())).toBe(sentry);
  });

  test("not on one the bolt already pierced: it had its pass, the burst is only blast", () => {
    const sentry = body("enemy", 0, 1, 0);
    expect(burstOn(wall, at, slack, new Set([sentry]))).toBeNull();
  });

  test("one it hasn't been through yet still takes the full blow", () => {
    const passed = body("enemy", 0, 1, -3);
    const sentry = body("enemy", 0, 1, 0);
    expect(burstOn(wall, at, slack, new Set([passed]))).toBe(sentry);
  });

  test("the body it touched, matched exactly, is what it burst on", () => {
    const crate = body("prop", 3, 0.5, 0);
    expect(burstOn({ x: 3, y: 0.5, z: 0 }, { x: 2.4, y: 0.5, z: 0 }, slack, new Set())).toBe(crate);
  });
});
