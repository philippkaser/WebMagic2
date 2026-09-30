/** Floor-instance directory — the encounter rules.
 *
 * Entering floor N either drops you into a fresh instance of your own, or —
 * with probability `joinChance` — into an instance of floor N someone is
 * already exploring. Only wizards on the same floor number ever meet. Pact
 * partners are placed together whenever there is room. Pure logic with
 * injected randomness/clock, so the rules are unit-tested and the exact same
 * code runs in the Bun server and the offline loopback.
 */

export interface FloorInstanceRecord {
  id: string;
  floor: number;
  seed: number;
  /** Insertion-ordered: the first member is the simulation host. */
  players: Set<string>;
  createdAt: number;
}

export interface DirectoryOptions {
  maxPerInstance: number;
  joinChance: number;
  random?: () => number;
  seedFn?: () => number;
  now?: () => number;
}

export interface JoinResult {
  instance: FloorInstanceRecord;
  /** Dropped into an instance that already had wizards in it. */
  joinedExisting: boolean;
  /** Freshly created instance. */
  created: boolean;
}

export class FloorDirectory {
  private instances = new Map<string, FloorInstanceRecord>();
  private playerInstance = new Map<string, string>();
  private nextId = 1;
  private readonly random: () => number;
  private readonly seedFn: () => number;
  private readonly now: () => number;

  /** Called when the last wizard leaves an instance, before it is dropped. */
  onDispose: ((inst: FloorInstanceRecord) => void) | null = null;

  constructor(private opts: DirectoryOptions) {
    this.random = opts.random ?? Math.random;
    this.seedFn = opts.seedFn ?? (() => (Math.random() * 0xffffffff) >>> 0);
    this.now = opts.now ?? Date.now;
  }

  /** Place a player on floor `floor`, leaving any previous instance. */
  join(playerId: string, floor: number, allies: Iterable<string> = []): JoinResult {
    this.leave(playerId);
    const open = [...this.instances.values()].filter(
      (i) => i.floor === floor && i.players.size < this.opts.maxPerInstance,
    );

    // 1. Travel with your pact.
    const allySet = new Set(allies);
    let target = open.find((i) => [...i.players].some((p) => allySet.has(p))) ?? null;
    // 2. The encounter roll.
    if (!target && open.length > 0 && this.random() < this.opts.joinChance) {
      target = open[Math.floor(this.random() * open.length)];
    }
    let created = false;
    if (!target) {
      target = {
        id: `inst_${this.nextId++}`,
        floor,
        seed: this.seedFn(),
        players: new Set(),
        createdAt: this.now(),
      };
      this.instances.set(target.id, target);
      created = true;
    }
    const joinedExisting = target.players.size > 0;
    target.players.add(playerId);
    this.playerInstance.set(playerId, target.id);
    return { instance: target, joinedExisting, created };
  }

  /** Remove a player; empty instances are disposed. */
  leave(playerId: string): void {
    const id = this.playerInstance.get(playerId);
    if (!id) return;
    this.playerInstance.delete(playerId);
    const inst = this.instances.get(id);
    if (!inst) return;
    inst.players.delete(playerId);
    if (inst.players.size === 0) {
      this.onDispose?.(inst);
      this.instances.delete(id);
    }
  }

  instanceOf(playerId: string): FloorInstanceRecord | null {
    const id = this.playerInstance.get(playerId);
    return (id && this.instances.get(id)) || null;
  }

  instancesOnFloor(floor: number): FloorInstanceRecord[] {
    return [...this.instances.values()].filter((i) => i.floor === floor);
  }

  /** Simulation host = oldest member. */
  hostOf(inst: FloorInstanceRecord): string {
    return inst.players.values().next().value ?? "";
  }
}
