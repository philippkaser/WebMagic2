import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Group, MeshStandardMaterial, Object3D, PlaneGeometry, Vector3 } from "three";
import { streakHeat } from "../combat/shooter";
import { gameEvents } from "../core/events";
import { presentDt } from "../core/presentTime";
import { spawnBurst } from "../fx/Particles";
import { createStaffGlowMaterial } from "../fx/staffGlow";
import { playerVelocity } from "../game/player-state";
import { getItemDef } from "../items/catalog";
import { HandModel } from "../render/models/HandModel";
import { shared } from "../render/models/shared";
import { StaffModel, staffStyle, type StaffStyle } from "../render/models/StaffModel";
import { useGame } from "../state/gameStore";
import { readyGlow } from "../weapons/CastingSystem";
import { biomeForFloor, getBiomeDef } from "../world/biomes";
import { CameraKick } from "./CameraKick";

/** First-person staff viewmodel: a gloved fist holding the equipped staff
 * (render/models/StaffModel — each staff its own build), following the camera
 * with look-lag, breathing sway, walk bob and cast recoil (`staffKick`). The
 * crystal pulses and sheds motes in the staff's own manner (drifting sparks,
 * rising embers, crackling arcs, sinking soul-light); the cast flare
 * (fx/staffGlow) sits on the staff's heart. Recoil scales with the spell's
 * weight and holds through a hitstop (the picture's clock); a heavy spell
 * coming ready draws motes into the crystal and brightens it; a streak of
 * kills makes it burn hotter. It mounts the eye's recoil (CameraKick). It
 * also carries the player's
 * personal light — the only shadow-casting light in the dungeon — whose
 * colour and strength come from the depth band (world/biomes `lantern`). */

/** Staff units → viewmodel units, and where on the shaft the fist closes. */
const STAFF_SCALE = 0.5;
const GRIP_Y = 0.64;
/** Albedo compensation for sitting inside the personal light's hot spot. */
const VIEW_DIM = 0.24;
/** Sleeve when no cloak is worn: undyed traveller's wool. */
const PLAIN_SLEEVE = "#4a4058";
/** Flare quad size in staff units (× STAFF_SCALE ≈ 0.28 m across). */
const FLARE_SIZE = 0.56;

const flareGeo = shared(() => new PlaneGeometry(1, 1));
const fwd = new Vector3();
const headWorld = new Vector3();
const moteAt = new Vector3();

export function StaffView() {
  const { camera } = useThree();
  const group = useRef<Group>(null);
  const rig = useRef<Group>(null);
  const head = useRef<Object3D>(null);
  const glows = useRef<MeshStandardMaterial[]>([]);
  const kick = useRef(0);
  const swayX = useRef(0);
  const bobT = useRef(0);
  const look = useRef({ yaw: 0, pitch: 0, lagYaw: 0, lagPitch: 0, init: false });
  const moteClock = useRef(0);
  const flare = useRef(0);

  const staffId = useGame((s) => s.equipment.staff.defId);
  const cloakId = useGame((s) => s.equipment.cloak?.defId);
  const shadows = useGame((s) => s.shadows);
  // Down in the dungeon the personal light takes the band's lantern tint
  // (world/biomes.ts): it lights everything near you, so it sets the mood.
  const lantern = useGame((s) =>
    s.floor > 0 && s.phase !== "village" ? getBiomeDef(biomeForFloor(s.floor)).lantern : null,
  );
  const staff = getItemDef(staffId);
  const style = staffStyle(staffId);
  const styleRef = useRef<StaffStyle>(style);
  styleRef.current = style;
  const sleeve = cloakId ? getItemDef(cloakId).color : PLAIN_SLEEVE;

  // The cast flare + idle aura (fx/staffGlow), parented to the viewmodel so
  // it is glued to the crystal however fast we move.
  const aura = useMemo(() => createStaffGlowMaterial(staff.color), [staff.color]);
  useEffect(() => () => aura.dispose(), [aura]);

  const onGlow = useCallback((m: MeshStandardMaterial[]) => {
    glows.current = m;
  }, []);

  useEffect(
    () =>
      gameEvents.on("staffKick", (v) => {
        kick.current = Math.min(1, kick.current + v);
        flare.current = 1;
        // Casting spits a little spray of the staff's motes.
        if (head.current) {
          head.current.getWorldPosition(headWorld);
          spawnBurst({
            position: headWorld,
            count: 3 + Math.round(v * 5),
            color: styleRef.current.motes,
            speed: 1.1,
            upward: 0.3,
            ttl: 0.35,
            size: 0.014,
            gravity: 0,
            drag: 3,
          });
        }
      }),
    [],
  );

  // Runs after the PlayerController (-2) has positioned the camera.
  useFrame(({ clock }, dt) => {
    const g = group.current;
    const r = rig.current;
    if (!g || !r) return;
    const t = clock.elapsedTime;
    // The recoil pose holds while the picture is held (a hitstop).
    kick.current *= Math.exp(-presentDt(dt) * 11);

    const hSpeed = Math.hypot(playerVelocity.x, playerVelocity.z);
    bobT.current += dt * (2.2 + hSpeed * 0.9);
    const targetSway = Math.min(hSpeed / 9, 1);
    swayX.current += (targetSway - swayX.current) * Math.min(1, dt * 6);

    // Look-lag: the staff trails a turn slightly, then catches up.
    camera.getWorldDirection(fwd);
    const yaw = Math.atan2(fwd.x, fwd.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, fwd.y)));
    const l = look.current;
    if (!l.init) {
      l.init = true;
      l.yaw = yaw;
      l.pitch = pitch;
    }
    let dYaw = yaw - l.yaw;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    const dPitch = pitch - l.pitch;
    l.yaw = yaw;
    l.pitch = pitch;
    l.lagYaw = Math.max(-0.12, Math.min(0.12, l.lagYaw + dYaw * 0.5));
    l.lagPitch = Math.max(-0.1, Math.min(0.1, l.lagPitch + dPitch * 0.5));
    const settle = Math.exp(-dt * 9);
    l.lagYaw *= settle;
    l.lagPitch *= settle;

    const breathe = Math.sin(t * 1.6);
    g.position.copy(camera.position);
    g.quaternion.copy(camera.quaternion);
    g.translateX(0.3 + Math.sin(bobT.current) * 0.012 * swayX.current - l.lagYaw * 0.35);
    g.translateY(
      -0.3 + Math.abs(Math.sin(bobT.current)) * 0.016 * swayX.current + breathe * 0.004 - kick.current * 0.025 + l.lagPitch * 0.25,
    );
    g.translateZ(-0.6 + kick.current * 0.09);

    // Rig: resting lean toward screen centre, plus recoil tip and sway roll.
    r.rotation.set(
      -0.32 + kick.current * 0.32 + breathe * 0.01,
      l.lagYaw * 0.8,
      0.2 + Math.sin(bobT.current * 0.5) * 0.03 * swayX.current + l.lagYaw * 0.6,
    );

    // A heavy spell coming ready gathers light; a streak burns hotter.
    const ready = readyGlow();
    const heat = streakHeat();
    const pulse = (0.85 + Math.sin(t * (2.6 + heat * 4)) * 0.15 + kick.current * 2.6 + ready * 1.8) * (1 + heat * 0.6);
    for (const m of glows.current) m.emissiveIntensity = (m.userData.baseIntensity ?? 2.5) * pulse;
    flare.current *= Math.exp(-dt * 13);
    aura.uniforms.uFlash.value = Math.max(flare.current, ready * 0.45, heat * 0.2);

    // Idle motes shed from the crystal, in the staff's own manner — more of
    // them on a streak, and drawn INTO it as a heavy spell gathers.
    moteClock.current -= dt;
    if (moteClock.current <= 0 && head.current) {
      moteClock.current = (0.09 + Math.random() * 0.08) / (1 + heat * 1.5 + ready * 2);
      head.current.getWorldPosition(headWorld);
      if (ready > 0.05 && Math.random() < 0.7) gatherMote(headWorld, styleRef.current);
      else spawnMote(headWorld, styleRef.current);
    }
  }, -1);

  return (
    <>
      <CameraKick />
      <group ref={group}>
        {/* Personal light — above the shoulder, a step behind the staff: close
            enough to light the room like a lantern, far enough that the staff's
            metal and crystal don't flare to white in its hot spot. */}
        <pointLight
          position={[-0.1, 0.55, 0.5]}
          color={lantern?.color ?? "#ffb877"}
          intensity={lantern?.intensity ?? 26}
          distance={17}
          decay={1.7}
          castShadow={shadows}
          shadow-mapSize={[512, 512]}
          shadow-bias={-0.02}
        />
        <pointLight position={[0, 0.05, -0.3]} color={staff.color} intensity={1.6} distance={4} decay={2} />
        <group ref={rig} position={[0, -0.05, 0]}>
          <HandModel sleeveColor={sleeve} dim={VIEW_DIM} />
          <group position={[0, -GRIP_Y * STAFF_SCALE, 0]} scale={STAFF_SCALE}>
            <StaffModel key={staffId} itemId={staffId} ownGlow onGlow={onGlow} shadows={false} dim={VIEW_DIM} />
            <object3D ref={head} position={[0, style.headY, 0]} />
            {/* Cast flare on the crystal, facing the eye with the rig. */}
            <mesh
              geometry={flareGeo()}
              material={aura}
              position={[0, style.headY, 0.04]}
              scale={FLARE_SIZE}
              renderOrder={4}
            />
          </group>
        </group>
      </group>
    </>
  );
}

const gatherDir = new Vector3();

/** A mote drawn into the crystal from just round it: a heavy spell
 * gathering itself. */
function gatherMote(at: Vector3, style: StaffStyle) {
  gatherDir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
  moteAt.copy(at).addScaledVector(gatherDir, 0.1);
  gatherDir.negate();
  spawnBurst({
    position: moteAt,
    count: 1,
    color: style.motes,
    speed: 0.45,
    upward: 0,
    ttl: 0.2,
    size: 0.012,
    gravity: 0,
    drag: 0.5,
    direction: gatherDir,
    cone: 0.15,
    inherit: playerVelocity,
  });
}

function spawnMote(at: Vector3, style: StaffStyle) {
  const jitter = (s: number) => (Math.random() - 0.5) * s;
  const position = moteAt.set(at.x + jitter(0.05), at.y + jitter(0.05), at.z + jitter(0.05));
  switch (style.moteKind) {
    case "ember":
      spawnBurst({ position, count: 1, color: style.motes, speed: 0.15, upward: 0.35, ttl: 0.9, size: 0.012, gravity: 0.35, drag: 1.2 });
      break;
    case "spark":
      spawnBurst({ position, count: 2, color: style.motes, speed: 1.4, upward: 0, ttl: 0.14, size: 0.01, gravity: 0, drag: 4 });
      break;
    case "sink":
      spawnBurst({ position, count: 1, color: style.motes, speed: 0.12, upward: -0.1, ttl: 1.1, size: 0.012, gravity: -0.15, drag: 1.5 });
      break;
    default:
      spawnBurst({ position, count: 1, color: style.motes, speed: 0.22, upward: 0.12, ttl: 1.0, size: 0.011, gravity: 0, drag: 1.4 });
  }
}
