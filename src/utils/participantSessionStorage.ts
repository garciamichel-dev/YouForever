export interface StoredParticipantSession {
  token: string;
  accessCode?: string;
  participantId: string;
  interviewId: string;
  participantName: string;
  savedAt: string;
}

export interface StoredParticipantProgress {
  currentQuestionId: string | null;
  activeTab: 'interview' | 'history' | 'book';
  showCompletionScreen: boolean;
  reopenedAt?: string | null;
  updatedAt: string;
}

export interface StoredQuestionDraft {
  answerText: string;
  branchChoice: 'yes' | 'no' | null;
  updatedAt: string;
}

const ACTIVE_SESSION_KEY = 'foreveryou_participant_active_session_v1';
const PROGRESS_KEY_PREFIX = 'foreveryou_participant_progress_v1:';
const DRAFT_KEY_PREFIX = 'foreveryou_participant_draft_v1:';

export function saveActiveParticipantSession(
  session: Omit<StoredParticipantSession, 'savedAt'>
): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: StoredParticipantSession = {
      ...session,
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(payload));
  } catch (_err) {
    // Ignore localStorage quota/privacy errors
  }
}

export function getActiveParticipantSession(): StoredParticipantSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredParticipantSession;
    if (!parsed || typeof parsed.token !== 'string' || !parsed.token.trim()) {
      return null;
    }
    return parsed;
  } catch (_err) {
    return null;
  }
}

export function clearActiveParticipantSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(ACTIVE_SESSION_KEY);
  } catch (_err) {
    // Ignore localStorage errors
  }
}

export function saveParticipantProgress(
  participantId: string,
  progress: Omit<StoredParticipantProgress, 'updatedAt'>
): void {
  if (typeof window === 'undefined' || !participantId) return;
  try {
    const payload: StoredParticipantProgress = {
      ...progress,
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(
      `${PROGRESS_KEY_PREFIX}${participantId}`,
      JSON.stringify(payload)
    );
  } catch (_err) {
    // Ignore localStorage errors
  }
}

export function getParticipantProgress(
  participantId: string
): StoredParticipantProgress | null {
  if (typeof window === 'undefined' || !participantId) return null;
  try {
    const raw = window.localStorage.getItem(`${PROGRESS_KEY_PREFIX}${participantId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredParticipantProgress;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (_err) {
    return null;
  }
}

export function clearParticipantProgress(participantId: string): void {
  if (typeof window === 'undefined' || !participantId) return;
  try {
    window.localStorage.removeItem(`${PROGRESS_KEY_PREFIX}${participantId}`);
  } catch (_err) {
    // Ignore localStorage errors
  }
}

export function saveQuestionDraft(
  participantId: string,
  questionId: string,
  draft: Omit<StoredQuestionDraft, 'updatedAt'>
): void {
  if (typeof window === 'undefined' || !participantId || !questionId) return;
  try {
    const key = `${DRAFT_KEY_PREFIX}${participantId}:${questionId}`;
    const hasContent =
      (draft.answerText && draft.answerText.length > 0) || draft.branchChoice !== null;
    if (!hasContent) {
      window.localStorage.removeItem(key);
      return;
    }
    const payload: StoredQuestionDraft = {
      answerText: draft.answerText,
      branchChoice: draft.branchChoice,
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch (_err) {
    // Ignore localStorage errors
  }
}

export function getQuestionDraft(
  participantId: string,
  questionId: string
): StoredQuestionDraft | null {
  if (typeof window === 'undefined' || !participantId || !questionId) return null;
  try {
    const raw = window.localStorage.getItem(
      `${DRAFT_KEY_PREFIX}${participantId}:${questionId}`
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredQuestionDraft;
    if (!parsed || typeof parsed.answerText !== 'string') return null;
    return parsed;
  } catch (_err) {
    return null;
  }
}

export function clearQuestionDraft(participantId: string, questionId: string): void {
  if (typeof window === 'undefined' || !participantId || !questionId) return;
  try {
    window.localStorage.removeItem(`${DRAFT_KEY_PREFIX}${participantId}:${questionId}`);
  } catch (_err) {
    // Ignore localStorage errors
  }
}
