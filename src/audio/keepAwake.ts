/** Keeps a realtime audio context running. A browser can stop one in the
 * middle of play — Chrome and Edge suspend it when the audio device fails or
 * goes away (Bluetooth headphones off, a monitor's speakers asleep, the audio
 * service restarting), Safari when a call or Siri interrupts — and nothing
 * restarts it by itself: the game would go silent for the rest of the
 * session. So whenever it leaves "running" it's asked to resume (backing off
 * while the device stays gone), again whenever the page comes back
 * (`onReturn`), and on every click and key (`wake`, from sound.ts initAudio:
 * the fallback for a browser that wants a gesture). */

/** What the keeper needs of a context. */
export interface Wakeable {
  readonly state: string;
  resume(): Promise<void>;
  addEventListener(type: "statechange", fn: () => void): void;
}

export interface KeepAwake {
  running(): boolean;
  /** Ask a stopped context to resume now. One state check while it runs. */
  wake(): void;
}

/** Retry a stopped context after this long, doubling up to the cap while the
 * device stays gone (no tight loop against a dead output). */
export const RETRY_FIRST_MS = 250;
export const RETRY_MAX_MS = 4000;

export function keepAwake(c: Wakeable, onReturn: (wake: () => void) => void): KeepAwake {
  let retryMs = RETRY_FIRST_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /** Not running, but could be ("suspended", or WebKit's "interrupted"). */
  const stopped = () => c.state !== "running" && c.state !== "closed";
  const settle = () => {
    if (stopped()) retrySoon();
    else retryMs = RETRY_FIRST_MS;
  };
  // A refused resume fires no statechange: settle() re-arms the retry.
  const resume = () => void c.resume().then(settle, settle);
  const retrySoon = () => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      if (stopped()) resume();
    }, retryMs);
    retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
  };
  const wake = () => {
    if (stopped()) resume();
  };

  c.addEventListener("statechange", settle);
  onReturn(wake);
  return { running: () => c.state === "running", wake };
}
