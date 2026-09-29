import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { MeshStandardMaterial } from "three";
import { playWhisper } from "../audio/sound";
import { gameEvents } from "../core/events";
import { addLightSource, removeLightSource, type DynamicLightSource } from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { offerInteraction } from "../game/interactions";
import { playerPosition } from "../game/player-state";
import { LoreRuneModel } from "../render/models/LoreRuneModel";
import { useCodex } from "../state/codex";
import { getLoreFragment } from "./lore";
import type { LoreSpawn } from "./types";

/** Lore runes — words carved into the dungeon's walls (world/lore.ts holds
 * what they say, world/gen/lorePlacement.ts where they sit). Walk up, press
 * E, and the fragment rises in the HUD and joins your codex. Runes you've
 * never read burn brighter and shed motes, so a new one catches the eye
 * across a dark room; read ones dim to a faint glow.
 *
 * Purely local: reading is personal, nothing is networked or granted. */

const READ_RANGE_SQ = 2.6 * 2.6;
const RUNE_COLOR = "#b89cff";

export function LoreRunes({ runes }: { runes: LoreSpawn[] }) {
  return (
    <>
      {runes.map((rune, i) => (
        <LoreRune key={`${rune.fragmentId}:${i}`} rune={rune} />
      ))}
    </>
  );
}

function LoreRune({ rune }: { rune: LoreSpawn }) {
  const fragment = useMemo(() => getLoreFragment(rune.fragmentId), [rune.fragmentId]);
  const known = useCodex((s) => s.read.includes(rune.fragmentId));
  const mat = useRef<MeshStandardMaterial>(null);
  const light = useRef<DynamicLightSource | null>(null);
  const moteClock = useRef(Math.random());
  const cooldown = useRef(0);
  const [x, y, z] = rune.pos;
  // A hand's breadth off the wall, toward the room.
  const out = useMemo(
    () => [x + Math.sin(rune.facing) * 0.3, y, z + Math.cos(rune.facing) * 0.3] as const,
    [x, y, z, rune.facing],
  );

  useEffect(() => {
    const src = addLightSource({
      position: [out[0], out[1], out[2]],
      color: RUNE_COLOR,
      intensity: known ? 0.8 : 2.4,
      distance: 5,
      priority: 1,
    });
    light.current = src;
    return () => {
      removeLightSource(src);
      light.current = null;
    };
  }, [known, out]);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const pulse = known ? 0.5 + Math.sin(t * 0.8) * 0.12 : 1.15 + Math.sin(t * 2.3) * 0.35;
    if (mat.current) mat.current.emissiveIntensity = pulse;
    if (light.current) light.current.intensity = known ? 0.7 : 1.6 + pulse * 0.6;
    cooldown.current -= dt;

    if (!known) {
      moteClock.current -= dt;
      if (moteClock.current <= 0) {
        moteClock.current = 0.45;
        spawnBurst({
          position: [out[0] + (Math.random() - 0.5) * 0.4, out[1] - 0.2, out[2]],
          count: 1,
          color: [RUNE_COLOR, "#ffffff"],
          speed: 0.15,
          upward: 0.5,
          ttl: 1.4,
          size: 0.04,
          gravity: 0.2,
          drag: 0.6,
        });
      }
    }

    const d2 = (playerPosition.x - out[0]) ** 2 + (playerPosition.z - out[2]) ** 2;
    if (d2 < READ_RANGE_SQ) {
      offerInteraction(`E — Read the ${known ? "familiar " : ""}carving: “${fragment.title}”`, d2, () => {
        if (cooldown.current > 0) return;
        cooldown.current = 1;
        playWhisper();
        gameEvents.emit("loreRead", { fragmentId: fragment.id });
      });
    }
  });

  return (
    <group position={rune.pos} rotation={[0, rune.facing, 0]}>
      <LoreRuneModel seed={rune.fragmentId} color={RUNE_COLOR} glowRef={mat} />
    </group>
  );
}
