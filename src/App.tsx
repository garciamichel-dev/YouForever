/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar.tsx';
import { AdminDashboard } from './components/AdminDashboard.tsx';
import { ParticipantPortal } from './components/ParticipantPortal.tsx';
import { AdminLoginView } from './components/AdminLoginView.tsx';
import { FAQModal } from './components/FAQModal.tsx';
import { IntegralPrivacyNoticeModal } from './components/IntegralPrivacyNoticeModal.tsx';
import { auth, googleProvider } from './firebase/config.ts';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { Clock, HelpCircle, Shield } from 'lucide-react';

export default function App() {
  const [currentView, setCurrentView] = useState<'admin' | 'participant'>('participant');
  const [adminUser, setAdminUser] = useState<string | null>(null);
  const [isAuthorizedAdmin, setIsAuthorizedAdmin] = useState<boolean>(false);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);
  const [participantToken, setParticipantToken] = useState<string | null>(null);
  const [isFaqOpen, setIsFaqOpen] = useState(false);
  const [isPrivacyNoticeOpen, setIsPrivacyNoticeOpen] = useState(false);

  // Check URL parameters, pathname, and hash on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    let token = urlParams.get('token') || urlParams.get('code');
    const view = urlParams.get('view');
    const isAdminUrl = window.location.pathname.startsWith('/admin') || view === 'admin';

    if (!token && window.location.hash) {
      const hashClean = window.location.hash.replace(/^#\/?/, '');
      const hashParams = new URLSearchParams(hashClean);
      token = hashParams.get('token') || hashParams.get('code');
    }

    if (token) {
      setParticipantToken(token);
      setCurrentView('participant');
    } else if (isAdminUrl) {
      setCurrentView('admin');
    } else {
      setCurrentView('participant');
    }
  }, []);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        setIsAuthChecking(false);
        if (user && user.email) {
          try {
            await user.getIdToken();
          } catch (tokenErr: unknown) {
            const msg = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
            if (msg.includes('token-service-api') || msg.includes('securetoken')) {
              console.warn('Stale auth session token refresh failed, signing out:', msg);
              await signOut(auth).catch(() => {});
              setAdminUser(null);
              setIsAuthorizedAdmin(false);
              return;
            }
          }

          const email = user.email.toLowerCase().trim();
          setAdminUser(email);
          const authorized = email === 'garcia.michel@gmail.com';
          setIsAuthorizedAdmin(authorized);

          const urlParams = new URLSearchParams(window.location.search);
          const token = urlParams.get('token') || urlParams.get('code');
          const isAdminUrl = window.location.pathname.startsWith('/admin') || urlParams.get('view') === 'admin';

          if (authorized && (isAdminUrl || !token)) {
            setCurrentView('admin');
          }
        } else {
          setAdminUser(null);
          setIsAuthorizedAdmin(false);
        }
      },
      (error) => {
        console.warn('Auth state observation error:', error);
        setIsAuthChecking(false);
        setAdminUser(null);
        setIsAuthorizedAdmin(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      if (result.user?.email) {
        const email = result.user.email.toLowerCase().trim();
        setAdminUser(email);
        const authorized = email === 'garcia.michel@gmail.com';
        setIsAuthorizedAdmin(authorized);
        if (authorized) {
          setCurrentView('admin');
        }
      }
    } catch (err: unknown) {
      console.warn('Login error:', err);
      throw err;
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setAdminUser(null);
      setIsAuthorizedAdmin(false);
      setCurrentView('participant');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const handleEnterParticipantWithToken = (token: string) => {
    setParticipantToken(token);
    setCurrentView('participant');
  };

  return (
    <div className="min-h-screen bg-stone-100/70 text-stone-900 font-sans flex flex-col selection:bg-amber-200">
      <Navbar
        currentView={currentView}
        onSelectView={(v) => setCurrentView(v)}
        adminEmail={adminUser}
        isAuthorizedAdmin={isAuthorizedAdmin}
        onLogout={handleLogout}
        onOpenFaq={() => setIsFaqOpen(true)}
        onOpenPrivacyNotice={() => setIsPrivacyNoticeOpen(true)}
      />

      <main className="flex-1 py-6">
        {currentView === 'admin' ? (
          isAuthChecking ? (
            <div className="flex flex-col items-center justify-center py-20 text-stone-500 space-y-3">
              <Clock className="w-8 h-8 animate-spin text-amber-700" />
              <p className="text-sm font-medium">Verificando sesión administrativa...</p>
            </div>
          ) : isAuthorizedAdmin && adminUser ? (
            <AdminDashboard
              adminEmail={adminUser}
              onEnterParticipantPortal={handleEnterParticipantWithToken}
            />
          ) : (
            <AdminLoginView
              adminEmail={adminUser}
              isAuthorizedAdmin={isAuthorizedAdmin}
              onLogin={handleLogin}
              onLogout={handleLogout}
            />
          )
        ) : (
          <ParticipantPortal
            initialToken={participantToken}
            onOpenFaq={() => setIsFaqOpen(true)}
          />
        )}
      </main>

      <footer className="bg-stone-900 text-stone-400 py-6 text-center text-xs border-t border-stone-800">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="font-serif text-stone-300">
            ForeverYou • Plataforma de Entrevistas de Vida &amp; Patrimonio Testimonial
          </p>
          <div className="flex items-center space-x-4 text-[11px] text-stone-400">
            <button
              onClick={() => setIsPrivacyNoticeOpen(true)}
              className="inline-flex items-center space-x-1 hover:text-amber-300 transition cursor-pointer"
            >
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              <span>Aviso de Privacidad Integral</span>
            </button>
            <span>•</span>
            <button
              onClick={() => setIsFaqOpen(true)}
              className="inline-flex items-center space-x-1 hover:text-amber-300 transition cursor-pointer"
            >
              <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
              <span>Preguntas Frecuentes</span>
            </button>
            <span>•</span>
            <span className="text-stone-500">
              Fidelidad testimonial estricta • Criptografía SHA-256
            </span>
          </div>
        </div>
      </footer>

      {/* Global FAQ & Privacy Modals */}
      <FAQModal isOpen={isFaqOpen} onClose={() => setIsFaqOpen(false)} />
      <IntegralPrivacyNoticeModal
        isOpen={isPrivacyNoticeOpen}
        onClose={() => setIsPrivacyNoticeOpen(false)}
      />
    </div>
  );
}
