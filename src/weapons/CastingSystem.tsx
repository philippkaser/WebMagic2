import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector3, type Camera } from "three";
import { playCast } from "../audio/sound";
import { gameEvents } from "../core/events";
import { castFlareFx } from "../fx/effects";
import { playerVelocity } from "../game/player-state";
import { getItemDef } from "../items/catalog";
import type { ItemDef } from "../items/types";
import { peerMessage } from "../net/channels";
import { FLOOR } from "../net/floorProtocol";
import { netClock } from "../net/clock";
import { estimatePeer } from "../net/players";
import { input } from "../player/input";
import { getStats, useGame } from "../state/gameStore";
import { castInterval, encodeCastMsg, newCastSeed, sanitizeCastMsg, type CastMsg } from "./castMessage";
import { localWizardId } from "./localWizard";
import { getAbility } from "./spells";

/** With too little mana, a held button re-tries this often (seconds) instead
 * of every frame. */
const DRY_FIRE_THROTTLE = 0.2;
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
/** Staff tip ≈ 0.7 m from the body; the slack covers a snapshot of movement
 * (dashes, blasts) between the caster's last pose and the cast. */
const MAX_CAST_OFFSET_SQ = 6 * 6;

/** Floor-mates' casts replay through the identical ability code with the
 * caster's staff and gear stats — the same visuals and physics, flagged
 * remote so entity damage isn't double-counted (their own client requests
 * it), and attributed to the caster so the allegiance rules decide what it
 * may do to us. The payload is untrusted: sanitize before anything else. */
const peerCast = peerMessage<CastMsg>(FLOOR.cast, (raw, meta) => {
  const msg = sanitizeCastMsg(raw);
  if (!msg) return; // malformed, or a spell from a newer client
  // A spell must leave from where its caster actually stands — otherwise a
  // hacked client could rain hostile magic on us from across the floor.
  const est = estimatePeer(meta.from);
  if (
    est &&
    (msg.origin[0] - est.p[0]) ** 2 + (msg.origin[1] - est.p[1]) ** 2 + (msg.origin[2] - est.p[2]) ** 2 >
      MAX_CAST_OFFSET_SQ
  ) {
    return;
  }
  const staff = getItemDef(msg.staffId);
  getAbility(msg.abilityId).cast({
    origin: replayOrigin.set(...msg.origin),
    dir: replayDir.set(...msg.dir),
    stats: msg.stats,
    staff,
    caster: meta.from,
    remote: true,
    seed: msg.seed,
  });
  // Their staff flares too (we don't know their velocity; a peer's flare is
  // seen from a distance, where the lag doesn't show) — and is heard from
  // where they stand.
  castFlareFx(replayOrigin, replayDir, staff.color);
  playCast(msg.origin);
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

  // On a floor the server hosts, this cast is the server's to resolve (it
  // runs its own copy); ours flies for the feel of it, the same volley.
  const seed = newCastSeed();
  ability.cast({ origin: muzzle, dir: aim, stats, staff, caster: localWizardId(), seed });
  peerCast.send(encodeCastMsg(ability.id, muzzle, aim, staff.id, stats, seed, netClock.serverNow()));
  // Muzzle flare: rides with our own velocity so a strafing cast doesn't
  // leave its flash hanging in the air behind the staff.
  castFlareFx(muzzle, aim, staff.color, playerVelocity);

  playCast();
  gameEvents.emit("staffKick", 0.9);
  gameEvents.emit("shake", 0.05);
  // Fire-rate gear shortens the cooldown (higher mult = faster).
  return castInterval(ability.cooldown, stats.fireRateMult);
}

/** Reads mouse buttons and casts the equipped staff's abilities. Holding a
 * button keeps casting on cooldown — minute-to-minute combat is about aim,
 * mana budgeting and repositioning, not click spam. */
export function CastingSystem() {
  const { camera } = useThree();
  const cooldown = useRef({ primary: 0, secondary: 0 });

  // Dev-only hook for end-to-end scripts: aim at a world point and cast the
  // equipped staff's primary/secondary — no pointer lock needed.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as Record<string, unknown>;
    w.__castAt = (x: number, y: number, z: number, which: "primary" | "secondary" = "primary") => {
      const staff = getItemDef(useGame.getState().equipment.staff.defId);
      const abilityId = staff[which];
      if (!abilityId) return false;
      camera.lookAt(x, y, z);
      castFromStaff(abilityId, staff, camera);
      return true;
    };
    // Point the camera without casting (screenshot scripts).
    w.__lookAt = (x: number, y: number, z: number) => camera.lookAt(x, y, z);
    return () => {
      delete w.__castAt;
      delete w.__lookAt;
    };
  }, [camera]);

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
