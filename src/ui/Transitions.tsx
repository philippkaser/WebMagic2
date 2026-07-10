import { useEffect, useRef, useState } from "react";
import { playMindDive, playWarp } from "../audio/sound";
import { useGame } from "../state/gameStore";

/** Fullscreen in-world transitions, drawn on low-res canvases upscaled with
 * image-rendering: pixelated so they share the game's chunky pixel grain:
 *
 *  - MindDive: leaving the splash screen zooms through a wizard's eye into a
 *    rushing tunnel — you are being transported into the mind of the wizard.
 *  - WarpTunnel: while a portal travel is in flight (phase === "loading"),
 *    star streaks and time-rings rush past, tinted by the portal's color.
 */
export function TransitionLayer() {
  const phase = useGame((s) => s.phase);
  const warpTint = useGame((s) => s.warpTint);
  const [warpMounted, setWarpMounted] = useState(false);
  const loading = phase === "loading";

  // Keep the warp mounted briefly after arrival so it can fade out over the
  // new floor instead of popping.
  useEffect(() => {
    if (loading) {
      setWarpMounted(true);
    } else if (warpMounted) {
      const id = setTimeout(() => setWarpMounted(false), 500);
      return () => clearTimeout(id);
    }
  }, [loading, warpMounted]);

  return (
    <>
      <style>{css}</style>
      {warpMounted && (
        <div className={`wm-trans ${loading ? "wm-trans-in" : "wm-trans-out"}`}>
          <WarpTunnel tint={warpTint} />
        </div>
      )}
      <MindDive />
    </>
  );
}

// ── Warp tunnel ──────────────────────────────────────────────────────────────

interface Streak {
  a: number; // angle from center
  d: number; // distance
  s: number; // speed
}

function WarpTunnel({ tint }: { tint: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    playWarp();
    const canvas = ref.current!;
    const W = 240;
    const H = Math.max(90, Math.round((W * window.innerHeight) / Math.max(window.innerWidth, 1)));
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const cx = W / 2;
    const cy = H / 2;
    const maxR = Math.hypot(cx, cy);

    const fresh = (nearCenter: boolean): Streak => ({
      a: Math.random() * Math.PI * 2,
      d: nearCenter ? 2 + Math.random() * 6 : Math.random() * maxR * 0.7,
      s: 16 + Math.random() * 42,
    });
    const streaks: Streak[] = Array.from({ length: 140 }, () => fresh(false));

    ctx.fillStyle = "#020107";
    ctx.fillRect(0, 0, W, H);

    let raf = 0;
    let last = performance.now();
    let t = 0;
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      t += dt;
      // Translucent clear leaves motion trails — the space-time smear.
      ctx.fillStyle = "rgba(2,1,7,0.34)";
      ctx.fillRect(0, 0, W, H);

      const accel = 1 + Math.min(t * 2.0, 3.5);
      for (const st of streaks) {
        const d0 = st.d;
        st.d += st.s * accel * dt;
        const x0 = cx + Math.cos(st.a) * d0;
        const y0 = cy + Math.sin(st.a) * d0 * 0.9;
        const x1 = cx + Math.cos(st.a) * st.d;
        const y1 = cy + Math.sin(st.a) * st.d * 0.9;
        ctx.strokeStyle = Math.random() < 0.22 ? "#e8f6ff" : tint;
        ctx.globalAlpha = 0.25 + 0.75 * Math.min(1, st.d / (maxR * 0.4));
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        if (st.d > maxR * 1.1) {
          const n = fresh(true);
          st.a = n.a;
          st.d = n.d;
          st.s = n.s;
        }
      }

      // Time-rings: expanding pulses, like crossing years on the way down.
      for (const offset of [0, 0.5]) {
        const prog = (t * 1.1 + offset) % 1;
        ctx.globalAlpha = (1 - prog) * 0.3;
        ctx.strokeStyle = tint;
        ctx.beginPath();
        ctx.ellipse(cx, cy, prog * maxR, prog * maxR * 0.8, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tint]);

  return <canvas ref={ref} className="wm-trans-canvas" />;
}

// ── Mind dive ────────────────────────────────────────────────────────────────

function MindDive() {
  const id = useGame((s) => s.mindDiveId);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (id > 0) setActive(id);
  }, [id]);
  if (active === 0) return null;
  return <MindDiveAnim key={active} onDone={() => setActive(0)} />;
}

const DIVE_S = 2.0; // total seconds, incl. the fade revealing the village

function MindDiveAnim({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    playMindDive();
    const canvas = ref.current!;
    const W = 240;
    const H = Math.max(90, Math.round((W * window.innerHeight) / Math.max(window.innerWidth, 1)));
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const cx = W / 2;
    const cy = H / 2;
    const maxR = Math.hypot(cx, cy);
    ctx.fillStyle = "#030208";
    ctx.fillRect(0, 0, W, H);

    const jag = Array.from({ length: 26 }, () => 0.9 + Math.random() * 0.2);
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      ctx.fillStyle = "rgba(3,2,8,0.4)";
      ctx.fillRect(0, 0, W, H);

      // Rushing tunnel of jagged rings, accelerating outward past the camera.
      for (let k = 0; k < 9; k++) {
        const prog = (k / 9 + t * (0.55 + t * 0.35)) % 1;
        const r = Math.pow(prog, 2.6) * maxR * 1.3;
        ctx.strokeStyle = k % 2 === 0 ? "#46ffd0" : "#8a52ff";
        ctx.globalAlpha = (1 - prog) * 0.7 * Math.min(1, t * 2);
        ctx.beginPath();
        for (let i = 0; i <= jag.length; i++) {
          const a = (i / jag.length) * Math.PI * 2;
          const rr = r * jag[(i + k * 3) % jag.length];
          const x = cx + Math.cos(a) * rr;
          const y = cy + Math.sin(a) * rr * 0.8;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // The wizard's eye: zoom through the pupil in the first moments.
      const s = 6 * Math.exp(t * 3.4);
      if (s < maxR * 6) {
        const fade = Math.max(0, 1 - t * 1.4);
        // pupil — a dark well that swallows the screen center
        ctx.fillStyle = "#02010a";
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.34, 0, Math.PI * 2);
        ctx.fill();
        // iris ring
        ctx.strokeStyle = "#46ffd0";
        ctx.globalAlpha = Math.min(1, fade + 0.15);
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.5, 0, Math.PI * 2);
        ctx.stroke();
        // almond lids
        ctx.strokeStyle = "#cfc6b4";
        ctx.globalAlpha = fade;
        ctx.beginPath();
        ctx.ellipse(cx, cy, s, s * 0.52, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Breaking through: a teal flash right before the village fades in.
      if (t > 1.35) {
        ctx.globalAlpha = Math.min(1, (t - 1.35) / 0.2) * 0.85;
        ctx.fillStyle = "#bffff0";
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      if (t < DIVE_S) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const fadeId = setTimeout(() => setFading(true), 1500);
    const doneId = setTimeout(onDone, DIVE_S * 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fadeId);
      clearTimeout(doneId);
    };
  }, [onDone]);

  return (
    <div className={`wm-trans ${fading ? "wm-trans-out" : ""}`}>
      <canvas ref={ref} className="wm-trans-canvas" />
    </div>
  );
}

const css = `
.wm-trans {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 30;
  opacity: 1;
}
.wm-trans-in { animation: wm-trans-fade-in 160ms linear; }
.wm-trans-out { opacity: 0; transition: opacity 480ms linear; }
@keyframes wm-trans-fade-in { from { opacity: 0; } to { opacity: 1; } }
.wm-trans-canvas {
  width: 100%;
  height: 100%;
  display: block;
  image-rendering: pixelated;
}
`;
