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

import { fragmentosPorPagina, normalizar, clave } from './bases-extraccion.js';

/**
 * Los rótulos que abren una parte. Salen de las bases reales peruanas: el
 * Anexo 13 de Chilete tiene «ANEXO A» a «ANEXO F» y «FORMATO N° 1» a
 * «FORMATO N° 18»; las bases estándar de OSCE/OECE usan «ANEXO N° 1» y
 * siguientes. Se captura el número para poder ordenar y nombrar el archivo.
 */
// Se corre sobre el texto YA normalizado (`normalizar` saca ° y º, y arregla
// los ceros a la izquierda), así que acá no hay que repetir esas trampas.
//
// Lo que sí contempla, medido sobre bases reales:
//   «ANEXO N 4-B»   los anexos de Obras por Impuestos llevan letra después del
//                   número, y saltan de 4-H a 4-J (no existe el 4-I).
//   «ANEXO A»       las bases de la supervisora numeran con letra sola.
//   «FORMATO N 12»  hasta tres dígitos.
//   «ANEXO N 4- B»  el kerning del PDF mete espacios dentro del rótulo.
const RX_PARTE = new RegExp(
  '^\\s*(' +
  '(?:ANEXO|FORMATO|FORMULARIO)\\s*(?:N\\s*)?([0-9]{1,3}\\s*-?\\s*[A-Z]?|[A-Z](?![A-Z]))' +
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
  let aparicion = 0;
  for (const d of (documentos || [])) {
    const s = String(d?.sobre || '').trim();
    if (!s) { sinSobre.push(d); continue; }
    const clave = normalizar(s);
    if (!grupos.has(clave)) {
      grupos.set(clave, { sobre: s, orden: ordenDeSobre(clave), aparicion: aparicion++, documentos: [] });
    }
    grupos.get(clave).documentos.push(d);
  }
  // Los numerados por su número; los demás, en el orden en que el documento
  // los nombró, que es el único orden que no inventa nada.
  const lista = [...grupos.values()].sort((a, b) => a.orden - b.orden || a.aparicion - b.aparicion);
  if (sinSobre.length) lista.push({ sobre: 'Sin sobre indicado', orden: 99, documentos: sinSobre, sinUbicar: true });
  return lista;
}

/**
 * «Sobre N° 2» → 2. El NÚMERO manda siempre.
 *
 * 🔴 Y no se puede adivinar por el contenido, que era lo que hacía antes.
 * Investigado el 8-set-2026 sobre bases reales: en Obras por Impuestos con
 * Empresa Privada el **sobre 2 es la propuesta ECONÓMICA y el 3 la TÉCNICA**,
 * porque el procedimiento abre primero la económica, elige la más favorable y
 * recién ahí evalúa la técnica de ESE postor. En las bases de la Entidad
 * Privada Supervisora, en cambio, el sobre 1 es la técnica y el 2 la
 * económica. Dos convenciones opuestas dentro del MISMO mecanismo.
 *
 * Por eso, sin número, se conserva el orden en que aparecen en el documento en
 * vez de imponer una lógica que sería falsa la mitad de las veces.
 */
function ordenDeSobre(clave) {
  const m = /(\d+)/.exec(clave);
  return m ? Number(m[1]) : 50;
}

export default { partirEnAnexos, nombreDeArchivo, agruparPorSobre, MIN_CHARS_PARTE };

// ═══════════════════════════════════════════════════════════════════
// QUÉ ANEXOS SE PRESENTAN DE VERDAD (9-set-2026)
//
// Gabriel: «los anexos has colocado demasiado, creo que deberías colocar los
// que pide que se presenten en los sobres nada más».
//
// Tiene razón, y la lista larga era una decisión mía mal calibrada: `partirEnAnexos`
// corta por rótulo, así que devuelve TODO lo que empiece con «ANEXO», «FORMATO»
// o «CAPÍTULO» — y en unas bases eso incluye los términos de referencia, las
// especificaciones técnicas, el proyecto de convenio y la memoria descriptiva.
// Nada de eso se llena ni se presenta: se LEE.
//
// Lo que se presenta es otra cosa y tiene una forma reconocible: son los
// FORMULARIOS, los modelos que el postor completa, firma y mete en un sobre.
// ═══════════════════════════════════════════════════════════════════

/** Un anexo que el postor LLENA y PRESENTA. */
const RX_SE_PRESENTA = new RegExp([
  'DECLARACION JURADA', 'DECLARACION', 'CARTA DE', 'CARTA ', 'MODELO DE',
  'PROMESA (FORMAL )?DE CONSORCIO', 'COMPROMISO', 'SOLICITUD',
  'EXPRESION DE INTERES', 'OFERTA ECONOMICA', 'PROPUESTA ECONOMICA',
  'PRECIO DE LA OFERTA', 'EXPERIENCIA DEL POSTOR', 'PERSONAL CLAVE PROPUESTO',
  'RELACION DE', 'ACREDITACION', 'AUTORIZACION', 'PODER', 'CONSTANCIA',
  'FORMULARIO', 'DATOS DEL POSTOR', 'PACTO DE INTEGRIDAD',
].join('|'));

/** Un anexo que se LEE, no se presenta: es parte de lo que la entidad informa. */
const RX_NO_SE_PRESENTA = new RegExp([
  'TERMINOS DE REFERENCIA', 'ESPECIFICACIONES TECNICAS', 'MEMORIA DESCRIPTIVA',
  'REQUISITOS DE CALIFICACION', 'FACTORES DE EVALUACION', 'CRONOGRAMA',
  'CALENDARIO', 'PROYECTO DE (CONTRATO|CONVENIO)', 'PROFORMA',
  'PRESUPUESTO', 'PLANOS', 'DEFINICIONES', 'GLOSARIO', 'BASES ',
  'ESTUDIO', 'FICHA TECNICA', 'EXPEDIENTE TECNICO', 'DISPOSICIONES',
  'CONDICIONES GENERALES', 'ALCANCE',
].join('|'));

/**
 * ¿Este anexo es de los que hay que presentar?
 *
 * Manda lo que digan las bases: si la lectura sacó la lista de documentos de
 * presentación, un anexo nombrado ahí se presenta y punto. Recién si esa lista
 * no existe se decide por la forma del título.
 *
 * @param titulo    el título del anexo
 * @param nombrados los `documento` de `documentos_presentacion` (opcional)
 */
export function anexoSePresenta(titulo, nombrados = null) {
  const t = normalizar(titulo);
  if (!t) return false;
  // Un CAPÍTULO nunca es un formulario: es una parte del cuerpo de las bases.
  if (/^CAPITULO\b/.test(t)) return false;
  if (Array.isArray(nombrados) && nombrados.length) {
    const k = clave(titulo);
    // El rótulo del anexo («ANEXO N 4-B») alcanza para reconocerlo dentro del
    // nombre largo con el que la lista lo menciona.
    const rotulo = k.match(/^(ANEXO|FORMATO|FORMULARIO)N?[0-9]{1,3}[A-Z]?/)?.[0];
    for (const nombre of nombrados) {
      const nk = clave(nombre);
      if (rotulo && nk.includes(rotulo)) return true;
      if (nk.length > 14 && k.includes(nk.slice(0, 40))) return true;
    }
  }
  if (RX_NO_SE_PRESENTA.test(t)) return false;
  return RX_SE_PRESENTA.test(t);
}

/**
 * Los anexos partidos en dos: los que se presentan y el resto.
 * La pantalla muestra los primeros y deja los otros detrás de un «ver todos».
 */
export function separarAnexos(partes, nombrados = null) {
  const sePresentan = [], soloLectura = [];
  for (const parte of (partes || [])) {
    (anexoSePresenta(parte?.titulo, nombrados) ? sePresentan : soloLectura).push(parte);
  }
  return { sePresentan, soloLectura };
}
