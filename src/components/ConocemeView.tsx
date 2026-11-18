import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  Camera,
  Sparkles,
  Check,
  ArrowRight,
  Volume2,
  AlertTriangle,
  MessageCircle,
  Mail,
  ChevronRight,
  ChevronLeft,
  Heart,
  FileText,
  FolderArchive,
  Send,
  RotateCcw,
  SlidersHorizontal,
  ShieldCheck,
  KeyRound,
  Users,
  Lock,
  MessageSquare,
} from 'lucide-react';
import {
  DEMO_STAGE_PRESETS,
  SAMPLE_BOOK_CHAPTERS,
  DEMO_PHOTO_MEMORIES,
  DemoStageId,
  DemoInterviewMode,
  SimuladorChatMessage,
  generateDemoFollowUpQuestion,
  createInitialChatThread,
  computeLegacyLayoutDisposition,
  validateInquiryForm,
  buildWhatsAppInquiryUrl,
  buildMailtoInquiryUrl,
  InquiryFormInput,
  OFFICIAL_CONTACT_EMAIL,
  OFFICIAL_WHATSAPP_DISPLAY,
} from '../utils/conocemeLogic.ts';
import { composeBookPages } from '../logic/demoStoryRules.ts';
import {
  CONOCEME_SAMPLE_EDITORIAL_CONFIG,
  CONOCEME_SAMPLE_MANUSCRIPT,
  CONOCEME_SAMPLE_PHOTOS,
} from '../logic/conocemeSampleBook.ts';
import { ScaledBookPageView, useMeasuredBook } from './book/ScaledBookPageView.tsx';
import { ForeverYouLogo } from './ForeverYouLogo';

interface ConocemeViewProps {
  onNavigateToPortal?: () => void;
  onNavigateToDemo?: () => void;
  /** V5.8.0 — registro gratuito (/free). */
  onNavigateToFree?: () => void;
  onBackToAdmin?: () => void;
  onOpenPrivacyNotice?: () => void;
  onOpenFaq?: () => void;
}

export const ConocemeView: React.FC<ConocemeViewProps> = ({
  onNavigateToPortal,
  onNavigateToDemo,
  onNavigateToFree,
  onBackToAdmin,
}) => {
  // 1. SIMULADOR DE ENTREVISTA (AI Chat Interface State — 100% In-Memory, Zero Firestore Writes)
  const [demoMode, setDemoMode] = useState<DemoInterviewMode>('individual');
  const [selectedStageId, setSelectedStageId] = useState<DemoStageId>('infancia');
  const currentStagePreset =
    DEMO_STAGE_PRESETS.find((s) => s.id === selectedStageId) || DEMO_STAGE_PRESETS[0];

  const [chatMessages, setChatMessages] = useState<SimuladorChatMessage[]>(() => {
    const initial = createInitialChatThread('infancia', 'individual');
    const sampleText = DEMO_STAGE_PRESETS[0].sampleAnswerIndividual;
    const followUp = generateDemoFollowUpQuestion('infancia', 'individual', sampleText);
    return [
      ...initial,
      {
        id: 'user-init-sample',
        sender: 'user',
        roleLabel: 'Tu respuesta de prueba',
        text: sampleText,
      },
      {
        id: 'ai-init-followup',
        sender: 'ai',
        roleLabel: 'Entrevista guiada · Pregunta para profundizar',
        text: followUp.followUpQuestion,
        isFollowUp: true,
        detectedMotifs: followUp.detectedMotifs,
      },
    ];
  });

  const [chatInputText, setChatInputText] = useState<string>('');
  const [isTypingAi, setIsTypingAi] = useState<boolean>(false);

  // Voice & Collapsible UI Preview State
  const [recorderScenario, setRecorderScenario] = useState<'clear' | 'noisy' | 'silence30s'>('clear');
  const [showPhotoUploaderDemo, setShowPhotoUploaderDemo] = useState<boolean>(false);
  const [showSavedAudioDemo, setShowSavedAudioDemo] = useState<boolean>(false);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string>(DEMO_PHOTO_MEMORIES[0].id);

  // 2. VISTA PREVIA INTERACTIVA DEL LEGADO (Real Composed Book Pages + Disposition Slider State)
  // V5.8.0: complete third-person biography, composed and laid out exactly like the books of the
  // participant portal (measured pages, same proportions as the PDF).
  const composedSampleSource = useMemo(() => {
    const doc = composeBookPages({
      manuscript: CONOCEME_SAMPLE_MANUSCRIPT,
      editorialConfig: CONOCEME_SAMPLE_EDITORIAL_CONFIG,
      chapterPhotos: CONOCEME_SAMPLE_PHOTOS,
      customClosingPageText: 'Esta historia continuará...',
      maxContentPages: 500,
    });
    return {
      ...doc,
      useOfficialForeverYouLogo: true,
    };
  }, []);
  const composedSampleBook = useMeasuredBook(composedSampleSource);

  const [pageIndex, setPageIndex] = useState<number>(0);
  const [layoutSliderValue, setLayoutSliderValue] = useState<number>(50);
  const [isPlayingVoiceSample, setIsPlayingVoiceSample] = useState<boolean>(false);

  // 3. CONTACT & INQUIRY FORM STATE
  const [formInput, setFormInput] = useState<InquiryFormInput>({
    fullName: '',
    contactInfo: '',
    recipientRelation: '',
    modality: 'individual',
    message: '',
  });
  const [formErrors, setFormErrors] = useState<{
    fullName?: string;
    contactInfo?: string;
    recipientRelation?: string;
  }>({});
  const [formSubmitted, setFormSubmitted] = useState<boolean>(false);

  // Handlers for Simulador de Entrevista Chat
  const resetChatForStageAndMode = (
    stageId: DemoStageId,
    mode: DemoInterviewMode,
    includeSampleExchange = false
  ) => {
    const preset = DEMO_STAGE_PRESETS.find((s) => s.id === stageId) || DEMO_STAGE_PRESETS[0];
    const baseThread = createInitialChatThread(stageId, mode);
    if (!includeSampleExchange) {
      setChatMessages(baseThread);
      setChatInputText(
        mode === 'compartida' ? preset.sampleAnswerShared : preset.sampleAnswerIndividual
      );
      return;
    }
    const sample =
      mode === 'compartida' ? preset.sampleAnswerShared : preset.sampleAnswerIndividual;
    const followUp = generateDemoFollowUpQuestion(stageId, mode, sample);
    setChatMessages([
      ...baseThread,
      {
        id: `user-sample-${stageId}-${mode}`,
        sender: 'user',
        roleLabel: 'Tu respuesta de prueba',
        text: sample,
      },
      {
        id: `ai-followup-${stageId}-${mode}`,
        sender: 'ai',
        roleLabel: 'Entrevista guiada · Pregunta para profundizar',
        text: followUp.followUpQuestion,
        isFollowUp: true,
        detectedMotifs: followUp.detectedMotifs,
      },
    ]);
    setChatInputText('');
  };

  const handleSelectStage = (stageId: DemoStageId) => {
    setSelectedStageId(stageId);
    resetChatForStageAndMode(stageId, demoMode, false);
  };

  const handleSelectMode = (mode: DemoInterviewMode) => {
    setDemoMode(mode);
    resetChatForStageAndMode(selectedStageId, mode, false);
  };

  const handleSendChatMessage = (customText?: string) => {
    const textToSend = (customText !== undefined ? customText : chatInputText).trim();
    if (!textToSend || isTypingAi) return;

    const userMsg: SimuladorChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      roleLabel: 'Tu respuesta en el chat',
      text: textToSend,
    };

    const baseMessages = createInitialChatThread(selectedStageId, demoMode);
    setChatMessages([...baseMessages, userMsg]);
    setChatInputText('');
    setIsTypingAi(true);

    setTimeout(() => {
      const result = generateDemoFollowUpQuestion(selectedStageId, demoMode, textToSend);
      const aiReply: SimuladorChatMessage = {
        id: `ai-followup-${Date.now()}`,
        sender: 'ai',
        roleLabel: 'Entrevista guiada · Pregunta para profundizar',
        text: result.followUpQuestion,
        isFollowUp: true,
        detectedMotifs: result.detectedMotifs,
      };
      setChatMessages([...baseMessages, userMsg, aiReply]);
      setIsTypingAi(false);
    }, 120);
  };

  // Active Book Page & Layout Disposition Calculation
  const totalComposedPages = composedSampleBook.pages.length;
  const safePageIndex = Math.max(0, Math.min(pageIndex, totalComposedPages - 1));
  const activeComposedPage = composedSampleBook.pages[safePageIndex] || composedSampleBook.pages[0];
  const activeChapterNumber = activeComposedPage.sections?.[0]?.partNumber ?? 1;
  const activeBookPage =
    SAMPLE_BOOK_CHAPTERS[(activeChapterNumber - 1) % SAMPLE_BOOK_CHAPTERS.length] || SAMPLE_BOOK_CHAPTERS[0];
  const layoutDisposition = computeLegacyLayoutDisposition(layoutSliderValue);
  const selectedPhoto =
    DEMO_PHOTO_MEMORIES.find((p) => p.id === selectedPhotoId) || DEMO_PHOTO_MEMORIES[0];

  const getComposedPageShortLabel = (idx: number, kind: string) => {
    if (kind === 'cover') return `Pág. ${idx + 1} · Portada`;
    if (kind === 'title_dedication') return `Pág. ${idx + 1} · Portadilla`;
    if (kind === 'closing_mandatory') return `Pág. ${idx + 1} · Cierre`;
    return `Pág. ${idx + 1} · Capítulo`;
  };

  const handleInquirySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateInquiryForm(formInput);
    if (!validation.valid) {
      setFormErrors(validation.errors);
      setFormSubmitted(false);
      return;
    }
    setFormErrors({});
    setFormSubmitted(true);
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-stone-900 font-sans selection:bg-amber-200">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 bg-[#FAF8F5]/95 backdrop-blur-sm border-b border-stone-200/80">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-6 px-6 py-4">
          {/* Zone 1: Official YouForever Horizontal Lockup */}
          <a
            href="/conoceme"
            className="inline-flex items-center whitespace-nowrap shrink-0"
          >
            <ForeverYouLogo variant="horizontal" theme="navy" size="md" />
          </a>

          {/* Zone 2: Concise navigation links */}
          <nav
            aria-label="Navegación comercial"
            className="hidden lg:flex items-center gap-6 text-sm font-medium text-stone-600"
          >
            <button
              type="button"
              onClick={() => scrollToSection('simulador-entrevista')}
              className="hover:text-stone-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Simulador de Entrevista
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('vista-previa-legado')}
              className="hover:text-stone-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Vista Previa del Libro
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('mi-esencia-ecosistema')}
              className="hover:text-stone-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Mi Esencia
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('como-funciona')}
              className="hover:text-stone-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Cómo Funciona
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('contacto-regalo')}
              className="hover:text-stone-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Modalidades y Contacto
            </button>
          </nav>

          {/* Zone 3: Primary action (+ Admin back button when admin is logged in) */}
          <div className="flex items-center gap-2.5 shrink-0">
            {onBackToAdmin && (
              <button
                type="button"
                onClick={onBackToAdmin}
                className="px-3.5 py-2 text-xs font-semibold text-stone-700 bg-stone-200/80 hover:bg-stone-300/80 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Panel Administrador
              </button>
            )}
            <a
              href="/free"
              data-testid="conoceme-free-trial-nav"
              onClick={(e) => {
                // V5.8.1: «Prueba gratuita» lleva al registro gratuito (/free).
                if (onNavigateToFree) {
                  e.preventDefault();
                  onNavigateToFree();
                }
              }}
              className="px-4 py-2 text-xs font-semibold text-amber-900 bg-amber-100/80 hover:bg-amber-200/80 border border-amber-300/70 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-700" />
              <span>Prueba gratuita</span>
            </a>
            <button
              type="button"
              onClick={() => scrollToSection('contacto-regalo')}
              className="px-5 py-2.5 text-xs font-semibold text-white bg-amber-800 rounded-lg hover:bg-amber-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
            >
              Regalar YouForever
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* 1. CONCISE HERO SECTION */}
        <section className="max-w-7xl mx-auto px-6 pt-10 pb-14 lg:pt-14 lg:pb-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            {/* Left Column: Clear Value Proposition */}
            <div className="lg:col-span-7 flex flex-col justify-between space-y-6">
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-amber-900">
                  <span>Biografías Familiares Guiadas</span>
                  <span aria-hidden="true">·</span>
                  <span>Libro Editorial Imprimible</span>
                  <span aria-hidden="true">·</span>
                  <span>Mi Esencia (Conversación Familiar)</span>
                </div>

                <h1
                  className="font-serif font-bold text-stone-900 tracking-tight leading-[1.12]"
                  style={{ fontSize: 'clamp(2.25rem, 4vw, 3.5rem)', textWrap: 'balance' }}
                >
                  Transforma la voz y los recuerdos de tu familia en un libro y un legado vivo para siempre.
                </h1>

                <p className="text-base text-stone-700 leading-relaxed max-w-xl">
                  <strong>YouForever</strong> guía una conversación cálida por voz o teclado, maqueta cada anécdota en un{' '}
                  <span className="text-stone-900 font-medium">libro biográfico ilustrado</span> con sus grabaciones originales y permite a tu familia seguir conversando con sus recuerdos reales en{' '}
                  <span className="text-stone-900 font-medium">Mi Esencia</span>.
                </p>
              </div>

              <div className="space-y-4 pt-1">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => scrollToSection('contacto-regalo')}
                    className="px-6 py-3.5 bg-amber-800 hover:bg-amber-900 text-white font-semibold text-sm rounded-lg transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
                  >
                    <span>Solicitar YouForever</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => scrollToSection('vista-previa-legado')}
                    className="px-5 py-3.5 bg-white hover:bg-stone-100 text-stone-800 font-medium text-sm rounded-lg border border-stone-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Ver Libro Real de Muestra
                  </button>
                </div>

                {/* Prueba gratuita Card */}
                <div className="rounded-xl bg-[#F3EFEA] border border-amber-800/20 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                      <Sparkles className="w-3.5 h-3.5 text-amber-700" />
                      <span>Prueba gratuita interactiva</span>
                    </div>
                    <p className="text-xs sm:text-sm text-stone-700">
                      Responde 5 preguntas guiadas y diseña al instante la vista previa de tu propio libro en PDF.
                    </p>
                  </div>
                  <a
                    href="/free"
                    data-testid="conoceme-create-free-story"
                    onClick={(e) => {
                      // V5.8.0: «Crear mi historia gratis» lleva al registro gratuito (/free).
                      if (onNavigateToFree) {
                        e.preventDefault();
                        onNavigateToFree();
                      }
                    }}
                    className="px-4 py-2.5 bg-stone-900 hover:bg-stone-800 text-amber-50 text-xs font-semibold rounded-lg transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <span>Crear mi historia gratis</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </a>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-600">
                  <span>Códigos seguros YF-XXXXX</span>
                  <span aria-hidden="true">·</span>
                  <span>100% fiel a sus palabras</span>
                  <span aria-hidden="true">·</span>
                  <span>Carpeta descargable de recuerdos + Mi Esencia</span>
                </div>
              </div>
            </div>

            {/* Right Column: Ecosystem Visual Showcase */}
            <div className="lg:col-span-5 flex flex-col">
              <div className="h-full rounded-2xl bg-[#F3EFEA] border border-stone-200/90 p-6 flex flex-col justify-between space-y-4">
                <div className="flex items-center justify-between text-xs text-stone-600 border-b border-stone-200 pb-3">
                  <span className="font-serif italic text-stone-800">Ecosistema Completo YouForever</span>
                  <span>Entrevista + Libro + Mi Esencia</span>
                </div>

                <div className="bg-[#FAF8F5] border border-stone-200/90 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between text-[11px] text-stone-500">
                    <span>CAPÍTULO I · INFANCIA</span>
                    <span className="tabular-nums">Código: YF-8K4M2</span>
                  </div>

                  <h2 className="font-serif text-lg font-bold text-stone-900 leading-snug">
                    «El patio de los geranios y el pan recién horneado de la abuela Elena»
                  </h2>

                  <div className="rounded-lg bg-gradient-to-br from-stone-800 via-stone-900 to-amber-950 p-4 text-amber-50/95 space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-amber-200/80">
                      <span>Guadalajara, 1954</span>
                      <span className="tabular-nums">Audio Original + Mi Esencia</span>
                    </div>
                    <p className="font-serif italic text-xs sm:text-sm leading-relaxed text-amber-50">
                      “Cada tarde a las seis salían las charolas del horno de leña. Sentarnos a escuchar a mi abuela fue nuestra primera escuela.”
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-stone-600">
                  <span>Individual o en Pareja</span>
                  <span>WhatsApp: {OFFICIAL_WHATSAPP_DISPLAY}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Concise 4-Column Highlights */}
          <div className="mt-10 pt-8 border-t border-stone-200/80 grid grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <div className="text-xs text-amber-900 font-medium">01 · Recorrido Vital</div>
              <div className="font-serif text-lg font-bold text-stone-900 tabular-nums">5 Etapas de Vida</div>
              <p className="text-xs text-stone-600 mt-0.5">
                Infancia, Juventud, Adultez, Madurez y Legado con preguntas empáticas.
              </p>
            </div>
            <div>
              <div className="text-xs text-amber-900 font-medium">02 · Acceso Seguro</div>
              <div className="font-serif text-lg font-bold text-stone-900">Código YF-XXXXX</div>
              <p className="text-xs text-stone-600 mt-0.5">
                Código sencillo sin contraseñas difíciles, pensado para usarse con seguridad y facilidad.
              </p>
            </div>
            <div>
              <div className="text-xs text-amber-900 font-medium">03 · Estudio Editorial</div>
              <div className="font-serif text-lg font-bold text-stone-900 tabular-nums">Libro de Autor</div>
              <p className="text-xs text-stone-600 mt-0.5">
                Diseño editorial listo para imprimir o conservar, fotos comentadas y respaldo completo de tus audios y fotos.
              </p>
            </div>
            <div>
              <div className="text-xs text-amber-900 font-medium">04 · Legado Conversacional</div>
              <div className="font-serif text-lg font-bold text-stone-900">Mi Esencia</div>
              <p className="text-xs text-stone-600 mt-0.5">
                Tus hijos y nietos conversan con una recreación basada fielmente en tus recuerdos originales.
              </p>
            </div>
          </div>
        </section>

        {/* 2. SIMULADOR DE ENTREVISTA (Interactive AI Chat Interface + Accessible Voice/Photo Preview) */}
        <section
          id="simulador-entrevista"
          className="scroll-mt-20 bg-[#F3EFEA] border-y border-stone-200/90 py-14 lg:py-16"
        >
          <div className="max-w-7xl mx-auto px-6 space-y-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div className="space-y-1.5 max-w-2xl">
                <div className="text-xs font-medium text-amber-900">
                  Demostración Interactiva · Sin Guardar Datos Personales
                </div>
                <h2 className="font-serif text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
                  Simulador de Entrevista
                </h2>
                <p className="text-sm text-stone-600">
                  Prueba nuestra entrevista guiada: responde la pregunta inicial y observa cómo surge al instante una nueva pregunta basada en tus propias palabras.
                </p>
              </div>

              {/* Mode Switcher */}
              <div className="flex items-center gap-1 p-1 bg-stone-200/80 rounded-xl self-start shrink-0">
                <button
                  type="button"
                  onClick={() => handleSelectMode('individual')}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                    demoMode === 'individual'
                      ? 'bg-white text-stone-900 shadow-2xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  Individual
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectMode('compartida')}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                    demoMode === 'compartida'
                      ? 'bg-white text-stone-900 shadow-2xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  Pareja
                </button>
              </div>
            </div>

            {/* Stage Selector Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {DEMO_STAGE_PRESETS.map((stage) => (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => handleSelectStage(stage.id)}
                  className={`p-3 rounded-xl text-left border transition-colors cursor-pointer ${
                    selectedStageId === stage.id
                      ? 'bg-amber-900/10 border-amber-800 text-stone-900'
                      : 'bg-[#FAF8F5] border-stone-200 text-stone-600 hover:border-stone-300'
                  }`}
                >
                  <div className="text-xs font-semibold text-stone-900 truncate">{stage.label}</div>
                  <div className="text-[11px] text-stone-500 truncate">{stage.periodLabel}</div>
                </button>
              ))}
            </div>

            {/* Main Grid: AI Chat Interface (Left 7 cols) + Senior-Friendly Recorder & Photo Controls (Right 5 cols) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Left: AI Chat Interface */}
              <div className="lg:col-span-7 bg-[#FAF8F5] border border-stone-200 rounded-2xl p-5 sm:p-6 flex flex-col justify-between space-y-5 shadow-2xs">
                <div className="flex items-center justify-between border-b border-stone-200 pb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-800" />
                    <span className="text-xs font-semibold text-stone-900">
                      Entrevista guiada · {currentStagePreset.label}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => resetChatForStageAndMode(selectedStageId, demoMode, false)}
                    className="text-xs text-stone-500 hover:text-stone-900 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Nueva respuesta</span>
                  </button>
                </div>

                {/* Chat Conversation Thread */}
                <div
                  role="log"
                  aria-label="Conversación del Simulador de Entrevista"
                  data-testid="interview-chat-thread"
                  className="space-y-3.5 max-h-[340px] overflow-y-auto pr-1"
                >
                  {chatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${
                        msg.sender === 'user' ? 'items-end' : 'items-start'
                      }`}
                    >
                      <span className="text-[11px] text-stone-500 mb-1 px-1">
                        {msg.roleLabel}
                      </span>
                      <div
                        data-testid={msg.isFollowUp ? 'ai-followup-output' : undefined}
                        className={`max-w-[90%] rounded-2xl px-4 py-3 text-xs sm:text-sm leading-relaxed ${
                          msg.sender === 'user'
                            ? 'bg-amber-800 text-white rounded-br-xs'
                            : msg.isFollowUp
                            ? 'bg-amber-50/90 border border-amber-300 text-stone-900 font-serif italic rounded-bl-xs'
                            : 'bg-white border border-stone-200 text-stone-900 font-serif font-medium rounded-bl-xs'
                        }`}
                      >
                        <p>{msg.text}</p>
                        {msg.isFollowUp && msg.detectedMotifs && msg.detectedMotifs.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-amber-200/80 text-[11px] font-sans not-italic text-amber-900">
                            <span>Contexto detectado: </span>
                            <span className="font-semibold">
                              {msg.detectedMotifs.join(' · ')}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {isTypingAi && (
                    <div className="text-xs text-stone-500 italic px-2">
                      Preparando una nueva pregunta sobre tu recuerdo...
                    </div>
                  )}
                </div>

                {/* Chat Input Form */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendChatMessage();
                  }}
                  className="pt-3 border-t border-stone-200 space-y-2.5"
                >
                  <div className="flex items-center justify-between text-[11px] text-stone-500">
                    <label htmlFor="simulador-chat-input" className="font-medium text-stone-700">
                      Escribe un recuerdo o prueba con un ejemplo:
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const sample =
                          demoMode === 'compartida'
                            ? currentStagePreset.sampleAnswerShared
                            : currentStagePreset.sampleAnswerIndividual;
                        handleSendChatMessage(sample);
                      }}
                      className="text-amber-900 font-semibold hover:underline cursor-pointer"
                    >
                      Probar recuerdo de ejemplo
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      id="simulador-chat-input"
                      data-testid="simulador-chat-input"
                      type="text"
                      value={chatInputText}
                      onChange={(e) => setChatInputText(e.target.value)}
                      placeholder="Ej. Recuerdo cuando viajábamos en tren a Veracruz con mi abuelo Santiago..."
                      className="flex-1 rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-xs sm:text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-700"
                    />
                    <button
                      type="submit"
                      data-testid="simulador-chat-submit"
                      className="px-4 py-2.5 bg-amber-800 hover:bg-amber-900 text-white text-xs font-semibold rounded-xl transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Enviar</span>
                    </button>
                  </div>
                </form>
              </div>

              {/* Right: Compact Senior-Friendly Voice & Photo Controls */}
              <div className="lg:col-span-5 bg-[#FAF8F5] border border-stone-200 rounded-2xl p-5 sm:p-6 space-y-5 shadow-2xs">
                <div className="flex items-center justify-between border-b border-stone-200 pb-3">
                  <div>
                    <h3 className="font-serif text-lg font-bold text-stone-900">
                      Grabador Accesible y Fotografías
                    </h3>
                    <p className="text-xs text-stone-500">
                      Interfaz limpia sin totales intimidantes de preguntas.
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold text-amber-900 tabular-nums">
                      32 respondidas · 60%
                    </div>
                    <div className="w-20 bg-stone-200 h-1.5 rounded-full overflow-hidden mt-1 ml-auto">
                      <div className="bg-amber-800 h-full w-3/5 rounded-full" />
                    </div>
                  </div>
                </div>

                {/* Audio Quality Protection Scenarios */}
                <div className="space-y-2.5">
                  <div className="text-xs font-medium text-stone-700">
                    Protección de audio (nunca inventa palabras):
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setRecorderScenario('clear')}
                      className={`px-2.5 py-2 text-[11px] font-semibold rounded-lg border transition-colors cursor-pointer ${
                        recorderScenario === 'clear'
                          ? 'bg-amber-900/10 border-amber-800 text-stone-900'
                          : 'bg-white border-stone-200 text-stone-600'
                      }`}
                    >
                      Voz Clara
                    </button>
                    <button
                      type="button"
                      onClick={() => setRecorderScenario('noisy')}
                      className={`px-2.5 py-2 text-[11px] font-semibold rounded-lg border transition-colors cursor-pointer ${
                        recorderScenario === 'noisy'
                          ? 'bg-amber-900/10 border-amber-800 text-stone-900'
                          : 'bg-white border-stone-200 text-stone-600'
                      }`}
                    >
                      Con Ruido
                    </button>
                    <button
                      type="button"
                      onClick={() => setRecorderScenario('silence30s')}
                      className={`px-2.5 py-2 text-[11px] font-semibold rounded-lg border transition-colors cursor-pointer ${
                        recorderScenario === 'silence30s'
                          ? 'bg-amber-900/10 border-amber-800 text-stone-900'
                          : 'bg-white border-stone-200 text-stone-600'
                      }`}
                    >
                      30s sin Voz
                    </button>
                  </div>

                  {recorderScenario === 'clear' && (
                    <div className="p-3.5 rounded-xl bg-white border border-stone-200 text-xs space-y-1">
                      <div className="font-semibold text-emerald-800 flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5" />
                        <span>Audio nítido · Transcripción fiel al instante</span>
                      </div>
                      <p className="text-stone-600 italic">
                        “Mi padre nos llevaba todos los sábados al mercado de San Juan...”
                      </p>
                    </div>
                  )}

                  {recorderScenario === 'noisy' && (
                    <div className="p-3.5 rounded-xl bg-amber-50/90 border border-amber-300 text-xs space-y-1">
                      <div className="font-semibold text-amber-900 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>Aviso de ruido de fondo</span>
                      </div>
                      <p className="text-amber-900/90">
                        Transcribe solo lo audible y sugiere un lugar silencioso o usar el teclado.
                      </p>
                    </div>
                  )}

                  {recorderScenario === 'silence30s' && (
                    <div className="p-3.5 rounded-xl bg-stone-100 border border-stone-300 text-xs space-y-1">
                      <div className="font-semibold text-stone-900 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-800 shrink-0" />
                        <span>Pausa automática a los 30s sin voz</span>
                      </div>
                      <p className="text-stone-700">
                        Pausa la grabación y avisa para revisar el micrófono sin inventar texto.
                      </p>
                    </div>
                  )}
                </div>

                {/* Collapsible Toggles: "Cargar Fotografía" and "Mostrar Archivos de voz" */}
                <div className="pt-2 border-t border-stone-200 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setShowPhotoUploaderDemo(!showPhotoUploaderDemo)}
                      className="px-3 py-2 bg-white hover:bg-stone-100 border border-stone-300 text-stone-900 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5 text-amber-800" />
                      <span>{showPhotoUploaderDemo ? 'Ocultar Fotografía' : 'Cargar Fotografía'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowSavedAudioDemo(!showSavedAudioDemo)}
                      className="px-3 py-2 bg-white hover:bg-stone-100 border border-stone-300 text-stone-900 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Volume2 className="w-3.5 h-3.5 text-amber-800" />
                      <span>
                        {showSavedAudioDemo ? 'Ocultar Archivos de voz' : 'Mostrar Archivos de voz'}
                      </span>
                    </button>
                  </div>

                  {showPhotoUploaderDemo && (
                    <div className="p-3.5 rounded-xl bg-white border border-stone-200 space-y-2.5 text-xs">
                      <div className="flex flex-wrap gap-1.5">
                        {DEMO_PHOTO_MEMORIES.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setSelectedPhotoId(item.id)}
                            className={`px-2.5 py-1 rounded-md border text-[11px] font-medium cursor-pointer ${
                              selectedPhotoId === item.id
                                ? 'bg-amber-900/10 border-amber-800 text-stone-900'
                                : 'bg-[#FAF8F5] border-stone-200 text-stone-600'
                            }`}
                          >
                            {item.year}
                          </button>
                        ))}
                      </div>
                      <div className="font-serif font-bold text-stone-900">
                        {selectedPhoto.title} ({selectedPhoto.location})
                      </div>
                      <p className="text-stone-600 italic">{selectedPhoto.caption}</p>
                    </div>
                  )}

                  {showSavedAudioDemo && (
                    <div className="p-3.5 rounded-xl bg-white border border-stone-200 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between text-stone-700">
                        <span>Audio 01 · Recuerdo familiar (02:14)</span>
                        <span className="text-emerald-800 font-medium">Guardado</span>
                      </div>
                      <div className="flex items-center justify-between text-stone-700">
                        <span>Audio 02 · Primer viaje (01:48)</span>
                        <span className="text-emerald-800 font-medium">Guardado</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. VISTA PREVIA INTERACTIVA DEL LEGADO (Real Multi-Page Book Renderer Matching Registered Users) */}
        <section
          id="vista-previa-legado"
          className="scroll-mt-20 max-w-7xl mx-auto px-6 py-14 lg:py-16 space-y-8"
        >
          {/* V5.8.2: text and page tabs stacked at every width. With 11 pages the tabs (shrink-0, side by
              side with the text from lg up) left the text a very narrow column on desktop browsers. */}
          <div data-testid="legacy-preview-header" className="flex flex-col gap-5">
            <div className="space-y-1.5 max-w-3xl min-w-0">
              <div className="text-xs font-medium text-amber-900">
                Visor Real de Páginas · Diseño Editorial Fijo de Muestra (Clásica Eterna · 6×9&quot;)
              </div>
              <h2 className="font-serif text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
                Vista Previa Interactiva del Legado
              </h2>
              <p className="text-sm text-stone-600">
                Recorre las páginas reales del libro tal como las genera el Estudio Editorial para usuarios registrados de YouForever: portada con sello oficial, portadilla con dedicatoria, capítulos ilustrados con fotografías comentadas y página final de cierre.
              </p>
            </div>

            {/* Real Composed Book Page Selector Tabs */}
            <div data-testid="legacy-preview-page-tabs" className="flex flex-wrap items-center gap-1.5 min-w-0 w-full">
              {composedSampleBook.pages.map((p, idx) => (
                <button
                  key={`real-page-${p.pageNumber}`}
                  type="button"
                  onClick={() => {
                    setPageIndex(idx);
                    setIsPlayingVoiceSample(false);
                  }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    safePageIndex === idx
                      ? 'bg-stone-900 border-stone-900 text-white'
                      : 'bg-white border-stone-300 text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  {getComposedPageShortLabel(idx, p.kind)}
                </button>
              ))}
            </div>
          </div>

          {/* Biographical Book Visualization Card + Deliverable Column */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left 8 cols: Real Registered-User Book Page Renderer + Interactive Audio/Disposition Inspector */}
            <div
              data-testid="legacy-book-card"
              className="lg:col-span-8 bg-white border border-stone-200 rounded-2xl p-5 sm:p-7 flex flex-col justify-between space-y-6 shadow-xs"
            >
              {/* Top Metadata Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-600 border-b border-stone-200 pb-3">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-amber-800" />
                  <span className="font-semibold text-stone-900">
                    Diseño Editorial: Clásica Eterna · Clásico Editorial (EB Garamond · 6×9&quot;)
                  </span>
                </div>
                <span className="font-semibold text-amber-900 tabular-nums">
                  Página {activeComposedPage.pageNumber} de {totalComposedPages}
                </span>
              </div>

              {/* Authentic Registered-User Page Viewer */}
              <div className="bg-stone-100/90 border border-stone-200/90 rounded-2xl p-4 sm:p-6 flex flex-col items-center justify-center">
                <div className="w-full max-w-[430px] shadow-xl rounded-sm overflow-hidden">
                  <ScaledBookPageView composed={composedSampleBook} page={activeComposedPage} />
                </div>
              </div>

              {/* Page Alternation Footer Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-stone-200">
                <span className="text-xs text-stone-500">
                  {activeComposedPage.kind === 'cover'
                    ? 'Portada Oficial con Símbolo Y∞F YouForever'
                    : activeComposedPage.kind === 'title_dedication'
                    ? 'Portadilla, Dedicatoria Familiar e Introducción'
                    : activeComposedPage.kind === 'closing_mandatory'
                    ? 'Página Final Oficial · «Esta historia continuará...»'
                    : `${activeBookPage.stageReference} · Maquetación Real`}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-testid="prev-book-page"
                    onClick={() =>
                      setPageIndex((prev) =>
                        prev > 0 ? prev - 1 : totalComposedPages - 1
                      )
                    }
                    className="px-3.5 py-2 text-xs font-medium bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg inline-flex items-center gap-1 cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Página anterior</span>
                  </button>
                  <button
                    type="button"
                    data-testid="next-book-page"
                    onClick={() =>
                      setPageIndex((prev) =>
                        prev < totalComposedPages - 1 ? prev + 1 : 0
                      )
                    }
                    className="px-3.5 py-2 text-xs font-medium bg-stone-900 hover:bg-stone-800 text-white rounded-lg inline-flex items-center gap-1 cursor-pointer"
                  >
                    <span>Siguiente página</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Complementary Interactive Inspector: Photo vs. Transcription Balance & Linked Voice Quote */}
              <div className="bg-[#FAF8F5] border border-stone-200/90 rounded-xl p-4 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <label
                    htmlFor="legacy-layout-slider"
                    className="text-xs font-semibold text-stone-900 inline-flex items-center gap-2"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5 text-amber-800" />
                    <span>Balance de Fotografías, Transcripción y Voz vinculada al capítulo:</span>
                  </label>
                  <span
                    data-testid="legacy-layout-mode-label"
                    className="text-xs font-medium text-amber-900 tabular-nums"
                  >
                    {layoutDisposition.modeLabel}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-medium text-stone-600 whitespace-nowrap">
                    Más Transcripción
                  </span>
                  <input
                    id="legacy-layout-slider"
                    data-testid="legacy-layout-slider"
                    type="range"
                    min={15}
                    max={85}
                    step={5}
                    value={layoutSliderValue}
                    onChange={(e) => setLayoutSliderValue(Number(e.target.value))}
                    aria-label="Disposición de fotografías y transcripciones"
                    className="w-full accent-amber-800 cursor-pointer"
                  />
                  <span className="text-[11px] font-medium text-stone-600 whitespace-nowrap">
                    Más Fotografía
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch pt-1">
                  <div
                    data-testid="book-page-photo-panel"
                    className="md:col-span-5 rounded-xl overflow-hidden border border-stone-200 bg-white flex flex-col justify-between"
                  >
                    <div
                      className="p-3.5 text-white flex flex-col justify-between"
                      style={{
                        background: `linear-gradient(135deg, ${activeBookPage.photoPalette.bgFrom}, ${activeBookPage.photoPalette.bgTo})`,
                      }}
                    >
                      <div className="flex items-center justify-between text-[10px] text-amber-200/90">
                        <span>Fotografía · {activeBookPage.photoYear}</span>
                        <span>{activeBookPage.photoLocation}</span>
                      </div>
                      <div className="font-serif text-xs font-bold text-white mt-1.5">
                        {activeBookPage.photoTitle}
                      </div>
                      <div className="text-[10px] text-amber-100/80 mt-1">
                        Proporción visual de foto: {layoutDisposition.photoWeight}%
                      </div>
                    </div>
                    <div className="p-2.5 text-[11px] text-stone-600 font-serif italic">
                      {activeBookPage.photoCaption}
                    </div>
                  </div>

                  <div
                    data-testid="book-page-transcription-panel"
                    className="md:col-span-7 flex flex-col justify-between space-y-2.5 bg-white p-3.5 rounded-xl border border-stone-200"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-amber-900">
                        Audio original preservado ({activeBookPage.audioDuration})
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsPlayingVoiceSample(!isPlayingVoiceSample)}
                        className="text-xs font-semibold text-amber-900 hover:underline inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>{isPlayingVoiceSample ? 'Detener' : 'Escuchar voz'}</span>
                      </button>
                    </div>
                    <p className="font-serif text-xs italic text-stone-700 leading-relaxed">
                      {activeBookPage.originalVoiceQuote}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right 4 cols: Concise Deliverable Summary */}
            <div className="lg:col-span-4 bg-[#F3EFEA] border border-stone-200 rounded-2xl p-6 flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-amber-900 font-semibold text-xs">
                  <FolderArchive className="w-4 h-4" />
                  <span>Entrega Patrimonial Completa</span>
                </div>

                <h3 className="font-serif text-xl font-bold text-stone-900">
                  Diseño de Libro + Carpeta de Recuerdos + Mi Esencia
                </h3>

                <div className="space-y-2.5 text-xs">
                  <div className="p-3.5 bg-white rounded-xl border border-stone-200/80">
                    <div className="font-semibold text-stone-900 flex items-center gap-2">
                      <BookOpen className="w-3.5 h-3.5 text-amber-800 shrink-0" />
                      <span>1. Libro Biográfico Maquetado (PDF e Imprenta)</span>
                    </div>
                    <p className="text-stone-600 mt-1 text-[11px]">
                      5 diseños de portada, 5 estilos interiores, 3 formatos (6×9&quot;, A5, Carta) y sello oficial YouForever.
                    </p>
                  </div>

                  <div className="p-3.5 bg-white rounded-xl border border-stone-200/80">
                    <div className="font-semibold text-stone-900 flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 text-amber-800 shrink-0" />
                      <span>2. Tus Recuerdos Originales</span>
                    </div>
                    <p className="text-stone-600 mt-1 text-[11px]">
                      Todas tus preguntas y respuestas fieles, organizadas por cada etapa de tu vida.
                    </p>
                  </div>

                  <div className="p-3.5 bg-white rounded-xl border border-stone-200/80">
                    <div className="font-semibold text-stone-900 flex items-center gap-2">
                      <Volume2 className="w-3.5 h-3.5 text-amber-800 shrink-0" />
                      <span>3. Tus Grabaciones y Fotografías</span>
                    </div>
                    <p className="text-stone-600 mt-1 text-[11px]">
                      Grabaciones de voz originales y fotografías familiares en alta resolución.
                    </p>
                  </div>

                  <div className="p-3.5 bg-amber-50/80 rounded-xl border border-amber-300/80">
                    <div className="font-semibold text-amber-950 flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-amber-800 shrink-0" />
                      <span>4. Espacio Familiar en Mi Esencia</span>
                    </div>
                    <p className="text-stone-700 mt-1 text-[11px]">
                      Conversación viva para hijos y nietos mediante códigos personales seguros <code>YF-XXXXX</code>.
                    </p>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => scrollToSection('contacto-regalo')}
                className="w-full py-3 bg-amber-800 hover:bg-amber-900 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Quiero este Libro para mi Familia
              </button>
            </div>
          </div>
        </section>

        {/* 4. MI ESENCIA ECOSYSTEM SECTION (Conversational Biographical Legacy with A/B/C Privacy Levels) */}
        <section
          id="mi-esencia-ecosistema"
          className="scroll-mt-20 bg-stone-900 text-stone-100 py-14 lg:py-16 border-y border-stone-800"
        >
          <div className="max-w-7xl mx-auto px-6 space-y-10">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
              <div className="space-y-2 max-w-3xl">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Nuevo en YouForever • Mi Esencia</span>
                </div>
                <h2 className="font-serif text-2xl sm:text-3xl font-bold text-white tracking-tight">
                  Más que un libro: conversa para siempre con la esencia de quienes amas.
                </h2>
                <p className="text-sm text-stone-300 leading-relaxed">
                  A partir de la entrevista biográfica, <strong>Mi Esencia</strong> crea una recreación testimonial fiel con la que hijos, nietos y familiares autorizados pueden conversar en cualquier momento mediante su propio código de acceso <code>YF-XXXXX</code>.
                </p>
              </div>

              <a
                href="/miesencia"
                className="px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 text-xs font-bold inline-flex items-center gap-2 whitespace-nowrap self-start shrink-0 transition"
              >
                <KeyRound className="w-4 h-4" />
                <span>Conocer Portal Familiar</span>
              </a>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-6 rounded-2xl bg-stone-950/80 border border-amber-500/30 space-y-3">
                <div className="flex items-center gap-2 text-amber-300 font-semibold text-sm">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>Nivel A • Inmutable</span>
                </div>
                <p className="text-xs text-stone-300 leading-relaxed">
                  Es la historia original de la persona entrevistada, tomada directamente de{' '}
                  <strong className="text-white">sus recuerdos y respuestas reales</strong>. Ningún familiar ni conversación posterior puede alterar lo que dejó contado de viva voz.
                </p>
              </div>

              <div className="p-6 rounded-2xl bg-stone-950/80 border border-emerald-500/30 space-y-3">
                <div className="flex items-center gap-2 text-emerald-300 font-semibold text-sm">
                  <Users className="w-4 h-4 shrink-0" />
                  <span>Nivel B • Familiar</span>
                </div>
                <p className="text-xs text-stone-300 leading-relaxed">
                  Los familiares autorizados pueden aportar anécdotas, viajes o recuerdos compartidos durante sus conversaciones. Siempre se guardan con atribución explícita de quién los contó para enriquecer la memoria colectiva.
                </p>
              </div>

              <div className="p-6 rounded-2xl bg-stone-950/80 border border-sky-500/30 space-y-3">
                <div className="flex items-center gap-2 text-sky-300 font-semibold text-sm">
                  <Lock className="w-4 h-4 shrink-0" />
                  <span>Nivel C • Privado por Código YF-XXXXX</span>
                </div>
                <p className="text-xs text-stone-300 leading-relaxed">
                  Cada familiar recibe un código personal único (<code>YF-XXXXX</code>) que mantiene sus confidencias personales en total privacidad, sin mostrarlas jamás a otros integrantes de la familia.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 5. HOW IT WORKS: 4-STEP EDITORIAL PROCESS */}
        <section
          id="como-funciona"
          className="scroll-mt-20 bg-[#F3EFEA] border-b border-stone-200/90 py-14 lg:py-16"
        >
          <div className="max-w-7xl mx-auto px-6 space-y-10">
            <div className="max-w-3xl space-y-2">
              <div className="text-xs font-medium text-amber-900">
                Un Proceso Cálido, Sencillo y Humano
              </div>
              <h2
                className="font-serif text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight"
                style={{ textWrap: 'balance' }}
              >
                Pensado para que tu familia, padres, hijos, pareja o abuelos disfruten recordar sin complicaciones técnicas.
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-white border border-stone-200/90 rounded-2xl p-5 space-y-2">
                <div className="text-xs font-semibold text-amber-900">01. Invitación Directa</div>
                <h3 className="font-serif text-lg font-bold text-stone-900">
                  Enlace o código YF-XXXXX
                </h3>
                <p className="text-xs text-stone-600 leading-relaxed">
                  Entran desde su celular, tableta o computadora con su enlace directo o código personal sencillo y seguro.
                </p>
              </div>

              <div className="bg-white border border-stone-200/90 rounded-2xl p-5 space-y-2">
                <div className="text-xs font-semibold text-amber-900">02. Charla a su Ritmo</div>
                <h3 className="font-serif text-lg font-bold text-stone-900">
                  Por voz o teclado
                </h3>
                <p className="text-xs text-stone-600 leading-relaxed">
                  Responden cuando gusten con autoguardado y preguntas empáticas que profundizan en sus recuerdos.
                </p>
              </div>

              <div className="bg-white border border-stone-200/90 rounded-2xl p-5 space-y-2">
                <div className="text-xs font-semibold text-amber-900">03. Estudio Editorial</div>
                <h3 className="font-serif text-lg font-bold text-stone-900">
                  Diseño y redacción fiel
                </h3>
                <p className="text-xs text-stone-600 leading-relaxed">
                  Eligen el estilo literario, portada, tipografía interior y formato para generar su libro ilustrado en PDF.
                </p>
              </div>

              <div className="bg-white border border-stone-200/90 rounded-2xl p-5 space-y-2">
                <div className="text-xs font-semibold text-amber-900">04. Legado Eterno</div>
                <h3 className="font-serif text-lg font-bold text-stone-900">
                  Libro, Recuerdos y Mi Esencia
                </h3>
                <p className="text-xs text-stone-600 leading-relaxed">
                  Recibes el Libro Biográfico, el respaldo completo con tus audios y fotos, y el acceso familiar a Mi Esencia.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 6. VALUE MODALITIES & DIRECT CONTACT / GIFT INQUIRY SECTION */}
        <section id="contacto-regalo" className="scroll-mt-20 max-w-7xl mx-auto px-6 py-14 lg:py-20 space-y-12">
          {/* Concise Gift Modalities */}
          <div className="space-y-6">
            <div className="max-w-2xl space-y-2">
              <div className="text-xs font-medium text-amber-900">
                El Regalo Más Significativo
              </div>
              <h2 className="font-serif text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
                Elige la modalidad ideal para tu familia.
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white border border-stone-200/90 rounded-2xl p-5 flex flex-col justify-between space-y-4">
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-amber-900">Modalidad 01</div>
                  <h3 className="font-serif text-xl font-bold text-stone-900">Legado Individual</h3>
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Para mamá, papá o abuelos. Recorre sus 5 etapas de vida, anécdotas, fotografías y consejos familiares.
                  </p>
                </div>
                <div className="pt-3 border-t border-stone-200/80 text-[11px] text-stone-600">
                  Código YF-XXXXX · Estudio de Libro · Voz y Fotos
                </div>
              </div>

              <div className="bg-[#F3EFEA] border border-amber-800/40 rounded-2xl p-5 flex flex-col justify-between space-y-4">
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-amber-900">
                    Modalidad 02 · Ideal para Aniversarios
                  </div>
                  <h3 className="font-serif text-xl font-bold text-stone-900">
                    Historia Compartida en Pareja
                  </h3>
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Para parejas que desean narrar juntos cómo se conocieron, formaron su hogar y construyeron su familia.
                  </p>
                </div>
                <div className="pt-3 border-t border-stone-300/80 text-[11px] text-stone-700 font-medium">
                  Preguntas para Ambos · Libro en Pareja · Archivo Completo
                </div>
              </div>

              <div className="bg-white border border-stone-200/90 rounded-2xl p-5 flex flex-col justify-between space-y-4">
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-amber-900">Modalidad 03</div>
                  <h3 className="font-serif text-xl font-bold text-stone-900">
                    Edición Familiar + Mi Esencia
                  </h3>
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Incluye el libro biográfico completo y la activación del avatar conversacional en Mi Esencia para tus familiares.
                  </p>
                </div>
                <div className="pt-3 border-t border-stone-200/80 text-[11px] text-stone-600">
                  Libro Imprimible · Códigos Familiares YF-XXXXX · Niveles A, B y C
                </div>
              </div>
            </div>
          </div>

          {/* Direct Contact & Inquiry Form Split */}
          <div className="bg-white border border-stone-200 rounded-2xl p-6 sm:p-8 lg:p-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column: Direct WhatsApp & Email Actions */}
            <div className="lg:col-span-5 space-y-5">
              <div className="space-y-2">
                <div className="text-xs font-semibold text-amber-900">
                  Atención Personalizada Directa
                </div>
                <h3 className="font-serif text-2xl font-bold text-stone-900">
                  Comienza hoy a preservar su historia.
                </h3>
                <p className="text-xs text-stone-600 leading-relaxed">
                  Contáctanos directamente por WhatsApp al <strong>{OFFICIAL_WHATSAPP_DISPLAY}</strong> o escribe a <strong>{OFFICIAL_CONTACT_EMAIL}</strong> para preparar el acceso de tu familiar.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[#FAF8F5] border border-stone-200/90 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-stone-500">WhatsApp Oficial:</span>
                  <strong className="text-stone-900 font-mono">{OFFICIAL_WHATSAPP_DISPLAY}</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-stone-500">Correo Oficial:</span>
                  <strong className="text-stone-900 font-mono">{OFFICIAL_CONTACT_EMAIL}</strong>
                </div>
              </div>

              <div className="space-y-2.5">
                <a
                  href={buildWhatsAppInquiryUrl(formInput)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-3 px-5 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  <MessageCircle className="w-4 h-4 shrink-0" />
                  <span>Contactar por WhatsApp ({OFFICIAL_WHATSAPP_DISPLAY})</span>
                </a>

                <a
                  href={buildMailtoInquiryUrl(formInput)}
                  className="w-full py-3 px-5 bg-stone-100 hover:bg-stone-200 text-stone-900 text-xs font-semibold rounded-xl border border-stone-300 transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  <Mail className="w-4 h-4 text-amber-800 shrink-0" />
                  <span>Enviar Correo ({OFFICIAL_CONTACT_EMAIL})</span>
                </a>
              </div>

              {onNavigateToPortal && (
                <div className="pt-3 border-t border-stone-200 text-xs text-stone-600 flex items-center justify-between">
                  <span>¿Ya tienes código YF-XXXXX?</span>
                  <button
                    type="button"
                    onClick={onNavigateToPortal}
                    className="text-amber-900 font-semibold hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    <span>Ir al Portal</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Right Column: Validated Lead / Gift Request Form */}
            <div className="lg:col-span-7 bg-[#FAF8F5] border border-stone-200/90 rounded-xl p-5 sm:p-6">
              <form onSubmit={handleInquirySubmit} noValidate className="space-y-4">
                <div className="border-b border-stone-200 pb-2.5">
                  <h4 className="font-serif text-lg font-bold text-stone-900">
                    Formulario de Solicitud
                  </h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="inquiry-fullname"
                      className="block text-xs font-medium text-stone-800 mb-1"
                    >
                      Tu nombre completo *
                    </label>
                    <input
                      id="inquiry-fullname"
                      type="text"
                      value={formInput.fullName}
                      onChange={(e) => {
                        setFormInput({ ...formInput, fullName: e.target.value });
                        if (formErrors.fullName) setFormErrors({ ...formErrors, fullName: undefined });
                      }}
                      placeholder="Ej. Mariana Gómez"
                      className="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-700"
                    />
                    {formErrors.fullName && (
                      <p role="alert" className="text-xs text-red-700 mt-1 font-medium">
                        {formErrors.fullName}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="inquiry-contact"
                      className="block text-xs font-medium text-stone-800 mb-1"
                    >
                      Tu WhatsApp o Correo *
                    </label>
                    <input
                      id="inquiry-contact"
                      type="text"
                      value={formInput.contactInfo}
                      onChange={(e) => {
                        setFormInput({ ...formInput, contactInfo: e.target.value });
                        if (formErrors.contactInfo)
                          setFormErrors({ ...formErrors, contactInfo: undefined });
                      }}
                      placeholder="Ej. +52 55 1234 5678"
                      className="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-700"
                    />
                    {formErrors.contactInfo && (
                      <p role="alert" className="text-xs text-red-700 mt-1 font-medium">
                        {formErrors.contactInfo}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="inquiry-relation"
                      className="block text-xs font-medium text-stone-800 mb-1"
                    >
                      ¿Para quién es YouForever? *
                    </label>
                    <input
                      id="inquiry-relation"
                      type="text"
                      value={formInput.recipientRelation}
                      onChange={(e) => {
                        setFormInput({ ...formInput, recipientRelation: e.target.value });
                        if (formErrors.recipientRelation)
                          setFormErrors({ ...formErrors, recipientRelation: undefined });
                      }}
                      placeholder="Ej. Mis padres, Mi abuela"
                      className="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-700"
                    />
                    {formErrors.recipientRelation && (
                      <p role="alert" className="text-xs text-red-700 mt-1 font-medium">
                        {formErrors.recipientRelation}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="inquiry-modality"
                      className="block text-xs font-medium text-stone-800 mb-1"
                    >
                      Modalidad
                    </label>
                    <select
                      id="inquiry-modality"
                      value={formInput.modality}
                      onChange={(e) =>
                        setFormInput({
                          ...formInput,
                          modality: e.target.value as InquiryFormInput['modality'],
                        })
                      }
                      className="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-700"
                    >
                      <option value="individual">Legado Individual</option>
                      <option value="compartida">Historia Compartida (Pareja)</option>
                      <option value="familiar">Edición Familiar + Mi Esencia</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="inquiry-message"
                    className="block text-xs font-medium text-stone-800 mb-1"
                  >
                    Comentarios adicionales (opcional)
                  </label>
                  <textarea
                    id="inquiry-message"
                    rows={2}
                    value={formInput.message}
                    onChange={(e) => setFormInput({ ...formInput, message: e.target.value })}
                    placeholder="Ej. Aniversario o cumpleaños especial..."
                    className="w-full rounded-lg border border-stone-300 bg-white p-3 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-700"
                  />
                </div>

                <div className="pt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <button
                    type="submit"
                    className="px-6 py-2.5 bg-amber-800 hover:bg-amber-900 text-white text-xs font-semibold rounded-lg transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                  >
                    <Heart className="w-4 h-4" />
                    <span>Enviar Solicitud de Información</span>
                  </button>
                  <span className="text-[11px] text-stone-500">
                    Atención directa · {OFFICIAL_WHATSAPP_DISPLAY} · {OFFICIAL_CONTACT_EMAIL}
                  </span>
                </div>

                {formSubmitted && (
                  <div
                    role="status"
                    data-testid="inquiry-success-banner"
                    className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-950 space-y-2"
                  >
                    <div className="text-xs font-bold flex items-center gap-1.5">
                      <Check className="w-4 h-4 text-emerald-700" />
                      <span>¡Gracias, {formInput.fullName.trim()}! Tu solicitud está lista.</span>
                    </div>
                    <div className="flex flex-wrap gap-2.5 pt-1">
                      <a
                        href={buildWhatsAppInquiryUrl(formInput)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3.5 py-2 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        <span>Abrir WhatsApp ({OFFICIAL_WHATSAPP_DISPLAY})</span>
                      </a>
                      <a
                        href={buildMailtoInquiryUrl(formInput)}
                        className="px-3.5 py-2 bg-white hover:bg-stone-100 text-stone-900 border border-emerald-400 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5"
                      >
                        <Mail className="w-3.5 h-3.5 text-amber-800" />
                        <span>Enviar a {OFFICIAL_CONTACT_EMAIL}</span>
                      </a>
                    </div>
                  </div>
                )}
              </form>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};
