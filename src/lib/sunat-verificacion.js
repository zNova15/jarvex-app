// ═══════════════════════════════════════════════════════════════════
// JARVEX — Comparación de razones sociales y veredicto de la verificación
// contra SUNAT (RUC → razón social + estado + condición).
//
// POR QUÉ VIVE ACÁ Y NO EN EL COMPONENTE
// `razonSimilar` la usaban TRES decisiones distintas de Captura Mágica
// (matchear la empresa del grupo cuando el OCR no leyó el RUC, sugerir un
// proveedor existente, y avisar que el nombre no coincide con SUNAT) desde una
// copia local sin tests. Un cambio de umbral ahí movía las tres a ciegas.
//
// QUÉ AGREGA `veredictoSunat` SOBRE EL AVISO VIEJO
// El aviso anterior solo miraba el NOMBRE. Pero la consulta de RUC ya trae dos
// campos que valen plata en Perú y que se estaban tirando a la basura:
//   · estado    = ACTIVO | SUSPENSION TEMPORAL | BAJA DE OFICIO | BAJA DEFINITIVA
//   · condicion = HABIDO | NO HABIDO | NO HALLADO
// Un comprobante de un proveedor NO HABIDO no da derecho a crédito fiscal ni al
// gasto deducible (art. 44 inc. j de la LIR y el 19 de la Ley del IGV): eso hay
// que verlo ANTES de registrar la factura, no en la fiscalización.
// ═══════════════════════════════════════════════════════════════════

// Tokens jurídicos/genéricos de razón social peruana que NO distinguen una
// empresa de otra (presentes en casi todas) → se ignoran al comparar nombres,
// para que el match por razón social no se infle por "COMERCIAL … SAC".
export const RS_STOPWORDS = new Set([
  'sociedad','anonima','cerrada','responsabilidad','limitada','empresa','individual',
  'comercial','servicios','generales','distribuidora','distribuciones','importaciones',
  'exportaciones','representaciones','inversiones','corporacion','negocios','contratistas',
  'ingenieria','construcciones','constructora','grupo','multiservicios','comercializadora',
  'industrias','soluciones','peru','sac','eirl','srl','sociedad','del','los','las','company',
]);

/** Normaliza para comparar: sin tildes, minúsculas, solo letras/números. */
export function normalizarRazon(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Similitud de razón social robusta: Jaccard sobre los tokens DISTINTIVOS
 * (descartando los jurídicos/genéricos y los de 1-2 letras). Devuelve 0..1.
 */
export function razonSimilar(a, b) {
  const toks = (s) => normalizarRazon(s).split(' ').filter(w => w.length > 2 && !RS_STOPWORDS.has(w));
  const A = new Set(toks(a)), B = new Set(toks(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.max(A.size, B.size);
}

/** Por debajo de esto, el nombre del comprobante y el de SUNAT son otro. */
export const UMBRAL_MISMATCH = 0.6;

/** ¿El RUC tiene 11 dígitos y el dígito verificador correcto? (módulo 11 SUNAT) */
export function rucValido(ruc) {
  const r = String(ruc || '').replace(/\D/g, '');
  if (!/^\d{11}$/.test(r)) return false;
  if (!['10', '15', '16', '17', '20'].includes(r.slice(0, 2))) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let suma = 0;
  for (let i = 0; i < 10; i++) suma += Number(r[i]) * pesos[i];
  const resto = 11 - (suma % 11);
  const dv = resto === 10 ? 0 : resto === 11 ? 1 : resto;
  return dv === Number(r[10]);
}

/**
 * Veredicto de la verificación de un emisor contra SUNAT.
 *
 * @param {object} p
 * @param {string} p.razonOCR   razón social tal como la leyó el comprobante
 * @param {object} p.sunat      { razonSocial, estado, condicion } de /api/sunat
 * @returns {null|{razonSocial,similitud,mismatch,estado,condicion,inactivo,noHabido,alertas,nivel}}
 *          nivel: 'ok' (todo coincide y está activo/habido) | 'revisar'
 */
export function veredictoSunat({ razonOCR, sunat, umbral = UMBRAL_MISMATCH } = {}) {
  const razonSocial = String(sunat?.razonSocial || '').trim();
  if (!razonSocial) return null;
  const similitud = razonSimilar(razonOCR, razonSocial);
  // Sin nombre capturado no hay nada que contradecir: no es un mismatch, es un
  // hueco (y el botón "Usar nombre SUNAT" lo llena).
  const hayNombre = !!String(razonOCR || '').trim();
  const mismatch = hayNombre && similitud < umbral;
  const estado = String(sunat?.estado || '').trim().toUpperCase();
  const condicion = String(sunat?.condicion || '').trim().toUpperCase();
  // Solo se afirma cuando SUNAT lo dijo: el proveedor legacy sin estos campos
  // (caché vieja, apis.net.pe v1) NO se marca como problema.
  const inactivo = !!estado && estado !== 'ACTIVO';
  const noHabido = !!condicion && condicion !== 'HABIDO';
  const alertas = [];
  if (noHabido) {
    alertas.push(`SUNAT lo tiene como «${condicion}»: los comprobantes de un proveedor NO HABIDO no dan derecho a crédito fiscal ni a gasto deducible. Registralo, pero avisá a la Contadora Jefe.`);
  }
  if (inactivo) {
    alertas.push(`SUNAT tiene este RUC en estado «${estado}» (no activo). Verificá que la factura sea de una fecha en que sí lo estaba.`);
  }
  return {
    razonSocial,
    // Domicilio fiscal, para poder completar el alta del proveedor sin salir
    // del modal (el comprobante trae el local de venta, o no trae nada).
    direccionSunat: String(sunat?.direccion || '').trim(),
    similitud: Math.round(similitud * 100),
    mismatch,
    faltaNombre: !hayNombre,
    estado, condicion, inactivo, noHabido, alertas,
    nivel: (mismatch || inactivo || noHabido || !hayNombre) ? 'revisar' : 'ok',
  };
}
