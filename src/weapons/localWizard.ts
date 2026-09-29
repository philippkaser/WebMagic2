import { useNet } from "../net/netStore";

/** The local wizard's id — the key our spells are attributed to
 * (wizardSource) and our void seeds are filed under. Before the session
 * assigns an id (offline, still connecting) it is "self", which no peer id
 * can ever be, so our own magic is still recognized as ours. */
export function localWizardId(): string {
  return useNet.getState().playerId || "self";
}
