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
  verificarResultado, costoDelAnalisis, aFilasRequisitos, aFilasEmpresa,
  aCabeceraLicitacion, aCronograma, sugerenciasDe, aExtrasProceso, normalizar,
} from './bases-extraccion.js';

/** Cuántas veces se parte un rango que no entra en una respuesta.
 *  Tres: de 12 tramos a 6, a 3, a 1. Más que eso es un documento con una
 *  página imposible, y ahí sí hay que mirarla a mano. */
export const MAX_PARTICIONES = 3;

/** Páginas por request de OCR. Debe coincidir con MAX_PAGINAS_TANDA del endpoint. */
export const PAGINAS_POR_TANDA = 6;

/** A qué escala se rasteriza una página para el OCR.
 *  150 dpi (escala ~2 sobre las 72 dpi del PDF) es el punto donde el OCR deja
 *  de mejorar: más resolución solo engorda el base64 y hace fallar la tanda. */
export const ESCALA_OCR = 2;

/** Familias que se extraen, en este orden. `proceso` va primero y se lee con
 *  el prompt del proceso entero (montos, CUI, plazo, calendario, consorcio):
 *  es lo que hace que una convocatoria de El Peruano alcance para CREAR la
 *  postulación. `personal` es el plantel; `empresa`, lo que descalifica al
 *  postor. El calendario no es una pasada aparte: sus páginas se suman a las
 *  de `proceso`, porque en una convocatoria están en el mismo texto. */
export const FAMILIAS_EXTRAIBLES = ['proceso', 'personal', 'empresa'];

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

/** Los bloques de un archivo, sin gastar un centavo todavía.
 *  `minAlfa` sube el piso de texto nativo por página (el CV con encabezado
 *  impreso sobre cada constancia escaneada; ver bases-triage). */
export async function leerDocumento(file, { onProgreso = null, minAlfa = undefined } = {}) {
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
      ...(minAlfa != null ? { minAlfa } : {}),
    });
    return { bloques, tipo: 'pdf', paginas: pdf.numPages, unidad: 'pagina' };
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
    // `unidad: 'tramo'` — un Word no tiene páginas, así que bases-triage.js
    // numera TRAMOS de ~3.000 caracteres para que los rangos puedan cortar.
    // La pantalla lo dice con esa palabra: citar «página 21» de un Word sería
    // mentira, ese número no existe en el documento.
    return { bloques, tipo: 'docx', paginas: null, unidad: 'tramo' };
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

/** Une alertas repetidas. Sin esto, dos familias que caen en el mismo rango
 *  devuelven la misma observación dos veces y la lista se vuelve ruido —
 *  pasó en la prueba real del 8-set con la convocatoria de una página. */
export function alertasUnicas(alertas) {
  const vistas = new Set();
  const out = [];
  for (const a of (alertas || [])) {
    const t = String(a || '').trim();
    if (!t) continue;
    const k = normalizar(t).slice(0, 120);
    if (vistas.has(k)) continue;
    vistas.add(k);
    out.push(t);
  }
  return out;
}

/**
 * El análisis completo.
 *
 * @param bloques        lo que devolvió leerDocumento()
 * @param apiFetch/apiParse  el cliente HTTP de la app (se inyecta para poder testear)
 * @param onProgreso     ({ paso, hecho, total, detalle })
 * @returns { markdown, indice, rangos, resultado, costo, modelos, alertas }
 */
/** El cliente HTTP del endpoint, con el error ya desarmado. Se exporta porque
 *  el lector de CV (cv-analisis.js) habla con el mismo endpoint. */
export function crearPedidor(apiFetch, apiParse) {
  return async (body, timeout = 90000) => {
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
}

/**
 * OCR de las páginas que lo necesitan, de a seis. Compartido con el lector de
 * CV: es exactamente el mismo trabajo sobre otro documento.
 *
 * @returns { ocrPorMedia, leidas }  — y agrega a `alertas` y `modelos`
 */
export async function ocrDeBloques(bloques, { pedir, avisar = () => {}, alertas = [], modelos = new Set() }) {
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
  return { ocrPorMedia, leidas };
}

/**
 * @param bloques   lo que devolvió leerDocumento()
 * @param cacheado  { markdown, paginasOcr } de una lectura anterior del MISMO
 *                  archivo. Si viene, el OCR NO se vuelve a pagar. Ver
 *                  lib/cache-lectura.js.
 */
export async function analizar(bloques, { apiFetch, apiParse, onProgreso = null, cacheado = null } = {}) {
  const avisar = (p) => { if (onProgreso) onProgreso(p); };
  const pedir = crearPedidor(apiFetch, apiParse);

  const alertas = [];
  const modelos = new Set();
  let usdPasadas = 0;

  // ── 1. OCR de las páginas que lo necesitan, de a seis ────────────
  // Salvo que ya se haya pagado por este mismo archivo: entonces se reusa el
  // texto y esta vuelta cuesta USD 0.
  let ocrPorMedia = {}, leidas = 0, reusado = false;
  if (cacheado?.markdown) {
    reusado = true;
    leidas = 0;                       // no se leyó nada AHORA: no se cobra
    avisar({ paso: 'cache', detalle: `${cacheado.paginasOcr || 0} páginas ya leídas antes` });
  } else {
    ({ ocrPorMedia, leidas } = await ocrDeBloques(bloques, { pedir, avisar, alertas, modelos }));
  }

  // ── 2. El documento híbrido y su índice, sin IA ──────────────────
  const markdown = reusado ? cacheado.markdown : bloquesAMarkdown(bloques, ocrPorMedia);
  const indice = indiceDeSecciones(markdown);
  const resumen = resumenIndice(indice);
  avisar({ paso: 'indice', detalle: resumen });

  const hayAlgo = Object.values(resumen).some(r => r.aciertos > 0);
  if (!hayAlgo) {
    alertas.push('No se reconoció ninguna sección típica de unas bases. Puede que el documento no sea unas bases, o que el OCR haya salido ilegible.');
    return { markdown, indice, rangos: null, resultado: { requisitos: [], alertas }, alertas,
      filas: [], filasEmpresa: [], cabecera: null, cronograma: [], extras: aExtrasProceso({}),
      sugerencias: { tipo_trabajo: null }, reusado,
      paginasOcr: leidas, costo: costoDelAnalisis({ paginasOcr: leidas, usdPasadas }), modelos: [...modelos] };
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
  const requisitosEmpresa = [];
  const extras = {
    cronograma: [], proceso: null, consorcio: null,
    // Lo de la mig 200: se acumula igual que el cronograma, en el orden en que
    // aparece, y se deduplica al final por su cita.
    factores_evaluacion: [], garantias: [], penalidades: [],
    documentos_presentacion: [], condiciones: [],
  };
  // UN MISMO REQUISITO NO SE PROPONE DOS VECES. Los rangos de dos familias se
  // pisan seguido —«...en obras similares» dentro del párrafo del Residente
  // cae en el índice de `personal` Y en el de `empresa`— y sin esto la persona
  // ve el mismo puesto duplicado y guarda dos filas para el mismo requisito.
  // La identidad es el texto de donde salió, que es lo único que no cambia
  // entre una pasada y la otra.
  const vistos = new Set();
  // La huella es la CITA, no el tipo: el mismo requisito volvía dos veces con
  // el mismo texto y distinto `tipo` (uno «otro», otro «habilitacion») y el
  // dedup no lo agarraba. Pasó en la prueba del 8-set con el artículo 117.
  const huella = (r) => normalizar(r.fuente_cita || r.descripcion || r.cargo).slice(0, 140);
  // El proceso se arma campo a campo: la primera pasada que trae un dato lo
  // fija, las siguientes solo llenan lo que falta. Así la convocatoria de una
  // página y las bases de 96 se complementan en vez de pisarse.
  const fundirProceso = (p) => {
    if (!p || typeof p !== 'object') return;
    if (!extras.proceso) { extras.proceso = { ...p }; return; }
    for (const [k, v] of Object.entries(p)) {
      if (v != null && v !== '' && (extras.proceso[k] == null || extras.proceso[k] === '')) extras.proceso[k] = v;
    }
  };
  // EL MISMO TEXTO NO SE MANDA DOS VECES CON EL MISMO PROMPT. En un documento
  // corto —una convocatoria de una página— las familias `proceso` y `empresa`
  // caen en el mismo rango y comparten prompt, así que se pedía dos veces lo
  // mismo: el doble de espera y las alertas repetidas que Gabriel vio en la
  // prueba del 8-set. La llave es el prompt que se va a usar más el texto.
  const pedidos = new Map();
  const promptDe = (familia) => (familia === 'personal' ? 'personal' : 'proceso');
  /**
   * Una pasada sobre un rango, y el REINTENTO PARTIENDO EN DOS si la respuesta
   * se cortó.
   *
   * 🔴 EL DEFECTO QUE ESTO CIERRA (8-set-2026). Las tres lecturas de bases
   * fallaron con «la respuesta se cortó por tamaño: analiza un rango más
   * corto». Ese mensaje le pedía al usuario que hiciera a mano algo que el
   * programa puede hacer solo: partir el rango. Ahora se parte hasta tres
   * veces —de 12 tramos a 6, a 3, a 1— y solo si sigue sin entrar se avisa.
   * Cada intento con un gratuito cuesta USD 0, así que insistir es gratis y
   * rendirse era caro: se perdía la sección entera del plantel.
   */
  async function extraerTrozo(familia, desde, hasta, nivel) {
    const texto = textoDeRango(markdown, desde, hasta);
    if (!texto.trim()) return;
    // La llave es el TEXTO, no el rango: dos familias pueden pedir rangos
    // distintos —{1,1} y {1,2}— que en un documento de una página resuelven
    // al mismo contenido. Con el rango como llave el dedup no agarraba nada.
    const llave = `${promptDe(familia)}|${texto.length}|${texto.slice(0, 300)}|${texto.slice(-300)}`;
    if (pedidos.has(llave)) return;
    pedidos.set(llave, familia);
    const etiqueta = desde === hasta ? `${desde}` : `${desde}–${hasta}`;
    avisar({ paso: 'extraer', detalle: `${familia} · ${etiqueta}` });
    try {
      const data = await pedir({ accion: 'extraer', texto, seccion: familia });
      const r = data.resultado || {};
      if (data.model) modelos.add(data.model);
      usdPasadas += Number(data.costo) || 0;
      for (const req of (Array.isArray(r.requisitos) ? r.requisitos : [])) {
        // Con el prompt del proceso, un "requisito" suelto es de la empresa.
        if (familia !== 'personal' && !req.cargo) { requisitosEmpresa.push(req); continue; }
        const h = huella(req);
        if (vistos.has(h)) continue;
        vistos.add(h);
        requisitos.push({ ...req, clase: 'personal' });
      }
      for (const req of (Array.isArray(r.requisitos_empresa) ? r.requisitos_empresa : [])) {
        const h = huella(req);
        if (vistos.has(h)) continue;
        vistos.add(h);
        requisitosEmpresa.push(req);
      }
      for (const a of (Array.isArray(r.alertas) ? r.alertas : [])) alertas.push(a);
      for (const clave of ['factores_evaluacion', 'garantias', 'penalidades', 'documentos_presentacion', 'condiciones']) {
        if (Array.isArray(r[clave])) extras[clave].push(...r[clave]);
      }
      if (Array.isArray(r.cronograma)) extras.cronograma.push(...r.cronograma);
      fundirProceso(r.proceso);
      if (r.consorcio && typeof r.consorcio === 'object' && (extras.consorcio == null || (extras.consorcio.permitido == null && r.consorcio.permitido != null))) {
        extras.consorcio = r.consorcio;
      }
    } catch (e) {
      const partible = e.code === 'respuesta_cortada' && nivel < MAX_PARTICIONES && hasta > desde;
      if (partible) {
        const medio = Math.floor((desde + hasta) / 2);
        avisar({ paso: 'extraer', detalle: `${familia} · ${etiqueta} era muy largo, se parte en dos` });
        await extraerTrozo(familia, desde, medio, nivel + 1);
        await extraerTrozo(familia, medio + 1, hasta, nivel + 1);
        return;
      }
      if (e.code === 'respuesta_cortada') {
        alertas.push(`El tramo ${etiqueta} de ${familia} tiene demasiado contenido para leerlo de una: quedó sin extraer. Revísalo a mano en el documento.`);
        return;
      }
      alertas.push(`No se pudo extraer ${familia} (${etiqueta}): ${e.message}`);
    }
  }


  for (const familia of FAMILIAS_EXTRAIBLES) {
    const trozos = familia === 'proceso'
      // El calendario vive con los datos del proceso: sus rangos se suman.
      ? fusionarRangos([...rangosDeFamilia(rangos, resumen, 'proceso'), ...rangosDeFamilia(rangos, resumen, 'cronograma')])
      : rangosDeFamilia(rangos, resumen, familia);
    for (const trozo of trozos) {
      await extraerTrozo(familia, trozo.desde, trozo.hasta, 0);
    }
  }

  // ── 5. Verificar cada cita contra el documento ───────────────────
  avisar({ paso: 'verificar' });
  const verificado = verificarResultado(
    { ...extras, requisitos, requisitos_empresa: requisitosEmpresa, alertas: alertasUnicas(alertas) },
    markdown,
  );
  const filas = aFilasRequisitos(verificado);

  return {
    markdown, indice, rangos,
    resultado: verificado,
    // Ya traducido a lo que la pantalla guarda: la fila de licitacion_requisitos
    // y los campos de cabecera. Que la traducción viva acá y no en el
    // componente es lo que la deja cubierta por tests.
    filas,
    filasEmpresa: aFilasEmpresa(verificado, { desde: filas.length }),
    cabecera: aCabeceraLicitacion(verificado),
    cronograma: aCronograma(verificado),
    // Factores, garantías, penalidades, documentos y condiciones (mig 200).
    extras: aExtrasProceso(verificado),
    sugerencias: sugerenciasDe(verificado),
    alertas: alertasUnicas(verificado.alertas),
    costo: costoDelAnalisis({ paginasOcr: leidas, usdPasadas }),
    modelos: [...modelos],
    paginasOcr: leidas,
    // Si el OCR salió de la caché, esta lectura no cobró el escaneo.
    reusado,
  };
}

/** Une rangos que se tocan o se pisan; el resto queda ordenado. */
export function fusionarRangos(rangos) {
  const ordenados = (rangos || [])
    .filter(r => Number.isFinite(r?.desde) && Number.isFinite(r?.hasta) && r.hasta >= r.desde)
    .sort((a, b) => a.desde - b.desde);
  const out = [];
  for (const r of ordenados) {
    const u = out[out.length - 1];
    if (u && r.desde <= u.hasta + 1) u.hasta = Math.max(u.hasta, r.hasta);
    else out.push({ desde: r.desde, hasta: r.hasta });
  }
  return out;
}

/**
 * Los rangos a leer de una familia: los que eligió el Pase 1 y, si no eligió,
 * los que ya había encontrado el índice (una ventana chica alrededor de cada
 * página con acierto). Sin páginas —un .docx— se devuelve el documento entero
 * como un solo rango, que es lo que `textoDeRango` sabe manejar.
 */
/** Cuántas zonas del documento se leen por familia. */
export const MAX_VENTANAS = 6;

/**
 * Los rangos a leer de una familia: **la unión** de lo que eligió el Pase 1 y
 * lo que encontró el índice.
 *
 * 🔴 ANTES EL PASE 1 REEMPLAZABA AL ÍNDICE, y ahí se perdía medio documento.
 * Medido el 8-set con el Anexo 13: el índice encontraba el plantel en los
 * tramos 2, 21 a 24, 26, 28 a 33 y 55, pero el Pase 1 devolvía un solo rango
 * y el resto no se leía nunca. El modelo lo dijo con todas las letras: «el
 * contenido de los anexos con información clave (ANEXO C: REQUISITOS DE
 * CALIFICACIÓN - pág. 31, ANEXO E: FACTORES DE EVALUACIÓN - pág. 41) NO está
 * incluido en el texto suministrado».
 *
 * El Pase 1 AFINA, no decide: sabe distinguir un rótulo del índice de
 * contenidos de la sección de verdad, y eso vale, pero no puede tapar lo que
 * el `grep` sí encontró. Leer una zona de más con un modelo gratuito cuesta
 * USD 0; perder el plantel cuesta la postulación.
 */
export function rangosDeFamilia(rangos, resumen, familia) {
  const candidatos = [];

  const elegidos = rangos?.[familia];
  if (elegidos?.encontrada && Array.isArray(elegidos.rangos)) {
    for (const r of elegidos.rangos) {
      const desde = Number(r?.desde), hasta = Number(r?.hasta);
      if (!Number.isFinite(desde) || !Number.isFinite(hasta) || hasta < desde) continue;
      // Un rango larguísimo se recorta: si no entra, `extraerTrozo` lo parte.
      candidatos.push({ desde, hasta: Math.min(hasta, desde + 11) });
    }
  }

  const paginas = [...new Set((resumen?.[familia]?.paginas || []).filter(p => p != null))].sort((a, b) => a - b);
  // Ventana de ±1 alrededor de cada acierto del índice.
  for (const p of paginas) candidatos.push({ desde: Math.max(1, p - 1), hasta: p + 1 });

  if (!candidatos.length) return resumen?.[familia]?.aciertos ? [{ desde: 1, hasta: 1 }] : [];

  const fusionadas = fusionarRangos(candidatos);
  if (fusionadas.length <= MAX_VENTANAS) return fusionadas;
  // Si hay más zonas que el tope, se quedan las MÁS GRANDES: una zona larga es
  // donde el rótulo se repite, que es donde está la sección de verdad, no la
  // línea suelta del índice de contenidos.
  return [...fusionadas]
    .sort((a, b) => (b.hasta - b.desde) - (a.hasta - a.desde))
    .slice(0, MAX_VENTANAS)
    .sort((a, b) => a.desde - b.desde);
}

export default {
  leerDocumento, presupuestar, analizar, rangosDeFamilia, fusionarRangos,
  rasterizarPagina, rotarImagen, ocrDeBloques, crearPedidor, alertasUnicas,
};
