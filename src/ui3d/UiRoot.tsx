import { useSyncExternalStore } from "react";
import { ViewAnchor, pxFor } from "./anchors";
import { ItemModel } from "./ItemModel";
import { Hud } from "./layers/hud/Hud";
import { Menus } from "./layers/menus/Menus";
import { WorldMessages } from "./layers/WorldMessages";
import { WorldPrompts } from "./layers/WorldPrompts";
import { UiPresence } from "./presence";
import { RuneButton } from "./RuneButton";
import { Tablet, TABLET_EXIT } from "./Tablet";
import { RuneText } from "./text/RuneText";

/** Everything the UI canvas shows, as a flat list of self-contained layers
 * (the in-world counterpart of ui/HUD.tsx). Each layer reads its own state
 * and decides for itself when to appear; order is irrelevant (depth sorts
 * them), so adding UI is one file in layers/ plus one line here. */
export function UiRoot() {
  return (
    <>
      <WorldMessages />
      <WorldPrompts />
      <Hud />
      <Menus />
      {import.meta.env.DEV && <DevShowcase />}
    </>
  );
}

// ── Dev showcase: `__uiShowcase(true)` in the console ────────────────────────

let showcase = false;
const listeners = new Set<() => void>();
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__uiShowcase = (on: boolean) => {
    showcase = on;
    for (const l of listeners) l();
  };
}

function DevShowcase() {
  const on = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => showcase,
  );
  return (
    <UiPresence show={on} exit={TABLET_EXIT}>
      <ViewAnchor offset={[0, 0, -1.5]}>
        <Tablet width={1.3} height={0.86} tilt>
          <RuneText text="THE WEIGHING GATE" px={pxFor(1.5, 0.034)} position={[0, 0.3, 0]} color="#e8dfc8" />
          <RuneText
            text={[
              { text: "It reads what you carry and casts you where your " },
              { text: "weight", color: "#46ffd0" },
              { text: " belongs." },
            ]}
            px={pxFor(1.5, 0.017)}
            maxCols={44}
            position={[0, 0.17, 0]}
            color="#b9b0a0"
          />
          {["ember_staff@7", "amulet_vigor+keen@5", "cloak_blink@6", "boots_hover@4", "potion_hp_weak"].map((id, i) => (
            <ItemModel key={id} itemId={id} scale={0.13} spin position={[-0.44 + i * 0.22, -0.02, 0.06]} />
          ))}
          <RuneButton label="STEP THROUGH" onPress={() => console.log("step")} position={[-0.22, -0.3, 0]} px={pxFor(1.5, 0.016)} />
          <RuneButton label="STAY" onPress={() => console.log("stay")} position={[0.3, -0.3, 0]} px={pxFor(1.5, 0.016)} accent="#8f86a0" />
        </Tablet>
      </ViewAnchor>
    </UiPresence>
  );
}
