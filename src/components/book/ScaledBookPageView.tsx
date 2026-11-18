/**
 * V5.6.0 — A book page in the viewer: laid out at the format's fixed reference width (the same
 * layout the PDF is drawn from) and scaled to the space available on screen, so it keeps exactly
 * the same proportions on a phone, a laptop or the printed page.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComposedBookDocument, ComposedBookPage } from '../../logic/demoStoryRules.ts';
import { getBookReferencePageSizePx } from '../../logic/bookReferenceLayout.ts';
import { DemoComposedPageView } from '../DemoBookPageRenderer.tsx';
import { paginateComposedBookByMeasurement } from './measuredBookPagination.tsx';

export const ScaledBookPageView: React.FC<{
  composed: ComposedBookDocument;
  page: ComposedBookPage;
  className?: string;
}> = ({ composed, page, className = '' }) => {
  const { width, height } = getBookReferencePageSizePx(composed.format);
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth > 0 ? el.clientWidth / width : 1);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div
      ref={outerRef}
      data-testid="scaled-book-page"
      className="relative w-full"
      style={{ height: height * scale }}
    >
      <div style={{ width, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <DemoComposedPageView composed={composed} page={page} className={className} referenceLayout />
      </div>
    </div>
  );
};

/**
 * The book exactly as it will be printed (pages paginated by measurement). Until the measurement of
 * a new composition finishes, the previous result (or the composition itself) is shown.
 */
export function useMeasuredBook(composed: ComposedBookDocument): ComposedBookDocument {
  const [state, setState] = useState<{ source: ComposedBookDocument; book: ComposedBookDocument } | null>(null);
  useEffect(() => {
    let alive = true;
    paginateComposedBookByMeasurement(composed)
      .then((book) => {
        if (alive) setState({ source: composed, book });
      })
      .catch((err) => console.warn('[BookViewer] Paginación medida no disponible:', err));
    return () => {
      alive = false;
    };
  }, [composed]);
  return state?.book ?? composed;
}
