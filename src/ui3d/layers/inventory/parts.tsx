import type { ReactNode } from "react";
import { pxFor } from "../../anchors";
import { Plate } from "../../Plate";
import { useUiShow } from "../../presence";
import type { TextInput } from "../../font/layout";
import { measureText, RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { SCENE_DISTANCE, TEXT } from "./layout";
import { flat, plane, recessMaterial } from "./materials";
import { PixelSprite } from "./sprites";

/** The grimoire panel's furniture, shared by the altar, the chest and
 * Maro's stall (artpass Panel.tsx / styles.css): the title plate riding the
 * top of the frame, the blackletter headline, the brass rule with its
 * diamond, small-caps section labels and the recessed wells that hold the
 * cards. All of it lies on a tablet's face and appears with its words. */

export const LABEL_PX = pxFor(SCENE_DISTANCE, TEXT.label);
export const TITLE_PX = pxFor(SCENE_DISTANCE, TEXT.title);
export const LORE_PX = pxFor(SCENE_DISTANCE, TEXT.lore);
/** World size of a panel-furniture texel (rules, recess edges, plates). */
export const PANEL_TEXEL = 0.0042;

/** The label plate on a panel's top edge (`.wm-panel__title`): small caps in
 * light brass on an ink plate, framed in brass, forging itself in. */
export function TitlePlate({ text, y, frame = "brass" }: { text: string; y: number; frame?: string }) {
  const px = LABEL_PX;
  const m = measureText(text, px, undefined, "label");
  const w = m.width + px * 9;
  const h = px * 7 + px * 5;
  return (
    <Plate width={w} height={h} frame={frame} texel={PANEL_TEXEL * 0.9} fill={ink.ink} fillOpacity={1} position={[0, y, 0.012]}>
      <RuneText text={text} font="label" px={px} color={ink.brassLight} glow={0.4} outline={0} depth={-0.2} />
    </Plate>
  );
}

/** A panel headline in the heading face, left-aligned (`.wm-inv__h`). */
export function Headline({ text, x, y, delay = 0 }: { text: string; x: number; y: number; delay?: number }) {
  return (
    <RuneText
      text={text}
      font="heading"
      px={TITLE_PX}
      color={ink.parchment}
      glow={0.7}
      align="left"
      anchor={[0, 0.5]}
      position={[x, y, 0.002]}
      delay={delay}
    />
  );
}

/** Small caps in faded ink (`.wm-label`). */
export function SectionLabel({
  text,
  x,
  y,
  align = "left",
  color = ink.faded,
  delay = 0.1,
}: {
  text: TextInput;
  x: number;
  y: number;
  align?: "left" | "right" | "center";
  color?: string;
  delay?: number;
}) {
  return (
    <RuneText
      text={text}
      font="label"
      px={LABEL_PX}
      color={color}
      glow={0.25}
      align={align}
      anchor={[align === "left" ? 0 : align === "right" ? 1 : 0.5, 0.5]}
      position={[x, y, 0.002]}
      delay={delay}
    />
  );
}

/** A lore line under a headline (`.wm-dim`): parchment-dim body text. */
export function Lore({ text, x, y, delay = 0.2 }: { text: string; x: number; y: number; delay?: number }) {
  return (
    <RuneText text={text} px={LORE_PX} color={ink.parchmentDim} glow={0.3} align="left" anchor={[0, 0.5]} position={[x, y, 0.002]} delay={delay} />
  );
}

/** The brass rule (`.wm-rule`, the banner's `—— ◆ ——`): a hard 1-texel line,
 * dark brass at the ends and bright in the middle (three steps instead of a
 * gradient), with a brass diamond at its centre. */
export function GoldRule({ x0, x1, y, diamond = true }: { x0: number; x1: number; y: number; diamond?: boolean }) {
  const shown = useUiShow();
  const w = x1 - x0;
  const c = (x0 + x1) / 2;
  const t = PANEL_TEXEL;
  return (
    <group position={[0, y, 0.0015]} visible={shown}>
      <mesh geometry={plane()} material={flat(ink.brassDark)} scale={[w, t, 1]} position={[c, 0, 0]} />
      <mesh geometry={plane()} material={flat(ink.brass)} scale={[w * 0.6, t, 1]} position={[c, 0, 0.0002]} />
      <mesh geometry={plane()} material={flat(ink.ink)} scale={[w, t, 1]} position={[c + t, -t, -0.0002]} />
      {diamond && <PixelSprite name="diamond" tint={ink.brass} px={t * 1.2} position={[c, 0, 0.0006]} delay={0.15} />}
    </group>
  );
}

/** A well sunk into the panel that cards sit in (`.wm-grid`). */
export function Recess({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children?: ReactNode }) {
  const shown = useUiShow();
  return (
    <group position={[x, y, 0]}>
      <mesh geometry={plane()} material={recessMaterial(w, h, PANEL_TEXEL)} scale={[w, h, 1]} position={[0, 0, 0.0008]} visible={shown} renderOrder={2} />
      {children}
    </group>
  );
}
