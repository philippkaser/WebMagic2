import { useFrame } from "@react-three/fiber";
import { input } from "../player/input";
import { useGame } from "../state/gameStore";

/** Interaction arbiter: systems near the player offer a prompt every frame
 * (portals, loot, pedestals); the closest offer wins the HUD prompt and the
 * E key. Avoids multiple systems fighting over the prompt state. */

interface Offer {
  text: string;
  action: () => void;
  distanceSq: number;
}

let offers: Offer[] = [];

export function offerInteraction(text: string, distanceSq: number, action: () => void): void {
  offers.push({ text, action, distanceSq });
}

export function InteractionSystem() {
  // Positive priority: runs after all world systems have pushed their offers.
  useFrame(() => {
    const state = useGame.getState();
    if (offers.length === 0) {
      state.setPrompt(null);
    } else {
      offers.sort((a, b) => a.distanceSq - b.distanceSq);
      const best = offers[0];
      state.setPrompt(best.text);
      if (input.consume("KeyE")) best.action();
    }
    offers = [];
  }, 2);
  return null;
}
