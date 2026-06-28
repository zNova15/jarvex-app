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
import { normalizeCodigo } from './match-helpers.js';

// Unidades de PORCENTAJE de Delphin (%mo = % de mano de obra, %eq, etc.). En el
// APU la cantidad viene como porcentaje ENTERO (2.994 = 2.994%), no como fracción.
// Como costo = cantidad × precio (columna generada en BD), guardarla tal cual
// infla el costo ×100. Hay que dividirla entre 100 para dejarla como fracción.
export const esUnidadPorcentaje = (u) => /^\s*%/.test(String(u || ''));

const CATS = {
  'MANO DE OBRA': 'mano_obra',
  'MATERIALES':   'material',
  'EQUIPO':       'equipo',
  'SUBCONTRATO':  'subcontrato',
  'SUBPARTIDA':   'subpartida',
};

// Detector flexible de categorías. Antes solo matcheaba el texto EXACTO
// de CATS. Pero algunos exports de Delphin/S10 traen variantes:
// "MATERIAL" (singular), "EQUIPOS" (plural), "EQUIPO DE TRABAJO", etc.
// Si no detecta la categoría, ningún insumo de esa partida entra al
// import — la partida queda como "sin insumos cargados".
function detectarCategoria(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const t = raw.trim().toUpperCase();
  if (!t) return null;
  // Match exacto primero
  if (CATS[t]) return CATS[t];
  // Mano de obra: "MANO DE OBRA", "M.O.", "MANO OBRA"
  if (/^(MANO\s*(DE\s*)?OBRA|M\.?O\.?)$/i.test(t)) return 'mano_obra';
  // Materiales: "MATERIAL", "MATERIALES"
  if (/^MATERIAL(ES)?$/i.test(t)) return 'material';
  // Equipos: "EQUIPO", "EQUIPOS", "EQUIPO DE TRABAJO", "EQUIPOS Y HERRAMIENTAS"
  if (/^EQUIPOS?(\s+.*)?$/i.test(t)) return 'equipo';
  // Subcontrato(s)
  if (/^SUBCONTRATOS?$/i.test(t)) return 'subcontrato';
  // Subpartida(s)
  if (/^SUBPARTIDAS?$/i.test(t)) return 'subpartida';
  return null;
}

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

    // Categoría — flexible: acepta variantes ("MATERIAL", "EQUIPOS", etc.)
    {
      const catC1 = typeof c1 === 'string' ? detectarCategoria(c1) : null;
      if (catC1) { categoriaActual = catC1; continue; }
      // A veces el header de categoría está en col 0 en exports nuevos
      const catC0 = typeof c0 === 'string' ? detectarCategoria(c0) : null;
      if (catC0) { categoriaActual = catC0; continue; }
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

    // Insumo: condiciones más permisivas que antes.
    //   - Antes requería unidad NO vacía → algunos S10 dejan la celda en
    //     blanco y la partida acababa sin insumos. Ahora aceptamos sin
    //     unidad (default 'und').
    //   - Antes requería cantidad != null → ahora aceptamos sin cantidad
    //     (default 0) si descripcion+precio están presentes.
    if (categoriaActual && r[cols.descripcion]) {
      const desc = String(r[cols.descripcion]).trim();
      if (!desc) continue;
      // Filtrar la fila de "MANO DE OBRA" / "MATERIALES" / variantes que
      // ya pasaron como categoria (no son insumos)
      if (detectarCategoria(desc)) continue;
      const codigo = r[cols.codigo] != null && r[cols.codigo] !== ''
        ? String(r[cols.codigo]).trim() : '';
      const unidad = String(r[cols.unidad] ?? 'und').trim() || 'und';
      let cantidad = Number(r[cols.cantidad]) || 0;
      const precio = Number(r[cols.costo]) || 0;
      const total = Number(r[cols.total]) || 0;
      // Aceptar el insumo si tiene al menos algún dato económico real
      // (cantidad o precio o total). Las filas vacías intermedias se filtran.
      if (cantidad === 0 && precio === 0 && total === 0) continue;
      // Unidad de porcentaje (%mo, …): el APU trae el % entero (2.994). Lo
      // pasamos a fracción para que costo = cantidad × precio no quede ×100.
      if (esUnidadPorcentaje(unidad) && cantidad > 1) cantidad = cantidad / 100;
      current.insumos.push({
        codigo,
        descripcion: desc,
        categoria: categoriaActual,
        unidad,
        cantidad, precio_unitario: precio, total,
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

// % de avance de una tarea del Gantt. Si la celda viene formateada como Porcentaje, Excel
// guarda el valor como FRACCIÓN (0.6401 = 64.01%): lo detectamos por el "%" del texto
// formateado (rowsTexto, raw:false) y lo escalamos ×100. Si es número plano, se asume 0-100.
export function parsePctGantt(raw, textoFormateado) {
  const n = Number(raw) || 0;
  return /%/.test(String(textoFormateado ?? '')) ? n * 100 : n;
}

export function parseGantt(rows, rowsTexto = null) {
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
    let codigo = String(r[0] ?? '').trim();
    // Código numérico con cero final perdido ("2.10" → 2.1): preferir el
    // texto formateado de la celda si es un código jerárquico válido.
    if (typeof r[0] === 'number') {
      const texto = String(rowsTexto?.[i]?.[0] ?? '').trim();
      if (/^\d+(\.\d+)*$/.test(texto)) codigo = texto;
    }
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
      porcentaje_avance: parsePctGantt(r[6], rowsTexto?.[i]?.[6]),
      dias_calendario: Number(r[7]) || null,
    });
  }
  // Marcar capítulos/títulos: una tarea es capítulo si su código es prefijo
  // estricto de otro (existe otra tarea cuyo código empieza con "codigo.").
  // Los capítulos NO se importan como partidas — solo las hojas — así que el
  // matcher debe omitirlos en vez de contarlos como "sin match".
  //
  // IMPORTANTE: el Gantt mezcla códigos numéricos ("2.01", que Excel guardó
  // como número) con strings ("02.01.01"). Un startsWith crudo fallaría en
  // ese borde ("02.01.01" NO empieza con "2.01."). Por eso comparamos sobre
  // el código NORMALIZADO (sin padding de ceros), que es consistente.
  // Además, el código "0" / "0.x" es la raíz del proyecto y los hitos
  // (INICIO/FIN DE OBRA) en la convención de Gantt — tampoco son partidas.
  const codigosNorm = tareas.map(t => normalizeCodigo(t.codigo));
  for (let i = 0; i < tareas.length; i++) {
    const norm = codigosNorm[i];
    const prefijo = norm + '.';
    const tieneHijos = codigosNorm.some((c, j) => j !== i && c.startsWith(prefijo));
    const esRaizOHito = norm === '0' || norm.startsWith('0.');
    tareas[i].esCapitulo = tieneHijos || esRaizOHito;
  }
  return tareas;
}

// ═══════════════════════════════════════════════════════════════════
// PRESUPUESTO DE OBRA — listado completo de partidas (con capítulos)
//
// Formato detectado en exports de Delphin/S10:
//   - Filas 0-10: metadata del proyecto (PROYECTO, PROPIETARIO, FECHA, etc.)
//   - Fila ~11: header con "Item", "Descripción", "Unid.", "Cant.", "Precio", "Total"
//   - Filas 13+: datos. Col 0 = código jerárquico (número o string), Col 1 = descripción,
//     Col 8 = unidad, Col 10 = cantidad, Col 12 = precio, Col 14 = total.
//   - El código puede venir como número (Excel auto-convierte "1.01" → 1.01) o string
//     ("02.01.01.01.01"). Lo normalizamos siempre a string.
//
// Devuelve: array de { codigo, descripcion, unidad, cantidad, precio, total, nivel }
// ═══════════════════════════════════════════════════════════════════
export function parsePresupuestoObra(rows, rowsTexto = null) {
  const partidas = [];
  // Encontrar header (la fila que tiene "Item" y "Descripción")
  let dataStart = 0;
  for (let i = 0; i < Math.min(30, rows.length); i++) {
    const r = rows[i] || [];
    const has = (target) => r.some(c => typeof c === 'string' && c.trim().toLowerCase() === target);
    if (has('item') && (has('descripción') || has('descripcion'))) {
      dataStart = i + 1;
      break;
    }
  }
  for (let i = dataStart; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const rawCod = r[0];
    if (rawCod == null || rawCod === '') continue;
    // Normalizar código a string
    let codigo = '';
    if (typeof rawCod === 'number') {
      // Excel convirtió "1.10" en número 1.1 — String() pierde el cero final
      // y el código colisiona con "1.1"/"01.01". Preferir el texto FORMATEADO
      // de la celda (lo que se ve en Excel) si está disponible y es un código.
      const texto = String(rowsTexto?.[i]?.[0] ?? '').trim();
      codigo = /^\d+(\.\d+)*$/.test(texto) ? texto : String(rawCod);
    } else {
      codigo = String(rawCod).trim();
    }
    // Filas tipo "Pág. X" o totales
    if (!/^\d+(\.\d+)*$/.test(codigo)) continue;
    const desc = String(r[1] ?? '').trim();
    if (!desc) continue;
    // Skip si la descripción es un encabezado vacío típico
    if (/^pres?upuesto/i.test(desc)) continue;
    const unidad = String(r[8] ?? '').trim() || null;
    const cantidad = Number(r[10]) || 0;
    const precio = Number(r[12]) || 0;
    const total = Number(r[14]) || 0;
    const nivel = codigo.split('.').length; // 1, 2, 3, 4, 5…
    partidas.push({ codigo, descripcion: desc, unidad, cantidad, precio, total, nivel });
  }
  return partidas;
}

// ═══════════════════════════════════════════════════════════════════
// TABLA DE COSTOS — la tabla resumen al final del presupuesto Delphin/S10
//
// Estructura típica (col concepto + col % opcional + col monto):
//   COSTO DIRECTO                      | 9,809,772.60
//   UTILIDADES (15% DEL CD)      | 15% | 1,471,465.89
//   GASTOS GENERALES (15% DEL CD)| 15% | 1,471,465.89
//   SUB TOTAL                          | 12,752,704.38
//   IGV (18%)                    | 18% | 2,295,486.79
//   VALOR REFERENCIAL                  | 15,048,191.17
//   ELABORACIÓN DEL DOCUMENTO…         | 100,000      ┐
//   SUPERVISIÓN DE OBRA                | 638,050      │ otros gastos
//   …                                  | …            ┘
//   COSTO TOTAL DEL PROYECTO           | 16,022,782.13
//
// Heurística robusta: por cada fila, concepto = primera celda de texto
// "largo" (no código), monto = última celda numérica, pct = celda que
// matchea "NN%" o 0.NN. Clasifica por keywords. Lo que cae ENTRE el
// Valor Referencial y el Costo Total y no es una capa conocida → es un
// "otro gasto".
//
// Devuelve null si no encuentra al menos COSTO DIRECTO y COSTO TOTAL.
// Si encuentra, devuelve:
//   { costoDirecto, utilidadPct, gastosPct, igvPct, otrosGastos[],
//     valorReferencial, costoTotal }
// (los pct pueden venir null si el Excel no los explicita — el caller
// puede derivarlos: utilidadPct = utilidades/CD×100, etc.)
// ═══════════════════════════════════════════════════════════════════
export function parseTablaCostos(rows) {
  const norm = (s) => String(s ?? '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Extrae {concepto, pct, monto} de una fila, o null si no aplica.
  const parseRow = (r) => {
    if (!r) return null;
    // Si la fila tiene un código jerárquico en col 0 → es partida, no costo.
    const c0 = r[0];
    if (c0 != null && c0 !== '' && /^\d+(\.\d+)*$/.test(String(c0).trim())) return null;

    let concepto = '';
    let pct = null;
    let monto = null;
    for (const cell of r) {
      if (cell == null || cell === '') continue;
      const s = String(cell).trim();
      // Porcentaje: "15%" o "18 %"
      const mPct = s.match(/^(\d+(?:\.\d+)?)\s*%$/);
      if (mPct) { pct = Number(mPct[1]); continue; }
      const num = typeof cell === 'number' ? cell : Number(s.replace(/,/g, ''));
      if (!Number.isNaN(num) && /^[\d.,\s%-]+$/.test(s)) {
        // celda numérica → candidato a monto (nos quedamos con el último/mayor)
        if (num > 1 && (monto == null || num >= 0)) monto = num;
        // pct como decimal 0.15
        else if (num > 0 && num < 1 && pct == null) pct = num * 100;
        continue;
      }
      // Texto largo → concepto (el primero significativo)
      if (!concepto && s.length >= 3) concepto = s;
    }
    if (!concepto) return null;
    return { concepto, pct, monto, n: norm(concepto) };
  };

  const result = {
    costoDirecto: null, utilidadPct: null, gastosPct: null, igvPct: null,
    valorReferencial: null, costoTotal: null, otrosGastos: [],
  };
  let vistoValorRef = false;

  for (const r of rows) {
    const row = parseRow(r);
    if (!row || row.monto == null) continue;
    const n = row.n;

    if (n.includes('costo directo')) { result.costoDirecto = row.monto; continue; }
    if (n.includes('utilidad')) { result.utilidadPct = row.pct; result._utilidades = row.monto; continue; }
    if (n.includes('gastos generales') || n.includes('gastos admin') || n.includes('gasto general')) {
      result.gastosPct = row.pct; result._gastos = row.monto; continue;
    }
    if (n.includes('sub total') || n === 'subtotal') { result.subTotal = row.monto; continue; }
    if (n.startsWith('igv') || n.includes('i.g.v')) { result.igvPct = row.pct; result._igv = row.monto; continue; }
    if (n.includes('valor referencial')) { result.valorReferencial = row.monto; vistoValorRef = true; continue; }
    if (n.includes('costo total')) { result.costoTotal = row.monto; break; }

    // Entre Valor Referencial y Costo Total → otro gasto
    if (vistoValorRef) {
      result.otrosGastos.push({ concepto: row.concepto, monto: row.monto });
    }
  }

  // Derivar pct si no vinieron explícitos pero sí los montos.
  if (result.costoDirecto > 0) {
    if (result.utilidadPct == null && result._utilidades != null) {
      result.utilidadPct = +(result._utilidades / result.costoDirecto * 100).toFixed(2);
    }
    if (result.gastosPct == null && result._gastos != null) {
      result.gastosPct = +(result._gastos / result.costoDirecto * 100).toFixed(2);
    }
  }
  if (result.igvPct == null && result._igv != null && result.subTotal > 0) {
    result.igvPct = +(result._igv / result.subTotal * 100).toFixed(2);
  }
  delete result._utilidades; delete result._gastos; delete result._igv;

  // Inválido si no hay al menos CD y costo total.
  if (result.costoDirecto == null || result.costoTotal == null) return null;
  return result;
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

  // 2) Header de Gantt: "Numeracion" en col 0 + algo tipo "Inicio" /
  //    "Duracion" / "Fecha" en otras columnas. Usamos `some(c => c.includes(...))`
  //    en vez de `r.includes(...)` exacto, porque los exports reales suelen
  //    traer variantes tipo "Fecha Inicio", "Duración (días)", "Fecha fin".
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const r = (rows[i] || []).map(c => String(c ?? '').trim().toLowerCase());
    // Header de Gantt: o bien empieza con "Numeracion"/"Código Jerárquico"
    // en col 0, o simplemente contiene columnas de cronograma (inicio/fin/
    // duración/predecesora). Esto es muy característico del Gantt y NO del
    // presupuesto (que tiene precio/total). Lo chequeamos ANTES del
    // presupuesto para que un Gantt con códigos jerárquicos no se confunda.
    const c0 = r[0] || '';
    const esHeaderCodigo = c0 === 'numeracion' || c0.startsWith('numer')
      || c0.includes('jerarqu') || c0 === 'item' || c0 === 'id';
    const señalesCrono = [
      r.some(c => c.includes('inicio')),
      r.some(c => c.includes('fin')),
      r.some(c => c.includes('duracion') || c.includes('duración')),
      r.some(c => c.includes('predecesor')),
    ].filter(Boolean).length;
    // Header con código + al menos 1 señal de cronograma, O 2+ señales de
    // cronograma en cualquier fila (sin importar col 0).
    if ((esHeaderCodigo && señalesCrono >= 1) || señalesCrono >= 2) {
      return 'gantt';
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

  // 4) Presupuesto de obra consolidado: listado de partidas (capítulos +
  //    hojas) con código jerárquico + descripción + total, SIN bloques
  //    "Partida:". Es el export "Presupuesto" de Delphin/S10 (el que trae
  //    también la tabla de costos al final). Como último recurso, si
  //    parsePresupuestoObra encuentra ≥5 filas con código jerárquico, lo
  //    tratamos como presupuesto.
  try {
    const pp = parsePresupuestoObra(rows);
    // Requerir ≥5 partidas Y que varias tengan TOTAL en dinero (col 14) —
    // así un Gantt (códigos pero sin columna de costo) no cae acá.
    const conTotal = pp.filter(p => Number(p.total) > 0).length;
    if (pp.length >= 5 && conTotal >= 3) return 'presupuesto';
  } catch { /* noop */ }

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
  // Texto formateado (lo que se VE en Excel) para la columna de códigos:
  // un código "1.10" guardado como número llega como 1.1 con raw:true —
  // String(1.10) === "1.1" pierde el cero final y colisiona con "1.1"/"01.01".
  const rowsTexto = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
  const tipo = detectS10Type(rows);

  // Tabla de costos al final del Excel (CD, %s, otros gastos, total).
  // Muchos presupuestos Delphin/S10 traen las partidas + esta tabla en el
  // MISMO archivo. La adjuntamos siempre que esté presente, para que el
  // import del APU pueda fijar los márgenes reales del proyecto sin depender
  // de defaults ni de un segundo archivo.
  let tablaCostos = null;
  try { tablaCostos = parseTablaCostos(rows); } catch { tablaCostos = null; }

  if (tipo === 'apu') {
    const { partidas, errores } = parseAPU(rows);
    const enriched = enrichJerarquia(partidas);
    return {
      tipo,
      data: enriched,
      tablaCostos,
      summary: {
        partidas: partidas.length,
        insumos: partidas.reduce((s, p) => s + p.insumos.length, 0),
        errores: errores.length,
      },
    };
  }

  // Presupuesto consolidado (capítulos + hojas + tabla de costos). Lo
  // mapeamos al shape del pipeline APU para reusar todo el flujo de
  // comparación + insert. Clave: los CAPÍTULOS (códigos que son prefijo
  // de otra fila) van con costo_total 0 — el árbol agrega el presupuesto
  // desde las hojas, ponerles costo propio lo duplicaría.
  if (tipo === 'presupuesto') {
    const items = parsePresupuestoObra(rows, rowsTexto);
    const norm = (c) => String(c ?? '').trim().split('.').map(s => {
      const n = parseInt(s, 10); return Number.isNaN(n) ? s : String(n);
    }).join('.');
    const codigosNorm = items.map(it => norm(it.codigo));
    const data = items
      // Filtramos la raíz del proyecto y los hitos (código "0"/"0.x") — no
      // son partidas reales.
      .map((it, i) => {
        const nrm = codigosNorm[i];
        const esRaiz = nrm === '0' || nrm.startsWith('0.');
        const prefijo = nrm + '.';
        const esCapitulo = !esRaiz && codigosNorm.some((c, j) => j !== i && c.startsWith(prefijo));
        const segs = String(it.codigo).split('.').filter(Boolean);
        return {
          _esRaiz: esRaiz,
          codigo: it.codigo,
          descripcion: it.descripcion,
          unidad: it.unidad || (esCapitulo ? null : 'und'),
          cantidad: esCapitulo ? 0 : (Number(it.cantidad) || 0),
          // costo_total es el campo que consume el pipeline APU.
          costo_total: esCapitulo ? 0 : (Number(it.total) || 0),
          nivel: it.nivel ?? segs.length,
          parent_codigo: segs.length > 1 ? segs.slice(0, -1).join('.') : null,
          insumos: [],
          esCapitulo,
        };
      })
      .filter(p => !p._esRaiz && p.descripcion);
    return {
      tipo: 'apu',                 // reusar pipeline APU
      source_format: 'presupuesto',
      data,
      tablaCostos,
      summary: {
        partidas: data.length,
        insumos: 0,
        errores: 0,
        capitulos: data.filter(p => p.esCapitulo).length,
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
    const tareas = parseGantt(rows, rowsTexto);
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
