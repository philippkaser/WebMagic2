import { playCritDing, playHitConfirm, playKillConfirm, playStreak } from "../audio/combatSounds";
import { PLAYER } from "../core/config";
import { gameEvents, type GameEvents } from "../core/events";
import { hitstop } from "../core/presentTime";
import { getLife } from "../enemies/lifeBoard";
import { hitSparksFx } from "../fx/effects";
import { useGame } from "../state/gameStore";
import { createConfirm, flushConfirm, marksAt, newMarks, noteHit, noteKill, pendingDue, type ConfirmSound, type Marks } from "./confirm";
import { createStopper, hitstopFor, punchFor, requestStop, STOP } from "./impact";
import { landing } from "./landing";
import { chimeStep, createMomentum, creditKill, heatAt, predictKill, stepRatio } from "./momentum";
import { addNumber, createNumbers, stepNumbers, type NumberPool } from "./numbers";

/** What the shooter feels, wired up: listens for the enemy shell's reports
 * of YOUR hits and kills (`enemyHit` / `enemyKilled` with mine = true) and
 * answers — the confirm's ticks and "tk", the kill's X, chime and punch,
 * the frame catching (core/presentTime hitstop), gold sparks off a weak
 * point, the numbers, the streak's chime, words and mana.
 *
 * All of it is the local client's own presentation. The host still decides
 * damage and death; floor-mates never see or hear your confirms. The pure
 * rules live beside this file (confirm, impact, momentum, numbers); the
 * crosshair, the numbers layer and the staff read the state here. */

const nowS = () => performance.now() / 1000;

const confirm = createConfirm();
const momentum = createMomentum();
const stopper = createStopper();
/** Your damage numbers (ui3d/layers/combat/DamageNumbers draws them). */
export const damageNumbers: NumberPool = createNumbers();

/** Gold: a weak point's sparks. */
const CRIT_SPARK = "#ffd27a";

/** Dev: the marks and numbers held still at this moment (screenshots on a
 * machine too slow to catch a 0.1 s tick), or null. */
let heldAt: number | null = null;

/** The crosshair's marks right now. */
export function hitMarks(out: Marks): Marks {
  return marksAt(confirm, heldAt ?? nowS(), out);
}

/** How hot the staff burns from your streak, 0…1. */
export function streakHeat(): number {
  return heatAt(momentum, nowS());
}

/** Age the numbers (the numbers layer calls this each frame). */
export function stepDamageNumbers(dt: number): void {
  if (heldAt === null) stepNumbers(damageNumbers, dt);
}

function playConfirm(s: ConfirmSound): void {
  playHitConfirm(s.weight, s.pitch);
  if (s.crit) playCritDing(s.pitch);
}

// ── The sound gate's held sound ─────────────────────────────────────────────

let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(now: number): void {
  const due = pendingDue(confirm);
  if (due === null || flushTimer !== null) return;
  flushTimer = setTimeout(flush, Math.max(0, (due - now) * 1000) + 1);
}

function flush(): void {
  flushTimer = null;
  const now = nowS();
  const s = flushConfirm(confirm, now);
  if (s) playConfirm(s);
  else scheduleFlush(now);
}

// ── Hits and kills ──────────────────────────────────────────────────────────

const spark = { x: 0, y: 0, z: 0 };

/** The shot's heft: what the weapon said (combat/landing), or — a hit from
 * elsewhere — its share of the creature's life. */
function weightOf(id: string, damage: number): number {
  if (Number.isFinite(landing.weight)) return landing.weight;
  const life = getLife(id);
  return life ? Math.min(1, Math.max(0.15, (damage / Math.max(1, life.maxHp)) * 2)) : 0.4;
}

/** The kill confirm — the X, the chime, the frame catching, the punch.
 * Once per creature; false if it was already confirmed. */
function confirmKill(id: string, kind: string, crit: boolean, weight: number, over: number, step: number, now: number): boolean {
  if (!noteKill(confirm, now, id, crit)) return false;
  const boss = kind === "boss";
  playKillConfirm(stepRatio(step), crit);
  hitstop(requestStop(stopper, now, hitstopFor({ weight, killed: true, crit, boss }), boss));
  gameEvents.emit("killPunch", punchFor(crit, boss, over));
  // The view breathes in with it.
  gameEvents.emit("castKick", { pitch: 0, yaw: 0, fov: crit || boss ? 0.03 : 0.018 });
  return true;
}

function onHit(e: GameEvents["enemyHit"]): void {
  if (!e.mine) return;
  const now = nowS();
  const weight = weightOf(e.id, e.damage);
  // Listeners copy what they keep: the payload is the shell's scratch.
  const [x, y, z] = e.at;
  addNumber(damageNumbers, e.id, x, y + 0.3, z, e.damage, e.lethal ? 2 : e.crit ? 1 : 0);
  if (e.crit) {
    spark.x = x;
    spark.y = y;
    spark.z = z;
    hitSparksFx(spark, CRIT_SPARK, 1.3);
  }
  if (e.lethal) {
    const step = chimeStep(momentum, now);
    // Overkill, if the board still holds its life from before the blow.
    const life = getLife(e.id);
    const over = life && life.hp > 0 ? Math.max(0, (e.damage - life.hp) / Math.max(1, life.maxHp)) : 0;
    if (confirmKill(e.id, e.kind, e.crit, weight, over, step, now)) predictKill(momentum, now, e.id);
    return;
  }
  const s = noteHit(confirm, now, weight, e.frac, e.crit);
  if (s) playConfirm(s);
  else scheduleFlush(now);
  hitstop(requestStop(stopper, now, hitstopFor({ weight, killed: false, crit: e.crit, boss: e.kind === "boss" })));
}

function onKilled(e: GameEvents["enemyKilled"]): void {
  const now = nowS();
  const reward = creditKill(momentum, now, e.id, e.mine);
  if (!reward) {
    // Not ours — but the Warden's fall stops every wizard's breath.
    if (e.kind === "boss") hitstop(requestStop(stopper, now, STOP.boss, true));
    return;
  }
  const { multi, step, callout, mana } = reward;
  const { id, kind, over } = e;
  // The killing blow as we saw it land usually told us first (with its
  // crit); on the host both reports come in one breath, in either order —
  // so give the lethal hit the rest of this one to arrive.
  queueMicrotask(() => confirmKill(id, kind, false, 0.5, over, step, now));
  if (mana > 0) {
    const s = useGame.getState();
    if (s.mana < PLAYER.maxMana) useGame.setState({ mana: Math.min(PLAYER.maxMana, s.mana + mana) });
  }
  if (callout) {
    gameEvents.emit("multiKill", { multi, word: callout });
    playStreak(multi);
  }
}

const offs = [gameEvents.on("enemyHit", onHit), gameEvents.on("enemyKilled", onKilled)];
if (import.meta.hot) import.meta.hot.dispose(() => offs.forEach((off) => off()));

// Dev-only inspection for end-to-end scripts: what the shooter is shown.
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__combat = () => ({
    numbers: damageNumbers.items.filter((e) => e.live).map((e) => ({ target: e.target, value: e.value, style: e.style })),
    marks: { ...hitMarks(newMarks()) },
    heat: streakHeat(),
  });
  // Hold the marks and numbers still (true) or let them run again (false).
  (window as unknown as Record<string, unknown>).__combatHold = (on: boolean) => {
    heldAt = on ? nowS() : null;
  };
}
