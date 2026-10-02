import { Pop } from "./Plate";
import { slabGeometry, parchmentMaterial } from "./slab";
import { measureText, RuneText } from "./text/RuneText";
import { ink } from "./theme";

/** A key cap — a little rounded cap of worn parchment with the key in ink
 * on it, standing a touch proud of whatever it sits on (the grimoire's
 * `.wm-key`), for prompts and legends: [E] Plunder…, [TAB] satchel. `px`
 * sizes the letters like RuneText's. */
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
      <Pop time={0.25}>
        <mesh geometry={slabGeometry(w + texel * 2, h + texel * 2, texel * 3, (h + texel * 2) * 0.3)} material={parchmentMaterial()} position={[0, 0, texel * 2]} renderOrder={5} />
      </Pop>
      <RuneText text={label} font="label" px={px} color={ink.ink} glow={0} outline={0} depth={-0.2} position={[0, 0, texel * 2 + 0.0005]} />
    </group>
  );
}

/** Width of a key cap at `px` (for laying out a row). */
export function keyCapWidth(k: string, px: number): number {
  const size = measureText(k.toUpperCase(), px, undefined, "label");
  return Math.max(size.width + px * 5, size.height + px * 5) + px * 0.9 * 2;
}
