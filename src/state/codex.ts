import { create } from "zustand";
import { gameEvents } from "../core/events";
import { allLoreFragments } from "../world/lore";

/** The codex — every lore fragment this wizard has read, remembered across
 * sessions. Lore is personal knowledge, not loot: it isn't banked, can't be
 * lost on death, and lives in localStorage only (nothing to cheat, nothing
 * the server needs to know). */

const KEY = "webmagic.codex.v1";

function load(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    const known = new Set(allLoreFragments().map((f) => f.id));
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string" && known.has(id)) : [];
  } catch {
    return [];
  }
}

export interface CodexState {
  /** Fragment ids in the order they were first read. */
  read: string[];
  /** Record a reading. Returns true the first time a fragment is read. */
  markRead(fragmentId: string): boolean;
}

export const useCodex = create<CodexState>((set, get) => ({
  read: load(),
  markRead: (fragmentId) => {
    if (get().read.includes(fragmentId)) return false;
    const read = [...get().read, fragmentId];
    set({ read });
    try {
      localStorage.setItem(KEY, JSON.stringify(read));
    } catch {
      // Session-only without storage.
    }
    return true;
  },
}));

// Every reading lands in the codex, whoever displays it.
gameEvents.on("loreRead", ({ fragmentId }) => {
  useCodex.getState().markRead(fragmentId);
});
