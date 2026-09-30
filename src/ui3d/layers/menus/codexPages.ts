import { layoutText, type TextSpan } from "../../font/layout";
import { MENU_INK } from "./menuText";

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
 *     table of contents naming the page each chapter starts on. */

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
  /** Running head (chapter name), or empty. */
  head: TextSpan[];
  body: TextSpan[];
  /** Body lines used (≤ size.lines). */
  lines: number;
  /** Printed page number, or null (title page, blank end paper). */
  folio: number | null;
}

export type CodexSpread = readonly [left: CodexPage, right: CodexPage];

export const CODEX_INK = {
  head: "#b89cff",
  title: "#d8c2ff",
  text: "#e2d7c2",
  dim: MENU_INK.dim,
  faint: MENU_INK.faint,
} as const;

/** Lines `text` wraps to at `cols` — the renderer's own measure. */
export function linesOf(text: string, cols: number): number {
  return layoutText(text, { maxCols: cols }).lines;
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
export function splitToFit(text: string, cols: number, maxLines: number): [string, string] | null {
  const words = text.split(" ");
  let lo = 0;
  let hi = words.length;
  // Largest word count whose prefix fits.
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (linesOf(words.slice(0, mid).join(" "), cols) <= maxLines) lo = mid;
    else hi = mid - 1;
  }
  if (lo === 0) return null;
  return [words.slice(0, lo).join(" "), words.slice(lo).join(" ")];
}

function bandHead(band: CodexBand): TextSpan[] {
  const [from, to] = band.floors;
  return [
    { text: band.name.toUpperCase(), color: CODEX_INK.head },
    { text: `  ${from}–${to}`, color: CODEX_INK.faint },
  ];
}

/** Paginate the chapters' fragments into pages. */
export function paginate(
  groups: readonly { band: CodexBand; entries: readonly CodexFragment[] }[],
  size: CodexPageSize,
): CodexPage[] {
  const pages: CodexPage[] = [];
  for (const { band, entries } of groups) {
    const head = bandHead(band);
    let page: CodexPage = { head, body: [], lines: 0, folio: pages.length + 1 };
    const flush = () => {
      pages.push(page);
      page = { head, body: [], lines: 0, folio: pages.length + 1 };
    };
    for (const entry of entries) {
      const title = entry.title.toUpperCase();
      const titleLines = linesOf(title, size.cols);
      let text = entry.text;
      let first = true;
      while (text.length > 0) {
        const gap = page.lines > 0 ? 1 : 0;
        const heading = first ? titleLines : 0;
        const need = gap + heading + linesOf(text, size.cols);
        if (page.lines + need <= size.lines) {
          push(page, gap, first ? title : null, titleLines, text, size.cols);
          text = "";
          break;
        }
        // Doesn't fit here. On a used page, turn over and try again — unless
        // it wouldn't fit a whole page either, then break it where we are.
        const wholePage = heading + linesOf(text, size.cols);
        if (page.lines > 0 && wholePage <= size.lines) {
          flush();
          continue;
        }
        const room = size.lines - page.lines - gap - heading;
        const split = room > 0 ? splitToFit(text, size.cols, room) : null;
        if (!split) {
          if (page.lines === 0) {
            // Nothing fits even on an empty page (absurdly narrow): place
            // it anyway rather than looping forever.
            push(page, 0, first ? title : null, titleLines, text, size.cols);
            text = "";
            break;
          }
          flush();
          continue;
        }
        push(page, gap, first ? title : null, titleLines, split[0], size.cols);
        text = split[1];
        first = false;
        flush();
      }
    }
    if (page.lines > 0) pages.push(page);
  }
  return pages;
}

function push(page: CodexPage, gap: number, title: string | null, titleLines: number, text: string, cols: number): void {
  const prefix = page.body.length > 0 ? "\n".repeat(1 + gap) : "";
  if (title !== null) {
    page.body.push({ text: `${prefix}${title}\n`, color: CODEX_INK.title });
    page.body.push({ text, color: CODEX_INK.text });
    page.lines += gap + titleLines + linesOf(text, cols);
  } else {
    page.body.push({ text: `${prefix}${text}`, color: CODEX_INK.text });
    page.lines += gap + linesOf(text, cols);
  }
}

const EMPTY_TEXT =
  "You have read nothing yet. The walls down there are not silent — look for the faint violet glow of a carving, and press E.";

/** The title page: the tally, and the contents. */
export function titlePage(
  groups: readonly { band: CodexBand; entries: readonly CodexFragment[] }[],
  pages: readonly CodexPage[],
  bands: readonly CodexBand[],
  readCount: number,
  total: number,
  cols: number,
): CodexPage {
  const body: TextSpan[] = [
    { text: `${readCount} of ${total} carvings read\n\n`, color: CODEX_INK.dim },
    { text: "CONTENTS\n\n", color: CODEX_INK.head },
  ];
  const startOf = new Map<string, number>();
  for (const p of pages) {
    const name = p.head[0]?.text;
    if (name && p.folio !== null && !startOf.has(name)) startOf.set(name, p.folio);
  }
  let lines = 4;
  bands.forEach((band, i) => {
    const name = band.name.toUpperCase();
    const read = groups.find((g) => g.band.id === band.id)?.entries.length ?? 0;
    const folio = startOf.get(name);
    const right = folio !== undefined ? String(folio) : "·";
    const dots = Math.max(2, cols - name.length - right.length - 2);
    const last = i === bands.length - 1;
    body.push(
      { text: name, color: read > 0 ? CODEX_INK.text : CODEX_INK.faint },
      { text: ` ${".".repeat(dots)} `, color: CODEX_INK.faint },
      { text: right + (last ? "" : "\n"), color: read > 0 ? CODEX_INK.head : CODEX_INK.faint },
    );
    lines += 1;
  });
  return { head: [{ text: "THE CODEX", color: CODEX_INK.head }], body, lines, folio: null };
}

/** The whole book as spreads: title page + first page, then pairs. */
export function codexSpreads(
  read: readonly CodexFragment[],
  total: number,
  bands: readonly CodexBand[],
  bandOf: (floor: number) => string,
  size: CodexPageSize,
): CodexSpread[] {
  const groups = chapters(read, bands, bandOf);
  const pages = paginate(groups, size);
  const title = titlePage(groups, pages, bands, read.length, total, size.cols);
  const content: CodexPage[] =
    pages.length > 0
      ? pages
      : [{ head: [], body: [{ text: EMPTY_TEXT, color: CODEX_INK.dim }], lines: linesOf(EMPTY_TEXT, size.cols), folio: null }];
  const all = [title, ...content];
  const blank: CodexPage = { head: [], body: [], lines: 0, folio: null };
  const spreads: CodexSpread[] = [];
  for (let i = 0; i < all.length; i += 2) spreads.push([all[i]!, all[i + 1] ?? blank]);
  return spreads;
}

/** Plain text of a page (tests, logs). */
export function pageText(page: CodexPage): string {
  return page.body.map((s) => s.text).join("");
}
