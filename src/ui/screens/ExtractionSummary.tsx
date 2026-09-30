import { useEffect } from "react";
import { useGame } from "../../state/gameStore";
import { ArcaneBackdrop } from "../components/ArcaneBackdrop";
import { Button } from "../components/Button";
import { color } from "../theme";
import { CardRow, RunStats } from "./RunReport";

/** Back through the homeward rift: what the run earned, now yours for good. */
export function ExtractionSummary() {
  const summary = useGame((s) => s.lastExtraction);
  const dismiss = useGame((s) => s.dismissSummary);

  // The warp home keeps the pointer locked; this screen needs the cursor.
  useEffect(() => {
    if (summary && document.pointerLockElement) document.exitPointerLock();
  }, [summary]);

  if (!summary) return null;
  return (
    <div className="wm-screen" style={{ background: "rgba(0,0,0,0.4)" }}>
      <ArcaneBackdrop mood="gold" cy={0.3} />
      <div className="wm-screen__content">
        <div className="wm-label wm-rise" style={{ color: color.gold, letterSpacing: 5 }}>
          The homeward rift releases you
        </div>
        <div className="wm-logo wm-logo--gold" style={{ fontSize: 108, marginTop: 6 }}>
          You Escaped
        </div>
        <div className="wm-rise" style={{ animationDelay: "300ms", marginTop: 18 }}>
          <RunStats run={summary} tint={color.gold} />
        </div>
        <div className="wm-rise" style={{ animationDelay: "450ms", margin: "22px 0 12px" }}>
          <div className="wm-label" style={{ color: color.gold, letterSpacing: 3 }}>
            {summary.items.length > 0
              ? `${summary.items.length} treasure${summary.items.length === 1 ? "" : "s"} carried home — yours for good`
              : "You came home empty-handed, but alive"}
          </div>
        </div>
        {summary.items.length > 0 && <CardRow items={summary.items} />}
        <div className="wm-rise" style={{ animationDelay: "800ms", marginTop: 26 }}>
          <Button variant="gold" glyphs onClick={dismiss}>
            Unpack into the Stash
          </Button>
        </div>
      </div>
    </div>
  );
}
