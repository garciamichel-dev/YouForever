/**
 * Single source of truth for the version of the code that is running.
 *
 * Update APP_VERSION (and APP_RELEASE_DATE) with every delivered change. The administrator sees it
 * in a fixed label on every screen (AdminVersionBadge) and the server reports its own copy through
 * GET /api/admin/version, so a stale deployment (old frontend or old server) is visible at once.
 * Participants never see this label.
 */
export const APP_VERSION = '5.6.2';
export const APP_VERSION_LABEL = `V${APP_VERSION}`;
export const APP_RELEASE_DATE = '2026-11-17';
export const APP_RELEASE_SUMMARY =
  'Seguridad de accesos: solo el código o enlace real da acceso (ya no el ID de la entrevista, del participante ni el hash), la revocación es definitiva hasta reactivarla, límite anti-fuerza bruta en todas las rutas con código e historias de prueba con códigos aleatorios y sin sembrado automático en producción.';
