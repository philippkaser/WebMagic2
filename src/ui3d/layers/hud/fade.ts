import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useRef, type MutableRefObject } from "react";
import { uiNow } from "../../clock";
import { useUiShow } from "../../presence";

/** Flat pixel pieces (sprites, bars, slot cards) don't tween in — like the
 * grimoire's CSS (`steps(n)` everywhere) they appear and vanish in a few
 * hard steps, the way a pixel-art animation runs at a low frame rate. */

/** Value of a stepped ramp: `t` seconds into a `duration` ramp of `steps`
 * hard steps, 0..1. Pure, for tests. */
export function stepRamp(t: number, duration: number, steps: number): number {
  if (t <= 0) return 0;
  if (t >= duration) return 1;
  return Math.ceil((t / duration) * steps) / steps;
}

export interface StepFadeOptions {
  /** Extra condition on top of the enclosing UiShow. */
  show?: boolean;
  delay?: number;
  inTime?: number;
  outTime?: number;
  steps?: number;
}

/** A ref holding the piece's stepped visibility, 0..1, rewritten every
 * frame (no re-renders). Visibility follows the enclosing UiShow AND
 * `show`; mounted hidden = already gone. */
export function useStepFade({ show: showProp = true, delay = 0, inTime = 0.3, outTime = 0.25, steps = 4 }: StepFadeOptions = {}): MutableRefObject<number> {
  const show = useUiShow() && showProp;
  const value = useRef(0);
  const clock = useRef({ at: uiNow() + delay, from: 0, shown: show, mounted: false });

  useLayoutEffect(() => {
    const c = clock.current;
    if (c.mounted && c.shown === show) return;
    c.from = value.current;
    c.at = uiNow() + (show ? delay : 0);
    c.shown = show;
    c.mounted = true;
    // Only a change of `show` re-times the ramp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  useFrame(() => {
    const c = clock.current;
    const t = uiNow() - c.at;
    value.current = c.shown ? Math.max(c.from, stepRamp(t, inTime, steps)) : c.from * (1 - stepRamp(t, outTime, steps));
  });
  return value;
}
