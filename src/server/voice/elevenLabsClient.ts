/**
 * V5.9.0 — Cliente mínimo de la API oficial de ElevenLabs (sólo servidor).
 *
 * La clave vive en el secreto del servidor `ELEVENLABS_API_KEY`; nunca viaja al navegador.
 * Usa `fetch` nativo de Node (sin dependencias nuevas) y se puede sustituir en las pruebas.
 *
 * Endpoints usados (documentación oficial, noviembre de 2026):
 *   POST /v1/voices/add                               clon instantáneo (IVC)
 *   POST /v1/voices/add/{public_user_id}/{voice_id}   agregar una voz compartida (PVC del titular)
 *   GET  /v1/voices/{voice_id}                        comprobar que la voz existe en la cuenta
 *   GET  /v1/voices                                   localizar un clon ya creado (evita duplicados)
 *   POST /v1/text-to-speech/{voice_id}                síntesis (cabecera `character-cost`)
 *   POST /v1/speech-to-text                           transcripción Scribe v2 (con diarización)
 *   GET  /v1/user/subscription                        plan, límites y permisos de clonación
 */
import { STT_MODEL_ID, TTS_OUTPUT_FORMAT, mp3DurationSecondsFromBytes, type DiarizedWord } from '../../logic/voiceCloningRules.ts';

export const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io';

export class ElevenLabsError extends Error {
  status: number;
  detail: string;
  constructor(message: string, status: number, detail = '') {
    super(message);
    this.name = 'ElevenLabsError';
    this.status = status;
    this.detail = detail;
  }
}

export interface AudioFileInput {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}

export interface TtsResult {
  audio: Buffer;
  mimeType: 'audio/mpeg';
  /** Créditos que ElevenLabs reporta en la cabecera de la respuesta (si la envía). */
  reportedCharacterCost: number | null;
  characters: number;
  audioSeconds: number;
  requestId: string | null;
}

export interface SttResult {
  text: string;
  languageCode: string | null;
  words: DiarizedWord[];
  audioSeconds: number | null;
}

export interface ElevenLabsSubscriptionInfo {
  tier: string;
  status: string;
  characterCount: number | null;
  characterLimit: number | null;
  voiceSlotsUsed: number | null;
  voiceLimit: number | null;
  professionalVoiceLimit: number | null;
  canUseInstantVoiceCloning: boolean;
  canUseProfessionalVoiceCloning: boolean;
  nextCharacterCountResetUnix: number | null;
}

export interface ElevenLabsApi {
  readonly configured: boolean;
  createIvcVoice(params: {
    name: string;
    files: AudioFileInput[];
    description?: string;
    removeBackgroundNoise?: boolean;
    labels?: Record<string, string>;
  }): Promise<{ voiceId: string; requiresVerification: boolean }>;
  addSharedVoice(params: { publicUserId: string; voiceId: string; newName: string }): Promise<{ voiceId: string }>;
  getVoice(voiceId: string): Promise<{ voiceId: string; name: string; category: string | null } | null>;
  findVoiceByName(name: string): Promise<string | null>;
  textToSpeech(params: { voiceId: string; text: string; modelId: string; languageCode?: string }): Promise<TtsResult>;
  speechToText(params: { file: AudioFileInput; diarize?: boolean; languageCode?: string }): Promise<SttResult>;
  getSubscription(): Promise<ElevenLabsSubscriptionInfo>;
}

type FetchLike = (url: string, init?: any) => Promise<any>;

async function readError(res: any): Promise<string> {
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      const d = json?.detail;
      if (typeof d === 'string') return d;
      if (d?.message) return String(d.message);
      if (Array.isArray(d)) return d.map((x: any) => x?.msg || JSON.stringify(x)).join('; ');
      return text.slice(0, 300);
    } catch {
      return text.slice(0, 300);
    }
  } catch {
    return '';
  }
}

function toBlob(file: AudioFileInput): Blob {
  return new Blob([new Uint8Array(file.buffer)], { type: file.mimeType || 'application/octet-stream' });
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function createElevenLabsClient(options: { apiKey?: string; fetchImpl?: FetchLike; baseUrl?: string; timeoutMs?: number } = {}): ElevenLabsApi {
  const apiKey = (options.apiKey ?? process.env.ELEVENLABS_API_KEY ?? '').trim();
  const fetchImpl: FetchLike = options.fetchImpl || ((url, init) => fetch(url, init));
  const base = options.baseUrl || ELEVENLABS_API_BASE;
  const timeoutMs = options.timeoutMs ?? 60_000;

  const call = async (path: string, init: any = {}, label = 'ElevenLabs'): Promise<any> => {
    if (!apiKey) throw new ElevenLabsError('Falta configurar ELEVENLABS_API_KEY en el servidor.', 0, 'missing_api_key');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base}${path}`, {
        ...init,
        headers: { 'xi-api-key': apiKey, ...(init.headers || {}) },
        signal: controller?.signal,
      });
      if (!res.ok) {
        const detail = await readError(res);
        throw new ElevenLabsError(`${label}: ${res.status} ${detail || res.statusText || ''}`.trim(), res.status, detail);
      }
      return res;
    } catch (err: any) {
      if (err instanceof ElevenLabsError) throw err;
      if (err?.name === 'AbortError') throw new ElevenLabsError(`${label}: tiempo de espera agotado`, 0, 'timeout');
      throw new ElevenLabsError(`${label}: ${err?.message || err}`, 0, 'network');
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    configured: Boolean(apiKey),

    async createIvcVoice({ name, files, description, removeBackgroundNoise, labels }) {
      const form = new FormData();
      form.append('name', name);
      if (description) form.append('description', description);
      if (labels) form.append('labels', JSON.stringify(labels));
      form.append('remove_background_noise', removeBackgroundNoise ? 'true' : 'false');
      for (const f of files) form.append('files', toBlob(f), f.fileName);
      const res = await call('/v1/voices/add', { method: 'POST', body: form }, 'Crear clon instantáneo');
      const json = await res.json();
      if (!json?.voice_id) throw new ElevenLabsError('ElevenLabs no devolvió el voice_id del clon.', 502);
      return { voiceId: String(json.voice_id), requiresVerification: Boolean(json.requires_verification) };
    },

    async addSharedVoice({ publicUserId, voiceId, newName }) {
      const res = await call(
        `/v1/voices/add/${encodeURIComponent(publicUserId)}/${encodeURIComponent(voiceId)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new_name: newName }) },
        'Vincular voz profesional'
      );
      const json = await res.json();
      return { voiceId: String(json?.voice_id || voiceId) };
    },

    async getVoice(voiceId) {
      try {
        const res = await call(`/v1/voices/${encodeURIComponent(voiceId)}`, { method: 'GET' }, 'Consultar voz');
        const json = await res.json();
        return { voiceId: String(json?.voice_id || voiceId), name: String(json?.name || ''), category: json?.category ?? null };
      } catch (err) {
        if (err instanceof ElevenLabsError && (err.status === 404 || err.status === 400)) return null;
        throw err;
      }
    },

    async findVoiceByName(name) {
      const res = await call('/v1/voices', { method: 'GET' }, 'Listar voces');
      const json = await res.json();
      const hit = (json?.voices || []).find((v: any) => v?.name === name);
      return hit?.voice_id ? String(hit.voice_id) : null;
    },

    async textToSpeech({ voiceId, text, modelId, languageCode }) {
      const body: Record<string, unknown> = { text, model_id: modelId };
      if (languageCode && modelId !== 'eleven_multilingual_v2') body.language_code = languageCode;
      const res = await call(
        `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${TTS_OUTPUT_FORMAT}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify(body) },
        'Síntesis de voz'
      );
      const audio = Buffer.from(await res.arrayBuffer());
      const header = (k: string) => (typeof res.headers?.get === 'function' ? res.headers.get(k) : null);
      return {
        audio,
        mimeType: 'audio/mpeg',
        reportedCharacterCost: num(header('character-cost') ?? header('x-character-count')),
        characters: text.length,
        audioSeconds: mp3DurationSecondsFromBytes(audio.length),
        requestId: header('request-id'),
      };
    },

    async speechToText({ file, diarize, languageCode }) {
      const form = new FormData();
      form.append('model_id', STT_MODEL_ID);
      form.append('file', toBlob(file), file.fileName);
      if (languageCode) form.append('language_code', languageCode);
      if (diarize) form.append('diarize', 'true');
      form.append('tag_audio_events', 'false');
      const res = await call('/v1/speech-to-text', { method: 'POST', body: form }, 'Transcripción');
      const json = await res.json();
      const words: DiarizedWord[] = Array.isArray(json?.words) ? json.words : [];
      const lastEnd = words.reduce((m, w) => (typeof w.end === 'number' && w.end > m ? w.end : m), 0);
      return {
        text: String(json?.text || '').trim(),
        languageCode: json?.language_code ?? null,
        words,
        audioSeconds: lastEnd > 0 ? lastEnd : null,
      };
    },

    async getSubscription() {
      const res = await call('/v1/user/subscription', { method: 'GET' }, 'Consultar plan');
      const s = await res.json();
      return {
        tier: String(s?.tier || 'desconocido'),
        status: String(s?.status || 'desconocido'),
        characterCount: num(s?.character_count),
        characterLimit: num(s?.character_limit),
        voiceSlotsUsed: num(s?.voice_slots_used),
        voiceLimit: num(s?.voice_limit),
        professionalVoiceLimit: num(s?.professional_voice_limit),
        canUseInstantVoiceCloning: Boolean(s?.can_use_instant_voice_cloning),
        canUseProfessionalVoiceCloning: Boolean(s?.can_use_professional_voice_cloning),
        nextCharacterCountResetUnix: num(s?.next_character_count_reset_unix),
      };
    },
  };
}
