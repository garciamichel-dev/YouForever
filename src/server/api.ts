import express, { Request, Response, NextFunction, Router } from 'express';
import { storage, serverDb } from './storage.ts';
import { firestoreTelemetry } from './firestoreTelemetry.ts';
import * as XLSX from 'xlsx';
import {
  buildInterviewBackupZip,
  generateQACompilationHtml,
  generateQACompilationMarkdown,
} from './backupService.ts';
import {
  isConsentValid,
} from '../logic/privacyRules.ts';
import {
  PRIVACY_NOTICE_VERSION,
} from '../logic/privacyNoticeContent.ts';
import {
  CURRENT_PRIVACY_POLICY_VERSION,
  sanitizeInterviewForParticipant,
} from '../logic/interviewRules.ts';
import {
  generateTransientDemoFollowUp,
  generateTransientDemoManuscript,
} from './demoGeminiService.ts';
import {
  analyzeAndTranscribeAudioWithGemini,
  testConfiguredBookAiEngines,
} from './geminiService.ts';
import { miEsenciaRouter } from './miEsencia/miEsenciaRouter.ts';
import { miEsenciaStore } from './miEsencia/miEsenciaStore.ts';
import { voiceRouter } from './voice/voiceRouter.ts';
import {
  getEmailConfigStatus,
  sendSelfRegisterParticipantEmail,
  sendTransactionalEmail,
  type EmailSendResult,
} from './emailService.ts';
import { buildUserManualPdfBuffer } from './manualPdfBuilder.ts';
import { normalizeCanonicalPublicOrigin } from '../logic/freeRegistration.ts';
import {
  bookJobManager,
  sanitizeBookResultForParticipant,
  sanitizeBookVersionForParticipant,
  toParticipantBookVersionSummary,
  toParticipantBookJobView,
} from './bookJobManager.ts';
import type { BookAuditIncidentStatus } from '../logic/bookAuditReport.ts';
import {
  MEDIA_ACCESS_COOKIE,
  authenticateAdminRequest,
  buildAdminSessionCookie,
  buildMediaAccessCookie,
  issueAdminSessionCookieValue,
  issueMediaAccessCookieValue,
  mediaAccessInterviewsFromRequest,
  readCookie,
  verifyFirebaseIdToken,
} from './adminAuth.ts';
import { toParticipantAuditLogView } from './participantViews.ts';
import { ensureFirestoreMode } from './firestoreAdmin.ts';
import {
  AccessAttemptLimiter,
  ForcedRegenerationLimiter,
  FreeRegistrationLimiter,
  clientKeyFromRequest,
} from './accessGuard.ts';
import { APP_RELEASE_DATE, APP_RELEASE_SUMMARY, APP_VERSION, APP_VERSION_LABEL } from '../version.ts';

// V5.3.4: moment this server process started (a new deployment always restarts it).
const SERVER_STARTED_AT = new Date().toISOString();

export const apiRouter: Router = express.Router();
apiRouter.use(express.json({ limit: '100mb' }));

// In-memory rate limiter for public demo endpoints (stores no personal content)
const demoRateLimitMap = new Map<string, { count: number; windowStart: number }>();
function checkDemoRateLimit(req: Request, maxPerWindow = 40, windowMs = 10 * 60 * 1000): boolean {
  const key = String(req.ip || req.headers['x-forwarded-for'] || 'anon');
  const now = Date.now();
  const entry = demoRateLimitMap.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    demoRateLimitMap.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= maxPerWindow) {
    return false;
  }
  entry.count += 1;
  return true;
}

// Anti-brute-force protection for access codes (YF-XXXXX) in Participant Portal & Mi Esencia.
// V5.6.2: one shared limiter for EVERY route that accepts a code (see accessGuard.ts for the rules).
const accessCodeLimiter = new AccessAttemptLimiter();

/** credentialId: the token / credential the request resolved to, if it is a real one. */
export function checkAccessCodeBruteForce(
  req: Request,
  credentialId?: string
): {
  blocked: boolean;
  retryAfterMinutes: number;
} {
  return accessCodeLimiter.check(clientKeyFromRequest(req), credentialId);
}

/** Call ONLY for a code that matches nothing (never for expired or revoked ones). */
export function recordAccessCodeFailure(req: Request): void {
  accessCodeLimiter.recordFailure(clientKeyFromRequest(req));
}

/** A successful sign-in: that credential keeps working from this client even during a block. */
export function recordAccessCodeSuccess(req: Request, credentialId: string): void {
  accessCodeLimiter.recordSuccess(clientKeyFromRequest(req), credentialId);
}

const ACCESS_CODE_BLOCKED_MESSAGE = (minutes: number) =>
  `Demasiados intentos fallidos de código de acceso. Por seguridad anti-fuerza bruta, espera ${minutes} minuto(s) antes de volver a intentar.`;

// V5.6.2: cap on forced book regenerations per interview (administrators are exempt).
const forcedRegenerationLimiter = new ForcedRegenerationLimiter();
async function resolveEffectiveForceRefresh(req: Request, token: string, requested: boolean): Promise<boolean> {
  if (!requested) return false;
  try {
    if (await getAdminUser(req)) return true;
  } catch {
    // not an administrator
  }
  const interviewId = storage.classifyAccessInput(token).interviewId;
  if (!interviewId) return true; // the route rejects the code itself, exactly as before
  const allowed = forcedRegenerationLimiter.tryConsume(interviewId);
  if (!allowed) {
    console.info(`[BookJobs] Regeneración forzada por encima del límite diario para ${interviewId}: se reutiliza el resultado vigente.`);
  }
  return allowed;
}

/**
 * Routes that verify the code themselves (with a Firestore re-sync) and record the outcome.
 * (Double quotes on purpose: source-level tests locate each route's block by its single-quoted path.)
 */
const SELF_COUNTING_ACCESS_ROUTES = new Set(["/participant/session", "/mi-esencia/family/verify-code"]);

// Ensure Firestore state is hydrated before processing non-demo API requests without blocking
apiRouter.use(async (req: Request, _res: Response, next: NextFunction) => {
  if (
    req.path.startsWith('/demo/') ||
    req.path === '/health' ||
    req.path === '/app-info' ||
    req.path === '/public/manual-pdf'
  ) {
    next();
    return;
  }
  try {
    await Promise.race([
      storage.ensureInitialized(),
      new Promise<void>((resolve) => setTimeout(resolve, 3500)),
    ]);
    next();
  } catch (err: any) {
    console.warn('Storage initialization note (proceeding with memory cache):', err?.message || err);
    next();
  }
});

// V5.6.2 — Anti-brute-force guard for every participant / family route that receives a code.
// Before, only /participant/session and /mi-esencia/family/verify-code counted failed attempts, so the
// other ~40 routes could be used to guess codes without limit. Valid, expired and revoked codes
// behave exactly as before; only codes that match nothing are counted.
apiRouter.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const isParticipantRoute = req.path.startsWith('/participant/');
    const isFamilyRoute = req.path.startsWith('/mi-esencia/family/');
    if (!isParticipantRoute && !isFamilyRoute) {
      next();
      return;
    }

    let credentialId: string | undefined;
    let unknown = false;
    let usable = false;
    if (isParticipantRoute) {
      const rawToken = req.body?.token ?? req.query?.token;
      if (typeof rawToken !== 'string' || !rawToken.trim()) {
        next();
        return;
      }
      const classification = storage.classifyAccessInput(rawToken);
      credentialId = classification.tokenId;
      unknown = classification.status === 'unknown';
      usable = classification.status === 'valid';
    } else {
      const rawCode = req.body?.personalCode;
      if (typeof rawCode !== 'string' || !rawCode.trim()) {
        next();
        return;
      }
      await miEsenciaStore.ensureInitialized();
      const classification = miEsenciaStore.classifyPersonalAccessCode(rawCode);
      credentialId = classification.credentialId;
      unknown = !classification.known;
      usable = classification.known;
    }

    const blockState = checkAccessCodeBruteForce(req, credentialId);
    if (blockState.blocked) {
      res.status(429).json({ success: false, error: ACCESS_CODE_BLOCKED_MESSAGE(blockState.retryAfterMinutes) });
      return;
    }

    if (!SELF_COUNTING_ACCESS_ROUTES.has(req.path)) {
      if (unknown) recordAccessCodeFailure(req);
      else if (usable && credentialId) recordAccessCodeSuccess(req, credentialId);
    }
    next();
  } catch (err: any) {
    // The guard must never break a request: on any internal problem the route decides as before.
    console.warn('[AccessGuard] note:', err?.message || err);
    next();
  }
});

apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    status: 'ok',
    storageInitialized: storage.isInitialized(),
    interviewsCount: storage.getInterviews().length,
    timestamp: new Date().toISOString(),
  });
});

// --- Helper: Admin verification & Middleware ---
// V5.3.1: the administrator is identified ONLY by a verified Firebase ID token (or by the HttpOnly
// session cookie issued in exchange for one, for safe GET/HEAD requests). E-mails sent by the
// client in the query string, the `x-admin-user` / `x-admin-email` headers or the body are ignored
// as proof of identity (they are still sent by older screens and are simply not trusted).
export async function getAdminUser(req: Request): Promise<string | null> {
  const identity = await authenticateAdminRequest(req, (email) => storage.isAdmin(email));
  return identity ? identity.email : null;
}

const ADMIN_UNAUTHORIZED_MESSAGE =
  'Acceso no autorizado: Se requiere inicio de sesión administrativo con una cuenta Google autorizada.';

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  getAdminUser(req)
    .then((admin) => {
      if (!admin) {
        res.status(401).json({ success: false, error: ADMIN_UNAUTHORIZED_MESSAGE });
        return;
      }
      (req as any).adminUser = admin;
      next();
    })
    .catch(() => {
      res.status(401).json({ success: false, error: ADMIN_UNAUTHORIZED_MESSAGE });
    });
}

const isSecureRequest = (req: Request): boolean =>
  req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

// Exchange a verified Firebase ID token for an HttpOnly admin session cookie (used by download
// links, iframes and new windows, which cannot send the token in a header).
apiRouter.post('/auth/admin-session', async (req: Request, res: Response) => {
  const authHeader = req.headers['authorization'];
  const bearer = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
  try {
    const identity = await verifyFirebaseIdToken(bearer);
    if (!storage.isAdmin(identity.email)) {
      res.status(403).json({ success: false, error: 'Esta cuenta no tiene acceso administrativo.' });
      return;
    }
    res.setHeader('Set-Cookie', buildAdminSessionCookie(issueAdminSessionCookieValue(identity), isSecureRequest(req)));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: { isAdmin: true, adminEmail: identity.email } });
  } catch {
    res.status(401).json({ success: false, error: ADMIN_UNAUTHORIZED_MESSAGE });
  }
});

// V5.3.2: which SDK the server uses to reach Firestore. `privateRulesSafeToDeploy` must be true
// before publishing the private firestore.rules (see docs/V5.3.2-despliegue-firestore.md).
apiRouter.get('/admin/firestore-status', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const status = await ensureFirestoreMode();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: {
        ...status,
        guidance:
          status.mode === 'admin'
            ? 'El servidor usa su identidad de servicio (Admin SDK). Se pueden publicar las reglas privadas siguiendo el procedimiento por etapas.'
            : 'El servidor usa el modo de compatibilidad (SDK de cliente). NO publiques las reglas privadas: primero concede a la identidad de servicio el rol roles/datastore.user sobre la base de datos y reinicia el servicio.',
      },
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// V5.3.4 (admin only): version of the code the SERVER is running, shown in the administrator's
// version label next to the version of the frontend bundle.
apiRouter.get('/admin/version', requireAdmin, (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    success: true,
    data: {
      version: APP_VERSION,
      label: APP_VERSION_LABEL,
      releaseDate: APP_RELEASE_DATE,
      summary: APP_RELEASE_SUMMARY,
      serverStartedAt: SERVER_STARTED_AT,
    },
  });
});

apiRouter.delete('/auth/admin-session', (req: Request, res: Response) => {
  res.setHeader('Set-Cookie', buildAdminSessionCookie('', isSecureRequest(req), 0));
  res.json({ success: true });
});

// Check admin status of the VERIFIED caller. V5.3.1: no longer trusts `?email=` and no longer
// publishes the list of administrator addresses.
apiRouter.get('/auth/admin-check', async (req: Request, res: Response) => {
  const detectedAdmin = await getAdminUser(req);
  res.json({
    success: true,
    data: {
      isAdmin: Boolean(detectedAdmin),
      adminEmail: detectedAdmin,
    },
  });
});

// 0. App Info & Environment
apiRouter.get('/app-info', (_req: Request, res: Response) => {
  const currentAppUrl = process.env.APP_URL || '';
  const sharedUrl = currentAppUrl.replace('ais-dev-', 'ais-pre-');
  res.json({
    success: true,
    data: {
      appUrl: currentAppUrl,
      sharedUrl,
      isDevUrl: currentAppUrl.includes('ais-dev-'),
    },
  });
});

// 1. Config
// V5.8.5 (#14b): administrators only — it holds the literary prompts and who edited them. The only
// screen that reads it is Configuración Global (which already sends the administrator session).
apiRouter.get('/config', requireAdmin, (_req: Request, res: Response) => {
  try {
    const config = storage.getConfig();
    res.json({ success: true, data: config });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// V5.7.0 — Public: ONLY the book proportions chosen in Configuración Global, so the interviewee's
// viewer and PDF use them (the rest of the configuration is not exposed here).
apiRouter.get('/book-layout', (_req: Request, res: Response) => {
  try {
    const mode = storage.getConfig().bookLayoutMode;
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: { bookLayoutMode: mode === 'viewer_proportions' ? 'viewer_proportions' : 'cover_viewer_interior_12pt' },
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/config', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const updated = await storage.updateConfig(req.body, admin);
    res.json({ success: true, data: updated });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// 1b. Live AI Engine Connection Verifier (Tests both Google Gemini & OpenAI ChatGPT)
apiRouter.post('/config/test-ai-engines', requireAdmin, async (req: Request, res: Response) => {
  try {
    const currentConfig = storage.getConfig();
    const primaryProvider =
      req.body?.bookAiProvider === 'openai' || req.body?.bookAiProvider === 'gemini'
        ? req.body.bookAiProvider
        : currentConfig.bookAiProvider || 'gemini';
    const geminiModel =
      typeof req.body?.bookAiGeminiModel === 'string' && req.body.bookAiGeminiModel.trim()
        ? req.body.bookAiGeminiModel.trim()
        : currentConfig.bookAiGeminiModel || 'gemini-3-flash-preview';
    const openaiModel =
      typeof req.body?.bookAiOpenAiModel === 'string' && req.body.bookAiOpenAiModel.trim()
        ? req.body.bookAiOpenAiModel.trim()
        : currentConfig.bookAiOpenAiModel || 'gpt-6-luna';

    const diagnostic = await testConfiguredBookAiEngines({
      primaryProvider,
      geminiModel,
      openaiModel,
    });
    res.json({ success: true, data: diagnostic });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// 2. Questions Bank
apiRouter.get('/questions', (_req: Request, res: Response) => {
  try {
    const questions = storage.getQuestions();
    res.json({ success: true, data: questions });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/questions', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const saved = await storage.saveQuestion(req.body, admin);
    res.json({ success: true, data: saved });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// Delete single question
apiRouter.delete('/questions/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const deleted = await storage.deleteQuestion(req.params.id, admin);
    res.json({ success: true, data: { deleted, id: req.params.id } });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// Batch delete selected questions
apiRouter.post('/questions/batch-delete', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const { questionIds } = req.body;
    if (!Array.isArray(questionIds) || questionIds.length === 0) {
      res.status(400).json({ success: false, error: 'Debe proporcionar una lista de IDs de preguntas a eliminar.' });
      return;
    }
    const count = await storage.deleteQuestions(questionIds, admin);
    res.json({ success: true, data: { count } });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// Delete all questions
apiRouter.post('/questions/delete-all', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const count = await storage.deleteAllQuestions(admin);
    res.json({ success: true, data: { count } });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// Helper: Normalize key name for header matching (strips accents, spaces, symbols)
function normalizeKeyName(k: string): string {
  return String(k || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Helper: Find value from row matching any candidate key
function getRowValue(normalizedRow: Record<string, unknown>, candidates: string[]): string {
  for (const cand of candidates) {
    const val = normalizedRow[cand];
    if (val !== undefined && val !== null && String(val).trim().length > 0) {
      return String(val).trim();
    }
  }
  return '';
}

// 3. Question Bank CSV/Excel Import with row-by-row validation & live preview
apiRouter.post('/questions/import', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const { fileBase64, csvText, commit } = req.body;

    if (!fileBase64 && !csvText) {
      res.status(400).json({
        success: false,
        error: 'Debe proporcionar un archivo CSV/Excel en Base64 o el contenido CSV en texto.',
      });
      return;
    }

    let rawRows: Record<string, unknown>[] = [];

    if (csvText && typeof csvText === 'string' && csvText.trim().length > 0) {
      const cleanText = csvText.replace(/^\uFEFF/, '').trim();
      const workbook = XLSX.read(cleanText, { type: 'string' });
      const sheetName = workbook.SheetNames[0];
      rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: '' });
    } else if (fileBase64) {
      const buffer = Buffer.from(fileBase64, 'base64');
      const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4B; // PK.. (.xlsx)
      const isOldXls = buffer.length > 8 && buffer[0] === 0xD0 && buffer[1] === 0xCF; // OLE2 (.xls)

      if (isZip || isOldXls) {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: '' });
      } else {
        // Plain text CSV or TSV, decode as UTF-8
        const textContent = buffer.toString('utf-8').replace(/^\uFEFF/, '').trim();
        const workbook = XLSX.read(textContent, { type: 'string' });
        const sheetName = workbook.SheetNames[0];
        rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: '' });
      }
    }

    if (!rawRows || rawRows.length === 0) {
      res.status(400).json({
        success: false,
        error: 'El archivo está vacío o no contiene filas con datos legibles.',
      });
      return;
    }

    const validatedRows: Array<{
      rowIndex: number;
      id: string;
      text: string;
      lifeStage: 'infancia' | 'juventud' | 'adultez' | 'madurez' | 'legado_general';
      topic: string;
      priority: 'alta' | 'media' | 'baja';
      allowedStoryModes: 'individual' | 'compartida' | 'ambas';
      requirementType: 'mandatory' | 'optional' | 'skippable';
      flowId: string;
      orderIndex?: number;
      branchConfig: {
        enabled: boolean;
        targetFlowId: string;
        triggerRule: 'affirmative' | 'keywords' | 'any_answer';
        keywords?: string[];
        branchLabel?: string;
      } | null;
      active: boolean;
      isValid: boolean;
      errors: string[];
    }> = [];

    const seenImportIds = new Set<string>();

    for (let i = 0; i < rawRows.length; i++) {
      const originalRow = rawRows[i];
      const errors: string[] = [];

      // Build normalized key-value mapping for this row
      const normRow: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(originalRow)) {
        normRow[normalizeKeyName(k)] = v;
      }

      // 1. Text resolution (most important)
      const textRaw = getRowValue(normRow, [
        'pregunta',
        'preguntas',
        'texto',
        'texto_pregunta',
        'text',
        'question',
        'enunciado',
        'contenido',
        'item',
        'detalle',
      ]);

      if (!textRaw || textRaw.length < 3) {
        errors.push('La fila no contiene el texto de la pregunta (columna "pregunta" o "texto").');
      }

      // 2. ID resolution
      let idRaw = getRowValue(normRow, ['id', 'identificador', 'clave', 'codigo', 'cod', 'numero']);
      if (!idRaw) {
        idRaw = `q_imp_${Date.now()}_${i + 1}`;
      } else {
        idRaw = idRaw.replace(/[^a-zA-Z0-9_-]/g, '_');
      }

      if (seenImportIds.has(idRaw.toLowerCase())) {
        idRaw = `${idRaw}_${i + 1}`;
      }
      seenImportIds.add(idRaw.toLowerCase());

      // 3. Stage (etapa) resolution with flexible fuzzy mapping
      const stageInput = getRowValue(normRow, [
        'etapa',
        'etapa_vida',
        'lifestage',
        'fase',
        'periodo',
        'epoca',
      ]).toLowerCase();

      let resolvedStage: 'infancia' | 'juventud' | 'adultez' | 'madurez' | 'legado_general' = 'adultez';
      if (
        stageInput.includes('infan') ||
        stageInput.includes('nin') ||
        stageInput.includes('primero') ||
        stageInput.includes('origen')
      ) {
        resolvedStage = 'infancia';
      } else if (
        stageInput.includes('juven') ||
        stageInput.includes('joven') ||
        stageInput.includes('adolesc') ||
        stageInput.includes('estudio')
      ) {
        resolvedStage = 'juventud';
      } else if (
        stageInput.includes('madur') ||
        stageInput.includes('vejez') ||
        stageInput.includes('retiro') ||
        stageInput.includes('jubil') ||
        stageInput.includes('tercera')
      ) {
        resolvedStage = 'madurez';
      } else if (
        stageInput.includes('legad') ||
        stageInput.includes('valor') ||
        stageInput.includes('sabidur') ||
        stageInput.includes('trascend') ||
        stageInput.includes('consejo')
      ) {
        resolvedStage = 'legado_general';
      } else if (stageInput.includes('adul') || stageInput.includes('hijo') || stageInput.includes('trabaj')) {
        resolvedStage = 'adultez';
      }

      // 4. Topic (tema) resolution
      let topicRaw = getRowValue(normRow, ['tema', 'topic', 'categoria', 'subtema', 'tematica']);
      if (!topicRaw) {
        topicRaw = resolvedStage === 'legado_general' ? 'valores_y_legado' : 'historia_personal';
      }
      topicRaw = topicRaw.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');

      // 5. Priority (prioridad) resolution
      const priorityInput = getRowValue(normRow, ['prioridad', 'priority', 'importancia', 'nivel']).toLowerCase();
      let resolvedPriority: 'alta' | 'media' | 'baja' = 'media';
      if (priorityInput.includes('alt') || priorityInput.includes('high') || priorityInput === '1') {
        resolvedPriority = 'alta';
      } else if (priorityInput.includes('baj') || priorityInput.includes('low') || priorityInput === '3') {
        resolvedPriority = 'baja';
      }

      // 6. Mode (modalidad) resolution
      const modeInput = getRowValue(normRow, ['modalidad', 'allowedstorymodes', 'modo', 'tipo_historia']).toLowerCase();
      let resolvedMode: 'individual' | 'compartida' | 'ambas' = 'ambas';
      if (modeInput.includes('indiv') || modeInput.includes('sol') || modeInput.includes('person')) {
        resolvedMode = 'individual';
      } else if (modeInput.includes('compart') || modeInput.includes('famil') || modeInput.includes('parej')) {
        resolvedMode = 'compartida';
      }

      // 7. Requirement (tipo / requisito) resolution
      const reqInput = getRowValue(normRow, ['tipo', 'requisito', 'requirementtype', 'obligatoriedad']).toLowerCase();
      let resolvedReq: 'mandatory' | 'optional' | 'skippable' = 'mandatory';
      if (reqInput.includes('opcion') || reqInput.includes('opt') || reqInput.includes('libre')) {
        resolvedReq = 'optional';
      } else if (reqInput.includes('omit') || reqInput.includes('skip') || reqInput.includes('salt')) {
        resolvedReq = 'skippable';
      }

      // 8. Flow ID (flujo) resolution
      let flowIdRaw = getRowValue(normRow, ['flujo', 'flowid', 'id_flujo', 'subflujo', 'hilo']).toLowerCase();
      if (!flowIdRaw) flowIdRaw = 'principal';
      flowIdRaw = flowIdRaw.replace(/[^a-z0-9_-]/g, '_');

      // 9. Order Index (orden)
      const orderStr = getRowValue(normRow, ['orden', 'orden_flujo', 'orderindex', 'posicion', 'numero', 'secuencia']);
      let orderIndex: number | undefined = undefined;
      if (orderStr && !Number.isNaN(Number(orderStr))) {
        orderIndex = Math.max(1, Math.floor(Number(orderStr)));
      } else {
        orderIndex = i + 1;
      }

      // 10. Conditional Branching (bifurcacion)
      const branchEnabledStr = getRowValue(normRow, [
        'bifurcacion',
        'salto',
        'salto_condicional',
        'branchenabled',
        'ramificacion',
      ]).toLowerCase();
      const branchEnabled = ['si', 'true', '1', 'yes', 'activa', 'activo'].includes(branchEnabledStr);

      const targetFlowIdRaw = getRowValue(normRow, [
        'flujo_destino',
        'subflujo_destino',
        'destino',
        'targetflowid',
      ])
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_');

      const triggerRuleInput = getRowValue(normRow, [
        'regla_disparo',
        'regla',
        'disparo',
        'triggerrule',
        'condicion',
      ]).toLowerCase();

      let resolvedTriggerRule: 'affirmative' | 'keywords' | 'any_answer' = 'affirmative';
      if (triggerRuleInput.includes('keyword') || triggerRuleInput.includes('palabra')) {
        resolvedTriggerRule = 'keywords';
      } else if (triggerRuleInput.includes('any') || triggerRuleInput.includes('cualquier') || triggerRuleInput.includes('siempre')) {
        resolvedTriggerRule = 'any_answer';
      }

      const keywordsRaw = getRowValue(normRow, ['palabras_clave', 'palabras', 'keywords', 'terminos', 'frases']);
      const parsedKeywords = keywordsRaw
        ? keywordsRaw.split(/[,;|]/).map((k) => k.trim()).filter((k) => k.length > 0)
        : undefined;

      const branchLabelRaw = getRowValue(normRow, ['etiqueta_flujo', 'etiqueta', 'branchlabel', 'nombre_subflujo']);

      let branchConfig: {
        enabled: boolean;
        targetFlowId: string;
        triggerRule: 'affirmative' | 'keywords' | 'any_answer';
        keywords?: string[];
        branchLabel?: string;
      } | null = null;

      if (branchEnabled && targetFlowIdRaw && targetFlowIdRaw !== flowIdRaw) {
        branchConfig = {
          enabled: true,
          targetFlowId: targetFlowIdRaw,
          triggerRule: resolvedTriggerRule,
          keywords: parsedKeywords,
          branchLabel: branchLabelRaw || `Flujo ${targetFlowIdRaw}`,
        };
      }

      const isValid = errors.length === 0;

      validatedRows.push({
        rowIndex: i + 1,
        id: idRaw,
        text: textRaw,
        lifeStage: resolvedStage,
        topic: topicRaw,
        priority: resolvedPriority,
        allowedStoryModes: resolvedMode,
        requirementType: resolvedReq,
        flowId: flowIdRaw,
        orderIndex,
        branchConfig,
        active: true,
        isValid,
        errors,
      });
    }

    const invalidCount = validatedRows.filter((r) => !r.isValid).length;
    const validRows = validatedRows.filter((r) => r.isValid);

    // If commit is true, save valid rows
    if (commit && validRows.length > 0) {
      const questionsToPersist = validRows.map((row) => ({
        id: row.id,
        text: row.text,
        lifeStage: row.lifeStage,
        topic: row.topic,
        priority: row.priority,
        allowedStoryModes: row.allowedStoryModes,
        requirementType: row.requirementType,
        flowId: row.flowId,
        orderIndex: row.orderIndex,
        branchConfig: row.branchConfig,
        active: true,
        version: 1,
        createdAt: new Date().toISOString(),
      }));

      await storage.saveQuestionsBatch(questionsToPersist, admin);

      res.json({
        success: true,
        message: `Se importaron ${questionsToPersist.length} preguntas exitosamente en la base de datos Firestore y en el servidor.`,
        data: { total: questionsToPersist.length, committed: true },
      });
      return;
    }

    // Return preview
    res.json({
      success: true,
      data: {
        totalRows: validatedRows.length,
        validRowsCount: validRows.length,
        invalidRowsCount: invalidCount,
        previewRows: validatedRows,
        canCommit: validRows.length > 0,
      },
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// 4. Interviews & Manuscripts Management
apiRouter.get('/interviews/sync-status', requireAdmin, (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: storage.getFirestoreSyncStatus() });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/interviews/sync-firestore', requireAdmin, async (req: Request, res: Response) => {
  try {
    const mode: 'incremental' | 'full' = req.body?.full === true ? 'full' : 'incremental';
    const syncResult = await storage.syncFromFirestore(true, mode);
    if (mode === 'full') {
      await miEsenciaStore.syncFromFirestore(true);
    }
    const list = storage.getInterviews();
    const enriched = list.map((inv) => {
      const participants = storage.getParticipantsForInterview(inv.id);
      const answers = storage.getAnswersForInterview(inv.id);
      const manuscripts = storage.getManuscriptsForInterview(inv.id);
      const bookVersions = storage.getBookVersionsForInterview(inv.id, false);
      return {
        ...inv,
        participants,
        answersCount: answers.length,
        photosCount: answers.reduce((sum, a) => sum + (a.photos?.length || 0), 0),
        manuscriptsCount: manuscripts.length,
        latestManuscriptVersion: manuscripts[0]?.version || 0,
        bookVersions,
        bookVersionsCount: bookVersions.length,
        latestBookVersion: bookVersions[0]?.versionNumber || 0,
      };
    });
    res.json({
      success: true,
      data: enriched,
      syncResult,
      quotaReport: firestoreTelemetry.getReport(storage.getFirestoreSyncStatus()),
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.get('/interviews', requireAdmin, async (_req: Request, res: Response) => {
  try {
    await storage.syncFromFirestore(false);
    const list = storage.getInterviews();
    const enriched = list.map((inv) => {
      const participants = storage.getParticipantsForInterview(inv.id);
      const answers = storage.getAnswersForInterview(inv.id);
      const manuscripts = storage.getManuscriptsForInterview(inv.id);
      const bookVersions = storage.getBookVersionsForInterview(inv.id, false);
      return {
        ...inv,
        participants,
        answersCount: answers.length,
        photosCount: answers.reduce((sum, a) => sum + (a.photos?.length || 0), 0),
        manuscriptsCount: manuscripts.length,
        latestManuscriptVersion: manuscripts[0]?.version || 0,
        bookVersions,
        bookVersionsCount: bookVersions.length,
        latestBookVersion: bookVersions[0]?.versionNumber || 0,
      };
    });
    res.json({
      success: true,
      data: enriched,
      syncStatus: storage.getFirestoreSyncStatus(),
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Get answers with photos and audio recordings for an interview (admin)
apiRouter.get('/interviews/:id/answers', requireAdmin, async (req: Request, res: Response) => {
  try {
    await storage.syncFromFirestore(false, 'incremental');
    const answers = storage.getAnswersForInterview(req.params.id);
    res.json({ success: true, data: answers });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/interviews', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const result = await storage.createInterview({
      ...req.body,
      performedBy: admin,
    });
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/interviews/:id/duplicate', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const result = await storage.duplicateInterview(req.params.id, admin);
    const participants = storage.getParticipantsForInterview(result.interview.id);
    const answers = storage.getAnswersForInterview(result.interview.id);
    const manuscripts = storage.getManuscriptsForInterview(result.interview.id);
    const bookVersions = storage.getBookVersionsForInterview(result.interview.id, false);
    res.json({
      success: true,
      data: {
        interview: {
          ...result.interview,
          participants,
          answersCount: answers.length,
          photosCount: answers.reduce((sum, a) => sum + (a.photos?.length || 0), 0),
          manuscriptsCount: manuscripts.length,
          latestManuscriptVersion: manuscripts[0]?.version || 0,
          bookVersions,
          bookVersionsCount: bookVersions.length,
          latestBookVersion: bookVersions[0]?.versionNumber || 0,
        },
        participantTokens: result.participantTokens,
      },
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/interviews/:id/copy-note', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const { adminCopyNote } = req.body || {};
    const updated = await storage.updateAdminCopyNote(
      req.params.id,
      typeof adminCopyNote === 'string' ? adminCopyNote : '',
      admin
    );
    res.json({ success: true, data: updated });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/interviews/:id/extend', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const { additionalDays } = req.body;
    const updated = await storage.extendInterview(req.params.id, Number(additionalDays), admin);
    res.json({ success: true, data: updated });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/interviews/:id/reopen', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const { newDays, reason, additionalLayoutEdits } = req.body;
    const parsedEdits =
      additionalLayoutEdits !== undefined && additionalLayoutEdits !== ''
        ? Number(additionalLayoutEdits)
        : undefined;
    const updated = await storage.reopenInterview(
      req.params.id,
      Number(newDays),
      reason,
      admin,
      parsedEdits
    );
    res.json({ success: true, data: updated });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/interviews/:id/layout-quota', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const { remainingEdits } = req.body;
    const updated = await storage.updateInterviewLayoutQuota(
      req.params.id,
      Number(remainingEdits),
      admin
    );
    const bookVersions = storage.getBookVersionsForInterview(req.params.id);
    res.json({
      success: true,
      data: {
        ...updated,
        bookVersionsCount: bookVersions.length,
        latestBookVersion: bookVersions[0]?.versionNumber || 0,
      },
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.get('/interviews/:id/book-versions', requireAdmin, (req: Request, res: Response) => {
  try {
    const versions = storage.getBookVersionsForInterview(req.params.id);
    res.json({ success: true, data: versions });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.get('/participant-book-versions', requireAdmin, (_req: Request, res: Response) => {
  try {
    const versions = storage.getAllParticipantBookVersions();
    res.json({ success: true, data: versions });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Delete an individual generated book PDF version permanently with optional quota restoration
apiRouter.delete('/participant-book-versions/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const restoreQuota =
      req.query.restoreQuota === 'true' ||
      req.body?.restoreQuota === true ||
      req.query.restore === 'true';

    const result = await storage.deleteParticipantBookVersion(
      req.params.id,
      restoreQuota,
      admin
    );

    res.json({
      success: true,
      message: `Versión del libro eliminada permanentemente.${restoreQuota ? ' Se ha restaurado 1 intento de edición de maquetación al entrevistado.' : ''}`,
      data: result,
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// V5.4.1 — Administrator: delete ALL saved PDF book versions of an interviewee at once.
apiRouter.delete('/interviews/:id/book-versions', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const result = await storage.deleteAllParticipantBookVersionsForInterview(req.params.id, admin);
    res.json({
      success: true,
      message: `Se eliminaron ${result.deletedCount} versión(es) del libro en PDF.`,
      data: {
        deletedCount: result.deletedCount,
        deletedVersionIds: result.deletedVersionIds,
        clearedUpTo: Number((result.interview as { bookVersionsClearedUpTo?: number }).bookVersionsClearedUpTo ?? 0) || 0,
        interview: result.interview,
      },
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// V5.4.1 — Administrator: delete ALL manuscripts of an interviewee at once.
apiRouter.delete('/interviews/:id/manuscripts', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const result = await storage.deleteAllManuscriptsForInterview(req.params.id, admin);
    res.json({
      success: true,
      message: `Se eliminaron ${result.deletedCount} manuscrito(s).`,
      data: { deletedCount: result.deletedCount, interview: result.interview },
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// Seed 7 complete test stories (3 individual with varied flows, 4 shared of 2, 3, 4 and 5 people)
apiRouter.post('/interviews/seed-test-stories', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const result = await storage.seedCompleteTestStories(admin);
    const allInterviews = storage.getInterviews().map((inv) => {
      const participants = storage.getParticipantsForInterview(inv.id);
      const answers = storage.getAnswersForInterview(inv.id);
      const manuscripts = storage.getManuscriptsForInterview(inv.id);
      const bookVersions = storage.getBookVersionsForInterview(inv.id, false);
      return {
        ...inv,
        participants,
        answersCount: answers.length,
        photosCount: answers.reduce((sum, a) => sum + (a.photos?.length || 0), 0),
        manuscriptsCount: manuscripts.length,
        latestManuscriptVersion: manuscripts[0]?.version || 0,
        bookVersions,
        bookVersionsCount: bookVersions.length,
        latestBookVersion: bookVersions[0]?.versionNumber || 0,
      };
    });

    res.json({
      success: true,
      message: `Se han sembrado ${result.seededCount} historias de prueba completamente respondidas y listas para maquetación.`,
      seededCount: result.seededCount,
      data: allInterviews,
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Delete an interview and all its associated records permanently from database
apiRouter.delete('/interviews/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    await storage.deleteInterview(req.params.id, admin);
    res.json({
      success: true,
      message: 'La entrevista y todos sus registros asociados han sido eliminados de la base de datos.',
      id: req.params.id,
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// Reset an interview to beginning so participants can start over from scratch
apiRouter.post('/interviews/:id/reset', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const result = await storage.resetInterview(req.params.id, admin);
    res.json({
      success: true,
      message: 'La entrevista ha sido restablecida al inicio. Las respuestas anteriores han sido eliminadas para comenzar desde cero.',
      data: result,
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/interviews/:id/evaluate', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const { result, interview } = await storage.evaluateInterviewManual(req.params.id, admin);
    res.json({ success: true, data: result, interview });
  } catch (err: unknown) {
    const msg = (err as Error).message;
    res.status(msg.includes('no encontrada') ? 404 : 500).json({ success: false, error: msg });
  }
});

apiRouter.post('/interviews/:id/manuscript', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const manuscript = await storage.compileManuscript(req.params.id, admin);
    res.json({ success: true, data: manuscript });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Start or attach to an async admin manuscript compilation job with progress polling
apiRouter.post('/admin/interviews/:id/manuscript-job', requireAdmin, (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const job = storage.startAdminManuscriptJob(req.params.id, admin);
    res.json({ success: true, data: job });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.get('/admin/manuscript-jobs/:jobId', requireAdmin, (req: Request, res: Response) => {
  try {
    const job = storage.getAdminManuscriptJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ success: false, error: 'Proceso de compilación no encontrado.' });
      return;
    }
    res.json({ success: true, data: job });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.get('/interviews/:id/manuscripts', requireAdmin, (req: Request, res: Response) => {
  try {
    const manuscripts = storage.getManuscriptsForInterview(req.params.id);
    res.json({ success: true, data: manuscripts });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.get('/manuscripts', requireAdmin, async (_req: Request, res: Response) => {
  try {
    await storage.syncFromFirestore(false, 'incremental');
    const manuscripts = storage.getAllManuscripts();
    res.json({ success: true, data: manuscripts });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.delete('/manuscripts/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const result = await storage.deleteManuscript(req.params.id, admin);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// Batch delete selected PDF book versions
apiRouter.post('/admin/book-versions/batch-delete', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const versionIds = Array.isArray(req.body?.versionIds) ? req.body.versionIds : [];
    const restoreQuota = Boolean(req.body?.restoreQuota);
    if (versionIds.length === 0) {
      res.status(400).json({ success: false, error: 'Selecciona al menos una versión de libro en PDF.' });
      return;
    }
    const result = await storage.deleteParticipantBookVersionsBatch(versionIds, restoreQuota, admin);
    res.json({
      success: true,
      message: `Se eliminaron permanentemente ${result.deletedCount} versión(es) de libro en PDF.`,
      data: result,
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// Batch delete selected text manuscripts
apiRouter.post('/admin/manuscripts/batch-delete', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const manuscriptIds = Array.isArray(req.body?.manuscriptIds) ? req.body.manuscriptIds : [];
    if (manuscriptIds.length === 0) {
      res.status(400).json({ success: false, error: 'Selecciona al menos un manuscrito para eliminar.' });
      return;
    }
    const result = await storage.deleteManuscriptsBatch(manuscriptIds, admin);
    res.json({
      success: true,
      message: `Se eliminaron permanentemente ${result.deletedCount} manuscrito(s).`,
      data: result,
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// Full Database Backups Management (Configuración Global)
apiRouter.get('/admin/backups', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const backups = await storage.listDatabaseBackups();
    res.json({ success: true, data: backups });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/admin/backups', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const label = typeof req.body?.label === 'string' ? req.body.label : undefined;
    const backup = await storage.createDatabaseBackup(label, admin);
    // V5.8.5 (#3): a Firestore failure no longer loses the backup — it is kept "solo local".
    res.json({
      success: true,
      message:
        backup.storageLocation === 'local'
          ? 'Respaldo creado SOLO en este servidor: Firestore no respondió. Descárgalo a tu equipo; se volverá a intentar subirlo a Firestore.'
          : 'Respaldo completo de la base de datos creado y guardado en Cloud Firestore exitosamente.',
      data: backup,
      warnings: backup.warnings || [],
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.get('/admin/backups/:id/download', requireAdmin, async (req: Request, res: Response) => {
  try {
    const payload = await storage.getDatabaseBackupPayload(req.params.id);
    const serialized = JSON.stringify(payload);
    const safeName = `YouForever_Respaldo_BDD_${req.params.id}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.send(serialized);
  } catch (err: unknown) {
    res.status(404).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/admin/backups/:id/restore', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const result = await storage.restoreDatabaseBackup(req.params.id, admin);
    res.json({
      success: true,
      message: `La base de datos ha sido restaurada exitosamente a partir del respaldo seleccionado. Antes se guardó un respaldo automático del estado anterior: «${result.preRestoreBackup.label}».`,
      data: result,
    });
  } catch (err: unknown) {
    const e = err as any;
    // V5.8.5 (#2): 409 = nothing was restored because the safety backup could not be created.
    res.status(e?.code === 'PRE_RESTORE_BACKUP_FAILED' ? 409 : 400).json({
      success: false,
      error: e?.message || String(err),
      ...(e?.code ? { code: e.code } : {}),
      ...(e?.localBackupId ? { localBackupId: e.localBackupId } : {}),
    });
  }
});

apiRouter.post('/admin/backups/import', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const payload = req.body?.payload || req.body?.backup;
    const restoreImmediately = Boolean(req.body?.restoreImmediately);
    const result = await storage.importDatabaseBackupPayload(payload, restoreImmediately, admin);
    res.json({
      success: true,
      message: restoreImmediately
        ? 'Archivo de respaldo cargado y restaurado exitosamente en la base de datos (antes se guardó un respaldo automático del estado anterior).'
        : 'Archivo de respaldo importado y guardado en la lista del servidor.',
      data: result,
      warnings: result.warnings || [],
    });
  } catch (err: unknown) {
    const e = err as any;
    res.status(e?.code === 'PRE_RESTORE_BACKUP_FAILED' ? 409 : 400).json({
      success: false,
      error: e?.message || String(err),
      ...(e?.code ? { code: e.code } : {}),
      ...(e?.localBackupId ? { localBackupId: e.localBackupId } : {}),
    });
  }
});

apiRouter.delete('/admin/backups/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const result = await storage.deleteDatabaseBackup(req.params.id, admin);
    res.json({
      success: true,
      message: 'Respaldo eliminado del servidor.',
      data: result,
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// Export complete interview backup ZIP (Book, Q&A Compilation, audios, photos, json)
apiRouter.get('/interviews/:id/backup/zip', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { buffer, fileName } = await buildInterviewBackupZip(req.params.id, storage);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Export Q&A Compilation HTML Dossier (offline standalone viewer)
apiRouter.get('/interviews/:id/backup/qa-html', requireAdmin, (req: Request, res: Response) => {
  try {
    const interview = storage.getInterview(req.params.id);
    if (!interview) {
      res.status(404).json({ success: false, error: 'Entrevista no encontrada.' });
      return;
    }
    const participants = storage.getParticipantsForInterview(req.params.id);
    const answers = storage.getAnswersForInterview(req.params.id);
    const questions = storage.getQuestionsForVersion(interview.questionnaireVersionId);
    const photos = storage.getPhotosForInterview(req.params.id);
    const audios = storage.getAudiosForInterview(req.params.id);

    const adminUser = (req as any).adminUser as string | undefined; // verified by requireAdmin
    const html = generateQACompilationHtml({
      interview,
      participants,
      questions,
      answers,
      photos,
      audios,
      adminEmail: adminUser,
    });

    const isDownload = req.query.download === 'true';
    if (isDownload) {
      res.setHeader('Content-Disposition', `attachment; filename="compilado_preguntas_respuestas_${interview.id}.html"`);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Export Q&A Compilation Markdown
apiRouter.get('/interviews/:id/backup/qa-markdown', requireAdmin, (req: Request, res: Response) => {
  try {
    const interview = storage.getInterview(req.params.id);
    if (!interview) {
      res.status(404).json({ success: false, error: 'Entrevista no encontrada.' });
      return;
    }
    const participants = storage.getParticipantsForInterview(req.params.id);
    const answers = storage.getAnswersForInterview(req.params.id);
    const questions = storage.getQuestionsForVersion(interview.questionnaireVersionId);
    const photos = storage.getPhotosForInterview(req.params.id);
    const audios = storage.getAudiosForInterview(req.params.id);

    const md = generateQACompilationMarkdown({
      interview,
      participants,
      questions,
      answers,
      photos,
      audios,
    });

    res.setHeader('Content-Disposition', `attachment; filename="compilado_preguntas_respuestas_${interview.id}.md"`);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(md);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Export Q&A Compilation PDF («Compilado Testimonial Fidedigno (Preguntas, Respuestas, Audios y Fotos)»)
apiRouter.get('/interviews/:id/backup/qa-pdf', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { pdfRecord } = await miEsenciaStore.ensureInterviewCompilationPdf(req.params.id);
    const pdfBuf = Buffer.from(pdfRecord.pdfBase64, 'base64');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${pdfRecord.fileName || `Compilado_Testimonial_Fidedigno_${req.params.id}.pdf`}"`
    );
    res.setHeader('Content-Length', pdfBuf.length);
    res.send(pdfBuf);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// 5. Audit Logs
apiRouter.get('/audit-logs', requireAdmin, (_req: Request, res: Response) => {
  try {
    const logs = storage.getAuditLogs(100);
    res.json({ success: true, data: logs });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// 6. Token Revocation
apiRouter.post('/tokens/revoke', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const revoked = await storage.revokeToken(req.body.tokenId, admin);
    res.json({ success: true, data: revoked });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// V5.6.2: read-only access hardening report (counts and IDs only, never codes)
apiRouter.get('/admin/access-codes/report', requireAdmin, (_req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: storage.getAccessCodeSecurityReport() });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// V5.6.2: explicit reactivation of a revoked token (self-repair no longer revives revoked access)
apiRouter.post('/tokens/reactivate', requireAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const reactivated = await storage.reactivateToken(String(req.body?.tokenId || ''), admin);
    res.json({ success: true, data: reactivated });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// Restore browser-cached interviews if server restarted while Firestore quota was exhausted
apiRouter.post('/interviews/restore-cache', requireAdmin, (req: Request, res: Response) => {
  try {
    const { interviews, bookVersions: cachedBookVersions } = req.body;
    if (
      (Array.isArray(interviews) && interviews.length > 0) ||
      (Array.isArray(cachedBookVersions) && cachedBookVersions.length > 0)
    ) {
      storage.restoreFromClientCache(interviews, cachedBookVersions);
    }
    const list = storage.getInterviews();
    const enriched = list.map((inv) => {
      const participants = storage.getParticipantsForInterview(inv.id);
      const answers = storage.getAnswersForInterview(inv.id);
      const manuscripts = storage.getManuscriptsForInterview(inv.id);
      const bookVersions = storage.getBookVersionsForInterview(inv.id, false);
      return {
        ...inv,
        participants,
        answersCount: answers.length,
        photosCount: answers.reduce((sum, a) => sum + (a.photos?.length || 0), 0),
        manuscriptsCount: manuscripts.length,
        latestManuscriptVersion: manuscripts[0]?.version || 0,
        bookVersions,
        bookVersionsCount: bookVersions.length,
        latestBookVersion: bookVersions[0]?.versionNumber || 0,
      };
    });
    res.json({ success: true, data: enriched });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

let lastParticipantSessionForcedSyncMs = 0;

// 7. Participant Portal Endpoints
apiRouter.post('/participant/session', async (req: Request, res: Response) => {
  try {
    // V5.6.2: the block check happens in the shared access guard (before the routes).

    // V5.3.6: the browser no longer uploads its local copy of interviews and books on every
    // sign-in (it could weigh several MB). The server's source of truth is Firestore, which is
    // still synchronized before answering.
    const { token } = req.body;
    if (!token) {
      res.status(400).json({ success: false, error: 'Token de invitación requerido.' });
      return;
    }

    await storage.syncFromFirestore(false, 'incremental');

    let resolvedResult;
    try {
      resolvedResult = storage.resolveToken(token);
    } catch (firstErr) {
      const nowMs = Date.now();
      if (nowMs - lastParticipantSessionForcedSyncMs > 8_000) {
        lastParticipantSessionForcedSyncMs = nowMs;
        await storage.syncFromFirestore(true, 'incremental');
      }
      try {
        resolvedResult = storage.resolveToken(token);
      } catch (_retryErr) {
        // V5.6.2: an expired or revoked code is a real person, not a guess — only count codes
        // that match nothing at all.
        if (storage.classifyAccessInput(String(token)).status === 'unknown') {
          recordAccessCodeFailure(req);
        }
        throw firstErr;
      }
    }

    const { token: resolvedTokenDoc, interview, participant } = resolvedResult;
    recordAccessCodeSuccess(req, resolvedTokenDoc.id);
    // V5.3.2: a valid access code grants this browser READ access to THIS interview's photos and
    // voice recordings (HttpOnly signed cookie; see adminAuth.ts → media access).
    res.append(
      'Set-Cookie',
      buildMediaAccessCookie(
        issueMediaAccessCookieValue(interview.id, readCookie(req.headers.cookie, MEDIA_ACCESS_COOKIE)),
        isSecureRequest(req)
      )
    );
    const questions = storage.getQuestionsForVersion(interview.questionnaireVersionId);
    // V5.4.2: recordings travel as links (/api/audio/:id, authorized for this participant), never
    // embedded as base64 inside every answer of the session.
    const stripEmbeddedAudio = <T extends { audioUrl?: string; audioDataUrl?: string }>(v: T): T => {
      if (!v || !v.audioUrl) return v;
      const { audioDataUrl: _drop, ...rest } = v;
      return rest as T;
    };
    const answers = storage.getAnswersForInterview(interview.id).map((a) => ({
      ...a,
      ...(a.audio ? { audio: stripEmbeddedAudio(a.audio) } : {}),
      ...(Array.isArray(a.audioRecordings) ? { audioRecordings: a.audioRecordings.map(stripEmbeddedAudio) } : {}),
    }));
    const otherParticipants = storage.getParticipantsForInterview(interview.id);
    // V5.3: participants never receive audit information (coverage, contradictions, reports).
    // V5.3.6: only the LIST of versions (no book text): each book is loaded when it is opened.
    const bookVersions = storage
      .getBookVersionsForInterview(interview.id)
      .map((v) => toParticipantBookVersionSummary(v));

    // Verify existing informed consent on record for this specific participant
    const consent = storage.getActiveConsent(interview.id, participant.id) || storage.getConsentForParticipant(participant.id, PRIVACY_NOTICE_VERSION);
    const hasValidConsent = isConsentValid(consent, interview.id, participant.id, PRIVACY_NOTICE_VERSION);
    const policyInfo = storage.getPrivacyPolicyVersion(PRIVACY_NOTICE_VERSION);
    const deliverySchedules = storage.getDeliverySchedulesForInterview(interview.id);
    const secondaryAccessList = storage.getSecondaryAccess(interview.id, participant.id);

    res.json({
      success: true,
      data: {
        resolvedToken: (resolvedTokenDoc as any).plainToken || resolvedTokenDoc.accessCode || token,
        accessCode: resolvedTokenDoc.accessCode,
        interview: sanitizeInterviewForParticipant(interview),
        participant,
        questions,
        answers,
        bookVersions,
        otherParticipants: otherParticipants.map((p) => ({
          id: p.id,
          name: p.name,
          relationship: p.relationship,
          role: p.role,
        })),
        allowAnswerEditing: Boolean(storage.getConfig().allowAnswerEditing || interview.status === 'open'),
        allowAdditionalMemories: storage.getConfig().allowAdditionalMemories,
        consent: consent || null,
        hasValidConsent,
        policyInfo,
        deliverySchedules,
        secondaryAccessList,
      },
    });
  } catch (err: unknown) {
    res.status(403).json({ success: false, error: (err as Error).message });
  }
});

// V5.3.6 — One saved book version (full content), loaded when the participant opens or downloads it.
apiRouter.post('/participant/book/version', async (req: Request, res: Response) => {
  try {
    const { token, versionId } = req.body || {};
    if (!token || !versionId) {
      res.status(400).json({ success: false, error: 'Faltan datos para abrir el libro.' });
      return;
    }
    const { interview } = storage.resolveToken(String(token));
    const version = storage
      .getBookVersionsForInterview(interview.id)
      .find((v) => v.id === String(versionId));
    if (!version) {
      res.status(404).json({ success: false, error: 'No encontramos esta versión de tu libro.' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: { bookVersion: sanitizeBookVersionForParticipant(version) } });
  } catch (err: unknown) {
    res.status(403).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/participant/answer', async (req: Request, res: Response) => {
  try {
    const {
      token,
      questionId,
      questionText,
      answerText,
      notRecalled,
      isFollowUp,
      parentQuestionId,
      isAdditionalMemory,
      branchChoice,
      deepeningReason,
      photos,
      audio,
      audioRecordings,
      audios,
      idempotencyKey,
      autosave,
    } = req.body;

    if (!token) {
      res.status(400).json({ success: false, error: 'Token de invitación requerido.' });
      return;
    }

    const { interview, participant } = storage.resolveToken(token);
    const activeConsent = storage.getActiveConsent(interview.id, participant.id);
    if (!isConsentValid(activeConsent, interview.id, participant.id, PRIVACY_NOTICE_VERSION)) {
      res.status(403).json({
        success: false,
        error: 'Debe aceptar el aviso de privacidad y confirmar su identidad antes de registrar respuestas.',
      });
      return;
    }

    const result = await storage.submitAnswer({
      plainToken: token,
      questionId,
      questionText,
      answerText: answerText || '',
      notRecalled: !!notRecalled,
      isFollowUp,
      parentQuestionId,
      isAdditionalMemory,
      branchChoice,
      deepeningReason,
      photos,
      audio,
      audioRecordings: audioRecordings || audios,
      idempotencyKey: idempotencyKey || `idem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      // V5.3.6: automatic save while the participant writes.
      autosave: autosave === true,
    });

    const sanitizedResult =
      result && (result as any).interview
        ? { ...result, interview: sanitizeInterviewForParticipant((result as any).interview) }
        : result;
    res.json({ success: true, data: sanitizedResult });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// Upload and transcribe voice recording with Gemini and save to database
apiRouter.post('/participant/audio/upload', async (req: Request, res: Response) => {
  try {
    const {
      token,
      questionId,
      questionText,
      audioBase64,
      mimeType,
      durationSeconds,
      clientTranscription,
    } = req.body;

    if (!token) {
      res.status(400).json({ success: false, error: 'Token de invitación requerido.' });
      return;
    }

    const { interview, participant } = storage.resolveToken(token);
    const activeConsent = storage.getActiveConsent(interview.id, participant.id);
    if (!isConsentValid(activeConsent, interview.id, participant.id, PRIVACY_NOTICE_VERSION)) {
      res.status(403).json({
        success: false,
        error: 'Debe aceptar el aviso de privacidad y confirmar su identidad antes de guardar audios.',
      });
      return;
    }

    if (!audioBase64) {
      res.status(400).json({ success: false, error: 'Archivo de audio requerido en formato Base64.' });
      return;
    }

    const savedAudio = await storage.saveVoiceRecording({
      plainToken: token,
      questionId,
      questionText,
      audioBase64,
      mimeType: mimeType || 'audio/webm',
      durationSeconds: Number(durationSeconds) || 0,
      clientTranscription,
    });

    res.json({
      success: true,
      data: {
        id: savedAudio.id,
        audioUrl: savedAudio.audioUrl,
        audioDataUrl: savedAudio.audioDataUrl,
        transcription: savedAudio.transcription,
        durationSeconds: savedAudio.durationSeconds,
        mimeType: savedAudio.mimeType,
        createdAt: savedAudio.createdAt,
        audioQuality: (savedAudio as any).audioQuality || 'clear',
        qualityWarning: (savedAudio as any).qualityWarning,
        suggestion: (savedAudio as any).suggestion,
      },
    });
  } catch (err: unknown) {
    console.error('Error saving voice recording:', err);
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// Delete a voice recording uploaded by participant
apiRouter.post('/participant/audio/:audioId/delete', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token) {
      res.status(400).json({ success: false, error: 'Token de invitación requerido.' });
      return;
    }

    const result = await storage.deleteAudioForParticipant(token, req.params.audioId);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

/**
 * V5.3.2 — Authorization of personal media. Before, any photo or recording could be downloaded by
 * anyone who knew (or guessed) its identifier. Now a request needs either a verified administrator
 * (ID token or admin session cookie) or the participant media cookie for the interview that owns the
 * file (issued when a valid access code opens a session, so participants and the relatives who use
 * their code keep seeing their photos, hearing their recordings and composing their PDF).
 */
async function authorizeMediaRequest(req: Request, res: Response, kind: 'photo' | 'audio', mediaId: string): Promise<boolean> {
  const granted = mediaAccessInterviewsFromRequest(req);
  if (granted.length > 0) {
    const owner = await storage.resolveMediaInterviewId(kind, mediaId);
    if (owner && granted.includes(owner)) return true;
  }
  if (await getAdminUser(req)) return true;
  res.setHeader('Cache-Control', 'no-store');
  res.status(granted.length > 0 ? 403 : 401).json({
    success: false,
    error:
      kind === 'photo'
        ? 'No tienes autorización para ver esta fotografía. Vuelve a abrir tu historia con tu código de acceso.'
        : 'No tienes autorización para escuchar esta grabación. Vuelve a abrir tu historia con tu código de acceso.',
  });
  return false;
}

/** Private, per-user caching only (never shared caches or CDNs). */
const PRIVATE_MEDIA_CACHE = 'private, max-age=3600';

// Serve stored voice audio recording by ID with HTTP 206 Range streaming support
apiRouter.get('/audio/:audioId', async (req: Request, res: Response) => {
  try {
    if (!(await authorizeMediaRequest(req, res, 'audio', req.params.audioId))) return;
    res.setHeader('Vary', 'Cookie, Authorization');
    // V5.4.4: local copy first, then Cloud Firestore (reassembling chunked recordings).
    const audioData = await storage.getAudioBufferAsync(req.params.audioId);
    if (!audioData) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(404).json({ success: false, error: 'Archivo de voz no encontrado.' });
      return;
    }

    const audioBuffer = audioData.buffer;
    const cleanMime = audioData.mimeType.split(';')[0].trim() || 'audio/webm';
    const total = audioBuffer.length;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;

      if (start >= total || end >= total || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
        return;
      }

      const chunksize = end - start + 1;
      const chunk = audioBuffer.subarray(start, end + 1);

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': cleanMime,
        'Cache-Control': PRIVATE_MEDIA_CACHE,
      });
      res.end(chunk);
      return;
    }

    res.writeHead(200, {
      'Content-Length': total,
      'Content-Type': cleanMime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': PRIVATE_MEDIA_CACHE,
    });
    res.end(audioBuffer);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Delete a photo uploaded by mistake by a participant
apiRouter.post('/participant/photos/:photoId/delete', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token) {
      res.status(400).json({ success: false, error: 'Token de invitación requerido.' });
      return;
    }

    const result = await storage.deletePhotoForParticipant(token, req.params.photoId);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// Serve stored interview photograph by ID (same-origin: the app's own <img>, canvas and PDF composer).
// V5.3.2: private resource — no wildcard CORS; authorization required (see authorizeMediaRequest).
apiRouter.options('/photos/:photoId', (_req: Request, res: Response) => {
  res.setHeader('Allow', 'GET, OPTIONS');
  res.sendStatus(204);
});

apiRouter.get('/photos/:photoId', async (req: Request, res: Response) => {
  try {
    if (!(await authorizeMediaRequest(req, res, 'photo', req.params.photoId))) return;
    res.setHeader('Vary', 'Cookie, Authorization');

    // V5.4.3: local copy first, then Cloud Firestore. Never a synthetic picture: when the image is
    // nowhere, the answer is a 404 (not cached) so a later request can still find it.
    const photoBuffer = await storage.getPhotoBufferAsync(req.params.photoId);
    if (!photoBuffer) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(404).json({ success: false, error: 'Fotografía no encontrada.' });
      return;
    }
    res.setHeader('Content-Type', photoBuffer.mimeType);
    res.setHeader('Cache-Control', PRIVATE_MEDIA_CACHE);
    res.send(photoBuffer.buffer);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/participant/finish', async (req: Request, res: Response) => {
  try {
    const { token, reason } = req.body;
    if (!token) {
      res.status(400).json({ success: false, error: 'Token de invitación requerido.' });
      return;
    }

    const finished = await storage.declareVoluntaryCompletion(token, reason || '');
    const sanitizedFinished =
      finished && (finished as any).interview
        ? { ...finished, interview: sanitizeInterviewForParticipant((finished as any).interview) }
        : finished && (finished as any).id
        ? sanitizeInterviewForParticipant(finished as any)
        : finished;
    res.json({ success: true, data: sanitizedFinished });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// Participant Book Studio: Start or resume background manuscript generation job
apiRouter.post('/participant/book/jobs/start', async (req: Request, res: Response) => {
  try {
    const {
      token,
      narrativeStyle,
      scope,
      forceRefresh,
      lockedPreviewManuscript,
      lockedPreviewGroups,
    } = req.body || {};
    if (!token) {
      res.status(400).json({ success: false, error: 'Tu código o enlace de acceso es requerido.' });
      return;
    }
    const job = storage.startOrResumeParticipantBookJob({
      plainToken: String(token),
      narrativeStyle: narrativeStyle || 'first_person_literary',
      scope: scope === 'preview' ? 'preview' : 'full',
      forceRefresh: await resolveEffectiveForceRefresh(req, String(token), Boolean(forceRefresh)),
      lockedPreviewManuscript: lockedPreviewManuscript || null,
      lockedPreviewGroups: lockedPreviewGroups || null,
    });
    res.json({ success: true, data: toParticipantBookJobView(job) });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// Participant Book Studio: Poll background manuscript generation job progress/result
// V5.8.5 (#14a): POST keeps the access code out of URLs (server logs, browser history). The GET
// form stays only so a page already open with the previous version keeps working.
const handleParticipantBookJobStatus = async (req: Request, res: Response) => {
  try {
    const src: any = req.method === 'POST' ? req.body || {} : req.query;
    const token = typeof src.token === 'string' ? src.token : '';
    const jobId = typeof src.jobId === 'string' ? src.jobId : undefined;
    const narrativeStyle =
      typeof src.narrativeStyle === 'string'
        ? (src.narrativeStyle as any)
        : undefined;
    const scope =
      src.scope === 'preview'
        ? 'preview'
        : src.scope === 'full'
        ? 'full'
        : undefined;

    if (!token) {
      res.status(400).json({ success: false, error: 'Tu código o enlace de acceso es requerido.' });
      return;
    }
    const job = storage.getParticipantBookJobStatus({
      plainToken: token,
      jobId,
      narrativeStyle,
      scope,
    });
    res.json({ success: true, data: job ? toParticipantBookJobView(job) : null });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
};
apiRouter.post('/participant/book/jobs/status', handleParticipantBookJobStatus);
apiRouter.get('/participant/book/jobs/status', handleParticipantBookJobStatus);

// Participant Book Studio: Cancel active background book generation job
apiRouter.post('/participant/book/jobs/cancel', async (req: Request, res: Response) => {
  try {
    const { token, jobId } = req.body || {};
    if (!token || !jobId) {
      res.status(400).json({ success: false, error: 'Se requiere tu acceso y el identificador del avance.' });
      return;
    }
    const job = storage.cancelParticipantBookJob({
      plainToken: String(token),
      jobId: String(jobId),
    });
    res.json({ success: true, data: job ? toParticipantBookJobView(job) : null });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// Participant Book Studio: Generate AI manuscript in chosen narrative style (A, B, or C)
apiRouter.post('/participant/book/generate-manuscript', async (req: Request, res: Response) => {
  try {
    const {
      token,
      narrativeStyle,
      scope,
      forceRefresh,
      lockedPreviewManuscript,
      lockedPreviewGroups,
    } = req.body;
    if (!token) {
      res.status(400).json({ success: false, error: 'Tu código o enlace de acceso es requerido.' });
      return;
    }
    const job = storage.startOrResumeParticipantBookJob({
      plainToken: String(token),
      narrativeStyle: narrativeStyle || 'first_person_literary',
      scope: scope === 'preview' ? 'preview' : 'full',
      forceRefresh: await resolveEffectiveForceRefresh(req, String(token), Boolean(forceRefresh)),
      lockedPreviewManuscript: lockedPreviewManuscript || null,
      lockedPreviewGroups: lockedPreviewGroups || null,
    });
    const settled = await bookJobManager.waitForJob(job.jobId);
    if (!settled || settled.status === 'failed' || !settled.result) {
      res.status(400).json({
        success: false,
        error:
          settled?.error ||
          'No pudimos reunir todos tus recuerdos en este momento. Por favor intenta nuevamente.',
      });
      return;
    }
    res.json({ success: true, data: sanitizeBookResultForParticipant(settled.result) });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// Participant Book Studio: Save a generated PDF book version and update layout edit quota
apiRouter.post('/participant/book/save-version', async (req: Request, res: Response) => {
  try {
    const {
      token,
      narrativeStyle,
      editorialConfig,
      manuscript,
      coverPhoto,
      chapterPhotos,
      pageCount,
    } = req.body;
    if (!token || !editorialConfig || !manuscript) {
      res.status(400).json({
        success: false,
        error: 'Token, configuración editorial y manuscrito son requeridos.',
      });
      return;
    }
    const result = await storage.saveParticipantBookVersion({
      plainToken: token,
      narrativeStyle: narrativeStyle || 'first_person_literary',
      editorialConfig,
      manuscript,
      coverPhoto,
      chapterPhotos,
      pageCount: Number(pageCount) || 5,
    });
    // V5.3: the saved version and the history go back to the participant WITHOUT audit data.
    const sanitizedSaveResult = {
      ...result,
      interview: sanitizeInterviewForParticipant(result.interview),
      bookVersion: sanitizeBookVersionForParticipant(result.bookVersion),
      allVersions: (result.allVersions || []).map((v) => sanitizeBookVersionForParticipant(v)),
    };
    res.json({ success: true, data: sanitizedSaveResult });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// =============================================================================================
// V5.3 — ADMINISTRATIVE BOOK AUDIT ("Ver auditoría del libro"). Admin-only on the server: every
// route goes through `requireAdmin`; none of this data is reachable from participant routes.
// =============================================================================================
apiRouter.get('/admin/book-audits', requireAdmin, (req: Request, res: Response) => {
  try {
    const interviewId = typeof req.query.interviewId === 'string' ? req.query.interviewId : undefined;
    res.json({ success: true, data: storage.listBookAuditSummaries(interviewId) });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.get('/admin/book-versions/:versionId/audit', requireAdmin, async (req: Request, res: Response) => {
  try {
    const report = await storage.getBookAuditReport(req.params.versionId);
    if (!report) {
      res.status(404).json({ success: false, error: 'Informe de auditoría no encontrado.' });
      return;
    }
    res.json({ success: true, data: report });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.get('/admin/book-versions/:versionId/audit/export', requireAdmin, async (req: Request, res: Response) => {
  try {
    const report = await storage.getBookAuditReport(req.params.versionId);
    if (!report) {
      res.status(404).json({ success: false, error: 'Informe de auditoría no encontrado.' });
      return;
    }
    const safeId = req.params.versionId.replace(/[^A-Za-z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="auditoria_${safeId}.json"`);
    res.send(JSON.stringify(report, null, 2));
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/admin/book-versions/:versionId/audit/notes', requireAdmin, async (req: Request, res: Response) => {
  try {
    const report = await storage.addBookAuditNote({
      versionId: req.params.versionId,
      note: String(req.body?.note || ''),
      incidentId: req.body?.incidentId ? String(req.body.incidentId) : undefined,
      performedBy: (req as any).adminUser as string,
    });
    res.json({ success: true, data: report });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post(
  '/admin/book-versions/:versionId/audit/incidents/:incidentId/status',
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const report = await storage.updateBookAuditIncidentStatus({
        versionId: req.params.versionId,
        incidentId: req.params.incidentId,
        status: String(req.body?.status || '') as BookAuditIncidentStatus,
        note: req.body?.note ? String(req.body.note) : undefined,
        performedBy: (req as any).adminUser as string,
      });
      res.json({ success: true, data: report });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

apiRouter.post('/admin/book-versions/:versionId/audit/corrections', requireAdmin, async (req: Request, res: Response) => {
  try {
    const report = await storage.requestBookAuditCorrection({
      versionId: req.params.versionId,
      incidentIds: Array.isArray(req.body?.incidentIds) ? req.body.incidentIds.map(String) : [],
      note: String(req.body?.note || ''),
      performedBy: (req as any).adminUser as string,
    });
    res.json({ success: true, data: report });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// 8. Demo Seeder Endpoint
apiRouter.post('/admin/seed-demo', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const seeds = await storage.seedDemoData();
    res.json({ success: true, data: seeds });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// 9. Privacy, Informed Consent & Compliance Endpoints (Parts II - VII, X, XI)
apiRouter.get('/privacy/policy', (req: Request, res: Response) => {
  try {
    const version = typeof req.query.version === 'string' ? req.query.version : undefined;
    const policy = storage.getPrivacyPolicyVersion(version);
    res.json({ success: true, data: policy });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ============================================================================
// V5.5.0 — Interviewee quick access to «Mi Esencia» (after saving the final PDF of the book)
// ============================================================================

/** The participant (token) and whether their interview already has a saved final book. */
function resolveMiEsenciaQuickAccessContext(token: unknown) {
  const { interview, participant } = storage.resolveToken(String(token || ''));
  const hasFinalBook =
    Boolean(interview.userDeclaredComplete) && storage.getBookVersionsForInterview(interview.id).length > 0;
  return { interview, participant, hasFinalBook };
}

apiRouter.post('/participant/mi-esencia/status', async (req: Request, res: Response) => {
  try {
    const { interview, hasFinalBook } = resolveMiEsenciaQuickAccessContext(req.body?.token);
    await miEsenciaStore.ensureInitialized();
    const enabled = miEsenciaStore.getConfig().miEsenciaEnabled;
    const access = hasFinalBook ? miEsenciaStore.getParticipantQuickAccess(interview.id) : null;
    res.json({
      success: true,
      data: {
        eligible: hasFinalBook && enabled,
        activated: Boolean(access),
        access,
        accessUrl: access?.privateLinkPath ? `${resolvePublicBaseUrl(req)}${access.privateLinkPath}` : null,
      },
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/participant/mi-esencia/activate', async (req: Request, res: Response) => {
  try {
    const { interview, participant, hasFinalBook } = resolveMiEsenciaQuickAccessContext(req.body?.token);
    if (!hasFinalBook) {
      res.status(403).json({
        success: false,
        error: 'Mi Esencia se habilita en cuanto guardes la versión final de tu libro en PDF.',
      });
      return;
    }
    await miEsenciaStore.ensureInitialized();
    const access = await miEsenciaStore.activateParticipantQuickAccess({
      interviewId: interview.id,
      participantId: participant.id,
    });
    res.json({
      success: true,
      data: {
        access,
        accessUrl: access.privateLinkPath ? `${resolvePublicBaseUrl(req)}${access.privateLinkPath}` : null,
        suggestedEmail: participant.email || '',
      },
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/participant/mi-esencia/send-email', async (req: Request, res: Response) => {
  try {
    const { interview, participant, hasFinalBook } = resolveMiEsenciaQuickAccessContext(req.body?.token);
    if (!hasFinalBook) {
      res.status(403).json({ success: false, error: 'Primero guarda la versión final de tu libro en PDF.' });
      return;
    }
    await miEsenciaStore.ensureInitialized();
    const result = await miEsenciaStore.sendParticipantQuickAccessEmail({
      interviewId: interview.id,
      participantId: participant.id,
      participantName: participant.name,
      recipientEmail: String(req.body?.email || participant.email || ''),
      publicBaseUrl: resolvePublicBaseUrl(req),
      send: (content, to) => sendTransactionalEmail({ recipientEmail: to, ...content }),
    });
    if (!result.sent) {
      // The technical detail stays in the server log; the participant gets a plain message.
      console.warn(`[Mi Esencia] Correo de acceso rápido no enviado (${interview.id}): ${result.error}`);
      res.status(400).json({
        success: false,
        error:
          result.error && !/SMTP|Gmail|configur/i.test(result.error)
            ? result.error
            : 'No pudimos enviar el correo en este momento. Guarda tu enlace y tu código; puedes intentarlo más tarde.',
      });
      return;
    }
    res.json({ success: true, data: { recipientEmail: result.recipientEmail } });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/participant/consent', async (req: Request, res: Response) => {
  try {
    const { token, hasAcceptedSingleCheckbox } = req.body;
    if (!token) {
      res.status(400).json({ success: false, error: 'Token de invitación requerido.' });
      return;
    }

    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    const userAgent = (req.headers['user-agent'] as string) || '';
    const consent = await storage.recordPrivacyConsent(
      token,
      hasAcceptedSingleCheckbox !== false,
      userAgent || clientIp
    );

    res.json({ success: true, data: consent });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/participant/consent/update', async (req: Request, res: Response) => {
  try {
    const { token, declarations, reason } = req.body;
    if (!token) {
      res.status(400).json({ success: false, error: 'Token de invitación requerido.' });
      return;
    }

    const updated = await storage.updateOptionalDeclarations({
      plainToken: token,
      declarations,
      reason,
    });

    res.json({ success: true, data: updated });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/participant/consent/revoke', async (req: Request, res: Response) => {
  try {
    const { token, reason } = req.body;
    if (!token) {
      res.status(400).json({ success: false, error: 'Token de invitación requerido.' });
      return;
    }

    const revoked = await storage.revokePrivacyConsent({
      plainToken: token,
      reason: reason || 'Revocación por voluntad del titular',
    });

    res.json({ success: true, data: revoked });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/participant/arco', async (req: Request, res: Response) => {
  try {
    const { token, requestType, details, contactEmail } = req.body;
    if (!token) {
      res.status(400).json({ success: false, error: 'Token de invitación requerido.' });
      return;
    }
    if (!requestType || !details) {
      res.status(400).json({ success: false, error: 'Tipo de solicitud y detalles requeridos.' });
      return;
    }

    const arco = await storage.submitARCORequest({
      plainToken: token,
      requestType,
      details,
      contactEmail,
    });

    res.json({ success: true, data: arco });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/participant/schedule-delivery', async (req: Request, res: Response) => {
  try {
    const { token, recipientEmail, recipientName, scheduledDate, notes } = req.body;
    if (!token || !recipientEmail || !scheduledDate) {
      res.status(400).json({ success: false, error: 'Correo de destinatario y fecha futura requeridos.' });
      return;
    }

    const schedule = await storage.scheduleBookDelivery({
      plainToken: token,
      recipientEmail,
      recipientName,
      scheduledDate,
      notes,
    });

    res.json({ success: true, data: schedule });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/participant/secondary-access', async (req: Request, res: Response) => {
  try {
    const { token, authorizedPersonName, relationship, email } = req.body;
    if (!token || !authorizedPersonName || !email) {
      res.status(400).json({ success: false, error: 'Nombre de la persona y correo requeridos.' });
      return;
    }

    const access = await storage.addSecondaryAccess({
      plainToken: token,
      authorizedPersonName,
      relationship: relationship || 'Familiar',
      email,
    });

    res.json({ success: true, data: access });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// Participant Admin Panel Endpoints (Gear / Settings modal)
apiRouter.post('/participant/admin/profile', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token) {
      res.status(400).json({ success: false, error: 'Token de invitación requerido.' });
      return;
    }
    const { interview, participant } = storage.resolveToken(token);
    const activeConsent = storage.getActiveConsent(interview.id, participant.id);
    const consentHistory = storage.getConsentHistory(interview.id, participant.id);
    const bookShares = storage.getBookShares(interview.id, participant.id);
    const scheduledDeliveries = storage.getScheduledDeliveries(interview.id, participant.id);
    const secondaryAccessList = storage.getSecondaryAccess(interview.id, participant.id);
    const postMortemInstructions = storage.getPostMortemInstructions(interview.id, participant.id);
    // V5.3.1: participants see WHICH events happened on their account, never their internal
    // details (coverage, colour band, delivery status, diagnostics, administrator identities).
    const auditLogs = storage
      .getParticipantAuditLogs(interview.id, participant.id)
      .map(toParticipantAuditLogView)
      .filter((log): log is NonNullable<typeof log> => log !== null);
    const manuscripts = storage.getManuscriptsForInterview(interview.id);
    const hasGeneratedBook = manuscripts && manuscripts.length > 0;
    const latestManuscript = hasGeneratedBook ? manuscripts[manuscripts.length - 1] : null;

    res.json({
      success: true,
      data: {
        participant,
        interview: sanitizeInterviewForParticipant(interview),
        activeConsent,
        consentHistory,
        bookShares,
        scheduledDeliveries,
        secondaryAccessList,
        postMortemInstructions,
        auditLogs,
        hasGeneratedBook,
        latestManuscript: latestManuscript
          ? { id: latestManuscript.id, title: latestManuscript.title, version: latestManuscript.version }
          : null,
      },
    });
  } catch (err: unknown) {
    res.status(403).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/participant/admin/shares', async (req: Request, res: Response) => {
  try {
    const { token, recipientName, recipientEmail, relationship, note } = req.body;
    if (!token) {
      res.status(400).json({ success: false, error: 'Token requerido.' });
      return;
    }
    const share = await storage.addBookShare(token, {
      recipientName,
      recipientEmail,
      relationship,
      note,
    });
    res.json({ success: true, data: share });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/participant/admin/shares/:id/revoke', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token) {
      res.status(400).json({ success: false, error: 'Token requerido.' });
      return;
    }
    const revoked = await storage.revokeBookShare(token, req.params.id);
    res.json({ success: true, data: revoked });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/participant/admin/scheduled-deliveries', async (req: Request, res: Response) => {
  try {
    const { token, recipientName, recipientEmail, scheduledDate, note } = req.body;
    if (!token) {
      res.status(400).json({ success: false, error: 'Token requerido.' });
      return;
    }
    const delivery = await storage.addScheduledDelivery(token, {
      recipientName,
      recipientEmail,
      scheduledDate,
      note,
    });
    res.json({ success: true, data: delivery });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/participant/admin/scheduled-deliveries/:id/cancel', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token) {
      res.status(400).json({ success: false, error: 'Token requerido.' });
      return;
    }
    const cancelled = await storage.cancelScheduledDelivery(token, req.params.id);
    res.json({ success: true, data: cancelled });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/participant/admin/secondary-access', async (req: Request, res: Response) => {
  try {
    const { token, authorizedPersonName, authorizedPersonEmail, relationship, permissions } = req.body;
    if (!token) {
      res.status(400).json({ success: false, error: 'Token requerido.' });
      return;
    }
    const access = await storage.addSecondaryAccess(token, {
      authorizedPersonName,
      authorizedPersonEmail,
      relationship,
      permissions: permissions || ['view_manuscript'],
    });
    res.json({ success: true, data: access });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/participant/admin/secondary-access/:id/revoke', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token) {
      res.status(400).json({ success: false, error: 'Token requerido.' });
      return;
    }
    const revoked = await storage.revokeSecondaryAccess(token, req.params.id);
    res.json({ success: true, data: revoked });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/participant/admin/post-mortem', async (req: Request, res: Response) => {
  try {
    const { token, designatedPersonName, designatedPersonEmail, relationship, instructions } = req.body;
    if (!token) {
      res.status(400).json({ success: false, error: 'Token requerido.' });
      return;
    }
    const pmi = await storage.savePostMortemInstructions(token, {
      designatedPersonName,
      designatedPersonEmail,
      relationship,
      instructions,
    });
    res.json({ success: true, data: pmi });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/participant/admin/post-mortem/revoke', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token) {
      res.status(400).json({ success: false, error: 'Token requerido.' });
      return;
    }
    await storage.revokePostMortemInstructions(token);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.post('/participant/admin/arco', async (req: Request, res: Response) => {
  try {
    const { token, requestType, details, email } = req.body;
    if (!token) {
      res.status(400).json({ success: false, error: 'Token requerido.' });
      return;
    }
    const arco = await storage.submitArcoRequest(token, {
      requestType,
      details,
      email,
    });
    res.json({ success: true, data: arco });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.get('/admin/privacy/consents', requireAdmin, (_req: Request, res: Response) => {
  try {
    const consents = storage.getAllPrivacyConsents();
    res.json({ success: true, data: consents });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.get('/admin/privacy/arco-requests', requireAdmin, (_req: Request, res: Response) => {
  try {
    const requests = storage.getAllARCORequests();
    res.json({ success: true, data: requests });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.get('/admin/privacy/deliveries', requireAdmin, (_req: Request, res: Response) => {
  try {
    const deliveries = storage.getAllDeliverySchedules();
    res.json({ success: true, data: deliveries });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ============================================================================
// PUBLIC FREE TRIAL DEMO ENDPOINTS (100% STATELESS — ZERO DATABASE WRITES)
// ============================================================================

apiRouter.post('/demo/followup', async (req: Request, res: Response) => {
  if (!checkDemoRateLimit(req, 50, 10 * 60 * 1000)) {
    res.status(429).json({
      success: false,
      error: 'Has realizado demasiadas solicitudes en poco tiempo. Espera un momento e intenta de nuevo.',
    });
    return;
  }

  try {
    const result = await generateTransientDemoFollowUp(req.body || {});
    res.json({ success: true, data: result });
  } catch (_err: unknown) {
    res.status(500).json({
      success: false,
      error: 'No fue posible preparar la pregunta de profundización en este momento.',
    });
  }
});

apiRouter.post('/demo/manuscript', async (req: Request, res: Response) => {
  if (!checkDemoRateLimit(req, 20, 10 * 60 * 1000)) {
    res.status(429).json({
      success: false,
      error: 'Has realizado demasiadas generaciones seguidas. Espera un momento e intenta de nuevo.',
    });
    return;
  }

  try {
    const manuscript = await generateTransientDemoManuscript(req.body || {});
    res.json({ success: true, data: manuscript });
  } catch (_err: unknown) {
    res.status(500).json({
      success: false,
      error: 'No fue posible redactar el manuscrito en este momento. Por favor intenta nuevamente.',
    });
  }
});

// Transcribe voice recording for Free Trial Demo
apiRouter.post('/demo/audio/transcribe', async (req: Request, res: Response) => {
  if (!checkDemoRateLimit(req, 60, 10 * 60 * 1000)) {
    res.status(429).json({
      success: false,
      error: 'Has realizado demasiadas grabaciones en poco tiempo. Espera un momento e intenta de nuevo.',
    });
    return;
  }

  try {
    const { audioBase64, mimeType, clientTranscription } = req.body || {};
    if (!audioBase64) {
      res.status(400).json({ success: false, error: 'Archivo de audio requerido en formato Base64.' });
      return;
    }

    const result = await analyzeAndTranscribeAudioWithGemini({
      audioBase64,
      mimeType: mimeType || 'audio/webm',
    });

    res.json({
      success: true,
      data: {
        transcription: result.transcription || '',
        audioQuality: result.audioQuality || 'clear',
        qualityWarning: result.qualityWarning,
        suggestion: result.suggestion,
      },
    });
  } catch (err: unknown) {
    console.error('[Demo Audio Transcribe Error]:', err);
    res.status(500).json({
      success: false,
      error: 'No fue posible transcribir el audio en este momento. Puedes escribir tu recuerdo con tu teclado.',
    });
  }
});

// Admin Firestore Quota & Sync Telemetry Endpoints
apiRouter.get('/admin/firestore-quota', requireAdmin, (_req: Request, res: Response) => {
  try {
    const report = firestoreTelemetry.getReport(storage.getFirestoreSyncStatus());
    res.json({ success: true, data: report });
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: (err as Error).message || 'Error al obtener la telemetría de cuotas Firestore.',
    });
  }
});

apiRouter.post('/admin/firestore-quota/probe', requireAdmin, async (req: Request, res: Response) => {
  try {
    const probe = await firestoreTelemetry.probeLiveFirestoreStatus(serverDb);
    if (probe.healthy && !probe.quotaExhausted && req.body?.sync !== false) {
      await storage.syncFromFirestore(false, 'incremental');
    }
    const report = firestoreTelemetry.getReport(storage.getFirestoreSyncStatus());
    res.json({ success: true, data: report });
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: (err as Error).message || 'Error al verificar el estado en vivo de Cloud Firestore.',
    });
  }
});

// Unified Real-Time System Statistics Endpoint (Quantitative + Qualitative across Interviews, Books, Privacy & Mi Esencia)
apiRouter.get('/admin/system-statistics', requireAdmin, async (_req: Request, res: Response) => {
  try {
    await storage.syncFromFirestore(false, 'incremental');
    await miEsenciaStore.ensureInitialized();
    const core = storage.getSystemStatisticsSummary();
    const miEsencia = miEsenciaStore.getAdminOverviewData();
    res.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        core,
        miEsencia,
      },
    });
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: (err as Error).message || 'Error al obtener las estadísticas del sistema.',
    });
  }
});

// Admin: Update registration details for participants of an interview (preserving answers, tokens, and books)
apiRouter.put(
  '/admin/interviews/:id/registration-data',
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const admin = (req as any).adminUser as string;
      const result = await storage.updateInterviewParticipantRegistrations({
        interviewId: req.params.id,
        interviewTitle: req.body?.interviewTitle,
        participants: Array.isArray(req.body?.participants) ? req.body.participants : [],
        performedBy: admin,
      });
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({
        success: false,
        error: (err as Error).message || 'No se pudieron actualizar los datos de registro.',
      });
    }
  }
);

function resolvePublicBaseUrl(_req: Request): string {
  return normalizeCanonicalPublicOrigin(process.env.PUBLIC_CANONICAL_URL);
}

// Public: Download or view brief illustrated user manual PDF
apiRouter.get('/public/manual-pdf', (req: Request, res: Response) => {
  try {
    const pdfBuffer = buildUserManualPdfBuffer();
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="Manual_Usuario_YouForever.pdf"`);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(pdfBuffer);
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: (err as Error).message || 'No se pudo generar el manual en PDF.',
    });
  }
});

// Public: Self-registration (/free) — creates interview + access tokens + privacy consent + sends welcome email(s)
// V5.8.5 (#9): anti-spam limits, editable in Configuración Global.
const freeRegistrationLimiter = new FreeRegistrationLimiter(() => storage.getConfig().freeRegistrationLimits!);

function freeRegistrationEmails(body: any): string[] {
  const list = Array.isArray(body?.participants) ? body.participants : [];
  const emails = list
    .map((p: any) => String(p?.email || '').trim().toLowerCase())
    .filter((e: string) => e.length > 0);
  return Array.from(new Set<string>(emails));
}

apiRouter.post('/public/free-register', async (req: Request, res: Response) => {
  try {
    const clientKey = clientKeyFromRequest(req);
    const emails = freeRegistrationEmails(req.body);
    const limitMessage = freeRegistrationLimiter.checkRegistration(clientKey, emails);
    if (limitMessage) {
      res.status(429).json({ success: false, error: limitMessage });
      return;
    }

    const result = await storage.createFreeSelfRegisteredInterview({
      payload: req.body,
      userAgent: String(req.headers['user-agent'] || ''),
    });

    const baseUrl = resolvePublicBaseUrl(req);
    const manualPdfUrl = `${baseUrl}/api/public/manual-pdf`;
    const portalUrl = `${baseUrl}/`;

    const emailResults: EmailSendResult[] = await Promise.all(
      result.participantTokens.map((pt) =>
        sendSelfRegisterParticipantEmail({
          participantId: pt.participant.id,
          participantName: pt.participant.name,
          recipientEmail: pt.participant.email || '',
          interviewTitle: result.interview.title,
          storyMode: result.interview.storyMode,
          role: pt.participant.role,
          accessCode: pt.accessCode,
          directUrl: `${baseUrl}${pt.inviteUrl}`,
          manualPdfUrl,
          portalUrl,
          expiresAtIso: result.interview.expiresAt,
        })
      )
    );

    const emailResultMap = new Map(emailResults.map((er) => [er.participantId, er]));
    freeRegistrationLimiter.recordRegistration(clientKey, emails);

    res.json({
      success: true,
      data: {
        interview: {
          id: result.interview.id,
          title: result.interview.title,
          storyMode: result.interview.storyMode,
          openedAt: result.interview.openedAt,
          expiresAt: result.interview.expiresAt,
          openDaysAtCreation: result.interview.openDaysAtCreation,
          sufficiencyThreshold: result.interview.sufficiencyThreshold,
          layoutEditsAllowed: result.interview.layoutEditsAllowed ?? 1,
        },
        manualPdfUrl,
        emailConfig: getEmailConfigStatus(),
        participants: result.participantTokens.map((pt) => ({
          participantId: pt.participant.id,
          name: pt.participant.name,
          email: pt.participant.email || '',
          age: pt.participant.age ?? null,
          city: pt.participant.city || '',
          relationship: pt.participant.relationship,
          role: pt.participant.role,
          accessCode: pt.accessCode,
          plainToken: pt.plainToken,
          inviteUrl: pt.inviteUrl,
          directUrl: `${baseUrl}${pt.inviteUrl}`,
          emailStatus: emailResultMap.get(pt.participant.id) || {
            sent: false,
            recipientEmail: pt.participant.email || '',
            participantId: pt.participant.id,
            participantName: pt.participant.name,
            error: 'No se pudo determinar el estado del envío.',
            attemptedAt: new Date().toISOString(),
          },
        })),
      },
    });
  } catch (err: unknown) {
    res.status(400).json({
      success: false,
      error: (err as Error).message || 'No se pudo completar tu registro.',
    });
  }
});

// Public: Retry welcome email delivery WITHOUT duplicating interview or registration records
apiRouter.post('/public/free-register/:interviewId/retry-email', async (req: Request, res: Response) => {
  try {
    const interview = storage.getInterview(req.params.interviewId);
    if (!interview) {
      res.status(404).json({
        success: false,
        error: 'No se encontró la entrevista registrada para reintentar el correo.',
      });
      return;
    }

    if (interview.registrationSource !== 'self_register_free') {
      res.status(403).json({
        success: false,
        error: 'Esta entrevista no corresponde a un autorregistro público.',
      });
      return;
    }

    // V5.8.5 (#9): one resend per interview every N minutes (Configuración Global).
    const resendMessage = freeRegistrationLimiter.checkResend(interview.id);
    if (resendMessage) {
      res.status(429).json({ success: false, error: resendMessage });
      return;
    }

    const participants = storage.getParticipantsForInterview(interview.id);
    const requestedIds: string[] | null = Array.isArray(req.body?.participantIds)
      ? req.body.participantIds.map((id: unknown) => String(id))
      : null;

    const targets = participants.filter((p) => {
      if (requestedIds && requestedIds.length > 0 && !requestedIds.includes(p.id)) {
        return false;
      }
      return Boolean(p.email && p.plainToken);
    });

    if (targets.length === 0) {
      res.status(400).json({
        success: false,
        error: 'No hay participantes con correo registrado para reintentar el envío.',
      });
      return;
    }

    const baseUrl = resolvePublicBaseUrl(req);
    const manualPdfUrl = `${baseUrl}/api/public/manual-pdf`;
    const portalUrl = `${baseUrl}/`;

    const emailResults: EmailSendResult[] = await Promise.all(
      targets.map((p) =>
        sendSelfRegisterParticipantEmail({
          participantId: p.id,
          participantName: p.name,
          recipientEmail: p.email || '',
          interviewTitle: interview.title,
          storyMode: interview.storyMode,
          role: p.role,
          accessCode: p.accessCode || '',
          directUrl: `${baseUrl}/interview?token=${p.plainToken}`,
          manualPdfUrl,
          portalUrl,
          expiresAtIso: interview.expiresAt,
        })
      )
    );
    freeRegistrationLimiter.recordResend(interview.id);

    res.json({
      success: true,
      data: {
        interviewId: interview.id,
        emailConfig: getEmailConfigStatus(),
        emailResults,
      },
    });
  } catch (err: unknown) {
    res.status(400).json({
      success: false,
      error: (err as Error).message || 'No se pudo reintentar el envío del correo.',
    });
  }
});

// Isolated Mi Esencia Subsystem Routes (/api/mi-esencia/*)
apiRouter.use('/mi-esencia', miEsenciaRouter);

// V5.9.0 — Voz clonada con ElevenLabs y conversación de viva voz (/api/voice/*). Aditivo:
// las rutas de administración pasan primero por requireAdmin.
apiRouter.use('/voice/admin', requireAdmin);
apiRouter.use('/voice', voiceRouter);

// Explicit 404 handler for API routes to guarantee JSON response and prevent falling through to Vite SPA index.html
apiRouter.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: `Ruta API no encontrada: ${req.method} ${req.originalUrl}`,
  });
});

// Centralized error handler for API routes
apiRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[API Router Error]:', err);
  const message = err instanceof Error ? err.message : String(err);
  if (!res.headersSent) {
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

