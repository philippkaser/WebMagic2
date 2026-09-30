import { useEffect, useRef } from "react";

const W = 320;
const H = 180;
const FRAME_MS = 1000 / 24;

export type BackdropMood = "arcane" | "blood" | "gold";

const MOODS: Record<BackdropMood, { ring: string; mote: [string, string]; bg: [string, string] }> = {
  arcane: { ring: "70,255,208", mote: ["70,255,208", "255,196,110"], bg: ["#150f22", "#030206"] },
  blood: { ring: "210,50,50", mote: ["255,90,60", "120,20,20"], bg: ["#1e0808", "#030102"] },
  gold: { ring: "255,212,79", mote: ["255,220,120", "70,255,208"], bg: ["#1c1508", "#040302"] },
};

interface Mote {
  x: number;
  y: number;
  vy: number;
  phase: number;
  warm: boolean;
}

/** Full-screen animated backdrop for the big screens, rendered at 320×180
 * and upscaled pixelated: a slowly turning double rune-circle and rising
 * motes. Everything snaps to the low-res grid, so even rotation stays
 * honest pixel art. */
export function ArcaneBackdrop({ mood = "arcane", cy = 0.4 }: { mood?: BackdropMood; cy?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const m = MOODS[mood];
    const motes: Mote[] = Array.from({ length: 70 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vy: 4 + Math.random() * 10,
      phase: Math.random() * Math.PI * 2,
      warm: Math.random() < 0.3,
    }));
    const glyphs = Array.from({ length: 24 }, () => Math.floor(Math.random() * 16));
    const bg = ctx.createRadialGradient(W / 2, H * cy, 10, W / 2, H * cy, W * 0.62);
    bg.addColorStop(0, m.bg[0]);
    bg.addColorStop(1, m.bg[1]);

    let raf = 0;
    let last = 0;
    const t0 = performance.now();
    const px = (x: number, y: number, rgb: string, a: number) => {
      ctx.fillStyle = `rgba(${rgb},${a})`;
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    };
    const ring = (cx: number, cyy: number, r: number, rot: number, rgb: string, a: number, dashed: boolean) => {
      const steps = Math.ceil(r * 7);
      for (let i = 0; i < steps; i++) {
        if (dashed && i % 6 > 3) continue;
        const ang = (i / steps) * Math.PI * 2 + rot;
        px(cx + Math.cos(ang) * r, cyy + Math.sin(ang) * r * 0.92, rgb, a);
      }
    };
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < FRAME_MS) return;
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const t = (now - t0) / 1000;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2;
      const c = H * cy;
      const breathe = 0.5 + 0.5 * Math.sin(t * 0.8);
      ring(cx, c, 74, t * 0.05, m.ring, 0.16 + breathe * 0.06, false);
      ring(cx, c, 68, -t * 0.08, m.ring, 0.22, true);
      ring(cx, c, 50, t * 0.12, m.ring, 0.1, false);
      // Runes riding between the rings: tiny 3×3 glyphs from a 4-bit mask.
      for (let i = 0; i < glyphs.length; i++) {
        const ang = (i / glyphs.length) * Math.PI * 2 - t * 0.08;
        const gx = cx + Math.cos(ang) * 59;
        const gy = c + Math.sin(ang) * 59 * 0.92;
        const g = glyphs[i];
        const a = 0.25 + 0.25 * Math.sin(t * 2 + i);
        px(gx, gy - 1, m.ring, a);
        if (g & 1) px(gx - 1, gy, m.ring, a);
        if (g & 2) px(gx + 1, gy, m.ring, a);
        if (g & 4) px(gx, gy + 1, m.ring, a);
        if (g & 8) px(gx - 1, gy + 1, m.ring, a);
        px(gx, gy, m.ring, a * 0.7);
      }
      // Hexagram spokes, very faint.
      for (let k = 0; k < 6; k++) {
        const a1 = (k / 6) * Math.PI * 2 + t * 0.05;
        const a2 = a1 + (Math.PI * 2) / 3;
        for (let s = 0; s <= 1; s += 0.012) {
          const x = cx + Math.cos(a1) * 50 * (1 - s) + Math.cos(a2) * 50 * s;
          const y = c + (Math.sin(a1) * 50 * (1 - s) + Math.sin(a2) * 50 * s) * 0.92;
          px(x, y, m.ring, 0.07);
        }
      }
      for (const mo of motes) {
        mo.y -= mo.vy * dt;
        mo.x += Math.sin(t * 0.7 + mo.phase) * 3 * dt;
        if (mo.y < -2) {
          mo.y = H + 2;
          mo.x = Math.random() * W;
        }
        const flick = 0.35 + 0.45 * Math.abs(Math.sin(t * 2.2 + mo.phase));
        px(mo.x, mo.y, mo.warm ? m.mote[1] : m.mote[0], flick * (mo.y / H));
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [mood, cy]);
  return <canvas ref={ref} width={W} height={H} className="wm-backdrop" style={{ objectFit: "cover" }} />;
}
