import { beforeEach, describe, expect, test } from "bun:test";
import { FloorDirectory } from "../src/net/matchmaking";
import type { ServerMsg } from "../src/net/protocol";
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
let a: TestPeer;
let b: TestPeer;
let c: TestPeer;
let now = 50_000;

beforeEach(() => {
  now = 50_000;
  relay = new Relay(new FloorDirectory(4, () => 1234, () => now), () => now);
  a = makePeer("A");
  b = makePeer("B");
  c = makePeer("C");
  for (const p of [a, b, c]) relay.connect(p);
});

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
