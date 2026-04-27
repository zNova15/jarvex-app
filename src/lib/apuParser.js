// ─────────────────────────────────────────────────────────────
// Parser de "Análisis de Precios Unitarios" (APU) exportado
// desde S10 (sistema peruano de presupuestos) en Excel.
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

// ─── Núcleo: parsea filas (array of arrays) → partidas ───────
export function parseAPU(rows) {
  const partidas = [];
  let current = null;
  let categoriaActual = null;
  const errores = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const c0 = r[0];

    if (typeof c0 === 'string' && c0.startsWith('Partida:')) {
      if (current) partidas.push(current);
      const codigo = c0.replace('Partida:', '').trim();
      const next = rows[i + 1] || [];
      const desc = next[0] || next[1] || '';
      const cantStr = String(r[13] ?? '').trim();
      const m = cantStr.match(/^([\d.,]+)\s*(.*)$/);
      const cantidad = m ? parseFloat(String(m[1]).replace(/,/g, '')) : null;
      const unidad   = m ? (m[2] || '').trim() : null;
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
    if (typeof c1 === 'string' && CATS[c1.trim()]) {
      categoriaActual = CATS[c1.trim()];
      continue;
    }
    if (typeof r[12] === 'string' && r[12].trim() === 'TOTAL:') {
      const v = Number(r[13]);
      current.costo_total = Number.isFinite(v) ? v : null;
      continue;
    }
    if (categoriaActual && c0 && c1 && r[8]) {
      current.insumos.push({
        codigo: String(c0).trim(),
        descripcion: String(c1).trim(),
        categoria: categoriaActual,
        unidad: String(r[8]).trim(),
        cantidad: Number(r[9]) || 0,
        precio_unitario: Number(r[12]) || 0,
        total: Number(r[13]) || 0,
      });
    }
  }
  if (current) partidas.push(current);

  // Validaciones suaves: detectar partidas sin insumos / sin costo
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
