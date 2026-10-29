import crypto from 'node:crypto';

export interface PrivacyConsentRecord {
  id: string;
  interviewId: string;
  participantId: string;
  participantName: string;
  versionId: string;
  noticeHash: string;
  declarationHash: string;
  declarationText: string;
  acceptedAt: string;
  expressAcceptance: boolean;
  identityConfirmed: boolean;
  authMechanism: string;
  status: 'active' | 'revoked';
  revokedAt?: string;
  revocationReason?: string;
  userAgent?: string;
}

export interface BookShareRecord {
  id: string;
  interviewId: string;
  participantId: string;
  participantName: string;
  recipientName: string;
  recipientEmail: string;
  relationship: string;
  note?: string;
  manuscriptId?: string;
  manuscriptVersion?: number;
  status: 'active' | 'revoked';
  createdAt: string;
  revokedAt?: string;
  // Security invariant: strictly only digital book allowed
  shareDigitalBookOnly: true;
}

export interface ScheduledDeliveryRecord {
  id: string;
  interviewId: string;
  participantId: string;
  participantName: string;
  recipientName: string;
  recipientEmail: string;
  scheduledDate: string; // ISO Date YYYY-MM-DD
  note?: string;
  manuscriptId?: string;
  status: 'scheduled' | 'executed' | 'cancelled' | 'modified';
  createdAt: string;
  updatedAt?: string;
  shareDigitalBookOnly: true;
}

export interface SecondaryAccessRecord {
  id: string;
  interviewId: string;
  participantId: string;
  authorizedPersonName: string;
  authorizedPersonEmail: string;
  relationship: string;
  permissions: Array<'view_manuscript' | 'consultation_companion'>;
  status: 'active' | 'revoked';
  createdAt: string;
  revokedAt?: string;
  allowRawAnswersOrAudios: false;
}

export interface PostMortemInstructionRecord {
  id: string;
  interviewId: string;
  participantId: string;
  designatedPersonName: string;
  designatedPersonEmail: string;
  relationship: string;
  authorizedScope: 'digital_book_only';
  instructions: string;
  conditionDescription: string;
  status: 'active' | 'revoked';
  createdAt: string;
  updatedAt?: string;
}

export interface ArcoRequestRecord {
  id: string;
  folio: string;
  interviewId: string;
  participantId: string;
  participantName: string;
  email: string;
  requestType: 'acceso' | 'rectificacion' | 'cancelacion' | 'oposicion';
  details: string;
  status: 'received' | 'in_review' | 'resolved';
  createdAt: string;
}

export function computeSha256(content: string): string {
  return crypto.createHash('sha256').update(content.trim()).digest('hex');
}

/**
 * Builds the exact single identity and consent declaration text required by legal policy.
 */
export function buildConsentDeclarationText(participantFullName: string): string {
  const cleanName = participantFullName.trim();
  return `Confirmo que soy ${cleanName}, la persona identificada en esta entrevista. Declaro que he tenido acceso al Aviso de Privacidad Simplificado y al Aviso de Privacidad Integral de ForeverYou, que he leído o podido consultar sus secciones, que conozco y acepto íntegramente sus condiciones y que autorizo expresamente el tratamiento de los datos personales que voluntariamente proporcione, incluidos testimonios, grabaciones, fotografías y, cuando corresponda, datos sensibles, financieros o patrimoniales, para las finalidades necesarias de recopilación, conservación, procesamiento mediante inteligencia artificial y elaboración de mi libro autobiográfico, conforme a lo establecido en dichos avisos. Entiendo que las finalidades opcionales que requieren una autorización independiente no se activan automáticamente con esta aceptación, y que conservo los derechos y mecanismos de revocación establecidos en el Aviso de Privacidad.`;
}

/**
 * Validates whether a participant's consent record is valid and active.
 */
export function isConsentValid(
  consent: PrivacyConsentRecord | null | undefined,
  interviewId: string,
  participantId: string,
  requiredVersionId?: string
): boolean {
  if (!consent) return false;
  if (consent.status !== 'active') return false;
  if (consent.interviewId !== interviewId) return false;
  if (consent.participantId !== participantId) return false;
  if (!consent.expressAcceptance || !consent.identityConfirmed) return false;
  if (requiredVersionId && consent.versionId !== requiredVersionId) return false;
  return true;
}

/**
 * Validates a new consent submission payload before persisting.
 */
export function validateConsentSubmission(payload: {
  interviewId: string;
  participantId: string;
  participantName: string;
  hasAcceptedSingleCheckbox: boolean;
  versionId: string;
  noticeContent: string;
}): { isValid: boolean; error?: string; declarationText: string; declarationHash: string; noticeHash: string } {
  if (!payload.interviewId || !payload.participantId) {
    return { isValid: false, error: 'Identificadores de entrevista o participante inválidos.', declarationText: '', declarationHash: '', noticeHash: '' };
  }

  if (!payload.participantName || payload.participantName.trim().length === 0) {
    return { isValid: false, error: 'El nombre del participante autenticado es requerido.', declarationText: '', declarationHash: '', noticeHash: '' };
  }

  if (!payload.hasAcceptedSingleCheckbox) {
    return {
      isValid: false,
      error: 'Debes marcar la casilla única de confirmación de identidad y aceptación del aviso de privacidad para continuar.',
      declarationText: '',
      declarationHash: '',
      noticeHash: '',
    };
  }

  const declarationText = buildConsentDeclarationText(payload.participantName);
  const declarationHash = computeSha256(declarationText);
  const noticeHash = computeSha256(payload.noticeContent);

  return {
    isValid: true,
    declarationText,
    declarationHash,
    noticeHash,
  };
}

/**
 * Validates book sharing security rules:
 * Rule 1: Only the compiled digital manuscript may be shared.
 * Rule 2: Raw audios, raw answers and loose photos must NEVER be shared.
 */
export function validateBookShare(payload: {
  recipientName: string;
  recipientEmail: string;
  scheduledDate?: string;
}): { isValid: boolean; error?: string } {
  if (!payload.recipientName || payload.recipientName.trim().length < 2) {
    return { isValid: false, error: 'Nombre del destinatario requerido.' };
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!payload.recipientEmail || !emailRegex.test(payload.recipientEmail.trim())) {
    return { isValid: false, error: 'Correo electrónico del destinatario inválido.' };
  }
  if (payload.scheduledDate) {
    const scheduledTime = new Date(payload.scheduledDate).getTime();
    if (isNaN(scheduledTime)) {
      return { isValid: false, error: 'Fecha de entrega programada inválida.' };
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (scheduledTime < today.getTime()) {
      return { isValid: false, error: 'La fecha de entrega programada debe ser futura.' };
    }
  }
  return { isValid: true };
}
