import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_STAGE_PRESETS,
  SAMPLE_BOOK_CHAPTERS,
  generateDemoFollowUpQuestion,
  createInitialChatThread,
  computeLegacyLayoutDisposition,
  validateInquiryForm,
  buildWhatsAppInquiryUrl,
  buildMailtoInquiryUrl,
} from '../conocemeLogic.ts';

test('DEMO_STAGE_PRESETS contains all 5 life stages', () => {
  assert.equal(DEMO_STAGE_PRESETS.length, 5);
  const ids = DEMO_STAGE_PRESETS.map((s) => s.id);
  assert.deepEqual(ids, ['infancia', 'juventud', 'adultez', 'madurez', 'legado_general']);
});

test('createInitialChatThread launches the initial AI interviewer question in memory', () => {
  const thread = createInitialChatThread('infancia', 'individual');
  assert.equal(thread.length, 1);
  assert.equal(thread[0].sender, 'ai');
  assert.equal(thread[0].text, DEMO_STAGE_PRESETS[0].baseQuestionIndividual);
});

test('generateDemoFollowUpQuestion returns preset follow-up for default sample text', () => {
  const infancia = DEMO_STAGE_PRESETS[0];
  const result = generateDemoFollowUpQuestion('infancia', 'individual', infancia.sampleAnswerIndividual);
  assert.equal(result.followUpQuestion, infancia.defaultFollowUpIndividual);
  assert.ok(result.detectedMotifs.includes('Abuela Elena'));
});

test('generateDemoFollowUpQuestion extracts custom user motifs without hallucinating', () => {
  const customText = 'Recuerdo cuando viajábamos en tren hacia Veracruz con mi abuelo Santiago cada verano.';
  const result = generateDemoFollowUpQuestion('infancia', 'individual', customText);
  assert.ok(result.followUpQuestion.includes('Recuerdo') || result.followUpQuestion.includes('viajábamos'));
  assert.ok(result.detectedMotifs.length > 0);
});

test('SAMPLE_BOOK_CHAPTERS has chapters with paired archival photos and transcriptions', () => {
  assert.equal(SAMPLE_BOOK_CHAPTERS.length, 4);
  for (const page of SAMPLE_BOOK_CHAPTERS) {
    assert.ok(page.photoTitle.length > 0);
    assert.ok(page.photoCaption.length > 0);
    assert.ok(page.excerptParagraphs.length > 0);
  }
});

test('computeLegacyLayoutDisposition maps slider values to photo and transcription layout modes', () => {
  const photoHeavy = computeLegacyLayoutDisposition(80);
  assert.equal(photoHeavy.mode, 'photo-focus');
  assert.equal(photoHeavy.photoWeight, 80);
  assert.equal(photoHeavy.transcriptionWeight, 20);

  const balanced = computeLegacyLayoutDisposition(50);
  assert.equal(balanced.mode, 'balanced');
  assert.equal(balanced.photoWeight, 50);
  assert.equal(balanced.transcriptionWeight, 50);

  const textHeavy = computeLegacyLayoutDisposition(20);
  assert.equal(textHeavy.mode, 'transcription-focus');
  assert.equal(textHeavy.photoWeight, 20);
  assert.equal(textHeavy.transcriptionWeight, 80);
});

test('validateInquiryForm rejects empty fields and invalid contact info', () => {
  const emptyCheck = validateInquiryForm({
    fullName: '',
    contactInfo: '',
    recipientRelation: '',
    modality: 'individual',
    message: '',
  });
  assert.equal(emptyCheck.valid, false);
  assert.ok(emptyCheck.errors.fullName);
  assert.ok(emptyCheck.errors.contactInfo);
  assert.ok(emptyCheck.errors.recipientRelation);

  const badContactCheck = validateInquiryForm({
    fullName: 'María López',
    contactInfo: '123',
    recipientRelation: 'Mis padres',
    modality: 'compartida',
    message: '',
  });
  assert.equal(badContactCheck.valid, false);
  assert.ok(badContactCheck.errors.contactInfo);
});

test('validateInquiryForm accepts valid email or 10-digit phone number', () => {
  const validEmail = validateInquiryForm({
    fullName: 'María López',
    contactInfo: 'maria.lopez@ejemplo.com',
    recipientRelation: 'Mi abuela materna',
    modality: 'individual',
    message: 'Cumple 80 años en diciembre',
  });
  assert.equal(validEmail.valid, true);
  assert.deepEqual(validEmail.errors, {});

  const validPhone = validateInquiryForm({
    fullName: 'Carlos Hernández',
    contactInfo: '+52 55 1234 5678',
    recipientRelation: 'Mis padres por su 50 aniversario',
    modality: 'compartida',
    message: '',
  });
  assert.equal(validPhone.valid, true);
});

test('buildWhatsAppInquiryUrl and buildMailtoInquiryUrl encode user details properly', () => {
  const waUrl = buildWhatsAppInquiryUrl({
    fullName: 'Ana Sofía',
    recipientRelation: 'Mi papá',
    modality: 'individual',
  });
  assert.ok(waUrl.startsWith('https://wa.me/529681040015?text='));
  assert.ok(decodeURIComponent(waUrl).includes('Ana Sofía'));
  assert.ok(decodeURIComponent(waUrl).includes('Mi papá'));

  const mailUrl = buildMailtoInquiryUrl({
    fullName: 'Ana Sofía',
    contactInfo: 'ana@correo.com',
    recipientRelation: 'Mi papá',
    modality: 'individual',
  });
  assert.ok(mailUrl.startsWith('mailto:youforever.team@gmail.com'));
  assert.ok(decodeURIComponent(mailUrl).includes('ana@correo.com'));
});
