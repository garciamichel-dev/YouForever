/**
 * V5.6.0 — PAGINATION BY MEASUREMENT (browser).
 *
 * `composeBookPages` distributes the text with estimates made for the old jsPDF drawing, so in the
 * viewer most chapter pages overflowed (their text scrolled inside the page) and the downloaded PDF
 * split them differently. Here every page is laid out off-screen exactly as the viewer shows it
 * (reference layout) and, when it does not fit, the precise word where the page must break is found
 * by binary search; the rest continues on a new page. The viewer and the PDF exporter both use the
 * result, so they always have the same pages.
 */
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import {
  balanceInlineMarkdownMarkersAcrossLines,
  type ComposedBookDocument,
  type ComposedBookPage,
  type ComposedChapterSectionBlock,
  type DemoInMemoryPhoto,
} from '../../logic/demoStoryRules.ts';
import { getBookReferencePageWidthPx } from '../../logic/bookReferenceLayout.ts';
import { BOOK_FONT_FACES } from '../../logic/bookFonts.ts';
import { DemoComposedPageView } from '../DemoBookPageRenderer.tsx';

/** Overflow tolerance (CSS px) below which a page is considered to fit. */
const FIT_TOLERANCE_PX = 1;
/** Widow control: minimum words/blocks that move to a continuation page (a lone pull quote never does). */
const MIN_TAIL_TOKENS = 10;

// ---------------------------------------------------------------------------------------------
// Off-screen page stage
// ---------------------------------------------------------------------------------------------

export interface BookPageStage {
  /** Lays the page out synchronously and returns its root element. */
  render(page: ComposedBookPage): HTMLElement;
  /** How many CSS px of content do not fit in the page (0 when it fits). */
  overflowOf(page: ComposedBookPage): number;
  dispose(): void;
}

export function createBookPageStage(composed: ComposedBookDocument): BookPageStage {
  const width = getBookReferencePageWidthPx(composed.format);
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('data-book-measure-stage', 'true');
  host.style.cssText = `position:fixed;left:-30000px;top:0;width:${width}px;pointer-events:none;contain:layout style;`;
  document.body.appendChild(host);
  const root: Root = createRoot(host);

  const render = (page: ComposedBookPage): HTMLElement => {
    flushSync(() => root.render(<DemoComposedPageView composed={composed} page={page} referenceLayout />));
    return host.firstElementChild as HTMLElement;
  };

  const overflowOf = (page: ComposedBookPage): number => {
    const el = render(page);
    let overflow = el.scrollHeight - el.clientHeight;
    el.querySelectorAll<HTMLElement>('[data-book-content-area]').forEach((area) => {
      overflow = Math.max(overflow, area.scrollHeight - area.clientHeight);
    });
    return overflow > FIT_TOLERANCE_PX ? overflow : 0;
  };

  return {
    render,
    overflowOf,
    dispose: () => {
      root.unmount();
      host.remove();
    },
  };
}

/** First family of a CSS font-family list (`"'YFBook PD', 'Playfair Display', serif"` → `YFBook PD`). */
export function primaryFontFamily(fontFamily: string | undefined): string {
  return String(fontFamily || '')
    .split(',')[0]
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

/** Loads every face of the book's self-hosted fonts before measuring or exporting. */
export async function ensureBookFontsReady(composed: ComposedBookDocument): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const families = new Set(
    [
      composed.coverDesign.titleFontFamily,
      composed.coverDesign.bodyFontFamily,
      composed.coverDesign.accentFontFamily,
      composed.interiorStyle.titleFontFamily,
      composed.interiorStyle.bodyFontFamily,
      composed.interiorStyle.accentFontFamily,
    ]
      .map(primaryFontFamily)
      .filter(Boolean)
  );
  const loads = BOOK_FONT_FACES.filter((f) => families.has(f.cssFamily)).map((f) =>
    document.fonts.load(`${f.style} ${f.weight} 16px "${f.cssFamily}"`)
  );
  await Promise.allSettled(loads);
  await document.fonts.ready;
}

// ---------------------------------------------------------------------------------------------
// Chapter pages: tokens (atomic blocks and words) and prefix / remainder builders
// ---------------------------------------------------------------------------------------------

type ChapterToken =
  | { kind: 'header'; s: number }
  | { kind: 'word'; s: number; p: number; w: number }
  | { kind: 'pphoto'; s: number; p: number; i: number }
  | { kind: 'quote'; s: number };

const splitWords = (text: string) => String(text || '').split(/\s+/).filter(Boolean);

function sectionShowsMainPhoto(sec: ComposedChapterSectionBlock): boolean {
  return Boolean(
    sec.photo && !sec.isContinuation && (!sec.paragraphPhotos || Object.keys(sec.paragraphPhotos).length === 0)
  );
}

export function tokenizeChapterSections(sections: ComposedChapterSectionBlock[]): ChapterToken[] {
  const tokens: ChapterToken[] = [];
  sections.forEach((sec, s) => {
    // The header (chapter title, or «continuación» label) travels with the main photo.
    tokens.push({ kind: 'header', s });
    sec.paragraphs.forEach((para, p) => {
      splitWords(para).forEach((_w, w) => tokens.push({ kind: 'word', s, p, w }));
      (sec.paragraphPhotos?.[p] || []).forEach((_ph, i) => tokens.push({ kind: 'pphoto', s, p, i }));
    });
    if (sec.pullQuote) tokens.push({ kind: 'quote', s });
  });
  return tokens;
}

/** Sections holding the first `k` tokens. */
export function buildChapterPrefix(
  sections: ComposedChapterSectionBlock[],
  tokens: ChapterToken[],
  k: number
): ComposedChapterSectionBlock[] {
  const included = tokens.slice(0, k);
  const out: ComposedChapterSectionBlock[] = [];
  sections.forEach((sec, s) => {
    const mine = included.filter((t) => t.s === s);
    if (mine.length === 0) return;
    const words = new Map<number, number>();
    const photos = new Map<number, number>();
    let quote = false;
    for (const t of mine) {
      if (t.kind === 'word') words.set(t.p, Math.max(words.get(t.p) ?? 0, t.w + 1));
      if (t.kind === 'pphoto') photos.set(t.p, Math.max(photos.get(t.p) ?? 0, t.i + 1));
      if (t.kind === 'quote') quote = true;
    }
    const touched = Array.from(new Set([...words.keys(), ...photos.keys()]));
    const lastP = touched.length ? Math.max(...touched) : -1;
    const paragraphs: string[] = [];
    const paragraphIds: string[] = [];
    const paragraphPhotos: Record<number, DemoInMemoryPhoto[]> = {};
    let lastParagraphContinues = false;
    for (let p = 0; p <= lastP; p++) {
      const all = splitWords(sec.paragraphs[p]);
      const n = words.get(p) ?? (p < lastP ? all.length : 0);
      let text = sec.paragraphs[p];
      if (n < all.length) {
        const [head] = balanceInlineMarkdownMarkersAcrossLines([
          all.slice(0, n).join(' '),
          all.slice(n).join(' '),
        ]);
        text = head;
        if (p === lastP && n > 0 && !photos.has(p)) lastParagraphContinues = true;
      }
      paragraphs.push(text);
      if (sec.paragraphIds?.[p]) paragraphIds.push(sec.paragraphIds[p]);
      const ph = (sec.paragraphPhotos?.[p] || []).slice(0, photos.get(p) ?? (p < lastP ? Infinity : 0));
      if (ph.length) paragraphPhotos[p] = ph;
    }
    out.push({
      ...sec,
      // The main photo is shown only when the original section showed it (no paragraph photos).
      photo: sectionShowsMainPhoto(sec) ? sec.photo : null,
      paragraphs,
      ...(sec.paragraphIds ? { paragraphIds } : {}),
      paragraphPhotos,
      pullQuote: quote ? sec.pullQuote : undefined,
      lastParagraphContinues: lastParagraphContinues || undefined,
    });
  });
  return out;
}

/** Sections holding everything after the first `k` tokens (the cut section becomes a continuation). */
export function buildChapterRemainder(
  sections: ComposedChapterSectionBlock[],
  tokens: ChapterToken[],
  k: number
): ComposedChapterSectionBlock[] {
  if (k >= tokens.length) return [];
  const first = tokens[k];
  const out: ComposedChapterSectionBlock[] = [];
  sections.forEach((sec, s) => {
    if (s < first.s) return;
    if (s > first.s || first.kind === 'header') {
      out.push(sec);
      return;
    }
    // The section cut at token k continues on the next page.
    const startP = first.kind === 'quote' ? sec.paragraphs.length : first.p;
    const paragraphs: string[] = [];
    const paragraphIds: string[] = [];
    const paragraphPhotos: Record<number, DemoInMemoryPhoto[]> = {};
    for (let p = startP; p < sec.paragraphs.length; p++) {
      const idx = p - startP;
      let text = sec.paragraphs[p];
      let photos = sec.paragraphPhotos?.[p] || [];
      if (p === startP && first.kind === 'word' && first.w > 0) {
        const all = splitWords(text);
        const [, tail] = balanceInlineMarkdownMarkersAcrossLines([
          all.slice(0, first.w).join(' '),
          all.slice(first.w).join(' '),
        ]);
        text = tail;
      }
      if (p === startP && first.kind === 'pphoto') {
        text = '';
        photos = photos.slice(first.i);
      }
      paragraphs.push(text);
      if (sec.paragraphIds?.[p]) paragraphIds.push(sec.paragraphIds[p]);
      if (photos.length) paragraphPhotos[idx] = photos;
    }
    out.push({
      ...sec,
      isContinuation: true,
      paragraphs,
      ...(sec.paragraphIds ? { paragraphIds } : {}),
      paragraphPhotos,
      lastParagraphContinues: undefined,
    });
  });
  return out;
}

/** Largest k in [lo, hi] with fits(k) true (fits must be monotonic); lo - 1 when none fits. */
function largestFitting(lo: number, hi: number, fits: (k: number) => boolean): number {
  let best = lo - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function splitChapterPage(stage: BookPageStage, page: ComposedBookPage): ComposedBookPage[] {
  const out: ComposedBookPage[] = [];
  let current = page;
  for (let guard = 0; guard < 400; guard++) {
    const sections = current.sections || [];
    if (stage.overflowOf(current) === 0 || sections.length === 0) {
      out.push(current);
      return out;
    }
    const tokens = tokenizeChapterSections(sections);
    const withPrefix = (k: number): ComposedBookPage => ({ ...current, sections: buildChapterPrefix(sections, tokens, k) });
    let k = largestFitting(1, tokens.length - 1, (n) => stage.overflowOf(withPrefix(n)) === 0);
    // Never leave a chapter title alone at the bottom of a page: move it to the next one.
    if (k > 0 && tokens[k - 1].kind === 'header' && k - 1 > 0) k -= 1;
    // Widow control: never move only the pull quote or a few words to a new page; a short tail of
    // the same section takes the last lines of this page with it.
    const tail = tokens.slice(k);
    const tailInSameSection = tail.length > 0 && tail.every((t) => t.s === tokens[k].s && t.kind !== 'header');
    if (tailInSameSection && tail.length < MIN_TAIL_TOKENS) {
      const firstContent = tokens.findIndex((t) => t.s === tokens[k].s && t.kind !== 'header');
      const minK = Math.max(firstContent + 1, 1);
      k = Math.max(minK, tokens.length - MIN_TAIL_TOKENS);
      // The page must still end at the end of a LINE (as in print): step back while the next word
      // would continue on the same line, measured on the real layout.
      const heights = new Map<number, number>();
      const contentHeight = (n: number) => {
        if (!heights.has(n)) {
          // Bottom edge of the content itself (scrollHeight of a fixed-height area does not change
          // while the content fits).
          const el = stage.render(withPrefix(n));
          const area = el.querySelector<HTMLElement>('[data-book-content-area]') || el;
          let bottom = 0;
          for (const child of Array.from(area.children)) {
            bottom = Math.max(bottom, child.getBoundingClientRect().bottom);
          }
          heights.set(n, Math.round(bottom * 10) / 10);
        }
        return heights.get(n)!;
      };
      while (
        k > minK &&
        tokens[k - 1]?.kind === 'word' &&
        tokens[k]?.kind === 'word' &&
        contentHeight(k + 1) <= contentHeight(k)
      ) {
        k -= 1;
      }
    }
    // A single block taller than a page (e.g. a very tall photo) goes alone; it cannot be split.
    if (k < 1) k = 1;
    out.push(withPrefix(k));
    const rest = buildChapterRemainder(sections, tokens, k);
    if (rest.length === 0) return out;
    current = { ...current, sections: rest };
  }
  out.push(current);
  return out;
}

function splitIntroductionPage(stage: BookPageStage, page: ComposedBookPage): ComposedBookPage[] {
  const out: ComposedBookPage[] = [];
  let current = page;
  for (let guard = 0; guard < 100; guard++) {
    if (!current.introduction || stage.overflowOf(current) === 0) {
      out.push(current);
      return out;
    }
    const words = splitWords(current.introduction);
    const withWords = (n: number): ComposedBookPage => {
      const [head] = balanceInlineMarkdownMarkersAcrossLines([words.slice(0, n).join(' '), words.slice(n).join(' ')]);
      return { ...current, introduction: head, introductionContinues: n < words.length || undefined };
    };
    let n = largestFitting(1, words.length - 1, (m) => stage.overflowOf(withWords(m)) === 0);
    if (n < 1) n = Math.min(words.length, 1);
    out.push(withWords(n));
    const [, tail] = balanceInlineMarkdownMarkersAcrossLines([words.slice(0, n).join(' '), words.slice(n).join(' ')]);
    if (!tail.trim()) return out;
    current = {
      ...current,
      introduction: tail,
      isIntroductionContinuation: true,
      introductionContinues: undefined,
      dedication: undefined,
    };
  }
  out.push(current);
  return out;
}

function splitTableOfContentsPage(stage: BookPageStage, page: ComposedBookPage): ComposedBookPage[] {
  const out: ComposedBookPage[] = [];
  let entries = page.tocEntries || [];
  for (let guard = 0; guard < 50; guard++) {
    const candidate = { ...page, tocEntries: entries };
    if (entries.length <= 1 || stage.overflowOf(candidate) === 0) {
      out.push(candidate);
      return out;
    }
    let n = largestFitting(1, entries.length - 1, (m) => stage.overflowOf({ ...page, tocEntries: entries.slice(0, m) }) === 0);
    if (n < 1) n = 1;
    out.push({ ...page, tocEntries: entries.slice(0, n) });
    entries = entries.slice(n);
  }
  out.push({ ...page, tocEntries: entries });
  return out;
}

/**
 * Consecutive chapter pages whose next page only continues the previous one (first section is a
 * continuation), joined into one stream of sections: the composer's page breaks were estimated for
 * the old jsPDF drawing, so they are discarded and the text flows again by measurement. A paragraph
 * the composer cut between pages (ids `…_cont_N`) is joined back. Chapters that START on a page are
 * never merged with the previous page, so every chapter still opens on a new page.
 */
export function mergeChapterContinuationRuns(pages: ComposedBookPage[]): ComposedBookPage[] {
  const out: ComposedBookPage[] = [];
  const baseId = (id?: string) => (id ? id.replace(/_cont_\d+$/, '') : undefined);
  for (const page of pages) {
    const prev = out[out.length - 1];
    const first = page.sections?.[0];
    const prevLast = prev?.sections?.[prev.sections.length - 1];
    const continuesPrev =
      page.kind === 'chapter_content' &&
      prev?.kind === 'chapter_content' &&
      first?.isContinuation === true &&
      prevLast?.chapterId === first.chapterId;
    if (!continuesPrev || !prev || !prevLast || !first) {
      out.push({ ...page, sections: page.sections?.map((s) => ({ ...s })) });
      continue;
    }
    // Join the continuation section into the previous section of the same chapter.
    const prevIds = prevLast.paragraphIds;
    const firstIds = first.paragraphIds;
    const lastPrevId = prevIds?.[prevIds.length - 1];
    const joinsCutParagraph =
      Boolean(firstIds?.[0] && /_cont_\d+$/.test(firstIds[0]) && baseId(firstIds[0]) === baseId(lastPrevId)) &&
      prevLast.paragraphs.length > 0 &&
      first.paragraphs.length > 0;
    const offset = prevLast.paragraphs.length - (joinsCutParagraph ? 1 : 0);
    const paragraphs = joinsCutParagraph
      ? [
          ...prevLast.paragraphs.slice(0, -1),
          `${prevLast.paragraphs[prevLast.paragraphs.length - 1]} ${first.paragraphs[0]}`.replace(/\s+/g, ' ').trim(),
          ...first.paragraphs.slice(1),
        ]
      : [...prevLast.paragraphs, ...first.paragraphs];
    const paragraphIds =
      prevIds || firstIds
        ? [...(prevIds || []).slice(0, joinsCutParagraph ? -1 : undefined), ...(joinsCutParagraph ? [baseId(lastPrevId)!] : []), ...(firstIds || []).slice(joinsCutParagraph ? 1 : 0)]
        : undefined;
    const paragraphPhotos: Record<number, DemoInMemoryPhoto[]> = { ...(prevLast.paragraphPhotos || {}) };
    for (const [k, list] of Object.entries(first.paragraphPhotos || {})) {
      const idx = Number(k) + offset;
      paragraphPhotos[idx] = [...(paragraphPhotos[idx] || []), ...list];
    }
    prev.sections![prev.sections!.length - 1] = {
      ...prevLast,
      paragraphs,
      ...(paragraphIds ? { paragraphIds } : {}),
      paragraphPhotos,
      pullQuote: first.pullQuote || prevLast.pullQuote,
      lastParagraphContinues: undefined,
    };
    // Any further sections of that page (another chapter on the same page) follow in the stream.
    prev.sections!.push(...(page.sections || []).slice(1).map((s) => ({ ...s })));
  }
  return out;
}

/** Page numbers, totals and table-of-contents numbers after the pages changed. */
export function renumberComposedPages(composed: ComposedBookDocument, pages: ComposedBookPage[]): ComposedBookDocument {
  const total = pages.length;
  const numbered = pages.map((p, i) => ({ ...p, pageNumber: i + 1, totalPages: total }));
  const chapterStart = new Map<string, number>();
  for (const p of numbered) {
    for (const sec of p.sections || []) {
      if (!sec.isContinuation && !chapterStart.has(sec.chapterId)) chapterStart.set(sec.chapterId, p.pageNumber);
    }
  }
  const fixEntries = (entries?: ComposedBookPage['tocEntries']) =>
    entries?.map((e) => ({ ...e, startPageNumber: chapterStart.get(e.chapterId) ?? e.startPageNumber }));
  return {
    ...composed,
    pages: numbered.map((p) => (p.kind === 'table_of_contents' ? { ...p, tocEntries: fixEntries(p.tocEntries) } : p)),
    tocEntries: fixEntries(composed.tocEntries),
  };
}

const paginationCache = new WeakMap<ComposedBookDocument, Promise<ComposedBookDocument>>();

/**
 * The book exactly as the viewer shows it: every page fits its reference page. Same input object →
 * same (cached) result, so the viewer and the PDF of a version never differ.
 */
export function paginateComposedBookByMeasurement(composed: ComposedBookDocument): Promise<ComposedBookDocument> {
  const cached = paginationCache.get(composed);
  if (cached) return cached;
  const job = (async () => {
    await ensureBookFontsReady(composed);
    const stage = createBookPageStage(composed);
    try {
      // Render every kind of page once so lazily loaded faces are in place before measuring.
      for (const p of composed.pages) stage.render(p);
      if (typeof document !== 'undefined' && document.fonts) await document.fonts.ready;
      const pages: ComposedBookPage[] = [];
      for (const page of mergeChapterContinuationRuns(composed.pages)) {
        if (page.kind === 'chapter_content') pages.push(...splitChapterPage(stage, page));
        else if (page.kind === 'title_dedication' && page.introduction) pages.push(...splitIntroductionPage(stage, page));
        else if (page.kind === 'table_of_contents') pages.push(...splitTableOfContentsPage(stage, page));
        else pages.push(page);
      }
      return renumberComposedPages(composed, pages);
    } finally {
      stage.dispose();
    }
  })();
  paginationCache.set(composed, job);
  job.catch(() => paginationCache.delete(composed));
  return job;
}
