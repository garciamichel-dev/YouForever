import React, { useState, useEffect } from 'react';
import {
  Shield,
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Mail,
  Calendar,
  Lock,
  UserCheck,
  Eye,
  Hash,
} from 'lucide-react';
import {
  PrivacyConsentRecord,
  ARCORequestRecord,
  BookDeliveryScheduleRecord,
  CURRENT_PRIVACY_POLICY_VERSION,
  CURRENT_PRIVACY_POLICY_DATE,
  RESPONSIBLE_CONTACT_EMAIL,
} from '../logic/interviewRules.ts';
import { INTEGRAL_PRIVACY_POLICY_HASH } from '../logic/privacyPolicyTexts.ts';
import { IntegralPrivacyNoticeModal } from './IntegralPrivacyNoticeModal.tsx';
import { apiFetch } from '../utils/apiClient.ts';


interface PrivacyAdminPanelProps {
  adminEmail: string | null;
}

export const PrivacyAdminPanel: React.FC<PrivacyAdminPanelProps> = ({ adminEmail }) => {
  const [consents, setConsents] = useState<PrivacyConsentRecord[]>([]);
  const [arcoRequests, setArcoRequests] = useState<ARCORequestRecord[]>([]);
  const [deliveries, setDeliveries] = useState<BookDeliveryScheduleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isFullNoticeOpen, setIsFullNoticeOpen] = useState(false);
  const [selectedConsent, setSelectedConsent] = useState<PrivacyConsentRecord | null>(null);

  const fetchPrivacyData = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);

      const adminHeader = { 'x-admin-user': adminEmail || 'garcia.michel@gmail.com' };

      const [consentsRes, arcoRes, deliveriesRes] = await Promise.all([
        apiFetch<PrivacyConsentRecord[]>('/api/admin/privacy/consents', { headers: adminHeader, retries: 2 }),
        apiFetch<ARCORequestRecord[]>('/api/admin/privacy/arco-requests', { headers: adminHeader, retries: 2 }),
        apiFetch<BookDeliveryScheduleRecord[]>('/api/admin/privacy/deliveries', { headers: adminHeader, retries: 2 }),
      ]);

      if (consentsRes.ok && consentsRes.data) {
        setConsents(consentsRes.data);
      }
      if (arcoRes.ok && arcoRes.data) {
        setArcoRequests(arcoRes.data);
      }
      if (deliveriesRes.ok && deliveriesRes.data) {
        setDeliveries(deliveriesRes.data);
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg('Error al conectar con la base de datos de privacidad.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrivacyData();
  }, []);

  return (
    <div className="space-y-6">
      {/* Top Banner: Current Policy Status & Cryptographic Hash */}
      <div className="bg-gradient-to-br from-stone-900 to-stone-800 text-stone-100 p-6 rounded-2xl border border-stone-700 shadow-md space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-xl bg-amber-600/30 border border-amber-500/40 flex items-center justify-center text-amber-300">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-serif text-lg font-bold text-amber-100">
                Políticas de Privacidad y Cumplimiento Normativo
              </h3>
              <p className="text-xs text-stone-400">
                Aviso de Privacidad Integral de ForeverYou (17 Secciones) • Verificabilidad Criptográfica SHA-256
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => setIsFullNoticeOpen(true)}
              className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-600 rounded-lg text-xs font-semibold transition cursor-pointer"
            >
              <FileText className="w-4 h-4 text-amber-400" />
              <span>Ver Aviso Integral Completo</span>
            </button>

            <button
              type="button"
              onClick={fetchPrivacyData}
              disabled={loading}
              className="inline-flex items-center space-x-1.5 px-3 py-2 bg-amber-700 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Actualizar Registros</span>
            </button>
          </div>
        </div>

        {/* Policy Metadata Card */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 text-xs">
          <div className="bg-stone-800/80 p-3 rounded-xl border border-stone-700">
            <span className="text-[10px] uppercase font-bold text-stone-400 block mb-0.5">Versión Activa</span>
            <span className="font-mono font-bold text-amber-300">v{CURRENT_PRIVACY_POLICY_VERSION}</span>
          </div>

          <div className="bg-stone-800/80 p-3 rounded-xl border border-stone-700">
            <span className="text-[10px] uppercase font-bold text-stone-400 block mb-0.5">Fecha de Emisión</span>
            <span className="font-medium text-stone-200">{CURRENT_PRIVACY_POLICY_DATE}</span>
          </div>

          <div className="bg-stone-800/80 p-3 rounded-xl border border-stone-700">
            <span className="text-[10px] uppercase font-bold text-stone-400 block mb-0.5">Canal Responsable ARCO</span>
            <span className="font-mono text-stone-200 truncate block" title={RESPONSIBLE_CONTACT_EMAIL}>
              {RESPONSIBLE_CONTACT_EMAIL}
            </span>
          </div>

          <div className="bg-stone-800/80 p-3 rounded-xl border border-stone-700">
            <span className="text-[10px] uppercase font-bold text-stone-400 block mb-0.5">Integridad SHA-256</span>
            <span className="font-mono text-[11px] text-amber-400 truncate block" title={INTEGRAL_PRIVACY_POLICY_HASH}>
              {INTEGRAL_PRIVACY_POLICY_HASH.substring(0, 16)}...
            </span>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* 1. Audit Trail: Consentimientos Registrados */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden space-y-3 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-stone-100 gap-2">
          <div>
            <h4 className="font-serif font-bold text-base text-stone-900 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-emerald-700" />
              <span>Bitácora de Consentimientos Informados ({consents.length})</span>
            </h4>
            <p className="text-xs text-stone-500">
              Registros inmutables con timestamp del servidor (UTC y Mérida) y hash criptográfico por participante
            </p>
          </div>
          <span className="text-xs text-stone-500 font-mono">
            {consents.filter((c) => c.status === 'active').length} activos • {consents.filter((c) => c.status === 'revoked').length} revocados
          </span>
        </div>

        {consents.length === 0 ? (
          <div className="py-8 text-center text-xs text-stone-400 italic">
            No se han registrado consentimientos informados aún.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50">
                  <th className="py-2.5 px-3">Participante / Entrevista</th>
                  <th className="py-2.5 px-3">Versión</th>
                  <th className="py-2.5 px-3">Fecha y Hora (Mérida / UTC)</th>
                  <th className="py-2.5 px-3">Autorizaciones (A-G)</th>
                  <th className="py-2.5 px-3">Hash Criptográfico</th>
                  <th className="py-2.5 px-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {consents.map((consent: any) => {
                  const versionLabel = consent.versionId || consent.policyVersion || CURRENT_PRIVACY_POLICY_VERSION;
                  const rawTimestamp = consent.acceptedAt || consent.serverTimestamp || new Date().toISOString();
                  const hashValue = consent.declarationHash || consent.noticeHash || consent.policyHash || '';
                  const decl = consent.declarations;

                  return (
                    <tr key={consent.id} className="hover:bg-stone-50/80 transition-colors">
                      <td className="py-3 px-3">
                        <div className="font-bold text-stone-900">{consent.participantName}</div>
                        <div className="text-[11px] text-stone-500 truncate max-w-[200px]" title={consent.interviewId}>
                          Entrevista: {consent.interviewId}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <span className="font-mono font-semibold bg-stone-100 px-2 py-0.5 rounded text-stone-800">
                          v{versionLabel}
                        </span>
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-medium text-stone-800">
                          {new Date(rawTimestamp).toLocaleString('es-MX', {
                            timeZone: consent.serverTimezone || 'America/Merida',
                          })}
                        </div>
                        <div className="text-[10px] font-mono text-stone-400">
                          UTC: {rawTimestamp}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        {decl ? (
                          <div className="flex flex-wrap gap-1 max-w-[160px]">
                            {decl?.declarationA_acknowledgement && (
                              <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded" title="A: Conocimiento">A</span>
                            )}
                            {decl?.declarationB_necessaryProcessing && (
                              <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded" title="B: Procesamiento">B</span>
                            )}
                            {decl?.declarationC_sensitiveData && (
                              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded" title="C: Datos Sensibles">C</span>
                            )}
                            {decl?.declarationD_financialData && (
                              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded" title="D: Datos Patrimoniales">D</span>
                            )}
                            {decl?.declarationE_aiAssistant && (
                              <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-800 text-[10px] font-bold rounded" title="E: Asistente IA">E</span>
                            )}
                            {decl?.declarationF_shareWithFamily && (
                              <span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-bold rounded" title="F: Compartir Familia">F</span>
                            )}
                            {decl?.declarationG_promotionalUse && (
                              <span className="px-1.5 py-0.5 bg-purple-100 text-purple-800 text-[10px] font-bold rounded" title="G: Uso Promocional">G</span>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded">
                              ✓ Casilla Única Integral
                            </span>
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        <span className="font-mono text-[11px] text-stone-600 bg-stone-100 px-2 py-0.5 rounded" title={hashValue}>
                          {hashValue ? `${hashValue.substring(0, 12)}...` : 'Verificado'}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedConsent(consent)}
                          className="inline-flex items-center gap-1 text-[11px] text-amber-800 hover:text-amber-900 font-semibold cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Detalles</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 2. Solicitudes de Derechos ARCO */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden space-y-3 p-6">
        <div className="flex items-center justify-between pb-3 border-b border-stone-100">
          <div>
            <h4 className="font-serif font-bold text-base text-stone-900 flex items-center gap-2">
              <Mail className="w-4 h-4 text-amber-700" />
              <span>Solicitudes de Derechos ARCO ({arcoRequests.length})</span>
            </h4>
            <p className="text-xs text-stone-500">
              Gestión de peticiones de Acceso, Rectificación, Cancelación y Oposición dirigidas a {RESPONSIBLE_CONTACT_EMAIL}
            </p>
          </div>
        </div>

        {arcoRequests.length === 0 ? (
          <div className="py-6 text-center text-xs text-stone-400 italic">
            No hay solicitudes ARCO registradas.
          </div>
        ) : (
          <div className="space-y-3">
            {arcoRequests.map((req: any) => (
              <div key={req.id} className="p-3.5 bg-stone-50 rounded-xl border border-stone-200 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-stone-900">
                    Derecho Solicitado: <span className="uppercase text-amber-900">{req.requestType}</span>
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-900">
                    {req.status}
                  </span>
                </div>
                <p className="text-stone-700">«{req.details}»</p>
                <div className="text-[11px] text-stone-400">
                  Participante: {req.participantName} • Contacto: {req.contactEmail || req.participantEmail || 'N/A'} •{' '}
                  {new Date(req.submittedAt || req.createdAt || new Date().toISOString()).toLocaleString('es-MX')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Entregas Digitales Programadas a Futuro */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden space-y-3 p-6">
        <div className="flex items-center justify-between pb-3 border-b border-stone-100">
          <div>
            <h4 className="font-serif font-bold text-base text-stone-900 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-amber-700" />
              <span>Entregas Digitales Programadas a Futuro ({deliveries.length})</span>
            </h4>
            <p className="text-xs text-stone-500">
              Despacho programado del libro digitalizado completo a correos designados por los participantes
            </p>
          </div>
        </div>

        {deliveries.length === 0 ? (
          <div className="py-6 text-center text-xs text-stone-400 italic">
            No hay entregas automáticas programadas por el momento.
          </div>
        ) : (
          <div className="space-y-3">
            {deliveries.map((del: any) => (
              <div key={del.id} className="p-3.5 bg-stone-50 rounded-xl border border-stone-200 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-stone-900">
                    Destinatario: <strong>{del.recipientEmail}</strong> ({del.recipientName || 'Sin nombre'})
                  </span>
                  <span className="font-mono text-amber-800 bg-amber-100 px-2 py-0.5 rounded text-[11px]">
                    Entrega programada: {del.scheduledDate}
                  </span>
                </div>
                {(del.notes || del.note) && (
                  <p className="text-stone-600 italic">«{del.notes || del.note}»</p>
                )}
                <div className="text-[11px] text-stone-400">
                  Participante: {del.participantName || del.participantId} • Programada el {new Date(del.createdAt).toLocaleString('es-MX')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Single Consent Detail Modal */}
      {selectedConsent && (() => {
        const sc: any = selectedConsent;
        const scVersion = sc.versionId || sc.policyVersion || CURRENT_PRIVACY_POLICY_VERSION;
        const scTimestamp = sc.acceptedAt || sc.serverTimestamp || new Date().toISOString();
        const scHash = sc.declarationHash || sc.noticeHash || sc.policyHash || INTEGRAL_PRIVACY_POLICY_HASH;

        return (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-stone-200 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                <h3 className="font-serif font-bold text-base text-stone-900">
                  Constancia Oficial de Consentimiento
                </h3>
                <button
                  type="button"
                  onClick={() => setSelectedConsent(null)}
                  className="text-stone-400 hover:text-stone-700 cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="text-xs space-y-2 bg-stone-50 p-4 rounded-xl border border-stone-200">
                <div>
                  <strong>Participante:</strong> {sc.participantName}
                </div>
                <div>
                  <strong>Entrevista:</strong> {sc.interviewId}
                </div>
                <div>
                  <strong>Versión del Aviso:</strong> v{scVersion}
                </div>
                <div>
                  <strong>Fecha/Hora Mérida:</strong>{' '}
                  {new Date(scTimestamp).toLocaleString('es-MX', {
                    timeZone: sc.serverTimezone || 'America/Merida',
                  })}
                </div>
                <div>
                  <strong>Fecha/Hora UTC:</strong> {scTimestamp}
                </div>
                {sc.declarationText && (
                  <div>
                    <strong>Declaración Aceptada:</strong>
                    <p className="mt-1 italic text-stone-700 bg-white p-2.5 rounded-lg border border-stone-200">
                      «{sc.declarationText}»
                    </p>
                  </div>
                )}
                <div>
                  <strong>Hash SHA-256 de Constancia:</strong>{' '}
                  <span className="font-mono text-[11px] break-all block mt-0.5 text-stone-700">
                    {scHash}
                  </span>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedConsent(null)}
                  className="px-4 py-2 bg-stone-900 text-white rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal Aviso de Privacidad Integral de ForeverYou (17 Secciones) */}
      <IntegralPrivacyNoticeModal
        isOpen={isFullNoticeOpen}
        onClose={() => setIsFullNoticeOpen(false)}
      />
    </div>
  );
};
