import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const COLOR_DARK = [14, 22, 32];
const COLOR_GOLD = [242, 183, 5];
const COLOR_HEAD = [28, 45, 64];
const COLOR_ALT = [248, 248, 248];
const COLOR_MUTED = [128, 128, 128];

function fmtS(n) {
  const v = Number(n);
  if (!isFinite(v)) return 'S/ 0.00';
  return 'S/ ' + v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '';
  try {
    const date = (d instanceof Date) ? d : new Date(d);
    if (isNaN(date.getTime())) return String(d);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  } catch (_) {
    return String(d);
  }
}

function fmtNum(n, dec = 2) {
  const v = Number(n);
  if (!isFinite(v)) return '0.00';
  return v.toLocaleString('es-PE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtPct(n) {
  const v = Number(n);
  if (!isFinite(v)) return '0.00%';
  return v.toFixed(2) + '%';
}

function safe(x, fallback = '') {
  return (x === null || x === undefined || x === '') ? fallback : x;
}

// ─── Estilo común ────────────────────────────────────────────
function drawHeader(doc, { company, title, subtitle, pageWidth = 210 }) {
  // Banda oscura
  doc.setFillColor(...COLOR_DARK);
  doc.rect(0, 0, pageWidth, 28, 'F');

  // Marca JARVEX
  doc.setTextColor(...COLOR_GOLD);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('JARVEX', 14, 12);

  // Empresa emisora
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  const companyName = safe(company?.name || company?.legal_name, 'Tecnología, Ingeniería y Proyectos E.I.R.L.');
  doc.text(companyName, 14, 17);
  if (company?.legal_name && company?.name && company.legal_name !== company.name) {
    doc.text(String(company.legal_name), 14, 21);
  }
  if (company?.ruc) {
    doc.text(`RUC: ${company.ruc}`, 14, 25);
  }

  // Título a la derecha
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLOR_GOLD);
  doc.text(String(title || ''), pageWidth - 14, 13, { align: 'right' });
  if (subtitle) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(255, 255, 255);
    doc.text(String(subtitle), pageWidth - 14, 19, { align: 'right' });
  }
  doc.setFontSize(8);
  doc.setTextColor(220, 220, 220);
  doc.text(`Generado: ${new Date().toLocaleString('es-PE')}`, pageWidth - 14, 25, { align: 'right' });

  doc.setTextColor(0, 0, 0);
}

function drawFooter(doc, footerText) {
  const pageCount = doc.internal.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...COLOR_MUTED);
    doc.setFont('helvetica', 'normal');
    if (footerText) {
      doc.text(String(footerText), 14, pageHeight - 8);
    }
    doc.text(`Página ${i} de ${pageCount}`, pageWidth - 14, pageHeight - 8, { align: 'right' });
  }
  doc.setTextColor(0, 0, 0);
}

function infoBox(doc, x, y, width, height, title, lines) {
  doc.setDrawColor(200, 200, 200);
  doc.setFillColor(250, 250, 250);
  doc.rect(x, y, width, height, 'FD');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLOR_HEAD);
  doc.text(String(title), x + 2, y + 4.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(8);
  let ly = y + 9;
  (lines || []).forEach((ln) => {
    if (ln === null || ln === undefined) return;
    doc.text(String(ln), x + 2, ly);
    ly += 4;
  });
}

// ─────────────────────────────────────────────────────────────
// 1. Orden de Compra
// ─────────────────────────────────────────────────────────────
export function generateOCPdf(oc, items, proveedor, obra, company) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = 210;
  oc = oc || {};
  items = Array.isArray(items) ? items : [];
  proveedor = proveedor || {};
  obra = obra || {};
  company = company || {};

  drawHeader(doc, {
    company,
    title: 'ORDEN DE COMPRA',
    subtitle: oc.codigo ? `N° ${oc.codigo}` : '',
    pageWidth,
  });

  // Datos emisor (izq) / proveedor (der)
  const yBox = 34;
  infoBox(doc, 14, yBox, 90, 30, 'EMISOR', [
    safe(company.legal_name || company.name, '—'),
    company.ruc ? `RUC: ${company.ruc}` : null,
    company.address ? String(company.address) : null,
    company.phone ? `Tel: ${company.phone}` : null,
  ]);
  infoBox(doc, 106, yBox, 90, 30, 'PROVEEDOR', [
    safe(proveedor.razon_social || proveedor.nombre, '—'),
    proveedor.ruc ? `RUC: ${proveedor.ruc}` : null,
    proveedor.direccion ? String(proveedor.direccion) : null,
    proveedor.contacto || proveedor.telefono ? `Contacto: ${safe(proveedor.contacto, '')} ${safe(proveedor.telefono, '')}`.trim() : null,
  ]);

  // Meta
  let y = yBox + 34;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Obra:', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.text(safe(obra.nombre || obra.codigo, '—'), 30, y);

  doc.setFont('helvetica', 'bold');
  doc.text('Fecha:', 110, y);
  doc.setFont('helvetica', 'normal');
  doc.text(fmtDate(oc.fecha || oc.created_at), 125, y);

  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text('Cond. Pago:', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.text(safe(oc.condicion_pago, '—'), 38, y);

  doc.setFont('helvetica', 'bold');
  doc.text('Entrega:', 110, y);
  doc.setFont('helvetica', 'normal');
  doc.text(fmtDate(oc.fecha_entrega), 128, y);

  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text('Estado:', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.text(String(safe(oc.estado, 'borrador')).toUpperCase(), 30, y);

  // Tabla de items
  let subtotal = 0;
  const body = items.map((it, idx) => {
    const cant = Number(it.cantidad ?? it.cant ?? 0);
    const pu = Number(it.precio_unitario ?? it.pu ?? 0);
    const sub = Number(it.subtotal ?? (cant * pu));
    subtotal += sub;
    return [
      String(idx + 1),
      safe(it.nombre || it.descripcion || it.material, '—'),
      safe(it.unidad || it.und, '—'),
      fmtNum(cant, 2),
      fmtS(pu),
      fmtS(sub),
    ];
  });

  autoTable(doc, {
    startY: y + 4,
    head: [['#', 'Descripción', 'Und', 'Cant.', 'P. Unit.', 'Subtotal']],
    body,
    headStyles: { fillColor: COLOR_HEAD, textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: COLOR_ALT },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 16, halign: 'center' },
      3: { cellWidth: 20, halign: 'right' },
      4: { cellWidth: 28, halign: 'right' },
      5: { cellWidth: 30, halign: 'right' },
    },
    margin: { left: 14, right: 14 },
  });

  // Totales
  const igvRate = 0.18;
  const igv = subtotal * igvRate;
  const total = subtotal + igv;
  let endY = doc.lastAutoTable.finalY + 4;

  const xLabel = 130;
  const xVal = pageWidth - 14;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Subtotal:', xLabel, endY);
  doc.text(fmtS(subtotal), xVal, endY, { align: 'right' });
  endY += 5;
  doc.text('IGV (18%):', xLabel, endY);
  doc.text(fmtS(igv), xVal, endY, { align: 'right' });
  endY += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setFillColor(...COLOR_HEAD);
  doc.rect(xLabel - 3, endY - 4, pageWidth - 14 - (xLabel - 3), 6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.text('TOTAL:', xLabel, endY);
  doc.text(fmtS(total), xVal, endY, { align: 'right' });
  doc.setTextColor(0, 0, 0);

  // Observaciones
  if (oc.observaciones) {
    endY += 12;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Observaciones:', 14, endY);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(String(oc.observaciones), pageWidth - 28);
    doc.text(lines, 14, endY + 5);
  }

  drawFooter(doc, `Orden de Compra ${safe(oc.codigo, '')}`);
  const filename = `OC_${safe(oc.codigo, 'sin-codigo')}_${fmtDate(oc.fecha || new Date()).replace(/\//g, '-')}.pdf`;
  doc.save(filename);
  return doc;
}

// ─────────────────────────────────────────────────────────────
// 2. Requisición
// ─────────────────────────────────────────────────────────────
export function generateRequisicionPdf(req, items, obra, solicitanteNombre) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = 210;
  req = req || {};
  items = Array.isArray(items) ? items : [];
  obra = obra || {};

  drawHeader(doc, {
    company: {},
    title: 'REQUISICIÓN DE MATERIALES',
    subtitle: req.codigo ? `N° ${req.codigo}` : '',
    pageWidth,
  });

  // Meta
  let y = 36;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Código:', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.text(safe(req.codigo, '—'), 32, y);

  doc.setFont('helvetica', 'bold');
  doc.text('Fecha:', 110, y);
  doc.setFont('helvetica', 'normal');
  doc.text(fmtDate(req.fecha || req.created_at), 125, y);

  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text('Obra:', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.text(safe(obra.nombre || obra.codigo, '—'), 30, y);

  doc.setFont('helvetica', 'bold');
  doc.text('Solicitante:', 110, y);
  doc.setFont('helvetica', 'normal');
  doc.text(safe(solicitanteNombre || req.solicitante, '—'), 132, y);

  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text('Estado:', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.text(String(safe(req.estado, 'pendiente')).toUpperCase(), 30, y);

  if (req.prioridad) {
    doc.setFont('helvetica', 'bold');
    doc.text('Prioridad:', 110, y);
    doc.setFont('helvetica', 'normal');
    doc.text(String(req.prioridad).toUpperCase(), 130, y);
  }

  // Tabla de items (sin precios)
  const body = items.map((it, idx) => [
    String(idx + 1),
    safe(it.material || it.nombre || it.descripcion, '—'),
    safe(it.unidad || it.und, '—'),
    fmtNum(it.cantidad ?? it.cant ?? 0, 2),
    safe(it.observacion || it.obs, ''),
  ]);

  autoTable(doc, {
    startY: y + 6,
    head: [['#', 'Material', 'Und', 'Cantidad', 'Observación']],
    body,
    headStyles: { fillColor: COLOR_HEAD, textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: COLOR_ALT },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 18, halign: 'center' },
      3: { cellWidth: 24, halign: 'right' },
      4: { cellWidth: 60 },
    },
    margin: { left: 14, right: 14 },
  });

  let endY = doc.lastAutoTable.finalY + 8;

  if (req.notas || req.observaciones) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Notas:', 14, endY);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(String(req.notas || req.observaciones), pageWidth - 28);
    doc.text(lines, 14, endY + 5);
    endY += 5 + (lines.length * 4);
  }

  // Firma
  endY = Math.max(endY + 20, 250);
  doc.setDrawColor(120, 120, 120);
  doc.line(30, endY, 90, endY);
  doc.line(120, endY, 180, endY);
  doc.setFontSize(8);
  doc.setTextColor(...COLOR_MUTED);
  doc.text('Solicitante', 60, endY + 4, { align: 'center' });
  doc.text('Aprobado por', 150, endY + 4, { align: 'center' });

  drawFooter(doc, `Requisición ${safe(req.codigo, '')}`);
  const filename = `REQ_${safe(req.codigo, 'sin-codigo')}_${fmtDate(req.fecha || new Date()).replace(/\//g, '-')}.pdf`;
  doc.save(filename);
  return doc;
}

// ─────────────────────────────────────────────────────────────
// 3. Valorización
// ─────────────────────────────────────────────────────────────
export function generateValorizacionPdf(val, partidasVal, obra, company) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = 210;
  val = val || {};
  partidasVal = Array.isArray(partidasVal) ? partidasVal : [];
  obra = obra || {};
  company = company || {};

  const periodo = val.periodo || (val.mes && val.anio ? `${String(val.mes).padStart(2, '0')}/${val.anio}` : '');

  drawHeader(doc, {
    company,
    title: 'VALORIZACIÓN DE OBRA',
    subtitle: val.numero ? `N° ${val.numero}${periodo ? ' — ' + periodo : ''}` : periodo,
    pageWidth,
  });

  // Datos cliente / obra
  const yBox = 34;
  infoBox(doc, 14, yBox, 90, 32, 'CLIENTE', [
    safe(obra.cliente_nombre || obra.cliente, '—'),
    obra.cliente_ruc ? `RUC: ${obra.cliente_ruc}` : null,
    obra.cliente_direccion ? String(obra.cliente_direccion) : null,
  ]);
  infoBox(doc, 106, yBox, 90, 32, 'OBRA / PROYECTO', [
    safe(obra.nombre, '—'),
    obra.codigo ? `Código: ${obra.codigo}` : null,
    obra.ubicacion ? String(obra.ubicacion) : null,
    periodo ? `Período: ${periodo}` : null,
  ]);

  // Tabla de partidas
  let bruto = 0;
  const body = partidasVal.map((p) => {
    const cant = Number(p.metrado_contratado ?? p.metrado ?? 0);
    const pu = Number(p.precio_unitario ?? p.pu ?? 0);
    const mAnt = Number(p.metrado_anterior ?? 0);
    const mMes = Number(p.metrado_mes ?? p.metrado_actual ?? 0);
    const mAcum = Number(p.metrado_acumulado ?? (mAnt + mMes));
    const monto = Number(p.monto_mes ?? (mMes * pu));
    bruto += monto;
    const avance = cant > 0 ? (mAcum / cant) * 100 : 0;
    return [
      safe(p.codigo || p.cod, ''),
      safe(p.descripcion || p.nombre, '—'),
      safe(p.unidad || p.und, '—'),
      fmtNum(cant, 2),
      fmtS(pu),
      fmtNum(mAnt, 2),
      fmtNum(mMes, 2),
      fmtNum(mAcum, 2),
      fmtS(monto),
      fmtPct(avance),
    ];
  });

  autoTable(doc, {
    startY: yBox + 36,
    head: [[
      'Código', 'Descripción', 'Und',
      'Met. Contr.', 'P.U.',
      'Met. Ant.', 'Met. Mes', 'Met. Acum.',
      'Monto Mes', '% Avance',
    ]],
    body,
    headStyles: { fillColor: COLOR_HEAD, textColor: 255, fontSize: 7.5 },
    bodyStyles: { fontSize: 7 },
    alternateRowStyles: { fillColor: COLOR_ALT },
    columnStyles: {
      0: { cellWidth: 16 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 10, halign: 'center' },
      3: { cellWidth: 16, halign: 'right' },
      4: { cellWidth: 20, halign: 'right' },
      5: { cellWidth: 14, halign: 'right' },
      6: { cellWidth: 14, halign: 'right' },
      7: { cellWidth: 16, halign: 'right' },
      8: { cellWidth: 22, halign: 'right' },
      9: { cellWidth: 16, halign: 'right' },
    },
    margin: { left: 14, right: 14 },
  });

  // Resumen económico
  let endY = doc.lastAutoTable.finalY + 6;
  // Si bruto no se calculó por filas, intentar leer de val.bruto / val.monto_bruto
  if (bruto === 0 && val.bruto != null) bruto = Number(val.bruto);
  const adelantos = Number(val.adelantos ?? val.amortizacion_adelanto ?? 0);
  const retenciones = Number(val.retenciones ?? val.fondo_garantia ?? 0);
  const subtotal = bruto - adelantos - retenciones;
  const igvRate = 0.18;
  const igv = subtotal * igvRate;
  const totalFactura = subtotal + igv;
  const detraccionRate = Number(val.detraccion_rate ?? 0.12);
  const detraccion = totalFactura * detraccionRate;
  const neto = totalFactura - detraccion;

  // Verificar espacio
  const pageHeight = doc.internal.pageSize.getHeight();
  if (endY > pageHeight - 90) {
    doc.addPage();
    endY = 20;
  }

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLOR_HEAD);
  doc.text('RESUMEN ECONÓMICO', 14, endY);
  doc.setTextColor(0, 0, 0);
  endY += 4;

  const rows = [
    ['Bruto valorizado', fmtS(bruto)],
    ['(-) Amortización adelantos', fmtS(adelantos)],
    ['(-) Retenciones / Fondo de garantía', fmtS(retenciones)],
    ['Subtotal', fmtS(subtotal)],
    ['IGV (18%)', fmtS(igv)],
    ['TOTAL FACTURA', fmtS(totalFactura)],
    [`(-) Detracción (${(detraccionRate * 100).toFixed(0)}%)`, fmtS(detraccion)],
    ['NETO A COBRAR', fmtS(neto)],
  ];

  autoTable(doc, {
    startY: endY,
    body: rows,
    theme: 'plain',
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 110, fontStyle: 'normal' },
      1: { cellWidth: 70, halign: 'right' },
    },
    margin: { left: 14, right: 14 },
    didParseCell: (data) => {
      const label = data.row.raw[0];
      if (label === 'Subtotal' || label === 'TOTAL FACTURA' || label === 'NETO A COBRAR') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = label === 'NETO A COBRAR' ? COLOR_HEAD : [235, 240, 245];
        if (label === 'NETO A COBRAR') data.cell.styles.textColor = 255;
      }
    },
  });

  endY = doc.lastAutoTable.finalY + 6;

  // Datos factura
  if (val.factura_serie || val.factura_numero) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Factura:', 14, endY);
    doc.setFont('helvetica', 'normal');
    doc.text(`${safe(val.factura_serie, '')}-${safe(val.factura_numero, '')}`, 32, endY);
    endY += 5;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Estado:', 14, endY);
  doc.setFont('helvetica', 'normal');
  doc.text(String(safe(val.estado, 'borrador')).toUpperCase(), 30, endY);

  drawFooter(doc, `Valorización ${safe(val.numero, '')} ${periodo}`);
  const filename = `VAL_${safe(val.numero, 'sin-num')}_${(periodo || '').replace(/\//g, '-')}.pdf`;
  doc.save(filename);
  return doc;
}

// ─────────────────────────────────────────────────────────────
// 4. Consolidado contable
// ─────────────────────────────────────────────────────────────
export function generateConsolidadoPdf(data, companies, periodo) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = 297;
  data = data || {};
  companies = Array.isArray(companies) ? companies : [];

  drawHeader(doc, {
    company: { name: 'Grupo Empresarial' },
    title: 'ESTADO CONSOLIDADO DEL GRUPO',
    subtitle: periodo ? `Período: ${periodo}` : '',
    pageWidth,
  });

  // Tabla resumen por empresa
  const porEmpresa = Array.isArray(data.porEmpresa) ? data.porEmpresa : companies.map((c) => {
    const row = (data.empresas || {})[c.id] || {};
    return {
      empresa: c.name || c.legal_name,
      ruc: c.ruc,
      ingresos: row.ingresos ?? 0,
      costos: row.costos ?? 0,
      gastos: row.gastos ?? 0,
      utilidad: row.utilidad ?? ((row.ingresos ?? 0) - (row.costos ?? 0) - (row.gastos ?? 0)),
      margen: row.margen,
    };
  });

  let y = 34;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COLOR_HEAD);
  doc.text('Resumen por empresa', 14, y);
  doc.setTextColor(0, 0, 0);

  const bodyEmpresas = porEmpresa.map((e) => {
    const ing = Number(e.ingresos || 0);
    const cos = Number(e.costos || 0);
    const gas = Number(e.gastos || 0);
    const ut = Number(e.utilidad ?? (ing - cos - gas));
    const mg = e.margen != null ? Number(e.margen) : (ing > 0 ? (ut / ing) * 100 : 0);
    return [
      safe(e.empresa, '—'),
      safe(e.ruc, ''),
      fmtS(ing),
      fmtS(cos),
      fmtS(gas),
      fmtS(ut),
      fmtPct(mg),
    ];
  });

  autoTable(doc, {
    startY: y + 3,
    head: [['Empresa', 'RUC', 'Ingresos', 'Costos', 'Gastos', 'Utilidad', 'Margen %']],
    body: bodyEmpresas,
    headStyles: { fillColor: COLOR_HEAD, textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: COLOR_ALT },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 28 },
      2: { cellWidth: 32, halign: 'right' },
      3: { cellWidth: 32, halign: 'right' },
      4: { cellWidth: 32, halign: 'right' },
      5: { cellWidth: 32, halign: 'right' },
      6: { cellWidth: 24, halign: 'right' },
    },
    margin: { left: 14, right: 14 },
  });

  let endY = doc.lastAutoTable.finalY + 8;

  // Sección consolidada (eliminando intercompany)
  const cons = data.consolidado || {};
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COLOR_HEAD);
  doc.text('Consolidado real (sin intercompany)', 14, endY);
  doc.setTextColor(0, 0, 0);
  endY += 3;

  const ingExt = Number(cons.ingresos_externos ?? 0);
  const cosExt = Number(cons.costos_externos ?? 0);
  const gasExt = Number(cons.gastos_externos ?? 0);
  const utReal = Number(cons.utilidad_real ?? (ingExt - cosExt - gasExt));
  const mgReal = cons.margen_real != null
    ? Number(cons.margen_real)
    : (ingExt > 0 ? (utReal / ingExt) * 100 : 0);

  autoTable(doc, {
    startY: endY,
    head: [['Concepto', 'Monto']],
    body: [
      ['Ingresos externos', fmtS(ingExt)],
      ['Costos externos', fmtS(cosExt)],
      ['Gastos externos', fmtS(gasExt)],
      ['Utilidad real', fmtS(utReal)],
      ['Margen real', fmtPct(mgReal)],
    ],
    headStyles: { fillColor: COLOR_HEAD, textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 120 },
      1: { cellWidth: 60, halign: 'right' },
    },
    margin: { left: 14, right: 14 },
    didParseCell: (d) => {
      const label = d.row.raw[0];
      if (label === 'Utilidad real' || label === 'Margen real') {
        d.cell.styles.fontStyle = 'bold';
        d.cell.styles.fillColor = [235, 240, 245];
      }
    },
  });

  endY = doc.lastAutoTable.finalY + 8;

  // Intercompany eliminadas
  const inter = Array.isArray(data.intercompany) ? data.intercompany : [];
  const totalInter = inter.reduce((s, it) => s + Number(it.monto || it.amount || 0), 0);

  // Salto de página si no cabe
  const pageHeight = doc.internal.pageSize.getHeight();
  if (endY > pageHeight - 50) {
    doc.addPage();
    endY = 20;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COLOR_HEAD);
  doc.text(`Operaciones intercompany eliminadas (Total: ${fmtS(totalInter)})`, 14, endY);
  doc.setTextColor(0, 0, 0);
  endY += 3;

  if (inter.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(...COLOR_MUTED);
    doc.text('Sin operaciones intercompany registradas en el período.', 14, endY + 5);
    doc.setTextColor(0, 0, 0);
  } else {
    autoTable(doc, {
      startY: endY,
      head: [['Fecha', 'Origen', 'Destino', 'Concepto', 'Monto']],
      body: inter.map((it) => [
        fmtDate(it.fecha || it.date),
        safe(it.origen || it.from_company, '—'),
        safe(it.destino || it.to_company, '—'),
        safe(it.concepto || it.descripcion, ''),
        fmtS(it.monto || it.amount || 0),
      ]),
      headStyles: { fillColor: COLOR_HEAD, textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: COLOR_ALT },
      columnStyles: {
        0: { cellWidth: 24 },
        1: { cellWidth: 50 },
        2: { cellWidth: 50 },
        3: { cellWidth: 'auto' },
        4: { cellWidth: 32, halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    });
  }

  drawFooter(doc, `Consolidado ${periodo || ''}`);
  const filename = `Consolidado_${(periodo || 'periodo').replace(/[^\w-]/g, '-')}.pdf`;
  doc.save(filename);
  return doc;
}

// ─── Export agrupado para conveniencia ───────────────────────
export default {
  generateOCPdf,
  generateRequisicionPdf,
  generateValorizacionPdf,
  generateConsolidadoPdf,
};
