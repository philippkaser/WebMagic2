import type { CSSProperties } from "react";
import { useGame } from "../../state/gameStore";
import { usePointerLocked } from "../hooks";
import { palette } from "../theme";

/** Lower-center callout. While the pointer is locked it shows the contextual
 * interaction prompt ("E — Descend…"); while it isn't (and no screen is
 * open) it tells you to click back in — the two never compete for the spot. */
export function InteractionPrompt() {
  const prompt = useGame((s) => s.prompt);
  const overlay = useGame((s) => s.overlay);
  const locked = usePointerLocked();
  return (
    <>
      {locked && prompt && <div style={promptStyle}>{prompt}</div>}
      {!locked && overlay === "none" && (
        <div style={promptStyle}>Click to take control — WASD move · Space jump · Mouse casts</div>
      )}
    </>
  );
}

const promptStyle: CSSProperties = {
  position: "absolute",
  bottom: "22%",
  left: "50%",
  transform: "translateX(-50%)",
  padding: "8px 16px",
  background: "rgba(8,6,12,0.75)",
  border: `1px solid ${palette.borderStrong}`,
  fontSize: 14,
  letterSpacing: 1,
  whiteSpace: "nowrap",
};
