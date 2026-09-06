// ═══════════════════════════════════════════════════════════════════
// JARVEX — LOS DOS LIBROS DE UNA OBRA (tanda 4, A1).
//
// EL PEDIDO (Gabriel, 4-sep-2026): «la contabilidad de una obra me muestra
// movimientos de varias empresas, cuando debería mostrar los del consorcio
// ejecutor».
//
// Tenía razón en el diagnóstico y no en el remedio. Medido contra producción:
// en Plan Miraflores hay 460 comprobantes imputados a la obra y el titular
// contable (CONSORCIO EL INCA) tiene 112 — el 24%. Fijar la pantalla al
// titular habría escondido 339 filas y con ellas los S/ 3.05 M que el grupo
// puso en la obra. Por eso la tanda 2B no lo hizo.
//
// Lo que faltaba no era filtrar: era NOMBRAR. En esa pantalla hay dos cosas
// distintas apiladas sin etiqueta, y ninguna de las dos sobra:
//
//   • EL LIBRO DEL CONSORCIO — lo que entra en SU contabilidad: sus propios
//     comprobantes (112) más los que el grupo le EMITIÓ a él (9). Total 121.
//   • EL APORTE DE LAS EMPRESAS DEL GRUPO — las compras que JARVEX, GASOMI,
//     JHEENSEG y JADE hicieron a proveedores de AFUERA y le imputaron a la
//     obra: 339 comprobantes, S/ 3.05 M. Son plata de la obra, pero de otro
//     libro.
//
// ── LOS DOS TOTALES NO SE SUMAN ───────────────────────────────────
// Es la misma regla que ya aplica el Resumen por entidad: son dos preguntas
// distintas sobre el mismo dinero, no dos mitades de una torta. Sumar el libro
// del consorcio con el aporte del grupo contaría dos veces cada factura que el
// grupo terminó trasladándole a la ejecutora. La pantalla lo dice con todas
// las letras; esta librería no expone ningún "total general" que invite a
// sumarlos.
//
// ── LA REGLA, Y POR QUÉ ES ESTA ───────────────────────────────────
// Un comprobante de la obra cae en el libro del consorcio si:
//   (a) está cargado EN su libro (`company_id === titular`), o
//   (b) el titular es la CONTRAPARTE identificada del comprobante — por
//       `related_company_id`, o por RUC de 11 dígitos contra `companies`.
// Todo lo demás es aporte del grupo.
//
// (b) NO exige `vinculoAfirmado` (a diferencia de documento-dos-lados.js) a
// propósito: allá el reflejo afirma algo sobre la contabilidad de OTRA
// empresa y por eso pide una afirmación explícita; acá solo se decide en qué
// COLUMNA de la misma obra va una fila que ya está a la vista. Un RUC que
// coincide con el titular alcanza para decir "esto va dirigido al consorcio".
//
// Verificado contra producción el 4-sep-2026, sin tocar la base:
//   Miraflores  → 112 propios + 9 recibidos = 121 libro · 339 aporte (460)
//   San Marcos  →  64 libro · 25 aporte (89)
//
// ── OBRAS DE UNA SOLA EMPRESA ─────────────────────────────────────
// No hace falta lógica aparte: `titularContableDeObra()` devuelve la ejecutora
// y el "libro del consorcio" pasa a ser el libro de esa empresa. La pantalla
// usa el nombre real del titular en la etiqueta, así que se lee bien igual.
//
// Puro: sin React, sin Dexie.
// ═══════════════════════════════════════════════════════════════════

import { indiceEmpresas, rucLimpio } from './documento-dos-lados.js';

/** Los dos libros, como valores estables para el estado de la pantalla. */
export const LIBRO_CONSORCIO = 'consorcio';
export const LIBRO_GRUPO = 'grupo';
export const LIBRO_TODOS = 'todos';

const vivos = (arr) => (Array.isArray(arr) ? arr.filter(x => x && !x.deleted_at) : []);

/**
 * La otra entidad del catálogo que nombra este comprobante, si está
 * identificada. Mismo orden de precedencia que `ladosDeDocumento`:
 * el vínculo explícito manda sobre el RUC.
 */
export function contraparteCatalogo(mov, indice) {
  const idx = indice || { porId: new Map(), porRuc: new Map() };
  const titular = mov?.company_id || null;
  const rel = mov?.related_company_id;
  if (rel && rel !== titular && idx.porId.has(rel)) return rel;
  const ruc = rucLimpio(mov?.third_party_ruc);
  const c = ruc ? idx.porRuc.get(ruc) : null;
  return (c && c.id !== titular) ? c.id : null;
}

/**
 * ¿En cuál de los dos libros de la obra cae este comprobante?
 * Sin titular contable no hay dos libros: todo es del grupo.
 */
export function libroDeMovimiento(mov, titularId, indice) {
  if (!mov || !titularId) return LIBRO_GRUPO;
  if (mov.company_id === titularId) return LIBRO_CONSORCIO;
  return contraparteCatalogo(mov, indice) === titularId ? LIBRO_CONSORCIO : LIBRO_GRUPO;
}

/** Suma por moneda, separando ventas de compras. Los anulados no cuentan. */
function acumular(acc, mov) {
  if (mov.payment_status === 'cancelled') { acc.anulados++; return; }
  const cl = (mov.clase || (mov.type === 'income' ? 'venta' : 'compra')) === 'venta' ? 'venta' : 'compra';
  const cur = mov.currency || 'PEN';
  acc[cl][cur] = (acc[cl][cur] || 0) + (Number(mov.amount) || 0);
}

const libroVacio = () => ({ ids: new Set(), n: 0, anulados: 0, venta: {}, compra: {} });

/**
 * Parte los comprobantes de UNA obra en sus dos libros.
 *
 * @param movs       los comprobantes YA acotados al ámbito de la obra (la
 *                   pantalla decide si incluye lo del titular sin imputar).
 * @param titularId  titular contable de la obra (`titularContableDeObra`).
 * @param companies  catálogo, para resolver contrapartes por id y por RUC.
 *
 * @returns {{ titularId, hayDosLibros, total, consorcio, grupo }}
 *   consorcio.propios   — los que están cargados en el libro del titular
 *   consorcio.recibidos — los que el grupo le emitió A ÉL
 *   Cada libro trae `ids` (Set, para filtrar la grilla en O(1)), `n`,
 *   `anulados` y los montos por moneda de venta/compra.
 *   NO hay total sumado de los dos: no se suman.
 */
// ── EL FILTRO DE EMPRESA DEPENDE DEL LIBRO ────────────────────────
// EL PEDIDO (Gabriel, 5-sep-2026): «si yo tengo seleccionado solo el libro de
// consorcio, debe estar bloqueado esta parte, porque aquí nada más voy a ver
// todos los movimientos contables de ese consorcio».
//
// Tiene razón, y la razón es más fuerte que la que él dio: el libro del
// consorcio YA ES un filtro por empresa —el más fino de los dos, porque
// incluye lo suyo Y lo que el grupo le emitió a él—. Dejar encima el selector
// de empresa producía combinaciones que se leen mal: "libro del consorcio +
// empresa GASOMI" mostraba 9 filas y parecía que el consorcio tuviera un libro
// de 9 comprobantes. Dos filtros que responden la misma pregunta, uno tapando
// al otro.
//
// La regla por pestaña:
//   📕 Libro del titular  → filtro BLOQUEADO. El libro es el filtro.
//   📗 Aporte del grupo   → filtro acotado a las empresas que aportaron
//                           (el titular no está: sus comprobantes están en el
//                           otro libro por definición).
//   📚 Los dos juntos     → libre, como siempre.
export function filtroEmpresaSegunLibro({ libro, movs = [], titularId = null, companies = [] } = {}) {
  if (!titularId || libro === LIBRO_TODOS) {
    return { bloqueado: false, empresasPermitidas: null, motivo: '' };
  }
  if (libro === LIBRO_CONSORCIO) {
    return {
      bloqueado: true,
      empresasPermitidas: null,
      motivo: 'El libro del titular ya es el filtro: incluye sus propios comprobantes y los que el grupo le emitió. Cambiá a "Los dos juntos" para filtrar por empresa.',
    };
  }
  // LIBRO_GRUPO: solo las empresas que realmente aportaron en esta obra.
  const idx = indiceEmpresas(companies);
  const permitidas = new Set();
  for (const m of vivos(movs)) {
    if (libroDeMovimiento(m, titularId, idx) !== LIBRO_GRUPO) continue;
    if (m.company_id) permitidas.add(m.company_id);
  }
  permitidas.delete(titularId);
  return {
    bloqueado: false,
    empresasPermitidas: permitidas,
    motivo: 'Solo las empresas del grupo que compraron para esta obra. El titular no está: lo suyo vive en su propio libro.',
  };
}

export function librosDeObra({ movs = [], titularId = null, companies = [] } = {}) {
  const idx = indiceEmpresas(companies);
  const filas = vivos(movs);
  const consorcio = { ...libroVacio(), propios: 0, recibidos: 0 };
  const grupo = libroVacio();

  for (const m of filas) {
    if (libroDeMovimiento(m, titularId, idx) === LIBRO_CONSORCIO) {
      consorcio.ids.add(m.id);
      consorcio.n++;
      if (m.company_id === titularId) consorcio.propios++; else consorcio.recibidos++;
      acumular(consorcio, m);
    } else {
      grupo.ids.add(m.id);
      grupo.n++;
      acumular(grupo, m);
    }
  }

  return {
    titularId,
    // Sin titular la partición no significa nada: la pantalla no muestra las
    // pestañas y se comporta como antes de esta tanda.
    hayDosLibros: !!titularId,
    total: filas.length,
    consorcio,
    grupo,
  };
}
