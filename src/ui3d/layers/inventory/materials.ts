import {
  AdditiveBlending,
  Color,
  ExtrudeGeometry,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  ShaderMaterial,
  Shape,
  type BufferGeometry,
} from "three";

/** Geometry and shaders for the inventory's physical pieces: carved socket
 * frames, the dark wells inside them, and the light that spills out of a
 * socket when it wants what you're holding.
 *
 * Geometry is shared per size (the altar has two socket sizes, the chest
 * one); shaders are per socket, because each socket kindles on its own —
 * three.js compiles the program once and only the uniforms differ. */

export const INK = {
  accent: "#46ffd0",
  gold: "#ffcf4d",
  runLoot: "#c8a23c",
  bright: "#e8dfc8",
  body: "#b9b0a0",
  dim: "#8f86a0",
  faint: "#5d5566",
  better: "#7fdc8a",
  worse: "#e06a6a",
  danger: "#ff6a5a",
} as const;

let unitPlane: PlaneGeometry | null = null;
export function plane(): PlaneGeometry {
  return (unitPlane ??= new PlaneGeometry(1, 1));
}

const frames = new Map<string, BufferGeometry>();

/** A rectangular frame of dressed stone around a `w`×`h` opening: an
 * extruded ring with a bevel, so its edges catch the torchlight and the
 * opening reads as a hole cut into the tablet. Its back sits on the face
 * (z = 0), it stands `depth` proud of it. */
export function frameGeometry(w: number, h: number, rim: number, depth = 0.014): BufferGeometry {
  const key = `${w.toFixed(3)}:${h.toFixed(3)}:${rim.toFixed(3)}:${depth.toFixed(3)}`;
  let g = frames.get(key);
  if (g) return g;
  const bevel = Math.min(0.006, rim * 0.35);
  const ox = w / 2 + rim - bevel;
  const oy = h / 2 + rim - bevel;
  const ix = w / 2 + bevel;
  const iy = h / 2 + bevel;
  const shape = new Shape();
  shape.moveTo(-ox, -oy);
  shape.lineTo(ox, -oy);
  shape.lineTo(ox, oy);
  shape.lineTo(-ox, oy);
  shape.lineTo(-ox, -oy);
  const hole = new Path();
  hole.moveTo(-ix, -iy);
  hole.lineTo(-ix, iy);
  hole.lineTo(ix, iy);
  hole.lineTo(ix, -iy);
  hole.lineTo(-ix, -iy);
  shape.holes.push(hole);
  g = new ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 1,
  });
  g.translate(0, 0, bevel);
  frames.set(key, g);
  return g;
}

const archFrames = new Map<string, BufferGeometry>();

/** The wizard's niche: a round-topped arch ring (outer arch minus inner). */
export function archFrameGeometry(width: number, bottom: number, top: number, rim: number): BufferGeometry {
  const key = `${width}:${bottom}:${top}:${rim}`;
  let g = archFrames.get(key);
  if (g) return g;
  const arch = (path: Shape | Path, w: number, b: number, t: number, reverse: boolean) => {
    const r = w / 2;
    const springY = t - r;
    if (!reverse) {
      path.moveTo(-r, b);
      path.lineTo(r, b);
      path.lineTo(r, springY);
      path.absarc(0, springY, r, 0, Math.PI, false);
      path.lineTo(-r, b);
    } else {
      path.moveTo(-r, b);
      path.lineTo(-r, springY);
      path.absarc(0, springY, r, Math.PI, 0, true);
      path.lineTo(r, b);
      path.lineTo(-r, b);
    }
  };
  const shape = new Shape();
  arch(shape, width + rim * 2, bottom - rim, top + rim, false);
  const hole = new Path();
  arch(hole, width, bottom, top, true);
  shape.holes.push(hole);
  g = new ExtrudeGeometry(shape, {
    depth: 0.006,
    bevelEnabled: true,
    bevelThickness: 0.005,
    bevelSize: 0.005,
    bevelSegments: 1,
    curveSegments: 20,
  });
  g.translate(0, 0, 0.005);
  archFrames.set(key, g);
  return g;
}

/** The niche's opening (same outline as the frame's hole), for its shader. */
export function archGeometry(width: number, bottom: number, top: number): BufferGeometry {
  const key = `open:${width}:${bottom}:${top}`;
  let g = archFrames.get(key);
  if (g) return g;
  const r = width / 2;
  const springY = top - r;
  const shape = new Shape();
  shape.moveTo(-r, bottom);
  shape.lineTo(r, bottom);
  shape.lineTo(r, springY);
  shape.absarc(0, springY, r, 0, Math.PI, false);
  shape.lineTo(-r, bottom);
  g = new ExtrudeGeometry(shape, { depth: 0.001, bevelEnabled: false, curveSegments: 24 });
  // Planar UVs over the arch's bounding box, so the shader can place light.
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  for (let k = 0; k < pos.count; k++) {
    uv.setXY(k, (pos.getX(k) + r) / width, (pos.getY(k) - bottom) / (top - bottom));
  }
  archFrames.set(key, g);
  return g;
}

// ── The well: the dark inside of a socket ────────────────────────────────────

const WELL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const WELL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uSeam;
uniform float uPool;
uniform vec3 uFloor;
varying vec2 vUv;
void main() {
  vec2 c = vUv - 0.5;
  float edge = max(abs(c.x), abs(c.y)) * 2.0;
  // Depth without depth: the walls darken toward the lip, the floor keeps a
  // little of the torch that grazes in from the upper left.
  vec3 col = mix(uFloor, uFloor * 0.25, smoothstep(0.35, 0.95, edge));
  col += uFloor * 0.8 * clamp(0.4 - c.x + c.y, 0.0, 1.0) * (1.0 - edge);
  // The seam: a thin line of light just inside the frame's lip.
  float seam = smoothstep(0.8, 0.94, edge);
  // Light pooling on the floor when the socket is kindled.
  float pool = exp(-dot(c, c) * 7.0);
  col += uColor * (seam * uSeam + pool * uPool);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export type WellMaterial = ShaderMaterial & {
  uniforms: { uColor: { value: Color }; uSeam: { value: number }; uPool: { value: number }; uFloor: { value: Color } };
};

export function wellMaterial(color: string, floor = "#0c0a10"): WellMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(color) },
      uSeam: { value: 0 },
      uPool: { value: 0 },
      uFloor: { value: new Color(floor) },
    },
    vertexShader: WELL_VERT,
    fragmentShader: WELL_FRAG,
  }) as WellMaterial;
}

// ── Spill: light a kindled socket throws onto the stone around it ────────────

const SPILL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uInner;
varying vec2 vUv;
void main() {
  vec2 c = (vUv - 0.5) * 2.0;
  // A soft rounded square from the frame's outer edge (uInner, in these
  // -1..1 units) fading out over the stone. It lies just behind the frame,
  // which hides whatever falls under it: the light only ever lands on the
  // stone around the socket.
  float d = length(max(abs(c) - uInner, 0.0)) / (1.0 - uInner);
  float a = pow(max(0.0, 1.0 - d), 2.2) * uIntensity;
  gl_FragColor = vec4(uColor * a, 0.0);
  #include <colorspace_fragment>
  gl_FragColor.a = 0.0;
}
`;

export type SpillMaterial = ShaderMaterial & {
  uniforms: { uColor: { value: Color }; uIntensity: { value: number }; uInner: { value: number } };
};

/** Additive and alpha-0 (see UiSparks): on the transparent UI canvas it may
 * only ADD light, never cover what's beneath. */
export function spillMaterial(color: string, inner = 0.55): SpillMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uIntensity: { value: 0 }, uInner: { value: inner } },
    vertexShader: WELL_VERT,
    fragmentShader: SPILL_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    premultipliedAlpha: true,
  }) as SpillMaterial;
}

// ── Solid pieces ─────────────────────────────────────────────────────────────

const solids = new Map<string, MeshStandardMaterial>();
function solid(key: string, make: () => MeshStandardMaterial): MeshStandardMaterial {
  let m = solids.get(key);
  if (!m) {
    m = make();
    solids.set(key, m);
  }
  return m;
}

/** Bronze that still reads without an environment map: the UI canvas has
 * only point lights, so a fully metallic surface would go black between
 * highlights. Mostly diffuse, a warm self-glow in the shadows. */
export function bronze(): MeshStandardMaterial {
  return solid("bronze", () => new MeshStandardMaterial({ color: "#9a7a45", metalness: 0.45, roughness: 0.42, emissive: "#2a1c08", emissiveIntensity: 0.6 }));
}

export function coinGold(): MeshStandardMaterial {
  return solid("coin", () => new MeshStandardMaterial({ color: "#f0c25a", metalness: 0.55, roughness: 0.3, emissive: "#7a5210", emissiveIntensity: 0.55 }));
}

export function slate(): MeshStandardMaterial {
  return solid("slate", () => new MeshStandardMaterial({ color: "#1b1820", roughness: 0.85, metalness: 0.05 }));
}
