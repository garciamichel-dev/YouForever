import { StoryMode } from './interviewRules.ts';

export const CANONICAL_PUBLIC_ORIGIN = 'https://youforever.app';
export const CANONICAL_MANUAL_PDF_URL = `${CANONICAL_PUBLIC_ORIGIN}/api/public/manual-pdf`;
export const CANONICAL_PORTAL_URL = `${CANONICAL_PUBLIC_ORIGIN}/`;

export function normalizeCanonicalPublicOrigin(rawUrl?: string | null): string {
  const trimmed = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return CANONICAL_PUBLIC_ORIGIN;
  const withoutWww = trimmed.replace(/^https?:\/\/www\.youforever\.app/i, CANONICAL_PUBLIC_ORIGIN);
  if (/^https?:\/\/youforever\.app$/i.test(withoutWww)) {
    return CANONICAL_PUBLIC_ORIGIN;
  }
  return CANONICAL_PUBLIC_ORIGIN;
}

export function buildCanonicalPublicUrl(path: string, rawOrigin?: string | null): string {
  const origin = normalizeCanonicalPublicOrigin(rawOrigin);
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${cleanPath}`;
}

export const FREE_SELF_REGISTER_EXPLANATION =
  'YouForever te guía para contar tu historia de vida por voz o por escrito, incorporar fotografías y crear un libro autobiográfico. Registrarte y realizar tu entrevista, ahora y para ti, es gratuito.';

export interface FreeRegistrationParticipantInput {
  name: string;
  email: string;
  age: number | string;
  city: string;
  relationship?: string;
  role?: 'primary' | 'contributor';
}

export interface FreeRegistrationPayload {
  storyMode: StoryMode;
  storyTitle?: string;
  privacyAccepted: boolean;
  participants: FreeRegistrationParticipantInput[];
}

export interface NormalizedFreeRegistrationParticipant {
  name: string;
  email: string;
  age: number;
  city: string;
  relationship: string;
  role: 'primary' | 'contributor';
}

export interface FreeRegistrationValidationResult {
  valid: boolean;
  error?: string;
  normalized?: {
    storyMode: StoryMode;
    storyTitle: string;
    privacyAccepted: true;
    participants: NormalizedFreeRegistrationParticipant[];
  };
}

export interface AdminParticipantRegistrationUpdate {
  participantId: string;
  name: string;
  email?: string;
  age?: number | string | null;
  city?: string;
  relationship?: string;
  role?: 'primary' | 'contributor';
}

export interface NormalizedAdminParticipantUpdate {
  participantId: string;
  name: string;
  email: string;
  age: number | null;
  city: string;
  relationship: string;
  role: 'primary' | 'contributor';
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmailAddress(email: string): boolean {
  return EMAIL_REGEX.test((email || '').trim());
}

export function buildDefaultStoryTitle(
  storyMode: StoryMode,
  participants: Array<{ name: string }>
): string {
  const names = participants
    .map((p) => (p.name || '').trim())
    .filter((n) => n.length > 0);
  if (names.length === 0) {
    return storyMode === 'compartida' ? 'Nuestra Historia de Vida' : 'Mi Historia de Vida';
  }
  if (storyMode === 'individual' || names.length === 1) {
    return `Historia de Vida de ${names[0]}`;
  }
  if (names.length === 2) {
    return `Historia Compartida de ${names[0]} y ${names[1]}`;
  }
  return `Historia Compartida de ${names[0]} y Familia`;
}

export function validateFreeRegistrationPayload(
  payload: FreeRegistrationPayload
): FreeRegistrationValidationResult {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Datos de registro inválidos.' };
  }

  const storyMode: StoryMode = payload.storyMode === 'compartida' ? 'compartida' : 'individual';

  if (!payload.privacyAccepted) {
    return {
      valid: false,
      error: 'Debes aceptar el Aviso de Privacidad de YouForever para continuar con tu registro.',
    };
  }

  const rawParticipants = Array.isArray(payload.participants) ? payload.participants : [];
  if (rawParticipants.length === 0) {
    return { valid: false, error: 'Debes ingresar tus datos personales para crear tu entrevista.' };
  }

  if (storyMode === 'compartida' && rawParticipants.length < 2) {
    return {
      valid: false,
      error:
        'Para una entrevista compartida debes registrar al menos 2 participantes con sus datos de acceso.',
    };
  }

  const participantsToCheck =
    storyMode === 'individual' ? [rawParticipants[0]] : rawParticipants;

  const normalizedParticipants: NormalizedFreeRegistrationParticipant[] = [];
  const seenEmails = new Set<string>();

  for (let i = 0; i < participantsToCheck.length; i++) {
    const p = participantsToCheck[i];
    const label =
      storyMode === 'individual'
        ? 'participante'
        : i === 0
        ? 'participante titular'
        : `participante ${i + 1}`;

    const name = String(p?.name || '').trim();
    if (name.length < 2) {
      return {
        valid: false,
        error: `Por favor ingresa el nombre completo del ${label}.`,
      };
    }

    const email = String(p?.email || '').trim().toLowerCase();
    if (!isValidEmailAddress(email)) {
      return {
        valid: false,
        error: `Por favor ingresa un correo electrónico válido para ${name || `el ${label}`}.`,
      };
    }

    if (seenEmails.has(email)) {
      return {
        valid: false,
        error: `El correo ${email} está repetido. En entrevistas compartidas cada participante necesita su propio correo para recibir su acceso personal.`,
      };
    }
    seenEmails.add(email);

    const parsedAge =
      typeof p?.age === 'number' ? p.age : parseInt(String(p?.age || '').trim(), 10);
    if (!Number.isFinite(parsedAge) || parsedAge < 1 || parsedAge > 125) {
      return {
        valid: false,
        error: `Por favor ingresa una edad válida (1 a 125 años) para ${name}.`,
      };
    }

    const city = String(p?.city || '').trim();
    if (city.length < 2) {
      return {
        valid: false,
        error: `Por favor ingresa la ciudad de residencia para ${name}.`,
      };
    }

    const role: 'primary' | 'contributor' =
      i === 0 ? 'primary' : p?.role === 'primary' ? 'primary' : 'contributor';

    const defaultRelationship =
      role === 'primary' ? 'Titular' : storyMode === 'compartida' ? 'Familiar / Coautor' : 'Colaborador';
    const relationship = String(p?.relationship || '').trim() || defaultRelationship;

    normalizedParticipants.push({
      name,
      email,
      age: Math.trunc(parsedAge),
      city,
      relationship,
      role,
    });
  }

  const customTitle = String(payload.storyTitle || '').trim();
  const storyTitle =
    customTitle.length >= 3
      ? customTitle
      : buildDefaultStoryTitle(storyMode, normalizedParticipants);

  return {
    valid: true,
    normalized: {
      storyMode,
      storyTitle,
      privacyAccepted: true,
      participants: normalizedParticipants,
    },
  };
}

export function validateAdminRegistrationUpdates(params: {
  interviewTitle?: string;
  participants: AdminParticipantRegistrationUpdate[];
}): {
  valid: boolean;
  error?: string;
  interviewTitle?: string;
  participants?: NormalizedAdminParticipantUpdate[];
} {
  const { interviewTitle, participants } = params;

  if (!Array.isArray(participants) || participants.length === 0) {
    return { valid: false, error: 'Debe enviarse al menos un participante para actualizar.' };
  }

  const cleanedTitle =
    typeof interviewTitle === 'string' && interviewTitle.trim().length > 0
      ? interviewTitle.trim()
      : undefined;

  if (typeof interviewTitle === 'string' && interviewTitle.trim().length === 0) {
    return { valid: false, error: 'El título de la historia no puede quedar vacío.' };
  }

  const normalizedList: NormalizedAdminParticipantUpdate[] = [];
  for (let i = 0; i < participants.length; i++) {
    const p = participants[i];
    if (!p?.participantId) {
      return { valid: false, error: 'Identificador de participante faltante.' };
    }
    const name = String(p.name || '').trim();
    if (name.length < 2) {
      return {
        valid: false,
        error: `El nombre completo del participante ${i + 1} debe tener al menos 2 caracteres.`,
      };
    }

    const email = String(p.email ?? '').trim().toLowerCase();
    if (email.length > 0 && !isValidEmailAddress(email)) {
      return {
        valid: false,
        error: `El correo electrónico «${email}» de ${name} no tiene un formato válido.`,
      };
    }

    let age: number | null = null;
    if (p.age !== undefined && p.age !== null && String(p.age).trim() !== '') {
      const parsedAge =
        typeof p.age === 'number' ? p.age : parseInt(String(p.age).trim(), 10);
      if (!Number.isFinite(parsedAge) || parsedAge < 1 || parsedAge > 125) {
        return {
          valid: false,
          error: `La edad de ${name} debe ser un número entero entre 1 y 125, o dejarse vacía si no aplica.`,
        };
      }
      age = Math.trunc(parsedAge);
    }

    const city = String(p.city ?? '').trim();
    const role: 'primary' | 'contributor' =
      p.role === 'primary' ? 'primary' : 'contributor';
    const relationship =
      String(p.relationship ?? '').trim() || (role === 'primary' ? 'Titular' : 'Colaborador');

    normalizedList.push({
      participantId: p.participantId,
      name,
      email,
      age,
      city,
      relationship,
      role,
    });
  }

  return {
    valid: true,
    interviewTitle: cleanedTitle,
    participants: normalizedList,
  };
}

function forceNonWwwYouForeverUrl(url: string, fallbackPath: string): string {
  const cleaned = String(url || '').trim();
  if (!cleaned) {
    return buildCanonicalPublicUrl(fallbackPath);
  }
  return cleaned.replace(/^https?:\/\/www\.youforever\.app/i, CANONICAL_PUBLIC_ORIGIN);
}

export function buildSelfRegisterWelcomeEmail(params: {
  participantName: string;
  interviewTitle: string;
  storyMode: StoryMode;
  role: 'primary' | 'contributor';
  accessCode: string;
  directUrl: string;
  manualPdfUrl: string;
  portalUrl: string;
  expiresAtIso: string;
}): { subject: string; text: string; html: string } {
  const firstName = (params.participantName || '').trim().split(/\s+/)[0] || 'Participante';
  const modeLabel =
    params.storyMode === 'compartida' ? 'Entrevista Compartida' : 'Entrevista Individual';
  const directUrl = forceNonWwwYouForeverUrl(params.directUrl, '/');
  const manualPdfUrl = forceNonWwwYouForeverUrl(params.manualPdfUrl, '/api/public/manual-pdf');
  const portalUrl = forceNonWwwYouForeverUrl(params.portalUrl, '/');

  const formattedExpiry = (() => {
    try {
      return new Date(params.expiresAtIso).toLocaleDateString('es-MX', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return params.expiresAtIso;
    }
  })();

  const subject = `Tu acceso a YouForever: ${params.interviewTitle} (Código ${params.accessCode})`;

  const text = [
    `Hola ${params.participantName},`,
    '',
    `Tu registro gratuito en YouForever quedó listo (${modeLabel}: "${params.interviewTitle}").`,
    '',
    'TUS CREDENCIALES DE ACCESO:',
    `- Código de acceso: ${params.accessCode}`,
    `- Enlace directo a tu entrevista: ${directUrl}`,
    '',
    'CÓMO INICIAR Y RETOMAR TU ENTREVISTA:',
    `1. Haz clic en el enlace directo de arriba, o entra a ${portalUrl} e ingresa tu código ${params.accessCode}.`,
    '2. Puedes responder por voz (grabando y transcribiendo automáticamente) o escribiendo con tu teclado, y añadir fotografías con su descripción.',
    '3. Cada respuesta queda guardada automáticamente: puedes pausar en cualquier momento y retomar desde el mismo enlace o código en el dispositivo que prefieras.',
    `4. Vigencia actual de tu entrevista: hasta el ${formattedExpiry}.`,
    '',
    'MANUAL BREVE DE USO EN PDF:',
    `Descarga aquí la guía paso a paso con capturas reales de la pantalla: ${manualPdfUrl}`,
    '',
    'Con cariño,',
    'Equipo YouForever (youforever.team@gmail.com)',
  ].join('\n');

  const escapeHtml = (s: string) =>
    s
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
              <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#fbbf24;font-family:Arial,sans-serif;font-weight:bold;">YOUFOREVER • TU HISTORIA DE VIDA</div>
              <h1 style="margin:8px 0 0;font-size:22px;line-height:1.3;color:#ffffff;font-weight:bold;">Bienvenido, ${escapeHtml(firstName)}</h1>
              <p style="margin:6px 0 0;font-size:13px;color:#d6d3d1;font-family:Arial,sans-serif;">${escapeHtml(modeLabel)} · ${escapeHtml(params.interviewTitle)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#292524;">
              <p style="margin:0 0 16px;">Hola <strong>${escapeHtml(params.participantName)}</strong>, tu espacio personal en <strong>YouForever</strong> ya está activo para contar tu historia por voz o por escrito, incorporar fotografías y crear tu libro autobiográfico.</p>

              <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:18px;margin-bottom:20px;text-align:center;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:#92400e;font-weight:bold;">Tu Código de Acceso</div>
                <div style="font-family:'Courier New',monospace;font-size:26px;font-weight:bold;letter-spacing:3px;color:#1c1917;margin:8px 0 12px;">${escapeHtml(params.accessCode)}</div>
                <a href="${escapeHtml(directUrl)}" style="display:inline-block;background:#b45309;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 22px;border-radius:10px;">Entrar directo a mi entrevista</a>
                <div style="margin-top:10px;font-size:11px;color:#78716c;word-break:break-all;">Enlace directo: <a href="${escapeHtml(directUrl)}" style="color:#92400e;">${escapeHtml(directUrl)}</a></div>
              </div>

              <h2 style="font-size:15px;margin:0 0 8px;color:#1c1917;">Cómo iniciar y retomar tu entrevista</h2>
              <ol style="margin:0 0 18px;padding-left:20px;color:#44403c;font-size:13px;">
                <li style="margin-bottom:6px;">Abre tu enlace directo o ingresa a <a href="${escapeHtml(portalUrl)}" style="color:#b45309;">${escapeHtml(portalUrl)}</a> e introduce el código <strong>${escapeHtml(params.accessCode)}</strong>.</li>
                <li style="margin-bottom:6px;">Responde cada pregunta grabando tu voz o escribiendo con el teclado, y añade fotografías con su descripción.</li>
                <li style="margin-bottom:6px;">Puedes cerrar la página cuando quieras y retomar exactamente donde te quedaste usando este mismo enlace o código.</li>
                <li>Al finalizar, configura el diseño de tu libro en <strong>Mi Libro &amp; Maquetación</strong> y descárgalo en PDF (vigencia hasta el <strong>${escapeHtml(formattedExpiry)}</strong>).</li>
              </ol>

              <div style="background:#f5f5f4;border:1px solid #e7e5e4;border-radius:10px;padding:14px 16px;margin-bottom:16px;">
                <div style="font-weight:bold;font-size:13px;color:#1c1917;margin-bottom:4px;">Manual breve de usuario en PDF</div>
                <div style="font-size:12px;color:#57534e;margin-bottom:10px;">Incluye capturas reales de la pantalla explicando ingreso, respuestas por voz/texto, fotos, cierre y maquetación del libro.</div>
                <a href="${escapeHtml(manualPdfUrl)}" style="display:inline-block;background:#1c1917;color:#ffffff;text-decoration:none;font-weight:bold;font-size:12px;padding:8px 14px;border-radius:8px;">Descargar Manual en PDF</a>
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
