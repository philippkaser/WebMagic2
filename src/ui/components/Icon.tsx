import type { CSSProperties } from "react";
import { getItemDef } from "../../items/catalog";
import type { ItemInstance, Slot } from "../../items/types";
import { sprite, type SpriteName } from "../pixelArt";

/** A procedural pixel sprite at an integer scale. */
export function Icon({
  name,
  tint,
  scale = 2,
  className,
  style,
}: {
  name: SpriteName;
  tint?: string;
  scale?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const s = sprite(name, tint);
  return (
    <img
      src={s.url}
      width={s.w * scale}
      height={s.h * scale}
      alt=""
      draggable={false}
      className={`wm-px${className ? ` ${className}` : ""}`}
      style={style}
    />
  );
}

/** The slot's sprite painted in the item's own colour. */
export function ItemIcon({ item, slot, scale = 3 }: { item: ItemInstance | null; slot: Slot; scale?: number }) {
  const tint = item ? getItemDef(item.defId).color : "#8a8090";
  return <Icon name={slot} tint={tint} scale={scale} />;
}
