import { useRef, useState } from "react";
import { computeStats } from "../../items/stats";
import { useGame } from "../../state/gameStore";
import { useGameEvent } from "../hooks";

/** Screen-edge feedback: a red bite when hurt, a violet crackle when the
 * wound came from another wizard, and a slow throb when near death. */
export function Vignettes() {
  const [flash, setFlash] = useState<{ id: number; pvp: boolean } | null>(null);
  const low = useGame((s) => s.phase === "dungeon" && s.health / computeStats(s.equipment).maxHealth < 0.3);

  // `pvpHit` → takeDamage → `playerHurt` fires *inside* the pvpHit dispatch,
  // before our own pvpHit listener runs. So the hurt flash is decided a
  // microtask later, once we know whether this wound was a wizard's.
  const pending = useRef({ pvp: false, queued: false, id: 0 }).current;
  const commit = () => {
    pending.queued = false;
    setFlash({ id: ++pending.id, pvp: pending.pvp });
    pending.pvp = false;
  };
  useGameEvent("playerHurt", () => {
    if (pending.queued) return;
    pending.queued = true;
    queueMicrotask(commit);
  });
  useGameEvent("pvpHit", () => {
    pending.pvp = true;
    if (!pending.queued) {
      pending.queued = true;
      queueMicrotask(commit);
    }
  });

  return (
    <>
      {low && <div className="wm-vignette wm-vignette--low" />}
      {flash && (
        <div
          key={flash.id}
          className={`wm-vignette ${flash.pvp ? "wm-vignette--pvp" : "wm-vignette--hurt"}`}
          onAnimationEnd={() => setFlash(null)}
        />
      )}
    </>
  );
}
