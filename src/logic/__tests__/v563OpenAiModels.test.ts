/**
 * V5.6.3 — The GPT-6 family is used for real.
 *
 * Before V5.6.3 the server removed gpt-6-luna (and the rest of GPT-6) from the account's model
 * list with a hard-coded block list, reported "NO existe en la API de OpenAI de tu cuenta" and
 * fell back to Gemini; Mi Esencia silently answered with another model and showed it as success.
 *
 * The OpenAI API is simulated with a local fetch stub: no real network, no real keys.
 */
import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

process.env.OPENAI_API_KEY = 'sk-test-simulado-v563';
process.env.GEMINI_API_KEY = '';

/** What the simulated OpenAI account offers and how it answers. */
const fakeOpenAi = {
  models: [] as string[],
  answerModel: (requested: string) => requested,
  calls: [] as Array<{ path: string; model?: string; body?: any }>,
};

const originalFetch = globalThis.fetch;
const otherNetworkCalls: string[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url || input);
  if (!url.startsWith('https://api.openai.com/')) {
    otherNetworkCalls.push(url);
    throw new Error('Red deshabilitada en las pruebas.');
  }
  const { pathname } = new URL(url);
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  fakeOpenAi.calls.push({ path: pathname, model: body?.model, body });

  if (pathname === '/v1/models') {
    return jsonResponse({ object: 'list', data: fakeOpenAi.models.map((id) => ({ id, object: 'model', owned_by: 'openai' })) });
  }
  const model = String(body?.model || '');
  if (!fakeOpenAi.models.includes(model)) {
    return jsonResponse({ error: { message: `The model \`${model}\` does not exist or you do not have access to it.`, type: 'invalid_request_error', code: 'model_not_found' } }, 404);
  }
  const answered = fakeOpenAi.answerModel(model);
  if (pathname === '/v1/chat/completions') {
    return jsonResponse({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1,
      model: answered,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Conexión recibida, lista para redactar memorias.' } }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    });
  }
  if (pathname === '/v1/responses') {
    return jsonResponse({
      id: 'resp-test',
      object: 'response',
      created_at: 1,
      status: 'completed',
      model: answered,
      output: [{ type: 'message', id: 'msg-1', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'Conexión activa con OpenAI.', annotations: [] }] }],
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
    });
  }
  return jsonResponse({ error: { message: 'ruta no simulada' } }, 400);
}) as typeof fetch;

let ids: any;
let engine: any;
let orchestrator: any;

before(async () => {
  ids = await import(path.join(REPO_ROOT, 'src/logic/openAiModelIds.ts'));
  engine = await import(path.join(REPO_ROOT, 'src/server/geminiService.ts'));
  orchestrator = await import(path.join(REPO_ROOT, 'src/server/miEsencia/miEsenciaAiOrchestrator.ts'));
});

beforeEach(() => {
  fakeOpenAi.calls = [];
  fakeOpenAi.answerModel = (requested) => requested;
});

after(() => {
  globalThis.fetch = originalFetch;
  assert.deepEqual(otherNetworkCalls, [], 'Ninguna prueba puede llamar a servicios reales.');
});

const ACCOUNT_WITH_GPT6 = ['gpt-4o', 'gpt-5.6-luna', 'gpt-6-astra', 'gpt-6-luna', 'gpt-6.1-sol'];

test('"gpt-6" (nombre de familia) se convierte en gpt-6-luna; los identificadores reales no cambian', () => {
  assert.equal(ids.OPENAI_DEFAULT_MODEL, 'gpt-6-luna');
  assert.equal(ids.normalizeOpenAiModelId('gpt-6'), 'gpt-6-luna');
  assert.equal(ids.normalizeOpenAiModelId(' GPT-6 '), 'gpt-6-luna');
  assert.equal(ids.normalizeOpenAiModelId(''), 'gpt-6-luna');
  assert.equal(ids.normalizeOpenAiModelId(undefined), 'gpt-6-luna');
  for (const real of ['gpt-6-luna', 'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-sol', 'gpt-4o']) {
    assert.equal(ids.normalizeOpenAiModelId(real), real);
  }
});

test('solo un rechazo real de OpenAI (403/404/model_not_found) bloquea un modelo, no un "403" dentro de otro error', () => {
  assert.equal(ids.isOpenAiModelAccessError({ status: 404 }), true);
  assert.equal(ids.isOpenAiModelAccessError({ status: 403 }), true);
  assert.equal(ids.isOpenAiModelAccessError({ code: 'model_not_found' }), true);
  assert.equal(ids.isOpenAiModelAccessError(new Error('The model `gpt-x` does not exist or you do not have access to it.')), true);
  assert.equal(ids.isOpenAiModelAccessError({ status: 500, message: 'upstream returned 403 from proxy' }), false);
  assert.equal(ids.isOpenAiModelAccessError({ status: 429, message: 'Rate limit, retry in 404 ms' }), false);
  assert.equal(ids.isOpenAiModelAccessError(new Error('timeout')), false);
});

test('motor de libros: la familia GPT-6 ya no se excluye de los candidatos', () => {
  assert.equal(engine.resolveOpenAiCandidateModels('gpt-6-luna', ACCOUNT_WITH_GPT6)[0], 'gpt-6-luna');
  assert.equal(engine.resolveOpenAiCandidateModels('gpt-6', ACCOUNT_WITH_GPT6)[0], 'gpt-6-luna');
  assert.equal(engine.resolveOpenAiCandidateModels('gpt-6-astra', ACCOUNT_WITH_GPT6)[0], 'gpt-6-astra');
  // If the requested model is not in the account, the first replacement is gpt-6-luna.
  assert.equal(engine.resolveOpenAiCandidateModels('gpt-6.1-terra', ACCOUNT_WITH_GPT6)[0], 'gpt-6-luna');
});

test('prueba del motor de libros: gpt-6-luna listado en la cuenta → conexión real y exitosa (ya no "NO existe")', async () => {
  fakeOpenAi.models = ACCOUNT_WITH_GPT6;
  const result = await engine.testConfiguredBookAiEngines({ primaryProvider: 'openai', geminiModel: 'gemini-3-flash-preview', openaiModel: 'gpt-6-luna' });
  assert.equal(result.openai.ok, true, result.openai.diagnosticMessage);
  assert.equal(result.openai.isConfiguredModelAvailable, true);
  assert.match(result.openai.diagnosticMessage, /^Conexión exitosa con gpt-6-luna/);
  assert.doesNotMatch(result.openai.diagnosticMessage, /NO existe/);
  assert.ok(result.openai.availableModels.includes('gpt-6-luna'), 'gpt-6-luna aparece en la lista de modelos');
  const call = fakeOpenAi.calls.find((c) => c.path === '/v1/chat/completions');
  assert.equal(call?.model, 'gpt-6-luna', 'la solicitud real se hizo con gpt-6-luna');
  assert.ok(call?.body?.max_completion_tokens >= 2000, 'presupuesto suficiente para un modelo de razonamiento');
});

test('prueba del motor de libros: una configuración guardada como "gpt-6" usa gpt-6-luna', async () => {
  fakeOpenAi.models = ACCOUNT_WITH_GPT6;
  const result = await engine.testConfiguredBookAiEngines({ primaryProvider: 'openai', geminiModel: 'gemini-3-flash-preview', openaiModel: 'gpt-6' });
  assert.equal(result.openai.configuredModel, 'gpt-6-luna');
  assert.equal(result.openai.ok, true);
});

test('prueba del motor de libros: una versión fechada del mismo modelo cuenta como el mismo modelo', async () => {
  fakeOpenAi.models = ACCOUNT_WITH_GPT6;
  fakeOpenAi.answerModel = () => 'gpt-6-luna-2026-09-22';
  const result = await engine.testConfiguredBookAiEngines({ primaryProvider: 'openai', geminiModel: 'gemini-3-flash-preview', openaiModel: 'gpt-6-luna' });
  assert.match(result.openai.diagnosticMessage, /^Conexión exitosa con gpt-6-luna/);
});

test('prueba del motor de libros: si responde OTRO modelo, el aviso lo dice en lugar de "Conexión exitosa"', async () => {
  fakeOpenAi.models = ACCOUNT_WITH_GPT6;
  fakeOpenAi.answerModel = () => 'gpt-5.6-luna';
  const result = await engine.testConfiguredBookAiEngines({ primaryProvider: 'openai', geminiModel: 'gemini-3-flash-preview', openaiModel: 'gpt-6-luna' });
  assert.match(result.openai.diagnosticMessage, /gpt-5\.6-luna.*en lugar de.*gpt-6-luna/);
  assert.doesNotMatch(result.openai.diagnosticMessage, /^Conexión exitosa/);
});

test('Mi Esencia: gpt-6-luna se usa de verdad (antes se cambiaba en silencio por otro modelo)', async () => {
  fakeOpenAi.models = ACCOUNT_WITH_GPT6;
  const result = await orchestrator.testLiveProviderConnection({ provider: 'openai', model: 'gpt-6-luna' });
  assert.equal(result.connected, true, result.errorDetail);
  assert.equal(result.respondedModel, 'gpt-6-luna');
  assert.equal(result.modelSubstituted, false);
  const call = fakeOpenAi.calls.find((c) => c.path === '/v1/responses' || c.path === '/v1/chat/completions');
  assert.equal(call?.model, 'gpt-6-luna');
});

test('Mi Esencia: "gpt-6" guardado se atiende con gpt-6-luna', async () => {
  fakeOpenAi.models = ACCOUNT_WITH_GPT6;
  const result = await orchestrator.testLiveProviderConnection({ provider: 'openai', model: 'gpt-6' });
  assert.equal(result.requestedModel, 'gpt-6-luna');
  assert.equal(result.respondedModel, 'gpt-6-luna');
  assert.equal(result.modelSubstituted, false);
});

test('Mi Esencia: si la cuenta no tiene el modelo, la prueba avisa la sustitución (ya no lo muestra como éxito simple)', async () => {
  // The account (cached list) has no gpt-6.1-terra: the first replacement is gpt-6-luna.
  fakeOpenAi.models = ACCOUNT_WITH_GPT6;
  const result = await orchestrator.testLiveProviderConnection({ provider: 'openai', model: 'gpt-6.1-terra' });
  assert.equal(result.connected, true);
  assert.equal(result.modelSubstituted, true);
  assert.equal(result.respondedModel, 'gpt-6-luna');
  assert.match(result.diagnosticAdvice, /gpt-6\.1-terra/);
});

test('listas de modelos del panel: solo identificadores reales de la API (sin "gpt-6" a secas)', async () => {
  const miEsencia = await import(path.join(REPO_ROOT, 'src/logic/miEsenciaAiTypesAndRules.ts'));
  const idsInList = miEsencia.AVAILABLE_OPENAI_MODELS.map((m: any) => m.id);
  assert.ok(!idsInList.includes('gpt-6'));
  for (const real of ['gpt-6-luna', 'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6.1-terra']) {
    assert.ok(idsInList.includes(real), `falta ${real}`);
  }
  assert.equal(miEsencia.AVAILABLE_OPENAI_MODELS.find((m: any) => m.recommended)?.id, 'gpt-6-luna');
});
