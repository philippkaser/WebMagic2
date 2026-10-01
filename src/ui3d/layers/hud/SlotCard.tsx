import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Color, MeshBasicMaterial, ShaderMaterial, type Group } from "three";
import { uiNow } from "../../clock";
import { ItemModel } from "../../ItemModel";
import { KeyCap } from "../../KeyCap";
import { RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { fontPxAt } from "./ap";
import { useStepFade } from "./fade";
import { Undistort } from "./HudAnchor";
import { Materialize } from "./Materialize";
import { PixelSprite, unitQuad } from "./PixelSprite";
import { SLOT } from "./layout";
import type { SpriteName } from "./sprites";
import { usePresenceList } from "./usePresenceList";

/** One item slot of the HUD (artpass's small item card, `.wm-card--sm`): a
 * dark card with a 2 px border in the item's colour inside an ink ring, its
 * colour pooled in the middle in hard bands — and the item itself, the 3D
 * model, turning slowly in it. Badges as artpass draws them: the level (or
 * stack count) bottom right, a gem for an enchanted piece, an hourglass for
 * run loot that's lost on death until banked, and an optional key cap on
 * the top-left corner (the belt's Q / E). An empty slot is a dashed card
 * with a faint silhouette of what belongs there.
 *
 * A changed item never swaps in place: the old one burns away as the new
 * one arrives (usePresenceList + Materialize). */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec2 uPx;
uniform vec3 uColor;
uniform float uEmpty;
uniform float uFlash;
uniform float uShow;
varying vec2 vUv;
void main() {
  vec2 p = floor(vUv * uPx);
  float d = min(min(p.x, p.y), min(uPx.x - 1.0 - p.x, uPx.y - 1.0 - p.y));
  vec3 col;
  if (d < 2.0) {
    col = vec3(0.027, 0.024, 0.04);
  } else if (d < 4.0) {
    // The rarity border; dashed and dim on an empty card.
    float dash = step(mod(floor((p.x + p.y) / 2.0), 2.0), 0.5);
    col = uEmpty > 0.5 ? mix(vec3(0.027, 0.024, 0.04), vec3(0.18, 0.153, 0.208), dash) : uColor;
  } else if (d < 5.0) {
    col = vec3(0.03, 0.022, 0.04);
  } else {
    // Card: a touch lighter at the top, darker below, the item's colour
    // pooled in the middle of the art in three hard bands.
    float v = p.y / uPx.y;
    col = vec3(0.07, 0.055, 0.09) * (0.68 + 0.42 * v);
    vec2 c = (p + 0.5 - uPx * vec2(0.5, 0.55)) / (uPx * 0.5);
    float r = length(c);
    float pool = (1.0 - uEmpty) * (r < 0.42 ? 0.22 : r < 0.58 ? 0.13 : r < 0.72 ? 0.06 : 0.0);
    col = mix(col, uColor, pool + uFlash * 0.35);
  }
  gl_FragColor = vec4(col * uShow, uShow);
  #include <colorspace_fragment>
}
`;

export interface SlotPose {
  /** Model scale in artpass pixels. */
  scale: number;
  rot: readonly [number, number, number];
}

export function SlotCard({
  unit,
  itemId,
  color,
  icon,
  pose,
  badge,
  keyCap,
  runLoot = false,
  enchanted = false,
  flashAt,
  index = 0,
  position,
}: {
  unit: number;
  itemId: string | null;
  /** The item's colour (rarity); ignored when empty. */
  color: string;
  /** Silhouette shown in an empty slot. */
  icon: SpriteName;
  pose: SlotPose;
  /** Level or stack count, bottom right (null = none). */
  badge: string | null;
  keyCap?: string;
  runLoot?: boolean;
  enchanted?: boolean;
  /** uiNow() of the last flash (a change, a use). */
  flashAt?: MutableRefObject<number>;
  index?: number;
  position: readonly [number, number, number];
}) {
  const W = SLOT.w + 4;
  const H = SLOT.h + 4;
  const empty = itemId === null;
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uPx: { value: [W, H] },
          uColor: { value: new Color(color) },
          uEmpty: { value: 0 },
          uFlash: { value: 0 },
          uShow: { value: 0 },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
      }),
    // Colour is written below, not rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const u = material.uniforms;
  (u.uColor!.value as Color).set(color);
  u.uEmpty!.value = empty ? 1 : 0;
  const delay = 0.2 + index * 0.07;
  const fade = useStepFade({ delay, inTime: 0.25, steps: 4 });
  const { entries, remove } = usePresenceList(itemId, itemId);
  const turn = useRef<Group>(null);
  const seed = index * 1.7;

  useFrame(() => {
    const now = uiNow();
    const since = now - (flashAt?.current ?? -10);
    const flash = since < 1.2 ? Math.ceil((1 - since / 1.2) * 4) / 4 : 0;
    u.uFlash!.value = flash;
    u.uShow!.value = fade.current;
    const t = turn.current;
    if (t) {
      // Turning slowly on its hook; a fresh piece bobs up, bright.
      t.rotation.y = Math.sin(now * 0.6 + seed) * 0.45;
      t.position.y = (Math.sin(now * 1.1 + seed) * 0.6 + flash * 2) * unit;
      t.scale.setScalar(1 + flash * 0.15);
    }
  });

  const label = fontPxAt(8, "label", unit);
  return (
    <group position={position as [number, number, number]}>
      <mesh geometry={unitQuad()} material={material} scale={[W * unit, H * unit, 1]} renderOrder={6} />
      {empty && <PixelSprite name={icon} tint="#8a8090" texel={2 * unit} opacity={0.22} position={[0, 2 * unit, 0.0005]} delay={delay + 0.1} />}
      <Undistort at={[0, 2 * unit, 0.02]}>
        <group ref={turn}>
          {entries.map((e) => (
            <Materialize key={e.id} show={e.shown} delay={delay + 0.1} color={color} size={SLOT.h * unit * 0.4} from={[0, 0, -SLOT.h * unit * 2]} onHidden={() => remove(e.id)}>
              <group rotation={pose.rot as [number, number, number]}>
                <ItemModel itemId={e.value} scale={pose.scale * unit} />
              </group>
            </Materialize>
          ))}
        </group>
      </Undistort>
      {badge && !empty && <Badge text={badge} unit={unit} color={color} px={label} delay={delay + 0.3} />}
      {enchanted && !empty && <PixelSprite name="gem" tint={ink.violet} texel={unit} position={[(-W / 2 + 6.5) * unit, (H / 2 - 6.5) * unit, 0.03]} delay={delay + 0.3} />}
      {runLoot && !empty && <RiskMark unit={unit} delay={delay + 0.35} position={[(W / 2 - 7.5) * unit, (H / 2 - 7.5) * unit, 0.03]} />}
      {keyCap && <KeyCap k={keyCap} px={fontPxAt(9, "label", unit)} position={[(-W / 2 + 4) * unit, (H / 2 - 3) * unit, 0.035]} />}
    </group>
  );
}

/** The level / count badge (`.wm-card__lvl`): ink plate, item-coloured
 * top-left edge, parchment digits. */
function Badge({ text, unit, color, px, delay }: { text: string; unit: number; color: string; px: number; delay: number }) {
  const w = text.length * 6 + 5;
  const h = 10;
  const edge = useMemo(() => new MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0 }), [color]);
  const fill = useMemo(() => new MeshBasicMaterial({ color: ink.ink, toneMapped: false, transparent: true, opacity: 0 }), []);
  useEffect(
    () => () => {
      edge.dispose();
      fill.dispose();
    },
    [edge, fill],
  );
  const fade = useStepFade({ delay, inTime: 0.2, steps: 3 });
  useFrame(() => {
    edge.opacity = fade.current;
    fill.opacity = fade.current;
  });
  const x = (SLOT.w / 2 + 1 - w / 2) * unit;
  const y = (-SLOT.h / 2 - 1 + h / 2) * unit;
  return (
    <group position={[x, y, 0.03]}>
      <mesh geometry={unitQuad()} material={edge} scale={[w * unit, h * unit, 1]} renderOrder={9} />
      <mesh geometry={unitQuad()} material={fill} scale={[(w - 1) * unit, (h - 1) * unit, 1]} position={[0.5 * unit, -0.5 * unit, 0.0002]} renderOrder={9} />
      <RuneText text={text} font="label" px={px} color={ink.parchment} position={[0.5 * unit, -0.5 * unit, 0.0004]} glow={0} outline={0} delay={delay} depth={-0.2} renderOrder={10} />
    </group>
  );
}

/** Run loot: a brass hourglass on the corner, throbbing (artpass's
 * `.wm-card__risk`). */
function RiskMark({ unit, delay, position }: { unit: number; delay: number; position: readonly [number, number, number] }) {
  const throb = useRef(1);
  useFrame(() => {
    throb.current = Math.floor(uiNow() / 0.8) % 2 === 0 ? 1 : 0.55;
  });
  return <PixelSprite name="hourglass" tint={ink.brass} texel={unit} opacityRef={throb} position={position} delay={delay} />;
}
