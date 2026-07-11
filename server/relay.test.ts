import { beforeEach, describe, expect, test } from "bun:test";
import { FloorDirectory } from "../src/net/matchmaking";
import type { ServerMsg } from "../src/net/protocol";
import { AccountStore, defaultWireInventory } from "./accounts";
import { Relay, type RelayPeer } from "./relay";

/** The relay IS the multiplayer authority model — these tests are its spec. */

interface TestPeer extends RelayPeer {
  inbox: ServerMsg[];
}

function makePeer(id: string): TestPeer {
  const peer: TestPeer = {
    id,
    name: "Wizard",
    inbox: [],
    send(msg) {
      peer.inbox.push(msg);
    },
  };
  return peer;
}

function lastOf<T extends ServerMsg["t"]>(peer: TestPeer, t: T) {
  const found = [...peer.inbox].reverse().find((m) => m.t === t);
  return found as Extract<ServerMsg, { t: T }> | undefined;
}

let relay: Relay;
let store: AccountStore;
let a: TestPeer;
let b: TestPeer;
let c: TestPeer;
let now = 50_000;

beforeEach(() => {
  now = 50_000;
  store = new AccountStore();
  relay = new Relay(new FloorDirectory(4, () => 1234, () => now), store, () => now);
  a = makePeer("A");
  b = makePeer("B");
  c = makePeer("C");
  for (const p of [a, b, c]) {
    relay.connect(p);
    unlock(p); // most tests exercise routing, not progression — open all floors
  }
});

/** Log the peer in and raise its checkpoint so floor validation lets it
 * through (progression rules get their own dedicated tests). */
function unlock(peer: TestPeer, checkpoint = 100): string {
  relay.handle(peer.id, { t: "login", name: peer.name });
  const token = lastOf(peer, "loggedIn")!.token;
  store.get(token)!.checkpoint = checkpoint;
  return token;
}

function join(peer: TestPeer, floor: number) {
  now += 10; // instances get distinct createdAt stamps
  relay.handle(peer.id, { t: "enterFloor", floor });
}

describe("matchmaking + membership", () => {
  test("welcome carries the player id", () => {
    expect(lastOf(a, "welcome")!.playerId).toBe("A");
  });

  test("first joiner is host; second joins the same instance and everyone learns", () => {
    join(a, 3);
    const aAssign = lastOf(a, "floorAssigned")!.assignment;
    expect(aAssign.hostId).toBe("A");
    expect(aAssign.epoch).toBe(1);
    expect(aAssign.members).toEqual([{ id: "A", name: "Wizard" }]);

    join(b, 3);
    const bAssign = lastOf(b, "floorAssigned")!.assignment;
    expect(bAssign.instanceId).toBe(aAssign.instanceId);
    expect(bAssign.seed).toBe(aAssign.seed);
    expect(bAssign.hostId).toBe("A");
    expect(bAssign.members.map((m) => m.id).sort()).toEqual(["A", "B"]);
    expect(lastOf(a, "peerJoined")!.member.id).toBe("B");
  });

  test("host is asked to world-sync each late joiner", () => {
    join(a, 3);
    join(b, 3);
    expect(lastOf(a, "syncRequest")!.playerId).toBe("B");
    // The first joiner triggered no sync request (nobody to sync from).
    expect(b.inbox.some((m) => m.t === "syncRequest")).toBe(false);
  });

  test("pong echoes sent and stamps server time", () => {
    relay.handle(a.id, { t: "ping", sent: 777 });
    const pong = lastOf(a, "pong")!;
    expect(pong.sent).toBe(777);
    expect(pong.serverTime).toBe(now);
  });
});

describe("channel authority rules", () => {
  beforeEach(() => {
    join(a, 3); // host
    join(b, 3);
    join(c, 3);
  });

  test('"a:" from the host reaches everyone else, stamped', () => {
    relay.handle(a.id, { t: "msg", ch: "a:snap", data: { hello: 1 } });
    const got = lastOf(b, "msg")!;
    expect(got.ch).toBe("a:snap");
    expect(got.from).toBe("A");
    expect(got.epoch).toBe(1);
    expect(got.serverTime).toBe(now);
    expect(lastOf(c, "msg")!.data).toEqual({ hello: 1 });
    expect(a.inbox.some((m) => m.t === "msg")).toBe(false); // never echoed
  });

  test('"a:" from a non-host is dropped', () => {
    relay.handle(b.id, { t: "msg", ch: "a:snap", data: {} });
    expect(a.inbox.some((m) => m.t === "msg")).toBe(false);
    expect(c.inbox.some((m) => m.t === "msg")).toBe(false);
  });

  test('"a:" with `to` reaches only that member', () => {
    relay.handle(a.id, { t: "msg", ch: "a:worldSync", data: { x: 1 }, to: "B" });
    expect(lastOf(b, "msg")!.data).toEqual({ x: 1 });
    expect(c.inbox.some((m) => m.t === "msg")).toBe(false);
  });

  test('"h:" from a replica reaches only the host', () => {
    relay.handle(c.id, { t: "msg", ch: "h:cmd", data: { dmg: 5 } });
    expect(lastOf(a, "msg")!.from).toBe("C");
    expect(b.inbox.some((m) => m.t === "msg")).toBe(false);
  });

  test('"p:" broadcasts to the rest of the instance', () => {
    relay.handle(b.id, { t: "msg", ch: "p:pose", data: 1 });
    expect(lastOf(a, "msg")!.ch).toBe("p:pose");
    expect(lastOf(c, "msg")!.ch).toBe("p:pose");
    expect(b.inbox.some((m) => m.t === "msg")).toBe(false);
  });

  test("unknown prefixes are dropped", () => {
    relay.handle(a.id, { t: "msg", ch: "x:whatever", data: 1 });
    expect(b.inbox.some((m) => m.t === "msg")).toBe(false);
  });

  test("messages never cross instances", () => {
    const d = makePeer("D");
    relay.connect(d);
    unlock(d);
    join(d, 9); // different floor
    relay.handle(b.id, { t: "msg", ch: "p:pose", data: 1 });
    expect(d.inbox.some((m) => m.t === "msg")).toBe(false);
  });
});

describe("host migration", () => {
  test("promotes the next-oldest member and bumps the epoch", () => {
    join(a, 3);
    join(b, 3);
    join(c, 3);
    relay.disconnect(a.id);
    const changed = lastOf(b, "hostChanged")!;
    expect(changed.hostId).toBe("B");
    expect(changed.epoch).toBe(2);
    expect(lastOf(c, "hostChanged")!.hostId).toBe("B");
    expect(lastOf(b, "peerLeft")!.playerId).toBe("A");
    // New host's authority traffic now flows.
    relay.handle(b.id, { t: "msg", ch: "a:snap", data: {} });
    expect(lastOf(c, "msg")!.epoch).toBe(2);
    // The old host (were it still sending) would be rejected — C is not host.
    relay.handle(c.id, { t: "msg", ch: "a:snap", data: {} });
    expect(b.inbox.filter((m) => m.t === "msg")).toHaveLength(0);
  });

  test("a non-host leaving does not migrate", () => {
    join(a, 3);
    join(b, 3);
    relay.handle(b.id, { t: "leaveDungeon" });
    expect(a.inbox.some((m) => m.t === "hostChanged")).toBe(false);
    expect(lastOf(a, "peerLeft")!.playerId).toBe("B");
  });

  test("instance is garbage-collected and epochs reset with it", () => {
    join(a, 3);
    relay.handle(a.id, { t: "leaveDungeon" });
    join(b, 3); // fresh instance on the same floor
    expect(lastOf(b, "floorAssigned")!.assignment.epoch).toBe(1);
  });
});

describe("accounts: identity", () => {
  test("login mints a token; presenting it again resumes the same account", () => {
    const d = makePeer("D");
    relay.connect(d);
    relay.handle(d.id, { t: "login", name: "Dana" });
    const first = lastOf(d, "loggedIn")!;
    expect(first.save.checkpoint).toBe(1);
    store.get(first.token)!.checkpoint = 15;

    // New connection (e.g. after a restart) with the same token.
    const d2 = makePeer("D2");
    relay.connect(d2);
    relay.handle(d2.id, { t: "login", name: "Dana", token: first.token });
    const second = lastOf(d2, "loggedIn")!;
    expect(second.token).toBe(first.token);
    expect(second.save.checkpoint).toBe(15);
  });
});

describe("accounts: floor-entry validation", () => {
  test("a fresh account cannot skip ahead — forged deep floors land on 1", () => {
    const d = makePeer("D");
    relay.connect(d);
    relay.handle(d.id, { t: "login", name: "Dana" }); // checkpoint 1
    join(d, 40);
    expect(lastOf(d, "floorAssigned")!.assignment.floor).toBe(1);
  });

  test("descending one floor at a time is allowed; leaping is not", () => {
    const d = makePeer("D");
    relay.connect(d);
    relay.handle(d.id, { t: "login", name: "Dana" });
    join(d, 1);
    join(d, 2); // descend — fine
    expect(lastOf(d, "floorAssigned")!.assignment.floor).toBe(2);
    join(d, 9); // leap — denied
    expect(lastOf(d, "floorAssigned")!.assignment.floor).toBe(1);
  });

  test("a reconnecting account resumes its run floor", () => {
    const d = makePeer("D");
    relay.connect(d);
    relay.handle(d.id, { t: "login", name: "Dana" });
    const token = lastOf(d, "loggedIn")!.token;
    join(d, 1);
    join(d, 2);
    join(d, 3);
    relay.disconnect(d.id); // socket dropped mid-run

    const d2 = makePeer("D2");
    relay.connect(d2);
    relay.handle(d2.id, { t: "login", name: "Dana", token });
    join(d2, 3); // back to where we were
    expect(lastOf(d2, "floorAssigned")!.assignment.floor).toBe(3);
  });
});

describe("accounts: grants and banking", () => {
  test("only the instance host's attestation records a grant", () => {
    const tokenB = lastOf(b, "loggedIn")!.token;
    join(a, 5); // host
    join(b, 5);
    relay.handle(b.id, { t: "grant", playerId: b.id, itemId: "ember_staff" }); // self-vouch
    expect(store.get(tokenB)!.runGrants).toEqual([]);
    relay.handle(a.id, { t: "grant", playerId: b.id, itemId: "ember_staff" }); // host
    expect(store.get(tokenB)!.runGrants).toEqual(["ember_staff"]);
  });

  test("grants only apply to members of the host's instance", () => {
    const tokenC = lastOf(c, "loggedIn")!.token;
    join(a, 5);
    join(c, 9); // elsewhere
    relay.handle(a.id, { t: "grant", playerId: c.id, itemId: "ember_staff" });
    expect(store.get(tokenC)!.runGrants).toEqual([]);
  });

  test("banking keeps granted items, strips forged ones, sets the checkpoint", () => {
    const tokenB = lastOf(b, "loggedIn")!.token;
    store.get(tokenB)!.checkpoint = 1; // fresh player
    join(a, 5); // host (a has checkpoint 100)
    relay.handle(b.id, { t: "enterFloor", floor: 5 });
    // ...b can't enter 5 as a fresh account — walk down legitimately.
    for (let f = 1; f <= 5; f++) relay.handle(b.id, { t: "enterFloor", floor: f });
    relay.handle(a.id, { t: "grant", playerId: b.id, itemId: "ember_staff" });

    relay.handle(b.id, {
      t: "bank",
      inventory: {
        ...defaultWireInventory(),
        equipment: { staff: "ember_staff", amulet: "hacked_amulet", cloak: null, boots: "worn_boots" },
      },
    });
    const saved = lastOf(b, "saved")!.save;
    expect(saved.inventory.equipment.staff).toBe("ember_staff"); // granted → kept
    expect(saved.inventory.equipment.amulet).toBeNull(); // never granted → stripped
    expect(saved.checkpoint).toBe(5); // from the ACTUAL instance floor
    expect(store.get(tokenB)!.runGrants).toEqual([]); // consumed
  });

  test("banking is refused off checkpoint floors", () => {
    join(a, 3); // not a multiple of the checkpoint interval
    relay.handle(a.id, { t: "bank", inventory: defaultWireInventory() });
    expect(a.inbox.some((m) => m.t === "saved")).toBe(false);
  });

  test("gold grants are host-only, and stash/buy are refused mid-run", () => {
    const tokenB = lastOf(b, "loggedIn")!.token;
    join(a, 5); // a is host
    join(b, 5);
    relay.handle(b.id, { t: "grantGold", playerId: b.id, amount: 50 }); // self-vouch
    expect(store.get(tokenB)!.runGold).toBe(0);
    relay.handle(a.id, { t: "grantGold", playerId: b.id, amount: 50 }); // host
    expect(store.get(tokenB)!.runGold).toBe(50);
    // Mid-run, village-only messages are dropped.
    b.inbox.length = 0;
    relay.handle(b.id, { t: "stash", inventory: defaultWireInventory() });
    relay.handle(b.id, { t: "buy", itemId: "potion_hp_weak", inventory: defaultWireInventory() });
    expect(b.inbox.some((m) => m.t === "saved")).toBe(false);
  });

  test("stash rearranges in the village and answers with the save", () => {
    relay.handle(a.id, { t: "stash", inventory: defaultWireInventory() });
    const saved = lastOf(a, "saved");
    expect(saved).not.toBeNull();
    expect(saved!.save.inventory.equipment.staff).toBe("apprentice_staff");
  });

  test("dying forfeits the run's grants", () => {
    const tokenB = lastOf(b, "loggedIn")!.token;
    join(a, 5);
    join(b, 5);
    relay.handle(a.id, { t: "grant", playerId: b.id, itemId: "ember_staff" });
    relay.handle(b.id, { t: "died" });
    expect(store.get(tokenB)!.runGrants).toEqual([]);
    expect(store.get(tokenB)!.runFloor).toBe(0);
  });
});
