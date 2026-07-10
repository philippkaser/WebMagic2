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

### Transport abstraction

```
game code ──► GameSession ──► Transport (interface)
                                 ├── WebSocketTransport → server/server.ts (default)
                                 └── LocalTransport       (offline fallback)
```

`net/protocol.ts` defines the full client/server message set (hello,
enterFloor, state snapshots, peer join/leave, ability casts). The session
tries the WebSocket server first (two attempts) and falls back to the
in-process loopback, so the game is always playable; the HUD shows which mode
you're in. `server/server.ts` is a small Bun process that runs the real
`FloorDirectory`, relays 10 Hz peer state within each instance, and relays
casts (`peerCast`) which clients replay through the identical ability code
(with caster-only effects like blast recoil skipped).

### What is and isn't synchronized (current state)

| Synced | How |
| --- | --- |
| Floor layout, torches, props, enemies (initial) | deterministic from instance seed |
| Player position/yaw/staff | 10 Hz state relay, client-side interpolation |
| Ability casts (incl. explosion physics) | `castAbility` → `peerCast` replay |
| Join/leave, instance assignment | server directory |

**Not yet synced:** enemy AI decisions, enemy/prop health, and rigid-body
motion after the first frame — each client simulates its own physics world,
so crate positions and enemy state drift between players. The plan is
server-authoritative simulation per instance (or a designated host client as
an interim step): the server owns enemy/prop state and broadcasts dirty
entities in the 10–20 Hz snapshot; clients render and predict. The `Hittable`
registry is the seam — damage application moves behind a server round-trip
without touching rendering code.

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
| New spell | `combat/abilities.ts` + reference it from a staff |
| New enemy | component in `combat/enemies.tsx` + spawn kind in `world/dungeonGen.ts` |
| New prop | `world/props.tsx` SPECS + generator prop table |
| New floor biome | new painters in `render/textures.ts`, swap by floor range in `DungeonFloor` |
| Real networking | implement `Transport` over WebSocket; server reuses `FloorDirectory` + `protocol.ts` |
