import type { ReactNode } from "react";
import { HoloPane } from "./holo/HoloPane";
import { holoColor, type FrameKind } from "./theme";

/** A small cast panel — for prompts, messages, tooltips and labels: a little
 * plane of light (holo/HoloPane) in the colour of its `frame`, with a dark
 * haze behind it, cast quickly from a line and collapsing back into one.
 * No frame and no hard edge: it feathers out. Big menus use Tablet.
 *
 * Children sit on the plate's face (local z = 0.002). */

export interface PlateProps {
  width: number;
  height: number;
  /** A named look (brass, arcane, iron, blood, gold, violet) or a colour. */
  frame?: FrameKind | string;
  /** World size of one frame texel — sizes the plate's holo pixels. */
  texel: number;
  /** Ignored (kept for callers): the haze is the caster's. */
  fill?: string;
  /** How dark the haze behind it is, 0…1. */
  fillOpacity?: number;
  /** Seconds the cast takes (scales the beats). */
  forgeTime?: number;
  children?: ReactNode;
  position?: readonly [number, number, number];
}

export function Plate({ width, height, frame = "brass", texel, fillOpacity = 0.86, forgeTime = 0.35, children, position }: PlateProps) {
  const outerW = width + texel * 2;
  const outerH = height + texel * 2;
  return (
    <group position={position as [number, number, number] | undefined}>
      <HoloPane
        width={outerW}
        height={outerH}
        color={holoColor(frame)}
        smoke={Math.min(1, fillOpacity * 1.05)}
        speed={0.7 / Math.max(0.1, forgeTime)}
        float={false}
        quiet
      >
        {children}
      </HoloPane>
    </group>
  );
}
