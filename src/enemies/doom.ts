/** Zero-ping kills: the shooter's own ledger of damage it has sent to the
 * host but not yet seen land. A non-host wizard's killing blow otherwise
 * waits a whole round trip — the creature keeps flying at you, keeps
 * burning you on contact, and the kill confirm lands late. With the ledger
 * the shooter knows the blow was lethal on the frame it lands: the body goes
 * rigid and white-hot ("death throes") and its contact burn is disarmed
 * until the host's despawn arrives. The host still decides the death.
 *
 * The same ledger tells a replica which hp drops in a snapshot it already
 * showed (its own hits react instantly, locally), so a teammate's damage in
 * the same snapshot still gets its own flinch, and yours doesn't flinch
 * twice.
 *
 * Fixed-size and allocation-free after creation; pure, tested in
 * doom.test.ts. Times are seconds on the caller's clock. */

/** How long an unacknowledged blow stays on the books (a bad round trip, a
 * snapshot, and a hitching host's late frame): past this the host never
 * saw it, or saw it as less. Too short and our own blow flinches twice. */
export const LEDGER_TTL = 1.2;
/** How long death throes wait for the despawn before giving up (the host
 * clamped the damage, or a heal we didn't know about). */
export const DOOM_TTL = 1.2;

const SLOTS = 16;

export interface DoomLedger {
  amt: Float64Array;
  at: Float64Array;
  /** Live entries, oldest first. */
  n: number;
}

export function createLedger(): DoomLedger {
  return { amt: new Float64Array(SLOTS), at: new Float64Array(SLOTS), n: 0 };
}

function dropOldest(l: DoomLedger, count: number): void {
  if (count <= 0) return;
  l.amt.copyWithin(0, count, l.n);
  l.at.copyWithin(0, count, l.n);
  l.n -= count;
}

/** Forget blows older than the TTL. */
export function expire(l: DoomLedger, now: number): void {
  let k = 0;
  while (k < l.n && now - l.at[k] > LEDGER_TTL) k++;
  dropOldest(l, k);
}

/** We just sent `damage` at this body. */
export function noteMine(l: DoomLedger, damage: number, now: number): void {
  if (!(damage > 0)) return;
  expire(l, now);
  if (l.n === SLOTS) {
    // Full (a beam held on one body): fold into the newest — the sum is what matters.
    l.amt[l.n - 1] += damage;
    l.at[l.n - 1] = now;
    return;
  }
  l.amt[l.n] = damage;
  l.at[l.n] = now;
  l.n++;
}

/** The host's hp fell by `drop`: consume our oldest blows first. Returns how
 * much of the drop was ours (already shown); the rest was someone else's. */
export function ack(l: DoomLedger, drop: number, now: number): number {
  expire(l, now);
  let left = drop;
  let k = 0;
  while (k < l.n && left > 1e-6) {
    const take = Math.min(left, l.amt[k]);
    left -= take;
    l.amt[k] -= take;
    if (l.amt[k] <= 1e-6) k++;
  }
  dropOldest(l, k);
  return drop - left;
}

/** Damage we've sent that the host hasn't confirmed yet. */
export function pending(l: DoomLedger, now: number): number {
  expire(l, now);
  let s = 0;
  for (let i = 0; i < l.n; i++) s += l.amt[i];
  return s;
}

/** Our best guess at the body's hp right now. */
export function predictedHp(authHp: number, l: DoomLedger, now: number): number {
  return authHp - pending(l, now);
}

export function clearLedger(l: DoomLedger): void {
  l.n = 0;
}
