# Actualización Integral de «Mi Esencia» y Modo Claro / Oscuro Global en ForeverYou

Esta actualización alinea el comportamiento conversacional de «Mi Esencia» en modo personalizado para que responda exactamente igual que ChatGPT en su sitio web oficial con el Prompt Maestro y el PDF completo, incorpora los controles administrativos y familiares solicitados en `/miesencia`, y añade un conmutador global de **Modo Claro y Modo Oscuro** mediante un ícono interactivo (`Sol` / `Luna`) en todas las páginas de ForeverYou.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> Se han integrado todas tus decisiones confirmadas y el nuevo requerimiento de Modo Claro / Modo Oscuro en todas las páginas de ForeverYou:

- **Decisión Confirmada 1 — Modo Claro y Modo Oscuro en Todas las Páginas de ForeverYou**: Se incorpora un botón con ícono de **Sol / Luna** en los encabezados de todas las vistas de ForeverYou (Barra principal de Administración y Participante, Portal Familiar `/miesencia`, vista comercial `/conoceme`, prueba gratuita `/demo` y pantalla de acceso administrativo), guardando la preferencia del usuario y aplicando pares cromáticos legibles en ambos temas (`@custom-variant dark` en Tailwind v4).
- **Decisión Confirmada 2 — Inicio de Conversación y Paridad con ChatGPT Web**: En `modo_personalizado`, cuando se abre una sesión nueva, **ChatGPT (o el proveedor activo) genera directamente el primer saludo** siguiendo tu Prompt Maestro y el PDF de la historia de vida, eliminando el saludo local preprogramado, los interceptores previos por palabras clave, las plantillas intermedias alrededor del mensaje del usuario y el recorte regex posterior (`sanitizeAvatarResponseText`).
- **Decisión Confirmada 3 — Aportar Recuerdos Nivel B y C**: Al hacer clic en `+ Aportar recuerdo familiar (Nivel B)`, se coloca en el campo de texto la frase sugerida (*"Quiero contarte algo que quiero que recuerdes: "*) lista para que el familiar la complete antes de enviar; de igual forma para Nivel C (*"Quiero contarte algo en confidencia que quede solo entre nosotros: "*).
- **Decisión Confirmada 4 — Control Manual de Uso Mensual**: Desde administración podrás editar manualmente tanto los mensajes consumidos como el límite mensual de un avatar individual, reiniciar su contador a cero, configurar un valor por defecto para nuevos avatares y aplicar un límite/ajuste masivo a todos los avatares activos con un solo clic.
- **Decisión Confirmada 5 — Acceso Directo a `/miesencia`**: La ruta oficial del portal será `/miesencia` (manteniendo compatibilidad con enlaces anteriores `/mi-esencia`) y existirá un botón de acceso directo tanto en la barra de navegación principal de ForeverYou (para el administrador) como en el encabezado de Administración de Mi Esencia.

---

## 1. Overview & Core Concept

- **What It Does**:
  1. **Modo Claro y Modo Oscuro en Todas las Páginas de ForeverYou**:
     - Conmutador interactivo con ícono de **Sol / Luna** disponible en todas las páginas (Administración, Portal del Participante, `/miesencia`, `/conoceme`, `/demo` y Login).
     - Sincronización inmediata con la clase `.dark` en el documento raíz (`<html>`), persistencia en `localStorage` y adaptación armónica de fondos, tarjetas, textos, bordes y logotipos para mantener contraste óptimo tanto en modo claro como en modo oscuro.
  2. **Paridad Exacta con ChatGPT Web (`modo_personalizado`)**:
     - Las instrucciones del sistema (`instructions`) envían únicamente tu **Prompt Maestro** tal cual fue configurado, seguido del **documento PDF íntegro** (todas las preguntas y respuestas literales + transcripciones de voz + memoria de sesiones previas), sin inyectar bloques de `[CONTROLES TÉCNICOS DE INTEGRIDAD]` que alteren el estilo.
     - Cada mensaje del familiar se envía como un turno limpio `{ role: 'user', content: mensajeExacto }`, sin envolverlo en encabezados técnicos ni duplicar el historial en texto plano dentro del turno final.
     - Se eliminan los interceptores locales previos y el filtro Regex posterior en `modo_personalizado`, y se amplía el margen de generación (`max_output_tokens: 4096` sin forzar `temperature` artificial) para que las respuestas tengan la misma riqueza, extensión y tono que en ChatGPT Web.
     - El saludo inicial de cada nueva sesión en `modo_personalizado` es generado en vivo por OpenAI/Gemini a partir de tu Prompt Maestro.
  3. **Borrado Real y Definitivo con Advertencia**:
     - Al pulsar «Eliminar Perfil y PDF» en *Perfiles Biográficos (Entidad A), Motor IA y PDFs Archivados*, se muestra un modal de advertencia detallando qué se eliminará (perfil, PDF compilado, testimonios y, si no quedan más perfiles, la suscripción y códigos del avatar).
     - Al confirmar, se eliminan en paralelo todos los documentos en Firestore, en disco y se registra el ID en una lista persistente de bajas definitivas (`deletedIds`) para garantizar que nunca se reconstruyan ni reaparezcan al recargar o reiniciar el servidor.
  4. **Ajuste Manual de Uso Mensual (Individual, Por Defecto y Masivo)**:
     - En la pestaña de Suscripciones y Configuración podrás modificar manualmente para cada avatar sus `mensajes usados este mes` y su `cuota mensual máxima`, reiniciar el contador, fijar la cuota mensual por defecto y aplicar un mismo número configurable a todos los avatares activos.
  5. **Edición Manual Completa de Planes y Precios**:
     - Cada plan activo cuenta con modo de edición manual para modificar nombre, código, descripción, precio, moneda, unidad y valor de duración, días de gracia, máximo de familiares autorizados, cuota mensual por avatar, cuota diaria por familiar, interruptores de memorias Nivel B, Nivel C e instantáneas, y estado activo/inactivo.
  6. **Códigos Familiares Modificables y Agrupados por Avatar**:
     - Los *Códigos Personales y Enlaces Privados Directos* se presentan filtrados y agrupados por Avatar. Al hacer clic sobre el nombre de un Avatar, se despliegan todos los códigos asociados a él.
     - Cada código familiar permite edición manual en línea (modificar el código personal `FY-...`, nombre del familiar, parentesco, apodo afectuoso y correo electrónico), actualizando su hash de acceso y su enlace privado `/miesencia?code=...`.
  7. **Aviso de Transparencia de Aceptación Única**:
     - Una vez que el familiar acepta el *Aviso de Transparencia y Recreación Testimonial*, queda registrado de forma persistente en el servidor (`consentAcceptedAt` en su perfil de interlocutor y credencial) y en el navegador (`localStorage`), por lo que jamás vuelve a solicitarse en ingresos posteriores.
  8. **Menú de Preguntas Frecuentes (FAQ) en Mi Esencia y Sugerencias Adaptativas**:
     - Se incorpora dentro del portal familiar `/miesencia` un botón y modal de **Preguntas Frecuentes de Mi Esencia** que explica de forma clara y cálida qué es **Nivel A • Inmutable**, **Nivel B • Familiar**, **Nivel C • Privado** y paso a paso cómo **Aportar recuerdos y recursos en los niveles B y C**.
     - Las sugerencias opcionales debajo del chat rotan dinámicamente y se adapten a los temas reales e hitos biográficos del avatar con quien se conversa y al parentesco del familiar.
  9. **Limpieza del Registro de Conmutaciones de Respaldo Automático**:
     - Se añade el botón **«Limpiar y Borrar Registro»** en el *Registro Administrativo de Conmutaciones de Respaldo Automático* para vaciar la bitácora tanto en memoria y disco como en la base de datos.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  - **Conmutación de Tema Claro / Oscuro**: En cualquier página de ForeverYou, el usuario pulsa el botón con el ícono de **Sol** (para pasar a modo claro) o **Luna** (para pasar a modo oscuro). Toda la interfaz transiciona de inmediato sin perder el estado de la página ni de la conversación activa.
  - **Flujo de Conversación Idéntica a ChatGPT (`/miesencia`)**: El familiar ingresa con su enlace o código en `/miesencia`. Si ya aceptó el aviso de transparencia anteriormente, entra directo a su conversación. Al iniciar una nueva conversación en modo personalizado, el avatar lo saluda siguiendo las instrucciones exactas del Prompt Maestro. El familiar puede abrir el menú **«Preguntas Frecuentes (Niveles A, B y C)»** en el encabezado, usar sugerencias dinámicas personalizadas o pulsar **«+ Aportar recuerdo familiar (Nivel B)»**, lo que inserta `"Quiero contarte algo que quiero que recuerdes: "` en la caja de texto para que complete su recuerdo.
  - **Flujo Administrativo de Borrado, Cuotas, Planes y Códigos**:
    - En **Avatares**, al pulsar «Eliminar Perfil y PDF», aparece un cuadro de confirmación explícito en pantalla antes de borrar definitivamente el registro de la BDD.
    - En **Suscripciones**, una nueva sección permite ajustar manualmente el uso mensual (`mensajes usados` / `límite mensual`) por avatar o aplicar un límite global a todos los avatares.
    - En **Planes y Precios**, cada tarjeta de plan incluye un botón «Editar Plan» que abre todos sus parámetros para modificación manual inmediata.
    - En **Familiares y Códigos**, los códigos aparecen organizados por Avatar (desplegables al hacer clic en el nombre del avatar) con un botón «Editar Código / Datos» en cada familiar.
- **Visual Identity & Theme**:
  - Se conserva la estética editorial cálida de ForeverYou en ambos modos:
    - **Modo Claro**: Lienzo principal en tonos piedra cálidos (`stone-50` / `stone-100`), tarjetas en blanco (`white`) con bordes sutiles (`stone-200`), texto principal en `stone-900` y acentos dorados/ámbar (`amber-700` / `amber-600`).
    - **Modo Oscuro**: Lienzo principal en `stone-950`, superficies estructurales en `stone-900` con bordes `stone-800`, texto principal en `stone-100` y acentos en `amber-400` / `amber-300`.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Arquitectura Dual-Theme con `@custom-variant dark` en Tailwind v4**
  - *Chosen Approach*: Configurar `@custom-variant dark (&:where(.dark, .dark *));` en la hoja de estilos global junto con un contexto/hook de tema compartido (`ThemeContext` + botón `ThemeToggleButton`) y pares explícitos de superficie/texto/borde en todas las vistas.
  - *Why*: Garantiza contraste legible en todas las pantallas (Administración, Participante, Conóceme, Demo y `/miesencia`) sin romper botones ni insignias.
- **Decision 2: Envío Limpio de Prompt + PDF a la API de OpenAI / Gemini en Modo Personalizado**
  - *Chosen Approach*: Colocar en `instructions` únicamente el Prompt Maestro resuelto más el documento PDF completo de la entrevista (y memoria/continuidad), y enviar los turnos de conversación como mensajes puros `{ role: 'user' | 'assistant', content }` sin plantillas intermedias ni filtros locales.
  - *Why*: Garantiza que el modelo reciba exactamente la misma entrada contextual que cuando el administrador pega su prompt y sube el PDF en la interfaz web de ChatGPT.
- **Decision 3: Registro Persistente de Eliminados (`deletedIds`) + Borrado Paralelo en BDD**
  - *Chosen Approach*: Ejecutar las bajas en Firestore mediante `Promise.all` y mantener un conjunto persistente de IDs eliminados para que la sincronización inicial nunca reimporte documentos antiguos.
  - *Why*: Evita que los perfiles, avatares o PDFs borrados vuelvan a aparecer tras recargar la página o reiniciar el servidor.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                 BARRA PRINCIPAL FOREVERYOU & PÁGINAS PÚBLICAS                │
│  [Panel Admin] [Participante] [Conóceme] [Demo] [Mi Esencia ↗] [☀/☾ Tema]    │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │
        ┌───────────────────────┴────────────────────────┐
        ▼                                                ▼
┌──────────────────────────────────────┐  ┌────────────────────────────────────┐
│     PORTAL FAMILIAR (/miesencia)     │  │   ADMINISTRACIÓN DE MI ESENCIA     │
│ • Botón de Tema Claro/Oscuro (☀/☾)   │  │ • Modal de advertencia y borrado   │
│ • Consentimiento único persistente   │  │   definitivo en BDD (Firestore)    │
│ • Botón y Modal FAQ (Niveles A/B/C)  │  │ • Control manual de uso mensual    │
│ • Saludo inicial vía Prompt Maestro  │  │   (individual, defecto y global)   │
│ • Sugerencias dinámicas por avatar   │  │ • Editor completo de Planes        │
│ • Botón Nivel B: "Quiero contarte    │  │ • Códigos agrupados por Avatar     │
│   algo que quiero que recuerdes: "   │  │   y editables manualmente          │
│                                      │  │ • Limpiar bitácora de conmutación  │
└──────────────────┬───────────────────┘  └─────────────────┬──────────────────┘
                   │                                        │
                   └───────────────────┬────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                ORQUESTADOR CONVERSACIONAL (MODO PERSONALIZADO)               │
│  • System Instructions = [Prompt Maestro Exacto] + [PDF Historia Completa]   │
│                          + [Memoria Nivel B/C y Continuidad de Sesión]       │
│  • Turnos Limpios      = Historial real {role, content} + Pregunta directa   │
│  • Sin interceptores locales previos ni recortes regex posteriores           │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - `ThemeContext`: estado global `'light' | 'dark'` sincronizado con `document.documentElement.classList.toggle('dark', ...)` y `localStorage.getItem('foreveryou_theme')`.
  - `MiEsenciaInterlocutor` y `MiEsenciaAccessCredential`: persisten `consentAcceptedAt` en primera aceptación y permiten actualizar `personalCodePlain`, `codeHash`, `privateLinkPath` (`/miesencia?code=...`), `fullName`, `relationshipToPerson`, `affectionateCallName` y `email`.
  - `MiEsenciaGlobalConfig`: incorpora `defaultMonthlyMessageQuota` editable para nuevos avatares.
  - `MiEsenciaStore`: incorpora `deletedRegistry` (`persons`, `subscriptions`, `pdfs`, `credentials`) en disco y Firestore (`mi_esencia_config/deleted_registry`), más métodos para:
    - Actualizar uso mensual individual o masivo (`updateSubscriptionMonthlyUsage`, `applyMonthlyQuotaToAllSubscriptions`).
    - Editar planes existentes (`savePlan` con todos los campos).
    - Editar credenciales/códigos familiares (`updateInterlocutorAndCredential`).
    - Limpiar registros de conmutación (`clearFallbackLogs`).
