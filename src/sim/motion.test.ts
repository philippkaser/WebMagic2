import { beforeAll, describe, expect, test } from "bun:test";
import RAPIER from "@dimforge/rapier3d-compat";
import { PLAYER } from "../core/config";
import { generateFloor } from "../world/gen";
import type { Vec3 } from "../world/types";
import { buildFloorPhysics } from "./floorPhysics";
import { MOTION, MotionGuard } from "./motion";

beforeAll(async () => {
  await RAPIER.init();
});

const layout = generateFloor(7, 3);

function guard() {
  const physics = buildFloorPhysics(RAPIER, layout);
  return { g: new MotionGuard(RAPIER, physics.world, layout.extent), physics };
}

const start: Vec3 = [layout.spawn[0], 1.1, layout.spawn[2]];

describe("movement plausibility", () => {
  test("walking, running and dashing are fine; a teleport is not", () => {
    const { g } = guard();
    let now = 0;
    expect(g.judge("w", start, now)).toBe("ok");
    // Run along a free line for two seconds at full speed, at 20 Hz.
    const dir = freeDirection(g, start, 16);
    let at = start;
    for (let i = 0; i < 40; i++) {
      now += 0.05;
      at = [at[0] + dir[0] * PLAYER.speed * 0.05, at[1], at[2] + dir[2] * PLAYER.speed * 0.05];
      expect(g.judge("w", at, now)).toBe("ok");
    }
    // A dash: 19 m/s for a quarter second, in one pose.
    now += 0.05;
    const dashed: Vec3 = [at[0] - dir[0] * PLAYER.dashSpeed * 0.25, at[1], at[2] - dir[2] * PLAYER.dashSpeed * 0.25];
    expect(g.judge("w", dashed, now)).toBe("ok");
    // Across the floor in a twentieth of a second: no.
    now += 0.05;
    const inWall = (p: Vec3) => (g as unknown as { insideWall(p: Vec3): boolean }).insideWall(p);
    const far = [layout.treasure, layout.exit, ...layout.enemies.map((e) => e.pos)]
      .map((p): Vec3 => [p[0], 1.1, p[2]])
      .find((p) => !inWall(p) && Math.hypot(p[0] - dashed[0], p[2] - dashed[2]) > MOTION.burst + 2)!;
    expect(g.judge("w", far, now)).toBe("tooFast");
    expect(g.lastGood("w")).toEqual(dashed);
  });

  test("the budget refills with time — and faster with speed gear", () => {
    const { g } = guard();
    g.judge("w", start, 0);
    const dir = freeDirection(g, start, 16);
    const out: Vec3 = [start[0] + dir[0] * 14, start[1], start[2] + dir[2] * 14];
    // 14 m in a blink spends most of the burst…
    expect(g.judge("w", out, 0.01)).toBe("ok");
    // …so 14 m back 0.2 s later is too much at base speed (10 + 0.2 × 16.4)…
    expect(g.judge("w", start, 0.21)).toBe("tooFast");
    // …and fine in boots of haste (10 + 0.2 × 26.2).
    expect(g.judge("w", start, 0.21, 1.6)).toBe("ok");
  });

  test("never inside a wall, never off the floor", () => {
    const { g } = guard();
    const wall = layout.wallBoxes[0].center;
    expect(g.judge("w", [wall[0], 1.1, wall[2]], 0)).toBe("inWall");
    expect(g.judge("w", [start[0], -5, start[2]], 0)).toBe("outside");
    expect(g.judge("w", [layout.extent + 10, 1.1, 0], 0)).toBe("outside");
  });

  test("through a wall is refused; rounding a corner fast is not", () => {
    const { g } = guard();
    // Find a wall in reach of the start and an open spot right behind it.
    const crossing = wallCrossing(g, start);
    g.judge("w", crossing.before, 0);
    expect(g.judge("w", crossing.after, 0.5)).toBe("throughWall");
    // A corner clip: two good poses whose straight line nicks a wall's edge.
    const { g: g2 } = guard();
    const clip = cornerClip(g2);
    g2.judge("w", clip.a, 0);
    expect(g2.judge("w", clip.b, 0.1)).toBe("ok");
  });
});

/** A direction from `p` with `clear` metres free of walls. */
function freeDirection(g: MotionGuard, p: Vec3, clear: number): Vec3 {
  const cast = (g as unknown as { cast(a: Vec3, b: Vec3, d: number): number | null }).cast.bind(g);
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    const to: Vec3 = [p[0] + Math.cos(a) * clear, p[1], p[2] + Math.sin(a) * clear];
    if (cast(p, to, clear) === null) return [Math.cos(a), 0, Math.sin(a)];
  }
  throw new Error("no free direction");
}

/** Two open spots with a real wall between them, within the burst. */
function wallCrossing(g: MotionGuard, from: Vec3): { before: Vec3; after: Vec3 } {
  const inWall = (p: Vec3) => (g as unknown as { insideWall(p: Vec3): boolean }).insideWall(p);
  const cast = (g as unknown as { cast(a: Vec3, b: Vec3, d: number): number | null }).cast.bind(g);
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * Math.PI * 2;
    const dir: Vec3 = [Math.cos(a), 0, Math.sin(a)];
    const hit = cast(from, [from[0] + dir[0] * 20, from[1], from[2] + dir[2] * 20], 20);
    if (hit === null || hit > 12) continue;
    for (let beyond = 1; beyond < 8; beyond += 0.5) {
      const after: Vec3 = [from[0] + dir[0] * (hit + beyond), from[1], from[2] + dir[2] * (hit + beyond)];
      if (!inWall(after) && Math.abs(after[0]) < layout.extent && Math.abs(after[2]) < layout.extent) {
        if (hit + beyond < MOTION.burst) return { before: from, after };
        break;
      }
    }
  }
  throw new Error("no wall to walk through");
}

/** Two open spots 1.2 m apart whose straight line cuts a wall's corner by
 * less than MOTION.wallDepth. */
function cornerClip(g: MotionGuard): { a: Vec3; b: Vec3 } {
  const inWall = (p: Vec3) => (g as unknown as { insideWall(p: Vec3): boolean }).insideWall(p);
  const cast = (g as unknown as { cast(a: Vec3, b: Vec3, d: number): number | null }).cast.bind(g);
  for (const box of layout.wallBoxes) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        // The box's corner, a spot beside each of the two faces that meet
        // there; the line between them cuts the corner.
        const cx = box.center[0] + sx * box.half[0];
        const cz = box.center[2] + sz * box.half[2];
        const a: Vec3 = [cx + sx * 0.45, 1.1, cz - sz * 0.6];
        const b: Vec3 = [cx - sx * 0.6, 1.1, cz + sz * 0.45];
        if (inWall(a) || inWall(b)) continue;
        const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const fwd = cast(a, b, d);
        const back = cast(b, a, d);
        if (fwd !== null && back !== null && d - fwd - back < MOTION.wallDepth) return { a, b };
      }
    }
  }
  throw new Error("no corner to clip");
}
