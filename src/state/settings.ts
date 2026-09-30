import { create } from "zustand";
import { gameEvents } from "../core/events";

/** Player preferences, persisted per browser. Kept apart from game flow so
 * the game store stays about the game. */
export interface SettingsState {
  /** Quality toggle: the staff/moon shadow costs several extra scene renders
   * per frame, so it's opt-in. */
  shadows: boolean;
  /** Display name shown to floor-mates. */
  playerName: string;
  toggleShadows(): void;
  setPlayerName(name: string): void;
}

const SHADOWS_KEY = "webmagic.shadows.v1";
const NAME_KEY = "webmagic.name.v1";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable — the setting is session-only.
  }
}

export const useSettings = create<SettingsState>((set, get) => ({
  shadows: read(SHADOWS_KEY) === "1",
  playerName: read(NAME_KEY) ?? "Wizard",

  toggleShadows: () => {
    const shadows = !get().shadows;
    set({ shadows });
    write(SHADOWS_KEY, shadows ? "1" : "0");
    gameEvents.emit("message", `Shadows ${shadows ? "on" : "off"}`);
  },

  setPlayerName: (name) => {
    const clean = name.replace(/[^\w \-']/g, "").slice(0, 16).trim() || "Wizard";
    set({ playerName: clean });
    write(NAME_KEY, clean);
  },
}));
