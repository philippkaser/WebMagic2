import { useFrame, useThree } from "@react-three/fiber";
import {
  CapsuleCollider,
  interactionGroups,
  RigidBody,
  useRapier,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import { Vector3 } from "three";
import { playDash, playJump } from "../audio/sound";
import { EYE_HEIGHT, GROUPS, PLAYER } from "../core/config";
import { gameEvents } from "../core/events";
import { spawnBurst } from "../fx/Particles";
import { playerPosition, playerVelocity, setPlayerBody } from "../game/player-state";
import { publishLocalPose } from "../net/players";
import { getStats, useGame } from "../state/gameStore";
import type { Vec3 } from "../world/types";
import { input } from "./input";

const UP = new Vector3(0, 1, 0);

/** First-person character controller. A dynamic capsule (so explosions and
 * enemies can shove the player) driven with a quake-ish velocity model:
 * exponential ground acceleration, additive air control with a soft speed cap
 * (dash/blast momentum is preserved), coyote time and jump buffering. */
export function PlayerController({ spawn }: { spawn: Vec3 }) {
  const body = useRef<RapierRigidBody>(null);
  const { camera } = useThree();
  const { world, rapier } = useRapier();

  const coyote = useRef(0);
  const jumpBuffer = useRef(0);
  const doubleJumpUsed = useRef(false);
  const dashCooldown = useRef(0);
  const wasGrounded = useRef(true);
  const bobPhase = useRef(0);
  const bobAmp = useRef(0);
  const landDip = useRef(0);
  const trauma = useRef(0);
  const hoverClock = useRef(0);

  const fwd = useMemo(() => new Vector3(), []);
  const right = useMemo(() => new Vector3(), []);
  const wish = useMemo(() => new Vector3(), []);
  // Reused every frame — allocating a Ray per frame is pointless GC pressure.
  const groundRay = useMemo(
    () => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }),
    [rapier],
  );

  useEffect(() => {
    setPlayerBody(body.current);
    return () => setPlayerBody(null);
  }, []);

  useEffect(() => gameEvents.on("shake", (v) => {
    trauma.current = Math.min(1, trauma.current + v);
  }), []);

  useFrame((_, rawDt) => {
    const b = body.current;
    if (!b) return;
    const dt = Math.min(rawDt, 1 / 20);
    const state = useGame.getState();
    const playing = state.phase === "dungeon" || state.phase === "village";
    if (playing) state.regenMana(dt);

    const t = b.translation();
    const v = b.linvel();
    const stats = getStats();
    const locked = !!document.pointerLockElement;

    // Ground probe (short ray from capsule center, ignoring our own body).
    groundRay.origin.x = t.x;
    groundRay.origin.y = t.y;
    groundRay.origin.z = t.z;
    const grounded =
      world.castRay(
        groundRay,
        PLAYER.halfHeight + PLAYER.radius + 0.14,
        true,
        undefined,
        undefined,
        undefined,
        b,
      ) !== null;

    // Wish direction from camera yaw + WASD.
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    right.crossVectors(fwd, UP);
    const f = (input.down("KeyW") ? 1 : 0) - (input.down("KeyS") ? 1 : 0);
    const s = (input.down("KeyD") ? 1 : 0) - (input.down("KeyA") ? 1 : 0);
    wish.set(0, 0, 0);
    if (locked && playing && (f || s)) {
      wish.addScaledVector(fwd, f).addScaledVector(right, s).normalize();
    }

    const speed = PLAYER.speed * stats.speedMult;
    let nvx: number;
    let nvz: number;
    let vy = v.y;

    if (grounded) {
      coyote.current = PLAYER.coyoteTime;
      doubleJumpUsed.current = false;
      const k = 1 - Math.exp(-PLAYER.groundAccel * dt);
      nvx = v.x + (wish.x * speed - v.x) * k;
      nvz = v.z + (wish.z * speed - v.z) * k;
    } else {
      coyote.current -= dt;
      nvx = v.x + wish.x * PLAYER.airAccel * dt;
      nvz = v.z + wish.z * PLAYER.airAccel * dt;
      // Soft cap: air control never *adds* speed beyond the cap, but momentum
      // from dashes/blasts is kept so movement tech works.
      const hs = Math.hypot(nvx, nvz);
      const cap = Math.max(PLAYER.airSpeedCap * stats.speedMult, Math.hypot(v.x, v.z));
      if (hs > cap) {
        nvx *= cap / hs;
        nvz *= cap / hs;
      }
    }

    // Jumping: buffered presses + coyote time + boot upgrades.
    if (locked && playing && input.consume("Space")) jumpBuffer.current = PLAYER.jumpBuffer;
    else jumpBuffer.current -= dt;
    if (jumpBuffer.current > 0) {
      if (grounded || coyote.current > 0) {
        vy = PLAYER.jumpVelocity;
        jumpBuffer.current = 0;
        coyote.current = 0;
        playJump();
        dust(t, 6);
      } else if (stats.jump === "double" && !doubleJumpUsed.current) {
        vy = PLAYER.jumpVelocity * 0.92;
        doubleJumpUsed.current = true;
        jumpBuffer.current = 0;
        playJump();
        spawnBurst({
          position: [t.x, t.y - 0.8, t.z],
          count: 10,
          color: "#7fe08a",
          speed: 3,
          upward: 0.5,
          ttl: 0.5,
          size: 0.07,
          gravity: -3,
        });
      }
    }

    // Hover boots: hold Space to fall like a feather.
    if (
      stats.jump === "hover" &&
      !grounded &&
      locked &&
      input.down("Space") &&
      vy < PLAYER.hoverFallSpeed
    ) {
      vy = PLAYER.hoverFallSpeed;
      hoverClock.current -= dt;
      if (hoverClock.current <= 0) {
        hoverClock.current = 0.06;
        spawnBurst({
          position: [t.x, t.y - 0.9, t.z],
          count: 2,
          color: "#8fd0ff",
          speed: 1.6,
          upward: -1,
          ttl: 0.45,
          size: 0.05,
          gravity: 0,
        });
      }
    }

    // Blink dash (cloak).
    dashCooldown.current -= dt;
    if (
      locked &&
      playing &&
      stats.dash &&
      dashCooldown.current <= 0 &&
      input.consume("ShiftLeft")
    ) {
      const dir = wish.lengthSq() > 0 ? wish : fwd;
      nvx = dir.x * PLAYER.dashSpeed;
      nvz = dir.z * PLAYER.dashSpeed;
      vy = Math.max(vy, 1.6);
      dashCooldown.current = PLAYER.dashCooldown;
      playDash();
      trauma.current = Math.min(1, trauma.current + 0.14);
      spawnBurst({
        position: [t.x, t.y - 0.4, t.z],
        count: 14,
        color: "#e3c8ff",
        speed: 4,
        upward: 0.4,
        ttl: 0.5,
        size: 0.08,
        gravity: -2,
      });
    }

    b.setLinvel({ x: nvx, y: vy, z: nvz }, true);

    // Landing thump.
    if (grounded && !wasGrounded.current && v.y < -9) {
      landDip.current = Math.min(0.22, -v.y * 0.014);
      trauma.current = Math.min(1, trauma.current + 0.1);
      dust(t, 10);
    }
    wasGrounded.current = grounded;
    landDip.current = Math.max(0, landDip.current - dt * 1.1);

    // View bob.
    const hSpeed = Math.hypot(nvx, nvz);
    const targetAmp = grounded && hSpeed > 0.6 ? Math.min(hSpeed / speed, 1.2) : 0;
    bobAmp.current += (targetAmp - bobAmp.current) * Math.min(1, dt * 8);
    if (bobAmp.current > 0.01) bobPhase.current += dt * (5 + hSpeed * 1.1);
    const bobY = Math.sin(bobPhase.current * 2) * 0.034 * bobAmp.current;

    // Camera shake from trauma.
    trauma.current = Math.max(0, trauma.current - dt * 1.7);
    const shake = trauma.current * trauma.current * 0.14;

    camera.position.set(
      t.x + (Math.random() - 0.5) * shake,
      t.y + EYE_HEIGHT + bobY - landDip.current + (Math.random() - 0.5) * shake,
      t.z + (Math.random() - 0.5) * shake,
    );

    playerPosition.set(t.x, t.y, t.z);
    playerVelocity.set(nvx, vy, nvz);

    // Pose broadcast to floor-mates (throttled inside; no-op offline).
    if (playing) {
      camera.getWorldDirection(fwd);
      publishLocalPose(
        dt,
        t,
        { x: nvx, y: vy, z: nvz },
        Math.atan2(fwd.x, fwd.z),
        Math.asin(Math.max(-1, Math.min(1, fwd.y))),
        state.equipment.staff.defId,
      );
    }

    // Fell out of the world.
    if (t.y < -30) {
      b.setTranslation({ x: spawn[0], y: spawn[1] + 0.5, z: spawn[2] }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      state.takeDamage(25);
    }
  }, -2);

  return (
    <RigidBody
      ref={body}
      position={[spawn[0], spawn[1] + 0.6, spawn[2]]}
      colliders={false}
      enabledRotations={[false, false, false]}
      ccd
    >
      <CapsuleCollider
        args={[PLAYER.halfHeight, PLAYER.radius]}
        mass={1}
        friction={0}
        collisionGroups={interactionGroups(GROUPS.PLAYER, [
          GROUPS.WORLD,
          GROUPS.ENEMY,
          GROUPS.ENEMY_PROJECTILE,
          GROUPS.PROP,
        ])}
      />
    </RigidBody>
  );
}

function dust(t: { x: number; y: number; z: number }, count: number) {
  spawnBurst({
    position: [t.x, t.y - 0.85, t.z],
    count,
    color: ["#6b5d4d", "#4a4038"],
    speed: 2.2,
    upward: 1,
    ttl: 0.5,
    size: 0.06,
    gravity: -6,
  });
}
