# WebMagic — Game Design & Vision

> The one document to read first. It captures the *why* behind the game —
> the fantasy, the feel, the world, and the technical philosophy — so anyone
> (a new contributor, a future AI session, or you six months from now) can
> reconstruct the full intent without reverse-engineering the code.
>
> For deep implementation detail see [ARCHITECTURE.md](ARCHITECTURE.md).
> For the quickstart and controls see the [README](../README.md).

---

## 1. The core idea

**WebMagic is a first-person wizard dungeon crawler for the browser, built
around fluid spellcasting combat, a physics-sandbox world, and drop-in shared
floors.** It is a "wizard shooter": you aim and fire like an FPS, but your
gun is a staff and your bullets are spells.

You are a wizard from a small village that sits atop a hundred-floor dungeon.
For **glory, fame, riches — and to reach the bottom and find god** — wizards
step through the village portal and descend. Every floor is deeper, darker,
and harder than the last.

The emotional loop we are chasing:

- **Greed vs. fear.** Every floor you descend makes you richer and stronger,
  but **death in the dungeon takes everything you gathered on that run.** You
  can only bank your loot and exit at checkpoint floors (every 5th). The
  question "one more floor, or turn back?" should be a genuine, tense choice.
- **Mastery of movement and aim.** Combat rewards positioning, timing, and
  clever use of physics — not just clicking. A skilled wizard flows through a
  room; a clumsy one gets cornered.
- **Serendipitous multiplayer.** You might round a corner on floor 3 and find
  another real wizard already fighting there. No lobby, no matchmaking menu —
  the world just quietly has other people in it.

### Design pillars (use these to settle arguments)

1. **The floor is a sandbox.** Everything reacts. If a player thinks "can I
   shoot that / shove that / blow that up / ride that," the answer should
   lean toward yes.
2. **Movement is a toy.** Getting around should be fun *before* any combat is
   involved. Blast-jumping, dashing, hovering.
3. **Minute-to-minute over meta.** The second-to-second act of casting,
   dodging, and repositioning must feel great on its own. Progression is the
   seasoning, not the meal.
4. **Readable chaos.** The screen can be busy with particles and light, but
   the player must always parse threats. Gritty, not muddy.
5. **Zero-friction multiplayer.** Shared play should feel like it "just
   happens." No feature should require other players to be enjoyed, but every
   feature should be *better* with them.

---

## 2. Art style & audio

### Visual identity: "gritty pixel-magic"

- **Chunky pixelated look** with **real lighting on top.** The signature move
  is that the pixels still *catch light* — every surface has a procedurally
  generated **normal map** (derived from a height field via a Sobel filter),
  so torchlight and spell-flashes ripple across the coarse texels. This is the
  thing that makes it look intentional rather than just low-res.
- **Fancy, moody lighting.** Near-black dungeons lit by warm flickering
  torches, glowing emissive magic, and the player's own staff-light. Fog for
  depth. A heavy vignette. Reflections on wet floor slabs and metal trim via a
  tiny procedural environment map.
- **Particles everywhere.** Explosions, sparks, embers rising from torches,
  loot shimmer, dash trails, muzzle flashes.
- **Post-processing chain:** bloom (feeds the emissive magic) → film grain →
  vignette. The pixelation itself is *free*: the canvas renders at ~1/3
  resolution and the browser upscales it with `image-rendering: pixelated`.

### Hard constraint: **zero binary assets**

Everything — textures, normal maps, all sound — is **synthesized at runtime.**
No image files, no audio files, no model files. This keeps the whole game a
tiny, fast-loading bundle and makes it trivially themeable in code. Any new
art is a new procedural painter function, not an asset pipeline.

- Textures: painted onto 64×64 canvases (stone brick, worn slabs, planks,
  ceramic, barrel staves, dirt), each with a matching normal map.
- Models: primitive geometry (boxes, cones, octahedra, icosahedra) with
  emissive materials. Enemies and wizards are readable silhouettes, not
  detailed meshes — which suits the pixel aesthetic.
- Audio: procedural WebAudio synthesis — spell casts, explosions (sized by
  blast radius), hits, hurt, pickups, jumps, dashes, portal shimmer, a boss
  roar, and looping ambient drone/wind beds per scene.

### Why this style

It's cohesive, cheap to produce (an AI or a solo dev can extend it endlessly),
performant, and distinctive. The "pixels that catch fancy light" combination
is rare and reads as a deliberate aesthetic rather than a limitation.

---

## 3. Gameplay

### Moment-to-moment

First-person. Mouse aims, WASD moves, **left click = your staff's primary
ability, right click = secondary.** Holding a button keeps casting on
cooldown; combat is about *aim, mana budgeting, and repositioning*, not click
spam. Spells cost mana, which regenerates, so there's a rhythm of spend and
recover.

### Movement (the feel spec)

The controller is deliberately quake-like and lives in `PlayerController.tsx`,
tuned via `core/config.ts`:

- Exponential ground acceleration; **additive air control under a soft speed
  cap** — meaning momentum from dashes and blasts is *preserved* (movement
  tech survives), but you can't accelerate past the cap in the air by strafing
  alone.
- **Coyote time** (~0.12s) and **jump buffering** (~0.14s) so jumps feel
  forgiving and responsive.
- **Blast-jumping:** firing a Force Blast at your own feet launches you. This
  is intended tech, not an exploit — the caster takes reduced self-knockback.
- Juice: view bob scaled to speed, landing dip, trauma-based camera shake,
  staff viewmodel sway + recoil kick, dust puffs on jump/land.

### The physics sandbox

Every dungeon floor doubles as a physics playground. Crates, barrels, and pots
are real dynamic rigid bodies (Rapier) that tumble when shoved, shatter under
fire, and sometimes hide loot. **Barrels explode**, chain-reacting into nearby
props and enemies. All explosions apply a **radial impulse** to everything
in range — enemies, props, and the player — which is the heart of the sandbox
feel. The village even starts you with a few crates to kick around.

### Loot & builds

Your kit is defined entirely by four equipment slots (data-driven in
`items/catalog.ts`):

| Slot | Role | Examples |
| --- | --- | --- |
| **Staff** | Defines both click abilities | Apprentice (Bolt / Force Blast), Ember (scatter), Arc (rapid + shockwave), Void (heavy lance) |
| **Amulet** | Passive stats | +max health, +mana regen, +move speed, +spell damage |
| **Cloak** | Defense / utility | -damage taken, -enemy aggro range, **blink-dash** (Shift) |
| **Boots** | Changes your jump | single → **double jump** → **hover** (hold Space to feather-fall) |

You start with only a **basic staff** and worn boots. Everything else is found
in the dungeon: a guaranteed treasure pedestal per floor (rolled
deterministically from the floor seed, so co-op players see the same reward),
plus random drops from enemies and props.

### The run structure & the central risk

- **100 floors**, each harder (`floorScale` ramps enemy health, damage, and
  count with depth).
- **You can only leave the dungeon at checkpoint floors — every 5th (5, 10,
  15, …).** A checkpoint floor has a golden portal that banks your loot and
  returns you to the village. Banked checkpoints become new **entry points**:
  next run you can start from your deepest banked checkpoint instead of floor 1.
- **Death is the whole tension.** If you die in the dungeon, **all loot
  gathered during that run is lost** — you respawn in the village with only
  what you had banked. (Implementation: items carry a `runLoot` flag;
  banking clears it, death strips everything still flagged.)
- **Bosses every 10th floor.** The **Warden of the Deep** holds the exit room
  and **seals both portals until it dies.** It has four attack patterns (aimed
  volley, projectile ring, charge, telegraphed slam shockwave), an enrage
  phase below half health, heavy knockback resistance, and guaranteed rich
  drops for the whole party.

### The signature multiplayer mechanic

Entering floor *N* drops you into a **shared instance** of that floor if one
has room (**max 4 wizards per floor**). Walk down from floor 1 → the floors
you pass through are freshly generated for you, but when you reach a floor
where others are already playing, **you join their instance** and see the same
world. If every instance of that floor is full, a brand-new instance with a
fresh seed is created — which the *next* wizard can then join, and so on. This
is the "you might just run into someone" fantasy, implemented as pure
matchmaking logic (`net/matchmaking.ts`).

### Gameplay feel checklist (what "good" means here)

- Can I cross a room in a way that feels cool, even with no enemies? ✔ dash,
  double-jump, hover, blast-jump.
- Does hitting an enemy feel impactful? ✔ hit flash, knockback, hit sound,
  particle spray.
- Does the room react to me? ✔ props shove/shatter/explode, physics ragdolls.
- Is the screen alive? ✔ torch flicker, drifting embers, ambient drone.
- Do I feel the risk of going deeper? ✔ visible run-loot markers in the HUD,
  the death screen listing what the dungeon kept.

---

## 4. Lore & the world

### The fiction

The world is one vertical place: a **village of wizards perched above a
hundred-floor dungeon that bores down into the earth.** The village is the
safe hub — quiet, night-time, a few huts with warm windows, a central portal
ringed with torches. Through the portal is the descent.

Wizards go down for the classic reasons — **glory, fame, and riches** — but
the deepest myth, the thing that drives the boldest, is that **god waits at
the bottom of the hundredth floor.** Nobody has proven it. Everybody who's
tried is dead or turned back at a checkpoint.

The dungeon is not neutral: it *keeps* what the dead were carrying. That's the
in-fiction justification for the roguelike loot-loss — the dungeon is greedy,
and every checkpoint is a moment of "the dungeon lets you leave, this once,
with what you've earned."

### Tone

Gritty, a little grim, but not humorless. Wizards are treasure-hunters and
glory-seekers, not solemn chosen ones. The village is cozy; the dungeon is
oppressive. The contrast between the two is the mood.

### Lore hooks left open (for future writers)

- Who built the dungeon, and why does it hunger?
- What actually is at floor 100 — a literal god, a lie, a mirror?
- The enemies are "hostile magic" (wisps, warding sentries, the Warden). Are
  they the dungeon's immune system? Failed wizards? This is unwritten.
- Checkpoints as a "mercy" — whose mercy?

None of this is on rails yet. The mechanics imply a story; the story text is
mostly still to be written.

---

## 5. Future content & direction

This is a wishlist / direction doc, not a commitment. Ordered roughly by how
naturally the current systems support it.

### Enemies (the roster is meant to grow)

Current: **Wisp** (floating chaser, burns on contact) and **Sentry** (fixed
crystal turret, lobs dodgeable fire bolts with line-of-sight), plus the
**Warden of the Deep** boss. Adding an enemy is deliberately cheap — a new
component in `combat/` plus a spawn kind in the generator. Ideas:

- **Charger / brute** — melee rusher that telegraphs and can be sidestepped.
- **Shielder** — must be flanked or blast-knocked to break its guard.
- **Swarm spawner** — a stationary nest that pumps out weak wisps, prioritizing
  target selection.
- **Mirror wraith** — mimics the player's own staff abilities.
- **Depth-tier bosses:** a *unique boss every 10 floors* (floor 20, 30, …)
  rather than reusing the Warden — a boss per biome.

### Biomes

The generator and texture system already support swapping the visual + prop
palette by floor range. Planned: distinct looks and hazards per 10–20 floor
band (e.g. flooded catacombs, ember forge, void-touched depths), each with its
own boss, enemy mix, and environmental gimmick.

### Items & builds

- More staffs = more playstyles (channeled beams, lobbed grenades, melee
  staves, summons). Each is one catalog entry + optionally one ability entry.
- Item **rarities / modifiers** (rolled affixes) for build depth.
- Set bonuses across slots.
- Consumables / one-shot scrolls.

### Systems

- **Reconnect handling.** If the server restarts or a client drops mid-run,
  rejoin the same instance and resync rather than falling back to offline.
- **Social layer.** Lightweight in-world ping/emote and/or floor chat, so
  strangers can coordinate without voice.
- **Persistent meta.** Village upgrades, a bank/stash, cosmetic unlocks,
  wizard identity beyond a name.
- **Trading / gifting** loot between floor-mates.
- **Full server authority** (see tech section) as the game scales.

### Audio

Expand the procedural synth: per-staff cast timbres, enemy audio cues, richer
ambient beds per biome, musical stingers on boss phases.

---

## 6. Technology

### Stack

- **Runtime/build:** [Bun](https://bun.sh) + [Vite](https://vitejs.dev).
- **Rendering:** [React Three Fiber](https://r3f.docs.pmnd.rs) (React
  bindings for three.js) + [drei](https://github.com/pmndrs/drei) helpers +
  [@react-three/postprocessing](https://github.com/pmndrs/postprocessing).
- **Physics:** [Rapier](https://rapier.rs) via `@react-three/rapier`.
- **State:** [zustand](https://github.com/pmndrs/zustand) stores.
- **Server:** a small **Bun WebSocket** process that also serves the static
  build in production.
- **Language:** TypeScript throughout, including the server. Tests via
  `bun test`.

### The tech idea (the philosophy)

The whole codebase is organized around a few deliberate bets:

1. **Pure, deterministic world generation.** A floor is generated entirely
   from `(instanceSeed, floorNumber)` with a seedable RNG (mulberry32). No
   rendering or physics imports in the generator; it's plain, unit-tested
   logic. **This is the keystone of cheap multiplayer:** the server only ever
   ships a *seed* (a few bytes), and every client reconstructs byte-identical
   geometry, props, enemies, and treasure locally. Floor payload size is
   constant no matter how large or detailed floors get.

2. **Three strict tiers.** (a) *Pure logic* — no DOM/three/physics, testable,
   server-safe (`core/`, `world/dungeonGen`, `net/matchmaking`, `items/`).
   (b) *Runtime state* — zustand stores + frame-hot data kept outside React
   (`game/player-state`, registries). (c) *Presentation* — R3F components that
   render whatever the lower tiers decide and register themselves into shared
   registries. Rendering never drives game truth.

3. **Talk to a `Transport` interface, never a socket.** All networking goes
   through an abstraction with two implementations: a real `WebSocketTransport`
   and an in-process `LocalTransport` loopback. **Single-player is literally
   the online game with a one-player server** — the same protocol, the same
   matchmaking, the same code paths. The client prefers the WebSocket server
   and falls back to offline seamlessly.

4. **Data-driven content.** Items, abilities, enemies, and props are catalog
   entries and small components, not bespoke code. Adding content is adding
   data, not rewiring systems.

5. **Performance by construction, not by profiling later.** Instanced wall
   rendering; **greedy-merged physics colliders** (many wall tiles → few box
   colliders); pooled particles (one instanced draw call), pooled projectiles,
   and a **fixed dynamic light pool** (14 point lights reassigned each frame to
   the most important nearby sources, so the light *count* never changes and
   shaders never recompile mid-combat); render at 1/3 resolution because the
   game is pixelated anyway.

### Tech architecture (systems map)

```
src/
  core/      config (all tuning numbers), seeded RNG, typed event bus
  world/     dungeon generator (pure + tested), props, layout types
  items/     item catalog, loot tables, loot-orb manager
  net/       protocol, matchmaking, transport, session, host-authority
             replication, remote-wizard rendering, reactive net store
  state/     zustand game store, save persistence
  player/    input, first-person controller, staff viewmodel
  combat/    abilities, projectiles, explosions, enemies, boss, combat system
  fx/        pooled particle system, dynamic light pool
  audio/     procedural WebAudio synth (sfx + ambient)
  render/    procedural pixel textures (+normal maps), post-processing
  scenes/    village, dungeon floor, canvas composition
  ui/        HUD and overlays
  game/      cross-system registries (hittables, dynamic bodies, interactions,
             player-state, enemy target selection)
server/      Bun WebSocket game server (relay + matchmaking + static host)
```

**Cross-system glue** avoids React prop-drilling and expensive scene queries:
a `Hittable` registry (everything damageable), a dynamic-body registry
(everything the shockwave can shove), an interaction arbiter (nearest prompt
wins the E key), and a typed event bus (`core/events`). Combat iterates
registries; it never walks the scene graph.

### Multiplayer model: host-authority per instance

This is the most important networking decision, so it's worth stating plainly:

- Each floor instance has a **simulation host** — its first joiner. The host's
  simulation of **enemies, props, the boss, and loot** is the authoritative
  truth. Everyone else runs **replicas**: kinematic bodies gliding toward the
  host's ~10 Hz snapshots, replaying discrete events (deaths, breaks, boss
  attacks) as they arrive.
- The **server is a thin relay + matchmaker** that *enforces* authority
  (entity messages from non-hosts are dropped). It does not simulate the world
  (yet).
- **Enemies threaten every wizard**, not just the host's — host-side AI targets
  the nearest player on the floor (local or peer), and any damage aggros.
- **Your own health is always local.** Contact damage and incoming blasts hurt
  you on your own machine — survival never waits on a round trip. Damage to
  *entities* is shooter-favored: your shots apply where you saw them land, via
  hit-requests to the host; replayed explosions are cosmetic vs. entities so
  nothing is double-counted.
- **Late joiners get a real world**, not a ghost floor — the host sends a
  one-time state sync (dead entities, live positions/health, loot on the
  ground, treasure status) so a mid-fight joiner sees the floor as it actually
  is.
- **Host migration is seamless.** Because replicas already carry each entity's
  replicated state, when the host leaves the server promotes the next-oldest
  member; their kinematic replicas flip to dynamic bodies and the AI resumes
  from the last snapshot, mid-fight, no reload.

**The scaling path** is deliberately short: move the host role into a headless
process that speaks the exact same protocol (it's just another client the
server always designates as host). Nothing else has to change. At 4
players/instance, instances are trivially shardable across machines because
they share nothing but the tiny directory record (instance → members, seed).

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full protocol, the sync-state
table, and the extension guide.

---

## 7. Current state (what exists vs. what's planned)

**Working today:**

- Full single-player loop: village → choose entry floor → descend → fight →
  loot → checkpoint-bank or die-and-lose.
- 100-floor procedural generation with difficulty scaling and boss floors.
- Movement, all four equipment slots, the full ability/enemy/boss/prop set
  listed above, procedural audio, the dynamic-light look.
- Real online multiplayer: shared instances, matchmaking, remote wizards with
  name tags, host-authority replication of enemies/props/boss/loot, late-join
  sync, host migration.
- Persistence of checkpoint progress, banked gear, player name, and the
  shadows quality toggle (localStorage).

**Not done yet / known gaps:**

- No reconnect: a server restart or dropped socket drops you to offline until
  you re-enter a floor.
- No full server authority (host is a client; a laggy/cheating host affects
  its instance).
- Sparse content breadth: 4 staffs, ~a dozen items, 2 enemy types + 1 boss.
- No persistent meta-progression beyond checkpoints and banked gear.
- Lore is implied by mechanics but largely unwritten.
- No anti-cheat (client-authoritative damage on your own hits).

---

## 8. Controls (reference)

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

The running build id (`b<commit count> · <short sha>`) is always shown in the
bottom-right corner — check it against the latest commit when testing.

---

## 9. Guiding principles for future work

- **Modular, future-proof, clean, performant** — the four words the project
  has been held to from day one. New systems should be swappable, data-driven
  where possible, and cheap by construction.
- **When in doubt, make the world more interactive**, not the menus deeper.
- **Every feature should be enjoyable solo and better in co-op.**
- **Measure, don't guess, on performance** — there's an F3/P frame-time
  overlay and a scripted benchmark harness for exactly this.
- **Keep the zero-asset pipeline** unless there is an overwhelming reason not
  to; it's a core strength.
