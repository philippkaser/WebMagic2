import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useSyncExternalStore } from "react";
import { Vector3, type Group } from "three";
import { useEncounters } from "../../../encounters/encounterStore";
import { playerPosition } from "../../../game/player-state";
import { netClock } from "../../../net/clock";
import { INTERP_DELAY_MS } from "../../../net/entities";
import { estimatePeer, peerIds, samplePeer } from "../../../net/players";
import { makeSampledPose } from "../../../net/snapshots";
import { placeInFront } from "../../anchors";
import type { TextSpan } from "../../font/layout";
import { KeyCap, keyCapWidth } from "../../KeyCap";
import { Plate } from "../../Plate";
import { UiPresence } from "../../presence";
import { measureText, RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { apx, fontPx } from "./ap";
import { devOverrides, subscribeDevOverrides } from "./devHooks";
import { PixelSprite } from "./PixelSprite";

/** The pact offer, written over the other wizard's head: standing near
 * someone, an arcane-framed plate (artpass's `.wm-pact`) hangs above them,
 * just over their name: the pact sigil — two interlocked rings — the [F]
 * key cap and "Offer a pact to Morgana", the name in ally green. So the
 * choice between trust and plunder is written on the person it concerns.
 * If their pose isn't known yet it hangs low in front of you, under the
 * interaction prompt.
 *
 * Which wizard: the nearest within reach, as PactSystem picks — recomputed
 * a few times a second, then followed smoothly every frame with the same
 * interpolated pose their body is drawn with. */

/** Above the name tag (RemoteWizards hangs it at 1.85 m). */
const HEAD = 2.3;
const REACH = 4.5;
const VIEW_D = 1.6;
/** Artpass pixel at the reference distance (the plate scales with range). */
const A = apx(VIEW_D);
const TEXT_PX = fontPx(13, "body", VIEW_D);
const KEY_PX = fontPx(9, "label", VIEW_D);

/** "F — Offer a pact to Morgana" → the key, and the words with the name
 * picked out in ally green. */
export function pactParts(text: string): { key: string | null; spans: TextSpan[] } {
  const m = /^([A-Z])\s+—\s+(.*)$/.exec(text);
  const rest = m ? m[2]! : text;
  const to = rest.lastIndexOf(" to ");
  const spans: TextSpan[] =
    to > 0 ? [{ text: rest.slice(0, to + 4) }, { text: rest.slice(to + 4), color: ink.ally }] : [{ text: rest }];
  return { key: m ? m[1]! : null, spans };
}

export function PactPrompt() {
  const live = useEncounters((s) => s.pactPrompt);
  const dev = useSyncExternalStore(subscribeDevOverrides, () => devOverrides.pact);
  const prompt = dev ?? live;
  const last = useRef("");
  if (prompt) last.current = prompt;
  const parts = useMemo(() => pactParts(last.current), [prompt]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <UiPresence show={!!prompt} exit={1}>
      <Hanging parts={parts} shown={!!prompt} />
    </UiPresence>
  );
}

const pose = makeSampledPose();
const view = new Vector3();

function Hanging({ parts, shown }: { parts: ReturnType<typeof pactParts>; shown: boolean }) {
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

  // A plate in artpass pixels: sigil 30, gap 8, key cap, gap 8, words.
  const capW = parts.key ? keyCapWidth(parts.key, KEY_PX) / A : 0;
  const textW = measureText(parts.spans, TEXT_PX, undefined, "body").width / A;
  const contentW = 30 + 8 + (parts.key ? capW + 8 : 0) + textW;
  const x0 = -contentW / 2;
  return (
    <group ref={group}>
      <Plate width={(contentW + 22) * A} height={30 * A} frame="arcane" texel={2 * A}>
        <PixelSprite name="pact" tint={ink.ally} texel={2 * A} position={[(x0 + 15) * A, 0, 0.001]} delay={0.15} />
        {parts.key && <KeyCap k={parts.key} px={KEY_PX} position={[(x0 + 38 + capW / 2) * A, 0, 0.001]} />}
        <RuneText
          text={parts.spans}
          font="body"
          px={TEXT_PX}
          color={ink.parchment}
          anchor={[0, 0.5]}
          align="left"
          position={[(x0 + 38 + (parts.key ? capW + 8 : 0)) * A, 0, 0]}
          glow={0.6}
          outline={0.5}
          delay={0.2}
        />
      </Plate>
    </group>
  );
}
