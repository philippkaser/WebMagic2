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
  /** The local wizard blink-dashed (the post chain's rush). */
  dash: undefined;
  /** Staff viewmodel recoil, strength 0..1. */
  staffKick: number;
  /** Boss health fraction 0..1 for the HUD bar, or null to hide it. */
  bossHp: { name: string; frac: number } | null;
  /** Player dropped items from the inventory — the loot system spawns real
   * orbs at their feet (decoupled: the store can't import presentation). */
  dropItems: { defId: string; qty: number };
  /** The local wizard just died, still standing on its floor. `items`/`gold`
   * are what the death took; on a `shared` floor the encounters layer raises
   * a grave with them (the store can't import presentation or net systems). */
  wizardFell: {
    items: { id: string; qty: number }[];
    gold: number;
    killerId: string | null;
    shared: boolean;
  };
  /** A lore rune was read (HUD shows the fragment). */
  loreRead: { fragmentId: string };
  /** A blast went off (weapons/explosions.ts#explode — on every client,
   * replays included). Cosmetic listeners: the floor's scorch marks. */
  explosion: {
    x: number;
    y: number;
    z: number;
    /** The scaled radius (omens included). */
    radius: number;
    color: string;
    /** The caller's sense of its size: particles / 36 (bolt pop ≈ 0.4). */
    power: number;
    vfx: "blast" | "shockwave";
  };
  /** An enemy died for real (not a silent late-join catch-up), on every
   * client. Cosmetic listeners: the splat it leaves on the floor. */
  enemyDied: {
    x: number;
    y: number;
    z: number;
    /** What its body was made of (the death burst's colour), if known. */
    body?: string;
    /** Its soul-light's colour, if known. */
    soul?: string;
    /** The death burst's style (goo, shard, smoke, spark…). */
    style?: string;
    /** Size (1 = a wisp). */
    scale: number;
  };
}

export const gameEvents = new Emitter<GameEvents>();
