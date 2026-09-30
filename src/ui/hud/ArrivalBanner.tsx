import { useEffect, useState } from "react";
import { useGame } from "../../state/gameStore";
import { biomeFor } from "../../world/biomes";

interface Banner {
  key: string;
  label: string;
  title: string;
  subtitle: string | null;
  lore: string | null;
  delay: number;
}

const VILLAGE_LORE = "Lamplight, woodsmoke, and the low hum of the rift.";

/** Big fading title card on arrival: floor number, biome and its lore line
 * (or the village). Delayed so it lands after the warp's reveal. */
export function ArrivalBanner() {
  const phase = useGame((s) => s.phase);
  const floor = useGame((s) => s.floor);
  const instanceId = useGame((s) => s.instanceId);
  const mindDiveId = useGame((s) => s.mindDiveId);
  const [banner, setBanner] = useState<Banner | null>(null);

  useEffect(() => {
    if (phase === "dungeon") {
      const biome = biomeFor(floor);
      setBanner({
        key: `f${floor}:${instanceId}`,
        label: "You descend to",
        title: `Floor ${floor}`,
        subtitle: biome.name,
        // Biomes may carry a lore line (added alongside the biome table).
        lore: (biome as { lore?: string }).lore ?? null,
        delay: 450,
      });
    } else if (phase === "village") {
      setBanner({
        key: `v${mindDiveId}`,
        label: "Sanctuary",
        title: "The Village",
        subtitle: null,
        lore: VILLAGE_LORE,
        delay: 1400,
      });
    }
  }, [phase, floor, instanceId, mindDiveId]);

  if (!banner || (phase !== "dungeon" && phase !== "village")) return null;
  return (
    <div
      key={banner.key}
      className="wm-arrival"
      style={{ animationDelay: `${banner.delay}ms`, opacity: 0 }}
      onAnimationEnd={() => setBanner(null)}
    >
      <div className="wm-arrival__label">{banner.label}</div>
      <div className="wm-arrival__floor">{banner.title}</div>
      {banner.subtitle && <div className="wm-arrival__biome">{banner.subtitle}</div>}
      <div className="wm-flourish">
        <span style={{ color: "var(--wm-brass)" }}>✦</span>
      </div>
      {banner.lore && <div className="wm-arrival__lore">{banner.lore}</div>}
    </div>
  );
}
