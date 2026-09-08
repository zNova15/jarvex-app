// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL CATÁLOGO CANÓNICO DE INSUMOS Y SERVICIOS (tanda 14, entrega 2).
//
// PARA QUÉ EXISTE
// Gabriel, 7-set-2026: «el archivo tiene una categorización simple, no es
// perfecta, y el objetivo es que agilice el proceso de categorización».
// `Modelos/Categorizacion Simple.xlsx` deja de ser un archivo suelto en una
// carpeta y pasa a ser LA LISTA contra la que la app propone nombres, unidades
// y familias: 444 insumos en 10 familias comerciales, 34 servicios, y la regla
// de disgregación del acero.
//
// 🔴 EL RIESGO QUE ESTA LIB EXISTE PARA EVITAR
// Ya conviven TRES vocabularios de categorización en el repo:
//   1. `clasificarInsumo` (insumo-clasificador.js) — 5 familias, decide a qué
//      TABLA de inventario va un nombre (materiales/herramientas/epps/…).
//   2. `clasificar-items.js` — 7 categorías + subcategoría libre, es lo que la
//      contadora corrige sobre las líneas de factura.
//   3. Los 434 códigos del presupuesto (`insumos_partida`), que es contra lo
//      que mapea `mapeo-insumos.js`.
// Un CUARTO vocabulario suelto sería el peor resultado posible de la tanda.
// Por eso la familia comercial del xlsx no reemplaza a nadie: es un nivel
// nuevo que vive DENTRO de este catálogo y que TRADUCE a los otros dos
// vocabularios de tipos — `tipoInsumoDe()` devuelve el de (1) y
// `categoriaItemDe()` el de (2). El catálogo es el puente, no un cuarto idioma.
//
// LA FAMILIA DA LA COMPUERTA, LA REGLA REFINA ADENTRO
// «EQUIPOS Y HERRAMIENTAS» trae 66 filas donde conviven la RETROEXCAVADORA
// (unidad `hm`, o sea horas-máquina) con el MARTILLO (`und`). La familia sola
// mandaría las dos a la misma tabla. Entonces la familia decide el universo y,
// solo donde ese universo admite más de una respuesta, se llama a la regla que
// ya existe. Al revés no: en «IMPLEMENTOS DE SEGURIDAD» la familia MANDA
// aunque la regla no reconozca «TRAJE DE PROTECCION TYBEK» — el xlsx lo escribió
// una persona que sabe, la regex no.
//
// LA IMPORTACIÓN ES REPETIBLE
// La clave lógica es la DESCRIPCIÓN NORMALIZADA (`normMapeo`, la misma que usa
// el motor de mapeo, para que catálogo y línea de factura compartan espacio de
// claves). Volver a cargar el xlsx corregido ACTUALIZA por esa clave, no
// duplica. Lo que el archivo ya no trae no se borra: se propone desactivar, y
// lo que alguien agregó a mano (`origen: 'manual'`) la importación NO lo toca
// nunca.
//
// Puro: sin React, sin Dexie, sin fetch. Las escrituras viven en
// `catalogo-canonico-db.js`.
// ═══════════════════════════════════════════════════════════════════

import {
  normMapeo, prepararLinea, proponerFactor,
} from './mapeo-insumos.js';
import { clasificarInsumo } from './insumo-clasificador.js';

// ── 1. LAS FAMILIAS COMERCIALES ────────────────────────────────────
//
// `tipo` es el vocabulario de `insumo-clasificador.js` (a qué tabla de
// inventario va). `categoria` es el de `clasificar-items.js` (cómo se agrupa el
// gasto para la contadora). `refina` marca las familias donde la regla puede
// desempatar adentro; en las demás la familia es la palabra final.
export const FAMILIAS_CATALOGO = [
  { slug: 'tuberia_accesorios', label: 'Tubería y accesorios',          tipo: 'material',    categoria: 'materiales' },
  { slug: 'ferreteria',         label: 'Material de ferretería',        tipo: 'material',    categoria: 'materiales' },
  { slug: 'valvulas',           label: 'Válvulas',                      tipo: 'material',    categoria: 'materiales' },
  { slug: 'seguridad',          label: 'Implementos de seguridad',      tipo: 'epp',         categoria: 'epp' },
  { slug: 'agregados',          label: 'Agregados',                     tipo: 'material',    categoria: 'materiales' },
  { slug: 'madera',             label: 'Madera',                        tipo: 'material',    categoria: 'materiales' },
  { slug: 'equipos_herramientas', label: 'Equipos y herramientas',      tipo: 'herramienta', categoria: 'herramientas', refina: ['herramienta', 'maquinaria'] },
  { slug: 'administrativos',    label: 'Insumos administrativos',       tipo: 'material',    categoria: 'gastos_generales' },
  { slug: 'perfiles_metalicos', label: 'Perfiles y estructuras metálicas', tipo: 'material', categoria: 'materiales' },
  { slug: 'otros',              label: 'Otros',                         tipo: 'material',    categoria: 'otros', refina: ['material', 'herramienta', 'epp', 'maquinaria', 'servicio'] },
  { slug: 'servicios',          label: 'Servicios',                     tipo: 'servicio',    categoria: 'gastos_generales' },
];

export const FAMILIA_POR_SLUG = new Map(FAMILIAS_CATALOGO.map(f => [f.slug, f]));

/** Texto de familia → clave de búsqueda (sin tildes, sin puntuación). */
const claveFamilia = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Los encabezados tal como los escribió Gabriel, más las variantes razonables.
// «adminitrativos» está mal escrito EN EL ARCHIVO y así hay que aceptarlo: no
// se le corrige el xlsx a nadie para que una importación funcione.
const ALIAS_FAMILIA = new Map(Object.entries({
  'tuberia y accesorios': 'tuberia_accesorios',
  'tuberias y accesorios': 'tuberia_accesorios',
  'tuberia': 'tuberia_accesorios',
  'material de ferreteria': 'ferreteria',
  'materiales de ferreteria': 'ferreteria',
  'ferreteria': 'ferreteria',
  'valvulas': 'valvulas',
  'implementos de seguridad': 'seguridad',
  'equipos de proteccion personal': 'seguridad',
  'epp': 'seguridad',
  'seguridad': 'seguridad',
  'agregados': 'agregados',
  'madera': 'madera',
  'maderas': 'madera',
  'equipos y herramientas': 'equipos_herramientas',
  'equipos herramientas': 'equipos_herramientas',
  'herramientas': 'equipos_herramientas',
  'equipos': 'equipos_herramientas',
  'insumos adminitrativos': 'administrativos',
  'insumos administrativos': 'administrativos',
  'administrativos': 'administrativos',
  'perfiles y estructuras metalicas': 'perfiles_metalicos',
  'estructuras metalicas': 'perfiles_metalicos',
  'perfiles': 'perfiles_metalicos',
  'otros': 'otros',
  'servicios': 'servicios',
}));

/**
 * Slug de una familia escrita en el archivo. Devuelve `null` si no la conoce
 * —el que llama decide qué hacer con eso; acá NO se inventa una familia en
 * silencio, porque una familia mal puesta se propaga a la tabla de inventario.
 */
export function slugFamilia(texto) {
  const k = claveFamilia(texto);
  if (!k) return null;
  return ALIAS_FAMILIA.get(k) || null;
}

export const etiquetaFamilia = (slug) => FAMILIA_POR_SLUG.get(slug)?.label || slug || '—';

// ── 2. UNIDADES ────────────────────────────────────────────────────
// El archivo mezcla mayúsculas y minúsculas para la misma cosa (`und` y `UND`,
// `MES` y `mes`) y usa abreviaturas con punto (`VAR.`). Sin normalizar, la
// misma unidad se contaría como dos y el diff de la re-importación marcaría
// cambios que no existen.
const UNIDAD_ALIAS = new Map(Object.entries({
  und: 'und', unid: 'und', unidad: 'und', u: 'und', pza: 'und', pieza: 'und', pzas: 'und',
  var: 'var', varilla: 'var', varillas: 'var',
  gln: 'gal', gal: 'gal', galon: 'gal',
  mill: 'mill', millar: 'mill',
  cto: 'cto', ciento: 'cto',
  bid: 'bid', bidon: 'bid',
  bls: 'bolsa', bolsa: 'bolsa', bol: 'bolsa',
  dia: 'dia', dias: 'dia',
  mes: 'mes', meses: 'mes',
  hm: 'hm', hh: 'hh', glb: 'glb', set: 'set', par: 'par', juego: 'juego',
  caja: 'caja', rollo: 'rollo', cart: 'cart', pega: 'pega',
  kg: 'kg', m: 'm', m2: 'm2', m3: 'm3', p2: 'p2', ml: 'm',
}));

/** Unidad normalizada del catálogo ('' si no hay). */
export function normUnidad(u) {
  const base = String(u || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[.\s]+/g, '').trim();
  if (!base) return '';
  return UNIDAD_ALIAS.get(base) || base;
}

// ── 3. EL PUENTE A LOS OTROS DOS VOCABULARIOS ──────────────────────

/**
 * A qué TABLA de inventario va una entrada del catálogo — el vocabulario de
 * `insumo-clasificador.js`. La familia da la compuerta; adentro de las
 * familias que admiten más de una respuesta, decide la regla que ya existe
 * (y la unidad `hm`, que es lo que separa una retroexcavadora de un martillo).
 */
export function tipoInsumoDe(entrada) {
  const fam = FAMILIA_POR_SLUG.get(entrada?.familia);
  if (!fam) return clasificarInsumo(entrada?.nombre || '');
  if (!fam.refina) return fam.tipo;
  // `hm` (hora-máquina) solo la factura un equipo que se alquila operado.
  if (normUnidad(entrada?.unidad) === 'hm') return 'maquinaria';
  const propuesto = clasificarInsumo(entrada?.nombre || '');
  return fam.refina.includes(propuesto) ? propuesto : fam.tipo;
}

/**
 * En qué categoría de gasto cae — el vocabulario de `clasificar-items.js`, que
 * es el que ve la contadora. Se deriva del tipo cuando la familia refina, para
 * que las dos respuestas no se contradigan entre sí.
 */
export function categoriaItemDe(entrada) {
  const fam = FAMILIA_POR_SLUG.get(entrada?.familia);
  if (!fam) return 'otros';
  if (!fam.refina) return fam.categoria;
  const tipo = tipoInsumoDe(entrada);
  return ({
    material: 'materiales', herramienta: 'herramientas', epp: 'epp',
    maquinaria: 'maquinaria', servicio: 'gastos_generales',
  })[tipo] || fam.categoria;
}

// ── 4. LECTURA DEL XLSX ────────────────────────────────────────────

/** Las filas de una hoja como matriz [col0, col1], con el encabezado incluido.
 *  `parseExcelFile` se come la primera fila como encabezado; en la hoja
 *  DISGREGADOS esa primera fila ES DATO (el título del bloque), así que hay que
 *  devolvérsela. `__EMPTY*` son las columnas sin nombre que inventa SheetJS. */
export function filasDeHoja(hoja) {
  const headers = (hoja?.headers || []).map(h => (/^__EMPTY/.test(String(h)) ? '' : String(h)));
  const filas = headers.some(h => h !== '') ? [headers] : [];
  for (const r of hoja?.rows || []) {
    const vals = headers.length
      ? (hoja.headers || []).map(h => r?.[h])
      : Object.values(r || {});
    filas.push(vals.map(v => (v == null ? '' : String(v))));
  }
  return filas;
}

/** Limpia un nombre del archivo: sin saltos de línea (los hay: varios
 *  servicios terminan en `\r\n`) ni espacios dobles. */
export const limpiarNombre = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const MARCA_DISGREGA = /^se disgrega en$/;

/**
 * Lee la hoja de insumos o servicios.
 *
 * En INSUMOS la familia NO está en una columna: es una fila SIN UNIDAD que
 * encabeza el bloque (así lo escribió Gabriel, y así se lee). En SERVICIOS no
 * hay bloques: todas las filas son de la familia `servicios`.
 */
function leerHojaInsumos(filas, { familiaFija = null, tipo = 'insumo' } = {}) {
  const out = [];
  const avisos = [];
  let familia = familiaFija;
  let saltarEncabezado = true;
  for (const fila of filas) {
    const nombre = limpiarNombre(fila?.[0]);
    const unidad = normUnidad(fila?.[1]);
    if (!nombre) continue;
    // La primera fila es el encabezado de la hoja («Insumo» / «Unidad»): no es
    // ni familia ni insumo. Ojo que SÍ trae unidad —la palabra «Unidad», que
    // normUnidad() traduce a `und`—, así que no alcanza con mirar si está vacía.
    if (saltarEncabezado) {
      saltarEncabezado = false;
      if (/^(insumo|servicio|item|descripcion)s?$/i.test(nombre)) continue;
    }
    if (!unidad) {
      if (familiaFija) { avisos.push(`«${nombre}» no tiene unidad y se ignoró.`); continue; }
      const slug = slugFamilia(nombre);
      if (!slug) {
        avisos.push(`No conozco la familia «${nombre}»: sus insumos quedaron en «Otros».`);
        familia = 'otros';
      } else familia = slug;
      continue;
    }
    if (!familia) { avisos.push(`«${nombre}» aparece antes de cualquier familia y quedó en «Otros».`); familia = 'otros'; }
    out.push({ tipo, nombre, unidad, familia, norm: normMapeo(nombre), origen: 'xlsx' });
  }
  return { filas: out, avisos };
}

/**
 * Lee la hoja de disgregación: bloques «título / padre / se disgrega en /
 * hijos». El FACTOR no está en el archivo —Gabriel escribió la equivalencia,
 * no los kilos— así que sale del mismo motor que ya convierte unidades en
 * `mapeo-insumos.js`, CON SU PROCEDENCIA: `descripcion` cuando el largo lo dice
 * el propio nombre («x9m»), `supuesto` cuando se asume el largo comercial, y
 * `null` cuando no hay forma de saberlo. Un factor que no se sabe se deja
 * vacío para que lo complete la contadora; nunca se inventa.
 */
function leerHojaDisgregados(filas) {
  const out = [];
  const avisos = [];
  let padre = null;
  let enHijos = false;
  for (const fila of filas) {
    const nombre = limpiarNombre(fila?.[0]);
    const unidad = normUnidad(fila?.[1]);
    if (!nombre) continue;
    if (MARCA_DISGREGA.test(claveFamilia(nombre))) {
      if (!padre) avisos.push('Hay un «se disgrega en» sin un insumo arriba: se ignoró.');
      enHijos = true;
      continue;
    }
    if (!unidad) { padre = null; enHijos = false; continue; }   // título de bloque
    if (!enHijos) { padre = { nombre, unidad }; continue; }
    if (!padre) { avisos.push(`«${nombre}» no tiene de qué disgregarse: se ignoró.`); continue; }
    const { factor, fuente, nota } = factorDisgregacion(padre, { nombre, unidad });
    out.push({
      padre_nombre: padre.nombre, padre_unidad: padre.unidad, padre_norm: normMapeo(padre.nombre),
      hijo_nombre: nombre, hijo_unidad: unidad, hijo_norm: normMapeo(nombre),
      factor, factor_fuente: fuente, nota,
    });
  }
  return { filas: out, avisos };
}

/**
 * Cuántas unidades del PADRE trae UNA del hijo (una varilla de 1/2" × 9 m son
 * 8,946 kg de acero). Se delega en `proponerFactor()` para no tener dos tablas
 * de kilos por metro en el repo — la lección del calibre de 1/2" (12,7 mm y no
 * 12) ya se pagó una vez.
 */
export function factorDisgregacion(padre, hijo) {
  const linea = prepararLinea({ descripcion: hijo.nombre, unidad: hijo.unidad });
  const cat = prepararLinea({ descripcion: padre.nombre, unidad: padre.unidad });
  const r = proponerFactor(linea, cat);
  return {
    factor: r.factor == null ? null : Number(r.factor),
    fuente: r.factor == null ? null : r.fuente,
    nota: r.nota || null,
  };
}

/**
 * El archivo entero → lo que se va a guardar.
 * @param {Array<{name, headers, rows}>} hojas — lo que devuelve parseExcelFile.
 * @returns {{ insumos, disgregacion, avisos, hojasLeidas, hojasIgnoradas }}
 */
export function parseCatalogoXlsx(hojas) {
  const insumos = [];
  const disgregacion = [];
  const avisos = [];
  const hojasLeidas = [];
  const hojasIgnoradas = [];
  for (const hoja of hojas || []) {
    const clave = claveFamilia(hoja?.name);
    const filas = filasDeHoja(hoja);
    if (/^insumos?$/.test(clave)) {
      const r = leerHojaInsumos(filas);
      insumos.push(...r.filas); avisos.push(...r.avisos); hojasLeidas.push(hoja.name);
    } else if (/^servicios?$/.test(clave)) {
      const r = leerHojaInsumos(filas, { familiaFija: 'servicios', tipo: 'servicio' });
      insumos.push(...r.filas); avisos.push(...r.avisos); hojasLeidas.push(hoja.name);
    } else if (/^disgregad/.test(clave)) {
      const r = leerHojaDisgregados(filas);
      disgregacion.push(...r.filas); avisos.push(...r.avisos); hojasLeidas.push(hoja.name);
    } else if (hoja?.name) hojasIgnoradas.push(hoja.name);
  }
  // Dos filas con el mismo nombre normalizado en el mismo archivo: se queda la
  // primera y se avisa. Guardar las dos rompería la clave lógica del catálogo.
  const vistos = new Set();
  const unicos = [];
  for (const i of insumos) {
    if (vistos.has(i.norm)) { avisos.push(`«${i.nombre}» está repetido en el archivo: se guardó una sola vez.`); continue; }
    vistos.add(i.norm); unicos.push(i);
  }
  if (!hojasLeidas.length) avisos.push('El archivo no tiene ninguna hoja llamada INSUMOS, SERVICIOS o DISGREGADOS.');
  return { insumos: unicos, disgregacion, avisos, hojasLeidas, hojasIgnoradas };
}

// ── 5. RESOLUCIÓN Y DIFF ───────────────────────────────────────────

/**
 * Una fila por `norm`. Como en `insumo_mapeo`, la tabla NO tiene UNIQUE sobre
 * la clave lógica —Gabriel alterna dos PCs y la app es offline-first—, así que
 * el duplicado benigno se resuelve al LEER: gana `origen: 'manual'` sobre
 * `'xlsx'` (alguien lo corrigió a mano después de importar) y, a igual origen,
 * la fila más reciente.
 */
export function resolverCatalogo(rows) {
  const porNorm = new Map();
  const rank = (r) => (r?.origen === 'manual' ? 2 : 1);
  for (const r of rows || []) {
    if (!r || r.deleted_at || !r.norm) continue;
    const prev = porNorm.get(r.norm);
    if (!prev) { porNorm.set(r.norm, r); continue; }
    const mejor = rank(r) !== rank(prev)
      ? (rank(r) > rank(prev) ? r : prev)
      : (String(r.updated_at || '') >= String(prev.updated_at || '') ? r : prev);
    porNorm.set(r.norm, mejor);
  }
  return [...porNorm.values()];
}

const CAMPOS_COMPARADOS = ['nombre', 'unidad', 'familia', 'tipo'];

/**
 * Qué cambiaría una importación. Se calcula ANTES de escribir nada: la pantalla
 * lo muestra y recién entonces Gabriel aplica. Importar a ciegas un archivo que
 * se editó mal es de las pocas cosas que pueden ensuciar el catálogo entero.
 *
 * - `altas`      — no existían.
 * - `cambios`    — existen y el archivo dice algo distinto (con el detalle).
 * - `iguales`    — no hay nada que hacer (se cuentan, no se listan).
 * - `reactivar`  — están desactivados y el archivo los volvió a traer.
 * - `ausentes`   — vinieron del xlsx alguna vez y este archivo ya no los trae:
 *                  se proponen para DESACTIVAR, nunca para borrar.
 * Lo cargado a mano (`origen: 'manual'`) queda intacto y ni siquiera se cuenta
 * como ausente: el archivo no manda sobre lo que una persona escribió después.
 */
export function diffCatalogo(actuales, importados) {
  const vivos = resolverCatalogo(actuales);
  const porNorm = new Map(vivos.map(r => [r.norm, r]));
  const altas = [], cambios = [], reactivar = [];
  let iguales = 0;
  const normsDelArchivo = new Set();
  for (const imp of importados || []) {
    normsDelArchivo.add(imp.norm);
    const act = porNorm.get(imp.norm);
    if (!act) { altas.push(imp); continue; }
    const difs = CAMPOS_COMPARADOS
      .filter(c => String(act[c] ?? '') !== String(imp[c] ?? ''))
      .map(c => ({ campo: c, antes: act[c] ?? '', ahora: imp[c] ?? '' }));
    if (act.activo === false) reactivar.push({ ...imp, id: act.id, difs });
    else if (difs.length) cambios.push({ ...imp, id: act.id, difs });
    else iguales++;
  }
  const ausentes = vivos.filter(r =>
    r.origen !== 'manual' && r.activo !== false && !normsDelArchivo.has(r.norm));
  return { altas, cambios, reactivar, ausentes, iguales };
}

/** Un resumen en una línea, para el cartel de confirmación. */
export function resumenDiff(diff) {
  const n = (a) => (a || []).length;
  return {
    altas: n(diff?.altas), cambios: n(diff?.cambios), reactivar: n(diff?.reactivar),
    ausentes: n(diff?.ausentes), iguales: diff?.iguales || 0,
    hayCambios: n(diff?.altas) + n(diff?.cambios) + n(diff?.reactivar) + n(diff?.ausentes) > 0,
  };
}

// ── 6. BÚSQUEDA (lo que hace que el catálogo se note al escribir) ───

/** Índice liviano para proponer. Se arma una vez y se reusa. */
export function indexarCatalogo(rows) {
  return resolverCatalogo(rows)
    .filter(r => r.activo !== false)
    .map(r => ({ ...r, toks: normMapeo(r.nombre).split(' ').filter(Boolean) }));
}

/**
 * Propuestas para un texto que alguien está escribiendo. Nada bloquea: son
 * sugerencias, y escribir un nombre que no está en el catálogo sigue siendo
 * válido (la obra compra cosas que ningún archivo previó).
 *
 * Puntaje simple y explicable, a propósito: todos los tokens escritos tienen
 * que aparecer (por prefijo, para que «tub» pegue con «tuberia»), y arriba
 * quedan los nombres más cortos —que son los genéricos— y los que empiezan
 * igual que lo escrito. El motor pesado de `mapeo-insumos.js` es para cruzar
 * facturas contra el presupuesto; acá alcanza con esto.
 */
export function buscarCatalogo(indice, texto, { limite = 8, tipo = null, familia = null } = {}) {
  const q = normMapeo(texto).split(' ').filter(Boolean);
  if (!q.length) return [];
  const out = [];
  for (const r of indice || []) {
    if (tipo && r.tipo !== tipo) continue;
    if (familia && r.familia !== familia) continue;
    let ok = true, exactos = 0;
    for (const t of q) {
      const hit = r.toks.some(x => x === t || x.startsWith(t));
      if (!hit) { ok = false; break; }
      if (r.toks.includes(t)) exactos++;
    }
    if (!ok) continue;
    const empieza = r.toks[0]?.startsWith(q[0]) ? 1 : 0;
    out.push({ ...r, score: exactos + empieza + 1 / (1 + r.toks.length) });
  }
  out.sort((a, b) => b.score - a.score || a.nombre.localeCompare(b.nombre, 'es'));
  return out.slice(0, limite);
}

/** Conteo por familia, para las fichas de la pantalla. */
export function contarPorFamilia(rows) {
  const vivos = resolverCatalogo(rows).filter(r => r.activo !== false);
  const m = new Map();
  for (const r of vivos) m.set(r.familia, (m.get(r.familia) || 0) + 1);
  return FAMILIAS_CATALOGO
    .map(f => ({ ...f, n: m.get(f.slug) || 0 }))
    .filter(f => f.n > 0);
}
