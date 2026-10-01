import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, Group, ShaderMaterial } from "three";
import { getItemDef } from "../../../items/catalog";
import { WizardModel } from "../../../render/models/WizardModel";
import { useGame } from "../../../state/gameStore";
import { uiNow } from "../../clock";
import { useUiShow } from "../../presence";
import { ink } from "../../theme";
import { emitUiSparks } from "../../UiSparks";
import { useInventory } from "./interaction";
import { ALTAR } from "./layout";
import { plane } from "./materials";

/** Your wizard, standing in a window cut into the altar — the paper doll of
 * artpass's satchel (gear around a figure), with the figure made real: the
 * same WizardModel floor-mates see, on a slow turn, wearing exactly what's in
 * the cards beside it. Equip something and the rune ring on the ledge flares
 * and embers rise around the figure.
 *
 * The window is pixel art drawn by one shader: a round-topped arch with an
 * ink outline and an iron rim lit from the upper left, a void inside with
 * the violet halo behind the figure in hard stepped rings (dithered where
 * two rings meet), a few blinking motes, a stone ledge, and the arcane ring
 * the wizard stands in. It is cut into the stone row by row, bottom up, as
 * the altar settles. */

const SCALE = 0.22; // the model is ~2.3 m tall → ~50 cm on the altar
const FEET = -0.85; // model-space y of the robe's hem
const STAND_Z = 0.08;
/** World size of one window texel. */
const TEXEL = 0.0046;
/** Ledge height in texels (the wizard's feet stand on its top). */
const LEDGE = 8;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec2 uSize;
uniform float uTexel;
uniform float uLedge;
uniform float uCarve;
uniform float uPulse;
uniform float uRingK;
uniform float uTime;
uniform vec3 uInk;
uniform vec3 uVoid;
uniform vec3 uRim;
uniform vec3 uRimLit;
uniform vec3 uRimDark;
uniform vec3 uStone;
uniform vec3 uStoneLit;
uniform vec3 uGlow;
uniform vec3 uRing;
uniform vec3 uHot;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 n = floor(uSize / uTexel);
  vec2 t = floor(vUv * n);
  vec2 c = t + 0.5;
  float r = n.x * 0.5;
  float spring = n.y - r;
  // Texels from the outside of the arch.
  float d = c.y < spring ? r - abs(c.x - r) : r - length(c - vec2(r, spring));
  d = min(d, c.y);
  if (d < 0.0) discard;
  // Cut in row by row from the bottom; the cutting row glows white-hot.
  float row = t.y / n.y;
  if (row > uCarve) discard;
  if (row > uCarve - 1.5 / n.y && uCarve < 1.0) { gl_FragColor = vec4(uHot, 1.0); return; }

  vec3 col;
  bool left = c.x < r;
  if (d < 1.0) col = uInk;
  else if (d < 3.0) col = (left && d < 2.0) || (c.y > spring && c.x < r * 1.2 && d < 2.0) ? uRimLit : left ? uRim : uRimDark;
  else if (t.y < uLedge) {
    // The ledge: stone, a lit lip, an ink line above it.
    col = t.y == uLedge - 1.0 ? uStoneLit : uStone * (mod(t.x + floor(t.y / 3.0) * 3.0, 9.0) < 1.0 ? 0.6 : 1.0);
  } else if (t.y == uLedge) {
    col = uInk;
  } else {
    // The void, the halo in hard rings (dithered on their borders).
    vec2 h = (c - vec2(r, n.y * 0.5)) / vec2(r * 0.95, n.y * 0.42);
    float e = length(h) - uPulse * 0.25;
    float dith = mod(t.x + t.y, 2.0);
    float k = 0.0;
    if (e < 0.42 + dith * 0.05) k = 0.42;
    else if (e < 0.68 + dith * 0.05) k = 0.22;
    else if (e < 0.94 + dith * 0.05) k = 0.09;
    col = uVoid + uGlow * k * (1.0 + uPulse);
    // The inner shadow under the rim.
    if (d < 4.0) col *= 0.5;
    // Motes: a few pixels that blink on their own beat.
    float m = hash(t);
    if (m > 0.987 && mod(floor(uTime * 1.5 + m * 17.0), 3.0) < 1.0) col = mix(col, m > 0.994 ? uRing : uGlow * 2.2, 0.8);
  }
  // The rune ring around the wizard's feet (an ellipse lying on the ledge).
  vec2 rq = (c - vec2(r, uLedge + 0.5)) / vec2(r * 0.6, 3.0);
  float ringD = abs(length(rq) - 1.0) * 3.0;
  if (ringD < 0.55 && d >= 3.0 && t.y <= uLedge + 3.0) col = mix(col, uRing * (0.55 + uRingK), step(0.5, uRingK + 0.5));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export function WizardShrine() {
  const ix = useInventory();
  const show = useUiShow();
  const equipment = useGame((s) => s.equipment);
  const staffColor = getItemDef(equipment.staff.defId).color;
  const robeColor = equipment.cloak ? getItemDef(equipment.cloak.defId).color : "#4a4458";
  const bootsColor = equipment.boots ? getItemDef(equipment.boots.defId).color : null;
  const amuletColor = equipment.amulet ? getItemDef(equipment.amulet.defId).color : null;
  const dressed = [equipment.staff.defId, equipment.amulet?.defId, equipment.cloak?.defId, equipment.boots?.defId].join("|");

  const bottom = ALTAR.ledgeY - LEDGE * TEXEL;
  const w = ALTAR.archWidth;
  const h = ALTAR.archTop - bottom;
  const win = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uSize: { value: [w, h] },
          uTexel: { value: TEXEL },
          uLedge: { value: LEDGE },
          uCarve: { value: 0 },
          uPulse: { value: 0 },
          uRingK: { value: 0.5 },
          uTime: { value: 0 },
          uInk: { value: new Color(ink.ink) },
          uVoid: { value: new Color("#0b0810") },
          uRim: { value: new Color("#4a4152") },
          uRimLit: { value: new Color("#7d7288") },
          uRimDark: { value: new Color("#241e2a") },
          uStone: { value: new Color("#2a2231") },
          uStoneLit: { value: new Color("#5a4e66") },
          uGlow: { value: new Color("#5a3f99") },
          uRing: { value: new Color(ink.arcane) },
          uHot: { value: new Color("#fff6d8") },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
      }),
    [w, h],
  );
  useEffect(() => () => win.dispose(), [win]);

  const figure = useRef<Group>(null);
  const turn = useRef<Group>(null);
  const shownAt = useRef(uiNow());
  const st = useRef({ appear: 0, fall: 0, carve: 0, everShown: false });
  useEffect(() => {
    if (show) {
      shownAt.current = uiNow();
      st.current.fall = 0;
      st.current.everShown = true;
    }
  }, [show]);

  // Something new on the wizard: flare the ring, shed embers.
  const firstDress = useRef(true);
  useEffect(() => {
    if (firstDress.current) {
      firstDress.current = false;
      return;
    }
    ix.equipPulseAt = uiNow();
    const f = figure.current;
    if (!f) return;
    const p = f.getWorldPosition(f.position.clone());
    for (let i = 0; i < 4; i++) {
      emitUiSparks({ position: [p.x, p.y + 0.05 + i * 0.1, p.z], color: i % 2 ? ink.arcane : robeColor, count: 6, speed: 0.12, up: 0.12, size: 0.008, spread: 0.12, ttl: 0.9 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dressed, ix]);

  useFrame((_, dt) => {
    const now = uiNow();
    const s = st.current;
    const u = win.uniforms;
    const pulse = Math.max(0, 1 - (now - ix.equipPulseAt) / 0.9);
    // Stepped, like everything in the grimoire: the flare dies in 4 steps.
    u.uPulse!.value = Math.ceil(pulse * 4) / 4;
    u.uTime!.value = now;
    u.uRingK!.value = Math.floor(now * 2) % 2 === 0 ? 0.45 : 0.3 + (pulse > 0 ? 0.8 : 0);
    // The window is cut as the tablet settles; filled back in on close.
    s.carve = show ? Math.min(1, (now - shownAt.current) / 0.4) : Math.max(0, s.carve - dt * 4);
    u.uCarve!.value = Math.round(s.carve * 24) / 24;
    // The figure steps out of the dark after the stones settle.
    if (show) s.appear = Math.min(1, Math.max(0, (now - shownAt.current - 0.25) / 0.6));
    else s.fall += dt;
    const f = figure.current;
    if (f) {
      const e = 1 - (1 - s.appear) ** 3;
      // Hidden until first shown; after that, closing shrinks it away.
      const shrink = show ? e : s.everShown ? Math.max(0, 1 - s.fall / 0.5) : 0;
      f.scale.setScalar(Math.max(0.0001, SCALE * shrink));
      f.position.y = ALTAR.ledgeY - FEET * SCALE * shrink + (show ? 0 : -s.fall * s.fall * 1.5) + Math.sin(now * 1.4) * 0.004;
      f.visible = shrink > 0.001;
    }
    if (turn.current) turn.current.rotation.y += dt * 0.45;
  });

  return (
    <group>
      <mesh geometry={plane()} material={win} scale={[w, h, 1]} position={[0, bottom + h / 2, 0.001]} visible={show || st.current.carve > 0} />
      <group ref={figure} position={[0, ALTAR.ledgeY, STAND_Z]} scale={SCALE}>
        <group ref={turn}>
          <WizardModel robeColor={robeColor} staffColor={staffColor} staffId={equipment.staff.defId} bootsColor={bootsColor} amuletColor={amuletColor} />
        </group>
      </group>
    </group>
  );
}
