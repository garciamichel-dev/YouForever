/**
 * Single source of truth for the version of the code that is running.
 *
 * Update APP_VERSION (and APP_RELEASE_DATE) with every delivered change. The administrator sees it
 * in a fixed label on every screen (AdminVersionBadge) and the server reports its own copy through
 * GET /api/admin/version, so a stale deployment (old frontend or old server) is visible at once.
 * Participants never see this label.
 */
export const APP_VERSION = '5.8.5';
export const APP_VERSION_LABEL = `V${APP_VERSION}`;
export const APP_RELEASE_DATE = '2026-11-19';
export const APP_RELEASE_SUMMARY =
  'Respaldos más seguros: antes de restaurar se crea un respaldo automático del estado actual (si no se puede, no se restaura), un respaldo ya no se pierde si Firestore falla (queda local con aviso y descarga, y se reintenta subir) e incluye completas las fotos y notas de voz; límites anti-spam configurables del registro gratuito; ajustes menores de seguridad y pruebas aisladas de Firestore real.';
