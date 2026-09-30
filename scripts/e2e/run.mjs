/** End-to-end run loop: loot is at risk until you survive five floors and
 * take the homeward rift; dying forfeits it.
 *
 *   bunx vite --port 3000 &          # server optional (offline works too)
 *   bun scripts/e2e/run.mjs [screenshotDir]
 */
import { chromium } from "playwright-core";

const URL = process.env.WEBMAGIC_URL ?? "http://localhost:3000";
const OUT = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const ok = (msg) => console.log(`✓ ${msg}`);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on("pageerror", (e) => console.log(`page error: ${e.message}`));
await page.goto(URL);
await sleep(2000);
await page.evaluate(() => localStorage.clear());
await page.reload();
await sleep(2500);
const g = (fn, arg) => page.evaluate(fn, arg);

await g(() => window.__game.getState().startGame());
await sleep(2500);
await g(() => void window.__game.getState().enterDungeon());
await sleep(5000);
let s = await g(() => ({ phase: window.__game.getState().phase, floor: window.__game.getState().floor }));
if (s.phase !== "dungeon" || s.floor > 3) fail(`fresh wizard should land on floor 1-3 (${JSON.stringify(s)})`);
ok(`the rift threw a fresh wizard to floor ${s.floor}`);

await g(() =>
  window.__game.getState().pickUpItem({ uid: "e2e-amulet", defId: "amulet_fury", level: 6, rarity: "legendary", runLoot: true }),
);
for (let i = 0; i < 4; i++) {
  const canLeave = await g(() => window.__game.getState().run.floorsVisited >= 5);
  if (canLeave) fail("homeward rift must not open before the 5th floor");
  await g(() => window.__game.getState().descend());
  await sleep(300);
}
s = await g(() => ({ visited: window.__game.getState().run.floorsVisited, floor: window.__game.getState().floor }));
if (s.visited !== 5) fail(`should be on the 5th floor of the run (${s.visited})`);
ok(`survived to floor ${s.floor} — 5th of the run`);
if (OUT) await page.screenshot({ path: `${OUT}/run-5th-floor.png` });

await g(() => window.__game.getState().extract());
await sleep(500);
s = await g(() => {
  const st = window.__game.getState();
  return { phase: st.phase, amulet: st.equipment.amulet, extracted: st.lastExtraction?.items.length };
});
if (s.phase !== "village" || s.amulet?.uid !== "e2e-amulet" || s.amulet.runLoot) fail(`extraction should bank the amulet (${JSON.stringify(s)})`);
ok("extraction banked the legendary amulet");
if (OUT) await page.screenshot({ path: `${OUT}/run-extracted.png` });

const saved = await g(() => JSON.parse(localStorage.getItem("webmagic.save.v2")).equipment.amulet?.uid);
if (saved !== "e2e-amulet") fail("banked gear must be persisted");
ok("banked gear persisted");

// Second run: find something, then die before the 5th floor.
await g(() => window.__game.getState().dismissSummary());
await g(() => void window.__game.getState().enterDungeon());
await sleep(5000);
await g(() =>
  window.__game.getState().pickUpItem({ uid: "e2e-boots", defId: "boots_hover", level: 5, rarity: "rare", runLoot: true }),
);
await g(() => {
  window.__game.setState({ health: 1 });
  window.__game.getState().takeDamage(50);
});
await sleep(400);
s = await g(() => {
  const st = window.__game.getState();
  return { phase: st.phase, lost: st.lastDeath?.items.map((i) => i.uid), amulet: st.equipment.amulet?.uid, satchel: st.satchel.length };
});
if (s.phase !== "dead") fail("should be dead");
if (JSON.stringify(s.lost) !== JSON.stringify(["e2e-boots"])) fail(`only the run's boots are lost (${s.lost})`);
if (s.amulet !== "e2e-amulet") fail("banked amulet survives death");
ok("death took only this run's loot; banked gear survived");
if (OUT) await page.screenshot({ path: `${OUT}/run-death.png` });

await browser.close();
console.log("run e2e passed");
