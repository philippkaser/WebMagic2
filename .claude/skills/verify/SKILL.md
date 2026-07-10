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
- **Dev state hook**: `window.__game` (zustand store) is exposed in dev — read
  `getState().phase/.prompt/.floor` to know where you are, `setState({checkpoint: 10})`
  to unlock waystone floors. Prefer real inputs for the flow under test; use the
  hook for assertions and setup.
- **Capturing transitions mid-flight**: `enterDungeon`/`descend` return a
  Promise that only resolves once the ~1.4s warp finishes. `await page.evaluate(
  () => window.__game.getState().enterDungeon(1))` blocks for the whole warp, so
  every screenshot after it shows the *destination*, never the tunnel. Fire and
  forget instead — `page.evaluate(() => { window.__game.getState().enterDungeon(1); })`
  (no return) — then sleep 400–900ms and screenshot to catch the warp shader.
  The full-screen transitions (portal warp, mind-dive) render on their own
  low-res WebGL canvas (`ui/shaderCanvas.ts`), a second GL context beside R3F.

## Flows worth driving

- Splash → BECOME THE WIZARD → mind-dive → village (screenshot each beat).
- Walk W from spawn `[0,1.2,10]` toward the rift at origin; poll
  `getState().prompt` every 100 ms and stop when it appears (don't walk a fixed
  time — you'll overshoot).
- E at the rift → phase `loading` (warp canvas) → `dungeon`, floor 1; pointer
  lock must survive the whole trip.
- Waystone: `setState({checkpoint: 10})`, turn left ~300px-equivalent, walk to
  the slab at `[-4.2, 1.8]`, E cycles 1→5→10.
- Multiplayer (hooded wizard models): start `dev:server`, boot two pages, both
  enter floor 1 (they share an instance), spin one camera in 8×45° steps and
  screenshot each — one frame will contain the peer.
