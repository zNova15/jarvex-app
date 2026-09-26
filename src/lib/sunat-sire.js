// ─────────────────────────────────────────────────────────────
// SUNAT SIRE — Reemplazo de Propuesta RVIE (140400) y RCE (080400)
//
// Desde 2025 el Registro de Ventas y el de Compras se presentan SOLO por el
// SIRE (los .txt del PLE 8.1 y 14.1 ya no se aceptan). Este archivo arma el
// .txt con el que se REEMPLAZA la propuesta de SUNAT: un .zip con un .txt
// UTF-8, campos separados por `|` y cada línea terminada en `|`.
//
// ── LA ESTRUCTURA SALE DE LA NORMA, NO DE LA MEMORIA (tanda F, 26-set-2026) ─
// Hasta la tanda F el generador tenía las columnas escritas a mano y estaban
// corridas: el RVIE no tenía la columna IVAP y desde la 23 todo caía una
// posición a la derecha (el total en «Otros Tributos», la moneda en «Total
// CP»); el RCE ponía la fecha de la detracción donde va «Clasif. de Bss y
// Sss». Los tests solo contaban columnas y por eso nadie lo vio.
//
// Ahora las columnas son las del ANEXO de la R.S. 112-2021 (mod. R.S.
// 040-2022), leídas de los PDF de SUNAT, y sus NOMBRES son los mismos del
// encabezado del archivo que SUNAT deja bajar y que `sunat-csv.js` ya lee:
//   · RVIE — Anexo 3: campos 1 a 33. Del 34 al 40 los completa SUNAT.
//   · RCE  — Anexo 11: campos 1 a 37, más el 38 al 41 VACÍOS. La norma dice
//     que también los completa SUNAT, pero desde dic-2024 el validador
//     rechaza la fila sin esos cuatro palotes (error 453 «Fila no cumple con
//     estructura»; la solución que circula es justo agregar `||||`).
//   · Los campos de libre utilización (CLU) no se escriben: la norma dice
//     «no incluya ni la información ni los palotes».
// Si SUNAT vuelve a mover algo, se toca `CAMPOS_RVIE` / `CAMPOS_RCE` y el
// test posicional contra el encabezado real dice qué se corrió.
//
// ── LOS IMPORTES VAN EN SOLES (regla 11 del CLAUDE.md) ────────────
// El campo Moneda dice la moneda del comprobante y el Tipo de Cambio la tasa
// con la que se convirtió, pero los importes van en SOLES: es lo que manda el
// Anexo («se consignará el tipo de cambio utilizado para la conversión a
// soles en caso lleve su contabilidad en soles») y es lo que trae la propia
// propuesta (KOPLAST F003-3384: 279.600,00 | USD | 3,495). Antes salía
// `80000.00|USD|3.495`: una factura de dólares declarada por un tercio.
// Un comprobante en otra moneda SIN tasa no se escribe: sale en `omitidos`
// y la pantalla no deja generar el archivo hasta que se cargue.
//
// Nomenclatura del archivo (.zip y .txt interno), 33 caracteres:
//   LE<RUC><AAAAMM><00><LIBRO><OPORT><IND_OPER><IND_CONT><IND_MON><IND_GEN>
//   ej. LE2061534608120260700140400021112.zip
// ─────────────────────────────────────────────────────────────

import JSZip from 'jszip';
import { desglosarIgv } from './igv-desglose.js';
import { fmtFechaLarga } from './fecha.js';
import { llaveDeMovimiento, llaveDeFilaSunat } from './comparativa-sunat.js';
import { notaSinEfecto } from './notas-credito.js';
import { esVentaMov } from './costo-obra.js';
import { declaraEnPeriodo, periodoDeEmision } from './periodo-declaracion.js';
import { tipoComprobante, tipoDocIdentidad, partirComprobante, esReciboHonorarios } from './tablas-sunat.js';

export const LIBRO_RVIE_REEMPLAZO = '140400';
export const LIBRO_RCE_REEMPLAZO  = '080400';

/**
 * Las columnas del reemplazo, con el nombre EXACTO del encabezado del archivo
 * de SUNAT (el mismo que lee `sunat-csv.js`). El orden es el del Anexo.
 */
export const CAMPOS_RVIE = Object.freeze([
  'Ruc', 'Razon Social', 'Periodo', 'CAR SUNAT', 'Fecha de emisión', 'Fecha Vcto/Pago',
  'Tipo CP/Doc.', 'Serie del CDP', 'Nro CP o Doc. Nro Inicial (Rango)', 'Nro Final (Rango)',
  'Tipo Doc Identidad', 'Nro Doc Identidad', 'Apellidos Nombres/ Razón Social',
  'Valor Facturado Exportación', 'BI Gravada', 'Dscto BI', 'IGV / IPM', 'Dscto IGV / IPM',
  'Mto Exonerado', 'Mto Inafecto', 'ISC', 'BI Grav IVAP', 'IVAP', 'ICBPER', 'Otros Tributos',
  'Total CP', 'Moneda', 'Tipo Cambio', 'Fecha Emisión Doc Modificado', 'Tipo CP Modificado',
  'Serie CP Modificado', 'Nro CP Modificado', 'ID Proyecto Operadores Atribución',
]);

export const CAMPOS_RCE = Object.freeze([
  'RUC', 'Apellidos y Nombres o Razón social', 'Periodo', 'CAR SUNAT', 'Fecha de emisión',
  'Fecha Vcto/Pago', 'Tipo CP/Doc.', 'Serie del CDP', 'Año', 'Nro CP o Doc. Nro Inicial (Rango)',
  'Nro Final (Rango)', 'Tipo Doc Identidad', 'Nro Doc Identidad', 'Apellidos Nombres/ Razón  Social',
  'BI Gravado DG', 'IGV / IPM DG', 'BI Gravado DGNG', 'IGV / IPM DGNG', 'BI Gravado DNG',
  'IGV / IPM DNG', 'Valor Adq. NG', 'ISC', 'ICBPER', 'Otros Trib/ Cargos', 'Total CP', 'Moneda',
  'Tipo de Cambio', 'Fecha Emisión Doc Modificado', 'Tipo CP Modificado', 'Serie CP Modificado',
  'COD. DAM O DSI', 'Nro CP Modificado', 'Clasif de Bss y Sss', 'ID Proyecto Operadores',
  'PorcPart', 'IMB', 'CAR Orig/ Ind E o I',
  // 38 a 41: los completa SUNAT, pero el validador exige los palotes (error 453).
  'Detracción', 'Tipo de Nota', 'Est. Comp.', 'Incal',
]);

// ─── Helpers de formato ──────────────────────────────────────
function pad2(n)  { return String(n || 0).padStart(2, '0'); }
function pad11(s) { return String(s || '').padStart(11, '0'); }

function clean(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[\|\r\n\t]/g, ' ').trim();
}

function num(n, dec = 2) {
  const v = Number(n);
  if (!isFinite(v)) return (0).toFixed(dec);
  return v.toFixed(dec);
}

function r2(n) {
  const v = Number(n);
  if (!isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function fmtFechaSunat(d) {
  if (!d) return '';
  return fmtFechaLarga(d) || '';
}

export function normalizarPeriodo(periodo) {
  if (!periodo) {
    const d = new Date();
    return { anio: d.getFullYear(), mes: d.getMonth() + 1, cod: `${d.getFullYear()}${pad2(d.getMonth() + 1)}` };
  }
  if (typeof periodo === 'string') {
    const limpia = periodo.replace(/\D/g, '');
    if (limpia.length >= 6) {
      const anio = Number(limpia.slice(0, 4));
      const mes  = Number(limpia.slice(4, 6));
      return { anio, mes, cod: `${anio}${pad2(mes)}` };
    }
  }
  const anio = Number(periodo.anio || new Date().getFullYear());
  const mes  = Number(periodo.mes  || new Date().getMonth() + 1);
  return { anio, mes, cod: `${anio}${pad2(mes)}` };
}

export function buildSireFilenameBase(ruc, periodoInput, libroCode, hasRows = true, isUsd = false) {
  const r = pad11(ruc).slice(0, 11);
  const p = normalizarPeriodo(periodoInput);
  const dia = '00';
  const oport = '02'; // 02 = Reemplazo de propuesta
  const indOper = hasRows ? '1' : '0';
  const indCont = hasRows ? '1' : '0';
  const indMon  = isUsd ? '2' : '1';
  const indGen  = '2'; // 2 = SIRE

  return `LE${r}${p.cod}${dia}${libroCode}${oport}${indOper}${indCont}${indMon}${indGen}`;
}

/**
 * Serie y número como los escribe SUNAT en su propuesta: el número SIN los
 * ceros de la izquierda (`F001-00000123` → `F001` / `123`). SUNAT cruza por el
 * CAR, que rellena a 10 dígitos, así que los ceros no aportan y el archivo
 * queda igual al que baja del portal.
 */
export function serieYNumero(doc) {
  const { serie, numero } = partirComprobante(doc);
  const n = /^\d+$/.test(numero) ? String(Number(numero)) : numero;
  return { serie, numero: n };
}

/** La tasa para pasar el comprobante a soles: 1 en soles, null si falta. */
function tasaParaSoles(m, tasaDe) {
  const moneda = String(m.currency || m.moneda || 'PEN').toUpperCase();
  if (moneda === 'PEN') return 1;
  const propia = Number(m.tipo_cambio);
  if (propia > 0) return propia;
  const buscada = typeof tasaDe === 'function' ? Number(tasaDe(m)) : 0;
  return buscada > 0 ? buscada : null;
}

function docReferenciaNota(m, movsById) {
  const esNota = ['nota_credito', 'nota_debito'].includes(m?.document_type);
  if (!esNota) return ['', '', '', ''];
  const ref = (movsById && m.related_movement_id) ? movsById.get(m.related_movement_id) : null;
  if (!ref) return ['', '', '', ''];
  const d = serieYNumero(ref.document_number || '');
  if (!d.serie && !d.numero) return ['', '', '', ''];
  return [
    fmtFechaSunat(ref.date || ref.created_at),
    tipoComprobante(ref, '01'),
    d.serie,
    d.numero,
  ];
}

/**
 * Qué comprobantes van al libro y cuáles se caen, y por qué.
 *
 * Mismo criterio que la pantalla del registro: el SENTIDO se decide por
 * `clase` (`esVentaMov`), no por `type`, y el MES por `periodo_declarado`
 * (`declaraEnPeriodo`), no por la fecha de emisión. Con `type` y `date` una
 * factura de febrero movida a junio pasaba el filtro de la pantalla y el
 * generador la tiraba: la pantalla mostraba N y el .zip salía con N−1.
 */
function elegirMovimientos(movs, { periodo, venta, seleccionados, movsById }) {
  const elegidos = [];
  const avisos = [];
  for (const m of movs || []) {
    if (!m || m.deleted_at) continue;
    if (m.payment_status === 'cancelled') continue;
    if (notaSinEfecto(m, movsById)) continue;   // factura y nota vivas (25-set)
    if (esVentaMov(m) !== venta) continue;
    if (seleccionados) {
      if (!seleccionados.has(m.id)) continue;
    } else if (!declaraEnPeriodo(m, periodo.anio, periodo.mes)) {
      continue;
    }
    // La fecha de emisión no puede ser posterior al período (regla del campo
    // 5 del Anexo). Solo puede pasar con una selección hecha a mano.
    const emision = periodoDeEmision(m);
    if (emision && emision > periodo.cod) {
      avisos.push({ id: m.id, documento: m.document_number || '', motivo: 'emitido_despues' });
      continue;
    }
    elegidos.push(m);
  }
  return { elegidos, avisos };
}

/** Los importes de un comprobante, en soles y con el signo que pide SUNAT. */
function importesSoles(m, tc) {
  const dg = desglosarIgv(m);
  const tipo = tipoComprobante(m, '01');
  // La nota de crédito va en negativo aunque se haya cargado en positivo
  // (quedan 2 viejas así); cualquier otro comprobante, con su signo.
  const signo = tipo === '07' ? -1 : 1;
  const conSigno = (v) => (tipo === '07' ? signo * Math.abs(v) : v);
  const base = dg.baseGravada != null ? dg.baseGravada : dg.subtotal;
  const noGrav = r2(dg.subtotal - base);
  return {
    tipo,
    total: r2(conSigno(dg.total) * tc),
    base: r2(conSigno(base) * tc),
    igv: r2(conSigno(dg.igv) * tc),
    noGravado: r2(conSigno(noGrav) * tc),
  };
}

/** Fecha de vencimiento: solo la piden los recibos de servicios públicos. */
function fechaVencimiento(m, tipo) {
  if (tipo !== '14') return '';
  return fmtFechaSunat(m.fecha_vencimiento || m.due_date || '');
}

function armarLinea(campos, valores) {
  return campos.map(c => (valores[c] ?? '')).join('|') + '|';
}

function resultado(libro, rucLimpio, periodo, lineas, totales, omitidos, avisos) {
  const counter = lineas.length;
  const filenameBase = buildSireFilenameBase(rucLimpio, periodo, libro, counter > 0, false);
  return {
    libro,
    filenameBase,
    txtFilename: `${filenameBase}.txt`,
    zipFilename: `${filenameBase}.zip`,
    txtContent: lineas.length ? lineas.join('\r\n') + '\r\n' : '',
    registros: counter,
    totBase: r2(totales.base),
    totIgv: r2(totales.igv),
    totTotal: r2(totales.total),
    // Comprobantes que NO entraron al archivo y deberían: la pantalla no deja
    // presentar mientras haya alguno (un faltante callado es un comprobante
    // que nadie declara y nadie extraña).
    omitidos,
    avisos,
  };
}

// ─────────────────────────────────────────────────────────────
// 1. RVIE — Reemplazo de la propuesta (Anexo 3, campos 1 a 33)
// ─────────────────────────────────────────────────────────────
/**
 * @param opts.seleccionadosIds  ids elegidos en la pantalla (si no, el período entero)
 * @param opts.movsById          índice de TODOS los movimientos (las notas apuntan a meses anteriores)
 * @param opts.tasaDe            (mov) => tipo de cambio de su fecha, para los que no lo traen estampado
 */
export function generateReemplazoPropuestaRVIE(movs, periodoInput, ruc, razonSocial = '', opts = {}) {
  const periodo = normalizarPeriodo(periodoInput);
  const rucLimpio = pad11(ruc).slice(0, 11);
  const razonSocialLimpia = clean(razonSocial).slice(0, 1500);
  const movsById = opts.movsById || new Map((movs || []).map(m => [m.id, m]));
  const seleccionados = opts.seleccionadosIds ? new Set(opts.seleccionadosIds) : null;

  const { elegidos, avisos } = elegirMovimientos(movs, { periodo, venta: true, seleccionados, movsById });
  const lineas = [];
  const omitidos = [];
  const tot = { base: 0, igv: 0, total: 0 };

  for (const m of elegidos) {
    const tc = tasaParaSoles(m, opts.tasaDe);
    if (tc == null) {
      omitidos.push({ id: m.id, documento: m.document_number || '', motivo: 'sin_tipo_cambio' });
      continue;
    }
    const imp = importesSoles(m, tc);
    const exportacion = String(m.destino_contable || '').toLowerCase().includes('exporta');
    // Lo no gravado va como exonerado o inafecto si el comprobante lo dice;
    // si no, como inafecto (lo más común en una venta sin IGV).
    const exonerado = m.exonerado != null ? r2(Number(m.exonerado) * tc) : 0;
    const inafecto = m.exonerado != null ? r2(imp.noGravado - exonerado) : imp.noGravado;
    const moneda = String(m.currency || m.moneda || 'PEN').toUpperCase();
    const doc = serieYNumero(m.document_number || '');
    const cliDoc = clean(m.third_party_ruc || '');
    const ref = docReferenciaNota(m, movsById);

    tot.base += exportacion ? 0 : imp.base;
    tot.igv += exportacion ? 0 : imp.igv;
    tot.total += imp.total;

    lineas.push(armarLinea(CAMPOS_RVIE, {
      'Ruc': rucLimpio,
      'Razon Social': razonSocialLimpia,
      'Periodo': periodo.cod,
      'CAR SUNAT': '',                                   // «Consignar vacío»
      'Fecha de emisión': fmtFechaSunat(m.date || m.created_at),
      'Fecha Vcto/Pago': fechaVencimiento(m, imp.tipo),
      'Tipo CP/Doc.': imp.tipo,
      'Serie del CDP': doc.serie,
      'Nro CP o Doc. Nro Inicial (Rango)': doc.numero,
      'Nro Final (Rango)': '',
      'Tipo Doc Identidad': cliDoc ? tipoDocIdentidad(m.third_party_doc_type || cliDoc) : '',
      'Nro Doc Identidad': cliDoc,
      'Apellidos Nombres/ Razón Social': clean(m.third_party_name || '').slice(0, 1500),
      'Valor Facturado Exportación': num(exportacion ? imp.total : 0),
      'BI Gravada': num(exportacion ? 0 : imp.base),
      'Dscto BI': '0.00',
      'IGV / IPM': num(exportacion ? 0 : imp.igv),
      'Dscto IGV / IPM': '0.00',
      'Mto Exonerado': num(exportacion ? 0 : exonerado),
      'Mto Inafecto': num(exportacion ? 0 : inafecto),
      'ISC': '0.00',
      'BI Grav IVAP': '0.00',
      'IVAP': '0.00',
      'ICBPER': '0.00',
      'Otros Tributos': '0.00',
      'Total CP': num(imp.total),
      'Moneda': moneda,
      'Tipo Cambio': num(tc, 3),
      'Fecha Emisión Doc Modificado': ref[0],
      'Tipo CP Modificado': ref[1],
      'Serie CP Modificado': ref[2],
      'Nro CP Modificado': ref[3],
      'ID Proyecto Operadores Atribución': '',
    }));
  }

  return resultado(LIBRO_RVIE_REEMPLAZO, rucLimpio, periodo, lineas, tot, omitidos, avisos);
}

// ─────────────────────────────────────────────────────────────
// 2. RCE — Reemplazo de la propuesta (Anexo 11, campos 1 a 41)
// ─────────────────────────────────────────────────────────────
export function generateReemplazoPropuestaRCE(movs, periodoInput, ruc, razonSocial = '', opts = {}) {
  const periodo = normalizarPeriodo(periodoInput);
  const rucLimpio = pad11(ruc).slice(0, 11);
  const razonSocialLimpia = clean(razonSocial).slice(0, 1500);
  const movsById = opts.movsById || new Map((movs || []).map(m => [m.id, m]));
  const seleccionados = opts.seleccionadosIds ? new Set(opts.seleccionadosIds) : null;

  const { elegidos, avisos } = elegirMovimientos(movs, { periodo, venta: false, seleccionados, movsById });
  const lineas = [];
  const omitidos = [];
  const tot = { base: 0, igv: 0, total: 0 };

  for (const m of elegidos) {
    const tc = tasaParaSoles(m, opts.tasaDe);
    if (tc == null) {
      omitidos.push({ id: m.id, documento: m.document_number || '', motivo: 'sin_tipo_cambio' });
      continue;
    }
    const imp = importesSoles(m, tc);
    // Un recibo por honorarios no lleva IGV ni da crédito fiscal: su importe
    // entero es adquisición no gravada (mismo criterio que el Registro).
    const honorarios = esReciboHonorarios(m);
    const base = honorarios ? 0 : imp.base;
    const igv = honorarios ? 0 : imp.igv;
    const noGrav = honorarios ? imp.total : imp.noGravado;
    const moneda = String(m.currency || m.moneda || 'PEN').toUpperCase();
    const doc = serieYNumero(m.document_number || '');
    const provDoc = clean(m.third_party_ruc || '');
    const ref = docReferenciaNota(m, movsById);

    tot.base += base;
    tot.igv += igv;
    tot.total += imp.total;

    lineas.push(armarLinea(CAMPOS_RCE, {
      'RUC': rucLimpio,
      'Apellidos y Nombres o Razón social': razonSocialLimpia,
      'Periodo': periodo.cod,
      'CAR SUNAT': '',                                   // «Consignar vacío»
      'Fecha de emisión': fmtFechaSunat(m.date || m.created_at),
      'Fecha Vcto/Pago': fechaVencimiento(m, imp.tipo),
      'Tipo CP/Doc.': imp.tipo,
      'Serie del CDP': doc.serie,
      'Año': '',                                         // solo DAM / DSI
      'Nro CP o Doc. Nro Inicial (Rango)': doc.numero,
      'Nro Final (Rango)': '',
      'Tipo Doc Identidad': provDoc ? tipoDocIdentidad(m.third_party_doc_type || provDoc) : '',
      'Nro Doc Identidad': provDoc,
      'Apellidos Nombres/ Razón  Social': clean(m.third_party_name || '').slice(0, 1500),
      'BI Gravado DG': num(base),
      'IGV / IPM DG': num(igv),
      'BI Gravado DGNG': '0.00',
      'IGV / IPM DGNG': '0.00',
      'BI Gravado DNG': '0.00',
      'IGV / IPM DNG': '0.00',
      'Valor Adq. NG': num(noGrav),
      'ISC': '0.00',
      'ICBPER': '0.00',
      'Otros Trib/ Cargos': '0.00',
      'Total CP': num(imp.total),
      'Moneda': moneda,
      'Tipo de Cambio': num(tc, 3),
      'Fecha Emisión Doc Modificado': ref[0],
      'Tipo CP Modificado': ref[1],
      'Serie CP Modificado': ref[2],
      'COD. DAM O DSI': '',
      'Nro CP Modificado': ref[3],
      // Solo para quien facturó más de 1.500 UIT el año anterior.
      'Clasif de Bss y Sss': '',
      'ID Proyecto Operadores': '',
      'PorcPart': '',
      'IMB': '0.00',                                     // como la propuesta de SUNAT
      'CAR Orig/ Ind E o I': '',
      // 38-41 vacíos: los completa SUNAT desde su propuesta.
    }));
  }

  return resultado(LIBRO_RCE_REEMPLAZO, rucLimpio, periodo, lineas, tot, omitidos, avisos);
}

// ─────────────────────────────────────────────────────────────
// 3. GENERADOR DE ARCHIVO ZIP
// ─────────────────────────────────────────────────────────────
export async function createSireZip(txtFilename, txtContent) {
  const zip = new JSZip();
  // El archivo de texto dentro del ZIP debe tener exactamente el mismo nombre base
  zip.file(txtFilename, txtContent, { binary: false });
  // Generamos uint8array universalmente compatible en Node/Vitest y Browser
  const data = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  return data;
}

export async function buildSireZipPackage(generadorResult) {
  if (!generadorResult || !generadorResult.txtFilename) {
    throw new Error('Resultado de generador SIRE inválido');
  }
  const zipData = await createSireZip(generadorResult.txtFilename, generadorResult.txtContent);
  return {
    ...generadorResult,
    zipData,
    zipBlob: typeof Blob !== 'undefined' ? new Blob([zipData], { type: 'application/zip' }) : zipData,
    zipSize: zipData.byteLength || zipData.length || 0,
  };
}

// ─────────────────────────────────────────────────────────────
// 4. ANÁLISIS Y CRUCE CON COMPROBANTES PRESENTADOS
// ─────────────────────────────────────────────────────────────
/**
 * Analiza comprobantes de JARVEX frente a comprobantes ya presentados en SUNAT
 * para permitir selección granular (solo faltantes, todos, o personalizados).
 * Con los MISMOS filtros que el generador: si no, la pantalla ofrecería
 * comprobantes que el archivo después no escribe.
 *
 * @param {Array} movs - Lista de movimientos contables
 * @param {'compras'|'ventas'} libro - Tipo de libro
 * @param {Object} opts
 * @param {Array|Set} opts.comprobantesPresentados - Filas de corte SUNAT o Set de llaves
 * @param {Object|string} opts.periodo - Período a auditar
 */
export function analizarComprobantesParaSire(movs, libro, opts = {}) {
  const periodo = opts.periodo ? normalizarPeriodo(opts.periodo) : null;
  const esVenta = libro === 'ventas';
  const movsById = opts.movsById || new Map((movs || []).map(m => [m.id, m]));

  // Conjunto de llaves de comprobantes ya presentados en SUNAT
  const presentadosMap = new Map();

  if (opts.comprobantesPresentados) {
    if (opts.comprobantesPresentados instanceof Set || opts.comprobantesPresentados instanceof Map) {
      opts.comprobantesPresentados.forEach((val, k) => {
        presentadosMap.set(typeof val === 'string' ? val : k, val);
      });
    } else if (Array.isArray(opts.comprobantesPresentados)) {
      opts.comprobantesPresentados.forEach(f => {
        if (!f) return;
        const k = f.llave || llaveDeFilaSunat(f);
        if (k) presentadosMap.set(k, f);
      });
    }
  }

  const items = [];
  let yaPresentadosCount = 0;
  let faltantesCount = 0;

  (movs || []).forEach(m => {
    if (!m || m.deleted_at) return;
    if (m.payment_status === 'cancelled') return;
    if (notaSinEfecto(m, movsById)) return;   // factura y nota vivas (25-set)
    if (esVentaMov(m) !== esVenta) return;
    if (periodo && !declaraEnPeriodo(m, periodo.anio, periodo.mes)) return;

    const llave = llaveDeMovimiento(m);
    const presentadoEnSunat = presentadosMap.has(llave);
    const sunatFila = presentadoEnSunat ? presentadosMap.get(llave) : null;

    if (presentadoEnSunat) {
      yaPresentadosCount++;
    } else {
      faltantesCount++;
    }

    items.push({
      movimiento: m,
      id: m.id,
      llave,
      fecha: m.date || m.created_at,
      documento: m.document_number,
      tipoDocumento: m.document_type,
      terceroRuc: m.third_party_ruc,
      terceroNombre: m.third_party_name,
      monto: Number(m.amount || 0),
      moneda: m.currency || 'PEN',
      yaPresentado: presentadoEnSunat,
      sunatFila,
    });
  });

  return {
    items,
    totalMovs: items.length,
    yaPresentadosCount,
    faltantesCount,
    hasPresentadosRef: presentadosMap.size > 0,
  };
}

// ─── Descarga en Browser ─────────────────────────────────────
export function downloadSireZip(zipDataOrBlob, zipFilename) {
  try {
    const blob = (typeof Blob !== 'undefined' && zipDataOrBlob instanceof Blob)
      ? zipDataOrBlob
      : new Blob([zipDataOrBlob], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = zipFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    console.error('[downloadSireZip]', e);
  }
}

export default {
  LIBRO_RVIE_REEMPLAZO,
  LIBRO_RCE_REEMPLAZO,
  CAMPOS_RVIE,
  CAMPOS_RCE,
  buildSireFilenameBase,
  generateReemplazoPropuestaRVIE,
  generateReemplazoPropuestaRCE,
  createSireZip,
  buildSireZipPackage,
  analizarComprobantesParaSire,
  downloadSireZip,
};
