/**
 * V5.6.2 — Access hardening (#1 alternate credentials, #2 revocation, #5 anti-brute-force,
 * #7 test stories). Every legitimate way in keeps working; only the shortcuts are closed.
 *
 * Runs fully isolated: its own temporary working folder, no Firestore, no AI providers, and the
 * only network allowed is this test's own local HTTP server.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ISOLATED_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'yf_v562_access_'));

process.chdir(ISOLATED_ROOT);
process.env.YOUFOREVER_ALLOW_TEST_DOUBLES = '1';
process.env.GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';
process.env.YF_SEED_TEST_STORIES = '0';
delete process.env.YF_LEGACY_DERIVED_ACCESS_CODES;
// This test mounts the real API router, which reads Firestore while starting. Point every read at a
// fake project on a closed local port so that, even on a machine with real credentials, the test
// can never read or write the real database.
process.env.FIREBASE_PROJECT_ID = 'demo-youforever-tests';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:9';
process.env.FIRESTORE_SERVER_MODE = 'admin';

const originalFetch = globalThis.fetch;
const blockedNetworkCalls: string[] = [];
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url || input);
  if (url.startsWith('http://127.0.0.1:')) return originalFetch(input, init);
  blockedNetworkCalls.push(url);
  throw new Error('Red deshabilitada en las pruebas.');
}) as typeof fetch;

let rules: any;
let guard: any;
let seeds: any;
let storage: any;
let apiMod: any;
let server: http.Server;
let baseUrl = '';

const fakeRemoteStore = {
  async setDoc() {},
  async deleteDoc() {},
};

before(async () => {
  rules = await import(path.join(REPO_ROOT, 'src/logic/interviewRules.ts'));
  guard = await import(path.join(REPO_ROOT, 'src/server/accessGuard.ts'));
  seeds = await import(path.join(REPO_ROOT, 'src/server/seedStories.ts'));
  const mod = await import(path.join(REPO_ROOT, 'src/server/storage.ts'));
  storage = mod.storage;
  storage.configureTestDoubles({ remoteDocStore: fakeRemoteStore });
  await storage.ensureInitialized();

  apiMod = await import(path.join(REPO_ROOT, 'src/server/api.ts'));
  const express = (await import('express')).default;
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '5mb' }));
  app.use('/api', apiMod.apiRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as any;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  globalThis.fetch = originalFetch;
  assert.deepEqual(blockedNetworkCalls, [], 'Ninguna prueba puede llamar a servicios externos.');
  assert.equal(process.cwd(), ISOLATED_ROOT);
});

async function newInterview(title = 'Historia de prueba V5.6.2', participants = 1) {
  const created = await storage.createInterview({
    title,
    storyMode: participants > 1 ? 'compartida' : 'individual',
    storyType: 'biografia_personal',
    participants: Array.from({ length: participants }, (_, i) => ({
      name: `Persona ${i + 1}`,
      relationship: i === 0 ? 'Titular' : 'Familiar',
      role: i === 0 ? 'primary' : 'secondary',
    })),
    performedBy: 'admin_pruebas',
  });
  return created;
}

function tokenRecordFor(participantId: string) {
  return Array.from((storage as any).tokens.values()).find((t: any) => t.participantId === participantId) as any;
}

function expectRejected(input: string, label: string) {
  assert.throws(() => storage.resolveToken(input), /no es válido|no existe|revocada|vencido/, `${label} no debe dar acceso`);
}

// -----------------------------------------------------------------------------------------------
// #1 — Only real credentials
// -----------------------------------------------------------------------------------------------

test('#1 matchTokenRecord: acepta el código guardado en todas sus formas y el token real', () => {
  const { plainToken, tokenHash } = rules.generateInvitationToken();
  const tok = {
    id: 'tok_x',
    tokenHash,
    plainToken,
    accessCode: 'YF-8F4A2',
    legacyAccessCode: 'LEG-5319',
    interviewId: 'int_1794358990866_9f26t',
    participantId: 'part_1794358990866_0_xyz',
    expiresAt: new Date(Date.now() + 864e5).toISOString(),
    revoked: false,
    createdAt: new Date().toISOString(),
  };
  for (const input of [
    'YF-8F4A2',
    'yf-8f4a2',
    'YF8F4A2',
    'YF 8F4A2',
    '8F4A2',
    'Código: YF-8F4A2',
    '👉 YF-8F4A2',
    'https://youforever.app/interview?code=YF-8F4A2',
    'LEG-5319',
    'leg5319',
    plainToken,
    plainToken.toUpperCase(),
    `https://youforever.app/interview?token=${plainToken}`,
  ]) {
    assert.equal(rules.matchTokenRecord(input, [tok])?.id, 'tok_x', `debe aceptar: ${input}`);
  }
});

test('#1 matchTokenRecord: rechaza IDs, el hash y códigos calculados de un token con código propio', () => {
  const { plainToken, tokenHash } = rules.generateInvitationToken();
  const tok = {
    id: 'tok_x',
    tokenHash,
    plainToken,
    accessCode: 'YF-8F4A2',
    interviewId: 'int_1794358990866_9f26t',
    participantId: 'part_1794358990866_0_xyz',
    expiresAt: new Date(Date.now() + 864e5).toISOString(),
    revoked: false,
    createdAt: new Date().toISOString(),
  };
  const shortcuts: Record<string, string> = {
    interviewId: tok.interviewId,
    participantId: tok.participantId,
    tokenId: tok.id,
    tokenHash: tok.tokenHash,
    derivedYfFromParticipant: rules.deriveDeterministicAccessCode(tok.participantId),
    derivedYfFromHash: rules.deriveDeterministicAccessCode(tok.tokenHash),
    derivedLeg: rules.deriveLegacyLegAccessCode(tok.participantId),
  };
  for (const [label, input] of Object.entries(shortcuts)) {
    assert.equal(rules.matchTokenRecord(input, [tok], { allowLegacyDerivedCodes: false }), undefined, `no debe aceptar ${label}`);
  }
  // Emergency switch: derived codes come back, IDs and hash never do.
  assert.equal(rules.matchTokenRecord(shortcuts.derivedLeg, [tok], { allowLegacyDerivedCodes: true })?.id, 'tok_x');
  for (const label of ['interviewId', 'participantId', 'tokenId', 'tokenHash']) {
    assert.equal(rules.matchTokenRecord(shortcuts[label], [tok], { allowLegacyDerivedCodes: true }), undefined);
  }
});

test('#1 compatibilidad: un token antiguo SIN código guardado sigue entrando con el código que muestra el panel', () => {
  const { plainToken, tokenHash } = rules.generateInvitationToken();
  const legacy = {
    id: 'tok_legacy',
    tokenHash,
    plainToken,
    accessCode: '',
    interviewId: 'int_legacy',
    participantId: 'part_legacy_99',
    expiresAt: new Date(Date.now() + 864e5).toISOString(),
    revoked: false,
    createdAt: new Date().toISOString(),
  };
  const shown = rules.deriveDeterministicAccessCode('part_legacy_99');
  assert.equal(rules.matchTokenRecord(shown, [legacy])?.id, 'tok_legacy');
});

test('#1 StorageManager: los participantes entran igual; los atajos ya no', async () => {
  const created = await newInterview();
  const p = created.participantTokens[0];
  const tok = tokenRecordFor(p.participant.id);

  for (const input of [p.accessCode, p.accessCode.toLowerCase(), p.plainToken, `https://youforever.app/interview?token=${p.plainToken}`]) {
    assert.equal(storage.resolveToken(input).participant.id, p.participant.id);
  }
  expectRejected(created.interview.id, 'interviewId');
  expectRejected(p.participant.id, 'participantId');
  expectRejected(tok.id, 'token id');
  expectRejected(tok.tokenHash, 'hash guardado');
  expectRejected(rules.deriveDeterministicAccessCode(p.participant.id), 'código calculado');
  expectRejected(rules.deriveLegacyLegAccessCode(p.participant.id), 'código LEG calculado');

  // A photo-style ID (it embeds the interview id) is not a key either.
  expectRejected(`photo_${created.interview.id}_1794362952631_0_uxni`, 'id de foto');
});

test('#1 en una historia compartida, un familiar no puede entrar como otro con su participantId', async () => {
  const created = await newInterview('Historia compartida V5.6.2', 2);
  const [a, b] = created.participantTokens;
  const session = storage.resolveToken(a.accessCode);
  assert.equal(session.participant.id, a.participant.id);
  expectRejected(b.participant.id, 'participantId de otro familiar');
  assert.equal(storage.resolveToken(b.accessCode).participant.id, b.participant.id);
});

// -----------------------------------------------------------------------------------------------
// #2 — Revocation is final until an administrator reactivates
// -----------------------------------------------------------------------------------------------

test('#2 revocar bloquea todo acceso y la autorreparación ya no lo revive; reactivar lo devuelve', async () => {
  const created = await newInterview('Historia revocación V5.6.2');
  const p = created.participantTokens[0];
  const tok = tokenRecordFor(p.participant.id);

  await storage.revokeToken(tok.id, 'admin_pruebas');
  assert.throws(() => storage.resolveToken(p.accessCode), /revocada/);
  assert.throws(() => storage.resolveToken(p.plainToken), /revocada/);
  expectRejected(created.interview.id, 'interviewId tras revocar');
  expectRejected(p.participant.id, 'participantId tras revocar');
  // Several passes of self-repair (every request runs it) must not create a new active token.
  for (let i = 0; i < 3; i++) assert.throws(() => storage.resolveToken(p.accessCode), /revocada/);
  const active = Array.from((storage as any).tokens.values()).filter(
    (t: any) => t.participantId === p.participant.id && !t.revoked
  );
  assert.equal(active.length, 0, 'no debe existir ningún token activo tras revocar');
  assert.equal(storage.classifyAccessInput(p.accessCode).status, 'inactive');

  const panel = storage.getParticipantsForInterview(created.interview.id)[0];
  assert.equal(panel.accessRevoked, true);
  assert.equal(panel.accessCode, p.accessCode, 'el panel muestra el código revocado, no uno inventado');

  await storage.reactivateToken(tok.id, 'admin_pruebas');
  assert.equal(storage.resolveToken(p.accessCode).participant.id, p.participant.id, 'mismo código tras reactivar');
});

test('#2 la autorreparación sigue funcionando para un participante que se quedó sin token', async () => {
  const created = await newInterview('Historia autorreparación V5.6.2');
  const partId = created.participantTokens[0].participant.id;
  const tok = tokenRecordFor(partId);
  (storage as any).tokens.delete(tok.tokenHash); // e.g. its token document failed to load

  const shown = storage.getParticipantsForInterview(created.interview.id)[0].accessCode;
  assert.equal(storage.resolveToken(shown).participant.id, partId, 'el código que muestra el panel funciona');
});

// -----------------------------------------------------------------------------------------------
// #5 — Anti-brute-force limiter
// -----------------------------------------------------------------------------------------------

test('#5 limitador: bloquea tras 8 códigos inexistentes, sin borrar fallos al acertar', () => {
  let now = 1_000_000;
  const limiter = new guard.AccessAttemptLimiter({}, () => now);
  const ip = '203.0.113.7';
  for (let i = 0; i < 4; i++) limiter.recordFailure(ip);
  limiter.recordSuccess(ip, 'tok_attacker_own'); // an attacker's own valid code no longer resets
  for (let i = 0; i < 4; i++) limiter.recordFailure(ip);
  assert.equal(limiter.check(ip).blocked, true);
  assert.equal(limiter.check(ip, 'tok_brand_new').blocked, true, 'un código nuevo espera aunque sea correcto');
  assert.equal(limiter.check(ip, 'tok_attacker_own').blocked, false, 'una credencial ya usada aquí sigue entrando');
  assert.equal(limiter.check('198.51.100.9').blocked, false, 'otra dirección no se ve afectada');
  now += 15 * 60 * 1000 + 1;
  assert.equal(limiter.check(ip).blocked, false, 'el bloqueo termina a los 15 minutos');
});

test('#5 limitador: errores dispersos en el tiempo no bloquean a una persona real', () => {
  let now = 0;
  const limiter = new guard.AccessAttemptLimiter({}, () => now);
  for (let i = 0; i < 20; i++) {
    limiter.recordFailure('ip');
    now += 11 * 60 * 1000; // one typo every 11 minutes
  }
  assert.equal(limiter.check('ip').blocked, false);
});

test('#5 clave del cliente y saltos de proxy', () => {
  assert.equal(guard.resolveTrustProxyHops({}), 1);
  assert.equal(guard.resolveTrustProxyHops({ TRUST_PROXY_HOPS: '0' }), 0);
  assert.equal(guard.resolveTrustProxyHops({ TRUST_PROXY_HOPS: '2' }), 2);
  assert.equal(guard.clientKeyFromRequest({ ip: '1.2.3.4', headers: {} }), '1.2.3.4');
  assert.equal(
    guard.clientKeyFromRequest({ headers: { 'x-forwarded-for': '9.9.9.9, 5.6.7.8' } }),
    '5.6.7.8',
    'sin req.ip se usa la última entrada (la que agrega el proxy), no la que envía el cliente'
  );
});

test('#5 HTTP: adivinar por cualquier ruta cuenta; el participante legítimo no se ve afectado', async () => {
  const created = await newInterview('Historia HTTP V5.6.2');
  const legit = created.participantTokens[0];
  const attackerIp = '203.0.113.50';
  const familyIp = '198.51.100.20';

  const post = (route: string, body: any, ip: string) =>
    fetch(`${baseUrl}/api${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    });

  // The legitimate participant signs in from the family Wi-Fi.
  const ok = await post('/participant/session', { token: legit.accessCode }, familyIp);
  assert.equal(ok.status, 200);

  // Before V5.6.2 /participant/book/version accepted guesses without limit.
  for (let i = 0; i < 8; i++) {
    const r = await post('/participant/book/version', { token: `YF-ZZ${i}9Q` }, attackerIp);
    assert.notEqual(r.status, 200);
  }
  const blocked = await post('/participant/book/version', { token: 'YF-ZZZ9Q' }, attackerIp);
  assert.equal(blocked.status, 429, 'tras 8 intentos inexistentes la dirección queda bloqueada en todas las rutas');
  const blockedSession = await post('/participant/session', { token: legit.accessCode }, attackerIp);
  assert.equal(blockedSession.status, 429, 'ni siquiera un código correcto pasa desde la dirección bloqueada');

  // The family is on another address: unaffected.
  const stillOk = await post('/participant/session', { token: legit.accessCode }, familyIp);
  assert.equal(stillOk.status, 200);
});

test('#5 HTTP: un código vencido o revocado (persona real) nunca cuenta como intento', async () => {
  const created = await newInterview('Historia revocada HTTP V5.6.2');
  const p = created.participantTokens[0];
  await storage.revokeToken(tokenRecordFor(p.participant.id).id, 'admin_pruebas');
  const ip = '192.0.2.77';
  for (let i = 0; i < 12; i++) {
    const r = await fetch(`${baseUrl}/api/participant/book/version`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ token: p.accessCode }),
    });
    assert.notEqual(r.status, 429, `intento ${i + 1}: un código revocado no debe provocar bloqueo`);
  }
});

test('#5/#7 límite de regeneraciones forzadas: 15 por día por entrevista, sin error para el participante', () => {
  let now = 0;
  const limiter = new guard.ForcedRegenerationLimiter(() => 15, () => now);
  for (let i = 0; i < 15; i++) assert.equal(limiter.tryConsume('int_a'), true);
  assert.equal(limiter.tryConsume('int_a'), false, 'la 16.ª se atiende sin forzar');
  assert.equal(limiter.tryConsume('int_b'), true, 'otra entrevista no se ve afectada');
  now += 24 * 60 * 60 * 1000 + 1;
  assert.equal(limiter.tryConsume('int_a'), true, 'se renueva a las 24 h');
  assert.equal(guard.resolveForcedRegenerationDailyLimit({ BOOK_FORCE_REFRESH_DAILY_LIMIT: '0' }), 0);
  const unlimited = new guard.ForcedRegenerationLimiter(() => 0, () => now);
  for (let i = 0; i < 100; i++) assert.equal(unlimited.tryConsume('int_a'), true);
});

// -----------------------------------------------------------------------------------------------
// #7 — Test stories
// -----------------------------------------------------------------------------------------------

test('#7 sembrado automático: nunca en producción salvo que se pida', () => {
  assert.equal(seeds.shouldAutoSeedTestStories({}), true, 'desarrollo local');
  assert.equal(seeds.shouldAutoSeedTestStories({ NODE_ENV: 'production' }), false);
  assert.equal(seeds.shouldAutoSeedTestStories({ K_SERVICE: 'youforever' }), false, 'Cloud Run');
  assert.equal(seeds.shouldAutoSeedTestStories({ NODE_ENV: 'production', YF_SEED_TEST_STORIES: '1' }), true);
  assert.equal(seeds.shouldAutoSeedTestStories({ YF_SEED_TEST_STORIES: '0' }), false);
});

test('#7 historias de prueba: los códigos públicos dejan de funcionar y los nuevos sí', async () => {
  const stories = storage.seedCompleteTestStoriesInMemory();
  assert.ok(stories.length >= 7);
  for (const publicCode of ['SAN-7841', 'CAR-4923', 'ALE-3158', 'ROB-5021', 'ELE-5022', 'tok_santiago_ramos_demo_2026']) {
    expectRejected(publicCode, `credencial pública ${publicCode}`);
  }
  const santiago = stories.find((s: any) => s.interview.id === 'int_test_santiago_ramos');
  const fresh = santiago.tokens[0];
  assert.match(fresh.accessCode, /^YF-[A-Z0-9]{5}$/);
  assert.equal(storage.resolveToken(fresh.accessCode).interview.id, 'int_test_santiago_ramos');
  assert.equal(storage.resolveToken(fresh.plainToken).interview.id, 'int_test_santiago_ramos');
  const panel = storage.getParticipantsForInterview('int_test_santiago_ramos')[0];
  assert.equal(panel.accessCode, fresh.accessCode, 'el panel muestra el código nuevo');

  // Seeding again rotates them: the previous code stops working.
  const again = storage.seedCompleteTestStoriesInMemory();
  const newer = again.find((s: any) => s.interview.id === 'int_test_santiago_ramos').tokens[0];
  assert.notEqual(newer.accessCode, fresh.accessCode);
  expectRejected(fresh.accessCode, 'código de prueba anterior');
  assert.equal(storage.resolveToken(newer.accessCode).interview.id, 'int_test_santiago_ramos');
});

test('reporte de seguridad de accesos: solo conteos e IDs, nunca códigos', () => {
  const report = storage.getAccessCodeSecurityReport();
  assert.ok(report.totalTokens > 0);
  assert.equal(report.legacyDerivedCodesSwitch, false);
  assert.ok(report.participantsWithAllTokensRevoked.length >= 1);
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /YF-[A-Z0-9]{5}/, 'el reporte no expone códigos');
});
