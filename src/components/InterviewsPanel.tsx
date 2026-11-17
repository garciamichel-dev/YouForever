import React, { useState, useEffect } from 'react';
import {
  Users,
  Plus,
  Calendar,
  Clock,
  Sparkles,
  BookOpen,
  Copy,
  Check,
  AlertCircle,
  CheckCircle2,
  Lock,
  Unlock,
  RotateCcw,
  ShieldAlert,
  ChevronRight,
  ExternalLink,
  HelpCircle,
  FileText,
  Share2,
  MessageCircle,
  Key,
  X,
  Search,
  Archive,
  Trash2,
  AlertTriangle,
  Download,
  Settings,
  CopyPlus,
  Save,
  Minus,
  RefreshCw,
  ClipboardList,
} from 'lucide-react';
import {
  InterviewRecord,
  ParticipantRecord,
  SufficiencyStatus,
  computeLayoutEditQuotaStatus,
  sortInterviewsWithCopies,
  buildDefaultAdminCopyNote,
} from '../logic/interviewRules.ts';
import {
  ParticipantBookVersionRecord,
  composeBookPages,
  DEMO_COVER_DESIGNS,
  DEMO_INTERIOR_STYLES,
  DEMO_BOOK_FORMATS,
  DEMO_NARRATIVE_STYLES,
} from '../logic/demoStoryRules.ts';
import { generateRealDemoBookPdf, preloadBookResourcesForPdf } from '../utils/demoPdfGenerator.ts';
import { apiFetch } from '../utils/apiClient.ts';


interface EnrichedInterview extends InterviewRecord {
  participants: Array<ParticipantRecord & { plainToken?: string; accessCode?: string; inviteUrl?: string }>;
  answersCount: number;
  manuscriptsCount?: number;
  latestManuscriptVersion?: number;
  bookVersions?: ParticipantBookVersionRecord[];
  bookVersionsCount?: number;
}

interface InterviewsPanelProps {
  adminEmail: string | null;
  refreshTrigger?: number;
  onOpenManuscript: (interviewId: string) => void;
  onEnterParticipantPortal: (plainToken: string) => void;
}

export const InterviewsPanel: React.FC<InterviewsPanelProps> = ({
  adminEmail,
  refreshTrigger,
  onOpenManuscript,
  onEnterParticipantPortal,
}) => {
  const [interviews, setInterviews] = useState<EnrichedInterview[]>(() => {
    try {
      const cached = localStorage.getItem('foreveryou_interviews_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [];
  });
  const [loading, setLoading] = useState<boolean>(() => {
    try {
      const cached = localStorage.getItem('foreveryou_interviews_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return false;
      }
    } catch {}
    return true;
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('todos');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [copiedAccessBadge, setCopiedAccessBadge] = useState<string | null>(null);
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // App info for shared URL
  const [appInfo, setAppInfo] = useState<{ appUrl: string; sharedUrl: string; isDevUrl: boolean } | null>(null);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showExtendModal, setShowExtendModal] = useState<EnrichedInterview | null>(null);
  const [showReopenModal, setShowReopenModal] = useState<EnrichedInterview | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EnrichedInterview | null>(null);
  const [resetTarget, setResetTarget] = useState<EnrichedInterview | null>(null);
  const [isProcessingAction, setIsProcessingAction] = useState(false);
  const [sharingData, setSharingData] = useState<{
    interview: EnrichedInterview;
    participant: ParticipantRecord & { plainToken?: string; accessCode?: string };
  } | null>(null);
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);
  const [compilingId, setCompilingId] = useState<string | null>(null);
  const [downloadingZipId, setDownloadingZipId] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  // New Interview Form
  const [newTitle, setNewTitle] = useState('');
  const [newMode, setNewMode] = useState<'individual' | 'compartida'>('individual');
  const [newType, setNewType] = useState('biografia_personal');
  const [newOpenDays, setNewOpenDays] = useState<number>(15);
  const [newThreshold, setNewThreshold] = useState<number>(100);
  const [participantsList, setParticipantsList] = useState<
    Array<{ name: string; relationship: string; role: 'primary' | 'contributor'; email?: string }>
  >([{ name: '', relationship: 'Titular', role: 'primary', email: '' }]);

  // Extension & Reopen & Layout Quota forms
  const [extendDays, setExtendDays] = useState<number>(7);
  const [reopenDays, setReopenDays] = useState<number>(14);
  const [reopenReason, setReopenReason] = useState<string>('El participante solicitó ampliar sus testimonios y opciones de edición de libro');
  const [reopenLayoutEdits, setReopenLayoutEdits] = useState<number>(1);
  const [bookStudioAdminTarget, setBookStudioAdminTarget] = useState<EnrichedInterview | null>(null);
  const [quotaRemainingInput, setQuotaRemainingInput] = useState<number>(1);
  const [savingQuota, setSavingQuota] = useState<boolean>(false);
  const [downloadingPdfVersionId, setDownloadingPdfVersionId] = useState<string | null>(null);
  const [seedingStories, setSeedingStories] = useState<boolean>(false);
  const [versionToDelete, setVersionToDelete] = useState<{
    version: ParticipantBookVersionRecord;
    interview: EnrichedInterview;
  } | null>(null);
  const [restoreQuotaOnDelete, setRestoreQuotaOnDelete] = useState<boolean>(false);
  const [deletingVersion, setDeletingVersion] = useState<boolean>(false);
  // V5.4.1: bulk delete (all PDF versions or all manuscripts of an interviewee), with confirmation.
  const [bulkDeleteTarget, setBulkDeleteTarget] = useState<{
    kind: 'versions' | 'manuscripts';
    interview: EnrichedInterview;
    count: number;
  } | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState<boolean>(false);

  // Duplication, admin-only copy note, and inline quota states
  const [duplicateTarget, setDuplicateTarget] = useState<EnrichedInterview | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [copyNoteDrafts, setCopyNoteDrafts] = useState<Record<string, string>>({});
  const [savingCopyNoteId, setSavingCopyNoteId] = useState<string | null>(null);
  const [savedCopyNoteId, setSavedCopyNoteId] = useState<string | null>(null);
  const [inlineQuotaDrafts, setInlineQuotaDrafts] = useState<Record<string, number>>({});
  const [savingInlineQuotaId, setSavingInlineQuotaId] = useState<string | null>(null);
  const [savedInlineQuotaId, setSavedInlineQuotaId] = useState<string | null>(null);
  const [syncingFirestore, setSyncingFirestore] = useState<boolean>(false);
  const [lastUpdatedLabel, setLastUpdatedLabel] = useState<string | null>(null);
  const lastFetchTimestampRef = React.useRef<number>(0);
  const [firestoreSyncStatus, setFirestoreSyncStatus] = useState<{
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    quotaExhausted: boolean;
    source: 'firestore' | 'disk_cache';
    syncedRemoteInterviewsCount: number;
    localInterviewsCount: number;
  } | null>(null);

  // "Datos de registro" modal state (per interviewee inspection & edit)
  const [registrationModalTarget, setRegistrationModalTarget] = useState<{
    interview: EnrichedInterview;
    focusedParticipantId: string;
  } | null>(null);
  const [regTitleDraft, setRegTitleDraft] = useState<string>('');
  const [regParticipantDrafts, setRegParticipantDrafts] = useState<
    Array<{
      participantId: string;
      name: string;
      email: string;
      age: string;
      city: string;
      relationship: string;
      role: 'primary' | 'contributor';
      accessCode?: string;
      privacyAcceptedAt?: string;
      privacyVersion?: string;
    }>
  >([]);
  const [regModalError, setRegModalError] = useState<string | null>(null);
  const [savingRegistration, setSavingRegistration] = useState<boolean>(false);

  const fetchInterviews = async () => {
    try {
      // If we don't have any cached interviews, show loading spinner
      if (interviews.length === 0) {
        setLoading(true);
      }
      const [resInterviews, resAppInfo, resSyncStatus] = await Promise.all([
        apiFetch<EnrichedInterview[]>('/api/interviews', {
          headers: {
            'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
          },
          retries: 2,
        }),
        apiFetch<{ appUrl: string; sharedUrl: string; isDevUrl: boolean }>('/api/app-info', {
          retries: 1,
        }),
        apiFetch<{
          lastAttemptAt: string | null;
          lastSuccessAt: string | null;
          lastError: string | null;
          quotaExhausted: boolean;
          source: 'firestore' | 'disk_cache';
          syncedRemoteInterviewsCount: number;
          localInterviewsCount: number;
        }>('/api/interviews/sync-status', {
          headers: {
            'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
          },
          retries: 1,
        }),
      ]);

      if (resSyncStatus.ok && resSyncStatus.data) {
        setFirestoreSyncStatus(resSyncStatus.data);
      }

      if (resInterviews.ok && resInterviews.data) {
        let finalList = resInterviews.data;
        try {
          const cachedRaw = localStorage.getItem('foreveryou_interviews_cache');
          const cachedBvRaw = localStorage.getItem('foreveryou_book_versions_cache');
          const deletedBvRaw = localStorage.getItem('foreveryou_deleted_book_version_ids');
          const cachedList: EnrichedInterview[] = cachedRaw ? JSON.parse(cachedRaw) : [];
          const cachedBvList: ParticipantBookVersionRecord[] = cachedBvRaw ? JSON.parse(cachedBvRaw) : [];
          const deletedBvSet = new Set<string>(deletedBvRaw ? JSON.parse(deletedBvRaw) : []);

          const serverMap = new Map(finalList.map((i) => [i.id, i]));
          const serverBvIds = new Set(
            finalList.flatMap((i) => (i.bookVersions || []).map((bv) => bv.id))
          );

          const interviewsToSync = Array.isArray(cachedList)
            ? cachedList
                .map((c): EnrichedInterview | null => {
                  if (!c || !c.id) return null;
                  const cleanVers = Array.isArray(c.bookVersions)
                    ? c.bookVersions.filter(
                        (bv) =>
                          bv &&
                          bv.id &&
                          !deletedBvSet.has(bv.id) &&
                          !deletedBvSet.has(`pbv_${c.id}_v${bv.versionNumber}`)
                      )
                    : [];
                  return {
                    ...c,
                    bookVersions: cleanVers,
                    bookVersionsCount: cleanVers.length,
                  };
                })
                .filter((c): c is EnrichedInterview => {
                  if (!c || !c.id) return false;
                  const s = serverMap.get(c.id);
                  if (!s) return true;
                  if (c.userDeclaredComplete && !s.userDeclaredComplete) {
                    const serverReopenedTime = s.reopenedAt ? new Date(s.reopenedAt).getTime() : 0;
                    const cachedClosedTime = c.closedAt ? new Date(c.closedAt).getTime() : 0;
                    if (s.status === 'open' && (serverReopenedTime >= cachedClosedTime || !s.closedAt)) {
                      return false;
                    }
                    return true;
                  }
                  const hasDeletedForInterview = Array.from(deletedBvSet).some((id) =>
                    id.includes(c.id)
                  );
                  if (!hasDeletedForInterview) {
                    if ((c.bookVersions?.length ?? 0) > (s.bookVersions?.length ?? 0)) return true;
                  }
                  return false;
                })
            : [];

          const bookVersionsToSync = Array.isArray(cachedBvList)
            ? cachedBvList.filter(
                (bv) =>
                  bv &&
                  bv.id &&
                  !serverBvIds.has(bv.id) &&
                  !deletedBvSet.has(bv.id) &&
                  !deletedBvSet.has(`pbv_${bv.interviewId}_v${bv.versionNumber}`)
              )
            : [];

          if (interviewsToSync.length > 0 || bookVersionsToSync.length > 0) {
            const syncRes = await apiFetch<EnrichedInterview[]>('/api/interviews/restore-cache', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
              },
              body: JSON.stringify({
                interviews: interviewsToSync,
                bookVersions: bookVersionsToSync,
              }),
            });
            if (syncRes.ok && syncRes.data) {
              finalList = syncRes.data;
            }
          }
        } catch {
          // Ignore localStorage error
        }
        const orderedFinalList = sortInterviewsWithCopies(finalList);
        try {
          const sanitizedForCache = orderedFinalList.map((inv) => ({
            ...inv,
            bookVersions: (inv.bookVersions || []).map((bv) => ({
              id: bv.id,
              versionNumber: bv.versionNumber,
              interviewId: bv.interviewId,
              participantId: bv.participantId,
              participantName: bv.participantName,
              title: bv.title,
              subtitle: bv.subtitle,
              authors: bv.authors,
              dedication: bv.dedication,
              closingPageText: bv.closingPageText,
              narrativeStyle: bv.narrativeStyle,
              editorialConfig: bv.editorialConfig,
              manuscript: {
                title: bv.manuscript?.title || '',
                subtitle: bv.manuscript?.subtitle || '',
                chapters: (bv.manuscript?.chapters || []).map((ch) => ({
                  id: ch.id,
                  partNumber: ch.partNumber,
                  dimensionKey: ch.dimensionKey,
                  title: ch.title,
                  paragraphs: [],
                })),
              },
              pageCount: bv.pageCount,
              createdAt: bv.createdAt,
              fileName: bv.fileName,
            })),
          }));
          localStorage.setItem('foreveryou_interviews_cache', JSON.stringify(sanitizedForCache));
        } catch {
          // Ignore localStorage quota
        }
        setInterviews(orderedFinalList);
        lastFetchTimestampRef.current = Date.now();
        setLastUpdatedLabel(
          new Date().toLocaleTimeString('es-MX', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
        );
      } else if (resInterviews.error) {
        console.warn('Notice loading interviews:', resInterviews.error);
      }

      if (resAppInfo.ok && resAppInfo.data) {
        setAppInfo(resAppInfo.data);
      }
    } catch (err) {
      console.error('Error fetching interviews:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchInterviews();
  }, [refreshTrigger]);

  // Automatic low-read incremental refresh across www.youforever.app and active devices
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchInterviews();
      }
    }, 30_000);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetchTimestampRef.current > 15_000) {
        void fetchInterviews();
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [adminEmail]);

  const getPublicShareUrl = (token: string) => {
    return `https://youforever.app/interview?token=${token}`;
  };

  const copyToClipboard = (text: string) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
        } catch (_e) {
          // ignore
        }
        document.body.removeChild(ta);
      });
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch (_e) {
        // ignore
      }
      document.body.removeChild(ta);
    }
  };

  const handleCopyLink = (token: string) => {
    const fullUrl = getPublicShareUrl(token);
    copyToClipboard(fullUrl);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 3000);
  };

  const handleCreateInterview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    try {
      const res = await fetch('/api/interviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
        body: JSON.stringify({
          title: newTitle.trim(),
          storyMode: newMode,
          storyType: newType,
          customOpenDays: newOpenDays,
          customSufficiencyThreshold: newThreshold,
          participants: participantsList.filter((p) => p.name.trim().length > 0),
        }),
      });

      const data = await res.json();
      if (data.success) {
        setShowCreateModal(false);
        setNewTitle('');
        setParticipantsList([{ name: '', relationship: 'Titular', role: 'primary', email: '' }]);
        fetchInterviews();
        setNoticeMessage('¡Entrevista creada exitosamente con enlaces de invitación seguros!');
        setTimeout(() => setNoticeMessage(null), 4000);
      } else {
        alert(data.error || 'Error al crear la entrevista.');
      }
    } catch (err: unknown) {
      alert('Error de conexión al crear la entrevista.');
    }
  };

  const handleExtend = async () => {
    if (!showExtendModal || extendDays <= 0) return;
    try {
      const res = await fetch(`/api/interviews/${showExtendModal.id}/extend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
        body: JSON.stringify({ additionalDays: extendDays }),
      });
      const data = await res.json();
      if (data.success) {
        setShowExtendModal(null);
        fetchInterviews();
        setNoticeMessage(`Plazo extendido por ${extendDays} días naturales.`);
        setTimeout(() => setNoticeMessage(null), 4000);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleReopen = async () => {
    if (!showReopenModal || reopenDays <= 0) return;
    try {
      const res = await fetch(`/api/interviews/${showReopenModal.id}/reopen`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
        body: JSON.stringify({
          newDays: reopenDays,
          reason: reopenReason,
          additionalLayoutEdits: reopenLayoutEdits,
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.data) {
          try {
            const raw = localStorage.getItem('foreveryou_interviews_cache');
            if (raw) {
              const list = JSON.parse(raw);
              if (Array.isArray(list)) {
                const nextList = list.map((item: any) =>
                  item && item.id === data.data.id ? { ...item, ...data.data } : item
                );
                localStorage.setItem('foreveryou_interviews_cache', JSON.stringify(nextList));
              }
            }
          } catch (_e) {}
        }
        setShowReopenModal(null);
        fetchInterviews();
        setNoticeMessage(
          `Entrevista y cuestionario reabiertos por ${reopenDays} días naturales con ${reopenLayoutEdits} opción(es) de edición de maquetación.`
        );
        setTimeout(() => setNoticeMessage(null), 4000);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveLayoutQuota = async () => {
    if (!bookStudioAdminTarget) return;
    try {
      setSavingQuota(true);
      const res = await fetch(`/api/interviews/${bookStudioAdminTarget.id}/layout-quota`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
        body: JSON.stringify({
          remainingEdits: Math.max(0, quotaRemainingInput),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setInlineQuotaDrafts((prev) => ({
          ...prev,
          [bookStudioAdminTarget.id]: Math.max(0, quotaRemainingInput),
        }));
        await fetchInterviews();
        setBookStudioAdminTarget((prev) =>
          prev
            ? {
                ...prev,
                ...data.data,
                bookVersions: data.data?.bookVersions || prev.bookVersions || [],
              }
            : null
        );
        setNoticeMessage(
          `Cuota de edición de maquetación actualizada: ${quotaRemainingInput} modificación(es) permitida(s) para el entrevistado.`
        );
        setTimeout(() => setNoticeMessage(null), 4000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSavingQuota(false);
    }
  };

  const handleOpenBookStudioModal = async (inv: EnrichedInterview) => {
    const qStatus = computeLayoutEditQuotaStatus(inv);
    setQuotaRemainingInput(qStatus.remainingEdits);
    setBookStudioAdminTarget(inv);

    try {
      const res = await fetch(`/api/interviews/${inv.id}/book-versions`, {
        headers: {
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        const fetchedVersions: ParticipantBookVersionRecord[] = data.data;
        setBookStudioAdminTarget((prev) =>
          prev && prev.id === inv.id
            ? {
                ...prev,
                bookVersions: fetchedVersions,
                bookVersionsCount: fetchedVersions.length,
              }
            : prev
        );
        setInterviews((prevList) =>
          prevList.map((item) =>
            item.id === inv.id
              ? {
                  ...item,
                  bookVersions: fetchedVersions,
                  bookVersionsCount: fetchedVersions.length,
                }
              : item
          )
        );
      }
    } catch (_err) {
      // Ignore network errors; fallback to inv.bookVersions
    }
  };

  const handleDownloadParticipantVersionPdf = async (
    inv: EnrichedInterview,
    ver: ParticipantBookVersionRecord
  ) => {
    try {
      setDownloadingPdfVersionId(ver.id);
      const composed = composeBookPages({
        manuscript: ver.manuscript,
        editorialConfig: ver.editorialConfig,
        coverPhoto: ver.coverPhoto || null,
        chapterPhotos: ver.chapterPhotos || {},
        customClosingPageText: ver.closingPageText || inv.participantClosingText || undefined,
        maxContentPages: 500,
      });

      await preloadBookResourcesForPdf(composed);

      const { blobUrl } = generateRealDemoBookPdf({
        composed,
        profile: {
          mode: ver.manuscript.mode,
          fullName: ver.authors || ver.participantName || inv.title,
          displayName: ver.authors || ver.participantName || inv.title,
          partner1Name: ver.participantName || '',
          partner2Name: '',
          hasAcceptedTemporaryNotice: true,
        },
      });

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = ver.fileName || `YouForever_${inv.id}_v${ver.versionNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch (err) {
      console.error('Error downloading participant PDF version:', err);
    } finally {
      setDownloadingPdfVersionId(null);
    }
  };

  const handleSeedTestStories = async () => {
    try {
      setSeedingStories(true);
      const res = await fetch('/api/interviews/seed-test-stories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
      });
      const data = await res.json();
      if (data.success) {
        await fetchInterviews();
        setNoticeMessage(
          `¡Éxito! Se sembraron 7 historias completas de prueba con al menos 100 respuestas por cada miembro participante (umbral operativo 100) y listas para maquetación.`
        );
        setTimeout(() => setNoticeMessage(null), 7000);
      } else {
        setNoticeMessage(data.error || 'Error al sembrar historias de prueba.');
      }
    } catch (_err) {
      setNoticeMessage('Error de conexión al sembrar historias de prueba.');
    } finally {
      setSeedingStories(false);
    }
  };

  // V5.4.1 — Deletes ALL PDF versions or ALL manuscripts of one interviewee (after confirmation).
  const handleConfirmBulkDelete = async () => {
    if (!bulkDeleteTarget) return;
    const { kind, interview } = bulkDeleteTarget;
    try {
      setBulkDeleting(true);
      const res = await fetch(
        `/api/interviews/${encodeURIComponent(interview.id)}/${kind === 'versions' ? 'book-versions' : 'manuscripts'}`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => null);
      if (!data?.success) {
        setNoticeMessage(data?.error || 'No se pudo completar el borrado. Inténtalo de nuevo.');
        return;
      }
      const clear = (item: EnrichedInterview): EnrichedInterview =>
        kind === 'versions'
          ? { ...item, bookVersions: [], bookVersionsCount: 0, bookGeneratedCount: 0 }
          : { ...item, manuscriptsCount: 0 };
      setInterviews((prev) => {
        const next = prev.map((item) => (item.id === interview.id ? clear(item) : item));
        try {
          localStorage.setItem('foreveryou_interviews_cache', JSON.stringify(next));
        } catch (_e) {
          // ignore
        }
        return next;
      });
      if (kind === 'versions') {
        // Keep this browser's copy consistent: deleted versions are never shown or pushed back.
        try {
          const clearedUpTo = Number(data.data?.clearedUpTo) || 0;
          const synthIds = Array.from({ length: clearedUpTo }, (_v, i) => `pbv_${interview.id}_v${i + 1}`);
          const deletedRaw = localStorage.getItem('foreveryou_deleted_book_version_ids');
          const deletedList: string[] = deletedRaw ? JSON.parse(deletedRaw) : [];
          const nextDeleted = Array.from(
            new Set([...deletedList, ...(data.data?.deletedVersionIds || []), ...synthIds])
          );
          localStorage.setItem('foreveryou_deleted_book_version_ids', JSON.stringify(nextDeleted));
          const cachedRaw = localStorage.getItem('foreveryou_book_versions_cache');
          if (cachedRaw) {
            const parsed: ParticipantBookVersionRecord[] = JSON.parse(cachedRaw);
            localStorage.setItem(
              'foreveryou_book_versions_cache',
              JSON.stringify(parsed.filter((v) => v.interviewId !== interview.id))
            );
          }
        } catch (_e) {
          // ignore
        }
      }
      if (bookStudioAdminTarget && bookStudioAdminTarget.id === interview.id) {
        setBookStudioAdminTarget(clear(bookStudioAdminTarget));
      }
      setNoticeMessage(
        data.message ||
          (kind === 'versions'
            ? 'Se eliminaron todas las versiones del libro en PDF.'
            : 'Se eliminaron todos los manuscritos.')
      );
      setTimeout(() => setNoticeMessage(null), 6000);
      setBulkDeleteTarget(null);
      void fetchInterviews();
    } catch (_err) {
      setNoticeMessage('Error de conexión al borrar. Inténtalo de nuevo.');
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleConfirmDeleteVersion = async () => {
    if (!versionToDelete) return;
    const { version, interview } = versionToDelete;
    try {
      setDeletingVersion(true);
      const res = await fetch(
        `/api/participant-book-versions/${encodeURIComponent(version.id)}?restoreQuota=${restoreQuotaOnDelete}`,
        {
          method: 'DELETE',
          headers: {
            'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
          },
        }
      );
      const data = await res.json();
      if (data.success) {
        const synthId = `pbv_${interview.id}_v${version.versionNumber}`;
        const serverRemainingVersions: ParticipantBookVersionRecord[] | undefined =
          Array.isArray(data.data?.allVersions) ? data.data.allVersions : undefined;

        if (bookStudioAdminTarget && bookStudioAdminTarget.id === interview.id) {
          const updatedVersions =
            serverRemainingVersions ??
            (bookStudioAdminTarget.bookVersions || []).filter(
              (v) => v.id !== version.id && v.id !== synthId && v.versionNumber !== version.versionNumber
            );
          const nextQuotaRemaining = restoreQuotaOnDelete
            ? quotaRemainingInput + 1
            : quotaRemainingInput;
          setQuotaRemainingInput(nextQuotaRemaining);
          setBookStudioAdminTarget({
            ...bookStudioAdminTarget,
            bookVersions: updatedVersions,
            bookVersionsCount: updatedVersions.length,
            bookGeneratedCount: updatedVersions.length,
            layoutEditsUsed: restoreQuotaOnDelete
              ? Math.max(0, (bookStudioAdminTarget.layoutEditsUsed || 1) - 1)
              : bookStudioAdminTarget.layoutEditsUsed,
          });
        }

        setInterviews((prevList) => {
          const nextList = prevList.map((item) => {
            if (item.id !== interview.id) return item;
            const updatedVersions =
              serverRemainingVersions ??
              (item.bookVersions || []).filter(
                (v) => v.id !== version.id && v.id !== synthId && v.versionNumber !== version.versionNumber
              );
            return {
              ...item,
              bookVersions: updatedVersions,
              bookVersionsCount: updatedVersions.length,
              bookGeneratedCount: updatedVersions.length,
              layoutEditsUsed: restoreQuotaOnDelete
                ? Math.max(0, (item.layoutEditsUsed || 1) - 1)
                : item.layoutEditsUsed,
            };
          });
          try {
            localStorage.setItem('foreveryou_interviews_cache', JSON.stringify(nextList));
          } catch (_e) {
            // ignore
          }
          return nextList;
        });

        try {
          const deletedRaw = localStorage.getItem('foreveryou_deleted_book_version_ids');
          const deletedList: string[] = deletedRaw ? JSON.parse(deletedRaw) : [];
          const nextDeleted = Array.from(new Set([...deletedList, version.id, synthId]));
          localStorage.setItem('foreveryou_deleted_book_version_ids', JSON.stringify(nextDeleted));

          const cachedRaw = localStorage.getItem('foreveryou_book_versions_cache');
          if (cachedRaw) {
            const parsed: ParticipantBookVersionRecord[] = JSON.parse(cachedRaw);
            const filtered = parsed.filter(
              (v) =>
                v.id !== version.id &&
                v.id !== synthId &&
                !(v.interviewId === interview.id && v.versionNumber === version.versionNumber)
            );
            localStorage.setItem('foreveryou_book_versions_cache', JSON.stringify(filtered));
          }
        } catch (_e) {
          // ignore
        }

        setNoticeMessage(
          `La versión PDF v${version.versionNumber} de «${interview.title}» fue eliminada permanentemente${
            restoreQuotaOnDelete ? ' y se reintegró 1 intento de edición al participante.' : '.'
          }`
        );
        setTimeout(() => setNoticeMessage(null), 5000);
        setVersionToDelete(null);
      } else {
        setNoticeMessage(data.error || 'Error al eliminar la versión PDF.');
      }
    } catch (_err) {
      setNoticeMessage('Error de red al eliminar la versión PDF.');
    } finally {
      setDeletingVersion(false);
    }
  };

  const handleEvaluateSufficiency = async (interviewId: string) => {
    try {
      setEvaluatingId(interviewId);
      const res = await fetch(`/api/interviews/${interviewId}/evaluate`, {
        method: 'POST',
        headers: {
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
      });
      const data = await res.json();
      if (data.success) {
        fetchInterviews();
        setNoticeMessage(
          `Evaluación de suficiencia completada: ${data.data.sufficiencyStatus}. ${data.data.rationale}`
        );
      }
    } catch (err) {
      console.error(err);
    } finally {
      setEvaluatingId(null);
    }
  };

  const handleCompileManuscript = async (interviewId: string) => {
    try {
      setCompilingId(interviewId);
      const res = await fetch(`/api/interviews/${interviewId}/manuscript`, {
        method: 'POST',
        headers: {
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
      });
      const data = await res.json();
      if (data.success) {
        onOpenManuscript(interviewId);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCompilingId(null);
    }
  };

  const handleDownloadBackupZip = async (interviewId: string) => {
    try {
      setDownloadingZipId(interviewId);
      const res = await fetch(`/api/interviews/${interviewId}/backup/zip`, {
        headers: {
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
      });
      if (!res.ok) throw new Error('Error al generar el respaldo ZIP');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const contentDisposition = res.headers.get('content-disposition');
      let filename = `respaldo_legado_${interviewId}.zip`;
      if (contentDisposition && contentDisposition.includes('filename="')) {
        filename = contentDisposition.split('filename="')[1].split('"')[0];
      }
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error downloading backup zip:', err);
      setNoticeMessage('No se pudo descargar el archivo de respaldo ZIP.');
      setTimeout(() => setNoticeMessage(null), 4000);
    } finally {
      setDownloadingZipId(null);
    }
  };

  const handleDeleteInterview = async (interview: EnrichedInterview) => {
    try {
      setIsProcessingAction(true);
      const res = await fetch(`/api/interviews/${encodeURIComponent(interview.id)}`, {
        method: 'DELETE',
        headers: {
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
      });
      const data = await res.json();
      if (data.success) {
        setInterviews((prev) => {
          const next = prev.filter((inv) => inv.id !== interview.id);
          try {
            localStorage.setItem('foreveryou_interviews_cache', JSON.stringify(next));
          } catch (_e) {
            // ignore
          }
          return next;
        });
        setNoticeMessage(`La entrevista «${interview.title}» fue eliminada de la base de datos.`);
        setTimeout(() => setNoticeMessage(null), 4000);
      } else {
        setNoticeMessage(data.error || 'Error al eliminar la entrevista.');
      }
    } catch (err) {
      setNoticeMessage('Error de red al eliminar la entrevista.');
    } finally {
      setIsProcessingAction(false);
      setDeleteTarget(null);
    }
  };

  const handleResetInterview = async (interview: EnrichedInterview) => {
    try {
      setIsProcessingAction(true);
      const res = await fetch(`/api/interviews/${encodeURIComponent(interview.id)}/reset`, {
        method: 'POST',
        headers: {
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
      });
      const data = await res.json();
      if (data.success) {
        await fetchInterviews();
        setNoticeMessage(
          `La entrevista «${interview.title}» ha sido restablecida al inicio. El participante podrá comenzar a contestar desde el principio.`
        );
        setTimeout(() => setNoticeMessage(null), 5000);
      } else {
        setNoticeMessage(data.error || 'Error al restablecer la entrevista.');
      }
    } catch (err) {
      setNoticeMessage('Error de red al restablecer la entrevista.');
    } finally {
      setIsProcessingAction(false);
      setResetTarget(null);
    }
  };

  const handleDuplicateInterview = async (interview: EnrichedInterview) => {
    try {
      setDuplicatingId(interview.id);
      const res = await fetch(`/api/interviews/${encodeURIComponent(interview.id)}/duplicate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
      });
      const data = await res.json();
      if (data.success && data.data?.interview) {
        const duplicated: EnrichedInterview = data.data.interview;
        const newTokens: Array<{ accessCode?: string }> = data.data.participantTokens || [];
        const codesSummary = newTokens
          .map((t) => t.accessCode)
          .filter(Boolean)
          .join(', ');

        setInterviews((prev) => {
          const next = sortInterviewsWithCopies([...prev, duplicated]);
          try {
            localStorage.setItem('foreveryou_interviews_cache', JSON.stringify(next));
          } catch (_e) {
            // ignore
          }
          return next;
        });

        await fetchInterviews();
        setNoticeMessage(
          `Entrevista «${interview.title}» duplicada exitosamente${
            codesSummary ? ` con nuevo código de acceso: ${codesSummary}` : ''
          }. La copia aparece listada debajo de la original.`
        );
        setTimeout(() => setNoticeMessage(null), 6000);
      } else {
        setNoticeMessage(data.error || 'No se pudo duplicar la entrevista.');
      }
    } catch (_err) {
      setNoticeMessage('Error de red al duplicar la entrevista.');
    } finally {
      setDuplicatingId(null);
      setDuplicateTarget(null);
    }
  };

  const handleSaveAdminCopyNote = async (interview: EnrichedInterview) => {
    const draftValue =
      copyNoteDrafts[interview.id] !== undefined
        ? copyNoteDrafts[interview.id]
        : interview.adminCopyNote ||
          buildDefaultAdminCopyNote(
            interview.copiedFromName || interview.participants?.[0]?.name || interview.title,
            interview.copiedAt || interview.openedAt
          );
    try {
      setSavingCopyNoteId(interview.id);
      const res = await fetch(`/api/interviews/${encodeURIComponent(interview.id)}/copy-note`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
        body: JSON.stringify({ adminCopyNote: draftValue }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setInterviews((prev) => {
          const next = prev.map((item) =>
            item.id === interview.id
              ? { ...item, adminCopyNote: data.data.adminCopyNote }
              : item
          );
          try {
            localStorage.setItem('foreveryou_interviews_cache', JSON.stringify(next));
          } catch (_e) {
            // ignore
          }
          return next;
        });
        setSavedCopyNoteId(interview.id);
        setTimeout(() => setSavedCopyNoteId((curr) => (curr === interview.id ? null : curr)), 2500);
      } else {
        setNoticeMessage(data.error || 'Error al guardar la nota administrativa.');
      }
    } catch (_err) {
      setNoticeMessage('Error de red al guardar la nota administrativa.');
    } finally {
      setSavingCopyNoteId(null);
    }
  };

  const handleSaveInlineQuota = async (interview: EnrichedInterview) => {
    const currentStatus = computeLayoutEditQuotaStatus(interview);
    const desiredRemaining =
      inlineQuotaDrafts[interview.id] !== undefined
        ? Math.max(0, inlineQuotaDrafts[interview.id])
        : currentStatus.remainingEdits;
    try {
      setSavingInlineQuotaId(interview.id);
      const res = await fetch(`/api/interviews/${encodeURIComponent(interview.id)}/layout-quota`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
        body: JSON.stringify({ remainingEdits: desiredRemaining }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setInterviews((prev) => {
          const next = prev.map((item) =>
            item.id === interview.id
              ? {
                  ...item,
                  layoutEditsAllowed: data.data.layoutEditsAllowed,
                  layoutEditsUsed: data.data.layoutEditsUsed,
                }
              : item
          );
          try {
            localStorage.setItem('foreveryou_interviews_cache', JSON.stringify(next));
          } catch (_e) {
            // ignore
          }
          return next;
        });
        setSavedInlineQuotaId(interview.id);
        setTimeout(
          () => setSavedInlineQuotaId((curr) => (curr === interview.id ? null : curr)),
          2500
        );
        setNoticeMessage(
          `Cuota de edición actualizada para «${interview.title}»: ${desiredRemaining} edición(es) disponible(s).`
        );
        setTimeout(() => setNoticeMessage(null), 4000);
      } else {
        setNoticeMessage(data.error || 'No se pudo actualizar la cuota.');
      }
    } catch (_err) {
      setNoticeMessage('Error de red al actualizar la cuota de edición.');
    } finally {
      setSavingInlineQuotaId(null);
    }
  };

  const handleSyncFirestore = async () => {
    try {
      setSyncingFirestore(true);
      const res = await fetch('/api/interviews/sync-firestore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
      });
      const json = await res.json();
      if (json?.syncResult?.status) {
        setFirestoreSyncStatus(json.syncResult.status);
      }
      if (json?.success && Array.isArray(json.data)) {
        const ordered = sortInterviewsWithCopies<EnrichedInterview>(json.data as EnrichedInterview[]);
        setInterviews(ordered);
        lastFetchTimestampRef.current = Date.now();
        setLastUpdatedLabel(
          new Date().toLocaleTimeString('es-MX', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
        );
        try {
          localStorage.setItem('foreveryou_interviews_cache', JSON.stringify(ordered));
        } catch {
          // ignore
        }
        setNoticeMessage(
          json.syncResult?.message ||
            'Sincronización con Cloud Firestore completada sin sobrescribir registros.'
        );
        setTimeout(() => setNoticeMessage(null), 6000);
      } else {
        setNoticeMessage(json?.error || 'No se pudo completar la sincronización con Firestore.');
      }
    } catch (_err) {
      setNoticeMessage('Error de red al sincronizar con Cloud Firestore.');
    } finally {
      setSyncingFirestore(false);
    }
  };

  const handleOpenRegistrationModal = (
    interview: EnrichedInterview,
    participant: ParticipantRecord & { plainToken?: string; accessCode?: string }
  ) => {
    setRegModalError(null);
    setRegTitleDraft(interview.title || '');
    const orderedParts = [...interview.participants].sort((a, b) => {
      if (a.id === participant.id) return -1;
      if (b.id === participant.id) return 1;
      return a.role === 'primary' && b.role !== 'primary' ? -1 : 0;
    });
    setRegParticipantDrafts(
      orderedParts.map((part) => ({
        participantId: part.id,
        name: part.name || '',
        email: part.email || '',
        age: part.age !== undefined && part.age !== null ? String(part.age) : '',
        city: part.city || '',
        relationship: part.relationship || '',
        role: part.role || 'contributor',
        accessCode: part.accessCode,
        privacyAcceptedAt: part.privacyAcceptedAt,
        privacyVersion: part.privacyVersion,
      }))
    );
    setRegistrationModalTarget({ interview, focusedParticipantId: participant.id });
  };

  const handleSaveRegistrationModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!registrationModalTarget) return;
    setRegModalError(null);
    try {
      setSavingRegistration(true);
      const res = await fetch(
        `/api/admin/interviews/${encodeURIComponent(registrationModalTarget.interview.id)}/registration-data`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
          },
          body: JSON.stringify({
            interviewTitle: regTitleDraft.trim(),
            participants: regParticipantDrafts.map((d) => ({
              participantId: d.participantId,
              name: d.name.trim(),
              email: d.email.trim(),
              age: d.age.trim() === '' ? null : Number(d.age.trim()),
              city: d.city.trim(),
              relationship: d.relationship.trim(),
              role: d.role,
            })),
          }),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.success || !json.data) {
        setRegModalError(json.error || 'No se pudieron guardar los datos de registro.');
        return;
      }

      const updatedInterview: InterviewRecord = json.data.interview;
      const updatedParticipants = json.data.participants || [];
      setInterviews((prev) => {
        const next = prev.map((item) =>
          item.id === updatedInterview.id
            ? {
                ...item,
                title: updatedInterview.title,
                lastActivityAt: updatedInterview.lastActivityAt,
                participants: updatedParticipants,
              }
            : item
        );
        try {
          localStorage.setItem('foreveryou_interviews_cache', JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });

      setRegistrationModalTarget(null);
      setNoticeMessage(
        `Datos de registro actualizados para «${updatedInterview.title}». Se conservaron respuestas, accesos y libros vinculados.`
      );
      setTimeout(() => setNoticeMessage(null), 5000);
    } catch {
      setRegModalError('Error de conexión al guardar los datos de registro.');
    } finally {
      setSavingRegistration(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'open':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300/60">
            Abierta
          </span>
        );
      case 'completed':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-300/60">
            Completada
          </span>
        );
      case 'expired':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-300/60">
            Vencida
          </span>
        );
      case 'ready_for_review':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300/60">
            En Revisión
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-stone-100 text-stone-700">
            {status}
          </span>
        );
    }
  };

  const getSufficiencyBadge = (sufficiency: SufficiencyStatus) => {
    switch (sufficiency) {
      case 'sufficient':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
            ✓ Suficiente
          </span>
        );
      case 'sufficient_with_limitations':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            ⚠ Suficiente con limitaciones
          </span>
        );
      case 'insufficient':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-stone-100 text-stone-700 border border-stone-200">
            Insuficiente
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[11px] text-stone-400">
            No evaluada
          </span>
        );
    }
  };

  const orderedInterviews = sortInterviewsWithCopies(interviews);
  const filteredInterviews = orderedInterviews.filter((inv) => {
    if (statusFilter !== 'todos' && inv.status !== statusFilter) {
      return false;
    }

    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase().trim();

    // Match title, ID, storyType
    if ((inv.title || '').toLowerCase().includes(term)) return true;
    if ((inv.id || '').toLowerCase().includes(term)) return true;
    if ((inv.storyType || '').toLowerCase().includes(term)) return true;

    // Match any participant name (first name, surname), email, relationship, accessCode
    const matchParticipant = (inv.participants || []).some((p) => {
      const name = (p.name || '').toLowerCase();
      const email = (p.email || '').toLowerCase();
      const relationship = (p.relationship || '').toLowerCase();
      const accessCode = (p.accessCode || '').toLowerCase();
      return (
        name.includes(term) ||
        email.includes(term) ||
        relationship.includes(term) ||
        accessCode.includes(term)
      );
    });

    return matchParticipant;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold font-serif text-stone-900 flex items-center space-x-2">
            <Users className="w-5 h-5 text-amber-700" />
            <span>Gestión de Entrevistas &amp; Historias de Vida</span>
          </h2>
          <p className="text-sm text-stone-500">
            Supervisa el ciclo de vida, participantes invitados, cobertura testimonial y manuscritos.
            {lastUpdatedLabel && (
              <span className="ml-2 font-mono text-[11px] text-stone-400 tabular-nums">
                · Actualizado {lastUpdatedLabel}
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSyncFirestore()}
            disabled={syncingFirestore}
            data-testid="btn-sync-firestore"
            className="inline-flex items-center space-x-1.5 min-h-[40px] px-3.5 py-2 bg-white hover:bg-stone-50 border border-stone-300 text-stone-800 rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
            title="Sincronizar desde Cloud Firestore (incluye registros recientes de www.youforever.app) sin sobrescribir datos"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-amber-700 ${syncingFirestore ? 'animate-spin' : ''}`} />
            <span>{syncingFirestore ? 'Sincronizando...' : 'Sincronizar Firestore'}</span>
          </button>

          <button
            onClick={handleSeedTestStories}
            disabled={seedingStories}
            className="inline-flex items-center space-x-1.5 min-h-[40px] px-3.5 py-2 bg-stone-100 hover:bg-stone-200 border border-stone-300 text-stone-800 rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
            title="Carga 3 historias individuales variadas y 4 compartidas (de 2 a 5 participantes) con al menos 100 respuestas por cada miembro y umbral 100"
          >
            <Sparkles className="w-4 h-4 text-amber-700" />
            <span>{seedingStories ? 'Sembrando Historias (100+ c/u)...' : 'Sembrar Historias de Prueba (100+ c/u)'}</span>
          </button>

          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center space-x-1.5 min-h-[40px] px-4 py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-semibold shadow-sm transition cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Nueva Entrevista</span>
          </button>
        </div>
      </div>

      {firestoreSyncStatus?.quotaExhausted && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl text-amber-950 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start space-x-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-0.5 leading-relaxed">
              <p className="font-bold">
                Límite diario de lecturas de Cloud Firestore alcanzado temporalmente
              </p>
              <p className="text-amber-900">
                Los registros existentes en caché segura permanecen intactos y protegidos. Los registros nuevos creados recientemente en{' '}
                <strong>www.youforever.app</strong> se reflejarán automáticamente sin pérdida en cuanto se restablezca la cuota diaria de Firebase (o al pulsar «Sincronizar Firestore» una vez restablecida).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleSyncFirestore()}
            disabled={syncingFirestore}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-amber-100 border border-amber-300 text-amber-900 rounded-lg font-semibold shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingFirestore ? 'animate-spin' : ''}`} />
            <span>Reintentar Sync</span>
          </button>
        </div>
      )}

      {noticeMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 text-xs flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{noticeMessage}</span>
        </div>
      )}

      {/* Search & Filter Bar */}
      {interviews.length > 0 && (
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute left-3 top-3 text-stone-400" />
            <input
              type="text"
              placeholder="Buscar por nombre, apellido de participante, título, parentesco o correo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-8 py-2 border border-stone-300 rounded-lg text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-600"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-2.5 text-stone-400 hover:text-stone-700 p-0.5 rounded transition"
                title="Limpiar búsqueda"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center space-x-2 w-full sm:w-auto justify-between sm:justify-end">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filtrar por estado"
              className="border border-stone-300 rounded-lg px-2.5 py-2 text-xs text-stone-800 bg-white focus:outline-none focus:ring-2 focus:ring-amber-200 font-medium"
            >
              <option value="todos">Todos los Estados</option>
              <option value="open">Abierta</option>
              <option value="ready_for_review">En Revisión</option>
              <option value="completed">Completada</option>
              <option value="expired">Vencida</option>
            </select>

            {searchTerm.trim() ? (
              <div className="flex items-center space-x-2">
                <span className="bg-amber-50 text-amber-900 border border-amber-200 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap">
                  {filteredInterviews.length} {filteredInterviews.length === 1 ? 'coincidencia' : 'coincidencias'}
                </span>
                <button
                  onClick={() => setSearchTerm('')}
                  className="text-amber-800 hover:underline text-[11px] font-medium"
                >
                  Limpiar
                </button>
              </div>
            ) : (
              <span className="text-xs text-stone-500 font-medium whitespace-nowrap px-1">
                {filteredInterviews.length} {filteredInterviews.length === 1 ? 'entrevista' : 'entrevistas'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Interviews List */}
      <div className="space-y-4">
        {interviews.length === 0 ? (
          <div className="bg-white p-12 text-center rounded-xl border border-stone-200 text-stone-500">
            <BookOpen className="w-8 h-8 mx-auto text-stone-400 mb-2" />
            <p className="font-serif text-base font-semibold text-stone-800">
              No hay entrevistas registradas aún.
            </p>
            <p className="text-xs text-stone-500 mt-1">
              Crea una nueva historia individual o compartida para comenzar la recopilación testimonial.
            </p>
          </div>
        ) : filteredInterviews.length === 0 ? (
          <div className="bg-white p-12 text-center rounded-xl border border-stone-200 text-stone-500 space-y-3">
            <Search className="w-8 h-8 mx-auto text-stone-400 mb-2" />
            <p className="font-serif text-base font-semibold text-stone-800">
              No se encontraron entrevistas para «{searchTerm}»
            </p>
            <p className="text-xs text-stone-500 max-w-md mx-auto">
              Verifica el nombre o apellido del participante, título o estado seleccionado.
            </p>
            <div className="pt-2">
              <button
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('todos');
                }}
                className="inline-flex items-center space-x-1.5 px-4 py-2 bg-stone-800 hover:bg-stone-900 text-white rounded-lg text-xs font-semibold transition"
              >
                <X className="w-3.5 h-3.5" />
                <span>Limpiar Búsqueda y Filtros</span>
              </button>
            </div>
          </div>
        ) : (
          filteredInterviews.map((inv) => {
            const isExpired = new Date(inv.expiresAt).getTime() < Date.now();
            const daysRemaining = Math.max(
              0,
              Math.ceil((new Date(inv.expiresAt).getTime() - Date.now()) / (1000 * 3600 * 24))
            );
            const isCopy = Boolean(inv.copiedFromInterviewId);
            const quotaStatus = computeLayoutEditQuotaStatus(inv);
            const draftQuotaValue =
              inlineQuotaDrafts[inv.id] !== undefined
                ? inlineQuotaDrafts[inv.id]
                : quotaStatus.remainingEdits;
            const defaultCopyNote = buildDefaultAdminCopyNote(
              inv.copiedFromName || inv.participants?.[0]?.name || inv.title,
              inv.copiedAt || inv.openedAt
            );
            const draftCopyNote =
              copyNoteDrafts[inv.id] !== undefined
                ? copyNoteDrafts[inv.id]
                : inv.adminCopyNote || defaultCopyNote;

            return (
              <div
                key={inv.id}
                data-testid={isCopy ? `interview-copy-card-${inv.id}` : `interview-card-${inv.id}`}
                className={`bg-white rounded-xl border shadow-sm p-5 transition ${
                  isCopy
                    ? 'ml-4 sm:ml-8 border-amber-300 hover:border-amber-400'
                    : 'border-stone-200 hover:border-amber-200'
                }`}
              >
                {/* Admin-only Copy Metadata Field (Never visible to participant) */}
                {isCopy && (
                  <div
                    data-testid={`admin-copy-note-panel-${inv.id}`}
                    className="mb-3 p-3 rounded-lg bg-amber-50/80 border border-amber-200 flex flex-col sm:flex-row sm:items-center gap-2 text-xs"
                  >
                    <label
                      htmlFor={`copy-note-${inv.id}`}
                      className="text-[11px] font-bold text-amber-950 shrink-0 flex items-center space-x-1"
                    >
                      <Lock className="w-3.5 h-3.5 text-amber-700" />
                      <span>Solo Admin · Origen de copia:</span>
                    </label>
                    <input
                      id={`copy-note-${inv.id}`}
                      type="text"
                      value={draftCopyNote}
                      onChange={(e) =>
                        setCopyNoteDrafts((prev) => ({ ...prev, [inv.id]: e.target.value }))
                      }
                      className="flex-1 px-2.5 py-1.5 bg-white border border-amber-300 rounded-md text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-200"
                      placeholder={defaultCopyNote}
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveAdminCopyNote(inv)}
                      disabled={savingCopyNoteId === inv.id}
                      className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-amber-800 hover:bg-amber-900 text-white rounded-md text-[11px] font-semibold transition disabled:opacity-50 shrink-0"
                    >
                      {savedCopyNoteId === inv.id ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Nota guardada</span>
                        </>
                      ) : (
                        <>
                          <Save className="w-3.5 h-3.5" />
                          <span>{savingCopyNoteId === inv.id ? 'Guardando...' : 'Guardar nota'}</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* Header row */}
                <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-stone-100 gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-serif text-lg font-bold text-stone-900">
                        {inv.title}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-stone-100 text-stone-700 uppercase tracking-wide">
                        {inv.storyMode === 'compartida' ? 'Historia Compartida' : 'Historia Individual'}
                      </span>
                      {getStatusBadge(inv.status)}
                    </div>
                    <div className="flex items-center space-x-4 mt-1 text-xs text-stone-500">
                      <span className="flex items-center space-x-1">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>
                          Abierta:{' '}
                          {new Date(inv.openedAt).toLocaleDateString('es-MX', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </span>
                      <span className="flex items-center space-x-1">
                        <Clock className="w-3.5 h-3.5" />
                        <span className={isExpired ? 'text-rose-600 font-semibold' : ''}>
                          Vence:{' '}
                          {new Date(inv.expiresAt).toLocaleDateString('es-MX', {
                            month: 'short',
                            day: 'numeric',
                          })}{' '}
                          ({isExpired ? 'Vencida' : `${daysRemaining} días restantes`})
                        </span>
                      </span>
                      {inv.closedAt && (
                        <span className="text-stone-400">
                          Cerrada: {new Date(inv.closedAt).toLocaleDateString('es-MX')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleEvaluateSufficiency(inv.id)}
                      disabled={evaluatingId === inv.id}
                      className="inline-flex items-center space-x-1 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 rounded-lg text-xs font-medium transition disabled:opacity-50"
                      title="Evalúa con Gemini la cobertura y riqueza testimonial"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                      <span>{evaluatingId === inv.id ? 'Evaluando...' : 'Evaluar Cobertura'}</span>
                    </button>

                    {inv.manuscriptsCount && inv.manuscriptsCount > 0 ? (
                      <button
                        onClick={() => onOpenManuscript(inv.id)}
                        className="inline-flex items-center space-x-1 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold shadow-sm transition"
                        title="Abrir los borradores de manuscritos guardados en la base de datos"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>Ver Manuscritos ({inv.manuscriptsCount})</span>
                      </button>
                    ) : null}

                    {/* V5.4.1: borrar todos los manuscritos de este entrevistado */}
                    {inv.manuscriptsCount && inv.manuscriptsCount > 0 ? (
                      <button
                        onClick={() =>
                          setBulkDeleteTarget({ kind: 'manuscripts', interview: inv, count: inv.manuscriptsCount || 0 })
                        }
                        className="inline-flex items-center space-x-1 px-3 py-1.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 rounded-lg text-xs font-semibold transition"
                        title="Borrar todos los manuscritos de este entrevistado (pide confirmación)"
                        data-testid={`bulk-delete-manuscripts-${inv.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Borrar manuscritos ({inv.manuscriptsCount})</span>
                      </button>
                    ) : null}

                    <button
                      onClick={() => handleCompileManuscript(inv.id)}
                      disabled={compilingId === inv.id}
                      className="inline-flex items-center space-x-1 px-3 py-1.5 bg-stone-800 hover:bg-stone-900 text-white rounded-lg text-xs font-semibold shadow-sm transition disabled:opacity-50"
                      title="Genera el borrador del manuscrito fidedigno a partir de testimonios"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>
                        {compilingId === inv.id
                          ? 'Compilando...'
                          : inv.manuscriptsCount && inv.manuscriptsCount > 0
                          ? 'Nueva Versión Manuscrito'
                          : 'Generar Manuscrito'}
                      </span>
                    </button>

                    {/* Descargar Respaldo Testimonial Integral (ZIP) */}
                    <button
                      onClick={() => handleDownloadBackupZip(inv.id)}
                      disabled={downloadingZipId === inv.id}
                      className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-50"
                      title="Descargar respaldo integral en ZIP: Libro biográfico, compilado de preguntas y respuestas, audios de voz originales y fotografías"
                    >
                      {downloadingZipId === inv.id ? (
                        <>
                          <Clock className="w-3.5 h-3.5 animate-spin text-amber-700" />
                          <span>Preparando ZIP...</span>
                        </>
                      ) : (
                        <>
                          <Archive className="w-3.5 h-3.5 text-amber-700" />
                          <span>Descargar Respaldo (ZIP)</span>
                        </>
                      )}
                    </button>

                    {/* Libros PDF Generados por el Entrevistado & Cuota de Edición */}
                    <button
                      onClick={() => handleOpenBookStudioModal(inv)}
                      className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-amber-800 hover:bg-amber-900 text-white rounded-lg text-xs font-semibold shadow-xs transition"
                      title="Ver y descargar versiones del libro en PDF generadas por el entrevistado y configurar cuántas veces puede editar la maquetación"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>
                        Libros PDF &amp; Cuota ({inv.bookVersions?.length || inv.bookVersionsCount || 0})
                      </span>
                    </button>

                    {/* V5.4.1: borrar todas las versiones PDF guardadas de este entrevistado */}
                    {(inv.bookVersions?.length || inv.bookVersionsCount || 0) > 0 && (
                      <button
                        onClick={() =>
                          setBulkDeleteTarget({
                            kind: 'versions',
                            interview: inv,
                            count: inv.bookVersions?.length || inv.bookVersionsCount || 0,
                          })
                        }
                        className="inline-flex items-center space-x-1 px-3 py-1.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 rounded-lg text-xs font-semibold transition"
                        title="Borrar todas las versiones del libro en PDF de este entrevistado (pide confirmación)"
                        data-testid={`bulk-delete-versions-${inv.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Borrar PDFs ({inv.bookVersions?.length || inv.bookVersionsCount || 0})</span>
                      </button>
                    )}

                    {/* Extend or Reopen */}
                    {inv.status === 'open' && !inv.userDeclaredComplete && (
                      <button
                        onClick={() => setShowExtendModal(inv)}
                        className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg text-xs font-medium transition"
                      >
                        <Clock className="w-3.5 h-3.5 text-stone-500" />
                        <span>Extender Plazo</span>
                      </button>
                    )}

                    {(inv.status === 'completed' || inv.status === 'expired' || inv.userDeclaredComplete) && (
                      <button
                        onClick={() => {
                          setReopenLayoutEdits(1);
                          setShowReopenModal(inv);
                        }}
                        className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-medium transition"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Reabrir Cuestionario y Edición</span>
                      </button>
                    )}

                    {/* Reset Interview to Beginning */}
                    <button
                      onClick={() => setResetTarget(inv)}
                      className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-lg text-xs font-medium transition"
                      title="Restablecer la entrevista al inicio para que el entrevistado empiece a contestar desde el principio"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
                      <span>Restablecer al Inicio</span>
                    </button>

                    {/* Duplicate Interview (Faithful Copy with New Access Code) */}
                    <button
                      type="button"
                      onClick={() => setDuplicateTarget(inv)}
                      disabled={duplicatingId === inv.id}
                      className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-300 rounded-lg text-xs font-medium transition disabled:opacity-50"
                      title="Crear una copia fiel de esta entrevista con un código de acceso diferente"
                    >
                      <CopyPlus className="w-3.5 h-3.5 text-amber-700" />
                      <span>{duplicatingId === inv.id ? 'Duplicando...' : 'Duplicar'}</span>
                    </button>

                    {/* Delete Interview from Database */}
                    <button
                      onClick={() => setDeleteTarget(inv)}
                      className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 hover:border-rose-300 rounded-lg text-xs font-medium transition"
                      title="Eliminar permanentemente esta entrevista y sus datos de la base de datos"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                      <span>Eliminar</span>
                    </button>
                  </div>
                </div>

                {/* Progress & Sufficiency Metrics */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 py-3 border-b border-stone-100 text-xs">
                  <div>
                    <span className="text-stone-500 block">Preguntas Completadas:</span>
                    <span className="font-semibold text-stone-800 text-sm">
                      {inv.completedQuestionCount} respondidas{' '}
                      <span className="text-stone-400 font-normal">
                        (Umbral operativo: {inv.sufficiencyThreshold})
                      </span>
                    </span>
                  </div>

                  <div>
                    <span className="text-stone-500 block">Estado de Suficiencia Narrativa:</span>
                    <div className="mt-0.5">{getSufficiencyBadge(inv.sufficiencyStatus)}</div>
                  </div>

                  <div>
                    <span className="text-stone-500 block">Finalización Voluntaria:</span>
                    <span className="font-medium text-stone-800">
                      {inv.userDeclaredComplete ? (
                        <span className="text-blue-700 font-semibold">
                          Cerrada por el entrevistado (Solo lectura)
                        </span>
                      ) : (
                        <span className="text-stone-400">En curso</span>
                      )}
                    </span>
                  </div>

                  <div>
                    <span className="text-stone-500 block">Libro PDF y Cuota de Edición:</span>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5 tabular-nums">
                      <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200 font-semibold text-[11px]">
                        {inv.bookVersions?.length || inv.bookVersionsCount || 0} PDF(s)
                      </span>
                      <span className="text-[11px] text-stone-600">
                        Usadas: {quotaStatus.layoutEditsUsed} · Disp.: {quotaStatus.remainingEdits}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                      <label htmlFor={`quota-${inv.id}`} className="sr-only">
                        Cuota de edición de manuscritos para {inv.title}
                      </label>
                      <button
                        type="button"
                        aria-label={`Disminuir cuota para ${inv.title}`}
                        onClick={() =>
                          setInlineQuotaDrafts((prev) => ({
                            ...prev,
                            [inv.id]: Math.max(0, draftQuotaValue - 1),
                          }))
                        }
                        className="p-1 rounded border border-stone-300 bg-white hover:bg-stone-100 text-stone-700 transition"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <input
                        id={`quota-${inv.id}`}
                        type="number"
                        min={0}
                        max={50}
                        value={draftQuotaValue}
                        onChange={(e) =>
                          setInlineQuotaDrafts((prev) => ({
                            ...prev,
                            [inv.id]: Math.max(0, parseInt(e.target.value, 10) || 0),
                          }))
                        }
                        className="w-14 px-1.5 py-0.5 border border-stone-300 rounded text-xs font-bold text-stone-900 text-center tabular-nums bg-white"
                      />
                      <button
                        type="button"
                        aria-label={`Aumentar cuota para ${inv.title}`}
                        onClick={() =>
                          setInlineQuotaDrafts((prev) => ({
                            ...prev,
                            [inv.id]: Math.min(50, draftQuotaValue + 1),
                          }))
                        }
                        className="p-1 rounded border border-stone-300 bg-white hover:bg-stone-100 text-stone-700 transition"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveInlineQuota(inv)}
                        disabled={savingInlineQuotaId === inv.id}
                        className="px-2 py-0.5 bg-amber-700 hover:bg-amber-800 text-white rounded text-[11px] font-semibold transition disabled:opacity-50"
                      >
                        {savedInlineQuotaId === inv.id
                          ? '¡Guardada!'
                          : savingInlineQuotaId === inv.id
                          ? 'Guardando...'
                          : 'Guardar cuota'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Participants & Invitation Links */}
                <div className="pt-3">
                  <h4 className="text-xs font-bold text-stone-700 uppercase tracking-wide mb-2">
                    Participantes &amp; Enlaces de Acceso Criptográficos
                  </h4>

                  <div className="space-y-2">
                    {inv.participants.map((p) => (
                      <div
                        key={p.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 bg-stone-50 rounded-lg border border-stone-200/70 text-xs gap-2"
                      >
                        <div className="flex items-center space-x-2">
                          <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-900 font-bold flex items-center justify-center text-[10px]">
                            {p.name.charAt(0)}
                          </div>
                          <div>
                            <span className="font-semibold text-stone-900">{p.name}</span>
                            <span className="text-stone-500 ml-1.5">({p.relationship})</span>
                            <span className="ml-2 text-[10px] text-stone-400">
                              [{p.role === 'primary' ? 'Titular' : 'Colaborador'}]
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            data-testid={`btn-registration-data-${p.id}`}
                            onClick={() => handleOpenRegistrationModal(inv, p)}
                            className="inline-flex items-center space-x-1 px-2 py-1 bg-white hover:bg-stone-100 text-stone-800 border border-stone-300 rounded text-[11px] font-semibold shadow-xs transition cursor-pointer"
                            title="Consultar o editar todos los datos de registro de este participante"
                          >
                            <ClipboardList className="w-3.5 h-3.5 text-amber-700" />
                            <span>Datos de registro</span>
                          </button>

                          {p.plainToken ? (
                            <>
                              {p.accessCode && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    copyToClipboard(p.accessCode!);
                                    setCopiedAccessBadge(p.id);
                                    setTimeout(() => setCopiedAccessBadge(null), 2500);
                                  }}
                                  title="Clic para copiar el código de acceso"
                                  className="inline-flex items-center space-x-1 font-mono text-[10px] bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 px-1.5 py-0.5 rounded font-bold transition cursor-pointer"
                                >
                                  <Key className="w-3 h-3 text-amber-700" />
                                  <span>
                                    {copiedAccessBadge === p.id ? `¡Copiado: ${p.accessCode}!` : `Código: ${p.accessCode}`}
                                  </span>
                                </button>
                              )}

                              <button
                                onClick={() => setSharingData({ interview: inv, participant: p })}
                                className="inline-flex items-center space-x-1 px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded text-[11px] font-semibold shadow-xs transition"
                                title="Abrir opciones de compartir por WhatsApp, código o enlace público"
                              >
                                <Share2 className="w-3.5 h-3.5 text-amber-700" />
                                <span>Compartir</span>
                              </button>

                              <button
                                onClick={() => handleCopyLink(p.plainToken!)}
                                className="inline-flex items-center space-x-1 px-2 py-1 bg-white hover:bg-stone-100 text-stone-700 border border-stone-300 rounded text-[11px] font-medium shadow-xs transition"
                                title="Copiar enlace directo público"
                              >
                                {copiedToken === p.plainToken ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                    <span className="text-emerald-700">Copiado</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5 text-stone-400" />
                                    <span>Enlace</span>
                                  </>
                                )}
                              </button>

                              <button
                                onClick={() => onEnterParticipantPortal(p.plainToken!)}
                                className="inline-flex items-center space-x-1 px-2.5 py-1 bg-amber-700 hover:bg-amber-800 text-white rounded text-[11px] font-medium shadow-xs transition"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                <span>Entrar como {p.name.split(' ')[0]}</span>
                              </button>
                            </>
                          ) : (
                            <span className="text-stone-400 text-[11px]">Enlace no disponible</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal: Create New Interview */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-xl w-full p-6 shadow-2xl border border-stone-200 max-h-[90vh] overflow-y-auto">
            <h3 className="font-serif text-lg font-bold text-stone-900 pb-3 border-b border-stone-200 mb-4">
              Crear Nueva Entrevista en YouForever
            </h3>

            <form onSubmit={handleCreateInterview} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  Título de la Obra o Historia *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Memorias y Raíces de la Abuela Elena"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Modalidad</label>
                  <select
                    value={newMode}
                    onChange={(e) => {
                      const mode = e.target.value as 'individual' | 'compartida';
                      setNewMode(mode);
                      if (mode === 'compartida' && participantsList.length < 2) {
                        setParticipantsList([
                          ...participantsList,
                          { name: '', relationship: 'Hijo/a', role: 'contributor', email: '' },
                        ]);
                      }
                    }}
                    className="w-full px-2.5 py-2 border border-stone-300 rounded-lg text-xs text-stone-900"
                  >
                    <option value="individual">Historia Individual (1 persona)</option>
                    <option value="compartida">Historia Compartida (2 o más personas)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Tipo de Historia</label>
                  <input
                    type="text"
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    placeholder="Ej. biografia_familiar, valores"
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs text-stone-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Días de Apertura (Copia de plantilla)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={newOpenDays}
                    onChange={(e) => setNewOpenDays(parseInt(e.target.value) || 15)}
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs text-stone-900"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Umbral de Suficiencia (Preguntas)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    value={newThreshold}
                    onChange={(e) => setNewThreshold(parseInt(e.target.value) || 100)}
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs text-stone-900"
                  />
                </div>
              </div>

              {/* Participants Section */}
              <div className="border-t border-stone-200 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="block font-bold text-stone-800">
                    Participantes de la Historia ({participantsList.length})
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setParticipantsList([
                        ...participantsList,
                        { name: '', relationship: 'Familiar', role: 'contributor', email: '' },
                      ])
                    }
                    className="text-amber-800 hover:text-amber-900 font-semibold text-[11px]"
                  >
                    + Agregar Participante
                  </button>
                </div>

                <div className="space-y-2">
                  {participantsList.map((p, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-stone-50 border border-stone-200 rounded-lg grid grid-cols-3 gap-2"
                    >
                      <div>
                        <label className="block text-[10px] text-stone-500">Nombre completo *</label>
                        <input
                          type="text"
                          required
                          value={p.name}
                          onChange={(e) => {
                            const updated = [...participantsList];
                            updated[idx].name = e.target.value;
                            setParticipantsList(updated);
                          }}
                          placeholder="Nombre"
                          className="w-full px-2 py-1.5 border border-stone-300 rounded text-xs"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-stone-500">Parentesco / Rol</label>
                        <input
                          type="text"
                          value={p.relationship}
                          onChange={(e) => {
                            const updated = [...participantsList];
                            updated[idx].relationship = e.target.value;
                            setParticipantsList(updated);
                          }}
                          placeholder="Ej. Padre, Madre, Hijo"
                          className="w-full px-2 py-1.5 border border-stone-300 rounded text-xs"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-stone-500">Rol</label>
                        <select
                          value={p.role}
                          onChange={(e) => {
                            const updated = [...participantsList];
                            updated[idx].role = e.target.value as any;
                            setParticipantsList(updated);
                          }}
                          className="w-full px-2 py-1.5 border border-stone-300 rounded text-xs"
                        >
                          <option value="primary">Titular</option>
                          <option value="contributor">Colaborador</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t border-stone-200">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-lg font-semibold"
                >
                  Crear Entrevista
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Extend Open Days */}
      {showExtendModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 shadow-xl border border-stone-200 text-xs space-y-4">
            <h3 className="font-serif text-base font-bold text-stone-900">
              Extender Periodo de Apertura
            </h3>
            <p className="text-stone-500">
              Entrevista: <strong>{showExtendModal.title}</strong>
            </p>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">
                Días naturales a sumar
              </label>
              <input
                type="number"
                min="1"
                max="180"
                value={extendDays}
                onChange={(e) => setExtendDays(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowExtendModal(null)}
                className="px-3 py-1.5 border border-stone-300 rounded-lg hover:bg-stone-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExtend}
                className="px-4 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg font-semibold"
              >
                Aplicar Extensión
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Reopen Interview & Book Editing */}
      {showReopenModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 shadow-xl border border-stone-200 text-xs space-y-4">
            <h3 className="font-serif text-base font-bold text-stone-900">
              Reabrir Cuestionario y Opciones de Edición del Libro
            </h3>
            <p className="text-stone-500">
              Entrevista: <strong>{showReopenModal.title}</strong>
            </p>
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-[11px] text-emerald-950 leading-relaxed">
              Al reabrir, el entrevistado podrá contestar o editar nuevamente su cuestionario y, al confirmar su cierre, volver a generar su libro en PDF. Las versiones de PDF antiguas se mantienen intactas y disponibles para descarga.
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">
                Días naturales para la reapertura
              </label>
              <input
                type="number"
                min="1"
                max="90"
                value={reopenDays}
                onChange={(e) => setReopenDays(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs"
              />
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">
                Opciones de edición de maquetación permitidas para el entrevistado
              </label>
              <input
                type="number"
                min="0"
                max="20"
                value={reopenLayoutEdits}
                onChange={(e) => setReopenLayoutEdits(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs"
              />
              <p className="text-[10px] text-stone-400 mt-1">
                Configura cuántas veces podrá el entrevistado editar la maquetación de su libro después de generarlo.
              </p>
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">
                Motivo de la reapertura (registrado en auditoría)
              </label>
              <textarea
                rows={2}
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                placeholder="Razón de reapertura..."
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowReopenModal(null)}
                className="px-3 py-1.5 border border-stone-300 rounded-lg hover:bg-stone-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleReopen}
                className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-semibold"
              >
                Confirmar Reapertura
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Libros PDF del Entrevistado & Cuota de Edición */}
      {bookStudioAdminTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-stone-200 text-xs space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-stone-200">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-amber-100 text-amber-800 rounded-xl">
                  <BookOpen className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-serif text-base font-bold text-stone-900">
                    Libros en PDF del Entrevistado &amp; Cuota de Edición
                  </h3>
                  <p className="text-[11px] text-stone-500">
                    Historia: <strong>{bookStudioAdminTarget.title}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBookStudioAdminTarget(null)}
                className="text-stone-400 hover:text-stone-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quota Configuration & Reopen Controls */}
            <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="font-bold text-stone-900 flex items-center space-x-1.5">
                    <Settings className="w-4 h-4 text-amber-700" />
                    <span>Configurar Opciones de Edición de Maquetación Permitidas</span>
                  </span>
                  <p className="text-[11px] text-stone-600 mt-0.5">
                    Define cuántas veces adicionales puede el entrevistado modificar la maquetación y generar una nueva versión de su libro en PDF.
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 font-bold text-[11px] shrink-0 self-start">
                  Usadas: {bookStudioAdminTarget.layoutEditsUsed || 0} • Restantes:{' '}
                  {computeLayoutEditQuotaStatus(bookStudioAdminTarget).remainingEdits}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <div className="flex items-center space-x-2">
                  <label className="text-stone-700 font-semibold">
                    Ediciones adicionales disponibles:
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="25"
                    value={quotaRemainingInput}
                    onChange={(e) =>
                      setQuotaRemainingInput(Math.max(0, parseInt(e.target.value) || 0))
                    }
                    className="w-20 px-2.5 py-1.5 border border-stone-300 rounded-lg text-xs font-bold text-stone-900 bg-white"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleSaveLayoutQuota}
                  disabled={savingQuota}
                  className="px-3.5 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg font-semibold transition disabled:opacity-50"
                >
                  {savingQuota ? 'Guardando...' : 'Actualizar Cuota de Maquetación'}
                </button>

                {(bookStudioAdminTarget.userDeclaredComplete ||
                  bookStudioAdminTarget.status === 'completed' ||
                  bookStudioAdminTarget.status === 'expired') && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = bookStudioAdminTarget;
                      setBookStudioAdminTarget(null);
                      setReopenLayoutEdits(Math.max(1, quotaRemainingInput));
                      setShowReopenModal(target);
                    }}
                    className="inline-flex items-center space-x-1 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-semibold transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reabrir Cuestionario y Maquetación</span>
                  </button>
                )}
              </div>
            </div>

            {/* Historical PDF Versions List */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="font-serif text-sm font-bold text-stone-900">
                  Historial de Versiones PDF Generadas ({bookStudioAdminTarget.bookVersions?.length || 0})
                </h4>
                {bookStudioAdminTarget.bookVersions && bookStudioAdminTarget.bookVersions.length > 0 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setBulkDeleteTarget({
                        kind: 'versions',
                        interview: bookStudioAdminTarget,
                        count: bookStudioAdminTarget.bookVersions?.length || 0,
                      })
                    }
                    className="inline-flex items-center space-x-1 px-2.5 py-1 bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 rounded-lg text-[11px] font-semibold transition"
                    title="Borrar todas las versiones PDF de este entrevistado (pide confirmación)"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Borrar todas</span>
                  </button>
                ) : (
                  <span className="text-[11px] text-stone-500">
                    Las versiones antiguas se conservan permanentemente
                  </span>
                )}
              </div>

              {!bookStudioAdminTarget.bookVersions ||
              bookStudioAdminTarget.bookVersions.length === 0 ? (
                <div className="p-8 bg-stone-50 rounded-xl border border-stone-200 text-center text-stone-500 space-y-1">
                  <BookOpen className="w-6 h-6 mx-auto text-stone-400 mb-1" />
                  <p className="font-semibold text-stone-700">
                    El entrevistado aún no ha generado su libro en PDF.
                  </p>
                  <p className="text-[11px]">
                    Una vez que el entrevistado confirme el cierre de su entrevista y configure su maquetación, todas las versiones generadas aparecerán aquí para descarga.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {bookStudioAdminTarget.bookVersions.map((ver, idx) => {
                    const narrativeObj = DEMO_NARRATIVE_STYLES.find(
                      (s) => s.id === ver.narrativeStyle
                    );
                    const coverObj = DEMO_COVER_DESIGNS.find(
                      (c) => c.id === ver.editorialConfig.coverDesignId
                    );
                    const interiorObj = DEMO_INTERIOR_STYLES.find(
                      (s) => s.id === ver.editorialConfig.interiorStyleId
                    );
                    const formatObj = DEMO_BOOK_FORMATS.find(
                      (f) => f.id === ver.editorialConfig.bookFormatId
                    );

                    return (
                      <div
                        key={ver.id}
                        className="p-3.5 bg-white rounded-xl border border-stone-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-amber-800 text-white font-bold text-[10px] uppercase">
                              Versión {ver.versionNumber}
                            </span>
                            {idx === 0 && (
                              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 font-semibold text-[10px]">
                                Más reciente
                              </span>
                            )}
                            <span className="font-serif font-bold text-stone-900 text-sm">
                              {ver.title || ver.manuscript.title}
                            </span>
                          </div>
                          <div className="text-[11px] text-stone-600 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span>
                              <strong>Estilo:</strong>{' '}
                              {narrativeObj?.individualTitle || ver.narrativeStyle}
                            </span>
                            <span>•</span>
                            <span>
                              <strong>Portada:</strong>{' '}
                              {coverObj?.name || ver.editorialConfig.coverDesignId}
                            </span>
                            <span>•</span>
                            <span>
                              <strong>Interior:</strong>{' '}
                              {interiorObj?.name || ver.editorialConfig.interiorStyleId}
                            </span>
                            <span>•</span>
                            <span>
                              <strong>Formato:</strong>{' '}
                              {formatObj?.name || ver.editorialConfig.bookFormatId}
                            </span>
                          </div>
                          <div className="text-[10px] text-stone-400">
                            Generado el {new Date(ver.createdAt).toLocaleString('es-MX')} por{' '}
                            {ver.participantName}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                          <button
                            type="button"
                            onClick={() =>
                              handleDownloadParticipantVersionPdf(bookStudioAdminTarget, ver)
                            }
                            disabled={downloadingPdfVersionId === ver.id}
                            className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
                          >
                            <Download className="w-3.5 h-3.5 text-amber-400" />
                            <span>
                              {downloadingPdfVersionId === ver.id
                                ? 'Generando PDF...'
                                : `Descargar PDF (v${ver.versionNumber})`}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              setVersionToDelete({
                                version: ver,
                                interview: bookStudioAdminTarget,
                              })
                            }
                            className="p-2 text-rose-600 hover:text-rose-800 hover:bg-rose-50 border border-rose-200 rounded-lg transition"
                            title="Eliminar este libro PDF maquetado permanentemente"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-stone-200">
              <button
                type="button"
                onClick={() => setBookStudioAdminTarget(null)}
                className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Share Participant Invitation */}
      {sharingData && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-stone-200 text-xs space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-stone-200">
              <div className="flex items-center space-x-2">
                <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
                  <Share2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-serif text-base font-bold text-stone-900">
                    Compartir Invitación con {sharingData.participant.name}
                  </h3>
                  <p className="text-[11px] text-stone-500">
                    Historia: <strong>{sharingData.interview.title}</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSharingData(null)}
                className="text-stone-400 hover:text-stone-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Access Code Box */}
            {sharingData.participant.accessCode && (
              <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-stone-700 flex items-center space-x-1">
                    <Key className="w-3.5 h-3.5 text-amber-700" />
                    <span>Código de Acceso Rápido (Recomendado para Móvil)</span>
                  </span>
                  <span className="text-[10px] text-stone-400">Sin cookies ni enlaces complejos</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="flex-1 bg-white border border-stone-300 rounded-lg p-2.5 font-mono text-center text-base font-bold text-stone-900 tracking-wider">
                    {sharingData.participant.accessCode}
                  </div>
                  <button
                    onClick={() => {
                      copyToClipboard(sharingData.participant.accessCode!);
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 3000);
                    }}
                    className="px-3 py-2.5 bg-stone-800 hover:bg-stone-900 text-white rounded-lg font-semibold transition"
                  >
                    {copiedCode ? '¡Copiado!' : 'Copiar Código'}
                  </button>
                </div>
                <p className="text-[10px] text-stone-500">
                  El participante solo entra a la página, teclea este código y comienza de inmediato.
                </p>
              </div>
            )}

            {/* Direct Public Link Box */}
            {sharingData.participant.plainToken && (
              <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 space-y-2">
                <span className="font-semibold text-stone-700 block">
                  Enlace Directo Público (con token seguro pre-cargado)
                </span>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    readOnly
                    value={getPublicShareUrl(sharingData.participant.plainToken)}
                    className="flex-1 bg-white border border-stone-300 rounded-lg px-2.5 py-2 font-mono text-[11px] text-stone-700 truncate"
                  />
                  <button
                    onClick={() => handleCopyLink(sharingData.participant.plainToken!)}
                    className="px-3 py-2 bg-white hover:bg-stone-100 border border-stone-300 text-stone-800 rounded-lg font-semibold transition"
                  >
                    {copiedToken === sharingData.participant.plainToken ? '¡Copiado!' : 'Copiar Enlace'}
                  </button>
                </div>
              </div>
            )}

            {/* WhatsApp Ready Message */}
            <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-2">
              <span className="font-semibold text-emerald-950 flex items-center space-x-1.5">
                <MessageCircle className="w-4 h-4 text-emerald-700" />
                <span>Mensaje listo para WhatsApp / SMS / Correo</span>
              </span>
              <p className="text-[11px] text-stone-600 bg-white p-3 rounded-lg border border-emerald-100 font-sans leading-relaxed whitespace-pre-line">
                {`Hola ${sharingData.participant.name}, te invito a participar en la historia de vida «${sharingData.interview.title}».

Puedes ingresar directamente desde este enlace:
${getPublicShareUrl(sharingData.participant.plainToken || '')}

O si lo prefieres, entra a la aplicación e ingresa tu código de acceso:
👉 ${sharingData.participant.accessCode || ''}

Tus recuerdos y testimonios serán preservados con total fidelidad para nuestra memoria familiar.`}
              </p>

              <button
                onClick={() => {
                  const message = `Hola ${sharingData.participant.name}, te invito a participar en la historia de vida «${sharingData.interview.title}».

Puedes ingresar directamente desde este enlace:
${getPublicShareUrl(sharingData.participant.plainToken || '')}

O si lo prefieres, entra a la aplicación e ingresa tu código de acceso:
👉 ${sharingData.participant.accessCode || ''}

Tus recuerdos y testimonios serán preservados con total fidelidad para nuestra memoria familiar.`;
                  copyToClipboard(message);
                  setCopiedMessage(true);
                  setTimeout(() => setCopiedMessage(false), 3000);
                }}
                className="w-full py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-semibold text-xs flex items-center justify-center space-x-1.5 transition shadow-xs"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedMessage ? '¡Mensaje Copiado al Portapapeles!' : 'Copiar Mensaje Completo para WhatsApp'}</span>
              </button>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSharingData(null)}
                className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 text-xs"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* V5.4.1 — Modal: confirm bulk delete (all PDF versions / all manuscripts of an interviewee) */}
      {bulkDeleteTarget && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          data-testid="bulk-delete-confirm"
        >
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl border-2 border-rose-200">
            <div className="flex items-center space-x-3 text-rose-600 mb-3">
              <div className="p-3 bg-rose-100 rounded-xl">
                <Trash2 className="w-6 h-6 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-900">
                  {bulkDeleteTarget.kind === 'versions'
                    ? `¿Borrar las ${bulkDeleteTarget.count} versiones del libro en PDF?`
                    : `¿Borrar los ${bulkDeleteTarget.count} manuscritos?`}
                </h3>
                <p className="text-xs text-rose-600 font-semibold">Esta acción no se puede deshacer</p>
              </div>
            </div>

            <div className="bg-stone-50 border border-stone-200 rounded-lg p-3.5 mb-4 text-xs space-y-1.5">
              <div className="font-serif font-bold text-stone-900 text-sm">{bulkDeleteTarget.interview.title}</div>
              <div className="text-[11px] text-stone-600">
                {bulkDeleteTarget.kind === 'versions'
                  ? 'Se borrarán todas las «Versiones de tu Libro en PDF Guardadas» de este entrevistado, de la base de datos y de su portal.'
                  : 'Se borrarán todos los manuscritos de este entrevistado de la base de datos.'}
              </div>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg mb-4 text-[11px] text-amber-950 space-y-1">
              {bulkDeleteTarget.kind === 'versions' ? (
                <>
                  <p>• Los manuscritos del entrevistado no se tocan.</p>
                  <p>• Los intentos de maquetación (cuota) no cambian; puedes ajustarlos en «Libros PDF &amp; Cuota».</p>
                  <p>• Los libros que se guarden después seguirán numerándose a partir de la última versión.</p>
                </>
              ) : (
                <>
                  <p>• Las versiones del libro en PDF guardadas no se tocan.</p>
                  <p>• Las respuestas, fotografías y audios del entrevistado no se tocan.</p>
                </>
              )}
            </div>

            <div className="flex justify-center items-center gap-3 pt-3 border-t border-stone-200">
              <button
                type="button"
                onClick={() => setBulkDeleteTarget(null)}
                disabled={bulkDeleting}
                className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmBulkDelete}
                disabled={bulkDeleting}
                className="px-4 py-2 bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition shadow-sm"
                data-testid="bulk-delete-confirm-button"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>
                  {bulkDeleting
                    ? 'Borrando...'
                    : bulkDeleteTarget.kind === 'versions'
                      ? 'Sí, borrar todas las versiones'
                      : 'Sí, borrar todos los manuscritos'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirm Delete Participant Book Version PDF */}
      {versionToDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl border-2 border-rose-200">
            <div className="flex items-center space-x-3 text-rose-600 mb-3">
              <div className="p-3 bg-rose-100 rounded-xl">
                <Trash2 className="w-6 h-6 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-900">
                  ¿Eliminar versión de libro PDF (v{versionToDelete.version.versionNumber})?
                </h3>
                <p className="text-xs text-rose-600 font-semibold">
                  Alerta: Esta versión se perderá permanentemente
                </p>
              </div>
            </div>

            <p className="text-xs text-stone-600 leading-relaxed mb-3">
              Estás a punto de eliminar de forma definitiva este libro PDF maquetado. Esta acción es útil para depurar pruebas de maquetación:
            </p>

            <div className="bg-stone-50 border border-stone-200 rounded-lg p-3.5 mb-4 text-xs space-y-1.5">
              <div className="font-serif font-bold text-stone-900 text-sm">
                {versionToDelete.version.title || versionToDelete.interview.title}
              </div>
              <div className="text-[11px] text-stone-600">
                <strong>Archivo:</strong> {versionToDelete.version.fileName || `YouForever_${versionToDelete.interview.id}_v${versionToDelete.version.versionNumber}.pdf`}
              </div>
              <div className="text-[11px] text-stone-600">
                <strong>Participante:</strong> {versionToDelete.version.participantName || versionToDelete.interview.title}
              </div>
              <div className="text-[10px] text-stone-400">
                Generado el: {new Date(versionToDelete.version.createdAt).toLocaleString('es-MX')}
              </div>
            </div>

            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg mb-4 text-[11px] text-rose-900 flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>
                <strong>Atención:</strong> El archivo PDF y su configuración maquetada se eliminarán permanentemente tanto de la base de datos como de la vista del participante.
              </span>
            </div>

            <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg mb-4">
              <label className="flex items-start space-x-2.5 cursor-pointer text-xs text-amber-950 font-medium select-none">
                <input
                  type="checkbox"
                  checked={restoreQuotaOnDelete}
                  onChange={(e) => setRestoreQuotaOnDelete(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded text-amber-700 border-amber-300 focus:ring-amber-500"
                />
                <div className="space-y-0.5">
                  <span className="font-bold text-stone-900">Restablecer 1 intento de edición de maquetación</span>
                  <p className="text-[11px] text-stone-600">
                    Si activas esta opción, el entrevistado recuperará 1 oportunidad adicional para volver a maquetar su libro en su portal.
                  </p>
                </div>
              </label>
            </div>

            <div className="flex justify-center items-center gap-3 pt-3 border-t border-stone-200">
              <button
                type="button"
                onClick={() => setVersionToDelete(null)}
                disabled={deletingVersion}
                className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteVersion}
                disabled={deletingVersion}
                className="px-4 py-2 bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition shadow-sm"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{deletingVersion ? 'Eliminando...' : 'Sí, eliminar PDF permanentemente'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirm Delete Interview */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl border-2 border-rose-200">
            <div className="flex items-center space-x-3 text-rose-600 mb-3">
              <div className="p-3 bg-rose-100 rounded-xl">
                <Trash2 className="w-6 h-6 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-900">
                  ¿Eliminar entrevista de la base de datos?
                </h3>
                <p className="text-xs text-rose-600 font-semibold">
                  Confirmación de eliminación definitiva
                </p>
              </div>
            </div>

            <p className="text-xs text-stone-600 leading-relaxed mb-3">
              Estás a punto de eliminar permanentemente la siguiente entrevista de la base de datos:
            </p>

            <div className="bg-stone-50 border border-stone-200 rounded-lg p-3.5 mb-4 text-xs space-y-2">
              <div className="font-serif font-bold text-stone-900 text-sm">{deleteTarget.title}</div>
              <div className="font-mono text-[11px] text-stone-500">ID: {deleteTarget.id}</div>
              <ul className="text-stone-600 list-disc list-inside space-y-1 pt-1 text-[11px]">
                <li>
                  <strong>{deleteTarget.participants.length}</strong> participante(s) invitado(s) y sus tokens de acceso.
                </li>
                <li>
                  <strong>{deleteTarget.answersCount}</strong> respuesta(s) registrada(s), audios y fotografías adjuntas.
                </li>
                {deleteTarget.manuscriptsCount !== undefined && deleteTarget.manuscriptsCount > 0 && (
                  <li>
                    <strong>{deleteTarget.manuscriptsCount}</strong> borrador(es) de manuscrito asociado(s).
                  </li>
                )}
              </ul>
            </div>

            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg mb-4 text-[11px] text-rose-800 flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>
                Esta acción no se puede deshacer. Todos los datos se borrarán permanentemente tanto del servidor como de Firestore.
              </span>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-stone-200">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={isProcessingAction}
                className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 text-xs font-medium"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleDeleteInterview(deleteTarget)}
                disabled={isProcessingAction}
                className="px-4 py-2 bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition shadow-sm"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isProcessingAction ? 'Eliminando...' : 'Confirmar Eliminación en Base de Datos'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirm Reset Interview to Beginning */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl border-2 border-amber-200">
            <div className="flex items-center space-x-3 text-amber-700 mb-3">
              <div className="p-3 bg-amber-100 rounded-xl">
                <RotateCcw className="w-6 h-6 text-amber-700" />
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-900">
                  ¿Restablecer entrevista al inicio?
                </h3>
                <p className="text-xs text-amber-700 font-semibold">
                  Confirmación previa requerida para eliminar respuestas previas
                </p>
              </div>
            </div>

            <p className="text-xs text-stone-600 leading-relaxed mb-3">
              Estás a punto de restablecer la historia <strong>«{resetTarget.title}»</strong> para que el entrevistado comience a responder desde el principio.
            </p>

            <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-3.5 mb-4 text-xs space-y-2">
              <p className="font-semibold text-amber-950">Al confirmar este restablecimiento:</p>
              <ul className="text-amber-900 list-disc list-inside space-y-1 text-[11px]">
                <li>
                  Se <strong>eliminarán de la base de datos</strong> todas las {resetTarget.answersCount} respuestas contestadas, grabaciones de voz y fotografías adjuntas.
                </li>
                <li>
                  El contador de preguntas respondidas volverá a <strong>0</strong> y el estado pasará a <strong>«Abierta»</strong>.
                </li>
                <li>
                  Los enlaces de invitación y códigos de acceso seguirán activos, permitiendo a los participantes empezar a contestar desde la primera pregunta.
                </li>
              </ul>
            </div>

            <div className="p-3 bg-stone-100 border border-stone-200 rounded-lg mb-4 text-[11px] text-stone-600 flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-stone-500 shrink-0 mt-0.5" />
              <span>
                Las respuestas anteriores se perderán definitivamente para permitir reiniciar el instrumento desde cero.
              </span>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-stone-200">
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                disabled={isProcessingAction}
                className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 text-xs font-medium"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleResetInterview(resetTarget)}
                disabled={isProcessingAction}
                className="px-4 py-2 bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition shadow-sm"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{isProcessingAction ? 'Restableciendo...' : 'Confirmar y Restablecer al Inicio'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal: Confirm Duplicate Interview */}
      {duplicateTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl border border-amber-200">
            <div className="flex items-center space-x-3 text-amber-800 mb-3">
              <div className="p-3 bg-amber-100 rounded-xl">
                <CopyPlus className="w-6 h-6 text-amber-800" />
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-900">
                  ¿Duplicar entrevista con nuevo código de acceso?
                </h3>
                <p className="text-xs text-amber-800 font-medium">
                  Copia fiel e independiente de {duplicateTarget.participants?.[0]?.name || duplicateTarget.title}
                </p>
              </div>
            </div>

            <div className="bg-stone-50 border border-stone-200 rounded-lg p-3.5 mb-4 text-xs space-y-1.5 text-stone-700">
              <p>
                Se duplicará íntegramente la entrevista <strong>«{duplicateTarget.title}»</strong> conservando:
              </p>
              <ul className="list-disc list-inside space-y-1 text-[11px] text-stone-600">
                <li>Todas las <strong>{duplicateTarget.answersCount}</strong> respuestas, audios y fotografías adjuntas.</li>
                <li>El consentimiento de privacidad activo y datos de entrega ya registrados.</li>
                <li>Las versiones de manuscrito/PDF previas y la cuota actual exacta.</li>
                <li>Se asignará un <strong>código de acceso nuevo</strong> manteniendo activos ambos códigos (original y copia).</li>
              </ul>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-stone-200">
              <button
                type="button"
                onClick={() => setDuplicateTarget(null)}
                disabled={duplicatingId === duplicateTarget.id}
                className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 text-xs font-medium"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleDuplicateInterview(duplicateTarget)}
                disabled={duplicatingId === duplicateTarget.id}
                className="px-4 py-2 bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition shadow-sm"
              >
                <CopyPlus className="w-3.5 h-3.5" />
                <span>{duplicatingId === duplicateTarget.id ? 'Duplicando...' : 'Confirmar Duplicación'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Datos de Registro por Entrevistado */}
      {registrationModalTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            data-testid="registration-data-modal"
            className="bg-white rounded-xl max-w-2xl w-full p-6 shadow-2xl border border-stone-200 max-h-[90vh] overflow-y-auto text-xs space-y-4"
          >
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-stone-200">
              <div className="flex items-start space-x-2.5">
                <div className="p-2 bg-amber-100 text-amber-800 rounded-lg shrink-0">
                  <ClipboardList className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-serif text-base font-bold text-stone-900">
                    Datos de registro — {registrationModalTarget.interview.title}
                  </h3>
                  <p className="text-[11px] text-stone-500 mt-0.5">
                    {registrationModalTarget.interview.storyMode === 'compartida'
                      ? 'Entrevista compartida: consulta y edita los datos individuales de cada participante por separado.'
                      : 'Consulta y edita todos los datos registrados por esta persona.'}{' '}
                    Se conservarán intactas sus respuestas, accesos y libros vinculados.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRegistrationModalTarget(null)}
                className="text-stone-400 hover:text-stone-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveRegistrationModal} className="space-y-4">
              <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Título de la historia *
                  </label>
                  <input
                    type="text"
                    required
                    data-testid="reg-modal-title-input"
                    value={regTitleDraft}
                    onChange={(e) => setRegTitleDraft(e.target.value)}
                    className="w-full px-3 py-1.5 border border-stone-300 rounded-lg text-xs text-stone-900 bg-white"
                  />
                </div>
                <div className="flex flex-col justify-center text-[11px] text-stone-600 space-y-0.5">
                  <div>
                    <strong>Origen:</strong>{' '}
                    {registrationModalTarget.interview.registrationSource === 'self_register_free'
                      ? 'Autorregistro público (/free)'
                      : 'Creación administrativa'}
                  </div>
                  <div>
                    <strong>Respuestas / Libros vinculados:</strong>{' '}
                    {registrationModalTarget.interview.answersCount} respuestas ·{' '}
                    {registrationModalTarget.interview.bookVersions?.length ||
                      registrationModalTarget.interview.bookVersionsCount ||
                      0}{' '}
                    PDF(s)
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {regParticipantDrafts.map((draft, idx) => {
                  const isFocused = draft.participantId === registrationModalTarget.focusedParticipantId;
                  return (
                    <div
                      key={draft.participantId}
                      data-testid={`reg-modal-participant-${draft.participantId}`}
                      className={`p-4 rounded-xl border space-y-3 ${
                        isFocused
                          ? 'bg-amber-50/40 border-amber-300'
                          : 'bg-stone-50/70 border-stone-200'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-stone-200/80">
                        <div className="flex items-center gap-2">
                          <span className="font-serif text-sm font-bold text-stone-900">
                            Participante {idx + 1}: {draft.name || 'Sin nombre'}
                          </span>
                          {isFocused && (
                            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold">
                              Ficha seleccionada
                            </span>
                          )}
                        </div>
                        {draft.accessCode && (
                          <span className="font-mono text-[11px] text-stone-600 bg-white px-2 py-0.5 rounded border border-stone-200 tabular-nums">
                            Acceso: {draft.accessCode}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block font-semibold text-stone-700 mb-1">
                            Nombre completo *
                          </label>
                          <input
                            type="text"
                            required
                            data-testid={`reg-modal-name-${idx}`}
                            value={draft.name}
                            onChange={(e) => {
                              const val = e.target.value;
                              setRegParticipantDrafts((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, name: val } : item))
                              );
                            }}
                            className="w-full px-2.5 py-1.5 border border-stone-300 rounded-lg text-xs text-stone-900 bg-white"
                          />
                        </div>

                        <div>
                          <label className="block font-semibold text-stone-700 mb-1">
                            Correo electrónico
                          </label>
                          <input
                            type="email"
                            data-testid={`reg-modal-email-${idx}`}
                            value={draft.email}
                            placeholder="Sin correo capturado"
                            onChange={(e) => {
                              const val = e.target.value;
                              setRegParticipantDrafts((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, email: val } : item))
                              );
                            }}
                            className="w-full px-2.5 py-1.5 border border-stone-300 rounded-lg text-xs text-stone-900 bg-white"
                          />
                        </div>

                        <div>
                          <label className="block font-semibold text-stone-700 mb-1">
                            Edad
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={125}
                            data-testid={`reg-modal-age-${idx}`}
                            value={draft.age}
                            placeholder="Sin edad capturada"
                            onChange={(e) => {
                              const val = e.target.value;
                              setRegParticipantDrafts((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, age: val } : item))
                              );
                            }}
                            className="w-full px-2.5 py-1.5 border border-stone-300 rounded-lg text-xs text-stone-900 bg-white tabular-nums"
                          />
                        </div>

                        <div>
                          <label className="block font-semibold text-stone-700 mb-1">
                            Ciudad
                          </label>
                          <input
                            type="text"
                            data-testid={`reg-modal-city-${idx}`}
                            value={draft.city}
                            placeholder="Sin ciudad capturada"
                            onChange={(e) => {
                              const val = e.target.value;
                              setRegParticipantDrafts((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, city: val } : item))
                              );
                            }}
                            className="w-full px-2.5 py-1.5 border border-stone-300 rounded-lg text-xs text-stone-900 bg-white"
                          />
                        </div>

                        <div>
                          <label className="block font-semibold text-stone-700 mb-1">
                            Parentesco / Vínculo
                          </label>
                          <input
                            type="text"
                            data-testid={`reg-modal-relationship-${idx}`}
                            value={draft.relationship}
                            onChange={(e) => {
                              const val = e.target.value;
                              setRegParticipantDrafts((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, relationship: val } : item
                                )
                              );
                            }}
                            className="w-full px-2.5 py-1.5 border border-stone-300 rounded-lg text-xs text-stone-900 bg-white"
                          />
                        </div>

                        <div>
                          <label className="block font-semibold text-stone-700 mb-1">
                            Rol en la entrevista
                          </label>
                          <select
                            data-testid={`reg-modal-role-${idx}`}
                            value={draft.role}
                            onChange={(e) => {
                              const val = e.target.value as 'primary' | 'contributor';
                              setRegParticipantDrafts((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, role: val } : item))
                              );
                            }}
                            className="w-full px-2.5 py-1.5 border border-stone-300 rounded-lg text-xs text-stone-900 bg-white"
                          >
                            <option value="primary">Titular</option>
                            <option value="contributor">Colaborador</option>
                          </select>
                        </div>
                      </div>

                      <div className="text-[10px] text-stone-500 pt-1">
                        <strong>Aviso de privacidad en registro:</strong>{' '}
                        {draft.privacyAcceptedAt
                          ? `Aceptado el ${new Date(draft.privacyAcceptedAt).toLocaleString('es-MX')}${
                              draft.privacyVersion ? ` (Versión ${draft.privacyVersion})` : ''
                            }`
                          : 'No capturado en el registro inicial'}
                      </div>
                    </div>
                  );
                })}
              </div>

              {regModalError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{regModalError}</span>
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-3 border-t border-stone-200">
                <button
                  type="button"
                  onClick={() => setRegistrationModalTarget(null)}
                  disabled={savingRegistration}
                  className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  data-testid="reg-modal-save-btn"
                  disabled={savingRegistration}
                  className="px-4 py-2 bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white rounded-lg font-semibold inline-flex items-center space-x-1.5 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savingRegistration ? 'Guardando...' : 'Guardar datos de registro'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
