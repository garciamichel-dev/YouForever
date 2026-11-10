import React, { useState, useEffect } from 'react';
import {
  Settings,
  X,
  Shield,
  ShieldCheck,
  FileText,
  Download,
  Share2,
  Calendar,
  Users,
  Heart,
  History,
  Lock,
  Plus,
  Trash2,
  Edit2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Eye,
  RefreshCw,
  LogOut,
} from 'lucide-react';
import {
  SIMPLIFIED_PRIVACY_NOTICE,
  COMPREHENSIVE_PRIVACY_NOTICE,
  PRIVACY_NOTICE_VERSION,
  PRIVACY_NOTICE_EFFECTIVE_DATE,
} from '../logic/privacyNoticeContent.ts';

interface ParticipantAdminPanelProps {
  token: string;
  onClose: () => void;
  onConsentRevoked?: () => void;
  onLogoutSession?: () => void;
}

export const ParticipantAdminPanel: React.FC<ParticipantAdminPanelProps> = ({
  token,
  onClose,
  onConsentRevoked,
  onLogoutSession,
}) => {
  const [activeTab, setActiveTab] = useState<
    'privacy' | 'versions' | 'share' | 'schedule' | 'secondary' | 'postmortem' | 'audit'
  >('privacy');

  const [loading, setLoading] = useState(true);
  const [profileData, setProfileData] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Sub-modals for documents
  const [viewingDoc, setViewingDoc] = useState<'none' | 'simplified' | 'comprehensive'>('none');

  // Form states: Book sharing
  const [shareRecipientName, setShareRecipientName] = useState('');
  const [shareRecipientEmail, setShareRecipientEmail] = useState('');
  const [shareRelationship, setShareRelationship] = useState('Familiar');
  const [shareNote, setShareNote] = useState('');
  const [sharingBook, setSharingBook] = useState(false);

  // Form states: Scheduled delivery
  const [schedRecipientName, setSchedRecipientName] = useState('');
  const [schedRecipientEmail, setSchedRecipientEmail] = useState('');
  const [schedDate, setSchedDate] = useState('');
  const [schedNote, setSchedNote] = useState('');
  const [scheduling, setScheduling] = useState(false);

  // Form states: Secondary access
  const [secName, setSecName] = useState('');
  const [secEmail, setSecEmail] = useState('');
  const [secRelationship, setSecRelationship] = useState('Hijo/a');
  const [savingSecondary, setSavingSecondary] = useState(false);

  // Form states: Post-Mortem
  const [pmName, setPmName] = useState('');
  const [pmEmail, setPmEmail] = useState('');
  const [pmRelationship, setPmRelationship] = useState('Heredero / Familiar');
  const [pmInstructions, setPmInstructions] = useState('');
  const [savingPm, setSavingPm] = useState(false);

  // Form states: ARCO
  const [arcoType, setArcoType] = useState<'acceso' | 'rectificacion' | 'cancelacion' | 'oposicion'>('acceso');
  const [arcoDetails, setArcoDetails] = useState('');
  const [submittingArco, setSubmittingArco] = useState(false);

  // Fetch admin profile
  const fetchProfile = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await fetch('/api/participant/admin/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'No se pudo cargar el panel');
      setProfileData(json.data);

      if (json.data?.postMortemInstructions) {
        setPmName(json.data.postMortemInstructions.designatedPersonName || '');
        setPmEmail(json.data.postMortemInstructions.designatedPersonEmail || '');
        setPmRelationship(json.data.postMortemInstructions.relationship || 'Familiar');
        setPmInstructions(json.data.postMortemInstructions.instructions || '');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error de conexión con Firebase.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [token]);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  // 1. Download official privacy certificate (constancia de aceptación)
  const handleDownloadCertificate = () => {
    if (!profileData?.activeConsent) return;
    const c = profileData.activeConsent;
    const p = profileData.participant;
    const inv = profileData.interview;

    const certContent = `
================================================================================
          CONSTANCIA ELECTRÓNICA OFICIAL DE CONSENTIMIENTO INFORMADO
                             PLATAFORMA FOREVERYOU
================================================================================

Folio de Identificación: ${c.id}
Versión del Aviso Aceptado: ${c.versionId}
Fecha y Hora de Aceptación (Servidor UTC): ${c.acceptedAt}
Mecanismo de Autenticación: ${c.authMechanism}
Estado Legal del Consentimiento: ${c.status === 'active' ? 'VIGENTE Y VÁLIDO' : 'REVOCADO'}

DATOS DEL TITULAR Y ENTREVISTA:
--------------------------------------------------------------------------------
Nombre del Participante: ${c.participantName}
Identificador del Participante: ${c.participantId}
Título del Libro / Entrevista: ${inv.title}
Modalidad de Historia: ${inv.storyMode === 'compartida' ? 'Historia Compartida' : 'Historia Individual'}

EVIDENCIA CRIPTOGRÁFICA DE INTEGRIDAD:
--------------------------------------------------------------------------------
Hash SHA-256 del Aviso de Privacidad Integral:
${c.noticeHash}

Hash SHA-256 de la Declaración Aceptada:
${c.declarationHash}

DECLARACIÓN ELECTRÓNICA INDIVISIBLE ACEPTADA:
--------------------------------------------------------------------------------
"${c.declarationText}"

CONDICIONES DE SEGURIDAD Y EJERCICIO DE DERECHOS ARCO:
--------------------------------------------------------------------------------
El presente registro constituye constancia inalterable de aceptación para las
finalidades primarias necesarias de elaboración del libro autobiográfico.
Las finalidades opcionales (distribución a terceros, entrega futura o acceso
post mortem) requieren una autorización independiente.

El titular conserva sus derechos de Acceso, Rectificación, Cancelación y
Oposición conforme a la Ley Federal de Protección de Datos Personales en
Posesión de los Particulares (LFPDPPP).

Contacto Oficial y Privacidad: youforever.team@gmail.com • WhatsApp: +52 9681040015
Generado de forma segura desde la infraestructura Cloud Firestore de YouForever.
================================================================================
    `.trim();

    const blob = new Blob([certContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `constancia_privacidad_${p.name.replace(/\s+/g, '_')}_${c.id}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 2. Add Book Share
  const handleAddShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shareRecipientName || !shareRecipientEmail) return;
    setSharingBook(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/participant/admin/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          recipientName: shareRecipientName,
          recipientEmail: shareRecipientEmail,
          relationship: shareRelationship,
          note: shareNote,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setShareRecipientName('');
      setShareRecipientEmail('');
      setShareNote('');
      showSuccess('Destinatario de libro autobiográfico registrado en Firebase.');
      await fetchProfile();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al autorizar destinatario.');
    } finally {
      setSharingBook(false);
    }
  };

  const handleRevokeShare = async (id: string) => {
    try {
      const res = await fetch(`/api/participant/admin/shares/${id}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      showSuccess('Autorización de compartición revocada.');
      await fetchProfile();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al revocar compartición.');
    }
  };

  // 3. Add Scheduled Delivery
  const handleAddScheduledDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schedRecipientName || !schedRecipientEmail || !schedDate) return;
    setScheduling(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/participant/admin/scheduled-deliveries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          recipientName: schedRecipientName,
          recipientEmail: schedRecipientEmail,
          scheduledDate: schedDate,
          note: schedNote,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setSchedRecipientName('');
      setSchedRecipientEmail('');
      setSchedDate('');
      setSchedNote('');
      showSuccess('Entrega futura del libro programada con éxito en Firebase.');
      await fetchProfile();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al programar entrega.');
    } finally {
      setScheduling(false);
    }
  };

  const handleCancelDelivery = async (id: string) => {
    try {
      const res = await fetch(`/api/participant/admin/scheduled-deliveries/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      showSuccess('Entrega programada cancelada.');
      await fetchProfile();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al cancelar entrega.');
    }
  };

  // 4. Add Secondary Access
  const handleAddSecondary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secName || !secEmail) return;
    setSavingSecondary(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/participant/admin/secondary-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          authorizedPersonName: secName,
          authorizedPersonEmail: secEmail,
          relationship: secRelationship,
          permissions: ['view_manuscript'],
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setSecName('');
      setSecEmail('');
      showSuccess('Persona autorizada registrada con éxito.');
      await fetchProfile();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al registrar persona autorizada.');
    } finally {
      setSavingSecondary(false);
    }
  };

  const handleRevokeSecondary = async (id: string) => {
    try {
      const res = await fetch(`/api/participant/admin/secondary-access/${id}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      showSuccess('Acceso secundario revocado.');
      await fetchProfile();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al revocar acceso.');
    }
  };

  // 5. Post-Mortem Instructions
  const handleSavePostMortem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pmName || !pmEmail || !pmInstructions) return;
    setSavingPm(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/participant/admin/post-mortem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          designatedPersonName: pmName,
          designatedPersonEmail: pmEmail,
          relationship: pmRelationship,
          instructions: pmInstructions,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      showSuccess('Instrucciones post-mortem registradas con éxito en Firebase.');
      await fetchProfile();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al guardar instrucciones.');
    } finally {
      setSavingPm(false);
    }
  };

  const handleRevokePostMortem = async () => {
    try {
      const res = await fetch('/api/participant/admin/post-mortem/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      showSuccess('Instrucciones post-mortem revocadas.');
      await fetchProfile();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al revocar instrucciones.');
    }
  };

  // 6. Submit ARCO Request
  const handleSubmitArco = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!arcoDetails) return;
    setSubmittingArco(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/participant/admin/arco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          requestType: arcoType,
          details: arcoDetails,
          email: profileData?.participant?.email || '',
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setArcoDetails('');
      showSuccess(`Solicitud ARCO registrada con folio oficial: ${data.data.folio}`);
      await fetchProfile();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al enviar solicitud ARCO.');
    } finally {
      setSubmittingArco(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
      <div className="bg-white rounded-3xl max-w-4xl w-full h-[90vh] flex flex-col shadow-2xl border border-stone-200 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-50/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-800 text-white flex items-center justify-center shadow-inner">
              <Settings className="w-5 h-5 text-amber-100" />
            </div>
            <div>
              <h3 className="font-serif text-lg font-bold text-stone-900 leading-tight">
                Panel Administrativo del Entrevistado
              </h3>
              <p className="text-xs text-stone-500">
                {profileData?.participant?.name
                  ? `${profileData.participant.name} • ${profileData.interview.title}`
                  : 'Administración de privacidad, autorizaciones y distribución'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onLogoutSession && (
              <button
                type="button"
                onClick={onLogoutSession}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:text-rose-900 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition cursor-pointer"
                title="Cerrar sesión en este dispositivo y conservar tu avance"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Cerrar sesión</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-stone-400 hover:text-stone-700 rounded-xl hover:bg-stone-200/60 transition cursor-pointer"
              title="Cerrar panel"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 border-b border-stone-200 flex items-center gap-2 overflow-x-auto bg-white shrink-0 scrollbar-none py-2">
          <button
            type="button"
            onClick={() => setActiveTab('privacy')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
              activeTab === 'privacy'
                ? 'bg-amber-800 text-white shadow-xs'
                : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            Mi privacidad y autorizaciones
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('share')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
              activeTab === 'share'
                ? 'bg-amber-800 text-white shadow-xs'
                : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            Compartir mi libro
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('schedule')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
              activeTab === 'schedule'
                ? 'bg-amber-800 text-white shadow-xs'
                : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            Programar entrega futura
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('secondary')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
              activeTab === 'secondary'
                ? 'bg-amber-800 text-white shadow-xs'
                : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            Personas autorizadas
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('postmortem')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
              activeTab === 'postmortem'
                ? 'bg-amber-800 text-white shadow-xs'
                : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            Acceso posterior al fallecimiento
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('versions')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
              activeTab === 'versions'
                ? 'bg-amber-800 text-white shadow-xs'
                : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            Versiones del aviso
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
              activeTab === 'audit'
                ? 'bg-amber-800 text-white shadow-xs'
                : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            Auditoría
          </button>
        </div>

        {/* Notification alerts */}
        {errorMsg && (
          <div className="mx-6 mt-3 p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between text-xs text-rose-800">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
            <button onClick={() => setErrorMsg(null)} className="text-rose-600 hover:text-rose-800 font-bold">
              ✕
            </button>
          </div>
        )}

        {successMsg && (
          <div className="mx-6 mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-800">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{successMsg}</span>
            </div>
            <button onClick={() => setSuccessMsg(null)} className="text-emerald-700 hover:text-emerald-900 font-bold">
              ✕
            </button>
          </div>
        )}

        {/* Panel Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-stone-500 space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin text-amber-700" />
              <p className="text-xs">Cargando tus configuraciones desde Firebase...</p>
            </div>
          ) : (
            <>
              {/* TAB 1: PRIVACIDAD Y AUTORIZACIONES */}
              {activeTab === 'privacy' && (
                <div className="space-y-6">
                  {/* Status card */}
                  <div className="p-5 bg-stone-50 border border-stone-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                        <h4 className="font-serif font-bold text-stone-900 text-sm">
                          Consentimiento Informado Registrado en Firebase
                        </h4>
                      </div>
                      <p className="text-xs text-stone-600">
                        {profileData?.activeConsent ? (
                          <>
                            Aceptado el{' '}
                            <strong>
                              {new Date(profileData.activeConsent.acceptedAt).toLocaleString('es-MX')}
                            </strong>{' '}
                            • Versión: {profileData.activeConsent.versionId}
                          </>
                        ) : (
                          'Sin consentimiento activo registrado.'
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleDownloadCertificate}
                        disabled={!profileData?.activeConsent}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-xl transition cursor-pointer"
                        title="Descargar constancia oficial electrónica"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Descargar constancia</span>
                      </button>
                    </div>
                  </div>

                  {/* Active device session & explicit logout card */}
                  {onLogoutSession && (
                    <div className="p-5 bg-white border border-stone-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Lock className="w-4 h-4 text-amber-800" />
                          <h4 className="font-serif font-bold text-stone-900 text-sm">
                            Sesión abierta en este dispositivo
                          </h4>
                        </div>
                        <p className="text-xs text-stone-600 leading-relaxed">
                          Tu sesión permanece activa automáticamente aunque actualices o cierres la página. Si cierras sesión, tu avance en la pregunta actual y cualquier borrador escrito en curso se conservarán para cuando vuelvas a ingresar con tu código o enlace.
                        </p>
                      </div>

                      <div className="shrink-0">
                        <button
                          type="button"
                          onClick={onLogoutSession}
                          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition cursor-pointer"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>Cerrar sesión</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Documents & Notice consultation */}
                  <div className="p-5 bg-white border border-stone-200 rounded-2xl space-y-3">
                    <h4 className="font-serif font-bold text-stone-900 text-sm flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-amber-800" />
                      <span>Documentos de Privacidad Oficiales de YouForever</span>
                    </h4>
                    <p className="text-xs text-stone-600">
                      Puedes consultar en cualquier momento los textos vigentes de privacidad:
                    </p>
                    <div className="flex flex-wrap gap-3 pt-1">
                      <button
                        type="button"
                        onClick={() => setViewingDoc('simplified')}
                        className="px-3.5 py-2 text-xs font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-xl transition cursor-pointer"
                      >
                        Consultar aviso simplificado
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewingDoc('comprehensive')}
                        className="px-3.5 py-2 text-xs font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-xl transition cursor-pointer"
                      >
                        Consultar aviso integral
                      </button>
                    </div>
                  </div>

                  {/* Autorizaciones Opcionales Status */}
                  <div className="p-5 bg-white border border-stone-200 rounded-2xl space-y-3">
                    <h4 className="font-serif font-bold text-stone-900 text-sm">
                      Autorizaciones Opcionales y Usos Secundarios
                    </h4>
                    <p className="text-xs text-stone-500">
                      Conforme al principio de consentimiento único, las finalidades opcionales permanecen{' '}
                      <strong>inactivas por defecto</strong> hasta que decidas utilizarlas expresamente:
                    </p>

                    <div className="space-y-2 pt-1 text-xs">
                      <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 flex items-center justify-between">
                        <div>
                          <span className="font-semibold text-stone-800 block">
                            Publicidad o Prospección Comercial
                          </span>
                          <span className="text-stone-500 text-[11px]">
                            YouForever no utiliza tus recuerdos ni testimonios para publicidad.
                          </span>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-stone-200 text-stone-700">
                          Inactivo permanente
                        </span>
                      </div>

                      <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 flex items-center justify-between">
                        <div>
                          <span className="font-semibold text-stone-800 block">
                            Compartir Libro Autobiográfico con Familiares
                          </span>
                          <span className="text-stone-500 text-[11px]">
                            Solo se activa con los destinatarios que tú configures.
                          </span>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900">
                          {profileData?.bookShares?.length || 0} autorizados
                        </span>
                      </div>

                      <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 flex items-center justify-between">
                        <div>
                          <span className="font-semibold text-stone-800 block">
                            Entrega Programada Futura
                          </span>
                          <span className="text-stone-500 text-[11px]">
                            Envío automático del libro en fechas señaladas.
                          </span>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900">
                          {profileData?.scheduledDeliveries?.filter((d: any) => d.status === 'scheduled').length || 0} programadas
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Solicitud de Derechos ARCO */}
                  <div className="p-5 bg-white border border-stone-200 rounded-2xl space-y-3">
                    <h4 className="font-serif font-bold text-stone-900 text-sm">
                      Ejercicio de Derechos ARCO (Acceso, Rectificación, Cancelación y Oposición)
                    </h4>
                    <p className="text-xs text-stone-600">
                      Puedes presentar aquí una solicitud formal conforme a la ley mexicana:
                    </p>

                    <form onSubmit={handleSubmitArco} className="space-y-3 pt-1">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-stone-700 mb-1">
                            Tipo de derecho:
                          </label>
                          <select
                            value={arcoType}
                            onChange={(e: any) => setArcoType(e.target.value)}
                            className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-xl text-xs text-stone-800"
                          >
                            <option value="acceso">Acceso (Conocer qué datos tenemos)</option>
                            <option value="rectificacion">Rectificación (Corregir datos inexactos)</option>
                            <option value="cancelacion">Cancelación (Eliminar datos del sistema)</option>
                            <option value="oposicion">Oposición (Oponerse a un tratamiento específico)</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1">
                          Detalles de tu solicitud:
                        </label>
                        <textarea
                          rows={3}
                          value={arcoDetails}
                          onChange={(e) => setArcoDetails(e.target.value)}
                          placeholder="Describe brevemente los datos o motivos de tu solicitud..."
                          className="w-full p-2.5 border border-stone-300 rounded-xl text-xs text-stone-800"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={submittingArco || !arcoDetails.trim()}
                        className="px-4 py-2 bg-amber-800 hover:bg-amber-900 text-white text-xs font-bold rounded-xl transition cursor-pointer"
                      >
                        {submittingArco ? 'Enviando a Firebase...' : 'Enviar solicitud ARCO'}
                      </button>
                    </form>

                    {/* Previous ARCO requests */}
                    {profileData?.arcoRequests?.length > 0 && (
                      <div className="pt-3 border-t border-stone-200 space-y-2">
                        <span className="text-[11px] font-bold text-stone-700 uppercase tracking-wide">
                          Solicitudes presentadas ({profileData.arcoRequests.length})
                        </span>
                        {profileData.arcoRequests.map((ar: any) => (
                          <div key={ar.id} className="p-3 bg-stone-50 rounded-xl border border-stone-200 text-xs">
                            <div className="flex items-center justify-between font-semibold text-stone-800">
                              <span>Folio: {ar.folio} ({ar.requestType.toUpperCase()})</span>
                              <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-100 text-amber-900">
                                {ar.status}
                              </span>
                            </div>
                            <p className="text-stone-600 mt-1">{ar.details}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: COMPARTIR MI LIBRO AUTOBIOGRÁFICO */}
              {activeTab === 'share' && (
                <div className="space-y-6">
                  <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-2xl text-xs text-stone-800 space-y-1">
                    <span className="font-serif font-bold text-amber-950 text-sm block">
                      Condiciones de Seguridad de Compartición
                    </span>
                    <p>
                      • <strong>Solamente se comparte el libro digital completo generado</strong>.
                    </p>
                    <p>
                      • <strong>Nunca</strong> se comparten grabaciones de voz originales, transcripciones aisladas,
                      respuestas sueltas ni fotografías independientes fuera del libro.
                    </p>
                  </div>

                  {/* Add Share Form */}
                  <form onSubmit={handleAddShare} className="p-5 bg-white border border-stone-200 rounded-2xl space-y-3">
                    <h4 className="font-serif font-bold text-stone-900 text-sm">
                      Autorizar nuevo destinatario para acceder al libro digital
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1">
                          Nombre completo:
                        </label>
                        <input
                          type="text"
                          required
                          value={shareRecipientName}
                          onChange={(e) => setShareRecipientName(e.target.value)}
                          placeholder="Ej. Carmen González"
                          className="w-full p-2.5 border border-stone-300 rounded-xl text-xs text-stone-800"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1">
                          Correo electrónico:
                        </label>
                        <input
                          type="email"
                          required
                          value={shareRecipientEmail}
                          onChange={(e) => setShareRecipientEmail(e.target.value)}
                          placeholder="carmen@example.com"
                          className="w-full p-2.5 border border-stone-300 rounded-xl text-xs text-stone-800"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1">
                          Parentesco:
                        </label>
                        <input
                          type="text"
                          value={shareRelationship}
                          onChange={(e) => setShareRelationship(e.target.value)}
                          placeholder="Hija, Nieto, Hermano"
                          className="w-full p-2.5 border border-stone-300 rounded-xl text-xs text-stone-800"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-stone-700 mb-1">
                        Mensaje o dedicatoria personal (opcional):
                      </label>
                      <input
                        type="text"
                        value={shareNote}
                        onChange={(e) => setShareNote(e.target.value)}
                        placeholder="Con todo mi amor para mi familia..."
                        className="w-full p-2.5 border border-stone-300 rounded-xl text-xs text-stone-800"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={sharingBook}
                      className="px-4 py-2 bg-amber-800 hover:bg-amber-900 text-white text-xs font-bold rounded-xl transition cursor-pointer"
                    >
                      {sharingBook ? 'Registrando...' : 'Autorizar y Guardar en Firebase'}
                    </button>
                  </form>

                  {/* List of active book shares */}
                  <div className="space-y-3">
                    <h4 className="font-serif font-bold text-stone-900 text-sm">
                      Destinatarios autorizados ({profileData?.bookShares?.length || 0})
                    </h4>
                    {profileData?.bookShares?.length === 0 ? (
                      <p className="text-xs text-stone-500 italic">No has agregado destinatarios todavía.</p>
                    ) : (
                      profileData?.bookShares?.map((s: any) => (
                        <div
                          key={s.id}
                          className="p-4 bg-stone-50 rounded-xl border border-stone-200 flex items-center justify-between gap-3 text-xs"
                        >
                          <div>
                            <div className="font-semibold text-stone-900">
                              {s.recipientName} ({s.relationship}) • {s.recipientEmail}
                            </div>
                            <div className="text-[11px] text-stone-500">
                              Autorizado el {new Date(s.createdAt).toLocaleDateString('es-MX')} • Estado:{' '}
                              <span className={s.status === 'active' ? 'text-emerald-700 font-bold' : 'text-stone-400'}>
                                {s.status === 'active' ? 'Activo' : 'Revocado'}
                              </span>
                            </div>
                            {s.note && <p className="italic text-stone-600 mt-1">«{s.note}»</p>}
                          </div>

                          {s.status === 'active' && (
                            <button
                              type="button"
                              onClick={() => handleRevokeShare(s.id)}
                              className="text-rose-600 hover:text-rose-800 text-xs font-semibold px-2 py-1 rounded-lg hover:bg-rose-50 cursor-pointer"
                            >
                              Revocar acceso
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: PROGRAMAR ENTREGA DE MI LIBRO */}
              {activeTab === 'schedule' && (
                <div className="space-y-6">
                  <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-2xl text-xs text-stone-800 space-y-1">
                    <span className="font-serif font-bold text-amber-950 text-sm block">
                      Programar Entrega Futura del Libro Autobiográfico
                    </span>
                    <p>
                      Permite configurar una entrega futura mediante correo electrónico (ej. en un aniversario o fecha especial).
                    </p>
                    <p>
                      El destinatario recibirá acceso seguro exclusivamente al libro digital completo. No se adjuntan audios ni respuestas crudas.
                    </p>
                  </div>

                  {/* Schedule Form */}
                  <form onSubmit={handleAddScheduledDelivery} className="p-5 bg-white border border-stone-200 rounded-2xl space-y-3">
                    <h4 className="font-serif font-bold text-stone-900 text-sm">
                      Configurar nueva fecha de entrega
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1">
                          Destinatario:
                        </label>
                        <input
                          type="text"
                          required
                          value={schedRecipientName}
                          onChange={(e) => setSchedRecipientName(e.target.value)}
                          placeholder="Nombre completo"
                          className="w-full p-2.5 border border-stone-300 rounded-xl text-xs text-stone-800"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1">
                          Correo electrónico:
                        </label>
                        <input
                          type="email"
                          required
                          value={schedRecipientEmail}
                          onChange={(e) => setSchedRecipientEmail(e.target.value)}
                          placeholder="correo@ejemplo.com"
                          className="w-full p-2.5 border border-stone-300 rounded-xl text-xs text-stone-800"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1">
                          Fecha futura de entrega:
                        </label>
                        <input
                          type="date"
                          required
                          value={schedDate}
                          onChange={(e) => setSchedDate(e.target.value)}
                          className="w-full p-2.5 border border-stone-300 rounded-xl text-xs text-stone-800"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-stone-700 mb-1">
                        Nota para el destinatario:
                      </label>
                      <input
                        type="text"
                        value={schedNote}
                        onChange={(e) => setSchedNote(e.target.value)}
                        placeholder="Para que leas esta historia en tu cumpleaños..."
                        className="w-full p-2.5 border border-stone-300 rounded-xl text-xs text-stone-800"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={scheduling}
                      className="px-4 py-2 bg-amber-800 hover:bg-amber-900 text-white text-xs font-bold rounded-xl transition cursor-pointer"
                    >
                      {scheduling ? 'Guardando en Firebase...' : 'Confirmar Programación de Entrega'}
                    </button>
                  </form>

                  {/* Scheduled Deliveries list */}
                  <div className="space-y-3">
                    <h4 className="font-serif font-bold text-stone-900 text-sm">
                      Entregas programadas ({profileData?.scheduledDeliveries?.length || 0})
                    </h4>
                    {profileData?.scheduledDeliveries?.length === 0 ? (
                      <p className="text-xs text-stone-500 italic">No hay entregas programadas.</p>
                    ) : (
                      profileData?.scheduledDeliveries?.map((d: any) => (
                        <div
                          key={d.id}
                          className="p-4 bg-stone-50 rounded-xl border border-stone-200 flex items-center justify-between gap-3 text-xs"
                        >
                          <div>
                            <div className="font-semibold text-stone-900">
                              Destinatario: {d.recipientName} ({d.recipientEmail})
                            </div>
                            <div className="text-[11px] text-stone-500 mt-0.5">
                              Fecha programada: <strong>{d.scheduledDate}</strong> • Estado:{' '}
                              <span className="font-bold text-amber-800 uppercase">{d.status}</span>
                            </div>
                            {d.note && <p className="italic text-stone-600 mt-1">«{d.note}»</p>}
                          </div>

                          {d.status === 'scheduled' && (
                            <button
                              type="button"
                              onClick={() => handleCancelDelivery(d.id)}
                              className="text-rose-600 hover:text-rose-800 text-xs font-semibold px-2 py-1 rounded-lg hover:bg-rose-50 cursor-pointer"
                            >
                              Cancelar envío
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* TAB 4: PERSONAS AUTORIZADAS (ACCESOS SECUNDARIOS) */}
              {activeTab === 'secondary' && (
                <div className="space-y-6">
                  <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-2xl text-xs text-stone-800 space-y-1">
                    <span className="font-serif font-bold text-amber-950 text-sm block">
                      Configuración de Personas Autorizadas
                    </span>
                    <p>
                      Permite designar acompañantes o familiares para consultar el borrador del libro en desarrollo.
                    </p>
                    <p>
                      • No se concede acceso a audios originales, transcripciones crudas ni elevación de privilegios.
                    </p>
                  </div>

                  {/* Add form */}
                  <form onSubmit={handleAddSecondary} className="p-5 bg-white border border-stone-200 rounded-2xl space-y-3">
                    <h4 className="font-serif font-bold text-stone-900 text-sm">
                      Designar nueva persona autorizada
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1">
                          Nombre completo:
                        </label>
                        <input
                          type="text"
                          required
                          value={secName}
                          onChange={(e) => setSecName(e.target.value)}
                          placeholder="Nombre y apellidos"
                          className="w-full p-2.5 border border-stone-300 rounded-xl text-xs text-stone-800"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1">
                          Correo electrónico:
                        </label>
                        <input
                          type="email"
                          required
                          value={secEmail}
                          onChange={(e) => setSecEmail(e.target.value)}
                          placeholder="correo@ejemplo.com"
                          className="w-full p-2.5 border border-stone-300 rounded-xl text-xs text-stone-800"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1">
                          Parentesco:
                        </label>
                        <input
                          type="text"
                          value={secRelationship}
                          onChange={(e) => setSecRelationship(e.target.value)}
                          className="w-full p-2.5 border border-stone-300 rounded-xl text-xs text-stone-800"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={savingSecondary}
                      className="px-4 py-2 bg-amber-800 hover:bg-amber-900 text-white text-xs font-bold rounded-xl transition cursor-pointer"
                    >
                      {savingSecondary ? 'Guardando...' : 'Registrar Persona Autorizada'}
                    </button>
                  </form>

                  {/* List */}
                  <div className="space-y-3">
                    <h4 className="font-serif font-bold text-stone-900 text-sm">
                      Personas autorizadas ({profileData?.secondaryAccess?.length || 0})
                    </h4>
                    {profileData?.secondaryAccess?.length === 0 ? (
                      <p className="text-xs text-stone-500 italic">No hay personas autorizadas configuradas.</p>
                    ) : (
                      profileData?.secondaryAccess?.map((sa: any) => (
                        <div
                          key={sa.id}
                          className="p-4 bg-stone-50 rounded-xl border border-stone-200 flex items-center justify-between gap-3 text-xs"
                        >
                          <div>
                            <div className="font-semibold text-stone-900">
                              {sa.authorizedPersonName} ({sa.relationship}) • {sa.authorizedPersonEmail}
                            </div>
                            <div className="text-[11px] text-stone-500">
                              Registrado el {new Date(sa.createdAt).toLocaleDateString('es-MX')} • Permisos:{' '}
                              {sa.permissions?.join(', ')}
                            </div>
                          </div>

                          {sa.status === 'active' && (
                            <button
                              type="button"
                              onClick={() => handleRevokeSecondary(sa.id)}
                              className="text-rose-600 hover:text-rose-800 text-xs font-semibold px-2 py-1 rounded-lg hover:bg-rose-50 cursor-pointer"
                            >
                              Revocar permiso
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* TAB 5: ACCESO POSTERIOR AL FALLECIMIENTO */}
              {activeTab === 'postmortem' && (
                <div className="space-y-6">
                  <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-2xl text-xs text-stone-800 space-y-1">
                    <span className="font-serif font-bold text-amber-950 text-sm block">
                      Instrucciones Voluntarias de Legado Post-Mortem
                    </span>
                    <p>
                      Permite registrar instrucciones claras sobre a quién debe entregarse tu libro autobiográfico en caso de fallecimiento.
                    </p>
                    <p>
                      • No se activa automáticamente; requiere verificación fehaciente por parte de los deudos.
                    </p>
                    <p>
                      • Puedes modificar o retirar estas instrucciones en cualquier momento.
                    </p>
                  </div>

                  <form onSubmit={handleSavePostMortem} className="p-5 bg-white border border-stone-200 rounded-2xl space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1">
                          Persona designada:
                        </label>
                        <input
                          type="text"
                          required
                          value={pmName}
                          onChange={(e) => setPmName(e.target.value)}
                          placeholder="Nombre y apellidos"
                          className="w-full p-2.5 border border-stone-300 rounded-xl text-xs text-stone-800"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1">
                          Correo electrónico de contacto:
                        </label>
                        <input
                          type="email"
                          required
                          value={pmEmail}
                          onChange={(e) => setPmEmail(e.target.value)}
                          placeholder="correo@ejemplo.com"
                          className="w-full p-2.5 border border-stone-300 rounded-xl text-xs text-stone-800"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1">
                          Parentesco / Vínculo:
                        </label>
                        <input
                          type="text"
                          value={pmRelationship}
                          onChange={(e) => setPmRelationship(e.target.value)}
                          placeholder="Hijo mayor, Cónyuge"
                          className="w-full p-2.5 border border-stone-300 rounded-xl text-xs text-stone-800"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-stone-700 mb-1">
                        Instrucciones voluntarias expresas:
                      </label>
                      <textarea
                        rows={3}
                        required
                        value={pmInstructions}
                        onChange={(e) => setPmInstructions(e.target.value)}
                        placeholder="Deseo que mi libro sea entregado a mis hijos y nietos como recuerdo familiar..."
                        className="w-full p-2.5 border border-stone-300 rounded-xl text-xs text-stone-800"
                      />
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="submit"
                        disabled={savingPm}
                        className="px-4 py-2 bg-amber-800 hover:bg-amber-900 text-white text-xs font-bold rounded-xl transition cursor-pointer"
                      >
                        {savingPm ? 'Guardando en Firebase...' : 'Guardar Instrucciones de Legado'}
                      </button>

                      {profileData?.postMortemInstructions && (
                        <button
                          type="button"
                          onClick={handleRevokePostMortem}
                          className="text-rose-600 hover:text-rose-800 text-xs font-semibold px-3 py-2 rounded-xl hover:bg-rose-50"
                        >
                          Retirar / Revocar instrucciones
                        </button>
                      )}
                    </div>
                  </form>
                </div>
              )}

              {/* TAB 6: VERSIONES DEL AVISO */}
              {activeTab === 'versions' && (
                <div className="space-y-6">
                  <div className="p-5 bg-white border border-stone-200 rounded-2xl space-y-3">
                    <h4 className="font-serif font-bold text-stone-900 text-sm">
                      Avisos de Privacidad Publicados y Registro Histórico
                    </h4>
                    <p className="text-xs text-stone-600">
                      YouForever conserva un historial inalterable de cada versión legal publicada.
                      Las versiones institucionales son administradas por el Administrador General Autorizado.
                    </p>

                    <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-stone-900 text-sm">
                          Versión Vigente: {PRIVACY_NOTICE_VERSION}
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-900">
                          Vigente Oficial
                        </span>
                      </div>
                      <div className="text-stone-500">
                        Fecha de entrada en vigor: <strong>{PRIVACY_NOTICE_EFFECTIVE_DATE}</strong>
                      </div>
                      <div className="text-stone-500">
                        Normativa: Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP México 2025/2026)
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 7: REGISTROS Y AUDITORÍA */}
              {activeTab === 'audit' && (
                <div className="space-y-4">
                  <h4 className="font-serif font-bold text-stone-900 text-sm">
                    Registro Electrónico de Eventos de Privacidad y Auditoría
                  </h4>
                  <p className="text-xs text-stone-500">
                    Historial de eventos asociados a tu identidad verificable y consentimientos en Firebase:
                  </p>

                  <div className="space-y-2">
                    {profileData?.auditLogs?.length === 0 ? (
                      <p className="text-xs text-stone-500 italic">No hay registros de auditoría aún.</p>
                    ) : (
                      profileData?.auditLogs?.map((log: any) => (
                        <div
                          key={log.id}
                          className="p-3 bg-stone-50 rounded-xl border border-stone-200 text-xs flex items-center justify-between"
                        >
                          <div>
                            <span className="font-bold text-stone-800">{log.action}</span>
                            <span className="text-stone-500 block text-[11px]">
                              Recurso: {log.targetType} • ID: {log.targetId}
                            </span>
                          </div>
                          <span className="text-[11px] text-stone-400">
                            {new Date(log.timestamp).toLocaleString('es-MX')}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal for viewing documents */}
        {viewingDoc !== 'none' && (
          <div className="fixed inset-0 z-60 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-stone-200">
              <div className="p-4 border-b border-stone-200 flex items-center justify-between">
                <h4 className="font-serif font-bold text-stone-900 text-sm">
                  {viewingDoc === 'simplified' ? 'Aviso Simplificado' : 'Aviso Integral'}
                </h4>
                <button
                  type="button"
                  onClick={() => setViewingDoc('none')}
                  className="p-1 text-stone-400 hover:text-stone-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto">
                <pre className="whitespace-pre-wrap font-sans text-xs sm:text-sm text-stone-800 leading-relaxed">
                  {viewingDoc === 'simplified' ? SIMPLIFIED_PRIVACY_NOTICE : COMPREHENSIVE_PRIVACY_NOTICE}
                </pre>
              </div>
              <div className="p-3 border-t border-stone-200 flex justify-end">
                <button
                  type="button"
                  onClick={() => setViewingDoc('none')}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-amber-800 rounded-xl"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
