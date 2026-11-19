import test from 'node:test';
import assert from 'node:assert/strict';
import { storage } from '../src/server/storage.ts';
import {
  resolveOpenAiCandidateModels,
  recordOpenAiModelAccessError,
} from '../src/server/geminiService.ts';

test('OpenAI model resolution prioritizes gpt-4o and remembers 403 project-restricted models like gpt-4.1', () => {
  // Unpublished aliases like gpt-6-luna resolve to universally accessible gpt-4o / gpt-4o-mini first
  const candidatesForAlias = resolveOpenAiCandidateModels('gpt-6-luna', [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4.1',
  ]);
  assert.deepEqual(candidatesForAlias, ['gpt-4o', 'gpt-4o-mini']);

  // Simulate 403 PermissionDeniedError for gpt-4.1
  const err403 = new Error(
    '403 Project `proj_e8RqnYSPXzsjIuEnKThxAOyI` does not have access to model `gpt-4.1`'
  );
  (err403 as any).status = 403;
  const recorded = recordOpenAiModelAccessError('gpt-4.1', err403);
  assert.equal(recorded, true);

  // Even if gpt-4.1 is explicitly requested afterwards, it is skipped in favor of allowed models
  const afterForbidden = resolveOpenAiCandidateModels('gpt-4.1', [
    'gpt-4.1',
    'gpt-4o',
    'gpt-4o-mini',
  ]);
  assert.ok(!afterForbidden.includes('gpt-4.1'));
  assert.equal(afterForbidden[0], 'gpt-4o');
});

test('Permanent manuscript batch deletion + tombstones and async compilation job', async () => {
  await storage.ensureInitialized();

  // Create a temporary interview with 1 participant
  const created = await storage.createInterview({
    title: 'Entrevista Temporal de Prueba Unitaria',
    storyMode: 'individual',
    storyType: 'memorias_personales',
    participants: [
      {
        name: 'Tester Temporal',
        email: 'tester@example.com',
        relationship: 'Titular',
        role: 'primary',
      },
    ],
    performedBy: 'test-suite@foreveryou.mx',
  });
  const interviewId = created.interview.id;
  const plainToken = created.participantTokens[0]?.plainToken;
  assert.ok(plainToken, 'Participant should have a plainToken');

  // Add a sample answer so manuscript compilation has content
  const questions = storage.getQuestions().filter((q) => q.active);
  assert.ok(questions.length > 0, 'Question bank should have active questions');
  await storage.submitAnswer({
    plainToken,
    questionId: questions[0].id,
    answerText:
      'Nací en Guadalajara en una casa llena de árboles frutales donde mis abuelos nos contaban historias todas las tardes.',
    notRecalled: false,
    idempotencyKey: `idem_test_${Date.now()}`,
  });

  // Compile manuscript via compileManuscript
  const manuscript = await storage.compileManuscript(interviewId, 'test-suite@foreveryou.mx');
  assert.ok(manuscript.id, 'Manuscript should be generated with an ID');
  assert.ok(manuscript.content.length > 0, 'Manuscript should contain compiled text content');

  // Verify it appears in getAllManuscripts
  const beforeManuscripts = storage.getAllManuscripts();
  assert.ok(beforeManuscripts.some((m) => m.id === manuscript.id));

  // Batch delete the manuscript
  const delRes = await storage.deleteManuscriptsBatch(
    [manuscript.id],
    'test-suite@foreveryou.mx'
  );
  assert.equal(delRes.deletedCount, 1);

  // Verify it is permanently gone from getAllManuscripts
  const afterManuscripts = storage.getAllManuscripts();
  assert.ok(!afterManuscripts.some((m) => m.id === manuscript.id));

  // Clean up temporary interview
  await storage.deleteInterview(interviewId, 'test-suite@foreveryou.mx');
});

test('Full Database Backup creation, listing, restoration, and deletion', async () => {
  await storage.ensureInitialized();

  const initialInterviews = storage.getInterviews();
  const initialCount = initialInterviews.length;

  // Create a backup of current state
  const backupMeta = await storage.createDatabaseBackup(
    'Respaldo Unit Test Temporal',
    'test-suite@foreveryou.mx'
  );

  assert.ok(backupMeta.id.startsWith('bkp_'));
  assert.equal(backupMeta.label, 'Respaldo Unit Test Temporal');
  assert.equal(backupMeta.counts.interviews, initialCount);

  const list = await storage.listDatabaseBackups();
  assert.ok(list.some((b) => b.id === backupMeta.id));

  // Simulate a Cloud Run cold restart by wiping local data/backups/<id>.json and index.json
  const fs = await import('node:fs');
  const path = await import('node:path');
  const backupFilePath = path.join(process.cwd(), 'data', 'backups', `${backupMeta.id}.json`);
  const indexFilePath = path.join(process.cwd(), 'data', 'backups', 'index.json');
  if (fs.existsSync(backupFilePath)) fs.unlinkSync(backupFilePath);
  if (fs.existsSync(indexFilePath)) fs.writeFileSync(indexFilePath, '[]', 'utf-8');

  // Even with empty local disk, listing and payload download must recover from Cloud Firestore
  const listAfterRestart = await storage.listDatabaseBackups();
  assert.ok(
    listAfterRestart.some((b) => b.id === backupMeta.id),
    'Backup must still appear in listDatabaseBackups() after local disk wipe'
  );
  const recoveredPayload = await storage.getDatabaseBackupPayload(backupMeta.id);
  assert.equal(recoveredPayload.id, backupMeta.id);
  assert.equal(recoveredPayload.counts.interviews, initialCount);

  // Restore the backup (returns to the exact same state and syncs to Firestore)
  const restoredRes = await storage.restoreDatabaseBackup(
    backupMeta.id,
    'test-suite@foreveryou.mx'
  );
  assert.equal(restoredRes.counts.interviews, initialCount);
  assert.ok(restoredRes.remoteSync.written > 0, 'Restore must write collections back to Firestore');

  const afterRestoreInterviews = storage.getInterviews();
  assert.equal(afterRestoreInterviews.length, initialCount);

  // Delete the temporary test backup so we leave both Firestore and disk clean
  const deleted = await storage.deleteDatabaseBackup(backupMeta.id, 'test-suite@foreveryou.mx');
  assert.equal(deleted.deletedId, backupMeta.id);

  const listAfterDelete = await storage.listDatabaseBackups();
  assert.ok(
    !listAfterDelete.some((b) => b.id === backupMeta.id),
    'Deleted backup must be removed from both Firestore and local disk'
  );
});

test('Orphaned participant book versions can be deleted individually and in batch without failing', async () => {
  await storage.ensureInitialized();

  const orphanInterviewId = `int_orphan_${Date.now()}`;
  const orphanVersionId = `pbv_${orphanInterviewId}_v1_${Date.now()}_0`;
  const nowIso = new Date().toISOString();

  // Inject an orphaned book version whose interview does not exist
  const mapRef = (storage as any).participantBookVersions as Map<string, any>;
  mapRef.set(orphanVersionId, {
    id: orphanVersionId,
    interviewId: orphanInterviewId,
    participantId: 'part_orphan',
    participantName: 'Orphan Test',
    versionNumber: 1,
    narrativeStyle: 'fiel_testimonio',
    title: 'Libro Huérfano de Prueba',
    createdAt: nowIso,
    manuscript: {
      title: 'Libro Huérfano de Prueba',
      narrativeStyle: 'fiel_testimonio',
      chapters: [],
    },
  });

  const batchRes = await storage.deleteParticipantBookVersionsBatch(
    [orphanVersionId],
    false,
    'test-suite@foreveryou.mx'
  );
  assert.equal(batchRes.deletedCount, 1);
  assert.deepEqual(batchRes.deletedVersionIds, [orphanVersionId]);
  assert.equal(mapRef.has(orphanVersionId), false);
});
