import { describe, expect, test } from "bun:test";
import { Rng } from "../core/rng";
import type { RoomEventSpawn } from "../world/types";
import { ROOM_EVENT_RULES as R, rollRoomReward, shrineBoon } from "./catalog";
import { actOnRoomEvent, aroundRoom, initialRoomState, isSpent, tickRoomEvent, type RoomEventState, type RoomView } from "./rules";

const spawn = (kind: RoomEventSpawn["kind"], variant = 0): RoomEventSpawn => ({
  id: "e0",
  kind,
  pos: [0, 0, 0],
  facing: 0,
  area: [-6, -4, 6, 4],
  variant,
});
const view = (o: Partial<RoomView> = {}): RoomView => ({ inRoom: 0, inCircle: 0, guardsAlive: 0, ...o });

describe("the vault", () => {
  const v = spawn("vault");

  test("sleeps until a wizard walks in, then its guardians wake", () => {
    const s0 = initialRoomState(v);
    expect(tickRoomEvent(v, s0, 0.1, view(), 10)).toBeNull();
    const step = tickRoomEvent(v, s0, 0.1, view({ inRoom: 1 }), 10)!;
    expect(step.state).toMatchObject({ phase: "guarded", guards: ["e0g0", "e0g1"] });
    expect(step.effects).toEqual([{ type: "spawn", ids: ["e0g0", "e0g1"], at: aroundRoom(v, 2, 0) }]);
  });

  test("opens only once the guardians are dead — after a grace for their spawns to land", () => {
    let s: RoomEventState = { kind: "vault", phase: "guarded", t: 0, guards: ["e0g0"] };
    // Nothing counted yet: the spawns may not have arrived.
    s = tickRoomEvent(v, s, 0.5, view({ guardsAlive: 0 }), 10)!.state;
    expect(s).toMatchObject({ phase: "guarded" });
    s = tickRoomEvent(v, s, 1.2, view({ guardsAlive: 1 }), 10)!.state;
    expect(tickRoomEvent(v, s, 0.1, view({ guardsAlive: 1 }), 10)).toBeNull(); // quiet while they live
    const open = tickRoomEvent(v, s, 0.1, view({ guardsAlive: 0 }), 10)!;
    expect(open.state).toMatchObject({ phase: "open" });
  });

  test("an open vault gives its reward once", () => {
    const s: RoomEventState = { kind: "vault", phase: "open", t: 2, guards: [] };
    const step = actOnRoomEvent(v, s, "p1", 10)!;
    expect(step.effects).toEqual([{ type: "reward", kind: "vault" }]);
    expect(isSpent(step.state)).toBe(true);
    expect(actOnRoomEvent(v, step.state, "p2", 10)).toBeNull();
    expect(actOnRoomEvent(v, initialRoomState(v), "p1", 10)).toBeNull(); // sealed: no
  });

  test("more guardians the deeper it lies, never more than five", () => {
    expect(R.vaultGuards(1)).toBe(2);
    expect(R.vaultGuards(30)).toBe(4);
    expect(R.vaultGuards(100)).toBe(5);
  });
});

describe("the ward circle", () => {
  const w = spawn("ward");
  const kindled = () => actOnRoomEvent(w, initialRoomState(w), "p1", 20)!;

  test("kindling it brings the first wave", () => {
    const step = kindled();
    expect(step.state).toMatchObject({ phase: "kindled", waves: 1, progress: 0 });
    expect(step.effects[0]).toMatchObject({ type: "spawn", ids: ["e0w0g0", "e0w0g1", "e0w0g2"] });
    expect(actOnRoomEvent(w, step.state, "p2", 20)).toBeNull(); // only once
  });

  test("held, it fills; the next waves land at their marks; full, it pays", () => {
    let s = kindled().state;
    const spawns: string[][] = [];
    let reward = false;
    for (let t = 0; t < R.wardSeconds + 1 && !isSpent(s); t += 0.25) {
      const step = tickRoomEvent(w, s, 0.25, view({ inCircle: 1 }), 20)!;
      for (const e of step.effects) {
        if (e.type === "spawn") spawns.push(e.ids);
        if (e.type === "reward") reward = true;
      }
      s = step.state;
    }
    expect(s).toMatchObject({ phase: "won", progress: 1 });
    expect(spawns.map((ids) => ids[0])).toEqual(["e0w1g0", "e0w2g0"]);
    expect(reward).toBe(true);
  });

  test("left empty it drains, and breaks if abandoned", () => {
    let s: RoomEventState = { kind: "ward", phase: "kindled", progress: 0.5, waves: 2, idle: 0 };
    s = tickRoomEvent(w, s, 1, view(), 20)!.state;
    expect((s as { progress: number }).progress).toBeLessThan(0.5);
    // Coming back resets the clock.
    s = tickRoomEvent(w, s, 1, view({ inCircle: 2 }), 20)!.state;
    expect(s).toMatchObject({ idle: 0 });
    for (let i = 0; i < R.wardAbandon + 1; i++) s = tickRoomEvent(w, s, 1, view(), 20)?.state ?? s;
    expect(s).toMatchObject({ phase: "broken" });
    expect(isSpent(s)).toBe(true);
  });
});

describe("shrines and fountains", () => {
  test("each wizard may kneel once; the shrine's boon is its own", () => {
    const sh = spawn("shrine", 7);
    const a = actOnRoomEvent(sh, initialRoomState(sh), "p1", 3)!;
    expect(a.effects).toEqual([{ type: "gift", to: "p1", gift: { buff: shrineBoon(7) } }]);
    expect(actOnRoomEvent(sh, a.state, "p1", 3)).toBeNull();
    const b = actOnRoomEvent(sh, a.state, "p2", 3)!;
    expect(b.state).toEqual({ kind: "shrine", takenBy: ["p1", "p2"] });
  });

  test("the fountain mends", () => {
    const f = spawn("fountain");
    expect(actOnRoomEvent(f, initialRoomState(f), "p1", 3)!.effects).toEqual([{ type: "gift", to: "p1", gift: { restore: true } }]);
  });
});

describe("guardian placement and rewards", () => {
  test("guardians stand inside the room, a step in from its walls", () => {
    const v = spawn("vault");
    for (let n = 1; n <= 5; n++) {
      for (const [x, , z] of aroundRoom(v, n, 2)) {
        expect(x).toBeGreaterThanOrEqual(-6 + 1.2 - 1e-6);
        expect(x).toBeLessThanOrEqual(6 - 1.2 + 1e-6);
        expect(z).toBeGreaterThanOrEqual(-4 + 1.2 - 1e-6);
        expect(z).toBeLessThanOrEqual(4 - 1.2 + 1e-6);
      }
    }
  });

  test("a ward always pays riftglass; both pay gear and the band's reagent", () => {
    for (let i = 0; i < 50; i++) {
      const ward = rollRoomReward(new Rng(i + 1), "ward", 25);
      expect(ward.materials.some((m) => m.id === "riftglass")).toBe(true);
      expect(ward.materials[0]!.id).toBe("cinder_iron");
      const vault = rollRoomReward(new Rng(i + 100), "vault", 5);
      expect(vault.materials[0]!.id).toBe("grave_moss");
      expect(vault.item.length).toBeGreaterThan(0);
    }
  });
});
