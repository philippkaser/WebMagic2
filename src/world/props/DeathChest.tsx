import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Group, MeshStandardMaterial, SpriteMaterial } from "three";
import { playPickup } from "../../audio/sound";
import { gameEvents } from "../../core/events";
import { addLightSource, flashLight, removeLightSource } from "../../fx/DynamicLights";
import { spawnBurst } from "../../fx/Particles";
import { offerInteraction } from "../../game/interactions";
import { playerPosition } from "../../game/player-state";
import type { ChestInfo } from "../../net/protocol";
import { session } from "../../net/session";
import { ChestModel } from "../../render/models/ChestModel";
import { pixelLabel } from "../../render/models/pixelLabel";
import type { Vec3 } from "../types";

/** What a fallen wizard left behind: a chest holding everything the dungeon
 * took from them. The server owns its contents, so exactly one wizard can
 * claim it — the rival who killed them, an ally, or a stranger who finds the
 * remains long after. */
export function DeathChest({ chest, position }: { chest: ChestInfo; position: Vec3 }) {
  const lid = useRef<Group>(null);
  const seam = useRef<MeshStandardMaterial>(null);
  const requested = useRef(0);
  const remains = chest.slot !== null;
  const label = useMemo(() => chestLabel(chest.owner, chest.itemCount, remains, chest.glow), [chest, remains]);

  useEffect(() => {
    const src = addLightSource({
      position: [position[0], position[1] + 0.9, position[2]],
      color: chest.glow,
      intensity: 3.2,
      distance: 6,
      priority: 1,
    });
    return () => removeLightSource(src);
  }, [chest.glow, position]);

  // Burst open when anyone claims it (the floor then unmounts us).
  useEffect(
    () =>
      gameEvents.on("chestOpened", ({ chestId }) => {
        if (chestId !== chest.id) return;
        flashLight([position[0], position[1] + 0.8, position[2]], chest.glow, 16);
        spawnBurst({
          position: [position[0], position[1] + 0.6, position[2]],
          count: 24,
          color: [chest.glow, "#ffffff", "#3a2a1a"],
          speed: 4,
          ttl: 0.8,
          size: 0.07,
        });
      }),
    [chest, position],
  );

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    // The lid breathes open a crack — something inside wants out.
    if (lid.current) lid.current.rotation.x = -0.08 - Math.max(0, Math.sin(t * 1.3)) * 0.12;
    if (seam.current) seam.current.emissiveIntensity = 2.2 + Math.sin(t * 3.1) * 0.8;
    requested.current -= dt;

    const d2 = (playerPosition.x - position[0]) ** 2 + (playerPosition.z - position[2]) ** 2;
    if (d2 < 5) {
      const what = `${chest.itemCount} item${chest.itemCount === 1 ? "" : "s"}`;
      offerInteraction(`E — Open ${chest.owner}'s ${remains ? "remains" : "chest"} (${what})`, d2, () => {
        if (requested.current > 0) return;
        requested.current = 0.8;
        playPickup();
        session.openChest(chest.id);
      });
    }
  });

  return (
    <group position={position}>
      <ChestModel lidRef={lid} seamRef={seam} glow={chest.glow} remains={remains} />
      <sprite position={[0, 1.35, 0]} scale={[...(label.userData.size as [number, number]), 1]} material={label} />
    </group>
  );
}

/** Pixel-font plaque: whose chest, and how much it holds. Remains read in
 * bone-grey with a grave cross; a fresh chest in gold, bordered in its glow. */
function chestLabel(owner: string, count: number, remains: boolean, glow: string): SpriteMaterial {
  return pixelLabel({
    lines: [
      { text: remains ? `✝ ${owner}` : `${owner}'s chest`, color: remains ? "#c9c0b0" : "#ffd27a" },
      { text: `${count} item${count === 1 ? "" : "s"}`, color: "#a89cc0" },
    ],
    accent: remains ? "#6a6070" : glow,
  });
}
