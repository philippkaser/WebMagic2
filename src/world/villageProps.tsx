import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Group } from "three";
import { addLightSource, removeLightSource } from "../fx/DynamicLights";
import { offerInteraction } from "../game/interactions";
import { playerPosition } from "../game/player-state";
import { getTextures } from "../render/textures";
import { useGame } from "../state/gameStore";
import type { Vec3 } from "./types";

/** Village-only fixtures: the player's storage chest and the merchant stall.
 * Pure presentation — both just open a HUD overlay; every rule about what
 * can move where lives in the game store (and is re-checked server-side). */

function useOverlayInteraction(
  position: Vec3,
  prompt: string,
  overlay: "chest" | "merchant",
): void {
  useFrame(() => {
    const d2 =
      (playerPosition.x - position[0]) ** 2 + (playerPosition.z - position[2]) ** 2;
    if (d2 < 7) {
      offerInteraction(prompt, d2, () => {
        document.exitPointerLock();
        useGame.getState().setOverlay(overlay);
      });
    }
  });
}

/** The wizard's own chest: 30 banked slots, always safe, only in the village. */
export function StorageChest({ position, rotation = 0 }: { position: Vec3; rotation?: number }) {
  const tex = useMemo(() => getTextures("planks"), []);
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
      {/* Body */}
      <mesh position={[0, 0.32, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.1, 0.64, 0.7]} />
        <meshStandardMaterial map={tex.map} normalMap={tex.normalMap} roughness={0.85} />
      </mesh>
      {/* Metal bands */}
      {[-0.36, 0.36].map((x) => (
        <mesh key={x} position={[x, 0.32, 0]}>
          <boxGeometry args={[0.08, 0.66, 0.72]} />
          <meshStandardMaterial color="#3a3a46" metalness={0.7} roughness={0.35} />
        </mesh>
      ))}
      {/* Lid, hinged at the back edge */}
      <group ref={lid} position={[0, 0.64, -0.35]}>
        <mesh position={[0, 0.09, 0.35]} castShadow>
          <boxGeometry args={[1.1, 0.18, 0.7]} />
          <meshStandardMaterial map={tex.map} normalMap={tex.normalMap} roughness={0.85} />
        </mesh>
      </group>
      {/* Warm glint from inside */}
      <mesh position={[0, 0.62, 0.12]}>
        <boxGeometry args={[0.9, 0.04, 0.4]} />
        <meshStandardMaterial
          color="#100800"
          emissive="#ffbf5e"
          emissiveIntensity={1.4}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/** Maro the Provisioner: robed like every wizard here, but he stopped
 * descending years ago. Sells potions and feathers — pricy, and he knows it. */
export function Merchant({ position, rotation = 0 }: { position: Vec3; rotation?: number }) {
  const tex = useMemo(() => getTextures("planks"), []);
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
      {/* Counter */}
      <mesh position={[0, 0.55, 0.9]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 0.14, 0.7]} />
        <meshStandardMaterial map={tex.map} normalMap={tex.normalMap} roughness={0.85} />
      </mesh>
      {[-1, 1].map((x) => (
        <mesh key={x} position={[x, 0.28, 0.9]} castShadow>
          <boxGeometry args={[0.14, 0.56, 0.6]} />
          <meshStandardMaterial map={tex.map} normalMap={tex.normalMap} roughness={0.9} />
        </mesh>
      ))}
      {/* Awning posts + canopy */}
      {[-1.15, 1.15].map((x) => (
        <mesh key={x} position={[x, 1.25, 1.15]} castShadow>
          <cylinderGeometry args={[0.05, 0.06, 2.5, 6]} />
          <meshStandardMaterial color="#3d2c1c" roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[0, 2.5, 0.55]} rotation={[0.5, 0, 0]} castShadow>
        <boxGeometry args={[2.7, 0.06, 1.7]} />
        <meshStandardMaterial color="#5a2c34" roughness={0.95} />
      </mesh>
      {/* Hanging lantern */}
      <mesh position={[0, 1.9, 0.6]}>
        <boxGeometry args={[0.16, 0.22, 0.16]} />
        <meshStandardMaterial
          color="#100800"
          emissive="#ffb45e"
          emissiveIntensity={2.6}
          toneMapped={false}
        />
      </mesh>
      {/* Wares on the counter (potion bottles + a feather glint) */}
      <mesh position={[-0.6, 0.72, 0.9]}>
        <coneGeometry args={[0.09, 0.24, 6]} />
        <meshStandardMaterial color="#200008" emissive="#ff5d6e" emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
      <mesh position={[-0.3, 0.72, 1]}>
        <coneGeometry args={[0.09, 0.24, 6]} />
        <meshStandardMaterial color="#000818" emissive="#4f9dff" emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
      <mesh position={[0.45, 0.68, 0.95]} rotation={[0.3, 0.5, 1.2]}>
        <coneGeometry args={[0.04, 0.3, 4]} />
        <meshStandardMaterial color="#403008" emissive="#ffe9a8" emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      {/* Maro himself, behind the counter */}
      <group ref={body} position={[0, 0, 0]}>
        <mesh position={[0, 0.65, 0]} castShadow>
          <coneGeometry args={[0.45, 1.5, 8]} />
          <meshStandardMaterial color="#6a4a2c" roughness={0.85} />
        </mesh>
        <mesh position={[0, 1.5, 0]} castShadow>
          <sphereGeometry args={[0.22, 8, 6]} />
          <meshStandardMaterial color="#d8b894" roughness={0.8} />
        </mesh>
        <mesh position={[0, 1.8, 0]} castShadow>
          <coneGeometry args={[0.32, 0.62, 8]} />
          <meshStandardMaterial color="#6a4a2c" roughness={0.9} />
        </mesh>
      </group>
    </group>
  );
}
