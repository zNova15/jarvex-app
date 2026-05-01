// ─────────────────────────────────────────────────────────────
// SUNAT PDT 601 — Generador de archivo de importación
//
// PDT 601 = Planilla Mensual Electrónica (PLAME). Hasta 2014 era
// el PDT independiente; ahora corre dentro de SUNAT Operaciones
// en Línea, pero mantiene el mismo formato txt para importación
// masiva de trabajadores.
//
// Estructura general:
//   - Línea 1 (header)   : RUC|PERIODO|TIPO_DECL|NRO_TRAB
//   - Líneas detalle TR1 : un registro por trabajador (datos + remun.)
//   - Líneas concepto    : código SUNAT por tipo de remuneración
//
// TODO: validar con docs SUNAT — el formato exacto del PDT 601 es
// binario (.dbf) en algunas versiones. Este generador produce txt
// pipe-delimited estilo PLAME que puede ser importado por el módulo
// "PLAME" del SOL o convertido fácilmente.
// ─────────────────────────────────────────────────────────────

// ─── Códigos SUNAT (Tabla 22 de Conceptos remunerativos) ─────
//
// Solo cubrimos los conceptos más comunes. Para una lista completa
// ver Anexo 4 — Tabla 22 de la R.S. 183-2011/SUNAT.
//
const COD_CONCEPTO = {
  // Ingresos
  remuneracion_basica   : '0100',
  asignacion_familiar   : '0201',
  bonificacion          : '0301',
  bonif_construccion    : '0306',  // Construcción civil — BUC
  movilidad             : '0401',
  refrigerio            : '0402',
  horas_extras          : '0801',
  horas_extras_25       : '0801',
  horas_extras_35       : '0802',
  horas_extras_100      : '0803',
  vacaciones            : '0904',
  gratificacion         : '0917',  // Gratificación legal
  gratif_extraordinaria : '0918',
  bonif_extraordinaria  : '0919',  // Ley 29351 — 9% gratif.
  cts                   : '2001',
  utilidades            : '0907',

  // Descuentos
  desc_onp              : '0605',
  desc_afp_aporte       : '0606',
  desc_afp_comision     : '0607',
  desc_afp_seguro       : '0608',
  desc_renta_5ta        : '0610',
  desc_judicial         : '0612',
  desc_adelanto         : '0613',
  desc_otros            : '0699',

  // Aportes empleador
  aporte_essalud        : '0700',
  aporte_sctr           : '0701',
  aporte_senati         : '0703',
  aporte_essalud_vida   : '0702',
};

export function getCodigoConcepto(tipo) {
  if (!tipo) return '0699';
  const k = String(tipo).toLowerCase().replace(/\s+/g, '_');
  return COD_CONCEPTO[k] || '0699';
}

// Tipo de declaración: 0=Original, 1=Sustitutoria, 2=Rectificatoria
export const TIPO_DECL = { ORIGINAL: '0', SUSTITUTORIA: '1', RECTIFICATORIA: '2' };

// ─── Helpers ─────────────────────────────────────────────────
function pad2(n)  { return String(n || 0).padStart(2, '0'); }
function pad4(n)  { return String(n || 0).padStart(4, '0'); }
function clean(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[\|\r\n\t]/g, ' ').trim();
}
function safe(x, fb = '') {
  return (x === null || x === undefined || x === '') ? fb : x;
}

/**
 * formatMontoSUNAT — algunos campos del PDT 601 piden enteros
 * (sin decimales, en céntimos), otros piden 2 decimales con punto.
 * Esta helper centraliza ambos formatos.
 *
 * @param {number} n
 * @param {object} opts
 *   - opts.cents   : true → devuelve entero en céntimos ("12345" = 123.45)
 *   - opts.decimals: número de decimales (default 2)
 */
export function formatMontoSUNAT(n, opts = {}) {
  const v = Number(n);
  if (!isFinite(v)) return opts.cents ? '0' : '0.00';
  if (opts.cents) return String(Math.round(v * 100));
  const d = opts.decimals != null ? opts.decimals : 2;
  return v.toFixed(d);
}

function fmtFechaSunat(d) {
  if (!d) return '';
  try {
    const date = (d instanceof Date) ? d : new Date(d);
    if (isNaN(date.getTime())) return '';
    return `${pad2(date.getDate())}${pad2(date.getMonth() + 1)}${date.getFullYear()}`;
  } catch (_) { return ''; }
}

function tipoDocCode(td) {
  const k = String(td || 'DNI').toUpperCase();
  if (k === 'DNI') return '01';
  if (k === 'CE')  return '04';
  if (k === 'PAS') return '07';
  if (k === 'RUC') return '06';
  return '01';
}

function regimenLaboralCode(reg) {
  const k = String(reg || 'general').toLowerCase();
  if (k.includes('construc')) return '20';
  if (k.includes('agrar'))    return '13';
  if (k.includes('micro'))    return '32';
  if (k.includes('pequen'))   return '33';
  return '10';
}

function regimenPensionCode(rp) {
  const k = String(rp || '').toUpperCase();
  if (k === 'AFP') return '21';
  if (k === 'ONP') return '01';
  return '99';
}

function findContrato(contratos, personal_id) {
  const list = (contratos || []).filter(c => c && !c.deleted_at && c.personal_id === personal_id);
  const vig  = list.find(c => c.estado === 'vigente');
  if (vig) return vig;
  return list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0] || null;
}

function findPersona(personal, personal_id) {
  return (personal || []).find(p => p && p.id === personal_id) || null;
}

// ─────────────────────────────────────────────────────────────
// Generador principal
// ─────────────────────────────────────────────────────────────
//
// @returns string txt formato PDT 601
export function generatePDT601(planilla, boletas, contratos, personal, company, opts = {}) {
  planilla  = planilla  || {};
  boletas   = Array.isArray(boletas)   ? boletas   : [];
  contratos = Array.isArray(contratos) ? contratos : [];
  personal  = Array.isArray(personal)  ? personal  : [];
  company   = company   || {};

  const tipoDecl = opts.tipo_declaracion || TIPO_DECL.ORIGINAL;
  const periodoStr = `${pad4(planilla.periodo_anio)}${pad2(planilla.periodo_mes)}`;

  const validBoletas = boletas.filter(b => b && !b.deleted_at && Number(b.neto_pagar || 0) > 0);

  const lines = [];

  // ─── Header (línea 1) ──────────────────────────────────────
  // PDT|RUC|PERIODO|TIPO_DECL|NRO_TRAB
  lines.push([
    'PDT601',
    safe(company.ruc, ''),
    periodoStr,
    tipoDecl,
    String(validBoletas.length),
  ].join('|'));

  let warnings = 0;
  let totalRem = 0, totalDesc = 0, totalNeto = 0, totalEss = 0;

  validBoletas.forEach((b, idx) => {
    const persona  = findPersona(personal, b.personal_id) || {};
    const contrato = findContrato(contratos, b.personal_id) || {};

    const apellidos = String(b.apellidos || persona.apellidos || '').trim();
    const apePat = String(persona.apellido_paterno || apellidos.split(' ')[0] || '').trim();
    const apeMat = String(persona.apellido_materno || apellidos.split(' ').slice(1).join(' ') || '').trim();

    const tipoPension = String(contrato.tipo_pension || contrato.regimen_pension || '').toUpperCase();
    const totalIngresos = Number(b.total_ingresos || 0);

    if (totalIngresos <= 0) {
      console.warn('[PDT601] boleta sin ingresos:', b.id);
      warnings++;
      return;
    }

    // ── TR1 = registro de trabajador ──
    // TR1|NRO|TIPO_DOC|NRO_DOC|APE_PAT|APE_MAT|NOMBRES|F_NAC|SEXO|NACION|F_INGRESO|REG_LAB|REG_PENS|CUSPP|DIAS|JORNADA
    lines.push([
      'TR1',
      String(idx + 1).padStart(5, '0'),
      tipoDocCode(persona.tipo_documento || 'DNI'),
      clean(b.dni || persona.dni || ''),
      clean(apePat),
      clean(apeMat),
      clean(b.nombres || persona.nombres || ''),
      fmtFechaSunat(persona.fecha_nacimiento),
      String(persona.sexo || 'M').toUpperCase().charAt(0),
      clean(persona.nacionalidad || 'PE'),
      fmtFechaSunat(contrato.fecha_inicio || persona.fecha_ingreso),
      regimenLaboralCode(contrato.regimen_laboral || persona.regimen_laboral),
      regimenPensionCode(tipoPension),
      clean(contrato.cuspp || ''),
      String(b.dias_trabajados || 30),
      '01',                                   // jornada completa  // TODO: validar con docs SUNAT
    ].join('|'));

    // ── Conceptos: ingresos ──
    const pushConcepto = (cod, monto, descripcion = '') => {
      const v = Number(monto || 0);
      if (!isFinite(v) || v === 0) return;
      lines.push([
        'CON',
        String(idx + 1).padStart(5, '0'),
        cod,
        formatMontoSUNAT(v, { decimals: 2 }),
        clean(descripcion).slice(0, 60),
      ].join('|'));
    };

    pushConcepto(COD_CONCEPTO.remuneracion_basica, b.remuneracion_basica || b.sueldo_basico, 'Remuneración básica');
    pushConcepto(COD_CONCEPTO.asignacion_familiar, b.asignacion_familiar, 'Asignación familiar');
    pushConcepto(COD_CONCEPTO.bonificacion,        b.bonificaciones,      'Bonificaciones');
    pushConcepto(COD_CONCEPTO.horas_extras,        b.monto_horas_extras,  'Horas extras');
    pushConcepto(COD_CONCEPTO.gratificacion,       b.gratificacion,       'Gratificación');
    pushConcepto(COD_CONCEPTO.cts,                 b.cts,                 'CTS');
    pushConcepto(COD_CONCEPTO.movilidad,           b.movilidad,           'Movilidad');

    // ── Conceptos: descuentos (AFP descompuesto) ──
    let afpFondo = 0, afpComis = 0, afpSeg = 0, onp = 0;
    if (tipoPension === 'AFP') {
      const pFondo = Number(contrato.afp_pct_aporte_obligatorio ?? 10) / 100;
      const pComis = Number(contrato.afp_pct_comision           ?? 1.55) / 100;
      const pSeg   = Number(contrato.afp_pct_seguro             ?? 1.49) / 100;
      const totalAfpProporcional = Number(b.descuento_afp_onp || 0);
      if (totalAfpProporcional > 0) {
        const sumP = pFondo + pComis + pSeg;
        afpFondo = totalAfpProporcional * (pFondo / sumP);
        afpComis = totalAfpProporcional * (pComis / sumP);
        afpSeg   = totalAfpProporcional * (pSeg   / sumP);
      } else {
        afpFondo = totalIngresos * pFondo;
        afpComis = totalIngresos * pComis;
        afpSeg   = totalIngresos * pSeg;
      }
    } else if (tipoPension === 'ONP') {
      onp = Number(b.descuento_afp_onp || (totalIngresos * 0.13));
    }

    pushConcepto(COD_CONCEPTO.desc_afp_aporte,  afpFondo, 'AFP - Aporte obligatorio');
    pushConcepto(COD_CONCEPTO.desc_afp_comision, afpComis, 'AFP - Comisión');
    pushConcepto(COD_CONCEPTO.desc_afp_seguro,  afpSeg,   'AFP - Seguro');
    pushConcepto(COD_CONCEPTO.desc_onp,         onp,      'ONP');
    pushConcepto(COD_CONCEPTO.desc_renta_5ta,   b.descuento_ir_5ta, 'IR 5ta categoría');
    pushConcepto(COD_CONCEPTO.desc_otros,       b.descuento_otros,  'Otros descuentos');

    // ── Aportes empleador ──
    const essalud = Number(b.essalud_empleador || (totalIngresos * 0.09));
    pushConcepto(COD_CONCEPTO.aporte_essalud, essalud, 'EsSalud (9%)');

    if (contrato.regimen_laboral && /construc/i.test(contrato.regimen_laboral)) {
      // SCTR obligatorio en construcción civil
      // TODO: validar con docs SUNAT — porcentaje variable según tarifario
      const sctr = Number(b.sctr || (totalIngresos * 0.0163));
      pushConcepto(COD_CONCEPTO.aporte_sctr, sctr, 'SCTR');
    }

    totalRem  += totalIngresos;
    totalDesc += Number(b.total_descuentos || 0);
    totalNeto += Number(b.neto_pagar || 0);
    totalEss  += essalud;
  });

  // ─── Línea final TOT ───────────────────────────────────────
  lines.push([
    'TOT',
    String(validBoletas.length),
    formatMontoSUNAT(totalRem),
    formatMontoSUNAT(totalDesc),
    formatMontoSUNAT(totalNeto),
    formatMontoSUNAT(totalEss),
  ].join('|'));

  // Warnings de validación
  if (warnings > 0) {
    lines.push(`# WARNING: ${warnings} boleta(s) excluidas (sin ingresos).`);
  }
  const expectedNeto = totalRem - totalDesc;
  if (Math.abs(expectedNeto - totalNeto) > 0.05) {
    lines.push(`# WARNING: descuadre Neto declarado=${formatMontoSUNAT(totalNeto)} vs calculado=${formatMontoSUNAT(expectedNeto)}.`);
  }

  return lines.join('\r\n') + '\r\n';
}

export function buildPDT601Filename(ruc, periodo) {
  return `PDT601_${String(ruc || '').padStart(11, '0')}_${pad4(periodo.anio)}${pad2(periodo.mes)}.txt`;
}

export default {
  generatePDT601,
  getCodigoConcepto,
  formatMontoSUNAT,
  buildPDT601Filename,
  TIPO_DECL,
};
