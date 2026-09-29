import type { CSSProperties } from "react";
import { useEncounters } from "../../encounters/encounterStore";
import { useGame } from "../../state/gameStore";
import { palette } from "../theme";

/** The presence sense: a single eye under the crosshair's horizon line that
 * opens when another wizard shares your floor and burns redder the closer a
 * HOSTILE one comes. It never says who, where, or exactly how many — only
 * how uneasy to be. A sworn ally's presence reads as a calm green glint. */
export function PresenceSense() {
  const phase = useGame((s) => s.phase);
  const others = useEncounters((s) => s.others);
  const nearestHostile = useEncounters((s) => s.nearestHostile);
  if (phase !== "dungeon" || others === 0) return null;

  const threat = nearestHostile === null ? 0 : Math.max(0, 1 - nearestHostile / 40);
  const color = nearestHostile === null ? "#8fe3a0" : mix("#b9a0d8", "#ff4a3a", threat);
  const text =
    nearestHostile === null
      ? "an ally walks this floor"
      : threat > 0.7
        ? "they are close"
        : threat > 0.35
          ? "something is near"
          : "you are not alone";

  return (
    <div style={wrapStyle}>
      <span
        className="wm-presence"
        style={{
          color,
          textShadow: `0 0 ${6 + threat * 14}px ${color}`,
          animationDuration: `${2.4 - threat * 1.8}s`,
        }}
      >
        ◉
      </span>
      <span style={{ fontSize: 11, color: palette.dim, letterSpacing: 2 }}>{text}</span>
    </div>
  );
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) =>
    Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

const wrapStyle: CSSProperties = {
  position: "absolute",
  top: 64,
  left: "50%",
  transform: "translateX(-50%)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 2,
  fontSize: 18,
};
