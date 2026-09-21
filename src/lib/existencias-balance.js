// ═══════════════════════════════════════════════════════════════════
// JARVEX — LAS EXISTENCIAS EN EL BALANCE (tanda 5 del destino, 21-set-2026).
//
// ── EL AGUJERO QUE DEJÓ LA TANDA 1 ────────────────────────────────
// `destino-asiento.js` ofrece mandar una compra a una existencia del elemento
// 2 (20/24/25/26) y escribe el «20111 / 6111» que pidieron las contadoras. Esa
// mitad quedó bien. La otra mitad no existía: NO HABÍA FORMA DE SACAR LA PLATA
// DE AHÍ.
//
// Y ése es el error caro. Una compra que entra al inventario y nunca se
// descarga queda en el Balance para siempre: el activo crece sin techo, el
// costo nunca llega al Estado de Resultados y la empresa paga renta sobre una
// utilidad que no tuvo. La tanda 1 ya avisaba del error contrario —mandar al
// inventario lo que ya se consumió— y era el mismo aviso a medio camino: decía
// «cuidado con entrar» sin tener puerta de salida.
//
// ── EL SEGUNDO ASIENTO ES EL ESPEJO DEL PRIMERO ───────────────────
// Toda la contabilidad de esta tanda son estas dos cadenas. Con una compra de
// materiales de S/ X que entra al almacén y después se consume en la obra:
//
//     Compra     601 / 602 …  D X        (naturaleza: QUÉ se compró)
//     Destino    24…          D X
//                612          H X        (entra al Balance)
//     Salida     612          D X
//                24…          H X        (sale del Balance)
//                92           D X
//                791          H X        (y recién ahí es costo de obra)
//
// La 61 entra por el haber y sale por el debe: se cancela sola, y lo que queda
// en el resultado es la 601 más el traslado a función. O sea, exactamente lo
// mismo que si la compra se hubiera consumido el día de la factura — con la
// diferencia de que el costo cae en el período en que se USÓ, que es de lo que
// se trata todo esto.
//
// Si en vez de consumirse se VENDE, el PCGE tiene cuenta propia y el camino es
// más corto (p. 189, 691 Mercaderías):
//
//     Salida     691          D X
//                20…          H X
//
// Y también cuadra por sí solo: la 601 quedó contra la 611 del destino, y el
// costo aparece una sola vez, en la 69, que ya es una cuenta por función y no
// se traslada por la 79.
//
// ── LA MISMA REGLA DE LA TANDA 1: SE ELIGE UNA CUENTA ─────────────
// La contadora elige a dónde FUE (92, 94, 691…) y las otras tres patas salen
// solas. No se le pide escribir la 612 ni la 791: son consecuencia, no
// decisión. Es la misma promesa del «20111 / 6111» y se cumple con el mismo
// mecanismo — `contrapartidaDeDestino` se reusa tal cual.
//
// ── LA FECHA DE SALIDA NO ES LA DE LA FACTURA ─────────────────────
// 🔴 Es el punto del que cuelga la utilidad de la tanda. Una bolsa de cemento
// comprada en mayo y usada en agosto genera un costo de AGOSTO. Por eso la
// salida tiene fecha propia y el asiento que produce es OTRO asiento, con su
// propia fecha, y no dos líneas más pegadas al de la compra. Meterlas en el
// asiento de mayo pondría el costo de agosto en mayo y el Estado de Resultados
// de los dos meses quedaría mal — que es justo lo que esta tanda viene a
// arreglar.
//
// ── POR QUÉ NO SE PROPONE SOLO, Y ESTÁ MEDIDO ─────────────────────
// La pregunta obvia es por qué la app no deduce sola qué sigue en el almacén,
// si JARVEX TIENE almacén. Se fue a mirar (21-set-2026, producción):
//
//   · 689 entradas de almacén y solo 21 con `accounting_movement_id`: el 3 %.
//     `recepcion_movimiento_id` está en NULL en los 687 comprobantes de gasto.
//     O sea que para el 97 % de las compras no hay forma de saber qué entrada
//     de almacén les corresponde.
//   · 190 de 346 materiales tienen saldo, pero 182 de esos 190 no tienen
//     ningún precio cargado. Todo el stock que la app puede valorizar suma
//     S/ 4.577,73 — no es el inventario de la empresa, es una muestra.
//   · El almacén es de UNA obra (`materiales.obra_id`, sin `company_id`) y la
//     contabilidad de esta tanda es POR EMPRESA.
//
// Con eso, deducir la existencia sería inventarla: el mismo callejón del
// diesel de la tanda 1 y la misma respuesta de la regla 8 del CLAUDE.md. Así
// que acá NO SE SUGIERE NADA. Lo que se hace es lo contrario y es lo que
// faltaba: CONTAR EN VOZ ALTA LO QUE QUEDÓ PARADO —cuánto, desde cuándo y en
// qué cuenta— para que la pila sea visible y se pueda trabajar. Una existencia
// sin descargar es una pregunta pendiente, no un saldo.
//
// Funciones puras, sin Dexie ni React. Testeadas en
// __tests__/existencias-balance.test.js.
// ═══════════════════════════════════════════════════════════════════

import { cuenta as cuentaPcge } from './pcge.js';
import { ESPEJO_61, contrapartidaDeDestino } from './destino-asiento.js';
import { ELEMENTO_9, esCuentaElemento9, cuenta9 } from './pcge-elemento9.js';
import { periodoCerrado, CERRADO_HASTA_DEFAULT } from './periodo-contable.js';

const r2 = (n) => {
  const v = Number(n);
  if (!isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
};

/** Los dos primeros dígitos: el nivel al que la 61 y la 69 tienen espejo. */
const madre = (codigo) => String(codigo ?? '').trim().slice(0, 2);

/**
 * La existencia que se puede VENDER tal cual, con su cuenta de costo de ventas.
 *
 * Solo la 20. El PCGE define la 691 como «Mercaderías» y mercadería es, por
 * definición (p. 155), «lo adquirido para ser vendido sin someterlo a
 * transformación». Una materia prima que se vende sin transformar no era
 * materia prima: estaba mal clasificada desde la compra, y lo que hay que
 * corregir es eso y no inventarle una 692 —que es de productos TERMINADOS, o
 * sea fabricados por la empresa—. Por eso la venta no se ofrece para 24/25/26.
 */
export const ESPEJO_69 = { 20: '691' };

/** ¿Este destino deja la plata en el Balance? */
export function esDestinoExistencia(codigo) {
  const c = String(codigo ?? '').trim();
  if (!c || c[0] !== '2') return false;
  return !!ESPEJO_61[madre(c)];
}

/** La existencia madre de un destino (20, 24, 25, 26), o null. */
export function existenciaMadre(codigo) {
  return esDestinoExistencia(codigo) ? madre(codigo) : null;
}

/**
 * A dónde puede salir lo que está parado en esta existencia.
 *
 * Primero «se consumió» (las siete del elemento 9, las en uso arriba) y
 * después, solo para la 20, «se vendió» → 691. El orden es el de la pregunta
 * que la contadora se hace: casi todo lo que hay en el almacén de una
 * constructora se consume.
 */
export function opcionesSalida(destino) {
  if (!esDestinoExistencia(destino)) return [];
  const out = ELEMENTO_9
    .slice()
    .sort((a, b) => (b.enUso === true) - (a.enUso === true))
    .map(c => ({
      codigo: c.codigo,
      nombre: c.nombre,
      porque: c.porque,
      grupo: 'Se consumió',
    }));

  const venta = ESPEJO_69[existenciaMadre(destino)];
  if (venta) {
    out.push({
      codigo: venta,
      nombre: cuentaPcge(venta)?.nombre || 'Mercaderías',
      grupo: 'Se vendió',
      porque: 'Se vendió tal cual se compró: el costo va a la 691 Costo de ventas, que ya es una '
        + 'cuenta por función y no se traslada por la 79.',
    });
  }
  return out;
}

/** ¿La cuenta elegida sirve como salida de esta existencia? */
export function validarSalidaCuenta(codigo, destino) {
  const c = String(codigo ?? '').trim();
  if (!c) return { ok: true, codigo: null };
  if (!/^[0-9]{2,5}$/.test(c)) {
    return { ok: false, error: 'Una cuenta del PCGE son de 2 a 5 dígitos (92, 691).' };
  }
  if (c[0] === '9') {
    if (!esCuentaElemento9(c)) {
      return { ok: false, error: `La cuenta ${c} no es una de las siete del elemento 9 que usa la empresa.` };
    }
    return { ok: true, codigo: c, nombre: cuenta9(c)?.nombre || '' };
  }
  if (madre(c) === '69') {
    const esperada = ESPEJO_69[existenciaMadre(destino)];
    if (!esperada) {
      return {
        ok: false,
        error: 'El costo de ventas (69) solo sale de la 20 Mercaderías. Si esto se vendió tal cual '
          + 'se compró, no era materia prima ni suministro: corregí el destino de la compra.',
      };
    }
    if (c !== esperada) {
      return { ok: false, error: `Para la ${existenciaMadre(destino)} el costo de ventas es la ${esperada}.` };
    }
    return { ok: true, codigo: c, nombre: cuentaPcge(c)?.nombre || '' };
  }
  return {
    ok: false,
    error: 'Lo que sale del inventario va a una cuenta por función (elemento 9) si se consumió, '
      + 'o a la 691 Costo de ventas si se vendió.',
  };
}

/**
 * ¿Se puede guardar esta salida? Es el espejo EXACTO del CHECK de la mig 224.
 *
 * 🔴 Tiene que serlo. Si acá pasa algo que el CHECK rechaza, la fila se guarda
 * en Dexie, rebota en el push con 23514 y el sync queda en reintento eterno —
 * es literalmente la regla 9 del CLAUDE.md, escrita después de que pasara con
 * `insumo_categoria`. Hay un test que recorre las dos condiciones juntas.
 *
 * @param {object} salida   { cuenta, fecha, importe }
 * @param {object} ctx      { destino, entro } — el destino guardado y cuánto entró
 */
export function validarSalida(salida = {}, { destino = '', entro = null } = {}) {
  const cuenta = String(salida.cuenta ?? '').trim();
  const fecha = String(salida.fecha ?? '').slice(0, 10);
  const importeCrudo = salida.importe;
  const vacia = !cuenta && !fecha
    && (importeCrudo === null || importeCrudo === undefined || importeCrudo === '');

  // Borrar la salida entera es legítimo: es «todavía está en el almacén».
  if (vacia) return { ok: true, salida: { cuenta: null, fecha: null, importe: null } };

  if (!esDestinoExistencia(destino)) {
    return {
      ok: false,
      error: 'Solo se descarga lo que está en una existencia (20, 24, 25, 26). Este comprobante no '
        + 'tiene destino de inventario.',
    };
  }
  const v = validarSalidaCuenta(cuenta, destino);
  if (!v.ok) return v;
  if (!v.codigo) return { ok: false, error: 'Falta decir a dónde fue lo que salió del inventario.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return { ok: false, error: 'Falta la fecha en que salió del almacén (es la que decide de qué mes es el costo).' };
  }
  const importe = Number(importeCrudo);
  if (!isFinite(importe) || importe <= 0) {
    return { ok: false, error: 'El importe que salió tiene que ser mayor que cero.' };
  }
  const tope = Number(entro);
  if (isFinite(tope) && tope > 0 && r2(importe) > r2(tope) + 0.01) {
    return { ok: false, error: `No puede salir más de lo que entró: entraron S/ ${r2(tope).toFixed(2)}.` };
  }
  return { ok: true, salida: { cuenta: v.codigo, fecha, importe: r2(importe) } };
}

/**
 * Las patas del asiento de salida. La contadora eligió UNA y acá salen todas.
 *
 * @param {object} args
 *   destino       la existencia donde está parado (20111, 24…)
 *   cuentaSalida  a dónde va (92, 94, 691…)
 *   importe       cuánto sale
 *   cuentaOrigen  la cuenta por naturaleza de la compra (601, 602…), para la
 *                 regla 68 → 78 que hereda de `contrapartidaDeDestino`
 * @returns {{patas:Array<{cuenta,debe,haber}>, porque:string, venta:boolean}|null}
 */
export function patasDeSalida({ destino, cuentaSalida, importe, cuentaOrigen = '' } = {}) {
  const monto = r2(importe);
  if (!esDestinoExistencia(destino) || monto <= 0) return null;
  const salida = String(cuentaSalida ?? '').trim();
  if (!validarSalidaCuenta(salida, destino).ok || !salida) return null;

  const existencia = String(destino).trim();

  // ── SE VENDIÓ: el camino corto del PCGE ──
  // La 601 de la compra ya quedó cancelada contra la 611 del destino, así que
  // el costo tiene que aparecer una sola vez y por función: la 69. No lleva
  // 79 — la 79 traslada gastos por naturaleza del elemento 6, y la 69 ya es
  // una cuenta de resultado por función.
  if (madre(salida) === '69') {
    return {
      venta: true,
      patas: [
        { cuenta: salida, debe: monto, haber: 0 },
        { cuenta: existencia, debe: 0, haber: monto },
      ],
      porque: 'Se vendió tal cual se compró: sale del inventario contra la 691 Costo de ventas. '
        + 'No lleva asiento de destino porque la 69 ya dice para qué fue.',
    };
  }

  // ── SE CONSUMIÓ: el espejo exacto del asiento de entrada ──
  const espejo = ESPEJO_61[existenciaMadre(existencia)];
  const contra = contrapartidaDeDestino(salida, cuentaOrigen);
  if (!espejo || !contra.cuenta) return null;
  return {
    venta: false,
    patas: [
      { cuenta: espejo, debe: monto, haber: 0 },
      { cuenta: existencia, debe: 0, haber: monto },
      { cuenta: salida, debe: monto, haber: 0 },
      { cuenta: contra.cuenta, debe: 0, haber: monto },
    ],
    porque: `Sale del inventario por la ${espejo} (la misma subcuenta de la 61 por la que entró, `
      + `que así se cancela sola) y recién ahí se carga a la ${salida}. ${contra.porque}`,
  };
}

/**
 * Cuánto de este comprobante está parado en el Balance.
 *
 * `entro` no se guarda: es la base del asiento de destino, o sea lo que el
 * generador ya calculó. Se le pasa; acá solo se resta.
 *
 * @returns {{cuenta, entro, salio, queda, descargada, parcial}|null}
 *          null cuando el destino no es una existencia.
 */
export function saldoDeExistencia(movimiento, { entro = 0 } = {}) {
  const m = movimiento || {};
  const destino = String(m.cuenta_pcge_destino || '').trim();
  if (!esDestinoExistencia(destino)) return null;
  const e = r2(entro);
  const salio = m.existencia_salida_cuenta ? r2(m.existencia_salida_importe) : 0;
  const queda = r2(e - salio);
  return {
    cuenta: destino,
    entro: e,
    salio,
    queda: queda > 0 ? queda : 0,
    descargada: salio > 0 && queda <= 0.01,
    parcial: salio > 0 && queda > 0.01,
  };
}

/** Días entre dos 'YYYY-MM-DD'. Sin `new Date(ymd)`: en Perú da el día anterior. */
export function diasEntre(desde, hasta) {
  const a = String(desde ?? '').slice(0, 10);
  const b = String(hasta ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const ms = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))
    - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  return Math.round(ms / 86400000);
}

/**
 * El costo que quedó atrapado en el Balance, con su antigüedad.
 *
 * Devuelve null cuando no hay nada que decir: sin destino de existencia, o ya
 * descargada del todo. El texto cambia cuando la compra es de un período ya
 * presentado: ahí deja de ser «inventario normal» y pasa a ser renta que
 * quizá se pagó de más.
 */
export function costoAtrapado(movimiento, {
  entro = 0, hoy = '', cerradoHasta = CERRADO_HASTA_DEFAULT,
} = {}) {
  const saldo = saldoDeExistencia(movimiento, { entro });
  if (!saldo || saldo.queda <= 0.01) return null;
  const m = movimiento || {};
  const fecha = String(m.date || m.fecha || '').slice(0, 10);
  const dias = diasEntre(fecha, hoy);
  const cruzoCierre = periodoCerrado(fecha, cerradoHasta);
  return {
    cuenta: saldo.cuenta,
    importe: saldo.queda,
    dias,
    cruzoCierre,
    parcial: saldo.parcial,
    aviso: cruzoCierre
      ? `S/ ${saldo.queda.toFixed(2)} siguen en la cuenta ${saldo.cuenta} y la compra es del `
        + `${fecha}, dentro de un período ya presentado. Si en realidad ya se consumió, ese costo `
        + 'nunca bajó ningún resultado y la empresa pagó renta de más. Descargalo con la fecha en '
        + 'que salió del almacén.'
      : `S/ ${saldo.queda.toFixed(2)} siguen en la cuenta ${saldo.cuenta}`
        + (dias === null ? '' : ` desde hace ${dias} día(s)`)
        + '. Mientras estén ahí no son costo de ningún período: descargalos el día que salgan '
        + 'del almacén.',
  };
}

/**
 * El panel: qué hay parado en el Balance, por cuenta.
 *
 * Toma pares `{ movimiento, entro }` porque `entro` lo calcula el generador
 * del asiento (es la base sin IGV, después del reparto) y esta lib no sabe
 * —ni tiene que saber— cómo se arma un asiento.
 */
export function resumenExistencias(filas = [], {
  hoy = '', cerradoHasta = CERRADO_HASTA_DEFAULT,
} = {}) {
  const porCuenta = new Map();
  let totalQueda = 0;
  let totalEntro = 0;
  let totalSalio = 0;
  const atrapadas = [];

  for (const f of (filas || [])) {
    const saldo = saldoDeExistencia(f?.movimiento, { entro: f?.entro });
    if (!saldo) continue;
    const madreCuenta = existenciaMadre(saldo.cuenta);
    if (!porCuenta.has(madreCuenta)) {
      porCuenta.set(madreCuenta, {
        cuenta: madreCuenta,
        nombre: cuentaPcge(madreCuenta)?.nombre || '',
        entro: 0, salio: 0, queda: 0, comprobantes: 0, sinDescargar: 0,
      });
    }
    const g = porCuenta.get(madreCuenta);
    g.entro = r2(g.entro + saldo.entro);
    g.salio = r2(g.salio + saldo.salio);
    g.queda = r2(g.queda + saldo.queda);
    g.comprobantes++;
    totalEntro = r2(totalEntro + saldo.entro);
    totalSalio = r2(totalSalio + saldo.salio);
    totalQueda = r2(totalQueda + saldo.queda);

    if (saldo.queda > 0.01) {
      g.sinDescargar++;
      const at = costoAtrapado(f.movimiento, { entro: f.entro, hoy, cerradoHasta });
      if (at) atrapadas.push({ movimiento: f.movimiento, ...at });
    }
  }

  // Lo más viejo primero: es lo que hay que resolver antes de cerrar el mes.
  atrapadas.sort((a, b) => (b.dias ?? 0) - (a.dias ?? 0));

  return {
    porCuenta: [...porCuenta.values()].sort((a, b) => b.queda - a.queda),
    totalEntro,
    totalSalio,
    totalQueda,
    atrapadas,
    cruzaronCierre: atrapadas.filter(a => a.cruzoCierre).length,
  };
}

/**
 * ¿Hay que borrar la salida porque el destino dejó de ser una existencia?
 *
 * 🔴 Es el guardián del CHECK de la mig 224 (ver su encabezado). Lo llama
 * `fijarCuentaManual` en la MISMA escritura que cambia el destino: si se
 * hicieran en dos, entre una y otra la fila viola el CHECK y el push rebota
 * con 23514 para siempre (regla 9 del CLAUDE.md).
 */
export function salidaQuedaHuerfana(destinoNuevo, movimiento) {
  const m = movimiento || {};
  if (!m.existencia_salida_cuenta) return false;
  return !esDestinoExistencia(destinoNuevo);
}

/** Lo que hay que escribir para borrar una salida. Un solo lugar. */
export const SALIDA_VACIA = Object.freeze({
  existencia_salida_cuenta: null,
  existencia_salida_fecha: null,
  existencia_salida_importe: null,
  existencia_salida_por: null,
  existencia_salida_at: null,
});

/** El nombre de una cuenta de salida, sea del elemento 9 o del PCGE. */
export function nombreSalida(codigo) {
  const c = String(codigo ?? '').trim();
  if (!c) return '';
  if (c[0] === '9') return cuenta9(c)?.nombre || '';
  return cuentaPcge(c)?.nombre || '';
}

export default {
  ESPEJO_69,
  SALIDA_VACIA,
  esDestinoExistencia,
  existenciaMadre,
  opcionesSalida,
  validarSalidaCuenta,
  validarSalida,
  patasDeSalida,
  saldoDeExistencia,
  diasEntre,
  costoAtrapado,
  resumenExistencias,
  salidaQuedaHuerfana,
  nombreSalida,
};
