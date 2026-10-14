import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { playBrink, playHeartThud, playSecondWind, playWoundRasp } from "../../../audio/heartSounds";
import { clearMuffle, muffleOf, setMuffle } from "../../../audio/muffle";
import { gameEvents } from "../../../core/events";
import { slowMo } from "../../../core/presentTime";
import { heart, lifeByte, releaseOf } from "../../../game/heart";
import { setLocalLife } from "../../../net/players";
import { BRINK_WINDOW_S, brinkLeft, useGame } from "../../../state/gameStore";
import { useStats } from "../../../state/useStats";

/** What being barely alive sounds like, and what the floor sees of it —
 * the one heart (game/heart) made audible. Draws nothing.
 *
 *  - Every beat of the heart while it's felt is a thud in your head.
 *  - The world goes under with it (audio/muffle): muffled at the line,
 *    deeper toward death, punched out at the Brink, thrown open by a
 *    second wind.
 *  - The Brink: the picture slows (core/presentTime — particles and bodies
 *    drift while you don't), a ring sounds in your ears, and the store
 *    holds every blow off for the window you get to dash out in.
 *  - A second wind: a breath drawn in.
 *  - A blow taken in the last stand tears a rasp out of you that cuts
 *    through the muffle.
 *  - Our pose tells floor-mates how we're doing (net/players).
 *
 * Mounted with the HUD (while playing); leaving lets the world back in. */

/** The Brink's slow motion: how slow, for the whole of its window. */
const BRINK_SLOW = 0.3;

const muffle = { cutoff: 0, gain: 0 };

export function Tension() {
  const lastBeats = useRef(heart.beats);
  const max = useRef(0);
  max.current = useStats().maxHealth;

  useEffect(() => {
    const offs = [
      gameEvents.on("wizardBrink", () => {
        slowMo(BRINK_SLOW, BRINK_WINDOW_S);
        playBrink();
      }),
      gameEvents.on("wizardHealed", ({ from, to, max }) => {
        if (releaseOf(from / max, to / max) > 0) playSecondWind();
      }),
      gameEvents.on("playerHurt", () => {
        if (heart.low > 0) playWoundRasp(heart.low);
      }),
    ];
    return () => {
      offs.forEach((off) => off());
      clearMuffle();
    };
  }, []);

  useFrame(() => {
    // The heart was stepped this frame by the world's post chain.
    if (heart.beats !== lastBeats.current) {
      lastBeats.current = heart.beats;
      if (heart.felt > 0.01) playHeartThud(heart.felt, 60 / heart.bpm);
    }
    setMuffle(muffleOf(heart.low, heart.brink, heart.release, muffle));
    const s = useGame.getState();
    setLocalLife(lifeByte(s.health, max.current, brinkLeft() > 0));
  });

  return null;
}
