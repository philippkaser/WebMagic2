import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, CylinderGeometry, MeshStandardMaterial, TorusGeometry, Vector3, type Group } from "three";
import { resolveItem } from "../../../items/catalog";
import type { ItemStack } from "../../../items/types";
import { useGame } from "../../../state/gameStore";
import { palette } from "../../../ui/theme";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { ItemModel } from "../../ItemModel";
import { stoneMaterial } from "../../materials";
import { RuneText } from "../../text/RuneText";
import { emitUiSparks } from "../../UiSparks";
import { glowQuad, makeGlowMaterial } from "./glow";
import { HudAnchor, hudUnit, Undistort } from "./HudAnchor";
import { HUD_LAYOUT } from "./layout";
import { Materialize } from "./Materialize";
import { usePresenceList } from "./usePresenceList";
import { useEntryDelay } from "./useSettled";

/** The belt: two stone sockets carried beside the flasks, each cradling the
 * consumable bound to its key — the potion itself, hovering and turning
 * slowly over a faintly lit ring. The key rune is carved under the socket,
 * the stack count hangs by the item. Using one makes it flare; swapping
 * one out makes the old one burn away as the new one arrives. */

const L = HUD_LAYOUT.belt;
const U = hudUnit(L.distance);
const GAP = 0.078 * U;
const SOCKET_R = 0.024 * U;
const KEY_PX = pxFor(L.distance, 0.019);
const COUNT_PX = pxFor(L.distance, 0.018);
const tmp = new Vector3();

let socketGeo: { plinth: CylinderGeometry; ring: TorusGeometry } | null = null;
function geometry() {
  return (socketGeo ??= {
    // An octagonal stone plinth, a little wider at the foot.
    plinth: new CylinderGeometry(1, 1.12, 0.4, 8),
    ring: new TorusGeometry(0.64, 0.075, 6, 28),
  });
}

export function Belt() {
  const belt = useGame((s) => s.belt);
  return (
    <HudAnchor h={L.h} v={L.v} inset={L.inset} distance={L.distance}>
      <Socket hotkey="Q" stack={belt[0] ?? null} x={SOCKET_R} />
      <Socket hotkey="E" stack={belt[1] ?? null} x={SOCKET_R + GAP} />
    </HudAnchor>
  );
}

function Socket({ hotkey, stack, x }: { hotkey: string; stack: ItemStack | null; x: number }) {
  const g = geometry();
  const defId = stack?.defId ?? null;
  const item = useMemo(() => (defId ? resolveItem(defId) : null), [defId]);
  const color = item?.def.color ?? palette.slotEmpty;
  // The inlay is lit from within: emissive, animated per socket.
  const ringMat = useMemo(
    () => new MeshStandardMaterial({ color: "#050407", emissive: new Color(color), emissiveIntensity: 0.6, toneMapped: false, roughness: 0.4 }),
    [color],
  );
  const pool = useMemo(() => makeGlowMaterial(color, 0.35), [color]);
  useEffect(
    () => () => {
      ringMat.dispose();
      pool.dispose();
    },
    [ringMat, pool],
  );
  const { entries, remove } = usePresenceList(defId, defId);
  const qty = stack?.qty ?? 0;
  const lastQty = useRef(qty);
  // The count dissolves when one is left; it keeps its last number meanwhile.
  const countShown = useRef(qty);
  if (qty > 1) countShown.current = qty;
  const flare = useRef(0);
  const hover = useRef<Group>(null);
  const seed = hotkey.charCodeAt(0);
  const d = useEntryDelay(0.6);

  // Fewer than before, same potion: it was used — a flare and a puff.
  useEffect(() => {
    if (qty < lastQty.current && hover.current) {
      flare.current = uiNow();
      const p = hover.current.getWorldPosition(tmp);
      emitUiSparks({ position: [p.x, p.y, p.z], color, count: 14, speed: 0.06, up: 0.05, size: 0.004, spread: 0.02, ttl: 0.8 });
    }
    lastQty.current = qty;
  }, [qty, color]);

  useFrame(() => {
    const now = uiNow();
    const since = now - flare.current;
    const f = since < 0.8 ? Math.exp(-since * 5) : 0;
    ringMat.emissiveIntensity = (item ? 1.1 + Math.sin(now * 2 + seed) * 0.25 : 0.25) + f * 3;
    pool.uniforms.uIntensity.value = (item ? 0.3 : 0.08) + f * 1.2;
    const h = hover.current;
    if (h) {
      h.position.y = SOCKET_R * 1.45 + Math.sin(now * 1.6 + seed) * SOCKET_R * 0.08;
      h.rotation.y = now * 0.7 + seed;
    }
  });

  return (
    <group position={[x, 0, 0]}>
      <Undistort at={[0, SOCKET_R * 0.3, 0]}>
        <Materialize delay={0.3 + (hotkey === "E" ? 0.1 : 0)} color={color} size={SOCKET_R * 1.5} from={[0, -SOCKET_R, -SOCKET_R * 4]} spin={1.2}>
          {/* The socket: a squat stone plinth tipped toward the eye with a
              lit ring set into its top, and a pool of the item's light
              hanging over it. */}
          <group rotation={[0.62, 0, 0]} scale={SOCKET_R}>
            <mesh geometry={g.plinth} material={stoneMaterial("#5d5768")} />
            <mesh geometry={g.ring} material={ringMat} position={[0, 0.2, 0]} rotation={[Math.PI / 2, 0, 0]} />
          </group>
          <mesh geometry={glowQuad()} material={pool} position={[0, SOCKET_R * 1.5, -SOCKET_R * 0.5]} scale={SOCKET_R * 3.4} renderOrder={2} />
          <group ref={hover}>
            {entries.map((e) => (
              <Materialize key={e.id} show={e.shown} color={color} size={SOCKET_R} from={[0, SOCKET_R * 1.5, -SOCKET_R * 2]} onHidden={() => remove(e.id)}>
                <ItemModel itemId={e.value} scale={SOCKET_R * 2.5} />
              </Materialize>
            ))}
          </group>
        </Materialize>
      </Undistort>
      <RuneText
        text={hotkey}
        px={KEY_PX}
        color={item ? palette.accent : palette.faint}
        glow={item ? 0.9 : 0.3}
        outline={0.6}
        position={[0, -SOCKET_R * 0.75, SOCKET_R]}
        delay={0.5}
      />
      {/* Stack count by the item; a faint dot over an empty socket. */}
      <RuneText
        text={`${countShown.current}`}
        show={qty > 1}
        px={COUNT_PX}
        color={palette.item}
        anchor={[0, 0.5]}
        align="left"
        glow={0.6}
        outline={0.6}
        position={[SOCKET_R * 1.1, SOCKET_R * 2.5, SOCKET_R]}
        inDuration={0.3}
        delay={d}
      />
      <RuneText text="·" show={!item} px={KEY_PX} color={palette.faint} glow={0.4} position={[0, SOCKET_R * 1.6, SOCKET_R]} delay={0.6} />
    </group>
  );
}
