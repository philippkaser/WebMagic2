import { describe, expect, test } from "bun:test";
import { createTraveler, type TravelDeps } from "./travel";
import { TRAVEL_STYLES, type TravelKind, type TravelStage } from "./timeline";

/** A fake clock: sleep() advances time instantly, settle() is a no-op, and
 * every stage change is recorded with the time it happened. */
function harness(opts: { settleMs?: number } = {}) {
  let t = 0;
  const log: { stage: TravelStage; kind: TravelKind; at: number }[] = [];
  const deps: TravelDeps = {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    settle: async () => {
      t += opts.settleMs ?? 0;
    },
    setStage: (stage, kind) => {
      log.push({ stage, kind, at: t });
    },
  };
  return { traveler: createTraveler(deps), log, time: () => t, advance: (ms: number) => (t += ms) };
}

describe("travel", () => {
  test("plays ENTER → TUNNEL → ARRIVE → idle, switching under the tunnel", async () => {
    const h = harness();
    let switchedIn: TravelStage | null = null;
    await h.traveler.travel("descend", () => {
      switchedIn = h.log.at(-1)!.stage;
    });
    expect(switchedIn as TravelStage | null).toBe("tunnel");
    expect(h.log.map((e) => e.stage)).toEqual(["entering", "tunnel", "arriving", "idle"]);
  });

  test("the tunnel lasts at least one beat even when the switch is instant", async () => {
    const h = harness();
    await h.traveler.travel("gate", () => {});
    const tunnel = h.log.find((e) => e.stage === "tunnel")!;
    const arriving = h.log.find((e) => e.stage === "arriving")!;
    expect(arriving.at - tunnel.at).toBe(TRAVEL_STYLES.gate.minTunnelMs);
  });

  test("a slow switch simply holds the tunnel (no extra beat on top)", async () => {
    const h = harness();
    await h.traveler.travel("descend", async () => {
      h.advance(3000); // a slow network round trip
    });
    const tunnel = h.log.find((e) => e.stage === "tunnel")!;
    const arriving = h.log.find((e) => e.stage === "arriving")!;
    expect(arriving.at - tunnel.at).toBe(3000);
  });

  test("the whole journey adds a modest, bounded delay", async () => {
    for (const kind of Object.keys(TRAVEL_STYLES) as TravelKind[]) {
      const h = harness();
      await h.traveler.travel(kind, () => {});
      expect(h.time()).toBeLessThan(2000);
    }
  });

  test("isTraveling covers ENTER and TUNNEL, not ARRIVE", async () => {
    const h = harness();
    const seen: boolean[] = [];
    await h.traveler.travel("home", () => {
      seen.push(h.traveler.isTraveling());
    });
    expect(seen).toEqual([true]);
    expect(h.traveler.isTraveling()).toBe(false);
  });

  test("a failed switch drops back to idle and rethrows", async () => {
    const h = harness();
    await expect(
      h.traveler.travel("descend", async () => {
        throw new Error("no floor for you");
      }),
    ).rejects.toThrow("no floor for you");
    expect(h.log.at(-1)!.stage).toBe("idle");
    expect(h.traveler.isTraveling()).toBe(false);
  });

  test("a switch requested mid-journey still runs (logic beats presentation)", async () => {
    const h = harness();
    let inner = false;
    await h.traveler.travel("descend", async () => {
      await h.traveler.travel("death", () => {
        inner = true;
      });
    });
    expect(inner).toBe(true);
    // The nested call played no visuals of its own.
    expect(h.log.filter((e) => e.stage === "entering").length).toBe(1);
  });

  test("a new journey may cut an ARRIVE short; the old one doesn't reset it", async () => {
    // Real timers here: the two journeys must overlap in time.
    let t = 0;
    const log: TravelStage[] = [];
    const pending: { at: number; resolve: () => void }[] = [];
    const deps: TravelDeps = {
      now: () => t,
      sleep: (ms) =>
        new Promise((resolve) => {
          pending.push({ at: t + ms, resolve });
        }),
      settle: async () => {},
      setStage: (stage) => {
        log.push(stage);
      },
    };
    const tr = createTraveler(deps);
    const step = async () => {
      pending.sort((a, b) => a.at - b.at);
      const next = pending.shift();
      if (!next) return false;
      t = next.at;
      next.resolve();
      await new Promise((r) => setTimeout(r, 0));
      return true;
    };
    const first = tr.travel("descend", () => {});
    await new Promise((r) => setTimeout(r, 0));
    while (log.at(-1) !== "arriving") await step();
    // Mid-ARRIVE, something else starts a journey (e.g. a death).
    const second = tr.travel("death", () => {});
    while (await step()) {
      /* drain */
    }
    await Promise.all([first, second]);
    // The first journey's late "idle" never lands on top of the second's.
    expect(log).toEqual(["entering", "tunnel", "arriving", "entering", "tunnel", "arriving", "idle"]);
  });
});
