/**
 * Single source of truth for the version of the code that is running.
 *
 * Update APP_VERSION (and APP_RELEASE_DATE) with every delivered change. The administrator sees it
 * in a fixed label on every screen (AdminVersionBadge) and the server reports its own copy through
 * GET /api/admin/version, so a stale deployment (old frontend or old server) is visible at once.
 * Participants never see this label.
 */
export const APP_VERSION = '5.6.3';
export const APP_VERSION_LABEL = `V${APP_VERSION}`;
export const APP_RELEASE_DATE = '2026-11-17';
export const APP_RELEASE_SUMMARY =
  'Modelos GPT-6 activos de verdad: se quitó el bloqueo fijo que reportaba gpt-6-luna como inexistente y lo cambiaba por otro modelo; "gpt-6" (nombre de familia) pasa a gpt-6-luna; las pruebas de conexión avisan cuando responde un modelo distinto al elegido.';
