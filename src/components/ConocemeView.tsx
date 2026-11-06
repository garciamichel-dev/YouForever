import React, { useState } from 'react';
import {
  BookOpen,
  Mic,
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
} from '../utils/conocemeLogic.ts';

interface ConocemeViewProps {
  onNavigateToPortal?: () => void;
  onNavigateToDemo?: () => void;
  onBackToAdmin?: () => void;
  onOpenPrivacyNotice?: () => void;
  onOpenFaq?: () => void;
}

export const ConocemeView: React.FC<ConocemeViewProps> = ({
  onNavigateToPortal,
  onNavigateToDemo,
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
        roleLabel: 'Entrevistador IA · Pregunta de Profundización Contextual',
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

  // 2. VISTA PREVIA INTERACTIVA DEL LEGADO (Book Page Alternation + Disposition Slider State)
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
        roleLabel: 'Entrevistador IA · Pregunta de Profundización Contextual',
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
        roleLabel: 'Entrevistador IA · Pregunta de Profundización Contextual',
        text: result.followUpQuestion,
        isFollowUp: true,
        detectedMotifs: result.detectedMotifs,
      };
      setChatMessages([...baseMessages, userMsg, aiReply]);
      setIsTypingAi(false);
    }, 120);
  };

  // Active Book Page & Layout Disposition Calculation
  const activeBookPage = SAMPLE_BOOK_CHAPTERS[pageIndex] || SAMPLE_BOOK_CHAPTERS[0];
  const layoutDisposition = computeLegacyLayoutDisposition(layoutSliderValue);
  const selectedPhoto =
    DEMO_PHOTO_MEMORIES.find((p) => p.id === selectedPhotoId) || DEMO_PHOTO_MEMORIES[0];

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
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-8 px-6 py-4">
          {/* Zone 1: Single text element wordmark */}
          <a
            href="/conoceme"
            className="text-xl font-serif font-bold tracking-tight text-stone-900 whitespace-nowrap shrink-0"
          >
            ForeverYou
          </a>

          {/* Zone 2: 4 concise single-line navigation links */}
          <nav
            aria-label="Navegación comercial"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-stone-600"
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
              Vista Previa del Legado
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
              href="/demo"
              onClick={(e) => {
                if (onNavigateToDemo) {
                  e.preventDefault();
                  onNavigateToDemo();
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
              Regalar ForeverYou
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
                <div className="flex items-center gap-2 text-xs font-medium text-amber-900">
                  <span>Biografías Familiares Guiadas</span>
                  <span aria-hidden="true">·</span>
                  <span>Voz, Fotos y Libro Imprimible</span>
                </div>

                <h1
                  className="font-serif font-bold text-stone-900 tracking-tight leading-[1.12]"
                  style={{ fontSize: 'clamp(2.25rem, 4vw, 3.5rem)', textWrap: 'balance' }}
                >
                  Transforma la voz y los recuerdos de tu familia en un libro para toda la vida.
                </h1>

                <p className="text-base text-stone-700 leading-relaxed max-w-xl">
                  <strong>ForeverYou</strong> guía una conversación cálida por voz o teclado y convierte cada anécdota en un{' '}
                  <span className="text-stone-900 font-medium">libro biográfico ilustrado</span> con sus grabaciones originales preservadas.
                </p>
              </div>

              <div className="space-y-4 pt-1">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => scrollToSection('contacto-regalo')}
                    className="px-6 py-3.5 bg-amber-800 hover:bg-amber-900 text-white font-semibold text-sm rounded-lg transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
                  >
                    <span>Solicitar ForeverYou</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => scrollToSection('simulador-entrevista')}
                    className="px-5 py-3.5 bg-white hover:bg-stone-100 text-stone-800 font-medium text-sm rounded-lg border border-stone-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Probar Simulador de Entrevista
                  </button>
                </div>

                {/* Prueba gratuita — Mi historia en 10 preguntas Card */}
                <div className="rounded-xl bg-[#F3EFEA] border border-amber-800/20 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                      <Sparkles className="w-3.5 h-3.5 text-amber-700" />
                      <span>Prueba gratuita</span>
                    </div>
                    <p className="text-xs sm:text-sm text-stone-700">
                      Descubre cómo tus recuerdos pueden convertirse en un libro inolvidable
                    </p>
                  </div>
                  <a
                    href="/demo"
                    onClick={(e) => {
                      if (onNavigateToDemo) {
                        e.preventDefault();
                        onNavigateToDemo();
                      }
                    }}
                    className="px-4 py-2.5 bg-stone-900 hover:bg-stone-800 text-amber-50 text-xs font-semibold rounded-lg transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <span>Crear mi historia gratis</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </a>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-600">
                  <span>Acceso con un clic sin contraseñas</span>
                  <span aria-hidden="true">·</span>
                  <span>100% fiel a sus palabras</span>
                  <span aria-hidden="true">·</span>
                  <span>Paquete descargable (.ZIP)</span>
                </div>
              </div>
            </div>

            {/* Right Column: Compact Visual Showcase */}
            <div className="lg:col-span-5 flex flex-col">
              <div className="h-full rounded-2xl bg-[#F3EFEA] border border-stone-200/90 p-6 flex flex-col justify-between space-y-4">
                <div className="flex items-center justify-between text-xs text-stone-600 border-b border-stone-200 pb-3">
                  <span className="font-serif italic text-stone-800">Edición Biográfica Familiar</span>
                  <span>Voz + Fotos + Libro</span>
                </div>

                <div className="bg-[#FAF8F5] border border-stone-200/90 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between text-[11px] text-stone-500">
                    <span>CAPÍTULO I · INFANCIA</span>
                    <span className="tabular-nums">Pág. 14</span>
                  </div>

                  <h2 className="font-serif text-lg font-bold text-stone-900 leading-snug">
                    «El patio de los geranios y el pan recién horneado de la abuela Elena»
                  </h2>

                  <div className="rounded-lg bg-gradient-to-br from-stone-800 via-stone-900 to-amber-950 p-4 text-amber-50/95 space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-amber-200/80">
                      <span>Guadalajara, 1954</span>
                      <span className="tabular-nums">Audio: 02:45</span>
                    </div>
                    <p className="font-serif italic text-xs sm:text-sm leading-relaxed text-amber-50">
                      “Cada tarde a las seis salían las charolas del horno de leña. Sentarnos a escuchar a mi abuela fue nuestra primera escuela.”
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-stone-600">
                  <span>Individual o en Pareja</span>
                  <span>Edición digital e imprenta</span>
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
                Infancia, Juventud, Adultez, Madurez y Legado.
              </p>
            </div>
            <div>
              <div className="text-xs text-amber-900 font-medium">02 · Accesibilidad</div>
              <div className="font-serif text-lg font-bold text-stone-900">Voz o Teclado</div>
              <p className="text-xs text-stone-600 mt-0.5">
                Sin contraseñas y con autoguardado automático.
              </p>
            </div>
            <div>
              <div className="text-xs text-amber-900 font-medium">03 · Fidelidad Real</div>
              <div className="font-serif text-lg font-bold text-stone-900 tabular-nums">Cero Invenciones</div>
              <p className="text-xs text-stone-600 mt-0.5">
                Redacción fiel a sus palabras y tono original.
              </p>
            </div>
            <div>
              <div className="text-xs text-amber-900 font-medium">04 · Entrega Total</div>
              <div className="font-serif text-lg font-bold text-stone-900">Libro + Archivos</div>
              <p className="text-xs text-stone-600 mt-0.5">
                Libro, Dossier, fotos comentadas y audios en .ZIP.
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
                  Demostración Interactiva en Memoria · Sin Guardar Datos en Firestore
                </div>
                <h2 className="font-serif text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
                  Simulador de Entrevista
                </h2>
                <p className="text-sm text-stone-600">
                  Conversa con el entrevistador IA: responde a la pregunta inicial y observa cómo genera al instante una pregunta de profundización contextual basada en tus palabras.
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
                      Chat de Entrevista IA · {currentStagePreset.label}
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
                      El entrevistador IA está analizando tu recuerdo para profundizar...
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

        {/* 3. VISTA PREVIA INTERACTIVA DEL LEGADO (Biographical Book Card with Page Alternation & Layout Slider) */}
        <section
          id="vista-previa-legado"
          className="scroll-mt-20 max-w-7xl mx-auto px-6 py-14 lg:py-16 space-y-8"
        >
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
            <div className="space-y-1.5 max-w-2xl">
              <div className="text-xs font-medium text-amber-900">
                Edición Editorial Ilustrada · Alterna Páginas y Ajusta la Disposición Visual
              </div>
              <h2 className="font-serif text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
                Vista Previa Interactiva del Legado
              </h2>
              <p className="text-sm text-stone-600">
                Explora páginas de muestra del libro biográfico y utiliza el control deslizante para visualizar cómo conviven las fotografías comentadas con las transcripciones literarias.
              </p>
            </div>

            {/* Sample Page Selector Tabs */}
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 shrink-0">
              {SAMPLE_BOOK_CHAPTERS.map((page, idx) => (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => {
                    setPageIndex(idx);
                    setIsPlayingVoiceSample(false);
                  }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    pageIndex === idx
                      ? 'bg-stone-900 border-stone-900 text-white'
                      : 'bg-white border-stone-300 text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  Pág. {page.pageNumber} · {page.chapterNumber}
                </button>
              ))}
            </div>
          </div>

          {/* Biographical Book Visualization Card + Deliverable Column */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left 8 cols: Interactive Biographical Book Visualization Card */}
            <div
              data-testid="legacy-book-card"
              className="lg:col-span-8 bg-white border border-stone-200 rounded-2xl p-6 sm:p-8 flex flex-col justify-between space-y-6 shadow-xs"
            >
              {/* Slider Control Bar for Photo vs. Transcription Disposition */}
              <div className="bg-[#FAF8F5] border border-stone-200/90 rounded-xl p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <label
                    htmlFor="legacy-layout-slider"
                    className="text-xs font-semibold text-stone-900 inline-flex items-center gap-2"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5 text-amber-800" />
                    <span>Disposición de Fotos y Transcripciones:</span>
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
              </div>

              {/* Book Spread Header */}
              <div className="flex items-center justify-between text-xs text-stone-500 border-b border-stone-200 pb-3">
                <span>
                  {activeBookPage.chapterNumber} · {activeBookPage.subtitle}
                </span>
                <span className="font-semibold text-stone-800 tabular-nums">
                  Página {activeBookPage.pageNumber} de Muestra
                </span>
              </div>

              {/* Dynamic Book Page Content Responds to Slider Disposition */}
              <div className="space-y-5">
                <h3 className="font-serif text-2xl font-bold text-stone-900">
                  {activeBookPage.title}
                </h3>

                <div
                  className={
                    layoutDisposition.mode === 'balanced'
                      ? 'grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch'
                      : 'space-y-5'
                  }
                >
                  {/* Archival Photograph Block */}
                  <div
                    data-testid="book-page-photo-panel"
                    className={
                      layoutDisposition.mode === 'balanced'
                        ? 'md:col-span-5 flex flex-col justify-between rounded-xl overflow-hidden border border-stone-200 bg-[#FAF8F5]'
                        : 'rounded-xl overflow-hidden border border-stone-200 bg-[#FAF8F5]'
                    }
                  >
                    <div
                      className={`p-5 text-white flex flex-col justify-between transition-all ${
                        layoutDisposition.mode === 'photo-focus'
                          ? 'min-h-[210px]'
                          : layoutDisposition.mode === 'balanced'
                          ? 'min-h-[165px]'
                          : 'min-h-[110px]'
                      }`}
                      style={{
                        background: `linear-gradient(135deg, ${activeBookPage.photoPalette.bgFrom}, ${activeBookPage.photoPalette.bgTo})`,
                      }}
                    >
                      <div className="flex items-center justify-between text-[11px] text-amber-200/90">
                        <span>Fotografía · {activeBookPage.photoYear}</span>
                        <span>{activeBookPage.photoLocation}</span>
                      </div>
                      <div className="my-2">
                        <div className="font-serif text-base sm:text-lg font-bold text-white leading-snug">
                          {activeBookPage.photoTitle}
                        </div>
                      </div>
                      <div className="text-[11px] text-amber-100/80">
                        Proporción visual de foto: {layoutDisposition.photoWeight}%
                      </div>
                    </div>

                    {layoutDisposition.mode !== 'transcription-focus' && (
                      <div className="p-3.5 text-xs text-stone-700 font-serif italic leading-relaxed">
                        {activeBookPage.photoCaption}
                      </div>
                    )}
                  </div>

                  {/* Literary Transcription & Voice Quote Block */}
                  <div
                    data-testid="book-page-transcription-panel"
                    className={
                      layoutDisposition.mode === 'balanced'
                        ? 'md:col-span-7 flex flex-col justify-between space-y-4'
                        : 'space-y-4'
                    }
                  >
                    <div className="space-y-3">
                      {activeBookPage.excerptParagraphs
                        .slice(0, layoutDisposition.mode === 'photo-focus' ? 1 : 2)
                        .map((para, i) => (
                          <p
                            key={i}
                            className="font-serif text-sm sm:text-base text-stone-800 leading-relaxed"
                          >
                            {para}
                          </p>
                        ))}
                    </div>

                    {/* Linked Voice Quote */}
                    <div className="p-3.5 rounded-xl bg-[#FAF8F5] border border-stone-200/90 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-amber-900">
                          Cita de voz original ({activeBookPage.audioDuration})
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
                      <p className="font-serif text-xs italic text-stone-700">
                        {activeBookPage.originalVoiceQuote}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Page Alternation Footer Controls */}
              <div className="flex items-center justify-between pt-4 border-t border-stone-200">
                <span className="text-xs text-stone-500">{activeBookPage.stageReference}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-testid="prev-book-page"
                    onClick={() =>
                      setPageIndex((prev) =>
                        prev > 0 ? prev - 1 : SAMPLE_BOOK_CHAPTERS.length - 1
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
                        prev < SAMPLE_BOOK_CHAPTERS.length - 1 ? prev + 1 : 0
                      )
                    }
                    className="px-3.5 py-2 text-xs font-medium bg-stone-900 hover:bg-stone-800 text-white rounded-lg inline-flex items-center gap-1 cursor-pointer"
                  >
                    <span>Siguiente página</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
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
                  Paquete Descargable (.ZIP)
                </h3>

                <div className="space-y-2.5 text-xs">
                  <div className="p-3.5 bg-white rounded-xl border border-stone-200/80">
                    <div className="font-semibold text-stone-900 flex items-center gap-2">
                      <BookOpen className="w-3.5 h-3.5 text-amber-800 shrink-0" />
                      <span>1. Libro Biográfico (Digital e Imprenta)</span>
                    </div>
                    <p className="text-stone-600 mt-1 text-[11px]">
                      Edición Cronológica y Temática lista para leer o imprimir en pasta dura.
                    </p>
                  </div>

                  <div className="p-3.5 bg-white rounded-xl border border-stone-200/80">
                    <div className="font-semibold text-stone-900 flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 text-amber-800 shrink-0" />
                      <span>2. Dossier Testimonial Íntegro</span>
                    </div>
                    <p className="text-stone-600 mt-1 text-[11px]">
                      Todas las preguntas y respuestas completas por etapa de vida.
                    </p>
                  </div>

                  <div className="p-3.5 bg-white rounded-xl border border-stone-200/80">
                    <div className="font-semibold text-stone-900 flex items-center gap-2">
                      <Volume2 className="w-3.5 h-3.5 text-amber-800 shrink-0" />
                      <span>3. Carpetas /audios y /fotografias</span>
                    </div>
                    <p className="text-stone-600 mt-1 text-[11px]">
                      Grabaciones de voz originales y fotografías familiares en alta resolución.
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

        {/* 4. HOW IT WORKS: 4-STEP EDITORIAL PROCESS WITH EXACT UPDATED HEADING */}
        <section
          id="como-funciona"
          className="scroll-mt-20 bg-[#F3EFEA] border-y border-stone-200/90 py-14 lg:py-16"
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
                  Acceso con un clic
                </h3>
                <p className="text-xs text-stone-600 leading-relaxed">
                  Entran desde su celular, tableta o computadora mediante un enlace personal sin contraseñas.
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
                <div className="text-xs font-semibold text-amber-900">03. Curaduría Fiel</div>
                <h3 className="font-serif text-lg font-bold text-stone-900">
                  Redacción biográfica
                </h3>
                <p className="text-xs text-stone-600 leading-relaxed">
                  Organizamos sus relatos y fotografías en capítulos literarios respetando cada palabra original.
                </p>
              </div>

              <div className="bg-white border border-stone-200/90 rounded-2xl p-5 space-y-2">
                <div className="text-xs font-semibold text-amber-900">04. Legado Eterno</div>
                <h3 className="font-serif text-lg font-bold text-stone-900">
                  Libro y Archivo Maestro
                </h3>
                <p className="text-xs text-stone-600 leading-relaxed">
                  Recibes el Libro Biográfico, el Dossier completo y todas las grabaciones de voz para tu familia.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 5. VALUE MODALITIES & DIRECT CONTACT / GIFT INQUIRY SECTION */}
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
                    Para mamá, papá o abuelos. Recorre sus 5 etapas de vida, anécdotas y consejos familiares.
                  </p>
                </div>
                <div className="pt-3 border-t border-stone-200/80 text-[11px] text-stone-600">
                  Portal Personalizado · Libro Biográfico · Voz y Fotos
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
                    Para parejas que desean narrar juntos cómo se conocieron y construyeron su familia.
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
                    Edición Familiar Especial
                  </h3>
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Para entrevistar a varios integrantes de la familia y crear una colección biográfica.
                  </p>
                </div>
                <div className="pt-3 border-t border-stone-200/80 text-[11px] text-stone-600">
                  Múltiples entrevistas · Atención dedicada · Archivos independientes
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
                  Atención Personalizada
                </div>
                <h3 className="font-serif text-2xl font-bold text-stone-900">
                  Comienza hoy a preservar su historia.
                </h3>
                <p className="text-xs text-stone-600 leading-relaxed">
                  Contáctanos por WhatsApp o correo, o llena el formulario para preparar el acceso de tu familiar.
                </p>
              </div>

              <div className="space-y-2.5">
                <a
                  href={buildWhatsAppInquiryUrl(formInput)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-3 px-5 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  <MessageCircle className="w-4 h-4 shrink-0" />
                  <span>Contactar por WhatsApp</span>
                </a>

                <a
                  href={buildMailtoInquiryUrl(formInput)}
                  className="w-full py-3 px-5 bg-stone-100 hover:bg-stone-200 text-stone-900 text-xs font-semibold rounded-xl border border-stone-300 transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  <Mail className="w-4 h-4 text-amber-800 shrink-0" />
                  <span>Enviar Correo Directo</span>
                </a>
              </div>

              {onNavigateToPortal && (
                <div className="pt-3 border-t border-stone-200 text-xs text-stone-600 flex items-center justify-between">
                  <span>¿Ya tienes código de invitación?</span>
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
                      ¿Para quién es ForeverYou? *
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
                      <option value="familiar">Edición Familiar Especial</option>
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
                    Atención directa · Sin cargos automáticos
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
                        <span>Abrir WhatsApp</span>
                      </a>
                      <a
                        href={buildMailtoInquiryUrl(formInput)}
                        className="px-3.5 py-2 bg-white hover:bg-stone-100 text-stone-900 border border-emerald-400 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5"
                      >
                        <Mail className="w-3.5 h-3.5 text-amber-800" />
                        <span>Enviar por Correo</span>
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
