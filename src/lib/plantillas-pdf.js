// ═══════════════════════════════════════════════════════════════════
// JARVEX — Plantillas PDF imprimibles
//
// Genera PDFs con tablas vacías para imprimir y llenar a mano en obra
// (cuando no hay tablet/conexión). Después se escanean y suben.
//
// Cada plantilla recibe el contexto de la obra y, opcionalmente, una lista
// de items que ya conocemos para pre-llenar (ej: nombres del personal en
// la plantilla de asistencia).
//
// jsPDF se importa lazy via reports.js para no engordar el bundle inicial.
// ═══════════════════════════════════════════════════════════════════

let _jsPDF = null;
let _autoTable = null;
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

function fmtFecha(iso) {
  if (!iso) return new Date().toLocaleDateString('es-PE');
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('es-PE'); }
  catch { return iso; }
}

// Cabecera estándar JARVEX en página vertical (portrait)
function drawHeader(doc, { titulo, subtitulo, obraNombre, fecha }) {
  doc.setFillColor(14, 22, 32);
  doc.rect(0, 0, 210, 22, 'F');
  doc.setTextColor(242, 183, 5);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('JARVEX', 14, 11);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('Plantilla imprimible · llenar a mano', 14, 17);

  doc.setTextColor(0);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(titulo, 14, 30);
  if (subtitulo) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(subtitulo, 14, 35);
  }
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Obra: ${obraNombre || '____________________'}`, 14, 42);
  doc.text(`Fecha: ${fmtFecha(fecha)}`, 130, 42);
}

function drawFooter(doc, footerText) {
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(128);
    doc.text(footerText || 'Llenar con bolígrafo. Subir al sistema con foto/escan al final del día.', 14, 287);
    doc.text(`Página ${i} de ${pageCount}`, 180, 287);
  }
}

// Render genérico de plantilla: cabecera + tabla vacía con N filas en blanco
async function renderPlantilla({ titulo, subtitulo, obraNombre, fecha, columnas, filasPrellenadas = [], filasVacias = 20, columnasAnchos, footer }) {
  const { jsPDF, autoTable } = await loadPDF();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  drawHeader(doc, { titulo, subtitulo, obraNombre, fecha });

  // Mezclar filas pre-llenadas + filas vacías
  const filasFinales = [
    ...filasPrellenadas,
    ...Array.from({ length: filasVacias }, () => columnas.map(() => '')),
  ];

  autoTable(doc, {
    head: [columnas],
    body: filasFinales,
    startY: 48,
    headStyles: { fillColor: [28, 45, 64], textColor: 255, fontSize: 8.5, halign: 'center' },
    bodyStyles: { fontSize: 8.5, minCellHeight: 8 },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    margin: { left: 10, right: 10 },
    columnStyles: columnasAnchos || {},
    didDrawPage: (data) => {
      // Re-dibujar la cabecera en cada página
      if (data.pageNumber > 1) {
        drawHeader(doc, { titulo: titulo + ' (cont.)', subtitulo, obraNombre, fecha });
      }
    },
  });

  drawFooter(doc, footer);
  return doc;
}

// ─── Plantilla 1: Asistencia diaria ─────────────────────────────────
// Pre-llena los nombres del personal activo. El user marca asistencia y firma.
export async function plantillaAsistencia({ obraNombre, fecha, personal = [] }) {
  const filasPrellenadas = personal.map(p => [
    p.dni || '',
    `${p.nombres || ''} ${p.apellidos || ''}`.trim(),
    p.cargo || '',
    '', '', '', '', // estado V/F/A/T, hora entrada, hora salida, firma
  ]);
  const cantVacias = Math.max(5, 20 - filasPrellenadas.length);
  return renderPlantilla({
    titulo: 'Asistencia diaria',
    subtitulo: 'Marcar V (vino), F (faltó), A (atraso), T (tardanza). Firmar al final del día.',
    obraNombre, fecha,
    columnas: ['DNI', 'Apellidos y nombres', 'Cargo', 'Estado', 'Entrada', 'Salida', 'Horas', 'Firma'],
    filasPrellenadas,
    filasVacias: cantVacias,
    columnasAnchos: {
      0: { cellWidth: 22 },
      1: { cellWidth: 60 },
      2: { cellWidth: 28 },
      3: { cellWidth: 14, halign: 'center' },
      4: { cellWidth: 16, halign: 'center' },
      5: { cellWidth: 16, halign: 'center' },
      6: { cellWidth: 14, halign: 'center' },
      7: { cellWidth: 30 },
    },
    footer: 'Original: archivo obra. Copia: subir foto al sistema (Asistencia → registrar atrasado).',
  });
}

// ─── Plantilla 2: Ingreso de materiales ─────────────────────────────
export async function plantillaIngresoMateriales({ obraNombre, fecha, proveedorSugerido = '' }) {
  return renderPlantilla({
    titulo: 'Ingreso de materiales',
    subtitulo: `Proveedor: ${proveedorSugerido || '____________________________'}    Guía Nº: ____________`,
    obraNombre, fecha,
    columnas: ['#', 'Material', 'Unidad', 'Cantidad', 'Precio (S/)', 'Total (S/)', 'Recibido por'],
    filasVacias: 22,
    columnasAnchos: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 75 },
      2: { cellWidth: 18, halign: 'center' },
      3: { cellWidth: 22, halign: 'right' },
      4: { cellWidth: 22, halign: 'right' },
      5: { cellWidth: 22, halign: 'right' },
      6: { cellWidth: 28 },
    },
    footer: 'Subir al sistema desde Materiales → Registrar Ingreso (lote). Adjuntar foto de la guía.',
  });
}

// ─── Plantilla 3: Salida de materiales ──────────────────────────────
export async function plantillaSalidaMateriales({ obraNombre, fecha, retiraSugerido = '' }) {
  return renderPlantilla({
    titulo: 'Salida de materiales',
    subtitulo: `Quien retira: ${retiraSugerido || '____________________________'}    Vale Nº: ____________    Frente/Zona: ____________`,
    obraNombre, fecha,
    columnas: ['#', 'Material', 'Unidad', 'Cantidad', 'Stock antes', 'Firma quien retira'],
    filasVacias: 22,
    columnasAnchos: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 80 },
      2: { cellWidth: 18, halign: 'center' },
      3: { cellWidth: 24, halign: 'right' },
      4: { cellWidth: 24, halign: 'right' },
      5: { cellWidth: 40 },
    },
    footer: 'Original: caja almacén. Copia: subir al sistema desde Materiales → Registrar Salida (lote).',
  });
}

// ─── Plantilla 4: Ingreso de herramientas ───────────────────────────
export async function plantillaIngresoHerramientas({ obraNombre, fecha, proveedorSugerido = '' }) {
  return renderPlantilla({
    titulo: 'Ingreso de herramientas',
    subtitulo: `Proveedor: ${proveedorSugerido || '____________________________'}    Guía Nº: ____________`,
    obraNombre, fecha,
    columnas: ['#', 'Herramienta', 'Marca', 'Modelo', 'N° Serie', 'Estado', 'Recibido por'],
    filasVacias: 18,
    columnasAnchos: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 55 },
      2: { cellWidth: 25 },
      3: { cellWidth: 25 },
      4: { cellWidth: 28 },
      5: { cellWidth: 18, halign: 'center' },
      6: { cellWidth: 30 },
    },
    footer: 'Subir al sistema desde Herramientas → Registrar Ingreso. Adjuntar foto de la guía.',
  });
}

// ─── Plantilla 5: Salida de herramientas ────────────────────────────
export async function plantillaSalidaHerramientas({ obraNombre, fecha }) {
  return renderPlantilla({
    titulo: 'Salida y devolución de herramientas',
    subtitulo: 'Marcar fecha estimada de devolución. Devolver firmado a almacén.',
    obraNombre, fecha,
    columnas: ['#', 'Herramienta', 'Cantidad', 'Responsable / DNI', 'Devolución est.', 'Firma retira', 'Firma devuelve'],
    filasVacias: 18,
    columnasAnchos: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 55 },
      2: { cellWidth: 18, halign: 'right' },
      3: { cellWidth: 40 },
      4: { cellWidth: 22, halign: 'center' },
      5: { cellWidth: 24 },
      6: { cellWidth: 24 },
    },
    footer: 'Subir desde Herramientas → Registrar Movimiento. Adjuntar foto de la firma.',
  });
}

// ─── Plantilla 6: Ingreso de EPPs ───────────────────────────────────
export async function plantillaIngresoEpps({ obraNombre, fecha, proveedorSugerido = '' }) {
  return renderPlantilla({
    titulo: 'Ingreso de EPPs (Equipos de Protección Personal)',
    subtitulo: `Proveedor: ${proveedorSugerido || '____________________________'}    Guía Nº: ____________`,
    obraNombre, fecha,
    columnas: ['#', 'EPP', 'Tipo', 'Talla', 'Marca', 'Cantidad', 'Precio (S/)', 'Recibido'],
    filasVacias: 18,
    columnasAnchos: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 50 },
      2: { cellWidth: 22, halign: 'center' },
      3: { cellWidth: 14, halign: 'center' },
      4: { cellWidth: 24 },
      5: { cellWidth: 18, halign: 'right' },
      6: { cellWidth: 20, halign: 'right' },
      7: { cellWidth: 28 },
    },
    footer: 'Subir desde SSOMA → EPPs (Inventario) → Registrar Ingreso.',
  });
}

// ─── Plantilla 7: Entrega de EPPs (con firma) ───────────────────────
export async function plantillaSalidaEpps({ obraNombre, fecha, personal = [] }) {
  const filasPrellenadas = personal.slice(0, 8).map(p => [
    p.dni || '',
    `${p.nombres || ''} ${p.apellidos || ''}`.trim(),
    '', '', '', '', '', '', // EPP, tipo, talla, cantidad, marca, motivo, firma
  ]);
  const cantVacias = Math.max(8, 20 - filasPrellenadas.length);
  return renderPlantilla({
    titulo: 'Entrega de EPPs — registro físico SUNAFIL',
    subtitulo: 'Llenar EPP entregado, motivo (dotación/reposición/cambio/pérdida) y FIRMA del trabajador. Conservar 5 años.',
    obraNombre, fecha,
    columnas: ['DNI', 'Trabajador', 'EPP', 'Tipo', 'Talla', 'Cant.', 'Motivo', 'Firma trabajador'],
    filasPrellenadas,
    filasVacias: cantVacias,
    columnasAnchos: {
      0: { cellWidth: 22 },
      1: { cellWidth: 45 },
      2: { cellWidth: 32 },
      3: { cellWidth: 18, halign: 'center' },
      4: { cellWidth: 12, halign: 'center' },
      5: { cellWidth: 12, halign: 'center' },
      6: { cellWidth: 22 },
      7: { cellWidth: 30 },
    },
    footer: 'Original: archivo SSOMA (5 años). Copia: subir desde SSOMA → EPPs → Registrar Salida con firma.',
  });
}

// ─── Helper: descargar el doc generado ──────────────────────────────
export function descargarPlantilla(doc, filename) {
  doc.save(filename);
}
