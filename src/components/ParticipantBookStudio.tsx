import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  Eye,
  FileText,
  History,
  Image as ImageIcon,
  Layers,
  Loader2,
  Lock,
  MessageCircle,
  Palette,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Type as TypeIcon,
  Upload,
} from 'lucide-react';
import {
  AnswerRecord,
  InterviewRecord,
  ParticipantRecord,
  QuestionRecord,
  computeLayoutEditQuotaStatus,
} from '../logic/interviewRules.ts';
import {
  DEMO_BOOK_FORMATS,
  DEMO_COVER_DESIGNS,
  DEMO_INTERIOR_STYLES,
  DEMO_NARRATIVE_STYLES,
  DEMO_THEMATIC_ILLUSTRATIONS,
  DemoBookFormatId,
  DemoCoverDesignId,
  DemoEditorialConfig,
  DemoInMemoryPhoto,
  DemoInteriorStyleId,
  DemoManuscript,
  DemoNarrativeStyleId,
  DemoThematicIllustrationId,
  ParticipantBookVersionRecord,
  buildParticipantInitialManuscriptFromAnswers,
  composeBookPages,
  mergeEditorialFieldsIntoApprovedManuscript,
  hasUpdatedAnswersSinceBookVersion,
} from '../logic/demoStoryRules.ts';
import {
  DemoComposedPageView,
  DemoCoverThumbnailCard,
  DemoInteriorThumbnailCard,
} from './DemoBookPageRenderer.tsx';
import { generateRealDemoBookPdf, preloadBookResourcesForPdf } from '../utils/demoPdfGenerator.ts';
import { ForeverYouLogo } from './ForeverYouLogo';
import { BookProgressOverlay, type BookProgressState } from './BookProgressOverlay.tsx';

/** V5.3.1: shown in the preview and before saving the final book. */
/**
 * V5.3.3: the only message a participant sees while their book is not ready yet. Technical causes
 * are recorded in the administrator log; the participant is never told about errors.
 */
const BOOK_IN_PROGRESS_MESSAGE =
  'Tu libro sigue en preparación. Pulsa «Continuar preparando» y seguiremos desde donde avanzamos.';

const AI_DOCUMENT_REVIEW_NOTICE =
  'Este documento se redacta con ayuda de inteligencia artificial y puede contener errores. Siempre será necesaria una revisión exhaustiva por parte del autor de la autobiografía.';

interface ParticipantBookStudioProps {
  token: string;
  interview: InterviewRecord;
  participant: ParticipantRecord;
  otherParticipants: Array<{ id: string; name: string; relationship: string; role: string }>;
  answers: AnswerRecord[];
  questions: QuestionRecord[];
  bookVersions: ParticipantBookVersionRecord[];
  onBookVersionSaved: (params: {
    bookVersion: ParticipantBookVersionRecord;
    interview: InterviewRecord;
    allVersions: ParticipantBookVersionRecord[];
  }) => void;
  onViewReadOnlyAnswers?: () => void;
}

export const ParticipantBookStudio: React.FC<ParticipantBookStudioProps> = ({
  token,
  interview,
  participant,
  otherParticipants,
  answers,
  questions,
  bookVersions,
  onBookVersionSaved,
  onViewReadOnlyAnswers,
}) => {
  const participantNames = useMemo(() => {
    const names = [participant.name];
    for (const op of otherParticipants) {
      if (op.name && !names.includes(op.name)) {
        names.push(op.name);
      }
    }
    return names;
  }, [participant.name, otherParticipants]);

  const isCouple = interview.storyMode === 'compartida' && participantNames.length >= 2;
  const closingDedicationText = (interview.participantClosingText || '').trim();

  // Compute quota status
  const quotaStatus = useMemo(() => {
    const effectiveCount = Math.max(bookVersions.length, interview.bookGeneratedCount ?? 0);
    return computeLayoutEditQuotaStatus({
      ...interview,
      bookGeneratedCount: effectiveCount,
    });
  }, [interview, bookVersions.length]);

  const hasSavedVersions = bookVersions.length > 0;
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    bookVersions[0]?.id || null
  );

  // Sync selectedVersionId when new version is added
  useEffect(() => {
    if (bookVersions.length > 0 && (!selectedVersionId || !bookVersions.some((v) => v.id === selectedVersionId))) {
      setSelectedVersionId(bookVersions[0].id);
    }
  }, [bookVersions, selectedVersionId]);

  const activeSavedVersion = useMemo(() => {
    if (!hasSavedVersions) return null;
    return bookVersions.find((v) => v.id === selectedVersionId) || bookVersions[0];
  }, [hasSavedVersions, bookVersions, selectedVersionId]);

  const hasUpdatedAnswers = useMemo(() => {
    return hasUpdatedAnswersSinceBookVersion({
      answers,
      interviewReopenedAt: interview.reopenedAt,
      latestBookVersion: activeSavedVersion,
    });
  }, [answers, interview.reopenedAt, activeSavedVersion]);

  // If no book version has been saved yet, or if the interview was reopened and has newer/more answers,
  // studio starts open for creation/update with all current answers.
  const [isEditingLayout, setIsEditingLayout] = useState<boolean>(
    !hasSavedVersions || hasUpdatedAnswers
  );
  const [showQuotaConfirmModal, setShowQuotaConfirmModal] = useState<boolean>(false);

  useEffect(() => {
    if (!hasSavedVersions || hasUpdatedAnswers) {
      setIsEditingLayout(true);
    }
  }, [hasSavedVersions, hasUpdatedAnswers]);

  // Initial local fallback manuscript built immediately from participant's real answers & photos
  const initialLocalData = useMemo(() => {
    return buildParticipantInitialManuscriptFromAnswers({
      interviewTitle: interview.title,
      storyMode: interview.storyMode,
      participantNames,
      answers: answers.map((a) => ({
        ...a,
        photos: (a.photos || []).map((p) => ({
          ...p,
          imageUrl: p.imageUrl || `/api/photos/${p.id}`,
        })),
      })),
      questions,
      narrativeStyle: 'first_person_literary',
      closingDedicationText,
    });
  }, [interview.title, interview.storyMode, participantNames, answers, questions, closingDedicationText]);

  const useFreshDraft = !activeSavedVersion || hasUpdatedAnswers;

  // Track whether the user has explicitly selected a Narrative Style during the current editing session.
  // Per user specification: nothing is selected by default when entering layout creation/modification,
  // and no 5-page preview PDF is generated until the user clicks a literary style option.
  const [hasSelectedStyleInSession, setHasSelectedStyleInSession] = useState<boolean>(false);
  const [hasAiDraftLoadedForSession, setHasAiDraftLoadedForSession] = useState<boolean>(false);

  const [narrativeStyle, setNarrativeStyle] = useState<DemoNarrativeStyleId | null>(
    isEditingLayout ? null : activeSavedVersion?.narrativeStyle || 'first_person_literary'
  );
  const [editorialConfig, setEditorialConfig] = useState<DemoEditorialConfig>(() => {
    if (activeSavedVersion?.editorialConfig && !useFreshDraft) {
      return { ...activeSavedVersion.editorialConfig };
    }
    return {
      narrativeStyle: 'first_person_literary',
      coverDesignId: activeSavedVersion?.editorialConfig?.coverDesignId || 'clasica_eterna',
      coverColorVariantIdx: activeSavedVersion?.editorialConfig?.coverColorVariantIdx ?? 0,
      coverVisualType: activeSavedVersion?.editorialConfig?.coverVisualType || 'illustration',
      coverIllustrationId:
        activeSavedVersion?.editorialConfig?.coverIllustrationId || 'arbol_raices',
      interiorStyleId: activeSavedVersion?.editorialConfig?.interiorStyleId || 'clasico_editorial',
      bookFormatId: activeSavedVersion?.editorialConfig?.bookFormatId || '6x9',
      customTitle: activeSavedVersion?.editorialConfig?.customTitle || interview.title,
      customSubtitle:
        activeSavedVersion?.editorialConfig?.customSubtitle ||
        (isCouple
          ? 'Libro biográfico de memorias compartidas'
          : 'Libro autobiográfico y legado familiar'),
      customAuthors:
        activeSavedVersion?.editorialConfig?.customAuthors || participantNames.join(' y '),
      dedication: activeSavedVersion?.editorialConfig?.dedication || '',
      includeTableOfContents:
        activeSavedVersion?.editorialConfig?.includeTableOfContents ?? true,
      includeEditorialCredits:
        activeSavedVersion?.editorialConfig?.includeEditorialCredits ?? false,
    };
  });

  const [manuscript, setManuscript] = useState<DemoManuscript>(
    () => (useFreshDraft ? initialLocalData.manuscript : activeSavedVersion.manuscript)
  );
  const [aiOriginalManuscript, setAiOriginalManuscript] = useState<DemoManuscript>(
    () => (useFreshDraft ? initialLocalData.manuscript : activeSavedVersion.manuscript)
  );
  const [coverPhoto, setCoverPhoto] = useState<DemoInMemoryPhoto | null>(
    () => activeSavedVersion?.coverPhoto || null
  );
  const [chapterPhotos, setChapterPhotos] = useState<Record<string, DemoInMemoryPhoto | null>>(
    () =>
      useFreshDraft
        ? initialLocalData.chapterPhotos
        : activeSavedVersion?.chapterPhotos || initialLocalData.chapterPhotos
  );
  const [allPhotosById, setAllPhotosById] = useState<Record<string, DemoInMemoryPhoto>>(
    () => initialLocalData.allPhotosById || {}
  );

  // Per-style AI preview cache in session so switching between Style A, B, and C is instantaneous after first redaction
  const stylePreviewCacheRef = useRef<
    Partial<
      Record<
        DemoNarrativeStyleId,
        {
          manuscript: DemoManuscript;
          chapterPhotos: Record<string, DemoInMemoryPhoto | null>;
          allPhotosById: Record<string, DemoInMemoryPhoto>;
          providerUsed: string;
          modelUsed: string;
          providerFallbackNotice: string | null;
          cachedContextUsed: boolean;
        }
      >
    >
  >({});

  // Keep draft synchronized if answers update (e.g. after reopening questionnaire)
  const lastSyncedAnswerCountRef = useRef<number>(answers.length);
  useEffect(() => {
    if (answers.length !== lastSyncedAnswerCountRef.current || useFreshDraft) {
      lastSyncedAnswerCountRef.current = answers.length;
      setManuscript(initialLocalData.manuscript);
      setAiOriginalManuscript(initialLocalData.manuscript);
      setChapterPhotos(initialLocalData.chapterPhotos);
      setAllPhotosById(initialLocalData.allPhotosById || {});
      stylePreviewCacheRef.current = {};
    }
  }, [answers.length, useFreshDraft, initialLocalData]);

  // Undo/Redo history for manual text editing
  const [manuscriptHistory, setManuscriptHistory] = useState<DemoManuscript[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const activeTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [activeTextareaCoords, setActiveTextareaCoords] = useState<{
    chapterIdx: number;
    paraIdx: number;
  } | null>(null);

  // Always start on Tab 1: 'estilo' (Estilo Literario) when entering layout modification
  const [studioTab, setStudioTab] = useState<
    'estilo' | 'portada' | 'interior' | 'formato' | 'texto'
  >('estilo');
  const [previewMode, setPreviewMode] = useState<'flipbook' | 'pdf_reader'>('flipbook');
  const [currentPageIdx, setCurrentPageIdx] = useState<number>(0);

  const [isGeneratingAI, setIsGeneratingAI] = useState<boolean>(false);
  const [isSavingBook, setIsSavingBook] = useState<boolean>(false);
  const [showSaveConfirmModal, setShowSaveConfirmModal] = useState<boolean>(false);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [studioSuccessMsg, setStudioSuccessMsg] = useState<string | null>(null);
  const [providerFallbackNotice, setProviderFallbackNotice] = useState<string | null>(null);
  const [activeAiEngineInfo, setActiveAiEngineInfo] = useState<{
    providerUsed: string;
    modelUsed: string;
    cachedContextUsed?: boolean;
  } | null>(null);
  const [retryAction, setRetryAction] = useState<'preview' | 'full' | 'save' | null>(null);
  const [generationJobProgress, setGenerationJobProgress] = useState<{
    jobId: string;
    phase: string;
    userMessage: string;
    currentBatch: number;
    totalBatches: number;
    completedBatches: number;
    repairPass: number;
    repairedChapters: number;
    totalRepairChapters: number;
  } | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  // V5.3.5: floating, non-dismissable progress alert for every book creation step.
  const [progressOverlay, setProgressOverlay] = useState<BookProgressState | null>(null);
  const pdfCancelRequestedRef = useRef<boolean>(false);
  const startProgress = (kind: BookProgressState['kind'], stage: BookProgressState['stage'] = 'job') =>
    setProgressOverlay({ kind, stage, status: 'running', cancellable: true });
  const updateProgress = (patch: Partial<BookProgressState>) =>
    setProgressOverlay((prev) => (prev ? { ...prev, ...patch } : prev));
  const pauseProgress = () =>
    setProgressOverlay((prev) =>
      prev ? { ...prev, status: 'paused', cancellable: true, pausedMessage: BOOK_IN_PROGRESS_MESSAGE } : prev
    );
  const isUnmountedRef = useRef<boolean>(false);

  const safeReadJsonResponse = async (res: Response): Promise<any> => {
    const rawText = await res.text();
    if (!rawText || !rawText.trim()) {
      return {
        success: false,
        error: BOOK_IN_PROGRESS_MESSAGE,
      };
    }
    try {
      return JSON.parse(rawText);
    } catch (_parseErr) {
      return {
        success: false,
        error: BOOK_IN_PROGRESS_MESSAGE,
      };
    }
  };

  // Refs to ensure focus & scroll always move to where the user needs to act
  const studioWorkspaceRef = useRef<HTMLDivElement | null>(null);
  const firstStyleOptionRef = useRef<HTMLButtonElement | null>(null);
  const viewerPanelRef = useRef<HTMLDivElement | null>(null);

  const scrollAndFocusActionArea = (target: 'editor' | 'viewer' = 'editor') => {
    setTimeout(() => {
      if (target === 'viewer' && viewerPanelRef.current) {
        viewerPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      if (studioWorkspaceRef.current) {
        studioWorkspaceRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      if (firstStyleOptionRef.current) {
        firstStyleOptionRef.current.focus({ preventScroll: true });
      }
    }, 80);
  };

  // When entering layout editing mode on initial load, focus the Estilo Literario section
  const didInitialFocusRef = useRef<boolean>(false);
  useEffect(() => {
    if (isEditingLayout && !didInitialFocusRef.current) {
      didInitialFocusRef.current = true;
      setStudioTab('estilo');
      scrollAndFocusActionArea('editor');
    }
  }, [isEditingLayout]);

  // Collect all photos uploaded by the participant across their answers so they can also pick one for the cover
  const allInterviewPhotos = useMemo(() => {
    const list: DemoInMemoryPhoto[] = [];
    for (const ans of answers) {
      for (const p of ans.photos || []) {
        const url = (p as any).dataUrl || p.imageUrl || `/api/photos/${p.id}`;
        list.push({
          id: p.id,
          fileName: p.fileName || `${p.id}.jpg`,
          objectUrl: url,
          dataUrl: url,
          mimeType: p.mimeType || 'image/jpeg',
          width: 800,
          height: 600,
          caption: p.caption || '',
          focusY: 'center',
          zoom: 1,
        });
      }
    }
    return list;
  }, [answers]);

  // Compose live book document:
  // - When editing layout (`isEditingLayout === true`), generate the 6-page sample preview (`previewSampleOnly: true`: Pages 1..5 + Page 6 closing page).
  // - When viewing a saved version (`isEditingLayout === false`), compose the complete book (`previewSampleOnly: false`).
  const composedBook = useMemo(() => {
    const targetManuscript = isEditingLayout
      ? manuscript
      : activeSavedVersion?.manuscript || manuscript;
    const targetConfig = isEditingLayout
      ? editorialConfig
      : activeSavedVersion?.editorialConfig || editorialConfig;
    const targetCoverPhoto = isEditingLayout
      ? coverPhoto
      : activeSavedVersion?.coverPhoto || null;
    const targetChapterPhotos = isEditingLayout
      ? chapterPhotos
      : activeSavedVersion?.chapterPhotos || chapterPhotos;
    const targetClosingText = isEditingLayout
      ? closingDedicationText
      : activeSavedVersion?.closingPageText ?? closingDedicationText;

    return composeBookPages({
      manuscript: targetManuscript,
      editorialConfig: targetConfig,
      coverPhoto: targetCoverPhoto,
      chapterPhotos: targetChapterPhotos,
      allPhotosById,
      customClosingPageText: targetClosingText,
      maxContentPages: 500,
      previewSampleOnly: isEditingLayout,
    });
  }, [
    isEditingLayout,
    manuscript,
    editorialConfig,
    coverPhoto,
    chapterPhotos,
    allPhotosById,
    closingDedicationText,
    activeSavedVersion,
  ]);

  // Distinct container width & max-width per physical book format so changing format visibly resizes the viewer
  const viewerFormatMaxWidthClass = useMemo(() => {
    const fmtId = composedBook.format.id;
    if (fmtId === 'a5') {
      return 'w-[76%] max-w-[300px] mx-auto transition-all duration-300';
    }
    if (fmtId === 'carta') {
      return 'w-full max-w-[440px] mx-auto transition-all duration-300';
    }
    // 6x9 default
    return 'w-[88%] max-w-[360px] mx-auto transition-all duration-300';
  }, [composedBook.format.id]);

  // Clamp currentPageIdx if page count changes
  useEffect(() => {
    if (currentPageIdx >= composedBook.pages.length) {
      setCurrentPageIdx(Math.max(0, composedBook.pages.length - 1));
    }
  }, [composedBook.pages.length, currentPageIdx]);

  const pushManuscriptEdit = (updated: DemoManuscript) => {
    const nextHist = manuscriptHistory.slice(0, historyIdx + 1);
    nextHist.push(updated);
    setManuscriptHistory(nextHist);
    setHistoryIdx(nextHist.length - 1);
    setManuscript(updated);
  };

  const handleUndo = () => {
    if (historyIdx > 0) {
      const prev = manuscriptHistory[historyIdx - 1];
      setHistoryIdx(historyIdx - 1);
      setManuscript(prev);
    }
  };

  const handleRedo = () => {
    if (historyIdx < manuscriptHistory.length - 1) {
      const next = manuscriptHistory[historyIdx + 1];
      setHistoryIdx(historyIdx + 1);
      setManuscript(next);
    }
  };

  const handleRestoreAiManuscript = () => {
    pushManuscriptEdit(JSON.parse(JSON.stringify(aiOriginalManuscript)));
  };

  const applyInlineFormatToActiveParagraph = (marker: '**' | '*') => {
    const el = activeTextareaRef.current;
    const coords = activeTextareaCoords;
    if (!el || !coords) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start === end) return;

    const currentPara = manuscript.chapters[coords.chapterIdx]?.paragraphs[coords.paraIdx] || '';
    const selected = currentPara.slice(start, end);
    const wrapped = `${marker}${selected}${marker}`;
    const updatedPara = currentPara.slice(0, start) + wrapped + currentPara.slice(end);

    const nextChapters = manuscript.chapters.map((ch, cIdx) => {
      if (cIdx !== coords.chapterIdx) return ch;
      const nextParas = [...ch.paragraphs];
      nextParas[coords.paraIdx] = updatedPara;
      return { ...ch, paragraphs: nextParas };
    });
    pushManuscriptEdit({ ...manuscript, chapters: nextChapters });
  };

  const styleRequestIdRef = useRef<number>(0);

  const applyGeneratedManuscriptPayload = (
    payloadData: any,
    styleId: DemoNarrativeStyleId
  ) => {
    setRetryAction(null);
    const fbNotice = payloadData.providerFallbackNotice || null;
    setProviderFallbackNotice(fbNotice);
    const provLabel =
      payloadData.providerUsed === 'openai' ? 'OpenAI (ChatGPT)' : 'Google (Gemini)';
    const modLabel = payloadData.modelUsed || '';
    const wasCached = Boolean(payloadData.cachedContextUsed);

    if (payloadData.providerUsed || payloadData.modelUsed) {
      setActiveAiEngineInfo({
        providerUsed: provLabel,
        modelUsed: modLabel,
        cachedContextUsed: wasCached,
      });
    }
    const isIncompleteDraft =
      payloadData.manuscript.generationStatus === 'incomplete_draft' ||
      payloadData.manuscript.status === 'incomplete_draft';
    const aiManu: DemoManuscript = {
      ...(payloadData.manuscript as DemoManuscript),
      aiGenerated: payloadData.manuscript.aiGenerated ?? !isIncompleteDraft,
      narrativeStyle: styleId,
      lockedPreviewGroups: undefined,
    };
    const nextChapterPhotos = payloadData.chapterPhotos || initialLocalData.chapterPhotos;
    const nextAllPhotosById =
      payloadData.allPhotosById || initialLocalData.allPhotosById || {};

    setManuscript(aiManu);
    setAiOriginalManuscript(JSON.parse(JSON.stringify(aiManu)));
    setManuscriptHistory([aiManu]);
    setHistoryIdx(0);
    setChapterPhotos(nextChapterPhotos);
    setAllPhotosById(nextAllPhotosById);
    setEditorialConfig((prev) => ({
      ...prev,
      narrativeStyle: styleId,
      customTitle: aiManu.title || prev.customTitle,
      customSubtitle: aiManu.subtitle || prev.customSubtitle,
    }));
    setHasAiDraftLoadedForSession(true);

    if (isIncompleteDraft) {
      setRetryAction('preview');
    } else {
      stylePreviewCacheRef.current[styleId] = {
        manuscript: aiManu,
        chapterPhotos: nextChapterPhotos,
        allPhotosById: nextAllPhotosById,
        providerUsed: provLabel,
        modelUsed: modLabel,
        providerFallbackNotice: fbNotice,
        cachedContextUsed: wasCached,
      };
    }
  };

  const pollBookGenerationJob = async (
    initialJob: any,
    isStale: () => boolean
  ): Promise<any> => {
    let currentJob = initialJob;
    activeJobIdRef.current = currentJob.jobId;

    const syncProgress = (j: any) => {
      setGenerationJobProgress({
        jobId: j.jobId,
        phase: j.phase || 'preparing_sources',
        userMessage:
          j.userMessage || 'Preparando tu libro con tus recuerdos y fotografías...',
        currentBatch: Number(j.currentBatch) || 0,
        totalBatches: Number(j.totalBatches) || 0,
        completedBatches: Number(j.completedBatches) || 0,
        repairPass: Number(j.repairPass) || 0,
        repairedChapters: Number(j.repairedChapters) || 0,
        totalRepairChapters: Number(j.totalRepairChapters) || 0,
      });
    };

    syncProgress(currentJob);

    let consecutiveNetworkErrors = 0;
    while (
      (currentJob.status === 'running' || currentJob.status === 'queued') &&
      !isStale() &&
      !isUnmountedRef.current
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1400));
      if (isStale() || isUnmountedRef.current) return null;

      try {
        const statusRes = await fetch(
          `/api/participant/book/jobs/status?token=${encodeURIComponent(
            token
          )}&jobId=${encodeURIComponent(currentJob.jobId)}`
        );
        const statusData = await safeReadJsonResponse(statusRes);
        if (isStale() || isUnmountedRef.current) return null;

        if (statusRes.ok && statusData.success && statusData.data) {
          consecutiveNetworkErrors = 0;
          currentJob = statusData.data;
          syncProgress(currentJob);
        } else {
          consecutiveNetworkErrors += 1;
        }
      } catch (_pollErr) {
        consecutiveNetworkErrors += 1;
      }

      if (consecutiveNetworkErrors >= 6) {
        throw new Error(
BOOK_IN_PROGRESS_MESSAGE
        );
      }
    }

    if (isStale() || isUnmountedRef.current) return null;

    if (currentJob.status === 'cancelled') {
      return { cancelled: true, job: currentJob };
    }
    if (currentJob.status === 'failed' || !currentJob.result) {
      throw new Error(
BOOK_IN_PROGRESS_MESSAGE
      );
    }

    return currentJob.result;
  };

  const handleCancelActiveGeneration = async () => {
    const jobId = activeJobIdRef.current;
    if (!jobId) return;
    styleRequestIdRef.current += 1;
    try {
      await fetch('/api/participant/book/jobs/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, jobId }),
      });
    } catch (_err) {
      // Ignore cancel network errors
    } finally {
      activeJobIdRef.current = null;
      setIsGeneratingAI(false);
      setIsSavingBook(false);
      setGenerationJobProgress(null);
      setProgressOverlay(null);
    }
  };

  // V5.3.5: «Cancelar» in the floating alert stops whatever is being created.
  const handleCancelProgressOverlay = () => {
    pdfCancelRequestedRef.current = true;
    if (activeJobIdRef.current) {
      void handleCancelActiveGeneration();
    } else {
      styleRequestIdRef.current += 1;
      setIsGeneratingAI(false);
      setGenerationJobProgress(null);
      setProgressOverlay(null);
    }
  };

  // Automatic background job resumption when re-entering the studio while a book job is still active
  useEffect(() => {
    isUnmountedRef.current = false;
    let cancelledEffect = false;

    const resumeIfActive = async () => {
      if (!isEditingLayout || !token) return;
      try {
        const res = await fetch(
          `/api/participant/book/jobs/status?token=${encodeURIComponent(token)}`
        );
        const data = await safeReadJsonResponse(res);
        if (cancelledEffect || !res.ok || !data.success || !data.data) return;

        const job = data.data;
        if (job.status === 'running' || job.status === 'queued') {
          const reqId = ++styleRequestIdRef.current;
          const styleId: DemoNarrativeStyleId =
            job.narrativeStyle || 'first_person_literary';
          setHasSelectedStyleInSession(true);
          setNarrativeStyle(styleId);
          setEditorialConfig((prev) => ({ ...prev, narrativeStyle: styleId }));
          setIsGeneratingAI(true);
          startProgress(job.scope === 'full' ? 'full' : 'preview');
          try {
            const payload = await pollBookGenerationJob(
              job,
              () => cancelledEffect || reqId !== styleRequestIdRef.current
            );
            if (
              !cancelledEffect &&
              reqId === styleRequestIdRef.current &&
              payload &&
              !payload.cancelled &&
              payload.manuscript
            ) {
              applyGeneratedManuscriptPayload(payload, styleId);
              setProgressOverlay((prev) =>
                prev
                  ? {
                      ...prev,
                      status: 'done',
                      doneTitle: '¡Tus páginas están listas!',
                      doneMessage: 'Ya puedes revisar el resultado en el visor.',
                    }
                  : prev
              );
            } else if (!cancelledEffect && reqId === styleRequestIdRef.current && payload?.cancelled) {
              setProgressOverlay(null);
            }
          } catch (resumeErr: any) {
            if (!cancelledEffect && reqId === styleRequestIdRef.current) {
              pauseProgress();
              setStudioError(
BOOK_IN_PROGRESS_MESSAGE
              );
              setRetryAction('preview');
            }
          } finally {
            if (!cancelledEffect && reqId === styleRequestIdRef.current) {
              setIsGeneratingAI(false);
              setGenerationJobProgress(null);
            }
          }
        }
      } catch (_e) {
        // Silent background check failure
      }
    };

    void resumeIfActive();
    return () => {
      cancelledEffect = true;
      isUnmountedRef.current = true;
    };
  }, [token, isEditingLayout]);

  // Trigger redaction for the sample preview (`scope: 'preview'`) via resumable background job
  const handleSelectNarrativeStyle = async (
    styleId: DemoNarrativeStyleId,
    forceRefresh = false
  ) => {
    const reqId = ++styleRequestIdRef.current;

    setHasSelectedStyleInSession(true);
    setNarrativeStyle(styleId);
    setEditorialConfig((prev) => ({ ...prev, narrativeStyle: styleId }));
    setStudioError(null);
    setCurrentPageIdx(0);

    // Check session cache for this style first (unless user clicked Regenerar vista previa)
    const cachedForStyle = !forceRefresh ? stylePreviewCacheRef.current[styleId] : undefined;
    if (cachedForStyle) {
      setManuscript(cachedForStyle.manuscript);
      setAiOriginalManuscript(JSON.parse(JSON.stringify(cachedForStyle.manuscript)));
      setManuscriptHistory([cachedForStyle.manuscript]);
      setHistoryIdx(0);
      setChapterPhotos(cachedForStyle.chapterPhotos);
      setAllPhotosById(cachedForStyle.allPhotosById);
      setEditorialConfig((prev) => ({
        ...prev,
        narrativeStyle: styleId,
        customTitle: cachedForStyle.manuscript.title || prev.customTitle,
        customSubtitle: cachedForStyle.manuscript.subtitle || prev.customSubtitle,
      }));
      setProviderFallbackNotice(cachedForStyle.providerFallbackNotice);
      setActiveAiEngineInfo({
        providerUsed: cachedForStyle.providerUsed,
        modelUsed: cachedForStyle.modelUsed,
        cachedContextUsed: true,
      });
      setHasAiDraftLoadedForSession(true);
      setIsGeneratingAI(false);
      setGenerationJobProgress(null);
      return;
    }

    setHasAiDraftLoadedForSession(false);
    setIsGeneratingAI(true);
    startProgress('preview');
    setGenerationJobProgress({
      jobId: 'starting',
      phase: 'preparing_sources',
      userMessage: 'Reuniendo y ordenando tus recuerdos y fotografías...',
      currentBatch: 0,
      totalBatches: 0,
      completedBatches: 0,
      repairPass: 0,
      repairedChapters: 0,
      totalRepairChapters: 0,
    });

    try {
      const startRes = await fetch('/api/participant/book/jobs/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          narrativeStyle: styleId,
          scope: 'preview',
          forceRefresh,
        }),
      });
      if (reqId !== styleRequestIdRef.current) return;

      const startData = await safeReadJsonResponse(startRes);
      if (reqId !== styleRequestIdRef.current) return;

      if (!startRes.ok || !startData.success || !startData.data) {
        setStudioError(
          startData.error || BOOK_IN_PROGRESS_MESSAGE
        );
        setRetryAction('preview');
        pauseProgress();
        return;
      }

      const payload = await pollBookGenerationJob(
        startData.data,
        () => reqId !== styleRequestIdRef.current
      );
      if (reqId !== styleRequestIdRef.current) return;
      if (!payload || payload.cancelled) {
        setProgressOverlay(null);
        return;
      }

      if (payload.manuscript) {
        updateProgress({ stage: 'compose', cancellable: false });
        applyGeneratedManuscriptPayload(payload, styleId);
        const stillInPreparation =
          payload.manuscript.generationStatus === 'incomplete_draft' ||
          payload.manuscript.status === 'incomplete_draft';
        if (stillInPreparation) {
          pauseProgress();
        } else {
          updateProgress({
            status: 'done',
            doneTitle: '¡Tu muestra editorial está lista!',
            doneMessage:
              'Pulsa «Aceptar» para revisar tus primeras páginas con el estilo que elegiste.',
          });
        }
      } else {
        setStudioError(BOOK_IN_PROGRESS_MESSAGE);
        setRetryAction('preview');
        pauseProgress();
      }
    } catch (err: any) {
      if (reqId === styleRequestIdRef.current && err?.name !== 'AbortError') {
        pauseProgress();
        setStudioError(
BOOK_IN_PROGRESS_MESSAGE
        );
        setRetryAction('preview');
      }
    } finally {
      if (reqId === styleRequestIdRef.current) {
        activeJobIdRef.current = null;
        setIsGeneratingAI(false);
        setGenerationJobProgress(null);
      }
    }
  };

  // Convert an image URL or File into a base64 dataUrl so jsPDF can embed it reliably
  const ensureDataUrlForPdf = async (
    photo: DemoInMemoryPhoto | null | undefined
  ): Promise<DemoInMemoryPhoto | null> => {
    if (!photo) return null;
    if (photo.dataUrl && photo.dataUrl.startsWith('data:image/')) {
      return photo;
    }
    try {
      const resp = await fetch(photo.objectUrl || photo.dataUrl);
      if (!resp.ok) return photo;
      const blob = await resp.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ''));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      if (base64.startsWith('data:image/')) {
        return { ...photo, dataUrl: base64, objectUrl: base64 };
      }
    } catch (_e) {
      // Fallback to existing photo
    }
    return photo;
  };

  const handleUploadCustomCoverPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl.startsWith('data:image/')) return;
      const img = new Image();
      img.onload = () => {
        // Compress custom cover photo if needed so it never exceeds safe payload limits
        let finalDataUrl = dataUrl;
        if (dataUrl.length > 350_000 && typeof document !== 'undefined') {
          try {
            const canvas = document.createElement('canvas');
            const maxDim = 900;
            const scale = Math.min(1, maxDim / Math.max(img.width || 800, img.height || 600));
            canvas.width = Math.round((img.width || 800) * scale);
            canvas.height = Math.round((img.height || 600) * scale);
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              finalDataUrl = canvas.toDataURL('image/jpeg', 0.82);
            }
          } catch (_compErr) {
            // Keep original dataUrl
          }
        }
        const newPhoto: DemoInMemoryPhoto = {
          id: `cov_photo_${Date.now()}`,
          fileName: file.name,
          objectUrl: finalDataUrl,
          dataUrl: finalDataUrl,
          mimeType: 'image/jpeg',
          width: img.width || 800,
          height: img.height || 600,
          focusY: 'center',
          zoom: 1,
        };
        setCoverPhoto(newPhoto);
        setEditorialConfig((prev) => ({ ...prev, coverVisualType: 'photo' }));
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  // Download the 6-page sample preview PDF for the currently selected Literary Style
  const handleDownloadPreviewSamplePdf = async () => {
    pdfCancelRequestedRef.current = false;
    startProgress('pdf');
    try {
      setStudioError(null);
      const resolvedCover = await ensureDataUrlForPdf(coverPhoto);
      const resolvedChapterPhotos: Record<string, DemoInMemoryPhoto | null> = {};
      for (const [k, v] of Object.entries(chapterPhotos || {})) {
        resolvedChapterPhotos[k] = await ensureDataUrlForPdf(v);
      }
      const resolvedAllPhotos: Record<string, DemoInMemoryPhoto> = {};
      for (const [k, v] of Object.entries(allPhotosById || {})) {
        const resPh = await ensureDataUrlForPdf(v);
        if (resPh) resolvedAllPhotos[k] = resPh;
      }

      if (pdfCancelRequestedRef.current) return;
      updateProgress({ stage: 'compose' });
      const previewComposed = composeBookPages({
        manuscript,
        editorialConfig,
        coverPhoto: resolvedCover,
        chapterPhotos: resolvedChapterPhotos,
        allPhotosById: resolvedAllPhotos,
        customClosingPageText: closingDedicationText,
        maxContentPages: 500,
        previewSampleOnly: true,
      });

      await preloadBookResourcesForPdf(previewComposed);
      if (pdfCancelRequestedRef.current) return;
      updateProgress({ stage: 'pdf' });

      const styleSuffix =
        narrativeStyle === 'first_person_simple'
          ? 'Estilo_A_Sencillo'
          : narrativeStyle === 'third_person_biography'
          ? 'Estilo_C_Tercera_Persona'
          : 'Estilo_B_Literario';

      const pdfResult = generateRealDemoBookPdf({
        composed: previewComposed,
        profile: {
          mode: isCouple ? 'pareja' : 'individual',
          displayName: participant.name,
          fullName: participant.name,
          partner1Name: participantNames[0] || participant.name,
          partner2Name: participantNames[1] || 'Pareja',
          customTitle: editorialConfig.customTitle || manuscript.title,
          hasAcceptedTemporaryNotice: true,
        },
      });

      if (pdfResult.integrityReport && !pdfResult.integrityReport.passed) {
        console.warn('[ParticipantBookStudio] PDF integrity notices:', pdfResult.integrityReport.errors);
      }

      const a = document.createElement('a');
      a.href = pdfResult.blobUrl;
      a.download = pdfResult.filename.replace(/\.pdf$/i, `_Muestra_${styleSuffix}.pdf`);
      if (pdfCancelRequestedRef.current) {
        URL.revokeObjectURL(pdfResult.blobUrl);
        return;
      }
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(pdfResult.blobUrl), 10000);
      updateProgress({
        status: 'done',
        doneTitle: '¡Tu PDF de muestra está listo!',
        doneMessage: 'La descarga de tu muestra editorial ya comenzó.',
      });
    } catch (err: any) {
      console.warn('[ParticipantBookStudio] PDF de muestra no disponible:', err);
      pauseProgress();
    }
  };

  // Download any saved version (or pre-composed book) as a real vector PDF respecting its exact editorialConfig
  const handleDownloadBookVersionPdf = async (
    version: ParticipantBookVersionRecord,
    preComposedBook?: ReturnType<typeof composeBookPages>
  ): Promise<boolean> => {
    // V5.3.5: inside the save flow the alert is already open (step «Creando el PDF»).
    const standalone = !preComposedBook;
    if (standalone) {
      pdfCancelRequestedRef.current = false;
      startProgress('pdf');
    }
    try {
      let composedForVersion = preComposedBook;
      if (!composedForVersion) {
        const resolvedCover = await ensureDataUrlForPdf(version.coverPhoto);
        const resolvedChapterPhotos: Record<string, DemoInMemoryPhoto | null> = {};
        for (const [k, v] of Object.entries(version.chapterPhotos || {})) {
          resolvedChapterPhotos[k] = await ensureDataUrlForPdf(v);
        }
        const resolvedAllPhotos: Record<string, DemoInMemoryPhoto> = {};
        for (const [k, v] of Object.entries(allPhotosById || {})) {
          const resPh = await ensureDataUrlForPdf(v);
          if (resPh) resolvedAllPhotos[k] = resPh;
        }

        if (pdfCancelRequestedRef.current) return false;
        updateProgress({ stage: 'compose' });
        composedForVersion = composeBookPages({
          manuscript: version.manuscript,
          editorialConfig: version.editorialConfig,
          coverPhoto: resolvedCover,
          chapterPhotos: resolvedChapterPhotos,
          allPhotosById: resolvedAllPhotos,
          customClosingPageText: version.closingPageText ?? closingDedicationText,
          maxContentPages: 500,
          previewSampleOnly: false,
          lockedLeadingContentGroups: version.manuscript.lockedPreviewGroups,
        });
      }

      await preloadBookResourcesForPdf(composedForVersion);
      if (pdfCancelRequestedRef.current) return false;
      if (standalone) updateProgress({ stage: 'pdf' });

      const pdfResult = generateRealDemoBookPdf({
        composed: composedForVersion,
        profile: {
          mode: isCouple ? 'pareja' : 'individual',
          displayName: participant.name,
          fullName: participant.name,
          partner1Name: participantNames[0] || participant.name,
          partner2Name: participantNames[1] || 'Pareja',
          customTitle: version.editorialConfig?.customTitle || version.title,
          hasAcceptedTemporaryNotice: true,
        },
      });

      const a = document.createElement('a');
      a.href = pdfResult.blobUrl;
      a.download = version.fileName || pdfResult.filename;
      if (pdfCancelRequestedRef.current) {
        URL.revokeObjectURL(pdfResult.blobUrl);
        return false;
      }
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(pdfResult.blobUrl), 10000);
      if (standalone) {
        updateProgress({
          status: 'done',
          doneTitle: '¡Tu PDF está listo!',
          doneMessage: 'La descarga de tu libro ya comenzó.',
        });
      }
      return true;
    } catch (err: any) {
      console.warn('[ParticipantBookStudio] PDF no disponible:', err);
      if (standalone) pauseProgress();
      return false;
    }
  };

  // Compute how many layout modifications will remain AFTER saving the new PDF version
  const remainingEditsAfterSave = useMemo(() => {
    if (!hasSavedVersions) {
      // Saving Version 1 (initial creation) leaves all additional layout edits available (default: 1)
      return quotaStatus.layoutEditsAllowed;
    }
    return Math.max(0, quotaStatus.remainingEdits - 1);
  }, [hasSavedVersions, quotaStatus.layoutEditsAllowed, quotaStatus.remainingEdits]);

  // Open warning confirmation modal before generating & saving final PDF version
  const handleRequestSaveAndGenerateBook = () => {
    if (!hasSelectedStyleInSession || !narrativeStyle) {
      setStudioError(
        'Por favor selecciona primero un Estilo Narrativo para generar la muestra de 5 páginas antes de guardar tu libro.'
      );
      setStudioTab('estilo');
      scrollAndFocusActionArea('editor');
      return;
    }
    setStudioError(null);
    setShowSaveConfirmModal(true);
  };

  // Strip heavy base64 dataUrls from photos that already exist on the server (/api/photos/:id)
  // so JSON POST requests stay fast and lightweight without hitting 413 Payload Too Large limits.
  const makeLightweightPhotoRef = (
    photo: DemoInMemoryPhoto | null | undefined
  ): DemoInMemoryPhoto | null => {
    if (!photo) return null;
    if (photo.id && photo.id.startsWith('photo_')) {
      const apiUrl = `/api/photos/${photo.id}`;
      return {
        ...photo,
        objectUrl: apiUrl,
        dataUrl: apiUrl,
      };
    }
    return photo;
  };

  // Save new book version to database: generates the complete manuscript (`scope: 'full'`) while keeping
  // the exact first 5 pages shown in the preview, saves the complete version with the active editorialConfig,
  // and downloads the full PDF
  const handleSaveAndGenerateBookVersion = async () => {
    setShowSaveConfirmModal(false);
    setIsSavingBook(true);
    setStudioError(null);
    setStudioSuccessMsg(null);
    pdfCancelRequestedRef.current = false;
    startProgress('full');

    const activeStyle: DemoNarrativeStyleId =
      narrativeStyle || editorialConfig.narrativeStyle || 'first_person_literary';
    const currentEditorialConfig: DemoEditorialConfig = {
      ...editorialConfig,
      narrativeStyle: activeStyle,
    };

    try {
      const resolvedCover = await ensureDataUrlForPdf(coverPhoto);
      const resolvedChapters: Record<string, DemoInMemoryPhoto | null> = {};
      for (const [k, v] of Object.entries(chapterPhotos)) {
        resolvedChapters[k] = await ensureDataUrlForPdf(v);
      }
      const resolvedAllPhotos: Record<string, DemoInMemoryPhoto> = {};
      for (const [k, v] of Object.entries(allPhotosById || {})) {
        const resPh = await ensureDataUrlForPdf(v);
        if (resPh) resolvedAllPhotos[k] = resPh;
      }

      // 1. Verify or obtain the single canonical approved manuscript for the active style
      let fullManuscriptToSave: DemoManuscript = {
        ...manuscript,
        narrativeStyle: activeStyle,
        useOfficialForeverYouLogo: true,
      };

      const isAlreadyCanonicalApproved =
        manuscript.narrativeStyle === activeStyle &&
        manuscript.generationStatus === 'approved' &&
        Array.isArray(manuscript.chapters) &&
        manuscript.chapters.length > 0;

      if (!isAlreadyCanonicalApproved) {
        let startRes: Response;
        try {
          startRes = await fetch('/api/participant/book/jobs/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token,
              narrativeStyle: activeStyle,
              scope: 'full',
              lockedPreviewManuscript: {
                ...manuscript,
                lockedPreviewGroups: undefined,
              },
            }),
          });
        } catch (_fetchErr: any) {
          setRetryAction('save');
          throw new Error(
BOOK_IN_PROGRESS_MESSAGE
          );
        }

        const startData = await safeReadJsonResponse(startRes);
        if (!startRes.ok || !startData.success || !startData.data) {
          setRetryAction('save');
          throw new Error(
            startData.error || BOOK_IN_PROGRESS_MESSAGE
          );
        }

        const payload = await pollBookGenerationJob(startData.data, () => false);
        activeJobIdRef.current = null;
        setGenerationJobProgress(null);

        if (payload?.cancelled || pdfCancelRequestedRef.current) {
          setProgressOverlay(null);
          return;
        }

        if (!payload || !payload.manuscript) {
          setRetryAction('save');
          throw new Error(
BOOK_IN_PROGRESS_MESSAGE
          );
        }

        setRetryAction(null);
        if (payload.providerFallbackNotice) {
          setProviderFallbackNotice(payload.providerFallbackNotice);
        } else {
          setProviderFallbackNotice(null);
        }
        if (payload.providerUsed || payload.modelUsed) {
          setActiveAiEngineInfo({
            providerUsed:
              payload.providerUsed === 'openai' ? 'OpenAI (ChatGPT)' : 'Google (Gemini)',
            modelUsed: payload.modelUsed || '',
            cachedContextUsed: Boolean(payload.cachedContextUsed),
          });
        }

        const candidateManu = payload.manuscript as DemoManuscript;
        if (
          candidateManu.generationStatus === 'incomplete_draft' ||
          candidateManu.status === 'incomplete_draft'
        ) {
          setManuscript(candidateManu);
          setAiOriginalManuscript(JSON.parse(JSON.stringify(candidateManu)));
          setHasAiDraftLoadedForSession(true);
          setRetryAction('full');
          throw new Error(
BOOK_IN_PROGRESS_MESSAGE
          );
        }
        if (
          candidateManu.generationStatus === 'failed_ai' ||
          candidateManu.generationStatus === 'failed_audit' ||
          candidateManu.generationStatus === 'error' ||
          !Array.isArray(candidateManu.chapters) ||
          candidateManu.chapters.length === 0
        ) {
          setRetryAction('save');
          throw new Error(
BOOK_IN_PROGRESS_MESSAGE
          );
        }

        // V5.2: the approved narrative (introduction, chapters, chapter titles, closing message
        // and photo placements) is kept EXACTLY as the server approved and signed it. Only
        // editorial fields outside the audited content are carried over from the studio, so
        // the approval evidence still matches and saving does not trigger a re-audit.
        fullManuscriptToSave = mergeEditorialFieldsIntoApprovedManuscript({
          approved: candidateManu,
          studio: manuscript,
          narrativeStyle: activeStyle,
        });
      }

      // V5.3.5: from here on the book is being saved; «Cancelar» waits until the PDF step.
      if (pdfCancelRequestedRef.current) {
        setProgressOverlay(null);
        return;
      }
      updateProgress({ stage: 'save', cancellable: false });

      // 2. Compose the complete book directly from the canonical manuscript (Pages 1..5 are 100% identical to preview)
      const fullComposedBook = composeBookPages({
        manuscript: fullManuscriptToSave,
        editorialConfig: currentEditorialConfig,
        coverPhoto: resolvedCover,
        chapterPhotos: resolvedChapters,
        allPhotosById: resolvedAllPhotos,
        customClosingPageText: closingDedicationText,
        maxContentPages: 500,
        previewSampleOnly: false,
      });

      setManuscript(fullManuscriptToSave);
      setEditorialConfig(currentEditorialConfig);

      const lightweightChapterPhotos: Record<string, DemoInMemoryPhoto | null> = {};
      for (const [k, v] of Object.entries(resolvedChapters)) {
        lightweightChapterPhotos[k] = makeLightweightPhotoRef(v);
      }
      const lightweightCoverPhoto = makeLightweightPhotoRef(resolvedCover);

      const res = await fetch('/api/participant/book/save-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          narrativeStyle: activeStyle,
          editorialConfig: currentEditorialConfig,
          manuscript: fullManuscriptToSave,
          coverPhoto: lightweightCoverPhoto,
          chapterPhotos: lightweightChapterPhotos,
          pageCount: fullComposedBook.pages.length,
        }),
      });

      const data = await safeReadJsonResponse(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'No se pudo guardar la versión del libro.');
      }

      // V5.2: the version the SERVER persisted is the canonical one (its manuscript carries the
      // server's approval evidence and any normalization applied by the audit). It replaces the
      // local copy everywhere: React state, version history, browser caches, preview and export.
      const serverVersion = data.data.bookVersion as ParticipantBookVersionRecord;
      const savedVersion: ParticipantBookVersionRecord = {
        ...serverVersion,
        editorialConfig: serverVersion.editorialConfig || currentEditorialConfig,
        narrativeStyle: serverVersion.narrativeStyle || activeStyle,
        manuscript: serverVersion.manuscript || fullManuscriptToSave,
      };
      const updatedInterview = data.data.interview as InterviewRecord;
      const allVersions = (data.data.allVersions as ParticipantBookVersionRecord[]).map((v) =>
        v.id === savedVersion.id ? savedVersion : v
      );
      setManuscript(savedVersion.manuscript);

      // Sync lightweight book version refs to browser localStorage cache so Admin Panel & future sessions preserve versions without bloating storage/payloads
      try {
        const toCacheBookVersion = (bv: ParticipantBookVersionRecord): ParticipantBookVersionRecord => {
          const { allPhotosById: _dropAll, coverPhoto: cp, chapterPhotos: chp, ...rest } = bv;
          const cleanChapters: Record<string, DemoInMemoryPhoto | null> = {};
          if (chp) {
            for (const [k, v] of Object.entries(chp)) {
              cleanChapters[k] = makeLightweightPhotoRef(v);
            }
          }
          return {
            ...rest,
            coverPhoto: makeLightweightPhotoRef(cp),
            chapterPhotos: cleanChapters,
          };
        };

        const rawBvCache = localStorage.getItem('foreveryou_book_versions_cache');
        const existingBvList: ParticipantBookVersionRecord[] = rawBvCache
          ? JSON.parse(rawBvCache)
          : [];
        const mergedBvMap = new Map<string, ParticipantBookVersionRecord>();
        if (Array.isArray(existingBvList)) {
          for (const bv of existingBvList) {
            if (bv && bv.id) mergedBvMap.set(bv.id, toCacheBookVersion(bv));
          }
        }
        for (const bv of allVersions) {
          if (bv && bv.id) mergedBvMap.set(bv.id, toCacheBookVersion(bv));
        }
        localStorage.setItem(
          'foreveryou_book_versions_cache',
          JSON.stringify(Array.from(mergedBvMap.values()))
        );

        const rawIntCache = localStorage.getItem('foreveryou_interviews_cache');
        if (rawIntCache) {
          const parsedIntList = JSON.parse(rawIntCache);
          if (Array.isArray(parsedIntList)) {
            const lightVersions = allVersions.map(toCacheBookVersion);
            const nextIntList = parsedIntList.map((item: any) =>
              item && item.id === updatedInterview.id
                ? {
                    ...item,
                    ...updatedInterview,
                    bookVersions: lightVersions,
                    bookVersionsCount: lightVersions.length,
                    latestBookVersion: lightVersions[0]?.versionNumber || 0,
                  }
                : item
            );
            localStorage.setItem('foreveryou_interviews_cache', JSON.stringify(nextIntList));
          }
        }
      } catch (_cacheErr) {
        // Ignore localStorage quota issues
      }

      onBookVersionSaved({
        bookVersion: savedVersion,
        interview: updatedInterview,
        allVersions,
      });

      setSelectedVersionId(savedVersion.id);
      setIsEditingLayout(false);
      setCurrentPageIdx(0);
      setStudioSuccessMsg(
        `¡Tu libro completo en PDF (Versión ${savedVersion.versionNumber}) ha sido generado y guardado en tu Portal del Participante!`
      );

      // Automatically trigger PDF download composed from the CANONICAL saved manuscript (V5.2),
      // so the exported book is exactly the version stored on the server.
      const canonicalComposedBook =
        savedVersion.manuscript === fullManuscriptToSave
          ? fullComposedBook
          : composeBookPages({
              manuscript: savedVersion.manuscript,
              editorialConfig: savedVersion.editorialConfig || currentEditorialConfig,
              coverPhoto: resolvedCover,
              chapterPhotos: resolvedChapters,
              allPhotosById: resolvedAllPhotos,
              customClosingPageText: closingDedicationText,
              maxContentPages: 500,
              previewSampleOnly: false,
            });
      updateProgress({ stage: 'pdf', cancellable: true });
      const pdfDelivered = await handleDownloadBookVersionPdf(savedVersion, canonicalComposedBook);
      updateProgress({
        status: 'done',
        doneTitle: '¡Tu libro está listo!',
        doneMessage: pdfDelivered
          ? `Tu libro completo (Versión ${savedVersion.versionNumber}) se guardó en tu Portal del Participante y la descarga del PDF ya comenzó.`
          : `Tu libro completo (Versión ${savedVersion.versionNumber}) se guardó en tu Portal del Participante. Puedes descargar el PDF desde tu lista de versiones.`,
      });
      scrollAndFocusActionArea('viewer');
    } catch (err: any) {
      const rawMsg = String(err?.message || '');
      const cleanMsg = /aborted/i.test(rawMsg)
        ? BOOK_IN_PROGRESS_MESSAGE
        : rawMsg || BOOK_IN_PROGRESS_MESSAGE;
      setStudioError(cleanMsg);
      setRetryAction((prev) => prev || 'save');
      pauseProgress();
    } finally {
      setIsSavingBook(false);
    }
  };

  // V5.3.5: «Continuar preparando» (inline notice or floating alert) resumes the right process.
  const handleContinuePreparing = () => {
    setStudioError(null);
    if (retryAction === 'full' || retryAction === 'save') {
      void handleSaveAndGenerateBookVersion();
    } else if (narrativeStyle) {
      void handleSelectNarrativeStyle(narrativeStyle, true);
    } else {
      setProgressOverlay(null);
    }
  };

  // Handle click on "Modificar maquetación"
  const handleRequestModifyLayout = () => {
    setStudioError(null);
    setStudioSuccessMsg(null);
    setShowQuotaConfirmModal(true);
  };

  // Confirm modification inside modal -> unlock editor starting on "1. Estilo Narrativo" with NO style preselected
  // so no 5-page PDF is generated until the user clicks a literary style option
  const handleConfirmAcceptQuotaAndEdit = () => {
    if (activeSavedVersion && !hasUpdatedAnswers) {
      setEditorialConfig({ ...activeSavedVersion.editorialConfig });
      setManuscript(JSON.parse(JSON.stringify(activeSavedVersion.manuscript)));
      setAiOriginalManuscript(JSON.parse(JSON.stringify(activeSavedVersion.manuscript)));
      setCoverPhoto(activeSavedVersion.coverPhoto || null);
      setChapterPhotos(activeSavedVersion.chapterPhotos || initialLocalData.chapterPhotos);
      setManuscriptHistory([JSON.parse(JSON.stringify(activeSavedVersion.manuscript))]);
      setHistoryIdx(0);
    } else {
      setManuscript(JSON.parse(JSON.stringify(initialLocalData.manuscript)));
      setAiOriginalManuscript(JSON.parse(JSON.stringify(initialLocalData.manuscript)));
      setChapterPhotos(initialLocalData.chapterPhotos);
      setManuscriptHistory([JSON.parse(JSON.stringify(initialLocalData.manuscript))]);
      setHistoryIdx(0);
    }
    // Reset style selection so nothing is selected by default and 6-page preview waits for user click and AI redaction
    setHasSelectedStyleInSession(false);
    setHasAiDraftLoadedForSession(false);
    setNarrativeStyle(null);
    setStudioTab('estilo');
    setCurrentPageIdx(0);
    setShowQuotaConfirmModal(false);
    setIsEditingLayout(true);
    scrollAndFocusActionArea('editor');
  };

  return (
    <div className="space-y-8" data-testid="participant-book-studio">
      {/* Top Status & Read-Only Answers Notice Banner */}
      <div className="bg-gradient-to-r from-stone-900 via-stone-800 to-amber-950 text-white rounded-3xl p-6 sm:p-8 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-3">
              <ForeverYouLogo variant="horizontal" theme="light" size="sm" />
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-400/30 text-amber-200 text-xs font-semibold tracking-wide uppercase">
                <Sparkles className="w-3.5 h-3.5" />
                Estudio Editorial YouForever • Entrevista Concluida
              </div>
            </div>
            <h2 className="text-2xl sm:text-3xl font-serif font-bold">
              {hasSavedVersions && !isEditingLayout
                ? 'Tu Libro Autobiográfico en PDF'
                : 'Configura la Maquetación de tu Libro'}
            </h2>
            <p className="text-stone-300 text-sm max-w-2xl leading-relaxed">
              {hasSavedVersions && !isEditingLayout
                ? 'Tu libro generado se encuentra guardado de forma permanente en tu Portal del Participante para que puedas consultarlo y descargarlo en PDF cuando lo desees.'
                : 'Elige primero el Estilo Literario para generar la muestra de 5 páginas y después personaliza portada, diseño interior y formato físico antes de generar tu libro completo en PDF.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {onViewReadOnlyAnswers && (
              <button
                type="button"
                onClick={onViewReadOnlyAnswers}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-medium border border-white/15 transition-colors cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5 text-amber-300" />
                Ver mis respuestas (Solo lectura)
              </button>
            )}

            <div className="px-4 py-2.5 rounded-xl bg-black/30 border border-white/10 text-xs">
              <span className="text-stone-400 block">Modificaciones adicionales:</span>
              <span
                className={`font-bold ${
                  quotaStatus.remainingEdits > 0 ? 'text-amber-300' : 'text-stone-300'
                }`}
                data-testid="participant-remaining-layout-edits"
              >
                {hasSavedVersions
                  ? `${quotaStatus.remainingEdits} disponible(s) de ${quotaStatus.layoutEditsAllowed}`
                  : `Creación inicial + ${quotaStatus.layoutEditsAllowed} modificación adicional`}
              </span>
            </div>

            {!isEditingLayout && hasSavedVersions && quotaStatus.remainingEdits > 0 && (
              <button
                type="button"
                onClick={handleRequestModifyLayout}
                data-testid="btn-request-modify-layout-top"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-600 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
              >
                <Palette className="w-4 h-4" />
                Modificar maquetación ({quotaStatus.remainingEdits})
              </button>
            )}
          </div>
        </div>
      </div>

      {studioError && (
        <div
          data-testid={retryAction ? 'book-in-progress-notice' : 'studio-error'}
          className={`${
            retryAction ? 'bg-amber-50 border-amber-200 text-amber-950' : 'bg-red-50 border-red-200 text-red-800'
          } border rounded-2xl p-4 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3`}
        >
          <div className="flex items-start gap-3">
            {retryAction ? (
              <Loader2 className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            ) : (
              <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            )}
            <div>{studioError}</div>
          </div>
          {retryAction && (
            <button
              type="button"
              onClick={handleContinuePreparing}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-800 hover:bg-amber-900 text-white text-xs font-semibold shrink-0 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Continuar preparando</span>
            </button>
          )}
        </div>
      )}


      {studioSuccessMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-2xl p-4 text-sm flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>{studioSuccessMsg}</div>
        </div>
      )}

      {/* V5.3.5: progress of every book creation step is shown in the floating alert. */}
      <BookProgressOverlay
        state={progressOverlay}
        job={generationJobProgress}
        onCancel={handleCancelProgressOverlay}
        onAccept={() => setProgressOverlay(null)}
        onContinue={handleContinuePreparing}
      />

      {(manuscript.generationStatus === 'incomplete_draft' ||
        manuscript.status === 'incomplete_draft') && (
        <div
          data-testid="incomplete-draft-banner"
          className="bg-amber-50 border border-amber-200 text-amber-950 rounded-2xl p-4 sm:p-5 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shadow-xs"
        >
          <div className="flex items-start gap-3">
            <Loader2 className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="text-xs font-extrabold tracking-wide uppercase text-amber-900">
                TU LIBRO SIGUE EN PREPARACIÓN
              </div>
              <p className="text-xs text-amber-900 leading-relaxed">{BOOK_IN_PROGRESS_MESSAGE}</p>
            </div>
          </div>
          {narrativeStyle && (
            <button
              type="button"
              disabled={isGeneratingAI || isSavingBook}
              onClick={() => void handleSelectNarrativeStyle(narrativeStyle, true)}
              data-testid="btn-retry-incomplete-draft"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-800 hover:bg-amber-900 disabled:opacity-50 text-white text-xs font-semibold shrink-0 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingAI ? 'animate-spin' : ''}`} />
              <span>Continuar preparando</span>
            </button>
          )}
        </div>
      )}

      {/* Main Studio Area: Left Configuration Controls (when editing) + Right Interactive Book Preview */}
      <div
        ref={studioWorkspaceRef}
        className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start scroll-mt-20"
      >
        {isEditingLayout && (
          <div className="lg:col-span-7 bg-white rounded-3xl border border-stone-200/80 shadow-xs overflow-hidden">
            {/* Studio Navigation Tabs */}
            <div className="border-b border-stone-200 bg-stone-50/70 p-2 flex flex-wrap gap-1.5">
              {[
                { id: 'estilo', label: '1. Estilo Literario (3)', icon: Sparkles },
                { id: 'portada', label: '2. Portada (5)', icon: Palette },
                { id: 'interior', label: '3. Diseño Interior (5)', icon: Layers },
                { id: 'formato', label: '4. Formato Físico (3)', icon: BookOpen },
                { id: 'texto', label: '5. Título y Dedicatoria', icon: TypeIcon },
              ].map((t) => {
                const Icon = t.icon;
                const active = studioTab === t.id;
                const isLockedTab = t.id !== 'estilo' && !hasSelectedStyleInSession;
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={isLockedTab}
                    data-testid={`studio-tab-${t.id}`}
                    onClick={() => {
                      if (isLockedTab) return;
                      setStudioTab(t.id as any);
                      if (t.id === 'portada') {
                        setCurrentPageIdx(0);
                      } else if (t.id === 'interior' && currentPageIdx === 0) {
                        setCurrentPageIdx(2);
                      }
                      scrollAndFocusActionArea('editor');
                    }}
                    title={
                      isLockedTab
                        ? 'Primero selecciona un Estilo Literario en el paso 1'
                        : t.label
                    }
                    className={`flex-1 min-w-[130px] inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                      active
                        ? 'bg-stone-900 text-white shadow-xs cursor-pointer'
                        : isLockedTab
                        ? 'text-stone-400 bg-stone-100/60 opacity-60 cursor-not-allowed'
                        : 'text-stone-600 hover:bg-stone-200/60 cursor-pointer'
                    }`}
                  >
                    {isLockedTab ? (
                      <Lock className="w-3 h-3 text-stone-400" />
                    ) : (
                      <Icon className="w-3.5 h-3.5" />
                    )}
                    {t.label}
                  </button>
                );
              })}
            </div>

            <div className="p-6 space-y-6">
              {/* TAB 1: 3 NARRATIVE STYLES */}
              {studioTab === 'estilo' && (
                <div className="space-y-4" data-testid="studio-panel-estilo">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-base font-serif font-bold text-stone-900">
                        Paso 1: Elige el Estilo Literario de tu Obra
                      </h3>
                      <p className="text-xs text-stone-500">
                        Haz clic en un estilo literario para generar las primeras 5 páginas de muestra. La muestra sirve para conocer el estilo: el libro completo se redactará después de forma independiente. Para continuar a las siguientes secciones, primero debes elegir una opción.
                      </p>
                    </div>
                    {isGeneratingAI && (
                      <span
                        className="inline-flex items-center gap-1.5 text-xs text-amber-800 font-medium bg-amber-50 px-3 py-1.5 rounded-xl border border-amber-200"
                        data-testid="generating-5-page-sample-badge"
                      >
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generando muestra de 5 páginas...
                      </span>
                    )}
                  </div>

                  <div className="space-y-3">
                    {DEMO_NARRATIVE_STYLES.map((st, idx) => {
                      const selected = hasSelectedStyleInSession && narrativeStyle === st.id;
                      return (
                        <button
                          key={st.id}
                          ref={idx === 1 ? firstStyleOptionRef : undefined}
                          type="button"
                          data-testid={`narrative-style-card-${st.id}`}
                          onClick={() => handleSelectNarrativeStyle(st.id)}
                          className={`w-full text-left rounded-2xl p-4 border-2 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                            selected
                              ? 'border-amber-700 bg-amber-50/50 shadow-xs'
                              : 'border-stone-200 bg-white hover:border-amber-400/70'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-serif font-bold text-stone-900 text-sm">
                              {isCouple ? st.coupleTitle : st.individualTitle}
                            </span>
                            <div className="flex items-center gap-2">
                              {st.recommended && (
                                <span
                                  className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold"
                                  data-testid="recommended-style-badge"
                                >
                                  Opción recomendada
                                </span>
                              )}
                              {selected && (
                                <span className="px-2 py-0.5 rounded bg-amber-800 text-white text-[10px] font-bold">
                                  Seleccionado
                                </span>
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-stone-600 mt-1">
                            {isCouple ? st.coupleDescription : st.individualDescription}
                          </p>
                          <div className="mt-2.5 p-2.5 rounded-xl bg-stone-100/80 border border-stone-200/60 text-[11px] italic text-stone-700">
                            {isCouple ? st.coupleExample : st.individualExample}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {hasSelectedStyleInSession && (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-emerald-50/80 border border-emerald-200 rounded-2xl p-3.5">
                      <div className="space-y-1">
                        <span className="text-xs text-emerald-900 font-medium block">
                          ✓ Muestra de 6 páginas generada con el estilo Literario activo.
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {narrativeStyle && (
                          <button
                            type="button"
                            disabled={isGeneratingAI}
                            onClick={() => handleSelectNarrativeStyle(narrativeStyle, true)}
                            data-testid="btn-regenerate-preview-ai"
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-amber-50 text-amber-900 border border-amber-300 text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingAI ? 'animate-spin' : ''}`} />
                            <span>Regenerar vista previa</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setStudioTab('portada');
                            setCurrentPageIdx(0);
                            scrollAndFocusActionArea('editor');
                          }}
                          data-testid="btn-continue-to-portada"
                          className="px-4 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold shrink-0 cursor-pointer"
                        >
                          Continuar a Portada →
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: 5 COVER DESIGNS + COLOR VARIANTS + OPTIONAL VISUAL ELEMENT */}
              {studioTab === 'portada' && (
                <div className="space-y-6" data-testid="studio-panel-portada">
                  <div>
                    <h3 className="text-base font-serif font-bold text-stone-900">
                      5 Diseños de Portada Conmemorativa
                    </h3>
                    <p className="text-xs text-stone-500">
                      Selecciona la arquitectura editorial de tu portada y su variante cromática.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {DEMO_COVER_DESIGNS.map((design) => {
                      const isSel = editorialConfig.coverDesignId === design.id;
                      const pal =
                        design.variants[isSel ? editorialConfig.coverColorVariantIdx : 0] ||
                        design.variants[0];
                      return (
                        <DemoCoverThumbnailCard
                          key={design.id}
                          design={design}
                          palette={pal}
                          title={editorialConfig.customTitle || interview.title}
                          authors={editorialConfig.customAuthors || participant.name}
                          selected={isSel}
                          onSelect={() => {
                            setEditorialConfig((prev) => ({
                              ...prev,
                              coverDesignId: design.id as DemoCoverDesignId,
                              coverColorVariantIdx: 0,
                            }));
                            setCurrentPageIdx(0);
                          }}
                        />
                      );
                    })}
                  </div>

                  {/* Color Palette Variants for Selected Cover */}
                  {(() => {
                    const activeDesign =
                      DEMO_COVER_DESIGNS.find((c) => c.id === editorialConfig.coverDesignId) ||
                      DEMO_COVER_DESIGNS[0];
                    return (
                      <div className="bg-stone-50 rounded-2xl p-4 border border-stone-200/80 space-y-3">
                        <label className="block text-xs font-bold uppercase tracking-wider text-stone-600">
                          Variantes cromáticas para «{activeDesign.name}»
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          {activeDesign.variants.map((variant, vIdx) => {
                            const active = editorialConfig.coverColorVariantIdx === vIdx;
                            return (
                              <button
                                key={variant.name}
                                type="button"
                                onClick={() => {
                                  setEditorialConfig((prev) => ({
                                    ...prev,
                                    coverColorVariantIdx: vIdx,
                                  }));
                                  setCurrentPageIdx(0);
                                }}
                                className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                                  active
                                    ? 'border-amber-800 bg-amber-50/70 font-semibold shadow-2xs'
                                    : 'border-stone-200 bg-white hover:border-stone-300'
                                }`}
                              >
                                <span
                                  className="w-6 h-6 rounded-full border border-black/15 shrink-0"
                                  style={{ backgroundColor: variant.bgHex }}
                                />
                                <span className="text-xs text-stone-800 truncate">
                                  {variant.name}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Optional Visual Element on Cover */}
                  <div className="bg-stone-50 rounded-2xl p-4 border border-stone-200/80 space-y-4">
                    <label className="block text-xs font-bold uppercase tracking-wider text-stone-600">
                      Elemento visual en portada (Opcional)
                    </label>
                    <div className="grid grid-cols-3 gap-2.5">
                      {[
                        { id: 'illustration', label: 'Ilustración temática' },
                        { id: 'photo', label: 'Fotografía en portada' },
                        { id: 'none', label: 'Solo tipografía clásica' },
                      ].map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            setEditorialConfig((prev) => ({
                              ...prev,
                              coverVisualType: opt.id as any,
                            }));
                            setCurrentPageIdx(0);
                          }}
                          className={`px-3 py-2 rounded-xl text-xs font-medium border transition-all cursor-pointer ${
                            editorialConfig.coverVisualType === opt.id
                              ? 'border-amber-800 bg-amber-800 text-white'
                              : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-100'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    {editorialConfig.coverVisualType === 'illustration' && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                        {DEMO_THEMATIC_ILLUSTRATIONS.map((ill) => (
                          <button
                            key={ill.id}
                            type="button"
                            onClick={() => {
                              setEditorialConfig((prev) => ({
                                ...prev,
                                coverIllustrationId: ill.id as DemoThematicIllustrationId,
                              }));
                              setCurrentPageIdx(0);
                            }}
                            className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                              editorialConfig.coverIllustrationId === ill.id
                                ? 'border-amber-700 bg-amber-50/70'
                                : 'border-stone-200 bg-white'
                            }`}
                          >
                            <div className="text-xs font-semibold text-stone-900">{ill.label}</div>
                            <div className="text-[10px] text-stone-500 line-clamp-1">
                              {ill.description}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    {editorialConfig.coverVisualType === 'photo' && (
                      <div className="space-y-3 pt-1">
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-stone-900 text-white text-xs font-medium cursor-pointer hover:bg-stone-800">
                            <Upload className="w-3.5 h-3.5" />
                            Subir fotografía de portada
                            <input
                              type="file"
                              accept="image/*"
                              onChange={handleUploadCustomCoverPhoto}
                              className="hidden"
                            />
                          </label>
                          {coverPhoto && (
                            <span className="text-xs text-emerald-700 font-medium">
                              ✓ Fotografía seleccionada para portada
                            </span>
                          )}
                        </div>

                        {allInterviewPhotos.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="text-[11px] text-stone-500 block">
                              O elige una de las fotografías que subiste en tus respuestas:
                            </span>
                            <div className="flex flex-wrap gap-2">
                              {allInterviewPhotos.map((ph) => (
                                <button
                                  key={ph.id}
                                  type="button"
                                  onClick={() => {
                                    setCoverPhoto(ph);
                                    setCurrentPageIdx(0);
                                  }}
                                  className={`w-14 h-14 rounded-lg overflow-hidden border-2 cursor-pointer ${
                                    coverPhoto?.id === ph.id
                                      ? 'border-amber-700 ring-2 ring-amber-400'
                                      : 'border-stone-200'
                                  }`}
                                >
                                  <img
                                    src={ph.objectUrl}
                                    alt={ph.caption || 'Foto'}
                                    className="w-full h-full object-cover"
                                  />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: 5 INTERIOR DESIGN STYLES */}
              {studioTab === 'interior' && (
                <div className="space-y-4" data-testid="studio-panel-interior">
                  <div>
                    <h3 className="text-base font-serif font-bold text-stone-900">
                      5 Estilos de Diseño Interior
                    </h3>
                    <p className="text-xs text-stone-500">
                      Define la tipografía de lectura, capitulares, ornamentos y tono de papel tanto en la vista previa como en el PDF final.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {DEMO_INTERIOR_STYLES.map((styleSpec) => (
                      <DemoInteriorThumbnailCard
                        key={styleSpec.id}
                        styleSpec={styleSpec}
                        selected={editorialConfig.interiorStyleId === styleSpec.id}
                        onSelect={() => {
                          setEditorialConfig((prev) => ({
                            ...prev,
                            interiorStyleId: styleSpec.id as DemoInteriorStyleId,
                          }));
                          // Switch viewer to an interior chapter page (Page 3) if currently on cover so user immediately sees the interior style change
                          if (currentPageIdx === 0 && composedBook.pages.length >= 3) {
                            setCurrentPageIdx(2);
                          }
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 4: 3 PHYSICAL FORMATS */}
              {studioTab === 'formato' && (
                <div className="space-y-4" data-testid="studio-panel-formato">
                  <div>
                    <h3 className="text-base font-serif font-bold text-stone-900">
                      3 Formatos Físicos Reales de Impresión
                    </h3>
                    <p className="text-xs text-stone-500">
                      Las páginas, márgenes y letras se adaptan automáticamente al tamaño de libro que elijas tanto en pantalla como al descargarlo.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {DEMO_BOOK_FORMATS.map((fmt) => {
                      const selected = editorialConfig.bookFormatId === fmt.id;
                      return (
                        <button
                          key={fmt.id}
                          type="button"
                          data-testid={`format-option-${fmt.id}`}
                          onClick={() =>
                            setEditorialConfig((prev) => ({
                              ...prev,
                              bookFormatId: fmt.id as DemoBookFormatId,
                            }))
                          }
                          className={`p-4 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
                            selected
                              ? 'border-amber-700 bg-amber-50/50 shadow-xs'
                              : 'border-stone-200 bg-white hover:border-stone-300'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="font-serif font-bold text-stone-900 text-sm">
                                {fmt.name}
                              </span>
                              {selected && (
                                <Check className="w-4 h-4 text-amber-800" />
                              )}
                            </div>
                            <div className="text-xs font-mono text-amber-800 mt-1">
                              {fmt.dimensionsLabel}
                            </div>
                            <p className="text-xs text-stone-600 mt-2">{fmt.description}</p>
                          </div>
                          <div className="mt-4 pt-2 border-t border-stone-200/60 text-[10px] text-stone-500">
                            Márgenes: {fmt.marginInnerMm} mm int. / {fmt.marginOuterMm} mm ext.
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TAB 5: MANUAL METADATA & TITLE EDITING */}
              {studioTab === 'texto' && (
                <div className="space-y-5" data-testid="studio-panel-texto">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-base font-serif font-bold text-stone-900">
                        Título, Autor y Dedicatoria del Libro
                      </h3>
                      <p className="text-xs text-stone-500">
                        Personaliza el título principal, subtítulo, autor y la dedicatoria inicial de tu obra antes de generar tu versión final en PDF.
                      </p>
                    </div>
                  </div>

                  {/* Book Metadata Inputs */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-stone-50 p-4 rounded-2xl border border-stone-200/80">
                    <div>
                      <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                        Título de la obra
                      </label>
                      <input
                        type="text"
                        value={editorialConfig.customTitle || ''}
                        onChange={(e) =>
                          setEditorialConfig((prev) => ({
                            ...prev,
                            customTitle: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                        Subtítulo
                      </label>
                      <input
                        type="text"
                        value={editorialConfig.customSubtitle || ''}
                        onChange={(e) =>
                          setEditorialConfig((prev) => ({
                            ...prev,
                            customSubtitle: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                        Autor(es) en portada
                      </label>
                      <input
                        type="text"
                        value={editorialConfig.customAuthors || ''}
                        onChange={(e) =>
                          setEditorialConfig((prev) => ({
                            ...prev,
                            customAuthors: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                        Dedicatoria inicial en portadilla (Opcional)
                      </label>
                      <input
                        type="text"
                        value={editorialConfig.dedication || ''}
                        placeholder="Ej. Para mis hijos y nietos con todo mi amor..."
                        onChange={(e) =>
                          setEditorialConfig((prev) => ({
                            ...prev,
                            dedication: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white text-xs"
                      />
                    </div>
                  </div>

                  {/* Editorial TOC & Credits Options */}
                  <div className="bg-stone-50 rounded-2xl p-4 border border-stone-200/80 space-y-2.5">
                    <span className="block text-[11px] font-bold uppercase tracking-wider text-stone-600">
                      Páginas editoriales opcionales
                    </span>
                    <div className="flex flex-wrap gap-4">
                      <label className="inline-flex items-center gap-2 text-xs text-stone-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editorialConfig.includeTableOfContents ?? true}
                          onChange={(e) =>
                            setEditorialConfig((prev) => ({
                              ...prev,
                              includeTableOfContents: e.target.checked,
                            }))
                          }
                          className="w-4 h-4 rounded border-stone-300 text-amber-800"
                        />
                        <span>Incluir índice de capítulos</span>
                      </label>
                      <label className="inline-flex items-center gap-2 text-xs text-stone-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(editorialConfig.includeEditorialCredits)}
                          onChange={(e) =>
                            setEditorialConfig((prev) => ({
                              ...prev,
                              includeEditorialCredits: e.target.checked,
                            }))
                          }
                          className="w-4 h-4 rounded border-stone-300 text-amber-800"
                        />
                        <span>Incluir página de créditos editoriales</span>
                      </label>
                    </div>
                  </div>

                  {/* Closing Page Dedication Notice */}
                  <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-3.5 text-xs text-amber-950">
                    <span className="font-bold">Página final de cierre del PDF:</span> Se dará preferencia a tu dedicatoria o motivo de cierre registrado al concluir tu entrevista (
                    <em>
                      «
                      {closingDedicationText ||
                        'Esta historia continuará...'}
                      »
                    </em>
                    ) acompañada del sello <strong>&lt;&lt; YouForever &gt;&gt;</strong>.
                  </div>
                </div>
              )}

              {/* Primary Save & Generate PDF Version Button */}
              <div className="pt-4 border-t border-stone-200 flex flex-wrap items-center justify-between gap-4">
                <div className="text-xs text-stone-500">
                  {!hasSelectedStyleInSession
                    ? 'Selecciona un Estilo Literario arriba para habilitar la generación del PDF.'
                    : hasSavedVersions
                    ? `Se guardará como Versión ${bookVersions.length + 1} (te quedarán ${remainingEditsAfterSave} modificación(es) después).`
                    : `Se guardará como Versión 1 de tu libro completo en PDF y te quedará(n) ${remainingEditsAfterSave} modificación(es) adicional(es).`}
                </div>

                <div className="flex items-center gap-3">
                  {hasSavedVersions && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingLayout(false);
                        scrollAndFocusActionArea('viewer');
                      }}
                      className="px-4 py-2.5 rounded-xl border border-stone-300 text-stone-700 text-xs font-medium hover:bg-stone-100 cursor-pointer"
                    >
                      Cancelar edición
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={
                      isSavingBook ||
                      isGeneratingAI ||
                      !hasSelectedStyleInSession ||
                      manuscript.generationStatus === 'incomplete_draft' ||
                      manuscript.status === 'incomplete_draft'
                    }
                    onClick={handleRequestSaveAndGenerateBook}
                    data-testid="btn-save-participant-book-version"
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-amber-800 hover:bg-amber-900 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold shadow-sm transition-all cursor-pointer"
                  >
                    {isSavingBook ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Guardando y generando PDF...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        {hasSavedVersions
                          ? `Guardar nueva versión (v${bookVersions.length + 1}) y Descargar PDF`
                          : 'Guardar y Generar mi Libro en PDF (Versión 1)'}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Right / Full-Width Live Book Preview (Mode A: Flipbook & Mode B: Continuous PDF Reader) */}
        <div
          ref={viewerPanelRef}
          data-testid="book-preview-viewer-panel"
          className={`${
            isEditingLayout ? 'lg:col-span-5' : 'lg:col-span-12'
          } bg-stone-900 rounded-3xl p-5 sm:p-7 text-white space-y-5 shadow-xl scroll-mt-20`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div className="space-y-1">
              <span className="text-[11px] uppercase tracking-widest text-amber-300 font-semibold block">
                {isEditingLayout
                  ? 'Vista Previa Editorial (Muestra de las primeras 5 páginas)'
                  : `Visualizando Libro Completo • Versión ${activeSavedVersion?.versionNumber || 1}`}
              </span>
              <h4
                className="text-base font-serif font-bold"
                data-testid="viewer-format-dimensions-heading"
              >
                {composedBook.format.name} ({composedBook.format.dimensionsLabel}) •{' '}
                {isEditingLayout && !hasSelectedStyleInSession
                  ? 'En espera de estilo literario'
                  : isEditingLayout && (isGeneratingAI || !hasAiDraftLoadedForSession)
                  ? 'Procesando borrador de 6 páginas...'
                  : `${composedBook.pages.length} páginas${
                      isEditingLayout ? ' de muestra' : ' totales'
                    }`}
              </h4>
              <p className="text-[11px] text-amber-100/90 leading-relaxed" data-testid="viewer-ai-review-notice">
                {AI_DOCUMENT_REVIEW_NOTICE}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-300">
                <span className="px-2 py-0.5 rounded bg-white/10">
                  Diseño interior: <strong>{composedBook.interiorStyle.name}</strong>
                </span>
                <span className="px-2 py-0.5 rounded bg-white/10">
                  Portada: <strong>{composedBook.coverDesign.name}</strong>
                </span>
              </div>
            </div>

            {(!isEditingLayout || (hasSelectedStyleInSession && hasAiDraftLoadedForSession && !isGeneratingAI)) && (
              <div className="flex flex-wrap items-center gap-2">
                {isEditingLayout && hasSelectedStyleInSession && hasAiDraftLoadedForSession && !isGeneratingAI && (
                  <button
                    type="button"
                    data-testid="btn-download-sample-preview-pdf"
                    onClick={handleDownloadPreviewSamplePdf}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Descargar PDF de Muestra (6 págs.)</span>
                  </button>
                )}
                <div className="flex items-center gap-1.5 bg-white/10 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setPreviewMode('flipbook')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      previewMode === 'flipbook'
                        ? 'bg-amber-700 text-white'
                        : 'text-stone-300 hover:text-white'
                    }`}
                  >
                    Modo Libro
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode('pdf_reader')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      previewMode === 'pdf_reader'
                        ? 'bg-amber-700 text-white'
                        : 'text-stone-300 hover:text-white'
                    }`}
                  >
                    Modo Lector PDF
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Before user clicks a literary style in edit mode, or while waiting for the first 6-page AI draft */}
          {isEditingLayout && !hasSelectedStyleInSession ? (
            <div
              data-testid="viewer-awaiting-style-prompt"
              className="py-16 px-6 rounded-2xl border border-dashed border-white/20 bg-white/5 text-center space-y-3 my-4"
            >
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center mx-auto text-amber-300">
                <Sparkles className="w-6 h-6" />
              </div>
              <p className="text-sm font-serif font-semibold text-white max-w-xs mx-auto">
                Selecciona un Estilo Literario a la izquierda para generar tu primer borrador editorial de 6 páginas.
              </p>
            </div>
          ) : isEditingLayout && (isGeneratingAI || !hasAiDraftLoadedForSession) ? (
            <div
              data-testid="viewer-generating-sample-loader"
              className="py-16 px-6 rounded-2xl border border-amber-400/30 bg-amber-500/10 text-center space-y-4 my-4"
            >
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center mx-auto text-amber-300">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
              <div className="space-y-1.5 max-w-sm mx-auto">
                <p className="text-sm font-serif font-semibold text-white">
                  {generationJobProgress?.userMessage ||
                    'Estamos escribiendo las primeras páginas con el estilo literario que elegiste...'}
                </p>
                <p className="text-xs text-stone-300 leading-relaxed">
                  Tu vista previa aparecerá aquí en cuanto terminemos de organizar estas primeras páginas con tus recuerdos y fotografías.
                </p>
              </div>
            </div>
          ) : previewMode === 'flipbook' ? (
            <div className="space-y-4">
              <div
                className={viewerFormatMaxWidthClass}
                data-testid={`viewer-page-container-${composedBook.format.id}`}
              >
                <DemoComposedPageView
                  composed={composedBook}
                  page={composedBook.pages[currentPageIdx] || composedBook.pages[0]}
                  className="rounded-xl"
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-2">
                <button
                  type="button"
                  disabled={currentPageIdx <= 0}
                  onClick={() => setCurrentPageIdx((p) => Math.max(0, p - 1))}
                  className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-30 text-xs font-medium cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Anterior
                </button>
                <span className="text-xs text-stone-300">
                  Página {currentPageIdx + 1} de {composedBook.pages.length}
                </span>
                <button
                  type="button"
                  disabled={currentPageIdx >= composedBook.pages.length - 1}
                  onClick={() =>
                    setCurrentPageIdx((p) => Math.min(composedBook.pages.length - 1, p + 1))
                  }
                  className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-30 text-xs font-medium cursor-pointer"
                >
                  Siguiente
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="max-h-[640px] overflow-y-auto space-y-6 pr-1">
              {composedBook.pages.map((pg) => (
                <div
                  key={pg.pageNumber}
                  className={`${viewerFormatMaxWidthClass} space-y-1.5`}
                >
                  <div className="text-[11px] text-stone-400 text-center">
                    Página {pg.pageNumber} de {pg.totalPages}
                  </div>
                  <DemoComposedPageView
                    composed={composedBook}
                    page={pg}
                    className="rounded-xl"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Saved PDF Versions & Download Section — ALWAYS placed at the bottom below the PDF story viewer */}
      {hasSavedVersions && (
        <div
          className="bg-white rounded-3xl border border-stone-200/80 shadow-xs p-6 sm:p-8 space-y-6"
          data-testid="saved-book-versions-panel"
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-stone-100 pb-5">
            <div>
              <h3 className="text-lg font-serif font-bold text-stone-900 flex items-center gap-2">
                <History className="w-5 h-5 text-amber-800" />
                Versiones de tu Libro en PDF Guardadas ({bookVersions.length})
              </h3>
              <p className="text-xs text-stone-500 mt-1">
                Todas las versiones generadas de tu libro completo se conservan íntegras debajo del visualizador y disponibles para descarga bajo demanda.
              </p>
            </div>

            {/* Action to Modify Layout (or Notice if Quota Exhausted) */}
            {!isEditingLayout && (
              <div className="flex flex-wrap items-center gap-3">
                {quotaStatus.remainingEdits > 0 ? (
                  <button
                    type="button"
                    onClick={handleRequestModifyLayout}
                    data-testid="btn-request-modify-layout"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-800 hover:bg-amber-900 text-white text-sm font-medium shadow-xs transition-colors cursor-pointer"
                  >
                    <Palette className="w-4 h-4" />
                    Modificar maquetación ({quotaStatus.remainingEdits} cambio
                    {quotaStatus.remainingEdits === 1 ? '' : 's'} restante
                    {quotaStatus.remainingEdits === 1 ? '' : 's'})
                  </button>
                ) : (
                  <div
                    className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-xs text-amber-950 max-w-md"
                    data-testid="quota-exhausted-banner"
                  >
                    <p className="font-semibold flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-amber-800 shrink-0" />
                      Has utilizado todas tus opciones de modificación de maquetación (0 restantes).
                    </p>
                    <p className="text-amber-800 mt-1">
                      Para más modificaciones y/o actualizaciones de tu libro, por favor ponte en contacto con{' '}
                      <strong className="font-bold">YouForever</strong>.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* List of Saved PDF Versions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {bookVersions.map((ver, idx) => {
              const isSelected = activeSavedVersion?.id === ver.id;
              const coverSpec =
                DEMO_COVER_DESIGNS.find((c) => c.id === ver.editorialConfig.coverDesignId) ||
                DEMO_COVER_DESIGNS[0];
              const interiorSpec =
                DEMO_INTERIOR_STYLES.find((i) => i.id === ver.editorialConfig.interiorStyleId) ||
                DEMO_INTERIOR_STYLES[0];
              const formatSpec =
                DEMO_BOOK_FORMATS.find((f) => f.id === ver.editorialConfig.bookFormatId) ||
                DEMO_BOOK_FORMATS[0];
              const styleSpec =
                DEMO_NARRATIVE_STYLES.find((s) => s.id === ver.narrativeStyle) ||
                DEMO_NARRATIVE_STYLES[1];

              return (
                <div
                  key={ver.id}
                  data-testid={`saved-book-version-card-${ver.versionNumber}`}
                  className={`rounded-2xl p-4 border-2 transition-all flex flex-col justify-between gap-4 ${
                    isSelected
                      ? 'border-amber-700 bg-amber-50/40 shadow-xs'
                      : 'border-stone-200 bg-stone-50/50 hover:border-stone-300'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-stone-900 text-white">
                        Versión {ver.versionNumber}
                        {idx === 0 ? ' • Más reciente' : ' • Histórica'}
                      </span>
                      <span className="text-[11px] text-stone-500">
                        {new Date(ver.createdAt).toLocaleString('es-MX', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </span>
                    </div>

                    <h4 className="font-serif font-bold text-stone-900 text-base">
                      {ver.title}
                    </h4>

                    <div className="grid grid-cols-2 gap-1.5 text-[11px] text-stone-600 pt-1">
                      <div>
                        <span className="text-stone-400">Estilo:</span>{' '}
                        {isCouple ? styleSpec.coupleTitle : styleSpec.individualTitle}
                      </div>
                      <div>
                        <span className="text-stone-400">Portada:</span> {coverSpec.name}
                      </div>
                      <div>
                        <span className="text-stone-400">Interior:</span> {interiorSpec.name}
                      </div>
                      <div>
                        <span className="text-stone-400">Formato:</span> {formatSpec.name} (
                        {ver.pageCount} págs.)
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-stone-200/70">
                    <button
                      type="button"
                      onClick={() => handleDownloadBookVersionPdf(ver)}
                      data-testid={`btn-download-pdf-v${ver.versionNumber}`}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Descargar PDF (v{ver.versionNumber})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedVersionId(ver.id);
                        setIsEditingLayout(false);
                        setCurrentPageIdx(0);
                        scrollAndFocusActionArea('viewer');
                      }}
                      className={`px-3 py-2 rounded-xl text-xs font-medium border transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                        isSelected && !isEditingLayout
                          ? 'bg-amber-100 border-amber-300 text-amber-900'
                          : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-100'
                      }`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Visualizar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Warning Modal before Generating & Downloading Final PDF Version */}
      {showSaveConfirmModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          data-testid="modal-confirm-save-final-pdf"
        >
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-stone-200 space-y-5">
            <div className="flex items-center gap-3 text-amber-900">
              <div className="w-11 h-11 rounded-2xl bg-amber-100 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-6 h-6 text-amber-800" />
              </div>
              <div>
                <h3 className="text-lg font-serif font-bold text-stone-900">
                  Confirmación para generar la versión final de tu PDF
                </h3>
                <p className="text-xs text-stone-500">
                  Aviso antes de guardar y descargar tu libro completo
                </p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2.5 text-sm text-stone-800 leading-relaxed">
              <p className="font-semibold text-amber-950">
                Al continuar se generará la versión final completa de tu libro en PDF (Versión{' '}
                {bookVersions.length + 1}) con toda tu historia de vida.
              </p>
              <p
                className="text-xs text-stone-800 font-medium bg-white/80 p-3 rounded-xl border border-amber-200"
                data-testid="save-modal-remaining-modifications-text"
              >
                Después de generar este PDF te quedará(n){' '}
                <strong className="text-amber-900 underline text-sm">
                  {remainingEditsAfterSave} modificación(es) de maquetación
                </strong>{' '}
                disponible(s).
              </p>
              <p className="text-xs text-stone-600" data-testid="save-modal-independent-generation-text">
                La vista previa es solo una muestra del estilo elegido: el libro completo se redacta de nuevo, de forma independiente, a partir de todas tus respuestas, por lo que sus primeras páginas pueden no coincidir exactamente con la muestra. Se integrarán todos tus capítulos, respuestas de profundización, diseño interior («{composedBook.interiorStyle.name}») y formato físico («{composedBook.format.name}»).
              </p>
              <p className="text-xs text-stone-700 font-medium" data-testid="save-modal-ai-review-notice">
                {AI_DOCUMENT_REVIEW_NOTICE}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowSaveConfirmModal(false)}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-stone-300 text-stone-700 text-xs font-semibold hover:bg-stone-100 cursor-pointer"
              >
                Seguir revisando maquetación
              </button>
              <button
                type="button"
                onClick={handleSaveAndGenerateBookVersion}
                data-testid="btn-confirm-generate-final-pdf"
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-amber-800 hover:bg-amber-900 text-white text-xs font-semibold shadow-xs cursor-pointer"
              >
                Sí, generar versión final y descargar PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mandatory Confirmation Modal before using an Additional Layout Modification */}
      {showQuotaConfirmModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          data-testid="modal-confirm-layout-modification"
        >
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-stone-200 space-y-5">
            <div className="flex items-center gap-3 text-amber-900">
              <div className="w-11 h-11 rounded-2xl bg-amber-100 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-6 h-6 text-amber-800" />
              </div>
              <div>
                <h3 className="text-lg font-serif font-bold text-stone-900">
                  Confirmación para modificar la maquetación de tu libro
                </h3>
                <p className="text-xs text-stone-500">
                  Aviso importante sobre tu límite de ediciones editoriales
                </p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2.5 text-sm text-stone-800 leading-relaxed">
              <p className="font-semibold text-amber-950">
                Actualmente te queda(n){' '}
                <span className="underline font-bold">
                  {quotaStatus.remainingEdits} opción(es) adicional(es)
                </span>{' '}
                de modificación para tu libro.
              </p>
              <p className="text-xs text-stone-700">
                Una vez agotadas tus opciones adicionales de modificación,{' '}
                <strong>no tendrás más cambios y/o modificaciones disponibles</strong> para tu libro
                en el portal, y para más modificaciones y/o actualizaciones deberás ponerte en
                contacto directamente con <strong>YouForever</strong>.
              </p>
              <p className="text-xs text-stone-600 pt-1 border-t border-amber-200/70">
                Nota: Tus respuestas de la entrevista permanecen en modo de solo lectura. Al guardar
                tus cambios se generará una nueva versión en PDF en tu Portal del Participante sin
                eliminar tus versiones anteriores.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowQuotaConfirmModal(false)}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-stone-300 text-stone-700 text-xs font-semibold hover:bg-stone-100 cursor-pointer"
              >
                Conservar mi libro actual sin cambios
              </button>
              <button
                type="button"
                onClick={handleConfirmAcceptQuotaAndEdit}
                data-testid="btn-confirm-accept-layout-quota"
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-amber-800 hover:bg-amber-900 text-white text-xs font-semibold shadow-xs cursor-pointer"
              >
                Acepto y deseo modificar la maquetación
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
