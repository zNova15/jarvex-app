// ═══════════════════════════════════════════════════════════════════
// JARVEX — LA PASADA DE TIPOS DE CAMBIO: una consulta por FECHA.
//
// Pedido de Gabriel (17-set-2026, tanda 7), textual: «para los comprobantes en
// dólares hay que darle una pasada y colocarle el tipo de cambio que aceptó
// SUNAT el día de la emisión. Y después la tasa SUNAT del día se consulta 1
// sola vez por fecha: si hay 6 facturas de las cuales 2 son del mismo día, en
// esa factura se solicita el cambio de SUNAT para dicha fecha y luego para la
// segunda solo se jala el dato que queda registrado».
//
// ── POR QUÉ IMPORTA CONTAR FECHAS Y NO COMPROBANTES ───────────────
// Medido en producción el 17-set: 42 comprobantes en USD sobre 23 FECHAS
// distintas. Pedir por comprobante serían 42 consultas para traer 23 datos. Y
// no es una cuestión de elegancia: la API gratuita de apis.net.pe devuelve 429
// al tercer pedido seguido desde la misma IP (medido). Con 42 pedidos no
// termina nunca; con 23 espaciados, sí. Y como cada fecha queda guardada en la
// base (mig 222), la segunda corrida no pide NADA.
//
// ── QUÉ HACE ESTA LIB Y QUÉ NO ────────────────────────────────────
// Acá está el PLAN: qué fechas faltan, qué comprobante depende de cada una,
// cuál es la tasa vigente de un día. Es todo puro y testeado. El que sale a
// internet y el que escribe en Dexie es `tipo-cambio-db.js`.
// ═══════════════════════════════════════════════════════════════════

import { ymdDe } from './fecha.js';

/** La moneda del movimiento, normalizada. 'PEN' es el default de la tabla. */
export function monedaDe(mov) {
  return String(mov?.currency || mov?.moneda || 'PEN').toUpperCase();
}

/** ¿Este comprobante necesita tipo de cambio? Solo lo que no está en soles. */
export function necesitaTipoCambio(mov) {
  if (!mov || mov.deleted_at) return false;
  if (mov.payment_status === 'cancelled') return false;
  if (monedaDe(mov) === 'PEN') return false;
  return !(Number(mov.tipo_cambio) > 0);
}

/**
 * La tasa vigente para una fecha, entre todas las filas guardadas.
 *
 * Puede haber más de una: las dos PCs de Gabriel pueden haber pedido el mismo
 * día (la mig 222 no pone UNIQUE a propósito, para no mandar un caso benigno a
 * conflictos manuales). Se resuelve al leer, con dos reglas:
 *   1. Una cargada A MANO le gana a la de la API. Si alguien la copió del
 *      portal de SUNAT es porque la de la API estaba mal o no estaba.
 *   2. A igual fuente, la más reciente.
 */
export function tasaVigente(tasas = [], fecha, moneda = 'USD') {
  const ymd = ymdDe(fecha);
  if (!ymd) return null;
  const mon = String(moneda || 'USD').toUpperCase();
  const candidatas = (tasas || []).filter(t =>
    t && !t.deleted_at
    && ymdDe(t.fecha) === ymd
    && String(t.moneda || 'USD').toUpperCase() === mon
    && Number(t.venta) > 0);
  if (!candidatas.length) return null;
  candidatas.sort((a, b) => {
    const manualA = a.fuente === 'manual' ? 1 : 0;
    const manualB = b.fuente === 'manual' ? 1 : 0;
    if (manualA !== manualB) return manualB - manualA;
    return String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''));
  });
  return candidatas[0];
}

/**
 * La tasa que le corresponde a un comprobante.
 *
 * Primero la suya propia (la que se le estampó al declararlo: queda congelada
 * a propósito), y si no tiene, la de su fecha. Para una COMPRA se usa la de
 * VENTA —es la que se paga— y para una venta, la de COMPRA; así lo hace la
 * contadora y así lo pide SUNAT.
 */
export function tasaDeComprobante(mov, tasas = []) {
  if (!mov) return null;
  if (monedaDe(mov) === 'PEN') return null;
  const propia = Number(mov.tipo_cambio);
  if (propia > 0) return { valor: propia, origen: 'comprobante', fuente: 'declarada' };
  const t = tasaVigente(tasas, mov.date || mov.created_at, monedaDe(mov));
  if (!t) return null;
  const esVenta = (mov.clase || (mov.type === 'income' ? 'venta' : 'compra')) === 'venta';
  const valor = esVenta ? (Number(t.compra) || Number(t.venta)) : Number(t.venta);
  return valor > 0 ? { valor, origen: 'fecha', fuente: t.fuente || 'sunat', tasa: t } : null;
}

/**
 * El PLAN de la pasada: una entrada por FECHA, con los comprobantes que
 * dependen de ella y si hay que salir a preguntar o ya está guardada.
 *
 * Ordenado de la fecha más vieja a la más nueva: si la corrida se corta por un
 * 429, lo que quedó hecho es un bloque contiguo y es fácil ver dónde se quedó.
 */
export function planDePasada(movs = [], tasas = []) {
  const porFecha = new Map();
  for (const m of movs || []) {
    if (!necesitaTipoCambio(m)) continue;
    const ymd = ymdDe(m.date || m.created_at);
    if (!ymd) continue;
    const moneda = monedaDe(m);
    const k = `${ymd}|${moneda}`;
    if (!porFecha.has(k)) {
      porFecha.set(k, { fecha: ymd, moneda, ids: [], tasa: tasaVigente(tasas, ymd, moneda) });
    }
    porFecha.get(k).ids.push(m.id);
  }
  const fechas = [...porFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
  return {
    fechas,
    // Cuántas veces hay que salir a internet: las fechas que NO están
    // guardadas. Es el número que se le muestra a la persona antes de empezar.
    consultas: fechas.filter(f => !f.tasa).length,
    // Cuántos comprobantes se van a estampar en total (los que ya tienen su
    // fecha guardada se estampan sin pedir nada).
    comprobantes: fechas.reduce((n, f) => n + f.ids.length, 0),
    guardadas: fechas.filter(f => !!f.tasa).length,
  };
}

/** Las fechas que hay que preguntarle a SUNAT, sin las que ya están. */
export function fechasQueFaltan(movs = [], tasas = []) {
  return planDePasada(movs, tasas).fechas.filter(f => !f.tasa);
}

/**
 * Valida una tasa cargada a mano.
 *
 * El rango es ancho a propósito (1 a 10 soles por dólar): no es la app la que
 * tiene que saber cuánto vale el dólar, pero sí frenar un dedazo de coma —un
 * 33,6 en vez de 3,36 multiplica la contabilidad por diez.
 */
export function validarTasaManual(valor) {
  const v = Number(String(valor ?? '').replace(',', '.'));
  if (!isFinite(v) || v <= 0) return { ok: false, error: 'El tipo de cambio tiene que ser un número mayor a 0.' };
  if (v < 1 || v > 10) return { ok: false, error: `${v} no parece un tipo de cambio de soles por dólar. Revisá la coma.` };
  return { ok: true, valor: Math.round(v * 10000) / 10000 };
}

export default {
  monedaDe, necesitaTipoCambio, tasaVigente, tasaDeComprobante,
  planDePasada, fechasQueFaltan, validarTasaManual,
};
