import { describe, expect, test } from "bun:test";
import { KillCredit } from "./killCredit";

describe("kill credit", () => {
  test("the last other wizard to hurt you within the window takes the kill", () => {
    const credit = new KillCredit(12_000);
    credit.record({ kind: "wizard", id: "oswin" }, 1_000, "me");
    credit.record({ kind: "enemy" }, 2_000, "me"); // a wisp finishes the job
    expect(credit.killer(3_000)).toBe("oswin");
    credit.record({ kind: "wizard", id: "mira" }, 4_000, "me");
    expect(credit.killer(5_000)).toBe("mira");
  });

  test("old hits expire; your own magic never counts", () => {
    const credit = new KillCredit(12_000);
    credit.record({ kind: "wizard", id: "oswin" }, 0, "me");
    expect(credit.killer(12_001)).toBeNull();
    credit.record({ kind: "wizard", id: "me" }, 20_000, "me");
    expect(credit.killer(20_001)).toBeNull();
    credit.record(undefined, 20_000, "me");
    expect(credit.killer(20_001)).toBeNull();
  });
});
