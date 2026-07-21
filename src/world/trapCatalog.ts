import type { TrapKind } from "./types";

/** The trap roster as pure data — the single table of what traps exist and
 * how they're tuned, mirroring items/catalog.ts and combat/enemyStats.ts.
 * Adding a trap is a row here plus a case in world/traps.tsx (its behaviour)
 * and a weight the generator already reads. Kept free of component imports so
 * the generator and the components can both read it without a cycle. */

export interface TrapDef {
  id: TrapKind;
  name: string;
  /** One-line role summary for at-a-glance comparison (dev room, docs). */
  desc: string;
  /** Base damage at floor 1, scaled by floorScale(floor).enemyDamage on hit.
   * 0 = the trap does something other than damage (e.g. the warp). */
  baseDamage: number;
  /** Trigger/effect radius in world units. */
  radius: number;
  /** How it sits in the world: flush with the floor, or mounted on a room-edge
   * wall. Everything current is floor-mounted; the field stays for future
   * wall hazards. */
  mount: "floor" | "wall";
  /** Never generated on checkpoint floors — the warp mustn't yank a wizard off
   * a floor where they came to bank. */
  noCheckpoint: boolean;
  /** Relative weight when the generator picks which trap to place. */
  weight: number;
}

export const TRAP_DEFS: TrapDef[] = [
  {
    id: "spike",
    name: "Floor Spikes",
    desc: "Nearly invisible — impale anything that steps on them, then re-arm",
    baseDamage: 18,
    radius: 1.0,
    mount: "floor",
    noCheckpoint: false,
    weight: 3,
  },
  {
    id: "warp",
    name: "Warp Rune",
    desc: "Sigil that flings whoever steps on it down to the next floor",
    baseDamage: 0,
    radius: 1.0,
    mount: "floor",
    noCheckpoint: true,
    weight: 1,
  },
];

const byId = new Map(TRAP_DEFS.map((d) => [d.id, d]));

export function getTrapDef(id: TrapKind): TrapDef {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown trap id: ${id}`);
  return def;
}
