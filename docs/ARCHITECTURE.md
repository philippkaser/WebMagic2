# Architecture

## Three tiers

1. **Pure rules** — no DOM, no three.js, no physics: `core/`, `items/`,
   `progression/`, `world/gen/`, `enemies/spawnTable`, `net/matchmaking`,
   `net/serverCore`. Deterministic, unit-tested with `bun test`, and the same
   code runs in the browser and on the server.
2. **Runtime state** — `state/gameStore.ts` sequences the rules (enter →
   descend → extract / die) and talks to the session; `state/settings.ts` holds
   preferences. Frame-hot data (player position, velocity) lives outside React
   in `game/player-state.ts`; cross-system lookups (what can be hit, what can be
   shoved) in `game/registry.ts`.
3. **Presentation** — R3F components render what tiers 1–2 decide. They
   register into the registries on mount and clean up on unmount.

## The run economy

All of it is pure functions in `items/inventory.ts` and
`progression/progression.ts`, so the whole risk/reward loop is tested:

| Concept | Rule |
| --- | --- |
| Item | `{ uid, defId, level, rarity, runLoot }`; power = level × rarity multiplier |
| Gear level | mean item power over the four slots (an empty slot counts 0) |
| Entry floor | ≈ gear level × `RUN.floorPerGearLevel`, jitter −1…+2 |
| Pick up | fills an empty amulet/cloak slot, else the satchel; flagged `runLoot` |
| Extraction | from the 5th floor of a run (`RUN.floorsToExtract`); clears `runLoot`, unpacks the satchel into the stash |
| Death | every `runLoot` item is lost (it becomes a chest); carried banked items go home; empty staff/boots slots refill from the stash or starter gear |

Saves (`state/persistence.ts`, v2 with a v1 migration) are only written from
safe states — village changes, death, extraction — so closing the tab mid-run
forfeits the run exactly like dying would.

## Multiplayer

### One set of server rules

`net/serverCore.ts` is the whole server: matchmaking, relays, wizard-vs-wizard
hits, pacts, death chests. `server/server.ts` wires it to Bun WebSockets;
`net/transport.ts#LocalTransport` runs the same core in-process with a single
client, so offline play exercises identical rules (you can even find your own
remains). `serverCore.test.ts` drives it with fake clients.

### Encounters

`net/matchmaking.ts#FloorDirectory`:

- Entering floor *N* joins an instance someone is already exploring with
  probability `ENCOUNTER.joinChance` (default 30%), else a fresh instance with
  a fresh seed. Only instances of the same floor number are candidates; at
  most `ENCOUNTER.maxPerInstance` wizards per instance.
- Pact partners are always placed together when there's room.
- The server can override the chance: `WEBMAGIC_JOIN_CHANCE=1` for playtests.

Tension is a UI concern built on this: the presence eye knows *that* and
roughly *how close*, never *where*; name tags resolve only up close.

### Authority model

| What | Authority | How |
| --- | --- | --- |
| Floor layout, decor, spawns, treasure | deterministic | generated from the instance seed |
| Enemies, props, bosses, loot orbs | floor host (oldest member, migrates) | 10 Hz delta-filtered snapshots + discrete events; replicas glide kinematic bodies; attack wind-ups (`EntitySnap.a`) replicate so every client sees the telegraphs |
| Damage to entities | floor host | replicas send `hit` requests (shooter-favored) |
| Damage to wizards by wizards | the shooter | our explosion reaching a remote wizard's proxy sends `pvpHit`; the victim applies it. Pact allies get the shove, never the damage |
| Your own health | you | contact burns, enemy blasts and pvp hits are applied locally |
| Death chests & remains | server | `died` → chest in the instance; `openChest` is first come, first served; unclaimed chests retire to the floor's remains pool (TTL, capped) and are adopted by new instances |
| Pacts | server | mutual offers form a pact; run-scoped (leaving the dungeon breaks it) |

Replayed floor-mate spells are cosmetic on your client (their client decides
damage) but still splash on you visually, via their own collision group
(`PEER_PROJECTILE`). All collision filters live in `physics/groups.ts`.

Late joiners get a `stateSync` from the host (dead entity ids, live
snapshots, orbs, treasure), so they never see a "ghost floor".

### Scaling path

Instances share nothing but the directory, so they shard trivially. The host
role can move into a headless process speaking the same protocol (it is just a
client the server always designates as host). Persistence moves from
localStorage to an account service; `state/persistence.ts` is the one seam.

## Rendering

- **Resolution is the pixelation**: the canvas renders at dpr 0.35 and is
  upscaled with `image-rendering: pixelated` — every light, normal map and post
  pass pays ~1/8th the fragments.
- **Procedural textures** (`render/textures/`): painters write color + height
  (+ optional roughness/emissive) into small canvases; normals come from the
  height field. Each biome has its own surface set with several wall variants,
  each drawn as one instanced mesh.
- **Decor** (`world/gen/decor.ts` → `world/decor/`): deterministic placement on
  its own RNG stream (never perturbs gameplay spawns), ~15 instanced draw calls,
  materials cached per biome, GPU-animated air motes.
- **Models** (`render/models/`, `enemies/models/`): built from primitives with
  shared module-level materials; static parts are merged per material.
- **Lighting — the dynamic light pool** (`fx/DynamicLights.tsx`): exactly 14
  pooled point lights, mounted once, never changing count (no shader
  recompiles). Everything that glows registers a *source*; each frame the pool
  assigns lights to the best-scoring sources near the camera. The only real
  lights outside the pool are the player's staff light and the village moon.
- **Post** (`render/Effects.tsx`): bloom → per-biome split-tone grade → grain →
  vignette. Shadows are an opt-in quality toggle.

## UI

`ui/theme.ts` holds the tokens (also exported as CSS variables); `ui/pixelArt.ts`
draws every icon, frame and backdrop procedurally; `ui/components/` are the
building blocks; `ui/hud/` and `ui/screens/` compose them. The whole UI scales by
integer-ish steps with the window so pixel art stays crisp. Fonts are bundled
from `@fontsource` (Jacquard 12 titles, Tiny5 body, Silkscreen labels).

## Extending

| Want to add | Touch |
| --- | --- |
| Item | `items/catalog.ts` (data + lore line) |
| Spell | `combat/abilities.ts`, reference it from a staff |
| Staff look | `render/models/StaffModel.tsx` |
| Enemy | a file in `enemies/` (use `useEnemy`), a model in `enemies/models/`, its kind in `world/types.ts#EnemyKind`, a row in `enemies/spawnTable.ts`, an entry in `enemies/registry.tsx` |
| Boss | `enemies/bosses/` + `bosses/bossTable.ts` |
| Biome | `world/biomes.ts` + a surface set in `render/textures/surfaces/` |
| Decor kind | placement in `world/gen/decor.ts`, rendering in `world/decor/` |
| Prop | `world/props/` + a model in `render/models/PropModels.tsx` |
| Server rule | `net/serverCore.ts` + a case in `serverCore.test.ts` |
| Tuning | `core/config.ts` (`PLAYER`, `DUNGEON`, `RUN`, `ENCOUNTER`, `floorScale`) |
