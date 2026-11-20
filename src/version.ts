/**
 * Single source of truth for the version of the code that is running.
 *
 * Update APP_VERSION (and APP_RELEASE_DATE) with every delivered change. The administrator sees it
 * in a fixed label on every screen (AdminVersionBadge) and the server reports its own copy through
 * GET /api/admin/version, so a stale deployment (old frontend or old server) is visible at once.
 * Participants never see this label.
 */
export const APP_VERSION = '5.9.2';
export const APP_VERSION_LABEL = `V${APP_VERSION}`;
export const APP_RELEASE_DATE = '2026-11-20';
export const APP_RELEASE_SUMMARY =
  'Voz clonada: «Activar mi voz» revisa todas las grabaciones de la entrevista (antes una sola respuesta larga dejaba fuera a las demás), empieza por las de duración normal, muestra cuántas revisó, reintenta las que fallan y ofrece textos para leer en la muestra adicional.';
