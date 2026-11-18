/**
 * Single source of truth for the version of the code that is running.
 *
 * Update APP_VERSION (and APP_RELEASE_DATE) with every delivered change. The administrator sees it
 * in a fixed label on every screen (AdminVersionBadge) and the server reports its own copy through
 * GET /api/admin/version, so a stale deployment (old frontend or old server) is visible at once.
 * Participants never see this label.
 */
export const APP_VERSION = '5.8.3';
export const APP_VERSION_LABEL = `V${APP_VERSION}`;
export const APP_RELEASE_DATE = '2026-11-18';
export const APP_RELEASE_SUMMARY =
  'El libro completo del portal vuelve a incluir el «Índice General» cuando la casilla «Incluir índice» está marcada (también en libros ya guardados y descargas de administración); en el PDF, palabras con el mismo ancho que en el visualizador y líneas punteadas del índice.';
