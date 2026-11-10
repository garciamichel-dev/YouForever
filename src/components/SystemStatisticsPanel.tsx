import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BarChart3,
  RefreshCw,
  Download,
  Users,
  Sparkles,
  MessageSquare,
  BookOpen,
  FileText,
  Mic,
  Camera,
  ShieldCheck,
  KeyRound,
  Lock,
  AlertTriangle,
  CreditCard,
  Layers,
  Filter,
  CheckCircle2,
  Clock,
  Cpu,
} from 'lucide-react';

interface SystemStatisticsPanelProps {
  adminEmail: string | null;
  defaultScope?: 'all' | 'interviews' | 'mi_esencia' | 'qualitative';
}

const STAGE_LABELS: Record<string, string> = {
  infancia: '01. Infancia',
  juventud: '02. Juventud',
  adultez: '03. Adultez',
  madurez: '04. Madurez',
  legado_general: '05. Legado General',
};

function countWords(text?: string | null): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export const SystemStatisticsPanel: React.FC<SystemStatisticsPanelProps> = ({
  adminEmail,
  defaultScope = 'all',
}) => {
  const [payload, setPayload] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<string>('');

  // Interactive Filters
  const [activeScope, setActiveScope] = useState<'all' | 'interviews' | 'mi_esencia' | 'qualitative'>(
    defaultScope
  );
  const [selectedInterviewId, setSelectedInterviewId] = useState<string>('');
  const [selectedAvatarId, setSelectedAvatarId] = useState<string>('');

  const fetchStatistics = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/admin/system-statistics', {
          headers: {
            'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
          },
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || 'No se pudieron cargar las estadísticas del sistema.');
        }
        setPayload(json.data);
        setLastSyncedAt(new Date().toLocaleTimeString('es-MX'));
      } catch (err: any) {
        setError(err?.message || 'Error de red al sincronizar estadísticas.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [adminEmail]
  );

  useEffect(() => {
    fetchStatistics(false);
  }, [fetchStatistics]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      fetchStatistics(true);
    }, 12000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchStatistics]);

  // Derived & Filtered Data
  const stats = useMemo(() => {
    if (!payload) return null;
    const core = payload.core || {};
    const me = payload.miEsencia || {};

    const allInterviews: any[] = core.interviews || [];
    const allParticipants: any[] = core.participants || [];
    const allTokens: any[] = core.tokens || [];
    const allQuestions: any[] = core.questions || [];
    const allAnswers: any[] = core.answers || [];
    const allManuscripts: any[] = core.manuscripts || [];
    const allBookVersions: any[] = core.bookVersions || [];
    const allConsents: any[] = core.privacyConsents || [];
    const allBookShares: any[] = core.bookShares || [];
    const allScheduledDeliveries: any[] = core.scheduledDeliveries || [];
    const allSecondaryAccess: any[] = core.secondaryAccess || [];
    const allPostMortem: any[] = core.postMortemInstructions || [];
    const allArcoRequests: any[] = core.arcoRequests || [];

    const allSubscriptions: any[] = me.subscriptions || [];
    const allPersons: any[] = me.persons || [];
    const allCompilationPdfs: any[] = me.compilationPdfs || [];
    const allTestimonies: any[] = me.testimonies || [];
    const allRelations: any[] = me.relations || [];
    const allInterlocutors: any[] = me.interlocutors || [];
    const allCredentials: any[] = me.credentials || [];
    const allMemories: any[] = me.memories || [];
    const allContradictions: any[] = me.contradictions || [];
    const allPayments: any[] = me.payments || [];
    const allCoupons: any[] = me.coupons || [];
    const allSnapshots: any[] = me.snapshots || [];
    const allConversations: any[] = me.conversations || [];
    const allNotifications: any[] = me.notifications || [];
    const allPlans: any[] = me.plans || [];
    const allPromptLibrary: any[] = me.promptLibrary || [];
    const allPromptVersions: any[] = me.avatarPromptVersions || [];
    const allFallbackLogs: any[] = me.fallbackLogs || [];

    // Apply Interview Filter
    const filteredInterviews = selectedInterviewId
      ? allInterviews.filter((i) => i.id === selectedInterviewId)
      : allInterviews;
    const filteredInterviewIds = new Set(filteredInterviews.map((i) => i.id));

    const filteredParticipants = allParticipants.filter((p) =>
      filteredInterviewIds.has(p.interviewId)
    );
    const filteredTokens = allTokens.filter((t) => filteredInterviewIds.has(t.interviewId));
    const filteredAnswers = allAnswers.filter((a) => filteredInterviewIds.has(a.interviewId));
    const filteredManuscripts = allManuscripts.filter((m) =>
      filteredInterviewIds.has(m.interviewId)
    );
    const filteredBookVersions = allBookVersions.filter((b) =>
      filteredInterviewIds.has(b.interviewId)
    );
    const filteredConsents = allConsents.filter((c) => filteredInterviewIds.has(c.interviewId));
    const filteredBookShares = allBookShares.filter((s) =>
      filteredInterviewIds.has(s.interviewId)
    );
    const filteredScheduled = allScheduledDeliveries.filter((s) =>
      filteredInterviewIds.has(s.interviewId)
    );
    const filteredPostMortem = allPostMortem.filter((p) =>
      filteredInterviewIds.has(p.interviewId)
    );
    const filteredArco = allArcoRequests.filter((a) => filteredInterviewIds.has(a.interviewId));

    // Apply Avatar Filter for Mi Esencia
    const filteredSubscriptions = selectedAvatarId
      ? allSubscriptions.filter((s) => s.avatarId === selectedAvatarId)
      : allSubscriptions;
    const filteredAvatarIds = new Set(filteredSubscriptions.map((s) => s.avatarId));

    const filteredPersons = allPersons.filter((p) => filteredAvatarIds.has(p.avatarId));
    const filteredPdfs = allCompilationPdfs.filter(
      (pdf) => !selectedAvatarId || filteredAvatarIds.has(pdf.avatarId)
    );
    const filteredTestimonies = allTestimonies.filter((t) => filteredAvatarIds.has(t.avatarId));
    const filteredRelations = allRelations.filter((r) => filteredAvatarIds.has(r.avatarId));
    const filteredInterlocutors = allInterlocutors.filter((i) =>
      filteredAvatarIds.has(i.avatarId)
    );
    const filteredCredentials = allCredentials.filter((c) => filteredAvatarIds.has(c.avatarId));
    const filteredMemories = allMemories.filter((m) => filteredAvatarIds.has(m.avatarId));
    const filteredContradictions = allContradictions.filter((c) =>
      filteredAvatarIds.has(c.avatarId)
    );
    const filteredSnapshots = allSnapshots.filter((s) => filteredAvatarIds.has(s.avatarId));
    const filteredConversations = allConversations.filter((c) =>
      filteredAvatarIds.has(c.avatarId)
    );
    const filteredPayments = allPayments.filter(
      (p) => !selectedAvatarId || filteredAvatarIds.has(p.avatarId)
    );
    const filteredNotifications = allNotifications.filter(
      (n) => !selectedAvatarId || filteredAvatarIds.has(n.avatarId)
    );
    const filteredFallbackLogs = allFallbackLogs.filter(
      (f) => !selectedAvatarId || filteredAvatarIds.has(f.avatarId)
    );

    // 1. Quantitative Breakdown: Interviews & Answers
    const individualInterviews = filteredInterviews.filter(
      (i) => i.storyMode !== 'compartida'
    ).length;
    const coupleInterviews = filteredInterviews.filter(
      (i) => i.storyMode === 'compartida'
    ).length;
    const completedInterviews = filteredInterviews.filter(
      (i) => i.userDeclaredComplete || i.status === 'completed' || i.sufficiencyReached
    ).length;
    const reopenedInterviews = filteredInterviews.filter((i) => Boolean(i.reopenedAt)).length;

    const mainAnswers = filteredAnswers.filter(
      (a) => !a.isFollowUp && !a.isAdditionalMemory && !a.notRecalled
    );
    const followUpAnswers = filteredAnswers.filter((a) => Boolean(a.isFollowUp));
    const additionalMemories = filteredAnswers.filter((a) => Boolean(a.isAdditionalMemory));
    const omittedAnswers = filteredAnswers.filter((a) => Boolean(a.notRecalled));

    const completedAnswersTotal =
      mainAnswers.length + followUpAnswers.length + additionalMemories.length;

    let totalAnswerWords = 0;
    let totalAttachedPhotos = 0;
    let totalAttachedAudios = 0;
    const deepeningReasonsCount: Record<string, number> = {};

    for (const ans of filteredAnswers) {
      if (!ans.notRecalled) {
        totalAnswerWords += countWords(ans.answerText);
      }
      if (Array.isArray(ans.photos)) {
        totalAttachedPhotos += ans.photos.length;
      }
      if (ans.audio) {
        totalAttachedAudios += 1;
      }
      if (ans.deepeningReason && typeof ans.deepeningReason === 'string') {
        const cleanReason = ans.deepeningReason.trim();
        if (cleanReason) {
          deepeningReasonsCount[cleanReason] = (deepeningReasonsCount[cleanReason] || 0) + 1;
        }
      }
    }

    const avgWordsPerAnswer =
      completedAnswersTotal > 0 ? Math.round(totalAnswerWords / completedAnswersTotal) : 0;

    // Breakdown by Life Stage
    const questionStageMap = new Map<string, string>();
    for (const q of allQuestions) {
      questionStageMap.set(q.id, q.stage || 'legado_general');
    }

    const stageStats: Record<
      string,
      {
        stageId: string;
        label: string;
        bankQuestionsCount: number;
        answersCount: number;
        followUpsCount: number;
        photosCount: number;
        audiosCount: number;
        totalWords: number;
        avgWords: number;
      }
    > = {};

    for (const [stageId, label] of Object.entries(STAGE_LABELS)) {
      stageStats[stageId] = {
        stageId,
        label,
        bankQuestionsCount: allQuestions.filter((q) => q.stage === stageId && q.active !== false)
          .length,
        answersCount: 0,
        followUpsCount: 0,
        photosCount: 0,
        audiosCount: 0,
        totalWords: 0,
        avgWords: 0,
      };
    }

    for (const ans of filteredAnswers) {
      if (ans.notRecalled) continue;
      const baseQId = ans.parentQuestionId || ans.questionId;
      const stageId = questionStageMap.get(baseQId) || 'legado_general';
      const bucket = stageStats[stageId] || stageStats['legado_general'];
      if (!bucket) continue;
      bucket.answersCount += 1;
      if (ans.isFollowUp) bucket.followUpsCount += 1;
      if (Array.isArray(ans.photos)) bucket.photosCount += ans.photos.length;
      if (ans.audio) bucket.audiosCount += 1;
      bucket.totalWords += countWords(ans.answerText);
    }

    for (const bucket of Object.values(stageStats)) {
      bucket.avgWords =
        bucket.answersCount > 0 ? Math.round(bucket.totalWords / bucket.answersCount) : 0;
    }

    // 2. Quantitative Breakdown: Mi Esencia Conversations & Messages
    let totalMessagesInConversations = 0;
    let familyUserMessagesCount = 0;
    let avatarAiMessagesCount = 0;
    let totalConversationWords = 0;
    const messageClassificationCounts: Record<string, number> = {};

    for (const conv of filteredConversations) {
      const msgs: any[] = conv.messages || [];
      totalMessagesInConversations += msgs.length;
      for (const m of msgs) {
        totalConversationWords += countWords(m.text);
        if (m.sender === 'interlocutor') {
          familyUserMessagesCount += 1;
        } else {
          avatarAiMessagesCount += 1;
        }
        if (m.classification) {
          messageClassificationCounts[m.classification] =
            (messageClassificationCounts[m.classification] || 0) + 1;
        }
      }
    }

    const messagesSentTodayTotal = filteredInterlocutors.reduce(
      (acc, i) => acc + Math.max(0, Number(i.messagesSentToday || 0)),
      0
    );
    const messagesUsedThisMonthTotal = filteredSubscriptions.reduce(
      (acc, s) => acc + Math.max(0, Number(s.messagesUsedThisMonth || 0)),
      0
    );
    const tokensEstimatedThisMonthTotal = filteredSubscriptions.reduce(
      (acc, s) => acc + Math.max(0, Number(s.tokensEstimatedThisMonth || 0)),
      0
    );

    // Total effective messages sent in Mi Esencia (max between persisted session messages and monthly counters)
    const totalMiEsenciaMessagesSent = Math.max(
      totalMessagesInConversations,
      messagesUsedThisMonthTotal
    );

    const activeSubscriptionsCount = filteredSubscriptions.filter(
      (s) => s.status === 'activo' || s.status === 'cortesia'
    ).length;
    const pausedOrExpiredSubscriptionsCount =
      filteredSubscriptions.length - activeSubscriptionsCount;

    const activeCredentialsCount = filteredCredentials.filter(
      (c) => c.status === 'activo'
    ).length;
    const revokedCredentialsCount = filteredCredentials.length - activeCredentialsCount;

    // Memories Level A, B, C
    const levelATestimoniesCount = filteredTestimonies.length;
    const levelBMemories = filteredMemories.filter(
      (m) => m.privacyLevel === 'familiar_compartido' && m.verificationState !== 'revocado'
    );
    const levelCMemories = filteredMemories.filter(
      (m) => m.privacyLevel === 'privado_interlocutor' && m.verificationState !== 'revocado'
    );
    const revokedMemoriesCount = filteredMemories.filter(
      (m) => m.verificationState === 'revocado'
    ).length;

    const openContradictionsCount = filteredContradictions.filter(
      (c) => c.status === 'abierta'
    ).length;
    const resolvedContradictionsCount = filteredContradictions.filter(
      (c) => c.status === 'resuelta'
    ).length;

    // Payments & Revenue
    const totalRevenueMxn = filteredPayments
      .filter((p) => p.status === 'pagado')
      .reduce((acc, p) => acc + Number(p.amountMxn || 0), 0);

    // Relationships distribution in Mi Esencia
    const relationshipCounts: Record<string, number> = {};
    for (const inter of filteredInterlocutors) {
      const rel = (inter.relationshipToPerson || 'Familiar').trim();
      relationshipCounts[rel] = (relationshipCounts[rel] || 0) + 1;
    }

    // Book Styles & Formats Distribution
    const narrativeStyleCounts: Record<string, number> = {};
    const bookFormatCounts: Record<string, number> = {};
    const coverDesignCounts: Record<string, number> = {};

    for (const bv of filteredBookVersions) {
      const nStyle = bv.narrativeStyle || bv.editorialConfig?.narrativeStyle || 'first_person_literary';
      narrativeStyleCounts[nStyle] = (narrativeStyleCounts[nStyle] || 0) + 1;
      const fmt = bv.editorialConfig?.bookFormatId || '6x9';
      bookFormatCounts[fmt] = (bookFormatCounts[fmt] || 0) + 1;
      const cov = bv.editorialConfig?.coverDesignId || 'clasica_eterna';
      coverDesignCounts[cov] = (coverDesignCounts[cov] || 0) + 1;
    }

    // Per-Interview Detailed Table Rows
    const interviewRows = filteredInterviews.map((intv) => {
      const parts = allParticipants.filter((p) => p.interviewId === intv.id);
      const toks = allTokens.filter((t) => t.interviewId === intv.id && !t.revoked);
      const intvAnswers = allAnswers.filter((a) => a.interviewId === intv.id && !a.notRecalled);
      const mainCount = intvAnswers.filter((a) => !a.isFollowUp && !a.isAdditionalMemory).length;
      const followCount = intvAnswers.filter((a) => a.isFollowUp).length;
      const extraCount = intvAnswers.filter((a) => a.isAdditionalMemory).length;
      const wordsCount = intvAnswers.reduce((acc, a) => acc + countWords(a.answerText), 0);
      const photosCount = intvAnswers.reduce(
        (acc, a) => acc + (Array.isArray(a.photos) ? a.photos.length : 0),
        0
      );
      const audiosCount = intvAnswers.reduce((acc, a) => acc + (a.audio ? 1 : 0), 0);
      const booksCount = allBookVersions.filter((b) => b.interviewId === intv.id).length;
      const manuscriptsCount = allManuscripts.filter((m) => m.interviewId === intv.id).length;
      const linkedSub = allSubscriptions.find((s) => s.sourceInterviewId === intv.id);

      return {
        id: intv.id,
        title: intv.title,
        storyMode: intv.storyMode,
        status: intv.userDeclaredComplete
          ? 'Cerrada voluntariamente'
          : intv.sufficiencyReached
          ? 'Suficiencia alcanzada'
          : intv.status,
        participantsNames: parts.map((p) => p.name).join(' y '),
        accessCodes: toks.map((t) => t.accessCode).filter(Boolean).join(', '),
        totalCompletedAnswers: intvAnswers.length,
        mainCount,
        followCount,
        extraCount,
        wordsCount,
        photosCount,
        audiosCount,
        booksCount,
        manuscriptsCount,
        closingText: intv.participantClosingText || '',
        hasAvatar: Boolean(linkedSub),
        avatarName: linkedSub?.avatarDisplayName || '—',
      };
    });

    // Per-Avatar Detailed Table Rows
    const avatarRows = filteredSubscriptions.map((sub) => {
      const persons = allPersons.filter((p) => p.avatarId === sub.avatarId);
      const creds = allCredentials.filter((c) => c.avatarId === sub.avatarId);
      const inters = allInterlocutors.filter((i) => i.avatarId === sub.avatarId);
      const convs = allConversations.filter((c) => c.avatarId === sub.avatarId);
      const totalMsgsInSessions = convs.reduce(
        (acc, c) => acc + (Array.isArray(c.messages) ? c.messages.length : 0),
        0
      );
      const userMsgsInSessions = convs.reduce(
        (acc, c) =>
          acc +
          (Array.isArray(c.messages)
            ? c.messages.filter((m: any) => m.sender === 'interlocutor').length
            : 0),
        0
      );
      const avatarMsgsInSessions = totalMsgsInSessions - userMsgsInSessions;
      const usedToday = inters.reduce(
        (acc, i) => acc + Math.max(0, Number(i.messagesSentToday || 0)),
        0
      );
      const testimoniesCount = allTestimonies.filter((t) => t.avatarId === sub.avatarId).length;
      const memBCount = allMemories.filter(
        (m) =>
          m.avatarId === sub.avatarId &&
          m.privacyLevel === 'familiar_compartido' &&
          m.verificationState !== 'revocado'
      ).length;
      const memCCount = allMemories.filter(
        (m) =>
          m.avatarId === sub.avatarId &&
          m.privacyLevel === 'privado_interlocutor' &&
          m.verificationState !== 'revocado'
      ).length;
      const primaryPerson = persons[0];

      return {
        avatarId: sub.avatarId,
        avatarDisplayName: sub.avatarDisplayName,
        planName: sub.planName,
        status: sub.status,
        expiresAt: sub.expiresAt,
        provider: primaryPerson?.aiConfig?.primaryProvider || 'gemini',
        model:
          primaryPerson?.aiConfig?.primaryProvider === 'openai'
            ? primaryPerson?.aiConfig?.openAiModel || 'gpt-4o'
            : primaryPerson?.aiConfig?.geminiModel || 'gemini-3-flash-preview',
        spontaneityLevel: primaryPerson?.spontaneityLevel || 'moderado',
        emotionalStyle: primaryPerson?.emotionalStyleSummary || 'Cálido, reflexivo y familiar',
        interlocutorsCount: inters.length,
        activeCodes: creds
          .filter((c) => c.status === 'activo')
          .map((c) => c.personalCodePlain)
          .join(', '),
        conversationsCount: convs.length,
        totalSessionMessages: totalMsgsInSessions,
        userMsgsInSessions,
        avatarMsgsInSessions,
        usedToday,
        usedThisMonth: sub.messagesUsedThisMonth || 0,
        monthlyQuota: sub.monthlyMessageQuota || 1000,
        tokensEstimated: sub.tokensEstimatedThisMonth || 0,
        testimoniesCount,
        memBCount,
        memCCount,
      };
    });

    return {
      allInterviews,
      allSubscriptions,
      // Top KPIs
      totalAvatars: filteredSubscriptions.length,
      activeSubscriptionsCount,
      pausedOrExpiredSubscriptionsCount,
      totalInterviews: filteredInterviews.length,
      individualInterviews,
      coupleInterviews,
      completedInterviews,
      reopenedInterviews,
      completedAnswersTotal,
      mainAnswersCount: mainAnswers.length,
      followUpAnswersCount: followUpAnswers.length,
      additionalMemoriesCount: additionalMemories.length,
      omittedAnswersCount: omittedAnswers.length,
      totalConversations: filteredConversations.length,
      totalMiEsenciaMessagesSent,
      totalMessagesInConversations,
      familyUserMessagesCount,
      avatarAiMessagesCount,
      messagesSentTodayTotal,
      messagesUsedThisMonthTotal,
      tokensEstimatedThisMonthTotal,
      totalConversationWords,
      totalAnswerWords,
      avgWordsPerAnswer,
      totalPhotos: Math.max(core.photosCount || 0, totalAttachedPhotos),
      totalAudios: Math.max(core.audiosCount || 0, totalAttachedAudios),
      totalParticipants: filteredParticipants.length,
      totalActiveInterviewCodes: filteredTokens.filter((t) => !t.revoked).length,
      totalRevokedInterviewCodes: filteredTokens.filter((t) => Boolean(t.revoked)).length,
      totalQuestionsInBank: allQuestions.filter((q) => q.active !== false).length,
      totalManuscripts: filteredManuscripts.length,
      totalBookVersions: filteredBookVersions.length,
      totalConsents: filteredConsents.filter((c) => c.status === 'active').length,
      totalBookShares: filteredBookShares.length,
      totalScheduledDeliveries: filteredScheduled.length,
      totalSecondaryAccess: allSecondaryAccess.length,
      totalPostMortem: filteredPostMortem.filter((p) => p.status === 'active').length,
      totalArcoRequests: filteredArco.length,
      totalAuditLogs: core.auditLogsCount || 0,
      // Mi Esencia specific counts
      totalPersonsProfiles: filteredPersons.length,
      totalCompilationPdfs: filteredPdfs.length,
      levelATestimoniesCount,
      levelBMemoriesCount: levelBMemories.length,
      levelCMemoriesCount: levelCMemories.length,
      revokedMemoriesCount,
      totalInterlocutors: filteredInterlocutors.length,
      activeCredentialsCount,
      revokedCredentialsCount,
      totalRelationsExtracted: filteredRelations.length,
      openContradictionsCount,
      resolvedContradictionsCount,
      totalSnapshots: filteredSnapshots.length,
      totalRevenueMxn,
      totalPaymentsCount: filteredPayments.length,
      totalPlansCount: allPlans.length,
      totalCouponsCount: allCoupons.length,
      totalNotificationsCount: filteredNotifications.length,
      totalPromptLibraryCount: allPromptLibrary.length,
      totalPromptVersionsCount: allPromptVersions.length,
      totalFallbackLogsCount: filteredFallbackLogs.length,
      // Breakdowns & Qualitative
      stageStats: Object.values(stageStats),
      deepeningReasons: Object.entries(deepeningReasonsCount).sort((a, b) => b[1] - a[1]),
      relationshipCounts: Object.entries(relationshipCounts).sort((a, b) => b[1] - a[1]),
      messageClassificationCounts: Object.entries(messageClassificationCounts).sort(
        (a, b) => b[1] - a[1]
      ),
      narrativeStyleCounts: Object.entries(narrativeStyleCounts),
      bookFormatCounts: Object.entries(bookFormatCounts),
      coverDesignCounts: Object.entries(coverDesignCounts),
      interviewRows,
      avatarRows,
      levelBMemories,
      levelCMemories,
      filteredConversations,
      filteredPersons,
    };
  }, [payload, selectedInterviewId, selectedAvatarId]);

  const handleExportJson = () => {
    if (!stats) return;
    const report = {
      exportedAt: new Date().toISOString(),
      filterInterviewId: selectedInterviewId || 'ALL',
      filterAvatarId: selectedAvatarId || 'ALL',
      summary: {
        totalAvatars: stats.totalAvatars,
        totalInterviews: stats.totalInterviews,
        completedAnswersTotal: stats.completedAnswersTotal,
        totalConversationsInMiEsencia: stats.totalConversations,
        totalMessagesSentInMiEsencia: stats.totalMiEsenciaMessagesSent,
        familyUserMessagesCount: stats.familyUserMessagesCount,
        avatarAiMessagesCount: stats.avatarAiMessagesCount,
        messagesSentTodayTotal: stats.messagesSentTodayTotal,
        messagesUsedThisMonthTotal: stats.messagesUsedThisMonthTotal,
        tokensEstimatedThisMonthTotal: stats.tokensEstimatedThisMonthTotal,
        totalAnswerWords: stats.totalAnswerWords,
        totalPhotos: stats.totalPhotos,
        totalAudios: stats.totalAudios,
        totalBookVersions: stats.totalBookVersions,
        totalManuscripts: stats.totalManuscripts,
        levelATestimoniesCount: stats.levelATestimoniesCount,
        levelBMemoriesCount: stats.levelBMemoriesCount,
        levelCMemoriesCount: stats.levelCMemoriesCount,
        totalRevenueMxn: stats.totalRevenueMxn,
      },
      stageBreakdown: stats.stageStats,
      interviewsDetail: stats.interviewRows,
      avatarsDetail: stats.avatarRows,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `YouForever_Estadisticas_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    if (!stats) return;
    const lines: string[] = [
      'CATEGORIA,INDICADOR,VALOR',
      `Global,Avatares en Mi Esencia,${stats.totalAvatars}`,
      `Global,Suscripciones Activas,${stats.activeSubscriptionsCount}`,
      `Global,Entrevistas Totales,${stats.totalInterviews}`,
      `Global,Entrevistas Individuales,${stats.individualInterviews}`,
      `Global,Entrevistas en Pareja,${stats.coupleInterviews}`,
      `Global,Respuestas Completadas Totales,${stats.completedAnswersTotal}`,
      `Global,Respuestas Principales,${stats.mainAnswersCount}`,
      `Global,Profundizaciones IA,${stats.followUpAnswersCount}`,
      `Global,Memorias Adicionales Libres,${stats.additionalMemoriesCount}`,
      `Global,Palabras Narradas en Entrevistas,${stats.totalAnswerWords}`,
      `Global,Promedio Palabras por Respuesta,${stats.avgWordsPerAnswer}`,
      `Global,Fotografias Historicas,${stats.totalPhotos}`,
      `Global,Grabaciones de Voz,${stats.totalAudios}`,
      `Global,Versiones de Libros Maquetados,${stats.totalBookVersions}`,
      `Global,Borradores de Manuscritos,${stats.totalManuscripts}`,
      `Mi Esencia,Conversaciones Totales,${stats.totalConversations}`,
      `Mi Esencia,Mensajes Totales Enviados,${stats.totalMiEsenciaMessagesSent}`,
      `Mi Esencia,Mensajes de Familiares (Interlocutor),${stats.familyUserMessagesCount}`,
      `Mi Esencia,Respuestas del Avatar IA,${stats.avatarAiMessagesCount}`,
      `Mi Esencia,Mensajes Enviados Hoy,${stats.messagesSentTodayTotal}`,
      `Mi Esencia,Mensajes del Mes Actual,${stats.messagesUsedThisMonthTotal}`,
      `Mi Esencia,Tokens IA Estimados del Mes,${stats.tokensEstimatedThisMonthTotal}`,
      `Mi Esencia,Testimonios Nivel A (Inmutable),${stats.levelATestimoniesCount}`,
      `Mi Esencia,Memorias Nivel B (Familiar),${stats.levelBMemoriesCount}`,
      `Mi Esencia,Memorias Nivel C (Privado),${stats.levelCMemoriesCount}`,
      `Mi Esencia,Familiares Registrados,${stats.totalInterlocutors}`,
      `Mi Esencia,Codigos YF-XXXXX Activos,${stats.activeCredentialsCount}`,
      `Mi Esencia,Ingresos Acumulados MXN,${stats.totalRevenueMxn}`,
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `YouForever_Estadisticas_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading && !stats) {
    return (
      <div className="bg-white rounded-2xl border border-stone-200 p-10 text-center space-y-3">
        <RefreshCw className="w-6 h-6 animate-spin text-amber-700 mx-auto" />
        <p className="text-sm text-stone-600 font-medium">
          Recopilando estadísticas cuantitativas y cualitativas de todo el sistema...
        </p>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="bg-rose-50 rounded-2xl border border-rose-200 p-6 text-rose-900 text-xs flex items-center justify-between">
        <span>{error}</span>
        <button
          onClick={() => fetchStatistics(false)}
          className="px-3 py-1.5 rounded-lg bg-rose-800 text-white font-semibold cursor-pointer"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-6" data-testid="system-statistics-panel">
      {/* Header & Real-Time Controls */}
      <div className="bg-stone-900 text-stone-100 rounded-2xl p-6 shadow-md border border-stone-800 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-amber-400 text-xs font-semibold uppercase tracking-wider">
              <BarChart3 className="w-4 h-4" />
              <span>Centro Integral de Estadísticas en Tiempo Real • YouForever</span>
            </div>
            <h2 className="text-2xl font-serif font-bold text-white">
              Estadísticas Cuantitativas y Cualitativas del Sistema
            </h2>
            <p className="text-xs text-stone-300 max-w-3xl">
              Monitoreo vivo de todas las entrevistas biográficas, respuestas completadas, audios, fotografías, libros maquetados, avatares activos en Mi Esencia, conversaciones familiares, mensajes enviados, memorias Niveles A/B/C y análisis cualitativo.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <label className="px-3 py-1.5 rounded-xl bg-stone-800 border border-stone-700 text-xs text-stone-200 flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="accent-amber-500"
              />
              <span>Auto-actualizar (12s)</span>
            </label>

            <button
              type="button"
              onClick={() => fetchStatistics(false)}
              className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-stone-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Actualizar Ahora</span>
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-100 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              <span>Exportar CSV</span>
            </button>

            <button
              type="button"
              onClick={handleExportJson}
              className="px-3 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-100 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              <span>Exportar JSON</span>
            </button>
          </div>
        </div>

        {/* Filter & View Selector Bar */}
        <div className="pt-4 border-t border-stone-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ['all', 'Vista Global Completa'],
                ['interviews', 'Entrevistas, Respuestas y Libros'],
                ['mi_esencia', 'Mi Esencia, Avatares y Mensajes'],
                ['qualitative', 'Análisis Cualitativo Profundo'],
              ] as Array<['all' | 'interviews' | 'mi_esencia' | 'qualitative', string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveScope(id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  activeScope === id
                    ? 'bg-amber-700 text-white'
                    : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-stone-400">Entrevista:</span>
              <select
                value={selectedInterviewId}
                onChange={(e) => setSelectedInterviewId(e.target.value)}
                className="px-2.5 py-1 rounded-lg bg-stone-800 border border-stone-700 text-stone-100 text-xs"
              >
                <option value="">Todas ({stats.allInterviews.length})</option>
                {stats.allInterviews.map((intv: any) => (
                  <option key={intv.id} value={intv.id}>
                    {intv.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-stone-400">Avatar Mi Esencia:</span>
              <select
                value={selectedAvatarId}
                onChange={(e) => setSelectedAvatarId(e.target.value)}
                className="px-2.5 py-1 rounded-lg bg-stone-800 border border-stone-700 text-stone-100 text-xs"
              >
                <option value="">Todos ({stats.allSubscriptions.length})</option>
                {stats.allSubscriptions.map((sub: any) => (
                  <option key={sub.avatarId} value={sub.avatarId}>
                    {sub.avatarDisplayName}
                  </option>
                ))}
              </select>
            </div>

            {lastSyncedAt && (
              <span className="text-[11px] text-stone-400 ml-1">
                Sincronizado: {lastSyncedAt}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 1: TOP EXECUTIVE QUANTITATIVE KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-xs text-stone-500 font-semibold">
            <span>1. Avatares en Mi Esencia</span>
            <Sparkles className="w-4 h-4 text-amber-700" />
          </div>
          <p className="text-3xl font-serif font-bold text-stone-900 tabular-nums">
            {stats.totalAvatars}
          </p>
          <p className="text-[11px] text-emerald-800 font-medium">
            {stats.activeSubscriptionsCount} vigentes • {stats.totalPersonsProfiles} perfil(es) biográficos
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-xs text-stone-500 font-semibold">
            <span>2. Número de Entrevistas</span>
            <Users className="w-4 h-4 text-amber-700" />
          </div>
          <p className="text-3xl font-serif font-bold text-stone-900 tabular-nums">
            {stats.totalInterviews}
          </p>
          <p className="text-[11px] text-stone-600">
            {stats.individualInterviews} individuales • {stats.coupleInterviews} en pareja ({stats.completedInterviews} concluidas)
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-xs text-stone-500 font-semibold">
            <span>3. Respuestas Completadas</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
          </div>
          <p className="text-3xl font-serif font-bold text-stone-900 tabular-nums">
            {stats.completedAnswersTotal}
          </p>
          <p className="text-[11px] text-stone-600">
            {stats.mainAnswersCount} base + {stats.followUpAnswersCount} profundización + {stats.additionalMemoriesCount} libres
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-xs text-stone-500 font-semibold">
            <span>4. Conversaciones Mi Esencia</span>
            <MessageSquare className="w-4 h-4 text-amber-700" />
          </div>
          <p className="text-3xl font-serif font-bold text-stone-900 tabular-nums">
            {stats.totalConversations}
          </p>
          <p className="text-[11px] text-stone-600">
            Con {stats.totalInterlocutors} familiares ({stats.activeCredentialsCount} códigos YF-XXXXX activos)
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-xs text-stone-500 font-semibold">
            <span>5. Mensajes en Mi Esencia</span>
            <Cpu className="w-4 h-4 text-amber-700" />
          </div>
          <p className="text-3xl font-serif font-bold text-stone-900 tabular-nums">
            {stats.totalMiEsenciaMessagesSent}
          </p>
          <p className="text-[11px] text-amber-900 font-medium">
            En sesiones: {stats.familyUserMessagesCount} familiar / {stats.avatarAiMessagesCount} avatar • Hoy: {stats.messagesSentTodayTotal}
          </p>
        </div>
      </div>

      {/* SECTION 2: SECONDARY GLOBAL METRICS ROW */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 text-xs">
        <div className="bg-white p-3.5 rounded-xl border border-stone-200">
          <p className="text-stone-500">Palabras en Entrevistas</p>
          <p className="text-lg font-serif font-bold text-stone-900 tabular-nums">
            {stats.totalAnswerWords.toLocaleString('es-MX')}
          </p>
          <p className="text-[10px] text-stone-500">Prom: {stats.avgWordsPerAnswer} pal/resp</p>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-stone-200">
          <p className="text-stone-500">Grabaciones de Voz</p>
          <p className="text-lg font-serif font-bold text-stone-900 tabular-nums">
            {stats.totalAudios}
          </p>
          <p className="text-[10px] text-stone-500">Audios preservados</p>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-stone-200">
          <p className="text-stone-500">Fotografías Cargadas</p>
          <p className="text-lg font-serif font-bold text-stone-900 tabular-nums">
            {stats.totalPhotos}
          </p>
          <p className="text-[10px] text-stone-500">Con pie de foto</p>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-stone-200">
          <p className="text-stone-500">Versiones de Libros</p>
          <p className="text-lg font-serif font-bold text-stone-900 tabular-nums">
            {stats.totalBookVersions}
          </p>
          <p className="text-[10px] text-stone-500">+{stats.totalManuscripts} manuscritos</p>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-stone-200">
          <p className="text-stone-500">Testimonios Nivel A</p>
          <p className="text-lg font-serif font-bold text-stone-900 tabular-nums">
            {stats.levelATestimoniesCount}
          </p>
          <p className="text-[10px] text-stone-500">{stats.totalCompilationPdfs} PDFs compilados</p>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-stone-200">
          <p className="text-stone-500">Memorias Nivel B / C</p>
          <p className="text-lg font-serif font-bold text-stone-900 tabular-nums">
            {stats.levelBMemoriesCount} / {stats.levelCMemoriesCount}
          </p>
          <p className="text-[10px] text-stone-500">Familiar vs. Privado</p>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-stone-200">
          <p className="text-stone-500">Tokens IA (Mes)</p>
          <p className="text-lg font-serif font-bold text-stone-900 tabular-nums">
            {stats.tokensEstimatedThisMonthTotal.toLocaleString('es-MX')}
          </p>
          <p className="text-[10px] text-stone-500">{stats.messagesUsedThisMonthTotal} msjs este mes</p>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-stone-200">
          <p className="text-stone-500">Ingresos Mi Esencia</p>
          <p className="text-lg font-serif font-bold text-emerald-800 tabular-nums">
            ${stats.totalRevenueMxn.toLocaleString('es-MX')}
          </p>
          <p className="text-[10px] text-stone-500">{stats.totalPaymentsCount} pagos • MXN</p>
        </div>
      </div>

      {/* SECTION 3: INTERVIEWS, ANSWERS BY STAGE, BOOKS & PRIVACY */}
      {(activeScope === 'all' || activeScope === 'interviews') && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Breakdown by 5 Life Stages */}
            <div className="lg:col-span-7 bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-serif text-lg font-bold text-stone-900">
                    Desglose de Respuestas y Riqueza por Etapa de Vida
                  </h3>
                  <p className="text-xs text-stone-500">
                    Banco activo de {stats.totalQuestionsInBank} preguntas • Distribución real de respuestas, profundizaciones, voz y fotos.
                  </p>
                </div>
                <BookOpen className="w-5 h-5 text-amber-800" />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500">
                      <th className="py-2 pr-3">Etapa Biográfica</th>
                      <th className="py-2 px-2 text-right">Preguntas Banco</th>
                      <th className="py-2 px-2 text-right">Respuestas</th>
                      <th className="py-2 px-2 text-right">Profundizaciones</th>
                      <th className="py-2 px-2 text-right">Fotos / Audios</th>
                      <th className="py-2 pl-2 text-right">Palabras (Prom.)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {stats.stageStats.map((st) => (
                      <tr key={st.stageId} className="hover:bg-stone-50">
                        <td className="py-2.5 pr-3 font-semibold text-stone-900">{st.label}</td>
                        <td className="py-2.5 px-2 text-right tabular-nums text-stone-600">
                          {st.bankQuestionsCount}
                        </td>
                        <td className="py-2.5 px-2 text-right tabular-nums font-bold text-amber-900">
                          {st.answersCount}
                        </td>
                        <td className="py-2.5 px-2 text-right tabular-nums text-stone-700">
                          {st.followUpsCount}
                        </td>
                        <td className="py-2.5 px-2 text-right tabular-nums text-stone-700">
                          {st.photosCount} 📷 / {st.audiosCount} 🎙️
                        </td>
                        <td className="py-2.5 pl-2 text-right tabular-nums text-stone-800">
                          {st.totalWords.toLocaleString('es-MX')} ({st.avgWords} pal/resp)
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Books, Editorial Studio & Privacy Governance */}
            <div className="lg:col-span-5 bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-serif text-lg font-bold text-stone-900">
                    Estudio Editorial, Privacidad y Gobernanza
                  </h3>
                  <p className="text-xs text-stone-500">
                    Métricas de maquetación de libros, consentimientos, distribución y derechos ARCO.
                  </p>
                </div>
                <ShieldCheck className="w-5 h-5 text-emerald-700" />
              </div>

              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
                  <span className="text-stone-500">Códigos Entrevista (YF-XXXXX)</span>
                  <p className="text-base font-bold text-stone-900 mt-0.5">
                    {stats.totalActiveInterviewCodes} activos / {stats.totalRevokedInterviewCodes} revocados
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
                  <span className="text-stone-500">Consentimientos Firmados</span>
                  <p className="text-base font-bold text-emerald-800 mt-0.5">
                    {stats.totalConsents} vigentes (de {stats.totalParticipants} part.)
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
                  <span className="text-stone-500">Libros Compartidos / Entregas</span>
                  <p className="text-base font-bold text-stone-900 mt-0.5">
                    {stats.totalBookShares} compartidos • {stats.totalScheduledDeliveries} programadas
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
                  <span className="text-stone-500">Post-Mortem / ARCO / Auditoría</span>
                  <p className="text-base font-bold text-stone-900 mt-0.5">
                    {stats.totalPostMortem} post-mortem • {stats.totalArcoRequests} ARCO • {stats.totalAuditLogs} logs
                  </p>
                </div>
              </div>

              <div className="pt-2 border-t border-stone-200 space-y-2 text-xs">
                <p className="font-semibold text-stone-800">
                  Preferencias Editoriales en Libros Maquetados ({stats.totalBookVersions}):
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {stats.narrativeStyleCounts.length === 0 ? (
                    <span className="text-stone-500">Sin versiones maquetadas aún</span>
                  ) : (
                    stats.narrativeStyleCounts.map(([style, count]) => (
                      <span
                        key={style}
                        className="px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-900 font-medium"
                      >
                        Estilo {style}: {count}
                      </span>
                    ))
                  )}
                  {stats.bookFormatCounts.map(([fmt, count]) => (
                    <span
                      key={fmt}
                      className="px-2.5 py-1 rounded-full bg-stone-100 border border-stone-300 text-stone-800 font-medium"
                    >
                      Formato {fmt.toUpperCase()}: {count}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Per-Interview Complete Table */}
          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-serif text-lg font-bold text-stone-900">
                  Estado Detallado por Entrevista Biográfica ({stats.interviewRows.length})
                </h3>
                <p className="text-xs text-stone-500">
                  Conteo vivo de respuestas principales, profundizaciones IA, recuerdos adicionales, palabras, audios, fotos y vinculación con Mi Esencia.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500">
                    <th className="py-2 pr-3">Entrevista / Protagonista(s)</th>
                    <th className="py-2 px-2">Modo / Estado</th>
                    <th className="py-2 px-2">Código(s) YF-XXXXX</th>
                    <th className="py-2 px-2 text-right">Respuestas Totales</th>
                    <th className="py-2 px-2 text-right">Desglose (Base / IA / Extra)</th>
                    <th className="py-2 px-2 text-right">Palabras</th>
                    <th className="py-2 px-2 text-right">Multimedia</th>
                    <th className="py-2 px-2 text-right">Libros / Manuscritos</th>
                    <th className="py-2 pl-2">Avatar Mi Esencia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {stats.interviewRows.map((row) => (
                    <tr key={row.id} className="hover:bg-stone-50">
                      <td className="py-2.5 pr-3">
                        <div className="font-bold text-stone-900">{row.title}</div>
                        <div className="text-[11px] text-stone-500">{row.participantsNames}</div>
                      </td>
                      <td className="py-2.5 px-2">
                        <span className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-800 font-medium">
                          {row.storyMode}
                        </span>
                        <div className="text-[11px] text-stone-500 mt-0.5">{row.status}</div>
                      </td>
                      <td className="py-2.5 px-2 font-mono font-bold text-amber-900">
                        {row.accessCodes || '—'}
                      </td>
                      <td className="py-2.5 px-2 text-right font-serif font-bold text-sm text-stone-900 tabular-nums">
                        {row.totalCompletedAnswers}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums text-stone-600">
                        {row.mainCount} / {row.followCount} / {row.extraCount}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums text-stone-800 font-medium">
                        {row.wordsCount.toLocaleString('es-MX')}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums text-stone-700">
                        {row.photosCount} 📷 • {row.audiosCount} 🎙️
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums text-stone-700">
                        {row.booksCount} lib • {row.manuscriptsCount} bor
                      </td>
                      <td className="py-2.5 pl-2">
                        {row.hasAvatar ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 font-semibold text-[11px]">
                            Activo ({row.avatarName})
                          </span>
                        ) : (
                          <span className="text-stone-400 text-[11px]">Sin habilitar</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 4: MI ESENCIA QUANTITATIVE BREAKDOWN (AVATARS, CONVERSATIONS, MESSAGES, MEMORIES) */}
      {(activeScope === 'all' || activeScope === 'mi_esencia') && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-serif text-lg font-bold text-stone-900">
                  Métricas Detalladas de Mi Esencia (/miesencia): Avatares, Conversaciones y Mensajes
                </h3>
                <p className="text-xs text-stone-500">
                  Actividad en vivo por cada avatar, sesiones abiertas, mensajes de familiares vs. respuestas del avatar, cuotas diarias/mensuales y niveles de memoria A, B y C.
                </p>
              </div>
              <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-900 text-xs font-semibold">
                {stats.totalConversations} conversaciones • {stats.totalMiEsenciaMessagesSent} mensajes totales
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
              <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200">
                <p className="text-stone-500">Mensajes de Familiares</p>
                <p className="text-xl font-serif font-bold text-stone-900 tabular-nums mt-0.5">
                  {stats.familyUserMessagesCount}
                </p>
                <p className="text-[11px] text-stone-500">Enviados en el chat</p>
              </div>
              <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200">
                <p className="text-stone-500">Respuestas del Avatar</p>
                <p className="text-xl font-serif font-bold text-amber-900 tabular-nums mt-0.5">
                  {stats.avatarAiMessagesCount}
                </p>
                <p className="text-[11px] text-stone-500">Generadas con IA</p>
              </div>
              <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200">
                <p className="text-stone-500">Palabras en Conversaciones</p>
                <p className="text-xl font-serif font-bold text-stone-900 tabular-nums mt-0.5">
                  {stats.totalConversationWords.toLocaleString('es-MX')}
                </p>
                <p className="text-[11px] text-stone-500">Diálogo familiar acumulado</p>
              </div>
              <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200">
                <p className="text-stone-500">Vínculos y Parentescos</p>
                <p className="text-xl font-serif font-bold text-stone-900 tabular-nums mt-0.5">
                  {stats.totalRelationsExtracted}
                </p>
                <p className="text-[11px] text-stone-500">Extraídos del Compilado</p>
              </div>
              <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200">
                <p className="text-stone-500">Contradicciones / Snapshots</p>
                <p className="text-xl font-serif font-bold text-stone-900 tabular-nums mt-0.5">
                  {stats.openContradictionsCount} ab. / {stats.resolvedContradictionsCount} res.
                </p>
                <p className="text-[11px] text-stone-500">{stats.totalSnapshots} instantáneas</p>
              </div>
              <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200">
                <p className="text-stone-500">Prompts / Fallbacks IA</p>
                <p className="text-xl font-serif font-bold text-stone-900 tabular-nums mt-0.5">
                  {stats.totalPromptLibraryCount} plantillas
                </p>
                <p className="text-[11px] text-stone-500">
                  {stats.totalPromptVersionsCount} versiones • {stats.totalFallbackLogsCount} respaldos
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500">
                    <th className="py-2 pr-3">Avatar Familiar / Plan</th>
                    <th className="py-2 px-2">Motor IA / Modelo</th>
                    <th className="py-2 px-2">Familiares y Códigos YF-XXXXX</th>
                    <th className="py-2 px-2 text-right">Conversaciones</th>
                    <th className="py-2 px-2 text-right">Msjs Sesión (Fam / IA)</th>
                    <th className="py-2 px-2 text-right">Uso Hoy / Mes</th>
                    <th className="py-2 px-2 text-right">Tokens IA Est.</th>
                    <th className="py-2 pl-2 text-right">Memorias (A / B / C)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {stats.avatarRows.map((av) => (
                    <tr key={av.avatarId} className="hover:bg-stone-50">
                      <td className="py-2.5 pr-3">
                        <div className="font-bold text-stone-900">{av.avatarDisplayName}</div>
                        <div className="text-[11px] text-stone-500">
                          {av.planName} • {av.status}
                        </div>
                      </td>
                      <td className="py-2.5 px-2">
                        <span className="uppercase font-semibold text-stone-800">{av.provider}</span>
                        <div className="text-[11px] text-stone-500 font-mono">{av.model}</div>
                      </td>
                      <td className="py-2.5 px-2">
                        <div className="font-medium text-stone-800">
                          {av.interlocutorsCount} familiar(es)
                        </div>
                        <div className="text-[11px] font-mono font-bold text-amber-900">
                          {av.activeCodes || '—'}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 text-right font-serif font-bold text-sm text-stone-900 tabular-nums">
                        {av.conversationsCount}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums text-stone-700">
                        <strong>{av.totalSessionMessages}</strong> ({av.userMsgsInSessions} /{' '}
                        {av.avatarMsgsInSessions})
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums text-stone-800">
                        Hoy: <strong>{av.usedToday}</strong> • Mes:{' '}
                        <strong>{av.usedThisMonth}</strong>/{av.monthlyQuota}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums text-amber-900 font-semibold">
                        {av.tokensEstimated.toLocaleString('es-MX')}
                      </td>
                      <td className="py-2.5 pl-2 text-right tabular-nums text-stone-700">
                        <span className="text-amber-900 font-bold">{av.testimoniesCount}</span> /{' '}
                        <span className="text-emerald-800 font-bold">{av.memBCount}</span> /{' '}
                        <span className="text-sky-800 font-bold">{av.memCCount}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 5: DEEP QUALITATIVE ANALYSIS (INTERVIEWS + MI ESENCIA) */}
      {(activeScope === 'all' || activeScope === 'qualitative') && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Qualitative Insights from Biographical Interviews */}
            <div className="lg:col-span-6 bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-serif text-lg font-bold text-stone-900">
                    Análisis Cualitativo • Entrevistas y Profundización IA
                  </h3>
                  <p className="text-xs text-stone-500">
                    Motivos narrativos detectados, estilo expresivo y dedicatorias finales de los protagonistas.
                  </p>
                </div>
                <FileText className="w-5 h-5 text-amber-800" />
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-stone-800">
                  Motivos Contextuales de Profundización IA más Frecuentes:
                </p>
                {stats.deepeningReasons.length === 0 ? (
                  <p className="text-xs text-stone-500 italic">
                    Aún no se registran motivos específicos de profundización en la selección actual.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {stats.deepeningReasons.slice(0, 6).map(([reason, count], idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-xl bg-amber-50/70 border border-amber-200/80 flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="text-stone-800 italic">«{reason}»</span>
                        <span className="px-2 py-0.5 rounded-full bg-amber-200/80 text-amber-950 font-bold shrink-0">
                          {count}x
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-stone-200 space-y-2">
                <p className="text-xs font-semibold text-stone-800">
                  Dedicatorias y Mensajes de Cierre de los Protagonistas:
                </p>
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {stats.interviewRows.filter((r) => Boolean(r.closingText)).length === 0 ? (
                    <p className="text-xs text-stone-500 italic">
                      Sin mensajes de cierre registrados aún en las entrevistas seleccionadas.
                    </p>
                  ) : (
                    stats.interviewRows
                      .filter((r) => Boolean(r.closingText))
                      .map((r) => (
                        <div
                          key={r.id}
                          className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs space-y-1"
                        >
                          <div className="font-bold text-stone-900">
                            {r.title} ({r.participantsNames})
                          </div>
                          <p className="font-serif italic text-stone-700">«{r.closingText}»</p>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>

            {/* Qualitative Insights from Mi Esencia */}
            <div className="lg:col-span-6 bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-serif text-lg font-bold text-stone-900">
                    Análisis Cualitativo • Mi Esencia, Parentescos y Memorias
                  </h3>
                  <p className="text-xs text-stone-500">
                    Dinámica familiar, clasificación de intenciones conversacionales y recuerdos aportados.
                  </p>
                </div>
                <Sparkles className="w-5 h-5 text-amber-800" />
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-stone-800">
                  Distribución de Familiares por Parentesco y Clasificación Conversacional:
                </p>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {stats.relationshipCounts.map(([rel, count]) => (
                    <span
                      key={rel}
                      className="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-900 font-semibold"
                    >
                      {rel}: {count}
                    </span>
                  ))}
                  {stats.messageClassificationCounts.map(([cls, count]) => (
                    <span
                      key={cls}
                      className="px-2.5 py-1 rounded-full bg-stone-100 border border-stone-300 text-stone-700 font-medium"
                    >
                      Tipo {cls}: {count} msj(s)
                    </span>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-stone-200 space-y-2">
                <p className="text-xs font-semibold text-stone-800">
                  Memorias Familiares Aportadas (Nivel B • Compartidas y Nivel C • Aislamiento Criptográfico):
                </p>
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1 text-xs">
                  {stats.levelBMemories.length === 0 && stats.levelCMemories.length === 0 ? (
                    <p className="text-stone-500 italic">
                      Aún no se han registrado memorias conversacionales Nivel B o C en este filtro.
                    </p>
                  ) : (
                    <>
                      {stats.levelBMemories.map((m: any) => (
                        <div
                          key={m.memoryId}
                          className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200 space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-emerald-950">
                              Nivel B • {m.ownerInterlocutorName} ({m.ownerRelationship})
                            </span>
                            <span className="text-[11px] text-emerald-800 font-medium">
                              {m.verificationState}
                            </span>
                          </div>
                          <p className="text-stone-800">{m.content}</p>
                        </div>
                      ))}
                      {stats.levelCMemories.map((m: any) => (
                        <div
                          key={m.memoryId}
                          className="p-3 rounded-xl bg-sky-50/60 border border-sky-200 flex items-center justify-between"
                        >
                          <div>
                            <span className="font-bold text-sky-950">
                              Nivel C (Privado) • {m.ownerInterlocutorName} ({m.ownerRelationship})
                            </span>
                            <p className="text-[11px] text-sky-900">
                              Tópico: {m.topic || 'Confidencia personal protegida por código YF-XXXXX'}
                            </p>
                          </div>
                          <Lock className="w-4 h-4 text-sky-700 shrink-0" />
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>

              <div className="pt-2 border-t border-stone-200 space-y-2">
                <p className="text-xs font-semibold text-stone-800">
                  Perfil Emocional y Voz de los Avatares Activos:
                </p>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1 text-xs">
                  {stats.filteredPersons.map((p: any) => (
                    <div
                      key={p.personId}
                      className="p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-stone-900">{p.fullName}</span>
                        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-semibold">
                          Espontaneidad: {p.spontaneityLevel}
                        </span>
                      </div>
                      <p className="text-stone-600">{p.emotionalStyleSummary}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
