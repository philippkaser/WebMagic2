import { useEffect, useState, type CSSProperties } from "react";
import { gameEvents } from "../../core/events";

/** Top-center boss health. Driven purely by the `bossHp` event (null hides
 * it), so it works the same whether we simulate the boss or replicate it. */
export function BossBar() {
  const [boss, setBoss] = useState<{ name: string; frac: number } | null>(null);
  useEffect(() => gameEvents.on("bossHp", setBoss), []);
  if (!boss) return null;
  return (
    <div style={bossBarStyle}>
      <div style={{ fontSize: 13, letterSpacing: 4, color: "#ff6a52", marginBottom: 4 }}>
        {boss.name}
      </div>
      <div style={{ height: 12, background: "#170a0a", border: "1px solid #5a2a24" }}>
        <div
          style={{
            height: "100%",
            width: `${Math.max(0, boss.frac * 100)}%`,
            background: "linear-gradient(#ff5136, #8a1d10)",
            transition: "width 150ms linear",
          }}
        />
      </div>
    </div>
  );
}

const bossBarStyle: CSSProperties = {
  position: "absolute",
  top: 20,
  left: "50%",
  transform: "translateX(-50%)",
  width: "min(46vw, 520px)",
  textAlign: "center",
};
