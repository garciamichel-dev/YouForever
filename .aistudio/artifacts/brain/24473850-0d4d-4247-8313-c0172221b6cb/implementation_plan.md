# Portal del Entrevistado: Sesión Persistente, Cierre de Sesión, Botón de Fotografías y Aceptación Breve de Privacidad

Este cambio garantiza que el entrevistado mantenga su sesión activa y recupere exactamente la pregunta y el borrador donde se quedó al actualizar o cerrar la página, añade la opción de cerrar sesión dentro de **Ajustes & Privacidad**, actualiza el botón de fotografías a **«Añadir fotografías o recuerdos»** centrado y sin subrayado, y simplifica la casilla de aceptación del aviso de privacidad.

### User Review & Critical Decisions

> [!IMPORTANT]
> Se han integrado tus respuestas de clarificación junto con los dos ajustes visuales y de texto solicitados para el Portal del Entrevistado.

- **Decisión Confirmada 1 (Alcance de Restauración)**: Al recargar o volver a abrir la página, el sistema restaurará automáticamente la sesión activa del entrevistado, la pregunta exacta en la que se encontraba y cualquier borrador de texto en curso no enviado.
- **Decisión Confirmada 2 (Ubicación de Cerrar Sesión)**: El botón para cerrar sesión estará disponible dentro de **Ajustes & Privacidad** tanto en la cabecera superior del panel como en una sección dedicada dentro de la pestaña *Mi privacidad y autorizaciones*.
- **Decisión Confirmada 3 (Resguardo de Borradores al Cerrar Sesión)**: Si el entrevistado cierra su sesión mientras tiene texto sin enviar en la pregunta actual, ese borrador se conservará localmente para restaurarse en cuanto vuelva a iniciar sesión.
- **Decisión Confirmada 4 (Botón de Fotografías)**: El botón que actualmente dice «Cargar Fotografía» cambiará su texto a **«Añadir fotografías o recuerdos»**, eliminando el subrayado y alineándose de forma centrada en su contenedor.
- **Decisión Confirmada 5 (Casilla Breve de Aviso de Privacidad)**: Al aceptar el aviso de privacidad, la casilla única mostrará el texto breve: **«Confirmo que soy [NOMBRE COMPLETO] y he leído y acepto el aviso de privacidad»**.

---

### 1. Overview & Core Concept

- **What It Does**:
  1. Mantiene abierta la sesión del entrevistado en el navegador para que no pierda su acceso al actualizar (`F5`) o cerrar y reabrir la ventana.
  2. Guarda en tiempo real la posición de la pregunta actual y el borrador de respuesta en curso para retomar sin fricción donde se quedó.
  3. Permite cerrar sesión explícitamente desde **Ajustes & Privacidad**, limpiando la sesión activa pero conservando los borradores pendientes para el próximo ingreso.
  4. Presenta el botón **«Añadir fotografías o recuerdos»** centrado y sin texto subrayado.
  5. Simplifica la casilla de aceptación del aviso de privacidad a una confirmación clara y directa con el nombre completo del entrevistado.
- **Target Audience / Persona**: Personas entrevistadas (padres, abuelos, familiares) que relatan sus memorias en varias sesiones y requieren una experiencia cálida, clara y libre de obstáculos técnicos.
- **Key Value**: Elimina la frustración de volver a introducir códigos de acceso o perder respuestas a medio escribir al cerrar el navegador, y hace más legibles tanto la carga de recuerdos fotográficos como el consentimiento de privacidad.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Ingreso y Persistencia Automática**: Cuando el entrevistado ingresa con su código o enlace personal, su sesión queda activa en el navegador. Si actualiza la página o la vuelve a abrir más tarde, entra directamente a la pregunta exacta donde estaba con su borrador de texto intacto.
  2. **Aceptación Breve del Aviso de Privacidad**: En la pantalla previa al inicio de la entrevista, el participante marca un único checkbox con el texto: *«Confirmo que soy [NOMBRE COMPLETO] y he leído y acepto el aviso de privacidad»* y pulsa confirmar para iniciar.
  3. **Adición de Fotografías o Recuerdos**: Debajo del área de respuesta de cada pregunta, el botón aparece centrado, sin subrayado, con el texto **«Añadir fotografías o recuerdos»**.
  4. **Cierre de Sesión Voluntario**: Cuando el entrevistado abre **Ajustes & Privacidad**, puede pulsar **«Cerrar sesión»** desde la barra superior del panel o desde el bloque final de la pestaña *Mi privacidad y autorizaciones*, regresando a la pantalla de ingreso de código.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Editorial cálido y accesible (monografía biográfica familiar).
  - *Color Palette & Mood*: Superficies en papel cálido (`stone-50` / `white`), acentos principales en ámbar profundo (`amber-700` / `amber-800`) y bordes sutiles (`stone-200`).
  - *Typography & Hierarchy*: Encabezados editoriales en serif y controles interactivos limpios en sans-serif de una sola línea, sin subrayados innecesarios en botones.
  - *Component Styling & Layout*: El contenedor del botón **«Añadir fotografías o recuerdos»** utilizará alineación flexible centrada (`flex justify-center`), manteniendo bordes suaves y contraste claro.
- **Interactive Feedback & Motion**:
  - Indicador discreto cuando se recupera un borrador guardado al reabrir la sesión.
  - Confirmación clara al cerrar sesión desde **Ajustes & Privacidad** indicando que el progreso y los borradores quedaron resguardados.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Separación entre Credencial de Sesión Activa y Borradores por Participante**
  - *Chosen Approach*: Almacenar la credencial de sesión activa en una clave independiente del progreso y de los borradores de cada pregunta (`participantId + questionId`).
  - *Why*: Permite que al pulsar «Cerrar sesión» se cierre el acceso automático en el navegador, pero cuando el entrevistado vuelva a ingresar su código más adelante recupere intactos tanto la pregunta donde iba como el texto que estaba escribiendo.
  - *Alternatives Considered*: Borrar todo el almacenamiento local al cerrar sesión (descartado porque perdería el borrador en curso que el usuario pidió conservar).
- **Decision 2: Declaración Breve en Casilla de Consentimiento**
  - *Chosen Approach*: Actualizar el generador de la declaración de consentimiento para que muestre y registre exactamente `"Confirmo que soy [NOMBRE COMPLETO] y he leído y acepto el aviso de privacidad"`, manteniendo intactos los botones para consultar el aviso simplificado e integral.
  - *Why*: Reduce la fatiga visual para adultos mayores y familiares sin perder la confirmación expresa de identidad y aceptación del aviso.

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:
```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Navegador del Entrevistado                       │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │               Almacén Persistente de Sesión y Avance              │  │
│  │  • Sesión Activa (token resuelto, participantId, interviewId)     │  │
│  │  • Progreso Actual (currentQuestionId, activeTab, completion)     │  │
│  │  • Borrador por Pregunta (answerText, branchChoice, updatedAt)    │  │
│  └───────────────▲───────────────────────────────────▲───────────────┘  │
│                  │ Lectura / Escritura               │ Limpieza de      │
│                  ▼ Automática                        │ Sesión Activa    │
│  ┌───────────────────────────────────┐   ┌───────────┴───────────────┐  │
│  │     Portal del Entrevistado       │──▶│   Ajustes & Privacidad    │  │
│  │  • Auto-restauración al cargar    │   │  • Botón "Cerrar sesión"  │  │
│  │  • Sincronización de borrador     │   │    en cabecera superior   │  │
│  │  • Botón centrado sin subrayado:  │   │  • Tarjeta "Cerrar sesión"│  │
│  │    "Añadir fotografías o          │   │    en pestaña Privacidad  │  │
│  │     recuerdos"                    │   └───────────────────────────┘  │
│  └───────────────┬───────────────────┘                                  │
│                  │                                                      │
│                  ▼                                                      │
│  ┌───────────────────────────────────┐                                  │
│  │  Pantalla de Aviso de Privacidad  │                                  │
│  │  • Checkbox con texto breve:      │                                  │
│  │    "Confirmo que soy [NOMBRE] y   │                                  │
│  │     he leído y acepto el aviso    │                                  │
│  │     de privacidad"                │                                  │
│  └───────────────────────────────────┘                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - **Active Session State**: Guarda el token validado y el identificador del participante para rehidratar la sesión automáticamente al montar la aplicación o recargar la página.
  - **Participant Progress State**: Registra `currentQuestionId`, `activeTab` y `showCompletionScreen` asociados al `participantId`.
  - **Question Draft State**: Registra `answerText` y `branchChoice` indexados por `participantId` y `questionId`. Se limpia automáticamente cuando la respuesta de esa pregunta es enviada y confirmada por el servidor.

- **Interactive Component & State Mapping**:
  - **Inicio / Recarga de Página**: Si no hay parámetro `?token=` en la URL pero existe una sesión activa guardada, el contenedor principal mantiene la vista del Portal del Entrevistado y carga la sesión automáticamente, posicionándose en la pregunta guardada y restaurando el borrador en curso.
  - **Edición en Tiempo Real**: Cada cambio en el cuadro de texto de la pregunta actual o selección de rama actualiza el borrador local de esa pregunta. Al enviar o saltar la pregunta con éxito, se elimina el borrador local correspondiente.
  - **Acción «Cerrar sesión» en Ajustes & Privacidad**: Guarda el último estado del borrador actual, elimina la clave de sesión activa, limpia cualquier `?token=` o `?code=` de la barra de direcciones, cierra el modal administrativo y regresa a la vista de ingreso de código de acceso.
  - **Componente de Carga de Fotografías**: Renderiza el botón colapsado dentro de un contenedor centrado (`flex justify-center pt-1`) con la etiqueta exacta `Añadir fotografías o recuerdos` y sin la clase `underline`.
  - **Componente de Consentimiento de Privacidad**: Renderiza el checkbox único con el texto `Confirmo que soy ${participantName} y he leído y acepto el aviso de privacidad` y envía la confirmación al servidor al pulsar el botón de inicio.
