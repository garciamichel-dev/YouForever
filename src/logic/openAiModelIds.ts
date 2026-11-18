/**
 * V5.6.3 — OpenAI model identifiers.
 *
 * Until V5.6.2 the server blocked the whole GPT-6 family (gpt-6, gpt-6-luna, gpt-6-astra,
 * gpt-6.1-sol, gpt-6.1-terra) with a hard-coded list written before those models were published,
 * and reported them as "non-existent" even when the OpenAI account listed them. OpenAI has served
 * them since September–October 2026, so availability is now decided ONLY by the account's own
 * model list and by the API's real answer (403/404 → that model is skipped).
 *
 * "gpt-6" alone is a family name, not an API identifier. By the administrator's decision it maps to
 * gpt-6-luna (also for configurations already saved with "gpt-6").
 */

export const OPENAI_DEFAULT_MODEL = 'gpt-6-luna';

/** Legacy / family names → the real API identifier that replaces them. */
const LEGACY_OPENAI_MODEL_ALIASES: Record<string, string> = {
  'gpt-6': OPENAI_DEFAULT_MODEL,
};

export function normalizeOpenAiModelId(model: string | undefined | null, fallback = OPENAI_DEFAULT_MODEL): string {
  const clean = String(model || '').trim();
  if (!clean) return fallback;
  return LEGACY_OPENAI_MODEL_ALIASES[clean.toLowerCase()] || clean;
}

/**
 * True only when OpenAI really said "this model does not exist / you have no access to it".
 * Decided by the HTTP status or the error code, never by a "403"/"404" that merely appears inside
 * some other error text (before V5.6.3 that could block a valid model until the server restarted).
 */
export function isOpenAiModelAccessError(err: unknown): boolean {
  const e = err as any;
  const status = Number(e?.status ?? e?.response?.status);
  if (status === 403 || status === 404) return true;
  const code = String(e?.code || e?.error?.code || '').toLowerCase();
  if (code === 'model_not_found' || code === 'model_not_available') return true;
  const msg = String(e?.message || '');
  return /model_not_found|the model [`'"]?[\w.\-]+[`'"]? does not exist|does not have access to (the )?model/i.test(msg);
}

/** OpenAI reasoning models: their output budget must also cover the hidden reasoning tokens. */
export function isOpenAiReasoningModel(model: string): boolean {
  return /^(gpt-6|gpt-5|o1|o3|o4)/i.test(String(model || '').trim());
}
