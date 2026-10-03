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
//   orbit         noise circling your head at 3 m (direction cues)
//   distance      clicks ahead at 1, 2, 4, 8, 16 m (distance cues)
//   flyby         a 440 Hz tone passing at 8 m/s (Doppler)
//   size          a rift-sized noise at 8, 4, 2, 1 m (a point far, all round close)
//   leave-tone    a tone in the hall as you walk out (no warble round the door)
//   spin          a tone ahead while you whip round (no clicks as the ears swing)
//   stress        every voice busy (how hard the audio thread works)
//   bank-<group>  every sound of a group one after another (bank.ts: combat,
//                 creatures, steps, world, events, travel, ui, menus,
//                 ambient); "bank" plays them all. Logs each one's start.
// With none named, renders them all. Add ":speakers" to a scene's name to
// render it for speakers rather than headphones (e.g. orbit:speakers).
//
// Env: AUDIO_LAB_URL (default http://localhost:3000/scripts/audio-lab/index.html),
// AUDIO_LAB_OUT (default ./audio-lab-output), CHROMIUM_PATH (optional).
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const URL = process.env.AUDIO_LAB_URL ?? "http://localhost:3000/scripts/audio-lab/index.html";
const OUT = process.env.AUDIO_LAB_OUT ?? "audio-lab-output";
const ALL = ["walk", "torch-walk", "leave-steady", "leave-torches", "steps-room", "imp-room", "imp-corridor", "imp-dry", "orbit", "distance", "flyby", "size", "leave-tone", "spin", "stress"];
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
  const wavBytes = Buffer.from(b64, "base64");
  writeFileSync(`${OUT}/${s.replace(":", "-")}.wav`, wavBytes);
  // Rendering offline as fast as it can: the share of real time it took is
  // roughly how busy the audio thread would be playing it live.
  const secs = (wavBytes.length - 44) / 8 / 48000;
  const took = (Date.now() - t0) / 1000;
  console.log(`${OUT}/${s.replace(":", "-")}.wav (${took.toFixed(1)}s for ${secs.toFixed(1)}s of audio: ${((took / secs) * 100).toFixed(0)}% of real time)`);
  await page.close();
}
await browser.close();
