import React, { useState } from 'react';
import {
  HelpCircle,
  X,
  Shield,
  HeartHandshake,
  Sparkles,
  Lock,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Search,
  CheckCircle2,
  Mic,
  Camera,
  Users,
} from 'lucide-react';

interface FAQItem {
  id: string;
  category: 'legado' | 'privacidad' | 'ia' | 'proceso';
  question: string;
  answer: string;
  highlights?: string[];
}

const FAQ_DATA: FAQItem[] = [
  // Categoría: Legado
  {
    id: 'legado-1',
    category: 'legado',
    question: '¿Por qué es tan importante preservar las historias de vida y el legado familiar?',
    answer:
      'Cada vida contiene un tesoro invaluable de experiencias, valores, aprendizajes y superaciones. Con el paso de los años, muchas de estas vivencias y relatos orales corren el riesgo de olvidarse si no se registran con fidelidad. Preservar este patrimonio testimonial permite que hijos, nietos y futuras generaciones conozcan sus verdaderas raíces, comprendan de dónde vienen y encuentren guía e inspiración en el ejemplo y la sabiduría de sus antecesores.',
    highlights: [
      'Transmisión directa de valores y sabiduría vivida',
      'Preservación de anécdotas, momentos históricos y tradiciones familiares',
      'Un regalo de identidad imperecedero para las próximas generaciones',
    ],
  },
  {
    id: 'legado-2',
    category: 'legado',
    question: '¿Qué tipo de legado se construye a través de este proceso?',
    answer:
      'Más allá de un simple registro de fechas o logros externos, este proyecto busca rescatar el "Legado Moral y Emocional": la manera en que se enfrentaron las dificultades, las decisiones más significativas, las personas que dejaron huella, el amor por la familia y los consejos sinceros que se desean dejar a los seres queridos.',
    highlights: [
      'Legado humano y ético, no solo cronológico',
      'Voz propia del entrevistado con sus expresiones y emociones genuinas',
      'Integración armónica con fotografías históricas familiares',
    ],
  },

  // Categoría: Privacidad
  {
    id: 'privacidad-1',
    category: 'privacidad',
    question: '¿Cómo se protege mi privacidad y la confidencialidad de mis testimonios?',
    answer:
      'La privacidad y el respeto hacia tu familia son nuestra prioridad. Cada entrevista es estrictamente privada y está protegida en la nube mediante enlaces y códigos personales exclusivos. Tu información nunca aparece en buscadores ni es accesible para el público general, y pertenece al 100% a ti y a tu familia.',
    highlights: [
      'Almacenamiento privado y confidencial en la nube',
      'Acceso exclusivo mediante tus códigos o enlaces personales',
      'Cero comercialización: los testimonios nunca se venden ni comparten con terceros',
      'Propiedad absoluta de la familia sobre textos, audios y fotografías',
    ],
  },
  {
    id: 'privacidad-2',
    category: 'privacidad',
    question: '¿Quién puede ver o escuchar lo que respondo?',
    answer:
      'Únicamente las personas expresamente invitadas a la historia (los participantes designados y el administrador familiar encargado de coordinar la memoria). Nadie ajeno a la familia tiene acceso a tus grabaciones de voz, respuestas escritas o fotografías.',
    highlights: [
      'Círculo cerrado y seguro para la familia',
      'No hay enlaces públicos en internet',
      'Aislamiento estricto entre diferentes familias y proyectos',
    ],
  },
  {
    id: 'privacidad-3',
    category: 'privacidad',
    question: '¿Qué ocurre con mis archivos de voz y fotografías originales?',
    answer:
      'Tus archivos de voz y fotografías se conservan intactos con su calidad original. Al concluir la entrevista, se prepara un respaldo completo descargable que reúne todas tus grabaciones de voz, tus fotografías en alta calidad y una copia de tu historia para abrir incluso sin internet y guardarla en tu computadora o memoria portátil.',
    highlights: [
      'Respaldo permanente e independiente de la nube',
      'Descarga directa de audios y fotos originales',
      'Dossier interactivo que funciona sin internet',
    ],
  },

  // Categoría: Inteligencia Artificial
  {
    id: 'ia-1',
    category: 'ia',
    question: '¿Cómo participa la Inteligencia Artificial en la entrevista?',
    answer:
      'La inteligencia artificial actúa como un asistente editorial y de transcripción respetuoso, nunca como un autor independiente. Sus funciones principales son: 1) Pasar tus notas de voz a texto claro y natural, respetando tus giros y palabras exactas; 2) Proponer preguntas amables para profundizar si mencionas un recuerdo valioso; y 3) Ayudar a dar forma armoniosa a tu libro biográfico organizando tus vivencias por etapas de vida.',
    highlights: [
      'Asistente de transcripción y estructuración, no sustituto humano',
      'Fidelidad testimonial estricta: nunca inventa hechos ni altera vivencias',
      'Reconocimiento de voz avanzado en español',
    ],
  },
  {
    id: 'ia-2',
    category: 'ia',
    question: '¿La IA puede inventar recuerdos o modificar lo que dije?',
    answer:
      'No. YouForever aplica un principio estricto de fidelidad biográfica: nunca inventamos anécdotas, nombres ni lugares, ni cambiamos el sentido de tus palabras. Además, siempre conservamos el respaldo literal de cada pregunta con tu respuesta original y el audio exacto que grabaste.',
    highlights: [
      'Principio de fidelidad biográfica innegociable',
      'Doble respaldo: redacción cuidada para tu libro y tus palabras originales intactas',
      'Supervisión y control en manos de la familia',
    ],
  },

  // Categoría: Proceso
  {
    id: 'proceso-1',
    category: 'proceso',
    question: '¿Tengo que responder todo en una sola sesión o hay un límite de tiempo?',
    answer:
      'No hay ninguna prisa. El cuestionario está diseñado para responderse con calma, a tu propio ritmo. Cada respuesta se guarda automáticamente al enviarla. Puedes responder una o dos preguntas al día, reflexionar, platicar con tus seres queridos y retomar la entrevista en cualquier momento ingresando con tu código o enlace de acceso.',
    highlights: [
      'Avance a tu propio ritmo sin prisas',
      'Guardado automático instantáneo',
      'Posibilidad de pausar y retomar cuando lo desees',
    ],
  },
  {
    id: 'proceso-2',
    category: 'proceso',
    question: '¿Qué pasa si no recuerdo algún suceso o fecha?',
    answer:
      'Es completamente natural que no todos los detalles estén frescos en la memoria. Por eso, en cada pregunta tienes la opción de seleccionar "No lo recuerdo". Esta opción marca la pregunta como respondida y te permite avanzar fluidamente sin estrés ni trabas. También puedes editar tus respuestas más adelante si recuerdas algún dato adicional.',
    highlights: [
      'Botón "No lo recuerdo" para avanzar con tranquilidad',
      'Cero penalización por memorias imprecisas',
      'Opción de editar o ampliar respuestas posteriormente',
    ],
  },
  {
    id: 'proceso-3',
    category: 'proceso',
    question: '¿Puedo responder grabando mi voz en lugar de escribir?',
    answer:
      '¡Sí, por supuesto! Sabemos que muchas historias se cuentan mejor platicando. Puedes pulsar el micrófono, grabar tu respuesta con tu propia voz (incluso pausar, revisar y escuchar tu grabación) y el sistema transcribirá tus palabras automáticamente. Ambas opciones (texto y voz) son plenamente válidas y se complementan.',
    highlights: [
      'Grabadora de voz integrada muy fácil de usar',
      'Transcripción automática a texto',
      'Conservación de tu voz original para la posteridad',
    ],
  },
  {
    id: 'proceso-4',
    category: 'proceso',
    question: '¿Cómo y cuándo se genera el libro final de mi historia?',
    answer:
      'A medida que avanzas en tus respuestas y completas las etapas de tu historia, preparamos tu libro biográfico completo organizado por capítulos (Prólogo, Infancia, Juventud, Madurez, Sabiduría y Epílogo). Este libro integra tus fotografías en los capítulos correspondientes y puedes descargarlo para leerlo o imprimirlo.',
    highlights: [
      'Estructura de libro biográfico profesional por capítulos',
      'Integración visual de fotos familiares históricas',
      'Descargable en formato listo para lectura e imprenta',
    ],
  },
];

interface FAQModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FAQModal: React.FC<FAQModalProps> = ({ isOpen, onClose }) => {
  const [activeCategory, setActiveCategory] = useState<'all' | 'legado' | 'privacidad' | 'ia' | 'proceso'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({
    'legado-1': true,
    'privacidad-1': true,
  });

  if (!isOpen) return null;

  const toggleItem = (id: string) => {
    setOpenItems((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const filteredItems = FAQ_DATA.filter((item) => {
    const matchesCategory = activeCategory === 'all' || item.category === activeCategory;
    if (!matchesCategory) return false;
    if (!searchQuery.trim()) return true;

    const q = searchQuery.toLowerCase();
    return (
      item.question.toLowerCase().includes(q) ||
      item.answer.toLowerCase().includes(q) ||
      (item.highlights && item.highlights.some((h) => h.toLowerCase().includes(q)))
    );
  });

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-fadeIn">
      <div
        className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-stone-900 text-stone-100 p-6 sm:p-7 relative border-b border-stone-800 shrink-0">
          <button
            onClick={onClose}
            className="absolute top-5 right-5 text-stone-400 hover:text-white p-2 rounded-lg bg-stone-800/60 hover:bg-stone-800 transition cursor-pointer"
            title="Cerrar preguntas frecuentes"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center space-x-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-amber-700/80 border border-amber-500/40 flex items-center justify-center text-amber-200">
              <HelpCircle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-serif text-xl sm:text-2xl font-bold text-amber-50">
                Preguntas Frecuentes &amp; Privacidad
              </h2>
              <p className="text-xs sm:text-sm text-stone-400">
                El valor de preservar tu legado y la protección integral de tus memorias familiares
              </p>
            </div>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="p-4 sm:p-5 bg-stone-50 border-b border-stone-200 space-y-3 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar en preguntas frecuentes (ej. privacidad, fotos, voz, fechas)..."
              className="w-full pl-10 pr-9 py-2 bg-white border border-stone-300 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 text-stone-800 placeholder:text-stone-400 shadow-2xs"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-2.5 text-stone-400 hover:text-stone-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Category Tabs */}
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            <button
              onClick={() => setActiveCategory('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeCategory === 'all'
                  ? 'bg-stone-900 text-white shadow-xs'
                  : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-100'
              }`}
            >
              Todas ({FAQ_DATA.length})
            </button>
            <button
              onClick={() => setActiveCategory('legado')}
              className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeCategory === 'legado'
                  ? 'bg-amber-800 text-amber-50 shadow-xs'
                  : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-100'
              }`}
            >
              <HeartHandshake className="w-3.5 h-3.5 text-amber-700" />
              <span>Valor del Legado</span>
            </button>
            <button
              onClick={() => setActiveCategory('privacidad')}
              className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeCategory === 'privacidad'
                  ? 'bg-emerald-800 text-emerald-50 shadow-xs'
                  : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-100'
              }`}
            >
              <Shield className="w-3.5 h-3.5 text-emerald-600" />
              <span>Privacidad &amp; Seguridad</span>
            </button>
            <button
              onClick={() => setActiveCategory('ia')}
              className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeCategory === 'ia'
                  ? 'bg-indigo-800 text-indigo-50 shadow-xs'
                  : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-100'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>Uso Ético de la IA</span>
            </button>
            <button
              onClick={() => setActiveCategory('proceso')}
              className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeCategory === 'proceso'
                  ? 'bg-stone-800 text-stone-100 shadow-xs'
                  : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-100'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 text-stone-600" />
              <span>¿Cómo Responder?</span>
            </button>
          </div>
        </div>

        {/* FAQ Accordion List */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-3 flex-1 bg-stone-100/50">
          {filteredItems.length === 0 ? (
            <div className="text-center py-12 text-stone-500 space-y-2">
              <HelpCircle className="w-8 h-8 mx-auto text-stone-400" />
              <p className="text-sm font-semibold">No se encontraron preguntas para «{searchQuery}»</p>
              <p className="text-xs text-stone-400">Prueba con palabras como "privacidad", "audios", "fotos" o "libro".</p>
            </div>
          ) : (
            filteredItems.map((item) => {
              const isOpenItem = !!openItems[item.id];
              return (
                <div
                  key={item.id}
                  className="bg-white rounded-xl border border-stone-200/90 shadow-2xs overflow-hidden transition"
                >
                  <button
                    onClick={() => toggleItem(item.id)}
                    className="w-full text-left p-4 sm:p-4.5 flex items-start justify-between gap-3 hover:bg-stone-50 transition cursor-pointer"
                  >
                    <span className="font-serif font-bold text-sm sm:text-base text-stone-900 leading-snug">
                      {item.question}
                    </span>
                    <span className="text-stone-400 shrink-0 mt-0.5">
                      {isOpenItem ? <ChevronUp className="w-4 h-4 text-amber-700" /> : <ChevronDown className="w-4 h-4" />}
                    </span>
                  </button>

                  {isOpenItem && (
                    <div className="px-4 pb-4 sm:px-4.5 sm:pb-5 pt-1 border-t border-stone-100 space-y-3 text-xs sm:text-sm text-stone-700 leading-relaxed">
                      <p>{item.answer}</p>
                      {item.highlights && item.highlights.length > 0 && (
                        <div className="bg-amber-50/60 rounded-lg p-3 border border-amber-200/60 space-y-1.5">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900 block">
                            Puntos clave:
                          </span>
                          <ul className="space-y-1 text-xs text-stone-700">
                            {item.highlights.map((h, hIdx) => (
                              <li key={hIdx} className="flex items-start space-x-2">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                                <span>{h}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* Privacy Guarantee Banner */}
          <div className="p-4 rounded-xl bg-stone-900 text-stone-200 text-xs flex items-start space-x-3 mt-4 border border-stone-800">
            <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-amber-200 text-xs block mb-0.5">
                Garantía de Confidencialidad y Propiedad Absoluta
              </span>
              <p className="text-stone-300 text-[11px] leading-relaxed">
                Tus vivencias pertenecen exclusivamente a tu familia. YouForever no comercializa, no publica ni comparte ningún dato con redes sociales, motores de búsqueda ni plataformas de terceros. Tu historia está a salvo.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-white border-t border-stone-200 flex items-center justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold rounded-xl shadow-xs transition cursor-pointer"
          >
            Entendido y Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
