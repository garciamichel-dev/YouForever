import express, { Request, Response, NextFunction, Router } from 'express';
import { storage } from './storage.ts';
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
} from '../logic/interviewRules.ts';

export const apiRouter: Router = express.Router();
apiRouter.use(express.json({ limit: '100mb' }));

// Ensure Firestore state is hydrated before processing any API request (handles Cloud Run scale-to-zero cold starts)
apiRouter.use(async (_req: Request, _res: Response, next: NextFunction) => {
  try {
    await storage.ensureInitialized();
    next();
  } catch (err: any) {
    console.warn('Storage initialization note (proceeding with memory cache):', err?.message || err);
    next();
  }
});

// --- Helper: Admin verification & Middleware ---
export function getAdminUser(req: Request): string | null {
  const queryAdmin = req.query.admin || req.query.adminEmail || req.query.token;
  if (typeof queryAdmin === 'string' && queryAdmin.trim().length > 0) {
    const email = queryAdmin.trim().toLowerCase();
    if (storage.isAdmin(email)) {
      return email;
    }
  }

  const adminHeader = req.headers['x-admin-user'] || req.headers['x-admin-email'];
  if (typeof adminHeader === 'string' && adminHeader.trim().length > 0) {
    const email = adminHeader.trim().toLowerCase();
    if (storage.isAdmin(email)) {
      return email;
    }
  }

  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.trim().length > 0) {
    const raw = authHeader.replace(/^Bearer\s+/i, '').trim().toLowerCase();
    if (storage.isAdmin(raw)) {
      return raw;
    }
  }

  return null;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const admin = getAdminUser(req);
  if (!admin) {
    res.status(401).json({
      success: false,
      error:
        'Acceso no autorizado: Se requiere inicio de sesión administrativo con una cuenta Google autorizada.',
    });
    return;
  }
  (req as any).adminUser = admin;
  next();
}

// Check admin status for authenticated client
apiRouter.get('/auth/admin-check', (req: Request, res: Response) => {
  const emailQuery = ((req.query.email as string) || '').trim().toLowerCase();
  const detectedAdmin = getAdminUser(req);
  const isQueryAdmin = emailQuery ? storage.isAdmin(emailQuery) : false;
  const isAuthorized = !!detectedAdmin || isQueryAdmin;
  const activeEmail = detectedAdmin || (isQueryAdmin ? emailQuery : null);

  res.json({
    success: true,
    data: {
      isAdmin: isAuthorized,
      adminEmail: activeEmail,
      authorizedAdmins: storage.getAdmins(),
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
apiRouter.get('/config', (_req: Request, res: Response) => {
  try {
    const config = storage.getConfig();
    res.json({ success: true, data: config });
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
apiRouter.get('/interviews', requireAdmin, (_req: Request, res: Response) => {
  try {
    const list = storage.getInterviews();
    const enriched = list.map((inv) => {
      const participants = storage.getParticipantsForInterview(inv.id);
      const answers = storage.getAnswersForInterview(inv.id);
      const manuscripts = storage.getManuscriptsForInterview(inv.id);
      return {
        ...inv,
        participants,
        answersCount: answers.length,
        photosCount: answers.reduce((sum, a) => sum + (a.photos?.length || 0), 0),
        manuscriptsCount: manuscripts.length,
        latestManuscriptVersion: manuscripts[0]?.version || 0,
      };
    });
    res.json({ success: true, data: enriched });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Get answers with photos and audio recordings for an interview (admin)
apiRouter.get('/interviews/:id/answers', requireAdmin, (req: Request, res: Response) => {
  try {
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
    const { newDays, reason } = req.body;
    const updated = await storage.reopenInterview(req.params.id, Number(newDays), reason, admin);
    res.json({ success: true, data: updated });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
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

apiRouter.get('/interviews/:id/manuscripts', requireAdmin, (req: Request, res: Response) => {
  try {
    const manuscripts = storage.getManuscriptsForInterview(req.params.id);
    res.json({ success: true, data: manuscripts });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

apiRouter.get('/manuscripts', requireAdmin, (_req: Request, res: Response) => {
  try {
    const manuscripts = storage.getAllManuscripts();
    res.json({ success: true, data: manuscripts });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
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

    const html = generateQACompilationHtml({
      interview,
      participants,
      questions,
      answers,
      photos,
      audios,
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

// Restore browser-cached interviews if server restarted while Firestore quota was exhausted
apiRouter.post('/interviews/restore-cache', requireAdmin, (req: Request, res: Response) => {
  try {
    const { interviews } = req.body;
    if (Array.isArray(interviews) && interviews.length > 0) {
      storage.restoreFromClientCache(interviews);
    }
    const list = storage.getInterviews();
    const enriched = list.map((inv) => {
      const participants = storage.getParticipantsForInterview(inv.id);
      const answers = storage.getAnswersForInterview(inv.id);
      const manuscripts = storage.getManuscriptsForInterview(inv.id);
      return {
        ...inv,
        participants,
        answersCount: answers.length,
        photosCount: answers.reduce((sum, a) => sum + (a.photos?.length || 0), 0),
        manuscriptsCount: manuscripts.length,
        latestManuscriptVersion: manuscripts[0]?.version || 0,
      };
    });
    res.json({ success: true, data: enriched });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// 7. Participant Portal Endpoints
apiRouter.post('/participant/session', (req: Request, res: Response) => {
  try {
    const { token, cachedInterviews } = req.body;
    if (!token) {
      res.status(400).json({ success: false, error: 'Token de invitación requerido.' });
      return;
    }

    if (Array.isArray(cachedInterviews) && cachedInterviews.length > 0) {
      storage.restoreFromClientCache(cachedInterviews);
    }

    const { token: resolvedTokenDoc, interview, participant } = storage.resolveToken(token);
    const questions = storage.getQuestionsForVersion(interview.questionnaireVersionId);
    const answers = storage.getAnswersForInterview(interview.id);
    const otherParticipants = storage.getParticipantsForInterview(interview.id);

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
        interview,
        participant,
        questions,
        answers,
        otherParticipants: otherParticipants.map((p) => ({
          id: p.id,
          name: p.name,
          relationship: p.relationship,
          role: p.role,
        })),
        allowAnswerEditing: storage.getConfig().allowAnswerEditing,
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
    });

    res.json({ success: true, data: result });
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

// Serve stored voice audio recording by ID with HTTP 206 Range streaming support
apiRouter.get('/audio/:audioId', async (req: Request, res: Response) => {
  try {
    const audioPayload = storage.getAudioBuffer(req.params.audioId);
    if (!audioPayload) {
      // Fallback try loading from Firestore
      const audio = await storage.getAudioByIdAsync(req.params.audioId);
      if (!audio || !audio.audioDataUrl) {
        res.status(404).json({ success: false, error: 'Archivo de voz no encontrado.' });
        return;
      }
    }

    const audioData = audioPayload || storage.getAudioBuffer(req.params.audioId);
    if (!audioData) {
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
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(chunk);
      return;
    }

    res.writeHead(200, {
      'Content-Length': total,
      'Content-Type': cleanMime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400',
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

// Serve stored interview photograph by ID
apiRouter.get('/photos/:photoId', async (req: Request, res: Response) => {
  try {
    const photoBuffer = storage.getPhotoBuffer(req.params.photoId);
    if (photoBuffer) {
      res.setHeader('Content-Type', photoBuffer.mimeType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(photoBuffer.buffer);
      return;
    }

    const photo = await storage.getPhotoByIdAsync(req.params.photoId);
    if (!photo || !photo.dataUrl) {
      res.status(404).json({ success: false, error: 'Fotografía no encontrada.' });
      return;
    }

    const match = photo.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      res.status(400).json({ success: false, error: 'Formato de imagen inválido.' });
      return;
    }

    const mimeType = match[1] || photo.mimeType || 'image/jpeg';
    const imgBuffer = Buffer.from(match[2], 'base64');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(imgBuffer);
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

    const finished = await storage.declareVoluntaryCompletion(token, reason || 'Declaración voluntaria');
    res.json({ success: true, data: finished });
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
    const auditLogs = storage.getParticipantAuditLogs(interview.id, participant.id);
    const manuscripts = storage.getManuscriptsForInterview(interview.id);
    const hasGeneratedBook = manuscripts && manuscripts.length > 0;
    const latestManuscript = hasGeneratedBook ? manuscripts[manuscripts.length - 1] : null;

    res.json({
      success: true,
      data: {
        participant,
        interview,
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

