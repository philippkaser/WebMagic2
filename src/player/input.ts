import { useEffect } from "react";

/** Raw input singleton. Gameplay systems poll this each frame instead of
 * wiring DOM listeners everywhere. `consume` gives edge-triggered presses. */
class InputState {
  readonly keys = new Set<string>();
  private pressed = new Set<string>();
  mouseLeft = false;
  mouseRight = false;

  down(code: string): boolean {
    return this.keys.has(code);
  }

  /** True once per physical key press. */
  consume(code: string): boolean {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

  handleKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    this.keys.add(e.code);
    this.pressed.add(e.code);
  };

  handleKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    this.pressed.delete(e.code);
  };

  handleMouseDown = (e: MouseEvent) => {
    if (!document.pointerLockElement) return;
    if (e.button === 0) this.mouseLeft = true;
    if (e.button === 2) this.mouseRight = true;
  };

  handleMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseLeft = false;
    if (e.button === 2) this.mouseRight = false;
  };

  handleBlur = () => {
    this.keys.clear();
    this.pressed.clear();
    this.mouseLeft = false;
    this.mouseRight = false;
  };
}

export const input = new InputState();

/** Mount once near the app root. */
export function useInputListeners(): void {
  useEffect(() => {
    const preventContext = (e: Event) => e.preventDefault();
    window.addEventListener("keydown", input.handleKeyDown);
    window.addEventListener("keyup", input.handleKeyUp);
    window.addEventListener("mousedown", input.handleMouseDown);
    window.addEventListener("mouseup", input.handleMouseUp);
    window.addEventListener("blur", input.handleBlur);
    window.addEventListener("contextmenu", preventContext);
    return () => {
      window.removeEventListener("keydown", input.handleKeyDown);
      window.removeEventListener("keyup", input.handleKeyUp);
      window.removeEventListener("mousedown", input.handleMouseDown);
      window.removeEventListener("mouseup", input.handleMouseUp);
      window.removeEventListener("blur", input.handleBlur);
      window.removeEventListener("contextmenu", preventContext);
    };
  }, []);
}
