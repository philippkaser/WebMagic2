import { useFrame } from "@react-three/fiber";
import { RigidBody } from "@react-three/rapier";
import { useEffect, useRef } from "react";
import type { Group, MeshStandardMaterial } from "three";
import { playBossRoar } from "../../audio/sound";
import { gameEvents } from "../../core/events";
import {
  addLightSource,
  flashLight,
  removeLightSource,
  type DynamicLightSource,
} from "../../fx/DynamicLights";
import { castFlareFx, chargeBurstFx, explosionFx, soulDissolveFx, telegraphFx } from "../../fx/effects";
import { bodyProps, SpecCollider } from "../../game/bodies";
import { ENEMY_GLOW, WARDEN_COLOR, WardenModel } from "../../render/models/enemies";
import { ENEMY_BODIES } from "../../sim/bodies";
import { WardenController } from "../../sim/enemies/controllers";
import type { SimCue } from "../../sim/world";
import type { Vec3 } from "../../world/types";
import { WARDEN } from "../brains/warden";
import { useContactDamage, useEnemy } from "../useEnemy";

/** The boss is a singleton: its net id and HUD bar are fixed. */
const BOSS_ID = "boss";
const BOSS_NAME = "WARDEN OF THE DEEP";
const UP_AXIS: Vec3 = [0, 1, 0];
const BODY = ENEMY_BODIES.boss;

/** Warden of the Deep — the floor boss (every 10th floor). Its controller
 * (sim/enemies/controllers.ts) fights on the authority: its attacks are host
 * events replayed everywhere, the replication framework moves its body on
 * replicas, and its health mirrors via replicated fields into the HUD bar.
 * This view is its light, its voice, its warnings and its death. The floor
 * keeps its portals sealed until onDeath fires. */
export function Warden({ position, floor, onDeath }: { position: Vec3; floor: number; onDeath: () => void }) {
  const shell = useRef<Group>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  /** The floor has been told it's awake (the message, the boss bar). */
  const announced = useRef(false);
  const light = useRef<DynamicLightSource | null>(null);

  const onCue = (cue: SimCue) => {
    switch (cue.type) {
      case "wake":
        announced.current = true;
        playBossRoar([cue.at.x, cue.at.y + 1.5, cue.at.z]);
        gameEvents.emit("message", `${BOSS_NAME} wakes`);
        gameEvents.emit("bossHp", { name: BOSS_NAME, frac: 1 });
        gameEvents.emit("shake", 0.5);
        break;
      case "ring":
        flashLight(cue.at, cue.color, 24);
        castFlareFx(cue.at, UP_AXIS, cue.color, undefined, 4);
        break;
      case "charge":
        chargeBurstFx(cue.at, cue.vel, cue.color);
        break;
      case "telegraph":
        // The warning circle on the floor, at the blast's real radius.
        gameEvents.emit("shake", 0.25);
        telegraphFx(cue.at, cue.radius, cue.color, cue.seconds);
        break;
    }
  };

  const e = useEnemy(
    {
      kind: "boss",
      entityId: BOSS_ID,
      position,
      floor,
      hitColor: "#ff8a5a",
      onCue,
      onDeathFx: (t) => {
        // The boss comes apart in stages: a rolling chain of blasts through
        // its shell, then its soul tears loose and rises. (Its hoard is the
        // loot book's roll — the controller reports it.)
        const at: Vec3 = [t.x, t.y, t.z];
        soulDissolveFx(at, WARDEN_COLOR, 2.6);
        for (let i = 0; i < 3; i++) {
          const p: Vec3 = [t.x + (Math.random() - 0.5) * 1.6, t.y + (Math.random() - 0.5) * 1.2, t.z + (Math.random() - 0.5) * 1.6];
          setTimeout(() => {
            explosionFx(p, 2.4, i === 1 ? "#ffd9a8" : WARDEN_COLOR, 1.2);
            flashLight(p, WARDEN_COLOR, 30);
          }, i * 170);
        }
        flashLight([t.x, t.y, t.z], WARDEN_COLOR, 60);
        playBossRoar([t.x, t.y + 1.5, t.z]);
        gameEvents.emit("message", "The Warden falls. The seal breaks.");
        gameEvents.emit("shake", 0.8);
      },
      onKilled: () => {
        gameEvents.emit("bossHp", null);
        onDeath(); // unseal the portals either way
      },
      // Damage (on the authority) or a snapshot (on a replica) also wakes it.
      onHp: (current, maxHp) => {
        if (!announced.current) {
          announced.current = true;
          gameEvents.emit("message", `${BOSS_NAME} wakes`);
        }
        gameEvents.emit("bossHp", { name: BOSS_NAME, frac: Math.max(current / maxHp, 0) });
      },
    },
    (core) => new WardenController(core),
  );
  // Its bulk burns anyone pressed against it once it's awake (to OUR player).
  const touch = useContactDamage({ range: 2.3, damage: 16, floor, cooldown: 0.9, playerLift: WARDEN.aimLift });

  useEffect(() => {
    const src = addLightSource({ position, color: WARDEN_COLOR, intensity: 8, distance: 13, priority: 2 });
    light.current = src;
    return () => {
      removeLightSource(src);
      light.current = null;
    };
  }, [position]);

  // Hide the HUD bar if the floor unmounts mid-fight.
  useEffect(() => () => gameEvents.emit("bossHp", null), []);

  useFrame(({ clock }, dt) => {
    const time = clock.elapsedTime;
    const b = e.frame(dt, time);
    if (!b) return;
    const enraged = e.ctl.enraged;
    const pulse = Math.sin(time * 8);
    if (mat.current) {
      mat.current.emissiveIntensity = ENEMY_GLOW.warden + e.core.flash * 5 + (enraged ? 0.8 + pulse * 0.4 : 0);
    }
    if (shell.current) shell.current.rotation.y += dt * (enraged ? 1.6 : 0.7);
    const t = b.translation();
    if (light.current) {
      light.current.position.set(t.x, t.y, t.z);
      light.current.intensity = 8 + e.core.flash * 10 + (enraged ? 2 + pulse * 1.5 : 0);
    }
    touch(t, dt, announced.current);
  });

  if (e.dead) return null;
  return (
    <RigidBody ref={e.body} position={position} {...bodyProps(BODY)} type={e.net.bodyType}>
      <SpecCollider spec={BODY} />
      <WardenModel shellRef={shell} materialRef={mat} />
    </RigidBody>
  );
}
