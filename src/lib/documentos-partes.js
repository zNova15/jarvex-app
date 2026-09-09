// ═══════════════════════════════════════════════════════════════════
// JARVEX — PARTIR UNAS BASES EN SUS ANEXOS (tanda 15, entrega 7).
//
// Gabriel, 8-set-2026: «me encantaría que me lo pueda separar […] es como
// separar un Word en diferentes words, para que yo los pueda descargar. Y en
// caso de que esté en PDF, sería espectacular que lo puedas convertir a Word
// para que yo lo pueda reutilizar».
//
// El caso de uso es concreto: armar una propuesta es LLENAR los anexos y
// formatos de las bases. Hoy eso se hace copiando y pegando de un Word de cien
// páginas, o peor, de un PDF. Si la app entrega cada anexo como su propio
// archivo editable, el trabajo empieza directamente en el papel que hay que
// llenar.
//
// LO QUE ESTO ES Y LO QUE NO ES. No es una conversión fiel: un .docx con
// tablas anidadas, sellos y firmas no se reproduce desde texto. Es el TEXTO de
// cada anexo, con sus párrafos, listo para completar y darle formato. Para la
// mayoría de los anexos —declaraciones juradas, cartas, formatos de datos— eso
// es exactamente lo que hace falta. Cuando el anexo es una tabla compleja,
// sigue estando el documento original.
//
// Puro: sin DOM, sin red. El armado del .docx vive en `docx-generar.js`.
// ═══════════════════════════════════════════════════════════════════

import { fragmentosPorPagina, normalizar } from './bases-extraccion.js';

/**
 * Los rótulos que abren una parte. Salen de las bases reales peruanas: el
 * Anexo 13 de Chilete tiene «ANEXO A» a «ANEXO F» y «FORMATO N° 1» a
 * «FORMATO N° 18»; las bases estándar de OSCE/OECE usan «ANEXO N° 1» y
 * siguientes. Se captura el número para poder ordenar y nombrar el archivo.
 */
const RX_PARTE = new RegExp(
  '^\\s*(' +
  '(?:ANEXO|FORMATO|FORMULARIO)\\s*(?:N\\s*[°º"]?\\s*)?([0-9]{1,3}|[A-Z](?![A-Z]))' +
  '|CAPITULO\\s+([IVXL]+)' +
  ')\\b',
);

/**
 * Un rótulo que viene del ÍNDICE de contenidos, no de la sección de verdad.
 * En un Word exportado, la línea del índice termina con el número de página
 * pegado al título («ANEXO C: REQUISITOS DE CALIFICACIÓN31») o con el relleno
 * de puntos. Cortar ahí daría 30 anexos de dos renglones.
 */
const RX_LINEA_DE_INDICE = /(\.{4,}\s*\d{1,3}|[a-zñ)]\s*\d{1,3})\s*$/i;

/** Caracteres mínimos para que una parte valga la pena. Por debajo es la línea
 *  del índice o un encabezado suelto, no el anexo. */
export const MIN_CHARS_PARTE = 220;

/**
 * Encuentra dónde empieza cada anexo o formato dentro del markdown y devuelve
 * el texto de cada uno.
 *
 * @returns [{ n, rotulo, titulo, texto, pagina, chars }]
 */
export function partirEnAnexos(markdown, { minChars = MIN_CHARS_PARTE } = {}) {
  const fragmentos = fragmentosPorPagina(markdown);
  // Renglón por renglón, conservando la página (o el tramo) de cada uno.
  const renglones = [];
  for (const f of fragmentos) {
    for (const linea of String(f.texto || '').split('\n')) {
      renglones.push({ linea, pagina: f.pagina ?? null });
    }
  }

  const cortes = [];
  renglones.forEach((r, i) => {
    const limpio = r.linea.trim();
    if (!limpio || limpio.length > 160) return;          // un párrafo no es un rótulo
    const m = RX_PARTE.exec(normalizar(limpio));
    if (!m) return;
    if (RX_LINEA_DE_INDICE.test(limpio)) return;         // es la tabla de contenidos
    cortes.push({ i, titulo: limpio.slice(0, 200), pagina: r.pagina, rotulo: m[1].trim() });
  });

  const partes = [];
  for (let k = 0; k < cortes.length; k++) {
    const desde = cortes[k].i;
    const hasta = k + 1 < cortes.length ? cortes[k + 1].i : renglones.length;
    const texto = renglones.slice(desde, hasta).map(r => r.linea).join('\n').trim();
    if (texto.length < minChars) continue;
    partes.push({
      n: partes.length + 1,
      titulo: cortes[k].titulo,
      rotulo: cortes[k].rotulo,
      pagina: cortes[k].pagina,
      texto,
      chars: texto.length,
    });
  }
  return partes;
}

/** Nombre de archivo seguro para un anexo. */
export function nombreDeArchivo(parte, sufijo = '.docx') {
  const base = String(parte?.titulo || `parte-${parte?.n || 1}`)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ._-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${base || 'anexo'}${sufijo}`;
}

/**
 * Los SOBRES: qué documento va en cada uno.
 *
 * Gabriel: «los sobres es algo que en toda base te explica qué es lo que deben
 * tener detalladamente […] en este caso serían los tres sobres, casi todas las
 * bases te piden eso».
 *
 * El dato ya se extrae —`documentos_presentacion` guarda el sobre de cada
 * documento— pero estaba mezclado en una lista larga de dieciocho renglones.
 * Esto lo agrupa por sobre, en el orden en que se presentan, y deja al final
 * los que la lectura no supo ubicar, que son trabajo pendiente y no basura.
 */
export function agruparPorSobre(documentos) {
  const grupos = new Map();
  const sinSobre = [];
  for (const d of (documentos || [])) {
    const s = String(d?.sobre || '').trim();
    if (!s) { sinSobre.push(d); continue; }
    const clave = normalizar(s);
    if (!grupos.has(clave)) grupos.set(clave, { sobre: s, orden: ordenDeSobre(clave), documentos: [] });
    grupos.get(clave).documentos.push(d);
  }
  const lista = [...grupos.values()].sort((a, b) => a.orden - b.orden || a.sobre.localeCompare(b.sobre));
  if (sinSobre.length) lista.push({ sobre: 'Sin sobre indicado', orden: 99, documentos: sinSobre, sinUbicar: true });
  return lista;
}

/**
 * «Sobre N° 2» → 2. Sin número se ordena por lo que contiene, que es el orden
 * en que se presentan: primero la acreditación, después la técnica y al final
 * la económica (que se abre aparte y solo si la técnica pasó).
 */
function ordenDeSobre(clave) {
  const m = /(\d+)/.exec(clave);
  if (m) return Number(m[1]);
  if (/ACREDITA|LEGAL|CAPACIDAD|EXPRESION DE INTERES/.test(clave)) return 1;
  if (/TECNIC/.test(clave)) return 2;
  if (/ECONOMIC|OFERTA ECONOMICA|PROPUESTA ECONOMICA/.test(clave)) return 3;
  return 50;
}

export default { partirEnAnexos, nombreDeArchivo, agruparPorSobre, MIN_CHARS_PARTE };
