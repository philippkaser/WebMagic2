import { PLAYER } from "../../core/config";
import { computeStats } from "../../items/stats";
import { useGame } from "../../state/gameStore";
import { Bar } from "../components/Bar";
import { Icon } from "../components/Icon";
import { Panel } from "../components/Panel";
import { color } from "../theme";

/** Bottom-left: health and mana as segmented bars, one pip per 10 points. */
export function Vitals() {
  const health = useGame((s) => s.health);
  const mana = useGame((s) => s.mana);
  const maxHealth = useGame((s) => computeStats(s.equipment).maxHealth);
  return (
    <Panel className="wm-vitals wm-hud-bl" frame="iron">
      <Bar
        value={health}
        max={maxHealth}
        fill={health / maxHealth < 0.3 ? "#ff3a2e" : "#c42f2f"}
        icon={<Icon name="heart" tint={color.blood} scale={2} />}
        label="Vitality"
        segments={Math.max(4, Math.round(maxHealth / 10))}
        height={14}
      />
      <Bar
        value={mana}
        max={PLAYER.maxMana}
        fill="#3f7fe6"
        icon={<Icon name="drop" tint={color.mana} scale={2} />}
        label="Mana"
        segments={Math.round(PLAYER.maxMana / 10)}
        height={10}
      />
    </Panel>
  );
}
