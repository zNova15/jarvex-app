// ═══════════════════════════════════════════════════════════════════
// JARVEX — Reportes de Movimientos de Insumos (núcleo de agregación).
//
// Consolida las 5 tablas de movimiento (materiales, herramientas, EPPs,
// insumos de emergencia, maquinaria) y produce los KPIs y TOPs del reporte.
// El cálculo (agregarMovimientos) es una función PURA y testeable; la carga
// desde Dexie (cargarMovimientosObra) es una capa fina.
//
// Mapeo canónico y dirección unificada replicados de jx-movimientos-insumos.jsx
// (misma fuente de verdad; ver ese componente para las notas del modelo).
// ═══════════════════════════════════════════════════════════════════

// tipo → tabla mov · fk insumo · catálogo · columna nombre · columna persona · scope obra.
export const CATS_MOV = [
  { key: 'material',    label: 'Materiales',   mov: 'movimientos_materiales',         fk: 'material_id',          cat: 'materiales',         nombreCol: 'nombre_material',    codigoCol: 'codigo_s10', personaCol: 'responsable_id', porObra: true  },
  { key: 'herramienta', label: 'Herramientas', mov: 'movimientos_herramientas',       fk: 'herramienta_id',       cat: 'herramientas',       nombreCol: 'nombre_herramienta', codigoCol: 'serie',      personaCol: 'responsable_id', porObra: true  },
  { key: 'epp',         label: 'EPPs',         mov: 'movimientos_epp',                fk: 'epp_id',               cat: 'epps',               nombreCol: 'nombre_epp',         codigoCol: null,         personaCol: 'personal_id',    porObra: true  },
  { key: 'emergencia',  label: 'Emergencia',   mov: 'movimientos_insumos_emergencia', fk: 'insumo_emergencia_id', cat: 'insumos_emergencia', nombreCol: 'nombre',             codigoCol: null,         personaCol: 'responsable_id', porObra: true  },
  { key: 'maquinaria',  label: 'Maquinaria',   mov: 'movimientos_maquinaria',         fk: 'activo_id',            cat: 'activos_pesados',    nombreCol: 'nombre',             codigoCol: 'codigo',     personaCol: 'responsable_id', porObra: false },
];
export const CAT_MOV_BY_KEY = Object.fromEntries(CATS_MOV.map(c => [c.key, c]));

/** Dirección unificada de un movimiento: entrada · salida · devolucion · otro · reverso. */
export function dirMovimiento(catKey, mv) {
  if (mv.reverses_id || mv.reversed_by_id || mv.tipo_movimiento === 'reverso') return 'reverso';
  if (catKey === 'herramienta') {
    if (mv.tipo_movimiento === 'devolucion') return 'devolucion';
    if (mv.tipo_movimiento === 'ingreso' || mv.accion === 'entrada') return 'entrada';
    if (mv.accion === 'salida' || mv.tipo_movimiento === 'salida') return 'salida';
    return 'otro';
  }
  const t = mv.tipo_movimiento;
  if (t === 'entrada') return 'entrada';
  if (t === 'salida') return 'salida';
  if (t === 'devolucion') return 'devolucion';
  return 'otro';
}

const precioDeCatalogo = (r) =>
  Number(r.precio_unitario_estimado ?? r.precio_referencial ?? r.precio_unitario ?? r.costo_unitario ?? 0) || 0;

/**
 * Carga y NORMALIZA el inventario y los movimientos de las 5 tablas para una obra.
 * Capa fina sobre Dexie. Devuelve { catalogo, movimientos } con formas estables.
 */
export async function cargarMovimientosObra(db, obraId) {
  const catalogo = [];
  const movimientos = [];
  const nombreById = {};
  for (const c of CATS_MOV) {
    nombreById[c.key] = new Map();
    let rows = [];
    try {
      rows = c.porObra
        ? await db[c.cat].where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray()
        : await db[c.cat].filter(r => !r.deleted_at && (r.obra_actual_id === obraId || r.obra_id === obraId)).toArray();
    } catch { rows = []; }
    for (const r of rows) {
      const nombre = r[c.nombreCol] || '—';
      nombreById[c.key].set(r.id, { nombre, unidad: r.unidad || '' });
      if (r.es_grupo) continue; // padre de variantes SKU: rollup sin stock propio
      catalogo.push({
        cat: c.key, id: r.id, nombre,
        codigo: (c.codigoCol && r[c.codigoCol]) || '',
        unidad: r.unidad || '',
        stock: Number(r.stock_actual || 0),
        stockMin: Number(r.stock_minimo || 0),
        precio: precioDeCatalogo(r),
      });
    }
  }
  for (const c of CATS_MOV) {
    try {
      await db[c.mov].where('obra_id').equals(obraId).each(mv => {
        if (mv.deleted_at) return;
        const info = nombreById[c.key].get(mv[c.fk]) || { nombre: '—', unidad: '' };
        const cantidad = c.key === 'maquinaria' ? (Number(mv.cantidad) || 1) : (Number(mv.cantidad) || 0);
        movimientos.push({
          id: mv.id, cat: c.key, fecha: (mv.fecha || '').slice(0, 10),
          insumoId: mv[c.fk] || null,
          insumoNombre: info.nombre,
          unidad: mv.unidad || info.unidad || (c.key === 'maquinaria' ? 'und' : ''),
          cantidad, dir: dirMovimiento(c.key, mv),
          frenteId: mv.frente_id || null,
          personaId: mv[c.personaCol] || null,
          subId: mv.subcontratista_id || null,
        });
      });
    } catch { /* tabla ausente en Dexie viejo */ }
  }
  return { catalogo, movimientos };
}

const catKey = (cat, id) => `${cat}:${id}`;

/**
 * Agrega los movimientos en KPIs y TOPs del reporte. FUNCIÓN PURA.
 * @param tipo 'todos' | una key de CATS_MOV
 * @param from/to fechas 'YYYY-MM-DD' (inclusive), o null para sin límite
 * @returns { kpis, topInsumos, porAgotarse, topPersonal, topFrentes, detalle }
 */
export function agregarMovimientos({
  movimientos = [], catalogo = [],
  personalById = new Map(), subById = new Map(), frenteById = new Map(),
  tipo = 'todos', from = null, to = null, topN = 10,
} = {}) {
  const catMap = new Map();
  for (const c of catalogo) catMap.set(catKey(c.cat, c.id), c);
  const precioDe = (m) => Number(catMap.get(catKey(m.cat, m.insumoId))?.precio || 0);

  const inRange = (f) => (!from || (f && f >= from)) && (!to || (f && f <= to));
  const movs = movimientos.filter(m => (tipo === 'todos' || m.cat === tipo) && inRange(m.fecha));

  const salidas = movs.filter(m => m.dir === 'salida');
  const entradas = movs.filter(m => m.dir === 'entrada');
  const devoluciones = movs.filter(m => m.dir === 'devolucion');
  const sum = (arr) => arr.reduce((a, b) => a + (Number(b.cantidad) || 0), 0);

  // ── TOP insumos (por salidas) ──
  const porInsumo = new Map();
  for (const m of salidas) {
    const k = catKey(m.cat, m.insumoId);
    const e = porInsumo.get(k) || { cat: m.cat, id: m.insumoId, nombre: m.insumoNombre, unidad: m.unidad || '', cantidad: 0, valor: 0, movimientos: 0 };
    e.cantidad += Number(m.cantidad) || 0;
    e.valor += (Number(m.cantidad) || 0) * precioDe(m);
    e.movimientos += 1;
    if (!e.unidad && m.unidad) e.unidad = m.unidad;
    porInsumo.set(k, e);
  }
  const topInsumos = [...porInsumo.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, topN);

  // ── Por agotarse (de lo que salió, cuál está crítico/agotado) ──
  const RANK = { agotado: 0, critico: 1, ok: 2, desconocido: 3 };
  const porAgotarse = [...porInsumo.values()].map(e => {
    const c = catMap.get(catKey(e.cat, e.id));
    const stock = c ? Number(c.stock || 0) : null;
    const stockMin = c ? Number(c.stockMin || 0) : 0;
    let estado = 'desconocido';
    if (stock != null) {
      if (stock <= 0) estado = 'agotado';
      else if (stockMin > 0 && stock <= stockMin) estado = 'critico';
      else estado = 'ok';
    }
    const ratio = (stock != null && stockMin > 0) ? stock / stockMin : (stock != null ? stock + 1e6 : Infinity);
    return { cat: e.cat, id: e.id, nombre: e.nombre, unidad: e.unidad, salidas: e.cantidad, stock, stockMin, estado, ratio };
  }).sort((a, b) => (RANK[a.estado] - RANK[b.estado]) || (a.ratio - b.ratio) || (b.salidas - a.salidas)).slice(0, topN);

  // ── TOP personal (por salidas a su nombre) ──
  const porPersona = new Map();
  for (const m of salidas) {
    let k, nombre;
    if (m.subId) { k = 'sub:' + m.subId; nombre = (subById.get(m.subId)?.razon_social || 'Subcontrato') + ' (subc.)'; }
    else if (m.personaId) { k = 'per:' + m.personaId; const p = personalById.get(m.personaId); nombre = p ? (`${p.nombres || ''} ${p.apellidos || ''}`.trim() || '(persona)') : '(persona)'; }
    else { k = 'sin'; nombre = 'Sin responsable'; }
    const e = porPersona.get(k) || { key: k, nombre, cantidad: 0, movimientos: 0 };
    e.cantidad += Number(m.cantidad) || 0; e.movimientos += 1;
    porPersona.set(k, e);
  }
  const topPersonal = [...porPersona.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, topN);

  // ── TOP frentes ──
  const porFrente = new Map();
  for (const m of salidas) {
    const k = m.frenteId || 'sin';
    const nombre = m.frenteId ? (frenteById.get(m.frenteId) || 'Frente') : 'Sin frente';
    const e = porFrente.get(k) || { key: k, nombre, cantidad: 0, movimientos: 0 };
    e.cantidad += Number(m.cantidad) || 0; e.movimientos += 1;
    porFrente.set(k, e);
  }
  const topFrentes = [...porFrente.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, topN);

  const detalle = [...movs].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

  return {
    kpis: {
      totalSalidas: sum(salidas),
      totalEntradas: sum(entradas),
      totalDevoluciones: sum(devoluciones),
      nMovimientos: movs.length,
      insumosDistintos: porInsumo.size,
      valorSalidas: +salidas.reduce((a, m) => a + (Number(m.cantidad) || 0) * precioDe(m), 0).toFixed(2),
    },
    topInsumos, porAgotarse, topPersonal, topFrentes, detalle,
  };
}
