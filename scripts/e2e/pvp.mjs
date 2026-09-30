/** End-to-end multiplayer check: two headless wizards meet on a floor, one
 * slays the other, the fallen leaves a death chest, the victor claims it.
 *
 *   WEBMAGIC_JOIN_CHANCE=1 bun server/server.ts &   # everyone meets
 *   bunx vite --port 3000 &
 *   bun scripts/e2e/pvp.mjs [screenshotDir]
 *
 * Exits non-zero on the first broken expectation. */
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

async function boot(name) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on("pageerror", (e) => console.log(`[${name}] page error: ${e.message}`));
  await page.goto(URL);
  await sleep(2500);
  await page.evaluate((n) => {
    localStorage.clear();
    localStorage.setItem("webmagic.name.v1", n);
  }, name);
  await page.reload();
  await sleep(2500);
  await page.evaluate(() => (window.__entryFloor = 2));
  await page.evaluate(() => window.__game.getState().startGame());
  await sleep(2500);
  await page.mouse.click(480, 270);
  return page;
}

const state = (p) =>
  p.evaluate(() => {
    const g = window.__game.getState();
    return { phase: g.phase, floor: g.floor, inst: g.instanceId, mode: window.__session.mode, satchel: g.satchel.length, run: g.run, lastDeath: g.lastDeath };
  });

const A = await boot("Alda");
const B = await boot("Brom");
await A.evaluate(() => void window.__game.getState().enterDungeon());
await sleep(5000);
await B.evaluate(() => void window.__game.getState().enterDungeon());
await sleep(6000);

const [sa, sb] = [await state(A), await state(B)];
if (sa.phase !== "dungeon" || sb.phase !== "dungeon") fail(`both should be in the dungeon (${sa.phase}/${sb.phase})`);
if (sa.mode !== "online" || sb.mode !== "online") fail(`both must be online (${sa.mode}/${sb.mode}) — is the server running?`);
if (sa.inst !== sb.inst) fail("server should have placed both in one instance (WEBMAGIC_JOIN_CHANCE=1?)");
ok(`both wizards share ${sa.inst} on floor ${sa.floor}`);

// Brom carries two run items, is badly hurt, and stands beside Alda.
await B.evaluate(() => {
  const g = window.__game.getState();
  g.pickUpItem({ uid: "e2e-staff", defId: "ember_staff", level: 4, rarity: "epic", runLoot: true });
  g.pickUpItem({ uid: "e2e-cloak", defId: "cloak_warden", level: 4, rarity: "rare", runLoot: true });
  window.__game.setState({ health: 6 });
});
await sleep(800);
const alda = await B.evaluate(() => [...window.__session.peers.values()][0]?.position);
if (!alda) fail("Brom should see Alda");
await B.evaluate((p) => window.__teleport(p.x + 1.2, p.y + 0.3, p.z), alda);
await sleep(1500);
if (OUT) await A.screenshot({ path: `${OUT}/pvp-1-meet.png` });

// Alda's Force Blast.
await A.mouse.down({ button: "right" });
await sleep(300);
await A.mouse.up({ button: "right" });
await sleep(1500);

const dead = await state(B);
if (dead.phase !== "dead") fail(`Brom should be dead (phase ${dead.phase})`);
if (dead.lastDeath?.killerName !== "Alda") fail(`kill should be attributed to Alda (${dead.lastDeath?.killerName})`);
if (dead.lastDeath?.items.length !== 2) fail("Brom should have lost both run items");
ok("Brom was slain by Alda and lost his run loot");

const chest = (await A.evaluate(() => window.__session.chests))[0];
if (!chest || chest.itemCount !== 2) fail("a 2-item death chest should appear for Alda");
ok(`${chest.owner}'s chest appeared`);
if (OUT) await A.screenshot({ path: `${OUT}/pvp-2-chest.png` });

await A.evaluate((c) => window.__teleport(c.pos[0] + 0.8, 1.2, c.pos[2] + 0.8), chest);
await sleep(800);
await A.keyboard.down("e");
await sleep(300);
await A.keyboard.up("e");
await sleep(1500);
const after = await A.evaluate(() => {
  const g = window.__game.getState();
  return { uids: [g.equipment.cloak?.uid, ...g.satchel.map((i) => i.uid)], slain: g.run?.wizardsSlain };
});
if (!after.uids.includes("e2e-staff") || !after.uids.includes("e2e-cloak")) fail(`Alda should hold both items (${after.uids})`);
if (after.slain !== 1) fail("Alda should be credited with the kill");
ok("Alda claimed the chest and the kill");

await browser.close();
console.log("pvp e2e passed");
