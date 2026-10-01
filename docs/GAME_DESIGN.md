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
  but **death in the dungeon takes everything you gathered on that run.** The
  deep only lets you go home after five floors; after that, every floor's
  way-home portal is open, and the question "one more floor, or turn back?"
  should be a genuine, tense choice.
- **Mastery of movement and aim.** Combat rewards positioning, timing, and
  clever use of physics — not just clicking. A skilled wizard flows through a
  room; a clumsy one gets cornered.
- **Serendipitous, uneasy multiplayer.** Now and then the deep lets another
  real wizard onto your floor. You don't know who, or where — only that
  someone is there. Swear a pact and fight together, or kill them for what
  they carry. No lobby, no matchmaking menu — the world just, occasionally,
  has someone else in it.

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
- **Fancy, moody lighting.** Near-black dungeons lit by flickering torches,
  glowing magic, and the player's own staff-light. Fog for depth. A heavy
  vignette. Real reflections in wet and polished floors — a torch across the
  hall glints in the puddle at your feet.
- **Painted pixel surfaces** (the old Drowned Halls look, now every
  biome's): each surface is painted texel by texel from a small palette
  ramp — mortar lines, chipped edges, moss and grime — with a few emissive
  specks that bloom. Each biome brings its own ramp, its own glow colour and
  its own split-tone colour grade that eases in as you arrive, so a new
  floor reads as the air changing. Rooms are plain on purpose (tall 6 m
  walls, fog, shafts of dusty light, torches): the feel comes from texture,
  light and fog, not from clutter.
- **Particles everywhere, and alive — in pixels.** Every particle is a
  crisp chunk on the pixel grid: explosions with a core flash, pixel-chain
  sparks, dithered smoke and a stepped shockwave ring; comet-tailed bolts;
  enemies that dissolve upward as light; torches with real shader flames and
  embers; and the air itself moving — dust in torchlight, drowned spores and
  drips, forge embers, crystal glitter, falling ash.
- **Portals are the showpiece.** A rift: a jagged tear in the air, rimmed
  in pixel fire and framed in runed stone, that quickens as you come close.
  Using one is a journey: the tear rips open over your view and you are
  sucked in, hover in a dark void of blocky stars while the next floor
  loads, and are spat out through a tear onto the new place. Sealed rifts
  are frozen, cracked glass.
- **The UI is in the world, in the grimoire's hand.** No flat screens:
  words burn into the air ahead of you as runes that settle into letters
  and later burn away; menus are dark stone tablets that assemble out of the
  dark and forge a brass pixel frame around themselves; prompts and
  messages are small framed plates hanging where they belong (never in
  your way); your health and mana are two pixel-art flasks whose liquid
  sloshes as you run and turn; the whole HUD is carried — it trails your
  turns and swings with your stride; items are small objects you pick up
  and set down. The type is pixel type — Jacquard 12 blackletter for the
  big moments ("Floor 12", "You Died"), Jersey 15 for smaller titles,
  Tiny5 for text, Silkscreen for tiny labels — in parchment on soot, arcane cyan for magic and the way onward,
  gold for home, blood for danger. New UI must follow this — if it could be
  a DOM panel, it's wrong.
- **Post-processing chain:** bloom (feeds the emissive specks and magic) →
  split-tone colour grade (per biome) → film grain → heavy vignette. The pixelation itself is *free*: the
  world renders at ~1/3 resolution and the browser upscales it with
  `image-rendering: pixelated` (the UI canvas above it renders at full
  resolution so the pixel font stays crisp).

### Hard constraint: **zero binary assets**

Everything — textures, normal maps, all sound — is **synthesized at runtime.**
No image files, no audio files, no model files. The one exception is the
four pixel fonts of the UI (Jacquard 12, Jersey 15, Tiny5, Silkscreen,
installed from @fontsource), because good pixel type is the heart of the
look. This keeps the whole game a
tiny, fast-loading bundle and makes it trivially themeable in code. Any new
art is a new procedural painter function, not an asset pipeline.

- Textures: pixel art painted texel by texel from small palette ramps
  (stone brick, worn slabs, planks, ceramic, barrel staves, dirt, per-biome
  walls and floors), each with a matching normal map and emissive specks.
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

### Inventory & carrying

Picking up an item no longer replaces what you have. Every wizard carries:

- **4 equipment slots** (above) — an empty slot auto-equips a pickup.
  Everything except the staff can be unequipped (a wizard without a staff
  isn't a wizard; bare feet just mean a plain single jump).
- A **5-slot bag** — everything else you grab goes here; swap gear in and out
  on the inventory screen (**I**).
- A **2-slot consumable belt** mapped to **Q and E** — potions and feathers
  are drunk/spent straight from the belt mid-fight. (E prefers interactions:
  standing at a portal never wastes a draught.)
- A **30-slot chest at home** in the village — banked storage. It never
  travels, so it's never at risk.

The inventory screen shows **your actual wizard in 3D** between the slot
columns — the same `WizardModel` other players see on shared floors, on a
slow turntable, dressed live in what's equipped (cloak color, boots, staff
crystal, amulet gem). Items move by **drag & drop** between any cells (click
still does the obvious quick-move); every item shows its stats (staff ability
damage/mana, passives, consumable effects) plus a side-by-side comparison
with what you're currently wearing. Item glyphs (⚚ ◈ ▲ ⬢ ⚗) are the same
everywhere an item appears.

**Dropping items:** drag anything onto the drop cell. In the dungeon it
spawns **real loot orbs at your feet** — a floor-mate can pick them up, which
makes dropping double as gifting (share a potion with the stranger you just
met on floor 3). In the village it simply discards. The staff can never be
dropped.

### Gold & the merchant (the economy)

**Gold drops** from enemies (~60%), sometimes props, and bosses hoard piles of
it. Coins vacuum up automatically — no E needed. Gold gathered in the dungeon
is **run loot like everything else**: die and it's gone, bank it to keep it.

**Maro the Provisioner** runs a stall in the village. He **buys anything**
(drag an item onto the sell cell — stingy prices, roughly a quarter of worth,
so selling clears clutter without becoming the main income) and sells, for
deliberately steep prices (all numbers in `items/economy.ts`, the one balance
sheet):

| Ware | Effect | Feel target |
| --- | --- | --- |
| Weak Healing Draught | +40 health | ~a third of an early banked run |
| Weak Mana Draught | +60 mana | slightly cheaper than healing |
| **Feather of Safe Passage** | exit the dungeon from ANY floor — even before the tithe of five is paid — banking your run loot | ~two banked early runs; insurance you feel |
| **Orb of Fortune** (65g) | random GEAR rolled a couple floors past the deepest floor you've walked home from, ~45% enchanted | the gold sink: gambling IS affix hunting (and a way to nudge your resonance deeper) |

Online, every trade is server-validated: purchases against the shared price
table, sales against provable ownership, and the Orb of Fortune is rolled BY
the server so a client can't fish for outcomes.

Potions also drop in the dungeon (uncommon); feathers essentially don't — the
Warden sometimes drops one, and the balance intent is that they mostly come
from Maro. The feather is the economy's keystone: it converts gold into a
softer answer to "one more floor?", without ever granting progress.
Balance rule of thumb: if consumables ever feel routine, raise prices before
lowering drops — finding gold should stay exciting.

### Enchantments (rarity)

Dropped gear can roll **enchanted** — one affix rider (Swift, Vigorous, Keen,
Focused, Warded, Veiled) on top of its base stats, marked ✦ in violet
everywhere. Enchant chance scales with depth (~14% on floor 1 up to 50%
deep down); consumables never enchant. Technically an enchanted item is just
an item id with a suffix (`"void_staff+keen"`), so the whole provenance /
banking / trading stack handles rarities with zero server changes — see
ARCHITECTURE.md. Adding an affix is one entry in `items/affixes.ts`.

### Item levels

Every piece of gear carries an **item level** — the depth it was found at
(±1; boss drops a little deeper). A staff's level multiplies its spell
damage; every other piece adds a **health ward**. So gear found deep keeps
you roughly on par with deep monsters, and an empty slot is a real weakness.
Item levels are shown everywhere an item is ("Lv 12").

### The run structure & the central risk

- **100 floors**, each harder (`floorScale` ramps enemy health, damage, and
  count with depth), in five **biomes** (below).
- **The Weighing.** The village portal reads your gear: your **gear level**
  is the mean item level of the four gear slots (empty slots count as zero).
  It casts you to the floor that level belongs at (≈ 0.85 × gear level). You
  never pick a floor — dress deeper to go deeper, strip down to go shallower.
- **The Tithe of Five.** Every floor has a golden **way-home portal** beside
  its exit, sealed until your run has played five floors. From your fifth
  floor on, any way home banks everything you carry and returns you to the
  village. The server enforces it.
- **Death is the whole tension.** Die before you get home and **all loot
  gathered during that run is lost** — gear you brought from home survives.
  Alone, the dungeon keeps it. On a shared floor it stays behind in a
  **grave chest** that anyone may plunder.
- **Bosses every 10th floor.** The **Warden of the Deep** holds the exit room
  and **seals both portals until it dies.**

### Omens

About a quarter of floors (never the first) are in a **mood**, rolled from
the floor seed so everyone on the floor shares it, and announced shortly
after arrival: **the Weightless Hour** (low gravity — blast-jumping gets
silly), **the Lightless Vigil** (few torches, close fog), **the Crimson
Omen** (angrier monsters, richer loot), **the Mana Tide**, **the Tinderbox**
(barrels everywhere, bigger blasts), **the Teeming** (more, frailer
monsters). Surprise is part of the charm: you never quite know what the
next floor will be.

### The signature multiplayer mechanic: rare encounters

- **Only wizards on the same floor can meet**, and they rarely do. Entering
  a floor rolls an encounter; the odds rise with every floor you walk alone
  (12% → 60%) and reset when you meet someone. Most floors are yours alone,
  but none is guaranteed to be.
- **Presence, not names.** When someone arrives you feel "a presence" — no
  name, no marker. An eye on the HUD opens and burns redder as a stranger
  closes in, and your heartbeat becomes audible. Names only appear over heads
  within ~16 m.
- **Fight or swear a pact.** Every stranger is hostile by default: your
  spells hurt each other (at 55% strength, decided on the victim's machine).
  Stand close and press **F** to offer a pact; if they accept, your magic
  passes harmlessly between you and they wear a green halo. Pacts can be
  broken at any moment; the betrayed wizard sees an **oathbreaker** marked in
  red for the rest of the floor.
- **Graves.** A wizard who dies on a shared floor leaves a grave holding
  exactly what the death took from them. The killer — or anyone — can
  plunder it (E), and what they take is theirs to lose again.

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
tried is dead or turned back at the tithe of five.

The dungeon is not neutral: it *keeps* what the dead were carrying. That's the
in-fiction justification for the roguelike loot-loss — the dungeon is greedy,
and the Tithe of Five is its price for letting you leave: give it five floors
and it lets you go, this once, with what you've earned. But it is jealous and
slow — where other living wizards stand witness, it can't swallow the dead
fast enough, and a grave remains.

### The written lore

The mythos is now carved into the walls (`world/lore.ts`, ~35 fragments —
journal scraps, Founders' inscriptions, graffiti, oaths) and collected in the
**codex** (C). What the fragments collectively know:

- **The Weighing Gate** weighs what a wizard carries and casts them where
  their weight belongs. **The Tithe of Five** is the deep's price for
  release.
- Wizards rarely meet below; the deep keeps them apart and **listens** when
  it lets them meet. Pacts sworn below bind the staff, not the heart.
- **Wisps** are the drifting light of wizards who died alone; **sentries**
  are the Founders' wardstones, which no longer know friend from foe;
  **shadows** are what an oathbreaker leaves behind; **slimes** are the
  dungeon's slow digestion; **the Warden** is the jailer, the Founders' last
  ward.
- The depth bands: **the Catacombs** (the builders' tombs), **the Drowned
  Halls** (where the sea got in), **the Ember Forge** (where the Founders
  forged their wards), **the Crystal Deep** (the dungeon's singing bones),
  **the Hollow** (near the bottom: silence, pale light — something listens).
- The deepest carvings hint at the secret: the Founders built the village
  not to get something out, but to **keep something in**.

### Tone

Gritty, a little grim, but not humorless. Wizards are treasure-hunters and
glory-seekers, not solemn chosen ones. The village is cozy; the dungeon is
oppressive. The contrast between the two is the mood.

### Lore hooks left open (for future writers)

- Who built the dungeon, and why does it hunger?
- What actually is at floor 100 — a literal god, a lie, a mirror?
- The enemies are "hostile magic" (wisps, warding sentries, the Warden). Are
  they the dungeon's immune system? Failed wizards? This is unwritten.
- The Tithe of Five — whose price, and what does the deep do with the floors?

None of this is on rails yet. The mechanics imply a story; the story text is
mostly still to be written.

---

## 5. Future content & direction

This is a wishlist / direction doc, not a commitment. Ordered roughly by how
naturally the current systems support it.

### Enemies (the roster is meant to grow)

Current: **Wisp** (floating chaser, burns on contact), **Sentry** (fixed
crystal turret, lobs dodgeable fire bolts with line-of-sight), **Shadow**
(prowls a ring around you, then lunges from the dark), **Slime** (hops, and
splits into smaller, faster slimes), plus the **Warden of the Deep** boss.
Adding an enemy is deliberately cheap — a roster row, a pure brain, a model
and a small kind file (see ARCHITECTURE.md "Extending"). Ideas:

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
- Deeper rarities: multi-affix items, suffixes, cursed trade-offs — the
  affix layer ships with single-affix "enchanted" items today.
- Set bonuses across slots.
- More consumables (scrolls, bombs, buffs) — each is one catalog entry; the
  belt/merchant/provenance plumbing is already generic.
- Richer merchant stock for deeper wizards; more gold sinks beyond the
  Orb of Fortune (shrine offerings? stash upgrades?).

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
  core/        config (all tuning numbers), seeded RNG, typed event bus
  run/         run rules: the Weighing, the Tithe of Five, bank/death outcomes
  items/       catalog, item levels & power, affixes, loot tables, economy,
               inventory grids, loot-orb manager
  world/       gen/ (staged pure generator), biomes, omens, lore, props, traps
  enemies/     roster data, shared enemy shell, pure brains/, kinds/
  weapons/     spell catalog, cast kinds, projectiles, explosions, singularity,
               allegiance (who may hurt whom), cast replay
  encounters/  pacts, presence sense, kill credit, grave chests
  net/         protocol, matchmaking (tension clock), transport, session,
               synced clock, snapshots, channels, entity replication,
               wizard poses, remote wizards + collision capsules
  state/       zustand game store, codex, save persistence
  player/      input, first-person controller, staff viewmodel
  fx/          shader particle system + named effects, ambient air, torch
               flames, dynamic light pool
  audio/       procedural WebAudio synth (sfx, biome drones)
  render/      textures/ (pure painters + normal/emissive/roughness maps),
               models/ (every mesh), post-processing
  scenes/      village, dungeon floor, floor atmosphere, canvas composition
  transition/  portal journeys: enter pull, vortex tunnel, arrival
  ui3d/        the in-world UI: pixel font, rune text, tablets, item models,
               the HUD, menus and inventory as physical things
  ui/          the DOM leftovers: perf overlay, build stamp, dev room
  game/        cross-system registries and seams (hostility, floor rules,
               damage sources, interactions, player-state, targeting)
server/        Bun WebSocket game server (relay, accounts, provenance)
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
  truth. Everyone else runs **predicted replicas**: real dynamic bodies that
  the framework steers toward timestamped snapshot buffers on a server-synced
  clock (velocity-aware hermite interpolation, ~90 ms behind) — so your
  blasts knock things back and your body shoves crates *instantly*, while
  authority reconciles underneath. Every wizard also has a collision capsule
  on every machine, so a joined player's pushes are real in the simulation
  that matters. Discrete events (deaths, breaks, boss attacks) replay as they
  arrive.
- The **server is a gameplay-blind relay + matchmaker** that *enforces*
  authority purely by channel-name prefix (`a:` host-only, `h:` to-host,
  `p:` peer broadcast). It never learns what an enemy or an orb is, so new
  gameplay features never touch it. It does not simulate the world (yet).
- **Networking is declarative for game code.** A new entity calls
  `useNetBody(…)` once and gets replication, interpolation, damage routing,
  late-join and host migration for free; new messages are one
  `hostEvent`/`hostCommand`/`peerMessage` declaration. Requests dispatch
  locally on the host, so gameplay code has no host/replica branches.
- **Enemies threaten every wizard**, not just the host's — host-side AI targets
  the nearest player on the floor (local or peer), any damage aggros, and peer
  poses carry velocity so enemies lead their shots against everyone.
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

- Full loop: village → the Weighing casts you by gear level → descend →
  fight → loot → walk home after five floors, or die and lose (or, on a
  shared floor, leave a grave).
- Item levels (gear potency and health wards scale with depth), gear-level
  entry, the Tithe of Five — enforced server-side.
- Five depth biomes (own surfaces, light, drone and monster mix), six omens,
  ~35 lore carvings and the codex.
- 100-floor procedural generation with difficulty scaling and boss floors.
- Movement, all four equipment slots, the full ability/enemy/boss/prop set
  listed above, procedural audio, the dynamic-light look.
- The full inventory & economy layer: bag + Q/E belt + village chest, the
  inventory screen (live 3D wizard, drag & drop, stat comparison arrows),
  gold drops with auto-pickup, enchanted (affixed) gear, the village merchant
  (buying AND selling), the Orb of Fortune gamble, potions, and the Feather
  of Safe Passage.
- Real online multiplayer: rare same-floor encounters (tension clock),
  presence sense, pacts and wizard-vs-wizard combat, kill credit, grave
  chests, host-authority replication of enemies/props/boss/loot/graves,
  late-join sync, host migration, reconnect into the same instance.
- The look ("gritty pixel-magic"): five biomes of painted pixel-art
  surfaces with their own colour grades, plain 6 m halls with fog, light
  shafts and ambient air; pixel particles for every effect; rift portals and
  portal journeys for every scene switch; and the whole UI in the world in
  the grimoire style (rune text in pixel fonts, framed stone-tablet menus,
  the framed HUD, 3D items).
- Persistence of the deepest floor, banked inventory + gold, player name,
  and the shadows / reflections quality toggles (localStorage cache; server-authoritative
  online — including gold provenance and merchant purchase validation).

**Not done yet / known gaps:**

- Reconnect returns you to your old instance while it exists (it's gone if
  everyone left); no session resume tokens yet.
- No full server authority (host is a client; a laggy/cheating host affects
  its instance).
- Content breadth is still modest: 7 staffs, ~20 items, 4 enemy types + 1
  boss (the same Warden in every biome).
- PvP damage is decided on the victim's machine (like all player damage), so
  a hacked client could ignore it; a cast's origin is sanity-checked against
  the caster's pose.
- No persistent meta-progression beyond banked gear, the deepest floor and the codex.
- Anti-cheat is foundation-level: server-side accounts/saves with
  host-attested item provenance and floor-entry validation exist, but the
  floor host is still a client (a cheating host can vouch for its
  floor-mates) and item stats are client-computed. Full fix = headless
  server-side hosts.

---

## 8. Controls (reference)

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
| I (or Tab) | Inventory screen |
| C | The codex (lore carvings read) |
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
