import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

export function generatePDF({ titulo, subtitulo, columnas, filas, footer }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  // Header con branding JARVEX
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

  // Title
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(titulo, 14, 36);
  if (subtitulo) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(subtitulo, 14, 42);
  }

  // Tabla
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

export function generateExcel({ sheetName, columnas, filas, filename }) {
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
