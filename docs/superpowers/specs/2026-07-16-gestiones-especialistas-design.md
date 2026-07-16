# Gestiones de obra (Seguridad/Ambiental/Calidad/Social) + aislamiento por obra — diseño

Fecha: 2026-07-16 · Aprobado por Gabriel (roles: reusar prevencionista + 3 nuevos; especialistas sin dinero; orden Fase 0+1 primero; staging antes de producción).

## Contexto
La obra tiene ingenieros especialistas (seguridad, ambiental, calidad, social) sin
rol propio en JARVEX. Además el selector de obra muestra TODAS las obras a
cualquier rol (useObraActiva no filtra por obra_usuarios) — solo Inicio/landing
respetan la asignación. Gabriel: las obras deben estar separadas; cada usuario ve
solo su(s) obra(s) asignada(s); pocas secciones son globales.

## Decisiones
- Roles: `prevencionista` se relabela **"Ing. de Seguridad (SSOMA)"** (mantiene key).
  Nuevos: `ing_ambiental`, `ing_calidad`, `ing_social`. Solo usuarios para los
  ingenieros encargados (los ayudantes no tienen usuario).
- **Especialistas y Residente: CERO dinero** (sin contabilidad, precios, costos,
  compras con monto). Calidad ve specs técnicas de insumos, no precios.
- Residente de Obra: supervisa avances de ingenieros de frente + especialistas,
  cumplimiento de reportes diarios, personal obrero (ver/crear), frentes+partidas+
  designación de ingeniero. Sin dinero (se le quitan también Valorizaciones/
  Versiones que quedaron en lectura).
- Scope OBRERO: ing. de seguridad y almacenera ven/crean/inhabilitan personal
  SOLO con cargo Peón/Oficial/Operario (lista configurable).

## Fases
### Fase 0 — Aislamiento por obra (base) [esta entrega]
- `useObraActiva` filtra por `window.__obrasPermitidas` (Set|null), mantenido por
  main.jsx al cambiar la sesión vía `cargarObrasAsignadas` (obra_usuarios).
  null = sin restricción (admin/gerente o sin asignaciones).
- Selector del header, jx-reportes y cualquier lista de obras usan la lista filtrada.
- Guard en entrarObra/jx-app: no navegar a obra no permitida.
- Global vs por obra: no cambia (nav-planos ya lo define); lo global sigue global.

### Fase 1 — Reportes diarios de especialistas + panel del Residente [esta entrega]
- Tabla `reportes_especialidad` (obra_id, area CHECK seguridad|ambiental|calidad|social,
  fecha, descripcion, responsable_id, sync estándar). Dexie v38 + 4 puntos de sync.
  Módulo de matriz nuevo: 'Reporte Especialidad' (w: 4 especialistas, residente, admin).
- Página `reporte-especialidad`: el especialista carga su reporte del día (+fotos
  como evidencias modulo 'reportes_especialidad') y ve/edita los suyos. El área se
  infiere del rol; admin/residente ven todas (lectura + filtro).
- Página `panel-residente` (admin + ingeniero_residente): cumplimiento de HOY y
  semana — ingenieros de frente (avance_obra/reportes_dia) y especialistas
  (reportes_especialidad); personal obrero activo; accesos a frentes/partidas.
- Roles nuevos en jx-admin (labels/colores/matrices/canónicos/home) + CHECK de
  profiles.rol en server (mig). Matrices especialistas: su área en w, técnico
  general en r, dinero/contabilidad/compras/admin en x.
- Residente: Valorizaciones/Valor. Subcontrato/Versiones presupuesto → x.
- Precio oculto: helper `__rolVeDinero(rol)` (false: residente, ingeniero, 4
  especialistas) — columna de precio del catálogo de Materiales oculta para ellos
  (extensión a más columnas de precio en fases siguientes).
- Bloques Inicio: SSOMA → "Seguridad (SSOMA)"; nuevos bloques Ambiental, Calidad,
  Social (con reporte-especialidad y sus futuras herramientas); panel-residente
  en Gestión de Obra.

### Fase 2 — Seguridad
Planificador de charlas `charlas_plan` (temas/fechas/responsable, área
seguridad|ambiental|social compartida, import Excel). SCTR por trabajador
(vencimiento + evidencia + panel). Fichas de inducción (seguridad/ambiental) para
personal nuevo directo. Scope obrero en PersonalPage para prevencionista+almacenero
(ver/crear/inhabilitar solo Peón/Oficial/Operario).

### Fase 3 — Ambiental
Archivo de cumplimiento ISO 14001: evidencias por categoría fija (residuos,
monitoreos agua/aire/ruido, permisos, incidentes, capacitaciones, inspecciones)
× mes → matriz de cumplimiento mensual automática. Usa charlas/inducciones de F2.

### Fase 4 — Calidad (IA)
Requisitos del expediente por insumo (norma/valor mínimo, import Excel) +
certificado PDF del insumo comprado → IA extrae y compara → semáforo cumple/no
cumple + evidencia + export para informes. IA multiplexada en endpoint existente
(límite 12/12 Vercel).

### Fase 5 — Social
Compromisos con la comunidad (actas, responsable, vencimiento, estado), quejas/
reclamos con seguimiento y evidencia de cierre, padrón de actores, charlas
comunitarias (planificador compartido).

## Testing/entrega
Cada fase: lib pura con tests donde haya reglas, arranque en frío, review
adversarial, deploy a staging → prueba de Gabriel → merge a main (producción).
