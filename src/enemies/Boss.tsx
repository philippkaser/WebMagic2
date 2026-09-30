import type { Vec3 } from "../world/types";
import { bossFor } from "./bosses/bossTable";
import { HollowChoir } from "./bosses/HollowChoir";
import { Warden } from "./bosses/Warden";

export { bossFor, bossTitle } from "./bosses/bossTable";

/** Floor boss. The floor host runs its brain; replicas interpolate its body,
 * replay its attacks and mirror its health bar. The floor's portals stay
 * sealed until it falls (`onDeath`). */
export function Boss(props: { position: Vec3; floor: number; onDeath: () => void }) {
  return bossFor(props.floor) === "choir" ? <HollowChoir {...props} /> : <Warden {...props} />;
}
