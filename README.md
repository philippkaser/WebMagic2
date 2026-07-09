# WebMagic — Dungeon of the Hundred Floors

A first-person spellcaster dungeon crawler for the browser. Wizards descend
through 100 procedurally generated floors for glory, fame, riches — and to
find god at the bottom.

Built with **Bun + Vite + React Three Fiber + drei + Rapier physics**.

![stack](https://img.shields.io/badge/bun-%E2%9C%93-black) ![stack](https://img.shields.io/badge/react--three--fiber-9-blue) ![stack](https://img.shields.io/badge/rapier-physics-orange)

## Quickstart

```sh
bun install
bun dev          # http://localhost:3000
bun test         # deterministic logic tests (worldgen, matchmaking, rng)
bun run build    # typecheck + production build
```

## Controls

| Input | Action |
| --- | --- |
| WASD | Move |
| Mouse | Look |
| Left / Right click | Staff primary / secondary ability |
| Space | Jump (double-jump / hover with the right boots) |
| Shift | Blink-dash (requires Cloak of Blinking) |
| E | Interact (portals, loot, treasure) |

## The game

- **The village** sits above the dungeon. Step through the portal to descend.
- **Floors are seeded**: every floor is generated from an instance seed, so
  everyone sharing a floor instance sees the identical world.
- **Leave only at checkpoints** (floors 5, 10, 15, …) via the golden portal —
  leaving banks your loot and unlocks that floor as a future entry point.
- **Death loses the run**: anything you picked up since entering is gone.
- **Loot** defines your kit: the staff sets both click abilities, amulets add
  passives, cloaks add defense/utility (including the dash), boots change your
  jump (double jump, hover).
- **Everything is physical**: crates, barrels and pots tumble, shatter and
  explode; enemies get knocked around; force-blast at your feet to blast-jump.

### Multiplayer model (shipped as testable logic + local loopback)

Entering floor *N* joins an existing instance of that floor if one has room
(max **4 wizards per floor**); otherwise a fresh instance with a fresh seed is
created — and the next entrant joins *that* one, and so on. This exact logic
(`src/net/matchmaking.ts`) runs today inside the single-player loopback
transport and is designed to move server-side unchanged. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full online scaling plan.

## Project layout

```
src/
  core/      config (tuning), seeded RNG, typed event bus
  items/     item catalog, loot tables, loot-orb pickups
  world/     dungeon generator (pure + tested), props, layout types
  net/       protocol, floor-instance matchmaking, transport abstraction
  state/     zustand game store, save persistence
  player/    input, first-person controller, staff viewmodel
  combat/    abilities, projectiles, explosions, enemies
  fx/        pooled particle system + flash lights
  render/    procedural pixel textures (+normal maps), post-processing
  scenes/    village, dungeon floor, canvas composition
  ui/        HUD and overlays
  game/      cross-system registries (hittables, interactions, player state)
```

Design rules that keep it future-proof:

- **World gen is pure and deterministic** — no rendering, no physics imports,
  fully unit-tested (connectivity, checkpoints, collider coverage).
- **Game code talks to a `Transport` interface**, never to a socket — swap
  `LocalTransport` for a WebSocket transport to go online.
- **Data-driven items/abilities** — a new staff, amulet or boot is a catalog
  entry; a new spell is one entry in `combat/abilities.ts`.
- **Performance by construction** — instanced wall rendering, greedy-merged
  physics colliders, pooled particles/projectiles, one shadow-casting light.

## Roadmap

- Authoritative server (the protocol and matchmaking are ready for it)
- Remote wizard rendering + shared floor events (`peerCast` is specced)
- Audio (procedural WebAudio to keep the zero-asset pipeline)
- More enemy archetypes, bosses every 10 floors, staff modifiers
