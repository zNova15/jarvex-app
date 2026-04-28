// ─────────────────────────────────────────────────────────────
// Parsers S10 — JARVEX soporta 3 formatos exportados de S10:
//   1) APU completo (Análisis de Precios Unitarios) — partidas + insumos
//   2) Lista de insumos consolidada — catálogo de materiales/MO/equipo
//   3) Cronograma Gantt — código + descripción + fechas + dependencias
// `detectS10Type(rows)` infiere automáticamente cuál es.
// ─────────────────────────────────────────────────────────────
//
// Estructura por bloque (cada partida):
//   Fila A: ["Partida: <codigo>", ..., "Cant. Total:", "<num> <unidad>"]
//   Fila B: ["<descripción>"] (col 0 ó 1)
//   Fila C: header "Código","Descripción", ..., "Unid.","Cantidad",..., "Costo","Total"
//   Fila D: header categoría en col 1 (MANO DE OBRA | MATERIALES | EQUIPO | SUBCONTRATO | SUBPARTIDA)
//   Filas E…: insumos (col 0=codigo, 1=descripcion, 8=unidad, 9=cantidad, 12=precio, 13=total)
//   Fila final: col 12 = "TOTAL:", col 13 = costo total partida
// ─────────────────────────────────────────────────────────────

import * as XLSX from 'xlsx';

const CATS = {
  'MANO DE OBRA': 'mano_obra',
  'MATERIALES':   'material',
  'EQUIPO':       'equipo',
  'SUBCONTRATO':  'subcontrato',
  'SUBPARTIDA':   'subpartida',
};

// Helper: detecta los índices de columnas de un header de tabla APU.
// El header tiene "Código", "Descripción", "Unid.", "Cantidad", "Costo", "Total"
// en posiciones que pueden variar entre exports de S10 (a veces hay columnas
// vacías extras). Devuelve { codigo, descripcion, unidad, cantidad, costo, total }.
function detectColumnasHeader(headerRow) {
  if (!headerRow) return null;
  const idx = { codigo:-1, descripcion:-1, unidad:-1, cantidad:-1, costo:-1, total:-1 };
  for (let c = 0; c < headerRow.length; c++) {
    const v = String(headerRow[c] ?? '').trim().toLowerCase();
    if (!v) continue;
    if (v === 'código' || v === 'codigo' || v === 'cod.') idx.codigo = c;
    else if (v === 'descripción' || v === 'descripcion' || v === 'recurso') idx.descripcion = c;
    else if (v === 'unid.' || v === 'unidad' || v === 'und.' || v === 'und') idx.unidad = c;
    else if (v === 'cantidad' || v === 'cant.') idx.cantidad = c;
    else if (v === 'costo' || v === 'precio' || v === 'precio unit.' || v === 'p.u.') idx.costo = c;
    else if (v === 'total' || v === 'parcial') idx.total = c;
  }
  // Fallback: si no detectó costo/total pero idx.unidad y idx.cantidad están,
  // asume las dos últimas columnas con datos numéricos son costo/total.
  if (idx.unidad >= 0 && idx.cantidad >= 0 && (idx.costo < 0 || idx.total < 0)) {
    idx.costo  = idx.costo  >= 0 ? idx.costo  : headerRow.length - 2;
    idx.total  = idx.total  >= 0 ? idx.total  : headerRow.length - 1;
  }
  // Si algo crítico falta, retorna null para fallar al fallback hardcoded.
  if (idx.codigo < 0 || idx.descripcion < 0 || idx.unidad < 0 || idx.cantidad < 0) return null;
  return idx;
}

// ─── Núcleo: parsea filas (array of arrays) → partidas ───────
export function parseAPU(rows) {
  const partidas = [];
  let current = null;
  let categoriaActual = null;
  // Layout actual de columnas — se actualiza por bloque cuando se detecta el header
  let cols = { codigo:0, descripcion:1, unidad:8, cantidad:9, costo:12, total:13 };
  const errores = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const c0 = r[0];

    if (typeof c0 === 'string' && c0.startsWith('Partida:')) {
      if (current) partidas.push(current);
      const codigo = c0.replace('Partida:', '').trim();
      // Descripción: la primera celda string no-categoría/no-header en las
      // próximas 3 filas (algunos exports tienen una fila vacía intermedia).
      let desc = '';
      for (let k = 1; k <= 3 && (i + k) < rows.length; k++) {
        const candidate = rows[i + k];
        if (!candidate) continue;
        for (let j = 0; j < Math.min(3, candidate.length); j++) {
          const v = candidate[j];
          if (typeof v === 'string' && v.trim()) {
            const t = v.trim();
            if (t === 'Código' || t === 'Codigo' || t === 'Código:') break;
            if (CATS[t]) break;
            if (t.startsWith('Partida:')) break;
            desc = t;
            break;
          }
        }
        if (desc) break;
      }
      // Cantidad total: se busca el "Cant. Total:" en cualquier columna del row
      // y se toma la celda inmediatamente siguiente con valor.
      let cantidad = null, unidad = null;
      for (let j = 0; j < r.length; j++) {
        const v = String(r[j] ?? '').trim();
        if (v === 'Cant. Total:' || v === 'Cant.Total:') {
          // Buscar el primer valor no nulo después de esta celda
          for (let k = j + 1; k < r.length; k++) {
            const cell = r[k];
            if (cell == null || cell === '') continue;
            const s = String(cell).trim();
            const m = s.match(/^([\d.,]+)\s*(.*)$/);
            if (m) {
              cantidad = parseFloat(String(m[1]).replace(/,/g, ''));
              unidad = (m[2] || '').trim() || null;
            } else if (Number.isFinite(Number(cell))) {
              cantidad = Number(cell);
            }
            break;
          }
          break;
        }
      }
      current = {
        codigo,
        descripcion: String(desc).trim(),
        cantidad: Number.isFinite(cantidad) ? cantidad : null,
        unidad: unidad || null,
        costo_total: null,
        insumos: [],
      };
      categoriaActual = null;
      continue;
    }
    if (!current) continue;

    const c1 = r[1];

    // Detectar header de tabla del bloque ("Código","Descripción",...,"Costo","Total")
    if (typeof c0 === 'string' && (c0.trim() === 'Código' || c0.trim() === 'Codigo')) {
      const detected = detectColumnasHeader(r);
      if (detected) cols = detected;
      continue;
    }

    // Categoría
    if (typeof c1 === 'string' && CATS[c1.trim()]) {
      categoriaActual = CATS[c1.trim()];
      continue;
    }

    // Línea final "TOTAL:"  (puede estar en col costo-1 o costo)
    const totalLabelIdx = (() => {
      for (let j = 0; j < r.length; j++) {
        if (typeof r[j] === 'string' && r[j].trim() === 'TOTAL:') return j;
      }
      return -1;
    })();
    if (totalLabelIdx >= 0) {
      // Costo total está después del label
      for (let k = totalLabelIdx + 1; k < r.length; k++) {
        const cell = r[k];
        if (cell != null && cell !== '' && Number.isFinite(Number(cell))) {
          current.costo_total = Number(cell);
          break;
        }
      }
      continue;
    }

    // Insumo: hay código (o categoría sin código pero con descripción y cantidad)
    if (categoriaActual && r[cols.descripcion] && r[cols.unidad] && r[cols.cantidad] != null) {
      const codigo = r[cols.codigo] != null && r[cols.codigo] !== ''
        ? String(r[cols.codigo]).trim() : '';
      // Filtrar la fila de "MANO DE OBRA" / "MATERIALES" que ya pasó como categoria
      if (!codigo && CATS[String(r[cols.descripcion]).trim()]) continue;
      current.insumos.push({
        codigo,
        descripcion: String(r[cols.descripcion]).trim(),
        categoria: categoriaActual,
        unidad: String(r[cols.unidad]).trim(),
        cantidad: Number(r[cols.cantidad]) || 0,
        precio_unitario: Number(r[cols.costo]) || 0,
        total: Number(r[cols.total]) || 0,
      });
    }
  }
  if (current) partidas.push(current);

  partidas.forEach((p, idx) => {
    if (!p.codigo) errores.push({ idx, msg: 'Partida sin código' });
  });

  return { partidas, errores };
}

// ─── Lee un File (xlsx/xls) y devuelve las partidas + summary ──
export function parseAPUFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        // header:1 → array of arrays; defval:null mantiene celdas vacías
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
        const { partidas, errores } = parseAPU(rows);
        const conInsumos = partidas.filter(p => p.insumos.length > 0).length;
        const totalInsumos = partidas.reduce((s, p) => s + p.insumos.length, 0);
        resolve({
          partidas,
          summary: {
            total: partidas.length,
            conInsumos,
            totalInsumos,
            errores: errores.length,
            erroresList: errores,
            sheetName: wb.SheetNames[0],
          },
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ─── Calcula nivel + parent_codigo a partir del código S10 ────
export function enrichJerarquia(partidas) {
  return partidas.map((p, idx) => {
    const codigo = p.codigo || '';
    const segs = codigo.split('.').filter(Boolean);
    const nivel = segs.length; // "02" → 1, "02.01.01" → 3
    const parent_codigo = segs.length > 1 ? segs.slice(0, -1).join('.') : null;
    return { ...p, nivel, parent_codigo, orden: idx };
  });
}

// ─── Construye árbol jerárquico para preview/reportes ─────────
export function buildArbol(partidas) {
  const enriched = partidas[0]?.nivel ? partidas : enrichJerarquia(partidas);
  const byCodigo = new Map();
  enriched.forEach(p => byCodigo.set(p.codigo, { ...p, hijos: [] }));
  const roots = [];
  enriched.forEach(p => {
    const node = byCodigo.get(p.codigo);
    if (p.parent_codigo && byCodigo.has(p.parent_codigo)) {
      byCodigo.get(p.parent_codigo).hijos.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

// ═══════════════════════════════════════════════════════════════════
// LISTA DE INSUMOS CONSOLIDADA
// Formato: header en fila 1 → "Cod. | Descripcion | Proveedor | Cantidad |
// %Desp. | Cant. Total | Precio Unit. | Total". Filas con solo el primer
// campo (sin código numérico) son cabeceras de categoría: "MANO DE OBRA",
// "MATERIALES", "EQUIPO".
// ═══════════════════════════════════════════════════════════════════

const CAT_HEADERS = {
  'MANO DE OBRA':  'mano_obra',
  'MATERIALES':    'material',
  'EQUIPO':        'equipo',
  'EQUIPOS':       'equipo',
  'SUBCONTRATO':   'subcontrato',
  'SUBCONTRATOS':  'subcontrato',
  'SUBPARTIDA':    'subpartida',
  'SUBPARTIDAS':   'subpartida',
};

export function parseInsumosList(rows) {
  const insumos = [];
  let categoriaActual = null;

  // Detectar fila header (la que tiene "Cod." o "Codigo" en col 0/1)
  let startIdx = 0;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const r = rows[i] || [];
    const first = String(r[0] || '').trim().toLowerCase();
    if (first === 'cod.' || first === 'codigo' || first === 'código') {
      startIdx = i + 1;
      break;
    }
  }

  for (let i = startIdx; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const c0 = String(r[0] ?? '').trim();
    const c1 = String(r[1] ?? '').trim();

    // Cabecera de categoría
    if (c0 && CAT_HEADERS[c0.toUpperCase()] && !c1 && !r[7]) {
      categoriaActual = CAT_HEADERS[c0.toUpperCase()];
      continue;
    }
    if (!categoriaActual) continue;

    // Insumo: necesita código (string numérico) y descripción
    if (c0 && c1 && /^\d+$/.test(c0)) {
      insumos.push({
        codigo: c0,
        descripcion: c1,
        proveedor: String(r[2] ?? '').trim() || null,
        categoria: categoriaActual,
        cantidad: Number(r[3]) || 0,
        desperdicio_pct: Number(r[4]) || 0,
        cantidad_total: Number(r[5]) || 0,
        precio_unitario: Number(r[6]) || 0,
        total: Number(r[7]) || 0,
        unidad: '', // no viene en este export — se infiere desde APU si existe
      });
    }
  }
  return insumos;
}

// ═══════════════════════════════════════════════════════════════════
// CRONOGRAMA GANTT
// Header: Numeracion | Descripción | Duración | Inicio | Fin |
//         Predecesoras | % Avance | Días Cal.
// Inicio/Fin en formato Excel serial number (días desde 1900-01-01).
// ═══════════════════════════════════════════════════════════════════

// Convierte un Excel serial date / string a ISO string (YYYY-MM-DD).
// Acepta:
//   - número serial Excel (días desde 1900-01-01, con bug bisiesto 1900)
//   - string ISO "YYYY-MM-DD..."
//   - string formato regional dd/mm/yyyy o dd-mm-yyyy (export MS Project)
//   - Date object
export function excelDateToISO(serial) {
  if (serial == null || serial === '') return null;
  if (serial instanceof Date) {
    if (isNaN(serial.getTime())) return null;
    return serial.toISOString().slice(0, 10);
  }
  if (typeof serial === 'string') {
    const s = serial.trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    // dd/mm/yyyy o dd-mm-yyyy (formato regional MS Project es-PE)
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
      const dd = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10);
      let yyyy = parseInt(m[3], 10);
      if (yyyy < 100) yyyy += 2000;
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        return `${yyyy.toString().padStart(4,'0')}-${mm.toString().padStart(2,'0')}-${dd.toString().padStart(2,'0')}`;
      }
    }
  }
  const n = Number(serial);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = (n - 25569) * 86400 * 1000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function parseGantt(rows) {
  const tareas = [];
  let startIdx = 0;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const r = rows[i] || [];
    const first = String(r[0] || '').trim().toLowerCase();
    if (first === 'numeracion' || first === 'id' || first.startsWith('numer')) {
      startIdx = i + 1;
      break;
    }
  }
  for (let i = startIdx; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const codigo = String(r[0] ?? '').trim();
    const desc   = String(r[1] ?? '').trim();
    if (!codigo || !desc) continue;
    // Filtrar filas que no son códigos jerárquicos (p.ej. headers o resúmenes)
    if (!/^\d+(\.\d+)*$/.test(codigo)) continue;

    tareas.push({
      codigo,
      descripcion: desc,
      duracion_dias: Number(r[2]) || null,
      fecha_inicio: excelDateToISO(r[3]),
      fecha_fin:    excelDateToISO(r[4]),
      predecesoras: String(r[5] ?? '').trim() || null,
      porcentaje_avance: Number(r[6]) || 0,
      dias_calendario: Number(r[7]) || null,
    });
  }
  return tareas;
}

// ═══════════════════════════════════════════════════════════════════
// AUTO-DETECCIÓN DEL TIPO DE ARCHIVO S10
// Devuelve 'apu' | 'insumos' | 'gantt' | 'desconocido'.
// ═══════════════════════════════════════════════════════════════════
export function detectS10Type(rows) {
  if (!rows || rows.length === 0) return 'desconocido';

  // 1) APU: contiene "Partida: <codigo>" en la columna 0 de alguna fila
  //    cercana al inicio.
  for (let i = 0; i < Math.min(50, rows.length); i++) {
    const c0 = String((rows[i] || [])[0] || '');
    if (c0.startsWith('Partida:')) return 'apu';
  }

  // 2) Header de Gantt: "Numeracion" en col 0 + "Inicio" o "Duracion" en otras
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const r = (rows[i] || []).map(c => String(c ?? '').trim().toLowerCase());
    if (r[0] && (r[0] === 'numeracion' || r[0].startsWith('numer'))) {
      if (r.includes('inicio') || r.includes('fin') || r.includes('duración') || r.includes('duracion')) {
        return 'gantt';
      }
    }
  }

  // 3) Header de Lista de Insumos: "Cod./Codigo/Código" en col 0 +
  //    "Precio Unit." o "Cant. Total" en otras
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const r = (rows[i] || []).map(c => String(c ?? '').trim().toLowerCase());
    const first = r[0] || '';
    if (first === 'cod.' || first === 'codigo' || first === 'código') {
      if (r.some(c => c.startsWith('precio')) || r.some(c => c.startsWith('cant'))) {
        return 'insumos';
      }
    }
  }

  return 'desconocido';
}

// ═══════════════════════════════════════════════════════════════════
// PARSE FILE: lee el archivo y devuelve { tipo, data, summary }
// ═══════════════════════════════════════════════════════════════════
export async function parseS10File(file) {
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(new Uint8Array(e.target.result));
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
  const wb = XLSX.read(data, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const tipo = detectS10Type(rows);

  if (tipo === 'apu') {
    const { partidas, errores } = parseAPU(rows);
    const enriched = enrichJerarquia(partidas);
    return {
      tipo,
      data: enriched,
      summary: {
        partidas: partidas.length,
        insumos: partidas.reduce((s, p) => s + p.insumos.length, 0),
        errores: errores.length,
      },
    };
  }
  if (tipo === 'insumos') {
    const insumos = parseInsumosList(rows);
    const porCat = insumos.reduce((m, i) => {
      m[i.categoria] = (m[i.categoria] || 0) + 1;
      return m;
    }, {});
    return {
      tipo,
      data: insumos,
      summary: {
        total: insumos.length,
        materiales: porCat.material || 0,
        mano_obra:  porCat.mano_obra || 0,
        equipo:     porCat.equipo || 0,
      },
    };
  }
  if (tipo === 'gantt') {
    const tareas = parseGantt(rows);
    const fechas = tareas.map(t => t.fecha_inicio).filter(Boolean).sort();
    const fines  = tareas.map(t => t.fecha_fin).filter(Boolean).sort();
    return {
      tipo,
      data: tareas,
      summary: {
        total: tareas.length,
        fecha_inicio: fechas[0] || null,
        fecha_fin:    fines[fines.length - 1] || null,
      },
    };
  }
  return { tipo: 'desconocido', data: [], summary: {} };
}
