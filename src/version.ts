/**
 * Single source of truth for the version of the code that is running.
 *
 * Update APP_VERSION (and APP_RELEASE_DATE) with every delivered change. The administrator sees it
 * in a fixed label on every screen (AdminVersionBadge) and the server reports its own copy through
 * GET /api/admin/version, so a stale deployment (old frontend or old server) is visible at once.
 * Participants never see this label.
 */
export const APP_VERSION = '5.9.0';
export const APP_VERSION_LABEL = `V${APP_VERSION}`;
export const APP_RELEASE_DATE = '2026-11-20';
export const APP_RELEASE_SUMMARY =
  'Voz clonada con ElevenLabs y conversación de viva voz en Mi Esencia (función opcional): autorización al finalizar la entrevista o con «Activar mi voz», clon instantáneo o profesional, cuota diaria de mensajes de voz compartida por la familia y prueba comparativa de costos en Configuración Global.';
