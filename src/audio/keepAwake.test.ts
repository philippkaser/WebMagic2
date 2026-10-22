import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { keepAwake } from "./keepAwake";

/** The keeper against a stand-in context whose device can go away: the
 * browser stops it, and it's brought back — the reason a player's sound
 * once vanished for good. */

class FakeContext {
  state = "running";
  /** While false, resume() refuses (the headphones are off). */
  deviceUp = true;
  resumes = 0;
  private ls: (() => void)[] = [];
  addEventListener(_type: "statechange", fn: () => void): void {
    this.ls.push(fn);
  }
  resume(): Promise<void> {
    this.resumes++;
    if (!this.deviceUp) return Promise.reject(new Error("no device"));
    this.set("running");
    return Promise.resolve();
  }
  /** The browser stops it (a device error, an interruption). */
  set(state: string): void {
    this.state = state;
    for (const fn of this.ls) fn();
  }
}

let c: FakeContext;
let pageBack: () => void;
const keep = () => keepAwake(c, (wake) => (pageBack = wake));

/** Let resume()'s promise settle and any due retry fire. */
async function flush(ms = 0): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  if (ms) jest.advanceTimersByTime(ms);
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  c = new FakeContext();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("keeping the sound on", () => {
  test("a context that starts suspended is resumed by the first wake", async () => {
    c.state = "suspended";
    const k = keep();
    expect(k.running()).toBe(false);
    k.wake();
    await flush();
    expect(k.running()).toBe(true);
  });

  test("stopped by the browser, it's brought back without a gesture", async () => {
    const k = keep();
    c.set("suspended");
    expect(k.running()).toBe(false); // no sound is built while it's stopped
    await flush(250);
    expect(k.running()).toBe(true);
  });

  test("while the device is gone it keeps trying, backing off, and comes back when it returns", async () => {
    const k = keep();
    c.deviceUp = false;
    c.set("suspended");
    // 250, 500, 1000, 2000, 4000, 4000 … ms between tries: no tight loop.
    for (const wait of [250, 500, 1000, 2000, 4000, 4000]) await flush(wait);
    expect(c.resumes).toBe(6);
    expect(k.running()).toBe(false);
    c.deviceUp = true;
    await flush(4000);
    expect(k.running()).toBe(true);
  });

  test("the backoff starts over once it's running again", async () => {
    keep();
    c.deviceUp = false;
    c.set("suspended");
    for (const wait of [250, 500, 1000]) await flush(wait);
    c.deviceUp = true;
    await flush(2000);
    expect(c.state).toBe("running");
    c.resumes = 0;
    c.set("suspended");
    await flush(250);
    expect(c.resumes).toBe(1);
    expect(c.state).toBe("running");
  });

  test("Safari's 'interrupted' counts as stopped, and coming back to the page wakes it", async () => {
    const k = keep();
    c.deviceUp = false;
    c.set("interrupted");
    expect(k.running()).toBe(false);
    c.deviceUp = true;
    pageBack();
    await flush();
    expect(k.running()).toBe(true);
  });

  test("a gesture wakes it at once, and costs nothing while it runs", async () => {
    const k = keep();
    k.wake();
    expect(c.resumes).toBe(0);
    c.deviceUp = false;
    c.set("suspended");
    c.deviceUp = true;
    k.wake(); // what every click and key calls
    await flush();
    expect(k.running()).toBe(true);
  });

  test("a closed context is left alone", async () => {
    keep();
    c.set("closed");
    await flush(4000);
    expect(c.resumes).toBe(0);
  });
});
