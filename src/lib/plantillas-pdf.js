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
//
// Branding: si la obra tiene una empresa ejecutora con `logo_dataurl` y/o
// `nombre_corto`, el header los usa en vez de "JARVEX". Esto se controla
// con `empresaBrand = { nombre, logoDataUrl }`. Si no se pasa o están
// vacíos, cae al branding JARVEX por defecto.
function drawHeader(doc, { titulo, subtitulo, obraNombre, fecha, empresaBrand }) {
  const nombre = empresaBrand?.nombre?.trim() || 'JARVEX';
  const logo = empresaBrand?.logoDataUrl || null;

  // Banda superior
  doc.setFillColor(14, 22, 32);
  doc.rect(0, 0, PAGE_W, HEADER_BAND_H, 'F');

  // Logo a la izquierda si existe — ocupa el alto de la banda menos 4mm de
  // padding (≈14mm). Si no hay logo, mostramos el texto JARVEX/empresa
  // como antes.
  let textoX = MARGIN_X;
  if (logo) {
    try {
      const logoH = HEADER_BAND_H - 4;  // 14mm
      const logoW = logoH * 1.6;        // ancho máximo razonable
      doc.addImage(logo, 'JPEG', MARGIN_X, 2, logoW, logoH, undefined, 'FAST');
      textoX = MARGIN_X + logoW + 4;
    } catch (e) {
      // Si falla el addImage (dataURL corrupta, formato no soportado),
      // caemos al texto.
      textoX = MARGIN_X;
    }
  }

  doc.setTextColor(242, 183, 5);
  doc.setFontSize(logo ? 11 : 13);
  doc.setFont('helvetica', 'bold');
  // Truncar el nombre si es muy largo para no salirse de la banda
  const nombreFit = doc.splitTextToSize(nombre.toUpperCase(), PAGE_W - textoX - MARGIN_X - 10)[0];
  doc.text(nombreFit, textoX, 9);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.text('Plantilla imprimible · llenar a mano', textoX, 14);

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
async function renderPlantilla({ titulo, subtitulo, obraNombre, fecha, empresaBrand, columnas, filasPrellenadas = [], filasVacias = 20, columnasAnchos, footer }) {
  const { jsPDF, autoTable } = await loadPDF();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Calculamos altura del header (depende del wrap del subtitulo)
  const startY = drawHeader(doc, { titulo, subtitulo, obraNombre, fecha, empresaBrand });

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
        drawHeader(doc, { titulo, subtitulo, obraNombre, fecha, empresaBrand });
      }
    },
  });

  drawFooter(doc, footer);
  return doc;
}

// ─── Plantilla 1: Asistencia diaria ─────────────────────────────────
// Pre-llena los nombres del personal activo. El user marca asistencia y firma.
export async function plantillaAsistencia({ obraNombre, fecha, personal = [], empresaBrand }) {
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
    obraNombre, fecha, empresaBrand,
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
export async function plantillaIngresoMateriales({ obraNombre, fecha, proveedorSugerido = '', empresaBrand }) {
  return renderPlantilla({
    titulo: 'Ingreso de materiales',
    subtitulo: `Proveedor: ${proveedorSugerido || '____________________________'}    Guía Nº: ____________`,
    obraNombre, fecha, empresaBrand,
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
export async function plantillaSalidaMateriales({ obraNombre, fecha, retiraSugerido = '', empresaBrand }) {
  return renderPlantilla({
    titulo: 'Salida de materiales',
    subtitulo: `Quien retira: ${retiraSugerido || '____________________________'}    Vale Nº: ____________    Frente/Zona: ____________`,
    obraNombre, fecha, empresaBrand,
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
export async function plantillaIngresoHerramientas({ obraNombre, fecha, proveedorSugerido = '', empresaBrand }) {
  return renderPlantilla({
    titulo: 'Ingreso de herramientas',
    subtitulo: `Proveedor: ${proveedorSugerido || '____________________________'}    Guía Nº: ____________`,
    obraNombre, fecha, empresaBrand,
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
export async function plantillaSalidaHerramientas({ obraNombre, fecha, empresaBrand }) {
  return renderPlantilla({
    titulo: 'Salida y devolución de herramientas',
    subtitulo: 'Marcar fecha estimada de devolución. Devolver firmado a almacén.',
    obraNombre, fecha, empresaBrand,
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
export async function plantillaIngresoEpps({ obraNombre, fecha, proveedorSugerido = '', empresaBrand }) {
  return renderPlantilla({
    titulo: 'Ingreso de EPPs (Equipos de Protección Personal)',
    subtitulo: `Proveedor: ${proveedorSugerido || '____________________________'}    Guía Nº: ____________`,
    obraNombre, fecha, empresaBrand,
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

// ─── Plantilla 7: Entrega de EPPs (formato SUNAFIL completo) ────────
// Formato basado en el modelo F-SSO-05 del cliente: una hoja por
// trabajador, con los 29 EPPs pre-cargados agrupados por TIPO y tres
// columnas de control (NUEVO, RENOVACIÓN 1, RENOVACIÓN 2) cada una con
// CANT y FECHA. Se imprime, se llena a mano cuando el trabajador recibe
// EPPs, y se firma. Conservar 5 años (exigencia SUNAFIL).
//
// Layout: A4 horizontal — entran las 11 columnas sin apretarse.
// Branding: si empresaBrand trae logo+nombre, los usa en el header;
// si no, cae a JARVEX.
const EPP_CATEGORIAS = [
  { tipo: 'UNIFORME', items: [
    ['01', 'MAMELUCO DRILL', 'UND'],
    ['02', 'CHALECO REFLECTIVO', 'UND'],
    ['03', 'POLO MANGALARGA', 'UND'],
    ['04', 'TRAJE TYVEK', 'UND'],
  ]},
  { tipo: 'PROTECCIÓN DE CABEZA Y OJOS', items: [
    ['05', 'CASCO DE SEGURIDAD', 'UND'],
    ['06', 'BARBIQUEJO', 'UND'],
    ['07', 'LENTES CLAROS', 'UND'],
    ['08', 'LENTES OSCUROS', 'UND'],
  ]},
  { tipo: 'PROTECCIÓN AUDITIVA', items: [
    ['09', 'TAPÓN DE OÍDO', 'UND'],
    ['10', 'OREJERA PARA CASCO', 'PAR'],
  ]},
  { tipo: 'PROTECCIÓN RESPIRATORIA', items: [
    ['11', 'RESPIRADOR CARA COMPLETA', 'UND'],
    ['12', 'RESPIRADOR MEDIA CARA', 'UND'],
    ['13', 'RESPIRADOR DESCARTABLE', 'UND'],
    ['14', 'FILTROS PARA POLVO', 'PAR'],
    ['15', 'FILTROS PARA GASES', 'PAR'],
  ]},
  { tipo: 'PROTECCIÓN DE MANOS', items: [
    ['16', 'GUANTES DE BADANA', 'UND'],
    ['17', 'GUANTES DE CUERO', 'PAR'],
    ['18', 'GUANTES MULTIPROPÓSITO', 'PAR'],
    ['19', 'GUANTES NEOPRENE', 'PAR'],
  ]},
  { tipo: 'PROTECCIÓN DE PIE', items: [
    ['20', 'ZAPATO DE SEGURIDAD CON PUNTA DE ACERO', 'PAR'],
  ]},
  { tipo: 'PROTECCIÓN DE PIEL', items: [
    ['21', 'BLOQUEADOR SOLAR', 'UND'],
    ['22', 'CORTAVIENTO', 'UND'],
  ]},
  { tipo: 'PROTECCIÓN PARA TRABAJOS EN CALIENTE', items: [
    ['23', 'CARETA DE SOLDAR', 'UND'],
    ['24', 'CASACA Y PANTALÓN DE CUERO', 'UND'],
    ['25', 'MANDIL DE CUERO', 'UND'],
    ['26', 'GUANTES DE SOLDAR', 'UND'],
    ['27', 'MANGAS DE SOLDAR', 'UND'],
  ]},
  { tipo: 'EPP COLECTIVO', items: [
    ['28', 'ARNÉS DE SEGURIDAD', 'UND'],
    ['29', 'ESLINGA DE CONEXIÓN', 'UND'],
  ]},
  { tipo: 'OTROS', items: [
    ['30', '', 'UND'],
  ]},
];

export async function plantillaSalidaEpps({ obraNombre, fecha, empresaBrand }) {
  const { jsPDF, autoTable } = await loadPDF();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // A4 landscape: 297 x 210. Margenes 8mm.
  const PW = 297, PH = 210, MX = 8;
  const CW = PW - MX * 2; // 281

  const nombreEmpresa = (empresaBrand?.nombre || 'JARVEX').toUpperCase();
  const logo = empresaBrand?.logoDataUrl || null;
  const codigo = empresaBrand?.codigoDocPrefix || 'F-SSO-05';

  // ── Cabecera tipo formato SUNAFIL ─────────────────────────────────
  // Caja [logo · TÍTULO grande · metadata]. 22mm de alto.
  const headY = 8;
  const headH = 22;
  doc.setDrawColor(0); doc.setLineWidth(0.3);
  doc.rect(MX, headY, CW, headH);
  // Divisores verticales
  const logoW = 38, metaW = 50;
  doc.line(MX + logoW, headY, MX + logoW, headY + headH);
  doc.line(MX + CW - metaW, headY, MX + CW - metaW, headY + headH);

  // Logo (o nombre empresa) a la izquierda
  if (logo) {
    try {
      doc.addImage(logo, 'JPEG', MX + 2, headY + 2, logoW - 4, headH - 4, undefined, 'FAST');
    } catch {}
  } else {
    doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.setTextColor(20);
    const lineas = doc.splitTextToSize(nombreEmpresa, logoW - 4);
    let yt = headY + headH/2 - (lineas.length * 4.5)/2 + 3;
    for (const l of lineas) { doc.text(l, MX + logoW/2, yt, { align:'center' }); yt += 4.5; }
  }

  // Título central
  doc.setFontSize(14); doc.setFont('helvetica','bold'); doc.setTextColor(0);
  const titulo = 'REGISTRO DE ENTREGA DE EQUIPOS DE PROTECCIÓN PERSONAL EPP';
  const tituloLines = doc.splitTextToSize(titulo, CW - logoW - metaW - 8);
  let ty = headY + headH/2 - (tituloLines.length * 5)/2 + 4;
  for (const l of tituloLines) { doc.text(l, MX + logoW + (CW - logoW - metaW)/2, ty, { align:'center' }); ty += 5; }

  // Metadata derecha (código + vigencia + versión)
  const metaX = MX + CW - metaW;
  doc.setFontSize(9); doc.setFont('helvetica','bold');
  doc.text(`COD. ${codigo}`, metaX + metaW/2, headY + 6, { align:'center' });
  doc.setFontSize(7.5); doc.setFont('helvetica','normal');
  doc.text('Vigente desde:', metaX + 2, headY + 11);
  doc.text(fmtFecha(fecha || new Date().toISOString().slice(0,10)), metaX + metaW - 2, headY + 11, { align:'right' });
  doc.text('Versión 01', metaX + metaW/2, headY + 17, { align:'center' });

  let y = headY + headH;

  // ── PROYECTO / LUGAR / FECHA / DATOS DEL TRABAJADOR ──────────────
  // Fila PROYECTO
  const labelW = 30;
  doc.setLineWidth(0.2);
  const row = (label, valor, h = 8, vAlign='middle') => {
    doc.rect(MX, y, labelW, h);
    doc.rect(MX + labelW, y, CW - labelW, h);
    doc.setFont('helvetica','bold'); doc.setFontSize(8.5);
    doc.text(label, MX + 2, y + h/2 + 1.2);
    doc.setFont('helvetica','normal');
    if (valor) {
      const lines = doc.splitTextToSize(String(valor), CW - labelW - 4);
      const baseY = vAlign === 'top' ? y + 4 : y + h/2 - (lines.length-1)*1.8 + 1.2;
      for (let i = 0; i < lines.length; i++) doc.text(lines[i], MX + labelW + 2, baseY + i*3.6);
    }
    y += h;
  };
  // Proyecto puede ser largo — calcular alto dinámico
  doc.setFont('helvetica','normal'); doc.setFontSize(8.5);
  const proyTxt = obraNombre || '________________________';
  const proyLines = doc.splitTextToSize(`Obra: ${proyTxt}`, CW - labelW - 4);
  const proyH = Math.max(8, proyLines.length * 4 + 2);
  doc.rect(MX, y, labelW, proyH);
  doc.rect(MX + labelW, y, CW - labelW, proyH);
  doc.setFont('helvetica','bold'); doc.text('PROYECTO:', MX + 2, y + 5);
  doc.setFont('helvetica','normal');
  for (let i = 0; i < proyLines.length; i++) doc.text(proyLines[i], MX + labelW + 2, y + 5 + i*4);
  y += proyH;

  // LUGAR + FECHA (split horizontal)
  doc.rect(MX, y, labelW, 8);
  doc.rect(MX + labelW, y, CW - labelW - 60, 8);
  doc.rect(MX + CW - 60, y, 20, 8);
  doc.rect(MX + CW - 40, y, 40, 8);
  doc.setFont('helvetica','bold');
  doc.text('LUGAR:', MX + 2, y + 5);
  doc.text('FECHA:', MX + CW - 58, y + 5);
  y += 8;

  // DATOS DEL TRABAJADOR (banner)
  doc.setFillColor(240, 230, 200);
  doc.rect(MX, y, CW, 6, 'FD');
  doc.setFont('helvetica','bold'); doc.setFontSize(9);
  doc.text('DATOS DEL TRABAJADOR:', MX + 2, y + 4.2);
  y += 6;

  // Header de campos trabajador
  const tw = { nom: CW - 50 - 60, dni: 50, car: 60 };
  doc.setFillColor(252, 232, 192);
  doc.rect(MX, y, tw.nom, 6, 'FD');
  doc.rect(MX + tw.nom, y, tw.dni, 6, 'FD');
  doc.rect(MX + tw.nom + tw.dni, y, tw.car, 6, 'FD');
  doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(0);
  doc.text('APELLIDOS Y NOMBRES', MX + tw.nom/2, y + 4.2, { align:'center' });
  doc.text('DNI', MX + tw.nom + tw.dni/2, y + 4.2, { align:'center' });
  doc.text('CARGO', MX + tw.nom + tw.dni + tw.car/2, y + 4.2, { align:'center' });
  y += 6;
  // Fila vacía para llenar
  doc.rect(MX, y, tw.nom, 8);
  doc.rect(MX + tw.nom, y, tw.dni, 8);
  doc.rect(MX + tw.nom + tw.dni, y, tw.car, 8);
  y += 8 + 2;

  // ── Tabla de control de entrega ──────────────────────────────────
  // 11 columnas. Anchos suman CW = 281mm.
  const colWidths = {
    tipo: 38, item: 12, desc: 70, und: 12,
    nuevoCant: 14, nuevoFecha: 22,
    ren1Cant: 14, ren1Fecha: 22,
    ren2Cant: 14, ren2Fecha: 22,
    obs: 41,
  };
  // sum = 38+12+70+12+14+22+14+22+14+22+41 = 281 ✓

  // Construir filas con rowSpan por TIPO
  const body = [];
  for (const cat of EPP_CATEGORIAS) {
    for (let i = 0; i < cat.items.length; i++) {
      const [item, desc, und] = cat.items[i];
      const row = [];
      if (i === 0) {
        row.push({ content: cat.tipo, rowSpan: cat.items.length,
          styles: { valign:'middle', halign:'center', fontStyle:'bold', fontSize:7.5, fillColor:[252,232,192] } });
      }
      row.push({ content: item, styles: { halign:'center', fontStyle:'bold' } });
      row.push({ content: desc, styles: { halign:'left' } });
      row.push({ content: und, styles: { halign:'center' } });
      // 6 celdas vacías de control + 1 observ.
      row.push(''); row.push(''); row.push(''); row.push(''); row.push(''); row.push(''); row.push('');
      body.push(row);
    }
  }

  // Header en 3 niveles (autotable acepta head como array de filas)
  const head = [
    [
      { content: 'TIPO', rowSpan: 3, styles: { valign:'middle', halign:'center' } },
      { content: 'ITEM N°', rowSpan: 3, styles: { valign:'middle', halign:'center' } },
      { content: 'UNIFORME, EPP y EM', rowSpan: 3, styles: { valign:'middle', halign:'center' } },
      { content: 'UND', rowSpan: 3, styles: { valign:'middle', halign:'center' } },
      { content: 'CONTROL DE ENTREGA:', colSpan: 6, styles: { halign:'center' } },
      { content: 'OBSERV.', rowSpan: 3, styles: { valign:'middle', halign:'center' } },
    ],
    [
      { content: 'NUEVO', colSpan: 2, styles: { halign:'center', fillColor:[240,240,240] } },
      { content: 'RENOVACIÓN N°01', colSpan: 2, styles: { halign:'center', fillColor:[224,238,224] } },
      { content: 'RENOVACIÓN N°02', colSpan: 2, styles: { halign:'center', fillColor:[252,232,192] } },
    ],
    [
      { content: 'CANT.', styles: { halign:'center', fillColor:[240,240,240] } },
      { content: 'FECHA', styles: { halign:'center', fillColor:[240,240,240] } },
      { content: 'CANT.', styles: { halign:'center', fillColor:[224,238,224] } },
      { content: 'FECHA', styles: { halign:'center', fillColor:[224,238,224] } },
      { content: 'CANT.', styles: { halign:'center', fillColor:[252,232,192] } },
      { content: 'FECHA', styles: { halign:'center', fillColor:[252,232,192] } },
    ],
  ];

  autoTable(doc, {
    head,
    body,
    startY: y,
    margin: { left: MX, right: MX, bottom: 30 },
    theme: 'grid',
    headStyles: { fontSize: 7.5, fontStyle: 'bold', textColor: 20, fillColor: [252,232,192], lineWidth: 0.2 },
    bodyStyles: { fontSize: 7.5, minCellHeight: 6, valign: 'middle', lineWidth: 0.2, textColor: 20 },
    columnStyles: {
      0: { cellWidth: colWidths.tipo },
      1: { cellWidth: colWidths.item },
      2: { cellWidth: colWidths.desc },
      3: { cellWidth: colWidths.und },
      4: { cellWidth: colWidths.nuevoCant },
      5: { cellWidth: colWidths.nuevoFecha },
      6: { cellWidth: colWidths.ren1Cant },
      7: { cellWidth: colWidths.ren1Fecha },
      8: { cellWidth: colWidths.ren2Cant },
      9: { cellWidth: colWidths.ren2Fecha },
      10: { cellWidth: colWidths.obs },
    },
  });

  // ── Pie: VERIFICADO POR + 3 firmas + Especialista en Seguridad ──
  const afterTableY = doc.lastAutoTable.finalY + 3;
  // Si no entra (page break casi al borde), saltamos a otra página
  let footerY = afterTableY;
  if (footerY > PH - 28) {
    doc.addPage();
    footerY = 12;
  }

  // VERIFICADO POR (línea simple a la izquierda)
  doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(0);
  doc.text('VERIFICADO POR:', MX, footerY + 5);
  doc.setLineWidth(0.3);
  doc.line(MX + 32, footerY + 6, MX + 110, footerY + 6);

  // 3 boxes FIRMA DEL TRABAJADOR
  const firmaW = (CW - 120) / 3;
  for (let i = 0; i < 3; i++) {
    const fx = MX + 120 + i * firmaW;
    doc.rect(fx, footerY, firmaW - 2, 16);
    doc.setFontSize(7.5); doc.setFont('helvetica','bold');
    doc.text('FIRMA DEL TRABAJADOR', fx + (firmaW-2)/2, footerY + 14, { align:'center' });
  }

  // Especialista en Seguridad debajo de VERIFICADO POR
  doc.setFontSize(8); doc.setFont('helvetica','italic'); doc.setTextColor(80);
  doc.text('Especialista en Seguridad', MX + 32, footerY + 11);

  // Footer estándar (Página X de Y)
  doc.setTextColor(128); doc.setFont('helvetica','normal'); doc.setFontSize(7);
  doc.text('Original: archivo SSOMA (5 años). Copia: subir desde SSOMA → EPPs → Registrar Salida con firma.', MX, PH - 5);
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setTextColor(128); doc.setFont('helvetica','normal'); doc.setFontSize(7);
    const pagTxt = `Página ${i} de ${pageCount}`;
    doc.text(pagTxt, PW - MX - doc.getTextWidth(pagTxt), PH - 5);
  }

  return doc;
}

// ─── Plantilla 8: Diario combinado de materiales (ingreso + salida) ──
export async function plantillaDiarioMateriales({ obraNombre, fecha, recibidoSugerido = '', empresaBrand }) {
  return renderPlantilla({
    titulo: 'Movimientos diarios de materiales',
    subtitulo: `Una línea por movimiento. E = entrada (ingreso) · S = salida. Llenar con bolígrafo. Recibe/Entrega: ${recibidoSugerido || '____________________________'}`,
    obraNombre, fecha, empresaBrand,
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
export async function plantillaDiarioHerramientas({ obraNombre, fecha, recibidoSugerido = '', empresaBrand }) {
  return renderPlantilla({
    titulo: 'Movimientos diarios de herramientas',
    subtitulo: `Una línea por movimiento. E = entrada (devolución) · S = salida (préstamo). Almacenero: ${recibidoSugerido || '____________________________'}`,
    obraNombre, fecha, empresaBrand,
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
export async function plantillaParteDiarioMaquinaria({ obraNombre, fecha, maquinarias = [], empresaBrand }) {
  const filasPrellenadas = (maquinarias || []).slice(0, 6).map(m => [
    m.codigo || m.placa || '',
    m.descripcion || m.tipo || '',
    '', '', '', '', '', '',
  ]);
  const cantVacias = Math.max(6, 12 - filasPrellenadas.length);
  return renderPlantilla({
    titulo: 'Parte diario de maquinaria',
    subtitulo: 'Operador firma al inicio y al final del turno. Combustible registrar con surtidor o galones. Reportar averías de inmediato.',
    obraNombre, fecha, empresaBrand,
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
