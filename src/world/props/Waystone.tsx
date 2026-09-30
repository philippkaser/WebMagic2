import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture, MeshBasicMaterial, NearestFilter } from "three";
import { playAttune } from "../../audio/sound";
import { addLightSource, removeLightSource } from "../../fx/DynamicLights";
import { spawnBurst } from "../../fx/Particles";
import { offerInteraction } from "../../game/interactions";
import { playerPosition } from "../../game/player-state";
import { getTextures } from "../../render/textures";
import type { Vec3 } from "../types";

/** Chunky pixel glyph plate showing the rift's destination floor. */
function waystoneFace(floor: number): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = "#46ffd0";
  ctx.textAlign = "center";
  ctx.font = "bold 12px 'Courier New', monospace";
  ctx.fillText("FLOOR", 32, 18);
  ctx.font = "bold 34px 'Courier New', monospace";
  ctx.fillText(String(floor), 32, 50);
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  return tex;
}

/** The village waystone: an ancient slab that attunes the rift. Interacting
 * cycles the destination through every checkpoint you've banked — no menus,
 * the stone itself is the UI. */
export function Waystone({
  position,
  rotation = 0,
  floors,
  selected,
  onCycle,
}: {
  position: Vec3;
  rotation?: number;
  floors: number[];
  selected: number;
  onCycle: () => void;
}) {
  const tex = useMemo(() => waystoneFace(selected), [selected]);
  const slabTex = useMemo(() => getTextures("runestone"), []);
  const glow = useRef<MeshBasicMaterial>(null);

  useEffect(() => {
    const src = addLightSource({
      position: [position[0], position[1] + 1.6, position[2]],
      color: "#46ffd0",
      intensity: 3,
      distance: 6,
      priority: 1,
    });
    return () => removeLightSource(src);
  }, [position]);

  useFrame(({ clock }) => {
    if (glow.current) glow.current.opacity = 0.85 + Math.sin(clock.elapsedTime * 2.6) * 0.15;
    const d2 =
      (playerPosition.x - position[0]) ** 2 + (playerPosition.z - position[2]) ** 2;
    if (d2 < 5.5) {
      const next = floors[(floors.indexOf(selected) + 1) % floors.length];
      const text =
        floors.length > 1
          ? `E — Attune the waystone (next: floor ${next})`
          : "E — The waystone knows only floor 1, for now";
      offerInteraction(text, d2, () => {
        if (floors.length <= 1) return;
        playAttune();
        spawnBurst({
          position: [position[0], position[1] + 1.5, position[2]],
          count: 10,
          color: "#46ffd0",
          speed: 1.4,
          upward: 0.6,
          ttl: 0.6,
          size: 0.05,
          gravity: 0,
          drag: 1.5,
        });
        onCycle();
      });
    }
  });

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Base step */}
      <mesh position={[0, 0.15, 0]} receiveShadow castShadow>
        <boxGeometry args={[1.8, 0.3, 1.1]} />
        <meshStandardMaterial map={slabTex.map} normalMap={slabTex.normalMap} roughness={0.9} />
      </mesh>
      {/* The slab itself, leaning back a little — ancient, half-sunk */}
      <group rotation={[-0.08, 0, 0.02]}>
        <mesh position={[0, 1.25, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.15, 2.0, 0.32]} />
          <meshStandardMaterial map={slabTex.map} normalMap={slabTex.normalMap} roughness={0.85} />
        </mesh>
        {/* Glowing carved destination */}
        <mesh position={[0, 1.45, 0.168]}>
          <planeGeometry args={[0.82, 0.82]} />
          <meshBasicMaterial ref={glow} map={tex} transparent toneMapped={false} />
        </mesh>
        {/* Faint rune strip below */}
        <mesh position={[0, 0.62, 0.168]}>
          <planeGeometry args={[0.82, 0.1]} />
          <meshStandardMaterial color="#0c1a16" emissive="#2a8f76" emissiveIntensity={0.8} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}
