import { useFrame } from "@react-three/fiber";
import { CapsuleCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useRef, useState } from "react";
import { CanvasTexture, Group, LinearFilter, Sprite, SpriteMaterial } from "three";
import { PLAYER } from "../core/config";
import { gameEvents } from "../core/events";
import { hashSeed } from "../core/rng";
import { offerInteraction } from "../game/interactions";
import { playerPosition } from "../game/player-state";
import { allocId, registerHittable } from "../game/registry";
import { getItemDef, hasItemDef } from "../items/catalog";
import { COLLISION } from "../physics/groups";
import { WizardModel } from "../render/models/WizardModel";
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

function RemoteWizard({ playerId }: { playerId: string }) {
  const group = useRef<Group>(null);
  const body = useRef<RapierRigidBody>(null);
  const tag = useRef<Sprite>(null);
  const initialized = useRef(false);
  const tagKey = useRef("");
  const bob = useRef(0);
  const offered = useRef(false);
  const allies = useNet((s) => s.allies);
  const ally = allies.includes(playerId);
  const robeColor = ROBE_COLORS[hashSeed(playerId) % ROBE_COLORS.length];
  const [staffColor, setStaffColor] = useState("#7fd4ff");

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

    // Walk bob scaled by how fast they're moving.
    const speed = Math.hypot(dx, dz) / Math.max(dt, 0.001);
    bob.current += dt * Math.min(speed, 10);
    g.children[0].position.y = -0.1 + Math.abs(Math.sin(bob.current * 1.4)) * Math.min(speed * 0.01, 0.06);

    const color = hasItemDef(peer.staffId) ? getItemDef(peer.staffId).color : "#7fd4ff";
    if (color !== staffColor) setStaffColor(color);

    // Name tag: only up close; red for strangers, green for pact allies.
    const d2 = g.position.distanceToSquared(playerPosition);
    const near = d2 < TAG_RANGE * TAG_RANGE;
    const key = near ? `${peer.name}|${peer.gear}|${Math.ceil(peer.hp * 10)}|${ally}` : "?";
    if (tag.current && key !== tagKey.current) {
      tagKey.current = key;
      tag.current.material = near ? nameTagMaterial(peer.name, peer.gear, peer.hp, ally) : unknownTag();
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
        <group>
          <WizardModel robeColor={robeColor} staffColor={staffColor} />
        </group>
        <sprite ref={tag} position={[0, 1.85, 0]} scale={[1.6, 0.4, 1]} material={unknownTag()} />
      </group>
    </>
  );
}

// ── Name tags: canvas sprites, no font downloads ─────────────────────────────

const tagCache = new Map<string, SpriteMaterial>();

function makeTag(key: string, draw: (ctx: CanvasRenderingContext2D) => void): SpriteMaterial {
  const hit = tagCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  draw(ctx);
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  const material = new SpriteMaterial({ map: texture, depthWrite: false, transparent: true });
  if (tagCache.size > 200) tagCache.clear();
  tagCache.set(key, material);
  return material;
}

function unknownTag(): SpriteMaterial {
  return makeTag("?", (ctx) => {
    ctx.font = "bold 30px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(200,60,60,0.8)";
    ctx.fillText("?", 128, 30);
  });
}

function nameTagMaterial(name: string, gear: number, hp: number, ally: boolean): SpriteMaterial {
  const pips = Math.ceil(hp * 10);
  return makeTag(`${name}|${gear}|${pips}|${ally}`, (ctx) => {
    ctx.font = "bold 22px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label = `${name} · ${gear}`;
    const width = Math.min(ctx.measureText(label).width + 22, 250);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(128 - width / 2, 4, width, 30);
    ctx.fillStyle = ally ? "#8fe3a0" : "#ff8f7a";
    ctx.fillText(label, 128, 20);
    // Health pips
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(68, 40, 120, 12);
    for (let i = 0; i < pips; i++) {
      ctx.fillStyle = ally ? "#4fd08a" : "#d84a4a";
      ctx.fillRect(70 + i * 12, 42, 10, 8);
    }
  });
}
