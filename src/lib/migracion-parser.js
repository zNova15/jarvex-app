// ═══════════════════════════════════════════════════════════════════
// JARVEX — Parser de migración histórica (SuperAdmin)
//
// La obra arrancó antes de tener JARVEX, así que meses de movimientos
// quedaron en Excel. Este módulo parsea los 5 formatos de migración y los
// normaliza a estructuras simples; la creación en Dexie + el resolver de
// items/ubicaciones/responsables vive en jx-migracion-import.jsx.
//
// Formatos (headers verbatim, leídos de ~/Downloads):
//   insumos_totales : ID · Nombre Insumo · Tipo · Unidad · Fecha de creacion
//   mov_materiales  : ID · Fecha de Movimiento · Material · Unidad · Cantidad
//                     · Tipo de Movimiento · Proveedor/Almacen de Salida
//                     · Resposable (Salida) · Lugar llega / Frente
//   mov_herramientas: ID · Fecha · Herramientas · Estado · Cantidad · Tipo
//                     · Proveedor/Responsible · Lugar llega / Frente
//   mov_epp         : ID · Fecha · EPP · Unidad · Cantidad · Tipo
//                     · Proveedor/Responsable · Lugar de llegada
//   mov_maquinaria  : ID · Fecha · EPP(*) · Estado · Cantidad · Tipo
//                     · Proveedor/Responsable · Lugar de llegada
//   (*) la columna del nombre viene mal rotulada "EPP" en el formato real.
//
// Todo es PURO (sin DOM ni Dexie) para que sea testeable.
// ═══════════════════════════════════════════════════════════════════

/** Normaliza un texto para comparar headers/nombres (sin acentos ni símbolos). */
export const normTxt = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

/** Metadatos de los 5 formatos: id, etiqueta y descripción para la UI. */
export const FORMATOS = {
  insumos_totales: { id: 'insumos_totales', label: 'Insumos Totales', icon: 'package',
    desc: 'Crea Materiales / Herramientas / Maquinaria / EPP. No genera movimientos ni stock.' },
  mov_materiales:  { id: 'mov_materiales', label: 'Movimientos de Materiales', icon: 'package',
    desc: 'Ingresos y salidas de materiales con fecha histórica.' },
  mov_herramientas:{ id: 'mov_herramientas', label: 'Movimientos de Herramientas', icon: 'tool',
    desc: 'Ingresos y salidas de herramientas con cantidad.' },
  mov_epp:         { id: 'mov_epp', label: 'Movimientos de EPP', icon: 'shield',
    desc: 'Entregas y reposiciones de EPP con fecha histórica.' },
  mov_maquinaria:  { id: 'mov_maquinaria', label: 'Movimientos de Maquinaria', icon: 'tool',
    desc: 'Ingresos y salidas de equipos pesados / maquinaria menor.' },
};

/**
 * Detecta cuál de los 5 formatos es a partir de los headers.
 * Devuelve el id del formato o null si no coincide con ninguno.
 */
export function detectFormato(headers) {
  const H = (headers || []).map(normTxt);
  const tiene = (txt) => { const n = normTxt(txt); return H.some((h) => h.includes(n) || n.includes(h)); };

  if (tiene('nombre insumo') && tiene('tipo')) return 'insumos_totales';
  if (!tiene('tipo de movimiento')) return null;

  if (tiene('material')) return 'mov_materiales';
  if (tiene('herramienta')) return 'mov_herramientas';
  // EPP y Maquinaria comparten la columna "EPP"; las distingue Unidad vs Estado.
  if (tiene('unidad') && !tiene('estado')) return 'mov_epp';
  if (tiene('estado')) return 'mov_maquinaria';
  return 'mov_epp';
}

// ── Date parsing ─────────────────────────────────────────────────────
// parseExcelFile lee con raw:false, así que las fechas llegan formateadas
// en formato US (M/D/YY) — p.ej. "5/25/26". También toleramos serial Excel
// e ISO. (No usamos excelDateToISO de apuParser porque ése asume dd/mm/yyyy
// y malinterpretaría "5/25/26".)
const iso = (y, m, d) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function parseFechaMigracion(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (!s) return null;

  // ISO ya formateado
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // Serial Excel puro (sin separadores)
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 59 && n < 200000) {
      const d = new Date((n - 25569) * 86400 * 1000);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }

  // M/D/YY · M/D/YYYY · YYYY/M/D (con / o -)
  const m = s.match(/^(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const p1 = parseInt(m[1], 10), p2 = parseInt(m[2], 10), p3 = parseInt(m[3], 10);
    if (m[1].length === 4) {                       // YYYY/M/D
      if (p2 >= 1 && p2 <= 12 && p3 >= 1 && p3 <= 31) return iso(p1, p2, p3);
    } else {
      const year = p3 < 100 ? 2000 + p3 : p3;
      let month, day;
      if (p1 > 12 && p2 <= 12) { day = p1; month = p2; }   // D/M/Y
      else { month = p1; day = p2; }                        // M/D/Y (default XLSX raw:false)
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return iso(year, month, day);
    }
  }
  return null;
}

// ── Helpers de fila ──────────────────────────────────────────────────
/** Devuelve un getter que busca el valor de una fila por nombre(s) de columna. */
function rowGetter(row) {
  const idx = {};
  for (const k of Object.keys(row || {})) idx[normTxt(k)] = k;
  return (...cands) => {
    for (const c of cands) {
      const key = idx[normTxt(c)];
      if (key != null) { const v = row[key]; if (v != null && String(v).trim() !== '') return v; }
    }
    // match parcial — exige ≥4 chars en ambos lados para no enganchar
    // columnas cortas como "ID" (p.ej. "salida"/"unidad" contienen "id").
    for (const c of cands) {
      const nc = normTxt(c);
      if (nc.length < 4) continue;
      const hit = Object.keys(idx).find((nk) => nk && nk.length >= 4 && (nk.includes(nc) || nc.includes(nk)));
      if (hit) { const v = row[idx[hit]]; if (v != null && String(v).trim() !== '') return v; }
    }
    return null;
  };
}

const txt = (v) => (v == null ? null : String(v).trim() || null);
const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };

/** "Ingreso"/"Entrada" → 'entrada'; "Salida" → 'salida'. */
export function normalizaTipoMov(v) {
  const n = normTxt(v);
  if (!n) return null;
  if (n.startsWith('ingr') || n.startsWith('entr') || n.includes('compra')) return 'entrada';
  if (n.startsWith('sal') || n.includes('despacho') || n.includes('consumo')) return 'salida';
  return null;
}

/** Clasifica el Tipo de un insumo a su tabla destino. */
export function clasificaTipoInsumo(v) {
  const n = normTxt(v);
  if (n.includes('material')) return 'materiales';
  if (n.includes('herramient')) return 'herramientas';
  if (n.includes('maquinaria') || n.includes('equipo') || n.includes('activo')) return 'activos_pesados';
  if (n.includes('epp')) return 'epps';
  return null; // desconocido
}

// ── Parsers ──────────────────────────────────────────────────────────

/** Formato "Insumos Totales" → [{ nombre, tipo (tabla), tipoRaw, unidad, fechaCreacion }] */
export function parseInsumosTotales(rows) {
  const out = [];
  (rows || []).forEach((row, i) => {
    const g = rowGetter(row);
    const nombre = txt(g('Nombre Insumo', 'Insumo', 'Nombre'));
    if (!nombre) return;
    const tipoRaw = txt(g('Tipo'));
    out.push({
      idx: i + 2,
      nombre,
      tipoRaw,
      tipo: clasificaTipoInsumo(tipoRaw),
      unidad: txt(g('Unidad')) || 'Und',
      fechaCreacion: parseFechaMigracion(g('Fecha de creacion', 'Fecha de creación', 'Fecha creacion', 'Fecha')),
    });
  });
  return out;
}

/**
 * Parser unificado de movimientos. `formato` ∈ mov_materiales | mov_epp |
 * mov_herramientas | mov_maquinaria. Devuelve filas normalizadas con la
 * semántica de origen/responsable/lugar resuelta por el caller.
 */
export function parseMovimientos(rows, formato) {
  const out = [];
  const itemCols = {
    mov_materiales:  ['Material'],
    mov_epp:         ['EPP'],
    mov_herramientas:['Herramientas', 'Herramienta'],
    mov_maquinaria:  ['EPP', 'Maquinaria', 'Equipo'],
  }[formato] || ['Material'];

  (rows || []).forEach((row, i) => {
    const g = rowGetter(row);
    const nombreItem = txt(g(...itemCols));
    if (!nombreItem) return;
    const tipo = normalizaTipoMov(g('Tipo de Movimiento', 'Tipo'));
    out.push({
      idx: i + 2,
      fecha: parseFechaMigracion(g('Fecha de Movimiento', 'Fecha')),
      nombreItem,
      unidad: txt(g('Unidad')),
      estado: txt(g('Estado')),
      cantidad: num(g('Cantidad')),
      tipo, // 'entrada' | 'salida' | null
      // proveedor (ingreso) / almacén de salida (salida materiales)
      origen: txt(g('Proveedor/Almacen de Salida', 'Proveedor/Responsable', 'Proveedor/Responsible', 'Proveedor')),
      // responsable que retira (salida)
      responsable: txt(g('Resposable (Salida)', 'Responsable (Salida)', 'Responsable', 'Proveedor/Responsable', 'Proveedor/Responsible')),
      // lugar de llegada (ingreso = almacén) / frente (salida)
      lugar: txt(g('Lugar llega / Frente', 'Lugar de llegada', 'Lugar', 'Frente')),
    });
  });
  return out;
}

/** Resumen de un parse de movimientos para el preview. */
export function resumenMovimientos(parsed) {
  const r = { total: parsed.length, entradas: 0, salidas: 0, sinTipo: 0, sinFecha: 0, sinCantidad: 0, items: new Set() };
  for (const p of parsed) {
    if (p.tipo === 'entrada') r.entradas++;
    else if (p.tipo === 'salida') r.salidas++;
    else r.sinTipo++;
    if (!p.fecha) r.sinFecha++;
    if (!(p.cantidad > 0)) r.sinCantidad++;
    if (p.nombreItem) r.items.add(normTxt(p.nombreItem));
  }
  r.itemsUnicos = r.items.size;
  return r;
}
