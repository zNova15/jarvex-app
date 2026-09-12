// ─────────────────────────────────────────────────────────────
// SUNAT SIRE — Reemplazo de Propuesta RVIE (140400) y RCE (080400)
//
// Generador reglamentario según R.S. 112-2021/SUNAT y modificaciones.
// Formato: Archivo comprimido .ZIP que contiene un archivo .TXT con
// codificación UTF-8, líneas delimitadas por pipes (`|`) y terminadas en `|`.
//
// Nomenclatura del archivo (.zip y .txt interno):
//   LE<RUC><AAAAMM><00><LIBRO><OPORT><IND_OPER><IND_CONT><IND_MON><IND_GEN>
//   - RUC        : 11 dígitos
//   - AAAAMM     : período (año + mes, 6 caracteres)
//   - 00         : día fijo (00 = mensual)
//   - LIBRO      : 6 dígitos (140400 = RVIE Reemplazo, 080400 = RCE Reemplazo)
//   - OPORT      : 2 dígitos ('02' = Reemplazo de propuesta)
//   - IND_OPER   : 1 dígito  ('1' = Con información, '0' = Sin información)
//   - IND_CONT   : 1 dígito  ('1' = Con información, '0' = Sin información)
//   - IND_MON    : 1 dígito  ('1' = Moneda nacional PEN, '2' = Extranjera USD)
//   - IND_GEN    : 1 dígito  ('2' = Generado para SIRE)
//
//   Longitud total del nombre base: 33 caracteres.
//   Ejemplo: LE2061534608120260700140400021112.zip
// ─────────────────────────────────────────────────────────────

import JSZip from 'jszip';
import { desglosarIgv } from './igv-desglose.js';
import { fmtFechaLarga, enPeriodo } from './fecha.js';
import { llaveDeMovimiento, llaveDeFilaSunat, llaveComprobante } from './comparativa-sunat.js';

export const LIBRO_RVIE_REEMPLAZO = '140400';
export const LIBRO_RCE_REEMPLAZO  = '080400';

// ─── Helpers de formato ──────────────────────────────────────
function pad2(n)  { return String(n || 0).padStart(2, '0'); }
function pad4(n)  { return String(n || 0).padStart(4, '0'); }
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

const COD_COMPROBANTE = {
  factura: '01',
  boleta:  '03',
  nota_credito: '07',
  nota_debito:  '08',
  recibo_honorarios: '02',
  ticket: '12',
  guia: '09',
  default: '00',
};

export function tipoCompCode(doc, fallback = '00') {
  const s = String(doc || '').toLowerCase();
  if (/factura|f00|f0|f-|^f\d/.test(s)) return COD_COMPROBANTE.factura;
  if (/boleta|b00|^b\d/.test(s))         return COD_COMPROBANTE.boleta;
  if (/nota.*cred|n\.?c\.?/.test(s))     return COD_COMPROBANTE.nota_credito;
  if (/nota.*deb|n\.?d\.?/.test(s))      return COD_COMPROBANTE.nota_debito;
  if (/honor|recibo|rh/.test(s))         return COD_COMPROBANTE.recibo_honorarios;
  if (/ticket/.test(s))                  return COD_COMPROBANTE.ticket;
  if (/guia/.test(s))                    return COD_COMPROBANTE.guia;
  return fallback;
}

export function splitDoc(doc) {
  if (!doc) return { serie: '', nro: '' };
  const s = String(doc).trim();
  const m = s.match(/^([A-Za-z0-9]+)[\s\-\/]+(\d+)$/);
  if (m) return { serie: m[1].toUpperCase(), nro: m[2] };
  return { serie: '', nro: s.replace(/\D+/g, '') || s };
}

function tipoDocIdent(td, rucOrDni = '') {
  const k = String(td || '').toUpperCase();
  if (k === 'RUC' || k === '6') return '6';
  if (k === 'DNI' || k === '1') return '1';
  if (k === 'CE' || k === 'CARNET' || k === '4') return '4';
  if (k === 'PAS' || k === 'PASAPORTE' || k === '7') return '7';
  if (String(rucOrDni).length === 11) return '6';
  if (String(rucOrDni).length === 8) return '1';
  return '0';
}

function docReferenciaNota(m, movsById) {
  const esNota = ['nota_credito', 'nota_debito'].includes(m?.document_type);
  if (!esNota) return ['', '', '', ''];
  const ref = (movsById && m.related_movement_id) ? movsById.get(m.related_movement_id) : null;
  if (!ref) return ['', '', '', ''];
  const d = splitDoc(ref.document_number || '');
  if (!d.serie && !d.nro) return ['', '', '', ''];
  return [
    fmtFechaSunat(ref.date || ref.created_at),
    tipoCompCode(ref.document_type || '', '01'),
    d.serie,
    d.nro,
  ];
}

// ─────────────────────────────────────────────────────────────
// 1. GENERADOR DE RVIE (Libro 140400 - 40 Campos)
// ─────────────────────────────────────────────────────────────
export function generateReemplazoPropuestaRVIE(movs, periodoInput, ruc, razonSocial = '', opts = {}) {
  const periodo = normalizarPeriodo(periodoInput);
  const rucLimpio = pad11(ruc).slice(0, 11);
  const razonSocialLimpia = clean(razonSocial).slice(0, 100);
  const movsById = opts.movsById || new Map((movs || []).map(m => [m.id, m]));
  const seleccionados = opts.seleccionadosIds ? new Set(opts.seleccionadosIds) : null;

  let counter = 0;
  let totBase = 0, totIgv = 0, totTotal = 0;
  const lines = [];

  (movs || []).forEach(m => {
    if (!m || m.deleted_at) return;
    if (m.payment_status === 'cancelled') return;
    if (m.type !== 'income') return;
    if (seleccionados && !seleccionados.has(m.id)) return;

    // Si no viene restringido por seleccionados, validar pertenencia al período
    if (!seleccionados && !enPeriodo(m.date || m.created_at, periodo.anio, periodo.mes)) {
      return;
    }

    counter++;
    const dg = desglosarIgv(m);
    const total = dg.total;
    const igv = dg.igv;
    const baseGrav = dg.baseGravada != null ? dg.baseGravada : dg.subtotal;
    const noGrav = r2(dg.subtotal - baseGrav);

    totBase += baseGrav;
    totIgv += igv;
    totTotal += total;

    const docInfo = splitDoc(m.document_number || '');
    const tipoCp = tipoCompCode(m.document_type || '', '01');
    const fEmi = fmtFechaSunat(m.date || m.created_at);
    const fVcto = fmtFechaSunat(m.fecha_vencimiento || m.due_date || '');

    const cliDocNum = clean(m.third_party_ruc || '');
    const cliDocTipo = tipoDocIdent(m.third_party_doc_type, cliDocNum);
    const cliNombre = clean(m.third_party_name || '').slice(0, 100);

    const moneda = String(m.currency || m.moneda || 'PEN').toUpperCase();
    const tc = moneda !== 'PEN' ? num(Number(m.tipo_cambio || 0), 3) : '';
    const ref = docReferenciaNota(m, movsById);

    // Las 40 columnas de RVIE Reemplazo de Propuesta (Libro 140400)
    const cols = [
      rucLimpio,                   // 1. RUC Generador
      razonSocialLimpia,           // 2. Apellidos y Nombres / Razón Social
      periodo.cod,                 // 3. Período (AAAAMM)
      m.car_sunat || '',           // 4. CAR SUNAT
      fEmi,                        // 5. Fecha de emisión (DD/MM/AAAA)
      fVcto,                       // 6. Fecha de vencimiento / pago
      tipoCp,                      // 7. Tipo de comprobante de pago
      docInfo.serie,               // 8. Serie del comprobante
      docInfo.nro,                 // 9. Número correlativo
      '',                          // 10. Número final (tickets)
      cliDocTipo,                  // 11. Tipo doc identidad cliente
      cliDocNum,                   // 12. Nro doc identidad cliente
      cliNombre,                   // 13. Denominación o Razón Social cliente
      '0.00',                      // 14. Valor facturado de la exportación
      num(baseGrav),               // 15. Base imponible de la op. gravada
      '0.00',                      // 16. Descuento de la base imponible
      num(igv),                    // 17. IGV y/o IPM
      '0.00',                      // 18. Descuento del IGV
      '0.00',                      // 19. Monto de op. exonerada
      num(noGrav),                 // 20. Monto de op. inafecta
      '0.00',                      // 21. ISC
      '0.00',                      // 22. Base imponible op. gravada IVAP
      '0.00',                      // 23. ICBPER (bolsas)
      '0.00',                      // 24. Otros tributos y cargos
      num(total),                  // 25. Importe total del comprobante
      moneda,                      // 26. Código de moneda (PEN/USD)
      tc,                          // 27. Tipo de cambio
      ref[0] || '',                // 28. Fecha emisión comprobante modificado
      ref[1] || '',                // 29. Tipo comprobante modificado
      ref[2] || '',                // 30. Serie comprobante modificado
      ref[3] || '',                // 31. Número comprobante modificado
      '',                          // 32. Identificador proyecto OSE
      '',                          // 33. Tipo de Nota especial
      '',                          // 34. Régimen especial
      '',                          // 35. Porcentaje régimen especial
      '',                          // 36. Importe régimen especial
      '',                          // 37. Identificador contrato colaboración
      '',                          // 38. Porcentaje de participación
      '',                          // 39. Importe de participación
      '1',                         // 40. Estado / Indicador del comprobante (1=anota en el período)
    ];

    // En SIRE las líneas terminan con pipe `|`
    lines.push(cols.join('|') + '|');
  });

  const hasRows = counter > 0;
  const filenameBase = buildSireFilenameBase(rucLimpio, periodo, LIBRO_RVIE_REEMPLAZO, hasRows, false);
  const txtFilename = `${filenameBase}.txt`;
  const zipFilename = `${filenameBase}.zip`;
  const txtContent = lines.length ? lines.join('\r\n') + '\r\n' : '';

  return {
    libro: LIBRO_RVIE_REEMPLAZO,
    filenameBase,
    txtFilename,
    zipFilename,
    txtContent,
    registros: counter,
    totBase: r2(totBase),
    totIgv: r2(totIgv),
    totTotal: r2(totTotal),
  };
}

// ─────────────────────────────────────────────────────────────
// 2. GENERADOR DE RCE (Libro 080400 - 42 Campos)
// ─────────────────────────────────────────────────────────────
export function generateReemplazoPropuestaRCE(movs, periodoInput, ruc, razonSocial = '', opts = {}) {
  const periodo = normalizarPeriodo(periodoInput);
  const rucLimpio = pad11(ruc).slice(0, 11);
  const razonSocialLimpia = clean(razonSocial).slice(0, 100);
  const movsById = opts.movsById || new Map((movs || []).map(m => [m.id, m]));
  const seleccionados = opts.seleccionadosIds ? new Set(opts.seleccionadosIds) : null;

  let counter = 0;
  let totBase = 0, totIgv = 0, totTotal = 0;
  const lines = [];

  (movs || []).forEach(m => {
    if (!m || m.deleted_at) return;
    if (m.payment_status === 'cancelled') return;
    if (m.type !== 'cost' && m.type !== 'expense') return;
    if (seleccionados && !seleccionados.has(m.id)) return;

    if (!seleccionados && !enPeriodo(m.date || m.created_at, periodo.anio, periodo.mes)) {
      return;
    }

    counter++;
    const dg = desglosarIgv(m);
    const total = dg.total;
    const igv = dg.igv;
    const baseGrav = dg.baseGravada != null ? dg.baseGravada : dg.subtotal;
    const noGrav = r2(dg.subtotal - baseGrav);

    totBase += baseGrav;
    totIgv += igv;
    totTotal += total;

    const docInfo = splitDoc(m.document_number || '');
    const tipoCp = tipoCompCode(m.document_type || '', '01');
    const fEmi = fmtFechaSunat(m.date || m.created_at);
    const fVcto = fmtFechaSunat(m.fecha_vencimiento || m.due_date || '');

    const provDocNum = clean(m.third_party_ruc || '');
    const provDocTipo = tipoDocIdent(m.third_party_doc_type, provDocNum);
    const provNombre = clean(m.third_party_name || '').slice(0, 100);

    const moneda = String(m.currency || m.moneda || 'PEN').toUpperCase();
    const tc = moneda !== 'PEN' ? num(Number(m.tipo_cambio || 0), 3) : '';
    const ref = docReferenciaNota(m, movsById);

    // Las 42 columnas de RCE Reemplazo de Propuesta (Libro 080400)
    const cols = [
      rucLimpio,                   // 1. RUC deudor tributario
      razonSocialLimpia,           // 2. Apellidos y Nombres / Razón Social
      periodo.cod,                 // 3. Período (AAAAMM)
      m.car_sunat || '',           // 4. CAR SUNAT
      fEmi,                        // 5. Fecha de emisión
      fVcto,                       // 6. Fecha de vencimiento / pago
      tipoCp,                      // 7. Tipo de comprobante de pago
      docInfo.serie,               // 8. Serie del comprobante
      '',                          // 9. Año de emisión de la DUA o DSI
      docInfo.nro,                 // 10. Número correlativo
      '',                          // 11. Número final (tickets)
      provDocTipo,                 // 12. Tipo doc identidad proveedor
      provDocNum,                  // 13. Nro doc identidad proveedor
      provNombre,                  // 14. Denominación o Razón Social proveedor
      num(baseGrav),               // 15. Base gravada para ventas gravadas
      num(igv),                    // 16. IGV de adquisiciones gravadas
      '0.00',                      // 17. Base gravada para op. gravadas y no gravadas
      '0.00',                      // 18. IGV op. gravadas y no gravadas
      '0.00',                      // 19. Base gravada para op. no gravadas
      '0.00',                      // 20. IGV op. no gravadas
      num(noGrav),                 // 21. Valor de adquisiciones no gravadas
      '0.00',                      // 22. ISC
      '0.00',                      // 23. ICBPER (bolsas)
      '0.00',                      // 24. Otros conceptos, tributos y cargos
      num(total),                  // 25. Importe total de la adquisición
      moneda,                      // 26. Código de moneda
      tc,                          // 27. Tipo de cambio
      ref[0] || '',                // 28. Fecha comprobante modificado
      ref[1] || '',                // 29. Tipo comprobante modificado
      ref[2] || '',                // 30. Serie comprobante modificado
      '',                          // 31. Código dependencia aduanera
      ref[3] || '',                // 32. Número comprobante modificado
      fmtFechaSunat(m.detraccion_fecha || ''), // 33. Fecha depósito detracción
      clean(m.detraccion_numero || ''),        // 34. Nro depósito detracción
      '',                          // 35. Marca retención
      '',                          // 36. Clasificación bienes y servicios
      '',                          // 37. Contrato o proyecto
      '',                          // 38. Porcentaje de participación
      '',                          // 39. Importe de participación
      '',                          // 40. Tipo Nota especial
      '',                          // 41. Régimen especial
      '1',                         // 42. Indicador comprobante (1=anota en el período)
    ];

    lines.push(cols.join('|') + '|');
  });

  const hasRows = counter > 0;
  const filenameBase = buildSireFilenameBase(rucLimpio, periodo, LIBRO_RCE_REEMPLAZO, hasRows, false);
  const txtFilename = `${filenameBase}.txt`;
  const zipFilename = `${filenameBase}.zip`;
  const txtContent = lines.length ? lines.join('\r\n') + '\r\n' : '';

  return {
    libro: LIBRO_RCE_REEMPLAZO,
    filenameBase,
    txtFilename,
    zipFilename,
    txtContent,
    registros: counter,
    totBase: r2(totBase),
    totIgv: r2(totIgv),
    totTotal: r2(totTotal),
  };
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

    if (esVenta) {
      if (m.type !== 'income') return;
    } else {
      if (m.type !== 'cost' && m.type !== 'expense') return;
    }

    if (periodo && !enPeriodo(m.date || m.created_at, periodo.anio, periodo.mes)) {
      return;
    }

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
  buildSireFilenameBase,
  generateReemplazoPropuestaRVIE,
  generateReemplazoPropuestaRCE,
  createSireZip,
  buildSireZipPackage,
  analizarComprobantesParaSire,
  downloadSireZip,
};
