import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Group, Mesh, MeshStandardMaterial } from "three";
import { playAnvil, playBellows, playBrewDone, playBubble } from "../audio/stationSounds";
import { gameEvents } from "../core/events";
import { flashLight } from "../fx/DynamicLights";
import { moteFx, soulRiseFx } from "../fx/effects";
import { spawnBurst } from "../fx/Particles";
import { getItemDef } from "../items/catalog";
import { BREW_COLOR, CauldronModel, FORGE_COLOR, ForgeModel } from "../render/models/StationModels";
import { addLightSource, removeLightSource, type DynamicLightSource } from "../fx/DynamicLights";
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
  overlay: "chest" | "merchant" | "cauldron" | "forge",
  reach = 7,
): void {
  useFrame(() => {
    const d2 =
      (playerPosition.x - position[0]) ** 2 + (playerPosition.z - position[2]) ** 2;
    if (d2 < reach) {
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

/** Where a station is in world space: its origin plus a local offset turned
 * by its yaw. */
function worldOf(position: Vec3, rotation: number, local: Vec3): Vec3 {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return [position[0] + local[0] * c + local[2] * s, position[1] + local[1], position[2] - local[0] * s + local[2] * c];
}

/** Old Wenna's cauldron: E to brew (the inventory scene's cauldron mode).
 * The brew glows and bubbles; when a brew takes it surges into the colour of
 * what it made, gulps and steams. */
export function Cauldron({ position, rotation = 0 }: { position: Vec3; rotation?: number }) {
  const brew = useRef<Mesh>(null);
  const bubbles = useRef<Group>(null);
  const embers = useRef<Group>(null);
  const body = useRef<Group>(null);
  const light = useRef<DynamicLightSource | null>(null);
  const surge = useRef({ k: 0, color: BREW_COLOR });
  const bubbleClock = useRef(0);
  const top = worldOf(position, rotation, [0, 1.0, 0]);
  useOverlayInteraction(position, "E — Brew at Old Wenna's cauldron", "cauldron", 9);

  useEffect(() => {
    const src = addLightSource({ position: [top[0], top[1] + 0.3, top[2]], color: BREW_COLOR, intensity: 6, distance: 9, priority: 1 });
    light.current = src;
    const off = gameEvents.on("crafted", (e) => {
      if (!e.ok || !e.recipe.startsWith("brew:")) return;
      const out = e.produced?.[0];
      const color = out ? getItemDef(out).color : BREW_COLOR;
      surge.current = { k: 1, color };
      spawnBurst({ position: top, count: 36, color: [color, "#ffffff"], speed: 3.5, upward: 1.6, ttl: 0.9, size: 0.07, gravity: -3, style: "glow" });
      soulRiseFx(top, color, 18);
      flashLight([top[0], top[1] + 0.5, top[2]], color, 30, 10);
      playBrewDone(top);
    });
    return () => {
      off();
      removeLightSource(src);
      light.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const s = surge.current;
    s.k = Math.max(0, s.k - dt * 0.6);
    if (brew.current) {
      brew.current.position.y = 0.94 + Math.sin(t * 2.3) * 0.008 + s.k * 0.03;
      (brew.current.material as MeshStandardMaterial).emissiveIntensity = 1.8 + Math.sin(t * 3.1) * 0.25 + s.k * 2;
    }
    bubbles.current?.children.forEach((b, i) => {
      const p = (t * (0.7 + i * 0.13) + i * 0.37) % 1;
      b.position.y = 0.95 + p * 0.06;
      b.scale.setScalar(p < 0.85 ? 0.4 + p : Math.max(0, 1.3 - (p - 0.85) * 9));
    });
    embers.current?.children.forEach((e, i) => e.scale.setScalar(0.9 + Math.sin(t * 5 + i * 2) * 0.15));
    if (body.current) body.current.rotation.z = Math.sin(t * 1.3) * 0.04;
    if (light.current) light.current.intensity = 6 + Math.sin(t * 4.1) * 0.8 + s.k * 14;
    // Steam and the odd bubble's pop, only when someone is near to see it.
    const d2 = (playerPosition.x - top[0]) ** 2 + (playerPosition.z - top[2]) ** 2;
    if (d2 > 400) return;
    bubbleClock.current -= dt;
    if (bubbleClock.current <= 0) {
      bubbleClock.current = 0.35 + Math.random() * 0.6;
      moteFx([top[0] + (Math.random() - 0.5) * 0.5, top[1] + 0.05, top[2] + (Math.random() - 0.5) * 0.5], s.k > 0.1 ? s.color : BREW_COLOR, {
        rise: 1.2,
        size: 0.05,
        life: 1.1,
      });
      if (d2 < 60 && Math.random() < 0.5) playBubble(top);
    }
  });

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <CauldronModel brewRef={brew} bubblesRef={bubbles} emberRef={embers} bodyRef={body} />
    </group>
  );
}

/** Brannoc's forge: E to work it (the inventory scene's forge mode). The
 * coals breathe; when the work is done the anvil rings and sparks fly. */
export function Forge({ position, rotation = 0 }: { position: Vec3; rotation?: number }) {
  const coals = useRef<Group>(null);
  const body = useRef<Group>(null);
  const light = useRef<DynamicLightSource | null>(null);
  const flare = useRef(0);
  const breath = useRef(2 + Math.random() * 3);
  const hearth = worldOf(position, rotation, [0, 1.0, -0.7]);
  const anvil = worldOf(position, rotation, [0, 0.85, 0.45]);
  useOverlayInteraction(position, "E — Work Brannoc's forge", "forge", 9);

  useEffect(() => {
    const src = addLightSource({ position: [hearth[0], hearth[1] + 0.2, hearth[2] + 0.4], color: FORGE_COLOR, intensity: 8, distance: 10, priority: 1 });
    light.current = src;
    const off = gameEvents.on("crafted", (e) => {
      if (!e.ok || e.recipe.startsWith("brew:")) return;
      flare.current = 1;
      const big = e.recipe === "enhance" || e.recipe === "greatwork";
      spawnBurst({ position: anvil, count: big ? 60 : 30, color: ["#ffd27a", FORGE_COLOR, "#ffffff"], speed: big ? 7 : 5, upward: 1.2, ttl: 0.8, size: 0.05, gravity: -14, style: "spark" });
      flashLight(anvil, e.recipe === "greatwork" ? "#ffcf6a" : FORGE_COLOR, big ? 40 : 22, 10);
      if (e.recipe === "greatwork") soulRiseFx(anvil, "#ffcf6a", 30);
      playAnvil(anvil, big);
    });
    return () => {
      off();
      removeLightSource(src);
      light.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    flare.current = Math.max(0, flare.current - dt * 1.4);
    // The bellows: every few seconds the coals draw breath.
    breath.current -= dt;
    let draw = 0;
    if (breath.current < 0.8) draw = Math.sin(((0.8 - breath.current) / 0.8) * Math.PI);
    if (breath.current <= 0) {
      breath.current = 3 + Math.random() * 4;
      const d2 = (playerPosition.x - hearth[0]) ** 2 + (playerPosition.z - hearth[2]) ** 2;
      if (d2 < 120) playBellows(hearth);
    }
    const glowK = 1 + Math.sin(t * 3.3) * 0.12 + draw * 0.6 + flare.current * 1.5;
    coals.current?.children.forEach((c, i) => {
      const m = (c as Mesh).material as MeshStandardMaterial;
      m.emissiveIntensity = (i === 0 ? 2.4 : 3) * glowK;
    });
    if (light.current) light.current.intensity = 8 * glowK;
    if (body.current) body.current.position.y = Math.max(0, Math.sin(t * 2.2)) * 0.02;
    if (Math.random() < 0.04 + draw * 0.2) {
      moteFx([hearth[0] + (Math.random() - 0.5) * 0.6, hearth[1] + 0.1, hearth[2] + 0.3], "#ffb45e", { rise: 1.6, size: 0.03, life: 1.2, style: "ember" });
    }
  });

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <ForgeModel coalsRef={coals} bodyRef={body} />
    </group>
  );
}
