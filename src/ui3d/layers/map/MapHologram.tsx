import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Group,
  type Mesh,
  type ShaderMaterial,
} from "three";
import { playHoloCast, playHoloCollapse } from "../../../audio/uiSounds";
import { playerPosition } from "../../../game/player-state";
import { useGame } from "../../../state/gameStore";
import { getBiomeDef } from "../../../world/biomes";
import { exploredVersion, getCurrentLayout, isExplored, markExplored, useCurrentLayout } from "../../../world/currentFloor";
import { getOmenDef, omenEffects } from "../../../world/omens";
import type { FloorLayout } from "../../../world/types";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { Plate } from "../../Plate";
import { UiShow } from "../../presence";
import { measureText, RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { usePresenceList } from "../hud/usePresenceList";
import { makeMarkerMaterial, makeTileMaterial, makeWallMaterial } from "./mapMaterials";
import { dungeonModel, villageModel, type MapMarker, type MapModel } from "./mapModel";
import { useMapCast, type MapCast } from "./mapStore";
import { makeBeamMaterial, makeSigilMaterial } from "./sigil";

/** The cast map (M): a miniature of where you are, projected as a hologram
 * an arm's length ahead of you — on a floor, as much of it as you have
 * explored; in the village, all of it.
 *
 * A sigil burns onto the ground, a column of light rises from it, and at
 * chest height a small table of light unfolds, tilted up toward you over a
 * dark haze: the floor ripples out from where you stand, the walls (or the
 * cottages) rise behind it, and markers kindle — you (a pulsing diamond
 * that walks as you walk), the way onward, the way home, the treasure and
 * the Warden once you've seen them. The miniature is true to the world, so
 * what is ahead of you on it is ahead of you in the hall. The place's name
 * hangs above it, and beside it stands a slab telling the floor's omen —
 * its name, its whisper and, line by line, what it does — so a floor's
 * mood can always be looked up. It stays where it was cast; walk off and
 * it lets go, M again folds it into its sigil.
 *
 * `ExploreTracker` (mounted with it) records what you've seen as you go,
 * cast or not (world/currentFloor.ts). */

/** How high the table hangs, m; how far it tilts up toward the caster,
 * radians. Its width follows how far ahead it was cast (mapWidth). */
const MAP_Y = 0.85;
const TILT = 0.45;

/** The table's width for a cast `dist` ahead: a fixed share of the view,
 * so a map cast close in a narrow hall is smaller, not in your face. */
export function mapWidth(dist: number): number {
  return Math.min(1.25, Math.max(0.5, dist * 0.56));
}
/** Walk this far from it and it lets go. */
const LEAVE_DIST = 8;
const COLOR = ink.arcane;

export function MapHologram() {
  const cast = useMapCast((s) => s.cast);
  const dismiss = useMapCast((s) => s.dismiss);
  const layout = useCurrentLayout();
  const phase = useGame((s) => s.phase);
  // Any change of place — a journey, a new floor, death — ends the spell.
  useEffect(() => {
    dismiss();
  }, [phase, layout, dismiss]);
  const value = useMemo(() => (cast && (cast.kind === "village" || layout) ? { cast, layout } : null), [cast, layout]);
  const { entries, remove } = usePresenceList(value, cast ? `${cast.id}` : null);
  return (
    <>
      <ExploreTracker />
      {entries.map((e) => (
        <Miniature key={e.id} cast={e.value.cast} layout={e.value.layout} shown={e.shown} onGone={() => remove(e.id)} />
      ))}
    </>
  );
}

/** Marks the tiles around the wizard as seen, a few times a second. */
function ExploreTracker() {
  const last = useRef(0);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (t - last.current < 0.2) return;
    last.current = t;
    const layout = getCurrentLayout();
    if (layout && useGame.getState().phase === "dungeon") markExplored(layout, playerPosition.x, playerPosition.z, 4);
  });
  return null;
}

const unitBox = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const unitTile = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const diamond = new OctahedronGeometry(1, 0);
const sigilQuad = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const baseDisc = new CircleGeometry(1, 40).rotateX(-Math.PI / 2);
const tmpM = new Matrix4();
const tmpP = new Vector3();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const UP = new Vector3(0, 1, 0);

function instanced(geometry: BoxGeometry | PlaneGeometry, material: ShaderMaterial, capacity: number, bright: boolean): InstancedMesh {
  const m = new InstancedMesh(geometry.clone(), material, Math.max(1, capacity));
  m.geometry.setAttribute("aBorn", new InstancedBufferAttribute(new Float32Array(Math.max(1, capacity)).fill(1e9), 1));
  if (bright) m.geometry.setAttribute("aBright", new InstancedBufferAttribute(new Float32Array(Math.max(1, capacity)).fill(1), 1));
  m.count = 0;
  m.frustumCulled = false;
  return m;
}

function Miniature({ cast, layout, shown, onGone }: { cast: MapCast; layout: FloorLayout | null; shown: boolean; onGone: () => void }) {
  const village = cast.kind === "village" || !layout;
  const MAP_W = mapWidth(cast.dist);
  // Text sized as a share of the screen, seen from where it was cast.
  const TITLE_PX = pxFor(cast.dist, 0.026);
  const SMALL_PX = pxFor(cast.dist, 0.013);
  const fixed = useMemo(() => (village ? villageModel() : null), [village]);
  const capacity = village ? { floor: fixed!.floor.length, raised: fixed!.raised.length } : { floor: layout!.size ** 2, raised: layout!.size ** 2 };

  const tileMat = useMemo(() => makeTileMaterial(COLOR), []);
  const wallMat = useMemo(() => makeWallMaterial(COLOR), []);
  const sigilMat = useMemo(() => makeSigilMaterial(COLOR), []);
  const beamMat = useMemo(() => makeBeamMaterial(COLOR, false), []);
  const baseMat = useMemo(() => new MeshBasicMaterial({ color: "#020306", transparent: true, opacity: 0, depthWrite: false }), []);
  const beamGeo = useMemo(() => new CylinderGeometry(MAP_W * 0.3, 0.28, MAP_Y, 24, 1, true).translate(0, MAP_Y / 2, 0), [MAP_W]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tiles = useMemo(() => instanced(unitTile, tileMat, capacity.floor, true), [tileMat, capacity.floor]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const walls = useMemo(() => instanced(unitBox, wallMat, capacity.raised, false), [wallMat, capacity.raised]);
  useEffect(
    () => () => {
      for (const m of [tileMat, wallMat, sigilMat, beamMat, baseMat]) m.dispose();
      beamGeo.dispose();
      tiles.geometry.dispose();
      walls.geometry.dispose();
    },
    [tileMat, wallMat, sigilMat, beamMat, baseMat, beamGeo, tiles, walls],
  );
  const youMat = useMemo(() => makeMarkerMaterial("#fff4dc"), []);
  useEffect(() => () => youMat.dispose(), [youMat]);

  // The table tilts up toward where the caster stood.
  const tilt = useMemo(() => new Quaternion().setFromAxisAngle(new Vector3(-cast.fwd[1], 0, cast.fwd[0]), TILT), [cast.fwd]);

  const [markers, setMarkersState] = useState<MapMarker[]>([]);
  // Re-render only when the set of markers changes (a new one seen).
  const setMarkers = (m: MapMarker[]) =>
    setMarkersState((prev) => (prev.length === m.length && prev.every((x, i) => x.key === m[i]!.key) ? prev : m));
  const inner = useRef<Group>(null);
  const label = useRef<Group>(null);
  const you = useRef<Mesh>(null);
  const youPin = useRef<Mesh>(null);
  const markerRefs = useRef<(Mesh | null)[]>([]);
  const camera = useThree((s) => s.camera);

  const state = useRef({
    born: new Map<number, number>(),
    version: -1,
    built: -10,
    castAt: uiNow(),
    goneAt: -1,
    frame: { s: 0, cx: 0, cz: 0 },
    shown: { s: 0, cx: 0, cz: 0 },
  });

  useEffect(() => {
    playHoloCast();
  }, []);
  useEffect(() => {
    if (!shown) {
      state.current.goneAt = uiNow();
      playHoloCollapse();
    }
  }, [shown]);

  useFrame((_, rawDt) => {
    const st = state.current;
    const now = uiNow();
    const dt = Math.min(rawDt, 0.1);
    const t = now - st.castAt;

    // (Re)build when more has been seen (at most a few times a second).
    const v = village ? 0 : exploredVersion();
    if (v !== st.version && now - st.built > 0.4) {
      st.version = v;
      st.built = now;
      const model = village ? fixed! : dungeonModel(layout!, (x, z) => isExplored(layout!, x, z));
      fill(model, st, tiles, walls, t < 0.6 ? st.castAt + 0.55 : now, MAP_W);
      setMarkers(model.markers);
    }
    // Ease the framing toward what the model frames (snap on the cast).
    const f = st.frame;
    const sf = st.shown;
    const k = sf.s === 0 ? 1 : 1 - Math.exp(-dt * 4);
    sf.s += (f.s - sf.s) * k;
    sf.cx += (f.cx - sf.cx) * k;
    sf.cz += (f.cz - sf.cz) * k;
    const scale = Math.max(1e-4, sf.s);
    const ig = inner.current;
    if (ig) {
      ig.scale.setScalar(scale);
      ig.position.set(-sf.cx * scale, 0.006, -sf.cz * scale);
    }

    // Collapse.
    const gone = st.goneAt > 0 ? Math.min(1, (now - st.goneAt) / 0.5) : 0;
    if (st.goneAt > 0 && now - st.goneAt > 0.75) {
      onGone();
      return;
    }
    const alpha = 1 - gone;
    for (const m of [tileMat, wallMat] as ShaderMaterial[]) {
      m.uniforms.uTime!.value = now;
      m.uniforms.uGone!.value = gone;
      m.uniforms.uAlpha!.value = alpha;
    }
    sigilMat.uniforms.uIgnite!.value = Math.min(1, t / 0.35);
    sigilMat.uniforms.uAlpha!.value = alpha;
    sigilMat.uniforms.uTime!.value = now;
    beamMat.uniforms.uGrow!.value = Math.min(1, Math.max(0, (t - 0.15) / 0.35)) * (1 - gone);
    beamMat.uniforms.uAlpha!.value = alpha * 0.7;
    beamMat.uniforms.uTime!.value = now;
    baseMat.opacity = 0.5 * Math.min(1, Math.max(0, (t - 0.3) / 0.3)) * alpha;

    // You, walking in the miniature; the markers (constant size on the map).
    const inv = 1 / scale;
    const appear = (delay: number) => Math.min(1, Math.max(0, (t - delay) / 0.2)) * alpha;
    const ya = you.current;
    if (ya) {
      ya.position.set(playerPosition.x, (0.04 + Math.sin(now * 3) * 0.004) * inv, playerPosition.z);
      ya.scale.set(0.022 * inv, 0.036 * inv, 0.022 * inv);
      ya.rotation.y = now * 1.5;
      youMat.uniforms.uTime!.value = now;
      youMat.uniforms.uPulse!.value = 1;
      youMat.uniforms.uAlpha!.value = appear(0.7);
    }
    const pin = youPin.current;
    if (pin && ya) {
      pin.position.set(ya.position.x, 0, ya.position.z);
      pin.scale.set(0.0025 * inv, 0.04 * inv, 0.0025 * inv);
    }
    markers.forEach((mk, i) => {
      const m = markerRefs.current[i];
      if (!m) return;
      m.position.set(mk.at[0], (0.045 + Math.sin(now * 2 + i) * 0.005) * inv, mk.at[2]);
      m.scale.set(0.017 * mk.size * inv, 0.028 * mk.size * inv, 0.017 * mk.size * inv);
      m.rotation.y = now * 0.8 + i;
      const mm = m.material as ShaderMaterial;
      mm.uniforms.uTime!.value = now;
      mm.uniforms.uAlpha!.value = appear(0.85 + i * 0.08);
    });
    // The title (and the omen slab under it) turn to face you.
    const lg = label.current;
    if (lg) {
      lg.getWorldPosition(tmpP);
      lg.rotation.y = Math.atan2(camera.position.x - tmpP.x, camera.position.z - tmpP.z);
    }
    // Wander off and the spell lets go.
    if (shown && Math.hypot(cast.at[0] - playerPosition.x, cast.at[2] - playerPosition.z) > LEAVE_DIST) useMapCast.getState().dismiss();
  });

  const biome = layout && !village ? getBiomeDef(layout.biome) : null;
  const omenId = layout && !village ? layout.omen : null;
  const omen = useMemo(() => (omenId ? omenLayout(omenId, pxFor(cast.dist, 0.0125)) : null), [omenId, cast.dist]);
  // The column above the table, built bottom-up from just over its raised
  // far edge: the omen slab (if any), then the place's name.
  const base = MAP_Y + MAP_W * 0.3;
  const slabH = omen ? omen.height : 0;
  const subY = slabH + (omen ? SMALL_PX * 6 : 0) + SMALL_PX * 4;
  const titleY = subY + SMALL_PX * 5 + TITLE_PX * 3.5;
  return (
    <group position={cast.at}>
      <mesh geometry={sigilQuad} material={sigilMat} scale={[0.85, 1, 0.85]} position={[0, 0.01, 0]} renderOrder={1} />
      <mesh geometry={beamGeo} material={beamMat} renderOrder={1} />
      <group position={[0, MAP_Y, 0]} quaternion={tilt}>
        <mesh geometry={baseDisc} material={baseMat} scale={MAP_W * 0.62} renderOrder={0} />
        <group ref={inner} scale={0.001}>
          <primitive object={tiles} />
          <primitive object={walls} />
          {markers.map((mk, i) => (
            <MarkerMesh
              key={mk.key}
              color={mk.color}
              meshRef={(m) => {
                markerRefs.current[i] = m;
              }}
            />
          ))}
          <mesh ref={you} geometry={diamond} material={youMat} />
          <mesh ref={youPin} geometry={unitBox} material={youMat} />
        </group>
      </group>
      <group ref={label} position={[0, base, 0]}>
        <UiShow show={shown}>
          <RuneText text={village ? "The Village" : `Floor ${layout!.floor}`} font="heading" px={TITLE_PX} color={ink.parchment} glow={0.7} outline={0.6} position={[0, titleY, 0]} delay={0.8} />
          <RuneText
            text={village ? "SANCTUARY" : `${biome!.name.toUpperCase()}${omen ? "" : " · A CALM FLOOR"}`}
            font="label"
            px={SMALL_PX}
            color={ink.arcane}
            glow={0.5}
            outline={0.6}
            position={[0, subY, 0]}
            delay={1}
          />
          {omen && (
            <group position={[0, slabH / 2, 0]}>
              <OmenSlab layout={omen} />
            </group>
          )}
        </UiShow>
      </group>
    </group>
  );
}

interface OmenRow {
  text: string;
  font: "label" | "heading" | "body";
  color: string;
  px: number;
  h: number;
  gap: number;
}

/** The omen slab's rows and size: its name, line by line what it does
 * (▲ helps you, ▼ hurts), and its whisper, small and dim. */
function omenLayout(id: NonNullable<FloorLayout["omen"]>, px: number): { rows: OmenRow[]; width: number; height: number; px: number } {
  const def = getOmenDef(id);
  const cols = 40;
  const rows: OmenRow[] = [];
  let width = 0;
  const add = (text: string, font: OmenRow["font"], color: string, size: number, gap: number) => {
    const m = measureText(text, size, cols, font);
    width = Math.max(width, m.width);
    rows.push({ text, font, color, px: size, h: m.height, gap });
  };
  add(`OMEN · ${def.name.toUpperCase()}`, "label", "#d9b8ff", px * 0.9, 0);
  omenEffects(id).forEach((e, i) => add(`${e.good ? "▲" : "▼"} ${e.text}`, "body", e.good ? "#8ee69a" : "#ff8a7a", px, i === 0 ? px * 5 : px * 2.5));
  add(def.whisper, "body", ink.faded, px * 0.85, px * 5);
  const height = rows.reduce((h, r) => h + r.h + r.gap, 0) + px * 12;
  return { rows, width: width + px * 14, height, px };
}

/** The floor's omen, written on a slab (omenLayout). */
function OmenSlab({ layout: L }: { layout: ReturnType<typeof omenLayout> }) {
  let y = L.height / 2 - L.px * 6;
  return (
    <Plate width={L.width} height={L.height} frame="violet" texel={L.px * 1.1}>
      {L.rows.map((r, i) => {
        const top = y - r.gap;
        y = top - r.h;
        return (
          <RuneText
            key={i}
            text={r.text}
            font={r.font}
            px={r.px}
            color={r.color}
            maxCols={40}
            align="left"
            anchor={[0, 0]}
            position={[-L.width / 2 + L.px * 7, top, 0]}
            glow={0.4}
            outline={0.6}
            delay={1.1 + i * 0.1}
          />
        );
      })}
    </Plate>
  );
}

function MarkerMesh({ color, meshRef }: { color: string; meshRef: (m: Mesh | null) => void }) {
  const mat = useMemo(() => makeMarkerMaterial(color), [color]);
  useEffect(() => () => mat.dispose(), [mat]);
  return <mesh ref={meshRef} geometry={diamond} material={mat} />;
}

/** Lay the model's pieces into the instanced meshes; new pieces are born
 * on a ripple out from where the wizard stands. */
function fill(
  model: MapModel,
  st: { born: Map<number, number>; frame: { s: number; cx: number; cz: number } },
  tiles: InstancedMesh,
  walls: InstancedMesh,
  from: number,
  width: number,
) {
  const ripple = (x: number, z: number) => from + Math.hypot(x - playerPosition.x, z - playerPosition.z) * 0.015;
  const tileBorn = tiles.geometry.getAttribute("aBorn") as InstancedBufferAttribute;
  const tileBright = tiles.geometry.getAttribute("aBright") as InstancedBufferAttribute;
  const wallBorn = walls.geometry.getAttribute("aBorn") as InstancedBufferAttribute;
  let i = 0;
  for (const p of model.floor) {
    if (i >= tiles.instanceMatrix.count) break;
    let born = st.born.get(p.key);
    if (born === undefined) st.born.set(p.key, (born = ripple(p.x, p.z)));
    tmpM.compose(tmpP.set(p.x, 0, p.z), tmpQ.identity(), tmpS.set(p.sx, 1, p.sz));
    tiles.setMatrixAt(i, tmpM);
    tileBorn.setX(i, born);
    tileBright.setX(i, p.bright);
    i++;
  }
  tiles.count = i;
  let w = 0;
  for (const p of model.raised) {
    if (w >= walls.instanceMatrix.count) break;
    let born = st.born.get(p.key);
    if (born === undefined) st.born.set(p.key, (born = ripple(p.x, p.z) + 0.08));
    tmpM.compose(tmpP.set(p.x, 0, p.z), tmpQ.setFromAxisAngle(UP, p.rot), tmpS.set(p.sx, p.h, p.sz));
    walls.setMatrixAt(w, tmpM);
    wallBorn.setX(w, born);
    w++;
  }
  walls.count = w;
  tiles.instanceMatrix.needsUpdate = true;
  walls.instanceMatrix.needsUpdate = true;
  tileBorn.needsUpdate = true;
  tileBright.needsUpdate = true;
  wallBorn.needsUpdate = true;
  if (model.bounds) {
    const b = model.bounds;
    st.frame.s = width / Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    st.frame.cx = (b.minX + b.maxX) / 2;
    st.frame.cz = (b.minZ + b.maxZ) / 2;
  }
}
