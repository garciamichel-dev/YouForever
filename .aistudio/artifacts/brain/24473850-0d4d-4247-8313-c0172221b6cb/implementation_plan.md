# Plan de Implementación — Identidad Visual Oficial ForeverYou (4 Variantes) + Corrección Ortográfica y Congruencia en Libros PDF

## 1. Decisiones Confirmadas por el Usuario

### A. Sistema de Logotipo Oficial ForeverYou (`F + ∞ + Y`)
1. **Páginas del libro PDF y del visualizador con logotipo**:
   - Incluir el logotipo oficial en **Portada (Página 1)**, **Portadilla / Dedicatoria (Página 2)** y **Página Final de Cierre (Última página)**.
2. **Formato del sello en la esquina inferior derecha de la última página**:
   - Mostrar el **Isotipo infinito `F∞Y` junto al texto `ForeverYou`** (`[Isotipo F∞Y] ForeverYou`).
3. **Color del logotipo dentro de las portadas y diseños interiores del PDF**:
   - **Adaptar el color del logotipo al color de acento y contraste de cada plantilla** (`coverPalette.subtextHex` / `coverPalette.accentHex` en portada e `interiorStyle.accentHex` / `interiorStyle.mutedHex` en páginas interiores).
4. **Alcance respecto a libros PDF anteriores vs. nuevos**:
   - **Aplicar el nuevo logotipo únicamente a los PDFs nuevos que se generen a partir de ahora** (`useOfficialForeverYouLogo: true`), manteniendo sin cambios visuales de logotipo las versiones de PDF guardadas con anterioridad.
5. **Aplicación de las 4 variantes en toda la plataforma web**:
   - Aplicar las 4 variantes del tablero en **toda la web, pantallas de acceso, favicon y nuevos PDFs**:
     - **App Icon**: Favicon del navegador (`/favicon-foreveryou.svg`), `apple-touch-icon` e insignias compactas.
     - **Horizontal Lockup**: Barra de navegación principal (`Navbar`), cabecera fija del Portal del Participante, cabecera de `/conoceme`, cabecera de `/demo` y barra del Estudio Editorial.
     - **Principal / Vertical Lockup**: Pantallas de acceso/login (Participante y Administrador), pantallas de Consentimiento Informado y Bienvenida de `/demo`.
     - **Print / Monochrome**: Sello editorial adaptable en Portada, Portadilla y Página Final de Cierre de todos los nuevos libros PDF y su visualizador 1:1.

### B. Revisión Ortográfica, Gramatical y Congruencia Lógica
1. **Contextualización natural con cada pregunta**: Integrar respuestas breves o elípticas usando el contexto de la pregunta principal y sus profundizaciones, sin frases robóticas.
2. **Revisión integral en los 3 estilos (A, B y C)**: Corregir ortografía (`b/v`, `s/c/z`, `h`, tildes), preservar preposiciones tras vocales acentuadas (`salía a jugar`, `quería a mi mamá`, `día a día`) y mantener el 100 % de los hechos reales.
3. **Saneamiento de texto en versiones guardadas**: Limpiar frases robóticas heredadas y errores ortográficos al visualizar o descargar versiones guardadas.

---

## 2. Arquitectura de Cambios

1. **Componente Vectorial y Motor Canvas de Logotipo (`src/components/ForeverYouLogo.tsx` y `src/utils/foreverYouLogoDraw.ts`)**:
   - Implementar el trazado vectorial exacto del monograma infinito curvado `F + ∞ + Y` y la tipografía geométrica `ForeverYou` en sus 4 variantes (`stacked`, `horizontal`, `app_icon`, `print_monochrome`).
   - Implementar `drawForeverYouInfinitySymbol` y `drawForeverYouHorizontalLockup` en Canvas 2D para que el generador de PDF en alta definición (300 DPI) dibuje exactamente el mismo logotipo con nitidez vectorial en cualquier formato (`A5`, `6x9"`, `Carta`).
2. **Favicon e Ícono Web (`public/favicon-foreveryou.svg` e `index.html`)**:
   - Configurar la variante **App Icon** (cuadrado redondeado azul marino `#0B192E` con monograma `F∞Y` blanco) como icono oficial de la pestaña del navegador.
3. **Nuevos Libros PDF y Visualizador 1:1 (`src/logic/demoStoryRules.ts`, `src/components/DemoBookPageRenderer.tsx`, `src/utils/demoPdfGenerator.ts`)**:
   - Añadir la propiedad `useOfficialForeverYouLogo?: boolean` en `DemoManuscript` y `ComposedBook` (activa por defecto en todos los manuscritos generados a partir de ahora, e inactiva en versiones históricas que no contaban con dicho marcador).
   - Renderizar el sello adaptable en **Portada (Página 1)**, **Portadilla (Página 2)** y **Página Final de Cierre** tanto en `DemoBookPageRenderer.tsx` como en `demoPdfGenerator.ts`.
4. **Actualización Integral de Vistas Web**:
   - `Navbar.tsx`, `ParticipantPortal.tsx`, `AdminLoginView.tsx`, `ConsentScreen.tsx`, `PrivacyConsentScreen.tsx`, `ConocemeView.tsx`, `DemoFreeTrialView.tsx` y `ParticipantBookStudio.tsx`.
5. **Pruebas Unitarias y Verificación en Navegador**:
   - Ejecutar la suite de pruebas (`participantBookRules.test.ts` y `reopenQuestionnaireRules.test.ts`), compilación TypeScript/Vite y verificación visual en Chromium.
