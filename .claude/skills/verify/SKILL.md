---
name: verify
description: Build, launch and drive WebMagic in headless Chromium to verify changes at the real surface (screenshots, game-state probes).
---

# Verifying WebMagic changes

## Launch

```sh
bun install                 # if node_modules is missing
bun run dev                 # vite only → http://localhost:3000, client runs offline
bun run dev:server          # optional: real matchmaking ws on :3001 (vite proxies /ws)
```

Offline mode logs two `WebSocket connection … failed` console errors — expected,
the client falls back to single-player.

## Drive with playwright-core (already a devDependency)

```js
import { chromium } from "playwright-core";
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium", // remote env; locally omit
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
```

Run scripts with `bun script.mjs` from a dir where the repo's node_modules
resolves (or cwd into the repo) — plain `node` won't find playwright-core.

## Gotchas that will eat your session

- **Key presses must span frames.** `input.consume()` is edge-triggered and
  `keyup` clears the edge; under swiftshader the game runs ~10–20 fps, so
  `page.keyboard.press("e")` lands down+up inside one frame and is ignored.
  Always `down(key)` → `sleep(250)` → `up(key)`.
- **Camera turns need synthetic movementX.** Two `mouse.move` calls cancel out
  under pointer lock. Instead:
  `page.evaluate(() => document.dispatchEvent(new MouseEvent("mousemove", { movementX: 220 })))`.
- **Pointer lock**: click the canvas center first (`page.mouse.click(640, 360)`).
- **Dev hooks** (dev builds only): `window.__game` (game store — read
  `getState().phase/.prompt/.floor/.run`, `setState` for setup), `window.__net`
  (net store: allies, pactOffers, floorPlayers), `window.__session`,
  `window.__events` (gameEvents), `window.__entryFloor = N` (set *before*
  `enterDungeon()` to force the rift's floor — it's lost on reload),
  `window.__teleport(x,y,z)`, `window.__hittables()`,
  `window.__dropLoot(defId, rarity, [x,y,z])`, `window.__bestiary.look(x,y,z)` /
  `.calm(true)` (aim the camera, pause enemy brains for model shots). Prefer real
  inputs for the flow under test; use the hooks for assertions and setup.
- **Poll, don't sleep**: floor entry and peer discovery vary a lot under
  swiftshader. Wait on a condition (`phase === "dungeon"`, peer position known)
  instead of fixed sleeps.
- **Remains are real**: unclaimed death chests from earlier runs are inherited
  by later instances of that floor (server lifetime). Filter
  `__session.chests` by owner/`pos` in tests.
- **Capturing transitions mid-flight**: `enterDungeon`/`descend` return a
  Promise that only resolves once the warp finishes. `await page.evaluate(
  () => window.__game.getState().enterDungeon(1))` blocks for the whole warp, so
  every screenshot after it shows the *destination*, never the tunnel. Fire and
  forget instead — `page.evaluate(() => { window.__game.getState().enterDungeon(1); })`
  (no return). But under swiftshader each `page.screenshot` costs ~500ms (two
  WebGL contexts), so burst-capturing can't reliably sample a ~2s staged
  transition. **Use the dev preview hook instead**:
  `window.__previewTransition(mode, progress, tint)` — mode 0 = floor warp,
  1 = mind-dive — freezes the transition shader at a fixed `progress` (0–1) so
  you can screenshot each phase deterministically (suck-in ~0.1, descend ~0.5,
  suck-out ~0.8; eye-hover ~0.3, punch ~0.6, mind ~0.8). The full-screen
  transitions render on their own low-res WebGL canvas (`ui/shaderCanvas.ts`),
  a second GL context beside R3F.

## Flows worth driving

- Splash → BECOME THE WIZARD → mind-dive → village (screenshot each beat).
- Walk W from spawn `[0,1.2,10]` toward the rift at origin; poll
  `getState().prompt` every 100 ms and stop when it appears (don't walk a fixed
  time — you'll overshoot).
- E at the rift → phase `loading` (warp canvas) → `dungeon`, floor 1; pointer
  lock must survive the whole trip.
- Waystone at `[-4.2, 1.8]`: E reads your gear level and the rift's floor band.
- Satchel/stash: Tab toggles `inventoryOpen` (releases pointer lock).
- Run loop and PvP are scripted: `bun scripts/e2e/run.mjs [shotDir]` and
  `WEBMAGIC_JOIN_CHANCE=1 bun server/server.ts & bun scripts/e2e/pvp.mjs [shotDir]`
  (encounters are 30% by default — the env var forces everyone together).
- Multiplayer visuals: boot two pages on the same forced floor, teleport one
  2–3 m in front of the other, spin a camera in 8×45° steps and screenshot each.
