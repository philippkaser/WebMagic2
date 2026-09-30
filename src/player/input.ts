import { useEffect } from "react";

/** Raw input singleton. Gameplay systems poll this each frame instead of
 * wiring DOM listeners everywhere. `consume` gives edge-triggered presses. */
/** How long a released-but-unpolled press still counts (see consume). */
const PRESS_GRACE_MS = 400;

class InputState {
  readonly keys = new Set<string>();
  /** Key code → when it went down (performance.now()), until consumed. */
  private pressed = new Map<string, number>();
  mouseLeft = false;
  mouseRight = false;

  down(code: string): boolean {
    return this.keys.has(code);
  }

  /** True once per physical key press. A press survives its own key-up for
   * a short grace window: on a slow frame a quick tap can go down AND up
   * between two polls, and dropping it would eat the player's input. Older
   * unconsumed presses expire, so a key tapped in a menu doesn't fire later
   * in play. */
  consume(code: string): boolean {
    const at = this.pressed.get(code);
    if (at === undefined) return false;
    this.pressed.delete(code);
    return this.keys.has(code) || performance.now() - at < PRESS_GRACE_MS;
  }

  handleKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    this.keys.add(e.code);
    this.pressed.set(e.code, performance.now());
  };

  handleKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
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
