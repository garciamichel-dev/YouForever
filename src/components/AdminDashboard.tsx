import React, { useState } from 'react';
import { Users, HelpCircle, Settings, BookOpen, Shield, ShieldCheck, Sparkles, Lock } from 'lucide-react';
import { ConfigPanel } from './ConfigPanel.tsx';
import { QuestionBankPanel } from './QuestionBankPanel.tsx';
import { InterviewsPanel } from './InterviewsPanel.tsx';
import { ManuscriptsView } from './ManuscriptsView.tsx';
import { AuditLogsPanel } from './AuditLogsPanel.tsx';
import { PrivacyAdminPanel } from './PrivacyAdminPanel.tsx';

interface AdminDashboardProps {
  adminEmail: string | null;
  refreshTrigger?: number;
  onEnterParticipantPortal: (plainToken: string) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  adminEmail,
  refreshTrigger,
  onEnterParticipantPortal,
}) => {
  const [activeTab, setActiveTab] = useState<'interviews' | 'questions' | 'config' | 'manuscripts' | 'audit' | 'privacy'>('interviews');
  const [selectedInterviewIdForManuscript, setSelectedInterviewIdForManuscript] = useState<string | null>(null);

  const handleOpenManuscript = (interviewId: string) => {
    setSelectedInterviewIdForManuscript(interviewId);
    setActiveTab('manuscripts');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Admin Tab Navigation */}
      <div className="flex border-b border-stone-200 space-x-1 sm:space-x-3 overflow-x-auto pb-1 text-xs sm:text-sm font-semibold">
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
      </div>

      {/* Tab Panels */}
      <div>
        {activeTab === 'interviews' && (
          <InterviewsPanel
            adminEmail={adminEmail}
            refreshTrigger={refreshTrigger}
            onOpenManuscript={handleOpenManuscript}
            onEnterParticipantPortal={onEnterParticipantPortal}
          />
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
      </div>
    </div>
  );
};
