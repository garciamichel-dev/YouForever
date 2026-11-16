/**
 * V5.3.1 — ADMIN AUTHENTICATION, PARTICIPANT CONFIDENTIALITY AND DURABLE PERSISTENCE.
 *
 * Real HTTP: the application's real `apiRouter` is mounted on an Express server listening on
 * 127.0.0.1 and every request below is a real HTTP request (status codes, headers, cookies, JSON
 * bodies). Real identity checks: Firebase-style ID tokens are RS256-signed with a key generated in
 * this test; the server verifies them with the same code used in production (only the certificate
 * source is replaced, through the explicit test-double switch).
 *
 * Simulated: the AI providers (drafter, judge, repair) and Cloud Firestore (an in-memory document
 * store that can be told to fail). No Gemini/OpenAI calls; any other network call fails the test.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ISOLATED_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'yf_v531_security_'));

process.chdir(ISOLATED_ROOT);
process.env.YOUFOREVER_ALLOW_TEST_DOUBLES = '1';
process.env.BOOK_APPROVAL_SECRET = 'v531-security-secret-only-for-local-tests';
delete process.env.BOOK_APPROVAL_PREVIOUS_SECRETS;
delete process.env.K_SERVICE;
delete process.env.YOUFOREVER_LOCAL_DISK_DURABLE;
delete process.env.ADMIN_SESSION_SECRET;
process.env.GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';

const externalCalls: string[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url || input);
  if (/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) return originalFetch(input, init);
  externalCalls.push(url);
  throw new Error('Red deshabilitada en las pruebas.');
}) as typeof fetch;

type StyleId = 'first_person_simple' | 'first_person_literary' | 'third_person_biography';

// ---------------------------------------------------------------------------------------------
// Simulated Firestore: keeps documents (JSON copies) and can fail on demand.
// ---------------------------------------------------------------------------------------------
const remoteDocs = new Map<string, Record<string, unknown>>();
const remoteFailures: { all: boolean; collections: Set<string> } = { all: false, collections: new Set() };
const fakeRemoteStore = {
  async setDoc(collectionName: string, docId: string, data: Record<string, unknown>) {
    if (remoteFailures.all || remoteFailures.collections.has(collectionName)) {
      throw new Error('Firestore no disponible (simulado)');
    }
    const json = JSON.stringify(data);
    if (Buffer.byteLength(json, 'utf8') > 1_048_576) throw new Error('Document exceeds the limit (simulado)');
    remoteDocs.set(`${collectionName}/${docId}`, JSON.parse(json));
  },
  async deleteDoc(collectionName: string, docId: string) {
    if (remoteFailures.all) throw new Error('Firestore no disponible (simulado)');
    remoteDocs.delete(`${collectionName}/${docId}`);
  },
};
const remoteCollection = (name: string) =>
  Array.from(remoteDocs.entries())
    .filter(([key]) => key.startsWith(`${name}/`))
    .map(([, value]) => JSON.parse(JSON.stringify(value)));
const resetRemoteFailures = () => {
  remoteFailures.all = false;
  remoteFailures.collections.clear();
};

const scenario: { draftBatch?: (ctx: any) => Promise<any>; judge?: (p: any) => Promise<any>; repair?: any } = {};

let mod: any;
let storage: any;
let rules: any;
let helpers: any;
let adminAuth: any;
let durable: any;
let api: any;
let baseUrl = '';
let server: any;
let ADMIN_EMAIL = '';

// RSA key of the simulated Google token service, and a second key an attacker controls.
const googleKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const attackerKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'simulated-securetoken-kid';
const PROJECT_ID = 'yf-test-project';

const b64url = (v: Buffer | string) =>
  Buffer.from(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function mintIdToken(claims: Record<string, unknown> = {}, opts: { key?: crypto.KeyObject; kid?: string; alg?: string } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: opts.alg || 'RS256', kid: opts.kid ?? KID, typ: 'JWT' };
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    auth_time: now - 60,
    user_id: 'uid-admin',
    sub: 'uid-admin',
    iat: now - 30,
    exp: now + 3600,
    email: ADMIN_EMAIL,
    email_verified: true,
    firebase: { sign_in_provider: 'google.com' },
    ...claims,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature =
    header.alg === 'none' ? '' : crypto.sign('RSA-SHA256', Buffer.from(signingInput), opts.key || googleKey.privateKey);
  return `${signingInput}.${b64url(signature)}`;
}

before(async () => {
  mod = await import(path.join(REPO_ROOT, 'src/server/storage.ts'));
  rules = await import(path.join(REPO_ROOT, 'src/logic/demoStoryRules.ts'));
  helpers = await import(path.join(REPO_ROOT, 'src/logic/__tests__/helpers/simulatedBookProviders.ts'));
  adminAuth = await import(path.join(REPO_ROOT, 'src/server/adminAuth.ts'));
  durable = await import(path.join(REPO_ROOT, 'src/server/durableDocs.ts'));
  storage = mod.storage;
  storage.configureTestDoubles({
    remoteDocStore: fakeRemoteStore,
    bookAiOverrides: {
      skipDiskCache: true,
      draftBatch: (ctx: any) => scenario.draftBatch!(ctx),
      aiJudge: (p: any) => scenario.judge!(p),
      repairBatchCaller: (p: string, s: string, ids: string[]) => (scenario.repair ? scenario.repair(p, s, ids) : Promise.resolve(null)),
      compilationPdfProvider: async (interviewId: string) =>
        helpers.buildSyntheticCompilationPdf(
          interviewId,
          storage
            .getAnswersForInterview(interviewId)
            .map((a: any) => a.answerText)
            .join('\n')
        ),
    },
  });
  // No real Firestore in tests: the remote state is the simulated store above.
  storage['initialized'] = true;
  storage.syncFromFirestore = async () => ({ synced: false, quotaExhausted: false, mode: 'incremental', message: 'test', status: {} });
  ADMIN_EMAIL = storage.getAdmins()[0];
  assert.ok(ADMIN_EMAIL, 'Debe existir al menos un administrador configurado en el servidor.');
  adminAuth.configureAdminAuthTestDoubles({
    projectId: PROJECT_ID,
    certificateProvider: (kid: string) =>
      kid === KID ? (googleKey.publicKey.export({ type: 'spki', format: 'pem' }) as string) : null,
    sessionSecret: 'v531-session-secret-for-tests-only-0123456789',
  });

  api = await import(path.join(REPO_ROOT, 'src/server/api.ts'));
  const express = (await import('express')).default;
  const app = express();
  app.use('/api', api.apiRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  globalThis.fetch = originalFetch;
  assert.deepEqual(externalCalls, [], 'Ninguna prueba puede salir a la red ni llamar a proveedores reales.');
});

async function http(method: string, route: string, opts: { headers?: Record<string, string>; body?: unknown } = {}) {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

// ---------------------------------------------------------------------------------------------
// Fixtures through the REAL storage API
// ---------------------------------------------------------------------------------------------
const RIVER = 'Mi padre me salvó de caer al río cuando tenía seis años.';
async function createInterview(extraMemories: string[] = []) {
  const created = await storage.createInterview({
    title: 'Memorias de prueba V5.3.1',
    storyMode: 'individual',
    storyType: 'biografia_personal',
    participants: [{ name: 'Elena Robles', relationship: 'Titular', role: 'primary' }],
    customSufficiencyThreshold: 100000,
    performedBy: 'admin_pruebas',
  });
  const interview = created.interview;
  interview.maxFollowUpsAtCreation = 0;
  const token = created.participantTokens[0].plainToken;
  const questions = storage.getQuestionsForVersion(interview.questionnaireVersionId);
  const specs = helpers.buildSyntheticInterviewSpecs('small', {});
  let add = 0;
  for (const spec of specs) {
    const q = questions[spec.baseIndex];
    if (spec.kind === 'base') {
      await storage.submitAnswer({ plainToken: token, questionId: q.id, answerText: spec.text, notRecalled: false, idempotencyKey: `b_${spec.baseIndex}` });
    } else {
      add++;
      await storage.submitAnswer({
        plainToken: token,
        questionId: `mem_${add}`,
        questionText: spec.questionText || 'Recuerdo',
        answerText: spec.text,
        notRecalled: false,
        isAdditionalMemory: true,
        idempotencyKey: `a_${add}`,
      });
    }
  }
  for (const [i, text] of extraMemories.entries()) {
    await storage.submitAnswer({
      plainToken: token,
      questionId: `mem_extra_${i}`,
      questionText: 'Recuerdo adicional',
      answerText: text,
      notRecalled: false,
      isAdditionalMemory: true,
      idempotencyKey: `x_${i}`,
    });
  }
  await storage.declareVoluntaryCompletion(token, 'Declaración voluntaria');
  return { interview: storage.getInterviewById(interview.id), token };
}

function useSimulatedProviders(interviewId: string, style: StyleId, transform?: (id: string, ps: string[]) => string[]) {
  const ctx = storage['resolveParticipantBookAuditContext'](storage.getInterviewById(interviewId), style);
  const interview = storage.getInterviewById(interviewId);
  const base = rules.buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: interview.title,
    storyMode: interview.storyMode,
    participantNames: storage.getParticipantsForInterview(interviewId).map((p: any) => p.name),
    answers: ctx.answers,
    questions: ctx.questions,
    narrativeStyle: style,
    closingDedicationText: ctx.closingPageText,
    bookStructureMode: ctx.bookStructureMode,
  }).manuscript;
  scenario.draftBatch = helpers.createFaithfulDrafter(base, transform).draftBatch;
  scenario.judge = helpers.createScenarioJudge({ contradictions: [{ source: /salv/, reversed: /empuj/ }] }).judge;
  scenario.repair = async () => null;
}

const editorialConfigFor = (style: StyleId) => ({
  narrativeStyle: style,
  coverDesignId: 'legado_clasico',
  interiorStyleId: 'clasico_editorial',
  bookFormatId: '6x9',
  coverVisualType: 'none',
  includeTableOfContents: true,
});

/** A book WITH observations (one contradiction): what the participant receives from the server. */
async function generateBookWithObservations(style: StyleId = 'first_person_simple') {
  const { interview, token } = await createInterview([RIVER]);
  useSimulatedProviders(interview.id, style, (_id, ps) => ps.map((p) => p.replace(/salvó de caer al río/, 'empujó al río')));
  const res = await http('POST', '/participant/book/generate-manuscript', {
    body: { token, narrativeStyle: style, scope: 'full', forceRefresh: true },
  });
  assert.equal(res.status, 200, res.text.slice(0, 300));
  assert.equal(res.json.data.manuscript.generationStatus, 'approved');
  return { interview, token, response: res, manuscript: res.json.data.manuscript };
}

async function saveViaHttp(token: string, style: StyleId, manuscript: any) {
  return http('POST', '/participant/book/save-version', {
    body: { token, narrativeStyle: style, editorialConfig: editorialConfigFor(style), manuscript, coverPhoto: null, chapterPhotos: {}, pageCount: 20 },
  });
}

const ADMIN_ONLY_PATTERN =
  /coverage|cobertura|coverageExactPercent|coverageBand|deliveryStatus|contradic|deliveryEligible|deliveryDecision|verificationLevel|verifiedUnits|integratedUnits|traceability|documentaryAudit|editorialAudit|auditSummary|auditReport|adminAuditReport|diagnosticSummary|internalReasonCode|repairSummary|generationMetrics|previewFidelity|judge|pending_review|delivered_with_observations|fully_verified/i;

function assertNoAdminData(label: string, payload: unknown) {
  const json = JSON.stringify(payload);
  const hit = json.match(ADMIN_ONLY_PATTERN);
  assert.equal(hit, null, `${label}: respuesta de participante con datos internos (${hit?.[0]}) …${hit ? json.slice(Math.max(0, (hit.index || 0) - 80), (hit.index || 0) + 80) : ''}`);
}

// =============================================================================================
// 1. AUTENTICACIÓN ADMINISTRATIVA
// =============================================================================================

test('V5.3.1-A1: un correo de administrador enviado por el cliente (query, encabezados, Bearer) ya no autoriza nada', async () => {
  const forged: Array<[string, Record<string, string>]> = [
    [`/admin/book-audits?admin=${encodeURIComponent(ADMIN_EMAIL)}`, {}],
    [`/admin/book-audits?adminEmail=${encodeURIComponent(ADMIN_EMAIL)}`, {}],
    [`/admin/book-audits?token=${encodeURIComponent(ADMIN_EMAIL)}`, {}],
    ['/admin/book-audits', { 'x-admin-user': ADMIN_EMAIL }],
    ['/admin/book-audits', { 'x-admin-email': ADMIN_EMAIL }],
    ['/admin/book-audits', { Authorization: `Bearer ${ADMIN_EMAIL}` }],
    ['/admin/book-audits', { Authorization: ADMIN_EMAIL }],
  ];
  for (const [route, headers] of forged) {
    const res = await http('GET', route, { headers });
    assert.equal(res.status, 401, `${route} ${JSON.stringify(headers)}`);
    assert.equal(res.json.success, false);
  }
  // Pre-existing admin endpoints (the defect predates V5.3).
  for (const [method, route] of [
    ['GET', '/audit-logs'],
    ['POST', '/config'],
    ['GET', `/mi-esencia/admin/overview?admin=${encodeURIComponent(ADMIN_EMAIL)}`],
  ] as const) {
    const res = await http(method, route, { headers: { 'x-admin-user': ADMIN_EMAIL, 'x-admin-email': ADMIN_EMAIL }, body: method === 'POST' ? {} : undefined });
    assert.equal(res.status, 401, route);
  }
  // admin-check no longer trusts ?email= nor publishes the administrator list.
  const check = await http('GET', `/auth/admin-check?email=${encodeURIComponent(ADMIN_EMAIL)}`, { headers: { 'x-admin-user': ADMIN_EMAIL } });
  assert.equal(check.status, 200);
  assert.equal(check.json.data.isAdmin, false);
  assert.equal(check.json.data.authorizedAdmins, undefined);
  assert.ok(!check.text.includes(ADMIN_EMAIL), 'No se publican las direcciones de los administradores.');
});

test('V5.3.1-A2: tokens falsificados, caducados, de otro proyecto, sin correo verificado o de cuentas no administradoras se rechazan', async () => {
  const now = Math.floor(Date.now() / 1000);
  const cases: Array<[string, string]> = [
    ['firma de otra clave', mintIdToken({}, { key: attackerKey.privateKey })],
    ['clave desconocida', mintIdToken({}, { kid: 'otra-clave' })],
    ['alg none', mintIdToken({}, { alg: 'none' })],
    ['caducado', mintIdToken({ exp: now - 3600, iat: now - 7200 })],
    ['emitido en el futuro', mintIdToken({ iat: now + 3600 })],
    ['otro proyecto (aud)', mintIdToken({ aud: 'otro-proyecto' })],
    ['otro emisor (iss)', mintIdToken({ iss: 'https://securetoken.google.com/otro-proyecto' })],
    ['correo no verificado', mintIdToken({ email_verified: false })],
    ['sin sujeto', mintIdToken({ sub: '' })],
    ['cuenta no administradora', mintIdToken({ email: 'persona.cualquiera@example.com', sub: 'uid-x' })],
  ];
  // Tampering with the payload of a valid token breaks the signature.
  const valid = mintIdToken();
  const [h, , s] = valid.split('.');
  cases.push(['payload alterado', `${h}.${b64url(JSON.stringify({ email: ADMIN_EMAIL, aud: PROJECT_ID, iss: `https://securetoken.google.com/${PROJECT_ID}`, sub: 'x', iat: now, exp: now + 3600, email_verified: true }))}.${s}`]);
  for (const [label, token] of cases) {
    const res = await http('GET', '/admin/book-audits', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 401, label);
    const session = await http('POST', '/auth/admin-session', { headers: { Authorization: `Bearer ${token}` } });
    assert.ok([401, 403].includes(session.status), `${label}: sesión ${session.status}`);
    assert.equal(session.headers.get('set-cookie'), null, `${label}: no se emite cookie`);
  }
});

test('V5.3.1-A3: un token válido de un administrador autoriza las rutas administrativas (nuevas y preexistentes)', async () => {
  const auth = { Authorization: `Bearer ${mintIdToken()}` };
  const list = await http('GET', '/admin/book-audits', { headers: auth });
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.json.data));
  const logs = await http('GET', '/audit-logs', { headers: auth });
  assert.equal(logs.status, 200);
  const check = await http('GET', '/auth/admin-check', { headers: auth });
  assert.equal(check.json.data.isAdmin, true);
  // Every route under an /admin path is protected by requireAdmin (runtime router inspection).
  const unprotected: string[] = [];
  for (const layer of api.apiRouter.stack) {
    const route = layer.route;
    if (!route || typeof route.path !== 'string') continue;
    if (!/(^|\/)admin(\/|$)/.test(route.path) || route.path.startsWith('/participant/')) continue;
    if (!route.stack.some((s: any) => s.handle === api.requireAdmin)) unprotected.push(route.path);
  }
  assert.deepEqual(unprotected, [], 'Rutas administrativas sin requireAdmin');
});

test('V5.3.1-A4: la cookie de sesión solo se obtiene con un token verificado, es HttpOnly, sirve para descargas (GET) y nunca para modificar (POST)', async () => {
  const { interview, token, manuscript } = await generateBookWithObservations();
  const saved = await saveViaHttp(token, 'first_person_simple', manuscript);
  assert.equal(saved.status, 200, saved.text.slice(0, 300));
  const versionId = saved.json.data.bookVersion.id;
  void interview;

  const session = await http('POST', '/auth/admin-session', { headers: { Authorization: `Bearer ${mintIdToken()}` } });
  assert.equal(session.status, 200);
  const setCookie = session.headers.get('set-cookie') || '';
  assert.match(setCookie, /^yf_admin_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Path=\/api/);
  const cookie = setCookie.split(';')[0];

  const viaCookie = await http('GET', `/admin/book-versions/${versionId}/audit`, { headers: { Cookie: cookie } });
  assert.equal(viaCookie.status, 200);
  assert.equal(viaCookie.json.data.identification.versionId, versionId);
  const exportViaCookie = await http('GET', `/admin/book-versions/${versionId}/audit/export`, { headers: { Cookie: cookie } });
  assert.equal(exportViaCookie.status, 200);
  assert.match(exportViaCookie.headers.get('content-disposition') || '', /attachment/);

  // CSRF: the cookie alone never authorizes a state-changing request.
  const postViaCookie = await http('POST', `/admin/book-versions/${versionId}/audit/notes`, { headers: { Cookie: cookie }, body: { note: 'intento' } });
  assert.equal(postViaCookie.status, 401);
  // With the verified token it does.
  const postWithToken = await http('POST', `/admin/book-versions/${versionId}/audit/notes`, {
    headers: { Authorization: `Bearer ${mintIdToken()}` },
    body: { note: 'Nota con identidad verificada' },
  });
  assert.equal(postWithToken.status, 200, postWithToken.text.slice(0, 200));
  assert.equal(postWithToken.json.data.adminNotes.at(-1).by, ADMIN_EMAIL, 'La autoría es la identidad verificada.');

  // A tampered or foreign cookie is rejected.
  const [name, value] = cookie.split('=');
  const [body, mac] = decodeURIComponent(value).split('.');
  const forgedBody = b64url(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64').toString()), email: ADMIN_EMAIL, exp: 4102444800 }));
  for (const bad of [`${name}=${encodeURIComponent(`${forgedBody}.${mac}`)}`, `${name}=abc.def`, `${name}=${encodeURIComponent(ADMIN_EMAIL)}`]) {
    const res = await http('GET', `/admin/book-versions/${versionId}/audit`, { headers: { Cookie: bad } });
    assert.equal(res.status, 401, bad.slice(0, 40));
  }
  // Logout clears it.
  const out = await http('DELETE', '/auth/admin-session');
  assert.match(out.headers.get('set-cookie') || '', /Max-Age=0/);
});

// =============================================================================================
// 2. CONFIDENCIALIDAD (respuestas HTTP reales de las rutas de participante)
// =============================================================================================

test('V5.3.1-C1: ninguna ruta de participante devuelve cobertura, colores, contradicciones, diagnósticos ni auditoría; el administrador conserva todo', async () => {
  const style: StyleId = 'first_person_simple';
  const { interview, token, response, manuscript } = await generateBookWithObservations(style);
  assertNoAdminData('POST /participant/book/generate-manuscript', response.json);

  const saved = await saveViaHttp(token, style, manuscript);
  assert.equal(saved.status, 200, saved.text.slice(0, 300));
  assertNoAdminData('POST /participant/book/save-version', saved.json);
  const versionId = saved.json.data.bookVersion.id;

  const job = await http('POST', '/participant/book/jobs/start', { body: { token, narrativeStyle: style, scope: 'full' } });
  assertNoAdminData('POST /participant/book/jobs/start', job.json);
  const status = await http('GET', `/participant/book/jobs/status?token=${encodeURIComponent(token)}&narrativeStyle=${style}&scope=full`);
  assert.equal(status.status, 200);
  assertNoAdminData('GET /participant/book/jobs/status', status.json);

  const session = await http('POST', '/participant/session', { body: { token } });
  assert.equal(session.status, 200, session.text.slice(0, 200));
  assert.ok(session.json.data.bookVersions.some((v: any) => v.id === versionId));
  assertNoAdminData('POST /participant/session', session.json);

  // The defect reported in /participant/admin/profile.
  const profile = await http('POST', '/participant/admin/profile', { body: { token } });
  assert.equal(profile.status, 200, profile.text.slice(0, 200));
  assertNoAdminData('POST /participant/admin/profile', profile.json);
  const logs = profile.json.data.auditLogs;
  assert.ok(logs.some((l: any) => l.action === 'CREATE_PARTICIPANT_BOOK'), 'El participante sigue viendo sus eventos.');
  for (const log of logs) {
    assert.deepEqual(Object.keys(log).sort(), ['action', 'id', 'targetId', 'targetType', 'timestamp']);
  }
  assert.ok(!profile.text.includes(ADMIN_EMAIL), 'Tampoco se exponen identidades administrativas.');

  // Administrators still have the complete data.
  const auth = { Authorization: `Bearer ${mintIdToken()}` };
  const adminLogs = await http('GET', '/audit-logs', { headers: auth });
  const createLog = adminLogs.json.data.find((l: any) => l.action === 'CREATE_PARTICIPANT_BOOK' && l.targetId === versionId);
  assert.ok(createLog, 'Registro completo para el administrador.');
  assert.equal(typeof createLog.details.coverageExactPercent, 'number');
  assert.equal(createLog.details.coverageBand, saved.json.data.bookVersion.auditSummary?.band ?? createLog.details.coverageBand);
  assert.ok(createLog.details.deliveryStatus);
  const report = await http('GET', `/admin/book-versions/${versionId}/audit`, { headers: auth });
  assert.equal(report.status, 200);
  assert.ok(report.json.data.coverage.contradictions >= 1);
  assert.ok(report.json.data.incidents.some((i: any) => i.kind === 'contradiction'));
  void interview;
});

// =============================================================================================
// 3. PERSISTENCIA DURADERA
// =============================================================================================

function persistedVersionIdsAfterRestart(interviewId: string): string[] {
  const reloaded = new mod.StorageManager({ remoteDocStore: fakeRemoteStore });
  reloaded['loadStateFromDisk']();
  return reloaded.getBookVersionsForInterview(interviewId, false).map((v: any) => v.id);
}

test('V5.3.1-P1: la arquitectura real (Cloud Run) no se considera duradera en disco; solo una declaración explícita fuera de Cloud Run lo es', () => {
  assert.deepEqual(durable.resolveLocalDiskDurability({ K_SERVICE: 'youforever' }), { durable: false, reason: 'cloud_run_ephemeral_filesystem' });
  assert.equal(durable.resolveLocalDiskDurability({ K_SERVICE: 'x', YOUFOREVER_LOCAL_DISK_DURABLE: 'true' }).durable, false);
  assert.equal(durable.resolveLocalDiskDurability({ YOUFOREVER_LOCAL_DISK_DURABLE: 'true' }).durable, true);
  assert.equal(durable.resolveLocalDiskDurability({}).durable, false);
  assert.equal(storage.getPersistenceStatus().durable, false, 'Por defecto (producción) el disco local es efímero.');
});

test('V5.3.1-P2: si Firestore falla, el guardado se rechaza sin versión, sin cuota y sin informe; al recuperarse, el reintento guarda de forma duradera', async () => {
  const style: StyleId = 'first_person_simple';
  const { interview, token, manuscript } = await generateBookWithObservations(style);
  const before = { ...storage.getInterviewById(interview.id) };
  remoteFailures.all = true;
  const failed = await saveViaHttp(token, style, manuscript);
  resetRemoteFailures();
  assert.equal(failed.status, 400);
  assert.match(failed.json.error, /No pudimos guardar tu libro de forma segura/);
  assertNoAdminData('Error de guardado', failed.json);
  assert.deepEqual(storage.getBookVersionsForInterview(interview.id, false), []);
  assert.deepEqual(persistedVersionIdsAfterRestart(interview.id), [], 'Tampoco queda en el snapshot local.');
  const afterFail = storage.getInterviewById(interview.id);
  assert.equal(afterFail.bookGeneratedCount ?? 0, before.bookGeneratedCount ?? 0, 'Sin cuota consumida.');
  assert.equal(afterFail.layoutEditsUsed ?? 0, before.layoutEditsUsed ?? 0);
  assert.equal(remoteCollection('participantBookVersions').filter((d: any) => d.interviewId === interview.id).length, 0);
  const log = storage.getAuditLogs(50).find((l: any) => l.action === 'SAVE_BOOK_VERSION_NOT_DURABLE' && l.targetId === interview.id);
  assert.ok(log);
  assert.equal(log.details.localDisk, 'not_declared_durable');

  // Firestore is back: the same manuscript saves, durably, with its report inside the version doc.
  const ok = await saveViaHttp(token, style, manuscript);
  assert.equal(ok.status, 200, ok.text.slice(0, 300));
  const versionId = ok.json.data.bookVersion.id;
  const report = await storage.getBookAuditReport(versionId);
  assert.equal(report.durability.durable, true);
  assert.equal(report.durability.remoteStatus, 'written');
  const remoteVersion = remoteDocs.get(`participantBookVersions/${versionId}`) as any;
  assert.ok(remoteVersion, 'La versión está en Firestore.');
  assert.equal(remoteVersion.adminAuditReport.identification.versionId, versionId, 'Con su informe dentro.');
  assert.equal((remoteDocs.get(`interviews/${interview.id}`) as any).bookGeneratedCount, 1, 'Y la cuota también.');
});

test('V5.3.1-P3: si la versión se escribe pero la cuota no, se deshace también la copia remota (nada queda a medias)', async () => {
  const style: StyleId = 'first_person_simple';
  const { interview, token, manuscript } = await generateBookWithObservations(style);
  remoteFailures.collections.add('interviews');
  const failed = await saveViaHttp(token, style, manuscript);
  resetRemoteFailures();
  assert.equal(failed.status, 400);
  assert.equal(remoteCollection('participantBookVersions').filter((d: any) => d.interviewId === interview.id).length, 0, 'La versión remota se eliminó.');
  assert.deepEqual(storage.getBookVersionsForInterview(interview.id, false), []);
  const log = storage.getAuditLogs(50).find((l: any) => l.action === 'SAVE_BOOK_VERSION_NOT_DURABLE' && l.targetId === interview.id);
  assert.equal(log.details.versionRemote, 'written');
  assert.equal(log.details.interviewRemote, 'failed');
  assert.equal(log.details.remoteVersionRollback, 'done', 'La versión remota se eliminó.');
  // Firestore kept refusing the interview, so its remote counters were never changed.
  assert.equal(log.details.remoteInterviewRestore, 'failed');
  assert.equal(remoteDocs.has(`interviews/${interview.id}`) ? (remoteDocs.get(`interviews/${interview.id}`) as any).bookGeneratedCount ?? 0 : 0, 0);
});

test('V5.3.1-P4: con un disco local declarado persistente, un fallo de Firestore no pierde el libro y queda registrado como "solo local"', async () => {
  const style: StyleId = 'first_person_simple';
  const { interview, token, manuscript } = await generateBookWithObservations(style);
  storage.configureTestDoubles({ localDiskDurable: true });
  try {
    remoteFailures.all = true;
    const res = await saveViaHttp(token, style, manuscript);
    resetRemoteFailures();
    assert.equal(res.status, 200, res.text.slice(0, 200));
    const report = await storage.getBookAuditReport(res.json.data.bookVersion.id);
    assert.equal(report.durability.remoteStatus, 'local_only');
    assert.equal(report.durability.localDisk, 'test_override');
    assert.ok(persistedVersionIdsAfterRestart(interview.id).includes(res.json.data.bookVersion.id));
  } finally {
    resetRemoteFailures();
    storage.configureTestDoubles({ localDiskDurable: false });
  }
});

test('V5.3.1-P5: un cambio administrativo que no puede guardarse de forma duradera no se aplica', async () => {
  const style: StyleId = 'first_person_simple';
  const { token, manuscript } = await generateBookWithObservations(style);
  const saved = await saveViaHttp(token, style, manuscript);
  const versionId = saved.json.data.bookVersion.id;
  const before = await storage.getBookAuditReport(versionId);
  const notesBefore = before.adminNotes.length;
  const historyBefore = before.history.length;
  remoteFailures.all = true;
  const res = await http('POST', `/admin/book-versions/${versionId}/audit/notes`, {
    headers: { Authorization: `Bearer ${mintIdToken()}` },
    body: { note: 'No debería aplicarse' },
  });
  resetRemoteFailures();
  assert.equal(res.status, 400);
  assert.match(res.json.error, /de forma duradera/);
  const afterReport = await storage.getBookAuditReport(versionId);
  assert.equal(afterReport.adminNotes.length, notesBefore);
  assert.equal(afterReport.history.length, historyBefore);
  // And it works once Firestore is back.
  const ok = await http('POST', `/admin/book-versions/${versionId}/audit/notes`, {
    headers: { Authorization: `Bearer ${mintIdToken()}` },
    body: { note: 'Aplicada' },
  });
  assert.equal(ok.status, 200);
  assert.equal((remoteDocs.get(`participantBookVersions/${versionId}`) as any).adminAuditReport.adminNotes.at(-1).note, 'Aplicada');
});

test('V5.3.1-P6: un documento por encima de 800 KB se divide en fragmentos (nunca se omite) y se recupera íntegro tras un reinicio sin disco', async () => {
  const style: StyleId = 'first_person_simple';
  const { interview, token, manuscript } = await generateBookWithObservations(style);
  const saved = await saveViaHttp(token, style, manuscript);
  const versionId = saved.json.data.bookVersion.id;
  // An administrator documents the case extensively: the version document (which embeds the
  // report) grows past the preventive 800 KB limit.
  const longNote = 'Revisión detallada del capítulo con la familia. '.repeat(80).slice(0, 3900);
  for (let i = 0; i < 230; i++) {
    await storage.addBookAuditNote({ versionId, note: `${i}: ${longNote}`, performedBy: 'admin_pruebas' });
  }
  const chunks = remoteCollection('participantBookVersions').filter((d: any) => d._chunkOf === versionId);
  const manifest = remoteDocs.get(`participantBookVersions/${versionId}`) as any;
  assert.equal(manifest._chunked, true, 'Se escribió un manifiesto.');
  assert.ok(manifest._bytes > 800_000, `Tamaño ${manifest._bytes}`);
  assert.equal(chunks.length, manifest._chunkCount);
  assert.ok(chunks.length >= 2);
  for (const c of chunks) {
    assert.ok(Buffer.byteLength(JSON.stringify(c), 'utf8') < 800_000, 'Cada fragmento respeta el límite.');
    assert.equal(c.interviewId, interview.id, 'Los fragmentos cumplen las reglas de la colección.');
  }
  const report = await storage.getBookAuditReport(versionId);
  assert.equal(report.durability.remoteStatus, 'written');

  // Cloud Run restart: new instance, empty disk, only Firestore.
  fs.rmSync(path.join(ISOLATED_ROOT, 'data', 'storage_state.json'), { force: true });
  const fresh = new mod.StorageManager({ remoteDocStore: fakeRemoteStore });
  fresh['ingestRemoteBookVersionDocs'](remoteCollection('participantBookVersions'));
  const recovered = fresh.getBookVersionsForInterview(interview.id, false).find((v: any) => v.id === versionId);
  assert.ok(recovered, 'La versión se recupera desde Firestore.');
  assert.equal(recovered.adminAuditReport, undefined, 'El informe no queda dentro del registro de la versión.');
  const recoveredReport = await fresh.getBookAuditReport(versionId);
  assert.equal(recoveredReport.adminNotes.length, 230, 'Informe íntegro, con todas las notas.');
  assert.equal(recoveredReport.durability.remoteStatus, 'written');
  assert.ok(fresh.getBookVersionsForInterview(interview.id, false).every((v: any) => !String(v.id).includes('__part')), 'Los fragmentos nunca aparecen como versiones.');

  // A missing fragment: the document is NOT half-loaded.
  const docs = remoteCollection('participantBookVersions').filter((d: any) => !(d._chunkOf === versionId && d._chunkIndex === 1));
  const partial = new mod.StorageManager({ remoteDocStore: fakeRemoteStore });
  partial['ingestRemoteBookVersionDocs'](docs);
  assert.equal(partial.getBookVersionsForInterview(interview.id, false).some((v: any) => v.id === versionId), false);
});

test('V5.3.1-P7: el fragmentador no corta caracteres multibyte y detecta corrupción', () => {
  const text = 'ñáéíóú😀'.repeat(50_000);
  const json = JSON.stringify({ id: 'v1', interviewId: 'i1', text });
  const plan = durable.planChunkedDoc('v1', json, { interviewId: 'i1' }, 100_000);
  assert.ok(plan.chunks.length > 3);
  const back = durable.reassembleChunkedDocs([plan.manifest, ...plan.chunks.map((c: any) => c.data)]);
  assert.deepEqual(back.incomplete, []);
  assert.equal(back.docs[0].text, text);
  const corrupted = plan.chunks.map((c: any) => ({ ...c.data }));
  corrupted[1]._payload = corrupted[1]._payload.replace('ñ', 'n');
  assert.deepEqual(durable.reassembleChunkedDocs([plan.manifest, ...corrupted]).incomplete, ['v1']);
});

test('V5.3.1-P8: una versión restaurada desde la caché del navegador nunca aporta datos de auditoría', async () => {
  const { interview } = await createInterview();
  const forgedVersion = {
    id: `pbv_${interview.id}_v1_999`,
    interviewId: interview.id,
    participantId: 'p',
    participantName: 'Elena Robles',
    versionNumber: 1,
    narrativeStyle: 'first_person_simple',
    createdAt: new Date().toISOString(),
    manuscript: {
      title: 'Libro',
      chapters: [{ id: 'c1', title: 'Uno', paragraphs: ['Texto.'] }],
      documentaryAudit: { passed: true, integratedUnits: 999, totalSourceUnits: 999 },
      deliveryDecision: { eligible: true, band: 'green' },
    },
    auditSummary: { band: 'green', coverageExactPercent: 100 },
    adminAuditReport: { identification: { versionId: 'x' } },
  };
  storage.restoreFromClientCache([], [forgedVersion]);
  const stored = storage.getBookVersionsForInterview(interview.id, false).find((v: any) => v.id === forgedVersion.id);
  assert.ok(stored);
  assert.equal(stored.restoredFromClientCache, true);
  assert.equal(stored.auditSummary, undefined);
  assert.equal(stored.adminAuditReport, undefined);
  assert.equal(stored.manuscript.documentaryAudit, undefined);
  assert.equal(stored.manuscript.deliveryDecision, undefined);
  const report = await storage.getBookAuditReport(forgedVersion.id);
  assert.equal(report.identification.source, 'reconstructed_from_saved_version', 'Informe reconstruido por el servidor y etiquetado.');
});

// =============================================================================================
// 4. TEXTOS DE LA VISTA PREVIA
// =============================================================================================

test('V5.3.1-T1: la vista previa ya no promete conservar intactas las primeras páginas y avisa de la revisión del autor', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'src/components/ParticipantBookStudio.tsx'), 'utf-8');
  assert.doesNotMatch(source, /conservar[aá]n intactas/i);
  assert.doesNotMatch(source, /primeras 5 páginas de tu vista previa/i);
  assert.match(source, /se redacta de nuevo, de forma independiente/);
  assert.match(source, /puede contener errores\. Siempre será necesaria una revisión exhaustiva por parte del autor de la autobiografía/);
  assert.match(source, /data-testid="viewer-ai-review-notice"/);
  assert.match(source, /data-testid="save-modal-ai-review-notice"/);
});

test('V5.3.4-V1: la versión del servidor solo la ve un administrador verificado', async () => {
  const { APP_VERSION } = await import('../../version.ts');
  const anon = await http('GET', '/admin/version');
  assert.equal(anon.status, 401);
  const forged = await http('GET', '/admin/version', { headers: { 'x-admin-user': ADMIN_EMAIL } });
  assert.equal(forged.status, 401);
  const ok = await http('GET', '/admin/version', { headers: { Authorization: `Bearer ${mintIdToken()}` } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.version, APP_VERSION);
  assert.equal(ok.json.data.label, `V${APP_VERSION}`);
  assert.ok(!Number.isNaN(Date.parse(ok.json.data.serverStartedAt)));
});

// =============================================================================================
// V5.3.6 — Light participant session, books loaded on demand, and answer autosave.
// =============================================================================================

test('V5.3.6-S1: la sesión del participante lista sus versiones SIN el texto del libro; el libro se carga al abrirlo y solo para su dueño', async () => {
  const { interview, token, manuscript } = await generateBookWithObservations();
  const saved = await saveViaHttp(token, 'first_person_simple', manuscript);
  assert.equal(saved.status, 200, saved.text.slice(0, 300));
  const versionId = saved.json.data.bookVersion.id;

  const session = await http('POST', '/participant/session', { body: { token } });
  assert.equal(session.status, 200, session.text.slice(0, 300));
  const listed = session.json.data.bookVersions.find((v: any) => v.id === versionId);
  assert.ok(listed, 'La versión aparece en la lista.');
  assert.equal(listed.manuscript, undefined, 'La lista no incluye el libro.');
  assert.equal(listed.chapterPhotos, undefined);
  assert.equal(listed.contentOmitted, true);
  assert.ok(listed.versionNumber >= 1 && listed.editorialConfig);
  assertNoAdminData('session', session.json);

  const full = await http('POST', '/participant/book/version', { body: { token, versionId } });
  assert.equal(full.status, 200, full.text.slice(0, 300));
  assert.ok(full.json.data.bookVersion.manuscript.chapters.length > 0, 'El libro completo llega al abrirlo.');
  assertNoAdminData('version', full.json);

  // Another participant cannot open it; and an unknown id is not found.
  const other = await createInterview();
  const foreign = await http('POST', '/participant/book/version', { body: { token: other.token, versionId } });
  assert.equal(foreign.status, 404);
  const anon = await http('POST', '/participant/book/version', { body: { token: 'YF-NOEXISTE', versionId } });
  assert.equal(anon.status, 403);
  void interview;
});

test('V5.3.6-S2: el inicio de sesión ya no sube la copia local del navegador, pero sí sincroniza con Firestore', () => {
  const apiSource = fs.readFileSync(path.join(REPO_ROOT, 'src/server/api.ts'), 'utf-8');
  const block = apiSource.split(/\napiRouter\./).find((b) => b.includes("'/participant/session'")) || '';
  assert.doesNotMatch(block, /restoreFromClientCache/);
  assert.match(block, /syncFromFirestore/);
  const portal = fs.readFileSync(path.join(REPO_ROOT, 'src/components/ParticipantPortal.tsx'), 'utf-8');
  assert.doesNotMatch(portal, /cachedInterviews|cachedBookVersions/);
});

test('V5.3.6-A1: el autoguardado no cuenta la respuesta ni genera profundización hasta que el participante la confirma', async () => {
  const created = await storage.createInterview({
    title: 'Autoguardado V5.3.6',
    storyMode: 'individual',
    storyType: 'biografia_personal',
    participants: [{ name: 'Elena Robles', relationship: 'Titular', role: 'primary' }],
    customSufficiencyThreshold: 100000,
    performedBy: 'admin_pruebas',
  });
  const token = created.participantTokens[0].plainToken;
  const interviewId = created.interview.id;
  const q = storage.getQuestionsForVersion(created.interview.questionnaireVersionId)[0];
  const count = () => storage.getInterviewById(interviewId).completedQuestionCount;
  const before = count();
  assert.ok(created.interview.maxFollowUpsAtCreation > 0, 'Entrevista con profundizaciones activas.');
  const callsBefore = externalCalls.length;

  const first = await storage.submitAnswer({ plainToken: token, questionId: q.id, answerText: 'Nací en una casa junto al', notRecalled: false, autosave: true, idempotencyKey: 'as_1' });
  assert.equal(first.answer.pendingSubmission, true);
  assert.equal(first.adaptiveQuestion, undefined);
  assert.equal(count(), before, 'Un autoguardado no cuenta como respuesta.');

  const second = await storage.submitAnswer({ plainToken: token, questionId: q.id, answerText: 'Nací en una casa junto al mar, en Acapulco.', notRecalled: false, autosave: true, idempotencyKey: 'as_2' });
  assert.equal(second.answer.id, first.answer.id, 'Los autoguardados actualizan la misma respuesta.');
  assert.equal(count(), before);
  assert.equal((second.answer.editHistory || []).length, 0, 'Autoguardados seguidos no llenan el historial.');
  assert.equal(externalCalls.length, callsBefore, 'Un autoguardado nunca pide una pregunta de profundización.');

  const confirmed = await storage.submitAnswer({ plainToken: token, questionId: q.id, answerText: 'Nací en una casa junto al mar, en Acapulco.', notRecalled: false, idempotencyKey: 'confirm_1' });
  assert.equal(confirmed.answer.id, first.answer.id);
  assert.equal(confirmed.answer.pendingSubmission, undefined);
  assert.equal(confirmed.counterIncremented, true);
  assert.equal(count(), before + 1, 'Al confirmar («Guardar y Continuar») cuenta una sola vez.');
  // Confirming DOES ask for the follow-up question (the network stub refused the provider call, so
  // no question comes back here). Those refused calls are expected and removed from the guard list.
  assert.ok(externalCalls.length > callsBefore, 'Al confirmar se solicita la pregunta de profundización.');
  externalCalls.splice(callsBefore);

  // Later autosaved edits of a confirmed answer never count again and keep one history entry.
  await storage.submitAnswer({ plainToken: token, questionId: q.id, answerText: 'Nací en una casa blanca junto al mar.', notRecalled: false, autosave: true, idempotencyKey: 'as_3' });
  const edited = await storage.submitAnswer({ plainToken: token, questionId: q.id, answerText: 'Nací en una casa blanca junto al mar, en Acapulco.', notRecalled: false, autosave: true, idempotencyKey: 'as_4' });
  assert.equal(count(), before + 1);
  assert.equal((edited.answer.editHistory || []).length, 1);
  assert.equal(edited.answer.answerText, 'Nací en una casa blanca junto al mar, en Acapulco.');

  // Follow-up answers are edited the same way (their own id, flag preserved).
  const fu = await storage.submitAnswer({ plainToken: token, questionId: `adapt_${q.id}_1`, questionText: '¿Cómo era el mar?', answerText: 'Azul.', notRecalled: false, isFollowUp: true, parentQuestionId: q.id, idempotencyKey: 'fu_1' });
  const fuEdit = await storage.submitAnswer({ plainToken: token, questionId: `adapt_${q.id}_1`, answerText: 'Azul y tranquilo por las mañanas.', notRecalled: false, autosave: true, idempotencyKey: 'fu_as_1' });
  assert.equal(fuEdit.answer.id, fu.answer.id);
  assert.equal(fuEdit.answer.isFollowUp, true);
  assert.equal(fuEdit.answer.answerText, 'Azul y tranquilo por las mañanas.');
  const base = storage.getAnswersForInterview(interviewId).find((a: any) => a.id === first.answer.id);
  assert.equal(base.answerText, 'Nací en una casa blanca junto al mar, en Acapulco.', 'Editar una profundización no toca la respuesta principal.');
  // The new follow-up above is a first submission too (it asked for the next follow-up; refused by the stub).
  externalCalls.splice(callsBefore);
});

// =============================================================================================
// V5.4.1 — Administrador: borrar TODAS las versiones PDF y TODOS los manuscritos de un entrevistado.
// =============================================================================================

async function saveDistinctViaHttp(token: string, manuscript: any, bookFormatId: string) {
  return http('POST', '/participant/book/save-version', {
    body: {
      token,
      narrativeStyle: 'first_person_simple',
      editorialConfig: { ...editorialConfigFor('first_person_simple'), bookFormatId },
      manuscript,
      coverPhoto: null,
      chapterPhotos: {},
      pageCount: 20,
    },
  });
}

test('V5.4.1-D1: borrar todas las versiones PDF es solo para administradores, es definitivo y no revive en otra instancia', async () => {
  const { interview, token, manuscript } = await generateBookWithObservations();
  storage.getInterviewById(interview.id).layoutEditsAllowed = 10;
  const v1 = await saveDistinctViaHttp(token, manuscript, '6x9');
  assert.equal(v1.status, 200, v1.text.slice(0, 300));
  const v2 = await saveDistinctViaHttp(token, manuscript, 'a5');
  assert.equal(v2.status, 200, v2.text.slice(0, 300));
  const savedIds = [v1.json.data.bookVersion.id, v2.json.data.bookVersion.id];

  // Two manuscripts of the same interviewee (they must survive the PDF bulk delete).
  for (const n of [1, 2]) {
    const m = { id: `manu_${interview.id}_v${n}`, interviewId: interview.id, version: n, title: `Manuscrito ${n}`, content: `# Manuscrito ${n}`, status: 'draft', generatedAt: new Date().toISOString(), generatedBy: 'admin_pruebas' };
    storage['manuscripts'].set(m.id, m);
    await storage['persistDoc']('manuscripts', m.id, m);
  }
  // A stale admin browser copy taken BEFORE the delete.
  const staleVersions = JSON.parse(JSON.stringify(storage.getBookVersionsForInterview(interview.id, false)));
  assert.equal(staleVersions.length, 2);

  const anon = await http('DELETE', `/interviews/${interview.id}/book-versions`);
  assert.equal(anon.status, 401);
  const forged = await http('DELETE', `/interviews/${interview.id}/book-versions`, { headers: { 'x-admin-user': ADMIN_EMAIL } });
  assert.equal(forged.status, 401);
  assert.equal(storage.getBookVersionsForInterview(interview.id, false).length, 2, 'Sin autorización no se borra nada.');

  const res = await http('DELETE', `/interviews/${interview.id}/book-versions`, { headers: { Authorization: `Bearer ${mintIdToken()}` } });
  assert.equal(res.status, 200, res.text.slice(0, 300));
  assert.equal(res.json.data.deletedCount, 2);
  assert.deepEqual([...res.json.data.deletedVersionIds].sort(), [...savedIds].sort());
  assert.equal(storage.getBookVersionsForInterview(interview.id).length, 0, 'No queda ninguna versión (ni sintetizada desde los manuscritos).');
  for (const id of savedIds) assert.equal(remoteDocs.has(`participantBookVersions/${id}`), false, 'También se borró de Firestore.');
  assert.equal(storage.getManuscriptsForInterview(interview.id).length, 2, 'Los manuscritos no se tocan.');
  const remoteInterview = remoteDocs.get(`interviews/${interview.id}`) as any;
  assert.equal(remoteInterview.bookGeneratedCount, 0);
  assert.ok(remoteInterview.bookVersionsClearedUpTo >= 2);

  // Another instance (no in-memory deleted registry): Firestore + a stale admin browser copy +
  // remaining manuscripts must not bring any version back.
  const fresh = new mod.StorageManager({ remoteDocStore: fakeRemoteStore });
  fresh['interviews'].set(interview.id, JSON.parse(JSON.stringify(remoteInterview)));
  for (const n of [1, 2]) {
    const m = remoteDocs.get(`manuscripts/manu_${interview.id}_v${n}`) as any;
    fresh['manuscripts'].set(m.id, m);
  }
  fresh['ingestRemoteBookVersionDocs'](remoteCollection('participantBookVersions'));
  fresh.restoreFromClientCache([], staleVersions);
  assert.equal(fresh.getBookVersionsForInterview(interview.id).length, 0, 'Nada revive en otra instancia.');

  // The participant only sees later books, numbered above the deleted ones.
  const v3 = await saveDistinctViaHttp(token, manuscript, 'carta');
  assert.equal(v3.status, 200, v3.text.slice(0, 300));
  assert.ok(v3.json.data.bookVersion.versionNumber > 2, 'La numeración continúa.');
  const visible = storage.getBookVersionsForInterview(interview.id).map((v: any) => v.id);
  assert.deepEqual(visible, [v3.json.data.bookVersion.id], 'El nuevo libro sí se ve.');

  const logs = storage.getAuditLogs ? storage.getAuditLogs() : Array.from(storage['auditLogs']?.values?.() || storage['auditLogs'] || []);
  assert.ok(JSON.stringify(logs).includes('DELETE_ALL_PARTICIPANT_BOOK_VERSIONS'), 'Queda en la bitácora.');
});

test('V5.4.1-D2: borrar todos los manuscritos es solo para administradores y no toca las versiones PDF', async () => {
  const { interview, token, manuscript } = await generateBookWithObservations();
  const saved = await saveViaHttp(token, 'first_person_simple', manuscript);
  assert.equal(saved.status, 200, saved.text.slice(0, 300));
  for (const n of [1, 2, 3]) {
    const m = { id: `manu_${interview.id}_v${n}`, interviewId: interview.id, version: n, title: `Manuscrito ${n}`, content: `# Manuscrito ${n}`, status: 'draft', generatedAt: new Date().toISOString(), generatedBy: 'admin_pruebas' };
    storage['manuscripts'].set(m.id, m);
    await storage['persistDoc']('manuscripts', m.id, m);
  }
  const anon = await http('DELETE', `/interviews/${interview.id}/manuscripts`);
  assert.equal(anon.status, 401);
  assert.equal(storage.getManuscriptsForInterview(interview.id).length, 3);

  const res = await http('DELETE', `/interviews/${interview.id}/manuscripts`, { headers: { Authorization: `Bearer ${mintIdToken()}` } });
  assert.equal(res.status, 200, res.text.slice(0, 300));
  assert.equal(res.json.data.deletedCount, 3);
  assert.equal(storage.getManuscriptsForInterview(interview.id).length, 0);
  for (const n of [1, 2, 3]) assert.equal(remoteDocs.has(`manuscripts/manu_${interview.id}_v${n}`), false);
  assert.deepEqual(
    storage.getBookVersionsForInterview(interview.id).map((v: any) => v.id),
    [saved.json.data.bookVersion.id],
    'La versión PDF sigue intacta.'
  );
  const missing = await http('DELETE', `/interviews/no_existe/manuscripts`, { headers: { Authorization: `Bearer ${mintIdToken()}` } });
  assert.equal(missing.status, 400);
});

test('V5.4.1-D3: el panel ofrece ambos borrados por entrevistado y siempre pide confirmación', () => {
  const panel = fs.readFileSync(path.join(REPO_ROOT, 'src/components/InterviewsPanel.tsx'), 'utf-8');
  assert.match(panel, /bulk-delete-versions-\$\{inv\.id\}/);
  assert.match(panel, /bulk-delete-manuscripts-\$\{inv\.id\}/);
  // The buttons only open the confirmation; the DELETE request is sent from the confirm action.
  assert.match(panel, /onClick=\{\(\) =>\s*setBulkDeleteTarget\(/);
  assert.match(panel, /data-testid="bulk-delete-confirm"/);
  assert.match(panel, /onClick=\{handleConfirmBulkDelete\}/);
  const bulkFn = panel.slice(panel.indexOf('const handleConfirmBulkDelete'), panel.indexOf('const handleConfirmDeleteVersion'));
  assert.match(bulkFn, /method: 'DELETE'/);
});

test('V5.4.2-P1: la sesión del participante no incrusta las grabaciones en las respuestas (viajan como enlace protegido)', async () => {
  const created = await storage.createInterview({
    title: 'Audio en sesión V5.4.2',
    storyMode: 'individual',
    storyType: 'biografia_personal',
    participants: [{ name: 'Elena Robles', relationship: 'Titular', role: 'primary' }],
    customSufficiencyThreshold: 100000,
    performedBy: 'admin_pruebas',
  });
  created.interview.maxFollowUpsAtCreation = 0;
  const interview = created.interview;
  const token = created.participantTokens[0].plainToken;
  const q = storage.getQuestionsForVersion(interview.questionnaireVersionId)[0];
  const tinyAudio = Buffer.from('OggS-grabacion-corta-simulada-0123456789'.repeat(20)).toString('base64');
  await storage.submitAnswer({
    plainToken: token,
    questionId: q.id,
    answerText: 'Recuerdo de voz',
    notRecalled: false,
    audios: [{ audioBase64: tinyAudio, mimeType: 'audio/ogg', durationSeconds: 2, transcription: 'Recuerdo de voz' }],
    idempotencyKey: 'audio_p1',
  });
  const stored = storage.getAnswersForInterview(interview.id).find((a: any) => a.questionId === q.id);
  assert.ok(stored.audioRecordings?.[0]?.audioDataUrl, 'Precondición: la respuesta guarda el audio corto incrustado.');

  const session = await http('POST', '/participant/session', { body: { token } });
  assert.equal(session.status, 200, session.text.slice(0, 300));
  const ans = session.json.data.answers.find((a: any) => a.questionId === q.id);
  assert.ok(ans.audioRecordings[0].audioUrl, 'La grabación llega como enlace.');
  assert.doesNotMatch(JSON.stringify(session.json.data.answers), /audioDataUrl/, 'Sin audio incrustado en la sesión.');
});
