// ─────────────────────────────────────────────────────────────
//  Libro Diario / Asientos contables — Generador automático
//  Convierte cada accounting_movement en un asiento de partida
//  doble según el Plan Contable General Empresarial (PCGE) Perú.
//
//  No persiste en DB — es una vista derivada. Funciones puras.
// ─────────────────────────────────────────────────────────────

import { desglosarIgv, describirIgv, IGV_RATE } from './igv-desglose.js';
import { fmtFechaLarga } from './fecha.js';
import { resolverContrapartida, avisoEfectivoSobreUmbral } from './contrapartida.js';
import { resolverDestino, nombreDestino } from './destino-asiento.js';
import {
  esDestinoExistencia, patasDeSalida, saldoDeExistencia, nombreSalida,
} from './existencias-balance.js';
import { esNota, movimientosQueCuentan } from './notas-credito.js';

function r2(n) {
  const v = Number(n);
  if (!isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function fmtS(n) {
  return 'S/ ' + Number(n || 0).toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** El importe con el símbolo de SU moneda: un asiento sin tipo de cambio no está en soles. */
function fmtMon(n, moneda = 'PEN') {
  if (String(moneda || 'PEN').toUpperCase() === 'PEN') return fmtS(n);
  const sim = String(moneda).toUpperCase() === 'USD' ? 'US$ ' : `${moneda} `;
  return sim + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Clase canónica: `clase` manda sobre `type`, como en el resto de la app. */
const claseDe = (m) => m?.clase || (m?.type === 'income' ? 'venta' : 'compra');

// ── EL LIBRO SE LLEVA EN SOLES (Gabriel, 25-set-2026) ─────────────────
// Pregunta 4 de la revisión: «¿el libro diario se lleva en soles al TC de la
// fecha de emisión y el USD queda como referencia?». Sí. Hasta hoy este
// archivo no miraba `currency`: la factura F003-3384 de KOPLAST (US$ 80.000,
// TC 3,495) se asentaba «60 D 67.796,61 / 4011 D 12.203,39 / 42 H 80.000» con
// la etiqueta S/. Lo correcto son S/ 279.600, y así los 43 comprobantes en
// dólares del grupo.
//
// El tipo de cambio sale, en este orden: el estampado en el comprobante (es el
// que se declaró y queda congelado), y si no tiene, el de SUNAT para su fecha
// de emisión (`opts.tasaDe`, que la pantalla arma con la tabla `tipos_cambio`).
// Una COMPRA usa el de venta y una VENTA el de compra — eso lo resuelve
// `tasaDeComprobante()`, no esta lib.
//
// SIN TASA NO SE INVENTA NADA — y tampoco se bloquea (respuesta de Gabriel:
// «pedir la tasa para regularizarlos, no bloquear»). El asiento sale igual, en
// la moneda del papel, marcado `sinTipoCambio`: el Libro Diario lo aísla con su
// propio filtro, no lo suma a los totales en soles y el PLE no lo declara.
// Eran 6 el 25-set-2026.

/** El tipo de cambio de un comprobante en otra moneda, o null si no hay. */
export function tipoCambioDelMovimiento(m, opts = {}) {
  const moneda = String(m?.currency || 'PEN').toUpperCase();
  if (moneda === 'PEN') return null;
  const propio = Number(m?.tipo_cambio);
  if (propio > 0) return { tc: propio, origen: 'comprobante' };
  const buscado = typeof opts?.tasaDe === 'function' ? Number(opts.tasaDe(m)) : 0;
  if (buscado > 0) return { tc: buscado, origen: 'fecha' };
  return null;
}

/**
 * El mismo desglose multiplicado por el tipo de cambio. La base se recalcula
 * como total − IGV DESPUÉS de convertir, no se convierte por separado: si no,
 * el redondeo de cada pieza por su lado descuadra el asiento en un céntimo.
 */
function desgloseEnSoles(dg, tc) {
  const total = r2(dg.total * tc);
  const igv = r2(dg.igv * tc);
  return {
    ...dg,
    total,
    igv,
    subtotal: r2(total - igv),
    baseGravada: dg.baseGravada != null ? r2(dg.baseGravada * tc) : null,
    noGravado: r2((dg.noGravado || 0) * tc),
  };
}

// ── LAS ENTREGAS QUE CONSUMEN UN ANTICIPO (Gabriel, 25-set-2026) ──────
// «Sí se usa la 422. La factura de anticipo muestra IGV en su detalle.» El
// anticipo se asienta `422 D base / 40111 D IGV / 42 H total`: es un derecho
// contra el proveedor, no una compra. Y cada entrega que lo consume
// (`anticipo_aplicaciones`, mig 207) lleva a la 60 la base de lo que llegó
// contra la 422, SIN IGV: el crédito fiscal ya se tomó en el anticipo.
//
// El caso que lo mide: KOPLAST F003-3388/3395/3412/3417, cuatro facturas en
// CERO (el descuento del anticipo ya está en el pie) con aplicaciones de
// US$ 10.967,39 / 11.652,85 / 10.967,39 / 10.967,39 (con IGV, en la unidad
// del anticipo — tanda D). Hasta hoy eran cuatro asientos de S/ 0,00
// «cuadrados» y la mercadería no tocaba ninguna 60.
//
// La base se saca con la proporción base/total DEL ANTICIPO (lo que se aplica
// es parte de su total con IGV) y se convierte con el tipo de cambio DEL
// ANTICIPO, no con el de la entrega: la 422 es una partida no monetaria y
// queda al cambio histórico (NIC 21). Así la 422 se cancela exacta en soles.

/** Las aplicaciones de anticipo de una factura, ya en la unidad del asiento. */
function aplicacionesDelAsiento(m, opts, { enSoles }) {
  const filas = typeof opts?.aplicacionesDe === 'function' ? (opts.aplicacionesDe(m) || []) : [];
  const detalle = [];
  let base = 0;
  let faltaTc = false;
  for (const a of filas) {
    const anticipo = a?.anticipo;
    const monto = Math.abs(Number(a?.monto) || 0);
    if (!anticipo || anticipo.deleted_at || !(monto > 0)) continue;
    const dgA = desglosarIgv(anticipo);
    const ratio = Math.abs(dgA.total) > 0.005
      ? Math.abs(dgA.subtotal) / Math.abs(dgA.total)
      : 1 / (1 + IGV_RATE);
    const baseOrigen = r2(monto * ratio);
    const moneda = String(a?.moneda || anticipo.currency || 'PEN').toUpperCase();
    let tc = null;
    if (moneda !== 'PEN' && enSoles) {
      const t = tipoCambioDelMovimiento(anticipo, opts);
      if (!t) { faltaTc = true; continue; }
      tc = t.tc;
    }
    const importe = tc ? r2(baseOrigen * tc) : baseOrigen;
    base = r2(base + importe);
    detalle.push({
      anticipoId: anticipo.id, documento: anticipo.document_number || '',
      monto, moneda, baseOrigen, tc, importe,
    });
  }
  return { base, detalle, faltaTc };
}

// ── LA DETRACCIÓN EN EL ASIENTO (Gabriel, 25-set-2026) ───────────────
// El monto de la detracción se deposita SIEMPRE en soles (también cuando el
// comprobante está en dólares: es lo que guarda la columna, medido con la
// E001-11 de FRAJMAC, US$ 432 → S/ 173,75). Por eso solo se parte la
// contrapartida cuando el asiento está en soles.
//   · VENTA con la detracción ya depositada por el cliente: esa parte no llegó
//     a la cuenta corriente sino a la de detracciones del Banco de la Nación,
//     que es un fondo con destino obligado → `1071` (PCGE «Fondos sujetos a
//     restricción»). Antes el asiento ponía el total entero en la 104.
//   · COMPRA pendiente con la detracción ya depositada: esa parte de la deuda
//     ya se pagó → `42 H total − detracción` y `104 H detracción`.
function detraccionDepositada(m, { enSoles, total }) {
  if (!m?.detraccion_aplica || m.detraccion_estado !== 'depositada' || !enSoles || esNota(m)) return 0;
  const d = r2(Math.abs(Number(m.detraccion_monto) || 0));
  if (!(d > 0) || d >= Math.abs(total)) return 0;
  return d;
}

// Ojo: NO usar new Date('YYYY-MM-DD') — en Perú (UTC−5) devuelve el día
// anterior. fmtFechaLarga parte el string cuando es una fecha de día suelta.
const fmtDate = fmtFechaLarga;

// ─── Mapeos PCGE ─────────────────────────────────────────────

/**
 * Cuenta de gasto/ingreso inferida del campo `category`.
 *
 * ⚠️ ESTO YA NO ES LA FUENTE PRINCIPAL, Y NO DEBERÍA VOLVER A SERLO.
 *
 * Se escribió creyendo que `category` decía la naturaleza del gasto
 * («materiales», «servicios»). No dice eso: dice el TIPO DE DOCUMENTO. Medido
 * en producción el 17-set-2026, sobre 1.742 movimientos vivos, los únicos
 * cuatro valores existentes eran 'Factura' (1.710), 'Nota de Crédito' (28),
 * 'Recibo Honorarios' (3) y 'Boleta' (1). Ninguno coincide con ningún regex de
 * abajo, así que TODO caía al `return` final: costo → 60, gasto → 65,
 * ingreso → 70. Las contadoras veían la 60 en todo porque era lo único que
 * esta función podía devolver.
 *
 * Ahora la cuenta sale de lo que se COMPRÓ (`cuenta-de-comprobante.js`, que
 * lee los ítems del comprobante y los clasifica). Esto queda como último
 * recurso para un movimiento sin ítems y sin cuenta elegida a mano — y cuando
 * se usa, el asiento lo marca como provisional en vez de hacerlo pasar por
 * bueno.
 */
export function mapTypeToCategoria(type, category) {
  const cat = String(category || '').toLowerCase().trim();

  // Ingresos: 70 ventas / 704 servicios / 75 otros
  if (type === 'income') {
    if (/(servicio|consultoria|asesoria|alquiler|maquinaria)/.test(cat)) return '704';
    if (/(otro|diverso|financ)/.test(cat)) return '75';
    return '70';
  }

  // Costos directos de obra → 60 (compras) por defecto, salvo subcontrato
  if (type === 'cost') {
    if (/(material|insumo|suministro|repuesto|mercader)/.test(cat)) return '60';
    if (/(subcontrato|servicio|alquiler|flete|transporte|maquinaria)/.test(cat)) return '63';
    if (/(planilla|sueldo|salario|remunera|personal|mano)/.test(cat)) return '62';
    return '60';
  }

  // Gastos
  if (type === 'expense') {
    if (/(material|insumo|suministro|util)/.test(cat)) return '60';
    if (/(servicio|consultoria|asesoria|alquiler|flete|transporte|luz|agua|internet|telefon)/.test(cat)) return '63';
    if (/(planilla|sueldo|salario|remunera|personal|mano)/.test(cat)) return '62';
    if (/(tributo|impuesto|sunat|arbitrio|predial)/.test(cat)) return '64';
    if (/(intere|financ|comision|banc)/.test(cat)) return '67';
    return '65';
  }

  return '65';
}

/**
 * Caja vs Bancos según método de pago.
 * - efectivo / caja → 101 (Caja)
 * - transferencia / banco / yape / plin → 104 (Cuentas corrientes)
 * - default → 10 (Efectivo y equivalentes — cuenta padre)
 */
export function cuentaCajaOBanco(payment_method) {
  const pm = String(payment_method || '').toLowerCase().trim();
  if (/(efectivo|caja|cash)/.test(pm)) return '101';
  if (/(transfer|banco|yape|plin|deposito|cheque|tarjeta|visa|mastercard)/.test(pm)) return '104';
  return '10';
}

// El desglose base/IGV sale de `src/lib/igv-desglose.js`: usa el IGV REAL del
// comprobante (Captura Mágica lo guarda en el JSON de `notas`) y solo estima
// al 18 % cuando el movimiento no trae ninguno. Antes se inventaba SIEMPRE el
// 18 % y la repartición 70/4011 no era la de la factura (hallazgo de las
// contadoras 31-ago: E001-263 con IGV real de S/9 asentaba S/474.25).

// ─── Generador principal ─────────────────────────────────────

/**
 * Genera el asiento contable para un movimiento.
 * @param {object} movimiento accounting_movements row
 * @returns {{numero:string, fecha:string, glosa:string, type:string, partidas:Array,
 *            sumDebe:number, sumHaber:number, delta:number, cuadra:boolean, extorno:boolean}}
 */
export function generarAsiento(movimiento, opts = {}) {
  const m = movimiento || {};
  const totalCrudo = r2(Number(m.amount || 0));

  // ── NOTA DE CRÉDITO / monto NEGATIVO → asiento de EXTORNO ──────────
  // Captura Mágica guarda las NC con amount negativo. Antes, el IGV inferido
  // salía negativo y el `if (igv > 0)` OMITÍA la línea 4011 → el asiento
  // descuadraba exactamente en el IGV (bug real: Δ S/474.25 de GASOMI 2026,
  // NC E001-64; aprobado el fix por Gabriel 31-ago). Forma ortodoxa: montos
  // POSITIVOS con debe↔haber invertidos. La contrapartida es SIEMPRE la
  // cuenta por cobrar/pagar (121/42/41) y NUNCA caja: Captura Mágica fuerza
  // payment_status='paid' en toda NC pero no hubo devolución de efectivo.
  if (totalCrudo < 0) {
    const base = construirAsiento({
      ...m,
      amount: Math.abs(Number(m.amount || 0)),
      subtotal: m.subtotal != null ? Math.abs(Number(m.subtotal)) : m.subtotal,
      igv_amount: m.igv_amount != null ? Math.abs(Number(m.igv_amount)) : m.igv_amount,
      payment_status: 'pending',
    }, opts);
    const REN = [
      ['Cobro de ', 'Extorno cobro — '],
      ['Factura por cobrar — ', 'Extorno cta. por cobrar — '],
      ['Cuenta por pagar — ', 'Extorno cta. por pagar — '],
      ['Remuneraciones por pagar — ', 'Extorno remuneraciones — '],
      ['Pago de ', 'Extorno pago — '],
      ['IGV ventas', 'Extorno IGV ventas'],
      ['IGV crédito fiscal', 'Extorno IGV crédito fiscal'],
    ];
    const renombrar = (d) => {
      for (const [de, a] of REN) if (String(d).startsWith(de)) return a + String(d).slice(de.length);
      return d;
    };
    return finalizarAsiento({
      ...base,
      extorno: true,
      partidas: base.partidas.map(p => ({ ...p, debe: p.haber, haber: p.debe, descripcion: renombrar(p.descripcion) })),
    });
  }

  return finalizarAsiento(construirAsiento(m, opts));
}

// Suma final + campos de cuadre POR ASIENTO (herramienta de descuadre,
// pedido de las contadoras 31-ago): delta = debe − haber del propio asiento.
function finalizarAsiento(asiento) {
  const partidas = asiento.partidas.map(p => ({
    cuenta: p.cuenta,
    descripcion: p.descripcion,
    debe: r2(p.debe),
    haber: r2(p.haber),
  }));
  const sumDebe = r2(partidas.reduce((s, p) => s + p.debe, 0));
  const sumHaber = r2(partidas.reduce((s, p) => s + p.haber, 0));
  const delta = r2(sumDebe - sumHaber);
  return {
    ...asiento,
    partidas,
    sumDebe,
    sumHaber,
    delta,
    cuadra: Math.abs(delta) < 0.01,
    extorno: asiento.extorno === true,
    // Desglose base/IGV usado (con su origen: 'comprobante' | 'estimado' |
    // 'no_gravado'). El Libro Diario lo muestra cuando la tasa no es el 18 %
    // general o cuando tuvo que estimarse.
    desglose: asiento.desglose || null,
  };
}

/**
 * Las líneas de gasto/ingreso del asiento, con su cuenta y su parte de la base.
 *
 * Orden de precedencia, de lo más confiable a lo menos:
 *   1. `cuenta_pcge` — la cuenta que eligió una contadora a mano. Manda sobre
 *      todo, incluso sobre el reparto: es una persona corrigiendo a la máquina.
 *   2. El REPARTO que trae `repartoDe(mov)` (lo arma `cuenta-de-comprobante.js`
 *      leyendo los ítems del comprobante). Puede ser más de una línea: una
 *      factura de ferretería con materiales y herramientas va a 602 y a 656.
 *   3. `mapTypeToCategoria` — el último recurso, marcado provisional.
 *
 * La base se prorratea por las porciones y el redondeo se ajusta en la línea
 * más grande, para que la suma dé EXACTAMENTE la base imponible: si no, el
 * asiento descuadra por un centavo y aparece en la herramienta de descuadre
 * como si fuera un problema de datos.
 */
/**
 * Cuando el comprobante se parte en varias cuentas, cada línea dice de qué es.
 * Sin esto, el Libro Diario muestra la misma glosa dos veces con dos importes
 * distintos y no hay forma de saber cuál es cuál.
 */
function sufijoLinea(linea, cuantas) {
  if (cuantas < 2) return '';
  const fams = Array.isArray(linea.familias) ? linea.familias.filter(Boolean) : [];
  return fams.length ? ` — ${fams.join(', ')}` : '';
}

function lineasDeNaturaleza(m, base, opts) {
  const esIngreso = claseDe(m) === 'venta';
  const tipo = m.type || 'expense';

  if (m.cuenta_pcge) {
    return {
      lineas: [{ cuenta: m.cuenta_pcge, importe: base }],
      provisional: false, manual: true, revisar: false,
      origen: 'manual', confianza: 'manual',
    };
  }

  // El anticipo no es una compra: es plata a cuenta de una mercadería que
  // todavía no llegó. Va a la 422 y no pasa por el reparto de los ítems (su
  // único ítem dice «ANTICIPO DE CLIENTE» y el IUPC no lo reconoce: caía en la
  // 60 provisional). Una cuenta puesta a mano, arriba, le sigue ganando.
  if (!esIngreso && typeof opts?.esAnticipo === 'function' && opts.esAnticipo(m)) {
    return {
      lineas: [{ cuenta: '422', importe: base }],
      provisional: false, manual: false, revisar: false,
      origen: 'anticipo', confianza: 'alta', esAnticipo: true,
    };
  }

  const reparto = typeof opts?.repartoDe === 'function' ? opts.repartoDe(m) : null;

  // Un reparto PROVISIONAL quiere decir «no se pudo deducir nada de los
  // ítems». En ese caso la cuenta vieja inferida de `category` no es peor —
  // es la misma incertidumbre, pero al menos mira el campo, y para la planilla
  // (`category: 'planilla'`) acierta donde una cuenta provisional fija no. Se
  // usa ésa y se mantiene el aviso de provisional.
  if (reparto?.provisional) {
    return {
      lineas: [{ cuenta: mapTypeToCategoria(esIngreso ? 'income' : tipo, m.category), importe: base }],
      provisional: true, manual: false, revisar: true,
      origen: reparto.origen, confianza: reparto.confianza,
      porque: reparto.lineas?.[0]?.porque || '',
    };
  }

  if (reparto?.lineas?.length) {
    const lineas = reparto.lineas.map(l => ({
      cuenta: l.cuenta,
      cuentaMadre: l.cuentaMadre,
      importe: r2(base * l.porcion),
      familias: l.familias,
      confianza: l.confianza,
      revisar: l.revisar,
      porque: l.porque,
    }));
    // El resto del redondeo va a la línea mayor (la primera: vienen ordenadas).
    const suma = lineas.reduce((s, l) => s + l.importe, 0);
    const resto = r2(base - suma);
    if (resto !== 0 && lineas.length) lineas[0].importe = r2(lineas[0].importe + resto);
    return {
      lineas,
      provisional: reparto.provisional === true,
      manual: false,
      revisar: reparto.revisar === true,
      origen: reparto.origen,
      confianza: reparto.confianza,
    };
  }

  // Sin reparto: la inferencia vieja, dicha como lo que es.
  return {
    lineas: [{ cuenta: mapTypeToCategoria(esIngreso ? 'income' : tipo, m.category), importe: base }],
    provisional: true, manual: false, revisar: true,
    origen: 'ninguno', confianza: 'ninguna',
  };
}

function construirAsiento(movimiento, opts = {}) {
  const m = movimiento || {};
  const esVenta = claseDe(m) === 'venta';

  // ── LA UNIDAD DEL ASIENTO: soles, o la moneda del papel si falta la tasa ──
  const monedaOrigen = String(m.currency || 'PEN').toUpperCase();
  const dgOrigen = desglosarIgv(m);
  const tcMov = tipoCambioDelMovimiento(m, opts);
  // Las entregas contra un anticipo necesitan la tasa DEL ANTICIPO; si falta,
  // el asiento entero queda en la moneda del papel (factura y anticipo van en
  // la misma moneda: `anticipos.js` no deja cruzarlas).
  const aplicPrevia = monedaOrigen === 'PEN' || esVenta
    ? null
    : aplicacionesDelAsiento(m, opts, { enSoles: true });
  const faltaTcMov = monedaOrigen !== 'PEN' && !tcMov && Math.abs(dgOrigen.total) > 0.005;
  const sinTipoCambio = monedaOrigen !== 'PEN' && (faltaTcMov || !!aplicPrevia?.faltaTc);
  const enSoles = !sinTipoCambio;
  const monedaAsiento = enSoles ? 'PEN' : monedaOrigen;
  const desglose = (monedaOrigen !== 'PEN' && enSoles && tcMov)
    ? desgloseEnSoles(dgOrigen, tcMov.tc)
    : dgOrigen;
  const { total, subtotal, igv } = desglose;
  const conversion = monedaOrigen === 'PEN' ? null : {
    moneda: monedaOrigen,
    total: dgOrigen.total,
    tc: enSoles && tcMov ? tcMov.tc : null,
    origenTc: enSoles && tcMov ? tcMov.origen : null,
  };

  // Sufijo de la línea 4011: deja ver en el propio asiento (y en el PDF/Excel)
  // si el IGV salió del comprobante y a qué tasa, o si hubo que estimarlo.
  const igvNota = ` (${describirIgv(desglose)})`;
  // Parte del total que no paga IGV (exonerado / inafecto / ICBPER): va en la
  // MISMA cuenta 60/63/70 que la base gravada (así lo manda el PCGE), pero se
  // deja dicho en la glosa de la línea para que la contadora no lo busque.
  const noGravNota = Math.abs(desglose.noGravado || 0) > 0.005
    ? ` — incluye ${fmtMon(Math.abs(desglose.noGravado), monedaAsiento)} no gravado`
    : '';
  const tipo = m.type || 'expense';
  const pagado = m.payment_status === 'paid';
  // ── LA CONTRAPARTIDA: la otra pata del asiento ───────────────────
  // Hasta el 17-set salía SOLO de `metodo_pago`, y ese campo dice 'efectivo'
  // en 1.617 de 1.742 movimientos porque es el valor con el que nace la
  // captura, no algo que alguien haya elegido. Resultado: 111 compras pagadas
  // de S/ 2.000 o más se asentaban contra la caja 101, que es exactamente lo
  // que prohíbe la Ley de Bancarización.
  //
  // Ahora la decide `contrapartida.js` con lo que la app SÍ sabe —la
  // constancia de transferencia cargada, la detracción depositada, el método
  // de pago, el umbral del D.L. 1529— y cuando no alcanza para saberlo deja la
  // cuenta genérica 10 «por definir» en vez de afirmar una caja imposible.
  // Lo que la contadora haya puesto a mano (mig 220) le sigue ganando a todo.
  const contrapartidaManual = m.cuenta_pcge_contrapartida || null;
  const contra = resolverContrapartida(m, {
    bancarizado: opts?.bancarizadoIds instanceof Set
      ? (opts.bancarizadoIds.has(m.id)
        // Un par interco es UN comprobante y UNA transferencia: la constancia
        // de una pata vale para las dos (misma regla que el reporte contable).
        || !!(m.is_intercompany && m.related_movement_id && opts.bancarizadoIds.has(m.related_movement_id)))
      : false,
    // El umbral de US$ 500 / S/ 2.000 se mide con la tasa del comprobante.
    tipoCambio: opts?.tipoCambio ?? (tcMov ? tcMov.tc : null),
  });
  const cuentaCaja = contra.cuenta || cuentaCajaOBanco(m.metodo_pago || m.payment_method);
  const partidas = [];
  const desc = String(m.description || '').trim() || '(sin descripción)';
  // Columna real: document_number (documento/doc_numero/factura no existen —
  // la glosa nunca mostraba el número del comprobante).
  const docRef = m.document_number || m.documento || m.doc_numero || m.factura || '';

  // Lo que llegó contra un anticipo ya pagado. Se recalcula con la unidad que
  // quedó: si el asiento no pudo pasar a soles, va en la moneda del papel.
  const aplic = esVenta
    ? { base: 0, detalle: [], faltaTc: false }
    : aplicacionesDelAsiento(m, opts, { enSoles });
  const detr = detraccionDepositada(m, { enSoles, total });
  const totalCero = Math.abs(total) < 0.005;

  // Las cuentas de gasto/ingreso y cómo se reparte la base entre ellas. La
  // base de lo que llegó contra el anticipo entra a las MISMAS cuentas que la
  // del comprobante: es la misma mercadería, pagada por adelantado.
  const naturaleza = lineasDeNaturaleza(m, r2(subtotal + aplic.base), opts);
  // El importe que viaja al asiento de destino. Queda en 0 para las ventas:
  // un ingreso no se traslada por la 79, se cierra contra el resultado.
  let baseDestino = 0;
  // La cuenta de la contrapartida, dicha al empujarla: la última partida del
  // asiento puede ser la del destino o la del anticipo, no la de la plata.
  let cuentaContra = null;

  if (esVenta) {
    // ─── Ingreso (venta) ─────────────────────────────────
    cuentaContra = pagado ? cuentaCaja : (contrapartidaManual || '121');
    partidas.push({
      // 121 Facturas por cobrar, salvo que la contadora haya fijado otra
      // (131 si el cliente es una relacionada, por ejemplo).
      cuenta: cuentaContra,
      descripcion: pagado ? `Cobro de ${desc}` : `Factura por cobrar — ${desc}`,
      debe: r2(total - detr),
      haber: 0,
    });
    if (detr > 0) {
      partidas.push({
        cuenta: '1071',
        descripcion: `Detracción depositada en el Banco de la Nación — ${desc}`,
        debe: detr,
        haber: 0,
      });
    }
    for (const l of naturaleza.lineas) {
      partidas.push({
        cuenta: l.cuenta,
        descripcion: desc + noGravNota + sufijoLinea(l, naturaleza.lineas.length),
        debe: 0,
        haber: l.importe,
      });
    }
    if (igv > 0) {
      partidas.push({
        cuenta: '4011',
        descripcion: 'IGV ventas' + igvNota,
        debe: 0,
        haber: igv,
      });
    }
  } else {
    // ─── Costo / Gasto ───────────────────────────────────
    // Sobre qué importe se arma el asiento de destino: lo que se trasladó por
    // naturaleza, sin el IGV. El IGV no se traslada a ningún lado — es crédito
    // fiscal, no gasto. Se calcula DESPUÉS del ajuste de la planilla, porque
    // ahí el "IGV" inferido se suma al gasto y sí forma parte de lo que viaja.
    //
    // La planilla se reconoce por la cuenta 62 PELADA (o su 621
    // Remuneraciones), no por «cualquier cosa que caiga en el elemento 62».
    // Desde que la cuenta sale de los ítems, una factura de CAPACITACIÓN va a
    // la 624 y una de alimentación del personal a la 625 — las dos son 62 y
    // ninguna es planilla: llevan su IGV normal y se le deben a un proveedor
    // (42), no al trabajador (41).
    const esPlanilla = naturaleza.lineas.length === 1
      && (naturaleza.lineas[0].cuenta === '62' || naturaleza.lineas[0].cuenta === '621');

    for (const l of naturaleza.lineas) {
      partidas.push({
        cuenta: l.cuenta,
        descripcion: (naturaleza.esAnticipo ? `Anticipo a proveedor — ${desc}` : desc)
          + noGravNota + sufijoLinea(l, naturaleza.lineas.length),
        debe: l.importe,
        haber: 0,
      });
    }
    if (igv > 0 && !esPlanilla) {
      partidas.push({
        cuenta: '4011',
        descripcion: 'IGV crédito fiscal' + igvNota,
        debe: igv,
        haber: 0,
      });
    } else if (esPlanilla && igv > 0) {
      // Planilla no tiene IGV; el "igv" inferido se suma al gasto
      partidas[0].debe = r2(partidas[0].debe + igv);
    }

    // Las líneas de naturaleza son las primeras del asiento y nada se pushea
    // antes que ellas en esta rama: por eso el `slice` desde 0 es exacto.
    // Un anticipo no tiene destino: la 422 es Balance, no un gasto que
    // trasladar. Su destino llega con cada entrega.
    baseDestino = naturaleza.esAnticipo ? 0 : r2(
      partidas.slice(0, naturaleza.lineas.length).reduce((s, p) => s + p.debe, 0),
    );

    // Una factura en CERO no debe nada ni se pagó con nada: sin esta guarda el
    // asiento llevaba una línea «Pago de …» de S/ 0,00.
    if (!totalCero) {
      if (pagado) {
        cuentaContra = cuentaCaja;
        partidas.push({
          cuenta: cuentaCaja,
          descripcion: `Pago de ${desc}`,
          debe: 0,
          haber: total,
        });
      } else {
        // Pendiente: planilla → 41, resto → 42. La contadora puede fijar otra
        // (mig 220): un anticipo pendiente puede no ser una cuenta comercial.
        cuentaContra = contrapartidaManual || (esPlanilla ? '41' : '42');
        partidas.push({
          cuenta: cuentaContra,
          descripcion: esPlanilla
            ? `Remuneraciones por pagar — ${desc}`
            : `Cuenta por pagar — ${desc}`,
          debe: 0,
          haber: r2(total - detr),
        });
        if (detr > 0) {
          partidas.push({
            cuenta: '104',
            descripcion: `Depósito de la detracción — ${desc}`,
            debe: 0,
            haber: detr,
          });
        }
      }
    }
    if (aplic.base > 0) {
      const docs = aplic.detalle.map(d => d.documento).filter(Boolean).join(', ');
      partidas.push({
        cuenta: '422',
        descripcion: `Aplicación del anticipo${docs ? ` ${docs}` : ''} — ${desc}`,
        debe: 0,
        haber: aplic.base,
      });
    }
  }

  // Cuadre por redondeo: ajusta la última partida si es necesario
  const sumDebe = partidas.reduce((s, p) => s + p.debe, 0);
  const sumHaber = partidas.reduce((s, p) => s + p.haber, 0);
  const diff = r2(sumDebe - sumHaber);
  if (partidas.length && Math.abs(diff) > 0 && Math.abs(diff) < 0.05) {
    const last = partidas[partidas.length - 1];
    if (last.haber > 0) last.haber = r2(last.haber + diff);
    else last.debe = r2(last.debe - diff);
  }

  // ── EL ASIENTO DE DESTINO ─────────────────────────────────────────
  // Va DESPUÉS del cuadre por redondeo, no antes: ese ajuste toca la última
  // partida, y si la última fuera la del destino le movería un céntimo a una
  // pata sin movérselo a la otra — el asiento de destino dejaría de cuadrar
  // solo. Acá ya no hay nada que ajustar y estas dos líneas suman lo mismo de
  // los dos lados, así que el asiento sigue cuadrando.
  //
  // Son dos líneas del MISMO asiento y no un asiento aparte, a propósito: el
  // Libro Diario de JARVEX se deriva 1:1 del movimiento, y partirlo en dos
  // obligaría a numerar, ordenar y exportar un asiento que no tiene
  // comprobante propio. Contablemente es lo mismo — lo que importa es que las
  // cuatro líneas estén y que cuadren.
  //
  // La regla 68 → 78 mira la PRIMERA cuenta de naturaleza. Alcanza: la 68 es
  // depreciación y provisiones, que no salen de los ítems de un comprobante,
  // así que nunca viene repartida con otras.
  const destino = naturaleza.esAnticipo
    ? null
    : resolverDestino(m, { cuentaOrigen: naturaleza.lineas[0]?.cuenta || '' });
  if (destino?.cuenta && destino.contrapartida && baseDestino > 0) {
    partidas.push({
      cuenta: destino.cuenta,
      descripcion: `Destino — ${desc}`,
      debe: baseDestino,
      haber: 0,
    });
    partidas.push({
      cuenta: destino.contrapartida,
      descripcion: `Cargas imputables — ${desc}`,
      debe: 0,
      haber: baseDestino,
    });
  }

  const numero = m.id ? String(m.id).slice(0, 8).toUpperCase() : '—';
  const fecha = m.date || m.created_at || '';

  // ── LA SALIDA DEL INVENTARIO (tanda 5 del destino) ────────────────
  // Solo existe cuando el destino es una existencia. Es un asiento APARTE y no
  // dos líneas más de éste, porque lleva OTRA fecha: una compra de mayo que se
  // consume en agosto genera un costo de agosto. Ver el encabezado de
  // `existencias-balance.js`.
  const saldoExistencia = saldoDeExistencia(m, { entro: baseDestino });
  const salidaExistencia = saldoExistencia && m.existencia_salida_cuenta
    ? asientoDeSalida(m, {
      destino: destino?.cuenta || m.cuenta_pcge_destino,
      cuentaOrigen: naturaleza.lineas[0]?.cuenta || '',
      numero, glosa: docRef ? `${desc} (${docRef})` : desc, desc,
    })
    : null;

  return {
    numero,
    fecha,
    glosa: docRef ? `${desc} (${docRef})` : desc,
    type: tipo,
    movimiento_id: m.id,
    desglose,
    // En qué moneda están los importes de ESTE asiento: 'PEN' siempre que se
    // pudo convertir. `conversion` guarda lo que dice el papel (moneda, total
    // y la tasa usada) para mostrarlo al lado — el USD queda como referencia.
    moneda: monedaAsiento,
    sinTipoCambio,
    conversion,
    // Una factura en cero que no consumió ningún anticipo: el asiento sale
    // vacío. No es un error de cuadre sino un vínculo que falta hacer en el
    // panel de Anticipos, y por eso tiene su propio filtro.
    enCero: totalCero && !(aplic.base > 0) && !naturaleza.esAnticipo,
    esAnticipo: !!naturaleza.esAnticipo,
    anticipo: aplic.base > 0 ? { aplicado: aplic.base, detalle: aplic.detalle } : null,
    detraccion: detr > 0 ? { monto: detr, cuenta: esVenta ? '1071' : '104' } : null,
    // Lo que entró al Balance por este comprobante y lo que queda ahí. Va en
    // la raíz y no dentro de `cuentas` porque el panel de existencias lo lee
    // sin mirar el estado de las cuentas, y porque `entro` es el número que
    // `existencias-balance.js` no puede calcular por su cuenta.
    existencia: saldoExistencia,
    salidaExistencia,
    // Lo que viaja al asiento de destino: la base sin IGV, ya repartida. Es el
    // TOPE de lo que puede salir del inventario, y la pantalla lo necesita
    // antes de guardar —cuando `existencia` todavía es null porque el destino
    // recién se está eligiendo—. Se expone en vez de recalcularlo allá: dos
    // cuentas del mismo número terminan en dos números distintos.
    baseDestino: r2(baseDestino),
    // De dónde salió la cuenta y cuánto se le puede creer. El Libro Diario lo
    // muestra como badge: una cuenta provisional con cara de definitiva es
    // justo lo que hizo que nadie mirara las 1.742 filas que decían 60.
    cuentas: {
      origen: naturaleza.origen,
      confianza: naturaleza.confianza,
      provisional: naturaleza.provisional,
      manual: naturaleza.manual,
      // La contrapartida se corrige aparte de la cuenta de gasto: una puede
      // estar puesta a mano y la otra no.
      contrapartidaManual: !!contrapartidaManual,
      // De dónde salió la contrapartida y si quedó sin definir. Es lo que el
      // Libro Diario muestra como badge y lo que hace que estas filas se
      // puedan aislar: una contrapartida provisional con cara de definitiva es
      // el mismo error que tenía la cuenta de gasto antes de la tanda 2.
      contrapartida: {
        cuenta: cuentaContra,
        origen: contra.origen,
        confianza: contra.confianza,
        porque: contra.porque,
        porDefinir: contra.porDefinir && pagado && !totalCero,
        prohibeEfectivo: contra.prohibeEfectivo,
        // Si igual terminó en la caja (porque alguien la puso a mano sabiendo
        // lo que hacía), el asiento lleva la consecuencia tributaria escrita.
        aviso: pagado && !totalCero ? avisoEfectivoSobreUmbral(m, cuentaCaja) : null,
      },
      // A DÓNDE FUE, que es la mitad que faltaba. `null` en una venta: un
      // ingreso no se traslada por la 79. En un egreso siempre hay objeto,
      // aunque sea para decir `porDefinir` — es lo que permite aislar la pila
      // de los que todavía nadie destinó, igual que se hizo con la cuenta.
      // Un anticipo tampoco tiene: la 422 es Balance.
      destino: destino ? {
        cuenta: destino.cuenta,
        nombre: nombreDestino(destino.cuenta),
        contrapartida: destino.contrapartida,
        porque: destino.porque,
        manual: destino.manual,
        confianza: destino.confianza,
        porDefinir: destino.porDefinir,
      } : null,
      revisar: naturaleza.revisar,
      partida: naturaleza.lineas.length > 1,
      detalle: naturaleza.lineas.map(l => ({
        cuenta: l.cuenta, cuentaMadre: l.cuentaMadre, importe: l.importe,
        familias: l.familias || [], porque: l.porque || '',
      })),
    },
    partidas: partidas.map(p => ({
      cuenta: p.cuenta,
      descripcion: p.descripcion,
      debe: r2(p.debe),
      haber: r2(p.haber),
    })),
  };
}

/**
 * El asiento que SACA del Balance lo que había entrado al inventario.
 *
 * Es un asiento propio, con la fecha en que la cosa salió del almacén —que es
 * la que decide de qué período es el costo— y con el número del comprobante
 * más un sufijo, para que se pueda rastrear a qué compra corresponde sin
 * inventarle una numeración nueva a un asiento que no tiene comprobante
 * propio.
 *
 * Las patas las arma `existencias-balance.js` y cuadran por construcción: son
 * pares debe/haber del mismo importe. Igual se calcula el cuadre como en
 * cualquier otro asiento, porque el Libro Diario lo muestra para todos y un
 * asiento que dijera «cuadra» sin haberlo verificado sería el único del libro
 * en el que hay que creer a ciegas.
 */
function asientoDeSalida(m, { destino, cuentaOrigen, numero, glosa, desc }) {
  const salida = patasDeSalida({
    destino,
    cuentaSalida: m.existencia_salida_cuenta,
    importe: m.existencia_salida_importe,
    cuentaOrigen,
  });
  if (!salida) return null;

  const partidas = salida.patas.map(p => ({
    cuenta: p.cuenta,
    descripcion: `Salida de inventario — ${desc}`,
    debe: r2(p.debe),
    haber: r2(p.haber),
  }));
  const sumDebe = r2(partidas.reduce((s, p) => s + p.debe, 0));
  const sumHaber = r2(partidas.reduce((s, p) => s + p.haber, 0));
  const delta = r2(sumDebe - sumHaber);

  return {
    numero: `${numero}-S`,
    fecha: String(m.existencia_salida_fecha || '').slice(0, 10),
    glosa: `Salida de inventario — ${glosa}`,
    // El tipo del comprobante, para que los filtros y los totales del Libro
    // Diario lo traten igual que a su compra. Una venta no llega acá.
    type: m.type === 'income' ? 'income' : (m.type || 'expense'),
    movimiento_id: m.id,
    // La marca por la que la pantalla sabe que esta fila NO es el asiento del
    // comprobante sino su descarga: no se le ofrece corregir la cuenta acá.
    esSalidaExistencia: true,
    desglose: null,
    existencia: null,
    salidaExistencia: null,
    cuentas: {
      origen: 'existencia',
      confianza: 'manual',
      provisional: false,
      manual: true,
      contrapartidaManual: false,
      contrapartida: {
        cuenta: null, origen: 'existencia', confianza: 'manual',
        porque: salida.porque, porDefinir: false, prohibeEfectivo: false, aviso: null,
      },
      destino: {
        cuenta: m.existencia_salida_cuenta,
        nombre: nombreSalida(m.existencia_salida_cuenta),
        contrapartida: null,
        porque: salida.porque,
        manual: true,
        confianza: 'manual',
        porDefinir: false,
      },
      revisar: null,
      partida: false,
      detalle: [],
    },
    partidas,
    sumDebe,
    sumHaber,
    delta,
    cuadra: Math.abs(delta) < 0.01,
    extorno: false,
    venta: salida.venta,
    porque: salida.porque,
  };
}

/**
 * Procesa un array de movimientos y devuelve sus asientos.
 * Filtra registros eliminados (deleted_at) y anulados (cancelled).
 *
 * Desde la tanda 5 del destino un movimiento puede producir DOS asientos: el
 * de la compra y, si lo comprado ya salió del inventario, el de la salida —con
 * su propia fecha—. Por eso es `flatMap` y no `map`.
 *
 * @param {object} [opts]
 *   repartoDe(mov) → el reparto de cuentas del comprobante, o null.
 *     Se INYECTA en vez de importarse: quien lo arma es
 *     `cuenta-de-comprobante.js`, que necesita el catálogo de insumos y el
 *     clasificador IUPC —datos de Dexie y un diccionario de 938 términos— y
 *     nada de eso tiene por qué viajar en el chunk del Libro Diario. Esta lib
 *     sigue siendo pura y sin dependencias.
 *     Sin `repartoDe`, el asiento sale como salía: con la cuenta inferida del
 *     campo `category`, pero ahora marcada `provisional`.
 *   tasaDe(mov) → tipo de cambio de SUNAT para la fecha de emisión, si el
 *     comprobante no trae el suyo (25-set-2026). Sin él, un comprobante en
 *     dólares sin tasa estampada sale `sinTipoCambio`.
 *   esAnticipo(mov) / aplicacionesDe(mov) → el anticipo a proveedor va a la
 *     422 y cada entrega que lo consume, 60 contra 422. Los arma
 *     `asientos-contexto.js` con `anticipo_aplicaciones`.
 *   referencia → TODOS los movimientos (o un Map por id): para reconocer una
 *     nota de crédito cuya factura está dada de baja aunque la factura sea de
 *     otro mes. Esa nota no resta: ver `notas-credito.js`.
 */
export function generarAsientosBatch(movimientos, opts = {}) {
  const arr = Array.isArray(movimientos) ? movimientos : [];
  // La ventana del período que se está mirando, si la pantalla la pasa. Filtra
  // por la fecha del ASIENTO y no por la del movimiento, que desde la tanda 5
  // dejaron de ser lo mismo: la salida de inventario de una factura de mayo
  // puede ser de agosto y pertenece a agosto. Sin `ventana`, sale todo.
  const dentro = (a) => {
    const v = opts.ventana;
    if (!v) return true;
    const ymd = String(a.fecha || '').slice(0, 10);
    if (v.anio && ymd.slice(0, 4) !== String(v.anio)) return false;
    if (v.mes && v.mes !== 'all' && ymd.slice(5, 7) !== String(v.mes)) return false;
    return true;
  };
  // Factura y nota quedan las DOS vivas (Gabriel, 25-set-2026); una nota cuya
  // factura igual quedó dada de baja no resta, o la baja se cuenta dos veces.
  return movimientosQueCuentan(arr, { referencia: opts.referencia || arr })
    .flatMap((m) => {
      const a = generarAsiento(m, opts);
      return a.salidaExistencia ? [a, a.salidaExistencia] : [a];
    })
    .filter(dentro)
    .sort((a, b) => {
      const da = new Date(a.fecha).getTime() || 0;
      const db = new Date(b.fecha).getTime() || 0;
      return da - db;
    });
}

// ── EN QUÉ ESTADO ESTÁ LA CUENTA DE UN ASIENTO ────────────────
//
// Sirve para aislarlos en el Libro Diario. Lo pidió Gabriel al probar la
// tanda 2: los asientos cuya cuenta no se pudo deducir quedaban mezclados
// entre los buenos y había que buscarlos badge por badge. En producción son
// 345 de 1.742 — una lista por la que se puede pasar de a tandas, pero solo si
// se la puede separar del resto.
//
// Vive acá y no en la pantalla porque es una propiedad del ASIENTO, no de cómo
// se lo muestre: el mismo criterio tiene que valer para el filtro, para los
// exports y para cualquier reporte que lo pregunte después.
export const ESTADOS_CUENTA = [
  { v: 'todas',       label: 'Todas las cuentas' },
  { v: 'por_definir', label: '⚠ Cuenta por definir' },
  { v: 'floja',       label: 'Deducidas poco seguras' },
  { v: 'revisar',     label: 'Marcadas para revisar' },
  { v: 'partida',     label: 'Repartidas en varias cuentas' },
  { v: 'manual',      label: 'Puestas a mano' },
  // Los dos de la CONTRAPARTIDA (17-set). Son preguntas distintas de las de
  // arriba: la cuenta del gasto puede estar perfecta y la de la plata no.
  { v: 'contrapartida_por_definir', label: '⚠ Contrapartida por definir' },
  { v: 'efectivo_sobre_umbral',     label: '⚠ Efectivo sobre el umbral' },
  // El del DESTINO (18-set). Otra pregunta más: la cuenta del gasto puede
  // estar perfecta, la plata bien puesta, y seguir sin saberse para qué fue.
  // Eran 685 de 1.789 el día que se soltó. Desde el mismo 18-set los 403 de
  // contabilidad neta reciben la 91 como propuesta floja, así que la pila
  // «por definir» queda en los 282 sin destino contable, y los 403 tienen su
  // propio filtro: una propuesta floja sin filtro se pierde entre las buenas.
  { v: 'destino_por_definir',       label: '⚠ Destino por definir' },
  { v: 'destino_flojo',             label: 'Destino propuesto poco seguro' },
  // El de la EXISTENCIA (tanda 5, 21-set). La pregunta que antes no se podía
  // hacer: qué está parado en el Balance sin haber salido nunca del almacén.
  // Es la pila que hay que mirar antes de cerrar el mes — cada fila de ahí es
  // un costo que todavía no bajó ningún resultado.
  { v: 'existencia_en_balance',     label: '📦 Sigue en el inventario' },
  // Los dos de la MONEDA y del ANTICIPO (25-set). Ninguno es un error de la
  // cuenta: son datos que faltan cargar. Uno es la tasa SUNAT de una fecha
  // (sin ella el asiento queda en dólares, fuera de los totales y del PLE);
  // el otro, vincular una factura en cero con el anticipo que la pagó (sin
  // eso la mercadería no llega a la 60).
  { v: 'sin_tipo_cambio',           label: '⚠ En otra moneda sin tipo de cambio' },
  { v: 'en_cero',                   label: '⚠ Factura en cero sin anticipo vinculado' },
];

/**
 * ¿Este asiento está en ese estado?
 *
 * Los estados NO son excluyentes en el dato —un asiento partido puede además
 * ser de confianza baja— pero sí en el filtro: se elige por el que uno lo
 * buscaría. `por_definir` y `manual` sí son excluyentes de verdad, y hay un
 * test que lo vigila: una cuenta elegida a mano nunca está «por definir».
 */
export function cumpleEstadoCuenta(asiento, estado) {
  // La existencia se pregunta sobre el asiento entero, no sobre sus cuentas, y
  // va antes del early return: un asiento sin reparto igual puede tener un
  // destino de inventario puesto a mano.
  if (estado === 'existencia_en_balance') {
    return !asiento?.esSalidaExistencia && (asiento?.existencia?.queda || 0) > 0.01;
  }
  if (estado === 'sin_tipo_cambio') return asiento?.sinTipoCambio === true;
  if (estado === 'en_cero') return asiento?.enCero === true;
  const c = asiento?.cuentas;
  // Un asiento generado sin el reparto no se da por bueno solo por ser viejo:
  // que no sepamos de dónde salió su cuenta es justo estar «por definir».
  if (!c) return estado === 'por_definir' || estado === 'todas';
  switch (estado) {
    case 'por_definir': return c.provisional === true;
    case 'floja':       return !c.provisional && c.confianza === 'baja';
    case 'revisar':     return !c.provisional && c.revisar === true;
    case 'partida':     return c.partida === true;
    case 'manual':      return c.manual === true;
    // La contrapartida puesta a mano nunca está «por definir», igual que la
    // cuenta de gasto: la decisión humana cierra la pregunta.
    case 'contrapartida_por_definir': return c.contrapartida?.porDefinir === true && c.contrapartidaManual !== true;
    case 'efectivo_sobre_umbral':     return !!c.contrapartida?.aviso;
    // Una venta NO está «sin destino»: no le corresponde tener uno. Si contara
    // como pendiente, la pila incluiría 169 comprobantes que nadie puede
    // resolver, y una pila con basura adentro es una pila que no se trabaja.
    case 'destino_por_definir':       return c.destino?.porDefinir === true;
    case 'destino_flojo':             return c.destino?.manual === false && c.destino?.confianza === 'baja';
    default:            return true;
  }
}

/** Cuántos asientos hay en cada estado. Para los contadores del desplegable. */
export function contarEstadosDeCuenta(asientos = []) {
  const out = { todas: asientos.length };
  for (const e of ESTADOS_CUENTA) {
    if (e.v === 'todas') continue;
    out[e.v] = asientos.filter(a => cumpleEstadoCuenta(a, e.v)).length;
  }
  return out;
}

/**
 * Explica en lenguaje de contadora POR QUÉ un asiento no cuadra.
 * Devuelve null si el asiento cuadra. La herramienta de descuadre del Libro
 * Diario la muestra en la fila del asiento marcado (pedido 31-ago).
 */
export function explicarDescuadre(asiento, movimiento) {
  if (!asiento || asiento.cuadra) return null;
  const m = movimiento || {};
  const d = fmtS(Math.abs(asiento.delta));
  const lado = asiento.delta > 0 ? 'el DEBE excede al HABER' : 'el HABER excede al DEBE';
  const doc = m.document_number ? ` (${m.document_type || 'doc'} ${m.document_number})` : '';

  // Solo si el asiento NO salió como extorno: un extorno descuadrado viene de
  // DATOS inconsistentes (rama de base+IGV, abajo), no de una versión vieja.
  if (Number(m.amount) < 0 && !asiento.extorno) {
    return `Este movimiento${doc} tiene monto NEGATIVO (${fmtS(m.amount)}) — normalmente una nota de crédito. ` +
      `El generador debería asentarlo como extorno; si ves este aviso, recargá la app (versión vieja en caché). Δ ${d}: ${lado}.`;
  }
  // Desde el fix del desglose real (31-ago) la base se calcula como
  // total − IGV del comprobante, así que un asiento NO debería descuadrar
  // nunca por ahí. Si igual descuadra, el dato de origen está roto.
  const dg = asiento.desglose;
  if (dg) {
    return `Las líneas de este asiento no suman igual: ${lado} por ${d}. ` +
      `Se asentó base ${fmtS(Math.abs(dg.subtotal))} + IGV ${fmtS(Math.abs(dg.igv))} ` +
      `(${dg.origen === 'estimado' ? 'IGV estimado al 18 %: el comprobante no trae desglose' : 'IGV tomado del comprobante'}) ` +
      `sobre un total de ${fmtS(Math.abs(dg.total))}. Revisá el monto del movimiento${doc}.`;
  }
  return `Las líneas de este asiento no suman igual: ${lado} por ${d}. ` +
    `Revisá el movimiento origen${doc} — monto, base imponible e IGV.`;
}

/**
 * Vista de texto de un asiento — útil para preview / debug.
 */
export function formatAsientoTxt(asiento) {
  if (!asiento) return '';
  const lines = [];
  lines.push(`Asiento N° ${asiento.numero}    Fecha: ${fmtDate(asiento.fecha)}`);
  lines.push(`Glosa: ${asiento.glosa}`);
  lines.push('─'.repeat(72));
  lines.push('Cuenta  Descripción                              Debe         Haber');
  lines.push('─'.repeat(72));
  let sd = 0, sh = 0;
  asiento.partidas.forEach(p => {
    const cta = String(p.cuenta).padEnd(7);
    const desc = String(p.descripcion).slice(0, 38).padEnd(40);
    const debe = p.debe > 0 ? fmtS(p.debe).padStart(12) : ''.padStart(12);
    const haber = p.haber > 0 ? fmtS(p.haber).padStart(12) : ''.padStart(12);
    lines.push(`${cta} ${desc} ${debe} ${haber}`);
    sd += p.debe; sh += p.haber;
  });
  lines.push('─'.repeat(72));
  lines.push(`TOTALES:                                          ${fmtS(sd).padStart(12)} ${fmtS(sh).padStart(12)}`);
  return lines.join('\n');
}

export default {
  generarAsiento,
  generarAsientosBatch,
  formatAsientoTxt,
  explicarDescuadre,
  mapTypeToCategoria,
  cuentaCajaOBanco,
};
