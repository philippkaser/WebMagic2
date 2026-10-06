import { beforeEach, describe, expect, test } from "bun:test";
import { FloorDirectory } from "../src/net/matchmaking";
import { maxGoldDrop } from "../src/items/economy";
import { entryFloorFor } from "../src/run/rules";
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
  // Dice always 0: every encounter roll succeeds, so wizards sent to the same
  // floor share an instance (routing tests need company; the tension clock
  // has its own tests in matchmaking.test.ts). The pace is lifted here — runs
  // descend 10 ms a floor — and has its own tests below.
  relay = new Relay(new FloorDirectory(4, () => 1234, () => now, () => 0), store, () => now, undefined, {
    pace: null,
  });
  a = makePeer("A");
  b = makePeer("B");
  c = makePeer("C");
  for (const p of [a, b, c]) {
    relay.connect(p);
    login(p);
  }
});

function login(peer: TestPeer): string {
  relay.handle(peer.id, { t: "login", name: peer.name });
  return lastOf(peer, "loggedIn")!.token;
}

function accountOf(peer: TestPeer) {
  return store.get(lastOf(peer, "loggedIn")!.token)!;
}

/** Seat a peer on `floor` as if mid-run there (most tests exercise routing,
 * not progression — run rules get their own dedicated tests below). */
function join(peer: TestPeer, floor: number) {
  now += 10; // instances get distinct createdAt stamps
  const acc = accountOf(peer);
  acc.runFloor = floor;
  acc.runFloors = Math.max(acc.runFloors, 1);
  relay.handle(peer.id, { t: "enterFloor", floor });
}

/** Send a raw floor request, exactly as a client would. */
function enter(peer: TestPeer, floor: number, fresh = false) {
  now += 10;
  relay.handle(peer.id, { t: "enterFloor", floor, fresh });
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
    login(d);
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
    expect(first.save.deepest).toBe(0);
    store.get(first.token)!.deepest = 15;

    // New connection (e.g. after a restart) with the same token.
    const d2 = makePeer("D2");
    relay.connect(d2);
    relay.handle(d2.id, { t: "login", name: "Dana", token: first.token });
    const second = lastOf(d2, "loggedIn")!;
    expect(second.token).toBe(first.token);
    expect(second.save.deepest).toBe(15);
  });
});

describe("run rules: the Weighing, continuing runs, reconnects", () => {
  test("a fresh run lands where the banked gear resonates — the requested floor is ignored", () => {
    enter(a, 40, true); // starter gear → floor 1, whatever was asked
    expect(lastOf(a, "floorAssigned")!.assignment.floor).toBe(1);
    expect(accountOf(a).runFloors).toBe(1);

    const acc = accountOf(b);
    acc.inventory.equipment = {
      staff: "ember_staff@20",
      amulet: "amulet_vigor@20",
      cloak: "cloak_warden@20",
      boots: "worn_boots@20",
    };
    enter(b, 1, true);
    expect(lastOf(b, "floorAssigned")!.assignment.floor).toBe(entryFloorFor(20));
  });

  test("a continuing run goes one floor deeper at a time, counting floors", () => {
    enter(a, 1, true);
    enter(a, 2);
    enter(a, 3);
    expect(lastOf(a, "floorAssigned")!.assignment.floor).toBe(3);
    expect(accountOf(a).runFloors).toBe(3);
  });

  test("a leap is not a descent: it forfeits the run and starts over at the Weighing", () => {
    enter(a, 1, true);
    enter(a, 2);
    relay.handle(a.id, { t: "grant", playerId: a.id, itemId: "ember_staff" }); // a is host
    expect(accountOf(a).runGrants).toEqual(["ember_staff"]);
    enter(a, 9);
    expect(lastOf(a, "floorAssigned")!.assignment.floor).toBe(1);
    expect(accountOf(a).runFloors).toBe(1);
    expect(accountOf(a).runGrants).toEqual([]); // walking away costs what dying costs
  });

  test("a reconnecting account resumes its run floor, in the same instance", () => {
    const token = accountOf(a).token;
    join(c, 3); // someone already down there
    enter(a, 1, true);
    enter(a, 2);
    enter(a, 3); // meets c (dice always succeed)
    const before = lastOf(a, "floorAssigned")!.assignment.instanceId;
    relay.disconnect(a.id); // socket dropped mid-run

    const a2 = makePeer("A2");
    relay.connect(a2);
    relay.handle(a2.id, { t: "login", name: "A", token });
    enter(a2, 3); // back to where we were
    const after = lastOf(a2, "floorAssigned")!.assignment;
    expect(after.floor).toBe(3);
    expect(after.instanceId).toBe(before);
    expect(store.get(token)!.runFloors).toBe(3);
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

  test("walking home keeps granted items, strips forged ones, records the depth", () => {
    const tokenB = lastOf(b, "loggedIn")!.token;
    join(a, 5); // host, waiting on floor 5
    enter(b, 1, true); // b plays floors 1→5 legitimately
    for (let f = 2; f <= 5; f++) enter(b, f);
    expect(lastOf(b, "floorAssigned")!.assignment.instanceId).toBe(
      lastOf(a, "floorAssigned")!.assignment.instanceId,
    );
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
    expect(saved.deepest).toBe(5); // from the ACTUAL instance floor
    expect(store.get(tokenB)!.runGrants).toEqual([]); // consumed
    expect(store.get(tokenB)!.runFloors).toBe(0); // the run is over
  });

  test("the way home stays shut until five floors are played (answers with the unchanged save)", () => {
    enter(a, 1, true);
    for (let f = 2; f <= 4; f++) enter(a, f);
    relay.handle(a.id, { t: "grant", playerId: a.id, itemId: "ember_staff" });
    relay.handle(a.id, {
      t: "bank",
      inventory: { ...defaultWireInventory(), equipment: { ...defaultWireInventory().equipment, staff: "ember_staff" } },
    });
    const saved = lastOf(a, "saved")!.save;
    expect(saved.inventory.equipment.staff).toBe("apprentice_staff"); // nothing banked
    expect(accountOf(a).runGrants).toEqual(["ember_staff"]); // run continues
    enter(a, 5); // the fifth floor pays the tithe
    relay.handle(a.id, {
      t: "bank",
      inventory: { ...defaultWireInventory(), equipment: { ...defaultWireInventory().equipment, staff: "ember_staff" } },
    });
    expect(lastOf(a, "saved")!.save.inventory.equipment.staff).toBe("ember_staff");
  });

  test("gold grants are host-only, and stash/buy are refused mid-run", () => {
    const tokenB = lastOf(b, "loggedIn")!.token;
    join(a, 5); // a is host
    join(b, 5);
    relay.handle(b.id, { t: "grantGold", playerId: b.id, amount: 12 }); // self-vouch
    expect(store.get(tokenB)!.runGold).toBe(0);
    relay.handle(a.id, { t: "grantGold", playerId: b.id, amount: 12 }); // host
    expect(store.get(tokenB)!.runGold).toBe(12);
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

describe("graves: plunder is bounded by what the dead were granted", () => {
  test("a grave grant is refused unless someone who died here was granted it", () => {
    const tokenC = lastOf(c, "loggedIn")!.token;
    join(a, 4); // host
    join(b, 4);
    join(c, 4);
    // Nobody has died: a "grave" grant of anything is a forgery.
    relay.handle(a.id, { t: "grant", playerId: c.id, itemId: "void_staff@90", source: "grave" });
    expect(store.get(tokenC)!.runGrants).toEqual([]);

    // b legitimately picks up an amulet, then dies with others watching.
    relay.handle(a.id, { t: "grant", playerId: b.id, itemId: "amulet_vigor@4" });
    relay.handle(a.id, { t: "grantGold", playerId: b.id, amount: 10 });
    relay.handle(a.id, { t: "grantGold", playerId: b.id, amount: 10 });
    relay.handle(a.id, { t: "grantGold", playerId: b.id, amount: 10 });
    relay.handle(b.id, { t: "died" });

    // c plunders the grave: the amulet once, the gold up to what b carried.
    relay.handle(a.id, { t: "grant", playerId: c.id, itemId: "amulet_vigor@4", source: "grave" });
    relay.handle(a.id, { t: "grant", playerId: c.id, itemId: "amulet_vigor@4", source: "grave" });
    relay.handle(a.id, { t: "grant", playerId: c.id, itemId: "void_staff@90", source: "grave" });
    relay.handle(a.id, { t: "grantGold", playerId: c.id, amount: 500, source: "grave" });
    expect(store.get(tokenC)!.runGrants).toEqual(["amulet_vigor@4"]);
    expect(store.get(tokenC)!.runGold).toBe(30);
  });

  test("dying alone leaves nothing plunderable", () => {
    const tokenB = lastOf(b, "loggedIn")!.token;
    join(a, 6);
    relay.handle(a.id, { t: "grant", playerId: a.id, itemId: "amulet_vigor" });
    relay.handle(a.id, { t: "died" }); // alone on the floor
    join(a, 6);
    join(b, 6);
    relay.handle(a.id, { t: "grant", playerId: b.id, itemId: "amulet_vigor", source: "grave" });
    expect(store.get(tokenB)!.runGrants).toEqual([]);
  });

  test("assignments carry the server's floor count", () => {
    enter(a, 1, true);
    expect(lastOf(a, "floorAssigned")!.assignment.runFloors).toBe(1);
    enter(a, 2);
    expect(lastOf(a, "floorAssigned")!.assignment.runFloors).toBe(2);
  });
});

describe("a lone wizard is its own host — the floor still bounds what it finds", () => {
  test("a self-attested find must be this floor's loot, its gold a floor's purse", () => {
    enter(a, 1, true); // alone: A is the host of its own floor 1
    relay.handle(a.id, { t: "grant", playerId: a.id, itemId: "void_staff+keen@120" });
    relay.handle(a.id, { t: "grant", playerId: a.id, itemId: "totally_made_up_item" });
    relay.handle(a.id, { t: "grant", playerId: a.id, itemId: "ember_staff@2" });
    expect(accountOf(a).runGrants).toEqual(["ember_staff@2"]);
    relay.handle(a.id, { t: "grantGold", playerId: a.id, amount: 500 });
    expect(accountOf(a).runGold).toBe(maxGoldDrop(1));
  });
});

describe("drops: what one wizard lets fall, another may take — nothing more", () => {
  beforeEach(() => {
    join(a, 5); // host
    join(b, 5);
    join(c, 5);
  });

  test("a gift moves from the dropper to the taker, whatever its depth", () => {
    // B brought a deep amulet from home — deeper than floor 5's own loot.
    accountOf(b).inventory.bag[0] = { id: "amulet_vigor@30", qty: 1 };
    relay.handle(b.id, { t: "drop", itemId: "amulet_vigor@30", runLoot: false });
    expect(accountOf(b).inventory.bag[0]).toBeNull(); // given up
    relay.handle(a.id, { t: "grant", playerId: c.id, itemId: "amulet_vigor@30", source: "drop" });
    relay.handle(a.id, { t: "grant", playerId: c.id, itemId: "amulet_vigor@30", source: "drop" });
    expect(accountOf(c).runGrants).toEqual(["amulet_vigor@30"]); // once
  });

  test("a run find dropped comes out of the dropper's grants", () => {
    relay.handle(a.id, { t: "grant", playerId: b.id, itemId: "ember_staff@5" });
    relay.handle(b.id, { t: "drop", itemId: "ember_staff@5", runLoot: true });
    expect(accountOf(b).runGrants).toEqual([]);
    relay.handle(a.id, { t: "grant", playerId: c.id, itemId: "ember_staff@5", source: "drop" });
    expect(accountOf(c).runGrants).toEqual(["ember_staff@5"]);
  });

  test("a drop of something never owned mints nothing — as a drop or as a find", () => {
    relay.handle(b.id, { t: "drop", itemId: "amulet_vigor@30", runLoot: false });
    relay.handle(a.id, { t: "grant", playerId: b.id, itemId: "amulet_vigor@30", source: "drop" });
    relay.handle(a.id, { t: "grant", playerId: b.id, itemId: "amulet_vigor@30" });
    expect(accountOf(b).runGrants).toEqual([]);
  });
});

describe("the deep's pace", () => {
  let tasks: { at: number; fn: () => void }[];
  let paced: Relay;
  let p: TestPeer;

  /** Let `ms` pass, running whatever the relay scheduled for that time. */
  function advance(ms: number) {
    now += ms;
    const due = tasks.filter((t) => t.at <= now);
    tasks = tasks.filter((t) => t.at > now);
    for (const t of due) t.fn();
  }
  function enterPaced(floor: number, fresh = false) {
    paced.handle(p.id, { t: "enterFloor", floor, fresh });
  }
  const assignments = () => p.inbox.filter((m) => m.t === "floorAssigned").length;
  const pacedAccount = () => store.get((lastOf(p, "loggedIn") as { token: string }).token)!;

  beforeEach(() => {
    tasks = [];
    paced = new Relay(new FloorDirectory(4, () => 1, () => now, () => 0), store, () => now, undefined, {
      pace: { msPerFloor: 1000, burst: 2 },
      schedule: (fn, ms) => tasks.push({ at: now + ms, fn }),
    });
    p = makePeer("P");
    paced.connect(p);
    paced.handle(p.id, { t: "login", name: "P" });
  });

  test("five floors and a bank can't happen in a moment", () => {
    enterPaced(1, true);
    for (let f = 2; f <= 5; f++) enterPaced(f);
    expect(assignments()).toBe(2); // the burst; the rest is held
    expect(pacedAccount().runFloors).toBe(2);
    paced.handle(p.id, { t: "bank", inventory: defaultWireInventory() });
    expect(pacedAccount().runFloors).toBe(2); // the way home stays shut
  });

  test("a floor asked for too soon is answered once it's due", () => {
    enterPaced(1, true);
    enterPaced(2);
    enterPaced(3);
    expect(assignments()).toBe(2);
    advance(999);
    expect(assignments()).toBe(2);
    advance(1);
    expect(assignments()).toBe(3);
    expect(lastOf(p, "floorAssigned")!.assignment.runFloors).toBe(3);
  });

  test("anything newer drops a held request; so does a disconnect", () => {
    enterPaced(1, true);
    enterPaced(2);
    enterPaced(3); // held
    paced.handle(p.id, { t: "leaveDungeon" });
    advance(5000);
    expect(assignments()).toBe(2);

    enterPaced(3); // the 5 s rest refilled the burst: straight through
    expect(assignments()).toBe(3);
    enterPaced(4);
    enterPaced(5); // held
    paced.disconnect(p.id);
    advance(5000);
    expect(assignments()).toBe(4);
  });

  test("re-entering the floor you're on is never held", () => {
    enterPaced(1, true);
    enterPaced(2);
    enterPaced(2); // a reconnect, with no token left
    expect(assignments()).toBe(3);
  });
});
