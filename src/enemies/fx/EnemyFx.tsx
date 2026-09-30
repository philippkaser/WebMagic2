import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { devStage } from "../shared";
import { GibSystem } from "./gibs";
import { HazardSystem } from "./hazards";

/** The bestiary's shared world effects — pooled death debris and lingering
 * ground hazards. Mounted once per dungeon floor. */
export function EnemyFx() {
  useBestiaryDevHook();
  return (
    <>
      <GibSystem />
      <HazardSystem />
    </>
  );
}

/** Dev-only: aim the camera and calm the brains, for staging enemy shots. */
function useBestiaryDevHook() {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (!import.meta.env?.DEV) return;
    const w = window as unknown as Record<string, unknown>;
    w.__bestiary = {
      look: (x: number, y: number, z: number) => camera.lookAt(x, y, z),
      calm: (on: boolean) => void (devStage.calm = on),
    };
    return () => void delete w.__bestiary;
  }, [camera]);
}
