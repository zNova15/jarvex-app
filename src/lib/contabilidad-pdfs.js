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

// Dibuja el logo de la empresa ejecutora (company.logo_dataurl) si existe.
// Devuelve el desplazamiento horizontal a aplicar al texto (0 si no hay logo).
// Nunca lanza: un data-url inválido no debe romper la generación del PDF.
function drawCompanyLogo(doc, company) {
  const src = company?.logo_dataurl;
  if (!src || typeof src !== 'string' || !src.startsWith('data:image')) return 0;
  try {
    const fmt = /^data:image\/png/i.test(src) ? 'PNG'
      : /^data:image\/jpe?g/i.test(src) ? 'JPEG'
      : /^data:image\/webp/i.test(src) ? 'WEBP' : 'PNG';
    doc.addImage(src, fmt, 13, 4, 20, 20);   // 20×20mm dentro de la banda
    return 22;                               // corrimiento del texto a la derecha
  } catch { return 0; }
}

// ─── Estilo común ────────────────────────────────────────────
function drawHeader(doc, { company, title, subtitle, pageWidth = 210 }) {
  // Banda oscura
  doc.setFillColor(...COLOR_DARK);
  doc.rect(0, 0, pageWidth, 28, 'F');

  // Logo de la empresa ejecutora (personalizable). Corre el texto si hay logo.
  const dx = drawCompanyLogo(doc, company);

  // Marca JARVEX
  doc.setTextColor(...COLOR_GOLD);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('JARVEX', 14 + dx, 12);

  // Empresa emisora
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  const companyName = safe(company?.name || company?.legal_name, 'Tecnología, Ingeniería y Proyectos E.I.R.L.');
  doc.text(companyName, 14 + dx, 17);
  if (company?.legal_name && company?.name && company.legal_name !== company.name) {
    doc.text(String(company.legal_name), 14 + dx, 21);
  }
  if (company?.ruc) {
    doc.text(`RUC: ${company.ruc}`, 14 + dx, 25);
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
export function generateRequisicionPdf(req, items, obra, solicitanteNombre, company) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = 210;
  req = req || {};
  items = Array.isArray(items) ? items : [];
  obra = obra || {};

  drawHeader(doc, {
    company: company || {},
    title: 'SOLICITUD DE INSUMOS',
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
  doc.text('Responsable:', 110, y);
  doc.setFont('helvetica', 'normal');
  doc.text(safe(req.responsable_nombre || solicitanteNombre || req.solicitante, '—'), 135, y);

  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text('Estado:', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.text(String(safe(req.estado, 'pendiente')).toUpperCase(), 30, y);

  if (req.prioridad) {
    doc.setFont('helvetica', 'bold');
    doc.text('Prioridad:', 110, y);
    doc.setFont('helvetica', 'normal');
    doc.text(String(req.prioridad).toUpperCase(), 132, y);
  }

  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text('Fecha deseada:', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.text(safe(req.fecha_necesidad || req.fecha_requerida, '—'), 44, y);
  if (req.fecha_urgente) {
    doc.setFont('helvetica', 'bold');
    doc.text('Urgente:', 110, y);
    doc.setFont('helvetica', 'normal');
    doc.text(String(req.fecha_urgente), 128, y);
  }

  if (req.razon) {
    y += 5;
    doc.setFont('helvetica', 'bold');
    doc.text('Razón:', 14, y);
    doc.setFont('helvetica', 'normal');
    const rz = doc.splitTextToSize(String(req.razon), pageWidth - 44);
    doc.text(rz, 30, y);
    y += (rz.length - 1) * 4;
  }

  const TIPO_LBL = { material:'Material', herramienta:'Herramienta', epp:'EPP', emergencia:'Emergencia', maquinaria:'Maquinaria' };
  // Tabla de items (sin precios). Muestra tipo + nombre + mínimo urgente.
  const body = items.map((it, idx) => [
    String(idx + 1),
    TIPO_LBL[it.tipo_insumo] || 'Material',
    safe(it.nombre || it.descripcion || it.material || it.nombre_libre, '—'),
    safe(it.unidad || it.und, '—'),
    fmtNum(it.cantidad ?? it.cant ?? 0, 2),
    it.cantidad_minima ? fmtNum(it.cantidad_minima, 2) : '—',
    safe(it.notas || it.observacion || it.obs, ''),
  ]);

  autoTable(doc, {
    startY: y + 6,
    head: [['#', 'Tipo', 'Insumo', 'Und', 'Cant.', 'Mín.', 'Observación']],
    body,
    headStyles: { fillColor: COLOR_HEAD, textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: COLOR_ALT },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 22 },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 14, halign: 'center' },
      4: { cellWidth: 18, halign: 'right' },
      5: { cellWidth: 16, halign: 'right' },
      6: { cellWidth: 44 },
    },
    margin: { left: 14, right: 14 },
  });

  let endY = doc.lastAutoTable.finalY + 8;

  if (req.motivo_revision || req.observaciones_parcial) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Resolución:', 14, endY);
    doc.setFont('helvetica', 'normal');
    const txt = [req.motivo_revision, req.observaciones_parcial ? `Parcial: ${req.observaciones_parcial}` : null].filter(Boolean).join(' — ');
    const lines = doc.splitTextToSize(txt, pageWidth - 40);
    doc.text(lines, 38, endY);
    endY += (lines.length * 4) + 4;
  }

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
// 4. Consolidado contable (tanda 3)
// ─────────────────────────────────────────────────────────────
//
// Recibe TAL CUAL el resultado de `consolidar()` (src/lib/consolidado.js).
//
// ⚠ Antes esta función leía `data.porEmpresa`, `data.consolidado.ingresos_externos`
// y `data.intercompany`, tres campos que la pantalla nunca le pasó: el PDF salía
// entero en ceros y nadie lo notó porque el número de la pantalla estaba bien.
// Ahora consume la misma estructura que se muestra, así que si el PDF miente,
// miente igual que la pantalla — y eso sí se ve.
export function generateConsolidadoPdf(r, companies, periodo) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = 297;
  r = r || {};
  const libros = r.libros || {};
  const elim = r.eliminaciones || {};
  const cons = r.consolidado || {};
  const sinEspejo = r.sinEspejo || {};
  const moneda = r.moneda || periodo || 'PEN';

  drawHeader(doc, {
    company: { name: 'Grupo Empresarial' },
    title: 'CONSOLIDADO DEL GRUPO',
    subtitle: `Moneda: ${moneda}`,
    pageWidth,
  });

  let y = 34;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COLOR_HEAD);
  doc.text('Hoja de trabajo', 14, y);
  doc.setTextColor(0, 0, 0);

  const elimIng = Number(elim.ingresos || 0) + Number(sinEspejo.ingresos || 0);
  const elimCos = Number(elim.costos || 0) + Number(sinEspejo.costos || 0);

  autoTable(doc, {
    startY: y + 3,
    head: [['Estado de resultados', 'Suma de libros', 'Eliminaciones', 'Consolidado']],
    body: [
      ['Ingresos', fmtS(libros.ingresos), `(${fmtS(elimIng)})`, fmtS(cons.ingresos)],
      ['Costos', fmtS(libros.costos), `(${fmtS(elimCos)})`, fmtS(cons.costos)],
      ['Gastos', fmtS(libros.gastos), '—', fmtS(cons.gastos)],
      ['Utilidad del grupo', fmtS(libros.utilidad), '—', fmtS(cons.utilidad)],
      ['Margen', '', '', fmtPct(cons.margen)],
    ],
    headStyles: { fillColor: COLOR_HEAD, textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: COLOR_ALT },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 45, halign: 'right' },
      2: { cellWidth: 45, halign: 'right' },
      3: { cellWidth: 45, halign: 'right' },
    },
    margin: { left: 14, right: 14 },
    didParseCell: (d) => {
      const label = d.row.raw[0];
      if (label === 'Utilidad del grupo' || label === 'Margen') {
        d.cell.styles.fontStyle = 'bold';
        d.cell.styles.fillColor = [235, 240, 245];
      }
    },
  });

  let endY = doc.lastAutoTable.finalY + 8;

  // ── Qué se eliminó contra qué ──────────────────────────────
  const aristas = Array.isArray(r.aristas) ? r.aristas : [];
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COLOR_HEAD);
  doc.text(
    `Operaciones internas eliminadas (${elim.nPares || 0} pares · ${fmtS(elim.ingresos)})`,
    14, endY,
  );
  doc.setTextColor(0, 0, 0);
  endY += 3;

  if (aristas.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(...COLOR_MUTED);
    doc.text('Sin operaciones internas registradas.', 14, endY + 5);
    doc.setTextColor(0, 0, 0);
    endY += 12;
  } else {
    autoTable(doc, {
      startY: endY,
      head: [['Vendió', 'Le compró', 'Documentos', 'Eliminado']],
      body: aristas.map((a) => [
        safe(a.vendedorNombre, '—'),
        safe(a.compradorNombre, '—'),
        String(a.nPares || 0),
        fmtS(a.monto),
      ]),
      headStyles: { fillColor: COLOR_HEAD, textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: COLOR_ALT },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 26, halign: 'right' },
        3: { cellWidth: 40, halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    });
    endY = doc.lastAutoTable.finalY + 8;
  }

  // ── Cadenas de reventa interna ─────────────────────────────
  const cadenas = Array.isArray(r.cadenas) ? r.cadenas : [];
  const pageHeight = doc.internal.pageSize.getHeight();
  if (cadenas.length > 0) {
    if (endY > pageHeight - 50) { doc.addPage(); endY = 20; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...COLOR_HEAD);
    doc.text('Cadenas de reventa dentro del grupo', 14, endY);
    doc.setTextColor(0, 0, 0);
    autoTable(doc, {
      startY: endY + 3,
      head: [['Cadena', 'Tramos', 'Facturado adentro']],
      body: cadenas.map((c) => [
        (c.nombres || []).join('  →  '),
        String((c.tramos || []).length),
        fmtS(c.facturadoInterno),
      ]),
      headStyles: { fillColor: COLOR_HEAD, textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: COLOR_ALT },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 22, halign: 'right' },
        2: { cellWidth: 40, halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    });
    endY = doc.lastAutoTable.finalY + 8;
  }

  // ── Lo que no cuadra ───────────────────────────────────────
  const huerfanas = Array.isArray(sinEspejo.movimientos) ? sinEspejo.movimientos : [];
  if (huerfanas.length > 0) {
    if (endY > pageHeight - 50) { doc.addPage(); endY = 20; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...COLOR_HEAD);
    doc.text(`Operaciones internas sin su espejo cargado (${huerfanas.length})`, 14, endY);
    doc.setTextColor(0, 0, 0);
    autoTable(doc, {
      startY: endY + 3,
      head: [['Fecha', 'Documento', 'Entidad', 'Contraparte', 'Falta', 'Monto']],
      body: huerfanas.map((m) => [
        fmtDate(m.fecha),
        safe(m.documento, '—'),
        safe(m.entidad, '—'),
        safe(m.contraparte, '—'),
        m.tipo === 'ingreso' ? 'el costo' : 'el ingreso',
        fmtS(m.monto),
      ]),
      headStyles: { fillColor: COLOR_HEAD, textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: COLOR_ALT },
      columnStyles: {
        0: { cellWidth: 24 },
        1: { cellWidth: 28 },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 'auto' },
        4: { cellWidth: 24 },
        5: { cellWidth: 32, halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    });
  }

  drawFooter(doc, `Consolidado ${moneda}`);
  doc.save(`Consolidado_${String(moneda).replace(/[^\w-]/g, '-')}.pdf`);
  return doc;
}

// ─────────────────────────────────────────────────────────────
// 5. Factura Interna (intercompany) — borrador
// ─────────────────────────────────────────────────────────────
//
// Formato similar a factura electrónica SUNAT (encabezado, datos emisor /
// adquiriente, items con IGV, totales). NO genera XML firmado — eso requiere
// el flujo SUNAT real. Este PDF es el documento legible para imprimir, firmar
// y luego digitalizar para Captura Mágica o subir a SUNAT.
//
// Args:
//   factura: {
//     serie, correlativo, fecha, fecha_vencimiento, moneda,
//     concepto, observaciones, chain_id, paso_idx, paso_total,
//   }
//   items: [{ descripcion, unidad, cantidad, precio_unitario }]
//   emisor: company que vende (datos completos)
//   adquiriente: company que compra (datos completos)
//   download?: boolean (default true) — si false sólo retorna el doc sin doc.save
//
export function generateFacturaInternaPdf(factura, items, emisor, adquiriente, { download = true } = {}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = 210;
  factura = factura || {};
  items = Array.isArray(items) ? items : [];
  emisor = emisor || {};
  adquiriente = adquiriente || {};

  const tipoDoc = factura.tipo_documento || 'FACTURA ELECTRÓNICA';
  const serieCorr = `${factura.serie || 'F001'}-${String(factura.correlativo || '00000001').padStart(8, '0')}`;
  const moneda = (factura.moneda || 'PEN').toUpperCase();
  const monedaSimbolo = moneda === 'USD' ? 'US$ ' : 'S/ ';
  const igvRate = 0.18;

  drawHeader(doc, {
    company: emisor,
    title: tipoDoc,
    subtitle: serieCorr,
    pageWidth,
  });

  // Banner si es borrador
  const estado = (factura.estado || 'borrador').toLowerCase();
  if (estado === 'borrador') {
    doc.setFillColor(245, 158, 11);
    doc.rect(0, 28, pageWidth, 5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('● BORRADOR — pendiente de firma y emisión SUNAT', pageWidth / 2, 31.5, { align: 'center' });
    doc.setTextColor(0, 0, 0);
  }

  // Box emisor
  const yBox = 38;
  infoBox(doc, 14, yBox, 90, 30, 'EMISOR', [
    safe(emisor.legal_name || emisor.name, '—'),
    emisor.ruc ? `RUC: ${emisor.ruc}` : null,
    emisor.address ? String(emisor.address) : null,
    emisor.phone ? `Tel: ${emisor.phone}` : null,
  ]);
  // Box adquiriente
  infoBox(doc, 106, yBox, 90, 30, 'ADQUIRIENTE', [
    safe(adquiriente.legal_name || adquiriente.name, '—'),
    adquiriente.ruc ? `RUC: ${adquiriente.ruc}` : null,
    adquiriente.address ? String(adquiriente.address) : null,
    adquiriente.phone ? `Tel: ${adquiriente.phone}` : null,
  ]);

  // Meta
  let y = yBox + 34;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('F. Emisión:', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.text(fmtDate(factura.fecha || new Date()), 38, y);

  doc.setFont('helvetica', 'bold');
  doc.text('F. Vencimiento:', 80, y);
  doc.setFont('helvetica', 'normal');
  doc.text(fmtDate(factura.fecha_vencimiento), 110, y);

  doc.setFont('helvetica', 'bold');
  doc.text('Moneda:', 150, y);
  doc.setFont('helvetica', 'normal');
  doc.text(moneda, 168, y);

  y += 5;
  if (factura.chain_id) {
    doc.setFont('helvetica', 'bold');
    doc.text('Cadena trazabilidad:', 14, y);
    doc.setFont('helvetica', 'normal');
    doc.text(String(factura.chain_id).slice(0, 8) + (factura.paso_idx != null ? ` · paso ${factura.paso_idx}/${factura.paso_total || '?'}` : ''), 50, y);
    y += 5;
  }
  if (factura.concepto) {
    doc.setFont('helvetica', 'bold');
    doc.text('Concepto:', 14, y);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(String(factura.concepto), pageWidth - 50);
    doc.text(lines, 35, y);
    y += 5 * Math.max(1, lines.length);
  }

  // Tabla items
  let subtotal = 0;
  const body = items.map((it, idx) => {
    const cant = Number(it.cantidad ?? 0);
    const pu = Number(it.precio_unitario ?? 0);
    const sub = +(cant * pu).toFixed(4);
    subtotal += sub;
    return [
      String(idx + 1),
      safe(it.descripcion || it.nombre, '—'),
      safe(it.unidad || it.und, '—'),
      fmtNum(cant, 2),
      monedaSimbolo + fmtNum(pu, 4),
      monedaSimbolo + fmtNum(sub, 2),
    ];
  });

  autoTable(doc, {
    startY: y + 2,
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
      4: { cellWidth: 30, halign: 'right' },
      5: { cellWidth: 30, halign: 'right' },
    },
    margin: { left: 14, right: 14 },
  });

  // Totales
  const igv = +(subtotal * igvRate).toFixed(2);
  const total = +(subtotal + igv).toFixed(2);
  let endY = doc.lastAutoTable.finalY + 4;

  const xLabel = 130;
  const xVal = pageWidth - 14;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Subtotal (gravado):', xLabel, endY);
  doc.text(monedaSimbolo + fmtNum(subtotal, 2), xVal, endY, { align: 'right' });
  endY += 5;
  doc.text('IGV (18%):', xLabel, endY);
  doc.text(monedaSimbolo + fmtNum(igv, 2), xVal, endY, { align: 'right' });
  endY += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setFillColor(...COLOR_HEAD);
  doc.rect(xLabel - 3, endY - 4, pageWidth - 14 - (xLabel - 3), 6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.text('TOTAL:', xLabel, endY);
  doc.text(monedaSimbolo + fmtNum(total, 2), xVal, endY, { align: 'right' });
  doc.setTextColor(0, 0, 0);

  // Importe en letras (simple, solo PEN)
  endY += 10;
  if (moneda === 'PEN') {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.text(`SON: ${montoEnLetras(total)} SOLES`, 14, endY);
  }

  // Observaciones
  if (factura.observaciones) {
    endY += 8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Observaciones:', 14, endY);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(String(factura.observaciones), pageWidth - 28);
    doc.text(lines, 14, endY + 5);
  }

  drawFooter(doc, `Factura interna ${serieCorr} · ${safe(emisor.name, '')} → ${safe(adquiriente.name, '')}`);
  const filename = `FacturaInterna_${serieCorr}_${fmtDate(factura.fecha || new Date()).replace(/\//g, '-')}.pdf`;
  if (download) doc.save(filename);
  return { doc, filename };
}

// Conversor número → letras simplificado (limitado a millones)
function montoEnLetras(n) {
  const num = Math.floor(Number(n) || 0);
  const dec = Math.round((Number(n) - num) * 100);
  const unidades = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
  const decenas = ['', 'DIEZ', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const especiales = ['DIEZ','ONCE','DOCE','TRECE','CATORCE','QUINCE','DIECISÉIS','DIECISIETE','DIECIOCHO','DIECINUEVE'];
  const centenas = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

  function bajo1000(n) {
    if (n === 0) return '';
    if (n === 100) return 'CIEN';
    let s = '';
    const c = Math.floor(n / 100);
    const r = n % 100;
    if (c) s += centenas[c] + ' ';
    if (r >= 10 && r < 20) s += especiales[r - 10];
    else {
      const d = Math.floor(r / 10);
      const u = r % 10;
      if (d) s += decenas[d];
      if (u) s += (d ? ' Y ' : '') + unidades[u];
    }
    return s.trim();
  }

  if (num === 0) return `CERO CON ${String(dec).padStart(2, '0')}/100`;
  if (num >= 1000000) {
    const m = Math.floor(num / 1000000);
    const r = num % 1000000;
    let s = (m === 1 ? 'UN MILLÓN' : `${bajo1000(m)} MILLONES`);
    if (r >= 1000) s += ' ' + bajo1000(Math.floor(r / 1000)) + ' MIL';
    if (r % 1000) s += ' ' + bajo1000(r % 1000);
    return `${s} CON ${String(dec).padStart(2, '0')}/100`;
  }
  if (num >= 1000) {
    const miles = Math.floor(num / 1000);
    const resto = num % 1000;
    let s = (miles === 1 ? 'MIL' : `${bajo1000(miles)} MIL`);
    if (resto) s += ' ' + bajo1000(resto);
    return `${s} CON ${String(dec).padStart(2, '0')}/100`;
  }
  return `${bajo1000(num)} CON ${String(dec).padStart(2, '0')}/100`;
}

// ─── Export agrupado para conveniencia ───────────────────────
export default {
  generateOCPdf,
  generateRequisicionPdf,
  generateValorizacionPdf,
  generateConsolidadoPdf,
  generateFacturaInternaPdf,
};
