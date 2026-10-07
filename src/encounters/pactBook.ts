import { PACT_OFFER_MS, type PactWire } from "./pacts";

/** The floor's own view of the pacts between its wizards — what a floor
 * host on the server needs to decide whose spells may hurt whom.
 *
 * Each wizard's client keeps its own relations (pacts.ts, PactSystem) from
 * the pact messages the two exchange. The server hears the same messages
 * (the router relays every peer message to its floor host) and keeps one
 * verdict per pair: SWORN only once one offered and the other accepted —
 * or both offered at once — and unsworn the moment either breaks it. Until
 * sworn, two wizards may hurt each other: the same default as the clients
 * (pacts.ts isHostileRelation). An offer lapses after PACT_OFFER_MS, as it
 * does on the offerer's side. Pure; time is injected. */
export class PactBook {
  /** Sworn pairs ("a|b", ids sorted). */
  private readonly sworn = new Set<string>();
  /** Standing offers: "from>to" → when it lapses (ms). */
  private readonly offers = new Map<string, number>();

  /** `from` sent `to` a pact message (untrusted: anything but the three
   * kinds is ignored). */
  onMessage(from: string, to: unknown, kind: unknown, now: number): void {
    if (typeof to !== "string" || to === from) return;
    const wire = kind as PactWire;
    const theirs = `${to}>${from}`;
    const theirOffer = (this.offers.get(theirs) ?? -Infinity) > now;
    switch (wire) {
      case "offer":
        // Both reached out at once — that's a pact (as on both clients).
        if (theirOffer) this.swear(from, to);
        else this.offers.set(`${from}>${to}`, now + PACT_OFFER_MS);
        return;
      case "accept":
        // Only an answer to a standing offer counts.
        if (theirOffer) this.swear(from, to);
        return;
      case "break":
        this.sworn.delete(pairKey(from, to));
        this.offers.delete(`${from}>${to}`);
        this.offers.delete(theirs);
        return;
    }
  }

  /** May these two wizards hurt each other? (Yes, unless sworn.) */
  hostile(a: string, b: string): boolean {
    return a !== b && !this.sworn.has(pairKey(a, b));
  }

  /** A wizard left the floor: their pacts don't follow them. */
  forget(id: string): void {
    for (const key of [...this.sworn]) if (key.split("|").includes(id)) this.sworn.delete(key);
    for (const key of [...this.offers.keys()]) if (key.split(">").includes(id)) this.offers.delete(key);
  }

  private swear(a: string, b: string): void {
    this.sworn.add(pairKey(a, b));
    this.offers.delete(`${a}>${b}`);
    this.offers.delete(`${b}>${a}`);
  }
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
