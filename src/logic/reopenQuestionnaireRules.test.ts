import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAdminReopen,
  evaluateAnswerIncrement,
  buildParticipantFlowSequence,
  type InterviewRecord,
  type QuestionRecord,
  type AnswerRecord,
} from './interviewRules.js';

test('Reabrir entrevista: applyAdminReopen restablece status open, userDeclaredComplete false y asigna reopenedAt', () => {
  const closedInterview: InterviewRecord = {
    id: 'int_sample_closed',
    title: 'Historia de Prueba Cerrada',
    storyMode: 'individual',
    storyType: 'biografia_personal',
    status: 'completed',
    openedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-15T00:00:00.000Z',
    openDaysAtCreation: 15,
    sufficiencyThreshold: 100,
    maxFollowUpsAtCreation: 2,
    closedAt: '2026-01-10T12:00:00.000Z',
    userDeclaredComplete: true,
    layoutEditsAllowed: 0,
    bookGeneratedCount: 1,
    completedQuestionCount: 100,
    sufficiencyStatus: 'sufficient',
    lastActivityAt: '2026-01-10T12:00:00.000Z',
    questionnaireVersionId: 'v1_standard',
  };

  const reopened = applyAdminReopen(
    closedInterview,
    10,
    'El participante solicitó corregir fechas familiares',
    new Date().toISOString(),
    2
  );

  assert.equal(reopened.status, 'open');
  assert.equal(reopened.userDeclaredComplete, false);
  assert.equal(reopened.closedAt, null);
  assert.ok(reopened.reopenedAt, 'Debe contar con timestamp de reapertura');
  assert.ok(
    reopened.closureReason?.includes('El participante solicitó corregir fechas familiares'),
    'Debe registrar el motivo de reapertura'
  );
  assert.equal(reopened.layoutEditsAllowed, 2, 'Debe asignar la cuota de edición de maquetación');
  assert.ok(
    new Date(reopened.expiresAt).getTime() > Date.now(),
    'La fecha de expiración debe extenderse hacia el futuro'
  );
});

test('Edición de respuestas: evaluateAnswerIncrement permite actualizar respuestas existentes cuando la entrevista está abierta', () => {
  const existingAnswers: AnswerRecord[] = [
    {
      id: 'ans_1',
      interviewId: 'int_sample_reopened',
      questionId: 'q_infancia_1',
      participantId: 'part_1',
      participantName: 'Santiago Ramos',
      questionText: '¿Dónde naciste y creciste?',
      answerText: 'Nací en Guadalajara en 1952.',
      notRecalled: false,
      isFollowUp: false,
      isAdditionalMemory: false,
      createdAt: '2026-01-05T10:00:00.000Z',
      updatedAt: '2026-01-05T10:00:00.000Z',
      idempotencyKey: 'idem_initial_1',
    },
  ];

  const evalResult = evaluateAnswerIncrement({
    existingAnswers,
    incomingPayload: {
      interviewId: 'int_sample_reopened',
      questionId: 'q_infancia_1',
      participantId: 'part_1',
      participantName: 'Santiago Ramos',
      answerText: 'Nací en Guadalajara en 1952, en el barrio de Analco junto al jardín.',
      notRecalled: false,
      idempotencyKey: 'idem_updated_1',
    },
    allowEditing: true,
  });

  assert.equal(evalResult.error, undefined, 'No debe arrojar error al editar');
  assert.equal(evalResult.isEdit, true, 'Debe marcarse como edición');
  assert.equal(evalResult.shouldIncrementCounter, false, 'La edición no debe inflar el contador');
  assert.equal(evalResult.existingAnswer?.id, 'ans_1', 'Debe identificar la respuesta previa');
});

test('Secuencia biográfica con respuestas completas: avance ordenado y pre-carga en Pregunta 1', () => {
  const questions: QuestionRecord[] = [
    {
      id: 'q_1',
      text: '¿Cuál es tu primer recuerdo de infancia?',
      lifeStage: 'infancia',
      topic: 'primeros_recuerdos',
      orderIndex: 1,
      flowId: 'principal',
      active: true,
      allowedStoryModes: 'ambas',
      priority: 'alta',
      requirementType: 'mandatory',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'q_2',
      text: '¿Cómo era la casa familiar donde creciste?',
      lifeStage: 'infancia',
      topic: 'hogar_familiar',
      orderIndex: 2,
      flowId: 'principal',
      active: true,
      allowedStoryModes: 'ambas',
      priority: 'media',
      requirementType: 'optional',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const answers: AnswerRecord[] = [
    {
      id: 'ans_1',
      interviewId: 'int_1',
      questionId: 'q_1',
      participantId: 'part_1',
      participantName: 'Carmen Valenzuela',
      questionText: '¿Cuál es tu primer recuerdo de infancia?',
      answerText: 'Recuerdo el jardín con árboles de naranjo.',
      notRecalled: false,
      isFollowUp: false,
      isAdditionalMemory: false,
      idempotencyKey: 'idem_t1',
      createdAt: '2026-01-02T10:00:00.000Z',
      updatedAt: '2026-01-02T10:00:00.000Z',
    },
    {
      id: 'ans_2',
      interviewId: 'int_1',
      questionId: 'q_2',
      participantId: 'part_1',
      participantName: 'Carmen Valenzuela',
      questionText: '¿Cómo era la casa familiar donde creciste?',
      answerText: 'Una casa grande con patio central de cantera.',
      notRecalled: false,
      isFollowUp: false,
      isAdditionalMemory: false,
      idempotencyKey: 'idem_t2',
      createdAt: '2026-01-02T10:15:00.000Z',
      updatedAt: '2026-01-02T10:15:00.000Z',
    },
  ];

  const seq = buildParticipantFlowSequence({
    allQuestions: questions,
    participantAnswers: answers,
    storyMode: 'individual',
  });

  assert.equal(seq.length, 2, 'Deben incluirse las 2 preguntas en secuencia');
  // Al aterrizar en la entrevista reabierta, el primer paso corresponde a la pregunta 1
  assert.equal(seq[0].question.id, 'q_1', 'La primera pregunta debe ser q_1');
});
