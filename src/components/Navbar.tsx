import React from 'react';
import { BookOpen, ShieldCheck, LogOut, Sparkles } from 'lucide-react';

interface NavbarProps {
  currentView: 'admin' | 'participant' | 'conoceme';
  onSelectView: (view: 'admin' | 'participant' | 'conoceme') => void;
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
  return (
    <header className="bg-stone-900 text-stone-100 border-b border-stone-800 sticky top-0 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div
            className="flex items-center space-x-3 cursor-pointer select-none"
            onClick={() => onSelectView(isAuthorizedAdmin ? 'admin' : 'participant')}
          >
            <div className="w-10 h-10 rounded-lg bg-amber-700/80 border border-amber-600/50 flex items-center justify-center text-amber-100 shadow-inner">
              <BookOpen className="w-5 h-5 text-amber-200" />
            </div>
            <div>
              <span className="font-serif text-lg font-bold tracking-tight text-amber-50">
                ForeverYou
              </span>
              <span className="block text-[11px] text-stone-400 font-sans tracking-wide">
                Entrevistas de Vida &amp; Patrimonio Familiar
              </span>
            </div>
          </div>

          {/* Navigation Tabs - ONLY visible when user is an authorized administrator */}
          {isAuthorizedAdmin && (
            <nav className="flex items-center space-x-2">
              <button
                onClick={() => onSelectView('admin')}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors cursor-pointer ${
                  currentView === 'admin'
                    ? 'bg-amber-800/80 text-amber-100 border border-amber-600/40 shadow-xs'
                    : 'text-stone-300 hover:text-white hover:bg-stone-800'
                }`}
              >
                <span>Panel Administrador</span>
              </button>
              <button
                onClick={() => onSelectView('participant')}
                className={`px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors cursor-pointer ${
                  currentView === 'participant'
                    ? 'bg-amber-800/80 text-amber-100 border border-amber-600/40 shadow-xs'
                    : 'text-stone-300 hover:text-white hover:bg-stone-800'
                }`}
              >
                Portal del Participante
              </button>
              <button
                onClick={() => onSelectView('conoceme')}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors cursor-pointer ${
                  currentView === 'conoceme'
                    ? 'bg-amber-800/80 text-amber-100 border border-amber-600/40 shadow-xs'
                    : 'text-amber-300 hover:text-amber-100 hover:bg-stone-800'
                }`}
                title="Ir a la sección comercial Conóceme (/conoceme)"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Conóceme</span>
              </button>
            </nav>
          )}

          {/* Actions */}
          <div className="flex items-center space-x-2 sm:space-x-3">

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
