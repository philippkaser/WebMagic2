import { describe, expect, test } from "bun:test";
import { PactBook } from "./pactBook";
import { PACT_OFFER_MS } from "./pacts";

describe("the floor's book of pacts", () => {
  test("strangers may hurt each other; an offer answered swears a pact; a break unswears it", () => {
    const book = new PactBook();
    expect(book.hostile("a", "b")).toBe(true);
    book.onMessage("a", "b", "offer", 0);
    expect(book.hostile("a", "b")).toBe(true); // an offer alone protects nobody
    book.onMessage("b", "a", "accept", 1000);
    expect(book.hostile("a", "b")).toBe(false);
    expect(book.hostile("b", "a")).toBe(false);
    book.onMessage("b", "a", "break", 2000);
    expect(book.hostile("a", "b")).toBe(true);
  });

  test("an accept nobody asked for, or too late, swears nothing", () => {
    const book = new PactBook();
    book.onMessage("b", "a", "accept", 0);
    expect(book.hostile("a", "b")).toBe(true);
    book.onMessage("a", "b", "offer", 0);
    book.onMessage("b", "a", "accept", PACT_OFFER_MS + 1);
    expect(book.hostile("a", "b")).toBe(true);
  });

  test("two offers crossing are a pact, as on both clients", () => {
    const book = new PactBook();
    book.onMessage("a", "b", "offer", 0);
    book.onMessage("b", "a", "offer", 10);
    expect(book.hostile("a", "b")).toBe(false);
  });

  test("garbage is ignored; a wizard who leaves takes their pacts along", () => {
    const book = new PactBook();
    book.onMessage("a", "a", "offer", 0);
    book.onMessage("a", 7, "offer", 0);
    book.onMessage("a", "b", "swear-forever", 0);
    expect(book.hostile("a", "b")).toBe(true);
    book.onMessage("a", "b", "offer", 0);
    book.onMessage("b", "a", "accept", 0);
    book.forget("b");
    expect(book.hostile("a", "b")).toBe(true);
    expect(book.hostile("a", "a")).toBe(false); // nobody hurts themselves
  });
});
