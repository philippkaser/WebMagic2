import { useEffect, useState } from "react";
import { CODE_ALPHABET, CODE_LENGTH, normalizePartyCode } from "../../../net/party";
import { useNet } from "../../../net/netStore";
import { session } from "../../../net/session";
import { isPartyMember, useSocial } from "../../../social/social";
import { useGame } from "../../../state/gameStore";
import { ViewAnchor } from "../../anchors";
import { UiPresence } from "../../presence";
import { RuneButton } from "../../RuneButton";
import { RuneField } from "../../RuneField";
import { Tablet, TABLET_EXIT } from "../../Tablet";
import { RuneText } from "../../text/RuneText";
import { STEP, typePx } from "../../text/type";
import { ink } from "../../theme";

/** The guild board's page, read where you stand: your fellowship and its
 * runes (share them with anyone — whoever speaks them joins), a field to
 * speak another fellowship's runes, and the wizards in the camp with an
 * invitation for each. Fellowships go down together: the same floor, the
 * same world, floor after floor (net/party.ts, matchmaking). */

const D = 1.45;
const PX = typePx(D, STEP.text);
const PX_SMALL = typePx(D, STEP.text, "label");
const TITLE_PX = typePx(D, 2, "heading");
const CODE_PX = typePx(D, 2, "title");
// Sized from the text: body runes run ~0.02 m a character at this
// distance, so each column holds ~44 characters.
const W = 2.1;
const H = 1.32;
const LINE = 0.058;
const GREEN = "#9fe870";

export function GuildBoardLayer() {
  const open = useGame((s) => s.overlay === "guild" && s.phase === "village");
  return (
    <UiPresence show={open} exit={TABLET_EXIT}>
      <ViewAnchor offset={[0, 0, -D]}>
        <GuildPage />
      </ViewAnchor>
    </UiPresence>
  );
}

function GuildPage() {
  const party = useSocial((s) => s.party);
  const roster = useNet((s) => s.roster);
  const me = useNet((s) => s.playerId);
  const online = useNet((s) => s.mode === "online");
  const [code, setCode] = useState("");

  // Escape (outside a field) closes the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" && !(e.target instanceof HTMLInputElement)) useGame.getState().setOverlay("none");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const others = Object.entries(roster).filter(([id]) => id !== me && !isPartyMember(id)).slice(0, 5);
  const top = H / 2 - 0.11;
  const y0 = top - 0.26;
  const left = -W / 2 + 0.12;
  const right = 0.1;
  const join = () => {
    const c = normalizePartyCode(code);
    if (c.length === CODE_LENGTH) session.partyJoin(c);
    setCode("");
  };

  return (
    <Tablet width={W} height={H} frame="brass" tilt seed={23}>
      <RuneText text="The Guild Board" font="heading" px={TITLE_PX} color={ink.parchment} glow={0.6} position={[0, top, 0]} />
      <RuneText
        text="A fellowship goes down together — the same floor, the same world, floor after floor."
        px={PX_SMALL}
        maxCols={96}
        color={ink.faded}
        position={[0, top - 0.11, 0]}
        delay={0.1}
      />
      {!online && <RuneText text="No server answers — fellowships need the camp's ledger." px={PX} color={ink.faded} position={[0, 0, 0]} />}
      {online && (
        <>
          {/* Your fellowship. */}
          <RuneText text="YOUR FELLOWSHIP" font="label" px={PX_SMALL} color={ink.gold} align="left" anchor={[0, 0.5]} position={[left, y0, 0]} />
          {party ? (
            <>
              <RuneText text={party.code} font="title" px={CODE_PX} color={GREEN} glow={1} align="left" anchor={[0, 0.5]} position={[left, y0 - 0.12, 0]} />
              <RuneText
                text="share these runes — whoever speaks them joins"
                px={PX_SMALL}
                color={ink.faded}
                align="left"
                anchor={[0, 0.5]}
                position={[left, y0 - 0.24, 0]}
              />
              {party.members.map((m, i) => (
                <RuneText
                  key={m.id}
                  text={[
                    { text: m.id === party.leader ? "◆ " : "· ", color: GREEN },
                    { text: m.id === me ? `${m.name} (you)` : m.name, color: ink.parchment },
                  ]}
                  px={PX}
                  align="left"
                  anchor={[0, 0.5]}
                  position={[left, y0 - 0.33 - i * LINE, 0]}
                  delay={0.1 + i * 0.05}
                />
              ))}
              <RuneButton label="Leave the fellowship" variant="ghost" onPress={() => session.partyLeave()} px={PX} width={0.42} position={[left + 0.21, -H / 2 + 0.1, 0]} />
            </>
          ) : (
            <>
              <RuneText text="You walk alone." px={PX} color={ink.faded} align="left" anchor={[0, 0.5]} position={[left, y0 - 0.09, 0]} />
              <RuneButton label="Found a fellowship" onPress={() => session.partyCreate()} px={PX} width={0.46} position={[left + 0.23, y0 - 0.2, 0]} />
            </>
          )}

          {/* Speak another's runes. */}
          <RuneText text="SPEAK A FELLOWSHIP'S RUNES" font="label" px={PX_SMALL} color={ink.gold} align="left" anchor={[0, 0.5]} position={[right, y0, 0]} />
          <RuneField
            value={code}
            onInput={setCode}
            onEnter={join}
            sanitize={(raw) =>
              [...normalizePartyCode(raw)]
                .filter((c) => CODE_ALPHABET.includes(c))
                .join("")
                .slice(0, CODE_LENGTH)
            }
            maxLength={CODE_LENGTH + 2}
            placeholder="six runes"
            label="Fellowship runes"
            autoCapitalize="characters"
            px={PX}
            width={0.46}
            position={[right + 0.23, y0 - 0.1, 0]}
          />
          <RuneButton label="Join" onPress={join} px={PX} width={0.2} position={[right + 0.6, y0 - 0.1, 0]} />

          {/* Who's in the camp. */}
          <RuneText text="IN THE CAMP" font="label" px={PX_SMALL} color={ink.gold} align="left" anchor={[0, 0.5]} position={[right, y0 - 0.25, 0]} />
          {others.length === 0 && (
            <RuneText text="Only you, and the fire." px={PX} color={ink.faded} align="left" anchor={[0, 0.5]} position={[right, y0 - 0.33, 0]} />
          )}
          {others.map(([id, name], i) => (
            <group key={id} position={[right, y0 - 0.34 - i * (LINE + 0.02), 0]}>
              <RuneText text={name} px={PX} color={ink.parchment} align="left" anchor={[0, 0.5]} />
              <RuneButton label="Invite" variant="ghost" onPress={() => session.partyInvite(id)} px={PX_SMALL} width={0.2} position={[0.7, 0, 0]} />
            </group>
          ))}
        </>
      )}
      <RuneText text="ESC · close" font="label" px={PX_SMALL} color={ink.faded} position={[W / 2 - 0.2, -H / 2 + 0.08, 0]} />
    </Tablet>
  );
}
