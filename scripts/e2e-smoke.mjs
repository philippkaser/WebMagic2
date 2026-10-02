// End-to-end smoke test for WebMagic: one solo run (the Weighing → five
// floors → walk home), then two wizards meeting on a floor (PvP, pact,
// death → grave → plunder, and the server honoring the plunder). Drives the
// game through its dev-only window hooks (__game, __castAt, __pact, …).
//
// Needs a dev client and a game server with forced encounters and a known
// data file (so the script can inspect server-side grants):
//
//   DATA_FILE=/tmp/wm-e2e.json ENCOUNTER_CHANCE=1 bun server/server.ts &
//   bunx vite --port 3000 &
//   DATA_FILE=/tmp/wm-e2e.json bun run e2e        (runs under node)
//
// Env: E2E_URL (default http://localhost:3000/), E2E_OUT (screenshots,
// default ./e2e-output), CHROMIUM_PATH (optional browser binary).
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const SP = process.env.E2E_OUT ?? "e2e-output";
const URL = process.env.E2E_URL ?? "http://localhost:3000/";
const DATA_FILE = process.env.DATA_FILE;
mkdirSync(SP, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
});

async function newWizard(name) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
  await page.evaluate((n) => {
    window.__game.getState().setPlayerName(n);
    window.__game.getState().startGame();
  }, name);
  await sleep(1500);
  return { page, errors, name };
}

const state = (w, fn) => w.page.evaluate(fn);
const game = (w) => w.page.evaluate(() => {
  const s = window.__game.getState();
  return { phase: s.phase, floor: s.floor, run: s.run, deepest: s.deepest, health: s.health,
    instanceId: s.instanceId, equipment: s.equipment, lastDeath: s.lastDeath };
});
async function waitPhase(w, phase, timeout = 30000) {
  try {
    await w.page.waitForFunction((p) => window.__game.getState().phase === p, phase, { timeout });
  } catch (err) {
    // Say where the wizard got stuck, not just that it did.
    const where = await w.page.evaluate(() => {
      const s = window.__game.getState();
      const t = window.__travel?.state?.();
      return { phase: s.phase, health: s.health, overlay: s.overlay, floor: s.floor, travel: t && `${t.stage}/${t.kind}` };
    });
    throw new Error(`waiting for phase "${phase}": ${JSON.stringify(where)}`, { cause: err });
  }
}

// ── Solo run ────────────────────────────────────────────────────────────────
{
  const a = await newWizard("Solo");
  await a.page.evaluate(() => window.__game.getState().openWeighing());
  await sleep(400);
  await a.page.screenshot({ path: `${SP}/shot-weighing.png` });
  check("weighing overlay shows", (await game(a)).phase === "weighing");
  await a.page.evaluate(() => window.__game.getState().enterDungeon());
  await waitPhase(a, "dungeon");
  let g = await game(a);
  check("starter gear is cast to floor 1", g.floor === 1, `floor ${g.floor}`);
  check("run starts at one floor played", g.run?.floorsPlayed === 1);
  await sleep(2500);
  await a.page.screenshot({ path: `${SP}/shot-floor1.png` });
  await a.page.evaluate(() => window.__game.getState().walkHome());
  await sleep(300);
  check("the way home is sealed before five floors", (await game(a)).phase === "dungeon");
  for (let i = 0; i < 4; i++) {
    await a.page.evaluate(() => window.__game.getState().descend());
    await waitPhase(a, "dungeon");
    await sleep(800);
  }
  g = await game(a);
  check("five floors played", g.run?.floorsPlayed === 5 && g.floor === 5, `floor ${g.floor}, played ${g.run?.floorsPlayed}`);
  await a.page.screenshot({ path: `${SP}/shot-floor5.png` });
  await a.page.evaluate(() => window.__game.getState().walkHome());
  await waitPhase(a, "village");
  await sleep(800);
  g = await game(a);
  check("walked home; deepest recorded", g.deepest === 5, `deepest ${g.deepest}`);
  check("solo run had no page errors", a.errors.length === 0, a.errors.slice(0, 3).join(" | "));
  await a.page.context().close();
}

// ── Two wizards meet ────────────────────────────────────────────────────────
{
  const a = await newWizard("Oswin");
  const b = await newWizard("Mira");
  for (const w of [a, b]) {
    await w.page.evaluate(() => window.__game.getState().enterDungeon());
    await waitPhase(w, "dungeon");
  }
  const ga = await game(a);
  const gb = await game(b);
  check("both land in the same instance (forced encounter)", ga.instanceId === gb.instanceId && ga.floor === gb.floor,
    `${ga.instanceId}/${gb.instanceId}`);
  await sleep(3000);
  const idA = await state(a, () => window.__session.playerId);
  const idB = await state(b, () => window.__session.playerId);
  // A casts the map: it lies on A's floor for B too.
  await a.page.evaluate(async () => (await import("/src/ui3d/layers/map/mapStore.ts")).useMapCast.getState().toggle());
  await sleep(1500);
  const seenByB = await b.page.evaluate(async () => (await import("/src/ui3d/layers/map/mapStore.ts")).useMapCast.getState().casts.map((c) => c.owner));
  check("a cast map is shared with the floor", seenByB.includes(idA), JSON.stringify(seenByB));
  await a.page.evaluate(async () => (await import("/src/ui3d/layers/map/mapStore.ts")).useMapCast.getState().toggle());
  // PvP: A stands a few metres from B and shoots. A single fixed offset can
  // put a wall or a prop in the line of fire: try the four sides until a
  // volley lands (the check is about damage, not geometry).
  const hpBefore = (await game(b)).health;
  const target = await b.page.evaluate(() => window.__playerPos?.());
  if (target) {
    for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) {
      await a.page.evaluate(([x, y, z]) => window.__teleport(x, y + 0.5, z), [target[0] + dx, target[1], target[2] + dz]);
      await sleep(600);
      for (let i = 0; i < 4; i++) {
        await a.page.evaluate(([x, y, z]) => window.__castAt(x, y, z), target);
        await sleep(350);
      }
      await sleep(1200);
      if ((await game(b)).health < hpBefore) break;
    }
  }
  const hpAfter = (await game(b)).health;
  check("a stranger's bolts hurt (victim-side PvP damage)", hpAfter < hpBefore, `${hpBefore} → ${hpAfter}`);

  // Pact: A offers, B accepts → magic passes harmlessly.
  await a.page.evaluate((id) => window.__pact(id), idB);
  await sleep(700);
  await b.page.evaluate((id) => window.__pact(id), idA);
  await sleep(900);
  const relA = await a.page.evaluate((id) => window.__relations?.()[id]?.state, idB);
  const relB = await b.page.evaluate((id) => window.__relations?.()[id]?.state, idA);
  check("pact sworn on both sides", relA === "bound" && relB === "bound", `${relA}/${relB}`);
  const hpPact = (await game(b)).health;
  const target2 = await b.page.evaluate(() => window.__playerPos?.());
  if (target2) {
    for (let i = 0; i < 4; i++) {
      await a.page.evaluate(([x, y, z]) => window.__castAt(x, y, z), target2);
      await sleep(350);
    }
    await sleep(1200);
  }
  const hpPact2 = (await game(b)).health;
  check("sworn allies can't hurt each other", hpPact2 >= hpPact, `${hpPact} → ${hpPact2}`);

  // Break the pact, give B some run loot, and let A kill B.
  await a.page.evaluate((id) => window.__pact(id), idB);
  await sleep(700);
  // Mira picks up loot the honest way: the host drops real orbs at her feet,
  // she takes the item (E) and walks over the coins (auto) — host-granted.
  const at = await b.page.evaluate(() => window.__playerPos());
  await a.page.evaluate(([x, y, z]) => {
    window.__spawnOrb("amulet_vigor@3", 0, [x + 0.4, Math.max(0.4, y - 0.5), z]);
    window.__spawnOrb(null, 40, [x - 0.3, Math.max(0.4, y - 0.5), z]);
  }, at);
  await sleep(1500);
  await b.page.keyboard.down("KeyE");
  await sleep(150);
  await b.page.keyboard.up("KeyE");
  await sleep(1200);
  const mira = await game(b);
  check("the fallen-to-be picks up host-granted loot", mira.equipment.amulet?.defId === "amulet_vigor@3",
    JSON.stringify(mira.equipment.amulet));
  await b.page.evaluate((killer) => window.__game.getState().takeDamage(10_000, { kind: "wizard", id: killer }), idA);
  await waitPhase(b, "dead", 20000); // the death dissolve plays first
  const death = (await game(b)).lastDeath;
  check("death names the killer and leaves a grave", death?.killer === "Oswin" && death?.grave === true,
    JSON.stringify(death));
  await sleep(1500);
  const graves = await a.page.evaluate(() => window.__graves?.() ?? []);
  check("the grave rose on the killer's floor", graves.length === 1 && graves[0].items.length > 0,
    JSON.stringify(graves.map((g) => ({ items: g.items, gold: g.gold }))));
  if (graves.length === 1) {
    const [x, y, z] = graves[0].pos;
    await a.page.evaluate(([x, y, z]) => window.__teleport(x + 1, y + 1, z), [x, y, z]);
    await sleep(1200);
    const prompt = await a.page.evaluate(() => window.__game.getState().prompt);
    check("the grave offers its plunder", /Plunder/.test(prompt ?? ""), prompt ?? "no prompt");
    await a.page.keyboard.down("KeyE");
    await sleep(120);
    await a.page.keyboard.up("KeyE");
    await sleep(1500);
    const after = await game(a);
    check("plunder: the killer takes the fallen wizard's amulet",
      after.equipment.amulet?.defId === "amulet_vigor@3", JSON.stringify(after.equipment.amulet));
    await a.page.screenshot({ path: `${SP}/shot-grave.png` });
    // Server side: the plunder must be bankable for the looter (grave pool).
    await sleep(1200);
    const accounts = DATA_FILE ? JSON.parse(readFileSync(DATA_FILE, "utf8")) : [];
    const oswin = accounts.filter((acc) => acc.name === "Oswin").at(-1);
    check("the server honors the grave plunder as a grant",
      !!oswin && oswin.runGrants.includes("amulet_vigor@3") && oswin.runGold >= 40,
      JSON.stringify({ grants: oswin?.runGrants, gold: oswin?.runGold }));
  }
  check("encounter had no page errors (A)", a.errors.length === 0, a.errors.slice(0, 3).join(" | "));
  check("encounter had no page errors (B)", b.errors.length === 0, b.errors.slice(0, 3).join(" | "));
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
