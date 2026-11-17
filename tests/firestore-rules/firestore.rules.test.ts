/**
 * V5.3.2 — SECURITY RULES TESTS (official Firebase Emulator Suite).
 *
 * Run with:  npm run test:rules
 * (= firebase emulators:exec --only firestore … ; needs Java and the Firestore emulator download).
 *
 * These tests evaluate the private rules (`firestore.private.rules`) exactly as Cloud Firestore would. The "server" case uses
 * `withSecurityRulesDisabled`, which is how the Firebase Admin SDK (service identity) behaves: it is
 * authorized by IAM, not by rules.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROJECT_ID = 'demo-youforever-rules';

/** Every collection the application stores (from the V5.3.1 rules and the server code). */
const SENSITIVE_COLLECTIONS = [
  'interviews',
  'participants',
  'interviewTokens',
  'answers',
  'questions',
  'questionnaireVersions',
  'participantBookVersions',
  'interviewPhotos',
  'interviewAudio',
  'manuscripts',
  'auditLogs',
  'privacyConsents',
  'arcoRequests',
  'secondaryAccess',
  'scheduledDeliveries',
  'postMortemInstructions',
  'bookShares',
  'settings',
  'admins',
  'bookAuditReports',
  'mi_esencia_config',
  'mi_esencia_plans',
  'mi_esencia_subscriptions',
  'mi_esencia_persons',
  'mi_esencia_testimonies',
  'mi_esencia_relations',
  'mi_esencia_interlocutors',
  'mi_esencia_credentials',
  'mi_esencia_memories',
  'mi_esencia_contradictions',
  'mi_esencia_prompt_library',
  'mi_esencia_prompt_versions',
  'mi_esencia_pdfs',
  'mi_esencia_conversations',
  'mi_esencia_coupons',
  'mi_esencia_fallback_logs',
  'mi_esencia_notifications',
  'mi_esencia_payments',
  'mi_esencia_snapshots',
];

let env: RulesTestEnvironment;

before(async () => {
  const [host, port] = String(process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(path.join(REPO_ROOT, 'firestore.private.rules'), 'utf8'),
      host,
      port: Number(port),
    },
  });
  // Seed data the way the server does (Admin SDK = rules bypassed).
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const name of SENSITIVE_COLLECTIONS) {
      await db.collection(name).doc('seed').set({ interviewId: 'i1', title: 'privado', secret: 'testimonio' });
    }
    await db.collection('participantBookVersions').doc('pbv_i1_v1__part0').set({ interviewId: 'i1', _chunkOf: 'pbv_i1_v1', _payload: '{}' });
    await db.collection('test').doc('connection').set({});
  });
});

after(async () => {
  await env?.cleanup();
});

const clients = () => ({
  anonymous: env.unauthenticatedContext().firestore(),
  normalUser: env.authenticatedContext('user-1', { email: 'persona@example.com', email_verified: true }).firestore(),
  // A client claiming an administrator identity through its e-mail (or a custom claim) gets nothing.
  fakeAdmin: env
    .authenticatedContext('attacker', { email: 'admin@youforever.app', email_verified: true, admin: true, role: 'admin' })
    .firestore(),
});

test('Cliente anónimo, usuario autenticado y "administrador" por correo: sin lectura en ninguna colección sensible', async () => {
  for (const [who, db] of Object.entries(clients())) {
    for (const name of SENSITIVE_COLLECTIONS) {
      await assertFails(db.collection(name).doc('seed').get()).catch((e) => {
        throw new Error(`${who} pudo leer ${name}/seed: ${e}`);
      });
      await assertFails(db.collection(name).get()).catch((e) => {
        throw new Error(`${who} pudo listar ${name}: ${e}`);
      });
    }
    await assertFails(db.collection('participantBookVersions').where('interviewId', '==', 'i1').get());
    await assertFails(db.collection('participantBookVersions').doc('pbv_i1_v1__part0').get());
  }
});

test('Ningún cliente puede crear, modificar ni borrar documentos (tampoco autorizarse en "admins")', async () => {
  for (const [who, db] of Object.entries(clients())) {
    for (const name of SENSITIVE_COLLECTIONS) {
      await assertFails(db.collection(name).doc(`nuevo_${who}`).set({ interviewId: 'i1', title: 'x' })).catch((e) => {
        throw new Error(`${who} pudo escribir en ${name}: ${e}`);
      });
      await assertFails(db.collection(name).doc('seed').update({ secret: 'alterado' }));
      await assertFails(db.collection(name).doc('seed').delete());
    }
    await assertFails(db.collection('admins').doc('admin@youforever.app').set({ email: 'admin@youforever.app', role: 'admin' }));
    await assertFails(db.collection('interviews').doc('i1').collection('cualquier').doc('x').set({ a: 1 }));
  }
});

test('La sonda de conectividad test/connection se puede leer pero no escribir', async () => {
  const { anonymous, normalUser } = clients();
  await assertSucceeds(anonymous.collection('test').doc('connection').get());
  await assertFails(anonymous.collection('test').doc('connection').set({ x: 1 }));
  await assertFails(normalUser.collection('test').get());
  await assertFails(anonymous.collection('test').doc('otro').get());
});

test('El servidor (Admin SDK, identidad de servicio) sí opera: lectura, escritura, consulta y borrado', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('interviews').doc('i2').set({ title: 'Entrevista', bookGeneratedCount: 0 });
    const snap = await db.collection('interviews').doc('i2').get();
    assert.equal(snap.data()?.title, 'Entrevista');
    const q = await db.collection('participantBookVersions').where('interviewId', '==', 'i1').get();
    assert.ok(q.size >= 2);
    await db.collection('interviews').doc('i2').delete();
    assert.equal((await db.collection('interviews').doc('i2').get()).exists, false);
  });
});
