// ═══════════════════════════════════════════════════════════════════
// JARVEX — DE DÓNDE SALIÓ LA PLATA: la contrapartida del asiento.
//
// Pedido de Gabriel (17-set-2026), probando la tanda 3: «veo que puedo colocar
// a mano lo que yo crea conveniente, aunque realmente esto debería ser
// automático basado en la información de si la factura se pagó en efectivo,
// transferencia y otras modalidades. Toda compra mayor a 2 mil soles está
// sujeta a bancarización, por lo tanto eso no puede ser a efectivo y las
// opciones se reducen a transferencias, depósitos o contrarrestar con alguna
// factura entre ellos. Considerando que a veces las asistentes de contabilidad
// simplemente suben las facturas sin saber realmente qué método de pago fue».
//
// ── EL PROBLEMA MEDIDO (producción, 17-set-2026) ───────────────────
// `metodo_pago` dice 'efectivo' en 1.617 de 1.742 movimientos. NO es que la
// obra pague todo en efectivo: es que Captura Mágica lo escribe por defecto
// cuando nadie eligió nada (`jx-captura-magica.jsx`, alta manual). O sea que
// 'efectivo' no es un dato, es la ausencia de dato — y el asiento lo tomaba
// como declaración y mandaba 111 comprobantes pagados de S/ 2.000 o más a la
// caja 101, que es justo lo que la Ley 28194 prohíbe.
//
// ── QUÉ SE HACE CON ESO ────────────────────────────────────────────
// 1. Se usa la EVIDENCIA que ya está en la app y el asiento ignoraba: la
//    constancia de bancarización cargada, el depósito multi-factura de la
//    mig 137, el pago hecho contra una cuenta bancaria. Si hay constancia,
//    la plata salió del banco: 104. Eso es «automático basado en la
//    información», y hasta hoy no se leía.
// 2. Si la compra está sujeta a bancarización y NO hay evidencia, la
//    contrapartida queda POR DEFINIR (cuenta genérica 10 «Efectivo y
//    equivalentes de efectivo») en vez de afirmar una caja que no puede ser.
//    Cae en la pila que la contadora ya puede despachar en lote desde el
//    Libro Diario. La regla de la casa: una fila que dice «no sé» se filtra y
//    se resuelve; una con un código inventado se pierde entre las buenas.
// 3. La caja 101 queda BLOQUEADA en esos casos, con el motivo a la vista, y se
//    puede desbloquear a mano: si la compra se pagó en efectivo de verdad —
//    pasa, y es una infracción del que pagó, no del que asienta— el libro
//    tiene que decir la verdad. Lo que no puede es decirlo en silencio: se
//    muestra la consecuencia (art. 8 de la Ley 28194: sin medio de pago no
//    hay crédito fiscal ni gasto ni costo deducible) y queda en auditoría.
//
// ── DÓNDE APLICA, Y DÓNDE NO ───────────────────────────────────────
// · Solo en COMPRAS: el que pierde el crédito fiscal y la deducción es quien
//   PAGA. En una venta cobrada en efectivo el problema tributario es del
//   cliente, y nuestro libro debe reflejar lo que entró a la caja.
// · Solo en lo PAGADO: la bancarización se incumple al pagar. Un comprobante
//   pendiente tiene como contrapartida una deuda (42, o 41 si es planilla) y
//   ahí no hay nada que prohibir todavía. En producción hay 207 pendientes de
//   S/ 2.000 o más con 'efectivo' escrito: ninguno es infracción, todavía no
//   se pagaron.
//
// El umbral y la conversión multimoneda NO se recalculan acá: salen de
// `requiereBancarizacion()` en `tipo-cambio.js`, que ya sabe del D.L. 1529
// (S/ 2.000 o US$ 500) y es la misma función con la que el reporte contable
// reclama las constancias faltantes. Una sola definición del umbral.
// ═══════════════════════════════════════════════════════════════════

import { requiereBancarizacion, UMBRAL_BANCARIZACION_PEN, UMBRAL_BANCARIZACION_USD } from './tipo-cambio.js';

export const CAJA = '101';           // Caja
export const BANCOS = '104';         // Cuentas corrientes en instituciones financieras
export const SIN_DEFINIR = '10';     // Efectivo y equivalentes de efectivo (el «no sé» honesto)
export const POR_PAGAR = '42';       // Cuentas por pagar comerciales – terceros
export const PLANILLA = '41';        // Remuneraciones y participaciones por pagar
export const POR_COBRAR = '121';     // Facturas, boletas y otros comprobantes por cobrar
export const POR_COBRAR_REL = '131'; // Ídem, relacionadas (compensación dentro del grupo)

// Qué medios de pago son «por el banco». `deposito`, `cheque`, `yape` y `plin`
// cuentan: son medios de pago de la Ley 28194 (los dos últimos son dinero
// electrónico de una cuenta bancaria).
const RX_BANCO = /(transfer|banco|bancari|yape|plin|deposit|cheque|tarjeta|visa|mastercard|abono)/;
// «contado» NO entra: dice CUÁNDO se pagó, no CON QUÉ. Una factura al contado
// puede pagarse con transferencia el mismo día.
const RX_EFECTIVO = /(efectivo|caja|cash)/;

/**
 * Qué dice el campo `metodo_pago`: 'banco' | 'efectivo' | 'desconocido'.
 *
 * 'efectivo' vale como dato solo cuando alguien lo eligió; acá no se puede
 * distinguir eso del default, así que quien decide qué tan lejos llegar con
 * esa palabra es `resolverContrapartida()` según el monto.
 */
export function medioDePago(metodo) {
  const pm = String(metodo || '').toLowerCase().trim();
  if (!pm) return 'desconocido';
  if (RX_BANCO.test(pm)) return 'banco';
  if (RX_EFECTIVO.test(pm)) return 'efectivo';
  return 'desconocido';
}

/** ¿Este movimiento es una compra (nosotros pagamos)? `clase` manda, como en toda la app. */
function esCompra(m) {
  const clase = m?.clase || (m?.type === 'income' ? 'venta' : 'compra');
  return clase === 'compra';
}

/** ¿Está pagado / cobrado? */
function estaPagado(m) {
  return m?.payment_status === 'paid';
}

/**
 * ¿La caja está prohibida para este movimiento?
 *
 * Sí cuando es una COMPRA PAGADA que superó el umbral de bancarización. La
 * nota de crédito (monto negativo) no paga nada: se mide por valor absoluto
 * igual, porque extorna una compra que sí lo estaba.
 */
export function efectivoProhibido(m, { tipoCambio = null } = {}) {
  if (!m || !esCompra(m) || !estaPagado(m)) return false;
  return requiereBancarizacion(Math.abs(Number(m.amount) || 0), m.currency, tipoCambio ?? m.tipo_cambio, m.date);
}

/** El umbral que aplica, para poder decirlo en el aviso. */
export function umbralDe(m) {
  const cur = String(m?.currency || 'PEN').toUpperCase();
  return cur === 'USD'
    ? { monto: UMBRAL_BANCARIZACION_USD, moneda: 'USD', texto: 'US$ 500' }
    : { monto: UMBRAL_BANCARIZACION_PEN, moneda: 'PEN', texto: 'S/ 2.000' };
}

/**
 * La contrapartida de un movimiento: qué cuenta va, de dónde salió eso, y
 * cuánto se le puede creer.
 *
 * @param {object} m   movimiento de accounting_movements
 * @param {object} ctx
 *   · `bancarizado`   true si hay constancia / depósito / pago por cuenta
 *                     bancaria (lo sabe `cargarBancarizados()` en
 *                     `reportes-contable.js`, que ya existía y nadie leía acá)
 *   · `esRelacionada` true si el tercero es otra empresa del grupo — cambia
 *                     la cuenta de la compensación (131 en vez de 121)
 *   · `tipoCambio`    para el umbral en otra moneda
 * @returns {{cuenta:string|null, origen:string, confianza:string, porque:string,
 *            prohibeEfectivo:boolean, porDefinir:boolean}}
 */
export function resolverContrapartida(m, ctx = {}) {
  const mov = m || {};
  const { bancarizado = false, tipoCambio = null } = ctx;
  const prohibeEfectivo = efectivoProhibido(mov, { tipoCambio });

  // La decisión humana manda sobre todo lo demás, siempre (mig 220).
  if (mov.cuenta_pcge_contrapartida) {
    return {
      cuenta: mov.cuenta_pcge_contrapartida,
      origen: 'manual',
      confianza: 'alta',
      porque: 'La eligió una persona.',
      prohibeEfectivo,
      porDefinir: false,
    };
  }

  const pagado = estaPagado(mov);
  const compra = esCompra(mov);

  // ── PENDIENTE: la contrapartida es una DEUDA, no plata ────────────
  // No hay bancarización que discutir: todavía no se pagó nada. Quién es el
  // acreedor lo decide `asientos.js` (41 si el asiento salió planilla, 42 si
  // no), porque eso se sabe recién con las cuentas de gasto ya repartidas.
  if (!pagado) {
    return {
      cuenta: null,                      // que la ponga asientos.js: 42 / 41 / 121
      origen: 'deuda',
      confianza: 'alta',
      porque: compra
        ? 'El comprobante está pendiente de pago: la contrapartida es la deuda.'
        : 'La factura está pendiente de cobro: la contrapartida es la cuenta por cobrar.',
      prohibeEfectivo: false,
      porDefinir: false,
    };
  }

  // ── PAGADO / COBRADO ─────────────────────────────────────────────
  // 1. Evidencia dura: hay constancia de transferencia o depósito cargada.
  if (bancarizado) {
    return {
      cuenta: BANCOS,
      origen: 'constancia',
      confianza: 'alta',
      porque: 'Tiene cargada la constancia de la transferencia o del depósito: la plata se movió por el banco.',
      prohibeEfectivo,
      porDefinir: false,
    };
  }

  // 2. La detracción depositada prueba que la operación pasó por el banco (el
  //    depósito se hace en el Banco de la Nación). No prueba con qué se pagó
  //    el saldo, así que vale como indicio fuerte, no como constancia.
  if (mov.detraccion_aplica && mov.detraccion_estado === 'depositada') {
    return {
      cuenta: BANCOS,
      origen: 'detraccion',
      confianza: 'media',
      porque: 'La detracción está depositada, así que la operación pasó por el banco. Si el saldo se pagó de otra cuenta, corregila.',
      prohibeEfectivo,
      porDefinir: false,
    };
  }

  const medio = medioDePago(mov.metodo_pago || mov.payment_method);

  // 3. El método de pago dice banco: se le cree.
  if (medio === 'banco') {
    return {
      cuenta: BANCOS,
      origen: 'metodo_pago',
      confianza: 'media',
      porque: `El método de pago del comprobante dice «${String(mov.metodo_pago || '').trim()}».`,
      prohibeEfectivo,
      porDefinir: false,
    };
  }

  // 4. Dice efectivo (o no dice nada) y la compra está sujeta a bancarización:
  //    POR DEFINIR. No se afirma la caja —no puede ser— ni el banco, que sería
  //    inventar un dato que nadie cargó.
  if (prohibeEfectivo) {
    const u = umbralDe(mov);
    return {
      cuenta: SIN_DEFINIR,
      origen: 'por_definir',
      confianza: 'ninguna',
      porque: medio === 'efectivo'
        ? `El comprobante dice «efectivo», pero una compra pagada de ${u.texto} o más está sujeta a bancarización y no puede salir de la caja. Falta decir de qué cuenta salió, o cargar la constancia.`
        : `No consta cómo se pagó, y una compra de ${u.texto} o más está sujeta a bancarización. Falta decir de qué cuenta salió, o cargar la constancia.`,
      prohibeEfectivo: true,
      porDefinir: true,
    };
  }

  // 5. Efectivo por debajo del umbral: la caja es perfectamente legal.
  if (medio === 'efectivo') {
    return {
      cuenta: CAJA,
      origen: 'metodo_pago',
      confianza: 'media',
      porque: 'El comprobante dice efectivo y está por debajo del umbral de bancarización.',
      prohibeEfectivo: false,
      porDefinir: false,
    };
  }

  // 6. No se sabe nada y no hay umbral que obligue: cuenta genérica, por definir.
  return {
    cuenta: SIN_DEFINIR,
    origen: 'ninguno',
    confianza: 'ninguna',
    porque: 'El comprobante no dice de dónde salió la plata. Elegí la caja o el banco.',
    prohibeEfectivo: false,
    porDefinir: true,
  };
}

/**
 * Las cuentas que se pueden elegir como contrapartida, en el orden en que
 * conviene mirarlas para ESTE movimiento, con la de efectivo bloqueada cuando
 * la ley la prohíbe.
 *
 * No se esconde la prohibida: se muestra apagada con el motivo. Esconderla
 * haría que alguien la busque en el buscador de 1.792 cuentas y la ponga sin
 * enterarse de por qué no estaba.
 */
export function opcionesContrapartida(m, ctx = {}) {
  const mov = m || {};
  const compra = esCompra(mov);
  const pagado = estaPagado(mov);
  const prohibida = efectivoProhibido(mov, ctx);
  const esRelacionada = !!(ctx.esRelacionada ?? mov.is_intercompany);
  const u = umbralDe(mov);

  const banco = {
    codigo: BANCOS,
    cuando: 'Salió o entró por el banco: transferencia, depósito, cheque, Yape o Plin.',
  };
  const caja = {
    codigo: CAJA,
    cuando: prohibida
      ? `No se puede: una compra pagada de ${u.texto} o más está sujeta a bancarización (Ley 28194). Si se pagó en efectivo igual, hay que decirlo a mano.`
      : 'Se pagó o se cobró en efectivo, de la caja.',
    prohibida,
  };
  const compensacion = {
    codigo: esRelacionada ? POR_COBRAR_REL : POR_COBRAR,
    cuando: esRelacionada
      ? 'Se compensó contra una factura que nosotros le emitimos a esa empresa del grupo (no se movió plata).'
      : 'Se compensó contra una factura que nosotros le emitimos a ese tercero (no se movió plata).',
  };
  const porPagar = { codigo: POR_PAGAR, cuando: 'Queda a deber a un proveedor.' };
  const remun = { codigo: PLANILLA, cuando: 'Queda a deber al personal (planilla).' };
  const porCobrar = { codigo: POR_COBRAR, cuando: 'Se le facturó a un cliente y todavía no cobró.' };

  if (!pagado) {
    return compra ? [porPagar, remun, banco, caja] : [porCobrar, compensacion, banco];
  }
  if (!compra) {
    // Venta cobrada: acá la caja no se bloquea. El que pierde la deducción por
    // pagar en efectivo es el cliente; nuestro libro dice lo que entró.
    return [banco, caja, compensacion];
  }
  // Compra pagada: primero el banco, después la compensación, y la caja al
  // final (bloqueada si el monto la prohíbe).
  return prohibida ? [banco, compensacion, caja] : [banco, caja, compensacion];
}

/**
 * El aviso que corresponde cuando la contrapartida terminó siendo la CAJA en
 * una compra que estaba sujeta a bancarización. Devuelve null si no aplica.
 *
 * Es derivado —sale del monto y de la cuenta— así que no hay nada que guardar:
 * si mañana se corrige el importe o se carga la constancia, el aviso se va
 * solo. Ésa es la misma razón por la que el Libro Diario no se persiste.
 */
export function avisoEfectivoSobreUmbral(m, cuenta, ctx = {}) {
  if (!efectivoProhibido(m, ctx)) return null;
  const c = String(cuenta || '');
  if (c !== CAJA && !c.startsWith('101')) return null;
  const u = umbralDe(m);
  return `Pagado en efectivo por ${u.texto} o más: por el art. 8 de la Ley 28194 esta compra NO da derecho a crédito fiscal del IGV ni a deducir el gasto o el costo. Si en realidad salió del banco, corregí la contrapartida o cargá la constancia.`;
}

export default {
  CAJA, BANCOS, SIN_DEFINIR, POR_PAGAR, PLANILLA, POR_COBRAR, POR_COBRAR_REL,
  medioDePago, efectivoProhibido, umbralDe,
  resolverContrapartida, opcionesContrapartida, avisoEfectivoSobreUmbral,
};
