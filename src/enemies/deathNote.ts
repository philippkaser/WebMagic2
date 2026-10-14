/** The death note: what the host says about a kill when it despawns the
 * body — who landed the killing blow, which way it was struck, and how much
 * harder than needed. Every client reads it to play the same death (the
 * corpse flies the right way, overkill flings it further) and to know
 * whether the kill was its own.
 *
 * Cosmetic only — death itself is the despawn. Untrusted on receipt, like a
 * hit command (weapons/hits.ts): a malformed note is dropped, numbers are
 * clamped, and a bad note costs a death its flourish, never its truth. Pure;
 * tested in deathNote.test.ts. */

/** On the wire: `{by, d: [dx, dz], o}`. */
export interface DeathNoteWire {
  /** The killer's wizard id ("" = the dungeon itself: a barrel, a trap). */
  by: string;
  /** The killing blow's planar direction (unit, or [0, 0] if it had none). */
  d: [number, number];
  /** Overkill as a share of max hp. */
  o: number;
}

export interface DeathNote {
  by: string;
  /** Null when the blow had no planar direction. */
  dir: [number, number] | null;
  over: number;
}

/** Longest wizard id a note may carry. */
export const MAX_KILLER_ID = 64;
/** Overkill is clamped to this many max-hps (a rail through a wisp). */
export const MAX_OVERKILL = 4;

const q2 = (x: number) => Math.round(x * 100) / 100;

/** Write a note from the killing blow's impulse (any length) and overkill. */
export function encodeDeath(by: string, ix: number, iz: number, over: number): DeathNoteWire {
  const l = Math.hypot(ix, iz);
  const unit = Number.isFinite(l) && l > 1e-4;
  return {
    by: by.slice(0, MAX_KILLER_ID),
    d: unit ? [q2(ix / l), q2(iz / l)] : [0, 0],
    o: q2(Math.min(MAX_OVERKILL, Math.max(0, Number.isFinite(over) ? over : 0))),
  };
}

/** Read a note off the wire, or null if it isn't one. */
export function readDeath(data: unknown): DeathNote | null {
  if (typeof data !== "object" || data === null) return null;
  const n = data as Partial<DeathNoteWire>;
  if (typeof n.by !== "string" || n.by.length > MAX_KILLER_ID) return null;
  let dir: [number, number] | null = null;
  const d = n.d;
  if (Array.isArray(d) && d.length === 2 && Number.isFinite(d[0]) && Number.isFinite(d[1])) {
    const l = Math.hypot(d[0], d[1]);
    // Renormalise anything longer than a unit; a near-zero is "no direction".
    if (l > 0.05) dir = [d[0] / Math.max(1, l), d[1] / Math.max(1, l)];
  }
  const o = typeof n.o === "number" && Number.isFinite(n.o) ? Math.min(MAX_OVERKILL, Math.max(0, n.o)) : 0;
  return { by: n.by, dir, over: o };
}
