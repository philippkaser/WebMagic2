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

/** Maro the Provisioner: he stopped descending years ago, and whatever he
 * brought back up with him never quite settled. A hunched shape under a
 * stitched hood, too-long arms, candle-lit stall framed in old tusks and
 * stretched hide. Sells potions and feathers — pricy, and he knows it. */
export function Merchant({ position, rotation = 0 }: { position: Vec3; rotation?: number }) {
  const tex = useMemo(() => getTextures("planks"), []);
  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
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

  // A slow wheeze of an idle — and his head keeps drifting toward whoever
  // comes close, a beat too slow to be comfortable.
  useFrame(({ clock }, dt) => {
    if (body.current) {
      body.current.rotation.z = Math.sin(clock.elapsedTime * 0.8) * 0.03;
      body.current.position.y = Math.sin(clock.elapsedTime * 1.7) * 0.015;
    }
    if (head.current) {
      const dx = playerPosition.x - position[0];
      const dz = playerPosition.z - position[2];
      const near = dx * dx + dz * dz < 30;
      const targetYaw = near ? Math.atan2(dx, dz) - rotation : 0;
      head.current.rotation.y += (targetYaw - head.current.rotation.y) * Math.min(1, dt * 1.6);
    }
  });

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Counter — old planks, sagging in the middle. */}
      <mesh position={[0, 0.55, 0.9]} rotation={[0, 0, 0.015]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 0.14, 0.7]} />
        <meshStandardMaterial map={tex.map} normalMap={tex.normalMap} roughness={0.85} />
      </mesh>
      {[-1, 1].map((x) => (
        <mesh key={x} position={[x, 0.28, 0.9]} castShadow>
          <boxGeometry args={[0.14, 0.56, 0.6]} />
          <meshStandardMaterial map={tex.map} normalMap={tex.normalMap} roughness={0.9} />
        </mesh>
      ))}
      {/* Tusk posts — great curved bones planted in the dirt. */}
      {([-1.15, 1.15] as const).map((x) => (
        <group key={x} position={[x, 0, 1.15]}>
          <mesh position={[0, 1.1, 0]} rotation={[0, 0, -x * 0.12]} castShadow>
            <cylinderGeometry args={[0.055, 0.09, 2.2, 5]} />
            <meshStandardMaterial color="#b8a888" roughness={0.75} flatShading />
          </mesh>
          <mesh position={[-x * 0.22, 2.35, 0]} rotation={[0, 0, -x * 0.75]} castShadow>
            <coneGeometry args={[0.055, 0.7, 5]} />
            <meshStandardMaterial color="#c8b898" roughness={0.75} flatShading />
          </mesh>
        </group>
      ))}
      {/* Canopy — hide stretched between the tusks, edges hanging in strips. */}
      <mesh position={[0, 2.5, 0.55]} rotation={[0.5, 0, 0.02]} castShadow>
        <boxGeometry args={[2.7, 0.06, 1.7]} />
        <meshStandardMaterial color="#4a2028" roughness={0.95} flatShading />
      </mesh>
      {[-0.95, -0.35, 0.3, 0.9].map((x, i) => (
        <mesh key={i} position={[x, 2.02 - (i % 2) * 0.09, 1.28]} rotation={[0.12, 0, 0]}>
          <boxGeometry args={[0.22, 0.3 + (i % 3) * 0.12, 0.02]} />
          <meshStandardMaterial color="#3a161e" roughness={0.95} side={2} />
        </mesh>
      ))}
      {/* Hanging lantern — a caged ember on a hook. */}
      <mesh position={[0, 1.9, 0.6]}>
        <boxGeometry args={[0.16, 0.22, 0.16]} />
        <meshStandardMaterial
          color="#100800"
          emissive="#ffb45e"
          emissiveIntensity={2.6}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 2.06, 0.6]}>
        <cylinderGeometry args={[0.02, 0.02, 0.14, 4]} />
        <meshStandardMaterial color="#2c2530" roughness={0.6} metalness={0.6} />
      </mesh>
      {/* Trophies from below, dangling off the canopy edge. */}
      <group position={[-0.72, 2.06, 1.22]}>
        <mesh>
          <cylinderGeometry args={[0.012, 0.012, 0.3, 3]} />
          <meshStandardMaterial color="#3a3026" roughness={0.9} />
        </mesh>
        <mesh position={[0, -0.24, 0]} castShadow>
          <boxGeometry args={[0.16, 0.15, 0.16]} />
          <meshStandardMaterial color="#c8b898" roughness={0.8} flatShading />
        </mesh>
        {([0.04, -0.04] as const).map((x) => (
          <mesh key={x} position={[x, -0.23, 0.08]}>
            <boxGeometry args={[0.035, 0.045, 0.02]} />
            <meshStandardMaterial color="#0a0708" roughness={1} />
          </mesh>
        ))}
      </group>
      <group position={[0.78, 2.1, 1.2]} rotation={[0, 0, 0.15]}>
        <mesh>
          <cylinderGeometry args={[0.012, 0.012, 0.36, 3]} />
          <meshStandardMaterial color="#3a3026" roughness={0.9} />
        </mesh>
        <mesh position={[0, -0.28, 0]} castShadow>
          <icosahedronGeometry args={[0.09, 0]} />
          <meshStandardMaterial
            color="#160d26"
            emissive="#b46bff"
            emissiveIntensity={0.8}
            flatShading
            roughness={0.5}
          />
        </mesh>
      </group>
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
      {/* Melted candle stubs at the counter's ends. */}
      {([-1.05, 1.05] as const).map((x) => (
        <group key={x} position={[x, 0.62, 1.05]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.035, 0.05, 0.12, 5]} />
            <meshStandardMaterial color="#d8cca8" roughness={0.85} flatShading />
          </mesh>
          <mesh position={[0, 0.09, 0]}>
            <coneGeometry args={[0.02, 0.07, 4]} />
            <meshStandardMaterial
              color="#200800"
              emissive="#ffc06a"
              emissiveIntensity={3}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
      {/* Maro himself, behind the counter */}
      <group ref={body} position={[0, 0, 0]}>
        {/* Robe — mud-brown, crooked, ragged at the ground. */}
        <mesh position={[0, 0.65, 0]} rotation={[0.05, 0.9, -0.06]} castShadow>
          <coneGeometry args={[0.45, 1.5, 7]} />
          <meshStandardMaterial color="#5a3d22" roughness={0.92} flatShading />
        </mesh>
        {/* The hump he brought back from the deep. */}
        <mesh position={[0, 1.18, -0.18]} scale={[1, 0.8, 0.95]} castShadow>
          <sphereGeometry args={[0.32, 7, 5]} />
          <meshStandardMaterial color="#5a3d22" roughness={0.92} flatShading />
        </mesh>
        {/* Arms — too long, knuckles resting near the counter. */}
        {([-1, 1] as const).map((side) => (
          <group key={side}>
            <mesh
              position={[side * 0.42, 0.95, 0.22]}
              rotation={[0.55, 0, side * 0.6]}
              castShadow
            >
              <cylinderGeometry args={[0.05, 0.065, 0.85, 5]} />
              <meshStandardMaterial color="#4a3018" roughness={0.92} flatShading />
            </mesh>
            <mesh position={[side * 0.6, 0.62, 0.55]}>
              <boxGeometry args={[0.11, 0.08, 0.13]} />
              <meshStandardMaterial color="#a89070" roughness={0.85} flatShading />
            </mesh>
            {/* Fingers draped over the edge. */}
            {[0, 1, 2].map((f) => (
              <mesh
                key={f}
                position={[side * (0.56 + f * 0.04), 0.55, 0.62]}
                rotation={[0.9, 0, 0]}
              >
                <coneGeometry args={[0.016, 0.14, 4]} />
                <meshStandardMaterial color="#a89070" roughness={0.85} flatShading />
              </mesh>
            ))}
          </group>
        ))}
        {/* Head sunk between the shoulders, hood swallowing it. */}
        <group ref={head} position={[0, 1.42, 0.06]}>
          <mesh>
            <sphereGeometry args={[0.2, 8, 6]} />
            <meshStandardMaterial color="#0a0708" roughness={1} />
          </mesh>
          {/* Amber eyes — one sits lower than the other. */}
          <mesh position={[0.07, 0.02, 0.15]}>
            <boxGeometry args={[0.05, 0.045, 0.03]} />
            <meshStandardMaterial color="#000" emissive="#ffb45e" emissiveIntensity={3} toneMapped={false} />
          </mesh>
          <mesh position={[-0.07, -0.03, 0.15]}>
            <boxGeometry args={[0.04, 0.035, 0.03]} />
            <meshStandardMaterial color="#000" emissive="#ffb45e" emissiveIntensity={2.4} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.22, -0.02]} rotation={[0.3, 0, 0.08]} castShadow>
            <coneGeometry args={[0.3, 0.55, 7]} />
            <meshStandardMaterial color="#42301e" roughness={0.95} flatShading />
          </mesh>
        </group>
      </group>
    </group>
  );
}
