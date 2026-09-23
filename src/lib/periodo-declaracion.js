// ═══════════════════════════════════════════════════════════════════
// JARVEX — EN QUÉ MES SE DECLARA UN COMPROBANTE.
//
// Lib PURA. Hasta ahora el Registro de Compras y Ventas contestaba esta
// pregunta con `date`: el comprobante se declara en el mes en que se emitió,
// punto. Eso es el caso normal y va a seguir siéndolo, pero no es la regla.
//
// ── POR QUÉ HACE FALTA (pedido de Gabriel, 23-set-2026) ───────────
// «Hay comprobantes de pago emitidos en enero, por ejemplo, y se declaran en
// marzo. De esta manera, si las asistentes de contabilidad quieren mover un
// comprobante de febrero 2026 a junio 2026 en el Registro de Compras y Ventas,
// se les haga sencillo.»
//
// Y es lo que dice la ley: el crédito fiscal de una compra se puede usar en el
// período de emisión o dentro de los DOCE meses siguientes (Ley 29215, art. 2,
// y art. 2 de la Ley 29214). Una factura que llegó tarde, o que se anotó tarde,
// se declara después — y el registro tiene que poder decirlo.
//
// ── LA FECHA DE EMISIÓN NO SE TOCA ────────────────────────────────
// Mover el mes de declaración NO es cambiarle la fecha al comprobante. La fecha
// es un dato del papel y cambiarla para «que salga en el mes correcto» es
// falsear el documento: el propio registro lleva las dos columnas (fecha de
// emisión y período), y el PLE también. Por eso `periodo_declarado` es una
// columna aparte (mig 227) y vacía significa «se declara en su mes», que es
// como está el 100 % de lo que ya hay cargado.
//
// ── QUÉ SE PERMITE Y QUÉ SE AVISA ─────────────────────────────────
// Se BLOQUEA lo imposible: declarar antes de emitir. Se AVISA lo arriesgado
// —pasarse de los 12 meses, o meter un comprobante en un mes que ya se le
// presentó a SUNAT— pero no se bloquea: quien cierra el período sabe si va a
// rectificar, y la app no está para adivinar eso por ella.
// ═══════════════════════════════════════════════════════════════════

/** El mes de emisión de un comprobante, como 'YYYYMM'. '' si no tiene fecha. */
export function periodoDeEmision(mov) {
  const ymd = String(mov?.date || mov?.created_at || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})/.exec(ymd);
  return m ? `${m[1]}${m[2]}` : '';
}

/** ¿Es un 'YYYYMM' válido? */
export const esPeriodoValido = (p) => /^\d{4}(0[1-9]|1[0-2])$/.test(String(p || ''));

/** 'YYYYMM' → número de meses absoluto, para poder restar dos períodos. */
const enMeses = (p) => {
  if (!esPeriodoValido(p)) return null;
  return Number(p.slice(0, 4)) * 12 + Number(p.slice(4, 6)) - 1;
};

/** Cuántos meses hay de `desde` a `hasta` (negativo si `hasta` es anterior). */
export function mesesEntre(desde, hasta) {
  const a = enMeses(desde), b = enMeses(hasta);
  return (a == null || b == null) ? null : b - a;
}

/**
 * EL período en que este comprobante se declara: el guardado si lo tiene y es
 * válido, y si no el de su emisión. Es la única función que contesta esto —
 * la pantalla, el filtro del mes y el PLE tienen que usar ésta y no volver a
 * mirar `date` por su cuenta, o el comprobante aparecería en dos meses según
 * quién pregunte.
 */
export function periodoDeDeclaracion(mov) {
  const guardado = String(mov?.periodo_declarado || '');
  return esPeriodoValido(guardado) ? guardado : periodoDeEmision(mov);
}

/** ¿Este comprobante se declara en este año y mes? */
export function declaraEnPeriodo(mov, anio, mes) {
  const p = periodoDeDeclaracion(mov);
  if (!p) return false;
  return p === `${anio}${String(mes).padStart(2, '0')}`;
}

/** ¿Se movió de su mes de emisión? (para marcarlo en la fila) */
export function esDiferido(mov) {
  const dec = periodoDeDeclaracion(mov);
  const emi = periodoDeEmision(mov);
  return !!dec && !!emi && dec !== emi;
}

/** El límite legal para usar el crédito fiscal de una compra. */
export const MESES_LIMITE_CREDITO = 12;

/**
 * ¿Se puede mover este comprobante a ese período?
 *
 * @param mov        el movimiento (de él sale el mes de emisión)
 * @param destino    'YYYYMM'
 * @param opts       { periodosPresentados: string[] }  los meses de esta
 *                   empresa y este libro para los que ya se cargó el corte de
 *                   SUNAT, o sea los que ya se presentaron.
 * @returns {{ ok:boolean, error:string|null, avisos:string[] }}
 */
export function validarPeriodoDeclarado(mov, destino, { periodosPresentados = [] } = {}) {
  const avisos = [];
  const emision = periodoDeEmision(mov);
  const d = String(destino || '');

  // Vacío = volver al mes de emisión. Siempre se puede.
  if (!d) return { ok: true, error: null, avisos: [] };
  if (!esPeriodoValido(d)) {
    return { ok: false, error: 'El período tiene que escribirse como AAAAMM (por ejemplo 202606).', avisos };
  }
  if (!emision) {
    return { ok: false, error: 'El comprobante no tiene fecha de emisión: primero hay que cargarla.', avisos };
  }

  const dif = mesesEntre(emision, d);
  if (dif < 0) {
    return {
      ok: false,
      error: `No se puede declarar un comprobante ANTES de emitirlo: se emitió en ${humano(emision)}.`,
      avisos,
    };
  }
  if (dif > MESES_LIMITE_CREDITO) {
    avisos.push(`Pasaron ${dif} meses desde la emisión (${humano(emision)}). El crédito fiscal de una compra `
      + `se puede usar dentro de los ${MESES_LIMITE_CREDITO} meses siguientes: más allá, SUNAT lo desconoce.`);
  }
  if ((periodosPresentados || []).map(String).includes(d)) {
    avisos.push(`${humano(d)} ya le fue presentado a SUNAT (hay un corte cargado de ese mes). `
      + 'Meter un comprobante ahí obliga a rectificar la declaración.');
  }
  return { ok: true, error: null, avisos };
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

/** '202606' → 'junio 2026'. Para los textos de la pantalla. */
export function humano(periodo) {
  const p = String(periodo || '');
  if (!esPeriodoValido(p)) return p;
  return `${MESES[Number(p.slice(4, 6)) - 1]} ${p.slice(0, 4)}`;
}

/**
 * Los períodos de esta empresa y este libro que ya se presentaron, sacados de
 * los cortes de SUNAT guardados.
 *
 * Que el corte EXISTA es la señal: los CSV del RVIE y de la propuesta del RCE
 * se bajan del portal recién cuando el período está presentado. No hay un
 * campo «presentado» que alguien tenga que acordarse de marcar, y por eso esta
 * señal no se desactualiza sola.
 */
export function periodosPresentados(cortes = [], { companyId = null, libro = null } = {}) {
  const out = new Set();
  for (const c of cortes || []) {
    if (!c || c.deleted_at) continue;
    if (companyId && c.company_id && c.company_id !== companyId) continue;
    if (libro && c.libro && c.libro !== libro) continue;
    const p = String(c.periodo || '');
    if (esPeriodoValido(p)) out.add(p);
  }
  return [...out].sort();
}

export default {
  periodoDeEmision, periodoDeDeclaracion, declaraEnPeriodo, esDiferido,
  validarPeriodoDeclarado, periodosPresentados, esPeriodoValido, mesesEntre,
  humano, MESES_LIMITE_CREDITO,
};
