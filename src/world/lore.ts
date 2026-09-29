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
