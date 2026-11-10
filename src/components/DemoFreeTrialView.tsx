import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  BookOpen,
  Sparkles,
  Heart,
  Users,
  User,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Trash2,
  Edit3,
  Palette,
  Layout,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Undo2,
  Redo2,
  Upload,
  Image as ImageIcon,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  MessageCircle,
  Mail,
  ShieldCheck,
  FileText,
  Bold,
  Italic,
  Plus,
  X,
} from 'lucide-react';
import {
  DEMO_MAIN_QUESTIONS,
  DEMO_MAX_AI_FOLLOW_UPS,
  DEMO_NARRATIVE_STYLES,
  DEMO_COVER_DESIGNS,
  DEMO_INTERIOR_STYLES,
  DEMO_BOOK_FORMATS,
  DEMO_THEMATIC_ILLUSTRATIONS,
  DEMO_TEMPORARY_PRIVACY_NOTICE,
  DemoStoryMode,
  DemoNarrativeStyleId,
  DemoInMemoryPhoto,
  DemoManuscript,
  DemoQuestionResponse,
  composeBookPages,
  buildFallbackFollowUp,
  buildFaithfulFallbackManuscript,
  countGeneratedDemoFollowUps,
  canRequestDemoFollowUpForQuestion,
} from '../logic/demoStoryRules.ts';
import {
  DemoWizardPhase,
  loadDemoSessionFromStorage,
  saveDemoSessionToStorage,
  clearDemoSessionFromStorage,
  createInitialDemoSessionState,
} from '../utils/demoSessionManager.ts';
import { generateRealDemoBookPdf, preloadBookResourcesForPdf } from '../utils/demoPdfGenerator.ts';
import {
  DemoCoverThumbnailCard,
  DemoInteriorThumbnailCard,
  DemoComposedPageView,
} from './DemoBookPageRenderer.tsx';
import { ForeverYouLogo } from './ForeverYouLogo';
import {
  InquiryFormInput,
  validateInquiryForm,
  buildWhatsAppInquiryUrl,
  buildMailtoInquiryUrl,
} from '../utils/conocemeLogic.ts';
import { VoiceRecorder } from './VoiceRecorder.tsx';

interface DemoFreeTrialViewProps {
  onNavigateToConoceme?: () => void;
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12 MB

export const DemoFreeTrialView: React.FC<DemoFreeTrialViewProps> = ({
  onNavigateToConoceme,
}) => {
  // Load initial state from sessionStorage (automatically purging if > 4h old)
  const initialLoaded = useMemo(() => loadDemoSessionFromStorage(), []);

  const [phase, setPhase] = useState<DemoWizardPhase>(initialLoaded.state.phase);
  const [profile, setProfile] = useState(initialLoaded.state.profile);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(
    initialLoaded.state.currentStepIndex
  );
  const [showingFollowUpForQuestionId, setShowingFollowUpForQuestionId] = useState<string | null>(
    initialLoaded.state.showingFollowUpForQuestionId
  );
  const [responses, setResponses] = useState<Record<string, DemoQuestionResponse>>(
    initialLoaded.state.responses
  );
  const [narrativeStyle, setNarrativeStyle] = useState<DemoNarrativeStyleId>(
    initialLoaded.state.narrativeStyle
  );
  const [editorialConfig, setEditorialConfig] = useState(initialLoaded.state.editorialConfig);
  const [aiGeneratedManuscript, setAiGeneratedManuscript] = useState<DemoManuscript | null>(
    initialLoaded.state.aiGeneratedManuscript
  );
  const [workingManuscript, setWorkingManuscript] = useState<DemoManuscript | null>(
    initialLoaded.state.workingManuscript
  );
  const [hasManualEdits, setHasManualEdits] = useState<boolean>(
    initialLoaded.state.hasManualEdits
  );

  // In-memory photos (kept in RAM with Object URLs, never stored in sessionStorage/DB)
  const [coverPhoto, setCoverPhoto] = useState<DemoInMemoryPhoto | null>(null);
  const [chapterPhotos, setChapterPhotos] = useState<Record<string, DemoInMemoryPhoto | null>>({});
  const [showReloadPhotoNotice, setShowReloadPhotoNotice] = useState<boolean>(
    initialLoaded.restoredFromSession && initialLoaded.state.hadInMemoryPhotosBeforeReload
  );
  const [expiredNotice, setExpiredNotice] = useState<boolean>(initialLoaded.wasExpiredAndPurged);

  // System loading / status messages (Section 29)
  const [systemStatusMessage, setSystemStatusMessage] = useState<string | null>(null);
  const [interviewError, setInterviewError] = useState<string | null>(null);
  const [manuscriptError, setManuscriptError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [profileValidationError, setProfileValidationError] = useState<string | null>(null);

  // Editorial Studio sub-tab: 'design' | 'edit' | 'reader'
  const [studioTab, setStudioTab] = useState<'design' | 'edit' | 'reader'>('design');

  // Undo / Redo stacks for manuscript editor (Section 24.1)
  const [undoStack, setUndoStack] = useState<DemoManuscript[]>([]);
  const [redoStack, setRedoStack] = useState<DemoManuscript[]>([]);
  const activeEditorTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [activeEditTarget, setActiveEditTarget] = useState<{
    chapterIdx: number;
    paraIdx: number;
  } | null>(null);

  // Generated PDF state
  const [pdfArtifact, setPdfArtifact] = useState<{
    blobUrl: string;
    filename: string;
    pageCount: number;
  } | null>(null);

  // Interactive Book Viewer & PDF Reader controls (Section 23)
  const [viewerMode, setViewerMode] = useState<'flipbook' | 'pdf_reader'>('flipbook');
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);
  const [enablePageAnimation, setEnablePageAnimation] = useState<boolean>(true);
  const [isTurningPage, setIsTurningPage] = useState<boolean>(false);
  const [readerZoom, setReaderZoom] = useState<number>(100);
  const [readerFitMode, setReaderFitMode] = useState<'width' | 'page'>('page');
  const [isFullscreenViewer, setIsFullscreenViewer] = useState<boolean>(false);
  const viewerContainerRef = useRef<HTMLDivElement | null>(null);
  const touchStartXRef = useRef<number | null>(null);

  // Modals: Create Another Book, Change Narrative Style Confirmation, Leave Warning, Commercial Contracting Modal
  const [showNewBookConfirmModal, setShowNewBookConfirmModal] = useState<boolean>(false);
  const [pendingStyleChange, setPendingStyleChange] = useState<DemoNarrativeStyleId | null>(null);
  const [pendingExitNavigation, setPendingExitNavigation] = useState<(() => void) | null>(null);
  const [showCommercialModal, setShowCommercialModal] = useState<boolean>(false);

  // Commercial Contracting Modal state (reusing existing ForeverYou inquiry logic)
  const [inquiryInput, setInquiryInput] = useState<InquiryFormInput>({
    fullName: '',
    contactInfo: '',
    recipientRelation: 'Para mí o mi familia',
    modality: 'individual',
    message: '',
  });
  const [inquiryErrors, setInquiryErrors] = useState<{
    fullName?: string;
    contactInfo?: string;
    recipientRelation?: string;
  }>({});
  const [inquirySubmitted, setInquirySubmitted] = useState<boolean>(false);

  // Sync textual state to sessionStorage whenever relevant state changes
  useEffect(() => {
    const hasAnyPhotos =
      Boolean(coverPhoto) || Object.values(chapterPhotos).some((p) => Boolean(p));
    saveDemoSessionToStorage({
      phase,
      profile,
      currentStepIndex,
      showingFollowUpForQuestionId,
      responses,
      narrativeStyle,
      editorialConfig,
      aiGeneratedManuscript,
      workingManuscript,
      hasManualEdits,
      hadInMemoryPhotosBeforeReload: hasAnyPhotos,
      lastActivityAt: Date.now(),
    });
  }, [
    phase,
    profile,
    currentStepIndex,
    showingFollowUpForQuestionId,
    responses,
    narrativeStyle,
    editorialConfig,
    aiGeneratedManuscript,
    workingManuscript,
    hasManualEdits,
    coverPhoto,
    chapterPhotos,
  ]);

  // Warn before closing/leaving browser tab if user has active interview answers (Section 5.1)
  const hasUnsavedProgress = useMemo(() => {
    return Object.keys(responses).length > 0 || Boolean(workingManuscript);
  }, [responses, workingManuscript]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedProgress && phase !== 'welcome') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedProgress, phase]);

  // Clean up Object URLs on unmount
  useEffect(() => {
    return () => {
      if (coverPhoto?.objectUrl) URL.revokeObjectURL(coverPhoto.objectUrl);
      Object.values(chapterPhotos).forEach((p) => {
        if (p?.objectUrl) URL.revokeObjectURL(p.objectUrl);
      });
      if (pdfArtifact?.blobUrl) URL.revokeObjectURL(pdfArtifact.blobUrl);
    };
  }, []);

  // Compose paginated book document in real time (Sections 18, 19, 20, 21)
  const composedBook = useMemo(() => {
    if (!workingManuscript) return null;
    return composeBookPages({
      manuscript: workingManuscript,
      editorialConfig,
      coverPhoto,
      chapterPhotos,
    });
  }, [workingManuscript, editorialConfig, coverPhoto, chapterPhotos]);

  // Regenerate the real vector PDF whenever composedBook changes
  useEffect(() => {
    if (!composedBook) return;
    let cancelled = false;
    setSystemStatusMessage('Componiendo las páginas y generando el PDF...');
    const timer = setTimeout(async () => {
      try {
        await preloadBookResourcesForPdf(composedBook);
        if (cancelled) return;
        const generated = generateRealDemoBookPdf({
          composed: composedBook,
          profile,
        });
        if (cancelled) {
          if (generated.blobUrl) URL.revokeObjectURL(generated.blobUrl);
          return;
        }
        setPdfArtifact((prev) => {
          if (prev?.blobUrl) URL.revokeObjectURL(prev.blobUrl);
          return generated;
        });
        setSystemStatusMessage(null);
      } catch (_err) {
        if (!cancelled) setSystemStatusMessage(null);
      }
    }, 80);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [composedBook, profile]);

  // Keyboard navigation in interactive book viewer
  useEffect(() => {
    if (phase !== 'editorial_studio' || studioTab !== 'reader' || !composedBook) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }
      if (e.key === 'ArrowRight') {
        handleNextPage();
      } else if (e.key === 'ArrowLeft') {
        handlePrevPage();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase, studioTab, composedBook, currentPageIndex]);

  // Active question definition in interview phase
  const currentQuestion = DEMO_MAIN_QUESTIONS[currentStepIndex] || DEMO_MAIN_QUESTIONS[0];
  const currentResponse: DemoQuestionResponse = responses[currentQuestion.id] || {
    questionId: currentQuestion.id,
    mainAnswerText: '',
    partner1AnswerText: '',
    partner2AnswerText: '',
    mainOmission: 'none',
    followUp: null,
    followUpAnswerText: '',
    partner1FollowUpText: '',
    partner2FollowUpText: '',
    followUpOmission: 'none',
    followUpCompleted: false,
  };

  const isShowingFollowUp = showingFollowUpForQuestionId === currentQuestion.id;

  // Overall interview progress calculation (out of 5 dimensions + up to 3 AI follow-ups = 8 questions)
  const completedDimensionsCount = useMemo(() => {
    return DEMO_MAIN_QUESTIONS.filter((q) => {
      const r = responses[q.id];
      if (!r) return false;
      if (r.mainOmission === 'not_recalled' || r.mainOmission === 'prefer_not_to_answer') {
        return true;
      }
      return Boolean(r.followUpCompleted);
    }).length;
  }, [responses]);

  const generatedAiFollowUpsCount = useMemo(() => {
    return countGeneratedDemoFollowUps(responses);
  }, [responses]);

  const updateCurrentResponse = (patch: Partial<DemoQuestionResponse>) => {
    setInterviewError(null);
    setResponses((prev) => ({
      ...prev,
      [currentQuestion.id]: {
        ...currentResponse,
        ...patch,
      },
    }));
  };

  // Reset session for creating another book
  const handleWipeAllInformation = () => {
    if (coverPhoto?.objectUrl) URL.revokeObjectURL(coverPhoto.objectUrl);
    Object.values(chapterPhotos).forEach((p) => {
      if (p?.objectUrl) URL.revokeObjectURL(p.objectUrl);
    });
    if (pdfArtifact?.blobUrl) URL.revokeObjectURL(pdfArtifact.blobUrl);

    clearDemoSessionFromStorage();
    const fresh = createInitialDemoSessionState();
    setPhase(fresh.phase);
    setProfile(fresh.profile);
    setCurrentStepIndex(0);
    setShowingFollowUpForQuestionId(null);
    setResponses({});
    setNarrativeStyle('first_person_literary');
    setEditorialConfig(fresh.editorialConfig);
    setAiGeneratedManuscript(null);
    setWorkingManuscript(null);
    setHasManualEdits(false);
    setCoverPhoto(null);
    setChapterPhotos({});
    setPdfArtifact(null);
    setUndoStack([]);
    setRedoStack([]);
    setShowNewBookConfirmModal(false);
    setShowReloadPhotoNotice(false);
  };

  // Validate profile & start interview
  const handleStartInterviewFromProfile = (e: React.FormEvent) => {
    e.preventDefault();
    setProfileValidationError(null);

    if (profile.mode === 'individual') {
      if (!profile.displayName.trim()) {
        setProfileValidationError(
          'Por favor escribe el nombre con el que deseas aparecer en el libro.'
        );
        return;
      }
    } else {
      if (!profile.partner1Name.trim() || !profile.partner2Name.trim()) {
        setProfileValidationError(
          'Por favor escribe el nombre de ambos participantes para la historia en pareja.'
        );
        return;
      }
    }

    const defaultAuthors =
      profile.mode === 'pareja'
        ? `${profile.partner1Name.trim()} y ${profile.partner2Name.trim()}`
        : profile.displayName.trim();

    setEditorialConfig((prev) => ({
      ...prev,
      customAuthors: prev.customAuthors || defaultAuthors,
      customTitle:
        prev.customTitle ||
        profile.customTitle?.trim() ||
        (profile.mode === 'pareja'
          ? `Nuestra historia: ${defaultAuthors}`
          : `Los recuerdos de ${defaultAuthors}`),
    }));

    setPhase('interview');
  };

  // Move to next main question or interview completion screen
  const advanceToNextMainStep = () => {
    setShowingFollowUpForQuestionId(null);
    setInterviewError(null);
    if (currentStepIndex < DEMO_MAIN_QUESTIONS.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
    } else {
      setPhase('interview_completed');
    }
  };

  // Submit Main Question Answer -> Request AI Follow-Up from Gemini (Section 10)
  const handleSubmitMainQuestion = async (
    omission: 'none' | 'not_recalled' | 'prefer_not_to_answer' = 'none'
  ) => {
    setInterviewError(null);

    if (omission !== 'none') {
      updateCurrentResponse({
        mainOmission: omission,
        followUp: null,
        followUpCompleted: true,
      });
      advanceToNextMainStep();
      return;
    }

    const hasMainContent =
      profile.mode === 'pareja'
        ? Boolean(
            currentResponse.partner1AnswerText?.trim() ||
              currentResponse.partner2AnswerText?.trim() ||
              currentResponse.mainAnswerText?.trim()
          )
        : Boolean(currentResponse.mainAnswerText?.trim());

    if (!hasMainContent) {
      setInterviewError(
        'Por favor comparte un recuerdo en el campo de texto, o elige «No lo recuerdo» o «Prefiero no responder».'
      );
      return;
    }

    // If a follow-up was already generated for this question, show it directly
    if (currentResponse.followUp?.shouldAskFollowUp && currentResponse.followUp.followUpQuestion) {
      updateCurrentResponse({ mainOmission: 'none' });
      setShowingFollowUpForQuestionId(currentQuestion.id);
      return;
    }

    // Enforce strict limit of 3 AI follow-ups across the 5 base questions (total 8 questions)
    if (!canRequestDemoFollowUpForQuestion(responses, currentQuestion.id)) {
      updateCurrentResponse({
        mainOmission: 'none',
        followUp: null,
        followUpCompleted: true,
      });
      advanceToNextMainStep();
      return;
    }

    try {
      setSystemStatusMessage('Generando pregunta de profundización...');
      const previousFollowUps = (Object.values(responses) as DemoQuestionResponse[])
        .map((r) => r.followUp?.followUpQuestion)
        .filter((q): q is string => Boolean(q));

      const res = await fetch('/api/demo/followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mainQuestionId: currentQuestion.id,
          mode: profile.mode,
          displayName: profile.displayName,
          partner1Name: profile.partner1Name,
          partner2Name: profile.partner2Name,
          mainAnswerText: currentResponse.mainAnswerText,
          partner1AnswerText: currentResponse.partner1AnswerText,
          partner2AnswerText: currentResponse.partner2AnswerText,
          previousFollowUps,
        }),
      });

      const data = await res.json();
      setSystemStatusMessage(null);

      if (data.success && data.data) {
        const followUpPayload = data.data;
        if (followUpPayload.shouldAskFollowUp && followUpPayload.followUpQuestion) {
          updateCurrentResponse({
            mainOmission: 'none',
            followUp: followUpPayload,
            followUpCompleted: false,
          });
          setShowingFollowUpForQuestionId(currentQuestion.id);
        } else {
          updateCurrentResponse({
            mainOmission: 'none',
            followUp: null,
            followUpCompleted: true,
          });
          advanceToNextMainStep();
        }
      } else {
        setInterviewError(
          data.error ||
            'No pudimos conectar con el asistente para generar la pregunta de profundización. Puedes reintentar o continuar a la siguiente etapa.'
        );
      }
    } catch (_err) {
      setSystemStatusMessage(null);
      setInterviewError(
        'Ocurrió un error de conexión al preparar la pregunta de profundización. Puedes reintentar o avanzar sin esta profundización.'
      );
    }
  };

  // Continue without follow-up if Gemini fails or user skips
  const handleContinueWithoutFollowUp = () => {
    if (!canRequestDemoFollowUpForQuestion(responses, currentQuestion.id)) {
      updateCurrentResponse({
        mainOmission: 'none',
        followUp: null,
        followUpCompleted: true,
      });
      advanceToNextMainStep();
      return;
    }

    const fallback = buildFallbackFollowUp({
      question: currentQuestion,
      mode: profile.mode,
      answerText:
        profile.mode === 'pareja'
          ? `${currentResponse.partner1AnswerText || ''} ${currentResponse.partner2AnswerText || ''} ${currentResponse.mainAnswerText || ''}`
          : currentResponse.mainAnswerText,
      partner1Name: profile.partner1Name,
      partner2Name: profile.partner2Name,
    });

    if (fallback.shouldAskFollowUp && fallback.followUpQuestion) {
      updateCurrentResponse({
        mainOmission: 'none',
        followUp: fallback,
        followUpCompleted: false,
      });
      setInterviewError(null);
      setShowingFollowUpForQuestionId(currentQuestion.id);
    } else {
      updateCurrentResponse({
        mainOmission: 'none',
        followUp: null,
        followUpCompleted: true,
      });
      advanceToNextMainStep();
    }
  };

  // Submit Follow-up Answer -> Advance to next main question
  const handleSubmitFollowUpQuestion = (
    omission: 'none' | 'not_recalled' | 'prefer_not_to_answer' = 'none'
  ) => {
    setInterviewError(null);

    if (omission === 'none') {
      const hasFollowUpContent =
        profile.mode === 'pareja'
          ? Boolean(
              currentResponse.partner1FollowUpText?.trim() ||
                currentResponse.partner2FollowUpText?.trim() ||
                currentResponse.followUpAnswerText?.trim()
            )
          : Boolean(currentResponse.followUpAnswerText?.trim());

      if (!hasFollowUpContent) {
        setInterviewError(
          'Escribe tu respuesta para esta profundización, o selecciona «No lo recuerdo» o «Prefiero no responder».'
        );
        return;
      }
    }

    updateCurrentResponse({
      followUpOmission: omission,
      followUpCompleted: true,
    });
    advanceToNextMainStep();
  };

  // Generate Autobiographical Manuscript with Gemini (Section 14)
  const handleGenerateManuscript = async (chosenStyle: DemoNarrativeStyleId) => {
    setManuscriptError(null);
    setSystemStatusMessage('Redactando el manuscrito con inteligencia artificial...');

    try {
      const res = await fetch('/api/demo/manuscript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile,
          responses,
          narrativeStyle: chosenStyle,
          dedication: editorialConfig.dedication,
        }),
      });

      const data = await res.json();
      setSystemStatusMessage(null);

      if (data.success && data.data) {
        const generated: DemoManuscript = data.data;
        setAiGeneratedManuscript(generated);
        setWorkingManuscript(generated);
        setHasManualEdits(false);
        setUndoStack([]);
        setRedoStack([]);
        setEditorialConfig((prev) => ({
          ...prev,
          customTitle: prev.customTitle || generated.title,
          customSubtitle: prev.customSubtitle || generated.subtitle,
          customAuthors: prev.customAuthors || generated.authors,
          dedication: prev.dedication || generated.dedication,
        }));
        setPhase('editorial_studio');
        setStudioTab('design');
      } else {
        setManuscriptError(
          data.error ||
            'No fue posible redactar el manuscrito automáticamente en este momento.'
        );
      }
    } catch (_err) {
      setSystemStatusMessage(null);
      setManuscriptError(
        'Fallo de conexión al redactar el manuscrito. Puedes reintentar o continuar con la composición fiel de tus respuestas.'
      );
    }
  };

  // Fallback manuscript recovery if network fails
  const handleUseFaithfulFallbackManuscript = () => {
    const fallback = buildFaithfulFallbackManuscript({
      profile,
      responses,
      narrativeStyle,
      dedication: editorialConfig.dedication,
    });
    setAiGeneratedManuscript(fallback);
    setWorkingManuscript(fallback);
    setHasManualEdits(false);
    setUndoStack([]);
    setRedoStack([]);
    setEditorialConfig((prev) => ({
      ...prev,
      customTitle: prev.customTitle || fallback.title,
      customSubtitle: prev.customSubtitle || fallback.subtitle,
      customAuthors: prev.customAuthors || fallback.authors,
      dedication: prev.dedication || fallback.dedication,
    }));
    setManuscriptError(null);
    setPhase('editorial_studio');
    setStudioTab('design');
  };

  // Update working manuscript with Undo/Redo support (Section 24.1)
  const mutateWorkingManuscript = (updater: (current: DemoManuscript) => DemoManuscript) => {
    if (!workingManuscript) return;
    setUndoStack((prev) => [...prev.slice(-19), workingManuscript]);
    setRedoStack([]);
    const next = updater(workingManuscript);
    setWorkingManuscript(next);
    setHasManualEdits(true);
  };

  const handleUndoManuscriptEdit = () => {
    if (undoStack.length === 0 || !workingManuscript) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [workingManuscript, ...prev]);
    setWorkingManuscript(previous);
  };

  const handleRedoManuscriptEdit = () => {
    if (redoStack.length === 0 || !workingManuscript) return;
    const next = redoStack[0];
    setRedoStack((prev) => prev.slice(1));
    setUndoStack((prev) => [...prev, workingManuscript]);
    setWorkingManuscript(next);
  };

  const handleRestoreAiManuscript = () => {
    if (!aiGeneratedManuscript || !workingManuscript) return;
    setUndoStack((prev) => [...prev, workingManuscript]);
    setRedoStack([]);
    setWorkingManuscript(aiGeneratedManuscript);
    setHasManualEdits(false);
  };

  // Apply bold or italic markdown wrapper to active chapter paragraph
  const handleFormatSelection = (marker: '**' | '*') => {
    if (!workingManuscript || !activeEditTarget) return;
    const { chapterIdx, paraIdx } = activeEditTarget;
    const ch = workingManuscript.chapters[chapterIdx];
    if (!ch || typeof ch.paragraphs[paraIdx] !== 'string') return;

    const textarea = activeEditorTextareaRef.current;
    const currentText = ch.paragraphs[paraIdx];

    if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selected = currentText.slice(start, end);
      const updated = `${currentText.slice(0, start)}${marker}${selected}${marker}${currentText.slice(end)}`;
      mutateWorkingManuscript((ms) => {
        const nextChapters = [...ms.chapters];
        const nextParas = [...nextChapters[chapterIdx].paragraphs];
        nextParas[paraIdx] = updated;
        nextChapters[chapterIdx] = { ...nextChapters[chapterIdx], paragraphs: nextParas };
        return { ...ms, chapters: nextChapters };
      });
    } else {
      const updated = `${marker}${currentText}${marker}`;
      mutateWorkingManuscript((ms) => {
        const nextChapters = [...ms.chapters];
        const nextParas = [...nextChapters[chapterIdx].paragraphs];
        nextParas[paraIdx] = updated;
        nextChapters[chapterIdx] = { ...nextChapters[chapterIdx], paragraphs: nextParas };
        return { ...ms, chapters: nextChapters };
      });
    }
  };

  // Local in-memory photo processor (validates MIME type & size, normalizes via Canvas for PDF & preview)
  const processUploadedPhotoFile = (
    file: File,
    onReady: (photo: DemoInMemoryPhoto) => void
  ) => {
    setPhotoError(null);
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setPhotoError('Formato no compatible. Por favor selecciona una imagen JPG, PNG o WebP.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setPhotoError('La fotografía supera el límite de 12 MB. Por favor elige una imagen más ligera.');
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxDim = 1400;
      let targetW = img.naturalWidth || 800;
      let targetH = img.naturalHeight || 600;
      if (targetW > maxDim || targetH > maxDim) {
        if (targetW > targetH) {
          targetH = Math.round((targetH * maxDim) / targetW);
          targetW = maxDim;
        } else {
          targetW = Math.round((targetW * maxDim) / targetH);
          targetH = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, targetW, targetH);
      }
      const dataUrl = canvas.toDataURL('image/jpeg', 0.86);

      onReady({
        id: `photo_${Date.now()}`,
        objectUrl,
        dataUrl,
        fileName: file.name,
        mimeType: 'image/jpeg',
        width: targetW,
        height: targetH,
        caption: '',
        focusY: 'center',
        zoom: 1,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setPhotoError('No se pudo leer el archivo de imagen seleccionado.');
    };
    img.src = objectUrl;
  };

  // Download generated PDF
  const handleDownloadPdf = async () => {
    if (!composedBook) return;
    try {
      setSystemStatusMessage('Preparando descarga del PDF...');
      let generated = pdfArtifact;
      if (!generated) {
        await preloadBookResourcesForPdf(composedBook);
        generated = generateRealDemoBookPdf({
          composed: composedBook,
          profile,
        });
      }
      const a = document.createElement('a');
      a.href = generated.blobUrl;
      a.download = generated.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setSystemStatusMessage('PDF listo para descargar.');
      setTimeout(() => setSystemStatusMessage(null), 2500);
    } catch (_err) {
      setSystemStatusMessage(null);
    }
  };

  // Interactive Book Viewer page navigation
  const totalPages = composedBook?.pages.length || 0;

  const handleNextPage = () => {
    if (!composedBook || currentPageIndex >= composedBook.pages.length - 1) return;
    if (enablePageAnimation) {
      setIsTurningPage(true);
      setTimeout(() => setIsTurningPage(false), 260);
    }
    setCurrentPageIndex((prev) => Math.min(composedBook.pages.length - 1, prev + 1));
  };

  const handlePrevPage = () => {
    if (!composedBook || currentPageIndex <= 0) return;
    if (enablePageAnimation) {
      setIsTurningPage(true);
      setTimeout(() => setIsTurningPage(false), 260);
    }
    setCurrentPageIndex((prev) => Math.max(0, prev - 1));
  };

  const handleToggleFullscreen = () => {
    if (!viewerContainerRef.current) return;
    if (!document.fullscreenElement) {
      viewerContainerRef.current.requestFullscreen?.().catch(() => {});
      setIsFullscreenViewer(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreenViewer(false);
    }
  };

  const handleOpenCommercialContractModal = () => {
    const defaultName =
      profile.mode === 'pareja'
        ? `${profile.partner1Name} y ${profile.partner2Name}`.trim()
        : profile.displayName || profile.fullName || '';
    setInquiryInput((prev) => ({
      ...prev,
      fullName: prev.fullName || defaultName,
      modality: profile.mode === 'pareja' ? 'compartida' : 'individual',
    }));
    setShowCommercialModal(true);
  };

  const handleSafeExitNavigation = (targetFn?: () => void) => {
    if (!targetFn) return;
    if (hasUnsavedProgress && phase !== 'welcome') {
      setPendingExitNavigation(() => targetFn);
      return;
    }
    targetFn();
  };

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-stone-900 font-sans selection:bg-amber-200 flex flex-col">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-40 bg-stone-900 text-stone-100 border-b border-stone-800 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ForeverYouLogo
              variant="horizontal"
              theme="light"
              size="sm"
              subtitle="Mi historia en 8 preguntas • Sin registro ni guardado en base de datos"
            />
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-800/90 text-amber-100 border border-amber-600/50 shrink-0">
              Prueba gratuita
            </span>
          </div>

          <div className="flex items-center gap-2">
            {onNavigateToConoceme && (
              <button
                type="button"
                onClick={() => handleSafeExitNavigation(onNavigateToConoceme)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-stone-300 hover:text-white hover:bg-stone-800 transition cursor-pointer"
              >
                Conóceme
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Real System Status Bar */}
      {systemStatusMessage && (
        <div
          role="status"
          className="bg-amber-900 text-amber-50 px-4 py-2 text-xs font-medium flex items-center justify-center gap-2 shadow-xs"
        >
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-300 shrink-0" />
          <span>{systemStatusMessage}</span>
        </div>
      )}

      {/* Notice if previous temporary session expired (> 4 hours) */}
      {expiredNotice && (
        <div className="max-w-4xl mx-auto mt-4 px-4 w-full">
          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-950 flex items-center justify-between gap-3">
            <span>
              Por tu privacidad, la sesión temporal anterior expiró tras 4 horas de inactividad y fue eliminada automáticamente del navegador.
            </span>
            <button
              type="button"
              onClick={() => setExpiredNotice(false)}
              className="text-amber-900 font-bold px-2 py-0.5 cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Notice if page was reloaded and in-memory photos need re-selection */}
      {showReloadPhotoNotice && (
        <div className="max-w-4xl mx-auto mt-4 px-4 w-full">
          <div className="p-3.5 bg-stone-100 border border-stone-300 rounded-xl text-xs text-stone-800 flex items-center justify-between gap-3">
            <span>
              Tus respuestas y textos se han recuperado íntegramente de la sesión temporal. Por privacidad, las fotografías grandes solo se mantienen en memoria activa; si habías subido una fotografía, puedes volver a seleccionarla antes de descargar tu PDF.
            </span>
            <button
              type="button"
              onClick={() => setShowReloadPhotoNotice(false)}
              className="text-stone-700 font-bold px-2 py-0.5 cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Main Content Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* ================================================================= */}
        {/* STEP 1: PANTALLA DE BIENVENIDA (DemoLanding)                      */}
        {/* ================================================================= */}
        {phase === 'welcome' && (
          <div className="max-w-4xl mx-auto space-y-10">
            <div className="bg-white rounded-3xl border border-stone-200/90 shadow-sm p-8 sm:p-12 text-center space-y-6">
              <div className="flex justify-center">
                <ForeverYouLogo variant="stacked" theme="navy" size="lg" />
              </div>
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-100/90 text-amber-950 text-xs font-semibold">
                <Sparkles className="w-3.5 h-3.5 text-amber-800" />
                <span>Prueba gratuita — Mi historia en 8 preguntas</span>
              </div>

              <h1 className="font-serif text-3xl sm:text-5xl font-bold text-stone-900 tracking-tight leading-tight">
                Descubre cómo tus recuerdos pueden convertirse en un libro inolvidable
              </h1>

              <p className="text-stone-600 text-sm sm:text-base max-w-2xl mx-auto leading-relaxed">
                Vive la experiencia de YouForever de forma gratuita. Responde 8 preguntas en total (5 preguntas esenciales y 3 generadas mediante IA), elige entre 5 portadas de colección y 5 diseños interiores, y descarga al instante tu pequeño libro autobiográfico en PDF.
              </p>

              <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-4">
                <button
                  type="button"
                  data-testid="demo-start-cta"
                  onClick={() => setPhase('mode_and_profile')}
                  className="w-full sm:w-auto px-8 py-4 bg-amber-800 hover:bg-amber-900 text-white font-semibold text-sm sm:text-base rounded-2xl shadow-md transition transform hover:scale-[1.01] cursor-pointer inline-flex items-center justify-center gap-2.5"
                >
                  <BookOpen className="w-5 h-5" />
                  <span>Crear mi historia gratis</span>
                </button>
              </div>

              <div className="pt-6 border-t border-stone-100 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
                <div className="p-4 rounded-2xl bg-[#FAF8F5] border border-stone-200/70 space-y-1">
                  <div className="text-xs font-serif font-bold text-stone-900 flex items-center gap-1.5">
                    <Heart className="w-4 h-4 text-amber-800" />
                    <span>Fidelidad a tu propia voz</span>
                  </div>
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Conservamos tus apodos cariñosos, expresiones familiares y recuerdos auténticos sin inventar datos.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-[#FAF8F5] border border-stone-200/70 space-y-1">
                  <div className="text-xs font-serif font-bold text-stone-900 flex items-center gap-1.5">
                    <Palette className="w-4 h-4 text-amber-800" />
                    <span>Diseño editorial auténtico</span>
                  </div>
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Combina 5 portadas y 5 estilos tipográficos interiores en formato A5, 6×9 pulgadas o Carta.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-[#FAF8F5] border border-stone-200/70 space-y-1">
                  <div className="text-xs font-serif font-bold text-stone-900 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-700" />
                    <span>Privacidad total sin registro</span>
                  </div>
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Sin crear cuenta ni guardar tus respuestas en bases de datos. Todo permanece en tu sesión actual.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* STEP 2: MODALIDAD, DATOS BÁSICOS Y AVISO TEMPORAL                 */}
        {/* ================================================================= */}
        {phase === 'mode_and_profile' && (
          <div className="max-w-3xl mx-auto bg-white rounded-3xl border border-stone-200 shadow-sm p-6 sm:p-10 space-y-8">
            <div className="flex items-center justify-between border-b border-stone-100 pb-4">
              <div>
                <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider">
                  Paso 1 de 4 • Personalización Inicial
                </span>
                <h2 className="font-serif text-2xl sm:text-3xl font-bold text-stone-900 mt-0.5">
                  ¿Qué historia vamos a contar hoy?
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setPhase('welcome')}
                className="text-xs font-semibold text-stone-500 hover:text-stone-800 inline-flex items-center gap-1 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Volver</span>
              </button>
            </div>

            <form onSubmit={handleStartInterviewFromProfile} className="space-y-6">
              {/* Mode Selector */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setProfile((prev) => ({ ...prev, mode: 'individual' }))}
                  className={`p-5 rounded-2xl border-2 text-left transition cursor-pointer space-y-2 ${
                    profile.mode === 'individual'
                      ? 'border-amber-700 bg-amber-50/50 shadow-xs'
                      : 'border-stone-200 bg-white hover:border-stone-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-900 flex items-center justify-center">
                      <User className="w-5 h-5" />
                    </div>
                    {profile.mode === 'individual' && (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-800 text-white">
                        Seleccionado
                      </span>
                    )}
                  </div>
                  <h3 className="font-serif text-lg font-bold text-stone-900">
                    A. Mi historia personal
                  </h3>
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Una sola persona cuenta su propia vida, sus raíces, sus afectos y su esencia.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setProfile((prev) => ({ ...prev, mode: 'pareja' }))}
                  className={`p-5 rounded-2xl border-2 text-left transition cursor-pointer space-y-2 ${
                    profile.mode === 'pareja'
                      ? 'border-amber-700 bg-amber-50/50 shadow-xs'
                      : 'border-stone-200 bg-white hover:border-stone-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-900 flex items-center justify-center">
                      <Users className="w-5 h-5" />
                    </div>
                    {profile.mode === 'pareja' && (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-800 text-white">
                        Seleccionado
                      </span>
                    )}
                  </div>
                  <h3 className="font-serif text-lg font-bold text-stone-900">
                    B. Nuestra historia en pareja
                  </h3>
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Dos personas cuentan recuerdos de su relación y experiencias compartidas.
                  </p>
                </button>
              </div>

              {/* Basic Data Inputs (Section 6.1) */}
              {profile.mode === 'individual' ? (
                <div className="space-y-4 bg-[#FAF8F5] p-5 rounded-2xl border border-stone-200/80">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-stone-800 mb-1">
                        Nombre con el que deseas aparecer en el libro *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Ej. Ernesto o Mamá Elena"
                        value={profile.displayName}
                        onChange={(e) =>
                          setProfile((prev) => ({ ...prev, displayName: e.target.value }))
                        }
                        className="w-full px-3.5 py-2.5 bg-white border border-stone-300 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-600"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-stone-800 mb-1">
                        Nombre completo (opcional)
                      </label>
                      <input
                        type="text"
                        placeholder="Ej. Ernesto Gómez Salgado"
                        value={profile.fullName || ''}
                        onChange={(e) =>
                          setProfile((prev) => ({ ...prev, fullName: e.target.value }))
                        }
                        className="w-full px-3.5 py-2.5 bg-white border border-stone-300 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-600"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-stone-800 mb-1">
                      Título personalizado para tu libro (opcional)
                    </label>
                    <input
                      type="text"
                      placeholder="Ej. Los recuerdos que guardo en el alma"
                      value={profile.customTitle || ''}
                      onChange={(e) =>
                        setProfile((prev) => ({ ...prev, customTitle: e.target.value }))
                      }
                      className="w-full px-3.5 py-2.5 bg-white border border-stone-300 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-600"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-4 bg-[#FAF8F5] p-5 rounded-2xl border border-stone-200/80">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-stone-800 mb-1">
                        Nombre del participante 1 *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Ej. Ana"
                        value={profile.partner1Name}
                        onChange={(e) =>
                          setProfile((prev) => ({ ...prev, partner1Name: e.target.value }))
                        }
                        className="w-full px-3.5 py-2.5 bg-white border border-stone-300 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-600"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-stone-800 mb-1">
                        Nombre del participante 2 *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Ej. Luis"
                        value={profile.partner2Name}
                        onChange={(e) =>
                          setProfile((prev) => ({ ...prev, partner2Name: e.target.value }))
                        }
                        className="w-full px-3.5 py-2.5 bg-white border border-stone-300 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-600"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-stone-800 mb-1">
                      Título personalizado para su libro (opcional)
                    </label>
                    <input
                      type="text"
                      placeholder="Ej. El camino que recorrimos juntos"
                      value={profile.customTitle || ''}
                      onChange={(e) =>
                        setProfile((prev) => ({ ...prev, customTitle: e.target.value }))
                      }
                      className="w-full px-3.5 py-2.5 bg-white border border-stone-300 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-600"
                    />
                  </div>
                </div>
              )}

              {profileValidationError && (
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center justify-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{profileValidationError}</span>
                </div>
              )}

              <div className="flex items-center justify-center gap-3 pt-4">
                <button
                  type="submit"
                  className="px-8 py-3.5 bg-amber-800 hover:bg-amber-900 text-white text-sm font-semibold rounded-xl shadow-sm transition cursor-pointer inline-flex items-center justify-center gap-2"
                >
                  <span>Comenzar mi entrevista de 5 etapas</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ================================================================= */}
        {/* STEP 3: ENTREVISTA CONVERSACIONAL (5 Base + 3 IA = 8 Preguntas)   */}
        {/* ================================================================= */}
        {phase === 'interview' && (
          <div className="max-w-3xl mx-auto space-y-6">
            {/* Conversational Question Card */}
            <div className="bg-white rounded-3xl border border-stone-200 shadow-sm p-6 sm:p-10 space-y-6">
              <div className="space-y-2 text-center">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 text-amber-900 text-xs font-semibold">
                  <span>
                    {profile.mode === 'pareja'
                      ? currentQuestion.coupleDimensionTitle
                      : currentQuestion.individualDimensionTitle}
                  </span>
                  <span>•</span>
                  <span>Pregunta {currentQuestion.stepNumber} de 5</span>
                </div>

                <h2 className="font-serif text-xl sm:text-2xl font-bold text-stone-900 leading-snug pt-1 text-center">
                  «
                  {profile.mode === 'pareja'
                    ? currentQuestion.coupleText
                    : currentQuestion.individualText}
                  »
                </h2>
              </div>

              {/* Main Question Input Fields */}
              {!isShowingFollowUp ? (
                <div className="space-y-6">
                  {/* Voice Recording Module - Right below the question */}
                  <div className="bg-[#FAF8F5] p-4 sm:p-5 rounded-2xl border border-stone-200/90 space-y-2">
                    <label className="block text-xs font-bold text-stone-800 uppercase tracking-wide text-center">
                      Graba tu recuerdo con tu propia voz (o escribe abajo):
                    </label>
                    <VoiceRecorder
                      token="demo"
                      isDemo={true}
                      questionId={currentQuestion.id}
                      questionText={profile.mode === 'pareja' ? currentQuestion.coupleText : currentQuestion.individualText}
                      onVoiceSubmitted={(_audio, transcription) => {
                        if (transcription && transcription.trim()) {
                          const trimmed = transcription.trim();
                          updateCurrentResponse({
                            mainAnswerText: currentResponse.mainAnswerText
                              ? `${currentResponse.mainAnswerText} ${trimmed}`
                              : trimmed,
                            mainOmission: 'none',
                          });
                        }
                      }}
                    />
                  </div>

                  {profile.mode === 'individual' ? (
                    <div>
                      <label className="block text-xs font-semibold text-stone-700 mb-1.5 text-center sm:text-left">
                        Tu recuerdo escrito (puedes complementarlo o redactarlo con tu propio teclado):
                      </label>
                      <textarea
                        rows={5}
                        value={currentResponse.mainAnswerText}
                        onChange={(e) =>
                          updateCurrentResponse({
                            mainAnswerText: e.target.value,
                            mainOmission: 'none',
                          })
                        }
                        placeholder="Escribe aquí tu recuerdo con tranquilidad..."
                        className="w-full p-4 rounded-2xl border border-stone-300 text-sm sm:text-base text-stone-900 leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-stone-800 mb-1">
                            Recuerdo de {profile.partner1Name || 'Participante 1'}:
                          </label>
                          <textarea
                            rows={4}
                            value={currentResponse.partner1AnswerText || ''}
                            onChange={(e) =>
                              updateCurrentResponse({
                                partner1AnswerText: e.target.value,
                                mainOmission: 'none',
                              })
                            }
                            placeholder={`Lo que recuerda ${profile.partner1Name || 'Participante 1'}...`}
                            className="w-full p-3.5 rounded-2xl border border-stone-300 text-sm text-stone-900 leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-500"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-stone-800 mb-1">
                            Recuerdo de {profile.partner2Name || 'Participante 2'}:
                          </label>
                          <textarea
                            rows={4}
                            value={currentResponse.partner2AnswerText || ''}
                            onChange={(e) =>
                              updateCurrentResponse({
                                partner2AnswerText: e.target.value,
                                mainOmission: 'none',
                              })
                            }
                            placeholder={`Lo que recuerda ${profile.partner2Name || 'Participante 2'}...`}
                            className="w-full p-3.5 rounded-2xl border border-stone-300 text-sm text-stone-900 leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1">
                          Respuesta conjunta (opcional, si desean contarlo en una sola voz):
                        </label>
                        <textarea
                          rows={3}
                          value={currentResponse.mainAnswerText}
                          onChange={(e) =>
                            updateCurrentResponse({
                              mainAnswerText: e.target.value,
                              mainOmission: 'none',
                            })
                          }
                          placeholder="O escriban aquí un recuerdo compartido por ambos..."
                          className="w-full p-3.5 rounded-2xl border border-stone-300 text-sm text-stone-900 leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </div>
                    </div>
                  )}

                  {interviewError && (
                    <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 space-y-2 text-center">
                      <div className="flex items-center justify-center gap-2 font-semibold">
                        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>{interviewError}</span>
                      </div>
                      <div className="flex flex-wrap justify-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleSubmitMainQuestion('none')}
                          className="px-3 py-1.5 bg-rose-800 text-white rounded-lg font-semibold cursor-pointer"
                        >
                          Reintentar con IA
                        </button>
                        <button
                          type="button"
                          onClick={handleContinueWithoutFollowUp}
                          className="px-3 py-1.5 bg-white border border-rose-300 text-rose-900 rounded-lg font-semibold cursor-pointer"
                        >
                          Continuar sin bloquear la entrevista
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Main Question Action Bar - Centered Buttons */}
                  <div className="flex flex-wrap items-center justify-center gap-3 pt-4 border-t border-stone-100">
                    <button
                      type="button"
                      onClick={() => {
                        if (currentStepIndex > 0) {
                          setCurrentStepIndex((prev) => prev - 1);
                          setShowingFollowUpForQuestionId(null);
                        } else {
                          setPhase('mode_and_profile');
                        }
                      }}
                      className="px-4 py-2.5 rounded-xl border border-stone-300 text-xs font-semibold text-stone-700 hover:bg-stone-100 transition cursor-pointer inline-flex items-center justify-center gap-1"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Regresar</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSubmitMainQuestion('not_recalled')}
                      className="px-4 py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-xs font-medium text-stone-700 transition cursor-pointer"
                    >
                      No lo recuerdo
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSubmitMainQuestion('prefer_not_to_answer')}
                      className="px-4 py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-xs font-medium text-stone-700 transition cursor-pointer"
                    >
                      Prefiero no responder
                    </button>

                    <button
                      type="button"
                      disabled={Boolean(systemStatusMessage)}
                      onClick={() => handleSubmitMainQuestion('none')}
                      className="px-7 py-2.5 rounded-xl bg-amber-800 hover:bg-amber-900 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold shadow-sm transition cursor-pointer inline-flex items-center justify-center gap-2"
                    >
                      <span>
                        {systemStatusMessage
                          ? 'Preparando pregunta...'
                          : 'Continuar'}
                      </span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                /* AI Follow-Up View inside the SAME stage (Section 11) */
                <div className="space-y-5">
                  {/* Summary of user's main answer */}
                  <div className="p-4 rounded-2xl bg-[#FAF8F5] border border-stone-200/90 space-y-1.5 text-center sm:text-left">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wider">
                        Tu respuesta principal
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowingFollowUpForQuestionId(null)}
                        className="text-xs font-semibold text-amber-800 hover:underline cursor-pointer"
                      >
                        Editar respuesta principal
                      </button>
                    </div>
                    {profile.mode === 'pareja' ? (
                      <div className="space-y-1 text-xs text-stone-700 italic">
                        {currentResponse.partner1AnswerText && (
                          <p>
                            <strong>{profile.partner1Name}:</strong> «
                            {currentResponse.partner1AnswerText}»
                          </p>
                        )}
                        {currentResponse.partner2AnswerText && (
                          <p>
                            <strong>{profile.partner2Name}:</strong> «
                            {currentResponse.partner2AnswerText}»
                          </p>
                        )}
                        {currentResponse.mainAnswerText && (
                          <p>«{currentResponse.mainAnswerText}»</p>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs sm:text-sm text-stone-700 italic">
                        «{currentResponse.mainAnswerText}»
                      </p>
                    )}
                  </div>

                  {/* AI Follow-Up Card */}
                  <div className="p-6 rounded-2xl bg-amber-50/70 border-2 border-amber-300/80 space-y-4 text-center">
                    <div className="flex items-center justify-center gap-2 text-amber-950">
                      <Sparkles className="w-4 h-4 text-amber-700 shrink-0" />
                      <span className="font-serif font-bold text-sm sm:text-base">
                        Forever You quiere conocer un poquito más...
                      </span>
                    </div>

                    <p className="font-serif text-lg sm:text-xl font-bold text-stone-900 leading-snug">
                      «{currentResponse.followUp?.followUpQuestion}»
                    </p>

                    {/* Follow-up Voice Recorder */}
                    <div className="bg-white/80 p-4 rounded-2xl border border-amber-200/90 space-y-2">
                      <label className="block text-xs font-bold text-stone-800 uppercase tracking-wide">
                        Graba tu profundización con tu voz:
                      </label>
                      <VoiceRecorder
                        token="demo"
                        isDemo={true}
                        questionId={`demo_followup_${currentQuestion.id}`}
                        questionText={currentResponse.followUp?.followUpQuestion || ''}
                        onVoiceSubmitted={(_audio, transcription) => {
                          if (transcription && transcription.trim()) {
                            const trimmed = transcription.trim();
                            updateCurrentResponse({
                              followUpAnswerText: currentResponse.followUpAnswerText
                                ? `${currentResponse.followUpAnswerText} ${trimmed}`
                                : trimmed,
                              followUpOmission: 'none',
                            });
                          }
                        }}
                      />
                    </div>

                    {profile.mode === 'individual' ? (
                      <textarea
                        rows={4}
                        value={currentResponse.followUpAnswerText || ''}
                        onChange={(e) =>
                          updateCurrentResponse({
                            followUpAnswerText: e.target.value,
                            followUpOmission: 'none',
                          })
                        }
                        placeholder="Comparte ese detalle especial..."
                        className="w-full p-4 rounded-xl bg-white border border-amber-300 text-sm sm:text-base text-stone-900 leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-600"
                      />
                    ) : (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-stone-800 mb-1">
                              {profile.partner1Name || 'Participante 1'}:
                            </label>
                            <textarea
                              rows={3}
                              value={currentResponse.partner1FollowUpText || ''}
                              onChange={(e) =>
                                updateCurrentResponse({
                                  partner1FollowUpText: e.target.value,
                                  followUpOmission: 'none',
                                })
                              }
                              placeholder={`Detalle de ${profile.partner1Name}...`}
                              className="w-full p-3 rounded-xl bg-white border border-amber-300 text-sm text-stone-900"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-stone-800 mb-1">
                              {profile.partner2Name || 'Participante 2'}:
                            </label>
                            <textarea
                              rows={3}
                              value={currentResponse.partner2FollowUpText || ''}
                              onChange={(e) =>
                                updateCurrentResponse({
                                  partner2FollowUpText: e.target.value,
                                  followUpOmission: 'none',
                                })
                              }
                              placeholder={`Detalle de ${profile.partner2Name}...`}
                              className="w-full p-3 rounded-xl bg-white border border-amber-300 text-sm text-stone-900"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-stone-700 mb-1">
                            O respuesta compartida:
                          </label>
                          <textarea
                            rows={2}
                            value={currentResponse.followUpAnswerText || ''}
                            onChange={(e) =>
                              updateCurrentResponse({
                                followUpAnswerText: e.target.value,
                                followUpOmission: 'none',
                              })
                            }
                            placeholder="Detalle compartido por ambos..."
                            className="w-full p-3 rounded-xl bg-white border border-amber-300 text-sm text-stone-900"
                          />
                        </div>
                      </div>
                    )}

                    {interviewError && (
                      <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center justify-center gap-2">
                        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>{interviewError}</span>
                      </div>
                    )}

                    {/* Follow-up Action Buttons - Centered */}
                    <div className="flex flex-wrap items-center justify-center gap-3 pt-4 border-t border-amber-200">
                      <button
                        type="button"
                        onClick={() => setShowingFollowUpForQuestionId(null)}
                        className="px-4 py-2.5 rounded-xl bg-white border border-stone-300 text-xs font-semibold text-stone-700 hover:bg-stone-100 cursor-pointer inline-flex items-center justify-center gap-1"
                      >
                        <ChevronLeft className="w-4 h-4" />
                        <span>Regresar</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSubmitFollowUpQuestion('not_recalled')}
                        className="px-4 py-2.5 rounded-xl bg-white/90 hover:bg-white border border-amber-300 text-xs font-medium text-stone-700 cursor-pointer"
                      >
                        No lo recuerdo
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSubmitFollowUpQuestion('prefer_not_to_answer')}
                        className="px-4 py-2.5 rounded-xl bg-white/90 hover:bg-white border border-amber-300 text-xs font-medium text-stone-700 cursor-pointer"
                      >
                        Prefiero no responder
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSubmitFollowUpQuestion('none')}
                        className="px-7 py-2.5 rounded-xl bg-amber-800 hover:bg-amber-900 text-white text-xs sm:text-sm font-semibold shadow-xs transition cursor-pointer inline-flex items-center justify-center gap-2"
                      >
                        <span>Continuar</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Stage Selector Menu - Placed AT THE VERY BOTTOM / END */}
            <div className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-5 shadow-xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-serif font-bold text-stone-900 text-sm">
                  Etapa {currentQuestion.stepNumber} de 5:{' '}
                  <span className="text-amber-900">
                    {profile.mode === 'pareja'
                      ? currentQuestion.coupleDimensionTitle
                      : currentQuestion.individualDimensionTitle}
                  </span>
                </span>
                <span className="text-stone-500 font-medium">
                  {completedDimensionsCount} de 5 etapas base • {generatedAiFollowUpsCount} de {DEMO_MAX_AI_FOLLOW_UPS} preguntas IA (8 en total)
                </span>
              </div>

              {/* 5 Stage Pills to review or correct previous answers */}
              <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                {DEMO_MAIN_QUESTIONS.map((q, idx) => {
                  const r = responses[q.id];
                  const isDone =
                    r &&
                    (r.mainOmission === 'not_recalled' ||
                      r.mainOmission === 'prefer_not_to_answer' ||
                      r.followUpCompleted);
                  const isCurrent = idx === currentStepIndex;

                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => {
                        setCurrentStepIndex(idx);
                        setShowingFollowUpForQuestionId(null);
                        setInterviewError(null);
                      }}
                      className={`p-2 rounded-xl border text-left transition cursor-pointer ${
                        isCurrent
                          ? 'bg-amber-800 text-white border-amber-900 shadow-xs'
                          : isDone
                          ? 'bg-emerald-50 text-emerald-950 border-emerald-200 hover:bg-emerald-100'
                          : 'bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] font-bold">
                        <span>{q.stepNumber}/5</span>
                        {isDone && <Check className="w-3 h-3" />}
                      </div>
                      <div className="text-[11px] font-medium truncate mt-0.5">
                        {profile.mode === 'pareja'
                          ? q.coupleDimensionTitle
                          : q.individualDimensionTitle}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* STEP 4: FINALIZACIÓN DE LA ENTREVISTA (Section 12)                */}
        {/* ================================================================= */}
        {phase === 'interview_completed' && (
          <div className="max-w-2xl mx-auto bg-white rounded-3xl border border-stone-200 shadow-sm p-8 sm:p-12 text-center space-y-6">
            <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center mx-auto">
              <Sparkles className="w-7 h-7" />
            </div>

            <h2 className="font-serif text-2xl sm:text-4xl font-bold text-stone-900">
              Tu historia comienza a tomar forma
            </h2>

            <p className="text-stone-600 text-sm sm:text-base leading-relaxed max-w-xl mx-auto">
              Gracias por compartir estos recuerdos. Cada palabra que nos has confiado forma parte de una historia que solo tú puedes contar. Ahora vamos a convertirlos en un pequeño libro creado especialmente para ti.
            </p>

            <div className="pt-3 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setCurrentStepIndex(DEMO_MAIN_QUESTIONS.length - 1);
                  setPhase('interview');
                }}
                className="px-5 py-3 rounded-xl border border-stone-300 text-xs sm:text-sm font-semibold text-stone-700 hover:bg-stone-100 transition cursor-pointer"
              >
                Revisar mis respuestas
              </button>

              <button
                type="button"
                data-testid="demo-design-my-book-btn"
                onClick={() => setPhase('narrative_style')}
                className="px-8 py-3.5 rounded-xl bg-amber-800 hover:bg-amber-900 text-white text-sm sm:text-base font-semibold shadow-md transition cursor-pointer inline-flex items-center gap-2"
              >
                <BookOpen className="w-4 h-4" />
                <span>Diseñar mi libro</span>
              </button>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* STEP 5: SELECCIÓN DEL ESTILO NARRATIVO (Section 13)               */}
        {/* ================================================================= */}
        {phase === 'narrative_style' && (
          <div className="max-w-4xl mx-auto bg-white rounded-3xl border border-stone-200 shadow-sm p-6 sm:p-10 space-y-8">
            <div className="text-center space-y-2">
              <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider">
                Configuración Literaria
              </span>
              <h2 className="font-serif text-2xl sm:text-3xl font-bold text-stone-900">
                ¿Cómo quieres que esté escrita tu historia?
              </h2>
              <p className="text-xs sm:text-sm text-stone-600 max-w-xl mx-auto">
                Elige la perspectiva literaria con la que YouForever redactará los capítulos de tu libro a partir de tus recuerdos reales.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {DEMO_NARRATIVE_STYLES.map((opt) => {
                const isSelected = narrativeStyle === opt.id;
                const title =
                  profile.mode === 'pareja' ? opt.coupleTitle : opt.individualTitle;
                const desc =
                  profile.mode === 'pareja'
                    ? opt.coupleDescription
                    : opt.individualDescription;
                const example =
                  profile.mode === 'pareja' ? opt.coupleExample : opt.individualExample;

                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setNarrativeStyle(opt.id)}
                    className={`p-5 rounded-2xl border-2 text-left flex flex-col justify-between transition cursor-pointer ${
                      isSelected
                        ? 'border-amber-700 bg-amber-50/50 shadow-md ring-2 ring-amber-200'
                        : 'border-stone-200 bg-white hover:border-stone-300'
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        {opt.recommended ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-800 text-white">
                            Recomendada
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-stone-100 text-stone-600">
                            Opción narrativa
                          </span>
                        )}
                        {isSelected && (
                          <span className="w-5 h-5 rounded-full bg-amber-800 text-white flex items-center justify-center text-xs">
                            ✓
                          </span>
                        )}
                      </div>

                      <h3 className="font-serif text-base font-bold text-stone-900 leading-snug">
                        {title}
                      </h3>

                      <p className="text-xs text-stone-600 leading-relaxed">{desc}</p>

                      <div className="p-3 rounded-xl bg-[#FAF8F5] border border-stone-200/80 text-xs italic text-stone-800 font-serif leading-relaxed">
                        {example}
                      </div>
                    </div>

                    <div className="pt-4 mt-4 border-t border-stone-200/70 flex flex-wrap gap-1.5">
                      {opt.characteristics.map((ch) => (
                        <span
                          key={ch}
                          className="px-2 py-0.5 rounded-md bg-stone-100 text-[10px] font-medium text-stone-700"
                        >
                          {ch}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            {manuscriptError && (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-900 space-y-2">
                <div className="flex items-center gap-2 font-bold">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{manuscriptError}</span>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleGenerateManuscript(narrativeStyle)}
                    className="px-3.5 py-1.5 bg-rose-800 text-white rounded-lg font-semibold cursor-pointer"
                  >
                    Reintentar generación con IA
                  </button>
                  <button
                    type="button"
                    onClick={handleUseFaithfulFallbackManuscript}
                    className="px-3.5 py-1.5 bg-white border border-rose-300 text-rose-900 rounded-lg font-semibold cursor-pointer"
                  >
                    Continuar al diseñador con mis respuestas fieles
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setPhase('interview_completed')}
                className="px-4 py-2.5 rounded-xl border border-stone-300 text-xs font-semibold text-stone-700 hover:bg-stone-100 cursor-pointer inline-flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Volver</span>
              </button>

              <button
                type="button"
                disabled={Boolean(systemStatusMessage)}
                onClick={() => {
                  if (hasManualEdits && workingManuscript) {
                    setPendingStyleChange(narrativeStyle);
                  } else {
                    handleGenerateManuscript(narrativeStyle);
                  }
                }}
                className="px-7 py-3.5 rounded-xl bg-amber-800 hover:bg-amber-900 disabled:opacity-50 text-white text-sm font-semibold shadow-md transition cursor-pointer inline-flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                <span>
                  {systemStatusMessage
                    ? 'Redactando tu libro...'
                    : 'Generar mi manuscrito y diseñar libro'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* STEP 6: CONFIGURADOR EDITORIAL, EDITOR Y VISOR INTERACTIVO        */}
        {/* ================================================================= */}
        {phase === 'editorial_studio' && workingManuscript && composedBook && (
          <div className="space-y-8">
            {/* Editorial Studio Header & Post-Generation Action Bar (Sections 15 & 28) */}
            <div className="bg-white rounded-3xl border border-stone-200 shadow-xs p-5 sm:p-7 space-y-5">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-stone-100 pb-4">
                <div>
                  <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider">
                    Estudio Editorial YouForever
                  </span>
                  <h2 className="font-serif text-2xl sm:text-3xl font-bold text-stone-900">
                    Diseña el libro que contará tu historia
                  </h2>
                </div>

                {/* Primary Download Action & Secondary Actions (Section 28) */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    data-testid="demo-download-pdf-btn"
                    onClick={handleDownloadPdf}
                    className="px-5 py-3 rounded-xl bg-amber-800 hover:bg-amber-900 text-white text-xs sm:text-sm font-bold shadow-sm transition cursor-pointer inline-flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>Descargar mi libro en PDF</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStudioTab('reader')}
                    className={`px-3.5 py-2.5 rounded-xl text-xs font-semibold border transition cursor-pointer inline-flex items-center gap-1.5 ${
                      studioTab === 'reader'
                        ? 'bg-stone-900 text-white border-stone-900'
                        : 'bg-stone-100 text-stone-800 border-stone-300 hover:bg-stone-200'
                    }`}
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Leer mi libro</span>
                  </button>
                </div>
              </div>

              {/* Navigation Pills for All Secondary Actions (Section 28) */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStudioTab('design')}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer inline-flex items-center gap-1.5 ${
                      studioTab === 'design'
                        ? 'bg-amber-800 text-white shadow-xs'
                        : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                    }`}
                  >
                    <Palette className="w-3.5 h-3.5" />
                    <span>Cambiar portada y diseño interior</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStudioTab('edit')}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer inline-flex items-center gap-1.5 ${
                      studioTab === 'edit'
                        ? 'bg-amber-800 text-white shadow-xs'
                        : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                    }`}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Editar mi historia</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPhase('narrative_style')}
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-stone-100 text-stone-700 hover:bg-stone-200 transition cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-800" />
                    <span>Cambiar estilo narrativo</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowNewBookConfirmModal(true)}
                    className="px-3 py-2 rounded-xl text-xs font-semibold bg-stone-100 text-stone-700 hover:bg-stone-200 transition cursor-pointer inline-flex items-center gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Crear otro libro</span>
                  </button>
                </div>
              </div>
            </div>

            {/* ============================================================= */}
            {/* SUB-TAB 1: DISEÑO DE PORTADA, INTERIORES Y FORMATO FÍSICO     */}
            {/* ============================================================= */}
            {studioTab === 'design' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                {/* Left Column (7 cols): Galleries & Controls */}
                <div className="lg:col-span-7 space-y-6">
                  {/* 5 Cover Designs Gallery (Section 16) */}
                  <div className="bg-white rounded-3xl border border-stone-200 p-6 space-y-4">
                    <div>
                      <h3 className="font-serif text-lg font-bold text-stone-900">
                        1. Selecciona uno de los 5 diseños de portada
                      </h3>
                      <p className="text-xs text-stone-500">
                        Cada portada cuenta con composición editorial, tipografía y ornamentos propios.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      {DEMO_COVER_DESIGNS.map((cov) => {
                        const selected = editorialConfig.coverDesignId === cov.id;
                        const palette =
                          cov.variants[
                            selected ? editorialConfig.coverColorVariantIdx : 0
                          ] || cov.variants[0];
                        return (
                          <DemoCoverThumbnailCard
                            key={cov.id}
                            design={cov}
                            palette={palette}
                            title={editorialConfig.customTitle || workingManuscript.title}
                            authors={editorialConfig.customAuthors || workingManuscript.authors}
                            selected={selected}
                            onSelect={() =>
                              setEditorialConfig((prev) => ({
                                ...prev,
                                coverDesignId: cov.id,
                                coverColorVariantIdx: 0,
                              }))
                            }
                          />
                        );
                      })}
                    </div>

                    {/* Predefined Color Variants for Active Cover */}
                    <div className="pt-2 border-t border-stone-100 flex flex-wrap items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-stone-700">
                        Variante de color de la portada:
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {composedBook.coverDesign.variants.map((variant, vIdx) => (
                          <button
                            key={variant.name}
                            type="button"
                            onClick={() =>
                              setEditorialConfig((prev) => ({
                                ...prev,
                                coverColorVariantIdx: vIdx,
                              }))
                            }
                            className={`px-3 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-2 cursor-pointer ${
                              editorialConfig.coverColorVariantIdx === vIdx
                                ? 'border-amber-700 bg-amber-50 text-stone-900 font-bold'
                                : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'
                            }`}
                          >
                            <span
                              className="w-3.5 h-3.5 rounded-full border border-black/20"
                              style={{ backgroundColor: variant.bgHex }}
                            />
                            <span>{variant.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Cover Image / Illustration / Typographic Only Selector (Section 16.1 & 25) */}
                    <div className="pt-3 border-t border-stone-100 space-y-3">
                      <span className="text-xs font-semibold text-stone-700 block">
                        Elemento visual en portada (opcional):
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setEditorialConfig((prev) => ({
                              ...prev,
                              coverVisualType: 'illustration',
                            }))
                          }
                          className={`px-3.5 py-2 rounded-xl text-xs font-semibold border cursor-pointer ${
                            editorialConfig.coverVisualType === 'illustration'
                              ? 'bg-amber-800 text-white border-amber-800'
                              : 'bg-stone-50 text-stone-700 border-stone-200'
                          }`}
                        >
                          Ilustración temática original
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setEditorialConfig((prev) => ({
                              ...prev,
                              coverVisualType: 'photo',
                            }))
                          }
                          className={`px-3.5 py-2 rounded-xl text-xs font-semibold border cursor-pointer ${
                            editorialConfig.coverVisualType === 'photo'
                              ? 'bg-amber-800 text-white border-amber-800'
                              : 'bg-stone-50 text-stone-700 border-stone-200'
                          }`}
                        >
                          Subir fotografía propia
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setEditorialConfig((prev) => ({
                              ...prev,
                              coverVisualType: 'none',
                            }))
                          }
                          className={`px-3.5 py-2 rounded-xl text-xs font-semibold border cursor-pointer ${
                            editorialConfig.coverVisualType === 'none'
                              ? 'bg-amber-800 text-white border-amber-800'
                              : 'bg-stone-50 text-stone-700 border-stone-200'
                          }`}
                        >
                          Portada solo tipográfica
                        </button>
                      </div>

                      {editorialConfig.coverVisualType === 'illustration' && (
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
                          {DEMO_THEMATIC_ILLUSTRATIONS.map((ill) => (
                            <button
                              key={ill.id}
                              type="button"
                              onClick={() =>
                                setEditorialConfig((prev) => ({
                                  ...prev,
                                  coverIllustrationId: ill.id,
                                }))
                              }
                              className={`p-2 rounded-xl border text-left text-[11px] cursor-pointer ${
                                editorialConfig.coverIllustrationId === ill.id
                                  ? 'border-amber-700 bg-amber-50 font-bold text-amber-950'
                                  : 'border-stone-200 bg-white text-stone-700'
                              }`}
                            >
                              {ill.label}
                            </button>
                          ))}
                        </div>
                      )}

                      {editorialConfig.coverVisualType === 'photo' && (
                        <div className="p-4 rounded-2xl bg-[#FAF8F5] border border-stone-200 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <label className="px-4 py-2 bg-amber-800 hover:bg-amber-900 text-white text-xs font-semibold rounded-xl cursor-pointer inline-flex items-center gap-1.5">
                              <Upload className="w-3.5 h-3.5" />
                              <span>
                                {coverPhoto
                                  ? 'Cambiar fotografía de portada'
                                  : 'Seleccionar fotografía (JPG, PNG, WebP)'}
                              </span>
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                className="sr-only"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    processUploadedPhotoFile(file, (newPhoto) => {
                                      setCoverPhoto((prev) => {
                                        if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);
                                        return newPhoto;
                                      });
                                    });
                                  }
                                }}
                              />
                            </label>

                            {coverPhoto && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (coverPhoto.objectUrl) {
                                    URL.revokeObjectURL(coverPhoto.objectUrl);
                                  }
                                  setCoverPhoto(null);
                                  setEditorialConfig((prev) => ({
                                    ...prev,
                                    coverVisualType: 'none',
                                  }));
                                }}
                                className="px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 rounded-lg cursor-pointer inline-flex items-center gap-1"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Eliminar fotografía</span>
                              </button>
                            )}
                          </div>

                          {coverPhoto && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-xs">
                              <div>
                                <span className="font-semibold text-stone-700 block mb-1">
                                  Encuadre vertical:
                                </span>
                                <div className="flex gap-1.5">
                                  {(['top', 'center', 'bottom'] as const).map((pos) => (
                                    <button
                                      key={pos}
                                      type="button"
                                      onClick={() =>
                                        setCoverPhoto((prev) =>
                                          prev ? { ...prev, focusY: pos } : null
                                        )
                                      }
                                      className={`px-2.5 py-1 rounded-lg border cursor-pointer ${
                                        coverPhoto.focusY === pos
                                          ? 'bg-stone-800 text-white border-stone-800'
                                          : 'bg-white text-stone-700 border-stone-300'
                                      }`}
                                    >
                                      {pos === 'top'
                                        ? 'Superior'
                                        : pos === 'center'
                                        ? 'Centro'
                                        : 'Inferior'}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div>
                                <label className="font-semibold text-stone-700 block mb-1">
                                  Ajuste de acercamiento ({Math.round((coverPhoto.zoom || 1) * 100)}%):
                                </label>
                                <input
                                  type="range"
                                  min={1}
                                  max={1.4}
                                  step={0.05}
                                  value={coverPhoto.zoom || 1}
                                  onChange={(e) =>
                                    setCoverPhoto((prev) =>
                                      prev ? { ...prev, zoom: Number(e.target.value) } : null
                                    )
                                  }
                                  className="w-full accent-amber-800"
                                />
                              </div>
                            </div>
                          )}

                          {photoError && (
                            <p className="text-xs text-rose-700 font-medium">{photoError}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 5 Independent Interior Styles Gallery (Section 17) */}
                  <div className="bg-white rounded-3xl border border-stone-200 p-6 space-y-4">
                    <div>
                      <h3 className="font-serif text-lg font-bold text-stone-900">
                        2. Selecciona uno de los 5 diseños de interiores
                      </h3>
                      <p className="text-xs text-stone-500">
                        Totalmente independiente de la portada. Combina cualquier portada con cualquier tipografía y maquetación interior.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      {DEMO_INTERIOR_STYLES.map((styleSpec) => (
                        <DemoInteriorThumbnailCard
                          key={styleSpec.id}
                          styleSpec={styleSpec}
                          selected={editorialConfig.interiorStyleId === styleSpec.id}
                          onSelect={() =>
                            setEditorialConfig((prev) => ({
                              ...prev,
                              interiorStyleId: styleSpec.id,
                            }))
                          }
                        />
                      ))}
                    </div>
                  </div>

                  {/* 3 Physical Book Formats (Section 18) */}
                  <div className="bg-white rounded-3xl border border-stone-200 p-6 space-y-4">
                    <div>
                      <h3 className="font-serif text-lg font-bold text-stone-900">
                        3. Formato físico y dimensiones del PDF
                      </h3>
                      <p className="text-xs text-stone-500">
                        Al cambiar el formato se recalculan las dimensiones físicas, márgenes y saltos de página reales.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {DEMO_BOOK_FORMATS.map((fmt) => {
                        const selected = editorialConfig.bookFormatId === fmt.id;
                        return (
                          <button
                            key={fmt.id}
                            type="button"
                            onClick={() =>
                              setEditorialConfig((prev) => ({
                                ...prev,
                                bookFormatId: fmt.id,
                              }))
                            }
                            className={`p-4 rounded-2xl border-2 text-left transition cursor-pointer ${
                              selected
                                ? 'border-amber-700 bg-amber-50/50 shadow-xs'
                                : 'border-stone-200 bg-white hover:border-stone-300'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-serif font-bold text-sm text-stone-900">
                                {fmt.name}
                              </span>
                              <span className="text-[10px] font-mono text-amber-900 bg-amber-100 px-2 py-0.5 rounded">
                                {fmt.dimensionsLabel}
                              </span>
                            </div>
                            <p className="text-xs text-stone-600 mt-1.5">{fmt.description}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Quick Cover Metadata Customization */}
                  <div className="bg-white rounded-3xl border border-stone-200 p-6 space-y-4">
                    <h3 className="font-serif text-lg font-bold text-stone-900">
                      4. Personalización de títulos y dedicatoria
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1">
                          Título del libro:
                        </label>
                        <input
                          type="text"
                          value={editorialConfig.customTitle}
                          onChange={(e) =>
                            setEditorialConfig((prev) => ({
                              ...prev,
                              customTitle: e.target.value,
                            }))
                          }
                          className="w-full px-3.5 py-2 border border-stone-300 rounded-xl text-xs sm:text-sm text-stone-900"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1">
                          Autor o protagonista(s):
                        </label>
                        <input
                          type="text"
                          value={editorialConfig.customAuthors}
                          onChange={(e) =>
                            setEditorialConfig((prev) => ({
                              ...prev,
                              customAuthors: e.target.value,
                            }))
                          }
                          className="w-full px-3.5 py-2 border border-stone-300 rounded-xl text-xs sm:text-sm text-stone-900"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-stone-700 mb-1">
                        Subtítulo de portada:
                      </label>
                      <input
                        type="text"
                        value={editorialConfig.customSubtitle}
                        onChange={(e) =>
                          setEditorialConfig((prev) => ({
                            ...prev,
                            customSubtitle: e.target.value,
                          }))
                        }
                        className="w-full px-3.5 py-2 border border-stone-300 rounded-xl text-xs sm:text-sm text-stone-900"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-stone-700 mb-1">
                        Dedicatoria (aparece en la portadilla interior):
                      </label>
                      <textarea
                        rows={2}
                        value={editorialConfig.dedication}
                        onChange={(e) =>
                          setEditorialConfig((prev) => ({
                            ...prev,
                            dedication: e.target.value,
                          }))
                        }
                        placeholder="Para quienes amo con todo mi corazón..."
                        className="w-full p-3 border border-stone-300 rounded-xl text-xs sm:text-sm text-stone-900"
                      />
                    </div>
                  </div>
                </div>

                {/* Right Column (5 cols): Live Large Preview of Cover & Interior */}
                <div className="lg:col-span-5 lg:sticky lg:top-24 space-y-4">
                  <div className="bg-stone-900 text-stone-100 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[11px] uppercase tracking-wider text-amber-400 font-bold">
                          Vista previa en tiempo real
                        </span>
                        <h4 className="font-serif text-base font-bold text-white">
                          Página {currentPageIndex + 1} de {composedBook.pages.length} • Formato{' '}
                          {composedBook.format.name}
                        </h4>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={currentPageIndex === 0}
                          onClick={handlePrevPage}
                          className="p-2 rounded-lg bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-200 cursor-pointer"
                          aria-label="Página anterior"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          disabled={currentPageIndex >= composedBook.pages.length - 1}
                          onClick={handleNextPage}
                          className="p-2 rounded-lg bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-200 cursor-pointer"
                          aria-label="Página siguiente"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Rendered Page Preview */}
                    <div className="max-w-xs mx-auto">
                      <DemoComposedPageView
                        composed={composedBook}
                        page={composedBook.pages[currentPageIndex] || composedBook.pages[0]}
                        className="rounded-xl"
                      />
                    </div>

                    {/* Quick Page Selector Dots */}
                    <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                      {composedBook.pages.map((p, idx) => (
                        <button
                          key={p.pageNumber}
                          type="button"
                          onClick={() => setCurrentPageIndex(idx)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                            idx === currentPageIndex
                              ? 'bg-amber-600 text-white'
                              : 'bg-stone-800 text-stone-400 hover:text-white'
                          }`}
                        >
                          {p.pageNumber === 1
                            ? 'Portada'
                            : p.kind === 'closing_mandatory'
                            ? 'Cierre'
                            : `Pág. ${p.pageNumber}`}
                        </button>
                      ))}
                    </div>

                    <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
                      <button
                        type="button"
                        onClick={() => setStudioTab('reader')}
                        className="flex-1 py-3 px-4 rounded-xl bg-amber-700 hover:bg-amber-600 text-white text-xs font-bold transition cursor-pointer inline-flex items-center justify-center gap-2"
                      >
                        <BookOpen className="w-4 h-4" />
                        <span>Abrir Visor Interactivo Completo</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadPdf}
                        className="py-3 px-4 rounded-xl bg-stone-800 hover:bg-stone-700 text-amber-200 text-xs font-bold border border-stone-700 transition cursor-pointer inline-flex items-center justify-center gap-1.5"
                      >
                        <Download className="w-4 h-4" />
                        <span>Descargar PDF</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================= */}
            {/* SUB-TAB 2: EDITOR DE MANUSCRITO Y FOTOGRAFÍAS DE CAPÍTULO      */}
            {/* ============================================================= */}
            {studioTab === 'edit' && (
              <div className="bg-white rounded-3xl border border-stone-200 p-6 sm:p-8 space-y-6">
                {/* Editor Toolbar: Bold, Italic, Undo, Redo, Restore AI (Section 24.1) */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-stone-200 sticky top-16 bg-white z-20 py-2">
                  <div>
                    <h3 className="font-serif text-lg font-bold text-stone-900">
                      Editor del Manuscrito Autobiográfico
                    </h3>
                    <p className="text-xs text-stone-500">
                      Edita libremente párrafos, títulos o fotografías antes de descargar tu versión definitiva.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleFormatSelection('**')}
                      className="px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-bold text-stone-800 hover:bg-stone-100 cursor-pointer inline-flex items-center gap-1"
                      title="Aplicar negritas al texto seleccionado"
                    >
                      <Bold className="w-3.5 h-3.5" />
                      <span>Negrita</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleFormatSelection('*')}
                      className="px-3 py-1.5 rounded-lg border border-stone-300 text-xs italic text-stone-800 hover:bg-stone-100 cursor-pointer inline-flex items-center gap-1"
                      title="Aplicar cursivas al texto seleccionado"
                    >
                      <Italic className="w-3.5 h-3.5" />
                      <span>Cursiva</span>
                    </button>

                    <button
                      type="button"
                      disabled={undoStack.length === 0}
                      onClick={handleUndoManuscriptEdit}
                      className="px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-semibold text-stone-700 hover:bg-stone-100 disabled:opacity-40 cursor-pointer inline-flex items-center gap-1"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                      <span>Deshacer</span>
                    </button>

                    <button
                      type="button"
                      disabled={redoStack.length === 0}
                      onClick={handleRedoManuscriptEdit}
                      className="px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-semibold text-stone-700 hover:bg-stone-100 disabled:opacity-40 cursor-pointer inline-flex items-center gap-1"
                    >
                      <Redo2 className="w-3.5 h-3.5" />
                      <span>Rehacer</span>
                    </button>

                    {hasManualEdits && aiGeneratedManuscript && (
                      <button
                        type="button"
                        onClick={handleRestoreAiManuscript}
                        className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-300 text-xs font-semibold text-amber-900 hover:bg-amber-100 cursor-pointer inline-flex items-center gap-1"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Restaurar versión IA</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Introduction Editor */}
                <div className="p-4 rounded-2xl bg-[#FAF8F5] border border-stone-200 space-y-2">
                  <label className="block text-xs font-bold text-stone-800 uppercase tracking-wider">
                    Texto Introductorio (Portadilla)
                  </label>
                  <textarea
                    rows={3}
                    value={workingManuscript.introduction}
                    onChange={(e) =>
                      mutateWorkingManuscript((ms) => ({
                        ...ms,
                        introduction: e.target.value,
                      }))
                    }
                    className="w-full p-3 bg-white border border-stone-300 rounded-xl text-xs sm:text-sm text-stone-900 leading-relaxed"
                  />
                </div>

                {/* Chapters Editor */}
                <div className="space-y-6">
                  {workingManuscript.chapters.map((ch, chIdx) => {
                    const chPhoto = chapterPhotos[ch.id] || null;
                    return (
                      <div
                        key={ch.id}
                        className="p-5 rounded-2xl border border-stone-200 bg-white shadow-2xs space-y-4"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-100 pb-3">
                          <div className="flex-1">
                            <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">
                              Capítulo {ch.partNumber}
                            </span>
                            <input
                              type="text"
                              value={ch.title}
                              onChange={(e) =>
                                mutateWorkingManuscript((ms) => {
                                  const next = [...ms.chapters];
                                  next[chIdx] = { ...next[chIdx], title: e.target.value };
                                  return { ...ms, chapters: next };
                                })
                              }
                              className="w-full mt-1 px-3 py-1.5 font-serif text-base font-bold text-stone-900 border border-stone-300 rounded-xl"
                            />
                          </div>

                          {/* Optional Chapter Photo Upload */}
                          <div className="flex items-center gap-2">
                            <label className="px-3 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5">
                              <ImageIcon className="w-3.5 h-3.5 text-amber-800" />
                              <span>
                                {chPhoto ? 'Cambiar foto del capítulo' : 'Añadir foto al capítulo'}
                              </span>
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                className="sr-only"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    processUploadedPhotoFile(file, (newPhoto) => {
                                      setChapterPhotos((prev) => {
                                        if (prev[ch.id]?.objectUrl) {
                                          URL.revokeObjectURL(prev[ch.id]!.objectUrl);
                                        }
                                        return { ...prev, [ch.id]: newPhoto };
                                      });
                                    });
                                  }
                                }}
                              />
                            </label>

                            {chPhoto && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (chPhoto.objectUrl) URL.revokeObjectURL(chPhoto.objectUrl);
                                  setChapterPhotos((prev) => ({ ...prev, [ch.id]: null }));
                                }}
                                className="p-2 text-rose-700 hover:bg-rose-50 rounded-xl cursor-pointer"
                                title="Eliminar fotografía de este capítulo"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {chPhoto && (
                          <div className="flex items-center gap-4 p-3 rounded-xl bg-stone-50 border border-stone-200">
                            <img
                              src={chPhoto.objectUrl || chPhoto.dataUrl}
                              alt="Vista previa capítulo"
                              className="w-16 h-16 object-cover rounded-lg border border-stone-300"
                            />
                            <div className="flex-1">
                              <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                                Pie de foto (opcional):
                              </label>
                              <input
                                type="text"
                                value={chPhoto.caption || ''}
                                onChange={(e) =>
                                  setChapterPhotos((prev) => ({
                                    ...prev,
                                    [ch.id]: prev[ch.id]
                                      ? { ...prev[ch.id]!, caption: e.target.value }
                                      : null,
                                  }))
                                }
                                placeholder="Ej. En casa de los abuelos..."
                                className="w-full px-3 py-1.5 bg-white border border-stone-300 rounded-lg text-xs"
                              />
                            </div>
                          </div>
                        )}

                        {/* Paragraphs */}
                        <div className="space-y-3">
                          {ch.paragraphs.map((para, pIdx) => (
                            <div key={pIdx} className="space-y-1">
                              <div className="flex items-center justify-between text-[11px] text-stone-500">
                                <span>Párrafo {pIdx + 1}</span>
                                {ch.paragraphs.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      mutateWorkingManuscript((ms) => {
                                        const next = [...ms.chapters];
                                        const nextParas = next[chIdx].paragraphs.filter(
                                          (_, i) => i !== pIdx
                                        );
                                        next[chIdx] = { ...next[chIdx], paragraphs: nextParas };
                                        return { ...ms, chapters: next };
                                      })
                                    }
                                    className="text-rose-600 hover:underline cursor-pointer"
                                  >
                                    Eliminar párrafo
                                  </button>
                                )}
                              </div>
                              <textarea
                                rows={3}
                                value={para}
                                onFocus={(e) => {
                                  activeEditorTextareaRef.current = e.currentTarget;
                                  setActiveEditTarget({ chapterIdx: chIdx, paraIdx: pIdx });
                                }}
                                onChange={(e) =>
                                  mutateWorkingManuscript((ms) => {
                                    const next = [...ms.chapters];
                                    const nextParas = [...next[chIdx].paragraphs];
                                    nextParas[pIdx] = e.target.value;
                                    next[chIdx] = { ...next[chIdx], paragraphs: nextParas };
                                    return { ...ms, chapters: next };
                                  })
                                }
                                className="w-full p-3 border border-stone-300 rounded-xl text-xs sm:text-sm text-stone-900 leading-relaxed"
                              />
                            </div>
                          ))}

                          <button
                            type="button"
                            onClick={() =>
                              mutateWorkingManuscript((ms) => {
                                const next = [...ms.chapters];
                                next[chIdx] = {
                                  ...next[chIdx],
                                  paragraphs: [...next[chIdx].paragraphs, 'Nuevo párrafo...'],
                                };
                                return { ...ms, chapters: next };
                              })
                            }
                            className="px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-xs font-semibold text-stone-700 cursor-pointer inline-flex items-center gap-1"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Añadir párrafo</span>
                          </button>
                        </div>

                        {/* Pull Quote */}
                        <div>
                          <label className="block text-xs font-semibold text-stone-700 mb-1">
                            Cita textual destacada del capítulo (opcional):
                          </label>
                          <input
                            type="text"
                            value={ch.pullQuote || ''}
                            onChange={(e) =>
                              mutateWorkingManuscript((ms) => {
                                const next = [...ms.chapters];
                                next[chIdx] = { ...next[chIdx], pullQuote: e.target.value };
                                return { ...ms, chapters: next };
                              })
                            }
                            className="w-full px-3.5 py-2 border border-stone-300 rounded-xl text-xs italic text-stone-800"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Closing Message Editor */}
                <div className="p-4 rounded-2xl bg-[#FAF8F5] border border-stone-200 space-y-2">
                  <label className="block text-xs font-bold text-stone-800 uppercase tracking-wider">
                    Mensaje Final de Legado
                  </label>
                  <textarea
                    rows={3}
                    value={workingManuscript.closingMessage}
                    onChange={(e) =>
                      mutateWorkingManuscript((ms) => ({
                        ...ms,
                        closingMessage: e.target.value,
                      }))
                    }
                    className="w-full p-3 bg-white border border-stone-300 rounded-xl text-xs sm:text-sm text-stone-900 leading-relaxed"
                  />
                </div>
              </div>
            )}

            {/* ============================================================= */}
            {/* SUB-TAB 3: VISOR DE LIBRO INTERACTIVO Y LECTOR PDF (Sec. 23)  */}
            {/* ============================================================= */}
            {studioTab === 'reader' && (
              <div
                ref={viewerContainerRef}
                className={`bg-stone-900 text-stone-100 rounded-3xl p-5 sm:p-8 shadow-2xl space-y-6 ${
                  isFullscreenViewer ? 'fixed inset-0 z-50 rounded-none overflow-y-auto' : ''
                }`}
              >
                {/* Viewer Mode & Controls Bar */}
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-800 pb-4">
                  {/* Mode Switcher: Modo A (Libro Interactivo) vs Modo B (Lector PDF) */}
                  <div className="flex items-center gap-2 bg-stone-800 p-1 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setViewerMode('flipbook')}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                        viewerMode === 'flipbook'
                          ? 'bg-amber-700 text-white shadow-xs'
                          : 'text-stone-300 hover:text-white'
                      }`}
                    >
                      Modo A — Libro Interactivo
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewerMode('pdf_reader')}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                        viewerMode === 'pdf_reader'
                          ? 'bg-amber-700 text-white shadow-xs'
                          : 'text-stone-300 hover:text-white'
                      }`}
                    >
                      Modo B — Lector PDF
                    </button>
                  </div>

                  {/* Mode-specific Controls */}
                  <div className="flex flex-wrap items-center gap-2">
                    {viewerMode === 'flipbook' ? (
                      <label className="flex items-center gap-2 text-xs text-stone-300 cursor-pointer px-2">
                        <input
                          type="checkbox"
                          checked={enablePageAnimation}
                          onChange={(e) => setEnablePageAnimation(e.target.checked)}
                          className="rounded border-stone-600 text-amber-600"
                        />
                        <span>Animación de paso de página</span>
                      </label>
                    ) : (
                      <div className="flex items-center gap-1.5 bg-stone-800 px-2.5 py-1 rounded-xl text-xs">
                        <button
                          type="button"
                          onClick={() => setReaderZoom((z) => Math.max(60, z - 15))}
                          className="p-1 hover:text-amber-300 cursor-pointer"
                          title="Reducir zoom"
                        >
                          <ZoomOut className="w-4 h-4" />
                        </button>
                        <span className="font-mono text-[11px] px-1">{readerZoom}%</span>
                        <button
                          type="button"
                          onClick={() => setReaderZoom((z) => Math.min(160, z + 15))}
                          className="p-1 hover:text-amber-300 cursor-pointer"
                          title="Aumentar zoom"
                        >
                          <ZoomIn className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setReaderFitMode('width');
                            setReaderZoom(115);
                          }}
                          className={`px-2 py-0.5 rounded text-[10px] cursor-pointer ${
                            readerFitMode === 'width'
                              ? 'bg-amber-700 text-white'
                              : 'text-stone-300'
                          }`}
                        >
                          Ajustar al ancho
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setReaderFitMode('page');
                            setReaderZoom(95);
                          }}
                          className={`px-2 py-0.5 rounded text-[10px] cursor-pointer ${
                            readerFitMode === 'page'
                              ? 'bg-amber-700 text-white'
                              : 'text-stone-300'
                          }`}
                        >
                          Ajustar a la página
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleToggleFullscreen}
                      className="p-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 cursor-pointer"
                      title="Ver a pantalla completa"
                    >
                      {isFullscreenViewer ? (
                        <Minimize2 className="w-4 h-4" />
                      ) : (
                        <Maximize2 className="w-4 h-4" />
                      )}
                    </button>

                    {pdfArtifact?.blobUrl && (
                      <a
                        href={pdfArtifact.blobUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-xs font-semibold text-stone-200 inline-flex items-center gap-1.5"
                        title="Abrir el archivo PDF en lector externo"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Abrir en lector externo</span>
                      </a>
                    )}

                    <button
                      type="button"
                      onClick={handleDownloadPdf}
                      className="px-4 py-2 rounded-xl bg-amber-700 hover:bg-amber-600 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Descargar PDF</span>
                    </button>
                  </div>
                </div>

                {/* MODO A — LIBRO INTERACTIVO */}
                {viewerMode === 'flipbook' && (
                  <div
                    className="space-y-6"
                    onTouchStart={(e) => {
                      touchStartXRef.current = e.touches[0]?.clientX ?? null;
                    }}
                    onTouchEnd={(e) => {
                      if (touchStartXRef.current === null) return;
                      const deltaX =
                        (e.changedTouches[0]?.clientX ?? touchStartXRef.current) -
                        touchStartXRef.current;
                      touchStartXRef.current = null;
                      if (deltaX < -45) handleNextPage();
                      if (deltaX > 45) handlePrevPage();
                    }}
                  >
                    {/* Spread or Single Page Stage */}
                    <div
                      className={`transition-all duration-300 ${
                        isTurningPage && enablePageAnimation
                          ? 'opacity-80 scale-[0.99]'
                          : 'opacity-100 scale-100'
                      }`}
                    >
                      {currentPageIndex === 0 ||
                      currentPageIndex === composedBook.pages.length - 1 ? (
                        <div className="max-w-sm mx-auto">
                          <DemoComposedPageView
                            composed={composedBook}
                            page={composedBook.pages[currentPageIndex]}
                            className="rounded-xl shadow-2xl"
                          />
                        </div>
                      ) : (
                        /* Desktop 2-page spread when viewing interior pages; single page on mobile */
                        <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                          <div>
                            <DemoComposedPageView
                              composed={composedBook}
                              page={composedBook.pages[currentPageIndex]}
                              className="rounded-l-xl shadow-2xl"
                            />
                          </div>
                          {composedBook.pages[currentPageIndex + 1] && (
                            <div className="hidden md:block">
                              <DemoComposedPageView
                                composed={composedBook}
                                page={composedBook.pages[currentPageIndex + 1]}
                                className="rounded-r-xl shadow-2xl"
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Flipbook Bottom Navigation Bar */}
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 border-t border-stone-800">
                      <button
                        type="button"
                        disabled={currentPageIndex === 0}
                        onClick={handlePrevPage}
                        className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-xs font-semibold text-white cursor-pointer inline-flex items-center justify-center gap-2"
                      >
                        <ChevronLeft className="w-4 h-4" />
                        <span>Página anterior</span>
                      </button>

                      <div className="flex flex-wrap items-center justify-center gap-1.5">
                        {composedBook.pages.map((p, idx) => (
                          <button
                            key={p.pageNumber}
                            type="button"
                            onClick={() => setCurrentPageIndex(idx)}
                            className={`w-7 h-7 rounded-lg text-xs font-bold transition cursor-pointer ${
                              idx === currentPageIndex
                                ? 'bg-amber-600 text-white'
                                : 'bg-stone-800 text-stone-400 hover:text-white'
                            }`}
                          >
                            {p.pageNumber}
                          </button>
                        ))}
                      </div>

                      <button
                        type="button"
                        disabled={currentPageIndex >= composedBook.pages.length - 1}
                        onClick={handleNextPage}
                        className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-600 disabled:opacity-40 text-xs font-semibold text-white cursor-pointer inline-flex items-center justify-center gap-2"
                      >
                        <span>Página siguiente</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {/* MODO B — LECTOR PDF (Desplazamiento vertical, zoom y navegación por página) */}
                {viewerMode === 'pdf_reader' && (
                  <div className="space-y-6">
                    {/* Direct Page Number Jump */}
                    <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
                      <span className="text-stone-400">Ir a página:</span>
                      {composedBook.pages.map((p) => (
                        <a
                          key={p.pageNumber}
                          href={`#demo-pdf-page-${p.pageNumber}`}
                          className="px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-amber-700 text-stone-200 font-semibold"
                        >
                          {p.pageNumber}
                        </a>
                      ))}
                    </div>

                    <div className="space-y-8 max-h-[75vh] overflow-y-auto px-2 py-4">
                      {composedBook.pages.map((p) => (
                        <div
                          key={p.pageNumber}
                          id={`demo-pdf-page-${p.pageNumber}`}
                          className="mx-auto transition-all"
                          style={{
                            maxWidth: `${Math.round(380 * (readerZoom / 100))}px`,
                          }}
                        >
                          <div className="text-[11px] text-stone-400 mb-1.5 flex justify-between">
                            <span>
                              Página {p.pageNumber} de {totalPages}
                            </span>
                            <span>{composedBook.format.dimensionsLabel}</span>
                          </div>
                          <DemoComposedPageView
                            composed={composedBook}
                            page={p}
                            className="rounded-lg shadow-2xl"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ============================================================= */}
            {/* SECCIÓN 27: MENSAJE COMERCIAL FUERA DEL PDF                   */}
            {/* ============================================================= */}
            <section
              data-testid="demo-commercial-cta-section"
              className="bg-gradient-to-br from-[#FAF6EE] via-white to-[#F5EFE2] rounded-3xl border-2 border-amber-300/80 shadow-md p-8 sm:p-12 space-y-6"
            >
              <div className="max-w-3xl mx-auto space-y-4 text-stone-800 leading-relaxed text-sm sm:text-base">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 text-amber-950 text-xs font-bold">
                  <Heart className="w-3.5 h-3.5 text-amber-800" />
                  <span>El valor de tu legado familiar</span>
                </div>

                <h3 className="font-serif text-2xl sm:text-4xl font-bold text-stone-900">
                  Tu historia apenas comienza...
                </h3>

                <p>
                  Lo que acabas de leer nació de solo unas cuantas preguntas. Y, aun así, esos pequeños recuerdos ya nos permiten descubrir algo extraordinario: tu manera de sentir, las personas que amas y los momentos que te han convertido en quien eres.
                </p>

                <p className="font-serif font-bold text-lg text-amber-950">
                  Ahora imagina todo lo que aún queda por contar.
                </p>

                <p>
                  Las historias que nunca compartiste, los apodos que solo tu familia conoce, las enseñanzas que marcaron tu vida, las personas que dejaron huella en tu corazón y esos pequeños detalles que algún día alguien querrá recordar exactamente como tú los viviste.
                </p>

                <p>
                  Con Forever You, una entrevista mucho más profunda, construida a partir de{' '}
                  <strong>
                    un amplio banco de preguntas biográficas por etapas de vida y preguntas de profundización personalizadas mediante inteligencia artificial
                  </strong>
                  , puede convertirse en un libro autobiográfico completo, cuidadosamente escrito y maquetado.
                </p>

                <p className="font-medium text-stone-900">
                  Un libro para conservar. Para compartir. Para regalar.
                </p>

                <p>
                  Puedes crear tu propia historia o regalar esta experiencia a tu madre, tu padre, tus abuelos, tu pareja o cualquier persona cuya vida merezca ser recordada.
                </p>

                <p>
                  Porque los recuerdos más valiosos no siempre son los grandes acontecimientos.
                </p>

                <p>
                  A veces son una palabra de cariño, una sonrisa, una costumbre familiar o una historia contada una tarde cualquiera.
                </p>

                <p className="font-semibold text-stone-900">
                  Hoy tienes la oportunidad de escuchar esas historias de su propia voz y conservar sus palabras antes de que el tiempo las vuelva difíciles de recuperar.
                </p>

                <div className="italic font-serif text-stone-900 pl-4 border-l-2 border-amber-700 space-y-1">
                  <p>Que sus recuerdos acompañen a sus hijos.</p>
                  <p>Que sus enseñanzas lleguen a sus nietos.</p>
                  <p>Que su historia siga viva de generación en generación.</p>
                </div>

                <p className="font-serif font-bold text-lg text-stone-900 pt-1">
                  Forever You — Tu historia, para siempre.
                </p>

                <div className="pt-4 flex flex-col items-start sm:items-center text-left sm:text-center space-y-2">
                  <button
                    type="button"
                    data-testid="demo-create-full-book-btn"
                    onClick={handleOpenCommercialContractModal}
                    className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-amber-800 hover:bg-amber-900 text-white font-bold text-base shadow-lg transition transform hover:scale-[1.01] cursor-pointer inline-flex items-center justify-center gap-2.5"
                  >
                    <Sparkles className="w-5 h-5" />
                    <span>Crear mi libro completo</span>
                  </button>
                  <span className="text-xs text-stone-600 font-medium">
                    Convierte tus recuerdos en un legado para toda la familia.
                  </span>
                </div>
              </div>
            </section>
          </div>
        )}
      </main>

      {/* =================================================================== */}
      {/* MODAL 2: CONFIRMACIÓN PARA CREAR OTRO LIBRO (Section 28)            */}
      {/* =================================================================== */}
      {showNewBookConfirmModal && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-4">
            <h3 className="font-serif text-xl font-bold text-stone-900">
              ¿Deseas iniciar un nuevo libro desde cero?
            </h3>
            <p className="text-xs sm:text-sm text-stone-600 leading-relaxed">
              Antes de sustituir tu historia actual, asegúrate de haber descargado tu PDF. Al comenzar otro libro se limpiará la sesión temporal actual.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowNewBookConfirmModal(false)}
                className="px-4 py-2 rounded-xl border border-stone-300 text-xs font-semibold text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                Conservar mi libro actual
              </button>
              <button
                type="button"
                onClick={handleWipeAllInformation}
                className="px-5 py-2 rounded-xl bg-amber-800 hover:bg-amber-900 text-white text-xs font-bold cursor-pointer"
              >
                Iniciar nuevo libro
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 3: CONFIRMACIÓN AL CAMBIAR ESTILO DESPUÉS DE EDITAR (24.1)    */}
      {/* =================================================================== */}
      {pendingStyleChange && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-4">
            <h3 className="font-serif text-xl font-bold text-stone-900">
              ¿Volver a redactar el manuscrito con el nuevo estilo narrativo?
            </h3>
            <p className="text-xs sm:text-sm text-stone-600 leading-relaxed">
              Has realizado ediciones manuales en el texto. Si generas nuevamente el manuscrito con otro estilo narrativo, tus cambios manuales serán reemplazados por la nueva redacción.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  setPendingStyleChange(null);
                  setPhase('editorial_studio');
                }}
                className="px-4 py-2 rounded-xl border border-stone-300 text-xs font-semibold text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                Conservar mi texto editado
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = pendingStyleChange;
                  setPendingStyleChange(null);
                  handleGenerateManuscript(target);
                }}
                className="px-5 py-2 rounded-xl bg-amber-800 hover:bg-amber-900 text-white text-xs font-bold cursor-pointer"
              >
                Sí, volver a generar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 4: ADVERTENCIA ANTES DE ABANDONAR LA ENTREVISTA (Sec. 5.1)    */}
      {/* =================================================================== */}
      {pendingExitNavigation && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-4">
            <h3 className="font-serif text-xl font-bold text-stone-900">
              ¿Deseas salir de la prueba gratuita?
            </h3>
            <p className="text-xs sm:text-sm text-stone-600 leading-relaxed">
              Tus respuestas textuales seguirán disponibles temporalmente en este navegador durante tu sesión actual.
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingExitNavigation(null)}
                className="px-4 py-2 rounded-xl border border-stone-300 text-xs font-semibold text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                Seguir en mi historia
              </button>
              <button
                type="button"
                onClick={() => {
                  const nav = pendingExitNavigation;
                  setPendingExitNavigation(null);
                  nav();
                }}
                className="px-4 py-2 rounded-xl bg-amber-800 hover:bg-amber-900 text-white text-xs font-bold cursor-pointer"
              >
                Salir conservando sesión temporal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 5: CONTRATACIÓN RÁPIDA Y WHATSAPP EN /demo (Sección 27.2)     */}
      {/* =================================================================== */}
      {showCommercialModal && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 sm:p-8 shadow-2xl border border-stone-200 space-y-6">
            <div className="flex items-start justify-between gap-4 border-b border-stone-100 pb-4">
              <div>
                <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">
                  Contratación YouForever
                </span>
                <h3 className="font-serif text-2xl font-bold text-stone-900">
                  Crear mi libro autobiográfico completo
                </h3>
                <p className="text-xs text-stone-600 mt-0.5">
                  Elige tu modalidad y contáctanos directamente por WhatsApp o correo para activar tu entrevista completa.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCommercialModal(false)}
                className="p-2 text-stone-400 hover:text-stone-700 rounded-xl cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Direct WhatsApp & Email Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <a
                href={buildWhatsAppInquiryUrl(inquiryInput)}
                target="_blank"
                rel="noopener noreferrer"
                className="py-3 px-4 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition"
              >
                <MessageCircle className="w-4 h-4" />
                <span>WhatsApp: +52 9681040015</span>
              </a>

              <a
                href={buildMailtoInquiryUrl(inquiryInput)}
                className="py-3 px-4 bg-stone-100 hover:bg-stone-200 text-stone-900 border border-stone-300 text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition"
              >
                <Mail className="w-4 h-4 text-amber-800" />
                <span>youforever.team@gmail.com</span>
              </a>
            </div>

            {/* Quick Inquiry Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const check = validateInquiryForm(inquiryInput);
                if (!check.valid) {
                  setInquiryErrors(check.errors);
                  setInquirySubmitted(false);
                  return;
                }
                setInquiryErrors({});
                setInquirySubmitted(true);
              }}
              className="space-y-4 bg-[#FAF8F5] p-5 rounded-2xl border border-stone-200"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-800 mb-1">
                    Tu nombre completo *
                  </label>
                  <input
                    type="text"
                    value={inquiryInput.fullName}
                    onChange={(e) =>
                      setInquiryInput((prev) => ({ ...prev, fullName: e.target.value }))
                    }
                    className="w-full px-3 py-2 bg-white border border-stone-300 rounded-xl text-xs"
                  />
                  {inquiryErrors.fullName && (
                    <p className="text-[11px] text-rose-700 mt-1">{inquiryErrors.fullName}</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-800 mb-1">
                    Tu WhatsApp o Correo *
                  </label>
                  <input
                    type="text"
                    value={inquiryInput.contactInfo}
                    onChange={(e) =>
                      setInquiryInput((prev) => ({ ...prev, contactInfo: e.target.value }))
                    }
                    placeholder="+52 55 1234 5678 o correo"
                    className="w-full px-3 py-2 bg-white border border-stone-300 rounded-xl text-xs"
                  />
                  {inquiryErrors.contactInfo && (
                    <p className="text-[11px] text-rose-700 mt-1">{inquiryErrors.contactInfo}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-800 mb-1">
                    ¿Para quién es el libro? *
                  </label>
                  <input
                    type="text"
                    value={inquiryInput.recipientRelation}
                    onChange={(e) =>
                      setInquiryInput((prev) => ({
                        ...prev,
                        recipientRelation: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 bg-white border border-stone-300 rounded-xl text-xs"
                  />
                  {inquiryErrors.recipientRelation && (
                    <p className="text-[11px] text-rose-700 mt-1">
                      {inquiryErrors.recipientRelation}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-800 mb-1">
                    Modalidad del libro completo
                  </label>
                  <select
                    value={inquiryInput.modality}
                    onChange={(e) =>
                      setInquiryInput((prev) => ({
                        ...prev,
                        modality: e.target.value as InquiryFormInput['modality'],
                      }))
                    }
                    className="w-full px-3 py-2 bg-white border border-stone-300 rounded-xl text-xs"
                  >
                    <option value="individual">Legado Individual</option>
                    <option value="compartida">Historia Compartida (Pareja)</option>
                    <option value="familiar">Edición Familiar Especial</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-amber-800 hover:bg-amber-900 text-white text-xs font-bold rounded-xl cursor-pointer"
                >
                  Preparar mi solicitud
                </button>

                {onNavigateToConoceme && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowCommercialModal(false);
                      onNavigateToConoceme();
                    }}
                    className="text-xs font-semibold text-amber-900 hover:underline cursor-pointer"
                  >
                    Ver todos los detalles en /conoceme →
                  </button>
                )}
              </div>

              {inquirySubmitted && (
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-xs text-emerald-950 space-y-2">
                  <p className="font-bold">
                    ¡Solicitud lista! Elige el medio para enviarla directamente a nuestro equipo:
                  </p>
                  <div className="flex gap-2">
                    <a
                      href={buildWhatsAppInquiryUrl(inquiryInput)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 bg-emerald-800 text-white rounded-lg font-semibold"
                    >
                      Enviar por WhatsApp
                    </a>
                    <a
                      href={buildMailtoInquiryUrl(inquiryInput)}
                      className="px-3 py-1.5 bg-white border border-emerald-400 text-stone-900 rounded-lg font-semibold"
                    >
                      Enviar por Correo
                    </a>
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
