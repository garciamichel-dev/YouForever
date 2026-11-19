/**
 * V5.8.5 — Low-risk fixes: backups (#2, #3, #4), free-registration limits (#9), job status by POST
 * (#14a), configuration for administrators only (#14b) and PDF batch deletion (#15).
 *
 * Fully isolated: its own temporary working folder, an in-memory document store in place of
 * Firestore (which can be switched "offline"), every Firestore read pointed at a closed local port
 * and no AI providers.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ISOLATED_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'yf_v585_'));
process.chdir(ISOLATED_ROOT);
process.env.YOUFOREVER_ALLOW_TEST_DOUBLES = '1';
process.env.GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';
process.env.YF_SEED_TEST_STORIES = '0';
process.env.FIREBASE_PROJECT_ID = 'demo-youforever-tests';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:9';
process.env.FIRESTORE_SERVER_MODE = 'admin';

const collections = new Map<string, Map<string, any>>();
const col = (name: string) => {
  let c = collections.get(name);
  if (!c) {
    c = new Map();
    collections.set(name, c);
  }
  return c;
};
const memoryStore = {
  offline: false,
  async setDoc(name: string, id: string, data: any) {
    if (memoryStore.offline) throw new Error('Firestore simulado sin conexión');
    col(name).set(id, JSON.parse(JSON.stringify(data)));
  },
  async setDocDirect(name: string, id: string, data: any) {
    return memoryStore.setDoc(name, id, data);
  },
  async deleteDoc(name: string, id: string) {
    if (memoryStore.offline) throw new Error('Firestore simulado sin conexión');
    col(name).delete(id);
  },
  async getDoc(name: string, id: string) {
    if (memoryStore.offline) throw new Error('Firestore simulado sin conexión');
    const v = col(name).get(id);
    return v ? JSON.parse(JSON.stringify(v)) : null;
  },
  async listCollection(name: string) {
    if (memoryStore.offline) throw new Error('Firestore simulado sin conexión');
    return Array.from(col(name).entries()).map(([id, data]) => ({ id, data: JSON.parse(JSON.stringify(data)) }));
  },
};

// A real 1×1 PNG and a short "voice note".
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const AUDIO_DATA_URL = `data:audio/webm;base64,${Buffer.from('voz de prueba '.repeat(40)).toString('base64')}`;

let storage: any;
let guard: any;
let rules: any;

before(async () => {
  ({ storage } = await import(path.join(REPO_ROOT, 'src/server/storage.ts')));
  guard = await import(path.join(REPO_ROOT, 'src/server/accessGuard.ts'));
  rules = await import(path.join(REPO_ROOT, 'src/logic/interviewRules.ts'));
  storage.configureTestDoubles({ remoteDocStore: memoryStore });
  const { miEsenciaStore } = await import(path.join(REPO_ROOT, 'src/server/miEsencia/miEsenciaStore.ts'));
  (miEsenciaStore as any).syncFullStateToFirestore = async () => ({ written: 0, deleted: 0, warnings: [] });
  await storage.ensureInitialized();
});

after(() => {
  assert.equal(process.cwd(), ISOLATED_ROOT);
});

async function newInterview(title: string) {
  return storage.createInterview({
    title,
    storyMode: 'individual',
    storyType: 'biografia_personal',
    participants: [{ name: 'Persona de prueba', relationship: 'Titular', role: 'primary' }],
    performedBy: 'admin_pruebas',
  });
}

// -------------------------------------------------------------------------------------------------
// #3 — A Firestore failure no longer loses the backup
// -------------------------------------------------------------------------------------------------

test('#3 si Firestore falla, el respaldo queda "solo local" (no se pierde) y luego se sube solo', async () => {
  memoryStore.offline = true;
  const backup = await storage.createDatabaseBackup('Respaldo sin Firestore', 'admin_pruebas');
  memoryStore.offline = false;

  assert.equal(backup.storageLocation, 'local');
  assert.equal(backup.pendingUpload, true);
  assert.ok(backup.warnings.some((w: string) => /solo quedó en el disco/.test(w)));
  assert.ok(fs.existsSync(path.join(ISOLATED_ROOT, 'data', 'backups', `${backup.id}.json`)), 'la copia local existe');
  const payload = await storage.getDatabaseBackupPayload(backup.id);
  assert.equal(payload.id, backup.id, 'la copia local se puede descargar');

  const retried = await storage.retryPendingBackupUploads();
  assert.deepEqual(retried.uploaded, [backup.id], 'al volver Firestore se sube');
  assert.ok(col('databaseBackups').has(backup.id));
  const listed = (await storage.listDatabaseBackups()).find((b: any) => b.id === backup.id);
  assert.equal(listed.storageLocation, 'firestore_and_local');
});

// -------------------------------------------------------------------------------------------------
// #4 — Photos and voice notes travel complete
// -------------------------------------------------------------------------------------------------

test('#4 el respaldo incluye fotos y notas de voz aunque en memoria estén vacías', async () => {
  const created = await newInterview('Historia con medios V5.8.5');
  const interviewId = created.interview.id;
  const participantId = created.participantTokens[0].participant.id;
  const photoId = `photo_${interviewId}_test_1`;
  const lostPhotoId = `photo_${interviewId}_test_lost`;
  const audioId = `aud_${interviewId}_test_1`;

  // A photo whose bytes live only on disk (as after a restart from the local snapshot)…
  fs.mkdirSync(path.join(ISOLATED_ROOT, 'data', 'photos'), { recursive: true });
  fs.writeFileSync(path.join(ISOLATED_ROOT, 'data', 'photos', `${photoId}.bin`), Buffer.from(PNG_BASE64, 'base64'));
  (storage as any).photos.set(photoId, { id: photoId, interviewId, participantId, dataUrl: '', mimeType: 'image/png', imageUrl: `/api/photos/${photoId}` });
  // …a photo whose bytes exist nowhere…
  (storage as any).photos.set(lostPhotoId, { id: lostPhotoId, interviewId, participantId, dataUrl: '', imageUrl: `/api/photos/${lostPhotoId}` });
  // …and a voice note held only in Firestore.
  (storage as any).audios.set(audioId, { id: audioId, interviewId, participantId, audioDataUrl: '', mimeType: 'audio/webm' });
  col('interviewAudio').set(audioId, { id: audioId, interviewId, participantId, audioDataUrl: AUDIO_DATA_URL, mimeType: 'audio/webm' });

  const backup = await storage.createDatabaseBackup('Respaldo con medios', 'admin_pruebas');
  const payload = await storage.getDatabaseBackupPayload(backup.id);
  const photo = payload.storage.photos.find((p: any) => p.id === photoId);
  assert.match(photo.dataUrl, /^data:image\/png;base64,/, 'la foto del disco viaja dentro del respaldo');
  const audio = payload.storage.audios.find((a: any) => a.id === audioId);
  assert.match(String(audio.audioDataUrl), /^data:audio\//, 'la nota de voz de Firestore viaja dentro del respaldo');

  assert.equal(backup.mediaCheck.photosMissing, 1, 'la foto perdida se reporta');
  assert.deepEqual(backup.mediaCheck.missingPhotoIds, [lostPhotoId]);
  assert.ok(backup.warnings.some((w: string) => /1 foto/.test(w)), 'el aviso lo dice');
  assert.equal(payload.mediaCheck.photosMissing, 1);

  (storage as any).photos.delete(photoId);
  (storage as any).photos.delete(lostPhotoId);
  (storage as any).audios.delete(audioId);
});

// -------------------------------------------------------------------------------------------------
// #2 — Restore never runs without a safety backup of the current state
// -------------------------------------------------------------------------------------------------

test('#2 restaurar crea primero un respaldo automático del estado actual (que se conserva)', async () => {
  const target = await storage.createDatabaseBackup('Punto de restauración', 'admin_pruebas');
  const created = await newInterview('Creada después del respaldo');

  const result = await storage.restoreDatabaseBackup(target.id, 'admin_pruebas');
  assert.ok(result.preRestoreBackup?.id);
  assert.equal(storage.getInterview(created.interview.id), undefined, 'la restauración volvió al punto elegido');

  const safety = await storage.getDatabaseBackupPayload(result.preRestoreBackup.id);
  assert.equal(safety.kind, 'pre_restore');
  assert.ok(
    safety.storage.interviews.some((i: any) => i.id === created.interview.id),
    'el respaldo automático conserva lo creado después del punto restaurado'
  );
  assert.ok(col('databaseBackups').has(result.preRestoreBackup.id), 'quedó en Firestore');
  const listed = (await storage.listDatabaseBackups()).find((b: any) => b.id === result.preRestoreBackup.id);
  assert.equal(listed.kind, 'pre_restore');
});

test('#2 si el respaldo automático no llega a Firestore, NO se restaura nada', async () => {
  const target = await storage.createDatabaseBackup('Otro punto', 'admin_pruebas');
  const kept = await newInterview('Debe seguir existiendo');
  const beforeIds = storage.getInterviews().map((i: any) => i.id).sort();

  // Firestore answers the read of the backup but refuses every write.
  const realSet = memoryStore.setDoc;
  memoryStore.setDoc = async () => {
    throw new Error('cuota agotada (simulada)');
  };
  await assert.rejects(
    () => storage.restoreDatabaseBackup(target.id, 'admin_pruebas'),
    (err: any) => err.code === 'PRE_RESTORE_BACKUP_FAILED' && /No se restauró nada/.test(err.message) && Boolean(err.localBackupId)
  );
  memoryStore.setDoc = realSet;

  assert.deepEqual(storage.getInterviews().map((i: any) => i.id).sort(), beforeIds, 'los datos actuales no se tocaron');
  assert.ok(storage.getInterview(kept.interview.id));
});

// -------------------------------------------------------------------------------------------------
// #9 — Free-registration limits
// -------------------------------------------------------------------------------------------------

test('#9 valores por defecto 10 / 5 / 5 y validación (0 = sin límite)', async () => {
  assert.deepEqual(rules.DEFAULT_FREE_REGISTRATION_LIMITS, { perIpPerHour: 10, perEmailPerDay: 5, resendCooldownMinutes: 5 });
  assert.deepEqual(rules.normalizeFreeRegistrationLimits(undefined), rules.DEFAULT_FREE_REGISTRATION_LIMITS);
  assert.deepEqual(rules.normalizeFreeRegistrationLimits({ perIpPerHour: 0, perEmailPerDay: '7' as any }), {
    perIpPerHour: 0,
    perEmailPerDay: 7,
    resendCooldownMinutes: 5,
  });
  assert.deepEqual(storage.getConfig().freeRegistrationLimits, rules.DEFAULT_FREE_REGISTRATION_LIMITS, 'configuraciones anteriores reciben los valores por defecto');

  await storage.updateConfig({ freeRegistrationLimits: { perIpPerHour: 20, perEmailPerDay: 3, resendCooldownMinutes: 0 } }, 'admin_pruebas');
  assert.deepEqual(storage.getConfig().freeRegistrationLimits, { perIpPerHour: 20, perEmailPerDay: 3, resendCooldownMinutes: 0 });
  await assert.rejects(() => storage.updateConfig({ freeRegistrationLimits: { perIpPerHour: -1 } as any }, 'admin_pruebas'), /mayores o iguales a 0/);
  await assert.rejects(() => storage.updateConfig({ freeRegistrationLimits: { perEmailPerDay: 2.5 } as any }, 'admin_pruebas'), /enteros/);
  await storage.updateConfig({ freeRegistrationLimits: { ...rules.DEFAULT_FREE_REGISTRATION_LIMITS } }, 'admin_pruebas');
});

test('#9 limitador: por conexión, por correo y espera entre reenvíos; solo cuentan los éxitos', () => {
  let now = 0;
  let limits = { perIpPerHour: 10, perEmailPerDay: 5, resendCooldownMinutes: 5 };
  const limiter = new guard.FreeRegistrationLimiter(() => limits, () => now);

  // Per connection: 10 per hour.
  for (let i = 0; i < 10; i++) {
    assert.equal(limiter.checkRegistration('ip-a', [`persona${i}@example.com`]), null);
    limiter.recordRegistration('ip-a', [`persona${i}@example.com`]);
  }
  assert.match(limiter.checkRegistration('ip-a', ['nuevo@example.com']), /conexión/);
  assert.equal(limiter.checkRegistration('ip-b', ['nuevo@example.com']), null, 'otra conexión no se ve afectada');
  now += 3_600_001;
  assert.equal(limiter.checkRegistration('ip-a', ['nuevo@example.com']), null, 'se libera a la hora');

  // Per e-mail: 5 per day, from any connection.
  for (let i = 0; i < 5; i++) limiter.recordRegistration(`ip-${i + 10}`, ['misma@example.com']);
  assert.match(limiter.checkRegistration('ip-z', ['misma@example.com']), /misma@example\.com/);
  now += 86_400_001;
  assert.equal(limiter.checkRegistration('ip-z', ['misma@example.com']), null, 'se libera al día siguiente');

  // A check that was not followed by a successful registration does not count.
  for (let i = 0; i < 50; i++) limiter.checkRegistration('ip-c', ['intentos@example.com']);
  assert.equal(limiter.checkRegistration('ip-c', ['intentos@example.com']), null);

  // Resend: once every 5 minutes per interview.
  assert.equal(limiter.checkResend('int_1'), null);
  limiter.recordResend('int_1');
  assert.match(limiter.checkResend('int_1'), /5 minuto/);
  assert.equal(limiter.checkResend('int_2'), null);
  now += 5 * 60_000 + 1;
  assert.equal(limiter.checkResend('int_1'), null);

  // 0 = no limit, and changes apply immediately.
  limits = { perIpPerHour: 0, perEmailPerDay: 0, resendCooldownMinutes: 0 };
  for (let i = 0; i < 100; i++) limiter.recordRegistration('ip-d', ['sinlimite@example.com']);
  assert.equal(limiter.checkRegistration('ip-d', ['sinlimite@example.com']), null);
  limiter.recordResend('int_3');
  assert.equal(limiter.checkResend('int_3'), null);
});

// -------------------------------------------------------------------------------------------------
// #14a, #14b, #15 — source-level checks of the small adjustments
// -------------------------------------------------------------------------------------------------

test('#14a/#14b/#15 ajustes menores presentes en el código', () => {
  const api = fs.readFileSync(path.join(REPO_ROOT, 'src/server/api.ts'), 'utf-8');
  assert.match(api, /apiRouter\.get\('\/config', requireAdmin,/, 'leer la configuración requiere administrador');
  assert.match(api, /apiRouter\.post\('\/participant\/book\/jobs\/status', handleParticipantBookJobStatus\)/);
  assert.match(api, /freeRegistrationLimiter\.checkRegistration\(/);
  assert.match(api, /freeRegistrationLimiter\.checkResend\(/);

  const studio = fs.readFileSync(path.join(REPO_ROOT, 'src/components/ParticipantBookStudio.tsx'), 'utf-8');
  assert.doesNotMatch(studio, /jobs\/status\?token=/, 'el código de acceso ya no viaja en la URL');

  const manuscripts = fs.readFileSync(path.join(REPO_ROOT, 'src/components/ManuscriptsView.tsx'), 'utf-8');
  assert.match(manuscripts, /data\.data\.deletedVersionIds/, 'solo se quitan los PDF que el servidor confirma');

  const panel = fs.readFileSync(path.join(REPO_ROOT, 'src/components/ConfigPanel.tsx'), 'utf-8');
  const limitsAt = panel.indexOf('data-testid="free-registration-limits-section"');
  const backupsAt = panel.indexOf('data-testid="database-backups-section"');
  assert.ok(limitsAt > 0 && backupsAt > limitsAt, 'los límites aparecen justo antes de la sección de restaurar la base de datos');
});
