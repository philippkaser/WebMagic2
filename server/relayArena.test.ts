import { beforeEach, describe, expect, test } from "bun:test";
import { ARENA } from "../src/arena/rules";
import { FloorDirectory } from "../src/net/matchmaking";
import type { ServerMsg } from "../src/net/protocol";
import { AccountStore } from "./accounts";
import { Relay, type RelayPeer } from "./relay";

/** The Proving Ground: the obelisk's queue, bouts, the score and Varr's
 * ledger. */

interface TestPeer extends RelayPeer {
  inbox: ServerMsg[];
}

function makePeer(id: string): TestPeer {
  const peer: TestPeer = { id, name: id, inbox: [], send: (m) => void peer.inbox.push(m) };
  return peer;
}

function lastOf<T extends ServerMsg["t"]>(peer: TestPeer, t: T) {
  return [...peer.inbox].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined;
}

let relay: Relay;
let now = 50_000;
let a: TestPeer, b: TestPeer, c: TestPeer;

beforeEach(() => {
  now = 50_000;
  relay = new Relay(new FloorDirectory(4, () => 99, () => now, () => 0.99), new AccountStore(), () => now);
  [a, b, c] = ["Ann", "Bo", "Cy"].map(makePeer);
  for (const p of [a, b, c]) {
    relay.connect(p);
    relay.handle(p.id, { t: "login", name: p.name });
    relay.handle(p.id, { t: "enterCamp" });
  }
});

/** Ann and Bo queue up and the gathering breath passes. */
function startDuel(): string {
  relay.handle(a.id, { t: "arenaJoin" });
  relay.handle(b.id, { t: "arenaJoin" });
  now += ARENA.gatherMs;
  relay.tick();
  return lastOf(a, "arenaAssigned")!.assignment.instanceId;
}

describe("the obelisk", () => {
  test("challengers learn their place; two make a bout once the breath has passed", () => {
    relay.handle(a.id, { t: "arenaJoin" });
    expect(lastOf(a, "arenaQueue")).toMatchObject({ position: 1, waiting: 1 });
    relay.handle(b.id, { t: "arenaJoin" });
    expect(lastOf(b, "arenaQueue")).toMatchObject({ position: 2, waiting: 2 });
    relay.tick();
    expect(lastOf(a, "arenaAssigned")).toBeUndefined();
    now += ARENA.gatherMs;
    relay.tick();
    const bout = lastOf(a, "arenaAssigned")!.assignment;
    expect(bout.instanceId.startsWith("arena_")).toBe(true);
    expect(bout.members.map((m) => m.id)).toEqual([a.id, b.id]);
    expect(bout.hostId).toBe(a.id);
    expect(bout.endsAt).toBe(now + ARENA.durationMs);
    expect(lastOf(b, "arenaAssigned")!.assignment.seed).toBe(bout.seed);
    // They left the camp: Cy saw them go.
    expect(c.inbox.filter((m) => m.t === "peerLeft").map((m) => (m as { playerId: string }).playerId)).toEqual([a.id, b.id]);
  });

  test("leaving the line, or going down into the dungeon, gives up your place", () => {
    relay.handle(a.id, { t: "arenaJoin" });
    relay.handle(b.id, { t: "arenaJoin" });
    relay.handle(a.id, { t: "arenaLeave" });
    expect(lastOf(a, "arenaQueue")).toMatchObject({ position: 0 });
    expect(lastOf(b, "arenaQueue")).toMatchObject({ position: 1, waiting: 1 });
    relay.handle(c.id, { t: "arenaJoin" });
    relay.handle(c.id, { t: "enterFloor", floor: 1, fresh: true });
    now += ARENA.gatherMs;
    relay.tick();
    expect(lastOf(b, "arenaAssigned")).toBeUndefined();
    // And mid-run you can't queue at all.
    relay.handle(c.id, { t: "arenaJoin" });
    expect(lastOf(b, "arenaQueue")).toMatchObject({ waiting: 1 });
  });
});

describe("a bout", () => {
  test("envelopes stay in the hall", () => {
    startDuel();
    relay.handle(b.id, { t: "msg", ch: "p:pose", data: 1 });
    expect(lastOf(a, "msg")?.ch).toBe("p:pose");
    expect(lastOf(c, "msg")).toBeUndefined();
  });

  test("the fallen name who took the yield; once per rising; never a stranger", () => {
    startDuel();
    relay.handle(b.id, { t: "arenaFell", by: a.id });
    const score = lastOf(a, "arenaScore")!;
    expect(score.fell).toEqual({ victim: b.id, by: a.id });
    expect(score.board.find((s) => s.id === a.id)?.kills).toBe(1);
    // Falling again before rising counts for nothing.
    relay.handle(b.id, { t: "arenaFell", by: a.id });
    expect(lastOf(a, "arenaScore")!.board.find((s) => s.id === a.id)?.kills).toBe(1);
    // Cy isn't in the bout: no yield for Cy.
    now += ARENA.respawnMs;
    relay.handle(b.id, { t: "arenaFell", by: c.id });
    const after = lastOf(a, "arenaScore")!;
    expect(after.fell.by).toBeNull();
    expect(after.board.find((s) => s.id === b.id)?.falls).toBe(2);
  });

  test("the score ends it, and Varr writes it in the ledger", () => {
    startDuel();
    for (let i = 0; i < ARENA.killsToWin; i++) {
      relay.handle(b.id, { t: "arenaFell", by: a.id });
      now += ARENA.respawnMs;
    }
    const end = lastOf(a, "arenaEnded")!;
    expect(end.winner).toBe(a.id);
    expect(end.board[0]!.id).toBe(a.id);
    expect(end.record).toEqual({ bouts: 1, wins: 1, yields: ARENA.killsToWin });
    expect(lastOf(b, "arenaEnded")!.record).toEqual({ bouts: 1, wins: 0, yields: 0 });
    // No more falls count once it's over.
    relay.handle(a.id, { t: "arenaFell", by: b.id });
    expect(lastOf(b, "arenaScore")!.board.find((s) => s.id === b.id)?.kills).toBe(0);
    // Home again: the record rides the save.
    relay.handle(a.id, { t: "enterCamp" });
    expect(lastOf(a, "campAssigned")).toBeDefined();
    relay.handle(a.id, { t: "login", name: a.name, token: lastOf(a, "loggedIn")!.token });
    expect(lastOf(a, "loggedIn")!.save.arena).toEqual({ bouts: 1, wins: 1, yields: ARENA.killsToWin });
  });

  test("the sands run out", () => {
    startDuel();
    relay.handle(a.id, { t: "arenaFell", by: b.id });
    now += ARENA.durationMs;
    relay.tick();
    expect(lastOf(a, "arenaEnded")?.winner).toBe(b.id);
  });

  test("a deserter leaves the hall to whoever stays (if they've taken a yield)", () => {
    startDuel();
    relay.handle(a.id, { t: "arenaFell", by: b.id });
    relay.disconnect(b.id);
    // Bo took the only yield, but Bo is gone: nobody wins.
    expect(lastOf(a, "arenaEnded")?.winner).toBeNull();
  });

  test("a straggler's seat is let go a while after the farewell", () => {
    const room = startDuel();
    now += ARENA.durationMs;
    relay.tick();
    relay.handle(b.id, { t: "enterCamp" });
    now += ARENA.afterMs + 61_000;
    relay.tick();
    // Ann never walked home; the hall is empty and gone now — a new pair
    // gets a fresh room.
    relay.handle(b.id, { t: "arenaJoin" });
    relay.handle(c.id, { t: "arenaJoin" });
    now += ARENA.gatherMs;
    relay.tick();
    expect(lastOf(c, "arenaAssigned")!.assignment.instanceId).not.toBe(room);
  });
});
