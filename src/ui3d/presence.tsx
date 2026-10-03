import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/** Enter/exit choreography for in-world UI.
 *
 * Nothing in the world pops: text dissolves, tablets fall apart. That needs
 * two things React doesn't give by default — keeping a subtree mounted while
 * it plays its exit, and telling every element inside it that it's leaving.
 *
 *  - `UiShowContext` is the ambient "should I be visible?" flag. RuneText,
 *    RuneButton, ItemModel and Tablet all AND it into their own `show`, so a
 *    whole tablet's contents dissolve when the tablet closes — without
 *    threading props through every child.
 *  - `<UiPresence show={…} exit={s}>` keeps its children mounted for `exit`
 *    seconds after `show` turns false, with the context false meanwhile. */

export const UiShowContext = createContext(true);

/** Whether the enclosing presence/tablet is showing. */
export function useUiShow(): boolean {
  return useContext(UiShowContext);
}

/** Provide a nested visibility (ANDed with the enclosing one). */
export function UiShow({ show, children }: { show: boolean; children: ReactNode }) {
  const outer = useContext(UiShowContext);
  return <UiShowContext.Provider value={outer && show}>{children}</UiShowContext.Provider>;
}

export function UiPresence({
  show,
  exit = 1,
  children,
}: {
  show: boolean;
  /** Seconds to keep the subtree mounted after `show` turns false. */
  exit?: number;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(show);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (show) setMounted(true);
    else timer.current = setTimeout(() => setMounted(false), exit * 1000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [show, exit]);
  if (!mounted && !show) return null;
  return <UiShow show={show}>{children}</UiShow>;
}
