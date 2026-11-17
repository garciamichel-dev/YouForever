/**
 * V5.5.0 — QUICK ACCESS OF THE INTERVIEWEE TO «MI ESENCIA».
 *
 * As soon as the participant has saved the final version of their book in PDF, the Book Studio
 * offers them direct access to «Mi Esencia» to converse with their digital representation. If the
 * interview has no avatar yet, it is created with the default configuration below; an avatar the
 * administrator already created is reused as it is (its configuration is never overwritten).
 */
import type { MiEsenciaSpontaneityLevel } from './miEsenciaRules.ts';
import { CANONICAL_PUBLIC_ORIGIN } from './freeRegistration.ts';

export const MI_ESENCIA_QUICK_ACCESS_DEFAULTS = {
  /** IA: Gemini (gemini-3.8-flash); if it fails for a message, a backup model answers transparently. */
  primaryProvider: 'gemini' as const,
  geminiModel: 'gemini-3.8-flash',
  /** Active prompt, looked up by name in the prompt library. */
  libraryPromptName: 'GPT V6',
  /** Initial commercial plan: monthly (1 month; the administrator renews it). */
  planCode: 'mensual' as const,
  fallbackPlanId: 'plan_mensual',
  /** Maximum messages per day. */
  dailyMessageQuota: 30,
  spontaneityLevel: 'moderado' as MiEsenciaSpontaneityLevel,
  /** General access: the avatar does not know who is talking. */
  accessType: 'general' as const,
  /** Who appears as the author of the automatic creation in the avatar's history. */
  performedBy: 'sistema:acceso-rapido-participante',
  /** Abuse limit: emails with the access per avatar in 24 hours. */
  maxEmailsPer24h: 5,
};

/** What the interviewee sees of their access (never other codes of the avatar). */
export interface MiEsenciaParticipantQuickAccess {
  avatarId: string;
  avatarDisplayName: string;
  personalCode: string;
  /** Relative path (`/miesencia?code=...`): the code is applied automatically. */
  privateLinkPath: string;
  /** False when the administrator paused the code, the subscription expired, etc. */
  available: boolean;
  unavailableReason?: string;
  subscriptionStatus: string;
  expiresAt: string;
  planName: string;
  dailyMessageQuota: number;
  createdAvatar: boolean;
  activatedAt?: string;
}

const normalizeName = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Library prompt by name («GPT V6»), ignoring case, accents and spaces. Archived ones are skipped. */
export function findLibraryPromptByName<T extends { name: string; status?: string; updatedAt?: string }>(
  prompts: Iterable<T>,
  name: string
): T | undefined {
  const target = normalizeName(name);
  const matches = Array.from(prompts).filter((p) => normalizeName(p.name) === target && p.status !== 'archivado');
  // The most recently updated one wins if there were duplicates.
  return matches.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
}

export function isValidQuickAccessEmail(email: string): boolean {
  const value = String(email || '').trim();
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/** Emails sent in the last 24 hours (abuse limit). */
export function countRecentEmailDeliveries(
  deliveries: Array<{ sentAt: string }> | undefined,
  nowMs: number = Date.now()
): number {
  return (deliveries || []).filter((d) => nowMs - new Date(d.sentAt).getTime() < 24 * 60 * 60 * 1000).length;
}

/**
 * Email with the access to «Mi Esencia» (same visual style as the /free registration email).
 */
export function buildMiEsenciaAccessEmail(params: {
  participantName: string;
  avatarDisplayName: string;
  personalCode: string;
  accessUrl: string;
  expiresAtIso?: string;
  dailyMessageQuota?: number;
}): { subject: string; text: string; html: string } {
  const firstName = (params.participantName || '').trim().split(/\s+/)[0] || 'Participante';
  const accessUrl = String(params.accessUrl || '').replace(/^https?:\/\/www\.youforever\.app/i, CANONICAL_PUBLIC_ORIGIN);
  const formattedExpiry = (() => {
    if (!params.expiresAtIso) return '';
    const date = new Date(params.expiresAtIso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
  })();
  const daily = params.dailyMessageQuota || MI_ESENCIA_QUICK_ACCESS_DEFAULTS.dailyMessageQuota;

  const subject = `Tu acceso a Mi Esencia (Código ${params.personalCode})`;

  const text = [
    `Hola ${params.participantName},`,
    '',
    'Tu libro autobiográfico está listo y ahora también puedes conversar con tu representación digital en «Mi Esencia» de YouForever.',
    '',
    'TU ACCESO A MI ESENCIA:',
    `- Código de acceso: ${params.personalCode}`,
    `- Enlace directo: ${accessUrl}`,
    '',
    'CÓMO ENTRAR:',
    `1. Abre el enlace directo; tu código se aplica automáticamente. También puedes entrar a ${accessUrl.split('?')[0]} e ingresar el código ${params.personalCode}.`,
    '2. Acepta el aviso de transparencia la primera vez y empieza a conversar.',
    `3. Puedes enviar hasta ${daily} mensajes por día.${formattedExpiry ? ` Tu acceso está vigente hasta el ${formattedExpiry}.` : ''}`,
    '',
    'Este código es general: quien lo tenga puede conversar con tu representación digital, que no sabrá quién le escribe. Compártelo solo con quien tú quieras.',
    '',
    'Con cariño,',
    'Equipo YouForever (youforever.team@gmail.com)',
  ].join('\n');

  const escapeHtml = (s: string) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background-color:#f5f5f4;font-family:Georgia,serif;color:#1c1917;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e7e5e4;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="background:#1c1917;padding:24px 28px;color:#fef3c7;">
              <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#fbbf24;font-family:Arial,sans-serif;font-weight:bold;">YOUFOREVER • MI ESENCIA</div>
              <h1 style="margin:8px 0 0;font-size:22px;line-height:1.3;color:#ffffff;font-weight:bold;">${escapeHtml(firstName)}, tu representación digital está lista</h1>
              <p style="margin:6px 0 0;font-size:13px;color:#d6d3d1;font-family:Arial,sans-serif;">${escapeHtml(params.avatarDisplayName)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#292524;">
              <p style="margin:0 0 16px;">Hola <strong>${escapeHtml(params.participantName)}</strong>, tu libro autobiográfico ya está listo y ahora también puedes conversar con tu representación digital en <strong>Mi Esencia</strong>, creada a partir de las respuestas de tu entrevista.</p>

              <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:18px;margin-bottom:20px;text-align:center;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:#92400e;font-weight:bold;">Tu Código de Acceso a Mi Esencia</div>
                <div style="font-family:'Courier New',monospace;font-size:26px;font-weight:bold;letter-spacing:3px;color:#1c1917;margin:8px 0 12px;">${escapeHtml(params.personalCode)}</div>
                <a href="${escapeHtml(accessUrl)}" style="display:inline-block;background:#b45309;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 22px;border-radius:10px;">Entrar directo a Mi Esencia</a>
                <div style="margin-top:10px;font-size:11px;color:#78716c;word-break:break-all;">Enlace directo: <a href="${escapeHtml(accessUrl)}" style="color:#92400e;">${escapeHtml(accessUrl)}</a></div>
              </div>

              <h2 style="font-size:15px;margin:0 0 8px;color:#1c1917;">Cómo entrar</h2>
              <ol style="margin:0 0 18px;padding-left:20px;color:#44403c;font-size:13px;">
                <li style="margin-bottom:6px;">Abre tu enlace directo: el código se aplica automáticamente.</li>
                <li style="margin-bottom:6px;">La primera vez, acepta el aviso de transparencia y empieza a conversar.</li>
                <li>Puedes enviar hasta <strong>${daily} mensajes por día</strong>${formattedExpiry ? `; tu acceso está vigente hasta el <strong>${escapeHtml(formattedExpiry)}</strong>` : ''}.</li>
              </ol>

              <div style="background:#f5f5f4;border:1px solid #e7e5e4;border-radius:10px;padding:14px 16px;margin-bottom:16px;font-size:12px;color:#57534e;">
                Este código es <strong>general</strong>: quien lo tenga puede conversar con tu representación digital, que no sabrá quién le escribe. Compártelo solo con quien tú quieras.
              </div>

              <p style="margin:0;font-size:12px;color:#78716c;">Si tienes alguna duda, escríbenos a <a href="mailto:youforever.team@gmail.com" style="color:#b45309;">youforever.team@gmail.com</a>.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
