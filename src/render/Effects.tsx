import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { Effect } from "postprocessing";
import { useMemo } from "react";

/** The gritty-pixel post chain: bloom feeds the emissive magic/torches, then
 * a highlight roll-off, film grain and a heavy vignette. The pixelation
 * itself is free: the canvas renders at dpr 0.35 and the browser upscales it
 * with image-rendering: pixelated (see GameScene), so every lighting and
 * post pass pays ~1/8th the fragment cost of native resolution. */
export function Effects() {
  const rolloff = useMemo(() => new HighlightRolloffEffect(), []);
  return (
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur intensity={1.15} luminanceThreshold={0.55} luminanceSmoothing={0.2} />
      <primitive object={rolloff} dispose={null} />
      {/* Premultiplied grain lives in the lit image, not on top of it: the
          dark stays dark instead of sparkling with white static. */}
      <Noise premultiply opacity={0.32} />
      <Vignette eskil={false} offset={0.22} darkness={0.82} />
    </EffectComposer>
  );
}

/** Hue-preserving highlight roll-off.
 *
 * The composer switches the renderer's own tone mapping off, so without
 * this pass anything a torch or the staff light pushes past 1.0 — pale
 * stone, a pillar at arm's length, a wet wall — clips channel by channel
 * into a flat white or yellow blob with no texture left in it.
 *
 * Stock tone mappers fix that but also bleach bright colour toward white
 * (ACES, AgX, and Khronos Neutral's desaturation step), which would wash
 * out the portals and spells whose saturated glow is the game's signature.
 * So this is Khronos PBR Neutral's compression curve applied to the PEAK
 * channel and scaled back onto the colour: everything below 0.76 passes
 * untouched, brighter values ease toward 1.0, and a hue is never shifted.
 * It runs after bloom, which needs the unclipped HDR values. */
const ROLLOFF_FRAG = /* glsl */ `
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb, 0.0);
  float peak = max(c.r, max(c.g, c.b));
  const float start = 0.76;
  if (peak > start) {
    const float d = 1.0 - start;
    float rolled = 1.0 - d * d / (peak + d - start);
    c *= rolled / peak;
  }
  outputColor = vec4(c, inputColor.a);
}`;

class HighlightRolloffEffect extends Effect {
  constructor() {
    super("HighlightRolloffEffect", ROLLOFF_FRAG);
  }
}
