// End-to-end smoke test for WebMagic: one solo run (the Weighing → five
// floors → walk home), then two wizards meeting on a floor (PvP, pact,
// death → grave → plunder, and the server honoring the plunder), then the
// camp (two wizards home: chat, a fellowship by its runes) and a bout in the
// Proving Ground (the obelisk's line, yields, Varr's ledger, home again).
// Drives the game through its dev-only window hooks (__game, __castAt,
// __pact, __session, __arena, …).
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
/** Strike a wizard down: a killing blow from half health or more only
 * leaves them at the Brink (lethal grace, game/vitality), so a second blow
 * follows once the Brink's moment has passed. */
async function strikeDown(w, killerId) {
  const blow = (id) => window.__game.getState().takeDamage(10_000, { kind: "wizard", id });
  await w.page.evaluate(blow, killerId);
  await sleep(900);
  if ((await game(w)).phase === "dungeon") await w.page.evaluate(blow, killerId);
}

/** Poll from node (a page busy rendering in software can starve the
 * page-side polling of waitForFunction). */
async function until(w, fn, arg, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await w.page.evaluate(fn, arg)) return;
    await sleep(250);
  }
  throw new Error("timed out");
}

async function waitPhase(w, phase, timeout = 30000) {
  try {
    await until(w, (p) => window.__game.getState().phase === p, phase, timeout);
  } catch (err) {
    // Say where the wizard got stuck, not just that it did.
    const where = await w.page.evaluate(() => {
      const s = window.__game.getState();
      const t = window.__travel?.state?.();
      const bout = window.__arena?.getState().bout;
      return {
        phase: s.phase, health: s.health, overlay: s.overlay, floor: s.floor, travel: t && `${t.stage}/${t.kind}`,
        mode: window.__net?.getState().mode,
        bout: bout && { ended: bout.ended?.winner ?? null, board: bout.board.map((b) => `${b.name}:${b.kills}/${b.falls}`).join(" "), sandsLeftS: bout.fightAt == null ? "gathering" : Math.round((bout.endsAt - (window.__clock?.serverNow?.() ?? 0)) / 1000), fightAt: bout.fightAt },
      };
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
  // PvP: A steps up beside B and looses the Force Blast. (A bolt's flight
  // is physics stepped once a frame, and a page drawing in software manages
  // a frame or two a second: whether it meets B or the wall behind is luck.
  // The blast has no flight — it's the victim-side damage that's checked.)
  const hpBefore = (await game(b)).health;
  const target = await b.page.evaluate(() => window.__playerPos?.());
  if (target) {
    for (const [dx, dz] of [[1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4]]) {
      await a.page.evaluate(([x, y, z]) => window.__teleport(x, y + 0.3, z), [target[0] + dx, target[1], target[2] + dz]);
      await sleep(1200);
      await a.page.evaluate(([x, y, z]) => window.__castAt(x, y, z, "secondary"), target);
      await sleep(1500);
      if ((await game(b)).health < hpBefore) break;
    }
  }
  const hpAfter = (await game(b)).health;
  check("a stranger's blast hurts (victim-side PvP damage)", hpAfter < hpBefore, `${hpBefore} → ${hpAfter}`);

  // Pact: A offers, B accepts → magic passes harmlessly.
  await a.page.evaluate((id) => window.__pact(id), idB);
  await sleep(700);
  await b.page.evaluate((id) => window.__pact(id), idA);
  await sleep(900);
  const relA = await a.page.evaluate((id) => window.__relations?.()[id]?.state, idB);
  const relB = await b.page.evaluate((id) => window.__relations?.()[id]?.state, idA);
  check("pact sworn on both sides", relA === "bound" && relB === "bound", `${relA}/${relB}`);
  const hpPact = (await game(b)).health;
  // The same blast, from beside them: an ally's magic only nudges.
  const target2 = await b.page.evaluate(() => window.__playerPos?.());
  if (target2) {
    await a.page.evaluate(([x, y, z]) => window.__teleport(x + 1.4, y + 0.3, z), target2);
    await sleep(1200);
    await a.page.evaluate(([x, y, z]) => window.__castAt(x, y, z, "secondary"), target2);
    await sleep(1500);
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
  await strikeDown(b, idA);
  await waitPhase(b, "dead", 60000); // the death dissolve plays first (slow under load)
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
    // Under load the teleport can take seconds to land: poll for the prompt.
    let prompt = null;
    for (let i = 0; i < 20 && !/Plunder/.test(prompt ?? ""); i++) {
      await sleep(500);
      prompt = await a.page.evaluate(() => window.__game.getState().prompt);
    }
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
    const file = DATA_FILE ? JSON.parse(readFileSync(DATA_FILE, "utf8")) : [];
    const accounts = Array.isArray(file) ? file : file.accounts; // { version, accounts } since v2
    const oswin = accounts.filter((acc) => acc.name === "Oswin").at(-1);
    check("the server honors the grave plunder as a grant",
      !!oswin && oswin.runGrants.includes("amulet_vigor@3") && oswin.runGold >= 40,
      JSON.stringify({ grants: oswin?.runGrants, gold: oswin?.runGold }));
  }
  check("encounter had no page errors (A)", a.errors.length === 0, a.errors.slice(0, 3).join(" | "));
  check("encounter had no page errors (B)", b.errors.length === 0, b.errors.slice(0, 3).join(" | "));
}

// ── The camp: two wizards home ──────────────────────────────────────────────
{
  const a = await newWizard("Hesk");
  const b = await newWizard("Ilse");
  // Both seated in one camp (a slow first connection may retry under a new
  // id, so the ids are read once the room agrees).
  const seatedTogether = async () => {
    const ia = await state(a, () => window.__session.playerId);
    const ib = await state(b, () => window.__session.playerId);
    const ra = await state(a, () => Object.keys(window.__net.getState().roster));
    const rb = await state(b, () => Object.keys(window.__net.getState().roster));
    return ia && ib && ra.includes(ib) && rb.includes(ia) ? [ia, ib] : null;
  };
  let ids = null;
  for (let i = 0; i < 120 && !ids; i++) {
    ids = await seatedTogether();
    if (!ids) await sleep(500);
  }
  check("two wizards home share the camp", !!ids);
  const [idA, idB] = ids ?? ["", ""];
  const social = (w) => w.page.evaluate(async () => {
    const s = (await import("/src/social/social.ts")).useSocial.getState();
    return { party: s.party, lines: s.lines.map((l) => [l.name, l.text, l.party]) };
  });
  // The camp is everyone who's home: A hears B.
  await b.page.evaluate(() => window.__session.sendChat("well met at the fire"));
  await sleep(1200);
  const heard = (await social(a)).lines;
  check("the camp hears what's said in it", heard.some(([n, t]) => n === "Ilse" && t === "well met at the fire"), JSON.stringify(heard));
  // A fellowship, by its runes.
  await a.page.evaluate(() => window.__session.partyCreate());
  await sleep(1000);
  const code = (await social(a)).party?.code;
  check("founding a fellowship gives six runes", /^[A-Z0-9]{6}$/.test(code ?? ""), String(code));
  await b.page.evaluate((c) => window.__session.partyJoin(c), code);
  await sleep(1200);
  const partyB = (await social(b)).party;
  check("speaking the runes joins the fellowship", partyB?.members.map((m) => m.id).sort().join() === [idA, idB].sort().join(),
    JSON.stringify(partyB));
  await a.page.evaluate(() => window.__session.sendChat("down together", true));
  await sleep(1000);
  check("fellowship chat reaches the fellowship", (await social(b)).lines.some(([, t, p]) => t === "down together" && p));
  await b.page.evaluate(() => window.__session.partyLeave());
  check("camp had no page errors", a.errors.length + b.errors.length === 0, [...a.errors, ...b.errors].slice(0, 3).join(" | "));

  // ── The Proving Ground ─────────────────────────────────────────────────────
  await a.page.evaluate(() => window.__game.getState().setOverlay("arena"));
  await sleep(800);
  await a.page.screenshot({ path: `${SP}/shot-obelisk.png` });
  await a.page.evaluate(() => window.__game.getState().setOverlay("none"));
  await a.page.evaluate(() => window.__session.arenaJoin());
  await sleep(800);
  const queued = await state(a, () => window.__arena.getState().queue);
  check("the obelisk takes you into the line", queued?.position === 1, JSON.stringify(queued));
  await b.page.evaluate(() => window.__session.arenaJoin());
  await waitPhase(a, "dungeon", 40000);
  await waitPhase(b, "dungeon", 40000);
  const boutA = await state(a, () => window.__arena.getState().bout);
  const boutB = await state(b, () => window.__arena.getState().bout);
  check("both are dealt into one bout", !!boutA && boutA.instanceId === boutB?.instanceId, `${boutA?.instanceId}/${boutB?.instanceId}`);
  // The sands wait for both of us; then Varr counts it in.
  await until(a, () => {
    const b = window.__arena.getState().bout;
    return !!b?.fightAt && window.__clock.serverNow() >= b.fightAt;
  }, undefined, 40000);
  // The sands run the whole bout from FIGHT, and FIGHT came after both of us
  // had arrived (the hall waited for us, not for its patience to run out).
  const timing = await state(a, () => {
    const b = window.__arena.getState().bout;
    return { span: b.endsAt - b.fightAt, waitedFor: b.readyAt != null && b.readyAt <= b.fightAt };
  });
  check("the sands start at FIGHT, after everyone has arrived", timing.span === 180_000 && timing.waitedFor, JSON.stringify(timing));
  await sleep(2500);
  await a.page.screenshot({ path: `${SP}/shot-arena.png` });
  // Ilse falls ten times to Hesk: each a yield, never a death.
  for (let i = 0; i < 10; i++) {
    await waitPhase(b, "dungeon", 30000);
    await strikeDown(b, idA);
    await sleep(300);
    if (i === 0) {
      const g = await game(b);
      check("a fall in the hall is a yield, not a death", g.phase === "loading" && g.lastDeath === null, JSON.stringify({ phase: g.phase }));
    }
  }
  await until(a, () => !!window.__arena.getState().bout?.ended, undefined, 30000).catch(() => {});
  const ended = await state(a, () => window.__arena.getState().bout?.ended ?? null);
  check("ten yields win the hall", ended?.winner === idA, JSON.stringify(ended?.winner));
  await waitPhase(a, "village", 40000);
  await waitPhase(b, "village", 40000);
  const record = await state(a, () => window.__arena.getState().record);
  check("Varr writes the bout in the ledger", record?.wins >= 1 && record?.yields >= 10, JSON.stringify(record));
  check("the hall sends everyone home", !(await state(b, () => !!window.__arena.getState().bout)));
  check("Proving Ground had no page errors", a.errors.length + b.errors.length === 0, [...a.errors, ...b.errors].slice(0, 3).join(" | "));
  await a.page.context().close();
  await b.page.context().close();
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
