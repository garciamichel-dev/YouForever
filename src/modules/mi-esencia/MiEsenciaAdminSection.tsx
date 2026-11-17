import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Users,
  Calendar,
  CreditCard,
  KeyRound,
  MessageSquare,
  Shield,
  AlertTriangle,
  History,
  Bell,
  BarChart3,
  Settings,
  Plus,
  Download,
  Upload,
  CheckCircle2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Copy,
  ExternalLink,
  Trash2,
  FileText,
  Lock,
  Eye,
  BookOpen,
  Cpu,
  Play,
  Edit3,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Share2,
  Mail,
} from 'lucide-react';
import { ThemeToggleButton } from '../../context/ThemeContext';
import { MiEsenciaFamilyPortal } from './MiEsenciaFamilyPortal';
import { MiEsenciaAvatarAiConfigPanel } from './MiEsenciaAvatarAiConfigPanel';
import { MiEsenciaPromptLibraryPanel } from './MiEsenciaPromptLibraryPanel';
import { MiEsenciaSimulatorPanel } from './MiEsenciaSimulatorPanel';
import { SystemStatisticsPanel } from '../../components/SystemStatisticsPanel';
import {
  AdminProgressModal,
  AdminProgressState,
  INITIAL_ADMIN_PROGRESS,
  executeWithAdminProgress,
} from '../../components/AdminProgressModal';
import type {
  MiEsenciaGlobalConfig,
  MiEsenciaPlanRecord,
  MiEsenciaSubscriptionRecord,
  MiEsenciaPersonProfile,
  MiEsenciaArchivedCompilationPdf,
  MiEsenciaTestimonyBlock,
  MiEsenciaRelatedPerson,
  MiEsenciaInterlocutor,
  MiEsenciaAccessCredential,
  MiEsenciaMemoryRecord,
  MiEsenciaContradictionRecord,
  MiEsenciaPaymentRecord,
  MiEsenciaPromotionCoupon,
  MiEsenciaSnapshotRecord,
  MiEsenciaConversationSession,
  MiEsenciaNotificationRecord,
  MiEsenciaSpontaneityLevel,
} from '../../logic/miEsenciaRules';
import {
  AVAILABLE_GEMINI_MODELS,
  AVAILABLE_OPENAI_MODELS,
  type MiEsenciaAiProvider,
  type MiEsenciaLibraryPromptRecord,
  type MiEsenciaPromptVersionRecord,
  type MiEsenciaProviderFallbackLogRecord,
  type MiEsenciaProvidersAvailabilityStatus,
} from '../../logic/miEsenciaAiTypesAndRules';

type MiEsenciaSubTabId =
  | 'resumen'
  | 'avatares'
  | 'administrador_prompts'
  | 'simulador'
  | 'suscripciones'
  | 'planes'
  | 'familiares'
  | 'conversaciones'
  | 'memoria'
  | 'contradicciones'
  | 'instantaneas'
  | 'pagos'
  | 'notificaciones'
  | 'estadisticas'
  | 'configuracion'
  | 'portal_login_familiar';

interface AvailableInterviewItem {
  interviewId: string;
  title: string;
  mode: string;
  status: string;
  participants: Array<{ id: string; name: string; email?: string }>;
  answersCount: number;
  hasMiEsenciaAvatar: boolean;
  avatarId?: string;
}

interface MiEsenciaOverviewPayload {
  config: MiEsenciaGlobalConfig;
  plans: MiEsenciaPlanRecord[];
  availableInterviews: AvailableInterviewItem[];
  subscriptions: MiEsenciaSubscriptionRecord[];
  persons: MiEsenciaPersonProfile[];
  compilationPdfs: MiEsenciaArchivedCompilationPdf[];
  testimonies: MiEsenciaTestimonyBlock[];
  relations: MiEsenciaRelatedPerson[];
  interlocutors: MiEsenciaInterlocutor[];
  credentials: MiEsenciaAccessCredential[];
  memories: MiEsenciaMemoryRecord[];
  contradictions: MiEsenciaContradictionRecord[];
  payments: MiEsenciaPaymentRecord[];
  coupons: MiEsenciaPromotionCoupon[];
  snapshots: MiEsenciaSnapshotRecord[];
  conversations: MiEsenciaConversationSession[];
  notifications: MiEsenciaNotificationRecord[];
  promptLibrary?: MiEsenciaLibraryPromptRecord[];
  avatarPromptVersions?: MiEsenciaPromptVersionRecord[];
  fallbackLogs?: MiEsenciaProviderFallbackLogRecord[];
  providersStatus?: MiEsenciaProvidersAvailabilityStatus;
}

interface MiEsenciaAdminSectionProps {
  adminEmail: string;
}

export const MiEsenciaAdminSection: React.FC<MiEsenciaAdminSectionProps> = ({ adminEmail }) => {
  const [activeSubTab, setActiveSubTab] = useState<MiEsenciaSubTabId>('resumen');
  const [overview, setOverview] = useState<MiEsenciaOverviewPayload | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [adminProgress, setAdminProgress] = useState<AdminProgressState>(INITIAL_ADMIN_PROGRESS);
  const [statusMessage, setStatusMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  // Vista previa directa del portal familiar desde el administrador
  const [previewPersonalCode, setPreviewPersonalCode] = useState<string | null>(null);

  // Panel expandido de Configuración IA / Prompts / PDF por Avatar
  const [expandedAiConfigPersonId, setExpandedAiConfigPersonId] = useState<string | null>(null);

  // Parámetros preseleccionados para el Simulador («Probar Conversación»)
  const [simulatorInitialState, setSimulatorInitialState] = useState<{
    personId?: string;
    provider?: MiEsenciaAiProvider;
    model?: string;
    draftPrompt?: string;
  } | null>(null);

  // Estado para creación / sincronización de Avatar
  const [selectedInterviewId, setSelectedInterviewId] = useState<string>('');
  const [customAvatarName, setCustomAvatarName] = useState<string>('');
  const [selectedPlanIdForNew, setSelectedPlanIdForNew] = useState<string>('plan_anual');
  const [selectedSpontaneity, setSelectedSpontaneity] =
    useState<MiEsenciaSpontaneityLevel>('moderado');
  const [isCoupleModeOverride, setIsCoupleModeOverride] = useState<boolean>(false);
  const [uploadedPdfFileName, setUploadedPdfFileName] = useState<string>('');
  const [uploadedPdfBase64, setUploadedPdfBase64] = useState<string>('');
  const [uploadedCompilationText, setUploadedCompilationText] = useState<string>('');
  const [initialPrimaryProviderForNew, setInitialPrimaryProviderForNew] =
    useState<MiEsenciaAiProvider>('gemini');
  const [initialLibraryPromptForGemini, setInitialLibraryPromptForGemini] = useState<string>('');
  const [initialLibraryPromptForOpenAi, setInitialLibraryPromptForOpenAi] = useState<string>('');
  const [isCreatingAvatar, setIsCreatingAvatar] = useState<boolean>(false);

  // Estado para gestión de vigencia de suscripciones
  const [selectedAvatarId, setSelectedAvatarId] = useState<string>('');
  const [durationUnit, setDurationUnit] = useState<'days' | 'months' | 'years' | 'exact_date'>(
    'months'
  );
  const [durationValue, setDurationValue] = useState<number>(1);
  const [exactDateInput, setExactDateInput] = useState<string>('');
  const [paymentAmountMxn, setPaymentAmountMxn] = useState<number>(390);
  const [paymentNotes, setPaymentNotes] = useState<string>('');

  // Estado para alta de familiar y código criptográfico
  const [newFamName, setNewFamName] = useState<string>('');
  const [newFamRelation, setNewFamRelation] = useState<string>('Hija');
  const [newFamAffectionate, setNewFamAffectionate] = useState<string>('');
  const [newFamEmail, setNewFamEmail] = useState<string>('');

  // Estado para nuevo plan
  const [newPlanName, setNewPlanName] = useState<string>('');
  const [newPlanPrice, setNewPlanPrice] = useState<number>(490);
  const [newPlanUnit, setNewPlanUnit] = useState<'days' | 'months' | 'years'>('months');
  const [newPlanValue, setNewPlanValue] = useState<number>(1);
  const [newPlanMaxFam, setNewPlanMaxFam] = useState<number>(10);

  // Estado para nuevo cupón
  const [couponCode, setCouponCode] = useState<string>('');
  const [couponDesc, setCouponDesc] = useState<string>('');
  const [couponDiscount, setCouponDiscount] = useState<number>(20);
  const [couponBonusDays, setCouponBonusDays] = useState<number>(15);

  // Estado para diagnóstico en vivo de conexión API en pestaña Configuración
  const [testingGlobalProvider, setTestingGlobalProvider] = useState<'gemini' | 'openai' | null>(
    null
  );
  const [globalConnectionResults, setGlobalConnectionResults] = useState<
    Record<
      string,
      {
        connected: boolean;
        requestedModel: string;
        respondedModel: string;
        latencyMs: number;
        sampleResponse?: string;
        errorDetail?: string;
        diagnosticAdvice?: string;
      }
    >
  >({});
  const [customGlobalOpenAiModel, setCustomGlobalOpenAiModel] = useState<boolean>(false);

  // Modal de advertencia y confirmación para borrado definitivo de Perfil Biográfico (Entidad A), Motor IA y PDF Archivado
  const [pendingDeletePerson, setPendingDeletePerson] = useState<{
    personId: string;
    fullName: string;
    pdfFileName?: string;
  } | null>(null);
  const [isDeletingPerson, setIsDeletingPerson] = useState<boolean>(false);

  // Control manual de uso mensual (por defecto, masivo y por avatar)
  const [bulkMonthlyQuotaInput, setBulkMonthlyQuotaInput] = useState<number>(1000);
  const [bulkResetAllCounters, setBulkResetAllCounters] = useState<boolean>(false);
  const [bulkSaveAsDefault, setBulkSaveAsDefault] = useState<boolean>(true);
  const [perAvatarUsageEdits, setPerAvatarUsageEdits] = useState<
    Record<string, { used: number; quota: number }>
  >({});

  // Control manual de uso diario (por defecto, masivo, por avatar y por código familiar individual)
  const [bulkDailyQuotaInput, setBulkDailyQuotaInput] = useState<number>(50);
  const [bulkResetAllDailyCounters, setBulkResetAllDailyCounters] = useState<boolean>(false);
  const [bulkSaveDailyAsDefault, setBulkSaveDailyAsDefault] = useState<boolean>(true);
  const [perAvatarDailyQuotaEdits, setPerAvatarDailyQuotaEdits] = useState<Record<string, number>>(
    {}
  );
  const [perInterlocutorDailyEdits, setPerInterlocutorDailyEdits] = useState<
    Record<string, { usedToday: number; dailyLimit: number }>
  >({});

  // Edición manual de planes y precios activos
  const [editingPlan, setEditingPlan] = useState<MiEsenciaPlanRecord | null>(null);

  // Agrupación / filtro por Avatar y edición manual de códigos familiares
  const [credentialAvatarFilter, setCredentialAvatarFilter] = useState<string>('');
  const [expandedCredentialAvatars, setExpandedCredentialAvatars] = useState<Record<string, boolean>>(
    {}
  );
  const [expandedConversationAvatars, setExpandedConversationAvatars] = useState<
    Record<string, boolean>
  >({});
  const [selectedSummaryCredByAvatar, setSelectedSummaryCredByAvatar] = useState<
    Record<string, string>
  >({});
  const [expandedConversationInterlocutors, setExpandedConversationInterlocutors] = useState<
    Record<string, boolean>
  >({});
  const [editingCredentialId, setEditingCredentialId] = useState<string | null>(null);
  const [credentialEditForm, setCredentialEditForm] = useState<{
    fullName: string;
    relationshipToPerson: string;
    affectionateCallName: string;
    email: string;
    customPersonalCode: string;
    customDailyMessageLimit: number;
    messagesSentToday: number;
  }>({
    fullName: '',
    relationshipToPerson: '',
    affectionateCallName: '',
    email: '',
    customPersonalCode: '',
    customDailyMessageLimit: 50,
    messagesSentToday: 0,
  });

  const showNotice = (type: 'ok' | 'err', text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => {
      setStatusMessage((prev) => (prev?.text === text ? null : prev));
    }, 5500);
  };

  const handleTestGlobalApiConnection = async (provider: 'gemini' | 'openai', model?: string) => {
    setTestingGlobalProvider(provider);
    try {
      const res = await fetch('/api/mi-esencia/admin/ai-test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({ provider, model }),
      });
      const json = await res.json();
      if (json.data) {
        setGlobalConnectionResults((prev) => ({
          ...prev,
          [provider]: json.data,
        }));
        if (json.data.connected) {
          showNotice(
            'ok',
            `Conexión exitosa con ${provider === 'openai' ? 'OpenAI GPT' : 'Google Gemini'} (${json.data.respondedModel} • ${json.data.latencyMs} ms).`
          );
        } else {
          showNotice(
            'err',
            json.data.diagnosticAdvice ||
              json.data.errorDetail ||
              `No se pudo conectar a ${provider.toUpperCase()}.`
          );
        }
      }
    } catch (err: any) {
      showNotice('err', err?.message || 'Error al probar conexión con la API.');
    } finally {
      setTestingGlobalProvider(null);
    }
  };

  const fetchOverview = useCallback(async () => {
    setIsLoading(true);
    try {
      await executeWithAdminProgress(
        setAdminProgress,
        {
          kind: 'carga',
          title: 'Cargando Módulo Mi Esencia',
          subtitle: 'Perfiles biográficos, PDFs compilados, familiares y suscripciones',
          initialStage: 'Consultando base de datos de Mi Esencia...',
        },
        async (update) => {
          const res = await fetch(
            `/api/mi-esencia/admin/overview?admin=${encodeURIComponent(adminEmail)}`,
            {
              headers: { 'x-admin-email': adminEmail },
            }
          );
          update(80, 'Procesando avatares, códigos familiares y sesiones...');
          const json = await res.json();
          if (res.ok && json.success) {
            const data: MiEsenciaOverviewPayload = json.data;
            setOverview(data);
            if (!selectedInterviewId && data.availableInterviews.length > 0) {
              setSelectedInterviewId(data.availableInterviews[0].interviewId);
            }
            if (!selectedAvatarId && data.subscriptions.length > 0) {
              setSelectedAvatarId(data.subscriptions[0].avatarId);
            }
          }
        }
      );
    } catch (err: any) {
      showNotice('err', err?.message || 'Error al cargar datos de Mi Esencia.');
    } finally {
      setIsLoading(false);
    }
  }, [adminEmail, selectedInterviewId, selectedAvatarId]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  const handlePdfUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedPdfFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      setUploadedPdfBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleCreateOrSyncAvatar = async () => {
    setIsCreatingAvatar(true);
    try {
      await executeWithAdminProgress(
        setAdminProgress,
        {
          kind: 'generacion',
          title: 'Generando Avatar y Compilado Testimonial PDF',
          subtitle: customAvatarName.trim() || selectedInterviewId || 'Mi Esencia',
          initialStage: 'Compilando testimonios literales y archivando PDF en el servidor...',
        },
        async (update) => {
          const res = await fetch('/api/mi-esencia/admin/avatars/create-or-sync', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-email': adminEmail,
            },
            body: JSON.stringify({
              interviewId: selectedInterviewId || undefined,
              customAvatarName: customAvatarName.trim() || undefined,
              isCoupleOverride: isCoupleModeOverride || undefined,
              uploadedPdfFileName: uploadedPdfFileName || undefined,
              uploadedPdfBase64: uploadedPdfBase64 || undefined,
              uploadedCompilationText: uploadedCompilationText.trim() || undefined,
              planId: selectedPlanIdForNew,
              spontaneityLevel: selectedSpontaneity,
              initialPrimaryProvider: initialPrimaryProviderForNew,
              initialLibraryPromptIdForGemini: initialLibraryPromptForGemini || undefined,
              initialLibraryPromptIdForOpenAi: initialLibraryPromptForOpenAi || undefined,
            }),
          });
          update(85, 'Sincronizando perfil biográfico y motor IA...');
          const json = await res.json();
          if (!res.ok || !json.success) {
            showNotice('err', json.error || 'No se pudo crear o sincronizar el avatar.');
            return;
          }
          showNotice(
            'ok',
            `Avatar «${json.data.subscription.avatarDisplayName}» generado y PDF Compilado Testimonial Fidedigno archivado (${json.data.testimoniesCount} testimonios literales).`
          );
          setSelectedAvatarId(json.data.subscription.avatarId);
          await fetchOverview();
        }
      );
    } catch (err: any) {
      showNotice('err', err?.message || 'Error al crear avatar.');
    } finally {
      setIsCreatingAvatar(false);
    }
  };

  const handleDownloadArchivedPdf = async (pdfId: string, fallbackFileName: string) => {
    try {
      await executeWithAdminProgress(
        setAdminProgress,
        {
          kind: 'generacion',
          title: 'Generando y Descargando Compilado Testimonial PDF',
          subtitle: fallbackFileName || pdfId,
          initialStage: 'Recuperando documento PDF archivado del servidor...',
        },
        async (update) => {
          const res = await fetch(
            `/api/mi-esencia/admin/pdfs/${encodeURIComponent(pdfId)}/download?admin=${encodeURIComponent(
              adminEmail
            )}`,
            {
              headers: { 'x-admin-email': adminEmail },
            }
          );
          update(75, 'Preparando archivo PDF para descarga...');
          const json = await res.json();
          if (!res.ok || !json.success || !json.data?.pdfBase64) {
            showNotice('err', json.error || 'No se pudo descargar el PDF del Compilado Testimonial.');
            return;
          }

          const byteCharacters = atob(json.data.pdfBase64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = json.data.fileName || fallbackFileName || 'Compilado_Testimonial_Fidedigno.pdf';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showNotice('ok', 'PDF del Compilado Testimonial Fidedigno descargado correctamente.');
        }
      );
    } catch (err: any) {
      showNotice('err', err?.message || 'Error al descargar PDF.');
    }
  };

  const handleSubscriptionAction = async (
    avatarId: string,
    action:
      | 'renew_or_extend'
      | 'set_exact_date'
      | 'suspend_clock_running'
      | 'suspend_clock_frozen'
      | 'resume'
      | 'cancel'
  ) => {
    try {
      const res = await fetch('/api/mi-esencia/admin/subscriptions/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({
          avatarId,
          action,
          unit: durationUnit,
          value: durationValue,
          exactTargetDate: exactDateInput ? new Date(exactDateInput).toISOString() : undefined,
          amountMxn: paymentAmountMxn,
          notes: paymentNotes || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showNotice('err', json.error || 'No se pudo actualizar la suscripción.');
        return;
      }
      showNotice('ok', 'Suscripción comercial actualizada correctamente.');
      await fetchOverview();
    } catch (err: any) {
      showNotice('err', err?.message || 'Error al actualizar suscripción.');
    }
  };

  const handleCreateInterlocutor = async () => {
    if (!selectedAvatarId || !newFamName.trim()) {
      showNotice('err', 'Selecciona un avatar e ingresa el nombre del familiar.');
      return;
    }
    try {
      const res = await fetch('/api/mi-esencia/admin/interlocutors/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({
          avatarId: selectedAvatarId,
          fullName: newFamName.trim(),
          relationshipToPerson: newFamRelation.trim() || 'Familiar',
          affectionateCallName: newFamAffectionate.trim() || undefined,
          email: newFamEmail.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showNotice('err', json.error || 'No se pudo crear el código familiar.');
        return;
      }
      setNewFamName('');
      setNewFamAffectionate('');
      setNewFamEmail('');
      showNotice(
        'ok',
        `Código personal criptográfico generado para ${json.data.interlocutor.fullName}: ${json.data.credential.personalCodePlain}`
      );
      await fetchOverview();
    } catch (err: any) {
      showNotice('err', err?.message || 'Error al generar código.');
    }
  };

  const handleCredentialStatus = async (
    accessCredentialId: string,
    status: 'activo' | 'pausado' | 'revocado',
    regenerateCode = false
  ) => {
    try {
      const res = await fetch('/api/mi-esencia/admin/credentials/status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({ accessCredentialId, status, regenerateCode }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        showNotice(
          'ok',
          regenerateCode
            ? `Nuevo código generado: ${json.data.personalCodePlain}`
            : `Estado del código actualizado a ${status}.`
        );
        await fetchOverview();
      }
    } catch {
      showNotice('err', 'Error al actualizar el código.');
    }
  };

  const handleCreateSnapshot = async (avatarId: string) => {
    try {
      const res = await fetch('/api/mi-esencia/admin/snapshots/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({
          avatarId,
          label: `Respaldo manual (${new Date().toLocaleString('es-MX')})`,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        showNotice('ok', 'Instantánea de seguridad creada.');
        await fetchOverview();
      }
    } catch {
      showNotice('err', 'Error al crear instantánea.');
    }
  };

  const handleRestoreSnapshot = async (
    avatarId: string,
    mode: 'total_to_original_pdf' | 'from_snapshot' | 'partial_by_interlocutor',
    snapshotId?: string,
    targetInterlocutorId?: string
  ) => {
    try {
      const res = await fetch('/api/mi-esencia/admin/snapshots/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({
          avatarId,
          mode,
          snapshotId,
          targetInterlocutorId,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        showNotice(
          'ok',
          mode === 'total_to_original_pdf'
            ? 'Restauración Total aplicada: el avatar volvió íntegramente a su Compilado Testimonial Fidedigno (Nivel A).'
            : 'Restauración aplicada correctamente.'
        );
        await fetchOverview();
      }
    } catch {
      showNotice('err', 'Error al restaurar estado del avatar.');
    }
  };

  const handleUpdateSpontaneity = async (
    personId: string,
    spontaneityLevel: MiEsenciaSpontaneityLevel
  ) => {
    try {
      const res = await fetch('/api/mi-esencia/admin/persons/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({ personId, spontaneityLevel }),
      });
      if (res.ok) {
        showNotice('ok', `Nivel de espontaneidad actualizado a ${spontaneityLevel.toUpperCase()}.`);
        await fetchOverview();
      }
    } catch {
      showNotice('err', 'Error al actualizar espontaneidad.');
    }
  };

  const handleSaveNewPlan = async () => {
    if (!newPlanName.trim()) return;
    try {
      const res = await fetch('/api/mi-esencia/admin/plans', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({
          name: newPlanName.trim(),
          priceMxn: newPlanPrice,
          defaultDurationUnit: newPlanUnit,
          defaultDurationValue: newPlanValue,
          maxAuthorizedInterlocutors: newPlanMaxFam,
        }),
      });
      if (res.ok) {
        setNewPlanName('');
        showNotice('ok', 'Plan comercial guardado.');
        await fetchOverview();
      }
    } catch {
      showNotice('err', 'Error al guardar plan.');
    }
  };

  const handleCreateCoupon = async () => {
    if (!couponCode.trim()) return;
    try {
      const res = await fetch('/api/mi-esencia/admin/coupons/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({
          code: couponCode.trim(),
          description: couponDesc.trim() || 'Promoción especial Mi Esencia',
          discountPercent: couponDiscount,
          bonusDays: couponBonusDays,
          maxRedemptions: 100,
        }),
      });
      if (res.ok) {
        setCouponCode('');
        setCouponDesc('');
        showNotice('ok', 'Cupón promocional creado.');
        await fetchOverview();
      }
    } catch {
      showNotice('err', 'Error al crear cupón.');
    }
  };

  const handleToggleGlobalFlag = async (enabled: boolean) => {
    try {
      const res = await fetch('/api/mi-esencia/admin/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({ miEsenciaEnabled: enabled }),
      });
      if (res.ok) {
        showNotice(
          'ok',
          enabled
            ? 'Subsistema Mi Esencia activado globalmente.'
            : 'Subsistema Mi Esencia desactivado temporalmente.'
        );
        await fetchOverview();
      }
    } catch {
      showNotice('err', 'Error al cambiar configuración global.');
    }
  };

  const requestDeletePersonProfileConfirmation = (
    personId: string,
    fullName: string,
    pdfFileName?: string
  ) => {
    setPendingDeletePerson({ personId, fullName, pdfFileName });
  };

  const handleConfirmDeletePersonProfile = async () => {
    if (!pendingDeletePerson || isDeletingPerson) return;
    setIsDeletingPerson(true);
    try {
      const res = await fetch('/api/mi-esencia/admin/persons/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({ personId: pendingDeletePerson.personId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showNotice('err', json.error || 'No se pudo eliminar el perfil biográfico.');
        return;
      }
      showNotice(
        'ok',
        `Perfil biográfico, motor IA y archivo PDF compilado de «${pendingDeletePerson.fullName}» eliminados definitivamente de la base de datos.`
      );
      setPendingDeletePerson(null);
      await fetchOverview();
    } catch {
      showNotice('err', 'Error al eliminar el perfil biográfico y su PDF.');
    } finally {
      setIsDeletingPerson(false);
    }
  };

  const handleUpdateAvatarMonthlyUsage = async (params: {
    avatarId: string;
    messagesUsedThisMonth?: number;
    monthlyMessageQuota?: number;
    resetUsedCounter?: boolean;
  }) => {
    try {
      const res = await fetch('/api/mi-esencia/admin/subscriptions/monthly-usage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify(params),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showNotice('err', json.error || 'No se pudo actualizar el uso mensual.');
        return;
      }
      showNotice('ok', 'Uso mensual del avatar actualizado correctamente.');
      await fetchOverview();
    } catch {
      showNotice('err', 'Error al actualizar el uso mensual.');
    }
  };

  const handleApplyBulkMonthlyUsage = async () => {
    try {
      const res = await fetch('/api/mi-esencia/admin/subscriptions/monthly-usage-bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({
          monthlyMessageQuota: bulkMonthlyQuotaInput,
          resetAllCounters: bulkResetAllCounters,
          saveAsDefaultForNewAvatars: bulkSaveAsDefault,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showNotice('err', json.error || 'No se pudo aplicar el ajuste masivo de uso mensual.');
        return;
      }
      showNotice(
        'ok',
        `Ajuste mensual aplicado a ${json.data?.updatedCount ?? 0} avatar(es)${
          bulkSaveAsDefault ? ` y guardado como límite por defecto (${bulkMonthlyQuotaInput} msjs/mes)` : ''
        }.`
      );
      await fetchOverview();
    } catch {
      showNotice('err', 'Error al aplicar el ajuste mensual masivo.');
    }
  };

  const handleUpdateAvatarDailyUsage = async (params: {
    avatarId: string;
    dailyMessageQuotaPerInterlocutor?: number;
    propagateToAllAvatarInterlocutors?: boolean;
    resetDailyCountersForAvatar?: boolean;
  }) => {
    try {
      const res = await fetch('/api/mi-esencia/admin/subscriptions/daily-usage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify(params),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showNotice('err', json.error || 'No se pudo actualizar el límite diario del avatar.');
        return;
      }
      showNotice(
        'ok',
        params.resetDailyCountersForAvatar
          ? 'Límite diario del avatar actualizado y contadores de hoy reiniciados a 0.'
          : 'Límite diario del avatar actualizado y sincronizado en vivo con sus familiares.'
      );
      await fetchOverview();
    } catch {
      showNotice('err', 'Error al actualizar el límite diario del avatar.');
    }
  };

  const handleApplyBulkDailyUsage = async () => {
    try {
      const res = await fetch('/api/mi-esencia/admin/subscriptions/daily-usage-bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({
          dailyMessageQuota: bulkDailyQuotaInput,
          resetAllDailyCounters: bulkResetAllDailyCounters,
          saveAsDefaultForNewAvatars: bulkSaveDailyAsDefault,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showNotice('err', json.error || 'No se pudo aplicar el ajuste masivo de límite diario.');
        return;
      }
      showNotice(
        'ok',
        `Límite diario (${bulkDailyQuotaInput} msjs/día) aplicado en bloque a ${
          json.data?.updatedAvatarsCount ?? 0
        } avatar(es) y ${json.data?.updatedInterlocutorsCount ?? 0} familiar(es)${
          bulkResetAllDailyCounters ? ' con reinicio de mensajes de hoy a 0' : ''
        }.`
      );
      await fetchOverview();
    } catch {
      showNotice('err', 'Error al aplicar el ajuste masivo de límite diario.');
    }
  };

  const handleUpdateInterlocutorDailyUsage = async (params: {
    interlocutorId: string;
    interlocutorName: string;
    customDailyMessageLimit?: number;
    messagesSentToday?: number;
    resetDailyCounter?: boolean;
  }) => {
    try {
      const res = await fetch('/api/mi-esencia/admin/interlocutors/daily-usage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify(params),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showNotice('err', json.error || 'No se pudo actualizar la cuota diaria del familiar.');
        return;
      }
      showNotice(
        'ok',
        `Cuota diaria de ${params.interlocutorName} actualizada en vivo (${
          json.data?.messagesSentToday ?? 0
        } usados hoy / límite ${json.data?.customDailyMessageLimit ?? params.customDailyMessageLimit ?? 50} msjs/día).`
      );
      await fetchOverview();
    } catch {
      showNotice('err', 'Error al actualizar la cuota diaria del familiar.');
    }
  };

  const handleSaveEditedPlan = async () => {
    if (!editingPlan || !editingPlan.name.trim()) return;
    try {
      const res = await fetch('/api/mi-esencia/admin/plans', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify(editingPlan),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showNotice('err', json.error || 'No se pudo actualizar el plan.');
        return;
      }
      showNotice('ok', `Plan «${editingPlan.name}» actualizado correctamente.`);
      setEditingPlan(null);
      await fetchOverview();
    } catch {
      showNotice('err', 'Error al actualizar el plan.');
    }
  };

  const handleSaveEditedCredential = async (accessCredentialId: string) => {
    try {
      const res = await fetch('/api/mi-esencia/admin/credentials/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({
          accessCredentialId,
          ...credentialEditForm,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showNotice('err', json.error || 'No se pudo actualizar el código familiar.');
        return;
      }
      showNotice('ok', 'Código familiar y datos del interlocutor actualizados correctamente.');
      setEditingCredentialId(null);
      await fetchOverview();
    } catch {
      showNotice('err', 'Error al actualizar el código familiar.');
    }
  };

  const handleClearFallbackLogs = async () => {
    try {
      const res = await fetch('/api/mi-esencia/admin/fallback-logs/clear', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showNotice('err', json.error || 'No se pudo limpiar el registro de conmutaciones.');
        return;
      }
      showNotice(
        'ok',
        `Registro Administrativo de Conmutaciones limpiado y borrado (${json.data?.clearedCount ?? 0} entradas eliminadas).`
      );
      await fetchOverview();
    } catch {
      showNotice('err', 'Error al limpiar el registro de conmutaciones.');
    }
  };

  const handleDeleteCredential = async (
    accessCredentialId: string,
    interlocutorName: string,
    personalCodePlain: string
  ) => {
    try {
      const res = await fetch('/api/mi-esencia/admin/credentials/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({ accessCredentialId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showNotice('err', json.error || 'No se pudo borrar el código personal.');
        return;
      }
      showNotice(
        'ok',
        `Código personal ${personalCodePlain} (${interlocutorName}) y su enlace privado eliminados correctamente.`
      );
      await fetchOverview();
    } catch {
      showNotice('err', 'Error al borrar el código personal y enlace privado.');
    }
  };

  const handleDeleteConversation = async (sessionId: string, titleOrName: string) => {
    try {
      const res = await fetch('/api/mi-esencia/admin/conversations/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({ sessionId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showNotice('err', json.error || 'No se pudo eliminar la conversación.');
        return;
      }
      showNotice('ok', `Conversación «${titleOrName}» eliminada correctamente.`);
      await fetchOverview();
    } catch {
      showNotice('err', 'Error al eliminar la conversación.');
    }
  };

  if (previewPersonalCode !== null) {
    return (
      <div className="rounded-2xl overflow-hidden border border-stone-800 shadow-xl">
        <MiEsenciaFamilyPortal
          initialCode={previewPersonalCode}
          isAdminPreview={true}
          onExitAdminPreview={() => {
            setPreviewPersonalCode(null);
            fetchOverview();
          }}
        />
      </div>
    );
  }

  const subTabs: Array<{ id: MiEsenciaSubTabId; label: string; icon: React.ReactNode }> = [
    { id: 'resumen', label: 'Resumen', icon: <Sparkles className="w-3.5 h-3.5" /> },
    { id: 'avatares', label: 'Avatares', icon: <Users className="w-3.5 h-3.5" /> },
    {
      id: 'administrador_prompts',
      label: 'Administrador de Prompts',
      icon: <BookOpen className="w-3.5 h-3.5" />,
    },
    {
      id: 'simulador',
      label: 'Probar Conversación (Simulador)',
      icon: <Play className="w-3.5 h-3.5" />,
    },
    { id: 'suscripciones', label: 'Suscripciones', icon: <Calendar className="w-3.5 h-3.5" /> },
    { id: 'planes', label: 'Planes y precios', icon: <CreditCard className="w-3.5 h-3.5" /> },
    { id: 'familiares', label: 'Familiares y códigos', icon: <KeyRound className="w-3.5 h-3.5" /> },
    { id: 'conversaciones', label: 'Conversaciones', icon: <MessageSquare className="w-3.5 h-3.5" /> },
    { id: 'memoria', label: 'Memoria y privacidad', icon: <Shield className="w-3.5 h-3.5" /> },
    { id: 'contradicciones', label: 'Contradicciones', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
    { id: 'instantaneas', label: 'Instantáneas y restauración', icon: <History className="w-3.5 h-3.5" /> },
    { id: 'pagos', label: 'Pagos y promociones', icon: <CreditCard className="w-3.5 h-3.5" /> },
    { id: 'notificaciones', label: 'Notificaciones', icon: <Bell className="w-3.5 h-3.5" /> },
    { id: 'estadisticas', label: 'Estadísticas y costos', icon: <BarChart3 className="w-3.5 h-3.5" /> },
    { id: 'configuracion', label: 'Configuración', icon: <Settings className="w-3.5 h-3.5" /> },
    {
      id: 'portal_login_familiar',
      label: 'Portal de Inicio de Sesión Familiar',
      icon: <ExternalLink className="w-3.5 h-3.5" />,
    },
  ];

  const activeSubs =
    overview?.subscriptions.filter(
      (s) => s.status === 'activa' || s.status === 'prueba_activa' || s.status === 'por_vencer'
    ) || [];
  const openContradictions =
    overview?.contradictions.filter((c) => c.status === 'abierta') || [];

  return (
    <div className="space-y-6">
      <AdminProgressModal state={adminProgress} />
      {/* Modal de Advertencia y Confirmación antes de borrar definitivamente un Perfil Biográfico y su PDF */}
      {pendingDeletePerson && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-white dark:bg-stone-900 border border-red-300 dark:border-red-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-950/80 border border-red-300 dark:border-red-800 flex items-center justify-center text-red-700 dark:text-red-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-serif font-bold text-lg text-stone-900 dark:text-white">
                  Advertencia: Eliminación Definitiva de Base de Datos
                </h3>
                <p className="text-xs text-stone-600 dark:text-stone-300 leading-relaxed">
                  Estás por eliminar de forma permanente el Perfil Biográfico (Entidad A), su
                  configuración de Motor IA (Gemini / OpenAI) y su PDF Compilado Archivado de{' '}
                  <strong className="text-stone-900 dark:text-white">
                    «{pendingDeletePerson.fullName}»
                  </strong>
                  {pendingDeletePerson.pdfFileName ? ` (${pendingDeletePerson.pdfFileName})` : ''}.
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-900 dark:text-red-200 space-y-1">
              <p className="font-semibold">Esta acción borrará de la BDD (Firestore y servidor):</p>
              <ul className="list-disc pl-5 space-y-0.5">
                <li>El Perfil Biográfico (Entidad A) y su configuración de prompts IA</li>
                <li>El archivo PDF Compilado Archivado y sus bloques de testimonio</li>
                <li>Las sesiones de conversación, memorias y códigos asociados si es el único perfil del avatar</li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setPendingDeletePerson(null)}
                disabled={isDeletingPerson}
                className="px-4 py-2 rounded-xl bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-200 text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDeletePersonProfile}
                disabled={isDeletingPerson}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>
                  {isDeletingPerson
                    ? 'Eliminando de la BDD...'
                    : 'Sí, Eliminar Definitivamente de la BDD'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Encabezado Principal de Administración de Mi Esencia */}
      <div className="bg-stone-900 text-stone-100 rounded-2xl p-6 border border-stone-800 shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 text-amber-400 text-xs font-semibold uppercase tracking-wider">
            <Sparkles className="w-4 h-4" />
            <span>Subsistema Biográfico Conversacional</span>
          </div>
          <h2 className="text-2xl font-serif text-white">Administración de Mi Esencia</h2>
          <p className="text-xs text-stone-400 max-w-2xl">
            Gestión integral de avatares testimoniales creados a partir del PDF «Compilado
            Testimonial Fidedigno», vigencias comerciales, códigos criptográficos por familiar y
            niveles de privacidad A, B y C.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 ${
              overview?.config.miEsenciaEnabled
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                : 'bg-stone-800 text-stone-400 border border-stone-700'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {overview?.config.miEsenciaEnabled
              ? 'Mi Esencia: Activo'
              : 'Mi Esencia: Desactivado'}
          </span>
          <a
            href="/miesencia"
            className="px-4 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-amber-300 border border-amber-500/30 font-semibold text-xs transition flex items-center gap-1.5 cursor-pointer"
          >
            <ExternalLink className="w-4 h-4" />
            <span>Ir al Sitio /miesencia</span>
          </a>
          <button
            onClick={() => setActiveSubTab('avatares')}
            className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-stone-950 font-semibold text-xs transition flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Crear / Sincronizar Avatar</span>
          </button>
          <ThemeToggleButton />
        </div>
      </div>

      {statusMessage && (
        <div
          className={`p-4 rounded-xl border text-xs font-medium flex items-center justify-between ${
            statusMessage.type === 'ok'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-red-50 border-red-300 text-red-900'
          }`}
        >
          <span>{statusMessage.text}</span>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-stone-500 hover:text-stone-800 ml-4 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Barra de pestañas internas de Mi Esencia + pestaña/enlace al Portal Familiar */}
      <div className="bg-white rounded-2xl border border-stone-200 p-2 shadow-sm flex flex-wrap gap-1.5 items-center">
        {subTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`px-3 py-2 rounded-xl text-xs font-medium transition flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === tab.id
                ? 'bg-stone-900 text-amber-300 shadow-sm'
                : tab.id === 'portal_login_familiar'
                ? 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100'
                : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
        <a
          href="/miesencia"
          className="px-3 py-2 rounded-xl text-xs font-semibold bg-stone-900 hover:bg-stone-800 text-amber-300 transition flex items-center gap-1.5 cursor-pointer ml-auto"
          title="Abrir directamente el sitio oficial /miesencia que ven los familiares al iniciar sesión"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span>Abrir Sitio Familiar (/miesencia)</span>
        </a>
      </div>

      {isLoading && !overview ? (
        <div className="p-12 bg-white rounded-2xl border border-stone-200 text-center text-sm text-stone-500">
          Cargando panel de Administración de Mi Esencia...
        </div>
      ) : null}

      {/* PESTAÑA ENLACE: SITIO DE INICIO DE SESIÓN FAMILIAR */}
      {activeSubTab === 'portal_login_familiar' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-stone-200 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-0.5">
              <h3 className="font-serif font-bold text-stone-900 text-base">
                Sitio de Inicio de Sesión Familiar («Mi Esencia» • /miesencia)
              </h3>
              <p className="text-xs text-stone-500">
                Esta es la pantalla exacta que ven los familiares cuando ingresan a{' '}
                <code>/miesencia</code> para iniciar sesión con su código personal y conversar con sus
                legados digitales.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                onClick={() => {
                  const loginUrl = `${window.location.origin}/miesencia`;
                  navigator.clipboard?.writeText(loginUrl);
                  showNotice('ok', `Enlace del portal copiado: ${loginUrl}`);
                }}
                className="px-3 py-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar URL (/miesencia)</span>
              </button>
              <a
                href="/miesencia"
                className="px-3.5 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-amber-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Ir a Pantalla Completa (/miesencia)</span>
              </a>
            </div>
          </div>

          <div className="rounded-2xl overflow-hidden border border-stone-800 shadow-xl">
            <MiEsenciaFamilyPortal
              initialCode=""
              isAdminPreview={true}
              onExitAdminPreview={() => {
                setActiveSubTab('resumen');
                fetchOverview();
              }}
            />
          </div>
        </div>
      )}

      {/* 1. PESTAÑA: RESUMEN */}
      {activeSubTab === 'resumen' && overview && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm">
              <p className="text-xs text-stone-500 font-medium">Avatares y Suscripciones</p>
              <p className="text-3xl font-serif font-bold text-stone-900 mt-1">
                {overview.subscriptions.length}
              </p>
              <p className="text-xs text-emerald-700 mt-1">
                {activeSubs.length} vigentes • {overview.persons.length} perfil(es) biográficos
              </p>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm">
              <p className="text-xs text-stone-500 font-medium">Familiares con Código Único</p>
              <p className="text-3xl font-serif font-bold text-stone-900 mt-1">
                {overview.credentials.filter((c) => c.status === 'activo').length}
              </p>
              <p className="text-xs text-stone-500 mt-1">
                De {overview.interlocutors.length} interlocutores registrados
              </p>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm">
              <p className="text-xs text-stone-500 font-medium">Testimonios Nivel A + Memorias</p>
              <p className="text-3xl font-serif font-bold text-stone-900 mt-1">
                {overview.testimonies.length}
              </p>
              <p className="text-xs text-amber-800 mt-1">
                +{overview.memories.filter((m) => m.verificationState !== 'revocado').length} memorias
                conversacionales (Nivel B/C)
              </p>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm">
              <p className="text-xs text-stone-500 font-medium">Contradicciones Abiertas</p>
              <p className="text-3xl font-serif font-bold text-stone-900 mt-1">
                {openContradictions.length}
              </p>
              <p className="text-xs text-stone-500 mt-1">
                {overview.snapshots.length} instantáneas de restauración listas
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-lg text-stone-900">
                Avatares Familiares Activos en Mi Esencia
              </h3>
              <button
                onClick={() => setActiveSubTab('avatares')}
                className="text-xs text-amber-800 hover:underline font-semibold cursor-pointer"
              >
                Administrar Avatares →
              </button>
            </div>

            {overview.subscriptions.length === 0 ? (
              <div className="p-8 rounded-xl bg-stone-50 border border-stone-200 text-center space-y-3">
                <p className="text-sm text-stone-700 font-medium">
                  Aún no has habilitado ningún avatar en Mi Esencia.
                </p>
                <p className="text-xs text-stone-500 max-w-lg mx-auto">
                  Puedes crear un avatar en 1 clic a partir de cualquiera de las entrevistas
                  existentes; el sistema generará y archivará automáticamente el PDF «Compilado
                  Testimonial Fidedigno».
                </p>
                <button
                  onClick={() => setActiveSubTab('avatares')}
                  className="px-4 py-2 rounded-xl bg-stone-900 text-amber-300 text-xs font-semibold cursor-pointer"
                >
                  Habilitar Primer Avatar ahora
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {overview.subscriptions.map((sub) => {
                  const subCreds = overview.credentials.filter(
                    (c) => c.avatarId === sub.avatarId && c.status === 'activo'
                  );
                  const selectedCredId =
                    selectedSummaryCredByAvatar[sub.avatarId] ||
                    subCreds[0]?.accessCredentialId ||
                    '';
                  const activeCred =
                    subCreds.find((c) => c.accessCredentialId === selectedCredId) ||
                    subCreds[0] ||
                    null;
                  const activeShareCode = activeCred?.personalCodePlain || '';
                  const activeShareUrl = activeCred
                    ? `https://youforever.app${activeCred.privateLinkPath}`
                    : 'https://youforever.app/miesencia';
                  const shareWhatsAppText = activeCred
                    ? `Hola ${activeCred.interlocutorName}, te comparto tu acceso familiar privado a *Mi Esencia* de *${sub.avatarDisplayName}* en YouForever.\n\n🔑 Tu código personal: *${activeShareCode}*\n🔗 Enlace directo: ${activeShareUrl}`
                    : '';
                  const shareEmailSubject = activeCred
                    ? `Acceso a Mi Esencia de ${sub.avatarDisplayName} • YouForever`
                    : '';
                  const shareEmailBody = activeCred
                    ? `Hola ${activeCred.interlocutorName},\n\nTe comparto tu acceso personal a Mi Esencia para conversar con los recuerdos de ${sub.avatarDisplayName} en YouForever:\n\n• Código personal único: ${activeShareCode}\n• Enlace privado directo: ${activeShareUrl}\n\nCon cariño,\nYouForever`
                    : '';
                  const subPersons = overview.persons.filter((p) => p.avatarId === sub.avatarId);
                  const subPdf =
                    (subPersons[0]?.sourcePdfId &&
                      overview.compilationPdfs.find(
                        (p) => p.pdfId === subPersons[0].sourcePdfId
                      )) ||
                    overview.compilationPdfs.find((p) => p.avatarId === sub.avatarId);
                  return (
                    <div
                      key={sub.avatarId}
                      data-testid={`active-avatar-card-${sub.avatarId}`}
                      className="p-4 rounded-xl border border-stone-200 bg-stone-50/60 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="font-serif font-bold text-stone-900">
                            {sub.avatarDisplayName}
                          </h4>
                          <p className="text-xs text-stone-500">
                            {sub.planName} • Vence:{' '}
                            {new Date(sub.expiresAt).toLocaleDateString('es-MX')}
                          </p>
                          {subPdf && (
                            <p className="text-[11px] text-amber-800 font-medium mt-0.5">
                              Archivo PDF asignado: {subPdf.fileName} ({subPdf.totalLiteralAnswers}{' '}
                              testimonios)
                            </p>
                          )}
                        </div>
                        <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-900 text-[11px] font-semibold">
                          {sub.status}
                        </span>
                      </div>

                      {/* Bloque directo para copiar código, copiar enlace y compartir acceso al avatar */}
                      <div className="p-3 rounded-xl bg-white border border-stone-200/90 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-stone-700 flex items-center gap-1.5">
                            <KeyRound className="w-3.5 h-3.5 text-amber-700" />
                            <span>Acceso Familiar Directo ({subCreds.length} activo{subCreds.length === 1 ? '' : 's'})</span>
                          </span>
                          {subCreds.length > 1 && (
                            <select
                              aria-label={`Seleccionar familiar de ${sub.avatarDisplayName}`}
                              value={activeCred?.accessCredentialId || ''}
                              onChange={(e) =>
                                setSelectedSummaryCredByAvatar((prev) => ({
                                  ...prev,
                                  [sub.avatarId]: e.target.value,
                                }))
                              }
                              className="px-2.5 py-1 rounded-lg border border-stone-300 text-[11px] bg-stone-50 text-stone-800 font-medium"
                            >
                              {subCreds.map((c) => (
                                <option key={c.accessCredentialId} value={c.accessCredentialId}>
                                  {c.interlocutorName} ({c.relationshipToPerson}) — {c.personalCodePlain}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>

                        {activeCred ? (
                          <>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs bg-stone-50 px-3 py-2 rounded-lg border border-stone-200/80">
                              <div className="truncate">
                                <span className="text-stone-500">Familiar: </span>
                                <strong className="text-stone-900">
                                  {activeCred.interlocutorName}
                                </strong>{' '}
                                <span className="text-stone-500">
                                  ({activeCred.relationshipToPerson})
                                </span>
                              </div>
                              <div className="font-mono text-xs font-bold text-amber-900 bg-amber-100/80 px-2 py-0.5 rounded border border-amber-300/70 shrink-0">
                                {activeShareCode}
                              </div>
                            </div>

                            <div className="text-[11px] text-stone-500 font-mono truncate">
                              {activeShareUrl}
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard?.writeText(activeShareCode);
                                  showNotice(
                                    'ok',
                                    `Código ${activeShareCode} copiado al portapapeles.`
                                  );
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-950 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                              >
                                <Copy className="w-3 h-3" />
                                <span>Copiar Código</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard?.writeText(activeShareUrl);
                                  showNotice(
                                    'ok',
                                    `Enlace de acceso copiado: ${activeShareUrl}`
                                  );
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-800 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                              >
                                <Copy className="w-3 h-3" />
                                <span>Copiar Enlace</span>
                              </button>

                              <a
                                href={`https://wa.me/?text=${encodeURIComponent(shareWhatsAppText)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                              >
                                <Share2 className="w-3 h-3" />
                                <span>WhatsApp</span>
                              </a>

                              <a
                                href={`mailto:?subject=${encodeURIComponent(shareEmailSubject)}&body=${encodeURIComponent(shareEmailBody)}`}
                                className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-stone-100 border border-stone-300 text-stone-800 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                              >
                                <Mail className="w-3 h-3 text-amber-800" />
                                <span>Correo</span>
                              </a>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center justify-between gap-2 text-xs text-stone-500">
                            <span>Sin códigos familiares activos aún.</span>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAvatarId(sub.avatarId);
                                setActiveSubTab('familiares');
                              }}
                              className="px-2.5 py-1 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-950 text-[11px] font-semibold cursor-pointer"
                            >
                              + Crear Código Familiar
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {activeCred && (
                          <button
                            onClick={() => setPreviewPersonalCode(activeCred.personalCodePlain)}
                            className="px-3 py-1.5 rounded-lg bg-stone-900 text-amber-200 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Conversar / Vista Previa</span>
                          </button>
                        )}
                        {subPdf && (
                          <button
                            onClick={() =>
                              handleDownloadArchivedPdf(subPdf.pdfId, subPdf.fileName)
                            }
                            className="px-3 py-1.5 rounded-lg bg-white border border-stone-300 text-stone-700 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Descargar PDF Compilado</span>
                          </button>
                        )}
                        {subPersons[0] && (
                          <button
                            onClick={() =>
                              requestDeletePersonProfileConfirmation(
                                subPersons[0].personId,
                                subPersons[0].fullName,
                                subPdf?.fileName
                              )
                            }
                            className="px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 text-red-800 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Eliminar Perfil y PDF</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. PESTAÑA: AVATARES */}
      {activeSubTab === 'avatares' && overview && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-5">
            <div>
              <h3 className="font-serif text-lg text-stone-900">
                Crear o Sincronizar Avatar desde el «Compilado Testimonial Fidedigno»
              </h3>
              <p className="text-xs text-stone-500 mt-1">
                Al seleccionar una entrevista existente, si el PDF del Compilado Testimonial
                Fidedigno aún no se ha generado, el sistema lo genera y archiva automáticamente a
                partir de las preguntas y respuestas literales. También puedes subir un archivo PDF.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  1. Seleccionar Entrevista Existente en YouForever
                </label>
                <select
                  value={selectedInterviewId}
                  onChange={(e) => setSelectedInterviewId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 text-xs bg-white"
                >
                  <option value="">-- O crear desde PDF / Texto subido manualmente --</option>
                  {overview.availableInterviews.map((intv) => (
                    <option key={intv.interviewId} value={intv.interviewId}>
                      {intv.title} ({intv.answersCount} respuestas literales • Modo: {intv.mode})
                      {intv.hasMiEsenciaAvatar ? ' [Avatar ya creado - Sincronizar]' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  2. Plan Comercial Inicial
                </label>
                <select
                  value={selectedPlanIdForNew}
                  onChange={(e) => setSelectedPlanIdForNew(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 text-xs bg-white"
                >
                  {overview.plans.map((p) => (
                    <option key={p.planId} value={p.planId}>
                      {p.name} (${p.priceMxn} {p.currency})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  3. Nombre del Avatar Familiar (opcional)
                </label>
                <input
                  type="text"
                  value={customAvatarName}
                  onChange={(e) => setCustomAvatarName(e.target.value)}
                  placeholder="Se tomará automáticamente el nombre del entrevistado(s)"
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  4. Nivel de Espontaneidad Conversacional Inicial
                </label>
                <select
                  value={selectedSpontaneity}
                  onChange={(e) =>
                    setSelectedSpontaneity(e.target.value as MiEsenciaSpontaneityLevel)
                  }
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 text-xs bg-white"
                >
                  <option value="bajo">Bajo (Ceñido estrictamente a respuestas literales)</option>
                  <option value="moderado">Moderado (Conversacional cálido y fiel - Recomendado)</option>
                  <option value="alto">Alto (Expresivo con preguntas afectuosas de vuelta)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-stone-200">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-stone-700">
                  Opcional: Subir archivo PDF del Compilado Testimonial Fidedigno
                </label>
                <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-stone-300 bg-stone-50 hover:bg-stone-100 text-xs text-stone-700 cursor-pointer">
                  <Upload className="w-4 h-4 text-amber-700" />
                  <span>
                    {uploadedPdfFileName || 'Seleccionar archivo PDF de Compilado Testimonial...'}
                  </span>
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={handlePdfUploadChange}
                    className="hidden"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-stone-700 pt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isCoupleModeOverride}
                    onChange={(e) => setIsCoupleModeOverride(e.target.checked)}
                    className="rounded border-stone-300 text-amber-700"
                  />
                  <span>
                    Entrevista en modalidad de pareja (crear 2 perfiles separados bajo 1 sola
                    suscripción familiar)
                  </span>
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Opcional: Pegar bloques adicionales de Pregunta + Respuesta literal
                </label>
                <textarea
                  rows={3}
                  value={uploadedCompilationText}
                  onChange={(e) => setUploadedCompilationText(e.target.value)}
                  placeholder="### 1. ¿Pregunta literal?&#10;**Respuesta:**&#10;Texto literal..."
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 text-xs font-mono"
                />
              </div>
            </div>

            {/* Opcional: Selección de proveedor y prompts iniciales desde la Biblioteca Global al crear el avatar */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-stone-200 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  Opcional: Proveedor IA Principal Inicial
                </label>
                <select
                  value={initialPrimaryProviderForNew}
                  onChange={(e) =>
                    setInitialPrimaryProviderForNew(e.target.value as MiEsenciaAiProvider)
                  }
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
                >
                  <option value="gemini">Google Gemini (Por defecto)</option>
                  <option value="openai">OpenAI GPT</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  Opcional: Copiar Prompt Gemini Inicial de Biblioteca
                </label>
                <select
                  value={initialLibraryPromptForGemini}
                  onChange={(e) => setInitialLibraryPromptForGemini(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
                >
                  <option value="">-- Conservar modo existente por defecto --</option>
                  {(overview.promptLibrary || [])
                    .filter(
                      (p) => p.compatibleProvider === 'gemini' || p.compatibleProvider === 'ambos'
                    )
                    .map((p) => (
                      <option key={p.promptId} value={p.promptId}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  Opcional: Copiar Prompt OpenAI Inicial de Biblioteca
                </label>
                <select
                  value={initialLibraryPromptForOpenAi}
                  onChange={(e) => setInitialLibraryPromptForOpenAi(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
                >
                  <option value="">-- Conservar modo existente por defecto --</option>
                  {(overview.promptLibrary || [])
                    .filter(
                      (p) => p.compatibleProvider === 'openai' || p.compatibleProvider === 'ambos'
                    )
                    .map((p) => (
                      <option key={p.promptId} value={p.promptId}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleCreateOrSyncAvatar}
                disabled={isCreatingAvatar}
                className="px-5 py-2.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-amber-300 font-semibold text-xs transition flex items-center gap-2 cursor-pointer"
              >
                {isCreatingAvatar ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Generando PDF Compilado y Perfiles Biográficos...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Generar / Actualizar Avatar y Archivar PDF Compilado</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Lista de Perfiles Biográficos creados */}
          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
            <h3 className="font-serif text-lg text-stone-900">
              Perfiles Biográficos (Entidad A), Motor IA (Gemini / OpenAI) y PDFs Archivados
            </h3>
            {overview.persons.length === 0 ? (
              <p className="text-xs text-stone-500">No hay perfiles creados todavía.</p>
            ) : (
              <div className="space-y-4">
                {overview.persons.map((person) => {
                  const pdf = overview.compilationPdfs.find((p) => p.pdfId === person.sourcePdfId);
                  const testCount = overview.testimonies.filter(
                    (t) =>
                      t.personId === person.personId &&
                      (!person.sourcePdfId || t.sourcePdfId === person.sourcePdfId)
                  ).length;
                  const cred = overview.credentials.find((c) => c.avatarId === person.avatarId);
                  const isExpanded = expandedAiConfigPersonId === person.personId;
                  const ai = person.aiConfig;

                  return (
                    <div
                      key={person.personId}
                      className="p-4 rounded-xl border border-stone-200 space-y-3"
                    >
                      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-serif font-bold text-base text-stone-900">
                              {person.fullName}
                            </span>
                            {person.relationshipLabelInCouple && (
                              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[11px] font-medium">
                                {person.relationshipLabelInCouple}
                              </span>
                            )}
                            <span className="px-2 py-0.5 rounded-full bg-stone-200 text-stone-800 text-[11px]">
                              v{person.version} • {testCount} testimonios exclusivos en su PDF
                            </span>
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                                ai?.conversationConfigMode === 'modo_personalizado'
                                  ? 'bg-emerald-100 text-emerald-900'
                                  : 'bg-stone-100 text-stone-700'
                              }`}
                            >
                              {ai?.conversationConfigMode === 'modo_personalizado'
                                ? `IA: ${
                                    ai.primaryProvider === 'openai' ? 'OpenAI GPT' : 'Gemini'
                                  } (${
                                    ai.primaryProvider === 'openai'
                                      ? ai.openaiModel
                                      : ai.geminiModel
                                  })`
                                : 'Modo Existente (Gemini)'}
                            </span>
                          </div>
                          <p className="text-xs text-stone-600">{person.biographySummary}</p>
                          {pdf && (
                            <p className="text-[11px] text-amber-900 font-medium">
                              Archivo PDF asignado exclusivamente a este perfil:{' '}
                              <span className="font-mono">{pdf.fileName}</span> (ID: {pdf.pdfId})
                            </p>
                          )}
                          <p className="text-[11px] text-stone-500">
                            Expresiones frecuentes:{' '}
                            {person.linguisticProfile.frequentExpressions.join(', ') || 'Naturales'}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedAiConfigPersonId(isExpanded ? null : person.personId)
                            }
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                              isExpanded
                                ? 'bg-amber-600 text-stone-950'
                                : 'bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300'
                            }`}
                          >
                            <Cpu className="w-3.5 h-3.5" />
                            <span>
                              {isExpanded
                                ? 'Ocultar Configuración IA y Prompts'
                                : 'Configurar IA, Prompts y PDF'}
                            </span>
                          </button>

                          <select
                            value={person.spontaneityLevel}
                            onChange={(e) =>
                              handleUpdateSpontaneity(
                                person.personId,
                                e.target.value as MiEsenciaSpontaneityLevel
                              )
                            }
                            className="px-2.5 py-1.5 rounded-lg border border-stone-300 text-xs bg-white"
                          >
                            <option value="bajo">Espontaneidad: Baja</option>
                            <option value="moderado">Espontaneidad: Moderada</option>
                            <option value="alto">Espontaneidad: Alta</option>
                          </select>

                          {pdf && (
                            <button
                              onClick={() => handleDownloadArchivedPdf(pdf.pdfId, pdf.fileName)}
                              className="px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                            >
                              <FileText className="w-3.5 h-3.5 text-amber-700" />
                              <span>Descargar PDF Compilado</span>
                            </button>
                          )}

                          {cred && (
                            <button
                              onClick={() => setPreviewPersonalCode(cred.personalCodePlain)}
                              className="px-3 py-1.5 rounded-lg bg-stone-900 text-amber-300 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Vista Familiar</span>
                            </button>
                          )}

                          <button
                            onClick={() =>
                              requestDeletePersonProfileConfirmation(
                                person.personId,
                                person.fullName,
                                pdf?.fileName
                              )
                            }
                            className="px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 text-red-800 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                            title="Eliminar este Perfil Biográfico (Entidad A) y su PDF Compilado Archivado"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Eliminar Perfil y PDF</span>
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <MiEsenciaAvatarAiConfigPanel
                          person={person}
                          archivedPdf={pdf}
                          testimoniesCount={testCount}
                          promptLibrary={overview.promptLibrary || []}
                          avatarPromptVersions={overview.avatarPromptVersions || []}
                          providersStatus={overview.providersStatus}
                          adminEmail={adminEmail}
                          onUpdated={fetchOverview}
                          onDownloadPdf={handleDownloadArchivedPdf}
                          onOpenSimulator={(simParams) => {
                            setSimulatorInitialState({
                              personId: simParams.personId,
                              provider: simParams.provider,
                              model: simParams.model,
                              draftPrompt: simParams.draftPromptContent,
                            });
                            setActiveSubTab('simulador');
                          }}
                          onNotify={showNotice}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* PESTAÑA: ADMINISTRADOR DE PROMPTS (BIBLIOTECA GLOBAL) */}
      {activeSubTab === 'administrador_prompts' && overview && (
        <MiEsenciaPromptLibraryPanel
          promptLibrary={overview.promptLibrary || []}
          customCategories={overview.config.customPromptCategories || []}
          persons={overview.persons}
          adminEmail={adminEmail}
          onUpdated={fetchOverview}
          onOpenSimulatorWithPrompt={(simParams) => {
            setSimulatorInitialState({
              personId: simParams.personId || overview.persons[0]?.personId,
              provider: simParams.provider,
              draftPrompt: simParams.draftPromptContent,
            });
            setActiveSubTab('simulador');
          }}
          onNotify={showNotice}
        />
      )}

      {/* PESTAÑA: SIMULADOR ADMINISTRATIVO («PROBAR CONVERSACIÓN») */}
      {activeSubTab === 'simulador' && overview && (
        <MiEsenciaSimulatorPanel
          persons={overview.persons}
          promptLibrary={overview.promptLibrary || []}
          initialPersonId={simulatorInitialState?.personId}
          initialProvider={simulatorInitialState?.provider}
          initialModel={simulatorInitialState?.model}
          initialDraftPrompt={simulatorInitialState?.draftPrompt}
          adminEmail={adminEmail}
          onSavedToAvatar={fetchOverview}
          onNotify={showNotice}
        />
      )}

      {/* 3. PESTAÑA: SUSCRIPCIONES */}
      {activeSubTab === 'suscripciones' && overview && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
            <h3 className="font-serif text-lg text-stone-900">
              Control de Vigencias, Renovación Acumulativa y Reloj Congelado
            </h3>
            <p className="text-xs text-stone-500">
              Al renovar una suscripción activa antes de su fecha de corte, el nuevo periodo se suma
              al vencimiento actual sin perder un solo día ya pagado.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Avatar Familiar
                </label>
                <select
                  value={selectedAvatarId}
                  onChange={(e) => setSelectedAvatarId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 text-xs bg-white"
                >
                  {overview.subscriptions.map((s) => (
                    <option key={s.avatarId} value={s.avatarId}>
                      {s.avatarDisplayName} ({s.status})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Unidad de Duración
                </label>
                <select
                  value={durationUnit}
                  onChange={(e) => setDurationUnit(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 text-xs bg-white"
                >
                  <option value="days">Días</option>
                  <option value="months">Meses</option>
                  <option value="years">Años</option>
                  <option value="exact_date">Fecha exacta de vencimiento</option>
                </select>
              </div>

              {durationUnit === 'exact_date' ? (
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Fecha Exacta
                  </label>
                  <input
                    type="date"
                    value={exactDateInput}
                    onChange={(e) => setExactDateInput(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 text-xs"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Cantidad a Sumar
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={durationValue}
                    onChange={(e) => setDurationValue(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 text-xs"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Monto Registrado (MXN)
                </label>
                <input
                  type="number"
                  min={0}
                  value={paymentAmountMxn}
                  onChange={(e) => setPaymentAmountMxn(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 text-xs"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <button
                onClick={() =>
                  selectedAvatarId &&
                  handleSubscriptionAction(
                    selectedAvatarId,
                    durationUnit === 'exact_date' ? 'set_exact_date' : 'renew_or_extend'
                  )
                }
                disabled={!selectedAvatarId}
                className="px-4 py-2 rounded-xl bg-stone-900 text-amber-300 text-xs font-semibold cursor-pointer"
              >
                Aplicar Renovación / Extensión de Vigencia
              </button>
              <button
                onClick={() =>
                  selectedAvatarId &&
                  handleSubscriptionAction(selectedAvatarId, 'suspend_clock_frozen')
                }
                disabled={!selectedAvatarId}
                className="px-3 py-2 rounded-xl bg-sky-100 text-sky-900 text-xs font-medium flex items-center gap-1 cursor-pointer"
              >
                <PauseCircle className="w-3.5 h-3.5" />
                <span>Suspender (Congelar Reloj sin perder días)</span>
              </button>
              <button
                onClick={() =>
                  selectedAvatarId &&
                  handleSubscriptionAction(selectedAvatarId, 'suspend_clock_running')
                }
                disabled={!selectedAvatarId}
                className="px-3 py-2 rounded-xl bg-amber-100 text-amber-900 text-xs font-medium flex items-center gap-1 cursor-pointer"
              >
                <PauseCircle className="w-3.5 h-3.5" />
                <span>Suspender (Reloj Corriendo)</span>
              </button>
              <button
                onClick={() =>
                  selectedAvatarId && handleSubscriptionAction(selectedAvatarId, 'resume')
                }
                disabled={!selectedAvatarId}
                className="px-3 py-2 rounded-xl bg-emerald-100 text-emerald-900 text-xs font-medium flex items-center gap-1 cursor-pointer"
              >
                <PlayCircle className="w-3.5 h-3.5" />
                <span>Reanudar Suscripción</span>
              </button>
            </div>
          </div>

          {/* Control Manual de Uso Mensual (Por Defecto y Masivo para Todos) */}
          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="font-serif text-base font-bold text-stone-900">
                  Control Manual de Uso Mensual de Mensajes (Por Defecto y Masivo)
                </h4>
                <p className="text-xs text-stone-500">
                  Ajusta un límite mensual por defecto para nuevos avatares o aplica un mismo número
                  configurable y/o reinicio de contador a todos los avatares activos.
                </p>
              </div>
              <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-900 text-xs font-semibold">
                Límite por defecto actual: {overview.config.defaultMonthlyMessageQuota ?? 1000} msjs/mes
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Límite Mensual Configurable (msjs/mes)
                </label>
                <input
                  type="number"
                  min={0}
                  value={bulkMonthlyQuotaInput}
                  onChange={(e) => setBulkMonthlyQuotaInput(Math.max(0, Number(e.target.value)))}
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 text-xs"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer pb-2">
                <input
                  type="checkbox"
                  checked={bulkSaveAsDefault}
                  onChange={(e) => setBulkSaveAsDefault(e.target.checked)}
                  className="rounded border-stone-300"
                />
                <span>Guardar como número por defecto para todos</span>
              </label>

              <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer pb-2">
                <input
                  type="checkbox"
                  checked={bulkResetAllCounters}
                  onChange={(e) => setBulkResetAllCounters(e.target.checked)}
                  className="rounded border-stone-300"
                />
                <span>Reiniciar contadores usados a 0 en todos</span>
              </label>

              <button
                type="button"
                onClick={handleApplyBulkMonthlyUsage}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-stone-950 text-xs font-semibold cursor-pointer"
              >
                Aplicar Límite Mensual a Todos
              </button>
            </div>
          </div>

          {/* Control Manual de Uso Diario de Mensajes (Por Defecto y Masivo para Todos) */}
          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="font-serif text-base font-bold text-stone-900">
                  Control Manual de Límite Diario de Mensajes (Por Defecto y en Bloque para Todos)
                </h4>
                <p className="text-xs text-stone-500">
                  Configura el límite de mensajes diarios por familiar para todos los avatares y/o
                  reinicia a 0 los mensajes usados hoy. Los cambios se sincronizan automáticamente
                  en vivo en la ventana <code>/miesencia</code>.
                </p>
              </div>
              <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-900 text-xs font-semibold">
                Límite diario por defecto: {overview.config.defaultDailyMessageQuota ?? 50} msjs/día
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Límite Diario Configurable (msjs/día)
                </label>
                <input
                  type="number"
                  min={0}
                  value={bulkDailyQuotaInput}
                  onChange={(e) => setBulkDailyQuotaInput(Math.max(0, Number(e.target.value)))}
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 text-xs"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer pb-2">
                <input
                  type="checkbox"
                  checked={bulkSaveDailyAsDefault}
                  onChange={(e) => setBulkSaveDailyAsDefault(e.target.checked)}
                  className="rounded border-stone-300"
                />
                <span>Guardar como límite diario por defecto</span>
              </label>

              <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer pb-2">
                <input
                  type="checkbox"
                  checked={bulkResetAllDailyCounters}
                  onChange={(e) => setBulkResetAllDailyCounters(e.target.checked)}
                  className="rounded border-stone-300"
                />
                <span>Reiniciar mensajes usados hoy a 0 en todos</span>
              </label>

              <button
                type="button"
                onClick={handleApplyBulkDailyUsage}
                className="px-4 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-amber-300 text-xs font-semibold cursor-pointer"
              >
                Aplicar Límite Diario a Todos
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-3">
            <h4 className="font-serif text-base text-stone-900">
              Detalle de Suscripciones y Ajuste Manual de Límites Mensuales y Diarios por Avatar
            </h4>
            {overview.subscriptions.map((sub) => {
              const editState = perAvatarUsageEdits[sub.avatarId] || {
                used: sub.messagesUsedThisMonth,
                quota: sub.monthlyMessageQuota,
              };
              const dailyQuotaEdit =
                perAvatarDailyQuotaEdits[sub.avatarId] ??
                sub.dailyMessageQuotaPerInterlocutor ??
                50;
              return (
                <div
                  key={sub.subscriptionId}
                  className="p-4 rounded-xl border border-stone-200 space-y-3 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-bold text-stone-900 text-sm">
                        {sub.avatarDisplayName}
                      </span>{' '}
                      <span className="text-stone-500">
                        ({sub.isCoupleAvatar ? 'Pareja: 2 perfiles separados' : 'Individual'})
                      </span>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-stone-900 text-amber-300 font-semibold">
                      Estado: {sub.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-stone-600">
                    <p>
                      <strong>Plan:</strong> {sub.planName}
                    </p>
                    <p>
                      <strong>Inicio:</strong> {new Date(sub.startsAt).toLocaleDateString('es-MX')}
                    </p>
                    <p>
                      <strong>Vencimiento:</strong>{' '}
                      {new Date(sub.expiresAt).toLocaleDateString('es-MX')}
                    </p>
                    <p>
                      <strong>Uso Mensual Actual:</strong>{' '}
                      <span className="font-semibold text-stone-900">
                        {sub.messagesUsedThisMonth} / {sub.monthlyMessageQuota} msjs
                      </span>
                    </p>
                    <p>
                      <strong>Límite Diario Avatar:</strong>{' '}
                      <span className="font-semibold text-emerald-800">
                        {sub.dailyMessageQuotaPerInterlocutor} msjs/día por familiar
                      </span>
                    </p>
                  </div>

                  {/* Controles de edición manual de uso mensual de este avatar */}
                  <div className="pt-2 border-t border-stone-100 flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-stone-600 font-medium">Mensajes usados (mes):</span>
                      <input
                        type="number"
                        min={0}
                        value={editState.used}
                        onChange={(e) =>
                          setPerAvatarUsageEdits((prev) => ({
                            ...prev,
                            [sub.avatarId]: {
                              used: Math.max(0, Number(e.target.value)),
                              quota: editState.quota,
                            },
                          }))
                        }
                        className="w-24 px-2.5 py-1 rounded-lg border border-stone-300 text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-stone-600 font-medium">Límite mensual:</span>
                      <input
                        type="number"
                        min={0}
                        value={editState.quota}
                        onChange={(e) =>
                          setPerAvatarUsageEdits((prev) => ({
                            ...prev,
                            [sub.avatarId]: {
                              used: editState.used,
                              quota: Math.max(0, Number(e.target.value)),
                            },
                          }))
                        }
                        className="w-28 px-2.5 py-1 rounded-lg border border-stone-300 text-xs"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateAvatarMonthlyUsage({
                          avatarId: sub.avatarId,
                          messagesUsedThisMonth: editState.used,
                          monthlyMessageQuota: editState.quota,
                        })
                      }
                      className="px-3 py-1.5 rounded-lg bg-stone-900 text-amber-300 font-semibold cursor-pointer"
                    >
                      Guardar Uso Mensual
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPerAvatarUsageEdits((prev) => ({
                          ...prev,
                          [sub.avatarId]: { used: 0, quota: editState.quota },
                        }));
                        handleUpdateAvatarMonthlyUsage({
                          avatarId: sub.avatarId,
                          monthlyMessageQuota: editState.quota,
                          resetUsedCounter: true,
                        });
                      }}
                      className="px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 font-medium flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reiniciar Mes a 0</span>
                    </button>
                  </div>

                  {/* Controles de edición manual de límite diario y reinicio diario de este avatar */}
                  <div className="pt-2 border-t border-stone-100 flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-stone-600 font-medium">
                        Límite diario por familiar (msjs/día):
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={dailyQuotaEdit}
                        onChange={(e) =>
                          setPerAvatarDailyQuotaEdits((prev) => ({
                            ...prev,
                            [sub.avatarId]: Math.max(0, Number(e.target.value)),
                          }))
                        }
                        className="w-24 px-2.5 py-1 rounded-lg border border-stone-300 text-xs"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateAvatarDailyUsage({
                          avatarId: sub.avatarId,
                          dailyMessageQuotaPerInterlocutor: dailyQuotaEdit,
                          propagateToAllAvatarInterlocutors: true,
                        })
                      }
                      className="px-3 py-1.5 rounded-lg bg-emerald-800 hover:bg-emerald-700 text-white font-semibold cursor-pointer"
                    >
                      Guardar Límite Diario del Avatar
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateAvatarDailyUsage({
                          avatarId: sub.avatarId,
                          dailyMessageQuotaPerInterlocutor: dailyQuotaEdit,
                          propagateToAllAvatarInterlocutors: true,
                          resetDailyCountersForAvatar: true,
                        })
                      }
                      className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-900 font-medium flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reiniciar Usados Hoy a 0 (Familiares de este Avatar)</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. PESTAÑA: PLANES Y PRECIOS (CON EDICIÓN MANUAL COMPLETA DE CADA PLAN ACTIVO) */}
      {activeSubTab === 'planes' && overview && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {overview.plans.map((plan) => (
              <div
                key={plan.planId}
                className={`bg-white p-5 rounded-2xl border shadow-sm space-y-2.5 ${
                  editingPlan?.planId === plan.planId
                    ? 'border-amber-500 ring-2 ring-amber-500/20'
                    : 'border-stone-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-serif font-bold text-stone-900">{plan.name}</h4>
                    <span className="text-[10px] font-mono text-stone-400">
                      Código: {plan.code} • {plan.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                  <span className="text-sm font-bold text-amber-800">
                    ${plan.priceMxn} {plan.currency}
                  </span>
                </div>
                <p className="text-xs text-stone-600">{plan.description}</p>
                <div className="text-[11px] text-stone-500 space-y-1 pt-2 border-t border-stone-100">
                  <p>
                    • Duración base: {plan.defaultDurationValue} {plan.defaultDurationUnit} (+
                    {plan.gracePeriodDays} días de gracia)
                  </p>
                  <p>• Hasta {plan.maxAuthorizedInterlocutors} códigos familiares individuales</p>
                  <p>
                    • Cuota: {plan.monthlyMessageQuotaPerAvatar} msjs/mes (
                    {plan.dailyMessageQuotaPerInterlocutor} diarios por familiar)
                  </p>
                  <p>
                    • Incluye: {plan.includesSharedMemories ? 'Nivel B ✓ ' : 'Nivel B ✕ '} •{' '}
                    {plan.includesPrivateMemories ? 'Nivel C ✓ ' : 'Nivel C ✕ '} •{' '}
                    {plan.includesSnapshots ? 'Snapshots ✓' : 'Snapshots ✕'}
                  </p>
                </div>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setEditingPlan({ ...plan })}
                    className="w-full py-1.5 px-3 rounded-xl bg-stone-100 hover:bg-amber-100 text-stone-800 hover:text-amber-950 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Modificar Plan y Configuraciones</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {editingPlan && (
            <div className="bg-amber-50/70 rounded-2xl border border-amber-300 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-serif text-lg font-bold text-stone-900">
                  Editar Configuraciones del Plan: «{editingPlan.name}»
                </h3>
                <button
                  type="button"
                  onClick={() => setEditingPlan(null)}
                  className="text-xs text-stone-600 hover:text-stone-900 cursor-pointer"
                >
                  Cancelar edición ✕
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Nombre del Plan</label>
                  <input
                    type="text"
                    value={editingPlan.name}
                    onChange={(e) => setEditingPlan({ ...editingPlan, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Código Interno</label>
                  <input
                    type="text"
                    value={editingPlan.code}
                    onChange={(e) =>
                      setEditingPlan({ ...editingPlan, code: e.target.value as any })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Precio</label>
                  <input
                    type="number"
                    min={0}
                    value={editingPlan.priceMxn}
                    onChange={(e) =>
                      setEditingPlan({ ...editingPlan, priceMxn: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Moneda</label>
                  <input
                    type="text"
                    value={editingPlan.currency}
                    onChange={(e) => setEditingPlan({ ...editingPlan, currency: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-stone-700 mb-1">Descripción</label>
                  <input
                    type="text"
                    value={editingPlan.description}
                    onChange={(e) =>
                      setEditingPlan({ ...editingPlan, description: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Unidad de Duración
                  </label>
                  <select
                    value={editingPlan.defaultDurationUnit}
                    onChange={(e) =>
                      setEditingPlan({
                        ...editingPlan,
                        defaultDurationUnit: e.target.value as any,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
                  >
                    <option value="days">Días</option>
                    <option value="months">Meses</option>
                    <option value="years">Años</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Valor de Duración
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={editingPlan.defaultDurationValue}
                    onChange={(e) =>
                      setEditingPlan({
                        ...editingPlan,
                        defaultDurationValue: Math.max(1, Number(e.target.value)),
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Días de Gracia</label>
                  <input
                    type="number"
                    min={0}
                    value={editingPlan.gracePeriodDays}
                    onChange={(e) =>
                      setEditingPlan({
                        ...editingPlan,
                        gracePeriodDays: Math.max(0, Number(e.target.value)),
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Máx. Códigos Familiares
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={editingPlan.maxAuthorizedInterlocutors}
                    onChange={(e) =>
                      setEditingPlan({
                        ...editingPlan,
                        maxAuthorizedInterlocutors: Math.max(1, Number(e.target.value)),
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Cuota Mensual por Avatar (msjs)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={editingPlan.monthlyMessageQuotaPerAvatar}
                    onChange={(e) =>
                      setEditingPlan({
                        ...editingPlan,
                        monthlyMessageQuotaPerAvatar: Math.max(1, Number(e.target.value)),
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Cuota Diaria por Familiar (msjs)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={editingPlan.dailyMessageQuotaPerInterlocutor}
                    onChange={(e) =>
                      setEditingPlan({
                        ...editingPlan,
                        dailyMessageQuotaPerInterlocutor: Math.max(1, Number(e.target.value)),
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-5 text-xs pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingPlan.includesSharedMemories}
                    onChange={(e) =>
                      setEditingPlan({
                        ...editingPlan,
                        includesSharedMemories: e.target.checked,
                      })
                    }
                  />
                  <span>Incluye Memorias Familiares Nivel B</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingPlan.includesPrivateMemories}
                    onChange={(e) =>
                      setEditingPlan({
                        ...editingPlan,
                        includesPrivateMemories: e.target.checked,
                      })
                    }
                  />
                  <span>Incluye Memorias Privadas Nivel C</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingPlan.includesSnapshots}
                    onChange={(e) =>
                      setEditingPlan({
                        ...editingPlan,
                        includesSnapshots: e.target.checked,
                      })
                    }
                  />
                  <span>Incluye Instantáneas (Snapshots)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingPlan.isActive}
                    onChange={(e) =>
                      setEditingPlan({
                        ...editingPlan,
                        isActive: e.target.checked,
                      })
                    }
                  />
                  <span>Plan Activo</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingPlan(null)}
                  className="px-4 py-2 rounded-xl bg-white border border-stone-300 text-xs font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveEditedPlan}
                  className="px-4 py-2 rounded-xl bg-stone-900 text-amber-300 text-xs font-semibold cursor-pointer"
                >
                  Guardar Cambios del Plan
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
            <h3 className="font-serif text-lg text-stone-900">Crear Plan Comercial a Medida</h3>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              <input
                type="text"
                value={newPlanName}
                onChange={(e) => setNewPlanName(e.target.value)}
                placeholder="Nombre del plan..."
                className="px-3 py-2 rounded-xl border border-stone-300 text-xs"
              />
              <input
                type="number"
                value={newPlanPrice}
                onChange={(e) => setNewPlanPrice(Number(e.target.value))}
                placeholder="Precio MXN"
                className="px-3 py-2 rounded-xl border border-stone-300 text-xs"
              />
              <select
                value={newPlanUnit}
                onChange={(e) => setNewPlanUnit(e.target.value as any)}
                className="px-3 py-2 rounded-xl border border-stone-300 text-xs bg-white"
              >
                <option value="days">Días</option>
                <option value="months">Meses</option>
                <option value="years">Años</option>
              </select>
              <input
                type="number"
                value={newPlanValue}
                onChange={(e) => setNewPlanValue(Number(e.target.value))}
                placeholder="Duración"
                className="px-3 py-2 rounded-xl border border-stone-300 text-xs"
              />
              <button
                onClick={handleSaveNewPlan}
                className="px-4 py-2 rounded-xl bg-stone-900 text-amber-300 text-xs font-semibold cursor-pointer"
              >
                Guardar Plan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. PESTAÑA: FAMILIARES Y CÓDIGOS (AGRUPADOS Y FILTRADOS POR AVATAR + MODIFICABLES MANUALMENTE) */}
      {activeSubTab === 'familiares' && overview && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
            <h3 className="font-serif text-lg text-stone-900">
              Generar Código Criptográfico Individual y Enlace Privado para Familiar
            </h3>
            <p className="text-xs text-stone-500">
              Cada familiar autorizado recibe un código personal alfanumérico único (<code>YF-XXXXX</code>, combinando letras y números con protección anti-fuerza bruta) y su
              propio enlace privado hacia <code>https://youforever.app/miesencia</code>. Ese código protege de forma
              exclusiva sus memorias privadas de Nivel C.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              <select
                value={selectedAvatarId}
                onChange={(e) => setSelectedAvatarId(e.target.value)}
                className="px-3 py-2 rounded-xl border border-stone-300 text-xs bg-white"
              >
                <option value="">-- Seleccionar Avatar --</option>
                {overview.subscriptions.map((s) => (
                  <option key={s.avatarId} value={s.avatarId}>
                    {s.avatarDisplayName}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={newFamName}
                onChange={(e) => setNewFamName(e.target.value)}
                placeholder="Nombre del familiar (ej. Ana Sofía)"
                className="px-3 py-2 rounded-xl border border-stone-300 text-xs"
              />
              <input
                type="text"
                value={newFamRelation}
                onChange={(e) => setNewFamRelation(e.target.value)}
                placeholder="Parentesco (ej. Hija, Nieto)"
                className="px-3 py-2 rounded-xl border border-stone-300 text-xs"
              />
              <input
                type="text"
                value={newFamAffectionate}
                onChange={(e) => setNewFamAffectionate(e.target.value)}
                placeholder="Apodo afectuoso opcional"
                className="px-3 py-2 rounded-xl border border-stone-300 text-xs"
              />
              <button
                onClick={handleCreateInterlocutor}
                className="px-4 py-2 rounded-xl bg-stone-900 text-amber-300 text-xs font-semibold cursor-pointer"
              >
                Generar Código y Enlace
              </button>
            </div>
          </div>

          {/* Lista de credenciales agrupadas y filtradas por Avatar */}
          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="font-serif text-base text-stone-900">
                  Códigos Personales y Enlaces Privados Directos (Por Avatar)
                </h4>
                <p className="text-xs text-stone-500">
                  Haz clic en el nombre del Avatar para desplegar todos sus códigos familiares
                  asociados o fíltralos directamente.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-stone-600">Filtrar por Avatar:</label>
                <select
                  value={credentialAvatarFilter}
                  onChange={(e) => setCredentialAvatarFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-xl border border-stone-300 text-xs bg-white"
                >
                  <option value="">Todos los Avatares ({overview.subscriptions.length})</option>
                  {overview.subscriptions.map((s) => (
                    <option key={s.avatarId} value={s.avatarId}>
                      {s.avatarDisplayName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {overview.credentials.length === 0 ? (
              <p className="text-xs text-stone-500">No hay códigos familiares generados aún.</p>
            ) : (
              <div className="space-y-3">
                {overview.subscriptions
                  .filter(
                    (sub) => !credentialAvatarFilter || sub.avatarId === credentialAvatarFilter
                  )
                  .map((sub) => {
                    const subCredentials = overview.credentials.filter(
                      (c) => c.avatarId === sub.avatarId
                    );
                    const isAvatarOpen =
                      expandedCredentialAvatars[sub.avatarId] ??
                      Boolean(credentialAvatarFilter === sub.avatarId);

                    return (
                      <div
                        key={sub.avatarId}
                        className="rounded-2xl border border-stone-200 overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedCredentialAvatars((prev) => ({
                              ...prev,
                              [sub.avatarId]: !isAvatarOpen,
                            }))
                          }
                          className="w-full px-4 py-3 bg-stone-50 hover:bg-stone-100 flex items-center justify-between text-left transition cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5">
                            {isAvatarOpen ? (
                              <ChevronDown className="w-4 h-4 text-amber-700" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-stone-500" />
                            )}
                            <span className="font-serif font-bold text-stone-900 text-sm">
                              {sub.avatarDisplayName}
                            </span>
                            <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[11px] font-semibold">
                              {subCredentials.length} código(s) asociado(s)
                            </span>
                          </div>
                          <span className="text-xs text-stone-500 font-medium">
                            {isAvatarOpen ? 'Ocultar códigos' : 'Abrir códigos del avatar'}
                          </span>
                        </button>

                        {isAvatarOpen && (
                          <div className="p-4 space-y-3 bg-white border-t border-stone-200">
                            {subCredentials.length === 0 ? (
                              <p className="text-xs text-stone-500">
                                Este avatar aún no tiene códigos familiares generados.
                              </p>
                            ) : (
                              subCredentials.map((cred) => {
                                const fullPrivateUrl = `https://youforever.app${cred.privateLinkPath}`;
                                const linkedInter = overview.interlocutors.find(
                                  (i) => i.interlocutorId === cred.interlocutorId
                                );
                                const isEditingThis =
                                  editingCredentialId === cred.accessCredentialId;

                                  const effectiveDailyLimit = Math.max(
                                    0,
                                    Number(
                                      linkedInter?.customDailyMessageLimit ??
                                        sub.dailyMessageQuotaPerInterlocutor ??
                                        overview.config.defaultDailyMessageQuota ??
                                        50
                                    )
                                  );
                                  const usedToday = Math.max(
                                    0,
                                    Number(linkedInter?.messagesSentToday ?? 0)
                                  );
                                  const remainingToday = Math.max(0, effectiveDailyLimit - usedToday);
                                  const interEdit = linkedInter
                                    ? perInterlocutorDailyEdits[linkedInter.interlocutorId] || {
                                        usedToday,
                                        dailyLimit: effectiveDailyLimit,
                                      }
                                    : { usedToday, dailyLimit: effectiveDailyLimit };

                                  return (
                                    <div
                                      key={cred.accessCredentialId}
                                      className="p-4 rounded-xl border border-stone-200 space-y-3 text-xs"
                                    >
                                      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                                        <div className="space-y-1">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-bold text-stone-900 text-sm">
                                              {cred.interlocutorName}
                                            </span>
                                            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-medium">
                                              {cred.relationshipToPerson}
                                            </span>
                                            {linkedInter?.isGeneralAccess && (
                                              <span
                                                className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-900 font-semibold"
                                                title="Código general: no está relacionado con ningún familiar; el avatar no sabe con quién conversa. Es compartido: no guarda memorias privadas."
                                              >
                                                Código general (sin identificar)
                                              </span>
                                            )}
                                            {linkedInter?.affectionateCallName && (
                                              <span className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-700">
                                                Apodo: «{linkedInter.affectionateCallName}»
                                              </span>
                                            )}
                                            <span
                                              className={`px-2 py-0.5 rounded-full font-semibold ${
                                                cred.status === 'activo'
                                                  ? 'bg-emerald-100 text-emerald-900'
                                                  : 'bg-red-100 text-red-900'
                                              }`}
                                            >
                                              {cred.status}
                                            </span>
                                            <span
                                              className={`px-2.5 py-0.5 rounded-full font-semibold ${
                                                remainingToday === 0
                                                  ? 'bg-rose-100 text-rose-900 border border-rose-300'
                                                  : 'bg-sky-100 text-sky-900'
                                              }`}
                                            >
                                              Hoy: {usedToday} usados / {effectiveDailyLimit} límite
                                              diario ({remainingToday} restantes)
                                            </span>
                                          </div>
                                          <p className="font-mono text-stone-800">
                                            Código personal:{' '}
                                            <strong>{cred.personalCodePlain}</strong>
                                          </p>
                                          <p className="text-stone-500 break-all">
                                            Enlace privado exclusivo: {fullPrivateUrl}
                                          </p>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              if (isEditingThis) {
                                                setEditingCredentialId(null);
                                              } else {
                                                setEditingCredentialId(cred.accessCredentialId);
                                                setCredentialEditForm({
                                                  fullName: cred.interlocutorName,
                                                  relationshipToPerson: cred.relationshipToPerson,
                                                  affectionateCallName:
                                                    linkedInter?.affectionateCallName || '',
                                                  email: linkedInter?.email || '',
                                                  customPersonalCode: cred.personalCodePlain,
                                                  customDailyMessageLimit: effectiveDailyLimit,
                                                  messagesSentToday: usedToday,
                                                });
                                              }
                                            }}
                                            className="px-3 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-950 font-semibold flex items-center gap-1 cursor-pointer"
                                          >
                                            <Edit3 className="w-3.5 h-3.5" />
                                            <span>
                                              {isEditingThis ? 'Cerrar Edición' : 'Modificar Código'}
                                            </span>
                                          </button>
                                          <button
                                            onClick={() => {
                                              navigator.clipboard?.writeText(fullPrivateUrl);
                                              showNotice(
                                                'ok',
                                                'Enlace privado copiado al portapapeles.'
                                              );
                                            }}
                                            className="px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-800 font-medium flex items-center gap-1 cursor-pointer"
                                          >
                                            <Copy className="w-3.5 h-3.5" />
                                            <span>Copiar Enlace</span>
                                          </button>
                                          <button
                                            onClick={() =>
                                              setPreviewPersonalCode(cred.personalCodePlain)
                                            }
                                            className="px-3 py-1.5 rounded-lg bg-stone-900 text-amber-300 font-medium flex items-center gap-1 cursor-pointer"
                                          >
                                            <ExternalLink className="w-3.5 h-3.5" />
                                            <span>Abrir Portal Familiar</span>
                                          </button>
                                          <button
                                            onClick={() =>
                                              handleCredentialStatus(
                                                cred.accessCredentialId,
                                                'activo',
                                                true
                                              )
                                            }
                                            className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 font-medium cursor-pointer"
                                          >
                                            Regenerar Código
                                          </button>
                                          {cred.status === 'activo' ? (
                                            <button
                                              onClick={() =>
                                                handleCredentialStatus(
                                                  cred.accessCredentialId,
                                                  'revocado',
                                                  false
                                                )
                                              }
                                              className="px-3 py-1.5 rounded-lg bg-red-50 text-red-800 font-medium cursor-pointer"
                                            >
                                              Revocar
                                            </button>
                                          ) : (
                                            <button
                                              onClick={() =>
                                                handleCredentialStatus(
                                                  cred.accessCredentialId,
                                                  'activo',
                                                  false
                                                )
                                              }
                                              className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 font-medium cursor-pointer"
                                            >
                                              Reactivar
                                            </button>
                                          )}
                                          <button
                                            onClick={() =>
                                              handleDeleteCredential(
                                                cred.accessCredentialId,
                                                cred.interlocutorName,
                                                cred.personalCodePlain
                                              )
                                            }
                                            className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium flex items-center gap-1 cursor-pointer"
                                            title="Borrar definitivamente este código personal y su enlace privado"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                            <span>Borrar</span>
                                          </button>
                                        </div>
                                      </div>

                                      {/* Control rápido de mensajes diarios y usados hoy para este código familiar */}
                                      {linkedInter && (
                                        <div className="pt-2 border-t border-stone-100 flex flex-wrap items-center gap-3">
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-stone-600 font-medium">
                                              Usados hoy:
                                            </span>
                                            <input
                                              type="number"
                                              min={0}
                                              value={interEdit.usedToday}
                                              onChange={(e) =>
                                                setPerInterlocutorDailyEdits((prev) => ({
                                                  ...prev,
                                                  [linkedInter.interlocutorId]: {
                                                    usedToday: Math.max(0, Number(e.target.value)),
                                                    dailyLimit: interEdit.dailyLimit,
                                                  },
                                                }))
                                              }
                                              className="w-20 px-2 py-1 rounded-lg border border-stone-300 text-xs"
                                            />
                                          </div>
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-stone-600 font-medium">
                                              Límite diario individual:
                                            </span>
                                            <input
                                              type="number"
                                              min={0}
                                              value={interEdit.dailyLimit}
                                              onChange={(e) =>
                                                setPerInterlocutorDailyEdits((prev) => ({
                                                  ...prev,
                                                  [linkedInter.interlocutorId]: {
                                                    usedToday: interEdit.usedToday,
                                                    dailyLimit: Math.max(0, Number(e.target.value)),
                                                  },
                                                }))
                                              }
                                              className="w-24 px-2 py-1 rounded-lg border border-stone-300 text-xs"
                                            />
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleUpdateInterlocutorDailyUsage({
                                                interlocutorId: linkedInter.interlocutorId,
                                                interlocutorName: cred.interlocutorName,
                                                customDailyMessageLimit: interEdit.dailyLimit,
                                                messagesSentToday: interEdit.usedToday,
                                              })
                                            }
                                            className="px-3 py-1 rounded-lg bg-stone-900 text-amber-300 font-semibold cursor-pointer"
                                          >
                                            Guardar Límite y Usados Hoy
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setPerInterlocutorDailyEdits((prev) => ({
                                                ...prev,
                                                [linkedInter.interlocutorId]: {
                                                  usedToday: 0,
                                                  dailyLimit: interEdit.dailyLimit,
                                                },
                                              }));
                                              handleUpdateInterlocutorDailyUsage({
                                                interlocutorId: linkedInter.interlocutorId,
                                                interlocutorName: cred.interlocutorName,
                                                customDailyMessageLimit: interEdit.dailyLimit,
                                                resetDailyCounter: true,
                                              });
                                            }}
                                            className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 font-medium flex items-center gap-1 cursor-pointer"
                                          >
                                            <RotateCcw className="w-3.5 h-3.5" />
                                            <span>Reiniciar Hoy a 0</span>
                                          </button>
                                        </div>
                                      )}

                                      {isEditingThis && (
                                        <div className="pt-3 border-t border-stone-200 bg-stone-50 p-3 rounded-xl space-y-3">
                                          <div className="grid grid-cols-1 sm:grid-cols-6 gap-2.5">
                                            <div>
                                              <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                                                Código Personal
                                              </label>
                                              <input
                                                type="text"
                                                value={credentialEditForm.customPersonalCode}
                                                onChange={(e) =>
                                                  setCredentialEditForm({
                                                    ...credentialEditForm,
                                                    customPersonalCode: e.target.value.toUpperCase(),
                                                  })
                                                }
                                                className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 bg-white font-mono text-xs"
                                              />
                                            </div>
                                            <div>
                                              <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                                                Nombre del Familiar
                                              </label>
                                              <input
                                                type="text"
                                                value={credentialEditForm.fullName}
                                                onChange={(e) =>
                                                  setCredentialEditForm({
                                                    ...credentialEditForm,
                                                    fullName: e.target.value,
                                                  })
                                                }
                                                className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 bg-white text-xs"
                                              />
                                            </div>
                                            <div>
                                              <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                                                Parentesco
                                              </label>
                                              <input
                                                type="text"
                                                value={credentialEditForm.relationshipToPerson}
                                                onChange={(e) =>
                                                  setCredentialEditForm({
                                                    ...credentialEditForm,
                                                    relationshipToPerson: e.target.value,
                                                  })
                                                }
                                                className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 bg-white text-xs"
                                              />
                                            </div>
                                            <div>
                                              <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                                                Apodo Afectuoso
                                              </label>
                                              <input
                                                type="text"
                                                value={credentialEditForm.affectionateCallName}
                                                onChange={(e) =>
                                                  setCredentialEditForm({
                                                    ...credentialEditForm,
                                                    affectionateCallName: e.target.value,
                                                  })
                                                }
                                                className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 bg-white text-xs"
                                              />
                                            </div>
                                            <div>
                                              <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                                                Límite Diario (msjs)
                                              </label>
                                              <input
                                                type="number"
                                                min={0}
                                                value={credentialEditForm.customDailyMessageLimit}
                                                onChange={(e) =>
                                                  setCredentialEditForm({
                                                    ...credentialEditForm,
                                                    customDailyMessageLimit: Math.max(
                                                      0,
                                                      Number(e.target.value)
                                                    ),
                                                  })
                                                }
                                                className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 bg-white text-xs"
                                              />
                                            </div>
                                            <div className="flex items-end gap-2">
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleSaveEditedCredential(cred.accessCredentialId)
                                                }
                                                className="w-full py-1.5 px-3 rounded-lg bg-stone-900 text-amber-300 font-semibold text-xs cursor-pointer"
                                              >
                                                Actualizar Código
                                              </button>
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 6. PESTAÑA: CONVERSACIONES */}
      {activeSubTab === 'conversaciones' && overview && (
        <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-serif text-lg text-stone-900">
                Historial de Conversaciones Agrupadas por Avatar y por Familiar
              </h3>
              <p className="text-xs text-stone-500">
                Haz clic en un Avatar para ver a los familiares que han conversado con él y despliega cada familiar para revisar su historial de sesiones y mensajes.
              </p>
            </div>
          </div>
          {overview.conversations.length === 0 ? (
            <p className="text-xs text-stone-500">
              Aún no se han registrado conversaciones familiares.
            </p>
          ) : (
            <div className="space-y-4">
              {(() => {
                // Agrupar conversaciones por avatarId
                const avatarGroupsMap = new Map<
                  string,
                  {
                    avatarId: string;
                    avatarDisplayName: string;
                    sessions: MiEsenciaConversationSession[];
                  }
                >();

                for (const sub of overview.subscriptions) {
                  const subSessions = overview.conversations.filter(
                    (c) => c.avatarId === sub.avatarId
                  );
                  if (subSessions.length > 0) {
                    avatarGroupsMap.set(sub.avatarId, {
                      avatarId: sub.avatarId,
                      avatarDisplayName: sub.avatarDisplayName,
                      sessions: subSessions,
                    });
                  }
                }

                // Incluir sesiones cuyo avatarId no esté en subscriptions activas
                for (const sess of overview.conversations) {
                  if (!avatarGroupsMap.has(sess.avatarId)) {
                    const person = overview.persons.find((p) => p.personId === sess.personId);
                    avatarGroupsMap.set(sess.avatarId, {
                      avatarId: sess.avatarId,
                      avatarDisplayName: person?.fullName || `Avatar ${sess.avatarId}`,
                      sessions: [sess],
                    });
                  } else {
                    const group = avatarGroupsMap.get(sess.avatarId)!;
                    if (!group.sessions.some((s) => s.sessionId === sess.sessionId)) {
                      group.sessions.push(sess);
                    }
                  }
                }

                const avatarGroups = Array.from(avatarGroupsMap.values());

                return avatarGroups.map((avatarGroup) => {
                  const isAvatarExpanded = Boolean(
                    expandedConversationAvatars[avatarGroup.avatarId]
                  );

                  // Dentro del Avatar, agrupar por Familiar (interlocutorId)
                  const famGroupsMap = new Map<
                    string,
                    {
                      interlocutorKey: string;
                      interlocutorId: string;
                      interlocutorName: string;
                      interlocutorRelationship: string;
                      personalCode?: string;
                      sessions: MiEsenciaConversationSession[];
                    }
                  >();

                  for (const sess of avatarGroup.sessions) {
                    const key =
                      sess.interlocutorId ||
                      `${sess.interlocutorRelationship}_${sess.interlocutorName}`;
                    const cred = overview.credentials.find(
                      (c) => c.interlocutorId === sess.interlocutorId
                    );
                    const inter = overview.interlocutors.find(
                      (i) => i.interlocutorId === sess.interlocutorId
                    );
                    if (!famGroupsMap.has(key)) {
                      famGroupsMap.set(key, {
                        interlocutorKey: `${avatarGroup.avatarId}::${key}`,
                        interlocutorId: sess.interlocutorId,
                        interlocutorName: inter?.fullName || sess.interlocutorName || 'Familiar',
                        interlocutorRelationship:
                          inter?.relationshipToPerson || sess.interlocutorRelationship || 'Familiar',
                        personalCode: cred?.personalCodePlain,
                        sessions: [sess],
                      });
                    } else {
                      famGroupsMap.get(key)!.sessions.push(sess);
                    }
                  }

                  const famGroups = Array.from(famGroupsMap.values());
                  const totalMessagesInAvatar = avatarGroup.sessions.reduce(
                    (acc, s) => acc + s.messages.length,
                    0
                  );

                  return (
                    <div
                      key={avatarGroup.avatarId}
                      className="rounded-2xl border border-stone-200 overflow-hidden bg-white"
                    >
                      {/* Cabecera desplegable del Avatar */}
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedConversationAvatars((prev) => ({
                            ...prev,
                            [avatarGroup.avatarId]: !isAvatarExpanded,
                          }))
                        }
                        className="w-full px-5 py-3.5 bg-stone-50 hover:bg-stone-100 flex flex-wrap items-center justify-between gap-3 text-left transition cursor-pointer"
                      >
                        <div className="flex flex-wrap items-center gap-2.5">
                          {isAvatarExpanded ? (
                            <ChevronDown className="w-4 h-4 text-amber-700 shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-stone-500 shrink-0" />
                          )}
                          <span className="font-serif font-bold text-stone-900 text-base">
                            {avatarGroup.avatarDisplayName}
                          </span>
                          <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[11px] font-semibold">
                            {famGroups.length} familiar(es)
                          </span>
                          <span className="px-2.5 py-0.5 rounded-full bg-stone-200 text-stone-800 text-[11px] font-medium">
                            {avatarGroup.sessions.length} sesión(es) • {totalMessagesInAvatar}{' '}
                            mensaje(s)
                          </span>
                        </div>
                        <span className="text-xs text-stone-600 font-medium">
                          {isAvatarExpanded
                            ? 'Ocultar familiares'
                            : 'Ver familiares y conversaciones'}
                        </span>
                      </button>

                      {/* Lista desplegable de Familiares dentro del Avatar */}
                      {isAvatarExpanded && (
                        <div className="p-4 space-y-3 border-t border-stone-200 bg-white">
                          {famGroups.map((fam) => {
                            const isFamExpanded = Boolean(
                              expandedConversationInterlocutors[fam.interlocutorKey]
                            );
                            const totalFamMessages = fam.sessions.reduce(
                              (acc, s) => acc + s.messages.length,
                              0
                            );

                            return (
                              <div
                                key={fam.interlocutorKey}
                                className="rounded-xl border border-stone-200 overflow-hidden"
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedConversationInterlocutors((prev) => ({
                                      ...prev,
                                      [fam.interlocutorKey]: !isFamExpanded,
                                    }))
                                  }
                                  className="w-full px-4 py-3 bg-amber-50/40 hover:bg-amber-50/80 flex flex-wrap items-center justify-between gap-2 text-left transition cursor-pointer"
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    {isFamExpanded ? (
                                      <ChevronDown className="w-4 h-4 text-amber-700 shrink-0" />
                                    ) : (
                                      <ChevronRight className="w-4 h-4 text-stone-500 shrink-0" />
                                    )}
                                    <span className="font-bold text-stone-900 text-xs">
                                      {fam.interlocutorName}
                                    </span>
                                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[11px] font-medium">
                                      {fam.interlocutorRelationship}
                                    </span>
                                    {fam.personalCode && (
                                      <span className="px-2 py-0.5 rounded-md bg-stone-100 border border-stone-200 font-mono text-[11px] text-stone-700">
                                        Código: {fam.personalCode}
                                      </span>
                                    )}
                                    <span className="text-[11px] text-stone-500">
                                      ({fam.sessions.length} sesión(es) • {totalFamMessages}{' '}
                                      mensajes)
                                    </span>
                                  </div>
                                  <span className="text-[11px] text-amber-800 font-semibold">
                                    {isFamExpanded
                                      ? 'Ocultar historial'
                                      : 'Desplegar historial de conversación'}
                                  </span>
                                </button>

                                {isFamExpanded && (
                                  <div className="p-4 space-y-3 bg-white border-t border-stone-200">
                                    {fam.sessions.map((sess) => {
                                      const sessionPerson = overview.persons.find(
                                        (p) => p.personId === sess.personId
                                      );
                                      const sessionPdf = sessionPerson?.sourcePdfId
                                        ? overview.compilationPdfs.find(
                                            (pdf) => pdf.pdfId === sessionPerson.sourcePdfId
                                          )
                                        : undefined;
                                      return (
                                        <div
                                          key={sess.sessionId}
                                          className="p-4 rounded-xl border border-stone-200 space-y-2 text-xs bg-stone-50/40"
                                        >
                                          <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="space-y-0.5">
                                              <span className="font-bold text-stone-900 block">
                                                {sess.title ||
                                                  `${sess.interlocutorRelationship} ${sess.interlocutorName}`}{' '}
                                                ({sess.messages.length} mensajes)
                                              </span>
                                              <span className="text-[11px] text-stone-500 block">
                                                Perfil Digital:{' '}
                                                <strong>
                                                  {sessionPerson?.fullName || sess.personId}
                                                </strong>
                                                {sessionPdf
                                                  ? ` • Compilado base: ${sessionPdf.fileName}`
                                                  : ''}
                                                {sess.lastProviderUsed
                                                  ? ` • Último motor: ${sess.lastProviderUsed.toUpperCase()} (${sess.lastModelUsed || ''})`
                                                  : ''}
                                              </span>
                                            </div>

                                            <div className="flex flex-wrap items-center gap-2">
                                              {sess.hasPrivateLevelCMemories && (
                                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-sky-100 text-sky-900 font-medium">
                                                  <Lock className="w-3 h-3" />
                                                  Incluye confidencias Nivel C aisladas
                                                </span>
                                              )}
                                              <button
                                                onClick={() =>
                                                  handleDeleteConversation(
                                                    sess.sessionId,
                                                    sess.title ||
                                                      `${sess.interlocutorRelationship} ${sess.interlocutorName}`
                                                  )
                                                }
                                                className="px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 text-red-800 font-medium flex items-center gap-1 cursor-pointer"
                                                title="Eliminar esta sesión conversacional"
                                              >
                                                <Trash2 className="w-3.5 h-3.5" />
                                                <span>Eliminar Conversación</span>
                                              </button>
                                            </div>
                                          </div>
                                          {sess.lastFallbackNotice && (
                                            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-950 text-[11px]">
                                              <strong>Aviso de Conmutación Automática:</strong>{' '}
                                              {sess.lastFallbackNotice}
                                            </div>
                                          )}
                                          {sess.sessionContextSummary && (
                                            <details className="text-[11px] bg-stone-100/80 border border-stone-200 rounded-lg px-3 py-2">
                                              <summary className="font-semibold text-stone-700 cursor-pointer">
                                                Ver Resumen Persistente de Continuidad Multi-Día
                                              </summary>
                                              <pre className="mt-1.5 whitespace-pre-wrap font-mono text-[10px] text-stone-600">
                                                {sess.sessionContextSummary}
                                              </pre>
                                            </details>
                                          )}
                                          <div className="space-y-1.5 max-h-60 overflow-y-auto bg-white border border-stone-200 p-3 rounded-lg">
                                            {sess.messages.map((m) => (
                                              <p key={m.messageId} className="text-stone-700">
                                                <strong>
                                                  {m.sender === 'interlocutor'
                                                    ? fam.interlocutorName
                                                    : sessionPerson?.preferredName || 'Avatar'}
                                                  :
                                                </strong>{' '}
                                                {m.privacyLevelApplied === 'privado_interlocutor'
                                                  ? '[Contenido privado de Nivel C protegido por código criptográfico del familiar]'
                                                  : m.content}
                                              </p>
                                            ))}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </div>
      )}

      {/* 7. PESTAÑA: MEMORIA Y PRIVACIDAD */}
      {activeSubTab === 'memoria' && overview && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
            <h3 className="font-serif text-lg text-stone-900">
              Capas de Memoria Biográfica (Nivel A Inmutable, Nivel B Familiar, Nivel C Privado)
            </h3>

            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-800">
                Memorias Conversacionales Registradas (Nivel B y Nivel C)
              </h4>
              {overview.memories.length === 0 ? (
                <p className="text-xs text-stone-500">
                  No hay memorias conversacionales adicionales registradas aún.
                </p>
              ) : (
                overview.memories.map((mem) => (
                  <div
                    key={mem.memoryId}
                    className="p-3.5 rounded-xl border border-stone-200 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-full font-semibold ${
                            mem.privacyLevel === 'privado_interlocutor'
                              ? 'bg-sky-100 text-sky-900'
                              : 'bg-emerald-100 text-emerald-900'
                          }`}
                        >
                          {mem.privacyLevel === 'privado_interlocutor'
                            ? 'Nivel C • Privada por Código Único'
                            : 'Nivel B • Familiar Compartida'}
                        </span>
                        <span className="text-stone-500">{mem.attributionText}</span>
                        <span className="font-semibold text-stone-700">
                          [{mem.verificationState}]
                        </span>
                      </div>
                      <p className="text-stone-800">
                        {mem.privacyLevel === 'privado_interlocutor'
                          ? `Confidencia privada vinculada exclusivamente a ${mem.ownerInterlocutorName} (${mem.ownerInterlocutorId})`
                          : mem.content}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 8. PESTAÑA: CONTRADICCIONES */}
      {activeSubTab === 'contradicciones' && overview && (
        <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
          <h3 className="font-serif text-lg text-stone-900">
            Resolución de Contradicciones entre Familiares o frente al Testimonio Base
          </h3>
          {overview.contradictions.length === 0 ? (
            <p className="text-xs text-stone-500">
              No se han reportado contradicciones en los recuerdos familiares.
            </p>
          ) : (
            <div className="space-y-3">
              {overview.contradictions.map((c) => (
                <div
                  key={c.contradictionId}
                  className="p-4 rounded-xl border border-stone-200 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-stone-900">Tema: {c.topic}</span>
                    <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 font-semibold">
                      {c.status}
                    </span>
                  </div>
                  <p>
                    <strong>{c.versionALabel}:</strong> «{c.versionAContent}»
                  </p>
                  <p>
                    <strong>{c.versionBLabel}:</strong> «{c.versionBContent}»
                  </p>
                  {c.officialResolutionNotes && (
                    <p className="text-emerald-800 font-medium">
                      Resolución: {c.officialResolutionNotes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 9. PESTAÑA: INSTANTÁNEAS Y RESTAURACIÓN */}
      {activeSubTab === 'instantaneas' && overview && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-serif text-lg text-stone-900">
                  Instantáneas (Snapshots) y Restauración Parcial o Total
                </h3>
                <p className="text-xs text-stone-500">
                  Restaura cualquier avatar a una versión previa o aplica Restauración Total para
                  volver exclusivamente al Compilado Testimonial Fidedigno (Nivel A).
                </p>
              </div>
              <div className="flex items-center gap-2">
                {selectedAvatarId && (
                  <>
                    <button
                      onClick={() => handleCreateSnapshot(selectedAvatarId)}
                      className="px-3.5 py-2 rounded-xl bg-stone-900 text-amber-300 text-xs font-semibold cursor-pointer"
                    >
                      + Crear Instantánea Manual
                    </button>
                    <button
                      onClick={() =>
                        handleRestoreSnapshot(selectedAvatarId, 'total_to_original_pdf')
                      }
                      className="px-3.5 py-2 rounded-xl bg-red-50 border border-red-200 text-red-900 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Restauración Total al PDF Original (Nivel A)</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-2.5">
              {overview.snapshots.map((snap) => (
                <div
                  key={snap.snapshotId}
                  className="p-3.5 rounded-xl border border-stone-200 flex items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <p className="font-bold text-stone-900">{snap.label}</p>
                    <p className="text-stone-500">
                      {new Date(snap.createdAt).toLocaleString('es-MX')} • Tipo: {snap.triggerType}{' '}
                      • {snap.memoriesSnapshot.length} memorias respaldadas
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      handleRestoreSnapshot(snap.avatarId, 'from_snapshot', snap.snapshotId)
                    }
                    className="px-3 py-1.5 rounded-lg bg-amber-100 text-amber-900 font-semibold cursor-pointer"
                  >
                    Restaurar a este punto
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 10. PESTAÑA: PAGOS Y PROMOCIONES */}
      {activeSubTab === 'pagos' && overview && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
            <div>
              <h3 className="font-serif text-lg text-stone-900">
                Crear Cupón de Descuento o Días de Regalo
              </h3>
              <p className="text-xs text-stone-500 mt-0.5">
                Configura códigos promocionales indicando el porcentaje de descuento sobre el plan y/o los días adicionales sin costo que se sumarán a la suscripción familiar.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
              <div>
                <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                  Código del Cupón
                </label>
                <input
                  type="text"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  placeholder="Ej. FAMILIA2026"
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 text-xs font-mono"
                />
                <span className="block text-[10px] text-stone-500 mt-0.5">
                  Clave que ingresa la familia
                </span>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                  Descripción de la Promoción
                </label>
                <input
                  type="text"
                  value={couponDesc}
                  onChange={(e) => setCouponDesc(e.target.value)}
                  placeholder="Ej. Promoción familiar"
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 text-xs"
                />
                <span className="block text-[10px] text-stone-500 mt-0.5">
                  Motivo o campaña del cupón
                </span>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                  Porcentaje de Descuento (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={couponDiscount}
                  onChange={(e) => setCouponDiscount(Number(e.target.value))}
                  placeholder="Ej. 20"
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 text-xs"
                />
                <span className="block text-[10px] text-stone-500 mt-0.5">
                  % de rebaja sobre el precio (0 a 100%)
                </span>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                  Días de Regalo Adicionales
                </label>
                <input
                  type="number"
                  min={0}
                  value={couponBonusDays}
                  onChange={(e) => setCouponBonusDays(Number(e.target.value))}
                  placeholder="Ej. 15"
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 text-xs"
                />
                <span className="block text-[10px] text-stone-500 mt-0.5">
                  Días extra gratis sumados a la vigencia
                </span>
              </div>
              <div className="pb-4">
                <button
                  onClick={handleCreateCoupon}
                  className="w-full px-4 py-2 rounded-xl bg-stone-900 text-amber-300 text-xs font-semibold cursor-pointer"
                >
                  Crear Cupón
                </button>
              </div>
            </div>

            {overview.coupons.length > 0 && (
              <div className="pt-3 border-t border-stone-200 space-y-2">
                <h4 className="text-xs font-semibold text-stone-700">
                  Cupones Promocionales Activos ({overview.coupons.length})
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
                  {overview.coupons.map((c) => (
                    <div
                      key={c.couponId}
                      className="p-3 rounded-xl bg-stone-50 border border-stone-200 flex items-center justify-between gap-2"
                    >
                      <div>
                        <span className="font-mono font-bold text-stone-900">{c.code}</span>
                        <p className="text-[11px] text-stone-600">
                          {c.description || 'Promoción YouForever'} •{' '}
                          <strong>{c.discountPercent}% desc.</strong> •{' '}
                          <strong>+{c.bonusDays} días</strong>
                        </p>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 text-[10px] font-semibold">
                        {c.isActive ? 'Activo' : 'Inactivo'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-3">
            <h4 className="font-serif text-base text-stone-900">
              Historial de Pagos y Renovaciones Registradas
            </h4>
            {overview.payments.length === 0 ? (
              <p className="text-xs text-stone-500">
                No se han registrado movimientos de pago aún.
              </p>
            ) : (
              overview.payments.map((pay) => (
                <div
                  key={pay.paymentId}
                  className="p-3.5 rounded-xl border border-stone-200 flex items-center justify-between text-xs"
                >
                  <div>
                    <p className="font-bold text-stone-900">
                      ${pay.amountMxn} {pay.currency} • {pay.paymentType}
                    </p>
                    <p className="text-stone-500">
                      Nuevo vencimiento: {new Date(pay.newExpiresAt).toLocaleDateString('es-MX')} •
                      Registrado por {pay.registeredBy}
                    </p>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 font-semibold">
                    {pay.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 11. PESTAÑA: NOTIFICACIONES */}
      {activeSubTab === 'notificaciones' && overview && (
        <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
          <h3 className="font-serif text-lg text-stone-900">
            Centro de Avisos Internos y Estado de Recordatorios Externos
          </h3>
          {overview.notifications.length === 0 ? (
            <p className="text-xs text-stone-500">No hay notificaciones emitidas aún.</p>
          ) : (
            <div className="space-y-2.5">
              {overview.notifications.map((n) => (
                <div
                  key={n.notificationId}
                  className="p-3.5 rounded-xl border border-stone-200 flex items-center justify-between text-xs"
                >
                  <div>
                    <p className="font-bold text-stone-900">{n.subject}</p>
                    <p className="text-stone-600">{n.message}</p>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full bg-stone-100 text-stone-700 font-medium">
                    {n.deliveryStatus}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 12. PESTAÑA: ESTADÍSTICAS Y COSTOS */}
      {activeSubTab === 'estadisticas' && overview && (
        <SystemStatisticsPanel adminEmail={adminEmail} defaultScope="all" />
      )}

      {/* 13. PESTAÑA: CONFIGURACIÓN */}
      {activeSubTab === 'configuracion' && overview && (
        <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-stone-200 pb-4">
            <div>
              <h3 className="font-serif text-lg text-stone-900">
                Interruptor Maestro (`MiEsenciaEnabled`) y Conectores Externos
              </h3>
              <p className="text-xs text-stone-500">
                Puedes activar o desactivar Mi Esencia en cualquier momento sin afectar las
                entrevistas ni los libros PDF de YouForever.
              </p>
            </div>
            <button
              onClick={() => handleToggleGlobalFlag(!overview.config.miEsenciaEnabled)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer ${
                overview.config.miEsenciaEnabled
                  ? 'bg-red-100 text-red-900 hover:bg-red-200'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500'
              }`}
            >
              {overview.config.miEsenciaEnabled
                ? 'Desactivar Temporalmente Mi Esencia'
                : 'Activar Mi Esencia'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-1">
              <p className="font-bold text-stone-900">Pasarela de Cobro Automático</p>
              <p className="text-amber-800 font-medium">
                Estado: {overview.config.externalPaymentGatewayStatus}
              </p>
              <p className="text-stone-500">
                Los pagos manuales, cortesías y cupones operan al 100 %. El cobro automático con
                tarjeta queda listo para conectar credenciales reales.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-1">
              <p className="font-bold text-stone-900">Conector de Correo Electrónico</p>
              <p className="text-amber-800 font-medium">
                Estado: {overview.config.externalEmailConnectorStatus}
              </p>
              <p className="text-stone-500">
                Avisos internos activos en el portal familiar. Envío SMTP/API pendiente de
                credenciales externas.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-1">
              <p className="font-bold text-stone-900">Conector de WhatsApp</p>
              <p className="text-amber-800 font-medium">
                Estado: {overview.config.externalWhatsappConnectorStatus}
              </p>
              <p className="text-stone-500">
                Los enlaces privados directos se copian en 1 clic para enviar por WhatsApp.
              </p>
            </div>
          </div>

          {/* Configuración Global de Modelos por Defecto y Estado de Proveedores IA (Gemini y OpenAI GPT) */}
          <div className="pt-4 border-t border-stone-200 space-y-4 text-xs">
            <div>
              <h4 className="font-serif font-bold text-base text-stone-900">
                Configuración Global de Motores de IA (Gemini y OpenAI GPT)
              </h4>
              <p className="text-stone-500">
                Define los modelos por defecto para nuevos avatares y consulta el estado de los
                conectores seguros en el servidor (`GEMINI_API_KEY` y `OPENAI_API_KEY`).
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-stone-900">Proveedor Google Gemini</span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                      overview.providersStatus?.geminiConfiguredOnServer
                        ? 'bg-emerald-100 text-emerald-900'
                        : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    {overview.providersStatus?.geminiStatusLabel || 'Verificando...'}
                  </span>
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Modelo Gemini por Defecto Global
                  </label>
                  <select
                    value={overview.config.defaultGeminiModel || 'gemini-3.8-flash'}
                    onChange={async (e) => {
                      const nextModel = e.target.value;
                      await fetch('/api/mi-esencia/admin/config', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'x-admin-email': adminEmail,
                        },
                        body: JSON.stringify({ defaultGeminiModel: nextModel }),
                      });
                      showNotice('ok', `Modelo Gemini por defecto actualizado a ${nextModel}.`);
                      fetchOverview();
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
                  >
                    {AVAILABLE_GEMINI_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} — {m.description}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      handleTestGlobalApiConnection(
                        'gemini',
                        overview.config.defaultGeminiModel || 'gemini-3.8-flash'
                      )
                    }
                    disabled={testingGlobalProvider === 'gemini'}
                    className="px-3 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-amber-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${
                        testingGlobalProvider === 'gemini' ? 'animate-spin' : ''
                      }`}
                    />
                    <span>
                      {testingGlobalProvider === 'gemini'
                        ? 'Verificando Gemini...'
                        : 'Probar Conexión Real a Gemini API'}
                    </span>
                  </button>
                  {globalConnectionResults.gemini && (
                    <span
                      className={`text-[11px] font-bold ${
                        globalConnectionResults.gemini.connected
                          ? 'text-emerald-700'
                          : 'text-red-700'
                      }`}
                    >
                      {globalConnectionResults.gemini.connected
                        ? `✓ OK (${globalConnectionResults.gemini.respondedModel} • ${globalConnectionResults.gemini.latencyMs}ms)`
                        : '✕ Error'}
                    </span>
                  )}
                </div>
                {globalConnectionResults.gemini && (
                  <div className="p-2.5 rounded-lg bg-white border border-stone-200 text-[11px] space-y-1">
                    {globalConnectionResults.gemini.sampleResponse && (
                      <p className="font-mono text-emerald-900">
                        Respuesta: {globalConnectionResults.gemini.sampleResponse}
                      </p>
                    )}
                    {globalConnectionResults.gemini.diagnosticAdvice && (
                      <p className="text-stone-600">
                        {globalConnectionResults.gemini.diagnosticAdvice}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-stone-900">Proveedor OpenAI GPT</span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                      overview.providersStatus?.openaiConfiguredOnServer
                        ? 'bg-emerald-100 text-emerald-900'
                        : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    {overview.providersStatus?.openaiStatusLabel || 'Verificando...'}
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="block font-semibold text-stone-700">
                      Modelo OpenAI por Defecto Global (GPT-6 / GPT-5 / Manual)
                    </label>
                    <button
                      type="button"
                      onClick={() => setCustomGlobalOpenAiModel(!customGlobalOpenAiModel)}
                      className="text-[10px] text-amber-800 hover:underline font-semibold cursor-pointer"
                    >
                      {customGlobalOpenAiModel ? 'Elegir de lista' : 'Escribir modelo manual'}
                    </button>
                  </div>
                  {customGlobalOpenAiModel ? (
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        defaultValue={overview.config.defaultOpenAiModel || 'gpt-6'}
                        placeholder="Ej. gpt-6, gpt-6-astra, gpt-5..."
                        onBlur={async (e) => {
                          const nextModel = e.target.value.trim() || 'gpt-6';
                          await fetch('/api/mi-esencia/admin/config', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              'x-admin-email': adminEmail,
                            },
                            body: JSON.stringify({ defaultOpenAiModel: nextModel }),
                          });
                          showNotice(
                            'ok',
                            `Modelo OpenAI personalizado actualizado a ${nextModel}.`
                          );
                          fetchOverview();
                        }}
                        className="w-full px-3 py-2 rounded-xl border border-amber-400 bg-white font-mono text-xs"
                      />
                    </div>
                  ) : (
                    <select
                      value={overview.config.defaultOpenAiModel || 'gpt-6'}
                      onChange={async (e) => {
                        if (e.target.value === '__custom__') {
                          setCustomGlobalOpenAiModel(true);
                          return;
                        }
                        const nextModel = e.target.value;
                        await fetch('/api/mi-esencia/admin/config', {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'x-admin-email': adminEmail,
                          },
                          body: JSON.stringify({ defaultOpenAiModel: nextModel }),
                        });
                        showNotice('ok', `Modelo OpenAI por defecto actualizado a ${nextModel}.`);
                        fetchOverview();
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
                    >
                      {AVAILABLE_OPENAI_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label} — {m.description}
                        </option>
                      ))}
                      <option value="__custom__">✍️ Escribir ID de modelo manualmente...</option>
                    </select>
                  )}
                </div>

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      handleTestGlobalApiConnection(
                        'openai',
                        overview.config.defaultOpenAiModel || 'gpt-6'
                      )
                    }
                    disabled={testingGlobalProvider === 'openai'}
                    className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-stone-950 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${
                        testingGlobalProvider === 'openai' ? 'animate-spin' : ''
                      }`}
                    />
                    <span>
                      {testingGlobalProvider === 'openai'
                        ? 'Verificando OpenAI...'
                        : 'Probar Conexión Real a OpenAI API'}
                    </span>
                  </button>
                  {globalConnectionResults.openai && (
                    <span
                      className={`text-[11px] font-bold ${
                        globalConnectionResults.openai.connected
                          ? 'text-emerald-700'
                          : 'text-amber-800'
                      }`}
                    >
                      {globalConnectionResults.openai.connected
                        ? `✓ OK (${globalConnectionResults.openai.respondedModel} • ${globalConnectionResults.openai.latencyMs}ms)`
                        : '⚠ Sin OPENAI_API_KEY (Respaldo Gemini activo)'}
                    </span>
                  )}
                </div>
                {globalConnectionResults.openai && (
                  <div className="p-2.5 rounded-lg bg-white border border-stone-200 text-[11px] space-y-1">
                    {globalConnectionResults.openai.sampleResponse && (
                      <p className="font-mono text-emerald-900">
                        Respuesta: {globalConnectionResults.openai.sampleResponse}
                      </p>
                    )}
                    {globalConnectionResults.openai.errorDetail && (
                      <p className="text-red-800 font-medium">
                        Detalle: {globalConnectionResults.openai.errorDetail}
                      </p>
                    )}
                    {globalConnectionResults.openai.diagnosticAdvice && (
                      <p className="text-stone-700">
                        {globalConnectionResults.openai.diagnosticAdvice}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-stone-900 block">
                  Registro Administrativo de Conmutaciones de Respaldo Automático (
                  {overview.fallbackLogs?.length || 0})
                </span>
                {overview.fallbackLogs && overview.fallbackLogs.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearFallbackLogs}
                    className="px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 text-red-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Limpiar y Borrar Registro</span>
                  </button>
                )}
              </div>
              {!overview.fallbackLogs || overview.fallbackLogs.length === 0 ? (
                <p className="text-[11px] text-stone-500">
                  El registro de conmutaciones de respaldo automático está limpio (0 eventos).
                </p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {overview.fallbackLogs.slice(0, 20).map((log) => (
                    <div
                      key={log.logId}
                      className="p-2 rounded bg-white border border-stone-200 flex items-center justify-between text-[11px]"
                    >
                      <span>
                        <strong>{new Date(log.timestamp).toLocaleString('es-MX')}</strong> •
                        Primario: {log.primaryProvider} ({log.primaryModel}) → Respaldo:{' '}
                        <strong>
                          {log.fallbackProvider} ({log.fallbackModel})
                        </strong>
                      </span>
                      <span className="text-amber-900 font-medium">{log.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
