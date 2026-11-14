import nodemailer from 'nodemailer';
import {
  buildSelfRegisterWelcomeEmail,
  CANONICAL_PUBLIC_ORIGIN,
} from '../logic/freeRegistration.ts';
import { StoryMode } from '../logic/interviewRules.ts';

export interface EmailConfigStatus {
  configured: boolean;
  provider: 'gmail_smtp';
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  missingReason?: string;
}

export interface EmailSendResult {
  sent: boolean;
  recipientEmail: string;
  participantId: string;
  participantName: string;
  messageId?: string;
  error?: string;
  attemptedAt: string;
}

export interface MailTransporterLike {
  sendMail: (mailOptions: {
    from: string;
    to: string;
    replyTo?: string;
    subject: string;
    text: string;
    html: string;
    headers?: Record<string, string>;
  }) => Promise<{ messageId?: string }>;
}

export function getEmailConfigStatus(): EmailConfigStatus {
  const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = Number(process.env.SMTP_PORT || 465) || 465;
  const secure =
    process.env.SMTP_SECURE !== undefined
      ? process.env.SMTP_SECURE.toLowerCase() === 'true'
      : port === 465;
  const user = (process.env.SMTP_USER || 'youforever.team@gmail.com').trim();
  const pass = (process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || '').trim();
  const from = (process.env.EMAIL_FROM || `YouForever <${user}>`).trim();

  if (!pass) {
    return {
      configured: false,
      provider: 'gmail_smtp',
      host,
      port,
      secure,
      user,
      from,
      missingReason:
        'Falta configurar la variable de entorno SMTP_PASS (Contraseña de Aplicación de Google para youforever.team@gmail.com).',
    };
  }

  return {
    configured: true,
    provider: 'gmail_smtp',
    host,
    port,
    secure,
    user,
    from,
  };
}

export async function sendSelfRegisterParticipantEmail(params: {
  participantId: string;
  participantName: string;
  recipientEmail: string;
  interviewTitle: string;
  storyMode: StoryMode;
  role: 'primary' | 'contributor';
  accessCode: string;
  directUrl: string;
  manualPdfUrl: string;
  portalUrl: string;
  expiresAtIso: string;
  transporterOverride?: MailTransporterLike;
}): Promise<EmailSendResult> {
  const attemptedAt = new Date().toISOString();
  const recipientEmail = (params.recipientEmail || '').trim();

  if (!recipientEmail) {
    return {
      sent: false,
      recipientEmail,
      participantId: params.participantId,
      participantName: params.participantName,
      error: 'El participante no tiene un correo electrónico registrado.',
      attemptedAt,
    };
  }

  const normalizeUrl = (raw: string) =>
    String(raw || '').replace(/^https?:\/\/www\.youforever\.app/i, CANONICAL_PUBLIC_ORIGIN);

  const emailContent = buildSelfRegisterWelcomeEmail({
    participantName: params.participantName,
    interviewTitle: params.interviewTitle,
    storyMode: params.storyMode,
    role: params.role,
    accessCode: params.accessCode,
    directUrl: normalizeUrl(params.directUrl),
    manualPdfUrl: normalizeUrl(params.manualPdfUrl),
    portalUrl: normalizeUrl(params.portalUrl),
    expiresAtIso: params.expiresAtIso,
  });

  const transactionalHeaders = {
    'X-Auto-Response-Suppress': 'OOF, AutoReply',
  };

  if (params.transporterOverride) {
    try {
      const from = (process.env.EMAIL_FROM || 'YouForever <youforever.team@gmail.com>').trim();
      const info = await params.transporterOverride.sendMail({
        from,
        to: recipientEmail,
        replyTo: 'youforever.team@gmail.com',
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
        headers: transactionalHeaders,
      });
      return {
        sent: true,
        recipientEmail,
        participantId: params.participantId,
        participantName: params.participantName,
        messageId: info?.messageId,
        attemptedAt,
      };
    } catch (err: unknown) {
      return {
        sent: false,
        recipientEmail,
        participantId: params.participantId,
        participantName: params.participantName,
        error: err instanceof Error ? err.message : 'Error al enviar correo SMTP.',
        attemptedAt,
      };
    }
  }

  const config = getEmailConfigStatus();
  if (!config.configured) {
    return {
      sent: false,
      recipientEmail,
      participantId: params.participantId,
      participantName: params.participantName,
      error:
        config.missingReason ||
        'El servicio de correo SMTP de Gmail no está configurado en el servidor.',
      attemptedAt,
    };
  }

  const pass = (process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || '').trim();

  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass,
      },
      connectionTimeout: 12000,
      greetingTimeout: 12000,
      socketTimeout: 15000,
    });

    const info = await transporter.sendMail({
      from: config.from,
      to: recipientEmail,
      replyTo: config.user,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
      headers: transactionalHeaders,
    });

    return {
      sent: true,
      recipientEmail,
      participantId: params.participantId,
      participantName: params.participantName,
      messageId: info.messageId,
      attemptedAt,
    };
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    let friendlyError = `No se pudo enviar el correo vía Gmail SMTP (${config.user}): ${rawMsg}`;
    if (/Invalid login|535|Username and Password not accepted/i.test(rawMsg)) {
      friendlyError = `Error de autenticación con Gmail SMTP para ${config.user}. Verifica que SMTP_PASS corresponda a una Contraseña de Aplicación (App Password) activa de Google.`;
    }
    return {
      sent: false,
      recipientEmail,
      participantId: params.participantId,
      participantName: params.participantName,
      error: friendlyError,
      attemptedAt,
    };
  }
}
