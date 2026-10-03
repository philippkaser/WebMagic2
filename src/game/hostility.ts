/** Wizard-vs-wizard relations — the one question every PvP-aware system asks:
 * "what is that other wizard to me?".
 *
 * Deliberately a tiny seam with no imports: weapons (projectile collision,
 * explosion damage), net (peer collision capsules, name tags) and the HUD
 * read it, while the encounters layer (pacts) installs the real answer.
 * Until something installs a resolver, every other wizard is an ally — the
 * classic co-op behaviour, and what offline play and tests see. */

/** stranger: not sworn to us (hostile) · ally: pact sworn · oathbreaker: broke
 * a pact with us on this floor (hostile, and marked). */
export type WizardRelation = "stranger" | "ally" | "oathbreaker";

export type RelationResolver = (wizardId: string) => WizardRelation;

const DEFAULT: RelationResolver = () => "ally";
let resolver: RelationResolver = DEFAULT;

export function setRelationResolver(fn: RelationResolver): () => void {
  resolver = fn;
  return () => {
    if (resolver === fn) resolver = DEFAULT;
  };
}

export function relationOf(wizardId: string): WizardRelation {
  return resolver(wizardId);
}

/** True when the given OTHER wizard's spells can damage the local wizard. */
export function isHostileWizard(wizardId: string): boolean {
  return resolver(wizardId) !== "ally";
}
