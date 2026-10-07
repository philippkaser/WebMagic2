# Architecture

## Overview

The client is a Vite + React Three Fiber app. Systems are deliberately split
into three tiers so the game can grow into a large online title without
rewrites:

1. **Pure logic** (no DOM, no three.js, no physics): `core/`, `run/`,
   `items/`, `world/gen/` + `world/{biomes,omens,lore}`, `net/matchmaking`,
   `enemies/brains/` + `enemies/roster`, `weapons/{spellCatalog,allegiance,
   castMessage,hits}`, `encounters/{pacts,graveRules,killCredit}`,
   `render/textures/painters/`, `fx/particleSim`, `transition/timeline`,
   `ui3d/font/`. Deterministic, unit-tested with `bun test`, and safe to run
   on a server.
2. **Runtime state**: the zustand store (`state/gameStore.ts`) owns the game
   flow (menu → village → dungeon → death), equipment and run-loot rules.
   Frame-hot data (player position/velocity) lives outside React in
   `game/player-state.ts`; cross-system lookups (what can be hit, what can be
   shoved) live in `game/registry.ts`. Small import-free **seams** in `game/`
   let layers talk without depending on each other: `hostility.ts` (what is
   that wizard to me?), `floorRules.ts` (how does this floor bend the
   numbers?), `damageSource.ts` (who hurt me?).
3. **Presentation**: R3F components render whatever tiers 1–2 decide. They
   register themselves into the registries on mount and clean up on unmount.

## Determinism & floor sharing

A floor is generated purely from `(instanceSeed, floorNumber)`. The server
(today: the local loopback "server") only ever ships a seed — every client in
an instance generates byte-identical geometry, torches, props, enemies and the
treasure item locally. This keeps floor payloads tiny (a handful of bytes) no
matter how large floors get, which is the key to supporting many concurrent
players cheaply.

Anything gameplay-relevant that must match between players is rolled from the
seed (world layout, treasure). Cosmetic-only randomness (particle jitter,
personal loot drops) uses `Math.random`.

## Multiplayer design

### The encounter rule

`net/matchmaking.ts#FloorDirectory` decides who meets whom:

- Only wizards on the **same floor** can ever share an instance (max 4).
- Entering floor N **rolls an encounter**: success joins an existing,
  occupied instance of N with room (fate picks which); failure — or nobody
  else on N — opens a **private instance with a fresh seed**, which a later
  entrant may walk into.
- The odds follow a **tension clock** (`core/config.ts ENCOUNTERS`): 12% on
  the first floor, +12% for every floor walked alone, capped at 60%, reset by
  a meeting. Rare, but every quiet floor makes the next one feel loaded.
- **Reconnects bypass the roll**: the relay remembers each account's last
  instance and passes `preferInstanceId`, so a dropped wizard returns to the
  same world, not a fresh one.
- `ENCOUNTER_CHANCE=1` on the server forces meetings (local testing).

Pure class with injected seed/clock/dice — `matchmaking.test.ts` is the spec.

### The networking stack (src/net/)

```
game code ──► declarative APIs            framework internals
              ├─ useNetBody(spec)          entities.ts   snapshot capture/apply,
              │    (enemies, props, boss)                commands, despawns, world sync
              ├─ hostEvent / hostCommand /  channels.ts  typed messages over opaque
              │  peerMessage (loot, casts)               relay envelopes
              └─ publishLocalPose /         players.ts   wizard pose buffers
                 estimatePeer / samplePeer
                       │
                  session.ts  connection, reconnect, ping loop, netBus
                       │
                  Transport (interface)
                    ├── WebSocketTransport → server/ (default)
                    └── LocalTransport       (offline fallback)
```

**The server is gameplay-blind.** `net/protocol.ts` defines only matchmaking,
host designation, clock pongs and one opaque envelope type. The entire
authorization model is a channel-name prefix, enforced by `server/relay.ts`:

- `a:` **authority** — only the instance host may send (snapshots, despawns,
  world sync); relayed to the instance or to one member via `to`.
- `h:` **to-host** — anyone may send; delivered to the current host only
  (hit requests, pickup requests).
- `p:` **peer** — anyone may send; broadcast to the rest of the instance
  (poses, ability casts).

Adding a networked feature = declaring a typed message client-side
(`hostEvent`/`hostCommand`/`peerMessage`) or registering a `useNetBody` /
sync provider. **The server and protocol never change again for gameplay.**
`relay.test.ts` is the spec for the relay rules.

**One shared timeline.** The server stamps every relayed envelope with its
clock; clients estimate the offset from ping/pongs (`net/clock.ts`, lowest-RTT
samples win). Authoritative motion is targeted ~90 ms in the past: snapshots
land in timestamped buffers (`net/snapshots.ts`) and are sampled with
cubic-hermite interpolation using the sender's velocities — arcs stay arcs at
20 Hz — with short capped extrapolation past the newest data.

**Predicted replicas (the "pure client feel").** Replicated entities are NOT
kinematic puppets — they stay **dynamic rigid bodies** on every machine, and
each frame the framework *steers* them toward the buffered authoritative pose
with corrective velocities (`net/steering.ts`: velocity = target velocity +
error × gain, capped; hard-snap only past a 2.5 m error budget; bodies at a
still target are left alone so they can sleep). Because replicas are real
dynamic bodies, local physics acts on them instantly: your blasts shove them
(`predictImpulse` applies the knockback the moment your shot lands, while the
authoritative `hit` command travels), your capsule pushes crates like in
single-player, and the steering leash goes *soft* for a round trip whenever a
prediction is in flight or the local player is close enough to be interacting
— so authority reconciles underneath instead of fighting you. Every other
wizard also has a kinematic **collision capsule** (`net/PeerBodies.tsx`)
driven by their extrapolated pose, which is what makes a replica's shove real
in the host's authoritative simulation (and lets enemy bolts detonate on any
wizard, not just the local one).

### Host-authority replication

Every floor instance has a **simulation host** — its first joiner, promoted
in join order when the host leaves (`hostChanged`, epoch-stamped). The host's
simulation of enemies, props, the boss and loot is the truth; the relay
*enforces* authority (`a:` traffic from non-hosts is dropped). Offline play is
simply "always host", so single-player runs the exact same code path — and
`hostCommand.request()` dispatches locally on the host, so gameplay call
sites have **no host/replica branches at all**.

| Synced | How |
| --- | --- |
| Floor layout, torches, spawn tables | deterministic from instance seed |
| Player pose (pos/vel/yaw/pitch/staff), names | 20 Hz `p:pose` + buffered interpolation, plus a collision capsule per peer |
| Player ability casts | `p:cast` replay (cosmetic vs entities) |
| Enemy/boss position & velocity & hp | 20 Hz delta-filtered `a:snap`; predicted dynamic replicas steered by corrective velocity |
| Prop position **and rotation** | same snapshots with quaternions — tumbling replicates; resting props go silent |
| Deaths & prop breaks | `a:despawn` lifecycle events (silent replay for late joiners) |
| Sentry/boss shots, boss slams | `hostEvent`s replayed everywhere (real on host, cosmetic elsewhere) |
| Loot drops & pickups, floor treasure | host-granted `hostCommand`/`hostEvent` — an orb can never be taken twice |

**Damage authority rule:** exactly one simulation may damage an entity — the
host's. A replica's own shots apply damage via a `hit` command to the
authority (shooter-favored, like most netcode); every *replayed* explosion is
`remote: true` and skips entity damage entirely. Your own health is always
local: contact burns and incoming blasts hurt each player on their own
machine, so your survival never waits on a round trip.

**Enemies threaten everyone:** host-side AI (wisp aggro/chase, sentry
targeting, boss aim and wake) picks the **nearest wizard on the floor**
(`game/targets.ts`), not the host's own player — and taking damage from
anyone wakes an enemy immediately. Peer poses carry velocity, so
**shot-leading works against every wizard**, not just the local one.

**Late-join world sync:** joining a floor mid-fight would otherwise generate
the pristine layout — immortal "ghost" enemies the host already killed. On
every join the server asks the host for a world sync: dead entity ids
(expected layout ids minus living registrations), current snapshots, plus
whatever **sync providers** systems registered (live loot orbs, treasure
state — new systems just register one and are covered). The joiner applies it
silently, with a pending-despawn buffer for entities that haven't mounted yet.

**Host migration:** replicas are already dynamic bodies carrying real
velocities, so when the host leaves, the promoted client simply stops being
steered and its AI resumes — mid-fight, no body flip, no reload. Epochs
identify stale-host traffic.

**Reconnect:** a dropped socket triggers automatic reconnection and re-entry
into the current floor; the normal join path resyncs the world. If the server
stays unreachable the session falls back to offline seamlessly.

**Path to server authority:** move the host role into a headless process
that speaks the same protocol (it's just another "client" the server always
designates as host). The replication core (`entities.ts`, `snapshots.ts`,
`clock.ts`) is pure logic with injected I/O precisely so it can run there.
Nothing else changes.

### Accounts & server-side persistence (the anti-cheat foundation)

**Rarities ride inside item ids.** An enchanted item is `"defId+affixId"` —
one opaque string. Because every server-side rule (grants, provenance
multisets, banking, selling) already operates on opaque id strings, the whole
rarity system needed no protocol or server changes: the host attests the
exact rolled id, and it banks/sells/trades like any other item.


The server owns four things a client must never be trusted with — while
staying gameplay-blind (item ids are opaque strings; it validates
*provenance*, never meaning — the only "meaning" it borrows is the shared
pure price table and feather id from `items/economy.ts`, the same way it has
always known the starter-gear ids):

1. **Identity** — `login` presents a device token (or none, minting a fresh
   account). The token comes back with the save and is kept client-side
   (`webmagic.token.v1`). Real auth (email/OAuth) later replaces only the
   token-minting step. (`server/accounts.ts`)
2. **Saves** — deepest floor + the full banked inventory (equipment, Q/E belt,
   5-slot bag, 30-slot chest, gold) live server-side; the client's
   localStorage is a cache of the last `loggedIn`/`saved` payload (and the
   full save of record when playing offline). Storage is a debounced JSON
   file today (`DATA_FILE`), flushed on shutdown; swapping in a database
   replaces one `persist` callback.
3. **Item & gold provenance** — the core rule: *an item may be banked ⇔
   previously banked ∪ starter gear ∪ granted this run by the floor HOST's
   attestation* (`grant` messages; the beneficiary can never vouch for
   itself, mirroring loot authority). Grants are a **multiset** — two granted
   potions are two bankable potions. Gold follows the same path via
   `grantGold` under sanity caps (`items/economy.ts#GOLD_RULES`). Banking
   (`bank` → `saved`) strips anything else; death (`died`) or quitting
   forfeits the run's grants. Three village/dungeon variants share the rules:
   - `stash` — village-only rearrangement (chest/bag/belt moves); must be a
     sub-multiset of the current save, so nothing new can enter this way.
   - `buy` — merchant purchase; the submitted inventory may contain exactly
     the bought ware on top of what's owned, paid at the shared economy
     price from banked gold.
   - `sell` — merchant sale; the sold copies must be provably owned and the
     credit comes from the shared `sellValue` table (no client-set prices).
   - `gamble` — Orb of Fortune; the SERVER rolls the item with the shared
     pure `rollGamble`, so outcomes can't be fished for client-side.
   - `escape` — feather exit from ANY dungeon floor, even before the tithe;
     same provenance as `bank`, never counts as a deepest, and only succeeds
     if a Feather of Safe Passage was provably owned and is now spent.
4. **Runs** — floor entry is validated against the account (run/rules.ts,
   shared with the client): a **fresh** run (`enterFloor { fresh: true }`)
   always lands where the account's *banked* gear resonates, whatever floor
   was asked for; a continuing run may only re-enter its floor (reconnect)
   or go exactly one deeper (portal, warp rune), counting `runFloors`.
   Anything else forfeits the unfinished run (like dying) and starts fresh.
   Banking (`bank`) is refused until `runFloors ≥ 5` — the Tithe of Five —
   and records the floor you are *actually matchmade into* as `deepest`.

Known limits, in honesty order: the floor host is still a client, so a
cheating **host** can attest bogus grants for its floor-mates (fix: headless
server-side hosts, the path above); item *stats* are client-computed (fix
follows server hosts); player-dropped items (`dropOrb` → pickup grant) leave
the dropper's server-side ownership intact, so a hacked dropper could keep
what an honest taker was granted — a small dupe window in the same trust
class as host attestation (closed by the same fix); grave chests ride the
same path (the dying wizard declares its losses, the host grants each
plundered copy); device tokens are bearer
secrets in localStorage (fine for a foundation, replaced by real auth). Rate
limiting and hit/pickup sanitization already run server-/authority-side.

### Scaling plan (server-side, future work)

- **Authoritative floor-instance processes**: each instance is an isolated
  simulation actor (4 players, its own enemies/props). Instances are trivially
  shardable across machines because they share nothing — the directory is the
  only coordination point.
- **Stateless gateways** terminate WebSockets and route by instance id.
- **The directory service** is a small consistent store (instance → members,
  seed). At 4 players/instance, 1M concurrent players ≈ 250k tiny records.
- **Snapshots**: server broadcasts 10–20 Hz instance snapshots (≤4 players +
  dirty entities); clients interpolate peers and predict themselves (the
  controller is already client-authoritative-shaped for easy reconciliation).
- **Interest management** is almost free: an instance *is* the interest set.
- Persistence (bank, run progress) moves from localStorage to the account
  service; `state/persistence.ts` is the single seam.

## Run rules (`run/`)

- **Item levels** ride inside item ids (`defId[+affix][@level]`,
  `items/itemId.ts`), so the opaque-id provenance stack needed no changes.
  Gear rolls at its drop floor ±1; ids without a level are legacy items whose
  level falls back to their catalog `minFloor`. `items/power.ts` turns levels
  into strength: a staff's level multiplies spell damage, other gear adds a
  health ward. Networked hit caps follow depth (`weapons/hits.ts`).
- **The Weighing** (`run/rules.ts`): gear level = mean item level over the
  four gear slots (empty = 0); entry floor = round(level × 0.85), clamped to
  1…95. Client and server call the same function.
- **The Tithe of Five**: every floor generates a way-home portal beside the
  exit (`FloorLayout.leave`); it opens once `run.floorsPlayed ≥ 5`.
- **Outcomes** (`run/outcomes.ts`): `bankKit` marks everything carried safe;
  `settleDeath` strips this run's loot (a lost run staff falls back to the
  starter) and returns what was lost, by id, for the death screen and graves.

## Wizard vs wizard (`encounters/`)

- **Hostility seam** (`game/hostility.ts`): `relationOf(id)` →
  stranger | ally | oathbreaker. Pacts install the resolver; everything else
  (weapons, peer capsules, name tags, presence) only asks.
- **Pacts** (`encounters/pacts.ts`, pure): wary → offered/invited → bound;
  one-sided breaks mark an oathbreaker; offers lapse after 20 s.
  `PactSystem.tsx` sends `p:pact` messages addressed to one wizard and binds
  the F key.
- **Victim-side damage**: a peer's cast replays on every machine
  (`weapons/CastingSystem.tsx`, with the caster's staff and a sanitized stats
  subset; the origin must be within 6 m of the caster's known pose). On the
  victim's machine, `weapons/allegiance.ts#localBlastEffect` decides: hostile
  wizard → damage × `PVP.damageMult` (0.55); own or allied magic → no damage.
  Your health stays yours, like every other hit.
- **Collision groups** (`core/config.ts GROUPS`): our capsule is
  PLAYER + LOCAL_PLAYER; a hostile peer's capsule adds PEER_HOSTILE and
  accepts FRIENDLY_PROJECTILE (our bolts burst on them visually); a hostile
  peer's replayed bolt is HOSTILE_SPELL (+ FRIENDLY_PROJECTILE for walls) and
  filters only LOCAL_PLAYER among wizards — it can hit us, never its caster.
- **Kill credit** (`encounters/killCredit.ts`): the last other wizard whose
  magic hurt us within 12 s is named on death.
- **Graves** (`encounters/graveRules.ts` pure + `Graves.tsx`): on a shared
  floor the store emits `wizardFell` while still on the floor; the dying
  client asks the host (`h:graveDrop`) to raise a grave with its losses; the
  host validates (known ids, stack caps, near the wizard) and announces it
  (`a:graveSpawned`). Plunder is `h:lootGrave` → `a:graveLooted` with
  index-stable picks, and the host attests each copy exactly like an orb
  pickup. Graves ride the world sync (`registerSyncProvider("graves")`) and
  survive host migration (every client holds the list).
- **Presence** (`PresenceSystem.tsx`): arrivals are announced without names;
  a hostile wizard within 24 m makes your heartbeat audible; name tags only
  show within 16 m (or always, for allies, who also wear a halo).

## Floor mood: biomes, omens, lore

- `world/biomes.ts`: five depth bands — each with its painted surface set,
  fog, backdrop, ambient light, torch colour, the player's lantern, a
  breathing glow, a split-tone colour `grade`, an accent (the spawn sigil's
  colour), a `look` (light-shaft tint, floor reflection strength) and enemy
  weight multipliers; the generator reads the monster mix,
  `scenes/floorAtmosphere.ts` and `DungeonFloor` the rest. The look of each
  biome comes from the "gritty pixel-magic" art direction (see Rendering).
- `world/gen/architecture.ts`: a generator stage on its own RNG stream (so
  layouts never shift) that plans pillars, arch ribs, light shafts and
  crystal clusters. For now only the light shafts are built — the dungeon
  is deliberately plain while its basic look and feel settle; the rest of
  the plan (tested to never block a path) is there to switch back on.
- `world/omens.ts`: ~28% of floors (never floor 1) roll an omen on their own
  RNG stream (so layouts stay stable). Omens carry `FloorRules` bends
  (gravity, enemy damage/speed/health, loot/gold, mana, explosion radius) and
  generation knobs (torches, fog, barrels, enemy count). **Rules are
  installed by GameScene together with the layout, during render**, because
  enemies read `enemyHealthMult` as they initialize.
- `world/lore.ts` + `world/gen/lorePlacement.ts`: ~55% of floors carve a
  rune (own RNG stream); `world/loreRunes.tsx` makes it readable, and
  `state/codex.ts` remembers what was read (localStorage — lore is personal,
  not loot).

## Physics & combat

- Rapier via `@react-three/rapier`. Collision groups (`core/config.ts#GROUPS`)
  keep friendly fire, enemy fire, props, the player — and hostile wizards —
  interacting correctly.
- **Enemies** (`enemies/`): `roster.ts` (data) → `useEnemy.ts` (the shared
  shell: health from roster × depth × floor rule, death FX and drops, hit
  routing, local contact damage) → a pure brain in `brains/` (unit-tested
  steering/state machines over plain vectors) → a presentational model in
  `render/models/enemies.tsx`. Each kind in `kinds/` is just that wiring.
- **Spells** (`weapons/`): `spellCatalog.ts` is the data (kind + numbers;
  tooltips are derived from them), `castKinds.ts` implements each kind,
  `projectiles.tsx`/`explosions.ts`/`singularity.tsx` do the physics. Void
  seeds are owned: a Collapse only implodes its caster's seeds.
- The player is a **dynamic capsule** (not kinematic) so the world can push
  back: enemy hits, barrel explosions and force blasts all shove the player.
  Movement is velocity-shaping: exponential ground acceleration, additive air
  control under a soft cap (momentum tech survives), coyote time, jump buffer.
- **Everything damageable registers a `Hittable`** (id, position, hit(dmg,
  impulse)). Explosions iterate the registry — no physics queries, no React.
- Projectiles are real CCD rigid bodies capped at a fixed pool size; their
  VFX (trails, flares, blasts) go through `fx/effects.ts` (see Rendering →
  Particles); explosion light comes from the dynamic light pool (`flashLight`).

## Rendering

- **Zero binary assets** (one exception: the UI's four pixel fonts, from
  @fontsource): every texture is painted at startup by pure painters
  (`render/textures/`) as deliberate pixel art — 5–6 tone palette ramps,
  running-bond masonry with dark mortar, Worley flagstones, weathering
  layers (grime bands, cracks, drips, moss curtains, tide lines, puddles)
  and tiny emissive specks (lume, embers, veins, runes) — each with a
  roughness map and a normal map from its height field. Every biome's walls
  are whole painted compositions (moss from the vault, tide line at the
  foot) in a few variants; `NearestFilter` everywhere. `getSurface(kind)`
  returns the maps plus the material settings they were tuned under.
  Models live in `render/models/` as presentational components; behaviour
  stays in world/enemies code.
- **Stonework is one mesh** (`render/models/DungeonStone.tsx`): 6 m walls
  (64 × 192 px textures, so texels stay square) in one draw call; physics
  colliders are greedy-merged rectangles (tested to cover every wall tile),
  so collider count stays low as floors grow.
- **The spawn sigil** (`RuneCircleModel.tsx`): a painted rune circle under
  every arrival, in the biome's accent, slowly turning.
- **Reflective floors** (`render/models/DungeonGround.tsx`): an optional
  planar reflection (quality flag `reflections`, default OFF — the painted
  floors read best matte with roughness glints). It uses drei's reflector
  shader with our own mirror camera and render targets (drei's component
  leaks four targets per mount — one per descent).
- **Light shafts** (`LightShaftModel.tsx`): additive cones of dusty light
  falling from ceiling cracks, tinted per biome.
- **Lighting — the dynamic light pool** (`fx/DynamicLights.tsx`): forward
  rendering pays per-fragment cost per light, and *changing* the light count
  recompiles every shader in the scene. So the game mounts exactly 14 pooled
  point lights, once, forever. Everything that glows registers a light
  *source* — torches, portals, loot orbs, the treasure pedestal, the boss,
  flying projectiles, explosion flashes — and each frame the pool assigns its
  lights to the best-scoring sources near the camera (priority class +
  proximity + a stickiness bonus against slot flicker). Distant sources
  degrade gracefully into the fog. Result: more things cast light than a
  naive approach could afford, with a *lower* and perfectly stable light
  count and zero mid-game shader recompiles. The only real lights outside
  the pool are the player's shadow-casting staff light and the village moon.
- **Resolution IS the pixelation**: the world renders at about 340 lines
  and the browser upscales it with `image-rendering: pixelated`. That one
  decision cut measured frame time ~5× — every light, normal map and post
  pass pays ~1/8th the fragments — and replaced the pixelation post-pass
  outright. The scale is a whole number of device pixels per world pixel
  (`render/pixelGrid.ts`), picked per display so the line count stays in a
  narrow band (≈320–380 on common screens, every player about the same
  chunkiness); a fractional scale (the old dpr 0.35 gave 2.86) made most
  columns 3 px and some 2, which crawled as you turned. The canvas box is
  sized to exactly width × scale device pixels, overhanging the window by
  under one world pixel, cropped evenly.
- **Particles** (`fx/`): one CPU simulation (`particleSim.ts`, pure and
  unit-tested: a dense struct-of-floats pool of 8192, swap-remove, zero
  per-frame allocation) streams four instanced attributes into ONE draw call
  (`particleMaterial.ts`), drawn in the pixel-magic look: crisp, hard-edged
  chunks of colour on the render target's pixel grid, never soft blobs.
  Chunks big enough on screen are real little tumbling cubes with three
  stepped face tones; everything else is a grid-snapped sprite a whole
  number of pixels wide — squares with a 1-px rim, stepped octagon glows,
  pixel chains for sparks, stepped rings, plus-shaped star flares. Fades
  never blend: small sprites pop out whole, glows burn down in whole pixels,
  smoke erodes in an ordered dither, so every fragment is either opaque or
  pure added light and premultiplied blending lets light and matter share
  the call. Smoke, dust and debris are lit by the same pooled lights as the
  walls (`fxUniforms.ts` mirrors the pool) and everything respects fog.
  Gameplay code calls named effects (`effects.ts`: `explosionFx`,
  `shockwaveFx`, `castFlareFx`, `boltTrailFx`, `blackHoleFx`, `hitSparksFx`,
  `soulDissolveFx`, `shatterFx`, …), which thin themselves out as the pool
  fills; `spawnBurst()` remains for simple bursts (`style` picks the look).
  Torch fire is a stepped pixel flame in hard colour bands (`Flames.tsx`,
  one instanced call for every torch); the air of each biome is
  `AmbientParticles.tsx` — single pixels animated entirely on the GPU in a
  box that follows the camera (dust, spores and drips, embers and ash,
  glints, village fireflies; the Weightless Hour makes it all float up).
- **Post chain** (`render/Effects.tsx`, effects in `render/post/`): an old
  dungeon crawler's pixels and colour with modern light. Three passes at the
  world's low resolution:
  1. god rays (`render/godRays.ts`, see below): marched light, stepped and
     dithered;
  2. the lens (`post/LensEffect.ts`, one pass reading depth): **depth of
     field with bokeh** — the focus is metered at the middle of the view on
     the GPU (a cross of depth taps, the staff and sky ignored, 1×1
     ping-pong racked over ~0.2 s), the circle of confusion is
     |1/focus − 1/distance| × aperture (capped at 4 render px; the held staff
     always sharp), gathered in one pass with Dennis Gustafsson's
     golden-angle spiral (a sample counts only if its own blur reaches
     this pixel), so bright things out of focus open into round discs; the
     whole world drops out of focus behind a tablet (title, Weighing,
     inventory family, codex, death); a setting, `depthOfField`, key B —
     and the forge's **heat shimmer**;
  3. one merged pass: `post/GradeEffect.ts` owns the bloom (mipmap blur)
     and lays the glow down like the god rays — the light wrap in a few
     perceptual (√) steps with the 4×4 Bayer dither between, nothing in the
     faintest air — then eye adaptation (centre-weighted log-luminance
     meter, 32² mip chain → 1×1 ping-pong, fast toward light and slow into
     dark, half-way and within ±½ EV of the place's `air.eye`), the
     split-tone grade, a per-channel filmic shoulder instead of the hard
     clip, colour drained by a blow or near death → `post/FilmEffect.ts`: an
     oval vignette tinted with the place's darks (breathing in the Hollow,
     closing with the heartbeat near death) and **15-bit colour through the
     4×4 ordered dither**, in display space on the pixel grid, fading to
     plain rounding at black so the deep dark stays ink.
  One dither runs through all of it: the god rays, the glow, the colour and
  the dithered particles share the same Bayer matrix. Each biome sets its
  `grade` and `air` (shimmer, breath, vignette, eye) on arrival
  (`setGrade`) and they ease in over a second; the village has its own
  (`VILLAGE_GRADE`, `VILLAGE_AIR`). The body's kicks — `shake` and
  `playerHurt` events, health — are kept by `post/feel.ts` (pure, tested).
- **Shadows are a quality toggle** (F4 / main menu, persisted, default off):
  a shadow-casting point light re-renders the scene six times per frame,
  measured at roughly +50% frame time even at low resolution.
- **F3 overlay** shows fps / p95 / worst frame for perf reports.

### The camp above (`scenes/village/`)

Riftwatch is laid out in one table (`layout.ts`): the structures' footprints
(tents, the command pavilion, the watchtower, the wagon), the fixtures, the
palisade arc and `groundHeight` — so the scene, its colliders, the floor
map and the acoustics all see the same camp. `Camp.tsx` bakes every static
part into world space and merges per material (the whole camp is a handful
of draw calls); `Wilds.tsx` is the land outside (one displaced terrain mesh,
flat where you walk, the forested slope north) and ~1,100 instanced pines;
`FloorPillar.tsx` is the depth stone (its face a 32 × 56 canvas texture
drawn in the pixel fonts, sized to the world's own pixels, re-cut when your
gear changes the entry floor).

- **The backdrop is at infinity** (`Sky.tsx`): the dome, the stars, the
  moon, the great range and the near hills ride along with the camera
  (they translate with it, never turn), write no depth and are drawn first
  — so the sky never clips against the far plane however far you walk, the
  world always draws over it, and the mountains keep their size the way
  real ones do.
- **The great range is real relief** (`skyline.rangeHeight`, tested): a
  ridged-multifractal heightfield in a ring 44–94 m round the eye (domain-
  warped so the aretes wander and run in toward you), shaped by an envelope
  — low round the valley, high in the north, two titans either side of the
  moon reaching ~30°, a saddle under it that hides the moon's foot. Meshed
  as a polar grid ordered outermost ring first, so without depth the nearer
  ridges paint over the farther. Flat-shaded facets: dark rock, snow on the
  gentle high faces, moonlight raking across from behind and the side so
  every ridge has a lit and a shadowed flank, the sky lighting what faces
  up — stepped in gamma — then the air: deeper blue with distance, mist at
  the feet, darker where backlit against the moon. The near hills are a
  crest in angles with a pine fringe (`hillsCrest`).
- **The moon** is about 13° across, its face tinted by the air it's seen
  through and bright enough to bloom; a halo drawn over its limb softens
  the edge into the sky (a hard edge reads as near), with a wide smooth wash
  beyond.
- **God rays** (`render/godRays.ts`): screen-space light scattering, one
  pass at the world's resolution. Each pixel marches toward the moon's place
  on screen gathering *sky* light — pixels with no depth (the backdrop) that
  are bright (the moon and its glow) — so the ranges, the forest and the camp
  cut the light into shafts; stepped and dithered like everything else, and
  kept off the moon's own face. A scene turns it on with `setGodRays` (the
  camp) and off with `clearGodRays`. From the side, long additive moonbeams
  (`MoonShafts.tsx`) slant down from the moon's direction across the camp.

## Sound (`audio/`)

Every sound is synthesized (`sound.ts`, `voices.ts`) and, unless it's a
UI blip, heard through a small raytraced acoustics model:

- **The level as sound sees it** (`acoustics.ts`, pure and tested): an
  `AcousticGrid` of solid/open cells — the dungeon's tiles (2 m, rock past
  the edge, a 6 m vault), or the camp in 2 m cells with the tents and the
  wagon solid under an open sky. Rays are traversed cell by cell
  (Amanatides–Woo).
- **The room** (`analyzeRoom`): 48 rays from the listener, each bouncing
  four times off the walls like a mirror (the approach of Vercidium's
  raytraced audio and the Godot `raytraced-audio` addon). The mean flight
  between walls is the plan's mean free path (π·A/P); with the vault that
  gives the room's own 4V/S, and Sabine (RT60 = 0.04·mfp/α) with the
  biome's absorption gives the reverb time — tuned for play, about a
  second in a mid hall, half that in a corridor, capped at 2.4 s. The share
  of bounce points that can still see the listener is how much of the
  room comes back (its wetness); rays that fly off (sky, halls longer than
  hearing) are lost, and where they went leans the ambient air. The first
  two bounces of every ray are kept as **probes** for hearing round
  corners.
- **The tail** (`impulseResponse`): a stereo impulse response generated to
  match — noise in three bands, each decaying at its own rate (the lows a
  little longer, the highs much sooner, sooner still in a dark biome),
  each side its own noise, the echoes thickening in over the first tens of
  milliseconds, **normalized to unit energy** so the send and return alone
  set how loud the room is. `spatial.ts` keeps two `ConvolverNode`s
  (`normalize = false`) behind a 160 Hz highpass, and crossfades a new tail
  in on the idle one when the (quantized) room changes — only once the
  last crossfade is done, so the one being replaced is silent; tails are
  cached. There are no discrete early-reflection taps: short single delays
  summed with the dry sound comb-filter it (and glide in pitch as their
  lengths change), which is what made the first version sound metallic.
- **How a sound reaches you** (`soundPath`, `hearing`): in plain sight,
  straight. Else the way round — a Dijkstra flood from the listener's cell
  (cached until the listener crosses into another cell, so every source on
  the floor is answered from one flood; costs in float64, as the heap's
  keys — in float32 a diagonal step looks stale and whole regions went
  unheard), the cell path pulled taut through the openings. The sound is
  placed where it SEEMS to be: in the direction of the first opening, as
  far away as it travelled. `hearing` folds that into a **clarity** (1 in
  plain sight): edge diffraction costs more the further the path bends
  (a quarter turn leaves under half), and the room's probes that can see
  the source give some back (a wide arch carries more than a crack). No
  way round within 60 m: a thud through the rock. Points inside a wall
  (the camera brushing one, a torch on its bracket, the grace round a
  tent) are first moved just out of it (`openPoint`).
- **Rooms ring on their own** (rooms & portals, as in Wwise): the
  dungeon's generated rooms are **zones** (`AcousticGrid.zones`; corridors
  and the village green have none). A room with something sounding in it,
  or you in it, gets a reverb tail of its own, measured at its middle —
  four tails in all: the local one (measured where you stand, crossfading
  as you walk, for corridors) and three for rooms, handed out as needed and
  retuned only once one has rung out in a room nobody's in. A sound sends
  to the room it's in, wherever you are (and a little to the space you're
  in); your own sounds and corridor sounds ring where you are. From
  outside, a room's tail reaches you through its nearest way in
  (`zoneHearing`: the nearest cell of the room by the listener's flood,
  heard as a sound standing there would be): leaning toward that doorway,
  muffled by the bend, and fading gently with distance (a doorway radiates
  the room's ringing as a whole, and the passages carry it: −5 dB 10 m
  down a corridor). So stepping out of a hall changes nothing at first —
  inside, your room's tail is that same tail, unpanned — and the hall
  fades behind you as you walk away.
- **Voices** (`spatial.ts`): a fixed pool of 24, each one sound reaching
  you the way sound does: input → **travel delay** (its distance at
  343 m/s — a far blast lands after its flash; the delay's slope as things
  move is real **Doppler**, its rate capped at 4% so a sound whose way
  round changes can't warble) → lowpass (the clarity, in octaves from
  320 Hz to 20 kHz) → **air** (a treble shelf, −0.3 dB a metre beyond 2 m)
  → gain (inverse distance from 2 m, less for clarity) → **behind** shelf
  (−10 dB of treble straight behind: torso and pinna) → then **each ear**
  (`binaural.ts`, a spherical head after Brown & Duda): its own delay
  round the head (Woodworth's ITD, up to 0.66 ms — measured 0.75 ms at
  low frequencies, as a real head's), its own head-shadow treble shelf
  (+6 dB facing the sound down to −20 dB in the shadow) and a little
  broadband level (±1.5 dB) → a channel merger. A sound has a **size**
  (radius: a footstep 0.15 m, a torch 0.25, a rift 1.2, a blast 0.6 of
  its radius, the dungeon's groan 6): by its angular size a share of it
  goes through a shared stereo **decorrelator** (velvet noise, 20 ms,
  different in each ear) instead — a point far off, all round you up
  close or inside it. On speakers (the title tablet's Headphones toggle,
  persisted) the ears' cues become an equal-power pan; the behind shelf
  stays. Your own steps fall under your left and right foot (±0.2 pan).
  Biquad parameters run at block rate and unchanged values aren't
  rewritten (an AudioParam left alone stops being automated), so the
  whole graph costs about what the plain pan did. Sends go to the tails
  (above): the room's answer is much the same level wherever the sound
  is in it (a diffuse field). Every frame each sounding voice
  glides toward its target — the apparent position swings round the
  listener on an arc (bearing and distance, never through your head), the
  clarity eases — and the audio clock, not timers, frees one-shots. When
  all are busy a new sound takes the quietest one-shot's voice if it's
  louder, else it's dropped (never moved into your head); torches and
  rifts (`emitterAt`) are never cut for a one-shot and re-trace as you
  move.
- **The mix**, measured with the audio lab (in the voice band, a mid
  catacomb hall): your own sounds ~15 dB over their echo, a sound 5 m off
  ~5 dB, one across the hall about level, one 25 m round the corners
  mostly room. `SEND`/`RETURN` in `spatial.ts` set it.
- **The listener** follows the world camera (`AudioWorld.tsx`, mounted in the
  world canvas), and the room is re-measured several times a second when it
  has moved. Sounds you make yourself go dry plus a room send (`selfOut`).
  The ambient beds' wind goes through the acoustics too (`ambientAirOut`):
  fuller in big spaces and under the sky, leaning toward the open side.
- **The world's voices** (`voices.ts`, driven by `AudioWorld` and the
  systems that own the events): footsteps per ground (the player's on
  each low of the view bob, landings by impact, floor-mates' every 1.7 m
  of their replicated poses), the five torches and rifts that reach you
  loudest as loops (`chooseLoops`: by the way sound travels, not as the
  crow flies — the torch behind the rock doesn't take the place of the one
  round the corner you just came from; one sounding keeps its place unless
  another is clearly louder), enemies waking, walking and dying (`useEnemy` — on every client,
  replicas walk too), and each place's own small sounds a few metres off
  where the grid is open.

Costs, measured: a room analysis ~0.03 ms; a hearing query ~0.01–0.15 ms;
a flood ~1 ms, only when the listener changes cell; a room's own
measurement once per floor.

**The audio lab** (`scripts/audio-lab/`, `bun run audio-lab` against a dev
server) renders scripted scenes on a generated floor through the real
audio code into an `OfflineAudioContext` (`context.adoptOfflineContext`),
stepping the scene every 1/60 s with `suspend()`, and writes WAVs — to
listen to, or to measure: the impulse scenes give direct-to-reverb
balance, decay times and comb ripple; the spatial suite gives what the
ears get besides loudness — `orbit` (ITD and ILD by frequency round the
head, front/back tilt), `distance` (arrival time, level, D/R, air, width
at 1–16 m), `flyby` (Doppler against theory), `size`, `spin` (a mouse
flick: no clicks), `leave-tone` (no warble round a doorway) and `stress`
(every voice busy: the share of real time it takes to render).

Measured (headphones, the hall): ITD 0 → 0.75 ms at the side; ILD
4.5 dB in the lows, 16 dB in the treble; behind 4.5 dB duller than in
front; arrival 4.5 → 48 ms from 1 to 16 m, treble tilt +4.7 → +0.4 dB,
D/R +12 → −3 dB, early IACC 0.88 → 0.69; a rift's IACC 0.75 at 4 m, 0.29
at 1 m; Doppler ±39 cents for 8 m/s (theory ±41); distortion under a
moving tone −65 dB; the stress scene at 26% of real time.

## Portal journeys (`transition/`)

Every scene switch is a journey you watch, drawn in the gritty pixel style
of the rifts themselves (ported from the artpass branch's warp): the view is
pulled toward the rift (FOV stretch, a slight roll, the gaze turned toward
the tear) while its tear rips open over the screen and you are sucked in;
you hover in a dark parallel world of blocky stars drifting past (sinking on
the way down, rising on the way home) while the next floor loads; then you
are spat out — the void kicks outward, surges into the rift's colour and
flashes — through a tear that rips open onto the new place. Death burns the
view away in chunky ember-red blocks instead; respawn rises out of that
black into the starry void.

- `timeline.ts` (pure, tested): per-kind styles (gate, descend, home,
  feather, death, respawn — colour, beats, drift direction), easing, and
  samplers that turn (stage, progress) into camera offsets and overlay
  parameters (iris, suck, rush, eject, reveal, …) — ARRIVE ends at an exact
  identity, so the FOV is always restored to the base 78°.
- `travel.ts`: `travel(kind, doSwitch)` plays ENTER, runs the store's scene
  switch under the TUNNEL (waiting for the new scene to render a few frames
  and at least one tunnel beat), then plays ARRIVE. The store's
  `enterDungeon`, `descend`, `walkHome`, the feather escape, death and
  `respawn` are wrapped in it; their logic and phases are unchanged. Dev:
  `__travel.freeze(stage, kind, p)` / `.preview(kind, p)` /
  `__previewTransition(kind, p)` hold a frame for screenshots.
- `TransitionSystem.tsx`: a camera system that runs after the player
  controller and layers FOV/roll/dolly on top (never leaking into
  mouse-look), and ONE fullscreen quad in the world scene — rendered at the
  world's own low resolution, so its blocks are the world's pixels, and
  bloom feeds on it. Pointer lock and mouse-look survive the journey — you
  land in control.
- Rifts (`render/models/PortalModel.tsx` + `RiftFrameModel.tsx`) are a
  jagged tear computed on a coarse pixel grid (hard stepped silhouette,
  ragged burning rim, a blocky star vortex seen through it, stepped
  palette), billboarded around Y and breathing, with a swarm of tetrahedron
  motes spiralling in and a rune dais framed by broken standing stones.
  The tear's silhouette lives in `transition/vortexGlsl.ts`, shared with the
  overlay, so the ENTER iris IS the rift tearing open over the view. Sealed
  rifts are a dim thin slit that flinches when tried and rips open when the
  seal breaks; the wound quickens and burns brighter as you approach.

## In-world UI (`ui3d/`)

There are no flat screens and no framed boxes: every menu is a physical
thing built in front of you. Tablets assemble out of worn, round-edged
stones; prompts, messages, tooltips, buttons and key caps are small slabs
of slate (or parchment) with rounded corners and a bevel that catches the
UI torch; text burns into them as runes that settle into letters and later
burn away into embers; items are small 3D objects. Colour is an accent
warming the stone, never a border: parchment text, arcane cyan for magic
and the way onward, gold for home, blood for danger.

- **Two canvases.** The world renders at ~340 lines (the pixel look); a pixel
  font rendered there would be mush. So a second, transparent,
  full-resolution canvas (`UiCanvas.tsx`) sits on top and copies the world
  camera every frame (`bridge.tsx` — R3F runs all roots in one loop in
  creation order, so there is no frame of lag). UI objects live in world
  space: prompts hang over the chest they belong to, menus and the arrival
  banner hang ahead of you. The UI canvas has its own torchlight so its
  stone reads as stone. It is click-through during play (the world canvas
  below takes the click that locks the pointer — `PointerLockControls` is
  scoped to `#wm-world canvas`) and catches the pointer while a menu is up.
- **Text** (`font/`, `text/`): four pixel faces (`faces.ts`, from the
  @fontsource packages — the one exception to "no binary assets"): Jacquard
  12 blackletter for the big moments only (`font="title"`: "Floor 12",
  "You Died" — blackletter turns to lace below ~3 % of the screen height),
  Jersey 15 for every smaller title (`"heading"`: biome, boss, item and
  panel names), Tiny5 for body text (`"body"`, the default) and Silkscreen
  for tiny caps labels (`"label"`),
  plus a hand-set fallback that also carries the sixteen runes and the UI
  symbols. Each face is rasterised once, with a hard alpha threshold, into an
  atlas whose channels hold the glyph, a halo and an outline; layout is
  proportional (`layout.ts`, pure and tested). `RuneText` draws one
  instanced quad per glyph with the whole lifecycle on the GPU (birth times
  per instance, a vanish time per block): one draw call per text block and
  no per-frame CPU work. Changed glyphs rewrite themselves alone (a ticking
  counter flickers one digit). `px` is 1/7 of the cap height in every face,
  so `pxFor(distance, fraction)` sizes them all alike. Pixel type only reads
  when a font pixel covers a whole number of screen pixels (at 1.4 a V turns
  into a W), so every frame RuneText projects one font pixel onto the screen
  and, once the text is still, eases its block onto the nearest whole number
  — holding its scale while it moves (a HUD stepping back, a tablet tilting
  in, a prompt you walk toward), with hysteresis near a boundary, so text
  never pops between sizes (`text/snap.ts` `stepSnapper`; at one
  screen pixel the dark outline drops to a trace — it would fill every gap).
  So that nothing lands a step away from its neighbours, sizes come from the
  **type scale** (`text/type.ts`: `typePx(distance, step, face)`, steps
  exact on an 800-px-high view — `STEP.text` ×2 for anything read,
  `STEP.lead` ×3 for numbers, the heading face at ×1/×2); the HUD's
  `fontPx` rounds its artpass sizes to the same steps. The small faces carry
  5-pixel symbols (▲▼◆…) of their own (`glyphs.ts` `SMALL_SYMBOLS`).
- **Choreography** (`presence.tsx`): nothing pops. `<UiPresence show exit>`
  keeps a subtree mounted while it plays its exit, and every toolkit piece
  (RuneText, Tablet, Plate, RuneButton, ItemModel) ANDs the ambient "show"
  flag into its own — a tablet closing burns off all its words for free.
- **Toolkit**: `theme.ts` (the palette; `holoColor` maps a look name to
  its accent colour), `slab.ts` (rounded, bevelled slab geometry and the
  slate/parchment materials), `Tablet` (round-edged stones fly in and lock
  into a rounded tablet), `Plate` (a small slab that pops in with an
  overshoot — `Pop` is the shared arrival), `KeyCap` (a parchment cap),
  `RuneButton` (a slab, "✦ label ✦", its accent glowing from within the
  stone, lifting on hover), `PixelFrame` (now only a faint engraved groove), `ItemModel` (every item family as primitives — also used
  for loot in the world), `ViewAnchor`/`WorldAnchor`/`placeInFront`, UI
  sparks and `audio/uiSounds.ts`.
- **The carried HUD** (`hud/rig.ts`, `HudAnchor.tsx`): every piece held in
  front of the eye — vitals, purse, belt, gear, location, the message feed,
  the free-pointer hint — hangs from ONE rig, stepped once per frame. It
  trails your turns on a soft spring (the lag grows with the turn's speed
  and eases into a ~3° cap, then settles with one small overshoot), swings
  in step with the view bob (`playerGait`, exported by PlayerController),
  leans against strafing and drops a little further than the eye on a hard
  landing. Yaw and pitch only — roll would twist the pixel art off its
  grid. Pure and unit-tested (`rig.test.ts`).
- **Layers** (`layers/`, listed in `UiRoot.tsx`): the message feed (framed
  plates carried at the left edge under the location panel, newest on top —
  never in the room, where you could walk into them), prompts, the HUD
  (`hud/`, deliberately sparse: five round-edged tithe stones and a
  connection gem at the top left, the tithe line showing only when it
  changes; the floor at the top right (`FloorInfo`: number, biome, omen —
  the omen's effects written out on arrival and while a map is cast); health and mana as two glass orbs (`orbMaterials.ts`: real
  spheres lit by the UI torch — the liquid a smaller sphere cut by a
  sloshing surface, its colour posterized and dithered per object-space
  cell; the glass broken into tiny facets, each tilted at random, so single
  pixels catch the torch as the orb slowly turns); the coin heap and the
  belt's potions floating bare; the staff's spells shown for a few seconds
  on arrival or a new staff; the arrival banner, which keeps its distance
  as you move and burns away early once you walk off), the menus
  (`menus/`: title, the Weighing, death, and the codex — a leather-bound
  tome) and the inventory family (`inventory/`: item slots are soft wells
  worn into the stone, their grade glowing up from the floor). The DOM
  keeps only what isn't part of the fiction: the perf overlay, the build
  stamp and the dev room.
- **The cast map** (`layers/map/`): M casts a miniature of where you are —
  the village whole, or the floor as far as you have explored it — laid on
  the ground a step ahead (`castSpot`: 3 m across, smaller if a wall comes
  first). Its light lives in the WORLD canvas (`FloorMap.tsx`, mounted by
  GameScene) so walls and wizards stand in front of it and it blooms with
  the world: a rune circle burns onto the floor, the floor under it dims,
  the tiles ripple out and walls, tents and standing stones rise as ribs
  of light (instanced, each born on its own beat), and markers kindle —
  every wizard on the floor (`net/players` poses), the way onward, the way
  home, the treasure and the Warden once seen. It carries no words (the
  floor's name and mood are the HUD's, top right). It lights the room
  round it (a pooled dynamic light, fx/DynamicLights). Folding gathers the
  whole map into its middle in one motion — shrinking with a slow swirl,
  brightening as it condenses — and it goes out in a spark and a flash of
  its light. Casts on stage (`useStagedCasts`) notice a fold in the same
  render, so a folding map is never remounted mid-fold. What it draws
  is pure data (`mapModel.ts`: `dungeonModel`, `villageModel`, `castSpot`,
  tested). Casts are per wizard (`mapStore.ts`): yours is sent to your
  floor-mates as a `peerMessage` carrying your explored tiles
  (`currentFloor.exploredBits` → their `mergeExplored`), so a map cast is
  also knowledge shared; a floor-mate's map stands on your floor until they
  fold it or leave. Walk 14 m away and a map lets go; M folds yours. The
  floor being played and what has been seen of it live in
  `world/currentFloor.ts` (shared with the UI canvas); `ExploreTracker`
  (in FloorMap.tsx) marks tiles a few times a second.
- **Floor tint** (`render/floorTint.ts`): the dungeon's surface materials
  (`wallMaterial.ts`, the reflective ground) get a shader stage after the
  painted map is read: the floor's seeded turn of the hue, plus a slow
  regional drift of hue, saturation and brightness in world space, and the
  same drift on the painted glow — uniforms only, set per floor by
  `floorAtmosphere.ts`, which also turns the fog, the ambient light and
  (with a per-torch jitter) the torches.

## Extending

| Want to add | Touch |
| --- | --- |
| New staff/amulet/cloak/boots | `items/catalog.ts` (data only) |
| New consumable | `items/catalog.ts` (`consumable` effect + `maxStack`); add to `items/economy.ts#MERCHANT_STOCK` to sell it |
| New enchantment affix | `items/affixes.ts` (data only — drops, display, banking, selling follow) |
| Depth scaling of gear | `items/power.ts` |
| Run rules (entry depth, floors before exit) | `run/rules.ts` (shared client + server) |
| Encounter frequency | `core/config.ts#ENCOUNTERS` |
| Economy tuning (prices, gold drops) | `items/economy.ts` (the one balance sheet, shared client + server) |
| New spell | a row in `weapons/spellCatalog.ts` (+ a kind in `weapons/castKinds.ts` if it's a new shape); reference it from a staff |
| New enemy | row in `enemies/roster.ts`, brain in `enemies/brains/`, model in `render/models/enemies.tsx`, kind in `enemies/kinds/`, renderer in `enemies/registry.tsx`, spawn weight in `world/gen/population.ts` |
| New prop | `world/props.tsx` spec + `render/models/PropModels.tsx` + generator prop table |
| New biome | row in `world/biomes.ts` + surfaces in `render/textures/painters/` (`kinds.ts`) + a drone in `scenes/floorAtmosphere.ts` |
| New omen | row in `world/omens.ts` (rules via `game/floorRules.ts`) |
| New lore | a fragment in `world/lore.ts` |
| New networked entity | `useNetBody({ id, body, … })` — snapshots, interpolation, late-join, migration are automatic |
| New networked message | `hostEvent` / `hostCommand` / `peerMessage` in the owning module — zero server changes |
| New late-join state | `registerSyncProvider(key, { collect, apply })` |
| New HUD piece | a file in `ui3d/layers/hud/` + one line in its `Hud.tsx` |
| New screen / menu | a file in `ui3d/layers/menus/` + one line in `Menus.tsx` (wrap it in `<UiPresence>`, build it from `Tablet`/`RuneText`/`RuneButton`) |
| New scene switch / travel style | a kind in `transition/timeline.ts` and `travel(kind, …)` around the switch |
| New particle effect | a named function in `fx/effects.ts` (styles in `fx/particleSim.ts`) |
