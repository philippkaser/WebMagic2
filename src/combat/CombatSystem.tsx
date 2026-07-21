import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Vector3 } from "three";
import { playCast } from "../audio/sound";
import { gameEvents } from "../core/events";
import { computeStats, getItemDef } from "../items/catalog";
import { peerMessage } from "../net/channels";
import { peerStaffId } from "../net/players";
import { input } from "../player/input";
import { defaultEquipment } from "../state/persistence";
import { getStats, useGame } from "../state/gameStore";
import { getAbility } from "./abilities";

const UP = new Vector3(0, 1, 0);

interface CastMsg {
  abilityId: string;
  origin: [number, number, number];
  dir: [number, number, number];
}

/** Floor-mates' casts replay through the identical ability code — the same
 * visuals and physics, flagged remote so entity damage isn't double-counted
 * (their own client requests the damage). */
const peerCast = peerMessage<CastMsg>("cast", (msg, meta) => {
  try {
    const staff = getItemDef(peerStaffId(meta.from) || "apprentice_staff");
    getAbility(msg.abilityId).cast({
      origin: new Vector3(...msg.origin),
      dir: new Vector3(...msg.dir),
      stats: computeStats(defaultEquipment()),
      staff,
      remote: true,
    });
  } catch {
    // Unknown ability/staff from a newer client — ignore.
  }
});

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

  useFrame((_, dt) => {
    cooldownL.current -= dt;
    cooldownR.current -= dt;
    const state = useGame.getState();
    if (state.phase !== "dungeon" && state.phase !== "village") return;
    if (!document.pointerLockElement) return;

    const staff = getItemDef(state.equipment.staff.defId);
    const stats = getStats();
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
      ability.cast({ origin, dir, stats, staff });
      peerCast.send({
        abilityId: ability.id,
        origin: [origin.x, origin.y, origin.z],
        dir: [dir.x, dir.y, dir.z],
      });
      // Fire-rate gear shortens the cooldown (higher mult = faster).
      cd.current = ability.cooldown / Math.max(0.25, stats.fireRateMult);
      playCast();
      gameEvents.emit("staffKick", 0.9);
      gameEvents.emit("shake", 0.05);
    };

    if (input.mouseLeft) tryCast(staff.primary, cooldownL);
    if (input.mouseRight) tryCast(staff.secondary, cooldownR);
  });

  return null;
}
