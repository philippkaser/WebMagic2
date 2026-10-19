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
bun test           # deterministic logic tests (worldgen, run rules, matchmaking, crafting, the arena…)
bun run build      # typecheck + production build
bun run start      # production: serves dist/ + websocket on port 80 (PORT=… to override)
```

`bun dev` alone also works — without the game server the client detects it and
plays offline (the HUD shows ○ offline instead of ◉ online). To run the two
processes in separate terminals: `bun run dev:server` and `bun dev`.

Testing encounters locally: two browser windows only meet ~12% of the time by
design. Start the server with `ENCOUNTER_CHANCE=1 bun run dev:server` to make
every same-floor entry meet whoever is already there.

Several dev stacks side by side: `PORT=3203 bun server/server.ts` and
`WM_SERVER_PORT=3203 bunx vite --port 3103` (vite's `/ws` proxy follows
`WM_SERVER_PORT`, default 3001). The dev server ignores `.claude/` (agent
worktrees), `backups/`, `server-data*.json` and `e2e-output/`, and seeds its
dependency scan from `index.html` alone, so a worktree coming or going never
reloads a running client.

### On a server

Players connect to the production server, which serves the built client and
the game's websocket from one port (`bun run dev` is the development server:
it only listens on localhost and isn't meant for players). On a Linux box,
one command builds the client and installs the game as a systemd service —
it keeps running after you log out, starts at boot and restarts if it ever
crashes:

```sh
sudo sh scripts/install-service.sh            # port 80 (PORT=8080 … for another)
journalctl -u webmagic -f                     # the live log
```

To update: `git pull && bun install && bun run build && sudo systemctl
restart webmagic` (saves are flushed on every stop). Accounts live in
`server-data.json` beside the repo, with rotating snapshots in `backups/`.
Without systemd, `nohup bun run start > webmagic.log 2>&1 &` also survives a
logout (but not a reboot or a crash).

End-to-end smoke test (headless Chromium, two wizards: a full solo run, then
PvP, a pact, a death, a grave and its plunder — including the server honoring
the plunder — then the camp: chat, a fellowship sworn by its runes and
fellowship chat; then a whole bout in the Proving Ground, from the obelisk's
line through ten yields to Varr's ledger and the walk home):

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
| E | Interact (the rift, loot, graves, carvings, room events, the camp's stalls, cauldron, forge, guild board and obelisk); otherwise use belt slot 2 |
| F | In the deep, near another wizard: offer / accept / break a pact. In the camp: invite the wizard beside you to your fellowship, or accept an invitation |
| Enter | Speak (to whoever shares your room); start the line with `/p ` to speak to your fellowship |
| Q | Use belt slot 1 |
| I (or Tab) | Inventory screen (drag & drop gear/bag/belt/pouch — chest & merchant in the village) |
| C | The codex — every lore carving you've read |
| M | Cast the map — a miniature of the village or the explored floor, laid on the ground a step ahead; floor-mates see it too |
| P (or F3) | FPS / frame-time overlay |
| O (or F4) | Toggle shadows (quality option, off by default) |
| B | Toggle motion blur (on by default) |

In the fork of a rift, turn toward a way (or press A/D) and click, E or Space
to take it; do nothing and the way you face takes you.

Reflections (floor mirrors, on by default) and shadows can also be toggled on
the title screen's left tablet, as can Headphones (on: binaural 3D sound; off:
a plain pan for speakers).

The current build id (`b<n> · <sha>`) is always shown in the bottom-right
corner — check it against the latest commit when testing.

## The game

- **Riftwatch** — home, "the village" in the code — sits above the dungeon:
  an expedition's camp pitched round the rift they found in a mountain
  valley. Tents and lamplight, a palisade, a watchtower over the forest, the
  fire everyone sits round; north, the forest climbs toward snow-capped
  mountains, and a great moon rises between their peaks, its light streaming
  over the valley. The rift is **the Weighing Gate**: it reads the level of
  the gear you wear and casts you to the depth where that weight belongs —
  the depth stone beside it shows the floor. You don't pick a floor — your
  gear does.
- **Items have levels.** Gear rolls at the depth it's found (±1). A staff's
  level scales its spell damage; every other piece adds a health ward. Your
  gear level (the mean over the four slots) decides your entry floor.
- **One rift per floor, and it forks.** Step into it and you hang in the
  void while it tears two ways open ahead of you: down in cyan, home in
  gold. Turn toward one and take it. The way home is there from the first
  floor but stays a thin, cracked, sealed slit until your run has played
  five — **the Tithe of Five** — and from then on, taking it banks
  everything you carry.
- **Death loses the run**: anything found since entering is gone — unless
  other wizards stood witness. Die on a shared floor and your loot stays
  behind in a **grave chest** that anyone may plunder.
- **Other wizards** are rare and never announced by name. Entering a floor
  sometimes (and more often the longer you've walked alone) puts you in the
  same instance as another wizard on that same floor. You only know someone
  is there; your heart starts pounding when a stranger comes close. Fight
  them — their loot is a grave away — or swear a **pact** (F) and play
  together; pacts can be broken, and the floor remembers oathbreakers. A
  pact that holds becomes a fellowship.
- **The camp is shared.** Everyone who's home stands in the same camp, up
  to twelve to a fire: speak (Enter) and your words hang over your head;
  swear a **fellowship** at the guild board (six runes to share, four
  wizards at most) or with F beside a friend. A fellowship goes down
  together — the same floor, the same world, floor after floor — and its
  members are never each other's enemies in the deep.
- **Rooms that hold something.** Most floors keep one room apart: a
  **vault** whose guardians wake when you walk in and whose lid unseals when
  the last of them falls; a **ward circle** to kindle and hold for 35
  seconds while the deep sends waves at it (leave it empty and it drains,
  then breaks); a **shrine** offering each wizard a bargain — a strong
  blessing with a price; a **fountain** that mends each wizard once.
- **Crafting, kept simple.** The deep sheds seven materials: one reagent
  per depth band (Grave Moss in the Catacombs, Brine Pearls in the Drowned
  Halls…), rare **riftglass**, and the Warden's Sigil. Old Wenna's cauldron
  brews every draught on Grave Moss and at most one other reagent.
  Brannoc's forge tempers gear a level deeper (never past where you've
  walked), enhances it to +5, imbues or reforges its enchantments, salvages
  it, or — from three Sigils — forges a legendary. Every piece of gear
  hungers for one reagent of its own, named on its plaque, and that's the
  only one the forge works it with.
- **The Proving Ground.** North of the gate, Ysolde Varr's obelisk keeps a
  line for duels. Two to six wizards are dealt into the Founders' old trial
  hall — four-fold symmetric, so no stone is better than another — and
  fight to the yield once Varr has counted it in: first to ten, or the most
  when three minutes run out.
  In the hall nobody dies; you yield, rise at the stone farthest from every
  foe a breath later, and lose nothing. Your fellowship is fair game too.
  Varr keeps every bout in her ledger.
- **The feel.** Your magic lands with weight: ticks and a climbing "tk" on
  the crosshair, a red X and a chime on the kill, a few frozen frames for a
  heavy blow, numbers popping off the creature, rune words for a streak.
  Creatures flinch, crack and leak as their life runs out — the last third
  of any bar holds half the life — and fight harder at death's door. Near
  your own death the world goes muffled and grey but for its reds, a heart
  pounds in your head, and a killing blow taken from half health or more
  leaves you on one — the Brink — with a moment to get away.
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
  jump (double jump, hover). A 5-slot bag, an 8-slot reagent pouch and a
  Q/E consumable belt carry the rest; your 30-slot chest in the village
  stores what's banked.
- **Gold & the merchant**: coins drop in the dungeon (auto-pickup) and are
  run loot like everything else. Maro's stall in the village sells potions
  and the Feather of Safe Passage — a one-shot "leave from any floor, keep
  your loot" escape, even before the tithe is paid — and the Orb of
  Fortune, a gamble on gear whose price climbs with the deepest floor
  you've walked home from.
- **Everything is physical**: crates, barrels and pots tumble, shatter and
  explode; enemies get knocked around; force-blast at your feet to blast-jump.
- **Bosses every 10th floor**: the Warden of the Deep seals the floor's
  rift until it falls.
- **Procedural everything**: painted pixel-art textures, normal maps, models
  and every sound are generated at runtime — no binary assets beyond the
  four pixel fonts.
- **Raytraced sound**: rays bounce round the room around you a few times a
  second and its reverb is generated to match — a hall rings for about a
  second, a corridor answers short, the village green is nearly dry under
  the sky — and each room rings on its own, so a hall you walk out of
  keeps ringing behind you through the doorway. Every sound is placed
  where it is, and reaches you as sound does: each ear hears it at its own
  moment and through the head's shadow (binaural — best on headphones; a
  title-screen toggle switches to speakers), a far blast lands after its
  flash, things moving past bend in pitch, the air dulls what's far, and a
  rift or a blast you're inside of is all round you rather than a point.
  A monster round a corner is heard muffled from the doorway it's coming
  through, more clearly through a wide arch than a crack, and torches,
  rifts, footsteps — yours, under each foot, your floor-mates', the
  monsters' — and the dungeon's own drips, groans and chimes all sound
  where they are.
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
and saves. Play as a **guest** (your wizard lives in this browser) or write
it into **the Wizard's Ledger** on the title screen — a username and a
password, and your wizard follows you to any browser; a guest can claim its
wizard at any time and keep everything. Saves live server-side in
`DATA_FILE`, written atomically, with rotating snapshots in `backups/`
beside it. Instances hold up to 4 wizards on the same floor, but the
matchmaker keeps them apart most of the time (the encounter "tension clock").
Everyone in an instance generates the identical floor from the shared seed.

The server seats every wizard in one of three kinds of room: a **floor
instance**, a **camp** (everyone who's home, twelve to a camp — no dice),
or a **bout** in the Proving Ground. Chat is cleaned, capped at 140
characters and rate-limited server-side; fellowship lines reach the
fellowship wherever its members are. **Fellowships** (up to four, joined by
a six-rune code or an invitation) skip the encounter roll: a member always
lands in a companion's instance when it has room, and a fresh run starts on
a companion's floor if the Weighing allows that deep. The **Proving
Ground** is the server's too: it keeps the obelisk's line, starts a bout
once two are ready and an eight-second gathering breath has passed (at once
if six are), runs its clock and scoreboard, and writes the result into each
wizard's account. Crafting is server-side as well: the cauldron and forge
run the shared recipes on the banked inventory with the server's dice.

Shared floors are truly shared: each instance has a **simulation host**
whose enemies, props, boss, loot, graves and room events are authoritative.
Replicas predict and reconcile. Your own health is always decided locally —
which is also how wizard-vs-wizard damage works: a stranger's spell hurts
you on your own machine, and the last wizard who hurt you takes the kill
credit (in the Proving Ground, the yield). See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design.

## Project layout

```
src/
  core/        tuning (config), seeded RNG, typed event bus, the presentation clock
  run/         run rules: the Weighing, the Tithe of Five, death/bank outcomes (pure)
  items/       catalog, item levels & power, affixes, loot tables, economy,
               inventory, materials & crafting (the cauldron and the forge)
  world/       gen/ (staged, pure floor generator), biomes, omens, lore, props, traps
  roomEvents/  vaults, ward circles, shrines, fountains: catalog, pure rules, net, views
  enemies/     roster (data), shared shell, pure brains/, one file per kind in
               kinds/, the living body (puppet, wounds, wind-ups), corpses/
  weapons/     spell catalog (data), cast kinds, projectiles, explosions,
               allegiance, precision hits
  combat/      the shooter's feel: hit confirms, damage numbers, hitstop, streaks
  encounters/  pacts, presence sense, kill credit, grave chests
  social/      chat, fellowships, the camp seat (client state)
  arena/       the Proving Ground: rules, the hall's generator, the yield, the bout
  net/         protocol, matchmaking, fellowships, the obelisk's queue,
               transport, session, replication, remote wizards
  state/       game store, codex, save persistence
  player/      input, first-person controller, staff viewmodel
  fx/          shader particles + named effects, ambient air, torch flames,
               the dynamic light pool
  audio/       procedural WebAudio synth; raytraced acoustics (room reverb,
               sound paths round corners, muffling), a pool of placed
               voices, the world's own voices
  render/      textures/ (procedural painters), models/, post-processing
  scenes/      village, dungeon floor, floor atmosphere, canvas composition
  transition/  portal journeys (pulled through the rift, the starry warp, the
               fork, arrival)
  ui3d/        in-world UI: pixel font, rune text, tablets, item models; the
               HUD, menus, inventory, guild board and Varr's tablet as layers
  ui/          DOM leftovers: perf overlay, build stamp, dev room
  game/        cross-system seams: registries, hostility, floor rules, damage
               sources, vitality (the knee, last stand, the Brink), the heart
server/        Bun WebSocket server: relay (floors, the camp, bouts), accounts,
               provenance & crafting, the ledger
```

Design rules that keep it future-proof:

- **Pure core, thin shell** — generation, run rules, matchmaking, pacts, grave
  rules, enemy brains, spell data and item power are pure modules with unit
  tests; React/three/Rapier components only wire them to the world.
- **Game code talks to a `Transport` interface**, never to a socket; the
  server is blind to the floor's world (it knows the bank, the social rooms
  and the Proving Ground's score) and never changes for a new networked
  feature on a floor.
- **Data-driven content** — a new staff is a catalog entry, a new spell a row
  in `weapons/spellCatalog.ts`, a new omen/biome/lore fragment/room event/
  brew a row in its table.
- **Performance by construction** — one-mesh stonework, greedy-merged
  colliders, one draw call for all particles, pooled projectiles/lights,
  the world rendered at 1/3 resolution (the UI canvas above it at full).

## Roadmap

- Headless server-side floor hosts (full authority; closes the host-trust
  gap, and the Proving Ground's self-reported falls with it)
- A unique boss per biome
- More omens, carvings, room events and enemy archetypes; biome-specific
  hazards
- More of the Proving Ground: hall plans beyond the three, a ladder from
  Varr's ledger
