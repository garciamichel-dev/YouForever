import fs from 'fs';
import path from 'path';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  AppConfig,
  INITIAL_APP_CONFIG,
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
  isSufficiencyThresholdMet,
  validatePhotoAttachments,
  ensurePhotosPlacedInManuscript,
} from '../logic/interviewRules.ts';
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
import { DEFAULT_QUESTIONS } from './seedData.ts';
import {
  evaluateNarrativeSufficiency,
  generateAdaptiveFollowUp,
  generateManuscriptDraft,
  analyzeAndTranscribeAudioWithGemini,
  AudioQualityStatus,
} from './geminiService.ts';

const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const serverDb = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

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
  status: 'draft' | 'approved' | 'exported';
  generatedAt: string;
  generatedBy: string;
}

interface PersistedTokenRecord extends InterviewTokenRecord {
  plainToken?: string;
}

interface QuestionnaireVersionDoc {
  id: string;
  questions: QuestionRecord[];
  createdAt: string;
}

class StorageManager {
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
  private admins: Set<string> = new Set(['garcia.michel@gmail.com']);

  // Privacy and Interviewee Admin entities
  private privacyConsents: Map<string, PrivacyConsentRecord> = new Map();
  private bookShares: Map<string, BookShareRecord> = new Map();
  private scheduledDeliveries: Map<string, ScheduledDeliveryRecord> = new Map();
  private secondaryAccess: Map<string, SecondaryAccessRecord> = new Map();
  private postMortemInstructions: Map<string, PostMortemInstructionRecord> = new Map();
  private arcoRequests: Map<string, ArcoRequestRecord> = new Map();

  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private listenersAttached = false;

  public isAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    return this.admins.has(email.toLowerCase().trim());
  }

  public getAdmins(): string[] {
    return Array.from(this.admins);
  }

  constructor() {
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

  private saveStateToDisk(): void {
    try {
      const filePath = this.getSnapshotFilePath();
      const snapshot = {
        savedAt: new Date().toISOString(),
        config: this.config,
        questions: Array.from(this.questions.values()),
        interviews: Array.from(this.interviews.values()),
        participants: Array.from(this.participants.values()),
        tokens: Array.from(this.tokens.values()),
        answers: Array.from(this.answers.values()),
        photos: Array.from(this.photos.values()).map((p) => ({
          ...p,
          dataUrl: p.dataUrl && p.dataUrl.length < 50_000 ? p.dataUrl : '',
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
      };
      fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[StorageManager] Could not save state snapshot to disk:', err);
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
        this.config = { ...INITIAL_APP_CONFIG, ...parsed.config };
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
      return true;
    } catch (err) {
      console.warn('[StorageManager] Could not load state snapshot from disk:', err);
      return false;
    }
  }

  private async persistDoc<T>(collectionName: string, docId: string, data: T): Promise<void> {
    this.saveStateToDisk();
    try {
      const sanitized = this.sanitizeDocForFirestore(data);
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

      await setDoc(doc(serverDb, collectionName, docId), sanitized as Record<string, unknown>);
    } catch (err: any) {
      if (err?.message?.includes('Quota limit exceeded') || err?.code === 'resource-exhausted') {
        console.warn(`[Firestore Quota] Write skipped for ${collectionName}/${docId} due to daily limit. Stored in memory and disk.`);
      } else if (err?.message?.includes('exceeds the limit') || err?.code === 3) {
        console.warn(`[Firestore Payload Warning] Write skipped for ${collectionName}/${docId} due to size limit (${err?.message}). Retained safely on server.`);
      } else {
        console.warn(`[Firestore Persistence Warning] Could not save ${collectionName}/${docId}:`, err?.message || err);
      }
    }
  }

  private async removeDoc(collectionName: string, docId: string): Promise<void> {
    this.saveStateToDisk();
    try {
      await deleteDoc(doc(serverDb, collectionName, docId));
    } catch (err: any) {
      if (err?.message?.includes('Quota limit exceeded') || err?.code === 'resource-exhausted') {
        console.warn(`[Firestore Quota] Delete skipped for ${collectionName}/${docId} due to daily limit. Removed from memory and disk.`);
      } else {
        console.warn(`[Firestore Delete Warning] Could not delete ${collectionName}/${docId}:`, err?.message || err);
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

    if (!tokenDoc.accessCode || tokenDoc.accessCode.trim().length === 0) {
      tokenDoc.accessCode = partDeterministicCode || hashDeterministicCode;
    } else {
      tokenDoc.accessCode = extractCleanTokenOrCode(tokenDoc.accessCode).toUpperCase();
    }
    if (!tokenDoc.plainToken || tokenDoc.plainToken.trim().length === 0) {
      tokenDoc.plainToken = deriveDeterministicPlainToken(tokenDoc.participantId || tokenDoc.tokenHash);
    }

    // Deduplicate any existing non-revoked token for the same participantId so a participant never has two conflicting tokens
    const aliasCodes = new Set<string>();
    const aliasPlainTokens = new Set<string>();

    if (tokenDoc.participantId && !tokenDoc.revoked) {
      for (const [existingHash, existingTok] of Array.from(this.tokens.entries())) {
        if (existingTok.participantId === tokenDoc.participantId && !existingTok.revoked && existingHash !== tokenDoc.tokenHash) {
          if (existingTok.accessCode) aliasCodes.add(existingTok.accessCode.toUpperCase());
          if (existingTok.plainToken) aliasPlainTokens.add(existingTok.plainToken);

          // Prefer the original non-fallback token record (where id does not start with tok_part_ or accessCode is not the fallback partDeterministicCode)
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
            tokenDoc.accessCode = existingTok.accessCode || tokenDoc.accessCode;
          } else if (!incomingIsFallback && existingIsFallback) {
            this.tokens.delete(existingHash);
          } else {
            // Both are real or both are fallback: preserve non-deterministic accessCode if one has it
            if (tokenDoc.accessCode === partDeterministicCode && existingTok.accessCode && existingTok.accessCode !== partDeterministicCode) {
              tokenDoc.accessCode = existingTok.accessCode.toUpperCase();
            }
            this.tokens.delete(existingHash);
          }
        }
      }
    }

    this.tokens.set(tokenDoc.tokenHash, tokenDoc);

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

    this.saveStateToDisk();
  }

  public restoreFromClientCache(cachedInterviews?: any[]): number {
    if (!Array.isArray(cachedInterviews) || cachedInterviews.length === 0) return 0;
    let restoredCount = 0;

    for (const item of cachedInterviews) {
      if (!item || !item.id || !item.title) continue;
      const { participants: partList, answersCount: _ac, manuscriptsCount: _mc, latestManuscriptVersion: _lmv, photosCount: _pc, ...interviewData } = item;

      if (!this.interviews.has(interviewData.id)) {
        this.interviews.set(interviewData.id, interviewData as InterviewRecord);
        restoredCount++;
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
            // Only replace existingTok.accessCode if the incoming resolvedCode is a real non-fallback code
            // or if existingTok currently only has a fallback code
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
            // Also ensure the incoming resolvedCode is mapped as an alias for this token
            if (resolvedCode) {
              this.accessCodeMap.set(resolvedCode.toUpperCase(), existingTok.tokenHash);
              this.accessCodeMap.set(resolvedCode.replace(/[^A-Z0-9]/gi, '').toUpperCase(), existingTok.tokenHash);
            }
          }
        }
      }
    }

    if (restoredCount > 0 || cachedInterviews.length > 0) {
      this.saveStateToDisk();
    }
    return restoredCount;
  }

  public async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.loadFromFirestore();
    await this.initPromise;
  }

  public async loadFromFirestore(): Promise<void> {
    // 0. Always hydrate from local disk snapshot first so restarts survive Firestore quota limits
    this.loadStateFromDisk();

    try {
      const results = await Promise.allSettled([
        getDocs(collection(serverDb, 'settings')),
        getDocs(collection(serverDb, 'questions')),
        getDocs(collection(serverDb, 'questionnaireVersions')),
        getDocs(collection(serverDb, 'interviews')),
        getDocs(collection(serverDb, 'participants')),
        getDocs(collection(serverDb, 'interviewTokens')),
        getDocs(collection(serverDb, 'answers')),
        getDocs(collection(serverDb, 'interviewPhotos')),
        getDocs(collection(serverDb, 'interviewAudio')),
        getDocs(collection(serverDb, 'manuscripts')),
        getDocs(collection(serverDb, 'auditLogs')),
        getDocs(collection(serverDb, 'privacyConsents')),
        getDocs(collection(serverDb, 'bookShares')),
        getDocs(collection(serverDb, 'scheduledDeliveries')),
        getDocs(collection(serverDb, 'secondaryAccess')),
        getDocs(collection(serverDb, 'postMortemInstructions')),
        getDocs(collection(serverDb, 'arcoRequests')),
      ]);

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
      const photosSnap = unwrapSnap(7);
      const audiosSnap = unwrapSnap(8);
      const manuscriptsSnap = unwrapSnap(9);
      const logsSnap = unwrapSnap(10);
      const consentsSnap = unwrapSnap(11);
      const sharesSnap = unwrapSnap(12);
      const deliveriesSnap = unwrapSnap(13);
      const secondarySnap = unwrapSnap(14);
      const postMortemSnap = unwrapSnap(15);
      const arcoSnap = unwrapSnap(16);

      // 1. Settings
      if (settingsSnap) {
        settingsSnap.forEach((docSnap) => {
          if (docSnap.id === 'appConfig') {
            this.config = { ...INITIAL_APP_CONFIG, ...(docSnap.data() as AppConfig) };
          }
        });
      }

      // 2. Questions
      if (questionsSnap && !questionsSnap.empty) {
        questionsSnap.forEach((docSnap) => {
          const q = docSnap.data() as QuestionRecord;
          if (q && q.id) {
            this.questions.set(q.id, q);
          }
        });
      }

      // 3. Questionnaire Versions
      if (versionsSnap && !versionsSnap.empty) {
        versionsSnap.forEach((docSnap) => {
          const v = docSnap.data() as QuestionnaireVersionDoc;
          if (v && v.id && Array.isArray(v.questions)) {
            this.questionnaireVersions.set(v.id, v.questions);
          }
        });
      }

      // 4. Interviews
      if (interviewsSnap) {
        interviewsSnap.forEach((docSnap) => {
          const inv = docSnap.data() as InterviewRecord;
          if (inv && inv.id) {
            this.interviews.set(inv.id, inv);
          }
        });
      }

      // 5. Participants
      if (participantsSnap) {
        participantsSnap.forEach((docSnap) => {
          const part = docSnap.data() as ParticipantRecord;
          if (part && part.id) {
            this.participants.set(part.id, part);
          }
        });
      }

      // 6. Tokens
      if (tokensSnap) {
        tokensSnap.forEach((docSnap) => {
          const tok = docSnap.data() as PersistedTokenRecord;
          if (tok && tok.tokenHash) {
            this.registerTokenInMemory(tok);
          }
        });
      }

      // 7. Answers
      if (answersSnap) {
        answersSnap.forEach((docSnap) => {
          const ans = docSnap.data() as AnswerRecord;
          if (ans && ans.id) {
            this.answers.set(ans.id, ans);
          }
        });
      }

      // 7b. Interview Photos
      if (photosSnap) {
        photosSnap.forEach((docSnap) => {
          const photo = docSnap.data() as InterviewPhotoRecord;
          if (photo && photo.id) {
            this.photos.set(photo.id, photo);
          }
        });
      }

      // 7c. Interview Voice Audio Recordings & Transcriptions
      if (audiosSnap) {
        audiosSnap.forEach((docSnap) => {
          const aud = docSnap.data() as InterviewAudioRecord;
          if (aud && aud.id) {
            this.audios.set(aud.id, aud);
          }
        });
      }

      // 8. Manuscripts
      if (manuscriptsSnap) {
        manuscriptsSnap.forEach((docSnap) => {
          const manu = docSnap.data() as ManuscriptRecord;
          if (manu && manu.id) {
            this.manuscripts.set(manu.id, manu);
          }
        });
      }

      // 9. Audit Logs
      if (logsSnap) {
        const loadedLogs: AuditLogRecord[] = [];
        logsSnap.forEach((docSnap) => {
          const log = docSnap.data() as AuditLogRecord;
          if (log && log.id) {
            loadedLogs.push(log);
          }
        });
        if (loadedLogs.length > 0) {
          loadedLogs.sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );
          this.auditLogs = loadedLogs;
        }
      }

      // 10. Privacy Consents
      if (consentsSnap) {
        consentsSnap.forEach((docSnap) => {
          const c = docSnap.data() as PrivacyConsentRecord;
          if (c && c.id) {
            this.privacyConsents.set(c.id, c);
          }
        });
      }

      // 11. Book Shares
      if (sharesSnap) {
        sharesSnap.forEach((docSnap) => {
          const s = docSnap.data() as BookShareRecord;
          if (s && s.id) {
            this.bookShares.set(s.id, s);
          }
        });
      }

      // 12. Scheduled Deliveries
      if (deliveriesSnap) {
        deliveriesSnap.forEach((docSnap) => {
          const d = docSnap.data() as ScheduledDeliveryRecord;
          if (d && d.id) {
            this.scheduledDeliveries.set(d.id, d);
          }
        });
      }

      // 13. Secondary Access
      if (secondarySnap) {
        secondarySnap.forEach((docSnap) => {
          const sa = docSnap.data() as SecondaryAccessRecord;
          if (sa && sa.id) {
            this.secondaryAccess.set(sa.id, sa);
          }
        });
      }

      // 14. Post Mortem Instructions
      if (postMortemSnap) {
        postMortemSnap.forEach((docSnap) => {
          const pmi = docSnap.data() as PostMortemInstructionRecord;
          if (pmi && pmi.id) {
            this.postMortemInstructions.set(pmi.id, pmi);
          }
        });
      }

      // 15. ARCO Requests
      if (arcoSnap) {
        arcoSnap.forEach((docSnap) => {
          const ar = docSnap.data() as ArcoRequestRecord;
          if (ar && ar.id) {
            this.arcoRequests.set(ar.id, ar);
          }
        });
      }
    } catch (err: any) {
      console.warn(
        '[StorageManager] Note during initial Firestore load (operating with disk & memory state):',
        err?.message || err
      );
    }

    // Ensure all participants have registered tokens and access codes
    this.ensureParticipantTokensConsistent();

    // If no interviews exist yet (e.g. fresh environment or Firestore read quota reached before first disk save),
    // seed deterministic default interviews so Admin Panel and Participant Portal always have valid interviews & codes
    if (this.interviews.size === 0) {
      this.seedDefaultInterviewsInMemory();
    } else {
      this.saveStateToDisk();
    }

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
    return Array.from(this.interviews.values()).sort(
      (a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()
    );
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
    participants: Array<{ name: string; relationship: string; role: 'primary' | 'contributor'; email?: string }>;
    customOpenDays?: number;
    customSufficiencyThreshold?: number;
    performedBy: string;
  }): Promise<{
    interview: InterviewRecord;
    participantTokens: Array<{ participant: ParticipantRecord; plainToken: string; inviteUrl: string }>;
  }> {
    const {
      title,
      storyMode,
      storyType,
      participants: partInputs,
      customOpenDays,
      customSufficiencyThreshold,
      performedBy,
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
      lastActivityAt: now.toISOString(),
      questionnaireVersionId: versionId,
      createdById: performedBy,
      createdByName: performedBy,
    };

    this.interviews.set(interviewId, newInterview);
    await this.persistDoc('interviews', interviewId, newInterview);

    // Create participants & cryptographic tokens
    const createdTokens: Array<{ participant: ParticipantRecord; plainToken: string; inviteUrl: string }> = [];

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
        email: pInput.email,
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
      createdTokens.push({ participant, plainToken, inviteUrl });
    }

    await this.addAuditLog('CREATE_INTERVIEW', 'interview', interviewId, performedBy, {
      title,
      storyMode,
      participantsCount: partInputs.length,
      openDays,
      threshold,
    });

    return { interview: newInterview, participantTokens: createdTokens };
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

  public getPhotoBuffer(photoId: string): { buffer: Buffer; mimeType: string } | null {
    const photo = this.photos.get(photoId);
    const photoDir = path.join(process.cwd(), 'data', 'photos');
    const diskPath = path.join(photoDir, `${photoId}.bin`);

    if (fs.existsSync(diskPath)) {
      try {
        const buf = fs.readFileSync(diskPath);
        return { buffer: buf, mimeType: photo?.mimeType || 'image/jpeg' };
      } catch (err) {
        console.warn('Error reading photo from disk:', err);
      }
    }

    if (photo?.dataUrl) {
      let raw = photo.dataUrl;
      if (raw.startsWith('data:')) {
        const cIdx = raw.indexOf(',');
        if (cIdx !== -1) raw = raw.substring(cIdx + 1);
      }
      return {
        buffer: Buffer.from(raw.replace(/\s+/g, ''), 'base64'),
        mimeType: photo.mimeType || 'image/jpeg',
      };
    }
    return null;
  }

  public getPhotoById(photoId: string): InterviewPhotoRecord | undefined {
    return this.photos.get(photoId);
  }

  public async getPhotoByIdAsync(photoId: string): Promise<InterviewPhotoRecord | undefined> {
    const cached = this.photos.get(photoId);
    if (cached) return cached;
    try {
      const snap = await getDoc(doc(serverDb, 'interviewPhotos', photoId));
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
    return Array.from(this.photos.values())
      .filter((p) => p.interviewId === interviewId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
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
      const snap = await getDoc(doc(serverDb, 'interviewAudio', audioId));
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
      allowEditing: this.config.allowAnswerEditing,
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
          if (firestorePhotoRecord.dataUrl && firestorePhotoRecord.dataUrl.length > 50_000) {
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
          if (firestorePhotoRecord.dataUrl && firestorePhotoRecord.dataUrl.length > 50_000) {
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
          transcription: item.transcription || '',
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
        for (const oldPhoto of existing.photos || []) {
          if (!keptIds.has(oldPhoto.id)) {
            this.photos.delete(oldPhoto.id);
            await this.removeDoc('interviewPhotos', oldPhoto.id);
          }
        }
        existing.photos = resolvedPhotoAttachments;
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

    // 3. Check sufficiency evaluation trigger
    let sufficiencyEvaluated = false;
    if (isSufficiencyThresholdMet(interview.completedQuestionCount, interview.sufficiencyThreshold)) {
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

    // 4. Autonomous deepening question generation (for base questions and follow-up chains up to maxFollowUpsAtCreation)
    let adaptiveQuestion:
      | { text: string; reason?: string; followUpIndex?: number; maxFollowUps?: number }
      | undefined;

    if (
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
    const updated = applyVoluntaryCompletion(
      interview,
      `Concluido por ${participant.name}: ${reason || 'Declaración explícita del participante'}`
    );
    this.interviews.set(updated.id, updated);
    await this.persistDoc('interviews', updated.id, updated);

    await this.addAuditLog('VOLUNTARY_COMPLETION', 'interview', updated.id, participant.name, {
      completedQuestionCount: updated.completedQuestionCount,
      reason,
    });
    return updated;
  }

  // --- Admin Interview Extensions, Reopens, and Sufficiency Evaluation ---
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
    performedBy: string
  ): Promise<InterviewRecord> {
    const interview = this.interviews.get(interviewId);
    if (!interview) throw new Error('Entrevista no encontrada.');

    const updated = applyAdminReopen(interview, newDays, reason);
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
      newExpiresAt: updated.expiresAt,
    });
    return updated;
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

    const draft = await generateManuscriptDraft({
      interview,
      participants,
      answers,
      questions,
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

    const manuscript: ManuscriptRecord = {
      id: manuscriptId,
      interviewId,
      version: versionNumber,
      title: draft.title || interview.title,
      summary: draft.summary,
      content: draft.compiledMarkdown,
      status: 'draft',
      generatedAt: new Date().toISOString(),
      generatedBy: performedBy,
    };

    this.manuscripts.set(manuscriptId, manuscript);
    await this.persistDoc('manuscripts', manuscriptId, manuscript);

    await this.addAuditLog('GENERATE_MANUSCRIPT', 'manuscript', manuscriptId, performedBy, {
      interviewId,
      versionNumber,
      answersIncludedCount: answers.length,
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
      if (log.details && log.details.interviewId === interviewId) {
        if (!log.details.participantId || log.details.participantId === participantId) {
          return true;
        }
      }
      return false;
    });
  }
}

export const storage = new StorageManager();
