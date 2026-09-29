import { create } from "zustand";
import type { PactRelation } from "./pacts";

/** Reactive encounter state for the HUD and the renderers (name tags, peer
 * capsules). Frame-hot work stays in the systems; this store changes only
 * when something a player could see changes. */
export interface EncounterState {
  /** Our pact relation with each other wizard on the floor (absent = wary). */
  relations: Record<string, PactRelation>;
  /** The F-key prompt while standing near another wizard. */
  pactPrompt: string | null;
  /** Other wizards on the floor (poses known). */
  others: number;
  /** Distance to the nearest other wizard, if any (quantized to 1 m). */
  nearest: number | null;
  /** Distance to the nearest HOSTILE wizard, if any (quantized to 1 m). */
  nearestHostile: number | null;
}

export const useEncounters = create<EncounterState>(() => ({
  relations: {},
  pactPrompt: null,
  others: 0,
  nearest: null,
  nearestHostile: null,
}));

export function resetEncounters(): void {
  useEncounters.setState({
    relations: {},
    pactPrompt: null,
    others: 0,
    nearest: null,
    nearestHostile: null,
  });
}

// Dev-only inspection for end-to-end scripts.
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__relations = () => useEncounters.getState().relations;
}
