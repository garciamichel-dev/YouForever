import React, { useState, useEffect } from 'react';
import {
  Users,
  Plus,
  Calendar,
  Clock,
  Sparkles,
  BookOpen,
  Copy,
  Check,
  AlertCircle,
  CheckCircle2,
  Lock,
  Unlock,
  RotateCcw,
  ShieldAlert,
  ChevronRight,
  ExternalLink,
  HelpCircle,
  FileText,
  Share2,
  MessageCircle,
  Key,
  X,
  Search,
  Archive,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { InterviewRecord, ParticipantRecord, SufficiencyStatus } from '../logic/interviewRules.ts';
import { apiFetch } from '../utils/apiClient.ts';


interface EnrichedInterview extends InterviewRecord {
  participants: Array<ParticipantRecord & { plainToken?: string; accessCode?: string; inviteUrl?: string }>;
  answersCount: number;
  manuscriptsCount?: number;
  latestManuscriptVersion?: number;
}

interface InterviewsPanelProps {
  adminEmail: string | null;
  refreshTrigger?: number;
  onOpenManuscript: (interviewId: string) => void;
  onEnterParticipantPortal: (plainToken: string) => void;
}

export const InterviewsPanel: React.FC<InterviewsPanelProps> = ({
  adminEmail,
  refreshTrigger,
  onOpenManuscript,
  onEnterParticipantPortal,
}) => {
  const [interviews, setInterviews] = useState<EnrichedInterview[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('todos');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // App info for shared URL
  const [appInfo, setAppInfo] = useState<{ appUrl: string; sharedUrl: string; isDevUrl: boolean } | null>(null);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showExtendModal, setShowExtendModal] = useState<EnrichedInterview | null>(null);
  const [showReopenModal, setShowReopenModal] = useState<EnrichedInterview | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EnrichedInterview | null>(null);
  const [resetTarget, setResetTarget] = useState<EnrichedInterview | null>(null);
  const [isProcessingAction, setIsProcessingAction] = useState(false);
  const [sharingData, setSharingData] = useState<{
    interview: EnrichedInterview;
    participant: ParticipantRecord & { plainToken?: string; accessCode?: string };
  } | null>(null);
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);
  const [compilingId, setCompilingId] = useState<string | null>(null);
  const [downloadingZipId, setDownloadingZipId] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  // New Interview Form
  const [newTitle, setNewTitle] = useState('');
  const [newMode, setNewMode] = useState<'individual' | 'compartida'>('individual');
  const [newType, setNewType] = useState('biografia_personal');
  const [newOpenDays, setNewOpenDays] = useState<number>(15);
  const [newThreshold, setNewThreshold] = useState<number>(100);
  const [participantsList, setParticipantsList] = useState<
    Array<{ name: string; relationship: string; role: 'primary' | 'contributor'; email?: string }>
  >([{ name: '', relationship: 'Titular', role: 'primary', email: '' }]);

  // Extension & Reopen forms
  const [extendDays, setExtendDays] = useState<number>(7);
  const [reopenDays, setReopenDays] = useState<number>(14);
  const [reopenReason, setReopenReason] = useState<string>('El participante solicitó ampliar sus testimonios');

  const fetchInterviews = async () => {
    try {
      setLoading(true);
      const [resInterviews, resAppInfo] = await Promise.all([
        apiFetch<EnrichedInterview[]>('/api/interviews', {
          headers: {
            'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
          },
          retries: 2,
        }),
        apiFetch<{ appUrl: string; sharedUrl: string; isDevUrl: boolean }>('/api/app-info', {
          retries: 1,
        }),
      ]);

      if (resInterviews.ok && resInterviews.data) {
        setInterviews(resInterviews.data);
      } else if (resInterviews.error && adminEmail) {
        console.warn('Notice loading interviews:', resInterviews.error);
      }

      if (resAppInfo.ok && resAppInfo.data) {
        setAppInfo(resAppInfo.data);
      }
    } catch (err) {
      console.error('Error fetching interviews:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInterviews();
  }, [refreshTrigger]);

  const getPublicShareUrl = (token: string) => {
    const origin = window.location.origin;
    // If on Google Cloud Run dev container URL (ais-dev-), use the public shared URL (ais-pre-)
    let targetOrigin = origin;
    if (origin.includes('ais-dev-')) {
      targetOrigin = origin.replace('ais-dev-', 'ais-pre-');
    } else if (appInfo?.sharedUrl) {
      targetOrigin = appInfo.sharedUrl;
    }
    return `${targetOrigin}/interview?token=${token}`;
  };

  const handleCopyLink = (token: string) => {
    const fullUrl = getPublicShareUrl(token);
    navigator.clipboard.writeText(fullUrl);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 3000);
  };

  const handleCreateInterview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    try {
      const res = await fetch('/api/interviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
        body: JSON.stringify({
          title: newTitle.trim(),
          storyMode: newMode,
          storyType: newType,
          customOpenDays: newOpenDays,
          customSufficiencyThreshold: newThreshold,
          participants: participantsList.filter((p) => p.name.trim().length > 0),
        }),
      });

      const data = await res.json();
      if (data.success) {
        setShowCreateModal(false);
        setNewTitle('');
        setParticipantsList([{ name: '', relationship: 'Titular', role: 'primary', email: '' }]);
        fetchInterviews();
        setNoticeMessage('¡Entrevista creada exitosamente con enlaces de invitación seguros!');
        setTimeout(() => setNoticeMessage(null), 4000);
      } else {
        alert(data.error || 'Error al crear la entrevista.');
      }
    } catch (err: unknown) {
      alert('Error de conexión al crear la entrevista.');
    }
  };

  const handleExtend = async () => {
    if (!showExtendModal || extendDays <= 0) return;
    try {
      const res = await fetch(`/api/interviews/${showExtendModal.id}/extend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
        body: JSON.stringify({ additionalDays: extendDays }),
      });
      const data = await res.json();
      if (data.success) {
        setShowExtendModal(null);
        fetchInterviews();
        setNoticeMessage(`Plazo extendido por ${extendDays} días naturales.`);
        setTimeout(() => setNoticeMessage(null), 4000);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleReopen = async () => {
    if (!showReopenModal || reopenDays <= 0) return;
    try {
      const res = await fetch(`/api/interviews/${showReopenModal.id}/reopen`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
        body: JSON.stringify({ newDays: reopenDays, reason: reopenReason }),
      });
      const data = await res.json();
      if (data.success) {
        setShowReopenModal(null);
        fetchInterviews();
        setNoticeMessage(`Entrevista reabierta por ${reopenDays} días naturales.`);
        setTimeout(() => setNoticeMessage(null), 4000);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleEvaluateSufficiency = async (interviewId: string) => {
    try {
      setEvaluatingId(interviewId);
      const res = await fetch(`/api/interviews/${interviewId}/evaluate`, {
        method: 'POST',
        headers: {
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
      });
      const data = await res.json();
      if (data.success) {
        fetchInterviews();
        setNoticeMessage(
          `Evaluación de suficiencia completada: ${data.data.sufficiencyStatus}. ${data.data.rationale}`
        );
      }
    } catch (err) {
      console.error(err);
    } finally {
      setEvaluatingId(null);
    }
  };

  const handleCompileManuscript = async (interviewId: string) => {
    try {
      setCompilingId(interviewId);
      const res = await fetch(`/api/interviews/${interviewId}/manuscript`, {
        method: 'POST',
        headers: {
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
      });
      const data = await res.json();
      if (data.success) {
        onOpenManuscript(interviewId);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCompilingId(null);
    }
  };

  const handleDownloadBackupZip = async (interviewId: string) => {
    try {
      setDownloadingZipId(interviewId);
      const res = await fetch(`/api/interviews/${interviewId}/backup/zip`, {
        headers: {
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
      });
      if (!res.ok) throw new Error('Error al generar el respaldo ZIP');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const contentDisposition = res.headers.get('content-disposition');
      let filename = `respaldo_legado_${interviewId}.zip`;
      if (contentDisposition && contentDisposition.includes('filename="')) {
        filename = contentDisposition.split('filename="')[1].split('"')[0];
      }
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error downloading backup zip:', err);
      setNoticeMessage('No se pudo descargar el archivo de respaldo ZIP.');
      setTimeout(() => setNoticeMessage(null), 4000);
    } finally {
      setDownloadingZipId(null);
    }
  };

  const handleDeleteInterview = async (interview: EnrichedInterview) => {
    try {
      setIsProcessingAction(true);
      const res = await fetch(`/api/interviews/${encodeURIComponent(interview.id)}`, {
        method: 'DELETE',
        headers: {
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
      });
      const data = await res.json();
      if (data.success) {
        setInterviews((prev) => prev.filter((inv) => inv.id !== interview.id));
        setNoticeMessage(`La entrevista «${interview.title}» fue eliminada de la base de datos.`);
        setTimeout(() => setNoticeMessage(null), 4000);
      } else {
        setNoticeMessage(data.error || 'Error al eliminar la entrevista.');
      }
    } catch (err) {
      setNoticeMessage('Error de red al eliminar la entrevista.');
    } finally {
      setIsProcessingAction(false);
      setDeleteTarget(null);
    }
  };

  const handleResetInterview = async (interview: EnrichedInterview) => {
    try {
      setIsProcessingAction(true);
      const res = await fetch(`/api/interviews/${encodeURIComponent(interview.id)}/reset`, {
        method: 'POST',
        headers: {
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
      });
      const data = await res.json();
      if (data.success) {
        await fetchInterviews();
        setNoticeMessage(
          `La entrevista «${interview.title}» ha sido restablecida al inicio. El participante podrá comenzar a contestar desde el principio.`
        );
        setTimeout(() => setNoticeMessage(null), 5000);
      } else {
        setNoticeMessage(data.error || 'Error al restablecer la entrevista.');
      }
    } catch (err) {
      setNoticeMessage('Error de red al restablecer la entrevista.');
    } finally {
      setIsProcessingAction(false);
      setResetTarget(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'open':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300/60">
            Abierta
          </span>
        );
      case 'completed':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-300/60">
            Completada
          </span>
        );
      case 'expired':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-300/60">
            Vencida
          </span>
        );
      case 'ready_for_review':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300/60">
            En Revisión
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-stone-100 text-stone-700">
            {status}
          </span>
        );
    }
  };

  const getSufficiencyBadge = (sufficiency: SufficiencyStatus) => {
    switch (sufficiency) {
      case 'sufficient':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
            ✓ Suficiente
          </span>
        );
      case 'sufficient_with_limitations':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            ⚠ Suficiente con limitaciones
          </span>
        );
      case 'insufficient':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-stone-100 text-stone-700 border border-stone-200">
            Insuficiente
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[11px] text-stone-400">
            No evaluada
          </span>
        );
    }
  };

  const filteredInterviews = interviews.filter((inv) => {
    if (statusFilter !== 'todos' && inv.status !== statusFilter) {
      return false;
    }

    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase().trim();

    // Match title, ID, storyType
    if ((inv.title || '').toLowerCase().includes(term)) return true;
    if ((inv.id || '').toLowerCase().includes(term)) return true;
    if ((inv.storyType || '').toLowerCase().includes(term)) return true;

    // Match any participant name (first name, surname), email, relationship, accessCode
    const matchParticipant = (inv.participants || []).some((p) => {
      const name = (p.name || '').toLowerCase();
      const email = (p.email || '').toLowerCase();
      const relationship = (p.relationship || '').toLowerCase();
      const accessCode = (p.accessCode || '').toLowerCase();
      return (
        name.includes(term) ||
        email.includes(term) ||
        relationship.includes(term) ||
        accessCode.includes(term)
      );
    });

    return matchParticipant;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold font-serif text-stone-900 flex items-center space-x-2">
            <Users className="w-5 h-5 text-amber-700" />
            <span>Gestión de Entrevistas &amp; Historias de Vida</span>
          </h2>
          <p className="text-sm text-stone-500">
            Supervisa el ciclo de vida, participantes invitados, cobertura testimonial y manuscritos.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center space-x-1.5 px-4 py-2.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-semibold shadow-sm transition"
        >
          <Plus className="w-4 h-4" />
          <span>Nueva Entrevista</span>
        </button>
      </div>

      {noticeMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 text-xs flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{noticeMessage}</span>
        </div>
      )}

      {/* Search & Filter Bar */}
      {interviews.length > 0 && (
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute left-3 top-3 text-stone-400" />
            <input
              type="text"
              placeholder="Buscar por nombre, apellido de participante, título, parentesco o correo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-8 py-2 border border-stone-300 rounded-lg text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-600"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-2.5 text-stone-400 hover:text-stone-700 p-0.5 rounded transition"
                title="Limpiar búsqueda"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center space-x-2 w-full sm:w-auto justify-between sm:justify-end">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filtrar por estado"
              className="border border-stone-300 rounded-lg px-2.5 py-2 text-xs text-stone-800 bg-white focus:outline-none focus:ring-2 focus:ring-amber-200 font-medium"
            >
              <option value="todos">Todos los Estados</option>
              <option value="open">Abierta</option>
              <option value="ready_for_review">En Revisión</option>
              <option value="completed">Completada</option>
              <option value="expired">Vencida</option>
            </select>

            {searchTerm.trim() ? (
              <div className="flex items-center space-x-2">
                <span className="bg-amber-50 text-amber-900 border border-amber-200 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap">
                  {filteredInterviews.length} {filteredInterviews.length === 1 ? 'coincidencia' : 'coincidencias'}
                </span>
                <button
                  onClick={() => setSearchTerm('')}
                  className="text-amber-800 hover:underline text-[11px] font-medium"
                >
                  Limpiar
                </button>
              </div>
            ) : (
              <span className="text-xs text-stone-500 font-medium whitespace-nowrap px-1">
                {filteredInterviews.length} {filteredInterviews.length === 1 ? 'entrevista' : 'entrevistas'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Interviews List */}
      <div className="space-y-4">
        {interviews.length === 0 ? (
          <div className="bg-white p-12 text-center rounded-xl border border-stone-200 text-stone-500">
            <BookOpen className="w-8 h-8 mx-auto text-stone-400 mb-2" />
            <p className="font-serif text-base font-semibold text-stone-800">
              No hay entrevistas registradas aún.
            </p>
            <p className="text-xs text-stone-500 mt-1">
              Crea una nueva historia individual o compartida para comenzar la recopilación testimonial.
            </p>
          </div>
        ) : filteredInterviews.length === 0 ? (
          <div className="bg-white p-12 text-center rounded-xl border border-stone-200 text-stone-500 space-y-3">
            <Search className="w-8 h-8 mx-auto text-stone-400 mb-2" />
            <p className="font-serif text-base font-semibold text-stone-800">
              No se encontraron entrevistas para «{searchTerm}»
            </p>
            <p className="text-xs text-stone-500 max-w-md mx-auto">
              Verifica el nombre o apellido del participante, título o estado seleccionado.
            </p>
            <div className="pt-2">
              <button
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('todos');
                }}
                className="inline-flex items-center space-x-1.5 px-4 py-2 bg-stone-800 hover:bg-stone-900 text-white rounded-lg text-xs font-semibold transition"
              >
                <X className="w-3.5 h-3.5" />
                <span>Limpiar Búsqueda y Filtros</span>
              </button>
            </div>
          </div>
        ) : (
          filteredInterviews.map((inv) => {
            const isExpired = new Date(inv.expiresAt).getTime() < Date.now();
            const daysRemaining = Math.max(
              0,
              Math.ceil((new Date(inv.expiresAt).getTime() - Date.now()) / (1000 * 3600 * 24))
            );

            return (
              <div
                key={inv.id}
                className="bg-white rounded-xl border border-stone-200 shadow-sm p-5 hover:border-amber-200 transition"
              >
                {/* Header row */}
                <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-stone-100 gap-3">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-serif text-lg font-bold text-stone-900">
                        {inv.title}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-stone-100 text-stone-700 uppercase tracking-wide">
                        {inv.storyMode === 'compartida' ? 'Historia Compartida' : 'Historia Individual'}
                      </span>
                      {getStatusBadge(inv.status)}
                    </div>
                    <div className="flex items-center space-x-4 mt-1 text-xs text-stone-500">
                      <span className="flex items-center space-x-1">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>
                          Abierta:{' '}
                          {new Date(inv.openedAt).toLocaleDateString('es-MX', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </span>
                      <span className="flex items-center space-x-1">
                        <Clock className="w-3.5 h-3.5" />
                        <span className={isExpired ? 'text-rose-600 font-semibold' : ''}>
                          Vence:{' '}
                          {new Date(inv.expiresAt).toLocaleDateString('es-MX', {
                            month: 'short',
                            day: 'numeric',
                          })}{' '}
                          ({isExpired ? 'Vencida' : `${daysRemaining} días restantes`})
                        </span>
                      </span>
                      {inv.closedAt && (
                        <span className="text-stone-400">
                          Cerrada: {new Date(inv.closedAt).toLocaleDateString('es-MX')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleEvaluateSufficiency(inv.id)}
                      disabled={evaluatingId === inv.id}
                      className="inline-flex items-center space-x-1 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 rounded-lg text-xs font-medium transition disabled:opacity-50"
                      title="Evalúa con Gemini la cobertura y riqueza testimonial"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                      <span>{evaluatingId === inv.id ? 'Evaluando...' : 'Evaluar Cobertura'}</span>
                    </button>

                    {inv.manuscriptsCount && inv.manuscriptsCount > 0 ? (
                      <button
                        onClick={() => onOpenManuscript(inv.id)}
                        className="inline-flex items-center space-x-1 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold shadow-sm transition"
                        title="Abrir los borradores de manuscritos guardados en la base de datos"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>Ver Manuscritos ({inv.manuscriptsCount})</span>
                      </button>
                    ) : null}

                    <button
                      onClick={() => handleCompileManuscript(inv.id)}
                      disabled={compilingId === inv.id}
                      className="inline-flex items-center space-x-1 px-3 py-1.5 bg-stone-800 hover:bg-stone-900 text-white rounded-lg text-xs font-semibold shadow-sm transition disabled:opacity-50"
                      title="Genera el borrador del manuscrito fidedigno a partir de testimonios"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>
                        {compilingId === inv.id
                          ? 'Compilando...'
                          : inv.manuscriptsCount && inv.manuscriptsCount > 0
                          ? 'Nueva Versión Manuscrito'
                          : 'Generar Manuscrito'}
                      </span>
                    </button>

                    {/* Descargar Respaldo Testimonial Integral (ZIP) */}
                    <button
                      onClick={() => handleDownloadBackupZip(inv.id)}
                      disabled={downloadingZipId === inv.id}
                      className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-50"
                      title="Descargar respaldo integral en ZIP: Libro biográfico, compilado de preguntas y respuestas, audios de voz originales y fotografías"
                    >
                      {downloadingZipId === inv.id ? (
                        <>
                          <Clock className="w-3.5 h-3.5 animate-spin text-amber-700" />
                          <span>Preparando ZIP...</span>
                        </>
                      ) : (
                        <>
                          <Archive className="w-3.5 h-3.5 text-amber-700" />
                          <span>Descargar Respaldo (ZIP)</span>
                        </>
                      )}
                    </button>

                    {/* Extend or Reopen */}
                    {inv.status === 'open' && (
                      <button
                        onClick={() => setShowExtendModal(inv)}
                        className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg text-xs font-medium transition"
                      >
                        <Clock className="w-3.5 h-3.5 text-stone-500" />
                        <span>Extender Plazo</span>
                      </button>
                    )}

                    {(inv.status === 'completed' || inv.status === 'expired') && (
                      <button
                        onClick={() => setShowReopenModal(inv)}
                        className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-medium transition"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Reabrir</span>
                      </button>
                    )}

                    {/* Reset Interview to Beginning */}
                    <button
                      onClick={() => setResetTarget(inv)}
                      className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-lg text-xs font-medium transition"
                      title="Restablecer la entrevista al inicio para que el entrevistado empiece a contestar desde el principio"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
                      <span>Restablecer al Inicio</span>
                    </button>

                    {/* Delete Interview from Database */}
                    <button
                      onClick={() => setDeleteTarget(inv)}
                      className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 hover:border-rose-300 rounded-lg text-xs font-medium transition"
                      title="Eliminar permanentemente esta entrevista y sus datos de la base de datos"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                      <span>Eliminar</span>
                    </button>
                  </div>
                </div>

                {/* Progress & Sufficiency Metrics */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-3 border-b border-stone-100 text-xs">
                  <div>
                    <span className="text-stone-500 block">Preguntas Completadas:</span>
                    <span className="font-semibold text-stone-800 text-sm">
                      {inv.completedQuestionCount} respondidas{' '}
                      <span className="text-stone-400 font-normal">
                        (Umbral operativo: {inv.sufficiencyThreshold})
                      </span>
                    </span>
                  </div>

                  <div>
                    <span className="text-stone-500 block">Estado de Suficiencia Narrativa:</span>
                    <div className="mt-0.5">{getSufficiencyBadge(inv.sufficiencyStatus)}</div>
                  </div>

                  <div>
                    <span className="text-stone-500 block">Finalización Voluntaria:</span>
                    <span className="font-medium text-stone-800">
                      {inv.userDeclaredComplete ? (
                        <span className="text-blue-700 font-semibold">
                          Declarada por el participante
                        </span>
                      ) : (
                        <span className="text-stone-400">En curso</span>
                      )}
                    </span>
                  </div>
                </div>

                {/* Participants & Invitation Links */}
                <div className="pt-3">
                  <h4 className="text-xs font-bold text-stone-700 uppercase tracking-wide mb-2">
                    Participantes &amp; Enlaces de Acceso Criptográficos
                  </h4>

                  <div className="space-y-2">
                    {inv.participants.map((p) => (
                      <div
                        key={p.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 bg-stone-50 rounded-lg border border-stone-200/70 text-xs gap-2"
                      >
                        <div className="flex items-center space-x-2">
                          <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-900 font-bold flex items-center justify-center text-[10px]">
                            {p.name.charAt(0)}
                          </div>
                          <div>
                            <span className="font-semibold text-stone-900">{p.name}</span>
                            <span className="text-stone-500 ml-1.5">({p.relationship})</span>
                            <span className="ml-2 text-[10px] text-stone-400">
                              [{p.role === 'primary' ? 'Titular' : 'Colaborador'}]
                            </span>
                          </div>
                        </div>

                        {p.plainToken ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {p.accessCode && (
                              <span className="font-mono text-[10px] bg-amber-50 text-amber-900 border border-amber-200 px-1.5 py-0.5 rounded font-bold">
                                Código: {p.accessCode}
                              </span>
                            )}

                            <button
                              onClick={() => setSharingData({ interview: inv, participant: p })}
                              className="inline-flex items-center space-x-1 px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded text-[11px] font-semibold shadow-xs transition"
                              title="Abrir opciones de compartir por WhatsApp, código o enlace público"
                            >
                              <Share2 className="w-3.5 h-3.5 text-amber-700" />
                              <span>Compartir</span>
                            </button>

                            <button
                              onClick={() => handleCopyLink(p.plainToken!)}
                              className="inline-flex items-center space-x-1 px-2 py-1 bg-white hover:bg-stone-100 text-stone-700 border border-stone-300 rounded text-[11px] font-medium shadow-xs transition"
                              title="Copiar enlace directo público"
                            >
                              {copiedToken === p.plainToken ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                                  <span className="text-emerald-700">Copiado</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5 text-stone-400" />
                                  <span>Enlace</span>
                                </>
                              )}
                            </button>

                            <button
                              onClick={() => onEnterParticipantPortal(p.plainToken!)}
                              className="inline-flex items-center space-x-1 px-2.5 py-1 bg-amber-700 hover:bg-amber-800 text-white rounded text-[11px] font-medium shadow-xs transition"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>Entrar como {p.name.split(' ')[0]}</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-stone-400 text-[11px]">Enlace no disponible</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal: Create New Interview */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-xl w-full p-6 shadow-2xl border border-stone-200 max-h-[90vh] overflow-y-auto">
            <h3 className="font-serif text-lg font-bold text-stone-900 pb-3 border-b border-stone-200 mb-4">
              Crear Nueva Entrevista de Legado Digital
            </h3>

            <form onSubmit={handleCreateInterview} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  Título de la Obra o Historia *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Memorias y Raíces de la Abuela Elena"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Modalidad</label>
                  <select
                    value={newMode}
                    onChange={(e) => {
                      const mode = e.target.value as 'individual' | 'compartida';
                      setNewMode(mode);
                      if (mode === 'compartida' && participantsList.length < 2) {
                        setParticipantsList([
                          ...participantsList,
                          { name: '', relationship: 'Hijo/a', role: 'contributor', email: '' },
                        ]);
                      }
                    }}
                    className="w-full px-2.5 py-2 border border-stone-300 rounded-lg text-xs text-stone-900"
                  >
                    <option value="individual">Historia Individual (1 persona)</option>
                    <option value="compartida">Historia Compartida (2 o más personas)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Tipo de Historia</label>
                  <input
                    type="text"
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    placeholder="Ej. biografia_familiar, valores"
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs text-stone-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Días de Apertura (Copia de plantilla)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={newOpenDays}
                    onChange={(e) => setNewOpenDays(parseInt(e.target.value) || 15)}
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs text-stone-900"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Umbral de Suficiencia (Preguntas)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    value={newThreshold}
                    onChange={(e) => setNewThreshold(parseInt(e.target.value) || 100)}
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs text-stone-900"
                  />
                </div>
              </div>

              {/* Participants Section */}
              <div className="border-t border-stone-200 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="block font-bold text-stone-800">
                    Participantes de la Historia ({participantsList.length})
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setParticipantsList([
                        ...participantsList,
                        { name: '', relationship: 'Familiar', role: 'contributor', email: '' },
                      ])
                    }
                    className="text-amber-800 hover:text-amber-900 font-semibold text-[11px]"
                  >
                    + Agregar Participante
                  </button>
                </div>

                <div className="space-y-2">
                  {participantsList.map((p, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-stone-50 border border-stone-200 rounded-lg grid grid-cols-3 gap-2"
                    >
                      <div>
                        <label className="block text-[10px] text-stone-500">Nombre completo *</label>
                        <input
                          type="text"
                          required
                          value={p.name}
                          onChange={(e) => {
                            const updated = [...participantsList];
                            updated[idx].name = e.target.value;
                            setParticipantsList(updated);
                          }}
                          placeholder="Nombre"
                          className="w-full px-2 py-1.5 border border-stone-300 rounded text-xs"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-stone-500">Parentesco / Rol</label>
                        <input
                          type="text"
                          value={p.relationship}
                          onChange={(e) => {
                            const updated = [...participantsList];
                            updated[idx].relationship = e.target.value;
                            setParticipantsList(updated);
                          }}
                          placeholder="Ej. Padre, Madre, Hijo"
                          className="w-full px-2 py-1.5 border border-stone-300 rounded text-xs"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-stone-500">Rol</label>
                        <select
                          value={p.role}
                          onChange={(e) => {
                            const updated = [...participantsList];
                            updated[idx].role = e.target.value as any;
                            setParticipantsList(updated);
                          }}
                          className="w-full px-2 py-1.5 border border-stone-300 rounded text-xs"
                        >
                          <option value="primary">Titular</option>
                          <option value="contributor">Colaborador</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t border-stone-200">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-lg font-semibold"
                >
                  Crear Entrevista
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Extend Open Days */}
      {showExtendModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 shadow-xl border border-stone-200 text-xs space-y-4">
            <h3 className="font-serif text-base font-bold text-stone-900">
              Extender Periodo de Apertura
            </h3>
            <p className="text-stone-500">
              Entrevista: <strong>{showExtendModal.title}</strong>
            </p>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">
                Días naturales a sumar
              </label>
              <input
                type="number"
                min="1"
                max="180"
                value={extendDays}
                onChange={(e) => setExtendDays(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowExtendModal(null)}
                className="px-3 py-1.5 border border-stone-300 rounded-lg hover:bg-stone-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExtend}
                className="px-4 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg font-semibold"
              >
                Aplicar Extensión
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Reopen Interview */}
      {showReopenModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 shadow-xl border border-stone-200 text-xs space-y-4">
            <h3 className="font-serif text-base font-bold text-stone-900">
              Reabrir Entrevista Cerrada o Vencida
            </h3>
            <p className="text-stone-500">
              Entrevista: <strong>{showReopenModal.title}</strong>
            </p>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">
                Días naturales para la reapertura
              </label>
              <input
                type="number"
                min="1"
                max="90"
                value={reopenDays}
                onChange={(e) => setReopenDays(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs"
              />
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">
                Motivo de la reapertura (registrado en auditoría)
              </label>
              <textarea
                rows={2}
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                placeholder="Razón de reapertura..."
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowReopenModal(null)}
                className="px-3 py-1.5 border border-stone-300 rounded-lg hover:bg-stone-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleReopen}
                className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-semibold"
              >
                Confirmar Reapertura
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Share Participant Invitation */}
      {sharingData && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-stone-200 text-xs space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-stone-200">
              <div className="flex items-center space-x-2">
                <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
                  <Share2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-serif text-base font-bold text-stone-900">
                    Compartir Invitación con {sharingData.participant.name}
                  </h3>
                  <p className="text-[11px] text-stone-500">
                    Historia: <strong>{sharingData.interview.title}</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSharingData(null)}
                className="text-stone-400 hover:text-stone-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Explanation Notice for iOS / 403 prevention */}
            <div className="p-3.5 bg-amber-50/80 border border-amber-200 rounded-xl space-y-1.5 text-stone-700">
              <div className="flex items-center space-x-1.5 text-amber-900 font-bold">
                <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                <span>Solución a bloqueos en Safari y error 403 de Google</span>
              </div>
              <p className="text-[11px] text-stone-600 leading-relaxed">
                Las URLs de desarrollo de AI Studio (<code className="bg-amber-100 px-1 py-0.5 rounded text-[10px]">ais-dev-</code>) exigen acceso privado de Google y son bloqueadas en Safari con error 403.
                Para que cualquier familiar pueda responder <strong>sin crear cuenta ni iniciar sesión</strong>, compártele el <strong>Código de Acceso</strong> o el <strong>Enlace Público</strong> a continuación:
              </p>
            </div>

            {/* Access Code Box */}
            {sharingData.participant.accessCode && (
              <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-stone-700 flex items-center space-x-1">
                    <Key className="w-3.5 h-3.5 text-amber-700" />
                    <span>Código de Acceso Rápido (Recomendado para Móvil)</span>
                  </span>
                  <span className="text-[10px] text-stone-400">Sin cookies ni enlaces complejos</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="flex-1 bg-white border border-stone-300 rounded-lg p-2.5 font-mono text-center text-base font-bold text-stone-900 tracking-wider">
                    {sharingData.participant.accessCode}
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(sharingData.participant.accessCode!);
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 3000);
                    }}
                    className="px-3 py-2.5 bg-stone-800 hover:bg-stone-900 text-white rounded-lg font-semibold transition"
                  >
                    {copiedCode ? '¡Copiado!' : 'Copiar Código'}
                  </button>
                </div>
                <p className="text-[10px] text-stone-500">
                  El participante solo entra a la página, teclea este código y comienza de inmediato.
                </p>
              </div>
            )}

            {/* Direct Public Link Box */}
            {sharingData.participant.plainToken && (
              <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 space-y-2">
                <span className="font-semibold text-stone-700 block">
                  Enlace Directo Público (con token seguro pre-cargado)
                </span>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    readOnly
                    value={getPublicShareUrl(sharingData.participant.plainToken)}
                    className="flex-1 bg-white border border-stone-300 rounded-lg px-2.5 py-2 font-mono text-[11px] text-stone-700 truncate"
                  />
                  <button
                    onClick={() => handleCopyLink(sharingData.participant.plainToken!)}
                    className="px-3 py-2 bg-white hover:bg-stone-100 border border-stone-300 text-stone-800 rounded-lg font-semibold transition"
                  >
                    {copiedToken === sharingData.participant.plainToken ? '¡Copiado!' : 'Copiar Enlace'}
                  </button>
                </div>
              </div>
            )}

            {/* WhatsApp Ready Message */}
            <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-2">
              <span className="font-semibold text-emerald-950 flex items-center space-x-1.5">
                <MessageCircle className="w-4 h-4 text-emerald-700" />
                <span>Mensaje listo para WhatsApp / SMS / Correo</span>
              </span>
              <p className="text-[11px] text-stone-600 bg-white p-3 rounded-lg border border-emerald-100 font-sans leading-relaxed whitespace-pre-line">
                {`Hola ${sharingData.participant.name}, te invito a participar en la historia de vida «${sharingData.interview.title}».

Puedes ingresar directamente desde este enlace:
${getPublicShareUrl(sharingData.participant.plainToken || '')}

O si lo prefieres, entra a la aplicación e ingresa tu código de acceso:
👉 ${sharingData.participant.accessCode || ''}

Tus recuerdos y testimonios serán preservados con total fidelidad para nuestra memoria familiar.`}
              </p>

              <button
                onClick={() => {
                  const message = `Hola ${sharingData.participant.name}, te invito a participar en la historia de vida «${sharingData.interview.title}».

Puedes ingresar directamente desde este enlace:
${getPublicShareUrl(sharingData.participant.plainToken || '')}

O si lo prefieres, entra a la aplicación e ingresa tu código de acceso:
👉 ${sharingData.participant.accessCode || ''}

Tus recuerdos y testimonios serán preservados con total fidelidad para nuestra memoria familiar.`;
                  navigator.clipboard.writeText(message);
                  setCopiedMessage(true);
                  setTimeout(() => setCopiedMessage(false), 3000);
                }}
                className="w-full py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-semibold text-xs flex items-center justify-center space-x-1.5 transition shadow-xs"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedMessage ? '¡Mensaje Copiado al Portapapeles!' : 'Copiar Mensaje Completo para WhatsApp'}</span>
              </button>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSharingData(null)}
                className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 text-xs"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirm Delete Interview */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl border-2 border-rose-200">
            <div className="flex items-center space-x-3 text-rose-600 mb-3">
              <div className="p-3 bg-rose-100 rounded-xl">
                <Trash2 className="w-6 h-6 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-900">
                  ¿Eliminar entrevista de la base de datos?
                </h3>
                <p className="text-xs text-rose-600 font-semibold">
                  Confirmación de eliminación definitiva
                </p>
              </div>
            </div>

            <p className="text-xs text-stone-600 leading-relaxed mb-3">
              Estás a punto de eliminar permanentemente la siguiente entrevista de la base de datos:
            </p>

            <div className="bg-stone-50 border border-stone-200 rounded-lg p-3.5 mb-4 text-xs space-y-2">
              <div className="font-serif font-bold text-stone-900 text-sm">{deleteTarget.title}</div>
              <div className="font-mono text-[11px] text-stone-500">ID: {deleteTarget.id}</div>
              <ul className="text-stone-600 list-disc list-inside space-y-1 pt-1 text-[11px]">
                <li>
                  <strong>{deleteTarget.participants.length}</strong> participante(s) invitado(s) y sus tokens de acceso.
                </li>
                <li>
                  <strong>{deleteTarget.answersCount}</strong> respuesta(s) registrada(s), audios y fotografías adjuntas.
                </li>
                {deleteTarget.manuscriptsCount !== undefined && deleteTarget.manuscriptsCount > 0 && (
                  <li>
                    <strong>{deleteTarget.manuscriptsCount}</strong> borrador(es) de manuscrito asociado(s).
                  </li>
                )}
              </ul>
            </div>

            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg mb-4 text-[11px] text-rose-800 flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>
                Esta acción no se puede deshacer. Todos los datos se borrarán permanentemente tanto del servidor como de Firestore.
              </span>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-stone-200">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={isProcessingAction}
                className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 text-xs font-medium"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleDeleteInterview(deleteTarget)}
                disabled={isProcessingAction}
                className="px-4 py-2 bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition shadow-sm"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isProcessingAction ? 'Eliminando...' : 'Confirmar Eliminación en Base de Datos'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirm Reset Interview to Beginning */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl border-2 border-amber-200">
            <div className="flex items-center space-x-3 text-amber-700 mb-3">
              <div className="p-3 bg-amber-100 rounded-xl">
                <RotateCcw className="w-6 h-6 text-amber-700" />
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-900">
                  ¿Restablecer entrevista al inicio?
                </h3>
                <p className="text-xs text-amber-700 font-semibold">
                  Confirmación previa requerida para eliminar respuestas previas
                </p>
              </div>
            </div>

            <p className="text-xs text-stone-600 leading-relaxed mb-3">
              Estás a punto de restablecer la historia <strong>«{resetTarget.title}»</strong> para que el entrevistado comience a responder desde el principio.
            </p>

            <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-3.5 mb-4 text-xs space-y-2">
              <p className="font-semibold text-amber-950">Al confirmar este restablecimiento:</p>
              <ul className="text-amber-900 list-disc list-inside space-y-1 text-[11px]">
                <li>
                  Se <strong>eliminarán de la base de datos</strong> todas las {resetTarget.answersCount} respuestas contestadas, grabaciones de voz y fotografías adjuntas.
                </li>
                <li>
                  El contador de preguntas respondidas volverá a <strong>0</strong> y el estado pasará a <strong>«Abierta»</strong>.
                </li>
                <li>
                  Los enlaces de invitación y códigos de acceso seguirán activos, permitiendo a los participantes empezar a contestar desde la primera pregunta.
                </li>
              </ul>
            </div>

            <div className="p-3 bg-stone-100 border border-stone-200 rounded-lg mb-4 text-[11px] text-stone-600 flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-stone-500 shrink-0 mt-0.5" />
              <span>
                Las respuestas anteriores se perderán definitivamente para permitir reiniciar el instrumento desde cero.
              </span>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-stone-200">
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                disabled={isProcessingAction}
                className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 text-xs font-medium"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleResetInterview(resetTarget)}
                disabled={isProcessingAction}
                className="px-4 py-2 bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition shadow-sm"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{isProcessingAction ? 'Restableciendo...' : 'Confirmar y Restablecer al Inicio'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
