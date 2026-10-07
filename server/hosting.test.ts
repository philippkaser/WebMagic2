import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import RAPIER from "@dimforge/rapier3d-compat";
import { FloorDirectory } from "../src/net/matchmaking";
import { SERVER_HOST_ID, type ServerMsg } from "../src/net/protocol";
import { generateFloor } from "../src/world/gen";
import type { Vec3 } from "../src/world/types";
import { AccountStore } from "./accounts";
import type { FloorHost } from "./floorHost";
import { serverHosting, type HostingPolicy } from "./hosting";
import { HANDOVER_TIMEOUT_MS, Relay, type RelayPeer } from "./relay";

/** Server-hosted floors: the router hands a floor to a floor host on the
 * server (server/floorHost.ts), which then IS the floor's host — these
 * tests drive it through the router exactly as clients would. */

beforeAll(async () => {
  await RAPIER.init();
});

interface TestPeer extends RelayPeer {
  inbox: ServerMsg[];
}

function makePeer(id: string): TestPeer {
  const peer: TestPeer = { id, name: `Wizard ${id}`, inbox: [], send: (m) => void peer.inbox.push(m) };
  return peer;
}

type Env = Extract<ServerMsg, { t: "msg" }>;
const envs = (p: TestPeer, ch: string) => p.inbox.filter((m): m is Env => m.t === "msg" && m.ch === ch);
const lastOf = <T extends ServerMsg["t"]>(p: TestPeer, t: T) =>
  [...p.inbox].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined;

const SEED = 1234;
const FLOOR = 1;
const layout = generateFloor(SEED, FLOOR);

let relay: Relay;
let store: AccountStore;
let a: TestPeer;
let b: TestPeer;
let c: TestPeer;
let now = 50_000;

function setup(policy: HostingPolicy) {
  now = 50_000;
  store = new AccountStore();
  relay = new Relay(new FloorDirectory(4, () => SEED, () => now, () => 0), store, () => now, undefined, {
    pace: null,
    devLoot: true,
    random: () => 0.5,
    hosting: serverHosting(RAPIER, policy, { random: () => 0.5 }),
  });
  a = makePeer("A");
  b = makePeer("B");
  c = makePeer("C");
  for (const p of [a, b, c]) {
    relay.connect(p);
    relay.handle(p.id, { t: "login", name: p.name });
  }
}

const account = (p: TestPeer) => store.get(lastOf(p, "loggedIn")!.token)!;

function join(p: TestPeer) {
  now += 10;
  const acc = account(p);
  acc.runFloor = FLOOR;
  acc.runFloors = 1;
  relay.handle(p.id, { t: "enterFloor", floor: FLOOR });
}

const send = (p: TestPeer, ch: string, data: unknown, to?: string) => relay.handle(p.id, { t: "msg", ch, data, to });
const pose = (p: TestPeer, at: Vec3) => send(p, "p:pose", { p: at, v: [0, 0, 0], a: [0, 0], staffId: "s" });
const instId = (p: TestPeer) => lastOf(p, "floorAssigned")!.assignment.instanceId;

/** The server's host of A's floor (white-box: its sim and its refusals). */
function host(): FloorHost {
  const hosted = (relay as unknown as { hosted: Map<string, { host: FloorHost }> }).hosted;
  return hosted.get(instId(a))!.host;
}

/** A spot `range` m from enemy `i` in the open, and the aim back at it. */
function standoff(i: number, range: number): { spot: Vec3; aim: Vec3 } {
  const sim = host().sim;
  const id = `e${i}`;
  const t = sim.physics.bodies.get(id)!.translation();
  const body = sim.physics.bodies.get(id)!;
  for (let k = 0; k < 16; k++) {
    const ang = (k / 16) * Math.PI * 2;
    const d = { x: Math.cos(ang), y: 0, z: Math.sin(ang) };
    if (sim.world.clearShot(t, d, range + 1, body)) {
      return { spot: [t.x + d.x * range, t.y, t.z + d.z * range], aim: [-d.x, 0, -d.z] };
    }
  }
  throw new Error("no open spot");
}

/** A cast message, as a client sends it (claimed stats included). */
function castOf(abilityId: string, from: Vec3, dir: Vec3, seed = 1, stats = { damageMult: 1, extraProjectiles: 0, homing: 0 }) {
  return { abilityId, origin: from, dir, seed, staffId: "apprentice_staff", stats };
}

/** A takes the floor alone, B arrives, and A hands the floor over with the
 * world sync the server asked for. */
function handOver(dead: string[] = []) {
  join(a);
  join(b);
  send(a, "a:worldSync", { dead, ents: [], custom: {} }, SERVER_HOST_ID);
}

describe("hosting policy", () => {
  test('"shared": a floor is a wizard\'s while they are alone, the server\'s once someone joins', () => {
    setup("shared");
    join(a);
    expect(lastOf(a, "floorAssigned")!.assignment.hostId).toBe("A");
    expect(relay.serverHosts(instId(a))).toBe(false);
    join(b);
    // The wizard host is asked for the floor, for the server; B arrives on
    // A's floor, synced by A as always.
    expect(a.inbox.filter((m) => m.t === "syncRequest").map((m) => (m as { playerId: string }).playerId)).toEqual([
      SERVER_HOST_ID,
      "B",
    ]);
    expect(lastOf(b, "floorAssigned")!.assignment.hostId).toBe("A");
    send(a, "a:worldSync", { dead: ["e0"], ents: [], custom: {} }, SERVER_HOST_ID);
    for (const p of [a, b]) expect(lastOf(p, "hostChanged")).toEqual({ t: "hostChanged", hostId: SERVER_HOST_ID, epoch: 2 });
    expect(relay.serverHosts(instId(a))).toBe(true);
    // A late joiner is synced by the server — with what A handed over.
    join(c);
    expect(lastOf(c, "floorAssigned")!.assignment.hostId).toBe(SERVER_HOST_ID);
    const sync = envs(c, "a:worldSync").at(-1)!;
    expect(sync.from).toBe(SERVER_HOST_ID);
    expect((sync.data as { dead: string[] }).dead).toEqual(["e0"]);
    expect((sync.data as { ents: unknown[] }).ents.length).toBeGreaterThan(0);
  });

  test('"always": the server hosts a floor from its first wizard', () => {
    setup("always");
    join(a);
    expect(lastOf(a, "floorAssigned")!.assignment.hostId).toBe(SERVER_HOST_ID);
    expect(a.inbox.some((m) => m.t === "syncRequest")).toBe(false);
  });

  test('"never": wizards host every floor', () => {
    setup("never");
    join(a);
    join(b);
    expect(lastOf(b, "floorAssigned")!.assignment.hostId).toBe("A");
    expect(a.inbox.some((m) => m.t === "syncRequest" && m.playerId === SERVER_HOST_ID)).toBe(false);
  });

  test("a wizard host that never syncs is taken over anyway", () => {
    setup("shared");
    join(a);
    join(b);
    relay.tick(0.1);
    expect(relay.serverHosts(instId(a))).toBe(false);
    now += HANDOVER_TIMEOUT_MS;
    relay.tick(0.1);
    expect(relay.serverHosts(instId(a))).toBe(true);
    expect(lastOf(b, "hostChanged")?.hostId).toBe(SERVER_HOST_ID);
  });

  test("a wizard host that leaves mid-handover leaves the floor to the server, not to the next wizard", () => {
    setup("shared");
    join(a);
    join(b);
    const inst = instId(a);
    relay.handle(a.id, { t: "leaveDungeon" });
    expect(relay.serverHosts(inst)).toBe(true);
    expect(lastOf(b, "hostChanged")?.hostId).toBe(SERVER_HOST_ID);
  });
});

describe("what wizards say they do, on a server-hosted floor", () => {
  beforeEach(() => {
    setup("shared");
    handOver();
  });

  test("a cast must be a spell of the staff the ledger believes, cast from where the wizard stands", () => {
    const { spot, aim } = standoff(1, 3);
    pose(b, spot);
    send(b, "p:cast", castOf("lance", spot, aim)); // not the apprentice staff's
    send(b, "p:cast", castOf("bolt", [spot[0] + 30, spot[1], spot[2]], aim)); // from across the room
    expect(host().refused.casts).toBe(2);
    expect(host().sim.spellsLive.projectiles).toBe(0);
    // A loadout claiming a staff B doesn't carry changes nothing…
    relay.handle(b.id, { t: "loadout", equipment: { staff: "void_staff", amulet: null, cloak: null, boots: null } });
    relay.tick(1.1); // the host re-asks the ledger at most once a second
    send(b, "p:cast", castOf("lance", spot, aim));
    expect(host().refused.casts).toBe(3);
    // …one it carries does.
    account(b).runGrants.push("void_staff");
    relay.tick(1.1);
    send(b, "p:cast", castOf("lance", spot, aim));
    expect(host().refused.casts).toBe(3);
    expect(host().sim.spellsLive.projectiles).toBe(1);
  });

  test("casting faster than the staff allows is refused; claimed stats are ignored", () => {
    const { spot, aim } = standoff(1, 3);
    pose(b, spot);
    const hp = host().sim.enemy("e1")!.hp;
    // Ten bolts at once, each claiming the strongest gear there is.
    for (let i = 0; i < 10; i++) send(b, "p:cast", castOf("bolt", spot, aim, i, { damageMult: 16, extraProjectiles: 4, homing: 2 }));
    expect(host().refused.casts).toBe(8); // two in hand, no more
    expect(host().sim.spellsLive.projectiles).toBe(2); // one bolt each: no claimed multishot
    for (let t = 0; t < 10; t++) relay.tick(0.05);
    // Two apprentice bolts' worth, at most — not two of a 16× staff.
    expect(hp - (host().sim.enemy("e1")?.hp ?? 0)).toBeLessThanOrEqual(2 * 16 + 1e-6);
  });

  test("an impossible move is refused, and the wizard is put back", () => {
    const start: Vec3 = [layout.spawn[0], 1.1, layout.spawn[2]];
    pose(b, start);
    relay.tick(0.05);
    // Walking is fine.
    pose(b, [start[0] + 0.4, 1.1, start[2]]);
    relay.tick(0.05);
    expect(host().refused.moves).toBe(0);
    // A leap across the floor (to the treasure, say) is not.
    const t = layout.treasure;
    pose(b, [t[0], 1.1, t[2]]);
    expect(host().refused.moves).toBe(1);
    expect(envs(b, "a:correct").map((m) => m.data)).toEqual([{ p: [start[0] + 0.4, 1.1, start[2]] }]);
    send(b, "h:takeTreasure", {});
    expect(envs(a, "a:treasureTaken")).toEqual([]); // it never got there
    // Nor is standing outside the floor.
    pose(b, [start[0], -20, start[2]]);
    expect(host().refused.moves).toBe(2);
  });
});

describe("a server-hosted floor", () => {
  beforeEach(() => {
    setup("shared");
    handOver();
  });

  test("the old host is a replica now: its authority and its loot reports are refused", () => {
    const seen = b.inbox.length;
    send(a, "a:enemyCast", { origin: [0, 1, 0], velocity: [1, 0, 0] });
    relay.handle(a.id, { t: "loot", id: "e1", source: { kind: "enemy", enemy: "wisp", gen: 0 }, at: [0, 0, 0] });
    expect(b.inbox.slice(seen).filter((m) => m.t === "msg")).toEqual([]);
    expect(lastOf(a, "lootRolled")).toBeUndefined();
  });

  test("enemies hunt the wizards it hears, and everyone gets the snapshots", () => {
    const wisp = layout.enemies.findIndex((e) => e.kind === "wisp");
    const at = layout.enemies[wisp].pos;
    pose(b, [at[0] + 2, at[1], at[2]]);
    for (let i = 0; i < 60; i++) relay.tick(1 / 30);
    for (const p of [a, b]) {
      const snaps = envs(p, "a:snap");
      expect(snaps.length).toBeGreaterThan(10);
      expect(snaps.every((s) => s.from === SERVER_HOST_ID)).toBe(true);
    }
    const last = envs(b, "a:snap").flatMap((s) => (s.data as { ents: { id: string; p: Vec3 }[] }).ents);
    const moved = last.filter((e) => e.id === `e${wisp}`).at(-1)!;
    expect(Math.hypot(moved.p[0] - (at[0] + 2), moved.p[2] - at[2])).toBeLessThan(2);
  });

  test("a wizard who stops sending poses stops being hunted", () => {
    const wisp = layout.enemies.findIndex((e) => e.kind === "wisp");
    const at = layout.enemies[wisp].pos;
    pose(b, [at[0] + 2, at[1], at[2]]);
    relay.tick(0.5);
    const served = () => (relay as unknown as { hosted: Map<string, { host: { sim: { counts(): { wizards: number } } } }> })
      .hosted.get(instId(a))!.host.sim.counts().wizards;
    expect(served()).toBe(1);
    for (let i = 0; i < 10; i++) relay.tick(0.25);
    expect(served()).toBe(0);
  });

  test("a claimed hit counts for nothing; the server's own copy of a cast kills", () => {
    const { spot, aim } = standoff(1, 3);
    pose(b, spot);
    send(b, "h:entityCmd", { id: "e1", cmd: "hit", data: { damage: 1e6, impulse: { x: 0, y: 0, z: 0 } } });
    relay.tick(0.1);
    expect(envs(a, "a:despawn")).toEqual([]);
    // Bolts, cast the honest way — at the staff's pace, until it falls.
    for (let i = 0; i < 30 && envs(a, "a:despawn").length === 0; i++) {
      send(b, "p:cast", castOf("bolt", spot, aim, i));
      for (let t = 0; t < 6; t++) relay.tick(0.05);
    }
    for (const p of [a, b]) expect(envs(p, "a:despawn").map((m) => m.data)).toEqual([{ id: "e1" }]);
    expect(host().refused.casts).toBe(0);
  });

  test("orbs: the server spawns them, the wizard at one takes it, the ledger grants it once", () => {
    const here: Vec3 = [layout.spawn[0], 1.1, layout.spawn[2]];
    pose(a, [here[0] + 40, 1.1, here[2]]); // far away
    pose(b, here);
    send(b, "h:devOrb", { defId: "worn_boots", gold: 0, pos: here });
    const spawned = envs(a, "a:orbSpawned").at(-1)!.data as { orbId: string; defId: string };
    expect(spawned.defId).toBe("worn_boots");
    send(a, "h:takeOrb", { orbId: spawned.orbId }); // across the map: refused
    expect(envs(a, "a:orbTaken")).toEqual([]);
    send(b, "h:takeOrb", { orbId: spawned.orbId });
    send(b, "h:takeOrb", { orbId: spawned.orbId }); // twice: once
    expect(envs(a, "a:orbTaken").map((m) => m.data)).toEqual([{ orbId: spawned.orbId, by: "B" }]);
    expect(account(b).runGrants).toEqual(["worn_boots"]);
    expect(account(a).runGrants).toEqual([]);
  });

  test("a dropped copy lands only as what the book holds for it", () => {
    const here: Vec3 = [layout.spawn[0], 1.1, layout.spawn[2]];
    pose(b, here);
    // B brought an amulet from home; dropping it releases a "d" orb.
    account(b).inventory.bag[0] = { id: "amulet_vigor@3", qty: 1 };
    relay.handle(b.id, { t: "drop", itemId: "amulet_vigor@3", runLoot: false });
    const orb = lastOf(b, "released")!.orb;
    send(b, "h:dropOrb", { orbId: orb.orbId, defId: "amulet_vigor@9", pos: here }); // not what was dropped
    expect(envs(a, "a:orbSpawned")).toEqual([]);
    send(b, "h:dropOrb", { orbId: orb.orbId, defId: "amulet_vigor@3", pos: here });
    expect(envs(a, "a:orbSpawned").map((m) => (m.data as { orbId: string }).orbId)).toEqual([orb.orbId]);
  });

  test("the treasure goes once, to a wizard standing at it", () => {
    const t = layout.treasure;
    pose(a, [t[0] + 30, 1.1, t[2]]);
    pose(b, [t[0] + 1, 1.1, t[2]]);
    send(a, "h:takeTreasure", {});
    send(b, "h:takeTreasure", {});
    send(b, "h:takeTreasure", {});
    expect(envs(a, "a:treasureTaken").map((m) => m.data)).toEqual([{ by: "B" }]);
    expect(account(b).runGrants).toHaveLength(1);
  });

  test("graves: raised where the dead fell, plundered by whoever stands at them, granted against the pool", () => {
    const here: Vec3 = [layout.spawn[0], 1.1, layout.spawn[2]];
    pose(a, here);
    pose(b, here);
    // B finds something, then dies with A watching: it goes into the pool.
    send(b, "h:devOrb", { defId: "worn_boots", gold: 0, pos: here });
    const orb = envs(b, "a:orbSpawned").at(-1)!.data as { orbId: string };
    send(b, "h:takeOrb", { orbId: orb.orbId });
    relay.handle(b.id, { t: "died" });
    // The death plays out before the grave rises — no poses meanwhile.
    for (let i = 0; i < 12; i++) relay.tick(0.25);
    send(b, "h:graveDrop", { items: [{ id: "worn_boots", qty: 1 }], gold: 0, pos: here, killerId: "A" });
    const grave = envs(a, "a:graveSpawned").at(-1)!.data as { id: string; ownerName: string; killerName: string };
    expect(grave.ownerName).toBe("Wizard B");
    expect(grave.killerName).toBe("Wizard A");
    send(a, "h:lootGrave", { graveId: grave.id, picks: [{ i: 0, qty: 1 }], gold: false });
    expect(envs(b, "a:graveLooted").map((m) => (m.data as { by: string }).by)).toEqual(["A"]);
    expect(account(a).runGrants).toEqual(["worn_boots"]);
  });
});
