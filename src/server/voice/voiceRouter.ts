/**
 * V5.9.0 — Rutas de la voz clonada (/api/voice/*).
 *
 *   /participant/*  el entrevistado, con su enlace o código de invitación (token)
 *   /family/*       los familiares, con su código personal de Mi Esencia (validado en el servidor)
 *   /admin/*        sólo administradores (api.ts monta `requireAdmin` antes de este router)
 *
 * El servicio se construye una sola vez con los adaptadores reales (entrevistas y Mi Esencia).
 */
import express, { type Request, type Response, Router } from 'express';
import { storage } from '../storage.ts';
import { miEsenciaStore } from '../miEsencia/miEsenciaStore.ts';
import { createElevenLabsClient, ElevenLabsError } from './elevenLabsClient.ts';
import { createFirestoreVoiceDocStore } from './voiceDocStore.ts';
import { VoiceService, VoiceServiceError, voiceErrorCategory, type VoiceFamilyAdapter, type VoiceInterviewAdapter } from './voiceService.ts';

export const interviewAdapter: VoiceInterviewAdapter = {
  resolveParticipantToken(token: string) {
    const { interview, participant } = storage.resolveToken(String(token || ''));
    return { interviewId: interview.id, participantId: participant.id, participantName: participant.name };
  },
  listParticipantRecordings(interviewId: string, participantId: string) {
    return storage
      .getAudiosForInterview(interviewId)
      .filter((a) => a.participantId === participantId)
      .map((a) => ({ id: a.id, durationSeconds: a.durationSeconds, mimeType: a.mimeType, createdAt: a.createdAt }));
  },
  readRecording(audioId: string) {
    // A copy is read; the original recording is never modified.
    return storage.getAudioBufferAsync(audioId);
  },
};

export const familyAdapter: VoiceFamilyAdapter = {
  verifyFamilyAccess(personalCode: string, selectedPersonId?: string) {
    const check = miEsenciaStore.verifyPersonalAccessCode(String(personalCode || ''));
    if (!check.valid || !check.interlocutor || !check.subscription || !check.persons || check.persons.length === 0) {
      throw new VoiceServiceError(check.error || 'Acceso no autorizado.', 'unauthorized', 401);
    }
    const person = check.persons.find((p) => p.personId === selectedPersonId) || check.persons[0];
    const interviewId = person.sourceInterviewId || null;
    let participantId = person.sourceParticipantId || null;
    if (!participantId && interviewId) {
      const parts = storage.getParticipantsForInterview(interviewId);
      if (parts.length === 1) participantId = parts[0].id;
    }
    return {
      interlocutorId: check.interlocutor.interlocutorId,
      avatarId: check.subscription.avatarId,
      personId: person.personId,
      personName: person.preferredName || person.fullName,
      interviewId,
      participantId,
    };
  },
  converse(params) {
    return miEsenciaStore.converseWithAvatar({ ...params, acceptConsent: true, quotaChannel: 'voice' });
  },
};

let service: VoiceService | null = null;
export function getVoiceService(): VoiceService {
  if (!service) {
    service = new VoiceService({
      store: createFirestoreVoiceDocStore(),
      client: createElevenLabsClient(),
      interviews: interviewAdapter,
      family: familyAdapter,
    });
  }
  return service;
}

/** Sólo para pruebas automatizadas. */
export function setVoiceServiceForTests(s: VoiceService | null): void {
  service = s;
}

const send = (res: Response, fn: () => Promise<unknown>) =>
  fn()
    .then((data) => res.json({ success: true, data }))
    .catch((err: any) => {
      if (err instanceof VoiceServiceError) {
        res.status(err.httpStatus).json({ success: false, error: err.message, code: err.code, category: voiceErrorCategory(err) });
        return;
      }
      // V5.9.3 — ElevenLabs failures: a message the participant understands and what kind of problem it is.
      console.warn(`[voz] ${err?.message || err}`);
      const category = voiceErrorCategory(err);
      const message =
        err instanceof ElevenLabsError
          ? category === 'configuracion'
            ? 'El servicio de voz no está configurado correctamente.'
            : category === 'cuenta'
            ? 'La cuenta del servicio de voz alcanzó un límite de su plan.'
            : category === 'temporal'
            ? 'El servicio de voz no respondió a tiempo.'
            : 'El servicio de voz no pudo completar la operación.'
          : err?.message || 'Error del servicio de voz.';
      res.status(err instanceof ElevenLabsError ? 502 : 400).json({ success: false, error: message, code: `voice_${category}`, category });
    });

export const voiceRouter: Router = express.Router();

// ------------------------------------------------------------------ participante -------------
voiceRouter.post('/participant/status', (req: Request, res: Response) =>
  send(res, () => getVoiceService().participantStatus(req.body?.token))
);
voiceRouter.post('/participant/authorize', (req: Request, res: Response) =>
  send(res, () =>
    getVoiceService().authorize(req.body?.token, req.body?.source === 'finalizar_entrevista' ? 'finalizar_entrevista' : 'portal')
  )
);
voiceRouter.post('/participant/analyze', (req: Request, res: Response) =>
  send(res, () => getVoiceService().analyzeSamples(req.body?.token, { maxRecordings: Number(req.body?.maxRecordings) || undefined }))
);
voiceRouter.post('/participant/extra-sample', (req: Request, res: Response) =>
  send(res, () =>
    getVoiceService().submitExtraSample(req.body?.token, {
      audioBase64: req.body?.audioBase64,
      mimeType: req.body?.mimeType,
      durationSeconds: req.body?.durationSeconds,
    })
  )
);
voiceRouter.post('/participant/create-instant', (req: Request, res: Response) =>
  send(res, () => getVoiceService().startInstantClone(req.body?.token, { verify: req.body?.verify === false ? false : undefined }))
);
voiceRouter.post('/participant/preview', (req: Request, res: Response) =>
  send(res, () => getVoiceService().previewVoice(req.body?.token))
);
voiceRouter.post('/participant/link-professional', (req: Request, res: Response) =>
  send(res, () => getVoiceService().linkProfessionalVoice(req.body?.token, req.body?.shareLink))
);
voiceRouter.post('/participant/recheck', (req: Request, res: Response) =>
  send(res, () => getVoiceService().recheckPending(req.body?.token))
);

// ------------------------------------------------------------------ familiares ---------------
voiceRouter.post('/family/status', (req: Request, res: Response) =>
  send(res, async () => {
    await miEsenciaStore.ensureInitialized();
    return getVoiceService().familyVoiceStatus(req.body?.personalCode, req.body?.selectedPersonId);
  })
);
voiceRouter.post('/family/turn', (req: Request, res: Response) =>
  send(res, async () => {
    await miEsenciaStore.ensureInitialized();
    return getVoiceService().familyTurn({
      personalCode: req.body?.personalCode,
      selectedPersonId: req.body?.selectedPersonId,
      sessionId: req.body?.sessionId,
      turnId: req.body?.turnId,
      audioBase64: req.body?.audioBase64,
      mimeType: req.body?.mimeType,
      durationSeconds: req.body?.durationSeconds,
    });
  })
);
voiceRouter.post('/family/ack', (req: Request, res: Response) =>
  send(res, async () => {
    await miEsenciaStore.ensureInitialized();
    return getVoiceService().acknowledgeTurn({
      personalCode: req.body?.personalCode,
      selectedPersonId: req.body?.selectedPersonId,
      turnId: req.body?.turnId,
      delivered: req.body?.delivered !== false,
    });
  })
);

// ------------------------------------------------------------------ administración -----------
const adminOf = (req: Request) => String((req as any).adminUser || 'admin');

voiceRouter.get('/admin/settings', (_req: Request, res: Response) => send(res, () => getVoiceService().getSettings()));
voiceRouter.post('/admin/settings', (req: Request, res: Response) =>
  send(res, () => getVoiceService().updateSettings(req.body || {}, adminOf(req)))
);
voiceRouter.get('/admin/account', (_req: Request, res: Response) => send(res, () => getVoiceService().accountInfo()));
voiceRouter.get('/admin/profiles', (_req: Request, res: Response) =>
  send(res, async () => {
    const profiles = await getVoiceService().listAllProfiles();
    // Admin view: no sample audio, only status and the requirement pending.
    return profiles.map(({ lock: _lock, ...p }) => p);
  })
);
voiceRouter.post('/admin/interview-status', (req: Request, res: Response) =>
  send(res, async () => {
    const svc = getVoiceService();
    const interviewId = String(req.body?.interviewId || '');
    const [profiles, quota, override] = await Promise.all([
      svc.listProfilesForInterview(interviewId),
      svc.getQuotaStatus(interviewId),
      svc.getQuotaOverride(interviewId),
    ]);
    return { profiles: profiles.map(({ lock: _lock, ...p }) => p), quota, override };
  })
);
voiceRouter.post('/admin/quota-override', (req: Request, res: Response) =>
  send(res, () =>
    getVoiceService().setQuotaOverride(
      String(req.body?.interviewId || ''),
      req.body?.dailyLimit === null || req.body?.dailyLimit === undefined ? null : Number(req.body.dailyLimit),
      adminOf(req)
    )
  )
);
voiceRouter.post('/admin/test', (req: Request, res: Response) =>
  send(res, () =>
    getVoiceService().runAdminTest({
      profileId: req.body?.profileId,
      text: req.body?.text,
      modelId: req.body?.modelId,
      purpose: req.body?.purpose,
      createdBy: adminOf(req),
    })
  )
);
voiceRouter.get('/admin/test-runs', (_req: Request, res: Response) => send(res, () => getVoiceService().listAdminTestRuns(100)));
voiceRouter.post('/admin/conversation-estimate', (req: Request, res: Response) =>
  send(res, async () => getVoiceService().conversationMinuteEstimate(String(req.body?.modelId || 'eleven_flash_v2_5')))
);
