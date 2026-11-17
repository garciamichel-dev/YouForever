/**
 * Single source of truth for the version of the code that is running.
 *
 * Update APP_VERSION (and APP_RELEASE_DATE) with every delivered change. The administrator sees it
 * in a fixed label on every screen (AdminVersionBadge) and the server reports its own copy through
 * GET /api/admin/version, so a stale deployment (old frontend or old server) is visible at once.
 * Participants never see this label.
 */
export const APP_VERSION = '5.5.0';
export const APP_VERSION_LABEL = `V${APP_VERSION}`;
export const APP_RELEASE_DATE = '2026-11-17';
export const APP_RELEASE_SUMMARY =
  'Mi Esencia para el entrevistado: al guardar su libro PDF final accede directo a su representación digital (Gemini 3.1 Flash Lite, prompt GPT V6, plan mensual, 30 mensajes/día, espontaneidad moderada, acceso general) y puede recibir su enlace y código por correo.';
