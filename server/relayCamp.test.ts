import { beforeEach, describe, expect, test } from "bun:test";
import { FloorDirectory } from "../src/net/matchmaking";
import type { ServerMsg } from "../src/net/protocol";
import { AccountStore } from "./accounts";
import { CHAT_MAX, cleanChat, Relay, type RelayPeer } from "./relay";

/** The camp, chat and fellowships — the social half of the relay. */

interface TestPeer extends RelayPeer {
  inbox: ServerMsg[];
}

function makePeer(id: string, name = id): TestPeer {
  const peer: TestPeer = { id, name, inbox: [], send: (m) => void peer.inbox.push(m) };
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
  // Strangers never meet on a floor (dice 0.99): only fellowships share one.
  relay = new Relay(new FloorDirectory(4, () => 99, () => now, () => 0.99), new AccountStore(), () => now);
  [a, b, c] = ["Ann", "Bo", "Cy"].map((n) => makePeer(n));
  for (const p of [a, b, c]) {
    relay.connect(p);
    relay.handle(p.id, { t: "login", name: p.name });
  }
});

describe("the camp", () => {
  test("everyone home shares one camp, with a host, and sees arrivals", () => {
    relay.handle(a.id, { t: "enterCamp" });
    relay.handle(b.id, { t: "enterCamp" });
    const camp = lastOf(b, "campAssigned")!.assignment;
    expect(camp.instanceId.startsWith("camp_")).toBe(true);
    expect(camp.hostId).toBe(a.id);
    expect(camp.members.map((m) => m.id)).toEqual([a.id, b.id]);
    expect(lastOf(a, "peerJoined")?.member.id).toBe(b.id);
  });

  test("envelopes route within the camp; entering a floor leaves it", () => {
    relay.handle(a.id, { t: "enterCamp" });
    relay.handle(b.id, { t: "enterCamp" });
    relay.handle(b.id, { t: "msg", ch: "p:pose", data: { x: 1 } });
    expect(lastOf(a, "msg")?.ch).toBe("p:pose");
    relay.handle(a.id, { t: "enterFloor", floor: 1, fresh: true });
    expect(lastOf(b, "peerLeft")?.playerId).toBe(a.id);
    // Host passes to who's left.
    expect(lastOf(b, "hostChanged")?.hostId).toBe(b.id);
  });

  test("a wizard mid-run can't sit in the camp", () => {
    relay.handle(a.id, { t: "enterFloor", floor: 1, fresh: true });
    relay.handle(a.id, { t: "enterCamp" });
    expect(lastOf(a, "campAssigned")).toBeUndefined();
  });
});

describe("chat", () => {
  test("lines are cleaned: no control characters, no long runs of space, capped", () => {
    expect(cleanChat("  hi\u0007   there\n ")).toBe("hi there");
    expect(cleanChat("​\u0000")).toBeNull();
    expect(cleanChat(42)).toBeNull();
    expect(cleanChat("x".repeat(500))!.length).toBe(CHAT_MAX);
  });

  test("room chat reaches the room (and echoes to the speaker); too fast is dropped", () => {
    relay.handle(a.id, { t: "enterCamp" });
    relay.handle(b.id, { t: "enterCamp" });
    relay.handle(a.id, { t: "chat", text: "well met" });
    expect(lastOf(b, "chat")).toMatchObject({ from: a.id, name: "Ann", text: "well met", party: false });
    expect(lastOf(a, "chat")?.text).toBe("well met");
    expect(lastOf(c, "chat")).toBeUndefined();
    for (let i = 0; i < 10; i++) relay.handle(a.id, { t: "chat", text: `spam ${i}` });
    expect(b.inbox.filter((m) => m.t === "chat").length).toBe(5);
    now += 11_000;
    relay.handle(a.id, { t: "chat", text: "later" });
    expect(lastOf(b, "chat")?.text).toBe("later");
  });
});

describe("fellowships", () => {
  test("found, share the code, join; everyone hears how it stands", () => {
    relay.handle(a.id, { t: "partyCreate" });
    const code = lastOf(a, "party")!.party!.code;
    relay.handle(b.id, { t: "partyJoin", code: code.toLowerCase() });
    expect(lastOf(a, "party")!.party!.members.map((m) => m.name)).toEqual(["Ann", "Bo"]);
    expect(lastOf(b, "party")!.party!.leader).toBe(a.id);
    relay.handle(c.id, { t: "partyJoin", code: "AAAAAA" });
    expect(lastOf(c, "partyError")?.reason).toBe("no-such-party");
  });

  test("an invite needs the invitee in your room; accepting founds the party", () => {
    relay.handle(a.id, { t: "partyInvite", to: b.id });
    expect(lastOf(a, "partyError")?.reason).toBe("no-invite");
    relay.handle(a.id, { t: "enterCamp" });
    relay.handle(b.id, { t: "enterCamp" });
    relay.handle(a.id, { t: "partyInvite", to: b.id });
    expect(lastOf(b, "partyInvited")).toMatchObject({ from: a.id, name: "Ann" });
    relay.handle(b.id, { t: "partyAccept" });
    expect(lastOf(a, "party")!.party!.members.map((m) => m.id)).toEqual([a.id, b.id]);
  });

  test("party chat reaches members wherever they are, and no one else", () => {
    relay.handle(a.id, { t: "partyCreate" });
    relay.handle(b.id, { t: "partyJoin", code: lastOf(a, "party")!.party!.code });
    relay.handle(a.id, { t: "enterFloor", floor: 1, fresh: true });
    relay.handle(b.id, { t: "enterCamp" });
    relay.handle(c.id, { t: "enterCamp" });
    relay.handle(b.id, { t: "chat", text: "hold on", party: true });
    expect(lastOf(a, "chat")).toMatchObject({ text: "hold on", party: true });
    expect(lastOf(c, "chat")).toBeUndefined();
  });

  test("a fellowship goes down together: same floor, same instance — even for strangers' dice", () => {
    relay.handle(a.id, { t: "partyCreate" });
    relay.handle(b.id, { t: "partyJoin", code: lastOf(a, "party")!.party!.code });
    relay.handle(a.id, { t: "enterFloor", floor: 1, fresh: true });
    relay.handle(b.id, { t: "enterFloor", floor: 1, fresh: true });
    const ia = lastOf(a, "floorAssigned")!.assignment;
    const ib = lastOf(b, "floorAssigned")!.assignment;
    expect(ib.instanceId).toBe(ia.instanceId);
    // A stranger on the same floor stays alone (dice never meet).
    relay.handle(c.id, { t: "enterFloor", floor: 1, fresh: true });
    expect(lastOf(c, "floorAssigned")!.assignment.instanceId).not.toBe(ia.instanceId);
  });

  test("leaving tells the rest; a disconnect is a leave", () => {
    relay.handle(a.id, { t: "partyCreate" });
    const code = lastOf(a, "party")!.party!.code;
    relay.handle(b.id, { t: "partyJoin", code });
    relay.handle(c.id, { t: "partyJoin", code });
    relay.handle(b.id, { t: "partyLeave" });
    expect(lastOf(b, "party")!.party).toBeNull();
    expect(lastOf(a, "party")!.party!.members.map((m) => m.id)).toEqual([a.id, c.id]);
    relay.disconnect(a.id);
    expect(lastOf(c, "party")!.party).toMatchObject({ leader: c.id });
  });
});
