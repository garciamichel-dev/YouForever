import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Clock,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Edit3,
  PlusCircle,
  Save,
  Check,
  ChevronLeft,
  ChevronRight,
  User,
  HeartHandshake,
  Lock,
  GitBranch,
  CornerDownRight,
  RotateCcw,
  Camera,
  Trash2,
  Volume2,
  Mic,
  HelpCircle,
  Settings,
  BookOpen,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react';
import {
  InterviewRecord,
  ParticipantRecord,
  QuestionRecord,
  AnswerRecord,
  AnswerPhotoAttachment,
  AnswerVoiceAttachment,
  buildParticipantFlowSequence,
  getNextQuestionInFlow,
  isQuestionnaireFlowComplete,
  validatePhotoAttachments,
  extractCleanTokenOrCode,
} from '../logic/interviewRules.ts';
import { QuestionPhotoUploader, DraftPhotoItem } from './QuestionPhotoUploader.tsx';
import { VoiceRecorder, VoiceRecorderHandle, SavedVoiceAudiosList } from './VoiceRecorder.tsx';
import { AudioPlayer } from './AudioPlayer.tsx';
import { FAQModal } from './FAQModal.tsx';
import { PrivacyConsentScreen } from './PrivacyConsentScreen.tsx';
import { ParticipantAdminPanel } from './ParticipantAdminPanel.tsx';
import { ParticipantBookStudio } from './ParticipantBookStudio.tsx';
import { ParticipantBookVersionRecord } from '../logic/demoStoryRules.ts';
import {
  getActiveParticipantSession,
  saveActiveParticipantSession,
  clearActiveParticipantSession,
  getParticipantProgress,
  saveParticipantProgress,
  getQuestionDraft,
  saveQuestionDraft,
  clearQuestionDraft,
} from '../utils/participantSessionStorage.ts';

function mapAttachmentsToDraftItems(attachments?: AnswerPhotoAttachment[]): DraftPhotoItem[] {
  if (!attachments || attachments.length === 0) return [];
  return attachments.map((att) => ({
    id: att.id,
    tempId: att.id,
    fileName: att.fileName || 'fotografia.jpg',
    mimeType: att.mimeType || 'image/jpeg',
    caption: att.caption || '',
    imageUrl: att.imageUrl || `/api/photos/${att.id}`,
    isPersisted: true,
  }));
}

interface ParticipantPortalProps {
  initialToken?: string | null;
  onGoToAdmin?: () => void;
  onOpenFaq?: () => void;
  onClearToken?: () => void;
}

export const ParticipantPortal: React.FC<ParticipantPortalProps> = ({
  initialToken,
  onOpenFaq,
  onClearToken,
}) => {
  const [isFaqOpen, setIsFaqOpen] = useState(false);
  const handleOpenFaq = onOpenFaq || (() => setIsFaqOpen(true));
  const [tokenInput, setTokenInput] = useState<string>(initialToken || '');
  const [isParticipantAdminOpen, setIsParticipantAdminOpen] = useState(false);
  const [logoutNotice, setLogoutNotice] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<{
    resolvedToken?: string;
    accessCode?: string;
    interview: InterviewRecord;
    participant: ParticipantRecord;
    questions: QuestionRecord[];
    answers: AnswerRecord[];
    otherParticipants: Array<{ id: string; name: string; relationship: string; role: string }>;
    allowAnswerEditing: boolean;
    allowAdditionalMemories: boolean;
    hasValidConsent?: boolean;
    consent?: any;
    bookVersions?: ParticipantBookVersionRecord[];
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Current question navigation by ID & index in dynamic flow sequence
  const [currentQuestionId, setCurrentQuestionId] = useState<string | null>(null);
  const [currentAnswerText, setCurrentAnswerText] = useState('');
  const [currentPhotos, setCurrentPhotos] = useState<DraftPhotoItem[]>([]);
  const [currentAudios, setCurrentAudios] = useState<AnswerVoiceAttachment[]>([]);
  const currentAudio = currentAudios.length > 0 ? currentAudios[currentAudios.length - 1] : null;
  const voiceRecorderRef = useRef<VoiceRecorderHandle | null>(null);
  const answerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const adaptiveTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const additionalTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [branchChoice, setBranchChoice] = useState<'yes' | 'no' | null>(null);
  const [savingAnswer, setSavingAnswer] = useState(false);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState<string | null>(null);
  const [flowTransitionNotice, setFlowTransitionNotice] = useState<string | null>(null);
  const [validationNotice, setValidationNotice] = useState<string | null>(null);

  // Whether the user has reached the end-of-instrument completion screen
  const [showCompletionScreen, setShowCompletionScreen] = useState(false);

  // Autonomous deepening follow-up question
  const [adaptiveQuestion, setAdaptiveQuestion] = useState<{
    text: string;
    parentQuestionId: string;
    reason?: string;
    followUpIndex?: number;
    maxFollowUps?: number;
  } | null>(null);
  const [adaptiveAnswerText, setAdaptiveAnswerText] = useState('');
  const [adaptivePhotos, setAdaptivePhotos] = useState<DraftPhotoItem[]>([]);
  const [adaptiveAudio, setAdaptiveAudio] = useState<AnswerVoiceAttachment | null>(null);

  // Additional free information modal ("Añadir Información Adicional")
  const [showAdditionalMemoryModal, setShowAdditionalMemoryModal] = useState(false);
  const [additionalMemoryText, setAdditionalMemoryText] = useState('');
  const [additionalPhotos, setAdditionalPhotos] = useState<DraftPhotoItem[]>([]);
  const [additionalAudio, setAdditionalAudio] = useState<AnswerVoiceAttachment | null>(null);
  const [additionalModalError, setAdditionalModalError] = useState<string | null>(null);

  // Voluntary completion modal
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [finishReason, setFinishReason] = useState('');
  const [finishing, setFinishing] = useState(false);

  // Tab view within participant portal: 'interview' | 'history' | 'book'
  const [activeTab, setActiveTab] = useState<'interview' | 'history' | 'book'>('interview');
  const [editingAnswerId, setEditingAnswerId] = useState<string | null>(null);
  const [editMemoryText, setEditMemoryText] = useState('');
  const [editPhotos, setEditPhotos] = useState<DraftPhotoItem[]>([]);

  // Compact Gear Menu & Senior UI states
  const [isGearMenuOpen, setIsGearMenuOpen] = useState(false);
  const gearMenuRef = useRef<HTMLDivElement | null>(null);
  const [showPhotoSection, setShowPhotoSection] = useState(false);
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (gearMenuRef.current && !gearMenuRef.current.contains(event.target as Node)) {
        setIsGearMenuOpen(false);
      }
    }
    if (isGearMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isGearMenuOpen]);

  // 10-minute non-interfering autosave state & refs
  const [lastAutosavedAt, setLastAutosavedAt] = useState<Date | null>(null);
  const [silentAutosaveNotice, setSilentAutosaveNotice] = useState<string | null>(null);
  const currentAnswerTextRef = useRef(currentAnswerText);
  const currentPhotosRef = useRef(currentPhotos);
  const currentAudiosRef = useRef(currentAudios);
  const currentQuestionRef = useRef<QuestionRecord | null>(null);
  const branchChoiceRef = useRef(branchChoice);
  const sessionDataRef = useRef(sessionData);
  const activeTokenRef = useRef<string>('');
  const isInterviewOpenRef = useRef(false);

  // Compute participant's dynamic flow sequence
  const myAnswers = useMemo(() => {
    if (!sessionData) return [];
    return sessionData.answers.filter((a) => a.participantId === sessionData.participant.id);
  }, [sessionData]);

  const flowSequence = useMemo(() => {
    if (!sessionData) return [];
    return buildParticipantFlowSequence({
      allQuestions: sessionData.questions,
      participantAnswers: myAnswers,
      storyMode: sessionData.interview.storyMode,
    });
  }, [sessionData, myAnswers]);

  const currentIndex = useMemo(() => {
    if (flowSequence.length === 0) return 0;
    if (!currentQuestionId) return 0;
    const idx = flowSequence.findIndex((item) => item.question.id === currentQuestionId);
    return idx >= 0 ? idx : 0;
  }, [flowSequence, currentQuestionId]);

  // Interviewee progress percentage calculation (declared unconditionally at top level to obey Rules of Hooks)
  const answeredQuestionIds = useMemo(() => {
    return new Set(
      myAnswers
        .filter((a) => !a.isFollowUp && !a.isAdditionalMemory)
        .map((a) => a.questionId)
    );
  }, [myAnswers]);

  const flowQuestionsCount = flowSequence.length;

  const answeredInFlowCount = useMemo(() => {
    return flowSequence.filter((item) => answeredQuestionIds.has(item.question.id)).length;
  }, [flowSequence, answeredQuestionIds]);

  const allFlowCompleted = useMemo(() => {
    if (!sessionData) return false;
    return isQuestionnaireFlowComplete(flowSequence, myAnswers);
  }, [sessionData, flowSequence, myAnswers]);

  const progressPercent = useMemo(() => {
    if (!sessionData) return 0;
    if (showCompletionScreen || sessionData.interview?.userDeclaredComplete || allFlowCompleted) return 100;
    if (flowQuestionsCount === 0) return 0;
    return Math.min(100, Math.max(0, Math.round((answeredInFlowCount / flowQuestionsCount) * 100)));
  }, [sessionData, showCompletionScreen, allFlowCompleted, flowQuestionsCount, answeredInFlowCount]);

  const currentFlowItem = flowSequence[currentIndex] || null;
  const currentQuestion = currentFlowItem?.question || null;

  const activeToken = (
    sessionData?.resolvedToken ||
    tokenInput ||
    initialToken ||
    (typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('token') ||
        new URLSearchParams(window.location.search).get('code') ||
        ''
      : '')
  ).trim();

  const loadSession = async (token: string) => {
    const cleanToken = extractCleanTokenOrCode(token) || token.trim();
    if (!cleanToken) return;
    setTokenInput(cleanToken);
    setLogoutNotice(null);
    try {
      setLoading(true);
      setErrorMsg(null);

      let cachedInterviews: unknown[] | undefined = undefined;
      let cachedBookVersions: unknown[] | undefined = undefined;
      try {
        const rawCache = localStorage.getItem('foreveryou_interviews_cache');
        if (rawCache) {
          const parsedCache = JSON.parse(rawCache);
          if (Array.isArray(parsedCache) && parsedCache.length > 0) {
            cachedInterviews = parsedCache;
          }
        }
        const rawBvCache = localStorage.getItem('foreveryou_book_versions_cache');
        if (rawBvCache) {
          const parsedBvCache = JSON.parse(rawBvCache);
          if (Array.isArray(parsedBvCache) && parsedBvCache.length > 0) {
            cachedBookVersions = parsedBvCache;
          }
        }
      } catch (_e) {
        // ignore localStorage read errors
      }

      const res = await fetch('/api/participant/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: cleanToken, cachedInterviews, cachedBookVersions }),
      });

      const data = await res.json();
      if (data.success && data.data) {
        setSessionData(data.data);

        const participantId: string = data.data.participant.id;
        const resolvedTokenToSave: string = data.data.resolvedToken || cleanToken;
        saveActiveParticipantSession({
          token: resolvedTokenToSave,
          accessCode: data.data.accessCode,
          participantId,
          interviewId: data.data.interview.id,
          participantName: data.data.participant.name,
        });

        const participantAnswers: AnswerRecord[] = data.data.answers.filter(
          (a: AnswerRecord) => a.participantId === participantId
        );
        const seq = buildParticipantFlowSequence({
          allQuestions: data.data.questions,
          participantAnswers,
          storyMode: data.data.interview.storyMode,
        });

        const isInterviewOpen =
          data.data.interview.status === 'open' &&
          !data.data.interview.userDeclaredComplete;
        const isReopened = Boolean(isInterviewOpen && data.data.interview.reopenedAt);

        const savedProgress = getParticipantProgress(participantId);
        const hasValidSavedQuestion =
          savedProgress?.currentQuestionId &&
          seq.some((item) => item.question.id === savedProgress.currentQuestionId);

        if (isReopened) {
          // If the interview was reopened by admin, land on Question 1 with previous responses pre-loaded,
          // unless the user already resumed this reopened session and navigated to another step.
          setShowCompletionScreen(false);
          setActiveTab('interview');
          if (
            savedProgress &&
            hasValidSavedQuestion &&
            savedProgress.reopenedAt === data.data.interview.reopenedAt &&
            !savedProgress.showCompletionScreen
          ) {
            setCurrentQuestionId(savedProgress.currentQuestionId);
          } else if (seq.length > 0) {
            setCurrentQuestionId(seq[0].question.id);
          }
        } else if (savedProgress && hasValidSavedQuestion) {
          setCurrentQuestionId(savedProgress.currentQuestionId);
          setActiveTab(savedProgress.activeTab === 'history' ? 'history' : 'interview');
          setShowCompletionScreen(Boolean(savedProgress.showCompletionScreen));
        } else {
          const answeredIds = new Set(
            participantAnswers
              .filter((a) => !a.isFollowUp && !a.isAdditionalMemory)
              .map((a) => a.questionId)
          );
          const firstUnanswered = seq.find((item) => !answeredIds.has(item.question.id));

          if (firstUnanswered) {
            setCurrentQuestionId(firstUnanswered.question.id);
            setShowCompletionScreen(false);
          } else if (seq.length > 0) {
            if (isInterviewOpen) {
              setCurrentQuestionId(seq[0].question.id);
              setShowCompletionScreen(false);
            } else {
              setCurrentQuestionId(seq[seq.length - 1].question.id);
              setShowCompletionScreen(true);
            }
          }
        }
      } else {
        setErrorMsg(data.error || 'No se pudo validar el enlace de invitación.');
      }
    } catch (err: unknown) {
      setErrorMsg('Error de conexión al cargar la sesión.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialToken) {
      setTokenInput(initialToken);
      loadSession(initialToken);
      return;
    }
    const savedSession = getActiveParticipantSession();
    if (savedSession && savedSession.token) {
      setTokenInput(savedSession.accessCode || savedSession.token);
      loadSession(savedSession.token);
    }
  }, [initialToken]);

  const hydratedQuestionKeyRef = useRef<string | null>(null);

  // Sync answer text, branchChoice, saved photos, & local draft when currentQuestionId changes
  useEffect(() => {
    if (!sessionData || !currentQuestion) return;

    const participantId = sessionData.participant.id;
    const questionKey = `${participantId}:${currentQuestion.id}`;
    hydratedQuestionKeyRef.current = null;

    const myAnswer = sessionData.answers.find(
      (a) =>
        a.questionId === currentQuestion.id &&
        a.participantId === participantId &&
        !a.isFollowUp &&
        !a.isAdditionalMemory
    );

    const savedDraft = getQuestionDraft(participantId, currentQuestion.id);

    if (savedDraft) {
      setCurrentAnswerText(savedDraft.answerText);
      setBranchChoice(savedDraft.branchChoice ?? myAnswer?.branchChoice ?? null);
    } else if (myAnswer) {
      setCurrentAnswerText(myAnswer.notRecalled ? '' : myAnswer.answerText);
      setBranchChoice(myAnswer.branchChoice || null);
    } else {
      setCurrentAnswerText('');
      setBranchChoice(null);
    }

    if (myAnswer) {
      setCurrentPhotos(mapAttachmentsToDraftItems(myAnswer.photos));
      const audios =
        myAnswer.audioRecordings && myAnswer.audioRecordings.length > 0
          ? myAnswer.audioRecordings
          : myAnswer.audio
          ? [myAnswer.audio]
          : [];
      setCurrentAudios(audios);
      const hasText = !myAnswer.notRecalled && Boolean(myAnswer.answerText && myAnswer.answerText.trim().length > 0);
      setIsTextareaExpanded(hasText || Boolean(savedDraft?.answerText));
      setShowPhotoSection(Boolean(myAnswer.photos && myAnswer.photos.length > 0));
    } else {
      setCurrentPhotos([]);
      setCurrentAudios([]);
      setIsTextareaExpanded(Boolean(savedDraft?.answerText));
      setShowPhotoSection(false);
    }
    setValidationNotice(null);
    hydratedQuestionKeyRef.current = questionKey;
  }, [currentQuestion?.id, sessionData?.participant.id]);

  // Persist current question progress in localStorage so reloads or future logins resume at exact step
  useEffect(() => {
    if (!sessionData?.participant?.id || !currentQuestionId) return;
    saveParticipantProgress(sessionData.participant.id, {
      currentQuestionId,
      activeTab,
      showCompletionScreen,
      reopenedAt: sessionData.interview?.reopenedAt || null,
    });
  }, [sessionData?.participant?.id, currentQuestionId, activeTab, showCompletionScreen, sessionData?.interview?.reopenedAt]);

  // Persist in-progress draft text and branchChoice locally as the interviewee types
  useEffect(() => {
    if (!sessionData?.participant?.id || !currentQuestion?.id) return;
    const expectedKey = `${sessionData.participant.id}:${currentQuestion.id}`;
    if (hydratedQuestionKeyRef.current !== expectedKey) return;

    const myAnswer = sessionData.answers.find(
      (a) =>
        a.questionId === currentQuestion.id &&
        a.participantId === sessionData.participant.id &&
        !a.isFollowUp &&
        !a.isAdditionalMemory
    );
    const persistedText = myAnswer ? (myAnswer.notRecalled ? '' : myAnswer.answerText) : '';
    const persistedBranch = myAnswer?.branchChoice || null;

    // If current state matches already-saved server answer, clear redundant draft; otherwise save draft
    if (currentAnswerText === persistedText && branchChoice === persistedBranch) {
      clearQuestionDraft(sessionData.participant.id, currentQuestion.id);
    } else {
      saveQuestionDraft(sessionData.participant.id, currentQuestion.id, {
        answerText: currentAnswerText,
        branchChoice,
      });
    }
  }, [currentAnswerText, branchChoice, currentQuestion?.id, sessionData?.participant?.id]);

  // Explicit Logout from Ajustes & Privacidad (clears active session credential while preserving progress & drafts)
  const handleLogoutSession = () => {
    if (sessionData?.participant?.id && currentQuestion?.id) {
      saveParticipantProgress(sessionData.participant.id, {
        currentQuestionId: currentQuestion.id,
        activeTab,
        showCompletionScreen,
        reopenedAt: sessionData.interview?.reopenedAt || null,
      });
      const myAnswer = sessionData.answers.find(
        (a) =>
          a.questionId === currentQuestion.id &&
          a.participantId === sessionData.participant.id &&
          !a.isFollowUp &&
          !a.isAdditionalMemory
      );
      const persistedText = myAnswer ? (myAnswer.notRecalled ? '' : myAnswer.answerText) : '';
      const persistedBranch = myAnswer?.branchChoice || null;
      if (currentAnswerText !== persistedText || branchChoice !== persistedBranch) {
        saveQuestionDraft(sessionData.participant.id, currentQuestion.id, {
          answerText: currentAnswerText,
          branchChoice,
        });
      }
    }

    clearActiveParticipantSession();

    if (typeof window !== 'undefined') {
      const cleanPath = window.location.pathname || '/';
      window.history.replaceState({}, '', cleanPath);
    }

    onClearToken?.();
    setIsParticipantAdminOpen(false);
    setSessionData(null);
    setTokenInput('');
    setCurrentQuestionId(null);
    setCurrentAnswerText('');
    setCurrentPhotos([]);
    setCurrentAudios([]);
    setBranchChoice(null);
    setAdaptiveQuestion(null);
    setErrorMsg(null);
    setLogoutNotice(
      'Has cerrado tu sesión de forma segura. Tu avance y cualquier borrador escrito en curso se han conservado para cuando vuelvas a ingresar.'
    );
  };

  // Delete an already-persisted photo from the server
  const handleDeletePersistedPhoto = async (photoId: string) => {
    if (!sessionData) return;
    const res = await fetch(`/api/participant/photos/${photoId}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: activeToken }),
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'No se pudo eliminar la fotografía.');
    }

    // Update sessionData.answers in state so UI reflects deletion immediately
    const updatedAnswers = sessionData.answers.map((ans) => {
      if (ans.photos && ans.photos.some((p) => p.id === photoId)) {
        return {
          ...ans,
          photos: ans.photos.filter((p) => p.id !== photoId),
        };
      }
      return ans;
    });
    setSessionData({
      ...sessionData,
      answers: updatedAnswers,
    });
    setSaveSuccessNotice('Fotografía eliminada del servidor correctamente.');
    setTimeout(() => setSaveSuccessNotice(null), 3000);
  };

  // Delete an already-persisted voice audio from the server
  const handleDeletePersistedVoiceAudio = async (audioId: string) => {
    if (!sessionData) return;
    try {
      const res = await fetch(`/api/participant/audio/${audioId}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: activeToken }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'No se pudo eliminar el archivo de voz.');
      }

      setCurrentAudios((prev) => prev.filter((a) => a.id !== audioId));

      const updatedAnswers = sessionData.answers.map((ans) => {
        let changed = false;
        let nextRecordings = ans.audioRecordings;
        if (nextRecordings && nextRecordings.some((a) => a.id === audioId)) {
          nextRecordings = nextRecordings.filter((a) => a.id !== audioId);
          changed = true;
        }
        let nextAudio = ans.audio;
        if (nextAudio && nextAudio.id === audioId) {
          nextAudio =
            nextRecordings && nextRecordings.length > 0
              ? nextRecordings[nextRecordings.length - 1]
              : undefined;
          changed = true;
        }
        return changed ? { ...ans, audio: nextAudio, audioRecordings: nextRecordings } : ans;
      });

      setSessionData({
        ...sessionData,
        answers: updatedAnswers,
      });

      setSaveSuccessNotice('Archivo de voz eliminado del servidor correctamente.');
      setTimeout(() => setSaveSuccessNotice(null), 3000);
    } catch (err: any) {
      console.warn('Error deleting voice audio:', err);
      setCurrentAudios((prev) => prev.filter((a) => a.id !== audioId));
    }
  };

  // Synchronize ref mirrors for non-interfering autosave
  useEffect(() => {
    currentAnswerTextRef.current = currentAnswerText;
  }, [currentAnswerText]);
  useEffect(() => {
    currentPhotosRef.current = currentPhotos;
  }, [currentPhotos]);
  useEffect(() => {
    currentAudiosRef.current = currentAudios;
  }, [currentAudios]);
  useEffect(() => {
    currentQuestionRef.current = currentQuestion;
  }, [currentQuestion]);
  useEffect(() => {
    branchChoiceRef.current = branchChoice;
  }, [branchChoice]);
  useEffect(() => {
    sessionDataRef.current = sessionData;
  }, [sessionData]);
  useEffect(() => {
    activeTokenRef.current = activeToken;
  }, [activeToken]);

  // Non-interfering 10-minute background autosave (runs silently, never blocks, pauses or cancels)
  useEffect(() => {
    const AUTOSAVE_INTERVAL_MS = 10 * 60 * 1000;

    const performSilentAutosave = async () => {
      const sess = sessionDataRef.current;
      const q = currentQuestionRef.current;
      const token = activeTokenRef.current;

      if (!sess || !q || !token) return;
      const isInterviewOpen =
        sess.interview.status === 'open' && !sess.interview.userDeclaredComplete;
      if (!isInterviewOpen) return;

      // CRITICAL: Never interfere, pause, cancel or block if user is currently recording
      if (voiceRecorderRef.current?.isRecordingOrActive?.()) {
        return;
      }

      const textToSave = (currentAnswerTextRef.current || '').trim();
      const photosToSave = currentPhotosRef.current || [];
      const audiosToSave = currentAudiosRef.current || [];

      // Only save if user has actually typed something or added media
      if (textToSave.length === 0 && photosToSave.length === 0 && audiosToSave.length === 0) {
        return;
      }

      try {
        const lightweightAudios = audiosToSave.map((a) => ({
          id: a.id,
          audioUrl: a.audioUrl,
          audioDataUrl: a.audioDataUrl,
          transcription: a.transcription,
          durationSeconds: a.durationSeconds,
          mimeType: a.mimeType,
        }));

        const res = await fetch('/api/participant/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            questionId: q.id,
            questionText: q.text,
            answerText: textToSave,
            notRecalled: false,
            branchChoice: branchChoiceRef.current,
            photos: photosToSave,
            audio:
              lightweightAudios.length > 0
                ? lightweightAudios[lightweightAudios.length - 1]
                : undefined,
            audioRecordings: lightweightAudios,
            idempotencyKey: `autosave_${sess.participant.id}_${q.id}_${Date.now()}`,
          }),
        });

        const data = await res.json();
        if (data.success && data.data?.answer) {
          const now = new Date();
          setLastAutosavedAt(now);
          setSilentAutosaveNotice(
            `Guardado automático a las ${now.toLocaleTimeString('es-MX', {
              hour: '2-digit',
              minute: '2-digit',
            })}`
          );
          setTimeout(() => setSilentAutosaveNotice(null), 4500);

          const savedAns: AnswerRecord = data.data.answer;
          setSessionData((prev) => {
            if (!prev) return prev;
            const updated = [...prev.answers];
            const idx = updated.findIndex(
              (a) =>
                a.id === savedAns.id ||
                (a.questionId === savedAns.questionId &&
                  a.participantId === savedAns.participantId &&
                  !a.isFollowUp &&
                  !a.isAdditionalMemory)
            );
            if (idx >= 0) {
              updated[idx] = savedAns;
            } else {
              updated.push(savedAns);
            }
            return { ...prev, answers: updated };
          });
        }
      } catch (err) {
        console.warn('[Autosave] Non-fatal background autosave error:', err);
      }
    };

    const timerId = setInterval(performSilentAutosave, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(timerId);
  }, []);

  // Advance to the next question in the dynamic flow (or show completion screen)
  const advanceInFlowAfterQuestion = (
    answeredQuestionId: string,
    updatedAnswers: AnswerRecord[]
  ) => {
    if (!sessionData) return;

    const myUpdatedAnswers = updatedAnswers.filter(
      (a) => a.participantId === sessionData.participant.id
    );
    const updatedSeq = buildParticipantFlowSequence({
      allQuestions: sessionData.questions,
      participantAnswers: myUpdatedAnswers,
      storyMode: sessionData.interview.storyMode,
    });

    const nextStep = getNextQuestionInFlow({
      sequence: updatedSeq,
      currentQuestionId: answeredQuestionId,
      participantAnswers: myUpdatedAnswers,
    });

    if (nextStep.enteredSubFlowId) {
      setFlowTransitionNotice(
        `Ingresando al sub-flujo «${nextStep.enteredSubFlowId}». Al terminar estas preguntas retornarás automáticamente al hilo principal.`
      );
      setTimeout(() => setFlowTransitionNotice(null), 6000);
    } else if (nextStep.returnedToMainFlow) {
      setFlowTransitionNotice(
        'Has completado las preguntas del sub-flujo. Retornando al hilo principal del cuestionario.'
      );
      setTimeout(() => setFlowTransitionNotice(null), 6000);
    }

    const currentIdx = updatedSeq.findIndex((item) => item.question.id === answeredQuestionId);
    if (nextStep.completedInstrument || !nextStep.nextItem) {
      if (currentIdx >= 0 && currentIdx < updatedSeq.length - 1) {
        setShowCompletionScreen(false);
        setCurrentQuestionId(updatedSeq[currentIdx + 1].question.id);
      } else {
        setShowCompletionScreen(true);
      }
    } else {
      setShowCompletionScreen(false);
      setCurrentQuestionId(nextStep.nextItem.question.id);
    }
  };

  // Save current question answer
  const handleSaveAnswer = async (
    notRecalled: boolean = false,
    explicitBranchChoice?: 'yes' | 'no' | null
  ) => {
    if (!sessionData || !currentQuestion) return;

    let activeAudios = [...currentAudios];
    let textToSave = currentAnswerText.trim();

    // 2da Corrección: Si el entrevistado está grabando audio al pulsar "Guardar respuesta" o "Enviar",
    // finalizar y subir automáticamente el audio con su transcripción antes de avanzar.
    if (!notRecalled && voiceRecorderRef.current?.isRecordingOrActive()) {
      try {
        setSavingAnswer(true);
        const freshlyRecorded = await voiceRecorderRef.current.finalizeAndUpload();
        if (freshlyRecorded) {
          if (!activeAudios.some((a) => a.id === freshlyRecorded.id)) {
            activeAudios.push(freshlyRecorded);
          }
          if (freshlyRecorded.transcription && freshlyRecorded.transcription.trim().length > 0) {
            const transcript = freshlyRecorded.transcription.trim();
            if (!textToSave || textToSave === 'No aplica a mi historia.') {
              textToSave = transcript;
            } else if (!textToSave.includes(transcript)) {
              textToSave = `${textToSave}\n\n[Nota de voz]: ${transcript}`;
            }
          }
        }
      } catch (voiceErr) {
        console.warn('Error auto-finalizing voice recording:', voiceErr);
      }
    }

    // Validate photo descriptions if the interviewee uploaded any photos
    if (!notRecalled && currentPhotos.length > 0) {
      const photoCheck = validatePhotoAttachments(currentPhotos);
      if (!photoCheck.valid) {
        setValidationNotice(photoCheck.error || 'Por favor describe la fotografía adjunta.');
        setSavingAnswer(false);
        return;
      }
    }

    const chosenBranch =
      explicitBranchChoice !== undefined ? explicitBranchChoice : branchChoice;

    if (chosenBranch === 'no' && textToSave.length === 0) {
      textToSave = 'No aplica a mi historia.';
    }
    if (!notRecalled && textToSave.length === 0 && activeAudios.length > 0) {
      const combinedTranscriptions = activeAudios
        .map((a) => a.transcription)
        .filter((t) => t && t.trim().length > 0)
        .join('. ');
      textToSave = combinedTranscriptions || 'Respuesta registrada mediante archivo de voz.';
    }
    if (!notRecalled && textToSave.length === 0 && currentPhotos.length > 0) {
      textToSave = currentPhotos.map((p) => p.caption.trim()).join('. ');
    }

    if (!notRecalled && textToSave.length === 0) {
      setValidationNotice(
        'Por favor escribe tu respuesta, graba una nota de voz o pulsa «Omitir y continuar» para avanzar.'
      );
      setSavingAnswer(false);
      return;
    }

    try {
      setSavingAnswer(true);
      setValidationNotice(null);
      const idempotencyKey = `sub_${sessionData.participant.id}_${currentQuestion.id}_${Date.now()}`;

      // Use lightweight audio metadata to avoid large base64 network payloads
      const lightweightAudios = activeAudios.map((a) => ({
        id: a.id,
        audioUrl: a.audioUrl,
        audioDataUrl: a.audioDataUrl,
        transcription: a.transcription,
        durationSeconds: a.durationSeconds,
        mimeType: a.mimeType,
      }));

      const res = await fetch('/api/participant/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: activeToken,
          questionId: currentQuestion.id,
          questionText: currentQuestion.text,
          answerText: notRecalled ? '' : textToSave,
          notRecalled,
          branchChoice: chosenBranch,
          photos: notRecalled ? [] : currentPhotos,
          audio: notRecalled
            ? undefined
            : lightweightAudios.length > 0
            ? lightweightAudios[lightweightAudios.length - 1]
            : undefined,
          audioRecordings: notRecalled ? [] : lightweightAudios,
          idempotencyKey,
        }),
      });

      const data = await res.json();
      if (data.success) {
        clearQuestionDraft(sessionData.participant.id, currentQuestion.id);
        setSaveSuccessNotice(
          activeAudios.length > 0
            ? 'Respuesta, grabaciones de voz y transcripción guardadas con éxito en la base de datos. Avanzando...'
            : currentPhotos.length > 0
            ? 'Respuesta y fotografías guardadas con éxito en el servidor. Avanzando...'
            : 'Respuesta guardada con éxito en la base de datos. Avanzando...'
        );
        setTimeout(() => setSaveSuccessNotice(null), 3500);

        const savedAns: AnswerRecord = data.data.answer;
        setCurrentPhotos(mapAttachmentsToDraftItems(savedAns.photos));
        const returnedAudios =
          savedAns.audioRecordings && savedAns.audioRecordings.length > 0
            ? savedAns.audioRecordings
            : savedAns.audio
            ? [savedAns.audio]
            : [];
        setCurrentAudios(returnedAudios);

        const updatedAnswers = [...sessionData.answers];
        const existingIdx = updatedAnswers.findIndex(
          (a) =>
            a.questionId === currentQuestion.id &&
            a.participantId === sessionData.participant.id &&
            !a.isFollowUp &&
            !a.isAdditionalMemory
        );

        if (existingIdx >= 0) {
          updatedAnswers[existingIdx] = savedAns;
        } else {
          updatedAnswers.push(savedAns);
        }

        setSessionData({
          ...sessionData,
          interview: data.data.interview,
          answers: updatedAnswers,
        });

        // If the server generated an autonomous deepening question for this answer, show it before advancing
        if (
          !notRecalled &&
          chosenBranch !== 'no' &&
          data.data.adaptiveQuestion &&
          data.data.adaptiveQuestion.text
        ) {
          setAdaptiveQuestion({
            text: data.data.adaptiveQuestion.text,
            parentQuestionId: currentQuestion.id,
            reason: data.data.adaptiveQuestion.reason,
            followUpIndex: data.data.adaptiveQuestion.followUpIndex || 1,
            maxFollowUps:
              data.data.adaptiveQuestion.maxFollowUps ||
              sessionData.interview.maxFollowUpsAtCreation,
          });
          setAdaptiveAnswerText('');
          setAdaptivePhotos([]);
          setAdaptiveAudio(null);
          setSaveSuccessNotice(
            'Respuesta guardada. Hemos preparado una pregunta para profundizar en este recuerdo.'
          );
          setTimeout(() => setSaveSuccessNotice(null), 4000);
        } else {
          // Clear any pending adaptive state and advance to the next question in the flow
          setAdaptiveQuestion(null);
          setAdaptiveAnswerText('');
          setAdaptivePhotos([]);
          setAdaptiveAudio(null);
          advanceInFlowAfterQuestion(currentQuestion.id, updatedAnswers);
        }
      } else {
        setValidationNotice(data.error || 'Error al guardar la respuesta.');
      }
    } catch (err: unknown) {
      console.error('Error saving answer:', err);
      setValidationNotice('Error de red al guardar la respuesta. Por favor intenta de nuevo.');
    } finally {
      setSavingAnswer(false);
    }
  };

  // Submit Autonomous Deepening Follow-up Answer
  const handleSaveAdaptive = async () => {
    if (!sessionData || !adaptiveQuestion) return;

    if (adaptivePhotos.length > 0) {
      const photoCheck = validatePhotoAttachments(adaptivePhotos);
      if (!photoCheck.valid) {
        setValidationNotice(photoCheck.error || 'Por favor describe la fotografía adjunta.');
        return;
      }
    }

    const trimmedAdaptive =
      adaptiveAnswerText.trim() ||
      (adaptiveAudio ? adaptiveAudio.transcription : '') ||
      (adaptivePhotos.length > 0
        ? adaptivePhotos.map((p) => p.caption.trim()).join('. ')
        : '');

    if (trimmedAdaptive.length === 0) {
      setValidationNotice(
        'Escribe una respuesta o graba una nota de voz para la profundización, o pulsa «Omitir profundización y avanzar».'
      );
      return;
    }

    try {
      setSavingAnswer(true);
      setValidationNotice(null);
      const parentId = adaptiveQuestion.parentQuestionId;
      const idempotencyKey = `adapt_${sessionData.participant.id}_${parentId}_${Date.now()}`;

      const res = await fetch('/api/participant/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: activeToken,
          questionId: `adapt_${parentId}_${Date.now()}`,
          questionText: adaptiveQuestion.text,
          answerText: trimmedAdaptive,
          notRecalled: false,
          isFollowUp: true,
          parentQuestionId: parentId,
          deepeningReason: adaptiveQuestion.reason,
          photos: adaptivePhotos,
          audio: adaptiveAudio || undefined,
          idempotencyKey,
        }),
      });

      const data = await res.json();
      if (data.success) {
        const updatedAnswers = [...sessionData.answers, data.data.answer];
        setSessionData({
          ...sessionData,
          interview: data.data.interview,
          answers: updatedAnswers,
        });

        setSaveSuccessNotice('Profundización guardada e integrada a tu historia.');
        setTimeout(() => setSaveSuccessNotice(null), 3000);

        // If the system generated a second autonomous deepening question (within maxFollowUps limit)
        if (data.data.adaptiveQuestion) {
          setAdaptiveQuestion({
            text: data.data.adaptiveQuestion.text,
            parentQuestionId: parentId,
            reason: data.data.adaptiveQuestion.reason,
            followUpIndex: data.data.adaptiveQuestion.followUpIndex,
            maxFollowUps: data.data.adaptiveQuestion.maxFollowUps,
          });
          setAdaptiveAnswerText('');
          setAdaptivePhotos([]);
        } else {
          setAdaptiveQuestion(null);
          setAdaptiveAnswerText('');
          setAdaptivePhotos([]);
          advanceInFlowAfterQuestion(parentId, updatedAnswers);
        }
      } else {
        setValidationNotice(data.error || 'Error al guardar la profundización.');
      }
    } catch (err) {
      console.error(err);
      setValidationNotice('Error de red al guardar la profundización.');
    } finally {
      setSavingAnswer(false);
    }
  };

  // Submit Free Additional Information ("Añadir Información Adicional")
  const handleSaveAdditionalMemory = async () => {
    if (!sessionData) return;
    setAdditionalModalError(null);

    if (additionalPhotos.length > 0) {
      const photoCheck = validatePhotoAttachments(additionalPhotos);
      if (!photoCheck.valid) {
        setAdditionalModalError(photoCheck.error || 'Por favor describe la fotografía adjunta.');
        return;
      }
    }

    const textToSave =
      additionalMemoryText.trim() ||
      (additionalAudio ? additionalAudio.transcription : '') ||
      (additionalPhotos.length > 0
        ? additionalPhotos.map((p) => p.caption.trim()).join('. ')
        : '');

    if (textToSave.length === 0) {
      setAdditionalModalError('Escribe un recuerdo, graba una nota de voz o adjunta una fotografía.');
      return;
    }

    try {
      setSavingAnswer(true);
      const idempotencyKey = `free_${sessionData.participant.id}_${Date.now()}`;

      const res = await fetch('/api/participant/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: activeToken,
          questionId: `free_memory_${Date.now()}`,
          questionText: 'Información adicional incorporada por el entrevistado',
          answerText: textToSave,
          notRecalled: false,
          isAdditionalMemory: true,
          photos: additionalPhotos,
          audio: additionalAudio || undefined,
          idempotencyKey,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setShowAdditionalMemoryModal(false);
        setAdditionalMemoryText('');
        setAdditionalPhotos([]);
        setAdditionalAudio(null);
        setAdditionalModalError(null);
        setSessionData({
          ...sessionData,
          interview: data.data.interview,
          answers: [...sessionData.answers, data.data.answer],
        });
        setSaveSuccessNotice(
          '¡Tu información adicional ha sido guardada e integrada permanentemente a tu legado!'
        );
        setTimeout(() => setSaveSuccessNotice(null), 4000);
      } else {
        setAdditionalModalError(data.error || 'No se pudo guardar la información adicional.');
      }
    } catch (err) {
      console.error(err);
      setAdditionalModalError('Error de red al guardar la información adicional.');
    } finally {
      setSavingAnswer(false);
    }
  };

  // Save Edit of Previous Answer
  const handleSaveEdit = async (answerId: string) => {
    if (!sessionData) return;
    const answer = sessionData.answers.find((a) => a.id === answerId);
    if (!answer) return;

    if (editPhotos.length > 0) {
      const photoCheck = validatePhotoAttachments(editPhotos);
      if (!photoCheck.valid) {
        setValidationNotice(photoCheck.error || 'Por favor describe la fotografía adjunta.');
        return;
      }
    }

    try {
      setSavingAnswer(true);
      setValidationNotice(null);
      const res = await fetch('/api/participant/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: activeToken,
          questionId: answer.questionId,
          questionText: answer.questionText,
          answerText: editMemoryText.trim(),
          notRecalled: false,
          photos: editPhotos,
          idempotencyKey: `edit_${answer.id}_${Date.now()}`,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setEditingAnswerId(null);
        const updated = sessionData.answers.map((a) => (a.id === answerId ? data.data.answer : a));
        setSessionData({ ...sessionData, answers: updated });
        setSaveSuccessNotice('Edición y fotografías actualizadas con éxito.');
        setTimeout(() => setSaveSuccessNotice(null), 3000);
      } else {
        setValidationNotice(data.error || 'No se pudo guardar la edición.');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSavingAnswer(false);
    }
  };

  // Voluntary Finish
  const handleFinishStory = async () => {
    if (!sessionData) return;
    try {
      setFinishing(true);
      const res = await fetch('/api/participant/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: activeToken,
          reason: finishReason.trim(),
        }),
      });

      const data = await res.json();
      if (data.success) {
        try {
          const rawIntCache = localStorage.getItem('foreveryou_interviews_cache');
          if (rawIntCache) {
            const parsedIntList = JSON.parse(rawIntCache);
            if (Array.isArray(parsedIntList)) {
              const nextIntList = parsedIntList.map((item: any) =>
                item && item.id === data.data.id ? { ...item, ...data.data } : item
              );
              localStorage.setItem('foreveryou_interviews_cache', JSON.stringify(nextIntList));
            }
          }
        } catch (_e) {
          // ignore localStorage write errors
        }
        setShowFinishModal(false);
        setShowCompletionScreen(true);
        setActiveTab('interview');
        setSessionData({
          ...sessionData,
          interview: data.data,
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setFinishing(false);
    }
  };

  // If no session loaded, show invitation token access screen
  if (!sessionData) {
    return (
      <div className="max-w-md mx-auto my-12 bg-white p-8 rounded-2xl border border-stone-200 shadow-md text-stone-800">
        <div className="w-12 h-12 bg-amber-100 text-amber-800 rounded-xl flex items-center justify-center mx-auto mb-4">
          <HeartHandshake className="w-6 h-6" />
        </div>
        <h2 className="font-serif text-xl font-bold text-center text-stone-900 mb-1">
          Bienvenido a tu Entrevista de Legado
        </h2>
        <p className="text-xs text-stone-500 text-center mb-6">
          Ingresa el código o token de invitación que recibiste por correo o mensaje para comenzar.
        </p>

        {logoutNotice && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 text-xs mb-4 flex items-start space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>{logoutNotice}</span>
          </div>
        )}

        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs mb-4 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (tokenInput.trim()) loadSession(tokenInput);
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1">
              Código de Acceso o Enlace de Invitación
            </label>
            <input
              type="text"
              required
              placeholder="Ej: LEG-8492 o pega tu enlace completo..."
              value={tokenInput}
              onChange={(e) => {
                const rawVal = e.target.value;
                if (rawVal.includes('token=') || rawVal.includes('code=') || /^c[oó]digo\s*:/i.test(rawVal.trim())) {
                  setTokenInput(extractCleanTokenOrCode(rawVal));
                } else {
                  setTokenInput(rawVal);
                }
              }}
              className="w-full px-3.5 py-2.5 border border-stone-300 rounded-lg text-xs font-mono text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-600 uppercase"
            />
            <p className="text-[11px] text-stone-400 mt-1.5">
              Puedes escribir el código de 6 u 8 caracteres (ej.{' '}
              <code className="bg-stone-100 text-stone-700 px-1 py-0.5 rounded font-bold">
                LEG-8492
              </code>
              ) o pegar el enlace completo que recibiste.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || !tokenInput.trim()}
            className="w-full py-2.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-semibold shadow-sm transition disabled:opacity-50"
          >
            {loading ? 'Verificando acceso...' : 'Entrar a la Entrevista'}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-stone-100 text-center">
          <button
            type="button"
            onClick={handleOpenFaq}
            className="inline-flex items-center space-x-1.5 text-xs text-amber-800 font-semibold hover:text-amber-900 transition cursor-pointer"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Preguntas Frecuentes &amp; Privacidad</span>
          </button>
        </div>
      </div>
    );
  }

  // Obligatory Single-Consent Privacy Gate: Participant must accept single consent before proceeding
  if (sessionData && !sessionData.hasValidConsent) {
    return (
      <div className="space-y-6">
        <PrivacyConsentScreen
          participantName={sessionData.participant.name}
          interviewTitle={sessionData.interview.title}
          onAccept={async () => {
            const res = await fetch('/api/participant/consent', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                token: activeToken,
                hasAcceptedSingleCheckbox: true,
              }),
            });
            const json = await res.json();
            if (!json.success) {
              throw new Error(json.error || 'No se pudo registrar el consentimiento en el servidor.');
            }
            setSessionData({
              ...sessionData,
              hasValidConsent: true,
              consent: json.data,
            });
          }}
        />
        <FAQModal isOpen={isFaqOpen} onClose={() => setIsFaqOpen(false)} />
      </div>
    );
  }

  const { interview, participant, questions, answers } = sessionData;
  const isInterviewOpen = interview.status === 'open' && !interview.userDeclaredComplete;
  const isExpired = new Date(interview.expiresAt).getTime() < Date.now();
  const myAdditionalMemories = myAnswers.filter((a) => a.isAdditionalMemory);
  const followUpsForCurrent = currentQuestion
    ? myAnswers.filter((a) => a.isFollowUp && a.parentQuestionId === currentQuestion.id)
    : [];

  // Other participants' answers for this question in shared mode
  const familyAnswersForCurrent =
    interview.storyMode === 'compartida' && currentQuestion
      ? answers.filter(
          (a) =>
            a.questionId === currentQuestion.id &&
            a.participantId !== participant.id &&
            !a.isFollowUp &&
            !a.isAdditionalMemory
        )
      : [];

  return (
    <div className="min-h-screen bg-stone-50/70 text-stone-900 flex flex-col">
      {/* 1. Compact Sticky Top Header: ForeverYou + Quick Icons + Single Gear Menu */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-stone-200/90 shadow-2xs">
        <div className="max-w-4xl mx-auto w-full px-3 sm:px-4 h-14 flex items-center justify-between gap-2">
          {/* Brand Wordmark & Story Context */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <span className="font-serif font-black text-amber-900 text-lg sm:text-xl tracking-tight shrink-0 select-none">
              ForeverYou
            </span>
            <span className="text-stone-300 hidden xs:inline select-none">|</span>
            <div className="min-w-0 hidden sm:block">
              <span className="text-xs font-semibold text-stone-800 truncate block max-w-xs" title={interview.title}>
                {interview.title}
              </span>
              <span className="text-[10px] text-stone-500 truncate block">
                {participant.name} ({participant.relationship})
              </span>
            </div>
          </div>

          {/* Quick Header Navigation & Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* If on History or Book tab, button to return to the interview */}
            {activeTab !== 'interview' && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab('interview');
                  setShowCompletionScreen(false);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 transition cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Volver al cuestionario</span>
              </button>
            )}

            {/* "Mis Respuestas" Button */}
            <button
              type="button"
              onClick={() => setActiveTab(activeTab === 'history' ? 'interview' : 'history')}
              title="Mis Respuestas Guardadas"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                activeTab === 'history'
                  ? 'bg-amber-800 text-white border-amber-900 shadow-2xs'
                  : 'bg-stone-50 hover:bg-stone-100 text-stone-700 border-stone-200'
              }`}
            >
              <MessageSquare className={`w-3.5 h-3.5 ${activeTab === 'history' ? 'text-white' : 'text-amber-700'}`} />
              <span className="hidden sm:inline">Mis Respuestas</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                activeTab === 'history' ? 'bg-amber-950 text-amber-100' : 'bg-amber-100 text-amber-900'
              }`}>
                {myAnswers.length}
              </span>
            </button>

            {/* "Mis Libros" Button (visible if book versions exist or interview closed) */}
            {(interview.userDeclaredComplete || (sessionData.bookVersions && sessionData.bookVersions.length > 0) || activeTab === 'book') && (
              <button
                type="button"
                onClick={() => setActiveTab(activeTab === 'book' ? 'interview' : 'book')}
                title="Mis Libros en PDF & Maquetación"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                  activeTab === 'book'
                    ? 'bg-amber-800 text-white border-amber-900 shadow-2xs'
                    : 'bg-stone-50 hover:bg-stone-100 text-stone-700 border-stone-200'
                }`}
              >
                <BookOpen className={`w-3.5 h-3.5 ${activeTab === 'book' ? 'text-white' : 'text-amber-700'}`} />
                <span className="hidden sm:inline">Mis Libros</span>
                {sessionData.bookVersions && sessionData.bookVersions.length > 0 && (
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    activeTab === 'book' ? 'bg-amber-950 text-amber-100' : 'bg-amber-100 text-amber-900'
                  }`}>
                    {sessionData.bookVersions.length}
                  </span>
                )}
              </button>
            )}

            {/* Single Gear Dropdown Menu: Settings, Privacy, FAQ, and Voluntary Finish */}
            <div className="relative" ref={gearMenuRef}>
              <button
                type="button"
                onClick={() => setIsGearMenuOpen(!isGearMenuOpen)}
                title="Ajustes y opciones de la entrevista"
                aria-label="Ajustes y opciones de la entrevista"
                className="p-2 rounded-lg text-stone-700 hover:text-stone-900 hover:bg-stone-100 border border-stone-200 transition cursor-pointer"
              >
                <Settings className="w-4 h-4 text-stone-600" />
              </button>

              {isGearMenuOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-stone-200 py-1.5 z-50 text-xs">
                  <div className="px-3.5 py-2 border-b border-stone-100 bg-stone-50/60 rounded-t-xl">
                    <div className="font-semibold text-stone-900 truncate">{participant.name}</div>
                    <div className="text-[11px] text-stone-500 mt-0.5">
                      <span>Progreso de tu historia: <strong>{progressPercent}%</strong></span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setIsGearMenuOpen(false);
                      setIsParticipantAdminOpen(true);
                    }}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-amber-50 text-stone-700 hover:text-amber-900 flex items-center gap-2.5 transition cursor-pointer"
                  >
                    <Settings className="w-3.5 h-3.5 text-stone-500" />
                    <span>Ajustes del Portal</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsGearMenuOpen(false);
                      setIsParticipantAdminOpen(true);
                    }}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-amber-50 text-stone-700 hover:text-amber-900 flex items-center gap-2.5 transition cursor-pointer"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Ajustes y Privacidad</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsGearMenuOpen(false);
                      setIsFaqOpen(true);
                    }}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-amber-50 text-stone-700 hover:text-amber-900 flex items-center gap-2.5 transition cursor-pointer"
                  >
                    <HelpCircle className="w-3.5 h-3.5 text-stone-500" />
                    <span>Preguntas Frecuentes y Ayuda</span>
                  </button>

                  {/* Separated Voluntary Finish action */}
                  {isInterviewOpen && (
                    <>
                      <div className="border-t border-stone-100 my-1"></div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsGearMenuOpen(false);
                          setShowFinishModal(true);
                        }}
                        className="w-full text-left px-3.5 py-2.5 hover:bg-amber-50 text-amber-950 font-semibold flex items-center gap-2.5 transition cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>He terminado mi historia</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Subtle Hairline Progress Bar */}
        <div
          className="w-full h-1 bg-stone-200/80 relative overflow-hidden"
          title={`Progreso: ${progressPercent}%`}
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full bg-gradient-to-r from-amber-600 via-amber-700 to-amber-800 transition-all duration-700 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </header>

      {/* Global Feedback Notices */}
      <div className="max-w-2xl mx-auto w-full px-4 pt-3 space-y-2">
        {flowTransitionNotice && (
          <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-amber-950 text-xs flex items-center space-x-2.5 shadow-2xs">
            <GitBranch className="w-4 h-4 text-amber-700 shrink-0" />
            <span className="font-medium">{flowTransitionNotice}</span>
          </div>
        )}

        {saveSuccessNotice && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs flex items-center space-x-2 shadow-2xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-medium">{saveSuccessNotice}</span>
          </div>
        )}

        {/* Notice Banner: Reopened Interview for Questionnaire & Book Editing */}
        {interview.status === 'open' && !interview.userDeclaredComplete && interview.reopenedAt && (
          <div className="p-3.5 bg-gradient-to-r from-amber-50 to-stone-50 border border-amber-300 rounded-xl text-amber-950 text-xs shadow-2xs flex items-start space-x-3">
            <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center shrink-0 text-amber-800 mt-0.5">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <div className="space-y-1">
              <div className="font-bold text-amber-900 text-xs sm:text-sm">
                Cuestionario Reabierto para Edición Completa
              </div>
              <p className="text-amber-800 text-[11px] sm:text-xs leading-relaxed">
                Tu entrevista está reabierta para que puedas revisar y editar tus respuestas o notas de voz. Puedes navegar pregunta a pregunta o consultar tu historial desde <strong>«Mis Respuestas»</strong>. Al terminar, confirma el cierre para generar una nueva versión de tu libro PDF.
              </p>
            </div>
          </div>
        )}

        {isExpired && !interview.userDeclaredComplete && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 text-xs flex items-start space-x-2.5">
            <Lock className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold block">Periodo de apertura vencido</span>
              <p className="text-[11px] mt-0.5 text-rose-800">
                El plazo fijado ha vencido. Tus respuestas están protegidas. Puedes solicitar al administrador una extensión si necesitas añadir más recuerdos.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Main Container */}
      {(activeTab === 'interview' || activeTab === 'book') && (
        <div className="flex-1 flex flex-col">
          {interview.userDeclaredComplete || activeTab === 'book' ? (
            <div className="max-w-4xl mx-auto w-full px-4 pt-4 pb-12">
              <ParticipantBookStudio
                token={activeToken}
                interview={interview}
                participant={participant}
                otherParticipants={sessionData.otherParticipants}
                answers={answers}
                questions={questions}
                bookVersions={sessionData.bookVersions || []}
                onBookVersionSaved={({ interview: updatedInterview, allVersions }) => {
                  setSessionData((prev) =>
                    prev
                      ? {
                          ...prev,
                          interview: updatedInterview,
                          bookVersions: allVersions,
                        }
                      : prev
                  );
                }}
                onViewReadOnlyAnswers={() => setActiveTab('history')}
              />
            </div>
          ) : showCompletionScreen ? (
            /* END OF INSTRUMENT COMPLETION VIEW (BEFORE VOLUNTARY CLOSURE) */
            <div className="max-w-2xl mx-auto w-full px-4 pt-6 pb-12">
              <div className="bg-white p-8 rounded-2xl border border-emerald-200 shadow-sm space-y-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-8 h-8" />
                </div>

                <div className="max-w-xl mx-auto space-y-2">
                  <span className="inline-block px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold uppercase tracking-wide">
                    Cuestionario Completado
                  </span>
                  <h3 className="font-serif text-2xl font-bold text-stone-900">
                    ¡Has completado todas las preguntas del instrumento!
                  </h3>
                  <p className="text-sm text-stone-600 leading-relaxed">
                    Ya has completado el recorrido del cuestionario biográfico. Si lo deseas, puedes incorporar información adicional dando clic en <strong>«Añadir Información Adicional»</strong>, o bien confirmar el cierre definitivo para pasar a las <strong>opciones de maquetación editorial y descargar tu libro en PDF</strong>.
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                  {sessionData.allowAdditionalMemories && isInterviewOpen && !isExpired && (
                    <button
                      type="button"
                      onClick={() => setShowAdditionalMemoryModal(true)}
                      className="inline-flex items-center space-x-2 px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-xs transition cursor-pointer"
                    >
                      <PlusCircle className="w-4 h-4" />
                      <span>Añadir Información Adicional</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowCompletionScreen(false)}
                    className="inline-flex items-center space-x-1.5 px-4 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Revisar Preguntas del Cuestionario</span>
                  </button>

                  {isInterviewOpen && (
                    <button
                      type="button"
                      onClick={() => setShowFinishModal(true)}
                      className="inline-flex items-center space-x-1.5 px-5 py-2.5 bg-amber-700 hover:bg-amber-800 text-white rounded-xl text-xs sm:text-sm font-semibold transition shadow-xs cursor-pointer"
                    >
                      <BookOpen className="w-4 h-4" />
                      <span>Confirmar Cierre y Maquetar Mi Libro</span>
                    </button>
                  )}
                </div>

                {/* List of Additional Information already added */}
                {myAdditionalMemories.length > 0 && (
                  <div className="pt-6 border-t border-stone-200 text-left space-y-3">
                    <h4 className="font-serif text-sm font-bold text-stone-800">
                      Información Adicional Incorporada ({myAdditionalMemories.length})
                    </h4>
                    <div className="space-y-2">
                      {myAdditionalMemories.map((mem) => (
                        <div
                          key={mem.id}
                          className="p-3.5 bg-stone-50 rounded-xl border border-stone-200 text-xs text-stone-800"
                        >
                          <div className="text-[10px] text-stone-400 mb-1">
                            Agregado el {new Date(mem.createdAt).toLocaleString('es-MX')}
                          </div>
                          <p className="italic">«{mem.answerText}»</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : currentQuestion ? (
            /* 2. MAIN INTERVIEW ZONE (Zero scroll mobile layout: Question + Protagonist Mic) */
            <main className="flex-1 max-w-2xl mx-auto w-full px-4 pt-3 sm:pt-5 pb-28 sm:pb-32 space-y-4 sm:space-y-5">
              {/* Sub-flow Active Banner */}
              {currentFlowItem?.isSubFlow && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-950">
                  <div className="flex items-center space-x-2">
                    <GitBranch className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>
                      <strong>Sub-flujo: «{currentFlowItem.flowId}»</strong> (Paso{' '}
                      {currentFlowItem.subFlowStepIndex} de {currentFlowItem.subFlowTotalSteps})
                    </span>
                  </div>
                  <span className="text-[11px] text-emerald-700 font-medium">
                    Retornará al hilo principal
                  </span>
                </div>
              )}

              {/* Stage Kicker & Progress Percentage */}
              <div className="text-center">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100/80 text-amber-900 border border-amber-200/70 tracking-wide uppercase">
                  <span>Etapa: {currentQuestion.lifeStage.replace(/_/g, ' ')}</span>
                  <span className="text-amber-400">•</span>
                  <span>{progressPercent}% de avance</span>
                </span>
              </div>

              {/* Prominent Question Heading */}
              <h1 className="font-serif text-2xl sm:text-3xl font-bold text-stone-900 leading-snug tracking-tight text-center text-balance px-2">
                {currentQuestion.text}
              </h1>

              {/* Gateway Branch Selector (if question can jump to a sub-flow like 'hijos') */}
              {currentQuestion.branchConfig?.enabled &&
                currentQuestion.branchConfig.targetFlowId &&
                isInterviewOpen &&
                !adaptiveQuestion && (
                  <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-xl space-y-2">
                    <div className="text-xs font-semibold text-stone-800 flex items-center space-x-1.5">
                      <GitBranch className="w-3.5 h-3.5 text-amber-700" />
                      <span>
                        Selección para{' '}
                        <strong>
                          {currentQuestion.branchConfig.branchLabel ||
                            `Flujo de ${currentQuestion.branchConfig.targetFlowId}`}
                        </strong>
                        :
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setBranchChoice('yes')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                          branchChoice === 'yes'
                            ? 'bg-amber-700 text-white border-amber-800 shadow-2xs'
                            : 'bg-white text-stone-700 border-stone-300 hover:border-amber-400'
                        }`}
                      >
                        ✓ Sí aplica a mi historia
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setBranchChoice('no');
                          if (!currentAnswerText.trim()) {
                            setCurrentAnswerText('No aplica a mi historia.');
                          }
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                          branchChoice === 'no'
                            ? 'bg-stone-800 text-white border-stone-900 shadow-2xs'
                            : 'bg-white text-stone-700 border-stone-300 hover:border-stone-400'
                        }`}
                      >
                        ✕ No aplica a mi historia
                      </button>
                    </div>
                  </div>
                )}

              {/* In shared story: Show family contributions for this question */}
              {familyAnswersForCurrent.length > 0 && (
                <div className="p-3.5 bg-amber-50/70 border border-amber-200/80 rounded-xl space-y-2">
                  <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wide flex items-center space-x-1.5">
                    <HeartHandshake className="w-3.5 h-3.5" />
                    <span>Recuerdos compartidos por tu familia</span>
                  </h4>
                  <div className="space-y-1.5">
                    {familyAnswersForCurrent.map((fa) => (
                      <div
                        key={fa.id}
                        className="bg-white p-2.5 rounded-lg border border-amber-100 text-xs"
                      >
                        <span className="font-semibold text-stone-900 block mb-0.5">
                          {fa.participantName}:
                        </span>
                        <p className="text-stone-700 italic">
                          {fa.notRecalled ? '«No lo recuerdo»' : `"${fa.answerText}"`}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 3. HERO PROTAGONIST VOICE RECORDER (Centered, large circular button, no extra card) */}
              <div className="pt-1 pb-1">
                <VoiceRecorder
                  ref={voiceRecorderRef}
                  token={activeToken}
                  questionId={currentQuestion.id}
                  questionText={currentQuestion.text}
                  initialAudio={currentAudio}
                  initialAudios={currentAudios}
                  hideSavedList={true}
                  frameless={true}
                  onFocusKeyboard={() => {
                    setIsTextareaExpanded(true);
                    setTimeout(() => {
                      answerTextareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      answerTextareaRef.current?.focus();
                    }, 100);
                  }}
                  onVoiceSubmitted={(audio, transcription, allAudios, diagnosis) => {
                    setCurrentAudios(allAudios);
                    const cleanTranscript = (transcription || '').trim();
                    if (cleanTranscript.length > 0) {
                      setCurrentAnswerText((prev) => {
                        const cleanPrev = prev.trim();
                        if (!cleanPrev || cleanPrev === 'No aplica a mi historia.') {
                          return cleanTranscript;
                        }
                        if (cleanPrev.includes(cleanTranscript)) {
                          return cleanPrev;
                        }
                        return `${cleanPrev}\n\n[Nota de voz]: ${cleanTranscript}`;
                      });
                      if (diagnosis?.audioQuality !== 'noisy') {
                        setSaveSuccessNotice(
                          'Archivo de voz y transcripción guardados con éxito.'
                        );
                        setTimeout(() => setSaveSuccessNotice(null), 3500);
                      }
                    }
                  }}
                  onVoiceDeleted={(delId) => {
                    setCurrentAudios((prev) => prev.filter((a) => a.id !== delId));
                  }}
                  disabled={!isInterviewOpen || Boolean(adaptiveQuestion)}
                />
              </div>

              {/* 4. Alternative to answer by typing (Collapsible / Expandable) */}
              {!isTextareaExpanded && !currentAnswerText.trim() ? (
                <div className="text-center pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setIsTextareaExpanded(true);
                      setTimeout(() => answerTextareaRef.current?.focus(), 100);
                    }}
                    className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs text-stone-600 hover:text-amber-900 hover:bg-stone-100 rounded-lg transition font-medium cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-stone-400" />
                    <span>O si lo prefieres, escribe tu respuesta con el teclado</span>
                  </button>
                </div>
              ) : (
                <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-stone-200/90 shadow-2xs space-y-2 transition-all">
                  <div className="flex items-center justify-between text-xs text-stone-600">
                    <span className="font-semibold text-stone-800 flex items-center gap-1.5">
                      <Edit3 className="w-3.5 h-3.5 text-amber-700" />
                      <span>Tu recuerdo o testimonio personal:</span>
                    </span>
                    {!currentAnswerText.trim() && (
                      <button
                        type="button"
                        onClick={() => setIsTextareaExpanded(false)}
                        className="text-[11px] text-stone-400 hover:text-stone-600 cursor-pointer"
                      >
                        Ocultar teclado
                      </button>
                    )}
                  </div>
                  <textarea
                    ref={answerTextareaRef}
                    rows={4}
                    disabled={!isInterviewOpen || Boolean(adaptiveQuestion)}
                    placeholder={
                      isInterviewOpen
                        ? 'Escribe aquí con tus propias palabras lo que venga a tu memoria...'
                        : 'La entrevista no está abierta para nuevas respuestas.'
                    }
                    value={currentAnswerText}
                    onChange={(e) => setCurrentAnswerText(e.target.value)}
                    className="w-full p-3 border border-stone-300 rounded-xl text-stone-900 text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-600 leading-relaxed font-sans disabled:bg-stone-50"
                  />
                </div>
              )}

              {/* 5. Compact Options for Attaching Photos and Additional Memories */}
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowPhotoSection(!showPhotoSection)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                    showPhotoSection || currentPhotos.length > 0
                      ? 'bg-amber-50 text-amber-900 border-amber-300 shadow-2xs'
                      : 'bg-white text-stone-700 border-stone-300 hover:bg-stone-50'
                  }`}
                >
                  <Camera className="w-3.5 h-3.5 text-amber-700" />
                  <span>
                    {currentPhotos.length > 0
                      ? `Fotografías adjuntas (${currentPhotos.length})`
                      : 'Añadir fotografía'}
                  </span>
                </button>

                {sessionData.allowAdditionalMemories && isInterviewOpen && !isExpired && (
                  <button
                    type="button"
                    onClick={() => setShowAdditionalMemoryModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-stone-700 border border-stone-300 hover:bg-stone-50 transition cursor-pointer"
                  >
                    <PlusCircle className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Añadir información adicional</span>
                  </button>
                )}
              </div>

              {/* Photo section uploader (toggled or if photos already attached) */}
              {(showPhotoSection || currentPhotos.length > 0) && (
                <div className="bg-white p-3.5 rounded-xl border border-stone-200/90 shadow-2xs">
                  <QuestionPhotoUploader
                    key={`photo_${currentQuestion.id}`}
                    photos={currentPhotos}
                    onChange={(updated) => {
                      setCurrentPhotos(updated);
                      if (validationNotice) setValidationNotice(null);
                    }}
                    onDeletePersistedPhoto={handleDeletePersistedPhoto}
                    disabled={!isInterviewOpen || Boolean(adaptiveQuestion)}
                    compact={true}
                    label="Fotografías o Recuerdos Visuales (Opcional)"
                  />
                </div>
              )}

              {/* Saved voice audios with transcriptions */}
              {currentAudios && currentAudios.length > 0 && (
                <SavedVoiceAudiosList
                  key={`audio_${currentQuestion.id}`}
                  audios={currentAudios}
                  disabled={!isInterviewOpen || Boolean(adaptiveQuestion)}
                  onDelete={handleDeletePersistedVoiceAudio}
                />
              )}

              {validationNotice && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{validationNotice}</span>
                </div>
              )}

              {/* Previous follow-ups answered for this question */}
              {followUpsForCurrent.length > 0 && !adaptiveQuestion && (
                <div className="p-3.5 bg-stone-50 rounded-xl border border-stone-200 space-y-2">
                  <div className="text-[11px] font-bold text-stone-600 uppercase tracking-wide flex items-center space-x-1">
                    <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                    <span>
                      Profundizaciones respondidas en esta pregunta ({followUpsForCurrent.length})
                    </span>
                  </div>
                  {followUpsForCurrent.map((fu) => (
                    <div key={fu.id} className="text-xs bg-white p-2.5 rounded-lg border border-stone-200">
                      <div className="font-serif font-semibold text-amber-900">
                        {fu.questionText || 'Pregunta de profundización'}
                      </div>
                      <p className="text-stone-700 italic mt-0.5">«{fu.answerText}»</p>
                    </div>
                  ))}
                </div>
              )}

              {/* 6. FIXED BOTTOM ACTION BAR (Omitir y continuar secondary, Guardar y continuar primary) */}
              {isInterviewOpen && !adaptiveQuestion && (
                <div className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-stone-200/90 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] px-3 sm:px-4 py-2.5 sm:py-3">
                  <div className="max-w-2xl mx-auto flex items-center justify-between gap-2 sm:gap-4">
                    {/* Secondary Action: Omitir y continuar */}
                    <button
                      type="button"
                      onClick={() => handleSaveAnswer(true, 'no')}
                      disabled={savingAnswer}
                      title="Esta acción te permite avanzar a la siguiente pregunta respetando tu ritmo y sin forzar el recuerdo"
                      className="px-3.5 sm:px-4 py-2.5 rounded-xl border border-stone-300 text-stone-700 hover:bg-stone-100 font-semibold text-xs sm:text-sm transition cursor-pointer disabled:opacity-40"
                    >
                      « Omitir y continuar
                    </button>

                    {/* Step Navigation Arrows */}
                    <div className="flex items-center gap-1 text-stone-500">
                      <button
                        type="button"
                        aria-label="Pregunta anterior"
                        disabled={currentIndex === 0}
                        onClick={() => {
                          const prevItem = flowSequence[Math.max(0, currentIndex - 1)];
                          if (prevItem) setCurrentQuestionId(prevItem.question.id);
                        }}
                        className="p-2 border border-stone-200 text-stone-600 rounded-lg hover:bg-stone-100 disabled:opacity-30 transition cursor-pointer"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>

                      <span
                        className="text-xs font-semibold text-stone-600 px-1.5"
                        title={`Avance de tu historia: ${progressPercent}%`}
                      >
                        {progressPercent}%
                      </span>

                      <button
                        type="button"
                        aria-label="Siguiente pregunta"
                        onClick={() => {
                          if (currentIndex < flowSequence.length - 1) {
                            const nextItem = flowSequence[currentIndex + 1];
                            if (nextItem) setCurrentQuestionId(nextItem.question.id);
                          } else {
                            setShowCompletionScreen(true);
                          }
                        }}
                        className="p-2 border border-stone-200 text-stone-600 rounded-lg hover:bg-stone-100 transition cursor-pointer"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Primary Action: Guardar y Continuar (Featured ForeverYou styling) */}
                    <button
                      type="button"
                      onClick={() => handleSaveAnswer(false)}
                      disabled={savingAnswer}
                      className="inline-flex items-center gap-1.5 sm:gap-2 px-5 sm:px-6 py-2.5 sm:py-3 bg-gradient-to-r from-amber-700 via-amber-800 to-amber-900 hover:from-amber-800 hover:to-amber-950 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md hover:shadow-lg transition cursor-pointer disabled:opacity-50"
                    >
                      <Save className="w-4 h-4" />
                      <span>{savingAnswer ? 'Guardando...' : 'Guardar y Continuar »'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Autonomous Deepening Question Card (generated automatically by the system from the participant's answer) */}
              {adaptiveQuestion && isInterviewOpen && (
                <div className="mt-4 p-6 bg-amber-50/90 rounded-2xl border-2 border-amber-300 shadow-sm space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center space-x-2 text-amber-950">
                      <Sparkles className="w-4 h-4 text-amber-700" />
                      <span className="font-serif font-bold text-sm">
                        Pregunta Autónoma de Profundización ({adaptiveQuestion.followUpIndex || 1}{' '}
                        de {adaptiveQuestion.maxFollowUps || interview.maxFollowUpsAtCreation})
                      </span>
                    </div>
                    <span className="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-semibold">
                      Generada por el sistema a partir de tu respuesta
                    </span>
                  </div>

                  {adaptiveQuestion.reason && (
                    <p className="text-xs text-amber-900 bg-white/80 px-3 py-2 rounded-lg border border-amber-200/80">
                      <strong>Aspecto relevante detectado:</strong> {adaptiveQuestion.reason}
                    </p>
                  )}

                  <p className="font-serif text-lg text-stone-900 font-bold leading-snug">
                    «{adaptiveQuestion.text}»
                  </p>

                  <textarea
                    ref={adaptiveTextareaRef}
                    rows={4}
                    placeholder="Profundiza en este recuerdo con los detalles, emociones o anécdotas que desees compartir..."
                    value={adaptiveAnswerText}
                    onChange={(e) => setAdaptiveAnswerText(e.target.value)}
                    className="w-full p-3.5 border border-amber-300 bg-white rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-300"
                  />

                  {/* Voice recording for adaptive deepening question */}
                  <VoiceRecorder
                    token={activeToken}
                    questionId={`adapt_${adaptiveQuestion.parentQuestionId}`}
                    questionText={adaptiveQuestion.text}
                    initialAudio={adaptiveAudio}
                    onFocusKeyboard={() => {
                      adaptiveTextareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      adaptiveTextareaRef.current?.focus();
                    }}
                    onVoiceSubmitted={(audio, transcription, _allAudios, diagnosis) => {
                      setAdaptiveAudio(audio);
                      const cleanTranscript = (transcription || '').trim();
                      if (cleanTranscript.length > 0) {
                        setAdaptiveAnswerText((prev) => {
                          const cleanPrev = prev.trim();
                          if (!cleanPrev) return cleanTranscript;
                          return `${cleanPrev}\n\n[Nota de voz]: ${cleanTranscript}`;
                        });
                        if (diagnosis?.audioQuality !== 'noisy') {
                          setSaveSuccessNotice(
                            'Archivo de voz para profundización guardado con éxito en la base de datos.'
                          );
                          setTimeout(() => setSaveSuccessNotice(null), 3500);
                        }
                      }
                    }}
                    onVoiceDeleted={(_id) => setAdaptiveAudio(null)}
                  />

                  <QuestionPhotoUploader
                    photos={adaptivePhotos}
                    onChange={(updated) => {
                      setAdaptivePhotos(updated);
                      if (validationNotice) setValidationNotice(null);
                    }}
                    onDeletePersistedPhoto={handleDeletePersistedPhoto}
                    compact
                    label="Fotografías relacionadas con esta profundización (Opcional)"
                  />

                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        const parentId = adaptiveQuestion.parentQuestionId;
                        setAdaptiveQuestion(null);
                        setAdaptiveAnswerText('');
                        setAdaptivePhotos([]);
                        advanceInFlowAfterQuestion(parentId, sessionData.answers);
                      }}
                      className="px-3.5 py-2 text-stone-600 hover:text-stone-900 bg-white border border-stone-300 rounded-lg text-xs font-medium"
                    >
                      Omitir profundización y avanzar
                    </button>

                    <button
                      type="button"
                      onClick={handleSaveAdaptive}
                      disabled={savingAnswer}
                      className="inline-flex items-center space-x-1.5 px-5 py-2 bg-amber-800 hover:bg-amber-900 text-white rounded-lg text-xs font-semibold shadow-xs disabled:opacity-50"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>
                        {savingAnswer ? 'Guardando...' : 'Guardar Profundización y Continuar'}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </main>
          ) : (
            <div className="bg-white p-8 rounded-xl text-center text-stone-500">
              No hay preguntas configuradas.
            </div>
          )}
        </div>
      )}

      {/* Tab: History and Editing */}
      {activeTab === 'history' && (
        <div className="max-w-4xl mx-auto w-full px-4 pt-4 pb-12 space-y-4">
          {interview.userDeclaredComplete && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-950 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start space-x-2.5">
                <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block text-stone-900">
                    Respuestas en modo de solo lectura (Entrevista cerrada)
                  </span>
                  <p className="text-stone-600 mt-0.5">
                    Has confirmado el cierre de tu historia. Puedes consultar todas tus respuestas y fotografías, pero no es posible añadir ni modificar respuestas.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('interview')}
                className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-amber-800 hover:bg-amber-900 text-white rounded-lg text-xs font-semibold transition shrink-0 self-start sm:self-center"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Volver a Mi Libro &amp; Maquetación</span>
              </button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="font-serif text-lg font-bold text-stone-900">
                Tus Respuestas, Profundizaciones e Información Adicional
              </h3>
              <p className="text-xs text-stone-500">
                {interview.userDeclaredComplete
                  ? 'Consulta de tus respuestas registradas. La adición o modificación de respuestas está bloqueada tras el cierre.'
                  : sessionData.allowAnswerEditing
                  ? 'Puedes revisar y editar cualquiera de tus aportes. Las ediciones no incrementan el contador de preguntas.'
                  : 'La edición de respuestas anteriores está deshabilitada en la configuración.'}
              </p>
            </div>

            {isInterviewOpen && !isExpired && (
              <button
                type="button"
                onClick={() => setShowAdditionalMemoryModal(true)}
                className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold transition self-start"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Añadir Información Adicional</span>
              </button>
            )}
          </div>

          {myAnswers.length === 0 ? (
            <div className="bg-white p-8 rounded-xl text-center text-stone-500 border border-stone-200">
              Aún no has guardado respuestas en esta entrevista.
            </div>
          ) : (
            myAnswers.map((ans) => {
              const q = questions.find((item) => item.id === ans.questionId);
              const isEditing = editingAnswerId === ans.id;
              const displayQuestion =
                ans.questionText ||
                q?.text ||
                (ans.isAdditionalMemory
                  ? 'Información Adicional Incorporada'
                  : 'Pregunta Autónoma de Profundización');

              return (
                <div
                  key={ans.id}
                  className="bg-white p-5 rounded-xl border border-stone-200 shadow-sm space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
                    <div className="flex items-center space-x-2">
                      {ans.isFollowUp && (
                        <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-semibold">
                          Profundización Autónoma
                        </span>
                      )}
                      {ans.isAdditionalMemory && (
                        <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 text-[10px] font-semibold">
                          Información Adicional
                        </span>
                      )}
                      {q?.flowId && q.flowId !== 'principal' && (
                        <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-700 text-[10px] font-semibold">
                          Sub-flujo: {q.flowId}
                        </span>
                      )}
                      <span className="font-medium text-amber-900 font-serif">
                        {displayQuestion}
                      </span>
                    </div>
                    <span>{new Date(ans.createdAt).toLocaleDateString('es-MX')}</span>
                  </div>

                  {isEditing ? (
                    <div className="space-y-3">
                      <textarea
                        rows={4}
                        value={editMemoryText}
                        onChange={(e) => setEditMemoryText(e.target.value)}
                        className="w-full p-3 border border-amber-300 rounded-lg text-xs text-stone-900"
                      />
                      <QuestionPhotoUploader
                        photos={editPhotos}
                        onChange={(updated) => {
                          setEditPhotos(updated);
                          if (validationNotice) setValidationNotice(null);
                        }}
                        onDeletePersistedPhoto={handleDeletePersistedPhoto}
                        compact
                        label="Fotografías de esta respuesta (Opcional)"
                      />
                      {validationNotice && (
                        <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-center space-x-2">
                          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                          <span>{validationNotice}</span>
                        </div>
                      )}
                      <div className="flex justify-end space-x-2">
                        <button
                          type="button"
                          onClick={() => setEditingAnswerId(null)}
                          className="px-3 py-1.5 border border-stone-300 text-stone-700 rounded-lg text-xs"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(ans.id)}
                          className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-semibold"
                        >
                          Guardar Edición
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs text-stone-800 leading-relaxed italic">
                        {ans.notRecalled
                          ? '«El participante indicó: Omitir y continuar»'
                          : ans.answerText}
                      </p>

                      {/* Display attached voice recording if present */}
                      {ans.audio && (
                        <AudioPlayer
                          audioUrl={ans.audio.audioUrl}
                          durationSeconds={ans.audio.durationSeconds}
                          transcription={ans.audio.transcription}
                          title="Nota de voz guardada en la base de datos"
                        />
                      )}

                      {/* Display attached photographs with context and direct delete option */}
                      {ans.photos && ans.photos.length > 0 && (
                        <div className="pt-2 border-t border-stone-100 space-y-2">
                          <div className="text-[11px] font-bold text-stone-600 flex items-center space-x-1.5">
                            <Camera className="w-3.5 h-3.5 text-amber-700" />
                            <span>
                              Fotografías adjuntas a esta pregunta ({ans.photos.length})
                            </span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {ans.photos.map((photo) => (
                              <div
                                key={photo.id}
                                className="flex items-start space-x-3 p-2.5 rounded-xl bg-stone-50 border border-stone-200"
                              >
                                <img
                                  src={photo.imageUrl || `/api/photos/${photo.id}`}
                                  alt={photo.caption}
                                  className="w-16 h-16 rounded-lg object-cover border border-stone-200 shrink-0 bg-white"
                                />
                                <div className="flex-1 min-w-0 space-y-1">
                                  <p className="text-[11px] text-stone-800 font-medium leading-snug">
                                    «{photo.caption}»
                                  </p>
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-stone-400 truncate">
                                      {photo.fileName}
                                    </span>
                                    {isInterviewOpen && (
                                      <button
                                        type="button"
                                        onClick={() => handleDeletePersistedPhoto(photo.id)}
                                        aria-label={`Eliminar fotografía ${photo.fileName}`}
                                        className="inline-flex items-center space-x-1 text-[10px] text-rose-700 hover:text-rose-900 font-semibold"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                        <span>Eliminar</span>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {sessionData.allowAnswerEditing && isInterviewOpen && (
                        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-stone-100">
                          {flowSequence.some((item) => item.question.id === ans.questionId) && (
                            <button
                              type="button"
                              onClick={() => {
                                setCurrentQuestionId(ans.questionId);
                                setShowCompletionScreen(false);
                                setActiveTab('interview');
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-xs font-semibold transition"
                            >
                              <Edit3 className="w-3.5 h-3.5 text-amber-700" />
                              <span>Editar en el cuestionario paso a paso</span>
                            </button>
                          )}

                          {!ans.notRecalled && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingAnswerId(ans.id);
                                setEditMemoryText(ans.answerText);
                                setEditPhotos(mapAttachmentsToDraftItems(ans.photos));
                                setValidationNotice(null);
                              }}
                              className="inline-flex items-center space-x-1 px-3 py-1.5 text-xs text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition"
                            >
                              <Edit3 className="w-3 h-3 text-stone-400" />
                              <span>Edición rápida aquí</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Modal: Añadir Información Adicional */}
      {showAdditionalMemoryModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-xl w-full p-6 shadow-2xl border border-stone-200 space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="font-serif text-lg font-bold text-stone-900">
              Añadir Información Adicional
            </h3>
            <p className="text-xs text-stone-500">
              Incorpora cualquier anécdota, reflexión, nombre, fecha, recuerdo o fotografía adicional que desees integrar a tu manuscrito biográfico.
            </p>

            <textarea
              ref={additionalTextareaRef}
              rows={4}
              placeholder="Escribe aquí la información adicional que deseas incorporar..."
              value={additionalMemoryText}
              onChange={(e) => setAdditionalMemoryText(e.target.value)}
              className="w-full p-3 border border-stone-300 rounded-lg text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-200"
            />

            {/* Voice recording for additional information */}
            <VoiceRecorder
              token={activeToken}
              questionId={`free_info_${Date.now()}`}
              questionText="Información adicional incorporada por el entrevistado"
              initialAudio={additionalAudio}
              onFocusKeyboard={() => {
                additionalTextareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                additionalTextareaRef.current?.focus();
              }}
              onVoiceSubmitted={(audio, transcription, _allAudios, diagnosis) => {
                setAdditionalAudio(audio);
                const cleanTranscript = (transcription || '').trim();
                if (cleanTranscript.length > 0) {
                  setAdditionalMemoryText((prev) => {
                    const cleanPrev = prev.trim();
                    if (!cleanPrev) return cleanTranscript;
                    return `${cleanPrev}\n\n[Nota de voz]: ${cleanTranscript}`;
                  });
                  if (diagnosis?.audioQuality !== 'noisy') {
                    setSaveSuccessNotice(
                      'Archivo de voz para información adicional guardado en la base de datos.'
                    );
                    setTimeout(() => setSaveSuccessNotice(null), 3500);
                  }
                }
              }}
              onVoiceDeleted={(_id) => setAdditionalAudio(null)}
            />

            <QuestionPhotoUploader
              photos={additionalPhotos}
              onChange={(updated) => {
                setAdditionalPhotos(updated);
                if (additionalModalError) setAdditionalModalError(null);
              }}
              onDeletePersistedPhoto={handleDeletePersistedPhoto}
              compact
              label="Fotografías adicionales para tu legado (Opcional)"
            />

            {additionalModalError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{additionalModalError}</span>
              </div>
            )}

            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => {
                  setShowAdditionalMemoryModal(false);
                  setAdditionalModalError(null);
                }}
                className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveAdditionalMemory}
                disabled={
                  savingAnswer ||
                  (!additionalMemoryText.trim() && additionalPhotos.length === 0)
                }
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
              >
                {savingAnswer ? 'Guardando...' : 'Guardar Información Adicional'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Explicit Voluntary Finish ("He terminado mi historia") */}
      {showFinishModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center mx-auto">
              <Check className="w-5 h-5" />
            </div>
            <h3 className="font-serif text-lg font-bold text-stone-900 text-center">
              ¿Deseas dar por terminada tu historia y pasar a la maquetación de tu libro?
            </h3>
            <p className="text-xs text-stone-600 leading-relaxed text-center">
              Al confirmar el cierre de tu entrevista, tus respuestas quedarán guardadas en <strong>modo de solo lectura</strong> (podrás verlas en cualquier momento, pero ya no añadir ni modificar respuestas) y el sistema abrirá las <strong>opciones de maquetación editorial</strong> para generar y descargar tu libro en PDF.
            </p>

            <div>
              <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                Dedicatoria o motivo de cierre (opcional):
              </label>
              <textarea
                rows={2}
                placeholder="Ej. Dedicado a mis hijos y nietos con todo mi amor..."
                value={finishReason}
                onChange={(e) => setFinishReason(e.target.value)}
                className="w-full p-2.5 border border-stone-300 rounded-lg text-xs text-stone-900"
              />
              <p className="text-[10px] text-stone-400 mt-1">
                Si escribes una dedicatoria aquí, se mostrará de forma especial en la página final de cierre de tu libro junto al sello ForeverYou.
              </p>
            </div>

            <div className="flex space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowFinishModal(false)}
                className="w-1/2 py-2 border border-stone-300 text-stone-700 rounded-lg text-xs font-medium"
              >
                Seguir en el cuestionario
              </button>
              <button
                type="button"
                onClick={handleFinishStory}
                disabled={finishing}
                className="w-1/2 py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-semibold shadow-sm"
              >
                {finishing ? 'Guardando...' : 'Confirmar Cierre y Maquetar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FAQ Modal */}
      <FAQModal isOpen={isFaqOpen} onClose={() => setIsFaqOpen(false)} />

      {/* Participant Administrative Panel Modal */}
      {isParticipantAdminOpen && (
        <ParticipantAdminPanel
          token={activeToken}
          onClose={() => setIsParticipantAdminOpen(false)}
          onConsentRevoked={() => {
            setIsParticipantAdminOpen(false);
            setSessionData((prev) => (prev ? { ...prev, hasValidConsent: false } : null));
          }}
          onLogoutSession={handleLogoutSession}
        />
      )}
    </div>
  );
};
