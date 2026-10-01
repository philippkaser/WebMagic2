import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  CylinderGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  OctahedronGeometry,
  PlaneGeometry,
  Vector3,
  type Group,
  type Mesh,
  type ShaderMaterial,
} from "three";
import { playHoloCast, playHoloCollapse } from "../../../audio/uiSounds";
import { TILE } from "../../../core/config";
import { playerPosition } from "../../../game/player-state";
import { useGame } from "../../../state/gameStore";
import { exploredVersion, getCurrentLayout, isExplored, markExplored, useCurrentLayout } from "../../../world/currentFloor";
import { getBiomeDef } from "../../../world/biomes";
import type { FloorLayout } from "../../../world/types";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { makeBeamMaterial, makeSigilMaterial } from "../../holo/Projector";
import { UiShow } from "../../presence";
import { RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { usePresenceList } from "../hud/usePresenceList";
import { makeMarkerMaterial, makeTileMaterial, makeWallMaterial } from "./mapMaterials";
import { useMapCast, type MapCast } from "./mapStore";

/** The cast map (M, on a floor): a miniature of the floor as far as you
 * have seen it, projected as a hologram a stride ahead of you.
 *
 * A sigil burns onto the floor, a column of light rises from it, and at
 * table height the map unfolds: the explored floor tiles ripple out from
 * where you stand, the walls rise behind them like ribs of light, and
 * markers kindle — you (a pulsing diamond that walks as you walk), the way
 * onward, the way home, the treasure and the Warden once you've seen them.
 * The floor's name hangs above it. The miniature is true to the world (its
 * north is the world's north), so you can walk around it; it stays where
 * it was cast and fades if you wander off. M again, or a few steps away,
 * and it folds back down into its sigil.
 *
 * `ExploreTracker` (mounted with it) records what you've seen as you go,
 * cast or not (world/currentFloor.ts). */

/** The miniature's width, m, and how high above the floor it hangs. The
 * miniature frames what you have explored; the map's width never shows
 * fewer than MIN_TILES tiles (a first room isn't blown up to a table). */
const MAP_W = 1.5;
const MAP_Y = 0.82;
const MIN_TILES = 14;
/** Walk this far from it and it lets go. */
const LEAVE_DIST = 9;
const COLOR = ink.arcane;

export function MapHologram() {
  const cast = useMapCast((s) => s.cast);
  const dismiss = useMapCast((s) => s.dismiss);
  const layout = useCurrentLayout();
  const phase = useGame((s) => s.phase);
  // A new floor, leaving the floor, or dying all end the spell.
  useEffect(() => {
    if (phase !== "dungeon") dismiss();
  }, [phase, dismiss]);
  useEffect(() => {
    dismiss();
  }, [layout, dismiss]);
  const value = useMemo(() => (cast && layout ? { cast, layout } : null), [cast, layout]);
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
const tmpM = new Matrix4();
const tmpV = new Vector3();

interface Marker {
  key: string;
  at: [number, number, number];
  color: string;
  size: number;
  /** Only once you have seen it. */
  needsSeen: boolean;
}

function Miniature({ cast, layout, shown, onGone }: { cast: MapCast; layout: FloorLayout; shown: boolean; onGone: () => void }) {
  const n = layout.size;
  const tileMat = useMemo(() => makeTileMaterial(COLOR), []);
  const wallMat = useMemo(() => makeWallMaterial(COLOR), []);
  const sigilMat = useMemo(() => makeSigilMaterial(COLOR), []);
  const beamMat = useMemo(() => makeBeamMaterial(COLOR, false), []);
  const beamGeo = useMemo(() => new CylinderGeometry(MAP_W * 0.36, 0.3, MAP_Y, 24, 1, true).translate(0, MAP_Y / 2, 0), []);
  const tiles = useMemo(() => {
    const m = new InstancedMesh(unitTile, tileMat, n * n);
    m.geometry = unitTile.clone();
    m.geometry.setAttribute("aBorn", new InstancedBufferAttribute(new Float32Array(n * n).fill(1e9), 1));
    m.count = 0;
    m.frustumCulled = false;
    return m;
  }, [n, tileMat]);
  const walls = useMemo(() => {
    const m = new InstancedMesh(unitBox, wallMat, n * n);
    m.geometry = unitBox.clone();
    m.geometry.setAttribute("aBorn", new InstancedBufferAttribute(new Float32Array(n * n).fill(1e9), 1));
    m.count = 0;
    m.frustumCulled = false;
    return m;
  }, [n, wallMat]);
  useEffect(
    () => () => {
      for (const m of [tileMat, wallMat, sigilMat, beamMat]) m.dispose();
      beamGeo.dispose();
      tiles.geometry.dispose();
      walls.geometry.dispose();
    },
    [tileMat, wallMat, sigilMat, beamMat, beamGeo, tiles, walls],
  );

  const markers = useMemo<Marker[]>(() => {
    const list: Marker[] = [
      { key: "exit", at: layout.exit, color: ink.arcane, size: 1.1, needsSeen: true },
      { key: "leave", at: layout.leave, color: ink.gold, size: 1.1, needsSeen: true },
      { key: "treasure", at: layout.treasure, color: ink.gold, size: 0.7, needsSeen: true },
    ];
    if (layout.boss) list.push({ key: "boss", at: layout.boss, color: "#ff5a48", size: 1.3, needsSeen: true });
    return list;
  }, [layout]);
  const markerMats = useMemo(() => markers.map((m) => makeMarkerMaterial(m.color)), [markers]);
  const youMat = useMemo(() => makeMarkerMaterial("#fff4dc"), []);
  useEffect(() => () => [...markerMats, youMat].forEach((m) => m.dispose()), [markerMats, youMat]);
  const markerRefs = useRef<(Mesh | null)[]>([]);
  const you = useRef<Mesh>(null);
  const youPin = useRef<Mesh>(null);
  const group = useRef<Group>(null);
  const inner = useRef<Group>(null);
  const label = useRef<Group>(null);
  const camera = useThree((s) => s.camera);

  // Index of every tile/wall instance, so a rebuild keeps birth times.
  const state = useRef({
    born: new Map<number, number>(),
    walls: new Map<number, number>(),
    version: -1,
    built: 0,
    castAt: uiNow(),
    goneAt: -1,
    /** The framing: scale and the world point at the map's centre. */
    frame: { s: 0, cx: 0, cz: 0 },
    shownFrame: { s: 0, cx: 0, cz: 0 },
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

  useFrame(() => {
    const st = state.current;
    const now = uiNow();
    const t = now - st.castAt;
    const g = group.current;
    if (!g) return;

    // Rebuild what's lit when more has been seen (at most twice a second).
    const v = exploredVersion();
    if (v !== st.version && now - st.built > 0.5) {
      st.version = v;
      st.built = now;
      rebuild(layout, st, tiles, walls, t < 0.6 ? st.castAt + 0.55 : now);
    }
    // Ease the framing toward what has been explored (snap on the cast).
    const fr = st.frame;
    const sf = st.shownFrame;
    const k = sf.s === 0 ? 1 : 1 - Math.exp(-Math.min(0.1, 1 / 60) * 4);
    sf.s += (fr.s - sf.s) * k;
    sf.cx += (fr.cx - sf.cx) * k;
    sf.cz += (fr.cz - sf.cz) * k;
    const scale = sf.s;
    const ig = inner.current;
    if (ig) {
      ig.scale.setScalar(scale);
      ig.position.set(-sf.cx * scale, MAP_Y, -sf.cz * scale);
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
    beamMat.uniforms.uAlpha!.value = alpha * 0.8;
    beamMat.uniforms.uTime!.value = now;

    // You, walking in the miniature (markers live in the miniature's world
    // units; their size is held constant on the map).
    const ya = you.current;
    const inv = 1 / Math.max(1e-4, scale);
    if (ya) {
      ya.position.set(playerPosition.x, (0.035 + Math.sin(now * 3) * 0.004) * inv, playerPosition.z);
      ya.scale.set(0.024 * inv, 0.04 * inv, 0.024 * inv);
      ya.rotation.y = now * 1.5;
      const ym = youMat;
      ym.uniforms.uTime!.value = now;
      ym.uniforms.uPulse!.value = 1;
      ym.uniforms.uAlpha!.value = Math.min(1, Math.max(0, (t - 0.7) / 0.2)) * alpha;
    }
    if (youPin.current && ya) {
      youPin.current.position.set(ya.position.x, 0.05 * inv, ya.position.z);
      youPin.current.scale.set(0.003 * inv, 0.1 * inv, 0.003 * inv);
    }
    // The places worth knowing, once seen.
    markers.forEach((mk, i) => {
      const m = markerRefs.current[i];
      if (!m) return;
      const tx = Math.floor(mk.at[0] / TILE + n / 2);
      const tz = Math.floor(mk.at[2] / TILE + n / 2);
      const seen = !mk.needsSeen || isExplored(layout, tx, tz);
      m.visible = seen;
      m.position.set(mk.at[0], (0.05 + Math.sin(now * 2 + i) * 0.006) * inv, mk.at[2]);
      m.scale.set(0.018 * mk.size * inv, 0.03 * mk.size * inv, 0.018 * mk.size * inv);
      m.rotation.y = now * 0.8 + i;
      const mm = markerMats[i]!;
      mm.uniforms.uTime!.value = now;
      mm.uniforms.uAlpha!.value = Math.min(1, Math.max(0, (t - 0.9 - i * 0.1) / 0.2)) * alpha;
    });
    // The title turns to face you.
    const l = label.current;
    if (l) l.rotation.y = Math.atan2(camera.position.x - (cast.at[0] + l.position.x), camera.position.z - (cast.at[2] + l.position.z));

    // Wander off and the spell lets go.
    if (shown) {
      tmpV.set(cast.at[0], playerPosition.y, cast.at[2]);
      if (tmpV.distanceTo(playerPosition) > LEAVE_DIST) useMapCast.getState().dismiss();
    }
  });

  const biome = getBiomeDef(layout.biome);
  const titlePx = pxFor(1.8, 0.02);
  return (
    <group ref={group} position={cast.at}>
      <mesh geometry={sigilQuad} material={sigilMat} scale={[0.9, 1, 0.9]} position={[0, 0.01, 0]} renderOrder={1} />
      <mesh geometry={beamGeo} material={beamMat} renderOrder={1} />
      {/* The miniature: the floor in world units, scaled and centred on
          what has been explored (positioned every frame). */}
      <group ref={inner} position={[0, MAP_Y, 0]} scale={0.001}>
        <primitive object={tiles} />
        <primitive object={walls} />
        {markers.map((mk, i) => (
          <mesh
            key={mk.key}
            ref={(m) => {
              markerRefs.current[i] = m;
            }}
            geometry={diamond}
            material={markerMats[i]}
          />
        ))}
        <mesh ref={you} geometry={diamond} material={youMat} />
        <mesh ref={youPin} geometry={unitBox} material={youMat} />
      </group>
      <group ref={label} position={[0, MAP_Y + 0.42, 0]}>
        <UiShow show={shown}>
          <RuneText text={`Floor ${layout.floor}`} font="heading" px={titlePx} color={ink.parchment} glow={0.8} outline={0.5} position={[0, titlePx * 7, 0]} delay={0.9} />
          <RuneText text={biome.name} font="label" px={titlePx * 0.5} color={ink.arcane} glow={0.6} outline={0.5} position={[0, -titlePx * 2, 0]} delay={1.1} />
        </UiShow>
      </group>
    </group>
  );
}

/** Light every explored floor tile and every wall bordering one. New ones
 * are born at `from` + a ripple outward from the wizard's tile. */
function rebuild(
  layout: FloorLayout,
  st: { born: Map<number, number>; walls: Map<number, number>; frame: { s: number; cx: number; cz: number } },
  tiles: InstancedMesh,
  walls: InstancedMesh,
  from: number,
) {
  const n = layout.size;
  const px = Math.floor(playerPosition.x / TILE + n / 2);
  const pz = Math.floor(playerPosition.z / TILE + n / 2);
  const tileBorn = tiles.geometry.getAttribute("aBorn") as InstancedBufferAttribute;
  const wallBorn = walls.geometry.getAttribute("aBorn") as InstancedBufferAttribute;
  const ripple = (x: number, z: number) => from + Math.hypot(x - px, z - pz) * 0.03;
  let ti = 0;
  let wi = 0;
  let minX = n;
  let maxX = -1;
  let minZ = n;
  let maxZ = -1;
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      const i = z * n + x;
      const wx = (x - n / 2 + 0.5) * TILE;
      const wz = (z - n / 2 + 0.5) * TILE;
      if (layout.tiles[i]) {
        if (!isExplored(layout, x, z)) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
        let born = st.born.get(i);
        if (born === undefined) st.born.set(i, (born = ripple(x, z)));
        tmpM.makeScale(TILE * 0.9, 1, TILE * 0.9).setPosition(wx, 0, wz);
        tiles.setMatrixAt(ti, tmpM);
        tileBorn.setX(ti, born);
        ti++;
      } else {
        // A wall the explored floor touches.
        const touches =
          isExplored(layout, x + 1, z) || isExplored(layout, x - 1, z) || isExplored(layout, x, z + 1) || isExplored(layout, x, z - 1);
        if (!touches) continue;
        let born = st.walls.get(i);
        if (born === undefined) st.walls.set(i, (born = ripple(x, z) + 0.08));
        tmpM.makeScale(TILE * 0.96, TILE * 0.6, TILE * 0.96).setPosition(wx, 0, wz);
        walls.setMatrixAt(wi, tmpM);
        wallBorn.setX(wi, born);
        wi++;
      }
    }
  tiles.count = ti;
  walls.count = wi;
  tiles.instanceMatrix.needsUpdate = true;
  walls.instanceMatrix.needsUpdate = true;
  tileBorn.needsUpdate = true;
  wallBorn.needsUpdate = true;
  // Frame the explored patch (plus a tile of wall round it).
  if (maxX >= 0) {
    const span = Math.max(maxX - minX + 3, maxZ - minZ + 3, MIN_TILES);
    st.frame.s = MAP_W / (span * TILE);
    st.frame.cx = ((minX + maxX + 1) / 2 - n / 2) * TILE;
    st.frame.cz = ((minZ + maxZ + 1) / 2 - n / 2) * TILE;
  }
}
