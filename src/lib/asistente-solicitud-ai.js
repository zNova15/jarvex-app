// ═══════════════════════════════════════════════════════════════════
// JARVEX — Asistente de Solicitud de Insumos (lado cliente).
//
// Wrapper del endpoint /api/asistente-solicitud + la parte PURA y testeable:
// armar el catálogo que se le manda a la IA y volcar lo que devuelve sobre
// las filas del formulario.
//
// La regla que gobierna el volcado: la IA PROPONE, la pantalla NO decide sola.
// Todo lo que vuelve queda editable y nada se envía sin que una persona lo
// mire. El endpoint ya tira los ids inventados (ver `sanearResultado` allá);
// acá se completa lo que falte con el match local de `insumos-catalogo.js`,
// que es gratis y no se equivoca con los nombres que ya existen.
// ═══════════════════════════════════════════════════════════════════

import { apiFetch, apiParse } from './api-client.js';
import { TIPOS_INSUMO, TIPO_INSUMO_KEYS, normNombre } from './insumos-catalogo.js';

const ENDPOINT = '/api/asistente-solicitud';
const TIMEOUT_MS = 50_000;

/**
 * Aplana los cinco inventarios en la lista plana que entiende el prompt.
 * PURA: recibe ya leídas las filas de cada tipo.
 *
 * @param {Object} porTipo  { material: [...], epp: [...], ... } con filas
 *                          `{id, nombre, unidad, stock_actual}` (las que
 *                          devuelve `leerInventarioReal`).
 * @param {number} [tope]   techo de ítems; el endpoint recorta a 400 igual.
 */
export function armarCatalogo(porTipo = {}, tope = 400) {
  const out = [];
  for (const tipo of TIPO_INSUMO_KEYS) {
    for (const row of (porTipo[tipo] || [])) {
      if (!row || !row.id) continue;
      const nombre = String(row.nombre || '').trim();
      if (!nombre) continue;
      out.push({
        id: row.id,
        tipo,
        nombre,
        unidad: row.unidad || '',
        stock_actual: row.stock_actual != null ? Number(row.stock_actual) : null,
      });
      if (out.length >= tope) return out;
    }
  }
  return out;
}

/** Lista de personal para que la IA reconozca al responsable. PURA. */
export function armarPersonal(personal = [], tope = 150) {
  return (personal || [])
    .filter(p => p && !p.deleted_at && p.id)
    .map(p => ({
      id: p.id,
      nombre: `${p.nombres || ''} ${p.apellidos || ''}`.trim(),
      cargo: p.cargo || '',
    }))
    .filter(p => p.nombre)
    .slice(0, tope);
}

/**
 * Convierte el resultado de la IA en filas del formulario.
 *
 * PURA y testeable. `nuevoItem` es la fábrica de filas de la pantalla (trae
 * el id local); se inyecta para no importar React acá.
 *
 * Red de seguridad local: si la IA no vinculó un ítem pero el nombre coincide
 * EXACTO (normalizado) con algo del catálogo del mismo tipo, se vincula igual.
 * Es match por igualdad, no difuso: un "casi igual" que se equivoca manda a
 * comprar otra cosa, y eso lo decide una persona.
 */
export function volcarEnItems(result, { catalogo = [], nuevoItem } = {}) {
  const porClave = new Map();
  for (const m of catalogo) porClave.set(`${m.tipo}|${normNombre(m.nombre)}`, m);
  const porId = new Map(catalogo.map(m => [String(m.id), m]));

  const filas = (result?.items || []).map(it => {
    const base = nuevoItem();
    const tipo = TIPOS_INSUMO[it.tipo] ? it.tipo : 'material';
    let insumoId = it.insumo_id || '';
    let unidad = it.unidad || '';

    if (insumoId && porId.has(String(insumoId))) {
      const m = porId.get(String(insumoId));
      if (!unidad) unidad = m.unidad || '';
    } else {
      insumoId = '';
      const exacto = porClave.get(`${tipo}|${normNombre(it.nombre)}`);
      if (exacto) {
        insumoId = exacto.id;
        if (!unidad) unidad = exacto.unidad || '';
      }
    }

    return {
      ...base,
      tipo,
      insumo_id: insumoId,
      nombre: String(it.nombre || '').trim(),
      unidad,
      cantidad: it.cantidad != null ? String(it.cantidad) : '',
      cantidad_minima: it.cantidad_minima != null ? String(it.cantidad_minima) : '',
      notas: it.notas || '',
    };
  }).filter(f => f.nombre);

  return filas.length ? filas : [nuevoItem()];
}

/**
 * La razón que se escribe en el formulario.
 *
 * El texto de obra separa «Razón» de «Frente donde se necesita», pero el
 * formulario tiene un solo campo de razón (el frente no es una columna de
 * `requisiciones`). Se juntan en vez de tirar el frente: para la técnica que
 * decide si procede, EN QUÉ FRENTE es la mitad del criterio.
 */
export function armarRazon(result) {
  const razon = String(result?.razon || '').trim();
  const frente = String(result?.frente || '').trim();
  if (razon && frente) return `${razon}\nFrente: ${frente}`;
  return razon || (frente ? `Frente: ${frente}` : '');
}

/**
 * Llama al endpoint. Lanza Error con mensaje legible; el caller decide.
 */
export async function interpretarTexto({ texto, catalogo = [], personal = [], fechaActual = null, nombreObra = '' } = {}) {
  const t = String(texto || '').trim();
  if (!t) throw new Error('Pegá el texto del requerimiento.');
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
    throw new Error('Sin conexión — el asistente necesita internet. Cargá la solicitud a mano.');
  }

  let resp;
  try {
    resp = await apiFetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto: t, catalogo, personal, fecha_actual: fechaActual, nombre_obra: nombreObra }),
      timeout: TIMEOUT_MS,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('El asistente tardó demasiado. Probá con un texto más corto.');
    throw new Error('No se pudo conectar con el asistente.');
  }

  const data = await apiParse(resp);
  if (!resp.ok || data?.error) throw new Error(data?.error || `El asistente respondió ${resp.status}`);
  if (!data?.result) throw new Error('El asistente no devolvió un resultado legible.');
  return data;
}
