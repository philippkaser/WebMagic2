import { useMemo, type Ref } from "react";
import { BoxGeometry, Group, MeshStandardMaterial, OctahedronGeometry, PlaneGeometry } from "three";
import { getModelTextures } from "./modelPaint";
import { bake, glow, group, part, roughen, std, templateCache } from "./modelKit";
import { shared } from "./shared";

/** The dev-room monolith, cut like the artpass waystone: a basalt slab that
 * narrows to a sheared, broken top, on a stepped plinth, rune columns carved
 * down both flanks and a glowing rune face — "interactive / magical" at a
 * glance. Origin = ground at its centre, face toward +Z.
 * world/devProps.tsx (DevSlab) owns the light and the prompt, pulses the
 * face through `faceRef` and spins the mote's pivot group (resting at
 * y = 2) through `moteRef`. Dev builds only. */

function runeStone(color: string, intensity: number) {
  return std("#4a4658", {
    tex: "runestone",
    roughness: 0.85,
    emissive: color,
    emissiveIntensity: intensity,
    emissiveMap: getModelTextures("glyphs").map,
  });
}

function slabTemplate(color: string): Group {
  const stone = std("#4a4658", { tex: "runestone", roughness: 0.9 });
  const runes = runeStone(color, 0.9);
  // A slab that narrows toward a sheared top, with chipped edges.
  const slab = new BoxGeometry(1.4, 2.4, 0.4, 3, 6, 1);
  const pos = slab.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = (y + 1.2) / 2.4;
    pos.setX(i, pos.getX(i) * (1 - t * 0.18));
    // Sheared top: one corner broken lower than the other.
    if (t > 0.99) pos.setY(i, y - (pos.getX(i) > 0 ? 0.22 : 0));
  }
  roughen(slab, 0.03, 7);
  return bake(
    group([
      part(roughen(new BoxGeometry(1.9, 0.3, 1.3, 3, 1, 2), 0.03, 4), stone, [0, 0.15, 0]),
      part(roughen(new BoxGeometry(1.5, 0.16, 0.9, 2, 1, 2), 0.02, 5), stone, [0, 0.38, 0]),
      part(slab, stone, [0, 1.6, 0]),
      // Rune columns carved down both flanks.
      part(new BoxGeometry(0.02, 1.7, 0.22), runes, [-0.63, 1.45, 0]),
      part(new BoxGeometry(0.02, 1.7, 0.22), runes, [0.63, 1.45, 0]),
      part(new BoxGeometry(0.9, 0.14, 0.02), runes, [0, 0.62, 0.205]),
    ]),
  );
}

const slabs = templateCache<string>(slabTemplate);
const faceGeo = shared(() => new PlaneGeometry(0.84, 1.2));
const moteGeo = shared(() => new OctahedronGeometry(0.14));

export function DevSlabModel({
  color,
  faceRef,
  moteRef,
}: {
  color: string;
  faceRef?: Ref<MeshStandardMaterial>;
  moteRef?: Ref<Group>;
}) {
  const body = useMemo(() => slabs(color), [color]);
  const glyphs = getModelTextures("glyphs").map;
  return (
    <group>
      <primitive object={body} />
      {/* Glowing rune face: the glyph map is the emissive mask. */}
      <mesh geometry={faceGeo()} position={[0, 1.55, 0.215]}>
        <meshStandardMaterial
          ref={faceRef}
          color="#0c0a12"
          map={glyphs}
          emissive={color}
          emissiveMap={glyphs}
          emissiveIntensity={1.8}
          toneMapped={false}
        />
      </mesh>
      {/* Orbiting mote */}
      <group ref={moteRef} position={[0, 2, 0]}>
        <mesh geometry={moteGeo()} material={glow(color, 3)} position={[0.9, 0, 0]} />
      </group>
    </group>
  );
}
