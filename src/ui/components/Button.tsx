import type { ReactNode } from "react";
import { playUiClick } from "../../audio/sound";

export type ButtonVariant = "primary" | "ghost" | "danger" | "gold";

/** Framed pixel button with a soft synthesized click. */
export function Button({
  variant = "primary",
  small,
  glyphs,
  onClick,
  children,
}: {
  variant?: ButtonVariant;
  small?: boolean;
  /** Flank the label with arcane glyphs (the title's main call to action). */
  glyphs?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const cls = ["wm-btn", variant !== "primary" && `wm-btn--${variant}`, small && "wm-btn--small"]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      className={cls}
      onClick={() => {
        playUiClick();
        onClick();
      }}
    >
      {glyphs && <span className="wm-btn__glyph">✦</span>}
      {children}
      {glyphs && <span className="wm-btn__glyph">✦</span>}
    </button>
  );
}
