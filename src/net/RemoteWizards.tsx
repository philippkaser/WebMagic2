import { useFrame } from "@react-three/fiber";
import { CapsuleCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useRef, useState } from "react";
import { Group, Sprite, SpriteMaterial } from "three";
import { PLAYER } from "../core/config";
import { gameEvents } from "../core/events";
import { hashSeed } from "../core/rng";
import { offerInteraction } from "../game/interactions";
import { playerPosition } from "../game/player-state";
import { allocId, registerHittable } from "../game/registry";
import { COLLISION } from "../physics/groups";
import { pixelLabel } from "../render/models/pixelLabel";
import { knownStaffId } from "../render/models/StaffModel";
import { WizardModel, type WizardMotion } from "../render/models/WizardModel";
import { useGame } from "../state/gameStore";
import { isAlly, useNet } from "./netStore";
import { session } from "./session";

/** Other wizards on this floor instance. Each is a kinematic capsule proxy
 * that follows the peer's broadcast transform: solid to walk into, and a
 * hittable target — our own spells landing on it are sent to that wizard's
 * client as `pvpHit` (shooter-authoritative, like enemy hits). Walk up to one
 * to offer (or accept) a pact. */
export function RemoteWizards() {
  const [peerIds, setPeerIds] = useState<string[]>([]);
  const pollClock = useRef(0);

  useFrame((_, dt) => {
    pollClock.current -= dt;
    if (pollClock.current > 0) return;
    pollClock.current = 0.25;
    const ids = [...session.peers.keys()].filter((id) => id !== session.playerId);
    setPeerIds((prev) => (prev.length === ids.length && prev.every((id, i) => id === ids[i]) ? prev : ids));
  });

  const phase = useGame((s) => s.phase);
  if (phase !== "dungeon") return null;
  return (
    <>
      {peerIds.map((id) => (
        <RemoteWizard key={id} playerId={id} />
      ))}
    </>
  );
}

const ROBE_COLORS = ["#3d5a8a", "#6a3d8a", "#8a3d50", "#3d8a5f", "#8a6a3d"];
/** Name tags only resolve up close: a distant silhouette is just "someone". */
const TAG_RANGE = 16;
const PACT_RANGE_SQ = 9;
/** Eye glow: pact allies burn green, strangers red. */
const ALLY_EYES = "#7dffa0";
const STRANGER_EYES = "#ff6b5a";

function RemoteWizard({ playerId }: { playerId: string }) {
  const group = useRef<Group>(null);
  const body = useRef<RapierRigidBody>(null);
  const tag = useRef<Sprite>(null);
  const initialized = useRef(false);
  const tagKey = useRef("");
  const motion = useRef<WizardMotion>({ speed: 0, cast: 0 });
  const offered = useRef(false);
  const allies = useNet((s) => s.allies);
  const ally = allies.includes(playerId);
  const robeColor = ROBE_COLORS[hashSeed(playerId) % ROBE_COLORS.length];
  const [staffId, setStaffId] = useState("apprentice_staff");

  // Their casts raise the staff arm.
  useEffect(
    () =>
      gameEvents.on("peerCast", (ev) => {
        if (ev.playerId === playerId) motion.current.cast = 1;
      }),
    [playerId],
  );

  // Hittable: our explosions reaching this proxy become a pvpHit.
  useEffect(() => {
    return registerHittable({
      id: allocId(),
      team: "wizard",
      getPosition: () => body.current?.translation() ?? { x: 0, y: -999, z: 0 },
      hit: (damage, impulse) => {
        const friendly = isAlly(playerId);
        session.sendPvpHit(playerId, friendly ? 0 : damage, impulse);
        if (!friendly && damage > 0.5) gameEvents.emit("hitConfirm", { kind: "wizard" });
      },
    });
  }, [playerId]);

  useFrame((_, dt) => {
    const g = group.current;
    const b = body.current;
    const peer = session.peers.get(playerId);
    if (!g || !b || !peer) return;
    // Placeholder until their first broadcast: keep them hidden below the
    // world instead of interpolating up from the void.
    const known = peer.position.y > -100;
    g.visible = known;
    if (!known) return;
    if (!initialized.current) {
      initialized.current = true;
      g.position.set(peer.position.x, peer.position.y, peer.position.z);
      g.rotation.y = peer.yaw;
      b.setTranslation(peer.position, false);
      return;
    }
    const k = Math.min(1, dt * 12);
    const dx = peer.position.x - g.position.x;
    const dz = peer.position.z - g.position.z;
    g.position.x += dx * k;
    g.position.y += (peer.position.y - g.position.y) * k;
    g.position.z += dz * k;
    let dyaw = peer.yaw - g.rotation.y;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    g.rotation.y += dyaw * k;
    b.setNextKinematicTranslation({ x: g.position.x, y: g.position.y, z: g.position.z });

    // Gait comes from how fast the proxy is actually moving.
    const speed = Math.min(Math.hypot(dx, dz) / Math.max(dt, 0.001), 12);
    motion.current.speed += (speed - motion.current.speed) * Math.min(1, dt * 8);

    const staff = knownStaffId(peer.staffId);
    if (staff !== staffId) setStaffId(staff);

    // Name tag: only up close; red for strangers, green for pact allies.
    const d2 = g.position.distanceToSquared(playerPosition);
    const near = d2 < TAG_RANGE * TAG_RANGE;
    const key = near ? `${peer.name}|${peer.gear}|${Math.ceil(peer.hp * 10)}|${ally}` : "?";
    if (tag.current && key !== tagKey.current) {
      tagKey.current = key;
      setTag(tag.current, near ? nameTagMaterial(peer.name, peer.gear, peer.hp, ally) : unknownTag());
    }

    // Pacts: walk up to a wizard to offer one — or accept theirs.
    if (!ally && d2 < PACT_RANGE_SQ) {
      const theyOffered = useNet.getState().pactOffers.includes(playerId);
      if (theyOffered) {
        offerInteraction(`E — Accept ${peer.name}'s pact`, d2, () => session.offerPact(playerId));
      } else if (!offered.current) {
        offerInteraction(`E — Offer ${peer.name} a pact (spells spare each other)`, d2, () => {
          offered.current = true;
          session.offerPact(playerId);
          gameEvents.emit("message", `You offer ${peer.name} a pact…`);
        });
      }
    }
  });

  return (
    <>
      <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[0, -999, 0]}>
        <CapsuleCollider args={[PLAYER.halfHeight, PLAYER.radius]} collisionGroups={COLLISION.peer} />
      </RigidBody>
      <group ref={group}>
        <WizardModel
          robeColor={robeColor}
          eyeColor={ally ? ALLY_EYES : STRANGER_EYES}
          staffId={staffId}
          motion={motion}
        />
        <sprite ref={tag} position={[0, 1.4, 0]} material={unknownTag()} scale={unknownTag().userData.size.concat(1)} />
      </group>
    </>
  );
}

// ── Name tags: pixel-font plaques (render/models/pixelLabel) ────────────────

function setTag(sprite: Sprite, material: SpriteMaterial) {
  sprite.material = material;
  const [w, h] = material.userData.size as [number, number];
  sprite.scale.set(w, h, 1);
}

function unknownTag(): SpriteMaterial {
  return pixelLabel({ lines: [{ text: "?", color: "#ff8f7a" }], accent: "#8a2a2a" });
}

function nameTagMaterial(name: string, gear: number, hp: number, ally: boolean): SpriteMaterial {
  return pixelLabel({
    lines: [{ text: `${name} ◆${gear}`, color: ally ? "#b8f5c4" : "#ffc2b0" }],
    accent: ally ? "#4fd08a" : "#d84a4a",
    pips: { filled: Math.ceil(hp * 10), total: 10, color: ally ? "#4fd08a" : "#e0503a" },
  });
}
