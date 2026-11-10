# Plan de Implementación: Unificación de Barra Superior (`Navbar`) y Nuevo Módulo Integral de «Estadísticas»

## 1. Unificación de Pestañas en la Barra Superior (`src/components/Navbar.tsx`)
1. **Mismo Estilo Visual en las 5 Pestañas Superiores**:
   - Unificar `Panel Administrador`, `Portal del Participante`, `Mi Esencia`, `Conóceme` y `Prueba Gratuita` con exactamente el mismo diseño de pestaña:
     - **Activo**: `bg-amber-800/80 text-amber-100 border border-amber-600/40 shadow-xs`
     - **Inactivo**: `text-stone-300 hover:text-white hover:bg-stone-800`
     - **Base**: `px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors cursor-pointer`
2. **Sin Íconos y Textos Actualizados**:
   - Eliminar los íconos (`Sparkles`, `ExternalLink`) de todas las pestañas de la barra superior.
   - Renombrar **`Mi Esencia (/miesencia)`** a **`Mi Esencia`**.
   - Renombrar **`Prueba gratuita`** a **`Prueba Gratuita`**.

---

## 2. Nuevo Módulo Integral de «Estadísticas» (Datos Cuantitativos y Cualitativos en Vivo)

### 2.1. Endpoint Unificado en Tiempo Real (`GET /api/admin/system-statistics`)
- Consolidar en tiempo real todos los registros vivos de `StorageManager` y `MiEsenciaStore`:
  1. **Métricas de Entrevistas y Participantes**:
     - Total de entrevistas, desglose por modalidad (`individual` vs. `compartida`/pareja) y estado (`active`, cerradas voluntariamente, completadas, reabiertas).
     - Total de participantes registrados, códigos `YF-XXXXX` activos vs. revocados, y porcentaje de avance global.
  2. **Métricas de Respuestas, Voz y Fotografías**:
     - Total de respuestas completadas, desglosadas en: respuestas principales, preguntas de profundización IA (`isFollowUp`), memorias adicionales libres (`isAdditionalMemory`) y preguntas omitidas (`notRecalled`).
     - Distribución de respuestas por cada una de las 5 etapas de vida (*Infancia, Juventud, Adultez, Madurez, Legado*), conteo total de palabras y promedio de palabras por respuesta.
     - Total de grabaciones de voz adjuntas y total de fotografías históricas comentadas.
  3. **Métricas de Libros, Manuscritos y Privacidad**:
     - Total de borradores de manuscritos, versiones de libros maquetadas por participantes (`participantBookVersions`), distribución por estilo literario, diseño de portada y formato físico (`6x9`, `a5`, `carta`).
     - Consentimientos de privacidad vigentes vs. revocados, libros compartidos (`bookShares`), entregas futuras programadas (`scheduledDeliveries`), instrucciones post-mortem (`postMortemInstructions`), solicitudes ARCO (`arcoRequests`) y eventos en bitácora de auditoría (`auditLogs`).
  4. **Métricas Completas de Mi Esencia (`/miesencia`)**:
     - **Avatares y Perfiles**: Total de avatares habilitados, suscripciones por estado (`activo`, `pausado`, `vencido`), perfiles biográficos, PDFs «Compilado Testimonial Fidedigno» archivados y total de bloques testimoniales Nivel A.
     - **Familiares y Accesos**: Total de interlocutores familiares registrados, desglose por parentesco y credenciales `YF-XXXXX` activas/revocadas.
     - **Conversaciones y Mensajes**: Total de conversaciones (`sessions`), total histórico de mensajes enviados (mensajes de familiares vs. respuestas del avatar), mensajes enviados hoy, mensajes enviados en el mes actual, consumo estimado de tokens de IA, uso por proveedor/modelo (Google Gemini vs. OpenAI GPT) y respaldos automáticos ejecutados (`fallbackLogs`).
     - **Memorias A/B/C y Gobernanza**: Total de testimonios Nivel A (Inmutable), memorias conversacionales Nivel B (Familiar compartido) y Nivel C (Privado por código), contradicciones detectadas (abiertas vs. resueltas) e instantáneas de restauración (`snapshots`).
     - **Finanzas y Promociones**: Ingresos acumulados en MXN (`payments`), suscripciones por plan comercial (`plans`), cupones de descuento/días de regalo (`coupons`) y notificaciones emitidas.
  5. **Análisis Cualitativo del Sistema**:
     - **Riqueza Narrativa y Temática en Entrevistas**: Etapas biográficas con mayor densidad literaria, motivos de profundización contextual más frecuentes, dedicatorias/cierres destacados y tabla cualitativa detallada por entrevista.
     - **Dinámica Emocional y Conversacional en Mi Esencia**: Parentescos más activos, temas y recuerdos Nivel B/C aportados por la familia, configuración de espontaneidad y estilo emocional por avatar, y tabla detallada de actividad por avatar y por familiar.

### 2.2. Interfaz de Usuario en `AdminDashboard.tsx` y `MiEsenciaAdminSection.tsx`
- Crear el componente dedicado `src/components/SystemStatisticsPanel.tsx` e integrarlo:
  1. Como nueva pestaña principal **«Estadísticas»** en el `Panel Administrador` (`src/components/AdminDashboard.tsx`).
  2. Dentro de la subpestaña **«Estadísticas y Costos»** de `Mi Esencia` (`src/modules/mi-esencia/MiEsenciaAdminSection.tsx`).
- Incluir:
  - **Actualización automática en tiempo real** (con indicador de última sincronización y botón de actualización inmediata).
  - **Filtros interactivos** por Entrevista, por Avatar de Mi Esencia y por vista (*Vista Global*, *Entrevistas y Libros*, *Mi Esencia y Conversaciones*, *Análisis Cualitativo*).
  - **Exportación en 1 clic** del reporte estadístico completo en formato **CSV** y **JSON**.

---

## 3. Verificación
- Ejecutar pruebas unitarias, compilación (`compile_applet`) y linter (`lint_applet`).
- Verificar en el navegador que las 5 pestañas de la barra superior (`Navbar`) luzcan idénticas sin íconos y que la pestaña **Estadísticas** muestre todas las métricas cuantitativas y cualitativas en vivo.
