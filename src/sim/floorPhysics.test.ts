import { beforeAll, describe, expect, test } from "bun:test";
import RAPIER from "@dimforge/rapier3d-compat";
import { generateFloor } from "../world/gen";
import { slimeBody } from "./bodies";
import { buildFloorPhysics } from "./floorPhysics";

beforeAll(async () => {
  await RAPIER.init();
});

describe("headless floor physics", () => {
  test("every enemy, prop and the boss gets a body under the client's ids", () => {
    const layout = generateFloor(4242, 10); // a boss floor
    const physics = buildFloorPhysics(RAPIER, layout);
    expect(physics.counts().bodies).toBe(layout.enemies.length + layout.props.length + 1);
    expect(physics.bodies.has("e0")).toBe(true);
    expect(physics.bodies.has(`p${layout.props.length - 1}`)).toBe(true);
    expect(physics.bodies.has("boss")).toBe(true);
    physics.free();
  });

  test("a floor settles: nothing falls through, the props go to sleep", () => {
    const layout = generateFloor(77, 6);
    const physics = buildFloorPhysics(RAPIER, layout);
    for (let i = 0; i < 60 * 6; i++) physics.step(1 / 60);
    for (const [id, body] of physics.bodies) {
      expect(body.translation().y, id).toBeGreaterThan(-0.5);
    }
    // Props come to rest and sleep; only the hovering fliers may stay awake.
    let awakeProps = 0;
    layout.props.forEach((_, i) => {
      if (!physics.bodies.get(`p${i}`)!.isSleeping()) awakeProps++;
    });
    expect(awakeProps).toBe(0);
    physics.free();
  });

  test("runtime bodies come and go (a slime split)", () => {
    const physics = buildFloorPhysics(RAPIER, generateFloor(9, 4));
    const before = physics.counts().bodies;
    physics.add("s1", slimeBody(1), [0, 2, 0]);
    expect(physics.counts().bodies).toBe(before + 1);
    physics.remove("s1");
    expect(physics.counts().bodies).toBe(before);
    physics.free();
  });
});
