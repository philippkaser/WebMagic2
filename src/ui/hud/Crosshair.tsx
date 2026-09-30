import { useState } from "react";
import { Icon } from "../components/Icon";
import { useGameEvent } from "../hooks";
import { color } from "../theme";

/** Hit-marker colours: bone for monsters, violet for wizards, blood for a kill. */
const MARK = { enemy: "#f4ecd8", wizard: color.violet, kill: "#ff3b30" } as const;

let nextId = 1;

/** Pixel cross plus hit markers: four diagonal ticks that snap in on every
 * confirmed hit (bigger, red, with a skull on a kill). */
export function Crosshair() {
  const [mark, setMark] = useState<{ id: number; kind: keyof typeof MARK } | null>(null);
  useGameEvent("hitConfirm", ({ kind, killed }) => {
    setMark({ id: nextId++, kind: killed ? "kill" : kind });
  });
  return (
    <div className="wm-cross">
      <div className="wm-cross__dot" />
      <div className="wm-cross__arm" />
      <div className="wm-cross__arm" />
      <div className="wm-cross__arm" />
      <div className="wm-cross__arm" />
      {mark && (
        <div
          key={mark.id}
          className={`wm-hit${mark.kind === "kill" ? " wm-hit--kill" : ""}`}
          style={{ ["--hc" as string]: MARK[mark.kind] }}
          onAnimationEnd={() => setMark(null)}
        >
          <i />
          <i />
          <i />
          <i />
          {mark.kind === "kill" && <Icon name="skull" tint="#fff" scale={2} className="wm-hit__skull" />}
        </div>
      )}
    </div>
  );
}
