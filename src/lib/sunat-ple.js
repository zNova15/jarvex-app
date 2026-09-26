// ─────────────────────────────────────────────────────────────
// SUNAT PLE — Libro Diario (5.1) y Libro Mayor (6.1)
//
// La estructura sale del ANEXO 2 de SUNAT («Estructuras e información de los
// libros y/o registros electrónicos», planilla oficial de feb-2021, leída en
// la tanda F del 26-set-2026). Hasta esa tanda el archivo decía «TODO:
// validar con docs SUNAT» y ninguno de los libros podía pasar el validador:
//   · el NOMBRE tenía 32 caracteres (faltaba un '0' del código de oportunidad);
//   · el Diario tenía 17 campos (son 21) y el correlativo 12 caracteres (el
//     máximo es 10);
//   · el Mayor mandaba TOTALES por cuenta en 7 campos — el 6.1 son los mismos
//     21 campos del Diario, movimiento por movimiento, ordenados por cuenta;
//   · un descuadre metía una línea `# WARNING` DENTRO del .txt, y cualquier
//     línea así invalida el archivo entero.
//
// ── Y LOS REGISTROS DE COMPRAS Y VENTAS YA NO VAN POR ACÁ ──────────
// Desde 2025 el Registro de Ventas (14.1) y el de Compras (8.1) se presentan
// SOLO por el SIRE (RVIE y RCE). Sus generadores PLE se retiraron: el que
// sirve es el reemplazo de propuesta de `sunat-sire.js`, que se exporta desde
// el propio Registro de Compras y Ventas.
//
// Formato: .txt UTF-8, campos separados por `|`, cada línea termina en `|`.
// Nombre (33 caracteres, «Reglas de nombres de libros» del Anexo 2):
//   LE + RUC(11) + AAAA + MM + DD('00') + LIBRO(6) + CC('00')
//      + O (1 = empresa operativa) + I (1 con info / 0 sin info)
//      + M (1 = soles) + G (1 = generado por el PLE)
// ─────────────────────────────────────────────────────────────

import { fmtFechaLarga } from './fecha.js';
import { esVentaMov } from './costo-obra.js';
import { tipoComprobante, tipoDocIdentidad, partirComprobante, carDeComprobante } from './tablas-sunat.js';

export const LIBRO_DIARIO = '050100';
export const LIBRO_MAYOR = '060100';

// ─── Helpers ─────────────────────────────────────────────────
function pad2(n)  { return String(n || 0).padStart(2, '0'); }
function pad4(n)  { return String(n || 0).padStart(4, '0'); }
function pad11(s) { return String(s || '').padStart(11, '0'); }

function clean(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[\|\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
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
  // SUNAT pide dd/mm/aaaa. fmtFechaLarga parte el string cuando es fecha
  // suelta: new Date('YYYY-MM-DD') daba el día ANTERIOR en Lima.
  if (!d) return '';
  return fmtFechaLarga(d) || '';
}

function periodoSunat(periodo) {
  // periodo = { anio, mes }  →  AAAAMM00
  return `${pad4(periodo.anio)}${pad2(periodo.mes)}00`;
}

/** 'YYYYMM' de una fecha 'YYYY-MM-DD…', por string. */
const mesDe = (fecha) => String(fecha || '').slice(0, 7).replace('-', '');

/**
 * El nombre del archivo, 33 caracteres.
 * @param conInfo  true si el libro trae al menos una línea
 */
export function buildFilename(ruc, periodo, libroCode, conInfo = true) {
  const r = pad11(ruc).slice(0, 11);
  return `LE${r}${pad4(periodo.anio)}${pad2(periodo.mes)}00${libroCode}00`
    + `1${conInfo ? '1' : '0'}11.txt`;
}

// ─────────────────────────────────────────────────────────────
// LAS LÍNEAS DEL DIARIO — las mismas para el Diario (5.1) y el Mayor (6.1)
// ─────────────────────────────────────────────────────────────
//
//  1 Periodo AAAAMM00          12 Número del comprobante (obligatorio)
//  2 CUO (hasta 40)            13 Fecha contable
//  3 Correlativo (M…, ≤ 10)    14 Fecha de vencimiento
//  4 Cuenta contable           15 Fecha de la operación o emisión (oblig.)
//  5 Unidad de operación       16 Glosa (obligatoria, ≤ 200)
//  6 Centro de costos          17 Glosa referencial (≤ 200)
//  7 Moneda de origen          18 Debe      19 Haber
//  8 Tipo doc. del emisor      20 Dato estructurado: el CAR del comprobante
//  9 Nro. doc. del emisor         en el RVIE/RCE (quien lleva el registro en
// 10 Tipo de comprobante          el SIRE pone el CAR en vez de 140100&…)
// 11 Serie                     21 Estado ('1' = operación del período)
// ─────────────────────────────────────────────────────────────

/**
 * Arma las líneas del libro.
 *
 * CONTRATO: `asientos` ya son los del período. La pantalla los elige con
 * `declaraEnPeriodo` (un comprobante movido con «⇄ mes» se asienta en el mes
 * en que se declara) y las salidas de inventario por su propia fecha. Acá NO
 * se vuelve a filtrar por `fecha`: hacerlo tiraba en silencio los asientos de
 * los comprobantes diferidos, y la pantalla mostraba N y el archivo N−1.
 *
 * @param opts.movsById  índice de los movimientos, para sacar del comprobante
 *                       el tipo, la serie, el número, el emisor y el CAR
 * @returns {{ lineas: Array<{cuo, cuenta, fecha, texto, debe, haber}>, omitidos, avisos, asientosIncluidos }}
 */
export function lineasDelDiario(asientos, periodo, ruc, opts = {}) {
  const movsById = opts.movsById instanceof Map ? opts.movsById : new Map();
  const per = periodoSunat(periodo);
  const perMes = `${pad4(periodo.anio)}${pad2(periodo.mes)}`;
  const rucPropio = String(ruc || '').replace(/\D/g, '');
  const lineas = [];
  const avisos = [];
  // Un asiento en otra moneda SIN tipo de cambio no se declara (25-set-2026):
  // el libro se lleva en soles. Mandarlo con sus dólares sería declarar
  // US$ 80.000 como S/ 80.000.
  let omitidos = 0;
  let asientosIncluidos = 0;
  const cuosUsados = new Map();

  for (const a of Array.isArray(asientos) ? asientos : []) {
    if (!a) continue;
    if (a.sinTipoCambio) { omitidos++; continue; }
    const partidas = (a.partidas || []).filter(p => r2(p.debe) !== 0 || r2(p.haber) !== 0);
    if (!partidas.length) continue;
    asientosIncluidos++;

    const m = a.movimiento_id ? movsById.get(a.movimiento_id) : null;
    const esSalida = !!a.esSalidaExistencia;
    // CUO: el id del comprobante, que no cambia entre una generación y otra
    // (un contador cambiaría si se agrega un comprobante en el medio).
    let cuo = clean(`${a.movimiento_id || a.numero || 'AS'}${esSalida ? '-S' : ''}`).slice(0, 40);
    const repetido = cuosUsados.get(cuo) || 0;
    cuosUsados.set(cuo, repetido + 1);
    if (repetido) cuo = `${cuo.slice(0, 36)}-${repetido + 1}`;

    // El comprobante: de él salen tipo, serie, número, emisor y CAR. La salida
    // de inventario es un asiento interno: no lleva comprobante ni CAR.
    const doc = m && !esSalida ? partirComprobante(m.document_number || '') : { serie: '', numero: '' };
    const tipo = m && !esSalida ? tipoComprobante(m, '00') : '00';
    const numero = /^\d+$/.test(doc.numero) ? String(Number(doc.numero)) : doc.numero;
    const venta = m ? esVentaMov(m) : false;
    const rucEmisor = m && !esSalida
      ? (venta ? rucPropio : String(m.third_party_ruc || '').replace(/\D/g, ''))
      : '';
    const car = m && !esSalida
      ? carDeComprobante({ rucEmisor, tipo, serie: doc.serie, numero })
      : '';

    const fecha = String(a.fecha || '').slice(0, 10);
    if (mesDe(fecha) > perMes) {
      avisos.push(`El asiento ${a.numero || cuo} tiene fecha ${fecha}, posterior al período: SUNAT lo rechaza.`);
    }
    // La fecha contable no puede pasarse del período, y la de un comprobante
    // diferido es anterior: se asienta el primer día del mes en que se declara.
    const fechaContable = mesDe(fecha) === perMes ? fechaSunatDe(fecha) : `01/${pad2(periodo.mes)}/${pad4(periodo.anio)}`;
    const moneda = String(a.conversion?.moneda || 'PEN').toUpperCase();
    const glosa = clean(a.glosa).slice(0, 200) || 'Asiento del período';

    partidas.forEach((p, i) => {
      let debe = r2(p.debe || 0);
      let haber = r2(p.haber || 0);
      // Debe y Haber van positivos y excluyentes: un negativo pasa al otro lado.
      if (debe < 0) { haber += -debe; debe = 0; }
      if (haber < 0) { debe += -haber; haber = 0; }
      const cuenta = String(p.cuenta || '').replace(/\D/g, '');
      if (!cuenta) {
        avisos.push(`El asiento ${a.numero || cuo} tiene una línea sin cuenta contable: no se puede declarar.`);
        return;
      }
      const campos = [
        per,                                   // 1
        cuo,                                   // 2
        `M${String(i + 1).padStart(4, '0')}`,  // 3
        cuenta,                                // 4
        '',                                    // 5
        clean(a.centro_costo || '').slice(0, 24), // 6
        moneda,                                // 7
        rucEmisor ? tipoDocIdentidad(rucEmisor) : '', // 8
        rucEmisor,                             // 9
        tipo,                                  // 10
        doc.serie,                             // 11
        numero || clean(a.numero || cuo).slice(0, 20), // 12 (obligatorio)
        fechaContable,                         // 13
        '',                                    // 14
        fechaSunatDe(fecha),                   // 15
        clean(p.descripcion || a.glosa).slice(0, 200) || glosa, // 16
        glosa,                                 // 17
        num(debe),                             // 18
        num(haber),                            // 19
        car,                                   // 20
        '1',                                   // 21
      ];
      lineas.push({ cuo, cuenta, fecha, debe, haber, texto: campos.join('|') + '|' });
    });
  }

  return { lineas, omitidos, avisos, asientosIncluidos };
}

function fechaSunatDe(ymd) {
  return fmtFechaSunat(ymd);
}

function empaquetar(libro, lineas, periodo, ruc, extra) {
  const totDebe = r2(lineas.reduce((s, l) => s + l.debe, 0));
  const totHaber = r2(lineas.reduce((s, l) => s + l.haber, 0));
  const avisos = [...extra.avisos];
  // El descuadre se AVISA fuera del archivo: una línea que no es de detalle
  // invalida el .txt entero (antes se escribía `# WARNING` adentro).
  const diff = r2(totDebe - totHaber);
  if (Math.abs(diff) > 0.05) {
    avisos.push(`El Debe (${num(totDebe)}) y el Haber (${num(totHaber)}) no cuadran por ${num(diff)}: SUNAT exige que sumen igual.`);
  }
  return {
    filename: buildFilename(ruc, periodo, libro, lineas.length > 0),
    content: lineas.map(l => l.texto).join('\r\n') + (lineas.length ? '\r\n' : ''),
    registros: extra.asientosIncluidos,
    lineas: lineas.length,
    totDebe,
    totHaber,
    omitidos: extra.omitidos,
    avisos,
  };
}

// ─────────────────────────────────────────────────────────────
// 1. LIBRO DIARIO — LE 5.1  (código 050100)
// ─────────────────────────────────────────────────────────────
export function generateLibroDiarioPLE(asientos, periodo, ruc, opts = {}) {
  const r = lineasDelDiario(asientos, periodo, ruc, opts);
  return empaquetar(LIBRO_DIARIO, r.lineas, periodo, ruc, r);
}

// ─────────────────────────────────────────────────────────────
// 2. LIBRO MAYOR — LE 6.1  (código 060100)
// ─────────────────────────────────────────────────────────────
// Los MISMOS movimientos del Diario, ordenados por cuenta (y dentro de cada
// cuenta por fecha). No son saldos: el Anexo 2 le da al 6.1 la misma
// estructura de 21 campos que al 5.1.
export function generateLibroMayorPLE(asientos, periodo, ruc, opts = {}) {
  const r = lineasDelDiario(asientos, periodo, ruc, opts);
  const ordenadas = [...r.lineas].sort((x, y) =>
    x.cuenta.localeCompare(y.cuenta) || x.fecha.localeCompare(y.fecha) || x.cuo.localeCompare(y.cuo));
  const out = empaquetar(LIBRO_MAYOR, ordenadas, periodo, ruc, r);
  return { ...out, cuentas: new Set(ordenadas.map(l => l.cuenta)).size };
}

// ─────────────────────────────────────────────────────────────
// 3. Helper de descarga
// ─────────────────────────────────────────────────────────────
export function downloadPLE(filename, content) {
  try {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    console.error('[downloadPLE]', e);
  }
}

export default {
  LIBRO_DIARIO,
  LIBRO_MAYOR,
  buildFilename,
  lineasDelDiario,
  generateLibroDiarioPLE,
  generateLibroMayorPLE,
  downloadPLE,
};
