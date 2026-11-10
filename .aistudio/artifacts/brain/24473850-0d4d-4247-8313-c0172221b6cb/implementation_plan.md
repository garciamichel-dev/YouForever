# Plan de Implementación — Control Manual de Mensajes Diarios y Sincronización en Vivo en Mi Esencia

## 1. Objetivo
Permitir desde el panel de administración de **Mi Esencia** configurar, aumentar, disminuir, editar y reiniciar los límites y contadores de **mensajes diarios** en tres niveles (**en bloque para todos**, **por Avatar** y **por código familiar individual**), reflejando cualquier ajuste **automáticamente en vivo** en la ventana de conversación del familiar (`/miesencia`) sin necesidad de recargar la página:
- Si el administrador **aumenta** el límite diario (o disminuye/reinicia los mensajes usados hoy), un familiar que había agotado su cuota diaria recupera inmediatamente mensajes disponibles y puede seguir conversando al instante.
- Si el administrador **disminuye** el límite diario a un valor igual o menor a los mensajes que el familiar ya usó hoy, su contador en pantalla pasa a `0 restantes` y queda bloqueado el envío de nuevos mensajes por el resto del día (salvo que se le vuelva a ampliar).

---

## 2. Reglas de Negocio y Jerarquía de Cuotas Diarias
1. **Valor por Defecto Global (`defaultDailyMessageQuota`):**
   - Configurable en `MiEsenciaGlobalConfig` (por defecto `50` mensajes diarios por familiar), aplicado automáticamente al crear nuevas suscripciones/avatares.
2. **Aplicación en Bloque a Todos (`applyBulkDailyUsage`):**
   - Permite aplicar un mismo límite diario a todas las suscripciones activas y/o limpiar límites personalizados individuales para unificar a todos los familiares, así como reiniciar en bloque a `0` los contadores de mensajes enviados hoy (`messagesSentToday`) de todos los familiares.
3. **Ajuste por Avatar (`dailyMessageQuotaPerInterlocutor`):**
   - En la tarjeta de cada Avatar en **Suscripciones y Vigencias** (junto al control de uso mensual), el administrador podrá:
     - Editar el **Límite diario por familiar del Avatar** (`dailyMessageQuotaPerInterlocutor`).
     - Opcionalmente propagar ese límite a todos los familiares vinculados al avatar (actualizando sus `customDailyMessageLimit` si tenían uno distinto) y/o **reiniciar a `0` los mensajes usados hoy** de todos los familiares de ese avatar.
4. **Ajuste Individual por Código Familiar (`customDailyMessageLimit` y `messagesSentToday`):**
   - En **Códigos Personales y Enlaces Privados Directos** (agrupados por Avatar), cada familiar mostrará su uso del día (`Usados hoy: X / Límite diario: Y • Restantes: Z`) y permitirá:
     - Editar su **Límite diario individual** (`customDailyMessageLimit`).
     - Editar manualmente el número de **Mensajes usados hoy** (`messagesSentToday`) o **Reiniciar hoy a 0** con un botón directo.
5. **Evaluación Estricta en Cada Turno (`/api/mi-esencia/family/converse`):**
   - El límite diario efectivo de un familiar es `interlocutor.customDailyMessageLimit ?? subscription.dailyMessageQuotaPerInterlocutor ?? config.defaultDailyMessageQuota ?? 50`.
   - Si `interlocutor.messagesSentToday >= dailyLimit`, el backend rechaza el envío indicando cuántos mensajes usó y su límite actual; si `interlocutor.messagesSentToday < dailyLimit`, permite conversar de inmediato.

---

## 3. Sincronización Automática en Vivo en `/miesencia`
1. **Endpoint Ligero de Estado de Cuota (`/api/mi-esencia/family/quota-status`):**
   - Recibe `personalCode` y devuelve en tiempo real `{ interlocutor, subscription }` actualizados desde el almacén persistente.
2. **Actualización Automática sin Recargar en `MiEsenciaFamilyPortal.tsx`:**
   - Mientras el familiar tiene abierta la ventana de conversación en `/miesencia`, un sincronizador ligero consulta `/api/mi-esencia/family/quota-status` cada **5 segundos** y también al recuperar el foco de la pestaña (`visibilitychange` / `focus`).
   - Actualiza en caliente `interlocutor` y `subscription`:
     - El encabezado superior (`Mensajes hoy: X usados • Y restantes (de Z)`) se actualiza en vivo.
     - Si antes tenía un aviso de límite diario alcanzado (`sendError`) y ahora `dailyMessagesRemaining > 0`, limpia automáticamente el aviso de bloqueo y habilita el cuadro de texto y botón **Enviar** para que pueda continuar conversando sin recargar.
     - Si el administrador redujo el límite diario y ahora `dailyMessagesRemaining === 0`, el encabezado cambia a estado agotado (`0 restantes`), muestra un aviso claro en la parte superior del cuadro de mensaje y deshabilita el envío hasta que tenga mensajes disponibles.

---

## 4. Archivos a Modificar
- `src/logic/miEsenciaRules.ts`: Añadir `defaultDailyMessageQuota?: number` a `MiEsenciaGlobalConfig` y `DEFAULT_MI_ESENCIA_CONFIG`.
- `src/server/miEsencia/miEsenciaStore.ts`:
  - Añadir métodos `updateSubscriptionDailyUsage`, `applyDailyQuotaToAllSubscriptions`, `updateInterlocutorDailyUsage` y ampliar `updateInterlocutorAndCredential` para aceptar `customDailyMessageLimit` y `messagesSentToday` con persistencia inmediata en disco y Firestore.
- `src/server/miEsencia/miEsenciaRouter.ts`:
  - Añadir endpoints administrativos `/admin/subscriptions/daily-usage`, `/admin/subscriptions/daily-usage-bulk`, `/admin/interlocutors/daily-usage` y el endpoint familiar `/family/quota-status`.
- `src/modules/mi-esencia/MiEsenciaAdminSection.tsx`:
  - Añadir controles de cuota diaria global y en bloque, controles de límite diario y reinicio por Avatar en cada tarjeta de suscripción, y controles de límite diario / mensajes usados hoy / reinicio a `0` en cada Código Familiar dentro del desplegable de cada Avatar.
- `src/modules/mi-esencia/MiEsenciaFamilyPortal.tsx`:
  - Añadir sincronización automática en vivo (`useEffect` cada 5 s + evento `focus`) contra `/api/mi-esencia/family/quota-status`, reflejando al instante ampliaciones o reducciones del límite diario en el encabezado y habilitando/bloqueando dinámicamente el envío de mensajes.
