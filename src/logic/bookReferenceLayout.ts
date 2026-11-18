/**
 * V5.6.0 — REFERENCE LAYOUT OF THE BOOK: one design for the viewer and for the downloaded PDF.
 *
 * Before V5.6.0 the viewer (HTML/CSS, sizes in screen pixels that depended on the screen width)
 * and the PDF (jsPDF drawing with Times/Helvetica and its own sizes and pagination) were two
 * separate implementations of the design, so the downloaded book never looked like the viewer.
 *
 * Now every page is laid out at a FIXED reference width (per format) with the desktop variant of
 * the design; the viewer scales that page to fit the screen and the PDF is drawn from that very
 * page. The reference width is calibrated so the body text measures BOOK_TARGET_BODY_TEXT_PT in
 * print (decision of the product owner: standard book, ~12 pt).
 *
 * V5.7.0 — The proportions are a global setting (Configuración Global → «Proporciones del libro»):
 *   Opción 1 'viewer_proportions': EVERY page uses the width of the former viewer (large print).
 *   Opción 2 'cover_viewer_interior_12pt' (default): cover as the former viewer, interior at 12 pt.
 */
import type { DemoBookFormatSpec } from './demoStoryRules.ts';
/**
 * V5.7.0 — Proportions of the book (viewer and downloaded PDF), chosen in Configuración Global.
 * - 'viewer_proportions' (Opción 1): the whole book keeps the proportions of the former viewer
 *   (large print: body text ~15–19 pt depending on the format; fewer words per page, more pages).
 * - 'cover_viewer_interior_12pt' (Opción 2, default): the cover keeps the proportions of the former
 *   viewer and the interior is a standard book with ~12 pt body text.
 */
export type BookLayoutMode = 'viewer_proportions' | 'cover_viewer_interior_12pt';
export const DEFAULT_BOOK_LAYOUT_MODE: BookLayoutMode = 'cover_viewer_interior_12pt';
export function normalizeBookLayoutMode(value: unknown): BookLayoutMode {
  return value === 'viewer_proportions' || value === 'cover_viewer_interior_12pt' ? value : DEFAULT_BOOK_LAYOUT_MODE;
}

let activeBookLayoutMode: BookLayoutMode = DEFAULT_BOOK_LAYOUT_MODE;
const layoutModeListeners = new Set<() => void>();

/** Mode used for books measured from now on (loaded from the global configuration). */
export function getActiveBookLayoutMode(): BookLayoutMode {
  return activeBookLayoutMode;
}

export function setActiveBookLayoutMode(mode: unknown): void {
  const next = normalizeBookLayoutMode(mode);
  if (next === activeBookLayoutMode) return;
  activeBookLayoutMode = next;
  for (const fn of Array.from(layoutModeListeners)) fn();
}

export function subscribeBookLayoutMode(fn: () => void): () => void {
  layoutModeListeners.add(fn);
  return () => layoutModeListeners.delete(fn);
}

/** Body text size of the printed book (pt). The only knob to make the whole book larger/smaller. */
export const BOOK_TARGET_BODY_TEXT_PT = 12;

/** Body text size (CSS px) of the desktop design of each format in the page renderer. */
export const BOOK_REFERENCE_BODY_TEXT_PX: Record<string, number> = { a5: 12, '6x9': 12.5, carta: 13.5 };

const MM_PER_PT = 25.4 / 72;

/**
 * Width (CSS px) at which the former viewer (V5.5.x) showed a page of each format. The COVER always
 * uses it (the distribution the product owner approved: title, author, logo and ornament as large as
 * in that viewer); with 'viewer_proportions' every other page uses it too.
 */
export const BOOK_COVER_REFERENCE_WIDTH_PX: Record<string, number> = { a5: 300, '6x9': 360, carta: 440 };

type PageKindLike = string | undefined;

/** Width (CSS px) at which a page of a format is laid out (viewer, pagination and PDF). */
export function getBookReferencePageWidthPx(
  format: Pick<DemoBookFormatSpec, 'id' | 'widthMm'>,
  pageKind?: PageKindLike,
  mode: BookLayoutMode = activeBookLayoutMode
): number {
  const viewerWidth = BOOK_COVER_REFERENCE_WIDTH_PX[format.id];
  if (viewerWidth && (pageKind === 'cover' || mode === 'viewer_proportions')) return viewerWidth;
  const bodyPx = BOOK_REFERENCE_BODY_TEXT_PX[format.id] ?? 12.5;
  const mmPerPx = (BOOK_TARGET_BODY_TEXT_PT * MM_PER_PT) / bodyPx;
  return Math.round(format.widthMm / mmPerPx);
}

export function getBookReferencePageSizePx(
  format: Pick<DemoBookFormatSpec, 'id' | 'widthMm' | 'heightMm'>,
  pageKind?: PageKindLike,
  mode: BookLayoutMode = activeBookLayoutMode
): {
  width: number;
  height: number;
} {
  const width = getBookReferencePageWidthPx(format, pageKind, mode);
  return { width, height: (width * format.heightMm) / format.widthMm };
}

/** Millimetres of paper per CSS px of the reference page. */
export function getBookMmPerReferencePx(
  format: Pick<DemoBookFormatSpec, 'id' | 'widthMm'>,
  pageKind?: PageKindLike,
  mode: BookLayoutMode = activeBookLayoutMode
): number {
  return format.widthMm / getBookReferencePageWidthPx(format, pageKind, mode);
}

const TEXT_SIZE_VALUE = /^(xs|sm|base|lg|xl|\d?xl|\[[\d.]+(px|rem|em)\])$/;

/** Utility "slot" of a Tailwind class, so `sm:top-4` replaces `top-3.5` but not `bottom-3.5`. */
function utilityKey(token: string): string {
  const m = token.match(/^-?([a-z]+(?:-[xy])?)-(.+)$/);
  if (!m) return token;
  const [, prefix, value] = m;
  if (prefix === 'text') return TEXT_SIZE_VALUE.test(value) ? 'text-size' : `text:${value}`;
  return prefix;
}

/**
 * Keeps only the desktop (`sm:`) value of every utility that has one, so the reference layout never
 * depends on the size of the screen: `'top-3.5 left-6 sm:top-4 sm:left-7'` → `'top-4 left-7'`.
 */
export function resolveDesktopClasses(className: string): string {
  const tokens = String(className || '').split(/\s+/).filter(Boolean);
  const desktop = tokens.filter((t) => t.startsWith('sm:')).map((t) => t.slice(3));
  const overridden = new Set(desktop.map(utilityKey));
  return [...tokens.filter((t) => !t.startsWith('sm:') && !overridden.has(utilityKey(t))), ...desktop].join(' ');
}
