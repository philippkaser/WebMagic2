# WebMagic — Dungeon of the Hundred Floors

A first-person spellcaster dungeon crawler for the browser. Wizards descend
through a hundred procedurally generated floors for glory, riches — and to
find god at the bottom. Other wizards walk the same halls. Some of them will
want what you carry.

Built with **Bun + Vite + React Three Fiber + drei + Rapier physics**. Zero
binary assets: every texture is painted on a canvas at startup, every model is
built from code, every sound is synthesized.

## Quickstart

```sh
bun install
bun run dev:full   # game server + vite → http://localhost:3000 (multiplayer)
bun test           # deterministic logic tests (items, progression, worldgen, net rules)
bun run build      # typecheck + production build
bun run start      # production: serves dist/ + websocket on port 80 (PORT=… to override)
```

`bun dev` alone also works — without the game server the client plays offline
against an in-process copy of the same server rules (the HUD shows offline).

End-to-end checks drive real headless browsers:

```sh
WEBMAGIC_JOIN_CHANCE=1 bun server/server.ts &   # force every wizard together
bun scripts/e2e/run.mjs    # loot → survive 5 floors → extract / die
bun scripts/e2e/pvp.mjs    # two wizards: kill → death chest → claim
```

## Controls

| Input | Action |
| --- | --- |
| WASD / Mouse | Move / look |
| Left / Right click | Staff primary / secondary spell |
| Space | Jump (double jump / hover with the right boots) |
| Shift | Blink-dash (blinking cloaks) |
| E | Interact — rifts, loot, chests, the waystone, *other wizards* (pacts) |
| Tab / I | Satchel (dungeon) · Stash (village) |
| P / O | FPS overlay / shadows |

## The game

- **Gear decides depth.** Every item has a level and a rarity. Your *gear
  level* is the mean power of your four slots, and the village rift throws you
  in near a matching floor — with a little chaos. The waystone reads your
  power and foretells the band.
- **Survive five floors to go home.** On the fifth floor of a run a golden
  homeward rift opens beside the exit. Take it and everything you found is
  yours for good. Die before that, and the dungeon keeps every item you picked
  up this run (gear you brought in survives).
- **Satchel and stash.** Loot goes into the satchel you carry; the stash waits
  in the village. Swap gear mid-run in the satchel screen — the dungeon does
  not pause.
- **Other wizards.** Entering a floor has a small chance of dropping you into an
  instance someone else is already exploring — only ever on the same floor
  number. A presence eye tells you you're not alone, and pulses faster as they
  close in, but never *where*. Fight: spells hurt other wizards, and a fallen
  wizard leaves a chest holding everything they lost. Or walk up and press E to
  offer a pact: allies' spells spare each other, and pact partners travel to
  the next floor together.
- **Remains.** An unclaimed death chest outlives its floor: later instances of
  that floor inherit it, tucked in a quiet corner, marked with the dead
  wizard's name.
- **Five biomes** — the Bone Catacombs, the Drowned Crypts, the Ember Forge, the
  Crystal Hollows and the Abyssal Throne — each with its own architecture,
  light, grade and bestiary: skitters that leap, drowned brutes with anchors,
  blinking shades, fireball imps, shielded crystal golems, and mimics that look
  exactly like a dead wizard's chest. Bosses every tenth floor seal the exits.
- **Everything is physical.** Crates tumble, barrels explode, enemies are
  thrown around; a gravity well yanks everything — wizards included — into a
  pile before it pops. Force-blast the floor to blast-jump.

## Project layout

```
src/
  core/        config & tuning, seeded RNG, typed event bus
  items/       catalog (data + lore), rarity, stats scaling, loot rolls,
               inventory rules (satchel/stash/death/extraction) — pure + tested
  progression/ entry floor from gear, the extraction rule — pure + tested
  world/
    gen/       floor generator + decor placement — pure, deterministic, tested
    biomes.ts  depth bands: fog, light, grade, decor style, lore
    decor/     instanced dressing (pillars, arches, pools, runes…) + the village
    props/     breakables, torches, rifts, waystone, treasure, death chests
  enemies/     one file per enemy (+ models/, ai/, fx/, bosses/), spawn table,
               registry; useEnemy/useEnemyNet own the host/replica plumbing
  combat/      spells (the weapon system), projectiles, explosions
  net/         protocol, GameServerCore (shared by server + offline), matchmaking,
               session, replication, remote wizards
  physics/     every collision filter in one table
  player/      input, first-person controller, staff viewmodel
  render/      textures/ (procedural painters per biome), models/ (staffs,
               wizards, loot, props), shaders/, post-processing
  fx/          pooled particles + the dynamic light pool
  audio/       procedural WebAudio synth
  state/       game flow store, settings, save persistence
  ui/          design system (theme, pixel art, components), hud/, screens/
  scenes/      village, dungeon floor, canvas composition
server/        Bun WebSocket plumbing around GameServerCore
scripts/e2e/   headless-browser end-to-end checks
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design, the
authority model and how to extend each system.
