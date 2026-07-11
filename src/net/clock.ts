/** Estimates the server clock from ping/pong round trips.
 *
 * Every relayed envelope is stamped with server time, so if all clients can
 * convert local time → server time, they share one timeline: snapshots are
 * buffered by server timestamp and rendered a fixed delay in the past, which
 * is what makes replicated motion smooth regardless of jitter.
 *
 * Offset estimation keeps the lowest-RTT probes from a sliding window (low
 * RTT ⇒ symmetric ⇒ trustworthy) and eases toward them to avoid steps. */

const WINDOW = 8;
const EASE = 0.35;

export class NetClock {
  private offset = 0;
  private hasSync = false;
  private samples: { rtt: number; offset: number }[] = [];

  constructor(private localNow: () => number = () => performance.now()) {}

  /** Feed a pong. `sent` is our local time from the matching ping. */
  onPong(sent: number, serverTime: number): void {
    const nowLocal = this.localNow();
    const rtt = Math.max(0, nowLocal - sent);
    const sample = { rtt, offset: serverTime + rtt / 2 - nowLocal };
    this.samples.push(sample);
    if (this.samples.length > WINDOW) this.samples.shift();
    let best = this.samples[0];
    for (const s of this.samples) if (s.rtt < best.rtt) best = s;
    if (!this.hasSync) {
      this.offset = best.offset;
      this.hasSync = true;
    } else {
      this.offset += (best.offset - this.offset) * EASE;
    }
  }

  /** Current time on the server's timeline (ms). Falls back to local time
   * before the first pong — correct for the offline loopback. */
  serverNow(): number {
    return this.localNow() + this.offset;
  }

  get synced(): boolean {
    return this.hasSync;
  }

  reset(): void {
    this.offset = 0;
    this.hasSync = false;
    this.samples.length = 0;
  }
}

export const netClock = new NetClock();
