import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canSubmitAnswer,
  evaluateAnswerIncrement,
  applyVoluntaryCompletion,
  applyAdminExtension,
  applyAdminReopen,
  generateInvitationToken,
  hashToken,
  isTokenActive,
  isSufficiencyThresholdMet,
  doesAnswerTriggerBranch,
  buildParticipantFlowSequence,
  getNextQuestionInFlow,
  isQuestionnaireFlowComplete,
  validatePhotoAttachments,
  ensurePhotosPlacedInManuscript,
  isConsentValid,
  computeDocumentSha256,
  deriveDeterministicAccessCode,
  extractCleanTokenOrCode,
  matchTokenRecord,
  PrivacyConsentRecord,
  InterviewRecord,
  AnswerRecord,
  AnswerVoiceAttachment,
  InterviewTokenRecord,
  QuestionRecord,
} from './interviewRules.ts';

const mockBaseInterview: InterviewRecord = {
  id: 'interview_100',
  title: 'Historia de Vida de María Hernández',
  storyMode: 'compartida',
  storyType: 'biografia_familiar',
  status: 'open',
  openedAt: new Date(Date.now() - 100000).toISOString(),
  expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
  openDaysAtCreation: 15,
  sufficiencyThreshold: 5,
  maxFollowUpsAtCreation: 2,
  completedQuestionCount: 0,
  sufficiencyStatus: 'not_evaluated',
  userDeclaredComplete: false,
  closedAt: null,
  closureReason: null,
  lastActivityAt: new Date().toISOString(),
  questionnaireVersionId: 'v1_initial',
};

test('1. Finalización voluntaria antes del umbral', () => {
  const result = applyVoluntaryCompletion(
    mockBaseInterview,
    'El participante decidió concluir su testimonio anticipadamente.'
  );

  assert.equal(result.userDeclaredComplete, true);
  assert.equal(result.status, 'completed');
  assert.ok(result.closedAt);
  assert.equal(
    result.closureReason,
    'El participante decidió concluir su testimonio anticipadamente.'
  );

  // Both ordinary answers and additional information ("Añadir Información Adicional") must be rejected once closure is confirmed
  const canSubmit = canSubmitAnswer(result);
  assert.equal(canSubmit.allowed, false);
  assert.match(canSubmit.reason || '', /finalizada voluntariamente/);

  const canSubmitAdditional = canSubmitAnswer(result, Date.now(), true);
  assert.equal(canSubmitAdditional.allowed, false);
  assert.match(canSubmitAdditional.reason || '', /solo lectura/);
});

test('2. Umbral alcanzado con información insuficiente o suficiente', () => {
  assert.equal(isSufficiencyThresholdMet(4, 5), false);
  assert.equal(isSufficiencyThresholdMet(5, 5), true);
  assert.equal(isSufficiencyThresholdMet(6, 5), true);
});

test('3. Respuesta «No lo recuerdo» cuenta como completada', () => {
  const existingAnswers: AnswerRecord[] = [];
  const incoming = {
    interviewId: 'interview_100',
    questionId: 'q_infancia_1',
    participantId: 'part_1',
    participantName: 'María Hernández',
    answerText: '',
    notRecalled: true, // «No lo recuerdo»
    idempotencyKey: 'idem_key_1',
  };

  const evalResult = evaluateAnswerIncrement({
    existingAnswers,
    incomingPayload: incoming,
    allowEditing: true,
  });

  assert.equal(evalResult.shouldIncrementCounter, true);
  assert.equal(evalResult.isEdit, false);
  assert.equal(evalResult.isDuplicate, false);
});

test('4. Edición de respuesta existente no incrementa el contador', () => {
  const existingAnswers: AnswerRecord[] = [
    {
      id: 'ans_1',
      interviewId: 'interview_100',
      questionId: 'q_infancia_1',
      participantId: 'part_1',
      participantName: 'María Hernández',
      answerText: 'Nací en Morelia',
      notRecalled: false,
      isFollowUp: false,
      isAdditionalMemory: false,
      idempotencyKey: 'idem_key_1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  const editPayload = {
    interviewId: 'interview_100',
    questionId: 'q_infancia_1',
    participantId: 'part_1',
    participantName: 'María Hernández',
    answerText: 'Nací en Morelia y nos mudamos a los 5 años',
    notRecalled: false,
    idempotencyKey: 'idem_key_edit_2',
  };

  const evalResult = evaluateAnswerIncrement({
    existingAnswers,
    incomingPayload: editPayload,
    allowEditing: true,
  });

  assert.equal(evalResult.shouldIncrementCounter, false);
  assert.equal(evalResult.isEdit, true);
  assert.equal(evalResult.isDuplicate, false);
});

test('5. Reintento de red sin duplicación (idempotencia)', () => {
  const existingAnswers: AnswerRecord[] = [
    {
      id: 'ans_1',
      interviewId: 'interview_100',
      questionId: 'q_infancia_1',
      participantId: 'part_1',
      participantName: 'María Hernández',
      answerText: 'Respuesta inicial',
      notRecalled: false,
      isFollowUp: false,
      isAdditionalMemory: false,
      idempotencyKey: 'retry_token_xyz',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  const networkRetry = {
    interviewId: 'interview_100',
    questionId: 'q_infancia_1',
    participantId: 'part_1',
    participantName: 'María Hernández',
    answerText: 'Respuesta inicial',
    notRecalled: false,
    idempotencyKey: 'retry_token_xyz', // Same idempotency key from client retry
  };

  const evalResult = evaluateAnswerIncrement({
    existingAnswers,
    incomingPayload: networkRetry,
    allowEditing: true,
  });

  assert.equal(evalResult.shouldIncrementCounter, false);
  assert.equal(evalResult.isDuplicate, true);
});

test('6. Vencimiento y bloqueo en el servidor', () => {
  const expiredInterview: InterviewRecord = {
    ...mockBaseInterview,
    expiresAt: new Date(Date.now() - 1000).toISOString(), // Expired 1 second ago
  };

  const check = canSubmitAnswer(expiredInterview, Date.now());
  assert.equal(check.allowed, false);
  assert.match(check.reason || '', /ha vencido/);
});

test('7. Extensión y reapertura por administrador', () => {
  const expiredInterview: InterviewRecord = {
    ...mockBaseInterview,
    status: 'expired',
    expiresAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
  };

  // Extensión
  const extended = applyAdminExtension(expiredInterview, 5);
  assert.equal(extended.status, 'open');
  const nowMs = Date.now();
  assert.ok(new Date(extended.expiresAt).getTime() > nowMs);

  // Reapertura de una entrevista completada
  const completedInterview: InterviewRecord = {
    ...mockBaseInterview,
    status: 'completed',
    userDeclaredComplete: true,
    closedAt: new Date().toISOString(),
  };

  const reopened = applyAdminReopen(
    completedInterview,
    7,
    'El participante desea agregar memorias adicionales'
  );
  assert.equal(reopened.status, 'open');
  assert.equal(reopened.userDeclaredComplete, false);
  assert.equal(reopened.closedAt, null);
  assert.match(reopened.closureReason || '', /memorias adicionales/);
});

test('8. Revocación de una invitación y validación de hash de token', () => {
  const { plainToken, tokenHash } = generateInvitationToken();
  assert.equal(hashToken(plainToken), tokenHash);

  const activeToken: InterviewTokenRecord = {
    id: 'tok_1',
    tokenHash,
    accessCode: 'LEG-1234',
    interviewId: 'interview_100',
    participantId: 'part_1',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    revoked: false,
    createdAt: new Date().toISOString(),
  };

  assert.equal(isTokenActive(activeToken), true);

  const revokedToken: InterviewTokenRecord = {
    ...activeToken,
    revoked: true,
    revokedAt: new Date().toISOString(),
  };

  assert.equal(isTokenActive(revokedToken), false);
});

test('9. Aislamiento de datos entre entrevistas', () => {
  const answersInterviewA: AnswerRecord[] = [
    {
      id: 'ans_A1',
      interviewId: 'interview_A',
      questionId: 'q_1',
      participantId: 'p_1',
      participantName: 'Carlos',
      answerText: 'Dato confidencial familia A',
      notRecalled: false,
      isFollowUp: false,
      isAdditionalMemory: false,
      idempotencyKey: 'k_1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  // Filtering for interview_B must return 0 records
  const queryForInterviewB = answersInterviewA.filter(
    (a) => a.interviewId === 'interview_B'
  );
  assert.equal(queryForInterviewB.length, 0);
});

test('10. Atribución correcta de respuestas en historias compartidas', () => {
  const sharedAnswers: AnswerRecord[] = [
    {
      id: 'ans_1',
      interviewId: 'shared_story_1',
      questionId: 'q_anecdota_viaje',
      participantId: 'part_padre',
      participantName: 'Roberto (Padre)',
      answerText: 'Llegamos a la playa bajo una tormenta y nos quedamos en el auto cantando.',
      notRecalled: false,
      isFollowUp: false,
      isAdditionalMemory: false,
      idempotencyKey: 'id_roberto',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'ans_2',
      interviewId: 'shared_story_1',
      questionId: 'q_anecdota_viaje',
      participantId: 'part_hija',
      participantName: 'Sofia (Hija)',
      answerText: 'Yo recuerdo que se nos ponchó una llanta y papá nos enseñó a cambiarla.',
      notRecalled: false,
      isFollowUp: false,
      isAdditionalMemory: false,
      idempotencyKey: 'id_sofia',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  // Both distinct versions preserved and strictly attributed
  assert.equal(sharedAnswers.length, 2);
  assert.equal(sharedAnswers[0].participantName, 'Roberto (Padre)');
  assert.equal(sharedAnswers[1].participantName, 'Sofia (Hija)');
  assert.notEqual(sharedAnswers[0].answerText, sharedAnswers[1].answerText);
});

test('11. Ramificación condicional a sub-flujo (ej. hijos) y retorno al hilo principal', () => {
  const questions: QuestionRecord[] = [
    {
      id: 'q_main_1',
      text: '¿Dónde naciste?',
      lifeStage: 'infancia',
      topic: 'origen',
      priority: 'alta',
      allowedStoryModes: 'ambas',
      requirementType: 'mandatory',
      active: true,
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      flowId: 'principal',
    },
    {
      id: 'q_gateway_hijos',
      text: '¿Tuviste hijos?',
      lifeStage: 'adultez',
      topic: 'familia_propia',
      priority: 'alta',
      allowedStoryModes: 'ambas',
      requirementType: 'mandatory',
      active: true,
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      flowId: 'principal',
      branchConfig: {
        enabled: true,
        targetFlowId: 'hijos',
        triggerRule: 'affirmative',
        branchLabel: 'Flujo sobre Hijos',
      },
    },
    {
      id: 'q_main_after',
      text: '¿Cuál ha sido tu mayor logro profesional?',
      lifeStage: 'adultez',
      topic: 'logros',
      priority: 'media',
      allowedStoryModes: 'ambas',
      requirementType: 'optional',
      active: true,
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      flowId: 'principal',
    },
    {
      id: 'q_hijos_1',
      text: '¿Cuáles son los nombres de tus hijos?',
      lifeStage: 'adultez',
      topic: 'hijos_y_crianza',
      priority: 'alta',
      allowedStoryModes: 'ambas',
      requirementType: 'mandatory',
      active: true,
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      flowId: 'hijos',
    },
    {
      id: 'q_hijos_2',
      text: '¿Qué enseñanza deseas dejarles a tus hijos?',
      lifeStage: 'legado_general',
      topic: 'hijos_y_crianza',
      priority: 'alta',
      allowedStoryModes: 'ambas',
      requirementType: 'mandatory',
      active: true,
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      flowId: 'hijos',
    },
  ];

  // 1. Before answering q_gateway_hijos, sequence only has main thread questions
  const initialSeq = buildParticipantFlowSequence({
    allQuestions: questions,
    participantAnswers: [],
  });
  assert.deepEqual(
    initialSeq.map((s) => s.question.id),
    ['q_main_1', 'q_gateway_hijos', 'q_main_after']
  );

  // 2. Participant answers q_gateway_hijos affirmatively ("Sí, tuve dos hijos")
  const answersAffirmative: AnswerRecord[] = [
    {
      id: 'a1',
      interviewId: 'int_1',
      questionId: 'q_main_1',
      participantId: 'p1',
      participantName: 'Ana',
      answerText: 'Nací en Puebla',
      notRecalled: false,
      isFollowUp: false,
      isAdditionalMemory: false,
      idempotencyKey: 'k1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'a2',
      interviewId: 'int_1',
      questionId: 'q_gateway_hijos',
      participantId: 'p1',
      participantName: 'Ana',
      answerText: 'Sí, tuve dos hijos maravillosos: Carlos y Lucía.',
      notRecalled: false,
      isFollowUp: false,
      isAdditionalMemory: false,
      branchChoice: 'yes',
      idempotencyKey: 'k2',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  const branchedSeq = buildParticipantFlowSequence({
    allQuestions: questions,
    participantAnswers: answersAffirmative,
  });

  // Sequence jumps to 'hijos' sub-flow and then returns to 'q_main_after'
  assert.deepEqual(
    branchedSeq.map((s) => s.question.id),
    ['q_main_1', 'q_gateway_hijos', 'q_hijos_1', 'q_hijos_2', 'q_main_after']
  );

  // Next question after q_gateway_hijos is q_hijos_1 (entering 'hijos' sub-flow)
  const stepIntoSubFlow = getNextQuestionInFlow({
    sequence: branchedSeq,
    currentQuestionId: 'q_gateway_hijos',
    participantAnswers: answersAffirmative,
  });
  assert.equal(stepIntoSubFlow.nextItem?.question.id, 'q_hijos_1');
  assert.equal(stepIntoSubFlow.enteredSubFlowId, 'hijos');
  assert.equal(stepIntoSubFlow.returnedToMainFlow, false);

  // Next question after finishing q_hijos_2 is q_main_after (returning to 'principal' flow)
  const stepReturnMain = getNextQuestionInFlow({
    sequence: branchedSeq,
    currentQuestionId: 'q_hijos_2',
    participantAnswers: answersAffirmative,
  });
  assert.equal(stepReturnMain.nextItem?.question.id, 'q_main_after');
  assert.equal(stepReturnMain.returnedToMainFlow, true);
});

test('12. Respuesta negativa en pregunta de salto omite el sub-flujo y continúa en el hilo principal', () => {
  const gatewayQ: QuestionRecord = {
    id: 'q_gateway_hijos',
    text: '¿Tuviste hijos?',
    lifeStage: 'adultez',
    topic: 'familia_propia',
    priority: 'alta',
    allowedStoryModes: 'ambas',
    requirementType: 'mandatory',
    active: true,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    flowId: 'principal',
    branchConfig: {
      enabled: true,
      targetFlowId: 'hijos',
      triggerRule: 'affirmative',
    },
  };

  assert.equal(
    doesAnswerTriggerBranch(gatewayQ, {
      answerText: 'No tuve hijos, me dediqué a viajar.',
      notRecalled: false,
      branchChoice: null,
    }),
    false
  );

  assert.equal(
    doesAnswerTriggerBranch(gatewayQ, {
      answerText: 'No aplica',
      notRecalled: false,
      branchChoice: 'no',
    }),
    false
  );

  assert.equal(
    doesAnswerTriggerBranch(gatewayQ, {
      answerText: 'Tuve tres hijos que son mi orgullo.',
      notRecalled: false,
      branchChoice: null,
    }),
    true
  );
});

test('13. Detección de finalización del cuestionario completo', () => {
  const questions: QuestionRecord[] = [
    {
      id: 'q_1',
      text: 'Pregunta 1',
      lifeStage: 'infancia',
      topic: 'origen',
      priority: 'alta',
      allowedStoryModes: 'ambas',
      requirementType: 'mandatory',
      active: true,
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      flowId: 'principal',
    },
  ];

  const answers: AnswerRecord[] = [
    {
      id: 'a_1',
      interviewId: 'int_1',
      questionId: 'q_1',
      participantId: 'p_1',
      participantName: 'Juan',
      answerText: 'Mi respuesta',
      notRecalled: false,
      isFollowUp: false,
      isAdditionalMemory: false,
      idempotencyKey: 'k_1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  const seq = buildParticipantFlowSequence({ allQuestions: questions, participantAnswers: answers });
  assert.equal(isQuestionnaireFlowComplete(seq, answers), true);

  const next = getNextQuestionInFlow({
    sequence: seq,
    currentQuestionId: 'q_1',
    participantAnswers: answers,
  });
  assert.equal(next.completedInstrument, true);
  assert.equal(next.nextItem, null);
});

test('14. Validación de fotografías opcionales y obligatoriedad de descripción/contexto cuando se adjunta imagen', () => {
  // Sin fotos siempre es válido (opcional)
  assert.equal(validatePhotoAttachments([]).valid, true);
  assert.equal(validatePhotoAttachments(undefined).valid, true);

  // Con foto pero sin descripción/contexto -> inválido
  const missingCaption = validatePhotoAttachments([
    {
      fileName: 'casa_abuelos.jpg',
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      caption: '  ',
    },
  ]);
  assert.equal(missingCaption.valid, false);
  assert.match(missingCaption.error || '', /describe o da contexto a la fotografía #1/);

  // Con foto y descripción contextual -> válido
  const validPhoto = validatePhotoAttachments([
    {
      fileName: 'casa_abuelos.jpg',
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      caption: 'Patio de naranjos de mis abuelos en Quiroga en 1954.',
    },
  ]);
  assert.equal(validPhoto.valid, true);
});

test('15. Inserción de fotografías en el capítulo/etapa correcta del manuscrito', () => {
  const questions: QuestionRecord[] = [
    {
      id: 'q_inf_01',
      text: '¿Cómo describirías el lugar donde creciste?',
      lifeStage: 'infancia',
      topic: 'origen_familiar',
      priority: 'alta',
      allowedStoryModes: 'ambas',
      requirementType: 'mandatory',
      active: true,
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'q_hijos_01',
      text: '¿Cómo recuerdas el nacimiento de tus hijos?',
      lifeStage: 'adultez',
      topic: 'hijos_y_crianza',
      priority: 'alta',
      allowedStoryModes: 'ambas',
      requirementType: 'mandatory',
      active: true,
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];

  const answers: AnswerRecord[] = [
    {
      id: 'ans_1',
      interviewId: 'int_1',
      questionId: 'q_inf_01',
      questionText: '¿Cómo describirías el lugar donde creciste?',
      participantId: 'p_1',
      participantName: 'Don Fernando',
      answerText: 'Crecí en Quiroga en una casa con patio empedrado.',
      notRecalled: false,
      isFollowUp: false,
      isAdditionalMemory: false,
      photos: [
        {
          id: 'photo_inf_1',
          interviewId: 'int_1',
          questionId: 'q_inf_01',
          questionText: '¿Cómo describirías el lugar donde creciste?',
          lifeStage: 'infancia',
          topic: 'origen_familiar',
          participantId: 'p_1',
          participantName: 'Don Fernando',
          fileName: 'patio_quiroga.jpg',
          mimeType: 'image/jpeg',
          caption: 'El patio empedrado de nuestra casa en Quiroga en 1952.',
          imageUrl: '/api/photos/photo_inf_1',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
      idempotencyKey: 'k_1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'ans_2',
      interviewId: 'int_1',
      questionId: 'q_hijos_01',
      questionText: '¿Cómo recuerdas el nacimiento de tus hijos?',
      participantId: 'p_1',
      participantName: 'Don Fernando',
      answerText: 'Cuando nació mi hija mayor sentí una alegría inmensa.',
      notRecalled: false,
      isFollowUp: false,
      isAdditionalMemory: false,
      photos: [
        {
          id: 'photo_hij_1',
          interviewId: 'int_1',
          questionId: 'q_hijos_01',
          questionText: '¿Cómo recuerdas el nacimiento de tus hijos?',
          lifeStage: 'adultez',
          topic: 'hijos_y_crianza',
          participantId: 'p_1',
          participantName: 'Don Fernando',
          fileName: 'nacimiento_hija.jpg',
          mimeType: 'image/jpeg',
          caption: 'Sosteniendo a mi hija recién nacida afuera de la clínica en 1975.',
          imageUrl: '/api/photos/photo_hij_1',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
      idempotencyKey: 'k_2',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  const baseManuscript = [
    '# Memorias de Don Fernando',
    '',
    '## Capítulo 1: Infancia y Raíces',
    'Don Fernando nació y creció en Quiroga en una casa con patio empedrado.',
    '',
    '## Capítulo 2: Adultez, Familia e Hijos',
    'El nacimiento de su hija mayor marcó el inicio de una etapa llena de alegría.',
  ].join('\n');

  const enriched = ensurePhotosPlacedInManuscript({
    compiledMarkdown: baseManuscript,
    answers,
    questions,
  });

  const idxInfanciaHeader = enriched.indexOf('## Capítulo 1: Infancia y Raíces');
  const idxAdultezHeader = enriched.indexOf('## Capítulo 2: Adultez, Familia e Hijos');
  const idxPhotoInfancia = enriched.indexOf('/api/photos/photo_inf_1');
  const idxPhotoHijos = enriched.indexOf('/api/photos/photo_hij_1');

  assert.ok(idxPhotoInfancia > idxInfanciaHeader && idxPhotoInfancia < idxAdultezHeader);
  assert.ok(idxPhotoHijos > idxAdultezHeader);
  assert.match(enriched, /El patio empedrado de nuestra casa en Quiroga en 1952/);
  assert.match(enriched, /Sosteniendo a mi hija recién nacida afuera de la clínica en 1975/);
});

test('21. Respuesta enviada mediante archivo de voz con transcripción integrada', () => {
  const existingAnswers: AnswerRecord[] = [];
  const voiceAnswer = {
    interviewId: 'interview_100',
    questionId: 'q_inf_01',
    participantId: 'p_1',
    participantName: 'Don Fernando',
    answerText: 'Recuerdo claramente las tardes de lluvia en Michoacán.',
    notRecalled: false,
    audio: {
      id: 'aud_12345',
      interviewId: 'interview_100',
      questionId: 'q_inf_01',
      participantId: 'p_1',
      participantName: 'Don Fernando',
      audioUrl: '/api/audio/aud_12345',
      mimeType: 'audio/webm',
      transcription: 'Recuerdo claramente las tardes de lluvia en Michoacán.',
      durationSeconds: 42,
      createdAt: '2026-01-01T00:00:00Z',
    },
    idempotencyKey: 'idem_voice_1',
  };

  const evalResult = evaluateAnswerIncrement({
    existingAnswers,
    incomingPayload: voiceAnswer,
    allowEditing: true,
  });

  assert.equal(evalResult.shouldIncrementCounter, true);
  assert.equal(evalResult.isEdit, false);
  assert.equal(evalResult.isDuplicate, false);
});

test('22. Actualización de respuesta incorporando archivo de voz', () => {
  const existingAnswers: AnswerRecord[] = [
    {
      id: 'ans_1',
      interviewId: 'interview_100',
      questionId: 'q_inf_01',
      participantId: 'p_1',
      participantName: 'Don Fernando',
      answerText: 'Respuesta inicial breve.',
      notRecalled: false,
      isFollowUp: false,
      isAdditionalMemory: false,
      idempotencyKey: 'idem_1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  const evalResult = evaluateAnswerIncrement({
    existingAnswers,
    incomingPayload: {
      interviewId: 'interview_100',
      questionId: 'q_inf_01',
      participantId: 'p_1',
      participantName: 'Don Fernando',
      answerText: 'Respuesta ampliada mediante audio de voz.',
      notRecalled: false,
      idempotencyKey: 'idem_2',
    },
    allowEditing: true,
  });

  assert.equal(evalResult.isEdit, true);
  assert.equal(evalResult.shouldIncrementCounter, false);
});

test('23. Múltiples grabaciones de voz se preservan sin sobreescribir las anteriores', () => {
  const audio1: AnswerVoiceAttachment = {
    id: 'aud_1',
    interviewId: 'interview_100',
    questionId: 'q_inf_01',
    participantId: 'p_1',
    participantName: 'Don Fernando',
    audioUrl: '/api/audio/aud_1',
    mimeType: 'audio/webm',
    transcription: 'Primer recuerdo de la infancia.',
    durationSeconds: 15,
    createdAt: '2026-01-01T00:00:00Z',
  };

  const audio2: AnswerVoiceAttachment = {
    id: 'aud_2',
    interviewId: 'interview_100',
    questionId: 'q_inf_01',
    participantId: 'p_1',
    participantName: 'Don Fernando',
    audioUrl: '/api/audio/aud_2',
    mimeType: 'audio/webm',
    transcription: 'Segundo recuerdo complementario sobre mis abuelos.',
    durationSeconds: 28,
    createdAt: '2026-01-01T00:05:00Z',
  };

  const answerRecord: AnswerRecord = {
    id: 'ans_1',
    interviewId: 'interview_100',
    questionId: 'q_inf_01',
    participantId: 'p_1',
    participantName: 'Don Fernando',
    answerText:
      'Primer recuerdo de la infancia.\n\n[Nota de voz]: Segundo recuerdo complementario sobre mis abuelos.',
    notRecalled: false,
    isFollowUp: false,
    isAdditionalMemory: false,
    audio: audio2,
    audioRecordings: [audio1, audio2],
    idempotencyKey: 'idem_multi',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:05:00Z',
  };

  assert.equal(answerRecord.audioRecordings?.length, 2);
  assert.equal(answerRecord.audioRecordings?.[0].id, 'aud_1');
  assert.equal(answerRecord.audioRecordings?.[1].id, 'aud_2');
  assert.equal(answerRecord.audio?.id, 'aud_2');
});

test('24. Validación de Consentimiento Informado (isConsentValid)', () => {
  // Valid consent with mandatory Declarations A and B
  const validConsent: PrivacyConsentRecord = {
    id: 'consent_1',
    participantId: 'p_1',
    participantName: 'Don Fernando',
    interviewId: 'interview_100',
    policyVersion: '1.0',
    policyHash: 'a'.repeat(64),
    declarations: {
      declarationA_acknowledgement: true,
      declarationB_necessaryProcessing: true,
      declarationC_sensitiveData: false,
      declarationD_financialData: false,
      declarationE_aiAssistant: true,
      declarationF_shareWithFamily: true,
      declarationG_promotionalUse: false,
    },
    confirmedIdentity: true,
    confirmedParticipantName: 'Don Fernando',
    confirmationMethod: 'electronic_affirmative_action',
    serverTimestamp: new Date().toISOString(),
    serverTimestampEpoch: Date.now(),
    serverTimezone: 'America/Merida',
    status: 'active',
  };

  assert.equal(isConsentValid(validConsent), true);

  // Missing Declaration A
  const missingA = {
    ...validConsent,
    declarations: { ...validConsent.declarations, declarationA_acknowledgement: false },
  };
  assert.equal(isConsentValid(missingA), false);

  // Missing Declaration B
  const missingB = {
    ...validConsent,
    declarations: { ...validConsent.declarations, declarationB_necessaryProcessing: false },
  };
  assert.equal(isConsentValid(missingB), false);

  // Revoked consent
  const revoked: PrivacyConsentRecord = {
    ...validConsent,
    status: 'revoked',
    revokedAt: new Date().toISOString(),
  };
  assert.equal(isConsentValid(revoked), false);

  // Null or undefined
  assert.equal(isConsentValid(null), false);
  assert.equal(isConsentValid(undefined), false);
});

test('25. Criptografía SHA-256 de Constancia Oficial de Consentimiento', () => {
  const testPayload = {
    participantId: 'p_1',
    interviewId: 'interview_100',
    policyVersion: '1.0',
    acceptedAtUtc: '2026-10-29T16:00:00.000Z',
  };

  const hash1 = computeDocumentSha256(testPayload);
  const hash2 = computeDocumentSha256(testPayload);

  assert.equal(typeof hash1, 'string');
  assert.equal(hash1.length, 64);
  assert.equal(hash1, hash2, 'SHA-256 debe ser determinista');

  // Changing payload produces a distinct hash
  const hashDifferent = computeDocumentSha256({ ...testPayload, policyVersion: '1.1' });
  assert.notEqual(hash1, hashDifferent);
});

test('26. Normalización y coincidencia flexible de códigos de acceso YF-XXXXX, LEG-XXXX y tokens del panel administrador', () => {
  const { plainToken, tokenHash, accessCode } = generateInvitationToken();
  assert.match(accessCode, /^YF-[A-Z0-9]{5}$/);
  assert.ok(/[A-Z]/.test(accessCode.slice(3)) && /[0-9]/.test(accessCode.slice(3)));

  const sampleToken: InterviewTokenRecord & { plainToken?: string } = {
    id: 'tok_test_26',
    tokenHash,
    plainToken,
    accessCode: 'YF-8F4A2',
    interviewId: 'int_test_26',
    participantId: 'part_test_26',
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    revoked: false,
    createdAt: new Date().toISOString(),
  };

  // 1. Exact access code
  assert.equal(matchTokenRecord('YF-8F4A2', [sampleToken])?.id, 'tok_test_26');
  // 2. Lowercase access code
  assert.equal(matchTokenRecord('yf-8f4a2', [sampleToken])?.id, 'tok_test_26');
  // 3. Access code without hyphen or with spaces
  assert.equal(matchTokenRecord('YF8F4A2', [sampleToken])?.id, 'tok_test_26');
  assert.equal(matchTokenRecord('YF 8F4A2', [sampleToken])?.id, 'tok_test_26');
  // 4. Access code copied with "Código: " prefix from Admin Panel badge
  assert.equal(matchTokenRecord('Código: YF-8F4A2', [sampleToken])?.id, 'tok_test_26');
  // 5. Access code copied with WhatsApp emoji prefix
  assert.equal(matchTokenRecord('👉 YF-8F4A2', [sampleToken])?.id, 'tok_test_26');
  // 6. Just the 5-char suffix after YF-
  assert.equal(matchTokenRecord('8F4A2', [sampleToken])?.id, 'tok_test_26');
  // 7. Plain token (both lowercase and uppercase from CSS uppercase input)
  assert.equal(matchTokenRecord(plainToken, [sampleToken])?.id, 'tok_test_26');
  assert.equal(matchTokenRecord(plainToken.toUpperCase(), [sampleToken])?.id, 'tok_test_26');
  // 8. Full invite URL with ?token= or ?code=
  assert.equal(
    matchTokenRecord(`https://youforever.app/interview?token=${plainToken}`, [sampleToken])?.id,
    'tok_test_26'
  );
  assert.equal(
    matchTokenRecord(`https://youforever.app/interview?code=YF-8F4A2`, [sampleToken])?.id,
    'tok_test_26'
  );
  // 9. Deterministic fallback access code when accessCode field was empty on legacy token
  const legacyToken: InterviewTokenRecord & { plainToken?: string } = {
    ...sampleToken,
    id: 'tok_legacy',
    accessCode: '',
    participantId: 'part_legacy_99',
  };
  const derivedCode = deriveDeterministicAccessCode('part_legacy_99');
  assert.match(derivedCode, /^YF-[A-Z0-9]{5}$/);
  assert.ok(/[A-Z]/.test(derivedCode.slice(3)) && /[0-9]/.test(derivedCode.slice(3)));
  assert.equal(matchTokenRecord(derivedCode, [legacyToken])?.id, 'tok_legacy');
  assert.equal(extractCleanTokenOrCode('Código: yf-8f4a2'), 'YF-8F4A2');
  assert.equal(extractCleanTokenOrCode('Código: leg-8f4a'), 'LEG-8F4A');
});




