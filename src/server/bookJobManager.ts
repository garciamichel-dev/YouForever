import fs from 'fs';
import path from 'path';
import type {
  BookGenerationReasonCode,
  DemoInMemoryPhoto,
  DemoManuscript,
  DemoNarrativeStyleId,
} from '../logic/demoStoryRules.ts';
import type { BookAiProvider } from '../logic/interviewRules.ts';
import type {
  BookBatchCheckpointPayload,
  BookGenerationProgressEvent,
} from './geminiService.ts';

export interface BookJobResultPayload {
  manuscript: DemoManuscript;
  chapterPhotos: Record<string, DemoInMemoryPhoto | null>;
  allPhotosById?: Record<string, DemoInMemoryPhoto>;
  closingPageText: string;
  scope: 'preview' | 'full';
  providerUsed?: BookAiProvider;
  modelUsed?: string;
  providerFallbackNotice?: string;
  compilationPdfId?: string;
  compilationPdfSha256?: string;
  cachedContextUsed?: boolean;
  activePromptVersionId?: string;
  internalReasonCode?: BookGenerationReasonCode;
  diagnosticSummary?: string;
  batchesCompleted?: number;
  totalBatches?: number;
}

export type BookJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'incomplete'
  | 'failed'
  | 'cancelled';

export interface BookGenerationJobRecord {
  jobId: string;
  jobKey: string;
  interviewId: string;
  participantId?: string;
  narrativeStyle: DemoNarrativeStyleId;
  scope: 'preview' | 'full';
  status: BookJobStatus;
  phase: BookGenerationProgressEvent['phase'] | 'done' | 'error' | 'cancelled';
  currentBatch: number;
  totalBatches: number;
  completedBatches: number;
  repairPass: number;
  repairedChapters: number;
  totalRepairChapters: number;
  userMessage: string;
  batchCheckpoints: Record<string, BookBatchCheckpointPayload>;
  internalReasonCode?: BookGenerationReasonCode;
  diagnosticSummary?: string;
  result?: BookJobResultPayload;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ParticipantBookJobView {
  jobId: string;
  interviewId: string;
  narrativeStyle: DemoNarrativeStyleId;
  scope: 'preview' | 'full';
  status: BookJobStatus;
  phase: BookGenerationJobRecord['phase'];
  currentBatch: number;
  totalBatches: number;
  completedBatches: number;
  repairPass: number;
  repairedChapters: number;
  totalRepairChapters: number;
  userMessage: string;
  result?: Omit<BookJobResultPayload, 'internalReasonCode' | 'diagnosticSummary'> & {
    manuscript: Omit<DemoManuscript, 'internalReasonCode' | 'diagnosticSummary'>;
  };
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BookJobExecutionHooks {
  onProgress: (event: BookGenerationProgressEvent) => void;
  initialBatchCheckpoints: Record<string, BookBatchCheckpointPayload>;
  onBatchCheckpoint: (batchIdx: number, checkpoint: BookBatchCheckpointPayload) => void;
  isCancelled: () => boolean;
}

export type BookJobExecutor = (hooks: BookJobExecutionHooks) => Promise<BookJobResultPayload>;

export function sanitizeManuscriptForParticipant(
  manuscript: DemoManuscript
): Omit<DemoManuscript, 'internalReasonCode' | 'diagnosticSummary'> {
  if (!manuscript || typeof manuscript !== 'object') return manuscript;
  const { internalReasonCode: _code, diagnosticSummary: _diag, ...rest } = manuscript as any;
  return rest;
}

export function sanitizeBookResultForParticipant(
  result: BookJobResultPayload
): Omit<BookJobResultPayload, 'internalReasonCode' | 'diagnosticSummary'> & {
  manuscript: Omit<DemoManuscript, 'internalReasonCode' | 'diagnosticSummary'>;
} {
  const {
    internalReasonCode: _code,
    diagnosticSummary: _diag,
    manuscript,
    ...rest
  } = result;
  return {
    ...rest,
    manuscript: sanitizeManuscriptForParticipant(manuscript),
  };
}

export function toParticipantBookJobView(job: BookGenerationJobRecord): ParticipantBookJobView {
  return {
    jobId: job.jobId,
    interviewId: job.interviewId,
    narrativeStyle: job.narrativeStyle,
    scope: job.scope,
    status: job.status,
    phase: job.phase,
    currentBatch: job.currentBatch,
    totalBatches: job.totalBatches,
    completedBatches: job.completedBatches,
    repairPass: job.repairPass,
    repairedChapters: job.repairedChapters,
    totalRepairChapters: job.totalRepairChapters,
    userMessage: job.userMessage,
    result: job.result ? sanitizeBookResultForParticipant(job.result) : undefined,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export class BookGenerationJobManager {
  private readonly persistPath: string;
  private jobs: Map<string, BookGenerationJobRecord> = new Map();
  private activeJobByKey: Map<string, string> = new Map();
  private runningWorkers: Map<string, Promise<void>> = new Map();
  private cancelledJobIds: Set<string> = new Set();
  private hydrated = false;

  constructor(persistPath = path.join(process.cwd(), 'data', 'book_generation_jobs.json')) {
    this.persistPath = persistPath;
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      if (!fs.existsSync(this.persistPath)) return;
      const raw = fs.readFileSync(this.persistPath, 'utf-8');
      if (!raw || !raw.trim()) return;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.jobs)) {
        for (const job of parsed.jobs as BookGenerationJobRecord[]) {
          if (job && job.jobId) {
            this.jobs.set(job.jobId, job);
          }
        }
      }
    } catch (err) {
      console.warn('[BookJobManager] Could not hydrate persisted jobs:', (err as Error)?.message || err);
    }
  }

  private persistToDisk(): void {
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Retain the 60 most recent jobs to keep disk file compact
      const sorted = Array.from(this.jobs.values()).sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      const compactJobs = sorted.slice(0, 60);
      const tempPath = `${this.persistPath}.tmp.${process.pid}.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify({ jobs: compactJobs }, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.persistPath);
    } catch (err) {
      console.warn('[BookJobManager] Could not persist jobs:', (err as Error)?.message || err);
    }
  }

  public static buildJobKey(
    interviewId: string,
    narrativeStyle: DemoNarrativeStyleId,
    scope: 'preview' | 'full'
  ): string {
    return `${interviewId}::${narrativeStyle}::${scope}`;
  }

  public getJob(jobId: string): BookGenerationJobRecord | null {
    this.ensureHydrated();
    return this.jobs.get(jobId) || null;
  }

  public findLatestJobForInterview(params: {
    interviewId: string;
    narrativeStyle?: DemoNarrativeStyleId;
    scope?: 'preview' | 'full';
  }): BookGenerationJobRecord | null {
    this.ensureHydrated();
    const candidates = Array.from(this.jobs.values())
      .filter((j) => {
        if (j.interviewId !== params.interviewId) return false;
        if (params.narrativeStyle && j.narrativeStyle !== params.narrativeStyle) return false;
        if (params.scope && j.scope !== params.scope) return false;
        return true;
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    // Prefer an active running/queued job if any
    const active = candidates.find(
      (j) =>
        (j.status === 'running' || j.status === 'queued') &&
        (this.runningWorkers.has(j.jobId) || Object.keys(j.batchCheckpoints || {}).length > 0)
    );
    return active || candidates[0] || null;
  }

  public cancelJob(jobId: string): BookGenerationJobRecord | null {
    this.ensureHydrated();
    const job = this.jobs.get(jobId);
    if (!job) return null;
    this.cancelledJobIds.add(jobId);
    if (job.status === 'running' || job.status === 'queued') {
      job.status = 'cancelled';
      job.phase = 'cancelled';
      job.userMessage = 'Preparación pausada por el usuario. Tus recuerdos permanecen guardados.';
      job.updatedAt = new Date().toISOString();
      this.jobs.set(jobId, job);
      if (this.activeJobByKey.get(job.jobKey) === jobId) {
        this.activeJobByKey.delete(job.jobKey);
      }
      this.persistToDisk();
    }
    return job;
  }

  public async waitForJob(jobId: string): Promise<BookGenerationJobRecord | null> {
    const worker = this.runningWorkers.get(jobId);
    if (worker) {
      await worker;
    }
    return this.getJob(jobId);
  }

  public startOrResumeJob(params: {
    interviewId: string;
    participantId?: string;
    narrativeStyle: DemoNarrativeStyleId;
    scope: 'preview' | 'full';
    forceRefresh?: boolean;
    executor: BookJobExecutor;
    onJobSettled?: (job: BookGenerationJobRecord) => Promise<void> | void;
  }): BookGenerationJobRecord {
    this.ensureHydrated();
    const jobKey = BookGenerationJobManager.buildJobKey(
      params.interviewId,
      params.narrativeStyle,
      params.scope
    );

    // 1. If a worker is actively running for this exact key:
    const activeJobId = this.activeJobByKey.get(jobKey);
    if (activeJobId && !params.forceRefresh) {
      const existingActive = this.jobs.get(activeJobId);
      if (
        existingActive &&
        (existingActive.status === 'running' || existingActive.status === 'queued') &&
        this.runningWorkers.has(activeJobId)
      ) {
        return existingActive;
      }
    }

    // 2. If forceRefresh, cancel any prior active job for this key and start clean
    if (params.forceRefresh && activeJobId) {
      this.cancelJob(activeJobId);
    }

    // 3. Check if there is an interrupted/paused job with saved batchCheckpoints to resume seamlessly
    let inheritedCheckpoints: Record<string, BookBatchCheckpointPayload> = {};
    if (!params.forceRefresh) {
      const priorCandidates = Array.from(this.jobs.values())
        .filter((j) => j.jobKey === jobKey)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      const resumable = priorCandidates[0];
      if (
        resumable &&
        (resumable.status === 'running' ||
          resumable.status === 'queued' ||
          resumable.status === 'failed' ||
          resumable.status === 'incomplete') &&
        resumable.batchCheckpoints &&
        Object.keys(resumable.batchCheckpoints).length > 0
      ) {
        inheritedCheckpoints = { ...resumable.batchCheckpoints };
      }
    }

    const now = new Date().toISOString();
    const jobId = `bjob_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const resumedBatchCount = Object.keys(inheritedCheckpoints).length;
    const job: BookGenerationJobRecord = {
      jobId,
      jobKey,
      interviewId: params.interviewId,
      participantId: params.participantId,
      narrativeStyle: params.narrativeStyle,
      scope: params.scope,
      status: 'running',
      phase: 'preparing_sources',
      currentBatch: resumedBatchCount,
      totalBatches: 0,
      completedBatches: resumedBatchCount,
      repairPass: 0,
      repairedChapters: 0,
      totalRepairChapters: 0,
      userMessage:
        resumedBatchCount > 0
          ? 'Retomando la preparación de tu libro desde el último avance guardado...'
          : 'Reuniendo y ordenando tus recuerdos y fotografías...',
      batchCheckpoints: inheritedCheckpoints,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(jobId, job);
    this.activeJobByKey.set(jobKey, jobId);
    this.persistToDisk();

    const workerPromise = (async () => {
      try {
        const result = await params.executor({
          initialBatchCheckpoints: { ...job.batchCheckpoints },
          isCancelled: () => this.cancelledJobIds.has(jobId),
          onProgress: (ev) => {
            if (this.cancelledJobIds.has(jobId)) return;
            job.phase = ev.phase;
            if (typeof ev.currentBatch === 'number') job.currentBatch = ev.currentBatch;
            if (typeof ev.totalBatches === 'number') job.totalBatches = ev.totalBatches;
            if (typeof ev.completedBatches === 'number') job.completedBatches = ev.completedBatches;
            if (typeof ev.repairPass === 'number') job.repairPass = ev.repairPass;
            if (typeof ev.repairedChapters === 'number') job.repairedChapters = ev.repairedChapters;
            if (typeof ev.totalRepairChapters === 'number') {
              job.totalRepairChapters = ev.totalRepairChapters;
            }
            if (ev.userMessage) job.userMessage = ev.userMessage;
            job.updatedAt = new Date().toISOString();
            this.jobs.set(jobId, job);
          },
          onBatchCheckpoint: (batchIdx, checkpoint) => {
            if (this.cancelledJobIds.has(jobId)) return;
            job.batchCheckpoints[String(batchIdx)] = checkpoint;
            job.completedBatches = Math.max(
              job.completedBatches,
              Object.keys(job.batchCheckpoints).length
            );
            job.updatedAt = new Date().toISOString();
            this.jobs.set(jobId, job);
            this.persistToDisk();
          },
        });

        if (this.cancelledJobIds.has(jobId)) {
          job.status = 'cancelled';
          job.phase = 'cancelled';
          job.updatedAt = new Date().toISOString();
          this.jobs.set(jobId, job);
          this.persistToDisk();
          return;
        }

        const isIncomplete =
          result.manuscript?.generationStatus === 'incomplete_draft' ||
          result.manuscript?.status === 'incomplete_draft';

        job.status = isIncomplete ? 'incomplete' : 'completed';
        job.phase = 'done';
        if (typeof result.batchesCompleted === 'number') {
          job.completedBatches = result.batchesCompleted;
        }
        if (typeof result.totalBatches === 'number') {
          job.totalBatches = result.totalBatches;
        }
        job.internalReasonCode =
          result.internalReasonCode || result.manuscript?.internalReasonCode;
        job.diagnosticSummary =
          result.diagnosticSummary || result.manuscript?.diagnosticSummary;
        job.userMessage = isIncomplete
          ? 'Tu borrador preliminar está listo para revisión.'
          : '¡Tu libro ha sido preparado y verificado con éxito!';
        job.result = result;
        job.updatedAt = new Date().toISOString();
        this.jobs.set(jobId, job);
        this.persistToDisk();

        if (params.onJobSettled) {
          await params.onJobSettled(job);
        }
      } catch (err: any) {
        if (this.cancelledJobIds.has(jobId)) {
          job.status = 'cancelled';
          job.phase = 'cancelled';
        } else {
          job.status = 'failed';
          job.phase = 'error';
          job.error =
            'Ocurrió un inconveniente temporal al preparar tu libro. Puedes intentarlo de nuevo y continuaremos desde donde avanzamos.';
          job.internalReasonCode = 'PROVIDER_ERROR';
          job.diagnosticSummary = String(err?.message || err || 'Error desconocido en tarea de libro.');
          job.userMessage = job.error;
        }
        job.updatedAt = new Date().toISOString();
        this.jobs.set(jobId, job);
        this.persistToDisk();

        if (params.onJobSettled) {
          await params.onJobSettled(job);
        }
      } finally {
        this.runningWorkers.delete(jobId);
        if (this.activeJobByKey.get(jobKey) === jobId) {
          this.activeJobByKey.delete(jobKey);
        }
      }
    })();

    this.runningWorkers.set(jobId, workerPromise);
    return job;
  }
}

export const bookJobManager = new BookGenerationJobManager();
