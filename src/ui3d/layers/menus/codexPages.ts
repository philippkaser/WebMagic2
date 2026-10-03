import { layoutText, type TextSpan } from "../../font/layout";
import { PIXEL_METRICS, type FontMetrics } from "../../font/metrics";
import { ink } from "../../theme";

/** The codex as a book: pure pagination of the fragments read so far into
 * pages and two-page spreads, measured with the same layout the pixel font
 * renders with — so a page never overflows its vellum.
 *
 * Book rules (a real book's, because it's meant to feel like one):
 *   - Fragments are grouped by depth band; each band is a chapter that
 *     starts on a fresh page, with the band's name as the running head of
 *     every page in it.
 *   - Within a chapter, shallowest first (the story deepens as you read),
 *     ties in the order they were found.
 *   - A fragment is never split across pages unless it alone can't fit a
 *     page — then it breaks at a word and continues overleaf.
 *   - The first spread opens on a title page: how much has been read, and a
 *     table of contents naming the page each chapter starts on.
 *
 * Measuring takes the face the pages are set in (`metrics`, the body face
 * at runtime — the fonts are proportional); tests use the fixed-width
 * fallback. */

export interface CodexFragment {
  id: string;
  title: string;
  text: string;
  minFloor: number;
}

export interface CodexBand {
  id: string;
  name: string;
  floors: readonly [number, number];
}

export interface CodexPageSize {
  /** Characters per line. */
  cols: number;
  /** Lines of body text per page (the running head is extra). */
  lines: number;
}

export interface CodexPage {
  /** The chapter this page belongs to (its running head), or null. */
  chapter: CodexBand | null;
  /** The title page (set as the book's title, not a running head). */
  title?: boolean;
  body: TextSpan[];
  /** Body lines used (≤ size.lines). */
  lines: number;
  /** Printed page number, or null (title page, blank end paper). */
  folio: number | null;
}

export type CodexSpread = readonly [left: CodexPage, right: CodexPage];

/** The grimoire's ink on the codex's dark vellum. */
export const CODEX_INK = {
  head: ink.brassLight,
  title: ink.brassLight,
  text: ink.parchment,
  dim: ink.parchmentDim,
  faint: ink.faded,
} as const;

/** Lines `text` wraps to at `cols` — the renderer's own measure. */
export function linesOf(text: string, cols: number, metrics: FontMetrics = PIXEL_METRICS): number {
  return layoutText(text, { maxCols: cols }, metrics).lines;
}

/** Fragments by band, bands in depth order, empty bands dropped. */
export function chapters(
  read: readonly CodexFragment[],
  bands: readonly CodexBand[],
  bandOf: (floor: number) => string,
): { band: CodexBand; entries: CodexFragment[] }[] {
  const order = new Map(read.map((f, i) => [f.id, i]));
  return bands
    .map((band) => ({
      band,
      entries: read
        .filter((f) => bandOf(f.minFloor) === band.id)
        .sort((a, b) => a.minFloor - b.minFloor || order.get(a.id)! - order.get(b.id)!),
    }))
    .filter((c) => c.entries.length > 0);
}

/** Split `text` so the first part wraps to at most `maxLines` lines (at a
 * word boundary). Returns null when not even one word fits. */
export function splitToFit(
  text: string,
  cols: number,
  maxLines: number,
  metrics: FontMetrics = PIXEL_METRICS,
): [string, string] | null {
  const words = text.split(" ");
  let lo = 0;
  let hi = words.length;
  // Largest word count whose prefix fits.
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (linesOf(words.slice(0, mid).join(" "), cols, metrics) <= maxLines) lo = mid;
    else hi = mid - 1;
  }
  if (lo === 0) return null;
  return [words.slice(0, lo).join(" "), words.slice(lo).join(" ")];
}

/** Paginate the chapters' fragments into pages. */
export function paginate(
  groups: readonly { band: CodexBand; entries: readonly CodexFragment[] }[],
  size: CodexPageSize,
  metrics: FontMetrics = PIXEL_METRICS,
): CodexPage[] {
  const pages: CodexPage[] = [];
  const lines = (t: string) => linesOf(t, size.cols, metrics);
  for (const { band, entries } of groups) {
    let page: CodexPage = { chapter: band, body: [], lines: 0, folio: pages.length + 1 };
    const flush = () => {
      pages.push(page);
      page = { chapter: band, body: [], lines: 0, folio: pages.length + 1 };
    };
    for (const entry of entries) {
      const title = entry.title.toUpperCase();
      const titleLines = lines(title);
      let text = entry.text;
      let first = true;
      while (text.length > 0) {
        const gap = page.lines > 0 ? 1 : 0;
        const heading = first ? titleLines : 0;
        const need = gap + heading + lines(text);
        if (page.lines + need <= size.lines) {
          push(page, gap, first ? title : null, titleLines, text, lines);
          text = "";
          break;
        }
        // Doesn't fit here. On a used page, turn over and try again — unless
        // it wouldn't fit a whole page either, then break it where we are.
        const wholePage = heading + lines(text);
        if (page.lines > 0 && wholePage <= size.lines) {
          flush();
          continue;
        }
        const room = size.lines - page.lines - gap - heading;
        const split = room > 0 ? splitToFit(text, size.cols, room, metrics) : null;
        if (!split) {
          if (page.lines === 0) {
            // Nothing fits even on an empty page (absurdly narrow): place
            // it anyway rather than looping forever.
            push(page, 0, first ? title : null, titleLines, text, lines);
            text = "";
            break;
          }
          flush();
          continue;
        }
        push(page, gap, first ? title : null, titleLines, split[0], lines);
        text = split[1];
        first = false;
        flush();
      }
    }
    if (page.lines > 0) pages.push(page);
  }
  return pages;
}

function push(page: CodexPage, gap: number, title: string | null, titleLines: number, text: string, lines: (t: string) => number): void {
  const prefix = page.body.length > 0 ? "\n".repeat(1 + gap) : "";
  if (title !== null) {
    page.body.push({ text: `${prefix}${title}\n`, color: CODEX_INK.title });
    page.body.push({ text, color: CODEX_INK.text });
    page.lines += gap + titleLines + lines(text);
  } else {
    page.body.push({ text: `${prefix}${text}`, color: CODEX_INK.text });
    page.lines += gap + lines(text);
  }
}

const EMPTY_TEXT =
  "You have read nothing yet. The walls down there are not silent — look for the faint violet glow of a carving, and press E.";

/** The title page: the tally, and the contents with dot leaders measured
 * in the page's own face, so the folios line up on the right. */
export function titlePage(
  groups: readonly { band: CodexBand; entries: readonly CodexFragment[] }[],
  pages: readonly CodexPage[],
  bands: readonly CodexBand[],
  readCount: number,
  total: number,
  cols: number,
  metrics: FontMetrics = PIXEL_METRICS,
): CodexPage {
  const body: TextSpan[] = [
    { text: `${readCount} of ${total} carvings read\n\n`, color: CODEX_INK.dim },
    { text: "CONTENTS\n\n", color: CODEX_INK.head },
  ];
  const startOf = new Map<string, number>();
  for (const p of pages) {
    if (p.chapter && p.folio !== null && !startOf.has(p.chapter.id)) startOf.set(p.chapter.id, p.folio);
  }
  const width = (t: string) => layoutText(t, {}, metrics).width;
  const lineW = cols * metrics.avgAdvance;
  const dotW = Math.max(1, width("..") - width("."));
  const spaceW = Math.max(1, width("a a") - width("aa"));
  let lines = 4;
  bands.forEach((band, i) => {
    const name = band.name.toUpperCase();
    const read = groups.find((g) => g.band.id === band.id)?.entries.length ?? 0;
    const folio = startOf.get(band.id);
    const right = folio !== undefined ? String(folio) : "·";
    const room = lineW - width(name) - width(right) - spaceW * 2 - 4;
    const dots = Math.max(2, Math.floor(room / dotW));
    const last = i === bands.length - 1;
    body.push(
      { text: name, color: read > 0 ? CODEX_INK.text : CODEX_INK.faint },
      { text: ` ${".".repeat(dots)} `, color: CODEX_INK.faint },
      { text: right + (last ? "" : "\n"), color: read > 0 ? CODEX_INK.head : CODEX_INK.faint },
    );
    lines += 1;
  });
  return { chapter: null, title: true, body, lines, folio: null };
}

/** The whole book as spreads: title page + first page, then pairs. */
export function codexSpreads(
  read: readonly CodexFragment[],
  total: number,
  bands: readonly CodexBand[],
  bandOf: (floor: number) => string,
  size: CodexPageSize,
  metrics: FontMetrics = PIXEL_METRICS,
): CodexSpread[] {
  const groups = chapters(read, bands, bandOf);
  const pages = paginate(groups, size, metrics);
  const title = titlePage(groups, pages, bands, read.length, total, size.cols, metrics);
  const content: CodexPage[] =
    pages.length > 0
      ? pages
      : [{ chapter: null, body: [{ text: EMPTY_TEXT, color: CODEX_INK.dim }], lines: linesOf(EMPTY_TEXT, size.cols, metrics), folio: null }];
  const all = [title, ...content];
  const blank: CodexPage = { chapter: null, body: [], lines: 0, folio: null };
  const spreads: CodexSpread[] = [];
  for (let i = 0; i < all.length; i += 2) spreads.push([all[i]!, all[i + 1] ?? blank]);
  return spreads;
}

/** Plain text of a page (tests, logs). */
export function pageText(page: CodexPage): string {
  return page.body.map((s) => s.text).join("");
}
