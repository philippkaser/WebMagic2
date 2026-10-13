import { type BufferGeometry, Euler, Matrix4, Quaternion, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { BiomeId, DecorSpawn, DoorwaySpawn, Vec3 } from "../../../world/types";
import { type DecorMat, type DecorPart, decorTemplate, doorLeafParts, portcullisParts } from "./decorShapes";

/** A floor's set dressing baked into world space: every piece's parts,
 * transformed and merged per material — so ALL the decor on a floor is at
 * most three draw calls (the atlas solid, the atlas cut-outs, the band's
 * stone), however many skulls the floor has. Plus where its little fires
 * burn and which of them light the room. No DOM: unit-testable. */

export interface DecorFire {
  pos: Vec3;
  /** Flame height (m). */
  scale: number;
  /** Candle or brazier — colour and flicker follow. */
  kind: "candle" | "brazier";
}

export interface DecorGlow {
  pos: Vec3;
  kind: "candle" | "brazier";
  /** Number of flames it stands for (a cluster of candles is one light). */
  flames: number;
}

export interface DecorBake {
  geometry: Record<DecorMat, BufferGeometry | null>;
  fires: DecorFire[];
  glows: DecorGlow[];
}

function matrixOf(d: DecorSpawn): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...d.pos),
    new Quaternion().setFromEuler(new Euler(0, d.yaw, 0)),
    new Vector3(d.scale, d.scale, d.scale),
  );
}

export function bakeDecor(dressing: readonly DecorSpawn[], doorways: readonly DoorwaySpawn[], biome: BiomeId): DecorBake {
  const lists: Record<DecorMat, BufferGeometry[]> = { solid: [], sheet: [], stone: [] };
  const fires: DecorFire[] = [];
  const glows: DecorGlow[] = [];
  const take = (parts: DecorPart[], m: Matrix4 | null, own: boolean) => {
    for (const p of parts) lists[p.mat].push(own ? p.geo : p.geo.clone().applyMatrix4(m!));
  };

  for (const d of dressing) {
    const t = decorTemplate(d.kind, d.variant, biome);
    const m = matrixOf(d);
    take(t.parts, m, false);
    if (t.flames.length === 0) continue;
    const kind = d.kind === "brazier" ? "brazier" : "candle";
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const f of t.flames) {
      const p = new Vector3(...f.pos).applyMatrix4(m);
      fires.push({ pos: [p.x, p.y, p.z], scale: f.scale * d.scale, kind });
      cx += p.x;
      cy += p.y;
      cz += p.z;
    }
    const n = t.flames.length;
    glows.push({ pos: [cx / n, cy / n + 0.25, cz / n], kind, flames: n });
  }

  for (const dw of doorways) {
    if (dw.style === "portcullis") take(portcullisParts(dw, biome), null, true);
    if (dw.style === "door") take(doorLeafParts(dw), null, true);
  }

  const merge = (geos: BufferGeometry[]): BufferGeometry | null => {
    if (geos.length === 0) return null;
    const merged = mergeGeometries(geos);
    for (const g of geos) g.dispose();
    merged.computeBoundingSphere();
    return merged;
  };
  return {
    geometry: { solid: merge(lists.solid), sheet: merge(lists.sheet), stone: merge(lists.stone) },
    fires,
    glows,
  };
}
