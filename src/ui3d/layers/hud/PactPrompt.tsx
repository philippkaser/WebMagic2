import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useSyncExternalStore } from "react";
import { Vector3, type Group } from "three";
import { useEncounters } from "../../../encounters/encounterStore";
import { playerPosition } from "../../../game/player-state";
import { netClock } from "../../../net/clock";
import { INTERP_DELAY_MS } from "../../../net/entities";
import { estimatePeer, peerIds, samplePeer } from "../../../net/players";
import { makeSampledPose } from "../../../net/snapshots";
import { palette } from "../../../ui/theme";
import { placeInFront, pxFor } from "../../anchors";
import type { TextSpan } from "../../font/layout";
import { UiPresence } from "../../presence";
import { RuneText } from "../../text/RuneText";
import { HUD_COLORS } from "./copy";
import { devOverrides, subscribeDevOverrides } from "./devHooks";

/** The pact offer, written over the other wizard's head: standing near
 * someone, "F — Offer a pact to Morgana" hangs above them (just over their
 * name), so the choice between trust and plunder is written on the person
 * it concerns. If their pose isn't known yet it hangs low in front of you,
 * under the E prompt, as before.
 *
 * Which wizard: the nearest within reach, as PactSystem picks — recomputed
 * a few times a second, then followed smoothly every frame with the same
 * interpolated pose their body is drawn with. */

/** Above the name tag (RemoteWizards hangs it at 1.85 m). */
const HEAD = 2.3;
const REACH = 4.5;
const VIEW_D = 1.6;

/** "F — Offer a pact to X": the key in accent, the rest in pact lavender. */
export function pactSpans(text: string): TextSpan[] {
  const m = /^([A-Z])\s+—\s+(.*)$/.exec(text);
  if (!m) return [{ text, color: HUD_COLORS.pact }];
  return [
    { text: `${m[1]} `, color: palette.accent },
    { text: m[2]!, color: HUD_COLORS.pact },
  ];
}

export function PactPrompt() {
  const live = useEncounters((s) => s.pactPrompt);
  const dev = useSyncExternalStore(subscribeDevOverrides, () => devOverrides.pact);
  const prompt = dev ?? live;
  const last = useRef("");
  if (prompt) last.current = prompt;
  const spans = useMemo(() => pactSpans(last.current), [prompt]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <UiPresence show={!!prompt} exit={1}>
      <Hanging spans={spans} shown={!!prompt} />
    </UiPresence>
  );
}

const pose = makeSampledPose();
const view = new Vector3();

function Hanging({ spans, shown }: { spans: TextSpan[]; shown: boolean }) {
  const group = useRef<Group>(null);
  const camera = useThree((s) => s.camera);
  const who = useRef<{ id: string | null; clock: number }>({ id: null, clock: 0 });

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const w = who.current;
    w.clock -= dt;
    if (w.clock <= 0) {
      w.clock = 0.25;
      let best: string | null = null;
      let bestD2 = REACH * REACH;
      for (const id of peerIds()) {
        const est = estimatePeer(id);
        if (!est) continue;
        const d2 = (est.p[0] - playerPosition.x) ** 2 + (est.p[1] - playerPosition.y) ** 2 + (est.p[2] - playerPosition.z) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = id;
        }
      }
      if (best || !shown) w.id = best;
    }
    const known = w.id !== null && samplePeer(w.id, netClock.serverNow() - INTERP_DELAY_MS, pose);
    if (known) {
      g.position.set(pose.p[0], pose.p[1] + HEAD, pose.p[2]);
      // Roughly constant on screen from arm's length to the edge of reach.
      g.scale.setScalar(Math.min(1.8, Math.max(0.7, camera.position.distanceTo(g.position) / VIEW_D)));
    } else {
      placeInFront(camera, VIEW_D, [0, -0.52], view);
      g.position.copy(view);
      g.scale.setScalar(1);
    }
    g.quaternion.copy(camera.quaternion);
  });

  return (
    <group ref={group}>
      <RuneText text={spans} px={pxFor(VIEW_D, 0.019)} glow={0.9} outline={0.6} />
    </group>
  );
}
