import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture, MeshBasicMaterial, NearestFilter } from "three";
import { playAttune } from "../../audio/sound";
import { gameEvents } from "../../core/events";
import { addLightSource, removeLightSource } from "../../fx/DynamicLights";
import { spawnBurst } from "../../fx/Particles";
import { offerInteraction } from "../../game/interactions";
import { playerPosition } from "../../game/player-state";
import { WAYSTONE_FACE, WaystoneModel } from "../../render/models/AltarModels";
import { drawPixelText, textWidth } from "../../render/models/pixelLabel";
import type { Vec3 } from "../types";

/** Chunky pixel glyph plate: the power the stone reads in you, and the band
 * of floors the rift will throw you into — in the same pixel font as every
 * other carved word in the world. */
function waystoneFace(gear: number, range: [number, number]): CanvasTexture {
  const S = 48;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  const center = (text: string, y: number, scale = 1) =>
    drawPixelText(ctx, text, Math.floor((S - textWidth(text, scale)) / 2), y, "#46ffd0", scale);
  center("POWER", 3);
  const num = String(gear);
  center(num, 14, num.length > 3 ? 1 : 2);
  center(`▼${range[0]}-${range[1]}`, 37);
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  return tex;
}

/** The village waystone: an ancient slab that reads the power of whoever
 * stands before it. The rift doesn't take requests — it throws you as deep
 * as your gear says you belong. No menus: the stone itself is the UI. */
export function Waystone({
  position,
  rotation = 0,
  gear,
  range,
}: {
  position: Vec3;
  rotation?: number;
  gear: number;
  range: [number, number];
}) {
  const tex = useMemo(() => waystoneFace(gear, range), [gear, range]);
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
      offerInteraction("E — Lay a hand on the waystone", d2, () => {
        playAttune();
        spawnBurst({
          position: [position[0], position[1] + 1.5, position[2]],
          count: 14,
          color: "#46ffd0",
          speed: 1.4,
          upward: 0.6,
          ttl: 0.6,
          size: 0.05,
          gravity: 0,
          drag: 1.5,
        });
        gameEvents.emit(
          "message",
          `The stone hums: your power is ${gear}. The rift will cast you to floor ${range[0]}–${range[1]}. Survive five floors to find the way home.`,
        );
      });
    }
  });

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* The slab leans back a little — ancient, half-sunk */}
      <group rotation={[-0.06, 0, 0.02]}>
        <WaystoneModel />
        <mesh position={[0, WAYSTONE_FACE.y, WAYSTONE_FACE.z]}>
          <planeGeometry args={[WAYSTONE_FACE.size, WAYSTONE_FACE.size]} />
          <meshBasicMaterial ref={glow} map={tex} transparent toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}
