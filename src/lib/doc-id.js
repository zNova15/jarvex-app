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

/** ¿Dos RUC son el mismo (normalizados)? Falso si alguno está vacío. */
export const mismoRuc = (a, b) => { const x = soloDigitos(a); return !!x && x === soloDigitos(b); };

/** ¿Dos DNI son el mismo (normalizados, sin contar placeholders)? */
export const mismoDni = (a, b) => { const x = normalizarDni(a); return !!x && !/^(MIG-|RES-)/i.test(x) && x === normalizarDni(b); };
