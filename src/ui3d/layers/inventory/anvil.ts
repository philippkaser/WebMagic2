import { create } from "zustand";
import type { SlotRef } from "../../../items/inventory";

/** What lies on Brannoc's anvil: a reference to one of your own cells (the
 * item never leaves it — the forge works it where it lies). Set by dropping
 * gear onto the forge tablet or shift-clicking it while the forge is open;
 * cleared when the forge opens afresh. */
export interface AnvilState {
  ref: SlotRef | null;
  set(ref: SlotRef | null): void;
}

export const useAnvil = create<AnvilState>((set) => ({
  ref: null,
  set: (ref) => set({ ref }),
}));
