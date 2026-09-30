import { describe, expect, test } from "bun:test";
import type { ItemInstance } from "../items/types";
import type { ServerMsg } from "./protocol";
import { GameServerCore } from "./serverCore";

/** Every encounter roll succeeds unless told otherwise. */
function setup(random = () => 0) {
  let t = 0;
  const core = new GameServerCore({ random, now: () => t });
  const inbox = new Map<string, ServerMsg[]>();
  const join = (id: string) => {
    inbox.set(id, []);
    core.connect(id, (m) => inbox.get(id)!.push(m));
    core.receive(id, { t: "hello", name: id.toUpperCase() });
  };
  const of = <T extends ServerMsg["t"]>(id: string, type: T) =>
    inbox.get(id)!.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === type);
  return { core, join, of, advance: (ms: number) => (t += ms) };
}

const loot = (uid: string): ItemInstance => ({ uid, defId: "ember_staff", level: 7, rarity: "epic", runLoot: true });

describe("GameServerCore", () => {
  test("wizard-vs-wizard hits reach the victim; allies are shoved, never wounded", () => {
    const { core, join, of } = setup();
    join("a");
    join("b");
    core.receive("a", { t: "enterFloor", floor: 3 });
    core.receive("b", { t: "enterFloor", floor: 3 });
    expect(of("b", "floorAssigned")[0].assignment.joinedExisting).toBe(true);

    core.receive("a", { t: "pvpHit", targetId: "b", damage: 12, impulse: { x: 1, y: 0, z: 0 } });
    expect(of("b", "pvpHit")).toHaveLength(1);
    expect(of("b", "pvpHit")[0].fromId).toBe("a");

    core.receive("a", { t: "pactOffer", targetId: "b" });
    expect(of("b", "pactOffered")).toHaveLength(1);
    core.receive("b", { t: "pactOffer", targetId: "a" });
    expect(of("a", "pactFormed")[0].allyId).toBe("b");

    core.receive("a", { t: "pvpHit", targetId: "b", damage: 12, impulse: { x: 1, y: 0, z: 0 } });
    expect(of("b", "pvpHit")).toHaveLength(2);
    expect(of("b", "pvpHit")[1].damage).toBe(0);
  });

  test("a fallen wizard leaves a chest that exactly one rival can claim", () => {
    const { core, join, of } = setup();
    for (const id of ["a", "b", "c"]) {
      join(id);
      core.receive(id, { t: "enterFloor", floor: 8 });
    }
    core.receive("a", { t: "died", pos: [1, 0, 2], items: [loot("x1"), loot("x2")], killerId: "b" });
    const spawn = of("b", "chestSpawn")[0].chest;
    expect(spawn.itemCount).toBe(2);
    expect(spawn.owner).toBe("A");
    expect(of("c", "peerDied")[0].killerName).toBe("B");

    core.receive("b", { t: "openChest", chestId: spawn.id });
    core.receive("c", { t: "openChest", chestId: spawn.id });
    expect(of("b", "chestGrant")[0].items.map((i) => i.uid)).toEqual(["x1", "x2"]);
    expect(of("c", "chestGrant")).toHaveLength(0);
    expect(of("c", "chestOpened")[0].by).toBe("b");
  });

  test("unclaimed chests become remains inherited by the next instance of that floor", () => {
    const { core, join, of, advance } = setup(() => 0.99); // never meet anyone
    join("a");
    core.receive("a", { t: "enterFloor", floor: 4 });
    core.receive("a", { t: "died", pos: [0, 0, 0], items: [loot("r1")], killerId: null });
    advance(1000);
    join("z");
    core.receive("z", { t: "enterFloor", floor: 4 });
    const chests = of("z", "floorAssigned")[0].assignment.chests;
    expect(chests).toHaveLength(1);
    expect(chests[0].slot).toBe(0);
    expect(chests[0].pos).toBeNull();
    core.receive("z", { t: "openChest", chestId: chests[0].id });
    expect(of("z", "chestGrant")[0].items[0].uid).toBe("r1");
  });

  test("remains rot away after their time", () => {
    const { core, join, of, advance } = setup(() => 0.99);
    join("a");
    core.receive("a", { t: "enterFloor", floor: 4 });
    core.receive("a", { t: "died", pos: [0, 0, 0], items: [loot("r1")], killerId: null });
    advance(60 * 60 * 1000);
    join("z");
    core.receive("z", { t: "enterFloor", floor: 4 });
    expect(of("z", "floorAssigned")[0].assignment.chests).toHaveLength(0);
  });

  test("only the host may publish entity state", () => {
    const { core, join, of } = setup();
    join("a");
    join("b");
    core.receive("a", { t: "enterFloor", floor: 2 });
    core.receive("b", { t: "enterFloor", floor: 2 });
    core.receive("b", { t: "entity", ents: [{ id: "e0", p: [0, 0, 0] }] });
    expect(of("a", "entitySnap")).toHaveLength(0);
    core.receive("a", { t: "entity", ents: [{ id: "e0", p: [0, 0, 0] }] });
    expect(of("b", "entitySnap")).toHaveLength(1);
  });

  test("leaving the dungeon breaks pacts", () => {
    const { core, join, of } = setup();
    join("a");
    join("b");
    core.receive("a", { t: "enterFloor", floor: 2 });
    core.receive("b", { t: "enterFloor", floor: 2 });
    core.receive("a", { t: "pactOffer", targetId: "b" });
    core.receive("b", { t: "pactOffer", targetId: "a" });
    core.receive("a", { t: "leaveDungeon" });
    expect(of("b", "pactBroken")[0].allyId).toBe("a");
  });
});
