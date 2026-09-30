import "@fontsource/jacquard-12/400.css";
import "@fontsource/pixelify-sans/400.css";
import "@fontsource/silkscreen/400.css";
import "./styles.css";
import { FRAMES, frameImage, parchmentImage, stoneImage } from "./pixelArt";
import { cssVars } from "./theme";

/** One-time chrome setup: fonts (bundled by vite from @fontsource — no binary
 * assets in the repo), the stylesheet, theme tokens as CSS custom properties,
 * and the procedurally painted surfaces as `--wm-img-*` urls. */
let installed = false;

export function installTheme(): void {
  if (installed) return;
  installed = true;
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(cssVars)) root.setProperty(k, v);
  root.setProperty("--wm-img-stone", `url(${stoneImage()})`);
  root.setProperty("--wm-img-parchment", `url(${parchmentImage()})`);
  for (const [name, colors] of Object.entries(FRAMES)) {
    root.setProperty(`--wm-img-frame-${name}`, `url(${frameImage(colors)})`);
  }
}
