export type BossKind = "warden" | "choir";

/** Which boss guards a boss floor (every 10th): the Hollow Choir holds the
 * odd deep tens (30, 50, 70, 90), the Warden of the Deep all the others. */
export function bossFor(floor: number): BossKind {
  return floor >= 30 && (floor / 10) % 2 === 1 ? "choir" : "warden";
}

/** How the sealed portals name their jailer. */
export function bossTitle(floor: number): string {
  return bossFor(floor) === "choir" ? "the Hollow Choir" : "the Warden of the Deep";
}
