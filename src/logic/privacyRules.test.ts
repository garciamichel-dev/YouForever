import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConsentDeclarationText,
  computeSha256,
  validateConsentSubmission,
  isConsentValid,
  validateBookShare,
  PrivacyConsentRecord,
} from './privacyRules.ts';

test('1. Casilla única genera la declaración exacta con confirmación de identidad', () => {
  const name = 'María Elena Sánchez Rosas';
  const decl = buildConsentDeclarationText(name);
  assert.equal(decl, `Confirmo que soy ${name} y he leído y acepto el aviso de privacidad`);
});

test('2. Validación de consentimiento: requiere que la casilla única esté marcada', () => {
  const resultUnchecked = validateConsentSubmission({
    interviewId: 'inv_101',
    participantId: 'part_202',
    participantName: 'Roberto Gómez',
    hasAcceptedSingleCheckbox: false,
    versionId: 'v1.0.0',
    noticeContent: 'Aviso Integral Oficial',
  });
  assert.equal(resultUnchecked.isValid, false);
  assert.ok(resultUnchecked.error?.includes('casilla única'));

  const resultChecked = validateConsentSubmission({
    interviewId: 'inv_101',
    participantId: 'part_202',
    participantName: 'Roberto Gómez',
    hasAcceptedSingleCheckbox: true,
    versionId: 'v1.0.0',
    noticeContent: 'Aviso Integral Oficial',
  });
  assert.equal(resultChecked.isValid, true);
  assert.equal(resultChecked.declarationHash.length, 64);
  assert.equal(resultChecked.noticeHash.length, 64);
});

test('3. Verificación de vigencia e identidad de un consentimiento existente', () => {
  const activeRecord: PrivacyConsentRecord = {
    id: 'consent_1',
    interviewId: 'inv_abc',
    participantId: 'part_xyz',
    participantName: 'Carlos Mendoza',
    versionId: 'v1.0.0',
    noticeHash: computeSha256('notice'),
    declarationHash: computeSha256('decl'),
    declarationText: 'decl text',
    acceptedAt: new Date().toISOString(),
    expressAcceptance: true,
    identityConfirmed: true,
    authMechanism: 'token_bearer_hash_sha256',
    status: 'active',
  };

  assert.equal(isConsentValid(activeRecord, 'inv_abc', 'part_xyz', 'v1.0.0'), true);
  // Fails if interview ID does not match
  assert.equal(isConsentValid(activeRecord, 'inv_other', 'part_xyz', 'v1.0.0'), false);
  // Fails if participant ID does not match
  assert.equal(isConsentValid(activeRecord, 'inv_abc', 'part_other', 'v1.0.0'), false);
  // Fails if revoked
  assert.equal(isConsentValid({ ...activeRecord, status: 'revoked' }, 'inv_abc', 'part_xyz', 'v1.0.0'), false);
});

test('4. Historias de pareja mantienen consentimientos independientes', () => {
  const consent1: PrivacyConsentRecord = {
    id: 'c1',
    interviewId: 'inv_couple',
    participantId: 'part_partner1',
    participantName: 'Juan Pérez',
    versionId: 'v1.0.0',
    noticeHash: 'h1',
    declarationHash: 'd1',
    declarationText: 'text1',
    acceptedAt: new Date().toISOString(),
    expressAcceptance: true,
    identityConfirmed: true,
    authMechanism: 'token',
    status: 'active',
  };

  // Juan is valid for partner 1
  assert.equal(isConsentValid(consent1, 'inv_couple', 'part_partner1'), true);
  // But Juan's consent CANNOT be used for partner 2
  assert.equal(isConsentValid(consent1, 'inv_couple', 'part_partner2'), false);
});

test('5. Validación de reglas de compartición de libro: correo válido y fechas futuras', () => {
  const invalidEmail = validateBookShare({
    recipientName: 'Sofía Gómez',
    recipientEmail: 'not-an-email',
  });
  assert.equal(invalidEmail.isValid, false);

  const pastDate = validateBookShare({
    recipientName: 'Sofía Gómez',
    recipientEmail: 'sofia@example.com',
    scheduledDate: '2020-01-01',
  });
  assert.equal(pastDate.isValid, false);
  assert.ok(pastDate.error?.includes('futura'));

  const valid = validateBookShare({
    recipientName: 'Sofía Gómez',
    recipientEmail: 'sofia@example.com',
    scheduledDate: '2028-12-25',
  });
  assert.equal(valid.isValid, true);
});
