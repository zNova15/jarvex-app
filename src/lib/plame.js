// ─────────────────────────────────────────────────────────────
// PLAME (Planilla Mensual Electrónica) y T-Registro SUNAT
// Genera txt pipe-delimited compatible con PDT 601 SUNAT
// y boletas PDF individuales por trabajador.
// ─────────────────────────────────────────────────────────────
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ─── Helpers ─────────────────────────────────────────────────
const COLOR_DARK = [14, 22, 32];
const COLOR_GOLD = [242, 183, 5];
const COLOR_HEAD = [28, 45, 64];
const COLOR_ALT = [248, 248, 248];
const COLOR_MUTED = [128, 128, 128];

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre'];

// Códigos SUNAT estándar
const COD_TIPO_DOC = {
  DNI: '01',
  CE: '04',
  PAS: '07',
  RUC: '06',
};
const COD_REGIMEN_LABORAL = {
  general: '10',           // Régimen Laboral General (Ley 728)
  construccion: '20',      // Construcción Civil
  agrario: '13',
  micro: '32',
  pequena: '33',
};
const COD_REGIMEN_PENSIONARIO = {
  ONP: '01',
  AFP: '21', // genérico AFP
  SIN: '99',
};
const COD_TIPO_AFP = {
  HABITAT: '01',
  INTEGRA: '02',
  PRIMA: '03',
  PROFUTURO: '04',
  SIN: '00',
};

function pad2(n) { return String(n || 0).padStart(2, '0'); }
function pad4(n) { return String(n || 0).padStart(4, '0'); }
function clean(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[\|\r\n]/g, ' ').trim();
}
function num(n, dec = 2) {
  const v = Number(n);
  if (!isFinite(v)) return (0).toFixed(dec);
  return v.toFixed(dec);
}
function fmtS(n) {
  const v = Number(n);
  if (!isFinite(v)) return 'S/ 0.00';
  return 'S/ ' + v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtFecha(d) {
  if (!d) return '';
  try {
    const date = (d instanceof Date) ? d : new Date(d);
    if (isNaN(date.getTime())) return '';
    return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
  } catch (_) { return ''; }
}
function fmtFechaSunat(d) {
  // SUNAT pide ddmmaaaa
  if (!d) return '';
  try {
    const date = (d instanceof Date) ? d : new Date(d);
    if (isNaN(date.getTime())) return '';
    return `${pad2(date.getDate())}${pad2(date.getMonth() + 1)}${date.getFullYear()}`;
  } catch (_) { return ''; }
}
function safe(x, fb = '') {
  return (x === null || x === undefined || x === '') ? fb : x;
}

function findContrato(contratos, personal_id) {
  const list = (contratos || []).filter(c => c && !c.deleted_at && c.personal_id === personal_id);
  // preferir vigente, sino el más reciente
  const vig = list.find(c => c.estado === 'vigente');
  if (vig) return vig;
  return list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0] || null;
}

function findPersona(personal, personal_id) {
  return (personal || []).find(p => p && p.id === personal_id) || null;
}

function tipoDocCode(td) {
  const k = String(td || 'DNI').toUpperCase();
  return COD_TIPO_DOC[k] || '01';
}

function regimenLaboralCode(reg) {
  const k = String(reg || 'general').toLowerCase();
  if (k.includes('construc')) return COD_REGIMEN_LABORAL.construccion;
  if (k.includes('agrar')) return COD_REGIMEN_LABORAL.agrario;
  if (k.includes('micro')) return COD_REGIMEN_LABORAL.micro;
  if (k.includes('pequen') || k.includes('peque')) return COD_REGIMEN_LABORAL.pequena;
  return COD_REGIMEN_LABORAL.general;
}

function regimenPensionCode(rp) {
  const k = String(rp || '').toUpperCase();
  if (k === 'AFP') return COD_REGIMEN_PENSIONARIO.AFP;
  if (k === 'ONP') return COD_REGIMEN_PENSIONARIO.ONP;
  return COD_REGIMEN_PENSIONARIO.SIN;
}

function tipoAfpCode(afp) {
  const k = String(afp || '').toUpperCase().replace(/\s+/g, '');
  return COD_TIPO_AFP[k] || COD_TIPO_AFP.SIN;
}

// ─────────────────────────────────────────────────────────────
// 1. Generar PLAME .txt (pipe delimited)
// ─────────────────────────────────────────────────────────────
export function generatePLAMETxt(planilla, boletas, contratos, personal, company) {
  planilla = planilla || {};
  boletas = Array.isArray(boletas) ? boletas : [];
  contratos = Array.isArray(contratos) ? contratos : [];
  personal = Array.isArray(personal) ? personal : [];
  company = company || {};

  const lines = [];
  // Header informativo (no-SUNAT, sólo referencia humana). PDT real espera
  // sólo registros de detalle, pero mantenemos un header comentado para QA.
  // SUNAT real: una línea por trabajador con el separador | exacto.
  // Header descriptivo (línea 1) — algunos integradores la consumen, otros la ignoran.
  lines.push([
    '#PLAME',
    safe(company.ruc, ''),
    pad2(planilla.periodo_mes),
    String(planilla.periodo_anio || ''),
    'TRAB|TIPO_DOC|NRO_DOC|APE_PAT|APE_MAT|NOMBRES|REGIMEN|JORNADA|DIAS_LAB|REM_BAS|ASIG_FAM|BONIF|H_EXT|TOT_INGR|AFP_FONDO|AFP_COMIS|AFP_SEG|ONP|IR_5TA|TOT_DESC|NETO|ESSALUD',
  ].join('|'));

  let count = 0;
  for (const b of boletas) {
    if (!b) continue;
    const neto = Number(b.neto_pagar || 0);
    if (neto <= 0) {
      console.warn('[plame] boleta excluida (neto<=0):', b.id, b.dni);
      continue;
    }
    const persona = findPersona(personal, b.personal_id) || {};
    const contrato = findContrato(contratos, b.personal_id) || {};
    const totalIngresos = Number(b.total_ingresos || 0);
    if (!totalIngresos) {
      console.warn('[plame] boleta excluida (sin ingresos):', b.id);
      continue;
    }

    // Descomposición AFP
    let afpFondo = 0, afpComis = 0, afpSeg = 0, onp = 0;
    const tipoPension = String(contrato.tipo_pension || contrato.regimen_pension || '').toUpperCase();
    if (tipoPension === 'AFP') {
      const pFondo = Number(contrato.afp_pct_aporte_obligatorio ?? contrato.afp_fondo_pct ?? 10) / 100;
      const pComis = Number(contrato.afp_pct_comision ?? contrato.afp_comision_pct ?? 1.55) / 100;
      const pSeg = Number(contrato.afp_pct_seguro ?? contrato.afp_seguro_pct ?? 1.49) / 100;
      afpFondo = totalIngresos * pFondo;
      afpComis = totalIngresos * pComis;
      afpSeg = totalIngresos * pSeg;
    } else if (tipoPension === 'ONP') {
      onp = Number(b.descuento_afp_onp || (totalIngresos * 0.13));
    }

    const essalud = Number(b.essalud_empleador || (totalIngresos * 0.09));

    const apellidos = String(b.apellidos || persona.apellidos || '').trim();
    const apePat = String(persona.apellido_paterno || apellidos.split(' ')[0] || '').trim();
    const apeMat = String(persona.apellido_materno || apellidos.split(' ').slice(1).join(' ') || '').trim();

    const row = [
      'TRAB',
      tipoDocCode(persona.tipo_documento || 'DNI'),
      clean(b.dni || persona.dni || ''),
      clean(apePat),
      clean(apeMat),
      clean(b.nombres || persona.nombres || ''),
      regimenLaboralCode(contrato.regimen_laboral || persona.regimen_laboral),
      '01', // jornada completa
      String(b.dias_trabajados || 30),
      num(b.remuneracion_basica || 0),
      num(b.asignacion_familiar || 0),
      num(b.bonificaciones || 0),
      num(b.monto_horas_extras || 0),
      num(totalIngresos),
      num(afpFondo),
      num(afpComis),
      num(afpSeg),
      num(onp),
      num(b.descuento_ir_5ta || 0),
      num(b.total_descuentos || 0),
      num(neto),
      num(essalud),
    ].join('|');

    lines.push(row);
    count++;
  }

  if (count === 0) {
    console.warn('[plame] no hay boletas válidas');
  }
  return lines.join('\r\n') + '\r\n';
}

// ─────────────────────────────────────────────────────────────
// 2. Generar T-Registro Alta .txt
// ─────────────────────────────────────────────────────────────
export function generateTRegistroAltaTxt(personal, contratos, company) {
  personal = Array.isArray(personal) ? personal : [];
  contratos = Array.isArray(contratos) ? contratos : [];
  company = company || {};

  const lines = [];
  lines.push([
    '#TREG',
    safe(company.ruc, ''),
    'TIPO_TRAB|TIPO_DOC|NRO_DOC|APE_PAT|APE_MAT|NOMBRES|F_NAC|SEXO|NACION|F_INGRESO|REG_PENS|TIPO_AFP|CUSPP|REG_LAB|OCUPACION|F_FIN',
  ].join('|'));

  for (const p of personal) {
    if (!p || p.deleted_at) continue;
    if (p.estado && p.estado !== 'activo') continue;
    const c = findContrato(contratos, p.id) || {};
    const apellidos = String(p.apellidos || '').trim();
    const apePat = String(p.apellido_paterno || apellidos.split(' ')[0] || '').trim();
    const apeMat = String(p.apellido_materno || apellidos.split(' ').slice(1).join(' ') || '').trim();

    const row = [
      'TRAB', // tipo trabajador
      tipoDocCode(p.tipo_documento || 'DNI'),
      clean(p.dni || ''),
      clean(apePat),
      clean(apeMat),
      clean(p.nombres || ''),
      fmtFechaSunat(p.fecha_nacimiento),
      String(p.sexo || 'M').toUpperCase().charAt(0),
      clean(p.nacionalidad || 'PE'),
      fmtFechaSunat(c.fecha_inicio || p.fecha_ingreso),
      regimenPensionCode(c.tipo_pension || c.regimen_pension),
      tipoAfpCode(c.afp_nombre || c.afp),
      clean(c.cuspp || ''),
      regimenLaboralCode(c.regimen_laboral || p.regimen_laboral),
      clean(p.cargo || c.cargo || ''),
      fmtFechaSunat(c.fecha_fin),
    ].join('|');
    lines.push(row);
  }

  return lines.join('\r\n') + '\r\n';
}

// ─────────────────────────────────────────────────────────────
// 3. Helper: download txt file via blob+anchor
// ─────────────────────────────────────────────────────────────
export function downloadTxt(filename, content) {
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
    console.error('[downloadTxt]', e);
  }
}

// ─────────────────────────────────────────────────────────────
// 4. Generar Boletas PDF (1 trabajador por página)
// ─────────────────────────────────────────────────────────────
export function generateBoletasPDF(planilla, boletas, personal, company, obra, contratos) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = 210;
  const pageHeight = 297;

  planilla = planilla || {};
  boletas = Array.isArray(boletas) ? boletas : [];
  personal = Array.isArray(personal) ? personal : [];
  contratos = Array.isArray(contratos) ? contratos : [];
  company = company || {};
  obra = obra || {};

  const mesIdx = Math.max(0, Math.min(11, (planilla.periodo_mes || 1) - 1));
  const periodo = `${MESES[mesIdx]} ${planilla.periodo_anio || ''}`.trim();
  const validBoletas = boletas.filter(b => b && Number(b.neto_pagar || 0) > 0);

  if (validBoletas.length === 0) {
    console.warn('[boletasPDF] no hay boletas válidas');
    doc.setFontSize(12);
    doc.text('No hay boletas para imprimir.', 20, 30);
    doc.save(`Boletas_vacio.pdf`);
    return doc;
  }

  validBoletas.forEach((b, idx) => {
    if (idx > 0) doc.addPage();
    const persona = findPersona(personal, b.personal_id) || {};

    // Cabecera oscura
    doc.setFillColor(...COLOR_DARK);
    doc.rect(0, 0, pageWidth, 28, 'F');
    doc.setTextColor(...COLOR_GOLD);
    doc.setFontSize(15);
    doc.setFont('helvetica', 'bold');
    doc.text('JARVEX', 14, 12);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(safe(company.legal_name || company.name, '—'), 14, 17);
    if (company.ruc) doc.text(`RUC: ${company.ruc}`, 14, 21);
    if (company.address) doc.text(String(company.address), 14, 25);

    doc.setTextColor(...COLOR_GOLD);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('BOLETA DE PAGO', pageWidth - 14, 13, { align: 'right' });
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(255, 255, 255);
    doc.text(`Periodo: ${periodo}`, pageWidth - 14, 19, { align: 'right' });
    if (obra.nombre) doc.text(`Obra: ${String(obra.nombre).substring(0, 40)}`, pageWidth - 14, 24, { align: 'right' });

    doc.setTextColor(0, 0, 0);

    // Datos trabajador
    let y = 36;
    doc.setDrawColor(200, 200, 200);
    doc.setFillColor(250, 250, 250);
    doc.rect(14, y, pageWidth - 28, 24, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...COLOR_HEAD);
    doc.text('DATOS DEL TRABAJADOR', 16, y + 4.5);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);

    const contrato = findContrato(contratos, b.personal_id) || {};
    const apellidos = b.apellidos || persona.apellidos || '';
    const nombres = b.nombres || persona.nombres || '';
    const cargo = b.cargo || persona.cargo || '—';
    const dni = b.dni || persona.dni || '—';
    const tipoPension = String(contrato.tipo_pension || contrato.regimen_pension || '').toUpperCase();

    const col1x = 16, col2x = 110;
    let ly = y + 9;
    doc.setFont('helvetica', 'bold');
    doc.text('Nombre:', col1x, ly);
    doc.setFont('helvetica', 'normal');
    doc.text(`${apellidos}, ${nombres}`, col1x + 18, ly);

    doc.setFont('helvetica', 'bold');
    doc.text('DNI:', col2x, ly);
    doc.setFont('helvetica', 'normal');
    doc.text(String(dni), col2x + 12, ly);

    ly += 4.5;
    doc.setFont('helvetica', 'bold');
    doc.text('Cargo:', col1x, ly);
    doc.setFont('helvetica', 'normal');
    doc.text(String(cargo), col1x + 18, ly);

    doc.setFont('helvetica', 'bold');
    doc.text('Días lab.:', col2x, ly);
    doc.setFont('helvetica', 'normal');
    doc.text(String(b.dias_trabajados || 30), col2x + 22, ly);

    ly += 4.5;
    doc.setFont('helvetica', 'bold');
    doc.text('Sueldo Básico:', col1x, ly);
    doc.setFont('helvetica', 'normal');
    doc.text(fmtS(b.sueldo_basico || 0), col1x + 28, ly);

    doc.setFont('helvetica', 'bold');
    doc.text('Régimen Pensión:', col2x, ly);
    doc.setFont('helvetica', 'normal');
    doc.text(tipoPension || '—', col2x + 32, ly);

    // Tabla de Ingresos
    y += 28;
    autoTable(doc, {
      startY: y,
      head: [['INGRESOS', 'Monto']],
      body: [
        ['Remuneración Básica', fmtS(b.remuneracion_basica || 0)],
        ['Asignación Familiar', fmtS(b.asignacion_familiar || 0)],
        ['Bonificaciones', fmtS(b.bonificaciones || 0)],
        ['Horas Extras', fmtS(b.monto_horas_extras || 0)],
      ],
      foot: [['TOTAL INGRESOS', fmtS(b.total_ingresos || 0)]],
      headStyles: { fillColor: COLOR_HEAD, textColor: 255, fontSize: 9 },
      footStyles: { fillColor: [235, 240, 245], textColor: 0, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      alternateRowStyles: { fillColor: COLOR_ALT },
      columnStyles: {
        0: { cellWidth: 110 },
        1: { cellWidth: 'auto', halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    });

    // Tabla de Descuentos
    let yDesc = doc.lastAutoTable.finalY + 4;

    // calcular descomposición AFP/ONP para mostrar
    const totalIngresos = Number(b.total_ingresos || 0);
    let descRows = [];
    if (tipoPension === 'AFP') {
      // estimación con porcentajes estándar si no hay desglose en la boleta
      const pFondo = 10 / 100;
      const pComis = 1.55 / 100;
      const pSeg = 1.49 / 100;
      // si la boleta tiene `descuento_afp_onp` único, partimos proporcional
      const totalAfp = Number(b.descuento_afp_onp || (totalIngresos * (pFondo + pComis + pSeg)));
      const sumaP = pFondo + pComis + pSeg;
      const fondo = totalAfp * (pFondo / sumaP);
      const comis = totalAfp * (pComis / sumaP);
      const seguro = totalAfp * (pSeg / sumaP);
      descRows.push(['AFP - Aporte Obligatorio (10%)', fmtS(fondo)]);
      descRows.push(['AFP - Comisión', fmtS(comis)]);
      descRows.push(['AFP - Prima de Seguro', fmtS(seguro)]);
    } else if (tipoPension === 'ONP') {
      descRows.push(['ONP (13%)', fmtS(b.descuento_afp_onp || 0)]);
    } else {
      descRows.push(['Descuento Pensión', fmtS(b.descuento_afp_onp || 0)]);
    }
    descRows.push(['Impuesto Renta 5ta', fmtS(b.descuento_ir_5ta || 0)]);
    descRows.push(['Otros descuentos', fmtS(b.descuento_otros || 0)]);

    autoTable(doc, {
      startY: yDesc,
      head: [['DESCUENTOS', 'Monto']],
      body: descRows,
      foot: [['TOTAL DESCUENTOS', fmtS(b.total_descuentos || 0)]],
      headStyles: { fillColor: [120, 30, 30], textColor: 255, fontSize: 9 },
      footStyles: { fillColor: [245, 230, 230], textColor: 0, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      alternateRowStyles: { fillColor: COLOR_ALT },
      columnStyles: {
        0: { cellWidth: 110 },
        1: { cellWidth: 'auto', halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    });

    // Neto a pagar — caja resaltada
    let yNeto = doc.lastAutoTable.finalY + 6;
    doc.setFillColor(...COLOR_HEAD);
    doc.rect(14, yNeto, pageWidth - 28, 12, 'F');
    doc.setTextColor(...COLOR_GOLD);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('NETO A PAGAR', 18, yNeto + 8);
    doc.text(fmtS(b.neto_pagar || 0), pageWidth - 18, yNeto + 8, { align: 'right' });
    doc.setTextColor(0, 0, 0);

    // Aporte empleador EsSalud
    let yEss = yNeto + 18;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLOR_MUTED);
    doc.text(`Aporte Empleador EsSalud (9%): ${fmtS(b.essalud_empleador || (totalIngresos * 0.09))}`, 14, yEss);
    doc.setTextColor(0, 0, 0);

    // Firmas
    let yFirm = Math.max(yEss + 30, pageHeight - 50);
    doc.setDrawColor(120, 120, 120);
    doc.line(30, yFirm, 90, yFirm);
    doc.line(120, yFirm, 180, yFirm);
    doc.setFontSize(8);
    doc.setTextColor(...COLOR_MUTED);
    doc.text('Empleador', 60, yFirm + 4, { align: 'center' });
    doc.text('Trabajador', 150, yFirm + 4, { align: 'center' });

    // Footer
    doc.setFontSize(7);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(`Boleta ${periodo} — ${apellidos}, ${nombres} — Generado ${fmtFecha(new Date())}`, 14, pageHeight - 8);
    doc.text(`Página ${idx + 1} de ${validBoletas.length}`, pageWidth - 14, pageHeight - 8, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  });

  const filename = `Boletas_${pad4(planilla.periodo_anio)}_${pad2(planilla.periodo_mes)}.pdf`;
  doc.save(filename);
  return doc;
}

export default {
  generatePLAMETxt,
  generateTRegistroAltaTxt,
  downloadTxt,
  generateBoletasPDF,
};
