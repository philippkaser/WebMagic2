/** The camp's voices as pure data: what the people of Riftwatch say to a
 * wizard — a greeting when you walk up, an idle bark while you stand about,
 * and a hint that depends on how deep you have ever been (the deepest floor
 * you walked home from, `deepest` in the save). Nothing here plays or shows
 * anything; whoever gives the camp its voices (speech plates, barks over a
 * stall) picks lines with `npcLines` / `pickNpcLine`.
 *
 * Same voice as the carvings (world/lore.ts): gritty, a little grim, not
 * humourless — these are people who went down, came back, and stayed by
 * the fire. Never name mechanics the way the UI does. What they hint at
 * follows the lore's gating: shallow wizards hear gossip and warnings; the
 * deep ones hear what the old hands won't say to anyone else.
 *
 * - Maro the Provisioner: stingy, dry, stopped descending years ago, sells
 *   feathers at a price only the dead could complain about.
 * - Old Wenna, the alchemist: brews what the deep sheds (wisp-ash,
 *   slime-gel, ward-shard grit); cackles; knows what the leavings are and
 *   brews them anyway.
 * - Brannoc the smith: went down nine times, came home with three gold
 *   rings and a hand that won't close; reforges ward-shard into steel; has
 *   begun to suspect what he is mending.
 * - Ysolde Varr, Master of the Proving Ground: a duellist who never went
 *   deeper than the forge, keeps the Founders' trial hall behind the
 *   obelisk, duels to the yield, her hall and her rules. */

export type NpcId = "maro" | "wenna" | "brannoc" | "varr";

export type NpcLineKind = "greeting" | "idle" | "hint";

export interface NpcLine {
  text: string;
  /** Only once the wizard has been at least this deep (default 0). */
  minDeepest?: number;
  /** Stops once they've been deeper than this (default: never). */
  maxDeepest?: number;
}

export interface NpcVoice {
  id: NpcId;
  name: string;
  /** How the camp refers to them. */
  title: string;
  greeting: readonly NpcLine[];
  idle: readonly NpcLine[];
  hint: readonly NpcLine[];
}

const VOICES: readonly NpcVoice[] = [
  {
    id: "maro",
    name: "Maro",
    title: "the Provisioner",
    greeting: [
      { text: "Coin first. Questions after, if you can afford them." },
      { text: "Back up the stairs, are you? Good. Dead customers haggle worse." },
      { text: "Feathers, draughts, orbs. Everything a wizard needs to come home poorer." },
      { text: "You've got that look. The one that says you're about to sell me something cheap." },
      { text: "Still breathing? I'll mark it down. Breathing customers are my favourite kind.", minDeepest: 5 },
      { text: "Ah. The deep one. Prices are the same for heroes, before you ask.", minDeepest: 30 },
    ],
    idle: [
      { text: "I went down once. Twice. Fine, eleven times. Then I learned arithmetic." },
      { text: "Wenna says my stall smells of fear. It's onions. Mostly onions." },
      { text: "Don't lean on the counter. It's older than you and it's held up better." },
      { text: "Everybody wants a discount. The deep doesn't give discounts, and neither do I." },
      { text: "A feather costs what it costs because the alternative costs everything." },
      { text: "Brannoc's hammering again. That means somebody's fool enough to go back down." },
    ],
    hint: [
      { text: "Five floors, then the deep lets go. Don't buy a feather to skip the tithe. Buy it because you might not finish it.", maxDeepest: 8 },
      { text: "Whatever you carry home, I'll buy. Whatever you die holding, the deep keeps. Choose which of us you'd rather enrich.", maxDeepest: 15 },
      { text: "Past the tombs the water tastes of honey. Don't drink it. Don't ask me how I know.", minDeepest: 8, maxDeepest: 25 },
      { text: "The Forge eats the careless and the brave alike. Take more draughts than you think. Then one more.", minDeepest: 18, maxDeepest: 40 },
      { text: "I don't buy riftglass. Nobody honest does. Ask Wenna why, and watch her not answer.", minDeepest: 25 },
      { text: "The ones who come back from the Hollow don't haggle. They just pay, and look at the fire.", minDeepest: 50 },
    ],
  },
  {
    id: "wenna",
    name: "Wenna",
    title: "Old Wenna, the alchemist",
    greeting: [
      { text: "Come in, come in. Mind the cauldron, it bites." },
      { text: "What did the deep shed for you today, child? Ash? Gel? Bring it here." },
      { text: "Sit. No, not there. That stool's for the ones who don't come back." },
      { text: "Hah! Still in one piece. Mostly. Let's see what I can do about the rest." },
      { text: "You smell of the forge. Good. Embers make a lovely broth.", minDeepest: 20 },
      { text: "You've been to the bottom of the singing, haven't you. Your eyes ring.", minDeepest: 40 },
    ],
    idle: [
      { text: "Wisp-ash for clarity, slime-gel for courage, shard-grit for spite. Stir widdershins." },
      { text: "The cauldron remembers everything that's been in it. I've stopped asking it questions." },
      { text: "Maro thinks I'm mad. Maro buys my draughts. Who's the mad one?" },
      { text: "Never drink a brew that's humming. Wait till it stops. Then drink it quick." },
      { text: "Every pot I've ever scorched, I scorched learning something. Mostly what not to do." },
      { text: "Hush. Hear that? No? Good. Neither do I. Let's keep it that way." },
    ],
    hint: [
      { text: "The things below don't bleed, child, they come apart. Bring me the pieces and I'll make them useful.", maxDeepest: 12 },
      { text: "Leave the candles in the tombs lit. I won't tell you why. Just do it.", maxDeepest: 10 },
      { text: "A ward stone still glowing is a ward that hasn't given up. Stand by it and it'll stand by you.", minDeepest: 8, maxDeepest: 40 },
      { text: "Riftglass isn't a stone. It's a scab. Bring me one and I'll trade you a month of broth.", minDeepest: 12, maxDeepest: 55 },
      { text: "The shrines give freely. Nothing gives freely. Count what you have before you kneel, and after.", minDeepest: 15 },
      { text: "You've seen the bottom of the Hollow? Then you know why I brew what I brew. Hush, now. Drink.", minDeepest: 60 },
      { text: "A brew is just a way of carrying something somewhere. Mine go back down the stairs. Think on it.", minDeepest: 75 },
    ],
  },
  {
    id: "brannoc",
    name: "Brannoc",
    title: "Brannoc the smith",
    greeting: [
      { text: "Put it on the anvil. Let's see what the deep did to it." },
      { text: "Mind the sparks. And the hammer. Mostly the hammer." },
      { text: "Bent, cracked or cursed? I fix the first two." },
      { text: "Another one come for steel. Good. Somebody has to use it." },
      { text: "You've been in the Forge. I can tell by your boots. Nothing else scorches like that.", minDeepest: 20 },
      { text: "Deep one. Sit. I'll not charge you for the fire.", minDeepest: 45 },
    ],
    idle: [
      { text: "Nine times I went down. Three gold rings and this hand to show for it. Fair trade, some days." },
      { text: "Iron from the deep remembers where it was found. Hammer it long enough and it forgets. Mostly." },
      { text: "The hand doesn't close. The other one does. That's one more than the deep left most." },
      { text: "A good edge is patience. A good wizard is the same, only rarer." },
      { text: "Wenna wants my slag for her pot. I've stopped asking what for." },
      { text: "Maro keeps saying he'll pay me back. Maro keeps saying a lot of things." },
    ],
    hint: [
      { text: "Bring me sentry shards. A ward that held a door for a thousand years holds an edge just as stubborn.", maxDeepest: 20 },
      { text: "Drowned iron rusts outside and stays bright within. Don't throw away what looks spoiled.", minDeepest: 8, maxDeepest: 30 },
      { text: "Those are Founders' anvils down in the Forge. Cold now. Don't sit on them; it feels like trespassing.", minDeepest: 18, maxDeepest: 45 },
      { text: "Crystal won't be forged. It'll be persuaded, if it likes you. Most days it doesn't like me.", minDeepest: 35 },
      { text: "Every shard I reforge goes back down on somebody's back. I used to think that was the point of a smith.", minDeepest: 55 },
      { text: "I think I've been mending something. Not blades. Something bigger, with a hole in it.", minDeepest: 80 },
    ],
  },
  {
    id: "varr",
    name: "Ysolde Varr",
    title: "Varr, Master of the Proving Ground",
    greeting: [
      { text: "The obelisk opens on my hall. Duels to the yield, not the death. My hall, my rules." },
      { text: "Come to test your staff on someone who'll hit back fairly? That's the only kind of fight I keep." },
      { text: "Name, staff, and whether you yield gracefully. Two of those I can teach." },
      { text: "Back from below? The hall's warm. Go in and lose to someone who'll shake your hand after." },
      { text: "You've been through the Forge and you still want a fair fight? Good. Sharpen it here.", minDeepest: 20 },
    ],
    idle: [
      { text: "Nine seasons undefeated. I've never been deeper than the forge, and I never will be." },
      { text: "The deep is no place for a fair fight. That's why I keep one up here." },
      { text: "Yield when you're beaten. The hall gives back the blood, not the pride." },
      { text: "A fellowship that's sparred together descends together. Mostly." },
      { text: "Strike, step, strike. Most of you forget the step." },
      { text: "Maro bets against me every season. He's never once been right, and he's never once stopped." },
    ],
    hint: [
      { text: "The Founders cut that hall for their wardens to learn each other's hands. Learn your friends' here, before the deep teaches you.", maxDeepest: 25 },
      { text: "Down below, a stranger is a stranger until they've sworn. In my hall everyone has sworn. That's the difference.", maxDeepest: 30 },
      { text: "If the tear forks under you and your fellowship goes down while you go up, you weren't a fellowship. You were company.", minDeepest: 5 },
      { text: "The hall gives back the blood spilled in it. I asked the stones once where it goes the rest of the time. They didn't answer.", minDeepest: 30 },
      { text: "The Founders taught their wardens to fight each other first, so they'd never fear the one beside them. I teach the same. I'm starting to wonder what for.", minDeepest: 58 },
    ],
  },
];

const byId = new Map(VOICES.map((v) => [v.id, v]));

export function allNpcVoices(): readonly NpcVoice[] {
  return VOICES;
}

export function getNpcVoice(id: NpcId): NpcVoice {
  const v = byId.get(id);
  if (!v) throw new Error(`Unknown NPC: ${id}`);
  return v;
}

/** The lines of a kind this NPC would say to a wizard who has been as deep
 * as `deepest`, in table order. */
export function npcLines(id: NpcId, kind: NpcLineKind, deepest: number): NpcLine[] {
  return getNpcVoice(id)[kind].filter((l) => deepest >= (l.minDeepest ?? 0) && deepest <= (l.maxDeepest ?? Infinity));
}

/** One line for this moment. `roll` is any 0..1 number (Math.random for a
 * bark, or a seeded draw); hints lean toward the deepest-gated line the
 * wizard qualifies for, so the camp talks about where you've just been. */
export function pickNpcLine(id: NpcId, kind: NpcLineKind, deepest: number, roll: number): NpcLine | null {
  const pool = npcLines(id, kind, deepest);
  if (pool.length === 0) return null;
  const weight = (l: NpcLine) => (kind === "hint" ? 1 + (l.minDeepest ?? 0) / 10 : 1);
  const total = pool.reduce((s, l) => s + weight(l), 0);
  let r = Math.min(0.999999, Math.max(0, roll)) * total;
  for (const l of pool) {
    r -= weight(l);
    if (r < 0) return l;
  }
  return pool[pool.length - 1];
}
