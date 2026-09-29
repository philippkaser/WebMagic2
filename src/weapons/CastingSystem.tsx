import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import { Vector3, type Camera } from "three";
import { playCast } from "../audio/sound";
import { gameEvents } from "../core/events";
import { getItemDef } from "../items/catalog";
import type { ItemDef } from "../items/types";
import { peerMessage } from "../net/channels";
import { input } from "../player/input";
import { getStats, useGame } from "../state/gameStore";
import { encodeCastMsg, sanitizeCastMsg, type CastMsg } from "./castMessage";
import { localWizardId } from "./localWizard";
import { getAbility } from "./spells";

/** With too little mana, a held button re-tries this often (seconds) instead
 * of every frame. */
const DRY_FIRE_THROTTLE = 0.2;
/** Fire-rate floor: no debuff can stretch a cooldown past 4×. */
const MIN_FIRE_RATE = 0.25;
/** The staff tip relative to the camera — ahead, to the right, a bit low —
 * so spells leave the staff in view, not the middle of the screen. */
const MUZZLE = { forward: 0.62, right: 0.24, down: 0.16 };

const UP = new Vector3(0, 1, 0);
// Scratch vectors: casts are synchronous and copy what they keep.
const aim = new Vector3();
const side = new Vector3();
const muzzle = new Vector3();
const replayOrigin = new Vector3();
const replayDir = new Vector3();

/** Floor-mates' casts replay through the identical ability code with the
 * caster's staff and gear stats — the same visuals and physics, flagged
 * remote so entity damage isn't double-counted (their own client requests
 * it), and attributed to the caster so the allegiance rules decide what it
 * may do to us. The payload is untrusted: sanitize before anything else. */
const peerCast = peerMessage<CastMsg>("cast", (raw, meta) => {
  const msg = sanitizeCastMsg(raw);
  if (!msg) return; // malformed, or a spell from a newer client
  getAbility(msg.abilityId).cast({
    origin: replayOrigin.set(...msg.origin),
    dir: replayDir.set(...msg.dir),
    stats: msg.stats,
    staff: getItemDef(msg.staffId),
    caster: meta.from,
    remote: true,
  });
});

/** Cast one of the equipped staff's abilities from the staff tip, tell the
 * floor, and play the feedback. Returns the slot's next cooldown. */
function castFromStaff(abilityId: string, staff: ItemDef, camera: Camera): number {
  const ability = getAbility(abilityId);
  if (!useGame.getState().spendMana(ability.mana)) return DRY_FIRE_THROTTLE;
  const stats = getStats();

  camera.getWorldDirection(aim);
  side.crossVectors(aim, UP).normalize();
  muzzle
    .copy(camera.position)
    .addScaledVector(aim, MUZZLE.forward)
    .addScaledVector(side, MUZZLE.right)
    .addScaledVector(UP, -MUZZLE.down);

  ability.cast({ origin: muzzle, dir: aim, stats, staff, caster: localWizardId() });
  peerCast.send(encodeCastMsg(ability.id, muzzle, aim, staff.id, stats));

  playCast();
  gameEvents.emit("staffKick", 0.9);
  gameEvents.emit("shake", 0.05);
  // Fire-rate gear shortens the cooldown (higher mult = faster).
  return ability.cooldown / Math.max(MIN_FIRE_RATE, stats.fireRateMult);
}

/** Reads mouse buttons and casts the equipped staff's abilities. Holding a
 * button keeps casting on cooldown — minute-to-minute combat is about aim,
 * mana budgeting and repositioning, not click spam. */
export function CastingSystem() {
  const { camera } = useThree();
  const cooldown = useRef({ primary: 0, secondary: 0 });

  useFrame((_, dt) => {
    const cd = cooldown.current;
    cd.primary -= dt;
    cd.secondary -= dt;
    const state = useGame.getState();
    if (state.phase !== "dungeon" && state.phase !== "village") return;
    if (!document.pointerLockElement) return;

    const staff = getItemDef(state.equipment.staff.defId);
    if (input.mouseLeft && staff.primary && cd.primary <= 0) {
      cd.primary = castFromStaff(staff.primary, staff, camera);
    }
    if (input.mouseRight && staff.secondary && cd.secondary <= 0) {
      cd.secondary = castFromStaff(staff.secondary, staff, camera);
    }
  });

  return null;
}
