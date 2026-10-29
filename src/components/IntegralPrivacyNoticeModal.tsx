import React from 'react';
import { X, Shield, FileText, CheckCircle2, Mail, ExternalLink, Printer } from 'lucide-react';
import {
  INTEGRAL_PRIVACY_NOTICE_TEXT,
  SIMPLIFIED_PRIVACY_NOTICE_TEXT,
  INTEGRAL_PRIVACY_POLICY_HASH,
} from '../logic/privacyPolicyTexts.ts';
import {
  CURRENT_PRIVACY_POLICY_VERSION,
  CURRENT_PRIVACY_POLICY_DATE,
  RESPONSIBLE_CONTACT_EMAIL,
} from '../logic/interviewRules.ts';

interface IntegralPrivacyNoticeModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'integral' | 'simplificado';
}

export const IntegralPrivacyNoticeModal: React.FC<IntegralPrivacyNoticeModalProps> = ({
  isOpen,
  onClose,
  defaultTab = 'integral',
}) => {
  const [activeTab, setActiveTab] = React.useState<'integral' | 'simplificado'>(defaultTab);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-stone-950/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] shadow-2xl border border-stone-200 flex flex-col overflow-hidden text-stone-800">
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-stone-200 bg-stone-50 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-900 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5 text-amber-800" />
            </div>
            <div>
              <h3 className="font-serif text-lg sm:text-xl font-bold text-stone-900">
                Aviso de Privacidad de ForeverYou
              </h3>
              <p className="text-xs text-stone-500">
                Versión {CURRENT_PRIVACY_POLICY_VERSION} • Vigente desde {CURRENT_PRIVACY_POLICY_DATE}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handlePrint}
              className="hidden sm:inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-100 text-xs font-medium cursor-pointer"
              title="Imprimir documento"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimir</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-200 transition cursor-pointer"
              aria-label="Cerrar aviso de privacidad"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab switch */}
        <div className="flex border-b border-stone-200 bg-white px-6 pt-3 gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('integral')}
            className={`pb-3 px-3 text-xs sm:text-sm font-semibold border-b-2 transition cursor-pointer ${
              activeTab === 'integral'
                ? 'border-amber-800 text-amber-900'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            Aviso Integral (17 Secciones)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('simplificado')}
            className={`pb-3 px-3 text-xs sm:text-sm font-semibold border-b-2 transition cursor-pointer ${
              activeTab === 'simplificado'
                ? 'border-amber-800 text-amber-900'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            Aviso Simplificado
          </button>
        </div>

        {/* Content body */}
        <div className="p-6 overflow-y-auto space-y-4 text-xs sm:text-sm leading-relaxed text-stone-700">
          {activeTab === 'integral' ? (
            <div className="space-y-4 whitespace-pre-line font-sans">
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-950 text-xs">
                <strong>Integridad Documental:</strong> Este documento está registrado con huella digital SHA-256:{' '}
                <code className="font-mono text-[11px] block mt-1 break-all bg-white px-2 py-1 rounded border border-amber-200">
                  {INTEGRAL_PRIVACY_POLICY_HASH}
                </code>
              </div>
              <div className="prose prose-stone max-w-none text-stone-800 text-xs sm:text-sm">
                {INTEGRAL_PRIVACY_NOTICE_TEXT}
              </div>
            </div>
          ) : (
            <div className="space-y-4 whitespace-pre-line font-sans">
              <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 text-stone-800 text-sm leading-relaxed">
                {SIMPLIFIED_PRIVACY_NOTICE_TEXT}
              </div>
            </div>
          )}

          <div className="mt-6 pt-4 border-t border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-stone-500">
            <span className="flex items-center space-x-1.5">
              <Mail className="w-3.5 h-3.5 text-amber-700" />
              <span>Contacto ARCO: {RESPONSIBLE_CONTACT_EMAIL}</span>
            </span>
            <span>ForeverYou • Plataforma de Preservación de Historias de Vida</span>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-stone-200 bg-stone-50 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 bg-amber-800 hover:bg-amber-900 text-white rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer shadow-sm"
          >
            Entendido y cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
