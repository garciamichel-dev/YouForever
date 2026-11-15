import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  query,
  where,
  setLogLevel,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { firestoreTelemetry } from './firestoreTelemetry.ts';
import {
  detectChangedInterviewIds,
  computeIncrementalCursorWithOverlap,
  type FirestoreSyncFreshness,
} from '../logic/firestoreQuota.ts';
import {
  AppConfig,
  INITIAL_APP_CONFIG,
  BookAiProvider,
  BookStructureMode,
  LiteraryPromptStyleId,
  LiteraryPromptVersion,
  LiteraryStylePromptConfig,
  DEFAULT_LITERARY_PROMPTS_TEXT,
  DEFAULT_LITERARY_PROMPT_VERSIONS,
  DEFAULT_LITERARY_PROMPTS_CONFIG,
  InterviewRecord,
  ParticipantRecord,
  InterviewTokenRecord,
  AnswerRecord,
  AnswerPhotoAttachment,
  InterviewPhotoRecord,
  IncomingPhotoInput,
  AnswerVoiceAttachment,
  InterviewAudioRecord,
  IncomingAudioInput,
  QuestionRecord,
  generateInvitationToken,
  hashToken,
  deriveDeterministicAccessCode,
  deriveDeterministicPlainToken,
  extractCleanTokenOrCode,
  matchTokenRecord,
  canSubmitAnswer,
  isTokenActive,
  evaluateAnswerIncrement,
  applyVoluntaryCompletion,
  applyAdminExtension,
  applyAdminReopen,
  computeLayoutEditQuotaStatus,
  isSufficiencyThresholdMet,
  validatePhotoAttachments,
  ensurePhotosPlacedInManuscript,
  buildDefaultAdminCopyNote,
  sortInterviewsWithCopies,
  mergeInterviewRecordNonDestructive,
  mergeAnswerRecordNonDestructive,
} from '../logic/interviewRules.ts';
import {
  MiEsenciaArchivedCompilationPdf,
  validateCompilationPdfRecord,
} from '../logic/miEsenciaRules.ts';
import {
  BookFailureCategory,
  BookGenerationReasonCode,
  ComposedChapterSectionBlock,
  DemoEditorialConfig,
  DemoInMemoryPhoto,
  DemoManuscript,
  DemoNarrativeStyleId,
  ParticipantBookVersionRecord,
  auditAndApproveBookManuscript,
  buildIncompleteDraftUserNotice,
  buildSafeDemoPdfFilename,
  buildParticipantInitialManuscriptFromAnswers,
  composeBookPages,
  hasUpdatedAnswersSinceBookVersion,
  repairManuscriptOmissions,
} from '../logic/demoStoryRules.ts';
import {
  PrivacyConsentRecord,
  BookShareRecord,
  ScheduledDeliveryRecord,
  SecondaryAccessRecord,
  PostMortemInstructionRecord,
  ArcoRequestRecord,
  computeSha256,
  buildConsentDeclarationText,
  validateConsentSubmission,
  isConsentValid,
  validateBookShare,
} from '../logic/privacyRules.ts';
import {
  PRIVACY_NOTICE_VERSION,
  PRIVACY_NOTICE_EFFECTIVE_DATE,
  SIMPLIFIED_PRIVACY_NOTICE,
  COMPREHENSIVE_PRIVACY_NOTICE,
} from '../logic/privacyNoticeContent.ts';
import {
  FreeRegistrationPayload,
  validateFreeRegistrationPayload,
  AdminParticipantRegistrationUpdate,
  validateAdminRegistrationUpdates,
} from '../logic/freeRegistration.ts';
import { DEFAULT_QUESTIONS } from './seedData.ts';
import { buildCompleteTestStories } from './seedStories.ts';
import {
  evaluateNarrativeSufficiency,
  generateAdaptiveFollowUp,
  generateManuscriptDraft,
  generateParticipantBookManuscriptWithAI,
  analyzeAndTranscribeAudioWithGemini,
  AudioQualityStatus,
  BookBatchCheckpointPayload,
  BookGenerationProgressEvent,
  auditWithHybridSemantics,
  classifyBookFailureReasonCode,
  ParsedAiManuscriptBatchResponse,
  SemanticJudgeFunction,
} from './geminiService.ts';
import {
  computeBookGenerationFingerprint,
  computeBookSourceFingerprint,
  computeManuscriptContentHash,
  issueBookApprovalEvidence,
  verifyBookApprovalEvidence,
} from './bookApproval.ts';
import {
  bookJobManager,
  BookGenerationJobRecord,
} from './bookJobManager.ts';

try {
  setLogLevel('error');
} catch {
  // Ignore in case setLogLevel is not supported in current environment
}

const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const serverDb = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

function sanitizeForFirestore<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export interface AuditLogRecord {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  performedBy: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface ManuscriptRecord {
  id: string;
  interviewId: string;
  version: number;
  title: string;
  summary: string;
  content: string;
  status: 'draft' | 'approved' | 'exported' | 'incomplete_draft';
  isPartialMemoir?: boolean;
  incompleteDraftNotice?: string;
  internalReasonCode?: BookGenerationReasonCode;
  diagnosticSummary?: string;
  documentaryAudit?: any;
  editorialAudit?: any;
  generatedAt: string;
  generatedBy: string;
}

export interface PersistedTokenRecord extends InterviewTokenRecord {
  plainToken?: string;
}

interface QuestionnaireVersionDoc {
  id: string;
  questions: QuestionRecord[];
  createdAt: string;
}

/**
 * V5.2 — Remote document store behind `persistDoc` / `removeDoc` (Cloud Firestore in production).
 * The local snapshot on disk remains the primary copy; remote writes stay best-effort.
 */
export interface StorageRemoteDocStore {
  setDoc(collectionName: string, docId: string, data: Record<string, unknown>): Promise<void>;
  deleteDoc(collectionName: string, docId: string): Promise<void>;
}

const firestoreRemoteDocStore: StorageRemoteDocStore = {
  async setDoc(collectionName, docId, data) {
    await firestoreTelemetry.trackedSetDoc(serverDb, doc(serverDb, collectionName, docId), data, 'storage');
  },
  async deleteDoc(collectionName, docId) {
    await firestoreTelemetry.trackedDeleteDoc(serverDb, doc(serverDb, collectionName, docId), 'storage');
  },
};

/**
 * V5.2 — Optional injection points for the book engine's AI calls. Production never sets them;
 * automated tests use them to run the REAL generation, audit and save code with simulated
 * providers (no Gemini/OpenAI calls, no tokens).
 */
export interface StorageBookAiOverrides {
  draftBatch?: (ctx: {
    batchIdx: number;
    totalBatches: number;
    batchChapters: any[];
    narrativeStyle: DemoNarrativeStyleId;
  }) => Promise<BookBatchCheckpointPayload>;
  aiJudge?: SemanticJudgeFunction;
  repairBatchCaller?: (
    batchPrompt: string,
    systemPrompt: string,
    batchTaskIds: string[]
  ) => Promise<ParsedAiManuscriptBatchResponse | null>;
  skipDiskCache?: boolean;
  /**
   * Supplies the Compilado Testimonial Fidedigno record instead of Mi Esencia's store, which
   * reads and writes Cloud Firestore. Only for isolated tests.
   */
  compilationPdfProvider?: (interviewId: string) => Promise<MiEsenciaArchivedCompilationPdf>;
}

export interface StorageManagerOptions {
  remoteDocStore?: StorageRemoteDocStore;
  bookAiOverrides?: StorageBookAiOverrides;
}

export class StorageManager {
  private remoteDocStore: StorageRemoteDocStore;
  private bookAiOverrides?: StorageBookAiOverrides;

  /**
   * V5.2 — Puts this instance in isolated test mode: remote writes go to `remoteDocStore` and the
   * book engine's AI calls to `bookAiOverrides`. Refused unless the process explicitly opts in with
   * `YOUFOREVER_ALLOW_TEST_DOUBLES=1`, so production can never be switched to simulated providers.
   */
  public configureTestDoubles(options: StorageManagerOptions): void {
    if (process.env.YOUFOREVER_ALLOW_TEST_DOUBLES !== '1') {
      throw new Error('configureTestDoubles solo está permitido en pruebas automatizadas.');
    }
    if (options.remoteDocStore) this.remoteDocStore = options.remoteDocStore;
    this.bookAiOverrides = options.bookAiOverrides;
  }

  private config: AppConfig = { ...INITIAL_APP_CONFIG };
  private questions: Map<string, QuestionRecord> = new Map();
  private questionnaireVersions: Map<string, QuestionRecord[]> = new Map();
  private interviews: Map<string, InterviewRecord> = new Map();
  private participants: Map<string, ParticipantRecord> = new Map();
  private tokens: Map<string, PersistedTokenRecord> = new Map(); // key = tokenHash
  private plainTokenMap: Map<string, string> = new Map(); // plainToken -> tokenHash
  private accessCodeMap: Map<string, string> = new Map(); // accessCode (UPPERCASE) -> tokenHash
  private answers: Map<string, AnswerRecord> = new Map();
  private photos: Map<string, InterviewPhotoRecord> = new Map();
  private audios: Map<string, InterviewAudioRecord> = new Map();
  private manuscripts: Map<string, ManuscriptRecord> = new Map();
  private auditLogs: AuditLogRecord[] = [];
  private admins: Set<string> = new Set([
    'garcia.michel@gmail.com',
    'youforever.team@gmail.com',
  ]);

  // Privacy and Interviewee Admin entities
  private privacyConsents: Map<string, PrivacyConsentRecord> = new Map();
  private bookShares: Map<string, BookShareRecord> = new Map();
  private scheduledDeliveries: Map<string, ScheduledDeliveryRecord> = new Map();
  private secondaryAccess: Map<string, SecondaryAccessRecord> = new Map();
  private postMortemInstructions: Map<string, PostMortemInstructionRecord> = new Map();
  private arcoRequests: Map<string, ArcoRequestRecord> = new Map();
  private participantBookVersions: Map<string, ParticipantBookVersionRecord> = new Map();
  private deletedBookVersionIds: Set<string> = new Set();

  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private coreSyncPromise: Promise<void> | null = null;
  private activeSyncPromise: Promise<void> | null = null;
  private listenersAttached = false;
  private lastFirestoreCoreSyncMs = 0;
  private syncWatermarks: {
    fullBaselineSyncedAt: string | null;
    answersUpdatedAtCursor: string | null;
    questionsSyncedAt: string | null;
    auditLogsCursor: string | null;
    lastSyncMode: 'incremental' | 'full' | null;
  } = {
    fullBaselineSyncedAt: null,
    answersUpdatedAtCursor: null,
    questionsSyncedAt: null,
    auditLogsCursor: null,
    lastSyncMode: null,
  };
  private firestoreSyncStatus: {
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    quotaExhausted: boolean;
    quotaExhaustedAtMs: number;
    source: 'firestore' | 'disk_cache';
    syncedRemoteInterviewsCount: number;
  } = {
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    quotaExhausted: false,
    quotaExhaustedAtMs: 0,
    source: 'disk_cache',
    syncedRemoteInterviewsCount: 0,
  };

  public isAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    return this.admins.has(email.toLowerCase().trim());
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  public getFirestoreSyncStatus(): FirestoreSyncFreshness {
    return {
      lastAttemptAt: this.firestoreSyncStatus.lastAttemptAt,
      lastSuccessAt: this.firestoreSyncStatus.lastSuccessAt,
      lastError: this.firestoreSyncStatus.lastError,
      quotaExhausted: this.firestoreSyncStatus.quotaExhausted,
      source: this.firestoreSyncStatus.source,
      syncedRemoteInterviewsCount: this.firestoreSyncStatus.syncedRemoteInterviewsCount,
      localInterviewsCount: this.interviews.size,
      lastSyncMode: this.syncWatermarks.lastSyncMode,
      answersCursor: this.syncWatermarks.answersUpdatedAtCursor,
      questionsSyncedAt: this.syncWatermarks.questionsSyncedAt,
    };
  }

  public getAdmins(): string[] {
    return Array.from(this.admins);
  }

  constructor(options: StorageManagerOptions = {}) {
    this.remoteDocStore = options.remoteDocStore || firestoreRemoteDocStore;
    this.bookAiOverrides = options.bookAiOverrides;
    this.initDefaultDataInMemory();
  }

  private initDefaultDataInMemory() {
    for (const q of DEFAULT_QUESTIONS) {
      this.questions.set(q.id, { ...q });
    }
    this.questionnaireVersions.set('v1_initial', Array.from(this.questions.values()));
  }

  private sanitizeDocForFirestore<T>(data: T): Record<string, unknown> {
    const cleaned = sanitizeForFirestore(data) as any;

    const stripOversizedStrings = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) {
        return obj.map(stripOversizedStrings);
      }
      const result: Record<string, any> = {};
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (
          typeof val === 'string' &&
          val.length > 50_000 &&
          (val.startsWith('data:') || key.toLowerCase().includes('dataurl') || key.toLowerCase().includes('base64'))
        ) {
          result[key] = '';
          result[`${key}_storedSeparately`] = true;
        } else if (typeof val === 'object' && val !== null) {
          result[key] = stripOversizedStrings(val);
        } else {
          result[key] = val;
        }
      }
      return result;
    };

    return stripOversizedStrings(cleaned);
  }

  private getSnapshotFilePath(): string {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    return path.join(dataDir, 'storage_state.json');
  }

  /**
   * Writes the local snapshot. V5.2: written to a temporary file and renamed, so a crash or a
   * full disk can never leave a half-written (corrupt) snapshot, and returns whether it succeeded
   * so callers that need an all-or-nothing save can roll back.
   */
  private saveStateToDisk(): boolean {
    try {
      const filePath = this.getSnapshotFilePath();
      const snapshot = {
        savedAt: new Date().toISOString(),
        config: this.config,
        questions: Array.from(this.questions.values()),
        interviews: Array.from(this.interviews.values()),
        participants: Array.from(this.participants.values()),
        tokens: Array.from(this.tokens.values()),
        answers: Array.from(this.answers.values()).map((a) => ({
          ...a,
          photos: Array.isArray(a.photos)
            ? a.photos.map((p) => {
                const rawUrl = (p as any).dataUrl;
                return {
                  ...p,
                  ...(typeof rawUrl === 'string' && rawUrl.length < 30_000
                    ? { dataUrl: rawUrl }
                    : {}),
                };
              })
            : a.photos,
        })),
        photos: Array.from(this.photos.values()).map((p) => ({
          ...p,
          dataUrl: p.dataUrl && p.dataUrl.length < 750_000 ? p.dataUrl : '',
        })),
        audios: Array.from(this.audios.values()).map((a) => ({
          ...a,
          audioDataUrl: a.audioDataUrl && a.audioDataUrl.length < 50_000 ? a.audioDataUrl : '',
        })),
        manuscripts: Array.from(this.manuscripts.values()),
        auditLogs: this.auditLogs.slice(0, 200),
        privacyConsents: Array.from(this.privacyConsents.values()),
        bookShares: Array.from(this.bookShares.values()),
        scheduledDeliveries: Array.from(this.scheduledDeliveries.values()),
        secondaryAccess: Array.from(this.secondaryAccess.values()),
        postMortemInstructions: Array.from(this.postMortemInstructions.values()),
        arcoRequests: Array.from(this.arcoRequests.values()),
        participantBookVersions: Array.from(this.participantBookVersions.values()),
        deletedBookVersionIds: Array.from(this.deletedBookVersionIds),
        syncWatermarks: this.syncWatermarks,
      };
      const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
      try {
        fs.writeFileSync(tempPath, JSON.stringify(snapshot, null, 2), 'utf-8');
        fs.renameSync(tempPath, filePath);
      } catch (writeErr) {
        try {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch {
          // ignore cleanup errors
        }
        throw writeErr;
      }
      return true;
    } catch (err) {
      console.warn('[StorageManager] Could not save state snapshot to disk:', err);
      return false;
    }
  }

  private loadStateFromDisk(): boolean {
    try {
      const filePath = this.getSnapshotFilePath();
      if (!fs.existsSync(filePath)) return false;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return false;

      if (parsed.config) {
        this.config = {
          ...INITIAL_APP_CONFIG,
          ...parsed.config,
          literaryPrompts: {
            ...DEFAULT_LITERARY_PROMPTS_CONFIG,
            ...(parsed.config.literaryPrompts || {}),
          },
          literaryPromptVersions:
            Array.isArray(parsed.config.literaryPromptVersions) &&
            parsed.config.literaryPromptVersions.length > 0
              ? parsed.config.literaryPromptVersions
              : [...DEFAULT_LITERARY_PROMPT_VERSIONS],
        };
      }
      if (Array.isArray(parsed.questions)) {
        for (const q of parsed.questions) {
          if (q && q.id) this.questions.set(q.id, q);
        }
      }
      if (Array.isArray(parsed.interviews)) {
        for (const inv of parsed.interviews) {
          if (inv && inv.id) this.interviews.set(inv.id, inv);
        }
      }
      if (Array.isArray(parsed.participants)) {
        for (const part of parsed.participants) {
          if (part && part.id) this.participants.set(part.id, part);
        }
      }
      if (Array.isArray(parsed.tokens)) {
        for (const tok of parsed.tokens) {
          if (tok && tok.tokenHash) this.registerTokenInMemory(tok);
        }
      }
      if (Array.isArray(parsed.answers)) {
        for (const ans of parsed.answers) {
          if (ans && ans.id) this.answers.set(ans.id, ans);
        }
      }
      if (Array.isArray(parsed.photos)) {
        for (const ph of parsed.photos) {
          if (ph && ph.id) this.photos.set(ph.id, ph);
        }
      }
      if (Array.isArray(parsed.audios)) {
        for (const aud of parsed.audios) {
          if (aud && aud.id) this.audios.set(aud.id, aud);
        }
      }
      if (Array.isArray(parsed.manuscripts)) {
        for (const manu of parsed.manuscripts) {
          if (manu && manu.id) this.manuscripts.set(manu.id, manu);
        }
      }
      if (Array.isArray(parsed.auditLogs)) {
        this.auditLogs = parsed.auditLogs;
      }
      if (Array.isArray(parsed.privacyConsents)) {
        for (const c of parsed.privacyConsents) {
          if (c && c.id) this.privacyConsents.set(c.id, c);
        }
      }
      if (Array.isArray(parsed.bookShares)) {
        for (const s of parsed.bookShares) {
          if (s && s.id) this.bookShares.set(s.id, s);
        }
      }
      if (Array.isArray(parsed.scheduledDeliveries)) {
        for (const d of parsed.scheduledDeliveries) {
          if (d && d.id) this.scheduledDeliveries.set(d.id, d);
        }
      }
      if (Array.isArray(parsed.secondaryAccess)) {
        for (const sa of parsed.secondaryAccess) {
          if (sa && sa.id) this.secondaryAccess.set(sa.id, sa);
        }
      }
      if (Array.isArray(parsed.postMortemInstructions)) {
        for (const pmi of parsed.postMortemInstructions) {
          if (pmi && pmi.id) this.postMortemInstructions.set(pmi.id, pmi);
        }
      }
      if (Array.isArray(parsed.arcoRequests)) {
        for (const ar of parsed.arcoRequests) {
          if (ar && ar.id) this.arcoRequests.set(ar.id, ar);
        }
      }
      if (Array.isArray(parsed.deletedBookVersionIds)) {
        for (const delId of parsed.deletedBookVersionIds) {
          if (typeof delId === 'string' && delId.trim()) {
            this.deletedBookVersionIds.add(delId.trim());
          }
        }
      }
      if (Array.isArray(parsed.participantBookVersions)) {
        for (const bv of parsed.participantBookVersions) {
          if (
            bv &&
            bv.id &&
            !this.deletedBookVersionIds.has(bv.id) &&
            !this.deletedBookVersionIds.has(`pbv_${bv.interviewId}_v${bv.versionNumber}`)
          ) {
            this.participantBookVersions.set(bv.id, bv);
          }
        }
      }
      if (parsed.syncWatermarks && typeof parsed.syncWatermarks === 'object') {
        this.syncWatermarks = {
          fullBaselineSyncedAt: parsed.syncWatermarks.fullBaselineSyncedAt || null,
          answersUpdatedAtCursor: parsed.syncWatermarks.answersUpdatedAtCursor || null,
          questionsSyncedAt: parsed.syncWatermarks.questionsSyncedAt || null,
          auditLogsCursor: parsed.syncWatermarks.auditLogsCursor || null,
          lastSyncMode: parsed.syncWatermarks.lastSyncMode || null,
        };
      }
      return true;
    } catch (err) {
      console.warn('[StorageManager] Could not load state snapshot from disk:', err);
      return false;
    }
  }

  private async persistDoc<T>(collectionName: string, docId: string, data: T): Promise<void> {
    this.saveStateToDisk();
    await this.persistRemoteDoc(collectionName, docId, data);
  }

  /** Best-effort remote write (the local snapshot is the primary copy). */
  private async persistRemoteDoc<T>(collectionName: string, docId: string, data: T): Promise<void> {
    try {
      const sanitized = this.sanitizeDocForFirestore(data);
      (sanitized as Record<string, unknown>)._syncedAt = new Date().toISOString();
      const serialized = JSON.stringify(sanitized);
      const byteSize = Buffer.byteLength(serialized, 'utf8');

      // Firestore strict document limit is 1,048,576 bytes.
      // If a document exceeds 800 KB, skip the remote write to prevent GrpcConnection RPC stream crash.
      if (byteSize > 800_000) {
        console.warn(
          `[Firestore Size Guard] Document ${collectionName}/${docId} (${byteSize} bytes) exceeds safe Firestore write limit. Skipping remote write to prevent GrpcConnection RPC stream crash. Document remains safely cached in memory and on disk.`
        );
        return;
      }

      const setPromise = this.remoteDocStore.setDoc(
        collectionName,
        docId,
        sanitized as Record<string, unknown>
      );
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Firestore write timed out (retained on disk)')), 2500)
      );
      await Promise.race([setPromise, timeoutPromise]);
    } catch (err: any) {
      if (err?.message?.includes('Quota limit exceeded') || err?.code === 'resource-exhausted') {
        console.warn(`[Firestore Quota] Write skipped for ${collectionName}/${docId} due to daily limit. Stored in memory and disk.`);
      } else if (err?.message?.includes('exceeds the limit') || err?.code === 3) {
        console.warn(`[Firestore Payload Warning] Write skipped for ${collectionName}/${docId} due to size limit (${err?.message}). Retained safely on server.`);
      } else {
        console.warn(`[Firestore Persistence Note] Document ${collectionName}/${docId} saved locally:`, err?.message || err);
      }
    }
  }

  private async removeDoc(collectionName: string, docId: string): Promise<void> {
    this.saveStateToDisk();
    try {
      const delPromise = this.remoteDocStore.deleteDoc(collectionName, docId);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Firestore delete timed out (removed from disk)')), 2500)
      );
      await Promise.race([delPromise, timeoutPromise]);
    } catch (err: any) {
      if (err?.message?.includes('Quota limit exceeded') || err?.code === 'resource-exhausted') {
        console.warn(`[Firestore Quota] Delete skipped for ${collectionName}/${docId} due to daily limit. Removed from memory and disk.`);
      } else {
        console.warn(`[Firestore Delete Note] Document ${collectionName}/${docId} removed locally:`, err?.message || err);
      }
    }
  }

  private registerTokenInMemory(tokenDoc: PersistedTokenRecord) {
    const partDeterministicCode = tokenDoc.participantId
      ? deriveDeterministicAccessCode(tokenDoc.participantId).toUpperCase()
      : '';
    const hashDeterministicCode = tokenDoc.tokenHash
      ? deriveDeterministicAccessCode(tokenDoc.tokenHash).toUpperCase()
      : '';

    const isValidMixedYf5 = (code: string): boolean => {
      const m = /^YF-([A-Z0-9]{5})$/.exec((code || '').trim().toUpperCase());
      if (!m) return false;
      const suffix = m[1];
      return /[A-Z]/.test(suffix) && /[0-9]/.test(suffix);
    };

    const aliasCodes = new Set<string>();
    const aliasPlainTokens = new Set<string>();

    if (!tokenDoc.accessCode || tokenDoc.accessCode.trim().length === 0) {
      tokenDoc.accessCode = partDeterministicCode || hashDeterministicCode;
    } else {
      const cleanedExisting = extractCleanTokenOrCode(tokenDoc.accessCode).toUpperCase();
      if (!isValidMixedYf5(cleanedExisting)) {
        aliasCodes.add(cleanedExisting);
        if (!(tokenDoc as any).legacyAccessCode) {
          (tokenDoc as any).legacyAccessCode = cleanedExisting;
        }
        tokenDoc.accessCode = partDeterministicCode || hashDeterministicCode;
      } else {
        tokenDoc.accessCode = cleanedExisting;
      }
    }
    if ((tokenDoc as any).legacyAccessCode) {
      aliasCodes.add(String((tokenDoc as any).legacyAccessCode).toUpperCase());
    }

    if (!tokenDoc.plainToken || tokenDoc.plainToken.trim().length === 0) {
      tokenDoc.plainToken = deriveDeterministicPlainToken(tokenDoc.participantId || tokenDoc.tokenHash);
    }

    // Deduplicate any existing non-revoked token for the same participantId so a participant never has two conflicting tokens
    if (tokenDoc.participantId && !tokenDoc.revoked) {
      for (const [existingHash, existingTok] of Array.from(this.tokens.entries())) {
        if (existingTok.participantId === tokenDoc.participantId && !existingTok.revoked && existingHash !== tokenDoc.tokenHash) {
          if (existingTok.accessCode) aliasCodes.add(existingTok.accessCode.toUpperCase());
          if ((existingTok as any).legacyAccessCode) {
            aliasCodes.add(String((existingTok as any).legacyAccessCode).toUpperCase());
          }
          if (existingTok.plainToken) aliasPlainTokens.add(existingTok.plainToken);

          const incomingIsFallback =
            tokenDoc.id === `tok_${tokenDoc.participantId}` &&
            tokenDoc.accessCode === partDeterministicCode;
          const existingIsFallback =
            existingTok.id === `tok_${existingTok.participantId}` &&
            existingTok.accessCode === partDeterministicCode;

          if (incomingIsFallback && !existingIsFallback) {
            tokenDoc.id = existingTok.id;
            tokenDoc.tokenHash = existingTok.tokenHash;
            tokenDoc.plainToken = existingTok.plainToken || tokenDoc.plainToken;
            if (isValidMixedYf5(existingTok.accessCode)) {
              tokenDoc.accessCode = existingTok.accessCode.toUpperCase();
            }
          } else if (!incomingIsFallback && existingIsFallback) {
            this.tokens.delete(existingHash);
          } else {
            if (
              tokenDoc.accessCode === partDeterministicCode &&
              existingTok.accessCode &&
              isValidMixedYf5(existingTok.accessCode) &&
              existingTok.accessCode !== partDeterministicCode
            ) {
              tokenDoc.accessCode = existingTok.accessCode.toUpperCase();
            }
            this.tokens.delete(existingHash);
          }
        }
      }
    }

    this.tokens.set(tokenDoc.tokenHash, tokenDoc);

    // Sync participant in-memory accessCode if present
    if (tokenDoc.participantId) {
      const partObj = this.participants.get(tokenDoc.participantId) as any;
      if (partObj && partObj.accessCode && partObj.accessCode !== tokenDoc.accessCode) {
        aliasCodes.add(String(partObj.accessCode).toUpperCase());
        partObj.accessCode = tokenDoc.accessCode;
      }
    }

    aliasPlainTokens.add(tokenDoc.plainToken);
    if (tokenDoc.participantId) {
      aliasPlainTokens.add(deriveDeterministicPlainToken(tokenDoc.participantId));
    }
    for (const pt of aliasPlainTokens) {
      if (!pt) continue;
      this.plainTokenMap.set(pt, tokenDoc.tokenHash);
      this.plainTokenMap.set(pt.toLowerCase(), tokenDoc.tokenHash);
    }

    aliasCodes.add(tokenDoc.accessCode.toUpperCase());
    if (partDeterministicCode) aliasCodes.add(partDeterministicCode);
    if (hashDeterministicCode) aliasCodes.add(hashDeterministicCode);

    for (const code of aliasCodes) {
      if (!code) continue;
      const upper = code.toUpperCase();
      this.accessCodeMap.set(upper, tokenDoc.tokenHash);
      const alphaNum = upper.replace(/[^A-Z0-9]/gi, '');
      if (alphaNum) {
        this.accessCodeMap.set(alphaNum, tokenDoc.tokenHash);
      }
    }
  }

  private ensureParticipantTokensConsistent(): void {
    for (const part of this.participants.values()) {
      const interview = this.interviews.get(part.interviewId);
      const existingToken = Array.from(this.tokens.values()).find(
        (t) => t.participantId === part.id && !t.revoked
      );
      if (existingToken) {
        if (
          interview &&
          interview.status === 'open' &&
          new Date(interview.expiresAt).getTime() > Date.now() &&
          new Date(existingToken.expiresAt).getTime() < new Date(interview.expiresAt).getTime()
        ) {
          existingToken.expiresAt = interview.expiresAt;
        }
        this.registerTokenInMemory(existingToken);
      } else {
        const plainToken = deriveDeterministicPlainToken(part.id);
        const tokenHash = hashToken(plainToken);
        const accessCode = deriveDeterministicAccessCode(part.id);
        const expiresAt =
          interview?.expiresAt || new Date(Date.now() + 20 * 86400000).toISOString();
        const fallbackTok: PersistedTokenRecord = {
          id: `tok_${part.id}`,
          tokenHash,
          plainToken,
          accessCode,
          interviewId: part.interviewId,
          participantId: part.id,
          expiresAt,
          revoked: false,
          createdAt: new Date().toISOString(),
        };
        this.registerTokenInMemory(fallbackTok);
      }
    }
  }

  private seedDefaultInterviewsInMemory(): void {
    const now = new Date();
    const openDays = 20;
    const expiresAt = new Date(now.getTime() + openDays * 86400000).toISOString();

    // 1. Individual Interview: "Memorias de Don Fernando: Raíces y Legado"
    const indInterviewId = 'int_demo_fernando';
    const indPartId = 'part_demo_fernando';
    const indPlainToken = deriveDeterministicPlainToken(indPartId);
    const indTokenHash = hashToken(indPlainToken);
    const indAccessCode = 'LEG-8492';

    const indInterview: InterviewRecord = {
      id: indInterviewId,
      title: 'Memorias de Don Fernando: Raíces y Legado',
      storyMode: 'individual',
      storyType: 'biografia_personal',
      status: 'open',
      openedAt: now.toISOString(),
      expiresAt,
      openDaysAtCreation: openDays,
      sufficiencyThreshold: 5,
      maxFollowUpsAtCreation: this.config.defaultMaxFollowUps,
      completedQuestionCount: 3,
      sufficiencyStatus: 'not_evaluated',
      userDeclaredComplete: false,
      closedAt: null,
      closureReason: null,
      lastActivityAt: now.toISOString(),
      questionnaireVersionId: 'v1_initial',
      createdById: 'garcia.michel@gmail.com',
      createdByName: 'garcia.michel@gmail.com',
    };
    const indParticipant: ParticipantRecord = {
      id: indPartId,
      interviewId: indInterviewId,
      name: 'Fernando Morales',
      relationship: 'Titular',
      role: 'primary',
      status: 'active',
      email: 'fernando.morales.demo@example.com',
      joinedAt: now.toISOString(),
    };
    const indToken: PersistedTokenRecord = {
      id: 'tok_demo_fernando',
      tokenHash: indTokenHash,
      plainToken: indPlainToken,
      accessCode: indAccessCode,
      interviewId: indInterviewId,
      participantId: indPartId,
      expiresAt,
      revoked: false,
      createdAt: now.toISOString(),
    };

    this.interviews.set(indInterview.id, indInterview);
    this.participants.set(indParticipant.id, indParticipant);
    this.registerTokenInMemory(indToken);

    const indAnswers: AnswerRecord[] = [
      {
        id: 'ans_demo_fernando_1',
        interviewId: indInterviewId,
        questionId: 'q_inf_01',
        questionText: '¿Dónde naciste y cómo recuerdas la casa o el lugar donde pasaste tus primeros años?',
        participantId: indPartId,
        participantName: 'Fernando Morales',
        answerText:
          'Nací en un pueblito de Michoacán llamado Quiroga en 1948. Recuerdo el patio grande empedrado con naranjos y el olor a tierra mojada.',
        notRecalled: false,
        isFollowUp: false,
        parentQuestionId: null,
        isAdditionalMemory: false,
        branchChoice: null,
        idempotencyKey: 'seed_ind_ans_1',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      {
        id: 'ans_demo_fernando_2',
        interviewId: indInterviewId,
        questionId: 'q_inf_02',
        questionText: '¿Quiénes fueron las personas más importantes en tu infancia y qué enseñanzas te dejaron?',
        participantId: indPartId,
        participantName: 'Fernando Morales',
        answerText:
          'Mi padre era carpintero y mi madre tejía manteles. Nos inculcaron siempre la honradez y la puntualidad como el mayor capital de un hombre.',
        notRecalled: false,
        isFollowUp: false,
        parentQuestionId: null,
        isAdditionalMemory: false,
        branchChoice: null,
        idempotencyKey: 'seed_ind_ans_2',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      {
        id: 'ans_demo_fernando_3',
        interviewId: indInterviewId,
        questionId: 'q_inf_03',
        questionText: '¿Cuál era tu juego o pasatiempo favorito cuando eras niño?',
        participantId: indPartId,
        participantName: 'Fernando Morales',
        answerText: '',
        notRecalled: true,
        isFollowUp: false,
        parentQuestionId: null,
        isAdditionalMemory: false,
        branchChoice: null,
        idempotencyKey: 'seed_ind_ans_3',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ];
    for (const ans of indAnswers) {
      this.answers.set(ans.id, ans);
    }

    // 2. Shared Interview: "Crónicas de la Familia Valenzuela"
    const sharedInterviewId = 'int_demo_valenzuela';
    const fatherPartId = 'part_demo_roberto';
    const daughterPartId = 'part_demo_sofia';
    const sharedExpiresAt = new Date(now.getTime() + 30 * 86400000).toISOString();

    const sharedInterview: InterviewRecord = {
      id: sharedInterviewId,
      title: 'Crónicas de la Familia Valenzuela',
      storyMode: 'compartida',
      storyType: 'memorias_familiares',
      status: 'open',
      openedAt: now.toISOString(),
      expiresAt: sharedExpiresAt,
      openDaysAtCreation: 30,
      sufficiencyThreshold: 6,
      maxFollowUpsAtCreation: this.config.defaultMaxFollowUps,
      completedQuestionCount: 2,
      sufficiencyStatus: 'not_evaluated',
      userDeclaredComplete: false,
      closedAt: null,
      closureReason: null,
      lastActivityAt: now.toISOString(),
      questionnaireVersionId: 'v1_initial',
      createdById: 'garcia.michel@gmail.com',
      createdByName: 'garcia.michel@gmail.com',
    };
    const fatherPart: ParticipantRecord = {
      id: fatherPartId,
      interviewId: sharedInterviewId,
      name: 'Roberto Valenzuela (Padre)',
      relationship: 'Padre',
      role: 'primary',
      status: 'active',
      email: 'roberto.valenzuela.demo@example.com',
      joinedAt: now.toISOString(),
    };
    const daughterPart: ParticipantRecord = {
      id: daughterPartId,
      interviewId: sharedInterviewId,
      name: 'Sofía Valenzuela (Hija)',
      relationship: 'Hija',
      role: 'contributor',
      status: 'active',
      email: 'sofia.valenzuela.demo@example.com',
      joinedAt: now.toISOString(),
    };

    const fatherPlain = deriveDeterministicPlainToken(fatherPartId);
    const fatherTok: PersistedTokenRecord = {
      id: 'tok_demo_roberto',
      tokenHash: hashToken(fatherPlain),
      plainToken: fatherPlain,
      accessCode: 'LEG-5319',
      interviewId: sharedInterviewId,
      participantId: fatherPartId,
      expiresAt: sharedExpiresAt,
      revoked: false,
      createdAt: now.toISOString(),
    };

    const daughterPlain = deriveDeterministicPlainToken(daughterPartId);
    const daughterTok: PersistedTokenRecord = {
      id: 'tok_demo_sofia',
      tokenHash: hashToken(daughterPlain),
      plainToken: daughterPlain,
      accessCode: 'LEG-7640',
      interviewId: sharedInterviewId,
      participantId: daughterPartId,
      expiresAt: sharedExpiresAt,
      revoked: false,
      createdAt: now.toISOString(),
    };

    this.interviews.set(sharedInterview.id, sharedInterview);
    this.participants.set(fatherPart.id, fatherPart);
    this.participants.set(daughterPart.id, daughterPart);
    this.registerTokenInMemory(fatherTok);
    this.registerTokenInMemory(daughterTok);

    const sharedAnswers: AnswerRecord[] = [
      {
        id: 'ans_demo_roberto_1',
        interviewId: sharedInterviewId,
        questionId: 'q_inf_01',
        questionText: '¿Dónde naciste y cómo recuerdas la casa o el lugar donde pasaste tus primeros años?',
        participantId: fatherPartId,
        participantName: 'Roberto Valenzuela (Padre)',
        answerText:
          'Nuestra primera casa familiar en Monterrey era pequeña, con techo de lámina y un jardín donde planté una higuera que aún sigue en pie.',
        notRecalled: false,
        isFollowUp: false,
        parentQuestionId: null,
        isAdditionalMemory: false,
        branchChoice: null,
        idempotencyKey: 'seed_shared_ans_father_1',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      {
        id: 'ans_demo_sofia_1',
        interviewId: sharedInterviewId,
        questionId: 'q_inf_01',
        questionText: '¿Dónde naciste y cómo recuerdas la casa o el lugar donde pasaste tus primeros años?',
        participantId: daughterPartId,
        participantName: 'Sofía Valenzuela (Hija)',
        answerText:
          'Yo crecí jugando bajo esa higuera que papá cuidaba. Para mí esa casa olía a pan tostado y a las noches de lluvia viendo caer relámpagos con mi hermano.',
        notRecalled: false,
        isFollowUp: false,
        parentQuestionId: null,
        isAdditionalMemory: false,
        branchChoice: null,
        idempotencyKey: 'seed_shared_ans_daughter_1',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ];
    for (const ans of sharedAnswers) {
      this.answers.set(ans.id, ans);
    }

    this.seedCompleteTestStoriesInMemory();
    this.saveStateToDisk();
  }

  public seedCompleteTestStoriesInMemory(): void {
    const testStories = buildCompleteTestStories();
    const testStoryIds = new Set(testStories.map((s) => s.interview.id));

    // Clean up any stale test participants and answers belonging to these test interviews
    for (const [ansId, ans] of this.answers.entries()) {
      if (testStoryIds.has(ans.interviewId)) {
        this.answers.delete(ansId);
      }
    }
    for (const [partId, part] of this.participants.entries()) {
      if (testStoryIds.has(part.interviewId)) {
        this.participants.delete(partId);
      }
    }

    for (const story of testStories) {
      this.interviews.set(story.interview.id, story.interview);
      for (const part of story.participants) {
        this.participants.set(part.id, part);
        if (part.plainToken) {
          this.plainTokenMap.set(part.plainToken, part.id);
        }
        if (part.accessCode) {
          this.accessCodeMap.set(part.accessCode.toUpperCase(), hashToken(part.plainToken));
        }
      }
      for (const tok of story.tokens) {
        this.registerTokenInMemory(tok);
      }
      for (const ans of story.answers) {
        this.answers.set(ans.id, ans);
      }
    }
  }

  public restoreFromClientCache(
    cachedInterviews?: any[],
    cachedBookVersions?: ParticipantBookVersionRecord[]
  ): number {
    let restoredCount = 0;

    if (Array.isArray(cachedInterviews) && cachedInterviews.length > 0) {
      for (const item of cachedInterviews) {
        if (!item || !item.id || !item.title) continue;
        const {
          participants: partList,
          answersCount: _ac,
          manuscriptsCount: _mc,
          latestManuscriptVersion: _lmv,
          photosCount: _pc,
          bookVersions: itemBookVersions,
          bookVersionsCount: _bvc,
          latestBookVersion: _lbv,
          ...interviewData
        } = item;

        const existingInterview = this.interviews.get(interviewData.id);
        if (!existingInterview) {
          this.interviews.set(interviewData.id, interviewData as InterviewRecord);
          restoredCount++;
        } else {
          // Never overwrite fresher server/Firestore interview data with older browser localStorage cache
          const serverNewestMs = Math.max(
            existingInterview.reopenedAt ? new Date(existingInterview.reopenedAt).getTime() : 0,
            existingInterview.closedAt ? new Date(existingInterview.closedAt).getTime() : 0,
            existingInterview.openedAt ? new Date(existingInterview.openedAt).getTime() : 0
          );
          const clientNewestMs = Math.max(
            interviewData.reopenedAt ? new Date(interviewData.reopenedAt).getTime() : 0,
            interviewData.closedAt ? new Date(interviewData.closedAt).getTime() : 0,
            interviewData.openedAt ? new Date(interviewData.openedAt).getTime() : 0
          );
          if (serverNewestMs > clientNewestMs && this.firestoreSyncStatus.source === 'firestore') {
            continue;
          }
          // Merge any newer closure or book generation counters from client cache
          let updated = false;
          if (interviewData.userDeclaredComplete && !existingInterview.userDeclaredComplete) {
            const reopenedTime = existingInterview.reopenedAt
              ? new Date(existingInterview.reopenedAt).getTime()
              : 0;
            const closedTime = interviewData.closedAt
              ? new Date(interviewData.closedAt).getTime()
              : 0;
            // Server reopen status takes precedence over older cached closure
            if (existingInterview.status === 'open' && (reopenedTime >= closedTime || !existingInterview.closedAt)) {
              // Keep open status
            } else {
              existingInterview.userDeclaredComplete = true;
              existingInterview.closedAt = interviewData.closedAt || existingInterview.closedAt || new Date().toISOString();
              existingInterview.closureReason = interviewData.closureReason ?? existingInterview.closureReason;
              existingInterview.participantClosingText =
                interviewData.participantClosingText ?? existingInterview.participantClosingText;
              if (interviewData.status === 'completed') {
                existingInterview.status = 'completed';
              }
              updated = true;
            }
          }
          if (
            (interviewData.bookGeneratedCount ?? 0) > (existingInterview.bookGeneratedCount ?? 0) &&
            !Array.from(this.deletedBookVersionIds).some((id) => id.includes(existingInterview.id))
          ) {
            existingInterview.bookGeneratedCount = interviewData.bookGeneratedCount;
            updated = true;
          }
          if ((interviewData.layoutEditsUsed ?? 0) > (existingInterview.layoutEditsUsed ?? 0)) {
            existingInterview.layoutEditsUsed = interviewData.layoutEditsUsed;
            updated = true;
          }
          if (
            interviewData.layoutEditsAllowed !== undefined &&
            interviewData.layoutEditsAllowed > (existingInterview.layoutEditsAllowed ?? 1)
          ) {
            existingInterview.layoutEditsAllowed = interviewData.layoutEditsAllowed;
            updated = true;
          }
          if (updated) {
            this.interviews.set(existingInterview.id, existingInterview);
            restoredCount++;
          }
        }

        if (Array.isArray(itemBookVersions)) {
          for (const bv of itemBookVersions) {
            if (
              bv &&
              bv.id &&
              bv.interviewId &&
              bv.manuscript &&
              !this.participantBookVersions.has(bv.id) &&
              !this.deletedBookVersionIds.has(bv.id) &&
              !this.deletedBookVersionIds.has(`pbv_${bv.interviewId}_v${bv.versionNumber}`)
            ) {
              this.participantBookVersions.set(bv.id, bv as ParticipantBookVersionRecord);
              restoredCount++;
            }
          }
        }

        if (Array.isArray(partList)) {
          for (const p of partList) {
            if (!p || !p.id) continue;
            const { plainToken, accessCode, inviteUrl: _iu, ...partRecord } = p;
            if (!this.participants.has(partRecord.id)) {
              this.participants.set(partRecord.id, {
                ...partRecord,
                interviewId: interviewData.id,
              } as ParticipantRecord);
            }

            const resolvedPlain = plainToken || deriveDeterministicPlainToken(partRecord.id);
            const resolvedHash = hashToken(resolvedPlain);
            const resolvedCode = accessCode
              ? extractCleanTokenOrCode(accessCode).toUpperCase()
              : deriveDeterministicAccessCode(partRecord.id);

            const existingTok = Array.from(this.tokens.values()).find(
              (t) => t.participantId === partRecord.id && !t.revoked
            );

            if (!existingTok) {
              const newTok: PersistedTokenRecord = {
                id: `tok_${partRecord.id}`,
                tokenHash: resolvedHash,
                plainToken: resolvedPlain,
                accessCode: resolvedCode,
                interviewId: interviewData.id,
                participantId: partRecord.id,
                expiresAt:
                  interviewData.expiresAt || new Date(Date.now() + 20 * 86400000).toISOString(),
                revoked: false,
                createdAt: interviewData.openedAt || new Date().toISOString(),
              };
              this.registerTokenInMemory(newTok);
            } else {
              const fallbackPartCode = deriveDeterministicAccessCode(partRecord.id).toUpperCase();
              if (
                accessCode &&
                resolvedCode !== fallbackPartCode &&
                existingTok.accessCode !== resolvedCode
              ) {
                existingTok.accessCode = resolvedCode;
              }
              if (plainToken && existingTok.plainToken !== plainToken) {
                existingTok.plainToken = plainToken;
              }
              this.registerTokenInMemory(existingTok);
              if (resolvedCode) {
                this.accessCodeMap.set(resolvedCode.toUpperCase(), existingTok.tokenHash);
                this.accessCodeMap.set(
                  resolvedCode.replace(/[^A-Z0-9]/gi, '').toUpperCase(),
                  existingTok.tokenHash
                );
              }
            }
          }
        }
      }
    }

    if (Array.isArray(cachedBookVersions) && cachedBookVersions.length > 0) {
      for (const bv of cachedBookVersions) {
        if (
          bv &&
          bv.id &&
          bv.interviewId &&
          bv.manuscript &&
          !this.participantBookVersions.has(bv.id) &&
          !this.deletedBookVersionIds.has(bv.id) &&
          !this.deletedBookVersionIds.has(`pbv_${bv.interviewId}_v${bv.versionNumber}`)
        ) {
          this.participantBookVersions.set(bv.id, bv);
          const inv = this.interviews.get(bv.interviewId);
          if (inv) {
            inv.bookGeneratedCount = Math.max(inv.bookGeneratedCount ?? 0, bv.versionNumber || 1);
            this.interviews.set(inv.id, inv);
          }
          restoredCount++;
        }
      }
    }

    if (
      restoredCount > 0 ||
      (Array.isArray(cachedInterviews) && cachedInterviews.length > 0) ||
      (Array.isArray(cachedBookVersions) && cachedBookVersions.length > 0)
    ) {
      this.saveStateToDisk();
    }
    return restoredCount;
  }

  private isQuotaError(err: any): boolean {
    const msg = String(err?.message || err || '');
    return (
      err?.code === 'resource-exhausted' ||
      msg.includes('Quota limit exceeded') ||
      msg.includes('RESOURCE_EXHAUSTED')
    );
  }

  private async raceDocsWithTimeout(
    queries: Array<Promise<any>>,
    timeoutMs: number,
    phaseLabel: string
  ): Promise<{ results: Array<PromiseSettledResult<any>>; timedOut: boolean }> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fetchPromise = Promise.allSettled(queries).then((results) => ({
      results,
      timedOut: false,
    }));
    const timeoutPromise = new Promise<{ results: Array<PromiseSettledResult<any>>; timedOut: boolean }>(
      (resolve) => {
        timer = setTimeout(() => {
          console.warn(
            `[StorageManager] Firestore ${phaseLabel} fetch took > ${timeoutMs}ms; keeping non-destructive local state while sync settles.`
          );
          resolve({ results: [], timedOut: true });
        }, timeoutMs);
        if (timer && typeof timer.unref === 'function') {
          timer.unref();
        }
      }
    );
    const outcome = await Promise.race([fetchPromise, timeoutPromise]);
    if (timer) clearTimeout(timer);
    return outcome;
  }

  private applyConfigSnap(docSnap: any): void {
    if (!docSnap || !docSnap.exists?.()) return;
    const rawCfg = docSnap.data() as AppConfig;
    this.config = {
      ...INITIAL_APP_CONFIG,
      ...rawCfg,
      literaryPrompts: {
        ...DEFAULT_LITERARY_PROMPTS_CONFIG,
        ...(rawCfg?.literaryPrompts || {}),
      },
      literaryPromptVersions:
        Array.isArray(rawCfg?.literaryPromptVersions) &&
        rawCfg.literaryPromptVersions.length > 0
          ? rawCfg.literaryPromptVersions
          : [...DEFAULT_LITERARY_PROMPT_VERSIONS],
    };
  }

  private applyHeavySnapshots(results: Array<PromiseSettledResult<any>>): void {
    const unwrapHeavy = (idx: number) => {
      const r = results[idx];
      return r && r.status === 'fulfilled' ? r.value : null;
    };

    const photosSnap = unwrapHeavy(0);
    const audiosSnap = unwrapHeavy(1);
    const manuscriptsSnap = unwrapHeavy(2);
    const logsSnap = unwrapHeavy(3);
    const sharesSnap = unwrapHeavy(4);
    const deliveriesSnap = unwrapHeavy(5);
    const secondarySnap = unwrapHeavy(6);
    const postMortemSnap = unwrapHeavy(7);
    const arcoSnap = unwrapHeavy(8);
    const bookVersionsSnap = unwrapHeavy(9);

    if (photosSnap) {
      photosSnap.forEach((docSnap: any) => {
        const photo = docSnap.data() as InterviewPhotoRecord;
        if (photo && photo.id) {
          const prevMem = this.photos.get(photo.id);
          if ((!photo.dataUrl || !photo.dataUrl.startsWith('data:image/')) && prevMem?.dataUrl) {
            photo.dataUrl = prevMem.dataUrl;
          }
          this.photos.set(photo.id, photo);
        }
      });
    }

    if (audiosSnap) {
      audiosSnap.forEach((docSnap: any) => {
        const aud = docSnap.data() as InterviewAudioRecord;
        if (aud && aud.id) {
          this.audios.set(aud.id, aud);
        }
      });
    }

    if (manuscriptsSnap) {
      manuscriptsSnap.forEach((docSnap: any) => {
        const manu = docSnap.data() as ManuscriptRecord;
        if (manu && manu.id) {
          this.manuscripts.set(manu.id, manu);
        }
      });
    }

    if (logsSnap) {
      const loadedLogs: AuditLogRecord[] = [];
      logsSnap.forEach((docSnap: any) => {
        const log = docSnap.data() as AuditLogRecord;
        if (log && log.id) {
          loadedLogs.push(log);
        }
      });
      if (loadedLogs.length > 0) {
        const logMap = new Map(this.auditLogs.map((l) => [l.id, l]));
        for (const l of loadedLogs) {
          logMap.set(l.id, l);
        }
        const mergedLogs = Array.from(logMap.values());
        mergedLogs.sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        this.auditLogs = mergedLogs;
      }
    }

    if (sharesSnap) {
      sharesSnap.forEach((docSnap: any) => {
        const s = docSnap.data() as BookShareRecord;
        if (s && s.id) {
          this.bookShares.set(s.id, s);
        }
      });
    }

    if (deliveriesSnap) {
      deliveriesSnap.forEach((docSnap: any) => {
        const d = docSnap.data() as ScheduledDeliveryRecord;
        if (d && d.id) {
          this.scheduledDeliveries.set(d.id, d);
        }
      });
    }

    if (secondarySnap) {
      secondarySnap.forEach((docSnap: any) => {
        const sa = docSnap.data() as SecondaryAccessRecord;
        if (sa && sa.id) {
          this.secondaryAccess.set(sa.id, sa);
        }
      });
    }

    if (postMortemSnap) {
      postMortemSnap.forEach((docSnap: any) => {
        const pmi = docSnap.data() as PostMortemInstructionRecord;
        if (pmi && pmi.id) {
          this.postMortemInstructions.set(pmi.id, pmi);
        }
      });
    }

    if (arcoSnap) {
      arcoSnap.forEach((docSnap: any) => {
        const ar = docSnap.data() as ArcoRequestRecord;
        if (ar && ar.id) {
          this.arcoRequests.set(ar.id, ar);
        }
      });
    }

    if (bookVersionsSnap) {
      bookVersionsSnap.forEach((docSnap: any) => {
        const bv = docSnap.data() as ParticipantBookVersionRecord;
        if (
          bv &&
          bv.id &&
          !this.deletedBookVersionIds.has(bv.id) &&
          !this.deletedBookVersionIds.has(`pbv_${bv.interviewId}_v${bv.versionNumber}`)
        ) {
          this.participantBookVersions.set(bv.id, bv);
        }
      });
    }
  }

  private applyCoreSnapshots(results: Array<PromiseSettledResult<any>>): {
    anySuccess: boolean;
    quotaError: string | null;
    remoteInterviewsCount: number;
  } {
    let anySuccess = false;
    let quotaError: string | null = null;
    let remoteInterviewsCount = 0;

    for (const r of results) {
      if (r.status === 'fulfilled') {
        anySuccess = true;
      } else if (this.isQuotaError(r.reason)) {
        quotaError =
          'Se alcanzó el límite diario gratuito de lecturas de Cloud Firestore; mostrando instantánea local segura sin pérdida de datos.';
      }
    }

    const unwrapSnap = (idx: number) => {
      const r = results[idx];
      return r && r.status === 'fulfilled' ? r.value : null;
    };

    const settingsSnap = unwrapSnap(0);
    const questionsSnap = unwrapSnap(1);
    const versionsSnap = unwrapSnap(2);
    const interviewsSnap = unwrapSnap(3);
    const participantsSnap = unwrapSnap(4);
    const tokensSnap = unwrapSnap(5);
    const answersSnap = unwrapSnap(6);
    const consentsSnap = unwrapSnap(7);

    if (settingsSnap) {
      settingsSnap.forEach((docSnap: any) => {
        if (docSnap.id === 'appConfig') {
          this.applyConfigSnap(docSnap);
        }
      });
    }

    if (questionsSnap && !questionsSnap.empty) {
      questionsSnap.forEach((docSnap: any) => {
        const q = docSnap.data() as QuestionRecord;
        if (q && q.id) {
          this.questions.set(q.id, q);
        }
      });
    }

    if (versionsSnap && !versionsSnap.empty) {
      versionsSnap.forEach((docSnap: any) => {
        const v = docSnap.data() as QuestionnaireVersionDoc;
        if (v && v.id && Array.isArray(v.questions)) {
          this.questionnaireVersions.set(v.id, v.questions);
        }
      });
    }

    if (interviewsSnap) {
      remoteInterviewsCount = interviewsSnap.size || 0;
      interviewsSnap.forEach((docSnap: any) => {
        const inv = docSnap.data() as InterviewRecord;
        if (inv && inv.id) {
          const merged = mergeInterviewRecordNonDestructive(this.interviews.get(inv.id), inv);
          this.interviews.set(inv.id, merged);
        }
      });
    }

    if (participantsSnap) {
      participantsSnap.forEach((docSnap: any) => {
        const part = docSnap.data() as ParticipantRecord;
        if (part && part.id) {
          const existing = this.participants.get(part.id);
          this.participants.set(part.id, existing ? { ...existing, ...part } : part);
        }
      });
    }

    if (tokensSnap) {
      tokensSnap.forEach((docSnap: any) => {
        const tok = docSnap.data() as PersistedTokenRecord;
        if (tok && tok.tokenHash) {
          this.registerTokenInMemory(tok);
        }
      });
    }

    if (answersSnap) {
      answersSnap.forEach((docSnap: any) => {
        const ans = docSnap.data() as AnswerRecord;
        if (ans && ans.id) {
          const merged = mergeAnswerRecordNonDestructive(this.answers.get(ans.id), ans);
          this.answers.set(ans.id, merged);
        }
      });
    }

    if (consentsSnap) {
      consentsSnap.forEach((docSnap: any) => {
        const c = docSnap.data() as PrivacyConsentRecord;
        if (c && c.id) {
          this.privacyConsents.set(c.id, c);
        }
      });
    }

    return { anySuccess, quotaError, remoteInterviewsCount };
  }

  private advanceSyncWatermarks(mode: 'incremental' | 'full', updatedQuestions: boolean): void {
    const nowIso = new Date().toISOString();
    const answerTimestamps: Array<string | undefined | null> = [nowIso];
    for (const ans of this.answers.values()) {
      answerTimestamps.push(ans.updatedAt, ans.createdAt);
    }
    const nextAnswersCursor = computeIncrementalCursorWithOverlap(answerTimestamps, 3);
    if (nextAnswersCursor) {
      this.syncWatermarks.answersUpdatedAtCursor = nextAnswersCursor;
    } else if (!this.syncWatermarks.answersUpdatedAtCursor) {
      this.syncWatermarks.answersUpdatedAtCursor = new Date(Date.now() - 3 * 60_000).toISOString();
    }

    const latestLogTs = this.auditLogs[0]?.timestamp;
    if (latestLogTs) {
      this.syncWatermarks.auditLogsCursor = latestLogTs;
    }

    if (updatedQuestions || !this.syncWatermarks.questionsSyncedAt) {
      this.syncWatermarks.questionsSyncedAt = new Date().toISOString();
    }
    if (mode === 'full' || !this.syncWatermarks.fullBaselineSyncedAt) {
      this.syncWatermarks.fullBaselineSyncedAt = new Date().toISOString();
    }
    this.syncWatermarks.lastSyncMode = mode;
  }

  private async pullScopedCollectionsForInterviews(interviewIds: string[]): Promise<boolean> {
    if (interviewIds.length === 0) return true;

    if (interviewIds.length > 10) {
      const bulkOutcome = await this.raceDocsWithTimeout(
        [
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'participants'), 'storage'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'interviewTokens'), 'storage'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'privacyConsents'), 'storage'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'manuscripts'), 'storage'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'participantBookVersions'), 'storage'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'interviewPhotos'), 'storage'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'interviewAudio'), 'storage'),
        ],
        10_000,
        'scoped-bulk-fallback'
      );

      const unwrap = (i: number) =>
        bulkOutcome.results[i]?.status === 'fulfilled' ? (bulkOutcome.results[i] as any).value : null;

      unwrap(0)?.forEach((d: any) => {
        const part = d.data() as ParticipantRecord;
        if (part?.id) {
          const prev = this.participants.get(part.id);
          this.participants.set(part.id, prev ? { ...prev, ...part } : part);
        }
      });
      unwrap(1)?.forEach((d: any) => {
        const tok = d.data() as PersistedTokenRecord;
        if (tok?.tokenHash) this.registerTokenInMemory(tok);
      });
      unwrap(2)?.forEach((d: any) => {
        const c = d.data() as PrivacyConsentRecord;
        if (c?.id) this.privacyConsents.set(c.id, c);
      });
      unwrap(3)?.forEach((d: any) => {
        const m = d.data() as ManuscriptRecord;
        if (m?.id) this.manuscripts.set(m.id, m);
      });
      unwrap(4)?.forEach((d: any) => {
        const bv = d.data() as ParticipantBookVersionRecord;
        if (
          bv?.id &&
          !this.deletedBookVersionIds.has(bv.id) &&
          !this.deletedBookVersionIds.has(`pbv_${bv.interviewId}_v${bv.versionNumber}`)
        ) {
          this.participantBookVersions.set(bv.id, bv);
        }
      });
      unwrap(5)?.forEach((d: any) => {
        const ph = d.data() as InterviewPhotoRecord;
        if (ph?.id) {
          const prevMem = this.photos.get(ph.id);
          if ((!ph.dataUrl || !ph.dataUrl.startsWith('data:image/')) && prevMem?.dataUrl) {
            ph.dataUrl = prevMem.dataUrl;
          }
          this.photos.set(ph.id, ph);
        }
      });
      unwrap(6)?.forEach((d: any) => {
        const aud = d.data() as InterviewAudioRecord;
        if (aud?.id) this.audios.set(aud.id, aud);
      });
      return bulkOutcome.results.some((r) => r.status === 'fulfilled');
    }

    let anyOk = false;
    for (const id of interviewIds) {
      const scopedOutcome = await this.raceDocsWithTimeout(
        [
          firestoreTelemetry.trackedGetDocs(
            serverDb,
            query(collection(serverDb, 'participants'), where('interviewId', '==', id)),
            'storage'
          ),
          firestoreTelemetry.trackedGetDocs(
            serverDb,
            query(collection(serverDb, 'interviewTokens'), where('interviewId', '==', id)),
            'storage'
          ),
          firestoreTelemetry.trackedGetDocs(
            serverDb,
            query(collection(serverDb, 'privacyConsents'), where('interviewId', '==', id)),
            'storage'
          ),
          firestoreTelemetry.trackedGetDocs(
            serverDb,
            query(collection(serverDb, 'manuscripts'), where('interviewId', '==', id)),
            'storage'
          ),
          firestoreTelemetry.trackedGetDocs(
            serverDb,
            query(collection(serverDb, 'participantBookVersions'), where('interviewId', '==', id)),
            'storage'
          ),
          firestoreTelemetry.trackedGetDocs(
            serverDb,
            query(collection(serverDb, 'interviewPhotos'), where('interviewId', '==', id)),
            'storage'
          ),
          firestoreTelemetry.trackedGetDocs(
            serverDb,
            query(collection(serverDb, 'interviewAudio'), where('interviewId', '==', id)),
            'storage'
          ),
          firestoreTelemetry.trackedGetDocs(
            serverDb,
            query(collection(serverDb, 'bookShares'), where('interviewId', '==', id)),
            'storage'
          ),
          firestoreTelemetry.trackedGetDocs(
            serverDb,
            query(collection(serverDb, 'scheduledDeliveries'), where('interviewId', '==', id)),
            'storage'
          ),
          firestoreTelemetry.trackedGetDocs(
            serverDb,
            query(collection(serverDb, 'secondaryAccess'), where('interviewId', '==', id)),
            'storage'
          ),
          firestoreTelemetry.trackedGetDocs(
            serverDb,
            query(collection(serverDb, 'postMortemInstructions'), where('interviewId', '==', id)),
            'storage'
          ),
          firestoreTelemetry.trackedGetDocs(
            serverDb,
            query(collection(serverDb, 'arcoRequests'), where('interviewId', '==', id)),
            'storage'
          ),
        ],
        8_000,
        `scoped-${id}`
      );

      for (const r of scopedOutcome.results) {
        if (r.status === 'fulfilled') anyOk = true;
      }

      const unwrap = (i: number) =>
        scopedOutcome.results[i]?.status === 'fulfilled' ? (scopedOutcome.results[i] as any).value : null;

      unwrap(0)?.forEach((d: any) => {
        const part = d.data() as ParticipantRecord;
        if (part?.id) {
          const prev = this.participants.get(part.id);
          this.participants.set(part.id, prev ? { ...prev, ...part } : part);
        }
      });
      unwrap(1)?.forEach((d: any) => {
        const tok = d.data() as PersistedTokenRecord;
        if (tok?.tokenHash) this.registerTokenInMemory(tok);
      });
      unwrap(2)?.forEach((d: any) => {
        const c = d.data() as PrivacyConsentRecord;
        if (c?.id) this.privacyConsents.set(c.id, c);
      });
      unwrap(3)?.forEach((d: any) => {
        const m = d.data() as ManuscriptRecord;
        if (m?.id) this.manuscripts.set(m.id, m);
      });
      unwrap(4)?.forEach((d: any) => {
        const bv = d.data() as ParticipantBookVersionRecord;
        if (
          bv?.id &&
          !this.deletedBookVersionIds.has(bv.id) &&
          !this.deletedBookVersionIds.has(`pbv_${bv.interviewId}_v${bv.versionNumber}`)
        ) {
          this.participantBookVersions.set(bv.id, bv);
        }
      });
      unwrap(5)?.forEach((d: any) => {
        const ph = d.data() as InterviewPhotoRecord;
        if (ph?.id) {
          const prevMem = this.photos.get(ph.id);
          if ((!ph.dataUrl || !ph.dataUrl.startsWith('data:image/')) && prevMem?.dataUrl) {
            ph.dataUrl = prevMem.dataUrl;
          }
          this.photos.set(ph.id, ph);
        }
      });
      unwrap(6)?.forEach((d: any) => {
        const aud = d.data() as InterviewAudioRecord;
        if (aud?.id) this.audios.set(aud.id, aud);
      });
      unwrap(7)?.forEach((d: any) => {
        const s = d.data() as BookShareRecord;
        if (s?.id) this.bookShares.set(s.id, s);
      });
      unwrap(8)?.forEach((d: any) => {
        const del = d.data() as ScheduledDeliveryRecord;
        if (del?.id) this.scheduledDeliveries.set(del.id, del);
      });
      unwrap(9)?.forEach((d: any) => {
        const sa = d.data() as SecondaryAccessRecord;
        if (sa?.id) this.secondaryAccess.set(sa.id, sa);
      });
      unwrap(10)?.forEach((d: any) => {
        const pmi = d.data() as PostMortemInstructionRecord;
        if (pmi?.id) this.postMortemInstructions.set(pmi.id, pmi);
      });
      unwrap(11)?.forEach((d: any) => {
        const ar = d.data() as ArcoRequestRecord;
        if (ar?.id) this.arcoRequests.set(ar.id, ar);
      });
    }

    return anyOk;
  }

  private async runIncrementalFirestoreSync(): Promise<{
    anySuccess: boolean;
    quotaError: string | null;
    remoteInterviewsCount: number;
  }> {
    const readsBefore = firestoreTelemetry.getReport(this.getFirestoreSyncStatus()).metrics.reads.used;
    const prevInterviewsMap = new Map(this.interviews);
    const prevAnswersCount = this.answers.size;
    const prevParticipantsCount = this.participants.size;
    const prevBookVersionsCount = this.participantBookVersions.size;

    const shouldRefreshQuestions =
      !this.syncWatermarks.questionsSyncedAt ||
      Date.now() - new Date(this.syncWatermarks.questionsSyncedAt).getTime() > 12 * 3600_000;

    const answersQuery = this.syncWatermarks.answersUpdatedAtCursor
      ? query(
          collection(serverDb, 'answers'),
          where('updatedAt', '>=', this.syncWatermarks.answersUpdatedAtCursor)
        )
      : collection(serverDb, 'answers');

    const logsQuery = this.syncWatermarks.auditLogsCursor
      ? query(
          collection(serverDb, 'auditLogs'),
          where('timestamp', '>', this.syncWatermarks.auditLogsCursor)
        )
      : query(collection(serverDb, 'auditLogs'));

    const queries: Array<Promise<any>> = [
      firestoreTelemetry.trackedGetDoc(serverDb, doc(serverDb, 'settings', 'appConfig'), 'storage'),
      firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'interviews'), 'storage'),
      firestoreTelemetry.trackedGetDocs(serverDb, answersQuery, 'storage'),
      firestoreTelemetry.trackedGetCount(serverDb, collection(serverDb, 'answers'), 'storage'),
      firestoreTelemetry.trackedGetCount(serverDb, collection(serverDb, 'participants'), 'storage'),
      firestoreTelemetry.trackedGetCount(serverDb, collection(serverDb, 'participantBookVersions'), 'storage'),
      firestoreTelemetry.trackedGetDocs(serverDb, logsQuery, 'storage'),
    ];

    if (shouldRefreshQuestions) {
      queries.push(
        firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'questions'), 'storage'),
        firestoreTelemetry.trackedGetDocs(
          serverDb,
          collection(serverDb, 'questionnaireVersions'),
          'storage'
        )
      );
    }

    const outcome = await this.raceDocsWithTimeout(queries, 10_000, 'incremental-sync');

    let anySuccess = false;
    let quotaError: string | null = null;
    for (const r of outcome.results) {
      if (r.status === 'fulfilled') anySuccess = true;
      else if (this.isQuotaError(r.reason)) {
        quotaError =
          'Se alcanzó el límite diario gratuito de lecturas de Cloud Firestore; mostrando instantánea local segura sin pérdida de datos.';
      }
    }

    if (!anySuccess) {
      return { anySuccess: false, quotaError, remoteInterviewsCount: 0 };
    }

    const unwrap = (idx: number) =>
      outcome.results[idx]?.status === 'fulfilled' ? (outcome.results[idx] as any).value : null;

    const configDocSnap = unwrap(0);
    const interviewsSnap = unwrap(1);
    const answersSnap = unwrap(2);
    const remoteAnswersCount = typeof unwrap(3) === 'number' ? (unwrap(3) as number) : 0;
    const remoteParticipantsCount = typeof unwrap(4) === 'number' ? (unwrap(4) as number) : 0;
    const remoteBookVersionsCount = typeof unwrap(5) === 'number' ? (unwrap(5) as number) : 0;
    const logsSnap = unwrap(6);
    const questionsSnap = shouldRefreshQuestions ? unwrap(7) : null;
    const versionsSnap = shouldRefreshQuestions ? unwrap(8) : null;

    if (configDocSnap) {
      this.applyConfigSnap(configDocSnap);
    }

    if (questionsSnap && !questionsSnap.empty) {
      questionsSnap.forEach((docSnap: any) => {
        const q = docSnap.data() as QuestionRecord;
        if (q?.id) this.questions.set(q.id, q);
      });
    }
    if (versionsSnap && !versionsSnap.empty) {
      versionsSnap.forEach((docSnap: any) => {
        const v = docSnap.data() as QuestionnaireVersionDoc;
        if (v?.id && Array.isArray(v.questions)) {
          this.questionnaireVersions.set(v.id, v.questions);
        }
      });
    }

    const dirtyInterviewIds = new Set<string>();
    const remoteInterviews: InterviewRecord[] = [];
    if (interviewsSnap) {
      interviewsSnap.forEach((docSnap: any) => {
        const inv = docSnap.data() as InterviewRecord;
        if (inv?.id) {
          remoteInterviews.push(inv);
          const merged = mergeInterviewRecordNonDestructive(this.interviews.get(inv.id), inv);
          this.interviews.set(inv.id, merged);
        }
      });
      for (const id of detectChangedInterviewIds(prevInterviewsMap, remoteInterviews)) {
        dirtyInterviewIds.add(id);
      }
    }

    if (answersSnap) {
      answersSnap.forEach((docSnap: any) => {
        const ans = docSnap.data() as AnswerRecord;
        if (ans?.id) {
          const prevAns = this.answers.get(ans.id);
          const changed =
            !prevAns ||
            (ans.updatedAt || '') > (prevAns.updatedAt || '') ||
            (ans.answerText || '') !== (prevAns.answerText || '') ||
            (ans.photos?.length || 0) !== (prevAns.photos?.length || 0) ||
            (ans.audioRecordings?.length || 0) !== (prevAns.audioRecordings?.length || 0);
          const merged = mergeAnswerRecordNonDestructive(prevAns, ans);
          this.answers.set(ans.id, merged);
          if (changed && ans.interviewId) {
            dirtyInterviewIds.add(ans.interviewId);
          }
        }
      });
    }

    // Safety fallback if remote answer/participant/book counts exceed local cache without dirty interviews
    if (
      remoteAnswersCount > prevAnswersCount &&
      (!answersSnap || answersSnap.size === 0)
    ) {
      const safetyAnswersSnap = await firestoreTelemetry
        .trackedGetDocs(serverDb, collection(serverDb, 'answers'), 'storage')
        .catch(() => null);
      safetyAnswersSnap?.forEach((docSnap: any) => {
        const ans = docSnap.data() as AnswerRecord;
        if (ans?.id) {
          const merged = mergeAnswerRecordNonDestructive(this.answers.get(ans.id), ans);
          this.answers.set(ans.id, merged);
        }
      });
    }

    if (
      remoteParticipantsCount > prevParticipantsCount &&
      dirtyInterviewIds.size === 0
    ) {
      const allPartsSnap = await firestoreTelemetry
        .trackedGetDocs(serverDb, collection(serverDb, 'participants'), 'storage')
        .catch(() => null);
      allPartsSnap?.forEach((docSnap: any) => {
        const p = docSnap.data() as ParticipantRecord;
        if (p?.id) {
          const prev = this.participants.get(p.id);
          this.participants.set(p.id, prev ? { ...prev, ...p } : p);
          if (p.interviewId) dirtyInterviewIds.add(p.interviewId);
        }
      });
    }

    if (
      remoteBookVersionsCount > prevBookVersionsCount &&
      dirtyInterviewIds.size === 0
    ) {
      const allBvSnap = await firestoreTelemetry
        .trackedGetDocs(serverDb, collection(serverDb, 'participantBookVersions'), 'storage')
        .catch(() => null);
      allBvSnap?.forEach((docSnap: any) => {
        const bv = docSnap.data() as ParticipantBookVersionRecord;
        if (
          bv?.id &&
          !this.deletedBookVersionIds.has(bv.id) &&
          !this.deletedBookVersionIds.has(`pbv_${bv.interviewId}_v${bv.versionNumber}`)
        ) {
          this.participantBookVersions.set(bv.id, bv);
        }
      });
    }

    if (logsSnap) {
      const loadedLogs: AuditLogRecord[] = [];
      logsSnap.forEach((docSnap: any) => {
        const l = docSnap.data() as AuditLogRecord;
        if (l?.id) loadedLogs.push(l);
      });
      if (loadedLogs.length > 0) {
        const logMap = new Map(this.auditLogs.map((l) => [l.id, l]));
        for (const l of loadedLogs) logMap.set(l.id, l);
        this.auditLogs = Array.from(logMap.values()).sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
      }
    }

    if (dirtyInterviewIds.size > 0) {
      await this.pullScopedCollectionsForInterviews(Array.from(dirtyInterviewIds));
    }

    this.ensureParticipantTokensConsistent();
    this.advanceSyncWatermarks('incremental', shouldRefreshQuestions);
    this.saveStateToDisk();

    const readsAfter = firestoreTelemetry.getReport(this.getFirestoreSyncStatus()).metrics.reads.used;
    const actualReads = Math.max(0, readsAfter - readsBefore);
    const estimatedFullScanReads = Math.max(
      actualReads,
      this.answers.size +
        this.questions.size +
        this.interviews.size +
        this.participants.size +
        this.tokens.size +
        this.audios.size +
        this.participantBookVersions.size +
        this.auditLogs.length +
        80
    );
    if (estimatedFullScanReads > actualReads) {
      firestoreTelemetry.recordReadsSaved(estimatedFullScanReads - actualReads);
    }

    return {
      anySuccess: true,
      quotaError: null,
      remoteInterviewsCount: remoteInterviews.length,
    };
  }

  private async runFullBaselineFirestoreSync(): Promise<{
    anySuccess: boolean;
    quotaError: string | null;
    remoteInterviewsCount: number;
  }> {
    const coreOutcome = await this.raceDocsWithTimeout(
      [
        firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'settings'), 'storage'),
        firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'questions'), 'storage'),
        firestoreTelemetry.trackedGetDocs(
          serverDb,
          collection(serverDb, 'questionnaireVersions'),
          'storage'
        ),
        firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'interviews'), 'storage'),
        firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'participants'), 'storage'),
        firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'interviewTokens'), 'storage'),
        firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'answers'), 'storage'),
        firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'privacyConsents'), 'storage'),
      ],
      10_000,
      'full-core'
    );

    const { anySuccess, quotaError, remoteInterviewsCount } = this.applyCoreSnapshots(
      coreOutcome.results
    );

    if (anySuccess && !quotaError) {
      const heavyOutcome = await this.raceDocsWithTimeout(
        [
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'interviewPhotos'), 'storage'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'interviewAudio'), 'storage'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'manuscripts'), 'storage'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'auditLogs'), 'storage'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'bookShares'), 'storage'),
          firestoreTelemetry.trackedGetDocs(
            serverDb,
            collection(serverDb, 'scheduledDeliveries'),
            'storage'
          ),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'secondaryAccess'), 'storage'),
          firestoreTelemetry.trackedGetDocs(
            serverDb,
            collection(serverDb, 'postMortemInstructions'),
            'storage'
          ),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'arcoRequests'), 'storage'),
          firestoreTelemetry.trackedGetDocs(
            serverDb,
            collection(serverDb, 'participantBookVersions'),
            'storage'
          ),
        ],
        14_000,
        'full-heavy'
      );
      this.applyHeavySnapshots(heavyOutcome.results);
      this.ensureParticipantTokensConsistent();
      this.advanceSyncWatermarks('full', true);
      this.saveStateToDisk();
    }

    return { anySuccess, quotaError, remoteInterviewsCount };
  }

  public async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    // Hydrate local disk snapshot first for zero-data-loss resilience
    this.loadStateFromDisk();
    if (!this.initPromise) {
      this.initPromise = this.loadFromFirestore();
    }
    // Always give Phase 1 core Firestore collections (interviews, participants, tokens, answers)
    // a fair window to sync remote records (e.g. from www.youforever.app) even when disk cache exists.
    await Promise.race([
      this.coreSyncPromise || this.initPromise,
      new Promise<void>((resolve) => setTimeout(resolve, 4500)),
    ]);
  }

  public async syncFromFirestore(
    force = false,
    mode: 'incremental' | 'full' = 'incremental'
  ): Promise<{
    synced: boolean;
    quotaExhausted: boolean;
    mode: 'incremental' | 'full';
    message: string;
    status: FirestoreSyncFreshness;
  }> {
    const nowMs = Date.now();
    // Respect quota backoff (2 minutes) unless explicitly forced
    if (
      !force &&
      this.firestoreSyncStatus.quotaExhausted &&
      nowMs - this.firestoreSyncStatus.quotaExhaustedAtMs < 2 * 60 * 1000
    ) {
      return {
        synced: false,
        quotaExhausted: true,
        mode: this.syncWatermarks.lastSyncMode || 'incremental',
        message:
          this.firestoreSyncStatus.lastError ||
          'Cuota diaria gratuita de Firestore alcanzada temporalmente; usando caché local segura.',
        status: this.getFirestoreSyncStatus(),
      };
    }

    // Short cooldown guard (20 seconds) for incremental calls to keep multi-site live & reads minimal
    if (!force && mode !== 'full' && nowMs - this.lastFirestoreCoreSyncMs < 20_000) {
      return {
        synced: this.firestoreSyncStatus.source === 'firestore',
        quotaExhausted: this.firestoreSyncStatus.quotaExhausted,
        mode: this.syncWatermarks.lastSyncMode || 'incremental',
        message: 'Sincronización reciente ya aplicada.',
        status: this.getFirestoreSyncStatus(),
      };
    }

    if (this.activeSyncPromise) {
      await this.activeSyncPromise;
      return {
        synced: this.firestoreSyncStatus.source === 'firestore',
        quotaExhausted: this.firestoreSyncStatus.quotaExhausted,
        mode: this.syncWatermarks.lastSyncMode || 'incremental',
        message: this.firestoreSyncStatus.lastError || 'Sincronización completada.',
        status: this.getFirestoreSyncStatus(),
      };
    }

    const effectiveMode: 'incremental' | 'full' =
      mode === 'full' || !this.syncWatermarks.fullBaselineSyncedAt || this.interviews.size === 0
        ? 'full'
        : 'incremental';

    this.activeSyncPromise = (async () => {
      this.firestoreSyncStatus.lastAttemptAt = new Date().toISOString();
      this.lastFirestoreCoreSyncMs = Date.now();
      try {
        const result =
          effectiveMode === 'full'
            ? await this.runFullBaselineFirestoreSync()
            : await this.runIncrementalFirestoreSync();

        if (result.anySuccess && !result.quotaError) {
          this.ensureParticipantTokensConsistent();
          this.saveStateToDisk();
          this.firestoreSyncStatus.lastSuccessAt = new Date().toISOString();
          this.firestoreSyncStatus.lastError = null;
          this.firestoreSyncStatus.quotaExhausted = false;
          this.firestoreSyncStatus.source = 'firestore';
          this.firestoreSyncStatus.syncedRemoteInterviewsCount = result.remoteInterviewsCount;
        } else if (result.quotaError) {
          this.firestoreSyncStatus.quotaExhausted = true;
          this.firestoreSyncStatus.quotaExhaustedAtMs = Date.now();
          this.firestoreSyncStatus.lastError = result.quotaError;
        }
      } catch (err: any) {
        if (this.isQuotaError(err)) {
          this.firestoreSyncStatus.quotaExhausted = true;
          this.firestoreSyncStatus.quotaExhaustedAtMs = Date.now();
          this.firestoreSyncStatus.lastError =
            'Cuota diaria gratuita de Cloud Firestore alcanzada temporalmente.';
        } else {
          this.firestoreSyncStatus.lastError = err?.message || 'Error al sincronizar con Firestore.';
        }
      } finally {
        this.activeSyncPromise = null;
      }
    })();

    await this.activeSyncPromise;
    return {
      synced: !this.firestoreSyncStatus.quotaExhausted && !this.firestoreSyncStatus.lastError,
      quotaExhausted: this.firestoreSyncStatus.quotaExhausted,
      mode: this.syncWatermarks.lastSyncMode || effectiveMode,
      message:
        this.firestoreSyncStatus.lastError ||
        `Sincronización ${effectiveMode === 'incremental' ? 'incremental' : 'completa'} completada (${this.firestoreSyncStatus.syncedRemoteInterviewsCount} entrevistas en Firestore).`,
      status: this.getFirestoreSyncStatus(),
    };
  }

  public async loadFromFirestore(): Promise<void> {
    // 0. Hydrate from local disk snapshot first so restarts survive network latency or Firestore quota limits
    this.loadStateFromDisk();
    this.firestoreSyncStatus.lastAttemptAt = new Date().toISOString();
    this.lastFirestoreCoreSyncMs = Date.now();

    const useIncrementalStartup =
      Boolean(this.syncWatermarks.fullBaselineSyncedAt) && this.interviews.size > 0;

    const runCorePhase = async () => {
      try {
        if (useIncrementalStartup) {
          const inc = await this.runIncrementalFirestoreSync();
          if (inc.anySuccess && !inc.quotaError) {
            this.firestoreSyncStatus.lastSuccessAt = new Date().toISOString();
            this.firestoreSyncStatus.lastError = null;
            this.firestoreSyncStatus.quotaExhausted = false;
            this.firestoreSyncStatus.source = 'firestore';
            this.firestoreSyncStatus.syncedRemoteInterviewsCount = inc.remoteInterviewsCount;
          } else if (inc.quotaError) {
            this.firestoreSyncStatus.quotaExhausted = true;
            this.firestoreSyncStatus.quotaExhaustedAtMs = Date.now();
            this.firestoreSyncStatus.lastError = inc.quotaError;
          }
          return;
        }

        // Phase 1 baseline: Lightweight core metadata & testimonials
        const coreOutcome = await this.raceDocsWithTimeout(
          [
            firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'settings'), 'storage'),
            firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'questions'), 'storage'),
            firestoreTelemetry.trackedGetDocs(
              serverDb,
              collection(serverDb, 'questionnaireVersions'),
              'storage'
            ),
            firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'interviews'), 'storage'),
            firestoreTelemetry.trackedGetDocs(
              serverDb,
              collection(serverDb, 'participants'),
              'storage'
            ),
            firestoreTelemetry.trackedGetDocs(
              serverDb,
              collection(serverDb, 'interviewTokens'),
              'storage'
            ),
            firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'answers'), 'storage'),
            firestoreTelemetry.trackedGetDocs(
              serverDb,
              collection(serverDb, 'privacyConsents'),
              'storage'
            ),
          ],
          10_000,
          'core-init'
        );

        const { anySuccess, quotaError, remoteInterviewsCount } = this.applyCoreSnapshots(
          coreOutcome.results
        );

        if (anySuccess) {
          this.firestoreSyncStatus.lastSuccessAt = new Date().toISOString();
          this.firestoreSyncStatus.lastError = null;
          this.firestoreSyncStatus.quotaExhausted = false;
          this.firestoreSyncStatus.source = 'firestore';
          this.firestoreSyncStatus.syncedRemoteInterviewsCount = remoteInterviewsCount;
        } else if (quotaError) {
          this.firestoreSyncStatus.quotaExhausted = true;
          this.firestoreSyncStatus.quotaExhaustedAtMs = Date.now();
          this.firestoreSyncStatus.lastError = quotaError;
        }
      } catch (err: any) {
        if (this.isQuotaError(err)) {
          this.firestoreSyncStatus.quotaExhausted = true;
          this.firestoreSyncStatus.quotaExhaustedAtMs = Date.now();
          this.firestoreSyncStatus.lastError =
            'Cuota diaria gratuita de Cloud Firestore alcanzada temporalmente.';
        } else {
          console.warn(
            '[StorageManager] Note during Phase 1 Firestore load:',
            err?.message || err
          );
        }
      }
    };

    this.coreSyncPromise = runCorePhase();
    await this.coreSyncPromise;

    // Phase 2 baseline only runs on cold baseline initialization when incremental startup did not run
    if (!useIncrementalStartup && !this.firestoreSyncStatus.quotaExhausted) {
      try {
        const heavyOutcome = await this.raceDocsWithTimeout(
          [
            firestoreTelemetry.trackedGetDocs(
              serverDb,
              collection(serverDb, 'interviewPhotos'),
              'storage'
            ),
            firestoreTelemetry.trackedGetDocs(
              serverDb,
              collection(serverDb, 'interviewAudio'),
              'storage'
            ),
            firestoreTelemetry.trackedGetDocs(
              serverDb,
              collection(serverDb, 'manuscripts'),
              'storage'
            ),
            firestoreTelemetry.trackedGetDocs(
              serverDb,
              collection(serverDb, 'auditLogs'),
              'storage'
            ),
            firestoreTelemetry.trackedGetDocs(
              serverDb,
              collection(serverDb, 'bookShares'),
              'storage'
            ),
            firestoreTelemetry.trackedGetDocs(
              serverDb,
              collection(serverDb, 'scheduledDeliveries'),
              'storage'
            ),
            firestoreTelemetry.trackedGetDocs(
              serverDb,
              collection(serverDb, 'secondaryAccess'),
              'storage'
            ),
            firestoreTelemetry.trackedGetDocs(
              serverDb,
              collection(serverDb, 'postMortemInstructions'),
              'storage'
            ),
            firestoreTelemetry.trackedGetDocs(
              serverDb,
              collection(serverDb, 'arcoRequests'),
              'storage'
            ),
            firestoreTelemetry.trackedGetDocs(
              serverDb,
              collection(serverDb, 'participantBookVersions'),
              'storage'
            ),
          ],
          14_000,
          'media-and-versions'
        );

        this.applyHeavySnapshots(heavyOutcome.results);
        this.advanceSyncWatermarks('full', true);
      } catch (err: any) {
        console.warn(
          '[StorageManager] Note during Phase 2 Firestore load (operating with disk & memory state):',
          err?.message || err
        );
      }
    }

    // Ensure all participants have registered tokens and access codes
    this.ensureParticipantTokensConsistent();

    // Seed defaults ONLY if empty (never overwrite existing Firestore or disk records)
    if (this.interviews.size === 0) {
      this.seedDefaultInterviewsInMemory();
    } else {
      if (!this.interviews.has('int_test_santiago_ramos')) {
        this.seedCompleteTestStoriesInMemory();
      }
      this.saveStateToDisk();
    }

    await this.purgeOrphanedPhotosAndSyncCompilations();

    this.initialized = true;
  }

  // --- Configuration ---
  public getConfig(): AppConfig {
    return { ...this.config };
  }

  public async updateConfig(newConfig: Partial<AppConfig>, performedBy: string): Promise<AppConfig> {
    if (newConfig.defaultOpenDays !== undefined) {
      const days = Number(newConfig.defaultOpenDays);
      if (!Number.isInteger(days) || days <= 0 || days > 365) {
        throw new Error('Los días de apertura deben ser un entero entre 1 y 365 días.');
      }
      this.config.defaultOpenDays = days;
    }

    if (newConfig.defaultSufficiencyThreshold !== undefined) {
      const thresh = Number(newConfig.defaultSufficiencyThreshold);
      if (!Number.isInteger(thresh) || thresh <= 0 || thresh > 500) {
        throw new Error('El umbral de suficiencia debe ser un entero positivo entre 1 y 500.');
      }
      this.config.defaultSufficiencyThreshold = thresh;
    }

    if (newConfig.defaultMaxFollowUps !== undefined) {
      const follow = Number(newConfig.defaultMaxFollowUps);
      if (!Number.isInteger(follow) || follow < 0 || follow > 10) {
        throw new Error('Las preguntas de profundización máximas deben ser un entero entre 0 y 10.');
      }
      this.config.defaultMaxFollowUps = follow;
    }

    if (typeof newConfig.allowAnswerEditing === 'boolean') {
      this.config.allowAnswerEditing = newConfig.allowAnswerEditing;
    }

    if (typeof newConfig.allowAdditionalMemories === 'boolean') {
      this.config.allowAdditionalMemories = newConfig.allowAdditionalMemories;
    }

    if (newConfig.bookAiProvider === 'gemini' || newConfig.bookAiProvider === 'openai') {
      this.config.bookAiProvider = newConfig.bookAiProvider;
    }

    if (typeof newConfig.bookAiGeminiModel === 'string' && newConfig.bookAiGeminiModel.trim().length > 0) {
      this.config.bookAiGeminiModel = newConfig.bookAiGeminiModel.trim();
    }

    if (typeof newConfig.bookAiOpenAiModel === 'string' && newConfig.bookAiOpenAiModel.trim().length > 0) {
      this.config.bookAiOpenAiModel = newConfig.bookAiOpenAiModel.trim();
    }

    if (
      newConfig.bookStructureMode === 'prompt_autonomous' ||
      newConfig.bookStructureMode === 'fixed_five_stages'
    ) {
      this.config.bookStructureMode = newConfig.bookStructureMode;
    }

    if (newConfig.literaryPrompts && typeof newConfig.literaryPrompts === 'object') {
      const currentPrompts = this.config.literaryPrompts || { ...DEFAULT_LITERARY_PROMPTS_CONFIG };
      const styles: LiteraryPromptStyleId[] = [
        'first_person_simple',
        'first_person_literary',
        'third_person_biography',
      ];
      const nextPrompts: Record<LiteraryPromptStyleId, LiteraryStylePromptConfig> = {
        ...DEFAULT_LITERARY_PROMPTS_CONFIG,
        ...currentPrompts,
      };
      for (const st of styles) {
        const incoming = newConfig.literaryPrompts[st];
        if (incoming && typeof incoming.promptText === 'string' && incoming.promptText.trim().length > 0) {
          nextPrompts[st] = {
            styleId: st,
            styleLabel:
              incoming.styleLabel ||
              nextPrompts[st]?.styleLabel ||
              DEFAULT_LITERARY_PROMPTS_CONFIG[st].styleLabel,
            activeVersionId: incoming.activeVersionId || nextPrompts[st]?.activeVersionId || `lpv_${st}_${Date.now()}`,
            promptText: incoming.promptText.trim(),
            updatedAt: new Date().toISOString(),
            updatedBy: performedBy,
          };
        }
      }
      this.config.literaryPrompts = nextPrompts;
    }

    if (Array.isArray(newConfig.literaryPromptVersions)) {
      const cleanedVersions: LiteraryPromptVersion[] = newConfig.literaryPromptVersions
        .filter((v) => v && typeof v.id === 'string' && typeof v.promptText === 'string' && v.promptText.trim().length > 0)
        .map((v) => ({
          id: v.id,
          name: (v.name || 'Versión de Prompt').trim(),
          styleId: v.styleId || v.createdForStyleId || 'first_person_literary',
          createdForStyleId: v.createdForStyleId || v.styleId || 'first_person_literary',
          promptText: v.promptText.trim(),
          createdAt: v.createdAt || new Date().toISOString(),
          updatedAt: v.updatedAt || new Date().toISOString(),
          createdBy: v.createdBy || performedBy,
        }));
      if (cleanedVersions.length > 0) {
        this.config.literaryPromptVersions = cleanedVersions;
      }
    }

    this.config.updatedAt = new Date().toISOString();
    this.config.updatedBy = performedBy;

    await this.persistDoc('settings', 'appConfig', this.config);
    await this.addAuditLog('UPDATE_CONFIG', 'settings', 'appConfig', performedBy, {
      updatedConfig: this.config,
    });

    return { ...this.config };
  }

  // --- Question Bank ---
  public getQuestions(): QuestionRecord[] {
    return Array.from(this.questions.values());
  }

  public async saveQuestion(question: QuestionRecord, performedBy: string): Promise<QuestionRecord> {
    if (!question.text || question.text.trim().length === 0) {
      throw new Error('El texto de la pregunta no puede estar vacío.');
    }
    const existing = this.questions.get(question.id);
    const updated: QuestionRecord = {
      ...question,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
    };
    this.questions.set(updated.id, updated);
    await this.persistDoc('questions', updated.id, updated);

    await this.addAuditLog(
      existing ? 'UPDATE_QUESTION' : 'CREATE_QUESTION',
      'question',
      updated.id,
      performedBy,
      { question: updated }
    );
    return updated;
  }

  public async saveQuestionsBatch(questionsList: QuestionRecord[], performedBy: string): Promise<number> {
    const promises: Promise<void>[] = [];
    for (const q of questionsList) {
      const existing = this.questions.get(q.id);
      const updated: QuestionRecord = {
        ...q,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing ? existing.createdAt : new Date().toISOString(),
      };
      this.questions.set(updated.id, updated);
      promises.push(this.persistDoc('questions', updated.id, updated));
    }
    await Promise.all(promises);
    await this.addAuditLog('IMPORT_QUESTIONS_BATCH', 'question_bank', 'batch', performedBy, {
      count: questionsList.length,
    });
    return questionsList.length;
  }

  public async deleteQuestion(questionId: string, performedBy: string): Promise<boolean> {
    const existing = this.questions.get(questionId);
    if (!existing) {
      throw new Error(`La pregunta con ID "${questionId}" no existe.`);
    }

    this.questions.delete(questionId);
    await this.removeDoc('questions', questionId);

    await this.addAuditLog('DELETE_QUESTION', 'question', questionId, performedBy, {
      deletedQuestion: existing,
    });

    return true;
  }

  public async deleteQuestions(questionIds: string[], performedBy: string): Promise<number> {
    let deletedCount = 0;
    for (const qId of questionIds) {
      if (this.questions.has(qId)) {
        this.questions.delete(qId);
        await this.removeDoc('questions', qId);
        deletedCount++;
      }
    }

    await this.addAuditLog('BATCH_DELETE_QUESTIONS', 'question', 'batch', performedBy, {
      count: deletedCount,
      questionIds,
    });

    return deletedCount;
  }

  public async deleteAllQuestions(performedBy: string): Promise<number> {
    const allIds = Array.from(this.questions.keys());
    const count = allIds.length;

    for (const qId of allIds) {
      this.questions.delete(qId);
      await this.removeDoc('questions', qId);
    }

    await this.addAuditLog('DELETE_ALL_QUESTIONS', 'question', 'all', performedBy, {
      totalDeleted: count,
      deletedIds: allIds,
    });

    return count;
  }

  public async createQuestionnaireVersion(name: string): Promise<string> {
    const versionId = `v_${Date.now()}_${name}`;
    const activeQuestions = Array.from(this.questions.values()).filter((q) => q.active);
    this.questionnaireVersions.set(versionId, activeQuestions);

    const versionDoc: QuestionnaireVersionDoc = {
      id: versionId,
      questions: activeQuestions,
      createdAt: new Date().toISOString(),
    };
    await this.persistDoc('questionnaireVersions', versionId, versionDoc);
    return versionId;
  }

  public getQuestionsForVersion(_versionId: string): QuestionRecord[] {
    // Return active questions from the Question Bank sorted by flow and orderIndex so flow & branch configurations in Banco de Preguntas apply immediately
    return Array.from(this.questions.values())
      .filter((q) => q.active)
      .sort((a, b) => {
        const flowA = a.flowId || 'principal';
        const flowB = b.flowId || 'principal';
        if (flowA !== flowB) {
          if (flowA === 'principal') return -1;
          if (flowB === 'principal') return 1;
          return flowA.localeCompare(flowB);
        }
        return (a.orderIndex ?? 999) - (b.orderIndex ?? 999);
      });
  }

  // --- Interviews ---
  public getInterviews(): InterviewRecord[] {
    return sortInterviewsWithCopies(Array.from(this.interviews.values()));
  }

  public getInterviewById(id: string): InterviewRecord | undefined {
    return this.interviews.get(id);
  }

  public getInterview(id: string): InterviewRecord | undefined {
    return this.interviews.get(id);
  }


  public async createInterview(params: {
    title: string;
    storyMode: 'individual' | 'compartida';
    storyType: string;
    participants: Array<{
      name: string;
      relationship: string;
      role: 'primary' | 'contributor';
      email?: string;
      age?: number | null;
      city?: string;
      privacyAcceptedAt?: string;
      privacyVersion?: string;
    }>;
    customOpenDays?: number;
    customSufficiencyThreshold?: number;
    performedBy: string;
    registrationSource?: 'admin' | 'self_register_free';
  }): Promise<{
    interview: InterviewRecord;
    participantTokens: Array<{
      participant: ParticipantRecord;
      plainToken: string;
      accessCode: string;
      inviteUrl: string;
    }>;
  }> {
    const {
      title,
      storyMode,
      storyType,
      participants: partInputs,
      customOpenDays,
      customSufficiencyThreshold,
      performedBy,
      registrationSource,
    } = params;

    if (!title || title.trim().length === 0) {
      throw new Error('El título de la historia es obligatorio.');
    }

    if (!partInputs || partInputs.length === 0) {
      throw new Error('Debe agregar al menos un participante.');
    }

    if (storyMode === 'compartida' && partInputs.length < 2) {
      throw new Error('Las historias compartidas requieren al menos 2 participantes para contrastar testimonios.');
    }

    // Capture snapshot of current global config
    const openDays = customOpenDays && customOpenDays > 0 ? customOpenDays : this.config.defaultOpenDays;
    const threshold =
      customSufficiencyThreshold && customSufficiencyThreshold > 0
        ? customSufficiencyThreshold
        : this.config.defaultSufficiencyThreshold;

    const now = new Date();
    const expiresAtMs = now.getTime() + openDays * 24 * 60 * 60 * 1000;
    const interviewId = `int_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Create stable snapshot version of active questions
    const versionId = await this.createQuestionnaireVersion(`snap_${interviewId}`);

    const newInterview: InterviewRecord = {
      id: interviewId,
      title: title.trim(),
      storyMode,
      storyType: storyType || 'biografia_personal',
      status: 'open',
      openedAt: now.toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      openDaysAtCreation: openDays,
      sufficiencyThreshold: threshold,
      maxFollowUpsAtCreation: this.config.defaultMaxFollowUps,
      completedQuestionCount: 0,
      sufficiencyStatus: 'not_evaluated',
      userDeclaredComplete: false,
      closedAt: null,
      closureReason: null,
      participantClosingText: null,
      layoutEditsAllowed: 1,
      layoutEditsUsed: 0,
      bookGeneratedCount: 0,
      lastActivityAt: now.toISOString(),
      questionnaireVersionId: versionId,
      createdById: performedBy,
      createdByName: performedBy,
      registrationSource: registrationSource || 'admin',
    };

    this.interviews.set(interviewId, newInterview);
    await this.persistDoc('interviews', interviewId, newInterview);

    // Create participants & cryptographic tokens
    const createdTokens: Array<{
      participant: ParticipantRecord;
      plainToken: string;
      accessCode: string;
      inviteUrl: string;
    }> = [];

    for (let i = 0; i < partInputs.length; i++) {
      const pInput = partInputs[i];
      const partId = `part_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`;
      const participant: ParticipantRecord = {
        id: partId,
        interviewId,
        name: pInput.name.trim(),
        relationship: pInput.relationship || (pInput.role === 'primary' ? 'Titular' : 'Colaborador'),
        role: pInput.role,
        status: 'invited',
        email: pInput.email ? pInput.email.trim() : undefined,
        age: typeof pInput.age === 'number' ? pInput.age : null,
        city: pInput.city ? pInput.city.trim() : undefined,
        privacyAcceptedAt: pInput.privacyAcceptedAt,
        privacyVersion: pInput.privacyVersion,
        joinedAt: undefined,
      };
      this.participants.set(partId, participant);
      await this.persistDoc('participants', partId, participant);

      // Generate cryptographically secure invitation token and friendly access code
      const { plainToken, tokenHash, accessCode } = generateInvitationToken();
      const tokenDoc: PersistedTokenRecord = {
        id: `tok_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
        tokenHash,
        plainToken,
        accessCode,
        interviewId,
        participantId: partId,
        expiresAt: new Date(expiresAtMs).toISOString(),
        revoked: false,
        createdAt: now.toISOString(),
      };

      this.registerTokenInMemory(tokenDoc);
      await this.persistDoc('interviewTokens', tokenDoc.id, tokenDoc);

      const inviteUrl = `/interview?token=${plainToken}`;
      createdTokens.push({ participant, plainToken, accessCode, inviteUrl });
    }

    await this.addAuditLog('CREATE_INTERVIEW', 'interview', interviewId, performedBy, {
      title,
      storyMode,
      participantsCount: partInputs.length,
      openDays,
      threshold,
      registrationSource: registrationSource || 'admin',
    });

    return { interview: newInterview, participantTokens: createdTokens };
  }

  public async createFreeSelfRegisteredInterview(params: {
    payload: FreeRegistrationPayload;
    userAgent?: string;
  }): Promise<{
    interview: InterviewRecord;
    participantTokens: Array<{
      participant: ParticipantRecord;
      plainToken: string;
      accessCode: string;
      inviteUrl: string;
    }>;
  }> {
    const validation = validateFreeRegistrationPayload(params.payload);
    if (!validation.valid || !validation.normalized) {
      throw new Error(validation.error || 'Los datos de registro no son válidos.');
    }

    const { storyMode, storyTitle, participants } = validation.normalized;
    const acceptedAtIso = new Date().toISOString();
    const primaryEmail = participants[0]?.email || 'self_register_free';

    const result = await this.createInterview({
      title: storyTitle,
      storyMode,
      storyType: storyMode === 'compartida' ? 'biografia_familiar' : 'biografia_personal',
      participants: participants.map((p) => ({
        name: p.name,
        email: p.email,
        age: p.age,
        city: p.city,
        relationship: p.relationship,
        role: p.role,
        privacyAcceptedAt: acceptedAtIso,
        privacyVersion: PRIVACY_NOTICE_VERSION,
      })),
      performedBy: `Autorregistro /free (${primaryEmail})`,
      registrationSource: 'self_register_free',
    });

    // Register official privacy consent from /free acceptance so participants enter straight into questions
    for (const item of result.participantTokens) {
      await this.recordPrivacyConsent(item.plainToken, true, params.userAgent || 'self_register_free');
    }

    await this.addAuditLog('SELF_REGISTER_FREE', 'interview', result.interview.id, primaryEmail, {
      storyMode,
      title: result.interview.title,
      participantsCount: result.participantTokens.length,
      privacyVersion: PRIVACY_NOTICE_VERSION,
    });

    return result;
  }

  public async updateInterviewParticipantRegistrations(params: {
    interviewId: string;
    interviewTitle?: string;
    participants: AdminParticipantRegistrationUpdate[];
    performedBy: string;
  }): Promise<{
    interview: InterviewRecord;
    participants: Array<ParticipantRecord & { plainToken?: string; accessCode?: string; inviteUrl?: string }>;
  }> {
    const interview = this.interviews.get(params.interviewId);
    if (!interview) {
      throw new Error('Entrevista no encontrada.');
    }

    const validation = validateAdminRegistrationUpdates({
      interviewTitle: params.interviewTitle,
      participants: params.participants,
    });
    if (!validation.valid || !validation.participants) {
      throw new Error(validation.error || 'Datos de registro inválidos.');
    }

    const nowIso = new Date().toISOString();

    if (validation.interviewTitle && validation.interviewTitle !== interview.title) {
      interview.title = validation.interviewTitle;
      interview.lastActivityAt = nowIso;
      this.interviews.set(interview.id, interview);
      await this.persistDoc('interviews', interview.id, interview);
    }

    const existingParts = Array.from(this.participants.values()).filter(
      (p) => p.interviewId === interview.id
    );
    const existingMap = new Map(existingParts.map((p) => [p.id, p]));

    for (const upd of validation.participants) {
      const target = existingMap.get(upd.participantId);
      if (!target) {
        throw new Error(`El participante ${upd.participantId} no pertenece a esta entrevista.`);
      }

      const updatedParticipant: ParticipantRecord = {
        ...target,
        name: upd.name,
        email: upd.email ? upd.email : undefined,
        age: upd.age,
        city: upd.city ? upd.city : undefined,
        relationship: upd.relationship,
        role: upd.role,
      };

      this.participants.set(updatedParticipant.id, updatedParticipant);
      await this.persistDoc('participants', updatedParticipant.id, updatedParticipant);
    }

    await this.addAuditLog(
      'UPDATE_REGISTRATION_DATA',
      'interview',
      interview.id,
      params.performedBy,
      {
        updatedParticipantIds: validation.participants.map((p) => p.participantId),
        interviewTitle: interview.title,
      }
    );

    return {
      interview,
      participants: this.getParticipantsForInterview(interview.id),
    };
  }

  public async duplicateInterview(
    sourceInterviewId: string,
    performedBy: string
  ): Promise<{
    interview: InterviewRecord;
    participantTokens: Array<{ participant: ParticipantRecord; plainToken: string; accessCode: string; inviteUrl: string }>;
  }> {
    const source = this.interviews.get(sourceInterviewId);
    if (!source) {
      throw new Error('La entrevista original no fue encontrada.');
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const suffix = Math.random().toString(36).substring(2, 7);
    const newInterviewId = `int_${Date.now()}_${suffix}`;

    const sourceParticipants = Array.from(this.participants.values()).filter(
      (p) => p.interviewId === sourceInterviewId
    );
    const primaryParticipant =
      sourceParticipants.find((p) => p.role === 'primary') || sourceParticipants[0];
    const copiedFromName = (primaryParticipant?.name || source.title).trim();

    const clonedInterview: InterviewRecord = {
      ...JSON.parse(JSON.stringify(source)),
      id: newInterviewId,
      copiedFromInterviewId: source.id,
      copiedFromName,
      copiedAt: nowIso,
      adminCopyNote: buildDefaultAdminCopyNote(copiedFromName, now),
    };

    this.interviews.set(newInterviewId, clonedInterview);
    await this.persistDoc('interviews', newInterviewId, clonedInterview);

    // 1. Clone participants and issue brand-new unique tokens/accessCodes (keeping original tokens untouched)
    const participantIdMap = new Map<string, string>();
    const existingCodes = new Set<string>(
      Array.from(this.tokens.values())
        .map((t) => (t.accessCode || '').toUpperCase())
        .filter(Boolean)
    );
    const createdTokens: Array<{
      participant: ParticipantRecord;
      plainToken: string;
      accessCode: string;
      inviteUrl: string;
    }> = [];

    const sourceTokens = Array.from(this.tokens.values()).filter(
      (t) => t.interviewId === sourceInterviewId
    );

    for (let i = 0; i < sourceParticipants.length; i++) {
      const sp = sourceParticipants[i];
      const newPartId = `part_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`;
      participantIdMap.set(sp.id, newPartId);

      const clonedPart: ParticipantRecord = {
        ...JSON.parse(JSON.stringify(sp)),
        id: newPartId,
        interviewId: newInterviewId,
      };
      this.participants.set(newPartId, clonedPart);
      await this.persistDoc('participants', newPartId, clonedPart);

      const oldTok = sourceTokens.find((t) => t.participantId === sp.id && !t.revoked) ||
        sourceTokens.find((t) => t.participantId === sp.id);

      let generated = generateInvitationToken();
      let guard = 0;
      while (
        (this.plainTokenMap.has(generated.plainToken) ||
          this.tokens.has(generated.tokenHash) ||
          existingCodes.has(generated.accessCode.toUpperCase())) &&
        guard < 20
      ) {
        generated = generateInvitationToken();
        guard++;
      }
      existingCodes.add(generated.accessCode.toUpperCase());

      const newTokenDoc: PersistedTokenRecord = {
        id: `tok_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
        tokenHash: generated.tokenHash,
        plainToken: generated.plainToken,
        accessCode: generated.accessCode,
        interviewId: newInterviewId,
        participantId: newPartId,
        expiresAt: oldTok?.expiresAt || source.expiresAt,
        revoked: false,
        createdAt: nowIso,
      };
      this.registerTokenInMemory(newTokenDoc);
      await this.persistDoc('interviewTokens', newTokenDoc.id, newTokenDoc);

      createdTokens.push({
        participant: clonedPart,
        plainToken: generated.plainToken,
        accessCode: generated.accessCode,
        inviteUrl: `/interview?token=${generated.plainToken}`,
      });
    }

    // 2. Clone photos & binary buffers
    const photoIdMap = new Map<string, string>();
    const sourcePhotos = this.getPhotosForInterview(sourceInterviewId);
    for (let i = 0; i < sourcePhotos.length; i++) {
      const sp = sourcePhotos[i];
      const newPhotoId = `photo_${newInterviewId}_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`;
      photoIdMap.set(sp.id, newPhotoId);

      const bufObj = this.getPhotoBuffer(sp.id);
      let clonedDataUrl = sp.dataUrl || '';
      if (bufObj) {
        try {
          const photoDir = path.join(process.cwd(), 'data', 'photos');
          if (!fs.existsSync(photoDir)) {
            fs.mkdirSync(photoDir, { recursive: true });
          }
          fs.writeFileSync(path.join(photoDir, `${newPhotoId}.bin`), bufObj.buffer);
          if (!clonedDataUrl || !clonedDataUrl.startsWith('data:image/')) {
            clonedDataUrl = `data:${bufObj.mimeType || 'image/jpeg'};base64,${bufObj.buffer.toString('base64')}`;
          }
        } catch (diskErr) {
          console.warn('Could not duplicate photo binary on disk:', diskErr);
        }
      }

      const newParticipantId = participantIdMap.get(sp.participantId) || sp.participantId;
      const clonedPhoto: InterviewPhotoRecord = {
        ...JSON.parse(JSON.stringify(sp)),
        id: newPhotoId,
        interviewId: newInterviewId,
        participantId: newParticipantId,
        imageUrl: `/api/photos/${newPhotoId}`,
        dataUrl: clonedDataUrl,
      };
      this.photos.set(newPhotoId, clonedPhoto);

      const firestorePhotoRecord: any = { ...clonedPhoto };
      if (firestorePhotoRecord.dataUrl && firestorePhotoRecord.dataUrl.length > 750_000) {
        firestorePhotoRecord.dataUrl = '';
        firestorePhotoRecord.storedOnDisk = true;
      }
      await this.persistDoc('interviewPhotos', newPhotoId, firestorePhotoRecord);
    }

    // 3. Clone audios & binary buffers
    const audioIdMap = new Map<string, string>();
    const sourceAudios = this.getAudiosForInterview(sourceInterviewId);
    for (let i = 0; i < sourceAudios.length; i++) {
      const sa = sourceAudios[i];
      const newAudioId = `audio_${newInterviewId}_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`;
      audioIdMap.set(sa.id, newAudioId);

      const audioBuf = this.getAudioBuffer(sa.id);
      if (audioBuf) {
        try {
          const audioDir = path.join(process.cwd(), 'data', 'audios');
          if (!fs.existsSync(audioDir)) {
            fs.mkdirSync(audioDir, { recursive: true });
          }
          fs.writeFileSync(path.join(audioDir, `${newAudioId}.bin`), audioBuf.buffer);
        } catch (diskErr) {
          console.warn('Could not duplicate audio binary on disk:', diskErr);
        }
      }

      const newParticipantId = participantIdMap.get(sa.participantId) || sa.participantId;
      const clonedAudio: InterviewAudioRecord = {
        ...JSON.parse(JSON.stringify(sa)),
        id: newAudioId,
        interviewId: newInterviewId,
        participantId: newParticipantId,
        audioUrl: `/api/audios/${newAudioId}`,
      };
      this.audios.set(newAudioId, clonedAudio);

      const firestoreAudioRecord: any = { ...clonedAudio };
      if (firestoreAudioRecord.audioDataUrl && firestoreAudioRecord.audioDataUrl.length > 50_000) {
        firestoreAudioRecord.audioDataUrl = '';
        firestoreAudioRecord.storedOnDisk = true;
      }
      await this.persistDoc('interviewAudio', newAudioId, firestoreAudioRecord);
    }

    // 4. Clone answers with remapped participantId, photoIds, and audioIds
    const sourceAnswers = this.getAnswersForInterview(sourceInterviewId);
    for (let i = 0; i < sourceAnswers.length; i++) {
      const sa = sourceAnswers[i];
      const newAnsId = `ans_${newInterviewId}_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`;
      const remappedParticipantId = participantIdMap.get(sa.participantId) || sa.participantId;

      const remappedPhotos = Array.isArray(sa.photos)
        ? sa.photos.map((p) => {
            const mappedPid = photoIdMap.get(p.id) || p.id;
            return {
              ...JSON.parse(JSON.stringify(p)),
              id: mappedPid,
              interviewId: newInterviewId,
              participantId: participantIdMap.get(p.participantId) || remappedParticipantId,
              imageUrl:
                p.imageUrl && p.imageUrl.startsWith('data:')
                  ? p.imageUrl
                  : `/api/photos/${mappedPid}`,
            };
          })
        : undefined;

      const remapAudioAtt = (a: AnswerVoiceAttachment): AnswerVoiceAttachment => {
        const mappedAid = audioIdMap.get(a.id) || a.id;
        return {
          ...JSON.parse(JSON.stringify(a)),
          id: mappedAid,
          interviewId: newInterviewId,
          participantId: participantIdMap.get(a.participantId) || remappedParticipantId,
          audioUrl: `/api/audios/${mappedAid}`,
        };
      };

      const clonedAns: AnswerRecord = {
        ...JSON.parse(JSON.stringify(sa)),
        id: newAnsId,
        interviewId: newInterviewId,
        participantId: remappedParticipantId,
        ...(remappedPhotos ? { photos: remappedPhotos } : {}),
        ...(sa.audio ? { audio: remapAudioAtt(sa.audio) } : {}),
        ...(Array.isArray(sa.audioRecordings)
          ? { audioRecordings: sa.audioRecordings.map(remapAudioAtt) }
          : {}),
      };
      this.answers.set(newAnsId, clonedAns);
      await this.persistDoc('answers', newAnsId, clonedAns);
    }

    // 5. Clone manuscripts
    const sourceManuscripts = this.getManuscriptsForInterview(sourceInterviewId);
    for (let i = 0; i < sourceManuscripts.length; i++) {
      const sm = sourceManuscripts[i];
      const newManuId = `manu_${newInterviewId}_${Date.now()}_${i}`;
      const clonedManu: ManuscriptRecord = {
        ...JSON.parse(JSON.stringify(sm)),
        id: newManuId,
        interviewId: newInterviewId,
      };
      this.manuscripts.set(newManuId, clonedManu);
      await this.persistDoc('manuscripts', newManuId, clonedManu);
    }

    // 6. Clone generated PDF book versions
    const sourceBookVersions = Array.from(this.participantBookVersions.values()).filter(
      (v) => v.interviewId === sourceInterviewId
    );
    const remapDemoPhoto = (p: DemoInMemoryPhoto | null | undefined): DemoInMemoryPhoto | null => {
      if (!p) return null;
      const cloned = JSON.parse(JSON.stringify(p)) as DemoInMemoryPhoto;
      const mappedId = photoIdMap.get(cloned.id) || cloned.id;
      cloned.id = mappedId;
      if (cloned.objectUrl && cloned.objectUrl.startsWith('/api/photos/')) {
        cloned.objectUrl = `/api/photos/${mappedId}`;
      }
      return cloned;
    };

    for (let i = 0; i < sourceBookVersions.length; i++) {
      const sbv = sourceBookVersions[i];
      const newBvId = `pbv_${newInterviewId}_v${sbv.versionNumber}_${Date.now()}_${i}`;
      const clonedBv: ParticipantBookVersionRecord = JSON.parse(JSON.stringify(sbv));
      clonedBv.id = newBvId;
      clonedBv.interviewId = newInterviewId;
      clonedBv.participantId = participantIdMap.get(sbv.participantId) || sbv.participantId;
      clonedBv.coverPhoto = remapDemoPhoto(clonedBv.coverPhoto);

      if (clonedBv.chapterPhotos) {
        for (const chKey of Object.keys(clonedBv.chapterPhotos)) {
          clonedBv.chapterPhotos[chKey] = remapDemoPhoto(clonedBv.chapterPhotos[chKey]);
        }
      }

      if (clonedBv.allPhotosById) {
        const remappedAll: Record<string, DemoInMemoryPhoto> = {};
        for (const [oldPid, pObj] of Object.entries(clonedBv.allPhotosById)) {
          const remapped = remapDemoPhoto(pObj);
          if (remapped) {
            remappedAll[remapped.id || oldPid] = remapped;
          }
        }
        clonedBv.allPhotosById = remappedAll;
      }

      if (clonedBv.manuscript?.chapters) {
        clonedBv.manuscript.chapters = clonedBv.manuscript.chapters.map((ch) => ({
          ...ch,
          photoPlacements: (ch.photoPlacements || []).map((pl) => ({
            ...pl,
            photoId: photoIdMap.get(pl.photoId) || pl.photoId,
          })),
        }));
      }

      this.participantBookVersions.set(newBvId, clonedBv);
      await this.persistDoc(
        'participantBookVersions',
        newBvId,
        this.sanitizeDocForFirestore(clonedBv)
      );
    }

    // 7. Clone privacy consents, book shares, scheduled deliveries, secondary access, post-mortem, and ARCO
    for (const consent of Array.from(this.privacyConsents.values())) {
      if (consent.interviewId === sourceInterviewId) {
        const newCid = `consent_${newInterviewId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const clonedConsent: PrivacyConsentRecord = {
          ...JSON.parse(JSON.stringify(consent)),
          id: newCid,
          interviewId: newInterviewId,
          participantId: participantIdMap.get(consent.participantId) || consent.participantId,
        };
        this.privacyConsents.set(newCid, clonedConsent);
        await this.persistDoc('privacyConsents', newCid, clonedConsent);
      }
    }

    for (const share of Array.from(this.bookShares.values())) {
      if (share.interviewId === sourceInterviewId) {
        const newSid = `share_${newInterviewId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const clonedShare: BookShareRecord = {
          ...JSON.parse(JSON.stringify(share)),
          id: newSid,
          interviewId: newInterviewId,
          participantId: participantIdMap.get(share.participantId) || share.participantId,
        };
        this.bookShares.set(newSid, clonedShare);
        await this.persistDoc('bookShares', newSid, clonedShare);
      }
    }

    for (const deliv of Array.from(this.scheduledDeliveries.values())) {
      if (deliv.interviewId === sourceInterviewId) {
        const newDid = `deliv_${newInterviewId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const clonedDeliv: ScheduledDeliveryRecord = {
          ...JSON.parse(JSON.stringify(deliv)),
          id: newDid,
          interviewId: newInterviewId,
          participantId: participantIdMap.get(deliv.participantId) || deliv.participantId,
        };
        this.scheduledDeliveries.set(newDid, clonedDeliv);
        await this.persistDoc('scheduledDeliveries', newDid, clonedDeliv);
      }
    }

    for (const sec of Array.from(this.secondaryAccess.values())) {
      if (sec.interviewId === sourceInterviewId) {
        const newSecId = `sec_${newInterviewId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const clonedSec: SecondaryAccessRecord = {
          ...JSON.parse(JSON.stringify(sec)),
          id: newSecId,
          interviewId: newInterviewId,
          participantId: participantIdMap.get(sec.participantId) || sec.participantId,
        };
        this.secondaryAccess.set(newSecId, clonedSec);
        await this.persistDoc('secondaryAccess', newSecId, clonedSec);
      }
    }

    for (const pmi of Array.from(this.postMortemInstructions.values())) {
      if (pmi.interviewId === sourceInterviewId) {
        const newPmiId = `pmi_${newInterviewId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const clonedPmi: PostMortemInstructionRecord = {
          ...JSON.parse(JSON.stringify(pmi)),
          id: newPmiId,
          interviewId: newInterviewId,
          participantId: participantIdMap.get(pmi.participantId) || pmi.participantId,
        };
        this.postMortemInstructions.set(newPmiId, clonedPmi);
        await this.persistDoc('postMortemInstructions', newPmiId, clonedPmi);
      }
    }

    for (const arco of Array.from(this.arcoRequests.values())) {
      if (arco.interviewId === sourceInterviewId) {
        const newArcoId = `arco_${newInterviewId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const clonedArco: ArcoRequestRecord = {
          ...JSON.parse(JSON.stringify(arco)),
          id: newArcoId,
          interviewId: newInterviewId,
          participantId: participantIdMap.get(arco.participantId) || arco.participantId,
        };
        this.arcoRequests.set(newArcoId, clonedArco);
        await this.persistDoc('arcoRequests', newArcoId, clonedArco);
      }
    }

    this.saveStateToDisk();

    await this.addAuditLog('DUPLICATE_INTERVIEW', 'interview', sourceInterviewId, performedBy, {
      sourceInterviewId,
      duplicatedInterviewId: newInterviewId,
      copiedFromName,
      newCodesCount: createdTokens.length,
    });

    return { interview: clonedInterview, participantTokens: createdTokens };
  }

  public async updateAdminCopyNote(
    interviewId: string,
    adminCopyNote: string,
    performedBy: string
  ): Promise<InterviewRecord> {
    const interview = this.interviews.get(interviewId);
    if (!interview) {
      throw new Error('Entrevista no encontrada.');
    }

    const updated: InterviewRecord = {
      ...interview,
      adminCopyNote: (adminCopyNote || '').trim(),
    };
    this.interviews.set(interviewId, updated);
    await this.persistDoc('interviews', interviewId, updated);
    this.saveStateToDisk();

    await this.addAuditLog('UPDATE_ADMIN_COPY_NOTE', 'interview', interviewId, performedBy, {
      updatedBy: performedBy,
    });

    return updated;
  }

  // --- Tokens & Security ---
  public resolveToken(rawInput: string): {
    token: InterviewTokenRecord;
    interview: InterviewRecord;
    participant: ParticipantRecord;
  } {
    if (!rawInput || !rawInput.trim()) {
      throw new Error('Debe proporcionar un token o código de acceso.');
    }

    // Ensure every known participant has a consistent token registered
    this.ensureParticipantTokensConsistent();

    const cleaned = extractCleanTokenOrCode(rawInput);
    const upperInput = cleaned.toUpperCase();
    const lowerInput = cleaned.toLowerCase();

    // 1. Fast map lookup (accessCode, plainToken, or hash)
    let targetHash =
      this.accessCodeMap.get(upperInput) ||
      this.accessCodeMap.get(upperInput.replace(/[^A-Z0-9]/g, '')) ||
      this.plainTokenMap.get(cleaned) ||
      this.plainTokenMap.get(lowerInput);

    if (!targetHash) {
      const hashed = hashToken(cleaned);
      const hashedLower = hashToken(lowerInput);
      if (this.tokens.has(hashed)) {
        targetHash = hashed;
      } else if (this.tokens.has(hashedLower)) {
        targetHash = hashedLower;
      } else if (this.tokens.has(cleaned)) {
        targetHash = cleaned;
      } else if (this.tokens.has(lowerInput)) {
        targetHash = lowerInput;
      }
    }

    let tokenDoc = targetHash ? this.tokens.get(targetHash) : undefined;

    // 2. Comprehensive fallback scan across all token records
    if (!tokenDoc) {
      tokenDoc = matchTokenRecord(rawInput, this.tokens.values());
    }

    if (!tokenDoc) {
      throw new Error('El enlace o código de acceso no es válido o no existe.');
    }

    const interview = this.interviews.get(tokenDoc.interviewId);
    if (!interview) {
      throw new Error('La entrevista asociada no existe.');
    }

    // If the parent interview is open and unexpired, keep the unrevoked token's expiration in sync
    if (
      !tokenDoc.revoked &&
      interview.status === 'open' &&
      new Date(interview.expiresAt).getTime() > Date.now() &&
      new Date(tokenDoc.expiresAt).getTime() < new Date(interview.expiresAt).getTime()
    ) {
      tokenDoc.expiresAt = interview.expiresAt;
    }

    if (!isTokenActive(tokenDoc)) {
      throw new Error(
        tokenDoc.revoked
          ? 'Esta invitación ha sido revocada por el administrador.'
          : 'El enlace de invitación ha vencido.'
      );
    }

    const participant = this.participants.get(tokenDoc.participantId);
    if (!participant) {
      throw new Error('El participante asociado no existe.');
    }

    // Update last used and participant status
    tokenDoc.lastUsedAt = new Date().toISOString();
    void this.persistDoc('interviewTokens', tokenDoc.id, tokenDoc);

    if (participant.status === 'invited') {
      participant.status = 'active';
      participant.joinedAt = new Date().toISOString();
      void this.persistDoc('participants', participant.id, participant);
    }

    return { token: tokenDoc, interview, participant };
  }

  public async revokeToken(tokenId: string, performedBy: string): Promise<InterviewTokenRecord> {
    for (const token of this.tokens.values()) {
      if (token.id === tokenId) {
        token.revoked = true;
        token.revokedAt = new Date().toISOString();
        await this.persistDoc('interviewTokens', token.id, token);
        await this.addAuditLog('REVOKE_TOKEN', 'token', tokenId, performedBy, {
          interviewId: token.interviewId,
          participantId: token.participantId,
        });
        return token;
      }
    }
    throw new Error('Token no encontrado.');
  }

  // --- Photos Management ---
  public savePhotoBinaryToDisk(photoId: string, dataUrl: string): void {
    try {
      const photoDir = path.join(process.cwd(), 'data', 'photos');
      if (!fs.existsSync(photoDir)) {
        fs.mkdirSync(photoDir, { recursive: true });
      }
      let rawBase64 = dataUrl;
      if (rawBase64.startsWith('data:')) {
        const cIdx = rawBase64.indexOf(',');
        if (cIdx !== -1) rawBase64 = rawBase64.substring(cIdx + 1);
      }
      fs.writeFileSync(
        path.join(photoDir, `${photoId}.bin`),
        Buffer.from(rawBase64.replace(/\s+/g, ''), 'base64')
      );
    } catch (diskErr) {
      console.warn('[Disk Photo Storage Note]:', diskErr);
    }
  }

  private buildArchivalSepiaPngBuffer(seedText: string): Buffer {
    const width = 480;
    const height = 320;
    let hash = 2166136261;
    for (let i = 0; i < seedText.length; i++) {
      hash ^= seedText.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const sunCenterX = 145 + (Math.abs(hash) % 190);
    const sunCenterY = 108 + (Math.abs(hash >> 8) % 28);
    const hillPhase = (Math.abs(hash >> 16) % 100) / 100;

    // Each scanline has 1 filter byte (0) + width * 3 RGB bytes
    const rowSize = 1 + width * 3;
    const rawData = Buffer.alloc(rowSize * height);

    for (let y = 0; y < height; y++) {
      const rowOffset = y * rowSize;
      rawData[rowOffset] = 0; // Filter type 0 (None)
      const ny = y / height;

      for (let x = 0; x < width; x++) {
        const nx = x / width;
        const pxOffset = rowOffset + 1 + x * 3;

        // Outer cream border & inner vintage sepia mat line
        const isOuterMat = x < 14 || x >= width - 14 || y < 14 || y >= height - 14;
        const isFrameLine =
          (x >= 18 && x <= width - 19 && (y === 18 || y === 19 || y === height - 19 || y === height - 20)) ||
          (y >= 18 && y <= height - 19 && (x === 18 || x === 19 || x === width - 19 || x === width - 20));

        if (isOuterMat) {
          rawData[pxOffset] = 246;
          rawData[pxOffset + 1] = 240;
          rawData[pxOffset + 2] = 228;
          continue;
        }
        if (isFrameLine) {
          rawData[pxOffset] = 146;
          rawData[pxOffset + 1] = 112;
          rawData[pxOffset + 2] = 72;
          continue;
        }

        // Base warm sepia sky gradient
        let r = Math.round(244 - ny * 26);
        let g = Math.round(233 - ny * 34);
        let b = Math.round(212 - ny * 44);

        // Soft glowing sun disc
        const dxSun = x - sunCenterX;
        const dySun = y - sunCenterY;
        const distSun = Math.sqrt(dxSun * dxSun + dySun * dySun);
        if (distSun < 34) {
          r = 250;
          g = 241;
          b = 220;
        } else if (distSun < 62) {
          const glow = (62 - distSun) / 28;
          r = Math.min(252, Math.round(r + glow * 14));
          g = Math.min(244, Math.round(g + glow * 12));
          b = Math.min(225, Math.round(b + glow * 10));
        }

        // Far horizon ridge
        const ridge1Y =
          Math.round(height * 0.58 + Math.sin((nx + hillPhase) * Math.PI * 2.2) * 22 + Math.cos(nx * 5.1) * 9);
        // Midground warm hill
        const ridge2Y =
          Math.round(height * 0.69 + Math.cos((nx * 1.8 + hillPhase) * Math.PI * 2) * 18);
        // Foreground sepia terrace
        const ridge3Y =
          Math.round(height * 0.81 + Math.sin((nx * 1.4 - hillPhase) * Math.PI * 2) * 12);

        if (y >= ridge3Y) {
          r = 126;
          g = 96;
          b = 64;
        } else if (y >= ridge2Y) {
          r = 158;
          g = 126;
          b = 89;
        } else if (y >= ridge1Y) {
          r = 188;
          g = 158;
          b = 120;
        }

        // Gentle photographic vignette
        const vx = nx - 0.5;
        const vy = ny - 0.5;
        const vig = Math.max(0, 1 - (vx * vx + vy * vy) * 0.55);
        rawData[pxOffset] = Math.max(0, Math.min(255, Math.round(r * vig)));
        rawData[pxOffset + 1] = Math.max(0, Math.min(255, Math.round(g * vig)));
        rawData[pxOffset + 2] = Math.max(0, Math.min(255, Math.round(b * vig)));
      }
    }

    const crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }

    const crc32 = (buf: Buffer): number => {
      let c = 0xffffffff;
      for (let i = 0; i < buf.length; i++) {
        c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
      }
      return (c ^ 0xffffffff) >>> 0;
    };

    const makeChunk = (type: string, data: Buffer): Buffer => {
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32BE(data.length, 0);
      const typeBuf = Buffer.from(type, 'ascii');
      const crcInput = Buffer.concat([typeBuf, data]);
      const crcBuf = Buffer.alloc(4);
      crcBuf.writeUInt32BE(crc32(crcInput), 0);
      return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
    };

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // 8-bit depth
    ihdr[9] = 2; // RGB colorType
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    const idatData = zlib.deflateSync(rawData, { level: 6 });
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    return Buffer.concat([
      pngSignature,
      makeChunk('IHDR', ihdr),
      makeChunk('IDAT', idatData),
      makeChunk('IEND', Buffer.alloc(0)),
    ]);
  }

  public getPhotoBuffer(photoId: string): { buffer: Buffer; mimeType: string } | null {
    const photo = this.photos.get(photoId);
    const photoDir = path.join(process.cwd(), 'data', 'photos');
    const diskPath = path.join(photoDir, `${photoId}.bin`);

    if (fs.existsSync(diskPath)) {
      try {
        const buf = fs.readFileSync(diskPath);
        const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
        return { buffer: buf, mimeType: isPng ? 'image/png' : photo?.mimeType || 'image/jpeg' };
      } catch (err) {
        console.warn('Error reading photo from disk:', err);
      }
    }

    if (
      photo?.dataUrl &&
      photo.dataUrl.length > 32 &&
      !photo.dataUrl.startsWith('data:image/svg')
    ) {
      let raw = photo.dataUrl;
      let resolvedMime = photo.mimeType || 'image/jpeg';
      if (raw.startsWith('data:')) {
        const cIdx = raw.indexOf(',');
        const header = raw.slice(5, cIdx);
        resolvedMime = header.split(';')[0]?.trim() || resolvedMime;
        if (cIdx !== -1) raw = raw.substring(cIdx + 1);
      }
      return {
        buffer: Buffer.from(raw.replace(/\s+/g, ''), 'base64'),
        mimeType: resolvedMime,
      };
    }

    // Check if an answer holds an inline raster dataUrl for this photoId
    for (const ans of this.answers.values()) {
      for (const att of ans.photos || []) {
        if (att && att.id === photoId) {
          const attUrl = (att as any).dataUrl || att.imageUrl;
          if (
            typeof attUrl === 'string' &&
            attUrl.startsWith('data:image/') &&
            !attUrl.startsWith('data:image/svg')
          ) {
            const cIdx = attUrl.indexOf(',');
            const header = attUrl.slice(5, cIdx);
            const resolvedMime = header.split(';')[0]?.trim() || 'image/jpeg';
            if (cIdx !== -1) {
              const raw = attUrl.substring(cIdx + 1);
              return {
                buffer: Buffer.from(raw.replace(/\s+/g, ''), 'base64'),
                mimeType: resolvedMime,
              };
            }
          }
        }
      }
    }

    // If a legacy photo record exists in metadata but its binary was stripped in an older snapshot,
    // generate and persist a genuine raster PNG sepia photograph so both browser <img> and jsPDF render it visibly.
    if (photo || photoId.startsWith('photo_')) {
      const pngBuffer = this.buildArchivalSepiaPngPngWithCache(photoId, photo?.questionText || photoId);
      return {
        buffer: pngBuffer,
        mimeType: 'image/png',
      };
    }

    return null;
  }

  private buildArchivalSepiaPngPngWithCache(photoId: string, seedText: string): Buffer {
    const pngBuffer = this.buildArchivalSepiaPngBuffer(seedText);
    try {
      const photoDir = path.join(process.cwd(), 'data', 'photos');
      if (!fs.existsSync(photoDir)) {
        fs.mkdirSync(photoDir, { recursive: true });
      }
      fs.writeFileSync(path.join(photoDir, `${photoId}.bin`), pngBuffer);
      const existing = this.photos.get(photoId);
      if (existing) {
        existing.mimeType = 'image/png';
        existing.dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
        this.photos.set(photoId, existing);
      }
    } catch (_e) {
      // Ignore disk write issues
    }
    return pngBuffer;
  }

  public getPhotoById(photoId: string): InterviewPhotoRecord | undefined {
    return this.photos.get(photoId);
  }

  public async getPhotoByIdAsync(photoId: string): Promise<InterviewPhotoRecord | undefined> {
    const cached = this.photos.get(photoId);
    if (cached) return cached;
    try {
      const snap = await firestoreTelemetry.trackedGetDoc(
        serverDb,
        doc(serverDb, 'interviewPhotos', photoId),
        'storage'
      );
      if (snap.exists()) {
        const ph = snap.data() as InterviewPhotoRecord;
        if (ph) {
          this.photos.set(photoId, ph);
          return ph;
        }
      }
    } catch (err) {
      console.warn(`[getPhotoByIdAsync] Error loading photo ${photoId} from Firestore:`, err);
    }
    return undefined;
  }

  public getPhotosForInterview(interviewId: string): InterviewPhotoRecord[] {
    const activePhotoIds = new Set<string>();
    for (const ans of this.answers.values()) {
      if (ans.interviewId === interviewId && Array.isArray(ans.photos)) {
        for (const p of ans.photos) {
          if (p && p.id) {
            activePhotoIds.add(p.id);
          }
        }
      }
    }

    return Array.from(this.photos.values())
      .filter((p) => p.interviewId === interviewId && activePhotoIds.has(p.id))
      .map((p) => {
        if (
          !p.dataUrl ||
          !p.dataUrl.startsWith('data:image/') ||
          p.dataUrl.startsWith('data:image/svg')
        ) {
          const bufObj = this.getPhotoBuffer(p.id);
          if (bufObj) {
            const hydrated = `data:${bufObj.mimeType || 'image/png'};base64,${bufObj.buffer.toString('base64')}`;
            p.dataUrl = hydrated;
            p.mimeType = bufObj.mimeType || 'image/png';
            this.photos.set(p.id, p);
          }
        }
        return p;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  private async syncInterviewManuscriptsAndCompilationAfterPhotoChange(interviewId: string): Promise<void> {
    const answers = this.getAnswersForInterview(interviewId);
    const questions = Array.from(this.questions.values());
    for (const manu of this.manuscripts.values()) {
      if (manu.interviewId !== interviewId) continue;
      const cleanedContent = ensurePhotosPlacedInManuscript({
        compiledMarkdown: manu.content,
        answers,
        questions,
      });
      if (cleanedContent !== manu.content) {
        manu.content = cleanedContent;
        this.manuscripts.set(manu.id, manu);
        await this.persistDoc('manuscripts', manu.id, manu);
      }
    }

    try {
      const { miEsenciaStore } = await import('./miEsencia/miEsenciaStore.ts');
      await miEsenciaStore.ensureInterviewCompilationPdf(interviewId);
    } catch (_err) {
      // Ignore if interview has no testimonies yet
    }
  }

  public async purgeOrphanedPhotosAndSyncCompilations(): Promise<number> {
    const activePhotoIds = new Set<string>();
    for (const ans of this.answers.values()) {
      if (Array.isArray(ans.photos)) {
        for (const p of ans.photos) {
          if (p && p.id) {
            activePhotoIds.add(p.id);
          }
        }
      }
    }

    const affectedInterviewIds = new Set<string>();
    let purgedCount = 0;

    for (const [photoId, photo] of Array.from(this.photos.entries())) {
      if (!activePhotoIds.has(photoId)) {
        this.photos.delete(photoId);
        purgedCount++;
        if (photo?.interviewId) {
          affectedInterviewIds.add(photo.interviewId);
        }
        try {
          const photoDir = path.join(process.cwd(), 'data', 'photos');
          const diskPath = path.join(photoDir, `${photoId}.bin`);
          if (fs.existsSync(diskPath)) {
            fs.unlinkSync(diskPath);
          }
        } catch (_diskErr) {
          // ignore
        }
        await this.removeDoc('interviewPhotos', photoId);
      }
    }

    // Also ensure any existing manuscripts with stale photo references are cleaned
    const questions = Array.from(this.questions.values());
    for (const manu of this.manuscripts.values()) {
      const answers = this.getAnswersForInterview(manu.interviewId);
      const cleanedContent = ensurePhotosPlacedInManuscript({
        compiledMarkdown: manu.content,
        answers,
        questions,
      });
      if (cleanedContent !== manu.content) {
        manu.content = cleanedContent;
        this.manuscripts.set(manu.id, manu);
        affectedInterviewIds.add(manu.interviewId);
        await this.persistDoc('manuscripts', manu.id, manu);
      }
    }

    if (purgedCount > 0 || affectedInterviewIds.size > 0) {
      this.saveStateToDisk();
      for (const intId of affectedInterviewIds) {
        await this.syncInterviewManuscriptsAndCompilationAfterPhotoChange(intId);
      }
    }

    return purgedCount;
  }

  public async deletePhotoForParticipant(
    plainToken: string,
    photoId: string
  ): Promise<{ deletedPhotoId: string; updatedAnswer?: AnswerRecord }> {
    const { interview, participant } = this.resolveToken(plainToken);
    const existingPhoto = this.photos.get(photoId);

    if (existingPhoto && existingPhoto.interviewId !== interview.id) {
      throw new Error('No tienes permiso para eliminar una fotografía de otra entrevista.');
    }

    this.photos.delete(photoId);
    try {
      const photoDir = path.join(process.cwd(), 'data', 'photos');
      const diskPath = path.join(photoDir, `${photoId}.bin`);
      if (fs.existsSync(diskPath)) {
        fs.unlinkSync(diskPath);
      }
    } catch (diskErr) {
      console.warn('Error deleting photo binary from disk:', diskErr);
    }

    await this.removeDoc('interviewPhotos', photoId);

    // Also remove from any answer record in this interview that references this photoId
    let updatedAnswer: AnswerRecord | undefined;
    for (const ans of this.answers.values()) {
      if (ans.interviewId === interview.id && ans.photos && ans.photos.some((p) => p.id === photoId)) {
        ans.photos = ans.photos.filter((p) => p.id !== photoId);
        ans.updatedAt = new Date().toISOString();
        this.answers.set(ans.id, ans);
        updatedAnswer = ans;
        await this.persistDoc('answers', ans.id, ans);
      }
    }

    this.saveStateToDisk();
    await this.syncInterviewManuscriptsAndCompilationAfterPhotoChange(interview.id);

    await this.addAuditLog('DELETE_PHOTO', 'photo', photoId, participant.name, {
      interviewId: interview.id,
      participantId: participant.id,
    });

    return { deletedPhotoId: photoId, updatedAnswer };
  }

  // --- Voice Recordings and Transcriptions Management ---
  public getAudioById(audioId: string): InterviewAudioRecord | undefined {
    return this.audios.get(audioId);
  }

  public async getAudioByIdAsync(audioId: string): Promise<InterviewAudioRecord | undefined> {
    const cached = this.audios.get(audioId);
    if (cached) return cached;
    try {
      const snap = await firestoreTelemetry.trackedGetDoc(
        serverDb,
        doc(serverDb, 'interviewAudio', audioId),
        'storage'
      );
      if (snap.exists()) {
        const aud = snap.data() as InterviewAudioRecord;
        if (aud) {
          this.audios.set(audioId, aud);
          return aud;
        }
      }
    } catch (err) {
      console.warn(`[getAudioByIdAsync] Error loading audio ${audioId} from Firestore:`, err);
    }
    return undefined;
  }

  public getAudiosForInterview(interviewId: string): InterviewAudioRecord[] {
    return Array.from(this.audios.values())
      .filter((a) => a.interviewId === interviewId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  public async saveVoiceRecording(params: {
    plainToken: string;
    questionId: string;
    questionText?: string;
    audioBase64: string;
    mimeType?: string;
    durationSeconds?: number;
    clientTranscription?: string;
  }): Promise<InterviewAudioRecord> {
    const { interview, participant } = this.resolveToken(params.plainToken);

    const questionObj = this.questions.get(params.questionId);
    const resolvedQuestionText =
      params.questionText || questionObj?.text || 'Pregunta de la entrevista';

    const mimeType = params.mimeType || 'audio/webm';
    let transcription = '';
    let audioQuality: AudioQualityStatus = 'clear';
    let qualityWarning: string | undefined;
    let suggestion: string | undefined;

    // Generate strict non-hallucinating Spanish transcription & acoustic quality diagnosis with Gemini
    try {
      const diagnosis = await analyzeAndTranscribeAudioWithGemini({
        audioBase64: params.audioBase64,
        mimeType,
      });
      transcription = diagnosis.transcription || '';
      audioQuality = diagnosis.audioQuality;
      qualityWarning = diagnosis.qualityWarning;
      suggestion = diagnosis.suggestion;
    } catch (_err) {
      audioQuality = 'unintelligible';
      qualityWarning =
        'No hemos logrado escucharte correctamente ni identificar palabras legibles en tu grabación.';
      suggestion =
        'Si hay ruido de fondo, te sugerimos moverte a un lugar sin ruido y revisar tu micrófono. Recuerda que también tienes la opción de escribir tu respuesta por tu cuenta usando el teclado.';
    }

    // Only use client-provided live speech recognition if it captured real words and Gemini returned empty
    if (!transcription || transcription.trim().length === 0) {
      if (params.clientTranscription && params.clientTranscription.trim().length >= 3) {
        transcription = params.clientTranscription.trim();
        if (audioQuality === 'unintelligible' || audioQuality === 'silent') {
          audioQuality = 'noisy';
          qualityWarning =
            'Detectamos ruido o baja señal en la grabación, por lo que solo se transcribieron las palabras identificadas en vivo.';
          suggestion =
            'Te sugerimos revisar el texto o moverte a un lugar sin ruido de fondo. También puedes completar tu respuesta directamente usando el teclado.';
        }
      } else {
        transcription = '';
      }
    }

    const audioId = `aud_${interview.id}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const audioUrl = `/api/audio/${audioId}`;

    let audioDataUrl = params.audioBase64;
    if (!audioDataUrl.startsWith('data:')) {
      audioDataUrl = `data:${mimeType};base64,${params.audioBase64}`;
    }

    // Persist audio binary to local disk for robust streaming of large/long (10+ min) recordings
    try {
      const audioDir = path.join(process.cwd(), 'data', 'audios');
      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
      }
      let rawBase64 = params.audioBase64;
      if (rawBase64.startsWith('data:')) {
        const cIdx = rawBase64.indexOf(',');
        if (cIdx !== -1) rawBase64 = rawBase64.substring(cIdx + 1);
      }
      fs.writeFileSync(
        path.join(audioDir, `${audioId}.bin`),
        Buffer.from(rawBase64.replace(/\s+/g, ''), 'base64')
      );
    } catch (_diskErr) {
      // Non-fatal
    }

    const audioRecord: InterviewAudioRecord & {
      audioQuality?: AudioQualityStatus;
      qualityWarning?: string;
      suggestion?: string;
    } = {
      id: audioId,
      interviewId: interview.id,
      questionId: params.questionId,
      questionText: resolvedQuestionText,
      participantId: participant.id,
      participantName: participant.name,
      audioUrl,
      audioDataUrl,
      transcription,
      durationSeconds: params.durationSeconds || 0,
      mimeType,
      createdAt: new Date().toISOString(),
      audioQuality,
      qualityWarning,
      suggestion,
    };

    this.audios.set(audioId, audioRecord);

    // If audio is large (> 50KB), omit the heavy base64 payload from the Firestore document
    // to strictly prevent Firestore 1MB document limit and gRPC stream rejections.
    const firestoreRecord: any = { ...audioRecord };
    if (firestoreRecord.audioDataUrl && firestoreRecord.audioDataUrl.length > 50_000) {
      firestoreRecord.audioDataUrl = '';
      firestoreRecord.storedOnDisk = true;
    }
    await this.persistDoc('interviewAudio', audioId, firestoreRecord);

    await this.addAuditLog('UPLOAD_VOICE_RECORDING', 'audio', audioId, participant.name, {
      interviewId: interview.id,
      questionId: params.questionId,
      durationSeconds: params.durationSeconds,
      transcriptionLength: transcription.length,
      audioQuality,
    });

    return audioRecord;
  }

  public getAudioBuffer(audioId: string): { buffer: Buffer; mimeType: string } | null {
    const audio = this.audios.get(audioId);
    const audioDir = path.join(process.cwd(), 'data', 'audios');
    const diskPath = path.join(audioDir, `${audioId}.bin`);

    if (fs.existsSync(diskPath)) {
      try {
        const buf = fs.readFileSync(diskPath);
        return { buffer: buf, mimeType: audio?.mimeType || 'audio/webm' };
      } catch (err) {
        console.warn('Error reading audio from disk:', err);
      }
    }

    if (audio?.audioDataUrl) {
      let raw = audio.audioDataUrl;
      if (raw.startsWith('data:')) {
        const cIdx = raw.indexOf(',');
        if (cIdx !== -1) raw = raw.substring(cIdx + 1);
      }
      return {
        buffer: Buffer.from(raw.replace(/\s+/g, ''), 'base64'),
        mimeType: audio.mimeType || 'audio/webm',
      };
    }
    return null;
  }

  public async deleteAudioForParticipant(
    plainToken: string,
    audioId: string
  ): Promise<{ deletedAudioId: string; updatedAnswer?: AnswerRecord }> {
    const { interview, participant } = this.resolveToken(plainToken);
    const existingAudio = this.audios.get(audioId);

    if (existingAudio && existingAudio.interviewId !== interview.id) {
      throw new Error('No tienes permiso para eliminar una grabación de otra entrevista.');
    }

    this.audios.delete(audioId);
    await this.removeDoc('interviewAudio', audioId);

    // Also remove reference from any answer record in this interview
    let updatedAnswer: AnswerRecord | undefined;
    for (const ans of this.answers.values()) {
      if (ans.interviewId === interview.id) {
        let changed = false;
        if (ans.audio && ans.audio.id === audioId) {
          delete ans.audio;
          changed = true;
        }
        if (ans.audioRecordings && ans.audioRecordings.some((a) => a.id === audioId)) {
          ans.audioRecordings = ans.audioRecordings.filter((a) => a.id !== audioId);
          changed = true;
        }
        if (changed) {
          ans.updatedAt = new Date().toISOString();
          this.answers.set(ans.id, ans);
          updatedAnswer = ans;
          await this.persistDoc('answers', ans.id, ans);
        }
      }
    }

    await this.addAuditLog('DELETE_AUDIO', 'audio', audioId, participant.name, {
      interviewId: interview.id,
      participantId: participant.id,
    });

    return { deletedAudioId: audioId, updatedAnswer };
  }

  // --- Answers and Counter Management ---
  public getAnswersForInterview(interviewId: string): AnswerRecord[] {
    return Array.from(this.answers.values())
      .filter((a) => a.interviewId === interviewId)
      .map((a) => {
        if (Array.isArray(a.photos) && a.photos.length > 0) {
          const lightPhotos = a.photos.map((att) => {
            if (!att || !att.id) return att;
            const hasServerPhoto =
              this.photos.has(att.id) || Boolean(this.getPhotoBuffer(att.id));
            if (hasServerPhoto) {
              const { dataUrl: _dropDataUrl, ...restAtt } = att as any;
              return {
                ...restAtt,
                imageUrl: `/api/photos/${att.id}`,
                mimeType: att.mimeType || this.photos.get(att.id)?.mimeType || 'image/jpeg',
              };
            }
            return att;
          });
          return {
            ...a,
            photos: lightPhotos,
          };
        }
        return a;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  public async submitAnswer(params: {
    plainToken: string;
    questionId: string;
    questionText?: string;
    answerText: string;
    notRecalled: boolean;
    isFollowUp?: boolean;
    parentQuestionId?: string | null;
    isAdditionalMemory?: boolean;
    branchChoice?: 'yes' | 'no' | null;
    deepeningReason?: string;
    photos?: IncomingPhotoInput[];
    audio?: IncomingAudioInput | AnswerVoiceAttachment;
    audioRecordings?: Array<IncomingAudioInput | AnswerVoiceAttachment>;
    audios?: Array<IncomingAudioInput | AnswerVoiceAttachment>;
    idempotencyKey: string;
  }): Promise<{
    answer: AnswerRecord;
    interview: InterviewRecord;
    counterIncremented: boolean;
    sufficiencyEvaluated: boolean;
    adaptiveQuestion?: { text: string; reason?: string; followUpIndex?: number; maxFollowUps?: number };
  }> {
    const { interview, participant } = this.resolveToken(params.plainToken);

    // 1. Check interview active state on server (never trust browser time)
    const check = canSubmitAnswer(interview, Date.now(), !!params.isAdditionalMemory);
    if (!check.allowed) {
      throw new Error(check.reason);
    }

    // 1b. Validate optional photo attachments (if provided, each photo requires a description/context)
    const photoValidation = validatePhotoAttachments(params.photos);
    if (!photoValidation.valid) {
      throw new Error(photoValidation.error);
    }

    const now = new Date();
    const existingAnswers = this.getAnswersForInterview(interview.id);

    // 2. Evaluate answer increment according to idempotency and business rules
    const evalResult = evaluateAnswerIncrement({
      existingAnswers,
      incomingPayload: {
        interviewId: interview.id,
        questionId: params.questionId,
        participantId: participant.id,
        participantName: participant.name,
        answerText: params.answerText,
        notRecalled: params.notRecalled,
        isFollowUp: params.isFollowUp,
        parentQuestionId: params.parentQuestionId,
        isAdditionalMemory: params.isAdditionalMemory,
        branchChoice: params.branchChoice,
        idempotencyKey: params.idempotencyKey,
      },
      allowEditing: Boolean(this.config.allowAnswerEditing || interview.status === 'open'),
    });

    if (evalResult.error) {
      throw new Error(evalResult.error);
    }

    let savedAnswer: AnswerRecord;
    const baseQuestionObj = this.questions.get(params.questionId);
    const parentQuestionObj = params.parentQuestionId
      ? this.questions.get(params.parentQuestionId)
      : undefined;
    const resolvedLifeStage =
      baseQuestionObj?.lifeStage ||
      parentQuestionObj?.lifeStage ||
      (params.isAdditionalMemory ? 'legado_general' : 'adultez');
    const resolvedTopic =
      baseQuestionObj?.topic ||
      parentQuestionObj?.topic ||
      (params.isAdditionalMemory ? 'informacion_adicional' : 'general');
    const resolvedQuestionText =
      params.questionText || baseQuestionObj?.text || parentQuestionObj?.text || 'Recuerdo biográfico';

    if (evalResult.isDuplicate && evalResult.existingAnswer) {
      return {
        answer: evalResult.existingAnswer,
        interview,
        counterIncremented: false,
        sufficiencyEvaluated: false,
      };
    }

    // Process and persist photo attachments if provided
    let resolvedPhotoAttachments: AnswerPhotoAttachment[] | undefined = undefined;
    if (params.photos !== undefined) {
      resolvedPhotoAttachments = [];
      for (let i = 0; i < params.photos.length; i++) {
        const incomingPhoto = params.photos[i];
        const caption = (incomingPhoto.caption || '').trim();
        const existingPhotoRecord = incomingPhoto.id ? this.photos.get(incomingPhoto.id) : undefined;

        if (existingPhotoRecord) {
          existingPhotoRecord.caption = caption;
          existingPhotoRecord.questionText = resolvedQuestionText;
          existingPhotoRecord.lifeStage = resolvedLifeStage;
          existingPhotoRecord.topic = resolvedTopic;
          if (incomingPhoto.dataUrl && incomingPhoto.dataUrl.startsWith('data:image/')) {
            existingPhotoRecord.dataUrl = incomingPhoto.dataUrl;
            this.savePhotoBinaryToDisk(existingPhotoRecord.id, incomingPhoto.dataUrl);
          }
          this.photos.set(existingPhotoRecord.id, existingPhotoRecord);

          const firestorePhotoRecord: any = { ...existingPhotoRecord };
          if (firestorePhotoRecord.dataUrl && firestorePhotoRecord.dataUrl.length > 750_000) {
            firestorePhotoRecord.dataUrl = '';
            firestorePhotoRecord.storedOnDisk = true;
          }
          await this.persistDoc('interviewPhotos', existingPhotoRecord.id, firestorePhotoRecord);

          const { dataUrl: _omit, ...attachmentMeta } = existingPhotoRecord;
          resolvedPhotoAttachments.push(attachmentMeta);
        } else if (incomingPhoto.dataUrl && incomingPhoto.dataUrl.startsWith('data:image/')) {
          const photoId =
            incomingPhoto.id && incomingPhoto.id.startsWith('photo_')
              ? incomingPhoto.id
              : `photo_${interview.id}_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`;
          const imageUrl = `/api/photos/${photoId}`;
          this.savePhotoBinaryToDisk(photoId, incomingPhoto.dataUrl);

          const newPhotoRecord: InterviewPhotoRecord = {
            id: photoId,
            interviewId: interview.id,
            questionId: params.questionId,
            questionText: resolvedQuestionText,
            lifeStage: resolvedLifeStage,
            topic: resolvedTopic,
            participantId: participant.id,
            participantName: participant.name,
            fileName: incomingPhoto.fileName || `fotografia_${i + 1}.jpg`,
            mimeType: incomingPhoto.mimeType || 'image/jpeg',
            caption,
            imageUrl,
            dataUrl: incomingPhoto.dataUrl,
            createdAt: now.toISOString(),
          };
          this.photos.set(photoId, newPhotoRecord);

          const firestorePhotoRecord: any = { ...newPhotoRecord };
          if (firestorePhotoRecord.dataUrl && firestorePhotoRecord.dataUrl.length > 750_000) {
            firestorePhotoRecord.dataUrl = '';
            firestorePhotoRecord.storedOnDisk = true;
          }
          await this.persistDoc('interviewPhotos', photoId, firestorePhotoRecord);

          const { dataUrl: _omit, ...attachmentMeta } = newPhotoRecord;
          resolvedPhotoAttachments.push(attachmentMeta);
        } else if (incomingPhoto.id && incomingPhoto.imageUrl) {
          resolvedPhotoAttachments.push({
            id: incomingPhoto.id,
            interviewId: interview.id,
            questionId: params.questionId,
            questionText: resolvedQuestionText,
            lifeStage: resolvedLifeStage,
            topic: resolvedTopic,
            participantId: participant.id,
            participantName: participant.name,
            fileName: incomingPhoto.fileName || `fotografia_${i + 1}.jpg`,
            mimeType: incomingPhoto.mimeType || 'image/jpeg',
            caption,
            imageUrl: incomingPhoto.imageUrl,
            createdAt: now.toISOString(),
          });
        }
      }
    }

    // Process audio attachments if provided (support both single audio and multiple audioRecordings)
    const incomingAudioList: Array<IncomingAudioInput | AnswerVoiceAttachment> = [];
    if (Array.isArray(params.audioRecordings) && params.audioRecordings.length > 0) {
      incomingAudioList.push(...params.audioRecordings);
    } else if (Array.isArray(params.audios) && params.audios.length > 0) {
      incomingAudioList.push(...params.audios);
    }
    if (params.audio && !incomingAudioList.some((a) => a.id === params.audio!.id)) {
      incomingAudioList.push(params.audio);
    }

    const resolvedAudioRecordings: AnswerVoiceAttachment[] = [];
    for (const item of incomingAudioList) {
      if (!item) continue;
      if (item.id && this.audios.has(item.id)) {
        const stored = this.audios.get(item.id)!;
        const editedTranscription =
          typeof item.transcription === 'string' && item.transcription.trim().length > 0
            ? item.transcription.trim()
            : incomingAudioList.length === 1 && !params.notRecalled && params.answerText.trim().length > 0
            ? params.answerText.trim()
            : stored.transcription;

        if (editedTranscription && editedTranscription !== stored.transcription) {
          stored.transcription = editedTranscription;
          this.audios.set(stored.id, stored);
          const firestoreAudio: any = { ...stored };
          if (firestoreAudio.audioDataUrl && firestoreAudio.audioDataUrl.length > 50_000) {
            firestoreAudio.audioDataUrl = '';
            firestoreAudio.storedOnDisk = true;
          }
          await this.persistDoc('interviewAudio', stored.id, firestoreAudio);
        }

        resolvedAudioRecordings.push({
          id: stored.id,
          interviewId: interview.id,
          questionId: params.questionId,
          questionText: resolvedQuestionText,
          participantId: participant.id,
          participantName: participant.name,
          audioUrl: stored.audioUrl,
          audioDataUrl: stored.audioDataUrl && stored.audioDataUrl.length < 50_000 ? stored.audioDataUrl : undefined,
          mimeType: stored.mimeType,
          transcription: stored.transcription,
          durationSeconds: stored.durationSeconds,
          createdAt: stored.createdAt,
        });
      } else if ('audioBase64' in item && item.audioBase64) {
        const savedRec = await this.saveVoiceRecording({
          plainToken: params.plainToken,
          questionId: params.questionId,
          questionText: resolvedQuestionText,
          audioBase64: item.audioBase64,
          mimeType: item.mimeType,
          durationSeconds: item.durationSeconds,
          clientTranscription: item.transcription,
        });
        if (
          incomingAudioList.length === 1 &&
          !params.notRecalled &&
          params.answerText.trim().length > 0 &&
          params.answerText.trim() !== savedRec.transcription
        ) {
          savedRec.transcription = params.answerText.trim();
          this.audios.set(savedRec.id, savedRec);
        }
        resolvedAudioRecordings.push({
          id: savedRec.id,
          interviewId: interview.id,
          questionId: params.questionId,
          questionText: resolvedQuestionText,
          participantId: participant.id,
          participantName: participant.name,
          audioUrl: savedRec.audioUrl,
          audioDataUrl: savedRec.audioDataUrl && savedRec.audioDataUrl.length < 50_000 ? savedRec.audioDataUrl : undefined,
          mimeType: savedRec.mimeType,
          transcription: savedRec.transcription,
          durationSeconds: savedRec.durationSeconds,
          createdAt: savedRec.createdAt,
        });
      } else if (item.id && item.audioUrl) {
        resolvedAudioRecordings.push({
          id: item.id,
          interviewId: interview.id,
          questionId: params.questionId,
          questionText: resolvedQuestionText,
          participantId: participant.id,
          participantName: participant.name,
          audioUrl: item.audioUrl,
          audioDataUrl: (item as any).audioDataUrl && (item as any).audioDataUrl.length < 50_000 ? (item as any).audioDataUrl : undefined,
          mimeType: item.mimeType || 'audio/webm',
          transcription:
            item.transcription ||
            (incomingAudioList.length === 1 && !params.notRecalled ? params.answerText.trim() : ''),
          durationSeconds: item.durationSeconds || 0,
          createdAt: (item as any).createdAt || new Date().toISOString(),
        });
      }
    }

    const resolvedAudioAttachment =
      resolvedAudioRecordings.length > 0
        ? resolvedAudioRecordings[resolvedAudioRecordings.length - 1]
        : undefined;

    if (evalResult.isEdit && evalResult.existingAnswer) {
      const existing = evalResult.existingAnswer;
      const history = existing.editHistory || [];
      history.push({
        text: existing.answerText,
        editedAt: existing.updatedAt || existing.createdAt,
      });

      existing.answerText = params.notRecalled ? '' : params.answerText.trim();
      existing.notRecalled = params.notRecalled;
      if (params.branchChoice !== undefined) {
        existing.branchChoice = params.branchChoice;
      }
      if (resolvedPhotoAttachments !== undefined) {
        // Delete any photos that were removed during edit
        const keptIds = new Set(resolvedPhotoAttachments.map((p) => p.id));
        let removedAnyPhoto = false;
        for (const oldPhoto of existing.photos || []) {
          if (!keptIds.has(oldPhoto.id)) {
            removedAnyPhoto = true;
            this.photos.delete(oldPhoto.id);
            try {
              const photoDir = path.join(process.cwd(), 'data', 'photos');
              const diskPath = path.join(photoDir, `${oldPhoto.id}.bin`);
              if (fs.existsSync(diskPath)) {
                fs.unlinkSync(diskPath);
              }
            } catch (_diskErr) {
              // ignore
            }
            await this.removeDoc('interviewPhotos', oldPhoto.id);
          }
        }
        existing.photos = resolvedPhotoAttachments;
        if (removedAnyPhoto) {
          this.syncInterviewManuscriptsAndCompilationAfterPhotoChange(interview.id).catch(() => {});
        }
      }
      if (resolvedAudioRecordings.length > 0) {
        existing.audio = resolvedAudioAttachment;
        existing.audioRecordings = resolvedAudioRecordings;
      }
      existing.editHistory = history;
      existing.updatedAt = now.toISOString();

      savedAnswer = existing;
      interview.lastActivityAt = now.toISOString();
    } else {
      const answerId = `ans_${interview.id}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      savedAnswer = {
        id: answerId,
        interviewId: interview.id,
        questionId: params.questionId,
        questionText: resolvedQuestionText,
        participantId: participant.id,
        participantName: participant.name,
        answerText: params.notRecalled ? '' : params.answerText.trim(),
        notRecalled: params.notRecalled,
        isFollowUp: !!params.isFollowUp,
        parentQuestionId: params.parentQuestionId || null,
        isAdditionalMemory: !!params.isAdditionalMemory,
        branchChoice: params.branchChoice || null,
        deepeningReason: params.deepeningReason,
        photos: resolvedPhotoAttachments || [],
        audio: resolvedAudioAttachment,
        audioRecordings: resolvedAudioRecordings,
        idempotencyKey: params.idempotencyKey,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      this.answers.set(answerId, savedAnswer);

      if (evalResult.shouldIncrementCounter) {
        interview.completedQuestionCount += 1;
      }
      interview.lastActivityAt = now.toISOString();
    }

    // Persist answer and updated interview immediately to Firestore
    await Promise.all([
      this.persistDoc('answers', savedAnswer.id, savedAnswer),
      this.persistDoc('interviews', interview.id, interview),
    ]);

    // 3. Check sufficiency evaluation trigger (only for newly incremented answers)
    let sufficiencyEvaluated = false;
    if (
      !evalResult.isEdit &&
      evalResult.shouldIncrementCounter &&
      isSufficiencyThresholdMet(interview.completedQuestionCount, interview.sufficiencyThreshold)
    ) {
      try {
        const questions = this.getQuestionsForVersion(interview.questionnaireVersionId);
        const allAnswers = this.getAnswersForInterview(interview.id);
        const evalOutput = await evaluateNarrativeSufficiency({
          interview,
          answers: allAnswers,
          questions,
        });

        interview.sufficiencyStatus = evalOutput.sufficiencyStatus;
        sufficiencyEvaluated = true;

        await this.persistDoc('interviews', interview.id, interview);
        await this.addAuditLog('EVALUATE_SUFFICIENCY', 'interview', interview.id, 'gemini_agent', {
          completedQuestionCount: interview.completedQuestionCount,
          sufficiencyStatus: evalOutput.sufficiencyStatus,
          coveredTopics: evalOutput.coveredTopics,
          missingTopics: evalOutput.missingTopics,
        });
      } catch (err) {
        console.error('Sufficiency evaluation error:', err);
      }
    }

    // 4. Autonomous deepening question generation (for new answers to base questions)
    let adaptiveQuestion:
      | { text: string; reason?: string; followUpIndex?: number; maxFollowUps?: number }
      | undefined;

    if (
      !evalResult.isEdit &&
      !params.notRecalled &&
      !params.isAdditionalMemory &&
      params.branchChoice !== 'no' &&
      interview.maxFollowUpsAtCreation > 0
    ) {
      try {
        const rootQuestionId = params.isFollowUp
          ? params.parentQuestionId || params.questionId
          : params.questionId;
        const rootQuestionObj =
          this.questions.get(rootQuestionId) ||
          this.getQuestionsForVersion(interview.questionnaireVersionId).find(
            (q) => q.id === rootQuestionId
          );

        const isKeyOrSubstantive =
          rootQuestionObj &&
          (rootQuestionObj.priority === 'alta' ||
            rootQuestionObj.requirementType === 'mandatory' ||
            (params.answerText || '').trim().length >= 25);

        if (rootQuestionObj && isKeyOrSubstantive) {
          const allAnswersNow = this.getAnswersForInterview(interview.id);
          const followUpsForRoot = allAnswersNow.filter(
            (a) =>
              a.participantId === participant.id &&
              a.isFollowUp &&
              a.parentQuestionId === rootQuestionId
          );

          const currentFollowUpCount = followUpsForRoot.length;
          if (currentFollowUpCount < interview.maxFollowUpsAtCreation) {
            const previousFollowUpTexts = followUpsForRoot
              .map((f) => f.questionText || '')
              .filter((t) => t.length > 0);

            const adaptiveResult = await generateAdaptiveFollowUp({
              currentQuestion: rootQuestionObj,
              currentAnswerText: params.answerText,
              notRecalled: params.notRecalled,
              branchChoice: params.branchChoice,
              currentFollowUpCount,
              maxFollowUps: interview.maxFollowUpsAtCreation,
              storyMode: interview.storyMode,
              previousFollowUps: previousFollowUpTexts,
            });

            if (adaptiveResult.suggested && adaptiveResult.questionText) {
              adaptiveQuestion = {
                text: adaptiveResult.questionText,
                reason: adaptiveResult.reason,
                followUpIndex: currentFollowUpCount + 1,
                maxFollowUps: interview.maxFollowUpsAtCreation,
              };
            }
          }
        }
      } catch (err) {
        console.error('Adaptive follow-up error:', err);
      }
    }

    return {
      answer: savedAnswer,
      interview,
      counterIncremented: evalResult.shouldIncrementCounter,
      sufficiencyEvaluated,
      adaptiveQuestion,
    };
  }

  // --- Voluntary Completion ---
  public async declareVoluntaryCompletion(plainToken: string, reason: string): Promise<InterviewRecord> {
    const { interview, participant } = this.resolveToken(plainToken);
    const cleanClosingDedication =
      reason && reason.trim() !== 'Declaración voluntaria' && reason.trim() !== 'Declarado por el participante'
        ? reason.trim()
        : '';
    const updated = applyVoluntaryCompletion(
      interview,
      `Concluido por ${participant.name}: ${cleanClosingDedication || 'Declaración explícita del participante'}`,
      new Date().toISOString(),
      cleanClosingDedication
    );
    this.interviews.set(updated.id, updated);
    await this.persistDoc('interviews', updated.id, updated);

    await this.addAuditLog('VOLUNTARY_COMPLETION', 'interview', updated.id, participant.name, {
      completedQuestionCount: updated.completedQuestionCount,
      reason: cleanClosingDedication || reason,
    });
    return updated;
  }

  // --- Admin Interview Extensions, Reopens, Layout Quota, and Sufficiency Evaluation ---
  public async extendInterview(
    interviewId: string,
    additionalDays: number,
    performedBy: string
  ): Promise<InterviewRecord> {
    const interview = this.interviews.get(interviewId);
    if (!interview) throw new Error('Entrevista no encontrada.');

    const updated = applyAdminExtension(interview, additionalDays);
    this.interviews.set(interviewId, updated);
    await this.persistDoc('interviews', interviewId, updated);

    // Sync token expiration dates for this interview
    for (const tok of this.tokens.values()) {
      if (tok.interviewId === interviewId && !tok.revoked) {
        tok.expiresAt = updated.expiresAt;
        await this.persistDoc('interviewTokens', tok.id, tok);
      }
    }

    await this.addAuditLog('EXTEND_INTERVIEW', 'interview', interviewId, performedBy, {
      additionalDays,
      newExpiresAt: updated.expiresAt,
    });
    return updated;
  }

  public async reopenInterview(
    interviewId: string,
    newDays: number,
    reason: string,
    performedBy: string,
    additionalLayoutEdits?: number
  ): Promise<InterviewRecord> {
    const interview = this.interviews.get(interviewId);
    if (!interview) throw new Error('Entrevista no encontrada.');

    const updated = applyAdminReopen(
      interview,
      newDays,
      reason,
      new Date().toISOString(),
      additionalLayoutEdits
    );
    this.interviews.set(interviewId, updated);
    await this.persistDoc('interviews', interviewId, updated);

    // Sync token expiration dates for this interview
    for (const tok of this.tokens.values()) {
      if (tok.interviewId === interviewId) {
        tok.revoked = false;
        tok.expiresAt = updated.expiresAt;
        await this.persistDoc('interviewTokens', tok.id, tok);
      }
    }

    await this.addAuditLog('REOPEN_INTERVIEW', 'interview', interviewId, performedBy, {
      newDays,
      reason,
      additionalLayoutEdits,
      newExpiresAt: updated.expiresAt,
    });
    return updated;
  }

  public async updateInterviewLayoutQuota(
    interviewId: string,
    remainingEdits: number,
    performedBy: string
  ): Promise<InterviewRecord> {
    const interview = this.interviews.get(interviewId);
    if (!interview) throw new Error('Entrevista no encontrada.');

    const cleanRemaining = Math.max(0, Math.floor(Number(remainingEdits) || 0));
    const used = Math.max(0, interview.layoutEditsUsed ?? 0);
    interview.layoutEditsAllowed = used + cleanRemaining;
    interview.lastActivityAt = new Date().toISOString();

    this.interviews.set(interviewId, interview);
    await this.persistDoc('interviews', interviewId, interview);

    await this.addAuditLog('UPDATE_LAYOUT_QUOTA', 'interview', interviewId, performedBy, {
      remainingEdits: cleanRemaining,
      layoutEditsAllowed: interview.layoutEditsAllowed,
      layoutEditsUsed: used,
    });

    return interview;
  }

  // --- Participant Book Studio & Version History ---
  private normalizeBookPhotoRef(
    photo: DemoInMemoryPhoto | null | undefined,
    fallbackId?: string
  ): DemoInMemoryPhoto | null {
    if (!photo) return null;
    const photoId = photo.id || fallbackId || '';
    const hasServerPhoto =
      Boolean(photoId) &&
      (this.photos.has(photoId) || Boolean(this.getPhotoBuffer(photoId)) || photoId.startsWith('photo_'));
    if (hasServerPhoto) {
      const apiUrl = `/api/photos/${photoId}`;
      return {
        ...photo,
        id: photoId,
        dataUrl: apiUrl,
        objectUrl: apiUrl,
      };
    }
    const preservedUrl =
      (photo.dataUrl && photo.dataUrl.startsWith('data:image/') ? photo.dataUrl : '') ||
      (photo.objectUrl && photo.objectUrl.startsWith('data:image/') ? photo.objectUrl : '') ||
      photo.objectUrl ||
      photo.dataUrl ||
      (photoId ? `/api/photos/${photoId}` : '');
    return {
      ...photo,
      id: photoId,
      dataUrl: preservedUrl,
      objectUrl: preservedUrl,
    };
  }

  private hydrateBookVersionPhotos(version: ParticipantBookVersionRecord): ParticipantBookVersionRecord {
    const hydratedCover = version.coverPhoto
      ? this.normalizeBookPhotoRef(version.coverPhoto)
      : null;

    const hydratedChapters: Record<string, DemoInMemoryPhoto | null> = {};
    if (version.chapterPhotos) {
      for (const [chId, photo] of Object.entries(version.chapterPhotos)) {
        hydratedChapters[chId] = photo ? this.normalizeBookPhotoRef(photo) : null;
      }
    }

    // Populate lightweight allPhotosById for the entire interview so all chapter photoPlacements resolve seamlessly
    const hydratedAllPhotos: Record<string, DemoInMemoryPhoto> = {};
    if (version.allPhotosById) {
      for (const [pid, photo] of Object.entries(version.allPhotosById)) {
        if (!photo) continue;
        // Skip duplicating inline custom coverPhoto base64 inside allPhotosById (it is already in coverPhoto)
        if (
          hydratedCover &&
          (pid === hydratedCover.id || photo.id === hydratedCover.id) &&
          hydratedCover.dataUrl.startsWith('data:')
        ) {
          continue;
        }
        const normalized = this.normalizeBookPhotoRef(photo, pid);
        if (normalized) {
          hydratedAllPhotos[normalized.id || pid] = normalized;
        }
      }
    }

    const interviewPhotos = this.getPhotosForInterview(version.interviewId);
    for (const ip of interviewPhotos) {
      const apiUrl = `/api/photos/${ip.id}`;
      hydratedAllPhotos[ip.id] = {
        id: ip.id,
        fileName: ip.caption || `Fotografía de ${ip.id}`,
        dataUrl: apiUrl,
        objectUrl: apiUrl,
        mimeType: ip.mimeType || 'image/jpeg',
        width: 800,
        height: 600,
        zoom: 1,
        focusY: 'center',
        caption: ip.caption || '',
      };
    }

    if (hydratedCover && hydratedCover.id && !hydratedCover.dataUrl.startsWith('data:')) {
      hydratedAllPhotos[hydratedCover.id] = hydratedCover;
    }
    for (const cp of Object.values(hydratedChapters)) {
      if (cp && cp.id) {
        hydratedAllPhotos[cp.id] = cp;
      }
    }

    return {
      ...version,
      coverPhoto: hydratedCover,
      chapterPhotos: hydratedChapters,
      allPhotosById: hydratedAllPhotos,
    };
  }

  private ensureSynthesizedBookVersionsForInterview(interviewId: string): void {
    const interview = this.interviews.get(interviewId);
    if (!interview) return;

    const existingBookVersions = Array.from(this.participantBookVersions.values()).filter(
      (v) => v.interviewId === interviewId
    );
    const existingManuscripts = Array.from(this.manuscripts.values())
      .filter((m) => m.interviewId === interviewId)
      .sort((a, b) => a.version - b.version);

    const targetCount = Math.max(
      existingManuscripts.length,
      interview.bookGeneratedCount ?? 0
    );
    if (targetCount <= 0) {
      return;
    }

    const participants = Array.from(this.participants.values()).filter(
      (p) => p.interviewId === interviewId
    );
    const primaryParticipant =
      participants.find((p) => p.role === 'primary') ||
      participants[0] || {
        id: `part_${interviewId}`,
        name: interview.title,
      };
    const participantNames =
      participants.length > 0 ? participants.map((p) => p.name) : [interview.title];
    const isCouple = interview.storyMode === 'compartida' && participants.length >= 2;

    const answers = this.getAnswersForInterview(interviewId).map((a) => ({
      ...a,
      photos: (a.photos || []).map((p) => ({
        ...p,
        imageUrl: `/api/photos/${p.id}`,
      })),
    }));
    const questions = this.getQuestionsForVersion(interview.questionnaireVersionId);
    const closingPageText = (interview.participantClosingText || '').trim();

    const stylePresets: Array<{
      narrativeStyle: DemoNarrativeStyleId;
      coverDesignId: DemoEditorialConfig['coverDesignId'];
      interiorStyleId: DemoEditorialConfig['interiorStyleId'];
      bookFormatId: DemoEditorialConfig['bookFormatId'];
    }> = [
      {
        narrativeStyle: 'first_person_literary',
        coverDesignId: isCouple ? 'album_nuestra_vida' : 'clasica_eterna',
        interiorStyleId: 'clasico_editorial',
        bookFormatId: '6x9',
      },
      {
        narrativeStyle: 'first_person_literary',
        coverDesignId: 'recuerdos_marfil',
        interiorStyleId: 'memorias_elegantes',
        bookFormatId: 'a5',
      },
      {
        narrativeStyle: 'first_person_literary',
        coverDesignId: 'raices_recuerdos',
        interiorStyleId: 'legado_familiar',
        bookFormatId: 'carta',
      },
    ];

    let createdAny = false;
    for (let vNum = 1; vNum <= targetCount; vNum++) {
      const versionId = `pbv_${interviewId}_v${vNum}`;
      if (this.deletedBookVersionIds.has(versionId)) {
        continue;
      }
      const existingRealOrSynth = existingBookVersions.find((v) => v.versionNumber === vNum);
      // Only skip if a user-saved version (with timestamp suffix) exists, or if the synthesized version already uses 'first_person_literary' and has all current answers
      if (existingRealOrSynth) {
        if (this.deletedBookVersionIds.has(existingRealOrSynth.id)) {
          continue;
        }
        const isSynthesizedId = existingRealOrSynth.id === versionId;
        const needsRefresh =
          isSynthesizedId &&
          (existingRealOrSynth.narrativeStyle !== 'first_person_literary' ||
            hasUpdatedAnswersSinceBookVersion({
              answers,
              interviewReopenedAt: interview.reopenedAt,
              latestBookVersion: existingRealOrSynth,
            }));
        if (!needsRefresh) {
          continue;
        }
      }

      const matchingManu = existingManuscripts.find((m) => m.version === vNum);
      const preset = stylePresets[(vNum - 1) % stylePresets.length];
      const bookTitle = matchingManu?.title || interview.title;

      const built = buildParticipantInitialManuscriptFromAnswers({
        interviewTitle: bookTitle,
        storyMode: interview.storyMode,
        participantNames,
        answers,
        questions,
        narrativeStyle: preset.narrativeStyle,
        closingDedicationText: closingPageText,
      });

      const editorialConfig: DemoEditorialConfig = {
        coverDesignId: preset.coverDesignId,
        coverColorVariantIdx: 0,
        coverVisualType: 'illustration',
        coverIllustrationId: isCouple ? 'constelacion_familiar' : 'arbol_raices',
        interiorStyleId: preset.interiorStyleId,
        bookFormatId: preset.bookFormatId,
        customTitle: built.manuscript.title,
        customSubtitle: built.manuscript.subtitle,
        customAuthors: built.manuscript.authors,
        dedication: built.manuscript.dedication,
      };

      const composed = composeBookPages({
        manuscript: built.manuscript,
        editorialConfig,
        coverPhoto: null,
        chapterPhotos: built.chapterPhotos,
        customClosingPageText: closingPageText || undefined,
        maxContentPages: 500,
      });

      const baseFilename = buildSafeDemoPdfFilename({
        mode: isCouple ? 'pareja' : 'individual',
        displayName: primaryParticipant.name,
        fullName: primaryParticipant.name,
        partner1Name: participantNames[0] || primaryParticipant.name,
        partner2Name: participantNames[1] || 'Pareja',
        hasAcceptedTemporaryNotice: true,
      }).replace(/\.pdf$/i, `_v${vNum}.pdf`);

      const record: ParticipantBookVersionRecord = {
        id: versionId,
        interviewId,
        participantId: primaryParticipant.id,
        participantName: primaryParticipant.name,
        versionNumber: vNum,
        title: built.manuscript.title,
        subtitle: built.manuscript.subtitle,
        authors: built.manuscript.authors,
        dedication: built.manuscript.dedication,
        closingPageText,
        narrativeStyle: preset.narrativeStyle,
        editorialConfig,
        manuscript: built.manuscript,
        coverPhoto: null,
        chapterPhotos: built.chapterPhotos,
        pageCount: Math.max(5, composed.pages.length),
        fileName: baseFilename,
        createdAt: matchingManu?.generatedAt || interview.closedAt || interview.lastActivityAt || new Date().toISOString(),
      };

      this.participantBookVersions.set(versionId, record);
      createdAny = true;
    }

    if (createdAny) {
      interview.bookGeneratedCount = Math.max(interview.bookGeneratedCount ?? 0, targetCount);
      this.interviews.set(interviewId, interview);
      this.saveStateToDisk();
    }
  }

  public getBookVersionsForInterview(
    interviewId: string,
    hydratePhotos: boolean = true
  ): ParticipantBookVersionRecord[] {
    if (hydratePhotos) {
      this.ensureSynthesizedBookVersionsForInterview(interviewId);
    }
    return Array.from(this.participantBookVersions.values())
      .filter((v) => v.interviewId === interviewId)
      .map((v) => {
        if (hydratePhotos) {
          return this.hydrateBookVersionPhotos(v);
        }
        const { allPhotosById: _stripped, coverPhoto, chapterPhotos, ...rest } = v;
        const cleanPhotoRef = (p: DemoInMemoryPhoto | null | undefined): DemoInMemoryPhoto | null => {
          if (!p) return null;
          return {
            ...p,
            dataUrl: '',
            objectUrl: p.objectUrl?.startsWith('data:') ? '' : (p.objectUrl || ''),
          };
        };
        return {
          ...rest,
          coverPhoto: cleanPhotoRef(coverPhoto),
          chapterPhotos: chapterPhotos
            ? Object.fromEntries(
                Object.entries(chapterPhotos).map(([k, p]) => [k, cleanPhotoRef(p)])
              )
            : {},
        } as ParticipantBookVersionRecord;
      })
      .sort((a, b) => b.versionNumber - a.versionNumber);
  }

  public getAllParticipantBookVersions(): Array<
    ParticipantBookVersionRecord & {
      interviewTitle?: string;
      storyMode?: 'individual' | 'compartida';
      remainingEdits?: number;
      layoutEditsAllowed?: number;
      layoutEditsUsed?: number;
    }
  > {
    for (const interviewId of this.interviews.keys()) {
      this.ensureSynthesizedBookVersionsForInterview(interviewId);
    }
    return Array.from(this.participantBookVersions.values())
      .map((v) => {
        const inv = this.interviews.get(v.interviewId);
        const quota = inv ? computeLayoutEditQuotaStatus(inv) : undefined;
        return {
          ...this.hydrateBookVersionPhotos(v),
          interviewTitle: inv?.title || v.title,
          storyMode: inv?.storyMode,
          remainingEdits: quota?.remainingEdits ?? 0,
          layoutEditsAllowed: quota?.layoutEditsAllowed ?? 1,
          layoutEditsUsed: quota?.layoutEditsUsed ?? 0,
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * V5.1 — Single resolver of the testimony a book is generated from, audited against and
   * fingerprinted with. Photo captions fall back to the stored photo record exactly as generation
   * always did; `includePhotoData` only controls whether image bytes are attached (needed to
   * write the book, irrelevant to auditing or fingerprinting it).
   */
  private resolveBookSourceAnswers(
    interviewId: string,
    options: { includePhotoData: boolean }
  ): AnswerRecord[] {
    return this.getAnswersForInterview(interviewId).map((a) => {
      const mergedPhotoIds = new Set<string>();
      const mergedPhotos: any[] = [];
      for (const p of a.photos || []) {
        if (!p || !p.id || mergedPhotoIds.has(p.id)) continue;
        mergedPhotoIds.add(p.id);
        const fullPhoto = this.photos.get(p.id);
        const merged: any = {
          ...p,
          caption: p.caption || fullPhoto?.caption || '',
        };
        if (options.includePhotoData) {
          const bufObj =
            !fullPhoto?.dataUrl || fullPhoto.dataUrl.startsWith('data:image/svg')
              ? this.getPhotoBuffer(p.id)
              : null;
          merged.dataUrl = bufObj
            ? `data:${bufObj.mimeType};base64,${bufObj.buffer.toString('base64')}`
            : fullPhoto?.dataUrl || (p as any).dataUrl || p.imageUrl || `/api/photos/${p.id}`;
        }
        mergedPhotos.push(merged);
      }
      return {
        ...a,
        photos: mergedPhotos,
      };
    });
  }

  /**
   * V5.1 — Everything that defines "the correct book" for an interview and style right now:
   * testimony, questions, active literary prompt, structure mode, closing text, AI settings and
   * the cryptographic fingerprint of all of it.
   */
  private resolveParticipantBookAuditContext(
    interview: InterviewRecord,
    narrativeStyle: DemoNarrativeStyleId
  ): {
    answers: AnswerRecord[];
    questions: QuestionRecord[];
    closingPageText: string;
    literaryPromptText: string;
    bookStructureMode: BookStructureMode;
    configuredProvider: BookAiProvider;
    primaryModel: string;
    alternateProvider: BookAiProvider;
    alternateModel: string;
    sourceFingerprint: string;
    generationFingerprint: string;
  } {
    const answers = this.resolveBookSourceAnswers(interview.id, { includePhotoData: false });
    const questions = this.getQuestionsForVersion(interview.questionnaireVersionId);
    const closingPageText = (interview.participantClosingText || '').trim();
    const stylePromptConfig = this.config.literaryPrompts?.[narrativeStyle];
    const literaryPromptText =
      stylePromptConfig?.promptText && stylePromptConfig.promptText.trim().length > 0
        ? stylePromptConfig.promptText.trim()
        : DEFAULT_LITERARY_PROMPTS_TEXT[narrativeStyle];
    const bookStructureMode: BookStructureMode =
      this.config.bookStructureMode === 'fixed_five_stages'
        ? 'fixed_five_stages'
        : 'prompt_autonomous';
    const configuredProvider: BookAiProvider =
      this.config.bookAiProvider === 'openai' ? 'openai' : 'gemini';
    const geminiModel = this.config.bookAiGeminiModel || 'gemini-3-flash-preview';
    const openaiModel = this.config.bookAiOpenAiModel || 'gpt-4o';
    const alternateProvider: BookAiProvider = configuredProvider === 'openai' ? 'gemini' : 'openai';
    const sourceFingerprint = computeBookSourceFingerprint({
      interviewId: interview.id,
      narrativeStyle,
      closingDedicationText: closingPageText,
      answers,
      questions,
    });
    const primaryModel = configuredProvider === 'openai' ? openaiModel : geminiModel;
    return {
      answers,
      questions,
      closingPageText,
      literaryPromptText,
      bookStructureMode,
      configuredProvider,
      primaryModel,
      alternateProvider,
      alternateModel: alternateProvider === 'openai' ? openaiModel : geminiModel,
      sourceFingerprint,
      generationFingerprint: computeBookGenerationFingerprint({
        sourceFingerprint,
        provider: configuredProvider,
        model: primaryModel,
        bookStructureMode,
        literaryPromptText,
      }),
    };
  }

  public async generateParticipantBookManuscript(params: {
    plainToken: string;
    narrativeStyle: DemoNarrativeStyleId;
    scope?: 'preview' | 'full';
    lockedPreviewManuscript?: DemoManuscript | null;
    lockedPreviewGroups?: ComposedChapterSectionBlock[][] | null;
    forceRefresh?: boolean;
    onProgress?: (event: BookGenerationProgressEvent) => void;
    initialBatchCheckpoints?: Record<string, BookBatchCheckpointPayload>;
    onBatchCheckpoint?: (batchIdx: number, checkpoint: BookBatchCheckpointPayload) => void;
    isCancelled?: () => boolean;
    maxRepairPasses?: number;
  }): Promise<{
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
    failureCategory?: BookFailureCategory;
    sourceFingerprint?: string;
    invalidatedBatchIndexes?: number[];
    batchesCompleted?: number;
    totalBatches?: number;
  }> {
    const { interview } = this.resolveToken(params.plainToken);
    if (!interview.userDeclaredComplete) {
      throw new Error(
        'Primero debes confirmar el cierre de tu historia para abrir el estudio de maquetación.'
      );
    }

    // Step 1: Retrieve all testimonies, transcriptions, texts, photographs, and descriptions
    const participants = Array.from(this.participants.values()).filter(
      (p) => p.interviewId === interview.id
    );
    const interviewPhotos = this.getPhotosForInterview(interview.id);

    // V5.1: generation, job fingerprinting and saving all read the interview through the same
    // resolver, so the three of them audit and fingerprint exactly the same testimony.
    const answers = this.resolveBookSourceAnswers(interview.id, { includePhotoData: true });

    const questions = this.getQuestionsForVersion(interview.questionnaireVersionId);
    const closingPageText = (interview.participantClosingText || '').trim();

    // Step 2: Generate or retrieve the updated PDF of the Compilado Testimonial Fidedigno
    let compilationPdfRecord: MiEsenciaArchivedCompilationPdf;
    if (this.bookAiOverrides?.compilationPdfProvider) {
      compilationPdfRecord = await this.bookAiOverrides.compilationPdfProvider(interview.id);
    } else {
      const { miEsenciaStore } = await import('./miEsencia/miEsenciaStore.ts');
      const compilationBundle = await miEsenciaStore.ensureInterviewCompilationPdf(interview.id);
      compilationPdfRecord = compilationBundle.pdfRecord;
    }

    // Step 3: Verify that the PDF exists, is valid, and contains all available information
    const pdfValidation = validateCompilationPdfRecord(compilationPdfRecord);
    if (!pdfValidation.valid || !compilationPdfRecord) {
      throw new Error(
        pdfValidation.reason ||
          'No se pudieron verificar tus recuerdos originales completos para preparar el libro. Por favor intenta nuevamente.'
      );
    }

    // Step 4: Retrieve the active prompt corresponding to the selected literary style
    const selectedStyle: DemoNarrativeStyleId = params.narrativeStyle || 'first_person_literary';
    const activeStylePromptConfig = this.config.literaryPrompts?.[selectedStyle];
    const customLiteraryPromptText =
      activeStylePromptConfig?.promptText && activeStylePromptConfig.promptText.trim().length > 0
        ? activeStylePromptConfig.promptText.trim()
        : DEFAULT_LITERARY_PROMPTS_TEXT[selectedStyle];

    // Step 5: Retrieve the AI provider, model, and bookStructureMode configured in Configuración Global
    const configuredProvider: BookAiProvider =
      this.config.bookAiProvider === 'openai' ? 'openai' : 'gemini';
    const geminiModel = this.config.bookAiGeminiModel || 'gemini-3-flash-preview';
    const openaiModel = this.config.bookAiOpenAiModel || 'gpt-4o';
    const bookStructureMode: BookStructureMode =
      this.config.bookStructureMode === 'fixed_five_stages'
        ? 'fixed_five_stages'
        : 'prompt_autonomous';

    // Step 6 & 7: Send the entire content of the PDF + photos + literary prompt to the configured AI engine
    const result = await generateParticipantBookManuscriptWithAI({
      interview,
      participants,
      answers,
      questions,
      narrativeStyle: selectedStyle,
      closingDedicationText: closingPageText,
      scope: params.scope || 'full',
      forceRefresh: Boolean(params.forceRefresh),
      lockedPreviewManuscript: params.lockedPreviewManuscript || null,
      lockedPreviewGroups: params.lockedPreviewGroups || null,
      compilationPdfRecord,
      photosWithDataUrl: interviewPhotos.map((p) => ({
        id: p.id,
        caption: p.caption || '',
        questionText: p.questionText,
        lifeStage: p.lifeStage,
        participantName: p.participantName,
        mimeType: p.mimeType,
        dataUrl: p.dataUrl,
      })),
      customLiteraryPromptText,
      configuredProvider,
      geminiModel,
      openaiModel,
      bookStructureMode,
      onProgress: params.onProgress,
      initialBatchCheckpoints: params.initialBatchCheckpoints,
      onBatchCheckpoint: params.onBatchCheckpoint,
      isCancelled: params.isCancelled,
      maxRepairPasses: params.maxRepairPasses,
      pipelineOverrides: this.bookAiOverrides
        ? {
            draftBatch: this.bookAiOverrides.draftBatch,
            aiJudge: this.bookAiOverrides.aiJudge,
            repairBatchCaller: this.bookAiOverrides.repairBatchCaller,
            skipDiskCache: this.bookAiOverrides.skipDiskCache,
          }
        : undefined,
    });

    const reasonCode =
      result.internalReasonCode || result.manuscript?.internalReasonCode || null;
    const diagnosticSummary =
      result.diagnosticSummary || result.manuscript?.diagnosticSummary || null;

    await this.addAuditLog(
      'GENERATE_BOOK_MANUSCRIPT_FROM_COMPILATION_PDF',
      'interview',
      interview.id,
      participants[0]?.name || interview.title,
      {
        narrativeStyle: selectedStyle,
        scope: result.scope,
        configuredProvider,
        providerUsed: result.providerUsed,
        modelUsed: result.modelUsed,
        providerFallbackNotice: result.providerFallbackNotice || null,
        compilationPdfId: compilationPdfRecord.pdfId,
        compilationPdfSha256: compilationPdfRecord.sha256Hash,
        activePromptVersionId: activeStylePromptConfig?.activeVersionId || 'default',
        cachedContextUsed: Boolean(result.cachedContextUsed),
        generationStatus: result.manuscript?.generationStatus || result.manuscript?.status || 'generated',
        coveragePercentage: result.manuscript?.documentaryAudit?.coveragePercentage ?? null,
        batchesCompleted: result.batchesCompleted ?? null,
        totalBatches: result.totalBatches ?? null,
        internalReasonCode: reasonCode,
        diagnosticSummary,
        failureCategory: result.failureCategory || null,
        auditPolicy: result.manuscript?.documentaryAudit?.auditPolicy || null,
        judgeResolvedUnits:
          result.manuscript?.documentaryAudit?.semanticAudit?.judgeResolvedUnitIds?.length ?? null,
        approvalEvidenceIssued: Boolean(result.manuscript?.approvalEvidence),
        invalidatedBatches: result.invalidatedBatchIndexes?.length ?? 0,
      }
    );

    const lightweightChapterPhotos: Record<string, DemoInMemoryPhoto | null> = {};
    for (const [chId, photo] of Object.entries(result.chapterPhotos || {})) {
      lightweightChapterPhotos[chId] = photo ? this.normalizeBookPhotoRef(photo) : null;
    }
    const lightweightAllPhotosById: Record<string, DemoInMemoryPhoto> = {};
    for (const [pid, photo] of Object.entries(result.allPhotosById || {})) {
      const normalized = this.normalizeBookPhotoRef(photo, pid);
      if (normalized) {
        lightweightAllPhotosById[normalized.id || pid] = normalized;
      }
    }

    return {
      manuscript: result.manuscript,
      chapterPhotos: lightweightChapterPhotos,
      allPhotosById: lightweightAllPhotosById,
      closingPageText,
      scope: result.scope,
      providerUsed: result.providerUsed,
      modelUsed: result.modelUsed,
      providerFallbackNotice: result.providerFallbackNotice,
      compilationPdfId: result.compilationPdfId,
      compilationPdfSha256: result.compilationPdfSha256,
      cachedContextUsed: result.cachedContextUsed,
      activePromptVersionId: activeStylePromptConfig?.activeVersionId || 'default',
      internalReasonCode: reasonCode || undefined,
      diagnosticSummary: diagnosticSummary || undefined,
      failureCategory: result.failureCategory || result.manuscript?.failureCategory,
      sourceFingerprint: result.sourceFingerprint,
      invalidatedBatchIndexes: result.invalidatedBatchIndexes,
      batchesCompleted: result.batchesCompleted,
      totalBatches: result.totalBatches,
    };
  }

  public startOrResumeParticipantBookJob(params: {
    plainToken: string;
    narrativeStyle: DemoNarrativeStyleId;
    scope?: 'preview' | 'full';
    forceRefresh?: boolean;
    lockedPreviewManuscript?: DemoManuscript | null;
    lockedPreviewGroups?: ComposedChapterSectionBlock[][] | null;
  }): BookGenerationJobRecord {
    const { interview, participant } = this.resolveToken(params.plainToken);
    if (!interview.userDeclaredComplete) {
      throw new Error(
        'Primero debes confirmar el cierre de tu historia para abrir el estudio de maquetación.'
      );
    }

    const selectedStyle: DemoNarrativeStyleId = params.narrativeStyle || 'first_person_literary';
    const scope: 'preview' | 'full' = params.scope === 'preview' ? 'preview' : 'full';

    // V5.1: the job is bound to the exact testimony and configuration it will work on. A running
    // job or saved batches from different answers, style, prompt or settings are never reused.
    const { sourceFingerprint, generationFingerprint } = this.resolveParticipantBookAuditContext(
      interview,
      selectedStyle
    );

    return bookJobManager.startOrResumeJob({
      interviewId: interview.id,
      participantId: participant.id,
      narrativeStyle: selectedStyle,
      scope,
      forceRefresh: Boolean(params.forceRefresh),
      sourceFingerprint,
      generationFingerprint,
      executor: async (hooks) => {
        return this.generateParticipantBookManuscript({
          plainToken: params.plainToken,
          narrativeStyle: selectedStyle,
          scope,
          forceRefresh: Boolean(params.forceRefresh),
          lockedPreviewManuscript: params.lockedPreviewManuscript || null,
          lockedPreviewGroups: params.lockedPreviewGroups || null,
          onProgress: hooks.onProgress,
          initialBatchCheckpoints: hooks.initialBatchCheckpoints,
          onBatchCheckpoint: hooks.onBatchCheckpoint,
          isCancelled: hooks.isCancelled,
        });
      },
      onJobSettled: async (job) => {
        if (job.status === 'failed' && job.internalReasonCode) {
          await this.addAuditLog(
            'BOOK_GENERATION_JOB_FAILED',
            'interview',
            interview.id,
            participant.name || interview.title,
            {
              jobId: job.jobId,
              narrativeStyle: job.narrativeStyle,
              scope: job.scope,
              completedBatches: job.completedBatches,
              totalBatches: job.totalBatches,
              internalReasonCode: job.internalReasonCode,
              diagnosticSummary: job.diagnosticSummary || null,
            }
          );
        }
      },
    });
  }

  public getParticipantBookJobStatus(params: {
    plainToken: string;
    jobId?: string;
    narrativeStyle?: DemoNarrativeStyleId;
    scope?: 'preview' | 'full';
  }): BookGenerationJobRecord | null {
    const { interview } = this.resolveToken(params.plainToken);
    if (params.jobId) {
      const job = bookJobManager.getJob(params.jobId);
      if (!job || job.interviewId !== interview.id) {
        return null;
      }
      return job;
    }
    // V5.1: a finished or interrupted job is only offered while it still corresponds to the
    // interview as it is now; jobs built from answers that were edited afterwards are ignored.
    const fingerprintByStyle = new Map<DemoNarrativeStyleId, string>();
    return bookJobManager.findLatestJobForInterview({
      interviewId: interview.id,
      narrativeStyle: params.narrativeStyle,
      scope: params.scope,
      resolveCurrentSourceFingerprint: (job) => {
        if (!fingerprintByStyle.has(job.narrativeStyle)) {
          fingerprintByStyle.set(
            job.narrativeStyle,
            this.resolveParticipantBookAuditContext(interview, job.narrativeStyle).sourceFingerprint
          );
        }
        return fingerprintByStyle.get(job.narrativeStyle);
      },
    });
  }

  public cancelParticipantBookJob(params: {
    plainToken: string;
    jobId: string;
  }): BookGenerationJobRecord | null {
    const { interview } = this.resolveToken(params.plainToken);
    const existing = bookJobManager.getJob(params.jobId);
    if (!existing || existing.interviewId !== interview.id) {
      throw new Error('La preparación solicitada no pertenece a esta entrevista.');
    }
    return bookJobManager.cancelJob(params.jobId);
  }

  private inFlightBookSaves: Set<string> = new Set();

  public async saveParticipantBookVersion(params: {
    plainToken: string;
    narrativeStyle: DemoNarrativeStyleId;
    editorialConfig: DemoEditorialConfig;
    manuscript: DemoManuscript;
    coverPhoto?: DemoInMemoryPhoto | null;
    chapterPhotos?: Record<string, DemoInMemoryPhoto | null>;
    pageCount: number;
  }): Promise<{
    bookVersion: ParticipantBookVersionRecord;
    interview: InterviewRecord;
    allVersions: ParticipantBookVersionRecord[];
  }> {
    const { interview, participant } = this.resolveToken(params.plainToken);
    if (!interview.userDeclaredComplete) {
      throw new Error(
        'La entrevista debe estar cerrada para generar y guardar una versión del libro.'
      );
    }

    if (this.inFlightBookSaves.has(interview.id)) {
      throw new Error(
        'Ya se está procesando y guardando tu versión del libro. Por favor espera unos segundos.'
      );
    }

    this.inFlightBookSaves.add(interview.id);
    try {
      const existingVersions = this.getBookVersionsForInterview(interview.id);

      // V5.2 — Accidental duplicates. A retry after a lost response (or a double click) sends
      // exactly the same approved text and layout a few seconds later; creating a second version
      // would consume a layout modification for nothing. When the latest version holds the same
      // audited content, style, editorial configuration and photos and was saved recently, it is
      // returned as the result of this request instead of creating another one.
      const latestVersion = existingVersions[0];
      if (latestVersion && latestVersion.manuscript && Array.isArray(params.manuscript?.chapters)) {
        const photoRefId = (p: DemoInMemoryPhoto | null | undefined) => (p ? p.id || '' : '');
        const chapterPhotoIds = (map?: Record<string, DemoInMemoryPhoto | null>) =>
          JSON.stringify(
            Object.entries(map || {})
              .map(([k, p]) => [k, photoRefId(p)])
              .sort()
          );
        const isRecent =
          Date.now() - new Date(latestVersion.createdAt).getTime() <= 10 * 60 * 1000;
        const isSameBook =
          isRecent &&
          latestVersion.narrativeStyle === params.narrativeStyle &&
          computeManuscriptContentHash(latestVersion.manuscript) ===
            computeManuscriptContentHash(params.manuscript) &&
          JSON.stringify(latestVersion.editorialConfig || {}) ===
            JSON.stringify(params.editorialConfig || {}) &&
          photoRefId(latestVersion.coverPhoto) === photoRefId(params.coverPhoto) &&
          chapterPhotoIds(latestVersion.chapterPhotos) === chapterPhotoIds(params.chapterPhotos);
        if (isSameBook) {
          await this.addAuditLog(
            'SAVE_BOOK_VERSION_DEDUPLICATED',
            'participantBookVersion',
            latestVersion.id,
            participant.name || interview.title,
            { interviewId: interview.id, versionNumber: latestVersion.versionNumber }
          );
          return {
            bookVersion: latestVersion,
            interview,
            allVersions: existingVersions,
          };
        }
      }

      const hasExistingBook = existingVersions.length > 0 || (interview.bookGeneratedCount ?? 0) > 0;
      const quota = computeLayoutEditQuotaStatus(interview);
      const answers = this.getAnswersForInterview(interview.id);
      const hasUpdatedAnswers = hasUpdatedAnswersSinceBookVersion({
        answers,
        interviewReopenedAt: interview.reopenedAt,
        latestBookVersion: existingVersions[0] || null,
      });

      if (hasExistingBook && !quota.canModifyLayout && !hasUpdatedAnswers) {
        throw new Error(
          'Has agotado tus opciones adicionales de modificación de maquetación. Para más modificaciones y/o actualizaciones por favor ponte en contacto con YouForever.'
        );
      }

      if (
        params.manuscript.generationStatus === 'incomplete_draft' ||
        params.manuscript.status === 'incomplete_draft' ||
        params.manuscript.generationStatus === 'failed_ai' ||
        params.manuscript.generationStatus === 'failed_audit' ||
        params.manuscript.generationStatus === 'error' ||
        params.manuscript.aiGenerated === false ||
        !Array.isArray(params.manuscript.chapters) ||
        params.manuscript.chapters.length === 0
      ) {
        throw new Error(
          'Este manuscrito es un borrador incompleto y aún requiere revisión. Por favor vuelve a generar tu libro antes de guardarlo como versión definitiva.'
        );
      }

      const participants = Array.from(this.participants.values()).filter(
        (p) => p.interviewId === interview.id
      );
      const isCouple = interview.storyMode === 'compartida' && participants.length >= 2;

      // V5.1 — UNIFIED APPROVAL POLICY.
      // Generation and saving used to approve with two different rule sets (hybrid vs.
      // deterministic-only), so a book approved a minute earlier could be rejected here. Saving
      // now accepts a manuscript through exactly one of two equivalent doors, both server-side:
      //   (a) the approval evidence signed by this server when the hybrid audit approved this very
      //       text for the testimony as it is right now; or
      //   (b) when there is no valid evidence (older manuscript, server key rotated, edited text),
      //       the SAME hybrid audit used during generation, run again here.
      // Nothing the browser declares (status flags, audit reports) is trusted in either door.
      const saveStyle: DemoNarrativeStyleId = params.narrativeStyle || 'first_person_literary';
      const auditContext = this.resolveParticipantBookAuditContext(interview, saveStyle);
      // V5.2: the style being SAVED is the style audited. Keeping the manuscript's own style here
      // let a style-A text be re-audited as A and stored as a style-C book; with the declared style
      // its evidence no longer matches and the hybrid audit judges it against the right rules.
      const candidateForSave: DemoManuscript = {
        ...params.manuscript,
        narrativeStyle: saveStyle,
      };

      const evidenceCheck = verifyBookApprovalEvidence({
        manuscript: candidateForSave,
        interviewId: interview.id,
        narrativeStyle: saveStyle,
        currentSourceFingerprint: auditContext.sourceFingerprint,
      });

      let approvedManuscriptForSave: DemoManuscript;
      let approvalPath: 'signed_evidence' | 'hybrid_reaudit';

      if (evidenceCheck.valid) {
        approvalPath = 'signed_evidence';
        approvedManuscriptForSave = {
          ...candidateForSave,
          generationStatus: 'approved',
          status: 'approved',
        };
      } else {
        approvalPath = 'hybrid_reaudit';
        const hybridSaveAudit = await auditWithHybridSemantics({
          manuscript: {
            ...candidateForSave,
            generationStatus: 'generated',
            status: 'generated',
            approvalEvidence: undefined,
          },
          answers: auditContext.answers,
          questions: auditContext.questions,
          provider: auditContext.configuredProvider,
          model: auditContext.primaryModel,
          alternateProvider: auditContext.alternateProvider,
          alternateModel: auditContext.alternateModel,
          aiJudgeOverride: this.bookAiOverrides?.aiJudge,
        });

        if (!hybridSaveAudit.report.passed || !hybridSaveAudit.editorialAudit.passed) {
          const classified = classifyBookFailureReasonCode({
            report: hybridSaveAudit.report,
            editorialAudit: hybridSaveAudit.editorialAudit,
            repairPassesAttempted: hybridSaveAudit.report.repairAttemptsUsed || 0,
          });
          // The testimony changed after this manuscript was approved: say so precisely instead of
          // reporting the resulting coverage gap as if the book had been written incorrectly.
          const blockDiag =
            evidenceCheck.reason === 'source_changed' && classified.category !== 'technical'
              ? {
                  code: 'SOURCE_CHANGED_SINCE_APPROVAL' as BookGenerationReasonCode,
                  category: 'source_changed' as const,
                  summary: `Las respuestas o la configuración cambiaron después de aprobar el manuscrito. ${classified.summary}`,
                }
              : classified;
          await this.addAuditLog(
            'SAVE_BOOK_VERSION_BLOCKED',
            'interview',
            interview.id,
            participant.name || interview.title,
            {
              narrativeStyle: saveStyle,
              approvalPath,
              evidenceStatus: evidenceCheck.reason || 'valid',
              failureCategory: blockDiag.category,
              internalReasonCode: blockDiag.code,
              diagnosticSummary: blockDiag.summary,
              coveragePercentage: hybridSaveAudit.report.coveragePercentage,
            }
          );
          throw new Error(
            blockDiag.category === 'technical'
              ? 'No pudimos completar la verificación final de tu libro por un inconveniente técnico temporal. Tu libro no se perdió: vuelve a presionar el botón en unos momentos para guardarlo.'
              : buildIncompleteDraftUserNotice(blockDiag.category)
          );
        }

        const reauditedApproved: DemoManuscript = {
          ...hybridSaveAudit.manuscript,
          generationStatus: 'approved',
          status: 'approved',
        };
        approvedManuscriptForSave = {
          ...reauditedApproved,
          approvalEvidence: issueBookApprovalEvidence({
            interviewId: interview.id,
            manuscript: reauditedApproved,
            sourceFingerprint: auditContext.sourceFingerprint,
            report: hybridSaveAudit.report,
            editorialAuditPassed: hybridSaveAudit.editorialAudit.passed,
          }),
        };
      }

      const auditedForSave = { manuscript: approvedManuscriptForSave };

      const maxExistingVersion = existingVersions.reduce(
        (max, v) => (v.versionNumber > max ? v.versionNumber : max),
        0
      );
      const versionNumber = maxExistingVersion + 1;
      const versionId = `pbv_${interview.id}_v${versionNumber}_${Date.now()}`;
    const baseFilename = buildSafeDemoPdfFilename(
      {
        mode: isCouple ? 'pareja' : 'individual',
        displayName: participant.name,
        fullName: participant.name,
        partner1Name: participants[0]?.name || participant.name,
        partner2Name: participants[1]?.name || 'Pareja',
        hasAcceptedTemporaryNotice: true,
      },
      params.editorialConfig.bookFormatId
    ).replace(/\.pdf$/i, `_v${versionNumber}.pdf`);

    const closingPageText = (interview.participantClosingText || '').trim();

    const normalizedCoverPhoto = params.coverPhoto
      ? this.normalizeBookPhotoRef(params.coverPhoto)
      : null;
    const normalizedChapterPhotos: Record<string, DemoInMemoryPhoto | null> = {};
    for (const [chId, photo] of Object.entries(params.chapterPhotos || {})) {
      normalizedChapterPhotos[chId] = photo ? this.normalizeBookPhotoRef(photo) : null;
    }

    const bookVersion: ParticipantBookVersionRecord = {
      id: versionId,
      interviewId: interview.id,
      participantId: participant.id,
      participantName: participant.name,
      versionNumber,
      title: (params.editorialConfig.customTitle || auditedForSave.manuscript.title || interview.title).trim(),
      subtitle: (params.editorialConfig.customSubtitle || auditedForSave.manuscript.subtitle || '').trim(),
      authors: (params.editorialConfig.customAuthors || auditedForSave.manuscript.authors || participant.name).trim(),
      dedication: (params.editorialConfig.dedication || auditedForSave.manuscript.dedication || '').trim(),
      closingPageText,
      narrativeStyle: params.narrativeStyle,
      editorialConfig: params.editorialConfig,
      manuscript: auditedForSave.manuscript,
      coverPhoto: normalizedCoverPhoto,
      chapterPhotos: normalizedChapterPhotos,
      pageCount: Math.max(5, Number(params.pageCount) || 5),
      fileName: baseFilename,
      createdAt: new Date().toISOString(),
    };

    // Update interview quota counters.
    // V5.2: counters are computed on a COPY and committed together with the new version. If the
    // local snapshot cannot be written, both are rolled back, so a failed save never leaves a
    // version without its counters (or counters consumed without a version).
    const previousInterviewState: InterviewRecord = { ...interview };
    const nextInterview: InterviewRecord = { ...interview };
    if (!hasExistingBook) {
      nextInterview.bookGeneratedCount = 1;
      nextInterview.layoutEditsAllowed = nextInterview.layoutEditsAllowed ?? 1;
      nextInterview.layoutEditsUsed = nextInterview.layoutEditsUsed ?? 0;
    } else {
      nextInterview.bookGeneratedCount = Math.max(
        versionNumber,
        (nextInterview.bookGeneratedCount ?? 1) + 1
      );
      nextInterview.layoutEditsUsed = (nextInterview.layoutEditsUsed ?? 0) + 1;
      nextInterview.layoutEditsAllowed = nextInterview.layoutEditsAllowed ?? 1;
    }
    nextInterview.lastActivityAt = new Date().toISOString();

    this.participantBookVersions.set(versionId, bookVersion);
    Object.assign(interview, nextInterview);
    this.interviews.set(interview.id, interview);

    if (!this.saveStateToDisk()) {
      this.participantBookVersions.delete(versionId);
      for (const key of Object.keys(interview) as Array<keyof InterviewRecord>) {
        if (!(key in previousInterviewState)) delete (interview as any)[key];
      }
      Object.assign(interview, previousInterviewState);
      this.interviews.set(interview.id, interview);
      await this.addAuditLog(
        'SAVE_BOOK_VERSION_STORAGE_FAILED',
        'interview',
        interview.id,
        participant.name || interview.title,
        { narrativeStyle: params.narrativeStyle, failureCategory: 'technical' }
      );
      throw new Error(
        'No pudimos guardar tu libro por un inconveniente técnico temporal. No se descontó ninguna modificación y tu libro aprobado sigue disponible: vuelve a intentarlo en unos momentos.'
      );
    }

    await this.persistRemoteDoc('participantBookVersions', versionId, bookVersion);
    await this.persistRemoteDoc('interviews', interview.id, interview);

    await this.addAuditLog(
      hasExistingBook ? 'MODIFY_PARTICIPANT_BOOK_LAYOUT' : 'CREATE_PARTICIPANT_BOOK',
      'participantBookVersion',
      versionId,
      participant.name,
      {
        interviewId: interview.id,
        versionNumber,
        narrativeStyle: params.narrativeStyle,
        approvalPath,
        approvalEvidenceIssuedAt: approvedManuscriptForSave.approvalEvidence?.issuedAt || null,
        manuscriptContentHash:
          approvedManuscriptForSave.approvalEvidence?.manuscriptContentHash || null,
        coverDesignId: params.editorialConfig.coverDesignId,
        interiorStyleId: params.editorialConfig.interiorStyleId,
        bookFormatId: params.editorialConfig.bookFormatId,
        layoutEditsUsed: interview.layoutEditsUsed,
        layoutEditsAllowed: interview.layoutEditsAllowed,
      }
    );

      return {
        bookVersion: this.hydrateBookVersionPhotos(bookVersion),
        interview,
        allVersions: this.getBookVersionsForInterview(interview.id),
      };
    } finally {
      this.inFlightBookSaves.delete(interview.id);
    }
  }

  public async deleteParticipantBookVersion(
    versionId: string,
    restoreQuota: boolean,
    performedBy: string
  ): Promise<{
    interview: InterviewRecord;
    allVersions: ParticipantBookVersionRecord[];
    deletedVersionId: string;
    restoredQuota: boolean;
  }> {
    const version = this.participantBookVersions.get(versionId);
    if (!version) {
      throw new Error('Versión del libro no encontrada.');
    }

    const interviewId = version.interviewId;
    const interview = this.interviews.get(interviewId);
    if (!interview) {
      throw new Error('Entrevista asociada a la versión no encontrada.');
    }

    const synthVersionId = `pbv_${interviewId}_v${version.versionNumber}`;
    this.deletedBookVersionIds.add(versionId);
    this.deletedBookVersionIds.add(synthVersionId);

    this.participantBookVersions.delete(versionId);
    this.participantBookVersions.delete(synthVersionId);
    await this.removeDoc('participantBookVersions', versionId);
    if (synthVersionId !== versionId) {
      await this.removeDoc('participantBookVersions', synthVersionId);
    }

    // Also remove any matching manuscript with the same version number so ensureSynthesizedBookVersionsForInterview
    // never resurrects this deleted version
    const matchingManuId = `manu_${interviewId}_v${version.versionNumber}`;
    if (this.manuscripts.has(matchingManuId)) {
      this.manuscripts.delete(matchingManuId);
      await this.removeDoc('manuscripts', matchingManuId);
    }

    // Compute remaining versions directly from participantBookVersions BEFORE calling getBookVersionsForInterview
    const remainingDirect = Array.from(this.participantBookVersions.values()).filter(
      (v) => v.interviewId === interviewId && !this.deletedBookVersionIds.has(v.id)
    );
    interview.bookGeneratedCount = remainingDirect.length;

    if (restoreQuota) {
      if ((interview.layoutEditsUsed ?? 0) > 0) {
        interview.layoutEditsUsed = Math.max(0, (interview.layoutEditsUsed ?? 1) - 1);
      } else {
        interview.layoutEditsAllowed = (interview.layoutEditsAllowed ?? 1) + 1;
      }
    }
    interview.lastActivityAt = new Date().toISOString();
    this.interviews.set(interviewId, interview);
    await this.persistDoc('interviews', interviewId, interview);

    const remainingVersions = this.getBookVersionsForInterview(interviewId);

    await this.addAuditLog(
      'DELETE_PARTICIPANT_BOOK_VERSION',
      'participantBookVersion',
      versionId,
      performedBy,
      {
        interviewId,
        versionNumber: version.versionNumber,
        title: version.title,
        restoreQuota,
        newRemainingEdits: computeLayoutEditQuotaStatus(interview).remainingEdits,
      }
    );

    this.saveStateToDisk();

    return {
      interview,
      allVersions: remainingVersions,
      deletedVersionId: versionId,
      restoredQuota: Boolean(restoreQuota),
    };
  }

  public async seedCompleteTestStories(performedBy: string = 'system_admin'): Promise<{
    seededCount: number;
    interviews: InterviewRecord[];
  }> {
    this.seedCompleteTestStoriesInMemory();
    const testStories = buildCompleteTestStories();
    const seededInterviews: InterviewRecord[] = [];

    for (const story of testStories) {
      await this.persistDoc('interviews', story.interview.id, story.interview);
      for (const part of story.participants) {
        await this.persistDoc('participants', part.id, part);
      }
      for (const tok of story.tokens) {
        await this.persistDoc('interviewTokens', tok.id, tok);
      }
      seededInterviews.push(story.interview);
    }

    // Background sync of answers to Firestore without blocking response
    const allAnswers = testStories.flatMap((s) => s.answers);
    if (serverDb) {
      (async () => {
        try {
          const chunkSize = 25;
          for (let i = 0; i < allAnswers.length; i += chunkSize) {
            const chunk = allAnswers.slice(i, i + chunkSize);
            await Promise.all(
              chunk.map(async (ans) => {
                try {
                  const docRef = doc(serverDb, 'answers', ans.id);
                  const sanitized = this.sanitizeDocForFirestore(ans);
                  await firestoreTelemetry.trackedSetDoc(serverDb, docRef, sanitized, 'storage');
                } catch (_err) {
                  // Ignore remote errors
                }
              })
            );
          }
        } catch (_bgErr) {
          // Ignore remote batch error
        }
      })();
    }

    await this.addAuditLog('SEED_COMPLETE_TEST_STORIES', 'system', 'seed_complete_stories', performedBy, {
      totalStories: seededInterviews.length,
      totalAnswers: allAnswers.length,
    });

    this.saveStateToDisk();

    return {
      seededCount: seededInterviews.length,
      interviews: seededInterviews,
    };
  }

  public async evaluateInterviewManual(interviewId: string, performedBy: string) {
    const interview = this.interviews.get(interviewId);
    if (!interview) throw new Error('Entrevista no encontrada.');

    const answers = this.getAnswersForInterview(interview.id);
    const questions = this.getQuestionsForVersion(interview.questionnaireVersionId);

    const result = await evaluateNarrativeSufficiency({
      interview,
      answers,
      questions,
    });

    interview.sufficiencyStatus = result.sufficiencyStatus;
    this.interviews.set(interview.id, interview);
    await this.persistDoc('interviews', interview.id, interview);

    await this.addAuditLog('EVALUATE_SUFFICIENCY_MANUAL', 'interview', interview.id, performedBy, {
      result,
    });

    return { result, interview };
  }

  // --- Delete Interview & Reset to Initial State ---
  public async deleteInterview(interviewId: string, performedBy: string): Promise<void> {
    const interview = this.interviews.get(interviewId);
    if (!interview) {
      throw new Error('Entrevista no encontrada.');
    }

    // 1. Delete all answers
    const answersToDelete = Array.from(this.answers.values()).filter((a) => a.interviewId === interviewId);
    for (const ans of answersToDelete) {
      this.answers.delete(ans.id);
      await this.removeDoc('answers', ans.id);
    }

    // 2. Delete all photos
    const photosToDelete = Array.from(this.photos.values()).filter((p) => p.interviewId === interviewId);
    for (const photo of photosToDelete) {
      this.photos.delete(photo.id);
      await this.removeDoc('interviewPhotos', photo.id);
    }

    // 3. Delete all audios
    const audiosToDelete = Array.from(this.audios.values()).filter((a) => a.interviewId === interviewId);
    for (const audio of audiosToDelete) {
      this.audios.delete(audio.id);
      await this.removeDoc('interviewAudio', audio.id);
    }

    // 4. Delete all manuscripts
    const manuscriptsToDelete = Array.from(this.manuscripts.values()).filter((m) => m.interviewId === interviewId);
    for (const manu of manuscriptsToDelete) {
      this.manuscripts.delete(manu.id);
      await this.removeDoc('manuscripts', manu.id);
    }

    // 5. Delete all tokens
    const tokensToDelete = Array.from(this.tokens.values()).filter((t) => t.interviewId === interviewId);
    for (const tok of tokensToDelete) {
      if (tok.plainToken) this.plainTokenMap.delete(tok.plainToken);
      if (tok.accessCode) this.accessCodeMap.delete(tok.accessCode.toUpperCase());
      this.tokens.delete(tok.tokenHash);
      await this.removeDoc('interviewTokens', tok.id);
    }

    // 6. Delete all participants
    const partsToDelete = Array.from(this.participants.values()).filter((p) => p.interviewId === interviewId);
    for (const part of partsToDelete) {
      this.participants.delete(part.id);
      await this.removeDoc('participants', part.id);
    }

    // 7. Delete the interview itself
    this.interviews.delete(interviewId);
    await this.removeDoc('interviews', interviewId);

    await this.addAuditLog('DELETE_INTERVIEW', 'interview', interviewId, performedBy, {
      title: interview.title,
      answersDeleted: answersToDelete.length,
      photosDeleted: photosToDelete.length,
      audiosDeleted: audiosToDelete.length,
      manuscriptsDeleted: manuscriptsToDelete.length,
      participantsDeleted: partsToDelete.length,
    });
  }

  public async resetInterview(
    interviewId: string,
    performedBy: string
  ): Promise<{
    interview: InterviewRecord;
    summary: { answersRemoved: number; photosRemoved: number; audiosRemoved: number };
  }> {
    const interview = this.interviews.get(interviewId);
    if (!interview) {
      throw new Error('Entrevista no encontrada.');
    }

    // 1. Remove all answers for this interview
    const answersToDelete = Array.from(this.answers.values()).filter((a) => a.interviewId === interviewId);
    for (const ans of answersToDelete) {
      this.answers.delete(ans.id);
      await this.removeDoc('answers', ans.id);
    }

    // 2. Remove all photos for this interview
    const photosToDelete = Array.from(this.photos.values()).filter((p) => p.interviewId === interviewId);
    for (const photo of photosToDelete) {
      this.photos.delete(photo.id);
      await this.removeDoc('interviewPhotos', photo.id);
    }

    // 3. Remove all audios for this interview
    const audiosToDelete = Array.from(this.audios.values()).filter((a) => a.interviewId === interviewId);
    for (const audio of audiosToDelete) {
      this.audios.delete(audio.id);
      await this.removeDoc('interviewAudio', audio.id);
    }

    // 4. Reset participants progression
    const parts = Array.from(this.participants.values()).filter((p) => p.interviewId === interviewId);
    for (const part of parts) {
      part.status = 'invited';
      part.joinedAt = undefined;
      await this.persistDoc('participants', part.id, part);
    }

    // 5. Reset tokens lastUsedAt and renew expiry
    const nowMs = Date.now();
    const openDaysMs = (interview.openDaysAtCreation || 15) * 86400000;
    const tokens = Array.from(this.tokens.values()).filter((t) => t.interviewId === interviewId);
    for (const tok of tokens) {
      tok.lastUsedAt = undefined;
      tok.revoked = false;
      tok.revokedAt = undefined;
      tok.expiresAt = new Date(nowMs + openDaysMs).toISOString();
      await this.persistDoc('interviewTokens', tok.id, tok);
    }

    // 6. Reset interview progress state to fresh start
    interview.status = 'open';
    interview.completedQuestionCount = 0;
    interview.sufficiencyStatus = 'not_evaluated';
    interview.userDeclaredComplete = false;
    interview.closedAt = null;
    interview.closureReason = null;
    interview.lastActivityAt = new Date().toISOString();
    interview.expiresAt = new Date(nowMs + openDaysMs).toISOString();

    this.interviews.set(interviewId, interview);
    await this.persistDoc('interviews', interviewId, interview);

    await this.addAuditLog('RESET_INTERVIEW', 'interview', interviewId, performedBy, {
      title: interview.title,
      answersRemoved: answersToDelete.length,
      photosRemoved: photosToDelete.length,
      audiosRemoved: audiosToDelete.length,
    });

    return {
      interview,
      summary: {
        answersRemoved: answersToDelete.length,
        photosRemoved: photosToDelete.length,
        audiosRemoved: audiosToDelete.length,
      },
    };
  }

  // --- Manuscripts ---
  public async compileManuscript(interviewId: string, performedBy: string): Promise<ManuscriptRecord> {
    const interview = this.interviews.get(interviewId);
    if (!interview) throw new Error('Entrevista no encontrada.');

    const participants = Array.from(this.participants.values()).filter(
      (p) => p.interviewId === interviewId
    );
    const answers = this.getAnswersForInterview(interviewId);
    const questions = this.getQuestionsForVersion(interview.questionnaireVersionId);

    const activePrompt =
      this.config.literaryPrompts?.['first_person_literary']?.promptText ||
      DEFAULT_LITERARY_PROMPTS_TEXT['first_person_literary'];

    const draft = await generateManuscriptDraft({
      interview,
      participants,
      answers,
      questions,
      literaryPromptText: activePrompt,
      configuredProvider: this.config.bookAiProvider,
      geminiModel: this.config.bookAiGeminiModel,
      openaiModel: this.config.bookAiOpenAiModel,
      bookStructureMode: this.config.bookStructureMode,
    });

    const existingForInterview = Array.from(this.manuscripts.values()).filter(
      (m) => m.interviewId === interviewId
    );
    const maxExistingVersion = existingForInterview.reduce(
      (max, m) => (m.version > max ? m.version : max),
      0
    );
    const versionNumber = maxExistingVersion + 1;
    const manuscriptId = `manu_${interviewId}_v${versionNumber}`;

    const manuscriptStatus: ManuscriptRecord['status'] =
      draft.generationStatus === 'approved'
        ? 'approved'
        : draft.generationStatus === 'incomplete_draft'
        ? 'incomplete_draft'
        : 'draft';

    const manuscript: ManuscriptRecord = {
      id: manuscriptId,
      interviewId,
      version: versionNumber,
      title: draft.title || interview.title,
      summary: draft.summary,
      content: draft.compiledMarkdown,
      status: manuscriptStatus,
      isPartialMemoir: draft.isPartialMemoir,
      incompleteDraftNotice: draft.incompleteDraftNotice,
      internalReasonCode: draft.internalReasonCode,
      diagnosticSummary: draft.diagnosticSummary,
      documentaryAudit: draft.documentaryAudit,
      editorialAudit: draft.editorialAudit,
      generatedAt: new Date().toISOString(),
      generatedBy: performedBy,
    };

    this.manuscripts.set(manuscriptId, manuscript);
    await this.persistDoc('manuscripts', manuscriptId, manuscript);

    await this.addAuditLog('GENERATE_MANUSCRIPT', 'manuscript', manuscriptId, performedBy, {
      interviewId,
      versionNumber,
      answersIncludedCount: answers.length,
      generationStatus: draft.generationStatus,
      isPartialMemoir: Boolean(draft.isPartialMemoir),
      internalReasonCode: draft.internalReasonCode || null,
      diagnosticSummary: draft.diagnosticSummary || null,
      coveragePercentage: draft.documentaryAudit?.coveragePercentage ?? null,
    });

    return manuscript;
  }

  public getManuscriptsForInterview(interviewId: string): Array<
    ManuscriptRecord & { photos?: AnswerPhotoAttachment[] }
  > {
    const answers = this.getAnswersForInterview(interviewId);
    const questions = Array.from(this.questions.values());
    const interviewPhotos = answers.flatMap((a) => a.photos || []);

    return Array.from(this.manuscripts.values())
      .filter((m) => m.interviewId === interviewId)
      .map((m) => ({
        ...m,
        content: ensurePhotosPlacedInManuscript({
          compiledMarkdown: m.content,
          answers,
          questions,
        }),
        photos: interviewPhotos,
      }))
      .sort((a, b) => b.version - a.version);
  }

  public getAllManuscripts(): Array<
    ManuscriptRecord & {
      interviewTitle?: string;
      storyMode?: 'individual' | 'compartida';
      photos?: AnswerPhotoAttachment[];
    }
  > {
    const questions = Array.from(this.questions.values());
    return Array.from(this.manuscripts.values())
      .map((m) => {
        const inv = this.interviews.get(m.interviewId);
        const answers = this.getAnswersForInterview(m.interviewId);
        const interviewPhotos = answers.flatMap((a) => a.photos || []);
        return {
          ...m,
          interviewTitle: inv?.title || m.title,
          storyMode: inv?.storyMode,
          content: ensurePhotosPlacedInManuscript({
            compiledMarkdown: m.content,
            answers,
            questions,
          }),
          photos: interviewPhotos,
        };
      })
      .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
  }

  public async deleteManuscript(
    manuscriptId: string,
    performedBy: string
  ): Promise<{ deletedId: string; interviewId: string }> {
    const manuscript = this.manuscripts.get(manuscriptId);
    if (!manuscript) {
      throw new Error('Manuscrito no encontrado.');
    }
    const interviewId = manuscript.interviewId;
    this.manuscripts.delete(manuscriptId);
    await this.removeDoc('manuscripts', manuscriptId);

    const interview = this.interviews.get(interviewId);
    if (interview) {
      interview.lastActivityAt = new Date().toISOString();
      this.interviews.set(interviewId, interview);
      await this.persistDoc('interviews', interviewId, interview);
    }

    await this.addAuditLog('DELETE_MANUSCRIPT', 'manuscript', manuscriptId, performedBy, {
      interviewId,
      version: manuscript.version,
      title: manuscript.title,
    });

    return { deletedId: manuscriptId, interviewId };
  }

  // --- Participants & Tokens retrieval ---
  public getParticipantsForInterview(
    interviewId: string
  ): Array<ParticipantRecord & { plainToken?: string; accessCode?: string; inviteUrl?: string }> {
    this.ensureParticipantTokensConsistent();
    const parts = Array.from(this.participants.values()).filter((p) => p.interviewId === interviewId);
    const result: Array<
      ParticipantRecord & { plainToken?: string; accessCode?: string; inviteUrl?: string }
    > = [];

    for (const p of parts) {
      const token = Array.from(this.tokens.values()).find(
        (t) => t.participantId === p.id && !t.revoked
      );
      let plain: string | undefined = token?.plainToken;
      if (token && !plain) {
        for (const [pToken, hash] of this.plainTokenMap.entries()) {
          if (hash === token.tokenHash) {
            plain = pToken;
            break;
          }
        }
      }
      const code = token?.accessCode || deriveDeterministicAccessCode(p.id);
      result.push({
        ...p,
        plainToken: plain,
        accessCode: code,
        inviteUrl: plain ? `/interview?token=${plain}` : undefined,
      });
    }

    return result;
  }

  // --- Audit Logs ---
  public async addAuditLog(
    action: string,
    targetType: string,
    targetId: string,
    performedBy: string,
    details?: Record<string, unknown>
  ): Promise<AuditLogRecord> {
    const log: AuditLogRecord = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      action,
      targetType,
      targetId,
      performedBy,
      details,
      timestamp: new Date().toISOString(),
    };
    this.auditLogs.unshift(log);
    await this.persistDoc('auditLogs', log.id, log);
    return log;
  }

  public getAuditLogs(limit: number = 50): AuditLogRecord[] {
    return this.auditLogs.slice(0, limit);
  }

  // --- Demo Seeder for Evaluator / Testing ---
  public async seedDemoData(): Promise<{ individualToken: string; sharedTokens: string[] }> {
    // 1. Seed Individual Interview: "Memorias de Don Fernando"
    const indRes = await this.createInterview({
      title: 'Memorias de Don Fernando: Raíces y Legado',
      storyMode: 'individual',
      storyType: 'biografia_personal',
      customOpenDays: 20,
      customSufficiencyThreshold: 5,
      performedBy: 'garcia.michel@gmail.com',
      participants: [
        {
          name: 'Fernando Morales',
          relationship: 'Titular',
          role: 'primary',
          email: 'fernando.morales.demo@example.com',
        },
      ],
    });

    const indToken = indRes.participantTokens[0].plainToken;

    // Add sample answers to Don Fernando's story
    await this.submitAnswer({
      plainToken: indToken,
      questionId: 'q_inf_01',
      answerText:
        'Nací en un pueblito de Michoacán llamado Quiroga en 1948. Recuerdo el patio grande empedrado con naranjos y el olor a tierra mojada.',
      notRecalled: false,
      idempotencyKey: `seed_ind_ans_1_${Date.now()}`,
    });

    await this.submitAnswer({
      plainToken: indToken,
      questionId: 'q_inf_02',
      answerText:
        'Mi padre era carpintero y mi madre tejía manteles. Nos inculcaron siempre la honradez y la puntualidad como el mayor capital de un hombre.',
      notRecalled: false,
      idempotencyKey: `seed_ind_ans_2_${Date.now()}`,
    });

    await this.submitAnswer({
      plainToken: indToken,
      questionId: 'q_inf_03',
      answerText: '',
      notRecalled: true, // «No lo recuerdo»
      idempotencyKey: `seed_ind_ans_3_${Date.now()}`,
    });

    // 2. Seed Shared Interview: "Historia de la Familia Valenzuela"
    const sharedRes = await this.createInterview({
      title: 'Crónicas de la Familia Valenzuela',
      storyMode: 'compartida',
      storyType: 'memorias_familiares',
      customOpenDays: 30,
      customSufficiencyThreshold: 6,
      performedBy: 'garcia.michel@gmail.com',
      participants: [
        {
          name: 'Roberto Valenzuela (Padre)',
          relationship: 'Padre',
          role: 'primary',
          email: 'roberto.valenzuela.demo@example.com',
        },
        {
          name: 'Sofía Valenzuela (Hija)',
          relationship: 'Hija',
          role: 'contributor',
          email: 'sofia.valenzuela.demo@example.com',
        },
      ],
    });

    const fatherToken = sharedRes.participantTokens[0].plainToken;
    const daughterToken = sharedRes.participantTokens[1].plainToken;

    // Both answer the first question with distinct memories (no forced fusion!)
    await this.submitAnswer({
      plainToken: fatherToken,
      questionId: 'q_inf_01',
      answerText:
        'Nuestra primera casa familiar en Monterrey era pequeña, con techo de lámina y un jardín donde planté una higuera que aún sigue en pie.',
      notRecalled: false,
      idempotencyKey: `seed_shared_ans_father_1_${Date.now()}`,
    });

    await this.submitAnswer({
      plainToken: daughterToken,
      questionId: 'q_inf_01',
      answerText:
        'Yo crecí jugando bajo esa higuera que papá cuidaba. Para mí esa casa olía a pan tostado y a las noches de lluvia viendo caer relámpagos con mi hermano.',
      notRecalled: false,
      idempotencyKey: `seed_shared_ans_daughter_1_${Date.now()}`,
    });

    return {
      individualToken: indToken,
      sharedTokens: [fatherToken, daughterToken],
    };
  }

  // --- PRIVACY CONSENT & PARTICIPANT ADMIN PANEL METHODS ---

  public getActiveConsent(interviewId: string, participantId: string): PrivacyConsentRecord | null {
    for (const consent of this.privacyConsents.values()) {
      if (
        consent.interviewId === interviewId &&
        consent.participantId === participantId &&
        consent.status === 'active'
      ) {
        return consent;
      }
    }
    return null;
  }

  public getConsentForParticipant(participantId: string, _version?: string): PrivacyConsentRecord | null {
    for (const consent of this.privacyConsents.values()) {
      if (consent.participantId === participantId && consent.status === 'active') {
        return consent;
      }
    }
    return null;
  }

  public getPrivacyPolicyVersion(version?: string) {
    return {
      version: version || PRIVACY_NOTICE_VERSION,
      content: COMPREHENSIVE_PRIVACY_NOTICE,
      publishedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  public getConsentHistory(interviewId: string, participantId: string): PrivacyConsentRecord[] {
    return Array.from(this.privacyConsents.values())
      .filter((c) => c.interviewId === interviewId && c.participantId === participantId)
      .sort((a, b) => new Date(b.acceptedAt).getTime() - new Date(a.acceptedAt).getTime());
  }

  public async recordPrivacyConsent(
    plainToken: string,
    hasAcceptedSingleCheckbox: boolean,
    userAgent?: string
  ): Promise<PrivacyConsentRecord> {
    const { interview, participant, token } = this.resolveToken(plainToken);

    // Validate using pure logic
    const validation = validateConsentSubmission({
      interviewId: interview.id,
      participantId: participant.id,
      participantName: participant.name,
      hasAcceptedSingleCheckbox,
      versionId: PRIVACY_NOTICE_VERSION,
      noticeContent: COMPREHENSIVE_PRIVACY_NOTICE,
    });

    if (!validation.isValid) {
      throw new Error(validation.error || 'Aceptación de privacidad no válida.');
    }

    // Check if an identical active consent already exists (idempotency)
    const existing = this.getActiveConsent(interview.id, participant.id);
    if (existing && existing.declarationHash === validation.declarationHash) {
      return existing;
    }

    const nowIso = new Date().toISOString();
    const consentId = `consent_${interview.id}_${participant.id}_${Date.now()}`;
    const newConsent: any = {
      id: consentId,
      interviewId: interview.id,
      participantId: participant.id,
      participantName: participant.name,
      versionId: PRIVACY_NOTICE_VERSION,
      policyVersion: PRIVACY_NOTICE_VERSION,
      noticeHash: validation.noticeHash,
      declarationHash: validation.declarationHash,
      policyHash: validation.declarationHash,
      declarationText: validation.declarationText,
      acceptedAt: nowIso,
      serverTimestamp: nowIso,
      serverTimezone: 'America/Merida',
      expressAcceptance: true,
      identityConfirmed: true,
      authMechanism: 'invitation_token_hash_sha256',
      status: 'active',
      userAgent,
      declarations: {
        declarationA_acknowledgement: true,
        declarationB_necessaryProcessing: true,
        declarationC_sensitiveData: true,
        declarationD_financialData: true,
        declarationE_aiAssistant: true,
        declarationF_shareWithFamily: false,
        declarationG_promotionalUse: false,
      },
    };

    this.privacyConsents.set(consentId, newConsent);
    await this.persistDoc('privacyConsents', consentId, newConsent);

    await this.addAuditLog('ACCEPT_PRIVACY_CONSENT', 'privacyConsent', consentId, participant.name, {
      interviewId: interview.id,
      participantId: participant.id,
      versionId: PRIVACY_NOTICE_VERSION,
      declarationHash: validation.declarationHash,
      noticeHash: validation.noticeHash,
    });

    return newConsent;
  }

  public async submitPrivacyConsent(params: {
    plainToken: string;
    declarations?: any;
    confirmedIdentity?: boolean;
    confirmedParticipantName?: string;
    clientIp?: string;
  }): Promise<PrivacyConsentRecord> {
    return this.recordPrivacyConsent(params.plainToken, true, params.clientIp);
  }

  public async updateOptionalDeclarations(params: {
    plainToken: string;
    declarations?: any;
    reason?: string;
  }): Promise<PrivacyConsentRecord> {
    const { interview, participant } = this.resolveToken(params.plainToken);
    const existing = this.getActiveConsent(interview.id, participant.id);
    if (!existing) {
      return this.recordPrivacyConsent(params.plainToken, true);
    }
    return existing;
  }

  public async revokePrivacyConsent(
    plainTokenOrOptions: string | { plainToken: string; reason?: string },
    maybeReason?: string
  ): Promise<PrivacyConsentRecord> {
    const plainToken = typeof plainTokenOrOptions === 'string' ? plainTokenOrOptions : plainTokenOrOptions.plainToken;
    const reason = typeof plainTokenOrOptions === 'object' && plainTokenOrOptions.reason ? plainTokenOrOptions.reason : maybeReason;
    const { interview, participant } = this.resolveToken(plainToken);
    const existing = this.getActiveConsent(interview.id, participant.id);
    if (!existing) {
      throw new Error('No existe un consentimiento activo para revocar.');
    }

    existing.status = 'revoked';
    existing.revokedAt = new Date().toISOString();
    existing.revocationReason = reason || 'Revocación voluntaria por el titular.';

    this.privacyConsents.set(existing.id, existing);
    await this.persistDoc('privacyConsents', existing.id, existing);

    await this.addAuditLog('REVOKE_PRIVACY_CONSENT', 'privacyConsent', existing.id, participant.name, {
      interviewId: interview.id,
      participantId: participant.id,
      reason,
    });

    return existing;
  }

  public getAllPrivacyConsents(): PrivacyConsentRecord[] {
    return Array.from(this.privacyConsents.values()).map((c: any) => ({
      ...c,
      policyVersion: c.policyVersion || c.versionId || PRIVACY_NOTICE_VERSION,
      serverTimestamp: c.serverTimestamp || c.acceptedAt || new Date().toISOString(),
      serverTimezone: c.serverTimezone || 'America/Merida',
      policyHash: c.policyHash || c.declarationHash || c.noticeHash || '',
      declarations: c.declarations || {
        declarationA_acknowledgement: true,
        declarationB_necessaryProcessing: true,
        declarationC_sensitiveData: true,
        declarationD_financialData: true,
        declarationE_aiAssistant: true,
        declarationF_shareWithFamily: false,
        declarationG_promotionalUse: false,
      },
    }));
  }

  // --- BOOK SHARING (DIGITAL BOOK ONLY - NO RAW VOICES/ANSWERS/PHOTOS) ---

  public getBookShares(interviewId: string, participantId: string): BookShareRecord[] {
    return Array.from(this.bookShares.values())
      .filter((s) => s.interviewId === interviewId && s.participantId === participantId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public async addBookShare(
    plainToken: string,
    payload: {
      recipientName: string;
      recipientEmail: string;
      relationship?: string;
      note?: string;
      manuscriptId?: string;
    }
  ): Promise<BookShareRecord> {
    const { interview, participant } = this.resolveToken(plainToken);

    const check = validateBookShare({
      recipientName: payload.recipientName,
      recipientEmail: payload.recipientEmail,
    });
    if (!check.isValid) {
      throw new Error(check.error);
    }

    const shareId = `share_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newShare: BookShareRecord = {
      id: shareId,
      interviewId: interview.id,
      participantId: participant.id,
      participantName: participant.name,
      recipientName: payload.recipientName.trim(),
      recipientEmail: payload.recipientEmail.trim().toLowerCase(),
      relationship: payload.relationship?.trim() || 'Familiar',
      note: payload.note?.trim(),
      manuscriptId: payload.manuscriptId,
      status: 'active',
      createdAt: new Date().toISOString(),
      shareDigitalBookOnly: true,
    };

    this.bookShares.set(shareId, newShare);
    await this.persistDoc('bookShares', shareId, newShare);

    await this.addAuditLog('ADD_BOOK_SHARE', 'bookShare', shareId, participant.name, {
      recipientEmail: newShare.recipientEmail,
      recipientName: newShare.recipientName,
    });

    return newShare;
  }

  public async revokeBookShare(plainToken: string, shareId: string): Promise<BookShareRecord> {
    const { interview, participant } = this.resolveToken(plainToken);
    const share = this.bookShares.get(shareId);
    if (!share || share.interviewId !== interview.id || share.participantId !== participant.id) {
      throw new Error('Registro de compartición no encontrado o no autorizado.');
    }

    share.status = 'revoked';
    share.revokedAt = new Date().toISOString();
    this.bookShares.set(shareId, share);
    await this.persistDoc('bookShares', shareId, share);

    await this.addAuditLog('REVOKE_BOOK_SHARE', 'bookShare', shareId, participant.name, {
      recipientEmail: share.recipientEmail,
    });

    return share;
  }

  // --- SCHEDULED DELIVERIES (FUTURE DIGITAL BOOK DELIVERY) ---

  public getScheduledDeliveries(interviewId: string, participantId: string): ScheduledDeliveryRecord[] {
    return Array.from(this.scheduledDeliveries.values())
      .filter((d) => d.interviewId === interviewId && d.participantId === participantId)
      .sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime());
  }

  public getDeliverySchedulesForInterview(interviewId: string): ScheduledDeliveryRecord[] {
    return Array.from(this.scheduledDeliveries.values()).filter((d) => d.interviewId === interviewId);
  }

  public getAllDeliverySchedules(): ScheduledDeliveryRecord[] {
    return Array.from(this.scheduledDeliveries.values());
  }

  public async scheduleBookDelivery(params: {
    plainToken: string;
    recipientEmail: string;
    recipientName?: string;
    scheduledDate: string;
    notes?: string;
  }): Promise<ScheduledDeliveryRecord> {
    return this.addScheduledDelivery(params.plainToken, {
      recipientName: params.recipientName || '',
      recipientEmail: params.recipientEmail,
      scheduledDate: params.scheduledDate,
      note: params.notes,
    });
  }

  public async addScheduledDelivery(
    plainToken: string,
    payload: {
      recipientName: string;
      recipientEmail: string;
      scheduledDate: string;
      note?: string;
      manuscriptId?: string;
    }
  ): Promise<ScheduledDeliveryRecord> {
    const { interview, participant } = this.resolveToken(plainToken);

    const check = validateBookShare({
      recipientName: payload.recipientName,
      recipientEmail: payload.recipientEmail,
      scheduledDate: payload.scheduledDate,
    });
    if (!check.isValid) {
      throw new Error(check.error);
    }

    const deliveryId = `deliv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newDelivery: ScheduledDeliveryRecord = {
      id: deliveryId,
      interviewId: interview.id,
      participantId: participant.id,
      participantName: participant.name,
      recipientName: payload.recipientName.trim(),
      recipientEmail: payload.recipientEmail.trim().toLowerCase(),
      scheduledDate: payload.scheduledDate,
      note: payload.note?.trim(),
      manuscriptId: payload.manuscriptId,
      status: 'scheduled',
      createdAt: new Date().toISOString(),
      shareDigitalBookOnly: true,
    };

    this.scheduledDeliveries.set(deliveryId, newDelivery);
    await this.persistDoc('scheduledDeliveries', deliveryId, newDelivery);

    await this.addAuditLog('SCHEDULE_BOOK_DELIVERY', 'scheduledDelivery', deliveryId, participant.name, {
      recipientEmail: newDelivery.recipientEmail,
      scheduledDate: newDelivery.scheduledDate,
    });

    return newDelivery;
  }

  public async updateScheduledDelivery(
    plainToken: string,
    deliveryId: string,
    payload: {
      recipientName?: string;
      recipientEmail?: string;
      scheduledDate?: string;
      note?: string;
    }
  ): Promise<ScheduledDeliveryRecord> {
    const { interview, participant } = this.resolveToken(plainToken);
    const delivery = this.scheduledDeliveries.get(deliveryId);
    if (!delivery || delivery.interviewId !== interview.id || delivery.participantId !== participant.id) {
      throw new Error('Entrega programada no encontrada o no autorizada.');
    }

    if (payload.recipientName) delivery.recipientName = payload.recipientName.trim();
    if (payload.recipientEmail) delivery.recipientEmail = payload.recipientEmail.trim().toLowerCase();
    if (payload.scheduledDate) delivery.scheduledDate = payload.scheduledDate;
    if (payload.note !== undefined) delivery.note = payload.note.trim();
    delivery.status = 'modified';
    delivery.updatedAt = new Date().toISOString();

    this.scheduledDeliveries.set(deliveryId, delivery);
    await this.persistDoc('scheduledDeliveries', deliveryId, delivery);

    await this.addAuditLog('UPDATE_SCHEDULED_DELIVERY', 'scheduledDelivery', deliveryId, participant.name, {
      newDate: delivery.scheduledDate,
      recipientEmail: delivery.recipientEmail,
    });

    return delivery;
  }

  public async cancelScheduledDelivery(
    plainToken: string,
    deliveryId: string
  ): Promise<ScheduledDeliveryRecord> {
    const { interview, participant } = this.resolveToken(plainToken);
    const delivery = this.scheduledDeliveries.get(deliveryId);
    if (!delivery || delivery.interviewId !== interview.id || delivery.participantId !== participant.id) {
      throw new Error('Entrega programada no encontrada o no autorizada.');
    }

    delivery.status = 'cancelled';
    delivery.updatedAt = new Date().toISOString();
    this.scheduledDeliveries.set(deliveryId, delivery);
    await this.persistDoc('scheduledDeliveries', deliveryId, delivery);

    await this.addAuditLog('CANCEL_SCHEDULED_DELIVERY', 'scheduledDelivery', deliveryId, participant.name, {
      deliveryId,
    });

    return delivery;
  }

  // --- SECONDARY ACCESS (PERSONAS AUTORIZADAS) ---

  public getSecondaryAccess(interviewId: string, participantId: string): SecondaryAccessRecord[] {
    return Array.from(this.secondaryAccess.values())
      .filter((sa) => sa.interviewId === interviewId && sa.participantId === participantId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public getSecondaryAccessForInterview(interviewId: string): SecondaryAccessRecord[] {
    return Array.from(this.secondaryAccess.values()).filter((sa) => sa.interviewId === interviewId);
  }

  public async addSecondaryAccess(
    plainTokenOrObj:
      | string
      | {
          plainToken: string;
          authorizedPersonName: string;
          authorizedPersonEmail?: string;
          email?: string;
          relationship?: string;
          permissions?: Array<'view_manuscript' | 'consultation_companion'>;
        },
    maybePayload?: {
      authorizedPersonName: string;
      authorizedPersonEmail: string;
      relationship?: string;
      permissions?: Array<'view_manuscript' | 'consultation_companion'>;
    }
  ): Promise<SecondaryAccessRecord> {
    const plainToken = typeof plainTokenOrObj === 'string' ? plainTokenOrObj : plainTokenOrObj.plainToken;
    const payload =
      typeof plainTokenOrObj === 'object'
        ? {
            authorizedPersonName: plainTokenOrObj.authorizedPersonName,
            authorizedPersonEmail: plainTokenOrObj.authorizedPersonEmail || plainTokenOrObj.email || '',
            relationship: plainTokenOrObj.relationship,
            permissions: plainTokenOrObj.permissions,
          }
        : maybePayload || { authorizedPersonName: '', authorizedPersonEmail: '' };

    const { interview, participant } = this.resolveToken(plainToken);

    if (!payload.authorizedPersonName || payload.authorizedPersonName.trim().length < 2) {
      throw new Error('Nombre de la persona autorizada requerido.');
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!payload.authorizedPersonEmail || !emailRegex.test(payload.authorizedPersonEmail.trim())) {
      throw new Error('Correo electrónico inválido.');
    }

    const accessId = `sec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newAccess: SecondaryAccessRecord = {
      id: accessId,
      interviewId: interview.id,
      participantId: participant.id,
      authorizedPersonName: payload.authorizedPersonName.trim(),
      authorizedPersonEmail: payload.authorizedPersonEmail.trim().toLowerCase(),
      relationship: payload.relationship?.trim() || 'Familiar',
      permissions: payload.permissions || ['view_manuscript'],
      status: 'active',
      createdAt: new Date().toISOString(),
      allowRawAnswersOrAudios: false,
    };

    this.secondaryAccess.set(accessId, newAccess);
    await this.persistDoc('secondaryAccess', accessId, newAccess);

    await this.addAuditLog('ADD_SECONDARY_ACCESS', 'secondaryAccess', accessId, participant.name, {
      authorizedPersonEmail: newAccess.authorizedPersonEmail,
      permissions: newAccess.permissions,
    });

    return newAccess;
  }

  public async revokeSecondaryAccess(
    plainToken: string,
    accessId: string
  ): Promise<SecondaryAccessRecord> {
    const { interview, participant } = this.resolveToken(plainToken);
    const access = this.secondaryAccess.get(accessId);
    if (!access || access.interviewId !== interview.id || access.participantId !== participant.id) {
      throw new Error('Acceso secundario no encontrado o no autorizado.');
    }

    access.status = 'revoked';
    access.revokedAt = new Date().toISOString();
    this.secondaryAccess.set(accessId, access);
    await this.persistDoc('secondaryAccess', accessId, access);

    await this.addAuditLog('REVOKE_SECONDARY_ACCESS', 'secondaryAccess', accessId, participant.name, {
      authorizedPersonEmail: access.authorizedPersonEmail,
    });

    return access;
  }

  // --- POST MORTEM INSTRUCTIONS ---

  public getPostMortemInstructions(
    interviewId: string,
    participantId: string
  ): PostMortemInstructionRecord | null {
    for (const inst of this.postMortemInstructions.values()) {
      if (inst.interviewId === interviewId && inst.participantId === participantId && inst.status === 'active') {
        return inst;
      }
    }
    return null;
  }

  public async savePostMortemInstructions(
    plainToken: string,
    payload: {
      designatedPersonName: string;
      designatedPersonEmail: string;
      relationship?: string;
      instructions: string;
      conditionDescription?: string;
    }
  ): Promise<PostMortemInstructionRecord> {
    const { interview, participant } = this.resolveToken(plainToken);

    if (!payload.designatedPersonName || payload.designatedPersonName.trim().length < 2) {
      throw new Error('Nombre de la persona designada requerido.');
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!payload.designatedPersonEmail || !emailRegex.test(payload.designatedPersonEmail.trim())) {
      throw new Error('Correo electrónico de la persona designada inválido.');
    }
    if (!payload.instructions || payload.instructions.trim().length < 5) {
      throw new Error('Instrucciones específicas requeridas.');
    }

    const instId = `pmi_${interview.id}_${participant.id}`;
    const record: PostMortemInstructionRecord = {
      id: instId,
      interviewId: interview.id,
      participantId: participant.id,
      designatedPersonName: payload.designatedPersonName.trim(),
      designatedPersonEmail: payload.designatedPersonEmail.trim().toLowerCase(),
      relationship: payload.relationship?.trim() || 'Familiar / Heredero Testimonial',
      authorizedScope: 'digital_book_only',
      instructions: payload.instructions.trim(),
      conditionDescription: payload.conditionDescription?.trim() || 'Acreditación fehaciente por deudos',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.postMortemInstructions.set(instId, record);
    await this.persistDoc('postMortemInstructions', instId, record);

    await this.addAuditLog('SAVE_POST_MORTEM_INSTRUCTIONS', 'postMortemInstruction', instId, participant.name, {
      designatedPersonEmail: record.designatedPersonEmail,
      designatedPersonName: record.designatedPersonName,
    });

    return record;
  }

  public async revokePostMortemInstructions(plainToken: string): Promise<void> {
    const { interview, participant } = this.resolveToken(plainToken);
    const instId = `pmi_${interview.id}_${participant.id}`;
    const existing = this.postMortemInstructions.get(instId);
    if (existing) {
      existing.status = 'revoked';
      existing.updatedAt = new Date().toISOString();
      this.postMortemInstructions.set(instId, existing);
      await this.persistDoc('postMortemInstructions', instId, existing);

      await this.addAuditLog('REVOKE_POST_MORTEM_INSTRUCTIONS', 'postMortemInstruction', instId, participant.name, {});
    }
  }

  // --- ARCO PRIVACY REQUESTS ---

  public getArcoRequests(interviewId: string, participantId: string): ArcoRequestRecord[] {
    return Array.from(this.arcoRequests.values())
      .filter((ar) => ar.interviewId === interviewId && ar.participantId === participantId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public async submitArcoRequest(
    plainToken: string,
    payload: {
      requestType: 'acceso' | 'rectificacion' | 'cancelacion' | 'oposicion';
      details: string;
      email: string;
    }
  ): Promise<ArcoRequestRecord> {
    const { interview, participant } = this.resolveToken(plainToken);

    if (!payload.details || payload.details.trim().length < 10) {
      throw new Error('Describe con claridad los datos o solicitud relacionada con tus derechos ARCO.');
    }

    const folio = `ARCO-${new Date().getFullYear()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const requestId = `arco_${Date.now()}`;
    const record: ArcoRequestRecord = {
      id: requestId,
      folio,
      interviewId: interview.id,
      participantId: participant.id,
      participantName: participant.name,
      email: (payload.email || participant.email || '').trim().toLowerCase(),
      requestType: payload.requestType,
      details: payload.details.trim(),
      status: 'received',
      createdAt: new Date().toISOString(),
    };

    this.arcoRequests.set(requestId, record);
    await this.persistDoc('arcoRequests', requestId, record);

    await this.addAuditLog('SUBMIT_ARCO_REQUEST', 'arcoRequest', requestId, participant.name, {
      folio,
      requestType: record.requestType,
    });

    return record;
  }

  public async submitARCORequest(params: {
    plainToken: string;
    requestType: 'acceso' | 'rectificacion' | 'cancelacion' | 'oposicion';
    details: string;
    contactEmail?: string;
  }): Promise<ArcoRequestRecord> {
    return this.submitArcoRequest(params.plainToken, {
      requestType: params.requestType,
      details: params.details,
      email: params.contactEmail || '',
    });
  }

  public getAllARCORequests(): ArcoRequestRecord[] {
    return Array.from(this.arcoRequests.values());
  }

  // --- PARTICIPANT AUDIT LOGS (FILTERED SECURELY TO OWN ACTIONS) ---

  public getParticipantAuditLogs(interviewId: string, participantId: string): AuditLogRecord[] {
    return this.auditLogs.filter((log) => {
      if (log.action === 'DUPLICATE_INTERVIEW' || log.action === 'UPDATE_ADMIN_COPY_NOTE') {
        return false;
      }
      if (log.details && log.details.interviewId === interviewId) {
        if (!log.details.participantId || log.details.participantId === participantId) {
          return true;
        }
      }
      return false;
    });
  }

  public getSystemStatisticsSummary() {
    const interviews = Array.from(this.interviews.values());
    const participants = Array.from(this.participants.values());
    const tokens = Array.from(this.tokens.values());
    const questions = Array.from(this.questions.values());
    const answers = Array.from(this.answers.values());
    const photos = Array.from(this.photos.values());
    const audios = Array.from(this.audios.values());
    const manuscripts = Array.from(this.manuscripts.values());
    const bookVersions = Array.from(this.participantBookVersions.values());
    const privacyConsents = Array.from(this.privacyConsents.values());
    const bookShares = Array.from(this.bookShares.values());
    const scheduledDeliveries = Array.from(this.scheduledDeliveries.values());
    const secondaryAccess = Array.from(this.secondaryAccess.values());
    const postMortemInstructions = Array.from(this.postMortemInstructions.values());
    const arcoRequests = Array.from(this.arcoRequests.values());
    const auditLogs = this.auditLogs;

    return {
      interviews,
      participants,
      tokens,
      questions,
      answers,
      photosCount: photos.length,
      audiosCount: audios.length,
      manuscripts,
      bookVersions,
      privacyConsents,
      bookShares,
      scheduledDeliveries,
      secondaryAccess,
      postMortemInstructions,
      arcoRequests,
      auditLogsCount: auditLogs.length,
      recentAuditLogs: auditLogs.slice(0, 25),
    };
  }
}

export const storage = new StorageManager();
