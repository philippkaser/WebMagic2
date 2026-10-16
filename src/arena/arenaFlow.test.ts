import { afterAll, afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { gameEvents } from "../core/events";
import { SAVE_FEATHER_ID } from "../items/catalog";
import { netBus } from "../net/bus";
import { useNet } from "../net/netStore";
import type { ArenaAssignment, WireInventory } from "../net/protocol";
import { session } from "../net/session";
import { getStats, useGame } from "../state/gameStore";
import { isTraveling, markTravelFrame } from "../transition/travel";
import { setCurrentLayout } from "../world/currentFloor";
import { stepBack } from "./arenaFlow";
import { canTakeBout, takeBout, useArena } from "./arenaStore";
import { generateArena } from "./layout";
import { ARENA } from "./rules";

/** The Proving Ground as one client lives it: which bouts it takes, how it
 * leaves one, what the hall does to the belt, and how a wizard rises. */

const deal: ArenaAssignment = {
  instanceId: "arena_1",
  seed: 7,
  hostId: "me",
  epoch: 1,
  members: [
    { id: "me", name: "Me" },
    { id: "foe", name: "Foe" },
  ],
  endsAt: 0,
  killsToWin: ARENA.killsToWin,
};

// The stores are the game's own singletons: put them back as found, so no
// other file inherits a wizard left in the hall.
const before = { game: useGame.getState(), net: useNet.getState(), arena: useArena.getState() };
afterAll(() => {
  useGame.setState(before.game, true);
  useNet.setState(before.net, true);
  useArena.setState(before.arena, true);
});

type Spied = { arenaLeave?: unknown; sendStash?: unknown };
let leaves = 0;
let stashes: WireInventory[] = [];
const offs: (() => void)[] = [];

function heard<K extends "message" | "wizardHealed">(k: K) {
  const got: unknown[] = [];
  offs.push(gameEvents.on(k, (v) => got.push(v)));
  return got;
}

beforeEach(() => {
  leaves = 0;
  stashes = [];
  (session as unknown as Spied).arenaLeave = () => void leaves++;
  (session as unknown as Spied).sendStash = (inv: WireInventory) => void stashes.push(inv);
  useNet.setState({ playerId: "me", hostId: "camp_host", epoch: 3, roster: { me: "Me", camper: "Camper" } });
  useArena.setState({ queue: null, bout: null, record: null, steppingBack: false });
  useGame.setState({ phase: "village", run: null });
});

afterEach(() => {
  offs.splice(0).forEach((off) => off());
  delete (session as unknown as Spied).arenaLeave;
  delete (session as unknown as Spied).sendStash;
  // Whatever a test left of a bout, a floor's assignment clears it (and its
  // timers), as it does in play.
  netBus.emit("assigned", { instanceId: "inst_1", floor: 1, seed: 1, hostId: "me", epoch: 1, members: [] });
  setCurrentLayout(null);
  jest.useRealTimers();
});

describe("a bout dealt", () => {
  test("only a wizard who's home and standing still can take it", () => {
    expect(canTakeBout("village", false)).toBe(true);
    expect(canTakeBout("weighing", false)).toBe(true);
    expect(canTakeBout("village", true)).toBe(false);
    for (const phase of ["menu", "loading", "dungeon", "dead"] as const) expect(canTakeBout(phase, false)).toBe(false);
  });

  test("on the road down it's turned down: out of the line, no bout, and the relay told", () => {
    useArena.setState({ queue: { position: 1, waiting: 2 } });
    useGame.setState({ phase: "loading" }); // the gate's ENTER
    netBus.emit("arenaAssigned", deal);
    expect(useArena.getState()).toMatchObject({ queue: null, bout: null });
    expect(leaves).toBe(1);
    // The camp's roster stays ours until the floor's arrives.
    expect(useNet.getState()).toMatchObject({ hostId: "camp_host", epoch: 3, roster: { me: "Me", camper: "Camper" } });
  });

  test("home, it's taken: the hall's board and roster, and the journey in", async () => {
    jest.useFakeTimers();
    useArena.setState({ queue: { position: 2, waiting: 2 } });
    netBus.emit("arenaAssigned", deal);
    expect(leaves).toBe(0);
    expect(useArena.getState().queue).toBeNull();
    expect(useArena.getState().bout).toMatchObject({ instanceId: "arena_1", ended: null, fallen: {} });
    expect(useArena.getState().bout!.board.map((s) => s.id)).toEqual(["me", "foe"]);
    expect(useNet.getState()).toMatchObject({ hostId: "me", epoch: 1, roster: { me: "Me", foe: "Foe" } });
    expect(isTraveling()).toBe(true);
    // Play the journey out (ENTER, the switch, a few frames, the tunnel).
    for (let i = 0; i < 10 && isTraveling(); i++) {
      jest.advanceTimersByTime(1000);
      for (let f = 0; f < 3; f++) markTravelFrame();
      for (let t = 0; t < 10; t++) await Promise.resolve();
    }
    expect(isTraveling()).toBe(false);
    expect(useGame.getState()).toMatchObject({ phase: "dungeon", instanceId: "arena_1", run: null });
  });

  test("a floor's assignment means we're out of whatever bout we thought we were in", () => {
    takeBout(deal);
    netBus.emit("assigned", { instanceId: "inst_9", floor: 3, seed: 9, hostId: "me", epoch: 1, members: [] });
    expect(useArena.getState().bout).toBeNull();
  });

  test("stepping back as Varr calls it: the bout dealt in that moment isn't ours to take", () => {
    useArena.setState({ queue: { position: 1, waiting: 2 } });
    stepBack();
    expect(leaves).toBe(1);
    // The relay dealt the bout before it read our step back…
    netBus.emit("arenaAssigned", deal);
    expect(useArena.getState().bout).toBeNull();
    expect(useGame.getState().phase).toBe("village");
    expect(isTraveling()).toBe(false);
    // …then answers the step back, and the moment's over: the next bout we
    // queue for is taken as usual.
    netBus.emit("arenaQueue", { position: 0, waiting: 1 });
    expect(useArena.getState().steppingBack).toBe(false);
  });

  test("a bout we turned down can end on the relay without touching us", () => {
    const said = heard("message");
    netBus.emit("arenaEnded", { board: [], winner: "foe", record: { bouts: 0, wins: 0, yields: 0 } });
    expect(said).toEqual([]);
    expect(stashes).toHaveLength(0);
  });

  test("a reconnect forgets our place in line (the relay already has)", () => {
    useArena.setState({ queue: { position: 1, waiting: 1 } });
    netBus.emit("reconnected", undefined);
    expect(useArena.getState().queue).toBeNull();
  });
});

describe("in the hall", () => {
  test("the feather won't fly: refused, and not spent", () => {
    takeBout(deal);
    const feather = { defId: SAVE_FEATHER_ID, qty: 1, runLoot: false };
    useGame.setState({ phase: "dungeon", run: null, belt: [feather, null, null, null] });
    const said = heard("message");
    useGame.getState().useBelt(0);
    expect(said).toEqual(["The feather won't carry you out of the Proving Ground"]);
    expect(useGame.getState().belt[0]).toEqual(feather);
    expect(useGame.getState().phase).toBe("dungeon");
    expect(isTraveling()).toBe(false);
  });

  test("the bout's end settles what was drunk, before the walk home", () => {
    jest.useFakeTimers();
    takeBout(deal);
    useGame.setState({ phase: "dungeon", belt: [null, null, null, null] });
    netBus.emit("arenaEnded", { t: "arenaEnded", board: [], winner: null, record: { bouts: 1, wins: 0, yields: 0 } });
    expect(stashes.length).toBe(1);
    expect(stashes[0]!.belt.every((s) => s === null)).toBe(true);
  });

  test("rising is a second wind: healed from nothing to full, so the heart lets go", () => {
    jest.useFakeTimers();
    takeBout(deal);
    setCurrentLayout(generateArena(deal.seed));
    const max = getStats().maxHealth;
    useGame.setState({ phase: "dungeon", health: 1 });
    const healed = heard("wizardHealed");
    useGame.getState().takeDamage(10_000);
    expect(useGame.getState()).toMatchObject({ phase: "loading", health: 0 });
    jest.advanceTimersByTime(ARENA.respawnMs);
    expect(useGame.getState()).toMatchObject({ phase: "dungeon", health: max });
    expect(healed).toEqual([{ from: 0, to: max, max }]);
  });
});
