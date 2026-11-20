/**
 * V5.9.0 — Servicio de voz: clonación (IVC / PVC) y turnos de conversación de viva voz.
 *
 * Integración ADITIVA: lee las grabaciones de la entrevista (nunca las modifica; se envían copias),
 * y para conversar llama al MISMO flujo de Mi Esencia (motor Gemini/GPT, prompt, historial y
 * recuerdos autorizados). Sus datos viven en colecciones propias (voice_*).
 */
import crypto from 'node:crypto';
import {
  DEFAULT_VOICE_SETTINGS,
  MAX_CLONE_SAMPLE_SECONDS,
  MAX_ANALYZED_SAMPLE_SECONDS,
  MIN_USABLE_SAMPLE_SECONDS,
  SAMPLE_REJECT_LABELS,
  TTS_RATE_SOURCE,
  VOICE_CONSENT_TEXT,
  VOICE_QUOTA_EXHAUSTED_MESSAGE,
  assessDiarizedSample,
  commitVoiceTurn,
  emptyQuotaDay,
  estimateSttCostUsd,
  estimateTtsCostUsd,
  findTtsModel,
  isSupportedTtsModel,
  normalizeVoiceSettings,
  quotaRemaining,
  releaseVoiceTurn,
  reserveVoiceTurn,
  resolveVoiceDailyLimit,
  selectCandidateRecordings,
  voiceProfileId,
  voiceQuotaDayKey,
  parseElevenLabsShareLink,
  type CandidateRecording,
  type DiarizedWord,
  type SampleAssessment,
  type SampleRejectReason,
  type VoiceCloneMode,
  type VoiceGlobalSettings,
  type VoiceProfileStatus,
  type VoiceQuotaDayDoc,
} from '../../logic/voiceCloningRules.ts';
import { ElevenLabsError, type AudioFileInput, type ElevenLabsApi } from './elevenLabsClient.ts';
import { VOICE_COLLECTIONS, type VoiceDocStore } from './voiceDocStore.ts';

// ---------------------------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------------------------

export type VoiceConsentSource = 'finalizar_entrevista' | 'portal';

export interface VoiceSampleAnalysis {
  analyzedAt: string;
  analyzedAudioIds: string[];
  usableAudioIds: string[];
  usableSpeechSeconds: number;
  rejected: Array<{ audioId: string; reason: SampleRejectReason }>;
  usableExtraSampleIds: string[];
  sufficient: boolean;
  /** V5.9.1 — Recordings that could not be read or transcribed: they are retried (up to 3 attempts). */
  failedAttempts?: Record<string, { count: number; detail: string; at: string }>;
  /** Recordings that will be retried the next time the analysis runs. */
  retryPendingAudioIds?: string[];
  /** Technical reason of the last failure (visible only to the administrator). */
  lastErrorDetail?: string | null;
}

export interface VoiceProfileRecord {
  profileId: string;
  interviewId: string;
  participantId: string;
  participantName: string;
  status: VoiceProfileStatus;
  /** Modalidad fijada al crear la configuración (cambiar la global no la altera). */
  mode: VoiceCloneMode;
  voiceId: string | null;
  voiceName?: string;
  consent?: { text: string; grantedAt: string; source: VoiceConsentSource };
  analysis?: VoiceSampleAnalysis;
  extraSampleIds: string[];
  pvc?: { publicUserId: string; sourceVoiceId: string };
  /** Requisito pendiente del plan o de la cuenta, visible para el administrador. */
  requirementPending?: string | null;
  lock?: { lockId: string; expiresAt: string } | null;
  attemptCount: number;
  lastError?: string | null;
  lastErrorAt?: string | null;
  verifiedAt?: string | null;
  personId?: string | null;
  avatarId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VoiceExtraSampleRecord {
  sampleId: string;
  profileId: string;
  mimeType: string;
  audioBase64: string;
  durationSeconds: number | null;
  assessment?: SampleAssessment;
  createdAt: string;
}

export interface VoiceAdminTestRun {
  runId: string;
  purpose: 'comparar_modalidades' | 'comparar_modelos';
  profileId: string;
  participantName: string;
  mode: VoiceCloneMode;
  modelId: string;
  text: string;
  characters: number;
  audioSeconds: number;
  /** Créditos reportados por ElevenLabs en la respuesta (null si no los envió). */
  reportedCredits: number | null;
  estimatedUsd: number | null;
  estimatedUsdPerMinuteOfGeneratedAudio: number | null;
  rateUsdPer1kCharacters: number | null;
  rateSource: string;
  costKind: 'reportado_por_elevenlabs' | 'estimado';
  createdAt: string;
  createdBy: string;
}

export interface ParticipantContext {
  interviewId: string;
  participantId: string;
  participantName: string;
}

export interface VoiceInterviewAdapter {
  resolveParticipantToken(token: string): ParticipantContext;
  listParticipantRecordings(interviewId: string, participantId: string): CandidateRecording[];
  readRecording(audioId: string): Promise<{ buffer: Buffer; mimeType: string } | null>;
}

export interface FamilyAccessContext {
  interlocutorId: string;
  avatarId: string;
  personId: string;
  personName: string;
  interviewId: string | null;
  participantId: string | null;
}

export interface VoiceFamilyAdapter {
  verifyFamilyAccess(personalCode: string, selectedPersonId?: string): FamilyAccessContext;
  /** Mismo flujo de Mi Esencia que el chat escrito, con el canal de voz (no consume la cuota de texto). */
  converse(params: { personalCode: string; selectedPersonId: string; sessionId?: string; messageText: string }): Promise<any>;
}

export class VoiceServiceError extends Error {
  code: string;
  httpStatus: number;
  constructor(message: string, code: string, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

type CloneLockResult =
  | { acquired: true; lockId: string; profile: VoiceProfileRecord }
  | { acquired: false; profile: VoiceProfileRecord; reason: 'in_progress' | 'ready' };

const LOCK_TTL_MS = 4 * 60 * 1000;
const TURN_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_EXTRA_SAMPLE_BASE64 = 900_000; // < 1 MiB por documento de Firestore
/** A recording that fails to be read or transcribed is retried up to this many times. */
const MAX_ANALYSIS_ATTEMPTS = 3;

function describeFailure(err: unknown): string {
  if (err instanceof ElevenLabsError) return `ElevenLabs ${err.status || ''} ${err.detail || err.message}`.replace(/\s+/g, ' ').trim().slice(0, 300);
  return String((err as any)?.message || err || 'error desconocido').slice(0, 300);
}
const MAX_CLONE_FILES = 10;
const VERIFY_TEXT = 'Hola.';

const extFor = (mime: string) =>
  /webm/.test(mime) ? 'webm' : /ogg/.test(mime) ? 'ogg' : /mp4|m4a|aac/.test(mime) ? 'm4a' : /mpeg|mp3/.test(mime) ? 'mp3' : /wav/.test(mime) ? 'wav' : 'audio';

function friendlyError(err: unknown): string {
  if (err instanceof VoiceServiceError) return err.message;
  if (err instanceof ElevenLabsError) {
    if (err.detail === 'missing_api_key') return 'El servicio de voz no está configurado en el servidor.';
    if (err.status === 401) return 'La clave de ElevenLabs no es válida o no tiene permisos.';
    if (err.status === 402 || /quota|credits|limit/i.test(err.detail)) return 'La cuenta de ElevenLabs no tiene créditos o alcanzó un límite de su plan.';
    if (err.status === 422) return `ElevenLabs rechazó la solicitud: ${err.detail || 'datos no válidos'}.`;
    return 'El servicio de voz no respondió correctamente. Inténtalo más tarde.';
  }
  return 'Ocurrió un error inesperado en el servicio de voz.';
}

/** Requisito de plan o cuenta que el administrador debe resolver (o null si es un error común). */
function requirementFromError(err: unknown, mode: VoiceCloneMode): string | null {
  if (!(err instanceof ElevenLabsError)) return null;
  if (err.detail === 'missing_api_key') return 'Configurar el secreto ELEVENLABS_API_KEY en el servidor.';
  if (err.status === 401) return 'Revisar la clave ELEVENLABS_API_KEY (no válida o sin permisos de voces).';
  if (err.status === 402 || /quota|credits|plan|subscription|tier|upgrade/i.test(err.detail)) {
    return mode === 'pvc'
      ? 'El plan de la cuenta de YouForever no permite agregar voces compartidas por API (se requiere un plan de pago) o no tiene espacio para más voces.'
      : 'El plan de la cuenta de YouForever no permite la clonación instantánea o no tiene espacio para más voces.';
  }
  if (mode === 'pvc' && (err.status === 403 || err.status === 404)) {
    return 'La voz profesional no está compartida con la cuenta de YouForever o el enlace no es válido.';
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Servicio
// ---------------------------------------------------------------------------------------------

export class VoiceService {
  private readonly turnCache = new Map<string, { at: number; result: any }>();

  constructor(
    private readonly deps: {
      store: VoiceDocStore;
      client: ElevenLabsApi;
      interviews: VoiceInterviewAdapter;
      family: VoiceFamilyAdapter;
      now?: () => number;
    }
  ) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }
  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }

  // ----------------------------------------------------------------- configuración global ----
  async getSettings(): Promise<VoiceGlobalSettings> {
    const saved = await this.deps.store.get<VoiceGlobalSettings>(VOICE_COLLECTIONS.settings, 'global');
    return normalizeVoiceSettings(saved || undefined, DEFAULT_VOICE_SETTINGS);
  }

  async updateSettings(input: Partial<VoiceGlobalSettings>, updatedBy: string): Promise<VoiceGlobalSettings> {
    const current = await this.getSettings();
    const next = { ...normalizeVoiceSettings(input, current), updatedAt: this.nowIso(), updatedBy };
    await this.deps.store.set(VOICE_COLLECTIONS.settings, 'global', next);
    return next;
  }

  /** Valor particular de un participante (o del avatar sin entrevista); null = usa el global. */
  async getQuotaOverride(quotaKey: string): Promise<number | null> {
    const doc = await this.deps.store.get<{ dailyLimit: number | null }>(VOICE_COLLECTIONS.quotaOverrides, quotaKey);
    return typeof doc?.dailyLimit === 'number' ? doc.dailyLimit : null;
  }

  async setQuotaOverride(quotaKey: string, dailyLimit: number | null, updatedBy: string): Promise<number | null> {
    let value: number | null = null;
    if (dailyLimit !== null && dailyLimit !== undefined) {
      const n = Math.floor(Number(dailyLimit));
      if (!Number.isFinite(n) || n < 0 || n > 1000) throw new VoiceServiceError('La cuota debe ser un número entre 0 y 1000.', 'invalid_quota');
      value = n;
    }
    await this.deps.store.set(VOICE_COLLECTIONS.quotaOverrides, quotaKey, {
      quotaKey,
      dailyLimit: value,
      updatedAt: this.nowIso(),
      updatedBy,
    });
    return value;
  }

  async getQuotaStatus(quotaKey: string): Promise<{
    limit: number;
    used: number;
    reserved: number;
    remaining: number;
    usesGlobal: boolean;
    dayKey: string;
  }> {
    const [settings, override] = await Promise.all([this.getSettings(), this.getQuotaOverride(quotaKey)]);
    const limit = resolveVoiceDailyLimit(settings, override);
    const dayKey = voiceQuotaDayKey(new Date(this.now()));
    const day =
      (await this.deps.store.get<VoiceQuotaDayDoc>(VOICE_COLLECTIONS.quotaDays, `${quotaKey}__${dayKey}`)) ||
      emptyQuotaDay(quotaKey, dayKey, this.nowIso());
    const active = Object.values(day.reservations || {}).filter((r) => Date.parse(r.expiresAt) > this.now()).length;
    return {
      limit,
      used: day.committed,
      reserved: active,
      remaining: Math.max(0, limit - day.committed - active),
      usesGlobal: override === null,
      dayKey,
    };
  }

  // ----------------------------------------------------------------- perfiles ---------------
  async getProfile(profileId: string): Promise<VoiceProfileRecord | null> {
    return this.deps.store.get<VoiceProfileRecord>(VOICE_COLLECTIONS.profiles, profileId);
  }

  async listProfilesForInterview(interviewId: string): Promise<VoiceProfileRecord[]> {
    return this.deps.store.listWhere<VoiceProfileRecord>(VOICE_COLLECTIONS.profiles, 'interviewId', interviewId);
  }

  async listAllProfiles(): Promise<VoiceProfileRecord[]> {
    return this.deps.store.listAll<VoiceProfileRecord>(VOICE_COLLECTIONS.profiles);
  }

  /** Vista del participante (sin datos internos de ElevenLabs). */
  publicProfile(p: VoiceProfileRecord | null, settings: VoiceGlobalSettings) {
    const lockActive = Boolean(p?.lock && Date.parse(p.lock.expiresAt) > this.now());
    return {
      exists: Boolean(p),
      status: (p?.status || 'sin_configurar') as VoiceProfileStatus,
      mode: (p?.mode || settings.cloningMode) as VoiceCloneMode,
      authorized: Boolean(p?.consent),
      inProgress: p?.status === 'en_proceso' && lockActive,
      ready: p?.status === 'lista' && Boolean(p?.voiceId),
      lastError: p?.status === 'error' ? p?.lastError || null : null,
      analysis: p?.analysis
        ? {
            sufficient: p.analysis.sufficient,
            usableSpeechSeconds: p.analysis.usableSpeechSeconds,
            usableRecordings: p.analysis.usableAudioIds.length,
            rejected: p.analysis.rejected.map((r) => ({ reason: r.reason, label: SAMPLE_REJECT_LABELS[r.reason] })),
            retryPending: p.analysis.retryPendingAudioIds?.length || 0,
          }
        : null,
      extraSamples: p?.extraSampleIds?.length || 0,
      consentText: VOICE_CONSENT_TEXT,
    };
  }

  async participantStatus(token: string) {
    const ctx = this.deps.interviews.resolveParticipantToken(token);
    const settings = await this.getSettings();
    const profile = await this.getProfile(voiceProfileId(ctx.interviewId, ctx.participantId));
    const recordings = this.deps.interviews.listParticipantRecordings(ctx.interviewId, ctx.participantId);
    return {
      ...this.publicProfile(profile, settings),
      recordingsAvailable: recordings.length,
      serviceConfigured: this.deps.client.configured,
    };
  }

  /** Guarda la autorización (idempotente) y crea la configuración con la modalidad global vigente. */
  async authorize(token: string, source: VoiceConsentSource) {
    const ctx = this.deps.interviews.resolveParticipantToken(token);
    const settings = await this.getSettings();
    const id = voiceProfileId(ctx.interviewId, ctx.participantId);
    const nowIso = this.nowIso();
    const profile = await this.deps.store.atomicUpdate<VoiceProfileRecord, VoiceProfileRecord>(
      VOICE_COLLECTIONS.profiles,
      id,
      (current) => {
        const base: VoiceProfileRecord =
          current ||
          ({
            profileId: id,
            interviewId: ctx.interviewId,
            participantId: ctx.participantId,
            participantName: ctx.participantName,
            status: 'sin_configurar',
            mode: settings.cloningMode,
            voiceId: null,
            extraSampleIds: [],
            attemptCount: 0,
            createdAt: nowIso,
            updatedAt: nowIso,
          } as VoiceProfileRecord);
        if (base.consent) return { next: current ? undefined : base, result: base };
        const next = { ...base, consent: { text: VOICE_CONSENT_TEXT, grantedAt: nowIso, source }, updatedAt: nowIso };
        return { next, result: next };
      }
    );
    return this.publicProfile(profile, settings);
  }

  private async requireConsentedProfile(token: string): Promise<{ ctx: ParticipantContext; profile: VoiceProfileRecord }> {
    const ctx = this.deps.interviews.resolveParticipantToken(token);
    const profile = await this.getProfile(voiceProfileId(ctx.interviewId, ctx.participantId));
    if (!profile?.consent) {
      throw new VoiceServiceError('Primero confirma la autorización para clonar tu voz.', 'consent_required', 403);
    }
    return { ctx, profile };
  }

  // ----------------------------------------------------------------- muestras ---------------
  private async transcribeForAssessment(
    file: AudioFileInput,
    durationSeconds?: number
  ): Promise<SampleAssessment & { failureDetail?: string }> {
    try {
      const stt = await this.deps.client.speechToText({ file, diarize: true, languageCode: 'es' });
      return assessDiarizedSample(stt.words as DiarizedWord[], durationSeconds);
    } catch (err) {
      if (err instanceof ElevenLabsError && (err.detail === 'missing_api_key' || err.status === 401)) throw err;
      const failureDetail = describeFailure(err);
      console.warn(`[voz] No se pudo transcribir la muestra ${file.fileName} (${file.mimeType}, ${file.buffer.length} bytes): ${failureDetail}`);
      return { usable: false, reason: 'no_se_pudo_analizar', speakerCount: 0, mainSpeakerRatio: 0, speechSeconds: 0, wordCount: 0, failureDetail };
    }
  }

  /**
   * Revisa las grabaciones de la entrevista del propio participante (copias) y decide si alcanzan
   * para un clon instantáneo. Se analiza una sola vez por grabación.
   */
  async analyzeSamples(token: string) {
    const { ctx, profile } = await this.requireConsentedProfile(token);
    const settings = await this.getSettings();
    const recordings = this.deps.interviews.listParticipantRecordings(ctx.interviewId, ctx.participantId);
    const prev = profile.analysis;
    const failedAttempts: Record<string, { count: number; detail: string; at: string }> = { ...(prev?.failedAttempts || {}) };
    // A recording that could not be read or transcribed is retried, unless it already failed too many times
    // (this also re-opens the failures saved by V5.9.0, which were never retried).
    const isRetryable = (audioId: string) => (failedAttempts[audioId]?.count || 0) < MAX_ANALYSIS_ATTEMPTS;
    const retryable = new Set(
      (prev?.rejected || []).filter((r) => r.reason === 'no_se_pudo_analizar' && isRetryable(r.audioId)).map((r) => r.audioId)
    );
    const already = new Set((prev?.analyzedAudioIds || []).filter((id) => !retryable.has(id)));
    const usable = new Set(prev?.usableAudioIds || []);
    const rejectedById = new Map<string, { audioId: string; reason: SampleRejectReason }>();
    for (const r of prev?.rejected || []) if (!retryable.has(r.audioId)) rejectedById.set(r.audioId, r);
    let usableSeconds = prev?.usableSpeechSeconds || 0;
    let analyzedSeconds = 0;
    let lastErrorDetail: string | null = prev?.lastErrorDetail || null;
    const retryPending = new Set<string>();

    const noteFailure = (audioId: string, detail: string) => {
      const count = (failedAttempts[audioId]?.count || 0) + 1;
      failedAttempts[audioId] = { count, detail, at: this.nowIso() };
      lastErrorDetail = detail;
      if (count >= MAX_ANALYSIS_ATTEMPTS) {
        already.add(audioId);
        rejectedById.set(audioId, { audioId, reason: 'no_se_pudo_analizar' });
      } else {
        retryPending.add(audioId);
      }
    };

    for (const rec of selectCandidateRecordings(recordings, MAX_ANALYZED_SAMPLE_SECONDS)) {
      if (usableSeconds >= MIN_USABLE_SAMPLE_SECONDS * 2) break;
      if (already.has(rec.id)) continue;
      analyzedSeconds += rec.durationSeconds || 0;
      let media: { buffer: Buffer; mimeType: string } | null = null;
      try {
        media = await this.deps.interviews.readRecording(rec.id);
      } catch (err) {
        console.warn(`[voz] No se pudo leer la grabación ${rec.id}: ${describeFailure(err)}`);
      }
      if (!media || !media.buffer?.length) {
        noteFailure(rec.id, 'No se encontró el audio de la grabación en el almacenamiento.');
        continue;
      }
      const a = await this.transcribeForAssessment(
        { buffer: media.buffer, mimeType: media.mimeType, fileName: `${rec.id}.${extFor(media.mimeType)}` },
        rec.durationSeconds || undefined
      );
      if (a.failureDetail) {
        noteFailure(rec.id, a.failureDetail);
        continue;
      }
      already.add(rec.id);
      delete failedAttempts[rec.id];
      if (a.usable) {
        usable.add(rec.id);
        rejectedById.delete(rec.id);
        usableSeconds += a.speechSeconds || rec.durationSeconds || 0;
      } else {
        rejectedById.set(rec.id, { audioId: rec.id, reason: a.reason || 'no_se_pudo_analizar' });
      }
    }
    if (Object.keys(failedAttempts).length === 0) lastErrorDetail = null;
    const rejected = Array.from(rejectedById.values());

    const extras = await this.loadExtraSamples(profile);
    const usableExtraSampleIds = extras.filter((s) => s.assessment?.usable).map((s) => s.sampleId);
    const extraSeconds = extras
      .filter((s) => s.assessment?.usable)
      .reduce((sum, s) => sum + (s.assessment?.speechSeconds || s.durationSeconds || 0), 0);

    const analysis: VoiceSampleAnalysis = {
      analyzedAt: this.nowIso(),
      analyzedAudioIds: Array.from(already),
      usableAudioIds: Array.from(usable),
      usableSpeechSeconds: Math.round(usableSeconds * 10) / 10,
      rejected,
      usableExtraSampleIds,
      sufficient: usableSeconds + extraSeconds >= MIN_USABLE_SAMPLE_SECONDS,
      failedAttempts,
      retryPendingAudioIds: Array.from(retryPending),
      lastErrorDetail,
    };
    const saved = await this.deps.store.atomicUpdate<VoiceProfileRecord, VoiceProfileRecord>(
      VOICE_COLLECTIONS.profiles,
      profile.profileId,
      (current) => {
        const next = { ...(current || profile), analysis, updatedAt: this.nowIso() };
        return { next, result: next };
      }
    );
    return { ...this.publicProfile(saved, settings), analyzedSecondsThisRun: analyzedSeconds };
  }

  private async loadExtraSamples(profile: VoiceProfileRecord): Promise<VoiceExtraSampleRecord[]> {
    const out: VoiceExtraSampleRecord[] = [];
    for (const id of profile.extraSampleIds || []) {
      const s = await this.deps.store.get<VoiceExtraSampleRecord>(VOICE_COLLECTIONS.extraSamples, id);
      if (s) out.push(s);
    }
    return out;
  }

  /** Muestra adicional grabada por el participante (que ya pudo escuchar antes de enviarla). */
  async submitExtraSample(token: string, input: { audioBase64: string; mimeType: string; durationSeconds?: number }) {
    const { profile } = await this.requireConsentedProfile(token);
    const settings = await this.getSettings();
    const b64 = String(input.audioBase64 || '').replace(/^data:[^,]+,/, '');
    if (!b64) throw new VoiceServiceError('La muestra está vacía.', 'empty_sample');
    if (b64.length > MAX_EXTRA_SAMPLE_BASE64) {
      throw new VoiceServiceError('La muestra es demasiado larga. Graba entre 30 y 90 segundos.', 'sample_too_large');
    }
    const mimeType = String(input.mimeType || 'audio/webm');
    const buffer = Buffer.from(b64, 'base64');
    const sampleId = `vs_${crypto.randomBytes(6).toString('hex')}`;
    const assessment = await this.transcribeForAssessment(
      { buffer, mimeType, fileName: `${sampleId}.${extFor(mimeType)}` },
      input.durationSeconds
    );
    const sample: VoiceExtraSampleRecord = {
      sampleId,
      profileId: profile.profileId,
      mimeType,
      audioBase64: b64,
      durationSeconds: Number.isFinite(Number(input.durationSeconds)) ? Number(input.durationSeconds) : null,
      assessment,
      createdAt: this.nowIso(),
    };
    await this.deps.store.set(VOICE_COLLECTIONS.extraSamples, sampleId, sample);
    await this.deps.store.atomicUpdate<VoiceProfileRecord, VoiceProfileRecord>(VOICE_COLLECTIONS.profiles, profile.profileId, (current) => {
      const base = current || profile;
      const next = { ...base, extraSampleIds: [...(base.extraSampleIds || []), sampleId], updatedAt: this.nowIso() };
      return { next, result: next };
    });
    const analyzed = await this.analyzeSamples(token);
    return {
      ...analyzed,
      sample: {
        usable: assessment.usable,
        reason: assessment.reason ? SAMPLE_REJECT_LABELS[assessment.reason] : null,
        speechSeconds: assessment.speechSeconds,
      },
      settingsMode: settings.cloningMode,
    };
  }

  // ----------------------------------------------------------------- bloqueo de un solo intento ---
  /**
   * Toma el turno para crear o vincular la voz. Clics repetidos, reintentos o solicitudes
   * simultáneas no crean otra voz: el segundo encuentra el proceso en curso o la voz ya lista.
   */
  private async acquireCloneLock(profileId: string): Promise<CloneLockResult> {
    const lockId = crypto.randomBytes(8).toString('hex');
    const now = this.now();
    return this.deps.store.atomicUpdate<VoiceProfileRecord, CloneLockResult>(VOICE_COLLECTIONS.profiles, profileId, (current) => {
      if (!current) throw new VoiceServiceError('No se encontró la configuración de voz.', 'not_found', 404);
      if (current.status === 'lista' && current.voiceId) return { next: undefined, result: { acquired: false, profile: current, reason: 'ready' as const } };
      if (current.lock && Date.parse(current.lock.expiresAt) > now) {
        return { next: undefined, result: { acquired: false, profile: current, reason: 'in_progress' as const } };
      }
      const next: VoiceProfileRecord = {
        ...current,
        status: current.status === 'pendiente_verificacion' ? 'pendiente_verificacion' : 'en_proceso',
        lock: { lockId, expiresAt: new Date(now + LOCK_TTL_MS).toISOString() },
        attemptCount: (current.attemptCount || 0) + 1,
        lastError: null,
        updatedAt: new Date(now).toISOString(),
      };
      return { next, result: { acquired: true as const, lockId, profile: next } };
    });
  }

  private async finishCloneAttempt(
    profileId: string,
    lockId: string,
    patch: Partial<VoiceProfileRecord>
  ): Promise<VoiceProfileRecord> {
    return this.deps.store.atomicUpdate(VOICE_COLLECTIONS.profiles, profileId, (current: VoiceProfileRecord | null) => {
      if (!current) throw new VoiceServiceError('No se encontró la configuración de voz.', 'not_found', 404);
      // Only the owner of the attempt writes its outcome.
      if (current.lock && current.lock.lockId !== lockId) return { next: undefined, result: current };
      const next = { ...current, ...patch, lock: null, updatedAt: this.nowIso() };
      return { next, result: next };
    });
  }

  /** El servidor comprueba que la voz existe en la cuenta y que puede sintetizar con ella. */
  private async verifyUsable(voiceId: string, modelId: string): Promise<boolean> {
    const voice = await this.deps.client.getVoice(voiceId);
    if (!voice) return false;
    const tts = await this.deps.client.textToSpeech({ voiceId, text: VERIFY_TEXT, modelId, languageCode: 'es' });
    return tts.audio.length > 0;
  }

  // ----------------------------------------------------------------- IVC --------------------
  async startInstantClone(token: string) {
    const { ctx, profile } = await this.requireConsentedProfile(token);
    const settings = await this.getSettings();
    if (profile.mode !== 'ivc') {
      throw new VoiceServiceError('Tu configuración usa la clonación profesional: vincula tu voz verificada.', 'wrong_mode');
    }
    if (!profile.analysis?.sufficient) {
      throw new VoiceServiceError('Hace falta una muestra adicional de tu voz antes de crear el clon.', 'needs_extra_sample');
    }
    const lock = await this.acquireCloneLock(profile.profileId);
    if (!lock.acquired) return { ...this.publicProfile(lock.profile, settings), duplicatePrevented: true };

    const voiceName = `YouForever · ${ctx.participantName} · ${profile.profileId}`.slice(0, 100);
    try {
      // A previous attempt may have created the voice and been interrupted before saving it.
      let voiceId = await this.deps.client.findVoiceByName(voiceName).catch(() => null);
      let requiresVerification = false;
      if (!voiceId) {
        const files = await this.collectCloneFiles(lock.profile);
        if (files.length === 0) throw new VoiceServiceError('No se encontraron muestras utilizables.', 'needs_extra_sample');
        const created = await this.deps.client.createIvcVoice({
          name: voiceName,
          files,
          description: 'Voz clonada con autorización del titular para Mi Esencia (YouForever).',
          removeBackgroundNoise: true,
          labels: { app: 'youforever', profile: profile.profileId },
        });
        voiceId = created.voiceId;
        requiresVerification = created.requiresVerification;
      }
      if (requiresVerification) {
        const saved = await this.finishCloneAttempt(profile.profileId, lock.lockId, {
          voiceId,
          voiceName,
          status: 'pendiente_verificacion',
          requirementPending: 'ElevenLabs marcó la voz para verificación; complétala en la cuenta de YouForever.',
        });
        return this.publicProfile(saved, settings);
      }
      const ok = await this.verifyUsable(voiceId, settings.conversationTtsModelId);
      const saved = await this.finishCloneAttempt(profile.profileId, lock.lockId, {
        voiceId,
        voiceName,
        status: ok ? 'lista' : 'pendiente_verificacion',
        verifiedAt: ok ? this.nowIso() : null,
        requirementPending: ok ? null : 'La voz se creó pero el servidor aún no puede sintetizar con ella.',
      });
      return this.publicProfile(saved, settings);
    } catch (err) {
      const saved = await this.finishCloneAttempt(profile.profileId, lock.lockId, {
        status: 'error',
        lastError: friendlyError(err),
        lastErrorAt: this.nowIso(),
        requirementPending: requirementFromError(err, 'ivc'),
      });
      return this.publicProfile(saved, settings);
    }
  }

  /** Copias de las grabaciones útiles (y de las muestras adicionales), hasta ~3 minutos. */
  private async collectCloneFiles(profile: VoiceProfileRecord): Promise<AudioFileInput[]> {
    const files: AudioFileInput[] = [];
    let seconds = 0;
    const recordings = new Map(
      this.deps.interviews.listParticipantRecordings(profile.interviewId, profile.participantId).map((r) => [r.id, r])
    );
    for (const id of profile.analysis?.usableAudioIds || []) {
      if (files.length >= MAX_CLONE_FILES || seconds >= MAX_CLONE_SAMPLE_SECONDS) break;
      const media = await this.deps.interviews.readRecording(id);
      if (!media) continue;
      files.push({ buffer: Buffer.from(media.buffer), mimeType: media.mimeType, fileName: `${id}.${extFor(media.mimeType)}` });
      seconds += recordings.get(id)?.durationSeconds || 30;
    }
    for (const s of await this.loadExtraSamples(profile)) {
      if (files.length >= MAX_CLONE_FILES) break;
      if (!s.assessment?.usable) continue;
      files.push({ buffer: Buffer.from(s.audioBase64, 'base64'), mimeType: s.mimeType, fileName: `${s.sampleId}.${extFor(s.mimeType)}` });
    }
    return files;
  }

  // ----------------------------------------------------------------- PVC --------------------
  /** Vincula la voz profesional que el titular creó, verificó y compartió con la cuenta de YouForever. */
  async linkProfessionalVoice(token: string, shareLink: string) {
    const { ctx, profile } = await this.requireConsentedProfile(token);
    const settings = await this.getSettings();
    if (profile.mode !== 'pvc') {
      throw new VoiceServiceError('Tu configuración usa la clonación instantánea.', 'wrong_mode');
    }
    const parsed = parseElevenLabsShareLink(shareLink);
    if (!parsed) {
      throw new VoiceServiceError('Pega el enlace para compartir tu voz de ElevenLabs (incluye /share/…/…).', 'invalid_share_link');
    }
    const lock = await this.acquireCloneLock(profile.profileId);
    if (!lock.acquired) return { ...this.publicProfile(lock.profile, settings), duplicatePrevented: true };
    const voiceName = `YouForever PVC · ${ctx.participantName} · ${profile.profileId}`.slice(0, 100);
    try {
      let voiceId = await this.deps.client.findVoiceByName(voiceName).catch(() => null);
      if (!voiceId) {
        const added = await this.deps.client.addSharedVoice({ publicUserId: parsed.publicUserId, voiceId: parsed.voiceId, newName: voiceName });
        voiceId = added.voiceId;
      }
      const ok = await this.verifyUsable(voiceId, settings.conversationTtsModelId);
      const saved = await this.finishCloneAttempt(profile.profileId, lock.lockId, {
        voiceId,
        voiceName,
        pvc: { publicUserId: parsed.publicUserId, sourceVoiceId: parsed.voiceId },
        status: ok ? 'lista' : 'pendiente_verificacion',
        verifiedAt: ok ? this.nowIso() : null,
        requirementPending: ok ? null : 'Se vinculó la voz, pero la cuenta todavía no puede sintetizar con ella.',
      });
      return this.publicProfile(saved, settings);
    } catch (err) {
      let requirement = requirementFromError(err, 'pvc');
      if (!requirement) {
        const sub = await this.deps.client.getSubscription().catch(() => null);
        if (sub && /free/i.test(sub.tier)) requirement = 'Las voces compartidas no están disponibles por API en el plan gratuito de ElevenLabs.';
      }
      const saved = await this.finishCloneAttempt(profile.profileId, lock.lockId, {
        status: 'error',
        lastError: friendlyError(err),
        lastErrorAt: this.nowIso(),
        requirementPending: requirement,
      });
      return this.publicProfile(saved, settings);
    }
  }

  /** Vuelve a comprobar una voz pendiente de verificación (sin crear otra). */
  async recheckPending(token: string) {
    const { profile } = await this.requireConsentedProfile(token);
    const settings = await this.getSettings();
    if (profile.status !== 'pendiente_verificacion' || !profile.voiceId) return this.publicProfile(profile, settings);
    const lock = await this.acquireCloneLock(profile.profileId);
    if (!lock.acquired) return this.publicProfile(lock.profile, settings);
    try {
      const ok = await this.verifyUsable(profile.voiceId, settings.conversationTtsModelId);
      const saved = await this.finishCloneAttempt(profile.profileId, lock.lockId, {
        status: ok ? 'lista' : 'pendiente_verificacion',
        verifiedAt: ok ? this.nowIso() : null,
        requirementPending: ok ? null : profile.requirementPending || null,
      });
      return this.publicProfile(saved, settings);
    } catch (err) {
      const saved = await this.finishCloneAttempt(profile.profileId, lock.lockId, {
        status: 'pendiente_verificacion',
        lastError: friendlyError(err),
        lastErrorAt: this.nowIso(),
      });
      return this.publicProfile(saved, settings);
    }
  }

  // ----------------------------------------------------------------- conversación -----------
  private async resolveFamilyVoice(personalCode: string, selectedPersonId?: string) {
    const access = this.deps.family.verifyFamilyAccess(personalCode, selectedPersonId);
    const profile =
      access.interviewId && access.participantId
        ? await this.getProfile(voiceProfileId(access.interviewId, access.participantId))
        : null;
    const quotaKey = access.interviewId || `avatar_${access.avatarId}`;
    const ready = Boolean(profile && profile.status === 'lista' && profile.voiceId && profile.verifiedAt);
    if (ready && profile && (profile.personId !== access.personId || profile.avatarId !== access.avatarId)) {
      // Associate the voice with the digital representation (best effort, no other field changes).
      await this.deps.store
        .atomicUpdate<VoiceProfileRecord, null>(VOICE_COLLECTIONS.profiles, profile.profileId, (current) => ({
          next: current ? { ...current, personId: access.personId, avatarId: access.avatarId } : undefined,
          result: null,
        }))
        .catch(() => null);
    }
    return { access, profile, quotaKey, ready };
  }

  async familyVoiceStatus(personalCode: string, selectedPersonId?: string) {
    const { profile, quotaKey, ready } = await this.resolveFamilyVoice(personalCode, selectedPersonId);
    const settings = await this.getSettings();
    const quota = await this.getQuotaStatus(quotaKey);
    return {
      available: ready && this.deps.client.configured,
      status: (profile?.status || 'sin_configurar') as VoiceProfileStatus,
      quota,
      maxSecondsPerMessage: settings.maxSecondsPerVoiceMessage,
      exhaustedMessage: VOICE_QUOTA_EXHAUSTED_MESSAGE,
    };
  }

  private async atomicQuota<R>(quotaKey: string, fn: (day: VoiceQuotaDayDoc, limit: number, nowMs: number) => { next?: VoiceQuotaDayDoc; result: R }) {
    const [settings, override] = await Promise.all([this.getSettings(), this.getQuotaOverride(quotaKey)]);
    const limit = resolveVoiceDailyLimit(settings, override);
    const nowMs = this.now();
    const dayKey = voiceQuotaDayKey(new Date(nowMs));
    const id = `${quotaKey}__${dayKey}`;
    return this.deps.store.atomicUpdate<VoiceQuotaDayDoc, R>(VOICE_COLLECTIONS.quotaDays, id, (current) => {
      const day = current || emptyQuotaDay(quotaKey, dayKey, new Date(nowMs).toISOString());
      const { next, result } = fn(day, limit, nowMs);
      return { next, result };
    });
  }

  /**
   * Un turno de voz: reserva un cupo (transacción), transcribe, pasa el texto confirmado al flujo
   * de Mi Esencia y sintetiza la respuesta con la voz clonada. El cupo se COBRA sólo cuando el
   * navegador confirma la entrega (`acknowledgeTurn`); cualquier fallo lo libera.
   */
  async familyTurn(input: {
    personalCode: string;
    selectedPersonId?: string;
    sessionId?: string;
    turnId: string;
    audioBase64: string;
    mimeType: string;
    durationSeconds?: number;
  }) {
    const turnId = String(input.turnId || '').trim();
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(turnId)) throw new VoiceServiceError('Identificador de turno no válido.', 'invalid_turn');
    const cached = this.turnCache.get(turnId);
    if (cached && this.now() - cached.at < TURN_CACHE_TTL_MS) return cached.result;

    const { access, profile, quotaKey, ready } = await this.resolveFamilyVoice(input.personalCode, input.selectedPersonId);
    if (!ready || !profile?.voiceId) {
      throw new VoiceServiceError('La voz de esta representación todavía no está lista. Puedes seguir por texto.', 'voice_not_ready', 409);
    }
    if (!this.deps.client.configured) {
      throw new VoiceServiceError('El servicio de voz no está disponible. Puedes seguir por texto.', 'service_unavailable', 503);
    }
    const settings = await this.getSettings();
    const maxSeconds = settings.maxSecondsPerVoiceMessage;
    const declared = Number(input.durationSeconds);
    if (maxSeconds !== null && Number.isFinite(declared) && declared > maxSeconds + 2) {
      throw new VoiceServiceError(`El mensaje supera la duración máxima de ${maxSeconds} segundos.`, 'too_long');
    }
    const b64 = String(input.audioBase64 || '').replace(/^data:[^,]+,/, '');
    if (!b64) throw new VoiceServiceError('No se recibió audio.', 'empty_audio');

    const reserve = await this.atomicQuota(quotaKey, (day, limit, nowMs) => {
      const r = reserveVoiceTurn(day, { turnId, interlocutorId: access.interlocutorId, limit, nowMs });
      return { next: r.kind === 'exhausted' || r.kind === 'already_charged' ? undefined : r.day, result: { ...r, limit } };
    });
    if (reserve.kind === 'exhausted') {
      throw new VoiceServiceError(VOICE_QUOTA_EXHAUSTED_MESSAGE, 'quota_exhausted', 429);
    }
    if (reserve.kind === 'already_charged') {
      throw new VoiceServiceError('Este turno ya se entregó.', 'turn_already_delivered', 409);
    }

    try {
      const mimeType = String(input.mimeType || 'audio/webm');
      const stt = await this.deps.client.speechToText({
        file: { buffer: Buffer.from(b64, 'base64'), mimeType, fileName: `${turnId}.${extFor(mimeType)}` },
        languageCode: 'es',
      });
      if (maxSeconds !== null && (stt.audioSeconds || 0) > maxSeconds + 2) {
        throw new VoiceServiceError(`El mensaje supera la duración máxima de ${maxSeconds} segundos.`, 'too_long');
      }
      let transcript = stt.text;
      if (maxSeconds !== null) {
        // Only what was said within the limit is processed.
        const within = (stt.words || []).filter((w) => (w.type || 'word') !== 'audio_event' && (w.start ?? 0) <= maxSeconds);
        if (within.length > 0) transcript = within.map((w) => w.text).join('').trim();
      }
      if (!transcript || transcript.replace(/[^\p{L}\p{N}]/gu, '').length === 0) {
        await this.releaseTurn(quotaKey, turnId);
        return { turnId, noSpeech: true, quota: await this.getQuotaStatus(quotaKey) };
      }

      const conversation = await this.deps.family.converse({
        personalCode: input.personalCode,
        selectedPersonId: access.personId,
        sessionId: input.sessionId,
        messageText: transcript,
      });
      const replyText = String(conversation?.replyText || '').trim();
      if (!replyText) throw new VoiceServiceError('Mi Esencia no devolvió una respuesta.', 'empty_reply', 502);
      const tts = await this.deps.client.textToSpeech({
        voiceId: profile.voiceId,
        text: replyText,
        modelId: settings.conversationTtsModelId,
        languageCode: 'es',
      });
      const result = {
        turnId,
        transcript,
        conversation,
        replyText,
        audioBase64: tts.audio.toString('base64'),
        audioMimeType: tts.mimeType,
        usage: {
          ttsModelId: settings.conversationTtsModelId,
          ttsCharacters: tts.characters,
          ttsAudioSeconds: tts.audioSeconds,
          reportedCredits: tts.reportedCharacterCost,
          sttSeconds: stt.audioSeconds,
        },
        quota: { ...(await this.getQuotaStatus(quotaKey)) },
      };
      this.turnCache.set(turnId, { at: this.now(), result });
      this.pruneTurnCache();
      return result;
    } catch (err) {
      await this.releaseTurn(quotaKey, turnId);
      if (err instanceof VoiceServiceError) throw err;
      const message = err instanceof ElevenLabsError ? friendlyError(err) : (err as Error)?.message || friendlyError(err);
      throw new VoiceServiceError(message, 'turn_failed', 502);
    }
  }

  private pruneTurnCache() {
    const now = this.now();
    for (const [k, v] of this.turnCache) if (now - v.at > TURN_CACHE_TTL_MS) this.turnCache.delete(k);
  }

  private async releaseTurn(quotaKey: string, turnId: string) {
    await this.atomicQuota(quotaKey, (day, _limit, nowMs) => {
      const next = releaseVoiceTurn(day, turnId, nowMs);
      return { next: next === day ? undefined : next, result: null };
    }).catch(() => null);
  }

  /** El navegador confirma que reprodujo la respuesta: se cobra una sola vez por turno. */
  async acknowledgeTurn(input: { personalCode: string; selectedPersonId?: string; turnId: string; delivered: boolean }) {
    const { quotaKey } = await this.resolveFamilyVoice(input.personalCode, input.selectedPersonId);
    const turnId = String(input.turnId || '');
    if (!input.delivered) {
      await this.releaseTurn(quotaKey, turnId);
      return { outcome: 'released' as const, quota: await this.getQuotaStatus(quotaKey) };
    }
    const cached = this.turnCache.get(turnId)?.result;
    const outcome = await this.atomicQuota(quotaKey, (day, limit, nowMs) => {
      const r = commitVoiceTurn(day, { turnId, limit, nowMs });
      let next = r.day;
      if (r.outcome === 'charged' && cached?.usage) {
        const u = (day as any).usage || { ttsCharacters: 0, sttSeconds: 0, reportedCredits: 0, turns: 0 };
        next = {
          ...next,
          usage: {
            ttsCharacters: u.ttsCharacters + (cached.usage.ttsCharacters || 0),
            sttSeconds: Math.round((u.sttSeconds + (cached.usage.sttSeconds || 0)) * 10) / 10,
            reportedCredits: u.reportedCredits + (cached.usage.reportedCredits || 0),
            turns: u.turns + 1,
          },
        } as any;
      }
      return { next: r.outcome === 'charged' ? next : undefined, result: r.outcome };
    });
    return { outcome, quota: await this.getQuotaStatus(quotaKey) };
  }

  // ----------------------------------------------------------------- administración --------
  async accountInfo() {
    if (!this.deps.client.configured) {
      return { configured: false, subscription: null, requirements: ['Configurar el secreto ELEVENLABS_API_KEY en el servidor.'] };
    }
    try {
      const sub = await this.deps.client.getSubscription();
      const requirements: string[] = [];
      if (!sub.canUseInstantVoiceCloning) requirements.push('El plan actual no permite la clonación instantánea (IVC).');
      if (/free/i.test(sub.tier)) requirements.push('El plan gratuito no permite usar voces compartidas (PVC) por API.');
      if (sub.voiceLimit !== null && sub.voiceSlotsUsed !== null && sub.voiceSlotsUsed >= sub.voiceLimit) {
        requirements.push(`No quedan espacios para voces (${sub.voiceSlotsUsed}/${sub.voiceLimit}).`);
      }
      return { configured: true, subscription: sub, requirements };
    } catch (err) {
      return { configured: true, subscription: null, requirements: [friendlyError(err)] };
    }
  }

  /**
   * Prueba administrativa: reproduce un texto con una voz autorizada y lista. Su consumo se registra
   * aparte y NUNCA toca la cuota diaria de los familiares.
   */
  async runAdminTest(input: {
    profileId: string;
    text: string;
    modelId: string;
    purpose: VoiceAdminTestRun['purpose'];
    createdBy: string;
  }) {
    const profile = await this.getProfile(String(input.profileId || ''));
    if (!profile || profile.status !== 'lista' || !profile.voiceId || !profile.consent) {
      throw new VoiceServiceError('Elige una voz autorizada y lista.', 'voice_not_ready', 409);
    }
    if (!isSupportedTtsModel(input.modelId)) throw new VoiceServiceError('Modelo de síntesis no válido.', 'invalid_model');
    const text = String(input.text || '').trim().slice(0, 1000);
    if (!text) throw new VoiceServiceError('Escribe el texto de la prueba.', 'empty_text');
    const tts = await this.deps.client.textToSpeech({ voiceId: profile.voiceId, text, modelId: input.modelId, languageCode: 'es' });
    const model = findTtsModel(input.modelId);
    const estimatedUsd = estimateTtsCostUsd(input.modelId, tts.characters);
    const run: VoiceAdminTestRun = {
      runId: `vt_${crypto.randomBytes(6).toString('hex')}`,
      purpose: input.purpose === 'comparar_modelos' ? 'comparar_modelos' : 'comparar_modalidades',
      profileId: profile.profileId,
      participantName: profile.participantName,
      mode: profile.mode,
      modelId: input.modelId,
      text,
      characters: tts.characters,
      audioSeconds: tts.audioSeconds,
      reportedCredits: tts.reportedCharacterCost,
      estimatedUsd,
      estimatedUsdPerMinuteOfGeneratedAudio:
        estimatedUsd !== null && tts.audioSeconds > 0 ? Math.round((estimatedUsd / tts.audioSeconds) * 60 * 1e5) / 1e5 : null,
      rateUsdPer1kCharacters: model?.estimatedUsdPer1kCharacters ?? null,
      rateSource: TTS_RATE_SOURCE,
      costKind: tts.reportedCharacterCost !== null ? 'reportado_por_elevenlabs' : 'estimado',
      createdAt: this.nowIso(),
      createdBy: input.createdBy,
    };
    await this.deps.store.set(VOICE_COLLECTIONS.adminTestRuns, run.runId, run);
    return { run, audioBase64: tts.audio.toString('base64'), audioMimeType: tts.mimeType };
  }

  async listAdminTestRuns(limit = 50): Promise<VoiceAdminTestRun[]> {
    const runs = await this.deps.store.listAll<VoiceAdminTestRun>(VOICE_COLLECTIONS.adminTestRuns);
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  /** Estimación del costo de un minuto de conversación completa (transcribir + sintetizar). */
  conversationMinuteEstimate(modelId: string) {
    // Assumption shown on screen: in one minute of conversation the family member speaks ~30 s and
    // Mi Esencia answers ~30 s; spoken Spanish ≈ 15 characters per second of generated audio.
    const ttsChars = 30 * 15;
    const tts = estimateTtsCostUsd(modelId, ttsChars) ?? 0;
    const stt = estimateSttCostUsd(30);
    return {
      modelId,
      assumptions: 'Supone 30 s hablados por el familiar y 30 s de respuesta (~15 caracteres por segundo).',
      ttsUsd: tts,
      sttUsd: stt,
      totalUsd: Math.round((tts + stt) * 1e5) / 1e5,
      perMinuteOfGeneratedAudioUsd: Math.round((estimateTtsCostUsd(modelId, 60 * 15) ?? 0) * 1e5) / 1e5,
      kind: 'estimado' as const,
      rateSource: TTS_RATE_SOURCE,
    };
  }
}
