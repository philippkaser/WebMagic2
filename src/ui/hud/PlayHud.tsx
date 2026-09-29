import { BossBar } from "./BossBar";
import { Crosshair } from "./Crosshair";
import { EquipmentPanel } from "./EquipmentPanel";
import { HurtFlash } from "./HurtFlash";
import { InteractionPrompt } from "./InteractionPrompt";
import { LocationPanel } from "./LocationPanel";
import { MessageFeed } from "./MessageFeed";
import { PactPrompt } from "./PactPrompt";
import { PresenceSense } from "./PresenceSense";
import { VitalsPanel } from "./VitalsPanel";

/** The in-game HUD, mounted while playing (village or dungeon). Deliberately
 * just a list: every widget reads its own state and positions itself, so a
 * new widget is one file in hud/ plus one line here — and a state change only
 * re-renders the widgets that read it. Order = paint order. */
export function PlayHud() {
  return (
    <>
      <Crosshair />
      <HurtFlash />
      <BossBar />
      <LocationPanel />
      <MessageFeed />
      <VitalsPanel />
      <EquipmentPanel />
      <PresenceSense />
      <InteractionPrompt />
      <PactPrompt />
    </>
  );
}
