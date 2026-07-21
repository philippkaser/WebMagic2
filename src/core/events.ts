/** Minimal typed event bus decoupling gameplay systems from UI/FX. */

type Listener<T> = (payload: T) => void;

export class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<never>);
    return () => set!.delete(fn as Listener<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) (fn as Listener<Events[K]>)(payload);
  }
}

export interface GameEvents extends Record<string, unknown> {
  /** HUD message feed. */
  message: string;
  /** Player took damage — HUD flash. */
  playerHurt: { amount: number };
  /** Camera shake request, strength 0..1. */
  shake: number;
  /** Staff viewmodel recoil, strength 0..1. */
  staffKick: number;
  /** Charge-up fraction 0..1 while holding a charged ability; 0 hides it. */
  charge: number;
  /** Boss health fraction 0..1 for the HUD bar, or null to hide it. */
  bossHp: { name: string; frac: number } | null;
  /** Player dropped items from the inventory — the loot system spawns real
   * orbs at their feet (decoupled: the store can't import presentation). */
  dropItems: { defId: string; qty: number };
}

export const gameEvents = new Emitter<GameEvents>();
