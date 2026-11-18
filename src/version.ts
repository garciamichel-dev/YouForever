/**
 * Single source of truth for the version of the code that is running.
 *
 * Update APP_VERSION (and APP_RELEASE_DATE) with every delivered change. The administrator sees it
 * in a fixed label on every screen (AdminVersionBadge) and the server reports its own copy through
 * GET /api/admin/version, so a stale deployment (old frontend or old server) is visible at once.
 * Participants never see this label.
 */
export const APP_VERSION = '5.8.1';
export const APP_VERSION_LABEL = `V${APP_VERSION}`;
export const APP_RELEASE_DATE = '2026-11-18';
export const APP_RELEASE_SUMMARY =
  'Conóceme: el libro de la «Vista Previa Interactiva del Legado» es ahora una biografía completa en tercera persona, con páginas llenas y la misma maquetación que los libros del portal; «Crear mi historia gratis» y «Prueba gratuita» llevan al registro gratuito /free.';
