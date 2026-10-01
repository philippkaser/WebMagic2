import { MERCHANT_STOCK } from "../../../items/economy";
import { BAG_SLOTS, BELT_SLOTS, CHEST_SLOTS, type SlotRef } from "../../../items/inventory";
import type { GearSlot } from "../../../items/types";
import type { Overlay } from "../../../state/gameStore";

/** Where everything sits on the inventory's stone tablets — pure numbers, no
 * three.js, so the arrangement and the pointer's hit-testing can be unit
 * tested (layout.test.ts) and every visual piece reads the same table.
 *
 * Units are metres in a tablet's face plane: origin at the tablet's centre,
 * +x right, +y up. The whole scene hangs `SCENE_DISTANCE` ahead of the eye;
 * `arrangement()` says where each tablet sits in that scene ("root" space:
 * the eye's view axes, centred on the scene). */

/** The in-game overlays this scene shows. Listed explicitly (not "every
 * overlay but X") so a new overlay kind never falls through to it. */
export type InventoryMode = Extract<Overlay, "inventory" | "chest" | "merchant">;

export function isInventoryMode(overlay: Overlay): overlay is InventoryMode {
  return overlay === "inventory" || overlay === "chest" || overlay === "merchant";
}
export type TabletId = "altar" | "chest" | "stall";
export type SocketVariant = "gear" | "belt" | "bag" | "chest" | "ware";

/** Metres from the eye to the scene's centre plane. */
export const SCENE_DISTANCE = 1.35;

/** Screen-height fractions for the scene's text (see anchors.pxFor). 0.016 is
 * the legibility floor at 600 px tall. */
export const TEXT = {
  /** Panel headlines ("The Wizard", heading face). */
  title: 0.034,
  /** Silkscreen small caps (section labels, captions). */
  label: 0.0135,
  /** Tiny5 lore lines under a headline. */
  lore: 0.0165,
  gold: 0.022,
  plaqueName: 0.021,
  plaqueLine: 0.0165,
  hint: 0.016,
} as const;

/** The Orb of Fortune's ware key (it isn't an item). */
export const GAMBLE_WARE = "gamble";

export interface SocketSpec {
  /** Stable id: `bag:3`, `equipment:staff`, `ware:potion_hp_weak`. */
  key: string;
  /** The inventory cell behind it; null for Maro's wares (not yours yet). */
  ref: SlotRef | null;
  /** Merchant ware id (an item id, or GAMBLE_WARE). */
  ware?: string;
  variant: SocketVariant;
  x: number;
  y: number;
  /** Side of the square opening, m. */
  size: number;
  /** Caption carved under the socket. */
  label?: string;
  /** 0..1 build order: sockets rise out of the stone centre-first. */
  order: number;
}

export interface TabletSpec {
  id: TabletId;
  width: number;
  height: number;
  sockets: SocketSpec[];
}

/** A tablet's place in the scene. `yaw` turns side tablets inward so the pair
 * wraps around the eye like a triptych instead of standing in a flat wall. */
export interface Placement {
  x: number;
  y: number;
  yaw: number;
}

export function slotKey(ref: SlotRef): string {
  return ref.container === "equipment" ? `equipment:${ref.slot}` : `${ref.container}:${ref.index}`;
}

export function wareKey(ware: string): string {
  return `ware:${ware}`;
}

// ── The altar: your wizard, gear, belt and bag ───────────────────────────────

export const ALTAR = {
  width: 1.62,
  height: 1.36,
  /** The headline row ("The Wizard" … gold) and the rule under it. */
  titleY: 0.565,
  ruleY: 0.485,
  /** Left/right text margin from the centre, m. */
  marginX: 0.745,
  gearSize: 0.2,
  gearX: 0.5,
  gearRows: [0.255, -0.06] as const,
  rowY: -0.44,
  rowSize: 0.17,
  rowPitch: 0.2,
  /** Extra gap between the belt pair and the bag, m. */
  beltGap: 0.06,
  /** The wizard's window: feet on the ledge at `ledgeY`, arch top at `archTop`. */
  ledgeY: -0.2,
  archTop: 0.43,
  archWidth: 0.46,
  goldX: 0.745,
} as const;

/** Gear around the wizard: weapon and jewel on the left, what's worn on the
 * body on the right. */
const GEAR_PLACES: { slot: GearSlot; side: -1 | 1; row: 0 | 1 }[] = [
  { slot: "staff", side: -1, row: 0 },
  { slot: "amulet", side: -1, row: 1 },
  { slot: "cloak", side: 1, row: 0 },
  { slot: "boots", side: 1, row: 1 },
];

export function altarLayout(): TabletSpec {
  const sockets: SocketSpec[] = [];
  const maxR = Math.hypot(ALTAR.width / 2, ALTAR.height / 2);
  const order = (x: number, y: number) => Math.min(1, Math.hypot(x, y) / maxR);
  for (const g of GEAR_PLACES) {
    const x = g.side * ALTAR.gearX;
    const y = ALTAR.gearRows[g.row];
    sockets.push({
      key: slotKey({ container: "equipment", slot: g.slot }),
      ref: { container: "equipment", slot: g.slot },
      variant: "gear",
      x,
      y,
      size: ALTAR.gearSize,
      label: g.slot.toUpperCase(),
      order: order(x, y),
    });
  }
  // Bottom row: [Q][E] · [1][2][3][4][5], centred as a whole.
  const cells = BELT_SLOTS + BAG_SLOTS;
  const rowWidth = (cells - 1) * ALTAR.rowPitch + ALTAR.beltGap;
  const x0 = -rowWidth / 2;
  for (let i = 0; i < BELT_SLOTS; i++) {
    const x = x0 + i * ALTAR.rowPitch;
    sockets.push({
      key: slotKey({ container: "belt", index: i }),
      ref: { container: "belt", index: i },
      variant: "belt",
      x,
      y: ALTAR.rowY,
      size: ALTAR.rowSize,
      label: i === 0 ? "Q" : "E",
      order: order(x, ALTAR.rowY),
    });
  }
  for (let i = 0; i < BAG_SLOTS; i++) {
    const x = x0 + (BELT_SLOTS + i) * ALTAR.rowPitch + ALTAR.beltGap;
    sockets.push({
      key: slotKey({ container: "bag", index: i }),
      ref: { container: "bag", index: i },
      variant: "bag",
      x,
      y: ALTAR.rowY,
      size: ALTAR.rowSize,
      label: `${i + 1}`,
      order: order(x, ALTAR.rowY),
    });
  }
  return { id: "altar", width: ALTAR.width, height: ALTAR.height, sockets };
}

// ── The village chest ────────────────────────────────────────────────────────

export const CHEST = {
  width: 1.3,
  height: 1.36,
  titleY: 0.565,
  loreY: 0.485,
  marginX: 0.585,
  cols: 6,
  size: 0.16,
  pitch: 0.19,
  gridY: -0.09,
} as const;

export function chestLayout(): TabletSpec {
  const rows = Math.ceil(CHEST_SLOTS / CHEST.cols);
  const sockets: SocketSpec[] = [];
  const maxR = Math.hypot(CHEST.width / 2, CHEST.height / 2);
  for (let i = 0; i < CHEST_SLOTS; i++) {
    const c = i % CHEST.cols;
    const r = Math.floor(i / CHEST.cols);
    const x = (c - (CHEST.cols - 1) / 2) * CHEST.pitch;
    const y = CHEST.gridY + ((rows - 1) / 2 - r) * CHEST.pitch;
    sockets.push({
      key: slotKey({ container: "chest", index: i }),
      ref: { container: "chest", index: i },
      variant: "chest",
      x,
      y,
      size: CHEST.size,
      order: Math.min(1, Math.hypot(x, y) / maxR),
    });
  }
  return { id: "chest", width: CHEST.width, height: CHEST.height, sockets };
}

// ── Maro's stall ─────────────────────────────────────────────────────────────

export const STALL = {
  width: 1.44,
  height: 1.36,
  titleY: 0.565,
  subtitleY: 0.485,
  marginX: 0.65,
  firstRowY: 0.305,
  rowPitch: 0.205,
  /** A ware's framed row card. */
  rowWidth: 1.28,
  rowHeight: 0.18,
  socketX: -0.535,
  size: 0.15,
  /** Left edge of a ware's name/price column. */
  textX: -0.43,
  buttonX: 0.47,
  buttonWidth: 0.2,
  /** The sell trough along the bottom. */
  trayY: -0.535,
  trayWidth: 1.28,
  trayHeight: 0.13,
} as const;

/** Every ware on the stall, in shelf order: the fixed stock, then the orb. */
export function stallWares(): string[] {
  return [...MERCHANT_STOCK.map((w) => w.id), GAMBLE_WARE];
}

export function stallLayout(): TabletSpec {
  const sockets = stallWares().map<SocketSpec>((ware, i) => ({
    key: wareKey(ware),
    ref: null,
    ware,
    variant: "ware",
    x: STALL.socketX,
    y: STALL.firstRowY - i * STALL.rowPitch,
    size: STALL.size,
    order: i / 4,
  }));
  return { id: "stall", width: STALL.width, height: STALL.height, sockets };
}

// ── Scene arrangement ────────────────────────────────────────────────────────

/** Gap between side-by-side tablets, m. */
const PAIR_GAP = 0.12;
/** How far side tablets turn inward, rad. */
const PAIR_YAW = 0.1;
/** Tablets sit a little above the view centre; the hint hangs under them. */
const SCENE_Y = 0.08;

export interface Arrangement {
  altar: Placement;
  /** Root x of the pillar joining a pair of tablets (null when alone). */
  hingeX: number | null;
  side: { id: Exclude<TabletId, "altar">; placement: Placement; width: number } | null;
  /** Half the scene's width as the eye sees it at the scene's distance, m
   * (what must fit in the view): turned-in tablets bring their outer edges
   * nearer, which widens them in perspective. */
  halfWidth: number;
  /** Where the usage hint hangs (root y). */
  hintY: number;
}

export function sideTablet(mode: InventoryMode): Exclude<TabletId, "altar"> | null {
  return mode === "chest" ? "chest" : mode === "merchant" ? "stall" : null;
}

export function arrangement(mode: InventoryMode): Arrangement {
  const side = sideTablet(mode);
  const hintY = SCENE_Y - ALTAR.height / 2 - 0.13;
  if (!side) {
    return { altar: { x: 0, y: SCENE_Y, yaw: 0 }, hingeX: null, side: null, halfWidth: ALTAR.width / 2, hintY };
  }
  const width = side === "chest" ? CHEST.width : STALL.width;
  const total = ALTAR.width + PAIR_GAP + width;
  const altarX = -total / 2 + ALTAR.width / 2;
  const sideX = total / 2 - width / 2;
  return {
    altar: { x: altarX, y: SCENE_Y, yaw: PAIR_YAW },
    hingeX: altarX + ALTAR.width / 2 + PAIR_GAP / 2,
    side: { id: side, placement: { x: sideX, y: SCENE_Y, yaw: -PAIR_YAW }, width },
    halfWidth: Math.max(seenEdge(altarX, ALTAR.width), seenEdge(sideX, width)),
    hintY,
  };
}

/** How far from the view axis a turned-in tablet's outer edge appears, in
 * metres at the scene's distance. */
function seenEdge(centreX: number, width: number): number {
  const x = Math.abs(centreX) + (width / 2) * Math.cos(PAIR_YAW);
  const z = (width / 2) * Math.sin(PAIR_YAW);
  return (x * SCENE_DISTANCE) / (SCENE_DISTANCE - z);
}

/** Half the visible width/height (m) of a plane `distance` ahead of an eye
 * with vertical field of view `fovDeg` and aspect `aspect`. */
export function viewHalfExtent(fovDeg: number, aspect: number, distance: number): { halfW: number; halfH: number } {
  const halfH = distance * Math.tan((fovDeg * Math.PI) / 360);
  return { halfW: halfH * aspect, halfH };
}

/** Uniform scale that keeps the scene (plus a margin) inside a narrow view.
 * Never enlarges: at 16:10 and wider the scene keeps its designed size, so
 * text stays exactly the screen fraction it was set for. */
export function fitScale(halfWidth: number, viewHalfW: number, margin = 0.04): number {
  return Math.min(1, viewHalfW / (halfWidth + margin));
}

// ── Hit testing ──────────────────────────────────────────────────────────────

/** The socket under a point on a tablet's face, forgiving by `pad` metres
 * around each opening (sockets never overlap, so padding can't be
 * ambiguous as long as it stays under half the gap between them). */
export function socketAt(spec: TabletSpec, x: number, y: number, pad = 0.012): SocketSpec | null {
  for (const s of spec.sockets) {
    const h = s.size / 2 + pad;
    if (Math.abs(x - s.x) <= h && Math.abs(y - s.y) <= h) return s;
  }
  return null;
}

/** Is a face point on the tablet itself (with `margin` of forgiveness)? */
export function onTablet(spec: TabletSpec, x: number, y: number, margin = 0): boolean {
  return Math.abs(x) <= spec.width / 2 + margin && Math.abs(y) <= spec.height / 2 + margin;
}

// ── The item plaque ──────────────────────────────────────────────────────────

/** Where the reading plaque hangs beside a hovered socket (all in the
 * plaque's own plane).
 *
 * It goes to the `prefer` side of the socket (outward, so it covers as
 * little of the tablet as possible), flips to the other side if that would
 * leave the view, and as a last resort clamps inside the view. Vertically
 * it centres on the socket, clamped likewise. Returns the plaque's centre. */
export function placePlaque(
  anchor: { x: number; y: number; half: number },
  size: { w: number; h: number },
  bounds: { halfW: number; halfH: number },
  prefer: -1 | 1,
  gap = 0.04,
): { x: number; y: number; side: -1 | 1 } {
  const centreFor = (side: -1 | 1) => anchor.x + side * (anchor.half + gap + size.w / 2);
  const fits = (cx: number) => Math.abs(cx) + size.w / 2 <= bounds.halfW;
  let side = prefer;
  let x = centreFor(side);
  if (!fits(x)) {
    const other = (-prefer) as -1 | 1;
    const ox = centreFor(other);
    if (fits(ox)) {
      side = other;
      x = ox;
    } else {
      const lim = Math.max(0, bounds.halfW - size.w / 2);
      x = Math.max(-lim, Math.min(lim, x));
    }
  }
  const limY = Math.max(0, bounds.halfH - size.h / 2);
  const y = Math.max(-limY, Math.min(limY, anchor.y));
  return { x, y, side };
}
