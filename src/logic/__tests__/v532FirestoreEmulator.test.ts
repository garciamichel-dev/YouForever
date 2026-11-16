/**
 * V5.3.2 — SERVER ↔ FIRESTORE THROUGH THE FIREBASE ADMIN SDK, AGAINST A FIRESTORE EMULATOR.
 *
 * What is real: the Firebase Admin SDK (gRPC), the server's adapter (firestoreAdmin.ts), StorageManager
 * with its PRODUCTION remote store (transactions, chunking, quota revision guard), the real load paths
 * used after a restart, Mi Esencia's persistence, the Express API (photos, audio, sessions) and the
 * admin token verification (RS256, test certificate).
 *
 * Emulator: `hidane` (npm, no Java), which implements the Firestore emulator protocol including named
 * databases and transactions. It does NOT evaluate security rules: those are tested separately with
 * the official Emulator Suite (`npm run test:rules`, tests/firestore-rules). Nothing here touches the
 * real Cloud Firestore, Gemini or OpenAI.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ISOLATED_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'yf_v532_emulator_'));
const require = createRequire(import.meta.url);

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForPort(port: number, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = net.connect(port, '127.0.0.1', () => {
        s.destroy();
        resolve(true);
      });
      s.on('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`El emulador no respondió en el puerto ${port}`);
}

let emulator: ChildProcess | null = null;
let EMULATOR_HOST = '';

process.chdir(ISOLATED_ROOT);
process.env.YOUFOREVER_ALLOW_TEST_DOUBLES = '1';
process.env.BOOK_APPROVAL_SECRET = 'v532-emulator-secret-only-for-local-tests';
process.env.FIREBASE_PROJECT_ID = 'demo-youforever-e2e';
process.env.METADATA_SERVER_DETECTION = 'none';
process.env.GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';
delete process.env.FIRESTORE_DATABASE_ID;
delete process.env.K_SERVICE;
delete process.env.YOUFOREVER_LOCAL_DISK_DURABLE;

const externalCalls: string[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url || input);
  if (/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) return originalFetch(input, init);
  externalCalls.push(url);
  throw new Error('Red deshabilitada en las pruebas.');
}) as typeof fetch;

type StyleId = 'first_person_simple' | 'first_person_literary' | 'third_person_biography';

let mod: any;
let storage: any;
let rules: any;
let helpers: any;
let adminAuth: any;
let fsAdmin: any;
let api: any;
let miEsencia: any;
let adminDb: any; // independent Admin SDK client to inspect the emulator
let server: any;
let baseUrl = '';
let ADMIN_EMAIL = '';
const scenario: { draftBatch?: (ctx: any) => Promise<any>; judge?: (p: any) => Promise<any> } = {};
let overrides: any;

const googleKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'simulated-kid-v532';
const AUTH_PROJECT = 'yf-auth-test';
const b64url = (v: Buffer | string) =>
  Buffer.from(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function adminToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid: KID, typ: 'JWT' };
  const payload = {
    iss: `https://securetoken.google.com/${AUTH_PROJECT}`,
    aud: AUTH_PROJECT,
    sub: 'uid-admin',
    iat: now - 10,
    exp: now + 3600,
    auth_time: now - 10,
    email: ADMIN_EMAIL,
    email_verified: true,
  };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  return `${input}.${b64url(crypto.sign('RSA-SHA256', Buffer.from(input), googleKey.privateKey))}`;
}

before(async () => {
  const port = await freePort();
  EMULATOR_HOST = `127.0.0.1:${port}`;
  process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;
  emulator = spawn(process.execPath, [require.resolve('hidane/bin/hidane.js'), '--host', '127.0.0.1', '--port', String(port)], {
    stdio: 'ignore',
  });
  await waitForPort(port);

  fsAdmin = await import(path.join(REPO_ROOT, 'src/server/firestoreAdmin.ts'));
  mod = await import(path.join(REPO_ROOT, 'src/server/storage.ts'));
  rules = await import(path.join(REPO_ROOT, 'src/logic/demoStoryRules.ts'));
  helpers = await import(path.join(REPO_ROOT, 'src/logic/__tests__/helpers/simulatedBookProviders.ts'));
  adminAuth = await import(path.join(REPO_ROOT, 'src/server/adminAuth.ts'));
  storage = mod.storage;
  overrides = {
    skipDiskCache: true,
    draftBatch: (ctx: any) => scenario.draftBatch!(ctx),
    aiJudge: (p: any) => scenario.judge!(p),
    repairBatchCaller: () => Promise.resolve(null),
    compilationPdfProvider: async (interviewId: string) =>
      helpers.buildSyntheticCompilationPdf(
        interviewId,
        storage
          .getAnswersForInterview(interviewId)
          .map((a: any) => a.answerText)
          .join('\n')
      ),
  };
  // Production remote store (Admin SDK → emulator): only the AI providers are simulated.
  storage.configureTestDoubles({ bookAiOverrides: overrides });
  await storage.ensureInitialized();
  ADMIN_EMAIL = storage.getAdmins()[0];

  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const inspector = initializeApp({ projectId: 'demo-youforever-e2e' }, 'inspector');
  adminDb = getFirestore(inspector, fsAdmin.resolveServerFirestoreTarget().databaseId);

  adminAuth.configureAdminAuthTestDoubles({
    projectId: AUTH_PROJECT,
    certificateProvider: (kid: string) =>
      kid === KID ? (googleKey.publicKey.export({ type: 'spki', format: 'pem' }) as string) : null,
    sessionSecret: 'v532-session-secret-for-tests-only-0123456789',
  });
  miEsencia = await import(path.join(REPO_ROOT, 'src/server/miEsencia/miEsenciaStore.ts'));
  api = await import(path.join(REPO_ROOT, 'src/server/api.ts'));
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use('/api', api.apiRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  emulator?.kill('SIGTERM');
  globalThis.fetch = originalFetch;
  assert.deepEqual(externalCalls, [], 'Ninguna prueba puede salir a la red.');
  setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
});

// ---------------------------------------------------------------------------------------------
const RIVER = 'Mi padre me salvó de caer al río cuando tenía seis años.';
async function createInterview(s: any = storage) {
  const created = await s.createInterview({
    title: 'Memorias en el emulador',
    storyMode: 'individual',
    storyType: 'biografia_personal',
    participants: [{ name: 'Elena Robles', relationship: 'Titular', role: 'primary' }],
    customSufficiencyThreshold: 100000,
    performedBy: 'admin_pruebas',
  });
  const interview = created.interview;
  interview.maxFollowUpsAtCreation = 0;
  const token = created.participantTokens[0].plainToken;
  const questions = s.getQuestionsForVersion(interview.questionnaireVersionId);
  const specs = helpers.buildSyntheticInterviewSpecs('small', {});
  let add = 0;
  for (const spec of specs) {
    const q = questions[spec.baseIndex];
    if (spec.kind === 'base') {
      await s.submitAnswer({ plainToken: token, questionId: q.id, answerText: spec.text, notRecalled: false, idempotencyKey: `b_${spec.baseIndex}` });
    } else {
      add++;
      await s.submitAnswer({ plainToken: token, questionId: `mem_${add}`, questionText: 'Recuerdo', answerText: spec.text, notRecalled: false, isAdditionalMemory: true, idempotencyKey: `a_${add}` });
    }
  }
  await s.submitAnswer({ plainToken: token, questionId: 'mem_river', questionText: 'Recuerdo', answerText: RIVER, notRecalled: false, isAdditionalMemory: true, idempotencyKey: 'river' });
  await s.declareVoluntaryCompletion(token, 'Declaración voluntaria');
  return { interview: s.getInterviewById(interview.id), token };
}

function useSimulatedProviders(s: any, interviewId: string, style: StyleId) {
  const ctx = s['resolveParticipantBookAuditContext'](s.getInterviewById(interviewId), style);
  const interview = s.getInterviewById(interviewId);
  const base = rules.buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: interview.title,
    storyMode: interview.storyMode,
    participantNames: s.getParticipantsForInterview(interviewId).map((p: any) => p.name),
    answers: ctx.answers,
    questions: ctx.questions,
    narrativeStyle: style,
    closingDedicationText: ctx.closingPageText,
    bookStructureMode: ctx.bookStructureMode,
  }).manuscript;
  scenario.draftBatch = helpers.createFaithfulDrafter(base, (_id: string, ps: string[]) => ps.map((p) => p.replace(/salvó de caer al río/, 'empujó al río'))).draftBatch;
  scenario.judge = helpers.createScenarioJudge({ contradictions: [{ source: /salv/, reversed: /empuj/ }] }).judge;
}

const editorialConfig = (style: StyleId, coverDesignId = 'legado_clasico') => ({
  narrativeStyle: style,
  coverDesignId,
  interiorStyleId: 'clasico_editorial',
  bookFormatId: '6x9',
  coverVisualType: 'none',
  includeTableOfContents: true,
});

async function generateBook(s: any = storage) {
  const style: StyleId = 'first_person_simple';
  const { interview, token } = await createInterview(s);
  useSimulatedProviders(s, interview.id, style);
  const result = await s.generateParticipantBookManuscript({ plainToken: token, narrativeStyle: style, scope: 'full', forceRefresh: true });
  assert.equal(result.manuscript.generationStatus, 'approved');
  return { interview, token, style, manuscript: JSON.parse(JSON.stringify(result.manuscript)) };
}

const save = (s: any, token: string, style: StyleId, manuscript: any, coverDesignId?: string) =>
  s.saveParticipantBookVersion({
    plainToken: token,
    narrativeStyle: style,
    editorialConfig: editorialConfig(style, coverDesignId),
    manuscript: JSON.parse(JSON.stringify(manuscript)),
    coverPhoto: null,
    chapterPhotos: {},
    pageCount: 20,
  });

async function remoteVersions(interviewId: string) {
  const snap = await adminDb.collection('participantBookVersions').where('interviewId', '==', interviewId).get();
  return snap.docs.map((d: any) => d.data());
}
const remoteInterview = async (id: string) => (await adminDb.collection('interviews').doc(id).get()).data();

/** A second server instance (another Cloud Run instance): same Firestore, its own memory. */
async function newInstance() {
  const s = new mod.StorageManager();
  s.configureTestDoubles({ bookAiOverrides: overrides });
  await s.ensureInitialized();
  return s;
}

// =============================================================================================

test('V5.3.2-E1: el servidor usa el Admin SDK sobre el proyecto y la base de datos CON NOMBRE configurados', async () => {
  const target = fsAdmin.resolveServerFirestoreTarget();
  assert.equal(target.databaseId, 'ai-studio-24473850-0d4d-4247-8313-c0172221b6cb', 'Base de datos con nombre de firebase-applet-config.json.');
  assert.equal(fsAdmin.resolveServerFirestoreTarget({ FIRESTORE_DATABASE_ID: 'otra' }).databaseId, 'otra');
  assert.equal(storage.constructor.name, 'StorageManager');
  const { interview } = await createInterview();
  const doc = await remoteInterview(interview.id);
  assert.equal(doc?.title, 'Memorias en el emulador', 'La entrevista se escribió en la base con nombre.');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { getApp } = await import('firebase-admin/app');
  const defaultDb = getFirestore(getApp('inspector'));
  assert.equal((await defaultDb.collection('interviews').doc(interview.id).get()).exists, false, 'Nada en la base "(default)".');
  // Answers and tokens are also server-written.
  const answers = await adminDb.collection('answers').where('interviewId', '==', interview.id).get();
  assert.ok(answers.size >= 5);
  // Errors keep the browser-SDK codes the existing checks rely on.
  assert.equal(fsAdmin.normalizeFirestoreError({ code: 8, message: 'x' }).code, 'resource-exhausted');
  assert.equal(fsAdmin.normalizeFirestoreError({ code: 7, message: 'x' }).code, 'permission-denied');
  // Automatic mode: the Admin SDK probe succeeded → admin mode.
  const status = fsAdmin.getFirestoreModeStatus();
  assert.equal(status.mode, 'admin');
  assert.equal(status.requested, 'auto');
  assert.equal(status.privateRulesSafeToDeploy, true);
});

test('V5.3.2-S1: clasificación de la sonda: credenciales o permisos → compatibilidad; cuota o caída → Admin SDK', () => {
  const auth = [
    new Error('Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication'),
    Object.assign(new Error('7 PERMISSION_DENIED: Missing or insufficient permissions.'), { code: 7 }),
    Object.assign(new Error('16 UNAUTHENTICATED'), { code: 16 }),
    { code: 'permission-denied', message: 'x' },
  ];
  for (const e of auth) assert.equal(fsAdmin.isFirestoreAuthorizationError(e), true, String((e as any).message));
  const notAuth = [
    Object.assign(new Error('8 RESOURCE_EXHAUSTED: Quota exceeded.'), { code: 8 }),
    Object.assign(new Error('14 UNAVAILABLE'), { code: 14 }),
    new Error('probe timeout'),
  ];
  for (const e of notAuth) assert.equal(fsAdmin.isFirestoreAuthorizationError(e), false, String(e.message));
});

test('V5.3.2-S2: ruta de estado solo para administradores verificados', async () => {
  const anon = await fetch(`${baseUrl}/admin/firestore-status`, { headers: { 'x-admin-user': ADMIN_EMAIL } });
  assert.equal(anon.status, 401);
  const res = await fetch(`${baseUrl}/admin/firestore-status`, { headers: { Authorization: `Bearer ${adminToken()}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.mode, 'admin');
  assert.equal(body.data.privateRulesSafeToDeploy, true);
  assert.equal(body.data.databaseId, 'ai-studio-24473850-0d4d-4247-8313-c0172221b6cb');
});

test('V5.3.2-E2: guardar un libro escribe versión, informe y cuota en UNA transacción y se recupera tras un reinicio', async () => {
  const { interview, token, style, manuscript } = await generateBook();
  const saved = await save(storage, token, style, manuscript);
  const versionId = saved.bookVersion.id;
  const versions = await remoteVersions(interview.id);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].adminAuditReport.identification.versionId, versionId, 'Informe dentro de la versión.');
  const iv = await remoteInterview(interview.id);
  assert.equal(iv.bookGeneratedCount, 1);
  assert.equal(iv.quotaRevision, 1);
  assert.equal(iv.lastBookSaveVersionId, versionId);
  const report = await storage.getBookAuditReport(versionId);
  assert.equal(report.durability.commit, 'atomic_committed');
  assert.equal(report.durability.durable, true);

  // Cloud Run restart: empty disk, new instance, real Firestore load paths.
  fs.rmSync(path.join(ISOLATED_ROOT, 'data', 'storage_state.json'), { force: true });
  const fresh = await newInstance();
  // The interview (core phase) is available at once; versions finish loading in the background.
  assert.equal(fresh.getInterviewById(interview.id).lastBookVersionNumber, 1);
  await fresh['initPromise'];
  const recovered = fresh.getBookVersionsForInterview(interview.id, false).find((v: any) => v.id === versionId);
  assert.ok(recovered, 'La versión se recupera desde Firestore.');
  const recoveredReport = await fresh.getBookAuditReport(versionId);
  assert.equal(recoveredReport.coverage.contradictions >= 1, true);
  assert.equal(recoveredReport.durability.remoteStatus, 'written');
  assert.equal(fresh.getInterviewById(interview.id).bookGeneratedCount, 1);
});

test('V5.3.2-E2b: un guardado justo después de un reinicio (versiones aún cargando) nunca repite el número de versión', async () => {
  const { interview, token, style, manuscript } = await generateBook();
  const first = await save(storage, token, style, manuscript);
  assert.equal(first.bookVersion.versionNumber, 1);
  fs.rmSync(path.join(ISOLATED_ROOT, 'data', 'storage_state.json'), { force: true });
  const fresh = new mod.StorageManager();
  fresh.configureTestDoubles({ bookAiOverrides: overrides });
  await fresh.ensureInitialized();
  // Simulate the window in which the versions have not been loaded yet.
  for (const v of Array.from(fresh['participantBookVersions'].values()) as any[]) {
    if (v.interviewId === interview.id) fresh['participantBookVersions'].delete(v.id);
  }
  useSimulatedProviders(fresh, interview.id, style);
  const second = await save(fresh, token, style, manuscript, 'portada_nueva');
  assert.equal(second.bookVersion.versionNumber, 2);
  const numbers = (await remoteVersions(interview.id)).filter((d: any) => !d._chunkOf).map((d: any) => d.versionNumber).sort();
  assert.deepEqual(numbers, [1, 2]);
  const iv = await remoteInterview(interview.id);
  assert.equal(iv.bookGeneratedCount, 2);
  assert.equal(iv.quotaRevision, 2);
});

test('V5.3.2-E3: documentos extensos (> 800 KB) se fragmentan en Firestore y se recuperan íntegros', async () => {
  const { interview, token, style, manuscript } = await generateBook();
  const saved = await save(storage, token, style, manuscript);
  const versionId = saved.bookVersion.id;
  const longNote = 'Revisión detallada del capítulo con la familia. '.repeat(80).slice(0, 3900);
  for (let i = 0; i < 230; i++) {
    await storage.addBookAuditNote({ versionId, note: `${i}: ${longNote}`, performedBy: 'admin_pruebas' });
  }
  const manifest = (await adminDb.collection('participantBookVersions').doc(versionId).get()).data();
  assert.equal(manifest._chunked, true);
  assert.ok(manifest._bytes > 800_000);
  const chunks = (await remoteVersions(interview.id)).filter((d: any) => d._chunkOf === versionId);
  assert.equal(chunks.length, manifest._chunkCount);
  fs.rmSync(path.join(ISOLATED_ROOT, 'data', 'storage_state.json'), { force: true });
  const fresh = await newInstance();
  await fresh['initPromise'];
  const report = await fresh.getBookAuditReport(versionId);
  assert.equal(report.adminNotes.length, 230, 'Informe íntegro tras el reinicio.');
  assert.ok(!fresh.getBookVersionsForInterview(interview.id, false).some((v: any) => String(v.id).includes('__part')));
});

test('V5.3.2-E4: dos instancias guardando a la vez: una sola versión y una sola modificación de cuota', async () => {
  const { interview, token, style, manuscript } = await generateBook();
  const b = await newInstance(); // same state as A before the saves
  const results = await Promise.allSettled([
    save(storage, token, style, manuscript, 'legado_clasico'),
    save(b, token, style, manuscript, 'otra_portada'),
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  assert.equal(ok.length, 1, JSON.stringify(results.map((r) => r.status)));
  assert.equal(failed.length, 1);
  assert.match(String(failed[0].reason?.message), /al mismo tiempo desde otra sesión/);
  const versions = (await remoteVersions(interview.id)).filter((d: any) => !d._chunkOf);
  assert.equal(versions.length, 1, 'Sin versiones duplicadas.');
  const iv = await remoteInterview(interview.id);
  assert.equal(iv.bookGeneratedCount, 1);
  assert.equal(iv.quotaRevision, 1, 'Una sola modificación de cuota.');
});

test('V5.3.2-E5: reintento tras un timeout cuyo commit llegó tarde: se devuelve la misma versión, sin duplicado ni doble cobro', async () => {
  const { interview, token, style, manuscript } = await generateBook();
  const realStore = storage['remoteDocStore'];
  let firstAttempt = true;
  storage.configureTestDoubles({
    remoteDocStore: {
      setDoc: realStore.setDoc,
      deleteDoc: realStore.deleteDoc,
      getDoc: realStore.getDoc,
      async commitBookVersion(request: any) {
        const out = await realStore.commitBookVersion(request);
        if (firstAttempt) {
          firstAttempt = false;
          throw new Error('Firestore commit timed out'); // the commit DID land
        }
        return out;
      },
    },
  });
  try {
    const saved = await save(storage, token, style, manuscript);
    const versions = (await remoteVersions(interview.id)).filter((d: any) => !d._chunkOf);
    assert.equal(versions.length, 1);
    assert.equal(versions[0].id, saved.bookVersion.id);
    assert.equal((await remoteInterview(interview.id)).bookGeneratedCount, 1);
    assert.equal(storage.getBookVersionsForInterview(interview.id, false).length, 1);
    assert.ok(storage.getAuditLogs(20).some((l: any) => l.action === 'SAVE_BOOK_VERSION_IDEMPOTENT_REPLAY'));

    // The participant retries from a stale instance with the same request: same version again.
    const c = await newInstance();
    const replay = await save(c, token, style, manuscript);
    assert.equal(replay.bookVersion.id, saved.bookVersion.id);
    assert.equal((await remoteInterview(interview.id)).quotaRevision, 1);
  } finally {
    storage.configureTestDoubles({ remoteDocStore: realStore });
  }
});

test('V5.3.2-E6: Firestore caído durante el commit: nada queda a medias, sin versión ni cuota', async () => {
  const { interview, token, style, manuscript } = await generateBook();
  const realStore = storage['remoteDocStore'];
  storage.configureTestDoubles({
    remoteDocStore: {
      setDoc: realStore.setDoc,
      deleteDoc: realStore.deleteDoc,
      getDoc: realStore.getDoc,
      async commitBookVersion() {
        throw Object.assign(new Error('14 UNAVAILABLE: simulated outage'), { code: 14 });
      },
    },
  });
  try {
    await assert.rejects(save(storage, token, style, manuscript), /de forma segura/);
  } finally {
    storage.configureTestDoubles({ remoteDocStore: realStore });
  }
  assert.equal((await remoteVersions(interview.id)).length, 0);
  assert.equal((await remoteInterview(interview.id)).bookGeneratedCount ?? 0, 0);
  assert.deepEqual(storage.getBookVersionsForInterview(interview.id, false), []);
  // Recovery: the same request now commits normally.
  const saved = await save(storage, token, style, manuscript);
  assert.ok(saved.bookVersion.id);
});

test('V5.3.2-E7: una instancia desactualizada no puede revertir los contadores de cuota (lost update)', async () => {
  const { interview, token, style, manuscript } = await generateBook();
  const stale = await newInstance();
  await save(storage, token, style, manuscript);
  // The stale instance writes the whole interview for an unrelated reason (older quota view).
  const staleInterview = { ...stale.getInterviewById(interview.id), title: 'Título actualizado' };
  await stale['remoteDocStore'].setDoc('interviews', interview.id, stale['sanitizeDocForFirestore'](staleInterview));
  const iv = await remoteInterview(interview.id);
  assert.equal(iv.title, 'Título actualizado', 'El resto del documento sí se actualiza.');
  assert.equal(iv.bookGeneratedCount, 1, 'La cuota consumida no se revierte.');
  assert.equal(iv.quotaRevision, 1);
});

test('V5.3.2-E8: Mi Esencia escribe y lee por el Admin SDK', async () => {
  const store = miEsencia.miEsenciaStore;
  await store.ensureInitialized();
  const plan = await store.savePlan({ name: 'Plan emulador', priceMxn: 123 });
  const remote = (await adminDb.collection('mi_esencia_plans').doc(plan.planId).get()).data();
  assert.equal(remote?.name, 'Plan emulador');
  await adminDb.collection('mi_esencia_plans').doc(plan.planId).set({ ...remote, name: 'Plan cambiado en Firestore' });
  await store.syncFromFirestore(true);
  assert.equal(store.getPlans().find((p: any) => p.planId === plan.planId)?.name, 'Plan cambiado en Firestore');
  const config = await store.updateConfig({ enabled: true } as any, 'admin_pruebas');
  assert.equal((await adminDb.collection('mi_esencia_config').doc('global').get()).data()?.updatedAt, config.updatedAt);
});

test('V5.3.2-M1: fotografías y audios: solo el participante de esa historia (o un administrador verificado); Range se conserva', async () => {
  const a = await createInterview();
  const other = await createInterview();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  const photoId = `photo_test_${Date.now()}`;
  const otherPhotoId = `photo_other_${Date.now()}`;
  const audioId = `aud_test_${Date.now()}`;
  const audioBytes = Buffer.from('OggS-simulated-voice-recording-0123456789', 'utf8');
  const basePhoto = { questionId: 'q', participantId: 'p', participantName: 'Elena', fileName: 'f.png', mimeType: 'image/png', caption: '', imageUrl: '', createdAt: new Date().toISOString() };
  storage['photos'].set(photoId, { ...basePhoto, id: photoId, interviewId: a.interview.id, dataUrl: `data:image/png;base64,${png.toString('base64')}` });
  storage['photos'].set(otherPhotoId, { ...basePhoto, id: otherPhotoId, interviewId: other.interview.id, dataUrl: `data:image/png;base64,${png.toString('base64')}` });
  storage['audios'].set(audioId, {
    id: audioId,
    interviewId: a.interview.id,
    questionId: 'q',
    participantId: 'p',
    participantName: 'Elena',
    audioUrl: `/api/audio/${audioId}`,
    audioDataUrl: `data:audio/ogg;base64,${audioBytes.toString('base64')}`,
    mimeType: 'audio/ogg',
    transcription: '',
    createdAt: new Date().toISOString(),
  });

  // Anonymous: nothing.
  for (const url of [`/photos/${photoId}`, `/audio/${audioId}`]) {
    const res = await fetch(`${baseUrl}${url}`);
    assert.equal(res.status, 401, url);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  }
  // A forged cookie (or an e-mail) does not help.
  const forged = await fetch(`${baseUrl}/photos/${photoId}`, { headers: { Cookie: `yf_media_access=${b64url('{"v":1,"interviews":["x"],"exp":9999999999}')}.AAAA`, 'x-admin-user': ADMIN_EMAIL } });
  assert.equal(forged.status, 401);

  // The participant opens their story with the access code → media cookie for THEIR interview.
  const session = await fetch(`${baseUrl}/participant/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: a.token }),
  });
  assert.equal(session.status, 200);
  const setCookie = session.headers.get('set-cookie') || '';
  assert.match(setCookie, /yf_media_access=/);
  assert.match(setCookie, /HttpOnly/);
  const cookie = setCookie.split(';')[0];

  const photo = await fetch(`${baseUrl}/photos/${photoId}`, { headers: { Cookie: cookie } });
  assert.equal(photo.status, 200);
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()), png);
  assert.match(photo.headers.get('cache-control') || '', /^private/);

  const full = await fetch(`${baseUrl}/audio/${audioId}`, { headers: { Cookie: cookie } });
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  const ranged = await fetch(`${baseUrl}/audio/${audioId}`, { headers: { Cookie: cookie, Range: 'bytes=0-3' } });
  assert.equal(ranged.status, 206, 'HTTP Range para la reproducción.');
  assert.equal(ranged.headers.get('content-range'), `bytes 0-3/${audioBytes.length}`);
  assert.equal(Buffer.from(await ranged.arrayBuffer()).toString('utf8'), 'OggS');

  // Another family's photo stays private even with a valid cookie.
  const foreign = await fetch(`${baseUrl}/photos/${otherPhotoId}`, { headers: { Cookie: cookie } });
  assert.equal(foreign.status, 403);

  // A verified administrator can see every file.
  const asAdmin = await fetch(`${baseUrl}/photos/${otherPhotoId}`, { headers: { Authorization: `Bearer ${adminToken()}` } });
  assert.equal(asAdmin.status, 200);
});

test('V5.3.2-C1: modo de compatibilidad (SDK de cliente, como en AI Studio sin permisos IAM): la app sigue funcionando igual', async () => {
  fsAdmin.configureFirestoreModeForTests('client');
  try {
    const status = fsAdmin.getFirestoreModeStatus();
    assert.equal(status.mode, 'client');
    assert.equal(status.privateRulesSafeToDeploy, false, 'En este modo no deben publicarse las reglas privadas.');
    // Same flows as in admin mode: interview, answers, generation, atomic save, quota, report.
    const { interview, token, style, manuscript } = await generateBook();
    const saved = await save(storage, token, style, manuscript);
    const versions = (await remoteVersions(interview.id)).filter((d: any) => !d._chunkOf);
    assert.equal(versions.length, 1);
    assert.equal(versions[0].adminAuditReport.identification.versionId, saved.bookVersion.id);
    const iv = await remoteInterview(interview.id);
    assert.equal(iv.bookGeneratedCount, 1);
    assert.equal(iv.quotaRevision, 1);
    assert.equal((await storage.getBookAuditReport(saved.bookVersion.id)).durability.commit, 'atomic_committed');
    // Concurrency protection also works with the client SDK transactions.
    const b = await newInstance();
    const again = await Promise.allSettled([
      save(storage, token, style, manuscript, 'portada_a'),
      save(b, token, style, manuscript, 'portada_b'),
    ]);
    assert.equal(again.filter((r) => r.status === 'fulfilled').length, 1, JSON.stringify(again.map((r) => r.status)));
    assert.equal((await remoteInterview(interview.id)).quotaRevision, 2);
    // Telemetry increments and counts go through the same adapter.
    const count = await fsAdmin.getCountFromServer(fsAdmin.query(fsAdmin.collection(fsAdmin.getServerFirestore(), 'answers'), fsAdmin.where('interviewId', '==', interview.id)));
    assert.ok(count.data().count >= 5);
  } finally {
    fsAdmin.configureFirestoreModeForTests('admin');
  }
});

// =============================================================================================
// V5.4.0 — Fotografías del testimonio en el chat de Mi Esencia (de punta a punta, sin red).
// =============================================================================================

test('V5.4.0-F1: el avatar muestra la fotografía real que se le pide y solo la entrega a quien tiene acceso', async () => {
  const miEsencia = await import(path.join(REPO_ROOT, 'src/server/miEsencia/miEsenciaStore.ts'));
  const store = miEsencia.miEsenciaStore;
  await store.ensureInitialized();

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  const makeInterview = async (title: string, photos: Array<{ text: string; caption: string }>) => {
    const created = await storage.createInterview({
      title,
      storyMode: 'individual',
      storyType: 'biografia_personal',
      participants: [{ name: 'Elena Robles', relationship: 'Titular', role: 'primary' }],
      customSufficiencyThreshold: 100000,
      performedBy: 'admin_pruebas',
    });
    created.interview.maxFollowUpsAtCreation = 0;
    const token = created.participantTokens[0].plainToken;
    const questions = storage.getQuestionsForVersion(created.interview.questionnaireVersionId);
    for (const [i, p] of photos.entries()) {
      await storage.submitAnswer({
        plainToken: token,
        questionId: questions[i].id,
        answerText: p.text,
        notRecalled: false,
        photos: [{ dataUrl, caption: p.caption, fileName: `foto_${i}.png`, mimeType: 'image/png' }],
        idempotencyKey: `photo_answer_${title}_${i}`,
      });
    }
    return created.interview;
  };

  const interview = await makeInterview('Memorias con fotos V5.4.0', [
    { text: 'La casa de mi abuelita Irene tenía un sillón junto a la ventana.', caption: 'La casa de mi abuelita Irene en Acapulco' },
    { text: 'Volaba culebrinas en la playa con mis primos.', caption: 'Volando mi culebrina en la playa' },
  ]);
  const other = await makeInterview('Otra persona V5.4.0', [
    { text: 'Mi primer coche fue un vocho rojo.', caption: 'Mi vocho rojo' },
  ]);

  const avatarFor = async (iv: any) => {
    const created = await store.createOrSyncAvatarFromInterview({ interviewId: iv.id, adminEmail: 'admin_pruebas' });
    const avatarId = created.avatarId || created.subscription?.avatarId || created.avatar?.avatarId || created.persons?.[0]?.avatarId;
    assert.ok(avatarId, 'Se crea el avatar.');
    const { credential } = await store.createInterlocutorWithCode({
      avatarId,
      fullName: 'Nieta de prueba',
      relationshipToPerson: 'Nieta',
      adminEmail: 'admin_pruebas',
    });
    return credential.personalCodePlain as string;
  };
  const code = await avatarFor(interview);
  const otherCode = await avatarFor(other);

  const callsBefore = externalCalls.length;
  const reply = await store.converseWithAvatar({
    personalCode: code,
    messageText: '¿Tienes alguna foto de la casa de tu abuelita?',
    acceptConsent: true,
  });
  externalCalls.splice(callsBefore); // the reply model is unreachable here (refused by the stub)

  assert.equal(reply.photoAttachments?.length, 1, JSON.stringify(reply.photoAttachments));
  // V5.4.2: without an AI engine available, the caption is the original one cleaned (never literal).
  assert.equal(reply.photoAttachments[0].caption, 'La casa de mi abuelita Irene en Acapulco.');
  assert.match(reply.replyText, /fotograf/i, 'El texto acompaña a la foto.');
  assert.doesNotMatch(reply.replyText, /no puedo (mostrar|enseñar|compartir)/i);
  const lastAvatarMsg = reply.session.messages[reply.session.messages.length - 1];
  assert.deepEqual(lastAvatarMsg.photoAttachments, reply.photoAttachments, 'La foto queda en el historial del chat.');
  const lastUserMsg = reply.session.messages[reply.session.messages.length - 2];
  assert.doesNotMatch(lastUserMsg.content, /Nota del sistema/, 'La nota para el modelo nunca se guarda.');

  // The image is delivered only with a code of that avatar.
  const photoId = reply.photoAttachments[0].photoId;
  const image = await store.getFamilyChatPhoto({ personalCode: code, photoId });
  assert.ok(image && image.buffer.equals(png));
  assert.equal(await store.getFamilyChatPhoto({ personalCode: otherCode, photoId }), null, 'Otro avatar no la obtiene.');
  await assert.rejects(store.getFamilyChatPhoto({ personalCode: 'YF-NOEXISTE', photoId }));

  // Without a photo request, no photo is attached.
  const plain = await store.converseWithAvatar({ personalCode: code, messageText: '¿Cómo era tu abuelita?', acceptConsent: true });
  externalCalls.splice(callsBefore);
  assert.equal(plain.photoAttachments, undefined);

  // An avatar created before V5.4.0 kept only the photo descriptions: the photo is still found
  // (recovered from the original answer) and delivered.
  for (const t of store['testimonies'].values()) {
    if (t.personId === reply.activePerson.personId) delete t.photoAttachments;
  }
  const legacy = await store.converseWithAvatar({ personalCode: code, messageText: 'Muéstrame la foto de tu culebrina en la playa', acceptConsent: true });
  externalCalls.splice(callsBefore);
  assert.equal(legacy.photoAttachments?.[0]?.caption, 'Volando mi culebrina en la playa.');
  const legacyImage = await store.getFamilyChatPhoto({ personalCode: code, photoId: legacy.photoAttachments[0].photoId });
  assert.ok(legacyImage && legacyImage.buffer.equals(png));
});

// =============================================================================================
// V5.4.2 — Mi Esencia: código general, prompt con ChatGPT, descripción de fotos por IA y rendimiento.
// =============================================================================================

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

async function interviewWithPhotos(title: string, items: Array<{ text: string; caption?: string }>) {
  const created = await storage.createInterview({
    title,
    storyMode: 'individual',
    storyType: 'biografia_personal',
    participants: [{ name: 'Elena Robles', relationship: 'Titular', role: 'primary' }],
    customSufficiencyThreshold: 100000,
    performedBy: 'admin_pruebas',
  });
  created.interview.maxFollowUpsAtCreation = 0;
  const token = created.participantTokens[0].plainToken;
  const questions = storage.getQuestionsForVersion(created.interview.questionnaireVersionId);
  for (const [i, it] of items.entries()) {
    await storage.submitAnswer({
      plainToken: token,
      questionId: questions[i].id,
      answerText: it.text,
      notRecalled: false,
      photos: it.caption
        ? [{ dataUrl: `data:image/png;base64,${PNG_1PX.toString('base64')}`, caption: it.caption, fileName: `f${i}.png`, mimeType: 'image/png' }]
        : undefined,
      idempotencyKey: `${title}_${i}`,
    });
  }
  return { interview: created.interview, token, questions };
}

test('V5.4.2-M1: un avatar nuevo crea por defecto un código GENERAL, sin familiar; el avatar no se apropia de la identidad de quien escribe', async () => {
  const store = miEsencia.miEsenciaStore;
  await store.ensureInitialized();
  const { interview } = await interviewWithPhotos('Código general V5.4.2', [
    { text: 'Mi hija Laura y mi nieto Pablo vivían conmigo en Acapulco.' },
    { text: 'Mi esposa Carmen cocinaba pozole los jueves.' },
  ]);
  const created = await store.createOrSyncAvatarFromInterview({ interviewId: interview.id, adminEmail: 'admin_pruebas' });
  assert.equal(created.credentials.length, 1, 'Un solo código por defecto (no uno por cada familiar mencionado).');
  const cred = created.credentials[0];
  const inter = store['interlocutors'].get(cred.interlocutorId);
  assert.equal(inter.isGeneralAccess, true);
  assert.equal(inter.fullName, 'Visitante');
  assert.equal(inter.linkedRelatedPersonId, undefined, 'No está relacionado con ningún familiar.');
  assert.equal(inter.permissions.canAddPrivateMemoryLevelC, false, 'Código compartido: sin memorias privadas.');

  const callsBefore = externalCalls.length;
  const reply = await store.converseWithAvatar({
    personalCode: cred.personalCodePlain,
    messageText: 'Hola, soy Laura, tu hija.',
    acceptConsent: true,
  });
  externalCalls.splice(callsBefore);
  assert.ok(reply.replyText.length > 0);
  const after = store['interlocutors'].get(cred.interlocutorId);
  assert.equal(after.fullName, 'Visitante', 'El código general nunca se renombra con la identidad de quien escribe.');
  assert.equal(store['credentials'].get(cred.accessCredentialId).interlocutorName, cred.interlocutorName);

  // Codes for specific relatives are still created when the administrator lists them.
  const other = await interviewWithPhotos('Con familiares V5.4.2', [{ text: 'Recuerdo mi infancia.' }]);
  const withFamily = await store.createOrSyncAvatarFromInterview({
    interviewId: other.interview.id,
    adminEmail: 'admin_pruebas',
    initialFamilyMembers: [{ fullName: 'Ana Robles', relationshipToPerson: 'Nieta' }],
  });
  assert.equal(withFamily.credentials.length, 2);
  assert.equal(store['interlocutors'].get(withFamily.credentials[0].interlocutorId).isGeneralAccess, true);
  assert.equal(store['interlocutors'].get(withFamily.credentials[1].interlocutorId).isGeneralAccess, undefined);
});

test('V5.4.2-M2: con ChatGPT seleccionado y su campo de prompt vacío, TODOS los turnos pasan por el modelo con el prompt (sin textos fijos)', async () => {
  const store = miEsencia.miEsenciaStore;
  await store.ensureInitialized();
  const { interview } = await interviewWithPhotos('Prompt ChatGPT V5.4.2', [{ text: 'Nací en Acapulco.' }]);
  const created = await store.createOrSyncAvatarFromInterview({ interviewId: interview.id, adminEmail: 'admin_pruebas' });
  const person = created.persons[0];
  const live = store['persons'].get(person.personId);
  live.aiConfig = {
    ...live.aiConfig,
    conversationConfigMode: 'modo_personalizado',
    primaryProvider: 'openai',
    openaiPromptContent: '',
    geminiPromptContent: 'Eres la abuela Elena. Responde siempre con calidez.',
  };
  const code = created.credentials[0].personalCodePlain;
  // Small talk used to be intercepted by a fixed text when OpenAI's own field was empty.
  const callsBefore = externalCalls.length;
  const first = await store.converseWithAvatar({ personalCode: code, messageText: 'Hola, ¿cómo estás?', acceptConsent: true });
  first.session.lastProviderUsed = undefined;
  const reply = await store.converseWithAvatar({ personalCode: code, messageText: '¿Cómo estás hoy?', acceptConsent: true });
  externalCalls.splice(callsBefore);
  assert.ok(reply.session.lastProviderUsed, 'El turno se resolvió por el orquestador del modelo con el prompt.');

  const panel = fs.readFileSync(path.join(REPO_ROOT, 'src/modules/mi-esencia/MiEsenciaAvatarAiConfigPanel.tsx'), 'utf-8');
  assert.match(panel, /openai-prompt-differs-warning/);
  assert.match(panel, /Usar el mismo prompt que Gemini/);
});

test('V5.4.2-M3: el pie de cada foto lo escribe el motor configurado con el prompt del avatar (no la transcripción literal), y se reutiliza', async () => {
  const store = miEsencia.miEsenciaStore;
  await store.ensureInitialized();
  const { interview } = await interviewWithPhotos('Pie de foto IA V5.4.2', [
    { text: 'La casa de mi abuelita Irene tenía un sillón.', caption: 'y bueno la casa de de mi abuelita ju- Irene en acapulco' },
  ]);
  const created = await store.createOrSyncAvatarFromInterview({ interviewId: interview.id, adminEmail: 'admin_pruebas' });
  const live = store['persons'].get(created.persons[0].personId);
  live.aiConfig = { ...live.aiConfig, conversationConfigMode: 'modo_personalizado', primaryProvider: 'gemini', geminiPromptContent: 'PROMPT-DEL-AVATAR: habla como la abuela Elena.' };
  const code = created.credentials[0].personalCodePlain;

  const calls: Array<{ systemInstructions: string; userText: string }> = [];
  store.__setPhotoDescriptionGeneratorForTests(async (input: any) => {
    calls.push(input);
    return '«Así era la casa de mi abuelita Irene, allá en Acapulco.»';
  });
  try {
    const callsBefore = externalCalls.length;
    const r1 = await store.converseWithAvatar({ personalCode: code, messageText: '¿Tienes una foto de la casa de tu abuelita?', acceptConsent: true });
    const r2 = await store.converseWithAvatar({ personalCode: code, messageText: 'Muéstrame otra vez la foto de la casa de tu abuelita', acceptConsent: true });
    externalCalls.splice(callsBefore);
    assert.equal(r1.photoAttachments[0].caption, 'Así era la casa de mi abuelita Irene, allá en Acapulco.');
    assert.equal(r2.photoAttachments[0].caption, r1.photoAttachments[0].caption);
    assert.equal(calls.length, 1, 'La descripción se genera una vez y se reutiliza.');
    assert.match(calls[0].systemInstructions, /PROMPT-DEL-AVATAR/, 'Usa el prompt del avatar.');
    assert.match(calls[0].systemInstructions, /pie de una fotograf/i);
    assert.match(calls[0].userText, /ju- Irene/, 'Recibe la descripción original como fuente.');
    assert.doesNotMatch(JSON.stringify(r1.session.messages.at(-1)), /ju-|de de/, 'El chat nunca muestra el texto literal.');

    // No engine available → original description cleaned (no fillers or false starts).
    store.__setPhotoDescriptionGeneratorForTests(async () => null);
    const r3 = await store.converseWithAvatar({ personalCode: code, messageText: 'foto de la casa de tu abuelita', acceptConsent: true });
    externalCalls.splice(callsBefore);
    assert.equal(r3.photoAttachments[0].caption, 'La casa de mi abuelita Irene en acapulco.');
  } finally {
    store.__setPhotoDescriptionGeneratorForTests(null);
  }
});

test('V5.4.2-M4: rendimiento — sin cambios no se reconstruye nada; el PDF compilado se genera solo al descargarlo; el acceso familiar no arma el panorama de administrador', async () => {
  const store = miEsencia.miEsenciaStore;
  await store.ensureInitialized();
  const { interview, token, questions } = await interviewWithPhotos('Rendimiento V5.4.2', [
    { text: 'Primer recuerdo.', caption: 'Foto uno' },
    { text: 'Segundo recuerdo.' },
  ]);
  const created = await store.createOrSyncAvatarFromInterview({ interviewId: interview.id, adminEmail: 'admin_pruebas' });
  const personId = created.persons[0].personId;
  store.syncPersonWithAssignedPdfAndInterview(personId);

  const original = store['buildTestimonyBlocksFromInterviewData'].bind(store);
  let builds = 0;
  let withPhotoData = 0;
  store['buildTestimonyBlocksFromInterviewData'] = (p: any) => {
    builds++;
    if (p.includePhotoData) withPhotoData++;
    return original(p);
  };
  try {
    for (let i = 0; i < 5; i++) store.syncPersonWithAssignedPdfAndInterview(personId);
    assert.equal(builds, 0, 'Sin cambios en la entrevista no se reconstruye nada.');

    await storage.submitAnswer({ plainToken: token, questionId: questions[1].id, answerText: 'Segundo recuerdo, corregido.', notRecalled: false, autosave: true, idempotencyKey: 'perf_edit' });
    store.syncPersonWithAssignedPdfAndInterview(personId);
    assert.equal(builds, 1, 'Un cambio sí reconstruye (una vez).');
    assert.equal(withPhotoData, 0, 'La sincronización no carga el contenido de las fotos.');
    const person = store['persons'].get(personId);
    const pdf = store['compilationPdfs'].get(person.sourcePdfId);
    assert.match(pdf.rawTextContent, /Segundo recuerdo, corregido\./, 'El texto que lee el avatar se actualiza al momento.');
    assert.equal(pdf.pdfBase64, '', 'El archivo PDF no se regenera en cada sincronización.');

    const downloaded = store.getCompilationPdfById(person.sourcePdfId);
    assert.ok(downloaded && downloaded.pdfBase64.length > 100, 'Al descargarlo, el PDF se genera completo.');
    assert.ok(Buffer.from(downloaded.pdfBase64, 'base64').subarray(0, 5).toString() === '%PDF-');
  } finally {
    store['buildTestimonyBlocksFromInterviewData'] = original;
  }

  const router = fs.readFileSync(path.join(REPO_ROOT, 'src/server/miEsencia/miEsenciaRouter.ts'), 'utf-8');
  const verify = router.slice(router.indexOf("'/family/verify-code'"), router.indexOf("'/family/accept-consent'"));
  assert.doesNotMatch(verify, /getAdminOverviewData/);
  assert.match(verify, /getFamilyPortalData/);
});
