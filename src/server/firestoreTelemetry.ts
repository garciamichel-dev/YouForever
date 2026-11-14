import fs from 'node:fs';
import path from 'node:path';
import {
  doc,
  getDoc,
  getDocs,
  getDocFromServer,
  getCountFromServer,
  setDoc,
  deleteDoc,
  increment,
  type Firestore,
  type DocumentReference,
  type Query,
  type CollectionReference,
  type QuerySnapshot,
  type DocumentSnapshot,
} from 'firebase/firestore';
import {
  getPacificDateKey,
  computeFirestoreQuotaReport,
  type FirestoreDailyCounters,
  type FirestoreProbeSnapshot,
  type FirestoreSyncFreshness,
  type FirestoreQuotaReport,
} from '../logic/firestoreQuota.ts';

export type TelemetrySource = 'storage' | 'miEsencia' | 'probe';

interface PersistedTelemetryFile extends FirestoreDailyCounters {
  lastProbe: FirestoreProbeSnapshot | null;
  sharedCounters: { reads: number; writes: number; deletes: number } | null;
}

const TELEMETRY_FILE_PATH = path.resolve(process.cwd(), 'data', 'firestore_quota_telemetry.json');

function loadFirebaseIdentifiers(): { projectId: string; databaseId: string } {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return {
        projectId: cfg.projectId || 'balmy-smile-fc70r',
        databaseId: cfg.firestoreDatabaseId || 'ai-studio-24473850-0d4d-4247-8313-c0172221b6cb',
      };
    }
  } catch {
    // ignore
  }
  return {
    projectId: 'balmy-smile-fc70r',
    databaseId: 'ai-studio-24473850-0d4d-4247-8313-c0172221b6cb',
  };
}

function createEmptyCounters(dateKey: string): FirestoreDailyCounters {
  return {
    dateKey,
    reads: 0,
    writes: 0,
    deletes: 0,
    readsSavedByIncremental: 0,
    bySource: {
      storage: { reads: 0, writes: 0, deletes: 0 },
      miEsencia: { reads: 0, writes: 0, deletes: 0 },
      probe: { reads: 0, writes: 0, deletes: 0 },
    },
    lastUpdatedAt: new Date().toISOString(),
  };
}

class FirestoreTelemetryManager {
  private counters: FirestoreDailyCounters;
  private lastProbe: FirestoreProbeSnapshot | null = null;
  private sharedCounters: { reads: number; writes: number; deletes: number } | null = null;
  private pendingDelta = { reads: 0, writes: 0, deletes: 0 };
  private lastFlushMs = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private ids = loadFirebaseIdentifiers();

  constructor() {
    const todayKey = getPacificDateKey();
    this.counters = createEmptyCounters(todayKey);
    this.loadFromDisk();
  }

  private rollDateIfNeeded() {
    const todayKey = getPacificDateKey();
    if (this.counters.dateKey !== todayKey) {
      this.counters = createEmptyCounters(todayKey);
      this.sharedCounters = null;
      this.pendingDelta = { reads: 0, writes: 0, deletes: 0 };
      this.scheduleSaveToDisk();
    }
  }

  private loadFromDisk() {
    try {
      if (!fs.existsSync(TELEMETRY_FILE_PATH)) return;
      const raw = fs.readFileSync(TELEMETRY_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedTelemetryFile>;
      const todayKey = getPacificDateKey();
      if (parsed && parsed.dateKey === todayKey) {
        this.counters = {
          dateKey: todayKey,
          reads: Number(parsed.reads) || 0,
          writes: Number(parsed.writes) || 0,
          deletes: Number(parsed.deletes) || 0,
          readsSavedByIncremental: Number(parsed.readsSavedByIncremental) || 0,
          bySource: parsed.bySource || createEmptyCounters(todayKey).bySource,
          lastUpdatedAt: parsed.lastUpdatedAt || new Date().toISOString(),
        };
        if (parsed.lastProbe) {
          this.lastProbe = parsed.lastProbe;
        }
        if (parsed.sharedCounters) {
          this.sharedCounters = parsed.sharedCounters;
        }
      }
    } catch {
      // ignore corrupted telemetry cache
    }
  }

  private scheduleSaveToDisk() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        const dir = path.dirname(TELEMETRY_FILE_PATH);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const payload: PersistedTelemetryFile = {
          ...this.counters,
          lastProbe: this.lastProbe,
          sharedCounters: this.sharedCounters,
        };
        fs.writeFileSync(TELEMETRY_FILE_PATH, JSON.stringify(payload, null, 2), 'utf-8');
      } catch {
        // non-fatal
      }
    }, 1500);
    if (typeof this.saveTimer.unref === 'function') {
      this.saveTimer.unref();
    }
  }

  public recordReads(source: TelemetrySource, count: number, dbForFlush?: Firestore) {
    this.rollDateIfNeeded();
    const safeCount = Math.max(0, Math.floor(count));
    if (safeCount <= 0) return;
    this.counters.reads += safeCount;
    this.counters.bySource[source].reads += safeCount;
    this.counters.lastUpdatedAt = new Date().toISOString();
    this.pendingDelta.reads += safeCount;
    if (this.sharedCounters) {
      this.sharedCounters.reads = Math.max(this.sharedCounters.reads + safeCount, this.counters.reads);
    }
    this.scheduleSaveToDisk();
    if (dbForFlush) this.maybeScheduleFlush(dbForFlush);
  }

  public recordWrites(source: TelemetrySource, count: number = 1, dbForFlush?: Firestore) {
    this.rollDateIfNeeded();
    const safeCount = Math.max(0, Math.floor(count));
    if (safeCount <= 0) return;
    this.counters.writes += safeCount;
    this.counters.bySource[source].writes += safeCount;
    this.counters.lastUpdatedAt = new Date().toISOString();
    this.pendingDelta.writes += safeCount;
    if (this.sharedCounters) {
      this.sharedCounters.writes = Math.max(this.sharedCounters.writes + safeCount, this.counters.writes);
    }
    this.scheduleSaveToDisk();
    if (dbForFlush) this.maybeScheduleFlush(dbForFlush);
  }

  public recordDeletes(source: TelemetrySource, count: number = 1, dbForFlush?: Firestore) {
    this.rollDateIfNeeded();
    const safeCount = Math.max(0, Math.floor(count));
    if (safeCount <= 0) return;
    this.counters.deletes += safeCount;
    this.counters.bySource[source].deletes += safeCount;
    this.counters.lastUpdatedAt = new Date().toISOString();
    this.pendingDelta.deletes += safeCount;
    if (this.sharedCounters) {
      this.sharedCounters.deletes = Math.max(this.sharedCounters.deletes + safeCount, this.counters.deletes);
    }
    this.scheduleSaveToDisk();
    if (dbForFlush) this.maybeScheduleFlush(dbForFlush);
  }

  public recordReadsSaved(savedCount: number) {
    this.rollDateIfNeeded();
    const safeSaved = Math.max(0, Math.floor(savedCount));
    if (safeSaved <= 0) return;
    this.counters.readsSavedByIncremental += safeSaved;
    this.counters.lastUpdatedAt = new Date().toISOString();
    this.scheduleSaveToDisk();
  }

  public isQuotaError(err: any): boolean {
    const msg = String(err?.message || '').toLowerCase();
    const code = String(err?.code || '').toLowerCase();
    return (
      code.includes('resource-exhausted') ||
      msg.includes('quota limit exceeded') ||
      msg.includes('quota exceeded') ||
      msg.includes('free daily read units')
    );
  }

  private maybeScheduleFlush(db: Firestore) {
    const totalPending =
      this.pendingDelta.reads + this.pendingDelta.writes + this.pendingDelta.deletes;
    const now = Date.now();
    if (this.lastProbe?.quotaExhausted) return;
    if (totalPending >= 35 && now - this.lastFlushMs > 45_000) {
      void this.flushSharedTelemetry(db);
      return;
    }
    if (!this.flushTimer && totalPending > 0) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flushSharedTelemetry(db);
      }, 60_000);
      if (typeof this.flushTimer.unref === 'function') {
        this.flushTimer.unref();
      }
    }
  }

  public async flushSharedTelemetry(db: Firestore): Promise<void> {
    this.rollDateIfNeeded();
    const deltaReads = this.pendingDelta.reads;
    const deltaWrites = this.pendingDelta.writes;
    const deltaDeletes = this.pendingDelta.deletes;
    if (deltaReads === 0 && deltaWrites === 0 && deltaDeletes === 0) return;

    this.pendingDelta = { reads: 0, writes: 0, deletes: 0 };
    this.lastFlushMs = Date.now();
    const dateKey = this.counters.dateKey;

    try {
      await setDoc(
        doc(db, 'settings', `quotaTelemetry_${dateKey}`),
        {
          dateKey,
          reads: increment(deltaReads),
          writes: increment(deltaWrites + 1),
          deletes: increment(deltaDeletes),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      this.counters.writes += 1;
      this.counters.bySource.probe.writes += 1;
      this.scheduleSaveToDisk();
    } catch {
      // Restore pending delta if flush fails transiently
      this.pendingDelta.reads += deltaReads;
      this.pendingDelta.writes += deltaWrites;
      this.pendingDelta.deletes += deltaDeletes;
    }
  }

  public async trackedGetDocs<T = any>(
    db: Firestore,
    q: Query<T> | CollectionReference<T>,
    source: TelemetrySource = 'storage'
  ): Promise<QuerySnapshot<T>> {
    try {
      const snap = await getDocs(q);
      // Firestore charges at least 1 read for any query even if 0 docs match
      const billedReads = Math.max(1, snap.size);
      this.recordReads(source, billedReads, db);
      return snap;
    } catch (err) {
      if (this.isQuotaError(err)) {
        this.lastProbe = {
          checkedAt: new Date().toISOString(),
          healthy: false,
          quotaExhausted: true,
          latencyMs: 0,
          errorMessage: 'Se alcanzó el límite diario gratuito de Cloud Firestore.',
        };
        this.scheduleSaveToDisk();
      }
      throw err;
    }
  }

  public async trackedGetDoc<T = any>(
    db: Firestore,
    ref: DocumentReference<T>,
    source: TelemetrySource = 'storage'
  ): Promise<DocumentSnapshot<T>> {
    try {
      const snap = await getDoc(ref);
      this.recordReads(source, 1, db);
      return snap;
    } catch (err) {
      if (this.isQuotaError(err)) {
        this.lastProbe = {
          checkedAt: new Date().toISOString(),
          healthy: false,
          quotaExhausted: true,
          latencyMs: 0,
          errorMessage: 'Se alcanzó el límite diario gratuito de Cloud Firestore.',
        };
        this.scheduleSaveToDisk();
      }
      throw err;
    }
  }

  public async trackedGetCount(
    db: Firestore,
    q: Query<any> | CollectionReference<any>,
    source: TelemetrySource = 'storage'
  ): Promise<number> {
    try {
      const snap = await getCountFromServer(q);
      const count = snap.data().count || 0;
      // Firestore bills 1 read per 1,000 index entries matched (min 1)
      const billedReads = Math.max(1, Math.ceil(count / 1000));
      this.recordReads(source, billedReads, db);
      return count;
    } catch (err) {
      if (this.isQuotaError(err)) {
        this.lastProbe = {
          checkedAt: new Date().toISOString(),
          healthy: false,
          quotaExhausted: true,
          latencyMs: 0,
          errorMessage: 'Se alcanzó el límite diario gratuito de Cloud Firestore.',
        };
        this.scheduleSaveToDisk();
      }
      throw err;
    }
  }

  public async trackedSetDoc(
    db: Firestore,
    ref: DocumentReference<any>,
    data: Record<string, unknown>,
    source: TelemetrySource = 'storage',
    merge: boolean = false
  ): Promise<void> {
    await setDoc(ref, data, merge ? { merge: true } : {});
    this.recordWrites(source, 1, db);
  }

  public async trackedDeleteDoc(
    db: Firestore,
    ref: DocumentReference<any>,
    source: TelemetrySource = 'storage'
  ): Promise<void> {
    await deleteDoc(ref);
    this.recordDeletes(source, 1, db);
  }

  /**
   * Executes a lightweight 1–2 read live probe directly against Cloud Firestore server
   * to confirm connectivity, check whether free daily quota is exceeded, and load cross-instance totals.
   */
  public async probeLiveFirestoreStatus(db: Firestore): Promise<FirestoreProbeSnapshot> {
    this.rollDateIfNeeded();
    const startMs = Date.now();
    try {
      await getDocFromServer(doc(db, 'settings', 'appConfig'));
      this.recordReads('probe', 1, db);

      // Flush pending local deltas & read shared daily telemetry doc (best-effort)
      try {
        await this.flushSharedTelemetry(db);
        const sharedSnap = await getDocFromServer(
          doc(db, 'settings', `quotaTelemetry_${this.counters.dateKey}`)
        );
        this.recordReads('probe', 1, db);
        if (sharedSnap.exists()) {
          const d = sharedSnap.data() as any;
          this.sharedCounters = {
            reads: Math.max(Number(d?.reads) || 0, this.counters.reads),
            writes: Math.max(Number(d?.writes) || 0, this.counters.writes),
            deletes: Math.max(Number(d?.deletes) || 0, this.counters.deletes),
          };
        }
      } catch {
        // Shared telemetry doc optional
      }

      const probe: FirestoreProbeSnapshot = {
        checkedAt: new Date().toISOString(),
        healthy: true,
        quotaExhausted: false,
        latencyMs: Date.now() - startMs,
        errorMessage: null,
      };
      this.lastProbe = probe;
      this.scheduleSaveToDisk();
      return probe;
    } catch (err: any) {
      const exhausted = this.isQuotaError(err);
      const probe: FirestoreProbeSnapshot = {
        checkedAt: new Date().toISOString(),
        healthy: false,
        quotaExhausted: exhausted,
        latencyMs: Date.now() - startMs,
        errorMessage: exhausted
          ? 'Límite diario gratuito de lecturas de Cloud Firestore excedido (resource-exhausted).'
          : err?.message || 'Error al consultar Cloud Firestore en vivo.',
      };
      this.lastProbe = probe;
      this.scheduleSaveToDisk();
      return probe;
    }
  }

  public getReport(syncStatus: FirestoreSyncFreshness): FirestoreQuotaReport {
    this.rollDateIfNeeded();
    return computeFirestoreQuotaReport({
      projectId: this.ids.projectId,
      databaseId: this.ids.databaseId,
      counters: {
        ...this.counters,
        bySource: {
          storage: { ...this.counters.bySource.storage },
          miEsencia: { ...this.counters.bySource.miEsencia },
          probe: { ...this.counters.bySource.probe },
        },
      },
      sharedCounters: this.sharedCounters ? { ...this.sharedCounters } : null,
      probe: this.lastProbe,
      syncStatus,
    });
  }
}

export const firestoreTelemetry = new FirestoreTelemetryManager();
