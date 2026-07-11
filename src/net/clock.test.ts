import { describe, expect, test } from "bun:test";
import { NetClock } from "./clock";

describe("NetClock", () => {
  test("estimates a constant offset from symmetric pongs", () => {
    let local = 10_000;
    const clock = new NetClock(() => local);
    const serverAhead = 5_000;
    // ping at t, pong arrives 40ms later stamped with server time at midpoint
    for (let i = 0; i < 5; i++) {
      const sent = local;
      local += 40;
      clock.onPong(sent, sent + 20 + serverAhead);
    }
    expect(clock.synced).toBe(true);
    expect(clock.serverNow()).toBeCloseTo(local + serverAhead, -1);
  });

  test("prefers low-RTT samples over congested ones", () => {
    let local = 0;
    const clock = new NetClock(() => local);
    // Clean sample: rtt 20, true offset 1000.
    local = 20;
    clock.onPong(0, 10 + 1000);
    const clean = clock.serverNow() - local;
    // Congested sample: rtt 400 with asymmetric delay (bogus offset).
    const sent = local;
    local += 400;
    clock.onPong(sent, sent + 390 + 1000);
    // Best (lowest-RTT) sample still dominates.
    expect(Math.abs(clock.serverNow() - local - clean)).toBeLessThan(80);
  });

  test("reset forgets the sync", () => {
    const clock = new NetClock(() => 0);
    clock.onPong(0, 500);
    clock.reset();
    expect(clock.synced).toBe(false);
    expect(clock.serverNow()).toBe(0);
  });
});
