// ═══════════════════════════════════════════════════════════════════
// JARVEX — LA BANDEJA QUE APRENDE (tanda 14, entrega 4). Lib PURA.
//
// PARA QUÉ EXISTE
// Hay 1.885 descripciones distintas de insumo en las facturas del grupo y
// nadie las categoriza de a una desde la ficha de cada insumo. Esta lib arma la
// lista de lo que falta decidir —ordenada por plata, agrupada por propuesta— y
// resuelve qué se decidió ya, para que la pantalla solo pinte.
//
// ── LO QUE SE MIDIÓ CONTRA PRODUCCIÓN ANTES DE ESCRIBIR ───────────
// 2.424 líneas de compra → 1.885 descripciones distintas, S/ 1.950.400, en 24
// entidades. Tres números que decidieron el diseño:
//
// 1. NO HAY PARETO CORTO. El top 20 de descripciones es el 34,6% de la plata,
//    el top 100 el 68,4%; hacen falta 200 decisiones para llegar al 83,5%. O
//    sea: no alcanza con decidir «las de arriba» y tampoco se pueden decidir
//    1.885 a mano. Por eso hay lotes.
// 2. LA COLA ES LARGA Y BARATA. 1.473 de las 1.885 mueven menos de S/ 500 cada
//    una y JUNTAS son el 5,8% (S/ 113.283): comida de restaurante, medicinas,
//    ropa, «artículo 1», «saldos», «normal l». Por eso `no_insumo` se opera en
//    lote y se recuerda. NO se esconden con un umbral: eso es exactamente el
//    error que se arregló en «Sin respaldo» (entrega 1) — lo que no se ve, no
//    existe para nadie.
// 3. EL 45% DE LA PLATA NO TIENE CANDIDATO PORQUE LA FILA NO EXISTE. Medido
//    sobre las 184 descripciones más caras contra el catálogo real de Gabriel:
//    faltan la pintura entera, los perfiles comerciales («plancha negra lisa»,
//    «tubo rectangular 4 x 8 x 3mm») y —hasta la mig 195— el acero corrugado.
//    La respuesta correcta ahí NO es «no es un insumo»: es «esto falta en el
//    catálogo». Por eso `filaNuevaDeCatalogo()`.
//
// ── POR QUÉ EL MOTOR ES EL DE `mapeo-insumos.js` Y NO `buscarCatalogo` ──
// `buscarCatalogo()` de catalogo-canonico.js exige que peguen TODOS los tokens
// de la consulta. Sirve para lo que alguien TIPEA («tub» → «TUBERIA…»), pero
// contra una descripción de factura una sola marca la mata: «CEMENTO PORTLAND
// TIPO I 42.5 KG - PACASMAYO-BOLSA» no pega con «CEMENTO PORTLAND TIPO I (42.5
// kg)» porque «pacasmayo» no está del otro lado. El motor de mapeo-insumos
// —Dice con IDF, compuerta de familia, magnitudes con unidad, y una lista de
// STOP que ya saca marcas y normas— le da 89%. Es el mismo motor medido y
// afinado en la tanda 7; acá se lo apunta al catálogo canónico en vez de al
// presupuesto de una obra.
//
// ── QUÉ SE DECIDE ACÁ Y QUÉ NO ────────────────────────────────────
// Acá se decide «esta descripción ES este insumo del catálogo» → `insumo_categoria`
// (mig 195). La pestaña «Mapeo al presupuesto» decide otra cosa contra otro
// catálogo —«¿qué código del presupuesto de la obra es esto?» → `insumo_mapeo`
// (mig 183)— y alimenta Abastecimiento. Son tablas distintas a propósito: ver
// el encabezado de la mig 195.
//
// Puro: sin React, sin Dexie, sin fetch (solo importa otras libs puras).
// ═══════════════════════════════════════════════════════════════════

import {
  prepararCatalogo, sugerirMapeo, claveMapeo, normMapeo,
} from './mapeo-insumos.js';
import {
  resolverCatalogo, normUnidad, tipoInsumoDe, categoriaItemDe,
} from './catalogo-canonico.js';
import {
  clasificarConIUPC, bandaConfianza, etiquetaCategoria, tipoDeCategoria,
} from './indices-unificados-iupc.js';

// ── 1. EL CATÁLOGO CONTRA EL QUE SE PROPONE ────────────────────────

/**
 * Las filas del catálogo canónico, más las que viven SOLO en la disgregación.
 *
 * 🔴 Por qué la segunda mitad: la entrega 2 importó el acero corrugado a
 * `catalogo_disgregacion` (padre en kg + cuatro varillas de 9 m) y NO a
 * `catalogo_insumos`. La mig 195 lo corrige en el server, pero esta unión se
 * queda igual: es lo que hace que la bandeja funcione en un device que todavía
 * no bajó la migración, y lo que la deja bien si mañana entra otra familia
 * disgregada por el mismo camino. Deduplica por `norm`, así que cuando la
 * migración ya corrió no agrega nada.
 */
export function catalogoParaProponer(catalogoRows, disgregacionRows, { companyId = null } = {}) {
  const vivos = resolverCatalogo(catalogoRows, { companyId }).filter(r => r.activo !== false);
  const porNorm = new Map(vivos.map(r => [r.norm, r]));
  for (const d of (disgregacionRows || [])) {
    if (!d || d.deleted_at || d.activo === false) continue;
    // Las de otra entidad no se miran (mismo criterio que resolverCatalogo).
    if ((d.company_id || null) && (d.company_id || null) !== companyId) continue;
    for (const [norm, nombre, unidad] of [
      [d.padre_norm, d.padre_nombre, d.padre_unidad],
      [d.hijo_norm, d.hijo_nombre, d.hijo_unidad],
    ]) {
      if (!norm || !nombre || porNorm.has(norm)) continue;
      porNorm.set(norm, {
        id: `disgregacion:${norm}`, norm, nombre, unidad: unidad || '',
        tipo: 'insumo', familia: clasificarConIUPC(nombre).codigo,
        origen: 'disgregacion', activo: true, company_id: d.company_id || null,
        soloEnDisgregacion: true,
      });
    }
  }
  return [...porNorm.values()];
}

/**
 * El índice que usa el motor. `insumo_codigo` es el id de la fila del catálogo:
 * `prepararCatalogo()` lo exige y lo devuelve en el candidato, así que es la
 * llave con la que se guarda la decisión.
 */
export function indiceDePropuestas(filasCatalogo) {
  const porId = new Map();
  const items = (filasCatalogo || []).map(r => {
    porId.set(r.id, r);
    return {
      insumo_codigo: r.id, nombre: r.nombre, unidad: r.unidad || '',
      tipo: r.tipo === 'servicio' ? 'servicio' : 'material', cantidad: 0,
    };
  });
  return { prep: prepararCatalogo(items), porId };
}

// ── 2. LAS DECISIONES YA TOMADAS ───────────────────────────────────

/**
 * Una decisión por `norm`. Sin UNIQUE en la tabla (mig 195, por lo mismo de
 * siempre: dos PCs offline), así que el duplicado benigno se resuelve al leer —
 * 'manual' pisa a 'regla' y, a igual fuente, gana la más reciente; y el ámbito
 * de la entidad pesa más que el general, igual que en `resolverCatalogo`.
 */
export function resolverCategorias(rows, { companyId = null, demo = false } = {}) {
  const porNorm = new Map();
  // Jerarquía:
  // 1. Decisión de la propia empresa (scope 6) > global (scope 3) > otra empresa (scope 1)
  // 2. Dentro de cada nivel, manual (+2) pisa a automático/regla (+0)
  // 3. A igual rango, la fecha más reciente gana
  const rank = (r) => {
    const scope = (r?.company_id || null) === companyId ? 6
      : (!r?.company_id ? 3 : 1);
    const fuente = r?.fuente === 'manual' ? 2 : 0;
    return scope + fuente;
  };
  for (const r of rows || []) {
    if (!r || r.deleted_at || !r.norm) continue;
    if (!!r.demo !== !!demo) continue;
    // Aprendizaje global: una empresa hereda categorizaciones aprendidas de otras
    // entidades o de decisiones globales, a menos que tenga su propia decisión.
    const prev = porNorm.get(r.norm);
    if (!prev) { porNorm.set(r.norm, r); continue; }
    const mejor = rank(r) !== rank(prev)
      ? (rank(r) > rank(prev) ? r : prev)
      : (String(r.updated_at || '') >= String(prev.updated_at || '') ? r : prev);
    porNorm.set(r.norm, mejor);
  }
  return porNorm;
}

// ── 3. LAS FILAS DE LA BANDEJA ─────────────────────────────────────

/** Una fila por DESCRIPCIÓN, con lo que esa descripción movió en total.
 *  Espeja el criterio de la pestaña de mapeo: se decide por texto, no por
 *  factura, y las ventas y notas de crédito ya vienen filtradas de afuera. */
export function agruparDescripciones(compras) {
  const porNorm = new Map();
  for (const c of (compras || [])) {
    if (c?.clase && c.clase !== 'compra') continue;
    const norm = claveMapeo(c?.nombre);
    if (!norm) continue;
    const cur = porNorm.get(norm) || {
      norm, muestra: c.nombre, veces: 0, importe: 0, cantidad: 0,
      unidades: new Set(), provs: new Set(), entidades: new Set(), monedas: new Set(),
    };
    cur.veces += 1;
    cur.cantidad += Number(c.cantidad) || 0;
    // Solo los soles suman. Los dólares se VEN (decisión de Gabriel del
    // 7-set) pero no se mezclan en el total: es la misma invariante de
    // «Sin respaldo». `monedas` es lo que la pantalla usa para el marcador.
    if ((c.moneda || 'PEN') === 'PEN') cur.importe += (Number(c.cantidad) || 0) * (Number(c.precio) || 0);
    if (c.unidad) cur.unidades.add(c.unidad);
    if (c.proveedorNombre) cur.provs.add(c.proveedorNombre);
    if (c.companyId) cur.entidades.add(c.companyId);
    cur.monedas.add(c.moneda || 'PEN');
    porNorm.set(norm, cur);
  }
  return [...porNorm.values()].sort((a, b) => b.importe - a.importe);
}

/**
 * Los filtros de la bandeja. UN SOLO EJE: la confianza de la coincidencia.
 *
 * Antes convivían dos ejes que decían lo mismo con otras palabras — el viejo
 * («Con propuesta» / «Dudosas» / «Falta en el catálogo») y el de bandas. Con
 * la cobertura al 100% toda fila pendiente tiene coincidencia y cae en alguna
 * banda, así que el eje viejo pasó a ser una segunda forma de contar lo mismo:
 * ruido en la barra de filtros. Queda «Por decidir» como vista por defecto
 * (todo lo pendiente junto), las cinco bandas para ir por partes, y las ya
 * decididas.
 */
export const ESTADOS = [
  ['pendientes', 'Por decidir'],
  ['alta', 'Coincidencia alta (≥70%)'],
  ['media', 'Coincidencia media (40-69%)'],
  ['baja', 'Coincidencia baja (25-39%)'],
  ['rara', 'Coincidencia rara (10-24%)'],
  ['extrema_baja', 'Coincidencia extremadamente baja (<10%)'],
  ['sin_propuesta', 'Sin propuesta — elegir a mano'],
  ['decididas', 'Ya decididas'],
];

/**
 * La banda de las filas que el sistema NO sabe clasificar.
 *
 * 🔴 POR QUÉ EXISTE (13-set-2026, pedido de Gabriel: «sugerir "Sin clasificar
 * — revisar a mano" es lo mismo que no sugerir una clasificación»).
 * Antes estas filas se dibujaban EXACTAMENTE igual que una propuesta de
 * verdad: «→ [sin_clasificar] Sin clasificar — revisar a mano · Coincidencia
 * extremadamente baja (5%)», con su botón verde de «Aceptar». O sea que el
 * botón más fácil de apretar guardaba la NO-decisión como si fuera una
 * decisión, y la fila salía de la cola sin que nadie hubiera clasificado nada.
 * En la bandeja de GASOMI la banda más floja —menos de 10% de confianza, que
 * es donde caían éstas— eran 150 descripciones. Ahora se dicen con todas las
 * letras y no tienen candidato que aceptar: hay que elegir la clasificación a
 * mano, que es la única respuesta honesta.
 */
export const BANDA_SIN_PROPUESTA = {
  slug: 'sin_propuesta',
  label: 'Sin propuesta',
  color: 'b-gray',
};

/**
 * La bandeja entera: cada descripción con su decisión (si la hay) o su
 * propuesta (si el motor encontró algo).
 *
 * 100% de cobertura predictiva garantizada: Todo insumo cuenta con una
 * recomendación oficial IUPC / complementaria y su banda de probabilidad.
 */
export function filasDeBandeja(descripciones, { prep, porId, decisiones, terminosCustom = null }) {
  return (descripciones || []).map(d => {
    const ya = decisiones?.get(d.norm) || null;
    if (ya) {
      const cat = ya.catalogo_insumo_id ? porId?.get(ya.catalogo_insumo_id) : null;
      return { ...d, estado: 'decididas', decision: ya, cat, sug: null, banda: 'decididas' };
    }
    const sug = prep
      ? sugerirMapeo({ descripcion: d.muestra, unidad: [...d.unidades][0] || '' }, prep, { servicios: true })
      : { estado: 'sin_candidato', candidatos: [] };
    const estado = (sug.estado === 'propuesto' || sug.estado === 'revisar') ? sug.estado : 'falta';

    // Clasificación predictiva: diccionario propio primero, después el oficial.
    const recIUPC = clasificarConIUPC(d.muestra, { terminosCustom });
    const cand = sug.candidatos?.[0] || null;
    const scoreEfectivo = cand ? cand.score : recIUPC.score;

    // 🔴 «Sin clasificar» NO es una propuesta: es la ausencia de una. Si no
    // hay candidato del catálogo Y el estándar tampoco reconoce nada, la fila
    // se marca como tal y NO lleva candidato — no hay nada que «aceptar».
    // Ver `BANDA_SIN_PROPUESTA`.
    const sinPropuesta = !cand && recIUPC.codigo === 'sin_clasificar';
    const b = sinPropuesta ? BANDA_SIN_PROPUESTA : bandaConfianza(scoreEfectivo);

    if (sinPropuesta) {
      return {
        ...d,
        estado,
        decision: null,
        cat: null,
        sug,
        banda: BANDA_SIN_PROPUESTA.slug,
        bandaInfo: BANDA_SIN_PROPUESTA,
        recomendacionIUPC: recIUPC,
        candidatoIUPC: null,
        sinPropuesta: true,
      };
    }

    const candidatoIUPC = {
      cat: {
        codigo: recIUPC.codigo,
        insumo_codigo: recIUPC.codigo,
        nombre: `[${recIUPC.codigo}] ${recIUPC.nombre}`,
        familia: recIUPC.codigo,
        categoria: recIUPC.codigo,
        tipo: recIUPC.codigo === 'servicios' ? 'servicio' : 'material',
        unidad: [...(d.unidades || [])][0] || 'und',
        esIUPC: true,
      },
      score: recIUPC.score,
      motivos: recIUPC.motivos,
      inclinacion: recIUPC.inclinacion,
      banda: b,
    };

    return {
      ...d,
      estado,
      decision: null,
      cat: null,
      sug,
      banda: b.slug,
      bandaInfo: b,
      recomendacionIUPC: recIUPC,
      candidatoIUPC,
      sinPropuesta: false,
    };
  });
}

/** El candidato que se aceptaría con «aceptar», ya resuelto contra el catálogo. */
export function candidatoDe(fila, porId) {
  const c = fila?.sug?.candidatos?.[0];
  if (c) return { ...c, cat: { ...c.cat, fila: porId?.get(c.cat.codigo) || null } };
  if (fila?.candidatoIUPC) return fila.candidatoIUPC;
  return null;
}

// ── 4. LOS LOTES ───────────────────────────────────────────────────

/**
 * Agrupa las filas que caen en la MISMA propuesta, que es el lote real.
 *
 * 🔴 Por qué no se agrupa por texto normalizado, que era la idea original:
 * medido sobre las 184 descripciones más caras, `claveMapeo` junta UNA sola
 * («2 x 6x 3» con «2 x 6 x 3»). Normalizar conserva todos los tokens, así que
 * dos escrituras del mismo insumo con distinta marca o distinta norma nunca
 * colapsan. Lo que SÍ colapsa es la propuesta: «VARILLA DE ACERO CORRUGADO DE
 * 3/8», «FIERRO CORRUGADO 3/8 SIDERPERU» y «BARRA CORRUGADA DE ACERO 9.5MM»
 * caen las tres en la misma fila del catálogo, y ese es el lote que se acepta
 * de un golpe.
 *
 * Devuelve solo los grupos de 2 o más, ordenados por plata: un grupo de uno no
 * es un lote, es una fila.
 */
export function lotesPorPropuesta(filas) {
  const m = new Map();
  for (const f of (filas || [])) {
    const cod = f?.sug?.candidatos?.[0]?.cat?.codigo;
    if (!cod || f.estado !== 'propuesto') continue;
    const g = m.get(cod) || { codigo: cod, nombre: f.sug.candidatos[0].cat.nombre, filas: [], importe: 0 };
    g.filas.push(f);
    g.importe += f.importe;
    m.set(cod, g);
  }
  return [...m.values()].filter(g => g.filas.length > 1).sort((a, b) => b.importe - a.importe);
}

// ── 5. EL AVANCE ───────────────────────────────────────────────────

/** Cuántas descripciones y cuántos soles quedan — para saber cuándo parar. */
export function resumenAvance(filas) {
  const r = {
    total: 0, totalPlata: 0,
    decididas: 0, plataDecidida: 0,
    enCatalogo: 0, plataEnCatalogo: 0,
    noInsumo: 0, plataNoInsumo: 0,
    propuesto: 0, plataPropuesto: 0,
    revisar: 0, plataRevisar: 0,
    falta: 0, plataFalta: 0,
    alta: 0, plataAlta: 0,
    media: 0, plataMedia: 0,
    baja: 0, plataBaja: 0,
    rara: 0, plataRara: 0,
    extrema_baja: 0, plataExtremaBaja: 0,
    sin_propuesta: 0, plataSinPropuesta: 0,
  };
  for (const f of (filas || [])) {
    r.total += 1; r.totalPlata += f.importe;
    if (f.banda && f.banda !== 'decididas' && r[f.banda] !== undefined) {
      r[f.banda] += 1;
      if (f.banda === 'alta') r.plataAlta += f.importe;
      else if (f.banda === 'media') r.plataMedia += f.importe;
      else if (f.banda === 'baja') r.plataBaja += f.importe;
      else if (f.banda === 'rara') r.plataRara += f.importe;
      else if (f.banda === 'extrema_baja') r.plataExtremaBaja += f.importe;
      else if (f.banda === 'sin_propuesta') r.plataSinPropuesta += f.importe;
    }
    if (f.estado === 'decididas') {
      r.decididas += 1; r.plataDecidida += f.importe;
      if (f.decision?.decision === 'catalogo') { r.enCatalogo += 1; r.plataEnCatalogo += f.importe; }
      else { r.noInsumo += 1; r.plataNoInsumo += f.importe; }
    } else if (f.estado === 'propuesto') { r.propuesto += 1; r.plataPropuesto += f.importe; }
    else if (f.estado === 'revisar') { r.revisar += 1; r.plataRevisar += f.importe; }
    else { r.falta += 1; r.plataFalta += f.importe; }
  }
  r.pct = r.totalPlata > 0 ? (r.plataDecidida * 100) / r.totalPlata : 0;
  return r;
}

// ── 6. LO QUE SE ESCRIBE ───────────────────────────────────────────

/** El cuerpo de la fila de `insumo_categoria` para «es este insumo del catálogo». */
export function decisionDeCatalogo(fila, catalogoFila, { factor = null, factorFuente = null, score = null, companyId = null, categoria = null } = {}) {
  // 🔴 EL INVARIANTE QUE LA BASE EXIGE Y DEXIE NO VALIDA.
  // CHECK `insumo_categoria_catalogo_coherente`: decision='catalogo' obliga a
  // `catalogo_insumo_id NOT NULL`. Una fila sin id se guardaba local sin
  // chistar y REBOTABA en el push a Supabase con 23514, dejando el sync en
  // reintento eterno y en silencio. Mejor romper acá, fuerte y temprano: si no
  // hay fila de catálogo, la respuesta correcta es darla de alta primero
  // (`agregarAlCatalogoYDecidir`), no fabricar una decisión sin destino.
  if (!catalogoFila?.id) {
    throw new Error('decisionDeCatalogo: sin catalogo_insumo_id no se puede decidir «catalogo» — dar de alta el insumo primero (agregarAlCatalogoYDecidir).');
  }
  const unidadOrigen = [...(fila.unidades || [])][0] || null;
  const unidadDestino = catalogoFila?.unidad || null;
  const catElegida = categoria || catalogoFila?.familia || fila?.recomendacionIUPC?.codigo || 'sin_clasificar';
  return {
    norm: fila.norm,
    muestra: fila.muestra,
    decision: 'catalogo',
    catalogo_insumo_id: catalogoFila?.id || null,
    familia: catElegida,
    subfamilia: null,
    unidad_origen: unidadOrigen,
    unidad_destino: unidadDestino,
    factor: (factor != null && normUnidad(unidadOrigen) !== normUnidad(unidadDestino)) ? Number(factor) : null,
    factor_fuente: (factor != null && normUnidad(unidadOrigen) !== normUnidad(unidadDestino)) ? factorFuente : null,
    fuente: 'manual',
    score: score == null ? (fila?.recomendacionIUPC?.score ?? null) : Number(score),
    company_id: companyId || null,
    deleted_at: null,
  };
}

/** El cuerpo para «esto no es un insumo del catálogo». También se recuerda. */
export function decisionNoInsumo(fila, { companyId = null, nota = null } = {}) {
  return {
    norm: fila.norm,
    muestra: fila.muestra,
    decision: 'no_insumo',
    catalogo_insumo_id: null,
    familia: null, subfamilia: null,
    unidad_origen: [...(fila.unidades || [])][0] || null,
    unidad_destino: null, factor: null, factor_fuente: null,
    fuente: 'manual', score: null, nota,
    company_id: companyId || null,
    deleted_at: null,
  };
}


/**
 * La fila de catálogo que se crearía con «esto falta en el catálogo».
 *
 * El nombre sale de la factura tal cual (en mayúsculas, como el resto del
 * catálogo), la unidad de lo que decía la factura, y la categoría del ESTÁNDAR
 * IUPC — el mismo que puntúa la bandeja— así el insumo nuevo queda del lado
 * correcto desde el minuto cero y la próxima descripción parecida sí encuentra
 * candidato. Todo es corregible antes de guardar.
 */
export function filaNuevaDeCatalogo(fila, { companyId = null, familia = null, unidad = null, nombre = null } = {}) {
  const nom = (nombre || fila?.muestra || '').trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 200);
  // La categoría sale SOLO del estándar IUPC — el vocabulario comercial viejo
  // ya no se usa para dar de alta nada (decisión del 13-set).
  const fam = familia || fila?.recomendacionIUPC?.codigo || clasificarConIUPC(nom).codigo;
  const u = normUnidad(unidad || [...(fila.unidades || [])][0] || '');
  return {
    tipo: tipoDeCategoria(fam) === 'servicio' ? 'servicio' : 'insumo',
    nombre: nom,
    norm: normMapeo(nom),
    unidad: u || 'und',
    familia: fam,
    // Sin subfamilia: se abandonaron el 13-set, hay UNA sola clasificación.
    subfamilia: null,
    // 'manual' y no 'xlsx': lo escribió una persona, así que una reimportación
    // del archivo NO puede marcarlo como ausente ni pisarlo (diffCatalogo ya
    // respeta eso).
    origen: 'manual',
    activo: true,
    revisado: false,
    company_id: companyId || null,
    deleted_at: null,
  };
}

/**
 * Lo que la decisión le enseña al clasificador de la contadora.
 * Es el puente de la entrega 2 puesto a trabajar: una sola decisión en la
 * bandeja contesta las tres preguntas —qué insumo del catálogo es, a qué tabla
 * de inventario va, y en qué categoría de gasto cae— sin abrir tres pantallas.
 * Devuelve null cuando no hay nada que enseñar.
 */
export function aprendizajeParaContadora(fila, catalogoFila, equivalencias = null) {
  if (!catalogoFila) return null;
  // La `subcategoria` que ve la contadora ya NO sale de las subfamilias
  // (abandonadas el 13-set): es el CÓDIGO IUPC de la categoría. Así el detalle
  // fino no se pierde y queda expresado en la única taxonomía que hay.
  const cod = catalogoFila.familia || null;
  return {
    descripcion: fila.muestra,
    categoria: categoriaItemDe(catalogoFila, equivalencias),
    subcategoria: cod ? etiquetaCategoria(cod) : null,
    tipoInsumo: tipoInsumoDe(catalogoFila, equivalencias),
  };
}
