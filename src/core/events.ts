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
  /** A craft finished (or was refused) — the cauldron/forge play it. */
  crafted: { ok: boolean; recipe: string; text: string; changed?: string; produced?: string[] };
  /** The Phoenix refused a death: the burst of flame (weapons/procs). */
  phoenix: undefined;
  /** An elixir's blessing took hold (HUD shows it ticking down). */
  buff: { id: import("../items/types").BuffId; seconds: number };
  /** An enemy was hit (on the shooter's machine for their own hits; on every
   * other machine when its hp drops in a snapshot, with mine = false).
   * `frac` is its real life left after the hit (0…1); `lethal` = this hit
   * killed it (as far as this machine knows). */
  enemyHit: {
    id: string;
    kind: string;
    at: import("../world/types").Vec3;
    damage: number;
    frac: number;
    mine: boolean;
    crit: boolean;
    lethal: boolean;
  };
  /** An enemy died for real, on every client. `mine` = the local wizard
   * landed the killing blow (the host's death note names the killer);
   * `dir` is the killing blow's xz direction (null if unknown); `over` is
   * overkill as a share of max hp; `scale` its size (1 = a wisp). */
  enemyKilled: {
    id: string;
    kind: string;
    at: import("../world/types").Vec3;
    mine: boolean;
    dir: [number, number] | null;
    over: number;
    scale: number;
  };
  /** A pact was sworn with another wizard on this floor (social/ makes the
   * pair a fellowship). */
  pactSworn: { with: string };
  /** We took a yield in the Proving Ground (arena/arenaFlow.ts). */
  arenaYield: { victim: string; name: string };
  /** Varr's count is done: the bout's fighting starts now. */
  arenaFight: undefined;
  /** A room event changed phase (roomEvents/net.ts) — views flash, sounds play. */
  roomEvent: { id: string; kind: import("../world/types").RoomEventKind; phase: string; at: import("../world/types").Vec3 };
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
  /** The eye's recoil from the local wizard's cast (weapons/castFeel):
   * degrees up and aside, and the share of the view punched in. */
  castKick: { pitch: number; yaw: number; fov: number };
  /** A kill of ours landed: the post chain's punch (exposure pops, the lens
   * splits colour), 0…1. */
  killPunch: number;
  /** The local wizard's cast sputtered out for want of mana. */
  fizzle: undefined;
  /** A streak of ours earned a rune word (DOUBLE, TRIPLE, RAMPAGE…). */
  multiKill: { multi: number; word: string };
  /** The local wizard is at the Brink: lethal grace refused a killing blow
   * and left them standing on 1 (state/gameStore). `from` is the health the
   * blow landed on. Local to the victim: slow motion, a ring in the ears, a
   * red flash and a moment's window to get away answer it. */
  wizardBrink: { from: number; max: number };
  /** The local wizard was healed (a potion, the fountain, lifesteal):
   * health `from` → `to` of `max`. A real heal back over the last-stand
   * line is a second wind (game/heart releaseOf). */
  wizardHealed: { from: number; to: number; max: number };
}

export const gameEvents = new Emitter<GameEvents>();
