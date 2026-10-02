import { useCallback, useEffect, useRef, useState } from "react";
import { useMapCast, type MapCast } from "./mapStore";

/** Every cast map on stage: those standing (`shown`), and those folded but
 * still playing their collapse — until `drop(id)` lets them go. Used by both
 * halves of the map: the light on the floor (world canvas) and its words
 * (UI canvas), each staging on its own. */
export function useStagedCasts(): { entries: { cast: MapCast; shown: boolean }[]; drop: (id: string) => void } {
  const casts = useMapCast((s) => s.casts);
  const [leaving, setLeaving] = useState<MapCast[]>([]);
  const prev = useRef<MapCast[]>(casts);
  useEffect(() => {
    const gone = prev.current.filter((c) => !casts.some((n) => n.id === c.id));
    prev.current = casts;
    if (gone.length) setLeaving((l) => [...l, ...gone]);
  }, [casts]);
  const drop = useCallback((id: string) => setLeaving((l) => l.filter((c) => c.id !== id)), []);
  const entries = [
    ...casts.map((cast) => ({ cast, shown: true })),
    ...leaving.filter((c) => !casts.some((n) => n.id === c.id)).map((cast) => ({ cast, shown: false })),
  ];
  return { entries, drop };
}
