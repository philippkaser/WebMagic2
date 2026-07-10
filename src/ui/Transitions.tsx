import { useEffect, useRef, useState } from "react";
import { playMindDive, playWarp } from "../audio/sound";
import { useGame } from "../state/gameStore";
import { TRANSITION_FRAG, createShaderQuad, type ShaderQuad } from "./shaderCanvas";

/** Fullscreen in-world transitions, all driven by one GLSL hyperspace shader
 * (see shaderCanvas). Rendered into a low-res buffer and upscaled with
 * image-rendering: pixelated so they carry the game's chunky pixel grain:
 *
 *  - MindDive: leaving the splash contracts a wizard's iris to a pupil and
 *    falls through it into a swirling tunnel — you are transported into the
 *    mind of the wizard.
 *  - Warp: while a portal travel is in flight (phase === "loading"), the
 *    tunnel screams past, tinted by the rift's color — travel through space
 *    and time.
 */
export function TransitionLayer() {
  const phase = useGame((s) => s.phase);
  const warpTint = useGame((s) => s.warpTint);
  const mindDiveId = useGame((s) => s.mindDiveId);
  const loading = phase === "loading";

  const hostRef = useRef<HTMLDivElement>(null);
  const quadRef = useRef<ShaderQuad | null>(null);
  const [warpVisible, setWarpVisible] = useState(false);
  const [diveVisible, setDiveVisible] = useState(false);
  const activeRef = useRef<"warp" | "dive" | null>(null);

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

  // Warp: runs for as long as the floor is loading.
  useEffect(() => {
    const quad = quadRef.current;
    if (!quad) return;
    if (loading) {
      activeRef.current = "warp";
      quad.setUniforms({ mode: 0, progress: 0, tint: warpTint });
      quad.start();
      setWarpVisible(true);
      playWarp();
    } else if (activeRef.current === "warp") {
      // Let it fade out, then stop rendering.
      setWarpVisible(false);
      const id = setTimeout(() => {
        if (activeRef.current === "warp") {
          quad.stop();
          activeRef.current = null;
        }
      }, 520);
      return () => clearTimeout(id);
    }
  }, [loading, warpTint]);

  // Mind-dive: a fixed-length dive with a driven progress value.
  useEffect(() => {
    const quad = quadRef.current;
    if (!quad || mindDiveId === 0) return;
    const DURATION = 2100;
    activeRef.current = "dive";
    quad.setUniforms({ mode: 1, progress: 0, tint: "#8fe6ff" });
    quad.start();
    setDiveVisible(true);
    playMindDive();

    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / DURATION);
      quad.setUniforms({ progress: p });
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Reveal the world under the dive for the last stretch.
    const fadeId = setTimeout(() => setDiveVisible(false), 1650);
    const stopId = setTimeout(() => {
      cancelAnimationFrame(raf);
      if (activeRef.current === "dive") {
        quad.stop();
        activeRef.current = null;
      }
    }, DURATION);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fadeId);
      clearTimeout(stopId);
    };
  }, [mindDiveId]);

  const visible = warpVisible || diveVisible;

  return (
    <>
      <style>{css}</style>
      <div
        ref={hostRef}
        className="wm-trans"
        style={{ opacity: visible ? 1 : 0, display: activeRef.current ? "block" : "none" }}
      />
    </>
  );
}

const css = `
.wm-trans {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 30;
  transition: opacity 480ms ease-out;
}
.wm-trans-canvas {
  width: 100%;
  height: 100%;
  display: block;
  image-rendering: pixelated;
}
`;
