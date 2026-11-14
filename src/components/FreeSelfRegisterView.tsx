import React, { useState } from 'react';
import {
  User,
  Users,
  Mail,
  MapPin,
  Calendar,
  BookOpen,
  ShieldCheck,
  CheckCircle2,
  Copy,
  Check,
  Download,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Plus,
  Trash2,
  ArrowRight,
  Key,
  FileText,
  Sparkles,
} from 'lucide-react';
import { ForeverYouLogo } from './ForeverYouLogo';
import { IntegralPrivacyNoticeModal } from './IntegralPrivacyNoticeModal.tsx';
import {
  CANONICAL_MANUAL_PDF_URL,
  FREE_SELF_REGISTER_EXPLANATION,
  validateFreeRegistrationPayload,
  type FreeRegistrationParticipantInput,
} from '../logic/freeRegistration.ts';
import { StoryMode } from '../logic/interviewRules.ts';

interface FreeSelfRegisterViewProps {
  onEnterParticipantWithToken: (token: string) => void;
  onNavigateToPortal: () => void;
}

interface RegisteredParticipantResult {
  participantId: string;
  name: string;
  email: string;
  age: number | null;
  city: string;
  relationship: string;
  role: 'primary' | 'contributor';
  accessCode: string;
  plainToken: string;
  inviteUrl: string;
  directUrl: string;
  emailStatus: {
    sent: boolean;
    recipientEmail: string;
    participantId: string;
    participantName: string;
    messageId?: string;
    error?: string;
    attemptedAt: string;
  };
}

interface RegistrationSuccessData {
  interview: {
    id: string;
    title: string;
    storyMode: StoryMode;
    openedAt: string;
    expiresAt: string;
    openDaysAtCreation: number;
    sufficiencyThreshold: number;
    layoutEditsAllowed: number;
  };
  manualPdfUrl: string;
  participants: RegisteredParticipantResult[];
}

function createEmptyParticipant(role: 'primary' | 'contributor'): FreeRegistrationParticipantInput {
  return {
    name: '',
    email: '',
    age: '',
    city: '',
    relationship: role === 'primary' ? 'Titular' : 'Familiar / Coautor',
    role,
  };
}

export const FreeSelfRegisterView: React.FC<FreeSelfRegisterViewProps> = ({
  onEnterParticipantWithToken,
  onNavigateToPortal,
}) => {
  const [storyMode, setStoryMode] = useState<StoryMode>('individual');
  const [storyTitle, setStoryTitle] = useState('');
  const [participants, setParticipants] = useState<FreeRegistrationParticipantInput[]>([
    createEmptyParticipant('primary'),
  ]);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<RegistrationSuccessData | null>(null);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [retryingParticipantId, setRetryingParticipantId] = useState<string | null>(null);
  const [retryFeedback, setRetryFeedback] = useState<string | null>(null);
  const confirmationSectionRef = React.useRef<HTMLElement | null>(null);

  const handleModeChange = (nextMode: StoryMode) => {
    setStoryMode(nextMode);
    setFormError(null);
    if (nextMode === 'compartida' && participants.length < 2) {
      setParticipants((prev) => [...prev, createEmptyParticipant('contributor')]);
    } else if (nextMode === 'individual' && participants.length > 1) {
      setParticipants((prev) => [prev[0]]);
    }
  };

  const handleParticipantChange = (
    idx: number,
    field: keyof FreeRegistrationParticipantInput,
    value: string
  ) => {
    setParticipants((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item))
    );
    if (formError) setFormError(null);
  };

  const handleAddSharedParticipant = () => {
    setParticipants((prev) => [...prev, createEmptyParticipant('contributor')]);
  };

  const handleRemoveSharedParticipant = (idx: number) => {
    if (idx === 0 || participants.length <= 2) return;
    setParticipants((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleCopy = (key: string, value: string) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).catch(() => {});
    } else {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {}
      document.body.removeChild(ta);
    }
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((curr) => (curr === key ? null : curr));
    }, 2500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const payload = {
      storyMode,
      storyTitle: storyTitle.trim() || undefined,
      privacyAccepted,
      participants: storyMode === 'individual' ? [participants[0]] : participants,
    };

    const clientCheck = validateFreeRegistrationPayload(payload);
    if (!clientCheck.valid) {
      setFormError(clientCheck.error || 'Revisa los datos ingresados antes de continuar.');
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch('/api/public/free-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.success || !json.data) {
        setFormError(json.error || 'No se pudo completar el registro. Inténtalo de nuevo.');
        return;
      }
      setResult(json.data as RegistrationSuccessData);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      requestAnimationFrame(() => {
        confirmationSectionRef.current?.focus({ preventScroll: true });
      });
    } catch {
      setFormError(
        'No pudimos conectar en este momento para crear tu entrevista. Inténtalo nuevamente.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetryEmail = async (participantIds?: string[]) => {
    if (!result) return;
    const retryKey = participantIds && participantIds.length === 1 ? participantIds[0] : 'ALL';
    try {
      setRetryingParticipantId(retryKey);
      setRetryFeedback(null);
      const res = await fetch(
        `/api/public/free-register/${encodeURIComponent(result.interview.id)}/retry-email`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            participantIds && participantIds.length > 0 ? { participantIds } : {}
          ),
        }
      );
      const json = await res.json();
      if (json.success && Array.isArray(json.data?.emailResults)) {
        const resultMap = new Map<string, RegisteredParticipantResult['emailStatus']>(
          (json.data.emailResults as RegisteredParticipantResult['emailStatus'][]).map((er) => [
            er.participantId,
            er,
          ])
        );
        setResult((prev) =>
          prev
            ? {
                ...prev,
                participants: prev.participants.map((p) => {
                  const updatedStatus = resultMap.get(p.participantId);
                  return updatedStatus ? { ...p, emailStatus: updatedStatus } : p;
                }),
              }
            : prev
        );
        const allOk = json.data.emailResults.every(
          (er: RegisteredParticipantResult['emailStatus']) => er.sent
        );
        if (allOk) {
          setRetryFeedback(
            'Correo enviado correctamente sin duplicar tu registro. Ten en cuenta que puede llegar a Correo no deseado / Spam.'
          );
        } else {
          setRetryFeedback(
            'El reintento concluyó con errores de envío. Tus códigos y enlaces siguen activos en pantalla.'
          );
        }
      } else {
        setRetryFeedback(json.error || 'No se pudo reintentar el envío del correo.');
      }
    } catch {
      setRetryFeedback(
        'No pudimos enviar el correo en este momento. Revisa tu conexión e inténtalo nuevamente.'
      );
    } finally {
      setRetryingParticipantId(null);
    }
  };

  const activeParticipants = storyMode === 'individual' ? [participants[0]] : participants;

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 flex flex-col">
      {/* Clean Top Bar */}
      <header className="bg-stone-900 text-stone-100 border-b border-stone-800 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <ForeverYouLogo
              variant="horizontal"
              theme="light"
              size="sm"
              subtitle="Registro Gratuito de Entrevista"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={CANONICAL_MANUAL_PDF_URL}
              target="_blank"
              rel="noopener noreferrer"
              download="Manual_Usuario_YouForever.pdf"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-700 text-stone-200 hover:bg-stone-800 text-xs font-medium transition"
            >
              <FileText className="w-3.5 h-3.5 text-amber-400" />
              <span>Manual en PDF</span>
            </a>
            <button
              type="button"
              onClick={onNavigateToPortal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold transition cursor-pointer"
            >
              <span>Ya tengo mi código</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8">
        {/* Hero / Explanation Card (only visible prior to completing registration) */}
        {!result && (
          <section className="space-y-4 text-center max-w-2xl mx-auto">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-700/50 text-xs font-semibold tracking-wide">
              <Sparkles className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
              Acceso Directo YouForever
            </span>
            <h1 className="font-serif text-3xl sm:text-4xl font-bold text-stone-900 dark:text-stone-100 tracking-tight leading-tight">
              Comienza hoy tu libro autobiográfico
            </h1>
            <p
              data-testid="free-register-explanation"
              className="text-sm sm:text-base text-stone-600 dark:text-stone-300 leading-relaxed"
            >
              {FREE_SELF_REGISTER_EXPLANATION}
            </p>
          </section>
        )}

        {/* Confirmation Screen if registration already succeeded */}
        {result ? (
          <section
            ref={confirmationSectionRef}
            tabIndex={-1}
            data-testid="free-register-confirmation"
            className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 shadow-sm p-6 sm:p-8 space-y-6 outline-none"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-stone-200 dark:border-stone-800">
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 shrink-0">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="font-serif text-xl sm:text-2xl font-bold text-stone-900 dark:text-stone-100">
                    ¡Tu entrevista ha sido creada!
                  </h2>
                  <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-400 mt-0.5">
                    Historia: <strong>{result.interview.title}</strong> • Modalidad:{' '}
                    <strong>
                      {result.interview.storyMode === 'compartida'
                        ? 'Entrevista Compartida'
                        : 'Entrevista Individual'}
                    </strong>
                  </p>
                </div>
              </div>

              <a
                href={result.manualPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                download="Manual_Usuario_YouForever.pdf"
                data-testid="free-download-manual-btn"
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-stone-900 hover:bg-stone-800 dark:bg-amber-700 dark:hover:bg-amber-800 text-white text-xs font-semibold shadow-xs transition shrink-0"
              >
                <Download className="w-4 h-4 text-amber-400 dark:text-white" />
                <span>Descargar Manual en PDF</span>
              </a>
            </div>

            {/* Email Status Summary + Non-duplicating Retry */}
            {(() => {
              const failedList = result.participants.filter((p) => !p.emailStatus.sent);
              const allSent = failedList.length === 0;
              return (
                <div
                  data-testid="free-email-status-banner"
                  className={`p-4 rounded-xl border text-xs space-y-2.5 ${
                    allSent
                      ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                      : 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800 text-amber-950 dark:text-amber-100'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      {allSent ? (
                        <Mail className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                      )}
                      <div className="space-y-1">
                        <p className="font-bold">
                          {allSent
                            ? 'Enviamos tus credenciales e instrucciones por correo electrónico. Ten en cuenta que el mensaje puede llegar a Correo no deseado / Spam.'
                            : 'Tu registro y acceso ya están activos aquí abajo, pero hubo un problema al enviar el correo.'}
                        </p>
                        {!allSent && (
                          <p className="opacity-90 leading-relaxed">
                            {failedList[0]?.emailStatus.error ||
                              'No se pudo entregar el correo electrónico.'}{' '}
                            Puedes copiar tus accesos directamente desde esta pantalla o reintentar el envío sin duplicar tu registro. Una vez enviado, el correo puede llegar a Correo no deseado / Spam.
                          </p>
                        )}
                      </div>
                    </div>

                    {!allSent && (
                      <button
                        type="button"
                        data-testid="free-retry-all-emails-btn"
                        onClick={() => handleRetryEmail(failedList.map((f) => f.participantId))}
                        disabled={retryingParticipantId !== null}
                        className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-semibold shrink-0 transition cursor-pointer disabled:opacity-60"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${
                            retryingParticipantId === 'ALL' ||
                            failedList.some((f) => f.participantId === retryingParticipantId)
                              ? 'animate-spin'
                              : ''
                          }`}
                        />
                        <span>
                          {retryingParticipantId !== null
                            ? 'Reintentando...'
                            : 'Reintentar envío de correo'}
                        </span>
                      </button>
                    )}
                  </div>

                  {retryFeedback && (
                    <p className="text-[11px] font-semibold pt-1 border-t border-black/10">
                      {retryFeedback}
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Participant Credentials Cards */}
            <div className="space-y-4">
              <h3 className="font-serif text-base font-bold text-stone-900 dark:text-stone-100">
                {result.participants.length > 1
                  ? `Accesos individuales por participante (${result.participants.length})`
                  : 'Tus credenciales de acceso directo'}
              </h3>

              <div className="space-y-4">
                {result.participants.map((p, idx) => (
                  <div
                    key={p.participantId}
                    data-testid={`registered-participant-card-${idx}`}
                    className="p-4 sm:p-5 rounded-xl bg-stone-50 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700 space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-serif text-base font-bold text-stone-900 dark:text-stone-100">
                            {p.name}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200 text-[11px] font-semibold">
                            {p.role === 'primary' ? 'Titular' : p.relationship || 'Colaborador'}
                          </span>
                        </div>
                        <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                          {p.email} • {p.age ? `${p.age} años` : ''} • {p.city}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 text-[11px]">
                        {p.emailStatus.sent ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300 font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Correo enviado
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleRetryEmail([p.participantId])}
                            disabled={retryingParticipantId !== null}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-amber-300 bg-white hover:bg-amber-50 text-amber-900 font-semibold cursor-pointer disabled:opacity-50"
                          >
                            <RefreshCw
                              className={`w-3 h-3 ${
                                retryingParticipantId === p.participantId ? 'animate-spin' : ''
                              }`}
                            />
                            <span>Reintentar correo</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Access Code */}
                      <div className="p-3 bg-white dark:bg-stone-900 rounded-lg border border-stone-200 dark:border-stone-700 space-y-1.5">
                        <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide flex items-center gap-1">
                          <Key className="w-3 h-3 text-amber-700" />
                          Código de acceso
                        </span>
                        <div className="flex items-center justify-between gap-2">
                          <code
                            data-testid={`participant-access-code-${idx}`}
                            className="font-mono text-lg font-bold tracking-wider text-stone-900 dark:text-stone-100"
                          >
                            {p.accessCode}
                          </code>
                          <button
                            type="button"
                            data-testid={`copy-access-code-${idx}`}
                            onClick={() => handleCopy(`code_${p.participantId}`, p.accessCode)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold transition cursor-pointer"
                          >
                            {copiedKey === `code_${p.participantId}` ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Copiado</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copiar</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Direct Link */}
                      <div className="p-3 bg-white dark:bg-stone-900 rounded-lg border border-stone-200 dark:border-stone-700 space-y-1.5">
                        <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide flex items-center gap-1">
                          <ExternalLink className="w-3 h-3 text-amber-700" />
                          Enlace directo
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            readOnly
                            data-testid={`participant-direct-url-${idx}`}
                            value={p.directUrl}
                            className="flex-1 min-w-0 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded px-2 py-1.5 font-mono text-[11px] text-stone-700 dark:text-stone-200"
                          />
                          <button
                            type="button"
                            data-testid={`copy-direct-url-${idx}`}
                            onClick={() => handleCopy(`url_${p.participantId}`, p.directUrl)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 hover:bg-stone-100 text-stone-800 dark:text-stone-100 text-xs font-semibold transition cursor-pointer shrink-0"
                          >
                            {copiedKey === `url_${p.participantId}` ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                <span>Copiado</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copiar</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <span className="text-[11px] text-stone-500 dark:text-stone-400">
                        Vigencia inicial: {result.interview.openDaysAtCreation} días •{' '}
                        {result.interview.layoutEditsAllowed} edición adicional de maquetación incluida
                      </span>
                      <button
                        type="button"
                        data-testid={`enter-interview-btn-${idx}`}
                        onClick={() => onEnterParticipantWithToken(p.plainToken)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold transition cursor-pointer"
                      >
                        <span>Iniciar entrevista de {p.name.split(' ')[0]}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Brief Instructions Recap (without duplicate manual link at bottom) */}
            <div className="p-4 rounded-xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700">
              <div className="space-y-1 text-xs text-stone-700 dark:text-stone-300">
                <p className="font-bold text-stone-900 dark:text-stone-100">
                  Avanza a tu propio ritmo.
                </p>
                <p>
                  Guarda tu código o enlace de acceso para continuar cuando quieras, justo donde te quedaste.
                </p>
              </div>
            </div>
          </section>
        ) : (
          /* Registration Form */
          <form
            onSubmit={handleSubmit}
            noValidate
            className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 shadow-sm p-6 sm:p-8 space-y-6"
          >
            {/* 1. Modality Selector */}
            <div className="space-y-2.5">
              <label className="block text-xs font-bold uppercase tracking-wide text-stone-700 dark:text-stone-300">
                1. Elige la modalidad de tu entrevista
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  data-testid="mode-individual-btn"
                  onClick={() => handleModeChange('individual')}
                  className={`text-left p-4 rounded-xl border-2 transition cursor-pointer flex items-start gap-3 ${
                    storyMode === 'individual'
                      ? 'border-amber-700 bg-amber-50/60 dark:bg-amber-950/30'
                      : 'border-stone-200 dark:border-stone-700 hover:border-stone-300'
                  }`}
                >
                  <div
                    className={`p-2 rounded-lg shrink-0 ${
                      storyMode === 'individual'
                        ? 'bg-amber-700 text-white'
                        : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300'
                    }`}
                  >
                    <User className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-serif font-bold text-sm text-stone-900 dark:text-stone-100">
                      Entrevista Individual
                    </div>
                    <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                      Para contar tu propia historia de vida de principio a fin.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  data-testid="mode-compartida-btn"
                  onClick={() => handleModeChange('compartida')}
                  className={`text-left p-4 rounded-xl border-2 transition cursor-pointer flex items-start gap-3 ${
                    storyMode === 'compartida'
                      ? 'border-amber-700 bg-amber-50/60 dark:bg-amber-950/30'
                      : 'border-stone-200 dark:border-stone-700 hover:border-stone-300'
                  }`}
                >
                  <div
                    className={`p-2 rounded-lg shrink-0 ${
                      storyMode === 'compartida'
                        ? 'bg-amber-700 text-white'
                        : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300'
                    }`}
                  >
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-serif font-bold text-sm text-stone-900 dark:text-stone-100">
                      Entrevista Compartida (2 o más personas)
                    </div>
                    <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                      Cada integrante recibe su propio código y enlace personal para aportar sus recuerdos a una obra común.
                    </p>
                  </div>
                </button>
              </div>
            </div>

            {/* Optional Story Title */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-amber-700" />
                <span>Título de tu historia o libro (Opcional)</span>
              </label>
              <input
                type="text"
                data-testid="free-story-title-input"
                value={storyTitle}
                onChange={(e) => setStoryTitle(e.target.value)}
                placeholder={
                  storyMode === 'compartida'
                    ? 'Ej. Memorias de la Familia Rodríguez'
                    : 'Ej. Memorias de Juan Pérez (si lo dejas vacío lo creamos por ti)'
                }
                className="w-full px-3.5 py-2.5 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 rounded-xl text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-700"
              />
            </div>

            {/* 2. Participant Fields */}
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="block text-xs font-bold uppercase tracking-wide text-stone-700 dark:text-stone-300">
                  {storyMode === 'compartida'
                    ? `2. Datos de los participantes (${activeParticipants.length})`
                    : '2. Tus datos de registro'}
                </label>
                {storyMode === 'compartida' && (
                  <button
                    type="button"
                    data-testid="free-add-participant-btn"
                    onClick={handleAddSharedParticipant}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-semibold transition cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Agregar otro participante</span>
                  </button>
                )}
              </div>

              <div className="space-y-4">
                {activeParticipants.map((p, idx) => (
                  <div
                    key={idx}
                    data-testid={`free-participant-form-${idx}`}
                    className="p-4 sm:p-5 rounded-xl bg-stone-50/90 dark:bg-stone-800/40 border border-stone-200 dark:border-stone-700 space-y-4"
                  >
                    {storyMode === 'compartida' && (
                      <div className="flex items-center justify-between pb-2 border-b border-stone-200 dark:border-stone-700">
                        <span className="text-xs font-bold text-stone-800 dark:text-stone-200">
                          {idx === 0
                            ? 'Participante 1 — Titular principal'
                            : `Participante ${idx + 1} — Coautor / Familiar`}
                        </span>
                        {idx >= 2 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveSharedParticipant(idx)}
                            className="inline-flex items-center gap-1 text-xs text-rose-700 hover:text-rose-800 font-medium cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Quitar</span>
                          </button>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                          Nombre completo *
                        </label>
                        <div className="relative">
                          <User className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-3" />
                          <input
                            type="text"
                            required
                            data-testid={`free-name-${idx}`}
                            value={p.name}
                            onChange={(e) => handleParticipantChange(idx, 'name', e.target.value)}
                            placeholder="Nombre y apellidos"
                            className="w-full pl-9 pr-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 rounded-lg text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-700"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                          Correo electrónico *
                        </label>
                        <div className="relative">
                          <Mail className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-3" />
                          <input
                            type="email"
                            required
                            data-testid={`free-email-${idx}`}
                            value={p.email}
                            onChange={(e) => handleParticipantChange(idx, 'email', e.target.value)}
                            placeholder="nombre@correo.com"
                            className="w-full pl-9 pr-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 rounded-lg text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-700"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                          Edad *
                        </label>
                        <div className="relative">
                          <Calendar className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-3" />
                          <input
                            type="number"
                            min={1}
                            max={125}
                            required
                            data-testid={`free-age-${idx}`}
                            value={p.age}
                            onChange={(e) => handleParticipantChange(idx, 'age', e.target.value)}
                            placeholder="Ej. 64"
                            className="w-full pl-9 pr-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 rounded-lg text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-700 tabular-nums"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                          Ciudad *
                        </label>
                        <div className="relative">
                          <MapPin className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-3" />
                          <input
                            type="text"
                            required
                            data-testid={`free-city-${idx}`}
                            value={p.city}
                            onChange={(e) => handleParticipantChange(idx, 'city', e.target.value)}
                            placeholder="Ej. Ciudad de México"
                            className="w-full pl-9 pr-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 rounded-lg text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-700"
                          />
                        </div>
                      </div>

                      {storyMode === 'compartida' && (
                        <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                          <div>
                            <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                              Parentesco o vínculo en la historia *
                            </label>
                            <input
                              type="text"
                              data-testid={`free-relationship-${idx}`}
                              value={p.relationship || ''}
                              onChange={(e) =>
                                handleParticipantChange(idx, 'relationship', e.target.value)
                              }
                              placeholder={idx === 0 ? 'Ej. Titular, Madre, Padre' : 'Ej. Esposo/a, Hijo/a'}
                              className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 rounded-lg text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-700"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                              Rol dentro de la entrevista
                            </label>
                            <select
                              data-testid={`free-role-${idx}`}
                              value={idx === 0 ? 'primary' : p.role || 'contributor'}
                              disabled={idx === 0}
                              onChange={(e) =>
                                handleParticipantChange(idx, 'role', e.target.value)
                              }
                              className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 rounded-lg text-sm text-stone-900 dark:text-stone-100 disabled:opacity-75"
                            >
                              <option value="primary">Titular</option>
                              <option value="contributor">Colaborador / Coautor</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. Privacy Notice Acceptance */}
            <div className="p-4 rounded-xl bg-stone-50 dark:bg-stone-800/40 border border-stone-200 dark:border-stone-700 space-y-3">
              <div className="flex items-start gap-3">
                <input
                  id="free-privacy-checkbox"
                  type="checkbox"
                  data-testid="free-privacy-checkbox"
                  checked={privacyAccepted}
                  onChange={(e) => {
                    setPrivacyAccepted(e.target.checked);
                    if (formError) setFormError(null);
                  }}
                  className="mt-1 h-4 w-4 rounded border-stone-300 text-amber-700 focus:ring-amber-600 cursor-pointer"
                />
                <label
                  htmlFor="free-privacy-checkbox"
                  className="text-xs sm:text-sm text-stone-700 dark:text-stone-300 leading-relaxed cursor-pointer"
                >
                  He leído y acepto el{' '}
                  <button
                    type="button"
                    onClick={() => setIsPrivacyModalOpen(true)}
                    className="font-semibold text-amber-800 dark:text-amber-400 underline hover:text-amber-900 cursor-pointer"
                  >
                    Aviso de Privacidad de YouForever
                  </button>{' '}
                  para el tratamiento de mis datos personales, grabaciones de voz, transcripciones y fotografías con la finalidad exclusiva de crear mi entrevista y libro autobiográfico.
                </label>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-stone-500 dark:text-stone-400 pl-7">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>
                  Al aceptar aquí, tu consentimiento queda registrado oficialmente para entrar directo a tus preguntas.
                </span>
              </div>
            </div>

            {formError && (
              <div
                data-testid="free-register-error"
                className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs sm:text-sm flex items-start gap-2.5"
              >
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
              <a
                href={CANONICAL_MANUAL_PDF_URL}
                target="_blank"
                rel="noopener noreferrer"
                download="Manual_Usuario_YouForever.pdf"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-600 dark:text-stone-300 hover:text-amber-800 transition"
              >
                <Download className="w-3.5 h-3.5 text-amber-700" />
                <span>Descargar manual breve en PDF</span>
              </a>

              <button
                type="submit"
                data-testid="free-submit-btn"
                disabled={submitting}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-sm font-semibold shadow-sm transition cursor-pointer disabled:opacity-60"
              >
                <span>{submitting ? 'Creando tu entrevista...' : 'Crear mi entrevista gratuita'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>
        )}
      </main>

      <IntegralPrivacyNoticeModal
        isOpen={isPrivacyModalOpen}
        onClose={() => setIsPrivacyModalOpen(false)}
      />
    </div>
  );
};
