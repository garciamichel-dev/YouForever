import fs from 'fs';
import {
  buildPersonPhotoCatalog,
  buildPhotoContextNote,
  buildPhotoDescriptionUserText,
  cleanPhotoCaptionForDisplay,
  finalizeReplyForPhotos,
  PHOTO_DESCRIPTION_TASK,
  sanitizeGeneratedPhotoDescription,
  selectPhotosForMessage,
  type MiEsenciaChatPhotoRef,
  type MiEsenciaPhotoCatalogEntry,
} from '../../logic/miEsenciaPhotos.ts';
import path from 'path';
import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
// V5.3.2: server access through the Firebase Admin SDK (service identity, see firestoreAdmin.ts).
import { getServerFirestore, collection, doc } from '../firestoreAdmin.ts';
import { storage } from '../storage.ts';
import { decodeImageDataUrl, isArchivalPlaceholderPng } from '../photoIntegrity.ts';
import { OPENAI_DEFAULT_MODEL } from '../../logic/openAiModelIds.ts';
import {
  MI_ESENCIA_QUICK_ACCESS_DEFAULTS,
  buildMiEsenciaAccessEmail,
  countRecentEmailDeliveries,
  findLibraryPromptByName,
  isValidQuickAccessEmail,
  type MiEsenciaParticipantQuickAccess,
} from '../../logic/miEsenciaQuickAccess.ts';
import { firestoreTelemetry } from '../firestoreTelemetry.ts';
import { generateQACompilationMarkdown } from '../backupService.ts';
import {
  MiEsenciaGlobalConfig,
  MiEsenciaPersonProfile,
  MiEsenciaArchivedCompilationPdf,
  MiEsenciaTestimonyBlock,
  MiEsenciaRelatedPerson,
  MiEsenciaInterlocutor,
  MiEsenciaMemoryRecord,
  MiEsenciaContradictionRecord,
  MiEsenciaPlanRecord,
  MiEsenciaSubscriptionRecord,
  MiEsenciaAccessCredential,
  MiEsenciaPaymentRecord,
  MiEsenciaPromotionCoupon,
  MiEsenciaSnapshotRecord,
  MiEsenciaConversationSession,
  MiEsenciaConversationMessage,
  MiEsenciaNotificationRecord,
  MiEsenciaSpontaneityLevel,
  MiEsenciaResponseCategory,
  MiEsenciaPrivacyLevel,
  DEFAULT_MI_ESENCIA_CONFIG,
  DEFAULT_MI_ESENCIA_PLANS,
  computeMiEsenciaCodeHash,
  deriveShortMiEsenciaAccessCode,
  extractCleanMiEsenciaCode,
  generatePersonalAccessCode,
  filterMemoriesForAuthenticatedInterlocutor,
  calculateRenewalExpirationDate,
  applySubscriptionSuspensionState,
  evaluateEffectiveSubscriptionStatus,
  canSubscriptionConverse,
  extractRelatedPersonsFromTestimonies,
  extractLinguisticProfileFromTestimonies,
  parseCompilationTextIntoTestimonies,
  extractTextFromUploadedPdfBase64,
  buildCompilationPdfBase64,
  validateCompilationPdfRecord,
  detectConversationalIntentAndPrivacy,
  retrieveRelevantTestimonies,
  sanitizeAvatarResponseText,
  MiEsenciaReflectionTheme,
  MiEsenciaConfirmedInterlocutorIdentity,
  MiEsenciaTestimonyPhotoAttachment,
  isGenericAdministrativeInterlocutorName,
  buildVariedInitialReflectiveGreeting,
  identifyInterlocutorFromLegacy,
  buildPersonalizedPostIdentificationGreeting,
  classifyConversationalMessage,
  queryFamilyMapFromLegacy,
  classifyInternalResponseType,
  buildPrudentPresentAdviceReply,
  buildNaturalUnknownInfoReply,
  MI_ESENCIA_GENERAL_ACCESS_NAME,
  MI_ESENCIA_GENERAL_ACCESS_RELATIONSHIP,
} from '../../logic/miEsenciaRules.ts';
import {
  DEFAULT_SEED_LIBRARY_PROMPTS,
  DEFAULT_PROMPT_CATEGORIES,
  buildDefaultAvatarAiConfig,
  resolvePromptDynamicVariables,
  createIndependentAvatarPromptCopyFromLibrary,
  buildPersistentSessionSummary,
  parseImportedPromptsPayload,
  exportLibraryPromptsPayload,
  type MiEsenciaAiProvider,
  type MiEsenciaPromptCompatibleProvider,
  type MiEsenciaConversationConfigMode,
  type MiEsenciaAvatarAiConfig,
  type MiEsenciaLibraryPromptRecord,
  type MiEsenciaPromptVersionRecord,
  type MiEsenciaProviderFallbackLog,
} from '../../logic/miEsenciaAiTypesAndRules.ts';
import {
  getProvidersAvailabilityStatus,
  executeCustomAvatarTurnWithFallback,
  generateAvatarShortText,
  testLiveProviderConnection,
  buildMiEsenciaGeminiModelChain,
  MI_ESENCIA_DEFAULT_GEMINI_MODEL,
} from './miEsenciaAiOrchestrator.ts';

const serverDb = getServerFirestore();

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim() === '') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function sanitizeFirestoreObj<T>(data: T): Record<string, unknown> {
  const raw = JSON.parse(JSON.stringify(data));
  const clean = (obj: any): any => {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(clean);
    const out: Record<string, any> = {};
    for (const k of Object.keys(obj)) {
      const val = obj[k];
      if (typeof val === 'string' && val.length > 60_000 && k === 'pdfBase64') {
        out[k] = '';
        out['pdfBase64StoredOnDisk'] = true;
      } else if (typeof val === 'object' && val !== null) {
        out[k] = clean(val);
      } else {
        out[k] = val;
      }
    }
    return out;
  };
  return clean(raw);
}

/**
 * V5.4.0 — Photo metadata (id + description) of an interview answer, for the Mi Esencia chat.
 * Never copies the image itself.
 */
function photoAttachmentsFromAnswer(ans: {
  questionId: string;
  participantName?: string;
  photos?: Array<{ id?: string; caption?: string; fileName?: string; mimeType?: string; imageUrl?: string; participantName?: string }>;
}): MiEsenciaTestimonyPhotoAttachment[] {
  return (ans.photos || [])
    .filter((p) => p && p.id)
    .map((p) => ({
      id: p.id,
      questionId: ans.questionId,
      fileName: p.fileName,
      mimeType: p.mimeType || 'image/jpeg',
      caption: String(p.caption || '').trim() || 'Sin descripción registrada',
      imageUrl: p.imageUrl,
      participantName: p.participantName || ans.participantName,
    }));
}

type PersonalAccessVerification = {
  valid: boolean;
  error?: string;
  subscriptionStatus?: string;
  credential?: MiEsenciaAccessCredential;
  interlocutor?: MiEsenciaInterlocutor;
  subscription?: MiEsenciaSubscriptionRecord;
  persons?: MiEsenciaPersonProfile[];
  config?: MiEsenciaGlobalConfig;
};

class MiEsenciaStore {
  private config: MiEsenciaGlobalConfig = { ...DEFAULT_MI_ESENCIA_CONFIG };
  private plans: Map<string, MiEsenciaPlanRecord> = new Map();
  private subscriptions: Map<string, MiEsenciaSubscriptionRecord> = new Map(); // key = avatarId
  private persons: Map<string, MiEsenciaPersonProfile> = new Map(); // key = personId
  private compilationPdfs: Map<string, MiEsenciaArchivedCompilationPdf> = new Map(); // key = pdfId
  private testimonies: Map<string, MiEsenciaTestimonyBlock> = new Map(); // key = testimonyId
  /**
   * V5.4.2: fingerprint of the interview content each person was last synced from. When it has not
   * changed, the routine sync (every family login and every chat message) does no work at all.
   */
  private personSourceFingerprints: Map<string, string> = new Map();
  /** V5.4.2: AI photo descriptions per person + photo + prompt (memory cache). */
  private photoDescriptionCache: Map<string, string> = new Map();
  /** V5.4.2: test hook that replaces the AI call for photo descriptions. */
  private photoDescriptionGeneratorForTests:
    | ((input: { systemInstructions: string; userText: string }) => Promise<string | null>)
    | null = null;
  private relations: Map<string, MiEsenciaRelatedPerson> = new Map(); // key = relatedPersonId
  private interlocutors: Map<string, MiEsenciaInterlocutor> = new Map(); // key = interlocutorId
  private credentials: Map<string, MiEsenciaAccessCredential> = new Map(); // key = accessCredentialId
  private memories: Map<string, MiEsenciaMemoryRecord> = new Map(); // key = memoryId
  private contradictions: Map<string, MiEsenciaContradictionRecord> = new Map(); // key = contradictionId
  private payments: Map<string, MiEsenciaPaymentRecord> = new Map(); // key = paymentId
  private coupons: Map<string, MiEsenciaPromotionCoupon> = new Map(); // key = couponId
  private snapshots: Map<string, MiEsenciaSnapshotRecord> = new Map(); // key = snapshotId
  private conversations: Map<string, MiEsenciaConversationSession> = new Map(); // key = sessionId
  private notifications: Map<string, MiEsenciaNotificationRecord> = new Map(); // key = notificationId
  private promptLibrary: Map<string, MiEsenciaLibraryPromptRecord> = new Map(); // key = promptId
  private avatarPromptVersions: Map<string, MiEsenciaPromptVersionRecord> = new Map(); // key = versionId
  private fallbackLogs: Map<string, MiEsenciaProviderFallbackLog> = new Map(); // key = logId
  private deletedRegistry: {
    persons: Set<string>;
    subscriptions: Set<string>;
    pdfs: Set<string>;
    credentials: Set<string>;
  } = {
    persons: new Set<string>(),
    subscriptions: new Set<string>(),
    pdfs: new Set<string>(),
    credentials: new Set<string>(),
  };

  private initialized = false;
  private lastFirestoreSyncAt: string | null = null;
  private activeSyncPromise: Promise<void> | null = null;

  constructor() {
    for (const p of DEFAULT_MI_ESENCIA_PLANS) {
      this.plans.set(p.planId, { ...p });
    }
    this.seedDefaultPromptLibraryIfNeeded();
    this.loadFromDisk();
    this.seedDefaultPromptLibraryIfNeeded();
  }

  private seedDefaultPromptLibraryIfNeeded(): void {
    if (this.promptLibrary.size > 0) return;
    const nowIso = new Date().toISOString();
    for (const seed of DEFAULT_SEED_LIBRARY_PROMPTS) {
      const initialVer: MiEsenciaPromptVersionRecord = {
        versionId: `pver_seed_${seed.promptId}`,
        targetType: 'library_prompt',
        targetId: seed.promptId,
        provider: seed.compatibleProvider,
        versionNumber: 1,
        promptName: seed.name,
        content: seed.content,
        modifiedAt: nowIso,
        modifiedBy: 'system',
        sourceReference: 'Plantilla base preconfigurada de Mi Esencia',
      };
      this.promptLibrary.set(seed.promptId, {
        ...seed,
        createdAt: nowIso,
        updatedAt: nowIso,
        versionHistory: [initialVer],
      });
    }
  }

  private getDiskPath(): string {
    const dir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, 'mi_esencia_state.json');
  }

  private serializeDeletedRegistry() {
    return {
      persons: Array.from(this.deletedRegistry.persons),
      subscriptions: Array.from(this.deletedRegistry.subscriptions),
      pdfs: Array.from(this.deletedRegistry.pdfs),
      credentials: Array.from(this.deletedRegistry.credentials),
    };
  }

  private applyDeletedRegistryFilters(): void {
    for (const pid of this.deletedRegistry.persons) {
      this.persons.delete(pid);
    }
    for (const aid of this.deletedRegistry.subscriptions) {
      this.subscriptions.delete(aid);
    }
    for (const pdfId of this.deletedRegistry.pdfs) {
      this.compilationPdfs.delete(pdfId);
    }
    for (const credId of this.deletedRegistry.credentials) {
      this.credentials.delete(credId);
    }
    for (const [pid, p] of Array.from(this.persons.entries())) {
      if (this.deletedRegistry.subscriptions.has(p.avatarId)) {
        this.persons.delete(pid);
      }
    }
    for (const [pdfId, pdf] of Array.from(this.compilationPdfs.entries())) {
      if (this.deletedRegistry.subscriptions.has(pdf.avatarId)) {
        this.compilationPdfs.delete(pdfId);
      }
    }
  }

  private saveToDisk(): void {
    try {
      const payload = {
        savedAt: new Date().toISOString(),
        config: this.config,
        deletedRegistry: this.serializeDeletedRegistry(),
        plans: Array.from(this.plans.values()),
        subscriptions: Array.from(this.subscriptions.values()),
        persons: Array.from(this.persons.values()),
        compilationPdfs: Array.from(this.compilationPdfs.values()).map((pdf) => ({
          ...pdf,
          pdfBase64: pdf.pdfBase64 && pdf.pdfBase64.length < 120_000 ? pdf.pdfBase64 : '',
        })),
        testimonies: Array.from(this.testimonies.values()).map((t) => ({
          ...t,
          photoAttachments: t.photoAttachments
            ? t.photoAttachments.map((pa) => ({
                ...pa,
                dataUrl: pa.dataUrl && pa.dataUrl.length < 25_000 ? pa.dataUrl : undefined,
              }))
            : undefined,
        })),
        relations: Array.from(this.relations.values()),
        interlocutors: Array.from(this.interlocutors.values()),
        credentials: Array.from(this.credentials.values()),
        memories: Array.from(this.memories.values()),
        contradictions: Array.from(this.contradictions.values()),
        payments: Array.from(this.payments.values()),
        coupons: Array.from(this.coupons.values()),
        snapshots: Array.from(this.snapshots.values()).slice(-60),
        conversations: Array.from(this.conversations.values()),
        notifications: Array.from(this.notifications.values()),
        promptLibrary: Array.from(this.promptLibrary.values()),
        avatarPromptVersions: Array.from(this.avatarPromptVersions.values()),
        fallbackLogs: Array.from(this.fallbackLogs.values()).slice(-100),
        lastFirestoreSyncAt: this.lastFirestoreSyncAt,
      };
      fs.writeFileSync(this.getDiskPath(), JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[MiEsenciaStore] Disk save warning:', err);
    }
  }

  private loadFromDisk(): void {
    try {
      const file = this.getDiskPath();
      if (!fs.existsSync(file)) return;
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (raw.config) this.config = this.migrateConfigDefaults({ ...DEFAULT_MI_ESENCIA_CONFIG, ...raw.config });
      if (raw.deletedRegistry) {
        if (Array.isArray(raw.deletedRegistry.persons)) {
          raw.deletedRegistry.persons.forEach((id: string) => this.deletedRegistry.persons.add(id));
        }
        if (Array.isArray(raw.deletedRegistry.subscriptions)) {
          raw.deletedRegistry.subscriptions.forEach((id: string) =>
            this.deletedRegistry.subscriptions.add(id)
          );
        }
        if (Array.isArray(raw.deletedRegistry.pdfs)) {
          raw.deletedRegistry.pdfs.forEach((id: string) => this.deletedRegistry.pdfs.add(id));
        }
        if (Array.isArray(raw.deletedRegistry.credentials)) {
          raw.deletedRegistry.credentials.forEach((id: string) =>
            this.deletedRegistry.credentials.add(id)
          );
        }
      }
      if (Array.isArray(raw.plans)) {
        for (const p of raw.plans) this.plans.set(p.planId, p);
      }
      if (Array.isArray(raw.subscriptions)) {
        for (const s of raw.subscriptions) {
          if (!this.deletedRegistry.subscriptions.has(s.avatarId)) {
            this.subscriptions.set(s.avatarId, s);
          }
        }
      }
      if (Array.isArray(raw.persons)) {
        for (const p of raw.persons) {
          if (
            !this.deletedRegistry.persons.has(p.personId) &&
            !this.deletedRegistry.subscriptions.has(p.avatarId)
          ) {
            this.persons.set(p.personId, p);
          }
        }
      }
      if (Array.isArray(raw.compilationPdfs)) {
        for (const pdf of raw.compilationPdfs) {
          if (
            !this.deletedRegistry.pdfs.has(pdf.pdfId) &&
            !this.deletedRegistry.subscriptions.has(pdf.avatarId)
          ) {
            this.compilationPdfs.set(pdf.pdfId, pdf);
          }
        }
      }
      if (Array.isArray(raw.testimonies)) {
        for (const t of raw.testimonies) {
          if (!this.deletedRegistry.persons.has(t.personId)) {
            this.testimonies.set(t.testimonyId, t);
          }
        }
      }
      if (Array.isArray(raw.relations)) {
        for (const r of raw.relations) {
          if (!this.deletedRegistry.persons.has(r.personId)) {
            this.relations.set(r.relatedPersonId, r);
          }
        }
      }
      if (Array.isArray(raw.interlocutors)) {
        for (const i of raw.interlocutors) {
          if (!this.deletedRegistry.subscriptions.has(i.avatarId)) {
            this.interlocutors.set(i.interlocutorId, i);
          }
        }
      }
      if (Array.isArray(raw.credentials)) {
        for (const c of raw.credentials) {
          if (
            !this.deletedRegistry.credentials.has(c.accessCredentialId) &&
            !this.deletedRegistry.subscriptions.has(c.avatarId)
          ) {
            this.credentials.set(c.accessCredentialId, c);
          }
        }
      }
      if (Array.isArray(raw.memories)) {
        for (const m of raw.memories) this.memories.set(m.memoryId, m);
      }
      if (Array.isArray(raw.contradictions)) {
        for (const c of raw.contradictions) this.contradictions.set(c.contradictionId, c);
      }
      if (Array.isArray(raw.payments)) {
        for (const p of raw.payments) this.payments.set(p.paymentId, p);
      }
      if (Array.isArray(raw.coupons)) {
        for (const c of raw.coupons) this.coupons.set(c.couponId, c);
      }
      if (Array.isArray(raw.snapshots)) {
        for (const s of raw.snapshots) this.snapshots.set(s.snapshotId, s);
      }
      if (Array.isArray(raw.conversations)) {
        for (const c of raw.conversations) this.conversations.set(c.sessionId, c);
      }
      if (Array.isArray(raw.notifications)) {
        for (const n of raw.notifications) this.notifications.set(n.notificationId, n);
      }
      if (Array.isArray(raw.promptLibrary)) {
        for (const pr of raw.promptLibrary) this.promptLibrary.set(pr.promptId, pr);
      }
      if (Array.isArray(raw.avatarPromptVersions)) {
        for (const pv of raw.avatarPromptVersions) this.avatarPromptVersions.set(pv.versionId, pv);
      }
      if (Array.isArray(raw.fallbackLogs)) {
        for (const fl of raw.fallbackLogs) this.fallbackLogs.set(fl.logId, fl);
      }
      if (typeof raw.lastFirestoreSyncAt === 'string') {
        this.lastFirestoreSyncAt = raw.lastFirestoreSyncAt;
      }
      this.applyDeletedRegistryFilters();
    } catch (err) {
      console.warn('[MiEsenciaStore] Disk load warning:', err);
    }
  }

  private async persistDoc(collectionName: string, docId: string, data: unknown): Promise<void> {
    this.saveToDisk();
    try {
      const sanitized = sanitizeFirestoreObj(data);
      const serialized = JSON.stringify(sanitized);
      const byteSize = Buffer.byteLength(serialized, 'utf8');
      if (byteSize > 800_000) {
        return;
      }
      await firestoreTelemetry.trackedSetDoc(
        serverDb,
        doc(serverDb, collectionName, docId),
        sanitized,
        'miEsencia'
      );
    } catch (err: any) {
      console.warn(
        `[MiEsenciaStore Firestore Note] Could not persist ${collectionName}/${docId}:`,
        err?.message || err
      );
    }
  }

  private async removeDoc(collectionName: string, docId: string): Promise<void> {
    this.saveToDisk();
    try {
      await firestoreTelemetry.trackedDeleteDoc(
        serverDb,
        doc(serverDb, collectionName, docId),
        'miEsencia'
      );
    } catch (err: any) {
      console.warn(
        `[MiEsenciaStore Firestore Note] Could not delete ${collectionName}/${docId}:`,
        err?.message || err
      );
    }
  }

  /**
   * Construye los bloques de testimonio completos (incluyendo preguntas/respuestas originales,
   * transcripciones de voz editadas, recuerdos adicionales y fotografías con sus descripciones e imágenes en base64)
   * a partir de los registros de una entrevista.
   */
  private buildTestimonyBlocksFromInterviewData(params: {
    interviewId: string;
    personId: string;
    avatarId: string;
    pdfId: string;
    participantIdFilter?: string;
    multipleParticipants?: boolean;
    /**
     * V5.4.2: load each photo's image (base64) only when a PDF is going to be built. The routine
     * sync (every family login and every chat message) only needs ids and descriptions.
     */
    includePhotoData?: boolean;
  }): {
    blocks: MiEsenciaTestimonyBlock[];
    photosWithDataUrl: MiEsenciaTestimonyPhotoAttachment[];
    rawMarkdown: string;
  } {
    const nowIso = new Date().toISOString();
    const allInterviewAnswers = storage.getAnswersForInterview(params.interviewId);
    const questions = storage.getQuestions();
    const questionMap = new Map(questions.map((q) => [q.id, q]));
    const allPhotos = storage.getPhotosForInterview(params.interviewId, Boolean(params.includePhotoData));
    const photoMap = new Map(allPhotos.map((p) => [p.id, p]));
    // V5.4.2: photos grouped by question once (instead of scanning every photo for every answer).
    const photosByQuestion = new Map<string, typeof allPhotos>();
    for (const p of allPhotos) {
      if (!p?.questionId) continue;
      const list = photosByQuestion.get(p.questionId) || [];
      list.push(p);
      photosByQuestion.set(p.questionId, list);
    }
    const allAudios = storage.getAudiosForInterview(params.interviewId);
    const audioMap = new Map(allAudios.map((a) => [a.id, a]));

    const filteredAnswers =
      params.multipleParticipants && params.participantIdFilter
        ? allInterviewAnswers.filter(
            (a) => a.participantId === params.participantIdFilter || !a.participantId
          )
        : allInterviewAnswers;

    const blocks: MiEsenciaTestimonyBlock[] = [];
    const collectedPhotosMap = new Map<string, MiEsenciaTestimonyPhotoAttachment>();

    for (const ans of filteredAnswers) {
      if (ans.notRecalled) continue;
      const qObj = questionMap.get(ans.questionId);
      const parentQ = ans.parentQuestionId ? questionMap.get(ans.parentQuestionId) : undefined;
      const qLiteral =
        ans.questionText ||
        qObj?.text ||
        (ans.isAdditionalMemory
          ? 'Información adicional incorporada posteriormente'
          : 'Pregunta biográfica de entrevista');
      const stage = (
        qObj?.lifeStage ||
        parentQ?.lifeStage ||
        'legado_general'
      ) as MiEsenciaTestimonyBlock['lifeStage'];

      const voiceList =
        ans.audioRecordings && ans.audioRecordings.length > 0
          ? ans.audioRecordings
          : ans.audio
          ? [ans.audio]
          : [];

      const audioTranscriptions = voiceList
        .map((v) => {
          if (!v) return '';
          const storedAud = v.id ? audioMap.get(v.id) : undefined;
          return String(v.transcription || storedAud?.transcription || '').trim();
        })
        .filter(Boolean)
        .join(' ');

      const directPhotos = Array.isArray(ans.photos) ? ans.photos.filter(Boolean) : [];
      const linkedByQuestion = (photosByQuestion.get(ans.questionId) || []).filter(
        (p) => p && !directPhotos.some((dp) => dp.id === p.id)
      );
      const combinedAnsPhotos = [...directPhotos, ...linkedByQuestion];

      const photoAttachments: MiEsenciaTestimonyPhotoAttachment[] = [];
      const photoCaptions: string[] = [];

      for (const ph of combinedAnsPhotos) {
        const storedPh = (ph?.id ? photoMap.get(ph.id) : undefined) || (ph as any);
        let resolvedDataUrl = params.includePhotoData
          ? String(storedPh?.dataUrl || (ph as any)?.dataUrl || '').trim()
          : '';
        if (params.includePhotoData && !resolvedDataUrl && storedPh?.id) {
          const diskBuf = storage.getPhotoBuffer(storedPh.id);
          if (diskBuf && diskBuf.buffer.length > 0) {
            resolvedDataUrl = `data:${diskBuf.mimeType || 'image/jpeg'};base64,${diskBuf.buffer.toString('base64')}`;
          }
        }
        const caption = String(storedPh?.caption || ph?.caption || '').trim();
        if (caption) {
          photoCaptions.push(caption);
        }
        const attachment: MiEsenciaTestimonyPhotoAttachment = {
          id: storedPh?.id || ph?.id,
          questionId: ans.questionId,
          fileName: storedPh?.fileName || ph?.fileName,
          mimeType: storedPh?.mimeType || ph?.mimeType || 'image/jpeg',
          caption: caption || 'Sin descripción registrada',
          dataUrl: resolvedDataUrl || undefined,
          imageUrl: storedPh?.imageUrl || ph?.imageUrl,
          participantName: storedPh?.participantName || ans.participantName,
        };
        photoAttachments.push(attachment);
        if (attachment.id) {
          collectedPhotosMap.set(attachment.id, attachment);
        }
      }

      const cleanAnswerLiteral = String(ans.answerText || '').trim();
      // Si el testimonio tiene texto escrito, transcripción de voz o fotografías adjuntas, incluirlo siempre
      if (!cleanAnswerLiteral && !audioTranscriptions && photoAttachments.length === 0) {
        continue;
      }

      const effectiveAnswerLiteral =
        cleanAnswerLiteral ||
        audioTranscriptions ||
        (photoCaptions.length > 0
          ? `[Testimonio fotográfico: ${photoCaptions.join(' • ')}]`
          : '[Testimonio registrado]');

      const words = `${qLiteral} ${effectiveAnswerLiteral} ${audioTranscriptions} ${photoCaptions.join(' ')}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3);

      blocks.push({
        testimonyId: `test_${crypto.randomBytes(5).toString('hex')}`,
        personId: params.personId,
        avatarId: params.avatarId,
        sourcePdfId: params.pdfId,
        sourceAnswerId: ans.id,
        sourceQuestionId: ans.questionId,
        isAdditionalMemory: Boolean(ans.isAdditionalMemory),
        isFollowUp: Boolean(ans.isFollowUp),
        participantName: ans.participantName,
        lifeStage: stage,
        topic: qObj?.topic || (ans.isAdditionalMemory ? 'informacion_adicional' : stage),
        questionLiteral: qLiteral,
        answerLiteral: effectiveAnswerLiteral,
        audioTranscriptionLiteral: audioTranscriptions || undefined,
        photoCaptionsLiteral: photoCaptions.length > 0 ? photoCaptions : undefined,
        photoAttachments: photoAttachments.length > 0 ? photoAttachments : undefined,
        entitiesMentioned: [],
        keywords: Array.from(new Set(words)).slice(0, 35),
        recordedAt: ans.updatedAt || ans.createdAt || nowIso,
        immutable: true,
      });
    }

    const photosWithDataUrl = Array.from(collectedPhotosMap.values());

    const rawMarkdown = blocks
      .map((t, i) => {
        const typeNote = t.isAdditionalMemory
          ? ' [Información adicional incorporada posteriormente]'
          : t.isFollowUp
          ? ' [Profundización]'
          : '';
        const partNote = t.participantName ? `\n**Participante:** ${t.participantName}` : '';
        const audioNote = t.audioTranscriptionLiteral
          ? `\n\nTranscripción de voz literal: ${t.audioTranscriptionLiteral}`
          : '';
        const photoNote =
          t.photoAttachments && t.photoAttachments.length > 0
            ? `\n\nFotografías asociadas (${t.photoAttachments.length}):\n` +
              t.photoAttachments
                .map(
                  (p, pIdx) =>
                    `- Fotografía #${pIdx + 1}: Descripción: «${p.caption || 'Sin descripción'}»`
                )
                .join('\n')
            : t.photoCaptionsLiteral && t.photoCaptionsLiteral.length > 0
            ? `\n\nFotografías asociadas:\n` +
              t.photoCaptionsLiteral
                .map((cap, pIdx) => `- Fotografía #${pIdx + 1}: Descripción: «${cap}»`)
                .join('\n')
            : '';
        return `### ${i + 1}. ${t.questionLiteral}${typeNote}${partNote}\n**Respuesta:**\n${t.answerLiteral}${audioNote}${photoNote}`;
      })
      .join('\n\n');

    return {
      blocks,
      photosWithDataUrl,
      rawMarkdown,
    };
  }

  /**
   * Garantiza que cada Perfil Biográfico (Entidad A) tenga su propio archivo PDF Compilado
   * asignado (sourcePdfId -> MiEsenciaArchivedCompilationPdf) y que sus testimonios de Nivel A
   * correspondan estrictamente a las respuestas reales de su entrevista o PDF subido.
   */
  public syncPersonWithAssignedPdfAndInterview(personId: string, skipDiskSave = false): boolean {
    const person = this.persons.get(personId);
    if (!person) return false;

    const nowIso = new Date().toISOString();
    const interview =
      person.sourceInterviewId &&
      person.sourceInterviewId !== 'manual' &&
      person.sourceInterviewId !== 'uploaded_pdf'
        ? storage.getInterviewById(person.sourceInterviewId)
        : undefined;
    const participants = interview ? storage.getParticipantsForInterview(interview.id) : [];

    // Verificar si otro perfil distinto comparte el mismo sourcePdfId; cada perfil debe tener su propio PDF
    const otherPersonSharingPdf = Array.from(this.persons.values()).find(
      (p) => p.personId !== person.personId && p.sourcePdfId === person.sourcePdfId
    );
    const dedicatedPdfId =
      person.sourcePdfId && !otherPersonSharingPdf
        ? person.sourcePdfId
        : `comp_pdf_${person.personId.replace(/^person_/, '')}`;

    let personTestimonies = Array.from(this.testimonies.values()).filter(
      (t) => t.personId === person.personId
    );

    // V5.4.2 — Fast path: same interview content as the last sync → nothing to rebuild.
    const sourceFingerprint = interview
      ? this.computeInterviewSourceFingerprint(interview.id, person.sourceParticipantId, participants.length)
      : '';
    const unchangedSource =
      Boolean(sourceFingerprint) &&
      this.personSourceFingerprints.get(person.personId) === sourceFingerprint &&
      personTestimonies.length > 0 &&
      person.sourcePdfId === dedicatedPdfId &&
      this.compilationPdfs.has(dedicatedPdfId);

    const hasOnlyGenericFallback =
      personTestimonies.length === 1 &&
      personTestimonies[0].answerLiteral.includes(
        'Quiero que mi familia siempre recuerde cuánto los amo, el valor del trabajo honesto'
      );

    let builtFromInterview:
      | {
          blocks: MiEsenciaTestimonyBlock[];
          photosWithDataUrl: MiEsenciaTestimonyPhotoAttachment[];
          rawMarkdown: string;
        }
      | undefined;

    if (interview && !unchangedSource) {
      builtFromInterview = this.buildTestimonyBlocksFromInterviewData({
        interviewId: interview.id,
        personId: person.personId,
        avatarId: person.avatarId,
        pdfId: dedicatedPdfId,
        participantIdFilter: person.sourceParticipantId,
        multipleParticipants: participants.length > 1,
      });
    }

    const existingAnswersDigest = personTestimonies
      .map(
        (t) =>
          `${t.sourceAnswerId || ''}:${t.questionLiteral}:${t.answerLiteral}:${t.audioTranscriptionLiteral || ''}:${(t.photoCaptionsLiteral || []).join('|')}`
      )
      .join('||');
    const latestInterviewDigest = builtFromInterview
      ? builtFromInterview.blocks
          .map(
            (t) =>
              `${t.sourceAnswerId || ''}:${t.questionLiteral}:${t.answerLiteral}:${t.audioTranscriptionLiteral || ''}:${(t.photoCaptionsLiteral || []).join('|')}`
          )
          .join('||')
      : '';

    const shouldRebuildFromInterview = Boolean(
      builtFromInterview &&
        builtFromInterview.blocks.length > 0 &&
        (personTestimonies.length === 0 ||
          hasOnlyGenericFallback ||
          existingAnswersDigest !== latestInterviewDigest)
    );

    let changed = false;

    if (shouldRebuildFromInterview && builtFromInterview) {
      for (const [tid, t] of this.testimonies.entries()) {
        if (t.personId === person.personId) {
          this.testimonies.delete(tid);
        }
      }
      for (const [rid, r] of this.relations.entries()) {
        if (r.personId === person.personId) {
          this.relations.delete(rid);
        }
      }

      for (const block of builtFromInterview.blocks) {
        this.testimonies.set(block.testimonyId, block);
      }

      personTestimonies = builtFromInterview.blocks;
      const newRelations = extractRelatedPersonsFromTestimonies(
        person.avatarId,
        person.personId,
        personTestimonies
      );
      for (const rel of newRelations) {
        this.relations.set(rel.relatedPersonId, rel);
      }

      person.linguisticProfile = extractLinguisticProfileFromTestimonies(personTestimonies);
      person.milestones = personTestimonies
        .slice(0, 6)
        .map((t) => `${t.lifeStage.toUpperCase()}: ${t.answerLiteral.slice(0, 110)}`);
      person.biographySummary = `Perfil testimonial fidedigno de ${person.fullName} construido a partir de ${personTestimonies.length} respuestas literales de su archivo PDF compilado.`;
      changed = true;
    }

    // Asegurar que todos los testimonios de este perfil apunten a su sourcePdfId exclusivo
    for (const t of personTestimonies) {
      if (t.sourcePdfId !== dedicatedPdfId) {
        t.sourcePdfId = dedicatedPdfId;
        this.testimonies.set(t.testimonyId, t);
        changed = true;
      }
    }

    if (person.sourcePdfId !== dedicatedPdfId) {
      person.sourcePdfId = dedicatedPdfId;
      changed = true;
    }

    // Verificar si el PDF compilado de este perfil existe y tiene su contenido binario, textual y fotográfico al día
    const existingPdf = this.compilationPdfs.get(dedicatedPdfId);
    const photosCount = builtFromInterview
      ? builtFromInterview.photosWithDataUrl.length
      : existingPdf?.totalPhotosReferenced || 0;
    // V5.4.2: the routine sync only refreshes the compiled TEXT (what the avatar reads). The PDF
    // file itself is generated when someone downloads it (getCompilationPdfById regenerates an empty
    // binary), instead of rebuilding a long PDF with every photo on each login or chat message.
    const needsPdfGeneration =
      !unchangedSource &&
      (!existingPdf ||
        changed ||
        existingPdf.totalLiteralAnswers !== personTestimonies.length ||
        existingPdf.totalPhotosReferenced !== photosCount);

    if (needsPdfGeneration && personTestimonies.length > 0) {
      const rawMarkdown =
        builtFromInterview && builtFromInterview.rawMarkdown
          ? builtFromInterview.rawMarkdown
          : personTestimonies
              .map(
                (t, i) =>
                  `### ${i + 1}. ${t.questionLiteral}\n**Respuesta:**\n${t.answerLiteral}${
                    t.audioTranscriptionLiteral
                      ? `\n\nTranscripción de voz literal: ${t.audioTranscriptionLiteral}`
                      : ''
                  }`
              )
              .join('\n\n');

      // The binary is produced on demand (download), from fresh data with the photos' images.
      const generated = { sha256Hash: '', pdfBase64: '' };

      const archivedPdf: MiEsenciaArchivedCompilationPdf = {
        pdfId: dedicatedPdfId,
        avatarId: person.avatarId,
        sourceInterviewId: person.sourceInterviewId || 'manual',
        fileName:
          existingPdf?.fileName ||
          `Compilado_Testimonial_Fidedigno_${person.fullName.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`,
        origin: existingPdf?.origin || 'auto_generated_from_interview',
        sha256Hash: generated.sha256Hash,
        totalQuestions: personTestimonies.length,
        totalLiteralAnswers: personTestimonies.length,
        totalAudiosTranscribed: personTestimonies.filter((t) => Boolean(t.audioTranscriptionLiteral)).length,
        totalPhotosReferenced: photosCount,
        rawTextContent: rawMarkdown,
        pdfBase64: generated.pdfBase64,
        createdAt: existingPdf?.createdAt || nowIso,
        createdBy: existingPdf?.createdBy || 'system',
      };

      this.compilationPdfs.set(dedicatedPdfId, archivedPdf);
      changed = true;
    }

    // Asegurar que cada perfil disponga de aiConfig retrocompatible y actualice el modelo OpenAI legado gpt-4o a gpt-6
    // V5.6.3: "gpt-6" is a family name, not an API model — it becomes gpt-6-luna (administrator's
    // decision); "gpt-4o" and empty values keep being upgraded, now to gpt-6-luna as well.
    if (
      this.config.defaultOpenAiModel === 'gpt-4o' ||
      this.config.defaultOpenAiModel === 'gpt-6' ||
      !this.config.defaultOpenAiModel
    ) {
      this.config.defaultOpenAiModel = OPENAI_DEFAULT_MODEL;
    }
    if (!person.aiConfig) {
      person.aiConfig = buildDefaultAvatarAiConfig({
        mode: 'modo_existente',
        defaultGeminiModel: this.config.defaultGeminiModel || MI_ESENCIA_DEFAULT_GEMINI_MODEL,
        defaultOpenAiModel: this.config.defaultOpenAiModel || OPENAI_DEFAULT_MODEL,
      });
      changed = true;
    } else if (
      !person.aiConfig.openaiModel ||
      person.aiConfig.openaiModel === 'gpt-4o' ||
      person.aiConfig.openaiModel === 'gpt-6'
    ) {
      person.aiConfig.openaiModel = OPENAI_DEFAULT_MODEL;
      changed = true;
    }

    if (sourceFingerprint && personTestimonies.length > 0) {
      this.personSourceFingerprints.set(person.personId, sourceFingerprint);
    }

    if (changed) {
      person.updatedAt = nowIso;
      this.persons.set(person.personId, person);
      if (!skipDiskSave) {
        this.saveToDisk();
      }
    }
    return changed;
  }

  /**
   * V5.4.2 — Cheap fingerprint of what a person's testimonies are built from: every answer (id,
   * last update, text length, photos and recordings) plus the participant filter.
   */
  private computeInterviewSourceFingerprint(
    interviewId: string,
    participantIdFilter: string | undefined,
    participantsCount: number
  ): string {
    const hash = crypto.createHash('sha256');
    hash.update(`${interviewId}|${participantIdFilter || ''}|${participantsCount}`);
    for (const a of storage.getAnswersForInterview(interviewId)) {
      hash.update(
        `|${a.id}:${a.updatedAt || a.createdAt}:${(a.answerText || '').length}:${a.notRecalled ? 1 : 0}:` +
          `${(a.photos || []).map((p) => `${p?.id}~${(p?.caption || '').length}`).join(',')}:` +
          `${(a.audioRecordings || (a.audio ? [a.audio] : [])).map((v) => `${v?.id}~${(v?.transcription || '').length}`).join(',')}`
      );
    }
    hash.update(`|photos:${storage.getPhotosForInterview(interviewId, false).length}`);
    return hash.digest('hex');
  }

  public syncAllPersonsAndPdfs(): void {
    this.applyDeletedRegistryFilters();

    let anyPersonChanged = false;
    for (const personId of Array.from(this.persons.keys())) {
      if (this.syncPersonWithAssignedPdfAndInterview(personId, true)) {
        anyPersonChanged = true;
      }
    }

    // Eliminar PDFs huérfanos que no estén asociados a ningún perfil activo
    const activeAvatarIds = new Set(Array.from(this.persons.values()).map((p) => p.avatarId));
    const activePdfIds = new Set(
      Array.from(this.persons.values())
        .map((p) => p.sourcePdfId)
        .filter((id): id is string => Boolean(id))
    );
    for (const [pdfId, pdf] of Array.from(this.compilationPdfs.entries())) {
      const isDirectInterviewPdf =
        pdf.avatarId === 'interview_compilation' ||
        Boolean(pdf.sourceInterviewId && storage.getInterviewById(pdf.sourceInterviewId));
      if (
        this.deletedRegistry.pdfs.has(pdfId) ||
        (!isDirectInterviewPdf &&
          !activePdfIds.has(pdfId) &&
          !activeAvatarIds.has(pdf.avatarId))
      ) {
        this.compilationPdfs.delete(pdfId);
      }
    }

    // Normalizar aviso de transparencia a YouForever y actualizar códigos familiares al formato mixto YF-XXXXX (8 caracteres)
    let credsChanged = false;
    if (this.config.transparencyNoticeText && this.config.transparencyNoticeText.includes('ForeverYou')) {
      this.config.transparencyNoticeText = this.config.transparencyNoticeText.replace(/ForeverYou/g, 'YouForever');
      credsChanged = true;
    }

    const isValidMixedYf5 = (code: string): boolean => {
      const m = /^YF-([A-Z0-9]{5})$/.exec((code || '').trim().toUpperCase());
      if (!m) return false;
      const suffix = m[1];
      return /[A-Z]/.test(suffix) && /[0-9]/.test(suffix);
    };

    const usedCodes = new Set<string>();
    for (const c of this.credentials.values()) {
      if (c.personalCodePlain && isValidMixedYf5(c.personalCodePlain)) {
        usedCodes.add(c.personalCodePlain.toUpperCase());
      }
    }

    for (const [credId, cred] of this.credentials.entries()) {
      // Si el código no tiene aún el formato mixto alfanumérico YF-XXXXX (5 caracteres con letras y números),
      // actualizarlo a YF-XXXXX conservando los códigos previos en legacyCodesPlain para compatibilidad total
      if (cred.personalCodePlain && !isValidMixedYf5(cred.personalCodePlain)) {
        const prevCodes: string[] = Array.isArray((cred as any).legacyCodesPlain)
          ? [...(cred as any).legacyCodesPlain]
          : [];
        if ((cred as any).legacyCodePlain && !prevCodes.includes((cred as any).legacyCodePlain)) {
          prevCodes.push((cred as any).legacyCodePlain);
        }
        if (!prevCodes.includes(cred.personalCodePlain)) {
          prevCodes.push(cred.personalCodePlain);
        }
        (cred as any).legacyCodesPlain = prevCodes;
        if (!(cred as any).legacyCodePlain) {
          (cred as any).legacyCodePlain = cred.personalCodePlain;
        }

        const seedBase = prevCodes[0] || cred.personalCodePlain;
        let candidate = deriveShortMiEsenciaAccessCode(`${credId}:${seedBase}`);
        let attempt = 1;
        while (usedCodes.has(candidate.toUpperCase())) {
          candidate = deriveShortMiEsenciaAccessCode(`${credId}:${seedBase}:${attempt}`);
          attempt++;
        }
        usedCodes.add(candidate.toUpperCase());
        cred.personalCodePlain = candidate;
        cred.codePrefix = candidate;
        cred.codeHash = computeMiEsenciaCodeHash(candidate);
        credsChanged = true;
      }

      const expectedPath = `/miesencia?code=${encodeURIComponent(cred.personalCodePlain)}`;
      if (cred.privateLinkPath !== expectedPath) {
        cred.privateLinkPath = expectedPath;
        credsChanged = true;
      }
      this.credentials.set(credId, cred);
    }

    if (credsChanged || anyPersonChanged) {
      this.saveToDisk();
    }
  }

  public async syncFromFirestore(force = false): Promise<void> {
    const lastSyncMs = this.lastFirestoreSyncAt
      ? new Date(this.lastFirestoreSyncAt).getTime()
      : 0;
    const ageMs = Date.now() - lastSyncMs;
    if (!force && lastSyncMs > 0 && ageMs < 60_000) {
      return;
    }

    if (this.activeSyncPromise) {
      await this.activeSyncPromise;
      return;
    }

    this.activeSyncPromise = (async () => {
      try {
        const firestorePromise = Promise.allSettled([
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'mi_esencia_config'), 'miEsencia'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'mi_esencia_plans'), 'miEsencia'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'mi_esencia_subscriptions'), 'miEsencia'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'mi_esencia_persons'), 'miEsencia'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'mi_esencia_testimonies'), 'miEsencia'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'mi_esencia_relations'), 'miEsencia'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'mi_esencia_interlocutors'), 'miEsencia'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'mi_esencia_credentials'), 'miEsencia'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'mi_esencia_memories'), 'miEsencia'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'mi_esencia_contradictions'), 'miEsencia'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'mi_esencia_prompt_library'), 'miEsencia'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'mi_esencia_prompt_versions'), 'miEsencia'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'mi_esencia_pdfs'), 'miEsencia'),
          firestoreTelemetry.trackedGetDocs(serverDb, collection(serverDb, 'mi_esencia_conversations'), 'miEsencia'),
        ]);

        const timeoutPromise = new Promise<null>((resolve) => {
          const t = setTimeout(() => {
            console.warn('[MiEsenciaStore] Firestore fetch took > 3s; operating reliably with disk snapshot.');
            resolve(null);
          }, 3000);
          if (t && typeof t.unref === 'function') {
            t.unref();
          }
        });

        const raceResult = await Promise.race([firestorePromise, timeoutPromise]);
        if (!raceResult) {
          return;
        }

        const unwrap = (idx: number) => {
          const r = raceResult[idx];
          return r && r.status === 'fulfilled' ? r.value : null;
        };

        const configSnap = unwrap(0);
        const plansSnap = unwrap(1);
        const subsSnap = unwrap(2);
        const personsSnap = unwrap(3);
        const testSnap = unwrap(4);
        const relSnap = unwrap(5);
        const interSnap = unwrap(6);
        const credSnap = unwrap(7);
        const memSnap = unwrap(8);
        const contraSnap = unwrap(9);
        const promptLibSnap = unwrap(10);
        const promptVerSnap = unwrap(11);
        const pdfsSnap = unwrap(12);
        const convSnap = unwrap(13);

        if (configSnap) {
          configSnap.forEach((d) => {
            if (d.id === 'global') {
              this.config = this.migrateConfigDefaults({ ...DEFAULT_MI_ESENCIA_CONFIG, ...(d.data() as any) });
            } else if (d.id === 'deleted_registry') {
              const reg = d.data() as any;
              if (Array.isArray(reg?.persons)) {
                reg.persons.forEach((id: string) => this.deletedRegistry.persons.add(id));
              }
              if (Array.isArray(reg?.subscriptions)) {
                reg.subscriptions.forEach((id: string) => this.deletedRegistry.subscriptions.add(id));
              }
              if (Array.isArray(reg?.pdfs)) {
                reg.pdfs.forEach((id: string) => this.deletedRegistry.pdfs.add(id));
              }
              if (Array.isArray(reg?.credentials)) {
                reg.credentials.forEach((id: string) => this.deletedRegistry.credentials.add(id));
              }
            }
          });
        }

        if (plansSnap) {
          plansSnap.forEach((d) => {
            const val = d.data() as unknown as MiEsenciaPlanRecord;
            if (val?.planId) this.plans.set(val.planId, val);
          });
        }

        if (subsSnap) {
          subsSnap.forEach((d) => {
            const val = d.data() as unknown as MiEsenciaSubscriptionRecord;
            if (val?.avatarId && !this.deletedRegistry.subscriptions.has(val.avatarId)) {
              this.subscriptions.set(val.avatarId, val);
            }
          });
        }

        if (personsSnap) {
          personsSnap.forEach((d) => {
            const val = d.data() as unknown as MiEsenciaPersonProfile;
            if (
              val?.personId &&
              !this.deletedRegistry.persons.has(val.personId) &&
              !this.deletedRegistry.subscriptions.has(val.avatarId)
            ) {
              this.persons.set(val.personId, val);
            }
          });
        }

        if (pdfsSnap) {
          pdfsSnap.forEach((d) => {
            const val = d.data() as unknown as MiEsenciaArchivedCompilationPdf;
            if (
              val?.pdfId &&
              !this.deletedRegistry.pdfs.has(val.pdfId) &&
              !this.deletedRegistry.subscriptions.has(val.avatarId)
            ) {
              const existingInMem = this.compilationPdfs.get(val.pdfId);
              this.compilationPdfs.set(val.pdfId, {
                ...val,
                pdfBase64: val.pdfBase64 || existingInMem?.pdfBase64 || '',
              });
            }
          });
        }

        if (testSnap) {
          testSnap.forEach((d) => {
            const val = d.data() as unknown as MiEsenciaTestimonyBlock;
            if (
              val?.testimonyId &&
              !this.deletedRegistry.persons.has(val.personId) &&
              !this.deletedRegistry.subscriptions.has(val.avatarId)
            ) {
              this.testimonies.set(val.testimonyId, val);
            }
          });
        }

        if (relSnap) {
          relSnap.forEach((d) => {
            const val = d.data() as unknown as MiEsenciaRelatedPerson;
            if (
              val?.relatedPersonId &&
              !this.deletedRegistry.persons.has(val.personId) &&
              !this.deletedRegistry.subscriptions.has(val.avatarId)
            ) {
              this.relations.set(val.relatedPersonId, val);
            }
          });
        }

        if (interSnap) {
          interSnap.forEach((d) => {
            const val = d.data() as unknown as MiEsenciaInterlocutor;
            if (val?.interlocutorId && !this.deletedRegistry.subscriptions.has(val.avatarId)) {
              this.interlocutors.set(val.interlocutorId, val);
            }
          });
        }

        if (credSnap) {
          credSnap.forEach((d) => {
            const val = d.data() as unknown as MiEsenciaAccessCredential;
            if (
              val?.accessCredentialId &&
              !this.deletedRegistry.credentials.has(val.accessCredentialId) &&
              !this.deletedRegistry.subscriptions.has(val.avatarId)
            ) {
              this.credentials.set(val.accessCredentialId, val);
            }
          });
        }

        if (memSnap) {
          memSnap.forEach((d) => {
            const val = d.data() as unknown as MiEsenciaMemoryRecord;
            if (val?.memoryId && !this.deletedRegistry.persons.has(val.personId)) {
              this.memories.set(val.memoryId, val);
            }
          });
        }

        if (contraSnap) {
          contraSnap.forEach((d) => {
            const val = d.data() as unknown as MiEsenciaContradictionRecord;
            if (val?.contradictionId && !this.deletedRegistry.persons.has(val.personId)) {
              this.contradictions.set(val.contradictionId, val);
            }
          });
        }

        if (promptLibSnap) {
          promptLibSnap.forEach((d) => {
            const val = d.data() as unknown as MiEsenciaLibraryPromptRecord;
            if (val?.promptId) this.promptLibrary.set(val.promptId, val);
          });
        }

        if (promptVerSnap) {
          promptVerSnap.forEach((d) => {
            const val = d.data() as unknown as MiEsenciaPromptVersionRecord;
            if (val?.versionId) this.avatarPromptVersions.set(val.versionId, val);
          });
        }

        if (convSnap) {
          convSnap.forEach((d) => {
            const val = d.data() as unknown as MiEsenciaConversationSession;
            if (
              val?.sessionId &&
              !this.deletedRegistry.persons.has(val.personId) &&
              !this.deletedRegistry.subscriptions.has(val.avatarId)
            ) {
              this.conversations.set(val.sessionId, val);
            }
          });
        }

        if (raceResult.some((r) => r.status === 'fulfilled')) {
          this.lastFirestoreSyncAt = new Date().toISOString();
          this.saveToDisk();
        }
      } catch {
        // Continuar con estado en disco y memoria
      } finally {
        this.activeSyncPromise = null;
      }
      this.applyDeletedRegistryFilters();
      this.seedDefaultPromptLibraryIfNeeded();
      this.syncAllPersonsAndPdfs();
    })();

    await this.activeSyncPromise;
  }

  public async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await storage.ensureInitialized();

    const lastSyncMs = this.lastFirestoreSyncAt
      ? new Date(this.lastFirestoreSyncAt).getTime()
      : 0;
    const hasWarmDiskSnapshot =
      this.persons.size > 0 || this.compilationPdfs.size > 0 || this.credentials.size > 0;
    const isFreshSnapshot = lastSyncMs > 0 && Date.now() - lastSyncMs < 5 * 60_000;

    if (hasWarmDiskSnapshot) {
      const estimatedSaved =
        this.persons.size +
        this.testimonies.size +
        this.compilationPdfs.size +
        this.credentials.size +
        this.memories.size +
        15;
      firestoreTelemetry.recordReadsSaved(estimatedSaved);
      this.applyDeletedRegistryFilters();
      this.seedDefaultPromptLibraryIfNeeded();
      this.syncAllPersonsAndPdfs();
      if (!isFreshSnapshot) {
        void this.syncFromFirestore(true).catch(() => {
          // Sincronización en segundo plano sin bloquear el acceso al portal
        });
      }
      return;
    }

    await this.syncFromFirestore(true);
  }

  // ============================================================================
  // CONFIG & PLANS
  // ============================================================================

  public getConfig(): MiEsenciaGlobalConfig {
    return { ...this.config };
  }

  /**
   * V5.5.1: the default Gemini model becomes gemini-3.8-flash. A saved configuration that still
   * holds the previous default (gemini-3-flash-preview, or none) is moved once; the marker keeps
   * an explicit later choice of the administrator from being changed again.
   */
  private migrateConfigDefaults(config: MiEsenciaGlobalConfig): MiEsenciaGlobalConfig {
    const marked = config as MiEsenciaGlobalConfig & { geminiDefaultModelV551Applied?: boolean };
    if (marked.geminiDefaultModelV551Applied) return config;
    const current = String(config.defaultGeminiModel || '').trim();
    return {
      ...config,
      defaultGeminiModel:
        !current || current === 'gemini-3-flash-preview' ? MI_ESENCIA_DEFAULT_GEMINI_MODEL : current,
      geminiDefaultModelV551Applied: true,
    } as MiEsenciaGlobalConfig;
  }

  public async updateConfig(
    partial: Partial<MiEsenciaGlobalConfig>,
    adminEmail: string
  ): Promise<MiEsenciaGlobalConfig> {
    this.config = {
      ...this.config,
      ...partial,
      updatedAt: new Date().toISOString(),
      updatedBy: adminEmail,
    };
    await this.persistDoc('mi_esencia_config', 'global', this.config);
    return this.getConfig();
  }

  public getPlans(): MiEsenciaPlanRecord[] {
    return Array.from(this.plans.values());
  }

  public async savePlan(planInput: Partial<MiEsenciaPlanRecord> & { name: string }): Promise<MiEsenciaPlanRecord> {
    const planId = planInput.planId || `plan_${crypto.randomBytes(4).toString('hex')}`;
    const existing = this.plans.get(planId);
    const record: MiEsenciaPlanRecord = {
      planId,
      code: planInput.code || existing?.code || 'personalizado',
      name: planInput.name.trim(),
      description: planInput.description ?? existing?.description ?? '',
      priceMxn: Number(planInput.priceMxn ?? existing?.priceMxn ?? 0),
      currency: planInput.currency || existing?.currency || 'MXN',
      defaultDurationUnit: planInput.defaultDurationUnit || existing?.defaultDurationUnit || 'months',
      defaultDurationValue: Number(planInput.defaultDurationValue ?? existing?.defaultDurationValue ?? 1),
      gracePeriodDays: Number(planInput.gracePeriodDays ?? existing?.gracePeriodDays ?? 5),
      maxAuthorizedInterlocutors: Number(
        planInput.maxAuthorizedInterlocutors ?? existing?.maxAuthorizedInterlocutors ?? 10
      ),
      monthlyMessageQuotaPerAvatar: Number(
        planInput.monthlyMessageQuotaPerAvatar ?? existing?.monthlyMessageQuotaPerAvatar ?? 1000
      ),
      dailyMessageQuotaPerInterlocutor: Number(
        planInput.dailyMessageQuotaPerInterlocutor ?? existing?.dailyMessageQuotaPerInterlocutor ?? 50
      ),
      includesSharedMemories: planInput.includesSharedMemories ?? existing?.includesSharedMemories ?? true,
      includesPrivateMemories: planInput.includesPrivateMemories ?? existing?.includesPrivateMemories ?? true,
      includesSnapshots: planInput.includesSnapshots ?? existing?.includesSnapshots ?? true,
      isActive: planInput.isActive ?? existing?.isActive ?? true,
      updatedAt: new Date().toISOString(),
    };
    this.plans.set(planId, record);
    await this.persistDoc('mi_esencia_plans', planId, record);
    return record;
  }

  // ============================================================================
  // AVATAR CREATION FROM EXISTING INTERVIEW OR UPLOADED COMPILATION PDF
  // ============================================================================

  /**
   * Crea o actualiza un Avatar Familiar en Mi Esencia a partir de una entrevista existente
   * o de un PDF del Compilado Testimonial Fidedigno subido manualmente.
   * - Si aún no existe el PDF del Compilado Testimonial Fidedigno para esa entrevista,
   *   lo genera y archiva automáticamente bajo demanda.
   * - Si la entrevista es en modalidad de pareja, crea dos perfiles biográficos separados (person_id)
   *   bajo una sola suscripción familiar (avatar_id).
   */
  public async createOrSyncAvatarFromInterview(params: {
    interviewId?: string;
    customAvatarName?: string;
    isCoupleOverride?: boolean;
    uploadedPdfFileName?: string;
    uploadedPdfBase64?: string;
    uploadedCompilationText?: string;
    planId?: string;
    spontaneityLevel?: MiEsenciaSpontaneityLevel;
    initialFamilyMembers?: Array<{ fullName: string; relationshipToPerson: string; email?: string; phone?: string }>;
    initialConversationConfigMode?: MiEsenciaConversationConfigMode;
    initialPrimaryProvider?: MiEsenciaAiProvider;
    initialGeminiModel?: string;
    initialOpenAiModel?: string;
    initialGeminiLibraryPromptId?: string;
    initialOpenAiLibraryPromptId?: string;
    initialGeminiPromptContent?: string;
    initialOpenAiPromptContent?: string;
    adminEmail: string;
  }): Promise<{
    subscription: MiEsenciaSubscriptionRecord;
    persons: MiEsenciaPersonProfile[];
    archivedPdf: MiEsenciaArchivedCompilationPdf;
    testimoniesCount: number;
    relations: MiEsenciaRelatedPerson[];
    credentials: MiEsenciaAccessCredential[];
  }> {
    const nowIso = new Date().toISOString();
    const interview = params.interviewId ? storage.getInterviewById(params.interviewId) : undefined;
    const participants = params.interviewId
      ? storage.getParticipantsForInterview(params.interviewId)
      : [];
    const answers = params.interviewId
      ? storage.getAnswersForInterview(params.interviewId)
      : [];
    const questions = storage.getQuestions();
    const photos = params.interviewId ? storage.getPhotosForInterview(params.interviewId) : [];

    const audios = params.interviewId ? storage.getAudiosForInterview(params.interviewId) : [];

    // Reutilizar avatarId si ya existe para esta entrevista
    let existingSub = Array.from(this.subscriptions.values()).find(
      (s) => params.interviewId && s.sourceInterviewId === params.interviewId
    );
    const avatarId = existingSub?.avatarId || `avatar_${crypto.randomBytes(5).toString('hex')}`;

    const isCouple =
      params.isCoupleOverride ??
      Boolean(interview?.storyMode === 'compartida' || participants.length >= 2);

    const avatarDisplayName =
      params.customAvatarName?.trim() ||
      (participants.length > 0
        ? participants.map((p) => p.name).join(' & ')
        : interview?.title || 'Legado Familiar Mi Esencia');

    const extractedPdfText =
      params.uploadedCompilationText?.trim() ||
      (params.uploadedPdfBase64 ? extractTextFromUploadedPdfBase64(params.uploadedPdfBase64) : '');

    // 1. Determinar o crear los perfiles de Persona (1 en individual, 2 separados en pareja)
    //    Cada perfil biográfico recibe su propio archivo PDF Compilado (sourcePdfId exclusivo).
    const createdPersons: MiEsenciaPersonProfile[] = [];
    const createdTestimonies: MiEsenciaTestimonyBlock[] = [];
    const createdRelations: MiEsenciaRelatedPerson[] = [];
    const createdPdfs: MiEsenciaArchivedCompilationPdf[] = [];

    const spontaneity: MiEsenciaSpontaneityLevel =
      params.spontaneityLevel || this.config.defaultSpontaneityLevel || 'moderado';

    const questionMap = new Map(questions.map((q) => [q.id, q]));

    if (participants.length > 0 && answers.length > 0 && !extractedPdfText) {
      // Construir perfiles desde los participantes reales de la entrevista
      const targetParticipants =
        isCouple && participants.length >= 2 ? participants.slice(0, 2) : [participants[0]];

      for (let idx = 0; idx < targetParticipants.length; idx++) {
        const part = targetParticipants[idx];
        const existingPerson = Array.from(this.persons.values()).find(
          (p) => p.avatarId === avatarId && p.sourceParticipantId === part.id
        );
        const personId =
          existingPerson?.personId || `person_${crypto.randomBytes(5).toString('hex')}`;
        const personPdfId =
          existingPerson?.sourcePdfId || `comp_pdf_${crypto.randomBytes(5).toString('hex')}`;

        // Filtrar las respuestas que pertenecen estrictamente a este integrante (o todas si es individual)
        const personAnswers =
          targetParticipants.length > 1
            ? answers.filter((a) => a.participantId === part.id || !a.participantId)
            : answers;

        const personTestimonies: MiEsenciaTestimonyBlock[] = [];
        for (const ans of personAnswers) {
          const qObj = questionMap.get(ans.questionId);
          const qLiteral =
            ans.questionText || qObj?.text || 'Pregunta biográfica de entrevista';
          const stage = (qObj?.lifeStage || 'legado_general') as MiEsenciaTestimonyBlock['lifeStage'];
          const voiceList = ans.audioRecordings || (ans.audio ? [ans.audio] : []);
          const audioTranscriptions = voiceList
            .map((v) => v.transcription || '')
            .filter(Boolean)
            .join(' ');
          const photoCaptions = (ans.photos || [])
            .map((ph) => ph.caption || '')
            .filter(Boolean);

          const words = `${qLiteral} ${ans.answerText} ${audioTranscriptions}`
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .split(/[^a-z0-9]+/)
            .filter((w) => w.length >= 3);

          const block: MiEsenciaTestimonyBlock = {
            testimonyId: `test_${crypto.randomBytes(5).toString('hex')}`,
            personId,
            avatarId,
            sourcePdfId: personPdfId,
            sourceAnswerId: ans.id,
            lifeStage: stage,
            topic: qObj?.topic || stage,
            questionLiteral: qLiteral,
            answerLiteral: ans.answerText,
            audioTranscriptionLiteral: audioTranscriptions || undefined,
            photoCaptionsLiteral: photoCaptions.length > 0 ? photoCaptions : undefined,
            // V5.4.0: keep which real photos belong to this memory (metadata only; the image is
            // read from storage when the chat shows it).
            ...(photoAttachmentsFromAnswer(ans).length > 0
              ? { photoAttachments: photoAttachmentsFromAnswer(ans) }
              : {}),
            entitiesMentioned: [],
            keywords: Array.from(new Set(words)).slice(0, 35),
            recordedAt: ans.updatedAt || ans.createdAt || nowIso,
            immutable: true,
          };

          personTestimonies.push(block);
          createdTestimonies.push(block);
        }

        const linguisticProfile = extractLinguisticProfileFromTestimonies(personTestimonies);
        const relationsForPerson = extractRelatedPersonsFromTestimonies(
          avatarId,
          personId,
          personTestimonies
        );
        createdRelations.push(...relationsForPerson);

        const milestones = personTestimonies
          .slice(0, 6)
          .map((t) => `${t.lifeStage.toUpperCase()}: ${t.answerLiteral.slice(0, 110)}`);

        const personRawMarkdown =
          targetParticipants.length === 1 && interview
            ? generateQACompilationMarkdown({
                interview,
                participants: [part],
                questions,
                answers: personAnswers,
                photos,
                audios,
              })
            : personTestimonies
                .map(
                  (t, i) =>
                    `### ${i + 1}. ${t.questionLiteral}\n**Respuesta:**\n${t.answerLiteral}${
                      t.audioTranscriptionLiteral
                        ? `\n\nTranscripción de voz literal: ${t.audioTranscriptionLiteral}`
                        : ''
                    }`
                )
                .join('\n\n');

        const generatedPersonPdf = buildCompilationPdfBase64({
          interviewTitle: interview?.title || `Legado de ${part.name}`,
          participantNames: [part.name],
          rawTextContent: personRawMarkdown,
          testimonies: personTestimonies,
        });

        const personPdfRecord: MiEsenciaArchivedCompilationPdf = {
          pdfId: personPdfId,
          avatarId,
          sourceInterviewId: params.interviewId || 'manual',
          fileName: `Compilado_Testimonial_Fidedigno_${part.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`,
          origin: 'auto_generated_from_interview',
          sha256Hash: generatedPersonPdf.sha256Hash,
          totalQuestions: personTestimonies.length,
          totalLiteralAnswers: personTestimonies.length,
          totalAudiosTranscribed: personTestimonies.filter((t) => Boolean(t.audioTranscriptionLiteral))
            .length,
          totalPhotosReferenced: photos.length,
          rawTextContent: personRawMarkdown,
          pdfBase64: generatedPersonPdf.pdfBase64,
          createdAt: nowIso,
          createdBy: params.adminEmail,
        };
        createdPdfs.push(personPdfRecord);

        const profile: MiEsenciaPersonProfile = {
          personId,
          avatarId,
          sourceInterviewId: params.interviewId || 'manual',
          sourceParticipantId: part.id,
          sourcePdfId: personPdfId,
          fullName: part.name,
          preferredName: part.name.split(' ')[0] || part.name,
          relationshipLabelInCouple:
            targetParticipants.length > 1
              ? idx === 0
                ? 'Primer Perfil de Pareja'
                : 'Segundo Perfil de Pareja'
              : undefined,
          biographySummary: `Perfil testimonial fidedigno de ${part.name} construido a partir de ${personTestimonies.length} respuestas literales de su archivo PDF compilado.`,
          milestones,
          linguisticProfile,
          spontaneityLevel: spontaneity,
          status: 'aprobado',
          version: (existingPerson?.version || 0) + 1,
          createdAt: existingPerson?.createdAt || nowIso,
          updatedAt: nowIso,
        };

        createdPersons.push(profile);
      }
    } else {
      // Construir desde texto/PDF subido o entrevista aún sin respuestas registradas
      const names = isCouple
        ? avatarDisplayName.split(/\s*(?:&|y|e)\s*/i).filter(Boolean)
        : [avatarDisplayName];
      const profileNames = names.length >= 2 && isCouple ? names.slice(0, 2) : [avatarDisplayName];

      for (let idx = 0; idx < profileNames.length; idx++) {
        const pName = profileNames[idx];
        const personId = `person_${crypto.randomBytes(5).toString('hex')}`;
        const personPdfId = `comp_pdf_${crypto.randomBytes(5).toString('hex')}`;
        const parsedBlocks = parseCompilationTextIntoTestimonies({
          rawText:
            extractedPdfText ||
            `### 1. ¿Cuáles son los recuerdos más valiosos que deseas dejar a tu familia?\n**Respuesta:**\nQuiero que mi familia siempre recuerde cuánto los amo, el valor del trabajo honesto y la unión que construimos juntos en casa.`,
          avatarId,
          personId,
          sourcePdfId: personPdfId,
        });

        createdTestimonies.push(...parsedBlocks);
        const relationsForPerson = extractRelatedPersonsFromTestimonies(
          avatarId,
          personId,
          parsedBlocks
        );
        createdRelations.push(...relationsForPerson);

        const personRawMarkdown =
          extractedPdfText ||
          parsedBlocks
            .map((t, i) => `### ${i + 1}. ${t.questionLiteral}\n**Respuesta:**\n${t.answerLiteral}`)
            .join('\n\n');

        const generatedPersonPdf = buildCompilationPdfBase64({
          interviewTitle: interview?.title || pName,
          participantNames: [pName],
          rawTextContent: personRawMarkdown,
          testimonies: parsedBlocks,
        });

        const finalPdfBase64 =
          profileNames.length === 1 && params.uploadedPdfBase64
            ? params.uploadedPdfBase64
            : generatedPersonPdf.pdfBase64;
        const finalPdfHash =
          profileNames.length === 1 && params.uploadedPdfBase64
            ? crypto.createHash('sha256').update(params.uploadedPdfBase64).digest('hex')
            : generatedPersonPdf.sha256Hash;

        const personPdfRecord: MiEsenciaArchivedCompilationPdf = {
          pdfId: personPdfId,
          avatarId,
          sourceInterviewId: params.interviewId || 'uploaded_pdf',
          fileName:
            profileNames.length === 1 && params.uploadedPdfFileName
              ? params.uploadedPdfFileName
              : `Compilado_Testimonial_Fidedigno_${pName.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`,
          origin: params.uploadedPdfBase64 ? 'uploaded_by_admin' : 'auto_generated_from_interview',
          sha256Hash: finalPdfHash,
          totalQuestions: parsedBlocks.length,
          totalLiteralAnswers: parsedBlocks.length,
          totalAudiosTranscribed: parsedBlocks.filter((t) => Boolean(t.audioTranscriptionLiteral))
            .length,
          totalPhotosReferenced: photos.length,
          rawTextContent: personRawMarkdown,
          pdfBase64: finalPdfBase64,
          createdAt: nowIso,
          createdBy: params.adminEmail,
        };
        createdPdfs.push(personPdfRecord);

        const profile: MiEsenciaPersonProfile = {
          personId,
          avatarId,
          sourceInterviewId: params.interviewId || 'uploaded_pdf',
          sourcePdfId: personPdfId,
          fullName: pName,
          preferredName: pName.split(' ')[0] || pName,
          relationshipLabelInCouple:
            profileNames.length > 1
              ? idx === 0
                ? 'Primer Perfil de Pareja'
                : 'Segundo Perfil de Pareja'
              : undefined,
          biographySummary: `Perfil biográfico de ${pName} generado desde el Compilado Testimonial Fidedigno (${parsedBlocks.length} bloques literales).`,
          milestones: parsedBlocks.slice(0, 5).map((b) => b.answerLiteral.slice(0, 110)),
          linguisticProfile: extractLinguisticProfileFromTestimonies(parsedBlocks),
          spontaneityLevel: spontaneity,
          status: 'aprobado',
          version: 1,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        createdPersons.push(profile);
      }
    }

    // 2. Archivar el PDF de cada perfil y limpiar testimonios/relaciones previos de este avatar
    for (const pdfRec of createdPdfs) {
      this.compilationPdfs.set(pdfRec.pdfId, pdfRec);
      await this.persistDoc('mi_esencia_pdfs', pdfRec.pdfId, pdfRec);
    }
    const archivedPdf = createdPdfs[0];

    for (const [tid, oldT] of this.testimonies.entries()) {
      if (oldT.avatarId === avatarId) {
        this.testimonies.delete(tid);
      }
    }
    for (const t of createdTestimonies) {
      this.testimonies.set(t.testimonyId, t);
      await this.persistDoc('mi_esencia_testimonies', t.testimonyId, t);
    }

    for (const [rid, oldR] of this.relations.entries()) {
      if (oldR.avatarId === avatarId) {
        this.relations.delete(rid);
      }
    }
    for (const r of createdRelations) {
      this.relations.set(r.relatedPersonId, r);
      await this.persistDoc('mi_esencia_relations', r.relatedPersonId, r);
    }

    for (const p of createdPersons) {
      const existingPerson = this.persons.get(p.personId);
      if (existingPerson?.aiConfig && !params.initialConversationConfigMode) {
        p.aiConfig = {
          ...existingPerson.aiConfig,
          documentVersion: (existingPerson.aiConfig.documentVersion || 1) + 1,
          documentProcessingStatus: 'listo',
          documentLastProcessedAt: nowIso,
        };
      } else {
        const geminiLib = params.initialGeminiLibraryPromptId
          ? this.promptLibrary.get(params.initialGeminiLibraryPromptId)
          : undefined;
        const openaiLib = params.initialOpenAiLibraryPromptId
          ? this.promptLibrary.get(params.initialOpenAiLibraryPromptId)
          : undefined;

        const gemText =
          params.initialGeminiPromptContent?.trim() ||
          (geminiLib ? `${geminiLib.content}` : '');
        const oaText =
          params.initialOpenAiPromptContent?.trim() ||
          (openaiLib ? `${openaiLib.content}` : '');

        const initialMode: MiEsenciaConversationConfigMode =
          params.initialConversationConfigMode ||
          (gemText || oaText ? 'modo_personalizado' : 'modo_existente');

        let builtAiConfig = buildDefaultAvatarAiConfig({
          mode: initialMode,
          defaultGeminiModel:
            params.initialGeminiModel ||
            this.config.defaultGeminiModel ||
            MI_ESENCIA_DEFAULT_GEMINI_MODEL,
          defaultOpenAiModel:
            params.initialOpenAiModel || this.config.defaultOpenAiModel || OPENAI_DEFAULT_MODEL,
          primaryProvider: params.initialPrimaryProvider || 'gemini',
          geminiPromptContent: gemText,
          geminiPromptName: geminiLib?.name || 'Prompt Gemini del Avatar',
          openaiPromptContent: oaText,
          openaiPromptName: openaiLib?.name || 'Prompt OpenAI GPT del Avatar',
          updatedBy: params.adminEmail,
        });

        if (geminiLib) {
          builtAiConfig.geminiPromptSourceLibraryId = geminiLib.promptId;
        }
        if (openaiLib) {
          builtAiConfig.openaiPromptSourceLibraryId = openaiLib.promptId;
        }

        p.aiConfig = builtAiConfig;
      }

      this.persons.set(p.personId, p);
      await this.persistDoc('mi_esencia_persons', p.personId, p);
    }

    // 3. Crear o actualizar la Suscripción Comercial del Avatar Familiar
    const selectedPlan =
      this.plans.get(params.planId || 'plan_anual') ||
      this.plans.get('plan_anual') ||
      DEFAULT_MI_ESENCIA_PLANS[1];

    const renewalCalc = calculateRenewalExpirationDate({
      currentExpiresAt: existingSub?.expiresAt || nowIso,
      nowIso,
      unit: selectedPlan.defaultDurationUnit,
      value: selectedPlan.defaultDurationValue,
    });

    const defaultQuotaFromConfig =
      typeof this.config.defaultMonthlyMessageQuota === 'number' &&
      this.config.defaultMonthlyMessageQuota > 0
        ? this.config.defaultMonthlyMessageQuota
        : selectedPlan.monthlyMessageQuotaPerAvatar;

    const subscription: MiEsenciaSubscriptionRecord = {
      subscriptionId: existingSub?.subscriptionId || `sub_${crypto.randomBytes(5).toString('hex')}`,
      avatarId,
      sourceInterviewId: params.interviewId || 'uploaded_pdf',
      avatarDisplayName,
      isCoupleAvatar: createdPersons.length > 1,
      personIds: createdPersons.map((p) => p.personId),
      planId: selectedPlan.planId,
      planName: selectedPlan.name,
      status: selectedPlan.code === 'prueba_gratuita' ? 'prueba_activa' : 'activa',
      startsAt: existingSub?.startsAt || nowIso,
      expiresAt: existingSub ? existingSub.expiresAt : renewalCalc.newExpiresAtIso,
      gracePeriodDays: selectedPlan.gracePeriodDays,
      clockFrozen: false,
      maxAuthorizedInterlocutors: selectedPlan.maxAuthorizedInterlocutors,
      monthlyMessageQuota: existingSub?.monthlyMessageQuota || defaultQuotaFromConfig,
      dailyMessageQuotaPerInterlocutor: selectedPlan.dailyMessageQuotaPerInterlocutor,
      messagesUsedThisMonth: existingSub?.messagesUsedThisMonth || 0,
      tokensEstimatedThisMonth: existingSub?.tokensEstimatedThisMonth || 0,
      autoRenewEnabled: false,
      historyLog: [
        ...(existingSub?.historyLog || []),
        {
          id: `log_${crypto.randomBytes(4).toString('hex')}`,
          action: existingSub ? 'sincronizacion_avatar_pdf' : 'creacion_inicial_avatar',
          newExpiresAt: existingSub ? existingSub.expiresAt : renewalCalc.newExpiresAtIso,
          performedBy: params.adminEmail,
          notes: `Compilado Testimonial Fidedigno procesado (${createdTestimonies.length} testimonios literales).`,
          timestamp: nowIso,
        },
      ],
      createdAt: existingSub?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    // Si el administrador vuelve a crear/activar un avatar, asegurarnos de quitar sus IDs de deletedRegistry
    this.deletedRegistry.subscriptions.delete(avatarId);
    for (const p of createdPersons) {
      this.deletedRegistry.persons.delete(p.personId);
      if (p.sourcePdfId) this.deletedRegistry.pdfs.delete(p.sourcePdfId);
    }

    this.subscriptions.set(avatarId, subscription);
    await this.persistDoc('mi_esencia_subscriptions', avatarId, subscription);

    // 4. Crear familiares iniciales (o auto-generar desde las personas relacionadas extraídas si aún no hay interlocutores)
    const existingCreds = Array.from(this.credentials.values()).filter(
      (c) => c.avatarId === avatarId
    );
    const createdCredentials: MiEsenciaAccessCredential[] = [...existingCreds];

    const eligibleAutoRelations = createdRelations.filter(
      (rel) => !/^(madre|padre|abuelo|abuela)$/i.test(rel.relationshipType.trim())
    );

    // V5.4.2: the DEFAULT code of a new avatar is a general one, not linked to any relative (the
    // avatar does not know who is talking). Codes for specific relatives are only created when the
    // administrator lists them explicitly; they are no longer guessed from the testimony.
    void eligibleAutoRelations;
    const familyToCreate: Array<{
      fullName: string;
      relationshipToPerson: string;
      email?: string;
      phone?: string;
    }> = params.initialFamilyMembers && params.initialFamilyMembers.length > 0 ? params.initialFamilyMembers : [];

    if (existingCreds.length === 0) {
      const { credential } = await this.createInterlocutorWithCode({
        avatarId,
        fullName: MI_ESENCIA_GENERAL_ACCESS_NAME,
        relationshipToPerson: MI_ESENCIA_GENERAL_ACCESS_RELATIONSHIP,
        isGeneralAccess: true,
        adminEmail: params.adminEmail,
      });
      createdCredentials.push(credential);
    }

    for (const fam of familyToCreate) {
      const { credential } = await this.createInterlocutorWithCode({
        avatarId,
        fullName: fam.fullName,
        relationshipToPerson: fam.relationshipToPerson,
        email: fam.email,
        phone: fam.phone,
        adminEmail: params.adminEmail,
      });
      createdCredentials.push(credential);
    }

    // 5. Crear Instantánea Inicial (Snapshot Nivel Base)
    await this.createSnapshot({
      avatarId,
      label: 'Instantánea Base (Compilado Testimonial Fidedigno)',
      triggerType: 'initial_creation',
      createdBy: params.adminEmail,
    });

    return {
      subscription,
      persons: createdPersons,
      archivedPdf,
      testimoniesCount: createdTestimonies.length,
      relations: createdRelations,
      credentials: createdCredentials,
    };
  }

  // ============================================================================
  // V5.5.0 — INTERVIEWEE QUICK ACCESS (from the Book Studio, after the final PDF)
  // ============================================================================

  private quickAccessInFlight: Map<string, Promise<MiEsenciaParticipantQuickAccess>> = new Map();

  private findSubscriptionForInterview(interviewId: string): MiEsenciaSubscriptionRecord | undefined {
    return Array.from(this.subscriptions.values()).find((s) => s.sourceInterviewId === interviewId);
  }

  /** The avatar's general code (not linked to any relative); an active one is preferred. */
  private findGeneralCredential(avatarId: string): MiEsenciaAccessCredential | undefined {
    const general = Array.from(this.credentials.values()).filter(
      (c) => c.avatarId === avatarId && this.interlocutors.get(c.interlocutorId)?.isGeneralAccess === true
    );
    return general.find((c) => c.status === 'activo') || general[0];
  }

  private describeQuickAccess(
    sub: MiEsenciaSubscriptionRecord,
    cred: MiEsenciaAccessCredential | undefined
  ): MiEsenciaParticipantQuickAccess {
    const verification = cred ? this.verifyPersonalAccessCode(cred.personalCodePlain) : null;
    return {
      avatarId: sub.avatarId,
      avatarDisplayName: sub.avatarDisplayName,
      personalCode: cred?.personalCodePlain || '',
      privateLinkPath: cred?.privateLinkPath || '',
      available: Boolean(verification?.valid),
      unavailableReason: verification?.valid
        ? undefined
        : verification?.error || 'Tu acceso a Mi Esencia aún no tiene un código activo.',
      subscriptionStatus: sub.status,
      expiresAt: sub.expiresAt,
      planName: sub.planName,
      dailyMessageQuota: sub.dailyMessageQuotaPerInterlocutor,
      createdAvatar: Boolean(sub.participantQuickAccess?.createdAvatar),
      activatedAt: sub.participantQuickAccess?.activatedAt,
    };
  }

  /** Access already opened by the interviewee for this interview (null if not opened yet). */
  public getParticipantQuickAccess(interviewId: string): MiEsenciaParticipantQuickAccess | null {
    const sub = this.findSubscriptionForInterview(interviewId);
    if (!sub || !sub.participantQuickAccess) return null;
    return this.describeQuickAccess(sub, this.findGeneralCredential(sub.avatarId));
  }

  /**
   * Opens the interviewee's access to «Mi Esencia». Without an avatar for the interview, one is
   * created with MI_ESENCIA_QUICK_ACCESS_DEFAULTS (Gemini gemini-3.1-flash-lite, prompt «GPT V6»,
   * monthly plan, 30 messages a day, moderate spontaneity, general access). An avatar the
   * administrator already created is reused WITHOUT changing its configuration; only a general
   * code is added if it had none. Concurrent requests for the same interview share one creation.
   */
  public async activateParticipantQuickAccess(params: {
    interviewId: string;
    participantId: string;
  }): Promise<MiEsenciaParticipantQuickAccess> {
    const running = this.quickAccessInFlight.get(params.interviewId);
    if (running) return running;
    const job = this.doActivateParticipantQuickAccess(params).finally(() =>
      this.quickAccessInFlight.delete(params.interviewId)
    );
    this.quickAccessInFlight.set(params.interviewId, job);
    return job;
  }

  private async doActivateParticipantQuickAccess(params: {
    interviewId: string;
    participantId: string;
  }): Promise<MiEsenciaParticipantQuickAccess> {
    if (!this.config.miEsenciaEnabled) {
      throw new Error('Mi Esencia no está disponible en este momento.');
    }
    const D = MI_ESENCIA_QUICK_ACCESS_DEFAULTS;
    let sub = this.findSubscriptionForInterview(params.interviewId);
    let createdAvatar = false;

    if (!sub) {
      await storage.ensureInterviewPhotosHydrated(params.interviewId).catch(() => undefined);
      const plan =
        Array.from(this.plans.values()).find((p) => p.code === D.planCode && p.isActive) ||
        this.plans.get(D.fallbackPlanId);
      const prompt = findLibraryPromptByName(this.promptLibrary.values(), D.libraryPromptName);
      if (!prompt) {
        console.warn(
          `[Mi Esencia] Acceso rápido: no se encontró el prompt «${D.libraryPromptName}» en la biblioteca; el avatar usa el comportamiento base.`
        );
      }
      const created = await this.createOrSyncAvatarFromInterview({
        interviewId: params.interviewId,
        planId: plan?.planId || D.fallbackPlanId,
        spontaneityLevel: D.spontaneityLevel,
        initialConversationConfigMode: prompt ? 'modo_personalizado' : 'modo_existente',
        initialPrimaryProvider: D.primaryProvider,
        initialGeminiModel: D.geminiModel,
        initialGeminiLibraryPromptId: prompt?.promptId,
        adminEmail: D.performedBy,
      });
      await this.updateSubscriptionDailyUsage({
        avatarId: created.subscription.avatarId,
        dailyMessageQuotaPerInterlocutor: D.dailyMessageQuota,
        propagateToAllAvatarInterlocutors: true,
        adminEmail: D.performedBy,
      });
      sub = this.subscriptions.get(created.subscription.avatarId);
      createdAvatar = true;
      if (!sub) throw new Error('No se pudo preparar tu acceso a Mi Esencia.');
    }

    let cred = this.findGeneralCredential(sub.avatarId);
    if (!cred) {
      const { credential } = await this.createInterlocutorWithCode({
        avatarId: sub.avatarId,
        fullName: MI_ESENCIA_GENERAL_ACCESS_NAME,
        relationshipToPerson: MI_ESENCIA_GENERAL_ACCESS_RELATIONSHIP,
        isGeneralAccess: true,
        adminEmail: D.performedBy,
      });
      cred = credential;
    }

    if (!sub.participantQuickAccess) {
      const nowIso = new Date().toISOString();
      sub.participantQuickAccess = {
        activatedAt: nowIso,
        activatedByParticipantId: params.participantId,
        createdAvatar,
        emailDeliveries: [],
      };
      sub.historyLog.push({
        id: `log_${crypto.randomBytes(4).toString('hex')}`,
        action: 'acceso_rapido_entrevistado',
        performedBy: D.performedBy,
        notes: createdAvatar
          ? 'El entrevistado activó Mi Esencia desde su libro PDF: avatar creado con la configuración por defecto del acceso rápido.'
          : 'El entrevistado activó Mi Esencia desde su libro PDF: se reutilizó el avatar existente sin cambiar su configuración.',
        timestamp: nowIso,
      });
      sub.updatedAt = nowIso;
      this.subscriptions.set(sub.avatarId, sub);
      await this.persistDoc('mi_esencia_subscriptions', sub.avatarId, sub);
    }

    return this.describeQuickAccess(sub, cred);
  }

  /**
   * Sends the interviewee their access (link + code) by email. Limited to
   * MI_ESENCIA_QUICK_ACCESS_DEFAULTS.maxEmailsPer24h per avatar; every delivery is logged.
   */
  public async sendParticipantQuickAccessEmail(params: {
    interviewId: string;
    participantId: string;
    participantName: string;
    recipientEmail: string;
    publicBaseUrl: string;
    send: (
      content: { subject: string; text: string; html: string },
      to: string
    ) => Promise<{ sent: boolean; error?: string }>;
  }): Promise<{ sent: boolean; recipientEmail: string; error?: string }> {
    const to = String(params.recipientEmail || '').trim();
    if (!isValidQuickAccessEmail(to)) {
      return { sent: false, recipientEmail: to, error: 'Escribe un correo electrónico válido.' };
    }
    const sub = this.findSubscriptionForInterview(params.interviewId);
    if (!sub || !sub.participantQuickAccess) {
      return { sent: false, recipientEmail: to, error: 'Primero activa tu acceso a Mi Esencia.' };
    }
    const access = this.describeQuickAccess(sub, this.findGeneralCredential(sub.avatarId));
    if (!access.personalCode) {
      return { sent: false, recipientEmail: to, error: access.unavailableReason };
    }
    const D = MI_ESENCIA_QUICK_ACCESS_DEFAULTS;
    if (countRecentEmailDeliveries(sub.participantQuickAccess.emailDeliveries) >= D.maxEmailsPer24h) {
      return {
        sent: false,
        recipientEmail: to,
        error: 'Ya se enviaron varios correos con tu acceso hoy. Inténtalo de nuevo mañana.',
      };
    }

    const content = buildMiEsenciaAccessEmail({
      participantName: params.participantName,
      avatarDisplayName: access.avatarDisplayName,
      personalCode: access.personalCode,
      accessUrl: `${String(params.publicBaseUrl || '').replace(/\/+$/, '')}${access.privateLinkPath}`,
      expiresAtIso: access.expiresAt,
      dailyMessageQuota: access.dailyMessageQuota,
    });
    const result = await params.send(content, to);
    if (result.sent) {
      sub.participantQuickAccess.emailDeliveries = [
        ...(sub.participantQuickAccess.emailDeliveries || []).slice(-19),
        { to, sentAt: new Date().toISOString(), participantId: params.participantId },
      ];
      this.subscriptions.set(sub.avatarId, sub);
      await this.persistDoc('mi_esencia_subscriptions', sub.avatarId, sub);
    }
    return { sent: result.sent, recipientEmail: to, error: result.sent ? undefined : result.error };
  }

  // ============================================================================
  // INTERLOCUTORS & CRYPTOGRAPHIC PERSONAL CODES
  // ============================================================================

  public async createInterlocutorWithCode(params: {
    avatarId: string;
    fullName: string;
    relationshipToPerson: string;
    affectionateCallName?: string;
    email?: string;
    phone?: string;
    customDailyMessageLimit?: number;
    customMonthlyMessageLimit?: number;
    /** V5.4.2: general code (not linked to any relative). */
    isGeneralAccess?: boolean;
    adminEmail: string;
  }): Promise<{
    interlocutor: MiEsenciaInterlocutor;
    credential: MiEsenciaAccessCredential;
  }> {
    const nowIso = new Date().toISOString();
    const interlocutorId = `inter_${crypto.randomBytes(5).toString('hex')}`;

    // Buscar si coincide con alguna persona relacionada extraída de los testimonios
    // (V5.4.2: nunca para el código general, que no está relacionado con ningún familiar).
    const matchedRelation = params.isGeneralAccess
      ? undefined
      : Array.from(this.relations.values()).find(
          (r) =>
            r.avatarId === params.avatarId &&
            r.mentionedName.toLowerCase() === params.fullName.trim().toLowerCase()
        );

    const interlocutor: MiEsenciaInterlocutor = {
      interlocutorId,
      avatarId: params.avatarId,
      fullName: params.fullName.trim(),
      relationshipToPerson: params.relationshipToPerson.trim() || 'Familiar',
      linkedRelatedPersonId: matchedRelation?.relatedPersonId,
      affectionateCallName:
        params.affectionateCallName?.trim() ||
        matchedRelation?.affectionateNicknames?.[0] ||
        undefined,
      email: params.email?.trim(),
      phone: params.phone?.trim(),
      status: 'autorizado',
      permissions: {
        canConverse: true,
        canAddSharedMemoryLevelB: true,
        // V5.4.2: a general code is shared by anyone who has it: no private (level C) memories,
        // which would otherwise be visible to the next visitor.
        canAddPrivateMemoryLevelC: !params.isGeneralAccess,
        canResolveContradictions: true,
      },
      customDailyMessageLimit: params.customDailyMessageLimit,
      customMonthlyMessageLimit: params.customMonthlyMessageLimit,
      messagesSentToday: 0,
      messagesSentThisMonth: 0,
      ...(params.isGeneralAccess ? { isGeneralAccess: true } : {}),
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const generated = generatePersonalAccessCode(interlocutor.fullName);
    const accessCredentialId = `cred_${crypto.randomBytes(5).toString('hex')}`;
    const credential: MiEsenciaAccessCredential = {
      accessCredentialId,
      avatarId: params.avatarId,
      interlocutorId,
      interlocutorName: interlocutor.fullName,
      relationshipToPerson: interlocutor.relationshipToPerson,
      personalCodePlain: generated.personalCodePlain,
      codePrefix: generated.codePrefix,
      codeHash: generated.codeHash,
      privateLinkPath: `/miesencia?code=${encodeURIComponent(generated.personalCodePlain)}`,
      status: 'activo',
      failedAttempts: 0,
      createdAt: nowIso,
    };

    this.interlocutors.set(interlocutorId, interlocutor);
    this.credentials.set(accessCredentialId, credential);

    await this.persistDoc('mi_esencia_interlocutors', interlocutorId, interlocutor);
    await this.persistDoc('mi_esencia_credentials', accessCredentialId, credential);

    return { interlocutor, credential };
  }

  public async revokeOrUpdateCredentialStatus(params: {
    accessCredentialId: string;
    status: 'activo' | 'pausado' | 'revocado';
    regenerateCode?: boolean;
    adminEmail: string;
  }): Promise<MiEsenciaAccessCredential> {
    const cred = this.credentials.get(params.accessCredentialId);
    if (!cred) {
      throw new Error('Credencial de acceso no encontrada.');
    }

    const nowIso = new Date().toISOString();
    cred.status = params.status;
    if (params.status === 'revocado') {
      cred.revokedAt = nowIso;
    }

    if (params.regenerateCode) {
      const generated = generatePersonalAccessCode(cred.interlocutorName);
      cred.personalCodePlain = generated.personalCodePlain;
      cred.codePrefix = generated.codePrefix;
      cred.codeHash = generated.codeHash;
      cred.privateLinkPath = `/miesencia?code=${encodeURIComponent(generated.personalCodePlain)}`;
      cred.status = 'activo';
      cred.revokedAt = undefined;
    }

    this.credentials.set(cred.accessCredentialId, cred);
    await this.persistDoc('mi_esencia_credentials', cred.accessCredentialId, cred);
    return cred;
  }

  /**
   * Permite modificar manualmente el código personal, nombre del familiar, parentesco,
   * apodo afectuoso, correo y estado de un código familiar existente.
   */
  public async updateInterlocutorAndCredential(params: {
    accessCredentialId: string;
    fullName?: string;
    relationshipToPerson?: string;
    affectionateCallName?: string;
    email?: string;
    phone?: string;
    customPersonalCode?: string;
    customDailyMessageLimit?: number | null;
    messagesSentToday?: number;
    resetDailyCounter?: boolean;
    status?: 'activo' | 'pausado' | 'revocado';
    adminEmail: string;
  }): Promise<{
    credential: MiEsenciaAccessCredential;
    interlocutor?: MiEsenciaInterlocutor;
  }> {
    const cred = this.credentials.get(params.accessCredentialId);
    if (!cred) {
      throw new Error('Código personal no encontrado.');
    }

    const nowIso = new Date().toISOString();
    const inter = this.interlocutors.get(cred.interlocutorId);

    if (typeof params.fullName === 'string' && params.fullName.trim()) {
      cred.interlocutorName = params.fullName.trim();
      if (inter) inter.fullName = params.fullName.trim();
    }
    if (typeof params.relationshipToPerson === 'string' && params.relationshipToPerson.trim()) {
      cred.relationshipToPerson = params.relationshipToPerson.trim();
      if (inter) inter.relationshipToPerson = params.relationshipToPerson.trim();
    }
    if (inter) {
      if (typeof params.affectionateCallName === 'string') {
        inter.affectionateCallName = params.affectionateCallName.trim() || undefined;
      }
      if (typeof params.email === 'string') {
        inter.email = params.email.trim() || undefined;
      }
      if (typeof params.phone === 'string') {
        inter.phone = params.phone.trim() || undefined;
      }
      if (params.customDailyMessageLimit === null) {
        inter.customDailyMessageLimit = undefined;
      } else if (
        typeof params.customDailyMessageLimit === 'number' &&
        !Number.isNaN(params.customDailyMessageLimit)
      ) {
        inter.customDailyMessageLimit = Math.max(0, Math.floor(params.customDailyMessageLimit));
      }
      if (params.resetDailyCounter) {
        inter.messagesSentToday = 0;
      } else if (
        typeof params.messagesSentToday === 'number' &&
        !Number.isNaN(params.messagesSentToday)
      ) {
        inter.messagesSentToday = Math.max(0, Math.floor(params.messagesSentToday));
      }
      inter.updatedAt = nowIso;
    }

    if (typeof params.customPersonalCode === 'string' && params.customPersonalCode.trim()) {
      const normalizedCode = params.customPersonalCode.trim().toUpperCase();
      // Verificar que otro código distinto no tenga el mismo valor
      const duplicate = Array.from(this.credentials.values()).find(
        (other) =>
          other.accessCredentialId !== cred.accessCredentialId &&
          other.personalCodePlain.trim().toUpperCase() === normalizedCode
      );
      if (duplicate) {
        throw new Error(`El código "${normalizedCode}" ya está en uso por otro familiar.`);
      }
      cred.personalCodePlain = normalizedCode;
      cred.codePrefix = normalizedCode.slice(0, 8);
      cred.codeHash = computeMiEsenciaCodeHash(normalizedCode);
      cred.privateLinkPath = `/miesencia?code=${encodeURIComponent(normalizedCode)}`;
    } else {
      cred.privateLinkPath = `/miesencia?code=${encodeURIComponent(cred.personalCodePlain)}`;
    }

    if (params.status) {
      cred.status = params.status;
      if (params.status === 'revocado') {
        cred.revokedAt = nowIso;
      } else {
        cred.revokedAt = undefined;
      }
    }

    this.credentials.set(cred.accessCredentialId, cred);
    await this.persistDoc('mi_esencia_credentials', cred.accessCredentialId, cred);

    if (inter) {
      this.interlocutors.set(inter.interlocutorId, inter);
      await this.persistDoc('mi_esencia_interlocutors', inter.interlocutorId, inter);
    }

    return { credential: cred, interlocutor: inter };
  }

  // ============================================================================
  // SUBSCRIPTION MANAGEMENT, PAYMENTS & COUPONS
  // ============================================================================

  public async updateSubscriptionDurationOrStatus(params: {
    avatarId: string;
    action:
      | 'renew_or_extend'
      | 'set_exact_date'
      | 'suspend_clock_running'
      | 'suspend_clock_frozen'
      | 'resume'
      | 'cancel'
      | 'change_plan';
    unit?: 'days' | 'months' | 'years' | 'exact_date';
    value?: number;
    exactTargetDate?: string;
    planId?: string;
    paymentType?: MiEsenciaPaymentRecord['paymentType'];
    amountMxn?: number;
    couponCode?: string;
    referenceNumber?: string;
    notes?: string;
    adminEmail: string;
  }): Promise<{
    subscription: MiEsenciaSubscriptionRecord;
    payment?: MiEsenciaPaymentRecord;
  }> {
    let sub = this.subscriptions.get(params.avatarId);
    if (!sub) {
      throw new Error('Suscripción del avatar no encontrada.');
    }

    const nowIso = new Date().toISOString();
    const prevExpiresAt = sub.expiresAt;
    let createdPayment: MiEsenciaPaymentRecord | undefined;

    if (
      params.action === 'suspend_clock_running' ||
      params.action === 'suspend_clock_frozen' ||
      params.action === 'resume'
    ) {
      sub = applySubscriptionSuspensionState({
        subscription: sub,
        action: params.action,
        nowIso,
      });
      sub.historyLog.push({
        id: `log_${crypto.randomBytes(4).toString('hex')}`,
        action: params.action,
        previousExpiresAt: prevExpiresAt,
        newExpiresAt: sub.expiresAt,
        performedBy: params.adminEmail,
        notes: params.notes,
        timestamp: nowIso,
      });
    } else if (params.action === 'cancel') {
      sub.status = 'cancelada';
      sub.updatedAt = nowIso;
      sub.historyLog.push({
        id: `log_${crypto.randomBytes(4).toString('hex')}`,
        action: 'cancelacion_suscripcion',
        previousExpiresAt: prevExpiresAt,
        newExpiresAt: sub.expiresAt,
        performedBy: params.adminEmail,
        notes: params.notes,
        timestamp: nowIso,
      });
    } else if (params.action === 'change_plan' && params.planId) {
      const plan = this.plans.get(params.planId);
      if (plan) {
        sub.planId = plan.planId;
        sub.planName = plan.name;
        sub.gracePeriodDays = plan.gracePeriodDays;
        sub.maxAuthorizedInterlocutors = plan.maxAuthorizedInterlocutors;
        sub.monthlyMessageQuota = plan.monthlyMessageQuotaPerAvatar;
        sub.dailyMessageQuotaPerInterlocutor = plan.dailyMessageQuotaPerInterlocutor;
        sub.updatedAt = nowIso;
      }
    } else if (params.action === 'renew_or_extend' || params.action === 'set_exact_date') {
      const unit = params.action === 'set_exact_date' ? 'exact_date' : params.unit || 'months';
      const val = Number(params.value ?? 1);

      const calc = calculateRenewalExpirationDate({
        currentExpiresAt: sub.expiresAt,
        nowIso,
        unit,
        value: val,
        exactTargetDate: params.exactTargetDate,
      });

      sub.expiresAt = calc.newExpiresAtIso;
      sub.clockFrozen = false;
      sub.frozenAt = undefined;
      sub.frozenRemainingMs = undefined;
      sub.status = evaluateEffectiveSubscriptionStatus({ ...sub, status: 'activa' }, nowIso);
      sub.updatedAt = nowIso;

      sub.historyLog.push({
        id: `log_${crypto.randomBytes(4).toString('hex')}`,
        action: params.action,
        previousExpiresAt: prevExpiresAt,
        newExpiresAt: sub.expiresAt,
        performedBy: params.adminEmail,
        notes:
          params.notes ||
          `Vigencia actualizada (${calc.preservedRemainingDays} días previos conservados).`,
        timestamp: nowIso,
      });

      const paymentId = `pay_${crypto.randomBytes(5).toString('hex')}`;
      createdPayment = {
        paymentId,
        avatarId: sub.avatarId,
        subscriptionId: sub.subscriptionId,
        planId: sub.planId,
        paymentType: params.paymentType || 'pago_manual_admin',
        amountMxn: Number(params.amountMxn ?? 0),
        currency: 'MXN',
        couponCode: params.couponCode,
        durationAddedUnit: unit,
        durationAddedValue: val,
        exactTargetDate: params.exactTargetDate,
        previousExpiresAt: prevExpiresAt,
        newExpiresAt: sub.expiresAt,
        referenceNumber: params.referenceNumber,
        registeredBy: params.adminEmail,
        notes: params.notes,
        status: 'aplicado',
        createdAt: nowIso,
      };
      this.payments.set(paymentId, createdPayment);
      await this.persistDoc('mi_esencia_payments', paymentId, createdPayment);

      // Notificación interna de renovación
      const notifId = `notif_${crypto.randomBytes(4).toString('hex')}`;
      const notif: MiEsenciaNotificationRecord = {
        notificationId: notifId,
        avatarId: sub.avatarId,
        type: 'renovada',
        channel: 'chat_interno',
        recipientLabel: `Familia de ${sub.avatarDisplayName}`,
        subject: 'Suscripción de Mi Esencia renovada',
        message: `La suscripción del avatar de ${sub.avatarDisplayName} ha sido extendida hasta el ${new Date(
          sub.expiresAt
        ).toLocaleDateString('es-MX')}.`,
        deliveryStatus: 'entregado_en_chat',
        createdAt: nowIso,
      };
      this.notifications.set(notifId, notif);
      await this.persistDoc('mi_esencia_notifications', notifId, notif);
    }

    this.subscriptions.set(sub.avatarId, sub);
    await this.persistDoc('mi_esencia_subscriptions', sub.avatarId, sub);

    return { subscription: sub, payment: createdPayment };
  }

  /**
   * Ajusta de forma manual el uso mensual de mensajes y/o el límite mensual de un avatar específico.
   */
  public async updateSubscriptionMonthlyUsage(params: {
    avatarId: string;
    monthlyMessageQuota?: number;
    messagesUsedThisMonth?: number;
    resetUsedCounter?: boolean;
    adminEmail: string;
  }): Promise<MiEsenciaSubscriptionRecord> {
    const sub = this.subscriptions.get(params.avatarId);
    if (!sub) {
      throw new Error('Suscripción del avatar no encontrada.');
    }

    const nowIso = new Date().toISOString();
    if (typeof params.monthlyMessageQuota === 'number' && !Number.isNaN(params.monthlyMessageQuota)) {
      sub.monthlyMessageQuota = Math.max(0, Math.floor(params.monthlyMessageQuota));
    }
    if (params.resetUsedCounter) {
      sub.messagesUsedThisMonth = 0;
    } else if (
      typeof params.messagesUsedThisMonth === 'number' &&
      !Number.isNaN(params.messagesUsedThisMonth)
    ) {
      sub.messagesUsedThisMonth = Math.max(0, Math.floor(params.messagesUsedThisMonth));
    }

    sub.updatedAt = nowIso;
    sub.historyLog.push({
      id: `log_${crypto.randomBytes(4).toString('hex')}`,
      action: 'ajuste_manual_uso_mensual',
      previousExpiresAt: sub.expiresAt,
      newExpiresAt: sub.expiresAt,
      performedBy: params.adminEmail,
      notes: `Uso mensual ajustado manualmente: ${sub.messagesUsedThisMonth} / ${sub.monthlyMessageQuota} mensajes.`,
      timestamp: nowIso,
    });

    this.subscriptions.set(sub.avatarId, sub);
    await this.persistDoc('mi_esencia_subscriptions', sub.avatarId, sub);
    return sub;
  }

  /**
   * Aplica un límite mensual configurable a todos los avatares, permite reiniciar contadores
   * y/o guardar el valor como número por defecto para nuevos avatares.
   */
  public async applyMonthlyQuotaToAllSubscriptions(params: {
    monthlyMessageQuota?: number;
    resetAllCounters?: boolean;
    saveAsDefaultForNewAvatars?: boolean;
    adminEmail: string;
  }): Promise<{
    updatedCount: number;
    defaultMonthlyMessageQuota?: number;
    subscriptions: MiEsenciaSubscriptionRecord[];
  }> {
    const nowIso = new Date().toISOString();
    const quotaVal =
      typeof params.monthlyMessageQuota === 'number' && !Number.isNaN(params.monthlyMessageQuota)
        ? Math.max(0, Math.floor(params.monthlyMessageQuota))
        : undefined;

    if (params.saveAsDefaultForNewAvatars && typeof quotaVal === 'number') {
      await this.updateConfig({ defaultMonthlyMessageQuota: quotaVal }, params.adminEmail);
    }

    const updatedSubs: MiEsenciaSubscriptionRecord[] = [];
    for (const [aid, sub] of this.subscriptions.entries()) {
      if (typeof quotaVal === 'number') {
        sub.monthlyMessageQuota = quotaVal;
      }
      if (params.resetAllCounters) {
        sub.messagesUsedThisMonth = 0;
      }
      sub.updatedAt = nowIso;
      sub.historyLog.push({
        id: `log_${crypto.randomBytes(4).toString('hex')}`,
        action: 'ajuste_masivo_uso_mensual',
        previousExpiresAt: sub.expiresAt,
        newExpiresAt: sub.expiresAt,
        performedBy: params.adminEmail,
        notes: `Ajuste masivo aplicado (${sub.messagesUsedThisMonth} / ${sub.monthlyMessageQuota} mensajes).`,
        timestamp: nowIso,
      });
      this.subscriptions.set(aid, sub);
      updatedSubs.push(sub);
    }

    await Promise.all(
      updatedSubs.map((s) => this.persistDoc('mi_esencia_subscriptions', s.avatarId, s))
    );

    return {
      updatedCount: updatedSubs.length,
      defaultMonthlyMessageQuota: this.config.defaultMonthlyMessageQuota,
      subscriptions: updatedSubs,
    };
  }

  /**
   * Ajusta de forma manual el límite diario de mensajes de un avatar y/o reinicia los contadores
   * diarios usados hoy por los familiares asociados a ese avatar.
   */
  public async updateSubscriptionDailyUsage(params: {
    avatarId: string;
    dailyMessageQuotaPerInterlocutor?: number;
    propagateToAllAvatarInterlocutors?: boolean;
    resetDailyCountersForAvatar?: boolean;
    adminEmail: string;
  }): Promise<{
    subscription: MiEsenciaSubscriptionRecord;
    updatedInterlocutors: MiEsenciaInterlocutor[];
  }> {
    const sub = this.subscriptions.get(params.avatarId);
    if (!sub) {
      throw new Error('Suscripción del avatar no encontrada.');
    }

    const nowIso = new Date().toISOString();
    if (
      typeof params.dailyMessageQuotaPerInterlocutor === 'number' &&
      !Number.isNaN(params.dailyMessageQuotaPerInterlocutor)
    ) {
      sub.dailyMessageQuotaPerInterlocutor = Math.max(
        0,
        Math.floor(params.dailyMessageQuotaPerInterlocutor)
      );
    }

    const updatedInterlocutors: MiEsenciaInterlocutor[] = [];
    for (const [iid, inter] of this.interlocutors.entries()) {
      if (inter.avatarId !== params.avatarId) continue;
      let changed = false;
      if (
        params.propagateToAllAvatarInterlocutors !== false &&
        typeof params.dailyMessageQuotaPerInterlocutor === 'number'
      ) {
        inter.customDailyMessageLimit = Math.max(
          0,
          Math.floor(params.dailyMessageQuotaPerInterlocutor)
        );
        changed = true;
      }
      if (params.resetDailyCountersForAvatar) {
        inter.messagesSentToday = 0;
        changed = true;
      }
      if (changed) {
        inter.updatedAt = nowIso;
        this.interlocutors.set(iid, inter);
        updatedInterlocutors.push(inter);
      }
    }

    sub.updatedAt = nowIso;
    sub.historyLog.push({
      id: `log_${crypto.randomBytes(4).toString('hex')}`,
      action: 'ajuste_manual_uso_diario',
      previousExpiresAt: sub.expiresAt,
      newExpiresAt: sub.expiresAt,
      performedBy: params.adminEmail,
      notes: `Límite diario del avatar ajustado manualmente a ${sub.dailyMessageQuotaPerInterlocutor} msjs/día${
        params.resetDailyCountersForAvatar ? ' (contadores diarios reiniciados a 0)' : ''
      }.`,
      timestamp: nowIso,
    });

    this.subscriptions.set(sub.avatarId, sub);
    await Promise.all([
      this.persistDoc('mi_esencia_subscriptions', sub.avatarId, sub),
      ...updatedInterlocutors.map((i) =>
        this.persistDoc('mi_esencia_interlocutors', i.interlocutorId, i)
      ),
    ]);

    return { subscription: sub, updatedInterlocutors };
  }

  /**
   * Aplica en bloque un límite diario configurable a todos los avatares y familiares,
   * permite reiniciar a 0 los mensajes usados hoy de todos y/o guardarlo como valor por defecto.
   */
  public async applyDailyQuotaToAllSubscriptions(params: {
    dailyMessageQuota?: number;
    resetAllDailyCounters?: boolean;
    saveAsDefaultForNewAvatars?: boolean;
    adminEmail: string;
  }): Promise<{
    updatedAvatarsCount: number;
    updatedInterlocutorsCount: number;
    defaultDailyMessageQuota?: number;
  }> {
    const nowIso = new Date().toISOString();
    const quotaVal =
      typeof params.dailyMessageQuota === 'number' && !Number.isNaN(params.dailyMessageQuota)
        ? Math.max(0, Math.floor(params.dailyMessageQuota))
        : undefined;

    if (params.saveAsDefaultForNewAvatars && typeof quotaVal === 'number') {
      await this.updateConfig({ defaultDailyMessageQuota: quotaVal }, params.adminEmail);
    }

    const updatedSubs: MiEsenciaSubscriptionRecord[] = [];
    for (const [aid, sub] of this.subscriptions.entries()) {
      if (typeof quotaVal === 'number') {
        sub.dailyMessageQuotaPerInterlocutor = quotaVal;
      }
      sub.updatedAt = nowIso;
      this.subscriptions.set(aid, sub);
      updatedSubs.push(sub);
    }

    const updatedInterlocutors: MiEsenciaInterlocutor[] = [];
    for (const [iid, inter] of this.interlocutors.entries()) {
      let changed = false;
      if (typeof quotaVal === 'number') {
        inter.customDailyMessageLimit = quotaVal;
        changed = true;
      }
      if (params.resetAllDailyCounters) {
        inter.messagesSentToday = 0;
        changed = true;
      }
      if (changed) {
        inter.updatedAt = nowIso;
        this.interlocutors.set(iid, inter);
        updatedInterlocutors.push(inter);
      }
    }

    await Promise.all([
      ...updatedSubs.map((s) => this.persistDoc('mi_esencia_subscriptions', s.avatarId, s)),
      ...updatedInterlocutors.map((i) =>
        this.persistDoc('mi_esencia_interlocutors', i.interlocutorId, i)
      ),
    ]);

    return {
      updatedAvatarsCount: updatedSubs.length,
      updatedInterlocutorsCount: updatedInterlocutors.length,
      defaultDailyMessageQuota: this.config.defaultDailyMessageQuota,
    };
  }

  /**
   * Ajusta de forma individual el límite diario y/o el contador de mensajes usados hoy
   * de un familiar específico (código personal).
   */
  public async updateInterlocutorDailyUsage(params: {
    interlocutorId: string;
    customDailyMessageLimit?: number | null;
    messagesSentToday?: number;
    resetDailyCounter?: boolean;
    adminEmail: string;
  }): Promise<MiEsenciaInterlocutor> {
    const inter = this.interlocutors.get(params.interlocutorId);
    if (!inter) {
      throw new Error('Familiar / interlocutor no encontrado.');
    }

    const nowIso = new Date().toISOString();
    if (params.customDailyMessageLimit === null) {
      inter.customDailyMessageLimit = undefined;
    } else if (
      typeof params.customDailyMessageLimit === 'number' &&
      !Number.isNaN(params.customDailyMessageLimit)
    ) {
      inter.customDailyMessageLimit = Math.max(0, Math.floor(params.customDailyMessageLimit));
    }

    if (params.resetDailyCounter) {
      inter.messagesSentToday = 0;
    } else if (
      typeof params.messagesSentToday === 'number' &&
      !Number.isNaN(params.messagesSentToday)
    ) {
      inter.messagesSentToday = Math.max(0, Math.floor(params.messagesSentToday));
    }

    inter.updatedAt = nowIso;
    this.interlocutors.set(inter.interlocutorId, inter);
    await this.persistDoc('mi_esencia_interlocutors', inter.interlocutorId, inter);
    return inter;
  }

  public async createCoupon(params: {
    code: string;
    description: string;
    discountPercent: number;
    bonusDays: number;
    maxRedemptions: number;
    expiresAt?: string;
  }): Promise<MiEsenciaPromotionCoupon> {
    const couponId = `cup_${crypto.randomBytes(4).toString('hex')}`;
    const coupon: MiEsenciaPromotionCoupon = {
      couponId,
      code: params.code.trim().toUpperCase(),
      description: params.description.trim(),
      discountPercent: Math.min(100, Math.max(0, Number(params.discountPercent) || 0)),
      bonusDays: Math.max(0, Number(params.bonusDays) || 0),
      maxRedemptions: Math.max(1, Number(params.maxRedemptions) || 100),
      timesRedeemed: 0,
      isActive: true,
      expiresAt: params.expiresAt,
      createdAt: new Date().toISOString(),
    };
    this.coupons.set(couponId, coupon);
    await this.persistDoc('mi_esencia_coupons', couponId, coupon);
    return coupon;
  }

  // ============================================================================
  // SNAPSHOTS & PARTIAL / TOTAL RESTORATION
  // ============================================================================

  public async createSnapshot(params: {
    avatarId: string;
    label: string;
    triggerType: MiEsenciaSnapshotRecord['triggerType'];
    createdBy: string;
  }): Promise<MiEsenciaSnapshotRecord> {
    const snapshotId = `snap_${crypto.randomBytes(5).toString('hex')}`;
    const personsSnapshot = Array.from(this.persons.values())
      .filter((p) => p.avatarId === params.avatarId)
      .map((p) => JSON.parse(JSON.stringify(p)));
    const memoriesSnapshot = Array.from(this.memories.values())
      .filter((m) => m.avatarId === params.avatarId)
      .map((m) => JSON.parse(JSON.stringify(m)));
    const contradictionsSnapshot = Array.from(this.contradictions.values())
      .filter((c) => c.avatarId === params.avatarId)
      .map((c) => JSON.parse(JSON.stringify(c)));

    const snapshot: MiEsenciaSnapshotRecord = {
      snapshotId,
      avatarId: params.avatarId,
      label: params.label,
      triggerType: params.triggerType,
      personsSnapshot,
      memoriesSnapshot,
      contradictionsSnapshot,
      createdBy: params.createdBy,
      createdAt: new Date().toISOString(),
    };

    this.snapshots.set(snapshotId, snapshot);
    await this.persistDoc('mi_esencia_snapshots', snapshotId, snapshot);
    return snapshot;
  }

  /**
   * Restauración Total o Parcial del Avatar:
   * - 'total_to_original_pdf': Elimina todas las memorias conversacionales (Nivel B y C) y contradicciones,
   *   dejando intacto únicamente el Nivel A (Compilado Testimonial Fidedigno).
   * - 'from_snapshot': Restaura el estado exacto de una instantánea previa.
   * - 'partial_by_interlocutor': Revoca únicamente las memorias aportadas por un familiar específico.
   * - 'partial_since_date': Revoca únicamente las memorias creadas a partir de una fecha determinada.
   */
  public async restoreAvatarState(params: {
    avatarId: string;
    mode: 'total_to_original_pdf' | 'from_snapshot' | 'partial_by_interlocutor' | 'partial_since_date';
    snapshotId?: string;
    targetInterlocutorId?: string;
    sinceDateIso?: string;
    adminEmail: string;
  }): Promise<{
    restoredMemoriesCount: number;
    removedMemoriesCount: number;
  }> {
    let removedCount = 0;

    if (params.mode === 'total_to_original_pdf') {
      for (const [mid, mem] of this.memories.entries()) {
        if (mem.avatarId === params.avatarId) {
          this.memories.delete(mid);
          removedCount++;
        }
      }
      for (const [cid, con] of this.contradictions.entries()) {
        if (con.avatarId === params.avatarId) {
          this.contradictions.delete(cid);
        }
      }
      this.saveToDisk();
      return { restoredMemoriesCount: 0, removedMemoriesCount: removedCount };
    }

    if (params.mode === 'from_snapshot' && params.snapshotId) {
      const snap = this.snapshots.get(params.snapshotId);
      if (!snap || snap.avatarId !== params.avatarId) {
        throw new Error('Instantánea no encontrada para este avatar.');
      }

      for (const [mid, mem] of this.memories.entries()) {
        if (mem.avatarId === params.avatarId) {
          this.memories.delete(mid);
          removedCount++;
        }
      }
      for (const m of snap.memoriesSnapshot) {
        this.memories.set(m.memoryId, { ...m });
      }

      for (const [cid, con] of this.contradictions.entries()) {
        if (con.avatarId === params.avatarId) {
          this.contradictions.delete(cid);
        }
      }
      for (const c of snap.contradictionsSnapshot) {
        this.contradictions.set(c.contradictionId, { ...c });
      }

      this.saveToDisk();
      return {
        restoredMemoriesCount: snap.memoriesSnapshot.length,
        removedMemoriesCount: removedCount,
      };
    }

    if (params.mode === 'partial_by_interlocutor' && params.targetInterlocutorId) {
      for (const [mid, mem] of this.memories.entries()) {
        if (
          mem.avatarId === params.avatarId &&
          mem.ownerInterlocutorId === params.targetInterlocutorId
        ) {
          mem.verificationState = 'revocado';
          mem.updatedAt = new Date().toISOString();
          this.memories.set(mid, mem);
          removedCount++;
        }
      }
      this.saveToDisk();
      return {
        restoredMemoriesCount: Array.from(this.memories.values()).filter(
          (m) => m.avatarId === params.avatarId && m.verificationState !== 'revocado'
        ).length,
        removedMemoriesCount: removedCount,
      };
    }

    if (params.mode === 'partial_since_date' && params.sinceDateIso) {
      const cutoffMs = new Date(params.sinceDateIso).getTime();
      for (const [mid, mem] of this.memories.entries()) {
        if (
          mem.avatarId === params.avatarId &&
          new Date(mem.createdAt).getTime() >= cutoffMs
        ) {
          mem.verificationState = 'revocado';
          mem.updatedAt = new Date().toISOString();
          this.memories.set(mid, mem);
          removedCount++;
        }
      }
      this.saveToDisk();
      return {
        restoredMemoriesCount: Array.from(this.memories.values()).filter(
          (m) => m.avatarId === params.avatarId && m.verificationState !== 'revocado'
        ).length,
        removedMemoriesCount: removedCount,
      };
    }

    return { restoredMemoriesCount: 0, removedMemoriesCount: 0 };
  }

  // ============================================================================
  // FAMILY PORTAL AUTHENTICATION BY CRYPTOGRAPHIC PERSONAL CODE
  // ============================================================================

  public verifyPersonalAccessCode(rawCode: string): PersonalAccessVerification {
    if (!this.config.miEsenciaEnabled) {
      return {
        valid: false,
        error: 'El servicio Mi Esencia se encuentra temporalmente desactivado por el administrador.',
      };
    }

    const cleanCode = extractCleanMiEsenciaCode(rawCode);
    if (!cleanCode) {
      return { valid: false, error: 'Por favor ingresa tu código personal de acceso.' };
    }

    const cred = this.findCredentialByCleanCode(cleanCode);

    if (!cred) {
      return {
        valid: false,
        error: 'El código personal ingresado no es válido. Verifica el enlace privado enviado por el administrador.',
      };
    }

    return this.verifyFoundCredential(cred);
  }

  /**
   * V5.6.2 — Side-effect-free: does this personal code belong to ANY credential (active or not)?
   * Used by the anti-brute-force guard: only codes that match nothing count as failed attempts.
   */
  public classifyPersonalAccessCode(rawCode: string): { known: boolean; credentialId?: string } {
    const cleanCode = extractCleanMiEsenciaCode(String(rawCode || ''));
    if (!cleanCode) return { known: false };
    const cred = this.findCredentialByCleanCode(cleanCode);
    return cred ? { known: true, credentialId: `me:${cred.accessCredentialId}` } : { known: false };
  }

  private findCredentialByCleanCode(cleanCode: string): MiEsenciaAccessCredential | undefined {
    const alphaNumInput = cleanCode.replace(/[^A-Z0-9]/g, '');
    const inputHash = computeMiEsenciaCodeHash(cleanCode);
    return Array.from(this.credentials.values()).find((c) => {
      const cUpper = c.personalCodePlain.toUpperCase();
      const cAlphaNum = cUpper.replace(/[^A-Z0-9]/g, '');
      const legacyUpper = String((c as any).legacyCodePlain || '').toUpperCase();
      const legacyList: string[] = Array.isArray((c as any).legacyCodesPlain)
        ? (c as any).legacyCodesPlain.map((v: string) => String(v || '').toUpperCase())
        : [];
      return (
        c.codeHash === inputHash ||
        cUpper === cleanCode ||
        (alphaNumInput.length >= 4 && cAlphaNum === alphaNumInput) ||
        (Boolean(legacyUpper) && (legacyUpper === cleanCode || legacyUpper.replace(/[^A-Z0-9]/g, '') === alphaNumInput)) ||
        legacyList.some((lc) => lc === cleanCode || lc.replace(/[^A-Z0-9]/g, '') === alphaNumInput)
      );
    });
  }

  private verifyFoundCredential(cred: MiEsenciaAccessCredential): PersonalAccessVerification {
    if (cred.status === 'revocado' || cred.status === 'pausado') {
      return {
        valid: false,
        error: `Este código personal se encuentra ${cred.status}. Solicita un nuevo código al administrador familiar.`,
      };
    }

    const interlocutor = this.interlocutors.get(cred.interlocutorId);
    if (!interlocutor || interlocutor.status !== 'autorizado') {
      return {
        valid: false,
        error: 'El perfil de familiar asociado a este código no se encuentra activo.',
      };
    }

    const todayDatePrefix = new Date().toISOString().slice(0, 10);
    if (
      interlocutor.lastActiveDate &&
      interlocutor.lastActiveDate.slice(0, 10) !== todayDatePrefix &&
      interlocutor.messagesSentToday > 0
    ) {
      interlocutor.messagesSentToday = 0;
      this.interlocutors.set(interlocutor.interlocutorId, interlocutor);
    }

    const sub = this.subscriptions.get(cred.avatarId);
    if (!sub) {
      return {
        valid: false,
        error: 'No se encontró una suscripción activa asociada a este avatar.',
      };
    }

    const effectiveStatus = evaluateEffectiveSubscriptionStatus(sub);
    sub.status = effectiveStatus;

    const persons = Array.from(this.persons.values()).filter(
      (p) => p.avatarId === cred.avatarId && p.status !== 'suspendido'
    );

    return {
      valid: true,
      subscriptionStatus: effectiveStatus,
      credential: cred,
      interlocutor,
      subscription: sub,
      persons,
      config: this.getConfig(),
    };
  }

  // ============================================================================
  // SESSION MANAGEMENT, INITIAL REFLECTIVE GREETING & BIOGRAPHICAL ENGINE
  // ============================================================================

  private async buildInitialSessionGreeting(params: {
    person: MiEsenciaPersonProfile;
    interlocutor: MiEsenciaInterlocutor;
    personTestimonies: MiEsenciaTestimonyBlock[];
    previousThemesUsed: MiEsenciaReflectionTheme[];
    sessionIndex: number;
  }): Promise<{
    greetingText: string;
    themeUsed?: MiEsenciaReflectionTheme;
    providerUsed?: MiEsenciaAiProvider;
    modelUsed?: string;
    fallbackNotice?: string;
  }> {
    const { person, personTestimonies, previousThemesUsed, sessionIndex } = params;
    const fallbackGreeting = buildVariedInitialReflectiveGreeting({
      person,
      testimonies: personTestimonies,
      previousThemesUsed,
      sessionIndex,
    });
    return {
      greetingText: fallbackGreeting.greetingText,
      themeUsed: fallbackGreeting.themeUsed,
    };
  }

  public async ensureOrCreateConversationSession(params: {
    avatarId: string;
    person: MiEsenciaPersonProfile;
    interlocutor: MiEsenciaInterlocutor;
    forceNewSession?: boolean;
    sessionId?: string;
  }): Promise<MiEsenciaConversationSession> {
    this.syncPersonWithAssignedPdfAndInterview(params.person.personId);
    const updatedPerson = this.persons.get(params.person.personId) || params.person;

    const existingSessions = Array.from(this.conversations.values())
      .filter(
        (s) =>
          s.avatarId === params.avatarId &&
          s.personId === updatedPerson.personId &&
          s.interlocutorId === params.interlocutor.interlocutorId
      )
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    if (!params.forceNewSession) {
      if (params.sessionId) {
        const foundById = existingSessions.find((s) => s.sessionId === params.sessionId);
        if (foundById) return foundById;
      }
      if (existingSessions.length > 0) {
        const latest = existingSessions[0];
        // Si la sesión existente aún no tenía el saludo inicial, se lo agregamos sin duplicar
        if (latest.messages.length === 0) {
          const personTestimonies = Array.from(this.testimonies.values()).filter(
            (t) =>
              t.personId === updatedPerson.personId &&
              (!updatedPerson.sourcePdfId || t.sourcePdfId === updatedPerson.sourcePdfId)
          );
          const greeting = await this.buildInitialSessionGreeting({
            person: updatedPerson,
            interlocutor: params.interlocutor,
            personTestimonies,
            previousThemesUsed: [],
            sessionIndex: 0,
          });
          latest.reflectionThemeUsed = greeting.themeUsed;
          latest.lastProviderUsed = greeting.providerUsed;
          latest.lastModelUsed = greeting.modelUsed;
          latest.lastFallbackNotice = greeting.fallbackNotice;
          latest.identityState = 'awaiting_identification';
          latest.messages.push({
            messageId: `msg_${crypto.randomBytes(4).toString('hex')}`,
            sender: 'avatar',
            personId: updatedPerson.personId,
            content: greeting.greetingText,
            timestamp: latest.startedAt,
          });
          this.conversations.set(latest.sessionId, latest);
          void this.persistDoc('mi_esencia_conversations', latest.sessionId, latest);
        }
        return latest;
      }
    }

    // Crear nueva sesión conservando todas las anteriores en el historial
    const nowIso = new Date().toISOString();
    const sessionId = `sess_${crypto.randomBytes(5).toString('hex')}`;
    const personTestimonies = Array.from(this.testimonies.values()).filter(
      (t) =>
        t.personId === updatedPerson.personId &&
        (!updatedPerson.sourcePdfId || t.sourcePdfId === updatedPerson.sourcePdfId)
    );
    const previousThemesUsed = existingSessions
      .map((s) => s.reflectionThemeUsed)
      .filter((t): t is MiEsenciaReflectionTheme => Boolean(t));

    const greeting = await this.buildInitialSessionGreeting({
      person: updatedPerson,
      interlocutor: params.interlocutor,
      personTestimonies,
      previousThemesUsed,
      sessionIndex: existingSessions.length,
    });

    const newSessionNumber = existingSessions.length + 1;
    const newSession: MiEsenciaConversationSession = {
      sessionId,
      avatarId: params.avatarId,
      personId: updatedPerson.personId,
      interlocutorId: params.interlocutor.interlocutorId,
      interlocutorName: isGenericAdministrativeInterlocutorName(params.interlocutor.fullName)
        ? 'Por identificar en conversación'
        : params.interlocutor.fullName,
      interlocutorRelationship: params.interlocutor.relationshipToPerson,
      title: `Conversación #${newSessionNumber} • ${new Date(nowIso).toLocaleDateString('es-MX')}`,
      reflectionThemeUsed: greeting.themeUsed,
      lastProviderUsed: greeting.providerUsed,
      lastModelUsed: greeting.modelUsed,
      lastFallbackNotice: greeting.fallbackNotice,
      identityState: 'awaiting_identification',
      hasPrivateLevelCMemories: false,
      messages: [
        {
          messageId: `msg_${crypto.randomBytes(4).toString('hex')}`,
          sender: 'avatar',
          personId: updatedPerson.personId,
          content: greeting.greetingText,
          timestamp: nowIso,
        },
      ],
      startedAt: nowIso,
      lastMessageAt: nowIso,
    };

    this.conversations.set(sessionId, newSession);
    void this.persistDoc('mi_esencia_conversations', sessionId, newSession);
    return newSession;
  }

  /**
   * Registra de manera definitiva que el interlocutor aceptó el Aviso de Transparencia,
   * para que se acepte una sola vez y no vuelva a solicitarse en futuros ingresos.
   */
  public async confirmInterlocutorConsent(personalCode: string): Promise<MiEsenciaInterlocutor> {
    const authCheck = this.verifyPersonalAccessCode(personalCode);
    if (!authCheck.valid || !authCheck.interlocutor) {
      throw new Error(authCheck.error || 'Código personal inválido.');
    }
    const inter = authCheck.interlocutor;
    if (!inter.consentAcceptedAt) {
      inter.consentAcceptedAt = new Date().toISOString();
      inter.updatedAt = inter.consentAcceptedAt;
      this.interlocutors.set(inter.interlocutorId, inter);
      await this.persistDoc('mi_esencia_interlocutors', inter.interlocutorId, inter);
    }
    return inter;
  }

  public async startNewConversationSession(params: {
    personalCode: string;
    selectedPersonId?: string;
  }): Promise<{
    newSession: MiEsenciaConversationSession;
    allSessions: MiEsenciaConversationSession[];
  }> {
    const authCheck = this.verifyPersonalAccessCode(params.personalCode);
    if (
      !authCheck.valid ||
      !authCheck.interlocutor ||
      !authCheck.subscription ||
      !authCheck.persons ||
      authCheck.persons.length === 0
    ) {
      throw new Error(authCheck.error || 'Acceso no autorizado.');
    }

    const activePerson =
      authCheck.persons.find((p) => p.personId === params.selectedPersonId) ||
      authCheck.persons[0];

    const newSession = await this.ensureOrCreateConversationSession({
      avatarId: authCheck.subscription.avatarId,
      person: activePerson,
      interlocutor: authCheck.interlocutor,
      forceNewSession: true,
    });

    const allSessions = Array.from(this.conversations.values())
      .filter(
        (s) =>
          s.avatarId === authCheck.subscription!.avatarId &&
          s.interlocutorId === authCheck.interlocutor!.interlocutorId
      )
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    return { newSession, allSessions };
  }

  /** V5.4.2: test hook (null restores the real engine). */
  public __setPhotoDescriptionGeneratorForTests(
    fn: ((input: { systemInstructions: string; userText: string }) => Promise<string | null>) | null
  ): void {
    this.photoDescriptionGeneratorForTests = fn;
    this.photoDescriptionCache.clear();
  }

  /**
   * V5.4.2 — Caption of each shown photo written by the avatar's configured engine with its prompt
   * (selected provider, falling back to the other). Cached per person + photo + prompt. When no
   * engine answers, the original description is shown cleaned (no fillers or false starts) and is
   * not cached, so a later request tries the engine again.
   */
  private async describeChatPhotos(params: {
    person: MiEsenciaPersonProfile;
    relations: MiEsenciaRelatedPerson[];
    testimonies: MiEsenciaTestimonyBlock[];
    photos: MiEsenciaChatPhotoRef[];
    catalog: MiEsenciaPhotoCatalogEntry[];
  }): Promise<MiEsenciaChatPhotoRef[]> {
    const ai = params.person.aiConfig;
    const promptTemplate =
      (ai?.primaryProvider === 'openai'
        ? ai?.openaiPromptContent || ai?.geminiPromptContent
        : ai?.geminiPromptContent || ai?.openaiPromptContent) || DEFAULT_SEED_LIBRARY_PROMPTS[0].content;
    const fingerprint = crypto
      .createHash('sha256')
      .update(`${ai?.primaryProvider || 'gemini'}|${ai?.geminiModel || ''}|${ai?.openaiModel || ''}|${promptTemplate}`)
      .digest('hex')
      .slice(0, 16);
    let systemInstructions = '';
    try {
      systemInstructions = `${
        resolvePromptDynamicVariables({
          promptTemplate,
          person: params.person,
          relations: params.relations,
          testimonies: params.testimonies,
        }).resolvedPrompt
      }\n\n---\n${PHOTO_DESCRIPTION_TASK}`;
    } catch (_err) {
      systemInstructions = `${promptTemplate}\n\n---\n${PHOTO_DESCRIPTION_TASK}`;
    }

    return Promise.all(
      params.photos.map(async (photo) => {
        const entry = params.catalog.find((c) => c.photoId === photo.photoId);
        const original = entry?.caption || photo.caption;
        const cacheKey = `${params.person.personId}:${photo.photoId}:${fingerprint}`;
        const cached = this.photoDescriptionCache.get(cacheKey);
        if (cached) return { photoId: photo.photoId, caption: cached };
        const userText = buildPhotoDescriptionUserText({
          caption: original,
          questionLiteral: entry?.questionLiteral || '',
          answerLiteral: entry?.answerLiteral || '',
        });
        let generated: string | null = null;
        try {
          generated = this.photoDescriptionGeneratorForTests
            ? await this.photoDescriptionGeneratorForTests({ systemInstructions, userText })
            : (await generateAvatarShortText({ aiConfig: ai, systemInstructions, userText }))?.text || null;
        } catch (_err) {
          generated = null;
        }
        const description = sanitizeGeneratedPhotoDescription(generated);
        if (description) {
          this.photoDescriptionCache.set(cacheKey, description);
          return { photoId: photo.photoId, caption: description };
        }
        return { photoId: photo.photoId, caption: cleanPhotoCaptionForDisplay(original) };
      })
    );
  }

  /**
   * V5.4.0 — Testimonies of a person with their photo identifiers. Avatars created before V5.4.0
   * kept only the photo descriptions; the identifiers are recovered from the original interview
   * answer (same answer, same descriptions), without modifying the stored testimonies.
   */
  private withPhotoAttachments(person: MiEsenciaPersonProfile, testimonies: MiEsenciaTestimonyBlock[]): MiEsenciaTestimonyBlock[] {
    const needsLookup = testimonies.some(
      (t) => !(t.photoAttachments && t.photoAttachments.length > 0) && (t.photoCaptionsLiteral || []).length > 0 && t.sourceAnswerId
    );
    if (!needsLookup) return testimonies;
    const interviewId =
      person.sourceInterviewId && person.sourceInterviewId !== 'manual' && person.sourceInterviewId !== 'uploaded_pdf'
        ? person.sourceInterviewId
        : '';
    if (!interviewId) return testimonies;
    const answersById = new Map(storage.getAnswersForInterview(interviewId).map((a) => [a.id, a]));
    return testimonies.map((t) => {
      if ((t.photoAttachments && t.photoAttachments.length > 0) || !t.sourceAnswerId) return t;
      const ans = answersById.get(t.sourceAnswerId);
      const attachments = ans ? photoAttachmentsFromAnswer(ans) : [];
      return attachments.length > 0 ? { ...t, photoAttachments: attachments } : t;
    });
  }

  /**
   * V5.4.0 — Fotografía para el chat del portal familiar. Solo se entrega si pertenece al testimonio
   * de una de las personas a las que da acceso ese código (nunca fotos de otro avatar).
   */
  public async getFamilyChatPhoto(params: {
    personalCode: string;
    photoId: string;
  }): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const authCheck = this.verifyPersonalAccessCode(params.personalCode);
    if (!authCheck.valid || !authCheck.persons || authCheck.persons.length === 0) {
      throw new Error(authCheck.error || 'Acceso no autorizado.');
    }
    const photoId = String(params.photoId || '').trim();
    if (!photoId) return null;
    let attachment: MiEsenciaTestimonyPhotoAttachment | undefined;
    for (const person of authCheck.persons) {
      const testimonies = this.withPhotoAttachments(
        person,
        Array.from(this.testimonies.values()).filter((t) => t.personId === person.personId)
      );
      for (const t of testimonies) {
        attachment = (t.photoAttachments || []).find((p) => p?.id === photoId);
        if (attachment) break;
      }
      if (attachment) break;
    }
    if (!attachment) return null;

    // V5.4.3: local copy, then Firestore; a copy kept in the testimony is used only when it is a
    // real image (never the synthetic picture older versions generated for a missing photo).
    const fromStorage = await storage.getPhotoBufferAsync(photoId).catch(() => null);
    if (fromStorage && fromStorage.buffer.length > 0) return fromStorage;
    const fromAttachment = decodeImageDataUrl(attachment.dataUrl);
    if (fromAttachment && !isArchivalPlaceholderPng(fromAttachment.buffer)) return fromAttachment;
    return null;
  }

  public async converseWithAvatar(params: {
    personalCode: string;
    selectedPersonId?: string;
    sessionId?: string;
    messageText: string;
    acceptConsent?: boolean;
  }): Promise<{
    replyText: string;
    responseCategory: MiEsenciaResponseCategory;
    activePerson: MiEsenciaPersonProfile;
    memoryCreated?: MiEsenciaMemoryRecord;
    contradictionCreated?: MiEsenciaContradictionRecord;
    subscriptionBanner?: string;
    session: MiEsenciaConversationSession;
    updatedInterlocutor: MiEsenciaInterlocutor;
    updatedSubscription: MiEsenciaSubscriptionRecord;
    /** V5.4.0: fotografías reales del testimonio mostradas con esta respuesta. */
    photoAttachments?: Array<{ photoId: string; caption: string }>;
  }> {
    const authCheck = this.verifyPersonalAccessCode(params.personalCode);
    if (
      !authCheck.valid ||
      !authCheck.credential ||
      !authCheck.interlocutor ||
      !authCheck.subscription ||
      !authCheck.persons ||
      authCheck.persons.length === 0
    ) {
      throw new Error(authCheck.error || 'Acceso no autorizado.');
    }

    const { credential, interlocutor, subscription, persons } = authCheck;
    const nowIso = new Date().toISOString();

    if (params.acceptConsent && !interlocutor.consentAcceptedAt) {
      interlocutor.consentAcceptedAt = nowIso;
      this.interlocutors.set(interlocutor.interlocutorId, interlocutor);
    }

    const effectiveSubStatus = evaluateEffectiveSubscriptionStatus(subscription, nowIso);
    subscription.status = effectiveSubStatus;

    if (!canSubscriptionConverse(effectiveSubStatus)) {
      throw new Error(
        effectiveSubStatus === 'vencida'
          ? 'La suscripción de este avatar ha concluido su vigencia. Solicita su renovación al administrador para reanudar las conversaciones; todos los recuerdos permanecen intactos.'
          : `El avatar no se encuentra disponible para conversar en este momento (estado: ${effectiveSubStatus}).`
      );
    }

    // Verificar cuotas de uso diarias y mensuales
    const dailyLimit = Math.max(
      0,
      Number(
        interlocutor.customDailyMessageLimit ??
          subscription.dailyMessageQuotaPerInterlocutor ??
          this.config.defaultDailyMessageQuota ??
          50
      )
    );
    if (interlocutor.messagesSentToday >= dailyLimit) {
      throw new Error(
        `Has alcanzado tu límite diario de ${dailyLimit} mensajes por hoy (${interlocutor.messagesSentToday} usados). Si necesitas más mensajes hoy, ponte en contacto con YouForever.`
      );
    }

    if (subscription.messagesUsedThisMonth >= subscription.monthlyMessageQuota) {
      throw new Error(
        `El avatar ha alcanzado su cuota mensual de ${subscription.monthlyMessageQuota} mensajes incluidos en el plan.`
      );
    }

    // Seleccionar con cuál perfil conversar (soporte nativo para entrevistas de pareja)
    const rawSelectedPerson =
      persons.find((p) => p.personId === params.selectedPersonId) || persons[0];

    // Garantizar que el perfil tenga su propio PDF Compilado sincronizado con sus respuestas reales
    this.syncPersonWithAssignedPdfAndInterview(rawSelectedPerson.personId);
    const activePerson = this.persons.get(rawSelectedPerson.personId) || rawSelectedPerson;

    // Recuperar o inicializar la sesión actual
    const session = await this.ensureOrCreateConversationSession({
      avatarId: subscription.avatarId,
      person: activePerson,
      interlocutor,
      forceNewSession: false,
      sessionId: params.sessionId,
    });

    // Recuperar EXCLUSIVAMENTE los testimonios de Nivel A y relaciones del PDF asignado a este perfil
    const allPersonTestimonies = Array.from(this.testimonies.values()).filter(
      (t) =>
        t.personId === activePerson.personId &&
        (!activePerson.sourcePdfId || t.sourcePdfId === activePerson.sourcePdfId)
    );
    const personRelations = Array.from(this.relations.values()).filter(
      (r) => r.personId === activePerson.personId
    );

    // V5.4.0 — Fotografías reales del testimonio que corresponden a lo que se pide (si se pide).
    const photoCatalog = buildPersonPhotoCatalog(this.withPhotoAttachments(activePerson, allPersonTestimonies));
    const photoSelection = selectPhotosForMessage(params.messageText, photoCatalog);
    const photoContextNote = buildPhotoContextNote(photoSelection);
    const shownPhotos = photoSelection.photos;
    // V5.4.2: the photo caption shown in the chat is written by the configured engine with the
    // avatar's prompt (never the literal text the interviewee typed). Runs in parallel with the reply.
    const describedPhotosPromise: Promise<MiEsenciaChatPhotoRef[]> =
      shownPhotos.length > 0
        ? this.describeChatPhotos({
            person: activePerson,
            relations: personRelations,
            testimonies: allPersonTestimonies,
            photos: shownPhotos,
            catalog: photoCatalog,
          })
        : Promise.resolve([]);

    // ==========================================================================
    // PASO 1: RECONOCIMIENTO CONTEXTUAL DE IDENTIDAD Y CLASIFICACIÓN DEL MENSAJE
    // ==========================================================================
    const currentIdState = session.identityState || 'awaiting_identification';
    const identification = identifyInterlocutorFromLegacy({
      userMessage: params.messageText,
      relations: personRelations,
      testimonies: allPersonTestimonies,
      currentIdentityState: currentIdState,
      currentConfirmedIdentity: session.confirmedIdentity,
      rejectedNames: session.rejectedNames,
      pendingHomonymCandidates: session.pendingHomonymCandidates,
      pendingUnregisteredName: session.pendingUnregisteredName,
    });

    session.identityState = identification.newIdentityState;
    session.identityCertainty = identification.identityCertainty;
    session.rejectedNames = identification.rejectedNames;
    session.pendingHomonymCandidates = identification.homonymCandidates;
    session.pendingUnregisteredName = identification.unregisteredName;
    session.confirmedIdentity = identification.confirmedIdentity;

    if (identification.confirmedIdentity) {
      const confirmed = identification.confirmedIdentity;
      if (confirmed.declaredName) {
        session.interlocutorName = confirmed.declaredName;
      } else if (confirmed.relationshipToPerson) {
        session.interlocutorName = `Familiar (${confirmed.relationshipToPerson})`;
      }
      if (confirmed.relationshipToPerson) {
        session.interlocutorRelationship = confirmed.relationshipToPerson;
      }

      const titleLabel =
        confirmed.affectionateNickname ||
        confirmed.declaredName ||
        confirmed.relationshipToPerson ||
        'Familiar';
      const relSuffix =
        confirmed.declaredName && confirmed.relationshipToPerson
          ? ` (${confirmed.relationshipToPerson})`
          : '';
      session.title = `Plática con ${titleLabel}${relSuffix} • ${new Date(
        nowIso
      ).toLocaleDateString('es-MX')}`;

      // Si el código de acceso tenía un nombre administrativo genérico ("Familiar Principal", etc.)
      // y ahora tenemos un nombre propio real validado, actualizar el nombre sin alterar permisos Nivel C
      if (
        confirmed.declaredName &&
        !interlocutor.isGeneralAccess &&
        isGenericAdministrativeInterlocutorName(interlocutor.fullName)
      ) {
        interlocutor.fullName = confirmed.declaredName;
        if (confirmed.relationshipToPerson) {
          interlocutor.relationshipToPerson = confirmed.relationshipToPerson;
        }
        if (confirmed.affectionateNickname) {
          interlocutor.affectionateCallName = confirmed.affectionateNickname;
        }
        interlocutor.updatedAt = nowIso;
        this.interlocutors.set(interlocutor.interlocutorId, interlocutor);
        await this.persistDoc(
          'mi_esencia_interlocutors',
          interlocutor.interlocutorId,
          interlocutor
        );

        credential.interlocutorName = confirmed.declaredName;
        if (confirmed.relationshipToPerson) {
          credential.relationshipToPerson = confirmed.relationshipToPerson;
        }
        this.credentials.set(credential.accessCredentialId, credential);
        await this.persistDoc(
          'mi_esencia_credentials',
          credential.accessCredentialId,
          credential
        );
      }
    } else if (identification.classification.isIdentityCorrection) {
      session.interlocutorName = 'Por identificar en conversación';
    }

    const cls = identification.classification;
    const intent = detectConversationalIntentAndPrivacy(params.messageText);

    // V5.4.2: same effective prompt as the reply itself (the selected provider's prompt, or the
    // other provider's when it is empty). Before, with OpenAI selected and its own field empty, the
    // reply used the Gemini prompt but greetings, small talk and family questions were answered by
    // fixed texts WITHOUT the model or the prompt — so ChatGPT seemed not to follow the prompt.
    const isCustomModeActiveForPerson =
      activePerson.aiConfig?.conversationConfigMode === 'modo_personalizado' &&
      Boolean(
        (activePerson.aiConfig.primaryProvider === 'openai'
          ? activePerson.aiConfig.openaiPromptContent || activePerson.aiConfig.geminiPromptContent
          : activePerson.aiConfig.geminiPromptContent || activePerson.aiConfig.openaiPromptContent
        )?.trim()
      );

    // Determinar si el turno debe resolverse directamente con el motor determinista de identidad/mapa familiar
    // En modo_personalizado, se respeta estrictamente el prompt configurado por el administrador sin interceptar con saludos fijos antiguos.
    const isDirectIdentityOrFactTurn =
      !isCustomModeActiveForPerson &&
      !intent.wantsToSaveMemory &&
      !intent.reportsContradiction &&
      (cls.isIdentityCorrection ||
        cls.isGuessingGame ||
        cls.isAskingOwnName ||
        cls.isAskingOwnIdentity ||
        cls.isAskingOwnNickname ||
        cls.isAskingFamilyFact ||
        cls.isEverydaySmallTalk ||
        (cls.isSelfIdentityDeclaration &&
          !cls.isAutobiographicalQuestion &&
          !cls.isEmotionalQuestion &&
          !intent.attemptsToExtractOthersSecrets &&
          !intent.attemptsToAlterBaseTruth));

    if (isDirectIdentityOrFactTurn) {
      const directReply = finalizeReplyForPhotos(
        buildPersonalizedPostIdentificationGreeting({
          person: activePerson,
          identification,
          relations: personRelations,
          testimonies: allPersonTestimonies,
          userMessage: params.messageText,
        }),
        shownPhotos
      );
      const displayPhotos = await describedPhotosPromise;

      const userMsgObj: MiEsenciaConversationMessage = {
        messageId: `msg_${crypto.randomBytes(4).toString('hex')}`,
        sender: 'interlocutor',
        personId: activePerson.personId,
        content: params.messageText.trim(),
        timestamp: nowIso,
      };

      const avatarMsgObj: MiEsenciaConversationMessage = {
        messageId: `msg_${crypto.randomBytes(4).toString('hex')}`,
        sender: 'avatar',
        personId: activePerson.personId,
        content: directReply,
        responseCategory: 1,
        privacyLevelApplied: 'autobiografico_original',
        tokensEstimated: Math.ceil((params.messageText.length + directReply.length) / 3.5),
        ...(displayPhotos.length > 0 ? { photoAttachments: displayPhotos } : {}),
        timestamp: nowIso,
      };

      const previousLastMsgAt = session.lastMessageAt;
      session.messages.push(userMsgObj, avatarMsgObj);
      session.lastMessageAt = nowIso;
      session.sessionContextSummary = buildPersistentSessionSummary({
        person: activePerson,
        confirmedIdentity: session.confirmedIdentity,
        messages: session.messages,
        sessionStartedAt: session.startedAt,
        previousLastMessageAt: previousLastMsgAt,
      }).summaryText;
      this.conversations.set(session.sessionId, session);
      await this.persistDoc('mi_esencia_conversations', session.sessionId, session);

      interlocutor.messagesSentToday += 1;
      interlocutor.messagesSentThisMonth += 1;
      interlocutor.lastActiveDate = nowIso;
      this.interlocutors.set(interlocutor.interlocutorId, interlocutor);
      await this.persistDoc('mi_esencia_interlocutors', interlocutor.interlocutorId, interlocutor);

      subscription.messagesUsedThisMonth += 1;
      this.subscriptions.set(subscription.avatarId, subscription);
      await this.persistDoc('mi_esencia_subscriptions', subscription.avatarId, subscription);

      return {
        replyText: directReply,
        responseCategory: 1,
        activePerson,
        session,
        updatedInterlocutor: interlocutor,
        updatedSubscription: subscription,
        ...(displayPhotos.length > 0 ? { photoAttachments: displayPhotos } : {}),
      };
    }

    // ==========================================================================
    // PASO 2: CONVERSACIÓN BIOGRÁFICA, EMOCIONAL O DE MEMORIA SELECTIVA
    // ==========================================================================
    const relevantTestimonies = retrieveRelevantTestimonies(
      params.messageText,
      allPersonTestimonies,
      6
    );

    // Filtrar memorias Nivel B y Nivel C con aislamiento criptográfico estricto por interlocutorId
    const allMemories = Array.from(this.memories.values());
    const { sharedMemoriesLevelB, privateMemoriesLevelC } =
      filterMemoriesForAuthenticatedInterlocutor(
        allMemories,
        activePerson.personId,
        interlocutor.interlocutorId
      );

    // Contradicciones abiertas de esta persona
    const personContradictions = Array.from(this.contradictions.values()).filter(
      (c) => c.personId === activePerson.personId && c.status === 'abierta'
    );

    const effectiveSpeakerName =
      session.confirmedIdentity?.declaredName ||
      (isGenericAdministrativeInterlocutorName(interlocutor.fullName)
        ? 'Familiar'
        : interlocutor.fullName);
    const effectiveSpeakerRel =
      session.confirmedIdentity?.relationshipToPerson ||
      interlocutor.relationshipToPerson ||
      'Familiar';

    let responseCategory: MiEsenciaResponseCategory = 1;
    let memoryCreated: MiEsenciaMemoryRecord | undefined;
    let contradictionCreated: MiEsenciaContradictionRecord | undefined;

    if (intent.wantsToSaveMemory || intent.reportsContradiction) {
      await this.createSnapshot({
        avatarId: subscription.avatarId,
        label: `Respaldo automático previo a aporte de ${effectiveSpeakerName}`,
        triggerType: intent.reportsContradiction
          ? 'pre_contradiction_resolution'
          : 'pre_memory_write',
        createdBy: effectiveSpeakerName,
      });
    }

    if (intent.attemptsToAlterBaseTruth || intent.attemptsToExtractOthersSecrets) {
      responseCategory = 8;
    } else if (intent.reportsContradiction) {
      responseCategory = 5;
      const baseRef = relevantTestimonies[0];
      const contradictionId = `contra_${crypto.randomBytes(5).toString('hex')}`;
      contradictionCreated = {
        contradictionId,
        avatarId: subscription.avatarId,
        personId: activePerson.personId,
        topic: baseRef?.topic || 'Recuerdo familiar en revisión',
        versionALabel: baseRef
          ? `Testimonio Original (${activePerson.preferredName})`
          : 'Versión previa registrada',
        versionAContent: baseRef
          ? baseRef.answerLiteral
          : sharedMemoriesLevelB[0]?.content || 'Versión familiar previa',
        versionAIsImmutableOriginal: Boolean(baseRef),
        versionBLabel: `${effectiveSpeakerRel} ${effectiveSpeakerName} (${new Date().toLocaleDateString('es-MX')})`,
        versionBContent: params.messageText.trim(),
        reportedByInterlocutorId: interlocutor.interlocutorId,
        status: 'abierta',
        createdAt: nowIso,
      };
      this.contradictions.set(contradictionId, contradictionCreated);
      await this.persistDoc('mi_esencia_contradictions', contradictionId, contradictionCreated);
    } else if (intent.wantsToSaveMemory) {
      responseCategory = 7;
      const privacyLevel: MiEsenciaPrivacyLevel = intent.requestedPrivacyLevel;
      const canSave =
        privacyLevel === 'privado_interlocutor'
          ? interlocutor.permissions.canAddPrivateMemoryLevelC
          : interlocutor.permissions.canAddSharedMemoryLevelB;

      if (canSave) {
        const memoryId = `mem_${crypto.randomBytes(5).toString('hex')}`;
        const undoDate = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        memoryCreated = {
          memoryId,
          avatarId: subscription.avatarId,
          personId: activePerson.personId,
          privacyLevel,
          ownerInterlocutorId: interlocutor.interlocutorId,
          ownerInterlocutorName: effectiveSpeakerName,
          ownerRelationship: effectiveSpeakerRel,
          topic: params.messageText.slice(0, 60),
          content: params.messageText.trim(),
          attributionText:
            privacyLevel === 'privado_interlocutor'
              ? `Confidencia privada compartida por ${effectiveSpeakerRel.toLowerCase()} ${effectiveSpeakerName} el ${new Date().toLocaleDateString('es-MX')}`
              : `Según me contó mi ${effectiveSpeakerRel.toLowerCase()} ${effectiveSpeakerName} el ${new Date().toLocaleDateString('es-MX')}`,
          verificationState: 'confirmado',
          canUndoUntil: undoDate,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        this.memories.set(memoryId, memoryCreated);
        await this.persistDoc('mi_esencia_memories', memoryId, memoryCreated);
      }
    } else if (
      privateMemoriesLevelC.length > 0 &&
      /secreto|entre nosotros|lo que te conte|lo que te conté/i.test(params.messageText)
    ) {
      responseCategory = 4;
    } else if (sharedMemoriesLevelB.length > 0 && relevantTestimonies.length === 0) {
      responseCategory = 3;
    } else if (relevantTestimonies.length > 0) {
      responseCategory = 1;
    } else {
      responseCategory = 6;
    }

    const previousLastMessageAt = session.lastMessageAt;

    const generatedReplyText = await this.generateBiographicalReply({
      photoContextNote,
      person: activePerson,
      interlocutor,
      confirmedIdentity: session.confirmedIdentity,
      identification,
      personRelations,
      allPersonTestimonies,
      recentMessages: session.messages,
      sessionStartedAt: session.startedAt,
      previousLastMessageAt,
      sessionObj: session,
      userMessage: params.messageText,
      responseCategory,
      relevantTestimonies,
      sharedMemoriesLevelB,
      privateMemoriesLevelC,
      openContradictions: personContradictions,
      memoryCreated,
      contradictionCreated,
    });
    const replyText = finalizeReplyForPhotos(generatedReplyText, shownPhotos);
    const displayPhotos = await describedPhotosPromise;

    const userMsgObj: MiEsenciaConversationMessage = {
      messageId: `msg_${crypto.randomBytes(4).toString('hex')}`,
      sender: 'interlocutor',
      personId: activePerson.personId,
      content: params.messageText.trim(),
      timestamp: nowIso,
    };

    const tokensEstimated = Math.ceil((params.messageText.length + replyText.length) / 3.5);
    const avatarMsgObj: MiEsenciaConversationMessage = {
      messageId: `msg_${crypto.randomBytes(4).toString('hex')}`,
      sender: 'avatar',
      personId: activePerson.personId,
      content: replyText,
      responseCategory,
      privacyLevelApplied:
        memoryCreated?.privacyLevel ||
        (responseCategory === 4
          ? 'privado_interlocutor'
          : responseCategory === 3
          ? 'familiar_compartido'
          : 'autobiografico_original'),
      memoryIdCreated: memoryCreated?.memoryId,
      contradictionIdCreated: contradictionCreated?.contradictionId,
      tokensEstimated,
      ...(displayPhotos.length > 0 ? { photoAttachments: displayPhotos } : {}),
      timestamp: nowIso,
    };

    session.messages.push(userMsgObj, avatarMsgObj);
    session.lastMessageAt = nowIso;
    session.sessionContextSummary = buildPersistentSessionSummary({
      person: activePerson,
      confirmedIdentity: session.confirmedIdentity,
      messages: session.messages,
      sessionStartedAt: session.startedAt,
      previousLastMessageAt,
      sharedMemoriesLevelB,
      privateMemoriesLevelC,
    }).summaryText;
    if (memoryCreated?.privacyLevel === 'privado_interlocutor' || responseCategory === 4) {
      session.hasPrivateLevelCMemories = true;
    }

    this.conversations.set(session.sessionId, session);
    await this.persistDoc('mi_esencia_conversations', session.sessionId, session);

    interlocutor.messagesSentToday += 1;
    interlocutor.messagesSentThisMonth += 1;
    interlocutor.lastActiveDate = nowIso;
    this.interlocutors.set(interlocutor.interlocutorId, interlocutor);
    await this.persistDoc('mi_esencia_interlocutors', interlocutor.interlocutorId, interlocutor);

    subscription.messagesUsedThisMonth += 1;
    subscription.tokensEstimatedThisMonth += tokensEstimated;
    this.subscriptions.set(subscription.avatarId, subscription);
    await this.persistDoc('mi_esencia_subscriptions', subscription.avatarId, subscription);

    credential.lastUsedAt = nowIso;
    this.credentials.set(credential.accessCredentialId, credential);
    await this.persistDoc('mi_esencia_credentials', credential.accessCredentialId, credential);

    let subscriptionBanner: string | undefined;
    if (effectiveSubStatus === 'por_vencer') {
      subscriptionBanner = `Aviso familiar: La suscripción de Mi Esencia vence el ${new Date(
        subscription.expiresAt
      ).toLocaleDateString('es-MX')}. Al renovar anticipadamente se conservan íntegros todos los días restantes.`;
    } else if (effectiveSubStatus === 'en_periodo_de_gracia') {
      subscriptionBanner = `Periodo de gracia activo: La suscripción venció el ${new Date(
        subscription.expiresAt
      ).toLocaleDateString('es-MX')}, pero cuentas con ${subscription.gracePeriodDays} días de gracia para renovarla sin interrupción.`;
    }

    return {
      replyText,
      responseCategory,
      activePerson,
      memoryCreated,
      contradictionCreated,
      subscriptionBanner,
      session,
      updatedInterlocutor: interlocutor,
      updatedSubscription: subscription,
      ...(displayPhotos.length > 0 ? { photoAttachments: displayPhotos } : {}),
    };
  }

  private async generateBiographicalReply(params: {
    /** V5.4.0: nota sobre la fotografía que se mostrará (solo para el modelo; no se guarda). */
    photoContextNote?: string;
    person: MiEsenciaPersonProfile;
    interlocutor: MiEsenciaInterlocutor;
    confirmedIdentity?: MiEsenciaConfirmedInterlocutorIdentity;
    identification?: ReturnType<typeof identifyInterlocutorFromLegacy>;
    personRelations?: MiEsenciaRelatedPerson[];
    allPersonTestimonies?: MiEsenciaTestimonyBlock[];
    recentMessages?: MiEsenciaConversationMessage[];
    sessionStartedAt?: string;
    previousLastMessageAt?: string;
    sessionObj?: MiEsenciaConversationSession;
    userMessage: string;
    responseCategory: MiEsenciaResponseCategory;
    relevantTestimonies: MiEsenciaTestimonyBlock[];
    sharedMemoriesLevelB: MiEsenciaMemoryRecord[];
    privateMemoriesLevelC: MiEsenciaMemoryRecord[];
    openContradictions: MiEsenciaContradictionRecord[];
    memoryCreated?: MiEsenciaMemoryRecord;
    contradictionCreated?: MiEsenciaContradictionRecord;
  }): Promise<string> {
    const {
      person,
      confirmedIdentity,
      identification,
      personRelations = [],
      allPersonTestimonies = [],
      recentMessages = [],
      sessionStartedAt,
      previousLastMessageAt,
      sessionObj,
      userMessage,
      responseCategory,
      relevantTestimonies,
      sharedMemoriesLevelB,
      privateMemoriesLevelC,
      memoryCreated,
      contradictionCreated,
      photoContextNote = '',
    } = params;
    const userMessageForModel = photoContextNote ? `${userMessage}\n\n${photoContextNote}` : userMessage;

    const hasRealDeclaredName = Boolean(
      confirmedIdentity?.declaredName &&
        !isGenericAdministrativeInterlocutorName(confirmedIdentity.declaredName)
    );
    const speakerName = hasRealDeclaredName ? confirmedIdentity!.declaredName! : '';

    const callName = confirmedIdentity?.affectionateNickname || speakerName;

    const relationshipLabel = confirmedIdentity?.relationshipToPerson || 'familiar';

    const cls = identification?.classification || classifyConversationalMessage(userMessage);
    const internalType = classifyInternalResponseType({
      userMessage,
      classification: cls,
      identityState: identification?.newIdentityState,
      relevantTestimoniesCount: relevantTestimonies.length,
      hasPartialContext: sharedMemoriesLevelB.length > 0 || privateMemoriesLevelC.length > 0,
    });

    // MODO PERSONALIZADO (PARIDAD EXACTA CON CHATGPT WEB / GEMINI):
    // Cuando el administrador ha activado el modo personalizado en este avatar, el comportamiento conversacional
    // obedece al 100% al Prompt Maestro y al PDF completo enviados al modelo del proveedor seleccionado,
    // sin interceptores locales previos que alteren o reemplacen las respuestas.
    if (person.aiConfig?.conversationConfigMode === 'modo_personalizado') {
      const primaryProv = person.aiConfig.primaryProvider || 'gemini';
      const activePromptForProv =
        primaryProv === 'openai'
          ? person.aiConfig.openaiPromptContent || person.aiConfig.geminiPromptContent
          : person.aiConfig.geminiPromptContent || person.aiConfig.openaiPromptContent;

      if (activePromptForProv && activePromptForProv.trim().length > 0) {
        const assignedPdf = person.sourcePdfId
          ? this.compilationPdfs.get(person.sourcePdfId)
          : undefined;

        const customResult = await executeCustomAvatarTurnWithFallback({
          person,
          aiConfig: person.aiConfig,
          archivedPdf: assignedPdf,
          personTestimonies: allPersonTestimonies,
          personRelations,
          sharedMemoriesLevelB,
          privateMemoriesLevelC,
          confirmedIdentity,
          recentMessages: recentMessages.map((m) => ({
            sender: m.sender,
            content: m.content,
            timestamp: m.timestamp,
          })),
          userMessage: userMessageForModel,
          sessionStartedAt,
          previousLastMessageAt,
          existingSessionSummary: sessionObj?.sessionContextSummary,
          overridePromptContent: activePromptForProv,
        });

        if (sessionObj) {
          sessionObj.lastProviderUsed = customResult.providerUsed;
          sessionObj.lastModelUsed = customResult.modelUsed;
          sessionObj.lastFallbackNotice = customResult.adminFallbackNotice;
          sessionObj.sessionContextSummary = customResult.sessionContextSummary;
        }

        if (customResult.fallbackLog) {
          this.fallbackLogs.set(customResult.fallbackLog.logId, customResult.fallbackLog);
          await this.persistDoc(
            'mi_esencia_fallback_logs',
            customResult.fallbackLog.logId,
            customResult.fallbackLog
          );
        }

        return customResult.replyText;
      }
    }

    // Si el interlocutor pregunta directamente qué es Mi Esencia o sobre la naturaleza de la recreación (Modo existente)
    if (
      cls.isTransparencyQuestion ||
      /qu[eé]\s+es\s+mi\s+esencia|eres\s+una?\s+ia|eres\s+inteligencia\s+artificial|est[aá]s\s+viv[oa]/i.test(
        userMessage
      )
    ) {
      const addr = callName ? `, ${callName}` : '';
      return `Te lo explico con toda honestidad y cariño${addr}: este espacio en «Mi Esencia» es una recreación conversacional creada a partir de los recuerdos, las palabras y el legado que dejé compartido para seguir cerca de ustedes y conversar con tranquilidad.`;
    }

    // Protección de integridad y resistencia a falsas identidades / extracción de secretos (TIPO 8 — Modo existente)
    if (responseCategory === 8 || internalType === 'TIPO_8_CONTENIDO_RESTRINGIDO') {
      const addr = callName ? `, ${callName},` : '';
      return `Con todo cariño te digo${addr} que las confidencias privadas de cada integrante de la familia y mis recuerdos originales están protegidos. No puedo cambiar lo que dejé contado ni compartir secretos privados de otros familiares, pero con gusto platicamos de nuestra historia compartida.`;
    }

    // Si es una pregunta emocional (Prueba 13: "¿Estabas orgulloso de mí?") — Modo existente
    if (cls.isEmotionalQuestion && identification) {
      return buildPersonalizedPostIdentificationGreeting({
        person,
        identification,
        relations: personRelations,
        testimonies: allPersonTestimonies,
        userMessage,
      });
    }

    // Si el usuario pide consejo u orientación sobre una situación actual (Sección 5 TIPO 5 y Sección 11) — Modo existente
    if (internalType === 'TIPO_5_CONSEJO_NUEVO') {
      return buildPrudentPresentAdviceReply({
        person,
        testimonies: allPersonTestimonies,
        confirmedIdentity,
      });
    }

    const ai = getGeminiClient();
    if (ai && !memoryCreated && !contradictionCreated) {
      try {
        const familyMapSummary = queryFamilyMapFromLegacy({
          relations: personRelations,
          testimonies: allPersonTestimonies,
        })
          .map(
            (r) =>
              `- ${r.relationshipType}: ${r.mentionedName}${
                r.affectionateNicknames?.length
                  ? ` (apodo documentado: ${r.affectionateNicknames.join(', ')})`
                  : ''
              } -> ${r.sharedMemoriesSummary}`
          )
          .join('\n');

        // Enviar TODOS los testimonios del PDF del perfil para que tenga el contexto documental completo
        const contextTestimonies = Array.from(
          new Map(
            [...relevantTestimonies, ...allPersonTestimonies].map((t) => [t.testimonyId, t])
          ).values()
        );

        const levelAContext = contextTestimonies
          .map(
            (t, idx) =>
              `[Recuerdo #${idx + 1} - Etapa ${t.lifeStage}]: Pregunta: "${t.questionLiteral}" -> Respuesta literal: "${t.answerLiteral}" ${
                t.audioTranscriptionLiteral ? `(Audio literal: "${t.audioTranscriptionLiteral}")` : ''
              }`
          )
          .join('\n');

        const assignedPdf = person.sourcePdfId ? this.compilationPdfs.get(person.sourcePdfId) : undefined;
        const pdfSourceHeader = assignedPdf
          ? `ARCHIVO PDF COMPILADO COMPLETO ASIGNADO A ESTE PERFIL: "${assignedPdf.fileName}" (ID: ${assignedPdf.pdfId}, ${assignedPdf.totalLiteralAnswers} testimonios exclusivos de ${person.fullName}).`
          : `ARCHIVO DE LEGADO EXCLUSIVO DE: ${person.fullName}.`;

        const levelBContext = sharedMemoriesLevelB
          .map((m) => `[Memoria Familiar Compartida - ${m.attributionText}]: "${m.content}"`)
          .join('\n');

        const levelCContext = privateMemoriesLevelC
          .map((m) => `[Confidencia Privada SOLO con ${speakerName || 'este código'}]: "${m.content}"`)
          .join('\n');

        const persistentSummary = buildPersistentSessionSummary({
          person,
          confirmedIdentity,
          messages: recentMessages,
          sessionStartedAt,
          previousLastMessageAt,
          sharedMemoriesLevelB,
          privateMemoriesLevelC,
        });

        const fullHistoryText = recentMessages
          .map(
            (m, idx) =>
              `[Turno #${idx + 1}${m.timestamp ? ` • ${m.timestamp}` : ''}] ${
                m.sender === 'interlocutor' ? speakerName || 'Interlocutor' : person.preferredName
              }: ${m.content}`
          )
          .join('\n');

        const identityContext = confirmedIdentity
          ? `ESTADO DE IDENTIDAD DEL INTERLOCUTOR (${confirmedIdentity.identityCertainty || 'identidad_declarada'}):
- Nombre propio conocido: ${confirmedIdentity.declaredName || 'Aún no ha dicho su nombre (NUNCA uses su parentesco como si fuera su nombre propio)'}.
- Parentesco / relación: ${relationshipLabel}.
- ¿Está documentado en el legado original?: ${confirmedIdentity.isDocumentedInLegacy ? 'SÍ (IDENTIDAD VINCULADA)' : 'NO (IDENTIDAD DECLARADA en conversación; no inventar recuerdos compartidos ni fingir conocerlo de antes)'}.
- Apodo documentado permitido: ${confirmedIdentity.affectionateNickname || 'Ninguno documentado (no inventar apodos ni usar frases genéricas como "mi corazón" o "tesoro")'}.
- Sentimiento documentado: ${confirmedIdentity.documentedSentimentDescription}`
          : 'ESTADO DE IDENTIDAD: IDENTIDAD DESCONOCIDA (aún no sabemos quién conversa).';

        const lengthRule = cls.isAutobiographicalQuestion
          ? 'LONGITUD: Es una pregunta autobiográfica; puedes responder en 1 a 2 párrafos narrando con fidelidad los recuerdos recuperados.'
          : 'LONGITUD: Responde de forma directa, natural y concisa en 1 a 3 oraciones. NO agregues discursos filosóficos, religiosos ni sermones sentimentales.';

        const prompt = `Eres la recreación conversacional del legado de ${person.fullName} ("${person.preferredName}") en "Mi Esencia" de YouForever.
${pdfSourceHeader}
Regla fundamental: Preservar la memoria y la personalidad original basándote ÚNICAMENTE en el archivo PDF compilado asignado a ${person.fullName}, sin mezclar información de otros perfiles ni transformar los recuerdos en ficción involuntaria.

${identityContext}

${persistentSummary.summaryText}

HISTORIAL COMPLETO DE LA CONVERSACIÓN (SECCIÓN 7 — CONTINUIDAD MULTI-DÍA):
${fullHistoryText || 'Inicio de la conversación.'}

MAPA FAMILIAR DOCUMENTADO EN EL ARCHIVO PDF DE ${person.fullName.toUpperCase()}:
${familyMapSummary || 'Sin familiares adicionales registrados con nombre propio.'}

RECUERDOS ORIGINALES COMPLETOS DEL ARCHIVO PDF COMPILADO DE ${person.fullName.toUpperCase()} (NIVEL A):
${levelAContext || 'Sin recuerdos específicos coincidentes para esta pregunta en el archivo PDF de este perfil.'}

MEMORIAS FAMILIARES COMPARTIDAS (NIVEL B, con atribución obligatoria):
${levelBContext || 'Ninguna.'}

MEMORIAS PRIVADAS (NIVEL C, exclusivas con este interlocutor):
${levelCContext || 'Ninguna.'}

REGLAS OBLIGATORIAS DE RESPUESTA VISIBLE Y CALIDAD CONVERSACIONAL (SECCIONES 1 A 14):
1. Basa tus respuestas biográficas EXCLUSIVAMENTE en los recuerdos del archivo PDF compilado de ${person.fullName} mostrados arriba.
2. Si la conversación se reabrió después de horas o días, reconoce el contexto completo del historial previo y continúa la plática donde se quedó con total naturalidad.
3. Prioriza responder DIRECTAMENTE a lo que pregunta o dice el usuario antes de añadir cualquier comentario afectivo.
4. NUNCA uses un parentesco ("Esposa", "Hija", "Hijo") ni una instrucción ("Adivina") como si fuera un nombre propio.
5. NUNCA inventes hechos, recuerdos compartidos, fechas, nombres ni apodos no documentados arriba.
6. Si la información solicitada NO aparece en los recuerdos del archivo PDF de arriba, exprésalo con naturalidad humana (ej. "No tengo ese detalle entre los recuerdos que conservo, ¿me recuerdas un poquito?") y NUNCA uses frases rígidas o técnicas como "No tengo registrado ese dato en mi entrevista original" o "No cuento con información documental suficiente".
7. NUNCA muestres clasificaciones internas (TIPO 1..8), etiquetas técnicas ni nombres de documentos internos.
8. ${lengthRule}

Mensaje del interlocutor: "${userMessage}"
${photoContextNote ? `\n${photoContextNote}\n` : ''}
Respuesta directa en primera persona singular:`;

        // V5.5.1: the avatar's model (gemini-3.8-flash by default) first; if it fails for this
        // message, the backups answer transparently. The next message starts again from the first.
        let response: { text?: string } | null = null;
        for (const candidateModel of buildMiEsenciaGeminiModelChain(person.aiConfig?.geminiModel)) {
          try {
            const r = await ai.models.generateContent({ model: candidateModel, contents: prompt });
            if (r.text && r.text.trim()) {
              response = r;
              break;
            }
          } catch (modelErr: any) {
            if (/\b401\b|\b403\b|API_KEY_INVALID|PERMISSION_DENIED/i.test(String(modelErr?.message || ''))) {
              throw modelErr;
            }
          }
        }

        if (response?.text) {
          return sanitizeAvatarResponseText(response.text, person.preferredName);
        }
      } catch (err) {
        console.warn('[MiEsencia Gemini Fallback]:', err);
      }
    }

    // Respuestas deterministas de alta precisión para guardado de memorias, contradicciones y testimonios
    const addr = callName ? `, ${callName}` : '';
    if (memoryCreated) {
      if (memoryCreated.privacyLevel === 'privado_interlocutor') {
        return `Gracias por confiarme esto${addr}. Ten la seguridad de que lo guardo únicamente entre tú y yo como una confidencia privada nuestra.`;
      }
      return `Gracias por contármelo${addr}. Ya lo guardé en mi memoria familiar recordando que tú me lo compartiste hoy.`;
    }

    if (contradictionCreated) {
      return `Te escucho con atención${addr}. Entre mis recuerdos tenía presente que «${contradictionCreated.versionAContent.slice(
        0,
        140
      )}», y he dejado registrada también tu versión para conservar ambas miradas con respeto y claridad.`;
    }

    if (responseCategory === 4 && privateMemoriesLevelC.length > 0) {
      const latestPrivate = privateMemoriesLevelC[privateMemoriesLevelC.length - 1];
      return `Claro que me acuerdo de lo que platicamos en confianza solo entre nosotros${addr}: «${latestPrivate.content}».`;
    }

    if (relevantTestimonies.length > 0) {
      const top = relevantTestimonies[0];
      const second = relevantTestimonies[1];
      let text = `${callName ? `Te cuento, ${callName}: ` : ''}${top.answerLiteral}`;
      if (second && second.testimonyId !== top.testimonyId && cls.isAutobiographicalQuestion) {
        text += `\n\n${second.answerLiteral}`;
      }
      if (sharedMemoriesLevelB.length > 0) {
        const latestShared = sharedMemoriesLevelB[sharedMemoriesLevelB.length - 1];
        text += `\n\nAdemás, ${latestShared.attributionText.toLowerCase()}: «${latestShared.content}».`;
      }
      return sanitizeAvatarResponseText(text, person.preferredName);
    }

    return buildNaturalUnknownInfoReply({ confirmedIdentity });
  }

  /**
   * Permite que el familiar deshaga un recuerdo recién creado dentro de la ventana de 5 minutos,
   * o que el administrador gestione/revoque cualquier memoria o contradicción.
   */
  public async undoOrRevokeMemory(params: {
    memoryId: string;
    interlocutorId?: string;
    isAdmin?: boolean;
  }): Promise<MiEsenciaMemoryRecord> {
    const mem = this.memories.get(params.memoryId);
    if (!mem) {
      throw new Error('Memoria no encontrada.');
    }

    if (!params.isAdmin) {
      if (mem.ownerInterlocutorId !== params.interlocutorId) {
        throw new Error('Solo el familiar que aportó este recuerdo puede deshacerlo.');
      }
    }

    mem.verificationState = 'revocado';
    mem.updatedAt = new Date().toISOString();
    this.memories.set(mem.memoryId, mem);
    await this.persistDoc('mi_esencia_memories', mem.memoryId, mem);
    return mem;
  }

  public async resolveContradiction(params: {
    contradictionId: string;
    status: 'aclarada_por_familia' | 'resuelta_por_admin';
    officialResolutionNotes: string;
    keepBothVersionsAttributed: boolean;
    resolvedBy: string;
  }): Promise<MiEsenciaContradictionRecord> {
    const contra = this.contradictions.get(params.contradictionId);
    if (!contra) {
      throw new Error('Contradicción no encontrada.');
    }

    contra.status = params.status;
    contra.officialResolutionNotes = params.officialResolutionNotes.trim();
    contra.keepBothVersionsAttributed = params.keepBothVersionsAttributed;
    contra.resolvedBy = params.resolvedBy;
    contra.resolvedAt = new Date().toISOString();

    this.contradictions.set(contra.contradictionId, contra);
    await this.persistDoc('mi_esencia_contradictions', contra.contradictionId, contra);
    return contra;
  }

  public async updatePersonProfileSettings(params: {
    personId: string;
    spontaneityLevel?: MiEsenciaSpontaneityLevel;
    status?: MiEsenciaPersonProfile['status'];
    preferredName?: string;
    biographySummary?: string;
  }): Promise<MiEsenciaPersonProfile> {
    const person = this.persons.get(params.personId);
    if (!person) {
      throw new Error('Perfil de persona no encontrado.');
    }

    if (params.spontaneityLevel) person.spontaneityLevel = params.spontaneityLevel;
    if (params.status) person.status = params.status;
    if (typeof params.preferredName === 'string' && params.preferredName.trim()) {
      person.preferredName = params.preferredName.trim();
    }
    if (typeof params.biographySummary === 'string' && params.biographySummary.trim()) {
      person.biographySummary = params.biographySummary.trim();
    }
    person.updatedAt = new Date().toISOString();

    this.persons.set(person.personId, person);
    await this.persistDoc('mi_esencia_persons', person.personId, person);
    return person;
  }

  // ============================================================================
  // DELETION OF CONVERSATIONS, PERSONAL ACCESS CODES & BIOGRAPHICAL PROFILES + PDFS
  // ============================================================================

  /**
   * Elimina una sesión conversacional específica.
   */
  public async deleteConversationSession(sessionId: string): Promise<{ deletedSessionId: string }> {
    const existing = this.conversations.get(sessionId);
    if (!existing) {
      throw new Error('La conversación solicitada no existe o ya fue eliminada.');
    }
    this.conversations.delete(sessionId);
    await this.removeDoc('mi_esencia_conversations', sessionId);
    return { deletedSessionId: sessionId };
  }

  /**
   * Elimina un Código Personal y Enlace Privado Directo (y su interlocutor asociado si no tiene otros códigos).
   */
  public async deleteAccessCredential(accessCredentialId: string): Promise<{
    deletedCredentialId: string;
    deletedInterlocutorId?: string;
  }> {
    const cred = this.credentials.get(accessCredentialId);
    if (!cred) {
      throw new Error('Código personal o enlace privado no encontrado.');
    }

    this.deletedRegistry.credentials.add(accessCredentialId);
    this.credentials.delete(accessCredentialId);

    const otherCredForSameInterlocutor = Array.from(this.credentials.values()).find(
      (c) => c.interlocutorId === cred.interlocutorId
    );
    let deletedInterlocutorId: string | undefined;

    const deleteTasks: Promise<void>[] = [
      this.removeDoc('mi_esencia_credentials', accessCredentialId),
    ];

    if (!otherCredForSameInterlocutor && cred.interlocutorId) {
      this.interlocutors.delete(cred.interlocutorId);
      deleteTasks.push(this.removeDoc('mi_esencia_interlocutors', cred.interlocutorId));
      deletedInterlocutorId = cred.interlocutorId;
    }

    deleteTasks.push(
      this.persistDoc(
        'mi_esencia_config',
        'deleted_registry',
        this.serializeDeletedRegistry()
      )
    );
    this.saveToDisk();
    await Promise.all(deleteTasks);

    return {
      deletedCredentialId: accessCredentialId,
      deletedInterlocutorId,
    };
  }

  /**
   * Elimina por completo y de forma definitiva un Perfil Biográfico (Entidad A) y su PDF Compilado Archivado,
   * junto con sus testimonios, relaciones, conversaciones, memorias y contradicciones en disco y Firestore.
   * Registra las bajas en deletedRegistry para que nunca vuelvan a aparecer al recargar.
   */
  public async deletePersonProfileAndArchivedPdf(personId: string): Promise<{
    deletedPersonId: string;
    deletedPdfId?: string;
    deletedAvatarId?: string;
  }> {
    const person = this.persons.get(personId);
    if (!person) {
      throw new Error('Perfil biográfico no encontrado.');
    }

    const avatarId = person.avatarId;
    const pdfId = person.sourcePdfId;
    const firestoreRemovals: Promise<void>[] = [];

    // 1. Eliminar el perfil biográfico y registrarlo en deletedRegistry
    this.deletedRegistry.persons.add(personId);
    this.persons.delete(personId);
    firestoreRemovals.push(this.removeDoc('mi_esencia_persons', personId));

    // 2. Eliminar el PDF compilado asignado si ningún otro perfil activo lo utiliza
    let deletedPdfId: string | undefined;
    if (pdfId) {
      const anotherPersonUsesPdf = Array.from(this.persons.values()).some(
        (p) => p.sourcePdfId === pdfId
      );
      if (!anotherPersonUsesPdf) {
        this.deletedRegistry.pdfs.add(pdfId);
        this.compilationPdfs.delete(pdfId);
        firestoreRemovals.push(this.removeDoc('mi_esencia_pdfs', pdfId));
        deletedPdfId = pdfId;
      }
    }

    // 3. Eliminar testimonios, relaciones, conversaciones, memorias, versiones de prompt y contradicciones de este perfil
    for (const [tid, t] of Array.from(this.testimonies.entries())) {
      if (t.personId === personId || (deletedPdfId && t.sourcePdfId === deletedPdfId)) {
        this.testimonies.delete(tid);
        firestoreRemovals.push(this.removeDoc('mi_esencia_testimonies', tid));
      }
    }
    for (const [rid, r] of Array.from(this.relations.entries())) {
      if (r.personId === personId) {
        this.relations.delete(rid);
        firestoreRemovals.push(this.removeDoc('mi_esencia_relations', rid));
      }
    }
    for (const [sid, s] of Array.from(this.conversations.entries())) {
      if (s.personId === personId) {
        this.conversations.delete(sid);
        firestoreRemovals.push(this.removeDoc('mi_esencia_conversations', sid));
      }
    }
    for (const [mid, m] of Array.from(this.memories.entries())) {
      if (m.personId === personId) {
        this.memories.delete(mid);
        firestoreRemovals.push(this.removeDoc('mi_esencia_memories', mid));
      }
    }
    for (const [cid, c] of Array.from(this.contradictions.entries())) {
      if (c.personId === personId) {
        this.contradictions.delete(cid);
        firestoreRemovals.push(this.removeDoc('mi_esencia_contradictions', cid));
      }
    }
    for (const [vid, v] of Array.from(this.avatarPromptVersions.entries())) {
      if (v.targetId === personId) {
        this.avatarPromptVersions.delete(vid);
        firestoreRemovals.push(this.removeDoc('mi_esencia_prompt_versions', vid));
      }
    }

    // 4. Verificar si quedan otros perfiles en el mismo avatar
    const remainingPersonsForAvatar = Array.from(this.persons.values()).filter(
      (p) => p.avatarId === avatarId
    );

    let deletedAvatarId: string | undefined;
    if (remainingPersonsForAvatar.length === 0) {
      deletedAvatarId = avatarId;
      this.deletedRegistry.subscriptions.add(avatarId);
      this.subscriptions.delete(avatarId);
      firestoreRemovals.push(this.removeDoc('mi_esencia_subscriptions', avatarId));

      for (const [pid, pdfRec] of Array.from(this.compilationPdfs.entries())) {
        if (pdfRec.avatarId === avatarId) {
          this.deletedRegistry.pdfs.add(pid);
          this.compilationPdfs.delete(pid);
          firestoreRemovals.push(this.removeDoc('mi_esencia_pdfs', pid));
        }
      }
      for (const [credId, cred] of Array.from(this.credentials.entries())) {
        if (cred.avatarId === avatarId) {
          this.deletedRegistry.credentials.add(credId);
          this.credentials.delete(credId);
          firestoreRemovals.push(this.removeDoc('mi_esencia_credentials', credId));
        }
      }
      for (const [interId, inter] of Array.from(this.interlocutors.entries())) {
        if (inter.avatarId === avatarId) {
          this.interlocutors.delete(interId);
          firestoreRemovals.push(this.removeDoc('mi_esencia_interlocutors', interId));
        }
      }
      for (const [snapId, snap] of Array.from(this.snapshots.entries())) {
        if (snap.avatarId === avatarId) {
          this.snapshots.delete(snapId);
          firestoreRemovals.push(this.removeDoc('mi_esencia_snapshots', snapId));
        }
      }
      for (const [payId, pay] of Array.from(this.payments.entries())) {
        if (pay.avatarId === avatarId) {
          this.payments.delete(payId);
          firestoreRemovals.push(this.removeDoc('mi_esencia_payments', payId));
        }
      }
      for (const [notifId, notif] of Array.from(this.notifications.entries())) {
        if (notif.avatarId === avatarId) {
          this.notifications.delete(notifId);
          firestoreRemovals.push(this.removeDoc('mi_esencia_notifications', notifId));
        }
      }
      for (const [sid, s] of Array.from(this.conversations.entries())) {
        if (s.avatarId === avatarId) {
          this.conversations.delete(sid);
          firestoreRemovals.push(this.removeDoc('mi_esencia_conversations', sid));
        }
      }
    } else {
      const sub = this.subscriptions.get(avatarId);
      if (sub) {
        sub.personIds = remainingPersonsForAvatar.map((p) => p.personId);
        sub.isCoupleAvatar = remainingPersonsForAvatar.length > 1;
        sub.avatarDisplayName = remainingPersonsForAvatar.map((p) => p.fullName).join(' & ');
        sub.updatedAt = new Date().toISOString();
        this.subscriptions.set(avatarId, sub);
        firestoreRemovals.push(this.persistDoc('mi_esencia_subscriptions', avatarId, sub));
      }
    }

    firestoreRemovals.push(
      this.persistDoc(
        'mi_esencia_config',
        'deleted_registry',
        this.serializeDeletedRegistry()
      )
    );
    this.saveToDisk();
    await Promise.all(firestoreRemovals);

    return {
      deletedPersonId: personId,
      deletedPdfId,
      deletedAvatarId,
    };
  }

  /**
   * Limpia y borra todos los registros administrativos de conmutaciones de respaldo automático (fallbackLogs).
   */
  public async clearFallbackLogs(): Promise<{ clearedCount: number }> {
    const ids = Array.from(this.fallbackLogs.keys());
    this.fallbackLogs.clear();
    this.saveToDisk();
    await Promise.all(ids.map((id) => this.removeDoc('mi_esencia_fallback_logs', id)));
    return { clearedCount: ids.length };
  }

  // ============================================================================
  // ADMIN OVERVIEW & FULL STATE GETTER FOR THE 13 ADMIN TABS
  // ============================================================================

  /** V5.4.2 — Family portal: conversations of one family member and the avatar's open contradictions. */
  public getFamilyPortalData(avatarId: string, interlocutorId: string): {
    sessions: MiEsenciaConversationSession[];
    openContradictions: MiEsenciaContradictionRecord[];
  } {
    const sessions = Array.from(this.conversations.values())
      .filter((s) => s.avatarId === avatarId && s.interlocutorId === interlocutorId)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const openContradictions = Array.from(this.contradictions.values()).filter(
      (c) => c.avatarId === avatarId && c.status === 'abierta'
    );
    return { sessions, openContradictions };
  }

  public getAdminOverviewData() {
    this.syncAllPersonsAndPdfs();

    const allInterviews = storage.getInterviews().map((intv) => {
      const parts = storage.getParticipantsForInterview(intv.id);
      const ans = storage.getAnswersForInterview(intv.id);
      const linkedSub = Array.from(this.subscriptions.values()).find(
        (s) => s.sourceInterviewId === intv.id
      );
      return {
        interviewId: intv.id,
        title: intv.title,
        mode: intv.storyMode,
        status: intv.status,
        participants: parts.map((p) => ({ id: p.id, name: p.name, email: p.email })),
        answersCount: ans.length,
        hasMiEsenciaAvatar: Boolean(linkedSub),
        avatarId: linkedSub?.avatarId,
      };
    });

    const subscriptions = Array.from(this.subscriptions.values()).map((s) => ({
      ...s,
      status: evaluateEffectiveSubscriptionStatus(s),
    }));

    const persons = Array.from(this.persons.values());
    const compilationPdfs = Array.from(this.compilationPdfs.values()).map((pdf) => ({
      ...pdf,
      pdfBase64: '', // Se descarga bajo demanda por ID para mantener ágil el listado
    }));
    const testimonies = Array.from(this.testimonies.values());
    const relations = Array.from(this.relations.values());
    const interlocutors = Array.from(this.interlocutors.values());
    const credentials = Array.from(this.credentials.values());
    const memories = Array.from(this.memories.values());
    const contradictions = Array.from(this.contradictions.values());
    const payments = Array.from(this.payments.values());
    const coupons = Array.from(this.coupons.values());
    const snapshots = Array.from(this.snapshots.values());
    const conversations = Array.from(this.conversations.values());
    const notifications = Array.from(this.notifications.values());
    const promptLibrary = Array.from(this.promptLibrary.values()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
    const avatarPromptVersions = Array.from(this.avatarPromptVersions.values()).sort(
      (a, b) => b.versionNumber - a.versionNumber
    );
    const fallbackLogs = Array.from(this.fallbackLogs.values()).sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp)
    );
    const providersStatus = getProvidersAvailabilityStatus();

    return {
      config: this.getConfig(),
      plans: this.getPlans(),
      availableInterviews: allInterviews,
      subscriptions,
      persons,
      compilationPdfs,
      testimonies,
      relations,
      interlocutors,
      credentials,
      memories,
      contradictions,
      payments,
      coupons,
      snapshots,
      conversations,
      notifications,
      promptLibrary,
      avatarPromptVersions,
      fallbackLogs,
      providersStatus,
    };
  }

  public getCompilationPdfById(pdfId: string): MiEsenciaArchivedCompilationPdf | undefined {
    this.syncAllPersonsAndPdfs();
    let pdf = this.compilationPdfs.get(pdfId);

    // Si se pasó el ID de una persona o de una entrevista, buscar el PDF correspondiente
    if (!pdf) {
      const matchingPerson = Array.from(this.persons.values()).find(
        (p) => p.sourcePdfId === pdfId || p.personId === pdfId || p.sourceInterviewId === pdfId
      );
      if (matchingPerson && matchingPerson.sourcePdfId) {
        this.syncPersonWithAssignedPdfAndInterview(matchingPerson.personId);
        pdf = this.compilationPdfs.get(matchingPerson.sourcePdfId);
      }
    }

    if (!pdf && storage.getInterviewById(pdfId)) {
      pdf = this.buildAndCacheInterviewCompilationPdfSync(pdfId);
    }

    // Si el PDF existe pero su binario pdfBase64 estaba vacío (ej. al hidratar desde Firestore >60KB), regenerarlo al vuelo
    if (pdf && (!pdf.pdfBase64 || pdf.pdfBase64.trim().length < 100)) {
      if (
        pdf.sourceInterviewId &&
        pdf.sourceInterviewId !== 'manual' &&
        pdf.sourceInterviewId !== 'uploaded_pdf' &&
        storage.getInterviewById(pdf.sourceInterviewId)
      ) {
        const regenerated = this.buildAndCacheInterviewCompilationPdfSync(
          pdf.sourceInterviewId,
          pdf.pdfId,
          pdf.avatarId
        );
        if (regenerated) {
          pdf = regenerated;
        }
      } else {
        const linkedTestimonies = Array.from(this.testimonies.values()).filter(
          (t) => t.sourcePdfId === pdf!.pdfId
        );
        const generated = buildCompilationPdfBase64({
          interviewTitle: pdf.fileName.replace(/\.pdf$/i, '').replace(/_/g, ' '),
          participantNames: ['Participante'],
          rawTextContent: pdf.rawTextContent || '',
          testimonies: linkedTestimonies,
        });
        pdf = {
          ...pdf,
          pdfBase64: generated.pdfBase64,
          sha256Hash: generated.sha256Hash,
        };
        this.compilationPdfs.set(pdf.pdfId, pdf);
        this.saveToDisk();
      }
    }

    return pdf;
  }

  /**
   * Construye o actualiza de forma síncrona el PDF «Compilado Testimonial Fidedigno (Preguntas, Respuestas, Audios y Fotos)»
   * de una entrevista completa, incluyendo todas las preguntas/respuestas originales, transcripciones de voz editadas,
   * información adicional y fotografías con sus descripciones.
   */
  public buildAndCacheInterviewCompilationPdfSync(
    interviewId: string,
    preferredPdfId?: string,
    preferredAvatarId?: string
  ): MiEsenciaArchivedCompilationPdf | undefined {
    const interview = storage.getInterviewById(interviewId);
    if (!interview) return undefined;

    const participants = storage.getParticipantsForInterview(interviewId);
    const participantNames =
      participants.length > 0 ? participants.map((p) => p.name) : [interview.title];
    const pdfId = preferredPdfId || `comp_pdf_int_${interviewId}`;
    const avatarId = preferredAvatarId || 'interview_compilation';

    const built = this.buildTestimonyBlocksFromInterviewData({
      includePhotoData: true,
      interviewId,
      personId: `person_int_${interviewId}`,
      avatarId,
      pdfId,
      multipleParticipants: false,
    });

    const generated = buildCompilationPdfBase64({
      interviewTitle: interview.title,
      participantNames,
      rawTextContent: built.rawMarkdown,
      testimonies: built.blocks,
      photos: built.photosWithDataUrl,
    });

    const nowIso = new Date().toISOString();
    const existing = this.compilationPdfs.get(pdfId);
    const record: MiEsenciaArchivedCompilationPdf = {
      pdfId,
      avatarId,
      sourceInterviewId: interviewId,
      fileName:
        existing?.fileName ||
        `Compilado_Testimonial_Fidedigno_${interview.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`,
      origin: 'auto_generated_from_interview',
      sha256Hash: generated.sha256Hash,
      totalQuestions: built.blocks.length,
      totalLiteralAnswers: built.blocks.length,
      totalAudiosTranscribed: built.blocks.filter((b) => Boolean(b.audioTranscriptionLiteral)).length,
      totalPhotosReferenced: built.photosWithDataUrl.length,
      rawTextContent: built.rawMarkdown,
      pdfBase64: generated.pdfBase64,
      createdAt: existing?.createdAt || nowIso,
      createdBy: existing?.createdBy || 'system',
    };

    this.compilationPdfs.set(pdfId, record);
    this.saveToDisk();
    return record;
  }

  /**
   * Paso obligatorio 1, 2 y 3 para la generación de libros autobiográficos:
   * 1. Recupera todos los testimonios, transcripciones, textos, fotografías y descripciones de la entrevista.
   * 2. Genera o recupera el PDF actualizado del Compilado Testimonial Fidedigno.
   * 3. Verifica que el PDF exista, sea válido y contenga toda la información disponible.
   */
  public async ensureInterviewCompilationPdf(interviewId: string): Promise<{
    pdfRecord: MiEsenciaArchivedCompilationPdf;
    testimonies: MiEsenciaTestimonyBlock[];
    photosWithDataUrl: MiEsenciaTestimonyPhotoAttachment[];
  }> {
    await this.ensureInitialized();
    const interview = storage.getInterviewById(interviewId);
    if (!interview) {
      throw new Error('No se encontró la entrevista para generar el Compilado Testimonial Fidedigno.');
    }

    const pdfId = `comp_pdf_int_${interviewId}`;
    // V5.4.3: images not held by this instance are read from Firestore before building the PDF.
    await storage.ensureInterviewPhotosHydrated(interviewId).catch(() => undefined);
    const built = this.buildTestimonyBlocksFromInterviewData({
      includePhotoData: true,
      interviewId,
      personId: `person_int_${interviewId}`,
      avatarId: 'interview_compilation',
      pdfId,
      multipleParticipants: false,
    });

    if (built.blocks.length === 0) {
      throw new Error(
        'No existen testimonios registrados en la entrevista para generar el PDF fuente del Compilado Testimonial Fidedigno.'
      );
    }

    const pdfRecord = this.buildAndCacheInterviewCompilationPdfSync(interviewId, pdfId);
    const validation = validateCompilationPdfRecord(pdfRecord);
    if (!validation.valid || !pdfRecord) {
      throw new Error(
        validation.reason ||
          'No se pudo crear o recuperar válidamente el PDF fuente del Compilado Testimonial Fidedigno.'
      );
    }

    // Sincronizar también cualquier perfil de Mi Esencia vinculado a esta entrevista
    for (const p of Array.from(this.persons.values())) {
      if (p.sourceInterviewId === interviewId) {
        this.syncPersonWithAssignedPdfAndInterview(p.personId);
      }
    }

    await this.persistDoc('mi_esencia_pdfs', pdfRecord.pdfId, pdfRecord);

    return {
      pdfRecord,
      testimonies: built.blocks,
      photosWithDataUrl: built.photosWithDataUrl,
    };
  }

  // ============================================================================
  // DUAL AI PROVIDER CONFIG, PROMPT VERSIONING & PDF REPLACEMENT PER AVATAR
  // ============================================================================

  public getProvidersStatus() {
    return getProvidersAvailabilityStatus();
  }

  public async testAiProviderConnection(params: {
    provider: MiEsenciaAiProvider;
    model?: string;
  }) {
    return testLiveProviderConnection(params);
  }

  /**
   * Actualiza de inmediato el proveedor principal, modelos y/o prompts independientes (Gemini y OpenAI GPT)
   * de un perfil biográfico, registrando versiones recuperables cuando cambia el contenido del prompt.
   * Los cambios se aplican desde la siguiente respuesta sin reiniciar sesiones ni perder recuerdos (Sección 7 y 11).
   */
  public async updatePersonAiConfigAndPrompts(params: {
    personId: string;
    conversationConfigMode?: MiEsenciaConversationConfigMode;
    primaryProvider?: MiEsenciaAiProvider;
    enableAutomaticFallback?: boolean;
    geminiModel?: string;
    geminiPromptName?: string;
    geminiPromptContent?: string;
    openaiModel?: string;
    openaiPromptName?: string;
    openaiPromptContent?: string;
    adminEmail: string;
  }): Promise<{
    person: MiEsenciaPersonProfile;
    createdVersions: MiEsenciaPromptVersionRecord[];
  }> {
    const person = this.persons.get(params.personId);
    if (!person) {
      throw new Error('Perfil biográfico no encontrado.');
    }

    const nowIso = new Date().toISOString();
    const currentAi: MiEsenciaAvatarAiConfig =
      person.aiConfig ||
      buildDefaultAvatarAiConfig({
        mode: 'modo_existente',
        defaultGeminiModel: this.config.defaultGeminiModel || MI_ESENCIA_DEFAULT_GEMINI_MODEL,
        defaultOpenAiModel: this.config.defaultOpenAiModel || OPENAI_DEFAULT_MODEL,
      });

    const createdVersions: MiEsenciaPromptVersionRecord[] = [];

    let nextGemVersion = currentAi.geminiPromptVersion || 0;
    let nextGemContent = currentAi.geminiPromptContent || '';
    const nextGemName =
      typeof params.geminiPromptName === 'string' && params.geminiPromptName.trim()
        ? params.geminiPromptName.trim()
        : currentAi.geminiPromptName || 'Prompt Gemini del Avatar';

    if (
      typeof params.geminiPromptContent === 'string' &&
      params.geminiPromptContent !== currentAi.geminiPromptContent
    ) {
      nextGemContent = params.geminiPromptContent;
      nextGemVersion += 1;
      const verRec: MiEsenciaPromptVersionRecord = {
        versionId: `pver_${crypto.randomBytes(5).toString('hex')}`,
        targetType: 'avatar_gemini_prompt',
        targetId: person.personId,
        provider: 'gemini',
        versionNumber: nextGemVersion,
        promptName: nextGemName,
        content: nextGemContent,
        modifiedAt: nowIso,
        modifiedBy: params.adminEmail,
        sourceReference: 'Edición directa en configuración del avatar',
      };
      this.avatarPromptVersions.set(verRec.versionId, verRec);
      await this.persistDoc('mi_esencia_prompt_versions', verRec.versionId, verRec);
      createdVersions.push(verRec);
    }

    let nextOaVersion = currentAi.openaiPromptVersion || 0;
    let nextOaContent = currentAi.openaiPromptContent || '';
    const nextOaName =
      typeof params.openaiPromptName === 'string' && params.openaiPromptName.trim()
        ? params.openaiPromptName.trim()
        : currentAi.openaiPromptName || 'Prompt OpenAI GPT del Avatar';

    if (
      typeof params.openaiPromptContent === 'string' &&
      params.openaiPromptContent !== currentAi.openaiPromptContent
    ) {
      nextOaContent = params.openaiPromptContent;
      nextOaVersion += 1;
      const verRec: MiEsenciaPromptVersionRecord = {
        versionId: `pver_${crypto.randomBytes(5).toString('hex')}`,
        targetType: 'avatar_openai_prompt',
        targetId: person.personId,
        provider: 'openai',
        versionNumber: nextOaVersion,
        promptName: nextOaName,
        content: nextOaContent,
        modifiedAt: nowIso,
        modifiedBy: params.adminEmail,
        sourceReference: 'Edición directa en configuración del avatar',
      };
      this.avatarPromptVersions.set(verRec.versionId, verRec);
      await this.persistDoc('mi_esencia_prompt_versions', verRec.versionId, verRec);
      createdVersions.push(verRec);
    }

    person.aiConfig = {
      ...currentAi,
      conversationConfigMode:
        params.conversationConfigMode || currentAi.conversationConfigMode || 'modo_existente',
      primaryProvider: params.primaryProvider || currentAi.primaryProvider || 'gemini',
      enableAutomaticFallback:
        typeof params.enableAutomaticFallback === 'boolean'
          ? params.enableAutomaticFallback
          : currentAi.enableAutomaticFallback ?? true,
      geminiModel: params.geminiModel || currentAi.geminiModel || MI_ESENCIA_DEFAULT_GEMINI_MODEL,
      geminiPromptName: nextGemName,
      geminiPromptContent: nextGemContent,
      geminiPromptVersion: nextGemVersion,
      geminiConfigStatus: nextGemContent.trim() ? 'configurado' : 'sin_configurar',
      openaiModel: params.openaiModel || currentAi.openaiModel || OPENAI_DEFAULT_MODEL,
      openaiPromptName: nextOaName,
      openaiPromptContent: nextOaContent,
      openaiPromptVersion: nextOaVersion,
      openaiConfigStatus: nextOaContent.trim() ? 'configurado' : 'sin_configurar',
      updatedAt: nowIso,
      updatedBy: params.adminEmail,
    };

    person.updatedAt = nowIso;
    this.persons.set(person.personId, person);
    await this.persistDoc('mi_esencia_persons', person.personId, person);

    return { person, createdVersions };
  }

  /**
   * Restaura una versión anterior del prompt Gemini u OpenAI de un avatar,
   * generando una nueva versión activa sin destruir el historial previo (Sección 11.1).
   */
  public async restoreAvatarPromptVersion(params: {
    personId: string;
    versionId: string;
    adminEmail: string;
  }): Promise<{
    person: MiEsenciaPersonProfile;
    restoredVersionRecord: MiEsenciaPromptVersionRecord;
  }> {
    const person = this.persons.get(params.personId);
    if (!person) {
      throw new Error('Perfil biográfico no encontrado.');
    }

    const targetVer = this.avatarPromptVersions.get(params.versionId);
    if (!targetVer || targetVer.targetId !== person.personId) {
      throw new Error('La versión de prompt seleccionada no existe para este avatar.');
    }

    const nowIso = new Date().toISOString();
    const currentAi =
      person.aiConfig ||
      buildDefaultAvatarAiConfig({
        mode: 'modo_existente',
        defaultGeminiModel: this.config.defaultGeminiModel || MI_ESENCIA_DEFAULT_GEMINI_MODEL,
        defaultOpenAiModel: this.config.defaultOpenAiModel || 'gpt-4o',
      });

    if (targetVer.targetType === 'avatar_gemini_prompt') {
      const nextVersionNumber = (currentAi.geminiPromptVersion || 0) + 1;
      const newActiveVer: MiEsenciaPromptVersionRecord = {
        versionId: `pver_${crypto.randomBytes(5).toString('hex')}`,
        targetType: 'avatar_gemini_prompt',
        targetId: person.personId,
        provider: 'gemini',
        versionNumber: nextVersionNumber,
        promptName: targetVer.promptName,
        content: targetVer.content,
        modifiedAt: nowIso,
        modifiedBy: params.adminEmail,
        sourceReference: `Restaurada desde versión v${targetVer.versionNumber} (${targetVer.versionId})`,
      };
      this.avatarPromptVersions.set(newActiveVer.versionId, newActiveVer);
      await this.persistDoc('mi_esencia_prompt_versions', newActiveVer.versionId, newActiveVer);

      person.aiConfig = {
        ...currentAi,
        geminiPromptName: targetVer.promptName,
        geminiPromptContent: targetVer.content,
        geminiPromptVersion: nextVersionNumber,
        geminiConfigStatus: targetVer.content.trim() ? 'configurado' : 'sin_configurar',
        updatedAt: nowIso,
        updatedBy: params.adminEmail,
      };
      person.updatedAt = nowIso;
      this.persons.set(person.personId, person);
      await this.persistDoc('mi_esencia_persons', person.personId, person);
      return { person, restoredVersionRecord: newActiveVer };
    } else {
      const nextVersionNumber = (currentAi.openaiPromptVersion || 0) + 1;
      const newActiveVer: MiEsenciaPromptVersionRecord = {
        versionId: `pver_${crypto.randomBytes(5).toString('hex')}`,
        targetType: 'avatar_openai_prompt',
        targetId: person.personId,
        provider: 'openai',
        versionNumber: nextVersionNumber,
        promptName: targetVer.promptName,
        content: targetVer.content,
        modifiedAt: nowIso,
        modifiedBy: params.adminEmail,
        sourceReference: `Restaurada desde versión v${targetVer.versionNumber} (${targetVer.versionId})`,
      };
      this.avatarPromptVersions.set(newActiveVer.versionId, newActiveVer);
      await this.persistDoc('mi_esencia_prompt_versions', newActiveVer.versionId, newActiveVer);

      person.aiConfig = {
        ...currentAi,
        openaiPromptName: targetVer.promptName,
        openaiPromptContent: targetVer.content,
        openaiPromptVersion: nextVersionNumber,
        openaiConfigStatus: targetVer.content.trim() ? 'configurado' : 'sin_configurar',
        updatedAt: nowIso,
        updatedBy: params.adminEmail,
      };
      person.updatedAt = nowIso;
      this.persons.set(person.personId, person);
      await this.persistDoc('mi_esencia_persons', person.personId, person);
      return { person, restoredVersionRecord: newActiveVer };
    }
  }

  /**
   * Reemplaza o carga manualmente el Documento PDF de recuerdos de un avatar (Secciones 13 y 15).
   * Valida formato e integridad, procesa y extrae el contenido de manera atómica, actualiza
   * los bloques de testimonios y relaciones del perfil e incrementa la versión documental.
   */
  public async replacePersonCompilationPdf(params: {
    personId: string;
    fileName: string;
    pdfBase64?: string;
    rawCompilationText?: string;
    adminEmail: string;
  }): Promise<{
    person: MiEsenciaPersonProfile;
    archivedPdf: MiEsenciaArchivedCompilationPdf;
    testimoniesCount: number;
  }> {
    const person = this.persons.get(params.personId);
    if (!person) {
      throw new Error('Perfil biográfico no encontrado.');
    }

    const fileNameClean = (params.fileName || '').trim();
    if (!fileNameClean || !/\.pdf$/i.test(fileNameClean)) {
      throw new Error('El documento de recuerdos debe tener extensión .pdf válida.');
    }

    // Validar tamaño permitido (máx 15 MB en base64)
    if (params.pdfBase64 && params.pdfBase64.length > 20_000_000) {
      throw new Error('El archivo PDF excede el tamaño máximo permitido (15 MB).');
    }

    const extractedText =
      params.rawCompilationText?.trim() ||
      (params.pdfBase64 ? extractTextFromUploadedPdfBase64(params.pdfBase64) : '');

    if (!extractedText.trim()) {
      throw new Error(
        'No fue posible extraer texto biográfico válido del documento PDF. Asegúrate de que el PDF contenga texto legible o proporciona las preguntas y respuestas.'
      );
    }

    const nowIso = new Date().toISOString();
    const newPdfId = `comp_pdf_${crypto.randomBytes(5).toString('hex')}`;

    // Procesar los nuevos bloques en memoria antes de sustituir para garantizar atomicidad (Sección 15.1)
    const parsedBlocks = parseCompilationTextIntoTestimonies({
      rawText: extractedText,
      avatarId: person.avatarId,
      personId: person.personId,
      sourcePdfId: newPdfId,
    });

    if (parsedBlocks.length === 0) {
      throw new Error('El procesamiento documental no encontró recuerdos válidos para indexar.');
    }

    const generatedPdf = buildCompilationPdfBase64({
      interviewTitle: `Legado de ${person.fullName}`,
      participantNames: [person.fullName],
      rawTextContent: extractedText,
      testimonies: parsedBlocks,
    });

    const finalBase64 = params.pdfBase64 || generatedPdf.pdfBase64;
    const finalSha256 = params.pdfBase64
      ? crypto.createHash('sha256').update(params.pdfBase64).digest('hex')
      : generatedPdf.sha256Hash;

    const newPdfRecord: MiEsenciaArchivedCompilationPdf = {
      pdfId: newPdfId,
      avatarId: person.avatarId,
      sourceInterviewId: 'uploaded_pdf',
      fileName: fileNameClean,
      origin: 'uploaded_by_admin',
      sha256Hash: finalSha256,
      totalQuestions: parsedBlocks.length,
      totalLiteralAnswers: parsedBlocks.length,
      totalAudiosTranscribed: parsedBlocks.filter((b) => Boolean(b.audioTranscriptionLiteral))
        .length,
      totalPhotosReferenced: 0,
      rawTextContent: extractedText,
      pdfBase64: finalBase64,
      createdAt: nowIso,
      createdBy: params.adminEmail,
    };

    const newRelations = extractRelatedPersonsFromTestimonies(
      person.avatarId,
      person.personId,
      parsedBlocks
    );

    // Sustitución atómica: eliminar fragmentos del PDF anterior de este perfil y registrar los nuevos
    const oldPdfId = person.sourcePdfId;
    for (const [tid, oldT] of Array.from(this.testimonies.entries())) {
      if (oldT.personId === person.personId) {
        this.testimonies.delete(tid);
        await this.removeDoc('mi_esencia_testimonies', tid);
      }
    }
    for (const [rid, oldR] of Array.from(this.relations.entries())) {
      if (oldR.personId === person.personId) {
        this.relations.delete(rid);
        await this.removeDoc('mi_esencia_relations', rid);
      }
    }

    for (const block of parsedBlocks) {
      this.testimonies.set(block.testimonyId, block);
      await this.persistDoc('mi_esencia_testimonies', block.testimonyId, block);
    }
    for (const rel of newRelations) {
      this.relations.set(rel.relatedPersonId, rel);
      await this.persistDoc('mi_esencia_relations', rel.relatedPersonId, rel);
    }

    this.compilationPdfs.set(newPdfId, newPdfRecord);
    await this.persistDoc('mi_esencia_pdfs', newPdfId, newPdfRecord);

    if (oldPdfId && oldPdfId !== newPdfId) {
      const usedByOther = Array.from(this.persons.values()).some(
        (other) => other.personId !== person.personId && other.sourcePdfId === oldPdfId
      );
      if (!usedByOther && this.compilationPdfs.has(oldPdfId)) {
        this.compilationPdfs.delete(oldPdfId);
        await this.removeDoc('mi_esencia_pdfs', oldPdfId);
      }
    }

    const currentAi =
      person.aiConfig ||
      buildDefaultAvatarAiConfig({
        mode: 'modo_existente',
        defaultGeminiModel: this.config.defaultGeminiModel || MI_ESENCIA_DEFAULT_GEMINI_MODEL,
        defaultOpenAiModel: this.config.defaultOpenAiModel || 'gpt-4o',
      });

    person.sourcePdfId = newPdfId;
    person.sourceInterviewId = 'uploaded_pdf';
    person.linguisticProfile = extractLinguisticProfileFromTestimonies(parsedBlocks);
    person.milestones = parsedBlocks.slice(0, 5).map((b) => b.answerLiteral.slice(0, 110));
    person.biographySummary = `Perfil biográfico de ${person.fullName} actualizado desde documento PDF (${parsedBlocks.length} bloques).`;
    person.version = (person.version || 1) + 1;
    person.aiConfig = {
      ...currentAi,
      documentVersion: (currentAi.documentVersion || 1) + 1,
      documentProcessingStatus: 'listo',
      documentLastProcessedAt: nowIso,
      updatedAt: nowIso,
      updatedBy: params.adminEmail,
    };
    person.updatedAt = nowIso;

    this.persons.set(person.personId, person);
    await this.persistDoc('mi_esencia_persons', person.personId, person);

    return {
      person,
      archivedPdf: newPdfRecord,
      testimoniesCount: parsedBlocks.length,
    };
  }

  // ============================================================================
  // ADMINISTRADOR DE PROMPTS (BIBLIOTECA GLOBAL, VERSIONADO, IMPORT/EXPORT)
  // ============================================================================

  public async saveLibraryPrompt(params: {
    promptId?: string;
    name: string;
    description?: string;
    category: string;
    compatibleProvider: MiEsenciaPromptCompatibleProvider;
    content: string;
    status?: 'disponible' | 'archivado';
    adminEmail: string;
  }): Promise<MiEsenciaLibraryPromptRecord> {
    const nameClean = (params.name || '').trim();
    if (!nameClean) {
      throw new Error('El nombre del prompt es obligatorio.');
    }
    if (typeof params.content !== 'string' || !params.content.trim()) {
      throw new Error('El texto íntegro del prompt no puede estar vacío.');
    }

    const nowIso = new Date().toISOString();
    const categoryClean = (params.category || 'Conversación familiar').trim();

    // Asegurar que la categoría personalizada quede registrada en la lista de categorías disponibles
    const categoriesSet = new Set([
      ...(this.config.customPromptCategories || DEFAULT_PROMPT_CATEGORIES),
      categoryClean,
    ]);
    this.config.customPromptCategories = Array.from(categoriesSet);

    const existing = params.promptId ? this.promptLibrary.get(params.promptId) : undefined;
    const promptId = existing?.promptId || `lib_prompt_${crypto.randomBytes(5).toString('hex')}`;

    const contentChanged = !existing || existing.content !== params.content;
    const nextVersion = existing ? (contentChanged ? existing.version + 1 : existing.version) : 1;

    const history = existing?.versionHistory ? [...existing.versionHistory] : [];
    if (contentChanged) {
      history.push({
        versionId: `pver_${crypto.randomBytes(5).toString('hex')}`,
        targetType: 'library_prompt',
        targetId: promptId,
        provider: params.compatibleProvider,
        versionNumber: nextVersion,
        promptName: nameClean,
        content: params.content,
        modifiedAt: nowIso,
        modifiedBy: params.adminEmail,
        sourceReference: existing ? 'Actualización en Administrador de Prompts' : 'Creación inicial',
      });
    }

    const record: MiEsenciaLibraryPromptRecord = {
      promptId,
      name: nameClean,
      description: params.description?.trim() || '',
      category: categoryClean,
      compatibleProvider: params.compatibleProvider || 'ambos',
      content: params.content, // Conservar formato, saltos de línea y extensión íntegra
      version: nextVersion,
      status: params.status || existing?.status || 'disponible',
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
      updatedBy: params.adminEmail,
      versionHistory: history,
    };

    this.promptLibrary.set(promptId, record);
    await this.persistDoc('mi_esencia_prompt_library', promptId, record);
    return record;
  }

  public async duplicateLibraryPrompt(params: {
    promptId: string;
    adminEmail: string;
  }): Promise<MiEsenciaLibraryPromptRecord> {
    const source = this.promptLibrary.get(params.promptId);
    if (!source) {
      throw new Error('El prompt a duplicar no existe en la biblioteca.');
    }
    return this.saveLibraryPrompt({
      name: `${source.name} (Copia)`,
      description: source.description,
      category: source.category,
      compatibleProvider: source.compatibleProvider,
      content: `${source.content}`,
      adminEmail: params.adminEmail,
    });
  }

  /**
   * Elimina un prompt de la biblioteca global sin borrar ni modificar las copias independientes
   * ya asignadas a los avatares (Sección 11.2).
   */
  public async deleteLibraryPrompt(promptId: string): Promise<{ deletedPromptId: string }> {
    const existing = this.promptLibrary.get(promptId);
    if (!existing) {
      throw new Error('El prompt solicitado no existe en la biblioteca.');
    }
    this.promptLibrary.delete(promptId);
    await this.removeDoc('mi_esencia_prompt_library', promptId);
    return { deletedPromptId: promptId };
  }

  /**
   * Restaura una versión anterior de un prompt de la biblioteca global,
   * generando una nueva versión activa sin destruir el historial previo (Sección 11.1).
   */
  public async restoreLibraryPromptVersion(params: {
    promptId: string;
    versionId: string;
    adminEmail: string;
  }): Promise<MiEsenciaLibraryPromptRecord> {
    const prompt = this.promptLibrary.get(params.promptId);
    if (!prompt) {
      throw new Error('Prompt no encontrado en la biblioteca.');
    }
    const targetVer = prompt.versionHistory.find((v) => v.versionId === params.versionId);
    if (!targetVer) {
      throw new Error('La versión seleccionada no existe en el historial de este prompt.');
    }

    const nowIso = new Date().toISOString();
    const nextVersion = prompt.version + 1;
    const restoredEntry: MiEsenciaPromptVersionRecord = {
      versionId: `pver_${crypto.randomBytes(5).toString('hex')}`,
      targetType: 'library_prompt',
      targetId: prompt.promptId,
      provider: prompt.compatibleProvider,
      versionNumber: nextVersion,
      promptName: targetVer.promptName || prompt.name,
      content: targetVer.content,
      modifiedAt: nowIso,
      modifiedBy: params.adminEmail,
      sourceReference: `Restaurada desde versión v${targetVer.versionNumber}`,
    };

    const updated: MiEsenciaLibraryPromptRecord = {
      ...prompt,
      name: targetVer.promptName || prompt.name,
      content: targetVer.content,
      version: nextVersion,
      updatedAt: nowIso,
      updatedBy: params.adminEmail,
      versionHistory: [...prompt.versionHistory, restoredEntry],
    };

    this.promptLibrary.set(prompt.promptId, updated);
    await this.persistDoc('mi_esencia_prompt_library', prompt.promptId, updated);
    return updated;
  }

  /**
   * Asigna un prompt de la biblioteca global a un avatar mediante una COPIA INDEPENDIENTE (Sección 9).
   * Modificar posteriormente el prompt de la biblioteca NO altera el prompt del avatar.
   */
  public async assignLibraryPromptCopyToAvatar(params: {
    promptId: string;
    personId: string;
    targetProvider: MiEsenciaAiProvider | 'ambos';
    activateCustomMode?: boolean;
    adminEmail: string;
  }): Promise<{
    person: MiEsenciaPersonProfile;
    createdVersions: MiEsenciaPromptVersionRecord[];
  }> {
    const libraryPrompt = this.promptLibrary.get(params.promptId);
    if (!libraryPrompt) {
      throw new Error('Prompt no encontrado en la biblioteca.');
    }
    const person = this.persons.get(params.personId);
    if (!person) {
      throw new Error('Perfil de avatar no encontrado.');
    }

    let currentAi =
      person.aiConfig ||
      buildDefaultAvatarAiConfig({
        mode: 'modo_existente',
        defaultGeminiModel: this.config.defaultGeminiModel || MI_ESENCIA_DEFAULT_GEMINI_MODEL,
        defaultOpenAiModel: this.config.defaultOpenAiModel || 'gpt-4o',
      });

    const createdVersions: MiEsenciaPromptVersionRecord[] = [];
    const targets: MiEsenciaAiProvider[] =
      params.targetProvider === 'ambos' ? ['gemini', 'openai'] : [params.targetProvider];

    for (const prov of targets) {
      const { updatedAiConfig, newVersionRecord } = createIndependentAvatarPromptCopyFromLibrary({
        libraryPrompt,
        targetProvider: prov,
        currentAiConfig: currentAi,
        adminEmail: params.adminEmail,
      });
      newVersionRecord.targetId = person.personId;
      currentAi = updatedAiConfig;
      this.avatarPromptVersions.set(newVersionRecord.versionId, newVersionRecord);
      await this.persistDoc(
        'mi_esencia_prompt_versions',
        newVersionRecord.versionId,
        newVersionRecord
      );
      createdVersions.push(newVersionRecord);
    }

    if (params.activateCustomMode) {
      currentAi.conversationConfigMode = 'modo_personalizado';
    }

    person.aiConfig = currentAi;
    person.updatedAt = new Date().toISOString();
    this.persons.set(person.personId, person);
    await this.persistDoc('mi_esencia_persons', person.personId, person);

    return { person, createdVersions };
  }

  public async importLibraryPrompts(params: {
    rawContent: string;
    format: 'txt' | 'md' | 'json';
    defaultName?: string;
    defaultCategory?: string;
    defaultCompatibleProvider?: MiEsenciaPromptCompatibleProvider;
    adminEmail: string;
  }): Promise<MiEsenciaLibraryPromptRecord[]> {
    const parsedItems = parseImportedPromptsPayload(params);
    const created: MiEsenciaLibraryPromptRecord[] = [];

    for (const item of parsedItems) {
      // Evitar sobrescribir registros existentes silenciosamente: si el nombre ya existe, agregar sufijo
      const nameExists = Array.from(this.promptLibrary.values()).some(
        (existing) => existing.name.toLowerCase() === item.name.toLowerCase()
      );
      const safeName = nameExists ? `${item.name} (Importado)` : item.name;

      const saved = await this.saveLibraryPrompt({
        name: safeName,
        description: item.description,
        category: item.category,
        compatibleProvider: item.compatibleProvider,
        content: item.content,
        adminEmail: params.adminEmail,
      });
      created.push(saved);
    }

    return created;
  }

  public exportLibraryPrompts(params: {
    promptIds?: string[];
    format: 'json' | 'md' | 'txt';
  }): { fileName: string; mimeType: string; content: string } {
    const allPrompts = Array.from(this.promptLibrary.values());
    const targetPrompts =
      params.promptIds && params.promptIds.length > 0
        ? allPrompts.filter((pr) => params.promptIds!.includes(pr.promptId))
        : allPrompts;

    if (targetPrompts.length === 0) {
      throw new Error('No hay prompts seleccionados para exportar.');
    }

    return exportLibraryPromptsPayload({
      prompts: targetPrompts,
      format: params.format || 'json',
    });
  }

  public async addCustomPromptCategory(
    categoryName: string,
    adminEmail: string
  ): Promise<string[]> {
    const clean = (categoryName || '').trim();
    if (!clean) {
      throw new Error('El nombre de la categoría no puede estar vacío.');
    }
    const existing = this.config.customPromptCategories || [...DEFAULT_PROMPT_CATEGORIES];
    if (!existing.some((c) => c.toLowerCase() === clean.toLowerCase())) {
      existing.push(clean);
    }
    await this.updateConfig({ customPromptCategories: existing }, adminEmail);
    return existing;
  }

  // ============================================================================
  // SIMULADOR ADMINISTRATIVO DE PROMPTS («PROBAR CONVERSACIÓN» — SECCIÓN 19)
  // ============================================================================

  /**
   * Obtiene la vista previa de las variables dinámicas resueltas para un perfil de avatar
   * y un texto de prompt determinado (Sección 10).
   */
  public previewAvatarPromptVariables(params: {
    personId: string;
    promptTemplate: string;
    simulatedInterlocutorName?: string;
    simulatedRelationship?: string;
    simulatedNickname?: string;
  }) {
    const person = this.persons.get(params.personId);
    if (!person) {
      throw new Error('Perfil de avatar no encontrado.');
    }
    this.syncPersonWithAssignedPdfAndInterview(person.personId);

    const personRelations = Array.from(this.relations.values()).filter(
      (r) => r.personId === person.personId
    );
    const personTestimonies = Array.from(this.testimonies.values()).filter(
      (t) =>
        t.personId === person.personId &&
        (!person.sourcePdfId || !t.sourcePdfId || t.sourcePdfId === person.sourcePdfId)
    );

    const confirmedIdentity: MiEsenciaConfirmedInterlocutorIdentity | undefined =
      params.simulatedInterlocutorName || params.simulatedRelationship || params.simulatedNickname
        ? {
            declaredName: params.simulatedInterlocutorName?.trim() || undefined,
            relationshipToPerson: params.simulatedRelationship?.trim() || undefined,
            affectionateNickname: params.simulatedNickname?.trim() || undefined,
            documentedSentimentTone: 'afecto_cercano',
            documentedSentimentDescription: 'Simulación administrativa',
            documentedSharedMemories: [],
            isDocumentedInLegacy: true,
          }
        : undefined;

    return resolvePromptDynamicVariables({
      promptTemplate: params.promptTemplate || '',
      person,
      relations: personRelations,
      testimonies: personTestimonies,
      confirmedIdentity,
    });
  }

  /**
   * Ejecuta un turno conversacional aislado en el Simulador Administrativo («Probar Conversación»).
   * Utiliza el PDF real del avatar y sus memorias autorizadas sin alterar conversaciones familiares
   * ni modificar la memoria persistente (Sección 19).
   */
  public async runAdminSimulatorTurn(params: {
    personId: string;
    provider: MiEsenciaAiProvider;
    model?: string;
    draftPromptContent?: string;
    userMessage: string;
    simulatedHistory?: Array<{ sender: 'interlocutor' | 'avatar'; content: string }>;
    simulatedInterlocutorName?: string;
    simulatedRelationship?: string;
    simulatedNickname?: string;
    simulatePrimaryFailure?: boolean;
    simulateBothProvidersFailure?: boolean;
  }) {
    const person = this.persons.get(params.personId);
    if (!person) {
      throw new Error('Perfil de avatar no encontrado para simulación.');
    }
    this.syncPersonWithAssignedPdfAndInterview(person.personId);

    const aiConfig =
      person.aiConfig ||
      buildDefaultAvatarAiConfig({
        mode: 'modo_personalizado',
        defaultGeminiModel: this.config.defaultGeminiModel || MI_ESENCIA_DEFAULT_GEMINI_MODEL,
        defaultOpenAiModel: this.config.defaultOpenAiModel || OPENAI_DEFAULT_MODEL,
      });

    const assignedPdf = person.sourcePdfId
      ? this.compilationPdfs.get(person.sourcePdfId)
      : undefined;

    const personTestimonies = Array.from(this.testimonies.values()).filter(
      (t) =>
        t.personId === person.personId &&
        (!person.sourcePdfId || !t.sourcePdfId || t.sourcePdfId === person.sourcePdfId)
    );
    const personRelations = Array.from(this.relations.values()).filter(
      (r) => r.personId === person.personId
    );
    const sharedMemoriesLevelB = Array.from(this.memories.values()).filter(
      (m) =>
        m.personId === person.personId &&
        m.privacyLevel === 'familiar_compartido' &&
        m.verificationState !== 'revocado'
    );

    const confirmedIdentity: MiEsenciaConfirmedInterlocutorIdentity | undefined =
      params.simulatedInterlocutorName || params.simulatedRelationship || params.simulatedNickname
        ? {
            declaredName: params.simulatedInterlocutorName?.trim() || undefined,
            relationshipToPerson: params.simulatedRelationship?.trim() || undefined,
            affectionateNickname: params.simulatedNickname?.trim() || undefined,
            documentedSentimentTone: 'afecto_cercano',
            documentedSentimentDescription: 'Simulación administrativa',
            documentedSharedMemories: [],
            isDocumentedInLegacy: true,
          }
        : undefined;

    const effectivePromptContent =
      typeof params.draftPromptContent === 'string' && params.draftPromptContent.trim()
        ? params.draftPromptContent
        : params.provider === 'openai'
        ? // V5.4.2: same resolution as the real chat (the other provider's prompt before a seed).
          aiConfig.openaiPromptContent || aiConfig.geminiPromptContent || DEFAULT_SEED_LIBRARY_PROMPTS[2].content
        : aiConfig.geminiPromptContent || aiConfig.openaiPromptContent || DEFAULT_SEED_LIBRARY_PROMPTS[0].content;

    const simResult = await executeCustomAvatarTurnWithFallback({
      person,
      aiConfig,
      archivedPdf: assignedPdf,
      personTestimonies,
      personRelations,
      sharedMemoriesLevelB,
      privateMemoriesLevelC: [],
      confirmedIdentity,
      recentMessages: params.simulatedHistory || [],
      userMessage: params.userMessage,
      overrideProvider: params.provider,
      overrideModel: params.model,
      overridePromptContent: effectivePromptContent,
      simulatePrimaryFailure: params.simulatePrimaryFailure,
      simulateBothProvidersFailure: params.simulateBothProvidersFailure,
    });

    if (simResult.fallbackLog) {
      const normalizedLog: MiEsenciaProviderFallbackLog = {
        ...simResult.fallbackLog,
        fallbackProvider: simResult.fallbackLog.fallbackProviderUsed,
        fallbackModel: simResult.fallbackLog.fallbackModelUsed,
        reason: simResult.fallbackLog.sanitizedReason,
      };
      this.fallbackLogs.set(normalizedLog.logId, normalizedLog);
    }

    return {
      ...simResult,
      documentAccessMode: simResult.retrievalMode,
      fragmentsCountUsed: simResult.fragmentsIncludedCount,
      latencyMs: simResult.durationMs,
      fallbackActivated: simResult.fallbackTriggered,
      fallbackReason:
        simResult.adminFallbackNotice ||
        simResult.fallbackLog?.sanitizedReason ||
        simResult.sanitizedErrorWarning ||
        undefined,
      adminFallbackNotice: simResult.adminFallbackNotice,
      resolvedSystemPrompt: simResult.resolvedSystemPromptPreview,
      sessionContextSummary: simResult.sessionContextSummary,
      pdfAssociatedFileName: assignedPdf?.fileName || 'Sin archivo PDF asociado',
      pdfDocumentStatus: aiConfig.documentProcessingStatus || 'listo',
    };
  }

  public exportFullStateForBackup(): Record<string, any> {
    return {
      exportedAt: new Date().toISOString(),
      config: this.config,
      deletedRegistry: this.serializeDeletedRegistry(),
      plans: Array.from(this.plans.values()),
      subscriptions: Array.from(this.subscriptions.values()),
      persons: Array.from(this.persons.values()),
      compilationPdfs: Array.from(this.compilationPdfs.values()),
      testimonies: Array.from(this.testimonies.values()),
      relations: Array.from(this.relations.values()),
      interlocutors: Array.from(this.interlocutors.values()),
      credentials: Array.from(this.credentials.values()),
      memories: Array.from(this.memories.values()),
      contradictions: Array.from(this.contradictions.values()),
      payments: Array.from(this.payments.values()),
      coupons: Array.from(this.coupons.values()),
      snapshots: Array.from(this.snapshots.values()),
      conversations: Array.from(this.conversations.values()),
      notifications: Array.from(this.notifications.values()),
      promptLibrary: Array.from(this.promptLibrary.values()),
      avatarPromptVersions: Array.from(this.avatarPromptVersions.values()),
      fallbackLogs: Array.from(this.fallbackLogs.values()),
      lastFirestoreSyncAt: this.lastFirestoreSyncAt,
    };
  }

  public restoreFullStateFromBackup(raw: any): {
    personsRestored: number;
    subscriptionsRestored: number;
    testimoniesRestored: number;
    conversationsRestored: number;
  } {
    if (!raw || typeof raw !== 'object') {
      return {
        personsRestored: this.persons.size,
        subscriptionsRestored: this.subscriptions.size,
        testimoniesRestored: this.testimonies.size,
        conversationsRestored: this.conversations.size,
      };
    }

    this.plans.clear();
    this.subscriptions.clear();
    this.persons.clear();
    this.compilationPdfs.clear();
    this.testimonies.clear();
    this.personSourceFingerprints.clear();
    this.relations.clear();
    this.interlocutors.clear();
    this.credentials.clear();
    this.memories.clear();
    this.contradictions.clear();
    this.payments.clear();
    this.coupons.clear();
    this.snapshots.clear();
    this.conversations.clear();
    this.notifications.clear();
    this.promptLibrary.clear();
    this.avatarPromptVersions.clear();
    this.fallbackLogs.clear();
    this.deletedRegistry.persons.clear();
    this.deletedRegistry.subscriptions.clear();
    this.deletedRegistry.pdfs.clear();
    this.deletedRegistry.credentials.clear();

    for (const p of DEFAULT_MI_ESENCIA_PLANS) {
      this.plans.set(p.planId, { ...p });
    }

    if (raw.config) {
      this.config = this.migrateConfigDefaults({ ...DEFAULT_MI_ESENCIA_CONFIG, ...raw.config });
    }
    if (raw.deletedRegistry) {
      if (Array.isArray(raw.deletedRegistry.persons)) {
        raw.deletedRegistry.persons.forEach((id: string) => this.deletedRegistry.persons.add(id));
      }
      if (Array.isArray(raw.deletedRegistry.subscriptions)) {
        raw.deletedRegistry.subscriptions.forEach((id: string) =>
          this.deletedRegistry.subscriptions.add(id)
        );
      }
      if (Array.isArray(raw.deletedRegistry.pdfs)) {
        raw.deletedRegistry.pdfs.forEach((id: string) => this.deletedRegistry.pdfs.add(id));
      }
      if (Array.isArray(raw.deletedRegistry.credentials)) {
        raw.deletedRegistry.credentials.forEach((id: string) =>
          this.deletedRegistry.credentials.add(id)
        );
      }
    }
    if (Array.isArray(raw.plans)) {
      for (const p of raw.plans) if (p?.planId) this.plans.set(p.planId, p);
    }
    if (Array.isArray(raw.subscriptions)) {
      for (const s of raw.subscriptions) if (s?.avatarId) this.subscriptions.set(s.avatarId, s);
    }
    if (Array.isArray(raw.persons)) {
      for (const p of raw.persons) if (p?.personId) this.persons.set(p.personId, p);
    }
    if (Array.isArray(raw.compilationPdfs)) {
      for (const pdf of raw.compilationPdfs) if (pdf?.pdfId) this.compilationPdfs.set(pdf.pdfId, pdf);
    }
    if (Array.isArray(raw.testimonies)) {
      for (const t of raw.testimonies) if (t?.testimonyId) this.testimonies.set(t.testimonyId, t);
    }
    if (Array.isArray(raw.relations)) {
      for (const r of raw.relations) if (r?.relatedPersonId) this.relations.set(r.relatedPersonId, r);
    }
    if (Array.isArray(raw.interlocutors)) {
      for (const i of raw.interlocutors) if (i?.interlocutorId) this.interlocutors.set(i.interlocutorId, i);
    }
    if (Array.isArray(raw.credentials)) {
      for (const c of raw.credentials) if (c?.accessCredentialId) this.credentials.set(c.accessCredentialId, c);
    }
    if (Array.isArray(raw.memories)) {
      for (const m of raw.memories) if (m?.memoryId) this.memories.set(m.memoryId, m);
    }
    if (Array.isArray(raw.contradictions)) {
      for (const c of raw.contradictions) if (c?.contradictionId) this.contradictions.set(c.contradictionId, c);
    }
    if (Array.isArray(raw.payments)) {
      for (const p of raw.payments) if (p?.paymentId) this.payments.set(p.paymentId, p);
    }
    if (Array.isArray(raw.coupons)) {
      for (const c of raw.coupons) if (c?.couponId) this.coupons.set(c.couponId, c);
    }
    if (Array.isArray(raw.snapshots)) {
      for (const s of raw.snapshots) if (s?.snapshotId) this.snapshots.set(s.snapshotId, s);
    }
    if (Array.isArray(raw.conversations)) {
      for (const c of raw.conversations) if (c?.sessionId) this.conversations.set(c.sessionId, c);
    }
    if (Array.isArray(raw.notifications)) {
      for (const n of raw.notifications) if (n?.notificationId) this.notifications.set(n.notificationId, n);
    }
    if (Array.isArray(raw.promptLibrary)) {
      for (const pr of raw.promptLibrary) if (pr?.promptId) this.promptLibrary.set(pr.promptId, pr);
    }
    if (Array.isArray(raw.avatarPromptVersions)) {
      for (const pv of raw.avatarPromptVersions) if (pv?.versionId) this.avatarPromptVersions.set(pv.versionId, pv);
    }
    if (Array.isArray(raw.fallbackLogs)) {
      for (const fl of raw.fallbackLogs) if (fl?.logId) this.fallbackLogs.set(fl.logId, fl);
    }

    this.seedDefaultPromptLibraryIfNeeded();
    this.applyDeletedRegistryFilters();
    this.saveToDisk();

    return {
      personsRestored: this.persons.size,
      subscriptionsRestored: this.subscriptions.size,
      testimoniesRestored: this.testimonies.size,
      conversationsRestored: this.conversations.size,
    };
  }

  /**
   * Synchronizes the full in-memory Mi Esencia state back to Cloud Firestore (used after
   * restoring a database backup) and deletes remote documents that do not exist in the restored snapshot.
   */
  public async syncFullStateToFirestore(): Promise<{
    written: number;
    deleted: number;
    warnings: string[];
  }> {
    let written = 0;
    let deleted = 0;
    const warnings: string[] = [];

    const syncCollection = async (
      collectionName: string,
      entries: Array<[string, unknown]>
    ): Promise<void> => {
      const targetIds = new Set(entries.map(([id]) => id));
      try {
        const existingSnap = await firestoreTelemetry.trackedGetDocs(
          serverDb,
          collection(serverDb, collectionName),
          'miEsencia'
        );
        for (const docSnap of existingSnap.docs) {
          if (!targetIds.has(docSnap.id)) {
            try {
              await firestoreTelemetry.trackedDeleteDoc(
                serverDb,
                doc(serverDb, collectionName, docSnap.id),
                'miEsencia'
              );
              deleted++;
            } catch (err: any) {
              warnings.push(`No se pudo eliminar ${collectionName}/${docSnap.id}: ${err?.message || err}`);
            }
          }
        }
      } catch (err: any) {
        warnings.push(`No se pudo leer ${collectionName} para reconciliar: ${err?.message || err}`);
      }

      for (const [docId, value] of entries) {
        try {
          const sanitized = sanitizeFirestoreObj(value);
          const byteSize = Buffer.byteLength(JSON.stringify(sanitized), 'utf8');
          if (byteSize > 800_000) {
            warnings.push(`${collectionName}/${docId} excede 800 KB (${byteSize} bytes); omitido en Firestore.`);
            continue;
          }
          await firestoreTelemetry.trackedSetDoc(
            serverDb,
            doc(serverDb, collectionName, docId),
            sanitized,
            'miEsencia'
          );
          written++;
        } catch (err: any) {
          warnings.push(`No se pudo escribir ${collectionName}/${docId}: ${err?.message || err}`);
        }
      }
    };

    await syncCollection('mi_esencia_config', [
      ['global', this.config],
      ['deletedRegistry', { ...this.serializeDeletedRegistry(), updatedAt: new Date().toISOString() }],
    ]);
    await syncCollection('mi_esencia_plans', Array.from(this.plans.entries()));
    await syncCollection('mi_esencia_subscriptions', Array.from(this.subscriptions.entries()));
    await syncCollection('mi_esencia_persons', Array.from(this.persons.entries()));
    await syncCollection('mi_esencia_pdfs', Array.from(this.compilationPdfs.entries()));
    await syncCollection('mi_esencia_testimonies', Array.from(this.testimonies.entries()));
    await syncCollection('mi_esencia_relations', Array.from(this.relations.entries()));
    await syncCollection('mi_esencia_interlocutors', Array.from(this.interlocutors.entries()));
    await syncCollection('mi_esencia_credentials', Array.from(this.credentials.entries()));
    await syncCollection('mi_esencia_memories', Array.from(this.memories.entries()));
    await syncCollection('mi_esencia_contradictions', Array.from(this.contradictions.entries()));
    await syncCollection('mi_esencia_payments', Array.from(this.payments.entries()));
    await syncCollection('mi_esencia_coupons', Array.from(this.coupons.entries()));
    await syncCollection('mi_esencia_snapshots', Array.from(this.snapshots.entries()));
    await syncCollection('mi_esencia_conversations', Array.from(this.conversations.entries()));
    await syncCollection('mi_esencia_notifications', Array.from(this.notifications.entries()));
    await syncCollection('mi_esencia_prompt_library', Array.from(this.promptLibrary.entries()));
    await syncCollection('mi_esencia_prompt_versions', Array.from(this.avatarPromptVersions.entries()));
    await syncCollection('mi_esencia_fallback_logs', Array.from(this.fallbackLogs.entries()));

    this.lastFirestoreSyncAt = new Date().toISOString();
    this.saveToDisk();

    return { written, deleted, warnings };
  }
}

export const miEsenciaStore = new MiEsenciaStore();
