import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Lock,
  Users,
  Send,
  ShieldCheck,
  AlertTriangle,
  Undo2,
  CheckCircle2,
  Heart,
  BookOpen,
  KeyRound,
  RefreshCw,
  MessageSquare,
  PlusCircle,
  History,
  HelpCircle,
  X,
} from 'lucide-react';
import { ForeverYouLogo } from '../../components/ForeverYouLogo';
import { MiEsenciaChatPhotos } from './MiEsenciaChatPhotos.tsx';
import { ThemeToggleButton, useTheme } from '../../context/ThemeContext';
import {
  isGenericAdministrativeInterlocutorName,
  buildDynamicAvatarSuggestions,
  type MiEsenciaInterlocutor,
  type MiEsenciaSubscriptionRecord,
  type MiEsenciaPersonProfile,
  type MiEsenciaGlobalConfig,
  type MiEsenciaConversationSession,
  type MiEsenciaContradictionRecord,
} from '../../logic/miEsenciaRules';

interface MiEsenciaFamilyPortalProps {
  initialCode?: string | null;
  isAdminPreview?: boolean;
  onExitAdminPreview?: () => void;
}

export const MiEsenciaFamilyPortal: React.FC<MiEsenciaFamilyPortalProps> = ({
  initialCode,
  isAdminPreview,
  onExitAdminPreview,
}) => {
  const { theme } = useTheme();
  const [personalCode, setPersonalCode] = useState<string>(initialCode || '');
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [interlocutor, setInterlocutor] = useState<MiEsenciaInterlocutor | null>(null);
  const [subscription, setSubscription] = useState<MiEsenciaSubscriptionRecord | null>(null);
  const [persons, setPersons] = useState<MiEsenciaPersonProfile[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<string>('');
  const [config, setConfig] = useState<MiEsenciaGlobalConfig | null>(null);
  const [sessions, setSessions] = useState<MiEsenciaConversationSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [isStartingNewSession, setIsStartingNewSession] = useState<boolean>(false);
  const [openContradictions, setOpenContradictions] = useState<MiEsenciaContradictionRecord[]>([]);

  const [consentChecked, setConsentChecked] = useState<boolean>(false);
  const [consentConfirmed, setConsentConfirmed] = useState<boolean>(false);
  const [isSavingConsent, setIsSavingConsent] = useState<boolean>(false);

  const [messageInput, setMessageInput] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [subscriptionBanner, setSubscriptionBanner] = useState<string | null>(null);
  const [recentMemoryIdToUndo, setRecentMemoryIdToUndo] = useState<string | null>(null);

  const [resolvingContradictionId, setResolvingContradictionId] = useState<string | null>(null);
  const [contradictionNote, setContradictionNote] = useState<string>('');

  const [showFaqModal, setShowFaqModal] = useState<boolean>(false);
  const [suggestionRotationSeed, setSuggestionRotationSeed] = useState<number>(0);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const messageInputRef = useRef<HTMLInputElement | null>(null);

  const getLocalConsentKey = (code: string) =>
    `mi_esencia_consent_accepted_${code.trim().toUpperCase()}`;

  useEffect(() => {
    if (initialCode && initialCode.trim()) {
      setPersonalCode(initialCode.trim());
      handleVerifyCode(initialCode.trim());
    }
  }, [initialCode]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, selectedPersonId, selectedSessionId, isSending]);

  const handleVerifyCode = async (codeToVerify?: string) => {
    const code = (codeToVerify ?? personalCode).trim();
    if (!code) {
      setAuthError('Por favor ingresa tu código personal de acceso.');
      return;
    }

    setIsVerifying(true);
    setAuthError(null);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch('/api/mi-esencia/family/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personalCode: code }),
        signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setAuthError(json.error || 'No se pudo verificar el código personal.');
        setIsAuthenticated(false);
        return;
      }

      const data = json.data;
      setInterlocutor(data.interlocutor);
      setSubscription(data.subscription);
      setPersons(data.persons || []);
      const defaultPersonId =
        data.persons && data.persons.length > 0 ? data.persons[0].personId : '';
      if (defaultPersonId) {
        setSelectedPersonId(defaultPersonId);
      }
      setConfig(data.config || null);
      const loadedSessions: MiEsenciaConversationSession[] = data.sessions || [];
      setSessions(loadedSessions);
      const personSessions = loadedSessions.filter((s) => s.personId === defaultPersonId);
      if (personSessions.length > 0) {
        setSelectedSessionId(personSessions[personSessions.length - 1].sessionId);
      }
      setOpenContradictions(data.openContradictions || []);

      const alreadyAcceptedInStorage = (() => {
        try {
          return localStorage.getItem(getLocalConsentKey(code)) === '1';
        } catch {
          return false;
        }
      })();

      if (data.interlocutor?.consentAcceptedAt || alreadyAcceptedInStorage) {
        setConsentChecked(true);
        setConsentConfirmed(true);
        try {
          localStorage.setItem(getLocalConsentKey(code), '1');
        } catch {
          // ignore
        }
      }
      setIsAuthenticated(true);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setAuthError(
          'La verificación tardó más de lo esperado. Por favor intenta ingresar nuevamente.'
        );
      } else {
        setAuthError(
          err?.message || 'No pudimos verificar tu código en este momento. Inténtalo nuevamente.'
        );
      }
    } finally {
      window.clearTimeout(timeoutId);
      setIsVerifying(false);
    }
  };

  const handleConfirmOneTimeConsent = async () => {
    if (!consentChecked || isSavingConsent) return;
    setIsSavingConsent(true);
    try {
      const code = personalCode.trim();
      try {
        localStorage.setItem(getLocalConsentKey(code), '1');
      } catch {
        // ignore
      }
      const res = await fetch('/api/mi-esencia/family/accept-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personalCode: code }),
      });
      const json = await res.json();
      if (res.ok && json.success && json.data?.interlocutor) {
        setInterlocutor(json.data.interlocutor);
      }
    } catch {
      // Continuar incluso si hubo latencia de red; localStorage y el primer mensaje lo persisten
    } finally {
      setIsSavingConsent(false);
      setConsentConfirmed(true);
    }
  };

  const activePerson =
    persons.find((p) => p.personId === selectedPersonId) || persons[0] || null;

  const personSessions = sessions
    .filter((s) => s.personId === activePerson?.personId)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  const activeSession =
    personSessions.find((s) => s.sessionId === selectedSessionId) ||
    personSessions[personSessions.length - 1] ||
    null;

  const isCustomModeActive =
    activePerson?.aiConfig?.conversationConfigMode === 'modo_personalizado';

  // Determinar si la sesión actual todavía no cuenta con ninguna identificación declarada ni vinculada
  const isAwaitingIdentification =
    !isCustomModeActive &&
    (!activeSession ||
      !activeSession.identityState ||
      (activeSession.identityState === 'awaiting_identification' &&
        !activeSession.confirmedIdentity) ||
      activeSession.identityState === 'awaiting_homonym_clarification');

  // Nombre visible del interlocutor: nunca mostrar etiquetas administrativas genéricas ni "undefined"
  const confirmedIdentity = activeSession?.confirmedIdentity;
  const hasRealInterlocutorName =
    interlocutor && !isGenericAdministrativeInterlocutorName(interlocutor.fullName);
  const confirmedDisplayName =
    confirmedIdentity?.affectionateNickname || confirmedIdentity?.declaredName;
  const confirmedDisplayRole = confirmedIdentity?.relationshipToPerson;
  const displayInterlocutorLabel = confirmedIdentity
    ? confirmedDisplayRole && confirmedDisplayName
      ? `${confirmedDisplayRole}: ${confirmedDisplayName}`
      : confirmedDisplayName || confirmedDisplayRole || 'Acceso familiar verificado'
    : hasRealInterlocutorName
      ? `${interlocutor?.relationshipToPerson}: ${interlocutor?.fullName}`
      : 'Acceso familiar verificado';

  const dynamicSuggestions = activePerson
    ? buildDynamicAvatarSuggestions({
        person: activePerson,
        interlocutor,
        confirmedIdentity,
        turnOffset: (activeSession?.messages.length || 0) + suggestionRotationSeed,
        count: 3,
      })
    : [];

  // Cálculo de mensajes diarios usados y disponibles para el interlocutor
  const dailyMessageLimit = Math.max(
    0,
    Number(
      interlocutor?.customDailyMessageLimit ??
        subscription?.dailyMessageQuotaPerInterlocutor ??
        50
    )
  );
  const dailyMessagesUsed = Math.max(0, Number(interlocutor?.messagesSentToday || 0));
  const dailyMessagesRemaining = Math.max(0, dailyMessageLimit - dailyMessagesUsed);
  const isDailyLimitReached = dailyMessagesUsed >= dailyMessageLimit;

  // Sincronización automática en vivo del límite y contador diario desde administración sin recargar la página
  useEffect(() => {
    if (!isAuthenticated || !personalCode.trim()) return;
    let cancelled = false;

    const syncLiveQuotaStatus = async () => {
      try {
        const res = await fetch('/api/mi-esencia/family/quota-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ personalCode: personalCode.trim() }),
        });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled || !json.success || !json.data) return;

        const nextInter: MiEsenciaInterlocutor | undefined = json.data.interlocutor;
        const nextSub: MiEsenciaSubscriptionRecord | undefined = json.data.subscription;

        if (nextSub) {
          setSubscription((prev) => {
            if (
              prev &&
              prev.dailyMessageQuotaPerInterlocutor === nextSub.dailyMessageQuotaPerInterlocutor &&
              prev.messagesUsedThisMonth === nextSub.messagesUsedThisMonth &&
              prev.monthlyMessageQuota === nextSub.monthlyMessageQuota &&
              prev.status === nextSub.status
            ) {
              return prev;
            }
            return nextSub;
          });
        }

        if (nextInter) {
          setInterlocutor((prev) => {
            if (!prev) return nextInter;
            const mergedFullName =
              !isGenericAdministrativeInterlocutorName(prev.fullName) &&
              isGenericAdministrativeInterlocutorName(nextInter.fullName)
                ? prev.fullName
                : nextInter.fullName;
            if (
              prev.messagesSentToday === nextInter.messagesSentToday &&
              prev.customDailyMessageLimit === nextInter.customDailyMessageLimit &&
              prev.fullName === mergedFullName
            ) {
              return prev;
            }
            return {
              ...nextInter,
              fullName: mergedFullName,
              affectionateCallName: nextInter.affectionateCallName || prev.affectionateCallName,
            };
          });

          const nextLimit = Math.max(
            0,
            Number(
              nextInter.customDailyMessageLimit ??
                nextSub?.dailyMessageQuotaPerInterlocutor ??
                50
            )
          );
          const nextUsed = Math.max(0, Number(nextInter.messagesSentToday || 0));
          if (nextUsed < nextLimit) {
            setSendError((prevErr) =>
              prevErr && /l[ií]mite diario/i.test(prevErr) ? null : prevErr
            );
          }
        }
      } catch {
        // Silencioso en caso de intermitencia de red
      }
    };

    const intervalId = window.setInterval(syncLiveQuotaStatus, 4000);
    const onFocusOrVisible = () => {
      if (document.visibilityState === 'visible') {
        syncLiveQuotaStatus();
      }
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
  }, [isAuthenticated, personalCode]);

  const handlePrefillMemoryInput = (text: string) => {
    setMessageInput(text);
    setShowFaqModal(false);
    setTimeout(() => {
      messageInputRef.current?.focus();
    }, 50);
  };

  const handleStartNewConversation = async () => {
    if (!activePerson || isStartingNewSession) return;
    setIsStartingNewSession(true);
    setSendError(null);
    try {
      const res = await fetch('/api/mi-esencia/family/new-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalCode,
          selectedPersonId: activePerson.personId,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setSendError(json.error || 'No se pudo iniciar una nueva conversación.');
        return;
      }
      const newSession: MiEsenciaConversationSession = json.data.session;
      if (Array.isArray(json.data.sessions)) {
        setSessions(json.data.sessions);
      } else {
        setSessions((prev) => [
          ...prev.filter((s) => s.sessionId !== newSession.sessionId),
          newSession,
        ]);
      }
      if (json.data.interlocutor) {
        setInterlocutor(json.data.interlocutor);
      }
      setSelectedSessionId(newSession.sessionId);
    } catch (err: any) {
      setSendError(err?.message || 'Error al crear una nueva conversación.');
    } finally {
      setIsStartingNewSession(false);
    }
  };

  const handleSendMessage = async (presetText?: string) => {
    const text = (presetText ?? messageInput).trim();
    if (!text || !activePerson || isSending) return;

    setIsSending(true);
    setSendError(null);
    if (!presetText) {
      setMessageInput('');
    }

    try {
      const res = await fetch('/api/mi-esencia/family/converse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalCode,
          selectedPersonId: activePerson.personId,
          sessionId: activeSession?.sessionId,
          messageText: text,
          acceptConsent: true,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setSendError(json.error || 'No fue posible enviar tu mensaje.');
        if (!presetText) setMessageInput(text);
        return;
      }

      const updatedSession: MiEsenciaConversationSession = json.data.session;
      setSessions((prev) => {
        const others = prev.filter((s) => s.sessionId !== updatedSession.sessionId);
        return [...others, updatedSession];
      });
      setSelectedSessionId(updatedSession.sessionId);

      const baseInterlocutor: MiEsenciaInterlocutor | null =
        json.data.updatedInterlocutor || interlocutor;

      if (baseInterlocutor) {
        if (
          updatedSession.confirmedIdentity?.declaredName &&
          isGenericAdministrativeInterlocutorName(baseInterlocutor.fullName)
        ) {
          setInterlocutor({
            ...baseInterlocutor,
            fullName: updatedSession.confirmedIdentity.declaredName,
            affectionateCallName: updatedSession.confirmedIdentity.affectionateNickname,
            relationshipToPerson:
              updatedSession.confirmedIdentity.relationshipToPerson ||
              baseInterlocutor.relationshipToPerson,
          });
        } else {
          setInterlocutor(baseInterlocutor);
        }
      }

      if (json.data.updatedSubscription) {
        setSubscription(json.data.updatedSubscription);
      }

      if (json.data.subscriptionBanner) {
        setSubscriptionBanner(json.data.subscriptionBanner);
      }

      if (json.data.memoryCreated?.memoryId) {
        setRecentMemoryIdToUndo(json.data.memoryCreated.memoryId);
      }

      if (json.data.contradictionCreated) {
        setOpenContradictions((prev) => [...prev, json.data.contradictionCreated]);
      }
    } catch (err: any) {
      setSendError(err?.message || 'No pudimos enviar tu mensaje en este momento. Inténtalo nuevamente.');
    } finally {
      setIsSending(false);
    }
  };

  const handleUndoRecentMemory = async (memoryId: string) => {
    try {
      const res = await fetch('/api/mi-esencia/family/undo-memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personalCode, memoryId }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setRecentMemoryIdToUndo(null);
      }
    } catch {
      // Silencioso
    }
  };

  const handleResolveContradiction = async (contradictionId: string) => {
    if (!contradictionNote.trim()) return;
    try {
      const res = await fetch('/api/mi-esencia/family/resolve-contradiction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalCode,
          contradictionId,
          officialResolutionNotes: contradictionNote.trim(),
          keepBothVersionsAttributed: true,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setOpenContradictions((prev) =>
          prev.filter((c) => c.contradictionId !== contradictionId)
        );
        setResolvingContradictionId(null);
        setContradictionNote('');
      }
    } catch {
      // Silencioso
    }
  };

  const renderFaqModal = () => {
    if (!showFaqModal) return null;
    return (
      <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="max-w-2xl w-full max-h-[88vh] overflow-y-auto bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6 shadow-2xl space-y-5 text-stone-900 dark:text-stone-100">
          <div className="flex items-start justify-between gap-4 border-b border-stone-200 dark:border-stone-800 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400">
                <HelpCircle className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-serif font-semibold">
                  Preguntas Frecuentes • Niveles de Memoria A, B y C
                </h2>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  Cómo funciona la fidelidad biográfica y cómo puedes aportar recuerdos familiares o privados.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowFaqModal(false)}
              className="p-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-500 dark:text-stone-400 cursor-pointer"
              aria-label="Cerrar preguntas frecuentes"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-3 text-xs leading-relaxed">
            <div className="p-4 rounded-xl bg-amber-50/70 dark:bg-stone-950/80 border border-amber-200 dark:border-amber-900/50 space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300 text-sm">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>¿Qué es el Nivel A • Inmutable?</span>
              </div>
              <p className="text-stone-700 dark:text-stone-300">
                Es la verdad biográfica original de la persona entrevistada, tomada directamente del{' '}
                <strong>registro original de la entrevista</strong> con todas sus preguntas y respuestas reales.
                Es <strong>inmutable</strong>: ningún familiar ni conversación posterior puede borrar, alterar ni contradecir lo que dejó contado de viva voz.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-emerald-50/70 dark:bg-stone-950/80 border border-emerald-200 dark:border-emerald-900/50 space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-300 text-sm">
                <Users className="w-4 h-4 shrink-0" />
                <span>¿Qué es el Nivel B • Familiar?</span>
              </div>
              <p className="text-stone-700 dark:text-stone-300">
                Son las anécdotas, historias de reuniones, viajes o recuerdos compartidos que los familiares autorizados aportan durante la conversación para enriquecer la memoria familiar. Siempre se guardan indicando quién los compartió (por ejemplo:{' '}
                <em>«Según me contó mi hija/nieto...»</em>) para distinguirlos de la entrevista original.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-sky-50/70 dark:bg-stone-950/80 border border-sky-200 dark:border-sky-900/50 space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-sky-800 dark:text-sky-300 text-sm">
                <Lock className="w-4 h-4 shrink-0" />
                <span>¿Qué es el Nivel C • Privado?</span>
              </div>
              <p className="text-stone-700 dark:text-stone-300">
                Son confidencias, desahogos o recuerdos personales que deseas que queden{' '}
                <strong>exclusivamente entre tú y el avatar</strong>. Quedan protegidos únicamente con tu código personal y jamás se mencionan ni se revelan a ningún otro integrante de la familia.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-stone-100 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 space-y-2.5">
              <h3 className="font-semibold text-stone-900 dark:text-stone-100 text-sm">
                ¿Cómo aportar recursos y recuerdos en los Niveles B y C?
              </h3>
              <ul className="list-disc pl-5 space-y-1.5 text-stone-700 dark:text-stone-300">
                <li>
                  <strong>Para aportar un recuerdo familiar (Nivel B):</strong> Haz clic en el botón{' '}
                  <span className="font-medium text-emerald-700 dark:text-emerald-300">
                    «+ Aportar recuerdo familiar (Nivel B)»
                  </span>{' '}
                  debajo del chat (o inicia tu mensaje con{' '}
                  <em>«Quiero contarte algo que quiero que recuerdes: ...»</em>) y escribe la anécdota familiar.
                </li>
                <li>
                  <strong>Para guardar una confidencia privada (Nivel C):</strong> Haz clic en el botón{' '}
                  <span className="font-medium text-sky-700 dark:text-sky-300">
                    «Guardar confidencia privada (Nivel C)»
                  </span>{' '}
                  (o incluye <em>«solo entre nosotros»</em> / <em>«en confidencia»</em>) para que quede protegida únicamente con tu código.
                </li>
                <li>
                  <strong>Deshacer en 5 minutos:</strong> Después de guardar un recuerdo Nivel B o C, aparecerá un botón <em>«Deshacer»</em> en el mensaje por si deseas retirarlo.
                </li>
              </ul>

              {isAuthenticated && consentConfirmed && (
                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() =>
                      handlePrefillMemoryInput('Quiero contarte algo que quiero que recuerdes: ')
                    }
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition cursor-pointer"
                  >
                    + Redactar recuerdo familiar (Nivel B)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handlePrefillMemoryInput(
                        'Quiero contarte algo en confidencia que quede solo entre nosotros: '
                      )
                    }
                    className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs transition cursor-pointer"
                  >
                    + Redactar confidencia privada (Nivel C)
                  </button>
                </div>
              )}
            </div>

            <div className="p-4 rounded-xl bg-amber-50/90 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800/70 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="font-semibold text-amber-900 dark:text-amber-200 text-sm flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>¿Deseas más mensajes diarios en tu conversación?</span>
                </h3>
                {isAuthenticated && (
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                    Hoy: {dailyMessagesUsed} usados • {dailyMessagesRemaining} restantes (de{' '}
                    {dailyMessageLimit})
                  </span>
                )}
              </div>
              <p className="text-stone-700 dark:text-stone-300">
                Si deseas contar con <strong>más mensajes diarios</strong> y/o{' '}
                <strong>ampliar tu límite de mensajes</strong> de conversación para ti o tu familia, por favor{' '}
                <strong>ponte en contacto con YouForever</strong> para indicarte los{' '}
                <strong>planes de mejoras y actualizaciones disponibles</strong>.
              </p>
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t border-stone-200 dark:border-stone-800">
            <button
              type="button"
              onClick={() => setShowFaqModal(false)}
              className="px-4 py-2 rounded-xl bg-stone-900 dark:bg-amber-600 text-white dark:text-stone-950 font-semibold text-xs cursor-pointer"
            >
              Entendido
            </button>
          </div>
        </div>
      </div>
    );
  };

  // 1. Pantalla de ingreso con código personal criptográfico
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-stone-100 dark:bg-stone-950 text-stone-900 dark:text-stone-100 flex flex-col justify-between p-6 transition-colors">
        {renderFaqModal()}
        <header className="max-w-4xl w-full mx-auto flex flex-wrap items-center justify-between gap-3 py-2">
          <div className="flex items-center gap-3">
            <ForeverYouLogo
              variant="horizontal"
              size="sm"
              theme={theme === 'dark' ? 'light' : 'navy'}
            />
            <span className="text-xs uppercase tracking-widest text-amber-700 dark:text-amber-400/90 font-semibold border-l border-stone-300 dark:border-stone-700 pl-3">
              Mi Esencia • Portal Familiar Privado
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowFaqModal(true)}
              className="px-3 py-1.5 rounded-lg bg-white dark:bg-stone-900 hover:bg-stone-200 dark:hover:bg-stone-800 text-xs text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-stone-700 flex items-center gap-1.5 cursor-pointer"
            >
              <HelpCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span>Preguntas Frecuentes</span>
            </button>
            <ThemeToggleButton showLabel />
            {isAdminPreview && onExitAdminPreview && (
              <button
                onClick={onExitAdminPreview}
                className="px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-xs text-stone-200 border border-stone-700 cursor-pointer"
              >
                Volver a Administración de Mi Esencia
              </button>
            )}
          </div>
        </header>

        <div className="max-w-md w-full mx-auto bg-white dark:bg-stone-900/90 border border-stone-200 dark:border-stone-800 rounded-2xl p-8 shadow-2xl space-y-6">
          <div className="flex flex-col items-center text-center space-y-3">
            <ForeverYouLogo
              variant="stacked"
              size="md"
              theme={theme === 'dark' ? 'light' : 'navy'}
            />
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs font-medium">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Mi Esencia • Conversación Biográfica</span>
            </div>
            <h1 className="text-2xl font-serif text-stone-900 dark:text-white">
              Acceso Familiar Privado
            </h1>
            <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed">
              Ingresa el código personal único que recibiste en tu enlace privado para conversar con
              la recreación testimonial de tu familiar y proteger tus recuerdos personales.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                Tu Código Personal de Acceso
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-amber-600 dark:text-amber-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  value={personalCode}
                  onChange={(e) => setPersonalCode(e.target.value.toUpperCase())}
                  placeholder="Ej. YF-8K4M2"
                  className="w-full pl-10 pr-4 py-2.5 bg-stone-50 dark:bg-stone-950 border border-stone-300 dark:border-stone-700 rounded-xl text-sm font-mono text-amber-800 dark:text-amber-200 placeholder:text-stone-400 dark:placeholder:text-stone-600 focus:outline-none focus:border-amber-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleVerifyCode();
                  }}
                />
              </div>
            </div>

            {authError && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800/70 text-red-800 dark:text-red-200 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>
            )}

            <button
              onClick={() => handleVerifyCode()}
              disabled={isVerifying}
              className="w-full py-3 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-stone-950 font-semibold text-sm transition flex items-center justify-center gap-2 cursor-pointer"
            >
              {isVerifying ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Verificando tu código...</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  <span>Ingresar a Mi Esencia</span>
                </>
              )}
            </button>
          </div>

          <div className="pt-4 border-t border-stone-200 dark:border-stone-800/80 text-[11px] text-stone-500 text-center space-y-1">
            <p>
              Acceso privado para cada familiar mediante su enlace y código personal.
            </p>
            <p>Fidelidad biográfica estricta • Niveles de privacidad A, B y C</p>
          </div>
        </div>

        <footer className="text-center text-xs text-stone-500 dark:text-stone-600 py-2">
          YouForever • Mi Esencia
        </footer>
      </div>
    );
  }

  // 2. Pantalla de aviso de recreación digital y consentimiento informado (Aceptación Única)
  if (!consentConfirmed) {
    return (
      <div className="min-h-screen bg-stone-100 dark:bg-stone-950 text-stone-900 dark:text-stone-100 flex items-center justify-center p-6 transition-colors">
        {renderFaqModal()}
        <div className="max-w-lg w-full bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-8 shadow-2xl space-y-6">
          <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-800 pb-4">
            <ForeverYouLogo
              variant="horizontal"
              size="sm"
              theme={theme === 'dark' ? 'light' : 'navy'}
            />
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs font-medium">
                {hasRealInterlocutorName
                  ? `Bienvenida/o, ${interlocutor?.fullName}`
                  : 'Acceso Familiar Autorizado'}
              </span>
              <ThemeToggleButton />
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-xl font-serif text-stone-900 dark:text-white">
              Aviso de Transparencia y Recreación Testimonial
            </h2>
            <p className="text-sm text-stone-700 dark:text-stone-300 leading-relaxed bg-stone-50 dark:bg-stone-950/80 p-4 rounded-xl border border-stone-200 dark:border-stone-800">
              {config?.transparencyNoticeText ||
                'Estás por conversar con una recreación digital biográfica en Mi Esencia, construida fielmente a partir de los recuerdos reales compartidos en su entrevista.'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 text-xs">
              <div className="p-3 rounded-xl bg-stone-50 dark:bg-stone-950/60 border border-stone-200 dark:border-stone-800">
                <p className="font-semibold text-amber-700 dark:text-amber-300 mb-1">
                  Nivel A • Inmutable
                </p>
                <p className="text-stone-600 dark:text-stone-400">
                  Basado en las preguntas y respuestas literales de su entrevista real.
                </p>
              </div>
              <div className="p-3 rounded-xl bg-stone-50 dark:bg-stone-950/60 border border-stone-200 dark:border-stone-800">
                <p className="font-semibold text-emerald-700 dark:text-emerald-300 mb-1">
                  Nivel B • Familiar
                </p>
                <p className="text-stone-600 dark:text-stone-400">
                  Recuerdos que la familia aporta, siempre atribuidos a quien los contó.
                </p>
              </div>
              <div className="p-3 rounded-xl bg-stone-50 dark:bg-stone-950/60 border border-stone-200 dark:border-stone-800">
                <p className="font-semibold text-sky-700 dark:text-sky-300 mb-1">
                  Nivel C • Privado
                </p>
                <p className="text-stone-600 dark:text-stone-400">
                  Lo que pidas guardar «solo entre nosotros» queda aislado con tu código único.
                </p>
              </div>
            </div>
          </div>

          <label className="flex items-start gap-3 p-3.5 rounded-xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 cursor-pointer">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              className="mt-1 rounded border-stone-400 dark:border-stone-700 text-amber-600 focus:ring-amber-500"
            />
            <span className="text-xs text-stone-700 dark:text-stone-300 leading-relaxed">
              {config?.consentCheckboxLabel ||
                'Comprendo que converso con una recreación testimonial biográfica basada en los recuerdos reales compartidos en entrevista y acepto las reglas de privacidad familiar.'}{' '}
              <span className="text-amber-700 dark:text-amber-400 font-medium">
                (Se acepta una sola vez y no volverá a solicitarse).
              </span>
            </span>
          </label>

          <button
            onClick={handleConfirmOneTimeConsent}
            disabled={!consentChecked || isSavingConsent}
            className="w-full py-3 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-stone-950 font-semibold text-sm transition cursor-pointer"
          >
            {isSavingConsent
              ? 'Guardando aceptación...'
              : `Entrar a Conversar con ${subscription?.avatarDisplayName}`}
          </button>
        </div>
      </div>
    );
  }

  // 3. Interfaz conversacional principal
  return (
    <div className="min-h-screen bg-stone-100 dark:bg-stone-950 text-stone-900 dark:text-stone-100 flex flex-col transition-colors">
      {renderFaqModal()}

      {/* Encabezado cálido del portal familiar */}
      <header className="bg-stone-900 text-stone-100 border-b border-stone-800 px-4 py-3 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ForeverYouLogo variant="app_icon" size="xs" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-serif text-lg text-white">
                  Mi Esencia • {activePerson?.fullName || subscription?.avatarDisplayName}
                </h1>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[11px] font-medium">
                  Recreación Testimonial Fidedigna
                </span>
              </div>
              <p className="text-xs text-stone-400">
                <strong className="text-stone-200">{displayInterlocutorLabel}</strong> • Código
                personal verificado
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Indicador superior de mensajes diarios usados y restantes */}
            <button
              type="button"
              onClick={() => setShowFaqModal(true)}
              title="Ver cuántos mensajes tienes hoy y cómo solicitar más"
              className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition flex items-center gap-2 cursor-pointer ${
                dailyMessagesRemaining <= 5
                  ? 'bg-rose-950/60 hover:bg-rose-900/60 border-rose-700/60 text-rose-200'
                  : 'bg-stone-800/90 hover:bg-stone-800 border-stone-700 text-stone-200'
              }`}
            >
              <MessageSquare
                className={`w-3.5 h-3.5 shrink-0 ${
                  dailyMessagesRemaining <= 5 ? 'text-rose-400' : 'text-amber-400'
                }`}
              />
              <span>
                Mensajes hoy: <strong className="text-white">{dailyMessagesUsed}</strong> usados •{' '}
                <strong
                  className={
                    dailyMessagesRemaining <= 5 ? 'text-rose-300' : 'text-emerald-300'
                  }
                >
                  {dailyMessagesRemaining}
                </strong>{' '}
                restantes <span className="text-stone-400">(de {dailyMessageLimit})</span>
              </span>
            </button>

            {/* Botón de Preguntas Frecuentes (Niveles A, B y C) */}
            <button
              type="button"
              onClick={() => setShowFaqModal(true)}
              className="px-3 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-200 text-xs font-medium transition flex items-center gap-1.5 cursor-pointer"
              title="Ver Preguntas Frecuentes sobre Niveles A, B y C y planes de mejora"
            >
              <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
              <span>Preguntas Frecuentes</span>
            </button>

            {/* Selector de conversaciones guardadas y botón "+ Nueva conversación" */}
            {personSessions.length > 1 && (
              <div className="flex items-center gap-1.5 bg-stone-800 px-2.5 py-1.5 rounded-xl border border-stone-700 text-xs">
                <History className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <select
                  aria-label="Seleccionar conversación guardada"
                  value={activeSession?.sessionId || ''}
                  onChange={(e) => setSelectedSessionId(e.target.value)}
                  className="bg-transparent text-stone-200 focus:outline-none cursor-pointer text-xs max-w-[180px] truncate"
                >
                  {personSessions.map((sess, idx) => (
                    <option
                      key={sess.sessionId}
                      value={sess.sessionId}
                      className="bg-stone-900 text-stone-100"
                    >
                      {sess.title || `Conversación #${idx + 1}`} (
                      {new Date(sess.startedAt).toLocaleDateString('es-MX', {
                        day: '2-digit',
                        month: 'short',
                      })}
                      )
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={handleStartNewConversation}
              disabled={isStartingNewSession}
              className="px-3 py-1.5 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-200 text-xs font-medium transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Iniciar una nueva conversación guardando la actual en tu historial"
            >
              <PlusCircle className="w-3.5 h-3.5 text-amber-400" />
              <span>{isStartingNewSession ? 'Iniciando...' : '+ Nueva conversación'}</span>
            </button>

            {/* Selector de perfil cuando la entrevista es en modalidad de pareja */}
            {persons.length > 1 && (
              <div className="flex items-center bg-stone-800 p-1 rounded-xl border border-stone-700">
                <span className="text-[11px] text-stone-400 px-2 flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-amber-400" />
                  Conversar con:
                </span>
                {persons.map((p) => (
                  <button
                    key={p.personId}
                    onClick={() => {
                      setSelectedPersonId(p.personId);
                      const pSessions = sessions.filter((s) => s.personId === p.personId);
                      if (pSessions.length > 0) {
                        setSelectedSessionId(pSessions[pSessions.length - 1].sessionId);
                      }
                    }}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                      activePerson?.personId === p.personId
                        ? 'bg-amber-600 text-stone-950 font-semibold'
                        : 'text-stone-300 hover:text-white'
                    }`}
                  >
                    {p.preferredName}
                  </button>
                ))}
              </div>
            )}

            <ThemeToggleButton />

            {isAdminPreview && onExitAdminPreview && (
              <button
                onClick={onExitAdminPreview}
                className="px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-xs text-stone-200 border border-stone-700 cursor-pointer"
              >
                Cerrar Vista Previa
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Avisos de vigencia o contradicciones familiares */}
      <div className="max-w-4xl w-full mx-auto px-4 pt-3 space-y-2">
        {subscriptionBanner && (
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>{subscriptionBanner}</span>
            </div>
          </div>
        )}

        {openContradictions.length > 0 && (
          <div className="p-3.5 rounded-xl bg-stone-200/80 dark:bg-stone-900 border border-stone-300 dark:border-stone-800 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
                <BookOpen className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                Hay {openContradictions.length} recuerdo(s) con dos versiones familiares registradas
              </span>
            </div>
            {openContradictions.map((c) => (
              <div
                key={c.contradictionId}
                className="bg-white dark:bg-stone-950 p-3 rounded-lg border border-stone-200 dark:border-stone-800 space-y-1.5"
              >
                <p className="font-medium text-stone-800 dark:text-stone-200">Tema: {c.topic}</p>
                <p className="text-stone-600 dark:text-stone-400">
                  <strong>{c.versionALabel}:</strong> «{c.versionAContent.slice(0, 120)}»
                </p>
                <p className="text-stone-600 dark:text-stone-400">
                  <strong>{c.versionBLabel}:</strong> «{c.versionBContent.slice(0, 120)}»
                </p>
                {resolvingContradictionId === c.contradictionId ? (
                  <div className="pt-2 flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={contradictionNote}
                      onChange={(e) => setContradictionNote(e.target.value)}
                      placeholder="Escribe la aclaración consensuada por la familia..."
                      className="flex-1 px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs"
                    />
                    <button
                      onClick={() => handleResolveContradiction(c.contradictionId)}
                      className="px-3 py-1.5 rounded-lg bg-amber-700 text-white text-xs font-medium cursor-pointer"
                    >
                      Guardar Aclaración Familiar
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setResolvingContradictionId(c.contradictionId)}
                    className="text-amber-800 dark:text-amber-400 hover:underline font-medium text-[11px] cursor-pointer"
                  >
                    Aclarar este recuerdo en familia →
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Área de mensajes */}
      <div className="flex-1 max-w-4xl w-full mx-auto px-4 py-4 flex flex-col">
        <div className="flex-1 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-sm p-5 overflow-y-auto space-y-4 min-h-[420px] max-h-[62vh]">
          {activeSession?.messages.map((msg, msgIndex) => {
            const isUser = msg.sender === 'interlocutor';
            return (
              <div
                key={msg.messageId}
                className={`flex items-start gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                {!isUser && (
                  <div className="w-9 h-9 rounded-full bg-amber-900 text-amber-100 flex items-center justify-center font-serif font-bold text-sm shrink-0">
                    {activePerson?.preferredName?.slice(0, 1) || 'M'}
                  </div>
                )}

                <div
                  className={`rounded-2xl p-4 max-w-2xl space-y-2 ${
                    isUser
                      ? 'bg-stone-900 dark:bg-amber-600 text-stone-100 dark:text-stone-950 rounded-tr-sm'
                      : 'bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-800 dark:text-stone-100 rounded-tl-sm font-serif'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>

                  {/* V5.4.0: fotografías reales del testimonio que el avatar comparte. */}
                  {!isUser && msg.photoAttachments && msg.photoAttachments.length > 0 && (
                    <MiEsenciaChatPhotos personalCode={personalCode} photos={msg.photoAttachments} />
                  )}

                  {!isUser && msgIndex === 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1 font-sans">
                      <span className="inline-flex items-center gap-1 text-[11px] text-stone-500 dark:text-stone-400">
                        <ShieldCheck className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                        Verdad biográfica Nivel A activa • Tu código protege tus confidencias de Nivel C
                      </span>
                    </div>
                  )}

                  {!isUser && msg.privacyLevelApplied === 'privado_interlocutor' && (
                    <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-stone-200/80 dark:border-stone-700 text-[11px] text-sky-800 dark:text-sky-300 font-sans">
                      <span className="inline-flex items-center gap-1 font-medium">
                        <Lock className="w-3 h-3" />
                        Nivel C • Confidencia privada exclusiva con{' '}
                        {confirmedIdentity?.declaredName || interlocutor?.fullName}
                      </span>
                      {msg.memoryIdCreated && recentMemoryIdToUndo === msg.memoryIdCreated && (
                        <button
                          onClick={() => handleUndoRecentMemory(msg.memoryIdCreated!)}
                          className="inline-flex items-center gap-1 text-red-700 dark:text-red-400 hover:underline cursor-pointer"
                        >
                          <Undo2 className="w-3 h-3" />
                          Deshacer recuerdo
                        </button>
                      )}
                    </div>
                  )}

                  {!isUser &&
                    msg.privacyLevelApplied === 'familiar_compartido' &&
                    msg.memoryIdCreated && (
                      <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-stone-200/80 dark:border-stone-700 text-[11px] text-emerald-800 dark:text-emerald-300 font-sans">
                        <span className="inline-flex items-center gap-1 font-medium">
                          <CheckCircle2 className="w-3 h-3" />
                          Nivel B • Recuerdo familiar guardado con atribución a{' '}
                          {confirmedIdentity?.declaredName || interlocutor?.fullName}
                        </span>
                        {recentMemoryIdToUndo === msg.memoryIdCreated && (
                          <button
                            onClick={() => handleUndoRecentMemory(msg.memoryIdCreated!)}
                            className="inline-flex items-center gap-1 text-red-700 dark:text-red-400 hover:underline cursor-pointer"
                          >
                            <Undo2 className="w-3 h-3" />
                            Deshacer
                          </button>
                        )}
                      </div>
                    )}
                </div>
              </div>
            );
          })}

          {isSending && (
            <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400 pl-12">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-700 dark:text-amber-400" />
              <span>{activePerson?.preferredName} está recordando y escribiendo...</span>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Sugerencias opcionales dinámicas adaptadas a la persona y al familiar */}
        <div className="flex flex-wrap items-center gap-2 pt-3 pb-2">
          <span className="text-[11px] text-stone-500 dark:text-stone-400 mr-1">
            Sugerencias opcionales:
          </span>
          {dynamicSuggestions.map((sug, idx) => (
            <button
              key={`${sug.label}_${idx}`}
              type="button"
              onClick={() => handleSendMessage(sug.promptText)}
              className="px-2.5 py-1 rounded-xl bg-white dark:bg-stone-900 hover:bg-amber-50 dark:hover:bg-stone-800 border border-stone-200 dark:border-stone-700 text-xs text-stone-700 dark:text-stone-200 transition cursor-pointer flex items-center gap-1.5"
            >
              {idx % 2 === 0 ? (
                <Heart className="w-3 h-3 text-amber-700 dark:text-amber-400" />
              ) : (
                <MessageSquare className="w-3 h-3 text-amber-700 dark:text-amber-400" />
              )}
              <span>{sug.label}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSuggestionRotationSeed((prev) => prev + 3)}
            className="px-2 py-1 rounded-xl bg-stone-200/70 dark:bg-stone-800 hover:bg-stone-300 dark:hover:bg-stone-700 text-[11px] text-stone-600 dark:text-stone-300 transition cursor-pointer flex items-center gap-1"
            title="Ver otras sugerencias de conversación"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Otras sugerencias</span>
          </button>
          <button
            type="button"
            onClick={() =>
              handlePrefillMemoryInput('Quiero contarte algo que quiero que recuerdes: ')
            }
            className="px-2.5 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/70 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 transition cursor-pointer"
          >
            + Aportar recuerdo familiar (Nivel B)
          </button>
          <button
            type="button"
            onClick={() =>
              handlePrefillMemoryInput(
                'Quiero contarte algo en confidencia que quede solo entre nosotros: '
              )
            }
            className="px-2.5 py-1 rounded-xl bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/70 border border-sky-200 dark:border-sky-800 text-xs text-sky-900 dark:text-sky-200 transition cursor-pointer flex items-center gap-1"
          >
            <Lock className="w-3 h-3" />
            <span>Guardar confidencia privada (Nivel C)</span>
          </button>
        </div>

        {isDailyLimitReached && (
          <div className="mb-2 mt-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>
                Has utilizado tus <strong>{dailyMessagesUsed}</strong> mensajes diarios disponibles
                hoy (límite actual: <strong>{dailyMessageLimit}</strong>). Si el administrador
                amplía tu límite diario, podrás continuar conversando aquí mismo de inmediato sin
                recargar la página.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowFaqModal(true)}
              className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-stone-950 font-semibold text-[11px] cursor-pointer shrink-0"
            >
              ¿Cómo obtener más mensajes?
            </button>
          </div>
        )}

        {sendError && (
          <div className="mb-2 mt-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
            <span>{sendError}</span>
          </div>
        )}

        {/* Caja de envío */}
        <div className="mt-2 bg-white dark:bg-stone-900 border border-stone-300 dark:border-stone-700 rounded-2xl p-2 flex items-center gap-2 shadow-sm">
          <input
            ref={messageInputRef}
            type="text"
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            disabled={isDailyLimitReached}
            placeholder={
              isDailyLimitReached
                ? `Límite diario alcanzado (${dailyMessagesUsed}/${dailyMessageLimit} mensajes hoy)...`
                : isAwaitingIdentification
                ? 'Escribe tu nombre y tu parentesco (ej. «Soy Sofía, tu nieta»)...'
                : `Escribe un mensaje para conversar con ${activePerson?.preferredName || 'Mi Esencia'}...`
            }
            className="flex-1 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 bg-transparent focus:outline-none disabled:opacity-50"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !isDailyLimitReached) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
          />
          <button
            onClick={() => handleSendMessage()}
            disabled={isSending || !messageInput.trim() || isDailyLimitReached}
            className="px-4 py-2.5 rounded-xl bg-stone-900 dark:bg-amber-600 hover:bg-stone-800 dark:hover:bg-amber-500 disabled:opacity-40 text-amber-200 dark:text-stone-950 font-medium text-xs transition flex items-center gap-1.5 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Enviar</span>
          </button>
        </div>
      </div>
    </div>
  );
};
