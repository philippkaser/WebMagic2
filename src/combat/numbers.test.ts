import { describe, expect, test } from "bun:test";
import { addNumber, createNumbers, NUMBERS, numberLook, numberText, stepNumbers, type DamageNumber } from "./numbers";

const text = (e: DamageNumber) => {
  const buf: number[] = new Array(8).fill(0);
  const n = numberText(e, buf);
  return String.fromCharCode(...buf.slice(0, n));
};

describe("damage numbers", () => {
  test("a beam's ticks pour into one climbing number", () => {
    const pool = createNumbers();
    let e = addNumber(pool, "w1", 0, 1, 0, 5, 0);
    for (let i = 0; i < 4; i++) {
      stepNumbers(pool, 0.08);
      e = addNumber(pool, "w1", 0, 1, 0, 5, 0);
    }
    expect(text(e)).toBe("25");
    expect(pool.items.filter((x) => x.live).length).toBe(1);
  });

  test("hits on different creatures, or too far apart, get their own numbers", () => {
    const pool = createNumbers();
    addNumber(pool, "w1", 0, 1, 0, 16, 0);
    addNumber(pool, "w2", 2, 1, 0, 16, 0);
    stepNumbers(pool, NUMBERS.merge + 0.01);
    addNumber(pool, "w1", 0, 1, 0, 16, 0);
    expect(pool.items.filter((x) => x.live).length).toBe(3);
  });

  test("a precision hit turns the number gold with a '!', the killing blow red — and it never goes back", () => {
    const pool = createNumbers();
    const e = addNumber(pool, "s", 0, 1, 0, 24, 1);
    expect(text(e)).toBe("24!");
    addNumber(pool, "s", 0, 1, 0, 5, 0);
    expect(e.style).toBe(1);
    addNumber(pool, "s", 0, 1, 0, 5, 2);
    expect(e.style).toBe(2);
    expect(text(e)).toBe("34");
    // A dead creature's number is closed: nothing pours into it any more.
    const next = addNumber(pool, "s", 0, 1, 0, 3, 0);
    expect(next).not.toBe(e);
  });

  test("a number pops big, settles, rises and fades out", () => {
    const pool = createNumbers();
    const e = addNumber(pool, "w", 0, 1, 0, 9, 0);
    expect(numberLook(e).scale).toBeCloseTo(NUMBERS.pop, 9);
    stepNumbers(pool, NUMBERS.popTime);
    expect(numberLook(e).scale).toBeCloseTo(1, 9);
    expect(numberLook(e).alpha).toBe(1);
    const r1 = numberLook(e).rise;
    stepNumbers(pool, 0.3);
    expect(numberLook(e).rise).toBeGreaterThan(r1);
    stepNumbers(pool, NUMBERS.life - 0.3 - NUMBERS.popTime - 0.05);
    expect(numberLook(e).alpha).toBeLessThan(0.5);
    stepNumbers(pool, 0.1);
    expect(e.live).toBe(false);
  });

  test("the pool never grows: a full pool reuses its oldest number", () => {
    const pool = createNumbers(4);
    for (let i = 0; i < 4; i++) {
      addNumber(pool, `t${i}`, 0, 0, 0, 1, 0);
      stepNumbers(pool, 0.01);
    }
    const e = addNumber(pool, "new", 0, 0, 0, 7, 0);
    expect(pool.items.length).toBe(4);
    expect(e.target).toBe("new");
    expect(pool.items.map((x) => x.target).sort()).toEqual(["new", "t1", "t2", "t3"]);
  });

  test("a lone number sits where it hit; a row of them steps apart on screen", () => {
    const pool = createNumbers();
    const a = addNumber(pool, "a", 0, 1, 5, 9, 0);
    expect([a.dx, a.dy]).toEqual([0, 0]);
    const b = addNumber(pool, "b", 0, 1, 7, 9, 0);
    const c = addNumber(pool, "c", 0, 1, 9, 9, 0);
    const spots = new Set([a, b, c].map((e) => `${e.dx},${e.dy}`));
    expect(spots.size).toBe(3);
  });

  test("text: whole points, never 0, and it fits its buffer", () => {
    const pool = createNumbers();
    expect(text(addNumber(pool, "a", 0, 0, 0, 0.2, 0))).toBe("1");
    expect(text(addNumber(pool, "b", 0, 0, 0, 1234.6, 0))).toBe("1235");
    expect(text(addNumber(pool, "c", 0, 0, 0, 100, 1))).toBe("100!");
  });
});
