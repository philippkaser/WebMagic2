import { maxStackOf } from "../../../items/catalog";
import { sellValue } from "../../../items/economy";
import { moveItem, readSlot, type Carried, type SlotRef } from "../../../items/inventory";
import type { InventoryMode, SocketSpec, TabletId } from "./layout";

/** What letting go of a dragged item does — pure, so every rule of the old
 * DOM screen (swap, merge, the staff that can't be dropped, chest only in the
 * village, selling at Maro's) is pinned by dropTarget.test.ts, and the scene
 * only asks and animates. The store (and the server) still decide the move
 * itself: this only predicts it, to kindle the right sockets. */

/** What the pointer is over, found by raycasting the tablets. */
export type PointerHit =
  | { kind: "socket"; tablet: TabletId; socket: SocketSpec }
  | { kind: "tablet"; tablet: TabletId }
  | { kind: "void" };

export interface DropContext {
  mode: InventoryMode;
  inVillage: boolean;
}

export type DropAction =
  /** Into another cell. `swap`: something comes back the other way;
   * `merge`: stacks onto the same consumable. */
  | { kind: "move"; to: SlotRef; swap: boolean; merge: boolean }
  /** Onto Maro's stall: he pays `gold` for the whole stack. */
  | { kind: "sell"; gold: number }
  /** Off the tablets in the dungeon: it falls to the floor as real loot. */
  | { kind: "drop" }
  /** Off the tablets in the village: it's gone. */
  | { kind: "discard" }
  /** Nothing happens; the item goes home. `reason` is said aloud (runes). */
  | { kind: "none"; reason?: string };

/** Could `from`'s contents land in `to`? The move rules, plus: the chest is
 * back in the village, so it only takes part there. */
export function canDropOn(inv: Carried, from: SlotRef, to: SlotRef, inVillage: boolean): boolean {
  if (!inVillage && (from.container === "chest" || to.container === "chest")) return false;
  return moveItem(inv, from, to) !== null;
}

function isStaff(ref: SlotRef): boolean {
  return ref.container === "equipment" && ref.slot === "staff";
}

/** Maro's offer for a cell's whole stack, or null when he won't take it. */
export function sellOffer(inv: Carried, from: SlotRef): number | null {
  if (isStaff(from)) return null;
  const stack = readSlot(inv, from);
  if (!stack) return null;
  const value = sellValue(stack.defId);
  return value === null ? null : value * stack.qty;
}

export function resolveDrop(inv: Carried, from: SlotRef, hit: PointerHit, ctx: DropContext): DropAction {
  const stack = readSlot(inv, from);
  if (!stack) return { kind: "none" };

  if (hit.kind === "socket" && hit.socket.ref) {
    const to = hit.socket.ref;
    if (!canDropOn(inv, from, to, ctx.inVillage)) return { kind: "none" };
    const target = readSlot(inv, to);
    const merge =
      !!target &&
      to.container !== "equipment" &&
      target.defId === stack.defId &&
      target.runLoot === stack.runLoot &&
      maxStackOf(stack.defId) > 1 &&
      target.qty < maxStackOf(stack.defId);
    return { kind: "move", to, swap: !!target && !merge, merge };
  }

  // Anywhere on Maro's stall (a ware's shelf included) sells.
  const onStall = (hit.kind === "socket" || hit.kind === "tablet") && hit.tablet === "stall";
  if (onStall) {
    if (ctx.mode !== "merchant" || !ctx.inVillage) return { kind: "none" };
    if (isStaff(from)) return { kind: "none", reason: "A wizard never sells their staff" };
    const gold = sellOffer(inv, from);
    return gold === null ? { kind: "none" } : { kind: "sell", gold };
  }

  if (hit.kind !== "void") return { kind: "none" };
  if (isStaff(from)) return { kind: "none", reason: "A wizard never drops their staff" };
  if (from.container === "chest" && !ctx.inVillage) return { kind: "none" };
  return ctx.inVillage ? { kind: "discard" } : { kind: "drop" };
}

export type HintTone = "accent" | "gold" | "danger" | "dim";

/** The few runes written under the held item: what letting go will do. Plain
 * moves say nothing — the kindled socket already does. */
export function dropHint(action: DropAction, inv: Carried, from: SlotRef): { text: string; tone: HintTone } | null {
  switch (action.kind) {
    case "move": {
      if (action.merge) return { text: "STACK", tone: "accent" };
      if (action.to.container === "equipment") return { text: action.swap ? "EQUIP · SWAP" : "EQUIP", tone: "accent" };
      if (action.swap) return { text: "SWAP", tone: "accent" };
      if (action.to.container === "chest" && from.container !== "chest") return { text: "STASH", tone: "accent" };
      return null;
    }
    case "sell":
      return { text: `SELL · ${action.gold} GOLD`, tone: "gold" };
    case "drop": {
      const stack = readSlot(inv, from);
      return { text: stack && stack.qty > 1 ? `DROP ×${stack.qty}` : "DROP", tone: "danger" };
    }
    case "discard":
      return { text: "DISCARD", tone: "danger" };
    case "none":
      return action.reason ? { text: action.reason, tone: "dim" } : null;
  }
}

/** Every socket key that would take `from`'s contents — computed once when a
 * drag starts, then the sockets kindle from it every frame. */
export function acceptingSockets(
  inv: Carried,
  from: SlotRef,
  sockets: readonly SocketSpec[],
  inVillage: boolean,
): Set<string> {
  const out = new Set<string>();
  for (const s of sockets) {
    if (s.ref && canDropOn(inv, from, s.ref, inVillage)) out.add(s.key);
  }
  return out;
}

/** Where a purchase (or the Orb of Fortune's reveal) landed: the first belt
 * or bag cell that gained an item, so the scene can fly it there from Maro's
 * shelf. The store chooses the cell; this only finds it afterwards. */
export function landedCell(before: Carried, after: Carried): SlotRef | null {
  for (const container of ["belt", "bag"] as const) {
    const a = before[container];
    const b = after[container];
    if (a === b) continue;
    for (let i = 0; i < b.length; i++) {
      const was = a[i] ?? null;
      const now = b[i] ?? null;
      if (now && (!was || was.defId !== now.defId || now.qty > was.qty)) return { container, index: i };
    }
  }
  return null;
}
