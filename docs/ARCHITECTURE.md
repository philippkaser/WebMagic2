# Architecture

## Overview

The client is a Vite + React Three Fiber app. Systems are deliberately split
into three tiers so the game can grow into a large online title without
rewrites:

1. **Pure logic** (no DOM, no three.js, no physics): `core/` (including
   the presentation clock), `run/`, `items/` (materials and crafting
   included), `world/gen/` + `world/{biomes,omens,lore}`,
   `net/{matchmaking,party,arenaQueue}`, `enemies/brains/` +
   `enemies/{roster,puppet,wounds,anticipation,hitFx,doom,deathNote}` +
   `enemies/corpses/corpseScripts`, `weapons/{spellCatalog,allegiance,
   castMessage,hits,precision,castFeel}`, `combat/` (all but the
   `shooter.ts` glue), `game/{vitality,heart}`,
   `roomEvents/{catalog,rules}`, `arena/{rules,layout}`,
   `encounters/{pacts,graveRules,killCredit}`, `render/textures/painters/`,
   `fx/particleSim`, `transition/timeline`, `ui3d/font/`. Deterministic,
   unit-tested with `bun test`, and safe to run on a server (the relay
   already runs `arena/rules`, `net/party`, `net/arenaQueue` and
   `items/crafting`).
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

The generator (`world/gen/index.ts`) is a staged pipeline: omen → rooms →
corridors → walls → points of interest → torches → props & enemies → traps
→ lore runes → doorways → architecture → room events → dressing. The
layout stream's stages draw the same numbers whatever is added after them;
every later system rolls on its own stream (`gen/seeds.ts`: omen, lore,
architecture, events, doorways, dressing), so a seed keeps its rooms, props
and enemies byte for byte as stages are added — and the set dressing,
though cosmetic, is still seeded, so floor-mates see the same skull in the
same corner. The Proving Ground's hall (`arena/layout.ts`) is built from
the same stages on a stream of its own (see The Proving Ground).

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
- **Fellowships bypass it too**: the relay passes the wizard's party as
  `companions`, and a companion's instance on the same floor with room is
  joined outright (company, not a chance meeting: the tension clock rests).
  A fresh run starts on the deepest floor a companion is on that is no
  deeper than the Weighing allows (`Relay#companionFloors`), so a
  fellowship goes down together.
- `ENCOUNTER_CHANCE=1` on the server forces meetings (local testing).

Pure class with injected seed/clock/dice — `matchmaking.test.ts` is the spec.
The same class, differently tuned, also runs the camp (chance 1, twelve a
room) and the Proving Ground's bouts (chance 0, rooms made whole); an id
`prefix` keeps the three directories' instance ids apart.

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

**The server is blind to the floor's world.** For the world, `net/protocol.ts`
defines only matchmaking, host designation, clock pongs and one opaque
envelope type; what else it knows is the bank (accounts, provenance,
crafting — below), the social rooms and the Proving Ground's queue and
score (see Rooms). The header of `server/relay.ts` lists the relay's
responsibilities, completely and by design. The entire authorization model
for gameplay traffic is a channel-name prefix, enforced by the relay:

- `a:` **authority** — only the instance host may send (snapshots, despawns,
  world sync); relayed to the instance or to one member via `to`.
- `h:` **to-host** — anyone may send; delivered to the current host only
  (hit requests, pickup requests).
- `p:` **peer** — anyone may send; broadcast to the rest of the instance
  (poses, ability casts).

Adding a networked feature on a floor = declaring a typed message
client-side (`hostEvent`/`hostCommand`/`peerMessage`) or registering a
`useNetBody` / sync provider. **The server and protocol never change for
gameplay on a floor** (room events, for one, are pure client code).
`relay.test.ts` is the spec for the relay rules; `relayCamp.test.ts`,
`relayArena.test.ts`, `relayCraft.test.ts` and `relayAuth.test.ts` cover
the camp, the Proving Ground, crafting and the ledger. End to end,
`scripts/e2e-smoke.mjs` (`bun run e2e`, see the README) drives two
headless wizards through the dev-only window hooks (`__game`, `__session`,
`__pact`, `__arena`, …) against a real server: a solo run, a meeting (PvP,
a pact, a death, a grave and its plunder, checked against the server's
data file), the camp (chat, a fellowship by its runes, fellowship chat)
and a whole Proving Ground bout (the line, ten yields, Varr's ledger, the
walk home).

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

### Rooms: a floor, the camp, a bout

Every connection sits in at most one **room**, and a room is routed the
same way whatever it is — a host (its oldest member, epoch-bumped on
migration), `peerJoined`/`peerLeft`, and the `a:`/`h:`/`p:` envelope
rules (`Relay#roomOf` looks in all three directories):

| Room | Directory | Entered by | Answered with |
| --- | --- | --- | --- |
| Floor instance | `directory` (max 4, the encounter rule) | `enterFloor` | `floorAssigned` |
| Camp | `camp` (`CAMP_SIZE` 12, chance 1 — everyone home meets; companions first) | `enterCamp`, sent whenever the client's phase becomes `village` (`social/social.ts`) | `campAssigned` |
| Bout | `arenas` (`ARENA.maxPlayers` 6, chance 0 — filled by the queue) | the obelisk's queue, on `tick()` | `arenaAssigned` |

Entering a floor leaves the camp, any bout and the obelisk's line; going
home (`enterCamp`) leaves a bout. The social and arena messages:

- `chat { text, party? }` → `chat { from, name, text, party }`. `cleanChat`
  strips control, zero-width and bidi-override characters, folds
  whitespace and cuts at `CHAT_MAX` (140); at most 5 lines per 10 s per
  wizard, the rest dropped.
  A room line goes to the sender and their room; a `party` line to every
  member of their fellowship, wherever they are (`partyError
  not-in-a-party` if they have none).
- `partyCreate` / `partyJoin { code }` / `partyLeave` / `partyInvite { to }`
  / `partyAccept` → `party { party }` to every member (null to one who
  left), `partyInvited { from, name }` to an invitee, or `partyError`. An
  invite needs the invitee in the inviter's room.
- `arenaJoin` (home only — never mid-run or mid-bout) / `arenaLeave` →
  `arenaQueue { position, waiting }`; `arenaAssigned`, `arenaScore { board,
  fell }` and `arenaEnded { board, winner, record }` follow; `arenaFell { by }`
  is the fallen's report (see The Proving Ground).

`Relay#tick()` is the server's heartbeat (`server.ts` calls it every
250 ms): it starts bouts the queue has gathered, ends them on the score or
the sands, and lets go of a finished bout's stragglers.

### Host-authority replication

Every floor instance has a **simulation host** — its first joiner, promoted
in join order when the host leaves (`hostChanged`, epoch-stamped). The host's
simulation of enemies, props, the boss, loot and room events is the truth;
the relay *enforces* authority (`a:` traffic from non-hosts is dropped).
Offline play is
simply "always host", so single-player runs the exact same code path — and
`hostCommand.request()` dispatches locally on the host, so gameplay call
sites have **no host/replica branches at all**.

| Synced | How |
| --- | --- |
| Floor layout, torches, spawn tables | deterministic from instance seed |
| Player pose (pos/vel/yaw/pitch/staff), names | 20 Hz `p:pose` + buffered interpolation, plus a collision capsule per peer |
| A wizard's life (shown, never decided) | the pose's `h` life byte: 0…15, +16 at the Brink (`game/heart#lifeByte`) |
| Player ability casts | `p:cast` replay (cosmetic vs entities) |
| Enemy/boss position & velocity & hp | 20 Hz delta-filtered `a:snap`; predicted dynamic replicas steered by corrective velocity |
| Enemy body language | the same snapshot's fields: `k` (the last blow's direction, one of 16 steps; 16 = none), `w` (woken), `a` (wind-up: act code × 16 + progress step) |
| Room events | `hostEvent` `roomEvent` (an event's whole state) and `roomGift` (to one wizard); E is the `roomAct` `hostCommand`, range-checked by the host; a sync provider for late joiners |
| Prop position **and rotation** | same snapshots with quaternions — tumbling replicates; resting props go silent |
| Deaths & prop breaks | `a:despawn` lifecycle events (silent replay for late joiners); an enemy's carries the death note `{by, d, o}` |
| Sentry/boss shots, boss slams | `hostEvent`s replayed everywhere (real on host, cosmetic elsewhere) |
| Loot drops & pickups, floor treasure | host-granted `hostCommand`/`hostEvent` — an orb can never be taken twice |

**Damage authority rule:** exactly one simulation may damage an entity — the
host's. A replica's own shots apply damage via a `hit` command to the
authority (shooter-favored, like most netcode) — `{damage, impulse}` plus
optional extras read back by `enemies/hitFx#readHitExtras`: `at` (where it
landed: the host's sparks), `m: 1` (the shooter's own magic: it earns the
kill), `q: 1` (a quiet tug that neither confirms nor flinches) and `c: 1`
(a precision hit) — capped by depth in `weapons/hits.ts`; every *replayed*
explosion is `remote: true` and skips entity damage entirely. Your own
health is always local: contact burns and incoming blasts hurt each player
on their own machine, so your survival never waits on a round trip.

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
staying blind to the floor's world (item ids are opaque strings; it
validates *provenance*, never meaning — the only "meaning" it borrows is
the shared pure rules it runs on banked inventories: the price table and
feather id from `items/economy.ts`, the gamble, and the cauldron's and
forge's recipes from `items/crafting.ts` — the same way it has always
known the starter-gear ids):

1. **Identity** — the Wizard's Ledger (`server/auth.ts`, pure, injected
   hasher/clock/randomness; `auth.test.ts` is its spec). **Guests** work as
   they always did: `login` with no token mints an account whose id doubles
   as its device token; presenting it resumes. **Members** have a username
   (3–16 of `A–Z a–z 0–9 _ -`, unique ignoring case, never shown to other
   wizards — the display name is separate) and a password stored only as an
   argon2id hash (`Bun.password`, 19 MiB × 2). `register`, `loginPassword`
   and `claim` answer `authOk` with a fresh **sign-in token** (32 random
   bytes, hex) that the client keeps where the device token was
   (`webmagic.token.v1`); the server stores only its SHA-256 — at most ten
   per account, each lapsing after 30 days unused (sliding), `logout`
   revoking one or all. A lapsed token is answered `authError
   session-expired`, never with a silent new guest. **Claiming** writes
   credentials onto the guest's own record, so its progress is simply still
   there; its device token stops working. Failures back off exponentially
   per connection and per username, one hash runs per connection at a time,
   and unknown usernames still pay for a decoy hash (no timing oracle).
   Ledger messages are refused mid-dungeon. The relay only binds the
   connection to the answer; shared rules live in `net/credentials.ts`.
2. **Saves** — deepest floor + the full banked inventory (equipment, Q/E belt,
   5-slot bag, 8-slot reagent pouch, 30-slot chest, gold) and the
   Proving Ground record (`arena: { bouts, wins, yields }`, written only by
   `AccountStore#recordBout`) live server-side; the client's
   localStorage is a cache of the last `loggedIn`/`authOk`/`saved` payload
   (and the full save of record when playing offline). The data file
   (`DATA_FILE`, `{ version: 2, accounts }`; old bare arrays still load) goes
   through `server/storage.ts`: debounced **atomic** writes (temp file,
   fsync, rename), retried on failure and flushed synchronously on
   SIGINT/SIGTERM; **rotating snapshots** in `backups/` beside it (on
   startup, then at most hourly while data changes, newest 48 kept); a file
   it **can't parse is never overwritten** — it is moved aside as
   `.corrupt-<timestamp>`, loudly, and the newest readable snapshot
   restored; a file from a newer server refuses to start. Swapping in a
   database still replaces one `persist` callback.
3. **Item & gold provenance** — the core rule: *an item may be banked ⇔
   previously banked ∪ starter gear ∪ granted this run by the floor HOST's
   attestation* (`grant` messages; the beneficiary can never vouch for
   itself, mirroring loot authority). Grants are a **multiset** — two granted
   potions are two bankable potions. Gold follows the same path via
   `grantGold` under sanity caps (`items/economy.ts#GOLD_RULES`). Banking
   (`bank` → `saved`) strips anything else; death (`died`) or quitting
   forfeits the run's grants. Materials are items like any other — run
   loot until banked. The village and dungeon variants share the rules:
   - `stash` — village-only rearrangement (chest/bag/belt moves); must be a
     sub-multiset of the current save, so nothing new can enter this way.
   - `buy` — merchant purchase; the submitted inventory may contain exactly
     the bought ware on top of what's owned, paid at the shared economy
     price from banked gold.
   - `sell` — merchant sale; the sold copies must be provably owned and the
     credit comes from the shared `sellValue` table (no client-set prices).
   - `gamble` — Orb of Fortune; the SERVER rolls the item with the shared
     pure `rollGamble`, so outcomes can't be fished for client-side, and
     charges `gamblePrice(deepest)` (65 + ⌈1.25 × deepest⌉ — it climbs
     faster than the gear resells, so gambling to sell loses on average).
   - `craft` — the cauldron and the forge: the server applies the shared
     pure `applyCraft` to the BANKED inventory with its own dice and
     answers `crafted` (see Crafting). Village only.
   - `escape` — feather exit from ANY dungeon floor, even before the tithe;
     same provenance as `bank`, never counts as a deepest, and only succeeds
     if a Feather of Safe Passage was provably owned and is now spent.
4. **Runs** — floor entry is validated against the account (run/rules.ts,
   shared with the client): a **fresh** run (`enterFloor { fresh: true }`)
   always lands where the account's *banked* gear resonates, whatever floor
   was asked for — or shallower, on a fellowship companion's floor; a
   continuing run may only re-enter its floor (reconnect)
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
plundered copy); sign-in and guest tokens are bearer
secrets in localStorage (an XSS would steal them — sessions lapse and can be
revoked, a guest's cannot until claimed); the ledger's rate limits are per
connection and per username, not per IP, and one account may be signed in
from two places at once; in the Proving Ground only the fallen report a
fall (health is the victim's, as everywhere), so a hacked client can
refuse to yield — though it can never credit a yield to anyone outside the
bout, nor fall twice in one rising. Rate limiting and hit/pickup
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
- **Rooms besides floors**: camps and bouts are already rooms of the same
  shape (their own directories), so they shard the same way; the
  fellowship directory and the obelisk's queue are the only cross-room
  state, and both are small.
- **Persistence** is already server-side; swapping the data file for a
  database replaces the account store's one `persist` callback.

## Run rules (`run/`)

- **Item levels** ride inside item ids (`defId(+affix)*[@level][^enhance]`
  — up to two enchantments, then the level, then the forge's +1…+5;
  `items/itemId.ts`), so the opaque-id provenance stack needed no changes.
  Gear rolls at its drop floor ±1; ids without a level are legacy items whose
  level falls back to their catalog `minFloor`. `items/power.ts` turns levels
  into strength: a staff's level multiplies spell damage, other gear adds a
  health ward. Networked hit caps follow depth (`weapons/hits.ts`).
- **The Weighing** (`run/rules.ts`): gear level = mean item level over the
  four gear slots (empty = 0); entry floor = round(level × 0.85), clamped to
  1…95. Client and server call the same function.
- **One rift, forking** (`transition/fork.ts`, `ui3d/layers/ForkChoice.tsx`):
  a floor has one rift, at `FloorLayout.exit` (the old way-home spot is
  retired). E calls the store's `enterRift`, which plays
  `travel("fork", …)`; inside the TUNNEL the switch awaits
  `askFork({ homeOpen, deeperOpen, nextFloor, owed })` while the UI opens
  two tears in the void — the way down (cyan, right) and the way home
  (gold, left) — reporting where the wizard looks (`faceFork`) and taking a
  way on click, E or Space (`chooseFork`). It waits 14 s for a real choice
  and takes the facing way; with one way only (the tithe unpaid — the home
  tear stands there sealed — or floor 100) it hangs for 1.4 s and takes
  it. The switch returns `{ arriveAs: "home" | "descend" }` and `travel`
  plays ARRIVE in that way's colours. The Warden still seals the rift
  (`locked`) until it falls.
- **The Tithe of Five**: the home tear opens once `run.floorsPlayed ≥ 5`
  (`canLeave`); the server refuses `bank` before `runFloors ≥ 5`.
- **Outcomes** (`run/outcomes.ts`): `bankKit` marks everything carried safe;
  `settleDeath` strips this run's loot (a lost run staff falls back to the
  starter) and returns what was lost, by id, for the death screen and graves.

## Wizard vs wizard (`encounters/`)

- **Hostility seam** (`game/hostility.ts`): `relationOf(id)` →
  stranger | ally | oathbreaker. `PactSystem.tsx` installs the resolver;
  everything else (weapons, peer capsules, name tags, presence) only asks.
  The resolver, in order: in a bout every wizard is a stranger until it
  ends (your fellowship too), then an ally; outside the dungeon (the camp)
  everyone is an ally; a fellowship member is always an ally; then the
  pact's relation.
- **Pacts** (`encounters/pacts.ts`, pure): wary → offered/invited → bound;
  one-sided breaks mark an oathbreaker; offers lapse after 20 s.
  `PactSystem.tsx` sends `p:pact` messages addressed to one wizard and binds
  the F key (in the dungeon only, never in a bout). A sworn pact emits
  `pactSworn`, and `social/social.ts` makes the pair a fellowship: the
  lower id invites, the other accepts its partner's invitation on sight.
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

## The camp & fellowships (`social/`, `net/party.ts`)

Home is a room too (see Rooms): the camp the wizard sees is the relay's
camp instance — the other wizards walk it as remote wizards, speak, and
swear fellowships there.

- **Fellowships** (`net/party.ts`, pure; the relay owns the
  `PartyDirectory`, `party.test.ts` is the spec): a leader, up to
  `MAX_PARTY` (4) members, and a code of six runes from `CODE_ALPHABET` —
  25 characters with nothing to misread (no 0/O, 1/I/L, 2/Z, 5/S, 8/B);
  `normalizePartyCode` forgives case, spaces and dashes. An invite waits
  `INVITE_TTL_MS` (30 s), the newest winning; leaving hands the lead to the
  longest-standing member, and the last one out disbands it and kills its
  code. Matchmaking reads `companionsOf()` (see The encounter rule).
- **Client state** (`social/social.ts`, `useSocial`): the fellowship, a
  waiting invitation, the last 40 lines, and what each wizard last said
  aloud (held 6 s over their head). It sends `enterCamp` whenever the phase
  becomes `village` (first start, a walk home, a respawn) and forgets the
  old room's poses on a new seat; it also turns a sworn pact into a
  fellowship (above).
- **In the world** (`ui3d/layers/social/`): `Social.tsx` — the chat scroll
  at the left (Enter opens a `RuneField`; a line starting `/p ` goes to the
  fellowship; six lines shown, each for 15 s), speech over heads (within
  26 m; fellowship lines never go overhead), the fellowship's runes at the
  right, and F in the camp (take a waiting invitation, or invite the
  nearest wizard within 3.2 m). `GuildBoard.tsx` — the guild board's
  tablet (E at `world/villageProps#GuildBoard`, overlay `guild`): your
  fellowship and its runes, a field to speak another's, and the camp's
  wizards with an invitation each.

## The Proving Ground (`arena/`)

Duels to the yield, not the death, in the Founders' old trial hall. The
score is the server's; the body's rule is the client's, like all of a
wizard's health.

**Server.**

- `arena/rules.ts` (pure, shared): `ARENA` — 2–6 wizards, 3 minutes, 10
  yields to win, rise after 3 s, an 8 s gathering breath, the hall holding
  everyone 6 s after. `recordFall`, `ranked` (most yields, then fewest
  falls, then who scored first), `boutOver`, and `winnerOf(board,
  present)` — a deserter keeps their row but can't win, and nobody wins
  without a yield.
- `net/arenaQueue.ts` (pure): longest-waiting first; `take(now)` forms a
  bout once two wait and 8 s have passed since the second came, or at once
  with six.
- `server/relay.ts`: `tick()` → `startBout` seats the fighters still home
  (too few go back in line) in one `arenas` room with a fresh seed and a
  `newScoreboard`, and deals `arenaAssigned { seed, members (spawn order),
  endsAt, killsToWin }`. `arenaFell` is honoured only from a wizard in a
  live bout, once per rising (`respawnMs` since their last fall), and
  credits `by` only if it names another wizard in the room; it sends
  `arenaScore` and ends the bout when it's over. `endBout` ranks the board,
  picks the winner among those still present, writes each wizard's
  `AccountStore#recordBout(won, yields)` into `ServerSave.arena` and sends
  `arenaEnded { board, winner, record }`. A bout left with one wizard ends
  at once; a finished bout's stragglers are let go 60 s after its farewell.

**Client.**

- `arena/arenaStore.ts` mirrors the relay: our place in line, the bout (its
  board, who's down until when, a feed of falls, how it ended) and the
  record.
- `arena/arenaFlow.ts` — the journeys and the yield. `arenaAssigned` →
  `travel("arena", …)` into phase `dungeon`, floor 0, the bout's seed
  (`GameScene` mounts `ArenaFloor` instead of a dungeon floor);
  `startingStone` deals each wizard their own stone by member order.
  **The yield is a pluggable fall rule** (`gameStore.setFallRule`, asked
  in `takeDamage` before the Phoenix — see Game feel): in a bout the rule
  reports `arenaFell(by)` (the last wizard who hurt us, if they're in the
  bout), drops us to phase `loading` (no input, casting or harm), burns us
  away in Varr's ember-gold, and after `respawnMs` rises us at
  `pickSpawn(spawns, foes)` — the stone farthest from every standing foe —
  at full health and mana. Nothing is lost: no grave, no run; draughts
  drunk in the hall are drunk (the walk home sends a `stash` the bank
  checks). `arenaEnded` → `afterMs` later, `travel("home")` through the
  tunnel; a reconnect mid-bout walks you home.
- Everyone is hostile in a bout, your fellowship too, until it ends (the
  hostility resolver, above); pacts are off in the hall.
- `arena/layout.ts` — `generateArena(seed)`: one quadrant of a 44-tile
  plan turned four ways, so the hall is four-fold rotationally symmetric
  and no spawn stone is better than another — a great hall in the middle,
  four alcoves on spokes into it, an outer ring through four corner
  chambers; eight spawns (alcoves, then corners). The seed picks only the
  dress: the band's stone (any of the five, rolled per bout) and the hall's
  style — `open`, `blocks` (a great block off each diagonal) or `octagon`
  (cut corners, a low wall across each spoke's mouth). Built from the
  dungeon's own stages (`buildWalls`, `placeTorches` lit brighter,
  `placeDoorways`, `planArchitecture`, `planDressing`) on its own stream,
  with the Founders' `trial-hall` inscription carved on the hall's north
  wall, so it renders, sounds and collides like the rest of the world.
  `layout.test.ts`: the same from every stone, every stone reaches every
  other.
- `ArenaFloor.tsx`: the dungeon's shell (stone, light grid, colonnades,
  dressing, torches) with a glowing stone at every spawn and Varr's sigil
  at the hall's heart — no monsters, no loot, no rift.
- In the camp, `world/villageProps#Obelisk` (`render/models/ObeliskModel`)
  stands north of the gate; E opens Varr's tablet
  (`ui3d/layers/arena/ArenaLayer.tsx`: her greeting, the rules, your
  ledger, the line), and the same layer carries the waiting rune, the
  bout's board and sands, the yield veil, the yield you took and Varr's
  reading of the board.

## Floor mood: biomes, omens, lore

- `world/biomes.ts`: five depth bands — each with its painted surface set,
  fog, backdrop, ambient light, torch colour, the player's lantern, a
  breathing glow, a split-tone colour `grade`, an accent (the spawn sigil's
  colour), a `look` (light-shaft tint, floor reflection strength) and enemy
  weight multipliers; the generator reads the monster mix,
  `scenes/floorAtmosphere.ts` and `DungeonFloor` the rest. The look of each
  biome comes from the "gritty pixel-magic" art direction (see Rendering).
- `world/gen/doorways.ts`: every corridor mouth — a run of one or two
  open tiles just outside a room's edge, rock either side along that wall,
  a real passage beyond (pure, no rng) — gets a frame; what hangs in it
  (nothing, a raised portcullis, a broken door on its last hinge leaning on
  unbroken wall clear of torches and runes) is rolled on its own stream.
- `world/gen/architecture.ts`: a generator stage on its own RNG stream (so
  layouts never shift) that plans pillars, arch ribs, light shafts and
  crystal clusters — all of it built now. Piers keep off door frames and
  leaves, pillars out of the lane through any doorway; tested never to
  block a path or crowd a landmark.
- `world/decor.ts` + `world/gen/dressing.ts`: the set dressing, the last
  stage, on its own stream. `decor.ts` is the table — each kind's mounts
  (true corner, foot of a wall, flat on the floor, on a wall, the upper
  corner, hanging from the vault), footprint, hang, collider and variants,
  and what each band scatters (`DRESSING`: bones, candles, chains, cobwebs,
  Founders' banners, grates, rubble, niches with urns; barnacles, kelp and
  puddles below the tide line; anvils, braziers and slag in the Forge;
  crystal spurs in the Deep; pale roots and bone chimes in the Hollow).
  The stage only reads finished layout data. The rules, all tested: decor
  never stands on a landmark's tile or near the spawn sigil, the exit's
  rift, the treasure, the Warden, a trap plate or a spawned body; nothing
  with bulk leaves the walls (only grates and puddles lie in the open);
  nothing stands in a doorway's lane; hanging decor never reaches below
  3.3 m; the two pieces with colliders (anvils, braziers) only fill
  dead-end corners, so every path stays open.
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

## Room events (`roomEvents/`)

A floor's rooms can hold something besides monsters. Adding a kind is a
row in the catalog, a branch in the rules and a view.

- **Catalog** (`catalog.ts`, data): vault (weight 3, from floor 2, a room
  side ≥ 5 tiles), ward circle (2, floor 4, ≥ 6), shrine (3, floor 1, ≥ 3),
  fountain (2, floor 1, ≥ 3), and `ROOM_EVENT_RULES`: 85% of floors hold
  one, and from floor 5 half of those a second (never two of a kind); a
  vault wakes 2 guardians plus one per 15 floors (≤ 5), counted after a
  1.5 s grace; a ward is won by 35 s of a held circle (3.2 m), its three
  waves (2 + 1 per 20 floors, ≤ 5) landing at 0, ⅓ and ⅔ of the way; an
  empty circle drains at half the rate it fills and breaks after 12 s
  abandoned. `rollRoomReward`: a piece of gear (better legendary odds than
  a drop), 4 (vault) or 6 (ward) of the floor's enemy purses, a clutch of
  the band's reagent, and riftglass — 1–2 from a ward, a coin-toss from a
  vault. A shrine offers one of five bargains from `items/buffs.ts` (Oath
  of Blood, the Glass Hour, Wellspring, Storm Pact, Ricochet Rite — 150 s,
  a boon and its price), picked by the event's variant.
- **Rules** (`rules.ts`, pure state machines, `rules.test.ts`):
  `actOnRoomEvent` (E) and `tickRoomEvent(view)` return the next state and
  the EFFECTS the authority should carry out (`spawn`, `reward`, `gift`) —
  no network, no scene, no dice:

  ```
  vault:  sealed ─(someone enters its room)→ guarded ─(guardians dead)→ open ─(E)→ looted
  ward:   dormant ─(E)→ kindled ─(held 35 s)→ won
                           └──(empty 12 s)→ broken
  shrine, fountain: once per wizard (takenBy), by E
  ```
- **Net** (`net.ts`): the floor authority ticks every event each frame on
  real time and carries out the effects — guardians and waves through
  `enemies/spawnedStore#spawnEnemy` (kinds from the band's mix), rewards as
  loot orbs (`dropItem`, `dropGold`, `dropReagent`) — and announces state
  with `hostEvent` `roomEvent` (every phase change; a filling ward every
  250 ms) and `roomGift` (a shrine's boon, or the fountain's full health
  and mana, to the one wizard it's for). E is the `hostCommand` `roomAct`,
  range-checked (4 m) by the authority. A promoted host resumes from the
  last announced state; offline the same requests dispatch locally.
- **Views** (`RoomEvents.tsx`, mounted by the dungeon floor): a reset per
  floor, the `roomEvents` sync provider for late joiners, one view per
  event (`render/models/roomEventModels.ts`), and the moments everyone sees
  on the `roomEvent` game event (bursts, light, sound). The cast map marks
  each event once seen, in its colour.
- **Placement** (`world/gen/eventPlacement.ts`, its own stream
  `STREAM_SALT.events`): after architecture, before dressing; never the
  spawn, exit or treasure room; the event's tile and the ring round it kept
  clear of everything already standing (props, foes, traps, torches, runes,
  pillars), and dressing keeps its distance in turn.

## Crafting (`items/materials.ts`, `items/crafting.ts`)

Kept simple on purpose: the deep doesn't flood a wizard with item types,
and each item says what it wants.

- **Seven materials** (`slot: "material"`, stacks of 99, carried in the
  8-slot reagent pouch): five **band reagents** (`BAND_REAGENT`: Grave
  Moss, Brine Pearl, Cinder Iron, Singing Shard, Hollow Ash) — a floor
  drops only its band's, from 35% of kills and 20% of broken props (× the
  floor's loot rule); **riftglass** — 0.6% of kills (+0.01% a floor), 1–2
  from a Warden or a won ward, a coin-toss from a vault, and salvage of a
  legendary (2) or of +3-or-better work (1), never more than went in, so
  no loop prints it; and the **Warden's Sigil** — Wardens only (1–2). The
  authority rolls them
  (`rollMaterialDrops`, `LootOrbs#dropReagent`) and grants them like any
  loot.
- **Attunement** (`attunedReagent(baseId, affixIds, level)`): every piece
  of gear is worked with ONE band reagent of its own, by rendezvous
  hashing — each band the item's level has reached scores
  `hashSeed("<base>+<sorted affixes>|<band>")` and the best wins. Two Ember
  Staffs with different enchantments may want different things, a shallow
  item always wants a shallow reagent, tempering into a new band only ever
  switches it to that band, and a reforge may change it. The forge says
  "HUNGERS FOR …" over the anvil (`ForgeTablet.tsx`), every gear plaque
  says "Hungers for …" (`plaqueText.ts`), and a reagent's plaque says
  where it grows (`whereItGrows`).
- **The works** — `applyCraft(inv, req, rng, { deepest })`, pure, never
  mutating its input; payment comes from pouch → bag → chest → belt, and
  what's made goes where it belongs (draughts to the belt, reagents to the
  pouch, gear to the bag), then anywhere with room:

  | Station | Work | Cost (`crafting.ts`) |
  | --- | --- | --- |
  | Wenna's cauldron | brew — nine recipes, every one on Grave Moss + at most one other material | Weak Healing Draught: 2 moss, 4 g · Elixir of Fury: 1 moss, 2 Cinder Iron, 14 g · Feather of Safe Passage: 3 moss, 1 riftglass, 40 g |
  | Brannoc's forge | temper: +1 level, never past `temperCap(deepest)` = max(5, deepest + 3) | 2 + ⌊lvl / 12⌋ of its reagent, 8 + 3 × lvl g |
  | | enhance: +1 … +5 (boons grow, banes don't) | step n: 2n of its reagent, n riftglass, 40n g |
  | | imbue: one more random enchantment (at most two; never a legendary) | 3 reagent, 2 riftglass, 60 g |
  | | reforge: re-roll its enchantments | 2 reagent, 1 riftglass, 40 g |
  | | salvage (never the staff in hand) | free; yields 1 + ⌊lvl / 10⌋ of its reagent (+ riftglass, above) |
  | | the Great Work: a legendary rolled for max(10, deepest) | 3 Warden's Sigils, 5 riftglass, 300 g |

- **Server-validated**: crafting only ever touches the banked inventory,
  in the village. The store (`craft`) runs a local dry run for an instant
  "can I?", then sends `craft { recipe, target, expect }` — one at a time;
  `expect` is the id the client saw at `target`, and the server refuses
  ("The anvil holds something else") rather than work the wrong piece. The
  relay's `craft` case calls `AccountStore#craft`: the same `applyCraft`
  on the account's inventory with the server's dice (an imbue can't be
  fished for), sanitized, flushed, answered with `crafted { recipe, save,
  ok, reason?, produced?, changed? }`. Offline, the local result is the
  craft. `crafting.test.ts`, `materials.test.ts` and
  `server/relayCraft.test.ts` are the spec.

## Physics & combat

- Rapier via `@react-three/rapier`. Collision groups (`core/config.ts#GROUPS`)
  keep friendly fire, enemy fire, props, the player — and hostile wizards —
  interacting correctly.
- **Enemies** (`enemies/`): `roster.ts` (data) → `useEnemy.ts` (the shared
  shell: health from roster × depth × floor rule, death FX and drops, hit
  routing, local contact damage, the life board) → a pure brain in
  `brains/` (unit-tested steering/state machines over plain vectors) → the
  living body (`liveBody.ts`: what every client shows of it — see Game
  feel) → a presentational model in `render/models/enemies.tsx`. Each kind
  in `kinds/` is just that wiring. Runtime spawns (slime children, vault
  guardians, ward waves) go through `spawnedStore.ts`: the host decides and
  announces, a sync provider covers late joiners.
- **Spells** (`weapons/`): `spellCatalog.ts` is the data (kind + numbers;
  tooltips are derived from them), `castKinds.ts` implements each kind,
  `projectiles.tsx`/`explosions.ts`/`singularity.tsx` do the physics. Void
  seeds are owned: a Collapse only implodes its caster's seeds.
- The player is a **dynamic capsule** (not kinematic) so the world can push
  back: enemy hits, barrel explosions and force blasts all shove the player.
  Movement is velocity-shaping: exponential ground acceleration, additive air
  control under a soft cap (momentum tech survives), coyote time, jump buffer.
- **Everything damageable registers a `Hittable`** (id, position,
  `hit(dmg, impulse, info?)`, optionally `weakSpot()`). Explosions iterate
  the registry — no physics queries, no React.
- Projectiles are real CCD rigid bodies capped at a fixed pool size; their
  VFX (trails, flares, blasts) go through `fx/effects.ts` (see Rendering →
  Particles); explosion light comes from the dynamic light pool (`flashLight`).

## Game feel

Destiny's trick, everywhere: the last third of a bar holds half the life.
One small shared contract, then three packages built on it — the
shooter's feel (A), living enemies (B), tension (C). All of it is
presentation, or a wizard's own rule on their own machine; the authority's
numbers never bend, and nothing new rides the wire beyond a few small
fields.

### The contract

- **The knee** (`game/vitality.ts`): `KNEE = { real: 0.5, shown: 1/3 }`;
  `shownFrac`/`realFrac` map between real and shown life (monotonic),
  `woundStage` grades a body (0 whole above 75% · 1 hurt · 2 broken past
  the knee · 3 dying below 20%), `crossedKnee` marks the break. Only what's
  shown bends: hp replicates as it always did.
- **The wizard's own rules** (same file — real, not shown, and decided on
  the victim's machine like all of a wizard's health, so as fair in PvP as
  in co-op): **last stand** — below 30% of max, harm is halved
  (`lastStandDamage`: what falls above the line lands in full); **lethal
  grace** — a killing blow taken at ≥ 50% leaves you on 1 HP, **the
  Brink**, at most once per 25 s. `harmWizard(health, max, amount, now,
  graceReadyAt)` applies both.
- **The order in `gameStore.takeDamage`**: the Brink's window (for 0.6 s,
  `BRINK_WINDOW_S`, nothing lands) → `damageTakenMult` → `harmWizard` (last
  stand, grace) → the venue's fall rule (`setFallRule`: the Proving
  Ground's yield) → the Heart of the Phoenix (the once-a-floor true-death
  save, never spent by grace or a yield) → death (`travel("death")`).
- **The presentation clock** (`core/presentTime.ts`): `hitstop(s)` freezes
  the picture (stacking, never past 0.25 s from now), `slowMo(scale, s)`
  slows it, and readers scale their animation by `presentDt` /
  `presentScale` — particles, enemy bodies, corpses, the staff,
  `CameraKick`, the Warden. Physics, brains, timers and the network never
  read it: every client freezes only its own view.
- **What a hit says** (`game/registry.ts`): `HitInfo { mine, at, crit,
  quiet }` — the local wizard's own magic, where it landed, a precision
  hit, a ceaseless tug (the singularity) that shouldn't confirm or flinch;
  `weakSpot()` → `{ x, y, z, r, mult? }`, or null while shut.
- **Events** (`core/events.ts`): `enemyHit { id, kind, at, damage, frac,
  mine, crit, lethal }` — on the shooter's machine for their own hits, on
  everyone else's when the hp drops in a snapshot; `enemyKilled { id,
  kind, at, mine, dir, over, scale }` — on every client, from the host's
  death note. Beside them: `killPunch`, `castKick`, `fizzle`, `multiKill`,
  `wizardBrink`, `wizardHealed`.
- **The life board** (`enemies/lifeBoard.ts`): every living enemy's `{ id,
  kind, maxHp, hp, pos(), top, hurtAt }`, published by the shell —
  allocation-free reads for life marks, the boss bar, wounds and sounds.

### A — the shooter (`combat/`, `weapons/{land,precision,castFeel}.ts`)

- `combat/shooter.ts` is the glue: it hears `enemyHit`/`enemyKilled` with
  `mine` and answers, using the pure rules beside it (`confirm`, `numbers`,
  `momentum`, `impact`, `landing`). It is all the local client's own —
  floor-mates never see or hear your confirms.
- **Weight**: `weapons/castFeel.ts` reads a spell's heft (0…1) off its
  catalog row's base damage — a stream's tick 0.1, a bolt ≈ 0.4, a rail 1.
  `weapons/land.ts#land` wraps each hit so `combat/landing` holds the
  weight while the shell reports it, synchronously.
- **Precision** (`weapons/precision.ts`): a weak point multiplies by 1.5
  (`CRIT.mult`) or by its own `mult`, up to 2 (`CRIT.maxMult`: the
  Warden's open core) — the sentry's crystal head, the shadow's eyes, the
  wisp's core. Judged on the crosshair's line, where you aimed, not the
  bolt's (which leaves the staff a hand's breadth aside). The host's hit
  cap (`weapons/hits.ts`) is the plain cap × `CRIT.maxMult`, so the trust
  model is the one it always was.
- **The confirm** (`confirm.ts`, drawn by `hud/Crosshair.tsx`): ticks flare
  round the aim; a dry "tk" climbs in pitch through the creature's last
  half of life; the kill is a red X and a deep chime, once per creature.
  Sounds pass a gate (one per 60 ms, light hits one per 115 ms, their
  weight folded into the next).
- **Hitstop** (`impact.ts`): heavy 40 ms, crit 50, kill 80, crit kill 120,
  the Warden's death 220 (on every wizard's screen); a beam's or a flame's
  ticks never stop the picture unless they kill (40 ms); a stop within
  0.15 s of the last is halved. Breaking a creature's knee with your own
  blow holds 60 ms. A kill also sends the **kill punch** to the post chain
  (exposure pops, the lens splits colour).
- **Damage numbers** (`numbers.ts`; `ui3d/layers/combat/DamageNumbers.tsx`,
  one instanced draw): bone-white, gold with "!" for a precision hit,
  red-hot for the kill; hits on one creature within 0.35 s pour into one
  climbing number; a pool of 48.
- **Momentum** (`momentum.ts`): kills within 1.2 s chain; the kill chime
  climbs a two-octave pentatonic; rune words at 2, 3, 4, 6 and 9 —
  DOUBLE, TRIPLE, RAMPAGE, MASSACRE, CATACLYSM (`KillCallout.tsx`); each
  kill pours back a little mana (2, then 2 + 2 × chain, at most 12) and the
  staff burns hotter while the streak lives. Credit is the host's (the
  death note), but a kill seen landing counts for the chime at once.
- **Weighty casting**: the staff recoils and the eye kicks by the cast's
  weight. `player/CameraKick.tsx` lays the kick on the camera after the
  cast has read its aim and takes it off at the start of the next frame,
  before the controller — recoil never bends a shot. Heavy spells
  (cooldown ≥ 0.6 s) gather light in the staff and chime when ready; a cast
  without the mana fizzles.

### B — living enemies (`enemies/`)

The enemy stack's fifth layer, the **living body** (`liveBody.ts`): one per
enemy, owned by the shell, deciding nothing — it shows what this client
knows (its own blows, the host's word on everyone else's, the replicated
act code).

- **The puppet** (`puppet.ts`): seven underdamped springs (lean x/z,
  offset x/y/z, squash, swell) on the view group — the RigidBody's
  rotations stay locked — tuned per kind from jelly (slime) to stone
  (sentry, Warden); it breathes, faces its prey, snaps from a blow, coils,
  lists.
- **A blow** (`hitFx.ts`): a white frame then the hue, a flinch along the
  blow, sparks where it landed, a cry; pops gated to one per 70 ms per
  body (unseen damage rides into the next); a stagger budget, so a beam's
  chip damage can't stun-lock.
- **Wounds** (`wounds.ts`, `woundShader.ts`): glowing cracks from the
  first quarter lost (75% life) in four hard steps; crossing the knee is
  the **break** (a crack of light, a ring, a stagger, a yelp); past it the
  glow gutters, it leaks (embers, smoke, goo, molten), lists and breathes
  ragged, and at the end its light beats like a heart — all from the
  replicated hp, so every client agrees.
- **Death's door** (`brains/common#desperate`: past the knee, after the
  body has visibly broken): the wisp chases faster and jinks, the shadow
  strikes again within a moment and coils longer, the slime hops
  frantically, the sentry overcharges (reload × 0.75); the Warden enrages
  exactly at the knee (`hud/tension.test.ts` pins `WARDEN.enrageFrac` to
  `KNEE.real`).
- **Wind-ups everyone sees** (`anticipation.ts`): brains run on the host,
  so the act rides the snapshot as field `a` = code × 16 + progress step
  (coil, lunge, recoil; brace, charge, slam; aim; jink) — the shadow coils
  with flaring eyes, the Warden crouches and stills its shell, the
  sentry's crystal swells. Beside it, `k` (the last blow's direction in 16
  steps, 16 = none) and `w` (woken).
- **Zero-ping kills** (`doom.ts`): a non-host shooter's ledger of damage
  sent but not yet seen; a blow it knows was lethal turns the body rigid
  and white-hot (death throes) and disarms its contact burn until the
  despawn (1.2 s at most); the same ledger keeps your own hit from
  flinching twice when the snapshot confirms it.
- **The death note** (`deathNote.ts`): the despawn carries `{ by, d: [dx,
  dz], o }` — the killer's wizard id ("" for the dungeon itself), the
  killing blow's planar direction, overkill as a share of max hp (≤ 4);
  `readDeath` sanitizes it, so a bad note costs a death its flourish, never
  its truth.
- **Corpses** (`corpses/`): the kill hands the body's pose to a pooled
  per-kind corpse that outlives the RigidBody — the wisp swells and
  implodes, the shadow unravels while its eyes hang a beat, the slime
  splats and its children squeeze out, the sentry's head flies off along
  the blow, bounces once and shatters, the Warden sheds its three shards in
  blasts and goes critical. Overkill flings them, and enough of it gibs a
  wisp, shadow or slime straight to the pop. Corpse shaders compile at
  floor load.

### C — tension (`game/heart.ts`, `audio/muffle.ts`, `ui3d/layers/hud/`)

- **One heart** (`game/heart.ts`): felt from the last-stand line down — a
  step to 96 bpm at 30%, racing to 156 at death's door, +24 when the Brink
  slams it, slowing over three beats after a second wind. `render/Effects`
  steps it once a frame; the post chain (the grey, the closing rim), the
  hurt vignette, the health orb's throb and the lub-dub in your head
  (`audio/heartSounds`, played by `hud/Tension.tsx`) all read it.
- **The muffled world** (`audio/muffle.ts`): a world bus — one low-pass,
  one gain, in front of the master — closing from 18 kHz to 900 Hz toward
  death and 350 Hz at the Brink, thrown open by a second wind. Placed
  sounds, room tails and the ambient bed go through it; in-head sounds
  (the heart, the Brink's ring, the UI) go straight to the master and cut
  through (see Sound → the bus).
- **Colour bleeds out but the reds** (`post/GradeEffect` `uBleed`, driven
  from `post/feel.ts`): the world greys with the heart's depth while reds
  keep theirs; a second wind floods colour back, richer for a moment.
- **The Brink** (`wizardBrink`): slow motion at 0.3× for the 0.6 s window
  (`hud/Tension.tsx`), a thoom and a tinnitus ring (`playBrink`), a red
  flash (`HurtVignette`), and the blink-dash's cooldown cleared
  (`PlayerController`) — the window is for getting away.
- **Second wind**: a heal that carries you at least 8% of max back over the
  line (`SECOND_WIND_MIN`, `releaseOf`): a breath drawn in, the muffle
  sweeping open.
- **The honest orb** (`hud/orbMaterials#heightForFill`): the liquid covers
  the share of the orb you see (a disc's area), so 30% looks like 30%.
- **The boss bar** (`hud/BossBar.tsx`): a brass notch at the knee; the bar
  falls fast to it, the blow that crosses it cracks the seal (embers, the
  frame shudders, the world shakes), and past it the fill burns ember and
  throbs.
- **Life marks** (`hud/LifeMarks.tsx` + `markRules.ts`): a creature you've
  hurt wears a 26 × 6 art-pixel bar — bone-white above the notch, an ember
  sliver past it throbbing like a death rattle (84 → 180 bpm) — held 4.5 s
  after the last blow (9 s past the knee), the nearest 12 within 24 m,
  your own blow shown 350 ms ahead of the host's word, shattered into
  sparks on the kill, and stepped out of sight behind stone by a couple of
  sight rays a frame (the UI canvas has no depth of the world).
- **Allies at death's door** (`net/peerVitals.ts`, `net/RemoteWizards`):
  the pose's life byte `h` (0…15, +16 at the Brink) shows a floor-mate's
  life, never decides it; one in their last stand wears a pixel heart
  beating at their rate and leaks embers, and their Brink is heard where
  they stand (`playPeerBrink`).

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
- **Dressed stone is one more** (`ArchStone.tsx`, built by the pure
  `archStoneMesh.ts`): pillars (plinth, octagonal drums, abacus), arch ribs
  of voussoirs on quoined piers, and a frame round every doorway — long and
  short quoins, imposts, an arch round a proud keystone, the header that
  closes the 6 m slot above it — in each band's trim
  (`textures/surfaces/trim.ts`: tooled ashlar, a `<set>-trim` kind through
  the walls' own tinted material). Big faces are world-mapped; small stones
  snap onto one block of the texture, and alternate stones stand a few
  centimetres prouder, so the pixel-edge pass outlines every joint.
  Pillars and door headers have colliders. In the Crystal Deep the crystal
  clusters grow in the corners, soft pooled lights ranked under the torches.
- **Set dressing is at most three** (`models/decor/`): every decor texture
  is one painted atlas (`textures/decorAtlas.ts`, with alpha for webs,
  kelp, torn banners and puddles); each kind is a template of primitives
  mapped into it (`decorShapes.ts`, bounds tested against `world/decor.ts`),
  and a floor's whole dressing — portcullises and broken doors included —
  is baked per material (`decorBake.ts`: the atlas solid, the atlas
  cut-outs, the band's stone). Candles and braziers burn with the shared
  pixel flame (`fx/Flames`, one call for every fire) and flicker; candle
  clusters are pooled lights at priority 0.5, so they only take a slot when
  they're the closest thing burning. Measured (SwiftShader, dpr 0.35): +1
  to +6 draw calls per frame for all stonework and decor together, ~10–35k
  more triangles in view, no frame-time difference above the noise; a
  floor's stonework builds in ~20 ms and its decor bakes in ~10 ms, behind
  the portal tunnel.
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
- **The light grid** (`render/lighting/`): the floor plan on the GPU, so
  the dungeon's own surfaces (walls, vault, floor, floor marks) know where
  the rock is. Walls are full height, so whether rock stands between a
  pixel and a light is a 2D question: each pooled light's direct light is
  multiplied by a march through the floor's occupancy texture (one texel a
  tile) from the pixel to the light — Amanatides–Woo DDA, `gridRay.ts`
  (pure, tested) mirrored line for line in the shader. Torchlight stays in
  its room, a doorway throws a hard wedge down the corridor, a bolt flying
  past a corner sweeps its shadow across the floor. Each light is a small
  disc and each texel (32 a metre, the paint's own grid) aims its one ray
  at its own spot on it from a 2×2 ordered dither, so a shadow edge steps
  in whole texels and its soft band is a dither, never a blur. Lights in
  rock (a torch's flame a hair into its wall, a blast at an impact point)
  step out through their nearest face first; lights out of reach, behind
  the surface, or the eye's own (lantern, staff) are never marched; the
  visibility rides one bit per light. **Bounce** (`bounce.ts`, pure): once
  per floor, each torch's and shaft's light is laid on a grid twice the
  tile resolution (kept on its side of the walls by the same DDA), times
  the stone's albedo, and diffused over the open cells — so a torch's
  colour fills its room and spills faintly round a corner, never through a
  wall — then added to the surfaces' ambient irradiance (a half-float
  texture, strength per band). `FloorLighting` hands both to the uniforms
  when a floor mounts and clears them on unmount: uniforms and textures
  only, no light-count change, no recompiles; the village never sees it.
  Dev: `__lightGrid({ shadows, bounce })` A/Bs it live, `__sceneBench(n)`
  times the world pass alone, `?nolightgrid` loads without the patch.
- **Floor marks** (`fx/decals/`): blasts scorch the stone and the dead
  leave goo, soul-ash or crystal shards, for as long as you stay on the
  floor. The books are pure (`decalPool.ts`: 200 slots, past 184 live the
  oldest erode away in an ordered dither, a full pool overwrites its
  oldest; `scorchFor`/`splatFor` size a mark from the blast's footprint on
  the floor and its power, or the creature's size and burst style). The
  marks are painted (`render/textures/marks.ts`: one alpha-cut atlas, with
  per-texel roughness, sheen and ember lifetime) and drawn as ONE instanced
  draw of quads on the floor, lit like the floor (pool, grid shadows,
  bounce, fog), sampled at the floor's own texel grid so their pixels sit
  on the stone's; embers and soul-specks go out one by one. Fed by the bus
  (`explosion` from `explode()`, `enemyDied` from `useEnemy`), which fires
  on every client, so everyone's floor wears the same scars.
- **Resolution IS the pixelation**: the canvas renders at dpr 0.35 and the
  browser upscales it with `image-rendering: pixelated`. That one decision
  cut measured frame time ~5× — every light, normal map and post pass pays
  ~1/8th the fragments — and replaced the pixelation post-pass outright.
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
- **Post chain** (`render/Effects.tsx`, effects in `render/post/`), three
  passes at the world's low resolution:
  1. god rays (`render/godRays.ts`, see below);
  2. the lens (`post/LensEffect.ts`, one pass reading depth): **pixel
     edges** from the Laplacian of 1/depth (flat on any plane, so it fires
     only at silhouettes and creases — a dark outline on the far side, a lit
     lip on the near side, fading into the fog); **camera motion blur** by
     reprojection (depth → world → last frame's view-projection, as a fixed
     shutter, cuts detected and skipped, the held staff left sharp; a
     setting, `motionBlur`, key B); the **zoom rush** of a blast, a dash or
     a rift; rim-only **chromatic dispersion**; the forge's **heat shimmer**;
     and the **focus pull** that softens the world behind a tablet (title,
     Weighing, inventory family, codex, death);
  3. one merged pass: bloom → `post/GradeEffect.ts` (eye adaptation from a
     centre-weighted log-luminance meter, 32² mip chain → 1×1 ping-pong,
     fast toward light and slow into dark, half-way and within ±½ EV of the
     place's `air.eye`; the split-tone grade; a per-channel filmic shoulder
     instead of the hard clip; colour drained by a blow; near death,
     `uBleed` greys everything but the reds) →
     `post/FilmEffect.ts` (an oval vignette tinted with the place's darks,
     breathing in the Hollow and closing with the one heart near death; a
     luminance-weighted Gaussian grain on the pixel grid; ordered Bayer
     dither in display space against banding).
  Each biome sets its `grade` and `air` (shimmer, dispersion, breath, grain,
  vignette, eye) on arrival (`setGrade`) and they ease in over a second, so
  arriving reads as the air changing; the village has its own
  (`VILLAGE_GRADE`, `VILLAGE_AIR`). The body's kicks — `shake`,
  `playerHurt`, `dash`, `killPunch`, the Brink and a second wind, the
  travel stage — and the near-death state read from the one heart
  (`game/heart.ts`, stepped here once a frame) are kept by `post/feel.ts`
  (pure, tested) and decay on their own.
- **Shadows are a quality toggle** (F4 / main menu, persisted, default off):
  a shadow-casting point light re-renders the scene six times per frame,
  measured at roughly +50% frame time even at low resolution.
- **F3 overlay** shows fps / p95 / worst frame for perf reports.

### The camp above (`scenes/village/`)

Riftwatch is laid out in one table (`layout.ts`): the structures' footprints
(tents, the command pavilion, the watchtower, the wagon), the fixtures —
Wenna's cauldron out east, Brannoc's forge under the forest, the guild
board beside the lane, Varr's obelisk north of the gate — the palisade arc
and `groundHeight`, so the scene, its colliders, the floor map and the
acoustics all see the same camp. The stations themselves are
`world/villageProps.tsx` (each an E prompt that opens its overlay).
`Camp.tsx` bakes every static part into world space and merges per
material (the whole camp is a handful
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

**The bus** — every sound's way to the speakers:

```
placed voices, room tails, own steps & spells, ambient bed
        → world bus (audio/muffle.ts: low-pass + gain — the world going under)
        → master (audio/context.ts)
        → glue compressor (−12 dB, 3.5:1) → limiter (−1.5 dB, 20:1)   (audio/sound.ts)
        → destination
in-head sounds (the heart, the Brink's ring, UI, tone/noise with no destination) → master
```

The world bus is created lazily with the context (callers fall back to the
master until then, and in tests); the glue squashes three blasts stacked
on a kill chime into one big sound instead of clipping. A whole-mix effect
belongs in front of the glue (`glueIn()`). The shooter's sounds — the
confirm's "tk", the crit ding, the kill chime, the streak, a heavy spell
coming ready, the fizzle — are `audio/combatSounds.ts`; the heart's, the
Brink's and a second wind's are `audio/heartSounds.ts`.

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

- `timeline.ts` (pure, tested): per-kind styles (gate, descend, fork,
  home, feather, death, respawn, arena — colour, beats, drift direction),
  easing, and
  samplers that turn (stage, progress) into camera offsets and overlay
  parameters (iris, suck, rush, eject, reveal, …) — ARRIVE ends at an exact
  identity, so the FOV is always restored to the base 78°.
- `travel.ts`: `travel(kind, doSwitch)` plays ENTER, runs the store's scene
  switch under the TUNNEL (waiting for the new scene to render a few frames
  and at least one tunnel beat), then plays ARRIVE. A switch may return
  `{ arriveAs }`, and ARRIVE plays in that kind's style — the fork's way
  (see Run rules → One rift, forking). The store's `enterDungeon`,
  `enterRift`, `descend`, `walkHome`, the feather escape, death and
  `respawn` are wrapped in it, as are the Proving Ground's way in and home
  (`arena/arenaFlow.ts`). Dev: `__fork.choose(way)` takes a way without
  the mouse; `__travel.freeze(stage, kind, p)` / `.preview(kind, p)` /
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

- **Two canvases.** The world renders at dpr 0.35 (the pixel look); a pixel
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
  stone, lifting on hover), `RuneField` (a slab you write in: a hidden
  input mirrored into runes behind a blinking cursor; Enter/Tab/Escape; a
  password mode whose letters burn in as ✦ and settle into •),
  `PixelFrame` (now only a faint engraved groove), `ItemModel` (every item family as primitives — also used
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
  tome; the title carries the Wizard's Ledger, `Ledger.tsx`: a line saying
  who you are to it, and a tablet with username/password slabs that builds
  where the laws stood — state in `state/account.ts`, words in
  `ledgerText.ts`) and the inventory family (`inventory/`: item slots are soft wells
  worn into the stone, their grade glowing up from the floor; the chest,
  Maro's stall, Wenna's cauldron and Brannoc's forge are pages beside your
  altar). Since the feel pass and the camp: `ForkChoice.tsx` (the two
  tears in the void), `combat/` (damage numbers, rune words), the HUD's
  `Crosshair`, `LifeMarks`, `BossBar`, `HurtVignette` and `Tension`
  (Game feel), `social/` (the chat scroll, speech, the guild board) and
  `arena/` (Varr's tablet and the bout's boards). The DOM keeps only what
  isn't part of the fiction: the perf overlay, the build stamp and the dev
  room.
- **The cast map** (`layers/map/`): M casts a miniature of where you are —
  the village whole, or the floor as far as you have explored it — laid on
  the ground a step ahead (`castSpot`: 3 m across, smaller if a wall comes
  first). Its light lives in the WORLD canvas (`FloorMap.tsx`, mounted by
  GameScene) so walls and wizards stand in front of it and it blooms with
  the world: a rune circle burns onto the floor, the floor under it dims,
  the tiles ripple out and walls, tents and standing stones rise as ribs
  of light (instanced, each born on its own beat), and markers kindle —
  every wizard on the floor (`net/players` poses), the floor's rift, the
  treasure, its room events and the Warden once seen (in the Proving
  Ground: the spawn stones and Varr's sigil). It carries no words (the
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
| New enemy | row in `enemies/roster.ts`, brain in `enemies/brains/`, model in `render/models/enemies.tsx`, kind in `enemies/kinds/`, renderer in `enemies/registry.tsx`, spawn weight in `world/gen/population.ts`; its body in `enemies/liveBody.ts#BODY_LOOK` and `puppet.ts` (tune), a corpse script in `enemies/corpses/corpseScripts.ts`, a weak spot if it has one |
| New prop | `world/props.tsx` spec + `render/models/PropModels.tsx` + generator prop table |
| New biome | row in `world/biomes.ts` + surfaces in `render/textures/painters/` (`kinds.ts`) + a drone in `scenes/floorAtmosphere.ts` |
| New omen | row in `world/omens.ts` (rules via `game/floorRules.ts`) |
| New lore | a fragment in `world/lore.ts` |
| New camp voice line | a line in `world/npcLines.ts` (gate it with `minDeepest`) |
| New decor | a row in `world/decor.ts` (+ a band's `DRESSING` line), a template in `render/models/decor/decorShapes.ts`, a tile in `render/textures/decorAtlas.ts` if it needs one |
| New room event | a row in `roomEvents/catalog.ts`, a branch in `roomEvents/rules.ts`, a view in `roomEvents/RoomEvents.tsx` (+ a builder in `render/models/roomEventModels.ts`) |
| New brew / forge work | a row in `items/crafting.ts` (`BREWS`, or `FORGE` + its cost function) — server and client share it |
| New material | `items/materials.ts` + a `material(…)` row in `items/catalog.ts` (keep it to seven unless the design changes) |
| Proving Ground rules / hall | `arena/rules.ts#ARENA` (shared with the relay); a `HallStyle` in `arena/layout.ts` (keep it four-fold symmetric — `layout.test.ts`) |
| Feel tuning | `game/vitality.ts` (knee, last stand, grace), `combat/impact.ts#STOP` (hitstop), `combat/numbers.ts`, `combat/momentum.ts`, `game/heart.ts#HEART`, `ui3d/layers/hud/markRules.ts#MARK` |
| A new venue's rule of the body | `setFallRule` in `state/gameStore.ts` (as `arena/arenaFlow.ts` does) |
| New networked entity | `useNetBody({ id, body, … })` — snapshots, interpolation, late-join, migration are automatic |
| New networked message | `hostEvent` / `hostCommand` / `peerMessage` in the owning module — zero server changes |
| New late-join state | `registerSyncProvider(key, { collect, apply })` |
| New HUD piece | a file in `ui3d/layers/hud/` + one line in its `Hud.tsx` |
| New screen / menu | a file in `ui3d/layers/menus/` + one line in `Menus.tsx` (wrap it in `<UiPresence>`, build it from `Tablet`/`RuneText`/`RuneButton`) |
| New scene switch / travel style | a kind in `transition/timeline.ts` and `travel(kind, …)` around the switch |
| New particle effect | a named function in `fx/effects.ts` (styles in `fx/particleSim.ts`) |
| New floor mark | a row painter in `render/textures/marks.ts` + a `DecalKind` in `fx/decals/decalPool.ts` (same order) and the event that lays it |
