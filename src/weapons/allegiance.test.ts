import { describe, expect, test } from "bun:test";
import { GROUPS, PVP } from "../core/config";
import { ENEMY_SOURCE, WORLD_SOURCE, wizardSource, type DamageSource } from "../game/damageSource";
import {
  GENTLE_PUSH,
  holePullsLocal,
  localBlastEffect,
  PROJECTILE_GROUPS,
  relationToLocal,
  STRONG_PUSH,
  type DamageTeam,
  type LocalRelation,
} from "./allegiance";

const ME = "me";
const RIVAL = "rival"; // hostile to us
const FRIEND = "friend"; // a floor-mate we're at peace with
const isHostile = (id: string) => id === RIVAL;
/** A resolver that (wrongly) calls everyone hostile — even us. */
const paranoid = () => true;

describe("relationToLocal", () => {
  const cases: [DamageTeam, DamageSource | undefined, LocalRelation][] = [
    ["enemy", undefined, "dungeon"],
    ["enemy", ENEMY_SOURCE, "dungeon"],
    ["enemy", WORLD_SOURCE, "dungeon"],
    ["neutral", undefined, "dungeon"],
    ["player", undefined, "own"],
    ["player", wizardSource(ME), "own"],
    ["player", wizardSource(FRIEND), "ally"],
    ["player", wizardSource(RIVAL), "hostile"],
    // Nonsense combos stay harmless: player magic with a dungeon source is ours.
    ["player", ENEMY_SOURCE, "own"],
    ["player", WORLD_SOURCE, "own"],
  ];
  for (const [team, source, expected] of cases) {
    test(`${team} / ${source ? JSON.stringify(source) : "no source"} → ${expected}`, () => {
      expect(relationToLocal(team, source, ME, isHostile)).toBe(expected);
    });
  }

  test("our own magic is never hostile, whatever the resolver says", () => {
    expect(relationToLocal("player", wizardSource(ME), ME, paranoid)).toBe("own");
  });
});

describe("localBlastEffect — truth table", () => {
  test("enemy blast: full damage, strong push, blamed on monsters", () => {
    expect(localBlastEffect("enemy", undefined, ME, isHostile)).toEqual({
      relation: "dungeon",
      damageMult: 1,
      pushMult: STRONG_PUSH,
      source: ENEMY_SOURCE,
    });
  });

  test("enemy-team trap dart: full damage, blamed on the world", () => {
    const e = localBlastEffect("enemy", WORLD_SOURCE, ME, isHostile);
    expect(e.damageMult).toBe(1);
    expect(e.pushMult).toBe(STRONG_PUSH);
    expect(e.source).toEqual(WORLD_SOURCE);
  });

  test("neutral blast (barrel): full damage, strong push, blamed on the world", () => {
    expect(localBlastEffect("neutral", undefined, ME, isHostile)).toEqual({
      relation: "dungeon",
      damageMult: 1,
      pushMult: STRONG_PUSH,
      source: WORLD_SOURCE,
    });
  });

  test("a given source is passed through for dungeon blasts", () => {
    expect(localBlastEffect("neutral", ENEMY_SOURCE, ME, isHostile).source).toEqual(ENEMY_SOURCE);
  });

  test("our own magic: no damage, gentle push (blast-jumping)", () => {
    for (const source of [wizardSource(ME), undefined]) {
      const e = localBlastEffect("player", source, ME, isHostile);
      expect(e.damageMult).toBe(0);
      expect(e.pushMult).toBe(GENTLE_PUSH);
    }
    expect(localBlastEffect("player", wizardSource(ME), ME, paranoid).damageMult).toBe(0);
  });

  test("an ally's magic: no damage, gentle push", () => {
    const e = localBlastEffect("player", wizardSource(FRIEND), ME, isHostile);
    expect(e.relation).toBe("ally");
    expect(e.damageMult).toBe(0);
    expect(e.pushMult).toBe(GENTLE_PUSH);
  });

  test("a hostile wizard's magic: PvP-scaled damage, strong push, credited to them", () => {
    expect(localBlastEffect("player", wizardSource(RIVAL), ME, isHostile)).toEqual({
      relation: "hostile",
      damageMult: PVP.damageMult,
      pushMult: STRONG_PUSH,
      source: wizardSource(RIVAL),
    });
    expect(PVP.damageMult).toBeGreaterThan(0);
    expect(PVP.damageMult).toBeLessThan(1);
  });

  test("friendly pushes are gentler than hostile ones", () => {
    expect(GENTLE_PUSH).toBeLessThan(STRONG_PUSH);
  });
});

describe("holePullsLocal", () => {
  test("own and hostile holes pull us; allies' don't", () => {
    expect(holePullsLocal("player", wizardSource(ME), ME, isHostile)).toBe(true);
    expect(holePullsLocal("player", wizardSource(RIVAL), ME, isHostile)).toBe(true);
    expect(holePullsLocal("player", wizardSource(FRIEND), ME, isHostile)).toBe(false);
    expect(holePullsLocal("enemy", undefined, ME, isHostile)).toBe(true);
  });
});

// ── Collision groups ─────────────────────────────────────────────────────────

interface Collider {
  membership: readonly number[];
  filter: readonly number[];
}

/** Rapier's rule: a contact needs BOTH sides to accept the other. */
function collides(a: Collider, b: Collider): boolean {
  return a.membership.some((g) => b.filter.includes(g)) && b.membership.some((g) => a.filter.includes(g));
}

// The rest of the world's colliders as they are configured today (outside
// weapons/): dungeon/village walls, props, enemies — plus the capsules the
// lead wires for PvP (LOCAL_PLAYER on ours, PEER_HOSTILE on hostile peers').
const WALL: Collider = {
  membership: [GROUPS.WORLD],
  filter: [GROUPS.PLAYER, GROUPS.ENEMY, GROUPS.FRIENDLY_PROJECTILE, GROUPS.ENEMY_PROJECTILE, GROUPS.PROP],
};
const PROP: Collider = {
  membership: [GROUPS.PROP],
  filter: [
    GROUPS.WORLD,
    GROUPS.PLAYER,
    GROUPS.ENEMY,
    GROUPS.FRIENDLY_PROJECTILE,
    GROUPS.ENEMY_PROJECTILE,
    GROUPS.PROP,
  ],
};
const ENEMY: Collider = {
  membership: [GROUPS.ENEMY],
  filter: [GROUPS.WORLD, GROUPS.PLAYER, GROUPS.ENEMY, GROUPS.PROP, GROUPS.FRIENDLY_PROJECTILE],
};
const US: Collider = {
  membership: [GROUPS.PLAYER, GROUPS.LOCAL_PLAYER],
  filter: [GROUPS.WORLD, GROUPS.ENEMY, GROUPS.ENEMY_PROJECTILE, GROUPS.PROP, GROUPS.HOSTILE_SPELL],
};
const HOSTILE_PEER: Collider = {
  membership: [GROUPS.PLAYER, GROUPS.PEER_HOSTILE],
  filter: [GROUPS.ENEMY, GROUPS.PROP, GROUPS.ENEMY_PROJECTILE, GROUPS.FRIENDLY_PROJECTILE],
};
const FRIENDLY_PEER: Collider = {
  membership: [GROUPS.PLAYER],
  filter: [GROUPS.ENEMY, GROUPS.PROP, GROUPS.ENEMY_PROJECTILE, GROUPS.FRIENDLY_PROJECTILE],
};

describe("PROJECTILE_GROUPS", () => {
  test("the contract, group by group", () => {
    expect(PROJECTILE_GROUPS.own).toEqual({
      membership: [GROUPS.FRIENDLY_PROJECTILE],
      filter: [GROUPS.WORLD, GROUPS.ENEMY, GROUPS.PROP, GROUPS.PEER_HOSTILE],
    });
    expect(PROJECTILE_GROUPS.ally).toEqual({
      membership: [GROUPS.FRIENDLY_PROJECTILE],
      filter: [GROUPS.WORLD, GROUPS.ENEMY, GROUPS.PROP],
    });
    expect(PROJECTILE_GROUPS.hostile.membership).toContain(GROUPS.HOSTILE_SPELL);
    expect(PROJECTILE_GROUPS.hostile.filter).toEqual([
      GROUPS.WORLD,
      GROUPS.ENEMY,
      GROUPS.PROP,
      GROUPS.LOCAL_PLAYER,
    ]);
    expect(PROJECTILE_GROUPS.dungeon).toEqual({
      membership: [GROUPS.ENEMY_PROJECTILE],
      filter: [GROUPS.WORLD, GROUPS.PLAYER, GROUPS.PROP],
    });
  });

  test("every bolt still bursts on walls, props and enemies", () => {
    for (const r of ["own", "ally", "hostile"] as const) {
      expect(collides(PROJECTILE_GROUPS[r], WALL)).toBe(true);
      expect(collides(PROJECTILE_GROUPS[r], PROP)).toBe(true);
      expect(collides(PROJECTILE_GROUPS[r], ENEMY)).toBe(true);
    }
    expect(collides(PROJECTILE_GROUPS.dungeon, WALL)).toBe(true);
    expect(collides(PROJECTILE_GROUPS.dungeon, PROP)).toBe(true);
    expect(collides(PROJECTILE_GROUPS.dungeon, ENEMY)).toBe(false);
  });

  test("our bolts burst on hostile peers only — never on friends or ourselves", () => {
    expect(collides(PROJECTILE_GROUPS.own, HOSTILE_PEER)).toBe(true);
    expect(collides(PROJECTILE_GROUPS.own, FRIENDLY_PEER)).toBe(false);
    expect(collides(PROJECTILE_GROUPS.own, US)).toBe(false);
  });

  test("a hostile replay bursts on us, never on peer capsules (its caster)", () => {
    expect(collides(PROJECTILE_GROUPS.hostile, US)).toBe(true);
    expect(collides(PROJECTILE_GROUPS.hostile, HOSTILE_PEER)).toBe(false);
    expect(collides(PROJECTILE_GROUPS.hostile, FRIENDLY_PEER)).toBe(false);
  });

  test("an allied replay touches no wizard", () => {
    expect(collides(PROJECTILE_GROUPS.ally, US)).toBe(false);
    expect(collides(PROJECTILE_GROUPS.ally, HOSTILE_PEER)).toBe(false);
    expect(collides(PROJECTILE_GROUPS.ally, FRIENDLY_PEER)).toBe(false);
  });

  test("dungeon bolts hit every wizard", () => {
    expect(collides(PROJECTILE_GROUPS.dungeon, US)).toBe(true);
    expect(collides(PROJECTILE_GROUPS.dungeon, HOSTILE_PEER)).toBe(true);
    expect(collides(PROJECTILE_GROUPS.dungeon, FRIENDLY_PEER)).toBe(true);
  });
});
