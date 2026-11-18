import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDefaultAvatarAiConfig,
  resolvePromptDynamicVariables,
  createIndependentAvatarPromptCopyFromLibrary,
  buildHybridDocumentKnowledgeBlock,
  buildCustomProviderOrchestrationPayload,
  parseImportedPromptsPayload,
  exportLibraryPromptsPayload,
  isRecoverableProviderError,
  type MiEsenciaLibraryPromptRecord,
} from './miEsenciaAiTypesAndRules.ts';
import type {
  MiEsenciaPersonProfile,
  MiEsenciaTestimonyBlock,
  MiEsenciaRelatedPerson,
} from './miEsenciaRules.ts';

const samplePerson: MiEsenciaPersonProfile = {
  personId: 'person_maria_01',
  avatarId: 'avatar_maria_01',
  sourceInterviewId: 'int_01',
  sourcePdfId: 'pdf_maria_01',
  fullName: 'María Elena Morales',
  preferredName: 'María Elena',
  biographySummary: 'Maestra jubilada de Mérida.',
  milestones: ['Maestra por 35 años'],
  linguisticProfile: {
    frequentExpressions: ['qué alegría'],
    affectionateTerms: ['hija'],
    sentenceRhythm: 'calido_conversacional',
    warmthTone: 'cálido',
    keyValues: ['familia'],
    neverSaidTopicsNote: '',
  },
  spontaneityLevel: 'moderado',
  status: 'aprobado',
  version: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

const sampleTestimonies: MiEsenciaTestimonyBlock[] = [
  {
    testimonyId: 'test_1',
    personId: 'person_maria_01',
    avatarId: 'avatar_maria_01',
    sourcePdfId: 'pdf_maria_01',
    lifeStage: 'infancia',
    topic: 'familia',
    questionLiteral: '¿Dónde naciste y cómo se llamaban tus hijos?',
    answerLiteral: 'Nací en Valladolid en 1948 y mi hija mayor se llama Lucía, a quien de cariño le digo Luchita.',
    entitiesMentioned: ['Lucía'],
    keywords: ['valladolid', '1948', 'hija', 'lucia', 'luchita'],
    recordedAt: '2026-11-01T00:00:00.000Z',
    immutable: true,
  },
];

const sampleRelations: MiEsenciaRelatedPerson[] = [
  {
    relatedPersonId: 'rel_1',
    personId: 'person_maria_01',
    avatarId: 'avatar_maria_01',
    mentionedName: 'Lucía',
    relationshipType: 'Hija',
    affectionateNicknames: ['Luchita'],
    sharedMemoriesSummary: 'Mi hija mayor Lucía.',
    sourceTestimonyIds: ['test_1'],
    createdAt: '2026-11-01T00:00:00.000Z',
  },
];

test('PRUEBA 1 & 20: buildDefaultAvatarAiConfig preserva modo_existente por defecto y usa gpt-6-luna como modelo OpenAI por defecto (V5.6.3: "gpt-6" no es un modelo de la API)', () => {
  const cfg = buildDefaultAvatarAiConfig();
  assert.equal(cfg.conversationConfigMode, 'modo_existente');
  assert.equal(cfg.primaryProvider, 'gemini');
  assert.equal(cfg.geminiModel, 'gemini-3.8-flash');
  assert.equal(cfg.openaiModel, 'gpt-6-luna');
  assert.equal(buildDefaultAvatarAiConfig({ defaultOpenAiModel: 'gpt-6' } as any).openaiModel, 'gpt-6-luna');
});

test('PRUEBA 16: resolvePromptDynamicVariables sustituye variables reconocidas sin inventar datos faltantes', () => {
  const template = `Hola, soy {{nombre_entrevistado}} ({{nombre_avatar}}). Platico con {{nombre_interlocutor}}, mi {{parentesco}} ({{apodo}}). Familia: {{contexto_familiar}}. Variable desconocida: {{no_existe}}.`;

  const resolvedWithIdentity = resolvePromptDynamicVariables({
    promptTemplate: template,
    person: samplePerson,
    relations: sampleRelations,
    testimonies: sampleTestimonies,
    confirmedIdentity: {
      declaredName: 'Lucía',
      relationshipToPerson: 'Hija',
      affectionateNickname: 'Luchita',
      documentedSentimentTone: 'orgullo_profundo',
      documentedSentimentDescription: 'Orgullo profundo',
      documentedSharedMemories: [],
      isDocumentedInLegacy: true,
    },
  });

  assert.match(resolvedWithIdentity.resolvedPrompt, /María Elena Morales/);
  assert.match(resolvedWithIdentity.resolvedPrompt, /Platico con Lucía, mi Hija \(Luchita\)/);
  assert.match(resolvedWithIdentity.resolvedPrompt, /Hija: Lucía \(apodo: Luchita\)/);
  assert.match(resolvedWithIdentity.resolvedPrompt, /\{\{no_existe\}\}/);

  // Sin identidad confirmada: no inventa parentescos ni nombres
  const resolvedWithoutIdentity = resolvePromptDynamicVariables({
    promptTemplate: template,
    person: samplePerson,
    relations: sampleRelations,
    testimonies: sampleTestimonies,
  });
  assert.match(
    resolvedWithoutIdentity.resolvedPrompt,
    /Interlocutor aún no identificado por nombre propio/
  );
  assert.match(resolvedWithoutIdentity.resolvedPrompt, /Parentesco aún no confirmado/);
});

test('PRUEBA 12: createIndependentAvatarPromptCopyFromLibrary crea una copia independiente no vinculada a mutaciones posteriores', () => {
  const libraryPrompt: MiEsenciaLibraryPromptRecord = {
    promptId: 'lib_calido_1',
    name: 'Conversación familiar cálida',
    category: 'Conversación familiar',
    compatibleProvider: 'ambos',
    content: 'Instrucción original de la biblioteca v1.',
    version: 1,
    status: 'disponible',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    updatedBy: 'admin@test.com',
    versionHistory: [],
  };

  const baseConfig = buildDefaultAvatarAiConfig({ mode: 'modo_personalizado' });
  const { updatedAiConfig } = createIndependentAvatarPromptCopyFromLibrary({
    libraryPrompt,
    targetProvider: 'gemini',
    currentAiConfig: baseConfig,
    adminEmail: 'admin@test.com',
  });

  // Modificar posteriormente el prompt original de la biblioteca
  libraryPrompt.content = 'Instrucción MODIFICADA en la biblioteca v2.';
  libraryPrompt.version = 2;

  // La copia del avatar permanece intacta
  assert.equal(updatedAiConfig.geminiPromptContent, 'Instrucción original de la biblioteca v1.');
  assert.equal(updatedAiConfig.geminiPromptSourceLibraryId, 'lib_calido_1');
});

test('PRUEBA 6, 7 & 14 (Motor Híbrido): Envía el PDF completo por defecto (Modalidad A) y soporta Modalidad B (RAG) cuando excede el umbral explícito, con aislamiento estricto entre entrevistados', () => {
  // Otro entrevistado cuyo testimonio NO debe filtrarse a María Elena
  const otherPersonTestimony: MiEsenciaTestimonyBlock = {
    testimonyId: 'test_other_99',
    personId: 'person_otro_99',
    avatarId: 'avatar_otro_99',
    sourcePdfId: 'pdf_otro_99',
    lifeStage: 'adultez',
    topic: 'secreto_otro',
    questionLiteral: '¿Cuál era tu barco?',
    answerLiteral: 'Mi barco se llamaba Estrella del Norte en Mazatlán.',
    entitiesMentioned: [],
    keywords: ['barco', 'estrella', 'mazatlan'],
    recordedAt: '2026-11-01T00:00:00.000Z',
    immutable: true,
  };

  const modeAResult = buildHybridDocumentKnowledgeBlock({
    person: samplePerson,
    personTestimonies: [...sampleTestimonies, otherPersonTestimony],
    personRelations: sampleRelations,
    sharedMemoriesLevelB: [],
    privateMemoriesLevelC: [],
    userQuery: '¿Dónde naciste?',
  });

  assert.equal(modeAResult.retrievalMode, 'modalidad_a_documento_completo');
  assert.equal(modeAResult.totalDocumentBlocksCount, 1);
  assert.match(modeAResult.documentKnowledgeText, /Valladolid en 1948/);
  assert.doesNotMatch(modeAResult.documentKnowledgeText, /Estrella del Norte/);

  // Simular entrevista completa de 42 preguntas y respuestas: por defecto se envía el PDF COMPLETO (Modalidad A)
  const manyBlocks: MiEsenciaTestimonyBlock[] = Array.from({ length: 42 }, (_, idx) => ({
    testimonyId: `test_bulk_${idx}`,
    personId: 'person_maria_01',
    avatarId: 'avatar_maria_01',
    sourcePdfId: 'pdf_maria_01',
    lifeStage: 'adultez',
    topic: `tema_${idx}`,
    questionLiteral: `Pregunta número ${idx}`,
    answerLiteral:
      idx === 25
        ? 'En 1979 gané el premio estatal de docencia en Mérida por mi taller de lectura.'
        : `Respuesta biográfica general del bloque número ${idx}.`,
    entitiesMentioned: [],
    keywords: idx === 25 ? ['1979', 'premio', 'estatal', 'docencia', 'merida'] : ['bloque'],
    recordedAt: '2026-11-01T00:00:00.000Z',
    immutable: true,
  }));

  const fullInterviewDefaultResult = buildHybridDocumentKnowledgeBlock({
    person: samplePerson,
    personTestimonies: manyBlocks,
    personRelations: sampleRelations,
    sharedMemoriesLevelB: [],
    privateMemoriesLevelC: [],
    userQuery: '¿Qué premio de docencia ganaste en 1979?',
  });
  assert.equal(fullInterviewDefaultResult.retrievalMode, 'modalidad_a_documento_completo');
  assert.equal(fullInterviewDefaultResult.totalDocumentBlocksCount, 42);
  assert.match(fullInterviewDefaultResult.documentKnowledgeText, /premio estatal de docencia en Mérida/);

  // Cuando se fuerza un umbral reducido (ej. maxFullDocumentBlocks: 35), activa Modalidad B (RAG)
  const modeBResult = buildHybridDocumentKnowledgeBlock({
    person: samplePerson,
    personTestimonies: manyBlocks,
    personRelations: sampleRelations,
    sharedMemoriesLevelB: [],
    privateMemoriesLevelC: [],
    userQuery: '¿Qué premio de docencia ganaste en 1979?',
    maxFullDocumentBlocks: 35,
  });

  assert.equal(modeBResult.retrievalMode, 'modalidad_b_fragmentos_rag');
  assert.match(modeBResult.documentKnowledgeText, /premio estatal de docencia en Mérida/);
});

test('PRUEBA 4, 17.2 & Continuidad Multi-Día: buildCustomProviderOrchestrationPayload envía historial multi-turno completo y resumen persistente al reabrir días después', () => {
  const customFormalPrompt =
    'INSTRUCCIÓN EXCLUSIVA DEL ADMINISTRADOR: Responde siempre en tono formal académico y comienza con "Estimado interlocutor:".';

  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const payload = buildCustomProviderOrchestrationPayload({
    adminPromptTemplate: customFormalPrompt,
    person: samplePerson,
    personTestimonies: sampleTestimonies,
    personRelations: sampleRelations,
    sharedMemoriesLevelB: [],
    privateMemoriesLevelC: [],
    recentMessages: [
      { sender: 'interlocutor', content: 'Hola mamá, soy Lucía.', timestamp: fiveDaysAgo },
      { sender: 'avatar', content: 'Hola mi Luchita querida, qué gusto saludarte.', timestamp: fiveDaysAgo },
    ],
    userMessage: '¿Recuerdas de qué estábamos platicando hace unos días?',
    sessionStartedAt: fiveDaysAgo,
    previousLastMessageAt: fiveDaysAgo,
  });

  assert.match(payload.systemInstructionsBlock, /Estimado interlocutor:/);
  assert.match(payload.systemInstructionsBlock, /Valladolid en 1948/);
  assert.equal(
    payload.userContextAndMessageBlock,
    '¿Recuerdas de qué estábamos platicando hace unos días?'
  );
  assert.match(payload.sessionContextSummary, /REAPERTURA DE CONVERSACIÓN TRAS 5 DÍA\(S\)/);
  assert.equal(payload.structuredTurns.length, 2);
  assert.equal(payload.structuredTurns[0].role, 'user');
  assert.equal(payload.structuredTurns[1].role, 'assistant');
});

test('PRUEBA 14 & 15: Importación y exportación de prompts en TXT, Markdown y JSON sin exponer datos privados', () => {
  const rawTxt = 'Línea 1 del prompt\n\n- Punto A\n- Punto B con {{nombre_entrevistado}}';
  const importedTxt = parseImportedPromptsPayload({
    rawContent: rawTxt,
    format: 'txt',
    defaultName: 'Mi Prompt TXT',
    defaultCategory: 'Personalidad cálida',
    defaultCompatibleProvider: 'gemini',
  });
  assert.equal(importedTxt.length, 1);
  assert.equal(importedTxt[0].content, rawTxt);
  assert.equal(importedTxt[0].compatibleProvider, 'gemini');

  const exportedJson = exportLibraryPromptsPayload({
    prompts: [
      {
        promptId: 'p_1',
        name: 'Mi Prompt TXT',
        category: 'Personalidad cálida',
        compatibleProvider: 'gemini',
        content: rawTxt,
        version: 1,
        status: 'disponible',
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
        updatedBy: 'admin',
        versionHistory: [],
      },
    ],
    format: 'json',
  });

  assert.doesNotMatch(exportedJson.content, /API_KEY|sk-|AIza/);
  const reImported = parseImportedPromptsPayload({
    rawContent: exportedJson.content,
    format: 'json',
  });
  assert.equal(reImported[0].content, rawTxt);
});

test('PRUEBA 9 & 20: isRecoverableProviderError redacta claves API y distingue fallos técnicos de rechazos de seguridad', () => {
  const techErr = isRecoverableProviderError(
    new Error('503 Service Unavailable with key sk-proj-1234567890abcdef123456')
  );
  assert.equal(techErr.recoverable, true);
  assert.doesNotMatch(techErr.sanitizedReason, /sk-proj-1234567890abcdef123456/);
  assert.match(techErr.sanitizedReason, /\[REDACTED_KEY\]/);

  const safetyErr = isRecoverableProviderError(new Error('CONTENT_POLICY_VIOLATION: blocked'));
  assert.equal(safetyErr.recoverable, false);
});
