// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL ANÁLISIS DE UNAS BASES, DE PUNTA A PUNTA (tanda 15, entrega 3).
//
// Encadena los cinco pasos y lleva la cuenta de lo que se gastó. Corre en el
// CLIENTE a propósito: un PDF de 96 páginas no entra en una serverless, ni por
// tamaño (Vercel corta cerca de 4,5 MB por request) ni por tiempo (60 s). El
// navegador abre el documento, decide qué páginas hay que pagar y manda solo
// esas, de a seis.
//
//   0   triage      qué es texto y qué es imagen        gratis
//   0.5 índice      dónde aparece cada familia          gratis
//   1   OCR         solo las páginas que hacen falta    USD 0,002 c/u
//   2   localizar   la IA ELIGE entre lo que ya hay     ~USD 0
//   3   extraer     la IA lee solo los rangos elegidos  ~USD 0
//   4   verificar   ¿la cita existe en el documento?    gratis
//
// EL PASO 4 ES EL QUE HACE CONFIABLE A ESTO, y no cuesta nada. Ver el
// comentario largo en bases-extraccion.js sobre por qué no hay una tercera
// pasada de IA.
// ═══════════════════════════════════════════════════════════════════

import {
  bloquesDePdf, bloquesDeDocx, bloquesAMarkdown, resumenTriage,
} from './bases-triage.js';
import {
  indiceDeSecciones, resumenIndice, textoDeRango,
  verificarResultado, costoDelAnalisis, aFilasRequisitos, aCabeceraLicitacion,
  normalizar,
} from './bases-extraccion.js';

/** Páginas por request de OCR. Debe coincidir con MAX_PAGINAS_TANDA del endpoint. */
export const PAGINAS_POR_TANDA = 6;

/** A qué escala se rasteriza una página para el OCR.
 *  150 dpi (escala ~2 sobre las 72 dpi del PDF) es el punto donde el OCR deja
 *  de mejorar: más resolución solo engorda el base64 y hace fallar la tanda. */
export const ESCALA_OCR = 2;

/** Familias que se extraen. `proceso` va primero: si el documento no es unas
 *  bases, se nota ahí y no después de pagar 94 páginas de OCR. */
export const FAMILIAS_EXTRAIBLES = ['personal', 'empresa'];

const esPdf = (file) => /\.pdf$/i.test(file?.name || '') || file?.type === 'application/pdf';
const esDocx = (file) => /\.docx$/i.test(file?.name || '')
  || file?.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Rasteriza una página de pdf.js a JPEG. Vive acá y no en bases-triage porque
 * toca el DOM: el triage tiene que poder correr en los tests sin navegador.
 */
export async function rasterizarPagina(page, escala = ESCALA_OCR, calidad = 0.82) {
  // `getViewport` ya aplica el /Rotate del PDF: la página sale derecha sola,
  // que es la diferencia con el .docx (allá hay que corregir a mano).
  const viewport = page.getViewport({ scale: escala });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  // Fondo blanco: un escaneo suele traer transparencia y el OCR lee peor sobre
  // negro (el canvas nace transparente y el JPEG la rellena de negro).
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const url = canvas.toDataURL('image/jpeg', calidad);
  // Liberar: 96 canvas de 1.700×2.200 en memoria tumban una laptop.
  canvas.width = 0; canvas.height = 0;
  return url;
}

/** Los bloques de un archivo, sin gastar un centavo todavía. */
export async function leerDocumento(file, { onProgreso = null } = {}) {
  if (esPdf(file)) {
    const pdfjsLib = await import('pdfjs-dist');
    const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    // SIN rasterizar todavía: acá solo se decide qué páginas hay que pagar, y
    // eso se hace con el texto. Las imágenes se generan tanda por tanda, justo
    // antes de mandarlas (ver `analizar`), para no tener el PDF entero como
    // JPEG en memoria.
    const bloques = await bloquesDePdf(pdf, {
      onProgreso: onProgreso ? (p) => onProgreso({ paso: 'leyendo', ...p }) : null,
    });
    return { bloques, tipo: 'pdf', paginas: pdf.numPages };
  }
  if (esDocx(file)) {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const bloques = await bloquesDeDocx(zip);
    // El .docx guarda las páginas escaneadas como archivos dentro del zip; hay
    // que sacarlas para poder mandarlas al OCR, y ENDEREZARLAS con la rotación
    // que el propio documento declara.
    for (const b of bloques) {
      if (b.tipo !== 'imagen' || !b.necesitaOcr || !b.media) continue;
      const archivo = zip.file(b.media);
      if (!archivo) continue;
      const base64 = await archivo.async('base64');
      const mime = /\.png$/i.test(b.media) ? 'image/png'
        : (/\.webp$/i.test(b.media) ? 'image/webp' : 'image/jpeg');
      b.imagen = b.rotacionCorreccion
        ? await rotarImagen(`data:${mime};base64,${base64}`, b.rotacionCorreccion)
        : `data:${mime};base64,${base64}`;
    }
    return { bloques, tipo: 'docx', paginas: null };
  }
  throw new Error('Solo se pueden analizar bases en PDF o Word (.docx)');
}

/** Gira una imagen los grados que el .docx declara. Sin esto, el OCR de una
 *  página de costado devuelve basura y se paga igual. */
export async function rotarImagen(dataUrl, grados) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('no se pudo leer la imagen'));
    i.src = dataUrl;
  });
  const g = ((Math.round(grados) % 360) + 360) % 360;
  const vertical = g === 90 || g === 270;
  const canvas = document.createElement('canvas');
  canvas.width = vertical ? img.height : img.width;
  canvas.height = vertical ? img.width : img.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((g * Math.PI) / 180);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  const url = canvas.toDataURL('image/jpeg', 0.82);
  canvas.width = 0; canvas.height = 0;
  return url;
}

/**
 * El presupuesto ANTES de gastar. Se le muestra a la persona y decide.
 * Es la única forma honesta de contestar «¿cuánto me cuesta analizar esto?»:
 * contando las páginas que de verdad van a ir al OCR, no estimando el archivo.
 */
export function presupuestar(bloques) {
  const r = resumenTriage(bloques);
  return {
    ...r,
    tandas: Math.ceil(r.paginasOcr / PAGINAS_POR_TANDA),
    costo: costoDelAnalisis({ paginasOcr: r.paginasOcr }),
  };
}

/**
 * El análisis completo.
 *
 * @param bloques        lo que devolvió leerDocumento()
 * @param apiFetch/apiParse  el cliente HTTP de la app (se inyecta para poder testear)
 * @param onProgreso     ({ paso, hecho, total, detalle })
 * @returns { markdown, indice, rangos, resultado, costo, modelos, alertas }
 */
export async function analizar(bloques, { apiFetch, apiParse, onProgreso = null } = {}) {
  const avisar = (p) => { if (onProgreso) onProgreso(p); };
  const pedir = async (body, timeout = 90000) => {
    const resp = await apiFetch('/api/bases-analizar', {
      method: 'POST', timeout,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await apiParse(resp);
    if (!resp.ok) {
      const err = new Error(data.error || `HTTP ${resp.status}`);
      err.code = data.code || null;
      throw err;
    }
    return data;
  };

  const alertas = [];
  const modelos = new Set();
  let usdPasadas = 0;

  // ── 1. OCR de las páginas que lo necesitan, de a seis ────────────
  const aOcr = bloques.filter(b => b.tipo === 'imagen' && b.necesitaOcr && (b.imagen || b._page));
  const sinImagen = bloques.filter(b => b.tipo === 'imagen' && b.necesitaOcr && !b.imagen && !b._page);
  if (sinImagen.length) {
    alertas.push(`${sinImagen.length} página(s) escaneada(s) no se pudieron extraer del archivo y quedaron sin leer.`);
  }
  const ocrPorMedia = {};
  let leidas = 0;
  for (let i = 0; i < aOcr.length; i += PAGINAS_POR_TANDA) {
    const tanda = aOcr.slice(i, i + PAGINAS_POR_TANDA);
    avisar({ paso: 'ocr', hecho: leidas, total: aOcr.length });
    // Rasterizar SOLO esta tanda. Las imágenes se sueltan al terminarla.
    for (const b of tanda) {
      if (!b.imagen && b._page) b.imagen = await rasterizarPagina(b._page);
    }
    const data = await pedir({
      accion: 'ocr',
      paginas: tanda.map(b => ({ clave: b.media, n: b.pagina ?? null, imagen: b.imagen, mimeType: 'image/jpeg' })),
    });
    Object.assign(ocrPorMedia, data.textos || {});
    leidas += Object.keys(data.textos || {}).length;
    for (const f of (data.fallidas || [])) {
      alertas.push(`No se pudo leer ${f.clave}: ${f.motivo}.`);
    }
    if (data.model) modelos.add(data.model);
    // La imagen ya no se necesita: soltarla evita tener 94 JPEG en memoria.
    for (const b of tanda) b.imagen = null;
  }
  avisar({ paso: 'ocr', hecho: leidas, total: aOcr.length });

  // ── 2. El documento híbrido y su índice, sin IA ──────────────────
  const markdown = bloquesAMarkdown(bloques, ocrPorMedia);
  const indice = indiceDeSecciones(markdown);
  const resumen = resumenIndice(indice);
  avisar({ paso: 'indice', detalle: resumen });

  const hayAlgo = Object.values(resumen).some(r => r.aciertos > 0);
  if (!hayAlgo) {
    alertas.push('No se reconoció ninguna sección típica de unas bases. Puede que el documento no sea unas bases, o que el OCR haya salido ilegible.');
    return { markdown, indice, rangos: null, resultado: { requisitos: [], alertas }, alertas,
      filas: [], cabecera: null, paginasOcr: leidas,
      costo: costoDelAnalisis({ paginasOcr: leidas, usdPasadas }), modelos: [...modelos] };
  }

  // ── 3. Pase 1: la IA elige rangos entre lo que el índice encontró ─
  avisar({ paso: 'localizar' });
  let rangos = null;
  try {
    const data = await pedir({ accion: 'localizar', indice });
    rangos = data.rangos || null;
    if (data.model) modelos.add(data.model);
    usdPasadas += Number(data.costo) || 0;
  } catch (e) {
    // Que falle el Pase 1 no tira el análisis: se cae a los rangos que
    // encontró el índice por su cuenta. Peor extracción, no ninguna.
    alertas.push(`El paso que ubica las secciones falló (${e.message}). Se usó el índice sin afinar.`);
  }

  // ── 4. Pase 2: extraer, solo sobre los rangos elegidos ───────────
  const requisitos = [];
  const extras = { factores_evaluacion: [], cronograma: [], proceso: null };
  // UN MISMO REQUISITO NO SE PROPONE DOS VECES. Los rangos de dos familias se
  // pisan seguido —«...en obras similares» dentro del párrafo del Residente
  // cae en el índice de `personal` Y en el de `empresa`— y sin esto la persona
  // ve el mismo puesto duplicado y guarda dos filas para el mismo requisito.
  // La identidad es el texto de donde salió, que es lo único que no cambia
  // entre una pasada y la otra.
  const vistos = new Set();
  const huella = (r) => `${normalizar(r.cargo)}|${normalizar(r.fuente_cita).slice(0, 120)}`;
  for (const familia of FAMILIAS_EXTRAIBLES) {
    const trozos = rangosDeFamilia(rangos, resumen, familia);
    for (const { desde, hasta } of trozos) {
      const texto = textoDeRango(markdown, desde, hasta);
      if (!texto.trim()) continue;
      avisar({ paso: 'extraer', detalle: `${familia} · páginas ${desde}–${hasta}` });
      try {
        const data = await pedir({ accion: 'extraer', texto, seccion: familia });
        const r = data.resultado || {};
        if (data.model) modelos.add(data.model);
        usdPasadas += Number(data.costo) || 0;
        for (const req of (Array.isArray(r.requisitos) ? r.requisitos : [])) {
          const h = huella(req);
          if (vistos.has(h)) continue;
          vistos.add(h);
          requisitos.push({ ...req, clase: familia === 'empresa' ? 'empresa' : (req.clase || 'personal') });
        }
        for (const a of (Array.isArray(r.alertas) ? r.alertas : [])) alertas.push(a);
        if (Array.isArray(r.factores_evaluacion)) extras.factores_evaluacion.push(...r.factores_evaluacion);
        if (Array.isArray(r.cronograma)) extras.cronograma.push(...r.cronograma);
        if (!extras.proceso && r.proceso && Object.values(r.proceso).some(v => v != null)) extras.proceso = r.proceso;
      } catch (e) {
        alertas.push(`No se pudo extraer ${familia} (páginas ${desde}–${hasta}): ${e.message}`);
      }
    }
  }

  // ── 5. Verificar cada cita contra el documento ───────────────────
  avisar({ paso: 'verificar' });
  const verificado = verificarResultado({ ...extras, requisitos, alertas }, markdown);

  return {
    markdown, indice, rangos,
    resultado: verificado,
    // Ya traducido a lo que la pantalla guarda: la fila de licitacion_requisitos
    // y los campos de cabecera. Que la traducción viva acá y no en el
    // componente es lo que la deja cubierta por tests.
    filas: aFilasRequisitos(verificado),
    cabecera: aCabeceraLicitacion(verificado),
    alertas: verificado.alertas,
    costo: costoDelAnalisis({ paginasOcr: leidas, usdPasadas }),
    modelos: [...modelos],
    paginasOcr: leidas,
  };
}

/**
 * Los rangos a leer de una familia: los que eligió el Pase 1 y, si no eligió,
 * los que ya había encontrado el índice (una ventana chica alrededor de cada
 * página con acierto). Sin páginas —un .docx— se devuelve el documento entero
 * como un solo rango, que es lo que `textoDeRango` sabe manejar.
 */
export function rangosDeFamilia(rangos, resumen, familia) {
  const elegidos = rangos?.[familia];
  if (elegidos?.encontrada && Array.isArray(elegidos.rangos) && elegidos.rangos.length) {
    return elegidos.rangos
      .map(r => ({ desde: Number(r.desde), hasta: Number(r.hasta) }))
      .filter(r => Number.isFinite(r.desde) && Number.isFinite(r.hasta) && r.hasta >= r.desde)
      // Un rango larguísimo es la señal de que el Pase 1 no encontró nada; se
      // recorta en vez de mandar 40 páginas y que la respuesta se corte.
      .map(r => ({ desde: r.desde, hasta: Math.min(r.hasta, r.desde + 11) }));
  }
  const paginas = (resumen?.[familia]?.paginas || []).filter(p => p != null);
  if (!paginas.length) return resumen?.[familia]?.aciertos ? [{ desde: 1, hasta: 1 }] : [];
  // Ventana de ±1 página alrededor de cada acierto, fusionando lo que se toca.
  const ventanas = [...new Set(paginas)].sort((a, b) => a - b)
    .map(p => ({ desde: Math.max(1, p - 1), hasta: p + 1 }));
  const fusionadas = [];
  for (const v of ventanas) {
    const ultimo = fusionadas[fusionadas.length - 1];
    if (ultimo && v.desde <= ultimo.hasta + 1) ultimo.hasta = Math.max(ultimo.hasta, v.hasta);
    else fusionadas.push({ ...v });
  }
  return fusionadas.slice(0, 3);
}

export default { leerDocumento, presupuestar, analizar, rangosDeFamilia, rasterizarPagina, rotarImagen };
