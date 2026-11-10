import React, { useState } from 'react';
import { Shield, ShieldAlert, LogIn } from 'lucide-react';
import { ForeverYouLogo } from './ForeverYouLogo';

interface AdminLoginViewProps {
  adminEmail: string | null;
  isAuthorizedAdmin: boolean;
  onLogin: () => Promise<void>;
  onLogout: () => Promise<void>;
  onGoToParticipant?: () => void;
}

export const AdminLoginView: React.FC<AdminLoginViewProps> = ({
  adminEmail,
  isAuthorizedAdmin,
  onLogin,
  onLogout,
}) => {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      await onLogin();
    } catch (err: unknown) {
      console.error('Login error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('popup-closed-by-user')) {
        setErrorMessage('La ventana de inicio de sesión fue cerrada antes de completar el proceso.');
      } else if (msg.includes('popup-blocked')) {
        setErrorMessage('Tu navegador bloqueó la ventana emergente de Google. Permite las ventanas emergentes para este sitio.');
      } else {
        setErrorMessage('Error al comunicarse con Google Auth. Inténtalo nuevamente.');
      }
    } finally {
      setLoading(false);
    }
  };

  // State 1: User is logged in with Google, but NOT authorized as administrator
  if (adminEmail && !isAuthorizedAdmin) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12">
        <div className="bg-white rounded-2xl shadow-xl border border-rose-200 overflow-hidden">
          <div className="bg-rose-900 text-white p-6 text-center">
            <div className="w-16 h-16 bg-rose-800 rounded-full flex items-center justify-center mx-auto mb-3 shadow-inner">
              <ShieldAlert className="w-8 h-8 text-rose-200" />
            </div>
            <h2 className="font-serif text-2xl font-bold">Acceso Denegado</h2>
            <p className="text-xs text-rose-200 mt-1">Cuenta de Google no autorizada como Administrador</p>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 text-sm text-stone-700 space-y-2">
              <p>
                Has iniciado sesión con la cuenta:
              </p>
              <div className="font-mono text-sm bg-white border border-stone-300 px-3 py-1.5 rounded-lg text-stone-900 font-semibold break-all">
                {adminEmail}
              </div>
              <p className="text-xs text-stone-500 pt-1">
                Esta cuenta no figura en la lista de administradores autorizados para gestionar la plataforma YouForever.
              </p>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900 flex items-start space-x-2">
              <Shield className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block">Acceso Restringido:</span>
                <p className="mt-1 text-stone-600">
                  Esta consola está reservada exclusivamente para el administrador autorizado de la plataforma. Para acceder, debes iniciar sesión con una cuenta de Google con permisos concedidos previamente.
                </p>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={onLogout}
                className="w-full py-3 px-4 bg-stone-900 hover:bg-stone-800 text-white text-sm font-semibold rounded-xl shadow transition flex items-center justify-center space-x-2 cursor-pointer"
              >
                <LogIn className="w-4 h-4" />
                <span>Cerrar Sesión y Cambiar Cuenta</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // State 2: Not logged in at all (Public or Private window)
  return (
    <div className="max-w-xl mx-auto px-4 py-12">
      <div className="bg-white rounded-2xl shadow-xl border border-stone-200 overflow-hidden">
        {/* Card Header */}
        <div className="bg-stone-900 text-stone-100 p-8 text-center relative">
          <div className="flex justify-center mb-4">
            <ForeverYouLogo variant="stacked" theme="light" size="lg" />
          </div>
          <h2 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-amber-50">
            Acceso Administrativo
          </h2>
          <p className="text-xs sm:text-sm text-stone-400 mt-2 max-w-md mx-auto">
            Plataforma protegida para la gestión de entrevistas de vida, banco de preguntas y generación de manuscritos biográficos.
          </p>
        </div>

        {/* Card Content */}
        <div className="p-6 sm:p-8 space-y-6">
          {errorMessage && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm p-4 rounded-xl flex items-start space-x-2">
              <ShieldAlert className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="space-y-4 text-center">
            <p className="text-sm text-stone-600">
              Para ingresar al panel de administración, autentícate con tu cuenta de Google autorizada:
            </p>

            {/* Google Sign-in Button */}
            <button
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full py-3.5 px-6 bg-white hover:bg-stone-50 text-stone-800 font-semibold text-sm rounded-xl border border-stone-300 shadow-md hover:shadow-lg transition-all duration-200 flex items-center justify-center space-x-3 cursor-pointer disabled:opacity-50"
            >
              {/* Google G Logo SVG */}
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>{loading ? 'Conectando con Google...' : 'Iniciar Sesión con Google'}</span>
            </button>
          </div>

          {/* Security & Access Features */}
          <div className="bg-stone-50 border border-stone-200/80 rounded-xl p-4 space-y-2.5 text-xs text-stone-600">
            <div className="flex items-center space-x-2 text-stone-700 font-semibold">
              <Shield className="w-4 h-4 text-emerald-600" />
              <span>Control de Acceso Basado en Roles (RBAC)</span>
            </div>
            <ul className="space-y-1.5 pl-6 list-disc text-stone-600">
              <li>Acceso restringido únicamente a la cuenta administrativa autorizada.</li>
              <li>Validación estricta en el servidor para todas las operaciones privilegiadas.</li>
              <li>Protección y hash SHA-256 de enlaces para salvaguardar la intimidad familiar.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
