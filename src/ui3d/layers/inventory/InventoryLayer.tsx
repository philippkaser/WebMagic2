import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Group, Vector3 } from "three";
import { useGame } from "../../../state/gameStore";
import { useEscapeClosesOverlay } from "../../../ui/hooks";
import { ViewAnchor, pxFor } from "../../anchors";
import { KeyCap, keyCapWidth } from "../../KeyCap";
import { PixelFrame } from "../../PixelFrame";
import { UiPresence, useUiShow } from "../../presence";
import { TABLET_EXIT } from "../../Tablet";
import { measureText, RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { AltarTablet } from "./AltarTablet";
import { AltarVoice } from "./AltarVoice";
import { ChestTablet } from "./ChestTablet";
import { Flights, HeldItem } from "./HeldItem";
import { InventoryContext, InventoryInteraction } from "./interaction";
import { ItemPlaque } from "./ItemPlaque";
import {
  ALTAR,
  arrangement,
  fitScale,
  isInventoryMode,
  SCENE_DISTANCE,
  TEXT,
  viewHalfExtent,
  type InventoryMode,
  type Placement,
  type TabletId,
} from "./layout";
import { flat, plane } from "./materials";
import { MerchantStall } from "./MerchantStall";
import { PointerController } from "./PointerController";

/** The inventory, the village chest and Maro's stall — as things in front
 * of you, not a screen over the game.
 *
 * Opening it (I / Tab, or E at the chest or the merchant) assembles a stone
 * altar ahead of you out of flying stones: your wizard steps out of the dark
 * in its niche, sockets rise out of the stone, your things settle into them,
 * the words write themselves on. At the chest or the merchant a second
 * tablet builds beside it, both turned in toward you. Items are handled,
 * not clicked: pick one up and carry it; the sockets that would take it
 * kindle; let go over one to set it there, over Maro's stall to sell it, off
 * the altar to let it fall. Escape or I, and it all breaks apart.
 *
 * Files: layout.ts (where everything sits; pure), dropTarget.ts (what a drop
 * means; pure), quickMove.ts (shift/double-click; pure), interaction.ts
 * (shared hover/drag state), PointerController.tsx (the hands), and one
 * component per physical piece. */
export function InventoryLayer() {
  const phase = useGame((s) => s.phase);
  const overlay = useGame((s) => s.overlay);
  const open = (phase === "village" || phase === "dungeon") && isInventoryMode(overlay);
  // The mode outlives the overlay while the tablets break apart.
  const mode = useRef<InventoryMode>("inventory");
  if (open && isInventoryMode(overlay)) mode.current = overlay;
  return (
    <UiPresence show={open} exit={TABLET_EXIT + 0.3}>
      <InventoryScene mode={mode.current} />
    </UiPresence>
  );
}

function InventoryScene({ mode }: { mode: InventoryMode }) {
  const ix = useMemo(() => new InventoryInteraction(), []);
  useEscapeClosesOverlay();
  const size = useThree((s) => s.size);
  const arr = arrangement(mode);
  const view = viewHalfExtent(78, size.width / Math.max(1, size.height), SCENE_DISTANCE);
  const fit = fitScale(arr.halfWidth, view.halfW);
  const root = useRef<Group>(null);
  useLayoutEffect(() => {
    ix.root = root.current;
    return () => {
      ix.root = null;
    };
  }, [ix]);
  useDevSocketProbe(ix);

  return (
    <InventoryContext.Provider value={ix}>
      <ViewAnchor offset={[0, 0, -SCENE_DISTANCE]}>
        <group ref={root} scale={fit}>
          {/* A reading light for the things on the altar: the canvas's
              torch alone leaves small items murky at this size. */}
          <pointLight position={[0.1, 0.5, 0.85]} intensity={1.4} distance={2.6} decay={1.4} color="#ffe6c8" />
          <Placed at={arr.altar}>
            {/* Alone, the altar leans a touch toward your hand; a pair of
                tablets stays still so they don't swim against each other. */}
            <AltarTablet tilt={!arr.side} />
          </Placed>
          {arr.side && (
            <Placed at={arr.side.placement} key={arr.side.id}>
              {arr.side.id === "chest" ? <ChestTablet /> : <MerchantStall />}
            </Placed>
          )}
          {arr.hingeX !== null && <Hinge x={arr.hingeX} y={arr.altar.y} />}
          <UsageHint mode={mode} y={arr.hintY} />
          <AltarVoice sceneY={arr.altar.y} />
          <ItemPlaque />
          <HeldItem />
          <Flights />
          <PointerController mode={mode} />
        </group>
      </ViewAnchor>
    </InventoryContext.Provider>
  );
}

/** Dev builds: `__invSocket("bag:0")` → the socket's centre in CSS pixels,
 * and `__invPoint("stall", x, y)` → any point on a tablet's face, so
 * end-to-end scripts can drive real drag & drop with the mouse. */
function useDevSocketProbe(ix: InventoryInteraction) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as Record<string, unknown>;
    const toScreen = (world: Vector3) => {
      world.project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return [r.left + ((world.x + 1) / 2) * r.width, r.top + ((1 - world.y) / 2) * r.height];
    };
    w.__invSocket = (key: string) => {
      const v = new Vector3();
      if (!ix.socketRootPosition(key, v) || !ix.root) return null;
      return toScreen(ix.root.localToWorld(v));
    };
    w.__invPoint = (tablet: TabletId, x: number, y: number) => {
      const s = ix.surfaces.get(tablet);
      return s ? toScreen(s.object.localToWorld(new Vector3(x, y, 0))) : null;
    };
    return () => {
      delete w.__invSocket;
      delete w.__invPoint;
    };
  }, [ix, camera, gl]);
}

function Placed({ at, children }: { at: Placement; children: React.ReactNode }) {
  return (
    <group position={[at.x, at.y, 0]} rotation={[0, at.yaw, 0]}>
      {children}
    </group>
  );
}

/** The spine that joins a pair of tablets into one open book (artpass's
 * `.wm-inv__book`), closing the gap between them: a soot strip in a brass
 * pixel frame with brass bands. It rises out of the dark with the stones
 * and sinks again when they break — in hard steps. */
function Hinge({ x, y }: { x: number; y: number }) {
  const show = useUiShow();
  const group = useRef<Group>(null);
  const k = useRef(0);
  useFrame((_, dt) => {
    k.current = show ? Math.min(1, k.current + dt * 2.5) : Math.max(0, k.current - dt * 5);
    const g = group.current;
    if (!g) return;
    const step = Math.ceil(k.current * 6) / 6;
    g.scale.set(1, Math.max(0.0001, step), 1);
    g.visible = step > 0;
  });
  const h = ALTAR.height + 0.06;
  const w = 0.1;
  const texel = 0.0055;
  return (
    <group ref={group} position={[x, y, -0.1]} visible={false}>
      <mesh geometry={plane()} material={flat("#140f18")} scale={[w, h, 1]} />
      {[-0.36, 0, 0.36].map((b) => (
        <mesh key={b} geometry={plane()} material={flat(ink.brassDark)} scale={[w, texel * 3, 1]} position={[0, b * h, 0.001]} />
      ))}
      <PixelFrame width={w + texel * 2} height={h + texel * 2} frame="brass" texel={texel} position={[0, 0, 0.002]} />
    </group>
  );
}

const HINT_PX = pxFor(SCENE_DISTANCE, TEXT.hint);

type HintPart = { key: string } | { text: string; color?: string };

/** How to handle things, under the altar (artpass's inventory footer): key
 * caps and faded words. */
function UsageHint({ mode, y }: { mode: InventoryMode; y: number }) {
  const phase = useGame((s) => s.phase);
  const parts: HintPart[] = [
    { text: mode === "merchant" ? "drag onto Maro's stall to sell" : mode === "chest" ? "drag between satchel and chest" : "drag to move" },
    { text: "·", color: ink.stoneLight },
    { key: "Shift" },
    { text: "+ click: quick move" },
    ...(mode === "inventory"
      ? [{ text: "·", color: ink.stoneLight }, { text: `off the altar: ${phase === "dungeon" ? "drop" : "discard"}` }]
      : []),
    { text: "·", color: ink.stoneLight },
    { key: "I" },
    { key: "Esc" },
    { text: "close" },
  ];
  const gap = HINT_PX * 3;
  const widths = parts.map((p) => ("key" in p ? keyCapWidth(p.key, HINT_PX * 0.85) : measureText(p.text, HINT_PX).width));
  const total = widths.reduce((a, b) => a + b, 0) + gap * (parts.length - 1);
  let x = -total / 2;
  return (
    <group position={[0, y, 0]}>
      {parts.map((p, i) => {
        const cx = x + widths[i]! / 2;
        x += widths[i]! + gap;
        return "key" in p ? (
          <KeyCap key={i} k={p.key} px={HINT_PX * 0.85} position={[cx, 0, 0]} />
        ) : (
          <RuneText key={i} text={p.text} px={HINT_PX} color={p.color ?? ink.faded} glow={0.4} position={[cx, 0, 0]} delay={0.7 + i * 0.03} />
        );
      })}
    </group>
  );
}
