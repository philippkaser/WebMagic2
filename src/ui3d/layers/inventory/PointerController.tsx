import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Matrix4, Ray, Raycaster, Vector2, Vector3, type Camera } from "three";
import { playItemLift, playItemSet, playUiHover } from "../../../audio/uiSounds";
import { gameEvents } from "../../../core/events";
import { readSlot, type Carried, type SlotRef } from "../../../items/inventory";
import { useGame } from "../../../state/gameStore";
import { uiNow } from "../../clock";
import { useUiShow } from "../../presence";
import { acceptingSockets, dropHint, resolveDrop, type DropContext } from "./dropTarget";
import {
  carriedNow,
  copyHit,
  DRAG_Z,
  newHit,
  sameHit,
  toPointerHit,
  useInventory,
  type HitScratch,
  type InventoryInteraction,
} from "./interaction";
import { slotKey, type InventoryMode } from "./layout";
import { quickMoveTarget } from "./quickMove";

/** Hover, drag & drop, shift/double-click — the scene's hands.
 *
 * Every frame the pointer's ray is tested against the tablets' faces
 * (interaction.hitTest: exact at any tilt or turn, no invisible meshes to
 * keep in sync) to find the socket under it. A press on a filled socket
 * becomes a drag once the pointer travels a few pixels; the held item then
 * glides on a plane just in front of the tablets, and letting go asks
 * dropTarget.resolveDrop what that means: a move (the store decides), a
 * sale, a drop to the floor, or nothing (the item flies home).
 *
 * Pointer buttons come from DOM events on the UI canvas: R3F's own events
 * only reach meshes, and a drag must also be able to end over empty air. */

const DRAG_START_PX = 5;
const DOUBLE_CLICK_S = 0.35;
/** The held item is drawn this much bigger than it rests. */
export const HELD_SCALE = 1.35;

const tmpInv = new Matrix4();
const tmpRay = new Ray();

interface Press {
  key: string;
  ref: SlotRef;
  x: number;
  y: number;
  shift: boolean;
}

export function PointerController({ mode }: { mode: InventoryMode }) {
  const ix = useInventory();
  const show = useUiShow();
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const raycaster = useMemo(() => new Raycaster(), []);
  const ndc = useRef(new Vector2(0, 0));
  const hasPointer = useRef(false);
  const press = useRef<Press | null>(null);
  const lastClick = useRef<{ key: string; at: number } | null>(null);
  const hit = useMemo(newHit, []);
  const lastHit = useMemo(newHit, []);
  const showRef = useRef(show);
  showRef.current = show;
  const cursor = useRef("");
  ix.mode = mode;

  useEffect(() => {
    const el = gl.domElement;
    const probe = newHit();
    const toNdc = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.current.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
      hasPointer.current = true;
    };
    const down = (e: PointerEvent) => {
      toNdc(e);
      if (e.button !== 0 || !showRef.current || !ix.ready || ix.drag) return;
      castRay(ix, raycaster, ndc.current, camera, probe);
      const ref = probe.socket?.ref;
      if (probe.kind !== "socket" || !ref || !readSlot(carriedNow(), ref)) return;
      press.current = { key: probe.socket!.key, ref, x: e.clientX, y: e.clientY, shift: e.shiftKey };
    };
    const move = (e: PointerEvent) => {
      toNdc(e);
      const p = press.current;
      if (!p || ix.drag) return;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_START_PX) return;
      press.current = null;
      beginDrag(ix, p);
    };
    const up = (e: PointerEvent) => {
      toNdc(e);
      if (e.button !== 0) return;
      if (ix.drag) {
        castRay(ix, raycaster, ndc.current, camera, probe);
        finishDrag(ix, probe);
        return;
      }
      const p = press.current;
      press.current = null;
      if (!p || !showRef.current) return;
      const now = uiNow();
      const last = lastClick.current;
      const double = last !== null && last.key === p.key && now - last.at < DOUBLE_CLICK_S;
      if (p.shift || e.shiftKey || double) {
        lastClick.current = null;
        quickMove(ix, p.ref);
      } else {
        lastClick.current = { key: p.key, at: now };
      }
    };
    const cancel = () => {
      press.current = null;
      if (ix.drag) cancelDrag(ix);
    };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("blur", cancel);
    el.addEventListener("pointercancel", cancel);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("blur", cancel);
      el.removeEventListener("pointercancel", cancel);
      cancel();
    };
  }, [gl, camera, ix, raycaster]);

  // Closing mid-drag: the item goes home as the altar breaks.
  useEffect(() => {
    if (show) return;
    press.current = null;
    if (ix.drag) cancelDrag(ix);
    ix.clearHover();
    document.body.style.cursor = "";
    cursor.current = "";
  }, [show, ix]);

  useFrame(() => {
    if (!show || !ix.ready || !hasPointer.current) return;
    castRay(ix, raycaster, ndc.current, camera, hit);
    const changed = !sameHit(hit, lastHit);
    if (changed) copyHit(hit, lastHit);
    const drag = ix.drag;
    if (drag) {
      // The held item rides the drag plane under the pointer.
      if (ix.root) {
        tmpInv.copy(ix.root.matrixWorld).invert();
        tmpRay.copy(raycaster.ray).applyMatrix4(tmpInv);
        const dz = tmpRay.direction.z;
        const t = Math.abs(dz) > 1e-6 ? (DRAG_Z - tmpRay.origin.z) / dz : -1;
        if (t > 0) drag.point.copy(tmpRay.origin).addScaledVector(tmpRay.direction, t);
      }
      // What letting go would do only changes when the hit does.
      if (changed) {
        const inv = carriedNow();
        const action = resolveDrop(inv, drag.from, toPointerHit(hit), dropContext(ix));
        drag.action = action;
        drag.targetKey = action.kind === "move" ? slotKey(action.to) : null;
        if (ix.held) ix.held = { ...ix.held, hint: dropHint(action, inv, drag.from) };
        ix.emit();
      }
      setCursor("grabbing");
      return;
    }
    if (ix.updateHover(hit.socket?.key ?? null)) {
      ix.emit();
      // A faint rune tick when the pointer finds something to pick up.
      const ref = hit.socket?.ref;
      if (hit.socket && (hit.socket.ware || (ref && readSlot(carriedNow(), ref)))) playUiHover();
    }
    if (changed) {
      const ref = hit.socket?.ref;
      setCursor(ref && readSlot(carriedNow(), ref) ? "grab" : "");
    }
  });

  /** Only touch the cursor on change, so RuneButtons may set their own. */
  function setCursor(wanted: string) {
    if (wanted === cursor.current) return;
    document.body.style.cursor = wanted;
    cursor.current = wanted;
  }

  return null;
}

function castRay(ix: InventoryInteraction, raycaster: Raycaster, ndc: Vector2, camera: Camera, out: HitScratch): HitScratch {
  raycaster.setFromCamera(ndc, camera);
  return ix.hitTest(raycaster.ray, out);
}

function dropContext(ix: InventoryInteraction): DropContext {
  return { mode: ix.mode, inVillage: useGame.getState().phase === "village" };
}

function beginDrag(ix: InventoryInteraction, p: Press): void {
  const inv = carriedNow();
  const stack = readSlot(inv, p.ref);
  if (!stack) return;
  const point = new Vector3();
  ix.socketRootPosition(p.key, point, 0.08);
  ix.drag = {
    from: p.ref,
    fromKey: p.key,
    itemId: stack.defId,
    qty: stack.qty,
    accepts: acceptingSockets(inv, p.ref, ix.allSockets(), dropContext(ix).inVillage),
    point,
    action: { kind: "none" },
    targetKey: null,
  };
  ix.held = { itemId: stack.defId, qty: stack.qty, hint: null };
  ix.hover = null;
  playItemLift();
  ix.emit();
}

/** Let go: do what the drop means, and leave the item somewhere to fly from. */
function finishDrag(ix: InventoryInteraction, hit: HitScratch): void {
  const drag = ix.drag;
  if (!drag) return;
  const before = carriedNow();
  const action = resolveDrop(before, drag.from, toPointerHit(hit), dropContext(ix));
  const at = drag.point.clone();
  ix.drag = null;
  ix.held = null;
  const act = useGame.getState();
  const home = () => ix.arrive(drag.fromKey, at, HELD_SCALE);
  switch (action.kind) {
    case "move": {
      const toKey = slotKey(action.to);
      const displaced = readSlot(before, action.to);
      const ok = applyMove(ix, drag.from, action.to, () => {
        ix.arrive(toKey, at, HELD_SCALE);
        const back = new Vector3();
        if (displaced && ix.socketRootPosition(toKey, back, 0.05)) ix.arrive(drag.fromKey, back);
      });
      if (!ok) home();
      playItemSet();
      break;
    }
    case "sell":
      act.sellStack(drag.from);
      if (moved(before)) ix.launch?.({ itemId: drag.itemId, kind: "sell", from: at });
      else home();
      break;
    case "drop":
    case "discard":
      act.dropStack(drag.from);
      if (moved(before)) ix.launch?.({ itemId: drag.itemId, kind: action.kind === "drop" ? "fall" : "burn", from: at });
      else home();
      break;
    case "none":
      if (action.reason) gameEvents.emit("message", action.reason);
      home();
      playItemSet();
      break;
  }
  ix.emit();
}

function cancelDrag(ix: InventoryInteraction): void {
  const drag = ix.drag;
  if (!drag) return;
  ix.arrive(drag.fromKey, drag.point, HELD_SCALE);
  ix.drag = null;
  ix.held = null;
  ix.emit();
}

/** Did the store take the last action? (It refuses silently.) */
function moved(before: Carried): boolean {
  const s = useGame.getState();
  return s.equipment !== before.equipment || s.bag !== before.bag || s.belt !== before.belt || s.chest !== before.chest;
}

/** Record the arrival hints first (the store re-renders synchronously), then
 * move; if the store refused, the hints are withdrawn. */
function applyMove(ix: InventoryInteraction, from: SlotRef, to: SlotRef, hints: () => void): boolean {
  const before = carriedNow();
  hints();
  useGame.getState().moveItem(from, to);
  if (moved(before)) return true;
  ix.arrivals.delete(slotKey(to));
  ix.arrivals.delete(slotKey(from));
  return false;
}

/** Shift/double-click: the obvious move for that cell (quickMove.ts). */
function quickMove(ix: InventoryInteraction, from: SlotRef): void {
  const inv = carriedNow();
  const inVillage = useGame.getState().phase === "village";
  const to = quickMoveTarget(inv, from, ix.mode === "chest" && inVillage);
  if (!to) return;
  const fromKey = slotKey(from);
  const toKey = slotKey(to);
  const a = new Vector3();
  const b = new Vector3();
  const haveA = ix.socketRootPosition(fromKey, a, 0.05);
  const haveB = ix.socketRootPosition(toKey, b, 0.05);
  const displaced = readSlot(inv, to);
  const ok = applyMove(ix, from, to, () => {
    if (haveA) ix.arrive(toKey, a);
    if (displaced && haveB) ix.arrive(fromKey, b);
  });
  if (ok) playItemSet();
}
