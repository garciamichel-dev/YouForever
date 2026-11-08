import React, { useState } from 'react';
import {
  Shield,
  ShieldCheck,
  FileText,
  Lock,
  Check,
  X,
  AlertCircle,
  Eye,
  RefreshCw,
  Sparkles,
  ChevronRight,
  Info,
} from 'lucide-react';
import {
  SIMPLIFIED_PRIVACY_NOTICE,
  COMPREHENSIVE_PRIVACY_NOTICE,
  PRIVACY_NOTICE_VERSION,
  PRIVACY_NOTICE_EFFECTIVE_DATE,
} from '../logic/privacyNoticeContent.ts';
import { ForeverYouLogo } from './ForeverYouLogo';
import { buildConsentDeclarationText } from '../logic/privacyRules.ts';

interface PrivacyConsentScreenProps {
  participantName: string;
  interviewTitle: string;
  onAccept: () => Promise<void>;
  onReject?: () => void;
}

export const PrivacyConsentScreen: React.FC<PrivacyConsentScreenProps> = ({
  participantName,
  interviewTitle,
  onAccept,
  onReject,
}) => {
  const [isChecked, setIsChecked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rejectedNotice, setRejectedNotice] = useState(false);
  const [activeDocView, setActiveDocView] = useState<'none' | 'simplified' | 'comprehensive'>('none');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const declarationText = buildConsentDeclarationText(participantName);

  const handleConfirm = async () => {
    if (!isChecked) return;
    setErrorMsg(null);
    setIsSubmitting(true);
    try {
      await onAccept();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al guardar el consentimiento en el servidor.');
      setIsSubmitting(false);
    }
  };

  const handleDecline = () => {
    setRejectedNotice(true);
    if (onReject) onReject();
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Main Privacy Card */}
      <div className="bg-white rounded-3xl border border-stone-200 shadow-sm p-6 sm:p-10 space-y-6">
        {/* Title & Badge */}
        <div className="space-y-3 text-center sm:text-left">
          <div className="flex flex-wrap items-center justify-center sm:justify-between gap-3">
            <ForeverYouLogo variant="horizontal" theme="navy" size="md" />
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-900 text-xs font-semibold">
              <Shield className="w-3.5 h-3.5 text-amber-800" />
              <span>ForeverYou • Protección de Patrimonio Testimonial</span>
            </div>
          </div>

          <h2 className="font-serif text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
            Antes de comenzar tu historia
          </h2>

          <div className="text-stone-700 text-sm sm:text-base leading-relaxed space-y-2 pt-1">
            <p className="font-medium text-stone-900">
              Tu historia es única y merece ser protegida.
            </p>
            <p>
              En ForeverYou queremos ayudarte a conservar tus recuerdos, experiencias, fotografías y testimonios para crear tu libro autobiográfico.
            </p>
            <p>
              Antes de comenzar, queremos explicarte cómo utilizaremos tu información, quién podrá acceder a ella y qué derechos tienes.
            </p>
            <p className="font-serif italic text-amber-900 font-semibold">
              «Tu historia te pertenece. Tú decides qué compartir y con quién.»
            </p>
          </div>
        </div>

        {/* Section: Tu privacidad es importante */}
        <div className="bg-stone-50 border border-stone-200 rounded-2xl p-5 sm:p-6 space-y-3.5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0" />
            <h3 className="font-serif font-bold text-stone-900 text-base">
              Tu privacidad es importante
            </h3>
          </div>

          <ul className="space-y-2 text-xs sm:text-sm text-stone-700">
            <li className="flex items-start gap-2">
              <span className="text-amber-700 font-bold">•</span>
              <span>Tus testimonios se utilizarán para construir tu libro autobiográfico.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-700 font-bold">•</span>
              <span>Tus grabaciones de voz podrán convertirse en texto.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-700 font-bold">•</span>
              <span>Tus fotografías podrán incorporarse a tus recuerdos y a tu libro.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-700 font-bold">•</span>
              <span>Tus experiencias podrán procesarse mediante herramientas de inteligencia artificial para elaborar tu historia.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-700 font-bold">•</span>
              <span>La información no será pública automáticamente.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-700 font-bold">•</span>
              <span>Podrás solicitar acceso, rectificación, cancelación u oposición al tratamiento de tus datos conforme a la ley.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-700 font-bold">•</span>
              <span>Tu información solo se compartirá de acuerdo con las finalidades y autorizaciones aplicables.</span>
            </li>
          </ul>

          {/* Links to consult documents without losing screen state */}
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-stone-200">
            <button
              type="button"
              onClick={() => setActiveDocView('simplified')}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 hover:text-amber-900 underline underline-offset-4 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Leer aviso de privacidad simplificado</span>
            </button>

            <span className="text-stone-300">|</span>

            <button
              type="button"
              onClick={() => setActiveDocView('comprehensive')}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 hover:text-amber-900 underline underline-offset-4 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Leer aviso de privacidad integral</span>
            </button>
          </div>
        </div>

        {/* Identificación del participante */}
        <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <span className="text-[11px] uppercase tracking-wider font-bold text-amber-900">
              Identificación verificada del participante:
            </span>
            <div className="font-serif text-lg font-bold text-stone-900">
              Nombre del participante: <span className="text-amber-950 underline">{participantName}</span>
            </div>
            <div className="text-xs text-stone-500 mt-0.5">
              Entrevista: {interviewTitle} • Autenticación segura vinculada
            </div>
          </div>
        </div>

        {/* Casilla única y declaración breve de aceptación */}
        <div className="space-y-3 pt-1">
          <label className="flex items-center gap-3.5 p-4 sm:p-5 rounded-2xl border-2 border-amber-400/80 bg-amber-50/30 hover:bg-amber-50/60 cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={isChecked}
              onChange={(e) => {
                setIsChecked(e.target.checked);
                if (rejectedNotice) setRejectedNotice(false);
              }}
              className="w-5 h-5 rounded border-stone-400 text-amber-700 focus:ring-amber-500 shrink-0 cursor-pointer"
            />
            <div className="text-xs sm:text-sm font-medium text-stone-900 leading-relaxed font-sans text-left select-none">
              {declarationText}
            </div>
          </label>
        </div>

        {/* Error notification */}
        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-800">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Rejection respectful banner */}
        {rejectedNotice && (
          <div className="p-4 bg-stone-100 border border-stone-300 rounded-2xl text-xs text-stone-800 space-y-1">
            <div className="font-bold text-stone-900 text-sm">Respetamos tu decisión.</div>
            <p>
              Para proteger tu información, no iniciaremos la entrevista sin tu autorización.
              Puedes volver en cualquier momento cuando desees comenzar tu historia.
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={handleDecline}
            disabled={isSubmitting}
            className="w-full sm:w-auto px-5 py-2.5 text-xs font-semibold text-stone-600 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 rounded-xl transition cursor-pointer"
          >
            No acepto
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={!isChecked || isSubmitting}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-bold text-white bg-amber-700 hover:bg-amber-800 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl shadow-md transition-all cursor-pointer transform hover:scale-[1.01]"
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Guardando en Firebase...</span>
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>Confirmar mi identidad, aceptar y comenzar</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Modal / Drawer for Reading Notices Completely without losing screen state */}
      {activeDocView !== 'none' && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-stone-200">
            {/* Modal Header */}
            <div className="p-5 border-b border-stone-200 flex items-center justify-between">
              <div>
                <h3 className="font-serif font-bold text-stone-900 text-base">
                  {activeDocView === 'simplified'
                    ? 'Aviso de Privacidad Simplificado'
                    : 'Aviso de Privacidad Integral'}
                </h3>
                <span className="text-[11px] text-stone-500">
                  ForeverYou • Versión {PRIVACY_NOTICE_VERSION} ({PRIVACY_NOTICE_EFFECTIVE_DATE})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveDocView('none')}
                className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-100 cursor-pointer"
                title="Cerrar documento"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body with full readable text */}
            <div className="p-6 overflow-y-auto space-y-4 text-xs sm:text-sm text-stone-800 font-sans leading-relaxed">
              <pre className="whitespace-pre-wrap font-sans text-xs sm:text-sm leading-relaxed text-stone-700">
                {activeDocView === 'simplified'
                  ? SIMPLIFIED_PRIVACY_NOTICE
                  : COMPREHENSIVE_PRIVACY_NOTICE}
              </pre>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-stone-200 flex justify-end">
              <button
                type="button"
                onClick={() => setActiveDocView('none')}
                className="px-5 py-2 text-xs font-bold text-white bg-amber-800 hover:bg-amber-900 rounded-xl cursor-pointer"
              >
                Entendido y cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
