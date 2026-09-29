import { MeshStandardMaterial, type MeshStandardMaterialParameters } from "three";
import type { Ref } from "react";
import { getSurface, type SurfaceKind } from "../textures";

/** Helpers for presentational models.
 *
 * Models here are pure presentation: geometry, materials and idle animation.
 * Behaviour (physics, networking, interaction, lights that mean something)
 * lives with the caller in world/ and drives the model through refs.
 *
 * Geometry and static materials are built once, lazily (after the DOM exists
 * — textures need a canvas), and shared by every instance: a floor with forty
 * crates uploads one crate box, not forty. They're passed as props, which
 * R3F never disposes on unmount, so sharing is safe. */

/** A lazily-built singleton. */
export function shared<T>(build: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= build());
}

/** A static material painted with a surface's maps and recommended params,
 * plus optional overrides (e.g. a tint). */
export function surfaceMaterial(
  kind: SurfaceKind,
  overrides: MeshStandardMaterialParameters = {},
): MeshStandardMaterial {
  return new MeshStandardMaterial({ ...getSurface(kind).material, ...overrides });
}

/** Point a caller's ref (object or callback) at a value the model built
 * itself — for materials created in useMemo rather than JSX. */
export function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (!ref) return;
  if (typeof ref === "function") ref(value);
  else ref.current = value;
}
