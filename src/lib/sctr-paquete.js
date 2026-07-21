// ═══════════════════════════════════════════════════════════════════
// JARVEX — Paquete SCTR: análisis con IA + separación del PDF (21-jul-2026).
//
// La contadora jefe sube UN PDF con el trámite completo del SCTR (cotización
// + constancia/certificado + evidencia de pago + factura). Este módulo:
//  1) analizarPaqueteSctr(file): manda el PDF a /api/captura-magica con
//     tipo 'sctr_paquete' → la IA clasifica las páginas en secciones y extrae
//     los datos de la constancia (aseguradora, pólizas, vigencia, asegurados).
//  2) separarPdf(bytes, secciones): con pdf-lib corta el PDF en un PDF por
//     sección — NECESARIO para la visibilidad por rol: la ing. de seguridad
//     solo puede ver el CERTIFICADO (cotización/pago/factura son contables).
//  3) matchAsegurados(...): cruza los asegurados extraídos contra el personal
//     de la obra (por DNI y por nombre normalizado) para vincular vigencias.
//
// Los helpers puros (normalizar/match/validar) son unit-testeables.
// ═══════════════════════════════════════════════════════════════════

export const TIPOS_DOC_SCTR = {
  cotizacion: { tipo_evidencia: 'sctr_cotizacion', lbl: 'Cotización', emoji: '📋' },
  certificado: { tipo_evidencia: 'sctr', lbl: 'Certificado / Constancia', emoji: '🛡️' },
  pago: { tipo_evidencia: 'sctr_pago', lbl: 'Evidencia de pago', emoji: '💳' },
  factura: { tipo_evidencia: 'sctr_factura', lbl: 'Factura', emoji: '🧾' },
  otro: { tipo_evidencia: 'sctr_otro', lbl: 'Otro', emoji: '📄' },
};

/** Normaliza un nombre para matchear: sin tildes, MAYÚSCULAS, espacios simples. */
export function normalizarNombre(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-ZÑ0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** Valida/limpia las secciones que devolvió la IA contra el total de páginas. */
export function validarSecciones(secciones, totalPaginas) {
  const limpias = (Array.isArray(secciones) ? secciones : [])
    .map(s => ({
      tipo: TIPOS_DOC_SCTR[s?.tipo] ? s.tipo : 'otro',
      desde: Math.max(1, Math.min(Number(s?.pagina_desde) || 1, totalPaginas)),
      hasta: Math.max(1, Math.min(Number(s?.pagina_hasta) || 1, totalPaginas)),
    }))
    .map(s => (s.hasta < s.desde ? { ...s, hasta: s.desde } : s))
    .sort((a, b) => a.desde - b.desde);
  if (!limpias.length) return [{ tipo: 'otro', desde: 1, hasta: totalPaginas }];
  return limpias;
}

/**
 * Cruza asegurados de la constancia contra el personal de la obra.
 * Match por DNI/documento primero; si no, por nombre normalizado exacto
 * (también probando el orden invertido "APELLIDOS NOMBRES" ↔ "NOMBRES APELLIDOS").
 * @returns [{ asegurado, persona: object|null }]
 */
export function matchAsegurados(asegurados, personal) {
  const vivos = (personal || []).filter(p => !p.deleted_at);
  const porDni = new Map();
  for (const p of vivos) {
    const d = String(p.dni || '').replace(/\D/g, '');
    if (d) porDni.set(d, p);
  }
  const porNombre = new Map();
  for (const p of vivos) {
    const n1 = normalizarNombre(`${p.nombres || ''} ${p.apellidos || ''}`);
    const n2 = normalizarNombre(`${p.apellidos || ''} ${p.nombres || ''}`);
    if (n1) porNombre.set(n1, p);
    if (n2) porNombre.set(n2, p);
  }
  return (asegurados || []).map(a => {
    const doc = String(a?.documento || '').replace(/\D/g, '');
    const persona = (doc && porDni.get(doc)) || porNombre.get(normalizarNombre(a?.nombre)) || null;
    return { asegurado: a, persona };
  });
}

/** File → base64 (sin prefijo data:). */
export function fileABase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('No se pudo leer el archivo'));
    r.onload = () => {
      const m = String(r.result).match(/^data:[^;]+;base64,(.*)$/);
      m ? resolve(m[1]) : reject(new Error('Lectura base64 inválida'));
    };
    r.readAsDataURL(file);
  });
}

/** Manda el paquete PDF a la IA. Devuelve { secciones, certificado, confianza, advertencias }. */
export async function analizarPaqueteSctr(file) {
  const { apiFetch } = await import('./api-client');
  const base64 = await fileABase64(file);
  const resp = await apiFetch('/api/captura-magica', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: base64, mimeType: 'application/pdf', tipo: 'sctr_paquete' }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error || `IA respondió ${resp.status}`);
  return data.extracted || {};
}

/**
 * Separa el PDF en un blob por sección (pdf-lib, 100% en el navegador).
 * @param {ArrayBuffer} bytes  PDF original
 * @param {Array<{tipo, desde, hasta}>} secciones  (ya validadas)
 * @returns [{ tipo, blob, desde, hasta }]
 */
export async function separarPdf(bytes, secciones) {
  const { PDFDocument } = await import('pdf-lib');
  const original = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = [];
  for (const s of secciones) {
    const doc = await PDFDocument.create();
    const idx = [];
    for (let p = s.desde - 1; p <= Math.min(s.hasta - 1, original.getPageCount() - 1); p++) idx.push(p);
    const paginas = await doc.copyPages(original, idx);
    paginas.forEach(pg => doc.addPage(pg));
    const outBytes = await doc.save();
    out.push({ ...s, blob: new Blob([outBytes], { type: 'application/pdf' }) });
  }
  return out;
}
