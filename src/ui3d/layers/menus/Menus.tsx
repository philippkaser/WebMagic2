import { CodexTome } from "./CodexTome";
import { DeathScreen } from "./DeathScreen";
import { MainMenu } from "./MainMenu";
import { WeighingScreen } from "./WeighingScreen";

/** Every menu screen, as physical things in the world — the in-world
 * successors of the old DOM overlays (menu, the Weighing, death, codex).
 *
 *   MainMenu        phase "menu": WEBMAGIC burning in the air with wisps
 *                   circling it; an altarpiece of three tablets (name +
 *                   settings, the premise + ENTER, the controls)
 *   WeighingScreen  phase "weighing": the gear on pedestals, threads of
 *                   light to the RESONANCE, FLOOR N burning above
 *   DeathScreen     phase "dead": YOU DIED in blood; what was lost crumbles
 *                   to ash, or sinks into your grave
 *   CodexTome       overlay "codex": a tome whose pages really turn
 *
 * Shared staging (stage.tsx: Stage, Veil, Delayed, Appear), light (fx.tsx),
 * copy (menuText.ts, codexPages.ts, lostItems.ts — pure and tested) and
 * sounds (menuSounds.ts) live beside them.
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
