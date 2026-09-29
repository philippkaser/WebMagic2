import type { CSSProperties } from "react";

/** Dead-center aim dot. Spells fire along the camera ray, so this is exactly
 * where they go. */
export function Crosshair() {
  return <div style={crosshairStyle} />;
}

const crosshairStyle: CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  width: 6,
  height: 6,
  marginLeft: -3,
  marginTop: -3,
  borderRadius: "50%",
  background: "rgba(240,235,220,0.85)",
  boxShadow: "0 0 4px rgba(0,0,0,0.9)",
};
