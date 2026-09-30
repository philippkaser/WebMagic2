import { useState } from "react";
import { Bar } from "../components/Bar";
import { Icon } from "../components/Icon";
import { Panel } from "../components/Panel";
import { useGameEvent } from "../hooks";

/** Top-centre: the floor boss, skull-flanked, on a blood frame. */
export function BossBar() {
  const [boss, setBoss] = useState<{ name: string; frac: number } | null>(null);
  useGameEvent("bossHp", setBoss);
  if (!boss) return null;
  return (
    <div className="wm-boss wm-rise">
      <div className="wm-boss__name">
        <Icon name="skull" tint="#fff" scale={2} />
        {boss.name}
        <Icon name="skull" tint="#fff" scale={2} />
      </div>
      <Panel frame="blood" style={{ padding: 2 }}>
        <Bar value={boss.frac * 100} max={100} fill="#b3261a" segments={20} height={12} showNumbers={false} />
      </Panel>
    </div>
  );
}
