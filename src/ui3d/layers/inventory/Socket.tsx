import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Group, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from "three";
import { resolveItem } from "../../../items/catalog";
import type { GearSlot } from "../../../items/types";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { ItemModel } from "../../ItemModel";
import { stoneMaterial } from "../../materials";
import { useUiShow } from "../../presence";
import { RuneText } from "../../text/RuneText";
import { emitUiSparks } from "../../UiSparks";
import { useCell, useInventory, type InventoryInteraction } from "./interaction";
import { SCENE_DISTANCE, TEXT, type SocketSpec } from "./layout";
import { bronze, frameGeometry, INK, plane, spillMaterial, wellMaterial } from "./materials";

/** One socket: a square opening carved into a tablet, a dark well inside it,
 * and whatever rests there.
 *
 * It rises out of the stone when the tablet has assembled (centre first),
 * and it talks with light: a faint seam at rest; brighter under the pointer;
 * while you drag, every socket that would take the item kindles and pulses
 * and the rest go dark; the one under the pointer blazes and spills light
 * onto the stone around it. */

const LABEL_PX = pxFor(SCENE_DISTANCE, TEXT.label);
const GEAR_GLYPH: Record<GearSlot, string> = { staff: "✦", amulet: "◇", cloak: "▲", boots: "●" };

/** Seconds after the tablet shows before the first socket rises. */
const RISE_DELAY = 0.02;
const RISE_SPREAD = 0.25;
const RISE_TIME = 0.32;

export interface SocketProps {
  spec: SocketSpec;
  /** Seam and light colour. */
  accent?: string;
  /** Replace the item (a ware that isn't an item, like the Orb of Fortune);
   * gets the time the socket began to rise, for its own entrance. */
  children?: (riseAt: { readonly current: number }) => ReactNode;
  /** The item shown, for sockets that aren't inventory cells (wares). */
  wareItem?: string | null;
}

export function Socket({ spec, accent = INK.accent, children, wareItem = null }: SocketProps) {
  const ix = useInventory();
  const show = useUiShow();
  const cell = useCell(spec.ref);
  const itemId = spec.ref ? cell.itemId : wareItem;
  const well = useMemo(() => wellMaterial(accent, spec.variant === "ware" ? "#120d0a" : "#0c0a10"), [accent, spec.variant]);
  const rim = spec.variant === "gear" ? 0.026 : spec.variant === "chest" ? 0.016 : 0.02;
  const spillScale = spec.size * 2.3;
  const spill = useMemo(() => spillMaterial(accent, (spec.size + rim * 2) / spillScale), [accent, spec.size, rim, spillScale]);
  useEffect(
    () => () => {
      well.dispose();
      spill.dispose();
    },
    [well, spill],
  );
  const frame = frameGeometry(spec.size, spec.size, rim, spec.variant === "gear" ? 0.018 : 0.014);
  const frameMat = spec.variant === "belt" || spec.variant === "ware" ? bronze() : stoneMaterial("#5d5767");

  const body = useRef<Group>(null);
  const spillMesh = useRef<Mesh>(null);
  const shownAt = useRef(uiNow());
  const k = useRef({ seam: 0, pool: 0, spill: 0, rise: 0 });
  useEffect(() => {
    if (show) shownAt.current = uiNow();
  }, [show]);

  useFrame((_, dt) => {
    const now = uiNow();
    const s = k.current;
    // Rise out of the stone / sink back into it.
    const t = (now - shownAt.current - RISE_DELAY - spec.order * RISE_SPREAD) / RISE_TIME;
    const riseTarget = show ? Math.min(1, Math.max(0, t)) : 0;
    s.rise = show ? riseTarget : Math.max(0, s.rise - dt * 4);
    const b = body.current;
    if (b) {
      const e = s.rise <= 0 ? 0 : backOut(s.rise);
      b.scale.setScalar(Math.max(0.0001, 0.4 + 0.6 * e));
      b.position.z = -0.03 * (1 - e);
      b.visible = s.rise > 0;
    }

    // What the light should be doing.
    const [seam, pool, sp] = kindle(ix, spec.key, itemId !== null, now);
    const q = 1 - Math.exp(-dt * 12);
    s.seam += (seam * s.rise - s.seam) * q;
    s.pool += (pool * s.rise - s.pool) * q;
    s.spill += (sp * s.rise - s.spill) * q;
    well.uniforms.uSeam.value = s.seam;
    well.uniforms.uPool.value = s.pool;
    spill.uniforms.uIntensity.value = s.spill;
    if (spillMesh.current) spillMesh.current.visible = s.spill > 0.01;
  });

  const icon =
    spec.variant === "gear" && spec.ref?.container === "equipment" && !itemId ? GEAR_GLYPH[spec.ref.slot] : null;

  return (
    <group position={[spec.x, spec.y, 0]}>
      <mesh
        ref={spillMesh}
        geometry={plane()}
        material={spill}
        scale={spillScale}
        position={[0, 0, 0.0005]}
        renderOrder={3}
        visible={false}
      />
      <group ref={body}>
        <mesh geometry={frame} material={frameMat} />
        <mesh geometry={plane()} material={well} scale={spec.size} position={[0, 0, 0.002]} />
      </group>
      {icon && (
        <RuneText text={icon} px={spec.size / 16} color="#3a3445" glow={0.2} outline={0} position={[0, 0, 0.006]} delay={0.3 + spec.order * 0.3} />
      )}
      {spec.label && (
        <RuneText
          text={spec.label}
          px={LABEL_PX}
          color={spec.variant === "belt" ? INK.accent : INK.dim}
          glow={0.5}
          position={[0, -spec.size / 2 - rim - LABEL_PX * 7, 0.004]}
          delay={0.15 + spec.order * 0.3}
        />
      )}
      {children
        ? children(shownAt)
        : itemId && (
          <SocketItem
            key={itemId}
            spec={spec}
            itemId={itemId}
            qty={spec.ref ? cell.qty : 1}
            runLoot={spec.ref ? cell.runLoot : false}
            riseAt={shownAt}
          />
        )}
    </group>
  );
}

/** Seam, pool and spill intensity for a socket right now. */
function kindle(ix: InventoryInteraction, key: string, filled: boolean, now: number): [number, number, number] {
  const drag = ix.drag;
  if (drag) {
    if (drag.fromKey === key) return [0.3, 0, 0];
    if (!drag.accepts.has(key)) return [0, 0, 0];
    if (drag.targetKey === key) return [2.6, 0.55, 1.1];
    const pulse = 0.75 + 0.25 * Math.sin(now * 6 + key.length);
    return [0.95 * pulse, 0.025, 0.14 * pulse];
  }
  if (ix.hover === key) return filled ? [1.1, 0.22, 0.45] : [0.6, 0.08, 0.15];
  if (ix.compareKey === key) return [0.7, 0.08, 0.2];
  return [0.16, 0, 0];
}

function backOut(t: number): number {
  const s = 1.6;
  const u = t - 1;
  return 1 + u * u * ((s + 1) * u + s);
}

// ── The item resting in a socket ─────────────────────────────────────────────

interface Pose {
  scale: number;
  rotZ: number;
  rotY: number;
  z: number;
}

/** How an item family rests in its socket: staffs lie diagonally so they
 * can be long, boots turn three-quarters so they read as a pair. */
export function restPose(itemId: string, size: number): Pose {
  const slot = resolveItem(itemId).def.slot;
  switch (slot) {
    case "staff":
      return { scale: size * 1.2, rotZ: -0.78, rotY: 0, z: 0.05 };
    case "boots":
      return { scale: size * 1.1, rotZ: 0, rotY: 0.55, z: 0.05 };
    case "amulet":
      return { scale: size * 1.05, rotZ: 0, rotY: 0, z: 0.045 };
    case "cloak":
      return { scale: size * 1.02, rotZ: 0, rotY: 0.3, z: 0.05 };
    default:
      return { scale: size * 1.08, rotZ: 0, rotY: 0.2, z: 0.05 };
  }
}

const FLY_TIME = 0.32;
const tmpFrom = new Vector3();

/** An item in its socket: appears with a pop once the socket has risen,
 * lifts toward you under the pointer, vanishes while it's in your hand, and
 * flies in from wherever it came from when it changes place (arrival hints,
 * interaction.ts). When the tablet breaks it tumbles away with the stones. */
export function SocketItem({
  spec,
  itemId,
  qty = 1,
  runLoot = false,
  model,
  riseAt,
}: {
  spec: SocketSpec;
  itemId: string;
  qty?: number;
  runLoot?: boolean;
  /** Something other than an ItemModel (the Orb of Fortune). */
  model?: ReactNode;
  /** When the socket began to rise (its item appears just after). */
  riseAt: { readonly current: number };
}) {
  const ix = useInventory();
  const show = useUiShow();
  const outer = useRef<Group>(null);
  const spinner = useRef<Group>(null);
  const glow = useRef(0);
  const pose = useMemo(() => (model ? { scale: spec.size * 1.1, rotZ: 0, rotY: 0, z: 0.05 } : restPose(itemId, spec.size)), [itemId, spec.size, model]);
  const st = useRef({
    appear: 0,
    lift: 0,
    turn: 0,
    fly: null as null | { from: Vector3; t0: number; scale: number },
    consumed: 0,
    fall: 0,
    fallV: new Vector3(),
    fallSpin: 0,
    landed: false,
    /** Only something that has appeared can fall away. */
    everShown: false,
  });
  const [showQty, setShowQty] = useState(false);
  useEffect(() => {
    if (show) {
      st.current.fall = 0;
      st.current.appear = 0;
      st.current.everShown = true;
    } else {
      // Tumble away with the stones: a little toss, then gravity.
      const s = st.current;
      s.fallV.set((Math.random() - 0.5) * 0.4, 0.25 + Math.random() * 0.3, 0.2 + Math.random() * 0.3);
      s.fallSpin = (Math.random() - 0.5) * 8;
    }
  }, [show]);

  useFrame((_, dt) => {
    const g = outer.current;
    if (!g) return;
    const now = uiNow();
    const s = st.current;

    // A hint says this item just came from somewhere: fly in from there.
    const hint = ix.arrivals.get(spec.key);
    if (hint && hint.at > s.consumed) {
      s.consumed = hint.at;
      ix.arrivals.delete(spec.key);
      if (now - hint.at < 0.6 && g.parent) {
        ix.rootToLocal(g.parent, hint.point, tmpFrom);
        s.fly = { from: tmpFrom.clone(), t0: now, scale: hint.scale };
        s.appear = 1;
        s.landed = false;
      }
    }

    const inHand = ix.drag?.fromKey === spec.key;
    g.visible = !inHand && (show || s.everShown);
    if (!g.visible) return;

    // Appear once the socket has risen (at once if it rose long ago: an
    // item that just changed places mustn't wait for the build ripple).
    if (show && now >= riseAt.current + 0.12 + spec.order * RISE_SPREAD) s.appear = Math.min(1, s.appear + dt / 0.25);
    const hovered = ix.hover === spec.key && !ix.drag && show;
    const q = 1 - Math.exp(-dt * 10);
    s.lift += ((hovered ? 1 : 0) - s.lift) * q;
    glow.current = s.lift * 0.5;

    let x = 0;
    let y = 0;
    let z = pose.z + s.lift * 0.07;
    let scale = pose.scale * (1 + s.lift * 0.16);
    if (s.fly) {
      const f = Math.min(1, (now - s.fly.t0) / FLY_TIME);
      const e = 1 - (1 - f) ** 3;
      x = s.fly.from.x * (1 - e);
      y = s.fly.from.y * (1 - e);
      // An arc toward you, as if carried by a hand.
      z = s.fly.from.z * (1 - e) + z * e + Math.sin(f * Math.PI) * 0.06;
      scale = (pose.scale * s.fly.scale) * (1 - e) + scale * e;
      if (f >= 1) {
        s.fly = null;
        if (!s.landed) {
          s.landed = true;
          const p = g.getWorldPosition(tmpFrom);
          emitUiSparks({ position: [p.x, p.y, p.z], color: INK.accent, count: 8, speed: 0.18, up: 0.05, size: 0.008, spread: spec.size * 0.5, ttl: 0.5 });
        }
      }
    }
    if (!show) {
      // Falling away as the tablet breaks.
      s.fall += dt;
      const f = s.fall;
      x += s.fallV.x * f;
      y += s.fallV.y * f - 2.4 * f * f;
      z += s.fallV.z * f;
      scale *= Math.max(0, 1 - f / 0.9);
      g.rotation.z = s.fallSpin * f * 0.4;
    } else {
      g.rotation.z = 0;
      scale *= s.appear <= 0 ? 0 : backOut(Math.min(1, s.appear));
    }
    g.position.set(x, y, z);
    g.scale.setScalar(Math.max(0.0001, scale));
    const sp = spinner.current;
    if (sp) {
      // At rest: a slow sway. Lifted: it turns to show itself off.
      s.turn += dt * s.lift * 1.6;
      sp.rotation.y = pose.rotY * (1 - s.lift) + Math.sin(now * 0.7 + spec.order * 9) * 0.22 + s.turn;
      sp.rotation.z = pose.rotZ * (1 - s.lift * 0.35);
    }
    const wantQty = s.appear > 0.8 && show;
    if (wantQty !== showQty) setShowQty(wantQty);
  });

  const unit = 1 / pose.scale; // children below are in the item's scaled frame
  return (
    <group ref={outer} visible={false}>
      <group ref={spinner}>{model ?? <ItemModel itemId={itemId} highlightRef={glow} />}</group>
      {qty > 1 && (
        <RuneText
          text={`${qty}`}
          px={LABEL_PX * unit}
          color={INK.bright}
          glow={0.8}
          anchor={[1, 1]}
          position={[(spec.size / 2 - 0.012) * unit, (-spec.size / 2 + 0.012) * unit, 0.03 * unit]}
          show={showQty}
        />
      )}
      {runLoot && <RunLootMark unit={unit} half={spec.size / 2} />}
    </group>
  );
}

/** Unbanked loot wears a small pulsing gold ember in its corner: lost if you
 * fall before you bank it. */
function RunLootMark({ unit, half }: { unit: number; half: number }) {
  const m = useRef<Mesh>(null);
  useFrame(() => {
    if (m.current) m.current.scale.setScalar((0.008 + Math.sin(uiNow() * 4) * 0.002) * unit);
  });
  return <mesh ref={m} geometry={emberGeometry()} material={emberMaterial()} position={[(-half + 0.018) * unit, (half - 0.018) * unit, 0.02 * unit]} />;
}

let emberGeo: SphereGeometry | null = null;
let emberMat: MeshBasicMaterial | null = null;
const emberGeometry = () => (emberGeo ??= new SphereGeometry(1, 8, 6));
const emberMaterial = () => (emberMat ??= new MeshBasicMaterial({ color: INK.runLoot, toneMapped: false }));
