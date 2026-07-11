import { describe, expect, test } from "bun:test";
import { SAVE_FEATHER_ID } from "../src/items/catalog";
import { MERCHANT_STOCK } from "../src/items/economy";
import type { WireInventory } from "../src/net/protocol";
import { AccountStore, defaultWireInventory, sanitizeInventory } from "./accounts";

/** Convenience: a full inventory payload with overrides. */
function inv(partial: Partial<WireInventory> = {}): WireInventory {
  return { ...defaultWireInventory(), ...partial };
}

const FEATHER_PRICE = MERCHANT_STOCK.find((w) => w.id === SAVE_FEATHER_ID)!.price;

describe("AccountStore", () => {
  test("new accounts start with starter gear, no gold, checkpoint 1", () => {
    const store = new AccountStore();
    const acc = store.login(undefined, "Dana");
    expect(acc.checkpoint).toBe(1);
    expect(acc.inventory).toEqual(defaultWireInventory());
    expect(acc.token.length).toBeGreaterThan(0);
  });

  test("serializes through persist and restores from that JSON", () => {
    let json = "";
    const store = new AccountStore((j) => (json = j));
    const acc = store.login(undefined, "Dana");
    store.grant(acc, "ember_staff");
    store.grantGold(acc, 55);
    acc.checkpoint = 10;
    store.setRunFloor(acc, 12);

    const restored = new AccountStore(null, json);
    const back = restored.get(acc.token)!;
    expect(back.name).toBe("Dana");
    expect(back.runGrants).toEqual(["ember_staff"]);
    expect(back.runGold).toBe(55);
    expect(back.runFloor).toBe(12);
  });

  test("restores pre-inventory records ({equipment} only) by upgrading them", () => {
    const legacy = JSON.stringify([
      {
        token: "old-token",
        name: "Vet",
        checkpoint: 15,
        equipment: { staff: "arc_staff", amulet: "amulet_fury", cloak: null, boots: "worn_boots" },
        runGrants: [],
        runFloor: 0,
      },
    ]);
    const store = new AccountStore(null, legacy);
    const acc = store.get("old-token")!;
    expect(acc.checkpoint).toBe(15);
    expect(acc.inventory.equipment.staff).toBe("arc_staff");
    expect(acc.inventory.equipment.amulet).toBe("amulet_fury");
    expect(acc.inventory.gold).toBe(0);
    expect(acc.inventory.chest).toHaveLength(30);
  });

  test("corrupt persistence starts fresh instead of crashing", () => {
    const store = new AccountStore(null, "{not json!");
    expect(store.size).toBe(0);
  });

  test("grants are a multiset (two potions granted = two bankable) with a cap", () => {
    const store = new AccountStore();
    const acc = store.login(undefined, "Dana");
    store.grant(acc, "potion_hp_weak");
    store.grant(acc, "potion_hp_weak");
    expect(acc.runGrants).toEqual(["potion_hp_weak", "potion_hp_weak"]);
    for (let i = 0; i < 500; i++) store.grant(acc, `item_${i}`);
    expect(acc.runGrants.length).toBeLessThanOrEqual(200);
  });

  test("bank keeps previously banked gear even when grants are empty", () => {
    const store = new AccountStore();
    const acc = store.login(undefined, "Dana");
    store.grant(acc, "arc_staff");
    const equipped = {
      staff: "arc_staff",
      amulet: null,
      cloak: null,
      boots: "worn_boots",
    };
    store.bank(acc, 5, inv({ equipment: equipped }));
    // Next run, no new grants — the banked staff is still provably owned.
    const save = store.bank(acc, 10, inv({ equipment: equipped }));
    expect(save.inventory.equipment.staff).toBe("arc_staff");
    expect(save.checkpoint).toBe(10);
  });

  test("bank strips items beyond the owned multiset, per copy", () => {
    const store = new AccountStore();
    const acc = store.login(undefined, "Dana");
    store.grant(acc, "potion_hp_weak"); // exactly ONE granted
    const save = store.bank(
      acc,
      5,
      inv({ bag: [{ id: "potion_hp_weak", qty: 3 }, null, null, null, null] }),
    );
    expect(save.inventory.bag[0]).toEqual({ id: "potion_hp_weak", qty: 1 });
  });

  test("bank strips never-granted gear back to the previous bank", () => {
    const store = new AccountStore();
    const acc = store.login(undefined, "Dana");
    const save = store.bank(
      acc,
      5,
      inv({
        equipment: { staff: "void_staff", amulet: "amulet_fury", cloak: null, boots: "worn_boots" },
      }),
    );
    expect(save.inventory.equipment.staff).toBe("apprentice_staff");
    expect(save.inventory.equipment.amulet).toBeNull();
  });

  test("bank clamps gold to banked + host-attested pickups", () => {
    const store = new AccountStore();
    const acc = store.login(undefined, "Dana");
    store.grantGold(acc, 40);
    const save = store.bank(acc, 5, inv({ gold: 9999 }));
    expect(save.inventory.gold).toBe(40);
    // Grants are spent — banking again at 9999 yields no more.
    const again = store.bank(acc, 5, inv({ gold: 9999 }));
    expect(again.inventory.gold).toBe(40);
  });

  test("gold grants are sanity-capped per grant and per run", () => {
    const store = new AccountStore();
    const acc = store.login(undefined, "Dana");
    store.grantGold(acc, 100_000); // beyond perGrantCap
    expect(acc.runGold).toBe(500);
    store.grantGold(acc, -50);
    store.grantGold(acc, NaN);
    expect(acc.runGold).toBe(500);
  });

  test("endRun discards grants and gold", () => {
    const store = new AccountStore();
    const acc = store.login(undefined, "Dana");
    store.grant(acc, "arc_staff");
    store.grantGold(acc, 30);
    store.endRun(acc);
    const save = store.bank(acc, 5, inv({ equipment: { ...defaultWireInventory().equipment, staff: "arc_staff" }, gold: 30 }));
    expect(save.inventory.equipment.staff).toBe("apprentice_staff");
    expect(save.inventory.gold).toBe(0);
  });

  test("bank never lowers the checkpoint", () => {
    const store = new AccountStore();
    const acc = store.login(undefined, "Dana");
    acc.checkpoint = 20;
    const save = store.bank(acc, 5, inv());
    expect(save.checkpoint).toBe(20);
  });

  test("malformed bank payloads collapse to safe defaults", () => {
    const store = new AccountStore();
    const acc = store.login(undefined, "Dana");
    const save = store.bank(acc, 5, {
      equipment: { staff: 42, amulet: {}, cloak: [], boots: null },
      bag: "nope",
      gold: "lots",
    });
    // Junk boots sanitize to "unequipped" (boots are optional; only the
    // staff is mandatory and falls back to the previous bank).
    expect(save.inventory).toEqual({ ...defaultWireInventory(), equipment: {
      ...defaultWireInventory().equipment,
      boots: null,
    }});
  });

  test("rearrange moves owned items but admits nothing new", () => {
    const store = new AccountStore();
    const acc = store.login(undefined, "Dana");
    store.grant(acc, "amulet_vigor");
    store.bank(acc, 5, inv({ bag: [{ id: "amulet_vigor", qty: 1 }, null, null, null, null] }));
    // Legit: bag → chest.
    const moved = store.rearrange(
      acc,
      inv({ chest: pad([{ id: "amulet_vigor", qty: 1 }], 30) }),
    );
    expect(moved!.inventory.chest[0]).toEqual({ id: "amulet_vigor", qty: 1 });
    // Cheat: conjure a second copy.
    const cheat = store.rearrange(
      acc,
      inv({
        chest: pad([{ id: "amulet_vigor", qty: 1 }], 30),
        bag: pad([{ id: "amulet_vigor", qty: 1 }], 5),
      }),
    );
    expect(cheat).toBeNull();
  });

  test("rearrange rejects gold increases; a missing staff backfills to starter", () => {
    const store = new AccountStore();
    const acc = store.login(undefined, "Dana");
    expect(store.rearrange(acc, inv({ gold: 10 }))).toBeNull();
    const noStaff = inv();
    noStaff.equipment = { ...noStaff.equipment, staff: "" };
    const save = store.rearrange(acc, noStaff);
    expect(save!.inventory.equipment.staff).toBe("apprentice_staff");
  });

  test("buy validates price, deducts gold, admits exactly the bought item", () => {
    const store = new AccountStore();
    const acc = store.login(undefined, "Dana");
    store.grantGold(acc, 200);
    store.bank(acc, 5, inv({ gold: 200 }));
    // Not merchant stock → rejected.
    expect(store.rearrange(acc, inv({ gold: 0 }), "void_staff")).toBeNull();
    // Real purchase.
    const save = store.rearrange(
      acc,
      inv({ gold: 200 - FEATHER_PRICE, belt: pad([{ id: SAVE_FEATHER_ID, qty: 1 }], 2) }),
      SAVE_FEATHER_ID,
    );
    expect(save!.inventory.gold).toBe(200 - FEATHER_PRICE);
    expect(save!.inventory.belt[0]).toEqual({ id: SAVE_FEATHER_ID, qty: 1 });
    // Can't afford a second one.
    expect(
      store.rearrange(acc, inv({ gold: 0 }), SAVE_FEATHER_ID),
    ).toBeNull();
  });

  test("escape requires a provably-owned feather and consumes it", () => {
    const store = new AccountStore();
    const acc = store.login(undefined, "Dana");
    // No feather → refused.
    expect(store.escape(acc, inv())).toBeNull();
    // Feather granted this run, submitted inventory no longer contains it.
    store.grant(acc, SAVE_FEATHER_ID);
    store.grant(acc, "void_staff");
    const save = store.escape(
      acc,
      inv({ equipment: { ...defaultWireInventory().equipment, staff: "void_staff" } }),
    );
    expect(save).not.toBeNull();
    expect(save!.inventory.equipment.staff).toBe("void_staff");
    expect(save!.checkpoint).toBe(1); // escape never advances the checkpoint
    // The grant is spent — a second escape has no feather to burn.
    expect(store.escape(acc, inv())).toBeNull();
  });

  test("escape refuses when the feather is still claimed as carried", () => {
    const store = new AccountStore();
    const acc = store.login(undefined, "Dana");
    store.grant(acc, SAVE_FEATHER_ID);
    // Submitting the feather as still-owned means nothing was consumed.
    const kept = inv({ belt: pad([{ id: SAVE_FEATHER_ID, qty: 1 }], 2) });
    expect(store.escape(acc, kept)).toBeNull();
  });

  test("sanitizeInventory forces grid sizes and drops junk stacks", () => {
    const s = sanitizeInventory({
      bag: [{ id: "x", qty: 2 }, { id: "", qty: 3 }, { qty: 1 }, "junk"],
      belt: null,
      gold: -5,
    });
    expect(s.bag).toHaveLength(5);
    expect(s.bag[0]).toEqual({ id: "x", qty: 2 });
    expect(s.bag[1]).toBeNull();
    expect(s.belt).toHaveLength(2);
    expect(s.gold).toBe(0);
  });
});

function pad<T>(items: T[], size: number): (T | null)[] {
  return [...items, ...new Array(size - items.length).fill(null)];
}
