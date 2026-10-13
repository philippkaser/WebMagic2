import { describe, expect, test } from "bun:test";
import { FloorDirectory } from "./matchmaking";
import { CODE_ALPHABET, INVITE_TTL_MS, isPartyCode, MAX_PARTY, normalizePartyCode, PartyDirectory } from "./party";

function dir() {
  let t = 1000;
  let r = 0;
  const d = new PartyDirectory(
    () => ((r = (r * 9301 + 49297) % 233280), r / 233280),
    () => t,
  );
  return { d, advance: (ms: number) => (t += ms) };
}

describe("parties", () => {
  test("found one, share its code, others join by it (forgiving how it's typed)", () => {
    const { d } = dir();
    const p = d.create("a");
    expect(isPartyCode(p.code)).toBe(true);
    for (const c of p.code) expect(CODE_ALPHABET).toContain(c);
    const typed = `${p.code.slice(0, 3).toLowerCase()}-${p.code.slice(3)}`;
    expect(normalizePartyCode(typed)).toBe(p.code);
    const joined = d.join("b", typed);
    expect(joined).toMatchObject({ leader: "a", members: ["a", "b"] });
    expect(d.companionsOf("b")).toEqual(["a"]);
    expect(d.join("c", "ZZZZZZ")).toBe("no-such-party");
  });

  test("a party holds four", () => {
    const { d } = dir();
    const p = d.create("a");
    for (const id of ["b", "c", "d"]) d.join(id, p.code);
    expect(p.members.length).toBe(MAX_PARTY);
    expect(d.join("e", p.code)).toBe("party-full");
    expect(d.invite("a", "e")).toBe("party-full");
  });

  test("the lead passes to the longest-standing; the last out disbands it", () => {
    const { d } = dir();
    const p = d.create("a");
    d.join("b", p.code);
    d.join("c", p.code);
    expect(d.leave("a")).toMatchObject({ leader: "b", members: ["b", "c"] });
    d.leave("b");
    expect(d.leave("c")).toBeNull();
    expect(d.join("x", p.code)).toBe("no-such-party");
  });

  test("an invite founds a party if needed, and lapses", () => {
    const { d, advance } = dir();
    expect(d.invite("a", "b")).toMatchObject({ from: "a" });
    expect(d.pendingInvite("b")).toEqual({ from: "a" });
    expect(d.accept("b")).toMatchObject({ leader: "a", members: ["a", "b"] });
    expect(d.accept("b")).toBe("no-invite");
    d.invite("a", "c");
    advance(INVITE_TTL_MS + 1);
    expect(d.pendingInvite("c")).toBeNull();
    expect(d.accept("c")).toBe("no-invite");
  });

  test("joining another party leaves the old one; a disconnect forgets invites both ways", () => {
    const { d } = dir();
    const p1 = d.create("a");
    const p2 = d.create("b");
    d.join("c", p1.code);
    d.join("c", p2.code);
    expect(p1.members).toEqual(["a"]);
    expect(p2.members).toEqual(["b", "c"]);
    d.invite("a", "z");
    d.forget("a");
    expect(d.pendingInvite("z")).toBeNull();
    expect(d.partyOf("a")).toBeNull();
  });
});

describe("party-aware matchmaking", () => {
  test("a party member walks into their companion's instance, no roll", () => {
    // Dice that never meet strangers.
    const f = new FloorDirectory(4, () => 42, () => 0, () => 0.99);
    const a = f.join("a", 3);
    const stranger = f.join("s", 3);
    expect(stranger.id).not.toBe(a.id);
    const b = f.join("b", 3, { companions: ["a"] });
    expect(b.id).toBe(a.id);
    // On another floor the companion isn't there: fresh instance.
    expect(f.join("c", 4, { companions: ["a"] }).id).not.toBe(a.id);
  });

  test("a full companion instance falls back to the usual rules", () => {
    const f = new FloorDirectory(2, () => 42, () => 0, () => 0.99);
    const a = f.join("a", 3);
    f.join("b", 3, { companions: ["a"] });
    expect(f.join("c", 3, { companions: ["a", "b"] }).id).not.toBe(a.id);
  });
});
