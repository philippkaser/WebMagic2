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

- `world/biomes.ts`: five depth bands with fog, backdrop, ambient light,
  torch color, the player's own lantern colour, environment strength,
  surface ids, a `look` (damp band on the walls, vault fade, floor
  reflection strength, light-shaft tint, optional glowing seams) and enemy
  weight multipliers; the generator reads the monster mix,
  `scenes/floorAtmosphere.ts` and `DungeonFloor` the rest. Every biome
  follows one material language (the Drowned Halls' — see Rendering): the
  light and the fog carry the colour, not the stone.
- `world/gen/architecture.ts`: a generator stage on its own RNG stream (so
  layouts never shift) that places pillars (only in rooms ≥ 7×7, never on a
  path — tested), arch ribs on wall piers, light shafts and, in the Crystal
  Deep, crystal clusters that each register a pooled light.
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

- **Zero binary assets**: all textures are painted onto small canvases at
  startup by pure painters (`render/textures/painters/`), each with a normal
  map derived from its height field via Sobel — chunky pixels that still
  catch light. **One material language** for every biome: low-contrast,
  low-frequency albedo (big stones, few features), the detail in normal and
  roughness maps, and colour carried by light and fog rather than paint —
  glowing things are rare separate geometry (crystal clusters, heat seams),
  not painted emissive. Every wall and floor has a roughness map, so torches
  glint in damp stone everywhere. `getSurface(kind)` returns the maps plus
  the material settings they were tuned under. `NearestFilter` everywhere.
  Models live in `render/models/` as presentational components; behaviour
  stays in world/enemies code.
- **Stonework is one world-mapped mesh** (`render/models/DungeonStone.tsx`):
  7 m walls, base course, arch ribs on their piers and pillars share one draw
  call with texture coordinates in world space, so blocks stay square on tall
  walls and run continuously across tiles. Physics colliders are
  greedy-merged rectangles (tested to cover every wall tile), so collider
  count stays low as floors grow.
- **Reflective floors** (`render/models/DungeonGround.tsx`, quality flag
  `reflections`, default on): a real planar reflection through drei's
  reflector shader, but with our own mirror camera and render targets (drei's
  component leaks four targets per mount — one per descent) and the
  reflection added as *light* weighted by gloss and Fresnel, so a torch
  across the hall shines in the puddle at your feet. 256² with a small blur;
  the matte Hollow skips it.
- **Light shafts** (`LightShaftModel.tsx`): additive cones of dusty moonlight
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
- **Resolution IS the pixelation**: the canvas renders at dpr 0.35 and the
  browser upscales it with `image-rendering: pixelated`. That one decision
  cut measured frame time ~5× — every light, normal map and post pass pays
  ~1/8th the fragments — and replaced the pixelation post-pass outright.
- **Particles** (`fx/`): one CPU simulation (`particleSim.ts`, pure and
  unit-tested: a dense struct-of-floats pool of 8192, swap-remove, zero
  per-frame allocation) streams four instanced attributes into ONE draw call
  (`particleMaterial.ts`). Premultiplied-alpha blending lets additive light
  (glows, velocity-stretched sparks, embers, flares, shockwave rings) and
  alpha-blended matter (smoke, dust, lit debris chunks) share that call.
  Smoke, dust and debris are lit by the same pooled lights as the walls
  (`fxUniforms.ts` mirrors the pool), everything respects fog, and the
  shader never draws a particle below ~1.6 px (it pads it and gives back the
  alpha) so sparks stay steady at dpr 0.35. Gameplay code calls named effects
  (`effects.ts`: `explosionFx`, `shockwaveFx`, `castFlareFx`, `boltTrailFx`,
  `blackHoleFx`, `hitSparksFx`, `soulDissolveFx`, `shatterFx`, …), which
  thin themselves out as the pool fills; `spawnBurst()` remains for simple
  bursts (`style` picks the look). Torch fire is a procedural shader flame
  (`Flames.tsx`, one instanced call for every torch); the air of each biome
  is `AmbientParticles.tsx` — seeds animated entirely on the GPU in a box that
  follows the camera (dust, spores and drips, embers and ash, glints, falling
  ash, village fireflies; the Weightless Hour makes it all float up).
- **Post chain**: bloom → hue-preserving highlight roll-off → film grain
  (scaled by brightness, so dark scenes don't crawl with static) → vignette
  (`render/Effects.tsx`). The composer turns the renderer's tone mapping
  off; the roll-off stops lit pale stone from clipping into flat white
  without washing saturated magic (the cyan portal) out the way ACES would.
  The scene-wide environment strength is set per biome
  (`scene.environmentIntensity`) — in three 0.175 a material's own
  `envMapIntensity` is ignored for scene environments.
- **Shadows are a quality toggle** (F4 / main menu, persisted, default off):
  a shadow-casting point light re-renders the scene six times per frame,
  measured at roughly +50% frame time even at low resolution.
- **F3 overlay** shows fps / p95 / worst frame for perf reports.

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

There are no flat screens. Text burns into the air ahead of you as runes
that settle into letters and later burn away into embers; menus are stone
tablets that assemble out of the dark; items are small 3D objects; the HUD
is flasks, coin heaps and rune-stones carried in front of the eye.

- **Two canvases.** The world renders at dpr 0.35 (the pixel look); a 5×7
  pixel font rendered there would be mush. So a second, transparent,
  full-resolution canvas (`UiCanvas.tsx`) sits on top and copies the world
  camera every frame (`bridge.tsx` — R3F runs all roots in one loop in
  creation order, so there is no frame of lag). UI objects live in world
  space: prompts hang over the chest they belong to, messages hang in the
  air where you were looking. The UI canvas has its own torchlight so its
  stone reads as stone. It is click-through during play (the world canvas
  below takes the click that locks the pointer — `PointerLockControls` is
  scoped to `#wm-world canvas`) and catches the pointer while a menu is up.
- **Text** (`font/`, `text/`): a hand-set pixel font plus sixteen runes,
  packed by pure code into an atlas whose channels hold the glyph, a halo
  and an outline. `RuneText` draws one instanced quad per glyph with the
  whole lifecycle on the GPU (birth times per instance, a vanish time per
  block): one draw call per text block and no per-frame CPU work. Changed
  glyphs rewrite themselves alone (a ticking counter flickers one digit).
- **Choreography** (`presence.tsx`): nothing pops. `<UiPresence show exit>`
  keeps a subtree mounted while it plays its exit, and every toolkit piece
  (RuneText, Tablet, RuneButton, ItemModel) ANDs the ambient "show" flag
  into its own — a tablet closing burns off all its words for free.
- **Toolkit**: `Tablet` (fitted stones fly in, a rune channel burns around
  the rim), `RuneButton` (a stone plaque that lifts and kindles), `ItemModel`
  (every item family as primitives — also used for loot in the world),
  `ViewAnchor`/`WorldAnchor`/`placeInFront`, `pxFor(distance, fraction)`
  (size by share of the screen height), UI sparks and `audio/uiSounds.ts`.
- **Layers** (`layers/`, listed in `UiRoot.tsx`): messages, prompts, the
  HUD (`hud/`), the menus (`menus/`: title, the Weighing, death, codex) and
  the inventory family (`inventory/`). The DOM keeps only what isn't part of
  the fiction: the perf overlay, the build stamp and the dev room.

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
