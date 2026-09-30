import { useFrame } from "@react-three/fiber";
import { BallCollider, RigidBody } from "@react-three/rapier";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Color, MeshStandardMaterial } from "three";
import { gameEvents } from "../../core/events";
import { flashLight } from "../../fx/DynamicLights";
import { spawnBurst } from "../../fx/Particles";
import { playerPosition } from "../../game/player-state";
import { nearestPlayerTo } from "../../game/targets";
import { COLLISION } from "../../physics/groups";
import { useGame } from "../../state/gameStore";
import type { Vec3 } from "../../world/types";
import { castEnemyBolt } from "../ai/cast";
import { touchPlayer } from "../ai/contact";
import { ballistic, steer } from "../ai/steering";
import { GIBS, spawnGibs } from "../fx/gibs";
import { useGlow } from "../models/materials";
import { ChoirModel, HALO_ARCS, MASK_COUNT, type ChoirRig } from "./ChoirModel";
import { devStage } from "../shared";
import { useBoss } from "./useBoss";

const NAME = "THE HOLLOW CHOIR";
const GOLD = "#ffd98a";
const VOID = "#b98aff";
const SCREAM = "#ff4a6a";
const TELL = 0.4;

type Attack = "canticle" | "requiem" | "dirge" | "chorale";

interface Note {
  /** Seconds until it sounds. */
  at: number;
  mask: number;
  kind: "aimed" | "outward";
}

const goldColor = new Color(GOLD);
const screamColor = new Color(SCREAM);

/** The Hollow Choir — the boss of the odd deep tens (30, 50, 70, 90). It
 * never touches you; it *sings*. Each mask that is about to fire lights up
 * first (the tell): a canticle of aimed notes passed mask to mask, a requiem
 * of falling notes that scorch the floor where they land, a dirge of
 * expanding rings. At half health the halo shatters outward, the hymn turns
 * to a scream, and the masks spin a chorale of bolts in every direction. */
export function HollowChoir({ position, floor, onDeath }: { position: Vec3; floor: number; onDeath: () => void }) {
  const rim = useGlow(VOID, 2, true);
  const voices = useMemo(
    () =>
      Array.from(
        { length: MASK_COUNT },
        () => new MeshStandardMaterial({ color: "#000000", emissive: GOLD, emissiveIntensity: 1.5, toneMapped: false }),
      ),
    [],
  );
  useEffect(() => () => voices.forEach((m) => m.dispose()), [voices]);
  const rig = useMemo<ChoirRig>(() => ({ halo: [], masks: [], heart: null }), []);
  /** Per-mask "about to sing" glow, 0..1 (host sets it; decays everywhere). */
  const sing = useMemo(() => new Float32Array(MASK_COUNT), []);
  const breakT = useRef(0);
  const notes = useRef<Note[]>([]);

  const onPhaseBreak = useCallback(() => {
    breakT.current = 0.001;
    const t = b.body.current?.translation();
    if (t) {
      spawnGibs({ position: [t.x, t.y, t.z], count: 18, palette: GIBS.stone, force: 7 });
      spawnBurst({ position: [t.x, t.y, t.z], count: 50, color: [SCREAM, VOID, "#000000"], speed: 9, ttl: 1, size: 0.12 });
      flashLight([t.x, t.y, t.z], SCREAM, 50);
    }
    gameEvents.emit("message", "The hymn breaks into a scream!");
    gameEvents.emit("shake", 0.7);
  }, []);

  const b = useBoss({
    floor,
    position,
    name: NAME,
    color: VOID,
    baseHp: 400,
    fallMessage: "The Choir falls silent. The seal breaks.",
    gibs: GIBS.shadow,
    onDeath,
    onPhaseBreak,
  });
  const { body, host, scale, awake, phase2, flash, light, wake, interpolate } = b;
  const attackTimer = useRef(2.5);
  const contactTimer = useRef(0);
  const launch = useMemo<[number, number, number]>(() => [0, 0, 0], []);
  const maskPos = useMemo(() => Array.from({ length: MASK_COUNT }, () => ({ x: 0, y: 0, z: 0 })), []);
  const tint = useMemo(() => new Color(), []);

  useFrame(({ clock }, dt) => {
    const rb = body.current;
    if (!rb || b.deadRef.current) return;
    if (useGame.getState().phase !== "dungeon") return;
    const time = clock.elapsedTime;
    const t = rb.translation();
    const enraged = phase2.current;

    // ── Look ────────────────────────────────────────────────────────────────
    flash.current = Math.max(0, flash.current - dt * 4);
    if (breakT.current > 0) breakT.current = Math.min(1, breakT.current + dt * 1.2);
    const brk = breakT.current;
    tint.copy(goldColor).lerp(screamColor, brk);
    rim.emissive.set(brk > 0.5 ? SCREAM : VOID);
    rim.emissiveIntensity = 1.8 + Math.sin(time * 6) * 0.5 + flash.current * 4;
    if (rig.heart) {
      const s = 1 + brk * 0.4 + Math.sin(time * (enraged ? 7 : 2.5)) * 0.06 + flash.current * 0.1;
      rig.heart.scale.setScalar(s);
      rig.heart.rotation.y += dt * 0.6;
    }
    // Halo arcs: turn slowly; once broken they drift apart and tilt.
    for (let i = 0; i < HALO_ARCS; i++) {
      const arc = rig.halo[i];
      if (!arc) continue;
      const a = (i / HALO_ARCS) * Math.PI * 2 + time * 0.25;
      const out = brk * (0.9 + Math.sin(time * 1.3 + i) * 0.2);
      arc.rotation.set(brk * Math.sin(time + i * 2) * 0.5, a, brk * Math.cos(time * 0.8 + i) * 0.4);
      arc.position.set(Math.cos(a + 0.9) * out, Math.sin(time * 0.9 + i) * 0.15 * (1 + brk * 2), -Math.sin(a + 0.9) * out);
    }
    // Masks circle the heart and turn to face OUR wizard on every client.
    const orbitR = 2.2 + brk * 0.9 + (enraged ? Math.sin(time * 3) * 0.25 : 0);
    const spin = time * (enraged ? 1.6 : 0.5);
    for (let i = 0; i < MASK_COUNT; i++) {
      const a = spin + (i / MASK_COUNT) * Math.PI * 2;
      const p = maskPos[i];
      p.x = Math.cos(a) * orbitR;
      p.y = Math.sin(time * 1.7 + i * 1.3) * 0.35 + 0.2;
      p.z = Math.sin(a) * orbitR;
      const mask = rig.masks[i];
      if (mask) {
        mask.position.set(p.x, p.y, p.z);
        mask.rotation.y = Math.atan2(playerPosition.x - (t.x + p.x), playerPosition.z - (t.z + p.z));
        mask.rotation.z = Math.sin(time * 2 + i) * 0.15;
      }
      sing[i] = Math.max(0, sing[i] - dt * 2.5);
      voices[i].emissive.copy(tint);
      voices[i].emissiveIntensity = 1.3 + sing[i] * 7 + flash.current * 2;
    }
    if (light.current) {
      light.current.position.set(t.x, t.y, t.z);
      light.current.intensity = 7 + flash.current * 8 + (enraged ? 3 + Math.sin(time * 7) * 2 : 0);
      light.current.color = enraged ? SCREAM : VOID;
    }

    contactTimer.current -= dt;
    if (awake.current) {
      touchPlayer(t.x, t.y, t.z, {
        reach: 2.2,
        damage: 14 * scale.enemyDamage,
        timer: contactTimer,
        cooldown: 0.9,
        knock: 8,
        color: VOID,
      });
    }

    if (!host) {
      interpolate(dt);
      return;
    }

    // ── Host brain ─────────────────────────────────────────────────────────
    const target = nearestPlayerTo(t.x, t.y, t.z);
    if (!awake.current) {
      if (target.dist < 14) wake();
      steer(rb, 0, 0, 3, dt, (position[1] + 0.6 - t.y) * 2);
      return;
    }

    // Drift to keep a singer's distance, swaying side to side.
    const dx = target.pos.x - t.x;
    const dz = target.pos.z - t.z;
    const flat = Math.hypot(dx, dz) || 1;
    const radial = flat > 10 ? 1 : flat < 6 ? -1 : 0;
    const sway = Math.sin(time * 0.5) * 0.8;
    const s = enraged ? 2.6 : 1.8;
    steer(
      rb,
      ((dx / flat) * radial - (dz / flat) * sway) * s,
      ((dz / flat) * radial + (dx / flat) * sway) * s,
      1.5,
      dt,
      (position[1] + 0.6 + Math.sin(time * 1.1) * 0.4 - t.y) * 2,
    );

    // Sound queued notes; each mask glows TELL seconds before it sings.
    const queue = notes.current;
    for (let n = queue.length - 1; n >= 0; n--) {
      const note = queue[n];
      note.at -= dt;
      if (note.at < TELL) sing[note.mask] = Math.max(sing[note.mask], 1 - Math.max(0, note.at) / TELL);
      if (note.at > 0) continue;
      queue.splice(n, 1);
      const p = maskPos[note.mask];
      const ox = t.x + p.x;
      const oy = t.y + p.y;
      const oz = t.z + p.z;
      if (note.kind === "aimed") {
        const ax = target.pos.x - ox;
        const ay = target.pos.y - oy;
        const az = target.pos.z - oz;
        const d = Math.hypot(ax, ay, az) || 1;
        const v = 13;
        castEnemyBolt({ origin: [ox, oy, oz], velocity: [(ax / d) * v, (ay / d) * v, (az / d) * v], damage: 9 * scale.enemyDamage, color: enraged ? SCREAM : GOLD, size: 0.15, blastRadius: 1.5, blastImpulse: 8 });
      } else {
        const d = Math.hypot(p.x, p.z) || 1;
        castEnemyBolt({ origin: [ox, oy, oz], velocity: [(p.x / d) * 9, 0.2, (p.z / d) * 9], damage: 7 * scale.enemyDamage, color: SCREAM, size: 0.14, blastRadius: 1.4, blastImpulse: 7 });
      }
    }
    if (queue.length > 0) return;

    attackTimer.current -= dt;
    if (attackTimer.current > 0 || target.dist > 26 || devStage.calm) return;
    attackTimer.current = enraged ? 1.8 : 2.8;

    switch (pickAttack(enraged)) {
      case "canticle": {
        // A phrase passed round the circle, one aimed note per mask.
        const count = enraged ? 8 : 5;
        const first = Math.floor(Math.random() * MASK_COUNT);
        for (let i = 0; i < count; i++) queue.push({ at: TELL + i * 0.18, mask: (first + i) % MASK_COUNT, kind: "aimed" });
        break;
      }
      case "requiem": {
        // Falling notes: high lobs that scorch where they land.
        const count = enraged ? 7 : 5;
        for (let i = 0; i < count; i++) {
          const r = i === 0 ? 0 : 1.5 + Math.random() * 2.5;
          const a = Math.random() * Math.PI * 2;
          const to = { x: target.pos.x + Math.cos(a) * r, y: 0.1, z: target.pos.z + Math.sin(a) * r };
          const from = { x: t.x, y: t.y + 0.8, z: t.z };
          ballistic(from, to, 1.3 + Math.random() * 0.4, 0.7, launch);
          castEnemyBolt({
            origin: [from.x, from.y, from.z],
            velocity: [launch[0], launch[1], launch[2]],
            damage: 9 * scale.enemyDamage,
            color: VOID,
            size: 0.2,
            blastRadius: 1.8,
            blastImpulse: 9,
            gravity: 0.7,
            burn: 3,
          });
        }
        for (let i = 0; i < MASK_COUNT; i++) sing[i] = 1;
        flashLight([t.x, t.y, t.z], VOID, 24);
        break;
      }
      case "dirge": {
        // Two expanding rings, the second offset to close the gaps.
        for (let w = 0; w < 2; w++) {
          const count = enraged ? 16 : 12;
          for (let i = 0; i < count; i++) {
            const a = ((i + w * 0.5) / count) * Math.PI * 2;
            castEnemyBolt({ origin: [t.x, t.y, t.z], velocity: [Math.cos(a) * (7 + w * 2.5), 0.2, Math.sin(a) * (7 + w * 2.5)], damage: 7 * scale.enemyDamage, color: VOID, size: 0.15, blastRadius: 1.4, blastImpulse: 7 });
          }
        }
        flash.current = 1;
        break;
      }
      case "chorale": {
        // Every mask sings outward in turn while the ring spins.
        for (let i = 0; i < 20; i++) queue.push({ at: TELL + i * 0.1, mask: i % MASK_COUNT, kind: "outward" });
        break;
      }
    }
  });

  if (b.dead) return null;
  return (
    <RigidBody
      ref={body}
      position={position}
      type={host ? "dynamic" : "kinematicPosition"}
      colliders={false}
      gravityScale={0}
      linearDamping={0.8}
      enabledRotations={[false, false, false]}
    >
      <BallCollider args={[1.1]} mass={25} collisionGroups={COLLISION.enemy} />
      <ChoirModel rig={rig} voices={voices} rim={rim} />
    </RigidBody>
  );
}

function pickAttack(enraged: boolean): Attack {
  const r = Math.random();
  if (enraged && r < 0.3) return "chorale";
  return r < 0.55 ? "canticle" : r < 0.8 ? "requiem" : "dirge";
}
