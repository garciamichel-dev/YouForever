/**
 * Single source of truth for the version of the code that is running.
 *
 * Update APP_VERSION (and APP_RELEASE_DATE) with every delivered change. The administrator sees it
 * in a fixed label on every screen (AdminVersionBadge) and the server reports its own copy through
 * GET /api/admin/version, so a stale deployment (old frontend or old server) is visible at once.
 * Participants never see this label.
 */
export const APP_VERSION = '5.6.0';
export const APP_VERSION_LABEL = `V${APP_VERSION}`;
export const APP_RELEASE_DATE = '2026-11-17';
export const APP_RELEASE_SUMMARY =
  'Libro PDF idéntico al visualizador: mismo diseño, tipografías incrustadas (texto real), letra de libro de ~12 pt, páginas repartidas midiendo el diseño real y fotos a 300 ppp.';
