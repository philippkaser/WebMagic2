import { useCallback, useEffect, useRef, useState } from "react";

/** Things that REPLACE each other in the world — a new staff in the gear
 * row, a different potion in a belt socket, the next lore tablet — never
 * swap in place: the old one plays its exit while the new one arrives.
 *
 * Give it the current value (or null) and a key; it returns every entry
 * still on stage, with `shown` false for the ones on their way out. Call
 * `remove(id)` from the exit's onHidden to let an entry go. A value whose
 * key is unchanged is updated in place (a stack count ticking down doesn't
 * rebuild the potion). */

export interface StageEntry<T> {
  /** Stable React key: unique per appearance, even for a repeated key. */
  id: number;
  key: string;
  value: T;
  shown: boolean;
}

let nextId = 1;

export function usePresenceList<T>(current: T | null, key: string | null): {
  entries: StageEntry<T>[];
  remove: (id: number) => void;
} {
  const [entries, setEntries] = useState<StageEntry<T>[]>(() =>
    current !== null && key !== null ? [{ id: nextId++, key, value: current, shown: true }] : [],
  );
  const latest = useRef(current);
  latest.current = current;

  useEffect(() => {
    setEntries((prev) => {
      const live = prev.find((e) => e.shown);
      const value = latest.current;
      if (live && live.key === key && value !== null) {
        return live.value === value ? prev : prev.map((e) => (e === live ? { ...e, value } : e));
      }
      const faded = prev.map((e) => (e.shown ? { ...e, shown: false } : e));
      return key !== null && value !== null ? [...faded, { id: nextId++, key, value, shown: true }] : faded;
    });
  }, [key, current]);

  const remove = useCallback((id: number) => setEntries((prev) => prev.filter((e) => e.id !== id || e.shown)), []);
  return { entries, remove };
}
