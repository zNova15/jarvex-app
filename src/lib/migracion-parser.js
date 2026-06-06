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

/** Metadatos de los formatos: id, etiqueta y descripción para la UI.
 * "Insumos Totales" quedó retirado: ahora el catálogo se completa solo al
 * cargar movimientos (con paso de revisión de items en el wizard). */
export const FORMATOS = {
  mov_materiales:  { id: 'mov_materiales', label: 'Movimientos de Materiales', icon: 'package',
    desc: 'Ingresos y salidas de materiales con fecha histórica.' },
  mov_herramientas:{ id: 'mov_herramientas', label: 'Movimientos de Herramientas', icon: 'tool',
    desc: 'Ingresos y salidas de herramientas con cantidad.' },
  mov_epp:         { id: 'mov_epp', label: 'Movimientos de EPP', icon: 'shield',
    desc: 'Entregas y reposiciones de EPP con fecha histórica.' },
  mov_maquinaria:  { id: 'mov_maquinaria', label: 'Movimientos de Maquinaria', icon: 'tool',
    desc: 'Ingresos y salidas de equipos pesados / maquinaria menor.' },
  insumos_emergencia: { id: 'insumos_emergencia', label: 'Insumos de Emergencia (catálogo)', icon: 'package',
    desc: 'Crea el inventario de insumos de emergencia (SSOMA). Sin stock ni movimientos.' },
  mov_emergencia:  { id: 'mov_emergencia', label: 'Movimientos de Insumos de Emergencia', icon: 'shield',
    desc: 'Ingresos y salidas de insumos de emergencia con fecha histórica.' },
  mov_maquinaria_asignacion: { id: 'mov_maquinaria_asignacion', label: 'Asignaciones de Maquinaria (custodia)', icon: 'tool',
    desc: 'Salidas (asignación a personal/subcontrato) y devoluciones de equipos pesados, con fecha.' },
};

/**
 * Detecta cuál de los 5 formatos es a partir de los headers.
 * Devuelve el id del formato o null si no coincide con ninguno.
 */
export function detectFormato(headers) {
  const H = (headers || []).map(normTxt);
  const tiene = (txt) => { const n = normTxt(txt); return H.some((h) => h.includes(n) || n.includes(h)); };

  // Emergencia: si algún header menciona "emergencia" mandamos a su flujo
  // (catálogo si no hay tipo de movimiento, si no movimientos). Va primero
  // para que un archivo separado de emergencia no caiga en Insumos Totales.
  if (H.some((h) => h.includes('emergencia'))) {
    return tiene('tipo de movimiento') ? 'mov_emergencia' : 'insumos_emergencia';
  }

  // Asignaciones de maquinaria: el header "Asignado a" / "Asignar a" lo
  // distingue de los movimientos por cantidad. (Su template usa "Movimiento",
  // no "Tipo de Movimiento", así que va antes del gate de abajo.)
  if (H.some((h) => h.includes('asigna'))) return 'mov_maquinaria_asignacion';

  // (Insumos Totales se retiró del flujo — el catálogo lo crea el paso de
  // revisión al cargar movimientos.)
  // Para ser mov_*, requerimos que ALGÚN header contenga "movimiento" — así
  // no confundimos un archivo con columna sola "Tipo" (catálogo viejo).
  const tieneMovimiento = H.some((h) => h.includes('movimiento'));
  if (!tieneMovimiento) return null;
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
// Como num pero devuelve null si está vacío (para precio: no forzar 0).
const numN = (v) => { if (v == null || String(v).trim() === '') return null; const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null; };

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
  // 'emergencia' va primero: "Insumo de Emergencia" contiene "insumo" pero
  // debe ir a su inventario propio (SSOMA), no a materiales.
  if (n.includes('emergencia')) return 'insumos_emergencia';
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

/** Formato catálogo "Insumos de Emergencia" → [{ nombre, categoria, unidad, fechaCreacion }] */
export function parseInsumosEmergencia(rows) {
  const out = [];
  (rows || []).forEach((row, i) => {
    const g = rowGetter(row);
    const nombre = txt(g('Insumo de Emergencia', 'Nombre Insumo', 'Insumo', 'Nombre'));
    if (!nombre) return;
    out.push({
      idx: i + 2,
      nombre,
      categoria: txt(g('Categoria', 'Categoría')),
      unidad: txt(g('Unidad')) || 'Und',
      fechaCreacion: parseFechaMigracion(g('Fecha de creacion', 'Fecha de creación', 'Fecha creacion', 'Fecha')),
    });
  });
  return out;
}

/**
 * Parser unificado de movimientos. `formato` ∈ mov_materiales | mov_epp |
 * mov_herramientas | mov_maquinaria | mov_emergencia. Devuelve filas normalizadas con la
 * semántica de origen/responsable/lugar resuelta por el caller.
 */
export function parseMovimientos(rows, formato) {
  const out = [];
  const itemCols = {
    mov_materiales:  ['Material'],
    mov_epp:         ['EPP'],
    mov_herramientas:['Herramientas', 'Herramienta'],
    mov_maquinaria:  ['EPP', 'Maquinaria', 'Equipo'],
    mov_emergencia:  ['Insumo de Emergencia', 'Insumo', 'EPP', 'Material', 'Nombre'],
  }[formato] || ['Material'];

  (rows || []).forEach((row, i) => {
    const g = rowGetter(row);
    // Getter EXACTO (sin match parcial). Las columnas NUEVAS de la plantilla
    // mejorada se leen exacto para no engancharse con headers viejos combinados:
    // p.ej. 'Almacén' NO debe leer 'Proveedor/Almacen de Salida' por substring.
    const gE = (...cands) => {
      for (const c of cands) {
        const key = Object.keys(row || {}).find((k) => normTxt(k) === normTxt(c));
        if (key != null) { const v = row[key]; if (v != null && String(v).trim() !== '') return v; }
      }
      return null;
    };
    const nombreItem = txt(g(...itemCols));
    if (!nombreItem) return;
    const tipo = normalizaTipoMov(g('Tipo de Movimiento', 'Tipo'));
    out.push({
      idx: i + 2,
      fecha: parseFechaMigracion(g('Fecha de Movimiento', 'Fecha')),
      hora: txt(gE('Hora')),
      nombreItem,
      categoria: txt(gE('Categoría', 'Categoria')),
      unidad: txt(g('Unidad')),
      estado: txt(g('Estado')),
      cantidad: num(g('Cantidad')),
      tipo, // 'entrada' | 'salida' | null
      // proveedor (ingreso) / almacén de salida (salida materiales) — col. combinada vieja
      origen: txt(g('Proveedor/Almacen de Salida', 'Proveedor/Responsable', 'Proveedor/Responsible', 'Proveedor')),
      // Plantilla mejorada: columnas SEPARADAS, leídas EXACTO (gE) para no
      // confundirse con la columna combinada vieja (backward-compat: en plantillas
      // viejas estas quedan null y el loader cae a origen/lugar como antes).
      proveedor: txt(gE('Proveedor')),
      almacen: txt(gE('Almacén', 'Almacen', 'Almacén de Salida', 'Almacen de Salida', 'Almacén de salida')),
      subcontrato: txt(gE('Subcontrato', 'Subcontratista')),
      documento: txt(gE('Documento', 'Documento Asociado', 'Vale', 'Guía', 'Guia', 'N° Vale', 'N° Guía')),
      precio: numN(gE('Precio Unit. (S/)', 'Precio Unitario', 'Precio Unit.', 'Precio unitario', 'Precio')),
      observaciones: txt(gE('Observaciones', 'Observación', 'Observacion')),
      // responsable que retira (salida) — flexible (en EPP/herr viejos viene de la col. combinada)
      responsable: txt(g('Resposable (Salida)', 'Responsable (Salida)', 'Responsable', 'Proveedor/Responsable', 'Proveedor/Responsible')),
      // lugar de llegada (ingreso = almacén) / frente (salida) — col. vieja
      lugar: txt(g('Lugar llega / Frente', 'Lugar de llegada', 'Lugar', 'Frente')),
      frente: txt(gE('Frente / Zona', 'Frente', 'Zona')),
    });
  });
  return out;
}

/**
 * Asignaciones de maquinaria (custodia). Devuelve filas normalizadas:
 * { idx, fecha, equipo, tipo ('salida'|'entrada'), destinoTipo
 * ('personal'|'subcontratista'|null), destinoNombre, observaciones }.
 * Salida = asignación; Devolución/Ingreso = entrada (vuelve al pool).
 */
export function parseMovMaquinariaAsignacion(rows) {
  const out = [];
  (rows || []).forEach((row, i) => {
    const g = rowGetter(row);
    const equipo = txt(g('Equipo', 'Maquinaria', 'Activo', 'Nombre'));
    if (!equipo) return;
    const movRaw = normTxt(g('Movimiento', 'Tipo de Movimiento', 'Tipo'));
    let tipo = null;
    if (movRaw.startsWith('sal') || movRaw.includes('asign')) tipo = 'salida';
    else if (movRaw.startsWith('dev') || movRaw.startsWith('ingr') || movRaw.startsWith('entr')) tipo = 'entrada';
    const dt = normTxt(g('Tipo destino', 'Asignar a', 'Destino tipo', 'Destino'));
    const destinoTipo = dt.includes('subcontr') ? 'subcontratista'
      : (dt.includes('personal') || dt.includes('trabajad')) ? 'personal' : null;
    out.push({
      idx: i + 2,
      fecha: parseFechaMigracion(g('Fecha', 'Fecha de Movimiento')),
      hora: txt(g('Hora')),
      equipo,
      tipo,
      destinoTipo,
      destinoNombre: txt(g('Asignado a', 'Asignado', 'Responsable', 'Proveedor/Responsable')),
      frente: txt(g('Frente / Zona', 'Frente', 'Zona')),
      observaciones: txt(g('Observación', 'Observacion', 'Observaciones')),
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
