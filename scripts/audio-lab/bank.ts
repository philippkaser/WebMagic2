// The audio lab's sound bank: every one-shot, bed and loop the game makes,
// one after another, so a change to the synthesis can be heard (and
// measured) sound by sound. Scenes "bank-<group>" (scene.ts) play a group;
// the lab logs where each sound starts so the WAV can be cut up.
import * as S from "../../src/audio/sound";
import * as U from "../../src/audio/uiSounds";
import * as V from "../../src/audio/voices";
import * as M from "../../src/ui3d/layers/menus/menuSounds";
import type { P3 } from "./scene";

export interface BankSound {
  name: string;
  /** Seconds to leave it before the next. */
  dur: number;
  /** Placed sounds get a point a few metres ahead; the rest ignore it. A
   * lasting sound returns its stop(), called after `dur`. */
  play(at: P3): void | (() => void);
  /** Play it again at these offsets (s) too (a creature's steps). */
  times?: number[];
}

const enemies = ["slime", "wisp", "shadow", "sentry"] as const;
const grounds = ["stone", "cobble", "wet", "crystal", "iron", "ash", "grass"] as const;
const roomVoices = ["drip", "chime", "ember", "groan", "settle", "skitter", "cricket", "owl"] as const;

export const BANK: Record<string, BankSound[]> = {
  combat: [
    { name: "cast", dur: 0.6, play: () => S.playCast() },
    { name: "cast-2", dur: 0.6, play: () => S.playCast() },
    { name: "cast-far", dur: 0.8, play: (at) => S.playCast(at) },
    { name: "hit", dur: 0.5, play: (at) => S.playHit(at) },
    { name: "hit-2", dur: 0.5, play: (at) => S.playHit(at) },
    { name: "explosion-small", dur: 2, play: (at) => S.playExplosion(2, at) },
    { name: "explosion-big", dur: 2.6, play: (at) => S.playExplosion(6, at) },
    { name: "hurt", dur: 0.7, play: () => S.playHurt() },
    { name: "pickup", dur: 0.9, play: () => S.playPickup() },
    { name: "jump", dur: 0.5, play: () => S.playJump() },
    { name: "landing", dur: 0.6, play: () => V.playLanding("stone", 0.8) },
    { name: "dash", dur: 0.6, play: () => S.playDash() },
    { name: "boss-roar", dur: 2.4, play: (at) => S.playBossRoar(at) },
  ],
  creatures: [
    ...enemies.map((k) => ({ name: `wake-${k}`, dur: 1.1, play: (at: P3) => V.playEnemyWake(k, at) })),
    ...(["slime", "shadow", "boss"] as const).map((k) => ({
      name: `steps-${k}`,
      dur: 1.8,
      times: [0, 0.45, 0.9, 1.35],
      play: (at: P3) => V.playEnemyStep(k, at),
    })),
    ...enemies.map((k) => ({ name: `death-${k}`, dur: 1.4, play: (at: P3) => V.playEnemyDeath(k, at) })),
  ],
  steps: grounds.map((g) => ({ name: `step-${g}`, dur: 1.4, times: [0, 0.35, 0.7, 1.05], play: () => V.playFootstep(g, 1, undefined, -1) })),
  world: [
    ...roomVoices.map((v) => ({ name: `room-${v}`, dur: v === "groan" || v === "chime" ? 2.6 : 1, play: (at: P3) => V.playRoomVoice(v, at) })),
    { name: "torch", dur: 4, play: (at) => { const l = V.startTorch(at); return () => l?.stop(); } },
    { name: "rift-hum", dur: 4, play: (at) => { const l = V.startRiftHum(at); return () => l?.stop(); } },
    { name: "portal", dur: 1.4, play: (at) => S.playPortal(at) },
  ],
  events: [
    { name: "presence", dur: 2.6, play: () => S.playPresence() },
    { name: "heartbeat", dur: 0.6, play: () => S.playHeartbeat(0.3) },
    { name: "heartbeat-close", dur: 0.6, play: () => S.playHeartbeat(1) },
    { name: "pact-sworn", dur: 1.6, play: () => S.playPactSworn() },
    { name: "pact-broken", dur: 1, play: () => S.playPactBroken() },
    { name: "grave-rise", dur: 2.2, play: (at) => S.playGraveRise(at) },
    { name: "whisper", dur: 2, play: (at) => S.playWhisper(at) },
    { name: "omen", dur: 3, play: () => S.playOmen() },
    { name: "weighing", dur: 2, play: () => S.playWeighing() },
  ],
  travel: [
    { name: "portal-enter", dur: 1.6, play: () => S.playPortalEnter(0.3) },
    { name: "tunnel", dur: 3, play: () => S.startTunnelRush(55, 1) },
    { name: "portal-arrive", dur: 1.8, play: () => S.playPortalArrive(0.3) },
    { name: "death-fade", dur: 2, play: () => S.playDeathFade() },
    { name: "respawn-rise", dur: 1.6, play: () => S.playRespawnRise() },
    { name: "feather-lift", dur: 1.6, play: () => S.playFeatherLift() },
    { name: "sealed-touch", dur: 0.9, play: () => S.playSealedTouch() },
    { name: "seal-break", dur: 1.8, play: () => S.playSealBreak() },
  ],
  ui: [
    { name: "tablet-build", dur: 1.1, play: () => U.playTabletBuild() },
    { name: "tablet-break", dur: 0.8, play: () => U.playTabletBreak() },
    { name: "holo-cast", dur: 1, play: () => U.playHoloCast() },
    { name: "holo-collapse", dur: 0.6, play: () => U.playHoloCollapse() },
    { name: "ui-hover", dur: 0.3, play: () => U.playUiHover() },
    { name: "ui-hover-2", dur: 0.3, play: () => U.playUiHover() },
    { name: "ui-press", dur: 0.5, play: () => U.playUiPress() },
    { name: "rune-write", dur: 0.8, play: () => U.playRuneWrite() },
    { name: "item-lift", dur: 0.4, play: () => U.playItemLift() },
    { name: "item-set", dur: 0.4, play: () => U.playItemSet() },
  ],
  menus: [
    { name: "thread", dur: 0.6, play: () => M.playThread(1) },
    { name: "resonance", dur: 2, play: () => M.playResonance() },
    { name: "floor-reveal", dur: 2.6, play: () => M.playFloorReveal() },
    { name: "death-toll", dur: 3.6, play: () => M.playDeathToll() },
    { name: "crumble", dur: 0.7, play: () => M.playCrumble(2) },
    { name: "grave-take", dur: 0.9, play: () => M.playGraveTake(2) },
    { name: "book-open", dur: 1, play: () => M.playBookOpen() },
    { name: "book-close", dur: 0.6, play: () => M.playBookClose() },
    { name: "page-turn", dur: 0.6, play: () => M.playPageTurn() },
    { name: "carve", dur: 0.25, play: () => M.playCarve() },
    { name: "carve-2", dur: 0.4, play: () => M.playCarve() },
  ],
  ambient: [
    // floorAtmosphere's biomes, and the village.
    ...(
      [
        ["catacombs", { drone: 41, wind: 220, weight: 1 }],
        ["drowned", { drone: 36.7, wind: 560, weight: 0.9 }],
        ["forge", { drone: 46.2, wind: 150, weight: 1.35 }],
        ["crystal", { drone: 55, wind: 1100, weight: 0.7 }],
        ["hollow", { drone: 30.9, wind: 90, weight: 0.45 }],
      ] as const
    ).map(([name, mood]) => ({ name: `bed-${name}`, dur: 8, play: () => { S.startAmbient("dungeon", mood); return () => S.stopAmbient(); } })),
    { name: "bed-village", dur: 8, play: () => { S.startAmbient("village"); return () => S.stopAmbient(); } },
  ],
};
