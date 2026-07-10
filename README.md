# WebMagic — Dungeon of the Hundred Floors

A first-person spellcaster dungeon crawler for the browser. Wizards descend
through 100 procedurally generated floors for glory, fame, riches — and to
find god at the bottom.

Built with **Bun + Vite + React Three Fiber + drei + Rapier physics**.

![stack](https://img.shields.io/badge/bun-%E2%9C%93-black) ![stack](https://img.shields.io/badge/react--three--fiber-9-blue) ![stack](https://img.shields.io/badge/rapier-physics-orange)

## Quickstart

```sh
bun install
bun run dev:full   # game server + vite → http://localhost:3000 (multiplayer)
bun test           # deterministic logic tests (worldgen, matchmaking, rng)
bun run build      # typecheck + production build
bun run start      # production: serves dist/ + websocket on port 80 (PORT=… to override)
```

`bun dev` alone also works — without the game server the client detects it and
plays offline (the HUD shows ○ offline instead of ◉ online). To run the two
processes in separate terminals: `bun run dev:server` and `bun dev`.

## Controls

| Input | Action |
| --- | --- |
| WASD | Move |
| Mouse | Look |
| Left / Right click | Staff primary / secondary ability |
| Space | Jump (double-jump / hover with the right boots) |
| Shift | Blink-dash (requires Cloak of Blinking) |
| E | Interact (portals, loot, treasure) |
| P (or F3) | FPS / frame-time overlay |
| O (or F4) | Toggle shadows (quality option, off by default) |

The current build id (`b<n> · <sha>`) is always shown in the bottom-right
corner — check it against the latest commit when testing.

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
- **Bosses every 10th floor**: the Warden of the Deep holds the exit room and
  seals the floor's portals until it falls — volleys, rings, charges and
  slams, with guaranteed rich drops.
- **Procedural audio**: every sound (casts, blasts, hits, pickups, portals,
  ambient drones) is synthesized with WebAudio — still zero binary assets.

### Multiplayer

A real Bun WebSocket server (`server/server.ts`) owns matchmaking: entering
floor *N* joins an existing instance of that floor if one has room (max
**4 wizards per floor**); otherwise a fresh instance with a fresh seed is
created — and the next entrant joins *that* one, and so on. Everyone in an
instance generates the identical floor from the shared seed, sees each other
as animated wizards, and sees each other's spellcasts replayed (bolts, blasts
and their physics knockback included).

**What syncs today:** floor layout, player positions/staffs, ability casts,
join/leave. **What doesn't yet:** enemy AI, enemy/prop damage and physics
motion are simulated per-client, so crate positions and enemy health drift
apart between players. Making the server (or a host client) authoritative
over those is the next milestone — see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the plan.

## Project layout

```
src/
  core/      config (tuning), seeded RNG, typed event bus
  items/     item catalog, loot tables, loot-orb pickups
  world/     dungeon generator (pure + tested), props, layout types
  net/       protocol, floor-instance matchmaking, transport, remote wizards
  state/     zustand game store, save persistence
  player/    input, first-person controller, staff viewmodel
  combat/    abilities, projectiles, explosions, enemies, floor bosses
  fx/        pooled particle system + flash lights
  audio/     procedural WebAudio synth (sfx + ambient beds)
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

- Authoritative server (the protocol, matchmaking, state broadcasting and
  remote-wizard rendering are all in place — implement a WebSocket `Transport`)
- Shared floor combat events (`peerCast` replay is specced in the protocol)
- More enemy archetypes, unique boss per depth tier, staff modifiers
