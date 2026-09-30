import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
} from "three";
import { bake, glow, group, instance, part, std } from "./kit";
import { getFxTexture } from "./modelTextures";

/** A torch: an iron basket of coals on a wooden haft, with a hand-painted
 * flame card that flickers through four frames, sways and always faces the
 * camera. Wall-mounted torches get an iron bracket reaching back to the
 * wall (local -Z); free-standing ones (on a post) sit bare. Origin is the
 * coals — where the light source hangs. */

const FLAME_FRAMES = 4;
const flameGeo = new PlaneGeometry(0.46, 0.8);
flameGeo.translate(0, 0.33, 0); // pivot at the base so flicker scales upward
const coalGeo = new IcosahedronGeometry(0.06, 0);
const tmp = new Vector3();

function sconce(wall: boolean): Group {
  const iron = std("#2c2a30", { tex: "iron", metalness: 0.7, roughness: 0.45 });
  const wood = std("#4a321e", { tex: "bark", roughness: 0.9 });
  const parts = [
    // Basket: a flared cup with four prongs cradling the coals.
    part(new CylinderGeometry(0.1, 0.06, 0.1, 6, 1, true), iron, [0, -0.04, 0]),
    part(new CylinderGeometry(0.105, 0.105, 0.02, 6, 1, true), iron, [0, 0.01, 0]),
    ...[0, 1, 2, 3].map((i) =>
      group([part(new BoxGeometry(0.018, 0.14, 0.018), iron, [0, 0.05, 0.1], [-0.35, 0, 0])], [0, 0, 0], [0, (i / 4) * Math.PI * 2 + 0.4, 0]),
    ),
    // Haft
    part(new CylinderGeometry(0.035, 0.028, 0.42, 6), wood, [0, -0.3, 0]),
    part(new CylinderGeometry(0.04, 0.04, 0.04, 6), iron, [0, -0.13, 0]),
  ];
  if (wall) {
    parts.push(
      // Bracket arm back to the wall, and the wall plate it's bolted to.
      part(new BoxGeometry(0.04, 0.04, 0.3), iron, [0, -0.3, -0.15]),
      part(new BoxGeometry(0.03, 0.2, 0.03), iron, [0, -0.2, -0.26], [0.6, 0, 0]),
      part(new CylinderGeometry(0.05, 0.05, 0.05, 6, 1, true), iron, [0, -0.3, 0]),
      part(new BoxGeometry(0.14, 0.3, 0.03), iron, [0, -0.28, -0.3]),
    );
  }
  return bake(group(parts));
}

const templates: Record<"wall" | "free", Group | null> = { wall: null, free: null };

/** `wallYaw`: Y rotation that points the bracket (local -Z) at the wall it
 * hangs on, or null for a free-standing torch. The flame is never rotated
 * with it — it billboards in world space. */
export function TorchModel({ wallYaw, seed, color = "#ff9a4d" }: { wallYaw: number | null; seed: number; color?: string }) {
  const wall = wallYaw !== null;
  const flame = useRef<Mesh>(null);
  const body = useMemo(() => {
    const key = wall ? "wall" : "free";
    return instance((templates[key] ??= sconce(wall)));
  }, [wall]);
  // Each torch animates its own frame offset; the clone shares the canvas
  // with every other torch, so it's one GPU upload for the whole floor.
  const flameMat = useMemo(() => {
    const map = getFxTexture("flame").clone();
    map.repeat.set(1 / FLAME_FRAMES, 1);
    return new MeshBasicMaterial({
      map,
      // Tint the painted flame toward the light color; white keeps the core hot.
      color: new Color(color).lerp(new Color("#ffffff"), 0.45),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    });
  }, [color]);
  useEffect(() => () => {
    flameMat.map?.dispose();
    flameMat.dispose();
  }, [flameMat]);

  const clock = useRef(0);
  const frame = useRef(seed % FLAME_FRAMES);

  useFrame(({ camera, clock: c }, dt) => {
    const f = flame.current;
    if (!f) return;
    const t = c.elapsedTime + seed;
    clock.current -= dt;
    if (clock.current <= 0) {
      clock.current = 0.07 + Math.random() * 0.06;
      frame.current = (frame.current + 1 + ((Math.random() * 2) | 0)) % FLAME_FRAMES;
      flameMat.map!.offset.x = frame.current / FLAME_FRAMES;
    }
    f.getWorldPosition(tmp);
    f.rotation.y = Math.atan2(camera.position.x - tmp.x, camera.position.z - tmp.z);
    const flick = 1 + Math.sin(t * 17) * 0.06 + Math.sin(t * 7.3) * 0.08;
    f.scale.set(1 + Math.sin(t * 11) * 0.05, flick, 1);
  });

  return (
    <group>
      <primitive object={body} rotation-y={wallYaw ?? 0} />
      <mesh geometry={coalGeo} material={glow(color, 4)} />
      <mesh ref={flame} geometry={flameGeo} material={flameMat} position={[0, 0.02, 0]} />
    </group>
  );
}
