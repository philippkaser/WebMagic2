import { useCallback, useReducer, useRef } from "react";
import { useMapCast, type MapCast } from "./mapStore";

/** Every cast map on stage: those standing (`shown`), and those folded but
 * still playing their fold — until `drop(id)` lets them go.
 *
 * A map leaving the store is noticed during the same render it leaves in
 * (not in an effect after), so it never drops out of the list for a render:
 * a gap would unmount it and remount it fresh, restarting the map instead of
 * folding it. */
export function useStagedCasts(): { entries: { cast: MapCast; shown: boolean }[]; drop: (id: string) => void } {
  const casts = useMapCast((s) => s.casts);
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const prev = useRef<MapCast[]>(casts);
  const leaving = useRef(new Map<string, MapCast>());
  for (const c of prev.current) if (!casts.some((n) => n.id === c.id)) leaving.current.set(c.id, c);
  prev.current = casts;
  const drop = useCallback((id: string) => {
    if (leaving.current.delete(id)) rerender();
  }, []);
  const entries = [
    ...casts.map((cast) => ({ cast, shown: true })),
    ...[...leaving.current.values()].filter((c) => !casts.some((n) => n.id === c.id)).map((cast) => ({ cast, shown: false })),
  ];
  return { entries, drop };
}
