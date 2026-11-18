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
 */
import type { DemoBookFormatSpec } from './demoStoryRules.ts';

/** Body text size of the printed book (pt). The only knob to make the whole book larger/smaller. */
export const BOOK_TARGET_BODY_TEXT_PT = 12;

/** Body text size (CSS px) of the desktop design of each format in the page renderer. */
export const BOOK_REFERENCE_BODY_TEXT_PX: Record<string, number> = { a5: 12, '6x9': 12.5, carta: 13.5 };

const MM_PER_PT = 25.4 / 72;

/** Width (CSS px) at which every page of a format is laid out (viewer, pagination and PDF). */
export function getBookReferencePageWidthPx(format: Pick<DemoBookFormatSpec, 'id' | 'widthMm'>): number {
  const bodyPx = BOOK_REFERENCE_BODY_TEXT_PX[format.id] ?? 12.5;
  const mmPerPx = (BOOK_TARGET_BODY_TEXT_PT * MM_PER_PT) / bodyPx;
  return Math.round(format.widthMm / mmPerPx);
}

export function getBookReferencePageSizePx(format: Pick<DemoBookFormatSpec, 'id' | 'widthMm' | 'heightMm'>): {
  width: number;
  height: number;
} {
  const width = getBookReferencePageWidthPx(format);
  return { width, height: (width * format.heightMm) / format.widthMm };
}

/** Millimetres of paper per CSS px of the reference page. */
export function getBookMmPerReferencePx(format: Pick<DemoBookFormatSpec, 'id' | 'widthMm'>): number {
  return format.widthMm / getBookReferencePageWidthPx(format);
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
