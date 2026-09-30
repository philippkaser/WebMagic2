import { useGame } from "../../state/gameStore";
import { KeyCap, Panel } from "../components/Panel";
import { usePointerLocked } from "../hooks";

/** Bottom-centre: the contextual interaction ("E — Descend…" becomes a key
 * cap and the action), or the click-to-play hint when the pointer is free. */
export function Prompt() {
  const prompt = useGame((s) => s.prompt);
  const inventoryOpen = useGame((s) => s.inventoryOpen);
  const locked = usePointerLocked();
  if (inventoryOpen) return null;
  if (!locked) {
    return (
      <Panel frame="iron" className="wm-hint">
        <KeyCap k="Click" /> to take control
        <span className="wm-dim">·</span> <KeyCap k="Tab" /> satchel
      </Panel>
    );
  }
  if (!prompt) return null;
  const m = /^([A-Z]) — (.*)$/.exec(prompt);
  return (
    <Panel frame="arcane" className="wm-prompt" key={prompt}>
      {m ? (
        <>
          <KeyCap k={m[1]} big />
          <span>{m[2]}</span>
        </>
      ) : (
        <span>{prompt}</span>
      )}
    </Panel>
  );
}
