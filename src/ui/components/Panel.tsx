import type { CSSProperties, ReactNode } from "react";

export type FrameKind = "brass" | "arcane" | "iron" | "blood" | "gold" | "violet";

/** Stone panel with a nine-slice pixel frame and an optional title plate. */
export function Panel({
  frame = "brass",
  parchment,
  solid,
  title,
  className,
  style,
  children,
}: {
  frame?: FrameKind;
  parchment?: boolean;
  solid?: boolean;
  title?: ReactNode;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const cls = [
    "wm-panel",
    frame !== "brass" && `wm-panel--${frame}`,
    parchment && "wm-panel--parchment",
    solid && "wm-panel--solid",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} style={style}>
      {title && <div className="wm-panel__title">{title}</div>}
      {children}
    </div>
  );
}

export function Rule() {
  return <div className="wm-rule" />;
}

/** A small keyboard/mouse key glyph. */
export function KeyCap({ k, big, mouse }: { k: string; big?: boolean; mouse?: boolean }) {
  return <span className={`wm-key${big ? " wm-key--big" : ""}${mouse ? " wm-key--mouse" : ""}`}>{k}</span>;
}
