import { gameEvents, type GameEvents } from "../../../core/events";
import { allLoreFragments } from "../../../world/lore";

/** Dev-only hooks for driving the HUD from a console or a headless browser
 * (which never holds the pointer lock and has no floor-mates):
 *
 *   __emit("bossHp", { name: "WARDEN OF THE DEEP", frac: 0.6 })
 *   __emit("loreRead", { fragmentId: __loreIds()[0] })
 *   __hudPresence(1, 6)        // one wizard, the hostile one 6 m away
 *   __hudPact("F — Offer a pact to Morgana")
 *
 * Overrides live here (not in the stores) because the encounter systems
 * rewrite those stores every frame from the real network state. */

export const devOverrides: {
  presence: { others: number; nearestHostile: number | null } | null;
  pact: string | null;
  listeners: Set<() => void>;
} = { presence: null, pact: null, listeners: new Set() };

function changed(): void {
  for (const l of devOverrides.listeners) l();
}

export function subscribeDevOverrides(l: () => void): () => void {
  devOverrides.listeners.add(l);
  return () => devOverrides.listeners.delete(l);
}

if (typeof window !== "undefined" && import.meta.env?.DEV) {
  const w = window as unknown as Record<string, unknown>;
  w.__emit = <K extends keyof GameEvents>(k: K, v: GameEvents[K]) => gameEvents.emit(k, v);
  w.__loreIds = () => allLoreFragments().map((f) => f.id);
  w.__hudPresence = (others: number | null, nearestHostile: number | null = null) => {
    devOverrides.presence = others === null ? null : { others, nearestHostile };
    changed();
  };
  w.__hudPact = (text: string | null) => {
    devOverrides.pact = text;
    changed();
  };
}
