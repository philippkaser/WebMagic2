import { floorsUntilExit, RUN } from "../../../run/rules";
import { biomeForFloor, getBiomeDef } from "../../../world/biomes";
import { getOmenDef, rollOmen } from "../../../world/omens";
import { ink } from "../../theme";

/** What the HUD SAYS — every string and colour decision, pure and tested,
 * kept apart from how the pieces look. Words follow the artpass grimoire:
 * tiny caps labels, sentence-case lines, blackletter titles. */

/** The HUD's colours beyond the theme's ink (artpass's bar fills and the
 * presence moods). */
export const HUD_COLORS = {
  health: "#c42f2f",
  /** Below 30 % the fill runs brighter, as artpass's does. */
  healthLow: "#ff3a2e",
  lowText: "#ff6a5a",
  mana: "#3f7fe6",
  boss: "#ff9a84",
  bossFill: "#b3261a",
  omen: "#ff8f6a",
  /** The presence eye: a stranger far (violet) → close (blood), an ally. */
  wary: ink.violet,
  hostile: "#ff4a5a",
  ally: ink.ally,
} as const;

/** "87 / 100": the current value rounds UP (a sliver of health is still
 * alive), the max to the nearest point. */
export function vitalText(value: number, max: number): string {
  return `${Math.max(0, Math.ceil(value - 1e-6))} / ${Math.round(max)}`;
}

/** How many coins a heap of `gold` shows: logarithmic, so the heap grows
 * with every early find but a fortune doesn't bury the screen. */
export function coinsFor(gold: number, max = 34): number {
  if (gold <= 0) return 0;
  return Math.min(max, Math.max(1, Math.round(Math.log2(1 + gold) * 2.6)));
}

/** The five runes of the Tithe: which are kindled. */
export function titheStones(floorsPlayed: number): boolean[] {
  const owed = floorsUntilExit(floorsPlayed);
  const lit = RUN.floorsBeforeExit - owed;
  return Array.from({ length: RUN.floorsBeforeExit }, (_, i) => i < lit);
}

export type RuneState = "dark" | "done" | "now" | "home";

/** Each rune's look on the location panel (artpass RunTrack): floors behind
 * you are kindled, the one you stand on pulses, the rest are dark — and
 * once the way home is open, all five burn gold. */
export function titheRunes(floorsPlayed: number): RuneState[] {
  const home = floorsUntilExit(floorsPlayed) === 0;
  return titheStones(floorsPlayed).map((lit, i) => (home ? "home" : !lit ? "dark" : i === floorsPlayed - 1 ? "now" : "done"));
}

/** The Tithe in words, under its runes. */
export function titheLine(floorsPlayed: number): string {
  const owed = floorsUntilExit(floorsPlayed);
  return owed === 0 ? "✦ The way home is open" : `Survive ${owed} more to open the way home`;
}

export type NetMode = "connecting" | "online" | "offline";

/** The connection mark on the location panel. */
export function netStatus(mode: NetMode, amHost: boolean, inDungeon: boolean): { text: string; color: string } {
  if (mode === "online") return { text: `◉ online${amHost && inDungeon ? " · host" : ""}`, color: ink.ally };
  if (mode === "offline") return { text: "○ offline", color: ink.faded };
  return { text: "◌ connecting", color: ink.faded };
}

export interface ArrivalTitle {
  /** Tiny caps above the title ("You descend to", "Sanctuary"). */
  label: string;
  /** Blackletter: "Floor 12", "The Village". */
  title: string;
  /** The biome, in gold blackletter (none in the village). */
  subtitle: string | null;
  /** One line of lore under the divider. */
  lore: string;
  omen: { name: string; whisper: string } | null;
}

export const VILLAGE_LORE = "Lamplight, woodsmoke, and the low hum of the rift.";

/** What materializes ahead of you on arrival (artpass ArrivalBanner). */
export function arrivalTitle(inDungeon: boolean, floor: number, seed: number): ArrivalTitle {
  if (!inDungeon) return { label: "Sanctuary", title: "The Village", subtitle: null, lore: VILLAGE_LORE, omen: null };
  const omenId = seed ? rollOmen(seed, floor) : null;
  const omen = omenId ? getOmenDef(omenId) : null;
  const biome = getBiomeDef(biomeForFloor(floor));
  return {
    label: "You descend to",
    title: `Floor ${floor}`,
    subtitle: biome.name,
    lore: biome.epithet,
    omen: omen ? { name: omen.name, whisper: omen.whisper } : null,
  };
}

/** Words that stay lowercase inside a title. */
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "for", "in", "of", "on", "or", "the", "to"]);

/** A name shouted in caps ("WARDEN OF THE DEEP") as a blackletter title
 * wants it: "Warden of the Deep". Mixed-case names pass through. */
export function bossTitle(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .split(" ")
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** The presence sense's mood: how open the eye is, how red, and the one
 * line it whispers. It never says who, where, or how many. */
export function presenceMood(
  others: number,
  nearestHostile: number | null,
): { open: number; threat: number; color: string; line: string; ally: boolean } {
  if (others <= 0) return { open: 0, threat: 0, color: ink.brass, line: "", ally: false };
  if (nearestHostile === null) {
    return { open: 0.6, threat: 0, color: HUD_COLORS.ally, line: "An ally walks with you", ally: true };
  }
  const threat = Math.max(0, Math.min(1, 1 - nearestHostile / 40));
  const line = threat > 0.7 ? "It is close" : threat > 0.35 ? "It draws nearer…" : "Something else walks these halls";
  return { open: 0.7 + threat * 0.3, threat, color: mixHex(HUD_COLORS.wary, HUD_COLORS.hostile, threat), line, ally: false };
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
