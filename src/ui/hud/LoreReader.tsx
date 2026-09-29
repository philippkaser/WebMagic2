import { useEffect, useState, type CSSProperties } from "react";
import { gameEvents } from "../../core/events";
import { getLoreFragment, type LoreFragment } from "../../world/lore";
import { FONT, palette } from "../theme";

/** A read carving rises in the middle of the screen, lingers long enough to
 * read at leisure, and fades. The world keeps moving underneath — reading on
 * a shared floor is a risk, like everything else down here. */
export function LoreReader() {
  const [shown, setShown] = useState<{ key: number; fragment: LoreFragment } | null>(null);

  useEffect(() => {
    let key = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = gameEvents.on("loreRead", ({ fragmentId }) => {
      const fragment = getLoreFragment(fragmentId);
      setShown({ key: ++key, fragment });
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => setShown(null), 9000);
    });
    return () => {
      off();
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  if (!shown) return null;
  return (
    <div key={shown.key} className="wm-lore" style={wrapStyle}>
      <div style={titleStyle}>{shown.fragment.title}</div>
      <div style={textStyle}>{shown.fragment.text}</div>
    </div>
  );
}

const wrapStyle: CSSProperties = {
  position: "absolute",
  top: "24%",
  left: "50%",
  transform: "translateX(-50%)",
  width: "min(560px, 80vw)",
  padding: "16px 22px",
  background: "rgba(10,6,18,0.82)",
  border: "1px solid #4a3a6a",
  boxShadow: "0 0 28px rgba(184,156,255,0.18)",
  textAlign: "center",
};

const titleStyle: CSSProperties = {
  fontFamily: FONT,
  fontSize: 12,
  letterSpacing: 3,
  color: "#b89cff",
  marginBottom: 10,
  textTransform: "uppercase",
};

const textStyle: CSSProperties = {
  fontFamily: "Georgia, 'Times New Roman', serif",
  fontStyle: "italic",
  fontSize: 16,
  lineHeight: 1.6,
  color: palette.bright,
};
