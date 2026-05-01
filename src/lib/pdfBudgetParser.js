// ═══════════════════════════════════════════════════════════════════
// JARVEX — Parser de Presupuestos en PDF (formato peruano estándar)
//
// Extrae jerarquía Item · Descripción · Unidad · Cantidad · Precio · Total
// del formato típico de Delphin/S10 exportado a PDF.
//
// Devuelve estructura compatible con enrichJerarquia() y buildArbol() de
// apuParser.js, así el resto del flujo de importación es idéntico.
// ═══════════════════════════════════════════════════════════════════

import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

// Líneas a ignorar: header de página, títulos repetidos en cabeceras
const SKIP_LINE = /^(Pág\.\s*\d+\s*$|PRESUPUESTO\s+DE\s+OBRA\s*$|Item\s+Descripción\s+Unid\.|Item\s+Descripción|^:$)/i;
// Línea que empieza con código (XX o XX.XX.XX...)
const LINE_STARTS_CODE = /^(\d+(?:\.\d+)*)\s+(.*)$/;
// Token numérico (con miles y decimales)
const NUM_TOKEN_RE = /^-?[\d,]+(?:\.\d{1,6})?$/;
// Tokens que pueden ser unidad
const UNIDADES = new Set([
  'm','m²','m³','m2','m3','ml','und','unid','glb','kg','kgf','hh','hm',
  'dia','día','mes','gln','p2','pza','pieza','jgo','set','rll',
  'tn','t','l','lt','bls','vje','par','pto','und.','glb.','m.l',
  'm.','m2.','m3.','cm','cm²','cm³','pza.','pulg','"',
]);

function parseNumber(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Extrae texto plano de un File (PDF) usando pdf.js.
 * Devuelve un array de líneas (ya trimmed, sin vacías).
 */
export async function extractTextFromPDF(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // pdf.js da items con .str y .transform[5] (y position).
    // Agrupamos por línea Y aproximada para reconstruir el flujo lógico.
    const items = content.items;
    const byY = new Map();
    for (const it of items) {
      const y = Math.round(it.transform[5]);
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push({ x: it.transform[4], s: it.str });
    }
    // Y descending (top of page first)
    const ys = Array.from(byY.keys()).sort((a,b) => b - a);
    for (const y of ys) {
      const row = byY.get(y).sort((a,b) => a.x - b.x).map(o => o.s).join('').trim();
      if (row) lines.push(row);
    }
  }
  return lines;
}

/**
 * Extrae header del presupuesto.
 * El formato típico es "PROYECTO : <texto>" en una misma línea, con líneas
 * de continuación si la descripción wrappeó.
 */
function extractHeader(lines) {
  const hdr = { proyecto: '', propietario: '', ubicacion: '', fecha: '' };
  const stripLabel = (ln, label) => ln.replace(new RegExp(`^${label}\\s*:?\\s*`, 'i'), '').trim();
  let currentField = null;
  for (let i = 0; i < Math.min(40, lines.length); i++) {
    const ln = lines[i];
    if (LINE_STARTS_CODE.test(ln)) break; // entró a partidas
    const lo = ln.toLowerCase();
    if (lo.startsWith('proyecto')) {
      hdr.proyecto = stripLabel(ln, 'proyecto');
      currentField = 'proyecto';
    } else if (lo.startsWith('propietario')) {
      hdr.propietario = stripLabel(ln, 'propietario');
      currentField = 'propietario';
    } else if (lo.startsWith('ubicacion') || lo.startsWith('ubicación')) {
      hdr.ubicacion = stripLabel(ln, 'ubicaci[oó]n');
      currentField = 'ubicacion';
    } else if (lo.startsWith('fecha')) {
      hdr.fecha = stripLabel(ln, 'fecha\\s+de\\s+proy\\.?');
      currentField = 'fecha';
    } else if (currentField && !lo.startsWith('item') && !lo.startsWith('pág')) {
      // Continuación del campo previo (wrap)
      hdr[currentField] = (hdr[currentField] + ' ' + ln).trim();
    }
  }
  return hdr;
}

/**
 * Parsea una línea que empieza con código en sus componentes:
 *   - Hoja:  "01.01 CARTEL DE OBRA und 2.00 1,565.43 3,130.86"
 *            → { codigo, desc, unidad, cantidad, precio, total }
 *   - Título: "01 OBRAS PROVISIONALES 8,130.86"
 *            → { codigo, desc, total } (sin unidad/cantidad/precio)
 * El truco: parsear de DERECHA a IZQUIERDA porque las descripciones
 * pueden contener números, comillas, paréntesis, pero la cola
 * (unidad qty precio total) es predecible.
 */
function parseItemLine(codigo, restoStr) {
  // restoStr es todo lo que viene después del código, en una línea
  const tokens = restoStr.trim().split(/\s+/);
  if (tokens.length === 0) return { codigo, descripcion: '', leaf: false, total: null };

  // Caso A: hoja con cola "<unidad> <cant> <precio> <total>"
  // Tomamos los últimos 4 tokens y vemos si encajan
  if (tokens.length >= 5) {
    const tail = tokens.slice(-4);
    const numTail = tail.slice(1).every(t => NUM_TOKEN_RE.test(t));
    if (numTail) {
      // El primer token de tail debe ser unidad. Pero a veces pdf.js
      // pega la unidad al final de descripción sin espacio (ej "SEGURIDADm").
      // Si el primer token no es unidad pura, lo manejamos abajo.
      const tUnit = tail[0].toLowerCase();
      if (UNIDADES.has(tUnit)) {
        const desc = tokens.slice(0, -4).join(' ');
        return {
          codigo,
          descripcion: desc,
          unidad: tail[0],
          cantidad: parseNumber(tail[1]),
          precio: parseNumber(tail[2]),
          total: parseNumber(tail[3]),
          leaf: true,
        };
      }
      // Probar si la unidad está pegada al último token de descripción
      // (ej "SEGURIDADm" en vez de "SEGURIDAD m")
      const m = tail[0].match(/^(.+?)(m³|m²|m2|m3|ml|cm³|cm²|cm|hh|hm|kg|tn|gln|und|glb|jgo|set|rll|pza|bls|vje|par|m|t|l)$/i);
      if (m && /[A-Za-zÁÉÍÓÚÑ]/.test(m[1])) {
        const restoDesc = tokens.slice(0, -4).join(' ') + ' ' + m[1];
        return {
          codigo,
          descripcion: restoDesc.trim(),
          unidad: m[2],
          cantidad: parseNumber(tail[1]),
          precio: parseNumber(tail[2]),
          total: parseNumber(tail[3]),
          leaf: true,
        };
      }
    }
  }

  // Caso B: título con un solo número al final (total)
  const lastTok = tokens[tokens.length - 1];
  if (NUM_TOKEN_RE.test(lastTok)) {
    return {
      codigo,
      descripcion: tokens.slice(0, -1).join(' '),
      unidad: null, cantidad: null, precio: null,
      total: parseNumber(lastTok),
      leaf: false,
    };
  }

  // Caso C: solo descripción (sin total visible — caso raro)
  return { codigo, descripcion: tokens.join(' '), unidad: null, cantidad: null, precio: null, total: null, leaf: false };
}

/**
 * Parsea las líneas extraídas del PDF en partidas estructuradas.
 * Cada línea con código abre una nueva partida; las líneas siguientes
 * sin código se appendean a la descripción de la última partida.
 */
export function parsePresupuestoLines(allLines) {
  const lines = allLines.filter(ln => !SKIP_LINE.test(ln));
  const partidas = [];
  let last = null;
  for (const ln of lines) {
    const m = ln.match(LINE_STARTS_CODE);
    if (m) {
      const partida = parseItemLine(m[1], m[2]);
      partidas.push(partida);
      last = partida;
    } else if (last && !/^(propietario|proyecto|ubicaci[oó]n|fecha|son\s|costo\s+total)/i.test(ln)) {
      // Continuación de descripción wrappeada
      last.descripcion = (last.descripcion + ' ' + ln).replace(/\s+/g, ' ').trim();
    }
  }
  return partidas;
}

/**
 * Convierte partidas hoja a la forma que espera la importación de partidas
 * (tabla `partidas` del schema): codigo_delfin + nombre_partida + unidad +
 * metrado_contratado + precio_unitario_pres + costo_total_presupuestado.
 */
export function partidasToImportRows(partidas) {
  return partidas
    .filter(p => p.leaf && p.cantidad != null && p.precio != null)
    .map(p => ({
      codigo_delfin: p.codigo,
      nombre_partida: p.descripcion,
      unidad: p.unidad || 'und',
      metrado_contratado: Number(p.cantidad) || 0,
      precio_unitario_pres: Number(p.precio) || 0,
      costo_total_presupuestado: Number(p.total) || (Number(p.cantidad)||0) * (Number(p.precio)||0),
      categoria: 'General',
    }));
}

/**
 * Convierte partidas raw del PDF a la shape que usa el flujo APU del importador
 * (codigo, descripcion, unidad, cantidad, costo_total, insumos[]). Solo incluye
 * partidas hoja porque las DB partidas son ejecutables, no títulos.
 */
function partidasToAPUShape(partidasRaw) {
  return partidasRaw
    .filter(p => p.leaf && p.cantidad != null && p.precio != null)
    .map(p => ({
      codigo: p.codigo,
      descripcion: p.descripcion,
      unidad: p.unidad || 'und',
      cantidad: Number(p.cantidad) || 0,
      costo_total: Number(p.total) || (Number(p.cantidad)||0) * (Number(p.precio)||0),
      insumos: [],
    }));
}

/**
 * Pipeline completo: File PDF → { tipo, data, header, summary }.
 * El shape de `data` es idéntico al que devuelve parseAPU (sin insumos),
 * para que el flujo del importador APU pueda reusarse sin cambios.
 */
export async function parsePresupuestoPDF(file) {
  const lines = await extractTextFromPDF(file);
  const header = extractHeader(lines);
  const partidasRaw = parsePresupuestoLines(lines);
  const partidasAPU = partidasToAPUShape(partidasRaw);
  const totalHojas = partidasAPU.reduce((s, p) => s + (p.costo_total || 0), 0);
  // Importante: aplicar enrichJerarquia para que tenga nivel + parent_codigo + orden
  const data = partidasAPU.map((p, idx) => {
    const segs = p.codigo.split('.').filter(Boolean);
    return { ...p, nivel: segs.length, parent_codigo: segs.length > 1 ? segs.slice(0, -1).join('.') : null, orden: idx };
  });
  return {
    tipo: 'presupuesto_pdf',
    data,
    header,
    raw_partidas: partidasRaw,
    summary: {
      partidas: data.length,
      insumos: 0,
      errores: 0,
      total_hojas: totalHojas,
      hojas: data.length,
      agrupadores: partidasRaw.length - data.length,
      proyecto: header.proyecto,
      propietario: header.propietario,
      ubicacion: header.ubicacion,
    },
  };
}
