import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Vector3 } from "three";
import { playCast } from "../audio/sound";
import { gameEvents } from "../core/events";
import { computeStats, getItemDef } from "../items/catalog";
import { session } from "../net/session";
import { input } from "../player/input";
import { defaultEquipment } from "../state/persistence";
import { getStats, useGame } from "../state/gameStore";
import { getAbility } from "./abilities";

const UP = new Vector3(0, 1, 0);

/** Reads mouse buttons and casts the equipped staff's abilities. Holding a
 * button keeps casting on cooldown — minute-to-minute combat is about aim,
 * mana budgeting and repositioning, not click spam. */
export function CombatSystem() {
  const { camera } = useThree();
  const cooldownL = useRef(0);
  const cooldownR = useRef(0);
  const dir = useMemo(() => new Vector3(), []);
  const right = useMemo(() => new Vector3(), []);
  const origin = useMemo(() => new Vector3(), []);

  // Replay floor-mates' casts locally (visuals + physics use identical code).
  useEffect(
    () =>
      gameEvents.on("peerCast", ({ abilityId, origin: o, dir: d, playerId }) => {
        try {
          const peer = session.peers.get(playerId);
          const staff = getItemDef(peer?.staffId ?? "apprentice_staff");
          getAbility(abilityId).cast({
            origin: new Vector3(o.x, o.y, o.z),
            dir: new Vector3(d.x, d.y, d.z),
            stats: computeStats(defaultEquipment()),
            staff,
            remote: true,
          });
        } catch {
          // Unknown ability/staff from a newer client — ignore.
        }
      }),
    [],
  );

  useFrame((_, dt) => {
    cooldownL.current -= dt;
    cooldownR.current -= dt;
    const state = useGame.getState();
    if (state.phase !== "dungeon" && state.phase !== "village") return;
    if (!document.pointerLockElement) return;

    const staff = getItemDef(state.equipment.staff.defId);
    const tryCast = (abilityId: string | undefined, cd: { current: number }) => {
      if (!abilityId || cd.current > 0) return;
      const ability = getAbility(abilityId);
      if (!state.spendMana(ability.mana)) {
        cd.current = 0.2; // dry-fire throttle
        return;
      }
      camera.getWorldDirection(dir);
      right.crossVectors(dir, UP).normalize();
      origin
        .copy(camera.position)
        .addScaledVector(dir, 0.62)
        .addScaledVector(right, 0.24)
        .addScaledVector(UP, -0.16);
      ability.cast({ origin, dir, stats: getStats(), staff });
      session.sendCast(
        ability.id,
        { x: origin.x, y: origin.y, z: origin.z },
        { x: dir.x, y: dir.y, z: dir.z },
      );
      cd.current = ability.cooldown;
      playCast();
      gameEvents.emit("staffKick", 0.9);
      gameEvents.emit("shake", 0.05);
    };

    if (input.mouseLeft) tryCast(staff.primary, cooldownL);
    if (input.mouseRight) tryCast(staff.secondary, cooldownR);
  });

  return null;
}
