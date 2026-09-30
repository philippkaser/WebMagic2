import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { BoxGeometry, Group, Vector3 } from "three";
import { useGame } from "../../../state/gameStore";
import { useEscapeClosesOverlay } from "../../../ui/hooks";
import { ViewAnchor, pxFor } from "../../anchors";
import { stoneMaterial } from "../../materials";
import { UiPresence, useUiShow } from "../../presence";
import { TABLET_EXIT } from "../../Tablet";
import { RuneText } from "../../text/RuneText";
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
import { bronze, INK } from "./materials";
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

/** The pillar that joins a pair of tablets like the hinge of a triptych
 * (and closes the gap between them). It rises out of the dark with the
 * stones and sinks again when they break. */
function Hinge({ x, y }: { x: number; y: number }) {
  const show = useUiShow();
  const group = useRef<Group>(null);
  const k = useRef(0);
  useFrame((_, dt) => {
    k.current += ((show ? 1 : 0) - k.current) * (1 - Math.exp(-dt * (show ? 4 : 7)));
    const g = group.current;
    if (!g) return;
    g.scale.set(1, Math.max(0.0001, k.current), 1);
    g.visible = k.current > 0.01;
  });
  const h = ALTAR.height + 0.08;
  return (
    <group ref={group} position={[x, y, -0.12]} visible={false}>
      <mesh geometry={unitBox} material={stoneMaterial("#4a4654")} scale={[0.15, h, 0.1]} />
      {[1, -1].map((s) => (
        <mesh key={s} geometry={unitBox} material={bronze()} scale={[0.18, 0.05, 0.13]} position={[0, (s * h) / 2, 0]} />
      ))}
      <mesh geometry={unitBox} material={bronze()} scale={[0.03, h * 0.8, 0.105]} />
    </group>
  );
}

const unitBox = new BoxGeometry(1, 1, 1);

/** How to handle things, hanging in the air under the altar. */
function UsageHint({ mode, y }: { mode: InventoryMode; y: number }) {
  const phase = useGame((s) => s.phase);
  const text =
    mode === "chest"
      ? "drag between bag and chest · shift-click: quick move · I: close"
      : mode === "merchant"
        ? "drag onto Maro's stall to sell · shift-click: quick move · I: close"
        : `drag to move · shift-click: quick move · off the altar: ${phase === "dungeon" ? "drop" : "discard"} · I: close`;
  return <RuneText text={text} px={pxFor(SCENE_DISTANCE, TEXT.label)} color={INK.faint} glow={0.5} position={[0, y, 0]} delay={0.7} stagger={0.5} />;
}
