// Generación de PDF/Excel — los imports de jsPDF/xlsx son LAZY (dentro de las
// funciones) para no agregar ~430KB al bundle principal. Se cargan solo cuando
// el user hace click en "Exportar PDF" / "Exportar Excel".

let _jsPDF = null;
let _autoTable = null;
let _XLSX = null;

async function loadPDF() {
  if (_jsPDF && _autoTable) return { jsPDF: _jsPDF, autoTable: _autoTable };
  const [m1, m2] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  _jsPDF = m1.default;
  _autoTable = m2.default;
  return { jsPDF: _jsPDF, autoTable: _autoTable };
}

async function loadXLSX() {
  if (_XLSX) return _XLSX;
  const mod = await import('xlsx');
  _XLSX = mod;
  return _XLSX;
}

export async function generatePDF({ titulo, subtitulo, columnas, filas, footer }) {
  const { jsPDF, autoTable } = await loadPDF();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFillColor(14, 22, 32);
  doc.rect(0, 0, 297, 25, 'F');
  doc.setTextColor(242, 183, 5);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('JARVEX', 14, 13);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('Tecnología, Ingeniería y Proyectos E.I.R.L.', 14, 19);
  doc.text(`Generado: ${new Date().toLocaleString('es-PE')}`, 200, 19);

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(titulo, 14, 36);
  if (subtitulo) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(subtitulo, 14, 42);
  }

  autoTable(doc, {
    head: [columnas],
    body: filas,
    startY: 48,
    headStyles: { fillColor: [28, 45, 64], textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 248, 248] },
    margin: { left: 14, right: 14 },
  });

  if (footer) {
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(128);
      doc.text(footer, 14, 200);
      doc.text(`Página ${i} de ${pageCount}`, 270, 200);
    }
  }

  return doc;
}

export function downloadPDF(doc, filename) {
  doc.save(filename);
}

// Logo de la empresa ejecutora en la banda del encabezado. Nunca lanza.
function drawReportLogo(doc, company, x = 13, y = 4, size = 18) {
  const src = company?.logo_dataurl;
  if (!src || typeof src !== 'string' || !src.startsWith('data:image')) return 0;
  try {
    const fmt = /^data:image\/png/i.test(src) ? 'PNG' : /^data:image\/jpe?g/i.test(src) ? 'JPEG' : /^data:image\/webp/i.test(src) ? 'WEBP' : 'PNG';
    doc.addImage(src, fmt, x, y, size, size);
    return size + 2;
  } catch { return 0; }
}

// ─────────────────────────────────────────────────────────────
// PDF de reporte RICO y reutilizable (dashboard → PDF).
// Recibe contenido YA calculado/formateado por el llamador:
//   company  — { logo_dataurl, name, legal_name, ruc }
//   titulo, subtitulo, meta (líneas de contexto)
//   kpis     — [{ label, value }]
//   charts   — [{ titulo, png (dataURL de chart.toBase64Image()), height? }]
//   tablas   — [{ titulo, columnas, filas }]
// Sirve para movimientos, avance y contable (mismo layout).
// ─────────────────────────────────────────────────────────────
export async function generateReportePDF({ company = {}, titulo = 'Reporte', subtitulo = '', meta = [], kpis = [], charts = [], tablas = [], footer = '' }) {
  const { jsPDF, autoTable } = await loadPDF();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210;

  // ── Encabezado ──
  doc.setFillColor(14, 22, 32);
  doc.rect(0, 0, W, 26, 'F');
  const dx = drawReportLogo(doc, company);
  doc.setTextColor(242, 183, 5); doc.setFontSize(15); doc.setFont('helvetica', 'bold');
  doc.text('JARVEX', 14 + dx, 11);
  doc.setTextColor(255, 255, 255); doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.text(String(company.name || company.legal_name || 'Tecnología, Ingeniería y Proyectos E.I.R.L.'), 14 + dx, 16);
  if (company.ruc) doc.text(`RUC: ${company.ruc}`, 14 + dx, 20);
  doc.setTextColor(242, 183, 5); doc.setFontSize(12); doc.setFont('helvetica', 'bold');
  doc.text(String(titulo), W - 14, 12, { align: 'right' });
  doc.setTextColor(220, 220, 220); doc.setFontSize(7.5); doc.setFont('helvetica', 'normal');
  doc.text(`Generado: ${new Date().toLocaleString('es-PE')}`, W - 14, 22, { align: 'right' });

  let y = 33;
  doc.setTextColor(0, 0, 0);
  if (subtitulo) { doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.text(String(subtitulo), 14, y); y += 5; }
  if (meta.length) {
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(90, 90, 90);
    for (const m of meta) { doc.text(String(m), 14, y); y += 4.5; }
    doc.setTextColor(0, 0, 0);
  }
  y += 2;

  // ── KPIs (tarjetas) ──
  if (kpis.length) {
    const perRow = Math.min(kpis.length, 4);
    const gap = 3, boxW = (W - 28 - gap * (perRow - 1)) / perRow, boxH = 16;
    kpis.forEach((k, i) => {
      const col = i % perRow, row = Math.floor(i / perRow);
      const x = 14 + col * (boxW + gap), by = y + row * (boxH + gap);
      doc.setDrawColor(220, 220, 220); doc.setFillColor(247, 249, 251);
      doc.roundedRect(x, by, boxW, boxH, 1.5, 1.5, 'FD');
      doc.setFontSize(7.5); doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal');
      doc.text(String(k.label).toUpperCase(), x + 3, by + 5);
      doc.setFontSize(12); doc.setTextColor(20, 30, 45); doc.setFont('helvetica', 'bold');
      doc.text(String(k.value), x + 3, by + 12);
    });
    y += Math.ceil(kpis.length / perRow) * (boxH + gap) + 2;
    doc.setTextColor(0, 0, 0);
  }

  // ── Gráficos ──
  for (const ch of charts) {
    if (!ch.png) continue;
    const h = ch.height || 60;
    if (y + h + 10 > 285) { doc.addPage(); y = 16; }
    if (ch.titulo) { doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.text(String(ch.titulo), 14, y + 3); y += 6; }
    try { doc.addImage(ch.png, 'PNG', 14, y, W - 28, h); } catch {}
    y += h + 6;
  }

  // ── Tablas ──
  for (const t of tablas) {
    if (!t.columnas || !t.filas) continue;
    if (y + 20 > 285) { doc.addPage(); y = 16; }
    if (t.titulo) { doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.text(String(t.titulo), 14, y + 3); y += 5; }
    autoTable(doc, {
      head: [t.columnas], body: t.filas, startY: y + 2,
      headStyles: { fillColor: [28, 45, 64], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 7.5 }, alternateRowStyles: { fillColor: [248, 248, 248] },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  if (footer) {
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7.5); doc.setTextColor(140, 140, 140);
      doc.text(String(footer), 14, 291);
      doc.text(`Página ${i} de ${pageCount}`, W - 14, 291, { align: 'right' });
    }
  }
  return doc;
}

export async function generateExcel({ sheetName, columnas, filas, filename }) {
  const XLSX = await loadXLSX();
  const ws = XLSX.utils.aoa_to_sheet([columnas, ...filas]);
  const colWidths = columnas.map((col, i) => {
    const maxLen = Math.max(
      String(col).length,
      ...filas.map(row => String(row[i] ?? '').length),
    );
    return { wch: Math.min(maxLen + 2, 40) };
  });
  ws['!cols'] = colWidths;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));
  XLSX.writeFile(wb, filename);
}

// Igual que generateExcel pero con VARIAS hojas en un mismo libro.
// sheets: [{ name, columnas, filas }]. Hojas vacías (sin filas) se incluyen
// igual (solo con los encabezados) para no confundir al usuario.
export async function generateExcelSheets({ sheets, filename }) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  const usados = new Set();
  (sheets || []).forEach((s, idx) => {
    const columnas = s.columnas || [];
    const filas = s.filas || [];
    const ws = XLSX.utils.aoa_to_sheet([columnas, ...filas]);
    ws['!cols'] = columnas.map((col, i) => ({
      wch: Math.min(Math.max(String(col).length, ...filas.map(row => String(row[i] ?? '').length), 0) + 2, 40),
    }));
    // Nombre de hoja: ≤31 chars, único (Excel rechaza duplicados).
    let nombre = String(s.name || `Hoja${idx + 1}`).substring(0, 31) || `Hoja${idx + 1}`;
    while (usados.has(nombre.toLowerCase())) nombre = nombre.substring(0, 28) + (idx + 1);
    usados.add(nombre.toLowerCase());
    XLSX.utils.book_append_sheet(wb, ws, nombre);
  });
  XLSX.writeFile(wb, filename);
}
