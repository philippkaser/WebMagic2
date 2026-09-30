import { createContext, useContext, useSyncExternalStore } from "react";
import { Matrix4, Object3D, Ray, Vector3 } from "three";
import type { Carried, SlotRef } from "../../../items/inventory";
import { useGame } from "../../../state/gameStore";
import { uiNow } from "../../clock";
import type { DropAction, HintTone, PointerHit } from "./dropTarget";
import { onTablet, socketAt, type InventoryMode, type SocketSpec, type TabletId, type TabletSpec } from "./layout";

/** The inventory scene's shared, mutable interaction state.
 *
 * Hover and drag change every frame (the pointer moves, the tablets bob), so
 * they live here as plain fields that sockets and items read inside
 * useFrame — no React state per frame. The few things that DO need a render
 * (the plaque's words, the held item's hint) subscribe to `version`, which
 * only ticks on discrete changes: a new socket hovered, a drag starting or
 * ending, the drop's meaning changing.
 *
 * Positions shared between pieces are in ROOT space — the scene's own frame,
 * which rides with the eye — so a hint recorded this frame still means the
 * same place next frame even if the camera shook. */

export interface Surface {
  spec: TabletSpec;
  /** A group lying in the tablet's face (it bobs and tilts with the stone). */
  object: Object3D;
}

export interface DragState {
  from: SlotRef;
  fromKey: string;
  itemId: string;
  qty: number;
  /** Socket keys that would take it (kindled while dragging). */
  accepts: Set<string>;
  /** Where the held item is, root space (on the drag plane under the pointer). */
  point: Vector3;
  action: DropAction;
  /** Key of the accepting socket under the pointer, if any. */
  targetKey: string | null;
}

/** A reusable, mutable pointer hit (see hitTest). */
export interface HitScratch {
  kind: "socket" | "tablet" | "void";
  tablet: TabletId | null;
  socket: SocketSpec | null;
}

export function newHit(): HitScratch {
  return { kind: "void", tablet: null, socket: null };
}

export function sameHit(a: HitScratch, b: HitScratch): boolean {
  return a.kind === b.kind && a.tablet === b.tablet && a.socket === b.socket;
}

export function copyHit(from: HitScratch, to: HitScratch): void {
  to.kind = from.kind;
  to.tablet = from.tablet;
  to.socket = from.socket;
}

/** The immutable union the drop rules take (built only when the hit changes). */
export function toPointerHit(h: HitScratch): PointerHit {
  if (h.kind === "socket" && h.tablet && h.socket) return { kind: "socket", tablet: h.tablet, socket: h.socket };
  if (h.kind !== "void" && h.tablet) return { kind: "tablet", tablet: h.tablet };
  return { kind: "void" };
}

export interface HeldView {
  itemId: string;
  qty: number;
  hint: { text: string; tone: HintTone } | null;
}

/** "Fly in from here": recorded when an item changes socket so the socket it
 * lands in can animate it arriving instead of popping. */
export interface Arrival {
  point: Vector3;
  at: number;
  /** The scale it had there (a held item is bigger than a resting one). */
  scale: number;
}

export interface Flight {
  id: number;
  itemId: string;
  kind: "fall" | "burn" | "sell";
  /** Where it leaves from, root space. */
  from: Vector3;
}

/** Root-space z of the plane a held item glides on — in front of every
 * tablet (side tablets turn their outer edges ~8 cm toward you). */
export const DRAG_Z = 0.16;
/** How far past a tablet's edge still counts as "on it" (letting go there
 * returns the item rather than dropping it on the floor). */
export const EDGE_GRACE = 0.08;
/** A hover survives this long over the gaps between sockets, so the plaque
 * doesn't flicker when the pointer crosses from one to the next. */
const HOVER_GRACE = 0.14;

const tmpInv = new Matrix4();
const tmpRay = new Ray();
const tmpV = new Vector3();

export class InventoryInteraction {
  mode: InventoryMode = "inventory";
  root: Object3D | null = null;
  /** The altar has assembled: hands off until then (its sockets are still
   * flying stones). */
  ready = false;
  readonly surfaces = new Map<TabletId, Surface>();
  /** Sockets of every mounted tablet, by key. */
  readonly sockets = new Map<string, { tablet: TabletId; spec: SocketSpec }>();

  /** The socket under the pointer (sticky across gaps), when not dragging. */
  hover: string | null = null;
  /** The gear socket the hovered item would replace (it glows faintly). */
  compareKey: string | null = null;
  private hoverSeenAt = 0;
  drag: DragState | null = null;
  held: HeldView | null = null;
  readonly arrivals = new Map<string, Arrival>();
  /** Set by the flights layer; spawns a fall/burn/sell animation. */
  launch: ((f: Omit<Flight, "id">) => void) | null = null;
  /** Pulses when something lands on the wizard (equip), read by the shrine. */
  equipPulseAt = -10;

  private version = 0;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getVersion = (): number => this.version;

  emit(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  registerSurface(id: TabletId, surface: Surface): () => void {
    this.surfaces.set(id, surface);
    for (const s of surface.spec.sockets) this.sockets.set(s.key, { tablet: id, spec: s });
    return () => {
      if (this.surfaces.get(id) !== surface) return;
      this.surfaces.delete(id);
      for (const s of surface.spec.sockets) this.sockets.delete(s.key);
    };
  }

  /** Every mounted socket (for drag acceptance). */
  allSockets(): SocketSpec[] {
    return [...this.sockets.values()].map((s) => s.spec);
  }

  /** What a world-space ray points at: the nearest tablet whose face (plus
   * the edge grace) it crosses, and the socket there. Writes into `out`
   * (called every frame — no allocation). */
  hitTest(worldRay: Ray, out: HitScratch): HitScratch {
    out.kind = "void";
    out.tablet = null;
    out.socket = null;
    let bestDist = Infinity;
    for (const [id, surface] of this.surfaces) {
      tmpInv.copy(surface.object.matrixWorld).invert();
      tmpRay.copy(worldRay).applyMatrix4(tmpInv);
      const dz = tmpRay.direction.z;
      if (Math.abs(dz) < 1e-6) continue;
      const t = -tmpRay.origin.z / dz;
      if (t <= 0) continue;
      const x = tmpRay.origin.x + tmpRay.direction.x * t;
      const y = tmpRay.origin.y + tmpRay.direction.y * t;
      if (!onTablet(surface.spec, x, y, EDGE_GRACE)) continue;
      // Compare in world units (surfaces may be scaled differently).
      tmpV.set(x, y, 0).applyMatrix4(surface.object.matrixWorld);
      const d = tmpV.distanceToSquared(worldRay.origin);
      if (d >= bestDist) continue;
      bestDist = d;
      const socket = socketAt(surface.spec, x, y);
      out.kind = socket ? "socket" : "tablet";
      out.tablet = id;
      out.socket = socket;
    }
    return out;
  }

  /** Update the sticky hover from this frame's socket. True on change. */
  updateHover(key: string | null): boolean {
    const now = uiNow();
    if (key) this.hoverSeenAt = now;
    const next = key ?? (now - this.hoverSeenAt < HOVER_GRACE ? this.hover : null);
    if (next === this.hover) return false;
    this.hover = next;
    return true;
  }

  clearHover(): void {
    if (this.hover !== null) {
      this.hover = null;
      this.emit();
    }
  }

  /** A socket's centre in root space (false if it isn't mounted). */
  socketRootPosition(key: string, out: Vector3, lift = 0): boolean {
    const entry = this.sockets.get(key);
    const surface = entry && this.surfaces.get(entry.tablet);
    if (!entry || !surface || !this.root) return false;
    out.set(entry.spec.x, entry.spec.y, lift);
    surface.object.localToWorld(out);
    this.root.worldToLocal(out);
    return true;
  }

  /** Root space → an object's local space (for placing things by hints). */
  rootToLocal(object: Object3D, p: Vector3, out: Vector3): Vector3 {
    out.copy(p);
    if (!this.root) return out;
    this.root.localToWorld(out);
    return object.worldToLocal(out);
  }

  /** Record that `key` should show its item flying in from `point`. */
  arrive(key: string, point: Vector3, scale = 1): void {
    this.arrivals.set(key, { point: point.clone(), at: uiNow(), scale });
  }
}

export const InventoryContext = createContext<InventoryInteraction | null>(null);

export function useInventory(): InventoryInteraction {
  const ix = useContext(InventoryContext);
  if (!ix) throw new Error("useInventory outside the inventory scene");
  return ix;
}

/** Re-render on the interaction's discrete changes (hover, drag start/end,
 * hint change) and read what you need from it. */
export function useInventoryVersion(ix: InventoryInteraction): number {
  return useSyncExternalStore(ix.subscribe, ix.getVersion);
}

/** The carried inventory as the move rules see it, read fresh (not a hook:
 * pointer handlers need the state at the moment of the click). */
export function carriedNow(): Carried {
  const s = useGame.getState();
  return { equipment: s.equipment, bag: s.bag, belt: s.belt, chest: s.chest };
}

/** One cell's contents as primitives (stable for zustand selectors). */
export function useCell(ref: SlotRef | null): { itemId: string | null; qty: number; runLoot: boolean } {
  const itemId = useGame((s) => (ref ? cellOf(s, ref)?.defId ?? null : null));
  const qty = useGame((s) => (ref ? cellOf(s, ref)?.qty ?? 0 : 0));
  const runLoot = useGame((s) => (ref ? cellOf(s, ref)?.runLoot ?? false : false));
  return { itemId, qty, runLoot };
}

function cellOf(s: Carried, ref: SlotRef): { defId: string; qty: number; runLoot: boolean } | null {
  if (ref.container === "equipment") {
    const item = s.equipment[ref.slot];
    return item ? { defId: item.defId, qty: 1, runLoot: item.runLoot } : null;
  }
  return s[ref.container][ref.index] ?? null;
}
