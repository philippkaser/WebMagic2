import { HoloPane } from "./holo/HoloPane";
import { measureText, RuneText } from "./text/RuneText";
import { ink } from "./theme";

/** A key cap — a small bright tile of parchment light with the key dark on
 * it (the grimoire's `.wm-key`, cast like every other pane), for prompts
 * and legends: [E] Plunder…, [TAB] satchel. `px` sizes the letters like
 * RuneText's. */
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
    <group position={position as [number, number, number] | undefined}>
      <HoloPane width={w + texel * 2} height={h + texel * 2} color={ink.parchment} cellPx={1.6} fill={7} smoke={0.9} border={false} float={false} speed={2.4} quiet>
        <RuneText text={label} font="label" px={px} color={ink.ink} glow={0} outline={0} depth={-0.2} />
      </HoloPane>
    </group>
  );
}

/** Width of a key cap at `px` (for laying out a row). */
export function keyCapWidth(k: string, px: number): number {
  const size = measureText(k.toUpperCase(), px, undefined, "label");
  return Math.max(size.width + px * 5, size.height + px * 5) + px * 0.9 * 2;
}
