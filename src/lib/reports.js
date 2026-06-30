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
