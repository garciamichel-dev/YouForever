import React, { useState } from 'react';
import {
  X,
  Shield,
  FileText,
  Calendar,
  Mail,
  UserCheck,
  CheckCircle2,
  AlertCircle,
  Download,
  Printer,
  RefreshCw,
  Send,
  Users,
  Clock,
  Lock,
  ExternalLink,
  Trash2,
} from 'lucide-react';
import {
  PrivacyConsentRecord,
  PrivacyDeclarations,
  BookDeliveryScheduleRecord,
  SecondaryAccessRecord,
  CURRENT_PRIVACY_POLICY_VERSION,
  RESPONSIBLE_CONTACT_EMAIL,
} from '../logic/interviewRules.ts';
import { IntegralPrivacyNoticeModal } from './IntegralPrivacyNoticeModal.tsx';

interface PrivacySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  consent: PrivacyConsentRecord | null;
  participantName: string;
  interviewTitle: string;
  deliverySchedules: BookDeliveryScheduleRecord[];
  secondaryAccessList: SecondaryAccessRecord[];
  onConsentUpdated: (newConsent: PrivacyConsentRecord) => void;
  onDeliveryAdded: (newSchedule: BookDeliveryScheduleRecord) => void;
  onSecondaryAccessAdded: (newAccess: SecondaryAccessRecord) => void;
}

export const PrivacySettingsModal: React.FC<PrivacySettingsModalProps> = ({
  isOpen,
  onClose,
  token,
  consent,
  participantName,
  interviewTitle,
  deliverySchedules,
  secondaryAccessList,
  onConsentUpdated,
  onDeliveryAdded,
  onSecondaryAccessAdded,
}) => {
  const [activeTab, setActiveTab] = useState<'constancia' | 'autorizaciones' | 'entrega' | 'arco' | 'revocacion'>('constancia');
  const [isFullNoticeOpen, setIsFullNoticeOpen] = useState(false);

  // Autorizaciones opcionales editing state
  const [editableDeclarations, setEditableDeclarations] = useState<Partial<PrivacyDeclarations>>(
    consent?.declarations || {}
  );
  const [isSavingDeclarations, setIsSavingDeclarations] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Scheduled delivery form
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);

  // Secondary access form
  const [secName, setSecName] = useState('');
  const [secRel, setSecRel] = useState('');
  const [secEmail, setSecEmail] = useState('');
  const [isAddingSec, setIsAddingSec] = useState(false);

  // ARCO request form
  const [arcoType, setArcoType] = useState<'acceso' | 'rectificacion' | 'cancelacion' | 'oposicion'>('acceso');
  const [arcoDetails, setArcoDetails] = useState('');
  const [arcoContactEmail, setArcoContactEmail] = useState('');
  const [isSubmittingArco, setIsSubmittingArco] = useState(false);
  const [arcoSuccessMsg, setArcoSuccessMsg] = useState<string | null>(null);

  // Revocation form
  const [revocationReason, setRevocationReason] = useState('');
  const [isRevoking, setIsRevoking] = useState(false);
  const [revocationSuccess, setRevocationSuccess] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handlePrintCertificate = () => {
    window.print();
  };

  const handleSaveOptionalDeclarations = async () => {
    try {
      setIsSavingDeclarations(true);
      setErrorMsg(null);
      const res = await fetch('/api/participant/consent/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          declarations: editableDeclarations,
        }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        onConsentUpdated(data.data);
        setSaveSuccessMsg('Autorizaciones actualizadas y registradas con éxito en el servidor.');
        setTimeout(() => setSaveSuccessMsg(null), 4000);
      } else {
        setErrorMsg(data.error || 'No se pudieron actualizar las autorizaciones.');
      }
    } catch (err: unknown) {
      setErrorMsg('Error al conectar con el servidor.');
    } finally {
      setIsSavingDeclarations(false);
    }
  };

  const handleScheduleDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipientEmail || !scheduledDate) {
      setErrorMsg('Por favor completa el correo y la fecha de entrega.');
      return;
    }
    try {
      setIsScheduling(true);
      setErrorMsg(null);
      const res = await fetch('/api/participant/schedule-delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          recipientEmail,
          recipientName,
          scheduledDate,
          notes: deliveryNotes,
        }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        onDeliveryAdded(data.data);
        setRecipientEmail('');
        setRecipientName('');
        setScheduledDate('');
        setDeliveryNotes('');
        setSaveSuccessMsg('Envío programado registrado con éxito. Al llegar la fecha se enviará el libro digital completo.');
        setTimeout(() => setSaveSuccessMsg(null), 5000);
      } else {
        setErrorMsg(data.error || 'No se pudo programar la entrega.');
      }
    } catch (err) {
      setErrorMsg('Error de red al programar la entrega.');
    } finally {
      setIsScheduling(false);
    }
  };

  const handleAddSecondaryAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secName || !secEmail) {
      setErrorMsg('Por favor indica el nombre y correo de la persona.');
      return;
    }
    try {
      setIsAddingSec(true);
      setErrorMsg(null);
      const res = await fetch('/api/participant/secondary-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          authorizedPersonName: secName,
          relationship: secRel,
          email: secEmail,
        }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        onSecondaryAccessAdded(data.data);
        setSecName('');
        setSecRel('');
        setSecEmail('');
        setSaveSuccessMsg('Acceso secundario registrado correctamente.');
        setTimeout(() => setSaveSuccessMsg(null), 4000);
      } else {
        setErrorMsg(data.error || 'No se pudo registrar el acceso secundario.');
      }
    } catch (err) {
      setErrorMsg('Error de red al registrar el acceso.');
    } finally {
      setIsAddingSec(false);
    }
  };

  const handleSubmitArco = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!arcoDetails.trim()) {
      setErrorMsg('Por favor describe tu solicitud.');
      return;
    }
    try {
      setIsSubmittingArco(true);
      setErrorMsg(null);
      const res = await fetch('/api/participant/arco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          requestType: arcoType,
          details: arcoDetails.trim(),
          contactEmail: arcoContactEmail.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setArcoSuccessMsg(
          `Solicitud de ${arcoType.toUpperCase()} registrada con folio ${data.data.id}. Te responderemos dentro del plazo legal aplicable.`
        );
        setArcoDetails('');
      } else {
        setErrorMsg(data.error || 'No se pudo enviar la solicitud ARCO.');
      }
    } catch (err) {
      setErrorMsg('Error al conectar con el servidor.');
    } finally {
      setIsSubmittingArco(false);
    }
  };

  const handleRevokeConsent = async () => {
    try {
      setIsRevoking(true);
      setErrorMsg(null);
      const res = await fetch('/api/participant/consent/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          reason: revocationReason.trim() || 'Revocación por voluntad del titular',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setRevocationSuccess(true);
        if (data.data) onConsentUpdated(data.data);
      } else {
        setErrorMsg(data.error || 'No se pudo procesar la revocación.');
      }
    } catch (err) {
      setErrorMsg('Error de red al procesar la revocación.');
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-stone-950/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[92vh] shadow-2xl border border-stone-200 flex flex-col overflow-hidden text-stone-800">
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-stone-200 bg-stone-50 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-900 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5 text-amber-800" />
            </div>
            <div>
              <h3 className="font-serif text-lg sm:text-xl font-bold text-stone-900">
                Mi Privacidad y Mis Autorizaciones
              </h3>
              <p className="text-xs text-stone-500">
                Panel de Control de Privacidad y Legado • YouForever
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-200 transition cursor-pointer"
            aria-label="Cerrar panel de privacidad"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap border-b border-stone-200 bg-white px-5 pt-3 gap-1.5 shrink-0 text-xs sm:text-sm font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('constancia')}
            className={`px-3 py-2 rounded-xl transition cursor-pointer ${
              activeTab === 'constancia'
                ? 'bg-amber-100 text-amber-900'
                : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            Constancia de Consentimiento
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('autorizaciones')}
            className={`px-3 py-2 rounded-xl transition cursor-pointer ${
              activeTab === 'autorizaciones'
                ? 'bg-amber-100 text-amber-900'
                : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            Mis Autorizaciones
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('entrega')}
            className={`px-3 py-2 rounded-xl transition cursor-pointer ${
              activeTab === 'entrega'
                ? 'bg-amber-100 text-amber-900'
                : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            Compartir Libro &amp; Acceso
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('arco')}
            className={`px-3 py-2 rounded-xl transition cursor-pointer ${
              activeTab === 'arco'
                ? 'bg-amber-100 text-amber-900'
                : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            Derechos ARCO
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('revocacion')}
            className={`px-3 py-2 rounded-xl transition cursor-pointer ${
              activeTab === 'revocacion'
                ? 'bg-rose-100 text-rose-900'
                : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            Revocación
          </button>
        </div>

        {/* Feedback notices */}
        {saveSuccessMsg && (
          <div className="mx-6 mt-4 p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-950 text-xs flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{saveSuccessMsg}</span>
          </div>
        )}
        {errorMsg && (
          <div className="mx-6 mt-4 p-3 bg-rose-50 border border-rose-300 rounded-xl text-rose-950 text-xs flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-700 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Tab content body */}
        <div className="p-6 overflow-y-auto space-y-6 text-xs sm:text-sm text-stone-700">
          {/* TAB 1: CONSTANCIA ELECTRÓNICA DE CONSENTIMIENTO */}
          {activeTab === 'constancia' && (
            <div className="space-y-4">
              <div className="p-5 rounded-2xl bg-stone-50 border border-stone-200 space-y-3 print:border-none print:p-0">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-stone-200 gap-2">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900 block">
                      Evidencia Electrónica Verificable
                    </span>
                    <h4 className="font-serif text-base font-bold text-stone-900">
                      Constancia Oficial de Consentimiento Informado
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={handlePrintCertificate}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-stone-300 rounded-xl text-xs font-semibold text-stone-700 hover:bg-stone-100 transition cursor-pointer self-start sm:self-auto"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Imprimir / Descargar</span>
                  </button>
                </div>

                {consent ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-white rounded-xl border border-stone-200">
                      <span className="text-stone-400 block text-[10px]">Folio Único de Consentimiento:</span>
                      <span className="font-mono font-bold text-stone-900 break-all">{consent.id}</span>
                    </div>
                    <div className="p-3 bg-white rounded-xl border border-stone-200">
                      <span className="text-stone-400 block text-[10px]">Titular Identificado:</span>
                      <span className="font-semibold text-stone-900">{consent.participantName}</span>
                    </div>
                    <div className="p-3 bg-white rounded-xl border border-stone-200">
                      <span className="text-stone-400 block text-[10px]">Fecha y Hora del Servidor (UTC):</span>
                      <span className="font-mono text-stone-800">{consent.serverTimestamp}</span>
                      <span className="text-[10px] text-stone-400 block mt-0.5">
                        Hora México ({consent.serverTimezone}):{' '}
                        {new Date(consent.serverTimestamp).toLocaleString('es-MX', {
                          timeZone: consent.serverTimezone,
                        })}
                      </span>
                    </div>
                    <div className="p-3 bg-white rounded-xl border border-stone-200">
                      <span className="text-stone-400 block text-[10px]">Versión del Aviso Aceptada:</span>
                      <span className="font-bold text-stone-900">Versión {consent.policyVersion}</span>
                      <span className="text-[10px] text-stone-400 block">
                        Estado actual:{' '}
                        <span className={`font-semibold ${consent.status === 'active' ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {consent.status === 'active' ? 'VIGENTE' : consent.status.toUpperCase()}
                        </span>
                      </span>
                    </div>
                    <div className="sm:col-span-2 p-3 bg-white rounded-xl border border-stone-200">
                      <span className="text-stone-400 block text-[10px]">Huella Criptográfica SHA-256 de Integridad:</span>
                      <code className="font-mono text-[11px] block break-all text-amber-950 font-bold bg-amber-50/60 p-1.5 rounded mt-1 border border-amber-200">
                        {consent.policyHash}
                      </code>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-stone-500 italic">No se ha registrado consentimiento para esta sesión aún.</p>
                )}

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setIsFullNoticeOpen(true)}
                    className="inline-flex items-center space-x-1.5 text-xs text-amber-900 hover:text-amber-950 underline font-semibold cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Ver texto íntegro del Aviso de Privacidad v{CURRENT_PRIVACY_POLICY_VERSION}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: AUTORIZACIONES OPCIONALES */}
          {activeTab === 'autorizaciones' && (
            <div className="space-y-4">
              <p className="text-xs text-stone-600">
                Puedes activar o revocar tus autorizaciones secundarias y opcionales en cualquier momento. Las declaraciones obligatorias A y B son necesarias para prestar el servicio del libro autobiográfico.
              </p>

              <div className="space-y-3">
                <label className="flex items-start space-x-3 p-3.5 rounded-xl border border-stone-200 hover:bg-stone-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editableDeclarations.declarationC_sensitiveData || false}
                    onChange={(e) =>
                      setEditableDeclarations((prev) => ({
                        ...prev,
                        declarationC_sensitiveData: e.target.checked,
                      }))
                    }
                    className="mt-1 w-4 h-4 rounded text-amber-800"
                  />
                  <div>
                    <span className="font-semibold text-stone-800 block">
                      Datos personales sensibles (salud, creencias, vivencias íntimas)
                    </span>
                    <span className="text-xs text-stone-500">
                      Autoriza procesar testimonios que contengan aspectos sensibles que decidas compartir libremente.
                    </span>
                  </div>
                </label>

                <label className="flex items-start space-x-3 p-3.5 rounded-xl border border-stone-200 hover:bg-stone-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editableDeclarations.declarationD_financialData || false}
                    onChange={(e) =>
                      setEditableDeclarations((prev) => ({
                        ...prev,
                        declarationD_financialData: e.target.checked,
                      }))
                    }
                    className="mt-1 w-4 h-4 rounded text-amber-800"
                  />
                  <div>
                    <span className="font-semibold text-stone-800 block">
                      Datos patrimoniales o financieros
                    </span>
                    <span className="text-xs text-stone-500">
                      Autoriza incluir recuerdos sobre propiedades familiares o negocios narrados voluntariamente.
                    </span>
                  </div>
                </label>

                <label className="flex items-start space-x-3 p-3.5 rounded-xl border border-stone-200 hover:bg-stone-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editableDeclarations.declarationE_aiAssistant || false}
                    onChange={(e) =>
                      setEditableDeclarations((prev) => ({
                        ...prev,
                        declarationE_aiAssistant: e.target.checked,
                      }))
                    }
                    className="mt-1 w-4 h-4 rounded text-amber-800"
                  />
                  <div>
                    <span className="font-semibold text-stone-800 block">
                      Asistente conversacional con IA basado en tu historia
                    </span>
                    <span className="text-xs text-stone-500">
                      Permite crear un avatar conversacional basado exclusivamente en tus testimonios autorizados.
                    </span>
                  </div>
                </label>

                <label className="flex items-start space-x-3 p-3.5 rounded-xl border border-stone-200 hover:bg-stone-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editableDeclarations.declarationF_shareWithFamily || false}
                    onChange={(e) =>
                      setEditableDeclarations((prev) => ({
                        ...prev,
                        declarationF_shareWithFamily: e.target.checked,
                      }))
                    }
                    className="mt-1 w-4 h-4 rounded text-amber-800"
                  />
                  <div>
                    <span className="font-semibold text-stone-800 block">
                      Compartir con familiares o personas designadas
                    </span>
                    <span className="text-xs text-stone-500">
                      Habilita compartir el libro terminado con los destinatarios que registres en la sección correspondiente.
                    </span>
                  </div>
                </label>

                <label className="flex items-start space-x-3 p-3.5 rounded-xl border border-stone-200 hover:bg-stone-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editableDeclarations.declarationG_promotionalUse || false}
                    onChange={(e) =>
                      setEditableDeclarations((prev) => ({
                        ...prev,
                        declarationG_promotionalUse: e.target.checked,
                      }))
                    }
                    className="mt-1 w-4 h-4 rounded text-amber-800"
                  />
                  <div>
                    <span className="font-semibold text-stone-800 block">
                      Uso promocional de fragmentos (Opcional)
                    </span>
                    <span className="text-xs text-stone-500">
                      Permite utilizar fragmentos de tu historia en comunicaciones institucionales de YouForever.
                    </span>
                  </div>
                </label>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveOptionalDeclarations}
                  disabled={isSavingDeclarations}
                  className="px-5 py-2.5 bg-amber-800 hover:bg-amber-900 text-white rounded-xl text-xs font-semibold transition cursor-pointer shadow-sm disabled:opacity-50"
                >
                  {isSavingDeclarations ? 'Guardando...' : 'Guardar Modificaciones'}
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: PROGRAMACIÓN DE ENTREGA Y ACCESOS */}
          {activeTab === 'entrega' && (
            <div className="space-y-6">
              {/* Scheduled Delivery */}
              <div className="p-5 rounded-2xl bg-stone-50 border border-stone-200 space-y-4">
                <div className="space-y-1">
                  <h4 className="font-serif font-bold text-stone-900 text-sm sm:text-base flex items-center space-x-2">
                    <Calendar className="w-4 h-4 text-amber-800" />
                    <span>Compartir automáticamente el libro digital en una fecha futura</span>
                  </h4>
                  <p className="text-xs text-stone-500 leading-relaxed">
                    Al llegar la fecha configurada, el sistema enviará por correo electrónico el <strong>libro autobiográfico digital completo</strong> (nunca las respuestas crudas ni grabaciones de audio).
                  </p>
                </div>

                <form onSubmit={handleScheduleDelivery} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                      Correo electrónico del destinatario:
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="ejemplo@correo.com"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      className="w-full p-2.5 border border-stone-300 rounded-xl text-xs bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                      Fecha programada de envío:
                    </label>
                    <input
                      type="date"
                      required
                      min={new Date().toISOString().split('T')[0]}
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      className="w-full p-2.5 border border-stone-300 rounded-xl text-xs bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                      Nombre del destinatario (opcional):
                    </label>
                    <input
                      type="text"
                      placeholder="Ej. Mi hija Lucía"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      className="w-full p-2.5 border border-stone-300 rounded-xl text-xs bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                      Dedicatoria o mensaje (opcional):
                    </label>
                    <input
                      type="text"
                      placeholder="Ej. Con todo mi amor para tu cumpleaños..."
                      value={deliveryNotes}
                      onChange={(e) => setDeliveryNotes(e.target.value)}
                      className="w-full p-2.5 border border-stone-300 rounded-xl text-xs bg-white"
                    />
                  </div>

                  <div className="sm:col-span-2 flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={isScheduling}
                      className="px-5 py-2.5 bg-amber-800 hover:bg-amber-900 text-white rounded-xl text-xs font-semibold transition cursor-pointer shadow-xs disabled:opacity-50"
                    >
                      {isScheduling ? 'Programando...' : 'Programar Entrega del Libro'}
                    </button>
                  </div>
                </form>

                {deliverySchedules.length > 0 && (
                  <div className="pt-3 border-t border-stone-200 space-y-2">
                    <span className="text-[11px] font-bold text-stone-700 block">
                      Envíos programados activos ({deliverySchedules.length}):
                    </span>
                    <div className="space-y-1.5">
                      {deliverySchedules.map((s) => (
                        <div key={s.id} className="p-2.5 bg-white rounded-xl border border-stone-200 text-xs flex items-center justify-between">
                          <div>
                            <span className="font-semibold text-stone-900 block">{s.recipientEmail}</span>
                            <span className="text-[11px] text-stone-500">
                              Fecha: {s.scheduledDate} {s.recipientName ? `• Para: ${s.recipientName}` : ''}
                            </span>
                          </div>
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase">
                            {s.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Secondary Access */}
              <div className="p-5 rounded-2xl bg-stone-50 border border-stone-200 space-y-4">
                <div className="space-y-1">
                  <h4 className="font-serif font-bold text-stone-900 text-sm sm:text-base flex items-center space-x-2">
                    <Users className="w-4 h-4 text-amber-800" />
                    <span>Configurar acceso secundario a personas de tu elección</span>
                  </h4>
                  <p className="text-xs text-stone-500 leading-relaxed">
                    Autoriza expresamente a familiares de confianza para consultar tu libro terminado.
                  </p>
                </div>

                <form onSubmit={handleAddSecondaryAccess} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 mb-1">Nombre completo:</label>
                    <input
                      type="text"
                      required
                      placeholder="Ej. Ana Morales"
                      value={secName}
                      onChange={(e) => setSecName(e.target.value)}
                      className="w-full p-2.5 border border-stone-300 rounded-xl text-xs bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 mb-1">Parentesco:</label>
                    <input
                      type="text"
                      placeholder="Ej. Hija, Hermano"
                      value={secRel}
                      onChange={(e) => setSecRel(e.target.value)}
                      className="w-full p-2.5 border border-stone-300 rounded-xl text-xs bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 mb-1">Correo electrónico:</label>
                    <input
                      type="email"
                      required
                      placeholder="ana@ejemplo.com"
                      value={secEmail}
                      onChange={(e) => setSecEmail(e.target.value)}
                      className="w-full p-2.5 border border-stone-300 rounded-xl text-xs bg-white"
                    />
                  </div>
                  <div className="sm:col-span-3 flex justify-end">
                    <button
                      type="submit"
                      disabled={isAddingSec}
                      className="px-5 py-2.5 bg-amber-800 hover:bg-amber-900 text-white rounded-xl text-xs font-semibold transition cursor-pointer shadow-xs disabled:opacity-50"
                    >
                      {isAddingSec ? 'Guardando...' : 'Autorizar Persona'}
                    </button>
                  </div>
                </form>

                {secondaryAccessList.length > 0 && (
                  <div className="pt-3 border-t border-stone-200 space-y-2">
                    <span className="text-[11px] font-bold text-stone-700 block">Personas con acceso secundario:</span>
                    <div className="space-y-1.5">
                      {secondaryAccessList.map((a) => (
                        <div key={a.id} className="p-2.5 bg-white rounded-xl border border-stone-200 text-xs flex items-center justify-between">
                          <div>
                            <span className="font-semibold text-stone-900">{a.authorizedPersonName} ({a.relationship})</span>
                            <span className="text-stone-500 block text-[11px]">{a.email}</span>
                          </div>
                          <span className="text-[10px] text-stone-400">Autorizado</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: SOLICITUD DE DERECHOS ARCO */}
          {activeTab === 'arco' && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-xs text-amber-950 space-y-1">
                <span className="font-bold block">Ejercicio de Derechos ARCO (LFPDPPP)</span>
                <p>
                  Tienes derecho a <strong>Acceder</strong> a tus datos, solicitar su <strong>Rectificación</strong> si son inexactos, su <strong>Cancelación</strong> conforme a las excepciones legales, u <strong>Oponerte</strong> a tratamientos específicos.
                </p>
                <p className="text-[11px] text-amber-800 pt-1">
                  Contacto de privacidad: <a href={`mailto:${RESPONSIBLE_CONTACT_EMAIL}`} className="underline font-mono">{RESPONSIBLE_CONTACT_EMAIL}</a>
                </p>
              </div>

              {arcoSuccessMsg ? (
                <div className="p-5 bg-emerald-50 border border-emerald-300 rounded-2xl text-emerald-950 text-xs space-y-2">
                  <div className="flex items-center space-x-2 font-bold text-sm">
                    <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                    <span>Solicitud Registrada con Éxito</span>
                  </div>
                  <p>{arcoSuccessMsg}</p>
                  <button
                    type="button"
                    onClick={() => setArcoSuccessMsg(null)}
                    className="mt-2 px-4 py-1.5 bg-emerald-800 text-white rounded-lg text-xs font-semibold"
                  >
                    Nueva Solicitud
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmitArco} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1">
                      Tipo de Derecho a Ejercer:
                    </label>
                    <select
                      value={arcoType}
                      onChange={(e) => setArcoType(e.target.value as any)}
                      className="w-full p-2.5 border border-stone-300 rounded-xl text-xs bg-white text-stone-900"
                    >
                      <option value="acceso">Acceso — Conocer qué datos personales tenemos registrados</option>
                      <option value="rectificacion">Rectificación — Corregir datos inexactos o incompletos</option>
                      <option value="cancelacion">Cancelación — Solicitar supresión conforme a la ley</option>
                      <option value="oposicion">Oposición — Oponerse a una finalidad específica</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1">
                      Correo para recibir notificación de respuesta:
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="tu@correo.com"
                      value={arcoContactEmail}
                      onChange={(e) => setArcoContactEmail(e.target.value)}
                      className="w-full p-2.5 border border-stone-300 rounded-xl text-xs bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1">
                      Descripción detallada de tu solicitud:
                    </label>
                    <textarea
                      rows={4}
                      required
                      placeholder="Detalla claramente qué información deseas rectificar, cancelar u oponerte..."
                      value={arcoDetails}
                      onChange={(e) => setArcoDetails(e.target.value)}
                      className="w-full p-3 border border-stone-300 rounded-xl text-xs bg-white"
                    />
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={isSubmittingArco}
                      className="px-6 py-2.5 bg-amber-800 hover:bg-amber-900 text-white rounded-xl text-xs font-semibold transition cursor-pointer shadow-sm disabled:opacity-50"
                    >
                      {isSubmittingArco ? 'Enviando...' : 'Enviar Solicitud ARCO'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* TAB 5: REVOCACIÓN DE CONSENTIMIENTO */}
          {activeTab === 'revocacion' && (
            <div className="space-y-4">
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-950 space-y-1">
                <span className="font-bold block text-sm">Revocación del Consentimiento</span>
                <p>
                  Conforme a la legislación aplicable, tienes derecho a revocar tu consentimiento en cualquier momento. La revocación detendrá el tratamiento de tus datos para el futuro. No tiene efectos retroactivos sobre tratamientos realizados lícitamente con anterioridad ni cancela automáticamente libros físicos ya entregados.
                </p>
              </div>

              {revocationSuccess ? (
                <div className="p-5 bg-stone-100 rounded-2xl text-center space-y-3">
                  <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-800 flex items-center justify-center mx-auto">
                    <Lock className="w-6 h-6" />
                  </div>
                  <h4 className="font-serif font-bold text-stone-900 text-base">
                    Consentimiento Revocado
                  </h4>
                  <p className="text-xs text-stone-600 max-w-md mx-auto">
                    Se ha registrado la revocación de tu consentimiento en el servidor. Tus tratamientos futuros quedan detenidos. Si deseas reactivar tu participación en el futuro, podrás otorgar una nueva autorización.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1">
                      Motivo o comentario de la revocación (opcional):
                    </label>
                    <textarea
                      rows={3}
                      placeholder="Indica el motivo por el cual solicitas la revocación..."
                      value={revocationReason}
                      onChange={(e) => setRevocationReason(e.target.value)}
                      className="w-full p-2.5 border border-stone-300 rounded-xl text-xs bg-white"
                    />
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={handleRevokeConsent}
                      disabled={isRevoking}
                      className="px-6 py-2.5 bg-rose-700 hover:bg-rose-800 text-white rounded-xl text-xs font-semibold transition cursor-pointer shadow-sm disabled:opacity-50"
                    >
                      {isRevoking ? 'Procesando...' : 'Confirmar Revocación de Consentimiento'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-stone-200 bg-stone-50 flex items-center justify-between text-xs text-stone-500 shrink-0">
          <span>YouForever • Responsable de Datos: {RESPONSIBLE_CONTACT_EMAIL}</span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-stone-200 hover:bg-stone-300 text-stone-800 rounded-xl text-xs font-semibold transition cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>

      <IntegralPrivacyNoticeModal
        isOpen={isFullNoticeOpen}
        onClose={() => setIsFullNoticeOpen(false)}
      />
    </div>
  );
};
