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
import { ConocemeView } from './components/ConocemeView.tsx';
import { DemoFreeTrialView } from './components/DemoFreeTrialView.tsx';
import { MiEsenciaFamilyPortal } from './modules/mi-esencia/MiEsenciaFamilyPortal.tsx';
import { auth, googleProvider } from './firebase/config.ts';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { Clock, HelpCircle } from 'lucide-react';
import { getActiveParticipantSession } from './utils/participantSessionStorage.ts';
import { ForeverYouLogo } from './components/ForeverYouLogo';
import { ThemeProvider, ThemeToggleButton } from './context/ThemeContext';

function isMiEsenciaLocation(): boolean {
  const urlParams = new URLSearchParams(window.location.search);
  const view = urlParams.get('view');
  return (
    window.location.pathname.startsWith('/miesencia') ||
    window.location.pathname.startsWith('/mi-esencia') ||
    urlParams.get('miesencia') === '1' ||
    urlParams.get('mi-esencia') === '1' ||
    view === 'miesencia' ||
    view === 'mi-esencia'
  );
}

export default function App() {
  const [currentView, setCurrentView] = useState<'admin' | 'participant' | 'conoceme' | 'demo' | 'mi_esencia'>(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const view = urlParams.get('view');
    if (isMiEsenciaLocation()) {
      return 'mi_esencia';
    }
    if (window.location.pathname.startsWith('/demo') || view === 'demo') {
      return 'demo';
    }
    if (window.location.pathname.startsWith('/conoceme') || view === 'conoceme') {
      return 'conoceme';
    }
    if (window.location.pathname.startsWith('/admin') || view === 'admin') {
      return 'admin';
    }
    return 'participant';
  });
  const [adminUser, setAdminUser] = useState<string | null>(null);
  const [isAuthorizedAdmin, setIsAuthorizedAdmin] = useState<boolean>(false);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);
  const [participantToken, setParticipantToken] = useState<string | null>(null);
  const [miEsenciaCode, setMiEsenciaCode] = useState<string | null>(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (isMiEsenciaLocation()) {
      return urlParams.get('code') || urlParams.get('token');
    }
    return null;
  });
  const [isFaqOpen, setIsFaqOpen] = useState(false);
  const [isPrivacyNoticeOpen, setIsPrivacyNoticeOpen] = useState(false);

  // Check URL parameters, pathname, and hash on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    let token = urlParams.get('token') || urlParams.get('code');
    const view = urlParams.get('view');
    const isMiEsenciaUrl = isMiEsenciaLocation();
    const isDemoUrl = window.location.pathname.startsWith('/demo') || view === 'demo';
    const isConocemeUrl = window.location.pathname.startsWith('/conoceme') || view === 'conoceme';
    const isAdminUrl = window.location.pathname.startsWith('/admin') || view === 'admin';

    if (!token && window.location.hash) {
      const hashClean = window.location.hash.replace(/^#\/?/, '');
      const hashParams = new URLSearchParams(hashClean);
      token = hashParams.get('token') || hashParams.get('code');
    }

    if (isMiEsenciaUrl) {
      if (token) setMiEsenciaCode(token);
      setCurrentView('mi_esencia');
    } else if (isDemoUrl) {
      setCurrentView('demo');
    } else if (isConocemeUrl) {
      setCurrentView('conoceme');
    } else if (token) {
      setParticipantToken(token);
      setCurrentView('participant');
    } else if (isAdminUrl) {
      setCurrentView('admin');
    } else {
      setCurrentView('participant');
    }
  }, []);

  // Ensure SEO metadata (title, description, keywords, OpenGraph, Twitter) is applied across all pages
  useEffect(() => {
    const title = 'YouForever: Tu historia. Tu esencia. Para siempre.';
    const description =
      'YouForever transforma recuerdos, experiencias y emociones en un legado eterno, mediante libros autobiográficos personalizados y conversaciones impulsadas por inteligencia artificial que recrean la esencia de tus seres queridos.';
    const keywords =
      'Legado eterno, recuerdos para siempre, historias que trascienden, memoria familiar, conexión entre generaciones, amor que perdura, autobiografías personalizadas, inteligencia artificial emocional, preservar historias de vida, herencia emocional.';

    document.title = title;

    const upsertMeta = (attr: 'name' | 'property', key: string, content: string) => {
      let el = document.head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };

    upsertMeta('name', 'description', description);
    upsertMeta('name', 'keywords', keywords);
    upsertMeta('property', 'og:title', title);
    upsertMeta('property', 'og:description', description);
    upsertMeta('name', 'twitter:title', title);
    upsertMeta('name', 'twitter:description', description);
  }, [currentView]);

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
          const authorized =
            email === 'garcia.michel@gmail.com' || email === 'youforever.team@gmail.com';
          setIsAuthorizedAdmin(authorized);

          const urlParams = new URLSearchParams(window.location.search);
          const token = urlParams.get('token') || urlParams.get('code');
          const isMiEsenciaUrl = isMiEsenciaLocation();
          const isDemoUrl =
            window.location.pathname.startsWith('/demo') || urlParams.get('view') === 'demo';
          const isConocemeUrl =
            window.location.pathname.startsWith('/conoceme') || urlParams.get('view') === 'conoceme';
          const isAdminUrl =
            window.location.pathname.startsWith('/admin') || urlParams.get('view') === 'admin';
          const hasStoredParticipantSession = Boolean(getActiveParticipantSession());

          if (
            !isMiEsenciaUrl &&
            !isDemoUrl &&
            !isConocemeUrl &&
            authorized &&
            (isAdminUrl || (!token && !hasStoredParticipantSession))
          ) {
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
        const authorized =
          email === 'garcia.michel@gmail.com' || email === 'youforever.team@gmail.com';
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

  const handleSelectView = (view: 'admin' | 'participant' | 'conoceme' | 'demo' | 'mi_esencia') => {
    if (view === 'mi_esencia') {
      window.history.pushState({}, '', '/miesencia');
    } else if (view === 'demo') {
      window.history.pushState({}, '', '/demo');
    } else if (view === 'conoceme') {
      window.history.pushState({}, '', '/conoceme');
    } else if (view === 'admin') {
      window.history.pushState({}, '', '/admin');
    } else {
      window.history.pushState({}, '', '/');
    }
    setCurrentView(view);
  };

  const isParticipantInterviewActive = currentView === 'participant' && Boolean(participantToken);
  const isNavbarHidden = isParticipantInterviewActive || currentView === 'conoceme' || currentView === 'demo';

  return (
    <ThemeProvider>
      {currentView === 'mi_esencia' ? (
        <MiEsenciaFamilyPortal initialCode={miEsenciaCode} />
      ) : (
        <div className="min-h-screen bg-stone-100/70 dark:bg-stone-950 text-stone-900 dark:text-stone-100 font-sans flex flex-col selection:bg-amber-200 transition-colors">
          {!isNavbarHidden ? (
            <Navbar
              currentView={currentView}
              onSelectView={handleSelectView}
              adminEmail={adminUser}
              isAuthorizedAdmin={isAuthorizedAdmin}
              onLogout={handleLogout}
              onOpenFaq={() => setIsFaqOpen(true)}
              onOpenPrivacyNotice={() => setIsPrivacyNoticeOpen(true)}
            />
          ) : (
            <div className="fixed bottom-4 right-4 z-50">
              <ThemeToggleButton className="shadow-lg" />
            </div>
          )}

          <main className={isNavbarHidden ? 'flex-1' : 'flex-1 py-6'}>
            {currentView === 'demo' ? (
              <DemoFreeTrialView
                onNavigateToConoceme={() => handleSelectView('conoceme')}
              />
            ) : currentView === 'conoceme' ? (
              <ConocemeView
                onNavigateToPortal={() => handleSelectView('participant')}
                onNavigateToDemo={() => handleSelectView('demo')}
                onBackToAdmin={isAuthorizedAdmin ? () => handleSelectView('admin') : undefined}
                onOpenFaq={() => setIsFaqOpen(true)}
                onOpenPrivacyNotice={() => setIsPrivacyNoticeOpen(true)}
              />
            ) : currentView === 'admin' ? (
              isAuthChecking ? (
                <div className="flex flex-col items-center justify-center py-20 text-stone-500 space-y-3">
                  <Clock className="w-8 h-8 animate-spin text-amber-700" />
                  <p className="text-sm font-medium">Verificando sesión administrativa...</p>
                </div>
              ) : isAuthorizedAdmin && adminUser ? (
                <AdminDashboard
                  adminEmail={adminUser}
                  onEnterParticipantPortal={handleEnterParticipantWithToken}
                  onOpenConoceme={() => handleSelectView('conoceme')}
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
                onClearToken={() => setParticipantToken(null)}
              />
            )}
          </main>

          {!isParticipantInterviewActive && (
            <footer className="bg-stone-900 text-stone-400 py-6 text-center text-xs border-t border-stone-800">
              <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <ForeverYouLogo variant="app_icon" size="xs" />
                  <p className="font-serif text-stone-300">
                    YouForever • Plataforma de Entrevistas de Vida &amp; Patrimonio Testimonial
                  </p>
                </div>
                <div className="flex items-center space-x-4 text-[11px] text-stone-400">
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
          )}

          {/* Global FAQ & Privacy Modals */}
          <FAQModal isOpen={isFaqOpen} onClose={() => setIsFaqOpen(false)} />
          <IntegralPrivacyNoticeModal
            isOpen={isPrivacyNoticeOpen}
            onClose={() => setIsPrivacyNoticeOpen(false)}
          />
        </div>
      )}
    </ThemeProvider>
  );
}

