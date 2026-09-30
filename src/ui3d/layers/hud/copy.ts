import { floorsUntilExit, RUN } from "../../../run/rules";
import { biomeForFloor, getBiomeDef } from "../../../world/biomes";
import { getOmenDef, rollOmen } from "../../../world/omens";

/** What the HUD SAYS — every string and colour decision, pure and tested,
 * kept apart from how the pieces look. */

/** The HUD's colours beyond ui/theme.ts's palette. */
export const HUD_COLORS = {
  health: "#ff3b3b",
  healthDeep: "#4a0508",
  mana: "#3f8cff",
  manaDeep: "#061640",
  online: "#4fd08a",
  boss: "#ff6a52",
  lore: "#b89cff",
  pact: "#cdb8f0",
  ally: "#8fe3a0",
  wary: "#b9a0d8",
  hostile: "#ff4a3a",
} as const;

/** "87" over "/100": the current value rounds UP (a sliver of health is
 * still alive), the max to the nearest point. */
export function vitalNumbers(value: number, max: number): { now: string; max: string } {
  return { now: String(Math.max(0, Math.ceil(value - 1e-6))), max: `/${Math.round(max)}` };
}

/** How many coins a heap of `gold` shows: logarithmic, so the heap grows
 * with every early find but a fortune doesn't bury the screen. */
export function coinsFor(gold: number, max = 34): number {
  if (gold <= 0) return 0;
  return Math.min(max, Math.max(1, Math.round(Math.log2(1 + gold) * 2.6)));
}

/** The five rune-stones of the Tithe: which are kindled. */
export function titheStones(floorsPlayed: number): boolean[] {
  const owed = floorsUntilExit(floorsPlayed);
  const lit = RUN.floorsBeforeExit - owed;
  return Array.from({ length: RUN.floorsBeforeExit }, (_, i) => i < lit);
}

/** The Tithe in two words, beside its stones on the plaque. */
export function titheShort(floorsPlayed: number): string {
  const owed = floorsUntilExit(floorsPlayed);
  return owed === 0 ? "home is open" : `${owed} more`;
}

export type NetMode = "connecting" | "online" | "offline";

/** The connection mark on the location plaque. */
export function netStatus(mode: NetMode, amHost: boolean, inDungeon: boolean): { text: string; color: string } {
  if (mode === "online") return { text: `◉ online${amHost && inDungeon ? " · host" : ""}`, color: HUD_COLORS.online };
  if (mode === "offline") return { text: "○ offline", color: "#7d7566" };
  return { text: "· connecting", color: "#9a94a0" };
}

export interface ArrivalTitle {
  title: string;
  subtitle: string;
  omen: { name: string; whisper: string } | null;
}

/** What materializes ahead of you on arrival. */
export function arrivalTitle(inDungeon: boolean, floor: number, seed: number, deepest: number): ArrivalTitle {
  if (!inDungeon) {
    return {
      title: "THE VILLAGE",
      subtitle: deepest > 0 ? `deepest: floor ${deepest}` : "the deep has not yet had you",
      omen: null,
    };
  }
  const omenId = seed ? rollOmen(seed, floor) : null;
  const omen = omenId ? getOmenDef(omenId) : null;
  return {
    title: `FLOOR ${floor}`,
    subtitle: getBiomeDef(biomeForFloor(floor)).name,
    omen: omen ? { name: omen.name, whisper: omen.whisper } : null,
  };
}

/** The presence sense's mood: how open the eye is, how red, and the one
 * line it whispers. It never says who, where, or how many. */
export function presenceMood(
  others: number,
  nearestHostile: number | null,
): { open: number; threat: number; color: string; line: string; ally: boolean } {
  if (others <= 0) return { open: 0, threat: 0, color: HUD_COLORS.wary, line: "", ally: false };
  if (nearestHostile === null) {
    return { open: 0.45, threat: 0, color: HUD_COLORS.ally, line: "an ally walks this floor", ally: true };
  }
  const threat = Math.max(0, Math.min(1, 1 - nearestHostile / 40));
  const line = threat > 0.7 ? "they are close" : threat > 0.35 ? "something is near" : "you are not alone";
  return { open: 0.35 + threat * 0.65, threat, color: mixHex(HUD_COLORS.wary, HUD_COLORS.hostile, threat), line, ally: false };
}

/** Linear mix of two #rrggbb colours → #rrggbb. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const k = Math.max(0, Math.min(1, t));
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - k) + ((pb >> shift) & 255) * k);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

/** Heartbeat of the presence sense, beats per minute: resting when an ally
 * or a distant stranger, racing as a hostile wizard closes in. */
export function heartRate(threat: number): number {
  return 54 + Math.max(0, Math.min(1, threat)) * 96;
}

/** "Lub-dub" pulse, 0..1, at time `t` seconds for `bpm`. Two bumps per beat:
 * a strong one, then a softer echo a fifth of a beat later. */
export function heartbeat(t: number, bpm: number): number {
  const period = 60 / Math.max(1, bpm);
  const p = (((t % period) + period) % period) / period;
  const bump = (x: number, at: number, w: number) => Math.exp(-(((x - at) / w) ** 2));
  return Math.min(1, bump(p, 0.05, 0.05) + bump(p, 0.25, 0.05) * 0.6);
}
