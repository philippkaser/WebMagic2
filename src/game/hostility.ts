/** Wizard-vs-wizard hostility — the one question every PvP-aware system asks:
 * "may this other wizard's magic hurt me?".
 *
 * Deliberately a tiny seam with no imports: weapons (projectile collision,
 * explosion damage), net (peer collision capsules) and the HUD read it, while
 * the encounters layer (pacts) installs the real answer. Until something
 * installs a resolver, nobody is hostile — the classic co-op behaviour. */

export type HostilityResolver = (wizardId: string) => boolean;

let resolver: HostilityResolver = () => false;

export function setHostilityResolver(fn: HostilityResolver): () => void {
  resolver = fn;
  return () => {
    if (resolver === fn) resolver = () => false;
  };
}

/** True when the given OTHER wizard's spells can damage the local wizard. */
export function isHostileWizard(wizardId: string): boolean {
  return resolver(wizardId);
}
