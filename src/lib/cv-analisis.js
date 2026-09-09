// ═══════════════════════════════════════════════════════════════════
// JARVEX — LEER UN CV DE PUNTA A PUNTA (tanda 15, entrega 4).
//
// La misma cadena que las bases (bases-analisis.js), sobre otro documento y
// con otras dos pasadas:
//
//   0   triage       qué páginas son texto y cuáles escaneadas     gratis
//   1   ficha        la IA lee las páginas de currículum            ~USD 0
//   2   verificar    ¿la cita existe en el documento?               gratis
//   —   constancias  OPCIONAL, apagado: OCR de las escaneadas       USD 0,002 c/u
//
// 🔴 EL OCR ESTÁ APAGADO POR DEFECTO, y es la corrección grande de la entrega
// 5. Gabriel lo vio abriendo el CV: «hay cosas que no necesitan ser
// escaneadas por OCR […] todo está en la parte inicial, pienso que sería
// analizar todo el texto que está digitalizado, no las imágenes».
//
// Medido sobre el CV real (39 páginas, 8-set-2026):
//   páginas 1 a 4   currículum nativo: datos, 11 periodos, 10 cursos, referencias
//   páginas 7 a 10  RNP, ficha RUC y suspensión de 4ta — TAMBIÉN nativas
//                   (son impresiones de web a PDF, con su texto intacto)
//   páginas 5, 6 y 11 a 39   solo la cabecera: son las imágenes escaneadas
//
// O sea que las 8 páginas nativas traen TODO lo declarativo, y leerlas cuesta
// USD 0. Las 31 escaneadas son los papeles que RESPALDAN, y respaldar no es
// leer: es que una persona MIRE el documento y lo dé por bueno. Pagar USD
// 0,062 para que un modelo diga que la constancia existe no da esa certeza;
// mirarla sí, y cuesta USD 0. Por eso el OCR queda como opción explícita.
//
// Con `conOcr: true` vuelve la cadena entera: OCR de las escaneadas, una
// pasada que dice qué certifica cada una y el cruce automático con los
// periodos declarados. Sirve para un CV de 200 páginas donde hojear a mano no
// es realista, y sigue sin reemplazar la verificación humana: lo cruzado
// queda en 'pendiente' igual (mig 200).
//
// EL TRIAGE DEL CV TIENE OTRO PISO. El CV trae un encabezado nativo impreso
// sobre cada constancia escaneada («Nombre · INGENIERO · celular · e-mail»,
// 69 letras). Con el piso de las bases (80) quedaba a 11 letras de dar esas
// páginas por nativas y no leerlas. Para un CV el piso es 250: una página de
// currículum de verdad tiene más de 900 letras.
//
// Corre en el CLIENTE, igual que las bases: el archivo se abre en el
// navegador, se decide qué páginas pagar y se mandan de a seis.
// ═══════════════════════════════════════════════════════════════════

import { bloquesAMarkdown, resumenTriage } from './bases-triage.js';
import { fragmentosPorPagina, costoDelAnalisis } from './bases-extraccion.js';
import { leerDocumento, ocrDeBloques, crearPedidor, PAGINAS_POR_TANDA } from './bases-analisis.js';
import { armarFicha } from './cv-extraccion.js';

/** Piso de letras nativas para dar una página de CV por texto.
 *  Medido: la cabecera impresa sobre cada constancia son 69 letras; una
 *  página de currículum de verdad tiene entre 325 y 1.570. */
export const MIN_ALFA_CV = 250;

/** Páginas escaneadas por pasada de constancias: ~8 constancias son ~25.000
 *  caracteres de OCR, cómodo bajo el tope del endpoint (120.000). */
export const PAGINAS_POR_PASADA_CONSTANCIAS = 8;

/** Los bloques del CV, sin gastar. */
export async function leerCv(file, { onProgreso = null } = {}) {
  return leerDocumento(file, { onProgreso, minAlfa: MIN_ALFA_CV });
}

/**
 * El presupuesto antes de gastar.
 *
 * `costo` es lo que cuesta la lectura NORMAL, que es cero: solo se leen las
 * páginas de texto. `costoConConstancias` es lo que costaría además pasar las
 * escaneadas por OCR, y se muestra al lado de la casilla que lo activa, para
 * que la decisión se tome con el número a la vista.
 */
export function presupuestarCv(bloques) {
  const r = resumenTriage(bloques);
  const nativas = (bloques || []).filter(b => b.tipo === 'texto').length;
  return {
    ...r,
    paginasNativas: nativas,
    paginasEscaneadas: r.paginasOcr,
    tandas: Math.ceil(r.paginasOcr / PAGINAS_POR_TANDA),
    costo: costoDelAnalisis({ paginasOcr: 0 }),
    costoConConstancias: costoDelAnalisis({ paginasOcr: r.paginasOcr }),
  };
}

/**
 * Junta dos lecturas parciales del mismo CV.
 *
 * La primera mitad suele traer los datos personales y la ficha; la segunda,
 * más experiencias y los cursos. Se prefiere el primer valor no vacío de cada
 * campo y se concatenan las listas: perder una experiencia por fundir mal
 * costaría lo mismo que no haber leído.
 */
export function fundirCv(a, b) {
  if (!a) return b;
  if (!b) return a;
  const preferir = (x, y) => {
    const out = { ...(y || {}) };
    for (const [k, v] of Object.entries(x || {})) {
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
      out[k] = v;
    }
    return out;
  };
  return {
    persona: preferir(a.persona, b.persona),
    ficha: {
      ...preferir(a.ficha, b.ficha),
      especialidades: [...(a.ficha?.especialidades || []), ...(b.ficha?.especialidades || [])],
      capacitaciones: [...(a.ficha?.capacitaciones || []), ...(b.ficha?.capacitaciones || [])],
    },
    experiencias: [...(a.experiencias || []), ...(b.experiencias || [])],
    alertas: [...(a.alertas || []), ...(b.alertas || [])],
  };
}

/** Texto de un conjunto de páginas, con su ancla, para mandarlo a una pasada. */
function textoDePaginas(markdown, paginas) {
  const set = new Set(paginas);
  return fragmentosPorPagina(markdown)
    .filter(f => f.pagina != null && set.has(f.pagina))
    .map(f => `<!-- página ${f.pagina} -->\n${f.texto}`)
    .join('\n\n');
}

/**
 * El análisis completo del CV.
 *
 * @param bloques  lo que devolvió leerCv()
 * @param rubros   filas de rubros_obra (para PROPONER el rubro de cada obra)
 * @returns { persona, ficha, experiencias, documentos, alertas, costo, modelos, paginasOcr, markdown }
 */
export async function analizarCv(bloques, { apiFetch, apiParse, rubros = [], onProgreso = null, conOcr = false } = {}) {
  const avisar = (p) => { if (onProgreso) onProgreso(p); };
  const pedir = crearPedidor(apiFetch, apiParse);
  const alertas = [];
  const modelos = new Set();
  let usdPasadas = 0;

  // ── 1. Las constancias, solo si se pidió expresamente ────────────
  let ocrPorMedia = {}, leidas = 0;
  if (conOcr) {
    ({ ocrPorMedia, leidas } = await ocrDeBloques(bloques, { pedir, avisar, alertas, modelos }));
  }
  const markdown = bloquesAMarkdown(bloques, ocrPorMedia);

  const paginasNativas = bloques.filter(b => b.tipo === 'texto' && b.pagina != null).map(b => b.pagina);
  const paginasOcr = bloques
    .filter(b => b.tipo === 'imagen' && b.necesitaOcr && b.pagina != null && ocrPorMedia[b.media])
    .map(b => b.pagina);
  // Las escaneadas que NO se leyeron. Se cuentan igual: el administrador tiene
  // que saber cuántos papeles hay para mirar, aunque nadie los haya leído.
  const paginasSinLeer = bloques
    .filter(b => b.tipo === 'imagen' && b.necesitaOcr && b.pagina != null && !ocrPorMedia[b.media])
    .map(b => b.pagina);

  // ── 2. La ficha declarada ────────────────────────────────────────
  // Si el CV entero está escaneado (pasa), la ficha se lee de las primeras
  // páginas OCR: son las de currículum, las constancias vienen después.
  const paginasFicha = paginasNativas.length ? paginasNativas : paginasOcr.slice(0, 6);
  let resFicha = null;
  if (paginasFicha.length) {
    /**
     * Si la respuesta se corta, se parte la lectura en dos mitades y se funden.
     *
     * 🔴 Es lo que falló el 8-set: «no se pudo leer el currículum: la respuesta
     * se cortó por tamaño». Un CV con 11 periodos y 10 cursos devuelve un JSON
     * largo, y el modelo además razona antes de escribirlo. Decirle al usuario
     * «manda menos páginas» no tiene sentido: el archivo es el que es. Se parte
     * solo, y cada intento con un gratuito cuesta USD 0.
     */
    const leerTanda = async (paginas, nivel = 0) => {
      const texto = textoDePaginas(markdown, paginas).slice(0, 110_000);
      if (!texto.trim()) return null;
      avisar({ paso: 'ficha', detalle: `páginas ${paginas[0]}–${paginas[paginas.length - 1]}` });
      try {
        const data = await pedir({ accion: 'extraer_cv', parte: 'ficha', texto });
        if (data.model) modelos.add(data.model);
        usdPasadas += Number(data.costo) || 0;
        return data.resultado || null;
      } catch (e) {
        if (e.code === 'respuesta_cortada' && nivel < 2 && paginas.length > 1) {
          const medio = Math.ceil(paginas.length / 2);
          const a = await leerTanda(paginas.slice(0, medio), nivel + 1);
          const b = await leerTanda(paginas.slice(medio), nivel + 1);
          return fundirCv(a, b);
        }
        alertas.push(`No se pudo leer el currículum: ${e.message}`);
        return null;
      }
    };
    resFicha = await leerTanda(paginasFicha);
  } else {
    alertas.push('El archivo no tiene páginas con texto ni páginas que se hayan podido leer por OCR.');
  }

  // ── 3. Qué certifica cada constancia ─────────────────────────────
  const paginasConstancias = paginasNativas.length ? paginasOcr : paginasOcr.slice(6);
  const documentos = [];
  for (let i = 0; i < paginasConstancias.length; i += PAGINAS_POR_PASADA_CONSTANCIAS) {
    const tanda = paginasConstancias.slice(i, i + PAGINAS_POR_PASADA_CONSTANCIAS);
    avisar({ paso: 'constancias', hecho: i, total: paginasConstancias.length,
      detalle: `páginas ${tanda[0]}–${tanda[tanda.length - 1]}` });
    const texto = textoDePaginas(markdown, tanda);
    if (!texto.trim()) continue;
    try {
      const data = await pedir({ accion: 'extraer_cv', parte: 'constancias', texto });
      const r = data.resultado || {};
      if (data.model) modelos.add(data.model);
      usdPasadas += Number(data.costo) || 0;
      for (const d of (Array.isArray(r.documentos) ? r.documentos : [])) {
        // La página la afirma el modelo; si se salió de la tanda, se corrige a
        // la primera de la tanda antes de creerle.
        const pd = Number(d?.pagina_desde);
        documentos.push({ ...d, pagina_desde: tanda.includes(pd) ? pd : tanda[0] });
      }
      for (const a of (Array.isArray(r.alertas) ? r.alertas : [])) alertas.push(a);
    } catch (e) {
      alertas.push(`No se pudieron leer las constancias de las páginas ${tanda[0]}–${tanda[tanda.length - 1]}: ${e.message}`);
    }
  }

  // ── 4 y 5. Cruce y verificación, sin IA ──────────────────────────
  avisar({ paso: 'verificar' });
  const armado = armarFicha({ ficha: resFicha, documentos, markdown, rubros });

  if (paginasSinLeer.length) {
    alertas.push(`El CV trae ${paginasSinLeer.length} página(s) escaneadas que no se leyeron: son las constancias y los diplomas. Ábrelas en el CV para verificar cada dato.`);
  }

  return {
    ...armado,
    alertas: [...alertas, ...armado.alertas],
    markdown,
    costo: costoDelAnalisis({ paginasOcr: leidas, usdPasadas }),
    modelos: [...modelos],
    paginasOcr: leidas,
    paginasSinLeer,
    paginasNativas,
    conOcr,
    paginasTotal: bloques.filter(b => b.pagina != null).length,
  };
}

export default { leerCv, presupuestarCv, analizarCv, fundirCv, MIN_ALFA_CV, PAGINAS_POR_PASADA_CONSTANCIAS };
