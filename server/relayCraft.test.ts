import { beforeEach, describe, expect, test } from "bun:test";
import { FloorDirectory } from "../src/net/matchmaking";
import type { ServerMsg, WireInventory } from "../src/net/protocol";
import { AccountStore, defaultWireInventory } from "./accounts";
import { Relay, type RelayPeer } from "./relay";

/** The bank's crafting boundary: what the server will and won't work. */

interface TestPeer extends RelayPeer {
  inbox: ServerMsg[];
}

const lastOf = <T extends ServerMsg["t"]>(p: TestPeer, t: T) =>
  [...p.inbox].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined;

let relay: Relay;
let store: AccountStore;
let a: TestPeer;
let token = "";

function bankWith(over: Partial<WireInventory>): void {
  const acc = store.get(token)!;
  acc.inventory = { ...defaultWireInventory(), ...over };
}

beforeEach(() => {
  store = new AccountStore();
  relay = new Relay(new FloorDirectory(4, () => 1, () => 0, () => 0.99), store, () => 0);
  a = { id: "A", name: "Ann", inbox: [], send: (m) => void a.inbox.push(m) };
  relay.connect(a);
  relay.handle(a.id, { t: "login", name: "Ann" });
  token = lastOf(a, "loggedIn")!.token;
});

const pouch = (cells: { id: string; qty: number }[]) => Array.from({ length: 8 }, (_, i) => cells[i] ?? null);

describe("crafting on the server", () => {
  test("a brew from the bank: the reply echoes the recipe and carries the save", () => {
    bankWith({ pouch: pouch([{ id: "grave_moss", qty: 3 }]), gold: 10 });
    relay.handle(a.id, { t: "craft", recipe: "brew:potion_hp_weak" });
    const r = lastOf(a, "crafted")!;
    expect(r).toMatchObject({ recipe: "brew:potion_hp_weak", ok: true });
    expect(r.save.inventory.gold).toBe(6);
    expect(store.get(token)!.inventory.belt.some((s) => s?.id === "potion_hp_weak")).toBe(true);
  });

  test("refused mid-run: no reply, nothing changes", () => {
    bankWith({ pouch: pouch([{ id: "grave_moss", qty: 3 }]), gold: 10 });
    relay.handle(a.id, { t: "enterFloor", floor: 1, fresh: true });
    relay.handle(a.id, { t: "craft", recipe: "brew:potion_hp_weak" });
    expect(lastOf(a, "crafted")).toBeUndefined();
    expect(store.get(token)!.inventory.gold).toBe(10);
  });

  test("run grants can't pay for a craft — only what's banked", () => {
    bankWith({ gold: 10 });
    relay.handle(a.id, { t: "enterFloor", floor: 1, fresh: true });
    store.grant(store.get(token)!, "grave_moss", 5);
    relay.handle(a.id, { t: "leaveDungeon" });
    relay.handle(a.id, { t: "craft", recipe: "brew:potion_hp_weak" });
    expect(lastOf(a, "crafted")).toMatchObject({ ok: false, reason: "Not enough reagents" });
  });

  test("the forge refuses to work a different piece than the one the client laid down", () => {
    bankWith({ bag: [{ id: "amulet_vigor@3", qty: 1 }, null, null, null, null] });
    relay.handle(a.id, { t: "craft", recipe: "salvage", target: { c: "bag", i: 0 }, expect: "amulet_focus@3" });
    expect(lastOf(a, "crafted")).toMatchObject({ ok: false, reason: "The anvil holds something else" });
    expect(store.get(token)!.inventory.bag[0]).toEqual({ id: "amulet_vigor@3", qty: 1 });
    relay.handle(a.id, { t: "craft", recipe: "salvage", target: { c: "bag", i: 0 }, expect: "amulet_vigor@3" });
    expect(lastOf(a, "crafted")).toMatchObject({ ok: true });
    expect(store.get(token)!.inventory.bag[0]).toBeNull();
  });
});

describe("grave grants", () => {
  test("the pool is debited by what was credited, not what was asked", () => {
    const b: TestPeer = { id: "B", name: "Bo", inbox: [], send: (m) => void b.inbox.push(m) };
    // Two wizards who always meet.
    relay = new Relay(new FloorDirectory(4, () => 1, () => 0, () => 0), store, () => 0);
    relay.connect(a);
    relay.connect(b);
    relay.handle(a.id, { t: "login", name: "Ann", token });
    relay.handle(b.id, { t: "login", name: "Bo" });
    relay.handle(a.id, { t: "enterFloor", floor: 1, fresh: true });
    relay.handle(b.id, { t: "enterFloor", floor: 1, fresh: true });
    // Bo dies holding 30 moss from this run (host A attested it).
    for (let i = 0; i < 3; i++) relay.handle(a.id, { t: "grant", playerId: b.id, itemId: "grave_moss", qty: 10 });
    relay.handle(b.id, { t: "died" });
    // A plunders asking for 30 at once: the cap credits 10, the pool keeps 20.
    relay.handle(a.id, { t: "grant", playerId: a.id, itemId: "grave_moss", qty: 30, source: "grave" });
    relay.handle(a.id, { t: "grant", playerId: a.id, itemId: "grave_moss", qty: 10, source: "grave" });
    relay.handle(a.id, { t: "grant", playerId: a.id, itemId: "grave_moss", qty: 10, source: "grave" });
    const granted = store.get(token)!.runGrants.filter((id) => id === "grave_moss").length;
    expect(granted).toBe(30);
  });
});
