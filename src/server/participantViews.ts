/**
 * V5.3.1 — Views of server records that are safe to return to a PARTICIPANT.
 *
 * Audit-log records carry internal details meant for administrators (coverage percentage, colour
 * band, delivery status, diagnostics, reason codes, the e-mail of the administrator who acted, …).
 * Participants only need to know which event happened on their account and when, which is exactly
 * what their privacy panel shows. The full records stay intact for administrators.
 */

export interface ParticipantAuditLogView {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  timestamp: string;
}

/** Administrative events that participants never see (not even their name). */
const ADMIN_ONLY_ACTION_PATTERNS: RegExp[] = [
  /^BOOK_AUDIT_/,
  /^DUPLICATE_INTERVIEW$/,
  /^UPDATE_ADMIN_COPY_NOTE$/,
];

export function toParticipantAuditLogView(log: {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  timestamp: string;
}): ParticipantAuditLogView | null {
  if (!log || typeof log.action !== 'string') return null;
  if (ADMIN_ONLY_ACTION_PATTERNS.some((rx) => rx.test(log.action))) return null;
  // Allow-list: nothing else (details, performedBy) leaves the server.
  return {
    id: String(log.id),
    action: log.action,
    targetType: String(log.targetType || ''),
    targetId: String(log.targetId || ''),
    timestamp: String(log.timestamp || ''),
  };
}
