import { useEffect, useRef, useState } from "react";

/** A number written in runes needs a moment to be read: a digit takes ~0.3 s
 * to burn in, and mana regenerating nine points a second would keep its last
 * digit forever mid-materialization — a flicker, not a number. So a rising
 * value is shown at most every `interval`; a falling one (a hit, a spend)
 * shows at once, because it matters now. */

/** Milliseconds to wait before showing `value` in place of `shown`, given
 * when the display last changed. Pure, for tests. */
export function settleDelay(value: number, shown: number, lastAt: number, now: number, intervalMs: number): number {
  if (value === shown) return Infinity;
  if (value < shown) return 0;
  return Math.max(0, lastAt + intervalMs - now);
}

export function useSettled(value: number, intervalMs = 450): number {
  const [shown, setShown] = useState(value);
  const latest = useRef(value);
  latest.current = value;
  const lastAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const wait = settleDelay(value, shown, lastAt.current, performance.now(), intervalMs);
    if (wait === Infinity) return;
    if (wait === 0) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      lastAt.current = performance.now();
      setShown(value);
      return;
    }
    // Already scheduled: that timer will pick up whatever is latest by then.
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      lastAt.current = performance.now();
      setShown(latest.current);
    }, wait);
  }, [value, shown, intervalMs]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return shown;
}

/** RuneText's `delay` holds back EVERY re-write, not just the first: a
 * counter given an entrance delay would blank each changed digit for that
 * long. This returns `delay` for the entrance, then 0 for good. */
export function useEntryDelay(delay: number): number {
  const [d, setD] = useState(delay);
  useEffect(() => {
    const timer = setTimeout(() => setD(0), (delay + 0.1) * 1000);
    return () => clearTimeout(timer);
  }, [delay]);
  return d;
}

/** A value that must hold still for `ms` before it's shown — for words
 * that flip at a threshold (the presence eye's "something is near" / "they
 * are close" as a wizard paces at the boundary). The first value shows at
 * once. */
export function useSteady<T>(value: T, ms = 1200): T {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (Object.is(value, shown)) return;
    const timer = setTimeout(() => setShown(value), ms);
    return () => clearTimeout(timer);
  }, [value, shown, ms]);
  return shown;
}
