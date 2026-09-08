// ═══════════════════════════════════════════════════════════════════
// JARVEX — TRIAGE DE BASES DE LICITACIÓN (tanda 15).
//
// Decide, ANTES de gastar un centavo de OCR, qué parte de un documento de
// bases ya es texto y qué parte hay que leer con OCR. No llama a ninguna IA:
// es aritmética sobre el archivo.
//
// POR QUÉ NO ES "ESTE DOCUMENTO NECESITA OCR": porque ningún documento de
// bases es 100% una cosa. Medido sobre las bases reales del proceso de Chilete
// (Gobierno Regional de Cajamarca, 8-set-2026):
//
//   Anexo 12 (ejecución) : 200.962 caracteres NATIVOS + 15 páginas escaneadas
//   Anexo 13 (supervisión): 125.064 caracteres NATIVOS + 17 páginas escaneadas
//   El Peruano (2 avisos) : 100% nativo, CERO páginas a OCR
//
// Decidirlo a nivel de documento es incorrecto en las dos direcciones: manda a
// OCR 326.000 caracteres que ya eran perfectos (y les mete errores), o deja sin
// leer los Términos de Referencia, que son justo donde están los requisitos.
//
// ── EL HALLAZGO QUE HACE QUE ESTO NO SEA UNA HEURÍSTICA ──
// En un .docx NO hay que adivinar nada: el documento DECLARA la rotación de
// cada imagen en su propio XML (`<a:xfrm rot="...">`, en 60.000-avos de grado).
// En las bases de Chilete las páginas escaneadas del TDR vienen de costado, y
// el Word lo dice: rot=270° en 15 de 16 imágenes del Anexo 12.
//
// Y OJO — en ese mismo documento hay 12 imágenes a 270° y 3 a 90°. Rotar todo
// 90° "a ojo" corrompe esas 3. El atributo del documento es la única fuente
// confiable, y por eso este archivo lo lee en vez de estimarlo.
//
// El tamaño de la caja separa la página escaneada del adorno: las del TDR
// miden 22–27 cm de ancho; el logo de la carátula, 7,7 cm.
//
// La parte de decisión es PURA y testeable sin navegador. Solo `bloquesDeDocx`
// toca JSZip, y es un lector, no un criterio.
// ═══════════════════════════════════════════════════════════════════

// ── Umbrales, todos con su medición detrás ─────────────────────────

/** Ancho de caja (cm) desde el que una imagen es una PÁGINA y no un adorno.
 *  Medido: páginas del TDR 22,3–26,6 cm · logo de carátula 7,7 cm. */
export const UMBRAL_PAGINA_CM = 15;

/** Caracteres alfabéticos mínimos para dar una página por nativa.
 *  Medido: El Peruano 8.620 y 9.549 · una página escaneada da 0. El piso está
 *  MUY por debajo de lo real a propósito: una portada con poco texto es
 *  nativa igual, y mandarla a OCR sería gastar por nada. */
export const MIN_ALFA_NATIVA = 80;

/** Proporción de letras sobre el total. Una extracción "de basura" (típica de
 *  un PDF escaneado con una capa de texto mala) devuelve mucho símbolo suelto.
 *  Medido: El Peruano 0,71. */
export const MIN_RATIO_ALFA = 0.35;

/** EMU (English Metric Units) por centímetro — la unidad de OOXML. */
const EMU_POR_CM = 360000;
/** OOXML guarda los ángulos en 60.000-avos de grado. */
const UNIDADES_POR_GRADO = 60000;

// ── Decisiones puras ───────────────────────────────────────────────

/** Proporción de caracteres alfabéticos (con tildes y ñ) sobre el total. */
export function ratioAlfabetico(texto) {
  const s = String(texto || '');
  if (!s.length) return 0;
  const letras = (s.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length;
  return letras / s.length;
}

/** Cuántos caracteres alfabéticos tiene un texto. */
export const contarAlfabeticos = (texto) =>
  (String(texto || '').match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length;

/**
 * ¿Esta página de PDF ya es texto, o hay que pasarla por OCR?
 * @param textoNativo lo que devolvió la extracción directa de la página
 * @returns { nativa, necesitaOcr, motivo, alfa, ratio }
 */
export function clasificarPaginaPdf(textoNativo) {
  const alfa = contarAlfabeticos(textoNativo);
  const ratio = ratioAlfabetico(textoNativo);
  if (alfa < MIN_ALFA_NATIVA) {
    return { nativa: false, necesitaOcr: true, alfa, ratio,
      motivo: alfa === 0 ? 'sin texto extraíble (página imagen)' : `solo ${alfa} letras` };
  }
  if (ratio < MIN_RATIO_ALFA) {
    return { nativa: false, necesitaOcr: true, alfa, ratio,
      motivo: `extracción con ruido (${Math.round(ratio * 100)}% letras)` };
  }
  return { nativa: true, necesitaOcr: false, alfa, ratio, motivo: 'texto nativo' };
}

/** Lleva cualquier ángulo a [0, 360). */
export function normalizarRotacion(grados) {
  const g = Number(grados) || 0;
  return ((Math.round(g) % 360) + 360) % 360;
}

/**
 * Qué es una imagen incrustada en un .docx y qué hacer con ella.
 *
 * `rotacionCorreccion` es cuánto hay que rotar la imagen para dejarla derecha:
 * el complemento de lo que declara el documento. Una página guardada a 270°
 * se endereza rotándola 90°.
 *
 * @param img { rotGrados, anchoCm, altoCm }
 * @returns { tipo: 'pagina'|'decorativa', necesitaOcr, rotacionCorreccion, motivo }
 */
export function clasificarImagenDocx(img = {}) {
  const ancho = Number(img.anchoCm) || 0;
  const alto = Number(img.altoCm) || 0;
  const rot = normalizarRotacion(img.rotGrados);
  const lado = Math.max(ancho, alto);
  if (lado < UMBRAL_PAGINA_CM) {
    return { tipo: 'decorativa', necesitaOcr: false, rotacionCorreccion: 0,
      motivo: `caja de ${lado.toFixed(1)} cm — logo, sello o firma` };
  }
  return { tipo: 'pagina', necesitaOcr: true,
    rotacionCorreccion: normalizarRotacion(360 - rot),
    motivo: rot ? `página escaneada, el documento la declara a ${rot}°` : 'página escaneada' };
}

/**
 * Resumen de un triage: qué se lee gratis y qué se paga.
 * @param bloques salida de bloquesDeDocx() o equivalente
 */
export function resumenTriage(bloques) {
  let charsNativos = 0, paginasOcr = 0, decorativas = 0, rotadas = 0;
  for (const b of (bloques || [])) {
    if (b.tipo === 'texto') charsNativos += (b.texto || '').length;
    else if (b.tipo === 'imagen') {
      if (b.necesitaOcr) { paginasOcr++; if (b.rotacionCorreccion) rotadas++; }
      else decorativas++;
    }
  }
  return { charsNativos, paginasOcr, decorativas, rotadas, bloques: (bloques || []).length };
}

// ── Lectura de un .docx ────────────────────────────────────────────

const desescapar = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

/**
 * Parte `word/document.xml` en bloques EN ORDEN: párrafos de texto nativo e
 * imágenes. El orden es el punto — el OCR de una página tiene que aterrizar
 * donde estaba la imagen, no apilarse al final, o el Pase 1 pierde de vista en
 * qué sección del documento estaba cada cosa.
 *
 * Se parsea con expresiones regulares y no con un parser XML a propósito: la
 * app no tiene ninguno y OOXML acá se usa en un subconjunto muy chico
 * (párrafo, corrida de texto, dibujo). Meter una dependencia nueva para esto
 * costaría más que lo que resuelve.
 *
 * @param zip instancia de JSZip ya cargada con el .docx
 * @returns [{ tipo:'texto', texto } | { tipo:'imagen', rid, media, rotGrados,
 *            anchoCm, altoCm, necesitaOcr, rotacionCorreccion, motivo }]
 */
export async function bloquesDeDocx(zip) {
  const xml = await zip.file('word/document.xml').async('string');

  // rId → ruta real del archivo dentro del zip
  const relsXml = await zip.file('word/_rels/document.xml.rels').async('string');
  const rels = new Map();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    rels.set(m[1], m[2].replace(/^\/?word\//, '').replace(/^\.\.\//, ''));
  }

  const bloques = [];
  // Se recorre párrafo por párrafo: es la unidad que conserva el orden.
  for (const pm of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const p = pm[1];

    const dibujos = p.match(/<w:drawing>[\s\S]*?<\/w:drawing>/g) || [];
    for (const d of dibujos) {
      const rot = /<a:xfrm[^>]*\brot="(-?\d+)"/.exec(d);
      const ext = /<wp:extent\s+cx="(\d+)"\s+cy="(\d+)"/.exec(d);
      const emb = /r:embed="([^"]+)"/.exec(d);
      const info = {
        rotGrados: rot ? Number(rot[1]) / UNIDADES_POR_GRADO : 0,
        anchoCm: ext ? Number(ext[1]) / EMU_POR_CM : 0,
        altoCm: ext ? Number(ext[2]) / EMU_POR_CM : 0,
      };
      const rid = emb ? emb[1] : null;
      // Los campos se copian UNO POR UNO y no con spread: clasificarImagenDocx
      // devuelve su propio `tipo` ('pagina'/'decorativa') y esparcirlo pisaba
      // el `tipo: 'imagen'` del bloque — todo el resto del módulo filtra por
      // ese campo, así que las 16 páginas del TDR quedaban invisibles.
      const c = clasificarImagenDocx(info);
      bloques.push({
        tipo: 'imagen', clase: c.tipo, rid,
        media: rid && rels.has(rid) ? `word/${rels.get(rid)}` : null,
        rotGrados: info.rotGrados, anchoCm: info.anchoCm, altoCm: info.altoCm,
        necesitaOcr: c.necesitaOcr, rotacionCorreccion: c.rotacionCorreccion, motivo: c.motivo,
      });
    }

    // El texto del párrafo, sin los dibujos que ya se emitieron.
    const soloTexto = p.replace(/<w:drawing>[\s\S]*?<\/w:drawing>/g, '');
    // `<w:t[^>]*>` a secas también matchea <w:tbl>, <w:tc> y <w:tr>, y como
    // esos no cierran con </w:t> la captura se comía párrafos enteros de tabla
    // (inflaba el texto de 200k a 327k caracteres). Se exige que después de
    // `<w:t` venga el fin del tag o un espacio de atributos.
    const corridas = [...soloTexto.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m => desescapar(m[1]));
    const texto = corridas.join('').trim();
    if (texto) bloques.push({ tipo: 'texto', texto });
  }
  return bloques;
}

/**
 * Los bloques como un solo markdown, con un marcador donde va cada página
 * escaneada. Ese marcador es el hueco que el OCR rellena después, y es lo que
 * permite que el documento híbrido conserve el orden original.
 */
export function bloquesAMarkdown(bloques, ocrPorMedia = {}) {
  const out = [];
  for (const b of (bloques || [])) {
    if (b.tipo === 'texto') { out.push(b.texto); continue; }
    if (!b.necesitaOcr) continue;                     // logos y sellos no aportan
    const leido = ocrPorMedia[b.media];
    out.push(leido
      ? `\n<!-- página escaneada: ${b.media} -->\n${leido}\n`
      : `\n[[PÁGINA ESCANEADA PENDIENTE DE OCR: ${b.media || b.rid}]]\n`);
  }
  return out.join('\n');
}
