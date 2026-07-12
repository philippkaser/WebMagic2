import type { ReactNode } from "react";
import type { Vec3 } from "../world/types";
import { Boss } from "./Boss";
import { Sentry, Wisp } from "./enemies";

/** The enemy catalog — the single place that enumerates every enemy kind in
 * the game, mirroring items/catalog.ts. Both the dungeon floor (its regular
 * enemies) and the dev-room spawner render through this list, so adding an
 * enemy is one edit here: give it an id and a render() and it shows up
 * everywhere enemies are listed or spawned.
 *
 * Behaviour and tuning (health, damage, AI) stay inside each component
 * (Wisp/Sentry/Boss) — this registry is identity and how to mount one, never
 * a second copy of the numbers, so the two can't drift apart. */

export type EnemyId = "wisp" | "sentry" | "boss";

export interface EnemySpawnProps {
  entityId: string;
  pos: Vec3;
  floor: number;
  /** Fired when the instance dies/despawns. Singletons (the boss) use it so
   * their owner can drop them from its list; regular enemies ignore it. */
  onDeath: () => void;
}

export interface EnemyDef {
  id: EnemyId;
  name: string;
  /** Only one may be alive at a time (the boss hardcodes its net id + HUD bar). */
  singleton: boolean;
  /** Preferred spawn height — sentries sit on the ground, fliers hover. */
  spawnY: number;
  render(props: EnemySpawnProps): ReactNode;
}

export const ENEMY_DEFS: EnemyDef[] = [
  {
    id: "wisp",
    name: "Wisp",
    singleton: false,
    spawnY: 1.6,
    render: ({ entityId, pos, floor }) => <Wisp entityId={entityId} position={pos} floor={floor} />,
  },
  {
    id: "sentry",
    name: "Sentry",
    singleton: false,
    spawnY: 0,
    render: ({ entityId, pos, floor }) => (
      <Sentry entityId={entityId} position={pos} floor={floor} />
    ),
  },
  {
    id: "boss",
    name: "Warden of the Deep",
    singleton: true,
    spawnY: 1.8,
    render: ({ pos, floor, onDeath }) => <Boss position={pos} floor={floor} onDeath={onDeath} />,
  },
];

const byId = new Map(ENEMY_DEFS.map((d) => [d.id, d]));

export function getEnemyDef(id: EnemyId): EnemyDef {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown enemy id: ${id}`);
  return def;
}
