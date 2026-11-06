import {
  DemoBasicProfile,
  DemoEditorialConfig,
  DemoManuscript,
  DemoNarrativeStyleId,
  DemoQuestionResponse,
} from '../logic/demoStoryRules.ts';

export type DemoWizardPhase =
  | 'welcome'
  | 'mode_and_profile'
  | 'interview'
  | 'interview_completed'
  | 'narrative_style'
  | 'editorial_studio';

export interface DemoTemporarySessionState {
  phase: DemoWizardPhase;
  profile: DemoBasicProfile;
  currentStepIndex: number; // 0..4
  showingFollowUpForQuestionId: string | null;
  responses: Record<string, DemoQuestionResponse>;
  narrativeStyle: DemoNarrativeStyleId;
  editorialConfig: DemoEditorialConfig;
  aiGeneratedManuscript: DemoManuscript | null;
  workingManuscript: DemoManuscript | null;
  hasManualEdits: boolean;
  hadInMemoryPhotosBeforeReload: boolean;
  lastActivityAt: number;
}

const DEMO_SESSION_KEY = 'foreveryou_free_trial_session_v1';
export const DEMO_SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours logical expiration

export function createInitialDemoSessionState(nowMs: number = Date.now()): DemoTemporarySessionState {
  return {
    phase: 'welcome',
    profile: {
      mode: 'individual',
      displayName: '',
      fullName: '',
      partner1Name: '',
      partner2Name: '',
      customTitle: '',
      hasAcceptedTemporaryNotice: false,
    },
    currentStepIndex: 0,
    showingFollowUpForQuestionId: null,
    responses: {},
    narrativeStyle: 'first_person_literary',
    editorialConfig: {
      coverDesignId: 'clasica_eterna',
      coverColorVariantIdx: 0,
      coverVisualType: 'illustration',
      coverIllustrationId: 'arbol_raices',
      interiorStyleId: 'memorias_elegantes',
      bookFormatId: '6x9',
      customTitle: '',
      customSubtitle: '',
      customAuthors: '',
      dedication: '',
    },
    aiGeneratedManuscript: null,
    workingManuscript: null,
    hasManualEdits: false,
    hadInMemoryPhotosBeforeReload: false,
    lastActivityAt: nowMs,
  };
}

export function isDemoSessionExpired(
  session: Pick<DemoTemporarySessionState, 'lastActivityAt'>,
  nowMs: number = Date.now()
): boolean {
  return nowMs - session.lastActivityAt > DEMO_SESSION_TTL_MS;
}

/**
 * Loads the temporary session from `sessionStorage`.
 * Automatically purges expired data (> 4 hours since last activity).
 */
export function loadDemoSessionFromStorage(): {
  state: DemoTemporarySessionState;
  wasExpiredAndPurged: boolean;
  restoredFromSession: boolean;
} {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return {
      state: createInitialDemoSessionState(),
      wasExpiredAndPurged: false,
      restoredFromSession: false,
    };
  }

  try {
    const raw = window.sessionStorage.getItem(DEMO_SESSION_KEY);
    if (!raw) {
      return {
        state: createInitialDemoSessionState(),
        wasExpiredAndPurged: false,
        restoredFromSession: false,
      };
    }

    const parsed = JSON.parse(raw) as DemoTemporarySessionState;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.lastActivityAt !== 'number') {
      window.sessionStorage.removeItem(DEMO_SESSION_KEY);
      return {
        state: createInitialDemoSessionState(),
        wasExpiredAndPurged: false,
        restoredFromSession: false,
      };
    }

    const now = Date.now();
    if (isDemoSessionExpired(parsed, now)) {
      window.sessionStorage.removeItem(DEMO_SESSION_KEY);
      return {
        state: createInitialDemoSessionState(),
        wasExpiredAndPurged: true,
        restoredFromSession: false,
      };
    }

    const defaults = createInitialDemoSessionState();
    return {
      state: {
        ...defaults,
        ...parsed,
        profile: {
          ...defaults.profile,
          ...(parsed.profile || {}),
        },
        editorialConfig: {
          ...defaults.editorialConfig,
          ...(parsed.editorialConfig || {}),
        },
        lastActivityAt: now,
      },
      wasExpiredAndPurged: false,
      restoredFromSession: parsed.phase !== 'welcome',
    };
  } catch (_err) {
    return {
      state: createInitialDemoSessionState(),
      wasExpiredAndPurged: false,
      restoredFromSession: false,
    };
  }
}

/**
 * Saves textual interview state ONLY to `sessionStorage` (never `localStorage`, never IndexedDB, never DB).
 */
export function saveDemoSessionToStorage(state: DemoTemporarySessionState): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    const payload: DemoTemporarySessionState = {
      ...state,
      lastActivityAt: Date.now(),
    };
    window.sessionStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(payload));
  } catch (_err) {
    // Ignore storage quota errors
  }
}

/**
 * Immediately wipes all temporary demo data from `sessionStorage`.
 */
export function clearDemoSessionFromStorage(): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.removeItem(DEMO_SESSION_KEY);
  } catch (_err) {
    // Ignore errors
  }
}
