import type { Rng } from "../core/rng";

/** Lore as pure data — the words wizards (and older hands) left carved into
 * the dungeon's walls. Runes are placed by world/gen/lorePlacement.ts; this
 * module only knows what the fragments say and how deep each one lives.
 *
 * What the fragments collectively know (keep new ones consistent):
 * - A village of wizards sits atop a hundred-floor dungeon. God is said to
 *   wait at the bottom. Nobody has proven it.
 * - The Weighing Gate — the village portal — weighs the resonance of what a
 *   wizard carries and casts them down to where their weight belongs.
 * - The Tithe of Five: the deep lets a wizard go only after they have given
 *   it five floors; after that, any way home leads back up.
 * - The dungeon keeps what the dead carried, but it is jealous and slow:
 *   where living wizards stand witness it can't swallow the dead fast enough,
 *   and a grave remains that anyone may plunder.
 * - Wizards rarely meet below; the deep keeps them apart, and listens when it
 *   lets them meet. Pacts sworn below bind the staff, not the heart.
 * - Wisps are the drifting light of wizards who died alone; sentries are the
 *   Founders' wardstones, which no longer know friend from foe; shadows are
 *   what an oathbreaker leaves behind; slimes are the dungeon's slow
 *   digestion; the Warden is the jailer, the Founders' last ward.
 * - The deepest secret, only ever hinted at the bottom: the Founders built the
 *   village not to get something out, but to keep something in.
 * - The camp at the rift: Maro the Provisioner (stingy, stopped descending
 *   years ago), Old Wenna the alchemist (brews what the deep sheds, knows
 *   more than she says), Brannoc the smith (went down nine times, came home
 *   with three gold rings and a hand that won't close), and Varr, who keeps
 *   the Proving Ground — the Founders' old trial hall, reached through the
 *   obelisk by the fire, where duels end at the yield because the hall
 *   gives back the blood spilled in it.
 * - What the creatures leave (shards, ash, gel, cores) is the Founders' wards
 *   breaking down — the deep digests the wards, not the wizards. Riftglass
 *   is a crystallized piece of the rift: the tear being held shut, coming
 *   off in pieces. Carrying the pieces home thins the lid; the alchemist and
 *   the smith, knowingly or not, send them back down.
 * - One tear per floor: once the tithe is paid it forks as you step in, the
 *   way home and the way down. Deep enough, the way home narrows.
 * - Fellowships descend together and swear at the Gate; the deep parts them
 *   anyway. Vault chests open for anyone (that's the trouble), ward stones
 *   still lit draw everything the deep has, and shrines give freely —
 *   because what a wizard leaves at a shrine, the lid keeps.
 *
 * Tone: gritty, a little grim, not humourless. Wizards are treasure hunters,
 * not chosen ones. Never name mechanics the way the UI does. */

export interface LoreFragment {
  id: string;
  /** What kind of writing it is, as a reader would describe it. */
  title: string;
  /** One to four sentences. */
  text: string;
  /** Shallowest floor the fragment can be carved on. */
  minFloor: number;
  /** Deepest floor it can be carved on (default: the bottom). Shallow gossip
   * stops turning up once a wizard is deep enough to know better. */
  maxFloor?: number;
}

const BOTTOM = 100;

const FRAGMENTS: readonly LoreFragment[] = [
  // ── The Catacombs: arrivals, the Gate, the tithe, the builders' tombs ──────
  {
    id: "novice-first-page",
    title: "A Novice's Journal, First Page",
    text: "Old Hesk says the Gate doesn't care how brave you are, only what you carry. It hummed at my borrowed staff and dropped me barely under the village. Fine. Everyone starts in the tombs.",
    minFloor: 1,
    maxFloor: 8,
  },
  {
    id: "gate-inscription",
    title: "Founders' Inscription",
    text: "The Gate weighs what thou bearest, not what thou art. Go down where thy weight belongs, and no deeper, lest the deep weigh thee in turn.",
    minFloor: 1,
    maxFloor: 16,
  },
  {
    id: "tithe-of-five",
    title: "Carved Above a Doorway",
    text: "Five floors to the deep, and then the deep lets go. Pay the tithe in full. Nobody climbs home on credit.",
    minFloor: 1,
    maxFloor: 14,
  },
  {
    id: "god-chalk",
    title: "Graffiti, Fresh Chalk",
    text: "GOD IS AT THE BOTTOM. Underneath, in another hand: then god can come up and get me.",
    minFloor: 1,
    maxFloor: 22,
  },
  {
    id: "pockets-with-legs",
    title: "A Tally Cut into a Pillar",
    text: "Brannoc: three gold rings. Wynn: a staff that sings. Old Pell: nothing, again. We are not heroes, we are pockets with legs, and the deep can tell.",
    minFloor: 1,
    maxFloor: 12,
  },
  {
    id: "builders-epitaph",
    title: "An Epitaph",
    text: "Here lie the hands that cut these halls. They dug the way down and asked to be buried on it, so no one would forget who dug first.",
    minFloor: 1,
    maxFloor: 9,
  },
  {
    id: "it-keeps",
    title: "A Warning, Scratched Deep",
    text: "What you die holding, it keeps. Coin, staff, the ring your sister gave you. The deep has never once given anything back.",
    minFloor: 1,
    maxFloor: 30,
  },
  {
    id: "wisps-alone",
    title: "A Journal Scrap, Water-Stained",
    text: "The blue lights drift toward you like they want company. Mother said a wisp is a wizard who died with no one near to hear it. Don't answer them. They only want to be found.",
    minFloor: 2,
    maxFloor: 28,
  },
  {
    id: "slow-digestion",
    title: "Notes of Ilse the Cartographer",
    text: "The slimes are not beasts. They are the dungeon chewing: slow, patient, everywhere. Cut one and it only chews faster.",
    minFloor: 3,
    maxFloor: 30,
  },
  {
    id: "moods",
    title: "Notes of Ilse the Cartographer",
    text: "The deep has moods, and we call them omens. Some days it chokes its own torches; some days it forgets to pull you down. Read the air the moment you arrive. The deep always tells you, once.",
    minFloor: 2,
    maxFloor: 60,
  },
  {
    id: "tithe-tallies",
    title: "Marks Beside a Doorway",
    text: "Tally marks, five to a bundle, row after row. Every bundle ends in a crude little door. Someone paid the tithe more times than anyone should, and always came home.",
    minFloor: 5,
    maxFloor: 40,
  },

  {
    id: "wenna-cauldron",
    title: "Scrawled on a Recipe Card",
    text: "Old Wenna boils whatever we bring her: wisp-ash, slime-gel, the grit off a broken ward. She swears the deep's leavings brew better than any herb on the mountain. She also says never to ask what the cauldron is remembering when it hisses.",
    minFloor: 1,
    maxFloor: 20,
  },
  {
    id: "brannoc-hand",
    title: "Carved by a Smith's Apprentice",
    text: "Brannoc went down nine times and came home with three gold rings and a hand that won't close. Now he swings the hammer with the other one. He says iron from the deep remembers where it was found, and leans that way.",
    minFloor: 1,
    maxFloor: 18,
  },
  {
    id: "parts-left-behind",
    title: "Notes of Ilse the Cartographer",
    text: "The things down here don't bleed, they come apart. A sentry leaves shards, a wisp leaves cold ash, a slime leaves gel that never dries. Whatever the deep makes them from, it makes them to be taken apart.",
    minFloor: 2,
    maxFloor: 26,
  },
  {
    id: "fellowship-rules",
    title: "Rules Chalked by a Fellowship",
    text: "Swear together at the Gate. Split the gold at the fire and never before. If one of us falls, the rest finish the tithe; the dead don't get a share.",
    minFloor: 1,
    maxFloor: 30,
  },
  {
    id: "one-tear",
    title: "Carved Beside a Rift",
    text: "There's only ever one tear out of a floor. Pay the tithe and it forks as you step in: one way up toward the fire, one way down into the dark. The deep always lets you see both. It likes to watch you choose.",
    minFloor: 3,
    maxFloor: 30,
  },
  {
    id: "vault-chest",
    title: "Scratched into an Iron Lid",
    text: "The Founders' vault chests open for anyone. That's the trouble. Count the doorways behind you before you lift the lid.",
    minFloor: 2,
    maxFloor: 40,
  },
  {
    id: "maro-feathers",
    title: "Graffiti, Charcoal",
    text: "MARO SELLS FEATHERS AT A PRICE ONLY THE DEAD COULD COMPLAIN ABOUT. Underneath, smaller: and they do.",
    minFloor: 1,
    maxFloor: 12,
  },
  {
    id: "riftglass-sliver",
    title: "A Prospector's Ledger",
    text: "Found a sliver of the rift itself, gone hard as glass and cold as a well in winter. Wenna offered me a month of broth for it. I'm keeping it. It hums whenever I come near the tear.",
    minFloor: 4,
    maxFloor: 40,
  },
  {
    id: "proving-ground-notice",
    title: "A Notice, Nailed Up Even Here",
    text: "To all who would test a staff on a friend before testing it on the deep: the obelisk by the fire opens on the Proving Ground. Duels to the yield, not the death. Varr keeps the rules, and Varr keeps the score.",
    minFloor: 1,
    maxFloor: 15,
  },
  {
    id: "candles-kept",
    title: "A Journal Scrap, Wax-Spattered",
    text: "Someone keeps the candles burning in the tombs. Not us; we carry torches. I asked the old hands about it and all they said was: leave them lit.",
    minFloor: 1,
    maxFloor: 9,
  },
  {
    id: "banner-seal",
    title: "Notes of Ilse the Cartographer",
    text: "The rotted banners all bear one sign, a ring with a bar beneath it. I took it for the sun on the horizon. Hesk says it's a lid on a well.",
    minFloor: 4,
    maxFloor: 30,
  },

  // ── The Drowned Halls: the sea, graves and witnesses, the jailer ──────────
  {
    id: "sea-got-in",
    title: "Journal of a Diver-Wizard",
    text: "The salt came through a crack the Founders never found. Now the halls breathe like tidepools, and the walls weep a brine that tastes of no sea I know.",
    minFloor: 10,
    maxFloor: 24,
  },
  {
    id: "deep-end",
    title: "Graffiti in Wet Chalk",
    text: "IF YOU CAN READ THIS YOU ARE IN THE DEEP END. Beneath it, smaller: swim up.",
    minFloor: 10,
    maxFloor: 19,
  },
  {
    id: "graves-and-witnesses",
    title: "A Scavenger's Rule",
    text: "Die alone and the floor drinks you before you're cold. Die where living eyes are on you and it chokes on its own greed; you leave a grave, and anyone may open it. Mind which of the two your friends are counting on.",
    minFloor: 6,
    maxFloor: 45,
  },
  {
    id: "warden-jailer",
    title: "Founders' Inscription, Half-Drowned",
    text: "Our last ward we name the Warden. It is no guard, for guards may be bribed. It is a jailer, and a jailer only ever faces one way.",
    minFloor: 9,
    maxFloor: 45,
  },
  {
    id: "wardstones",
    title: "Later Notes of Ilse the Cartographer",
    text: "The sentries are wardstones. The Founders set them to know friend from foe, and somewhere in the centuries they forgot which was which. Now everything is foe. I cannot say they are wrong.",
    minFloor: 5,
    maxFloor: 38,
  },
  {
    id: "maela-and-orrin",
    title: "An Oath, Carved Twice",
    text: "Sworn below, by staff and not by heart: Maela and Orrin share what they find, and neither turns on the other. The second carving bears Orrin's name alone. Maela's is gouged out.",
    minFloor: 12,
    maxFloor: 32,
  },

  {
    id: "ward-stone-orders",
    title: "Expedition Orders, Water-Stained",
    text: "Where you find a ward stone still lit, stand by it. The deep throws everything it has at a ward that hasn't broken yet. Hold it, and the room is yours for a while.",
    minFloor: 8,
    maxFloor: 40,
  },
  {
    id: "wenna-gel-draught",
    title: "Old Wenna's Recipe, Copied Down",
    text: "Two scoops of slime-gel, a pinch of wisp-ash, stir it widdershins until it stops complaining. Drink it fast. The taste is the cure working.",
    minFloor: 6,
    maxFloor: 30,
  },
  {
    id: "brannoc-ores",
    title: "Brannoc's Tally of Ores",
    text: "Drowned iron rusts outside and stays bright within. Forge iron comes up still warm a week later. Crystal you don't forge at all; it lets you shape it if it likes you.",
    minFloor: 10,
    maxFloor: 40,
  },
  {
    id: "shrine-cost",
    title: "Scratched Beside a Shrine",
    text: "The shrines give, I'll grant them that. But every blessing I took cost me something I only noticed missing two stairs later.",
    minFloor: 10,
    maxFloor: 60,
  },
  {
    id: "fellowship-together",
    title: "A Fellowship's Journal, Last Entries",
    text: "Five of us went through the Gate holding hands and, for once, woke on one stair together. We laughed about it. That was the deep being generous, and it has never been generous twice.",
    minFloor: 10,
    maxFloor: 35,
  },
  {
    id: "honey-water",
    title: "A Diver-Wizard's Note",
    text: "The water down here tastes of salt and iron and, underneath it, something like old honey. The slimes grow fat on it. So does whatever feeds on the slimes.",
    minFloor: 10,
    maxFloor: 22,
  },
  {
    id: "vault-note",
    title: "A Thief's Boast",
    text: "Opened a vault chest with a bent nail and a prayer. Gold inside, and a note in a Founders' hand: TAKE IT. WE KNOW WHERE YOU ARE NOW.",
    minFloor: 10,
    maxFloor: 45,
  },
  {
    id: "riftglass-scab",
    title: "Old Wenna's Sayings, Taken Down",
    text: "Riftglass isn't a stone, child, it's a scab. The tear heals a little every time one of you goes through it. Now and then a piece of the healing comes loose and rolls down the stairs.",
    minFloor: 12,
    maxFloor: 60,
  },

  // ── The Ember Forge: wards, pacts and those who break them ────────────────
  {
    id: "forge-inscription",
    title: "Founders' Inscription, Iron-Set",
    text: "Here we forged the wards that watch the ways. Hammer, flame and blood went into them. Let no one ask whose blood.",
    minFloor: 20,
    maxFloor: 42,
  },
  {
    id: "forge-still-burns",
    title: "A Smith's Complaint",
    text: "Centuries, and the forge still burns with nobody feeding it. Either the Founders built better than we ever will, or something down here keeps the fire lit for reasons of its own.",
    minFloor: 20,
    maxFloor: 34,
  },
  {
    id: "staff-not-heart",
    title: "The Oathkeeper's Primer",
    text: "A pact sworn below binds the staff, not the heart. The staff remembers who you swore to. Your heart is free to regret it.",
    minFloor: 15,
    maxFloor: 60,
  },
  {
    id: "oathbreaker-shadows",
    title: "A Whispered Warning",
    text: "Shadows are what an oathbreaker leaves behind when the deep takes the rest. They wait in doorways, hoping to be trusted again. Never be the one who trusts them.",
    minFloor: 8,
    maxFloor: 70,
  },
  {
    id: "kept-apart",
    title: "Journal of Two Friends",
    text: "We held hands through the Gate and still woke on different stairs. The deep keeps us apart. When it does let two wizards meet, it is only because it wants to hear what they will say.",
    minFloor: 15,
    maxFloor: 55,
  },
  {
    id: "founders-ledger",
    title: "Founders' Ledger, Burnt at the Edges",
    text: "Wards sealed: nine hundred. Wardstones set: past counting. Warden-cores tempered: the last and the best of them. May they hold as long as they are needed, which is to say forever.",
    minFloor: 25,
    maxFloor: 60,
  },

  {
    id: "wards-shedding",
    title: "Founders' Ledger, a Later Page",
    text: "The wards wear. Each one sheds as it fails: shards from the stones, ash from the lights, gel from the slow ones. Gather the shed pieces and reforge them, or the deep will gather them first.",
    minFloor: 20,
    maxFloor: 50,
  },
  {
    id: "brannoc-shard-temper",
    title: "A Smith's Note, Soot-Black",
    text: "Brannoc swears sentry shard tempers a staff better than any coal on the mountain. Of course it does. It was a ward once. It remembers how to hold.",
    minFloor: 20,
    maxFloor: 40,
  },
  {
    id: "trial-hall",
    title: "Founders' Inscription, the Trial Hall",
    text: "Here the wardens-to-be shall strike at one another until each knows the other's hand. Let no blood be spilled in this hall that the hall does not give back.",
    minFloor: 15,
    maxFloor: 45,
  },
  {
    id: "varr-fair-fight",
    title: "Carved Beneath a Pact",
    text: "Varr has won the Proving Ground nine seasons running and has never come deeper than the forge. She says the deep is no place for a fair fight. She's right, which is why I'm down here and she isn't.",
    minFloor: 20,
    maxFloor: 50,
  },
  {
    id: "wenna-embers",
    title: "Old Wenna's Recipe, Scorched",
    text: "One ember from the forge brings any brew to the boil without a fire. Two burn the pot through. Bring three and Wenna will want to know exactly where you found them.",
    minFloor: 20,
    maxFloor: 34,
  },
  {
    id: "cold-anvils",
    title: "A Journal, the Forge Floor",
    text: "There are anvils down here, dented and cold, hammers left lying where they were dropped. Whoever worked them meant to come back. Nobody comes back to an anvil they mean to leave.",
    minFloor: 20,
    maxFloor: 34,
  },
  {
    id: "up-or-down",
    title: "A Tally Scratched by a Rift",
    text: "Up, down, up, down, down, down, down. The column of marks ends there.",
    minFloor: 20,
    maxFloor: 60,
  },
  {
    id: "split-by-the-fire",
    title: "The Oathkeeper's Primer, Margin Notes",
    text: "A fellowship that splits its loot in the dark splits itself as well. Count it by the fire, in the light, with every hand where the others can see it.",
    minFloor: 15,
    maxFloor: 50,
  },

  // ── The Crystal Deep: singing bones, listening, doubt ─────────────────────
  {
    id: "singing-bones",
    title: "A Listener's Journal",
    text: "The crystals ring when you strike them. Tessaly thinks they are the dungeon's bones. If so, it is humming to itself, and it only hums when it is pleased.",
    minFloor: 35,
    maxFloor: 62,
  },
  {
    id: "crystal-knows-my-name",
    title: "A Prospector's Scrawl",
    text: "Pried a fist of singing crystal loose. It has not stopped singing. It is singing my name now, and I never told it my name.",
    minFloor: 35,
    maxFloor: 54,
  },
  {
    id: "swear-nothing",
    title: "Scratched Beneath a Pact",
    text: "Swear nothing aloud down here. The deep does not care what you promise each other. It cares that you promised, and it remembers when you break it.",
    minFloor: 30,
    maxFloor: 85,
  },
  {
    id: "no-god-argument",
    title: "An Argument in Two Hands",
    text: "There is no god below, only more stairs. Then why did the Founders build a village on top of them?",
    minFloor: 30,
    maxFloor: 75,
  },
  {
    id: "too-heavy",
    title: "A Veteran's Journal",
    text: "I have carried enough through the Gate that it drops me past the forge now. My weight belongs here, it says. Some days I wish I were lighter.",
    minFloor: 30,
    maxFloor: 70,
  },

  {
    id: "riftglass-silence",
    title: "A Listener's Journal",
    text: "I held a piece of riftglass up to the singing crystals and every one of them went quiet, the whole cavern at once. I think they knew it. I think it's the same stuff, only older.",
    minFloor: 35,
    maxFloor: 70,
  },
  {
    id: "cut-to-come-apart",
    title: "Later Notes of Ilse the Cartographer",
    text: "The shards the sentries drop are cut. Not broken: cut, along lines, like a jeweller's work. They were made to come apart, and made to come apart down here.",
    minFloor: 35,
    maxFloor: 70,
  },
  {
    id: "shrine-free",
    title: "A Pilgrim's Confession",
    text: "I knelt at a shrine and asked for strength, and it gave it. It asked nothing back. That frightened me more than any price would have.",
    minFloor: 35,
    maxFloor: 80,
  },
  {
    id: "ward-stone-song",
    title: "Scratched Beside a Ward Stone",
    text: "Kept the ward lit for an hour against everything that came. When it was over the stone was warm and humming a tune my grandmother used to sing. I have never once sung it near the Gate.",
    minFloor: 35,
    maxFloor: 75,
  },
  {
    id: "fellowship-last-oath",
    title: "A Fellowship's Last Oath",
    text: "If the deep parts us, wait at the tear. If the tear forks, take the way up. If any of us takes the way down alone, the rest are released from this oath, and from grief.",
    minFloor: 35,
    maxFloor: 80,
  },
  {
    id: "brannoc-crystal",
    title: "Brannoc's Margin Notes",
    text: "Crystal can't be forged, only persuaded. I laid a shard on the anvil and it rang the note I meant to strike before I struck it.",
    minFloor: 35,
    maxFloor: 60,
  },

  // ── The Hollow: silence, pale light, the lid ───────────────────────────────
  {
    id: "hollow-listens",
    title: "The Last Page of a Journal",
    text: "No wind. No drip. My footsteps come back a breath too late. Something here is listening, and it is very patient.",
    minFloor: 55,
  },
  {
    id: "old-teeth",
    title: "Scratched with a Fingernail",
    text: "the light down here is the colour of old teeth. do not follow it.",
    minFloor: 55,
  },
  {
    id: "someone-lit-it",
    title: "A Journal, the Hand Failing",
    text: "Found a torch burning down here, small and warm, and sat by it an hour as if it were a hearth at home. Someone lit it. There is no one down here to have lit it.",
    minFloor: 58,
    maxFloor: 96,
  },
  {
    id: "leash",
    title: "An Oath Carved over Older Oaths",
    text: "We swore to reach the bottom together. There is only me now, and the oath still pulls at my staff like a leash toward the dark.",
    minFloor: 60,
  },
  {
    id: "waiting-to-be-let-out",
    title: "Unsigned, Carved Very Small",
    text: "They told us god waits at the bottom. They never said what it was waiting for.",
    minFloor: 72,
  },
  {
    id: "stone-upon-a-well",
    title: "Founders' Inscription, Deepest Stair",
    text: "Let the village stand upon the door as a stone upon a well. Let them believe they go down for gold. So long as they keep coming down, nothing comes up.",
    minFloor: 82,
  },
  {
    id: "the-lid",
    title: "Founders' Last Inscription",
    text: "We did not dig this to bring anything out. We dug it to put something in, and built our homes on the lid. If you have read this far, the lid is thinner than we meant.",
    minFloor: 92,
  },

  {
    id: "digesting-the-wards",
    title: "The Last Page of Ilse's Notes",
    text: "The deep isn't digesting us. It's digesting the wards. Every creature we kill is a ward giving up its pieces, and every piece we carry home is one brick fewer in the lid.",
    minFloor: 60,
  },
  {
    id: "riftglass-held-shut",
    title: "Unsigned, in a Shaking Hand",
    text: "Riftglass isn't the rift healing. It's the rift being held shut, and the holding coming off in pieces.",
    minFloor: 66,
  },
  {
    id: "trained-together",
    title: "Founders' Inscription, Beneath the Trial Hall",
    text: "We taught them to fight one another first, so that when the time came they would face what is below without fearing the one beside them.",
    minFloor: 58,
  },
  {
    id: "shrines-feed-the-lid",
    title: "Founders' Inscription, Behind a Shrine",
    text: "Let the shrines give freely. Whatever a wizard leaves at a shrine, the lid keeps.",
    minFloor: 70,
  },
  {
    id: "last-ward-stone",
    title: "Founders' Ledger, the Final Page",
    text: "When the last ward stone falls, someone must stand where it stood. We have asked our children to. We do not know whose children will be asked next.",
    minFloor: 75,
  },
  {
    id: "narrowing-way-home",
    title: "Carved at a Rift, Very Deep",
    text: "The tear forks here like everywhere else. But this deep the way home is narrower than the way down, and every time I look it's narrower still.",
    minFloor: 85,
  },
  {
    id: "wenna-knew",
    title: "A Letter Never Sent",
    text: "Wenna, you knew. You knew what the leavings are and you brew them anyway, because a brew is a way of carrying them back down. You've been putting the bricks back.",
    minFloor: 80,
  },
  {
    id: "brannoc-mending",
    title: "Brannoc's Last Ledger Line",
    text: "Every ward I ever reforged went back down the stairs on somebody's back. I thought I was arming them. I was mending the lid.",
    minFloor: 88,
  },
  {
    id: "vault-bait",
    title: "Founders' Inscription, Inside a Vault Lid",
    text: "What we leave in these vault chests we leave as bait, and we are not proud of it. Whoever lifts this lid, the deep has your weight now.",
    minFloor: 62,
  },
];

const byId = new Map(FRAGMENTS.map((f) => [f.id, f]));

export function allLoreFragments(): readonly LoreFragment[] {
  return FRAGMENTS;
}

export function getLoreFragment(id: string): LoreFragment {
  const fragment = byId.get(id);
  if (!fragment) throw new Error(`Unknown lore fragment: ${id}`);
  return fragment;
}

/** Fragments that can be carved on this floor, in table order. */
export function loreFragmentsForFloor(floor: number): LoreFragment[] {
  return FRAGMENTS.filter((f) => floor >= f.minFloor && floor <= (f.maxFloor ?? BOTTOM));
}

/** Picks a fragment for this floor (one rng draw), skipping ids in `exclude`.
 * Weighted toward fragments that "belong" at this depth — those whose band
 * starts close to the floor — so a deep floor mostly speaks of deep things
 * while older, shallower writing still turns up now and then. Returns null
 * only when nothing is left to carve. */
export function pickLoreFragment(
  rng: Rng,
  floor: number,
  exclude: ReadonlySet<string> = new Set(),
): LoreFragment | null {
  const pool = loreFragmentsForFloor(floor).filter((f) => !exclude.has(f.id));
  if (pool.length === 0) return null;
  const weightOf = (f: LoreFragment) => 1 + (2 * f.minFloor) / Math.max(1, floor);
  const total = pool.reduce((s, f) => s + weightOf(f), 0);
  let r = rng.next() * total;
  for (const f of pool) {
    r -= weightOf(f);
    if (r <= 0) return f;
  }
  return pool[pool.length - 1];
}
