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
import { prepararCatalogo, parsearTextoLocal, completarConAlmacen, mismaUnidad } from './match-solicitud.js';

const ENDPOINT = '/api/asistente-solicitud';
const TIMEOUT_MS = 50_000;

/**
 * Aplana los cinco inventarios en una lista plana para comparar.
 * PURA: recibe ya leídas las filas de cada tipo.
 *
 * @param {Object} porTipo  { material: [...], epp: [...], ... } con filas
 *                          `{id, nombre, unidad, stock_actual}` (las que
 *                          devuelve `leerInventarioReal`).
 * @param {number} [tope]   techo de ítems. Era 400 cuando el catálogo iba
 *                          entero al prompt y dejaba afuera los EPP de la obra
 *                          de agua (524 insumos). Ahora se compara en código y
 *                          a la IA solo le llegan los candidatos: va completo.
 */
export function armarCatalogo(porTipo = {}, tope = 3000) {
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
 * La unidad de una fila vinculada. Si la obra dijo lo MISMO que el almacén
 * con otras letras («und» / «UNIDAD»), se usa la del almacén: el stock está
 * en esa. Si dijo OTRA cosa («kg» contra «bls»), se respeta la de la obra —
 * convertir no es trabajo de esta pantalla, y pisarla cambiaría el pedido.
 */
function unidadDeFila(pedida, delAlmacen) {
  if (!pedida) return delAlmacen || '';
  if (delAlmacen && mismaUnidad(pedida, delAlmacen)) return delAlmacen;
  return pedida;
}

/**
 * Convierte el resultado del asistente en filas del formulario.
 *
 * PURA y testeable. `nuevoItem` es la fábrica de filas de la pantalla (trae
 * el id local); se inyecta para no importar React acá.
 *
 * Cada fila guarda, además de lo que se envía:
 *   · `texto_pedido`  — lo que escribió la obra, tal cual. Cuando la fila se
 *                       vincula a un insumo del almacén el nombre pasa a ser
 *                       el del almacén, y esto es lo que permite ver (y
 *                       volver a) lo que pidieron de verdad.
 *   · `sugerencia`    — {fuente, score} si el vínculo lo propuso la máquina
 *                       y todavía nadie lo confirmó. La pantalla lo pinta
 *                       como «sugerido» para que la almacenera lo mire.
 *   · `alternativas`  — lo más parecido del almacén, para cambiarlo de un clic.
 *
 * Red de seguridad local: si no vino vínculo pero el nombre coincide EXACTO
 * (normalizado) con algo del catálogo del mismo tipo, se vincula igual.
 */
export function volcarEnItems(result, { catalogo = [], nuevoItem } = {}) {
  const porClave = new Map();
  for (const m of catalogo) porClave.set(`${m.tipo}|${normNombre(m.nombre)}`, m);
  const porId = new Map(catalogo.map(m => [String(m.id), m]));

  const filas = (result?.items || []).map(it => {
    const base = nuevoItem();
    let tipo = TIPOS_INSUMO[it.tipo] ? it.tipo : 'material';
    const pedido = String(it.nombre || '').trim();
    let insumoId = it.insumo_id || '';
    let nombre = pedido;
    let unidad = it.unidad || '';
    let sugerencia = null;

    const vinculado = insumoId && porId.get(String(insumoId));
    if (vinculado) {
      if (vinculado.tipo && TIPOS_INSUMO[vinculado.tipo]) tipo = vinculado.tipo;
      nombre = vinculado.nombre || pedido;
      unidad = unidadDeFila(unidad, vinculado.unidad);
      sugerencia = it.sugerencia
        ? { fuente: it.sugerencia.fuente || 'similitud', score: it.sugerencia.score ?? null }
        : null;
    } else {
      insumoId = '';
      const exacto = porClave.get(`${tipo}|${normNombre(pedido)}`);
      if (exacto) {
        insumoId = exacto.id;
        nombre = exacto.nombre || pedido;
        unidad = unidadDeFila(unidad, exacto.unidad);
      }
    }

    return {
      ...base,
      tipo,
      insumo_id: insumoId,
      nombre,
      unidad,
      cantidad: it.cantidad != null ? String(it.cantidad) : '',
      cantidad_minima: it.cantidad_minima != null ? String(it.cantidad_minima) : '',
      notas: it.notas || '',
      texto_pedido: pedido,
      sugerencia,
      alternativas: (it.alternativas || []).filter(a => a && porId.has(String(a.id))),
    };
  }).filter(f => f.nombre);

  return filas.length ? filas : [nuevoItem()];
}

/**
 * ¿Hay que dejar constancia de lo que pidió la obra? Solo si la fila quedó
 * vinculada a un insumo del almacén que se llama DISTINTO: el revisor tiene
 * que poder ver «pidieron codo pvc hilo 1/2 y se tomó CODO DE 1/2" x 90°
 * PVC» para detectar la sustitución.
 */
export function notaPedidoComo(fila) {
  const pedido = String(fila?.texto_pedido || '').trim();
  if (!fila?.insumo_id || !pedido) return '';
  if (normNombre(pedido) === normNombre(fila.nombre)) return '';
  return `Pedido como «${pedido}»`;
}

/**
 * El asistente SIN red: lector local + comparación contra el almacén, en el
 * mismo dispositivo. Es lo que corre sin señal en la obra o si el servidor no
 * contesta. PURA.
 */
export function interpretarLocal({ texto, catalogo = [], personal = [], fechaActual = null, motivo = 'sin conexión' } = {}) {
  const leido = parsearTextoLocal(texto, { hoy: fechaActual, personal });
  const advertencias = [`Se armó sin IA (${motivo}): revisá cantidades y nombres antes de enviar.`];
  if (fechaActual && leido.fecha_necesidad && leido.fecha_necesidad < fechaActual) {
    advertencias.push(`La fecha del mensaje (${leido.fecha_necesidad.split('-').reverse().join('/')}) ya pasó — se dejó la fecha deseada que estaba; corregila si hace falta.`);
    leido.fecha_necesidad = null;
  }
  if (fechaActual && leido.fecha_urgente && leido.fecha_urgente < fechaActual) leido.fecha_urgente = null;
  return completarConAlmacen({ ...leido, advertencias }, prepararCatalogo(catalogo));
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
  const sinRed = (motivo) => ({
    result: interpretarLocal({ texto: t, catalogo, personal, fechaActual, motivo }),
    model: 'lector-local',
  });
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
    return sinRed('sin conexión');
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
    return sinRed(e?.name === 'AbortError' ? 'el servidor tardó demasiado' : 'no se pudo conectar con el servidor');
  }

  const data = await apiParse(resp);
  // 401/403/422 son respuestas de verdad (sesión, rol, texto vacío): se
  // muestran. Un 5xx es el servidor caído: se lee igual acá.
  if (resp.status >= 500) return sinRed(`el servidor respondió ${resp.status}`);
  if (!resp.ok || data?.error) throw new Error(data?.error || `El asistente respondió ${resp.status}`);
  if (!data?.result) return sinRed('el servidor no devolvió un resultado legible');
  return data;
}
