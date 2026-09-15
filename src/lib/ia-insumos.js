// ═══════════════════════════════════════════════════════════════════
// JARVEX — LAS TRES AYUDAS DE IA DEL PANEL DE INSUMOS (14-sep-2026).
//
// Clasificar · Correlacionar · Mapear. Tres preguntas distintas sobre lo
// mismo, un solo motor: OpenRouter GRATIS (el que ya lee las facturas en
// Captura Mágica). Sin respaldo pago — pedido de Gabriel: si el gratuito no
// responde, se avisa y el botón queda listo para reintentar.
//
// POR QUÉ HACEN FALTA, con los tres casos reales que las pidieron:
//  · CLASIFICAR — "PANTALON Y CAMISACO DE DRILL OBRERO AZUL CON CINTA
//    REFLECTIVA" salía como [37] Herramienta manual. Es EPP: el motor local
//    mira palabras, no significados.
//  · CORRELACIONAR — "REDUCCION 1\" X 1/2" se proponía junto a "REDUCCION
//    2 1/2\" A 1". Escritas se parecen; son dos piezas distintas.
//  · MAPEAR — el mismo fierro escrito como lo escribe el proveedor y como lo
//    escribe el expediente técnico.
//
// Las tres van a /api/sugerir-cuenta-pcge (un endpoint más multiplexado, no
// uno nuevo) y NINGUNA aplica nada sola: devuelven una propuesta con su
// razonamiento y la persona decide.
// ═══════════════════════════════════════════════════════════════════
import { apiFetch, apiParse } from './api-client.js';
import { evidenciaDiccionario, candidatosParaIA } from './indices-unificados-iupc.js';

const ENDPOINT = '/api/sugerir-cuenta-pcge';

// ── LA MARCA «esto salió de una recomendación de IA» ──────────────
// Gabriel, 14-sep: «quiero saber qué insumo he aceptado como recomendación
// yo, algo así como cuando vea diga "Recomendado por IA"».
//
// 🔴 VA EN `nota`, NO EN `fuente`. Dos motivos:
//   · `fuente` contesta QUIÉN decidió, y la respuesta sigue siendo una
//     PERSONA: en el diseño nuevo nadie guarda nada sin que alguien acepte.
//     Ponerle 'ia' la haría perder contra 'manual' al resolver duplicados
//     (ver RANGO en mapeo-trabajo.js) aunque fuera la decisión más nueva.
//   · Los CHECK de `insumo_categoria.fuente` (mig 195) solo aceptan
//     'regla'/'manual'. Dexie no valida CHECKs: una fila con 'ia' se guardaba
//     local y REBOTABA en el push con 23514, que es exactamente el error de
//     sincronización que la contadora reportó la semana pasada. `nota` es
//     texto libre y ya existe en las dos tablas.
export const MARCA_IA = '[IA]';
export const notaDeIA = (confianza) =>
  `${MARCA_IA} Aceptado de la recomendación de IA${confianza ? ` (${Math.round(confianza * 100)}%)` : ''}`;
/** ¿Esta decisión se aceptó desde una propuesta de la IA? */
export const esDecisionDeIA = (decision) => String(decision?.nota || '').startsWith(MARCA_IA);

// Espeja `sanitizeForPrompt` del server (lib/api-helpers.js): el server lo
// aplica igual, así que mandar ya saneado hace que los nombres que VUELVEN
// sean idénticos a los que se mandaron. Sin esto, la respuesta de
// correlacionar traía "A  B" colapsado a "A B" y el cliente no lo reconocía
// al mapearlo de vuelta a sus variantes — sacaba del grupo justo las que la
// IA había dejado adentro.
const saneado = (s, max = 160) => String(s || '')
  .replace(/[\n\r\t]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

// La misma pregunta no cambia de respuesta: cachear evita repetir el viaje
// (y la espera) por algo ya preguntado. localStorage, por dispositivo.
const CACHE_KEY = 'jx_ia_insumos_v1';
const TTL = 30 * 24 * 60 * 60 * 1000;
const TOPE_CACHE = 2000;   // 700+ descripciones por empresa, y hay varias

const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; } }
function writeCache(c) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {} }

function cacheLeer(clave) {
  const c = readCache();
  const hit = c[clave];
  return (hit && (Date.now() - hit.t) < TTL) ? hit.v : null;
}

/**
 * 🔴 SOLO SE CACHEA UNA RESPUESTA ÚTIL. Un `result: null` es «la IA no dio
 * nada usable» (propuso un código fuera de la lista, o no encontró
 * equivalente): guardarlo 30 días convierte el «tocá el botón otra vez» en
 * una mentira — el botón devolvería para siempre la misma no-respuesta sin
 * volver a preguntar.
 */
function cacheGuardar(clave, v) {
  if (!v || !v.result) return;
  const c = readCache();
  c[clave] = { t: Date.now(), v };
  const keys = Object.keys(c);
  if (keys.length > TOPE_CACHE) {
    keys.sort((a, b) => (c[a].t || 0) - (c[b].t || 0));
    for (const k of keys.slice(0, keys.length - TOPE_CACHE)) delete c[k];
  }
  writeCache(c);
}

async function postIA(payload) {
  const resp = await apiFetch(ENDPOINT, {
    method: 'POST', timeout: 35000, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  // apiParse y NO resp.json(): cuando la plataforma contesta antes que la
  // función (402 en texto plano con la cuenta de Vercel suspendida), .json()
  // explota con «Unexpected token 'P'» y el usuario ve eso en vez de la causa
  // real. Es la regla que documenta api-client.js.
  const data = await apiParse(resp);
  if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
  return data;
}

// ── 1. CLASIFICAR ─────────────────────────────────────────────────
/**
 * candidatos: [{codigo, nombre|label}] — pasale la MISMA lista que ofrece el
 * selector (categoriasParaElegir()): así la IA nunca puede sugerir algo que
 * el desplegable no tiene, y la validación anti-alucinación del server tiene
 * contra qué validar.
 * → { result: {codigo_sugerido, alternativas} | null, confianza, razonamiento, _cached? }
 */
export async function clasificarInsumoConIA({ descripcion, unidad = '', candidatos, terminosCustom = null, propuestaLocal = null, frecuentes = [], modeloTexto = null }) {
  const desc = String(descripcion || '').trim();
  if (!desc || !Array.isArray(candidatos) || !candidatos.length) {
    return { result: null, razonamiento: '' };
  }
  // 🔴 EL RECORTE VA ACÁ, NO EN CADA PANTALLA (tanda 2). Los llamadores pasan
  // el universo entero —las 95 clasificaciones, que es lo correcto: es lo que
  // ofrece su desplegable— y acá se eligen las 8-12 plausibles con el ranking
  // que el motor local YA calculó. Hacerlo en la lib y no en el componente es
  // lo que garantiza que ninguna pantalla mande las 95 por olvido.
  const cortos = candidatosParaIA(desc, {
    opciones: candidatos, terminosCustom, propuestaLocal, frecuentes,
  });
  // Si el recorte se quedó sin nada que ofrecer (texto sin palabras útiles y
  // sin frecuentes), se manda el universo: preguntar con opciones es mejor que
  // no preguntar.
  const lista = cortos.length >= 3 ? cortos : candidatos;
  // 🔴 `clasif4` (tanda 2): la pregunta cambió otra vez — ahora van 8-12
  // opciones plausibles en vez de las 95, y con otra lista delante la
  // respuesta puede ser otra. Las versiones anteriores: `clasif` sin
  // diccionario, `clasif2` con el diccionario mezclado con la norma (365
  // términos huérfanos pasando por R.J. 016-2026), `clasif3` con las capas
  // ya separadas pero las 95 opciones.
  // El MODELO entra en la clave: dos modelos distintos son dos respuestas distintas,
  // y comparar uno contra otro con la caché del primero delante no compararía nada.
  const clave = `clasif4::${modeloTexto || 'auto'}::${norm(desc)}`;
  const hit = cacheLeer(clave);
  if (hit) return { ...hit, _cached: true };

  // La EVIDENCIA para esta descripción — ver `evidenciaDiccionario`. Se calcula
  // acá (el diccionario viaja en el bundle, no en el server) y se manda junto
  // con la pregunta, en dos bloques separados: la norma y lo propio.
  const evidencia = evidenciaDiccionario(desc, { terminosCustom });

  const v = await postIA({
    action: 'clasificar_insumo_iupc',
    ...(modeloTexto ? { modelo_texto: modeloTexto } : {}),
    descripcion: desc,
    unidad: unidad || '',
    candidatos: lista.map(c => ({ codigo: String(c.codigo), nombre: String(c.nombre || c.label || '') })),
    // DOS BLOQUES, no uno (tanda 1): `evidencia` es la NORMA (Anexo 2 + árbol
    // de servicios) y `evidencia_propia` es el diccionario de la empresa,
    // aprendido de decisiones. Iban mezclados y el prompt los presentaba a
    // todos como «DICCIONARIO OFICIAL» — la IA leía su propio error de ayer
    // con la autoridad de la R.J. 016-2026.
    evidencia: evidencia
      .filter(g => g.terminos.length)
      .map(g => ({
        codigo: String(g.codigo),
        terminos: g.terminos.map(t => String(t).slice(0, 80)).slice(0, 6),
      })),
    evidencia_propia: evidencia
      .filter(g => g.propios?.length)
      .map(g => ({
        codigo: String(g.codigo),
        terminos: g.propios.map(t => String(t).slice(0, 80)).slice(0, 4),
      })),
    // Lo que ya propuso el motor local leyendo ese mismo diccionario: la IA
    // tiene que CONFIRMARLO o corregirlo con un argumento, no ignorarlo.
    propuesta_local: propuestaLocal?.codigo ? {
      codigo: String(propuestaLocal.codigo),
      nombre: String(propuestaLocal.nombre || ''),
      motivo: String((propuestaLocal.motivos || []).join(', ')).slice(0, 200),
    } : null,
  });
  cacheGuardar(clave, v);
  return v;
}

// ── 2. CORRELACIONAR ──────────────────────────────────────────────
/**
 * variantes: los nombres a comparar — DOS para un par suelto, N para un grupo.
 * → { result: { mismas:[...], fuera:[...], canonico }, confianza, razonamiento }
 * `fuera` siempre es el complemento exacto de `mismas` (lo arma el server).
 */
export async function correlacionarConIA({ variantes, modeloTexto = null }) {
  // Saneado ANTES de mandar (ver `saneado`): así lo que vuelve en `mismas` es
  // carácter por carácter lo que se mandó, y el llamador puede mapearlo de
  // vuelta a sus variantes sin sorpresas.
  const lista = [...new Set((variantes || []).map(v => saneado(v)).filter(Boolean))];
  if (lista.length < 2) return { result: null, razonamiento: '' };

  // La pregunta es el CONJUNTO, no el orden en que llegó.
  const clave = `corr::${modeloTexto || 'auto'}::${[...lista].map(norm).sort().join('|')}`;
  const hit = cacheLeer(clave);
  if (hit) return { ...hit, _cached: true };

  const v = await postIA({ action: 'correlacionar_insumos', variantes: lista, ...(modeloTexto ? { modelo_texto: modeloTexto } : {}) });
  cacheGuardar(clave, v);
  return v;
}

// ── 3. MAPEAR AL PRESUPUESTO ──────────────────────────────────────
/**
 * candidatos: [{codigo, nombre, unidad, clasificacion}] del presupuesto del
 * trabajo (una preselección — el server los usa como única lista válida).
 * → { result: {codigo_sugerido, alternativas} | null, confianza, razonamiento }
 */
export async function mapearInsumoConIA({ insumo, unidad = '', clasificacion = '', candidatos, obraId = '', modeloTexto = null }) {
  const nombre = String(insumo || '').trim();
  if (!nombre || !Array.isArray(candidatos) || !candidatos.length) {
    return { result: null, razonamiento: '' };
  }
  // El presupuesto es por obra: la misma pregunta en otra obra es otra pregunta.
  const clave = `mapeo::${modeloTexto || 'auto'}::${obraId || ''}::${norm(nombre)}`;
  const hit = cacheLeer(clave);
  // Y el presupuesto de una obra SE REIMPORTA: si el código guardado ya no
  // existe entre los candidatos de hoy, la respuesta vieja no sirve — se
  // vuelve a preguntar en vez de mostrar «no encontró equivalente» con un
  // razonamiento que dice lo contrario.
  if (hit && candidatos.some(c => String(c.codigo) === String(hit?.result?.codigo_sugerido))) {
    return { ...hit, _cached: true };
  }

  const v = await postIA({
    action: 'mapear_insumo_presupuesto',
    ...(modeloTexto ? { modelo_texto: modeloTexto } : {}),
    insumo: nombre,
    unidad: unidad || '',
    clasificacion: clasificacion || '',
    candidatos: candidatos.slice(0, 60).map(c => ({
      codigo: String(c.codigo),
      nombre: String(c.nombre || ''),
      unidad: c.unidad || '',
      clasificacion: c.clasificacion || '',
    })),
  });
  cacheGuardar(clave, v);
  return v;
}
