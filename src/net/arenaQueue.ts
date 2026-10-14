import { ARENA } from "../arena/rules";

/** Who's waiting at the obelisk for a bout. Pure; the relay owns it. A bout
 * forms once two challengers are ready and the gathering breath has passed
 * (or the hall is full), taking the longest-waiting first. */

export class ArenaQueue {
  private waiting: { id: string; since: number }[] = [];

  join(id: string, now: number): number {
    if (!this.waiting.some((w) => w.id === id)) this.waiting.push({ id, since: now });
    return this.position(id);
  }

  leave(id: string): void {
    this.waiting = this.waiting.filter((w) => w.id !== id);
  }

  has(id: string): boolean {
    return this.waiting.some((w) => w.id === id);
  }

  /** 1-based place in line (0 = not waiting). */
  position(id: string): number {
    return this.waiting.findIndex((w) => w.id === id) + 1;
  }

  get size(): number {
    return this.waiting.length;
  }

  /** The challengers for a bout that should start now, or null. */
  take(now: number): string[] | null {
    if (this.waiting.length < ARENA.minPlayers) return null;
    const full = this.waiting.length >= ARENA.maxPlayers;
    const gathered = now - this.waiting[ARENA.minPlayers - 1]!.since >= ARENA.gatherMs;
    if (!full && !gathered) return null;
    const bout = this.waiting.slice(0, ARENA.maxPlayers).map((w) => w.id);
    this.waiting = this.waiting.slice(ARENA.maxPlayers);
    return bout;
  }
}
