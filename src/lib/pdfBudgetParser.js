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

const SKIP_LINE = /^(Pág\.\s*\d+|PRESUPUESTO\s+DE\s+OBRA|PROYECTO|PROPIETARIO|UBICACION|UBICACIÓN|FECHA\s+DE\s+PROY|Item|Descripción|Descripcion|Unid\.|Cant\.|Precio|Total|:)$/i;
const CODE_RE = /^\d+(\.\d+)*$/;
const NUM_RE  = /^[\d,]+\.\d{1,4}$|^\d+\.\d+$|^[\d,]+$/;
const UNIDADES = new Set([
  'm','m²','m³','m2','m3','ml','und','glb','kg','kgf','hh','hm',
  'dia','día','mes','gln','p2','pza','pieza','jgo','set','rll',
  'tn','t','l','lt','bls','pza.','m2.','m3.','vje','par',
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
 * Extrae header del presupuesto (proyecto, propietario, ubicación, fecha).
 */
function extractHeader(lines) {
  const hdr = { proyecto: '', propietario: '', ubicacion: '', fecha: '' };
  for (let i = 0; i < Math.min(40, lines.length); i++) {
    const ln = lines[i];
    const lo = ln.toLowerCase();
    // Patterns: "PROYECTO :" + texto en líneas siguientes
    if (lo.startsWith('proyecto')) {
      // toma las siguientes líneas hasta que aparezca otro label o un código de partida
      let j = i + 1;
      const buf = [];
      while (j < lines.length && j < i + 8) {
        const lj = lines[j];
        if (/^(propietario|ubicacion|ubicación|fecha|item|:)/i.test(lj)) break;
        if (CODE_RE.test(lj)) break;
        buf.push(lj.replace(/^:\s*/, ''));
        j++;
      }
      hdr.proyecto = buf.join(' ').trim();
    } else if (lo.startsWith('propietario')) {
      hdr.propietario = (lines[i+1] || '').replace(/^:\s*/, '').trim();
    } else if (lo.startsWith('ubicacion') || lo.startsWith('ubicación')) {
      hdr.ubicacion = (lines[i+1] || '').replace(/^:\s*/, '').trim();
    } else if (lo.startsWith('fecha')) {
      hdr.fecha = (lines[i+1] || '').replace(/^:\s*/, '').trim();
    }
  }
  return hdr;
}

/**
 * Parsea las líneas en partidas estructuradas. Cada partida tiene:
 *   { codigo, descripcion, unidad, cantidad, precio, total, leaf }
 * Las hojas tienen unidad+cantidad+precio. Los agrupadores solo total.
 */
export function parsePresupuestoLines(allLines) {
  const lines = allLines.filter(ln => !SKIP_LINE.test(ln));
  const partidas = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (!CODE_RE.test(ln)) { i++; continue; }

    const codigo = ln;
    const descParts = [];
    i++;

    // Descripción: hasta encontrar unidad, número aislado o nuevo código
    while (i < lines.length) {
      const nxt = lines[i];
      if (CODE_RE.test(nxt)) break;
      if (UNIDADES.has(nxt.toLowerCase())) break;
      if (NUM_RE.test(nxt)) break;
      descParts.push(nxt);
      i++;
    }
    const descripcion = descParts.join(' ').replace(/\s+/g, ' ').trim();

    // ¿Sigue una unidad? → es hoja. ¿Sigue número? → es título.
    if (i < lines.length && UNIDADES.has(lines[i].toLowerCase())) {
      const unidad = lines[i]; i++;
      const cantidad = parseNumber(lines[i]); i++;
      const precio   = parseNumber(lines[i]); i++;
      const total    = parseNumber(lines[i]); i++;
      partidas.push({ codigo, descripcion, unidad, cantidad, precio, total, leaf: true });
    } else if (i < lines.length && NUM_RE.test(lines[i])) {
      const total = parseNumber(lines[i]); i++;
      partidas.push({ codigo, descripcion, unidad: null, cantidad: null, precio: null, total, leaf: false });
    } else {
      partidas.push({ codigo, descripcion, unidad: null, cantidad: null, precio: null, total: null, leaf: false });
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
