/**
 * V5.4.3 — REGRESSION TESTS: participants' photographs must never be lost.
 *
 * Reproduces, with the REAL StorageManager and a simulated Cloud Firestore (in-memory document
 * store), the four causes of the lost photos:
 *   1. the image never reached Firestore (data URLs above 50,000 characters were emptied, and
 *      above ~750 KB written as `storedOnDisk`), so a restart of Cloud Run erased it;
 *   2. a missing image was replaced by a synthetic sepia picture that ended up in Firestore;
 *   3. the start-up purge deleted photos whose answers were not in memory yet;
 *   4. editing / autosaving an answer deleted saved photos the browser did not resend.
 *
 * The process runs inside a temporary directory: the repository's `data/` is never written.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ISOLATED_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'yf_v543_photos_'));

process.chdir(ISOLATED_ROOT);
process.env.GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error('Red deshabilitada en las pruebas.');
}) as typeof fetch;

let mod: any;
let integrity: any;
let TINY_PNG_DATA_URL: string;

/** Simulated Cloud Firestore: keeps every written document (what survives a Cloud Run restart). */
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

/** A "real" JPEG-like image of the given size (random bytes after a JPEG SOI marker). */
function fakeJpegDataUrl(bytes: number): string {
  const buf = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(bytes)]);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

/** Simulates a Cloud Run restart: the instance's disk (snapshot + photo files) disappears. */
function wipeLocalDisk() {
  fs.rmSync(path.join(ISOLATED_ROOT, 'data'), { recursive: true, force: true });
}

async function createInterviewWithPhoto(storage: any, photoDataUrl: string) {
  const created = await storage.createInterview({
    title: 'Memorias con fotografías',
    storyMode: 'individual',
    storyType: 'biografia_personal',
    participants: [{ name: 'Elena Robles', relationship: 'Titular', role: 'primary' }],
    customSufficiencyThreshold: 100000,
    performedBy: 'admin_pruebas',
  });
  const interview = created.interview;
  interview.maxFollowUpsAtCreation = 0;
  const token = created.participantTokens[0].plainToken;
  const question = storage.getQuestionsForVersion(interview.questionnaireVersionId)[0];
  const saved = await storage.submitAnswer({
    plainToken: token,
    questionId: question.id,
    answerText: 'Esta es la casa donde crecí con mis hermanos.',
    notRecalled: false,
    idempotencyKey: `base_${Date.now()}`,
    photos: [{ dataUrl: photoDataUrl, caption: 'La casa de mi infancia', fileName: 'casa.jpg', mimeType: 'image/jpeg' }],
  });
  const photoId = saved.answer.photos[0].id as string;
  return { interview, token, question, answer: saved.answer, photoId };
}

before(async () => {
  mod = await import(path.join(REPO_ROOT, 'src/server/storage.ts'));
  integrity = await import(path.join(REPO_ROOT, 'src/server/photoIntegrity.ts'));
  ({ TINY_PNG_DATA_URL } = await import(path.join(REPO_ROOT, 'src/logic/__tests__/helpers/simulatedBookProviders.ts')));
});

after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(process.cwd(), ISOLATED_ROOT);
});

test('V5.4.3-U1: reconoce el dibujo sepia sintético de versiones anteriores y nunca una foto real', () => {
  // Real evidence kept in the repository: two photo files that had been replaced by the placeholder.
  const evidenceDir = path.join(REPO_ROOT, 'data', 'photos');
  const evidence = fs.existsSync(evidenceDir) ? fs.readdirSync(evidenceDir).filter((f) => f.endsWith('.bin')) : [];
  for (const file of evidence) {
    const buf = fs.readFileSync(path.join(evidenceDir, file));
    if (buf.length > 24 && buf.readUInt32BE(16) === 480 && buf.readUInt32BE(20) === 320) {
      assert.equal(integrity.isArchivalPlaceholderPng(buf), true, `${file} es el dibujo sintético`);
    }
  }
  const tiny = integrity.decodeImageDataUrl(TINY_PNG_DATA_URL);
  assert.equal(integrity.isArchivalPlaceholderPng(tiny.buffer), false);
  assert.equal(integrity.isRealPhotoDataUrl(TINY_PNG_DATA_URL), true);
  assert.equal(integrity.isRealPhotoDataUrl(fakeJpegDataUrl(2000)), true);
  assert.equal(integrity.isRealPhotoDataUrl(''), false);
  assert.equal(integrity.isRealPhotoDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=PHN2Zz48L3N2Zz4='), false);
  assert.equal(integrity.isRealPhotoDataUrl('/api/photos/photo_1'), false);
});

test('V5.4.3-U2: editar una respuesta conserva toda foto guardada que el navegador no reenvió', () => {
  const merged = integrity.mergeEditedAnswerPhotos({
    existing: [{ id: 'photo_a', caption: 'A' }, { id: 'photo_b', caption: 'B' }],
    resolvedIncoming: [{ id: 'photo_b', caption: 'B editada' }, { id: 'photo_c', caption: 'C nueva' }],
  });
  assert.deepEqual(
    merged.map((p: any) => `${p.id}:${p.caption}`),
    ['photo_b:B editada', 'photo_c:C nueva', 'photo_a:A']
  );
  assert.deepEqual(integrity.mergeEditedAnswerPhotos({ existing: [{ id: 'photo_a' }], resolvedIncoming: [] }), [{ id: 'photo_a' }]);
});

test('V5.4.3-I1: una foto normal (≈300 KB) llega a Firestore CON su imagen y sobrevive a un reinicio', async () => {
  wipeLocalDisk();
  const remote = createRemoteStore();
  const storage = new mod.StorageManager({ remoteDocStore: remote });
  const original = fakeJpegDataUrl(220_000); // ≈ 293,000 characters of base64
  const { photoId } = await createInterviewWithPhoto(storage, original);

  const stored = remote.docs.get(`interviewPhotos/${photoId}`) as any;
  assert.ok(stored, 'el registro de la foto existe en Firestore');
  assert.equal(stored.dataUrl, original, 'Firestore guarda la imagen completa (antes se vaciaba arriba de 50,000 caracteres)');
  assert.equal(stored.dataUrl_storedSeparately, undefined);
  assert.equal(stored.storedOnDisk, undefined);

  // Cloud Run restart: new instance, empty disk, only Firestore survives.
  wipeLocalDisk();
  const restarted = new mod.StorageManager({ remoteDocStore: remote });
  assert.equal(restarted.getPhotoBuffer(photoId), null, 'sin copia local no se inventa ninguna imagen');
  const recovered = await restarted.getPhotoBufferAsync(photoId);
  assert.ok(recovered, 'la imagen se recupera de Firestore');
  assert.equal(`data:image/jpeg;base64,${recovered.buffer.toString('base64')}`, original);
});

test('V5.4.3-I2: una foto grande (>800 KB) se guarda en fragmentos y se reconstruye idéntica tras un reinicio', async () => {
  wipeLocalDisk();
  const remote = createRemoteStore();
  const storage = new mod.StorageManager({ remoteDocStore: remote });
  const original = fakeJpegDataUrl(1_200_000); // ≈ 1.6 MB of base64
  const { photoId } = await createInterviewWithPhoto(storage, original);

  const manifest = remote.docs.get(`interviewPhotos/${photoId}`) as any;
  assert.equal(manifest._chunked, true, 'documento dividido en fragmentos');
  assert.ok(Number(manifest._chunkCount) >= 2);
  assert.ok(remote.docs.has(`interviewPhotos/${photoId}__part0`));

  wipeLocalDisk();
  // Path 1: a single photo requested by the browser (/api/photos/:id).
  const restarted = new mod.StorageManager({ remoteDocStore: remote });
  const recovered = await restarted.getPhotoBufferAsync(photoId);
  assert.equal(`data:image/jpeg;base64,${recovered.buffer.toString('base64')}`, original);

  // Path 2: bulk load of the interviewPhotos collection (start-up / scoped sync).
  const other = new mod.StorageManager({ remoteDocStore: remote });
  other['ingestRemotePhotoDocs'](remote.collection('interviewPhotos'));
  assert.equal(other.getPhotoById(photoId)?.dataUrl, original);
  assert.equal(other.getPhotoById(`${photoId}__part0`), undefined, 'los fragmentos nunca aparecen como fotos');

  // An explicit deletion removes the record AND its fragments from Firestore.
  await other['removePhotoRemoteDocs'](photoId);
  assert.equal(remote.collection('interviewPhotos').length, 0);
});

test('V5.4.3-I3: sin imagen local nunca se genera ni se guarda un dibujo sustituto, y editar la descripción no borra la imagen de Firestore', async () => {
  wipeLocalDisk();
  const remote = createRemoteStore();
  const storage = new mod.StorageManager({ remoteDocStore: remote });
  const original = fakeJpegDataUrl(120_000);
  const { token, question, photoId } = await createInterviewWithPhoto(storage, original);

  // This instance loses its local copy (record loaded without image, empty disk), and an old
  // synthetic placeholder file is still on disk from a previous version.
  storage.getPhotoById(photoId).dataUrl = '';
  const evidenceDir = path.join(REPO_ROOT, 'data', 'photos');
  const placeholderFile = fs.existsSync(evidenceDir)
    ? fs.readdirSync(evidenceDir).find((f) => f.endsWith('.bin'))
    : undefined;
  const localPhotoPath = path.join(ISOLATED_ROOT, 'data', 'photos', `${photoId}.bin`);
  fs.mkdirSync(path.dirname(localPhotoPath), { recursive: true });
  if (placeholderFile) fs.copyFileSync(path.join(evidenceDir, placeholderFile), localPhotoPath);
  else fs.rmSync(localPhotoPath, { force: true });

  assert.equal(storage.getPhotoBuffer(photoId), null, 'el dibujo sintético se descarta, no se sirve');
  assert.equal(fs.existsSync(localPhotoPath), false, 'ni se vuelve a guardar en disco');

  // The participant edits the caption of the saved photo («Guardar y Continuar»).
  await storage.submitAnswer({
    plainToken: token,
    questionId: question.id,
    answerText: 'Esta es la casa donde crecí con mis hermanos y mis abuelos.',
    notRecalled: false,
    idempotencyKey: `edit_${Date.now()}`,
    photos: [
      {
        id: photoId,
        caption: 'La casa de mi infancia en Veracruz',
        imageUrl: `/api/photos/${photoId}`,
        fileName: 'casa.jpg',
        mimeType: 'image/jpeg',
      },
    ],
  });

  const stored = remote.docs.get(`interviewPhotos/${photoId}`) as any;
  assert.equal(stored.dataUrl, original, 'la imagen real sigue en Firestore');
  assert.equal(stored.caption, 'La casa de mi infancia en Veracruz', 'y la nueva descripción también');
  const served = await storage.getPhotoBufferAsync(photoId);
  assert.equal(`data:image/jpeg;base64,${served.buffer.toString('base64')}`, original);
});

test('V5.4.3-I4: un guardado automático con lista de fotos vacía o incompleta no elimina ninguna foto', async () => {
  wipeLocalDisk();
  const remote = createRemoteStore();
  const storage = new mod.StorageManager({ remoteDocStore: remote });
  const { token, question, photoId } = await createInterviewWithPhoto(storage, fakeJpegDataUrl(60_000));

  const result = await storage.submitAnswer({
    plainToken: token,
    questionId: question.id,
    answerText: 'Esta es la casa donde crecí, ahora con más detalles.',
    notRecalled: false,
    autosave: true,
    photos: [],
    idempotencyKey: `autosave_${Date.now()}`,
  });
  assert.deepEqual(result.answer.photos.map((p: any) => p.id), [photoId], 'la foto sigue en la respuesta');
  assert.ok(storage.getPhotoById(photoId), 'el registro sigue en memoria');
  assert.ok(remote.docs.has(`interviewPhotos/${photoId}`), 'y en Firestore');
  assert.deepEqual(remote.deletes.filter((d) => d.startsWith('interviewPhotos/')), []);
});

test('V5.4.3-I5: el arranque ya no purga fotos; solo informa de las que no tienen respuesta en memoria', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'src/server/storage.ts'), 'utf-8');
  assert.equal(/this\.purgeOrphanedPhotosAndSyncCompilations\(|async purgeOrphanedPhotos/.test(source), false, 'la purga destructiva ya no existe');
  assert.equal(/buildArchivalSepiaPng/.test(source), false, 'el generador del dibujo sustituto ya no existe');
  const storage = new mod.StorageManager({ remoteDocStore: createRemoteStore() });
  storage['photos'].set('photo_huerfana', { id: 'photo_huerfana', interviewId: 'int_x', dataUrl: TINY_PNG_DATA_URL });
  assert.deepEqual(storage.reportOrphanedPhotos(), { count: 1, photoIds: ['photo_huerfana'] });
  assert.ok(storage.getPhotoById('photo_huerfana'), 'informar no borra');
});

test('V5.4.3-I6: las fotos que versiones anteriores dejaron sin imagen en Firestore se reparan mientras la instancia aún tenga la imagen', async () => {
  wipeLocalDisk();
  const remote = createRemoteStore();
  const storage = new mod.StorageManager({ remoteDocStore: remote });
  const original = fakeJpegDataUrl(90_000);
  const { photoId } = await createInterviewWithPhoto(storage, original);
  // What older versions left in Firestore: the record without its image.
  remote.docs.set(`interviewPhotos/${photoId}`, {
    ...(remote.docs.get(`interviewPhotos/${photoId}`) as any),
    dataUrl: '',
    dataUrl_storedSeparately: true,
  });
  delete (storage.getPhotoById(photoId) as any).durableImageAt;

  const migrated = await storage.migrateDiskOnlyPhotosToDurableStore();
  assert.equal(migrated, 1);
  assert.equal((remote.docs.get(`interviewPhotos/${photoId}`) as any).dataUrl, original);
  assert.equal(await storage.migrateDiskOnlyPhotosToDurableStore(), 0, 'una foto ya verificada no se vuelve a leer');
});
