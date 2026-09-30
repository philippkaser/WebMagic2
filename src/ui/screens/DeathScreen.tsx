import { useGame } from "../../state/gameStore";
import { biomeFor } from "../../world/biomes";
import { ArcaneBackdrop } from "../components/ArcaneBackdrop";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { color } from "../theme";
import { CardRow, RunStats } from "./RunReport";

/** The death rites: who took you, what the dungeon kept, and the reminder
 * that it now waits in a chest for whoever gets there first. */
export function DeathScreen() {
  const death = useGame((s) => s.lastDeath);
  const respawn = useGame((s) => s.respawn);
  const floor = death?.floor ?? 0;
  const lost = death?.items ?? [];

  return (
    <div className="wm-screen">
      <ArcaneBackdrop mood="blood" cy={0.3} />
      <div className="wm-screen__content">
        <div className="wm-died">You Died</div>
        <div className="wm-rise" style={{ animationDelay: "900ms", marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="skull" tint="#fff" scale={2} />
          <span style={{ fontSize: 16, color: color.parchmentDim }}>
            {death?.killerName ? (
              <>
                Slain by <span style={{ color: color.violet }}>{death.killerName}</span>
              </>
            ) : (
              "The dungeon claimed you"
            )}{" "}
            on floor {floor} — {biomeFor(floor).name}
          </span>
          <Icon name="skull" tint="#fff" scale={2} />
        </div>

        {death && (
          <div className="wm-rise" style={{ animationDelay: "1100ms", marginTop: 18 }}>
            <RunStats run={death} tint="#ff8a7a" />
          </div>
        )}

        <div className="wm-rise" style={{ animationDelay: "1250ms", marginTop: 22, marginBottom: 12 }}>
          {lost.length > 0 ? (
            <>
              <div className="wm-label" style={{ color: "#ff8a7a", letterSpacing: 3 }}>
                The dungeon keeps what you carried
              </div>
              <div className="wm-lore" style={{ marginTop: 4 }}>
                It waits in a chest where you fell — for whoever finds it first.
              </div>
            </>
          ) : (
            <div className="wm-lore">You carried nothing the dungeon could take.</div>
          )}
        </div>
        {lost.length > 0 && <CardRow items={lost} />}

        <div className="wm-rise" style={{ animationDelay: "1500ms", marginTop: 26 }}>
          <Button variant="danger" glyphs onClick={respawn}>
            Return to the Village
          </Button>
        </div>
      </div>
    </div>
  );
}
