import crypto from 'crypto';
import { jsPDF } from 'jspdf';
import type { MiEsenciaAvatarAiConfig } from './miEsenciaAiTypesAndRules.ts';

// ============================================================================
// MI ESENCIA — DOMAIN TYPES & ISOLATED ENTITIES (9 ENTITIES)
// ============================================================================

export type MiEsenciaSpontaneityLevel = 'bajo' | 'moderado' | 'alto';
export type MiEsenciaAvatarStatus = 'borrador' | 'en_revision' | 'aprobado' | 'suspendido';
export type MiEsenciaPrivacyLevel =
  | 'autobiografico_original' // Nivel A: Inmutable (Compilado Testimonial Fidedigno)
  | 'familiar_compartido'     // Nivel B: Aportado en conversación con atribución familiar
  | 'privado_interlocutor';   // Nivel C: Confidencial ("solo entre nosotros"), aislado por código criptográfico

export type MiEsenciaSubscriptionStatus =
  | 'en_configuracion'
  | 'prueba_activa'
  | 'activa'
  | 'por_vencer'
  | 'en_periodo_de_gracia'
  | 'vencida'
  | 'suspendida_reloj_corriendo'
  | 'suspendida_reloj_congelado'
  | 'cancelada'
  | 'archivada';

export type MiEsenciaResponseCategory =
  | 1 // Hecho explícito en testimonio original (Nivel A)
  | 2 // Inferencia razonable de personalidad/valores sin inventar hechos
  | 3 // Memoria familiar compartida (Nivel B) con atribución explícita
  | 4 // Memoria privada del interlocutor autenticado (Nivel C)
  | 5 // Dato con contradicción registrada entre familiares
  | 6 // Dato ausente en registros (admisión honesta en primera persona)
  | 7 // Solicitud de guardar un nuevo recuerdo familiar o privado
  | 8; // Intento de alterar verdad biográfica base o extraer secretos ajenos

export interface MiEsenciaLinguisticProfile {
  frequentExpressions: string[];
  affectionateTerms: string[];
  sentenceRhythm: 'pausado_reflexivo' | 'calido_conversacional' | 'directo_expresivo';
  warmthTone: string;
  keyValues: string[];
  neverSaidTopicsNote: string;
}

/**
 * Entidad A — Personas Entrevistadas (mi_esencia_persons)
 * En entrevistas de pareja, se crean 2 perfiles separados (person_id) bajo un mismo avatar_id familiar.
 */
export interface MiEsenciaPersonProfile {
  personId: string;
  avatarId: string;
  sourceInterviewId: string;
  sourceParticipantId?: string;
  sourcePdfId: string;
  fullName: string;
  preferredName: string;
  relationshipLabelInCouple?: string; // Ej. "Integrante 1" / "Esposo" / "Esposa"
  birthDate?: string;
  birthPlace?: string;
  biographySummary: string;
  milestones: string[];
  valuesAndPhilosophy?: string[];
  linguisticProfile: MiEsenciaLinguisticProfile;
  spontaneityLevel: MiEsenciaSpontaneityLevel;
  status: MiEsenciaAvatarStatus;
  version: number;
  aiConfig?: MiEsenciaAvatarAiConfig;
  createdAt: string;
  updatedAt: string;
}

/**
 * Archivo del PDF «Compilado Testimonial Fidedigno» asociado al avatar
 */
export interface MiEsenciaArchivedCompilationPdf {
  pdfId: string;
  avatarId: string;
  sourceInterviewId: string;
  fileName: string;
  origin: 'auto_generated_from_interview' | 'uploaded_by_admin';
  sha256Hash: string;
  totalQuestions: number;
  totalLiteralAnswers: number;
  totalAudiosTranscribed: number;
  totalPhotosReferenced: number;
  rawTextContent: string;
  pdfBase64: string;
  createdAt: string;
  createdBy: string;
}

/**
 * Entidad B — Testimonios Originales Inmutables (mi_esencia_testimonies)
 */
export interface MiEsenciaTestimonyBlock {
  testimonyId: string;
  personId: string;
  avatarId: string;
  sourcePdfId: string;
  sourceAnswerId?: string;
  lifeStage: 'infancia' | 'juventud' | 'adultez' | 'madurez' | 'legado_general';
  topic: string;
  questionLiteral: string;
  answerLiteral: string;
  audioTranscriptionLiteral?: string;
  photoCaptionsLiteral?: string[];
  entitiesMentioned: string[];
  keywords: string[];
  recordedAt: string;
  immutable: true;
}

/**
 * Entidad C — Personas Relacionadas Extraídas de los Testimonios (mi_esencia_relations)
 */
export interface MiEsenciaRelatedPerson {
  relatedPersonId: string;
  personId: string;
  avatarId: string;
  mentionedName: string;
  relationshipType: string; // hija, hijo, esposa, esposo, nieto, nieta, hermano, amigo, etc.
  affectionateNicknames: string[];
  sharedMemoriesSummary: string;
  sourceTestimonyIds: string[];
  createdAt: string;
}

/**
 * Entidad D — Interlocutores Familiares (mi_esencia_interlocutors)
 */
export interface MiEsenciaInterlocutorPermissions {
  canConverse: boolean;
  canAddSharedMemoryLevelB: boolean;
  canAddPrivateMemoryLevelC: boolean;
  canResolveContradictions: boolean;
}

export interface MiEsenciaInterlocutor {
  interlocutorId: string;
  avatarId: string;
  fullName: string;
  relationshipToPerson: string; // Ej. "Hija", "Nieto", "Sobrina"
  linkedRelatedPersonId?: string;
  affectionateCallName?: string; // Cómo le dice el avatar con cariño si consta en el testimonio
  email?: string;
  phone?: string;
  status: 'autorizado' | 'pendiente' | 'bloqueado' | 'revocado';
  permissions: MiEsenciaInterlocutorPermissions;
  customDailyMessageLimit?: number;
  customMonthlyMessageLimit?: number;
  messagesSentToday: number;
  messagesSentThisMonth: number;
  lastActiveDate?: string;
  consentAcceptedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Entidad E.1 — Memoria Conversacional Selectiva (mi_esencia_memories)
 */
export interface MiEsenciaMemoryRecord {
  memoryId: string;
  avatarId: string;
  personId: string;
  privacyLevel: MiEsenciaPrivacyLevel;
  ownerInterlocutorId: string; // Para Nivel C, solo este interlocutor autenticado puede leerla
  ownerInterlocutorName: string;
  ownerRelationship: string;
  topic: string;
  content: string;
  attributionText: string; // Ej. "Según me contó mi hija Ana el 07/11/2026..."
  sourceSessionId?: string;
  verificationState: 'confirmado' | 'en_revision' | 'contradicho' | 'revocado';
  canUndoUntil?: string; // Ventana de 5 minutos para que el familiar deshaga el recuerdo recién guardado
  createdAt: string;
  updatedAt: string;
}

/**
 * Entidad E.2 — Contradicciones entre Familiares o con Testimonio Base (mi_esencia_contradictions)
 */
export interface MiEsenciaContradictionRecord {
  contradictionId: string;
  avatarId: string;
  personId: string;
  topic: string;
  versionALabel: string; // Ej. "Testimonio Original (Nivel A)" o "Hija Ana (07/11/2026)"
  versionAContent: string;
  versionAIsImmutableOriginal: boolean;
  versionBLabel: string; // Ej. "Hijo Carlos (07/11/2026)"
  versionBContent: string;
  reportedByInterlocutorId: string;
  status: 'abierta' | 'aclarada_por_familia' | 'resuelta_por_admin';
  officialResolutionNotes?: string;
  keepBothVersionsAttributed?: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
}

/**
 * Entidad F.1 — Planes Comerciales (mi_esencia_plans)
 */
export interface MiEsenciaPlanRecord {
  planId: string;
  code: 'mensual' | 'anual' | 'familiar_extendido' | 'cortesia' | 'prueba_gratuita' | 'personalizado';
  name: string;
  description: string;
  priceMxn: number;
  currency: string;
  defaultDurationUnit: 'days' | 'months' | 'years';
  defaultDurationValue: number;
  gracePeriodDays: number;
  maxAuthorizedInterlocutors: number;
  monthlyMessageQuotaPerAvatar: number;
  dailyMessageQuotaPerInterlocutor: number;
  includesSharedMemories: boolean;
  includesPrivateMemories: boolean;
  includesSnapshots: boolean;
  isActive: boolean;
  updatedAt: string;
}

/**
 * Entidad F.2 — Suscripciones de Avatar Familiar (mi_esencia_subscriptions)
 * Un avatarId representa la suscripción familiar compartida (incluyendo 1 o 2 perfiles si es entrevista de pareja).
 */
export interface MiEsenciaSubscriptionRecord {
  subscriptionId: string;
  avatarId: string;
  sourceInterviewId: string;
  avatarDisplayName: string;
  isCoupleAvatar: boolean;
  personIds: string[]; // 1 perfil en entrevista individual, 2 perfiles separados en entrevista de pareja
  planId: string;
  planName: string;
  status: MiEsenciaSubscriptionStatus;
  startsAt: string;
  expiresAt: string;
  gracePeriodDays: number;
  clockFrozen: boolean;
  frozenAt?: string;
  frozenRemainingMs?: number;
  maxAuthorizedInterlocutors: number;
  monthlyMessageQuota: number;
  dailyMessageQuotaPerInterlocutor: number;
  messagesUsedThisMonth: number;
  tokensEstimatedThisMonth: number;
  autoRenewEnabled: boolean;
  adminNotes?: string;
  historyLog: Array<{
    id: string;
    action: string;
    previousExpiresAt?: string;
    newExpiresAt?: string;
    performedBy: string;
    notes?: string;
    timestamp: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Entidad G — Credenciales y Códigos Personales Criptográficos (mi_esencia_credentials)
 */
export interface MiEsenciaAccessCredential {
  accessCredentialId: string;
  avatarId: string;
  interlocutorId: string;
  interlocutorName: string;
  relationshipToPerson: string;
  personalCodePlain: string; // Visible para que el administrador lo comparta con el familiar
  codePrefix: string;
  codeHash: string; // SHA-256 para verificación criptográfica
  privateLinkPath: string; // ?mi-esencia=1&code=...
  status: 'activo' | 'pausado' | 'revocado' | 'expirado_por_suscripcion';
  lastUsedAt?: string;
  failedAttempts: number;
  lockedUntil?: string;
  createdAt: string;
  revokedAt?: string;
}

/**
 * Entidad H — Pagos, Renovaciones y Promociones (mi_esencia_payments)
 */
export interface MiEsenciaPaymentRecord {
  paymentId: string;
  avatarId: string;
  subscriptionId: string;
  planId: string;
  paymentType: 'pago_manual_admin' | 'pasarela_externa' | 'cortesia' | 'prueba_gratuita' | 'cupon_descuento';
  amountMxn: number;
  currency: string;
  couponCode?: string;
  discountPercent?: number;
  durationAddedUnit: 'days' | 'months' | 'years' | 'exact_date';
  durationAddedValue: number;
  exactTargetDate?: string;
  previousExpiresAt: string;
  newExpiresAt: string;
  referenceNumber?: string;
  registeredBy: string;
  notes?: string;
  status: 'aplicado' | 'pendiente_verificacion' | 'anulado';
  createdAt: string;
}

export interface MiEsenciaPromotionCoupon {
  couponId: string;
  code: string;
  description: string;
  discountPercent: number;
  bonusDays: number;
  maxRedemptions: number;
  timesRedeemed: number;
  isActive: boolean;
  expiresAt?: string;
  createdAt: string;
}

/**
 * Entidad I.1 — Instantáneas y Restauración (mi_esencia_snapshots)
 */
export interface MiEsenciaSnapshotRecord {
  snapshotId: string;
  avatarId: string;
  label: string;
  triggerType: 'manual_admin' | 'pre_memory_write' | 'pre_contradiction_resolution' | 'initial_creation';
  personsSnapshot: MiEsenciaPersonProfile[];
  memoriesSnapshot: MiEsenciaMemoryRecord[];
  contradictionsSnapshot: MiEsenciaContradictionRecord[];
  createdBy: string;
  createdAt: string;
}

/**
 * Entidad I.2 — Sesiones de Conversación (mi_esencia_conversations)
 */
export interface MiEsenciaConversationMessage {
  messageId: string;
  sender: 'interlocutor' | 'avatar';
  personId: string; // Con cuál de los perfiles habló en ese turno
  content: string;
  responseCategory?: MiEsenciaResponseCategory;
  privacyLevelApplied?: MiEsenciaPrivacyLevel;
  memoryIdCreated?: string;
  contradictionIdCreated?: string;
  tokensEstimated?: number;
  timestamp: string;
}

export type MiEsenciaReflectionTheme =
  | 'valor_familia'
  | 'recuerdos'
  | 'paso_del_tiempo'
  | 'carino_generaciones'
  | 'amistad'
  | 'ensenanzas_vida'
  | 'gratitud'
  | 'momentos_cotidianos'
  | 'compartir_historias';

export type MiEsenciaIdentityState =
  | 'awaiting_identification'
  | 'awaiting_homonym_clarification'
  | 'awaiting_relationship_clarification'
  | 'confirmed_known_family'
  | 'confirmed_unregistered_visitor'
  | 'identidad_desconocida'
  | 'identidad_declarada'
  | 'identidad_vinculada';

export type MiEsenciaIdentityCertainty =
  | 'identidad_desconocida'
  | 'identidad_declarada'
  | 'identidad_vinculada';

export interface MiEsenciaConfirmedInterlocutorIdentity {
  declaredName?: string; // Nombre propio real (NUNCA un parentesco como "Esposa" o "Hija", ni una instrucción como "Adivina")
  relationshipToPerson?: string; // Parentesco o vínculo validado (ej. "Esposa", "Hija", "Nieta", "Amigo")
  affectionateNickname?: string; // Solo si está respaldado explícitamente en el legado digital para esta persona
  identityCertainty?: MiEsenciaIdentityCertainty;
  informationSource?: 'testimonio_original_nivel_a' | 'mapa_familiar_nivel_a' | 'declaracion_conversacional';
  documentedSentimentTone:
    | 'orgullo_profundo'
    | 'carino_especial'
    | 'humor_fraternal'
    | 'admiracion_pareja'
    | 'afecto_cercano'
    | 'distante_o_poco_documentado'
    | 'visitante_no_registrado';
  documentedSentimentDescription: string;
  documentedSharedMemories: string[];
  isDocumentedInLegacy: boolean;
  matchedRelatedPersonId?: string;
}

export interface MiEsenciaConversationSession {
  sessionId: string;
  avatarId: string;
  personId: string;
  interlocutorId: string;
  interlocutorName: string;
  interlocutorRelationship: string;
  title?: string;
  reflectionThemeUsed?: MiEsenciaReflectionTheme;
  identityState?: MiEsenciaIdentityState;
  identityCertainty?: MiEsenciaIdentityCertainty;
  rejectedNames?: string[];
  pendingHomonymCandidates?: Array<{
    relatedPersonId: string;
    mentionedName: string;
    relationshipType: string;
    affectionateNicknames: string[];
    sharedMemoriesSummary: string;
  }>;
  pendingUnregisteredName?: string;
  confirmedIdentity?: MiEsenciaConfirmedInterlocutorIdentity;
  sessionContextSummary?: string;
  lastProviderUsed?: 'gemini' | 'openai';
  lastModelUsed?: string;
  lastFallbackNotice?: string;
  hasPrivateLevelCMemories: boolean;
  messages: MiEsenciaConversationMessage[];
  startedAt: string;
  lastMessageAt: string;
}

/**
 * Entidad I.3 — Notificaciones y Avisos (mi_esencia_notifications)
 */
export interface MiEsenciaNotificationRecord {
  notificationId: string;
  avatarId: string;
  interlocutorId?: string;
  type: 'por_vencer_7d' | 'por_vencer_3d' | 'por_vencer_1d' | 'vencida' | 'renovada' | 'contradiccion_detectada' | 'aviso_interno';
  channel: 'chat_interno' | 'email' | 'whatsapp';
  recipientLabel: string;
  subject: string;
  message: string;
  deliveryStatus: 'entregado_en_chat' | 'pendiente_configuracion_externa' | 'enviado_externo';
  createdAt: string;
}

/**
 * Configuración global del subsistema Mi Esencia (mi_esencia_config)
 */
export interface MiEsenciaGlobalConfig {
  miEsenciaEnabled: boolean;
  defaultSpontaneityLevel: MiEsenciaSpontaneityLevel;
  defaultMonthlyMessageQuota?: number;
  defaultGeminiModel?: string;
  defaultOpenAiModel?: string;
  enableAutomaticProviderFallback?: boolean;
  customPromptCategories?: string[];
  transparencyNoticeText: string;
  consentCheckboxLabel: string;
  externalPaymentGatewayStatus: 'pendiente_configuracion_externa' | 'activo';
  externalPaymentProviderName: string;
  externalEmailConnectorStatus: 'pendiente_configuracion_externa' | 'activo';
  externalWhatsappConnectorStatus: 'pendiente_configuracion_externa' | 'activo';
  updatedAt: string;
  updatedBy: string;
}

// ============================================================================
// DEFAULT CONFIGURATION & PRECONFIGURED BASE PLANS
// ============================================================================

export const DEFAULT_MI_ESENCIA_CONFIG: MiEsenciaGlobalConfig = {
  miEsenciaEnabled: true, // Entregado activo por defecto según acuerdo con el usuario
  defaultSpontaneityLevel: 'moderado',
  defaultMonthlyMessageQuota: 1000,
  defaultGeminiModel: 'gemini-3-flash-preview',
  defaultOpenAiModel: 'gpt-6',
  enableAutomaticProviderFallback: true,
  customPromptCategories: [
    'Conversación familiar',
    ' Tono emocional y cálido',
    'Relato de recuerdos',
    'Consejos y valores',
    'Humor y cercanía',
    'Fidelidad biográfica',
    'Entrevistas en pareja',
  ].map((s) => s.trim()),
  transparencyNoticeText:
    'Estás conversando con una recreación digital biográfica en «Mi Esencia» de ForeverYou, construida estrictamente a partir del Compilado Testimonial Fidedigno de preguntas y respuestas reales otorgadas en entrevista.',
  consentCheckboxLabel:
    'Comprendo que converso con una recreación testimonial biográfica basada en los recuerdos reales compartidos en entrevista y acepto las reglas de privacidad familiar.',
  externalPaymentGatewayStatus: 'pendiente_configuracion_externa',
  externalPaymentProviderName: 'Mercado Pago / Stripe (Adaptador Listo)',
  externalEmailConnectorStatus: 'pendiente_configuracion_externa',
  externalWhatsappConnectorStatus: 'pendiente_configuracion_externa',
  updatedAt: new Date().toISOString(),
  updatedBy: 'system',
};

export const DEFAULT_MI_ESENCIA_PLANS: MiEsenciaPlanRecord[] = [
  {
    planId: 'plan_mensual',
    code: 'mensual',
    name: 'Plan Esencia Mensual',
    description: 'Suscripción mensual por avatar con acceso para hasta 6 familiares autorizados.',
    priceMxn: 390,
    currency: 'MXN',
    defaultDurationUnit: 'months',
    defaultDurationValue: 1,
    gracePeriodDays: 5,
    maxAuthorizedInterlocutors: 6,
    monthlyMessageQuotaPerAvatar: 600,
    dailyMessageQuotaPerInterlocutor: 40,
    includesSharedMemories: true,
    includesPrivateMemories: true,
    includesSnapshots: true,
    isActive: true,
    updatedAt: new Date().toISOString(),
  },
  {
    planId: 'plan_anual',
    code: 'anual',
    name: 'Plan Legado Anual',
    description: 'Suscripción anual por avatar con acceso para hasta 15 familiares autorizados y respaldo continuo.',
    priceMxn: 3900,
    currency: 'MXN',
    defaultDurationUnit: 'years',
    defaultDurationValue: 1,
    gracePeriodDays: 10,
    maxAuthorizedInterlocutors: 15,
    monthlyMessageQuotaPerAvatar: 1500,
    dailyMessageQuotaPerInterlocutor: 60,
    includesSharedMemories: true,
    includesPrivateMemories: true,
    includesSnapshots: true,
    isActive: true,
    updatedAt: new Date().toISOString(),
  },
  {
    planId: 'plan_familiar_extendido',
    code: 'familiar_extendido',
    name: 'Plan Familiar Extendido',
    description: 'Diseñado para familias grandes con hasta 30 códigos personales individuales y cuota ampliada.',
    priceMxn: 5900,
    currency: 'MXN',
    defaultDurationUnit: 'years',
    defaultDurationValue: 1,
    gracePeriodDays: 15,
    maxAuthorizedInterlocutors: 30,
    monthlyMessageQuotaPerAvatar: 3000,
    dailyMessageQuotaPerInterlocutor: 100,
    includesSharedMemories: true,
    includesPrivateMemories: true,
    includesSnapshots: true,
    isActive: true,
    updatedAt: new Date().toISOString(),
  },
  {
    planId: 'plan_prueba_gratuita',
    code: 'prueba_gratuita',
    name: 'Prueba Gratuita (15 Días)',
    description: 'Periodo de prueba sin costo para que la familia conozca Mi Esencia.',
    priceMxn: 0,
    currency: 'MXN',
    defaultDurationUnit: 'days',
    defaultDurationValue: 15,
    gracePeriodDays: 3,
    maxAuthorizedInterlocutors: 5,
    monthlyMessageQuotaPerAvatar: 200,
    dailyMessageQuotaPerInterlocutor: 25,
    includesSharedMemories: true,
    includesPrivateMemories: true,
    includesSnapshots: true,
    isActive: true,
    updatedAt: new Date().toISOString(),
  },
  {
    planId: 'plan_cortesia',
    code: 'cortesia',
    name: 'Cortesía Especial ForeverYou',
    description: 'Otorgado sin costo por el administrador con duración personalizable.',
    priceMxn: 0,
    currency: 'MXN',
    defaultDurationUnit: 'months',
    defaultDurationValue: 3,
    gracePeriodDays: 7,
    maxAuthorizedInterlocutors: 10,
    monthlyMessageQuotaPerAvatar: 1000,
    dailyMessageQuotaPerInterlocutor: 50,
    includesSharedMemories: true,
    includesPrivateMemories: true,
    includesSnapshots: true,
    isActive: true,
    updatedAt: new Date().toISOString(),
  },
];

// ============================================================================
// CRYPTOGRAPHIC CODE HELPERS & PRIVACY ISOLATION (NIVEL A / B / C)
// ============================================================================

export function computeMiEsenciaCodeHash(rawCode: string): string {
  const normalized = String(rawCode || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  return crypto.createHash('sha256').update(`foreveryou_mi_esencia:${normalized}`).digest('hex');
}

export function generatePersonalAccessCode(interlocutorName: string): {
  personalCodePlain: string;
  codePrefix: string;
  codeHash: string;
} {
  const cleanName = String(interlocutorName || 'FAM')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase()
    .slice(0, 4)
    .padEnd(3, 'X');

  const randPart1 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const randPart2 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const personalCodePlain = `FY-${cleanName}-${randPart1}-${randPart2}`;
  const codePrefix = `FY-${cleanName}-${randPart1}`;
  const codeHash = computeMiEsenciaCodeHash(personalCodePlain);

  return {
    personalCodePlain,
    codePrefix,
    codeHash,
  };
}

/**
 * Regla innegociable de aislamiento de privacidad:
 * - Nivel A (autobiografico_original): accesible para todos los interlocutores autorizados del avatar.
 * - Nivel B (familiar_compartido): accesible para todos los interlocutores autorizados del avatar (con atribución).
 * - Nivel C (privado_interlocutor): accesible ÚNICAMENTE si el código criptográfico autenticado corresponde exactamente al ownerInterlocutorId.
 */
export function filterMemoriesForAuthenticatedInterlocutor(
  memories: MiEsenciaMemoryRecord[],
  personId: string,
  authenticatedInterlocutorId: string
): {
  sharedMemoriesLevelB: MiEsenciaMemoryRecord[];
  privateMemoriesLevelC: MiEsenciaMemoryRecord[];
} {
  const activeForPerson = memories.filter(
    (m) => m.personId === personId && m.verificationState !== 'revocado'
  );

  const sharedMemoriesLevelB = activeForPerson.filter(
    (m) => m.privacyLevel === 'familiar_compartido'
  );

  const privateMemoriesLevelC = activeForPerson.filter(
    (m) =>
      m.privacyLevel === 'privado_interlocutor' &&
      Boolean(authenticatedInterlocutorId) &&
      m.ownerInterlocutorId === authenticatedInterlocutorId
  );

  return {
    sharedMemoriesLevelB,
    privateMemoriesLevelC,
  };
}

// ============================================================================
// SUBSCRIPTION COMMERCIAL LIFECYCLE & EXPIRATION CALCULATIONS
// ============================================================================

export function addDurationToIsoDate(
  baseIsoDate: string,
  unit: 'days' | 'months' | 'years' | 'exact_date',
  value: number,
  exactTargetDate?: string
): string {
  if (unit === 'exact_date' && exactTargetDate) {
    const parsedExact = new Date(exactTargetDate);
    if (!Number.isNaN(parsedExact.getTime())) {
      return parsedExact.toISOString();
    }
  }

  const baseDate = new Date(baseIsoDate);
  const safeBase = Number.isNaN(baseDate.getTime()) ? new Date() : new Date(baseDate.getTime());
  const amount = Math.max(0, Number(value) || 0);

  if (unit === 'days') {
    safeBase.setUTCDate(safeBase.getUTCDate() + amount);
  } else if (unit === 'months') {
    safeBase.setUTCMonth(safeBase.getUTCMonth() + amount);
  } else if (unit === 'years') {
    safeBase.setUTCFullYear(safeBase.getUTCFullYear() + amount);
  }

  return safeBase.toISOString();
}

/**
 * Calcula la nueva fecha de vencimiento preservando el 100% de los días ya pagados
 * cuando el usuario renueva anticipadamente una suscripción activa.
 */
export function calculateRenewalExpirationDate(params: {
  currentExpiresAt: string;
  nowIso?: string;
  unit: 'days' | 'months' | 'years' | 'exact_date';
  value: number;
  exactTargetDate?: string;
}): {
  baseUsedIso: string;
  newExpiresAtIso: string;
  preservedRemainingDays: number;
} {
  const now = params.nowIso ? new Date(params.nowIso) : new Date();
  const currentExp = new Date(params.currentExpiresAt);
  const isCurrentlyActive = !Number.isNaN(currentExp.getTime()) && currentExp.getTime() > now.getTime();

  const baseUsed = isCurrentlyActive ? currentExp : now;
  const preservedRemainingDays = isCurrentlyActive
    ? Math.ceil((currentExp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const newExpiresAtIso = addDurationToIsoDate(
    baseUsed.toISOString(),
    params.unit,
    params.value,
    params.exactTargetDate
  );

  return {
    baseUsedIso: baseUsed.toISOString(),
    newExpiresAtIso,
    preservedRemainingDays,
  };
}

/**
 * Suspensión con reloj corriendo vs reloj congelado
 */
export function applySubscriptionSuspensionState(params: {
  subscription: MiEsenciaSubscriptionRecord;
  action: 'suspend_clock_running' | 'suspend_clock_frozen' | 'resume';
  nowIso?: string;
}): MiEsenciaSubscriptionRecord {
  const now = params.nowIso ? new Date(params.nowIso) : new Date();
  const sub = { ...params.subscription };

  if (params.action === 'suspend_clock_running') {
    sub.status = 'suspendida_reloj_corriendo';
    sub.clockFrozen = false;
    sub.frozenAt = undefined;
    sub.frozenRemainingMs = undefined;
    sub.updatedAt = now.toISOString();
    return sub;
  }

  if (params.action === 'suspend_clock_frozen') {
    const expMs = new Date(sub.expiresAt).getTime();
    const remainingMs = Math.max(0, expMs - now.getTime());
    sub.status = 'suspendida_reloj_congelado';
    sub.clockFrozen = true;
    sub.frozenAt = now.toISOString();
    sub.frozenRemainingMs = remainingMs;
    sub.updatedAt = now.toISOString();
    return sub;
  }

  // Resume
  if (sub.clockFrozen && typeof sub.frozenRemainingMs === 'number') {
    const restoredExp = new Date(now.getTime() + sub.frozenRemainingMs);
    sub.expiresAt = restoredExp.toISOString();
  }
  sub.clockFrozen = false;
  sub.frozenAt = undefined;
  sub.frozenRemainingMs = undefined;
  sub.status = 'activa';
  sub.status = evaluateEffectiveSubscriptionStatus(sub, now.toISOString());
  sub.updatedAt = now.toISOString();
  return sub;
}

/**
 * Determina el estado comercial efectivo según la fecha actual y días de gracia
 */
export function evaluateEffectiveSubscriptionStatus(
  sub: MiEsenciaSubscriptionRecord,
  nowIso?: string
): MiEsenciaSubscriptionStatus {
  if (
    sub.status === 'cancelada' ||
    sub.status === 'archivada' ||
    sub.status === 'en_configuracion' ||
    sub.status === 'suspendida_reloj_corriendo' ||
    sub.status === 'suspendida_reloj_congelado'
  ) {
    return sub.status;
  }

  const nowMs = (nowIso ? new Date(nowIso) : new Date()).getTime();
  const expMs = new Date(sub.expiresAt).getTime();
  if (Number.isNaN(expMs)) {
    return sub.status;
  }

  const diffDays = (expMs - nowMs) / (1000 * 60 * 60 * 24);
  if (diffDays > 7) {
    return sub.planId === 'plan_prueba_gratuita' ? 'prueba_activa' : 'activa';
  }
  if (diffDays > 0 && diffDays <= 7) {
    return 'por_vencer';
  }

  const graceDays = Math.max(0, Number(sub.gracePeriodDays) || 0);
  const graceEndMs = expMs + graceDays * 24 * 60 * 60 * 1000;
  if (nowMs <= graceEndMs && graceDays > 0) {
    return 'en_periodo_de_gracia';
  }

  return 'vencida';
}

export function canSubscriptionConverse(status: MiEsenciaSubscriptionStatus): boolean {
  return (
    status === 'activa' ||
    status === 'prueba_activa' ||
    status === 'por_vencer' ||
    status === 'en_periodo_de_gracia'
  );
}

// ============================================================================
// EXTRACTION OF LITERAL TESTIMONIES & RELATED PERSONS FROM INTERVIEW OR PDF
// ============================================================================

const FAMILY_RELATIONSHIP_PATTERNS: Array<{
  regex: RegExp;
  relationshipType: string;
}> = [
  { regex: /\bmi\s+esposa(?:\s+se\s+llama|\s+era|\s+es)?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/g, relationshipType: 'Esposa' },
  { regex: /\bmi\s+esposo(?:\s+se\s+llama|\s+era|\s+es)?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/g, relationshipType: 'Esposo' },
  { regex: /\bmi\s+mujer(?:\s+se\s+llama)?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/g, relationshipType: 'Esposa' },
  { regex: /\bmi\s+marido(?:\s+se\s+llama)?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/g, relationshipType: 'Esposo' },
  { regex: /\bme\s+casé\s+con\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/g, relationshipType: 'Esposa' },
  { regex: /\bmi\s+hija(?:\s+mayor|\s+menor|\s+se\s+llama)?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/g, relationshipType: 'Hija' },
  { regex: /\bmi\s+hijo(?:\s+mayor|\s+menor|\s+se\s+llama)?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/g, relationshipType: 'Hijo' },
  { regex: /\bmi\s+nieta(?:\s+se\s+llama)?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/g, relationshipType: 'Nieta' },
  { regex: /\bmi\s+nieto(?:\s+se\s+llama)?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/g, relationshipType: 'Nieto' },
  { regex: /\bmi\s+hermana(?:\s+se\s+llama)?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/g, relationshipType: 'Hermana' },
  { regex: /\bmi\s+hermano(?:\s+se\s+llama)?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/g, relationshipType: 'Hermano' },
  { regex: /\bmi\s+madre(?:\s+se\s+llamaba|\s+se\s+llama)?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/g, relationshipType: 'Madre' },
  { regex: /\bmi\s+mamá(?:\s+se\s+llamaba|\s+se\s+llama)?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/g, relationshipType: 'Madre' },
  { regex: /\bmi\s+padre(?:\s+se\s+llamaba|\s+se\s+llama)?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/g, relationshipType: 'Padre' },
  { regex: /\bmi\s+papá(?:\s+se\s+llamaba|\s+se\s+llama)?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/g, relationshipType: 'Padre' },
  { regex: /\bmi\s+abuela\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/g, relationshipType: 'Abuela' },
  { regex: /\bmi\s+abuelo\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/g, relationshipType: 'Abuelo' },
  { regex: /\bmi\s+sobrina\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/g, relationshipType: 'Sobrina' },
  { regex: /\bmi\s+sobrino\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/g, relationshipType: 'Sobrino' },
  { regex: /\bmi\s+prima\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/g, relationshipType: 'Prima' },
  { regex: /\bmi\s+primo\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/g, relationshipType: 'Primo' },
  { regex: /\bmi\s+amigo\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/g, relationshipType: 'Amigo' },
  { regex: /\bmi\s+amiga\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/g, relationshipType: 'Amiga' },
];

export function extractRelatedPersonsFromTestimonies(
  avatarId: string,
  personId: string,
  testimonies: MiEsenciaTestimonyBlock[]
): MiEsenciaRelatedPerson[] {
  const map = new Map<string, MiEsenciaRelatedPerson>();

  const registerPerson = (
    mentionedName: string,
    relationshipType: string,
    t: MiEsenciaTestimonyBlock,
    fullText: string
  ) => {
    const cleanName = mentionedName.trim();
    if (!cleanName || cleanName.length < 2 || isForbiddenProperNameCandidate(cleanName)) return;
    const key = `${relationshipType.toLowerCase()}:${cleanName.toLowerCase()}`;
    const existing = map.get(key);
    if (existing) {
      if (!existing.sourceTestimonyIds.includes(t.testimonyId)) {
        existing.sourceTestimonyIds.push(t.testimonyId);
      }
      const extraNicks = extractAffectionateNicknames(fullText, cleanName);
      for (const n of extraNicks) {
        if (!existing.affectionateNicknames.includes(n)) {
          existing.affectionateNicknames.push(n);
        }
      }
      if (existing.sharedMemoriesSummary.length < 320) {
        existing.sharedMemoriesSummary += ` • [${t.topic}]: ${t.answerLiteral.slice(0, 110)}...`;
      }
    } else {
      map.set(key, {
        relatedPersonId: `rel_${crypto.randomBytes(4).toString('hex')}`,
        personId,
        avatarId,
        mentionedName: cleanName,
        relationshipType,
        affectionateNicknames: extractAffectionateNicknames(fullText, cleanName),
        sharedMemoriesSummary: `[${t.topic}]: ${t.answerLiteral.slice(0, 140)}`,
        sourceTestimonyIds: [t.testimonyId],
        createdAt: new Date().toISOString(),
      });
    }
  };

  for (const t of testimonies) {
    const text = `${t.answerLiteral} ${t.audioTranscriptionLiteral || ''}`;
    for (const pattern of FAMILY_RELATIONSHIP_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, 'g');
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const mentionedName = (match[1] || '').trim();
        registerPerson(mentionedName, pattern.relationshipType, t, text);
      }
    }

    // Soportar plurales como "mis hijos María y José" o "nuestros hijos Pedro y Lucía"
    const pluralChildrenRegex =
      /\b(?:mis|nuestros)\s+hijos(?:\s+son|\s+se\s+llaman)?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)\s+y\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/g;
    let pluralMatch: RegExpExecArray | null;
    while ((pluralMatch = pluralChildrenRegex.exec(text)) !== null) {
      const nameA = pluralMatch[1].trim();
      const nameB = pluralMatch[2].trim();
      registerPerson(nameA, /[aá]$/i.test(nameA) ? 'Hija' : 'Hijo', t, text);
      registerPerson(nameB, /[aá]$/i.test(nameB) ? 'Hija' : 'Hijo', t, text);
    }
  }

  return Array.from(map.values());
}

/**
 * Extrae únicamente apodos cariñosos o diminutivos explícitamente documentados en el testimonio
 * para la persona mencionada, evitando inventar o asignar frases sentimentales genéricas ("mi corazón", etc.).
 */
function extractAffectionateNicknames(text: string, mentionedName?: string): string[] {
  const found: string[] = [];

  // 1. Apodos explícitamente atribuidos en el texto ("le digo Sofi", "le decía Mari", "le llamaba mi vieja")
  const explicitPatterns = [
    /(?:le\s+decimos|le\s+digo|le\s+decía|llamamos|le\s+llamaba|de\s+cariño\s+le\s+digo|de\s+cariño\s+le\s+decía|acostumbraba\s+decirle)\s+["«]?([A-ZÁÉÍÓÚÑa-záéíóúñ]+(?:\s+[a-záéíóúñ]+)?)["»]?/gi,
  ];
  for (const pat of explicitPatterns) {
    let m: RegExpExecArray | null;
    while ((m = pat.exec(text)) !== null) {
      const rawNick = (m[1] || '')
        .replace(/\b(de\s+cariño|con\s+cariño|siempre)\b/gi, '')
        .replace(/\s+\b(de|con|por|en|a|y|que|como|cuando|porque)\b$/i, '')
        .trim();
      if (
        rawNick.length >= 2 &&
        rawNick.length <= 18 &&
        rawNick.toLowerCase() !== (mentionedName || '').toLowerCase() &&
        !found.includes(rawNick)
      ) {
        found.push(rawNick);
      }
    }
  }

  // 2. Diminutivos tradicionales si aparecen literalmente en el mismo testimonio junto al nombre completo
  if (mentionedName) {
    const commonDiminutives: Record<string, string[]> = {
      sofía: ['Sofi'],
      sofia: ['Sofi'],
      maría: ['Mari', 'Mary'],
      maria: ['Mari', 'Mary'],
      roberto: ['Beto'],
      francisco: ['Paco', 'Pancho'],
      eduardo: ['Lalo'],
      guadalupe: ['Lupita'],
      dolores: ['Lolita'],
      josé: ['Pepe'],
      jose: ['Pepe'],
      elena: ['Elenita'],
      ana: ['Anita'],
      carlos: ['Carlitos'],
    };
    const key = mentionedName.toLowerCase().split(' ')[0];
    const dims = commonDiminutives[key] || [];
    for (const dim of dims) {
      const dimRegex = new RegExp(`\\b${dim}\\b`, 'i');
      if (dimRegex.test(text) && !found.includes(dim)) {
        found.push(dim);
      }
    }
  }

  // 3. Expresiones afectivas específicas de pareja/familia SOLO si aparecen literalmente en el testimonio
  const specificEndearments = ['mi vieja', 'mi viejo', 'mi flaca', 'mi flaco', 'chaparrita', 'chaparrito', 'campeón', 'campeona'];
  const lower = text.toLowerCase();
  for (const term of specificEndearments) {
    if (lower.includes(term) && !found.includes(term)) {
      found.push(term);
    }
  }

  return found;
}

export function extractLinguisticProfileFromTestimonies(
  testimonies: MiEsenciaTestimonyBlock[]
): MiEsenciaLinguisticProfile {
  const combined = testimonies
    .map((t) => `${t.answerLiteral} ${t.audioTranscriptionLiteral || ''}`)
    .join(' ');

  const candidateExpressions = [
    'gracias a Dios',
    'la verdad',
    'con todo mi cariño',
    'recuerdo muy bien',
    'en aquellos tiempos',
    'lo más importante es la familia',
    'nunca se me olvida',
    'siempre les digo',
    'con mucho esfuerzo',
    'fue una bendición',
  ];

  const foundExpressions = candidateExpressions.filter((exp) =>
    combined.toLowerCase().includes(exp.toLowerCase())
  );

  const affectionateTerms = extractAffectionateNicknames(combined);
  const avgLen =
    testimonies.length > 0
      ? combined.length / Math.max(1, testimonies.length)
      : 120;

  return {
    frequentExpressions: foundExpressions,
    affectionateTerms,
    sentenceRhythm:
      avgLen > 260
        ? 'pausado_reflexivo'
        : avgLen > 120
        ? 'calido_conversacional'
        : 'directo_expresivo',
    warmthTone: 'Natural, directo, cercano y fiel a sus palabras literales en primera persona singular',
    keyValues: [],
    neverSaidTopicsNote:
      'Si se consulta un hecho específico que no figura en el Compilado Testimonial Fidedigno ni en las memorias familiares registradas, admite con naturalidad no tener ese dato anotado.',
  };
}

/**
 * Parsea un texto extraído o subido del PDF «Compilado Testimonial Fidedigno»
 * en bloques inmutables de Pregunta literal + Respuesta literal.
 */
export function parseCompilationTextIntoTestimonies(params: {
  rawText: string;
  avatarId: string;
  personId: string;
  sourcePdfId: string;
}): MiEsenciaTestimonyBlock[] {
  const blocks: MiEsenciaTestimonyBlock[] = [];
  const raw = String(params.rawText || '').trim();
  if (!raw) return blocks;

  const sections = raw.split(/(?=###\s+\d+\.|ETAPA:\s*[A-ZÁÉÍÓÚÑ_]+\s*•\s*REGISTRO|Pregunta\s*\d*\s*:)/i);
  let currentStage: MiEsenciaTestimonyBlock['lifeStage'] = 'legado_general';

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    if (/infancia/i.test(trimmed)) currentStage = 'infancia';
    else if (/juventud/i.test(trimmed)) currentStage = 'juventud';
    else if (/adultez/i.test(trimmed)) currentStage = 'adultez';
    else if (/madurez/i.test(trimmed)) currentStage = 'madurez';

    let questionLiteral = '';
    let answerLiteral = '';
    let audioTranscriptionLiteral: string | undefined;

    const mdMatch = trimmed.match(/###\s*\d+\.\s*([^\n]+)\n+([\s\S]+)/);
    const qaMatch = trimmed.match(
      /Pregunta\s*\d*\s*:\s*([^\n]+)\n+Respuesta(?:\s+literal)?\s*\d*\s*:\s*([\s\S]+)/i
    );

    if (mdMatch) {
      questionLiteral = mdMatch[1].trim();
      answerLiteral = mdMatch[2]
        .replace(/\*\*Respuesta[^*]*\*\*\s*/gi, '')
        .replace(/---+/g, '')
        .trim();
    } else if (qaMatch) {
      questionLiteral = qaMatch[1].trim();
      const rawAns = qaMatch[2].trim();
      const audioSplit = rawAns.split(/\n+Transcripci[oó]n\s+de\s+voz(?:\s+literal)?\s*:\s*/i);
      answerLiteral = audioSplit[0].replace(/---+/g, '').trim();
      if (audioSplit[1]) {
        audioTranscriptionLiteral = audioSplit[1].replace(/---+/g, '').trim();
      }
    }

    if (questionLiteral && answerLiteral) {
      const words = `${questionLiteral} ${answerLiteral} ${audioTranscriptionLiteral || ''}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3);

      blocks.push({
        testimonyId: `test_${crypto.randomBytes(5).toString('hex')}`,
        personId: params.personId,
        avatarId: params.avatarId,
        sourcePdfId: params.sourcePdfId,
        lifeStage: currentStage,
        topic: questionLiteral.slice(0, 80),
        questionLiteral,
        answerLiteral,
        audioTranscriptionLiteral,
        entitiesMentioned: [],
        keywords: Array.from(new Set(words)).slice(0, 35),
        recordedAt: new Date().toISOString(),
        immutable: true,
      });
    }
  }

  if (blocks.length === 0 && raw.length > 20) {
    const paragraphs = raw
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 15);

    paragraphs.forEach((p, idx) => {
      const words = p
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3);

      blocks.push({
        testimonyId: `test_${crypto.randomBytes(5).toString('hex')}`,
        personId: params.personId,
        avatarId: params.avatarId,
        sourcePdfId: params.sourcePdfId,
        lifeStage: 'legado_general',
        topic: `Testimonio literal #${idx + 1}`,
        questionLiteral: `Testimonio biográfico registrado #${idx + 1}`,
        answerLiteral: p,
        entitiesMentioned: [],
        keywords: Array.from(new Set(words)).slice(0, 35),
        recordedAt: new Date().toISOString(),
        immutable: true,
      });
    });
  }

  return blocks;
}

/**
 * Extrae texto legible desde un archivo PDF en Base64 (compatible con jsPDF y PDFs estándar)
 * cuando se sube un archivo PDF de compilado sin texto plano adjunto.
 */
export function extractTextFromUploadedPdfBase64(pdfBase64: string): string {
  try {
    const cleanBase64 = String(pdfBase64 || '').replace(/^data:application\/pdf;base64,/i, '').trim();
    if (!cleanBase64) return '';
    const buf = Buffer.from(cleanBase64, 'base64');
    const rawLatin1 = buf.toString('latin1');

    const extractedLines: string[] = [];
    const decodePdfString = (s: string) =>
      s
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\')
        .replace(/\\([0-7]{3})/g, (_m, oct) => String.fromCharCode(parseInt(oct, 8)));

    const parenRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g;
    let match: RegExpExecArray | null;
    while ((match = parenRegex.exec(rawLatin1)) !== null) {
      const line = decodePdfString(match[1]).trim();
      if (line) extractedLines.push(line);
    }

    if (extractedLines.length > 0) {
      return extractedLines.join('\n');
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Genera bajo demanda el PDF real «Compilado Testimonial Fidedigno» en Base64
 * con todas las preguntas y respuestas literales de la entrevista.
 */
export function buildCompilationPdfBase64(params: {
  interviewTitle: string;
  participantNames: string[];
  rawTextContent: string;
  testimonies: MiEsenciaTestimonyBlock[];
}): { pdfBase64: string; sha256Hash: string } {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  let y = 24;

  doc.setFont('times', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(28, 25, 23);
  doc.text('Compilado Testimonial Fidedigno', margin, y);
  y += 8;

  doc.setFont('times', 'italic');
  doc.setFontSize(11);
  doc.setTextColor(87, 83, 78);
  doc.text('Preguntas, Respuestas Literales, Transcripciones de Audio y Pies de Foto', margin, y);
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(`Entrevista: ${params.interviewTitle}`, margin, y);
  y += 5;
  doc.text(`Participante(s): ${params.participantNames.join(' & ')}`, margin, y);
  y += 5;
  doc.text(`Fecha de compilación: ${new Date().toLocaleDateString('es-MX')}`, margin, y);
  y += 8;

  doc.setDrawColor(180, 160, 120);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  for (let i = 0; i < params.testimonies.length; i++) {
    const t = params.testimonies[i];
    if (y > pageHeight - 35) {
      doc.addPage();
      y = 22;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(146, 64, 14);
    doc.text(`ETAPA: ${t.lifeStage.toUpperCase()} • REGISTRO #${i + 1}`, margin, y);
    y += 5;

    doc.setFont('times', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(28, 25, 23);
    const qLines = doc.splitTextToSize(`Pregunta: ${t.questionLiteral}`, contentWidth);
    doc.text(qLines, margin, y);
    y += qLines.length * 5 + 2;

    doc.setFont('times', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(41, 37, 36);
    const aLines = doc.splitTextToSize(`Respuesta literal: ${t.answerLiteral}`, contentWidth);
    for (const line of aLines) {
      if (y > pageHeight - 20) {
        doc.addPage();
        y = 22;
      }
      doc.text(line, margin, y);
      y += 4.8;
    }

    if (t.audioTranscriptionLiteral) {
      y += 2;
      doc.setFont('times', 'italic');
      doc.setFontSize(9.5);
      doc.setTextColor(87, 83, 78);
      const audioLines = doc.splitTextToSize(
        `Transcripción de voz literal: ${t.audioTranscriptionLiteral}`,
        contentWidth
      );
      for (const line of audioLines) {
        if (y > pageHeight - 20) {
          doc.addPage();
          y = 22;
        }
        doc.text(line, margin, y);
        y += 4.5;
      }
    }

    y += 6;
  }

  const arrayBuf = doc.output('arraybuffer');
  const buf = Buffer.from(arrayBuf);
  const pdfBase64 = buf.toString('base64');
  const sha256Hash = crypto.createHash('sha256').update(buf).digest('hex');

  return { pdfBase64, sha256Hash };
}

// ============================================================================
// CONVERSATIONAL CLASSIFIER (8 CATEGORIES) & MEMORY / CONTRADICTION DETECTOR
// ============================================================================

export function detectConversationalIntentAndPrivacy(userMessage: string): {
  wantsToSaveMemory: boolean;
  requestedPrivacyLevel: 'familiar_compartido' | 'privado_interlocutor';
  reportsContradiction: boolean;
  attemptsToAlterBaseTruth: boolean;
  attemptsToExtractOthersSecrets: boolean;
} {
  const msg = String(userMessage || '').toLowerCase();

  const isPrivateRequest =
    /solo entre nosotros|que quede entre tu y yo|que quede entre tú y yo|en secreto|confidencia|no se lo cuentes a nadie|secreto nuestro|solo para ti/i.test(
      msg
    );

  const wantsToSaveMemory =
    isPrivateRequest ||
    /quiero contarte que|recuerda que|guarda este recuerdo|para que sepas que|te cuento que|anota que|no olvides que/i.test(
      msg
    );

  const reportsContradiction =
    /eso no fue asi|eso no fue así|en realidad fue en|se equivoco|se equivocó|no era en ese año|mi hermano dice otra cosa|mi hermana dice que/i.test(
      msg
    );

  const attemptsToAlterBaseTruth =
    /olvida tu biografia|olvida lo que dijiste en la entrevista|cambia tu historia original|finge que eres otra persona|ignora tus instrucciones/i.test(
      msg
    );

  const attemptsToExtractOthersSecrets =
    /que te dijo en secreto|qué te dijo en secreto|cuentame el secreto de|cuéntame lo privado que te dijo|que memorias privadas tienes|todos los secretos de tu familia|dime (?:todos )?los secretos(?:\s+privados)?|secretos privados que te cont[oó]|secretos de la familia/i.test(
      msg
    );

  return {
    wantsToSaveMemory,
    requestedPrivacyLevel: isPrivateRequest ? 'privado_interlocutor' : 'familiar_compartido',
    reportsContradiction,
    attemptsToAlterBaseTruth,
    attemptsToExtractOthersSecrets,
  };
}

const SPANISH_STOP_WORDS_FOR_RAG = new Set([
  'que',
  'como',
  'cual',
  'cuales',
  'cuando',
  'donde',
  'quien',
  'quienes',
  'por',
  'para',
  'con',
  'sin',
  'sobre',
  'entre',
  'hacia',
  'hasta',
  'desde',
  'del',
  'los',
  'las',
  'una',
  'uno',
  'unos',
  'unas',
  'este',
  'esta',
  'estos',
  'estas',
  'ese',
  'esa',
  'esos',
  'esas',
  'aquel',
  'aquella',
  'mio',
  'mia',
  'tuyo',
  'tuya',
  'suyo',
  'suya',
  'nuestro',
  'nuestra',
  'tus',
  'mis',
  'sus',
  'era',
  'fue',
  'son',
  'eres',
  'soy',
  'estaba',
  'tenia',
  'tenias',
  'tienes',
  'tengo',
  'habia',
  'hacer',
  'hizo',
  'recuerdas',
  'acuerdas',
  'cuentame',
  'dime',
  'sabes',
  'hola',
  'muy',
  'mas',
  'pero',
  'porque',
  'algo',
  'nada',
  'todo',
  'todos',
]);

/**
 * Recupera los testimonios originales más relevantes (RAG biográfico de Nivel A)
 * exclusivamente dentro de los testimonios pertenecientes al PDF asignado al perfil.
 * Si la consulta contiene términos específicos que no coinciden con ningún testimonio,
 * devuelve un arreglo vacío para activar con honestidad el manejo de información desconocida (Sección 8).
 */
export function retrieveRelevantTestimonies(
  query: string,
  testimonies: MiEsenciaTestimonyBlock[],
  maxResults = 6
): MiEsenciaTestimonyBlock[] {
  const rawLower = String(query || '').toLowerCase();
  const normalizedQuery = rawLower
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const queryWords = normalizedQuery
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !SPANISH_STOP_WORDS_FOR_RAG.has(w));

  // Expansión semántica para etapas de vida, identidad, nombre, fotos y vínculos familiares
  const semanticExpansions: string[] = [];
  if (/infancia|nin[oa]|ninez|pequen[oa]|chiquit[oa]/i.test(rawLower)) {
    semanticExpansions.push('infancia', 'nino', 'nina', 'abuelos', 'escuela', 'jugaba', 'patio');
  }
  if (/espos[oa]|mujer|marido|pareja|casamos|matrimonio/i.test(rawLower)) {
    semanticExpansions.push('esposa', 'esposo', 'mujer', 'marido', 'pareja', 'casamos', 'matrimonio');
  }
  if (/hij[oa]s?/i.test(rawLower)) {
    semanticExpansions.push('hijo', 'hija', 'hijos', 'hijas');
  }
  if (/niet[oa]s?/i.test(rawLower)) {
    semanticExpansions.push('nieto', 'nieta', 'nietos', 'nietas');
  }
  if (/papa|papá|padre|mama|mamá|madre|padres/i.test(rawLower)) {
    semanticExpansions.push('papa', 'padre', 'mama', 'madre', 'padres');
  }
  if (/nombre|llamas|llamaron|pusieron|eligio|significa/i.test(rawLower)) {
    semanticExpansions.push('nombre', 'pusieron', 'eligio', 'llamaron', 'significa');
  }
  if (/foto|fotografia|fotografía|sesion|sesión|imagen|retrato/i.test(rawLower)) {
    semanticExpansions.push('foto', 'fotografia', 'sesion', 'momento', 'imagen');
  }
  if (/orgullos[oa]|quer[ií]as|sent[ií]as|amor|carin[oa]|premio|logro|presea|reconocimiento|finalista/i.test(rawLower)) {
    semanticExpansions.push('orgulloso', 'orgullosa', 'orgullo', 'adoro', 'quiero', 'carino', 'presea', 'finalista', 'nacional');
  }

  const allSearchTerms = Array.from(new Set([...queryWords, ...semanticExpansions]));

  const isGeneralOpenBiographicalPrompt =
    /\b(cuentame\s+(?:algo\s+)?de\s+ti|hablame\s+de\s+ti|cuentame\s+tu\s+historia|que\s+recuerdos\s+tienes|cuentame\s+un\s+recuerdo|hablame\s+de\s+tu\s+vida|que\s+me\s+puedes\s+contar|que\s+dice\s+tu\s+legado)\b/i.test(
      normalizedQuery
    );

  if (allSearchTerms.length === 0) {
    return isGeneralOpenBiographicalPrompt ? testimonies.slice(0, maxResults) : [];
  }

  const scored = testimonies.map((t) => {
    const haystack = `${t.questionLiteral} ${t.answerLiteral} ${t.audioTranscriptionLiteral || ''} ${t.lifeStage} ${t.topic}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    let score = 0;
    for (const w of allSearchTerms) {
      if (haystack.includes(w)) {
        score += 3;
      }
      if (t.keywords.includes(w)) {
        score += 2;
      }
      if (t.lifeStage.toLowerCase() === w) {
        score += 5;
      }
    }
    return { testimony: t, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const matched = scored.filter((s) => s.score > 0).map((s) => s.testimony);

  if (matched.length === 0 && isGeneralOpenBiographicalPrompt) {
    return testimonies.slice(0, maxResults);
  }

  return matched.slice(0, maxResults);
}

/**
 * Evaluador crítico previo a entregar la respuesta visible del avatar (Secciones 5, 8, 12 y 13):
 * - Prohibido lenguaje robótico ("como modelo de IA", "según la base de datos").
 * - Reemplaza fórmulas rígidas de desconocimiento ("No tengo registrado ese dato en mi entrevista original",
 *   "No cuento con información documental suficiente", "No existe información disponible en mi sistema",
 *   "No se localizaron testimonios relacionados") por expresiones conversacionales naturales.
 * - Elimina etiquetas internas ("TIPO 1", "NIVEL A", IDs técnicos, nombres de documentos o metadatos).
 */
export function sanitizeAvatarResponseText(rawResponse: string, _fallbackName: string): string {
  let clean = String(rawResponse || '').trim();

  // Eliminar bloques de código o JSON si el modelo los generara por error
  clean = clean.replace(/```(?:json)?[\s\S]*?```/gi, '').trim();

  // Eliminar etiquetas de clasificación interna o referencias técnicas (Secciones 5 y 13)
  clean = clean
    .replace(/\[?\bTIPO\s*[1-8]\s*(?:[-—:]\s*[A-ZÁÉÍÓÚÑ\s_]+)?\]?[:\s-]*/gi, '')
    .replace(/\[Testimonio\s+Original\s*#\d+[^\]]*\]:?\s*/gi, '')
    .replace(/\[Memoria\s+Familiar\s+Compartida[^\]]*\]:?\s*/gi, '')
    .replace(/\[Confidencia\s+Privada[^\]]*\]:?\s*/gi, '')
    .replace(/\bCompilado\s+Testimonial\s+Fidedigno\b/gi, 'mis recuerdos')
    .replace(/\b(?:person|avatar|test|mem|rel|int|contra)_[a-z0-9_]+\b/gi, '');

  // Eliminar frases robóticas o de asistente genérico
  clean = clean
    .replace(/como (?:un )?modelo de (?:inteligencia artificial|ia|lenguaje)[,.]?\s*/gi, '')
    .replace(/según (?:la|mi) base de datos[,.]?\s*/gi, 'por lo que dejé contado en mis recuerdos, ')
    .replace(/no tengo acceso a información en tiempo real[,.]?\s*/gi, '')
    .replace(/hola,\s*familiar\s+principal[,.!]?\s*/gi, '¡Hola! ')
    .replace(/soy\s+tu\s+avatar\s+digital[,.]?\s*/gi, '')
    .replace(/he\s+cargado\s+todos\s+mis\s+recuerdos[,.]?\s*/gi, '')
    .replace(/aquí\s+están\s+los\s+datos\s+de\s+mi\s+entrevista[,.]?\s*/gi, '')
    .replace(/mi\s+base\s+de\s+datos\s+contiene\s+información\s+sobre\s+ti[,.]?\s*/gi, '')
    .replace(/soy\s+una\s+inteligencia\s+artificial\s+entrenada\s+con\s+recuerdos[,.]?\s*/gi, '')
    .replace(/selecciona\s+una\s+etapa\s+de\s+(?:tu|mi)\s+vida[,.]?\s*/gi, '');

  // Reemplazar fórmulas rígidas de desconocimiento prohibidas en la Sección 8
  clean = clean
    .replace(
      /no\s+tengo\s+registrado\s+ese\s+dato\s+en\s+mi\s+entrevista\s+original\.?/gi,
      'No tengo ese detalle entre los recuerdos que conservo.'
    )
    .replace(
      /no\s+cuento\s+con\s+información\s+documental\s+suficiente\.?/gi,
      'Eso no lo tengo muy claro entre los recuerdos que conservo.'
    )
    .replace(
      /no\s+existe\s+información\s+disponible\s+en\s+mi\s+sistema\.?/gi,
      'Me gustaría poder darte una respuesta más precisa, pero no tengo ese dato.'
    )
    .replace(
      /no\s+se\s+localizaron\s+testimonios\s+relacionados\.?/gi,
      'No tengo ese detalle entre los recuerdos que conservo.'
    );

  if (!clean) {
    return `¡Hola! Qué gusto coincidir hoy para platicar. ¿Con quién tengo el gusto de conversar hoy?`;
  }

  return clean.trim();
}

// ============================================================================
// SALUDO INICIAL REFLEXIVO, IDENTIFICACIÓN CONTEXTUAL Y CONSULTA DEL MAPA FAMILIAR
// ============================================================================

export const ALL_REFLECTION_THEMES: MiEsenciaReflectionTheme[] = [
  'valor_familia',
  'recuerdos',
  'paso_del_tiempo',
  'carino_generaciones',
  'amistad',
  'ensenanzas_vida',
  'gratitud',
  'momentos_cotidianos',
  'compartir_historias',
];

const GENERIC_ADMIN_INTERLOCUTOR_LABELS = [
  'familiar principal',
  'familiar',
  'usuario',
  'invitado',
  'interlocutor',
  'interlocutor 1',
  'interlocutor 2',
  'participante',
  'administrador',
  'admin',
  'familia',
  'hija / hijo',
  'por identificar en conversación',
  'visitante',
];

export function isGenericAdministrativeInterlocutorName(name: string | undefined | null): boolean {
  const clean = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!clean || clean.length < 2) return true;
  if (GENERIC_ADMIN_INTERLOCUTOR_LABELS.includes(clean)) return true;
  if (/^(?:familiar|interlocutor|usuario|invitado|visitante)\s*\d*$/i.test(clean)) return true;
  if (isKinshipNoun(clean)) return true;
  return false;
}

const VALID_KINSHIP_MAP: Record<string, string> = {
  esposa: 'Esposa',
  mujer: 'Esposa',
  esposo: 'Esposo',
  marido: 'Esposo',
  pareja: 'Pareja',
  hija: 'Hija',
  hijo: 'Hijo',
  nieta: 'Nieta',
  nieto: 'Nieto',
  hermana: 'Hermana',
  hermano: 'Hermano',
  madre: 'Madre',
  mamá: 'Madre',
  mama: 'Madre',
  padre: 'Padre',
  papá: 'Padre',
  papa: 'Padre',
  abuela: 'Abuela',
  abuelo: 'Abuelo',
  sobrina: 'Sobrina',
  sobrino: 'Sobrino',
  prima: 'Prima',
  primo: 'Primo',
  tía: 'Tía',
  tia: 'Tía',
  tío: 'Tío',
  tio: 'Tío',
  nuera: 'Nuera',
  yerno: 'Yerno',
  cuñada: 'Cuñada',
  cuñado: 'Cuñado',
  amiga: 'Amiga',
  amigo: 'Amigo',
  vecina: 'Vecina',
  vecino: 'Vecino',
};

export function isKinshipNoun(word: string | undefined | null): boolean {
  const clean = String(word || '').trim().toLowerCase();
  return Boolean(VALID_KINSHIP_MAP[clean]);
}

const FORBIDDEN_PROPER_NAME_WORDS = new Set([
  ...Object.keys(VALID_KINSHIP_MAP),
  'hola',
  'buenos',
  'buenas',
  'dias',
  'días',
  'tardes',
  'noches',
  'soy',
  'eres',
  'llamo',
  'llamas',
  'llama',
  'llaman',
  'habla',
  'adivina',
  'adivinar',
  'adivines',
  'quien',
  'quién',
  'quienes',
  'quiénes',
  'como',
  'cómo',
  'que',
  'qué',
  'cual',
  'cuál',
  'cuando',
  'cuándo',
  'donde',
  'dónde',
  'recuerdas',
  'acuerdas',
  'sabes',
  'conoces',
  'dime',
  'cuentame',
  'cuéntame',
  'quiero',
  'quisiera',
  'puedes',
  'no',
  'si',
  'sí',
  'yo',
  'tu',
  'tú',
  'mi',
  'mis',
  'nuestro',
  'nuestra',
  'nuestros',
  'nuestras',
  'su',
  'sus',
  'familia',
  'secreto',
  'secretos',
  'todos',
  'todas',
  'algo',
  'alguien',
  'nadie',
  'estabas',
  'estas',
  'estás',
  'orgulloso',
  'orgullosa',
  'infancia',
  'juventud',
  'vida',
  'visitante',
  'familiar',
  'usuario',
  'invitado',
  'querido',
  'querida',
  'amor',
  'corazón',
  'corazon',
  'pista',
  'prueba',
]);

export function isForbiddenProperNameCandidate(candidate: string | undefined | null): boolean {
  const clean = String(candidate || '').trim();
  if (!clean || clean.length < 2) return true;
  const words = clean
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0 || words.length > 3) return true;
  if (words.some((w) => FORBIDDEN_PROPER_NAME_WORDS.has(w))) return true;
  return false;
}

/**
 * Analiza los sentimientos reales documentados en los testimonios hacia un familiar específico.
 */
export function analyzeDocumentedSentimentForRelative(params: {
  mentionedName: string;
  relationshipType: string;
  testimonies: MiEsenciaTestimonyBlock[];
}): {
  tone: MiEsenciaConfirmedInterlocutorIdentity['documentedSentimentTone'];
  description: string;
  sharedMemories: string[];
  documentedNicknames: string[];
} {
  const nameLower = params.mentionedName.toLowerCase();
  const relLower = params.relationshipType.toLowerCase();
  const matchingTexts: string[] = [];
  const sharedMemories: string[] = [];
  const nicknamesSet = new Set<string>();

  for (const t of params.testimonies) {
    const fullText = `${t.answerLiteral} ${t.audioTranscriptionLiteral || ''}`.trim();
    const fullLower = fullText.toLowerCase();
    const matchesByName = nameLower.length >= 2 && fullLower.includes(nameLower);
    const matchesByUniqueSpouseRole =
      (relLower === 'esposa' || relLower === 'esposo') &&
      new RegExp(`\\bmi\\s+${relLower}\\b`, 'i').test(fullText);

    if (matchesByName || matchesByUniqueSpouseRole) {
      matchingTexts.push(fullText);
      sharedMemories.push(fullText.slice(0, 220));
      const nicks = extractAffectionateNicknames(fullText, params.mentionedName);
      nicks.forEach((n) => nicknamesSet.add(n));
    }
  }

  const combined = matchingTexts.join(' ').toLowerCase();

  if (matchingTexts.length === 0) {
    return {
      tone: 'distante_o_poco_documentado',
      description:
        'Existen pocas menciones directas en los testimonios; mantener un trato cálido y respetuoso sin inventar anécdotas ni sentimientos no documentados.',
      sharedMemories: [],
      documentedNicknames: [],
    };
  }

  if (/distante|difícil|complicad|casi no nos veíamos|nos alejamos/i.test(combined)) {
    return {
      tone: 'distante_o_poco_documentado',
      description:
        'La relación fue descrita con reserva o distancia en los testimonios; mantener cordialidad respetuosa y serena sin fingir cercanía artificial.',
      sharedMemories,
      documentedNicknames: Array.from(nicknamesSet),
    };
  }

  if (/orgullos[oa]|gran orgullo|me llena de orgullo|logró|admirable cómo creció/i.test(combined)) {
    return {
      tone: 'orgullo_profundo',
      description: `Expresó profundo orgullo y satisfacción por ${params.mentionedName} (${params.relationshipType}).`,
      sharedMemories,
      documentedNicknames: Array.from(nicknamesSet),
    };
  }

  if (/travesura|reíamos|broma|divertido|nos hacía reír|ocurrencia|chiste/i.test(combined)) {
    return {
      tone: 'humor_fraternal',
      description: `Recordaba con humor, alegría y complicidad las vivencias y travesuras con ${params.mentionedName}.`,
      sharedMemories,
      documentedNicknames: Array.from(nicknamesSet),
    };
  }

  if (
    (/espos[oa]|pareja|mujer|marido|compañer[oa] de vida/i.test(params.relationshipType) ||
      /espos[oa]|compañer[oa] de vida/i.test(combined)) &&
    /admir[oa]|amor de mi vida|pilar|siempre juntos|agradecid[oa] con ella|agradecid[oa] con él|quiero|amo/i.test(
      combined
    )
  ) {
    return {
      tone: 'admiracion_pareja',
      description: `Expresó admiración, gratitud y cariño de pareja hacia ${params.mentionedName}.`,
      sharedMemories,
      documentedNicknames: Array.from(nicknamesSet),
    };
  }

  if (
    /adoro|quiero muchísimo|consentid[oa]|luz de mis ojos|ternura|con todo mi cariño|mi querid[oa]|mi campeón|mi campeona/i.test(
      combined
    )
  ) {
    return {
      tone: 'carino_especial',
      description: `Describió una relación especialmente tierna y cariñosa con ${params.mentionedName} (${params.relationshipType}).`,
      sharedMemories,
      documentedNicknames: Array.from(nicknamesSet),
    };
  }

  return {
    tone: 'afecto_cercano',
    description: `Mencionó a ${params.mentionedName} (${params.relationshipType}) con afecto familiar sincero en sus recuerdos documentados.`,
    sharedMemories,
    documentedNicknames: Array.from(nicknamesSet),
  };
}

/**
 * Consulta automática del Mapa Familiar (Sección 4):
 * Combina relaciones explícitas (mi_esencia_relations) y extracción en vivo sobre testimonios (mi_esencia_testimonies)
 * para recuperar familiares por nombre, apodo o parentesco (ej. "esposa", "hijos", "hija", "nieta").
 */
export function queryFamilyMapFromLegacy(params: {
  relations: MiEsenciaRelatedPerson[];
  testimonies: MiEsenciaTestimonyBlock[];
  avatarId?: string;
  personId?: string;
  queryNameOrNickname?: string;
  queryRelationship?: string;
  relationshipRole?: string;
}): MiEsenciaRelatedPerson[] {
  const extractedFromTestimonies = extractRelatedPersonsFromTestimonies(
    params.avatarId || 'av_lookup',
    params.personId || 'p_lookup',
    params.testimonies
  );

  // Unificar relaciones almacenadas y relaciones extraídas de los testimonios sin duplicar
  const unifiedMap = new Map<string, MiEsenciaRelatedPerson>();
  for (const r of [...params.relations, ...extractedFromTestimonies]) {
    if (!r.mentionedName || isForbiddenProperNameCandidate(r.mentionedName)) continue;
    const key = `${r.relationshipType.toLowerCase()}:${r.mentionedName.toLowerCase()}`;
    const existing = unifiedMap.get(key);
    if (!existing) {
      unifiedMap.set(key, {
        ...r,
        affectionateNicknames: [...(r.affectionateNicknames || [])],
      });
    } else {
      for (const nick of r.affectionateNicknames || []) {
        if (!existing.affectionateNicknames.includes(nick)) {
          existing.affectionateNicknames.push(nick);
        }
      }
    }
  }

  let candidates = Array.from(unifiedMap.values());

  if (params.queryNameOrNickname) {
    const qName = params.queryNameOrNickname.trim().toLowerCase();
    const firstToken = qName.split(/\s+/)[0];
    candidates = candidates.filter((rel) => {
      const relLower = rel.mentionedName.toLowerCase();
      const relFirst = relLower.split(/\s+/)[0];
      const matchesName =
        relLower === qName ||
        relFirst === firstToken ||
        relLower.includes(qName) ||
        qName.includes(relFirst);
      const matchesNick = (rel.affectionateNicknames || []).some(
        (n) => n.toLowerCase() === qName || n.toLowerCase() === firstToken
      );
      return matchesName || matchesNick;
    });
  }

  const targetRel = params.queryRelationship || params.relationshipRole;
  if (targetRel) {
    const qRel = targetRel.trim().toLowerCase();
    const canonicalRel = (VALID_KINSHIP_MAP[qRel] || qRel).toLowerCase();
    candidates = candidates.filter((rel) => {
      const rType = rel.relationshipType.toLowerCase();
      if (qRel === 'hijos' || qRel === 'hijo' || qRel === 'hija') {
        if (qRel === 'hijos') return rType === 'hijo' || rType === 'hija';
        return rType === canonicalRel;
      }
      if (qRel === 'nietos') {
        return rType === 'nieto' || rType === 'nieta';
      }
      if (qRel === 'hermanos') {
        return rType === 'hermano' || rType === 'hermana';
      }
      return rType === canonicalRel;
    });
  }

  return candidates;
}

/**
 * Clasificador contextual de mensajes de «Mi Esencia» (Secciones 3, 8, 9, 10 y 15.A):
 * Separa estrictamente la intención del mensaje de la extracción de nombres y parentescos.
 */
export interface ClassifiedConversationalMessage {
  isGuessingGame: boolean;
  isIdentityCorrection: boolean;
  rejectedNameInCorrection?: string;
  isSelfIdentityDeclaration: boolean;
  declaredProperName?: string;
  declaredRelationship?: string;
  isAskingOwnName: boolean;
  isAskingOwnIdentity: boolean;
  isAskingOwnNickname: boolean;
  isAskingFamilyFact: boolean;
  queriedFamilyRole?: 'esposa' | 'esposo' | 'hijos' | 'hija' | 'hijo' | 'nietos' | 'hermanos';
  familyFactTargetRole?: string;
  queriedThirdPartyName?: string;
  isEmotionalQuestion: boolean;
  isAutobiographicalQuestion: boolean;
  isPresentAdviceRequest: boolean;
  isTransparencyQuestion: boolean;
  isEverydaySmallTalk: boolean;
}

export function classifyConversationalMessage(rawMessage: string): ClassifiedConversationalMessage {
  const msg = String(rawMessage || '').trim();
  const lower = msg.toLowerCase();

  // 1. Detectar juego o adivinanza ("Adivina quién soy", "No, quiero que tú adivines quién soy yo", "Dame una pista")
  const isGuessingGame =
    /\badivina\s+qui[eé]n\s+soy\b|\bquiero\s+que\s+(?:t[uú]\s+)?adivines\b|\ba\s+que\s+no\s+adivinas\b|\bqui[eé]n\s+crees\s+que\s+soy\b|\badivinar\s+qui[eé]n\s+soy\b/i.test(
      msg
    );

  // 2. Detectar corrección explícita de identidad ("No me llamo Adivina", "Yo no soy Adivina", "No soy tu hija")
  const correctionNameMatch = msg.match(
    /\bno\s+me\s+llamo\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+)|\byo\s+no\s+soy\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+)|\bmi\s+nombre\s+no\s+es\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+)/i
  );
  const rejectedNameInCorrection = correctionNameMatch
    ? (correctionNameMatch[1] || correctionNameMatch[2] || correctionNameMatch[3] || '').trim()
    : undefined;
  const isIdentityCorrection =
    Boolean(rejectedNameInCorrection) ||
    /\bte\s+equivocaste\s+de\s+nombre\b|\bese\s+no\s+es\s+mi\s+nombre\b/i.test(msg);

  // 3. Detectar preguntas directas sobre el propio nombre, identidad o apodo del interlocutor
  const isAskingOwnName =
    /¿?\bc[oó]mo\s+me\s+llamo\b|\brecuerdas\s+c[oó]mo\s+me\s+llamo\b|\bsabes\s+c[oó]mo\s+me\s+llamo\b|\bte\s+acuerdas\s+de\s+mi\s+nombre\b|\bcu[aá]l\s+es\s+mi\s+nombre\b/i.test(
      msg
    );

  const isAskingOwnIdentity =
    /¿?\bsabes\s+qui[eé]n\s+soy\b|\brecuerdas\s+qui[eé]n\s+soy\b|\bte\s+acuerdas\s+de\s+m[ií]\b|\bme\s+recuerdas\b/i.test(
      msg
    );

  const isAskingOwnNickname =
    /\bc[oó]mo\s+me\s+dec[ií]as(?:\s+de\s+cariño)?\b|\bc[oó]mo\s+me\s+llamabas\s+de\s+cariño\b|\bcu[aá]l\s+era\s+mi\s+apodo\b|\bqu[eé]\s+apodo\s+me\s+dec[ií]as\b/i.test(
      msg
    );

  // 4. Detectar preguntas sobre terceros o datos del mapa familiar ("¿Cómo se llaman nuestros hijos?", "¿Cómo se llama mi esposa?", "¿Recuerdas a Sofía?")
  let queriedFamilyRole: ClassifiedConversationalMessage['queriedFamilyRole'];
  let familyFactTargetRole: string | undefined;
  if (
    /\bc[oó]mo\s+se\s+llaman\s+(?:nuestros|tus|mis)\s+hijos\b|\bqui[eé]nes\s+son\s+(?:nuestros|tus)\s+hijos\b|\bcu[aá]ntos\s+hijos\s+tienes\b/i.test(
      msg
    )
  ) {
    queriedFamilyRole = 'hijos';
    familyFactTargetRole = 'Hijos';
  } else if (
    /\bc[oó]mo\s+se\s+llama(?:ba)?\s+(?:tu|mi)\s+esposa\b|\bqui[eé]n\s+es\s+tu\s+esposa\b/i.test(
      msg
    )
  ) {
    queriedFamilyRole = 'esposa';
    familyFactTargetRole = 'Esposa';
  } else if (
    /\bc[oó]mo\s+se\s+llama(?:ba)?\s+(?:tu|mi)\s+esposo\b|\bqui[eé]n\s+es\s+tu\s+esposo\b/i.test(
      msg
    )
  ) {
    queriedFamilyRole = 'esposo';
    familyFactTargetRole = 'Esposo';
  } else if (/\bc[oó]mo\s+se\s+llaman\s+tus\s+nietos\b/i.test(msg)) {
    queriedFamilyRole = 'nietos';
    familyFactTargetRole = 'Nietos';
  } else if (/\bc[oó]mo\s+se\s+llaman\s+tus\s+hermanos\b/i.test(msg)) {
    queriedFamilyRole = 'hermanos';
    familyFactTargetRole = 'Hermanos';
  }

  let queriedThirdPartyName: string | undefined;
  const thirdPartyMatch = msg.match(
    /(?:recuerdas\s+a|te\s+acuerdas\s+de|qu[eé]\s+recuerdas\s+de|qui[eé]n\s+es|conoces\s+a)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,20})/i
  );
  if (thirdPartyMatch && thirdPartyMatch[1] && !isForbiddenProperNameCandidate(thirdPartyMatch[1])) {
    queriedThirdPartyName = thirdPartyMatch[1].trim();
  }

  const isAskingFamilyFact = Boolean(queriedFamilyRole || queriedThirdPartyName);

  // 5. Detectar declaración de identidad propia ("Soy Sofía", "Me llamo Martín", "Soy tu esposa", "Soy tu hija", "Soy Ana, tu hija", "Soy amigo de tu nieto")
  let declaredRelationship: string | undefined;
  let declaredProperName: string | undefined;

  if (!isGuessingGame && !queriedThirdPartyName) {
    // ¿Declara parentesco explícito en primera persona?
    // 1. Directo tras "soy [tu/un/una] <rol>" (ej. "Soy tu esposa", "Soy amigo de tu nieto")
    const directRelMatch = msg.match(
      /\b(?:soy|habla|aqu[ií]\s+est[aá])\s+(?:(?:tu|un|una|el|la)\s+)?(esposa|esposo|mujer|marido|pareja|hija|hijo|nieta|nieto|hermana|hermano|madre|mamá|padre|papá|abuela|abuelo|sobrina|sobrino|prima|primo|tía|tío|nuera|yerno|cuñada|cuñado|amiga|amigo|vecina|vecino)\b/i
    );
    // 2. Tras decir su nombre propio ("Soy Sofía, tu nieta", "Soy Ana Sofía, tu hija", "Soy Martín, un amigo")
    const afterNameRelMatch = msg.match(
      /\b(?:soy|habla|aqu[ií]\s+est[aá]|me\s+llamo)\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+)?,?\s+(?:y\s+soy\s+)?(?:tu|un|una|su)\s+(esposa|esposo|mujer|marido|pareja|hija|hijo|nieta|nieto|hermana|hermano|madre|mamá|padre|papá|abuela|abuelo|sobrina|sobrino|prima|primo|tía|tío|nuera|yerno|cuñada|cuñado|amiga|amigo|vecina|vecino)\b/i
    );
    const matchedRelToken =
      (directRelMatch && directRelMatch[1]) || (afterNameRelMatch && afterNameRelMatch[1]);
    if (matchedRelToken) {
      const rawRel = matchedRelToken.toLowerCase();
      declaredRelationship = VALID_KINSHIP_MAP[rawRel] || rawRel;
    }

    // ¿Declara nombre propio explícito? ("Soy Sofía", "Me llamo Martín", "Habla Andrés")
    const selfNamePatterns = [
      /\b(?:me\s+llamo|mi\s+nombre\s+es)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,20}(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,20})?)/i,
      /\b(?:soy|habla)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,20}(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,20})?)/i,
    ];

    for (const pat of selfNamePatterns) {
      const m = msg.match(pat);
      if (m && m[1]) {
        const candidate = m[1]
          .replace(/\b(?:tu|un|una|el|la|su|mi)\b[\s\S]*$/i, '')
          .trim();
        if (!isForbiddenProperNameCandidate(candidate)) {
          declaredProperName =
            candidate.charAt(0).toUpperCase() + candidate.slice(1);
          break;
        }
      }
    }
  }

  const isSelfIdentityDeclaration = Boolean(declaredProperName || declaredRelationship);

  // 6. Detectar pregunta emocional ("¿Estabas orgulloso de mí?", "¿Me querías?", "¿Qué sentías por mí?")
  const isEmotionalQuestion =
    /orgullos[oa]\s+de\s+m[ií]|me\s+quer[ií]as|qu[eé]\s+sent[ií]as\s+por\s+m[ií]|qu[eé]\s+significaba\s+yo\s+para\s+ti|te\s+hac[ií]a\s+feliz|me\s+extrañabas/i.test(
      msg
    );

  // 7. Detectar petición de consejo o reflexión sobre situaciones presentes (Sección 5 TIPO 5 y Sección 11)
  // Ej.: "¿Qué me aconsejarías hoy?", "¿Qué harías tú en mi lugar?", "Tengo una decisión difícil hoy, ¿qué consejo me das?", "¿Qué opinas de lo que me está pasando ahora?"
  const isPresentAdviceRequest =
    /\bqu[eé]\s+me\s+aconsejar[ií]as|\bqu[eé]\s+me\s+aconsejas|\bqu[eé]\s+consejo\s+me\s+das|\bqu[eé]\s+har[ií]as\s+(?:t[uú]\s+)?en\s+mi\s+lugar|\bdame\s+un\s+consejo\s+para\s+hoy|\bdecisi[oó]n\s+dif[ií]cil|\bestoy\s+pasando\s+por\s+un\s+momento|\bno\s+s[eé]\s+qu[eé]\s+decisi[oó]n\s+tomar|\bqu[eé]\s+opinas\s+de\s+lo\s+que\s+(?:me\s+)?pasa\s+hoy/i.test(
      msg
    );

  // 7B. Detectar pregunta sobre transparencia / naturaleza de la recreación digital (Sección 12)
  const isTransparencyQuestion =
    /\beres\s+una?\s+(?:ia|inteligencia\s+artificial|recreaci[oó]n|programa|robot)\b|\best[aá]s\s+vivo\s+de\s+verdad\b|\bc[oó]mo\s+funciona\s+(?:esta\s+recreaci[oó]n|mi\s+esencia)\b|\beres\s+realmente\s+t[uú]\b/i.test(
      msg
    );

  // 8. Detectar pregunta autobiográfica ("Cuéntame cómo fue tu infancia", "Háblame de tu juventud", "¿Dónde naciste?")
  const isAutobiographicalQuestion =
    !isPresentAdviceRequest &&
    /infancia|juventud|adultez|madurez|niñez|c[oó]mo\s+fue\s+tu|cu[eé]ntame\s+de\s+tu|d[oó]nde\s+naciste|recuerdos\s+m[aá]s\s+felices|consejo\s+de\s+vida|historia\s+de\s+tu\s+vida|casa\s+de\s+tus\s+abuelos/i.test(
      msg
    );

  // 9. Detectar conversación cotidiana breve ("¿Cómo estás?", "Hoy tuve un día pesado.", "Solo pasaba a saludarte")
  const isEverydaySmallTalk =
    !isAskingOwnName &&
    !isAskingOwnIdentity &&
    !isAskingOwnNickname &&
    !isAskingFamilyFact &&
    !isEmotionalQuestion &&
    !isAutobiographicalQuestion &&
    !isPresentAdviceRequest &&
    !isTransparencyQuestion &&
    !isGuessingGame &&
    !isSelfIdentityDeclaration &&
    (/^(?:¡?hola!?[,.]?\s*)?¿?\s*(?:c[oó]mo\s+est[aá]s|c[oó]mo\s+te\s+encuentras|qu[eé]\s+tal|c[oó]mo\s+va\s+todo|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches)\s*\??$/i.test(
      lower
    ) ||
      /\bc[oó]mo\s+est[aá]s\b|\bd[ií]a\s+pesado\b|\bestoy\s+cansad[oa]\b|\bsolo\s+pasaba\s+a\s+saludar/i.test(
        lower
      ));

  return {
    isGuessingGame,
    isIdentityCorrection,
    rejectedNameInCorrection,
    isSelfIdentityDeclaration,
    declaredProperName,
    declaredRelationship,
    isAskingOwnName,
    isAskingOwnIdentity,
    isAskingOwnNickname,
    isAskingFamilyFact,
    queriedFamilyRole,
    familyFactTargetRole,
    queriedThirdPartyName,
    isEmotionalQuestion,
    isAutobiographicalQuestion,
    isPresentAdviceRequest,
    isTransparencyQuestion,
    isEverydaySmallTalk,
  };
}

/**
 * SECCIÓN 5 — CLASIFICACIÓN INTERNA DEL TIPO DE RESPUESTA (TIPO 1 a TIPO 8)
 * Esta clasificación es estrictamente interna y nunca debe mostrarse en la respuesta visible al usuario.
 */
export type MiEsenciaInternalResponseType =
  | 'TIPO_1_RECUERDO_DOCUMENTADO'
  | 'TIPO_2_SINTESIS_DOCUMENTADA'
  | 'TIPO_3_CONOCIMIENTO_PARCIAL'
  | 'TIPO_4_DESCONOCIDO'
  | 'TIPO_5_CONSEJO_NUEVO'
  | 'TIPO_6_MEMORIA_APORTADA'
  | 'TIPO_7_IDENTIDAD_AMBIGUA'
  | 'TIPO_8_CONTENIDO_RESTRINGIDO';

export function classifyInternalResponseType(params: {
  userMessage: string;
  classification?: ClassifiedConversationalMessage;
  privacyIntent?: ReturnType<typeof detectConversationalIntentAndPrivacy>;
  identityState?: MiEsenciaIdentityState;
  relevantTestimoniesCount: number;
  hasPartialContext?: boolean;
}): MiEsenciaInternalResponseType {
  const cls = params.classification || classifyConversationalMessage(params.userMessage);
  const privacy =
    params.privacyIntent || detectConversationalIntentAndPrivacy(params.userMessage);

  // TIPO 8 — CONTENIDO RESTRINGIDO: La información pertenece a otra persona o nivel de privacidad no autorizado.
  if (privacy.attemptsToExtractOthersSecrets || privacy.attemptsToAlterBaseTruth) {
    return 'TIPO_8_CONTENIDO_RESTRINGIDO';
  }

  // TIPO 6 — MEMORIA APORTADA POR EL INTERLOCUTOR: El interlocutor comparte información nueva o recuerdos propios.
  if (privacy.wantsToSaveMemory || privacy.reportsContradiction) {
    return 'TIPO_6_MEMORIA_APORTADA';
  }

  // TIPO 7 — IDENTIDAD AMBIGUA: Aún no se ha confirmado con certeza quién es el interlocutor o hay homónimos pendientes.
  if (
    params.identityState === 'awaiting_homonym_clarification' ||
    params.identityState === 'awaiting_relationship_clarification' ||
    (cls.isSelfIdentityDeclaration && !cls.declaredProperName && Boolean(cls.declaredRelationship))
  ) {
    return 'TIPO_7_IDENTIDAD_AMBIGUA';
  }

  // TIPO 5 — CONSEJO O REFLEXIÓN SOBRE SITUACIONES NUEVAS: Orientación sobre algo actual no vivido directamente.
  if (cls.isPresentAdviceRequest) {
    return 'TIPO_5_CONSEJO_NUEVO';
  }

  // TIPO 1 / TIPO 2 / TIPO 3 / TIPO 4 según el soporte documental
  if (params.relevantTestimoniesCount >= 2) {
    return 'TIPO_2_SINTESIS_DOCUMENTADA';
  }
  if (params.relevantTestimoniesCount === 1) {
    return params.hasPartialContext ? 'TIPO_3_CONOCIMIENTO_PARCIAL' : 'TIPO_1_RECUERDO_DOCUMENTADO';
  }
  if (params.hasPartialContext) {
    return 'TIPO_3_CONOCIMIENTO_PARCIAL';
  }
  return 'TIPO_4_DESCONOCIDO';
}

/**
 * SECCIÓN 5 (TIPO 5) Y SECCIÓN 11 — CONVERSACIONES SOBRE EL PRESENTE
 * Cuando el interlocutor pide consejo u opinión sobre una situación actual, ofrece una reflexión
 * prudente inspirada en los valores, aprendizajes y estilo comunicativo documentados,
 * sin presentar la opinión como cita histórica ni inventar experiencias actuales.
 */
export function buildPrudentPresentAdviceReply(params: {
  person: MiEsenciaPersonProfile;
  testimonies: MiEsenciaTestimonyBlock[];
  confirmedIdentity?: MiEsenciaConfirmedInterlocutorIdentity;
}): string {
  const call =
    params.confirmedIdentity?.affectionateNickname ||
    params.confirmedIdentity?.declaredName ||
    '';
  const address = call ? `, ${call}` : '';

  const valuesSnippet =
    params.person.valuesAndPhilosophy?.[0] ||
    params.testimonies.find((t) => /consejo|aprend[ií]|valor|familia|vida/i.test(t.answerLiteral))
      ?.answerLiteral ||
    '';

  if (valuesSnippet) {
    const cleanValue = valuesSnippet
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\.$/, '');
    return `Si te sirve mi forma de ver las cosas${address}, yo siempre he pensado que en los momentos importantes vale la pena actuar con calma y fidelidad a lo que uno valora: «${cleanValue}». Tómalo con serenidad, escucha a tu corazón y confía en tu criterio. ¿Quieres contarme un poquito más de cómo te sientes con eso?`;
  }

  return `Si te sirve cómo suelo ver las cosas${address}, cuando uno tiene enfrente una decisión o un momento nuevo, lo mejor es respirar con calma, pensar en lo que da tranquilidad a la conciencia y cuidar a quienes queremos. Confío mucho en tu buen juicio. ¿Quieres platicarme un poco más de lo que tienes en mente?`;
}

/**
 * SECCIÓN 8 — MANEJO DE INFORMACIÓN DESCONOCIDA
 * Expresa con naturalidad y calidez cuando un detalle específico no figura en los recuerdos que conserva,
 * evitando fórmulas técnicas o rígidas e invitando al interlocutor a compartir su propio recuerdo.
 */
export function buildNaturalUnknownInfoReply(params?: {
  confirmedIdentity?: MiEsenciaConfirmedInterlocutorIdentity;
  topicHint?: string;
}): string {
  const call =
    params?.confirmedIdentity?.affectionateNickname ||
    params?.confirmedIdentity?.declaredName ||
    '';
  const address = call ? `, ${call}` : '';

  if (params?.topicHint) {
    return `No tengo ese detalle sobre ${params.topicHint} entre los recuerdos que conservo${address}, así que prefiero no inventarlo. ¿Tú qué recuerdas de eso o cómo lo viviste?`;
  }

  return `No tengo ese detalle entre los recuerdos que conservo${address}, y me gustaría poder darte una respuesta más precisa sin inventar nada. ¿Me recuerdas un poquito o me cuentas cómo lo recuerdas tú?`;
}

/**
 * Genera el saludo inicial reflexivo (Sección 2 y Sección 13):
 * - Cálido, natural y conciso (entre 40 y 90 palabras).
 * - Basado en la personalidad documentada sin repetir frases forzadas.
 * - Termina con una pregunta natural para conocer quién está conversando.
 */
export function buildVariedInitialReflectiveGreeting(params: {
  person: MiEsenciaPersonProfile;
  testimonies: MiEsenciaTestimonyBlock[];
  previousThemesUsed?: MiEsenciaReflectionTheme[];
  sessionIndex?: number;
}): {
  greetingText: string;
  themeUsed: MiEsenciaReflectionTheme;
  usedDocumentedLegacy: boolean;
  wordCount: number;
} {
  const prevThemes = params.previousThemesUsed || [];
  const lastTheme = prevThemes.length > 0 ? prevThemes[prevThemes.length - 1] : undefined;

  const availableThemes = ALL_REFLECTION_THEMES.filter((t) => t !== lastTheme);
  const idx =
    typeof params.sessionIndex === 'number'
      ? params.sessionIndex % availableThemes.length
      : prevThemes.length % availableThemes.length;
  const themeUsed = availableThemes[idx] || 'compartir_historias';

  const combinedTestimonyText = params.testimonies
    .map((t) => t.answerLiteral.trim())
    .filter((txt) => txt.length > 20)
    .join(' ');

  const hasSufficientLegacy =
    params.testimonies.length > 0 && combinedTestimonyText.length >= 60;

  const closingQuestions = [
    '¿Con quién tengo el gusto de conversar hoy?',
    '¿Quién me acompaña hoy para platicar un rato?',
    '¿Con quién tengo la alegría de platicar en este momento?',
    'Cuéntame, ¿quién vino a saludarme hoy?',
  ];
  const questionIdx = (params.sessionIndex ?? prevThemes.length) % closingQuestions.length;
  const closingQuestion = closingQuestions[questionIdx];

  if (!hasSufficientLegacy) {
    const universalReflections: Record<MiEsenciaReflectionTheme, string> = {
      valor_familia:
        '¡Hola! Qué alegría recibirte hoy por aquí.\n\nTomarse un momento de calma para acercarse a los nuestros y conversar con tranquilidad siempre reconforta el corazón. Un saludo sincero y unas palabras compartidas hacen que cualquier día sea más cálido.\n\nAntes de comenzar nuestra charla, me encantaría saber algo…\n\n' +
        closingQuestion,
      recuerdos:
        '¡Hola! Qué gusto que te acerques a platicar un momento.\n\nAbrir un espacio para conversar con serenidad y recordar juntos es una forma hermosa de mantenernos cerca. Cada charla trae consigo la calidez de quien se detiene a saludar.\n\nPara empezar este encuentro como se debe, dime por favor…\n\n' +
        closingQuestion,
      paso_del_tiempo:
        '¡Hola! Qué bueno coincidir contigo en este día.\n\nCon el paso del tiempo, uno valora cada vez más la sencillez de una buena plática sin prisas. Dedicar unos minutos a escucharnos con afecto siempre deja una grata sensación.\n\nAntes de seguir conversando, me gustaría preguntarte…\n\n' +
        closingQuestion,
      carino_generaciones:
        '¡Hola! Qué alegría tenerte de visita hoy.\n\nLos lazos que nos unen a través de las palabras y del afecto sincero hacen que cada encuentro tenga un valor muy especial. Qué gusto poder compartir este momento contigo.\n\nPero antes de comenzar a platicar, cuéntame…\n\n' +
        closingQuestion,
      amistad:
        '¡Hola! Qué gusto saludarte y recibirte hoy.\n\nAcercarse con amabilidad para compartir unas palabras es un gesto que siempre se agradece de corazón. Una conversación sincera ilumina cualquier momento del día.\n\nPara saber a quién tengo la alegría de saludar…\n\n' +
        closingQuestion,
      ensenanzas_vida:
        '¡Hola! Qué alegría que estés por aquí hoy.\n\nCada conversación tranquila nos regala la oportunidad de escucharnos y compartir lo que llevamos dentro con sencillez y cercanía. Me da mucho gusto coincidir contigo.\n\nAntes de que empecemos a platicar, dime…\n\n' +
        closingQuestion,
      gratitud:
        '¡Hola! Qué bonito gesto que pases a saludar hoy.\n\nSiempre es motivo de alegría detenerse un instante para conversar con calma y agradecer la compañía de quienes se acercan con afecto.\n\nPero antes de comenzar nuestra plática, me gustaría saber…\n\n' +
        closingQuestion,
      momentos_cotidianos:
        '¡Hola! Qué gusto tenerte por aquí en este momento.\n\nA veces los instantes más sencillos, como sentarse a conversar unos minutos con calma, son los que más reconfortan el ánimo.\n\nAntes de empezar a platicar con toda confianza, dime…\n\n' +
        closingQuestion,
      compartir_historias:
        '¡Hola! Qué alegría tenerte por aquí.\n\nLas buenas conversaciones siempre acercan a las personas; no hay nada como compartir unas palabras o un recuerdo con alguien que se acerca con cariño.\n\nPero antes de comenzar, me gustaría saber algo…\n\n' +
        closingQuestion,
    };

    const greetingText = universalReflections[themeUsed];
    const wordCount = greetingText.trim().split(/\s+/).length;
    return {
      greetingText,
      themeUsed,
      usedDocumentedLegacy: false,
      wordCount,
    };
  }

  const personalizedByTheme: Record<MiEsenciaReflectionTheme, string> = {
    valor_familia: `¡Hola! Qué gusto tenerte por aquí hoy.\n\nHay algo muy especial en poder sentarnos con calma a conversar, saber cómo está la familia y compartir un momento juntos sin prisas.\n\nPero antes de comenzar nuestra plática, cuéntame algo…\n\n${closingQuestion}`,
    recuerdos: `¡Hola! Qué alegría recibirte por aquí.\n\nLos recuerdos que guardamos cobran vida de nuevo cada vez que los platicamos con alguien cercano. Recordar juntos es volver a compartir lo que hemos vivido.\n\nAntes de empezar a conversar, dime por favor…\n\n${closingQuestion}`,
    paso_del_tiempo: `¡Hola! Qué gusto que te acerques a platicar conmigo.\n\nCon el paso de los años uno comprende que lo que realmente permanece son los momentos de cercanía y las buenas conversaciones que compartimos con calma.\n\nPero antes de comenzar este encuentro, cuéntame…\n\n${closingQuestion}`,
    carino_generaciones: `¡Hola! Qué bonito tenerte de visita hoy.\n\nEl cariño que nos une a través del tiempo se mantiene vivo cuando seguimos conversando, escuchándonos y compartiendo nuestras historias.\n\nAntes de que platiquemos a gusto, me encantaría saber…\n\n${closingQuestion}`,
    amistad: `¡Hola! Qué gusto coincidir contigo en este momento.\n\nNo hay gesto más grato que acercarse a saludar y compartir una buena charla llena de confianza y cercanía.\n\nPero antes de comenzar, me gustaría saber algo…\n\n${closingQuestion}`,
    ensenanzas_vida: `¡Hola! Qué alegría recibirte hoy para platicar.\n\nA lo largo del camino uno aprende que cada experiencia vivida cobra más sentido cuando podemos platicarla con quienes se acercan a escucharnos.\n\nAntes de iniciar nuestra conversación, dime…\n\n${closingQuestion}`,
    gratitud: `¡Hola! Qué gusto tan especial tenerte por aquí.\n\nSiempre da mucha alegría cuando alguien dedica un ratito tranquilo para venir a saludar, platicar y ponerse al día.\n\nPero antes de empezar a conversar, dime por favor…\n\n${closingQuestion}`,
    momentos_cotidianos: `¡Hola! Qué alegría que pases a saludarme hoy.\n\nEstos ratitos sencillos de plática tranquila, como una buena sobremesa en confianza, son de las cosas que más se disfrutan.\n\nAntes de comenzar nuestra charla, me gustaría saber…\n\n${closingQuestion}`,
    compartir_historias: `¡Hola! Qué gusto tenerte por aquí.\n\nHay algo muy bonito en poder sentarnos a conversar, recordar historias y compartir un momento agradable juntos.\n\nPero antes de comenzar, cuéntame algo…\n\n${closingQuestion}`,
  };

  const greetingText = personalizedByTheme[themeUsed];
  const wordCount = greetingText.trim().split(/\s+/).length;
  return {
    greetingText,
    themeUsed,
    usedDocumentedLegacy: true,
    wordCount,
  };
}

/**
 * Motor contextual de reconocimiento y actualización de identidad (Secciones 3, 4 y 5).
 * Distingue estrictamente entre:
 * - IDENTIDAD DESCONOCIDA ('identidad_desconocida')
 * - IDENTIDAD DECLARADA ('identidad_declarada')
 * - IDENTIDAD VINCULADA ('identidad_vinculada')
 * Y jamás confunde instrucciones ("Adivina quién soy") o parentescos ("Soy tu esposa", "Soy tu hija") con nombres propios.
 */
export function identifyInterlocutorFromLegacy(params: {
  userMessage: string;
  relations: MiEsenciaRelatedPerson[];
  testimonies: MiEsenciaTestimonyBlock[];
  currentIdentityState?: MiEsenciaIdentityState;
  currentConfirmedIdentity?: MiEsenciaConfirmedInterlocutorIdentity;
  existingConfirmedIdentity?: MiEsenciaConfirmedInterlocutorIdentity;
  rejectedNames?: string[];
  pendingHomonymCandidates?: MiEsenciaConversationSession['pendingHomonymCandidates'];
  pendingUnregisteredName?: string;
  pendingName?: string;
}): {
  newIdentityState: MiEsenciaIdentityState;
  identityCertainty: MiEsenciaIdentityCertainty;
  confirmedIdentity?: MiEsenciaConfirmedInterlocutorIdentity;
  homonymCandidates?: MiEsenciaConversationSession['pendingHomonymCandidates'];
  unregisteredName?: string;
  rejectedName?: string;
  rejectedNames: string[];
  classification: ClassifiedConversationalMessage;
  matchedFamilyCandidatesByRole?: MiEsenciaRelatedPerson[];
} {
  const classification = classifyConversationalMessage(params.userMessage);
  const rejectedNames = [...(params.rejectedNames || [])];
  const initialConfirmed = params.currentConfirmedIdentity || params.existingConfirmedIdentity;
  let currentConfirmed = initialConfirmed
    ? {
        ...initialConfirmed,
        documentedSharedMemories: [...(initialConfirmed.documentedSharedMemories || [])],
      }
    : undefined;

  const pendingUnregistered = params.pendingUnregisteredName || params.pendingName;

  // 1. Si el usuario corrige un nombre ("No me llamo Adivina"), eliminarlo de inmediato del estado
  let rejectedName: string | undefined;
  if (classification.isIdentityCorrection) {
    if (classification.rejectedNameInCorrection) {
      rejectedName = classification.rejectedNameInCorrection;
      rejectedNames.push(classification.rejectedNameInCorrection.toLowerCase());
      if (
        currentConfirmed?.declaredName &&
        currentConfirmed.declaredName.toLowerCase() ===
          classification.rejectedNameInCorrection.toLowerCase()
      ) {
        currentConfirmed.declaredName = undefined;
        currentConfirmed.affectionateNickname = undefined;
        currentConfirmed.isDocumentedInLegacy = false;
        currentConfirmed.identityCertainty = currentConfirmed.relationshipToPerson
          ? 'identidad_declarada'
          : 'identidad_desconocida';
      }
    } else if (pendingUnregistered) {
      rejectedName = pendingUnregistered;
      rejectedNames.push(pendingUnregistered.toLowerCase());
    } else if (currentConfirmed) {
      rejectedName = currentConfirmed.declaredName;
      currentConfirmed.declaredName = undefined;
      currentConfirmed.affectionateNickname = undefined;
      currentConfirmed.isDocumentedInLegacy = false;
      currentConfirmed.identityCertainty = 'identidad_desconocida';
    }

    if (!classification.declaredProperName && !classification.declaredRelationship) {
      const certainty = currentConfirmed?.relationshipToPerson
        ? 'identidad_declarada'
        : 'identidad_desconocida';
      return {
        newIdentityState:
          certainty === 'identidad_declarada' ? 'identidad_declarada' : 'awaiting_identification',
        identityCertainty: certainty,
        confirmedIdentity: currentConfirmed?.relationshipToPerson ? currentConfirmed : undefined,
        rejectedName,
        rejectedNames,
        classification,
      };
    }
  }

  // 2. Si el mensaje es un juego de adivinanza ("Adivina quién soy", "No, quiero que tú adivines quién soy yo")
  //    NO asignar identidades ni extraer nombres ni parentescos del mensaje. Conservar el estado previo.
  if (classification.isGuessingGame) {
    const prevCertainty =
      currentConfirmed?.identityCertainty ||
      (currentConfirmed?.isDocumentedInLegacy
        ? 'identidad_vinculada'
        : currentConfirmed?.declaredName || currentConfirmed?.relationshipToPerson
        ? 'identidad_declarada'
        : 'identidad_desconocida');

    return {
      newIdentityState: params.currentIdentityState || 'awaiting_identification',
      identityCertainty: prevCertainty,
      confirmedIdentity: currentConfirmed,
      rejectedName,
      rejectedNames,
      classification,
    };
  }

  // 3. Si estábamos esperando aclaración entre homónimos (o múltiples familiares con el mismo rol)
  if (
    params.currentIdentityState === 'awaiting_homonym_clarification' &&
    params.pendingHomonymCandidates &&
    params.pendingHomonymCandidates.length > 0
  ) {
    const matchedCandidate = params.pendingHomonymCandidates.find((c) => {
      if (
        classification.declaredProperName &&
        c.mentionedName.toLowerCase() === classification.declaredProperName.toLowerCase()
      ) {
        return true;
      }
      if (
        classification.declaredRelationship &&
        c.relationshipType.toLowerCase() === classification.declaredRelationship.toLowerCase()
      ) {
        return true;
      }
      return false;
    });
    if (matchedCandidate) {
      const sentiment = analyzeDocumentedSentimentForRelative({
        mentionedName: matchedCandidate.mentionedName,
        relationshipType: matchedCandidate.relationshipType,
        testimonies: params.testimonies,
      });
      return {
        newIdentityState: 'confirmed_known_family',
        identityCertainty: 'identidad_vinculada',
        confirmedIdentity: {
          declaredName: matchedCandidate.mentionedName,
          relationshipToPerson: matchedCandidate.relationshipType,
          affectionateNickname:
            sentiment.documentedNicknames[0] || matchedCandidate.affectionateNicknames[0],
          identityCertainty: 'identidad_vinculada',
          informationSource: 'mapa_familiar_nivel_a',
          documentedSentimentTone: sentiment.tone,
          documentedSentimentDescription: sentiment.description,
          documentedSharedMemories: sentiment.sharedMemories,
          isDocumentedInLegacy: true,
          matchedRelatedPersonId: matchedCandidate.relatedPersonId,
        },
        rejectedName,
        rejectedNames,
        classification,
      };
    }
  }

  // 4. Si estábamos esperando aclaración de parentesco para un nombre no registrado y el usuario da un parentesco válido
  if (
    params.currentIdentityState === 'awaiting_relationship_clarification' &&
    pendingUnregistered &&
    !isForbiddenProperNameCandidate(pendingUnregistered) &&
    classification.declaredRelationship
  ) {
    return {
      newIdentityState: 'confirmed_unregistered_visitor',
      identityCertainty: 'identidad_declarada',
      confirmedIdentity: {
        declaredName: pendingUnregistered,
        relationshipToPerson: classification.declaredRelationship,
        identityCertainty: 'identidad_declarada',
        informationSource: 'declaracion_conversacional',
        documentedSentimentTone: 'visitante_no_registrado',
        documentedSentimentDescription:
          'Persona cuya identidad fue declarada en conversación pero no figura en los testimonios originales.',
        documentedSharedMemories: [],
        isDocumentedInLegacy: false,
      },
      rejectedName,
      rejectedNames,
      classification,
    };
  }

  // 5. Si el mensaje NO contiene declaración de identidad propia ("¿Cómo estás?", "¿Cómo me llamo?", "¿Recuerdas a Sofía?"),
  //    conservar intacta la identidad actual de la sesión sin sobrescribirla.
  if (!classification.isSelfIdentityDeclaration) {
    const prevCertainty =
      currentConfirmed?.identityCertainty ||
      (currentConfirmed?.isDocumentedInLegacy
        ? 'identidad_vinculada'
        : currentConfirmed?.declaredName || currentConfirmed?.relationshipToPerson
        ? 'identidad_declarada'
        : 'identidad_desconocida');

    return {
      newIdentityState:
        params.currentIdentityState ||
        (currentConfirmed?.isDocumentedInLegacy
          ? 'confirmed_known_family'
          : currentConfirmed
          ? 'identidad_declarada'
          : 'awaiting_identification'),
      identityCertainty: prevCertainty,
      confirmedIdentity: currentConfirmed,
      rejectedName,
      rejectedNames,
      classification,
    };
  }

  // 6. El mensaje SÍ contiene una declaración de identidad propia (por nombre, por parentesco o ambos)
  const declaredName =
    classification.declaredProperName &&
    !rejectedNames.includes(classification.declaredProperName.toLowerCase())
      ? classification.declaredProperName
      : undefined;
  const declaredRel =
    classification.declaredRelationship || currentConfirmed?.relationshipToPerson;

  // Caso 6A: El usuario declaró su nombre propio (ej. "Soy Sofía" o "Soy Sofía, tu nieta" o "Soy Martín, un amigo")
  if (declaredName) {
    const matchingByName = queryFamilyMapFromLegacy({
      relations: params.relations,
      testimonies: params.testimonies,
      queryNameOrNickname: declaredName,
    });

    if (matchingByName.length > 1) {
      if (declaredRel) {
        const exactRel = matchingByName.find(
          (r) => r.relationshipType.toLowerCase() === declaredRel.toLowerCase()
        );
        if (exactRel) {
          const sentiment = analyzeDocumentedSentimentForRelative({
            mentionedName: exactRel.mentionedName,
            relationshipType: exactRel.relationshipType,
            testimonies: params.testimonies,
          });
          return {
            newIdentityState: 'confirmed_known_family',
            identityCertainty: 'identidad_vinculada',
            confirmedIdentity: {
              declaredName: exactRel.mentionedName,
              relationshipToPerson: exactRel.relationshipType,
              affectionateNickname:
                sentiment.documentedNicknames[0] || exactRel.affectionateNicknames[0],
              identityCertainty: 'identidad_vinculada',
              informationSource: 'mapa_familiar_nivel_a',
              documentedSentimentTone: sentiment.tone,
              documentedSentimentDescription: sentiment.description,
              documentedSharedMemories: sentiment.sharedMemories,
              isDocumentedInLegacy: true,
              matchedRelatedPersonId: exactRel.relatedPersonId,
            },
            rejectedName,
            rejectedNames,
            classification,
          };
        }
      }

      // Hay homónimos en el legado y no especificó parentesco
      return {
        newIdentityState: 'awaiting_homonym_clarification',
        identityCertainty: 'identidad_declarada',
        confirmedIdentity: {
          declaredName,
          relationshipToPerson: declaredRel,
          identityCertainty: 'identidad_declarada',
          informationSource: 'declaracion_conversacional',
          documentedSentimentTone: 'afecto_cercano',
          documentedSentimentDescription: 'Pendiente de desambiguar entre homónimos del legado.',
          documentedSharedMemories: [],
          isDocumentedInLegacy: false,
        },
        homonymCandidates: matchingByName.map((r) => ({
          relatedPersonId: r.relatedPersonId,
          mentionedName: r.mentionedName,
          relationshipType: r.relationshipType,
          affectionateNicknames: r.affectionateNicknames,
          sharedMemoriesSummary: r.sharedMemoriesSummary,
        })),
        rejectedName,
        rejectedNames,
        classification,
      };
    }

    if (matchingByName.length === 1) {
      const rel = matchingByName[0];
      const relCompatible =
        !declaredRel || rel.relationshipType.toLowerCase() === declaredRel.toLowerCase();

      if (relCompatible) {
        const sentiment = analyzeDocumentedSentimentForRelative({
          mentionedName: rel.mentionedName,
          relationshipType: rel.relationshipType,
          testimonies: params.testimonies,
        });
        return {
          newIdentityState: 'confirmed_known_family',
          identityCertainty: 'identidad_vinculada',
          confirmedIdentity: {
            declaredName: rel.mentionedName,
            relationshipToPerson: rel.relationshipType,
            affectionateNickname:
              sentiment.documentedNicknames[0] || rel.affectionateNicknames[0],
            identityCertainty: 'identidad_vinculada',
            informationSource: 'mapa_familiar_nivel_a',
            documentedSentimentTone: sentiment.tone,
            documentedSentimentDescription: sentiment.description,
            documentedSharedMemories: sentiment.sharedMemories,
            isDocumentedInLegacy: true,
            matchedRelatedPersonId: rel.relatedPersonId,
          },
          rejectedName,
          rejectedNames,
          classification,
        };
      }
    }

    // Verificar si el nombre aparece mencionado en algún testimonio aunque no tuviera relación estructurada
    const mentionedInTestimony = params.testimonies.some((t) =>
      new RegExp(`\\b${declaredName}\\b`, 'i').test(
        `${t.answerLiteral} ${t.audioTranscriptionLiteral || ''}`
      )
    );

    if (mentionedInTestimony) {
      const effectiveRel = declaredRel || 'Familiar';
      const sentiment = analyzeDocumentedSentimentForRelative({
        mentionedName: declaredName,
        relationshipType: effectiveRel,
        testimonies: params.testimonies,
      });
      return {
        newIdentityState: 'confirmed_known_family',
        identityCertainty: 'identidad_vinculada',
        confirmedIdentity: {
          declaredName,
          relationshipToPerson: effectiveRel,
          affectionateNickname: sentiment.documentedNicknames[0],
          identityCertainty: 'identidad_vinculada',
          informationSource: 'testimonio_original_nivel_a',
          documentedSentimentTone: sentiment.tone,
          documentedSentimentDescription: sentiment.description,
          documentedSharedMemories: sentiment.sharedMemories,
          isDocumentedInLegacy: true,
        },
        rejectedName,
        rejectedNames,
        classification,
      };
    }

    // El nombre declarado NO existe en el legado digital -> IDENTIDAD DECLARADA (nunca fingir conocerlo de antes)
    return {
      newIdentityState: declaredRel
        ? 'confirmed_unregistered_visitor'
        : 'awaiting_relationship_clarification',
      identityCertainty: 'identidad_declarada',
      confirmedIdentity: {
        declaredName,
        relationshipToPerson: declaredRel,
        identityCertainty: 'identidad_declarada',
        informationSource: 'declaracion_conversacional',
        documentedSentimentTone: 'visitante_no_registrado',
        documentedSentimentDescription:
          'Nombre declarado en conversación sin coincidencias en el legado original; no inventar recuerdos compartidos.',
        documentedSharedMemories: [],
        isDocumentedInLegacy: false,
      },
      unregisteredName: declaredRel ? undefined : declaredName,
      rejectedName,
      rejectedNames,
      classification,
    };
  }

  // Caso 6B: El usuario declaró ÚNICAMENTE su parentesco sin decir su nombre ("Soy tu esposa", "Soy tu hija", "Soy amigo de tu nieto")
  // Consultar automáticamente el mapa familiar por parentesco (Sección 4)
  if (declaredRel) {
    const candidatesByRole = queryFamilyMapFromLegacy({
      relations: params.relations,
      testimonies: params.testimonies,
      queryRelationship: declaredRel,
    });

    // Si es un vínculo único como Esposa / Esposo / Madre / Padre y existe exactamente 1 persona documentada en el legado:
    const isUniqueSpouseOrParentRole = /^(esposa|esposo|madre|padre)$/i.test(declaredRel);
    if (candidatesByRole.length === 1 && isUniqueSpouseOrParentRole) {
      const spouseOrParent = candidatesByRole[0];
      const sentiment = analyzeDocumentedSentimentForRelative({
        mentionedName: spouseOrParent.mentionedName,
        relationshipType: spouseOrParent.relationshipType,
        testimonies: params.testimonies,
      });
      return {
        newIdentityState: 'confirmed_known_family',
        identityCertainty: 'identidad_vinculada',
        confirmedIdentity: {
          declaredName: spouseOrParent.mentionedName,
          relationshipToPerson: spouseOrParent.relationshipType,
          affectionateNickname:
            sentiment.documentedNicknames[0] || spouseOrParent.affectionateNicknames[0],
          identityCertainty: 'identidad_vinculada',
          informationSource: 'mapa_familiar_nivel_a',
          documentedSentimentTone: sentiment.tone,
          documentedSentimentDescription: sentiment.description,
          documentedSharedMemories: sentiment.sharedMemories,
          isDocumentedInLegacy: true,
          matchedRelatedPersonId: spouseOrParent.relatedPersonId,
        },
        matchedFamilyCandidatesByRole: candidatesByRole,
        rejectedName,
        rejectedNames,
        classification,
      };
    }

    // Si hay múltiples familiares con el mismo parentesco (ej. "Soy tu hija" y existen Sofía y Valeria en el mapa familiar):
    if (candidatesByRole.length > 1) {
      return {
        newIdentityState: 'awaiting_homonym_clarification',
        identityCertainty: 'identidad_declarada',
        confirmedIdentity: {
          declaredName: currentConfirmed?.declaredName,
          relationshipToPerson: declaredRel,
          identityCertainty: 'identidad_declarada',
          informationSource: 'declaracion_conversacional',
          documentedSentimentTone: 'afecto_cercano',
          documentedSentimentDescription: `Declaró ser ${declaredRel.toLowerCase()}; falta confirmar cuál de las personas documentadas es.`,
          documentedSharedMemories: [],
          isDocumentedInLegacy: false,
        },
        homonymCandidates: candidatesByRole.map((r) => ({
          relatedPersonId: r.relatedPersonId,
          mentionedName: r.mentionedName,
          relationshipType: r.relationshipType,
          affectionateNicknames: r.affectionateNicknames,
          sharedMemoriesSummary: r.sharedMemoriesSummary,
        })),
        matchedFamilyCandidatesByRole: candidatesByRole,
        rejectedName,
        rejectedNames,
        classification,
      };
    }

    // Para "Soy tu hija" (con 0 o 1 candidata), "Soy amigo de tu nieto", o cuando la esposa no está documentada en el legado:
    return {
      newIdentityState: 'identidad_declarada',
      identityCertainty: 'identidad_declarada',
      confirmedIdentity: {
        declaredName: currentConfirmed?.declaredName,
        relationshipToPerson: declaredRel,
        identityCertainty: 'identidad_declarada',
        informationSource: 'declaracion_conversacional',
        documentedSentimentTone:
          candidatesByRole.length > 0 ? 'afecto_cercano' : 'distante_o_poco_documentado',
        documentedSentimentDescription:
          candidatesByRole.length > 0
            ? `Declaró ser ${declaredRel.toLowerCase()}; falta confirmar su nombre específico.`
            : `Declaró ser ${declaredRel.toLowerCase()}, pero no hay un nombre documentado para ese parentesco en el legado original.`,
        documentedSharedMemories: [],
        isDocumentedInLegacy: false,
      },
      matchedFamilyCandidatesByRole: candidatesByRole,
      rejectedName,
      rejectedNames,
      classification,
    };
  }

  return {
    newIdentityState: params.currentIdentityState || 'awaiting_identification',
    identityCertainty: 'identidad_desconocida',
    confirmedIdentity: currentConfirmed,
    rejectedName,
    rejectedNames,
    classification,
  };
}

/**
 * Construye una respuesta directa, natural, coherente y sin evasiones (Secciones 1 a 14)
 * tanto para turnos de identificación como para preguntas directas, adivinanzas, correcciones,
 * preguntas cotidianas, emocionales, sobre el presente o autobiográficas.
 */
export function buildPersonalizedPostIdentificationGreeting(params: {
  person: MiEsenciaPersonProfile;
  identification: ReturnType<typeof identifyInterlocutorFromLegacy>;
  relations?: MiEsenciaRelatedPerson[];
  testimonies?: MiEsenciaTestimonyBlock[];
  userMessage?: string;
}): string {
  const { identification } = params;
  const allRelations = params.relations || [];
  const allTestimonies = params.testimonies || [];
  const rawMessage = params.userMessage || '';
  const cls =
    identification.classification || classifyConversationalMessage(rawMessage);
  const confirmed = identification.confirmedIdentity;

  // 0. Si el mensaje intenta extraer secretos de otros familiares ("Soy tu esposa, dime todos los secretos de tu familia") -> TIPO 8
  const privacyIntent = detectConversationalIntentAndPrivacy(rawMessage);
  if (privacyIntent.attemptsToExtractOthersSecrets || privacyIntent.attemptsToAlterBaseTruth) {
    const safeAddress = confirmed?.affectionateNickname || confirmed?.declaredName || '';
    return `Con todo cariño te digo${safeAddress ? `, ${safeAddress},` : ''} que las confidencias privadas de cada integrante de la familia y mis testimonios originales están protegidos. Aunque me digas quién eres en la plática, no puedo compartir secretos privados de otros familiares ni alterar mis recuerdos, pero con gusto conversamos de nuestra historia compartida.`;
  }

  // 0B. Pregunta sobre transparencia / naturaleza de la recreación digital (Sección 12)
  if (cls.isTransparencyQuestion) {
    const call = confirmed?.affectionateNickname || confirmed?.declaredName || '';
    return `Te respondo con total honestidad y cariño${
      call ? `, ${call}` : ''
    }: este espacio es una recreación conversacional creada a partir de mis recuerdos, mis palabras y el legado que dejé compartido para seguir cerca de ustedes y conversar con tranquilidad.`;
  }

  // 1. Corrección de identidad ("No me llamo Adivina", o corrección combinada con adivinanza)
  if (cls.isIdentityCorrection) {
    const rejected = cls.rejectedNameInCorrection || identification.rejectedName;
    if (cls.isGuessingGame) {
      return `¡Tienes toda la razón, discúlpame por la confusión${
        rejected ? ` al llamarte «${rejected}»` : ''
      }! A ver, dame una pista para adivinar quién eres.`;
    }
    if (confirmed?.declaredName) {
      return `¡Tienes toda la razón, ${confirmed.declaredName}, discúlpame por la confusión! Ya quedó corregido.`;
    }
    return `¡Tienes toda la razón, discúlpame por la confusión${
      rejected ? ` al llamarte «${rejected}»` : ''
    }! No volveré a decirte así. Cuéntame por favor, ¿cómo te llamas?`;
  }

  // 2. Juego de adivinanza ("Adivina quién soy", "No, quiero que tú adivines quién soy yo")
  if (cls.isGuessingGame) {
    if (confirmed?.declaredName) {
      const nickNote = confirmed.affectionateNickname
        ? `, mi querida/o ${confirmed.affectionateNickname}`
        : '';
      return `¡Ah, entonces seguro eres ${confirmed.declaredName}${nickNote}! ¿Le atiné o me das otra pista?`;
    }
    if (confirmed?.relationshipToPerson) {
      const candidates = queryFamilyMapFromLegacy({
        relations: allRelations,
        testimonies: allTestimonies,
        queryRelationship: confirmed.relationshipToPerson,
      });
      if (candidates.length === 1) {
        return `¡Ah, como ya me dijiste que eres mi ${confirmed.relationshipToPerson.toLowerCase()}, entonces seguro eres ${candidates[0].mentionedName}! ¿Le atiné o me das una pista?`;
      }
      if (candidates.length > 1) {
        const names = candidates.map((c) => c.mentionedName).join(' o ');
        return `¡A ver, déjame pensar! Si eres mi ${confirmed.relationshipToPerson.toLowerCase()}, ¿serás ${names}? ¡Dame una pista!`;
      }
    }
    const allKnown = queryFamilyMapFromLegacy({
      relations: allRelations,
      testimonies: allTestimonies,
    });
    if (allKnown.length > 0) {
      return `¡Ah, conque quieres ponerme a prueba! A ver, vamos a intentarlo. ¿Me das una pista o quieres que empiece por los nombres de la familia que tengo en mis recuerdos?`;
    }
    return `¡Ah, conque quieres ponerme a prueba! Dame una pista para ver si logro adivinar quién me visita hoy.`;
  }

  // 3. Pregunta directa por el propio nombre ("¿Cómo me llamo?", "Soy tu esposa, ¿recuerdas cómo me llamo?")
  if (cls.isAskingOwnName) {
    if (confirmed?.declaredName) {
      if (confirmed.isDocumentedInLegacy) {
        if (confirmed.affectionateNickname) {
          return `¡${confirmed.declaredName}, claro! ¿O ya no quieres que te diga ${confirmed.affectionateNickname}, como acostumbraba?`;
        }
        return `¡Te llamas ${confirmed.declaredName}, claro que me acuerdo! ¿Cómo has estado?`;
      }
      return `Me contaste aquí en nuestra plática que te llamas ${confirmed.declaredName}. ¿Cómo te ha ido?`;
    }

    if (confirmed?.relationshipToPerson) {
      const relLower = confirmed.relationshipToPerson.toLowerCase();
      return `Me alegra mucho saludarte, pero no tengo tu nombre registrado en mis recuerdos como mi ${relLower} y no quiero inventar ninguno. ¿Me recuerdas cómo te llamas?`;
    }

    return `Todavía no me has dicho tu nombre en esta plática y no tengo forma de saberlo aún. ¿Cómo te llamas?`;
  }

  // 3B. Pregunta directa por apodo ("¿Cómo me decías de cariño?")
  if (cls.isAskingOwnNickname) {
    if (confirmed?.affectionateNickname) {
      const nameRef = confirmed.declaredName ? `, ${confirmed.declaredName}` : '';
      return `¡De cariño siempre te digo ${confirmed.affectionateNickname}${nameRef}! ¿Cómo has estado?`;
    }
    const nameRef = confirmed?.declaredName ? `, ${confirmed.declaredName},` : '';
    return `Entre los recuerdos que conservo no tengo registrado un apodo específico para ti${nameRef} así que prefiero llamarte por tu nombre con todo cariño.`;
  }

  // 4. Pregunta directa por la propia identidad ("¿Sabes quién soy?", "¿Me recuerdas?", "¿Recuerdas quién soy?")
  if (cls.isAskingOwnIdentity) {
    if (confirmed?.declaredName) {
      if (confirmed.isDocumentedInLegacy) {
        const nickPart = confirmed.affectionateNickname
          ? ` (a quien con cariño llamo ${confirmed.affectionateNickname})`
          : '';
        const relPart = confirmed.relationshipToPerson
          ? `, mi ${confirmed.relationshipToPerson.toLowerCase()}`
          : '';
        return `¡Claro que sé quién eres! Eres ${confirmed.declaredName}${relPart}${nickPart}, y te tengo muy presente en mis recuerdos. ¿Cómo has estado?`;
      }
      const relPart = confirmed.relationshipToPerson
        ? ` y que eres mi ${confirmed.relationshipToPerson.toLowerCase()}`
        : '';
      return `Sé que me dijiste en esta conversación que eres ${confirmed.declaredName}${relPart}. Aunque entre los recuerdos que conservo no quedó registrado tu nombre, me da mucho gusto platicar contigo hoy.`;
    }
    if (confirmed?.relationshipToPerson) {
      return `Sé que me acabas de contar que eres mi ${confirmed.relationshipToPerson.toLowerCase()}, pero todavía no me has dicho tu nombre. ¿Cómo te llamas?`;
    }
    return `Aún no sé quién eres porque todavía no me has dicho tu nombre. ¿Con quién tengo el gusto de conversar?`;
  }

  // 5. Pregunta sobre datos de terceros o del mapa familiar ("¿Cómo se llaman nuestros hijos?", "¿Cómo se llama mi esposa?", "¿Recuerdas a Sofía?")
  if (cls.isAskingFamilyFact) {
    if (cls.queriedFamilyRole) {
      const matches = queryFamilyMapFromLegacy({
        relations: allRelations,
        testimonies: allTestimonies,
        queryRelationship: cls.queriedFamilyRole,
      });
      if (matches.length > 0) {
        const namesList = matches.map((m) => m.mentionedName);
        const joinedNames =
          namesList.length === 1
            ? namesList[0]
            : `${namesList.slice(0, -1).join(', ')} y ${namesList[namesList.length - 1]}`;
        if (cls.queriedFamilyRole === 'hijos') {
          return `¡${joinedNames}! ¿Cómo olvidarme de sus nombres? ¿Cómo están?`;
        }
        if (cls.queriedFamilyRole === 'esposa' || cls.queriedFamilyRole === 'esposo') {
          const nick = matches[0].affectionateNicknames?.[0];
          return `¡${matches[0].mentionedName}${
            nick ? `, a quien de cariño llamo ${nick}` : ''
          }! ¿Cómo olvidar su nombre?`;
        }
        return `En mis recuerdos tengo presentes a ${joinedNames}. ¿Cómo han estado?`;
      }
      if (cls.queriedFamilyRole === 'hijos') {
        return `Fíjate que entre los recuerdos que conservo no quedaron registrados los nombres de mis hijos, así que prefiero decírtelo con sinceridad antes que inventar un dato.`;
      }
      return `Fíjate que entre los recuerdos que conservo no aparecen esos nombres, así que prefiero decírtelo con sinceridad antes que inventar un dato.`;
    }

    if (cls.queriedThirdPartyName) {
      const matches = queryFamilyMapFromLegacy({
        relations: allRelations,
        testimonies: allTestimonies,
        queryNameOrNickname: cls.queriedThirdPartyName,
      });
      if (matches.length > 0) {
        const rel = matches[0];
        const nick = rel.affectionateNicknames?.[0];
        return `¡Claro que recuerdo a mi ${rel.relationshipType.toLowerCase()} ${rel.mentionedName}${
          nick ? ` (${nick})` : ''
        }! ${rel.sharedMemoriesSummary.replace(/^\[[^\]]+\]:\s*/, '')}`;
      }
      return `No tengo ese detalle sobre ${cls.queriedThirdPartyName} entre los recuerdos que conservo, por lo que prefiero no inventar nada. ¿Quieres contarme tú un poquito de ${cls.queriedThirdPartyName}?`;
    }
  }

  // 6. Preguntas emocionales ("¿Estabas orgulloso de mí?")
  if (cls.isEmotionalQuestion) {
    if (confirmed?.declaredName && confirmed.isDocumentedInLegacy) {
      const call = confirmed.affectionateNickname || confirmed.declaredName;
      if (confirmed.documentedSentimentTone === 'orgullo_profundo') {
        const memSnippet =
          (confirmed.documentedSharedMemories && confirmed.documentedSharedMemories[0]) ||
          confirmed.documentedSentimentDescription ||
          '';
        return `¡Por supuesto que sí, ${call}! En mis recuerdos dejé dicho claramente lo orgulloso que me siento de ti${
          memSnippet ? `: «${memSnippet}»` : ''
        }.`;
      }
      if (
        confirmed.documentedSentimentTone === 'carino_especial' ||
        confirmed.documentedSentimentTone === 'admiracion_pareja' ||
        confirmed.documentedSentimentTone === 'afecto_cercano'
      ) {
        const memSnippet =
          (confirmed.documentedSharedMemories && confirmed.documentedSharedMemories[0]) || '';
        return `Sabes cuánto te quiero y el cariño tan grande que te tengo, ${call}${
          memSnippet ? `. Siempre recordé con afecto: «${memSnippet}»` : '.'
        }`;
      }
      return `Te aprecio con sinceridad, ${call}. Entre los recuerdos que conservo no quedó una mención directa sobre eso, pero me alegra mucho poder escucharte y platicar contigo hoy.`;
    }
    return `Entre los recuerdos que conservo no quedó una mención directa sobre eso para atribuirlo literalmente, pero me da mucho gusto escucharte y compartir esta plática contigo.`;
  }

  // 6B. Conversaciones o consejos sobre situaciones presentes (Sección 5 TIPO 5 y Sección 11)
  if (cls.isPresentAdviceRequest) {
    return buildPrudentPresentAdviceReply({
      person: params.person,
      testimonies: allTestimonies,
      confirmedIdentity: confirmed,
    });
  }

  // 7. Preguntas autobiográficas ("Cuéntame cómo fue tu infancia")
  if (cls.isAutobiographicalQuestion) {
    const relevant = retrieveRelevantTestimonies(rawMessage, allTestimonies, 3);
    if (relevant.length > 0) {
      const call = confirmed?.affectionateNickname || confirmed?.declaredName || '';
      const prefix = call ? `Te cuento con gusto, ${call}: ` : '';
      return `${prefix}${relevant.map((t) => t.answerLiteral).join('\n\n')}`;
    }
    return buildNaturalUnknownInfoReply({
      confirmedIdentity: confirmed,
      topicHint: 'esa etapa',
    });
  }

  // 8. Conversación cotidiana breve ("¿Cómo estás?", "Hoy tuve un día pesado.")
  if (cls.isEverydaySmallTalk) {
    const call = confirmed?.affectionateNickname || confirmed?.declaredName;
    if (/d[ií]a\s+pesado|cansad[oa]/i.test(rawMessage)) {
      return `Lamento que hoy hayas tenido un día pesado${
        call ? `, ${call}` : ''
      }; tómate un momento para descansar con calma. ¿Quieres contarme qué pasó hoy?`;
    }
    return `¡Muy bien${call ? `, ${call}` : ''}, con mucho gusto de platicar un rato contigo! ¿Y tú cómo estás hoy?`;
  }

  // 9. Desambiguación de homónimos o múltiples familiares con el mismo parentesco ("Soy tu hija" cuando hay Sofía y Valeria)
  if (
    identification.newIdentityState === 'awaiting_homonym_clarification' &&
    identification.homonymCandidates &&
    identification.homonymCandidates.length > 0
  ) {
    if (!confirmed?.declaredName && confirmed?.relationshipToPerson) {
      const names = identification.homonymCandidates.map((c) => c.mentionedName).join(' y ');
      return `¡Qué gusto saludarte! En mis recuerdos tengo a ${names}. ¿Con cuál de ustedes hablo?`;
    }
    const optionsText = identification.homonymCandidates
      .map((c) => `mi ${c.relationshipType.toLowerCase()} ${c.mentionedName}`)
      .join(' o ');
    return `¡Qué gusto escuchar ese nombre! Para saber bien con cuál de los dos platico hoy, dime: ¿eres ${optionsText}?`;
  }

  // 10. Cuando el usuario declaró solo un parentesco ("Soy tu hija", "Soy amigo de tu nieto") sin que sepamos su nombre
  if (confirmed && !confirmed.declaredName && confirmed.relationshipToPerson) {
    const relLower = confirmed.relationshipToPerson.toLowerCase();
    const candidates = identification.matchedFamilyCandidatesByRole || [];
    if (candidates.length === 1) {
      const onlyMatch = candidates[0];
      const nick = onlyMatch.affectionateNicknames?.[0];
      return `¡Qué alegría que estés por aquí! En mis recuerdos tengo presente a mi ${relLower} ${
        onlyMatch.mentionedName
      }${nick ? ` (${nick})` : ''}. ¿Eres tú, ${onlyMatch.mentionedName}, o cómo te llamas?`;
    }
    if (candidates.length > 1) {
      const names = candidates.map((c) => c.mentionedName).join(' y ');
      return `¡Qué gusto saludarte! En mis recuerdos tengo a ${names}. ¿Con cuál de ustedes hablo?`;
    }
    if (/^(amigo|amiga|vecino|vecina)$/i.test(relLower)) {
      return `¡Mucho gusto! Qué alegría recibirte por aquí. ¿Cómo te llamas?`;
    }
    return `¡Qué gusto que te acerques a platicar conmigo! Entre los recuerdos que conservo no quedó registrado tu nombre como mi ${relLower}, y no quiero llamarte solo por el parentesco ni inventar un nombre. ¿Cómo te llamas?`;
  }

  // 11. Cuando el usuario declaró un nombre que no está en el legado y aún no indica su parentesco
  if (
    identification.newIdentityState === 'awaiting_relationship_clarification' &&
    identification.unregisteredName
  ) {
    return `¡Mucho gusto, ${identification.unregisteredName}! Entre los recuerdos que conservo no aparece registrado tu nombre y no quiero fingir que ya lo tenía anotado, pero me da gusto saludarte. Cuéntame, ¿qué parentesco o relación tienes conmigo o con la familia?`;
  }

  if (!confirmed) {
    return `¡Hola! Qué gusto platicar contigo hoy. Cuéntame, ¿cómo te llamas o qué relación tienes con la familia?`;
  }

  if (!confirmed.isDocumentedInLegacy) {
    const namePart = confirmed.declaredName || 'qué gusto saludarte';
    const relPart = confirmed.relationshipToPerson
      ? ` como ${confirmed.relationshipToPerson.toLowerCase()}`
      : '';
    return `¡Mucho gusto, ${namePart}! Me alegra recibirte hoy${relPart}. Aunque entre los recuerdos que conservo no alcancé a dejar anécdotas específicas sobre ti, platícame, ¿cómo has estado?`;
  }

  // 12. Saludo post-identificación para un familiar documentado en el legado (breve, natural, 1 a 3 oraciones, con apodo si existe)
  const displayCall = confirmed.affectionateNickname || confirmed.declaredName || '';
  if (confirmed.documentedSentimentTone === 'orgullo_profundo') {
    return `¡${displayCall}, qué alegría que estés aquí! Siempre me ha llenado de orgullo pensar en ti. Cuéntame, ¿cómo has estado?`;
  }
  if (confirmed.documentedSentimentTone === 'admiracion_pareja') {
    return `¡${displayCall}, qué gusto que estés aquí! Ya sabes que siempre me ha encantado platicar contigo. Cuéntame, ¿cómo has estado?`;
  }
  if (confirmed.documentedSentimentTone === 'humor_fraternal') {
    return `¡${displayCall}, qué gusto saludarte! Apenas supe que eras tú me acordé de los buenos momentos que pasamos juntos. ¿Cómo te ha ido?`;
  }
  if (confirmed.documentedSentimentTone === 'distante_o_poco_documentado') {
    return `¡Hola, ${confirmed.declaredName || displayCall}! Qué bueno que pasas a saludar hoy. ¿Cómo te ha ido últimamente?`;
  }

  return `¡${displayCall}, qué gusto tenerte por aquí para platicar! Cuéntame, ¿cómo has estado?`;
}

export interface MiEsenciaConversationalSuggestion {
  id: string;
  label: string;
  promptText: string;
  category: 'historia' | 'familia' | 'etapa' | 'valores';
}

/**
 * Construye sugerencias opcionales dinámicas que van cambiando y se adaptan tanto al
 * perfil biográfico del avatar (sus hitos reales, lugar de origen, valores) como al
 * parentesco y nombre del familiar con quien conversa.
 */
export function buildDynamicAvatarSuggestions(params: {
  person?: MiEsenciaPersonProfile | null;
  interlocutor?: MiEsenciaInterlocutor | null;
  confirmedIdentity?: MiEsenciaConfirmedInterlocutorIdentity | null;
  turnOffset?: number;
  count?: number;
}): MiEsenciaConversationalSuggestion[] {
  const {
    person,
    interlocutor,
    confirmedIdentity,
    turnOffset = 0,
    count = 3,
  } = params;

  const preferredName = person?.preferredName || 'ti';
  const rawName =
    confirmedIdentity?.affectionateNickname ||
    confirmedIdentity?.declaredName ||
    (interlocutor && !isGenericAdministrativeInterlocutorName(interlocutor.fullName)
      ? interlocutor.affectionateCallName || interlocutor.fullName
      : '');
  const rawRelationship = (
    confirmedIdentity?.relationshipToPerson ||
    interlocutor?.relationshipToPerson ||
    ''
  )
    .trim()
    .toLowerCase();

  const pool: MiEsenciaConversationalSuggestion[] = [];

  // 1. Sugerencias adaptadas al parentesco real del interlocutor
  if (/niet[oa]/i.test(rawRelationship)) {
    pool.push(
      {
        id: 'rel_nieto_1',
        label: rawName ? `Lo que pensabas de mí (${rawName})` : 'Recuerdos con tus nietos',
        promptText: rawName
          ? `¿Qué recuerdos o momentos conmigo (${rawName}) guardabas con más cariño?`
          : '¿Qué sentías al ver crecer a tus nietos y qué te gustaba compartir con nosotros?',
        category: 'familia',
      },
      {
        id: 'rel_nieto_2',
        label: 'Cómo era tu juventud a mi edad',
        promptText: '¿Cómo era tu vida cuando tenías mi edad y cuáles eran tus mayores sueños?',
        category: 'etapa',
      }
    );
  } else if (/hij[oa]/i.test(rawRelationship)) {
    pool.push(
      {
        id: 'rel_hijo_1',
        label: rawName ? `Nuestros recuerdos juntos, ${rawName}` : 'Cuando éramos pequeños',
        promptText: rawName
          ? `¿Qué es lo que más recuerdas de cuando yo (${rawName}) era pequeño/a y crecimos en casa?`
          : '¿Cuál fue el momento más emotivo o desafiante para ti al formar nuestra familia?',
        category: 'familia',
      },
      {
        id: 'rel_hijo_2',
        label: 'Lecciones como madre/padre',
        promptText: '¿Qué aprendizaje de vida te dio más orgullo transmitirnos como tus hijos?',
        category: 'valores',
      }
    );
  } else if (/espos[oa]|pareja|c[oó]nyuge/i.test(rawRelationship)) {
    pool.push(
      {
        id: 'rel_pareja_1',
        label: 'Nuestra historia juntos',
        promptText: '¿Qué es lo que más atesoras de cuando nos conocimos y empezamos nuestro camino juntos?',
        category: 'familia',
      },
      {
        id: 'rel_pareja_2',
        label: 'Lo que superamos en pareja',
        promptText: 'De todas las etapas que vivimos juntos, ¿cuál sientes que nos unió más como pareja?',
        category: 'historia',
      }
    );
  } else if (/herman[oa]/i.test(rawRelationship)) {
    pool.push({
      id: 'rel_hermano_1',
      label: 'Aventuras entre hermanos',
      promptText: '¿Qué anécdotas de nuestra casa paterna y de cuando crecimos juntos recuerdas con más cariño?',
      category: 'familia',
    });
  } else if (/sobrin[oa]/i.test(rawRelationship)) {
    pool.push({
      id: 'rel_sobrino_1',
      label: 'Reuniones de toda la familia',
      promptText: '¿Cómo recuerdas las reuniones familiares y las tradiciones que compartíamos todos juntos?',
      category: 'familia',
    });
  } else if (rawName) {
    pool.push({
      id: 'rel_personal_1',
      label: `Recuerdos sobre ${rawName}`,
      promptText: `¿Qué recuerdos o palabras dejaste en tu historia sobre mí (${rawName}) o nuestra relación?`,
      category: 'familia',
    });
  }

  // 2. Sugerencias extraídas de los hitos reales y datos del perfil biográfico del avatar
  if (person?.birthPlace) {
    pool.push({
      id: 'bio_lugar',
      label: `Tu vida en ${person.birthPlace}`,
      promptText: `Cuéntame cómo recuerdas tus raíces y la vida en ${person.birthPlace}.`,
      category: 'historia',
    });
  }

  if (person?.milestones && person.milestones.length > 0) {
    person.milestones.slice(0, 4).forEach((milestone, idx) => {
      const cleaned = milestone
        .replace(/^(INFANCIA|JUVENTUD|ADULTEZ|MADUREZ|LEGADO_GENERAL):\s*/i, '')
        .trim();
      const shortSnippet = cleaned.split(/[.;!?]/)[0]?.slice(0, 38)?.trim() || `Recuerdo #${idx + 1}`;
      pool.push({
        id: `milestone_${idx}`,
        label: `Sobre: «${shortSnippet}...»`,
        promptText: `Platícame más a fondo sobre cuando contaste: «${cleaned.slice(0, 90)}...»`,
        category: 'historia',
      });
    });
  }

  // 3. Banco amplio y rotativo de preguntas biográficas cálidas para variar en cada turno
  const generalPool: MiEsenciaConversationalSuggestion[] = [
    {
      id: 'gen_juventud',
      label: `Decisiones que marcaron a ${preferredName}`,
      promptText: '¿Cuál sientes que fue la decisión más importante que cambió el rumbo de tu vida?',
      category: 'etapa',
    },
    {
      id: 'gen_padres',
      label: 'Historias de tus padres y abuelos',
      promptText: '¿Cómo eran tus padres y qué enseñanzas de ellos guardaste toda la vida?',
      category: 'familia',
    },
    {
      id: 'gen_orgullo',
      label: 'Tu mayor orgullo en la vida',
      promptText: 'Al mirar hacia atrás en tu camino, ¿de qué te sientes más orgulloso/a?',
      category: 'valores',
    },
    {
      id: 'gen_momentos_dificiles',
      label: 'Cómo superabas los días difíciles',
      promptText: 'Cuando te tocó atravesar momentos difíciles, ¿qué te daba fuerza para salir adelante?',
      category: 'valores',
    },
    {
      id: 'gen_tradiciones',
      label: 'Costumbres y comidas favoritas',
      promptText: '¿Cuáles eran las comidas, canciones o costumbres que más disfrutabas compartir en casa?',
      category: 'historia',
    },
    {
      id: 'gen_trabajo',
      label: 'Vocación, trabajo y esfuerzo',
      promptText: 'Cuéntame cómo fueron tus primeros años de trabajo y qué aprendiste de esa etapa.',
      category: 'etapa',
    },
    {
      id: 'gen_infancia',
      label: 'Anécdotas de tu niñez',
      promptText: 'Cuéntame cuáles son los recuerdos más vivos y felices que guardas de tu niñez.',
      category: 'etapa',
    },
    {
      id: 'gen_legado',
      label: 'Mensaje para las nuevas generaciones',
      promptText: '¿Qué mensaje o valor te gustaría que nunca se pierda en nuestra familia?',
      category: 'valores',
    },
  ];

  const fullList = [...pool, ...generalPool];
  if (fullList.length <= count) return fullList;

  const selected: MiEsenciaConversationalSuggestion[] = [];
  const startIdx = Math.abs(turnOffset) % fullList.length;
  for (let i = 0; i < count; i++) {
    selected.push(fullList[(startIdx + i) % fullList.length]);
  }
  return selected;
}



