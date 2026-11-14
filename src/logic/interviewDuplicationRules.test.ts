import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDefaultAdminCopyNote,
  computeLayoutEditQuotaStatus,
  sanitizeInterviewForParticipant,
  sortInterviewsWithCopies,
  type InterviewRecord,
} from './interviewRules';

function makeInterview(overrides: Partial<InterviewRecord>): InterviewRecord {
  return {
    id: 'inv_default',
    title: 'Historia de Vida',
    storyMode: 'individual',
    storyType: 'biografia_personal',
    status: 'open',
    openedAt: '2026-02-01T10:00:00.000Z',
    expiresAt: '2026-03-01T10:00:00.000Z',
    openDaysAtCreation: 30,
    sufficiencyThreshold: 100,
    maxFollowUpsAtCreation: 2,
    completedQuestionCount: 10,
    sufficiencyStatus: 'not_evaluated',
    userDeclaredComplete: false,
    lastActivityAt: '2026-02-01T10:00:00.000Z',
    questionnaireVersionId: 'v1_initial',
    ...overrides,
  };
}

test('sortInterviewsWithCopies places copies directly underneath their original interview', () => {
  const olderRoot = makeInterview({
    id: 'inv_old',
    title: 'Entrevista Original Antigua',
    openedAt: '2026-01-10T10:00:00.000Z',
  });
  const newerRoot = makeInterview({
    id: 'inv_new',
    title: 'Entrevista Reciente',
    openedAt: '2026-02-15T10:00:00.000Z',
  });
  const firstCopyOfOld = makeInterview({
    id: 'inv_old_copy_1',
    title: 'Entrevista Original Antigua',
    openedAt: '2026-03-01T10:00:00.000Z',
    copiedFromInterviewId: 'inv_old',
    copiedFromName: 'Juan Pérez',
    copiedAt: '2026-03-01T10:00:00.000Z',
    adminCopyNote: 'Es una copia de Juan Pérez, realizada el 01/03/2026',
  });
  const secondCopyOfOld = makeInterview({
    id: 'inv_old_copy_2',
    title: 'Entrevista Original Antigua',
    openedAt: '2026-03-05T10:00:00.000Z',
    copiedFromInterviewId: 'inv_old',
    copiedFromName: 'Juan Pérez',
    copiedAt: '2026-03-05T10:00:00.000Z',
    adminCopyNote: 'Es una copia de Juan Pérez, realizada el 05/03/2026',
  });
  const copyOfCopy = makeInterview({
    id: 'inv_old_copy_1_child',
    title: 'Entrevista Original Antigua',
    openedAt: '2026-03-06T10:00:00.000Z',
    copiedFromInterviewId: 'inv_old_copy_1',
    copiedFromName: 'Juan Pérez',
    copiedAt: '2026-03-06T10:00:00.000Z',
  });

  const sorted = sortInterviewsWithCopies([
    firstCopyOfOld,
    olderRoot,
    copyOfCopy,
    newerRoot,
    secondCopyOfOld,
  ]);

  assert.deepEqual(
    sorted.map((item) => item.id),
    ['inv_new', 'inv_old', 'inv_old_copy_1', 'inv_old_copy_1_child', 'inv_old_copy_2']
  );
});

test('sanitizeInterviewForParticipant removes all admin-only copy fields while preserving operational state', () => {
  const copied = makeInterview({
    id: 'inv_copy_secret',
    title: 'Memorias de Michel',
    userDeclaredComplete: true,
    layoutEditsAllowed: 3,
    layoutEditsUsed: 2,
    bookGeneratedCount: 2,
    copiedFromInterviewId: 'inv_orig',
    copiedFromName: 'Michel García García',
    copiedAt: '2026-11-12T12:00:00.000Z',
    adminCopyNote: 'Es una copia de Michel García García, realizada el 12/11/2026',
  });

  const clean = sanitizeInterviewForParticipant(copied);

  assert.equal('copiedFromInterviewId' in clean, false);
  assert.equal('copiedFromName' in clean, false);
  assert.equal('copiedAt' in clean, false);
  assert.equal('adminCopyNote' in clean, false);
  assert.equal(clean.id, 'inv_copy_secret');
  assert.equal(clean.title, 'Memorias de Michel');
  assert.equal(clean.layoutEditsAllowed, 3);
  assert.equal(clean.layoutEditsUsed, 2);
  assert.equal(clean.bookGeneratedCount, 2);
  assert.equal(clean.userDeclaredComplete, true);
});

test('buildDefaultAdminCopyNote formats full name and Spanish date consistently', () => {
  const note = buildDefaultAdminCopyNote('Michel García García', '2026-11-12T18:00:00.000Z');
  assert.match(note, /^Es una copia de Michel García García, realizada el \d{2}\/\d{2}\/2026$/);

  const fallbackNote = buildDefaultAdminCopyNote('', 'invalid-date');
  assert.match(fallbackNote, /^Es una copia de Entrevistado, realizada el \d{2}\/\d{2}\/\d{4}$/);
});

test('computeLayoutEditQuotaStatus reflects copied and updated quota counts accurately', () => {
  const inv = makeInterview({
    layoutEditsAllowed: 4,
    layoutEditsUsed: 1,
    bookGeneratedCount: 1,
  });
  const status = computeLayoutEditQuotaStatus(inv);
  assert.equal(status.layoutEditsAllowed, 4);
  assert.equal(status.layoutEditsUsed, 1);
  assert.equal(status.remainingEdits, 3);
  assert.equal(status.hasInitialBook, true);
  assert.equal(status.canModifyLayout, true);

  const exhausted = computeLayoutEditQuotaStatus(
    makeInterview({ layoutEditsAllowed: 2, layoutEditsUsed: 2, bookGeneratedCount: 2 })
  );
  assert.equal(exhausted.remainingEdits, 0);
  assert.equal(exhausted.canModifyLayout, false);
});
