/** ui3d — the in-world UI. Every menu, prompt, message and item the player
 * sees is a physical thing in the world's space: text burns into the air
 * ahead of you as runes that settle into letters, menus are stone tablets
 * that assemble out of the dark, items are small 3D objects.
 *
 * Architecture
 *   UiCanvas.tsx     a second, transparent, full-resolution canvas over the
 *                    (pixelated) world canvas, looking through the world
 *                    camera (bridge.tsx), with its own torchlight. Click-
 *                    through during play; catches the pointer in menus.
 *   UiRoot.tsx       the list of layers (like ui/HUD.tsx for the DOM).
 *   layers/          self-contained layers: messages, prompts, HUD, menus…
 *
 * Toolkit
 *   RuneText         pixel-font text that materializes / dissolves
 *                    (text/RuneText.tsx; font/ holds the font + layout)
 *   Tablet           a menu surface that builds itself from stones
 *   RuneButton       a pressable stone plaque with a kindling seam
 *   ItemModel        any item as a procedural 3D model
 *   ViewAnchor / WorldAnchor / placeInFront / pxFor   (anchors.tsx)
 *   UiPresence / UiShow / useUiShow   enter/exit choreography (presence.tsx)
 *   UiTextStyleProvider               ambient text defaults (style.tsx)
 *   emitUiSparks     embers in the UI layer (UiSparks.tsx)
 *   stoneMaterial / metalMaterial / glowMaterial   (materials.ts)
 *   audio/uiSounds.ts                 the UI's sound bank
 *
 * Conventions
 *   - Distances in metres from the eye; HUD pieces sit 0.8–1.6 m ahead,
 *     menus ~1.5 m. Size text with pxFor(distance, screenFraction) so it's
 *     the same share of the screen on any display (≥ 0.016 stays legible
 *     at 800 px tall).
 *   - Nothing pops. Wrap conditional UI in <UiPresence show exit> and let
 *     RuneText/Tablet/RuneButton/ItemModel read useUiShow().
 *   - No per-frame allocations and no per-frame React state: animate in
 *     useFrame through refs; text changes are cheap but not free.
 *   - The DOM keeps only what isn't part of the fiction: the perf overlay,
 *     the build stamp and the dev room. */

export { ViewAnchor, WorldAnchor, placeInFront, pxFor, worldPerScreenPixel, BASE_FOV } from "./anchors";
export { worldView, WorldCameraBridge } from "./bridge";
export { uiNow } from "./clock";
export { ItemModel } from "./ItemModel";
export { glowMaterial, metalMaterial, stoneMaterial } from "./materials";
export { UiPresence, UiShow, UiShowContext, useUiShow } from "./presence";
export { RuneButton } from "./RuneButton";
export { UiTextStyleProvider, useUiTextStyle } from "./style";
export { Tablet, TABLET_EXIT } from "./Tablet";
export { RuneText, measureText } from "./text/RuneText";
export { emitUiSparks } from "./UiSparks";
export type { TextInput, TextSpan, Align } from "./font/layout";
