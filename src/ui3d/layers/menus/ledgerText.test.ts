import { describe, expect, test } from "bun:test";
import type { AuthErrorReason } from "../../../net/credentials";
import { secretGlyphs } from "../../RuneField";
import { GUEST_LEFT_BEHIND, ledgerErrorText, ledgerForm, ledgerLine, OFFER_LABEL, waitText } from "./ledgerText";
import { MENU_INK, spansText } from "./menuText";

describe("the Wizard's Ledger in words", () => {
  const online = { mode: "online" as const, lapsed: false, username: null };

  test("the line under the title says who you are and offers what fits", () => {
    expect(ledgerLine({ ...online, status: "anonymous" }).offers).toEqual(["signIn", "register"]);
    // A guest is steered to claim (keeping the wizard) before signing in.
    expect(ledgerLine({ ...online, status: "guest" }).offers).toEqual(["claim", "signIn"]);
    const member = ledgerLine({ ...online, status: "member", username: "Orla" });
    expect(spansText(member.text)).toBe("IN THE LEDGER AS ORLA");
    expect(member.offers).toEqual(["signOut"]);
    expect(ledgerLine({ ...online, status: "unknown" }).offers).toEqual([]);
  });

  test("offline the ledger is shut: no sign-in, only a knock on the door", () => {
    const line = ledgerLine({ ...online, mode: "offline", status: "guest" });
    expect(line.offers).toEqual(["retry"]);
    expect(spansText(line.text)).toContain("OFFLINE");
  });

  test("a lapsed sign-in is said in blood-red, with the way back in", () => {
    const line = ledgerLine({ ...online, status: "anonymous", lapsed: true });
    expect(line.text[0]!.color).toBe(MENU_INK.wound);
    expect(line.offers).toContain("signIn");
  });

  test("every offer and form has words; the forms point at each other", () => {
    for (const label of Object.values(OFFER_LABEL)) expect(label.length).toBeGreaterThan(0);
    expect(ledgerForm("signIn").alternative?.mode).toBe("register");
    expect(ledgerForm("register").alternative?.mode).toBe("signIn");
    expect(ledgerForm("claim").alternative).toBeNull();
    expect(ledgerForm("register").hint).toContain("3–16");
    expect(GUEST_LEFT_BEHIND).toContain("claim");
  });

  test("every refusal has its own sentence", () => {
    const reasons: AuthErrorReason[] = [
      "bad-username",
      "bad-password",
      "username-taken",
      "bad-credentials",
      "rate-limited",
      "already-claimed",
      "no-wizard",
      "in-dungeon",
      "busy",
      "session-expired",
      "offline",
      "server-error",
    ];
    const texts = reasons.map((r) => ledgerErrorText(r, 4000));
    expect(new Set(texts).size).toBe(reasons.length);
    expect(ledgerErrorText("rate-limited", 4000)).toContain("4 s");
    expect(waitText(150_000)).toBe("3 min");
    expect(waitText(0)).toBe("1 s");
  });

  test("a secret shows • per letter, the newest as ✦ while it is written", () => {
    expect(secretGlyphs(0, true)).toBe("");
    expect(secretGlyphs(3, false)).toBe("•••");
    expect(secretGlyphs(3, true)).toBe("••✦");
  });
});
