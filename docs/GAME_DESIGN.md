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

You are a wizard of Riftwatch, an expedition's camp pitched round a rift
torn in the floor of a mountain valley — the mouth of a hundred-floor
dungeon. For **glory, fame, riches — and to reach the bottom and find god** —
wizards step through the rift and descend. Every floor is deeper, darker,
and harder than the last.

The emotional loop we are chasing:

- **Greed vs. fear.** Every floor you descend makes you richer and stronger,
  but **death in the dungeon takes everything you gathered on that run.** The
  deep only lets you go home after five floors; after that, every floor's
  rift forks as you step in — down, or home — and the question "one more
  floor, or turn back?" is asked in the void, a genuine, tense choice.
- **Mastery of movement and aim.** Combat rewards positioning, timing, and
  clever use of physics — not just clicking. A skilled wizard flows through a
  room; a clumsy one gets cornered.
- **Serendipitous, uneasy multiplayer.** Now and then the deep lets another
  real wizard onto your floor. You don't know who, or where — only that
  someone is there. Swear a pact and fight together, or kill them for what
  they carry. No lobby, no matchmaking menu — the world just, occasionally,
  has someone else in it. Home is the opposite: the camp is shared, friends
  swear fellowships by the fire and go down together, and the Proving
  Ground behind the obelisk is where wizards fight each other for nothing
  but the score.
- **Barely alive.** The last third of every bar holds half the life. A
  creature on its last sliver cracks, leaks and fights for its life, and
  pulls you into finishing it; you on your last sliver hear your heart over
  a muffled world, and a killing blow from healthy leaves you on the Brink
  with a heartbeat to get away. The best moments are the close ones.

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
  floor reads as the air changing. And no floor is one colour end to end:
  each turns its band's palette a little around the colour wheel (seeded),
  and across the floor hue, richness and brightness drift from room to
  room — the stone, its glowing seams, the torches and the fog with it. The
  bones of an old crawler carry the space: every doorway is an arch of
  dressed stone (some with a portcullis raised in it, some with a door
  hanging off its last hinge), halls are crossed by ribs on piers and big
  ones stand on pillars. Then texture, not clutter: skulls in the corners,
  candles somebody keeps lighting, chains and bone chimes from the vault,
  webs, the Founders' banners in rags, grates, fallen masonry — and each
  band its own (barnacles and kelp, anvils and braziers, crystal spurs,
  pale roots). It all keeps to the corners, the walls and the vault, so the
  floor you fight on stays readable.
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
  loads, and are spat out through a tear onto the new place. A floor's rift
  forks in that void — two tears, cyan down and gold home, standing where
  they opened while you turn to choose. Sealed rifts are frozen, cracked
  glass.
- **The UI is physical and in the world.** No flat screens and no framed
  boxes: menus are tablets that build themselves out of worn, round-edged
  stones in front of you; prompts and messages are small slabs of slate
  (never in your way); words burn into them as runes that settle into
  letters and later burn away; the map (M) is a miniature of the village or
  of the floor you've explored, laid in light on the ground a step ahead of
  you inside a rune circle — walk around it, or over it; anyone on the floor
  sees it, every wizard marked on it, and casting it shares what you've
  explored; it lights the room round it, and folded, it gathers into its
  middle and goes out in a spark; your
  health and mana are two glass orbs whose facets catch the torch one pixel
  at a time, their liquid sloshing as you run and turn; the HUD is sparse
  (the tithe stones top left, the floor top right, the orbs, the belt) and
  carried — it follows your
  turns closely and swings with your stride; items are small objects you
  pick up and set down. The type is pixel type — Jacquard 12 blackletter for the
  big moments ("Floor 12", "You Died"), Jersey 15 for smaller titles,
  Tiny5 for text, Silkscreen for labels — every font pixel on a whole number
  of screen pixels, and every size a step of one type scale (text ×2, a big
  number ×3, a heading's own size), so a label on the HUD, in a menu and in
  the inventory comes out the same — in parchment on soot, arcane cyan for magic and the way onward,
  gold for home, blood for danger. New UI must follow this — if it could be
  a DOM panel, it's wrong.
- **Post-processing chain:** pixel-art edges found in the depth (a dark
  outline behind every silhouette, a lit lip on every near edge) → the
  lens (motion blur from your own turns and dashes, a zoom rush on a blast
  or a rift's pull, colour fringing at the rim, the forge's heat shimmer,
  the world going soft behind a menu) → bloom (feeds the emissive specks
  and magic) → an eye that adapts (step out of a black corridor and the
  hall opens up) → split-tone colour grade (per biome) with a filmic
  shoulder so flames and blasts keep their shape → film grain on the pixel
  grid → ordered dither → a heavy vignette tinted with each place's darks.
  The body is in the image too: a blow drains the colour, a blast punches,
  your kill pops the exposure, near death the world greys — all but its
  reds — and the rim of sight closes with your pulse.
  Each biome has its own air (the Hollow's dark breathes, the Crystal Deep
  splits light like a prism, the Drowned Halls breathe faintly with the tide). The pixelation itself is *free*: the
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
  roar, and looping ambient drone/wind beds per scene — heard through
  **raytraced acoustics**: the room around you is measured with rays
  bouncing off its walls and its reverb generated to match (each depth
  band's stone has its own sound: dry catacombs, longer bright Drowned
  Halls, dark short forge, ringing crystal, the vast Hollow — tuned for
  play, a hall rings about a second, never a cathedral's wash), and every
  sound in the world is placed and reaches you the way sound would —
  straight, or round corners from the doorway it came through, duller the
  further it bent, a thud through rock. Each room rings on its own: walk
  out of a hall and you still hear it ringing behind you through the
  doorway, fading as the corridor takes you away. And sound is a place,
  not a volume knob: each ear hears a sound at its own moment and through
  the head's shadow (on headphones it's out there, behind you, to your
  left), a far blast lands after its flash, a wisp streaking past bends in
  pitch, the air dulls the far end of a hall, and a rift you stand beside
  — or a blast you stand in — is all round you. The world has its own voices:
  footsteps on each ground (stone, wet stone, crystal, iron, ash, cobbles,
  grass), torches crackling, rifts humming, monsters waking, walking and
  dying, and the small sounds each place makes by itself. Near death the
  whole world goes under a muffle while your heart, the ring in your ears
  and the UI stay clear; everything meets one gentle compressor and a
  limiter on the way out, so three blasts on a kill chime land as one big
  sound instead of crackle.

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
  staff viewmodel sway + recoil kick, dust puffs on jump/land, and the
  eye's own kick by the weight of the spell you cast (a rail is a cannon,
  a bolt a flick — and the kick never bends your aim).

### The physics sandbox

Every dungeon floor doubles as a physics playground. Crates, barrels, and pots
are real dynamic rigid bodies (Rapier) that tumble when shoved, shatter under
fire, and sometimes hide loot. **Barrels explode**, chain-reacting into nearby
props and enemies. All explosions apply a **radial impulse** to everything
in range — enemies, props, and the player — which is the heart of the sandbox
feel. The village even starts you with a few crates to kick around.

### Feel: the knee, barely living things, the Brink

The fight's curve is Destiny's: **the last third of a bar holds half the
life.** It's shown, never cheated — the life underneath is plain numbers,
the same on every machine — but it shapes everything about a fight.

- **The knee.** Your first good blows knock a creature's bar down fast to
  a notch; past it, the sliver lasts as long as everything before it. That
  sliver is the hook: the thing almost dead pulls you into finishing it.
  The Warden's bar has the notch drawn in brass, the blow that crosses it
  cracks the seal, and the Warden fights its last third enraged.
- **Barely living things.** A creature shows its life without a bar.
  Glowing cracks open across its shell from the first quarter lost;
  crossing the knee breaks it — a crack of light, a ring, a stagger, a
  yelp — and from then on it gutters like a failing lamp, leaks, lists and
  breathes ragged, and at the very end its light beats like a heart. At
  death's door it fights for its life: wisps jink, a shadow strikes again
  at once, slimes hop frantically, sentries overcharge. What it's about to
  do is readable by every wizard — the shadow coils with flaring eyes, the
  Warden crouches and stills its shell, the sentry's crystal swells. And
  once you've hurt something, a small pixel bar hangs over it: bone-white,
  then an ember sliver throbbing like a death rattle, kept a while so a
  dying thing can be hunted down, shattering on the kill.
- **Hits that land.** Ticks flare round the crosshair and a dry "tk"
  climbs in pitch as the creature weakens — the last half of its life is
  an audible crescendo; the kill is a red X and a deep chime. Damage
  numbers pop in the game's own pixel font — bone-white, gold for a
  precision hit (the wisp's core, the shadow's eyes, the sentry's crystal,
  the Warden's heart when its shell opens), red-hot for the kill — and a
  beam pours into one climbing number instead of a cloud. Heavy hits catch
  the frame for a blink (hitstop: 40 ms for a heavy hit, 80 for a kill,
  120 for a precision kill, a quarter-second for the Warden's death; never
  a beam's ticks), and only the picture stops — the world never pauses.
  Kills chained close climb a pentatonic chime, burn rune words beside the
  aim (DOUBLE, TRIPLE, RAMPAGE, MASSACRE, CATACLYSM) and pour a little mana
  back, so aggression feeds itself.
- **Deaths with weight.** Each creature dies its own way: the wisp swells
  and implodes, the shadow unravels and leaves its eyes a heartbeat in the
  air, the slime splats and its children squeeze out of the puddle, the
  sentry's head flies off along the blow and shatters, the Warden sheds its
  shards and goes critical. A big enough overkill blows a body apart.
- **You, barely alive.** Below 30% health, harm is halved — your last 30%
  lasts as long as the 60% before it — and that line is a place you can
  hear: the world goes muffled and far away, the colour bleeds out of
  everything but the reds, and a heart thuds in your head, racing toward
  death. A killing blow taken from half health or more leaves you on one —
  **the Brink**, at most once every 25 seconds: the picture slows, a thoom
  and a ringing in your ears, a red flash, and your dash is back for the
  breath in which nothing can touch you. You can never be one-shot from
  healthy. Heal back over the line (a real heal, not a trickle) and it's a
  second wind: colour floods back and the world opens up again. The orb
  tells the truth — a third full looks a third full. These rules are the
  wizard's own, decided on their own machine like all their health, so
  they're as fair in a duel as in co-op.
- **Others at death's door.** On a shared floor you see a floor-mate's
  last stand too — a pixel heart beating over their head, embers leaking
  from them — and you hear their Brink where they stand.

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
- An **8-slot reagent pouch** — the materials the deep sheds (see Crafting),
  in deep stacks. Like everything found below, they're run loot until
  banked.
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
| **Orb of Fortune** (65g + 1.25g per floor of your deepest) | random GEAR rolled a couple floors past the deepest floor you've walked home from, ~45% enchanted | a gold sink: gambling IS affix hunting (and a way to nudge your resonance deeper); the price climbs faster than the gear resells, so it's never a gold farm |

Online, every trade is server-validated: purchases against the shared price
table, sales against provable ownership, and the Orb of Fortune is rolled BY
the server so a client can't fish for outcomes.

Potions also drop in the dungeon (uncommon); feathers essentially don't — the
Warden sometimes drops one, and the balance intent is that they mostly come
from Maro (or from Wenna's cauldron, for a piece of riftglass). The feather
is the economy's keystone: it converts gold into a softer answer to "one
more floor?", without ever granting progress. The forge is the other big
gold sink.
Balance rule of thumb: if consumables ever feel routine, raise prices before
lowering drops — finding gold should stay exciting.

### Enchantments (rarity)

Dropped gear can roll **enchanted** — an affix rider (Swift, Vigorous, Keen,
Focused, Warded, Veiled and more — two dozen in `items/affixes.ts`) on top
of its base stats. Rarity reads at a glance in each item's colour: common
(bone), **enchanted** (blue, one affix), **arcane** (violet, two) and
**legendary** (amber: a named unique with a power of its own). Enchant
chance scales with depth (~14% on floor 1 up to 50% deep down, and a
deeper find more often carries a second); consumables and materials never
enchant.
Technically an enchanted item is just an item id with a suffix
(`"void_staff+keen"`), so the whole provenance / banking / trading stack
handles rarities with zero server changes — see ARCHITECTURE.md. Adding an
affix is one entry in `items/affixes.ts`.

### Item levels

Every piece of gear carries an **item level** — the depth it was found at
(±1; boss drops a little deeper). A staff's level multiplies its spell
damage; every other piece adds a **health ward**. So gear found deep keeps
you roughly on par with deep monsters, and an empty slot is a real weakness.
Item levels are shown everywhere an item is ("Lv 12").

### Crafting (kept simple)

Crafting is a reason to walk back up, not a spreadsheet. The deep doesn't
flood you with item types: **seven materials, no more.**

- **One reagent per depth band** — Grave Moss in the Catacombs, Brine
  Pearls in the Drowned Halls, Cinder Iron in the Ember Forge, Singing
  Shards in the Crystal Deep, Hollow Ash in the Hollow — and a floor only
  ever drops its own band's. However deep you go, a floor hands you one
  kind.
- **Riftglass** — a piece of the rift gone hard, and a glint: a rare kill,
  a Warden, a vault or a won ward circle, or breaking down a legendary or
  heavily forged piece (never more back than went in). The forge's finest
  work runs on it.
- **The Warden's Sigil** — only Wardens give them.

**Each item tells you what it wants.** Every piece of gear hungers for one
band reagent of its own, picked from its base and its enchantments (and
only from bands its level has reached) — written on its plaque and over
the anvil ("HUNGERS FOR GRAVE MOSS"). "What does this one need?" always
has one answer. A deep wizard's fire staff may still hunger for Grave
Moss, and back up to the Catacombs they go. That walk is the point.

- **Old Wenna's cauldron** brews every draught on Grave Moss and at most
  one other material: the plain potions on moss alone, the better ones and
  the four elixirs on one deeper band's reagent each, and the Feather of
  Safe Passage on a piece of riftglass.
- **Brannoc's forge** works the piece on the anvil with its reagent:
  **temper** (+1 level — never more than three past the deepest floor
  you've walked home from: the forge only carries you a step past where
  you've been), **enhance** (+1 to +5, more riftglass each step: its boons grow,
  its banes don't), **imbue** (one more random enchantment, two at most),
  **reforge** (re-roll them — which may change what it hungers for) and
  **salvage** (break it into its reagent). Apart from the anvil, **the
  Great Work**: three Warden's Sigils, five riftglass and 300 gold forge a
  legendary.
- **The server does the work.** Crafting touches only what's banked, in
  the village; online the server runs the very same recipe with its own
  dice (an imbue can't be fished for), and refuses outright if the anvil
  holds something other than what you saw.

### The run structure & the central risk

- **100 floors**, each harder (`floorScale` ramps enemy health, damage, and
  count with depth), in five **biomes** (below).
- **The Weighing.** The village portal reads your gear: your **gear level**
  is the mean item level of the four gear slots (empty slots count as zero).
  It casts you to the floor that level belongs at (≈ 0.85 × gear level). You
  never pick a floor — dress deeper to go deeper, strip down to go
  shallower. (One exception: a fellowship. If a companion is already below,
  no deeper than your gear allows, the Gate casts you to them.)
- **One rift per floor, forking in the void.** Step into a floor's rift
  and the journey hangs in the void while the tear forks ahead of you: the
  way down in cyan on the right, the way home in gold on the left. Turn
  toward one — it burns brighter — and take it, or wait and the way you
  face takes you. You arrive in the colours of the way you chose.
- **The Tithe of Five.** Until your run has played five floors, the way
  home is there but sealed — a thin, cracked, dim slit that won't open —
  and after a breath the rift takes you down: the rule shown, not told.
  From your fifth floor on, the way home banks everything you carry and
  returns you to the village. The server enforces it.
- **Death is the whole tension.** Die before you get home and **all loot
  gathered during that run is lost** — gear you brought from home survives.
  Alone, the dungeon keeps it. On a shared floor it stays behind in a
  **grave chest** that anyone may plunder.
- **Bosses every 10th floor.** The **Warden of the Deep** holds the exit room
  and **seals the rift until it dies.**

### Omens

About a quarter of floors (never the first) are in a **mood**, rolled from
the floor seed so everyone on the floor shares it, and announced shortly
after arrival: **the Weightless Hour** (low gravity — blast-jumping gets
silly), **the Lightless Vigil** (few torches, close fog), **the Crimson
Omen** (angrier monsters, richer loot), **the Mana Tide**, **the Tinderbox**
(barrels everywhere, bigger blasts), **the Teeming** (more, frailer
monsters). Surprise is part of the charm: you never quite know what the
next floor will be. Once it's there, it's never a mystery what it does: the
top-right corner of the HUD names it under the floor and its biome, and
lists its effects line by line (▼ what hurts, ▲ what helps) when you arrive
and again whenever a map is cast.

### Room events

Most floors keep a room apart — from floor 5, sometimes two, never the
spawn, the exit or the treasure room — holding something besides monsters.
The floor's host runs them, so everyone there sees the same thing, and
the cast map marks each one in its colour once seen.

- **Vault** — an iron-bound chest. Step into its room and its guardians
  wake round the walls; when the last falls, the lid unseals: a piece of
  gear, gold, a clutch of the band's reagent, often riftglass. It opens for
  anyone — that's the trouble.
- **Ward circle** — a ring of standing stones. Kindle it and hold the
  circle for 35 seconds while the deep sends three waves at it. Step out
  and it drains; leave it empty twelve seconds and it breaks. Held, it pays
  the best of the room rewards, riftglass for certain.
- **Shrine** — one of the old powers offers each wizard a bargain: a strong
  blessing for a couple of minutes, and something taken back (+40% damage
  for 30 of your max health; faster casting for taking more harm…).
- **Fountain** — clear water that mends body and mana, once per wizard.

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
- **A pact that holds becomes a fellowship.** Two strangers who swear a
  pact below walk out of it a fellowship (below) — the deep's chance
  meetings can turn into lasting company.

### Home: the shared camp & fellowships

Riftwatch isn't a menu; it's a place, and other wizards are in it.
Everyone who's home shares a camp — up to twelve round one fire — walking
it, reading the boards, speaking (Enter: the words hang over the
speaker's head and run down a little scroll at your left). It's the
opposite of the deep: nobody can be harmed here.

- **Fellowships.** Found one at the guild board and it gets six runes from
  an alphabet with nothing to misread — share them anywhere, and whoever
  speaks them joins — or press F beside a wizard to invite them (the
  invitation waits half a minute). Four at most. Speak to your fellowship
  wherever it is (start the line with `/p `); its runes stand at the right
  of your sight.
- **A fellowship goes down together.** Its members skip the encounter dice
  for each other and land in one another's world floor after floor; a
  fresh run starts on a companion's floor if the Weighing lets you go that
  deep. In the deep a fellow is never a stranger: your magic passes
  harmlessly between you. For everyone else, encounters stay rare.

### The Proving Ground

North of the gate, before the forest, stands an obelisk between two
braziers. Behind it Ysolde Varr keeps the Founders' old trial hall, where
duels end at the yield because the hall gives back the blood spilled in
it. It's PvP without the dungeon's stakes — a place to settle things,
test a build, or show off.

- **Step into the line** at Varr's tablet (her greeting, the rules, your
  ledger). Once two are waiting the hall gathers a breath — eight seconds
  — for more, and takes up to six (six go at once); then the obelisk
  takes you, wherever you stand in the camp, through an ember-gold warp.
- **Fair by construction.** The hall is four-fold symmetric — a great hall
  in the middle, four alcoves on spokes into it, a ring round the back
  through four corner chambers — so no spawn stone is better than another,
  and there's always a way round behind someone. Each bout rolls a band's
  look and how the hall breaks sightlines: open, four great blocks, or a
  cut-cornered octagon with low walls across the spokes' mouths. The
  Founders' inscription is carved on its north wall.
- **To the yield.** The hall waits until everyone has walked in (up to a
  minute and a half: a slow journey costs nobody their bout), then Varr
  counts it in — three bells,
  FIGHT — and the sands start. First to ten yields, or the most when three
  minutes run out; a tie goes to whoever fell less, then to whoever scored first; a
  wizard who walks out keeps their row but can't win. In the hall nobody
  dies: a killing blow is a yield to whoever struck last, you burn away in
  ember-gold and rise three seconds later at the stone farthest from every
  foe, whole. Nothing is lost — no grave, nothing carried at risk — though
  a draught drunk in the hall stays drunk.
- **Everyone is fair game**, your fellowship too, until Varr calls it.
  Then she reads the board, writes the bout into her ledger on your
  account (bouts, wins, yields), and the hall sends everyone home.

### Gameplay feel checklist (what "good" means here)

- Can I cross a room in a way that feels cool, even with no enemies? ✔ dash,
  double-jump, hover, blast-jump.
- Does hitting an enemy feel impactful? ✔ hit confirms and a climbing "tk",
  numbers, hitstop, a flinch along the blow, sparks, knockback, a kill X
  and chime, deaths with weight.
- Can I tell how close to death it is without reading a number? ✔ the
  knee, cracks and leaks, death's door, life marks, the Warden's notch.
- Do I feel how close to death *I* am? ✔ the muffle, the grey, the heart,
  the Brink.
- Does the room react to me? ✔ props shove/shatter/explode, physics ragdolls.
- Is the screen alive? ✔ torch flicker, drifting embers, ambient drone.
- Do I feel the risk of going deeper? ✔ visible run-loot markers in the HUD,
  the fork asking "deeper, or home?", the death screen listing what the
  dungeon kept.

---

## 4. Lore & the world

### The fiction

The world is one vertical place: **a camp of wizards on the lip of a
hundred-floor dungeon that bores down into the earth.** Riftwatch (the
village, in the code) is the safe hub — an expedition that found the rift
in a mountain valley and dug out the ancient paving round it, a ring of old
standing stones, and settled in to explore: canvas tents with lamplight in
their doorways, a command pavilion with the survey maps, a watchtower over
the forest edge, the diggers' worktable and spoil heaps, banners with the
expedition's eye, the fire everyone sits round, a palisade of sharpened
logs. Beside the rift stands the **depth stone**, which reads your gear the
way the Weighing does and shows, cut in light, the floor you'd be dropped
into.

It is night, always, and big: past the gate the forest climbs north toward
a great range of snow-streaked mountains, two titan peaks standing either
side of a **huge full moon** that rises right behind the rift as you come
up the lane, glowing, its light streaming over the peaks and through the
pines as god rays and long moonbeams across the camp. Overhead, a big pixel
sky: the Milky Way with dark lanes of dust, thousands of single-pixel stars
twinkling in hard steps, long banks of cloud, now and then a shooting star.
Through the rift is the descent.

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

The mythos is now carved into the walls (`world/lore.ts`, ~75 fragments —
journal scraps, Founders' inscriptions, graffiti, oaths, recipes) and
collected in the **codex** (C). What the fragments collectively know:

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
- The deepest carvings hint at the secret: the Founders sealed the rift
  under the paving the expedition dug up — not to get something out, but to
  **keep something in**.
- **The camp's people**: Maro the Provisioner; **Old Wenna**, the alchemist
  who brews what the deep sheds; **Brannoc** the smith, who went down nine
  times and came home with three gold rings and a hand that won't close;
  and **Ysolde Varr**, who keeps the **Proving Ground** — the Founders'
  trial hall behind the obelisk by the fire, where duels end at the yield
  because the hall gives back the blood spilled in it. Their voices are
  data in `world/npcLines.ts` (greetings, barks, and hints gated by how
  deep you've been).
- **What the creatures leave** — shards, ash, gel, cores — is the Founders'
  wards breaking down: the deep is digesting the wards, not the wizards.
  **Riftglass** is a piece of the rift gone hard, the tear being held shut
  and the holding coming off in pieces. Every piece carried home thins the
  lid; Wenna and Brannoc, knowingly or not, send them back down.
- **One tear per floor**: once the tithe is paid it forks as you step in,
  the way home and the way down — and deep enough, the way home narrows.
  **Fellowships** swear at the Gate and the deep parts them anyway;
  **vault chests** open for anyone (that's the trouble); a **ward stone**
  still lit draws everything the deep has; **shrines** give freely, because
  what a wizard leaves at a shrine, the lid keeps.

### Tone

Gritty, a little grim, but not humorless. Wizards are treasure-hunters and
glory-seekers, not solemn chosen ones. The camp is warm and the night above
it vast; the dungeon is oppressive. The contrast between the two is the mood.

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
splits into smaller, faster slimes), plus the **Warden of the Deep** boss —
each (the slime aside) with a weak point, each with its own fight at
death's door and its own death; the shadow, the sentry and the Warden wind
up where everyone can read it. Adding an enemy is deliberately
cheap — a roster row, a pure brain, a model and a small kind file, plus
how its body looks hurt and how it dies (see ARCHITECTURE.md "Extending").
Every new one should be readable before it strikes and visibly barely alive
before it dies. Ideas:

- **Charger / brute** — melee rusher that telegraphs and can be sidestepped.
- **Shielder** — must be flanked or blast-knocked to break its guard.
- **Swarm spawner** — a stationary nest that pumps out weak wisps, prioritizing
  target selection.
- **Mirror wraith** — mimics the player's own staff abilities.
- **Depth-tier bosses:** a *unique boss every 10 floors* (floor 20, 30, …)
  rather than reusing the Warden — a boss per biome.

### Biomes

The five bands already have their own surfaces, light, drone, monster mix,
dressing and reagent. Next: an environmental gimmick per band (rising
water, forge vents, singing crystal that answers spells) and a boss of its
own.

### Items & builds

- More staffs = more playstyles (channeled beams, lobbed grenades, melee
  staves, summons). Each is one catalog entry + optionally one ability entry.
- Deeper rarities: cursed trade-offs, suffixes — the affix layer already
  carries up to two enchantments (arcane) and named legendaries.
- Set bonuses across slots.
- More consumables (scrolls, bombs, buffs) — each is one catalog entry; the
  belt/merchant/provenance plumbing is already generic, and a brew is one
  recipe row. Keep crafting's vocabulary at seven materials: a new recipe
  should spend what the bands already give.
- Richer merchant stock for deeper wizards.

### Systems

- **More room events** — each is a catalog row, a rule and a view: a
  trapped corridor run, a caged prisoner (a wizard's echo) to free, a
  wager stone.
- **Pings and emotes** in the deep, so strangers can coordinate without
  typing.
- **More of the Proving Ground**: hall plans beyond the three, fellowship
  against fellowship, a ladder read from Varr's ledger.
- **Persistent meta.** Village upgrades, cosmetic unlocks, wizard identity
  beyond a name.
- **Trading** between wizards (dropping loot already gifts it).
- **Full server authority** (see tech section) as the game scales.

### Audio

Raytraced acoustics, placed sounds and the world's voices are in (see §2).
Rooms ring on their own and are heard through their doorways. Next:
per-staff cast timbres, musical stingers on boss phases, and height in the
acoustics (pits, ledges, the vault's shape).

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
  core/        config (all tuning numbers), seeded RNG, typed event bus,
               the presentation clock (hitstop, slow motion)
  run/         run rules: the Weighing, the Tithe of Five, bank/death outcomes
  items/       catalog, item levels & power, affixes, loot tables, economy,
               inventory grids, loot-orb manager, materials & crafting
  world/       gen/ (staged pure generator), biomes, omens, lore, props, traps
  roomEvents/  vaults, ward circles, shrines, fountains (pure rules + net)
  enemies/     roster data, shared enemy shell, pure brains/, kinds/, the
               living body (puppet, wounds, wind-ups, doom), corpses/
  weapons/     spell catalog, cast kinds, projectiles, explosions, singularity,
               allegiance (who may hurt whom), cast replay, precision hits
  combat/      the shooter's feel: confirms, numbers, hitstop, momentum
  encounters/  pacts, presence sense, kill credit, grave chests
  social/      chat, fellowships, the camp seat
  arena/       the Proving Ground: rules, the hall, the yield, the bout
  net/         protocol, matchmaking (tension clock), fellowships, the
               obelisk's queue, transport, session, synced clock,
               snapshots, channels, entity replication, wizard poses,
               remote wizards + collision capsules, peer vitals
  state/       zustand game store, codex, save persistence
  player/      input, first-person controller, staff viewmodel
  fx/          shader particle system + named effects, ambient air, torch
               flames, dynamic light pool
  audio/       procedural WebAudio synth; raytraced acoustics, a pool of
               placed voices, the world's own voices
  render/      textures/ (pure painters + normal/emissive/roughness maps),
               models/ (every mesh), post-processing
  scenes/      village, dungeon floor, floor atmosphere, canvas composition
  transition/  portal journeys: enter pull, vortex tunnel, the fork, arrival
  ui3d/        the in-world UI: pixel font, rune text, tablets, item models,
               the HUD, menus, inventory, guild board and Varr's tablet as
               physical things
  ui/          the DOM leftovers: perf overlay, build stamp, dev room
  game/        cross-system registries and seams (hostility, floor rules,
               damage sources, interactions, player-state, targeting), the
               vitality rules and the one heart
server/        Bun WebSocket game server (relay: floors, the camp, bouts;
               accounts, provenance, crafting, the ledger)
```

**Cross-system glue** avoids React prop-drilling and expensive scene queries:
a `Hittable` registry (everything damageable), a dynamic-body registry
(everything the shockwave can shove), an interaction arbiter (nearest prompt
wins the E key), and a typed event bus (`core/events`). Combat iterates
registries; it never walks the scene graph.

### Multiplayer model: host-authority per instance

This is the most important networking decision, so it's worth stating plainly:

- Each floor instance has a **simulation host** — its first joiner. The host's
  simulation of **enemies, props, the boss, loot and room events** is the
  authoritative truth. Everyone else runs **predicted replicas**: real
  dynamic bodies that the framework steers toward timestamped snapshot
  buffers on a server-synced clock (velocity-aware hermite interpolation,
  ~90 ms behind) — so your
  blasts knock things back and your body shoves crates *instantly*, while
  authority reconciles underneath. Every wizard also has a collision capsule
  on every machine, so a joined player's pushes are real in the simulation
  that matters. Discrete events (deaths, breaks, boss attacks) replay as they
  arrive.
- The **server is a relay + matchmaker blind to the floor's world** that
  *enforces* authority purely by channel-name prefix (`a:` host-only, `h:`
  to-host, `p:` peer broadcast). It never learns what an enemy or an orb
  is, so new features on a floor (room events, the feel pass) never touch
  it. It does not simulate the world (yet). What it does own is the bank
  (accounts, provenance, the merchant, crafting), the social rooms (the
  camp, chat, fellowships) and the Proving Ground's line, clock and score.
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
  fight → loot → the rift forks: deeper, or home once five floors are paid
  — or die and lose (or, on a shared floor, leave a grave).
- Item levels (gear potency and health wards scale with depth), gear-level
  entry, the Tithe of Five — enforced server-side.
- Crafting: seven materials, per-item attunement, Wenna's cauldron (nine
  brews) and Brannoc's forge (temper, enhance, imbue, reforge, salvage, the
  Great Work), server-validated with the server's dice.
- Room events: vaults, ward circles, shrines (five bargains) and fountains,
  run by the floor's host and synced to late joiners.
- The shared camp: up to twelve wizards a camp, chat (room and
  fellowship, speech over heads), fellowships by runes or invitation that
  travel together, pacts that become fellowships.
- The Proving Ground: Varr's obelisk and line, bouts of 2–6 in a
  symmetric hall built from the dungeon's own stone, to the yield (first to
  ten, or three minutes), the server's clock and scoreboard, and the record
  on your account.
- The feel pass: the knee on every bar, last stand and the Brink; hit
  confirms, hitstop, damage numbers, precision hits, rune-word streaks,
  weighty casting; living bodies (springs, wounds, wind-ups, death's door,
  zero-ping death throes) and per-kind deaths; the one heart, the muffled
  world, the colour bleeding to red, the Destiny boss bar, life marks, and
  floor-mates' last stands.
- Five depth biomes (own surfaces, light, drone and monster mix), six omens,
  ~75 lore carvings and the codex, and the camp's voice lines.
- 100-floor procedural generation with difficulty scaling and boss floors.
- Movement, all four equipment slots, the full ability/enemy/boss/prop set
  listed above, procedural audio, the dynamic-light look.
- The full inventory & economy layer: bag + reagent pouch + Q/E belt +
  village chest, the inventory screen (live 3D wizard, drag & drop, stat
  comparison arrows), gold drops with auto-pickup, enchanted, arcane and
  legendary gear, the village merchant (buying AND selling), the Orb of
  Fortune gamble, potions and elixirs, and the Feather of Safe Passage.
- Real online multiplayer: rare same-floor encounters (tension clock),
  presence sense, pacts and wizard-vs-wizard combat, kill credit, grave
  chests, host-authority replication of enemies/props/boss/loot/graves/
  room events, late-join sync, host migration, reconnect into the same
  instance; accounts in the Wizard's Ledger (guests, or a username and
  password that follow you to any browser).
- The look ("gritty pixel-magic"): five biomes of painted pixel-art
  surfaces with their own colour grades, 6 m halls with arched doorways,
  ribs, pillars and set dressing, fog, light shafts and ambient air; pixel particles for every effect; rift portals and
  portal journeys for every scene switch; and the whole UI in the world in
  the grimoire style (rune text in pixel fonts, framed stone-tablet menus,
  the framed HUD, 3D items).
- Persistence of the deepest floor, banked inventory + gold, the Proving
  Ground record, player name, and the shadows / reflections quality
  toggles (localStorage cache; server-authoritative online — including gold
  provenance, merchant purchase validation and crafting), in a data file
  written atomically with rotating backups.

**Not done yet / known gaps:**

- Reconnect returns you to your old instance while it exists (an empty
  instance lingers a minute, then it's gone).
- No full server authority (host is a client; a laggy/cheating host affects
  its instance).
- Content breadth is still modest: 16 staffs and 25 gear pieces in all (8
  of them legendaries), 4 enemy types + 1 boss (the same Warden in every
  biome), 4 room events.
- PvP damage is decided on the victim's machine (like all player damage), so
  a hacked client could ignore it — and in the Proving Ground, refuse to
  report its falls; a cast's origin is sanity-checked against the caster's
  pose, and a yield can only be credited to a wizard in the bout.
- No persistent meta-progression beyond banked gear, the deepest floor, the
  codex and Varr's ledger.
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
| E | Interact (the rift, loot, graves, carvings, room events, the camp's stations); otherwise use belt slot 2 |
| F | In the deep, near another wizard: offer / accept / break a pact. In the camp: invite the wizard beside you to your fellowship, or accept an invitation |
| Enter | Speak to your room; `/p ` first speaks to your fellowship |
| Q | Use belt slot 1 |
| I (or Tab) | Inventory screen |
| C | The codex (lore carvings read) |
| M | Cast the map (on the ground, shared with the floor) |
| P (or F3) | FPS / frame-time overlay |
| O (or F4) | Toggle shadows (quality option, off by default) |

In the fork of a rift: turn toward a way (or A/D), and click, E or Space to
take it.

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
