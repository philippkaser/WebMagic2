import {
  Bloom,
  EffectComposer,
  Noise,
  Vignette,
} from "@react-three/postprocessing";

/** The gritty-pixel post chain: bloom feeds the emissive magic/torches, plus
 * film grain and a heavy vignette. The pixelation itself is free: the canvas
 * renders at dpr 0.35 and the browser upscales it with
 * image-rendering: pixelated (see GameScene), so every lighting and post
 * pass pays ~1/8th the fragment cost of native resolution. */
export function Effects() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur intensity={1.15} luminanceThreshold={0.55} luminanceSmoothing={0.2} />
      <Noise opacity={0.055} />
      <Vignette eskil={false} offset={0.22} darkness={0.82} />
    </EffectComposer>
  );
}
