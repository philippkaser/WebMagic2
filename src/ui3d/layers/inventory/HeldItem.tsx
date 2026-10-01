import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Group, Vector3 } from "three";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { ItemModel } from "../../ItemModel";
import { Plate } from "../../Plate";
import { UiShow } from "../../presence";
import { measureText, RuneText } from "../../text/RuneText";
import { ink, type FrameKind } from "../../theme";
import { emitUiSparks } from "../../UiSparks";
import type { HintTone } from "./dropTarget";
import { DRAG_Z, useInventory, useInventoryVersion, type Flight } from "./interaction";
import { SCENE_DISTANCE, STALL, TEXT } from "./layout";
import { INK } from "./materials";
import { HELD_SCALE } from "./PointerController";
import { restPose } from "./Socket";

/** The item in your hand while you drag it: bigger than at rest (it's
 * nearer), trailing the pointer with a little weight and swinging with its
 * motion. Under it hangs a small grimoire plate whose small caps say what
 * letting go will do — EQUIP, SWAP, SELL · 12 GOLD, DROP — framed in the
 * deed's colour (arcane, gold, blood, iron), forging itself each time the
 * meaning changes; and over empty air the item starts to shed embers, the
 * way things do just before they fall. */

const HINT_PX = pxFor(SCENE_DISTANCE - DRAG_Z, TEXT.hint);
const TONE: Record<HintTone, string> = { accent: ink.arcane, gold: INK.gold, danger: "#ff6a5a", dim: ink.parchmentDim };
const TONE_FRAME: Record<HintTone, FrameKind> = { accent: "arcane", gold: "gold", danger: "blood", dim: "iron" };

const tmpW = new Vector3();

export function HeldItem() {
  const ix = useInventory();
  useInventoryVersion(ix);
  const held = ix.held;
  const drag = ix.drag;
  const size = drag ? ix.sockets.get(drag.fromKey)?.spec.size ?? 0.17 : 0.17;
  const pose = held ? restPose(held.itemId, size) : null;

  const group = useRef<Group>(null);
  const swing = useRef<Group>(null);
  const prev = useRef(new Vector3());
  const vel = useRef(new Vector3());
  const sparkClock = useRef(0);
  const tag = useRef<Group>(null);
  const tagOpen = useRef(0);
  useLayoutEffect(() => {
    if (drag && group.current) {
      group.current.position.copy(drag.point);
      prev.current.copy(drag.point);
      vel.current.set(0, 0, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held?.itemId, drag?.fromKey]);

  // Keep the last hint so it can dissolve instead of vanishing.
  const [hint, setHint] = useState(held?.hint ?? null);
  useEffect(() => {
    if (held?.hint) setHint(held.hint);
  }, [held?.hint]);

  useFrame((_, rawDt) => {
    const g = group.current;
    const d = ix.drag;
    if (!g || !d) return;
    const dt = Math.max(1e-3, Math.min(rawDt, 0.05));
    // The plate forges and fades itself; the tag only lingers long enough.
    tagOpen.current = ix.held?.hint ? 1 : Math.max(0, tagOpen.current - dt * 3);
    if (tag.current) {
      tag.current.visible = tagOpen.current > 0.01;
    }
    g.position.lerp(d.point, 1 - Math.exp(-dt * 28));
    vel.current.subVectors(g.position, prev.current).divideScalar(dt);
    prev.current.copy(g.position);
    const s = swing.current;
    if (s) {
      const k = 1 - Math.exp(-dt * 10);
      s.rotation.z += (Math.max(-0.6, Math.min(0.6, -vel.current.x * 0.5)) - s.rotation.z) * k;
      s.rotation.x += (Math.max(-0.5, Math.min(0.5, vel.current.y * 0.4)) - s.rotation.x) * k;
      s.rotation.y += dt * 0.8;
    }
    // Over the void it smoulders: this is about to fall.
    if (d.action.kind === "drop" || d.action.kind === "discard") {
      sparkClock.current += dt;
      if (sparkClock.current > 0.06) {
        sparkClock.current = 0;
        g.getWorldPosition(tmpW);
        emitUiSparks({ position: [tmpW.x, tmpW.y - 0.03, tmpW.z], color: "#ff6a5a", count: 2, speed: 0.06, up: -0.1, size: 0.008, spread: 0.06, ttl: 0.6 });
      }
    }
  });

  if (!held || !pose) return null;
  const hintOn = !!held.hint;
  const tagSize = hint ? measureText(hint.text, HINT_PX, undefined, "label") : { width: 0, height: 0 };
  const tw = tagSize.width + HINT_PX * 8;
  const th = HINT_PX * 7 + HINT_PX * 6;
  return (
    <group ref={group}>
      <group ref={swing}>
        <group rotation={[0, pose.rotY, pose.rotZ]}>
          <ItemModel itemId={held.itemId} scale={pose.scale * HELD_SCALE} highlight={0.35} />
        </group>
      </group>
      {hint && (
        <group ref={tag} position={[0, -size * 0.95, 0.02]} visible={false}>
          <UiShow show={hintOn}>
            <Plate key={hint.text} width={tw} height={th} frame={TONE_FRAME[hint.tone]} texel={HINT_PX * 0.9} fillOpacity={0.94} forgeTime={0.18}>
              <RuneText
                text={hint.text}
                font="label"
                px={HINT_PX}
                color={TONE[hint.tone]}
                glow={0.9}
                depth={-0.3}
                inDuration={0.15}
                outDuration={0.15}
              />
            </Plate>
          </UiShow>
        </group>
      )}
    </group>
  );
}

// ── Items leaving: falling to the floor, burning away, sold to Maro ──────────

export function Flights() {
  const ix = useInventory();
  const [list, setList] = useState<Flight[]>([]);
  useEffect(() => {
    let id = 1;
    ix.launch = (f) => setList((l) => [...l, { ...f, id: id++ }]);
    return () => {
      ix.launch = null;
    };
  }, [ix]);
  return (
    <>
      {list.map((f) => (
        <FlightItem key={f.id} flight={f} onDone={() => setList((l) => l.filter((x) => x.id !== f.id))} />
      ))}
    </>
  );
}

const FALL_TIME = 1.1;
const BURN_TIME = 0.7;
const SELL_TIME = 0.5;

function FlightItem({ flight, onDone }: { flight: Flight; onDone: () => void }) {
  const ix = useInventory();
  const group = useRef<Group>(null);
  const t0 = useRef(uiNow());
  const done = useRef(false);
  const spin = useRef(new Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6));
  const target = useRef<Vector3 | null>(null);
  const pose = restPose(flight.itemId, 0.17);
  const sparkClock = useRef(0);

  useLayoutEffect(() => {
    if (flight.kind !== "sell") return;
    // Maro's trough, in root space.
    const stall = ix.surfaces.get("stall");
    if (!stall || !ix.root) return;
    const p = new Vector3(0, STALL.trayY, 0.02);
    stall.object.localToWorld(p);
    target.current = ix.root.worldToLocal(p);
  }, [flight.kind, ix]);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g || done.current) return;
    const t = uiNow() - t0.current;
    const f0 = flight.from;
    let scale = pose.scale * HELD_SCALE;
    let end = 0;
    if (flight.kind === "fall") {
      // Tossed a touch toward you, then gravity takes it out of sight.
      end = FALL_TIME;
      g.position.set(f0.x + t * 0.05, f0.y + t * 0.35 - 3.2 * t * t, f0.z + t * 0.5);
      scale *= Math.max(0, 1 - Math.max(0, t - FALL_TIME * 0.6) / (FALL_TIME * 0.4));
    } else if (flight.kind === "burn") {
      // Shudders, then crumbles into embers.
      end = BURN_TIME;
      const k = t / BURN_TIME;
      g.position.set(f0.x + Math.sin(t * 60) * 0.004 * (1 - k), f0.y + t * 0.05, f0.z);
      scale *= Math.max(0, 1 - k * k);
      sparkClock.current += dt;
      if (sparkClock.current > 0.03) {
        sparkClock.current = 0;
        g.getWorldPosition(tmpW);
        emitUiSparks({ position: [tmpW.x, tmpW.y, tmpW.z], color: k < 0.5 ? "#ff6a5a" : "#ffb070", count: 4, speed: 0.15, up: 0.12, size: 0.01, spread: 0.08 * (1 - k * 0.5), ttl: 0.8 });
      }
    } else {
      // Into Maro's trough in an arc; coins answer.
      end = SELL_TIME;
      const to = target.current ?? f0;
      const k = Math.min(1, t / SELL_TIME);
      const e = k * k * (3 - 2 * k);
      g.position.lerpVectors(f0, to, e);
      g.position.y += Math.sin(k * Math.PI) * 0.12;
      scale *= 1 - e * 0.85;
    }
    g.rotation.set(spin.current.x * t * 0.3, spin.current.y * t * 0.3 + pose.rotY, spin.current.z * t * 0.3 + pose.rotZ);
    g.scale.setScalar(Math.max(0.0001, scale));
    if (t >= end) {
      done.current = true;
      g.getWorldPosition(tmpW);
      if (flight.kind === "sell") {
        emitUiSparks({ position: [tmpW.x, tmpW.y, tmpW.z], color: INK.gold, count: 26, speed: 0.35, up: 0.2, size: 0.011, spread: 0.06, ttl: 0.9 });
      } else if (flight.kind === "burn") {
        emitUiSparks({ position: [tmpW.x, tmpW.y, tmpW.z], color: "#ffb070", count: 12, speed: 0.2, up: 0.15, size: 0.01, spread: 0.05, ttl: 0.9 });
      }
      onDone();
    }
  });

  return (
    <group ref={group} position={flight.from} scale={0.0001}>
      <ItemModel itemId={flight.itemId} />
    </group>
  );
}
