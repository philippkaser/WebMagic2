import {
  Bloom,
  EffectComposer,
  Noise,
  Pixelation,
  Vignette,
} from "@react-three/postprocessing";

/** The gritty-pixel post chain: bloom feeds the emissive magic/torches, then
 * everything is quantized by the pixelation pass, finished with film grain
 * and a heavy vignette. */
export function Effects() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur intensity={1.15} luminanceThreshold={0.55} luminanceSmoothing={0.2} />
      <Pixelation granularity={3.4} />
      <Noise opacity={0.055} />
      <Vignette eskil={false} offset={0.22} darkness={0.82} />
    </EffectComposer>
  );
}
