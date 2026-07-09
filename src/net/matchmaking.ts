/** Floor-instance directory.
 *
 * Core multiplayer rule: entering floor N joins an existing instance of that
 * floor if one has capacity (players share the same generated layout via the
 * instance seed). If every instance of the floor is full — or none exists —
 * a brand-new instance with a fresh seed is created. This is pure logic with
 * no I/O so the exact same code runs in the local loopback "server" today and
 * in the authoritative server later.
 */

export interface FloorInstanceRecord {
  id: string;
  floor: number;
  seed: number;
  players: Set<string>;
  createdAt: number;
}

export class FloorDirectory {
  private instances = new Map<string, FloorInstanceRecord>();
  private playerInstance = new Map<string, string>();
  private nextId = 1;

  constructor(
    private maxPerInstance = 4,
    private seedFn: () => number = () => (Math.random() * 0xffffffff) >>> 0,
    private now: () => number = () => Date.now(),
  ) {}

  /** Assign a player to floor `floor`, joining the oldest instance with room
   * or creating a new one. Removes the player from any previous instance. */
  join(playerId: string, floor: number): FloorInstanceRecord {
    this.leave(playerId);
    let best: FloorInstanceRecord | null = null;
    for (const inst of this.instances.values()) {
      if (inst.floor !== floor || inst.players.size >= this.maxPerInstance) continue;
      if (!best || inst.createdAt < best.createdAt) best = inst;
    }
    if (!best) {
      best = {
        id: `inst_${this.nextId++}`,
        floor,
        seed: this.seedFn(),
        players: new Set(),
        createdAt: this.now(),
      };
      this.instances.set(best.id, best);
    }
    best.players.add(playerId);
    this.playerInstance.set(playerId, best.id);
    return best;
  }

  /** Remove a player; empty instances are garbage-collected. */
  leave(playerId: string): void {
    const id = this.playerInstance.get(playerId);
    if (!id) return;
    this.playerInstance.delete(playerId);
    const inst = this.instances.get(id);
    if (!inst) return;
    inst.players.delete(playerId);
    if (inst.players.size === 0) this.instances.delete(id);
  }

  instanceOf(playerId: string): FloorInstanceRecord | null {
    const id = this.playerInstance.get(playerId);
    return (id && this.instances.get(id)) || null;
  }

  instancesOnFloor(floor: number): FloorInstanceRecord[] {
    return [...this.instances.values()].filter((i) => i.floor === floor);
  }
}
