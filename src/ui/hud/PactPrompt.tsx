import type { CSSProperties } from "react";
import { useEncounters } from "../../encounters/encounterStore";
import { usePointerLocked } from "../hooks";
import { palette } from "../theme";

/** The F-key pact prompt while standing near another wizard — just under the
 * E interaction prompt, so both choices (loot vs. trust) read at once. */
export function PactPrompt() {
  const prompt = useEncounters((s) => s.pactPrompt);
  const locked = usePointerLocked();
  if (!locked || !prompt) return null;
  return <div style={promptStyle}>{prompt}</div>;
}

const promptStyle: CSSProperties = {
  position: "absolute",
  bottom: "calc(22% - 40px)",
  left: "50%",
  transform: "translateX(-50%)",
  padding: "5px 12px",
  background: "rgba(8,6,12,0.7)",
  border: `1px solid ${palette.border}`,
  color: "#cdb8f0",
  fontSize: 12,
  letterSpacing: 1,
  whiteSpace: "nowrap",
};
