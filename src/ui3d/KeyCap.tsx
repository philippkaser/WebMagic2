import { measureText, RuneText } from "./text/RuneText";
import { Plate } from "./Plate";
import { ink } from "./theme";

/** A key cap — a little parchment plate with the key in ink (the
 * grimoire's `.wm-key`), for prompts and legends: [E] Plunder…, [TAB]
 * satchel. `px` sizes the letters like RuneText's. */
export function KeyCap({
  k,
  px,
  position,
}: {
  k: string;
  px: number;
  position?: readonly [number, number, number];
}) {
  const label = k.toUpperCase();
  const size = measureText(label, px, undefined, "label");
  const texel = px * 0.9;
  const w = Math.max(size.width + px * 5, size.height + px * 5);
  const h = size.height + px * 4;
  return (
    <Plate width={w} height={h} frame="#eadfc4" fill={ink.parchment} fillOpacity={1} texel={texel} position={position}>
      <RuneText text={label} font="label" px={px} color={ink.ink} glow={0} outline={0} depth={-0.2} />
    </Plate>
  );
}

/** Width of a key cap at `px` (for laying out a row). */
export function keyCapWidth(k: string, px: number): number {
  const size = measureText(k.toUpperCase(), px, undefined, "label");
  return Math.max(size.width + px * 5, size.height + px * 5) + px * 0.9 * 2;
}
