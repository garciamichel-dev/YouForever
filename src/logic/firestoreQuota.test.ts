import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRESTORE_FREE_DAILY_LIMITS,
  getPacificDateKey,
  computeFirestoreQuotaReport,
  detectChangedInterviewIds,
  computeIncrementalCursorWithOverlap,
  type FirestoreDailyCounters,
  type FirestoreSyncFreshness,
} from './firestoreQuota';

const baseSyncStatus: FirestoreSyncFreshness = {
  lastAttemptAt: '2026-11-12T20:00:00.000Z',
  lastSuccessAt: '2026-11-12T20:00:00.000Z',
  lastError: null,
  quotaExhausted: false,
  source: 'firestore',
  syncedRemoteInterviewsCount: 21,
  localInterviewsCount: 26,
  lastSyncMode: 'incremental',
};

const baseCounters = (overrides?: Partial<FirestoreDailyCounters>): FirestoreDailyCounters => ({
  dateKey: '2026-11-12',
  reads: 500,
  writes: 20,
  deletes: 2,
  readsSavedByIncremental: 9500,
  bySource: {
    storage: { reads: 400, writes: 18, deletes: 2 },
    miEsencia: { reads: 95, writes: 2, deletes: 0 },
    probe: { reads: 5, writes: 0, deletes: 0 },
  },
  lastUpdatedAt: '2026-11-12T20:00:00.000Z',
  ...overrides,
});

test('1. getPacificDateKey formats America/Los_Angeles YYYY-MM-DD consistently', () => {
  // 2026-11-13T04:00:00.000Z is 2026-11-12 20:00:00 PST (UTC-8)
  const dateKey = getPacificDateKey(new Date('2026-11-13T04:00:00.000Z'));
  assert.equal(dateKey, '2026-11-12');
});

test('2. Quota report returns normal state under 80% and calculates incremental savings', () => {
  const report = computeFirestoreQuotaReport({
    projectId: 'balmy-smile-fc70r',
    databaseId: 'ai-studio-24473850-0d4d-4247-8313-c0172221b6cb',
    counters: baseCounters({ reads: 1000, readsSavedByIncremental: 19_000 }),
    probe: {
      checkedAt: '2026-11-12T20:00:00.000Z',
      healthy: true,
      quotaExhausted: false,
      latencyMs: 120,
      errorMessage: null,
    },
    syncStatus: baseSyncStatus,
  });

  assert.equal(report.alertLevel, 'normal');
  assert.equal(report.metrics.reads.used, 1000);
  assert.equal(report.metrics.reads.freeLimit, FIRESTORE_FREE_DAILY_LIMITS.reads);
  assert.equal(report.metrics.reads.percent, 2);
  assert.equal(report.metrics.reads.nearLimit80, false);
  assert.equal(report.reductionPercent, 95);
});

test('3. Quota report triggers warning_80 when reads or writes reach 80% of daily free limit', () => {
  // 40,000 / 50,000 = 80%
  const readsWarning = computeFirestoreQuotaReport({
    projectId: 'balmy-smile-fc70r',
    databaseId: 'ai-studio-24473850-0d4d-4247-8313-c0172221b6cb',
    counters: baseCounters({ reads: 40_000, writes: 100 }),
    probe: null,
    syncStatus: baseSyncStatus,
  });

  assert.equal(readsWarning.alertLevel, 'warning_80');
  assert.deepEqual(readsWarning.nearLimitMetrics, ['reads']);
  assert.equal(readsWarning.metrics.reads.nearLimit80, true);
  assert.equal(readsWarning.metrics.reads.exceeded100, false);

  // Shared cross-instance counter at 16,000 / 20,000 writes = 80%
  const writesWarning = computeFirestoreQuotaReport({
    projectId: 'balmy-smile-fc70r',
    databaseId: 'ai-studio-24473850-0d4d-4247-8313-c0172221b6cb',
    counters: baseCounters({ reads: 1000, writes: 100 }),
    sharedCounters: { reads: 2000, writes: 16_000, deletes: 0 },
    probe: null,
    syncStatus: baseSyncStatus,
  });

  assert.equal(writesWarning.alertLevel, 'warning_80');
  assert.deepEqual(writesWarning.nearLimitMetrics, ['writes']);
  assert.equal(writesWarning.sharedAcrossInstances, true);
});

test('4. Quota report triggers exceeded when live probe reports resource-exhausted or count >= 100%', () => {
  const report = computeFirestoreQuotaReport({
    projectId: 'balmy-smile-fc70r',
    databaseId: 'ai-studio-24473850-0d4d-4247-8313-c0172221b6cb',
    counters: baseCounters({ reads: 1200 }),
    probe: {
      checkedAt: '2026-11-12T20:05:00.000Z',
      healthy: false,
      quotaExhausted: true,
      latencyMs: 90,
      errorMessage: 'Quota limit exceeded',
    },
    syncStatus: { ...baseSyncStatus, quotaExhausted: true },
  });

  assert.equal(report.alertLevel, 'exceeded');
  assert.equal(report.metrics.reads.exceeded100, true);
  assert.equal(report.metrics.reads.nearLimit80, true);
});

test('5. detectChangedInterviewIds isolates only new or modified interviews from www.youforever.app', () => {
  const localMap = new Map([
    [
      'int_1',
      {
        id: 'int_1',
        title: 'Historia 1',
        lastActivityAt: '2026-11-12T10:00:00.000Z',
        completedQuestionCount: 5,
        status: 'open',
      },
    ],
    [
      'int_2',
      {
        id: 'int_2',
        title: 'Historia 2',
        lastActivityAt: '2026-11-12T12:00:00.000Z',
        completedQuestionCount: 10,
        status: 'open',
      },
    ],
  ]);

  const remote = [
    {
      id: 'int_1',
      title: 'Historia 1',
      lastActivityAt: '2026-11-12T10:00:00.000Z',
      completedQuestionCount: 5,
      status: 'open',
    },
    {
      id: 'int_2',
      title: 'Historia 2',
      lastActivityAt: '2026-11-12T15:30:00.000Z',
      completedQuestionCount: 11,
      status: 'open',
    },
    {
      id: 'int_3_new',
      title: 'Nueva desde www.youforever.app',
      lastActivityAt: '2026-11-12T18:00:00.000Z',
      completedQuestionCount: 1,
      status: 'open',
    },
  ];

  const changed = detectChangedInterviewIds(localMap, remote);
  assert.deepEqual(changed, ['int_2', 'int_3_new']);
});

test('6. computeIncrementalCursorWithOverlap subtracts safety overlap window cleanly', () => {
  const cursor = computeIncrementalCursorWithOverlap(
    ['2026-11-12T10:00:00.000Z', '2026-11-12T15:05:00.000Z', null],
    3
  );
  assert.equal(cursor, '2026-11-12T15:02:00.000Z');
  assert.equal(computeIncrementalCursorWithOverlap([null, undefined]), null);
});
