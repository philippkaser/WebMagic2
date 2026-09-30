import type { CSSProperties, MouseEvent } from "react";
import { getItemDef } from "../../items/catalog";
import { RARITIES } from "../../items/rarity";
import type { ItemInstance, Slot } from "../../items/types";
import { rarityColor } from "../theme";
import { Icon, ItemIcon } from "./Icon";

export interface ItemHoverHandlers {
  onHover?: (item: ItemInstance, e: MouseEvent) => void;
  onLeave?: () => void;
}

/** One item as a rarity-framed card: sprite, name, level plate, rarity gem,
 * and an hourglass when it's run loot the dungeon can still take back. */
export function ItemCard({
  item,
  small,
  onClick,
  onDiscard,
  onHover,
  onLeave,
  style,
}: {
  item: ItemInstance;
  small?: boolean;
  onClick?: () => void;
  onDiscard?: () => void;
  style?: CSSProperties;
} & ItemHoverHandlers) {
  const def = getItemDef(item.defId);
  const rc = rarityColor(item.rarity);
  const cls = [
    "wm-card",
    small && "wm-card--sm",
    onClick && "wm-card--click",
    item.runLoot && "wm-card--risk",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={cls}
      data-uid={item.uid}
      style={{ ["--rc" as string]: rc, ...style }}
      onClick={onClick}
      onMouseEnter={onHover && ((e) => onHover(item, e))}
      onMouseMove={onHover && ((e) => onHover(item, e))}
      onMouseLeave={onLeave}
    >
      <div className="wm-card__art">
        <ItemIcon item={item} slot={def.slot} scale={small ? 2 : 3} />
        <Icon name="gem" tint={rc} scale={small ? 1 : 2} className="wm-card__gem" />
        {item.runLoot && <Icon name="hourglass" tint="#ff8e5a" scale={small ? 1 : 2} className="wm-card__risk" />}
        <div className="wm-card__lvl" title={`${RARITIES[item.rarity].label} · level ${item.level}`}>
          {item.level}
        </div>
      </div>
      {!small && (
        <div className={`wm-card__name${/\S{10,}/.test(def.name) ? " wm-card__name--long" : ""}`}>{def.name}</div>
      )}
      {onDiscard && (
        <div
          className="wm-card__x"
          title="Discard"
          onClick={(e) => {
            e.stopPropagation();
            onDiscard();
          }}
        >
          ✕
        </div>
      )}
    </div>
  );
}

/** An empty equipment socket. */
export function EmptySlot({ slot, small, label }: { slot: Slot; small?: boolean; label?: string }) {
  return (
    <div className={`wm-card wm-card--empty${small ? " wm-card--sm" : ""}`}>
      <div className="wm-card__art">
        <Icon name={slot} tint="#8a8090" scale={small ? 2 : 3} />
      </div>
      {!small && <div className="wm-card__name wm-dim">{label ?? `no ${slot}`}</div>}
    </div>
  );
}
