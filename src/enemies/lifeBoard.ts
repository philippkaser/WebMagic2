/** Every living enemy's life, readable by anyone — the seam between the
 * enemy shell (which publishes) and what shows life (life marks over heads,
 * the boss bar, wound visuals, sounds that climb as a target weakens).
 * Module-level, allocation-free reads; hp is the replicated value on every
 * client (the authority's own on the host). */

export interface LifeEntry {
  id: string;
  kind: string;
  maxHp: number;
  hp: number;
  /** World position of the body (live; null once it has none). */
  pos(): { x: number; y: number; z: number } | null;
  /** Height of the top of the body above `pos` (for overhead marks). */
  top: number;
  /** performance.now() of the last hp drop (0 = never hurt). */
  hurtAt: number;
}

const board = new Map<string, LifeEntry>();

export function publishLife(entry: LifeEntry): () => void {
  board.set(entry.id, entry);
  return () => {
    if (board.get(entry.id) === entry) board.delete(entry.id);
  };
}

/** A new hp value for a published enemy (drops stamp hurtAt). */
export function updateLife(id: string, hp: number, now = performance.now()): void {
  const e = board.get(id);
  if (!e) return;
  if (hp < e.hp) e.hurtAt = now;
  e.hp = hp;
}

export function getLife(id: string): LifeEntry | undefined {
  return board.get(id);
}

export function forEachLife(fn: (e: LifeEntry) => void): void {
  for (const e of board.values()) fn(e);
}
