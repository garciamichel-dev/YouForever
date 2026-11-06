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
  Italic,
  Bold,
  Layers,
  Loader2,
  Lock,
  MessageCircle,
  Palette,
  RefreshCw,
  RotateCcw,
  RotateCw,
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
} from '../logic/demoStoryRules.ts';
import {
  DemoComposedPageView,
  DemoCoverThumbnailCard,
  DemoInteriorThumbnailCard,
} from './DemoBookPageRenderer.tsx';
import { generateRealDemoBookPdf } from '../utils/demoPdfGenerator.ts';

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

  // If no book version has been saved yet, studio starts open for initial creation (Version 1).
  // Once Version 1 exists, studio starts in view/download mode and requires confirmation modal to unlock modification.
  const [isEditingLayout, setIsEditingLayout] = useState<boolean>(!hasSavedVersions);
  const [showQuotaConfirmModal, setShowQuotaConfirmModal] = useState<boolean>(false);

  useEffect(() => {
    if (!hasSavedVersions) {
      setIsEditingLayout(true);
    }
  }, [hasSavedVersions]);

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

  // Studio Editor State
  const [narrativeStyle, setNarrativeStyle] = useState<DemoNarrativeStyleId>(
    activeSavedVersion?.narrativeStyle || 'first_person_literary'
  );
  const [editorialConfig, setEditorialConfig] = useState<DemoEditorialConfig>(() => {
    if (activeSavedVersion?.editorialConfig) {
      return { ...activeSavedVersion.editorialConfig };
    }
    return {
      narrativeStyle: 'first_person_literary',
      coverDesignId: 'clasica_eterna',
      coverColorVariantIdx: 0,
      coverVisualType: 'illustration',
      coverIllustrationId: 'arbol_raices',
      interiorStyleId: 'clasico_editorial',
      bookFormatId: '6x9',
      customTitle: interview.title,
      customSubtitle: isCouple
        ? 'Libro biográfico de memorias compartidas'
        : 'Libro autobiográfico y legado familiar',
      customAuthors: participantNames.join(' y '),
      dedication: '',
    };
  });

  const [manuscript, setManuscript] = useState<DemoManuscript>(
    () => activeSavedVersion?.manuscript || initialLocalData.manuscript
  );
  const [aiOriginalManuscript, setAiOriginalManuscript] = useState<DemoManuscript>(
    () => activeSavedVersion?.manuscript || initialLocalData.manuscript
  );
  const [coverPhoto, setCoverPhoto] = useState<DemoInMemoryPhoto | null>(
    () => activeSavedVersion?.coverPhoto || null
  );
  const [chapterPhotos, setChapterPhotos] = useState<Record<string, DemoInMemoryPhoto | null>>(
    () => activeSavedVersion?.chapterPhotos || initialLocalData.chapterPhotos
  );

  // Undo/Redo history for manual text editing
  const [manuscriptHistory, setManuscriptHistory] = useState<DemoManuscript[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const activeTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [activeTextareaCoords, setActiveTextareaCoords] = useState<{
    chapterIdx: number;
    paraIdx: number;
  } | null>(null);

  const [studioTab, setStudioTab] = useState<
    'estilo' | 'portada' | 'interior' | 'formato' | 'texto'
  >('portada');
  const [previewMode, setPreviewMode] = useState<'flipbook' | 'pdf_reader'>('flipbook');
  const [currentPageIdx, setCurrentPageIdx] = useState<number>(0);

  const [isGeneratingAI, setIsGeneratingAI] = useState<boolean>(false);
  const [isSavingBook, setIsSavingBook] = useState<boolean>(false);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [studioSuccessMsg, setStudioSuccessMsg] = useState<string | null>(null);

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

  // Compose live book document (either for active editor or selected saved version)
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
      customClosingPageText: targetClosingText,
      maxContentPages: 45,
    });
  }, [
    isEditingLayout,
    manuscript,
    editorialConfig,
    coverPhoto,
    chapterPhotos,
    closingDedicationText,
    activeSavedVersion,
  ]);

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

  // Trigger AI redaction when switching narrative style
  const handleSelectNarrativeStyle = async (styleId: DemoNarrativeStyleId) => {
    setNarrativeStyle(styleId);
    setEditorialConfig((prev) => ({ ...prev, narrativeStyle: styleId }));
    setIsGeneratingAI(true);
    setStudioError(null);

    try {
      const res = await fetch('/api/participant/book/generate-manuscript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          narrativeStyle: styleId,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.data?.manuscript) {
        const aiManu = data.data.manuscript as DemoManuscript;
        setManuscript(aiManu);
        setAiOriginalManuscript(JSON.parse(JSON.stringify(aiManu)));
        setManuscriptHistory([aiManu]);
        setHistoryIdx(0);
        if (data.data.chapterPhotos) {
          setChapterPhotos(data.data.chapterPhotos);
        }
      } else {
        // Fallback local builder in chosen style
        const fallback = buildParticipantInitialManuscriptFromAnswers({
          interviewTitle: editorialConfig.customTitle || interview.title,
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
          narrativeStyle: styleId,
          closingDedicationText,
        });
        setManuscript(fallback.manuscript);
        setAiOriginalManuscript(JSON.parse(JSON.stringify(fallback.manuscript)));
      }
    } catch (_err) {
      const fallback = buildParticipantInitialManuscriptFromAnswers({
        interviewTitle: editorialConfig.customTitle || interview.title,
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
        narrativeStyle: styleId,
        closingDedicationText,
      });
      setManuscript(fallback.manuscript);
      setAiOriginalManuscript(JSON.parse(JSON.stringify(fallback.manuscript)));
    } finally {
      setIsGeneratingAI(false);
    }
  };

  // Convert an image URL or File into a base64 dataUrl so jsPDF can embed it reliably
  const ensureDataUrlForPdf = async (photo: DemoInMemoryPhoto | null | undefined): Promise<DemoInMemoryPhoto | null> => {
    if (!photo) return null;
    if (photo.dataUrl && photo.dataUrl.startsWith('data:image/')) {
      return photo;
    }
    try {
      const resp = await fetch(photo.objectUrl || photo.dataUrl);
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
        const newPhoto: DemoInMemoryPhoto = {
          id: `cov_photo_${Date.now()}`,
          fileName: file.name,
          objectUrl: dataUrl,
          dataUrl,
          mimeType: file.type || 'image/jpeg',
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

  // Download any saved version (or current composed book) as a real vector PDF
  const handleDownloadBookVersionPdf = async (version: ParticipantBookVersionRecord) => {
    try {
      const resolvedCover = await ensureDataUrlForPdf(version.coverPhoto);
      const resolvedChapterPhotos: Record<string, DemoInMemoryPhoto | null> = {};
      for (const [k, v] of Object.entries(version.chapterPhotos || {})) {
        resolvedChapterPhotos[k] = await ensureDataUrlForPdf(v);
      }

      const composedForVersion = composeBookPages({
        manuscript: version.manuscript,
        editorialConfig: version.editorialConfig,
        coverPhoto: resolvedCover,
        chapterPhotos: resolvedChapterPhotos,
        customClosingPageText: version.closingPageText ?? closingDedicationText,
        maxContentPages: 45,
      });

      const pdfResult = generateRealDemoBookPdf({
        composed: composedForVersion,
        profile: {
          mode: isCouple ? 'pareja' : 'individual',
          displayName: participant.name,
          fullName: participant.name,
          partner1Name: participantNames[0] || participant.name,
          partner2Name: participantNames[1] || 'Pareja',
          customTitle: version.title,
          hasAcceptedTemporaryNotice: true,
        },
      });

      const a = document.createElement('a');
      a.href = pdfResult.blobUrl;
      a.download = version.fileName || pdfResult.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(pdfResult.blobUrl), 10000);
    } catch (err: any) {
      setStudioError(err?.message || 'Error al generar la descarga del PDF.');
    }
  };

  // Save new book version to database and download PDF
  const handleSaveAndGenerateBookVersion = async () => {
    setIsSavingBook(true);
    setStudioError(null);
    setStudioSuccessMsg(null);

    try {
      const resolvedCover = await ensureDataUrlForPdf(coverPhoto);
      const resolvedChapters: Record<string, DemoInMemoryPhoto | null> = {};
      for (const [k, v] of Object.entries(chapterPhotos)) {
        resolvedChapters[k] = await ensureDataUrlForPdf(v);
      }

      const res = await fetch('/api/participant/book/save-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          narrativeStyle,
          editorialConfig,
          manuscript,
          coverPhoto: resolvedCover,
          chapterPhotos: resolvedChapters,
          pageCount: composedBook.pages.length,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'No se pudo guardar la versión del libro.');
      }

      const savedVersion = data.data.bookVersion as ParticipantBookVersionRecord;
      const updatedInterview = data.data.interview as InterviewRecord;
      const allVersions = data.data.allVersions as ParticipantBookVersionRecord[];

      // Sync to browser localStorage cache so Admin Panel & future sessions preserve book versions across container restarts
      try {
        const rawBvCache = localStorage.getItem('foreveryou_book_versions_cache');
        const existingBvList: ParticipantBookVersionRecord[] = rawBvCache ? JSON.parse(rawBvCache) : [];
        const mergedBvMap = new Map<string, ParticipantBookVersionRecord>();
        if (Array.isArray(existingBvList)) {
          for (const bv of existingBvList) {
            if (bv && bv.id) mergedBvMap.set(bv.id, bv);
          }
        }
        for (const bv of allVersions) {
          if (bv && bv.id) mergedBvMap.set(bv.id, bv);
        }
        localStorage.setItem(
          'foreveryou_book_versions_cache',
          JSON.stringify(Array.from(mergedBvMap.values()))
        );

        const rawIntCache = localStorage.getItem('foreveryou_interviews_cache');
        if (rawIntCache) {
          const parsedIntList = JSON.parse(rawIntCache);
          if (Array.isArray(parsedIntList)) {
            const nextIntList = parsedIntList.map((item: any) =>
              item && item.id === updatedInterview.id
                ? {
                    ...item,
                    ...updatedInterview,
                    bookVersions: allVersions,
                    bookVersionsCount: allVersions.length,
                    latestBookVersion: allVersions[0]?.versionNumber || 0,
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
      setStudioSuccessMsg(
        `¡Tu libro en PDF (Versión ${savedVersion.versionNumber}) ha sido generado y guardado en tu Portal del Participante!`
      );

      // Automatically trigger PDF download for the newly saved version
      await handleDownloadBookVersionPdf(savedVersion);
    } catch (err: any) {
      setStudioError(err?.message || 'Error al guardar la versión del libro.');
    } finally {
      setIsSavingBook(false);
    }
  };

  // Handle click on "Modificar maquetación"
  const handleRequestModifyLayout = () => {
    setStudioError(null);
    setStudioSuccessMsg(null);
    setShowQuotaConfirmModal(true);
  };

  // Confirm modification inside modal -> unlock editor populated with latest version
  const handleConfirmAcceptQuotaAndEdit = () => {
    if (activeSavedVersion) {
      setNarrativeStyle(activeSavedVersion.narrativeStyle);
      setEditorialConfig({ ...activeSavedVersion.editorialConfig });
      setManuscript(JSON.parse(JSON.stringify(activeSavedVersion.manuscript)));
      setAiOriginalManuscript(JSON.parse(JSON.stringify(activeSavedVersion.manuscript)));
      setCoverPhoto(activeSavedVersion.coverPhoto || null);
      setChapterPhotos(activeSavedVersion.chapterPhotos || initialLocalData.chapterPhotos);
      setManuscriptHistory([JSON.parse(JSON.stringify(activeSavedVersion.manuscript))]);
      setHistoryIdx(0);
    }
    setShowQuotaConfirmModal(false);
    setIsEditingLayout(true);
  };

  return (
    <div className="space-y-8" data-testid="participant-book-studio">
      {/* Top Status & Read-Only Answers Notice Banner */}
      <div className="bg-gradient-to-r from-stone-900 via-stone-800 to-amber-950 text-white rounded-3xl p-6 sm:p-8 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-400/30 text-amber-200 text-xs font-semibold tracking-wide uppercase">
              <Sparkles className="w-3.5 h-3.5" />
              Estudio Editorial ForeverYou • Entrevista Concluida
            </div>
            <h2 className="text-2xl sm:text-3xl font-serif font-bold">
              {hasSavedVersions
                ? 'Tu Libro Autobiográfico en PDF'
                : 'Configura la Maquetación de tu Libro'}
            </h2>
            <p className="text-stone-300 text-sm max-w-2xl leading-relaxed">
              {hasSavedVersions
                ? 'Tu libro generado se encuentra guardado de forma permanente en tu Portal del Participante para que puedas consultarlo y descargarlo en PDF cuando lo desees.'
                : 'Has confirmado el cierre de tu historia. Elige entre los 3 estilos narrativos, 5 diseños de portada, 5 estilos de diseño interior y 3 formatos físicos reales para generar tu libro en PDF.'}
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
          </div>
        </div>
      </div>

      {studioError && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-2xl p-4 text-sm flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>{studioError}</div>
        </div>
      )}

      {studioSuccessMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-2xl p-4 text-sm flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>{studioSuccessMsg}</div>
        </div>
      )}

      {/* Saved PDF Versions & Download Section (Always visible once at least 1 version exists) */}
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
                Todas las versiones generadas de tu libro se conservan íntegras y disponibles para descarga bajo demanda.
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
                      <strong className="font-bold">ForeverYou</strong>.
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

      {/* Main Studio Area: Left Configuration Controls (when editing) + Right Interactive Book Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {isEditingLayout && (
          <div className="lg:col-span-7 bg-white rounded-3xl border border-stone-200/80 shadow-xs overflow-hidden">
            {/* Studio Navigation Tabs */}
            <div className="border-b border-stone-200 bg-stone-50/70 p-2 flex flex-wrap gap-1.5">
              {[
                { id: 'estilo', label: '1. Estilo Narrativo (3)', icon: Sparkles },
                { id: 'portada', label: '2. Portada (5)', icon: Palette },
                { id: 'interior', label: '3. Diseño Interior (5)', icon: Layers },
                { id: 'formato', label: '4. Formato Físico (3)', icon: BookOpen },
                { id: 'texto', label: '5. Editar Párrafos', icon: TypeIcon },
              ].map((t) => {
                const Icon = t.icon;
                const active = studioTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setStudioTab(t.id as any)}
                    className={`flex-1 min-w-[130px] inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                      active
                        ? 'bg-stone-900 text-white shadow-xs'
                        : 'text-stone-600 hover:bg-stone-200/60'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {t.label}
                  </button>
                );
              })}
            </div>

            <div className="p-6 space-y-6">
              {/* TAB 1: 3 NARRATIVE STYLES */}
              {studioTab === 'estilo' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-serif font-bold text-stone-900">
                        Elige el Estilo Narrativo de tu Obra
                      </h3>
                      <p className="text-xs text-stone-500">
                        Adapta el tono literario con el que se redactan tus respuestas reales.
                      </p>
                    </div>
                    {isGeneratingAI && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-amber-800 font-medium">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Adaptando estilo con IA...
                      </span>
                    )}
                  </div>

                  <div className="space-y-3">
                    {DEMO_NARRATIVE_STYLES.map((st) => {
                      const selected = narrativeStyle === st.id;
                      return (
                        <button
                          key={st.id}
                          type="button"
                          disabled={isGeneratingAI}
                          onClick={() => handleSelectNarrativeStyle(st.id)}
                          className={`w-full text-left rounded-2xl p-4 border-2 transition-all cursor-pointer ${
                            selected
                              ? 'border-amber-700 bg-amber-50/50 shadow-xs'
                              : 'border-stone-200 bg-white hover:border-stone-300'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-serif font-bold text-stone-900 text-sm">
                              {isCouple ? st.coupleTitle : st.individualTitle}
                            </span>
                            <div className="flex items-center gap-2">
                              {st.recommended && (
                                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold">
                                  Recomendado por defecto
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
                </div>
              )}

              {/* TAB 2: 5 COVER DESIGNS + COLOR VARIANTS + OPTIONAL VISUAL ELEMENT */}
              {studioTab === 'portada' && (
                <div className="space-y-6">
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
                          onSelect={() =>
                            setEditorialConfig((prev) => ({
                              ...prev,
                              coverDesignId: design.id as DemoCoverDesignId,
                              coverColorVariantIdx: 0,
                            }))
                          }
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
                                onClick={() =>
                                  setEditorialConfig((prev) => ({
                                    ...prev,
                                    coverColorVariantIdx: vIdx,
                                  }))
                                }
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
                          onClick={() =>
                            setEditorialConfig((prev) => ({
                              ...prev,
                              coverVisualType: opt.id as any,
                            }))
                          }
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
                            onClick={() =>
                              setEditorialConfig((prev) => ({
                                ...prev,
                                coverIllustrationId: ill.id as DemoThematicIllustrationId,
                              }))
                            }
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
                                  onClick={() => setCoverPhoto(ph)}
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
                <div className="space-y-4">
                  <div>
                    <h3 className="text-base font-serif font-bold text-stone-900">
                      5 Estilos de Diseño Interior
                    </h3>
                    <p className="text-xs text-stone-500">
                      Define la tipografía de lectura, capitulares, ornamentos y tono de papel.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {DEMO_INTERIOR_STYLES.map((styleSpec) => (
                      <DemoInteriorThumbnailCard
                        key={styleSpec.id}
                        styleSpec={styleSpec}
                        selected={editorialConfig.interiorStyleId === styleSpec.id}
                        onSelect={() =>
                          setEditorialConfig((prev) => ({
                            ...prev,
                            interiorStyleId: styleSpec.id as DemoInteriorStyleId,
                          }))
                        }
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 4: 3 PHYSICAL FORMATS */}
              {studioTab === 'formato' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-base font-serif font-bold text-stone-900">
                      3 Formatos Físicos Reales de Impresión
                    </h3>
                    <p className="text-xs text-stone-500">
                      El motor de paginación ajusta automáticamente márgenes, caja tipográfica y número de páginas en el PDF.
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

              {/* TAB 5: MANUAL PARAGRAPH & METADATA EDITING */}
              {studioTab === 'texto' && (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-base font-serif font-bold text-stone-900">
                        Edición Manual de Título y Párrafos del Libro
                      </h3>
                      <p className="text-xs text-stone-500">
                        Afina cualquier frase o párrafo de tu libro antes de generar tu versión en PDF.
                      </p>
                    </div>

                    {/* Formatting & Undo/Redo Toolbar */}
                    <div className="flex items-center gap-1.5 bg-stone-100 p-1.5 rounded-xl border border-stone-200">
                      <button
                        type="button"
                        onClick={() => applyInlineFormatToActiveParagraph('**')}
                        title="Negrita"
                        className="p-1.5 rounded-lg hover:bg-white text-stone-700 cursor-pointer"
                      >
                        <Bold className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => applyInlineFormatToActiveParagraph('*')}
                        title="Cursiva"
                        className="p-1.5 rounded-lg hover:bg-white text-stone-700 cursor-pointer"
                      >
                        <Italic className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={handleUndo}
                        disabled={historyIdx <= 0}
                        title="Deshacer"
                        className="p-1.5 rounded-lg hover:bg-white text-stone-700 disabled:opacity-40 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={handleRedo}
                        disabled={historyIdx >= manuscriptHistory.length - 1}
                        title="Rehacer"
                        className="p-1.5 rounded-lg hover:bg-white text-stone-700 disabled:opacity-40 cursor-pointer"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={handleRestoreAiManuscript}
                        title="Restaurar versión IA"
                        className="px-2 py-1 rounded-lg hover:bg-white text-[11px] font-medium text-amber-900 cursor-pointer"
                      >
                        Restaurar original
                      </button>
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

                  {/* Closing Page Dedication Notice */}
                  <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-3.5 text-xs text-amber-950">
                    <span className="font-bold">Página final de cierre del PDF:</span> Se dará preferencia a tu dedicatoria o motivo de cierre registrado al concluir tu entrevista (
                    <em>
                      «
                      {closingDedicationText ||
                        'Esta historia continuará...'}
                      »
                    </em>
                    ) acompañada del sello <strong>&lt;&lt; ForeverYou &gt;&gt;</strong>.
                  </div>

                  {/* Chapters & Paragraphs Editor */}
                  <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
                    {manuscript.chapters.map((ch, cIdx) => (
                      <div
                        key={ch.id}
                        className="p-4 rounded-2xl border border-stone-200 bg-white space-y-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
                            Capítulo {ch.partNumber}
                          </span>
                          {chapterPhotos[ch.id] && (
                            <span className="text-[11px] text-emerald-700 font-medium inline-flex items-center gap-1">
                              <ImageIcon className="w-3 h-3" />
                              Incluye fotografía de tus respuestas
                            </span>
                          )}
                        </div>
                        <input
                          type="text"
                          value={ch.title}
                          onChange={(e) => {
                            const nextChapters = manuscript.chapters.map((item, idx) =>
                              idx === cIdx ? { ...item, title: e.target.value } : item
                            );
                            pushManuscriptEdit({ ...manuscript, chapters: nextChapters });
                          }}
                          className="w-full px-3 py-1.5 rounded-xl border border-stone-200 font-serif font-bold text-sm text-stone-900"
                        />

                        {ch.paragraphs.map((para, pIdx) => (
                          <textarea
                            key={`${ch.id}_p_${pIdx}`}
                            rows={3}
                            value={para}
                            onFocus={(e) => {
                              activeTextareaRef.current = e.currentTarget;
                              setActiveTextareaCoords({ chapterIdx: cIdx, paraIdx: pIdx });
                            }}
                            onChange={(e) => {
                              const nextChapters = manuscript.chapters.map((item, idx) => {
                                if (idx !== cIdx) return item;
                                const nextParas = [...item.paragraphs];
                                nextParas[pIdx] = e.target.value;
                                return { ...item, paragraphs: nextParas };
                              });
                              pushManuscriptEdit({ ...manuscript, chapters: nextChapters });
                            }}
                            className="w-full p-3 rounded-xl border border-stone-200 text-xs text-stone-800 leading-relaxed focus:border-amber-700 focus:outline-none"
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Primary Save & Generate PDF Version Button */}
              <div className="pt-4 border-t border-stone-200 flex flex-wrap items-center justify-between gap-4">
                <div className="text-xs text-stone-500">
                  {hasSavedVersions
                    ? `Se guardará como Versión ${bookVersions.length + 1} (consumirá 1 cambio de maquetación).`
                    : 'Se guardará como Versión 1 de tu libro en PDF y tendrás 1 cambio adicional disponible.'}
                </div>

                <div className="flex items-center gap-3">
                  {hasSavedVersions && (
                    <button
                      type="button"
                      onClick={() => setIsEditingLayout(false)}
                      className="px-4 py-2.5 rounded-xl border border-stone-300 text-stone-700 text-xs font-medium hover:bg-stone-100 cursor-pointer"
                    >
                      Cancelar edición
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={isSavingBook || isGeneratingAI}
                    onClick={handleSaveAndGenerateBookVersion}
                    data-testid="btn-save-participant-book-version"
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-amber-800 hover:bg-amber-900 disabled:opacity-50 text-white text-sm font-semibold shadow-sm transition-all cursor-pointer"
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
          className={`${
            isEditingLayout ? 'lg:col-span-5' : 'lg:col-span-12'
          } bg-stone-900 rounded-3xl p-5 sm:p-7 text-white space-y-5 shadow-xl`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div>
              <span className="text-[11px] uppercase tracking-widest text-amber-300 font-semibold block">
                {isEditingLayout
                  ? 'Vista Previa Editorial en Tiempo Real'
                  : `Visualizando Versión ${activeSavedVersion?.versionNumber || 1}`}
              </span>
              <h4 className="text-base font-serif font-bold">
                {composedBook.format.name} ({composedBook.format.dimensionsLabel}) •{' '}
                {composedBook.pages.length} páginas
              </h4>
            </div>

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

          {previewMode === 'flipbook' ? (
            <div className="space-y-4">
              <div className="max-w-sm mx-auto">
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
                <div key={pg.pageNumber} className="max-w-sm mx-auto space-y-1.5">
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
                contacto directamente con <strong>ForeverYou</strong>.
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
