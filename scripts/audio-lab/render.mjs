// The audio lab's runner: renders scenes through the real audio code in
// headless Chromium (OfflineAudioContext, faster than real time) and writes
// them as 32-bit float stereo WAVs — to listen to, or to measure.
//
//   bunx vite --port 3000 &
//   bun run audio-lab [scene…]            (runs under node)
//
// Scenes (scripts/audio-lab/scene.ts, on a generated catacombs floor):
//   walk          stand in a torch-lit hall, cast, walk out down a corridor
//                 while a fireball goes off and a slime walks behind you
//   torch-walk    the same walk with only the torches
//   leave-steady  a steady noise in the hall while you walk out (logs what
//                 the ears hear: voices, the room you're in, rooms' tails)
//   leave-torches the same with the torches
//   steps-room    your own footsteps in the hall
//   imp-room      impulses: yours, one 5 m off, one at a torch 11 m off
//   imp-corridor  impulses: yours in the corridor, one back in the hall
//   imp-dry       a bare impulse on the master bus (the reference)
// With none named, renders them all.
//
// Env: AUDIO_LAB_URL (default http://localhost:3000/scripts/audio-lab/index.html),
// AUDIO_LAB_OUT (default ./audio-lab-output), CHROMIUM_PATH (optional).
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const URL = process.env.AUDIO_LAB_URL ?? "http://localhost:3000/scripts/audio-lab/index.html";
const OUT = process.env.AUDIO_LAB_OUT ?? "audio-lab-output";
const ALL = ["walk", "torch-walk", "leave-steady", "leave-torches", "steps-room", "imp-room", "imp-corridor", "imp-dry"];
const scenes = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
// A fresh page per scene: the audio modules hold one context each.
for (const s of scenes) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", String(e)));
  page.on("console", (m) => m.text().startsWith("[lab]") && console.log(m.text()));
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__lab, null, { timeout: 60000 });
  const t0 = Date.now();
  const b64 = await page.evaluate((s) => window.__lab.render(s), s);
  writeFileSync(`${OUT}/${s}.wav`, Buffer.from(b64, "base64"));
  console.log(`${OUT}/${s}.wav (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  await page.close();
}
await browser.close();
