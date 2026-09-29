import { ENCOUNTERS } from "../core/config";

/** Floor-instance directory — where the deep decides who meets whom.
 *
 * Core social rule: only wizards on the SAME floor can ever share an
 * instance, and they rarely do. Entering floor N rolls an encounter:
 *
 *  - success → join an existing instance of floor N that has room (the
 *    shared seed means both wizards stand in the identical generated world);
 *  - failure, or nobody else on floor N → a fresh private instance with a
 *    fresh seed. A later entrant who rolls an encounter can walk into it.
 *
 * The odds follow a TENSION CLOCK (core/config.ts ENCOUNTERS): each floor a
 * wizard enters alone raises their next roll, and a meeting resets it. So
 * encounters stay uncommon, but every quiet floor makes the next one feel a
 * little more dangerous.
 *
 * Reconnects bypass the roll: `preferInstanceId` puts a dropped wizard back
 * into the very instance they fell out of. An instance whose last wizard
 * leaves LINGERS (empty, invisible to encounters) for a minute before it is
 * garbage-collected, so even a solo wizard's dropped connection comes back
 * to the same seed — the same world.
 *
 * Pure logic with injected seed/clock/dice, so the exact same code runs in
 * the offline loopback, the real server, and the unit tests. */

export interface FloorInstanceRecord {
  id: string;
  floor: number;
  seed: number;
  players: Set<string>;
  createdAt: number;
  /** When the last player left (lingering), or null while occupied. */
  emptySince: number | null;
}

/** How long an empty instance waits for its wizard to reconnect. */
export const INSTANCE_LINGER_MS = 60_000;

export interface EncounterTuning {
  baseChance: number;
  perSoloFloor: number;
  maxChance: number;
}

export interface JoinOptions {
  /** Rejoin this instance if it still exists on the floor with room
   * (reconnect affinity) — no encounter roll. */
  preferInstanceId?: string;
}

export class FloorDirectory {
  private instances = new Map<string, FloorInstanceRecord>();
  private playerInstance = new Map<string, string>();
  /** Consecutive floors each player entered alone — the tension clock. */
  private soloStreak = new Map<string, number>();
  private nextId = 1;

  constructor(
    private maxPerInstance = 4,
    private seedFn: () => number = () => (Math.random() * 0xffffffff) >>> 0,
    private now: () => number = () => Date.now(),
    private dice: () => number = Math.random,
    private tuning: EncounterTuning = ENCOUNTERS,
    private lingerMs = INSTANCE_LINGER_MS,
  ) {}

  /** Chance that this player's next floor entry meets someone (if anyone is
   * there to meet). */
  encounterChance(playerId: string): number {
    const streak = this.soloStreak.get(playerId) ?? 0;
    return Math.min(this.tuning.maxChance, this.tuning.baseChance + this.tuning.perSoloFloor * streak);
  }

  /** Assign a player to floor `floor` (see the rules above). Removes them
   * from any previous instance first. */
  join(playerId: string, floor: number, opts: JoinOptions = {}): FloorInstanceRecord {
    this.leave(playerId);
    this.sweep();

    const preferred = opts.preferInstanceId ? this.instances.get(opts.preferInstanceId) : undefined;
    if (preferred && preferred.floor === floor && preferred.players.size < this.maxPerInstance) {
      return this.seat(playerId, preferred);
    }

    const open = [...this.instances.values()].filter(
      (i) => i.floor === floor && i.players.size < this.maxPerInstance && i.players.size > 0,
    );
    if (open.length > 0 && this.dice() < this.encounterChance(playerId)) {
      // Which instance is fate's call — nobody can steer into a friend's.
      const pick = open[Math.min(open.length - 1, Math.floor(this.dice() * open.length))];
      this.soloStreak.set(playerId, 0);
      return this.seat(playerId, pick);
    }

    const fresh: FloorInstanceRecord = {
      id: `inst_${this.nextId++}`,
      floor,
      seed: this.seedFn(),
      players: new Set(),
      createdAt: this.now(),
      emptySince: null,
    };
    this.instances.set(fresh.id, fresh);
    this.soloStreak.set(playerId, (this.soloStreak.get(playerId) ?? 0) + 1);
    return this.seat(playerId, fresh);
  }

  /** Remove a player. An instance left empty lingers (see above) and is
   * garbage-collected once its linger time is up. */
  leave(playerId: string): void {
    const id = this.playerInstance.get(playerId);
    if (id) {
      this.playerInstance.delete(playerId);
      const inst = this.instances.get(id);
      if (inst) {
        inst.players.delete(playerId);
        if (inst.players.size === 0) inst.emptySince = this.now();
      }
    }
    this.sweep();
  }

  /** Forget a player entirely (disconnect): their tension clock goes too. */
  forget(playerId: string): void {
    this.leave(playerId);
    this.soloStreak.delete(playerId);
  }

  instanceOf(playerId: string): FloorInstanceRecord | null {
    const id = this.playerInstance.get(playerId);
    return (id && this.instances.get(id)) || null;
  }

  instanceById(id: string): FloorInstanceRecord | null {
    return this.instances.get(id) ?? null;
  }

  instancesOnFloor(floor: number): FloorInstanceRecord[] {
    return [...this.instances.values()].filter((i) => i.floor === floor);
  }

  private seat(playerId: string, inst: FloorInstanceRecord): FloorInstanceRecord {
    inst.players.add(playerId);
    inst.emptySince = null;
    this.playerInstance.set(playerId, inst.id);
    return inst;
  }

  /** Garbage-collect instances that stayed empty past their linger time. */
  private sweep(): void {
    const now = this.now();
    for (const [id, inst] of this.instances) {
      if (inst.emptySince !== null && now - inst.emptySince >= this.lingerMs) this.instances.delete(id);
    }
  }
}
