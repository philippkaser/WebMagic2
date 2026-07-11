import { describe, expect, test } from "bun:test";
import { AccountStore, defaultWireEquipment } from "./accounts";

describe("AccountStore", () => {
  test("new accounts start with starter gear and checkpoint 1", () => {
    const store = new AccountStore();
    const acc = store.login(undefined, "Dana");
    expect(acc.checkpoint).toBe(1);
    expect(acc.equipment).toEqual(defaultWireEquipment());
    expect(acc.token.length).toBeGreaterThan(0);
  });

  test("serializes through persist and restores from that JSON", () => {
    let json = "";
    const store = new AccountStore((j) => (json = j));
    const acc = store.login(undefined, "Dana");
    store.grant(acc, "ember_staff");
    acc.checkpoint = 10;
    store.setRunFloor(acc, 12);

    const restored = new AccountStore(null, json);
    const back = restored.get(acc.token)!;
    expect(back.name).toBe("Dana");
    expect(back.runGrants).toEqual(["ember_staff"]);
    expect(back.runFloor).toBe(12);
  });

  test("corrupt persistence starts fresh instead of crashing", () => {
    const store = new AccountStore(null, "{not json!");
    expect(store.size).toBe(0);
  });

  test("grants dedupe and cap", () => {
    const store = new AccountStore();
    const acc = store.login(undefined, "Dana");
    store.grant(acc, "x");
    store.grant(acc, "x");
    expect(acc.runGrants).toEqual(["x"]);
    for (let i = 0; i < 500; i++) store.grant(acc, `item_${i}`);
    expect(acc.runGrants.length).toBeLessThanOrEqual(200);
  });

  test("bank keeps previously banked gear even when grants are empty", () => {
    const store = new AccountStore();
    const acc = store.login(undefined, "Dana");
    store.grant(acc, "arc_staff");
    store.bank(acc, 5, { staff: "arc_staff", amulet: null, cloak: null, boots: "worn_boots" });
    // Next run, no new grants — the banked staff is still provably owned.
    const save = store.bank(acc, 10, {
      staff: "arc_staff",
      amulet: null,
      cloak: null,
      boots: "worn_boots",
    });
    expect(save.equipment.staff).toBe("arc_staff");
    expect(save.checkpoint).toBe(10);
  });

  test("bank never lowers the checkpoint", () => {
    const store = new AccountStore();
    const acc = store.login(undefined, "Dana");
    acc.checkpoint = 20;
    const save = store.bank(acc, 5, defaultWireEquipment());
    expect(save.checkpoint).toBe(20);
  });

  test("malformed bank payloads collapse to safe defaults", () => {
    const store = new AccountStore();
    const acc = store.login(undefined, "Dana");
    const save = store.bank(acc, 5, { staff: 42, amulet: {}, cloak: [], boots: null });
    expect(save.equipment).toEqual(defaultWireEquipment());
  });
});
