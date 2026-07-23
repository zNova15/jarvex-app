// ═══════════════════════════════════════════════════════════════════
// JARVEX — Normalización de documentos (RUC / DNI) para deduplicar.
//
// El ancla de identidad de una empresa/proveedor/persona es su DOCUMENTO, no su
// nombre. Bug real: la misma empresa (Gasomi) llegó en dos facturas con el RUC
// igual pero el nombre en MAYÚSCULAS en una y minúsculas en otra → se crearon
// dos. La causa de fondo es comparar/guardar el RUC sin normalizar (espacios,
// guiones, formato). Acá lo dejamos en SOLO DÍGITOS para que siempre matchee.
// ═══════════════════════════════════════════════════════════════════

/** Deja solo los dígitos de un documento (robusto a espacios/guiones/letras). */
export const soloDigitos = (s) => String(s || '').replace(/\D/g, '');

/** RUC normalizado (RUC peruano = 11 dígitos). */
export const normalizarRuc = (s) => soloDigitos(s);

/** DNI normalizado (8 dígitos). No tocar placeholders MIG-/RES- (no son DNI). */
export const normalizarDni = (s) => {
  const raw = String(s || '');
  if (/^(MIG-|RES-)/i.test(raw)) return raw.trim(); // placeholder de migración: se respeta tal cual
  return soloDigitos(s);
};

/** ¿RUC peruano plausible? (11 dígitos, prefijo 10/15/16/17/20). */
export const esRucValido = (s) => { const d = soloDigitos(s); return d.length === 11 && /^(10|15|16|17|20)/.test(d); };

/** ¿RUC de PERSONA NATURAL? (empieza en 10 → su titular es una persona con recibo por honorarios). */
export const esRucPersonaNatural = (s) => { const d = soloDigitos(s); return d.length === 11 && d.startsWith('10'); };

/** DNI contenido en un RUC de persona natural: 10 + <DNI 8 díg.> + verificador. null si no aplica. */
export const dniDeRuc = (s) => { const m = /^10(\d{8})\d$/.exec(soloDigitos(s)); return m ? m[1] : null; };

/** ¿Dos RUC son el mismo (normalizados)? Falso si alguno está vacío. */
export const mismoRuc = (a, b) => { const x = soloDigitos(a); return !!x && x === soloDigitos(b); };

/** ¿Dos DNI son el mismo (normalizados, sin contar placeholders)? */
export const mismoDni = (a, b) => { const x = normalizarDni(a); return !!x && !/^(MIG-|RES-)/i.test(x) && x === normalizarDni(b); };

// ── Comprobante (serie-correlativo) ────────────────────────────────
// Identifica un comprobante de pago de forma estable: el mismo (emisor RUC +
// serie-correlativo) es el MISMO documento aunque venga escrito distinto. La foto
// (OCR) puede traer "F001-123" y el XML de SUNAT "F001-00000123" (con ceros) o con
// espacios → se normaliza a MAYÚSCULAS, sin espacios, y el correlativo SIN ceros a
// la izquierda. Sirve para no duplicar el movimiento al re-importar de SUNAT.
export const normalizarComprobante = (s) => {
  const raw = String(s || '').toUpperCase().replace(/\s+/g, '');
  if (!raw) return '';
  const m = raw.match(/^(.*?)[-]*(\d+)$/);
  if (!m) return raw.replace(/[^A-Z0-9]/g, '');
  const serie = m[1].replace(/[^A-Z0-9]/g, '');
  const corr = String(parseInt(m[2], 10) || 0);
  return `${serie}-${corr}`;
};

/** ¿Dos comprobantes son el mismo (normalizados)? Falso si alguno está vacío. */
export const mismoComprobante = (a, b) => { const x = normalizarComprobante(a); return !!x && x === normalizarComprobante(b); };
