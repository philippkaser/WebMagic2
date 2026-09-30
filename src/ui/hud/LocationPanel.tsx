import { RUN } from "../../core/config";
import { gearLevel } from "../../items/stats";
import { selectIsHost, useNet } from "../../net/netStore";
import { canExtract, entryRange, type RunState } from "../../progression/progression";
import { useGame } from "../../state/gameStore";
import { biomeFor } from "../../world/biomes";
import { Icon } from "../components/Icon";
import { Panel } from "../components/Panel";
import { RUNES } from "../pixelArt";
import { color } from "../theme";

/** Top-left: where you are, how far into the run, and how strong you are. */
export function LocationPanel() {
  const phase = useGame((s) => s.phase);
  const floor = useGame((s) => s.floor);
  const run = useGame((s) => s.run);
  const gear = useGame((s) => gearLevel(s.equipment));
  const home = canExtract(run);

  return (
    <Panel className="wm-loc" frame={home ? "gold" : "brass"}>
      {phase === "dungeon" ? (
        <>
          <div className="wm-label">Floor</div>
          <div className="wm-loc__floor">
            <span className="wm-loc__num">{floor}</span>
            <span className="wm-loc__biome">{biomeFor(floor).name}</span>
          </div>
          {run && <RunTrack run={run} />}
          {home ? (
            <div className="wm-home">✦ The way home is open</div>
          ) : (
            run && (
              <div className="wm-label" style={{ marginTop: 3 }}>
                Survive {RUN.floorsToExtract - run.floorsVisited} more to open the way home
              </div>
            )
          )}
        </>
      ) : (
        <>
          <div className="wm-label">Sanctuary</div>
          <div className="wm-loc__floor">
            <span className="wm-loc__num" style={{ fontSize: 30 }}>The Village</span>
          </div>
          <VillageRange gear={gear} />
        </>
      )}
      <div className="wm-rule" style={{ margin: "5px 0 3px" }} />
      <div className="wm-loc__row">
        <Icon name="gem" tint={color.brassLight} scale={1} />
        <span className="wm-label">Gear</span>
        <span style={{ color: color.brassLight }}>{gear}</span>
        <NetStatus />
      </div>
    </Panel>
  );
}

/** Five runes, one per floor a run must survive. */
function RunTrack({ run }: { run: RunState }) {
  const home = canExtract(run);
  return (
    <div className="wm-runes" title={`${run.floorsVisited} of ${RUN.floorsToExtract} floors`}>
      {RUNES.slice(0, RUN.floorsToExtract).map((rune, i) => {
        const n = i + 1;
        const done = n < run.floorsVisited || (home && n === run.floorsVisited);
        const now = n === run.floorsVisited && !home;
        const tint = home ? color.gold : done || now ? color.arcane : "#3a3140";
        const cls = ["wm-rune", home ? "wm-rune--home" : done ? "wm-rune--done" : now ? "wm-rune--now" : ""].join(" ");
        return (
          <div key={rune} style={{ display: "flex", alignItems: "center" }}>
            {i > 0 && <div className={`wm-rune-link${n <= run.floorsVisited ? " wm-rune-link--lit" : ""}`} />}
            <div className={cls}>
              <Icon name={rune} tint={tint} scale={2} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function VillageRange({ gear }: { gear: number }) {
  const [lo, hi] = entryRange(gear);
  return (
    <div className="wm-label" style={{ marginTop: 3 }}>
      The rift will cast you to floors{" "}
      <span style={{ color: color.arcane }}>
        {lo}–{hi}
      </span>
    </div>
  );
}

function NetStatus() {
  const mode = useNet((s) => s.mode);
  const amHost = useNet(selectIsHost);
  const phase = useGame((s) => s.phase);
  const [glyph, text, tint] =
    mode === "online"
      ? ["◉", amHost && phase === "dungeon" ? "online · host" : "online", color.ally]
      : mode === "offline"
        ? ["○", "offline", color.faded]
        : ["◌", "connecting", color.faded];
  return (
    <span className="wm-label" style={{ marginLeft: "auto", color: tint }}>
      {glyph} {text}
    </span>
  );
}
