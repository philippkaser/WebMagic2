# Architecture

## Overview

The client is a Vite + React Three Fiber app. Systems are deliberately split
into three tiers so the game can grow into a large online title without
rewrites:

1. **Pure logic** (no DOM, no three.js, no physics): `core/`, `world/dungeonGen`,
   `net/matchmaking`, `items/`. Deterministic, unit-tested with `bun test`,
   and safe to run on a server.
2. **Runtime state**: the zustand store (`state/gameStore.ts`) owns the game
   flow (menu → village → dungeon → death), equipment and run-loot rules.
   Frame-hot data (player position/velocity) lives outside React in
   `game/player-state.ts`; cross-system lookups (what can be hit, what can be
   shoved) live in `game/registry.ts`.
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

### The floor-instance rule

`net/matchmaking.ts#FloorDirectory` implements the core social mechanic:

- Entering floor N joins the **oldest instance of N with a free slot**
  (max 4 players). You land in the same generated world as its occupants.
- If all instances are full (or none exist), a **new instance with a new
  seed** is created — which the next entrant can then join, and so on.
- Instances are garbage-collected when the last player leaves.

This is a plain class with injected seed/clock functions — the unit tests in
`matchmaking.test.ts` are the spec.

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

The server owns four things a client must never be trusted with — while
staying gameplay-blind (item ids are opaque strings; it validates
*provenance*, never meaning — the only "meaning" it borrows is the shared
pure price table and feather id from `items/economy.ts`, the same way it has
always known the starter-gear ids):

1. **Identity** — `login` presents a device token (or none, minting a fresh
   account). The token comes back with the save and is kept client-side
   (`webmagic.token.v1`). Real auth (email/OAuth) later replaces only the
   token-minting step. (`server/accounts.ts`)
2. **Saves** — checkpoint + the full banked inventory (equipment, Q/E belt,
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
   - `escape` — feather exit from ANY dungeon floor; same provenance as
     `bank`, does not advance the checkpoint, and only succeeds if a Feather
     of Safe Passage was provably owned and is now spent.
4. **Progression** — floor entry is validated against the account: floor 1,
   anything ≤ your banked checkpoint, one floor deeper than where you are
   (descending), or your current run floor (reconnect resume). Banking only
   counts on a checkpoint floor you are *actually matchmade into* — the
   relay reads the floor from the directory, not from the client.

Known limits, in honesty order: the floor host is still a client, so a
cheating **host** can attest bogus grants for its floor-mates (fix: headless
server-side hosts, the path above); item *stats* are client-computed (fix
follows server hosts); device tokens are bearer secrets in localStorage
(fine for a foundation, replaced by real auth). Rate limiting and hit/pickup
sanitization already run server-/authority-side.

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
- Persistence (bank, checkpoints) moves from localStorage to the account
  service; `state/persistence.ts` is the single seam.

## Physics & combat

- Rapier via `@react-three/rapier`. Collision groups (`core/config.ts#GROUPS`)
  keep friendly fire, enemy fire, props and the player interacting correctly.
- The player is a **dynamic capsule** (not kinematic) so the world can push
  back: enemy hits, barrel explosions and force blasts all shove the player.
  Movement is velocity-shaping: exponential ground acceleration, additive air
  control under a soft cap (momentum tech survives), coyote time, jump buffer.
- **Everything damageable registers a `Hittable`** (id, position, hit(dmg,
  impulse)). Explosions iterate the registry — no physics queries, no React.
- Projectiles are real CCD rigid bodies capped at a fixed pool size; particles
  are one instanced mesh (3072 quads) with a ring-buffer allocator; explosion
  lights come from a pool of 6 reusable point lights.

## Rendering

- **Zero binary assets**: all textures are painted onto 64×64 canvases at
  startup (bricks, slabs, planks, ceramic…), each with a normal map derived
  from its height field via Sobel — chunky pixels that still catch light.
  `NearestFilter` everywhere.
- **Walls are one instanced draw call**; their physics colliders are
  greedy-merged rectangles (tested to cover every wall tile), so collider
  count stays low as floors grow.
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
- **Post chain**: bloom → film grain → vignette (`render/Effects.tsx`).
- **Shadows are a quality toggle** (F4 / main menu, persisted, default off):
  a shadow-casting point light re-renders the scene six times per frame,
  measured at roughly +50% frame time even at low resolution.
- **F3 overlay** shows fps / p95 / worst frame for perf reports.

## Extending

| Want to add | Touch |
| --- | --- |
| New staff/amulet/cloak/boots | `items/catalog.ts` (data only) |
| New consumable | `items/catalog.ts` (`consumable` effect + `maxStack`); add to `items/economy.ts#MERCHANT_STOCK` to sell it |
| Economy tuning (prices, gold drops) | `items/economy.ts` (the one balance sheet, shared client + server) |
| New spell | `combat/abilities.ts` + reference it from a staff |
| New enemy | component in `combat/enemies.tsx` + spawn kind in `world/dungeonGen.ts` |
| New prop | `world/props.tsx` SPECS + generator prop table |
| New floor biome | new painters in `render/textures.ts`, swap by floor range in `DungeonFloor` |
| New networked entity | `useNetBody({ id, body, … })` — snapshots, interpolation, late-join, migration are automatic |
| New networked message | `hostEvent` / `hostCommand` / `peerMessage` in the owning module — zero server changes |
| New late-join state | `registerSyncProvider(key, { collect, apply })` |
