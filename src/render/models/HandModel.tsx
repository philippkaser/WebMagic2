import { useMemo } from "react";
import { BoxGeometry, CylinderGeometry, Group, SphereGeometry } from "three";
import { dimTree, lathe, part, std } from "./kit";

/** The first-person gloved fist and sleeve. Origin is the center of the
 * grip (the staff shaft runs along local Y through it); the forearm trails
 * off toward the camera's lower right. */

const GLOVE = "#3b2a20";

const geos = {
  palm: new BoxGeometry(0.05, 0.075, 0.05),
  finger: new BoxGeometry(0.056, 0.017, 0.022),
  knuckle: new BoxGeometry(0.06, 0.07, 0.016),
  thumb: new BoxGeometry(0.018, 0.045, 0.02),
  cuff: new CylinderGeometry(0.038, 0.034, 0.05, 7, 1, true),
  cuffRim: new CylinderGeometry(0.041, 0.041, 0.012, 7),
  forearm: new CylinderGeometry(0.03, 0.036, 0.14, 7),
  bead: new SphereGeometry(0.006, 4, 3),
  // A bell sleeve: narrow at the wrist, flaring into loose folds.
  sleeve: lathe(
    [
      [0.034, 0],
      [0.05, -0.05],
      [0.07, -0.16],
      [0.09, -0.3],
      [0.1, -0.42],
    ],
    8,
  ),
};

function buildHand(sleeveColor: string): Group {
  const glove = std(GLOVE, { tex: "leather", roughness: 0.7 });
  const cloth = std(sleeveColor, { tex: "cloth", roughness: 0.95, doubleSide: true });
  const brass = std("#b08a48", { metalness: 0.85, roughness: 0.35 });

  // Fist wrapped around a vertical shaft: palm on the right, four finger
  // bands curling across the front, thumb hooked over the top finger.
  const fist = new Group();
  fist.add(part(geos.palm, glove, [0.034, 0, 0.004], [0, 0, 0], 1, false));
  for (let i = 0; i < 4; i++) {
    const y = 0.027 - i * 0.018;
    fist.add(part(geos.finger, glove, [0.004, y, 0.026], [0, 0, 0], [1 - i * 0.07, 1, 1], false));
  }
  fist.add(part(geos.knuckle, glove, [0.03, 0.002, -0.022], [0, 0.25, 0], 1, false));
  fist.add(part(geos.thumb, glove, [0.012, 0.048, 0.02], [0, 0, -1.0], 1, false));
  fist.add(part(geos.bead, brass, [0.037, 0.02, -0.032], [0, 0, 0], 1, false)); // signet stud

  // Forearm trailing down-right toward the camera.
  const arm = new Group();
  arm.position.set(0.045, -0.02, 0.01);
  arm.rotation.set(-0.95, 0, 0.62);
  arm.add(part(geos.forearm, glove, [0, -0.07, 0], [0, 0, 0], 1, false));
  arm.add(part(geos.cuff, glove, [0, -0.07, 0], [0, 0, 0], 1, false));
  arm.add(part(geos.cuffRim, brass, [0, -0.045, 0], [0, 0, 0], 1, false));
  arm.add(part(geos.sleeve, cloth, [0, -0.09, 0], [0, 0, 0], 1, false));

  return new Group().add(fist, arm);
}

export function HandModel({ sleeveColor, dim = 1 }: { sleeveColor: string; dim?: number }) {
  const hand = useMemo(() => {
    const h = buildHand(sleeveColor);
    if (dim !== 1) dimTree(h, dim);
    return h;
  }, [sleeveColor, dim]);
  return <primitive object={hand} />;
}
