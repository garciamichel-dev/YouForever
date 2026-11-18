/**
 * Single source of truth for the version of the code that is running.
 *
 * Update APP_VERSION (and APP_RELEASE_DATE) with every delivered change. The administrator sees it
 * in a fixed label on every screen (AdminVersionBadge) and the server reports its own copy through
 * GET /api/admin/version, so a stale deployment (old frontend or old server) is visible at once.
 * Participants never see this label.
 */
export const APP_VERSION = '5.7.0';
export const APP_VERSION_LABEL = `V${APP_VERSION}`;
export const APP_RELEASE_DATE = '2026-11-18';
export const APP_RELEASE_SUMMARY =
  'Configuración Global: «Proporciones del libro» con Opción 1 (todo el libro como el visualizador anterior, letra grande) u Opción 2 (portada anterior + interior a 12 pt, predeterminada); visor y PDF siempre idénticos. Fotos más angostas que su marco: el PDF ya no redondea la foto ni tapa el borde.';
