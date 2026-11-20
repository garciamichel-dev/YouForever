/**
 * Single source of truth for the version of the code that is running.
 *
 * Update APP_VERSION (and APP_RELEASE_DATE) with every delivered change. The administrator sees it
 * in a fixed label on every screen (AdminVersionBadge) and the server reports its own copy through
 * GET /api/admin/version, so a stale deployment (old frontend or old server) is visible at once.
 * Participants never see this label.
 */
export const APP_VERSION = '5.9.3';
export const APP_VERSION_LABEL = `V${APP_VERSION}`;
export const APP_RELEASE_DATE = '2026-11-20';
export const APP_RELEASE_SUMMARY =
  'Voz clonada: «Activar mi voz» muestra el proceso completo con barra de porcentaje, pasos y detalle; avanza solo y sigue en segundo plano; al grabar la muestra hay cronómetro, medidor del micrófono y avisos en vivo; al final indica si terminó bien (con «Escuchar mi voz») o qué falló y qué hacer.';
