import { useEffect, useState, type CSSProperties } from "react";
import { gameEvents } from "../../core/events";

/** Red vignette pulse on every hit taken. Each hit bumps the React key, which
 * remounts the div and restarts the `wm-hurt` fade (see theme.ts globalCss). */
export function HurtFlash() {
  const [flashId, setFlashId] = useState(0);
  useEffect(
    () => gameEvents.on("playerHurt", () => setFlashId((n) => n + 1)),
    [],
  );
  if (flashId === 0) return null;
  return <div key={flashId} className="wm-hurt" style={hurtStyle} />;
}

const hurtStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  boxShadow: "inset 0 0 120px 40px rgba(180,20,20,0.55)",
};
