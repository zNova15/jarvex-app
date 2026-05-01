// ─────────────────────────────────────────────────────────────
// SUNAT PLE 5.x — Generadores de Libros Electrónicos
//
// Cubre los 4 libros más comunes para empresas peruanas:
//   - Libro Diario        (LE 5.1.0)   — código libro 050100
//   - Libro Mayor         (LE 6.1.0)   — código libro 060100
//   - Registro de Compras (LE 8.1.0)   — código libro 080100
//   - Registro de Ventas  (LE 14.1.0)  — código libro 140100
//
// Formato: txt UTF-8, líneas pipe-delimited (`|`), terminadas con \r\n.
//
// Filename SUNAT (PLE):
//   LE<RUC><AAAAMM00><LIBRO><OPORT><EST><CONT>11.txt
//   - RUC          : 11 dígitos
//   - AAAAMM       : período (año + mes)
//   - 00           : día (00 = mensual)
//   - LIBRO        : 6 dígitos (050100, 060100, 080100, 140100)
//   - OPORT        : 1 dígito (0 = único envío)
//   - EST          : 1 dígito (1 = situación de empresa activa)
//   - CONT         : 1 dígito (1 = con info, 0 = sin info)
//   - 11           : indicador moneda nacional + libro electrónico
//
// Estados de operación por línea:
//   M = movimiento original
//   A = ajuste / asiento de ajuste posterior al cierre
//   E = anulado / extorno
//
// TODO: validar con docs SUNAT (Resolución 286-2009/SUNAT y modificatorias).
// ─────────────────────────────────────────────────────────────

// ─── Helpers ─────────────────────────────────────────────────
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
  // SUNAT pide dd/mm/aaaa en PLE
  if (!d) return '';
  try {
    const date = (d instanceof Date) ? d : new Date(d);
    if (isNaN(date.getTime())) return '';
    return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
  } catch (_) { return ''; }
}

function periodoSunat(periodo) {
  // periodo = { anio, mes }  →  AAAAMM00
  const a = pad4(periodo.anio || new Date().getFullYear());
  const m = pad2(periodo.mes  || new Date().getMonth() + 1);
  return `${a}${m}00`;
}

function isInPeriodo(fecha, periodo) {
  if (!fecha) return false;
  const d = (fecha instanceof Date) ? fecha : new Date(fecha);
  if (isNaN(d.getTime())) return false;
  return d.getFullYear() === Number(periodo.anio)
      && (d.getMonth() + 1) === Number(periodo.mes);
}

function buildFilename(ruc, periodo, libroCode, oport = 0, est = 1, cont = 1) {
  // LE<RUC><AAAAMM00><LIBRO><OPORT><EST><CONT>11.txt
  const r = pad11(ruc).slice(0, 11);
  const p = periodoSunat(periodo);
  return `LE${r}${p}${libroCode}${oport}${est}${cont}11.txt`;
}

// CUO (Código Único de Operación) — 9 dígitos correlativos por libro+período.
function cuo(idx) {
  return String(idx).padStart(9, '0');
}

// Código de tipo de comprobante de pago (Tabla 10 SUNAT)
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

function tipoCompCode(doc, fallback = '00') {
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

function splitDoc(doc) {
  // 'F001-00012345' → { serie:'F001', nro:'00012345' }
  if (!doc) return { serie: '', nro: '' };
  const s = String(doc).trim();
  const m = s.match(/^([A-Za-z0-9]+)[\s\-\/]+(\d+)$/);
  if (m) return { serie: m[1].toUpperCase(), nro: m[2] };
  return { serie: '', nro: s.replace(/\D+/g, '') || s };
}

// Tipo doc identidad proveedor/cliente (Tabla 2 SUNAT)
function tipoDocIdent(td) {
  const k = String(td || '').toUpperCase();
  if (k === 'RUC')                return '6';
  if (k === 'DNI')                return '1';
  if (k === 'CE' || k === 'CARNET') return '4';
  if (k === 'PAS' || k === 'PASAPORTE') return '7';
  if (!k) return '0';
  return '0';
}

// ─────────────────────────────────────────────────────────────
// 1. LIBRO DIARIO — LE 5.1.0  (código 050100)
// ─────────────────────────────────────────────────────────────
//
// Estructura por línea (campos pipe-delimited):
//  1. Período (AAAAMM00)
//  2. CUO (Código Único Operación) — 9 dígitos
//  3. Correlativo del asiento contable (M+período+nro)
//  4. Código de la cuenta contable (PCGE)
//  5. Código de la unidad de operación (vacío si no aplica)
//  6. Código del centro de costos (vacío si no aplica)
//  7. Tipo de moneda (PEN)
//  8. Tipo de comprobante de pago (Tabla 10)
//  9. Serie del comprobante
// 10. Número del comprobante
// 11. Fecha del comprobante (dd/mm/aaaa)
// 12. Fecha de vencimiento (dd/mm/aaaa)
// 13. Glosa o descripción
// 14. Glosa de referencia
// 15. Debe (con 2 decimales)
// 16. Haber (con 2 decimales)
// 17. Estado de la operación (1=incluida, 8=incluida ajuste, 9=anulada)
// ─────────────────────────────────────────────────────────────
export function generateLibroDiarioPLE(asientos, periodo, ruc) {
  asientos = Array.isArray(asientos) ? asientos : [];
  periodo  = periodo || { anio: new Date().getFullYear(), mes: new Date().getMonth() + 1 };
  const per = periodoSunat(periodo);
  const lines = [];

  let totDebe = 0, totHaber = 0;
  let counter = 0;

  asientos.forEach((a) => {
    if (!a || !isInPeriodo(a.fecha, periodo)) return;
    counter++;
    const c = cuo(counter);
    const correl = `M${pad4(periodo.anio)}${pad2(periodo.mes)}${String(counter).padStart(5, '0')}`;
    const fComp  = fmtFechaSunat(a.fecha);
    const docInfo = splitDoc(a.documento || a.glosa_doc || '');
    const tipoComp = tipoCompCode(a.documento || '', '00');

    (a.partidas || []).forEach((p) => {
      const debe  = r2(p.debe || 0);
      const haber = r2(p.haber || 0);
      totDebe  += debe;
      totHaber += haber;

      lines.push([
        per,
        c,
        correl,
        clean(p.cuenta),
        '',                 // unidad operación
        clean(a.centro_costo || ''),
        'PEN',
        tipoComp,
        docInfo.serie,
        docInfo.nro,
        fComp,
        '',                 // fecha vencimiento
        clean(p.descripcion || a.glosa).slice(0, 200),
        clean(a.glosa).slice(0, 200),
        num(debe),
        num(haber),
        '1',                // estado: 1 = incluida M
      ].join('|'));
    });
  });

  // Línea final descriptiva (algunos validadores la aceptan como comentario)
  // SUNAT estricta espera SOLO líneas de detalle. Si el cuadre falla,
  // se inserta un comentario marcador para QA.
  const diff = r2(totDebe - totHaber);
  if (Math.abs(diff) > 0.05) {
    lines.push(`# WARNING: descuadre Debe (${num(totDebe)}) vs Haber (${num(totHaber)}) — diff ${num(diff)}`);
  }

  return {
    filename: buildFilename(ruc, periodo, '050100', 0, 1, lines.length > 0 ? 1 : 0),
    content : lines.join('\r\n') + (lines.length ? '\r\n' : ''),
    registros: counter,
    totDebe : r2(totDebe),
    totHaber: r2(totHaber),
  };
}

// ─────────────────────────────────────────────────────────────
// 2. LIBRO MAYOR — LE 6.1.0  (código 060100)
// ─────────────────────────────────────────────────────────────
//
// El Libro Mayor agrupa los movimientos por cuenta contable.
// Estructura por línea:
//  1. Período
//  2. CUO
//  3. Correlativo del asiento de origen
//  4. Código cuenta contable (PCGE)
//  5. Saldo deudor / acumulado debe
//  6. Saldo acreedor / acumulado haber
//  7. Estado de la operación (1 = incluida)
// ─────────────────────────────────────────────────────────────
export function generateLibroMayorPLE(asientos, periodo, ruc) {
  asientos = Array.isArray(asientos) ? asientos : [];
  periodo  = periodo || { anio: new Date().getFullYear(), mes: new Date().getMonth() + 1 };
  const per = periodoSunat(periodo);

  // Agrupar por cuenta
  const porCuenta = new Map();
  let counter = 0;
  asientos.forEach((a) => {
    if (!a || !isInPeriodo(a.fecha, periodo)) return;
    counter++;
    (a.partidas || []).forEach((p) => {
      const k = String(p.cuenta || '').trim();
      if (!k) return;
      const cur = porCuenta.get(k) || { debe: 0, haber: 0, count: 0 };
      cur.debe  += Number(p.debe  || 0);
      cur.haber += Number(p.haber || 0);
      cur.count++;
      porCuenta.set(k, cur);
    });
  });

  const lines = [];
  const cuentas = [...porCuenta.keys()].sort();
  cuentas.forEach((cta, i) => {
    const v = porCuenta.get(cta);
    lines.push([
      per,
      cuo(i + 1),
      `M${pad4(periodo.anio)}${pad2(periodo.mes)}${String(i + 1).padStart(5, '0')}`,
      clean(cta),
      num(r2(v.debe)),
      num(r2(v.haber)),
      '1',
    ].join('|'));
  });

  return {
    filename : buildFilename(ruc, periodo, '060100', 0, 1, lines.length > 0 ? 1 : 0),
    content  : lines.join('\r\n') + (lines.length ? '\r\n' : ''),
    registros: cuentas.length,
    asientosOrigen: counter,
  };
}

// ─────────────────────────────────────────────────────────────
// 3. REGISTRO DE COMPRAS — LE 8.1.0  (código 080100)
// ─────────────────────────────────────────────────────────────
//
// Estructura por línea (campos típicos del PLE 8.1):
//  1.  Período (AAAAMM00)
//  2.  CUO
//  3.  Correlativo registro
//  4.  Fecha emisión comprobante (dd/mm/aaaa)
//  5.  Fecha vencimiento o pago (dd/mm/aaaa)
//  6.  Tipo comprobante (Tabla 10)
//  7.  Serie comprobante
//  8.  Año emisión DUA (vacío)
//  9.  Número comprobante
// 10.  Número final (rango)
// 11.  Tipo doc identidad proveedor (Tabla 2)
// 12.  Número doc proveedor
// 13.  Razón social proveedor
// 14.  Base imponible gravada (operaciones gravadas)
// 15.  IGV de operaciones gravadas
// 16.  Base imponible operaciones gravadas / no gravadas (otra)
// 17.  IGV de la anterior
// 18.  Base no gravada (no afecta crédito)
// 19.  IGV no afecta crédito
// 20.  Valor adquisiciones no gravadas
// 21.  ISC
// 22.  Otros tributos
// 23.  Importe total
// 24.  Moneda (PEN/USD)
// 25.  Tipo de cambio
// 26.  Fecha emisión doc referencia
// 27.  Tipo doc referencia
// 28.  Serie doc referencia
// 29.  Número doc referencia
// 30.  Estado (1 = incluida, 9 = anulada)
// ─────────────────────────────────────────────────────────────
export function generateRegistroComprasPLE(movs_cost_expense, periodo, ruc) {
  const movs = Array.isArray(movs_cost_expense) ? movs_cost_expense : [];
  periodo = periodo || { anio: new Date().getFullYear(), mes: new Date().getMonth() + 1 };
  const per = periodoSunat(periodo);
  const lines = [];

  let counter = 0;
  let totBase = 0, totIgv = 0, totImp = 0;

  movs.forEach((m) => {
    if (!m || m.deleted_at) return;
    if (m.payment_status === 'cancelled') return;
    if (!isInPeriodo(m.date || m.created_at, periodo)) return;
    if (m.type !== 'cost' && m.type !== 'expense') return;

    counter++;
    const total    = r2(Number(m.amount || 0));
    let subtotal   = m.subtotal != null  ? Number(m.subtotal)   : null;
    let igv        = m.igv_amount != null ? Number(m.igv_amount) : null;
    // Detección de operaciones no gravadas: si el cliente identifica con DNI
    // (boleta consumidor final) o si igv_amount viene 0 explícito, no asumir 18%
    const noGravado = (m.igv_amount === 0) || (m.tax_exemption_code && m.tax_exemption_code !== '10');
    if (subtotal == null && igv == null) {
      if (noGravado) { subtotal = total; igv = 0; }
      else { subtotal = r2(total / 1.18); igv = r2(total - subtotal); }
    } else if (subtotal == null) {
      subtotal = r2(total - igv);
    } else if (igv == null) {
      igv = r2(total - subtotal);
    }

    totBase += subtotal;
    totIgv  += igv;
    totImp  += total;

    const docInfo  = splitDoc(m.document_number || '');
    const tipoComp = tipoCompCode(m.document_type || '', '01');
    const fEmi     = fmtFechaSunat(m.date || m.created_at);
    const fVcto    = fmtFechaSunat(m.fecha_vencimiento || m.due_date || m.date);

    const provRuc = String(m.third_party_ruc || '');
    const provDocTipo = tipoDocIdent(provRuc.length === 11 ? 'RUC' : 'DNI');
    const provDoc     = clean(provRuc);
    const provName    = clean(m.third_party_name || '').slice(0, 100);

    const moneda = String(m.moneda || 'PEN').toUpperCase();
    const tc     = num(Number(m.tipo_cambio || 0), 3);
    const correl = `M${pad4(periodo.anio)}${pad2(periodo.mes)}${String(counter).padStart(5, '0')}`;
    const estado = m.payment_status === 'cancelled' ? '9' : '1';

    lines.push([
      per,
      cuo(counter),
      correl,
      fEmi,
      fVcto,
      tipoComp,
      docInfo.serie,
      '',                        // año DUA
      docInfo.nro,
      '',                        // nro final rango
      provDocTipo,
      provDoc,
      provName,
      num(subtotal),
      num(igv),
      '0.00',                    // base op. gravada/no gravada
      '0.00',                    // IGV
      '0.00',                    // base no gravada
      '0.00',                    // IGV no afecta crédito
      '0.00',                    // adquisiciones no gravadas
      '0.00',                    // ISC
      '0.00',                    // otros tributos
      num(total),
      moneda,
      tc,
      '',                        // fecha emisión doc ref
      '',                        // tipo doc ref
      '',                        // serie doc ref
      '',                        // nro doc ref
      estado,
    ].join('|'));
  });

  if (counter === 0) {
    console.warn('[PLE compras] sin registros en período', periodo);
  }

  return {
    filename : buildFilename(ruc, periodo, '080100', 0, 1, counter > 0 ? 1 : 0),
    content  : lines.join('\r\n') + (lines.length ? '\r\n' : ''),
    registros: counter,
    totBase  : r2(totBase),
    totIgv   : r2(totIgv),
    totImp   : r2(totImp),
  };
}

// ─────────────────────────────────────────────────────────────
// 4. REGISTRO DE VENTAS — LE 14.1.0  (código 140100)
// ─────────────────────────────────────────────────────────────
//
// Estructura por línea:
//  1. Período
//  2. CUO
//  3. Correlativo
//  4. Fecha emisión
//  5. Fecha vencimiento
//  6. Tipo comprobante
//  7. Serie
//  8. Número
//  9. Número final (rango)
// 10. Tipo doc identidad cliente
// 11. Número doc cliente
// 12. Razón social cliente
// 13. Valor facturado exportación
// 14. Base imponible operación gravada
// 15. Descuentos base imponible
// 16. IGV / IPM
// 17. Descuento IGV/IPM
// 18. Operación exonerada
// 19. Operación inafecta
// 20. ISC
// 21. Base imponible IVAP (arroz pilado)
// 22. IVAP
// 23. Otros tributos
// 24. Importe total
// 25. Moneda
// 26. Tipo de cambio
// 27. Fecha emisión doc referencia
// 28. Tipo doc referencia
// 29. Serie doc referencia
// 30. Número doc referencia
// 31. Estado (1=incluida, 8=ajuste, 9=anulada)
// ─────────────────────────────────────────────────────────────
export function generateRegistroVentasPLE(movs_income, periodo, ruc) {
  const movs = Array.isArray(movs_income) ? movs_income : [];
  periodo = periodo || { anio: new Date().getFullYear(), mes: new Date().getMonth() + 1 };
  const per = periodoSunat(periodo);
  const lines = [];

  let counter = 0;
  let totBase = 0, totIgv = 0, totImp = 0, totExo = 0, totIna = 0;

  movs.forEach((m) => {
    if (!m || m.deleted_at) return;
    if (m.payment_status === 'cancelled') return;
    if (!isInPeriodo(m.date || m.created_at, periodo)) return;
    if (m.type !== 'income') return;

    counter++;
    const total    = r2(Number(m.amount || 0));
    let subtotal   = m.subtotal != null  ? Number(m.subtotal)   : null;
    let igv        = m.igv_amount != null ? Number(m.igv_amount) : null;
    const exonerado = r2(Number(m.exonerado || 0));
    const inafecto  = r2(Number(m.inafecto  || 0));

    if (subtotal == null && igv == null) {
      // si todo es exonerado/inafecto el IGV es 0
      if (exonerado + inafecto >= total - 0.01) {
        subtotal = 0;
        igv      = 0;
      } else {
        subtotal = r2(total / 1.18);
        igv      = r2(total - subtotal);
      }
    } else if (subtotal == null) {
      subtotal = r2(total - igv);
    } else if (igv == null) {
      igv = r2(total - subtotal - exonerado - inafecto);
    }

    totBase += subtotal;
    totIgv  += igv;
    totImp  += total;
    totExo  += exonerado;
    totIna  += inafecto;

    const docInfo  = splitDoc(m.document_number || '');
    const tipoComp = tipoCompCode(m.document_type || '', '01');
    const fEmi     = fmtFechaSunat(m.date || m.created_at);
    const fVcto    = fmtFechaSunat(m.fecha_vencimiento || m.due_date || m.date);

    const cliRuc = String(m.third_party_ruc || '');
    const cliDocTipo = tipoDocIdent(cliRuc.length === 11 ? 'RUC' : 'DNI');
    const cliDoc     = clean(cliRuc);
    const cliName    = clean(m.third_party_name || m.description || '').slice(0, 100);

    const moneda = String(m.currency || m.moneda || 'PEN').toUpperCase();
    const tc     = num(Number(m.tipo_cambio || 0), 3);
    const correl = `M${pad4(periodo.anio)}${pad2(periodo.mes)}${String(counter).padStart(5, '0')}`;
    const estado = m.payment_status === 'cancelled' ? '9' : '1';

    lines.push([
      per,
      cuo(counter),
      correl,
      fEmi,
      fVcto,
      tipoComp,
      docInfo.serie,
      docInfo.nro,
      '',                        // nro final rango
      cliDocTipo,
      cliDoc,
      cliName,
      '0.00',                    // valor facturado exportación
      num(subtotal),
      '0.00',                    // descuentos base
      num(igv),
      '0.00',                    // descuento IGV
      num(exonerado),
      num(inafecto),
      '0.00',                    // ISC
      '0.00',                    // base IVAP
      '0.00',                    // IVAP
      '0.00',                    // otros tributos
      num(total),
      moneda,
      tc,
      '',                        // fecha emisión ref
      '',                        // tipo doc ref
      '',                        // serie doc ref
      '',                        // nro doc ref
      estado,
    ].join('|'));
  });

  if (counter === 0) {
    console.warn('[PLE ventas] sin registros en período', periodo);
  }

  return {
    filename : buildFilename(ruc, periodo, '140100', 0, 1, counter > 0 ? 1 : 0),
    content  : lines.join('\r\n') + (lines.length ? '\r\n' : ''),
    registros: counter,
    totBase  : r2(totBase),
    totIgv   : r2(totIgv),
    totImp   : r2(totImp),
    totExo   : r2(totExo),
    totIna   : r2(totIna),
  };
}

// ─────────────────────────────────────────────────────────────
// 5. Helper de descarga
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
  generateLibroDiarioPLE,
  generateLibroMayorPLE,
  generateRegistroComprasPLE,
  generateRegistroVentasPLE,
  downloadPLE,
};
