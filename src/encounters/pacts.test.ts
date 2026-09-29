import { describe, expect, test } from "bun:test";
import {
  isHostileRelation,
  newRelation,
  PACT_OFFER_MS,
  pactPrompt,
  pactStep,
  type PactRelation,
} from "./pacts";

const press = { kind: "press" } as const;
const got = (msg: "offer" | "accept" | "break") => ({ kind: "received", msg }) as const;
const tick = { kind: "tick" } as const;

describe("pacts", () => {
  test("strangers are wary — and wary means hostile", () => {
    expect(isHostileRelation(undefined)).toBe(true);
    expect(isHostileRelation(newRelation())).toBe(true);
  });

  test("offer → accept binds both sides", () => {
    // Alice offers.
    let alice = pactStep(newRelation(), press, 0);
    expect(alice.send).toBe("offer");
    expect(alice.relation.state).toBe("offered");
    // Bob receives, is invited, presses to accept.
    let bob = pactStep(newRelation(), got("offer"), 10);
    expect(bob.relation.state).toBe("invited");
    expect(bob.notice).toBe("invited");
    bob = pactStep(bob.relation, press, 20);
    expect(bob.send).toBe("accept");
    expect(bob.relation.state).toBe("bound");
    // Alice receives the accept.
    alice = pactStep(alice.relation, got("accept"), 30);
    expect(alice.relation.state).toBe("bound");
    expect(isHostileRelation(alice.relation)).toBe(false);
    expect(isHostileRelation(bob.relation)).toBe(false);
  });

  test("offers made at the same moment become a pact", () => {
    const alice = pactStep(newRelation(), press, 0).relation;
    const step = pactStep(alice, got("offer"), 5);
    expect(step.relation.state).toBe("bound");
    expect(step.send).toBe("accept");
  });

  test("breaking is one-sided and marks the oathbreaker", () => {
    const bound: PactRelation = { state: "bound", expiresAt: 0, oathbreaker: false };
    const breaker = pactStep(bound, press, 0);
    expect(breaker.send).toBe("break");
    expect(breaker.relation.state).toBe("wary");
    const victim = pactStep(bound, got("break"), 0);
    expect(victim.relation.state).toBe("wary");
    expect(victim.relation.oathbreaker).toBe(true);
    expect(victim.notice).toBe("betrayed");
  });

  test("offers lapse when unanswered", () => {
    const offered = pactStep(newRelation(), press, 1000).relation;
    expect(pactStep(offered, tick, 1000 + PACT_OFFER_MS - 1).relation.state).toBe("offered");
    const lapsed = pactStep(offered, tick, 1000 + PACT_OFFER_MS);
    expect(lapsed.relation.state).toBe("wary");
    expect(lapsed.notice).toBe("lapsed");
    const invited = pactStep(newRelation(), got("offer"), 0).relation;
    expect(pactStep(invited, tick, PACT_OFFER_MS).relation.state).toBe("wary");
  });

  test("unsolicited accepts and stray breaks change nothing", () => {
    expect(pactStep(newRelation(), got("accept"), 0).relation.state).toBe("wary");
    expect(pactStep(newRelation(), got("break"), 0).relation.state).toBe("wary");
    expect(pactStep(newRelation(), got("break"), 0).relation.oathbreaker).toBe(false);
  });

  test("prompts follow the relation", () => {
    expect(pactPrompt(undefined, "Mira")).toContain("Offer Mira");
    expect(pactPrompt({ state: "invited", expiresAt: 0, oathbreaker: false }, "Mira")).toContain("Accept");
    expect(pactPrompt({ state: "bound", expiresAt: 0, oathbreaker: false }, "Mira")).toContain("Break");
  });
});
