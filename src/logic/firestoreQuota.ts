export const FIRESTORE_FREE_DAILY_LIMITS = {
  reads: 50_000,
  writes: 20_000,
  deletes: 20_000,
} as const;

export const FIRESTORE_QUOTA_WARNING_RATIO = 0.8;

export interface FirestoreDailyCounters {
  dateKey: string;
  reads: number;
  writes: number;
  deletes: number;
  readsSavedByIncremental: number;
  bySource: {
    storage: { reads: number; writes: number; deletes: number };
    miEsencia: { reads: number; writes: number; deletes: number };
    probe: { reads: number; writes: number; deletes: number };
  };
  lastUpdatedAt: string;
}

export interface FirestoreProbeSnapshot {
  checkedAt: string;
  healthy: boolean;
  quotaExhausted: boolean;
  latencyMs: number;
  errorMessage: string | null;
}

export interface FirestoreSyncFreshness {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  quotaExhausted: boolean;
  source: 'firestore' | 'disk_cache';
  syncedRemoteInterviewsCount: number;
  localInterviewsCount: number;
  lastSyncMode?: 'incremental' | 'full' | null;
  answersCursor?: string | null;
  questionsSyncedAt?: string | null;
}

export type FirestoreQuotaAlertLevel = 'normal' | 'warning_80' | 'exceeded';

export interface FirestoreQuotaMetricSummary {
  key: 'reads' | 'writes' | 'deletes';
  label: string;
  used: number;
  freeLimit: number;
  warningThresholdCount: number;
  ratio: number;
  percent: number;
  nearLimit80: boolean;
  exceeded100: boolean;
}

export interface FirestoreQuotaReport {
  dateKey: string;
  timezone: 'America/Los_Angeles';
  projectId: string;
  databaseId: string;
  alertLevel: FirestoreQuotaAlertLevel;
  alertTitle: string;
  alertDescription: string;
  metrics: {
    reads: FirestoreQuotaMetricSummary;
    writes: FirestoreQuotaMetricSummary;
    deletes: FirestoreQuotaMetricSummary;
  };
  highestPercent: number;
  nearLimitMetrics: Array<'reads' | 'writes' | 'deletes'>;
  readsSavedByIncremental: number;
  estimatedTotalWithoutOptimization: number;
  reductionPercent: number;
  bySource: FirestoreDailyCounters['bySource'];
  sharedAcrossInstances: boolean;
  probe: FirestoreProbeSnapshot | null;
  syncStatus: FirestoreSyncFreshness;
  consoleUsageUrl: string;
  consoleUpgradeUrl: string;
}

/**
 * Returns YYYY-MM-DD in America/Los_Angeles (exact timezone when Cloud Firestore resets daily free quotas).
 */
export function getPacificDateKey(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value || '1970';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const day = parts.find((p) => p.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

function buildMetricSummary(
  key: 'reads' | 'writes' | 'deletes',
  label: string,
  used: number,
  freeLimit: number,
  forcedExceeded: boolean
): FirestoreQuotaMetricSummary {
  const safeUsed = Math.max(0, Math.floor(Number(used) || 0));
  const rawRatio = freeLimit > 0 ? safeUsed / freeLimit : 0;
  const percent = Math.round(rawRatio * 1000) / 10;
  const warningThresholdCount = Math.floor(freeLimit * FIRESTORE_QUOTA_WARNING_RATIO);
  const exceeded100 = forcedExceeded || safeUsed >= freeLimit;
  const nearLimit80 = exceeded100 || rawRatio >= FIRESTORE_QUOTA_WARNING_RATIO;

  return {
    key,
    label,
    used: safeUsed,
    freeLimit,
    warningThresholdCount,
    ratio: rawRatio,
    percent,
    nearLimit80,
    exceeded100,
  };
}

export function computeFirestoreQuotaReport(params: {
  projectId: string;
  databaseId: string;
  counters: FirestoreDailyCounters;
  sharedCounters?: { reads: number; writes: number; deletes: number } | null;
  probe: FirestoreProbeSnapshot | null;
  syncStatus: FirestoreSyncFreshness;
}): FirestoreQuotaReport {
  const { projectId, databaseId, counters, sharedCounters, probe, syncStatus } = params;

  const effectiveReads = Math.max(counters.reads || 0, sharedCounters?.reads || 0);
  const effectiveWrites = Math.max(counters.writes || 0, sharedCounters?.writes || 0);
  const effectiveDeletes = Math.max(counters.deletes || 0, sharedCounters?.deletes || 0);

  const probeHitQuota = Boolean(probe?.quotaExhausted || syncStatus.quotaExhausted);

  const readsMetric = buildMetricSummary(
    'reads',
    'Lecturas diarias',
    effectiveReads,
    FIRESTORE_FREE_DAILY_LIMITS.reads,
    probeHitQuota
  );
  const writesMetric = buildMetricSummary(
    'writes',
    'Escrituras diarias',
    effectiveWrites,
    FIRESTORE_FREE_DAILY_LIMITS.writes,
    false
  );
  const deletesMetric = buildMetricSummary(
    'deletes',
    'Eliminaciones diarias',
    effectiveDeletes,
    FIRESTORE_FREE_DAILY_LIMITS.deletes,
    false
  );

  const metricList = [readsMetric, writesMetric, deletesMetric];
  const nearLimitMetrics = metricList.filter((m) => m.nearLimit80).map((m) => m.key);
  const highestPercent = Math.max(readsMetric.percent, writesMetric.percent, deletesMetric.percent);

  let alertLevel: FirestoreQuotaAlertLevel = 'normal';
  if (probeHitQuota || metricList.some((m) => m.exceeded100)) {
    alertLevel = 'exceeded';
  } else if (nearLimitMetrics.length > 0) {
    alertLevel = 'warning_80';
  }

  let alertTitle = 'Consumo operativo dentro del rango saludable';
  let alertDescription =
    'La sincronización incremental mantiene las operaciones de Firestore muy por debajo del 80% del límite diario gratuito.';

  if (alertLevel === 'exceeded') {
    alertTitle = 'Límite diario gratuito superado o bloqueado en Firestore';
    alertDescription =
      'Se detectó un error de cuota agotada o se alcanzó el 100% de la capa gratuita diaria (50,000 lecturas / 20,000 escrituras). Si activaste Blaze (pago por uso), el servicio continúa operando cubriendo únicamente el excedente.';
  } else if (alertLevel === 'warning_80') {
    const flaggedNames = metricList
      .filter((m) => m.nearLimit80)
      .map((m) => `${m.label.toLowerCase()} (${m.percent}%)`)
      .join(', ');
    alertTitle = `Alerta preventiva: consumo igual o superior al 80% (${flaggedNames})`;
    alertDescription =
      'El consumo acumulado de hoy se acerca al tope diario gratuito de Cloud Firestore. Si estás en plan Blaze (pago por uso), no habrá cortes al llegar al 100%; si estás en Spark gratuito, las consultas podrían pausarse hasta medianoche (hora del Pacífico).';
  }

  const saved = Math.max(0, Math.floor(counters.readsSavedByIncremental || 0));
  const estimatedTotalWithoutOptimization = effectiveReads + saved;
  const reductionPercent =
    estimatedTotalWithoutOptimization > 0
      ? Math.round((saved / estimatedTotalWithoutOptimization) * 1000) / 10
      : 0;

  return {
    dateKey: counters.dateKey || getPacificDateKey(),
    timezone: 'America/Los_Angeles',
    projectId,
    databaseId,
    alertLevel,
    alertTitle,
    alertDescription,
    metrics: {
      reads: readsMetric,
      writes: writesMetric,
      deletes: deletesMetric,
    },
    highestPercent,
    nearLimitMetrics,
    readsSavedByIncremental: saved,
    estimatedTotalWithoutOptimization,
    reductionPercent,
    bySource: counters.bySource,
    sharedAcrossInstances: Boolean(sharedCounters),
    probe,
    syncStatus,
    consoleUsageUrl: `https://console.firebase.google.com/project/${projectId}/firestore/databases/${databaseId}/usage`,
    consoleUpgradeUrl: `https://console.firebase.google.com/project/${projectId}/firestore/databases/${databaseId}/data?openUpgradeDialog=true`,
  };
}

export interface InterviewComparisonShape {
  id: string;
  title?: string | null;
  status?: string | null;
  userDeclaredComplete?: boolean | null;
  openedAt?: string | null;
  lastActivityAt?: string | null;
  reopenedAt?: string | null;
  closedAt?: string | null;
  completedQuestionCount?: number | null;
  bookGeneratedCount?: number | null;
  layoutEditsUsed?: number | null;
  layoutEditsAllowed?: number | null;
  adminCopyNote?: string | null;
}

/**
 * Identifies which interview IDs differ between local memory/disk state and remote Firestore state
 * so scoped queries only pull subcollections (participants, tokens, photos, audios, bookVersions)
 * for interviews that actually changed.
 */
export function detectChangedInterviewIds(
  localMap: Map<string, InterviewComparisonShape>,
  remoteInterviews: InterviewComparisonShape[]
): string[] {
  const changedIds: string[] = [];

  for (const remote of remoteInterviews) {
    if (!remote || !remote.id) continue;
    const local = localMap.get(remote.id);
    if (!local) {
      changedIds.push(remote.id);
      continue;
    }

    const differs =
      (remote.lastActivityAt || '') !== (local.lastActivityAt || '') ||
      (remote.completedQuestionCount ?? 0) !== (local.completedQuestionCount ?? 0) ||
      (remote.status || '') !== (local.status || '') ||
      Boolean(remote.userDeclaredComplete) !== Boolean(local.userDeclaredComplete) ||
      (remote.reopenedAt || '') !== (local.reopenedAt || '') ||
      (remote.closedAt || '') !== (local.closedAt || '') ||
      (remote.bookGeneratedCount ?? 0) !== (local.bookGeneratedCount ?? 0) ||
      (remote.layoutEditsUsed ?? 0) !== (local.layoutEditsUsed ?? 0) ||
      (remote.layoutEditsAllowed ?? 1) !== (local.layoutEditsAllowed ?? 1) ||
      (remote.title || '') !== (local.title || '') ||
      (remote.adminCopyNote || '') !== (local.adminCopyNote || '');

    if (differs) {
      changedIds.push(remote.id);
    }
  }

  return changedIds;
}

/**
 * Returns an ISO watermark string minus a safety overlap (default 3 minutes)
 * so incremental Firestore queries never miss slightly skewed clocks or in-flight writes.
 */
export function computeIncrementalCursorWithOverlap(
  timestamps: Array<string | undefined | null>,
  overlapMinutes: number = 3
): string | null {
  let maxMs = 0;
  for (const ts of timestamps) {
    if (!ts || typeof ts !== 'string') continue;
    const ms = new Date(ts).getTime();
    if (!Number.isNaN(ms) && ms > maxMs) {
      maxMs = ms;
    }
  }
  if (maxMs <= 0) return null;
  const adjustedMs = Math.max(0, maxMs - Math.max(0, overlapMinutes) * 60_000);
  return new Date(adjustedMs).toISOString();
}
