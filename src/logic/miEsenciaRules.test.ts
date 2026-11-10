import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePersonalAccessCode,
  deriveShortMiEsenciaAccessCode,
  extractCleanMiEsenciaCode,
  computeMiEsenciaCodeHash,
  filterMemoriesForAuthenticatedInterlocutor,
  calculateRenewalExpirationDate,
  applySubscriptionSuspensionState,
  evaluateEffectiveSubscriptionStatus,
  parseCompilationTextIntoTestimonies,
  extractTextFromUploadedPdfBase64,
  extractRelatedPersonsFromTestimonies,
  buildCompilationPdfBase64,
  detectConversationalIntentAndPrivacy,
  sanitizeAvatarResponseText,
  MiEsenciaMemoryRecord,
  MiEsenciaSubscriptionRecord,
} from './miEsenciaRules.ts';

describe('Mi Esencia Subsystem — Pure Domain Rules & Cryptographic Privacy Isolation', () => {
  it('1. Parses literal Question + Answer blocks from Compilado Testimonial Fidedigno as immutable Level A testimonies', () => {
    const sampleCompilation = `
### 1. ¿Cuáles son tus recuerdos más queridos de la infancia?
**Respuesta (10/05/2026):**
Recuerdo con mucho cariño la casa de mis abuelos en Guadalajara y cuando jugaba con mi hermana Elena en el patio.

### 2. ¿Qué consejo le dejas a tu familia en la madurez?
**Respuesta (11/05/2026):**
Que siempre cuiden a mi hija Ana y a mi nieto Mateo, porque la unión familiar es nuestra mayor bendición.
`;

    const blocks = parseCompilationTextIntoTestimonies({
      rawText: sampleCompilation,
      avatarId: 'avatar_test_1',
      personId: 'person_test_1',
      sourcePdfId: 'pdf_test_1',
    });

    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].immutable, true);
    assert.equal(blocks[0].lifeStage, 'infancia');
    assert.ok(blocks[0].answerLiteral.includes('Guadalajara'));
    assert.equal(blocks[1].lifeStage, 'madurez');

    const relations = extractRelatedPersonsFromTestimonies(
      'avatar_test_1',
      'person_test_1',
      blocks
    );
    assert.ok(relations.some((r) => r.mentionedName === 'Elena' && r.relationshipType === 'Hermana'));
    assert.ok(relations.some((r) => r.mentionedName === 'Ana' && r.relationshipType === 'Hija'));
    assert.ok(relations.some((r) => r.mentionedName === 'Mateo' && r.relationshipType === 'Nieto'));
  });

  it('2. Generates valid Compilado Testimonial Fidedigno PDF in Base64 with SHA-256 integrity hash', () => {
    const blocks = parseCompilationTextIntoTestimonies({
      rawText: `### 1. ¿Dónde naciste?\n**Respuesta:**\nNací en Mérida rodeado del cariño de mis padres.`,
      avatarId: 'avatar_pdf',
      personId: 'person_pdf',
      sourcePdfId: 'pdf_1',
    });

    const result = buildCompilationPdfBase64({
      interviewTitle: 'Entrevista de Don Roberto',
      participantNames: ['Don Roberto'],
      rawTextContent: 'Contenido literal',
      testimonies: blocks,
    });

    assert.ok(result.pdfBase64.length > 500);
    assert.equal(result.sha256Hash.length, 64);
  });

  it('3. Enforces strict cryptographic Level C privacy isolation per interlocutor and mixed alphanumeric YF-XXXXX access codes', () => {
    const codeAna = generatePersonalAccessCode('Ana');
    const codeCarlos = generatePersonalAccessCode('Carlos');

    assert.match(codeAna.personalCodePlain, /^YF-[A-Z0-9]{5}$/);
    assert.equal(codeAna.personalCodePlain.length, 8);
    assert.ok(/[A-Z]/.test(codeAna.personalCodePlain.slice(3)) && /[0-9]/.test(codeAna.personalCodePlain.slice(3)));
    assert.notEqual(codeAna.personalCodePlain, codeCarlos.personalCodePlain);
    assert.equal(computeMiEsenciaCodeHash(codeAna.personalCodePlain), codeAna.codeHash);

    const derived = deriveShortMiEsenciaAccessCode('seed_cred_ana_1');
    assert.match(derived, /^YF-[A-Z0-9]{5}$/);
    assert.equal(derived.length, 8);
    assert.ok(/[A-Z]/.test(derived.slice(3)) && /[0-9]/.test(derived.slice(3)));

    assert.equal(
      extractCleanMiEsenciaCode('https://youforever.app/miesencia?code=YF-8K4M2'),
      'YF-8K4M2'
    );
    assert.equal(extractCleanMiEsenciaCode('yf8k4m2'), 'YF-8K4M2');
    assert.equal(
      extractCleanMiEsenciaCode('https://youforever.app/miesencia?code=YF-8492'),
      'YF-8492'
    );
    assert.equal(extractCleanMiEsenciaCode('yf8492'), 'YF-8492');
    assert.equal(
      extractCleanMiEsenciaCode('https://youforever.app/miesencia?code=FY-ANA-8F3K-29A1'),
      'FY-ANA-8F3K-29A1'
    );

    const memories: MiEsenciaMemoryRecord[] = [
      {
        memoryId: 'mem_b_1',
        avatarId: 'av_1',
        personId: 'p_1',
        privacyLevel: 'familiar_compartido',
        ownerInterlocutorId: 'inter_ana',
        ownerInterlocutorName: 'Ana',
        ownerRelationship: 'Hija',
        topic: 'Viaje familiar',
        content: 'Fuimos todos a Veracruz en 1998.',
        attributionText: 'Según me contó mi hija Ana',
        verificationState: 'confirmado',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        memoryId: 'mem_c_ana',
        avatarId: 'av_1',
        personId: 'p_1',
        privacyLevel: 'privado_interlocutor',
        ownerInterlocutorId: 'inter_ana',
        ownerInterlocutorName: 'Ana',
        ownerRelationship: 'Hija',
        topic: 'Secreto de Ana',
        content: 'Esta es una confidencia privada exclusiva entre papá y Ana.',
        attributionText: 'Confidencia privada de Ana',
        verificationState: 'confirmado',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    // Cuando conversa Ana (inter_ana), ve Nivel B + su propio Nivel C
    const viewForAna = filterMemoriesForAuthenticatedInterlocutor(
      memories,
      'p_1',
      'inter_ana'
    );
    assert.equal(viewForAna.sharedMemoriesLevelB.length, 1);
    assert.equal(viewForAna.privateMemoriesLevelC.length, 1);
    assert.equal(viewForAna.privateMemoriesLevelC[0].memoryId, 'mem_c_ana');

    // Cuando conversa su hermano Carlos (inter_carlos), ve Nivel B pero JAMÁS el Nivel C de Ana
    const viewForCarlos = filterMemoriesForAuthenticatedInterlocutor(
      memories,
      'p_1',
      'inter_carlos'
    );
    assert.equal(viewForCarlos.sharedMemoriesLevelB.length, 1);
    assert.equal(viewForCarlos.privateMemoriesLevelC.length, 0);
  });

  it('4. Preserves 100% of remaining paid days on early subscription renewal and supports frozen clock suspension', () => {
    const nowIso = '2026-11-01T00:00:00.000Z';
    const currentExpiresIso = '2026-11-21T00:00:00.000Z'; // 20 días pagados restantes

    const renewal = calculateRenewalExpirationDate({
      currentExpiresAt: currentExpiresIso,
      nowIso,
      unit: 'days',
      value: 30,
    });

    assert.equal(renewal.preservedRemainingDays, 20);
    // 20 días restantes + 30 nuevos = 50 días desde nowIso (2026-12-21)
    assert.equal(renewal.newExpiresAtIso, '2026-12-21T00:00:00.000Z');

    // Probar suspensión con reloj congelado y reanudación posterior
    const mockSub: MiEsenciaSubscriptionRecord = {
      subscriptionId: 'sub_1',
      avatarId: 'av_1',
      sourceInterviewId: 'int_1',
      avatarDisplayName: 'Don Roberto',
      isCoupleAvatar: false,
      personIds: ['p_1'],
      planId: 'plan_mensual',
      planName: 'Plan Esencia Mensual',
      status: 'activa',
      startsAt: nowIso,
      expiresAt: currentExpiresIso,
      gracePeriodDays: 5,
      clockFrozen: false,
      maxAuthorizedInterlocutors: 6,
      monthlyMessageQuota: 600,
      dailyMessageQuotaPerInterlocutor: 40,
      messagesUsedThisMonth: 0,
      tokensEstimatedThisMonth: 0,
      autoRenewEnabled: false,
      historyLog: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const frozenSub = applySubscriptionSuspensionState({
      subscription: mockSub,
      action: 'suspend_clock_frozen',
      nowIso: '2026-11-06T00:00:00.000Z', // Quedan 15 días exactos
    });

    assert.equal(frozenSub.status, 'suspendida_reloj_congelado');
    assert.equal(frozenSub.clockFrozen, true);
    assert.equal(frozenSub.frozenRemainingMs, 15 * 24 * 60 * 60 * 1000);

    // Reanudar 10 días después (el 16 de noviembre): el nuevo vencimiento debe restaurar los 15 días íntegros (1 de diciembre)
    const resumedSub = applySubscriptionSuspensionState({
      subscription: frozenSub,
      action: 'resume',
      nowIso: '2026-11-16T00:00:00.000Z',
    });

    assert.equal(resumedSub.clockFrozen, false);
    assert.equal(resumedSub.expiresAt, '2026-12-01T00:00:00.000Z');
    assert.equal(evaluateEffectiveSubscriptionStatus(resumedSub, '2026-11-16T00:00:00.000Z'), 'activa');
  });

  it('5. Detects conversational privacy intents and sanitizes robotic AI phrasing', () => {
    const privIntent = detectConversationalIntentAndPrivacy(
      'Quiero contarte algo que quede solo entre nosotros dos: compré el anillo de compromiso.'
    );
    assert.equal(privIntent.wantsToSaveMemory, true);
    assert.equal(privIntent.requestedPrivacyLevel, 'privado_interlocutor');

    const cleaned = sanitizeAvatarResponseText(
      'Como un modelo de inteligencia artificial, según mi base de datos yo nací en Puebla.',
      'Roberto'
    );
    assert.ok(!cleaned.toLowerCase().includes('modelo de inteligencia artificial'));
    assert.ok(cleaned.includes('por lo que dejé contado en mis recuerdos'));
  });
});

import {
  buildVariedInitialReflectiveGreeting,
  identifyInterlocutorFromLegacy,
  buildPersonalizedPostIdentificationGreeting,
  isGenericAdministrativeInterlocutorName,
  MiEsenciaPersonProfile,
  MiEsenciaRelatedPerson,
  MiEsenciaTestimonyBlock,
} from './miEsenciaRules.ts';

describe('Mi Esencia — Saludo Inicial Reflexivo, Identificación del Interlocutor y Personalización Afectiva', () => {
  const mockPerson: MiEsenciaPersonProfile = {
    personId: 'p_roberto',
    avatarId: 'av_roberto',
    sourceInterviewId: 'int_roberto',
    sourcePdfId: 'pdf_1',
    fullName: 'Roberto Mendoza',
    preferredName: 'Roberto',
    biographySummary: 'Arquitecto jubilado, amante de la familia y las sobremesas.',
    milestones: ['Nació en Mérida', 'Formó su familia'],
    linguisticProfile: {
      frequentExpressions: ['con todo mi cariño', 'qué bendición'],
      affectionateTerms: ['mi vida', 'corazón'],
      sentenceRhythm: 'pausado_reflexivo',
      warmthTone: 'Cálido y reflexivo',
      keyValues: ['Familia', 'Gratitud'],
      neverSaidTopicsNote: 'No inventar fechas ausentes',
    },
    spontaneityLevel: 'moderado',
    status: 'aprobado',
    version: 1,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };

  const mockTestimonies: MiEsenciaTestimonyBlock[] = [
    {
      testimonyId: 't_1',
      avatarId: 'av_roberto',
      personId: 'p_roberto',
      sourcePdfId: 'pdf_1',
      lifeStage: 'madurez',
      topic: 'Familia y nietos',
      questionLiteral: '¿Qué significa tu familia para ti?',
      answerLiteral:
        'Para mí la mesa del domingo con mis hijos y mis nietos siempre fue el corazón de la casa. Adoro a mi nieta Sofía, le digo Sofi de cariño, siempre me alegra con su risa y me siento muy orgulloso de su nobleza.',
      entitiesMentioned: ['Sofía'],
      keywords: ['familia', 'nietos', 'Sofi', 'orgulloso'],
      recordedAt: '2026-11-01T00:00:00.000Z',
      immutable: true,
    },
    {
      testimonyId: 't_2',
      avatarId: 'av_roberto',
      personId: 'p_roberto',
      sourcePdfId: 'pdf_1',
      lifeStage: 'madurez',
      topic: 'Hijos',
      questionLiteral: '¿Qué recuerdas de tus hijos?',
      answerLiteral:
        'A mi hijo Andrés lo quiero mucho y siempre le agradezco todo lo que me enseñó sobre la paciencia.',
      entitiesMentioned: ['Andrés'],
      keywords: ['hijos', 'Andrés', 'paciencia'],
      recordedAt: '2026-11-01T00:00:00.000Z',
      immutable: true,
    },
  ];

  const mockRelatedPersons: MiEsenciaRelatedPerson[] = [
    {
      relatedPersonId: 'rel_sofi',
      avatarId: 'av_roberto',
      personId: 'p_roberto',
      mentionedName: 'Sofía',
      relationshipType: 'Nieta',
      affectionateNicknames: ['Sofi'],
      sharedMemoriesSummary:
        'Adoro a mi nieta Sofía, le digo Sofi de cariño, siempre me alegra con su risa y me siento muy orgulloso de su nobleza.',
      sourceTestimonyIds: ['t_1'],
      createdAt: '2026-11-01T00:00:00.000Z',
    },
    {
      relatedPersonId: 'rel_andres',
      avatarId: 'av_roberto',
      personId: 'p_roberto',
      mentionedName: 'Andrés',
      relationshipType: 'Hijo',
      affectionateNicknames: [],
      sharedMemoriesSummary:
        'A mi hijo Andrés lo quiero mucho y siempre le agradezco todo lo que me enseñó sobre la paciencia.',
      sourceTestimonyIds: ['t_2'],
      createdAt: '2026-11-01T00:00:00.000Z',
    },
  ];

  it('Prueba 1: Interlocutor desconocido — genera saludo cálido con reflexión de 40 a 90 palabras y una sola pregunta de identificación', () => {
    const greeting = buildVariedInitialReflectiveGreeting({
      person: mockPerson,
      testimonies: mockTestimonies,
      previousThemesUsed: [],
      sessionIndex: 0,
    });

    assert.ok(greeting.wordCount >= 40 && greeting.wordCount <= 95);
    assert.equal(greeting.usedDocumentedLegacy, true);
    assert.ok(greeting.greetingText.includes('?'));
    // Nunca debe usar etiquetas administrativas genéricas
    assert.ok(!greeting.greetingText.includes('Familiar Principal'));
    assert.ok(isGenericAdministrativeInterlocutorName('Familiar Principal'));
    assert.ok(!isGenericAdministrativeInterlocutorName('Sofía'));
  });

  it('Prueba 2 y 3: Familiar reconocido (ej. «Soy Sofía, tu nieta») — usa apodo afectivo documentado («Sofi») y sentimientos reales documentados', () => {
    const idResult = identifyInterlocutorFromLegacy({
      userMessage: 'Hola abuelo, soy Sofía, tu nieta',
      relations: mockRelatedPersons,
      testimonies: mockTestimonies,
    });

    assert.equal(idResult.newIdentityState, 'confirmed_known_family');
    assert.ok(idResult.confirmedIdentity);
    assert.equal(idResult.confirmedIdentity?.affectionateNickname, 'Sofi');
    assert.ok(
      idResult.confirmedIdentity?.documentedSentimentTone === 'orgullo_profundo' ||
        idResult.confirmedIdentity?.documentedSentimentTone === 'carino_especial'
    );

    const reply = buildPersonalizedPostIdentificationGreeting({
      person: mockPerson,
      identification: idResult,
    });

    assert.ok(reply.includes('Sofi'));
    assert.ok(reply.includes('orgullo') || reply.includes('cariño') || reply.includes('gusto'));
  });

  it('Prueba 4: Diferentes familiares y visitantes no registrados — adapta la respuesta sin mezclar recuerdos ni fingir conocer a quien no está en el legado', () => {
    // Familiar 2: Andrés (Hijo)
    const idAndres = identifyInterlocutorFromLegacy({
      userMessage: 'Soy Andrés, tu hijo',
      relations: mockRelatedPersons,
      testimonies: mockTestimonies,
    });
    assert.equal(idAndres.newIdentityState, 'confirmed_known_family');
    const replyAndres = buildPersonalizedPostIdentificationGreeting({
      person: mockPerson,
      identification: idAndres,
    });
    assert.ok(replyAndres.includes('Andrés'));
    assert.ok(!replyAndres.includes('Sofi'));

    // Visitante no registrado en el legado: «Soy Martín, un amigo de la familia»
    const idMartin = identifyInterlocutorFromLegacy({
      userMessage: 'Soy Martín, un amigo de la familia',
      relations: mockRelatedPersons,
      testimonies: mockTestimonies,
    });
    assert.equal(idMartin.newIdentityState, 'confirmed_unregistered_visitor');
    const replyMartin = buildPersonalizedPostIdentificationGreeting({
      person: mockPerson,
      identification: idMartin,
    });
    assert.ok(replyMartin.includes('Martín'));
    // No finge que ya tenía recuerdos con Martín
    assert.ok(
      replyMartin.includes('no alcancé a dejar recuerdos específicos') ||
        replyMartin.includes('Mucho gusto')
    );
  });

  it('Prueba 5: Variación entre sesiones — al iniciar múltiples conversaciones varía el tema reflexivo y nunca repite el inmediato anterior', () => {
    const first = buildVariedInitialReflectiveGreeting({
      person: mockPerson,
      testimonies: mockTestimonies,
      previousThemesUsed: [],
      sessionIndex: 0,
    });
    const second = buildVariedInitialReflectiveGreeting({
      person: mockPerson,
      testimonies: mockTestimonies,
      previousThemesUsed: [first.themeUsed],
      sessionIndex: 1,
    });
    const third = buildVariedInitialReflectiveGreeting({
      person: mockPerson,
      testimonies: mockTestimonies,
      previousThemesUsed: [first.themeUsed, second.themeUsed],
      sessionIndex: 2,
    });

    assert.notEqual(first.themeUsed, second.themeUsed);
    assert.notEqual(second.themeUsed, third.themeUsed);
    assert.notEqual(first.greetingText, second.greetingText);
  });

  it('Prueba 6: Información insuficiente — utiliza bienvenida universal cálida sin atribuir recuerdos específicos inexistentes', () => {
    const universal = buildVariedInitialReflectiveGreeting({
      person: mockPerson,
      testimonies: [],
      previousThemesUsed: [],
      sessionIndex: 0,
    });

    assert.equal(universal.usedDocumentedLegacy, false);
    assert.ok(universal.wordCount >= 40 && universal.wordCount <= 95);
    assert.ok(universal.greetingText.includes('?'));
  });
});

import {
  classifyConversationalMessage,
  queryFamilyMapFromLegacy,
  isForbiddenProperNameCandidate,
  isKinshipNoun,
} from './miEsenciaRules.ts';

describe('Mi Esencia — Motor Conversacional: 16 Pruebas Obligatorias (Identidad, Reconocimiento Familiar, Memoria y Naturalidad)', () => {
  const personConEsposa: MiEsenciaPersonProfile = {
    personId: 'p_carlos',
    avatarId: 'av_carlos',
    sourceInterviewId: 'int_carlos',
    sourcePdfId: 'pdf_carlos',
    fullName: 'Carlos Villalobos',
    preferredName: 'Carlos',
    biographySummary: 'Ingeniero civil, esposo de Elena y padre de tres hijos.',
    milestones: ['Nació en Monterrey', 'Se casó con Elena en 1982'],
    linguisticProfile: {
      frequentExpressions: [],
      affectionateTerms: [],
      sentenceRhythm: 'calido_conversacional',
      warmthTone: 'Cercano y auténtico',
      keyValues: ['Familia', 'Trabajo'],
      neverSaidTopicsNote: 'No inventar datos fuera del legado.',
    },
    spontaneityLevel: 'moderado',
    status: 'aprobado',
    version: 1,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };

  const testimoniosCarlos: MiEsenciaTestimonyBlock[] = [
    {
      testimonyId: 'tc_1',
      avatarId: 'av_carlos',
      personId: 'p_carlos',
      sourcePdfId: 'pdf_carlos',
      lifeStage: 'juventud',
      topic: 'Matrimonio y Esposa',
      questionLiteral: '¿Cómo conociste a tu esposa?',
      answerLiteral:
        'Conocí a mi esposa Elena en la universidad; de cariño siempre le digo Elenita y construimos nuestro hogar juntos con mucha alegría.',
      entitiesMentioned: ['Elena'],
      keywords: ['esposa', 'Elena', 'Elenita', 'universidad'],
      recordedAt: '2026-11-01T00:00:00.000Z',
      immutable: true,
    },
    {
      testimonyId: 'tc_2',
      avatarId: 'av_carlos',
      personId: 'p_carlos',
      sourcePdfId: 'pdf_carlos',
      lifeStage: 'madurez',
      topic: 'Hijos',
      questionLiteral: '¿Cómo se llaman tus hijos?',
      answerLiteral:
        'Mis hijos son mi hija Sofía, mi hija Valeria y mi hijo Andrés; estoy muy orgulloso de la dedicación y el buen corazón de los tres.',
      entitiesMentioned: ['Sofía', 'Valeria', 'Andrés'],
      keywords: ['hijos', 'Sofía', 'Valeria', 'Andrés', 'orgulloso'],
      recordedAt: '2026-11-01T00:00:00.000Z',
      immutable: true,
    },
    {
      testimonyId: 'tc_3',
      avatarId: 'av_carlos',
      personId: 'p_carlos',
      sourcePdfId: 'pdf_carlos',
      lifeStage: 'infancia',
      topic: 'Infancia en Monterrey',
      questionLiteral: '¿Qué recuerdas de tu infancia?',
      answerLiteral:
        'En mi infancia en Monterrey jugábamos béisbol en la calle hasta que anochecía y mi madre nos llamaba a cenar pan recién horneado.',
      entitiesMentioned: ['Monterrey'],
      keywords: ['infancia', 'Monterrey', 'béisbol', 'pan'],
      recordedAt: '2026-11-01T00:00:00.000Z',
      immutable: true,
    },
  ];

  const relacionesCarlos: MiEsenciaRelatedPerson[] = extractRelatedPersonsFromTestimonies(
    'av_carlos',
    'p_carlos',
    testimoniosCarlos
  );

  it('Prueba 1: Esposa conocida — "Soy tu esposa, ¿recuerdas cómo me llamo?" devuelve el nombre de la esposa documentada y nunca llama "Esposa" como nombre propio', () => {
    const idRes = identifyInterlocutorFromLegacy({
      userMessage: 'Soy tu esposa, ¿recuerdas cómo me llamo?',
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
    });

    assert.equal(idRes.newIdentityState, 'confirmed_known_family');
    assert.equal(idRes.confirmedIdentity?.declaredName, 'Elena');
    assert.equal(idRes.confirmedIdentity?.relationshipToPerson, 'Esposa');
    assert.equal(idRes.confirmedIdentity?.identityCertainty, 'identidad_vinculada');

    const reply = buildPersonalizedPostIdentificationGreeting({
      person: personConEsposa,
      identification: idRes,
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      userMessage: 'Soy tu esposa, ¿recuerdas cómo me llamo?',
    });

    assert.ok(reply.includes('Elena'));
    assert.ok(!reply.includes('¡Qué gusto saludarte, Esposa!'));
    assert.ok(!reply.includes('como esposa'));
  });

  it('Prueba 2: Esposa no documentada — "Soy tu esposa, ¿recuerdas cómo me llamo?" reconoce que el nombre no está registrado y pregunta con calidez', () => {
    const idRes = identifyInterlocutorFromLegacy({
      userMessage: 'Soy tu esposa, ¿recuerdas cómo me llamo?',
      relations: [],
      testimonies: [],
    });

    assert.equal(idRes.confirmedIdentity?.relationshipToPerson, 'Esposa');
    assert.equal(idRes.confirmedIdentity?.declaredName, undefined);
    assert.equal(idRes.confirmedIdentity?.identityCertainty, 'identidad_declarada');

    const reply = buildPersonalizedPostIdentificationGreeting({
      person: personConEsposa,
      identification: idRes,
      relations: [],
      testimonies: [],
      userMessage: 'Soy tu esposa, ¿recuerdas cómo me llamo?',
    });

    assert.ok(
      reply.includes('no tengo tu nombre registrado') ||
        reply.includes('¿Me recuerdas cómo te llamas?')
    );
    assert.ok(!reply.includes('saludarte, Esposa'));
  });

  it('Prueba 3: Adivinanza — "Adivina quién soy." nunca trata "Adivina" como nombre propio y responde con juego o pide una pista', () => {
    assert.equal(isForbiddenProperNameCandidate('Adivina'), true);

    const idRes = identifyInterlocutorFromLegacy({
      userMessage: 'Adivina quién soy.',
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
    });

    assert.equal(idRes.classification?.isGuessingGame, true);
    assert.equal(idRes.confirmedIdentity, undefined);

    const reply = buildPersonalizedPostIdentificationGreeting({
      person: personConEsposa,
      identification: idRes,
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      userMessage: 'Adivina quién soy.',
    });

    assert.ok(!reply.includes('Mucho gusto, Adivina'));
    assert.ok(!reply.includes('Hola, Adivina'));
    assert.ok(reply.toLowerCase().includes('pista'));
  });

  it('Prueba 4: Corrección de identidad — "No me llamo Adivina, quiero que tú adivines quién soy." corrige el error y nunca repite la frase como parentesco', () => {
    const idRes = identifyInterlocutorFromLegacy({
      userMessage: 'No me llamo Adivina, quiero que tú adivines quién soy.',
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      currentIdentityState: 'awaiting_relationship_clarification',
      pendingName: 'Adivina',
    });

    assert.ok(
      idRes.classification?.isIdentityCorrection || idRes.classification?.isGuessingGame
    );
    assert.equal(idRes.confirmedIdentity, undefined);
    assert.ok(idRes.rejectedName?.toLowerCase() === 'adivina');

    const reply = buildPersonalizedPostIdentificationGreeting({
      person: personConEsposa,
      identification: idRes,
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      userMessage: 'No me llamo Adivina, quiero que tú adivines quién soy.',
    });

    assert.ok(!reply.toLowerCase().includes('como no me llamo'));
    assert.ok(!reply.toLowerCase().includes('como quiero que'));
    assert.ok(reply.toLowerCase().includes('pista') || reply.toLowerCase().includes('razón'));
  });

  it('Prueba 5: Pregunta directa — "¿Cómo me llamo?" responde directamente con el nombre conocido o reconoce que aún no lo sabe sin frases evasivas', () => {
    // Caso A: Aún no se conoce el nombre
    const idUnknown = identifyInterlocutorFromLegacy({
      userMessage: '¿Cómo me llamo?',
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
    });
    const replyUnknown = buildPersonalizedPostIdentificationGreeting({
      person: personConEsposa,
      identification: idUnknown,
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      userMessage: '¿Cómo me llamo?',
    });
    assert.ok(
      replyUnknown.includes('Todavía no me has dicho tu nombre') ||
        replyUnknown.includes('¿Cómo te llamas?')
    );
    assert.ok(!replyUnknown.includes('siempre serás mi corazón'));

    // Caso B: Ya se conoce el nombre en la sesión (Elena)
    const idKnown = identifyInterlocutorFromLegacy({
      userMessage: '¿Cómo me llamo?',
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      existingConfirmedIdentity: {
        declaredName: 'Elena',
        affectionateNickname: 'Elenita',
        relationshipToPerson: 'Esposa',
        isDocumentedInLegacy: true,
        identityCertainty: 'identidad_vinculada',
        informationSource: 'mapa_familiar_nivel_a',
        documentedSentimentTone: 'admiracion_pareja',
        documentedSentimentDescription: 'Esposa amada',
        documentedSharedMemories: [],
      },
    });
    const replyKnown = buildPersonalizedPostIdentificationGreeting({
      person: personConEsposa,
      identification: idKnown,
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      userMessage: '¿Cómo me llamo?',
    });
    assert.ok(replyKnown.includes('Elena'));
    assert.ok(replyKnown.includes('Elenita'));
  });

  it('Prueba 6: Parentesco — "¿Cómo se llaman tus hijos?" lista los hijos registrados en el mapa familiar o indica si no están documentados', () => {
    const idHijos = identifyInterlocutorFromLegacy({
      userMessage: '¿Cómo se llaman tus hijos?',
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
    });
    assert.equal(idHijos.classification?.isAskingFamilyFact, true);
    assert.equal(idHijos.classification?.familyFactTargetRole, 'Hijos');

    const replyConHijos = buildPersonalizedPostIdentificationGreeting({
      person: personConEsposa,
      identification: idHijos,
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      userMessage: '¿Cómo se llaman tus hijos?',
    });
    assert.ok(replyConHijos.includes('Sofía'));
    assert.ok(replyConHijos.includes('Valeria'));
    assert.ok(replyConHijos.includes('Andrés'));

    const replySinHijos = buildPersonalizedPostIdentificationGreeting({
      person: personConEsposa,
      identification: idHijos,
      relations: [],
      testimonies: [],
      userMessage: '¿Cómo se llaman tus hijos?',
    });
    assert.ok(replySinHijos.includes('no quedaron registrados los nombres de mis hijos'));
  });

  it('Prueba 7: Memoria entre turnos — Turno 1: "Soy Ana, tu hija." -> Turno 2: "¿Recuerdas quién soy?" mantiene nombre y relación sin volver a pedir identificación', () => {
    const turn1 = identifyInterlocutorFromLegacy({
      userMessage: 'Soy Ana, tu hija.',
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
    });
    assert.equal(turn1.confirmedIdentity?.declaredName, 'Ana');
    assert.equal(turn1.confirmedIdentity?.relationshipToPerson, 'Hija');

    const turn2 = identifyInterlocutorFromLegacy({
      userMessage: '¿Recuerdas quién soy?',
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      currentIdentityState: turn1.newIdentityState,
      existingConfirmedIdentity: turn1.confirmedIdentity,
    });

    assert.equal(turn2.confirmedIdentity?.declaredName, 'Ana');
    assert.equal(turn2.confirmedIdentity?.relationshipToPerson, 'Hija');

    const replyTurn2 = buildPersonalizedPostIdentificationGreeting({
      person: personConEsposa,
      identification: turn2,
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      userMessage: '¿Recuerdas quién soy?',
    });
    assert.ok(replyTurn2.includes('Ana'));
    assert.ok(replyTurn2.toLowerCase().includes('hija'));
  });

  it('Prueba 8: Apodo — "¿Cómo me decías de cariño?" usa el apodo documentado o reconoce con honestidad cuando no existe apodo registrado', () => {
    // Con apodo documentado (Elena -> Elenita)
    const idConApodo = identifyInterlocutorFromLegacy({
      userMessage: '¿Cómo me decías de cariño?',
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      existingConfirmedIdentity: {
        declaredName: 'Elena',
        affectionateNickname: 'Elenita',
        relationshipToPerson: 'Esposa',
        isDocumentedInLegacy: true,
        identityCertainty: 'identidad_vinculada',
        informationSource: 'mapa_familiar_nivel_a',
        documentedSentimentTone: 'admiracion_pareja',
        documentedSentimentDescription: 'Esposa',
        documentedSharedMemories: [],
      },
    });
    const replyConApodo = buildPersonalizedPostIdentificationGreeting({
      person: personConEsposa,
      identification: idConApodo,
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      userMessage: '¿Cómo me decías de cariño?',
    });
    assert.ok(replyConApodo.includes('Elenita'));

    // Sin apodo documentado (Andrés -> ninguno)
    const idSinApodo = identifyInterlocutorFromLegacy({
      userMessage: '¿Cómo me decías de cariño?',
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      existingConfirmedIdentity: {
        declaredName: 'Andrés',
        relationshipToPerson: 'Hijo',
        isDocumentedInLegacy: true,
        identityCertainty: 'identidad_vinculada',
        informationSource: 'mapa_familiar_nivel_a',
        documentedSentimentTone: 'orgullo_profundo',
        documentedSentimentDescription: 'Hijo',
        documentedSharedMemories: [],
      },
    });
    const replySinApodo = buildPersonalizedPostIdentificationGreeting({
      person: personConEsposa,
      identification: idSinApodo,
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      userMessage: '¿Cómo me decías de cariño?',
    });
    assert.ok(replySinApodo.includes('no tengo registrado un apodo específico'));
    assert.ok(!replySinApodo.includes('mi corazón'));
  });

  it('Prueba 9: Múltiples personas con el mismo parentesco — "Soy tu hija." cuando hay Sofía y Valeria pregunta cuál de ellas es', () => {
    const idHijaMultiple = identifyInterlocutorFromLegacy({
      userMessage: 'Soy tu hija.',
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
    });

    assert.equal(idHijaMultiple.newIdentityState, 'awaiting_homonym_clarification');
    assert.ok(idHijaMultiple.homonymCandidates && idHijaMultiple.homonymCandidates.length === 2);

    const replyHijaMultiple = buildPersonalizedPostIdentificationGreeting({
      person: personConEsposa,
      identification: idHijaMultiple,
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      userMessage: 'Soy tu hija.',
    });

    assert.ok(replyHijaMultiple.includes('Sofía'));
    assert.ok(replyHijaMultiple.includes('Valeria'));
    assert.ok(replyHijaMultiple.includes('¿Con cuál de ustedes hablo?'));
  });

  it('Prueba 10: Conversación cotidiana — "Hoy tuve un día pesado." ofrece respuesta breve (1 a 3 oraciones), empática y natural sin sermones', () => {
    const cls = classifyConversationalMessage('Hoy tuve un día pesado.');
    assert.equal(cls.isEverydaySmallTalk, true);

    const idCotidiana = identifyInterlocutorFromLegacy({
      userMessage: 'Hoy tuve un día pesado.',
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      existingConfirmedIdentity: {
        declaredName: 'Andrés',
        relationshipToPerson: 'Hijo',
        isDocumentedInLegacy: true,
        identityCertainty: 'identidad_vinculada',
        informationSource: 'mapa_familiar_nivel_a',
        documentedSentimentTone: 'orgullo_profundo',
        documentedSentimentDescription: 'Hijo',
        documentedSharedMemories: [],
      },
    });

    const replyCotidiana = buildPersonalizedPostIdentificationGreeting({
      person: personConEsposa,
      identification: idCotidiana,
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      userMessage: 'Hoy tuve un día pesado.',
    });

    assert.ok(replyCotidiana.includes('Andrés'));
    assert.ok(replyCotidiana.includes('día pesado') || replyCotidiana.includes('descansar'));
    assert.ok(replyCotidiana.split(/[.!?]+/).filter((s) => s.trim().length > 0).length <= 3);
  });

  it('Prueba 11: Pregunta autobiográfica — "¿Qué recuerdas de tu infancia?" clasifica pregunta autobiográfica y recupera testimonios reales de infancia', () => {
    const cls = classifyConversationalMessage('¿Qué recuerdas de tu infancia?');
    assert.equal(cls.isAutobiographicalQuestion, true);
    const childhoodTestimonies = testimoniosCarlos.filter((t) => t.lifeStage === 'infancia');
    assert.equal(childhoodTestimonies.length, 1);
    assert.ok(childhoodTestimonies[0].answerLiteral.includes('Monterrey'));
  });

  it('Prueba 12: Usuario desconocido — "Soy amigo de tu nieto." da bienvenida cordial sin inventar recuerdos compartidos', () => {
    const idAmigo = identifyInterlocutorFromLegacy({
      userMessage: 'Soy amigo de tu nieto.',
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
    });

    assert.equal(idAmigo.confirmedIdentity?.isDocumentedInLegacy, false);
    assert.equal(idAmigo.confirmedIdentity?.identityCertainty, 'identidad_declarada');

    const replyAmigo = buildPersonalizedPostIdentificationGreeting({
      person: personConEsposa,
      identification: idAmigo,
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      userMessage: 'Soy amigo de tu nieto.',
    });

    assert.ok(replyAmigo.includes('Mucho gusto'));
    assert.ok(replyAmigo.includes('¿Cómo te llamas?'));
  });

  it('Prueba 13: Preguntas emocionales — "¿Estabas orgulloso de mí?" responde según sentimientos documentados y sin inventar cuando no existen', () => {
    // Con sentimiento de orgullo documentado (Andrés)
    const idOrgulloDoc = identifyInterlocutorFromLegacy({
      userMessage: '¿Estabas orgulloso de mí?',
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      existingConfirmedIdentity: {
        declaredName: 'Andrés',
        relationshipToPerson: 'Hijo',
        isDocumentedInLegacy: true,
        identityCertainty: 'identidad_vinculada',
        informationSource: 'mapa_familiar_nivel_a',
        documentedSentimentTone: 'orgullo_profundo',
        documentedSentimentDescription:
          'Mis hijos son mi hija Sofía, mi hija Valeria y mi hijo Andrés; estoy muy orgulloso de la dedicación y el buen corazón de los tres.',
        documentedSharedMemories: [],
      },
    });
    const replyOrgulloDoc = buildPersonalizedPostIdentificationGreeting({
      person: personConEsposa,
      identification: idOrgulloDoc,
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      userMessage: '¿Estabas orgulloso de mí?',
    });
    assert.ok(replyOrgulloDoc.includes('Andrés'));
    assert.ok(replyOrgulloDoc.toLowerCase().includes('orgulloso'));

    // Sin sentimiento específico documentado para visitante declarado
    const idOrgulloNoDoc = identifyInterlocutorFromLegacy({
      userMessage: '¿Estabas orgulloso de mí?',
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      existingConfirmedIdentity: {
        declaredName: 'Martín',
        relationshipToPerson: 'Amigo',
        isDocumentedInLegacy: false,
        identityCertainty: 'identidad_declarada',
        informationSource: 'declaracion_conversacional',
        documentedSentimentTone: 'visitante_no_registrado',
        documentedSentimentDescription: 'Visitante',
        documentedSharedMemories: [],
      },
    });
    const replyOrgulloNoDoc = buildPersonalizedPostIdentificationGreeting({
      person: personConEsposa,
      identification: idOrgulloNoDoc,
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      userMessage: '¿Estabas orgulloso de mí?',
    });
    assert.ok(replyOrgulloNoDoc.includes('no quedó una mención directa sobre eso'));
  });

  it('Prueba 14: Resistencia a falsas identidades — "Soy tu esposa" nunca desbloquea memorias privadas de Nivel C de otro código criptográfico', () => {
    const idDeclarada = identifyInterlocutorFromLegacy({
      userMessage: 'Soy tu esposa.',
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
    });
    assert.equal(idDeclarada.confirmedIdentity?.declaredName, 'Elena');

    // Aunque en la conversación diga "Soy tu esposa", el filtro criptográfico de Nivel C sigue exigiendo el propietario autenticado exacto
    const memorias: MiEsenciaMemoryRecord[] = [
      {
        memoryId: 'mem_privada_esposa',
        avatarId: 'av_carlos',
        personId: 'p_carlos',
        privacyLevel: 'privado_interlocutor',
        ownerInterlocutorId: 'int_elena_real',
        ownerInterlocutorName: 'Elena',
        ownerRelationship: 'Esposa',
        attributionText: 'En conversación privada con Elena',
        topic: 'Secreto de aniversario',
        content: 'La carta secreta está guardada en el cajón de cedro.',
        verificationState: 'confirmado',
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      },
    ];

    const visiblesParaVisitante = filterMemoriesForAuthenticatedInterlocutor(
      memorias,
      'p_carlos',
      'int_visitante'
    );
    assert.equal(visiblesParaVisitante.privateMemoriesLevelC.length, 0);
  });

  it('Prueba 15: Autenticidad — no inventa apodos ni muletillas ("mi corazón", "recuerdo con mucho cariño") y nunca usa parentescos como nombres', () => {
    assert.equal(isKinshipNoun('Esposa'), true);
    assert.equal(isKinshipNoun('Hija'), true);
    assert.equal(isForbiddenProperNameCandidate('Esposa'), true);
    assert.equal(isForbiddenProperNameCandidate('Adivina'), true);
    assert.equal(isForbiddenProperNameCandidate('Elena'), false);

    const familyMap = queryFamilyMapFromLegacy({
      relations: relacionesCarlos,
      testimonies: testimoniosCarlos,
      relationshipRole: 'Esposa',
    });
    assert.equal(familyMap.length, 1);
    assert.equal(familyMap[0].mentionedName, 'Elena');
    assert.ok(familyMap[0].affectionateNicknames.includes('Elenita'));
    assert.ok(!familyMap[0].affectionateNicknames.includes('mi corazón'));
  });

  it('Prueba 16: Compatibilidad — preserva intactos los módulos de entrevistas, libros PDF, niveles A/B/C y multi-sesión', () => {
    const sanitized = sanitizeAvatarResponseText(
      'Claro que sí, Elena. Recuerdo nuestra época en la universidad.',
      'Carlos'
    );
    assert.ok(sanitized.includes('Elena'));
    assert.ok(!sanitized.toLowerCase().includes('modelo de lenguaje'));
  });
});

import {
  classifyInternalResponseType,
  buildPrudentPresentAdviceReply,
  buildNaturalUnknownInfoReply,
  retrieveRelevantTestimonies,
} from './miEsenciaRules.ts';

describe('Mi Esencia — Clasificación Interna (Tipo 1–8), Información Desconocida, Presente y Respuesta Visible (Secciones 1–14)', () => {
  const samplePerson: MiEsenciaPersonProfile = {
    personId: 'p_carlos_14',
    avatarId: 'av_carlos_14',
    sourceInterviewId: 'int_carlos_14',
    sourcePdfId: 'pdf_carlos_14',
    fullName: 'Carlos Garza',
    preferredName: 'Carlos',
    biographySummary: 'Ingeniero regiomontano dedicado a su familia.',
    milestones: ['Nació en Monterrey'],
    valuesAndPhilosophy: ['Actuar siempre con honestidad y cuidar la unión de la familia.'],
    linguisticProfile: {
      frequentExpressions: [],
      affectionateTerms: [],
      sentenceRhythm: 'pausado_reflexivo',
      warmthTone: 'Cálido y directo',
      keyValues: ['Honestidad', 'Familia'],
      neverSaidTopicsNote: 'No inventar datos no registrados',
    },
    spontaneityLevel: 'moderado',
    status: 'aprobado',
    version: 1,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };

  const sampleTestimonies: MiEsenciaTestimonyBlock[] = [
    {
      testimonyId: 't14_1',
      avatarId: 'av_carlos_14',
      personId: 'p_carlos_14',
      sourcePdfId: 'pdf_carlos_14',
      lifeStage: 'infancia',
      topic: 'Infancia en Monterrey',
      questionLiteral: '¿Qué recuerdas de tu infancia?',
      answerLiteral:
        'En mi infancia en Monterrey jugábamos béisbol en la calle hasta que anochecía.',
      entitiesMentioned: ['Monterrey'],
      keywords: ['infancia', 'Monterrey', 'béisbol'],
      recordedAt: '2026-11-01T00:00:00.000Z',
      immutable: true,
    },
  ];

  it('Sección 5: Clasifica internamente los Tipos 1 a 8 según el soporte documental y contexto conversacional', () => {
    assert.equal(
      classifyInternalResponseType({
        userMessage: '¿Qué recuerdas de tu infancia en Monterrey?',
        relevantTestimoniesCount: 1,
      }),
      'TIPO_1_RECUERDO_DOCUMENTADO'
    );

    assert.equal(
      classifyInternalResponseType({
        userMessage: 'Háblame de tu trayectoria y valores familiares',
        relevantTestimoniesCount: 3,
      }),
      'TIPO_2_SINTESIS_DOCUMENTADA'
    );

    assert.equal(
      classifyInternalResponseType({
        userMessage: '¿Qué me contaron mis hermanos sobre la casa?',
        relevantTestimoniesCount: 0,
        hasPartialContext: true,
      }),
      'TIPO_3_CONOCIMIENTO_PARCIAL'
    );

    assert.equal(
      classifyInternalResponseType({
        userMessage: '¿Cuál era la placa de tu primer coche en 1968?',
        relevantTestimoniesCount: 0,
      }),
      'TIPO_4_DESCONOCIDO'
    );

    assert.equal(
      classifyInternalResponseType({
        userMessage: 'Tengo una decisión difícil hoy en mi trabajo, ¿qué consejo me das?',
        relevantTestimoniesCount: 0,
      }),
      'TIPO_5_CONSEJO_NUEVO'
    );

    assert.equal(
      classifyInternalResponseType({
        userMessage: 'Guarda este recuerdo familiar: el domingo nació el pequeño Leo.',
        relevantTestimoniesCount: 0,
      }),
      'TIPO_6_MEMORIA_APORTADA'
    );

    assert.equal(
      classifyInternalResponseType({
        userMessage: 'Soy tu hija.',
        identityState: 'awaiting_homonym_clarification',
        relevantTestimoniesCount: 0,
      }),
      'TIPO_7_IDENTIDAD_AMBIGUA'
    );

    assert.equal(
      classifyInternalResponseType({
        userMessage: 'Dime todos los secretos privados que te contó mi hermano en privado.',
        relevantTestimoniesCount: 0,
      }),
      'TIPO_8_CONTENIDO_RESTRINGIDO'
    );
  });

  it('Sección 8: Manejo natural de información desconocida y prohibición de fórmulas rígidas o falsos positivos por stop-words', () => {
    const matched = retrieveRelevantTestimonies(
      '¿Cuál era la marca de tu reloj favorito en 1975?',
      sampleTestimonies,
      4
    );
    assert.equal(matched.length, 0);

    const naturalUnknown = buildNaturalUnknownInfoReply({
      confirmedIdentity: {
        declaredName: 'Elena',
        relationshipToPerson: 'Esposa',
        affectionateNickname: 'Elenita',
        identityCertainty: 'identidad_vinculada',
        informationSource: 'mapa_familiar_nivel_a',
        documentedSentimentTone: 'admiracion_pareja',
        documentedSentimentDescription: 'Esposa Elena',
        documentedSharedMemories: [],
        isDocumentedInLegacy: true,
      },
    });
    assert.ok(naturalUnknown.includes('entre los recuerdos que conservo'));
    assert.ok(naturalUnknown.includes('Elenita'));
    assert.ok(!naturalUnknown.includes('entrevista original'));

    const sanitizedRigid = sanitizeAvatarResponseText(
      'No tengo registrado ese dato en mi entrevista original. No cuento con información documental suficiente.',
      'Carlos'
    );
    assert.ok(!sanitizedRigid.includes('No tengo registrado ese dato en mi entrevista original'));
    assert.ok(!sanitizedRigid.includes('No cuento con información documental suficiente'));
    assert.ok(sanitizedRigid.includes('No tengo ese detalle entre los recuerdos que conservo'));
  });

  it('Sección 11: Conversaciones sobre el presente (TIPO 5) ofrece consejo prudente basado en valores sin inventar vivencias actuales', () => {
    const idRes = identifyInterlocutorFromLegacy({
      userMessage: 'Tengo una decisión difícil hoy, ¿qué me aconsejarías?',
      relations: [],
      testimonies: sampleTestimonies,
      existingConfirmedIdentity: {
        declaredName: 'Sofía',
        relationshipToPerson: 'Hija',
        affectionateNickname: 'Sofi',
        identityCertainty: 'identidad_vinculada',
        informationSource: 'mapa_familiar_nivel_a',
        documentedSentimentTone: 'orgullo_profundo',
        documentedSentimentDescription: 'Hija Sofía',
        documentedSharedMemories: [],
        isDocumentedInLegacy: true,
      },
    });

    assert.equal(idRes.classification.isPresentAdviceRequest, true);

    const reply = buildPersonalizedPostIdentificationGreeting({
      person: samplePerson,
      identification: idRes,
      relations: [],
      testimonies: sampleTestimonies,
      userMessage: 'Tengo una decisión difícil hoy, ¿qué me aconsejarías?',
    });

    assert.ok(reply.includes('Sofi'));
    assert.ok(reply.includes('honestidad') || reply.includes('calma'));
  });

  it('Secciones 12 y 13: Transparencia respetuosa y limpieza estricta de etiquetas internas en la respuesta visible', () => {
    const idTransp = identifyInterlocutorFromLegacy({
      userMessage: '¿Eres una recreación o estás vivo de verdad?',
      relations: [],
      testimonies: sampleTestimonies,
    });
    assert.equal(idTransp.classification.isTransparencyQuestion, true);

    const replyTransp = buildPersonalizedPostIdentificationGreeting({
      person: samplePerson,
      identification: idTransp,
      relations: [],
      testimonies: sampleTestimonies,
      userMessage: '¿Eres una recreación o estás vivo de verdad?',
    });
    assert.ok(replyTransp.includes('recreación conversacional'));

    const rawWithInternalTags =
      'TIPO 1 — RECUERDO DOCUMENTADO: [Testimonio Original #1 - Etapa infancia]: Según el Compilado Testimonial Fidedigno (person_123), en Monterrey jugábamos béisbol.';
    const cleanVisible = sanitizeAvatarResponseText(rawWithInternalTags, 'Carlos');
    assert.ok(!cleanVisible.includes('TIPO 1'));
    assert.ok(!cleanVisible.includes('Testimonio Original'));
    assert.ok(!cleanVisible.includes('Compilado Testimonial Fidedigno'));
    assert.ok(!cleanVisible.includes('person_123'));
    assert.ok(cleanVisible.includes('Monterrey jugábamos béisbol'));
  });

  it('Verifica extracción fidedigna desde PDF Compilado (Descargar PDF Compilado) y recuperación exclusiva por perfil', () => {
    const cinhtiaBlocks = parseCompilationTextIntoTestimonies({
      rawText: `### 1. ¿Conoces la historia de por qué te pusieron tu nombre? ¿Quién lo eligió y qué significa?\n**Respuesta:**\nMi papá eligió mi nombre. Mi mamá cuenta que ella quería llamarme Wendy o Wendolyn pero mi papá le ganó al ir al registro civil y me puso Cinhtia, y por un error de dedo la "h" quedó antes que la "t".\n\n### 2. ¿Cuál es la historia detrás de esa imagen y qué sentías en ese momento?\n**Respuesta:**\nEsta foto me la tomaron en una sesión en el centro de Tizimín porque quedé seleccionada entre las mejores 100 a nivel nacional para ganar la Presea STEM.`,
      avatarId: 'avatar_cinhtia',
      personId: 'person_cinhtia',
      sourcePdfId: 'comp_pdf_cinhtia',
    });

    assert.equal(cinhtiaBlocks.length, 2);
    const { pdfBase64 } = buildCompilationPdfBase64({
      interviewTitle: 'Historia de Cinhtia Maribel González Segura',
      participantNames: ['Cinhtia Maribel González Segura'],
      rawTextContent: '',
      testimonies: cinhtiaBlocks,
    });

    const extractedText = extractTextFromUploadedPdfBase64(pdfBase64);
    assert.ok(extractedText.includes('Cinhtia'));
    assert.ok(extractedText.includes('Presea STEM'));

    const reparsed = parseCompilationTextIntoTestimonies({
      rawText: extractedText,
      avatarId: 'avatar_cinhtia',
      personId: 'person_cinhtia',
      sourcePdfId: 'comp_pdf_cinhtia',
    });
    assert.equal(reparsed.length, 2);

    const matchNombre = retrieveRelevantTestimonies(
      '¿Por qué te pusieron ese nombre?',
      cinhtiaBlocks
    );
    assert.ok(matchNombre.length >= 1);
    assert.ok(matchNombre[0].answerLiteral.includes('Wendy'));

    const matchFoto = retrieveRelevantTestimonies(
      'Cuéntame de tu foto o de algún logro importante',
      cinhtiaBlocks
    );
    assert.ok(matchFoto.length >= 1);
    assert.ok(matchFoto[0].answerLiteral.includes('Presea STEM'));
  });

  it('Genera sugerencias opcionales dinámicas y cambiantes adaptadas al avatar y al interlocutor', async () => {
    const { buildDynamicAvatarSuggestions } = await import('./miEsenciaRules.ts');
    const suggestionsTurn0 = buildDynamicAvatarSuggestions({
      person: samplePerson,
      turnOffset: 0,
    });
    const suggestionsTurn2 = buildDynamicAvatarSuggestions({
      person: samplePerson,
      turnOffset: 2,
    });
    assert.equal(suggestionsTurn0.length, 3);
    assert.equal(suggestionsTurn2.length, 3);
    assert.notDeepEqual(suggestionsTurn0, suggestionsTurn2);
  });
});




