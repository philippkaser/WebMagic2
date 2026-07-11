import { useFrame } from "@react-three/fiber";
import { input } from "../player/input";
import { useGame } from "../state/gameStore";

/** Q/E belt hotkeys. Runs AFTER the interaction arbiter (priority 3 > 2):
 * when an interaction offer wins the frame it consumes the E press, so E
 * only drinks the belt potion when there's nothing to interact with —
 * standing at a portal never wastes a draught. Q is unconditional. */
export function ConsumableSystem() {
  useFrame(() => {
    const state = useGame.getState();
    const playing = state.phase === "dungeon" || state.phase === "village";
    if (!playing || state.overlay !== "none" || !document.pointerLockElement) {
      // Still drain buffered presses so a click back into the game doesn't
      // fire a stale Q from an overlay session.
      input.consume("KeyQ");
      input.consume("KeyE");
      return;
    }
    if (input.consume("KeyQ")) state.useBelt(0);
    if (input.consume("KeyE")) state.useBelt(1);
  }, 3);
  return null;
}
