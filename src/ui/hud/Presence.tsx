import { useEffect } from "react";
import { playPactChime, playPresenceSting } from "../../audio/sound";
import { gameEvents } from "../../core/events";
import { playerPosition } from "../../game/player-state";
import { useNet } from "../../net/netStore";
import { session } from "../../net/session";
import { useGame } from "../../state/gameStore";
import { Icon } from "../components/Icon";
import { KeyCap, Panel } from "../components/Panel";
import { useGameEvent, useTicker } from "../hooks";
import { eyeSprite } from "../pixelArt";
import { color } from "../theme";

/** How near a stranger must be before the eye starts to race (metres). */
const NEAR = 18;
const MID = 40;

type Mood = "alone" | "allies" | "far" | "mid" | "near";

const MOOD: Record<Mood, { tint: string; pulse: string; text: string | null; open: number }> = {
  alone: { tint: color.brass, pulse: "0s", text: null, open: 0 },
  allies: { tint: color.ally, pulse: "4s", text: "An ally walks with you", open: 0.6 },
  far: { tint: color.violet, pulse: "2.6s", text: "Something else walks these halls", open: 0.75 },
  mid: { tint: "#e070ff", pulse: "1.3s", text: "It draws nearer…", open: 0.9 },
  near: { tint: "#ff4a5a", pulse: "0.55s", text: "It is close", open: 1 },
};

/** Distance to the nearest non-allied wizard, or null if none is known. */
function nearestStranger(allies: string[]): number | null {
  let best: number | null = null;
  for (const peer of session.peers.values()) {
    if (allies.includes(peer.playerId)) continue;
    const d = Math.hypot(peer.position.x - playerPosition.x, peer.position.z - playerPosition.z);
    if (best === null || d < best) best = d;
  }
  return best;
}

/** Top-centre: the eye. It never says *where* another wizard is — only that
 * one shares the floor, and (by how fast it pulses) roughly how close. Allies
 * calm it to green. Also hosts the pact banner and the list of allies. */
export function Presence() {
  const floorPlayers = useNet((s) => s.floorPlayers);
  const allies = useNet((s) => s.allies);
  const pactOffers = useNet((s) => s.pactOffers);
  const others = Math.max(0, floorPlayers - 1);
  useTicker(250, others > 0); // peer positions aren't reactive: poll

  const strangers = Math.max(0, others - allies.length);
  let mood: Mood = "alone";
  if (strangers > 0) {
    const d = nearestStranger(allies);
    mood = d !== null && d < NEAR ? "near" : d !== null && d < MID ? "mid" : "far";
  } else if (others > 0) mood = "allies";
  const m = MOOD[mood];

  return (
    <div className="wm-presence">
      <img
        src={eyeSprite(m.open, m.tint)}
        width={21 * 3}
        height={13 * 3}
        alt=""
        className={`wm-px${mood === "alone" ? "" : " wm-presence__eye"}`}
        style={{
          opacity: mood === "alone" ? 0.6 : 1,
          ["--pulse" as string]: m.pulse,
          ["--glow" as string]: m.tint,
        }}
        title={mood === "alone" ? "You are alone on this floor" : undefined}
      />
      {m.text && (
        <div className="wm-presence__text" style={{ color: m.tint }}>
          {m.text}
        </div>
      )}
      {pactOffers.map((id) => (
        <Panel key={id} frame="arcane" className="wm-pact">
          <Icon name="pact" tint={color.ally} scale={2} />
          <span>
            <span style={{ color: color.ally }}>{session.peerName(id)}</span> offers a pact — walk to them and press
          </span>
          <KeyCap k="E" />
        </Panel>
      ))}
      {allies.length > 0 && (
        <div className="wm-allies">
          {allies.map((id) => (
            <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Icon name="pact" tint={color.ally} scale={1} /> {session.peerName(id)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Presence sounds and omens. Mounted once for the whole session so a sting
 * plays even when the HUD is hidden mid-warp. */
export function usePresenceOmens(): void {
  useGameEvent("presence", (e) => {
    if (useGame.getState().phase !== "dungeon") return;
    gameEvents.emit(
      "message",
      e.kind === "arrived" ? "Something else walks these halls…" : "A presence fades from these halls",
    );
  });
  useEffect(() => {
    let lastSting = 0;
    const unsubPlayers = useNet.subscribe((s, prev) => {
      const phase = useGame.getState().phase;
      if (s.floorPlayers > prev.floorPlayers && (phase === "dungeon" || phase === "loading")) {
        const now = performance.now();
        if (now - lastSting > 4000) playPresenceSting();
        lastSting = now;
      }
      if (s.pactOffers.length > prev.pactOffers.length || s.allies.length > prev.allies.length) playPactChime();
    });
    return unsubPlayers;
  }, []);
}
