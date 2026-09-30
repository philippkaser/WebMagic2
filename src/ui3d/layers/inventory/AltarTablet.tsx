import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Group } from "three";
import { pxFor } from "../../anchors";
import { useUiShow } from "../../presence";
import { Tablet } from "../../Tablet";
import { RuneText } from "../../text/RuneText";
import { GoldHoard } from "./GoldHoard";
import { useInventory } from "./interaction";
import { ALTAR, altarLayout, SCENE_DISTANCE, TEXT } from "./layout";
import { stoneMaterial } from "../../materials";
import { bronze, frameGeometry, INK, plane, slate } from "./materials";
import { Socket } from "./Socket";
import { WizardShrine } from "./WizardShrine";

const LABEL_PX = pxFor(SCENE_DISTANCE, TEXT.label);

/** Shallow slate trays sunk into the altar behind the belt and the bag, so
 * the two rows read as two things (Q/E are quick to hand; the bag is
 * carried). Their caption is carved at the tray's left end. */
function RowTrays({ spec }: { spec: ReturnType<typeof altarLayout> }) {
  const shown = useUiShow();
  const trays = useMemo(() => {
    const row = spec.sockets.filter((s) => s.variant === "belt" || s.variant === "bag");
    const span = (variant: string) => {
      const xs = row.filter((s) => s.variant === variant).map((s) => s.x);
      const half = ALTAR.rowSize / 2 + 0.035;
      return { x: (Math.min(...xs) + Math.max(...xs)) / 2, w: Math.max(...xs) - Math.min(...xs) + half * 2 };
    };
    return [span("belt"), span("bag")];
  }, [spec]);
  // From just above the sockets down past their carved numbers, so the
  // labels sit on the dark slate.
  const top = ALTAR.rowY + ALTAR.rowSize / 2 + 0.03;
  const bottom = ALTAR.rowY - ALTAR.rowSize / 2 - 0.02 - LABEL_PX * 7 - LABEL_PX * 5;
  const h = top - bottom;
  return (
    <group visible={shown}>
      {trays.map((t, i) => (
        <group key={i} position={[t.x, (top + bottom) / 2, 0]}>
          <mesh geometry={frameGeometry(t.w, h, 0.012, 0.006)} material={i === 0 ? bronze() : stoneMaterial("#5d5767")} />
          <mesh geometry={plane()} material={slate()} scale={[t.w, h, 1]} position={[0, 0, 0.0008]} />
        </group>
      ))}
    </group>
  );
}

/** Tells the scene when the altar's face is showing (the Tablet reveals its
 * children only once the stones have locked together). */
function ReadyFlag() {
  const ix = useInventory();
  const shown = useUiShow();
  useEffect(() => {
    ix.ready = shown;
  }, [ix, shown]);
  return null;
}

/** The altar: the tablet that is your inventory. Your wizard stands in a
 * niche at its heart, the four gear sockets flank the figure, the belt (Q/E)
 * and the bag's five sockets run along the bottom, and your gold lies in a
 * hollow in the corner. */
export function AltarTablet({ tilt = false }: { tilt?: boolean }) {
  const ix = useInventory();
  const spec = useMemo(() => altarLayout(), []);
  const face = useRef<Group>(null);
  useLayoutEffect(() => ix.registerSurface("altar", { spec, object: face.current! }), [ix, spec]);

  return (
    <Tablet width={spec.width} height={spec.height} tint="#4a4654" seed={3} tile={0.17} tilt={tilt}>
      <group ref={face}>
        <RuneText text="INVENTORY" px={pxFor(SCENE_DISTANCE, TEXT.title)} color={INK.bright} glow={0.9} position={[0, ALTAR.titleY, 0.002]} />
        <GoldHoard position={[ALTAR.goldX, ALTAR.titleY - 0.005, 0]} />
        <WizardShrine />
        <ReadyFlag />
        <RowTrays spec={spec} />
        {spec.sockets.map((s) => (
          <Socket key={s.key} spec={s} />
        ))}
      </group>
    </Tablet>
  );
}
