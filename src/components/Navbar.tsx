import React from 'react';
import { ShieldCheck, LogOut } from 'lucide-react';
import { ForeverYouLogo } from './ForeverYouLogo';
import { ThemeToggleButton } from '../context/ThemeContext';

interface NavbarProps {
  currentView: 'admin' | 'participant' | 'conoceme' | 'demo' | 'mi_esencia';
  onSelectView: (view: 'admin' | 'participant' | 'conoceme' | 'demo' | 'mi_esencia') => void;
  adminEmail: string | null;
  isAuthorizedAdmin: boolean;
  onLogout: () => void;
  onOpenFaq: () => void;
  onOpenPrivacyNotice?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentView,
  onSelectView,
  adminEmail,
  isAuthorizedAdmin,
  onLogout,
  onOpenFaq: _onOpenFaq,
  onOpenPrivacyNotice: _onOpenPrivacyNotice,
}) => {
  const getTabClassName = (isActive: boolean) =>
    `px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors cursor-pointer ${
      isActive
        ? 'bg-amber-800/80 text-amber-100 border border-amber-600/40 shadow-xs'
        : 'text-stone-300 hover:text-white hover:bg-stone-800'
    }`;

  return (
    <header className="bg-stone-900 text-stone-100 border-b border-stone-800 sticky top-0 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div
            className="flex items-center space-x-3 cursor-pointer select-none"
            onClick={() => onSelectView(isAuthorizedAdmin ? 'admin' : 'participant')}
          >
            <ForeverYouLogo
              variant="horizontal"
              theme="light"
              size="md"
              subtitle="Entrevistas de Vida & Patrimonio Familiar"
            />
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center space-x-2">
            {isAuthorizedAdmin && (
              <>
                <button
                  onClick={() => onSelectView('admin')}
                  className={getTabClassName(currentView === 'admin')}
                >
                  Panel Administrador
                </button>
                <button
                  onClick={() => onSelectView('participant')}
                  className={getTabClassName(currentView === 'participant')}
                >
                  Portal del Participante
                </button>
                <a
                  href="/miesencia"
                  onClick={(e) => {
                    e.preventDefault();
                    onSelectView('mi_esencia');
                  }}
                  className={getTabClassName(currentView === 'mi_esencia')}
                  title="Ir al portal familiar Mi Esencia (/miesencia)"
                >
                  Mi Esencia
                </a>
                <button
                  onClick={() => onSelectView('conoceme')}
                  className={getTabClassName(currentView === 'conoceme')}
                  title="Ir a la sección comercial Conóceme (/conoceme)"
                >
                  Conóceme
                </button>
              </>
            )}

            <button
              onClick={() => onSelectView('demo')}
              className={getTabClassName(currentView === 'demo')}
              title="Prueba Gratuita — Mi historia en 8 preguntas (/demo)"
            >
              Prueba Gratuita
            </button>
          </nav>

          {/* Actions */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            <ThemeToggleButton />

            {/* Admin Badge & Logout - ONLY visible when authorized admin */}
            {isAuthorizedAdmin && adminEmail && (
              <div className="flex items-center space-x-2 border bg-stone-800/80 border-emerald-800/50 px-2.5 py-1 rounded-md text-xs text-stone-200">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span className="max-w-[120px] sm:max-w-[180px] truncate" title={adminEmail}>
                  {adminEmail}
                </span>
                <button
                  onClick={onLogout}
                  title="Cerrar sesión de administrador"
                  className="text-stone-400 hover:text-rose-400 p-0.5 ml-1 transition cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
