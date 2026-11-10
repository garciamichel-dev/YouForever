import React, { useState } from 'react';
import {
  Shield,
  CheckCircle2,
  Lock,
  FileText,
  AlertCircle,
  HelpCircle,
  HeartHandshake,
  UserCheck,
  ChevronRight,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import {
  PrivacyDeclarations,
  CURRENT_PRIVACY_POLICY_VERSION,
  CURRENT_PRIVACY_POLICY_DATE,
  RESPONSIBLE_CONTACT_EMAIL,
} from '../logic/interviewRules.ts';
import { ForeverYouLogo } from './ForeverYouLogo';
import { IntegralPrivacyNoticeModal } from './IntegralPrivacyNoticeModal.tsx';
import { safeFetchJson } from '../utils/safeApi.ts';

interface ConsentScreenProps {
  participantName: string;
  interviewTitle: string;
  storyMode: 'individual' | 'compartida';
  token: string;
  onConsentAccepted: (consentData: any) => void;
  onOpenFaq?: () => void;
}

export const ConsentScreen: React.FC<ConsentScreenProps> = ({
  participantName,
  interviewTitle,
  storyMode,
  token,
  onConsentAccepted,
  onOpenFaq,
}) => {
  // NONE of the declarations are pre-checked (compliance requirement)
  const [declarations, setDeclarations] = useState<PrivacyDeclarations>({
    declarationA_acknowledgement: false,
    declarationB_necessaryProcessing: false,
    declarationC_sensitiveData: false,
    declarationD_financialData: false,
    declarationE_aiAssistant: false,
    declarationF_shareWithFamily: false,
    declarationG_promotionalUse: false,
  });

  const [confirmedIdentity, setConfirmedIdentity] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [userDeclined, setUserDeclined] = useState(false);
  const [isFullNoticeOpen, setIsFullNoticeOpen] = useState(false);

  const handleToggle = (key: keyof PrivacyDeclarations) => {
    setDeclarations((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
    setErrorMessage(null);
  };

  const canAccept =
    declarations.declarationA_acknowledgement &&
    declarations.declarationB_necessaryProcessing &&
    confirmedIdentity &&
    !isSubmitting;

  const handleAccept = async () => {
    if (!declarations.declarationA_acknowledgement || !declarations.declarationB_necessaryProcessing) {
      setErrorMessage(
        'Las Declaraciones A y B son necesarias para crear y preservar tu libro autobiográfico.'
      );
      return;
    }
    if (!confirmedIdentity) {
      setErrorMessage(
        'Por favor confirma que eres la persona identificada antes de comenzar.'
      );
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      const res = await safeFetchJson<{
        success: boolean;
        data?: any;
        error?: string;
      }>('/api/participant/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          declarations,
          confirmedIdentity: true,
          confirmedParticipantName: participantName,
        }),
      });

      if (res.success && res.data) {
        onConsentAccepted(res.data);
      } else {
        setErrorMessage(res.error || 'Hubo un error al registrar el consentimiento en el servidor.');
      }
    } catch (_err: unknown) {
      setErrorMessage('Error de conexión al guardar tu consentimiento. Por favor intenta de nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (userDeclined) {
    return (
      <div className="max-w-xl mx-auto my-12 bg-white p-8 rounded-3xl border border-stone-200 shadow-md text-stone-800 text-center space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-stone-100 text-stone-600 flex items-center justify-center mx-auto">
          <Shield className="w-8 h-8 text-stone-500" />
        </div>
        <div className="space-y-2">
          <h2 className="font-serif text-2xl font-bold text-stone-900">
            Respetamos tu decisión
          </h2>
          <p className="text-sm text-stone-600 leading-relaxed max-w-md mx-auto">
            Para proteger tu privacidad y tus datos personales conforme a la ley, no iniciaremos la entrevista ni recopilaremos información sin las autorizaciones necesarias.
          </p>
        </div>
        <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-xs text-amber-900 text-left space-y-1">
          <p className="font-semibold">¿Cambiaste de opinión o deseas revisar los términos?</p>
          <p>
            Puedes volver a la pantalla de consentimiento en cualquier momento o comunicarte con nuestro responsable de privacidad en{' '}
            <a href={`mailto:${RESPONSIBLE_CONTACT_EMAIL}`} className="underline font-mono">
              {RESPONSIBLE_CONTACT_EMAIL}
            </a>.
          </p>
        </div>
        <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setUserDeclined(false)}
            className="w-full sm:w-auto px-6 py-3 bg-amber-800 hover:bg-amber-900 text-white rounded-xl text-sm font-semibold transition cursor-pointer shadow-sm"
          >
            Revisar y otorgar autorizaciones
          </button>
          {onOpenFaq && (
            <button
              type="button"
              onClick={onOpenFaq}
              className="w-full sm:w-auto px-5 py-3 border border-stone-300 text-stone-700 hover:bg-stone-50 rounded-xl text-xs font-semibold transition cursor-pointer"
            >
              Preguntas Frecuentes
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8 pb-16 px-4">
      {/* Brand Header */}
      <div className="text-center space-y-3 pt-4">
        <div className="flex justify-center">
          <ForeverYouLogo variant="stacked" theme="navy" size="md" />
        </div>
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-amber-100/80 text-amber-950 text-xs font-semibold tracking-wide border border-amber-200">
          <Shield className="w-3.5 h-3.5 text-amber-800" />
          <span>Consentimiento Informado Obligatorio • YouForever</span>
        </div>
        <h1 className="font-serif text-3xl sm:text-4xl font-bold text-stone-900 leading-tight">
          Antes de comenzar tu historia
        </h1>
        <p className="text-sm sm:text-base text-stone-600 max-w-lg mx-auto font-sans leading-relaxed">
          Tu historia es única y merece ser protegida.
        </p>
      </div>

      {/* Intro Warm Narrative Box */}
      <div className="bg-amber-50/70 border border-amber-200/90 rounded-3xl p-6 sm:p-7 shadow-xs text-stone-800 space-y-3">
        <p className="text-sm leading-relaxed text-stone-700">
          En <strong>YouForever</strong> queremos ayudarte a conservar tus recuerdos, experiencias, fotografías y testimonios para crear tu libro autobiográfico.
        </p>
        <p className="text-sm leading-relaxed text-stone-700">
          Antes de comenzar, queremos explicarte con total claridad cómo utilizaremos tu información, quién podrá acceder a ella y qué derechos tienes.
        </p>
        <p className="text-sm font-serif font-bold text-amber-950 italic pt-1">
          «Tu historia te pertenece. Tú decides qué compartir y con quién».
        </p>
      </div>

      {/* Card: Tu privacidad es importante */}
      <div className="bg-white rounded-3xl p-6 sm:p-7 border border-stone-200 shadow-sm space-y-4">
        <div className="flex items-center space-x-2.5 text-amber-900 border-b border-stone-100 pb-3">
          <Lock className="w-5 h-5 text-amber-800" />
          <h2 className="font-serif text-lg font-bold text-stone-900">
            Tu privacidad es importante
          </h2>
        </div>

        <ul className="space-y-2.5 text-xs sm:text-sm text-stone-700">
          <li className="flex items-start space-x-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>Tus respuestas se utilizarán exclusivamente para construir tu historia autobiográfica.</span>
          </li>
          <li className="flex items-start space-x-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>Tus grabaciones de voz se convertirán en texto fiel para preparar tu libro.</span>
          </li>
          <li className="flex items-start space-x-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>Las fotografías que compartas podrán incorporarse a tus recuerdos y a tu libro.</span>
          </li>
          <li className="flex items-start space-x-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>Tu información no será pública automáticamente ni visible a terceros sin autorización.</span>
          </li>
          <li className="flex items-start space-x-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>Podrás solicitar acceso, corrección o eliminación de tus datos conforme a la ley (Derechos ARCO).</span>
          </li>
          <li className="flex items-start space-x-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>El uso de tu información para cualquier otra finalidad requerirá autorizaciones independientes.</span>
          </li>
        </ul>

        <div className="pt-2">
          <button
            type="button"
            onClick={() => setIsFullNoticeOpen(true)}
            className="inline-flex items-center space-x-1.5 text-xs sm:text-sm font-semibold text-amber-900 hover:text-amber-950 underline decoration-amber-600 underline-offset-4 cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            <span>Leer aviso de privacidad completo (17 secciones)</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Individual Declaration Checkboxes */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-lg font-bold text-stone-900">
            Declaraciones y autorizaciones
          </h3>
          <span className="text-[11px] text-stone-500">Ninguna casilla premarcada</span>
        </div>

        {/* Declaración A (Obligatoria) */}
        <label
          className={`flex items-start space-x-3.5 p-4 rounded-2xl border transition cursor-pointer ${
            declarations.declarationA_acknowledgement
              ? 'bg-amber-50/70 border-amber-400'
              : 'bg-white border-stone-200 hover:border-stone-300'
          }`}
        >
          <input
            type="checkbox"
            checked={declarations.declarationA_acknowledgement}
            onChange={() => handleToggle('declarationA_acknowledgement')}
            className="mt-1 w-5 h-5 rounded border-stone-300 text-amber-800 focus:ring-amber-700 cursor-pointer"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-900">
                Declaración A • Obligatoria
              </span>
            </div>
            <p className="text-xs sm:text-sm text-stone-800 font-medium leading-relaxed mt-0.5">
              He tenido acceso al Aviso de Privacidad Integral de YouForever y reconozco haber recibido información sobre el tratamiento de mis datos personales, sus finalidades y mis derechos.
            </p>
          </div>
        </label>

        {/* Declaración B (Obligatoria) */}
        <label
          className={`flex items-start space-x-3.5 p-4 rounded-2xl border transition cursor-pointer ${
            declarations.declarationB_necessaryProcessing
              ? 'bg-amber-50/70 border-amber-400'
              : 'bg-white border-stone-200 hover:border-stone-300'
          }`}
        >
          <input
            type="checkbox"
            checked={declarations.declarationB_necessaryProcessing}
            onChange={() => handleToggle('declarationB_necessaryProcessing')}
            className="mt-1 w-5 h-5 rounded border-stone-300 text-amber-800 focus:ring-amber-700 cursor-pointer"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-900">
                Declaración B • Obligatoria para crear el libro
              </span>
            </div>
            <p className="text-xs sm:text-sm text-stone-800 font-medium leading-relaxed mt-0.5">
              Autorizo el tratamiento de los datos personales que proporcione durante mi entrevista, incluidos mis testimonios escritos, grabaciones y fotografías, para registrar, preservar, organizar y elaborar mi libro autobiográfico mediante YouForever y sus proveedores tecnológicos autorizados, conforme al Aviso de Privacidad.
            </p>
          </div>
        </label>

        {/* Declaración C (Sensibles - Independiente) */}
        <label
          className={`flex items-start space-x-3.5 p-4 rounded-2xl border transition cursor-pointer ${
            declarations.declarationC_sensitiveData
              ? 'bg-stone-50 border-amber-300'
              : 'bg-white border-stone-200 hover:border-stone-300'
          }`}
        >
          <input
            type="checkbox"
            checked={declarations.declarationC_sensitiveData}
            onChange={() => handleToggle('declarationC_sensitiveData')}
            className="mt-1 w-5 h-5 rounded border-stone-300 text-amber-800 focus:ring-amber-700 cursor-pointer"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold uppercase tracking-wider text-stone-700">
                Declaración C • Datos Sensibles (Expresa)
              </span>
            </div>
            <p className="text-xs sm:text-sm text-stone-800 leading-relaxed mt-0.5">
              Consiento expresamente el tratamiento de los datos personales sensibles que voluntariamente decida compartir en mis recuerdos (como salud, creencias o vida personal), para incorporarlos, cuando corresponda, a mi historia autobiográfica y procesarlos mediante las funciones del servicio descritas en el Aviso de Privacidad.
            </p>
          </div>
        </label>

        {/* Declaración D (Patrimoniales/Financieros) */}
        <label
          className={`flex items-start space-x-3.5 p-4 rounded-2xl border transition cursor-pointer ${
            declarations.declarationD_financialData
              ? 'bg-stone-50 border-amber-300'
              : 'bg-white border-stone-200 hover:border-stone-300'
          }`}
        >
          <input
            type="checkbox"
            checked={declarations.declarationD_financialData}
            onChange={() => handleToggle('declarationD_financialData')}
            className="mt-1 w-5 h-5 rounded border-stone-300 text-amber-800 focus:ring-amber-700 cursor-pointer"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold uppercase tracking-wider text-stone-700">
                Declaración D • Datos Financieros o Patrimoniales
              </span>
            </div>
            <p className="text-xs sm:text-sm text-stone-800 leading-relaxed mt-0.5">
              Consiento expresamente el tratamiento de circunstancias patrimoniales o familiares que decida relatar voluntariamente en mis recuerdos, conforme a las finalidades del servicio.
            </p>
          </div>
        </label>

        {/* Declaración E (Asistente con IA - Opcional) */}
        <label
          className={`flex items-start space-x-3.5 p-4 rounded-2xl border transition cursor-pointer ${
            declarations.declarationE_aiAssistant
              ? 'bg-stone-50 border-amber-300'
              : 'bg-white border-stone-200 hover:border-stone-300'
          }`}
        >
          <input
            type="checkbox"
            checked={declarations.declarationE_aiAssistant}
            onChange={() => handleToggle('declarationE_aiAssistant')}
            className="mt-1 w-5 h-5 rounded border-stone-300 text-amber-800 focus:ring-amber-700 cursor-pointer"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold uppercase tracking-wider text-stone-600">
                Declaración E • Asistente Conversacional (Opcional)
              </span>
            </div>
            <p className="text-xs sm:text-sm text-stone-800 leading-relaxed mt-0.5">
              Autorizo que mis testimonios sean utilizados para crear un asistente conversacional personalizado basado en mi historia, exclusivamente bajo las condiciones de acceso y uso que yo autorice.
            </p>
          </div>
        </label>

        {/* Declaración F (Compartir con familiares - Opcional) */}
        <label
          className={`flex items-start space-x-3.5 p-4 rounded-2xl border transition cursor-pointer ${
            declarations.declarationF_shareWithFamily
              ? 'bg-stone-50 border-amber-300'
              : 'bg-white border-stone-200 hover:border-stone-300'
          }`}
        >
          <input
            type="checkbox"
            checked={declarations.declarationF_shareWithFamily}
            onChange={() => handleToggle('declarationF_shareWithFamily')}
            className="mt-1 w-5 h-5 rounded border-stone-300 text-amber-800 focus:ring-amber-700 cursor-pointer"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold uppercase tracking-wider text-stone-600">
                Declaración F • Compartir con familiares o designados (Opcional)
              </span>
            </div>
            <p className="text-xs sm:text-sm text-stone-800 leading-relaxed mt-0.5">
              Autorizo que los contenidos que seleccione expresamente puedan compartirse con las personas que designe, bajo los permisos y condiciones que establezca.
            </p>
          </div>
        </label>

        {/* Declaración G (Uso promocional - Opcional) */}
        <label
          className={`flex items-start space-x-3.5 p-4 rounded-2xl border transition cursor-pointer ${
            declarations.declarationG_promotionalUse
              ? 'bg-stone-50 border-amber-300'
              : 'bg-white border-stone-200 hover:border-stone-300'
          }`}
        >
          <input
            type="checkbox"
            checked={declarations.declarationG_promotionalUse}
            onChange={() => handleToggle('declarationG_promotionalUse')}
            className="mt-1 w-5 h-5 rounded border-stone-300 text-amber-800 focus:ring-amber-700 cursor-pointer"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold uppercase tracking-wider text-stone-600">
                Declaración G • Uso Promocional (Opcional)
              </span>
            </div>
            <p className="text-xs sm:text-sm text-stone-800 leading-relaxed mt-0.5">
              Autorizo que los testimonios o materiales que seleccione específicamente puedan utilizarse con fines promocionales de YouForever.
            </p>
          </div>
        </label>
      </div>

      {/* Identificación y Confirmación Personal */}
      <div className="bg-stone-50 p-6 rounded-3xl border border-stone-200 space-y-4">
        <div className="flex items-center space-x-2">
          <UserCheck className="w-5 h-5 text-amber-800" />
          <h4 className="font-serif font-bold text-stone-900 text-base">
            Identificación y firma electrónica de voluntad
          </h4>
        </div>

        <div className="p-3 bg-white rounded-2xl border border-stone-200 text-xs sm:text-sm space-y-1">
          <span className="text-stone-500 block text-xs">Participante activo:</span>
          <span className="font-bold text-stone-900 text-base sm:text-lg block">
            {participantName}
          </span>
          <span className="text-[11px] text-stone-400 block">
            Entrevista: «{interviewTitle}» ({storyMode === 'compartida' ? 'Historia Compartida' : 'Historia Individual'})
          </span>
        </div>

        <label className="flex items-start space-x-3 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={confirmedIdentity}
            onChange={(e) => {
              setConfirmedIdentity(e.target.checked);
              setErrorMessage(null);
            }}
            className="mt-1 w-5 h-5 rounded border-stone-300 text-amber-800 focus:ring-amber-700 cursor-pointer"
          />
          <span className="text-xs sm:text-sm text-stone-800 font-semibold leading-relaxed">
            Confirmo que soy la persona identificada ({participantName}) y que manifiesto libremente mi voluntad respecto de las autorizaciones seleccionadas.
          </span>
        </label>
      </div>

      {/* Error display */}
      {errorMessage && (
        <div className="p-4 bg-rose-50 border border-rose-300 rounded-2xl text-rose-900 text-xs sm:text-sm flex items-start space-x-2.5">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <span className="font-medium">{errorMessage}</span>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
        <button
          type="button"
          onClick={() => setUserDeclined(true)}
          className="w-full sm:w-auto px-6 py-3.5 border border-stone-300 text-stone-700 hover:bg-stone-100 rounded-2xl text-xs sm:text-sm font-semibold transition cursor-pointer"
        >
          No acepto
        </button>

        <button
          type="button"
          onClick={handleAccept}
          disabled={!canAccept}
          className="w-full sm:w-auto px-8 py-4 bg-amber-800 hover:bg-amber-900 text-white rounded-2xl text-sm sm:text-base font-bold shadow-md transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center space-x-2 cursor-pointer"
        >
          <span>{isSubmitting ? 'Registrando consentimiento...' : 'Aceptar y comenzar mi historia'}</span>
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Legal reference note */}
      <div className="text-center text-[11px] text-stone-400 space-y-1">
        <p>
          El registro de tu consentimiento incluye sello de tiempo del servidor (UTC / America/Merida) y huella criptográfica SHA-256.
        </p>
        <p>
          Aviso de Privacidad Integral v{CURRENT_PRIVACY_POLICY_VERSION} • Contacto ARCO: {RESPONSIBLE_CONTACT_EMAIL}
        </p>
      </div>

      {/* Integral Notice Modal */}
      <IntegralPrivacyNoticeModal
        isOpen={isFullNoticeOpen}
        onClose={() => setIsFullNoticeOpen(false)}
      />
    </div>
  );
};
