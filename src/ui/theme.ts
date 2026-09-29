import type { CSSProperties } from "react";
import { ENCHANT_COLOR } from "../items/affixes";

/** The look shared by every DOM layer (HUD widgets, phase overlays, the
 * inventory and dev screens). Only what is used in MORE than one place lives
 * here; a style used by a single widget stays next to that widget, so this
 * file is the vocabulary new UI should reach for, not a dumping ground. */

/** The one UI face. Buttons and inputs don't inherit fonts, so they spell it
 * out themselves — always via this constant. */
export const FONT = "'Courier New', monospace";

/** Named colors for the recurring roles. One-off hues (the boss bar's blood
 * red, the dev room's green) stay inline where they're used. */
export const palette = {
  /** Base body text, inherited from the HUD root. */
  text: "#cfc6b4",
  /** Titles, headline numbers, button labels. */
  bright: "#e8dfc8",
  /** Item names and filled-slot text. */
  item: "#ded5c2",
  /** Secondary copy: stat lines, bar captions. */
  body: "#b9b0a0",
  /** Labels and captions. */
  dim: "#7d7566",
  /** Empty slots, hints, footers. */
  faint: "#55505a",
  /** Ghost / secondary button text. */
  muted: "#9a94a0",
  /** Subtitles and the ✕ close glyph. */
  lavender: "#8f86a0",
  /** Deepest caption tone (control legends, tier tags). */
  dusk: "#6d6478",
  /** The portal cyan: primary buttons, drop targets, the message rule. */
  accent: "#46ffd0",
  /** Banked gold. */
  gold: "#ffcf4d",
  /** Unbanked gold and run loot — lost on death until banked. */
  runLoot: "#c8a23c",
  /** Enchanted items (same hue the item layer uses for names). */
  enchant: ENCHANT_COLOR,
  /** Hairline panel border. */
  border: "#2f2a36",
  /** Heavier border: inputs, prompts, modal frames, the close button. */
  borderStrong: "#3f3946",
  /** Trough behind bars, belt slots and inventory cells. */
  well: "#151218",
  /** Button and input fill. */
  buttonBg: "#120e1a",
  /** Inset strips inside modal panels (detail strip, list rows). */
  inset: "#0d0a13",
  /** Empty-slot dot and idle dashed borders. */
  slotEmpty: "#3a3540",
} as const;

/** Shared style objects. `satisfies` (not a Record annotation) keeps the key
 * set exact, so a typo'd `styles.pannel` is a compile error. */
export const styles = {
  /** The full-screen, click-through layer everything else sits in. */
  root: {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    fontFamily: FONT,
    color: palette.text,
    userSelect: "none",
    zIndex: 10,
  },
  /** The framed translucent box every corner HUD widget uses. Callers spread
   * it and add their own anchor (`top/left`, `bottom/right`, …). */
  panel: {
    position: "absolute",
    padding: "10px 12px",
    background: "rgba(8,6,12,0.62)",
    border: `1px solid ${palette.border}`,
    letterSpacing: 1,
  },

  // ── Fullscreen overlay typography ──────────────────────────────────────────
  title: {
    fontSize: 52,
    letterSpacing: 10,
    color: palette.bright,
    textShadow: "0 0 18px rgba(70,255,208,0.35), 3px 3px 0 #1a1420",
  },
  subtitle: { fontSize: 18, letterSpacing: 4, color: palette.lavender, marginTop: 8 },
  blurb: { maxWidth: 460, fontSize: 14, lineHeight: 1.6, color: "#a89e8c", margin: "18px 0" },
  button: {
    fontFamily: FONT,
    fontSize: 16,
    letterSpacing: 2,
    padding: "12px 26px",
    background: palette.buttonBg,
    color: palette.bright,
    border: `1px solid ${palette.accent}`,
    cursor: "pointer",
  },

  // ── In-game modal screens (inventory family, dev room) ─────────────────────
  /** Dimmed click-catching backdrop that centers a modal panel. */
  modalBackdrop: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(5,3,9,0.78)",
    pointerEvents: "auto",
  },
  /** The ✕ in a modal header. */
  closeButton: {
    fontFamily: FONT,
    fontSize: 14,
    background: "none",
    color: palette.lavender,
    border: `1px solid ${palette.borderStrong}`,
    cursor: "pointer",
    padding: "2px 8px",
  },
} satisfies Record<string, CSSProperties>;

/** The single global stylesheet, injected once by the HUD root. Inline styles
 * can't express keyframes or :hover, so the few animations (message fade,
 * hurt flash) and the button hover live here as `wm-` classes. */
export const globalCss = `
.wm-msg { animation: wm-fade 5s forwards; padding: 3px 8px; background: rgba(8,6,12,0.55); margin-bottom: 4px; border-right: 2px solid ${palette.accent}; }
@keyframes wm-fade { 0% { opacity: 0; transform: translateX(8px);} 6% { opacity: 1; transform: none;} 80% { opacity: 1;} 100% { opacity: 0;} }
.wm-hurt { animation: wm-hurt-fade 500ms forwards; }
@keyframes wm-hurt-fade { from { opacity: 1; } to { opacity: 0; } }
button:hover { background: #1c1628 !important; }
`;
