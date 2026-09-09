// ═══════════════════════════════════════════════════════════════════
// JARVEX — ARMAR UN .docx DESDE TEXTO (tanda 15, entrega 7).
//
// Para que cada anexo de unas bases se pueda descargar como un Word editable
// y empezar a llenarlo, en vez de copiar y pegar de un documento de cien
// páginas. Funciona igual si las bases vinieron en PDF: el texto ya se extrajo
// en el triage, así que la conversión a Word sale de ahí sin costo.
//
// POR QUÉ A MANO Y NO CON UNA LIBRERÍA. Las librerías de .docx pesan cientos
// de kilobytes y traen un modelo de documento entero. Un .docx es un ZIP con
// tres archivos XML, y JSZip ya es dependencia del proyecto (la usa el lector
// de bases para abrir los .docx). Lo que hace falta —párrafos y un título en
// negrita— entra en este archivo, y no suma un byte al bundle inicial porque
// se carga recién al apretar el botón.
// ═══════════════════════════════════════════════════════════════════

/**
 * Escapa lo que XML no tolera.
 *
 * Un `&` suelto rompe el documento entero y Word se niega a abrirlo sin decir
 * por qué. Los caracteres de control además son ILEGALES en XML 1.0, y el OCR
 * los devuelve de vez en cuando: se quitan (se conservan el salto de línea y
 * la tabulación, que sí son válidos).
 */
const RX_CONTROL = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}]`, 'g');

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  .replace(RX_CONTROL, '');

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/** Un párrafo. `titulo` lo pone en negrita y un punto más grande. */
function parrafo(texto, { titulo = false } = {}) {
  const props = titulo
    ? '<w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>'
    : '<w:pPr><w:spacing w:after="120"/><w:jc w:val="both"/></w:pPr>';
  const runProps = titulo
    ? '<w:rPr><w:b/><w:sz w:val="26"/></w:rPr>'
    : '<w:rPr><w:sz w:val="22"/></w:rPr>';
  return `<w:p>${props}<w:r>${runProps}<w:t xml:space="preserve">${esc(texto)}</w:t></w:r></w:p>`;
}

/**
 * Un .docx con el texto dado.
 *
 * @param titulo primera línea, en negrita
 * @param texto  el cuerpo; cada salto de línea es un párrafo
 * @param pie    nota al final (de dónde salió el anexo), opcional
 * @returns Blob listo para descargar
 */
export async function textoADocx({ titulo = '', texto = '', pie = '' } = {}) {
  const JSZip = (await import('jszip')).default;
  const cuerpo = String(texto).split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => parrafo(l))
    .join('');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${titulo ? parrafo(titulo, { titulo: true }) : ''}
${cuerpo}
${pie ? parrafo(pie) : ''}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body></w:document>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', RELS);
  zip.file('word/document.xml', doc);
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
  });
}

/** Varios anexos en un solo ZIP, para bajarlos de una vez. */
export async function anexosAZip(partes, { nombreDe }) {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  for (const p of (partes || [])) {
    const blob = await textoADocx({ titulo: p.titulo, texto: p.texto, pie: p.pie || '' });
    zip.file(nombreDe(p), blob);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/** Dispara la descarga en el navegador. */
export function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Se libera después: revocar en el mismo tick cancela la descarga en Safari.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export default { textoADocx, anexosAZip, descargar };
