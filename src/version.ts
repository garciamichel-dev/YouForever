/**
 * Single source of truth for the version of the code that is running.
 *
 * Update APP_VERSION (and APP_RELEASE_DATE) with every delivered change. The administrator sees it
 * in a fixed label on every screen (AdminVersionBadge) and the server reports its own copy through
 * GET /api/admin/version, so a stale deployment (old frontend or old server) is visible at once.
 * Participants never see this label.
 */
export const APP_VERSION = '5.8.4';
export const APP_VERSION_LABEL = `V${APP_VERSION}`;
export const APP_RELEASE_DATE = '2026-11-18';
export const APP_RELEASE_SUMMARY =
  'Manuscritos y libros ya no se pierden al sincronizar con Firestore: los manuscritos se guardan de forma durable (en piezas si pasan de 800 KB, con reintento y reenvío automático) y solo se descarta lo que otra instancia borró; la restauración conserva las piezas de los registros grandes.';
