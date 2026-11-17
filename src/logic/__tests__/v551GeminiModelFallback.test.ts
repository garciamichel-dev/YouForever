/**
 * V5.5.1 — Mi Esencia: gemini-3.8-flash by default, transparent switch to a backup model when it
 * fails, and EVERY message starts again from the original model.
 *
 * The Gemini call is replaced by a controllable double (no network, no API key).
 */
import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ISOLATED_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'yf_v551_gemini_'));
process.chdir(ISOLATED_ROOT);
process.env.GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error('Red deshabilitada en las pruebas.');
}) as typeof fetch;

let orch: any;
let rules: any;
let aiRules: any;
let quick: any;

/** Models that fail right now, and every model called (in order). */
const failing = new Map<string, string>();
const calls: string[] = [];

before(async () => {
  orch = await import(path.join(REPO_ROOT, 'src/server/miEsencia/miEsenciaAiOrchestrator.ts'));
  rules = await import(path.join(REPO_ROOT, 'src/logic/miEsenciaRules.ts'));
  aiRules = await import(path.join(REPO_ROOT, 'src/logic/miEsenciaAiTypesAndRules.ts'));
  quick = await import(path.join(REPO_ROOT, 'src/logic/miEsenciaQuickAccess.ts'));
  orch.__setGeminiGenerateForTests(async (req: { model: string }) => {
    calls.push(req.model);
    const err = failing.get(req.model);
    if (err) throw new Error(err);
    return { text: `Respuesta de ${req.model}`, usageMetadata: { totalTokenCount: 10 } };
  });
});

afterEach(() => {
  failing.clear();
  calls.length = 0;
});

after(() => {
  orch.__setGeminiGenerateForTests(null);
  globalThis.fetch = originalFetch;
});

function turn(userMessage: string) {
  const aiConfig = aiRules.buildDefaultAvatarAiConfig({
    mode: 'modo_personalizado',
    defaultGeminiModel: quick.MI_ESENCIA_QUICK_ACCESS_DEFAULTS.geminiModel,
    primaryProvider: 'gemini',
    geminiPromptContent: 'Eres {{nombre}}. Conversa con calidez. [GPT V6]',
    geminiPromptName: 'GPT V6',
  });
  const person = {
    personId: 'per_1',
    avatarId: 'av_1',
    fullName: 'Elena Robles',
    preferredName: 'Elena',
    biographySummary: '',
    milestones: [],
    linguisticProfile: {},
    spontaneityLevel: 'moderado',
    status: 'aprobado',
    version: 1,
    aiConfig,
  };
  return orch.executeCustomAvatarTurnWithFallback({
    person,
    aiConfig,
    personTestimonies: [],
    personRelations: [],
    sharedMemoriesLevelB: [],
    privateMemoriesLevelC: [],
    recentMessages: [],
    userMessage,
  });
}

test('V5.5.1-U1: gemini-3.8-flash es el modelo por defecto y ya no se reemplaza por otro', () => {
  assert.equal(orch.MI_ESENCIA_DEFAULT_GEMINI_MODEL, 'gemini-3.8-flash');
  assert.equal(quick.MI_ESENCIA_QUICK_ACCESS_DEFAULTS.geminiModel, 'gemini-3.8-flash');
  assert.equal(rules.DEFAULT_MI_ESENCIA_CONFIG.defaultGeminiModel, 'gemini-3.8-flash');
  assert.equal(aiRules.buildDefaultAvatarAiConfig({}).geminiModel, 'gemini-3.8-flash');
  assert.equal(orch.normalizeMiEsenciaGeminiModel('gemini-3.8-flash'), 'gemini-3.8-flash');
  assert.deepEqual(orch.buildMiEsenciaGeminiModelChain(undefined), [
    'gemini-3.8-flash',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite-preview',
  ]);
  assert.deepEqual(orch.buildMiEsenciaGeminiModelChain('gemini-3-flash-preview'), [
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite-preview',
  ]);
  const listed = aiRules.AVAILABLE_GEMINI_MODELS.find((m: any) => m.recommended);
  assert.equal(listed.id, 'gemini-3.8-flash');
});

test('V5.5.1-I1: si 3.8 Flash falla, responde el respaldo sin que el visitante lo note; el siguiente mensaje vuelve a 3.8 Flash', async () => {
  failing.set('gemini-3.8-flash', '503 UNAVAILABLE: The model is overloaded.');
  const first = await turn('¿Cómo era tu casa?');
  assert.deepEqual(calls, ['gemini-3.8-flash', 'gemini-3-flash-preview']);
  assert.equal(first.replyText, 'Respuesta de gemini-3-flash-preview', 'el visitante solo ve la respuesta');
  assert.doesNotMatch(first.replyText, /AVISO|respaldo|modelo/i);
  assert.equal(first.modelUsed, 'gemini-3-flash-preview');
  assert.equal(first.fallbackTriggered, true);
  assert.match(first.adminFallbackNotice, /gemini-3\.8-flash.*no respondió.*gemini-3-flash-preview.*siguiente mensaje/);
  assert.equal(first.fallbackLog.primaryModel, 'gemini-3.8-flash');
  assert.equal(first.fallbackLog.fallbackModelUsed, 'gemini-3-flash-preview');

  // 3.8 Flash recovers: the very next message uses it again (nothing is remembered).
  failing.clear();
  calls.length = 0;
  const second = await turn('¿Y tu escuela?');
  assert.deepEqual(calls, ['gemini-3.8-flash']);
  assert.equal(second.modelUsed, 'gemini-3.8-flash');
  assert.equal(second.fallbackTriggered, false);
  assert.equal(second.adminFallbackNotice, undefined);
});

test('V5.5.1-I2: aunque 3.8 Flash siga fallando, cada mensaje lo vuelve a intentar primero', async () => {
  failing.set('gemini-3.8-flash', 'Tiempo de espera agotado en Gemini (gemini-3.8-flash).');
  for (const msg of ['Hola', '¿Qué tal?', '¿Me cuentas algo?']) {
    calls.length = 0;
    const r = await turn(msg);
    assert.equal(calls[0], 'gemini-3.8-flash', `«${msg}» empieza por el modelo original`);
    assert.equal(r.modelUsed, 'gemini-3-flash-preview');
  }
});

test('V5.5.1-I3: cuota agotada de 3.8 Flash pasa al siguiente modelo de Gemini; si fallan dos, responde el tercero', async () => {
  failing.set('gemini-3.8-flash', '429 RESOURCE_EXHAUSTED: quota exceeded for gemini-3.8-flash');
  failing.set('gemini-3-flash-preview', '500 INTERNAL');
  const r = await turn('Hola');
  assert.deepEqual(calls, ['gemini-3.8-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview']);
  assert.equal(r.modelUsed, 'gemini-3.1-flash-lite-preview');
  assert.equal(r.replyText, 'Respuesta de gemini-3.1-flash-lite-preview');
  assert.match(r.adminFallbackNotice, /RESOURCE_EXHAUSTED/);
});

test('V5.5.1-I4: una clave inválida no recorre los demás modelos de Gemini y el visitante igual recibe respuesta', async () => {
  failing.set('gemini-3.8-flash', '403 PERMISSION_DENIED: API key not valid');
  const r = await turn('Hola');
  assert.deepEqual(calls, ['gemini-3.8-flash']);
  assert.ok(r.replyText.trim().length > 0, 'respuesta de contingencia basada en el testimonio');
  assert.doesNotMatch(r.replyText, /PERMISSION_DENIED|AVISO/);
});

test('V5.5.1-I5: la configuración guardada con el predeterminado anterior pasa a 3.8 Flash una sola vez', async () => {
  const { miEsenciaStore } = await import(path.join(REPO_ROOT, 'src/server/miEsencia/miEsenciaStore.ts'));
  const migrate = (cfg: any) => (miEsenciaStore as any).migrateConfigDefaults(cfg);
  assert.equal(migrate({ defaultGeminiModel: 'gemini-3-flash-preview' }).defaultGeminiModel, 'gemini-3.8-flash');
  assert.equal(migrate({}).defaultGeminiModel, 'gemini-3.8-flash');
  assert.equal(migrate({ defaultGeminiModel: 'gemini-flash-latest' }).defaultGeminiModel, 'gemini-flash-latest');
  // After the one-time move, an explicit choice of the administrator is respected.
  const chosen = migrate({ defaultGeminiModel: 'gemini-3-flash-preview', geminiDefaultModelV551Applied: true });
  assert.equal(chosen.defaultGeminiModel, 'gemini-3-flash-preview');
});
