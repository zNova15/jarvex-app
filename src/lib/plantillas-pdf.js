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

// Constantes de layout (A4 portrait: 210x297 mm)
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 10;        // margen izquierdo/derecho
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const HEADER_BAND_H = 18;   // banda negra superior con "JARVEX"
const FOOTER_Y = 285;       // línea de footer

// Dibuja la cabecera y devuelve la Y donde puede arrancar la tabla.
// El subtitulo hace wrap automático para no salirse del margen ni
// sobreponerse con la línea de Obra/Fecha. Cuanto más subtítulo, más
// abajo arranca la tabla — todo coherente.
function drawHeader(doc, { titulo, subtitulo, obraNombre, fecha }) {
  // Banda negra superior
  doc.setFillColor(14, 22, 32);
  doc.rect(0, 0, PAGE_W, HEADER_BAND_H, 'F');
  doc.setTextColor(242, 183, 5);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('JARVEX', MARGIN_X, 9);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.text('Plantilla imprimible · llenar a mano', MARGIN_X, 14);

  // Título
  let y = HEADER_BAND_H + 7;          // 25
  doc.setTextColor(0);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(titulo || '', MARGIN_X, y);
  y += 6;

  // Subtítulo con wrap (multi-línea si excede ancho disponible)
  if (subtitulo) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const lineas = doc.splitTextToSize(subtitulo, CONTENT_W);
    for (const linea of lineas) {
      doc.text(linea, MARGIN_X, y);
      y += 4.5;
    }
    y += 1.5;
  } else {
    y += 1;
  }

  // Línea Obra (izq) + Fecha (der). La fecha se ancla al margen derecho
  // para evitar overlap si el nombre de obra es largo.
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Obra: ${obraNombre || '____________________'}`, MARGIN_X, y);
  const fechaTxt = `Fecha: ${fmtFecha(fecha)}`;
  const fechaW = doc.getTextWidth(fechaTxt);
  doc.text(fechaTxt, PAGE_W - MARGIN_X - fechaW, y);
  y += 6;

  // Línea separadora sutil
  doc.setDrawColor(200);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);

  return y + 4;  // dónde puede arrancar la tabla
}

function drawFooter(doc, footerText) {
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(128);
    const txt = footerText || 'Llenar con bolígrafo. Subir al sistema con foto/escan al final del día.';
    const lineas = doc.splitTextToSize(txt, CONTENT_W - 30); // dejamos espacio para el nº de página
    let y = FOOTER_Y;
    for (const l of lineas) {
      doc.text(l, MARGIN_X, y);
      y += 3.5;
    }
    const pagTxt = `Página ${i} de ${pageCount}`;
    const pagW = doc.getTextWidth(pagTxt);
    doc.text(pagTxt, PAGE_W - MARGIN_X - pagW, FOOTER_Y);
  }
}

// Render genérico: dibuja header en cada página vía didDrawPage y reserva
// margin.top para que el body de la tabla nunca pise el header.
async function renderPlantilla({ titulo, subtitulo, obraNombre, fecha, columnas, filasPrellenadas = [], filasVacias = 20, columnasAnchos, footer }) {
  const { jsPDF, autoTable } = await loadPDF();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Calculamos altura del header (depende del wrap del subtitulo)
  const startY = drawHeader(doc, { titulo, subtitulo, obraNombre, fecha });

  const filasFinales = [
    ...filasPrellenadas,
    ...Array.from({ length: filasVacias }, () => columnas.map(() => '')),
  ];

  autoTable(doc, {
    head: [columnas],
    body: filasFinales,
    startY,
    margin: { top: startY, left: MARGIN_X, right: MARGIN_X, bottom: 18 },
    headStyles: { fillColor: [28, 45, 64], textColor: 255, fontSize: 8.5, halign: 'center', valign: 'middle' },
    bodyStyles: { fontSize: 8.5, minCellHeight: 8, valign: 'middle' },
    alternateRowStyles: { fillColor: [248, 248, 248] },
    columnStyles: columnasAnchos || {},
    // Re-dibujar el header al inicio de cada página nueva (después de la 1ª).
    // No tocamos el body — autotable respeta margin.top.
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        drawHeader(doc, { titulo, subtitulo, obraNombre, fecha });
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
    columnas: ['DNI', 'Apellidos y nombres', 'Cargo', 'Est.', 'Entr.', 'Sal.', 'Hrs', 'Firma'],
    filasPrellenadas,
    filasVacias: cantVacias,
    // Total: 188mm (CONTENT_W=190)
    columnasAnchos: {
      0: { cellWidth: 20 },
      1: { cellWidth: 56 },
      2: { cellWidth: 26 },
      3: { cellWidth: 12, halign: 'center' },
      4: { cellWidth: 14, halign: 'center' },
      5: { cellWidth: 14, halign: 'center' },
      6: { cellWidth: 12, halign: 'center' },
      7: { cellWidth: 34 },
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
    columnas: ['#', 'Material', 'Unidad', 'Cantidad', 'Precio S/', 'Total S/', 'Recibido por'],
    filasVacias: 22,
    // Total: 188mm
    columnasAnchos: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 70 },
      2: { cellWidth: 18, halign: 'center' },
      3: { cellWidth: 22, halign: 'right' },
      4: { cellWidth: 22, halign: 'right' },
      5: { cellWidth: 22, halign: 'right' },
      6: { cellWidth: 26 },
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
    // Total: 188mm
    columnasAnchos: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 76 },
      2: { cellWidth: 18, halign: 'center' },
      3: { cellWidth: 22, halign: 'right' },
      4: { cellWidth: 22, halign: 'right' },
      5: { cellWidth: 42 },
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
    // Total: 188mm
    columnasAnchos: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 52 },
      2: { cellWidth: 24 },
      3: { cellWidth: 24 },
      4: { cellWidth: 26 },
      5: { cellWidth: 18, halign: 'center' },
      6: { cellWidth: 36 },
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
    columnas: ['#', 'Herramienta', 'Cant.', 'Responsable / DNI', 'Devol. est.', 'Firma retira', 'Firma devuelve'],
    filasVacias: 18,
    // Total: 188mm
    columnasAnchos: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 52 },
      2: { cellWidth: 14, halign: 'right' },
      3: { cellWidth: 38 },
      4: { cellWidth: 22, halign: 'center' },
      5: { cellWidth: 27 },
      6: { cellWidth: 27 },
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
    columnas: ['#', 'EPP', 'Tipo', 'Talla', 'Marca', 'Cant.', 'Precio S/', 'Recibido'],
    filasVacias: 18,
    // Total: 188mm
    columnasAnchos: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 52 },
      2: { cellWidth: 22, halign: 'center' },
      3: { cellWidth: 14, halign: 'center' },
      4: { cellWidth: 24 },
      5: { cellWidth: 14, halign: 'right' },
      6: { cellWidth: 22, halign: 'right' },
      7: { cellWidth: 32 },
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
    titulo: 'Entrega de EPPs — registro físico (SUNAFIL)',
    subtitulo: 'Llenar EPP, motivo (dotación / reposición / cambio / pérdida) y firma del trabajador. Conservar 5 años.',
    obraNombre, fecha,
    columnas: ['DNI', 'Trabajador', 'EPP', 'Tipo', 'Talla', 'Cant.', 'Motivo', 'Firma trabajador'],
    filasPrellenadas,
    filasVacias: cantVacias,
    // Total: 188mm
    columnasAnchos: {
      0: { cellWidth: 20 },
      1: { cellWidth: 42 },
      2: { cellWidth: 30 },
      3: { cellWidth: 18, halign: 'center' },
      4: { cellWidth: 12, halign: 'center' },
      5: { cellWidth: 12, halign: 'center' },
      6: { cellWidth: 22 },
      7: { cellWidth: 32 },
    },
    footer: 'Original: archivo SSOMA (5 años). Copia: subir desde SSOMA → EPPs → Registrar Salida con firma.',
  });
}

// ─── Plantilla 8: Diario combinado de materiales (ingreso + salida) ──
export async function plantillaDiarioMateriales({ obraNombre, fecha, recibidoSugerido = '' }) {
  return renderPlantilla({
    titulo: 'Movimientos diarios de materiales',
    subtitulo: `Una línea por movimiento. E = entrada (ingreso) · S = salida. Llenar con bolígrafo. Recibe/Entrega: ${recibidoSugerido || '____________________________'}`,
    obraNombre, fecha,
    columnas: ['Hora', 'E/S', 'Material', 'Unidad', 'Cantidad', 'Documento', 'Firma'],
    filasVacias: 24,
    columnasAnchos: {
      0: { cellWidth: 16, halign: 'center' },
      1: { cellWidth: 12, halign: 'center' },
      2: { cellWidth: 60 },
      3: { cellWidth: 18, halign: 'center' },
      4: { cellWidth: 22, halign: 'right' },
      5: { cellWidth: 26 },
      6: { cellWidth: 34 },
    },
    footer: 'Subir al sistema desde Materiales → Mov. Materiales (lote diario). Adjuntar foto de esta hoja.',
  });
}

// ─── Plantilla 9: Diario combinado de herramientas (ingreso + salida) ─
export async function plantillaDiarioHerramientas({ obraNombre, fecha, recibidoSugerido = '' }) {
  return renderPlantilla({
    titulo: 'Movimientos diarios de herramientas',
    subtitulo: `Una línea por movimiento. E = entrada (devolución) · S = salida (préstamo). Almacenero: ${recibidoSugerido || '____________________________'}`,
    obraNombre, fecha,
    columnas: ['Hora', 'E/S', 'Herramienta', 'Cantidad', 'Estado', 'Quien retira/devuelve', 'Firma'],
    filasVacias: 24,
    columnasAnchos: {
      0: { cellWidth: 16, halign: 'center' },
      1: { cellWidth: 12, halign: 'center' },
      2: { cellWidth: 50 },
      3: { cellWidth: 18, halign: 'center' },
      4: { cellWidth: 24, halign: 'center' },
      5: { cellWidth: 38 },
      6: { cellWidth: 30 },
    },
    footer: 'Subir desde Herramientas → Mov. Herramientas. Reportar al instante cualquier daño o pérdida.',
  });
}

// ─── Plantilla 10: Parte diario de maquinaria ───────────────────────
export async function plantillaParteDiarioMaquinaria({ obraNombre, fecha, maquinarias = [] }) {
  const filasPrellenadas = (maquinarias || []).slice(0, 6).map(m => [
    m.codigo || m.placa || '',
    m.descripcion || m.tipo || '',
    '', '', '', '', '', '',
  ]);
  const cantVacias = Math.max(6, 12 - filasPrellenadas.length);
  return renderPlantilla({
    titulo: 'Parte diario de maquinaria',
    subtitulo: 'Operador firma al inicio y al final del turno. Combustible registrar con surtidor o galones. Reportar averías de inmediato.',
    obraNombre, fecha,
    columnas: ['Equipo', 'Descripción', 'Operador', 'Hora ini.', 'Hora fin', 'Hrs trab.', 'Combust. (gal)', 'Firma'],
    filasPrellenadas,
    filasVacias: cantVacias,
    columnasAnchos: {
      0: { cellWidth: 20 },
      1: { cellWidth: 36 },
      2: { cellWidth: 36 },
      3: { cellWidth: 16, halign: 'center' },
      4: { cellWidth: 16, halign: 'center' },
      5: { cellWidth: 14, halign: 'center' },
      6: { cellWidth: 18, halign: 'right' },
      7: { cellWidth: 32 },
    },
    footer: 'Subir desde Activos Pesados → Horas Máquina y Consumos Combustible al cierre del turno.',
  });
}

// ─── Helper: descargar el doc generado ──────────────────────────────
export function descargarPlantilla(doc, filename) {
  doc.save(filename);
}
