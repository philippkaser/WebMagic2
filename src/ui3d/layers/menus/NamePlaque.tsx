import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial } from "three";
import { playUiHover, playUiPress } from "../../../audio/uiSounds";
import { useGame } from "../../../state/gameStore";
import { uiNow } from "../../clock";
import { glowMaterial, stoneMaterial } from "../../materials";
import { useUiShow } from "../../presence";
import { RuneText, measureText } from "../../text/RuneText";
import { playCarve } from "./menuSounds";
import { MENU_INK, NAME_MAX, sanitizeNameDraft } from "./menuText";

/** Your name, carved into a stone plaque — click it to carve a new one.
 *
 * The world has no text fields, so typing goes through the one piece of DOM
 * the menus keep: a hidden, focused <input> (it brings the OS keyboard on
 * touch devices, IME, paste, key repeat — everything a real field does).
 * Its value is mirrored into the plaque's runes as you type, each new
 * letter burning in behind a blinking cursor. Keys never reach the game's
 * hotkeys (the input swallows them); Enter or clicking away carves the name
 * (setPlayerName), Escape leaves the old one standing. */

const box = new BoxGeometry(1, 1, 1);

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
  const show = useUiShow();
  const playerName = useGame((s) => s.playerName);
  /** The name being typed, or null while not editing. */
  const [draft, setDraft] = useState<string | null>(null);
  const [hover, setHover] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const editingRef = useRef(onEditingChange);
  editingRef.current = onEditingChange;

  // The hidden field lives exactly as long as the plaque.
  useEffect(() => {
    const el = document.createElement("input");
    el.type = "text";
    el.maxLength = NAME_MAX;
    el.spellcheck = false;
    el.autocomplete = "off";
    el.setAttribute("autocapitalize", "words");
    el.setAttribute("aria-label", "Your wizard name");
    // Invisible but focusable, and 16px so iOS doesn't zoom to it.
    Object.assign(el.style, {
      position: "fixed",
      left: "50%",
      top: "45%",
      width: "1px",
      height: "1px",
      opacity: "0",
      pointerEvents: "none",
      border: "0",
      padding: "0",
      fontSize: "16px",
      zIndex: "-1",
    } satisfies Partial<CSSStyleDeclaration>);
    let cancelled = false;
    const onInput = () => {
      const clean = sanitizeNameDraft(el.value);
      if (clean !== el.value) el.value = clean;
      setDraft(clean);
      playCarve();
    };
    // Typing must never reach the game's hotkeys (C, I, O, P…), which all
    // listen on window: stop every key at the field.
    const stop = (e: KeyboardEvent) => e.stopPropagation();
    const onKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter") el.blur();
      else if (e.key === "Escape") {
        cancelled = true;
        el.blur();
      }
    };
    const onBlur = () => {
      if (!cancelled) useGame.getState().setPlayerName(el.value);
      cancelled = false;
      setDraft(null);
      editingRef.current?.(false);
    };
    el.addEventListener("input", onInput);
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("keyup", stop);
    el.addEventListener("keypress", stop);
    el.addEventListener("blur", onBlur);
    document.body.appendChild(el);
    input.current = el;
    return () => {
      // Unmounted mid-edit (the phase moved on): what was typed still counts.
      if (document.activeElement === el) useGame.getState().setPlayerName(el.value);
      el.removeEventListener("input", onInput);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("keyup", stop);
      el.removeEventListener("keypress", stop);
      el.removeEventListener("blur", onBlur);
      el.remove();
      input.current = null;
    };
  }, []);

  // Leaving the menu ends the edit.
  useEffect(() => {
    if (!show) input.current?.blur();
  }, [show]);
  useEffect(() => {
    if (!hover) return;
    document.body.style.cursor = "text";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hover]);

  const editing = draft !== null;
  const shown = draft ?? playerName;
  const text = measureText(shown || " ", px);
  const w = width ?? measureText("M".repeat(NAME_MAX), px).width + px * 16;
  const h = text.height + px * 12;

  const begin = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const el = input.current;
    // Already carving (a tap that didn't blur the field): keep the draft.
    if (!show || !el || document.activeElement === el) return;
    playUiPress();
    el.value = useGame.getState().playerName;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    setDraft(el.value);
    editingRef.current?.(true);
  };

  // Seam light and the cursor blink run on refs.
  const seam = useMemo(
    () =>
      new MeshStandardMaterial({
        color: "#050407",
        emissive: new Color(MENU_INK.accent),
        emissiveIntensity: 0.4,
        toneMapped: false,
      }),
    [],
  );
  useEffect(() => () => seam.dispose(), [seam]);
  const cursor = useRef<Mesh>(null);
  const lift = useRef<Group>(null);
  const glow = useRef(0.4);
  const since = useRef(0);
  useEffect(() => {
    since.current = uiNow();
  }, [draft]);
  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * 12);
    glow.current += ((editing ? 2.2 + Math.sin(uiNow() * 4) * 0.4 : hover ? 1.8 : 0.45) - glow.current) * k;
    seam.emissiveIntensity = glow.current;
    const l = lift.current;
    if (l) {
      l.position.z += ((hover || editing ? 0.01 : 0) - l.position.z) * k;
      // Like a RuneButton: the plaque only stands while its tablet does.
      const s = l.scale.x + ((show ? 1 : 0) - l.scale.x) * (1 - Math.exp(-dt * (show ? 9 : 14)));
      l.scale.setScalar(Math.max(0.0001, s));
      l.visible = s > 0.01;
    }
    const c = cursor.current;
    if (c) {
      // Solid while typing, then the classic 1 Hz blink.
      const t = uiNow() - since.current;
      c.visible = editing && show && (t < 0.5 || Math.floor(t * 2) % 2 === 0);
      c.position.x = (shown.length > 0 ? text.width / 2 : 0) + px * 3;
    }
  });

  return (
    <group position={position as [number, number, number] | undefined}>
      <group ref={lift} scale={0.0001}>
        {/* Seam: a dark plate whose emissive edge glows around the plaque. */}
        <mesh geometry={box} material={seam} scale={[w + px * 3, h + px * 3, 0.012]} position={[0, 0, -0.007]} />
        <mesh
          geometry={box}
          material={stoneMaterial("#3d3846")}
          scale={[w, h, 0.022]}
          onPointerOver={(e) => {
            e.stopPropagation();
            if (!show) return;
            setHover(true);
            playUiHover();
          }}
          onPointerOut={() => setHover(false)}
          onPointerUp={begin}
        />
        {/* The carved slot the letters sit in. */}
        <mesh geometry={box} material={stoneMaterial("#1c1822")} scale={[w - px * 6, h - px * 5, 0.004]} position={[0, 0, 0.0115]} />
        <RuneText
          text={shown}
          px={px}
          color={editing ? "#ffffff" : MENU_INK.bright}
          glow={editing ? 1.5 : 1}
          brightness={hover && !editing ? 1.3 : 1}
          position={[0, 0, 0.014]}
          depth={-0.3}
        />
        <mesh ref={cursor} geometry={box} material={glowMaterial(MENU_INK.accent, 3)} scale={[px * 1.2, px * 9, 0.004]} position={[0, -px * 0.5, 0.015]} visible={false} />
      </group>
    </group>
  );
}
