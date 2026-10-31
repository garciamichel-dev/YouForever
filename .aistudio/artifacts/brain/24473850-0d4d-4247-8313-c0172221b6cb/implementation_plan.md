# Transcripción Fidedigna sin Invenciones y Diagnóstico de Calidad de Audio

Este plan implementa un sistema de protección contra invenciones (alucinaciones) en la transcripción de voz, monitoreo en tiempo real durante los primeros 30 segundos de grabación y alertas claras con recomendaciones acústicas y recordatorio del uso del teclado cuando el audio presenta ruido de fondo, volumen insuficiente o voz ininteligible.

## Revisión del Usuario y Decisiones Confirmadas

> [!IMPORTANT]
> Se han integrado las decisiones confirmadas para garantizar que el sistema jamás invente texto y guíe con calidez al participante cuando existan problemas de audio.

- **Decisión Confirmada 1 (Verificación en vivo a los 30 segundos)**: Si transcurren 30 segundos de grabación continua sin detectar palabras legibles ni señal vocal clara, el grabador **pausará automáticamente la grabación** y mostrará una tarjeta de alerta con opciones para cancelar la grabación, revisar el micrófono o lugar, reanudar, o escribir directamente con el teclado.
- **Decisión Confirmada 2 (Audios sin palabras comprensibles al enviar)**: Cuando el audio enviado sea ininteligible o solo contenga silencio/ruido, **se conservará el archivo de audio grabado**, pero **la transcripción quedará completamente vacía** (sin inventar ninguna palabra) y se mostrará una alerta explicativa invitando a grabar de nuevo en un sitio silencioso o escribir con el teclado.
- **Decisión Confirmada 3 (Audios con ruido de fondo pero frases audibles)**: Cuando se detecte ruido ambiental pero existan fragmentos comprensibles, el sistema **transcribirá exclusivamente las palabras audibles** sin completar ni adivinar el resto, acompañando el resultado con un aviso preventivo de ruido de fondo.

---

## 1. Visión General y Concepto Principal

- **Qué hace**: Elimina por completo las historias inventadas por el modelo de transcripción cuando un audio es silencioso o ruidoso, añade un detector en vivo que evalúa los primeros 30 segundos de grabación, y ofrece alertas diagnósticas empáticas y accionables.
- **Público Objetivo**: Adultos mayores y familiares que narran sus memorias biográficas y que pueden enfrentarse a micrófonos mal configurados, entornos ruidosos o volumen de voz bajo.
- **Valor Principal**: Preserva la fidelidad absoluta del testimonio biográfico («nunca inventar nada») y evita que el participante pierda varios minutos hablando sin que su voz esté siendo comprendida.

---

## 2. Experiencia de Usuario y Diseño Visual

- **Flujos Clave de Usuario**:
  1. **Monitoreo Preventivo a los 30 Segundos de Grabación**:
     - Al pulsar *«Pulsa y cuéntanos tu recuerdo»*, el grabador monitorea simultáneamente la actividad vocal en el espectro de frecuencias de voz humana y el reconocimiento de palabras en vivo del navegador.
     - Si al llegar a los **30 segundos** no se ha identificado ninguna palabra legible o la señal vocal ha permanecido en silencio/ruido constante, la grabación pasa automáticamente a estado **En Pausa** y despliega una alerta destacada:
       *«Hemos pausado tu grabación porque tras 30 segundos no hemos logrado escuchar ninguna palabra con claridad. Te sugerimos revisar tu micrófono, acercarte un poco más o moverte a un lugar sin ruido de fondo. También puedes cancelar esta grabación y escribir tu respuesta directamente usando el teclado.»*
     - Incluye botones directos: **«Cancelar grabación»**, **«Ir al cuadro de texto (usar teclado)»** y **«Continuar grabando»**.
  2. **Diagnóstico Acústico al Enviar el Audio**:
     - Al pulsar *«Enviar y Transcribir»*, el servidor analiza el audio sin recibir el texto de la pregunta como guía narrativa (evitando que el modelo invente respuestas a la pregunta cuando no escucha voz) y devuelve un dictamen estructurado de calidad:
       - **`clear` (Voz clara)**: Inserta la transcripción fidedigna en el cuadro de respuesta.
       - **`noisy` (Con ruido de fondo pero comprensible)**: Inserta únicamente las frases claramente audibles y muestra una alerta ámbar sugiriendo trasladarse a un lugar más silencioso en las siguientes grabaciones o complementar el texto con el teclado.
       - **`unintelligible` / `silent` (Sin palabras legibles o solo silencio/ruido)**: Guarda el archivo de voz en la lista de audios pero **deja el texto vacío**, mostrando una alerta visible que informa que no se logró comprender ninguna palabra legible, sugiere revisar el micrófono o el ruido ambiental, y ofrece un botón para enfocar el cuadro de texto y escribir con el teclado.

- **Identidad Visual y Tema**:
  - *Dirección Estética*: Editorial cálido y accesible (*Archival Warm Paper*), coherente con el diseño de Legado Digital.
  - *Paleta de Colores*:
    - Alertas preventivas de ruido o pausa a los 30s en tonos ámbar cálido (`bg-amber-50`, `border-amber-300`, `text-amber-950`) con iconos de alto contraste.
    - Alertas de audio sin palabras comprensibles en tono terracota/rosa suave (`bg-rose-50`, `border-rose-300`, `text-rose-950`) sin resultar alarmantes pero claramente distinguibles.
  - *Tipografía y Jerarquía*: Encabezados claros en `font-serif font-bold`, cuerpo explicativo en `font-sans text-xs sm:text-sm leading-relaxed` para lectura cómoda por adultos mayores, y botones con etiquetas explícitas.

---

## 3. Decisiones Clave de Producto y Justificación

- **Decisión 1: Aislamiento del contexto de la pregunta durante la transcripción acústica**
  - *Enfoque elegido*: Eliminar el texto de la pregunta y el nombre del participante del prompt de transcripción multimodal y exigir un esquema JSON estructurado con clasificación acústica (`clear`, `noisy`, `unintelligible`, `silent`).
  - *Por qué*: Cuando un modelo multimodal recibe la pregunta biográfica junto con un audio ininteligible o en silencio, tiende a «responder la pregunta» inventando una historia plausible. Al aislar la tarea como transcripción acústica pura con validación anti-alucinación y temperatura `0.0`, el modelo solo puede transcribir fonemas reales o reportar `unintelligible` / `silent`.
- **Decisión 2: Detección híbrida a los 30 segundos (Reconocimiento de voz en vivo + Energía vocal)**
  - *Enfoque elegido*: Combinar la API nativa de reconocimiento de voz del navegador (`SpeechRecognition` / `webkitSpeechRecognition`) con un detector de picos de voz humana en el analizador de frecuencias (`AudioContext` + `AnalyserNode`).
  - *Por qué*: En navegadores que soportan `SpeechRecognition` (Chrome, Edge, Safari), el sistema sabe con exactitud si se pronunció al menos una palabra legible en los primeros 30 segundos; en navegadores sin soporte de `SpeechRecognition`, el analizador espectral detecta si hubo modulación real de voz o únicamente silencio/ruido estacionario.

---

## 4. Arquitectura Técnica y Estrategia de Datos

- **Diagrama de Arquitectura y Flujo de Diagnóstico de Voz**:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        GRABADOR DE VOZ (Cliente)                           │
│                                                                            │
│  ┌──────────────────────────────┐     ┌─────────────────────────────────┐  │
│  │ Monitor en Vivo (0s -> 30s)  │     │ Alertas de Calidad y Teclado    │  │
│  │ • SpeechRecognition (palabras│────▶│ • Pausa automática a los 30s    │  │
│  │   legibles detectadas)       │     │ • Sugerencia contra ruido/mic   │  │
│  │ • Analizador de energía vocal│     │ • Botón "Escribir con teclado"  │  │
│  └──────────────────────────────┘     └─────────────────────────────────┘  │
└───────────────────────────────────┬────────────────────────────────────────┘
                                    │ POST /api/participant/audio/upload
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                 SERVICIO DE TRANSCRIPCIÓN ESTRICTA (Servidor)              │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Analizador Acústico Multimodal (Sin contexto de pregunta, Temp 0.0)  │  │
│  │ • Clasifica calidad: "clear" | "noisy" | "unintelligible" | "silent" │  │
│  │ • Filtro anti-invención: prohíbe inventar historias o rellenar       │  │
│  │ • Si "unintelligible"/"silent": transcription = "" (audio se guarda) │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Modelo de Respuesta de Transcripción y Estado**:
  - El servicio de transcripción devolverá un objeto estructurado:
    - `transcription`: Texto transcrito (vacío `""` cuando no hay palabras legibles).
    - `audioQuality`: `'clear' | 'noisy' | 'unintelligible' | 'silent'`.
    - `qualityMessage`: Mensaje claro en español explicando la causa (ruido de fondo, voz muy baja o sin palabras comprensibles) y la sugerencia correspondiente.
  - En el portal del participante, cuando `audioQuality` sea `'unintelligible'` o `'silent'`, el archivo de audio se conservará en la lista de grabaciones, no se insertará texto inventado en el área de respuesta, y se mostrará la alerta orientando al usuario a cancelar/repetir en un lugar sin ruido o escribir su recuerdo usando el teclado.
