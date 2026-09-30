import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { AdditiveBlending, Color, CylinderGeometry, Group, Mesh, ShaderMaterial, TorusGeometry } from "three";
import { getItemDef } from "../../../items/catalog";
import { WizardModel } from "../../../render/models/WizardModel";
import { useGame } from "../../../state/gameStore";
import { uiNow } from "../../clock";
import { glowMaterial, stoneMaterial } from "../../materials";
import { useUiShow } from "../../presence";
import { emitUiSparks } from "../../UiSparks";
import { useInventory } from "./interaction";
import { ALTAR } from "./layout";
import { archFrameGeometry, archGeometry, INK, slate } from "./materials";

/** Your wizard, standing in a niche carved into the altar: the same
 * WizardModel floor-mates see, on a slow turn, wearing exactly what's in the
 * gear sockets beside it. Equip something and the ledge's rune ring flares
 * and embers rise around the figure.
 *
 * The niche is a dark arch with a faint violet glow behind the figure (so the
 * silhouette reads against the stone), framed by a carved arch; the wizard
 * stands on a half-round ledge that juts out of the tablet. */

const SCALE = 0.24; // the model is ~2.3 m tall → ~55 cm on the altar
const FEET = -0.85; // model-space y of the robe's hem
const LEDGE_R = 0.19;
const STAND_Z = 0.1;

const NICHE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const NICHE_FRAG = /* glsl */ `
uniform vec3 uGlow;
uniform float uPulse;
varying vec2 vUv;
void main() {
  // A deep recess: black at the walls, a violet haze behind the figure
  // (strongest at chest height), a little warmer where the ledge meets it.
  vec2 c = vUv - vec2(0.5, 0.45);
  float haze = exp(-dot(c * vec2(2.2, 1.3), c * vec2(2.2, 1.3)) * 5.0);
  float wall = smoothstep(0.5, 0.0, abs(vUv.x - 0.5));
  vec3 col = vec3(0.012, 0.009, 0.018) + uGlow * haze * (0.55 + uPulse * 0.8) * wall;
  col += vec3(0.05, 0.03, 0.02) * smoothstep(0.18, 0.0, vUv.y) * wall;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

let ledgeGeo: CylinderGeometry | null = null;
let ringGeo: TorusGeometry | null = null;

export function WizardShrine() {
  const ix = useInventory();
  const show = useUiShow();
  const equipment = useGame((s) => s.equipment);
  const staffColor = getItemDef(equipment.staff.defId).color;
  const robeColor = equipment.cloak ? getItemDef(equipment.cloak.defId).color : "#4a4458";
  const bootsColor = equipment.boots ? getItemDef(equipment.boots.defId).color : null;
  const amuletColor = equipment.amulet ? getItemDef(equipment.amulet.defId).color : null;
  const dressed = [equipment.staff.defId, equipment.amulet?.defId, equipment.cloak?.defId, equipment.boots?.defId].join("|");

  const niche = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uGlow: { value: new Color("#4b3a78") }, uPulse: { value: 0 } },
        vertexShader: NICHE_VERT,
        fragmentShader: NICHE_FRAG,
      }),
    [],
  );
  const ring = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uColor: { value: new Color(INK.accent) }, uI: { value: 0.6 } },
        vertexShader: NICHE_VERT,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uI;
          void main() {
            gl_FragColor = vec4(uColor * uI, 0.0);
            #include <colorspace_fragment>
            gl_FragColor.a = 0.0;
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        premultipliedAlpha: true,
      }),
    [],
  );
  useEffect(
    () => () => {
      niche.dispose();
      ring.dispose();
    },
    [niche, ring],
  );
  ledgeGeo ??= new CylinderGeometry(LEDGE_R, LEDGE_R * 0.92, 0.04, 28, 1, false, -Math.PI / 2, Math.PI);
  ringGeo ??= new TorusGeometry(LEDGE_R * 0.72, 0.0045, 4, 40, Math.PI);

  const figure = useRef<Group>(null);
  const turn = useRef<Group>(null);
  const carving = useRef<Group>(null);
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
      emitUiSparks({ position: [p.x, p.y + 0.05 + i * 0.1, p.z], color: i % 2 ? INK.accent : robeColor, count: 6, speed: 0.12, up: 0.12, size: 0.008, spread: 0.12, ttl: 0.9 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dressed, ix]);

  const ledgeMesh = useRef<Mesh>(null);
  useFrame((_, dt) => {
    const now = uiNow();
    const s = st.current;
    const pulse = Math.max(0, 1 - (now - ix.equipPulseAt) / 0.9);
    niche.uniforms.uPulse!.value = pulse;
    // The figure steps out of the dark after the stones settle.
    if (show) s.appear = Math.min(1, Math.max(0, (now - shownAt.current - 0.2) / 0.6));
    else s.fall += dt;
    ring.uniforms.uI!.value = (0.5 + Math.sin(now * 2.2) * 0.12 + pulse * 1.6) * (show ? s.appear : s.everShown ? Math.max(0, 1 - s.fall * 3) : 0);
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
    // The niche is cut into the stone as the tablet settles.
    s.carve = show ? Math.min(1, (now - shownAt.current) / 0.35) : Math.max(0, s.carve - dt * 4);
    const c = carving.current;
    if (c) {
      c.visible = s.carve > 0;
      c.scale.setScalar(Math.max(0.0001, 0.7 + 0.3 * s.carve));
    }
    if (ledgeMesh.current) {
      const k = show ? Math.min(1, s.appear * 2) : s.everShown ? Math.max(0, 1 - s.fall * 3) : 0;
      ledgeMesh.current.scale.setScalar(Math.max(0.0001, k));
      ledgeMesh.current.visible = k > 0.001;
    }
  });

  const bottom = ALTAR.ledgeY - 0.02;
  return (
    <group>
      <group ref={carving} visible={false}>
        <mesh geometry={archGeometry(ALTAR.archWidth, bottom, ALTAR.archTop)} material={niche} position={[0, 0, 0.001]} />
        <mesh geometry={archFrameGeometry(ALTAR.archWidth, bottom, ALTAR.archTop, 0.03)} material={stoneMaterial("#5d5767")} />
      </group>
      <group ref={ledgeMesh} position={[0, ALTAR.ledgeY - 0.02, 0]}>
        <mesh geometry={ledgeGeo} material={slate()} />
        <mesh geometry={ledgeGeo} material={stoneMaterial("#5d5767")} scale={[1.04, 0.6, 1.04]} position={[0, -0.02, 0]} />
        <mesh geometry={ringGeo} material={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.021, 0]} renderOrder={4} />
        <mesh position={[0, 0.021, LEDGE_R * 0.72]} material={glowMaterial(INK.accent, 2.4)} scale={0.008}>
          <octahedronGeometry args={[1, 0]} />
        </mesh>
      </group>
      <group ref={figure} position={[0, ALTAR.ledgeY, STAND_Z]} scale={SCALE}>
        <group ref={turn}>
          <WizardModel robeColor={robeColor} staffColor={staffColor} bootsColor={bootsColor} amuletColor={amuletColor} />
        </group>
      </group>
    </group>
  );
}
