import { useFrame } from "@react-three/fiber";
import { input } from "../player/input";
import { useGame } from "../state/gameStore";

/** Interaction arbiter: systems near the player offer a prompt every frame
 * (portals, loot, pedestals); the closest offer wins the prompt and the E
 * key. Avoids multiple systems fighting over the prompt state.
 *
 * `at` is where the prompt belongs in the world (just above the thing it's
 * about) — the in-world UI floats the words there instead of pinning them
 * to the screen. Omitted, the prompt hangs in front of the player. */

export type PromptAnchor = [number, number, number];

interface Offer {
  text: string;
  action: () => void;
  distanceSq: number;
  at: PromptAnchor | null;
}

let offers: Offer[] = [];

export function offerInteraction(
  text: string,
  distanceSq: number,
  action: () => void,
  at?: PromptAnchor,
): void {
  offers.push({ text, action, distanceSq, at: at ?? null });
}

export function InteractionSystem() {
  // Positive priority: runs after all world systems have pushed their offers.
  useFrame(() => {
    const state = useGame.getState();
    if (offers.length === 0) {
      state.setPrompt(null, null);
    } else {
      offers.sort((a, b) => a.distanceSq - b.distanceSq);
      const best = offers[0];
      state.setPrompt(best.text, best.at);
      if (input.consume("KeyE")) best.action();
    }
    offers = [];
  }, 2);
  return null;
}
