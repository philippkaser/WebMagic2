import { useGame } from "../../../state/gameStore";
import { RuneField } from "../../RuneField";
import { measureText } from "../../text/RuneText";
import { NAME_MAX, sanitizeNameDraft } from "./menuText";

/** Your name, written in the grimoire's name field — the display name
 * floor-mates see (never the ledger's username). Click it to write a new
 * one: Enter or clicking away carves it (setPlayerName), Escape leaves the
 * old one standing. An in-world RuneField (RuneField.tsx). */
export function NamePlaque({
  px,
  width,
  position,
  onEditingChange,
}: {
  /** Font pixel of the name. */
  px: number;
  /** Plaque width (default: room for the longest name). */
  width?: number;
  position?: readonly [number, number, number];
  onEditingChange?: (editing: boolean) => void;
}) {
  const playerName = useGame((s) => s.playerName);
  return (
    <RuneField
      value={playerName}
      px={px}
      width={width ?? measureText("M".repeat(NAME_MAX), px).width + px * 16}
      position={position}
      onCommit={(text) => useGame.getState().setPlayerName(text)}
      onEditingChange={onEditingChange}
      sanitize={sanitizeNameDraft}
      maxLength={NAME_MAX}
      label="Your wizard name"
      autoCapitalize="words"
    />
  );
}
