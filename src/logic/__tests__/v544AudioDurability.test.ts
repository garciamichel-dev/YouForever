/**
 * V5.4.4 — REGRESSION TESTS: participants' voice notes must never be lost.
 *
 * Same causes as the photos (V5.4.3): recordings above 50,000 characters reached Firestore WITHOUT
 * their audio (`storedOnDisk`, and `sanitizeDocForFirestore` emptied `audioDataUrl`), so a Cloud Run
 * restart erased them; and an edit could detach saved voice notes the browser did not resend.
 *
 * Real StorageManager + simulated Cloud Firestore; runs in a temporary directory.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ISOLATED_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'yf_v544_audio_'));

process.chdir(ISOLATED_ROOT);
process.env.GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error('Red deshabilitada en las pruebas.');
}) as typeof fetch;

let mod: any;
let integrity: any;

function createRemoteStore() {
  const docs = new Map<string, Record<string, unknown>>();
  const deletes: string[] = [];
  return {
    docs,
    deletes,
    async setDoc(collectionName: string, docId: string, data: Record<string, unknown>) {
      docs.set(`${collectionName}/${docId}`, JSON.parse(JSON.stringify(data)));
    },
    async deleteDoc(collectionName: string, docId: string) {
      deletes.push(`${collectionName}/${docId}`);
      docs.delete(`${collectionName}/${docId}`);
    },
    async getDoc(collectionName: string, docId: string) {
      const d = docs.get(`${collectionName}/${docId}`);
      return d ? JSON.parse(JSON.stringify(d)) : null;
    },
    collection(collectionName: string) {
      return Array.from(docs.entries())
        .filter(([key]) => key.startsWith(`${collectionName}/`))
        .map(([, value]) => JSON.parse(JSON.stringify(value)));
    },
  };
}

/** Raw recording bytes (WebM EBML header + random payload). */
function fakeRecording(bytes: number): Buffer {
  return Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), crypto.randomBytes(bytes)]);
}

function wipeLocalDisk() {
  fs.rmSync(path.join(ISOLATED_ROOT, 'data'), { recursive: true, force: true });
}

async function createInterview(storage: any) {
  const created = await storage.createInterview({
    title: 'Memorias con notas de voz',
    storyMode: 'individual',
    storyType: 'biografia_personal',
    participants: [{ name: 'Elena Robles', relationship: 'Titular', role: 'primary' }],
    customSufficiencyThreshold: 100000,
    performedBy: 'admin_pruebas',
  });
  created.interview.maxFollowUpsAtCreation = 0;
  const token = created.participantTokens[0].plainToken;
  const question = storage.getQuestionsForVersion(created.interview.questionnaireVersionId)[0];
  return { token, question };
}

async function recordVoiceNote(storage: any, token: string, questionId: string, bytes: number) {
  const raw = fakeRecording(bytes);
  const rec = await storage.saveVoiceRecording({
    plainToken: token,
    questionId,
    audioBase64: raw.toString('base64'),
    mimeType: 'audio/webm;codecs=opus',
    durationSeconds: 42,
    clientTranscription: 'Recuerdo la casa de mis abuelos.',
  });
  return { rec, raw };
}

before(async () => {
  mod = await import(path.join(REPO_ROOT, 'src/server/storage.ts'));
  integrity = await import(path.join(REPO_ROOT, 'src/server/photoIntegrity.ts'));
});

after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(process.cwd(), ISOLATED_ROOT);
});

test('V5.4.4-U1: reconoce una grabación real y descarta valores vacíos o imágenes', () => {
  const raw = fakeRecording(1000);
  const dataUrl = `data:audio/webm;codecs=opus;base64,${raw.toString('base64')}`;
  assert.equal(integrity.isRealAudioDataUrl(dataUrl), true);
  const decoded = integrity.decodeAudioDataUrl(dataUrl);
  assert.ok(decoded.buffer.equals(raw));
  assert.equal(decoded.mimeType, 'audio/webm;codecs=opus');
  assert.equal(integrity.isRealAudioDataUrl(''), false);
  assert.equal(integrity.isRealAudioDataUrl('/api/audio/aud_1'), false);
  assert.equal(integrity.isRealAudioDataUrl(`data:image/png;base64,${raw.toString('base64')}`), false);
});

test('V5.4.4-I1: una nota de voz normal (≈400 KB) llega a Firestore CON su grabación y sobrevive a un reinicio', async () => {
  wipeLocalDisk();
  const remote = createRemoteStore();
  const storage = new mod.StorageManager({ remoteDocStore: remote });
  const { token, question } = await createInterview(storage);
  const { rec, raw } = await recordVoiceNote(storage, token, question.id, 300_000);

  const stored = remote.docs.get(`interviewAudio/${rec.id}`) as any;
  assert.ok(stored, 'el registro existe en Firestore');
  assert.ok(String(stored.audioDataUrl).length > 50_000, 'Firestore guarda la grabación (antes se vaciaba arriba de 50 KB)');
  assert.equal(stored.storedOnDisk, undefined);
  assert.equal(stored.audioDataUrl_storedSeparately, undefined);

  wipeLocalDisk();
  const restarted = new mod.StorageManager({ remoteDocStore: remote });
  assert.equal(restarted.getAudioBuffer(rec.id), null);
  const recovered = await restarted.getAudioBufferAsync(rec.id);
  assert.ok(recovered, 'la grabación se recupera de Firestore');
  assert.ok(recovered.buffer.equals(raw), 'idéntica byte a byte');
});

test('V5.4.4-I2: una nota de voz larga (>800 KB) se guarda en fragmentos y se reconstruye idéntica', async () => {
  wipeLocalDisk();
  const remote = createRemoteStore();
  const storage = new mod.StorageManager({ remoteDocStore: remote });
  const { token, question } = await createInterview(storage);
  const { rec, raw } = await recordVoiceNote(storage, token, question.id, 2_000_000);

  const manifest = remote.docs.get(`interviewAudio/${rec.id}`) as any;
  assert.equal(manifest._chunked, true);
  assert.ok(Number(manifest._chunkCount) >= 3);

  wipeLocalDisk();
  const restarted = new mod.StorageManager({ remoteDocStore: remote });
  const recovered = await restarted.getAudioBufferAsync(rec.id);
  assert.ok(recovered.buffer.equals(raw));

  const other = new mod.StorageManager({ remoteDocStore: remote });
  other['ingestRemoteAudioDocs'](remote.collection('interviewAudio'));
  assert.ok(other.getAudioBuffer(rec.id)?.buffer.equals(raw), 'la carga masiva también reconstruye la grabación');
  assert.equal(other.getAudioById(`${rec.id}__part0`), undefined, 'los fragmentos nunca aparecen como notas de voz');

  await other['removeChunkedRemoteDocs']('interviewAudio', rec.id);
  assert.equal(remote.collection('interviewAudio').length, 0, 'borrar elimina registro y fragmentos');
});

test('V5.4.4-I3: corregir la transcripción sin la grabación local no borra el audio de Firestore', async () => {
  wipeLocalDisk();
  const remote = createRemoteStore();
  const storage = new mod.StorageManager({ remoteDocStore: remote });
  const { token, question } = await createInterview(storage);
  const { rec, raw } = await recordVoiceNote(storage, token, question.id, 120_000);
  const original = (remote.docs.get(`interviewAudio/${rec.id}`) as any).audioDataUrl;

  // This instance loses its local copy (record loaded without recording, empty disk).
  storage.getAudioById(rec.id).audioDataUrl = '';
  wipeLocalDisk();

  await storage.submitAnswer({
    plainToken: token,
    questionId: question.id,
    answerText: 'Recuerdo la casa de mis abuelos en Xalapa.',
    notRecalled: false,
    idempotencyKey: `sub_${Date.now()}`,
    audioRecordings: [
      { id: rec.id, audioUrl: rec.audioUrl, transcription: 'Recuerdo la casa de mis abuelos en Xalapa.', mimeType: rec.mimeType },
    ],
  });

  const stored = remote.docs.get(`interviewAudio/${rec.id}`) as any;
  assert.equal(stored.audioDataUrl, original, 'la grabación sigue en Firestore');
  assert.equal(stored.transcription, 'Recuerdo la casa de mis abuelos en Xalapa.', 'con la transcripción corregida');
  const served = await storage.getAudioBufferAsync(rec.id);
  assert.ok(served.buffer.equals(raw));
});

test('V5.4.4-I4: un guardado con lista de notas de voz incompleta no desvincula las ya guardadas', async () => {
  wipeLocalDisk();
  const remote = createRemoteStore();
  const storage = new mod.StorageManager({ remoteDocStore: remote });
  const { token, question } = await createInterview(storage);
  const first = (await recordVoiceNote(storage, token, question.id, 10_000)).rec;
  const second = (await recordVoiceNote(storage, token, question.id, 10_000)).rec;
  const att = (r: any) => ({ id: r.id, audioUrl: r.audioUrl, transcription: r.transcription, mimeType: r.mimeType });

  await storage.submitAnswer({
    plainToken: token,
    questionId: question.id,
    answerText: 'Dos recuerdos.',
    notRecalled: false,
    idempotencyKey: `sub_a_${Date.now()}`,
    audioRecordings: [att(first), att(second)],
  });
  // Stale background autosave that only knows about the second note.
  const result = await storage.submitAnswer({
    plainToken: token,
    questionId: question.id,
    answerText: 'Dos recuerdos, con más detalle.',
    notRecalled: false,
    autosave: true,
    idempotencyKey: `autosave_${Date.now()}`,
    audioRecordings: [att(second)],
  });
  assert.deepEqual(
    result.answer.audioRecordings.map((a: any) => a.id).sort(),
    [first.id, second.id].sort(),
    'las dos notas de voz siguen en la respuesta'
  );
  assert.deepEqual(remote.deletes.filter((d) => d.startsWith('interviewAudio/')), []);
});

test('V5.4.4-I5: las notas de voz que versiones anteriores dejaron sin grabación en Firestore se reparan', async () => {
  wipeLocalDisk();
  const remote = createRemoteStore();
  const storage = new mod.StorageManager({ remoteDocStore: remote });
  const { token, question } = await createInterview(storage);
  const { rec, raw } = await recordVoiceNote(storage, token, question.id, 90_000);
  remote.docs.set(`interviewAudio/${rec.id}`, {
    ...(remote.docs.get(`interviewAudio/${rec.id}`) as any),
    audioDataUrl: '',
    storedOnDisk: true,
  });
  delete (storage.getAudioById(rec.id) as any).durableAudioAt;

  assert.equal(await storage.migrateLocalAudiosToDurableStore(), 1);
  const decoded = integrity.decodeAudioDataUrl((remote.docs.get(`interviewAudio/${rec.id}`) as any).audioDataUrl);
  assert.ok(decoded.buffer.equals(raw));
  assert.equal(await storage.migrateLocalAudiosToDurableStore(), 0, 'una nota ya verificada no se vuelve a leer');
});
