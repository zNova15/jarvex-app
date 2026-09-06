# JARVEX — Analytics con PostHog

Guía para crear los 4 dashboards que el Council recomendó. La idea: en 5 minutos por dashboard tienes métricas reales del uso de la app, no impresiones de "creo que se usa mucho".

## Eventos que la app emite

| Evento | Cuándo | Properties clave |
|---|---|---|
| `$pageview` | El user navega a otra pantalla | `page` (id de la pantalla), `user_rol`, `is_mobile` |
| `record_pushed` | Un INSERT/UPDATE/DELETE llegó OK al server | `tabla`, `operacion` (`create` / `create_dedup` / `update` / `delete`) |
| `$autocapture` | Click en botón / submit de form | (automático — texto del botón, etc.) |
| `$pageleave` | El user cerró/cambió pantalla | (tiempo en pantalla) |

Super-properties que van en TODOS los eventos:
- `user_rol`: `admin` / `almacenero` / etc. (del profile)
- `obra_activa`: id de la obra seleccionada
- `app_version`: release deployado
- `app_env`: `production` / `development`

## Cómo crear un dashboard en PostHog

1. Login en https://us.posthog.com
2. Sidebar izquierdo → **Dashboards** → **New dashboard** (botón arriba derecha)
3. Nombre: ver tabla de abajo
4. Para cada panel del dashboard: **Add insight** → seguí los pasos del dashboard.

---

## Dashboard 1 — "Pantallas más usadas por rol"

**Pregunta que responde**: ¿Qué módulos de las 60 pantallas se usaron esta semana, y por qué tipo de usuario?

### Insight 1.1 — Top pantallas (últimos 7 días)
- **Tipo**: Trends → "Insight" → Trends
- **Series**: `$pageview` con math = `Total count`
- **Filtros**: ninguno
- **Breakdown**: `Event property` → `page`
- **Date range**: `Last 7 days`
- **Display**: `Bar value`
- **Save** → asignar al dashboard "Uso por rol"

### Insight 1.2 — Pantallas por rol (heatmap)
- **Tipo**: Trends → Trends
- **Series**: `$pageview`
- **Breakdown**: `Event property` → `page` (filtrar Top 20)
- **Filter**: agrega filter `user_rol = almacenero` y duplica la serie con `user_rol = admin`. O usa un breakdown adicional por `user_rol`.
- **Display**: `Bar` o `Table`

### Insight 1.3 — Tiempo en cada pantalla
- **Tipo**: Trends → "Path Analysis" o **Funnels**
- Alternativa simple: usar `$pageleave` con math `Average` sobre la propiedad `$session_duration` (PostHog la calcula automáticamente).
- Series: `$pageview` con math = `Average property value of $time_on_page`

---

## Dashboard 2 — "Acciones de escritura por módulo"

**Pregunta que responde**: ¿Qué tan activos están los usuarios? ¿Crean / editan / borran?

### Insight 2.1 — Records pusheados por tabla (7 días)
- **Tipo**: Trends → Trends
- **Series**: `record_pushed` con math = `Total count`
- **Breakdown**: `Event property` → `tabla`
- **Date range**: `Last 7 days`
- **Display**: `Bar value`

### Insight 2.2 — Mix de operaciones
- **Tipo**: Trends → Trends → Pie chart
- **Series**: `record_pushed`
- **Breakdown**: `Event property` → `operacion`
- **Date range**: `Last 30 days`
- **Display**: `Pie`

### Insight 2.3 — Top usuarios por volumen de cambios
- **Tipo**: Trends → Trends
- **Series**: `record_pushed` math = `Unique users`... no, mejor: math = `Total count`
- **Breakdown**: `Person property` → `distinct_id` (si quieres ver per-user) o `user_rol` para ver agregado por rol
- **Date range**: `Last 30 days`

---

## Dashboard 3 — "Salud de la app por release"

**Pregunta que responde**: ¿La última release rompió algo? ¿Hay un rol específico afectado?

### Insight 3.1 — Errores capturados (Sentry)
> Los errores propiamente dichos los ves en Sentry — PostHog NO captura errores JS automáticamente en JARVEX (porque ya tenemos Sentry).
> Lo que sí puedes hacer: trackear eventos custom en `catch` blocks críticos. Por ahora, este insight queda como **placeholder**: linkear a `https://novvx-proyect.sentry.io/issues`.

### Insight 3.2 — Sync failures (proxy: ausencia de record_pushed)
- **Tipo**: Trends → Trends
- **Series**: `record_pushed` con math = `Total count`
- **Breakdown**: `Event property` → `app_version`
- **Date range**: `Last 14 days`
- Interpretación: si una release nueva tiene MENOS `record_pushed` per session, probablemente el sync se está rompiendo. Comparar con la release anterior.

### Insight 3.3 — Sesiones por release
- **Tipo**: Trends → Trends
- **Series**: `$pageview` con math = `Unique sessions`
- **Breakdown**: `Event property` → `app_version`
- Te dice qué versión está corriendo en cuántas sesiones.

---

## Dashboard 4 — "Actividad diaria (DAU/WAU)"

**Pregunta que responde**: ¿La app está creciendo? ¿Cuántos almaceneros usaron JARVEX hoy?

### Insight 4.1 — DAU por rol
- **Tipo**: Trends → Trends
- **Series**: `$pageview` con math = `Unique users`
- **Breakdown**: `Person property` → `rol` (o `Event property` → `user_rol`)
- **Date range**: `Last 30 days`
- **Display**: `Number` (mostrar "Daily active users" en grande) + un trend gráfico

### Insight 4.2 — WAU vs DAU (stickiness)
- **Tipo**: Stickiness
- **Event**: `$pageview`
- **Date range**: `Last 8 weeks`
- Interpretación: cuántos usuarios de los activos en una semana volvieron al día siguiente, a los 2 días, etc.

### Insight 4.3 — Activos por obra
- **Tipo**: Trends → Trends
- **Series**: `$pageview` con math = `Unique users`
- **Breakdown**: `Event property` → `obra_activa`
- Te muestra qué obras están más activas (proxy: cuántos users distintos tocan la app por obra).

---

## Cómo iterar

- Si una métrica te da curiosidad, en PostHog click en el panel → te abre el insight → "Show events" → ves los eventos individuales con todas las properties → entendés qué hay detrás del número.
- Si quieres trackear algo nuevo (ej: "alguien intentó entrar a `/contabilidad` siendo almacenero"), agrega una llamada a `trackEvent('intento_acceso_bloqueado', { pantalla: 'contabilidad' })` en el código.
- **NO trackees PII**. El módulo `posthog.js` ya scrubea DNIs/RUCs/emails/JWT, pero la mejor defensa es no mandarlos en primer lugar.

## Alertas de PostHog (opcional)

PostHog Cloud Pro tiene alertas — el plan free no. Si más adelante upgradeás:
- **Alerta 1**: caída de DAU > 30% comparado al promedio de la semana → señal de bug que afecta engagement.
- **Alerta 2**: errores sync (record_pushed cae a 0 en una versión nueva) → bug de release.

Por ahora, abrir el dashboard 1 vez por semana es suficiente. Anotalo en tu calendar como "10 min PostHog review" todos los lunes.
