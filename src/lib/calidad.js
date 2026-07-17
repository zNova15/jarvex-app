// ═══════════════════════════════════════════════════════════════════
// JARVEX — Fase 4: Gestión de Calidad (certificados vs expediente).
//
// El expediente técnico exige specs mínimas por insumo (norma/valor). El ing.
// de calidad sube el certificado PDF del insumo comprado y la IA lo compara →
// semáforo cumple / observado / no cumple por requisito. Funciones PURAS y
// testeables; la UI vive en jx-calidad.jsx y la IA en api/captura-magica
// (tipo 'certificado_calidad').
// ═══════════════════════════════════════════════════════════════════

export const RESULTADOS_CERT = ['cumple', 'observado', 'no_cumple'];
export const RESULTADO_META = {
  cumple: { label: 'Cumple', badge: 'b-green' },
  observado: { label: 'Observado', badge: 'b-amber' },
  no_cumple: { label: 'No cumple', badge: 'b-red' },
  sin_certificado: { label: 'Sin certificado', badge: 'b-gray' },
};

/** Resultado efectivo de un certificado: el override manual pisa a la IA. */
export const resultadoEfectivo = (cert) =>
  (cert && (cert.resultado_manual || cert.resultado)) || null;

/**
 * Estado por requisito + KPIs globales. PURA.
 * El estado de un requisito lo define su certificado MÁS RECIENTE (fecha,
 * desempate por created_at): un certificado nuevo reemplaza al anterior.
 * @param requisitos  calidad_requisitos vivos
 * @param certificados  calidad_certificados vivos
 * @returns { porRequisito: Map(requisito_id → {estado, cert, nCerts}),
 *            kpis: {total, cumple, observado, no_cumple, sin_certificado} }
 */
export function resumenCumplimiento(requisitos = [], certificados = []) {
  const porReq = new Map();
  for (const c of certificados) {
    if (!c.requisito_id) continue;
    const a = porReq.get(c.requisito_id) || [];
    a.push(c);
    porReq.set(c.requisito_id, a);
  }
  const masReciente = (certs) => [...certs].sort((a, b) =>
    String(b.fecha || '').localeCompare(String(a.fecha || '')) ||
    String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];

  const porRequisito = new Map();
  const kpis = { total: requisitos.length, cumple: 0, observado: 0, no_cumple: 0, sin_certificado: 0 };
  for (const r of requisitos) {
    const certs = porReq.get(r.id) || [];
    const cert = certs.length ? masReciente(certs) : null;
    const efectivo = cert ? resultadoEfectivo(cert) : null;
    const estado = RESULTADOS_CERT.includes(efectivo) ? efectivo : 'sin_certificado';
    porRequisito.set(r.id, { estado, cert, nCerts: certs.length });
    kpis[estado] += 1;
  }
  return { porRequisito, kpis };
}

// ── Import de requisitos del expediente desde Excel ──────────────────
// Columnas tipo: Insumo | Norma | Especificación | Fuente (nombres flexibles).
// SIN fechas → no aplica la trampa M/D/YY del review Fase 2.

const ALIAS = {
  insumo: ['insumo', 'material', 'producto', 'item', 'ítem', 'partida', 'elemento', 'descripcion del insumo', 'descripción del insumo'],
  norma: ['norma', 'ntp', 'astm', 'referencia', 'norma tecnica', 'norma técnica', 'estandar', 'estándar'],
  especificacion: ['especificacion', 'especificación', 'requisito', 'valor minimo', 'valor mínimo', 'spec', 'especificacion tecnica', 'especificación técnica', 'exigencia', 'caracteristicas', 'características'],
  fuente: ['fuente', 'seccion', 'sección', 'expediente', 'capitulo', 'capítulo', 'documento', 'referencia expediente'],
};
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Dos pasadas: primero los nombres PRIMARIOS exactos, después los alias débiles
// para los campos aún vacíos. Si no, un Excel 'Insumo | Requisito | Especificación'
// mapearía especificacion→'Requisito' (alias débil que aparece antes) y la
// columna Especificación real se ignoraría en silencio.
const PRIMARIOS = { insumo: ['insumo'], norma: ['norma'], especificacion: ['especificacion'], fuente: ['fuente'] };
function mapHeaders(headers) {
  const out = {};
  for (const fuentes of [PRIMARIOS, ALIAS]) {
    for (const h of headers || []) {
      const n = norm(h);
      for (const [campo, aliases] of Object.entries(fuentes)) {
        if (!out[campo] && aliases.includes(n)) out[campo] = h;
      }
    }
  }
  return out;
}

/**
 * Parsea el Excel de requisitos (salida de parseExcelFile: {headers, rows}).
 * @returns { requisitos: [{insumo_nombre, norma, especificacion, fuente}],
 *            errores: ['Fila leída #N: …'], colMap }
 */
export function parseRequisitosExcel({ headers = [], rows = [] } = {}) {
  const col = mapHeaders(headers);
  const errores = [];
  if (!col.insumo || !col.especificacion) {
    return {
      requisitos: [], colMap: col,
      errores: [`No encontré las columnas mínimas: ${!col.insumo ? '"Insumo/Material"' : ''} ${!col.especificacion ? '"Especificación/Requisito"' : ''}`.trim() + `. Encabezados leídos: ${(headers || []).join(', ') || '(ninguno)'}`],
    };
  }
  const requisitos = [];
  rows.forEach((row, i) => {
    const nFila = i + 2; // +1 por 0-index, +1 por la fila de encabezados
    const insumo = String(row[col.insumo] ?? '').trim();
    const espec = String(row[col.especificacion] ?? '').trim();
    if (!insumo && !espec) return; // fila vacía → se ignora sin error
    if (!insumo) { errores.push(`Fila leída #${nFila}: sin insumo/material`); return; }
    if (!espec) { errores.push(`Fila leída #${nFila}: sin especificación`); return; }
    requisitos.push({
      insumo_nombre: insumo,
      norma: col.norma ? String(row[col.norma] ?? '').trim() || null : null,
      especificacion: espec,
      fuente: col.fuente ? String(row[col.fuente] ?? '').trim() || null : null,
    });
  });
  return { requisitos, errores, colMap: col };
}

/** Clave de dedup por contenido (mismo insumo + misma especificación). */
export const claveRequisito = (r) =>
  `${norm(r.insumo_nombre)}|${norm(r.especificacion)}`;
