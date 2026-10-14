import { useEffect, useMemo, useState } from "react";
import { useArena, type Bout } from "../../../arena/arenaStore";
import { ARENA, ranked } from "../../../arena/rules";
import { gameEvents } from "../../../core/events";
import { netClock } from "../../../net/clock";
import { useNet } from "../../../net/netStore";
import { session } from "../../../net/session";
import { useGame } from "../../../state/gameStore";
import { pickNpcLine } from "../../../world/npcLines";
import { ViewAnchor } from "../../anchors";
import { UiPresence, UiShow } from "../../presence";
import { RuneButton } from "../../RuneButton";
import { Tablet, TABLET_EXIT } from "../../Tablet";
import { RuneText } from "../../text/RuneText";
import { STEP, typePx } from "../../text/type";
import { ink } from "../../theme";
import { HudAnchor } from "../hud/HudAnchor";

/** The Proving Ground in the world: Varr's tablet at the obelisk (the line,
 * the rules, your record), the rune that says you're waiting, and in the
 * hall the bout's board and sands, the yield as it happens to you and by
 * you, and Varr's reading of the board at the end. */
export function ArenaLayer() {
  return (
    <>
      <ProvingGroundTablet />
      <QueueRune />
      <BoutBoard />
      <YieldVeil />
      <YieldTaken />
      <BoutEnd />
    </>
  );
}

/** Varr's ember-gold, and the hall's blood-red. */
const EMBER = "#ff9a3c";
const RED = "#ff5a3c";

function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const t = setInterval(() => setNow(performance.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function nameIn(bout: Bout, id: string | null): string {
  return (id && bout.members.find((m) => m.id === id)?.name) || "a wizard";
}

// ── At the obelisk ───────────────────────────────────────────────────────────

const D = 1.45;
const PX = typePx(D, STEP.text);
const PX_SMALL = typePx(D, STEP.text, "label");
const TITLE_PX = typePx(D, 2, "heading");
// Sized from the text: body runes run ~0.02 m a character at this
// distance; the longest rule is ~78 characters.
const W = 2.1;
const H = 1.2;

function ProvingGroundTablet() {
  const open = useGame((s) => s.overlay === "arena" && s.phase === "village");
  return (
    <UiPresence show={open} exit={TABLET_EXIT}>
      <ViewAnchor offset={[0, 0, -D]}>
        <ProvingGroundPage />
      </ViewAnchor>
    </UiPresence>
  );
}

function ProvingGroundPage() {
  const online = useNet((s) => s.mode === "online");
  const queue = useArena((s) => s.queue);
  const record = useArena((s) => s.record);
  const deepest = useGame((s) => s.deepest);
  const greeting = useMemo(() => pickNpcLine("varr", "greeting", deepest, Math.random())?.text ?? "", [deepest]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") useGame.getState().setOverlay("none");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const top = H / 2 - 0.11;
  const rules = [
    "Duels to the yield: fall, and you rise again at a stone. Nothing is lost.",
    `First to ${ARENA.killsToWin} yields, or the most when the sands run out (${ARENA.durationMs / 60_000} minutes).`,
    `${ARENA.minPlayers} to ${ARENA.maxPlayers} wizards. Your fellowship is fair game too.`,
  ];
  return (
    <Tablet width={W} height={H} frame="brass" tilt seed={41} tint="#3a2a2a">
      <RuneText text="The Proving Ground" font="heading" px={TITLE_PX} color={ink.parchment} glow={0.7} position={[0, top, 0]} />
      <RuneText text={`“${greeting}”`} px={PX} maxCols={80} color={EMBER} position={[0, top - 0.13, 0]} delay={0.1} />
      <RuneText text="— Ysolde Varr, Master of the Proving Ground" font="label" px={PX_SMALL} color={ink.faded} position={[0, top - 0.25, 0]} delay={0.15} />
      {rules.map((r, i) => (
        <RuneText key={i} text={[{ text: "◆ ", color: RED }, { text: r, color: ink.parchmentDim }]} px={PX} maxCols={90} position={[0, top - 0.36 - i * 0.065, 0]} delay={0.2 + i * 0.05} />
      ))}
      <RuneText
        text={
          record && record.bouts > 0
            ? [
                { text: "VARR'S LEDGER  ", color: ink.gold },
                { text: `${record.bouts} bout${record.bouts === 1 ? "" : "s"} · ${record.wins} won · ${record.yields} yields taken`, color: ink.parchment },
              ]
            : [{ text: "Varr's ledger has no mark against your name yet.", color: ink.faded }]
        }
        font="label"
        px={PX_SMALL}
        position={[0, -0.12, 0]}
        delay={0.3}
      />
      {!online && <RuneText text="No server answers — the hall needs other wizards." px={PX} color={ink.faded} position={[0, -0.3, 0]} />}
      {online && queue && (
        <>
          <RuneText
            text={[
              { text: "You wait at the obelisk — ", color: ink.parchment },
              { text: `${queue.position} of ${queue.waiting}`, color: EMBER },
              { text: queue.waiting < ARENA.minPlayers ? ". Varr waits for a challenger." : ". Varr will call you.", color: ink.parchment },
            ]}
            px={PX}
            position={[0, -0.25, 0]}
          />
          <RuneButton label="Step back" variant="ghost" onPress={() => session.arenaLeave()} px={PX} width={0.36} position={[0, -0.38, 0]} />
        </>
      )}
      {online && !queue && <RuneButton label="Step into the line" onPress={() => session.arenaJoin()} px={PX} width={0.5} position={[0, -0.3, 0]} />}
      <RuneText text="ESC · close" font="label" px={PX_SMALL} color={ink.faded} position={[W / 2 - 0.2, -H / 2 + 0.08, 0]} />
    </Tablet>
  );
}

/** While you wait: a rune at the top of the view (wander the camp all you
 * like — Varr calls you when the hall's ready). */
function QueueRune() {
  const queue = useArena((s) => s.queue);
  const phase = useGame((s) => s.phase);
  const show = !!queue && phase === "village";
  return (
    <UiShow show={show}>
      <HudAnchor h={0} v={1} inset={[0, 0.06]} distance={1}>
        {queue && (
          <RuneText
            text={[
              { text: "AT THE OBELISK  ", color: EMBER },
              { text: queue.waiting < ARENA.minPlayers ? "waiting for a challenger" : `${queue.position} of ${queue.waiting} · the hall opens soon`, color: ink.parchment },
            ]}
            font="label"
            px={typePx(1, STEP.text, "label")}
            glow={0.5}
          />
        )}
      </HudAnchor>
    </UiShow>
  );
}

// ── In the hall ──────────────────────────────────────────────────────────────

function useBoutView(): Bout | null {
  const bout = useArena((s) => s.bout);
  const instanceId = useGame((s) => s.instanceId);
  const phase = useGame((s) => s.phase);
  return bout && instanceId === bout.instanceId && (phase === "dungeon" || phase === "loading") ? bout : null;
}

/** The sands and the board, top of the view: best first, you in gold. */
function BoutBoard() {
  const bout = useBoutView();
  const me = useNet((s) => s.playerId);
  useNow(250);
  const px = typePx(1, STEP.text, "label");
  const left = bout ? Math.max(0, bout.endsAt - netClock.serverNow()) : 0;
  const sands = `${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, "0")}`;
  // The board's runes only rewrite when the score does.
  const boardKey = bout ? `${me}|${bout.board.map((s) => `${s.id}:${s.name}:${s.kills}:${s.falls}`).join("|")}` : "";
  const fighters = useMemo(
    () =>
      ranked(bout?.board ?? []).flatMap((s, i) => [
        ...(i > 0 ? [{ text: "   ", color: ink.faded }] : []),
        { text: `${s.name} `, color: s.id === me ? ink.gold : ink.parchment },
        { text: String(s.kills), color: s.id === me ? ink.gold : EMBER },
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardKey],
  );
  return (
    <UiShow show={!!bout && !bout.ended}>
      <HudAnchor h={0} v={1} inset={[0, 0.05]} distance={1}>
        {/* The sands: a quick rune of their own, so a ticking second never
            re-writes the rest. */}
        <RuneText text={sands} font="label" px={px * 1.4} color={left < 30_000 ? RED : ink.parchment} glow={0.5} inDuration={0.15} stagger={0} />
        <RuneText text={fighters} font="label" px={px} glow={0.5} position={[0, -px * 13, 0]} />
        <RuneText text={`first to ${bout?.killsToWin ?? ARENA.killsToWin} yields`} font="label" px={px * 0.8} color={ink.faded} position={[0, -px * 22, 0]} />
      </HudAnchor>
    </UiShow>
  );
}

/** You've yielded: the hall goes quiet and says to whom, and when you rise. */
function YieldVeil() {
  const bout = useBoutView();
  const me = useNet((s) => s.playerId);
  const now = useNow(200);
  const until = bout?.fallen[me] ?? 0;
  const down = !!bout && until > now;
  const by = bout ? [...bout.feed].reverse().find((f) => f.victim === me)?.by ?? null : null;
  const dist = 2;
  return (
    <UiPresence show={down} exit={0.4}>
      <ViewAnchor offset={[0, 0.12, -dist]}>
        <RuneText text="YOU YIELD" font="heading" px={typePx(dist, 3, "heading")} color={RED} glow={1} />
        {bout && (
          <RuneText text={by ? `to ${nameIn(bout, by)}` : "to the hall"} px={typePx(dist, STEP.lead)} color={ink.parchment} position={[0, -0.16, 0]} delay={0.1} />
        )}
        <RuneText text={`you rise in ${Math.max(1, Math.ceil((until - now) / 1000))}…`} font="label" px={typePx(dist, STEP.text, "label")} color={ink.faded} position={[0, -0.27, 0]} inDuration={0.15} stagger={0} />
      </ViewAnchor>
    </UiPresence>
  );
}

/** You took a yield: a hard, short shout of it. */
function YieldTaken() {
  const [shout, setShout] = useState<{ name: string; key: number } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = gameEvents.on("arenaYield", ({ name }) => {
      setShout({ name, key: performance.now() });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setShout(null), 1500);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, []);
  const dist = 2;
  return (
    <UiPresence show={!!shout} exit={0.35}>
      <ViewAnchor offset={[0, 0.2, -dist]}>
        {shout && (
          <group key={shout.key}>
            <RuneText text="YIELD" font="heading" px={typePx(dist, 3, "heading")} color={ink.gold} glow={1.2} />
            <RuneText text={`${shout.name} yields to you`} px={typePx(dist, STEP.text)} color={ink.parchment} position={[0, -0.14, 0]} delay={0.05} />
          </group>
        )}
      </ViewAnchor>
    </UiPresence>
  );
}

/** The bout is over: Varr reads the board, and the hall sends you home. */
function BoutEnd() {
  const bout = useBoutView();
  const me = useNet((s) => s.playerId);
  const record = useArena((s) => s.record);
  const now = useNow(250);
  const ended = bout?.ended ?? null;
  const dist = 1.7;
  const px = typePx(dist, STEP.text);
  const pxLabel = typePx(dist, STEP.text, "label");
  const w = 1.6;
  const h = 0.98;
  const headline = !bout || !ended ? "" : ended.winner === me ? "The hall is yours!" : ended.winner ? `${nameIn(bout, ended.winner)} takes the hall` : "No yields taken";
  const homeIn = ended ? Math.max(0, Math.ceil((ended.at + ARENA.afterMs - now) / 1000)) : 0;
  return (
    <UiPresence show={!!ended} exit={TABLET_EXIT}>
      <ViewAnchor offset={[0, 0.02, -dist]}>
        {bout && ended && (
          <Tablet width={w} height={h} frame="brass" tilt seed={43} tint="#3a2a2a">
            <RuneText text="Varr reads the board" font="label" px={pxLabel} color={ink.faded} position={[0, h / 2 - 0.09, 0]} />
            <RuneText text={headline} font="heading" px={typePx(dist, 2, "heading")} color={ended.winner === me ? ink.gold : ink.parchment} glow={0.8} position={[0, h / 2 - 0.19, 0]} delay={0.1} />
            {ended.board.map((s, i) => (
              <RuneText
                key={s.id}
                text={[
                  { text: `${i + 1}. `, color: ink.faded },
                  { text: s.name, color: s.id === me ? ink.gold : ink.parchment },
                  { text: `   ${s.kills} yield${s.kills === 1 ? "" : "s"} taken · fell ${s.falls}`, color: ink.parchmentDim },
                ]}
                px={px}
                position={[0, h / 2 - 0.33 - i * 0.065, 0]}
                delay={0.2 + i * 0.06}
              />
            ))}
            {record && (
              <RuneText
                text={`Your ledger: ${record.bouts} bout${record.bouts === 1 ? "" : "s"} · ${record.wins} won · ${record.yields} yields`}
                font="label"
                px={pxLabel}
                color={EMBER}
                position={[0, -h / 2 + 0.17, 0]}
                delay={0.4}
              />
            )}
            <RuneText text={`home in ${homeIn}…`} font="label" px={pxLabel} color={ink.faded} position={[0, -h / 2 + 0.08, 0]} inDuration={0.15} stagger={0} />
          </Tablet>
        )}
      </ViewAnchor>
    </UiPresence>
  );
}
