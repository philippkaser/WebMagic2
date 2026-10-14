import { afterEach, describe, expect, test } from "bun:test";
import { gameEvents } from "../core/events";
import { LAST_STAND, LETHAL_GRACE } from "../game/vitality";
import { BRINK_WINDOW_S, brinkLeft, getStats, useGame } from "./gameStore";

/** The wizard's own rules, as takeDamage applies them: last stand, lethal
 * grace (the Brink and its window), and what playerHurt reports. */

const max = () => getStats().maxHealth;
const offs: (() => void)[] = [];
afterEach(() => offs.splice(0).forEach((off) => off()));

function heard<K extends "playerHurt" | "wizardBrink" | "wizardHealed">(k: K) {
  const got: unknown[] = [];
  offs.push(gameEvents.on(k, (v) => got.push(v)));
  return got;
}

/** A fresh wizard on a floor; the Brink's clock is per test (each passes a
 * later `now` through real time, so grace's cooldown is honoured). */
function standAt(health: number) {
  useGame.setState({ phase: "village", health });
}

describe("last stand and lethal grace in takeDamage", () => {
  test("above the line a blow lands in full; below it, halved", () => {
    standAt(max());
    const hurt = heard("playerHurt");
    useGame.getState().takeDamage(20);
    expect(useGame.getState().health).toBe(max() - 20);
    standAt(max() * LAST_STAND.below);
    useGame.getState().takeDamage(10);
    expect(useGame.getState().health).toBeCloseTo(max() * LAST_STAND.below - 10 * LAST_STAND.damageMult, 9);
    // The HUD hears what was really lost.
    expect(hurt).toEqual([{ amount: 20 }, { amount: 10 * LAST_STAND.damageMult }]);
  });

  test("a killing blow from half health leaves you on 1, and the Brink's window holds", () => {
    standAt(max() * 0.8);
    const brinks = heard("wizardBrink");
    useGame.getState().takeDamage(10_000);
    expect(useGame.getState().health).toBe(LETHAL_GRACE.leaves);
    expect(brinks).toEqual([{ from: max() * 0.8, max: max() }]);
    expect(brinkLeft()).toBeGreaterThan(BRINK_WINDOW_S - 0.1);
    // Inside the window nothing lands.
    useGame.getState().takeDamage(10_000);
    expect(useGame.getState().health).toBe(LETHAL_GRACE.leaves);
    expect(useGame.getState().phase).toBe("village");
  });

  test("heals are heard, with where they came from", () => {
    standAt(10);
    const healed = heard("wizardHealed");
    useGame.getState().heal(40);
    expect(healed).toEqual([{ from: 10, to: 50, max: max() }]);
    standAt(max());
    useGame.getState().heal(5);
    expect(healed.length).toBe(1);
  });
});
