/**
 * V5.7.0 — Loads the book proportions chosen in Configuración Global («Proporciones del libro»)
 * from the public endpoint /api/book-layout (it exposes only that value) and keeps it in sync for
 * the viewer, the measured pagination and the PDF.
 */
import { useSyncExternalStore } from 'react';
import {
  getActiveBookLayoutMode,
  setActiveBookLayoutMode,
  subscribeBookLayoutMode,
  type BookLayoutMode,
} from '../../logic/bookReferenceLayout.ts';

const REFRESH_MS = 60_000;
let inFlight: Promise<BookLayoutMode> | null = null;
let loadedAt = 0;

/**
 * Current mode of the global configuration. Cached for a minute; if the server cannot be reached the
 * last known mode (or the default, Opción 2) is used, so a download never fails because of it.
 */
export function loadBookLayoutMode(options: { force?: boolean } = {}): Promise<BookLayoutMode> {
  if (typeof fetch !== 'function') return Promise.resolve(getActiveBookLayoutMode());
  if (!options.force && loadedAt && Date.now() - loadedAt < REFRESH_MS) return Promise.resolve(getActiveBookLayoutMode());
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = setTimeout(() => controller?.abort(), 6000);
      try {
        const res = await fetch('/api/book-layout', { signal: controller?.signal, cache: 'no-store' });
        const body = await res.json().catch(() => null);
        if (res.ok && body?.success) {
          setActiveBookLayoutMode(body.data?.bookLayoutMode);
          loadedAt = Date.now();
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      console.warn('[BookLayout] No se pudo leer «Proporciones del libro»; se usa la última conocida:', err);
    } finally {
      inFlight = null;
    }
    return getActiveBookLayoutMode();
  })();
  return inFlight;
}

/** React hook: the mode currently in force (re-renders when it changes). */
export function useBookLayoutMode(): BookLayoutMode {
  return useSyncExternalStore(subscribeBookLayoutMode, getActiveBookLayoutMode, getActiveBookLayoutMode);
}
