// ═══════════════════════════════════════════════════════════════════
// JARVEX — DÓNDE VIVE LA ELECCIÓN DE MODELOS, DEL LADO DEL NAVEGADOR
// (tanda 19, 9-set-2026).
//
// La lista blanca y los precios están en `lib/modelos-ia.js` (compartido con
// los endpoints). Acá vive lo otro: EN QUÉ FILA DE `app_config` se guarda cada
// elección y cómo se lee.
//
// POR QUÉ EN `app_config` Y NO EN localStorage. Es una decisión de la empresa,
// no una preferencia de una laptop: si el admin pone OCR 4.1 para licitaciones,
// tiene que regir también cuando lea las bases desde la otra PC, y tiene que
// verse igual para el resto del equipo de propuestas. `app_config` ya viaja por
// el SyncEngine y ya es el lugar de `sesion_timeout_min` y
// `orden_umbral_monto` — mismo patrón, mismos hábitos.
//
// QUIÉN PUEDE CAMBIARLO: solo admin, desde Administración → Modelos de IA.
// Ésa es la única pantalla que escribe estas claves. Los demás roles las LEEN
// (el modal de bases muestra con qué va a leer antes de gastar), y el servidor
// además valida contra la lista blanca: aunque alguien forzara un pedido a
// mano, solo entran modelos aprobados.
// ═══════════════════════════════════════════════════════════════════

/** Las cuatro claves. Dos ámbitos × (OCR, texto). */
export const CLAVES = {
  licitaciones: { ocr: 'ia_licitaciones_ocr', texto: 'ia_licitaciones_texto' },
  captura: { ocr: 'ia_captura_ocr', texto: 'ia_captura_texto' },
};

/**
 * Lo elegido para un ámbito, o `null` en cada campo si nadie eligió nada —
 * y `null` significa «que decida el servidor», que aplica el default del
 * ámbito. Se devuelve null en vez del default para que la pantalla pueda
 * decir «(el de siempre)» en vez de fingir una decisión que nadie tomó.
 *
 * @param filas  lo que devuelve el hook useAppConfig
 */
export function modelosDe(filas, ambito) {
  const k = CLAVES[ambito];
  if (!k) return { ocr: null, texto: null };
  const leer = window.__hooks?.resolverConfig
    ? (clave) => window.__hooks.resolverConfig(filas, clave, null)
    : () => null;
  const limpiar = (v) => {
    const s = v == null ? '' : String(v).trim();
    return s || null;
  };
  return { ocr: limpiar(leer(k.ocr)), texto: limpiar(leer(k.texto)) };
}

/**
 * Los campos que van en el cuerpo de un pedido a `/api/*`.
 *
 * Devuelve un objeto VACÍO cuando no hay nada elegido, para que el pedido salga
 * exactamente igual que antes de que esto existiera. Es la diferencia entre
 * «no cambia nada hasta que alguien lo cambie» y «ahora todo pasa por código
 * nuevo».
 */
export function cuerpoDeModelos(filas, ambito) {
  const { ocr, texto } = modelosDe(filas, ambito);
  return {
    ...(ocr ? { modelo_ocr: ocr } : {}),
    ...(texto ? { modelo_texto: texto } : {}),
  };
}

// ── El catálogo, que lo sirve el servidor ─────────────────────────
//
// POR QUÉ NO SE IMPORTA `lib/modelos-ia.js` DIRECTO. Ese archivo vive del lado
// de los endpoints (junto a api-helpers y openrouter) y el repo mantiene esa
// frontera a propósito. Traerlo por HTTP tiene además una ventaja que la
// importación no da: el servidor le pega los precios QUE OPENROUTER COBRA HOY,
// filtrados por la misma política ZDR con la que la app llama de verdad. Un
// precio escrito en el código es real el día que se escribe.
//
// Se guarda en memoria del módulo: abrir la pantalla diez veces no son diez
// llamadas.
let _catalogo = null;
let _catalogoEn = 0;
const CATALOGO_TTL_MS = 10 * 60 * 1000;

export function _limpiarCatalogo() { _catalogo = null; _catalogoEn = 0; }

/** El catálogo con precios, o `null` si no se pudo traer. Nunca lanza: sin
 *  catálogo la app sigue leyendo documentos, solo que sin mostrar precios. */
export async function traerCatalogo(apiFetch, apiParse, { ahora = Date.now } = {}) {
  const t = ahora();
  if (_catalogo && t - _catalogoEn < CATALOGO_TTL_MS) return _catalogo;
  try {
    const resp = await apiFetch('/api/bases-analizar', {
      method: 'POST', timeout: 15000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'modelos' }),
    });
    const data = await apiParse(resp);
    if (!resp.ok || !data?.catalogo) return _catalogo;
    _catalogo = data.catalogo;
    _catalogoEn = t;
    return _catalogo;
  } catch { return _catalogo; }
}

/** USD por página del OCR elegido, según el catálogo. Cae al precio del OCR 3
 *  —el default histórico— cuando no hay catálogo todavía. */
export function usdPorPaginaDe(cat, idOcr, porDefecto = 0.002) {
  const lista = Array.isArray(cat?.ocr) ? cat.ocr : [];
  const id = idOcr || cat?.defaults?.licitaciones?.ocr;
  const m = lista.find(x => x.id === id) || lista.find(x => x.id === cat?.defaults?.licitaciones?.ocr);
  const v = Number(m?.usdPorPagina);
  return Number.isFinite(v) && v > 0 ? v : porDefecto;
}

/** El nombre lindo de un modelo, para mostrarlo sin el `z-ai/` adelante. */
export function nombreDe(cat, id, tipo = 'texto') {
  const lista = Array.isArray(cat?.[tipo]) ? cat[tipo] : [];
  return lista.find(x => x.id === id)?.nombre || id || '(el de siempre)';
}

export default { CLAVES, modelosDe, cuerpoDeModelos, traerCatalogo, usdPorPaginaDe, nombreDe };
