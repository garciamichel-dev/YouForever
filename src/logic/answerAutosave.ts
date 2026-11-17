import type { AnswerRecord } from './interviewRules.ts';

/**
 * V5.3.6 — Answer autosave fields. Kept outside interviewRules.ts (protected module) as an
 * extension of AnswerRecord.
 *
 * - pendingSubmission: the answer was created by autosave and the participant has not confirmed it
 *   with «Guardar y Continuar» yet; it does not count as answered nor trigger a follow-up question.
 * - lastAutosavedAt: last autosave (consecutive autosaves share one edit-history entry).
 */
export type AutosavableAnswerRecord = AnswerRecord & {
  pendingSubmission?: boolean;
  lastAutosavedAt?: string;
};

export function isPendingAutosavedAnswer(answer: AnswerRecord | null | undefined): boolean {
  return Boolean(answer && (answer as AutosavableAnswerRecord).pendingSubmission);
}
