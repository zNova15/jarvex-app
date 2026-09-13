// ═══════════════════════════════════════════════════════════════════
// JARVEX — QUÉ INSUMO DEL TRABAJO ES CADA INSUMO DE LA EMPRESA. Lib PURA.
//
// ── LA PREGUNTA, Y POR QUÉ CAMBIÓ (13-set-2026) ───────────────────
// La pestaña «Mapeo al presupuesto» preguntaba: «¿qué código del presupuesto
// de esta obra es esta DESCRIPCIÓN DE FACTURA?». Con 2.220 descripciones
// distintas en el grupo, eso son 2.220 decisiones largas que nadie termina, y
// además mezclaba dos cosas que Gabriel quiere separadas: lo que se COMPRÓ y
// lo que el presupuesto PIDE.
//
// Gabriel: «esta sección debería ser súper sencilla en realidad […] con los
// insumos y servicios del presupuesto que tenga clasificados solo se comparará
// con los insumos y servicios ya clasificados de la empresa […] aquí no se
// vincula las compras ni nada de eso, solo se mapea».
//
// Entonces la pregunta ahora es entre CATÁLOGOS: los 484 insumos y servicios
// de la empresa contra los 434 del presupuesto del trabajo. Y las descripciones
// de factura ya no se preguntan acá: `insumo_categoria` (mig 195) las pega a un
// insumo del catálogo, y de ahí la cadena sale sola —descripción → insumo de la
// empresa → insumo del trabajo— con dos decisiones cortas en lugar de una larga.
//
// ── LA CLASIFICACIÓN ES LA COMPUERTA, NO UN ADORNO ────────────────
// Solo se comparan insumos que están clasificados de los DOS lados, y solo
// contra los de su MISMA clasificación. Es lo que hace que la pantalla sea
// corta: un «GUANTE ANTICORTE» no compite contra los 97 códigos de tubería del
// presupuesto, compite contra los de [83] Implemento y accesorio de seguridad.
// Y lo que no está clasificado no se esconde: se cuenta y se avisa, que es
// literalmente lo que se pidió («se avisa aquí cuánto porcentaje falta
// clasificar del trabajo elegido y pues de la empresa misma»).
//
// ── EL PRESUPUESTO NO GUARDA SU CLASIFICACIÓN: SE DERIVA ──────────
// `insumos_partida` no tiene columna de clasificación y no se le agrega. Son
// 6.722 filas que se reimportan enteras cada vez que se carga un presupuesto,
// así que una columna ahí se perdería en la siguiente importación. La
// clasificación se deriva con el MISMO `clasificarConIUPC` que clasifica el
// catálogo de la empresa —incluido el diccionario propio, que le gana a la
// norma— así que los dos lados hablan exactamente el mismo idioma.
//
// Puro: sin React, sin Dexie, sin fetch (solo importa otras libs puras).
// ═══════════════════════════════════════════════════════════════════

import { prepararCatalogo, sugerirMapeo, normMapeo, proponerFactor, prepararLinea } from './mapeo-insumos.js';
import { resolverCatalogo, normUnidad } from './catalogo-canonico.js';
import {
  clasificarConIUPC, etiquetaCategoria, tipoDeCategoria, bandaConfianza,
} from './indices-unificados-iupc.js';

/** Una clasificación que NO clasifica nada. Es la respuesta honesta del
 *  clasificador cuando no reconoce el insumo, y acá significa «este no puede
 *  entrar a la comparación todavía». */
export const SIN_CLASIFICAR = 'sin_clasificar';

export const estaClasificado = (codigo) => {
  const c = String(codigo || '').trim();
  return !!c && c !== SIN_CLASIFICAR && c !== 'otros';
};

// ── 1. EL PRESUPUESTO DEL TRABAJO ──────────────────────────────────

/**
 * Los insumos del presupuesto de un trabajo, consolidados por código y ya
 * clasificados.
 *
 * El presupuesto reparte el mismo insumo en muchas partidas (el cemento de la
 * obra de agua está en 191): se consolida por `insumo_codigo`, que es la
 * unidad de decisión. `partidas` queda a la vista porque un insumo que aparece
 * en 191 partidas es más importante que uno que aparece en una.
 */
export function presupuestoDelTrabajo(insumosPartida, { terminosCustom = null } = {}) {
  const porCodigo = new Map();
  for (const ip of (insumosPartida || [])) {
    if (!ip || ip.deleted_at) continue;
    const k = ip.insumo_codigo && String(ip.insumo_codigo).trim();
    if (!k) continue;
    const cur = porCodigo.get(k) || {
      codigo: k,
      nombre: ip.nombre_insumo || k,
      unidad: ip.unidad || '',
      tipoPresupuesto: ip.tipo_insumo || '',
      cantidad: 0,
      costo: 0,
      partidas: 0,
    };
    cur.cantidad += Number(ip.cantidad_presupuestada) || 0;
    cur.costo += Number(ip.costo_presupuestado) || 0;
    cur.partidas += 1;
    porCodigo.set(k, cur);
  }
  return [...porCodigo.values()]
    .map(r => {
      const rec = clasificarConIUPC(r.nombre, { terminosCustom });
      return {
        ...r,
        norm: normMapeo(r.nombre),
        clasificacion: rec.codigo,
        clasificacionNombre: etiquetaCategoria(rec.codigo),
        score: rec.score,
        banda: rec.banda,
        clasificado: estaClasificado(rec.codigo),
      };
    })
    .sort((a, b) => b.costo - a.costo || String(a.nombre).localeCompare(String(b.nombre), 'es'));
}

// ── 2. EL CATÁLOGO DE LA EMPRESA ───────────────────────────────────

/**
 * Los insumos y servicios de la empresa, con la clasificación que TIENEN
 * guardada (no la que el motor adivinaría): acá la verdad es lo que alguien
 * decidió en la sección de clasificación, no lo que el estándar opina hoy.
 */
export function catalogoDeLaEmpresa(catalogoRows, { companyId = null } = {}) {
  return resolverCatalogo(catalogoRows, { companyId })
    .filter(r => r.activo !== false)
    .map(r => ({
      id: r.id,
      norm: r.norm,
      nombre: r.nombre,
      unidad: r.unidad || '',
      tipo: r.tipo || 'insumo',
      companyId: r.company_id || null,
      clasificacion: r.familia || SIN_CLASIFICAR,
      clasificacionNombre: etiquetaCategoria(r.familia || SIN_CLASIFICAR),
      clasificado: estaClasificado(r.familia),
    }))
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
}

/** Cuántos de una lista están clasificados, y qué porcentaje. Es el número que
 *  Gabriel pidió ver de los DOS lados antes de empezar a mapear. */
export function resumenClasificacion(filas) {
  const total = (filas || []).length;
  const clasificados = (filas || []).filter(f => f.clasificado).length;
  return {
    total,
    clasificados,
    faltan: total - clasificados,
    pct: total > 0 ? (clasificados * 100) / total : 0,
  };
}

// ── 3. LAS DECISIONES YA TOMADAS ───────────────────────────────────

const RANGO = { manual: 3, ia: 2, regla: 1 };

/**
 * Una decisión por insumo de la empresa, dentro de ESTE trabajo.
 *
 * Sin UNIQUE en la tabla (mig 206, por lo de siempre: dos PCs offline), así
 * que el duplicado benigno se resuelve al leer — 'manual' pisa a 'regla' y, a
 * igual fuente, gana la más reciente. Y el ámbito de la entidad pesa más que
 * el general, igual que en `resolverCatalogo`.
 */
export function resolverMapeosTrabajo(rows, { obraId = null, companyId = null, demo = false } = {}) {
  const porNorm = new Map();
  const rank = (r) => {
    const scope = (r?.company_id || null) === companyId ? 6 : (!r?.company_id ? 3 : 1);
    return scope + (RANGO[r?.fuente] || 0);
  };
  for (const r of rows || []) {
    if (!r || r.deleted_at || !r.norm) continue;
    if (!!r.demo !== !!demo) continue;
    if (obraId && r.obra_id !== obraId) continue;
    const prev = porNorm.get(r.norm);
    if (!prev) { porNorm.set(r.norm, r); continue; }
    const mejor = rank(r) !== rank(prev)
      ? (rank(r) > rank(prev) ? r : prev)
      : (String(r.updated_at || '') >= String(prev.updated_at || '') ? r : prev);
    porNorm.set(r.norm, mejor);
  }
  return porNorm;
}

// ── 4. LA PROPUESTA, CON LA CLASIFICACIÓN COMO COMPUERTA ───────────

/**
 * El índice del presupuesto contra el que se propone.
 *
 * `tipo` se traduce del vocabulario del presupuesto ('material', 'equipo',
 * 'mano_obra'…) al que entiende el motor. Todo lo que no es material entra
 * como 'servicio' y se pide `servicios: true`: si no, `sugerirMapeo` descarta
 * de entrada los 52 insumos no-material del presupuesto y la mitad de los
 * servicios de la empresa no tendría nunca contra qué mapearse. La compuerta
 * fina la pone la clasificación, no el tipo.
 */
export function indiceDelPresupuesto(presupuesto) {
  const porCodigo = new Map();
  const items = (presupuesto || []).map(p => {
    porCodigo.set(p.codigo, p);
    return {
      insumo_codigo: p.codigo,
      nombre: p.nombre,
      unidad: p.unidad || '',
      tipo: p.tipoPresupuesto === 'material' ? 'material' : 'servicio',
      cantidad: p.cantidad || 0,
    };
  });
  return { prep: prepararCatalogo(items), porCodigo };
}

/**
 * La propuesta para UN insumo de la empresa: el mejor insumo del presupuesto,
 * PREFIRIENDO los de su misma clasificación.
 *
 * 🔴 La compuerta de clasificación se aplica DESPUÉS del motor y no antes, a
 * propósito: el motor ya sabe de familias, magnitudes y diámetros, y filtrarle
 * el catálogo de entrada le sacaría el IDF —los pesos por rareza de cada
 * palabra se calculan sobre el catálogo entero—. Se le deja ver todo y después
 * se ordena por clasificación.
 *
 * 🔴 Y ES PREFERENCIA, NO MURO. Los dos lados clasifican por caminos
 * distintos: el catálogo de la empresa guarda lo que una persona DECIDIÓ, y el
 * presupuesto se deriva del estándar al vuelo. Cuando discrepan, un muro
 * dejaría la pantalla inútil justo donde más falta hace. Medido con la tubería
 * de alcantarillado de la obra de agua: el catálogo la tiene en [66] «red de
 * agua potable y alcantarillado» y el estándar la deriva a [72] «redes
 * interiores» — es literalmente la misma tubería y con un muro no se
 * encontraban nunca.
 *
 * Así que si no hay nada de su clasificación se ofrecen igual los mejores del
 * motor, MARCADOS `otraClasificacion` y nunca como 'propuesto': un cruce entre
 * clasificaciones distintas se mira, no se acepta en lote.
 */
export function proponerParaInsumo(insumoEmpresa, { prep, porCodigo, limite = 3 } = {}) {
  if (!insumoEmpresa?.clasificado || !prep) return { candidatos: [], estado: 'sin_candidato' };
  const sug = sugerirMapeo(
    { descripcion: insumoEmpresa.nombre, unidad: insumoEmpresa.unidad },
    prep,
    { servicios: true, limite: Math.max(limite * 4, 12) },
  );
  const todos = sug.candidatos || [];
  const mismos = todos.filter(c => porCodigo?.get(c.cat.codigo)?.clasificacion === insumoEmpresa.clasificacion);

  if (mismos.length) {
    const candidatos = mismos.slice(0, limite);
    // El estado se recalcula sobre los candidatos QUE QUEDARON: si el primero
    // del motor era de otra clasificación y se fue, el «propuesto» que traía
    // ya no vale para el que ahora encabeza.
    const ambiguo = candidatos.length > 1 && (candidatos[0].score - candidatos[1].score) < 0.08;
    return {
      ...sug,
      candidatos,
      ambiguo,
      otraClasificacion: false,
      estado: (candidatos[0].score >= 0.55 && !ambiguo) ? 'propuesto' : 'revisar',
    };
  }

  if (!todos.length) return { ...sug, candidatos: [], otraClasificacion: false, estado: 'sin_candidato' };

  return {
    ...sug,
    candidatos: todos.slice(0, limite).map(c => ({
      ...c,
      otraClasificacion: true,
      clasificacionCandidato: porCodigo?.get(c.cat.codigo)?.clasificacion || null,
    })),
    otraClasificacion: true,
    // Nunca 'propuesto': el lote no puede llevarse por delante una discrepancia
    // de clasificación que alguien tiene que mirar.
    estado: 'revisar',
  };
}

// ── 5. LAS FILAS DE LA PANTALLA ────────────────────────────────────

export const ESTADOS_MAPEO = [
  ['pendientes', 'Por decidir'],
  ['propuesto', 'Con propuesta'],
  ['revisar', 'Dudosas'],
  ['sin_candidato', 'Sin nada parecido en el presupuesto'],
  ['sin_clasificar', 'Falta clasificar el insumo'],
  ['decididas', 'Ya decididas'],
];

/**
 * Una fila por insumo de la empresa: su decisión si la hay, su propuesta si no,
 * y «falta clasificarlo» cuando todavía no puede entrar a la comparación.
 */
export function filasDeMapeoTrabajo(catalogo, { prep, porCodigo, decisiones }) {
  return (catalogo || []).map(ins => {
    const ya = decisiones?.get(ins.norm) || null;
    if (ya) {
      return {
        ...ins,
        estado: 'decididas',
        decision: ya,
        presupuesto: ya.insumo_codigo ? porCodigo?.get(ya.insumo_codigo) || null : null,
        sug: null,
      };
    }
    if (!ins.clasificado) {
      return { ...ins, estado: 'sin_clasificar', decision: null, presupuesto: null, sug: null };
    }
    const sug = proponerParaInsumo(ins, { prep, porCodigo });
    return { ...ins, estado: sug.estado, decision: null, presupuesto: null, sug };
  });
}

/** Cuánto se avanzó. En FILAS y no en plata: acá no hay plata —no se vinculan
 *  compras— y lo que importa es cuántos insumos de la empresa ya saben qué son
 *  dentro de este trabajo. */
export function resumenAvanceMapeo(filas) {
  const r = {
    total: 0, decididas: 0, mapeadas: 0, noEstan: 0,
    propuesto: 0, revisar: 0, sinCandidato: 0, sinClasificar: 0,
  };
  for (const f of (filas || [])) {
    r.total += 1;
    if (f.estado === 'decididas') {
      r.decididas += 1;
      if (f.decision?.decision === 'mapeado') r.mapeadas += 1; else r.noEstan += 1;
    } else if (f.estado === 'propuesto') r.propuesto += 1;
    else if (f.estado === 'revisar') r.revisar += 1;
    else if (f.estado === 'sin_clasificar') r.sinClasificar += 1;
    else r.sinCandidato += 1;
  }
  // El porcentaje se mide sobre lo que SE PUEDE decidir. Contar contra el total
  // dejaría el avance clavado por culpa de los insumos sin clasificar, que se
  // arreglan en otra pantalla: el número diría «no avanzaste» cuando sí.
  const decidibles = r.total - r.sinClasificar;
  r.pct = decidibles > 0 ? (r.decididas * 100) / decidibles : 0;
  return r;
}

/**
 * Lo que el trabajo todavía no tiene de nadie: insumos del presupuesto a los
 * que no apunta ningún insumo de ninguna empresa.
 *
 * Es la vista inversa y es la que contesta la pregunta que de verdad importa
 * después: «de las 434 cosas que la obra necesita, ¿cuáles ya sé quién me las
 * vende?».
 */
export function cobertura(presupuesto, mapeosVivos) {
  const cubiertos = new Map();
  for (const m of (mapeosVivos || [])) {
    if (!m || m.deleted_at || m.decision !== 'mapeado' || !m.insumo_codigo) continue;
    if (!cubiertos.has(m.insumo_codigo)) cubiertos.set(m.insumo_codigo, []);
    cubiertos.get(m.insumo_codigo).push(m);
  }
  const filas = (presupuesto || []).map(p => ({
    ...p,
    cubiertoPor: cubiertos.get(p.codigo) || [],
  }));
  const conCobertura = filas.filter(f => f.cubiertoPor.length).length;
  return {
    filas,
    total: filas.length,
    conCobertura,
    sinCobertura: filas.length - conCobertura,
    pct: filas.length > 0 ? (conCobertura * 100) / filas.length : 0,
  };
}

// ── 6. LO QUE SE ESCRIBE ───────────────────────────────────────────

/** El cuerpo de la fila de `insumo_trabajo_mapeo` para «es este insumo del
 *  presupuesto». */
export function decisionDeMapeo(fila, insumoPresupuesto, { obraId, companyId = null, factor = null, factorFuente = null, score = null, fuente = 'manual' } = {}) {
  // 🔴 EL INVARIANTE QUE LA BASE EXIGE Y DEXIE NO VALIDA (mismo caso que
  // insumo_categoria): el CHECK `insumo_trabajo_mapeo_coherente` obliga a que
  // decision='mapeado' venga con `insumo_codigo`. Una fila sin código se
  // guardaría local y rebotaría en el push con 23514, dejando el sync en
  // reintento eterno y en silencio.
  if (!insumoPresupuesto?.codigo) {
    throw new Error('decisionDeMapeo: sin insumo del presupuesto no se puede decidir «mapeado» — usá decisionNoEsta().');
  }
  if (!obraId) throw new Error('decisionDeMapeo: falta el trabajo — los códigos del presupuesto son de UNA obra.');
  const uOrigen = fila?.unidad || null;
  const uDestino = insumoPresupuesto?.unidad || null;
  const difieren = normUnidad(uOrigen) !== normUnidad(uDestino);
  return {
    obra_id: obraId,
    company_id: companyId || null,
    norm: fila.norm,
    catalogo_insumo_id: fila.id && !String(fila.id).startsWith('disgregacion:') ? fila.id : null,
    muestra: fila.nombre,
    decision: 'mapeado',
    insumo_codigo: insumoPresupuesto.codigo,
    insumo_nombre: insumoPresupuesto.nombre || null,
    unidad_origen: uOrigen,
    unidad_destino: uDestino,
    factor: (difieren && factor != null) ? Number(factor) : null,
    factor_fuente: (difieren && factor != null) ? factorFuente : null,
    fuente,
    score: score == null ? null : Number(score),
    nota: null,
    deleted_at: null,
  };
}

/** El cuerpo para «este insumo de la empresa NO está en el presupuesto de este
 *  trabajo». También se recuerda: es una respuesta, no un descarte. */
export function decisionNoEsta(fila, { obraId, companyId = null, nota = null } = {}) {
  if (!obraId) throw new Error('decisionNoEsta: falta el trabajo.');
  return {
    obra_id: obraId,
    company_id: companyId || null,
    norm: fila.norm,
    catalogo_insumo_id: fila.id && !String(fila.id).startsWith('disgregacion:') ? fila.id : null,
    muestra: fila.nombre,
    decision: 'no_esta',
    insumo_codigo: null,
    insumo_nombre: null,
    unidad_origen: fila?.unidad || null,
    unidad_destino: null,
    factor: null,
    factor_fuente: null,
    fuente: 'manual',
    score: null,
    nota,
    deleted_at: null,
  };
}

/** El factor que se propondría entre la unidad de la empresa y la del
 *  presupuesto. Reusa el motor de la tanda 7 — la tabla del acero, los largos
 *  comerciales y los kg por bolsa ya están ahí y no se re-derivan acá. */
export function factorPropuesto(insumoEmpresa, insumoPresupuesto) {
  if (!insumoEmpresa || !insumoPresupuesto) return null;
  const linea = prepararLinea({ descripcion: insumoEmpresa.nombre, unidad: insumoEmpresa.unidad });
  const cat = prepararCatalogo([{
    insumo_codigo: insumoPresupuesto.codigo, nombre: insumoPresupuesto.nombre,
    unidad: insumoPresupuesto.unidad, tipo: 'material', cantidad: 0,
  }]).items[0];
  return cat ? proponerFactor(linea, cat) : null;
}

/** La banda de confianza de una propuesta, para pintarla igual que en el resto
 *  de la app. */
export const bandaDe = (score) => bandaConfianza(score);

/** A qué tabla de inventario iría un insumo según su clasificación. Se expone
 *  para que la pantalla no re-derive el mapeo (regla 8 del CLAUDE.md: el puente
 *  vive en un solo lugar). */
export const destinoDe = (clasificacion) => tipoDeCategoria(clasificacion);
