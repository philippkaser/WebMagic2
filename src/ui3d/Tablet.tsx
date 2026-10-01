import type { ReactNode } from "react";
import { HoloPane, HOLO_EXIT } from "./holo/HoloPane";
import { holoColor, type FrameKind } from "./theme";

/** A tablet: the surface every menu is written on — cast, not carved. It is
 * a pane of light (holo/HoloPane) the wizard projects into the air: with
 * `projector`, a sigil burns onto the floor below it and a beam rises into
 * it; a line grows, sweeps up, the pane tunes in, and only then do the
 * words write themselves. Closing collapses it back into its line and its
 * sigil.
 *
 * Visibility comes from the enclosing `<UiPresence>` (presence.tsx), so a
 * menu is simply:
 *
 *   <UiPresence show={phase === "dead"} exit={TABLET_EXIT}>
 *     <ViewAnchor offset={[0, 0, -1.6]}>
 *       <Tablet width={1.1} height={0.8} projector> …RuneText, RuneButton… </Tablet>
 *     </ViewAnchor>
 *   </UiPresence>
 *
 * Children are placed on the pane (local z = 0 is its face, origin at its
 * centre) and only become visible once it has tuned in. */

/** Seconds a closing tablet needs before it may unmount. */
export const TABLET_EXIT = HOLO_EXIT + 0.05;

export interface TabletProps {
  width: number;
  height: number;
  /** Kept for callers (the stone tablets' depth); a pane has none. */
  thickness?: number;
  /** Kept for callers; ignored. */
  tile?: number;
  /** Kept for callers; ignored. */
  tint?: string;
  /** The light's colour: a named look (brass, arcane, iron, blood, gold,
   * violet — theme.holoColor) or any colour. */
  frame?: FrameKind | string;
  /** World size of one holo pixel (default: from the pane's size). */
  frameTexel?: number;
  /** Older name for `frame`. */
  accent?: string;
  /** Idle float. */
  float?: boolean;
  /** Lean toward the pointer (menus you click on). */
  tilt?: boolean;
  /** Rise from a sigil cast on the floor. */
  projector?: boolean;
  seed?: number;
  /** Silent cast (e.g. many small tablets at once). */
  quiet?: boolean;
  children?: ReactNode;
}

export function Tablet({ width, height, frame, accent, float = true, tilt = false, projector = false, seed = 1, quiet = false, children }: TabletProps) {
  return (
    <HoloPane
      width={width}
      height={height}
      color={holoColor(frame ?? accent ?? "brass")}
      projector={projector}
      float={float}
      tilt={tilt}
      seed={seed}
      quiet={quiet}
    >
      {children}
    </HoloPane>
  );
}
