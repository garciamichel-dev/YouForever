/**
 * Single source of truth for the version of the code that is running.
 *
 * Update APP_VERSION (and APP_RELEASE_DATE) with every delivered change. The administrator sees it
 * in a fixed label on every screen (AdminVersionBadge) and the server reports its own copy through
 * GET /api/admin/version, so a stale deployment (old frontend or old server) is visible at once.
 * Participants never see this label.
 */
export const APP_VERSION = '5.5.1';
export const APP_VERSION_LABEL = `V${APP_VERSION}`;
export const APP_RELEASE_DATE = '2026-11-17';
export const APP_RELEASE_SUMMARY =
  'Mi Esencia: gemini-3.8-flash es el modelo predeterminado; si falla en un mensaje responde un modelo de respaldo sin que el visitante lo note, y cada mensaje vuelve a intentar primero con 3.8 Flash.';
