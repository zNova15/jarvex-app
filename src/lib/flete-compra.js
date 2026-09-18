// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL FLETE DE UNA COMPRA VA A LA 609 (tanda 2 del destino, 18-set-2026).
//
// ── LO QUE PIDIERON ───────────────────────────────────────────────
// El ejemplo que mandaron las contadoras empieza así:
//
//     Flete que trae la mercadería comprada:
//       Debe  60911 Transportes   ·  40111 IGV
//       Haber 4212 Emitidas
//
// Y `pcge-puente.js` mandaba TODO flete (S03, y las familias IUPC 32/33/92) a
// la 631 «Transporte, correos y gastos de viaje». Para un pasaje está bien.
// Para el camión que trae los tubos a la obra, no: la NIC 2 (párr. 11) dice
// que el costo de adquisición incluye «el transporte […] directamente
// atribuible», y el PCGE le da cuenta propia: la 609 «Costos vinculados con
// las compras», con una divisionaria de transporte por cada tipo de
// existencia (60911 mercaderías, 60921 materias primas, 60931 suministros,
// 60941 envases). Mandarlo a la 631 infla el gasto del mes y deja el
// material más barato de lo que costó.
//
// ── LO QUE MIDIÓ LA BASE (18-set) ─────────────────────────────────
// Los fletes casi nunca vienen en la MISMA factura que lo comprado: de 115
// comprobantes con flete, solo 3 lo traen junto con materiales (S/ 59). Los
// otros 112 son facturas del transportista, solas. Así que la regla no puede
// ser «si viene con la compra»; tiene que leer QUÉ se transportó. Y el texto
// lo dice seguido: «POR EL SERVICIO DE TRANSPORTE DE TUBO HOPE 100 SOR 11 PN
// DE CHICLAYO A CAJAMARCA» (11 facturas así). Lo que va después de
// «transporte de» se clasifica con el mismo motor de siempre y dice a qué
// existencia pertenece.
//
// ── TRES RESPUESTAS, NINGUNA INVENTADA ────────────────────────────
//  · PASAJE («al pasajero», «DNI:», «bus cama») → queda en la 631. Es un
//    viaje del personal, no un costo de lo comprado.
//  · CARGA QUE DICE QUÉ LLEVA, y eso es una compra (60x) → 609x1.
//  · LO DEMÁS («TRANSPORTE NACIONAL», «1 BULTO», «SERVICIO DE TRANSPORTE
//    INTERPROVINCIAL») → queda en la 631, pero con «revisar» y el porqué: no
//    dice si fue pasaje o carga, ni de qué. Adivinar la 609 ahí sería el
//    mismo error que se está arreglando, dado vuelta.
//
// Funciones puras. Testeadas en __tests__/flete-compra.test.js.
// ═══════════════════════════════════════════════════════════════════

import { cuentaDeFamilia } from './pcge-puente.js';

/** Las familias que son transporte: IUPC 32/33/92 (flete) y S03. */
export const FAMILIAS_FLETE = new Set(['32', '33', '92', 'S03']);

/** La cuenta a la que el puente manda todo flete. */
export const CUENTA_FLETE_GASTO = '631';

/**
 * Compra (60x) → su divisionaria de transporte en la 609.
 * Las cuatro que el PCGE define; la 603 incluye suministros y repuestos.
 */
export const TRANSPORTE_609 = {
  '601': '60911',   // mercaderías
  '602': '60921',   // materias primas — el material que se incorpora a la obra
  '603': '60931',   // materiales auxiliares, suministros y repuestos
  '604': '60941',   // envases y embalajes
};

/** Debajo de esto, el clasificador está adivinando qué se transportó. */
export const SCORE_MINIMO_MERCADERIA = 0.3;

// «viaje» NO entra: las guías de carga dicen «VIAJE REALIZADO EL 30/10/2024».
const RX_PASAJE = /(pasajer|\bdni\s*:|bus\s*cama|\basiento\b|\bboleto\b)/i;
const RX_CARGA = /(bulto|caja|paquete|paqueter|encomienda|mercanc|mercader|carga|seg[uú]n\s+gu[ií]a)/i;

/** La 609 que le corresponde a una cuenta de compra (601/602/…/6021…). */
export function transporteDeCompra(cuentaCompra) {
  const c = String(cuentaCompra ?? '').trim();
  return TRANSPORTE_609[c.slice(0, 3)] || null;
}

/** ¿Es esta línea un flete, por su familia? */
export const esFamiliaFlete = (familia) => FAMILIAS_FLETE.has(String(familia ?? '').trim());

/** ¿Es un pasaje de personal y no un flete? */
export const esPasaje = (descripcion) => RX_PASAJE.test(String(descripcion ?? ''));

/**
 * Lo que se transportó, sacado del texto del flete.
 *
 *   «POR EL SERVICIO DE TRANSPORTE DE TUBO HOPE 100 SOR 11 PN DE CHICLAYO A
 *    CAJAMARCA.»  →  «TUBO HOPE 100 SOR 11 PN»
 *
 * Corta la ruta («de X a Y», «desde X hasta Y») y el «según guía», que no
 * dicen nada de la mercadería. Devuelve null si el texto no nombra nada.
 */
export function mercaderiaDelFlete(descripcion) {
  const t = String(descripcion ?? '').replace(/\s+/g, ' ').trim();
  const m = t.match(/(?:transporte|traslado|flete)\s+(?:de|del)\s+(.+)$/i);
  if (!m) return null;
  let resto = m[1];
  // La ruta: «… DE CHICLAYO A CAJAMARCA», «… DESDE CAJAMARCA HASTA LIMA».
  resto = resto.replace(/\s+desde\s+.*$/i, '');
  resto = resto.replace(/\s+de\s+[a-záéíóúñ.\s-]+?\s+(?:a|hasta)\s+[a-záéíóúñ.,\s-]+\.?$/i, '');
  resto = resto.replace(/\s+seg[uú]n\s+.*$/i, '');
  resto = resto.replace(/[.,;\s]+$/, '').trim();
  if (!resto || resto.length < 3) return null;
  // «transporte de pasajeros», «de carga», «de mercancías en general»: eso es
  // el tipo de servicio, no la mercadería.
  if (/^(pasajer|carga|mercanc|mercader|la ruta|personal)/i.test(resto)) return null;
  return resto;
}

/**
 * La cuenta de un ítem de flete.
 *
 * @param {string} descripcion  el texto del ítem
 * @param {object} opts
 *   familiaDe        el resolvedor de `cuenta-de-comprobante.js`
 *   compraDelMismoComprobante  la cuenta 60x que más pesa entre los OTROS
 *                    ítems del mismo comprobante (null si no hay)
 * @returns {{cuenta:string, porque:string, revisar:boolean}}
 */
export function cuentaDeFlete(descripcion, { familiaDe = null, compraDelMismoComprobante = null } = {}) {
  if (esPasaje(descripcion)) {
    return {
      cuenta: CUENTA_FLETE_GASTO,
      porque: 'Es un pasaje del personal, no el flete de una compra: la 631 «Transporte, correos y gastos de viaje».',
      revisar: false,
    };
  }

  // 1) Viene en la misma factura que lo comprado.
  const conCompra = transporteDeCompra(compraDelMismoComprobante);
  if (conCompra) {
    return {
      cuenta: conCompra,
      porque: `El flete viene en la misma factura que la compra (${compraDelMismoComprobante}): es parte de lo que `
        + `costó ese material (NIC 2), y el PCGE lo lleva a la ${conCompra}, no a la 631.`,
      revisar: false,
    };
  }

  // 2) Dice qué transportó, y eso es una compra.
  const mercaderia = mercaderiaDelFlete(descripcion);
  if (mercaderia && typeof familiaDe === 'function') {
    const f = familiaDe(mercaderia);
    if (f?.familia && !esFamiliaFlete(f.familia) && (Number(f.score) || 0) >= SCORE_MINIMO_MERCADERIA) {
      const compra = cuentaDeFamilia(f.familia);
      const cuenta = transporteDeCompra(compra?.cuenta);
      if (cuenta) {
        return {
          cuenta,
          porque: `Transporta «${mercaderia}» (${compra.cuenta}): el flete de lo comprado es parte de su costo `
            + `(NIC 2) y va a la ${cuenta}. Si no fue una compra —un traslado entre obras, un envío propio—, cambiala a la 631.`,
          revisar: false,
        };
      }
    }
  }

  // 3) No dice lo suficiente. Se queda en la 631 y se avisa.
  const esCarga = RX_CARGA.test(String(descripcion ?? '')) || !!mercaderia;
  return {
    cuenta: CUENTA_FLETE_GASTO,
    porque: esCarga
      ? 'Es carga, pero no dice de qué. Si trajo una compra va a la 609 (60921 si eran materiales de obra, '
        + '60931 si eran suministros); si fue un envío propio, queda en la 631.'
      : 'El comprobante no dice si fue un pasaje o una carga. Si trajo material comprado, va a la 609 '
        + '(60921 para materiales de obra); si fue un viaje, queda en la 631.',
    revisar: true,
  };
}

export default {
  FAMILIAS_FLETE, CUENTA_FLETE_GASTO, TRANSPORTE_609, SCORE_MINIMO_MERCADERIA,
  transporteDeCompra, esFamiliaFlete, esPasaje, mercaderiaDelFlete, cuentaDeFlete,
};
