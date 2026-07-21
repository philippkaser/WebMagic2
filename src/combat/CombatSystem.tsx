import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Vector3 } from "three";
import { playCast, playChargeTick } from "../audio/sound";
import { gameEvents } from "../core/events";
import { spawnBurst } from "../fx/Particles";
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
  /** Charge fraction for charged abilities (absent = full/instant). */
  power?: number;
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
      power: msg.power,
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
  // Seconds spent charging a hold-to-charge ability; -1 = not charging.
  const chargeL = useRef(-1);
  const chargeR = useRef(-1);
  const chargeTick = useRef(0);
  const dir = useMemo(() => new Vector3(), []);
  const right = useMemo(() => new Vector3(), []);
  const origin = useMemo(() => new Vector3(), []);

  useFrame((_, dt) => {
    cooldownL.current -= dt;
    cooldownR.current -= dt;
    const state = useGame.getState();
    if (state.phase !== "dungeon" && state.phase !== "village") return;
    if (!document.pointerLockElement) {
      // Losing the pointer mid-charge drops the charge.
      if (chargeL.current >= 0 || chargeR.current >= 0) {
        chargeL.current = -1;
        chargeR.current = -1;
        gameEvents.emit("charge", 0);
      }
      return;
    }

    const staff = getItemDef(state.equipment.staff.defId);
    const stats = getStats();

    const aim = () => {
      camera.getWorldDirection(dir);
      right.crossVectors(dir, UP).normalize();
      origin
        .copy(camera.position)
        .addScaledVector(dir, 0.62)
        .addScaledVector(right, 0.24)
        .addScaledVector(UP, -0.16);
    };

    const cast = (ability: ReturnType<typeof getAbility>, power?: number) => {
      aim();
      ability.cast({ origin, dir, stats, staff, power });
      peerCast.send({
        abilityId: ability.id,
        origin: [origin.x, origin.y, origin.z],
        dir: [dir.x, dir.y, dir.z],
        power,
      });
      playCast();
      gameEvents.emit("staffKick", 0.9);
      gameEvents.emit("shake", 0.05);
    };

    const tryCast = (
      abilityId: string | undefined,
      held: boolean,
      cd: { current: number },
      charge: { current: number },
    ) => {
      if (!abilityId) return;
      const ability = getAbility(abilityId);

      // Hold-to-charge: build power while the button is down, release fires.
      if (ability.charge) {
        if (held) {
          if (charge.current < 0) {
            if (cd.current > 0) return;
            charge.current = 0;
          }
          charge.current = Math.min(charge.current + dt, ability.charge.max);
          const frac = charge.current / ability.charge.max;
          gameEvents.emit("charge", Math.max(frac, 0.02));
          chargeTick.current -= dt;
          if (chargeTick.current <= 0) {
            chargeTick.current = 0.11 - frac * 0.05; // ticks speed up as it fills
            playChargeTick(frac);
            gameEvents.emit("staffKick", 0.05 + frac * 0.1);
            aim();
            // Energy crackling around the staff tip while it drinks mana.
            spawnBurst({
              position: [origin.x, origin.y, origin.z],
              count: 1 + Math.round(frac * 2),
              color: [staff.color, "#ffffff"],
              speed: 0.5 + frac,
              upward: 0.3,
              ttl: 0.25,
              size: 0.045,
              gravity: 0,
              drag: 2,
            });
          }
        } else if (charge.current >= 0) {
          const frac = charge.current / ability.charge.max;
          charge.current = -1;
          gameEvents.emit("charge", 0);
          // A tap too short to aim a charge, or an empty mana pool, fizzles.
          if (frac < 0.12 || !state.spendMana(ability.mana)) {
            cd.current = 0.2;
            return;
          }
          cast(ability, frac);
          cd.current = ability.cooldown / Math.max(0.25, stats.fireRateMult);
        }
        return;
      }

      if (!held || cd.current > 0) return;
      if (!state.spendMana(ability.mana)) {
        cd.current = 0.2; // dry-fire throttle
        return;
      }
      cast(ability);
      // Fire-rate gear shortens the cooldown (higher mult = faster).
      cd.current = ability.cooldown / Math.max(0.25, stats.fireRateMult);
    };

    tryCast(staff.primary, input.mouseLeft, cooldownL, chargeL);
    tryCast(staff.secondary, input.mouseRight, cooldownR, chargeR);
  });

  return null;
}
