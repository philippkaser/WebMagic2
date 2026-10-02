import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BoxGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
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
import { estimatePeer, peerIds } from "../../../net/players";
import { useGame } from "../../../state/gameStore";
import { exploredVersion, getCurrentLayout, isExplored, markExplored, useCurrentLayout } from "../../../world/currentFloor";
import type { FloorLayout } from "../../../world/types";
import { uiNow } from "../../clock";
import { ink } from "../../theme";
import { FOLD_PER_M, makeMarkerMaterial, makeShadeMaterial, makeSigilMaterial, makeTileMaterial, makeWallMaterial } from "./mapMaterials";
import { dungeonModel, villageModel, type MapMarker, type MapModel } from "./mapModel";
import { SELF, useMapCast, type MapCast } from "./mapStore";
import { useStagedCasts } from "./useStagedCasts";

/** The cast map's light, lying on the floor (WORLD canvas — walls and
 * wizards stand in front of it, and it blooms with the world).
 *
 * A rune circle burns onto the floor, the floor under it dims, and inside
 * the circle the miniature unfolds: the explored floor ripples out from
 * where the caster stood, the walls (or the cottages and standing stones)
 * rise as ribs of light, and markers kindle above it — every wizard on the
 * floor (you in cream, the others in green), the way onward, the way home,
 * the treasure and the Warden once seen. It is true to the world (north is
 * north), so walk around it to read it from any side; walk over it if you
 * like. Walk far off and it lets go; M again folds it — the light drains
 * back in from the edge toward the caster, the walls sinking into the
 * floor, and the rune circle un-draws itself. No words hang over it: the
 * floor's name and mood are the HUD's (top right). */

/** Walk this far from a map and it lets go, m. */
const LEAVE_DIST = 14;
const COLOR = ink.arcane;
/** Floor-mates on the map (more never share a floor). */
const PEER_SLOTS = 3;

export function FloorMaps() {
  const layout = useCurrentLayout();
  const phase = useGame((s) => s.phase);
  // Any change of place — a journey, a new floor, death — ends every spell.
  useEffect(() => {
    useMapCast.getState().clear();
  }, [phase, layout]);
  const { entries, drop } = useStagedCasts();
  return (
    <>
      <ExploreTracker />
      {entries.map((e) =>
        e.cast.kind === "village" || layout ? (
          <FloorMap key={e.cast.id} cast={e.cast} layout={e.cast.kind === "village" ? null : layout} shown={e.shown} onGone={() => drop(e.cast.id)} />
        ) : null,
      )}
    </>
  );
}

/** Marks the tiles around the wizard as seen, a few times a second — cast
 * or not (world/currentFloor.ts). */
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
const flatQuad = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const diamond = new OctahedronGeometry(1, 0);
const tmpM = new Matrix4();
const tmpP = new Vector3();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const UP = new Vector3(0, 1, 0);

function instanced(geometry: BoxGeometry | PlaneGeometry, material: ShaderMaterial, capacity: number, bright: boolean): InstancedMesh {
  const m = new InstancedMesh(geometry.clone(), material, Math.max(1, capacity));
  m.geometry.setAttribute("aBorn", new InstancedBufferAttribute(new Float32Array(Math.max(1, capacity)).fill(1e9), 1));
  m.geometry.setAttribute("aDist", new InstancedBufferAttribute(new Float32Array(Math.max(1, capacity)), 1));
  if (bright) m.geometry.setAttribute("aBright", new InstancedBufferAttribute(new Float32Array(Math.max(1, capacity)).fill(1), 1));
  m.count = 0;
  m.frustumCulled = false;
  return m;
}

function FloorMap({ cast, layout, shown, onGone }: { cast: MapCast; layout: FloorLayout | null; shown: boolean; onGone: () => void }) {
  const village = !layout;
  const W = cast.width;
  const fixed = useMemo(() => (village ? villageModel() : null), [village]);
  const capacity = village ? { floor: fixed!.floor.length, raised: fixed!.raised.length } : { floor: layout!.size ** 2, raised: layout!.size ** 2 };

  const mats = useMemo(
    () => ({
      tile: makeTileMaterial(COLOR),
      wall: makeWallMaterial(COLOR),
      sigil: makeSigilMaterial(COLOR),
      shade: makeShadeMaterial(),
      you: makeMarkerMaterial("#fff4dc"),
      peer: makeMarkerMaterial(ink.ally),
    }),
    [],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tiles = useMemo(() => instanced(unitTile, mats.tile, capacity.floor, true), [mats, capacity.floor]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const walls = useMemo(() => instanced(unitBox, mats.wall, capacity.raised, false), [mats, capacity.raised]);
  useEffect(
    () => () => {
      for (const m of Object.values(mats)) m.dispose();
      tiles.geometry.dispose();
      walls.geometry.dispose();
    },
    [mats, tiles, walls],
  );

  const [markers, setMarkersState] = useState<MapMarker[]>([]);
  // Re-render only when the set of markers changes (a new one seen).
  const setMarkers = (m: MapMarker[]) =>
    setMarkersState((prev) => (prev.length === m.length && prev.every((x, i) => x.key === m[i]!.key) ? prev : m));
  const inner = useRef<Group>(null);
  const you = useRef<Mesh>(null);
  const peerRefs = useRef<(Mesh | null)[]>([]);
  const markerRefs = useRef<(Mesh | null)[]>([]);

  const state = useRef({
    born: new Map<number, number>(),
    version: -1,
    built: -10,
    castAt: uiNow(),
    goneAt: -1,
    /** Farthest piece from where the reveal began, m (the fold starts there). */
    distMax: 0,
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
      // The reveal ripples out from the caster: you, or (a floor-mate's map)
      // the middle of what they've seen.
      const origin: [number, number] | null = cast.owner === SELF ? [playerPosition.x, playerPosition.z] : null;
      fill(model, st, tiles, walls, t < 0.6 ? st.castAt + 0.45 : now, W, origin);
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
      ig.position.set(-sf.cx * scale, 0.012, -sf.cz * scale);
    }

    // Folding: the light drains in from the edge (the shaders, per piece),
    // the markers go out first, and once the middle is dark the rune circle
    // un-draws itself the way it was drawn.
    const foldTime = st.distMax * FOLD_PER_M + 0.3;
    const folding = st.goneAt > 0;
    const fold = folding ? Math.min(1, (now - st.goneAt) / foldTime) : 0;
    const unwind = folding ? Math.min(1, Math.max(0, (now - st.goneAt - foldTime * 0.6) / 0.5)) : 0;
    if (folding && unwind >= 1) {
      onGone();
      return;
    }
    const alpha = folding ? Math.max(0, 1 - (now - st.goneAt) / 0.15) : 1;
    for (const m of [mats.tile, mats.wall]) {
      m.uniforms.uTime!.value = now;
      m.uniforms.uFoldAt!.value = folding ? st.goneAt : 1e9;
      m.uniforms.uDistMax!.value = st.distMax;
    }
    mats.sigil.uniforms.uIgnite!.value = Math.min(1, t / 0.45) * (1 - unwind);
    mats.sigil.uniforms.uAlpha!.value = 1;
    mats.sigil.uniforms.uTime!.value = now;
    mats.shade.uniforms.uAlpha!.value = Math.min(1, t / 0.4) * (1 - fold);

    // Markers keep their size in metres whatever the map's scale.
    const inv = 1 / scale;
    const appear = (delay: number) => Math.min(1, Math.max(0, (t - delay) / 0.2)) * alpha;
    const wizard = (m: Mesh | null, x: number, z: number, phase: number) => {
      if (!m) return;
      m.position.set(x, (0.16 + Math.sin(now * 3 + phase) * 0.012) * inv, z);
      m.scale.set(0.06 * inv, 0.1 * inv, 0.06 * inv);
      m.rotation.y = now * 1.5 + phase;
    };
    wizard(you.current, playerPosition.x, playerPosition.z, 0);
    mats.you.uniforms.uTime!.value = now;
    mats.you.uniforms.uPulse!.value = 1;
    mats.you.uniforms.uAlpha!.value = appear(0.6);
    const ids = village ? [] : peerIds();
    for (let i = 0; i < PEER_SLOTS; i++) {
      const m = peerRefs.current[i];
      if (!m) continue;
      const pose = i < ids.length ? estimatePeer(ids[i]!) : null;
      m.visible = !!pose;
      if (pose) wizard(m, pose.p[0], pose.p[2], i + 1);
    }
    mats.peer.uniforms.uTime!.value = now;
    mats.peer.uniforms.uPulse!.value = 0.6;
    mats.peer.uniforms.uAlpha!.value = appear(0.7);
    markers.forEach((mk, i) => {
      const m = markerRefs.current[i];
      if (!m) return;
      m.position.set(mk.at[0], (0.12 + Math.sin(now * 2 + i) * 0.01) * inv, mk.at[2]);
      m.scale.set(0.05 * mk.size * inv, 0.08 * mk.size * inv, 0.05 * mk.size * inv);
      m.rotation.y = now * 0.8 + i;
      const mm = m.material as ShaderMaterial;
      mm.uniforms.uTime!.value = now;
      mm.uniforms.uAlpha!.value = appear(0.75 + i * 0.08);
    });
    // Wander far off and the spell lets go (yours folds for everyone; a
    // floor-mate's only leaves your sight).
    if (shown && Math.hypot(cast.at[0] - playerPosition.x, cast.at[2] - playerPosition.z) > LEAVE_DIST) {
      useMapCast.getState().dismiss(cast.owner);
    }
  });

  return (
    <group position={cast.at}>
      <mesh geometry={flatQuad} material={mats.shade} scale={[W * 1.35, 1, W * 1.35]} position={[0, 0.006, 0]} renderOrder={1} />
      <mesh geometry={flatQuad} material={mats.sigil} scale={[W * 1.4, 1, W * 1.4]} position={[0, 0.009, 0]} renderOrder={2} />
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
        <mesh ref={you} geometry={diamond} material={mats.you} />
        {Array.from({ length: PEER_SLOTS }, (_, i) => (
          <mesh
            key={i}
            ref={(m) => {
              peerRefs.current[i] = m;
            }}
            geometry={diamond}
            material={mats.peer}
            visible={false}
          />
        ))}
      </group>
    </group>
  );
}

function MarkerMesh({ color, meshRef }: { color: string; meshRef: (m: Mesh | null) => void }) {
  const mat = useMemo(() => makeMarkerMaterial(color), [color]);
  useEffect(() => () => mat.dispose(), [mat]);
  return <mesh ref={meshRef} geometry={diamond} material={mat} />;
}

/** Lay the model's pieces into the instanced meshes; new pieces are born
 * on a ripple out from where the map was cast. */
function fill(
  model: MapModel,
  st: { born: Map<number, number>; distMax: number; frame: { s: number; cx: number; cz: number } },
  tiles: InstancedMesh,
  walls: InstancedMesh,
  from: number,
  width: number,
  origin: [number, number] | null,
) {
  const b0 = model.bounds;
  const [ox, oz] = origin ?? (b0 ? [(b0.minX + b0.maxX) / 2, (b0.minZ + b0.maxZ) / 2] : [0, 0]);
  const dist = (x: number, z: number) => Math.hypot(x - ox, z - oz);
  const ripple = (x: number, z: number) => from + dist(x, z) * 0.012;
  const tileBorn = tiles.geometry.getAttribute("aBorn") as InstancedBufferAttribute;
  const tileBright = tiles.geometry.getAttribute("aBright") as InstancedBufferAttribute;
  const tileDist = tiles.geometry.getAttribute("aDist") as InstancedBufferAttribute;
  const wallBorn = walls.geometry.getAttribute("aBorn") as InstancedBufferAttribute;
  const wallDist = walls.geometry.getAttribute("aDist") as InstancedBufferAttribute;
  let far = 0;
  let i = 0;
  for (const p of model.floor) {
    if (i >= tiles.instanceMatrix.count) break;
    let born = st.born.get(p.key);
    if (born === undefined) st.born.set(p.key, (born = ripple(p.x, p.z)));
    tmpM.compose(tmpP.set(p.x, 0, p.z), tmpQ.identity(), tmpS.set(p.sx, 1, p.sz));
    tiles.setMatrixAt(i, tmpM);
    tileBorn.setX(i, born);
    tileBright.setX(i, p.bright);
    const d = dist(p.x, p.z);
    tileDist.setX(i, d);
    far = Math.max(far, d);
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
    const d = dist(p.x, p.z);
    wallDist.setX(w, d);
    far = Math.max(far, d);
    w++;
  }
  walls.count = w;
  tiles.instanceMatrix.needsUpdate = true;
  walls.instanceMatrix.needsUpdate = true;
  tileBorn.needsUpdate = true;
  tileBright.needsUpdate = true;
  tileDist.needsUpdate = true;
  wallBorn.needsUpdate = true;
  wallDist.needsUpdate = true;
  st.distMax = far;
  if (model.bounds) {
    const b = model.bounds;
    st.frame.s = width / Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    st.frame.cx = (b.minX + b.maxX) / 2;
    st.frame.cz = (b.minZ + b.maxZ) / 2;
  }
}

