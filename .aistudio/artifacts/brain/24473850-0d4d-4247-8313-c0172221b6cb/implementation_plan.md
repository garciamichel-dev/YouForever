# Rediseño Integral del Portal del Participante (Experiencia Cálida y Accesible)

Rediseño visual y ergonómico del Portal del Participante de ForeverYou para personas mayores de 65 años, priorizando la pregunta biográfica y el botón circular protagonista de grabación de voz sin desplazamiento en pantallas móviles, con controles de navegación en una barra inferior fija y agrupación de herramientas administrativas en un encabezado minimalista.

## Decisiones Críticas y Preferencias Confirmadas

> [!IMPORTANT]
> Las siguientes decisiones fueron confirmadas por el usuario en la fase de aclaración y rigen de forma prioritaria el rediseño sin alterar ninguna lógica de negocio, arquitectura ni modelo de datos existente:

- **Botón de Grabación Protagonista**: Ubicado inmediatamente debajo de la pregunta biográfica, centrado horizontalmente y sin encapsularse en tarjetas redundantes. Botón circular amplio con tonos cálidos de ForeverYou y animación de ondas sonoras exclusivamente activa durante la grabación.
- **Acceso Directo en Móvil sin Desplazamiento**: Encabezado ultracompacto y eliminación de bloques administrativos pesados, permitiendo que la pregunta y el micrófono queden a la vista en la primera pantalla en smartphones habituales (375px–430px).
- **Barra de Acción Fija Inferior**: Barra compacta y elegante anclada al pie de la pantalla que contiene «Omitir y continuar» como acción secundaria y «Guardar y continuar» como botón principal destacado, con área segura (`pb-safe`) y espaciado de margen inferior (`pb-28`) para no ocultar contenidos.
- **Menú de Opciones Compacto (Engranaje Superior)**: El encabezado incorpora un único icono de engranaje que despliega «Ajustes», «Privacidad» y, visualmente separada y destacada, «He terminado mi historia» (que abre su correspondiente modal de confirmación y consecuencias).
- **Accesos Rápidos en Encabezado**: Iconos accesibles con contador para «Mis Respuestas Guardadas» e «Historial de Libros PDF».
- **Conservación Absoluta de Funcionalidades**: Se mantienen íntegros todos los flujos de respuesta, autosguardado, notas de voz múltiples con transcripción, carga de fotos con descripciones, profundización autónoma, sub-flujos, re-edición y generación de PDF en Book Studio.

---

## 1. Visión General y Concepto Central

- **Propósito**: Transformar la experiencia del participante para que sienta que ForeverYou lo está escuchando cálidamente en una sobremesa familiar, en lugar de someterlo a un cuestionario burocrático o administrativo.
- **Audiencia Principal**: Adultos mayores (65+ años) y sus familiares entrevistados, quienes requieren tipografías amplias y nítidas, contrastes confortables (WCAG AA), botones táctiles generosos ($\ge 48\text{px}$) y una interfaz libre de distracciones técnicas.
- **Valor Agregado**: Reducción drástica de la fricción cognitiva al ingresar: el participante escucha la pregunta o la lee en tipografía editorial grande, presiona el micrófono grande con un solo toque y narra su memoria con naturalidad.

---

## 2. Experiencia de Usuario y Diseño Visual

### Jerarquía Visual de Pantalla Principal (Paso de Entrevista)

```
┌────────────────────────────────────────────────────────────────────────┐
│ [ForeverYou]                 [Respuestas (12)]  [Libros (2)]  [⚙ Menú] │ <- Encabezado compacto (h-14)
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│                 Etapa: Infancia y Raíces · Pregunta 1 de 100            │ <- Kicker editorial limpio (sin píldoras)
│                                                                        │
│             «¿Cuáles son los primeros recuerdos que conservas          │ <- Pregunta editorial destacada
│                       de la casa de tus abuelos?»                      │    (font-serif, text-2xl/3xl, text-stone-900)
│                                                                        │
│                                  ╭───╮                                 │
│                                  │ 🎙 │                                 │ <- Botón circular protagonista
│                                  ╰───╯                                 │    (w-20 h-20 / w-24 h-24, cálido,
│                     Toca el micrófono para comenzar a narrar           │     ondas activas al grabar)
│                                                                        │
│               [+ Desplegar teclado para escribir tu respuesta]          │ <- Alternativa de texto accesible
│                                                                        │
│               [📷 Añadir Fotografía (1)]   [➕ Información Extra]        │ <- Opciones contextuales compactas
│                                                                        │
│               [ Notas de voz grabadas y transcripción generada ]       │ <- Listado de audios adjuntos
│                                                                        │
├────────────────────────────────────────────────────────────────────────┤
│  [ « Omitir y continuar ]                 [ Guardar y continuar » ]     │ <- Barra inferior fija (h-16 pb-safe)
└────────────────────────────────────────────────────────────────────────┘
```

### Paleta y Tokens de Estilo

- **Lienzo Neutro Cálido (60%)**: Fondo cálido tipo papel editorial (`bg-stone-50` / `#FAF8F5`).
- **Superficies de Lectura (30%)**: Tarjeta de pregunta con fondo blanco marfil (`bg-white`), bordes milimétricos suaves (`border-stone-200/80`), sombras suaves y sutiles (`shadow-xs` / `shadow-sm`).
- **Acentos Cálidos ForeverYou (10%)**: Ámbar terracota profundo (`bg-amber-800` / `#92400E`), acentos esmeralda para éxitos de guardado (`text-emerald-700`), anillos de foco accesibles (`focus-visible:ring-amber-700`).
- **Tipografía**:
  - Títulos y preguntas biográficas: `font-serif` (Playfair Display / Merriweather), tracking suave, balance de líneas (`text-wrap: balance`).
  - Metadatos, etiquetas y controles: `font-sans` (Plus Jakarta Sans / DM Sans) con peso Regular (400) y Semibold (600).
  - Medidas mínimas de texto: ningún texto legible menor a `text-xs` (12px); pregunta en `text-2xl` a `text-3xl` (24px–30px).

### Comportamiento del Botón de Grabación y Estados

1. **Estado Inactivo (Listo para Grabar)**:
   - Botón circular amplio de 80px a 96px, fondo ámbar suave (`bg-amber-100/90 text-amber-900 hover:bg-amber-200 border-2 border-amber-300`).
   - Icono de micrófono centrado de 36px–40px.
   - Texto de guía accesible: *"Toca para comenzar a grabar tu recuerdo"*.
2. **Estado Grabando (En Vivo)**:
   - Botón pulsante con halo animado en tonos terracota/rojo suave (`bg-rose-600 text-white shadow-lg animate-pulse`).
   - Contador de tiempo en vivo (`01:24`) y ondas sonoras acústicas animadas (barras SVG reactivas).
   - Texto accesible: *"Grabando tu voz... Toca para finalizar"*.
3. **Estado Procesando y Transcribiendo**:
   - Icono de spinner suave con texto *"Transcribiendo y optimizando audio..."*.
4. **Reproductor y Notas Guardadas**:
   - Tarjetas de notas de voz ultracompactas con reproducción, transcripción editable integrada y opción de eliminar o regrabar.

### Barra de Acción Inferior Fija

- **Posicionamiento**: `fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-stone-200 px-4 py-3 pb-safe shadow-lg`.
- **Estructura en 2 Columnas / Extremos**:
  - Izquierda: Botón secundario «Omitir y continuar» (`text-stone-600 hover:text-stone-900 px-4 py-3 text-xs md:text-sm font-medium`).
  - Derecha: Botón principal «Guardar y continuar» (`bg-amber-800 hover:bg-amber-900 text-white px-6 py-3 rounded-xl text-sm md:text-base font-semibold shadow-sm flex items-center space-x-2`).
- **Padding de Resguardo**: El contenedor principal lleva `pb-28 md:pb-32` para garantizar que ningún texto, imagen o audio quede oculto detrás de la barra.

### Menú de Engranaje de Ajustes y Privacidad

- Desplegable accesible con `role="menu"` y gestión de clics externos.
- Opciones claras:
  - **Ajustes de Entrevista y Audio**: Permite consultar código de acceso, micrófono predeterminado y sesión.
  - **Aviso de Privacidad y Consentimiento**: Abre el modal de políticas y tratamiento de información.
  - **Línea divisoria**.
  - **«He terminado mi historia»**: Destacado con color ámbar oscuro / advertencia suave, solicitando confirmación modal que explica con claridad el paso a la maquetación y generación del libro PDF.

---

## 3. Decisiones de Producto y Compensaciones

1. **Grabación de Voz sin Tarjeta Adicional vs. Formulario Convencional**:
   - *Decisión*: Ubicar el botón de micrófono directamente bajo la pregunta, sin enmarcarlo en una caja secundaria con bordes pesados.
   - *Justificación*: Elimina la sensación de "llenar un formulario" y maximiza el espacio vertical en pantallas de celular, garantizando que el usuario vea la pregunta y el botón de hablar en un solo vistazo.
2. **Barra Fija Inferior con Margen de Resguardo**:
   - *Decisión*: Pinned bottom bar en móvil y escritorio con `pb-28` en el contenedor padre.
   - *Justificación*: Los adultos mayores suelen desorientarse si el botón para avanzar queda perdido al final de un texto largo o fuera de pantalla. Una barra fija garantiza certeza de acción en todo momento.
3. **Área de Escritura Desplegable y Accesible**:
   - *Decisión*: Mostrar la opción de escribir como una alternativa limpia *"Escribir con el teclado"*, que al abrirse o tener texto existente se expande con contraste nítido y auto-guardado local.
   - *Justificación*: El 80% de los participantes mayores prefiere hablar; aquellos que prefieren escribir o corregir detalles tienen el espacio disponible sin saturar a los que solo desean usar la voz.

---

## 4. Arquitectura de Componentes y Flujo de Interacción

```
┌────────────────────────────────────────────────────────────────────────┐
│                        ParticipantPortal.tsx                          │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Compact Header: Logo + Badges (Respuestas/Libros) + Gear Dropdown │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                   │                                    │
│       ┌───────────────────────────┴────────────────────────────┐      │
│       ▼                                                        ▼      │
│  activeTab === 'interview'                                activeTab    │
│  ┌─────────────────────────────────────────────────────┐  'history'    │
│  │ Question Stage Kicker (Infancia, Adultez...)        │  o 'book'     │
│  │ Large Serif Question Text                           │               │
│  │ Big Hero Microphone (VoiceRecorder.tsx)             │               │
│  │ Optional Textarea (Auto-expanded if has text)       │               │
│  │ Compact Attachment Row (Camera + Additional Info)   │               │
│  │ Attached Audios & Photo Grid List                   │               │
│  │ Fixed Bottom Action Bar (Omitir / Guardar)          │               │
│  └─────────────────────────────────────────────────────┘               │
│                                   │                                    │
│       ┌───────────────────────────┴────────────────────────────┐      │
│       ▼                                                        ▼      │
│  Modals & Drawers:                                        Modals:      │
│  • AdditionalMemoryModal                                  • Privacy    │
│  • FinishStoryConfirmationModal (He terminado mi historia) • Settings  │
└────────────────────────────────────────────────────────────────────────┘
```

### Plan de Verificación de Integridad

- **Verificación de Cero Pérdida Funcional**:
  - Envío y guardado de respuestas por voz y texto (`/api/participant/answer`).
  - Botón «Omitir y continuar» (`handleSaveAnswer(true, 'no')`).
  - Navegación anterior / siguiente con flechas o flujo dinámico.
  - Sub-flujos automáticos (ej. gateway de hijos) y preguntas de profundización.
  - Carga y borrado de fotografías adjuntas (`handleDeletePersistedPhoto`).
  - Incorporación de información adicional (`setShowAdditionalMemoryModal`).
  - Consulta y edición de respuestas guardadas (`activeTab === 'history'`).
  - Descarga y visualización de libros maquetados en PDF (`activeTab === 'book'`).
  - Confirmación de cierre y generación de nueva versión en PDF (`handleFinishStory`).
- **Verificación de Responsividad y Accesibilidad**:
  - Pruebas en viewport móvil (375px y 412px) asegurando pregunta + micrófono en la primera vista.
  - Ausencia de solapamiento entre la barra inferior fija y los contenidos scrollables.
  - Contrastes WCAG AA y áreas táctiles $\ge 44\text{px}$.
- **Verificación de Compilación y Calidad**:
  - Co-ejecución final de `compile_applet` y `lint_applet` con 0 errores.
