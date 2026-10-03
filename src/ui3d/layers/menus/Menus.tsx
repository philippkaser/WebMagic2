import { CodexTome } from "./CodexTome";
import { DeathScreen } from "./DeathScreen";
import { MainMenu } from "./MainMenu";
import { WeighingScreen } from "./WeighingScreen";

/** Every menu screen, as physical things in the world — in the grimoire's
 * hand (after the artpass DOM screens), building themselves out of the dark.
 *
 *   MainMenu        phase "menu": "WebMagic" in blackletter before the
 *                   turning arcane circle, the premise, the three laws on
 *                   stone tablets, your name, the way in, settings, keys
 *   WeighingScreen  phase "weighing": the gear as framed item cards, threads
 *                   of light to the resonance, "Floor N" burning above, the
 *                   gate's words on a brass panel
 *   DeathScreen     phase "dead": "You Died" in blood before the blood
 *                   circle; the lost things as item cards that crumble to
 *                   ash or sink into your grave
 *   CodexTome       overlay "codex": a leather grimoire whose pages turn
 *
 * Shared staging (stage.tsx: Stage, Veil, Delayed, Appear), the circle
 * (ArcaneCircle.tsx), the grimoire's furniture (grimoire.tsx: TitleText,
 * Flourish, PixelIcon, KeyLegend; ItemCard.tsx; icons.ts), light (fx.tsx),
 * copy (menuText.ts, codexPages.ts, lostItems.ts, itemLook.ts — pure and
 * tested) and sounds (menuSounds.ts) live beside them.
 *
 * Each screen decides for itself when it stands and plays its own entrance
 * and exit inside <UiPresence exit={TABLET_EXIT}>, so this is only the list.
 * Store actions and phases are untouched: scripts that call openWeighing(),
 * enterDungeon() or respawn() directly see the same game. */
export function Menus() {
  return (
    <>
      <MainMenu />
      <WeighingScreen />
      <DeathScreen />
      <CodexTome />
    </>
  );
}
