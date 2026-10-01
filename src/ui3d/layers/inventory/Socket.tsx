import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Group, PlaneGeometry, Vector3 } from "three";
import { resolveItem } from "../../../items/catalog";
import type { GearSlot } from "../../../items/types";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { ItemModel } from "../../ItemModel";
import { KeyCap } from "../../KeyCap";
import { useUiShow } from "../../presence";
import { RuneText, measureText } from "../../text/RuneText";
import { FRAMES, ink, type FrameColors } from "../../theme";
import { emitUiSparks } from "../../UiSparks";
import { cardFrame, cardMaterial, cardQuad } from "./card";
import { EMPTY_FRAME, gradeOf, litFrame, type Grade } from "./grade";
import { useCell, useInventory, type InventoryInteraction } from "./interaction";
import { SCENE_DISTANCE, TEXT, type SocketSpec } from "./layout";
import { PixelSprite, spriteSize, type SpriteName } from "./sprites";

/** One socket, drawn as a grimoire item card (artpass `.wm-card`): a
 * pixel-framed soot card whose frame takes the colour of what rests in it
 * (grade.ts: tier and enchantment), the grade's gem in the top corner, the
 * level (or stack count) on an ink plate in the bottom corner, and the item
 * itself as a small 3D model standing in the card.
 *
 * It still rises out of the stone when the tablet has assembled (centre
 * first) and its frame forges itself around it; and it still talks while you
 * drag — but in hard pixels, not soft light: every socket that would take
 * the item turns to an arcane frame that blinks in two steps, the one under
 * the pointer lights up with a solid ring and a wash, a socket that would
 * refuse it turns to blood, and the rest go dark. */

/** World size of a card's frame texel (≈2 screen px at 800 px tall). */
export const CARD_TEXEL = 0.0055;
const LABEL_PX = pxFor(SCENE_DISTANCE, TEXT.label);
const PLATE_PX = pxFor(SCENE_DISTANCE, 0.0115);

/** Seconds after the tablet shows before the first socket rises. */
const RISE_DELAY = 0.02;
const RISE_SPREAD = 0.25;
const RISE_TIME = 0.32;
const FORGE_TIME = 0.3;

const SLOT_SPRITE: Record<GearSlot, SpriteName> = { staff: "staff", amulet: "amulet", cloak: "cloak", boots: "boots" };
/** Empty-slot silhouettes: dark ghosts of what belongs there (artpass
 * shows them grey at 18%; an alpha-tested sprite can't be translucent, so
 * the tint itself is dimmed toward the card). */
const GHOST = "#3b3445";

const ARCANE_LIT = litFrame(FRAMES.arcane);
const NO_PLATE: [number, number] = [0, 0];
const BLOOD_LIT: FrameColors = { trim: FRAMES.blood.light, light: "#ffd0c8", dark: FRAMES.blood.trim };

let quadGeo: PlaneGeometry | null = null;
const quad = () => (quadGeo ??= new PlaneGeometry(1, 1));

export interface SocketProps {
  spec: SocketSpec;
  /** Replace the item (a ware that isn't an item, like the Orb of Fortune);
   * gets the time the socket began to rise, for its own entrance. */
  children?: (riseAt: { readonly current: number }) => ReactNode;
  /** The item shown, for sockets that aren't inventory cells (wares). */
  wareItem?: string | null;
  /** The card's grade when `children` replace the item. */
  grade?: Grade | null;
}

/** How a socket looks this frame. */
type Look = "rest" | "hover" | "compare" | "from" | "accepts" | "target" | "refuses" | "idle";

function lookOf(ix: InventoryInteraction, key: string): Look {
  const drag = ix.drag;
  if (drag) {
    if (drag.fromKey === key) return "from";
    if (drag.accepts.has(key)) return drag.targetKey === key ? "target" : "accepts";
    // Maro's wares never take anything: over them, the drop means "sell".
    return drag.overKey === key && !key.startsWith("ware:") ? "refuses" : "idle";
  }
  if (ix.hover === key) return "hover";
  if (ix.compareKey === key) return "compare";
  return "rest";
}

export function Socket({ spec, children, wareItem = null, grade: gradeProp = null }: SocketProps) {
  const ix = useInventory();
  const show = useUiShow();
  const cell = useCell(spec.ref);
  const itemId = spec.ref ? cell.itemId : wareItem;
  const qty = spec.ref ? cell.qty : 1;
  const item = useMemo(() => (itemId && !children ? resolveItem(itemId) : null), [itemId, children]);
  const grade = gradeProp ?? (item ? gradeOf(item) : null);
  const base = grade?.frame ?? EMPTY_FRAME;

  const material = useMemo(() => cardMaterial(spec.size, spec.size, CARD_TEXEL, EMPTY_FRAME), [spec.size]);
  useEffect(() => () => material.dispose(), [material]);
  const frames = useMemo(() => ({ base: cardFrame(base), lit: cardFrame(litFrame(base)) }), [base]);
  const quadLayout = cardQuad(spec.size, spec.size, material.uniforms.uShadow.value);

  // The plate: level for gear, ×n for stacks.
  const plateText = qty > 1 ? `×${qty}` : item && item.level > 0 ? `${item.level}` : null;
  const plate = useMemo(() => {
    if (!plateText) return null;
    const m = measureText(plateText, PLATE_PX, undefined, "label");
    const w = Math.ceil(m.width / CARD_TEXEL) + 4;
    const h = Math.ceil((PLATE_PX * 7) / CARD_TEXEL) + 4;
    return { w, h };
  }, [plateText]);
  const plateTexels = useMemo<[number, number]>(() => (plate ? [plate.w, plate.h] : NO_PLATE), [plate]);
  useEffect(() => {
    if (grade) material.uniforms.uPlateEdge.value.set(grade.color);
    material.uniforms.uGlow.value.set(grade?.color ?? "#000000");
  }, [material, grade]);

  const body = useRef<Group>(null);
  const marks = useRef<Group>(null);
  const shownAt = useRef(uiNow());
  const st = useRef({ rise: 0, fade: 0 });
  useEffect(() => {
    if (show) shownAt.current = uiNow();
  }, [show]);

  useFrame((_, dt) => {
    const now = uiNow();
    const s = st.current;
    const u = material.uniforms;
    // Rise out of the stone / sink back into it.
    const t = now - shownAt.current - RISE_DELAY - spec.order * RISE_SPREAD;
    s.rise = show ? Math.min(1, Math.max(0, t / RISE_TIME)) : Math.max(0, s.rise - dt * 4);
    u.uProgress.value = show ? Math.min(1, Math.max(0, t / FORGE_TIME)) : u.uProgress.value;
    // Fill and shadow come in (and go) in four hard steps.
    u.uBody.value = Math.round(s.rise * 4) / 4;
    u.uFade.value = show ? 1 : Math.round(s.rise * 4) / 4;

    const look = lookOf(ix, spec.key);
    const blink = Math.floor(now * 4) % 2 === 0;
    let frame = frames.base;
    let ringK = 0;
    let washK = 0;
    let dim = 0;
    let glowK = itemId ? 1 : 0;
    let lift = 0;
    switch (look) {
      case "hover":
        frame = frames.lit;
        glowK = itemId ? 1.8 : 0;
        lift = 1;
        if (!itemId) {
          ringK = 1;
          u.uRing.value.set(ink.stoneLight);
        }
        break;
      case "compare":
        frame = frames.lit;
        ringK = 1;
        u.uRing.value.set(ink.brass);
        break;
      case "from":
        frame = cardFrame(EMPTY_FRAME);
        glowK = 0;
        break;
      case "accepts":
        frame = cardFrame(FRAMES.arcane);
        ringK = blink ? 1 : 0;
        u.uRing.value.set(ink.arcaneDim);
        break;
      case "target":
        frame = cardFrame(ARCANE_LIT);
        ringK = 1;
        washK = 0.2;
        lift = 1;
        u.uRing.value.set(ink.arcane);
        u.uWash.value.set(ink.arcane);
        break;
      case "refuses":
        frame = cardFrame(BLOOD_LIT);
        ringK = 1;
        washK = 0.16;
        u.uRing.value.set(FRAMES.blood.light);
        u.uWash.value.set(ink.blood);
        break;
      case "idle":
        dim = 0.6;
        break;
    }
    u.uFrame.value = frame;
    u.uPlate.value = look === "from" ? NO_PLATE : plateTexels;
    if (marks.current) marks.current.visible = look !== "from";
    u.uRingK.value = ringK;
    u.uWashK.value = washK;
    u.uDim.value = dim;
    u.uGlowK.value = glowK;
    const b = body.current;
    if (b) {
      const e = s.rise <= 0 ? 0 : backOut(s.rise);
      b.scale.setScalar(Math.max(0.0001, 0.4 + 0.6 * e));
      // Lifted cards step up by whole texels (artpass: translate(0, -2px)).
      b.position.set(0, lift * CARD_TEXEL, -0.03 * (1 - e) + lift * 0.006);
      b.visible = s.rise > 0;
    }
  });

  const ghost =
    !itemId && spec.ref?.container === "equipment"
      ? SLOT_SPRITE[spec.ref.slot]
      : !itemId && spec.variant === "belt"
        ? "flask"
        : null;
  const half = spec.size / 2;
  const inset = CARD_TEXEL * 1.2;
  const labelY = -half - CARD_TEXEL * 3 - LABEL_PX * 4.5;

  return (
    <group position={[spec.x, spec.y, 0]}>
      <group ref={body} visible={false}>
        <mesh geometry={quad()} material={material} scale={quadLayout.scale} position={[quadLayout.offset[0], quadLayout.offset[1], 0]} renderOrder={5} />
        {ghost && (
          <PixelSprite
            name={ghost}
            tint={GHOST}
            px={(spec.size * 0.58) / spriteSize(ghost).h}
            position={[0, 0, 0.002]}
            delay={0.3 + spec.order * RISE_SPREAD}
            renderOrder={6}
          />
        )}
        <group ref={marks}>
          {grade && (itemId || children) && (
            <PixelSprite name="gem" tint={grade.color} px={CARD_TEXEL * 0.8} anchor={[0, 1]} position={[-half + inset, half - inset, 0.004]} delay={0.35 + spec.order * RISE_SPREAD} />
          )}
          {spec.ref && cell.runLoot && (
            <PixelSprite name="hourglass" tint="#ff8e5a" px={CARD_TEXEL * 0.8} anchor={[1, 1]} position={[half - inset, half - inset, 0.004]} delay={0.35 + spec.order * RISE_SPREAD} throb />
          )}
          {plate && plateText && (
            <RuneText
              text={plateText}
              font="label"
              px={PLATE_PX}
              color={ink.parchment}
              glow={0}
              outline={0}
              position={[half - (plate.w * CARD_TEXEL) / 2 + CARD_TEXEL * 0.5, -half + (plate.h * CARD_TEXEL) / 2, 0.004]}
              delay={0.4 + spec.order * RISE_SPREAD}
            />
          )}
        </group>
      </group>
      {spec.label && spec.variant === "belt" ? (
        <KeyCap k={spec.label} px={LABEL_PX * 0.8} position={[0, -half - CARD_TEXEL * 2 - LABEL_PX * 5, 0.004]} />
      ) : (
        spec.label && (
          <RuneText
            text={spec.label}
            font="label"
            px={LABEL_PX}
            color={ink.faded}
            glow={0.2}
            position={[0, labelY, 0.004]}
            delay={0.15 + spec.order * 0.3}
          />
        )
      )}
      {children
        ? children(shownAt)
        : itemId && (
          <SocketItem key={itemId} spec={spec} itemId={itemId} riseAt={shownAt} />
        )}
    </group>
  );
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

/** How an item family stands in its card: staffs lean corner to corner so
 * they can be long (clear of the gem and the plate), boots turn three-
 * quarters so they read as a pair. Sized to the card's inside, so the
 * frame, gem and plate stay readable around it. */
export function restPose(itemId: string, size: number): Pose {
  const slot = resolveItem(itemId).def.slot;
  switch (slot) {
    case "staff":
      return { scale: size * 0.92, rotZ: -0.78, rotY: 0, z: 0.04 };
    case "boots":
      return { scale: size * 0.8, rotZ: 0, rotY: 0.55, z: 0.04 };
    case "amulet":
      return { scale: size * 0.78, rotZ: 0, rotY: 0, z: 0.035 };
    case "cloak":
      return { scale: size * 0.76, rotZ: 0, rotY: 0.3, z: 0.04 };
    default:
      return { scale: size * 0.76, rotZ: 0, rotY: 0.2, z: 0.04 };
  }
}

const FLY_TIME = 0.32;
const tmpFrom = new Vector3();

/** An item in its card: appears with a pop once the socket has risen,
 * lifts toward you under the pointer, vanishes while it's in your hand, and
 * flies in from wherever it came from when it changes place (arrival hints,
 * interaction.ts). When the tablet breaks it tumbles away with the stones. */
export function SocketItem({
  spec,
  itemId,
  model,
  riseAt,
}: {
  spec: SocketSpec;
  itemId: string;
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
  const pose = useMemo(() => (model ? { scale: spec.size * 0.8, rotZ: 0, rotY: 0, z: 0.04 } : restPose(itemId, spec.size)), [itemId, spec.size, model]);
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
    glow.current = s.lift * 0.35;

    let x = 0;
    let y = 0;
    let z = pose.z + s.lift * 0.06;
    let scale = pose.scale * (1 + s.lift * 0.14);
    if (s.fly) {
      const f = Math.min(1, (now - s.fly.t0) / FLY_TIME);
      const e = 1 - (1 - f) ** 3;
      x = s.fly.from.x * (1 - e);
      y = s.fly.from.y * (1 - e);
      // An arc toward you, as if carried by a hand.
      z = s.fly.from.z * (1 - e) + z * e + Math.sin(f * Math.PI) * 0.06;
      scale = pose.scale * s.fly.scale * (1 - e) + scale * e;
      if (f >= 1) {
        s.fly = null;
        if (!s.landed) {
          s.landed = true;
          const p = g.getWorldPosition(tmpFrom);
          emitUiSparks({ position: [p.x, p.y, p.z], color: ink.arcane, count: 8, speed: 0.18, up: 0.05, size: 0.008, spread: spec.size * 0.5, ttl: 0.5 });
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
  });

  return (
    <group ref={outer} visible={false}>
      <group ref={spinner}>{model ?? <ItemModel itemId={itemId} highlightRef={glow} />}</group>
    </group>
  );
}
