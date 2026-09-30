import { describe, expect, test } from "bun:test";
import { emptyGrid, type Carried, type SlotRef } from "../../../items/inventory";
import { sellValue } from "../../../items/economy";
import type { ItemStack } from "../../../items/types";
import { acceptingSockets, dropHint, landedCell, resolveDrop, sellOffer, type PointerHit } from "./dropTarget";
import { altarLayout, chestLayout, stallLayout, type SocketSpec } from "./layout";

const stack = (defId: string, qty = 1, runLoot = false): ItemStack => ({ defId, qty, runLoot });

function carried(over: Partial<Carried> = {}): Carried {
  return {
    equipment: {
      staff: { defId: "ember_staff@7", runLoot: false },
      amulet: { defId: "amulet_focus", runLoot: false },
      cloak: null,
      boots: { defId: "boots_hover@4", runLoot: false },
    },
    bag: [stack("cloak_shadow"), stack("potion_hp_weak", 2), null, stack("arc_staff@3"), null],
    belt: [stack("potion_hp_weak", 3), null],
    chest: emptyGrid(30),
    ...over,
  };
}

const sockets = [...altarLayout().sockets, ...chestLayout().sockets, ...stallLayout().sockets];
const socket = (key: string): SocketSpec => sockets.find((s) => s.key === key)!;
const onSocket = (key: string): PointerHit => {
  const s = socket(key);
  return { kind: "socket", tablet: s.variant === "chest" ? "chest" : s.variant === "ware" ? "stall" : "altar", socket: s };
};
const VOID: PointerHit = { kind: "void" };
const village = { mode: "inventory" as const, inVillage: true };
const dungeon = { mode: "inventory" as const, inVillage: false };
const bag = (index: number): SlotRef => ({ container: "bag", index });

describe("resolveDrop: onto a socket", () => {
  test("bag gear onto its empty equipment socket → equip", () => {
    expect(resolveDrop(carried(), bag(0), onSocket("equipment:cloak"), village)).toEqual({
      kind: "move",
      to: { container: "equipment", slot: "cloak" },
      swap: false,
      merge: false,
    });
  });

  test("onto an occupied socket → swap", () => {
    const a = resolveDrop(carried(), bag(3), onSocket("equipment:staff"), village);
    expect(a).toMatchObject({ kind: "move", swap: true, merge: false });
  });

  test("the same consumable with headroom → merge", () => {
    const a = resolveDrop(carried(), bag(1), onSocket("belt:0"), village);
    expect(a).toMatchObject({ kind: "move", swap: false, merge: true });
  });

  test("wrong kind of socket → nothing (gear on the belt, boots in the cloak slot)", () => {
    expect(resolveDrop(carried(), bag(0), onSocket("belt:1"), village).kind).toBe("none");
    expect(resolveDrop(carried(), bag(0), onSocket("equipment:boots"), village).kind).toBe("none");
  });

  test("the staff can't leave its socket for an empty cell (a wizard needs one)", () => {
    const from: SlotRef = { container: "equipment", slot: "staff" };
    expect(resolveDrop(carried(), from, onSocket("bag:2"), village).kind).toBe("none");
    // …but may swap with another staff.
    expect(resolveDrop(carried(), from, onSocket("bag:3"), village)).toMatchObject({ kind: "move", swap: true });
  });

  test("the chest only takes part in the village", () => {
    expect(resolveDrop(carried(), bag(0), onSocket("chest:5"), { mode: "chest", inVillage: true }).kind).toBe("move");
    expect(resolveDrop(carried(), bag(0), onSocket("chest:5"), { mode: "chest", inVillage: false }).kind).toBe("none");
  });

  test("dropping on its own socket, or with nothing held, does nothing", () => {
    expect(resolveDrop(carried(), bag(0), onSocket("bag:0"), village).kind).toBe("none");
    expect(resolveDrop(carried(), bag(2), onSocket("bag:4"), village).kind).toBe("none");
  });
});

describe("resolveDrop: off the tablets", () => {
  test("dungeon → falls to the floor; village → discarded", () => {
    expect(resolveDrop(carried(), bag(0), VOID, dungeon)).toEqual({ kind: "drop" });
    expect(resolveDrop(carried(), bag(0), VOID, village)).toEqual({ kind: "discard" });
  });

  test("the staff is never dropped", () => {
    const a = resolveDrop(carried(), { container: "equipment", slot: "staff" }, VOID, dungeon);
    expect(a.kind).toBe("none");
    expect(a.kind === "none" && a.reason).toContain("staff");
  });

  test("bare stone between sockets is not the floor: the item goes home", () => {
    expect(resolveDrop(carried(), bag(0), { kind: "tablet", tablet: "altar" }, dungeon).kind).toBe("none");
  });
});

describe("resolveDrop: selling at Maro's stall", () => {
  const merchant = { mode: "merchant" as const, inVillage: true };

  test("anywhere on the stall sells the whole stack at his price", () => {
    const expected = sellValue("potion_hp_weak")! * 2;
    expect(resolveDrop(carried(), bag(1), { kind: "tablet", tablet: "stall" }, merchant)).toEqual({ kind: "sell", gold: expected });
    expect(resolveDrop(carried(), bag(1), onSocket("ware:potion_mp_weak"), merchant)).toEqual({ kind: "sell", gold: expected });
    expect(sellOffer(carried(), bag(1))).toBe(expected);
  });

  test("he never buys the staff", () => {
    const from: SlotRef = { container: "equipment", slot: "staff" };
    expect(resolveDrop(carried(), from, { kind: "tablet", tablet: "stall" }, merchant).kind).toBe("none");
    expect(sellOffer(carried(), from)).toBeNull();
  });
});

describe("dropHint / acceptingSockets", () => {
  test("hints name what letting go does; plain moves stay quiet", () => {
    const inv = carried();
    expect(dropHint({ kind: "drop" }, inv, bag(1))?.text).toBe("DROP ×2");
    expect(dropHint({ kind: "discard" }, inv, bag(0))?.tone).toBe("danger");
    expect(dropHint({ kind: "sell", gold: 12 }, inv, bag(0))).toEqual({ text: "SELL · 12 GOLD", tone: "gold" });
    expect(dropHint({ kind: "move", to: bag(2), swap: false, merge: false }, inv, bag(0))).toBeNull();
    expect(dropHint({ kind: "move", to: { container: "equipment", slot: "cloak" }, swap: false, merge: false }, inv, bag(0))?.text).toBe("EQUIP");
  });

  test("a cloak kindles its gear socket and every bag/chest cell, never the belt", () => {
    const keys = acceptingSockets(carried(), bag(0), sockets, true);
    expect(keys.has("equipment:cloak")).toBe(true);
    expect(keys.has("equipment:boots")).toBe(false);
    expect(keys.has("belt:0")).toBe(false);
    expect(keys.has("bag:2")).toBe(true);
    expect(keys.has("chest:0")).toBe(true);
    expect(keys.has("bag:0")).toBe(false); // its own cell
    expect([...keys].some((k) => k.startsWith("ware:"))).toBe(false);
  });

  test("in the dungeon the chest stays dark", () => {
    const keys = acceptingSockets(carried(), bag(0), sockets, false);
    expect([...keys].some((k) => k.startsWith("chest:"))).toBe(false);
  });
});

describe("landedCell (where a purchase went)", () => {
  test("a new stack in the belt, a top-up, a bag cell, or nothing", () => {
    const before = carried();
    expect(landedCell(before, { ...before, belt: [stack("potion_hp_weak", 3), stack("potion_mp_weak")] })).toEqual({ container: "belt", index: 1 });
    expect(landedCell(before, { ...before, belt: [stack("potion_hp_weak", 4), null] })).toEqual({ container: "belt", index: 0 });
    const bag = [...before.bag];
    bag[2] = stack("amulet_fury@6");
    expect(landedCell(before, { ...before, bag })).toEqual({ container: "bag", index: 2 });
    expect(landedCell(before, before)).toBeNull();
  });
});
