import { styles } from "../theme";
import { OverlayShell } from "./OverlayShell";

/** Covers the scene while a floor is generated and its world mounts. */
export function LoadingOverlay() {
  return (
    <OverlayShell>
      <div style={styles.title}>DESCENDING…</div>
    </OverlayShell>
  );
}
