import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { Group } from "three";
import { offerInteraction } from "../../../game/interactions";
import { playerPosition } from "../../../game/player-state";
import { useNet } from "../../../net/netStore";
import { estimatePeer } from "../../../net/players";
import { session } from "../../../net/session";
import { input } from "../../../player/input";
import { acceptInvite, isPartyMember, say, useSocial, type ChatLine } from "../../../social/social";
import { useGame } from "../../../state/gameStore";
import { gameEvents } from "../../../core/events";
import { UiShow } from "../../presence";
import { RuneField } from "../../RuneField";
import { RuneText } from "../../text/RuneText";
import { STEP, typePx } from "../../text/type";
import { ink } from "../../theme";
import { HudAnchor } from "../hud/HudAnchor";
import { GuildBoardLayer } from "./GuildBoard";

/** The social layer, all in the world: what's said hangs over the speaker's
 * head and runs down a little scroll at your left; Enter opens your own
 * line to write in; your fellowship's runes stand at the right; F invites
 * the wizard beside you in the camp (or takes an invitation waiting for
 * you). The guild board's tablet lives in GuildBoard.tsx. */
export function SocialLayer() {
  return (
    <>
      <ChatScroll />
      <SpeechOverHeads />
      <FellowshipRunes />
      <SocialKeys />
      <GuildBoardLayer />
    </>
  );
}

const PX = typePx(1, STEP.text);
const LINE_H = PX * 9;
/** How long a line stays on the scroll while it's closed, seconds. */
const LINE_HOLD_S = 15;
const SHOWN_LINES = 6;
const PARTY_INK = "#9fe870";

function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const t = setInterval(() => setNow(performance.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function lineSpans(l: ChatLine) {
  const me = useNet.getState().playerId;
  return [
    ...(l.party ? [{ text: "◆ ", color: PARTY_INK }] : []),
    { text: l.from === me ? "You" : l.name, color: l.party ? PARTY_INK : ink.gold },
    { text: `: ${l.text}`, color: ink.parchment },
  ];
}

function ChatScroll() {
  const phase = useGame((s) => s.phase);
  const overlay = useGame((s) => s.overlay);
  const lines = useSocial((s) => s.lines);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const now = useNow(1000);
  const playing = phase === "village" || phase === "dungeon";

  useFrame(() => {
    if (!playing || overlay !== "none") return;
    if (!open && input.consume("Enter")) setOpen(true);
  });
  useEffect(() => {
    if (!playing || overlay !== "none") setOpen(false);
  }, [playing, overlay]);

  const send = () => {
    const party = /^\/p\s/i.test(draft);
    say(party ? draft.replace(/^\/p\s+/i, "") : draft, party);
    setDraft("");
    setOpen(false);
  };
  const recent = lines.filter((l) => open || now - l.at < LINE_HOLD_S * 1000).slice(-SHOWN_LINES);

  return (
    <UiShow show={playing}>
      <HudAnchor h={-1} v={-1} inset={[0.025, 0.3]} distance={1}>
        {recent.map((l, i) => (
          <RuneText
            key={l.id}
            text={lineSpans(l)}
            px={PX}
            maxCols={44}
            align="left"
            anchor={[0, 0]}
            glow={0.4}
            position={[0, (recent.length - i) * LINE_H, 0]}
          />
        ))}
        <UiShow show={open}>
          <RuneField
            value={draft}
            onInput={setDraft}
            onEnter={send}
            onEditingChange={(editing) => !editing && setOpen(false)}
            px={PX}
            width={0.42}
            maxLength={140}
            placeholder="say something · /p to your fellowship"
            label="Chat"
            autoFocus={open ? "chat" : false}
            position={[0.21, 0, 0]}
          />
        </UiShow>
      </HudAnchor>
    </UiShow>
  );
}

/** What wizards say aloud hangs over their heads for a few breaths. */
function SpeechOverHeads() {
  const said = useSocial((s) => s.said);
  const me = useNet((s) => s.playerId);
  const now = useNow(500);
  const speakers = Object.entries(said).filter(([id, s]) => id !== me && s.until > now);
  return (
    <>
      {speakers.map(([id, s]) => (
        <Speech key={`${id}:${s.until}`} id={id} text={s.text} />
      ))}
    </>
  );
}

const SPEECH_RANGE = 26;

function Speech({ id, text }: { id: string; text: string }) {
  const group = useRef<Group>(null);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const p = estimatePeer(id);
    if (!p) {
      g.visible = false;
      return;
    }
    g.position.set(p.p[0], p.p[1] + 1.55, p.p[2]);
    const d = camera.position.distanceTo(g.position);
    g.visible = d < SPEECH_RANGE;
    g.quaternion.copy(camera.quaternion);
    g.scale.setScalar(Math.min(2.2, Math.max(0.7, d / 1.6)));
  });
  return (
    <group ref={group}>
      <RuneText text={`“${text}”`} px={typePx(1.6, STEP.text)} maxCols={30} color={ink.parchment} glow={0.5} />
    </group>
  );
}

/** Your fellowship, at a glance: its runes and who's in it. */
function FellowshipRunes() {
  const party = useSocial((s) => s.party);
  const phase = useGame((s) => s.phase);
  const me = useNet((s) => s.playerId);
  const show = !!party && (phase === "village" || phase === "dungeon");
  return (
    <UiShow show={show}>
      <HudAnchor h={1} v={1} inset={[0.025, 0.2]} distance={1}>
        {party && (
          <>
            <RuneText
              text={[
                { text: "FELLOWSHIP ", color: ink.faded },
                { text: party.code, color: PARTY_INK },
              ]}
              font="label"
              px={PX}
              align="right"
              anchor={[1, 0]}
              glow={0.5}
            />
            {party.members.map((m, i) => (
              <RuneText
                key={m.id}
                text={[
                  { text: m.id === party.leader ? "◆ " : "· ", color: PARTY_INK },
                  { text: m.id === me ? `${m.name} (you)` : m.name, color: ink.parchment },
                ]}
                px={PX}
                align="right"
                anchor={[1, 0]}
                glow={0.3}
                position={[0, -(i + 1) * LINE_H, 0]}
              />
            ))}
          </>
        )}
      </HudAnchor>
    </UiShow>
  );
}

/** F in the camp: take a waiting invitation, or invite the wizard beside you. */
const INVITE_REACH_SQ = 3.2 * 3.2;

function SocialKeys() {
  useFrame(() => {
    const game = useGame.getState();
    if (game.phase !== "village" || game.overlay !== "none") return;
    const invite = useSocial.getState().invite;
    if (invite && invite.until > performance.now()) {
      if (input.consume("KeyF")) acceptInvite();
      return;
    }
    // The nearest wizard within reach who isn't already of your fellowship.
    const roster = useNet.getState().roster;
    const me = useNet.getState().playerId;
    let best: { id: string; d2: number; at: [number, number, number] } | null = null;
    for (const id of Object.keys(roster)) {
      if (id === me || isPartyMember(id)) continue;
      const p = estimatePeer(id);
      if (!p) continue;
      const d2 = (p.p[0] - playerPosition.x) ** 2 + (p.p[2] - playerPosition.z) ** 2;
      if (d2 < INVITE_REACH_SQ && (!best || d2 < best.d2)) best = { id, d2, at: [p.p[0], p.p[1] + 1.2, p.p[2]] };
    }
    if (!best) return;
    const name = roster[best.id] ?? "the wizard";
    offerInteraction(`F — Invite ${name} into your fellowship`, best.d2, () => {}, best.at);
    if (input.consume("KeyF")) {
      session.partyInvite(best.id);
      gameEvents.emit("message", `You invite ${name} into your fellowship`);
    }
  });
  return null;
}
