// ═══════════════════════════════════════════════════════════════════
// JARVEX — REGISTRO DE COMPRAS y REGISTRO DE VENTAS E INGRESOS.
//
// Tanda 4 de contabilidad (pedido de las contadoras, 17-set-2026). La app ya
// generaba los PLE 8.1 y 14.1 —los .txt con pipes que se le suben a SUNAT—
// pero la contadora no trabaja sobre eso: trabaja sobre el Excel de dos hojas
// que arma a mano todos los meses (`Modelos/ejemplrvrc.xlsx`, hojas
// «RCEjemplo» y «RVEjemplo»). Este archivo arma ESE Excel, con sus columnas
// en su orden, y lo llena con lo que ya está registrado.
//
// ── POR QUÉ NO ALCANZABA CON EL PLE ────────────────────────────────
// El .txt no se lee, no se revisa y no se cuadra: es un archivo de entrega. El
// registro es la hoja de trabajo —se mira, se cruza contra el SIRE, se corrige
// y se firma— y el formato importa porque es el que las contadoras ya saben
// leer. Pedirles que revisen 1.742 líneas de pipes era pedirles que no las
// revisen.
//
// ── LAS TRES COLUMNAS QUE SON CÓDIGO Y NO TEXTO ────────────────────
// «TIPO (TABLA 10)», «TIPO (TABLA 2)» y la de la dependencia aduanera
// (TABLA 11) salen de `tablas-sunat.js`, que es la misma fuente que usa el
// PLE. Así el Excel que revisa la contadora y el .txt que se declara no pueden
// decir cosas distintas del mismo comprobante.
//
// ── LA COLUMNA «CTA» ES EL PUENTE CON LAS TANDAS 1 A 3 ─────────────
// El Excel modelo tiene una columna CTA que la contadora llenaba a mano. Acá
// sale de la misma cuenta PCGE que muestra el Libro Diario: la que se dedujo
// de lo que se compró, o la que ella corrigió a mano. Es el trabajo de las
// tandas 1, 2 y 3 aterrizando en la hoja donde ella ya trabajaba.
//
// ── QUÉ SE MARCA Y POR QUÉ ─────────────────────────────────────────
// Cada fila puede traer `avisos`: cosas que la contadora tiene que ver antes
// de declarar. No se corrigen solas ni se esconden — un registro que se
// "arregla" en silencio es un registro en el que no se puede confiar.
// El marcador propio de los RECIBOS POR HONORARIOS (pedido de Gabriel) es uno
// de ellos: no llevan IGV, su base va a la columna de no gravadas, y llevan
// su retención de 4ta categoría, que no es una columna del registro sino algo
// que hay que declarar aparte.
// ═══════════════════════════════════════════════════════════════════

import { desglosarIgv } from './igv-desglose.js';
import { ymdDe } from './fecha.js';
import {
  tipoComprobante, tipoDocIdentidad, partirComprobante,
  nombreTabla10, esReciboHonorarios, usaDependenciaAduanera, esDependenciaAduaneraValida,
} from './tablas-sunat.js';

const r2 = (n) => {
  const v = Number(n);
  return isFinite(v) ? Math.round(v * 100) / 100 : 0;
};

/** Retención de 4ta categoría: 8 % sobre el honorario, y solo pasando S/ 1.500. */
export const RETENCION_4TA_PCT = 0.08;
export const RETENCION_4TA_MINIMO = 1500;

/** dd/mm/aaaa a partir de un 'YYYY-MM-DD' — por string, nunca con new Date(). */
export function fechaRegistro(fecha) {
  const ymd = ymdDe(fecha);
  if (!ymd) return '';
  const [a, m, d] = ymd.split('-');
  return `${d}/${m}/${a}`;
}

/** Clase canónica: `clase` manda, como en el resto de la app. */
const claseDe = (m) => m?.clase || (m?.type === 'income' ? 'venta' : 'compra');

/**
 * Los 4 campos del comprobante ORIGINAL que modifica una nota de crédito o de
 * débito: fecha, tipo (Tabla 10), serie y número.
 *
 * Se resuelve por `related_movement_id`, y el índice tiene que traer TODOS los
 * movimientos porque la factura original casi siempre es de un período
 * anterior. Si no se la encuentra, los 4 van vacíos y la fila lo avisa: SUNAT
 * observa las notas sin referencia, y una referencia inventada es peor.
 */
export function referenciaOriginal(m, movsById) {
  const tipo = tipoComprobante(m);
  if (tipo !== '07' && tipo !== '08') return { fecha: '', tipo: '', serie: '', numero: '', falta: false };
  const ref = (movsById instanceof Map && m?.related_movement_id) ? movsById.get(m.related_movement_id) : null;
  if (!ref) return { fecha: '', tipo: '', serie: '', numero: '', falta: true };
  const d = partirComprobante(ref.document_number || '');
  if (!d.serie && !d.numero) return { fecha: '', tipo: '', serie: '', numero: '', falta: true };
  return {
    fecha: fechaRegistro(ref.date || ref.created_at),
    tipo: tipoComprobante(ref, '01'),
    serie: d.serie,
    numero: d.numero,
    falta: false,
  };
}

/**
 * Lo común a las dos hojas: identificación del comprobante y del tercero, y
 * el desglose del importe.
 */
function comun(m, movsById) {
  // Fallback '00 Otros', NO '01 Factura'. El PLE usaba '01' para las compras
  // y eso es justo lo que no puede hacer un registro que alguien revisa: un
  // documento desconocido declarado como factura le inventa a SUNAT un
  // crédito fiscal. Acá sale como «00» y la fila lo dice.
  const tipo = tipoComprobante(m);
  const doc = partirComprobante(m.document_number || '');
  const docIdent = String(m.third_party_ruc || '');
  const dg = desglosarIgv(m);
  const avisos = [];

  // La columna D lleva la SERIE, salvo en una importación: ahí lleva el código
  // de 3 dígitos de la aduana (Tabla 11).
  const esImportacion = usaDependenciaAduanera(m);
  const serieOAduana = esImportacion ? String(m.dependencia_aduanera || '').trim() : doc.serie;
  if (esImportacion && serieOAduana && !esDependenciaAduaneraValida(serieOAduana)) {
    avisos.push('El código de la dependencia aduanera (Tabla 11) tiene que ser de 3 dígitos.');
  }

  if (!doc.serie && !doc.numero) avisos.push('El comprobante no tiene número: SUNAT lo observa.');
  if (tipo === '00') {
    avisos.push(`No se pudo determinar el tipo de comprobante (Tabla 10) de «${m.document_type || 'sin tipo'}». Va como «00 Otros».`);
  }
  if (!docIdent.replace(/\D/g, '')) {
    avisos.push('Falta el documento de identidad del tercero.');
  }

  const ref = referenciaOriginal(m, movsById);
  if (ref.falta) {
    avisos.push('Es una nota y no se encontró el comprobante original que modifica: SUNAT observa las notas sin referencia.');
  }

  return {
    movimiento_id: m.id,
    fechaEmision: fechaRegistro(m.date || m.created_at),
    tipo,
    tipoNombre: nombreTabla10(tipo),
    serie: serieOAduana,
    numero: doc.numero,
    tipoDocIdent: tipoDocIdentidad(docIdent),
    numeroDocIdent: docIdent.replace(/\s+/g, ''),
    razonSocial: String(m.third_party_name || '').trim(),
    moneda: String(m.currency || 'PEN').toUpperCase(),
    desglose: dg,
    referencia: ref,
    esNota: tipo === '07' || tipo === '08',
    avisos,
  };
}

/**
 * El tipo de cambio de la fila.
 *
 * Solo va en los comprobantes en otra moneda. Sale del movimiento si lo trae,
 * y si no, de la tasa que `tipo-cambio.js` tenga cacheada para ESE día. Si no
 * hay ninguna, queda vacío y la fila lo avisa: poner el 3,75 de referencia
 * sería declarar un número inventado. (La tarea automática que trae la tasa
 * SUNAT del día de la operación es una decisión de Gabriel y va en la tanda
 * de dólares.)
 */
function tipoCambioDe(m, tasaDe) {
  const moneda = String(m.currency || 'PEN').toUpperCase();
  if (moneda === 'PEN') return { valor: '', aviso: null };
  const propio = Number(m.tipo_cambio || 0);
  if (propio > 0) return { valor: propio, aviso: null };
  // Se le pasa la fecha Y el movimiento: la fecha es lo único que hace falta
  // para encontrar la tasa, pero una COMPRA se declara con la de venta y una
  // VENTA con la de compra, y eso solo se sabe mirando el comprobante.
  const buscada = typeof tasaDe === 'function'
    ? Number(tasaDe(ymdDe(m.date || m.created_at), m) || 0)
    : 0;
  if (buscada > 0) return { valor: buscada, aviso: null };
  return {
    valor: '',
    aviso: `El comprobante está en ${moneda} y no hay tipo de cambio para su fecha: hay que cargarlo antes de declarar.`,
  };
}

/**
 * Los MISMOS importes de la fila, convertidos a SOLES con el tipo de cambio de
 * la fila.
 *
 * ── POR QUÉ ESTO NO CONTRADICE «NUNCA SUMAR MONEDAS DISTINTAS» ────
 * La regla de la casa es no sumar soles con dólares CRUDOS para «poder
 * totalizar» — eso da un número que no es plata de nada (las 13 facturas de
 * KOPLAST). Acá no se suman crudos: se convierten con la tasa del día de la
 * operación, que es exactamente lo que manda el Registro de Compras (art. 10
 * del Reglamento del IGV: los importes se anotan en soles al tipo de cambio
 * publicado para la fecha de emisión). El total en soles es el DECLARABLE; el
 * de la moneda de origen queda como referencia de lo que dice el papel.
 *
 * Devuelve `null` cuando la fila está en otra moneda y NO hay tasa. Un cero
 * ahí sería una conversión inventada, y además haría que el total del mes
 * cerrara de menos sin decir por qué: la fila ya avisa que falta la tasa y el
 * resumen cuenta cuántas quedaron afuera.
 */
export function importesEnSoles(valores, moneda, tipoCambio) {
  const mon = String(moneda || 'PEN').toUpperCase();
  if (mon === 'PEN') return { ...valores, convertido: false, tasa: null };
  const tc = Number(tipoCambio) || 0;
  if (!(tc > 0)) return null;
  const out = {};
  for (const k of Object.keys(valores)) out[k] = r2(Number(valores[k] || 0) * tc);
  return { ...out, convertido: true, tasa: tc };
}

/**
 * Una fila del REGISTRO DE COMPRAS, en el orden de columnas del Excel modelo
 * (hoja RCEjemplo): correlativo · fecha · tipo · serie/aduana · número ·
 * tipo y número de doc. de identidad · razón social · detalle · CTA · base
 * imponible · IGV · no gravadas · importe total · no domiciliado · constancia
 * de detracción (número y fecha) · tipo de cambio · referencia del original ·
 * moneda.
 */
export function filaCompra(m, { correlativo, movsById, cuentaDe, tasaDe } = {}) {
  const c = comun(m, movsById);
  const dg = c.desglose;
  const tc = tipoCambioDe(m, tasaDe);
  if (tc.aviso) c.avisos.push(tc.aviso);

  // Base GRAVADA y lo que no paga IGV van a columnas distintas: sumarlas en la
  // base gravada declararía un crédito fiscal que el comprobante no da.
  const baseGravada = dg.baseGravada != null ? dg.baseGravada : dg.subtotal;
  const noGravado = r2(dg.subtotal - baseGravada);

  const honorarios = esReciboHonorarios(m);
  // Un recibo por honorarios no lleva IGV ni da crédito fiscal: su importe
  // entero es «adquisición no gravada». Si viniera con un IGV desglosado, es
  // el desglose el que está mal, y la fila lo dice en vez de declararlo.
  const base = honorarios ? 0 : baseGravada;
  const igv = honorarios ? 0 : dg.igv;
  const noGrav = honorarios ? r2(dg.total) : noGravado;
  if (honorarios && Math.abs(dg.igv) > 0.005) {
    c.avisos.push('Un recibo por honorarios no lleva IGV: se registra como adquisición no gravada y el IGV desglosado no se declara. Revisá el comprobante.');
  }

  const retencion = honorarios && Math.abs(dg.total) > RETENCION_4TA_MINIMO
    ? r2(Math.abs(dg.total) * RETENCION_4TA_PCT)
    : 0;

  const marcadores = [];
  if (honorarios) {
    marcadores.push({
      clave: 'recibo_honorarios',
      etiqueta: '02 Recibo por honorarios',
      detalle: retencion > 0
        ? `Renta de 4ta categoría. Corresponde retener el 8 % (S/ ${retencion.toFixed(2)}) salvo que el prestador tenga suspensión de retenciones vigente. No es una columna del registro: se declara en el PLAME.`
        : `Renta de 4ta categoría. Por debajo de S/ ${RETENCION_4TA_MINIMO} no corresponde retención.`,
    });
    // Un recibo por honorarios lo emite una persona natural. Si aparece como
    // VENTA nuestra, el comprobante está del lado equivocado del registro.
    if (claseDe(m) === 'venta') {
      c.avisos.push('Un recibo por honorarios lo emite una persona natural: una empresa no puede emitirlo. Si está como venta, la clase del comprobante está mal.');
    }
  }
  if (m.detraccion_aplica) {
    const nro = String(m.detraccion_constancia_numero || '').trim();
    marcadores.push({
      clave: 'detraccion',
      etiqueta: `Detracción ${m.detraccion_pct ? `${m.detraccion_pct}%` : ''}`.trim(),
      detalle: m.detraccion_estado === 'depositada' ? 'Constancia depositada.' : 'Falta depositar la detracción.',
    });
    if (!nro) c.avisos.push('Tiene detracción y falta el número de la constancia de depósito, que es una columna del registro.');
  }

  const importes = {
    baseImponible: r2(base),
    igv: r2(igv),
    noGravadas: r2(noGrav),
    importeTotal: r2(dg.total),
    retencion4ta: retencion,
  };

  return {
    correlativo,
    ...c,
    detalle: String(m.description || '').trim(),
    cta: typeof cuentaDe === 'function' ? (cuentaDe(m) || '') : '',
    ...importes,
    noDomiciliado: '',   // se llena solo con comprobantes de sujeto no domiciliado
    detraccionNumero: String(m.detraccion_constancia_numero || '').trim(),
    detraccionFecha: m.detraccion_constancia_fecha ? fechaRegistro(m.detraccion_constancia_fecha) : '',
    tipoCambio: tc.valor,
    // Los mismos importes en soles (la columna de tipo de cambio dejó de ser
    // decorativa: acá es la que convierte). `null` = está en otra moneda y no
    // hay tasa para su fecha.
    soles: importesEnSoles(importes, c.moneda, tc.valor),
    honorarios,
    retencion4ta: retencion,
    marcadores,
  };
}

/**
 * Una fila del REGISTRO DE VENTAS E INGRESOS (hoja RVEjemplo): correlativo ·
 * fecha · tipo · serie · número · tipo y número de doc. de identidad · razón
 * social · valor facturado de exportación · base imponible · IGV e IPM ·
 * importe total · tipo de cambio · referencia del original · moneda.
 */
export function filaVenta(m, { correlativo, movsById, cuentaDe, tasaDe } = {}) {
  const c = comun(m, movsById);
  const dg = c.desglose;
  const tc = tipoCambioDe(m, tasaDe);
  if (tc.aviso) c.avisos.push(tc.aviso);

  const baseGravada = dg.baseGravada != null ? dg.baseGravada : dg.subtotal;
  // La exportación no paga IGV y va en su propia columna. Hoy no hay ninguna
  // en producción; se reconoce por el destino contable si algún día lo hay.
  const esExportacion = String(m.destino_contable || '').toLowerCase().includes('exporta');

  const importes = {
    exportacion: esExportacion ? r2(dg.total) : 0,
    baseImponible: esExportacion ? 0 : r2(baseGravada),
    igv: esExportacion ? 0 : r2(dg.igv),
    importeTotal: r2(dg.total),
  };

  return {
    correlativo,
    ...c,
    detalle: String(m.description || '').trim(),
    cta: typeof cuentaDe === 'function' ? (cuentaDe(m) || '') : '',
    ...importes,
    tipoCambio: tc.valor,
    soles: importesEnSoles(importes, c.moneda, tc.valor),
    marcadores: esReciboHonorarios(m)
      ? [{ clave: 'recibo_honorarios', etiqueta: '02 Recibo por honorarios', detalle: 'Una empresa no emite recibos por honorarios: revisá la clase del comprobante.' }]
      : [],
  };
}

/**
 * Arma el registro completo de un período.
 *
 * @param {object} args
 *  · `movimientos`  los del período y la empresa (ya filtrados por la pantalla)
 *  · `movsById`     índice de TODOS los movimientos, para las referencias de
 *                   las notas, que apuntan a meses anteriores
 *  · `cuentaDe`     (mov) => cuenta PCGE — la misma del Libro Diario
 *  · `tasaDe`       (ymd) => tipo de cambio de ese día, si se tiene
 * @returns {{compras:{filas,totales}, ventas:{filas,totales}}}
 */
export function armarRegistro({ movimientos = [], movsById = null, cuentaDe = null, tasaDe = null } = {}) {
  const vivos = (movimientos || []).filter(m => m && !m.deleted_at && m.payment_status !== 'cancelled');
  // Orden del registro: por fecha y, a igual fecha, por número de comprobante.
  // El correlativo se asigna DESPUÉS de ordenar: es el número de la fila en la
  // hoja, y tiene que ser estable mes a mes.
  const orden = (a, b) => {
    const fa = ymdDe(a.date || a.created_at) || '';
    const fb = ymdDe(b.date || b.created_at) || '';
    if (fa !== fb) return fa < fb ? -1 : 1;
    return String(a.document_number || '').localeCompare(String(b.document_number || ''));
  };

  const opts = { movsById, cuentaDe, tasaDe };
  const compras = vivos.filter(m => claseDe(m) === 'compra').sort(orden)
    .map((m, i) => filaCompra(m, { ...opts, correlativo: i + 1 }));
  const ventas = vivos.filter(m => claseDe(m) === 'venta').sort(orden)
    .map((m, i) => filaVenta(m, { ...opts, correlativo: i + 1 }));

  return {
    compras: { filas: compras, totales: totalesCompras(compras) },
    ventas: { filas: ventas, totales: totalesVentas(ventas) },
  };
}

/**
 * Totales del registro, SEPARADOS POR MONEDA.
 *
 * Nunca en una sola bolsa: sumar soles con dólares para «poder totalizar» da
 * un número que no es plata de nada (la lección de las 13 facturas en dólares
 * de KOPLAST). Cada moneda tiene su fila de totales.
 */
export function totalesCompras(filas = []) {
  return totalesPorMoneda(filas, (t, f) => {
    t.baseImponible = r2(t.baseImponible + f.baseImponible);
    t.igv = r2(t.igv + f.igv);
    t.noGravadas = r2(t.noGravadas + f.noGravadas);
    t.importeTotal = r2(t.importeTotal + f.importeTotal);
    t.retencion4ta = r2(t.retencion4ta + (f.retencion4ta || 0));
  }, { baseImponible: 0, igv: 0, noGravadas: 0, importeTotal: 0, retencion4ta: 0 });
}

export function totalesVentas(filas = []) {
  return totalesPorMoneda(filas, (t, f) => {
    t.exportacion = r2(t.exportacion + (f.exportacion || 0));
    t.baseImponible = r2(t.baseImponible + f.baseImponible);
    t.igv = r2(t.igv + f.igv);
    t.importeTotal = r2(t.importeTotal + f.importeTotal);
  }, { exportacion: 0, baseImponible: 0, igv: 0, importeTotal: 0 });
}

/**
 * Los totales del período.
 *
 * Trae DOS cosas y no son intercambiables:
 *
 *  · `monedas` — una tarjeta por moneda, en la moneda del papel. Es lo que
 *    dice el comprobante y sirve para cotejarlo contra el PDF.
 *  · `soles`  — TODO el mes en soles: los comprobantes en soles tal cual y
 *    los que están en otra moneda convertidos al tipo de cambio de SU fecha.
 *    Éste es el que se declara (ver `importesEnSoles`), y por eso la pantalla
 *    lo muestra como el principal.
 *
 * `soles.sinTasa` cuenta los comprobantes que quedaron AFUERA por no tener
 * tipo de cambio. Sin ese número el total en soles cerraría de menos y nadie
 * sabría por qué: con él, la pantalla puede decir «faltan 2 tasas» en vez de
 * mostrar un total silenciosamente incompleto.
 */
function totalesPorMoneda(filas, acumular, inicial) {
  const porMoneda = new Map();
  const soles = { moneda: 'PEN', filas: 0, convertidos: 0, sinTasa: 0, ...inicial };
  let conAvisos = 0;
  for (const f of filas) {
    const k = f.moneda || 'PEN';
    if (!porMoneda.has(k)) porMoneda.set(k, { moneda: k, filas: 0, ...inicial });
    const t = porMoneda.get(k);
    t.filas += 1;
    acumular(t, f);
    if (f.avisos?.length) conAvisos += 1;
    // El mismo acumulador sobre la fila YA convertida: una sola definición de
    // qué se suma, así el total en soles no puede sumar cosas distintas que
    // el de la moneda de origen.
    if (f.soles) {
      soles.filas += 1;
      if (f.soles.convertido) soles.convertidos += 1;
      acumular(soles, f.soles);
    } else {
      soles.sinTasa += 1;
    }
  }
  return {
    filas: filas.length,
    conAvisos,
    soles,
    monedas: [...porMoneda.values()].sort((a, b) => (a.moneda === 'PEN' ? -1 : b.moneda === 'PEN' ? 1 : a.moneda.localeCompare(b.moneda))),
  };
}

// ─── El papel: las columnas del Excel modelo, con sus dos filas de título ───
//
// Se describen acá y no en la pantalla porque son las MISMAS para la tabla en
// pantalla, el Excel y el PDF. Tres listas de columnas en tres lugares es como
// se llega a un Excel que no coincide con lo que se vio.

export const COLUMNAS_COMPRAS = Object.freeze([
  { k: 'correlativo',      t: 'N° CORRELATIVO',            t2: 'DEL REGISTRO' },
  { k: 'fechaEmision',     t: 'FECHA DE EMISIÓN',          t2: 'DEL COMPROBANTE' },
  { k: 'tipo',             t: 'COMPROBANTE',               t2: 'TIPO (TABLA 10)' },
  { k: 'serie',            t: 'COMPROBANTE',               t2: 'SERIE / ADUANA (TABLA 11)' },
  { k: 'numero',           t: 'COMPROBANTE',               t2: 'N° DEL COMPROBANTE' },
  { k: 'tipoDocIdent',     t: 'PROVEEDOR',                 t2: 'TIPO (TABLA 2)' },
  { k: 'numeroDocIdent',   t: 'PROVEEDOR',                 t2: 'NÚMERO' },
  { k: 'razonSocial',      t: 'PROVEEDOR',                 t2: 'APELLIDOS Y NOMBRES O RAZÓN SOCIAL' },
  { k: 'detalle',          t: 'PROVEEDOR',                 t2: 'DETALLE' },
  { k: 'cta',              t: 'PROVEEDOR',                 t2: 'CTA' },
  { k: 'baseImponible',    t: 'ADQUISICIONES GRAVADAS',    t2: 'BASE IMPONIBLE', n: true },
  { k: 'igv',              t: 'ADQUISICIONES GRAVADAS',    t2: 'IGV', n: true },
  { k: 'noGravadas',       t: 'NO GRAVADAS',               t2: 'VALOR', n: true },
  { k: 'importeTotal',     t: 'IMPORTE TOTAL',             t2: '', n: true },
  { k: 'noDomiciliado',    t: 'NO DOMICILIADO',            t2: 'N° COMPROBANTE' },
  { k: 'detraccionNumero', t: 'CONSTANCIA DE DETRACCIÓN',  t2: 'NÚMERO' },
  { k: 'detraccionFecha',  t: 'CONSTANCIA DE DETRACCIÓN',  t2: 'FECHA DE EMISIÓN' },
  { k: 'tipoCambio',       t: 'TIPO DE CAMBIO',            t2: '' },
  { k: 'refFecha',         t: 'COMPROBANTE ORIGINAL QUE SE MODIFICA', t2: 'FECHA' },
  { k: 'refTipo',          t: 'COMPROBANTE ORIGINAL QUE SE MODIFICA', t2: 'TIPO' },
  { k: 'refSerie',         t: 'COMPROBANTE ORIGINAL QUE SE MODIFICA', t2: 'SERIE' },
  { k: 'refNumero',        t: 'COMPROBANTE ORIGINAL QUE SE MODIFICA', t2: 'N° DEL COMPROBANTE' },
  { k: 'moneda',           t: 'DÓLARES O SOLES',           t2: '' },
]);

export const COLUMNAS_VENTAS = Object.freeze([
  { k: 'correlativo',    t: 'N° CORRELATIVO',         t2: 'DEL REGISTRO' },
  { k: 'fechaEmision',   t: 'FECHA DE EMISIÓN',       t2: 'DEL COMPROBANTE' },
  { k: 'tipo',           t: 'COMPROBANTE',            t2: 'TIPO (TABLA 10)' },
  { k: 'serie',          t: 'COMPROBANTE',            t2: 'N° SERIE' },
  { k: 'numero',         t: 'COMPROBANTE',            t2: 'NÚMERO' },
  { k: 'tipoDocIdent',   t: 'CLIENTE',                t2: 'TIPO (TABLA 2)' },
  { k: 'numeroDocIdent', t: 'CLIENTE',                t2: 'NÚMERO' },
  { k: 'razonSocial',    t: 'CLIENTE',                t2: 'APELLIDOS Y NOMBRES O RAZÓN SOCIAL' },
  { k: 'detalle',        t: 'CLIENTE',                t2: 'DETALLE' },
  { k: 'cta',            t: 'CLIENTE',                t2: 'CTA' },
  { k: 'exportacion',    t: 'EXPORTACIÓN',            t2: 'VALOR FACTURADO', n: true },
  { k: 'baseImponible',  t: 'OPERACIÓN GRAVADA',      t2: 'BASE IMPONIBLE', n: true },
  { k: 'igv',            t: 'IGV Y/O IPM',            t2: '', n: true },
  { k: 'importeTotal',   t: 'IMPORTE TOTAL',          t2: '', n: true },
  { k: 'tipoCambio',     t: 'TIPO DE CAMBIO',         t2: '' },
  { k: 'refFecha',       t: 'COMPROBANTE ORIGINAL QUE SE MODIFICA', t2: 'FECHA' },
  { k: 'refTipo',        t: 'COMPROBANTE ORIGINAL QUE SE MODIFICA', t2: 'TIPO (TABLA 10)' },
  { k: 'refSerie',       t: 'COMPROBANTE ORIGINAL QUE SE MODIFICA', t2: 'SERIE' },
  { k: 'refNumero',      t: 'COMPROBANTE ORIGINAL QUE SE MODIFICA', t2: 'N° DEL COMPROBANTE' },
  { k: 'moneda',         t: 'DÓLARES O SOLES',        t2: '' },
]);

/** El valor de una celda: aplana la referencia, que en la fila viene anidada. */
export function celda(fila, k) {
  switch (k) {
    case 'refFecha':  return fila.referencia?.fecha || '';
    case 'refTipo':   return fila.referencia?.tipo || '';
    case 'refSerie':  return fila.referencia?.serie || '';
    case 'refNumero': return fila.referencia?.numero || '';
    default: {
      const v = fila[k];
      return v == null ? '' : v;
    }
  }
}

/** Matriz de valores lista para el Excel o el PDF (sin los títulos). */
export function matriz(filas = [], columnas = COLUMNAS_COMPRAS) {
  return filas.map(f => columnas.map(c => celda(f, c.k)));
}

export default {
  armarRegistro, filaCompra, filaVenta, referenciaOriginal, importesEnSoles,
  totalesCompras, totalesVentas, fechaRegistro,
  COLUMNAS_COMPRAS, COLUMNAS_VENTAS, celda, matriz,
  RETENCION_4TA_PCT, RETENCION_4TA_MINIMO,
};
