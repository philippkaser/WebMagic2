# WebMagic — Dungeon of the Hundred Floors

A first-person spellcaster dungeon crawler for the browser. Wizards descend
through 100 procedurally generated floors for glory, fame, riches — and to
find god at the bottom. Now and then, down there, they find each other.

Built with **Bun + Vite + React Three Fiber + drei + Rapier physics**.

![stack](https://img.shields.io/badge/bun-%E2%9C%93-black) ![stack](https://img.shields.io/badge/react--three--fiber-9-blue) ![stack](https://img.shields.io/badge/rapier-physics-orange)

> **New here? Read [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) first** — the
> full vision: the idea, art style, gameplay feel, world/lore, future content,
> and the technical philosophy. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
> has the deep implementation detail.

## Quickstart

```sh
bun install
bun run dev:full   # game server + vite → http://localhost:3000 (multiplayer)
bun test           # deterministic logic tests (worldgen, run rules, matchmaking, pacts…)
bun run build      # typecheck + production build
bun run start      # production: serves dist/ + websocket on port 80 (PORT=… to override)
```

`bun dev` alone also works — without the game server the client detects it and
plays offline (the HUD shows ○ offline instead of ◉ online). To run the two
processes in separate terminals: `bun run dev:server` and `bun dev`.

Testing encounters locally: two browser windows only meet ~12% of the time by
design. Start the server with `ENCOUNTER_CHANCE=1 bun run dev:server` to make
every same-floor entry meet whoever is already there.

End-to-end smoke test (headless Chromium, two wizards: a full solo run, then
PvP, a pact, a death, a grave and its plunder — including the server honoring
the plunder):

```sh
DATA_FILE=/tmp/wm-e2e.json ENCOUNTER_CHANCE=1 bun server/server.ts &
bunx vite --port 3000 &
DATA_FILE=/tmp/wm-e2e.json bun run e2e   # CHROMIUM_PATH=… to pick a browser
```

The audio lab renders scripted scenes (a walk out of a torch-lit hall, bare
impulses for measuring the acoustics) through the real audio code to WAV
files in `audio-lab-output/`, offline in headless Chromium:

```sh
bunx vite --port 3000 &
bun run audio-lab            # or name scenes: bun run audio-lab walk imp-room
```

## Controls

| Input | Action |
| --- | --- |
| WASD | Move |
| Mouse | Look |
| Left / Right click | Staff primary / secondary ability |
| Space | Jump (double-jump / hover with the right boots) |
| Shift | Blink-dash (requires Cloak of Blinking) |
| E | Interact (portals, loot, graves, lore carvings); otherwise use belt slot 2 |
| F | Near another wizard: offer / accept / break a pact |
| Q | Use belt slot 1 |
| I (or Tab) | Inventory screen (drag & drop gear/bag/belt — chest & merchant in the village) |
| C | The codex — every lore carving you've read |
| M | Cast the map — a miniature of the village or the explored floor, laid on the ground a step ahead; floor-mates see it too |
| P (or F3) | FPS / frame-time overlay |
| O (or F4) | Toggle shadows (quality option, off by default) |

Reflections (floor mirrors, on by default) and shadows can also be toggled on
the title screen's left tablet.

The current build id (`b<n> · <sha>`) is always shown in the bottom-right
corner — check it against the latest commit when testing.

## The game

- **The village** sits above the dungeon. Its portal is **the Weighing Gate**:
  it reads the level of the gear you wear and casts you to the depth where that
  weight belongs. You don't pick a floor — your gear does.
- **Items have levels.** Gear rolls at the depth it's found (±1). A staff's
  level scales its spell damage; every other piece adds a health ward. Your
  gear level (the mean over the four slots) decides your entry floor.
- **The Tithe of Five**: every floor has a golden way-home portal beside its
  exit, but it stays sealed until your run has played five floors. From then
  on, any floor's way home banks everything you carry.
- **Death loses the run**: anything found since entering is gone — unless
  other wizards stood witness. Die on a shared floor and your loot stays
  behind in a **grave chest** that anyone may plunder.
- **Other wizards** are rare and never announced by name. Entering a floor
  sometimes (and more often the longer you've walked alone) puts you in the
  same instance as another wizard on that same floor. You only know someone
  is there; your heart starts pounding when a stranger comes close. Fight
  them — their loot is a grave away — or swear a **pact** (F) and play
  together; pacts can be broken, and the floor remembers oathbreakers.
- **Depth biomes**: the Catacombs, the Drowned Halls, the Ember Forge, the
  Crystal Deep and the Hollow — each with its own look, light, drone and
  monster mix; every floor turns its band's colours a little, and the hue
  drifts from room to room.
- **Omens**: some floors are in a mood — the Weightless Hour (low gravity),
  the Lightless Vigil, the Crimson Omen, the Mana Tide, the Tinderbox, the
  Teeming. They're rolled from the floor seed, so everyone there shares them;
  the top-right corner names the floor, its biome and its omen, and spells
  out what the omen changes when you arrive (and whenever a map is cast).
- **Lore** is carved into the walls: walk up to a faint violet carving, press
  E, and it joins your codex. Deeper carvings know deeper things.
- **Loot** defines your kit: the staff sets both click abilities, amulets add
  passives, cloaks add defense/utility (including the dash), boots change your
  jump (double jump, hover). A 5-slot bag and a Q/E consumable belt carry the
  rest; your 30-slot chest in the village stores what's banked.
- **Gold & the merchant**: coins drop in the dungeon (auto-pickup) and are
  run loot like everything else. Maro's stall in the village sells potions
  and the Feather of Safe Passage — a one-shot "leave from any floor, keep
  your loot" escape, even before the tithe is paid.
- **Everything is physical**: crates, barrels and pots tumble, shatter and
  explode; enemies get knocked around; force-blast at your feet to blast-jump.
- **Bosses every 10th floor**: the Warden of the Deep seals the floor's
  portals until it falls.
- **Procedural everything**: painted pixel-art textures, normal maps, models
  and every sound are generated at runtime — no binary assets beyond the
  four pixel fonts.
- **Raytraced sound**: rays bounce round the room around you a few times a
  second and its reverb is generated to match — a hall rings for about a
  second, a corridor answers short, the village green is nearly dry under
  the sky. Every sound is placed where it is: a monster round a corner is
  heard muffled from the doorway it's coming through, more clearly through
  a wide arch than a crack, and torches, rifts, footsteps — yours, your
  floor-mates', the monsters' — and the dungeon's own drips, groans and
  chimes all sound where they are.
- **The UI lives in the world**: menus are tablets built from worn stones,
  messages burn into small slabs of slate as runes that settle into
  letters, the map (M) is a miniature of the village or the explored floor
  laid in light on the ground ahead of you (walk around it — your
  floor-mates can too), health and mana are glass orbs that slosh as you move,
  items are small 3D objects. Portals are rifts torn in the air, and stepping through one is
  a journey — sucked in, through a void of blocky stars, spat out onto the
  new floor.

### Multiplayer

A real Bun WebSocket server (`server/server.ts`) owns matchmaking, identity
and saves. Instances hold up to 4 wizards on the same floor, but the
matchmaker keeps them apart most of the time (the encounter "tension clock").
Everyone in an instance generates the identical floor from the shared seed.

Shared floors are truly shared: each instance has a **simulation host**
whose enemies, props, boss, loot and graves are authoritative. Replicas
predict and reconcile. Your own health is always decided locally — which is
also how wizard-vs-wizard damage works: a stranger's spell hurts you on your
own machine, and the last wizard who hurt you takes the kill credit. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design.

## Project layout

```
src/
  core/        tuning (config), seeded RNG, typed event bus
  run/         run rules: the Weighing, the Tithe of Five, death/bank outcomes (pure)
  items/       catalog, item levels & power, affixes, loot tables, economy, inventory
  world/       gen/ (staged, pure floor generator), biomes, omens, lore, props, traps
  enemies/     roster (data), shared shell, pure brains/, one file per kind in kinds/
  weapons/     spell catalog (data), cast kinds, projectiles, explosions, allegiance
  encounters/  pacts, presence sense, kill credit, grave chests
  net/         protocol, matchmaking, transport, session, replication, remote wizards
  state/       game store, codex, save persistence
  player/      input, first-person controller, staff viewmodel
  fx/          shader particles + named effects, ambient air, torch flames,
               the dynamic light pool
  audio/       procedural WebAudio synth; raytraced acoustics (room reverb,
               sound paths round corners, muffling), a pool of placed
               voices, the world's own voices
  render/      textures/ (procedural painters), models/, post-processing
  scenes/      village, dungeon floor, floor atmosphere, canvas composition
  transition/  portal journeys (pulled through the rift, the starry warp, arrival)
  ui3d/        in-world UI: pixel font, rune text, tablets, item models; the
               HUD, menus and inventory as layers
  ui/          DOM leftovers: perf overlay, build stamp, dev room
  game/        cross-system seams: registries, hostility, floor rules, damage sources
server/        Bun WebSocket server: relay, accounts & provenance
```

Design rules that keep it future-proof:

- **Pure core, thin shell** — generation, run rules, matchmaking, pacts, grave
  rules, enemy brains, spell data and item power are pure modules with unit
  tests; React/three/Rapier components only wire them to the world.
- **Game code talks to a `Transport` interface**, never to a socket; the
  server is gameplay-blind and never changes for new gameplay messages.
- **Data-driven content** — a new staff is a catalog entry, a new spell a row
  in `weapons/spellCatalog.ts`, a new omen/biome/lore fragment a row in its
  table.
- **Performance by construction** — one-mesh stonework, greedy-merged
  colliders, one draw call for all particles, pooled projectiles/lights,
  the world rendered at 1/3 resolution (the UI canvas above it at full).

## Roadmap

- Headless server-side floor hosts (full authority; closes the host-trust gap)
- A unique boss per biome
- More omens, carvings and enemy archetypes; biome-specific hazards
