/**
 * V5.9.0 — Voz clonada con ElevenLabs y conversación de viva voz en «Mi Esencia».
 *
 * TODO lo de este archivo usa SIMULACIONES: un ElevenLabs falso (sin red) y un almacén en memoria con
 * la misma garantía atómica que la transacción de Firestore. No se llamó a ElevenLabs real.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_VOICE_SETTINGS,
  VOICE_CONSENT_TEXT,
  VOICE_QUOTA_EXHAUSTED_MESSAGE,
  assessDiarizedSample,
  commitVoiceTurn,
  emptyQuotaDay,
  normalizeVoiceSettings,
  parseElevenLabsShareLink,
  reserveVoiceTurn,
  resolveVoiceDailyLimit,
  selectCandidateRecordings,
  voiceQuotaDayKey,
  type DiarizedWord,
} from '../voiceCloningRules.ts';
import { ElevenLabsError, type ElevenLabsApi } from '../../server/voice/elevenLabsClient.ts';
import { VOICE_READING_TEXTS } from '../../components/voice/voiceReadingTexts.ts';
import { createMemoryVoiceDocStore, VOICE_COLLECTIONS } from '../../server/voice/voiceDocStore.ts';
import { VoiceService, VoiceServiceError, type VoiceFamilyAdapter } from '../../server/voice/voiceService.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

// ---------------------------------------------------------------------------------------------
// Dobles de prueba
// ---------------------------------------------------------------------------------------------

const words = (n: number, speakers: string[] = ['speaker_0'], secondsPerWord = 0.5): DiarizedWord[] =>
  Array.from({ length: n }, (_, i) => ({
    text: `palabra${i} `,
    start: i * secondsPerWord,
    end: i * secondsPerWord + secondsPerWord * 0.9,
    type: 'word',
    speaker_id: speakers[i % speakers.length],
  }));

interface FakeOptions {
  /** Diarization per file name prefix (audio id). Default: one clear voice, 40 s of speech. */
  diarize?: Record<string, DiarizedWord[]>;
  transcript?: string;
  failTts?: boolean;
  failStt?: boolean;
  failCreate?: ElevenLabsError;
  failShared?: ElevenLabsError;
  createDelayMs?: number;
}

function fakeElevenLabs(opts: FakeOptions = {}) {
  const calls = { create: 0, shared: 0, tts: [] as Array<{ voiceId: string; modelId: string; text: string }>, stt: 0, createdFiles: [] as string[] };
  const voices = new Map<string, string>(); // voiceId -> name
  const api: ElevenLabsApi = {
    configured: true,
    async createIvcVoice({ name, files }) {
      calls.create++;
      calls.createdFiles.push(...files.map((f) => f.fileName));
      if (opts.createDelayMs) await new Promise((r) => setTimeout(r, opts.createDelayMs));
      if (opts.failCreate) throw opts.failCreate;
      const id = `ivc_${calls.create}`;
      voices.set(id, name);
      return { voiceId: id, requiresVerification: false };
    },
    async addSharedVoice({ voiceId, newName }) {
      calls.shared++;
      if (opts.failShared) throw opts.failShared;
      const id = `pvc_${voiceId}`;
      voices.set(id, newName);
      return { voiceId: id };
    },
    async getVoice(voiceId) {
      return voices.has(voiceId) ? { voiceId, name: voices.get(voiceId)!, category: 'cloned' } : null;
    },
    async findVoiceByName(name) {
      for (const [id, n] of voices) if (n === name) return id;
      return null;
    },
    async textToSpeech({ voiceId, text, modelId }) {
      if (opts.failTts) throw new ElevenLabsError('Síntesis de voz: 500', 500);
      calls.tts.push({ voiceId, modelId, text });
      const audio = Buffer.alloc(16000 * 2); // 2 s at 128 kbps
      return { audio, mimeType: 'audio/mpeg', reportedCharacterCost: text.length, characters: text.length, audioSeconds: 2, requestId: 'r' };
    },
    async speechToText({ file, diarize }) {
      calls.stt++;
      if (opts.failStt) throw new ElevenLabsError('Transcripción: 500', 500);
      const id = file.fileName.split('.')[0];
      if (diarize) {
        const w = opts.diarize?.[id] ?? words(140);
        return { text: w.map((x) => x.text).join(''), languageCode: 'spa', words: w, audioSeconds: 40 };
      }
      const text = opts.transcript ?? 'Hola, abuela, ¿cómo estás?';
      return { text, languageCode: 'spa', words: text.split(' ').map((t, i) => ({ text: `${t} `, start: i * 0.4, end: i * 0.4 + 0.3, type: 'word' })), audioSeconds: 3 };
    },
    async getSubscription() {
      return {
        tier: 'creator', status: 'active', characterCount: 100, characterLimit: 100000, voiceSlotsUsed: 1, voiceLimit: 30,
        professionalVoiceLimit: 1, canUseInstantVoiceCloning: true, canUseProfessionalVoiceCloning: true, nextCharacterCountResetUnix: null,
      };
    },
  };
  return { api, calls, voices };
}

const PARTICIPANTS: Record<string, { interviewId: string; participantId: string; participantName: string }> = {
  tok_ana: { interviewId: 'int_1', participantId: 'p_ana', participantName: 'Ana' },
  tok_luis: { interviewId: 'int_1', participantId: 'p_luis', participantName: 'Luis' },
  tok_solo: { interviewId: 'int_2', participantId: 'p_solo', participantName: 'Marta' },
};
const RECORDINGS: Record<string, Array<{ id: string; durationSeconds: number; mimeType: string }>> = {
  p_ana: [
    { id: 'aud_ana_1', durationSeconds: 45, mimeType: 'audio/webm' },
    { id: 'aud_ana_2', durationSeconds: 40, mimeType: 'audio/webm' },
  ],
  p_luis: [{ id: 'aud_luis_1', durationSeconds: 50, mimeType: 'audio/webm' }],
  p_solo: [{ id: 'aud_solo_1', durationSeconds: 8, mimeType: 'audio/webm' }],
};
const originals = new Map<string, Buffer>(
  Object.values(RECORDINGS).flat().map((r) => [r.id, Buffer.from(`ORIGINAL-${r.id}`)])
);

function setup(opts: FakeOptions = {}, now?: { t: number }) {
  const store = createMemoryVoiceDocStore();
  const el = fakeElevenLabs(opts);
  const converseCalls: any[] = [];
  const family: VoiceFamilyAdapter = {
    verifyFamilyAccess(code, selectedPersonId) {
      const fam: Record<string, { interlocutorId: string }> = { FAM_A: { interlocutorId: 'il_hija' }, FAM_B: { interlocutorId: 'il_nieto' } };
      if (!fam[code]) throw new VoiceServiceError('Código personal inválido.', 'unauthorized', 401);
      const person = selectedPersonId === 'person_luis'
        ? { personId: 'person_luis', participantId: 'p_luis' }
        : { personId: 'person_ana', participantId: 'p_ana' };
      return { interlocutorId: fam[code].interlocutorId, avatarId: 'av_1', personId: person.personId, personName: 'Ana', interviewId: 'int_1', participantId: person.participantId };
    },
    async converse(params) {
      converseCalls.push(params);
      return { replyText: `Respuesta a: ${params.messageText}`, session: { sessionId: params.sessionId || 's1' } };
    },
  };
  const svc = new VoiceService({
    store,
    client: el.api,
    interviews: {
      resolveParticipantToken(token) {
        const p = PARTICIPANTS[token];
        if (!p) throw new Error('El enlace o código de acceso no es válido o no existe.');
        return p;
      },
      listParticipantRecordings: (_i, pid) => RECORDINGS[pid] || [],
      async readRecording(id) {
        const b = originals.get(id);
        return b ? { buffer: Buffer.from(b), mimeType: 'audio/webm' } : null;
      },
    },
    family,
    now: now ? () => now.t : undefined,
  });
  return { svc, store, el, converseCalls };
}

async function readyVoice(svc: VoiceService, token = 'tok_ana') {
  await svc.authorize(token, 'portal');
  await svc.analyzeSamples(token);
  const r = await svc.startInstantClone(token);
  assert.equal(r.status, 'lista');
}

const turn = (svc: VoiceService, turnId: string, code = 'FAM_A', extra: Record<string, unknown> = {}) =>
  svc.familyTurn({ personalCode: code, turnId, audioBase64: Buffer.from('voz').toString('base64'), mimeType: 'audio/webm', durationSeconds: 3, ...extra } as any);

// ---------------------------------------------------------------------------------------------
// 1–2. Autorización y activación
// ---------------------------------------------------------------------------------------------

test('V5.9.0-A1: la autorización se guarda con el texto exacto y crea la configuración (idempotente)', async () => {
  const { svc, store } = setup();
  const before = await svc.participantStatus('tok_ana');
  assert.equal(before.authorized, false);
  assert.equal(before.status, 'sin_configurar');
  const a = await svc.authorize('tok_ana', 'finalizar_entrevista');
  const b = await svc.authorize('tok_ana', 'portal'); // repeated click
  assert.equal(a.authorized, true);
  assert.equal(b.authorized, true);
  const saved: any = await store.get(VOICE_COLLECTIONS.profiles, 'int_1__p_ana');
  assert.equal(saved.consent.text, VOICE_CONSENT_TEXT);
  assert.equal(saved.consent.source, 'finalizar_entrevista', 'la primera autorización se conserva');
  assert.equal(VOICE_CONSENT_TEXT, 'Autorizo el uso de mis grabaciones para clonar mi voz y utilizarla en Mi Esencia');
});

test('V5.9.0-A2: sin autorización no se analizan muestras ni se crea un clon', async () => {
  const { svc, el } = setup();
  await assert.rejects(() => svc.analyzeSamples('tok_ana'), /autorización/);
  await assert.rejects(() => svc.startInstantClone('tok_ana'), /autorización/);
  assert.equal(el.calls.create, 0);
  assert.equal(el.calls.stt, 0);
});

// ---------------------------------------------------------------------------------------------
// 3. Clonación
// ---------------------------------------------------------------------------------------------

test('V5.9.0-C1: clon instantáneo con copias de las grabaciones del propio participante; originales intactos', async () => {
  const { svc, el, store } = setup();
  await svc.authorize('tok_ana', 'portal');
  const analysis = await svc.analyzeSamples('tok_ana');
  assert.equal(analysis.analysis?.sufficient, true);
  const r = await svc.startInstantClone('tok_ana');
  assert.equal(r.status, 'lista');
  assert.equal(el.calls.create, 1);
  assert.deepEqual(el.calls.createdFiles.sort(), ['aud_ana_1.webm', 'aud_ana_2.webm'], 'sólo grabaciones de Ana');
  assert.equal(originals.get('aud_ana_1')!.toString(), 'ORIGINAL-aud_ana_1');
  const saved: any = await store.get(VOICE_COLLECTIONS.profiles, 'int_1__p_ana');
  assert.equal(saved.mode, 'ivc');
  assert.equal(saved.voiceId, 'ivc_1');
  assert.ok(saved.verifiedAt, 'el servidor comprobó que puede usarla');
  assert.ok(el.calls.tts.some((t) => t.voiceId === 'ivc_1'), 'verificación con una síntesis real');
});

test('V5.9.0-C2: grabaciones con voces superpuestas o insuficientes → se pide una muestra adicional', async () => {
  const { svc, el } = setup({
    diarize: {
      aud_ana_1: words(80, ['speaker_0', 'speaker_1']), // two voices interleaved
      aud_ana_2: words(3), // almost no voice
    },
  });
  await svc.authorize('tok_ana', 'portal');
  const r = await svc.analyzeSamples('tok_ana');
  assert.equal(r.analysis?.sufficient, false);
  assert.deepEqual(r.analysis?.rejected.map((x) => x.reason).sort(), ['sin_voz_suficiente', 'voces_superpuestas']);
  await assert.rejects(() => svc.startInstantClone('tok_ana'), /muestra adicional/);
  assert.equal(el.calls.create, 0);

  // The participant records an extra sample (after listening to it) and sends it.
  const withSample = await svc.submitExtraSample('tok_ana', { audioBase64: Buffer.from('muestra').toString('base64'), mimeType: 'audio/webm', durationSeconds: 70 });
  assert.equal(withSample.sample.usable, true);
  assert.equal(withSample.analysis?.sufficient, true);
  const done = await svc.startInstantClone('tok_ana');
  assert.equal(done.status, 'lista');
  assert.ok(el.calls.createdFiles.some((f) => f.startsWith('vs_')), 'se usó la muestra adicional');
});

test('V5.9.0-C3: clics repetidos, reintentos o solicitudes simultáneas no crean clones duplicados', async () => {
  const { svc, el } = setup({ createDelayMs: 20 });
  await svc.authorize('tok_ana', 'portal');
  await svc.analyzeSamples('tok_ana');
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => svc.startInstantClone('tok_ana')));
  assert.equal(el.calls.create, 1, 'un solo clon en ElevenLabs');
  assert.equal(results.filter((r: any) => r.duplicatePrevented).length, 4);
  const again = await svc.startInstantClone('tok_ana');
  assert.equal(again.status, 'lista');
  assert.equal(el.calls.create, 1);
});

test('V5.9.0-C4: si el intento se interrumpió después de crear la voz, el reintento la reutiliza', async () => {
  const now = { t: Date.parse('2026-11-20T15:00:00Z') };
  const { svc, el, store } = setup({}, now);
  await svc.authorize('tok_ana', 'portal');
  await svc.analyzeSamples('tok_ana');
  // Simulate a crash: the voice exists in ElevenLabs but the profile stayed "en_proceso" with a lock.
  el.voices.set('ivc_viejo', 'YouForever · Ana · int_1__p_ana');
  const p: any = await store.get(VOICE_COLLECTIONS.profiles, 'int_1__p_ana');
  await store.set(VOICE_COLLECTIONS.profiles, p.profileId, { ...p, status: 'en_proceso', lock: { lockId: 'x', expiresAt: new Date(now.t + 60_000).toISOString() } });
  const blocked: any = await svc.startInstantClone('tok_ana');
  assert.equal(blocked.duplicatePrevented, true, 'mientras el bloqueo está vigente no se repite');
  now.t += 5 * 60_000; // lock expired
  const r = await svc.startInstantClone('tok_ana');
  assert.equal(r.status, 'lista');
  assert.equal(el.calls.create, 0, 'no se creó otra voz');
  const saved: any = await store.get(VOICE_COLLECTIONS.profiles, 'int_1__p_ana');
  assert.equal(saved.voiceId, 'ivc_viejo');
});

test('V5.9.0-C5: un error deja el estado «error», se puede reintentar y el requisito queda visible al administrador', async () => {
  const fail = new ElevenLabsError('Crear clon instantáneo: 402 quota', 402, 'quota_exceeded');
  const { svc, el, store } = setup({ failCreate: fail });
  await svc.authorize('tok_ana', 'portal');
  await svc.analyzeSamples('tok_ana');
  const r = await svc.startInstantClone('tok_ana');
  assert.equal(r.status, 'error');
  assert.match(String(r.lastError), /créditos|límite/);
  const saved: any = await store.get(VOICE_COLLECTIONS.profiles, 'int_1__p_ana');
  assert.match(saved.requirementPending, /plan/);
  assert.equal(saved.lock, null, 'el bloqueo se libera');
  // Retry after fixing the account.
  (el.api as any).createIvcVoice = async () => ({ voiceId: 'ivc_ok', requiresVerification: false });
  el.voices.set('ivc_ok', 'x');
  const retry = await svc.startInstantClone('tok_ana');
  assert.equal(retry.status, 'lista');
});

test('V5.9.0-C6: clon profesional (PVC) — se vincula la voz compartida y se verifica el acceso', async () => {
  const { svc, el, store } = setup();
  await svc.updateSettings({ cloningMode: 'pvc' }, 'admin');
  await svc.authorize('tok_solo', 'portal');
  await assert.rejects(() => svc.linkProfessionalVoice('tok_solo', 'no es un enlace'), /enlace/);
  const link = 'https://elevenlabs.io/app/voice-lab/share/' + 'a'.repeat(64) + '/' + 'VoiceAbc1234567890Xy';
  const r = await svc.linkProfessionalVoice('tok_solo', link);
  assert.equal(r.status, 'lista');
  assert.equal(el.calls.shared, 1);
  const saved: any = await store.get(VOICE_COLLECTIONS.profiles, 'int_2__p_solo');
  assert.equal(saved.mode, 'pvc');
  assert.equal(saved.voiceId, 'pvc_VoiceAbc1234567890Xy');
  assert.equal(saved.pvc.publicUserId, 'a'.repeat(64));
  await assert.rejects(() => svc.startInstantClone('tok_solo'), /profesional/);
});

test('V5.9.0-C7: PVC sin permiso del plan → error con el requisito pendiente para el administrador', async () => {
  const { svc, store } = setup({ failShared: new ElevenLabsError('Vincular voz profesional: 403', 403, 'not allowed') });
  await svc.updateSettings({ cloningMode: 'pvc' }, 'admin');
  await svc.authorize('tok_solo', 'portal');
  const r = await svc.linkProfessionalVoice('tok_solo', 'a'.repeat(64) + '/VoiceAbc1234567890Xy');
  assert.equal(r.status, 'error');
  const saved: any = await store.get(VOICE_COLLECTIONS.profiles, 'int_2__p_solo');
  assert.match(saved.requirementPending, /compartida/);
});

test('V5.9.0-C8: cambiar la modalidad global sólo afecta a las configuraciones nuevas y no recrea voces', async () => {
  const { svc, el, store } = setup();
  await readyVoice(svc, 'tok_ana'); // IVC, ready
  await svc.authorize('tok_luis', 'portal'); // IVC, started (not ready)
  await svc.updateSettings({ cloningMode: 'pvc' }, 'admin');
  await svc.authorize('tok_solo', 'portal'); // new → PVC
  const ana: any = await store.get(VOICE_COLLECTIONS.profiles, 'int_1__p_ana');
  const luis: any = await store.get(VOICE_COLLECTIONS.profiles, 'int_1__p_luis');
  const solo: any = await store.get(VOICE_COLLECTIONS.profiles, 'int_2__p_solo');
  assert.equal(ana.mode, 'ivc');
  assert.equal(ana.voiceId, 'ivc_1', 'el voice_id activo se conserva');
  assert.equal(luis.mode, 'ivc', 'el proceso ya iniciado conserva su modalidad');
  assert.equal(solo.mode, 'pvc');
  assert.equal(el.calls.create, 1, 'no se recreó ninguna voz');
});

// ---------------------------------------------------------------------------------------------
// 5–7. Conversación y cuota
// ---------------------------------------------------------------------------------------------

test('V5.9.0-V1: sin voz lista la conversación por voz no se habilita (el chat escrito sigue igual)', async () => {
  const { svc, converseCalls } = setup();
  const st = await svc.familyVoiceStatus('FAM_A');
  assert.equal(st.available, false);
  await assert.rejects(() => turn(svc, 'turno-000001'), /todavía no está lista/);
  assert.equal(converseCalls.length, 0);
});

test('V5.9.0-V2: un turno transcribe, usa el flujo de Mi Esencia y responde con la voz clonada; se cobra al confirmar la entrega', async () => {
  const { svc, el, converseCalls } = setup();
  await readyVoice(svc);
  const st = await svc.familyVoiceStatus('FAM_A');
  assert.equal(st.available, true);
  assert.equal(st.quota.limit, 30);
  const r: any = await turn(svc, 'turno-000001', 'FAM_A', { sessionId: 'hilo-7' });
  assert.equal(r.transcript, 'Hola, abuela, ¿cómo estás?');
  assert.equal(converseCalls[0].messageText, r.transcript, 'la transcripción confirmada va al flujo de Mi Esencia');
  assert.equal(converseCalls[0].sessionId, 'hilo-7', 'mismo hilo');
  assert.equal(el.calls.tts.at(-1)!.voiceId, 'ivc_1');
  assert.equal(el.calls.tts.at(-1)!.modelId, 'eleven_flash_v2_5');
  assert.ok(r.audioBase64.length > 0);
  assert.equal((await svc.getQuotaStatus('int_1')).used, 0, 'aún no se cobra: falta la confirmación de entrega');
  const ack = await svc.acknowledgeTurn({ personalCode: 'FAM_A', turnId: 'turno-000001', delivered: true });
  assert.equal(ack.outcome, 'charged');
  assert.equal(ack.quota.used, 1);
  assert.equal(ack.quota.remaining, 29);
});

test('V5.9.0-V3: un mismo turno se cobra como máximo una vez aunque se reintente', async () => {
  const { svc, converseCalls } = setup();
  await readyVoice(svc);
  await turn(svc, 'turno-000002');
  await turn(svc, 'turno-000002'); // retry: same result, not reprocessed
  assert.equal(converseCalls.length, 1);
  assert.equal((await svc.acknowledgeTurn({ personalCode: 'FAM_A', turnId: 'turno-000002', delivered: true })).outcome, 'charged');
  assert.equal((await svc.acknowledgeTurn({ personalCode: 'FAM_A', turnId: 'turno-000002', delivered: true })).outcome, 'already_charged');
  assert.equal((await svc.getQuotaStatus('int_1')).used, 1);
});

test('V5.9.0-V4: fallos de transcripción, síntesis o entrega no consumen cuota', async () => {
  for (const opts of [{ failStt: true }, { failTts: true }] as FakeOptions[]) {
    const { svc } = setup();
    await readyVoice(svc);
    const s: any = svc;
    s.deps.client = { ...s.deps.client, ...fakeElevenLabs(opts).api, getVoice: s.deps.client.getVoice };
    await assert.rejects(() => turn(svc, 'turno-falla-1'));
    const q = await svc.getQuotaStatus('int_1');
    assert.equal(q.used + q.reserved, 0, JSON.stringify(opts));
  }
  // Delivery failed in the browser → the reservation is released, nothing charged.
  const { svc } = setup();
  await readyVoice(svc);
  await turn(svc, 'turno-sin-entrega');
  assert.equal((await svc.getQuotaStatus('int_1')).reserved, 1);
  const ack = await svc.acknowledgeTurn({ personalCode: 'FAM_A', turnId: 'turno-sin-entrega', delivered: false });
  assert.equal(ack.outcome, 'released');
  assert.equal(ack.quota.used + ack.quota.reserved, 0);
});

test('V5.9.0-V5: silencio (sin palabras) no se envía a Mi Esencia ni cobra', async () => {
  const { svc, converseCalls } = setup({ transcript: '' });
  await readyVoice(svc);
  const r: any = await turn(svc, 'turno-silencio');
  assert.equal(r.noSpeech, true);
  assert.equal(converseCalls.length, 0);
  const q = await svc.getQuotaStatus('int_1');
  assert.equal(q.used + q.reserved, 0);
});

test('V5.9.0-Q1: cuota compartida por la familia en hilos y dispositivos distintos (12 usados → quedan 18)', async () => {
  const { svc } = setup();
  await readyVoice(svc);
  for (let i = 0; i < 12; i++) {
    await turn(svc, `hija-turno-${String(i).padStart(3, '0')}`, 'FAM_A', { sessionId: 'hilo-hija' });
    await svc.acknowledgeTurn({ personalCode: 'FAM_A', turnId: `hija-turno-${String(i).padStart(3, '0')}`, delivered: true });
  }
  const forGrandson = await svc.familyVoiceStatus('FAM_B');
  assert.equal(forGrandson.quota.remaining, 18);
  // In a couple, the other member's voice shares the same balance.
  const s: any = svc;
  await readyVoice(svc, 'tok_luis');
  const luis = await svc.familyVoiceStatus('FAM_B', 'person_luis');
  assert.equal(luis.quota.remaining, 18);
  void s;
});

test('V5.9.0-Q2: valor particular del participante y regreso al valor global', async () => {
  const { svc } = setup();
  await readyVoice(svc);
  await svc.setQuotaOverride('int_1', 2, 'admin');
  assert.equal((await svc.getQuotaStatus('int_1')).limit, 2);
  for (const id of ['turno-q2-001', 'turno-q2-002']) {
    await turn(svc, id);
    await svc.acknowledgeTurn({ personalCode: 'FAM_A', turnId: id, delivered: true });
  }
  await assert.rejects(() => turn(svc, 'turno-q2-003'), (e: any) => e.code === 'quota_exhausted' && e.message === VOICE_QUOTA_EXHAUSTED_MESSAGE);
  await svc.setQuotaOverride('int_1', null, 'admin');
  const back = await svc.getQuotaStatus('int_1');
  assert.equal(back.limit, 30);
  assert.equal(back.usesGlobal, true);
  // The global default applies to participants without their own value (older records included).
  await svc.updateSettings({ defaultDailyVoiceMessages: 5 }, 'admin');
  assert.equal((await svc.getQuotaStatus('int_9_registro_anterior')).limit, 5);
});

test('V5.9.0-Q3: el saldo se reinicia cada día en America/Mexico_City', async () => {
  const now = { t: Date.parse('2026-11-21T05:30:00Z') }; // 23:30 del 20 en CDMX
  const { svc } = setup({}, now);
  await readyVoice(svc);
  await svc.setQuotaOverride('int_1', 1, 'admin');
  await turn(svc, 'turno-dia-001');
  await svc.acknowledgeTurn({ personalCode: 'FAM_A', turnId: 'turno-dia-001', delivered: true });
  await assert.rejects(() => turn(svc, 'turno-dia-002'), /límite diario/);
  now.t = Date.parse('2026-11-21T06:05:00Z'); // 00:05 del 21 en CDMX
  const r: any = await turn(svc, 'turno-dia-003');
  assert.ok(r.audioBase64);
  assert.equal(voiceQuotaDayKey(new Date('2026-11-21T05:30:00Z')), '2026-11-20');
  assert.equal(voiceQuotaDayKey(new Date('2026-11-21T06:05:00Z')), '2026-11-21');
});

test('V5.9.0-Q4: dos familiares a la vez no pueden usar el último cupo disponible', async () => {
  const { svc, converseCalls } = setup();
  await readyVoice(svc);
  await svc.setQuotaOverride('int_1', 1, 'admin');
  const outcomes = await Promise.allSettled([turn(svc, 'turno-hija-ultimo', 'FAM_A'), turn(svc, 'turno-nieto-ultimo', 'FAM_B')]);
  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
  const rejected = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejected.reason.code, 'quota_exhausted');
  assert.equal(converseCalls.length, 1, 'sólo un turno llegó a Mi Esencia');
});

test('V5.9.0-Q5: una reserva abandonada caduca y no bloquea el saldo', async () => {
  const now = { t: Date.parse('2026-11-20T18:00:00Z') };
  const { svc } = setup({}, now);
  await readyVoice(svc);
  await svc.setQuotaOverride('int_1', 1, 'admin');
  await turn(svc, 'turno-abandonado'); // never acknowledged (tab closed)
  await assert.rejects(() => turn(svc, 'turno-siguiente-1'), /límite diario/);
  now.t += 4 * 60_000; // reservation expired
  const r: any = await turn(svc, 'turno-siguiente-2');
  assert.ok(r.audioBase64);
});

test('V5.9.0-Q6: duración máxima por mensaje de voz (sin límite por defecto)', async () => {
  assert.equal(DEFAULT_VOICE_SETTINGS.maxSecondsPerVoiceMessage, null);
  const { svc } = setup({ transcript: 'uno dos tres cuatro cinco seis siete ocho nueve diez once doce' });
  await readyVoice(svc);
  const free: any = await turn(svc, 'turno-largo-sin-limite', 'FAM_A', { durationSeconds: 120 });
  assert.ok(free.audioBase64, 'sin límite se acepta');
  await svc.updateSettings({ maxSecondsPerVoiceMessage: 3 }, 'admin');
  await assert.rejects(() => turn(svc, 'turno-largo-limite-1', 'FAM_A', { durationSeconds: 30 }), /duración máxima/);
  const q = await svc.getQuotaStatus('int_1');
  assert.equal(q.used + q.reserved, 1, 'el rechazado no consumió (sólo queda la reserva del primer turno)');
  const cut: any = await turn(svc, 'turno-limite-ok-1', 'FAM_A', { durationSeconds: 3 });
  assert.ok(cut.transcript.split(' ').length <= 9, 'sólo se procesa lo dicho dentro del límite');
  assert.equal((await svc.familyVoiceStatus('FAM_A')).maxSecondsPerMessage, 3);
});

test('V5.9.0-Q7: acceso de familiares validado en el servidor', async () => {
  const { svc } = setup();
  await readyVoice(svc);
  await assert.rejects(() => turn(svc, 'turno-intruso-1', 'NO_EXISTE'), /inválido/);
  await assert.rejects(() => svc.familyVoiceStatus('NO_EXISTE'), /inválido/);
});

// ---------------------------------------------------------------------------------------------
// 4. Pruebas administrativas
// ---------------------------------------------------------------------------------------------

test('V5.9.0-T1: las pruebas administrativas se registran aparte y no consumen la cuota de los familiares', async () => {
  const { svc } = setup();
  await readyVoice(svc);
  const before = await svc.getQuotaStatus('int_1');
  const a = await svc.runAdminTest({ profileId: 'int_1__p_ana', text: 'Hola, familia.', modelId: 'eleven_flash_v2_5', purpose: 'comparar_modelos', createdBy: 'admin' });
  const b = await svc.runAdminTest({ profileId: 'int_1__p_ana', text: 'Hola, familia.', modelId: 'eleven_multilingual_v2', purpose: 'comparar_modelos', createdBy: 'admin' });
  assert.equal(a.run.characters, 14);
  assert.equal(a.run.audioSeconds, 2);
  assert.equal(a.run.costKind, 'reportado_por_elevenlabs');
  assert.equal(a.run.rateUsdPer1kCharacters, 0.05);
  assert.equal(b.run.rateUsdPer1kCharacters, 0.1);
  assert.ok(b.run.estimatedUsd! > a.run.estimatedUsd!);
  const after = await svc.getQuotaStatus('int_1');
  assert.deepEqual(after, before, 'la cuota de la familia no cambió');
  assert.equal((await svc.listAdminTestRuns()).length, 2);
  await assert.rejects(
    () => svc.runAdminTest({ profileId: 'int_1__p_luis', text: 'x', modelId: 'eleven_flash_v2_5', purpose: 'comparar_modalidades', createdBy: 'admin' }),
    /autorizada y lista/
  );
});

// ---------------------------------------------------------------------------------------------
// Reglas puras
// ---------------------------------------------------------------------------------------------

test('V5.9.0-R1: reglas puras — configuración, enlaces, diarización y reservas', () => {
  assert.deepEqual(normalizeVoiceSettings({ cloningMode: 'x' as any, defaultDailyVoiceMessages: -4, conversationTtsModelId: 'nope' }), DEFAULT_VOICE_SETTINGS);
  assert.equal(normalizeVoiceSettings({ maxSecondsPerVoiceMessage: 45 }).maxSecondsPerVoiceMessage, 45);
  assert.equal(normalizeVoiceSettings({ maxSecondsPerVoiceMessage: null }, { ...DEFAULT_VOICE_SETTINGS, maxSecondsPerVoiceMessage: 45 }).maxSecondsPerVoiceMessage, null);
  assert.equal(resolveVoiceDailyLimit({ defaultDailyVoiceMessages: 30 }, null), 30);
  assert.equal(resolveVoiceDailyLimit({ defaultDailyVoiceMessages: 30 }, 0), 0);
  assert.deepEqual(parseElevenLabsShareLink('https://elevenlabs.io/app/voice-lab/share/' + 'b'.repeat(64) + '/Abcdefghij0123456789'), {
    publicUserId: 'b'.repeat(64),
    voiceId: 'Abcdefghij0123456789',
  });
  assert.equal(parseElevenLabsShareLink('hola'), null);
  assert.equal(assessDiarizedSample(words(80)).usable, true);
  assert.equal(assessDiarizedSample(words(80, ['a', 'b'])).reason, 'voces_superpuestas');
  // A rare misattributed word (≥97 % one speaker) is still one clear voice.
  const mostly = words(100).map((w, i) => (i === 50 ? { ...w, speaker_id: 'speaker_1' } : w));
  assert.equal(assessDiarizedSample(mostly).usable, true);
  const day = emptyQuotaDay('k', '2026-11-20', '2026-11-20T00:00:00Z');
  const r1 = reserveVoiceTurn(day, { turnId: 't1', interlocutorId: 'i', limit: 1, nowMs: 0 });
  assert.equal(r1.kind, 'reserved');
  assert.equal(reserveVoiceTurn(r1.day, { turnId: 't2', interlocutorId: 'i', limit: 1, nowMs: 1 }).kind, 'exhausted');
  const c = commitVoiceTurn(r1.day, { turnId: 't1', limit: 1, nowMs: 2 });
  assert.equal(c.outcome, 'charged');
  assert.equal(commitVoiceTurn(c.day, { turnId: 't1', limit: 1, nowMs: 3 }).outcome, 'already_charged');
});

// ---------------------------------------------------------------------------------------------
// Integración aditiva (código existente)
// ---------------------------------------------------------------------------------------------

test('V5.9.0-I1: Mi Esencia — el canal de voz no consume la cuota de texto y el chat escrito no puede usarlo', () => {
  const store = read('src/server/miEsencia/miEsenciaStore.ts');
  assert.match(store, /quotaChannel\?: 'text' \| 'voice';/);
  assert.match(store, /if \(!isVoiceChannel && interlocutor\.messagesSentToday >= dailyLimit\)/);
  assert.equal((store.match(/if \(!isVoiceChannel\) interlocutor\.messagesSentToday \+= 1;/g) || []).length, 2);
  const router = read('src/server/miEsencia/miEsenciaRouter.ts');
  assert.match(router, /const \{ quotaChannel: _ignoredChannel, \.\.\.body \}/, 'el cliente no puede saltarse la cuota de texto');
  const voiceRouter = read('src/server/voice/voiceRouter.ts');
  assert.match(voiceRouter, /quotaChannel: 'voice'/);
  const api = read('src/server/api.ts');
  assert.match(api, /apiRouter\.use\('\/voice\/admin', requireAdmin\);\s*apiRouter\.use\('\/voice', voiceRouter\);/);
  const rules = read('firestore.rules');
  for (const c of Object.values(VOICE_COLLECTIONS)) assert.match(rules, new RegExp(`match /${c}/\\{docId\\}`), c);
  assert.doesNotMatch(read('src/server/voice/elevenLabsClient.ts'), /VITE_|import\.meta\.env/, 'la clave nunca va al navegador');
});

test('V5.9.0-U1: al finalizar la entrevista — casilla desmarcada; la entrevista se guarda antes y aparte de la voz', () => {
  const portal = read('src/components/ParticipantPortal.tsx');
  assert.match(portal, /const \[finishVoiceConsent, setFinishVoiceConsent\] = useState\(false\);/, 'desmarcada por defecto');
  assert.match(portal, /data-testid="finish-voice-consent"/);
  assert.match(portal, /<span>Autorizo el uso de mis grabaciones para clonar mi voz y utilizarla en Mi Esencia<\/span>/);
  const finish = portal.slice(portal.indexOf('const handleFinishStory = async'), portal.indexOf("// If no session loaded"));
  const finishCall = finish.indexOf("fetch('/api/participant/finish'");
  const voiceCall = finish.indexOf("voicePost('/participant/authorize'");
  assert.ok(finishCall > 0 && voiceCall > finishCall, 'primero se guarda la finalización');
  assert.match(finish, /if \(finishVoiceConsent\) \{[\s\S]*try \{[\s\S]*catch \{[\s\S]*setVoiceWizardOpen\(true\);/, 'un error de voz no afecta la finalización');
  assert.match(portal, /data-testid="activate-my-voice"/);
  assert.match(portal, /voiceView && !voiceView\.ready && voiceView\.serviceConfigured/, '«Activar mi voz» sólo sin voz lista');
});

test('V5.9.0-U2: Mi Esencia — «Habilitar voz» debajo de «Sugerencias opcionales» y el chat escrito comparte la misma actualización', () => {
  const fam = read('src/modules/mi-esencia/MiEsenciaFamilyPortal.tsx');
  const sugg = fam.indexOf('Sugerencias opcionales:');
  const voice = fam.indexOf('<MiEsenciaVoiceConversation');
  const limit = fam.indexOf('{isDailyLimitReached && (');
  assert.ok(sugg > 0 && voice > sugg && voice < limit, 'debajo de las sugerencias');
  assert.match(fam, /onConverseResult=\{applyConverseData\}/);
  assert.match(fam, /applyConverseData\(json\.data\);/, 'el chat escrito usa la misma función');
  assert.match(fam, /fetch\('\/api\/mi-esencia\/family\/converse'/, 'el chat escrito no cambia de ruta');
  const comp = read('src/modules/mi-esencia/MiEsenciaVoiceConversation.tsx');
  assert.match(comp, /if \(!status\?\.available\) return null;/, 'sin voz lista no se muestra');
  assert.match(comp, /'Deshabilitar voz' : 'Habilitar voz'/);
  assert.match(comp, /getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\); \/\/ releases the microphone/);
  assert.match(comp, /void ack\(turnId, true\); \/\/ delivered/);
});

test('V5.9.0-U3: administración — sección en Configuración Global y cuota junto a «Libro PDF y Cuota de Edición»', () => {
  const cfg = read('src/components/ConfigPanel.tsx');
  assert.match(cfg, /<VoiceGlobalConfigSection \/>/);
  const sec = read('src/components/voice/VoiceGlobalConfigSection.tsx');
  for (const label of ['Tipo de clonación de ElevenLabs', 'Cuota diaria predeterminada de mensajes de voz', 'Duración máxima por mensaje de voz', 'Sin límite', 'minuto de audio generado', 'minuto de conversación completa']) {
    assert.ok(sec.includes(label), label);
  }
  const panel = read('src/components/InterviewsPanel.tsx');
  const book = panel.indexOf('Libro PDF y Cuota de Edición:');
  const voice = panel.indexOf('<VoiceQuotaInlineControl');
  assert.ok(book > 0 && voice > book && voice - book < 6000, 'junto a la cuota del libro');
  const ctl = read('src/components/voice/VoiceQuotaInlineControl.tsx');
  assert.match(ctl, /Cuota diaria de mensajes de voz:/);
  assert.match(ctl, /Usar valor global/);
});

// ---------------------------------------------------------------------------------------------
// V5.9.1 — reintento del análisis, duración desconocida y asistente sin recargas infinitas
// ---------------------------------------------------------------------------------------------

test('V5.9.1-R1: una falla temporal al transcribir no queda guardada: se reintenta y luego la grabación sirve', async () => {
  const opts: FakeOptions = { failStt: true };
  const { svc, store } = setup(opts);
  await svc.authorize('tok_ana', 'portal');
  const first = await svc.analyzeSamples('tok_ana');
  assert.equal(first.analysis?.sufficient, false);
  assert.equal(first.analysis?.retryPending, 2, 'las dos grabaciones quedan pendientes de reintento');
  assert.equal(first.analysis?.rejected.length, 0, 'una falla temporal no es un descarte');
  const saved: any = await store.get(VOICE_COLLECTIONS.profiles, 'int_1__p_ana');
  assert.match(saved.analysis.lastErrorDetail, /ElevenLabs 500/, 'el administrador ve el motivo técnico');
  assert.equal(saved.analysis.analyzedAudioIds.length, 0);

  opts.failStt = false;
  const second = await svc.analyzeSamples('tok_ana');
  assert.equal(second.analysis?.retryPending, 0);
  assert.equal(second.analysis?.usableRecordings, 2);
  assert.equal(second.analysis?.sufficient, true);
  const after: any = await store.get(VOICE_COLLECTIONS.profiles, 'int_1__p_ana');
  assert.equal(after.analysis.lastErrorDetail, null);
});

test('V5.9.1-R2: tras 3 intentos fallidos la grabación se descarta y deja de reintentarse', async () => {
  const { svc, el } = setup({ failStt: true });
  await svc.authorize('tok_luis', 'portal');
  await svc.analyzeSamples('tok_luis');
  await svc.analyzeSamples('tok_luis');
  const third = await svc.analyzeSamples('tok_luis');
  assert.equal(third.analysis?.retryPending, 0);
  assert.deepEqual(third.analysis?.rejected.map((r) => r.reason), ['no_se_pudo_analizar']);
  const calls = el.calls.stt;
  await svc.analyzeSamples('tok_luis');
  assert.equal(el.calls.stt, calls, 'no se vuelve a llamar a ElevenLabs');
});

test('V5.9.1-R3: los descartes «no se pudo analizar» guardados por V5.9.0 se vuelven a intentar', async () => {
  const { svc, store } = setup();
  await svc.authorize('tok_luis', 'portal');
  await store.atomicUpdate<any, any>(VOICE_COLLECTIONS.profiles, 'int_1__p_luis', (cur) => {
    const next = {
      ...cur,
      analysis: {
        analyzedAt: '2026-11-20T10:00:00.000Z',
        analyzedAudioIds: ['aud_luis_1'],
        usableAudioIds: [],
        usableSpeechSeconds: 0,
        rejected: [{ audioId: 'aud_luis_1', reason: 'no_se_pudo_analizar' }],
        usableExtraSampleIds: [],
        sufficient: false,
      },
    };
    return { next, result: next };
  });
  const status = await svc.participantStatus('tok_luis');
  assert.equal(status.analysis?.retryPending, 0, 'el registro antiguo no trae la lista de reintentos');
  const re = await svc.analyzeSamples('tok_luis');
  assert.equal(re.analysis?.usableRecordings, 1);
  assert.equal(re.analysis?.rejected.length, 0, 'sin descartes duplicados');
});

test('V5.9.1-R4: una grabación guardada con duración 0 (desconocida) sí se considera', () => {
  const picked = selectCandidateRecordings([{ id: 'a', durationSeconds: 0 }, { id: 'b', durationSeconds: 2 }]);
  assert.deepEqual(picked.map((r) => r.id), ['a']);
});

test('V5.9.1-U4: el asistente no se recarga en ciclo y ofrece un texto para leer', () => {
  const wiz = read('src/components/voice/VoiceSetupWizard.tsx');
  assert.match(wiz, /onStatusChangeRef\.current = onStatusChange;/);
  assert.match(wiz, /const apply = useCallback\(\(v: ParticipantVoiceView\) => \{[\s\S]*?\}, \[\]\);/, '«apply» no depende del callback del padre');
  assert.match(wiz, /\}, \[open, token, run\]\);/);
  assert.doesNotMatch(wiz, /\[onStatusChange\]/);
  assert.match(wiz, /data-testid="voice-reading-text"/);
  assert.match(wiz, /data-testid="voice-analysis-retry"/);
  assert.ok(VOICE_READING_TEXTS.length >= 3);
  for (const t of VOICE_READING_TEXTS) {
    const n = t.paragraphs.join(' ').split(/\s+/).length;
    assert.ok(n >= 150 && n <= 210, `${t.title}: ${n} palabras (≈60–90 s)`);
  }
});
