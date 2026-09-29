import type { Ref } from "react";
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  MeshStandardMaterial,
  SphereGeometry,
} from "three";
import { shared, surfaceMaterial } from "./shared";

/** Village fixtures: the storage chest and Maro's merchant stall. Pure
 * presentation — world/villageProps.tsx owns the interaction prompts and the
 * lantern light, and animates through refs. Origins are on the ground;
 * callers position and rotate the whole fixture. */

const plankMat = shared(() => surfaceMaterial("planks"));
const plankRoughMat = shared(() => surfaceMaterial("planks", { roughness: 0.9 }));
const ironMat = shared(
  () => new MeshStandardMaterial({ color: "#3a3a46", metalness: 0.7, roughness: 0.35 }),
);
const woodMat = shared(() => new MeshStandardMaterial({ color: "#3d2c1c", roughness: 0.9 }));

// ── Storage chest ────────────────────────────────────────────────────────────

const chestBodyGeo = shared(() => new BoxGeometry(1.1, 0.64, 0.7));
const chestBandGeo = shared(() => new BoxGeometry(0.08, 0.66, 0.72));
const chestLidGeo = shared(() => new BoxGeometry(1.1, 0.18, 0.7));
const chestGlintGeo = shared(() => new BoxGeometry(0.9, 0.04, 0.4));

/** The wizard's own chest. `lidRef` is the lid's hinge group (at the back
 * top edge); rotate it on X (negative = open) to creak it open. */
export function ChestModel({ lidRef }: { lidRef?: Ref<Group> }) {
  return (
    <group>
      {/* Body */}
      <mesh geometry={chestBodyGeo()} material={plankMat()} position={[0, 0.32, 0]} castShadow receiveShadow />
      {/* Metal bands */}
      {[-0.36, 0.36].map((x) => (
        <mesh key={x} geometry={chestBandGeo()} material={ironMat()} position={[x, 0.32, 0]} />
      ))}
      {/* Lid, hinged at the back edge */}
      <group ref={lidRef} position={[0, 0.64, -0.35]}>
        <mesh geometry={chestLidGeo()} material={plankMat()} position={[0, 0.09, 0.35]} castShadow />
      </group>
      {/* Warm glint from inside */}
      <mesh geometry={chestGlintGeo()} position={[0, 0.62, 0.12]}>
        <meshStandardMaterial
          color="#100800"
          emissive="#ffbf5e"
          emissiveIntensity={1.4}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

// ── Merchant stall ───────────────────────────────────────────────────────────

const counterGeo = shared(() => new BoxGeometry(2.4, 0.14, 0.7));
const counterLegGeo = shared(() => new BoxGeometry(0.14, 0.56, 0.6));
const postGeo = shared(() => new CylinderGeometry(0.05, 0.06, 2.5, 6));
const canopyGeo = shared(() => new BoxGeometry(2.7, 0.06, 1.7));
const canopyMat = shared(() => new MeshStandardMaterial({ color: "#5a2c34", roughness: 0.95 }));
const lanternGeo = shared(() => new BoxGeometry(0.16, 0.22, 0.16));
const bottleGeo = shared(() => new ConeGeometry(0.09, 0.24, 6));
const featherGeo = shared(() => new ConeGeometry(0.04, 0.3, 4));
const robeGeo = shared(() => new ConeGeometry(0.45, 1.5, 8));
const headGeo = shared(() => new SphereGeometry(0.22, 8, 6));
const hatGeo = shared(() => new ConeGeometry(0.32, 0.62, 8));

/** Maro the Provisioner's stall: counter, awning, a hanging lantern, wares,
 * and Maro himself behind the counter. `bodyRef` is Maro's group (behaviour
 * sways him). The lantern sits at (0, 1.9, 0.6) — where the caller's light
 * belongs. */
export function MerchantStallModel({ bodyRef }: { bodyRef?: Ref<Group> }) {
  return (
    <group>
      {/* Counter */}
      <mesh geometry={counterGeo()} material={plankMat()} position={[0, 0.55, 0.9]} castShadow receiveShadow />
      {[-1, 1].map((x) => (
        <mesh key={x} geometry={counterLegGeo()} material={plankRoughMat()} position={[x, 0.28, 0.9]} castShadow />
      ))}
      {/* Awning posts + canopy */}
      {[-1.15, 1.15].map((x) => (
        <mesh key={x} geometry={postGeo()} material={woodMat()} position={[x, 1.25, 1.15]} castShadow />
      ))}
      <mesh geometry={canopyGeo()} material={canopyMat()} position={[0, 2.5, 0.55]} rotation={[0.5, 0, 0]} castShadow />
      {/* Hanging lantern */}
      <mesh geometry={lanternGeo()} position={[0, 1.9, 0.6]}>
        <meshStandardMaterial
          color="#100800"
          emissive="#ffb45e"
          emissiveIntensity={2.6}
          toneMapped={false}
        />
      </mesh>
      {/* Wares on the counter (potion bottles + a feather glint) */}
      <mesh geometry={bottleGeo()} position={[-0.6, 0.72, 0.9]}>
        <meshStandardMaterial color="#200008" emissive="#ff5d6e" emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
      <mesh geometry={bottleGeo()} position={[-0.3, 0.72, 1]}>
        <meshStandardMaterial color="#000818" emissive="#4f9dff" emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
      <mesh geometry={featherGeo()} position={[0.45, 0.68, 0.95]} rotation={[0.3, 0.5, 1.2]}>
        <meshStandardMaterial color="#403008" emissive="#ffe9a8" emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      {/* Maro himself, behind the counter */}
      <group ref={bodyRef}>
        <mesh geometry={robeGeo()} position={[0, 0.65, 0]} castShadow>
          <meshStandardMaterial color="#6a4a2c" roughness={0.85} />
        </mesh>
        <mesh geometry={headGeo()} position={[0, 1.5, 0]} castShadow>
          <meshStandardMaterial color="#d8b894" roughness={0.8} />
        </mesh>
        <mesh geometry={hatGeo()} position={[0, 1.8, 0]} castShadow>
          <meshStandardMaterial color="#6a4a2c" roughness={0.9} />
        </mesh>
      </group>
    </group>
  );
}
