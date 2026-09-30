import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { BoxGeometry, CylinderGeometry, Group, OctahedronGeometry, PlaneGeometry, Vector3, type Material } from "three";
import { useCodex } from "../../../state/codex";
import { useGame } from "../../../state/gameStore";
import { BIOME_DEFS, biomeForFloor } from "../../../world/biomes";
import { allLoreFragments, getLoreFragment } from "../../../world/lore";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { glowMaterial, metalMaterial } from "../../materials";
import { UiPresence, UiShow, useUiShow } from "../../presence";
import { RuneButton } from "../../RuneButton";
import { TABLET_EXIT } from "../../Tablet";
import { RuneText } from "../../text/RuneText";
import { emitUiSparks } from "../../UiSparks";
import { codexSpreads, CODEX_INK, type CodexPage, type CodexSpread } from "./codexPages";
import { playBookClose, playBookOpen, playPageTurn } from "./menuSounds";
import { MENU_INK } from "./menuText";
import { screenUnit, smooth01, Stage, Veil } from "./stage";
import { tomeMaterials } from "./tomeMaterials";

/** The codex (C): a tome of dark vellum that rises out of the dark before
 * you, its cover swinging open to the carvings you have read, written in
 * glowing ink and grouped by the depths they speak from (codexPages.ts).
 *
 * Turning a page is a page turning: the leaf lifts off the right-hand page
 * toward you and swings over the spine, the words on it burning away as it
 * goes and the next ones writing themselves onto the vellum it uncovers and
 * the side it lands on. Turn with the ← / → plaques below, by clicking a
 * page, or with the arrow keys; C or Escape shuts the book, which drops away
 * into the dark (within TABLET_EXIT, like every menu).
 *
 * The book remembers the spread it was left open at for the session. */

const D = 1.4;
const U = screenUnit(D);
const px = (cap: number) => pxFor(D, cap);

/** Characters per line and body lines per page — the pagination's page. */
const PAGE_SIZE = { cols: 30, lines: 16 } as const;
const BODY_CAP = 0.0185;
const PAGE_W = 0.54 * U;
const PAGE_H = 0.62 * U;
/** The shallow V of an open book: each page rises from the gutter. */
const V = 0.09;
const BLOCK_T = 0.016 * U;
const COVER_T = 0.009 * U;
const COVER_M = 0.016 * U;
const BOOK_Y = 0.04 * U;
const BOOK_TILT = -0.12;

/** Seconds: the book's entrance and exit. */
const ENTER = { fly: 0.45, open: 0.5, content: 0.95 } as const;
const EXIT = { close: 0.2, closeDur: 0.35, drop: 0.55, dropDur: 0.5 } as const;
const TURN = { lift: 0.06, dur: 0.55 } as const;

let rememberedSpread = 0;

export function CodexTome() {
  const phase = useGame((s) => s.phase);
  const overlay = useGame((s) => s.overlay);
  const open = overlay === "codex" && (phase === "village" || phase === "dungeon");
  return (
    <UiPresence show={open} exit={TABLET_EXIT}>
      <Veil color="#05030b" strength={0.74} center={0.45} />
      <Stage distance={D} width={1.24}>
        <Tome />
      </Stage>
    </UiPresence>
  );
}

// ── Geometry (shared) ────────────────────────────────────────────────────────

const box = new BoxGeometry(1, 1, 1);
const spineGeo = new CylinderGeometry(1, 1, 1, 12, 1, false, Math.PI / 2, Math.PI);
const leafGeo = new PlaneGeometry(1, 1).translate(0.5, 0, 0);
const gem = new OctahedronGeometry(1, 0);

interface Face {
  id: number;
  spread: number;
  shown: boolean;
  delayL: number;
  delayR: number;
}

let faceId = 1;

function Tome() {
  const show = useUiShow();
  const read = useCodex((s) => s.read);
  const setOverlay = useGame((s) => s.setOverlay);
  const spreads = useMemo<CodexSpread[]>(
    () => codexSpreads(read.map(getLoreFragment), allLoreFragments().length, BIOME_DEFS, biomeForFloor, PAGE_SIZE),
    [read],
  );
  const last = spreads.length - 1;
  const [spread, setSpread] = useState(() => Math.min(rememberedSpread, last));
  const [faces, setFaces] = useState<Face[]>(() => [{ id: 0, spread: Math.min(rememberedSpread, last), shown: true, delayL: 0, delayR: 0 }]);
  const [contentOn, setContentOn] = useState(false);
  const flip = useRef({ dir: 0, at: -100 });

  // New fragments read while open (or fewer spreads): keep the index valid.
  useEffect(() => {
    if (spread > last) turnTo(last, -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last]);

  // The words appear once the cover is open.
  useEffect(() => {
    if (!show) return;
    playBookOpen();
    const t = setTimeout(() => setContentOn(true), ENTER.content * 1000);
    return () => clearTimeout(t);
  }, [show]);
  useEffect(() => {
    if (!show) setTimeout(playBookClose, (EXIT.close + EXIT.closeDur) * 1000);
  }, [show]);

  function turnTo(next: number, dir: number) {
    setSpread(next);
    rememberedSpread = next;
    flip.current = { dir, at: uiNow() };
    playPageTurn();
    // The page being turned burns off at once; the page it uncovers writes
    // itself while the leaf is in the air, the page it lands on after.
    const uncover = 0.22;
    const land = TURN.lift + TURN.dur * 0.85;
    setFaces((prev) => [
      ...prev.map((f) => (f.shown ? { ...f, shown: false } : f)),
      { id: faceId++, spread: next, shown: true, delayL: dir > 0 ? land : uncover, delayR: dir > 0 ? uncover : land },
    ]);
  }
  const turn = (dir: number) => {
    if (!show || !contentOn) return;
    const next = Math.max(0, Math.min(last, spread + dir));
    if (next !== spread) turnTo(next, dir);
  };
  const turnRef = useRef(turn);
  turnRef.current = turn;

  // Keys: arrows / page keys turn, Escape closes (the browser has already
  // spent Escape on the pointer lock by the time a screen is open).
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") setOverlay("none");
      else if (e.code === "ArrowRight" || e.code === "PageDown") turnRef.current(1);
      else if (e.code === "ArrowLeft" || e.code === "PageUp") turnRef.current(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, setOverlay]);

  // A dissolved face leaves once both its pages have burnt away.
  useEffect(() => {
    const gone = faces.filter((f) => !f.shown);
    if (gone.length === 0) return;
    const t = setTimeout(() => setFaces((prev) => prev.filter((f) => f.shown || !gone.some((g) => g.id === f.id))), 1300);
    return () => clearTimeout(t);
  }, [faces]);

  // ── Motion: all through refs ──
  const book = useRef<Group>(null);
  const left = useRef<Group>(null);
  const leaf = useRef<Group>(null);
  const since = useRef(uiNow());
  const exitFrom = useRef({ y: 0, open: 0 });
  const state = useRef({ y: -1, open: 0 });
  const sparked = useRef(false);
  useEffect(() => {
    since.current = uiNow();
    exitFrom.current = { ...state.current };
    sparked.current = false;
  }, [show]);
  const tmp = useMemo(() => new Vector3(), []);
  const P = useMemo<[number, number, number]>(() => [0, 0, 0], []);

  useFrame(() => {
    const now = uiNow();
    const t = now - since.current;
    const st = state.current;
    if (show) {
      const f = Math.min(1, t / ENTER.fly);
      st.y = -(1 - f) * (1 - f) * (1 - f); // 1 → 0, ease-out
      st.open = smooth01((t - ENTER.fly + 0.05) / ENTER.open);
    } else {
      st.open = exitFrom.current.open * (1 - smooth01((t - EXIT.close) / EXIT.closeDur));
      const d = Math.max(0, (t - EXIT.drop) / EXIT.dropDur);
      st.y = exitFrom.current.y - d * d;
    }
    const b = book.current;
    if (b) {
      b.position.y = BOOK_Y + st.y * 0.9 * U;
      b.rotation.x = BOOK_TILT + st.y * 1.1;
      b.rotation.z = st.y * 0.25;
      b.position.z = -st.y * 0.3;
      // The slam: embers shake loose from the edges as it falls.
      if (!show && !sparked.current && st.open < 0.02 && t > EXIT.close) {
        sparked.current = true;
        for (let sx = -1; sx <= 1; sx += 2) {
          tmp.set(sx * PAGE_W * 0.9, 0, 0);
          b.localToWorld(tmp);
          P[0] = tmp.x;
          P[1] = tmp.y;
          P[2] = tmp.z;
          emitUiSparks({ position: P, color: CODEX_INK.head, count: 14, speed: 0.35, size: 0.012, spread: 0.2 });
        }
      }
    }
    const l = left.current;
    // Closed = folded over onto the right half (θ = π); open = the V.
    if (l) l.rotation.y = Math.PI - (Math.PI - V) * st.open;

    const lf = leaf.current;
    if (lf) {
      const p = smooth01((now - flip.current.at - TURN.lift) / TURN.dur);
      const turning = p > 0 && p < 1 && show;
      lf.visible = turning;
      if (turning) {
        // Forward: from lying on the right page, up toward you, over the
        // spine, down onto the left. Backward: the reverse.
        const k = flip.current.dir > 0 ? p : 1 - p;
        lf.rotation.y = -V - k * (Math.PI - 2 * V);
        // A page curls as it turns rather than swinging out rigid (which
        // would sweep its edge right into your face at the top of the arc).
        lf.scale.x = 1 - 0.42 * Math.sin(k * Math.PI);
      }
    }
  });

  const pageHover = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (show && contentOn) document.body.style.cursor = "pointer";
  };
  const pageOut = () => {
    document.body.style.cursor = "";
  };
  useEffect(() => () => pageOut(), []);

  const m = tomeMaterials();
  const blockMats = [m.edgesU, m.edgesU, m.edgesV, m.edgesV, m.vellum, m.leatherDark];

  return (
    <>
      <group ref={book} position={[0, BOOK_Y - 0.9 * U, 0]}>
        {/* Spine and the right half (fixed). */}
        <mesh geometry={spineGeo} material={m.leather} scale={[BLOCK_T + COVER_T, PAGE_H + COVER_M * 2, BLOCK_T + COVER_T]} position={[0, 0, -BLOCK_T]} />
        <group rotation={[0, -V, 0]}>
          <Half side={1} blockMats={blockMats} onPress={() => turn(1)} onHover={pageHover} onOut={pageOut} />
          <UiShow show={contentOn}>
            {faces.map((f) => (
              <PageText key={f.id} page={spreads[Math.min(f.spread, last)]![1]} side={1} shown={f.shown} delay={f.delayR} />
            ))}
          </UiShow>
        </group>
        {/* The left half swings: it is also the front cover. */}
        <group ref={left} rotation={[0, Math.PI, 0]}>
          <Half side={-1} blockMats={blockMats} onPress={() => turn(-1)} onHover={pageHover} onOut={pageOut} />
          <CoverFace />
          <UiShow show={contentOn}>
            {faces.map((f) => (
              <PageText key={f.id} page={spreads[Math.min(f.spread, last)]![0]} side={-1} shown={f.shown} delay={f.delayL} />
            ))}
          </UiShow>
        </group>
        {/* The turning leaf. */}
        <group ref={leaf} visible={false} position={[0, 0, 0.004]}>
          <mesh geometry={leafGeo} material={m.leaf} scale={[PAGE_W * 0.985, PAGE_H * 0.985, 1]} />
        </group>
      </group>
      <group position={[0, -0.415 * U, 0.05]}>
        <RuneButton label="← PREV" onPress={() => turn(-1)} disabled={spread <= 0} px={px(0.019)} position={[-0.33 * U, 0, 0]} accent={CODEX_INK.head} delay={0.9} />
        <RuneButton label="CLOSE" onPress={() => setOverlay("none")} px={px(0.019)} position={[0, 0, 0]} accent="#8f86a0" color="#c9c0d4" delay={1} />
        <RuneButton label="NEXT →" onPress={() => turn(1)} disabled={spread >= last} px={px(0.019)} position={[0.33 * U, 0, 0]} accent={CODEX_INK.head} delay={0.9} />
        <RuneText
          text={`C or Esc closes · ← → turn the page`}
          px={px(0.0155)}
          position={[0, -0.052 * U, 0]}
          color={MENU_INK.faint}
          glow={0.4}
          delay={1.2}
        />
      </group>
    </>
  );
}

/** One half of the open book, spine at x = 0, extending toward `side`:
 * the board, the page block (its face is the page), metal corners. */
function Half({
  side,
  blockMats,
  onPress,
  onHover,
  onOut,
}: {
  side: 1 | -1;
  blockMats: Material[];
  onPress: () => void;
  onHover: (e: ThreeEvent<PointerEvent>) => void;
  onOut: () => void;
}) {
  const m = tomeMaterials();
  const boardW = PAGE_W + COVER_M;
  const boardH = PAGE_H + COVER_M * 2;
  const corner = metalMaterial("#9a7c48");
  return (
    <>
      <mesh
        geometry={box}
        material={blockMats}
        scale={[PAGE_W, PAGE_H, BLOCK_T]}
        position={[(side * PAGE_W) / 2, 0, -BLOCK_T / 2]}
        onPointerOver={onHover}
        onPointerOut={onOut}
        onPointerUp={(e) => {
          e.stopPropagation();
          onPress();
        }}
      />
      <mesh geometry={box} material={m.leather} scale={[boardW, boardH, COVER_T]} position={[(side * boardW) / 2, 0, -BLOCK_T - COVER_T / 2]} />
      {[1, -1].map((vy) => (
        <mesh
          key={vy}
          geometry={box}
          material={corner}
          scale={[COVER_M * 2.2, COVER_M * 2.2, COVER_T * 1.6]}
          position={[side * (boardW - COVER_M * 0.9), vy * (boardH / 2 - COVER_M * 0.9), -BLOCK_T - COVER_T / 2]}
        />
      ))}
    </>
  );
}

/** The outside of the front cover — what you see of the closed book. */
function CoverFace() {
  const x = -(PAGE_W + COVER_M) / 2;
  const z = -BLOCK_T - COVER_T - 0.002;
  return (
    <group position={[x, 0, z]} rotation={[0, Math.PI, 0]}>
      <mesh geometry={gem} material={glowMaterial(CODEX_INK.head, 2.6)} scale={[0.05 * U, 0.075 * U, 0.012 * U]} position={[0, 0.03 * U, 0]} />
      <RuneText text="THE CODEX" px={px(0.026)} position={[0, -0.09 * U, 0.003]} color={CODEX_INK.title} glow={0.6} depth={-0.3} />
    </group>
  );
}

/** One page's words: running head, body, folio. */
function PageText({
  page,
  side,
  shown,
  delay,
}: {
  page: CodexPage;
  side: 1 | -1;
  shown: boolean;
  delay: number;
}) {
  const cx = (side * PAGE_W) / 2;
  const top = PAGE_H / 2;
  const title = page.folio === null && page.head.length > 0;
  const bodyPx = px(BODY_CAP);
  const out = { outDuration: 0.35 } as const;
  return (
    <group position={[0, 0, 0.0025]}>
      {page.head.length > 0 && (
        <RuneText
          text={page.head}
          px={title ? px(0.034) : px(0.017)}
          position={[cx, top - (title ? 0.075 : 0.05) * U, 0]}
          show={shown}
          delay={delay}
          depth={-0.3}
          glow={title ? 0.8 : 0.6}
          {...out}
        />
      )}
      {!title && page.head.length > 0 && (
        <RuneText text="· ◇ ·" px={px(0.015)} position={[cx, top - 0.078 * U, 0]} color={CODEX_INK.faint} show={shown} delay={delay} depth={-0.3} glow={0.3} {...out} />
      )}
      <RuneText
        text={page.body}
        px={bodyPx}
        maxCols={PAGE_SIZE.cols}
        align="left"
        anchor={[0.5, 0]}
        position={[cx, top - (title ? 0.15 : 0.105) * U, 0]}
        show={shown}
        delay={delay + 0.05}
        depth={-0.3}
        glow={0.7}
        stagger={0.9}
        {...out}
      />
      {page.folio !== null && (
        <RuneText
          text={String(page.folio)}
          px={px(0.015)}
          position={[cx + side * (PAGE_W / 2 - 0.05 * U), -top + 0.035 * U, 0]}
          color={CODEX_INK.dim}
          show={shown}
          delay={delay + 0.2}
          depth={-0.3}
          glow={0.3}
          {...out}
        />
      )}
    </group>
  );
}

