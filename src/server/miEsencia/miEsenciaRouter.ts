import express, { Request, Response, Router } from 'express';
import { miEsenciaStore } from './miEsenciaStore.ts';
import {
  getAdminUser,
  checkAccessCodeBruteForce,
  recordAccessCodeFailure,
  resetAccessCodeFailures,
} from '../api.ts';

export const miEsenciaRouter: Router = express.Router();

function requireMiEsenciaAdmin(req: Request, res: Response, next: express.NextFunction): void {
  const deny = () =>
    res.status(401).json({
      success: false,
      error: 'Acceso administrativo requerido para gestionar Mi Esencia.',
    });
  // V5.3.1: verified server-side identity (see ../adminAuth.ts).
  getAdminUser(req)
    .then((admin) => {
      if (!admin) {
        deny();
        return;
      }
      (req as any).adminUser = admin;
      next();
    })
    .catch(deny);
}

// ============================================================================
// ADMIN ENDPOINTS (/api/mi-esencia/admin/*)
// ============================================================================

miEsenciaRouter.get('/admin/overview', requireMiEsenciaAdmin, async (_req: Request, res: Response) => {
  try {
    await miEsenciaStore.ensureInitialized();
    const data = miEsenciaStore.getAdminOverviewData();
    res.json({ success: true, data });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

miEsenciaRouter.post('/admin/config', requireMiEsenciaAdmin, async (req: Request, res: Response) => {
  try {
    const admin = (req as any).adminUser as string;
    const updated = await miEsenciaStore.updateConfig(req.body || {}, admin);
    res.json({ success: true, data: updated });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

miEsenciaRouter.post(
  '/admin/avatars/create-or-sync',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const admin = (req as any).adminUser as string;
      const result = await miEsenciaStore.createOrSyncAvatarFromInterview({
        ...(req.body || {}),
        adminEmail: admin,
      });
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.get(
  '/admin/pdfs/:pdfId/download',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const pdf = miEsenciaStore.getCompilationPdfById(req.params.pdfId);
      if (!pdf || !pdf.pdfBase64) {
        res.status(404).json({
          success: false,
          error: 'Archivo PDF del Compilado Testimonial Fidedigno no encontrado.',
        });
        return;
      }
      res.json({
        success: true,
        data: {
          pdfId: pdf.pdfId,
          fileName: pdf.fileName,
          pdfBase64: pdf.pdfBase64,
          rawTextContent: pdf.rawTextContent,
          sha256Hash: pdf.sha256Hash,
        },
      });
    } catch (err: unknown) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/persons/update',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      const updated = await miEsenciaStore.updatePersonProfileSettings(req.body || {});
      res.json({ success: true, data: updated });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post('/admin/plans', requireMiEsenciaAdmin, async (req: Request, res: Response) => {
  try {
    await miEsenciaStore.ensureInitialized();
    const plan = await miEsenciaStore.savePlan(req.body || {});
    res.json({ success: true, data: plan });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

miEsenciaRouter.post(
  '/admin/subscriptions/action',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const admin = (req as any).adminUser as string;
      const result = await miEsenciaStore.updateSubscriptionDurationOrStatus({
        ...(req.body || {}),
        adminEmail: admin,
      });
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/subscriptions/monthly-usage',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const admin = (req as any).adminUser as string;
      const result = await miEsenciaStore.updateSubscriptionMonthlyUsage({
        ...(req.body || {}),
        adminEmail: admin,
      });
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/subscriptions/monthly-usage-bulk',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const admin = (req as any).adminUser as string;
      const result = await miEsenciaStore.applyMonthlyQuotaToAllSubscriptions({
        ...(req.body || {}),
        adminEmail: admin,
      });
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/interlocutors/create',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const admin = (req as any).adminUser as string;
      const result = await miEsenciaStore.createInterlocutorWithCode({
        ...(req.body || {}),
        adminEmail: admin,
      });
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/credentials/status',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const admin = (req as any).adminUser as string;
      const result = await miEsenciaStore.revokeOrUpdateCredentialStatus({
        ...(req.body || {}),
        adminEmail: admin,
      });
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/credentials/update',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const admin = (req as any).adminUser as string;
      const result = await miEsenciaStore.updateInterlocutorAndCredential({
        ...(req.body || {}),
        adminEmail: admin,
      });
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/memories/revoke',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      const result = await miEsenciaStore.undoOrRevokeMemory({
        memoryId: req.body?.memoryId,
        isAdmin: true,
      });
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/contradictions/resolve',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      const admin = (req as any).adminUser as string;
      const result = await miEsenciaStore.resolveContradiction({
        contradictionId: req.body?.contradictionId,
        status: req.body?.status || 'resuelta_por_admin',
        officialResolutionNotes: req.body?.officialResolutionNotes || '',
        keepBothVersionsAttributed: Boolean(req.body?.keepBothVersionsAttributed),
        resolvedBy: admin,
      });
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/snapshots/create',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      const admin = (req as any).adminUser as string;
      const snap = await miEsenciaStore.createSnapshot({
        avatarId: req.body?.avatarId,
        label: req.body?.label || 'Instantánea manual del administrador',
        triggerType: 'manual_admin',
        createdBy: admin,
      });
      res.json({ success: true, data: snap });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/snapshots/restore',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      const admin = (req as any).adminUser as string;
      const result = await miEsenciaStore.restoreAvatarState({
        ...(req.body || {}),
        adminEmail: admin,
      });
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/coupons/create',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      const coupon = await miEsenciaStore.createCoupon(req.body || {});
      res.json({ success: true, data: coupon });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/conversations/delete',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const { sessionId } = req.body || {};
      const result = await miEsenciaStore.deleteConversationSession(sessionId);
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/credentials/delete',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const { accessCredentialId } = req.body || {};
      const result = await miEsenciaStore.deleteAccessCredential(accessCredentialId);
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/subscriptions/daily-usage',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const admin = (req as any).adminUser as string;
      const result = await miEsenciaStore.updateSubscriptionDailyUsage({
        ...(req.body || {}),
        adminEmail: admin,
      });
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/subscriptions/daily-usage-bulk',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const admin = (req as any).adminUser as string;
      const result = await miEsenciaStore.applyDailyQuotaToAllSubscriptions({
        ...(req.body || {}),
        adminEmail: admin,
      });
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/interlocutors/daily-usage',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const admin = (req as any).adminUser as string;
      const result = await miEsenciaStore.updateInterlocutorDailyUsage({
        ...(req.body || {}),
        adminEmail: admin,
      });
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/persons/delete',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const { personId } = req.body || {};
      const result = await miEsenciaStore.deletePersonProfileAndArchivedPdf(personId);
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/fallback-logs/clear',
  requireMiEsenciaAdmin,
  async (_req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const result = await miEsenciaStore.clearFallbackLogs();
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

// ============================================================================
// ADMIN ENDPOINTS: DUAL AI PROVIDERS, PROMPTS, PDF REPLACEMENT & SIMULATOR
// ============================================================================

miEsenciaRouter.get(
  '/admin/ai-status',
  requireMiEsenciaAdmin,
  async (_req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const status = miEsenciaStore.getProvidersStatus();
      res.json({ success: true, data: status });
    } catch (err: unknown) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/ai-test-connection',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const provider = req.body?.provider === 'gemini' ? 'gemini' : 'openai';
      const model = typeof req.body?.model === 'string' ? req.body.model.trim() : undefined;
      const result = await miEsenciaStore.testAiProviderConnection({
        provider,
        model,
      });
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/persons/ai-config',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const admin = (req as any).adminUser as string;
      const result = await miEsenciaStore.updatePersonAiConfigAndPrompts({
        ...(req.body || {}),
        adminEmail: admin,
      });
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/persons/prompt-restore',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const admin = (req as any).adminUser as string;
      const result = await miEsenciaStore.restoreAvatarPromptVersion({
        personId: req.body?.personId,
        versionId: req.body?.versionId,
        adminEmail: admin,
      });
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/persons/replace-pdf',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const admin = (req as any).adminUser as string;
      const result = await miEsenciaStore.replacePersonCompilationPdf({
        personId: req.body?.personId,
        fileName: req.body?.fileName,
        pdfBase64: req.body?.pdfBase64,
        rawCompilationText: req.body?.rawCompilationText,
        adminEmail: admin,
      });
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/prompts/save',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const admin = (req as any).adminUser as string;
      const record = await miEsenciaStore.saveLibraryPrompt({
        ...(req.body || {}),
        adminEmail: admin,
      });
      res.json({ success: true, data: record });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/prompts/duplicate',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const admin = (req as any).adminUser as string;
      const record = await miEsenciaStore.duplicateLibraryPrompt({
        promptId: req.body?.promptId,
        adminEmail: admin,
      });
      res.json({ success: true, data: record });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/prompts/delete',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const result = await miEsenciaStore.deleteLibraryPrompt(req.body?.promptId);
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/prompts/restore-version',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const admin = (req as any).adminUser as string;
      const updated = await miEsenciaStore.restoreLibraryPromptVersion({
        promptId: req.body?.promptId,
        versionId: req.body?.versionId,
        adminEmail: admin,
      });
      res.json({ success: true, data: updated });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/prompts/assign-to-avatar',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const admin = (req as any).adminUser as string;
      const result = await miEsenciaStore.assignLibraryPromptCopyToAvatar({
        promptId: req.body?.promptId,
        personId: req.body?.personId,
        targetProvider: req.body?.targetProvider || 'ambos',
        activateCustomMode: Boolean(req.body?.activateCustomMode),
        adminEmail: admin,
      });
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/prompts/import',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const admin = (req as any).adminUser as string;
      const created = await miEsenciaStore.importLibraryPrompts({
        rawContent: req.body?.rawContent || '',
        format: req.body?.format || 'txt',
        defaultName: req.body?.defaultName,
        defaultCategory: req.body?.defaultCategory,
        defaultCompatibleProvider: req.body?.defaultCompatibleProvider,
        adminEmail: admin,
      });
      res.json({ success: true, data: created });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/prompts/export',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const exported = miEsenciaStore.exportLibraryPrompts({
        promptIds: Array.isArray(req.body?.promptIds) ? req.body.promptIds : undefined,
        format: req.body?.format || 'json',
      });
      res.json({ success: true, data: exported });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/prompts/categories',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const admin = (req as any).adminUser as string;
      const categories = await miEsenciaStore.addCustomPromptCategory(
        req.body?.categoryName || '',
        admin
      );
      res.json({ success: true, data: categories });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/simulator/preview-variables',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const preview = miEsenciaStore.previewAvatarPromptVariables({
        personId: req.body?.personId,
        promptTemplate: req.body?.promptTemplate || '',
        simulatedInterlocutorName: req.body?.simulatedInterlocutorName,
        simulatedRelationship: req.body?.simulatedRelationship,
        simulatedNickname: req.body?.simulatedNickname,
      });
      res.json({ success: true, data: preview });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

miEsenciaRouter.post(
  '/admin/simulator/converse',
  requireMiEsenciaAdmin,
  async (req: Request, res: Response) => {
    try {
      await miEsenciaStore.ensureInitialized();
      const result = await miEsenciaStore.runAdminSimulatorTurn({
        personId: req.body?.personId,
        provider: req.body?.provider || 'gemini',
        model: req.body?.model,
        draftPromptContent: req.body?.draftPromptContent,
        userMessage: req.body?.userMessage || '',
        simulatedHistory: Array.isArray(req.body?.simulatedHistory)
          ? req.body.simulatedHistory
          : [],
        simulatedInterlocutorName: req.body?.simulatedInterlocutorName,
        simulatedRelationship: req.body?.simulatedRelationship,
        simulatedNickname: req.body?.simulatedNickname,
        simulatePrimaryFailure: Boolean(req.body?.simulatePrimaryFailure),
        simulateBothProvidersFailure: Boolean(req.body?.simulateBothProvidersFailure),
      });
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  }
);

// ============================================================================
// FAMILY CONVERSATIONAL PORTAL ENDPOINTS (/api/mi-esencia/family/*)
// ============================================================================

miEsenciaRouter.post('/family/verify-code', async (req: Request, res: Response) => {
  try {
    const bruteCheck = checkAccessCodeBruteForce(req);
    if (bruteCheck.blocked) {
      res.status(429).json({
        success: false,
        error: `Demasiados intentos fallidos de código personal. Por seguridad anti-fuerza bruta, espera ${bruteCheck.retryAfterMinutes} minuto(s) antes de volver a intentar.`,
      });
      return;
    }

    await miEsenciaStore.ensureInitialized();
    const { personalCode } = req.body || {};
    const check = miEsenciaStore.verifyPersonalAccessCode(personalCode);
    if (!check.valid || !check.interlocutor || !check.subscription || !check.persons) {
      recordAccessCodeFailure(req);
      res.status(401).json({
        success: false,
        error: check.error || 'Código personal inválido.',
      });
      return;
    }
    resetAccessCodeFailures(req);

    // Asegurar que cada perfil de persona tenga al menos una sesión activa con su saludo reflexivo inicial
    for (const person of check.persons) {
      await miEsenciaStore.ensureOrCreateConversationSession({
        avatarId: check.subscription.avatarId,
        person,
        interlocutor: check.interlocutor,
      });
    }

    // V5.4.2: only this family member's data (before, the whole admin overview of EVERY avatar was
    // built — re-syncing all of them — just to filter these conversations).
    const { sessions, openContradictions } = miEsenciaStore.getFamilyPortalData(
      check.subscription.avatarId,
      check.interlocutor.interlocutorId
    );

    res.json({
      success: true,
      data: {
        interlocutor: check.interlocutor,
        subscription: check.subscription,
        persons: check.persons,
        config: check.config,
        sessions,
        openContradictions,
      },
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

miEsenciaRouter.post('/family/accept-consent', async (req: Request, res: Response) => {
  try {
    await miEsenciaStore.ensureInitialized();
    const { personalCode } = req.body || {};
    const interlocutor = await miEsenciaStore.confirmInterlocutorConsent(personalCode);
    res.json({
      success: true,
      data: { interlocutor },
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

miEsenciaRouter.post('/family/quota-status', async (req: Request, res: Response) => {
  try {
    await miEsenciaStore.ensureInitialized();
    const { personalCode } = req.body || {};
    const check = miEsenciaStore.verifyPersonalAccessCode(personalCode);
    if (!check.valid) {
      res.status(401).json({ success: false, error: check.error || 'No autorizado.' });
      return;
    }
    res.json({
      success: true,
      data: {
        interlocutor: check.interlocutor,
        subscription: check.subscription,
      },
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

miEsenciaRouter.post('/family/new-session', async (req: Request, res: Response) => {
  try {
    await miEsenciaStore.ensureInitialized();
    const { personalCode, selectedPersonId } = req.body || {};
    const { newSession, allSessions } = await miEsenciaStore.startNewConversationSession({
      personalCode,
      selectedPersonId,
    });
    const check = miEsenciaStore.verifyPersonalAccessCode(personalCode);
    const sessions = [...allSessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt));

    res.json({
      success: true,
      data: {
        session: newSession,
        sessions,
        interlocutor: check.interlocutor,
      },
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

miEsenciaRouter.post('/family/converse', async (req: Request, res: Response) => {
  try {
    await miEsenciaStore.ensureInitialized();
    const result = await miEsenciaStore.converseWithAvatar(req.body || {});
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// V5.4.0 — Fotografía real del testimonio mostrada en el chat (validada contra el código personal;
// se pide por POST para que el código nunca viaje en una URL).
miEsenciaRouter.post('/family/photo', async (req: Request, res: Response) => {
  try {
    await miEsenciaStore.ensureInitialized();
    const { personalCode, photoId } = req.body || {};
    const photo = await miEsenciaStore.getFamilyChatPhoto({ personalCode, photoId });
    if (!photo) {
      res.status(404).json({ success: false, error: 'Fotografía no disponible.' });
      return;
    }
    res.setHeader('Content-Type', photo.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(photo.buffer);
  } catch (err: unknown) {
    res.status(401).json({ success: false, error: (err as Error).message });
  }
});

miEsenciaRouter.post('/family/undo-memory', async (req: Request, res: Response) => {
  try {
    const { personalCode, memoryId } = req.body || {};
    const check = miEsenciaStore.verifyPersonalAccessCode(personalCode);
    if (!check.valid || !check.interlocutor) {
      res.status(401).json({ success: false, error: 'No autorizado.' });
      return;
    }
    const revoked = await miEsenciaStore.undoOrRevokeMemory({
      memoryId,
      interlocutorId: check.interlocutor.interlocutorId,
      isAdmin: false,
    });
    res.json({ success: true, data: revoked });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

miEsenciaRouter.post('/family/resolve-contradiction', async (req: Request, res: Response) => {
  try {
    const { personalCode, contradictionId, officialResolutionNotes, keepBothVersionsAttributed } =
      req.body || {};
    const check = miEsenciaStore.verifyPersonalAccessCode(personalCode);
    if (!check.valid || !check.interlocutor) {
      res.status(401).json({ success: false, error: 'No autorizado.' });
      return;
    }
    const resolved = await miEsenciaStore.resolveContradiction({
      contradictionId,
      status: 'aclarada_por_familia',
      officialResolutionNotes: officialResolutionNotes || '',
      keepBothVersionsAttributed: Boolean(keepBothVersionsAttributed),
      resolvedBy: `${check.interlocutor.relationshipToPerson} ${check.interlocutor.fullName}`,
    });
    res.json({ success: true, data: resolved });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});
