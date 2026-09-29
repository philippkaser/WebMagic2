import { Canvas, useFrame } from "@react-three/fiber";
import { useRef, type CSSProperties, type ReactNode } from "react";
import { Group } from "three";
import { getItemDef } from "../../items/catalog";
import { WizardModel } from "../../render/models/WizardModel";
import { useGame } from "../../state/gameStore";
import { palette } from "../theme";

/** The wizard, in the flesh. A tiny second R3F canvas: the SAME WizardModel
 * the multiplayer wizards use, on a slow turntable, dressed in what's
 * actually equipped. Rendered at low dpr + pixelated upscale so it matches
 * the game's look. */
export function WizardViewer() {
  const equipment = useGame((s) => s.equipment);
  const staffColor = getItemDef(equipment.staff.defId).color;
  const robeColor = equipment.cloak ? getItemDef(equipment.cloak.defId).color : "#4a4458";
  const bootsColor = equipment.boots ? getItemDef(equipment.boots.defId).color : null;
  const amuletColor = equipment.amulet ? getItemDef(equipment.amulet.defId).color : null;

  return (
    <div style={viewerStyle}>
      <Canvas
        dpr={0.5}
        gl={{ antialias: false, alpha: true }}
        camera={{ position: [0, 0.3, 3.6], fov: 44 }}
        style={{ width: "100%", height: "100%", imageRendering: "pixelated" }}
      >
        {/* Dressing-room lighting: brighter than the dungeon so you can
            actually admire the robe. */}
        <ambientLight intensity={1.15} color="#9aa0c8" />
        <directionalLight position={[2.5, 3, 2]} intensity={2.6} color="#ffd9a8" />
        <directionalLight position={[-3, 1, -2]} intensity={1} color="#46ffd0" />
        <Turntable>
          <WizardModel
            robeColor={robeColor}
            staffColor={staffColor}
            bootsColor={bootsColor}
            amuletColor={amuletColor}
          />
        </Turntable>
      </Canvas>
    </div>
  );
}

/** Slow spin plus a gentle bob, so the model reads as alive, not a render. */
function Turntable({ children }: { children: ReactNode }) {
  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    g.rotation.y = clock.elapsedTime * 0.6;
    g.position.y = 0.06 + Math.sin(clock.elapsedTime * 1.7) * 0.03;
  });
  return (
    <group ref={group} position={[0, 0.06, 0]}>
      {children}
    </group>
  );
}

const viewerStyle: CSSProperties = {
  width: 190,
  height: 210,
  flexShrink: 0,
  border: `1px solid ${palette.border}`,
  background:
    "radial-gradient(ellipse at 50% 62%, rgba(70,60,110,0.35), rgba(10,8,16,0.9) 70%)",
};
