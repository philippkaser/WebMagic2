import { describe, expect, test } from "bun:test";
import { interactionGroups as rapierGroups } from "@react-three/rapier";
import { GROUPS } from "../core/config";
import {
  ENEMY_BODIES,
  ENEMY_GROUPS,
  enemyBody,
  interactionGroups,
  PROP_BODIES,
  PROP_GROUPS,
  slimeBody,
  WORLD_GROUPS,
} from "./bodies";

describe("physical body table", () => {
  test("group masks are exactly @react-three/rapier's", () => {
    const cases: [number | number[], number[] | undefined][] = [
      [GROUPS.WORLD, [GROUPS.PLAYER, GROUPS.ENEMY, GROUPS.PROP]],
      [[GROUPS.PLAYER, GROUPS.LOCAL_PLAYER], [GROUPS.WORLD, GROUPS.HOSTILE_SPELL]],
      [GROUPS.PROP, undefined],
    ];
    for (const [m, f] of cases) expect(interactionGroups(m, f)).toBe(rapierGroups(m, f));
  });

  test("world, props and enemies accept each other", () => {
    const accepts = (a: number, b: number) => ((a >>> 16) & b & 0xffff) !== 0 && ((b >>> 16) & a & 0xffff) !== 0;
    expect(accepts(WORLD_GROUPS, PROP_GROUPS)).toBe(true);
    expect(accepts(WORLD_GROUPS, ENEMY_GROUPS)).toBe(true);
    expect(accepts(PROP_GROUPS, ENEMY_GROUPS)).toBe(true);
    expect(accepts(PROP_GROUPS, PROP_GROUPS)).toBe(true);
  });

  test("bodies are what the components always built", () => {
    expect(PROP_BODIES.crate.shape).toEqual({ kind: "cuboid", half: [0.42, 0.42, 0.42] });
    expect(PROP_BODIES.barrel.mass).toBe(2);
    expect(ENEMY_BODIES.wisp.gravityScale).toBe(0); // fliers hover
    expect(ENEMY_BODIES.sentry.type).toBe("fixed");
    expect(enemyBody("boss").shape).toEqual({ kind: "ball", radius: 1.15 });
    // Each slime split is smaller and lighter; slimes feel gravity.
    expect(slimeBody(0).shape).toEqual({ kind: "ball", radius: 0.5 });
    expect(slimeBody(2).mass).toBeLessThan(slimeBody(1).mass);
    expect(slimeBody(1).gravityScale).toBe(1);
  });
});
