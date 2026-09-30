import { createContext, useContext, type ReactNode } from "react";

/** Ambient defaults for RuneText inside a container. A tablet, for example,
 * wants its text to settle ONTO the stone from in front (depth < 0) rather
 * than rise from behind (where the slab would hide it) — the tablet sets
 * that once here instead of every caller remembering it. Explicit props
 * always win. */
export interface UiTextStyle {
  depth?: number;
  px?: number;
  color?: string;
  glow?: number;
  outline?: number;
}

const UiTextStyleContext = createContext<UiTextStyle>({});

export function useUiTextStyle(): UiTextStyle {
  return useContext(UiTextStyleContext);
}

export function UiTextStyleProvider({ value, children }: { value: UiTextStyle; children: ReactNode }) {
  const outer = useContext(UiTextStyleContext);
  return <UiTextStyleContext.Provider value={{ ...outer, ...value }}>{children}</UiTextStyleContext.Provider>;
}
