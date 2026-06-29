# Diseño — Reorganización de la navegación en 2 planos (General / Obra)

**Fecha:** 2026-06-28
**Autor:** Gabriel Julca + Claude
**Estado:** Aprobado (diseño) — pendiente de plan de implementación

## Problema

JARVEX tiene ~99 ítems de menú en 12 secciones, en una sola lista plana, mezclando
datos **globales** (Empresas, Proveedores, Usuarios) con datos **por obra** (almacén,
partidas, conciliación). El header tiene un selector de "obra activa" que sugiere que
*todo* lo que se ve es de esa obra, pero la mitad del menú lo ignora.

Síntoma reportado: el usuario capturó facturas para la Obra B (creando proveedores),
cambió la obra activa a la Obra A, y la sección Proveedores seguía mostrando los de la
Obra B. No es un bug — los proveedores son **globales** (un RUC es el mismo en toda
obra). El problema es que **no se distingue qué es global y qué es por-obra**, y no hay
una pantalla de inicio que derive a cada sección (a diferencia de Delphin, que tiene un
inicio con mosaicos antes de entrar a cada parte).

## Objetivo

Reorganizar la **navegación** (no los datos ni los permisos) en **dos planos**
explícitos, con una pantalla de **Inicio** tipo Delphin que derive a cada sección:

- **Plano GENERAL** — global, sin obra: Empresas (y su contabilidad de empresa),
  Proveedores, Clientes, Captura Mágica (bandeja), Usuarios/Roles, Configuración.
- **Plano OBRA** — workspace enfocado de UNA obra: almacén, compras, gestión de obra,
  contabilidad de la obra, RRHH, SSOMA, ingeniería, maquinaria.

## Decisiones tomadas (brainstorming)

1. **Dirección:** Inicio tipo Delphin + 2 planos (vs. solo contexto, vs. landing por rol).
2. **Modelo de obra:** *Enfocado con cambio rápido* — al entrar a una obra se trabaja
   SOLO en ella (menú corto); el header tiene `← Inicio` + un dropdown de cambio rápido
   de obra (sin volver al inicio).
3. **Captura Mágica:** *Bandeja global* en el plano General; por cada comprobante se
   elige el destino (Obra A / Obra B / Gastos Generales de la Empresa). Como hoy.

## Arquitectura

### Modo de navegación
Se introduce un **modo** de UI: `'inicio'` | `'obra'` (estado en `jx-app`, persistido en
localStorage junto con la obra activa).

- **modo `inicio`** → render de la pantalla **Inicio** (mosaicos). Sin selector de obra
  en el header (es global). El sidebar (si se muestra) lista solo ítems del plano
  `general`.
- **modo `obra`** → **workspace** de la obra activa. Sidebar corto: solo ítems del plano
  `obra`, agrupados. Header: `← Inicio │ OBRA: <nombre> ▾ (cambio rápido) │ usuario`.

Cada ítem del `NAV` (en `main.jsx`) se etiqueta con `plano: 'general' | 'obra'`. El
sidebar filtra por **(modo ↔ plano)** Y por **rol** (los allowlists actuales se respetan
sin cambios).

### Pantalla de Inicio (plano General)
Componente nuevo `src/components/jx-inicio.jsx`:

```
┌ JARVEX ───────────────────────────── [usuario ▾] ┐
│  DATOS GENERALES                                   │
│  [🏢 Empresas] [🚚 Proveedores] [👥 Clientes]      │
│  [✨ Captura Mágica] [👤 Usuarios y Roles] [⚙ Config]│
│                                                     │
│  OBRAS  (entrá a una para trabajar)                │
│  ┌ Miraflores ──────┐ ┌ Obra B ──────────┐         │
│  │ 45% físico        │ │ 12% físico        │        │
│  │ S/ 1.2M facturado │ │ S/ 0.3M facturado │        │
│  └───────────────────┘ └───────────────────┘        │
└─────────────────────────────────────────────────────┘
```

- **Datos Generales:** mosaicos que abren páginas globales (cada mosaico = un grupo o
  una página). Solo aparecen los que el rol puede ver.
- **Empresas:** hub de las afiliadas + su **contabilidad de empresa** (Balance, Estado
  de Resultados, Libros Electrónicos/SUNAT, Cuentas Bancarias, Plan de Cuentas, Libro
  Diario, Consolidado, Comparativo de Periodos, Intercompany, Trazabilidad). Son por
  entidad legal, no por obra.
- **Obras:** admin/gerente ven todas; los demás, solo sus obras asignadas
  (`obra_usuarios`). Cada tarjeta: nombre + avance **físico** + **financiero** (reúsa
  `calcAvanceFinanciero` + el avance físico ponderado ya existentes). Click → entra al
  workspace de esa obra (modo `obra`).

### Workspace de Obra (plano Obra)
El sidebar muestra SOLO los módulos de la obra activa, en grupos:

- **Resumen** — Dashboard de la obra
- **Almacén** — materiales, mov. materiales, herramientas, mov. herramientas, EPP,
  emergencia, ubicaciones, caja chica, evidencias, plantillas
- **Compras** — solicitud de residente, requisiciones, órdenes de compra, recepción
  (compras pendientes), cotizaciones
- **Gestión de Obra** — partidas, insumos por partida, control de consumo, avance,
  cronograma, valorizaciones, subcontratos/subcontratistas, versiones, costos,
  incidencias, movimientos de insumos, **Importar** (presupuesto Delphin de la obra)
- **Contabilidad de la obra** — Movimientos contables (de la obra), **Conciliación de
  insumos**, Flujo de caja / Flujo proyectado (de la obra)
- **RRHH** — personal, frentes, asistencia, contratos, planillas, CTS, gratificaciones,
  PLAME (son por obra)
- **SSOMA** — charlas, IPERC, inspecciones, capacitaciones, insumos por persona
- **Ingeniería** — dashboard técnico, mis partidas, cronograma de frente,
  salidas/vinculación, reporte diario, mis reportes, borradores, plan vs real, emitir
  alerta, detalle de partida
- **Maquinaria** — equipos pesados, mantenimiento

Dentro de una obra **todo** sigue al selector; empresas/proveedores **no están acá**.

### Reparto Contabilidad (resumen de la ambigüedad)
- **Por EMPRESA (plano General → Empresas):** Balance, Estado de Resultados, Libros
  Electrónicos, Comprobantes SUNAT, Config SUNAT, Cuentas Bancarias, Plan de Cuentas,
  Libro Diario, Consolidado, Comparativo de Periodos, Intercompany, Trazabilidad,
  Dashboard Contable (overview).
- **Por OBRA (plano Obra → Contabilidad de la obra):** Movimientos contables,
  Conciliación de insumos, Flujo de caja, Flujo proyectado.
- *Abierto (post-v1):* una vista CONSOLIDADA de movimientos cross-obra dentro de Empresas
  (hoy Movimientos ya filtra por obras asignadas; v1 lo deja en el workspace de obra).

### Dirección / Ejecutivo
Las vistas cross-obra (Dashboard Ejecutivo, KPIs, Cumplimiento de Cronograma, Centro de
Alertas, Búsqueda Global) son del plano **General** (dirección), accesibles desde Inicio
para admin/gerente.

## Landing por rol
Se extiende `__HOME_POR_ROL` (en `jx-admin.jsx`) con un plano de aterrizaje:

- **admin / gerente / contador / ayudante_contador / tesorero** → `inicio` (juegan entre
  lo general y varias obras).
- **almacenero / ingeniero / ingeniero_residente / supervisor / maestro_obra /
  prevencionista / rrhh / jefe_compras** → `obra`: si tienen **una** obra asignada,
  entran directo a su workspace y a su página de siempre (mov-materiales, avance, etc.);
  si tienen **varias**, caen en `inicio`.

Helper PURO unit-testeable: `resolveLanding(rol, obrasAsignadas) → { modo, obraId|null,
page }`. Respeta `obra_usuarios` (asignación) y los allowlists/matriz existentes.

## Qué cambia / qué NO cambia

**NO se toca:**
- El modelo de datos (Supabase/Dexie), los triggers, la sincronización.
- La lógica de permisos (PERM_MATRIX, allowlists `__AYUDANTE_CONTADOR_ITEMS`, etc.).
- Las páginas individuales (almacén, conciliación, partidas, contabilidad…): ya filtran
  por obra activa. Siguen igual.

**Se toca (el cascarón de navegación):**
- `src/main.jsx` — etiquetar cada ítem del `NAV` con `plano` y regrouparlos por plano.
- `src/jx-app.jsx` — estado `modo` (inicio/obra), render condicional del Inicio, header
  por modo (Inicio: global; Obra: `← Inicio` + cambio rápido), landing inicial.
- `src/components/jx-sidebar.jsx` — filtrar/agrupar el `NAV` por modo (plano) + rol.
- `src/components/jx-admin.jsx` — `__HOME_POR_ROL` con plano de aterrizaje + `resolveLanding`.
- **NUEVO** `src/components/jx-inicio.jsx` — los mosaicos de Datos Generales + el grid de
  obras (con avance físico/financiero por tarjeta).

## Fases de implementación

1. **Cascarón (lo más visible):** pantalla de Inicio (mosaicos + grid de obras), modo
   `inicio`/`obra`, header con `← Inicio` + cambio rápido de obra, sidebar filtrado por
   plano. Las páginas no cambian. Landing por rol básico (`resolveLanding`).
2. **Empresas como hub de contabilidad de empresa:** regroupar Balance/Libros/SUNAT/
   Cuentas/Plan de Cuentas/etc. bajo Empresas (plano General).
3. **Pulido:** tarjetas de obra con avance físico + financiero en vivo; afinar landing por
   rol; (opcional) vista consolidada de movimientos cross-obra en Empresas.

## Testing
- `resolveLanding(rol, obrasAsignadas)` — helper PURO + tests (admin→inicio; almacenero
  con 1 obra→obra+su página; con varias→inicio; sin obra→inicio).
- Mapeo ítem→plano — verificable: ningún ítem queda sin plano; cada plano agrupa lo
  esperado.
- Build verde + suite existente; verificación por contenido en el deploy (strings de
  Inicio / workspace).

## Riesgos y mitigaciones
- **Regresión de navegación** (cambio de cascarón): mitigar con fases; las páginas no se
  tocan; el `NAV` y los permisos se preservan (solo se etiquetan/agrupan).
- **Cambio de obra que recarga la app** (hoy `setObraActiva` confirma + recarga): en el
  workspace el "cambio rápido" reusa ese flujo en v1; suavizarlo (sin recarga total) es
  un refinamiento posterior, no bloquea la Fase 1.
- **Roles sin obra asignada** o con múltiples: el `resolveLanding` cae a `inicio` (seguro).

## Fuera de alcance (YAGNI por ahora)
- Reescribir páginas individuales.
- Cambiar permisos/roles.
- Vista consolidada cross-obra de movimientos (queda como mejora post-v1).
- Suavizar el cambio de obra sin recarga (refinamiento posterior).
