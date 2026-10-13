import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useImperativeHandle, useRef, useState, type RefObject } from "react";
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { playUiHover, playUiPress } from "../audio/uiSounds";
import { uiNow } from "./clock";
import { playCarve } from "./layers/menus/menuSounds";
import { Plate } from "./Plate";
import { useUiShow } from "./presence";
import { RuneText, measureText } from "./text/RuneText";
import { ink } from "./theme";

/** A field you write in, in the world (artpass `.wm-name`: a dark slot of
 * slate that turns arcane while you write) — click it and type.
 *
 * The world has no text fields, so typing goes through the one piece of DOM
 * the menus keep: a hidden, focused <input> per field (it brings the OS
 * keyboard on touch devices, IME, paste, key repeat — everything a real
 * field does; a `password` field is a real password input, so the browser
 * treats it as one). Its value is mirrored into the slab's runes as you
 * type, each new letter burning in behind a blinking cursor; a password
 * shows each letter as •, the newest as ✦. Keys never reach the game's
 * hotkeys (the input swallows them).
 *
 * Enter or clicking away ends the writing (`onCommit`, then `onEnter` for
 * Enter); Escape ends it without committing, so a field that only adopts
 * text on commit (the name plaque) keeps its old value; Tab calls `onTab`
 * (move to the next field). A form keeps its own state through `onInput`. */

export interface RuneFieldHandle {
  /** Start writing (focus the hidden input) — e.g. Tab from the field before. */
  focus(): void;
  blur(): void;
}

export interface RuneFieldProps {
  /** What the field holds while not being written. */
  value: string;
  /** Font pixel. */
  px: number;
  width: number;
  position?: readonly [number, number, number];
  /** Every keystroke, after `sanitize`. */
  onInput?: (text: string) => void;
  /** Writing ended by Enter or by clicking away (not by Escape). */
  onCommit?: (text: string) => void;
  /** Enter was pressed (after onCommit). */
  onEnter?: () => void;
  /** Tab was pressed (shift = backwards). The field lets go first. */
  onTab?: (back: boolean) => void;
  onEditingChange?: (editing: boolean) => void;
  /** Filter for what may be typed (default: anything). */
  sanitize?: (raw: string) => string;
  maxLength?: number;
  /** A secret: shown as • (the newest letter ✦), typed into a password input. */
  password?: boolean;
  /** Faded words shown while empty and not being written. */
  placeholder?: string;
  /** Marks the slab with blood (a refused value) while not being written. */
  invalid?: boolean;
  disabled?: boolean;
  /** The hidden input's accessible name, autocomplete and capitalisation. */
  label: string;
  autoComplete?: string;
  autoCapitalize?: string;
  handle?: RefObject<RuneFieldHandle | null>;
  /** Start writing as soon as the field can take it (it may still be
   * assembling); a new value starts writing again. */
  autoFocus?: boolean | string;
  /** The slab's look while untouched (default plain iron slate). */
  idleFrame?: string;
  /** Stagger the text in after the slab (seconds). */
  delay?: number;
}

const quad = new PlaneGeometry(1, 1);
/** The field's hit area and cursor: invisible / arcane, shared. */
const hitMaterial = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
const cursorMaterial = new MeshBasicMaterial({ color: ink.arcane, toneMapped: false });

/** What a password field shows for `n` letters. */
export function secretGlyphs(n: number, writing: boolean): string {
  if (n <= 0) return "";
  return writing ? "•".repeat(n - 1) + "✦" : "•".repeat(n);
}

export function RuneField({
  value,
  px,
  width,
  position,
  onInput,
  onCommit,
  onEnter,
  onTab,
  onEditingChange,
  sanitize = (s) => s,
  maxLength = 64,
  password = false,
  placeholder,
  invalid = false,
  disabled = false,
  label,
  autoComplete = "off",
  autoCapitalize = "off",
  handle,
  autoFocus = false,
  idleFrame = "iron",
  delay = 0.25,
}: RuneFieldProps) {
  const show = useUiShow();
  /** The text being written, or null while not writing. */
  const [draft, setDraft] = useState<string | null>(null);
  const [hover, setHover] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  // The input's listeners live for the field's life; they read the latest
  // callbacks through this ref.
  const props = useRef({ onInput, onCommit, onEnter, onTab, onEditingChange, sanitize, value });
  props.current = { onInput, onCommit, onEnter, onTab, onEditingChange, sanitize, value };

  // The hidden field lives exactly as long as the slab.
  useEffect(() => {
    const el = document.createElement("input");
    el.type = password ? "password" : "text";
    el.maxLength = maxLength;
    el.spellcheck = false;
    el.autocomplete = autoComplete as AutoFill;
    el.setAttribute("autocapitalize", autoCapitalize);
    el.setAttribute("aria-label", label);
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
    let entered = false;
    const onInputEvent = () => {
      const clean = props.current.sanitize(el.value);
      if (clean !== el.value) el.value = clean;
      setDraft(clean);
      props.current.onInput?.(clean);
      playCarve();
    };
    // Typing must never reach the game's hotkeys (C, I, O, P…), which all
    // listen on window: stop every key at the field.
    const stop = (e: KeyboardEvent) => e.stopPropagation();
    const onKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        entered = true;
        el.blur();
      } else if (e.key === "Escape") {
        cancelled = true;
        el.blur();
      } else if (e.key === "Tab") {
        e.preventDefault();
        const back = e.shiftKey;
        el.blur();
        props.current.onTab?.(back);
      }
    };
    const onBlur = () => {
      if (!cancelled) props.current.onCommit?.(el.value);
      const enter = entered && !cancelled;
      cancelled = false;
      entered = false;
      setDraft(null);
      props.current.onEditingChange?.(false);
      if (enter) props.current.onEnter?.();
    };
    el.addEventListener("input", onInputEvent);
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("keyup", stop);
    el.addEventListener("keypress", stop);
    el.addEventListener("blur", onBlur);
    document.body.appendChild(el);
    input.current = el;
    return () => {
      // Unmounted mid-edit (the screen moved on): what was typed still counts.
      if (document.activeElement === el) props.current.onCommit?.(el.value);
      el.removeEventListener("input", onInputEvent);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("keyup", stop);
      el.removeEventListener("keypress", stop);
      el.removeEventListener("blur", onBlur);
      el.remove();
      input.current = null;
    };
  }, [password, maxLength, autoComplete, autoCapitalize, label]);

  const active = show && !disabled;
  // Leaving the screen (or a lock) ends the edit.
  useEffect(() => {
    if (!active) input.current?.blur();
  }, [active]);
  useEffect(() => {
    if (!hover) return;
    document.body.style.cursor = "text";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hover]);

  const begin = () => {
    const el = input.current;
    // Already writing (a tap that didn't blur the field): keep the draft.
    if (!active || !el || document.activeElement === el) return;
    el.value = props.current.value;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    setDraft(el.value);
    props.current.onEditingChange?.(true);
  };
  useImperativeHandle(handle, () => ({ focus: begin, blur: () => input.current?.blur() }));
  // Once per autoFocus value: a field re-enabled after a request doesn't
  // grab the cursor back.
  const focusedFor = useRef<boolean | string>(false);
  useEffect(() => {
    if (!autoFocus) focusedFor.current = false;
    else if (active && focusedFor.current !== autoFocus) {
      focusedFor.current = autoFocus;
      begin();
    }
    // `begin` reads the latest state itself; only these say "start now".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, autoFocus]);

  const editing = draft !== null;
  const raw = draft ?? value;
  const empty = raw.length === 0;
  const shown = password ? secretGlyphs(raw.length, editing) : raw;
  const text = measureText(shown || " ", px);
  const h = measureText("Mg", px).height + px * 9;
  const frame = editing ? "arcane" : invalid ? "blood" : hover ? "#7d7288" : idleFrame;

  // The lift and the cursor blink run on refs.
  const cursor = useRef<Mesh>(null);
  const lift = useRef<Group>(null);
  const since = useRef(0);
  useEffect(() => {
    since.current = uiNow();
  }, [draft]);
  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * 12);
    const l = lift.current;
    if (l) l.position.z += ((hover || editing ? 0.008 : 0) - l.position.z) * k;
    const c = cursor.current;
    if (c) {
      // Solid while typing, then the classic 1 Hz blink.
      const t = uiNow() - since.current;
      c.visible = editing && show && (t < 0.5 || Math.floor(t * 2) % 2 === 0);
      c.position.x = (shown.length > 0 ? text.width / 2 : 0) + px * 2.5;
    }
  });

  return (
    <group position={position as [number, number, number] | undefined}>
      <group ref={lift}>
        <Plate width={width} height={h} frame={frame} texel={px * 1.25} fill="#0a070d" fillOpacity={0.96}>
          <mesh
            geometry={quad}
            material={hitMaterial}
            scale={[width, h, 1]}
            onPointerOver={(e) => {
              e.stopPropagation();
              if (!active) return;
              setHover(true);
              playUiHover();
            }}
            onPointerOut={() => setHover(false)}
            onPointerUp={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              if (!active || document.activeElement === input.current) return;
              playUiPress();
              begin();
            }}
          />
          {empty && !editing && placeholder ? (
            <RuneText text={placeholder} px={px} color={ink.faded} glow={0.15} position={[0, 0, 0.002]} depth={-0.3} delay={delay} />
          ) : (
            <RuneText
              text={shown}
              px={px}
              color={disabled ? ink.faded : password ? ink.arcane : ink.parchment}
              glow={editing ? 0.9 : 0.4}
              brightness={editing || hover ? 1.25 : 1}
              position={[0, 0, 0.002]}
              depth={-0.3}
              delay={delay}
            />
          )}
          <mesh ref={cursor} geometry={quad} material={cursorMaterial} scale={[px * 1.2, px * 8, 1]} position={[0, 0, 0.003]} visible={false} renderOrder={11} />
        </Plate>
      </group>
    </group>
  );
}
