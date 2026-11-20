/**
 * V5.9.0 — Voz clonada (ElevenLabs) y conversación de viva voz en «Mi Esencia».
 *
 * Reglas puras (sin red ni almacenamiento), usadas por el servidor y por las pantallas:
 * estados de la voz, configuración global, cuota diaria compartida, análisis de las muestras y
 * estimación de costos. Todo es ADITIVO: nada de esto cambia el chat escrito ni el libro.
 */

// ---------------------------------------------------------------------------------------------
// Modalidades, estados y textos
// ---------------------------------------------------------------------------------------------

/** IVC = YouForever crea el clon con las muestras autorizadas; PVC = el titular la crea y la comparte. */
export type VoiceCloneMode = 'ivc' | 'pvc';

export type VoiceProfileStatus =
  | 'sin_configurar'
  | 'en_proceso'
  | 'pendiente_verificacion'
  | 'lista'
  | 'error';

export const VOICE_STATUS_LABELS: Record<VoiceProfileStatus, string> = {
  sin_configurar: 'Sin configurar',
  en_proceso: 'En proceso',
  pendiente_verificacion: 'Pendiente de verificación',
  lista: 'Lista',
  error: 'Error',
};

export const VOICE_MODE_LABELS: Record<VoiceCloneMode, string> = {
  ivc: 'Clonación instantánea (IVC)',
  pvc: 'Clonación profesional (PVC)',
};

/** Texto exacto de la autorización (se guarda tal cual junto con la fecha). */
export const VOICE_CONSENT_TEXT =
  'Autorizo el uso de mis grabaciones para clonar mi voz y utilizarla en Mi Esencia';

export const VOICE_QUOTA_EXHAUSTED_MESSAGE =
  'Se alcanzó el límite diario de mensajes de voz. Puedes seguir conversando por texto';

/** Zona horaria del día de consumo (YouForever no tiene otra configurada para este propósito). */
export const VOICE_QUOTA_TIME_ZONE = 'America/Mexico_City';

// ---------------------------------------------------------------------------------------------
// Modelos de ElevenLabs y costos de referencia
// ---------------------------------------------------------------------------------------------

export interface TtsModelInfo {
  id: string;
  label: string;
  /** Créditos de ElevenLabs por carácter en la API (planes de autoservicio). */
  creditsPerCharacter: number;
  /** Precio público de la API por 1,000 caracteres (USD), para estimaciones. */
  estimatedUsdPer1kCharacters: number;
}

/**
 * Tarifas públicas de la API de ElevenLabs consultadas en noviembre de 2026 (precios por 1,000
 * caracteres). Sólo se usan para ESTIMAR cuando ElevenLabs no reporta el costo de una prueba; la
 * pantalla siempre las identifica como estimadas.
 */
export const TTS_MODELS: TtsModelInfo[] = [
  { id: 'eleven_flash_v2_5', label: 'Flash v2.5 (baja latencia, menor costo)', creditsPerCharacter: 0.5, estimatedUsdPer1kCharacters: 0.05 },
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2 (más natural)', creditsPerCharacter: 1, estimatedUsdPer1kCharacters: 0.1 },
  { id: 'eleven_v3', label: 'Eleven v3 (más expresivo)', creditsPerCharacter: 1, estimatedUsdPer1kCharacters: 0.1 },
  { id: 'eleven_turbo_v2_5', label: 'Turbo v2.5', creditsPerCharacter: 0.5, estimatedUsdPer1kCharacters: 0.05 },
];

export const DEFAULT_CONVERSATION_TTS_MODEL = 'eleven_flash_v2_5';
export const STT_MODEL_ID = 'scribe_v2';
/** Precio público de Scribe v2 (transcripción por lotes), USD por hora de audio. */
export const STT_ESTIMATED_USD_PER_HOUR = 0.22;
export const TTS_RATE_SOURCE = 'Tarifa pública de la API de ElevenLabs (noviembre de 2026)';

export function findTtsModel(modelId: string | undefined | null): TtsModelInfo | undefined {
  return TTS_MODELS.find((m) => m.id === modelId);
}

export function isSupportedTtsModel(modelId: unknown): modelId is string {
  return typeof modelId === 'string' && TTS_MODELS.some((m) => m.id === modelId);
}

/** Estimación del costo de sintetizar `characters` caracteres con un modelo (USD). */
export function estimateTtsCostUsd(modelId: string, characters: number): number | null {
  const model = findTtsModel(modelId);
  if (!model || !Number.isFinite(characters)) return null;
  return Math.round((Math.max(0, characters) / 1000) * model.estimatedUsdPer1kCharacters * 1e6) / 1e6;
}

/** Estimación del costo de transcribir `seconds` segundos con Scribe v2 (USD). */
export function estimateSttCostUsd(seconds: number): number {
  return Math.round((Math.max(0, seconds) / 3600) * STT_ESTIMATED_USD_PER_HOUR * 1e6) / 1e6;
}

/** Duración de un MP3 de bitrate constante (formato de salida mp3_44100_128). */
export const TTS_OUTPUT_FORMAT = 'mp3_44100_128';
export function mp3DurationSecondsFromBytes(byteLength: number, kbps = 128): number {
  if (!Number.isFinite(byteLength) || byteLength <= 0) return 0;
  return Math.round(((byteLength * 8) / (kbps * 1000)) * 100) / 100;
}

// ---------------------------------------------------------------------------------------------
// Configuración global
// ---------------------------------------------------------------------------------------------

export interface VoiceGlobalSettings {
  /** «Tipo de clonación de ElevenLabs»: se aplica sólo a las configuraciones NUEVAS. */
  cloningMode: VoiceCloneMode;
  /** «Cuota diaria predeterminada de mensajes de voz» por participante (compartida por la familia). */
  defaultDailyVoiceMessages: number;
  /** «Duración máxima por mensaje de voz» en segundos; null = sin límite. */
  maxSecondsPerVoiceMessage: number | null;
  /** Modelo de síntesis de las respuestas habladas en las conversaciones. */
  conversationTtsModelId: string;
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_VOICE_SETTINGS: VoiceGlobalSettings = {
  cloningMode: 'ivc',
  defaultDailyVoiceMessages: 30,
  maxSecondsPerVoiceMessage: null,
  conversationTtsModelId: DEFAULT_CONVERSATION_TTS_MODEL,
};

export const MAX_DAILY_VOICE_MESSAGES = 1000;
export const MAX_SECONDS_PER_VOICE_MESSAGE = 600;

/** Normaliza lo que llega del panel (valores fuera de rango se ignoran y se conserva el actual). */
export function normalizeVoiceSettings(
  input: Partial<VoiceGlobalSettings> | null | undefined,
  current: VoiceGlobalSettings = DEFAULT_VOICE_SETTINGS
): VoiceGlobalSettings {
  const next: VoiceGlobalSettings = { ...DEFAULT_VOICE_SETTINGS, ...current };
  if (!input) return next;
  if (input.cloningMode === 'ivc' || input.cloningMode === 'pvc') next.cloningMode = input.cloningMode;
  if (input.defaultDailyVoiceMessages !== undefined) {
    const n = Math.floor(Number(input.defaultDailyVoiceMessages));
    if (Number.isFinite(n) && n >= 0 && n <= MAX_DAILY_VOICE_MESSAGES) next.defaultDailyVoiceMessages = n;
  }
  if (input.maxSecondsPerVoiceMessage !== undefined) {
    if (input.maxSecondsPerVoiceMessage === null) next.maxSecondsPerVoiceMessage = null;
    else {
      const s = Math.floor(Number(input.maxSecondsPerVoiceMessage));
      if (Number.isFinite(s) && s >= 3 && s <= MAX_SECONDS_PER_VOICE_MESSAGE) next.maxSecondsPerVoiceMessage = s;
    }
  }
  if (isSupportedTtsModel(input.conversationTtsModelId)) next.conversationTtsModelId = input.conversationTtsModelId;
  return next;
}

// ---------------------------------------------------------------------------------------------
// Cuota diaria compartida
// ---------------------------------------------------------------------------------------------

/** Día de consumo (AAAA-MM-DD) en la zona horaria de YouForever. */
export function voiceQuotaDayKey(date: Date = new Date(), timeZone: string = VOICE_QUOTA_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Valor particular del participante (si lo hay) o el global. */
export function resolveVoiceDailyLimit(
  settings: Pick<VoiceGlobalSettings, 'defaultDailyVoiceMessages'>,
  override: number | null | undefined
): number {
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) return Math.floor(override);
  return Math.max(0, Math.floor(settings.defaultDailyVoiceMessages));
}

/** Tiempo que un cupo reservado espera la confirmación de entrega antes de liberarse solo. */
export const VOICE_RESERVATION_TTL_MS = 3 * 60 * 1000;
/** Turnos cobrados que se recuerdan por día (para no cobrar dos veces el mismo turno). */
export const VOICE_COMMITTED_TURN_MEMORY = 400;

export interface VoiceQuotaReservation {
  interlocutorId: string;
  createdAt: string;
  expiresAt: string;
}

export interface VoiceQuotaDayDoc {
  quotaKey: string;
  dayKey: string;
  committed: number;
  committedTurnIds: string[];
  reservations: Record<string, VoiceQuotaReservation>;
  updatedAt: string;
}

export function emptyQuotaDay(quotaKey: string, dayKey: string, nowIso: string): VoiceQuotaDayDoc {
  return { quotaKey, dayKey, committed: 0, committedTurnIds: [], reservations: {}, updatedAt: nowIso };
}

/** Quita las reservas vencidas (una interrupción nunca bloquea el saldo). */
export function pruneExpiredReservations(day: VoiceQuotaDayDoc, nowMs: number): VoiceQuotaDayDoc {
  const reservations: Record<string, VoiceQuotaReservation> = {};
  for (const [turnId, r] of Object.entries(day.reservations || {})) {
    if (Date.parse(r.expiresAt) > nowMs) reservations[turnId] = r;
  }
  return { ...day, reservations };
}

export type ReserveOutcome =
  | { kind: 'reserved'; day: VoiceQuotaDayDoc; remaining: number }
  | { kind: 'already_reserved'; day: VoiceQuotaDayDoc; remaining: number }
  | { kind: 'already_charged'; day: VoiceQuotaDayDoc; remaining: number }
  | { kind: 'exhausted'; day: VoiceQuotaDayDoc; remaining: 0 };

export function quotaRemaining(day: VoiceQuotaDayDoc, limit: number): number {
  return Math.max(0, limit - day.committed - Object.keys(day.reservations || {}).length);
}

/** Reserva un cupo para un turno (función pura; el servidor la ejecuta dentro de una transacción). */
export function reserveVoiceTurn(
  current: VoiceQuotaDayDoc,
  params: { turnId: string; interlocutorId: string; limit: number; nowMs: number; ttlMs?: number }
): ReserveOutcome {
  const day = pruneExpiredReservations(current, params.nowMs);
  if (day.committedTurnIds.includes(params.turnId)) {
    return { kind: 'already_charged', day, remaining: quotaRemaining(day, params.limit) };
  }
  const nowIso = new Date(params.nowMs).toISOString();
  const expiresAt = new Date(params.nowMs + (params.ttlMs ?? VOICE_RESERVATION_TTL_MS)).toISOString();
  if (day.reservations[params.turnId]) {
    const next = {
      ...day,
      reservations: { ...day.reservations, [params.turnId]: { ...day.reservations[params.turnId], expiresAt } },
      updatedAt: nowIso,
    };
    return { kind: 'already_reserved', day: next, remaining: quotaRemaining(next, params.limit) };
  }
  if (quotaRemaining(day, params.limit) <= 0) return { kind: 'exhausted', day, remaining: 0 };
  const next: VoiceQuotaDayDoc = {
    ...day,
    reservations: {
      ...day.reservations,
      [params.turnId]: { interlocutorId: params.interlocutorId, createdAt: nowIso, expiresAt },
    },
    updatedAt: nowIso,
  };
  return { kind: 'reserved', day: next, remaining: quotaRemaining(next, params.limit) };
}

export type CommitOutcome = 'charged' | 'already_charged' | 'not_reserved';

/** Confirma el consumo al entregar la respuesta (una sola vez por turno). */
export function commitVoiceTurn(
  current: VoiceQuotaDayDoc,
  params: { turnId: string; limit: number; nowMs: number }
): { outcome: CommitOutcome; day: VoiceQuotaDayDoc } {
  if (current.committedTurnIds.includes(params.turnId)) return { outcome: 'already_charged', day: current };
  const reservation = current.reservations?.[params.turnId];
  if (!reservation) return { outcome: 'not_reserved', day: current };
  const { [params.turnId]: _used, ...rest } = current.reservations;
  const pruned = pruneExpiredReservations({ ...current, reservations: rest }, params.nowMs);
  // A reservation that expired and whose slot another turn took is not charged beyond the limit.
  if (Date.parse(reservation.expiresAt) <= params.nowMs && quotaRemaining(pruned, params.limit) <= 0) {
    return { outcome: 'not_reserved', day: pruned };
  }
  const ids = [...current.committedTurnIds, params.turnId].slice(-VOICE_COMMITTED_TURN_MEMORY);
  return {
    outcome: 'charged',
    day: { ...pruned, committed: current.committed + 1, committedTurnIds: ids, updatedAt: new Date(params.nowMs).toISOString() },
  };
}

/** Libera la reserva de un turno que falló o se abandonó (no consume cuota). */
export function releaseVoiceTurn(current: VoiceQuotaDayDoc, turnId: string, nowMs: number): VoiceQuotaDayDoc {
  if (!current.reservations?.[turnId]) return current;
  const { [turnId]: _gone, ...rest } = current.reservations;
  return { ...current, reservations: rest, updatedAt: new Date(nowMs).toISOString() };
}

// ---------------------------------------------------------------------------------------------
// Muestras para la clonación instantánea
// ---------------------------------------------------------------------------------------------

/** ElevenLabs recomienda 1–2 minutos de voz limpia; con menos de 60 s se pide una muestra adicional. */
export const MIN_USABLE_SAMPLE_SECONDS = 60;
/**
 * Tope de audio que se analiza en cada revisión (cada análisis cuesta transcripción: ~US$0.04 por
 * 10 minutos). Si no alcanza, la siguiente revisión continúa con las grabaciones que faltan.
 */
export const MAX_ANALYZED_SAMPLE_SECONDS = 10 * 60;
/** Duración preferida de una grabación para revisarla primero (las muy largas tardan y fallan más). */
export const PREFERRED_RECORDING_SECONDS = { min: 15, max: 4 * 60 };
/** Una grabación muy larga cuenta, para el tope de cada revisión, como máximo esto. */
const LONG_RECORDING_BUDGET_SECONDS = 5 * 60;
/** Tope de audio que se envía a ElevenLabs para el clon. */
export const MAX_CLONE_SAMPLE_SECONDS = 3 * 60;
export const MIN_RECORDING_SECONDS = 4;
/** Proporción mínima de palabras del hablante principal para considerar la grabación de una sola voz. */
export const MIN_MAIN_SPEAKER_RATIO = 0.97;
export const MIN_WORDS_PER_SAMPLE = 6;

export interface DiarizedWord {
  text: string;
  start?: number;
  end?: number;
  type?: 'word' | 'spacing' | 'audio_event' | string;
  speaker_id?: string;
}

export type SampleRejectReason =
  | 'voces_superpuestas'
  | 'sin_voz_suficiente'
  | 'muy_corta'
  | 'no_se_pudo_analizar';

export interface SampleAssessment {
  usable: boolean;
  reason?: SampleRejectReason;
  speakerCount: number;
  mainSpeakerRatio: number;
  speechSeconds: number;
  wordCount: number;
}

export const SAMPLE_REJECT_LABELS: Record<SampleRejectReason, string> = {
  voces_superpuestas: 'se escuchan otras voces que no se pueden separar con confianza',
  sin_voz_suficiente: 'casi no contiene voz',
  muy_corta: 'es demasiado corta',
  no_se_pudo_analizar: 'no se pudo analizar',
};

/** Decide si una grabación sirve para clonar: una sola voz, clara y con suficiente habla. */
export function assessDiarizedSample(words: DiarizedWord[], durationSeconds?: number): SampleAssessment {
  const spoken = (words || []).filter((w) => (w.type || 'word') === 'word' && String(w.text || '').trim());
  const bySpeaker = new Map<string, number>();
  let speechSeconds = 0;
  for (const w of spoken) {
    const id = w.speaker_id || 'speaker_0';
    bySpeaker.set(id, (bySpeaker.get(id) || 0) + 1);
    if (typeof w.start === 'number' && typeof w.end === 'number' && w.end > w.start) speechSeconds += w.end - w.start;
  }
  const wordCount = spoken.length;
  const main = Math.max(0, ...Array.from(bySpeaker.values()));
  const ratio = wordCount > 0 ? main / wordCount : 0;
  const base = {
    speakerCount: bySpeaker.size,
    mainSpeakerRatio: Math.round(ratio * 1000) / 1000,
    speechSeconds: Math.round(speechSeconds * 10) / 10,
    wordCount,
  };
  if (typeof durationSeconds === 'number' && durationSeconds > 0 && durationSeconds < MIN_RECORDING_SECONDS) {
    return { usable: false, reason: 'muy_corta', ...base };
  }
  if (wordCount < MIN_WORDS_PER_SAMPLE) return { usable: false, reason: 'sin_voz_suficiente', ...base };
  if (bySpeaker.size > 1 && ratio < MIN_MAIN_SPEAKER_RATIO) return { usable: false, reason: 'voces_superpuestas', ...base };
  return { usable: true, ...base };
}

export interface CandidateRecording {
  id: string;
  durationSeconds?: number;
  mimeType?: string;
  createdAt?: string;
}

/** Grabaciones que pueden servir de muestra (una duración 0 significa «no registrada» y sí cuenta). */
export function isCandidateRecording(r: CandidateRecording | null | undefined): boolean {
  return Boolean(r && r.id && (r.durationSeconds || MIN_RECORDING_SECONDS) >= MIN_RECORDING_SECONDS);
}

/**
 * V5.9.2 — Elige qué grabaciones revisar en esta pasada:
 *  1. las de duración preferida (15 s a 4 min), de la más larga a la más corta;
 *  2. las cortas (4 a 15 s) y las de duración desconocida;
 *  3. al final las muy largas (más de 4 min), de la menos larga a la más larga.
 * Se omiten las ya revisadas (`exclude`). Antes se tomaban sólo las más largas hasta 6 min, así que una
 * sola respuesta larga dejaba fuera a todas las demás.
 */
export function selectCandidateRecordings<T extends CandidateRecording>(
  recordings: T[],
  maxTotalSeconds: number = MAX_ANALYZED_SAMPLE_SECONDS,
  exclude: ReadonlySet<string> = new Set()
): T[] {
  const { min, max } = PREFERRED_RECORDING_SECONDS;
  const tier = (r: T) => {
    const d = r.durationSeconds || 0;
    if (d >= min && d <= max) return 0;
    if (d > max) return 2;
    return 1;
  };
  const sorted = recordings
    .filter((r) => isCandidateRecording(r) && !exclude.has(r.id))
    .sort((a, b) => {
      const ta = tier(a);
      const tb = tier(b);
      if (ta !== tb) return ta - tb;
      const da = a.durationSeconds || 0;
      const db = b.durationSeconds || 0;
      const byDuration = ta === 2 ? da - db : db - da;
      return byDuration || String(a.id).localeCompare(String(b.id));
    });
  const picked: T[] = [];
  let total = 0;
  for (const r of sorted) {
    if (total >= maxTotalSeconds) break;
    picked.push(r);
    total += Math.min(r.durationSeconds || 30, LONG_RECORDING_BUDGET_SECONDS);
  }
  return picked;
}

/** Profile document id: one voice per participant of an interview. */
export function voiceProfileId(interviewId: string, participantId: string): string {
  return `${interviewId}__${participantId}`.replace(/[\/#?\[\]]/g, '_').slice(0, 128);
}

/** Enlace para compartir una voz de ElevenLabs → { publicUserId, voiceId }. */
export function parseElevenLabsShareLink(input: string): { publicUserId: string; voiceId: string } | null {
  const text = String(input || '').trim();
  if (!text) return null;
  const m = text.match(/share\/([A-Za-z0-9]{20,})\/([A-Za-z0-9]{10,})/);
  if (m) return { publicUserId: m[1], voiceId: m[2] };
  const pair = text.match(/^([A-Za-z0-9]{20,})[\s/,:]+([A-Za-z0-9]{10,})$/);
  if (pair) return { publicUserId: pair[1], voiceId: pair[2] };
  return null;
}
