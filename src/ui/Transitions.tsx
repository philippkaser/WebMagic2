import { useEffect, useRef } from "react";
import { playMindDive, playWarp } from "../audio/sound";
import { useGame } from "../state/gameStore";
import { TRANSITION_FRAG, createShaderQuad, type ShaderQuad } from "./shaderCanvas";

/** Fullscreen in-world transitions, driven by one choreographed GLSL shader
 * (see shaderCanvas). Each transition is a fixed-length, eased timeline so it
 * reads as smooth staged motion:
 *
 *  - MindDive (splash → village): gentle hover in front of the wizard's eye,
 *    then a punch that zooms through the pupil into the mind.
 *  - Warp (phase === "loading"): sucked into a vortex, hover in a parallel
 *    starry world drifting downward (descending floors), sucked out into the
 *    destination. Held at the descent until the floor is actually ready, so
 *    the "sucked out" reveal always lands on a real world.
 */
const WARP_MS = 2000;
const DIVE_MS = 2400;
/** Progress is clamped here until the floor finishes loading, so we never suck
 * out onto an empty scene. Matches the start of the suck-out phase. */
const WARP_HOLD = 0.7;

export function TransitionLayer() {
  const hostRef = useRef<HTMLDivElement>(null);
  const quadRef = useRef<ShaderQuad | null>(null);
  const runRef = useRef<{ cleanup: () => void } | null>(null);

  // One shared shader canvas, mounted once.
  useEffect(() => {
    const quad = createShaderQuad(TRANSITION_FRAG);
    quad.canvas.className = "wm-trans-canvas";
    hostRef.current?.appendChild(quad.canvas);
    quadRef.current = quad;
    return () => {
      quad.dispose();
      quad.canvas.remove();
      quadRef.current = null;
    };
  }, []);

  /** Play a transition: drive uProgress 0→1 over `duration`, optionally holding
   * at WARP_HOLD until `gate()` says the world is ready, then fade out. */
  const play = (mode: 0 | 1, tint: string, duration: number, gate?: () => boolean) => {
    const quad = quadRef.current;
    const host = hostRef.current;
    if (!quad || !host) return;
    runRef.current?.cleanup();

    quad.setUniforms({ mode, progress: 0, tint });
    quad.start();
    host.style.display = "block";
    host.style.transition = "opacity 140ms linear"; // soft fade-in, no hard cut
    host.style.opacity = "1";
    if (mode === 0) playWarp();
    else playMindDive();

    let raf = 0;
    let stopTimer = 0;
    let cancelled = false;
    let fadingOut = false;
    const t0 = performance.now();

    const cleanup = () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(stopTimer);
    };

    const tick = (now: number) => {
      if (cancelled) return;
      let p = (now - t0) / duration;
      if (gate && p > WARP_HOLD && !gate()) p = WARP_HOLD; // wait for the floor
      p = Math.min(p, 1);
      quad.setUniforms({ progress: p });
      if (p >= 0.86 && !fadingOut) {
        // Smooth handoff: fade the overlay away to reveal the world beneath.
        fadingOut = true;
        host.style.transition = "opacity 420ms ease-out";
        host.style.opacity = "0";
      }
      if (p >= 1) {
        stopTimer = window.setTimeout(() => {
          if (cancelled) return;
          quad.stop();
          host.style.display = "none";
          runRef.current = null;
        }, 440);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    runRef.current = { cleanup };
  };

  // Warp: fires whenever we enter the loading phase (descend / enter / leave).
  const phase = useGame((s) => s.phase);
  const warpTint = useGame((s) => s.warpTint);
  const wasLoading = useRef(false);
  useEffect(() => {
    const loading = phase === "loading";
    if (loading && !wasLoading.current) {
      play(0, warpTint, WARP_MS, () => useGame.getState().phase !== "loading");
    }
    wasLoading.current = loading;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, warpTint]);

  // Mind-dive: fires each time we leave the splash screen.
  const mindDiveId = useGame((s) => s.mindDiveId);
  useEffect(() => {
    if (mindDiveId > 0) play(1, "#8fe6ff", DIVE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mindDiveId]);

  useEffect(() => () => runRef.current?.cleanup(), []);

  // Dev-only: freeze the transition shader at a fixed progress for inspection.
  useEffect(() => {
    if (!import.meta.env?.DEV) return;
    (window as unknown as Record<string, unknown>).__previewTransition = (
      mode: 0 | 1,
      progress: number,
      tint = "#46ffd0",
    ) => {
      const quad = quadRef.current;
      const host = hostRef.current;
      if (!quad || !host) return;
      runRef.current?.cleanup();
      quad.setUniforms({ mode, progress, tint });
      quad.start();
      host.style.transition = "none";
      host.style.display = "block";
      host.style.opacity = "1";
    };
  }, []);

  return (
    <>
      <style>{css}</style>
      <div ref={hostRef} className="wm-trans" style={{ display: "none", opacity: 0 }} />
    </>
  );
}

const css = `
.wm-trans {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 30;
}
.wm-trans-canvas {
  width: 100%;
  height: 100%;
  display: block;
  image-rendering: pixelated;
}
`;
