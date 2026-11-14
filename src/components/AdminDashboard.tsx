import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  HelpCircle,
  Settings,
  BookOpen,
  Shield,
  Sparkles,
  Lock,
  BarChart3,
  Activity,
  AlertTriangle,
  ShieldAlert,
} from 'lucide-react';
import { ConfigPanel } from './ConfigPanel.tsx';
import { QuestionBankPanel } from './QuestionBankPanel.tsx';
import { InterviewsPanel } from './InterviewsPanel.tsx';
import { ManuscriptsView } from './ManuscriptsView.tsx';
import { AuditLogsPanel } from './AuditLogsPanel.tsx';
import { PrivacyAdminPanel } from './PrivacyAdminPanel.tsx';
import { MiEsenciaAdminSection } from '../modules/mi-esencia/MiEsenciaAdminSection.tsx';
import { SystemStatisticsPanel } from './SystemStatisticsPanel.tsx';
import { FirestoreQuotaPanel } from './FirestoreQuotaPanel.tsx';
import type { FirestoreQuotaReport } from '../logic/firestoreQuota.ts';
import { apiFetch } from '../utils/apiClient.ts';

interface AdminDashboardProps {
  adminEmail: string | null;
  refreshTrigger?: number;
  onEnterParticipantPortal: (plainToken: string) => void;
  onOpenConoceme?: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  adminEmail,
  refreshTrigger,
  onEnterParticipantPortal,
  onOpenConoceme,
}) => {
  const [activeTab, setActiveTab] = useState<
    'interviews' | 'questions' | 'config' | 'manuscripts' | 'audit' | 'privacy' | 'mi_esencia' | 'statistics' | 'quotas'
  >('interviews');
  const [selectedInterviewIdForManuscript, setSelectedInterviewIdForManuscript] = useState<string | null>(null);
  const [quotaReport, setQuotaReport] = useState<FirestoreQuotaReport | null>(null);
  const [quotaSyncTick, setQuotaSyncTick] = useState<number>(0);

  const checkQuotaStatus = useCallback(async () => {
    try {
      const res = await apiFetch<FirestoreQuotaReport>('/api/admin/firestore-quota', {
        headers: {
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
        retries: 0,
      });
      if (res.ok && res.data) {
        setQuotaReport(res.data);
      }
    } catch {
      // ignore non-fatal telemetry poll error
    }
  }, [adminEmail]);

  useEffect(() => {
    void checkQuotaStatus();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void checkQuotaStatus();
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [checkQuotaStatus]);

  const handleOpenManuscript = (interviewId: string) => {
    setSelectedInterviewIdForManuscript(interviewId);
    setActiveTab('manuscripts');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Global Admin Firestore >=80% / Exceeded Alert Banner */}
      {quotaReport && quotaReport.alertLevel !== 'normal' && activeTab !== 'quotas' && (
        <div
          data-testid="admin-global-quota-banner"
          className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
            quotaReport.alertLevel === 'exceeded'
              ? 'bg-rose-50 border-rose-300 text-rose-950'
              : 'bg-amber-50 border-amber-300 text-amber-950'
          }`}
        >
          <div className="flex items-start space-x-2.5">
            {quotaReport.alertLevel === 'exceeded' ? (
              <ShieldAlert className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            )}
            <div className="space-y-0.5">
              <p className="font-bold">{quotaReport.alertTitle}</p>
              <p className="opacity-90">
                Uso actual: {quotaReport.metrics.reads.used.toLocaleString('es-MX')} /{' '}
                {quotaReport.metrics.reads.freeLimit.toLocaleString('es-MX')} lecturas ({quotaReport.metrics.reads.percent.toFixed(1)}%) ·{' '}
                {quotaReport.metrics.writes.used.toLocaleString('es-MX')} /{' '}
                {quotaReport.metrics.writes.freeLimit.toLocaleString('es-MX')} escrituras ({quotaReport.metrics.writes.percent.toFixed(1)}%).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('quotas')}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-stone-50 border border-stone-300 text-stone-900 rounded-lg font-semibold shrink-0 cursor-pointer"
          >
            <Activity className="w-3.5 h-3.5 text-amber-700" />
            <span>Ver Monitor de Cuotas</span>
          </button>
        </div>
      )}

      {/* Admin Tab Navigation */}
      <div className="flex items-center justify-between border-b border-stone-200 overflow-x-auto pb-1 text-xs sm:text-sm font-semibold gap-2">
        <div className="flex space-x-1 sm:space-x-3">
          <button
            onClick={() => setActiveTab('interviews')}
            className={`flex items-center space-x-2 py-3 px-3 sm:px-4 border-b-2 transition whitespace-nowrap cursor-pointer ${
              activeTab === 'interviews'
                ? 'border-amber-700 text-amber-900 font-bold'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Gestión de Entrevistas</span>
          </button>

          <button
            onClick={() => setActiveTab('mi_esencia')}
            className={`flex items-center space-x-2 py-3 px-3 sm:px-4 border-b-2 transition whitespace-nowrap cursor-pointer ${
              activeTab === 'mi_esencia'
                ? 'border-amber-700 text-amber-900 font-bold'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Sparkles className="w-4 h-4 text-amber-700" />
            <span>Mi Esencia</span>
          </button>

          <button
            onClick={() => setActiveTab('statistics')}
            className={`flex items-center space-x-2 py-3 px-3 sm:px-4 border-b-2 transition whitespace-nowrap cursor-pointer ${
              activeTab === 'statistics'
                ? 'border-amber-700 text-amber-900 font-bold'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <BarChart3 className="w-4 h-4 text-amber-700" />
            <span>Estadísticas</span>
          </button>

          <button
            onClick={() => setActiveTab('questions')}
            className={`flex items-center space-x-2 py-3 px-3 sm:px-4 border-b-2 transition whitespace-nowrap cursor-pointer ${
              activeTab === 'questions'
                ? 'border-amber-700 text-amber-900 font-bold'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <HelpCircle className="w-4 h-4" />
            <span>Banco de Preguntas</span>
          </button>

          <button
            onClick={() => setActiveTab('config')}
            className={`flex items-center space-x-2 py-3 px-3 sm:px-4 border-b-2 transition whitespace-nowrap cursor-pointer ${
              activeTab === 'config'
                ? 'border-amber-700 text-amber-900 font-bold'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Configuración Global</span>
          </button>

          <button
            onClick={() => {
              setSelectedInterviewIdForManuscript(null);
              setActiveTab('manuscripts');
            }}
            className={`flex items-center space-x-2 py-3 px-3 sm:px-4 border-b-2 transition whitespace-nowrap cursor-pointer ${
              activeTab === 'manuscripts'
                ? 'border-amber-700 text-amber-900 font-bold'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Borradores de Manuscritos</span>
          </button>

          <button
            onClick={() => setActiveTab('privacy')}
            className={`flex items-center space-x-2 py-3 px-3 sm:px-4 border-b-2 transition whitespace-nowrap cursor-pointer ${
              activeTab === 'privacy'
                ? 'border-amber-700 text-amber-900 font-bold'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Lock className="w-4 h-4 text-emerald-700" />
            <span>Políticas &amp; Privacidad</span>
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`flex items-center space-x-2 py-3 px-3 sm:px-4 border-b-2 transition whitespace-nowrap cursor-pointer ${
              activeTab === 'audit'
                ? 'border-amber-700 text-amber-900 font-bold'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Shield className="w-4 h-4" />
            <span>Bitácora de Auditoría</span>
          </button>

          <button
            onClick={() => setActiveTab('quotas')}
            data-testid="tab-quotas"
            className={`flex items-center space-x-2 py-3 px-3 sm:px-4 border-b-2 transition whitespace-nowrap cursor-pointer ${
              activeTab === 'quotas'
                ? 'border-amber-700 text-amber-900 font-bold'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Activity
              className={`w-4 h-4 ${
                quotaReport?.alertLevel === 'exceeded'
                  ? 'text-rose-700'
                  : quotaReport?.alertLevel === 'warning_80'
                    ? 'text-amber-700'
                    : 'text-emerald-700'
              }`}
            />
            <span>Cuotas Firestore</span>
            {quotaReport && quotaReport.alertLevel !== 'normal' && (
              <span className="font-mono text-[11px] font-bold text-amber-800 tabular-nums">
                ({quotaReport.highestPercent.toFixed(0)}%)
              </span>
            )}
          </button>
        </div>

        {onOpenConoceme && (
          <button
            onClick={onOpenConoceme}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 my-1 bg-amber-800 hover:bg-amber-900 text-amber-50 rounded-lg text-xs font-semibold shadow-xs transition whitespace-nowrap cursor-pointer shrink-0"
            title="Abrir la sección comercial Conóceme (/conoceme)"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>Sección Conóceme</span>
          </button>
        )}
      </div>

      {/* Tab Panels */}
      <div>
        {activeTab === 'interviews' && (
          <InterviewsPanel
            adminEmail={adminEmail}
            refreshTrigger={(refreshTrigger || 0) + quotaSyncTick}
            onOpenManuscript={handleOpenManuscript}
            onEnterParticipantPortal={onEnterParticipantPortal}
          />
        )}

        {activeTab === 'mi_esencia' && (
          <MiEsenciaAdminSection adminEmail={adminEmail || ''} />
        )}

        {activeTab === 'statistics' && (
          <SystemStatisticsPanel adminEmail={adminEmail} defaultScope="all" />
        )}

        {activeTab === 'questions' && (
          <QuestionBankPanel adminEmail={adminEmail} />
        )}

        {activeTab === 'config' && (
          <ConfigPanel adminEmail={adminEmail} />
        )}

        {activeTab === 'manuscripts' && (
          <ManuscriptsView
            interviewId={selectedInterviewIdForManuscript}
            adminEmail={adminEmail}
            onBack={() => setActiveTab('interviews')}
            onSelectInterview={(id) => setSelectedInterviewIdForManuscript(id)}
          />
        )}

        {activeTab === 'privacy' && (
          <PrivacyAdminPanel adminEmail={adminEmail} />
        )}

        {activeTab === 'audit' && (
          <AuditLogsPanel adminEmail={adminEmail} />
        )}

        {activeTab === 'quotas' && (
          <FirestoreQuotaPanel
            adminEmail={adminEmail}
            onSyncedInterviews={() => setQuotaSyncTick((t) => t + 1)}
            onReportLoaded={(r) => setQuotaReport(r)}
          />
        )}
      </div>
    </div>
  );
};
