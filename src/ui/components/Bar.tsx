import type { ReactNode } from "react";

/** Segmented pixel bar. A pale "ghost" trails the fill on loss, so a big hit
 * reads as a chunk bitten out rather than a number ticking down. */
export function Bar({
  value,
  max,
  fill,
  icon,
  label,
  segments = 10,
  height = 12,
  showNumbers = true,
}: {
  value: number;
  max: number;
  /** CSS background of the fill. */
  fill: string;
  icon?: ReactNode;
  label?: string;
  segments?: number;
  height?: number;
  showNumbers?: boolean;
}) {
  const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const width = `${(frac * 100).toFixed(2)}%`;
  return (
    <div className="wm-bar">
      {(icon || label || showNumbers) && (
        <div className="wm-bar__head">
          {icon}
          {label && <span className="wm-label">{label}</span>}
          {showNumbers && (
            <span className="wm-bar__num">
              {Math.ceil(value)} / {Math.round(max)}
            </span>
          )}
        </div>
      )}
      <div className="wm-bar__track" style={{ height }}>
        <div className="wm-bar__ghost" style={{ width }} />
        <div className="wm-bar__fill" style={{ width, backgroundColor: fill }} />
        <div className="wm-bar__ticks" style={{ backgroundSize: `${100 / segments}% 100%` }} />
      </div>
    </div>
  );
}
