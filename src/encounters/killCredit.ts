import type { DamageSource } from "../game/damageSource";

/** Kill credit — who the floor will say killed you.
 *
 * Damage lands on the victim's machine (judged there, or by a server host
 * and sent there), so the victim also decides who
 * dealt the killing blow: the last OTHER wizard whose magic hurt us within a
 * short window gets the credit ("Mira was slain by Oswin"), even if a wisp
 * finished the job — the dungeon only claims the kill when no wizard
 * recently had a hand in it. Pure; time is injected. */

export class KillCredit {
  private lastWizard: string | null = null;
  private lastAt = -Infinity;

  constructor(private windowMs: number) {}

  record(source: DamageSource | undefined, now: number, selfId: string): void {
    if (source?.kind === "wizard" && source.id !== selfId) {
      this.lastWizard = source.id;
      this.lastAt = now;
    }
  }

  /** The wizard credited with a death at `now`, or null (the dungeon). */
  killer(now: number): string | null {
    return this.lastWizard !== null && now - this.lastAt <= this.windowMs ? this.lastWizard : null;
  }

  reset(): void {
    this.lastWizard = null;
    this.lastAt = -Infinity;
  }
}
