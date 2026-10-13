import { useEffect, useMemo, useState } from "react";
import { liveBuffs, withBlessings } from "../items/buffs";
import { computeStats } from "../items/catalog";
import type { DerivedStats } from "../items/types";
import { useGame } from "./gameStore";

/** The wizard's stats as React state: worn gear with any live blessings
 * folded in (what getStats() reads), re-evaluated when gear or blessings
 * change and again the moment the next blessing runs out — so a shrine's
 * bargain shows on the HUD while it lasts, and not a moment longer. */
export function useStats(): DerivedStats {
  const equipment = useGame((s) => s.equipment);
  const buffs = useGame((s) => s.buffs);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const now = performance.now();
    const next = Math.min(...liveBuffs(buffs, now).map((b) => b.until));
    if (!Number.isFinite(next)) return;
    const t = setTimeout(() => setTick((n) => n + 1), next - now + 20);
    return () => clearTimeout(t);
  }, [buffs, tick]);
  return useMemo(() => {
    const gear = computeStats(equipment);
    return buffs.length > 0 ? withBlessings(gear, buffs, performance.now()) : gear;
    // `tick` re-folds when a blessing expires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipment, buffs, tick]);
}
