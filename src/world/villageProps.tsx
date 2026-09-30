import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Group } from "three";
import { addLightSource, removeLightSource } from "../fx/DynamicLights";
import { offerInteraction } from "../game/interactions";
import { playerPosition } from "../game/player-state";
import { ChestModel, MerchantStallModel } from "../render/models/VillageModels";
import { useGame } from "../state/gameStore";
import type { Vec3 } from "./types";

/** Village-only fixtures: the player's storage chest and the merchant stall.
 * Both just open a HUD overlay; every rule about what can move where lives in
 * the game store (and is re-checked server-side). Their looks live in
 * render/models/VillageModels — this file is prompts, the lantern light and
 * the idle animation. */

function useOverlayInteraction(
  position: Vec3,
  prompt: string,
  overlay: "chest" | "merchant",
): void {
  useFrame(() => {
    const d2 =
      (playerPosition.x - position[0]) ** 2 + (playerPosition.z - position[2]) ** 2;
    if (d2 < 7) {
      offerInteraction(
        prompt,
        d2,
        () => {
          document.exitPointerLock();
          useGame.getState().setOverlay(overlay);
        },
        [position[0], position[1] + 2, position[2]],
      );
    }
  });
}

/** The wizard's own chest: 30 banked slots, always safe, only in the village. */
export function StorageChest({ position, rotation = 0 }: { position: Vec3; rotation?: number }) {
  const lidTilt = useRef(0);
  const lid = useRef<Group>(null);
  useOverlayInteraction(position, "E — Open your chest", "chest");

  // The lid creaks open as its owner approaches — a small "it's yours" touch.
  useFrame((_, dt) => {
    const d2 =
      (playerPosition.x - position[0]) ** 2 + (playerPosition.z - position[2]) ** 2;
    const target = d2 < 7 ? -0.55 : 0;
    lidTilt.current += (target - lidTilt.current) * Math.min(1, dt * 6);
    if (lid.current) lid.current.rotation.x = lidTilt.current;
  });

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <ChestModel lidRef={lid} />
    </group>
  );
}

/** Maro the Provisioner: robed like every wizard here, but he stopped
 * descending years ago. Sells potions and feathers — pricy, and he knows it. */
export function Merchant({ position, rotation = 0 }: { position: Vec3; rotation?: number }) {
  const body = useRef<Group>(null);
  useOverlayInteraction(position, "E — Trade with Maro the Provisioner", "merchant");

  useEffect(() => {
    const src = addLightSource({
      position: [position[0], position[1] + 1.9, position[2] + 0.6],
      color: "#ffb45e",
      intensity: 5,
      distance: 8,
      priority: 1,
    });
    return () => removeLightSource(src);
  }, [position]);

  // A slow idle sway — he's alive, just unhurried.
  useFrame(({ clock }) => {
    if (body.current) {
      body.current.rotation.z = Math.sin(clock.elapsedTime * 0.8) * 0.03;
      body.current.position.y = Math.sin(clock.elapsedTime * 1.7) * 0.015;
    }
  });

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <MerchantStallModel bodyRef={body} />
    </group>
  );
}
