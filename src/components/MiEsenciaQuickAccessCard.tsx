/**
 * V5.5.0 — Interviewee's quick access to «Mi Esencia», shown right below «Tu Libro Autobiográfico
 * en PDF» once the final version of the book is saved. One click prepares the digital
 * representation (or reuses the existing one), shows the direct link and the access code, and
 * offers to send both by email.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Loader2, Mail, MessageCircle, Sparkles } from 'lucide-react';
import type { MiEsenciaParticipantQuickAccess } from '../logic/miEsenciaQuickAccess.ts';

interface Props {
  token: string;
  participantEmail?: string;
  /** Changes when a new book version is saved (refreshes the eligibility). */
  refreshKey?: string | number;
}

type EmailStep = 'ask' | 'form' | 'sending' | 'sent' | 'declined';

async function postJson(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error || 'No se pudo completar la solicitud.');
  return json.data;
}

export const MiEsenciaQuickAccessCard: React.FC<Props> = ({ token, participantEmail, refreshKey }) => {
  const [eligible, setEligible] = useState(false);
  const [access, setAccess] = useState<MiEsenciaParticipantQuickAccess | null>(null);
  const [accessUrl, setAccessUrl] = useState<string>('');
  const [isActivating, setIsActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [emailStep, setEmailStep] = useState<EmailStep | null>(null);
  const [email, setEmail] = useState(participantEmail || '');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState('');

  useEffect(() => {
    let cancelled = false;
    postJson('/api/participant/mi-esencia/status', { token })
      .then((data) => {
        if (cancelled) return;
        setEligible(Boolean(data.eligible));
        setAccess(data.access || null);
        setAccessUrl(data.accessUrl || '');
      })
      .catch(() => {
        if (!cancelled) setEligible(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, refreshKey]);

  const handleActivate = async () => {
    setIsActivating(true);
    setError(null);
    try {
      const data = await postJson('/api/participant/mi-esencia/activate', { token });
      setAccess(data.access);
      setAccessUrl(data.accessUrl || '');
      if (data.suggestedEmail && !email) setEmail(data.suggestedEmail);
      setEmailStep('ask');
    } catch (err) {
      setError((err as Error).message || 'No pudimos preparar tu acceso. Inténtalo de nuevo en unos minutos.');
    } finally {
      setIsActivating(false);
    }
  };

  const handleSendEmail = async () => {
    setEmailError(null);
    setEmailStep('sending');
    try {
      const data = await postJson('/api/participant/mi-esencia/send-email', { token, email: email.trim() });
      setSentTo(data.recipientEmail || email.trim());
      setEmailStep('sent');
    } catch (err) {
      setEmailError((err as Error).message);
      setEmailStep('form');
    }
  };

  const copy = useCallback(async (value: string, which: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard not available: the value stays visible to copy by hand.
    }
  }, []);

  if (!eligible) return null;

  const directPath = access?.privateLinkPath || '';
  const shownUrl = accessUrl || (directPath ? `${window.location.origin}${directPath}` : '');

  return (
    <div
      data-testid="mi-esencia-quick-access"
      className="bg-gradient-to-br from-amber-50 via-white to-stone-50 border border-amber-200 rounded-3xl p-6 sm:p-8 shadow-sm"
    >
      <div className="flex flex-col lg:flex-row lg:items-start gap-6">
        <div className="flex-1 space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 border border-amber-200 text-amber-900 text-xs font-semibold tracking-wide uppercase">
            <Sparkles className="w-3.5 h-3.5" />
            Mi Esencia
          </div>
          <h3 className="text-xl sm:text-2xl font-serif font-bold text-stone-900">
            Ya puedes entrar a «Mi Esencia» y conversar con tu representación digital
          </h3>
          <p className="text-sm text-stone-600 leading-relaxed max-w-2xl">
            Con las respuestas de tu entrevista preparamos tu representación digital. Está lista para conversar:
            entra directo, sin configurar nada.
          </p>
        </div>

        {!access && (
          <div className="shrink-0">
            <button
              type="button"
              onClick={handleActivate}
              disabled={isActivating}
              data-testid="btn-mi-esencia-activate"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-amber-700 hover:bg-amber-600 disabled:opacity-70 text-white text-sm font-semibold shadow-xs transition-colors cursor-pointer"
            >
              {isActivating ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
              {isActivating ? 'Preparando tu representación digital…' : 'Entrar a Mi Esencia'}
            </button>
          </div>
        )}
      </div>

      {error && <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">{error}</div>}

      {access && !access.available && (
        <div className="mt-5 text-sm text-amber-950 bg-amber-100/70 border border-amber-200 rounded-xl p-4">
          {access.unavailableReason ||
            'Tu acceso a Mi Esencia no está disponible en este momento. Escríbenos a youforever.team@gmail.com.'}
        </div>
      )}

      {access && access.available && (
        <div className="mt-6 space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-white border border-amber-200 rounded-2xl p-4 text-center">
              <div className="text-[11px] uppercase tracking-widest text-amber-800 font-bold">Tu código de acceso</div>
              <div
                className="font-mono text-2xl font-bold tracking-[0.2em] text-stone-900 my-2 break-all"
                data-testid="mi-esencia-access-code"
              >
                {access.personalCode}
              </div>
              <button
                type="button"
                onClick={() => copy(access.personalCode, 'code')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 hover:text-amber-900 cursor-pointer"
              >
                {copied === 'code' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied === 'code' ? 'Copiado' : 'Copiar código'}
              </button>
            </div>
            <div className="bg-white border border-amber-200 rounded-2xl p-4">
              <div className="text-[11px] uppercase tracking-widest text-amber-800 font-bold text-center">
                Tu enlace directo
              </div>
              <div className="text-xs text-stone-700 my-2 break-all text-center" data-testid="mi-esencia-access-link">
                {shownUrl}
              </div>
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => copy(shownUrl, 'link')}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 hover:text-amber-900 cursor-pointer"
                >
                  {copied === 'link' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied === 'link' ? 'Copiado' : 'Copiar enlace'}
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href={directPath}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="btn-mi-esencia-open"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-sm font-semibold shadow-xs transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Conversar ahora con mi representación digital
            </a>
            <span className="text-xs text-stone-500">
              Hasta {access.dailyMessageQuota} mensajes por día · {access.planName}
              {access.expiresAt
                ? ` · vigente hasta el ${new Date(access.expiresAt).toLocaleDateString('es-MX', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}`
                : ''}
            </span>
          </div>

          <p className="text-xs text-stone-500 leading-relaxed">
            Es un código general: tu representación digital no sabe quién le escribe. Compártelo solo con quien tú
            quieras.
          </p>

          {/* Email offer */}
          {emailStep === 'ask' && (
            <div className="bg-stone-100 border border-stone-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-2 text-sm text-stone-800 flex-1">
                <Mail className="w-4 h-4 text-amber-700 shrink-0" />
                ¿Quieres que te enviemos tu enlace y tu código por correo electrónico?
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEmailStep('form')}
                  data-testid="btn-mi-esencia-email-yes"
                  className="px-4 py-2 rounded-xl bg-amber-700 hover:bg-amber-600 text-white text-xs font-semibold cursor-pointer"
                >
                  Sí, envíamelo
                </button>
                <button
                  type="button"
                  onClick={() => setEmailStep('declined')}
                  className="px-4 py-2 rounded-xl bg-white hover:bg-stone-50 border border-stone-300 text-stone-700 text-xs font-semibold cursor-pointer"
                >
                  No, gracias
                </button>
              </div>
            </div>
          )}

          {(emailStep === 'form' || emailStep === 'sending') && (
            <form
              className="bg-stone-100 border border-stone-200 rounded-2xl p-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSendEmail();
              }}
            >
              <label className="block text-sm text-stone-800" htmlFor="mi-esencia-email">
                ¿A qué correo te lo enviamos?
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="mi-esencia-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@correo.com"
                  className="flex-1 px-3 py-2 rounded-xl border border-stone-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <button
                  type="submit"
                  disabled={emailStep === 'sending'}
                  data-testid="btn-mi-esencia-email-send"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-amber-700 hover:bg-amber-600 disabled:opacity-70 text-white text-xs font-semibold cursor-pointer"
                >
                  {emailStep === 'sending' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                  Enviar
                </button>
              </div>
              {emailError && <div className="text-xs text-red-700">{emailError}</div>}
            </form>
          )}

          {emailStep === 'sent' && (
            <div className="text-sm text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600" />
              Listo: te enviamos tu enlace y tu código a <strong>{sentTo}</strong>.
            </div>
          )}

          {(emailStep === null || emailStep === 'declined') && (
            <button
              type="button"
              onClick={() => setEmailStep('form')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 hover:text-amber-900 cursor-pointer"
            >
              <Mail className="w-3.5 h-3.5" />
              Enviarme el enlace y el código por correo
            </button>
          )}
        </div>
      )}
    </div>
  );
};
