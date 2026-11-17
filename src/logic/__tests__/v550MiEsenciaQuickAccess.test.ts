/**
 * V5.5.0 — Interviewee's quick access to «Mi Esencia» after saving the final PDF of the book.
 *
 * Real StorageManager and MiEsenciaStore (Firestore replaced by in-memory doubles), running inside
 * a temporary directory: the repository's `data/` is never written.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ISOLATED_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'yf_v550_quick_'));

process.chdir(ISOLATED_ROOT);
process.env.GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';
process.env.YOUFOREVER_ALLOW_TEST_DOUBLES = '1';
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error('Red deshabilitada en las pruebas.');
}) as typeof fetch;

let storage: any;
let me: any;
let quick: any;

const remote = {
  docs: new Map<string, unknown>(),
  async setDoc(c: string, id: string, data: Record<string, unknown>) {
    this.docs.set(`${c}/${id}`, JSON.parse(JSON.stringify(data)));
  },
  async deleteDoc(c: string, id: string) {
    this.docs.delete(`${c}/${id}`);
  },
  async getDoc(c: string, id: string) {
    return (this.docs.get(`${c}/${id}`) as any) || null;
  },
};

async function createInterviewWithAnswer(name: string) {
  const created = await storage.createInterview({
    title: `Historia de ${name}`,
    storyMode: 'individual',
    storyType: 'biografia_personal',
    participants: [{ name, relationship: 'Titular', role: 'primary', email: 'participante@example.com' }],
    customSufficiencyThreshold: 100000,
    performedBy: 'admin_pruebas',
  });
  created.interview.maxFollowUpsAtCreation = 0;
  const token = created.participantTokens[0].plainToken;
  const question = storage.getQuestionsForVersion(created.interview.questionnaireVersionId)[0];
  await storage.submitAnswer({
    plainToken: token,
    questionId: question.id,
    answerText: 'Nací en Xalapa, en una casa llena de plantas, y mi abuela me enseñó a cocinar.',
    notRecalled: false,
    idempotencyKey: `a_${Date.now()}_${Math.random()}`,
  });
  return { interview: created.interview, participant: created.participantTokens[0].participant, token };
}

before(async () => {
  ({ storage } = await import(path.join(REPO_ROOT, 'src/server/storage.ts')));
  storage.configureTestDoubles({ remoteDocStore: remote });
  ({ miEsenciaStore: me } = await import(path.join(REPO_ROOT, 'src/server/miEsencia/miEsenciaStore.ts')));
  quick = await import(path.join(REPO_ROOT, 'src/logic/miEsenciaQuickAccess.ts'));
  // Mi Esencia's Firestore writes are replaced by the local snapshot only.
  me.persistDoc = async function () {
    this.saveToDisk();
  };
  me.removeDoc = async function () {
    this.saveToDisk();
  };
  me.config.miEsenciaEnabled = true;
  // The administrator's prompt library contains «GPT V6».
  me.promptLibrary.set('lib_prompt_gpt_v6', {
    promptId: 'lib_prompt_gpt_v6',
    name: 'GPT V6',
    category: 'Conversación familiar',
    compatibleProvider: 'openai',
    content: 'Eres {{nombre}}. Conversa con calidez usando solo tu testimonio. [PROMPT GPT V6]',
    version: 3,
    status: 'disponible',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z',
    updatedBy: 'admin',
    versionHistory: [],
  });
});

after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(process.cwd(), ISOLATED_ROOT);
});

test('V5.5.0-U1: busca el prompt «GPT V6» sin importar mayúsculas, acentos o espacios, y nunca uno archivado', () => {
  const prompts = [
    { name: 'GPT V5', status: 'disponible' },
    { name: ' gpt  v6 ', status: 'archivado', updatedAt: '2026-12-01' },
    { name: 'GPT V6', status: 'disponible', updatedAt: '2026-11-10' },
  ];
  assert.equal(quick.findLibraryPromptByName(prompts, 'GPT V6')?.updatedAt, '2026-11-10');
  assert.equal(quick.findLibraryPromptByName([{ name: 'GPT V5' }], 'GPT V6'), undefined);
  assert.equal(quick.isValidQuickAccessEmail('ana@correo.mx'), true);
  assert.equal(quick.isValidQuickAccessEmail('ana@correo'), false);
});

test('V5.5.0-U2: el correo usa el estilo de /Free, lleva enlace directo y código, y escapa el HTML', () => {
  const email = quick.buildMiEsenciaAccessEmail({
    participantName: 'Ana <b>López</b>',
    avatarDisplayName: 'Ana López',
    personalCode: 'ME-ABCD-1234',
    accessUrl: 'https://www.youforever.app/miesencia?code=ME-ABCD-1234',
    expiresAtIso: '2026-12-17T12:00:00.000Z',
    dailyMessageQuota: 30,
  });
  assert.match(email.subject, /Mi Esencia.*ME-ABCD-1234/);
  assert.match(email.html, /YOUFOREVER • MI ESENCIA/);
  assert.match(email.html, /https:\/\/youforever\.app\/miesencia\?code=ME-ABCD-1234/, 'enlace canónico sin www');
  assert.match(email.html, /Entrar directo a Mi Esencia/);
  assert.match(email.html, /30 mensajes por día/);
  assert.doesNotMatch(email.html, /<b>López<\/b>/);
  assert.match(email.text, /Código de acceso: ME-ABCD-1234/);
});

test('V5.5.0-I1: sin avatar previo, crea uno con la configuración por defecto del acceso rápido', async () => {
  const { interview, participant } = await createInterviewWithAnswer('Elena Robles');
  const access = await me.activateParticipantQuickAccess({ interviewId: interview.id, participantId: participant.id });

  assert.equal(access.available, true, access.unavailableReason);
  assert.equal(access.createdAvatar, true);
  assert.match(access.privateLinkPath, /^\/miesencia\?code=/);
  assert.ok(access.personalCode.length >= 6);
  assert.equal(access.dailyMessageQuota, 30);

  const sub = me.subscriptions.get(access.avatarId);
  assert.equal(sub.planId, 'plan_mensual', 'Plan Comercial Inicial: Mensual');
  assert.equal(sub.dailyMessageQuotaPerInterlocutor, 30, '30 mensajes máximos por día');
  assert.ok(sub.participantQuickAccess?.activatedAt);
  const monthMs = new Date(sub.expiresAt).getTime() - new Date(sub.startsAt).getTime();
  assert.ok(monthMs > 27 * 86400000 && monthMs < 32 * 86400000, 'vigencia de 1 mes');

  const person = me.persons.get(sub.personIds[0]);
  assert.equal(person.spontaneityLevel, 'moderado', 'espontaneidad moderada');
  assert.equal(person.aiConfig.primaryProvider, 'gemini');
  assert.equal(person.aiConfig.geminiModel, 'gemini-3.1-flash-lite');
  assert.equal(person.aiConfig.conversationConfigMode, 'modo_personalizado');
  assert.equal(person.aiConfig.geminiPromptName, 'GPT V6', 'prompt activo GPT V6');
  assert.equal(person.aiConfig.geminiPromptSourceLibraryId, 'lib_prompt_gpt_v6');
  assert.match(person.aiConfig.geminiPromptContent, /PROMPT GPT V6/);

  const cred = me.findGeneralCredential(access.avatarId);
  const interlocutor = me.interlocutors.get(cred.interlocutorId);
  assert.equal(interlocutor.isGeneralAccess, true, 'acceso general: el avatar no sabe quién conversa');
  assert.equal(interlocutor.customDailyMessageLimit, 30);
  const codes = Array.from(me.credentials.values()).filter((c: any) => c.avatarId === access.avatarId);
  assert.equal(codes.length, 1, 'solo el código general');
  assert.equal(me.verifyPersonalAccessCode(access.personalCode).valid, true, 'el código abre Mi Esencia');

  // Opening it again (or reloading the page) returns the same access; nothing is duplicated.
  const again = await me.activateParticipantQuickAccess({ interviewId: interview.id, participantId: participant.id });
  assert.equal(again.personalCode, access.personalCode);
  assert.deepEqual(me.getParticipantQuickAccess(interview.id)?.personalCode, access.personalCode);
});

test('V5.5.0-I2: dos clics simultáneos crean un solo avatar', async () => {
  const { interview, participant } = await createInterviewWithAnswer('Tomás Ruiz');
  const [a, b] = await Promise.all([
    me.activateParticipantQuickAccess({ interviewId: interview.id, participantId: participant.id }),
    me.activateParticipantQuickAccess({ interviewId: interview.id, participantId: participant.id }),
  ]);
  assert.equal(a.avatarId, b.avatarId);
  const subs = Array.from(me.subscriptions.values()).filter((s: any) => s.sourceInterviewId === interview.id);
  assert.equal(subs.length, 1);
});

test('V5.5.0-I3: un avatar que el administrador ya creó se reutiliza sin cambiar su configuración', async () => {
  const { interview, participant } = await createInterviewWithAnswer('Rosa Méndez');
  const admin = await me.createOrSyncAvatarFromInterview({
    interviewId: interview.id,
    planId: 'plan_anual',
    spontaneityLevel: 'alto',
    initialConversationConfigMode: 'modo_existente',
    initialPrimaryProvider: 'openai',
    adminEmail: 'admin@youforever.test',
  });
  const avatarId = admin.subscription.avatarId;
  const personBefore = JSON.stringify(me.persons.get(admin.persons[0].personId).aiConfig);
  const generalCode = admin.credentials[0].personalCodePlain;

  const access = await me.activateParticipantQuickAccess({ interviewId: interview.id, participantId: participant.id });
  assert.equal(access.avatarId, avatarId);
  assert.equal(access.createdAvatar, false);
  assert.equal(access.personalCode, generalCode, 'se comparte su código general existente');
  const sub = me.subscriptions.get(avatarId);
  assert.equal(sub.planId, 'plan_anual');
  assert.equal(me.persons.get(admin.persons[0].personId).spontaneityLevel, 'alto');
  assert.equal(JSON.stringify(me.persons.get(admin.persons[0].personId).aiConfig), personBefore);
});

test('V5.5.0-I4: si el administrador pausó el código, se informa y no se crea otro', async () => {
  const { interview, participant } = await createInterviewWithAnswer('Luis Paredes');
  const first = await me.activateParticipantQuickAccess({ interviewId: interview.id, participantId: participant.id });
  const cred = me.findGeneralCredential(first.avatarId);
  cred.status = 'pausado';
  const access = me.getParticipantQuickAccess(interview.id);
  assert.equal(access.available, false);
  assert.match(access.unavailableReason, /pausado/);
  await me.activateParticipantQuickAccess({ interviewId: interview.id, participantId: participant.id });
  const codes = Array.from(me.credentials.values()).filter((c: any) => c.avatarId === first.avatarId);
  assert.equal(codes.length, 1);
  cred.status = 'activo';
});

test('V5.5.0-I5: envía el enlace y el código por correo, con límite diario contra abusos', async () => {
  const { interview, participant } = await createInterviewWithAnswer('Marta Íñiguez');
  const notActivated = await me.sendParticipantQuickAccessEmail({
    interviewId: interview.id,
    participantId: participant.id,
    participantName: participant.name,
    recipientEmail: 'marta@example.com',
    publicBaseUrl: 'https://youforever.app',
    send: async () => ({ sent: true }),
  });
  assert.equal(notActivated.sent, false, 'antes de activar no se envía nada');

  const access = await me.activateParticipantQuickAccess({ interviewId: interview.id, participantId: participant.id });
  const sentMails: Array<{ to: string; subject: string; html: string }> = [];
  const send = async (content: any, to: string) => {
    sentMails.push({ to, ...content });
    return { sent: true };
  };
  const invalid = await me.sendParticipantQuickAccessEmail({
    interviewId: interview.id,
    participantId: participant.id,
    participantName: participant.name,
    recipientEmail: 'no-es-correo',
    publicBaseUrl: 'https://youforever.app',
    send,
  });
  assert.equal(invalid.sent, false);

  for (let i = 0; i < 5; i++) {
    const r = await me.sendParticipantQuickAccessEmail({
      interviewId: interview.id,
      participantId: participant.id,
      participantName: participant.name,
      recipientEmail: 'marta@example.com',
      publicBaseUrl: 'https://youforever.app/',
      send,
    });
    assert.equal(r.sent, true);
  }
  assert.equal(sentMails[0].to, 'marta@example.com');
  assert.ok(sentMails[0].html.includes(`https://youforever.app/miesencia?code=${encodeURIComponent(access.personalCode)}`));
  assert.ok(sentMails[0].subject.includes(access.personalCode));

  const blocked = await me.sendParticipantQuickAccessEmail({
    interviewId: interview.id,
    participantId: participant.id,
    participantName: participant.name,
    recipientEmail: 'marta@example.com',
    publicBaseUrl: 'https://youforever.app',
    send,
  });
  assert.equal(blocked.sent, false, 'máximo 5 correos por día');
  assert.equal(sentMails.length, 5);
  assert.equal(me.subscriptions.get(access.avatarId).participantQuickAccess.emailDeliveries.length, 5);
});

test('V5.5.0-I6: la tarjeta aparece justo debajo de «Tu Libro Autobiográfico en PDF» y solo con el libro guardado', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'src/components/ParticipantBookStudio.tsx'), 'utf-8');
  const titleIdx = src.indexOf("'Tu Libro Autobiográfico en PDF'");
  const cardIdx = src.indexOf('<MiEsenciaQuickAccessCard');
  const errorIdx = src.indexOf('{studioError && (');
  assert.ok(titleIdx > 0 && cardIdx > titleIdx && cardIdx < errorIdx);
  assert.match(src.slice(cardIdx - 200, cardIdx), /hasSavedVersions && !isEditingLayout/);
});
