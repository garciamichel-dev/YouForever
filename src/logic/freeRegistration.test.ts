import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_MANUAL_PDF_URL,
  CANONICAL_PORTAL_URL,
  CANONICAL_PUBLIC_ORIGIN,
  FREE_SELF_REGISTER_EXPLANATION,
  buildCanonicalPublicUrl,
  buildDefaultStoryTitle,
  buildSelfRegisterWelcomeEmail,
  isValidEmailAddress,
  normalizeCanonicalPublicOrigin,
  validateAdminRegistrationUpdates,
  validateFreeRegistrationPayload,
} from './freeRegistration.ts';
import {
  getEmailConfigStatus,
  sendSelfRegisterParticipantEmail,
} from '../server/emailService.ts';

test('1. Explicación obligatoria de /free, dominio canónico sin www y validación de correo', () => {
  assert.match(
    FREE_SELF_REGISTER_EXPLANATION,
    /YouForever te guía para contar tu historia de vida por voz o por escrito, incorporar fotografías y crear un libro autobiográfico\. Registrarte y realizar tu entrevista, ahora y para ti, es gratuito\./
  );

  assert.equal(CANONICAL_PUBLIC_ORIGIN, 'https://youforever.app');
  assert.equal(CANONICAL_MANUAL_PDF_URL, 'https://youforever.app/api/public/manual-pdf');
  assert.equal(CANONICAL_PORTAL_URL, 'https://youforever.app/');

  assert.equal(normalizeCanonicalPublicOrigin('https://www.youforever.app/'), 'https://youforever.app');
  assert.equal(normalizeCanonicalPublicOrigin('http://localhost:3000'), 'https://youforever.app');
  assert.equal(normalizeCanonicalPublicOrigin('https://ais-dev-xyz.run.app'), 'https://youforever.app');
  assert.equal(
    buildCanonicalPublicUrl('/interview?token=abc123', 'https://www.youforever.app'),
    'https://youforever.app/interview?token=abc123'
  );
  assert.equal(
    buildCanonicalPublicUrl('api/public/manual-pdf'),
    'https://youforever.app/api/public/manual-pdf'
  );

  assert.equal(isValidEmailAddress('ana@ejemplo.com'), true);
  assert.equal(isValidEmailAddress('  carlos.lopez+familia@dominio.mx '), true);
  assert.equal(isValidEmailAddress('correo-invalido'), false);
  assert.equal(isValidEmailAddress('sin@dominio'), false);
});

test('2. Validación de autorregistro individual en /free', () => {
  // Missing privacy consent
  const noPrivacy = validateFreeRegistrationPayload({
    storyMode: 'individual',
    privacyAccepted: false,
    participants: [
      { name: 'Laura Mendoza', email: 'laura@ejemplo.com', age: 62, city: 'Guadalajara' },
    ],
  });
  assert.equal(noPrivacy.valid, false);
  assert.match(noPrivacy.error || '', /Aviso de Privacidad/);

  // Invalid age
  const badAge = validateFreeRegistrationPayload({
    storyMode: 'individual',
    privacyAccepted: true,
    participants: [
      { name: 'Laura Mendoza', email: 'laura@ejemplo.com', age: '0', city: 'Guadalajara' },
    ],
  });
  assert.equal(badAge.valid, false);
  assert.match(badAge.error || '', /edad válida/);

  // Missing city
  const noCity = validateFreeRegistrationPayload({
    storyMode: 'individual',
    privacyAccepted: true,
    participants: [
      { name: 'Laura Mendoza', email: 'laura@ejemplo.com', age: 62, city: ' ' },
    ],
  });
  assert.equal(noCity.valid, false);
  assert.match(noCity.error || '', /ciudad/);

  // Valid individual registration generates normalized record & default title
  const valid = validateFreeRegistrationPayload({
    storyMode: 'individual',
    privacyAccepted: true,
    participants: [
      { name: '  Laura Mendoza ', email: 'LAURA@Ejemplo.com ', age: '62', city: ' Guadalajara ' },
    ],
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.normalized?.storyMode, 'individual');
  assert.equal(valid.normalized?.storyTitle, 'Historia de Vida de Laura Mendoza');
  assert.equal(valid.normalized?.participants.length, 1);
  assert.equal(valid.normalized?.participants[0].email, 'laura@ejemplo.com');
  assert.equal(valid.normalized?.participants[0].age, 62);
  assert.equal(valid.normalized?.participants[0].city, 'Guadalajara');
  assert.equal(valid.normalized?.participants[0].role, 'primary');
});

test('3. Validación de autorregistro compartido (2 o más participantes, correos distintos)', () => {
  // Rejects shared with < 2 participants
  const onlyOne = validateFreeRegistrationPayload({
    storyMode: 'compartida',
    privacyAccepted: true,
    participants: [
      { name: 'Pedro Gómez', email: 'pedro@ejemplo.com', age: 70, city: 'Monterrey' },
    ],
  });
  assert.equal(onlyOne.valid, false);
  assert.match(onlyOne.error || '', /al menos 2 participantes/);

  // Rejects duplicate email across shared participants
  const dupEmail = validateFreeRegistrationPayload({
    storyMode: 'compartida',
    privacyAccepted: true,
    participants: [
      { name: 'Pedro Gómez', email: 'pedro@ejemplo.com', age: 70, city: 'Monterrey' },
      { name: 'Marta Gómez', email: 'PEDRO@ejemplo.com', age: 68, city: 'Monterrey', relationship: 'Esposa' },
    ],
  });
  assert.equal(dupEmail.valid, false);
  assert.match(dupEmail.error || '', /repetido/);

  // Valid 3-participant shared interview preserves relationships & custom storyTitle
  const validShared = validateFreeRegistrationPayload({
    storyMode: 'compartida',
    storyTitle: 'Crónica de los Gómez',
    privacyAccepted: true,
    participants: [
      { name: 'Pedro Gómez', email: 'pedro@ejemplo.com', age: 70, city: 'Monterrey', relationship: 'Padre' },
      { name: 'Marta Gómez', email: 'marta@ejemplo.com', age: 68, city: 'Monterrey', relationship: 'Madre', role: 'contributor' },
      { name: 'Sofía Gómez', email: 'sofia@ejemplo.com', age: 40, city: 'CDMX', relationship: 'Hija', role: 'contributor' },
    ],
  });
  assert.equal(validShared.valid, true);
  assert.equal(validShared.normalized?.storyTitle, 'Crónica de los Gómez');
  assert.equal(validShared.normalized?.participants.length, 3);
  assert.equal(validShared.normalized?.participants[0].role, 'primary');
  assert.equal(validShared.normalized?.participants[1].relationship, 'Madre');
  assert.equal(validShared.normalized?.participants[2].city, 'CDMX');

  assert.equal(
    buildDefaultStoryTitle('compartida', [{ name: 'Ana' }, { name: 'Luis' }]),
    'Historia Compartida de Ana y Luis'
  );
  assert.equal(
    buildDefaultStoryTitle('compartida', [{ name: 'Ana' }, { name: 'Luis' }, { name: 'Rosa' }]),
    'Historia Compartida de Ana y Familia'
  );
});

test('4. Validación administrativa de «Datos de registro» (incluyendo fichas previas sin edad/ciudad/correo)', () => {
  // Legacy records can leave uncaptured email/age/city blank
  const legacyValid = validateAdminRegistrationUpdates({
    interviewTitle: 'Historia Previa de Don Arturo',
    participants: [
      {
        participantId: 'part_legacy_1',
        name: 'Arturo Jiménez',
        email: '',
        age: null,
        city: '',
        relationship: 'Titular',
        role: 'primary',
      },
    ],
  });
  assert.equal(legacyValid.valid, true);
  assert.equal(legacyValid.participants?.[0].email, '');
  assert.equal(legacyValid.participants?.[0].age, null);
  assert.equal(legacyValid.participants?.[0].city, '');

  // Invalid email rejected
  const badEmail = validateAdminRegistrationUpdates({
    interviewTitle: 'Historia',
    participants: [
      {
        participantId: 'part_1',
        name: 'Arturo Jiménez',
        email: 'no-es-correo',
        age: 75,
        city: 'Puebla',
      },
    ],
  });
  assert.equal(badEmail.valid, false);
  assert.match(badEmail.error || '', /no tiene un formato válido/);

  // Empty title rejected
  const emptyTitle = validateAdminRegistrationUpdates({
    interviewTitle: '   ',
    participants: [{ participantId: 'part_1', name: 'Arturo' }],
  });
  assert.equal(emptyTitle.valid, false);
  assert.match(emptyTitle.error || '', /título/);
});

test('5. Correo de bienvenida usa https://youforever.app sin www y diseño transaccional anti-spam', () => {
  const email = buildSelfRegisterWelcomeEmail({
    participantName: 'Elena Morales',
    interviewTitle: 'Memorias de Elena Morales',
    storyMode: 'individual',
    role: 'primary',
    accessCode: 'YF-9K3P2',
    directUrl: 'https://www.youforever.app/interview?token=tok_abc123',
    manualPdfUrl: 'https://www.youforever.app/api/public/manual-pdf',
    portalUrl: 'https://www.youforever.app/',
    expiresAtIso: '2026-12-01T00:00:00.000Z',
  });

  assert.doesNotMatch(email.text, /www\.youforever\.app/);
  assert.doesNotMatch(email.html, /www\.youforever\.app/);
  assert.match(email.subject, /Memorias de Elena Morales/);
  assert.match(email.text, /YF-9K3P2/);
  assert.match(email.text, /https:\/\/youforever\.app\/interview\?token=tok_abc123/);
  assert.match(email.text, /https:\/\/youforever\.app\/api\/public\/manual-pdf/);
  assert.match(email.text, /youforever\.team@gmail\.com/);
  assert.match(email.html, /YF-9K3P2/);
  assert.match(email.html, /https:\/\/youforever\.app\/interview\?token=tok_abc123/);
  assert.match(email.html, /https:\/\/youforever\.app\/api\/public\/manual-pdf/);
});

test('6. Servicio SMTP server-side normaliza URLs a https://youforever.app, conserva formato y maneja errores sin excepciones', async () => {
  const prevPass = process.env.SMTP_PASS;
  const prevAppPass = process.env.GMAIL_APP_PASSWORD;

  try {
    delete process.env.SMTP_PASS;
    delete process.env.GMAIL_APP_PASSWORD;

    const statusMissing = getEmailConfigStatus();
    assert.equal(statusMissing.configured, false);
    assert.equal(statusMissing.user, 'youforever.team@gmail.com');

    const failMissingPass = await sendSelfRegisterParticipantEmail({
      participantId: 'p_1',
      participantName: 'Elena Morales',
      recipientEmail: 'elena@ejemplo.com',
      interviewTitle: 'Memorias de Elena',
      storyMode: 'individual',
      role: 'primary',
      accessCode: 'YF-111AA',
      directUrl: 'https://youforever.app/interview?token=abc',
      manualPdfUrl: 'https://youforever.app/api/public/manual-pdf',
      portalUrl: 'https://youforever.app/',
      expiresAtIso: new Date(Date.now() + 86400000).toISOString(),
    });
    assert.equal(failMissingPass.sent, false);
    assert.match(failMissingPass.error || '', /SMTP_PASS/);

    // Simulated SMTP rejection (e.g. network or auth failure) returns clean failure without throwing
    const failTransport = await sendSelfRegisterParticipantEmail({
      participantId: 'p_2',
      participantName: 'Carlos Ruiz',
      recipientEmail: 'carlos@ejemplo.com',
      interviewTitle: 'Historia de Carlos',
      storyMode: 'compartida',
      role: 'contributor',
      accessCode: 'YF-222BB',
      directUrl: 'https://youforever.app/interview?token=def',
      manualPdfUrl: 'https://youforever.app/api/public/manual-pdf',
      portalUrl: 'https://youforever.app/',
      expiresAtIso: new Date(Date.now() + 86400000).toISOString(),
      transporterOverride: {
        sendMail: async () => {
          throw new Error('535 5.7.8 Username and Password not accepted');
        },
      },
    });
    assert.equal(failTransport.sent, false);
    assert.match(failTransport.error || '', /535/);

    // Simulated SMTP success captures non-www URLs, preserved HTML/text format, and clean headers
    let capturedTo = '';
    let capturedText = '';
    let capturedHtml = '';
    let capturedHeader = '';
    const okTransport = await sendSelfRegisterParticipantEmail({
      participantId: 'p_3',
      participantName: 'Elena Morales',
      recipientEmail: 'elena@ejemplo.com',
      interviewTitle: 'Memorias de Elena',
      storyMode: 'individual',
      role: 'primary',
      accessCode: 'YF-333CC',
      directUrl: 'https://www.youforever.app/interview?token=ghi',
      manualPdfUrl: 'https://www.youforever.app/api/public/manual-pdf',
      portalUrl: 'https://www.youforever.app/',
      expiresAtIso: new Date(Date.now() + 86400000).toISOString(),
      transporterOverride: {
        sendMail: async (mailOptions) => {
          capturedTo = mailOptions.to;
          capturedText = mailOptions.text;
          capturedHtml = mailOptions.html;
          capturedHeader = mailOptions.headers?.['X-Auto-Response-Suppress'] || '';
          return { messageId: '<msg-ok-123@gmail.com>' };
        },
      },
    });
    assert.equal(okTransport.sent, true);
    assert.equal(okTransport.messageId, '<msg-ok-123@gmail.com>');
    assert.equal(capturedTo, 'elena@ejemplo.com');
    assert.doesNotMatch(capturedText, /www\.youforever\.app/);
    assert.doesNotMatch(capturedHtml, /www\.youforever\.app/);
    assert.match(capturedText, /https:\/\/youforever\.app\/interview\?token=ghi/);
    assert.match(capturedText, /https:\/\/youforever\.app\/api\/public\/manual-pdf/);
    assert.match(capturedHtml, /Entrar directo a mi entrevista/);
    assert.match(capturedHtml, /Descargar Manual en PDF/);
    assert.equal(capturedHeader, 'OOF, AutoReply');
  } finally {
    if (prevPass !== undefined) process.env.SMTP_PASS = prevPass;
    else delete process.env.SMTP_PASS;
    if (prevAppPass !== undefined) process.env.GMAIL_APP_PASSWORD = prevAppPass;
    else delete process.env.GMAIL_APP_PASSWORD;
  }
});
