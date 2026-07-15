# Reportes — Fase 1: Movimientos de Insumos (diseño)

Fecha: 2026-07-15 · Aprobado por Gabriel ("Fase 1 cerrada").

## Contexto
La sección Reportes (`src/components/jx-reportes.jsx`) quedó obsoleta y de hecho
rota: lee columnas viejas (`m.nombre`, `m.tipo`, `a.estado`) que ya no existen →
tablas vacías. Se reescribe. Decisiones de diseño acordadas:
- **Interactivo = dashboard en pantalla + exportar PDF** (no PDF "clickeable").
- **Email automático = resumen HTML vía n8n programado** (fase posterior; el PDF
  jsPDF se genera en el navegador y no se puede adjuntar desde el servidor).
- **Orden: movimientos de insumos primero** (esta fase). Avance técnico y
  contable en fases siguientes, mismo patrón.

## Alcance de la Fase 1
Reporte de **Movimientos de Insumos** con:
- Selector: Obra · Período (día/semana/mes/rango) · Tipo (materiales/herramientas/
  EPPs/maquinaria/emergencia/**todos**) · Modo (Resumen / Detallado).
- **Modo Resumen** (visual): KPIs + gráficos de barras (TOP insumos, TOP personal,
  TOP frentes) + tabla "Más salen y por agotarse" con semáforo.
- **Modo Detallado**: tabla completa de movimientos del período + totales.
- **Exportar PDF**: logo de empresa + KPIs + gráficos (renderizados a imagen) + tablas.
- **Acceso por rol**: cada familia de reporte se muestra según el rol.

## Modelo de datos (verificado en jx-movimientos-insumos.jsx)
5 tablas de movimiento con mapeo canónico (CATS):
| tipo | tabla mov | fk insumo | catálogo | col nombre | persona |
|------|-----------|-----------|----------|-----------|---------|
| material | movimientos_materiales | material_id | materiales | nombre_material | responsable_id |
| herramienta | movimientos_herramientas | herramienta_id | herramientas | nombre_herramienta | responsable_id |
| epp | movimientos_epp | epp_id | epps | nombre_epp | **personal_id** |
| emergencia | movimientos_insumos_emergencia | insumo_emergencia_id | insumos_emergencia | nombre | responsable_id |
| maquinaria | movimientos_maquinaria | activo_id | activos_pesados | nombre | responsable_id |

- Dirección unificada (`dirMovimiento`): entrada · salida · devolucion · otro · reverso.
  Herramientas usa `accion` + `tipo_movimiento`; el resto `tipo_movimiento`.
- Cada movimiento trae `frente_id` (directo), `subcontratista_id`, `cantidad`, `fecha`.
- Filas `es_grupo` (padres de variantes SKU) se ignoran (rollup sin stock propio).
- activos_pesados no indexa obra_id (filtra por obra_actual_id/obra_id).

## Arquitectura
- **`src/lib/reportes-movimientos.js`** (núcleo, con tests):
  - `CATS_MOV`, `dirMovimiento(catKey, mv)` — mapeo + dirección unificada.
  - `cargarMovimientosObra(db, obraId)` → `{ catalogo, movimientos }` normalizados
    (thin async; lee Dexie). Movimiento normalizado:
    `{ id, cat, fecha, insumoId, insumoNombre, unidad, cantidad, dir, frenteId, personaId, subId }`.
    Catálogo: `{ cat, id, nombre, codigo, unidad, stock, stockMin, precio }`.
  - `agregarMovimientos({ movimientos, catalogo, personalById, subById, frenteById, tipo, from, to, topN })`
    → **función PURA** (tested): `{ kpis, topInsumos, porAgotarse, topPersonal, topFrentes, detalle }`.
    - kpis: totalSalidas, totalEntradas, totalDevoluciones, nMovimientos, insumosDistintos, valorSalidas (Σ cantidad×precio de catálogo, solo donde hay precio).
    - topInsumos: salidas agrupadas por insumo (cat+id), Σ cantidad, top N, con unidad y valor.
    - porAgotarse: insumos con salidas en el período, join catálogo → estado
      (agotado stock≤0 · critico stockMin>0 & stock≤stockMin · ok), orden agotado→critico→ratio.
    - topPersonal: salidas por persona (personal o `sub:<id>`), nombre resuelto, top N.
    - topFrentes: salidas por frente (frente_id; sin frente = "Sin frente"), top N.
    - detalle: movimientos del período filtrados por tipo, orden fecha desc.
- **`src/components/jx-reportes.jsx`** (reescrito): dashboard reactivo (recalcula al
  cambiar control), gráficos Chart.js (window.Chart via chart-loader), export PDF.
- **PDF**: cada gráfico se renderiza a un canvas off-screen → `toDataURL('image/png')`
  → `doc.addImage`. Cabecera con logo (patrón `drawCompanyLogo` de contabilidad-pdfs
  o helper propio en reports.js).

## Acceso por rol
La página Reportes ya está gateada por módulo 'Reportes'. Dentro, cada familia se
muestra por rol:
- Movimientos de insumos → almacén/gestión (admin, gerente, almacenero, jefe_compras, asistente_admin).
- Avance técnico (fase 2) → gestión/ingeniería.
- Contable (fase 3) → roles contables + admin.
Helper `familiasVisibles(rol)`; una familia sin permiso no se muestra.

## Testing
- Unit tests de `agregarMovimientos` (dataset sintético): KPIs, TOPs, por-agotarse
  (incluye stock 0), dedup por cat+id, "Sin frente", persona vs subcontrato, herramientas
  (accion vs tipo_movimiento), respeto de rango de fechas, modo "todos".
- Cold-start + review adversarial + deploy verificado (patrón del repo).

## Fuera de alcance (fases siguientes)
Avance técnico, contable, y el workflow n8n de email programado (config admin +
tabla de destinatarios/frecuencia). Cada uno tendrá su mini-diseño.
