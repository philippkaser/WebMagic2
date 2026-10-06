import type { Rng } from "../core/rng";
import { SLIME_MAX_GEN } from "../enemies/brains/slime";
import { omenRules } from "../world/omens";
import type { FloorLayout } from "../world/types";
import { rollSourceLoot, treasureItem, type LootDrop, type LootRules, type LootSource } from "./dropTables";

/** One floor instance's book of loot — the authority over what falls there.
 *
 * Built from the generated layout (the same seed every client builds the
 * floor from), it knows every source the floor holds: enemy `e3`, prop
 * `p12`, the `boss`, and how many slimes may split off at runtime. A source
 * is rolled once, with the book's own dice and the shared drop tables; each
 * drop becomes an orb with an id, and an orb can be claimed once. The floor
 * treasure is an orb from the start.
 *
 * So a host that lies can only claim what its floor really holds — every
 * monster killed at once is still only that floor's luck — and an orb can
 * never be granted twice. Pure; the server's ledger keeps one per instance,
 * the offline loopback keeps one too (the same rules in single-player). */

export interface IssuedOrb {
  orbId: string;
  itemId: string | null;
  gold: number;
}

/** The floor treasure's orb id. */
export const TREASURE_ORB = "treasure";

/** Orb ids for copies a wizard dropped carry this prefix (and only those may
 * be spawned by a drop request — see items/LootOrbs.tsx). */
export const DROPPED_ORB_PREFIX = "d";

export class LootBook {
  private rolled = new Set<string>();
  /** Slime kills reported per split generation (they have no layout id). */
  private splitKills = new Map<number, number>();
  private slimes: number;
  private rules: LootRules;
  private open = new Map<string, LootDrop>();
  private next = 1;

  constructor(
    private layout: FloorLayout,
    private rng: Rng,
  ) {
    const omen = omenRules(layout.omen);
    this.rules = { lootChanceMult: omen.lootChanceMult ?? 1, goldMult: omen.goldMult ?? 1 };
    this.slimes = layout.enemies.filter((e) => e.kind === "slime").length;
    this.open.set(TREASURE_ORB, { itemId: treasureItem(layout.seed, layout.floor), gold: 0 });
  }

  /** `id` died or broke: its drops, rolled once, as orbs (possibly none).
   * `claimed` describes it — trusted only for runtime spawns, which have no
   * layout id: a slime split of generation 1…2, within what the floor's
   * slimes can split into. Null = not something this floor holds, already
   * rolled, or past the split budget. */
  roll(id: string, claimed?: LootSource): IssuedOrb[] | null {
    const source = this.layoutSource(id);
    if (source) {
      if (this.rolled.has(id)) return null;
      this.rolled.add(id);
      return this.issueAll(rollSourceLoot(this.rng, source, this.layout.floor, this.rules));
    }
    if (claimed?.kind !== "enemy" || claimed.enemy !== "slime") return null;
    const gen = Math.floor(claimed.gen);
    if (!(gen >= 1 && gen <= SLIME_MAX_GEN)) return null;
    const used = this.splitKills.get(gen) ?? 0;
    if (used >= this.slimes * 2 ** gen) return null; // each split makes two
    this.splitKills.set(gen, used + 1);
    return this.issueAll(
      rollSourceLoot(this.rng, { kind: "enemy", enemy: "slime", gen }, this.layout.floor, this.rules),
    );
  }

  /** Put something into the book as an orb — a copy a wizard dropped (the
   * ledger took it off them first), or a test/dev drop. */
  issue(itemId: string | null, gold: number, prefix = "o"): IssuedOrb {
    const orbId = `${prefix}${this.next++}`;
    this.open.set(orbId, { itemId, gold });
    return { orbId, itemId, gold };
  }

  /** What an orb holds, without taking it. Null if unknown or taken. */
  peek(orbId: string): LootDrop | null {
    return this.open.get(orbId) ?? null;
  }

  /** Take an orb: what it holds, once. Null if unknown or already taken. */
  claim(orbId: string): LootDrop | null {
    const drop = this.open.get(orbId);
    if (!drop) return null;
    this.open.delete(orbId);
    return drop;
  }

  private layoutSource(id: string): LootSource | null {
    if (id === "boss") return this.layout.boss ? { kind: "boss" } : null;
    const m = /^([ep])(\d{1,4})$/.exec(id);
    if (!m) return null;
    const i = Number(m[2]);
    if (m[1] === "e") {
      const enemy = this.layout.enemies[i];
      return enemy ? { kind: "enemy", enemy: enemy.kind, gen: 0 } : null;
    }
    const prop = this.layout.props[i];
    return prop ? { kind: "prop", prop: prop.kind } : null;
  }

  private issueAll(drops: LootDrop[]): IssuedOrb[] {
    return drops.map((d) => this.issue(d.itemId, d.gold));
  }
}
