import type { CSSProperties, ReactNode } from "react";

/** The fullscreen frame every phase overlay sits in: an opaque-ish veil over
 * the scene that re-enables pointer events (the HUD root is click-through)
 * and centers its children in a column. Not called `Overlay` because that
 * name is already the store's in-game screen type. */
export function OverlayShell({ children }: { children: ReactNode }) {
  return <div style={shellStyle}>{children}</div>;
}

const shellStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(5,3,9,0.88)",
  pointerEvents: "auto",
  textAlign: "center",
  padding: 24,
};
