// ═══════════════════════════════════════════════════════════════════
// JARVEX — POST /api/asistente-solicitud
//
// Pegás el mensaje que mandó la obra por WhatsApp y sale la Solicitud de
// Insumos armada: quién lo pide, qué pide, para cuándo, en qué frente y por
// qué. El texto real de obra no viene en formato — viene así:
//
//     Buen día
//     *Requerimiento:*
//     5 biodigestores
//     1 techo metálico
//     *Responsable*
//     Eddy Gil
//     *Fecha de requerimiento*
//     Jueves 25 de septiembre
//     *Razón de requerimiento*
//     UBS: instalación biodigestor, y ubicación de techo metálico
//
// ── HISTORIA (leer antes de borrarlo otra vez) ────────────────────
// Esto existió como `api/asistente-solicitud-mat.js` y se borró el 3-set-2026
// (commit 4bfe719) midiendo «0 solicitudes de frente» — o sea, se dio por
// muerto un flujo que recién arrancaba, apurado por un tope de 12 funciones
// que resultó ser de Hobby y no aplicaba. Vuelve el 23-set-2026 a pedido de
// Gabriel, con tres diferencias que importan:
//
//   1. Corre en OPENROUTER GRATIS (`lib/openrouter.js`), no en Claude Sonnet.
//      Estructurar texto limpio en JSON es el trabajo más fácil de la casa y
//      los gratuitos empataron 32/32 con Haiku — ver docs/ia-postproceso-openrouter.md.
//      Costo por solicitud: USD 0. Y no depende del saldo de Anthropic, que ya
//      dejó la app sin leer facturas dos veces (22-jul y 4-set-2026).
//   2. Cubre los CINCO tipos de insumo, no solo materiales.
//   3. Devuelve el match contra el catálogo REAL de la obra, para que la
//      pantalla pueda cruzarlo con el stock comprometido (`stock-comprometido.js`)
//      y decir «de esto tenemos 10, pero ya están pedidos».
//
// ── 24-set-2026: EL MATCH SALE DE LA IA ───────────────────────────
// Con los dos primeros mensajes reales de Eddy Gil (9 y 10 ítems) la pantalla
// solo decía «El requerimiento es demasiado largo para procesarlo de una vez».
// No era el mensaje: era el CATÁLOGO. Se le pasaban 400 insumos y se le pedía
// que eligiera; los gratuitos razonan en voz alta y ese pensamiento gasta el
// mismo techo que el JSON — comparar 10 ítems contra 400 nombres se comía los
// 4.000 tokens antes de escribir la primera llave. Y encima la obra de agua
// tiene 524 insumos: los EPP y los de emergencia ni entraban.
// Ahora:
//   · la comparación la hace `src/lib/match-solicitud.js` contra el catálogo
//     COMPLETO (gratis, instantáneo, y sabe que 1/2" ≠ 1 1/2" y SEL ≠ SAP);
//   · la IA ve solo los candidatos que esa lib preseleccionó (~10-90), y lo
//     que elige vuelve a pasar por el mismo filtro;
//   · si la IA falla, se corta o no está configurada, el mensaje se lee IGUAL
//     con el lector local (`parsearTextoLocal`) — el formato de WhatsApp de la
//     obra es muy repetido — y la pantalla avisa que se armó sin IA.
//
// ── POR QUÉ ENDPOINT PROPIO Y NO UN MODO DE captura-magica ────────
// CLAUDE.md pide multiplexar antes que crear, y con razón. Acá no aplica:
// `captura-magica` es 700 líneas de validación de ARCHIVOS (base64, HEIC,
// mimes permitidos, OCR de Mistral) y su allowlist de roles es contable
// (contador, ayudante_contador, jefe_compras). Esto no tiene archivo y lo
// usan roles de OBRA (almacenera, residente, ingeniero). Colgarlo de ahí
// obligaba a esquivar toda esa cañería y a mezclar dos allowlists que no se
// parecen. La cuenta es Pro: el tope de 12 funciones era de Hobby.
//
// Body: {
//   texto: string,                       // el mensaje crudo de la obra
//   catalogo: [{id, tipo, nombre, unidad, stock_actual}],   // insumos de la obra
//   personal?: [{id, nombre, cargo}],    // para reconocer al responsable
//   fecha_actual?: 'YYYY-MM-DD',
//   nombre_obra?: string,
// }
// ═══════════════════════════════════════════════════════════════════

import { requireAuth, rateLimit, sanitizeError, sanitizeForPrompt } from '../lib/api-helpers.js';
import { leerConfig, construirCuerpo, openrouterChat, normalizarRespuesta, armarCadenaOpenRouter } from '../lib/openrouter.js';
import { prepararCatalogo, candidatosDelTexto, completarConAlmacen, parsearTextoLocal, responsableDe } from '../src/lib/match-solicitud.js';
import { HISTORIAS, sanearHistoriaIA, LARGO_PREOCUPACION } from '../src/lib/simulador-historias.js';

// Techos: el mensaje de obra más largo que vimos no llega a 2.000 caracteres.
// El catálogo YA NO va entero al prompt (ver arriba): se recibe completo para
// compararlo acá, y a la IA le llegan solo los candidatos. 3.000 cubre de
// sobra la obra más grande (524 al 24-set) sin aceptar un body absurdo.
const MAX_TEXTO = 4000;
const MAX_CATALOGO = 3000;
const MAX_PERSONAL = 150;

// Igual que captura-magica y bases-analizar. Sin declararlo, el límite es el
// default del proyecto y no el que asume el `deadline` de 45 s de abajo: la
// lectura real del 24-set tardó 25 s.
export const maxDuration = 60;

// Quién puede usarla. Espejo del gating REAL de la pantalla Solicitud de
// Insumos: la carga el personal de almacén y de obra, no contabilidad. Los
// roles custom del panel viven en localStorage del cliente y el server no
// puede confiar en ellos — quedan fuera a propósito, igual que en
// captura-magica.
const ROLES = [
  'admin', 'gerente', 'almacenero', 'almacenera', 'jefe_almacen',
  'residente', 'ingeniero', 'jefe_compras', 'asistente_admin', 'prevencionista',
];

// ═══════════════════════════════════════════════════════════════════
// ACCIÓN 2: RECOMENDAR UN ENFOQUE DEL SIMULADOR DE ÓRDENES (ronda 2, tanda
// 2.6 — OPCIONAL, solo porque Gabriel la pidió el 24-set-2026 después de usar
// las tandas 2.1-2.5. docs/plan-simulador-ordenes.md §13).
//
// `body.action === 'recomendar_enfoque_simulador'`. Multiplexado en este
// mismo endpoint (regla de CLAUDE.md: preferir multiplexar antes que crear),
// igual que sugerir-cuenta-pcge lo hace por `body.action`.
//
// ── LO QUE LA IA VE, Y LO QUE NO PUEDE HACER ───────────────────────
// El motor determinístico (`src/lib/simulador-sorteo.js`) YA corrió los tres
// enfoques con el motor real y ya tiene sus números (cobertura, órdenes,
// plata). A la IA le llegan esos TRES RESÚMENES YA CALCULADOS, nunca el
// presupuesto ni el cronograma — no hay con qué inventar una cantidad porque
// no ve ninguna línea suelta. Su único trabajo es señalar CUÁL de los tres
// (un id de una lista cerrada) conviene más para ESTA obra y explicar por qué
// en un párrafo corto, citando los números que ya se le dieron. Si el id que
// devuelve no es uno de los que se le pasaron, se descarta — misma regla que
// un insumo_id inventado en la solicitud de arriba.
//
// Distinta allowlist de roles: el simulador de órdenes lo usan Gabriel y la
// contadora en jefe (§8 del plan), no el personal de almacén/obra de arriba.
const ROLES_ENFOQUES = ['admin', 'gerente', 'contador', 'ayudante_contador'];

export function systemPromptEnfoques() {
  return `Sos un asesor de compras de una constructora peruana. Te paso TRES enfoques ya calculados por un motor determinístico para planificar las órdenes de compra de una obra — cada uno con su número real de órdenes, su cobertura y su plata. Vos NO calculás nada nuevo: elegís cuál de los tres conviene más para ESTA obra y explicás por qué, en un párrafo corto y concreto, citando SOLO los números que te paso.

🔴 NUNCA inventes una cantidad, un monto o un plazo que no esté en lo que te doy. Si necesitás un número para tu explicación, usá uno de los que ya vienen en los resúmenes.
🔴 "recomendado" tiene que ser EXACTAMENTE uno de los "id" de la lista de enfoques. No inventes un id nuevo ni dejes el campo vacío si hay al menos un enfoque.

DEVOLVÉ SOLO JSON VÁLIDO, sin markdown y sin texto antes ni después:
{
  "recomendado": "caja_ajustada",
  "explicacion": "Con 100% de cobertura en los tres, éste es el que menos plata compromete de una vez: 9 órdenes chicas en vez de 4 grandes, cada una del tamaño de lo que se necesita ese mes.",
  "riesgo": "Si el flujo de caja no es el problema, junta más trabajo administrativo que los otros dos."
}
"riesgo" es opcional (contracara del que elegiste); si no aplica, cadena vacía.`;
}

export function userPromptEnfoques(candidatos = [], contexto = {}) {
  const p = [];
  p.push(`OBRA: ${sanitizeForPrompt(contexto.obra_nombre || '(sin nombre)', 120)}`);
  if (contexto.plazo_fin) p.push(`PLAZO: hasta ${contexto.plazo_fin}`);
  if (contexto.mesesRestantes != null) p.push(`MESES RESTANTES: ${contexto.mesesRestantes}`);
  if (contexto.montoComprable != null) p.push(`PRESUPUESTO COMPRABLE: S/ ${Number(contexto.montoComprable).toLocaleString('es-PE')}`);
  if (Array.isArray(contexto.categoriasActivas) && contexto.categoriasActivas.length) {
    p.push(`CATEGORÍAS INCLUIDAS: ${contexto.categoriasActivas.join(', ')}`);
  }
  if (contexto.lineasTramoLargo != null) p.push(`LÍNEAS DE TRAMO LARGO (más de 30 días): ${contexto.lineasTramoLargo}`);
  if (contexto.almacenModo) p.push(`DEL ALMACÉN SE RESTA: ${contexto.almacenModo}`);
  p.push('');
  p.push(`═══ LOS TRES ENFOQUES YA CALCULADOS (${candidatos.length}) ═══`);
  for (const c of (candidatos || [])) {
    p.push(`- id: ${c.id} | ${sanitizeForPrompt(c.nombre || '', 60)}`);
    p.push(`  ${sanitizeForPrompt(c.resumenTexto || '', 200)}`);
    const r = c.resumen || {};
    p.push(`  órdenes: ${r.ordenes ?? '—'} · cobertura: ${r.cobertura != null ? Math.round(r.cobertura * 100) + '%' : '—'}`
      + ` · plata propuesta: S/ ${r.montoPropuesto != null ? Number(r.montoPropuesto).toLocaleString('es-PE') : '—'}`);
  }
  return p.join('\n');
}

/**
 * Saneo de la recomendación. `recomendado` fuera de la lista cerrada de
 * candidatos se descarta entero — un enfoque inventado no se puede aplicar,
 * y aplicar el equivocado es peor que no recomendar nada.
 */
export function sanearEnfoque(crudo, idsValidos = []) {
  const ids = new Set(idsValidos);
  const recomendado = crudo?.recomendado && ids.has(String(crudo.recomendado)) ? String(crudo.recomendado) : null;
  if (!recomendado) return { recomendado: null, explicacion: '', riesgo: '' };
  return {
    recomendado,
    explicacion: String(crudo?.explicacion || '').trim().slice(0, 500),
    riesgo: String(crudo?.riesgo || '').trim().slice(0, 300),
  };
}

export function systemPrompt() {
  return `Eres el asistente de Solicitud de Insumos de una constructora peruana. Recibís el mensaje CRUDO que el personal de obra mandó por WhatsApp y lo convertís en una solicitud estructurada.

== LO QUE TENÉS QUE SACAR DEL TEXTO ==
- QUÉ piden (los ítems, con cantidad y unidad)
- QUIÉN lo pide (el responsable)
- PARA CUÁNDO lo necesitan (fecha deseada)
- EL MÍNIMO URGENTE y su fecha, si lo dicen ("Mínimo Necesario: 23/09/2026")
- EN QUÉ FRENTE se necesita
- POR QUÉ (la razón del requerimiento — la decide el área técnica)

== NOMBRE DEL INSUMO ==
- "nombre" es SOLO el nombre. NUNCA metas ahí la cantidad ni la unidad.
  · ✓ "Triplay 30 cm x 55 cm"    · ✗ "9 unidades de Triplay", "Triplay × 9"
- Copiá el nombre COMO LO ESCRIBIERON, con sus medidas y su material
  ('Codo pvc 1/2" x 90°'). No lo reemplaces por el nombre del almacén.
- Un renglón SIN cantidad debajo de un ítem es la continuación de su nombre:
  "41 SOQUETE + FOCO AHORRADOR" / "LUZ CALIDA x 15w" es UN solo ítem.
- La cantidad va SOLO en "cantidad" (número). La unidad SOLO en "unidad".
- Unidades cortas y peruanas: bls, kg, m, m2, m3, und, gal, pza, rll, hr.
- Si no dicen unidad, inferí la natural del insumo ("5 biodigestores" → und).
  Tubos, tuberías, curvas y accesorios se piden por pieza ("und") salvo que
  digan metros; cable y alambre, en metros ("m").

== TIPO DE INSUMO (elegí uno por ítem) ==
- "material"    : cemento, triplay, fierro, tubería, biodigestor, cinta de embalaje
- "herramienta" : taladro, carretilla, escalera, andamio
- "epp"         : casco, guantes, arnés, botas, lentes, chaleco
- "emergencia"  : botiquín, extintor, camilla, férula
- "maquinaria"  : retroexcavadora, mezcladora, compactadora, grupo electrógeno
Ante la duda razonable, "material".

== MATCH CONTRA EL ALMACÉN ==
Te paso los CANDIDATOS DEL ALMACÉN: los insumos que se parecen a lo pedido
(no el catálogo entero). Para cada ítem:
- Si uno de ellos es EL MISMO insumo aunque esté escrito distinto → "insumo_id": "<id>".
- Si ninguno lo es → "insumo_id": null (se compra; es normal).
Es el mismo SOLO si coincide la MEDIDA (1/2" no es 1 1/2" ni 3/4"; 90° no es
45°), el MATERIAL (PVC no es bronce ni F°G°) y el USO (PVC SEL eléctrico no es
PVC SAP de agua). Un nombre genérico ("Codo", "Tee") no es el mismo que uno
con medida.
🔴 NO INVENTES UN id QUE NO ESTÉ EN LA LISTA. Ante la duda, null: una fila que
dice "no sé" se resuelve en 5 segundos; una que apunta mal se descubre cuando
llegó el camión. No hace falta pensar en voz alta: decidí y devolvé el JSON.

== RESPONSABLE ==
- Buscá el nombre en la lista de PERSONAL. Si lo reconocés (aunque venga sin
  tildes, abreviado o con el cargo pegado: "ING. ROXANA VÁSQUEZ" → "Roxana
  Vásquez"), devolvé "responsable_id" con su id.
- Si el nombre no está en la lista, "responsable_id": null y poné el nombre tal
  como lo escribieron en "responsable_nombre".
- Si no dicen quién pide, los dos en null.

== FECHAS ==
- Formato SIEMPRE 'YYYY-MM-DD'. Usá la FECHA HOY que te paso para resolver
  "jueves 25 de septiembre", "mañana", "esta semana".
- "fecha_necesidad": para cuándo lo quieren ("Fecha de requerimiento" suele
  ser eso). Si no lo dicen, null.
- "fecha_urgente": la del MÍNIMO urgente, si mencionan uno. Suele ser ANTES que
  la deseada. Si no lo dicen, null.
- "cantidad_minima" por ítem: solo si dicen un mínimo para ESE ítem.

== PRIORIDAD ==
"urgente" si la obra está parada o lo dicen explícito; "alta" si hay apuro
claro; "normal" por defecto; "baja" si dicen que no corre prisa.

== CONFIANZA ==
Es sobre la LECTURA del mensaje, no sobre cuántos ítems hay en el almacén
(que no esté es normal: se compra).
- 0.85+ : el texto es claro, las cantidades y las fechas son explícitas.
- 0.6-0.85 : se entiende pero falta algo (una unidad, una fecha).
- <0.6 : texto ambiguo → que lo revise una persona.

== ADVERTENCIAS ==
Solo sobre la LECTURA del mensaje (una cantidad ilegible, una unidad dudosa,
un ítem que no se entiende). NO avises qué hay o no hay en el almacén ni si una
fecha ya pasó: eso lo resuelve la app después.

DEVOLVÉ SOLO JSON VÁLIDO, sin markdown y sin texto antes ni después:
{
  "items": [
    {"tipo": "material", "insumo_id": "uuid-o-null", "nombre": "Triplay 30 cm x 55 cm",
     "cantidad": 9, "unidad": "und", "cantidad_minima": null, "notas": "para señalización SST"}
  ],
  "responsable_id": "uuid-o-null",
  "responsable_nombre": "Roxana Vásquez",
  "razon": "Señalización de frentes de trabajo.",
  "frente": "Todos los frentes de trabajo para señalización SST",
  "descripcion": "Triplay y cinta para señalización SST",
  "fecha_necesidad": "2026-09-22",
  "fecha_urgente": "2026-09-23",
  "prioridad": "normal",
  "confianza": 0.9,
  "advertencias": []
}`;
}

// `cat` son los CANDIDATOS (ver `candidatosDelTexto`), no el catálogo entero.
export function userPrompt(body, cat = []) {
  const p = [];
  p.push(`OBRA: ${sanitizeForPrompt(body.nombre_obra || '(sin nombre)', 120)}`);
  p.push(`FECHA HOY: ${body.fecha_actual || new Date().toISOString().slice(0, 10)}`);
  p.push('');
  p.push('═══ MENSAJE CRUDO DE LA OBRA ═══');
  p.push(String(body.texto || '').slice(0, MAX_TEXTO));
  p.push('');

  p.push(`═══ CANDIDATOS DEL ALMACÉN (${cat.length}) ═══`);
  if (!cat.length) {
    p.push('(ninguno se parece a lo pedido — todos los ítems van con insumo_id null)');
  } else {
    for (const m of cat) {
      const u = m.unidad ? ` [${m.unidad}]` : '';
      const s = m.stock_actual != null ? ` · stock ${m.stock_actual}` : '';
      p.push(`- ${m.id} | ${m.tipo || 'material'} | ${sanitizeForPrompt(m.nombre || '', 90)}${u}${s}`);
    }
  }
  p.push('');

  const per = personalDe(body);
  p.push(`═══ PERSONAL DE LA OBRA (${per.length}) ═══`);
  if (!per.length) p.push('(vacío — responsable_id siempre null)');
  else for (const x of per) p.push(`- ${x.id} | ${sanitizeForPrompt(x.nombre || '', 80)}${x.cargo ? ` · ${sanitizeForPrompt(x.cargo, 40)}` : ''}`);

  return p.join('\n');
}

function jsonDeTexto(txt) {
  const s = String(txt || '').trim();
  const sinCerca = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(sinCerca); } catch { /* sigue abajo */ }
  const i = sinCerca.indexOf('{'), j = sinCerca.lastIndexOf('}');
  if (i >= 0 && j > i) {
    try { return JSON.parse(sinCerca.slice(i, j + 1)); } catch { /* nada */ }
  }
  return null;
}

// ── Saneo de la respuesta ─────────────────────────────────────────
// 🔴 EL id QUE NO ESTÁ EN EL CATÁLOGO SE TIRA. Es la misma regla que la
// clasificación de insumos: cuando el modelo no sabe, devuelve "no sé" y
// alguien lo resuelve; si le dejamos inventar un código plausible, la fila
// mala se pierde entre las buenas y se compra otra cosa.
const TIPOS = new Set(['material', 'herramienta', 'epp', 'emergencia', 'maquinaria']);
const PRIORIDADES = new Set(['baja', 'normal', 'alta', 'urgente']);
const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const numPos = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

export function sanearResultado(crudo, { catalogo = [], personal = [], hoy = null } = {}) {
  const idsCat = new Set((catalogo || []).map(m => String(m.id)));
  const idsPer = new Set((personal || []).map(p => String(p.id)));
  // Las advertencias de la IA sobre el ALMACÉN o sobre FECHAS PASADAS se
  // tiran: las dos cosas las decide este archivo después, y la versión de la
  // IA quedaba vieja. En la prueba real del 24-set decía «Tee pvc 1/2 no tiene
  // match, se deberá comprar» justo arriba de la fila del tee ya vinculado.
  const deLaApp = /almac[eé]n|cat[aá]logo|match|inventario|se deber[aá]n? comprar|ya (ha )?pas|anterior a la fecha/i;
  const advertencias = Array.isArray(crudo?.advertencias)
    ? crudo.advertencias.filter(a => typeof a === 'string' && !deLaApp.test(a)).slice(0, 10)
    : [];

  const items = (Array.isArray(crudo?.items) ? crudo.items : []).slice(0, 60).map(it => {
    const tipo = TIPOS.has(it?.tipo) ? it.tipo : 'material';
    let insumoId = it?.insumo_id ? String(it.insumo_id) : null;
    if (insumoId && !idsCat.has(insumoId)) {
      advertencias.push(`"${String(it?.nombre || '').slice(0, 50)}": la IA propuso un insumo que no está en el catálogo — se dejó sin vincular.`);
      insumoId = null;
    }
    return {
      tipo,
      insumo_id: insumoId,
      nombre: String(it?.nombre || '').trim().slice(0, 160),
      cantidad: numPos(it?.cantidad),
      unidad: String(it?.unidad || '').trim().slice(0, 12),
      cantidad_minima: numPos(it?.cantidad_minima),
      notas: it?.notas ? String(it.notas).trim().slice(0, 200) : '',
      confianza_item: Number.isFinite(Number(it?.confianza_item)) ? Number(it.confianza_item) : null,
    };
  }).filter(it => it.nombre);

  let responsableId = crudo?.responsable_id ? String(crudo.responsable_id) : null;
  if (responsableId && !idsPer.has(responsableId)) responsableId = null;
  // Si la IA no lo reconoció pero el nombre SÍ está en el personal, se busca
  // acá (y es la única forma de reconocerlo cuando lee el lector local).
  const responsableNombre = String(crudo?.responsable_nombre || '').trim().slice(0, 120);
  if (!responsableId && responsableNombre) {
    const p = responsableDe(responsableNombre, personal);
    if (p) responsableId = String(p.id);
  }

  // Una fecha deseada que YA PASÓ no puede ir al formulario (su mínimo es la
  // fecha de creación). Pasa con los mensajes reenviados días después: «Fecha
  // de requerimiento: lunes 14» leído el 24. Se avisa en vez de inventar otra.
  let fechaNec = esFecha(crudo?.fecha_necesidad) ? crudo.fecha_necesidad : null;
  let fechaUrg = esFecha(crudo?.fecha_urgente) ? crudo.fecha_urgente : null;
  if (esFecha(hoy)) {
    if (fechaNec && fechaNec < hoy) {
      advertencias.push(`La fecha del mensaje (${fechaNec.split('-').reverse().join('/')}) ya pasó — se dejó la fecha deseada que estaba; corregila si hace falta.`);
      fechaNec = null;
    }
    if (fechaUrg && fechaUrg < hoy) fechaUrg = null;
  }

  return {
    items,
    responsable_id: responsableId,
    responsable_nombre: responsableNombre,
    razon: String(crudo?.razon || '').trim().slice(0, 600),
    frente: String(crudo?.frente || '').trim().slice(0, 200),
    descripcion: String(crudo?.descripcion || '').trim().slice(0, 200),
    fecha_necesidad: fechaNec,
    fecha_urgente: fechaUrg,
    prioridad: PRIORIDADES.has(crudo?.prioridad) ? crudo.prioridad : 'normal',
    confianza: Number.isFinite(Number(crudo?.confianza)) ? Number(crudo.confianza) : null,
    advertencias: advertencias.slice(0, 12),
  };
}

function personalDe(body) {
  return (Array.isArray(body?.personal) ? body.personal : []).slice(0, MAX_PERSONAL);
}
function catalogoDe(body) {
  return (Array.isArray(body?.catalogo) ? body.catalogo : []).slice(0, MAX_CATALOGO);
}

/**
 * Lo que sigue a la lectura, venga de la IA o del lector local: sanear y
 * comparar contra el almacén. Exportada para testear el camino entero sin red.
 * @param motivoLocal  si viene, se armó SIN IA y se avisa por qué.
 */
export function armarRespuesta(crudo, body, { prep = null, motivoLocal = null } = {}) {
  const catalogo = catalogoDe(body);
  const r = sanearResultado(crudo, { catalogo, personal: personalDe(body), hoy: body?.fecha_actual || null });
  const out = completarConAlmacen(r, prep || prepararCatalogo(catalogo));
  if (motivoLocal) {
    out.advertencias = [`Se armó sin IA (${motivoLocal}): revisá cantidades y nombres antes de enviar.`, ...out.advertencias].slice(0, 15);
  }
  return out;
}

// Los `id` que puede devolver la IA: la lista cerrada de enfoques del motor
// determinístico. Se re-declara acá (no importa simulador-sorteo.js) porque
// este archivo vive en /api — un import que arrastre React/Dexie por
// transitividad lo rompería; ambas listas las cubre un test que las compara.
const IDS_ENFOQUE = ['caja_ajustada', 'cero_desabastecimiento', 'pocas_ordenes'];

/**
 * Rama de `handler` para `action:'recomendar_enfoque_simulador'` (tanda 2.6).
 * Nunca bloquea: si la IA no está configurada, falla o tarda, responde 200
 * con `recomendado:null` — la pantalla ya tiene los tres enfoques calculados
 * por el motor determinístico y sigue mostrándolos igual, solo sin la
 * opinión de la IA encima. Exportada para poder testear el camino entero.
 */
export async function handleRecomendarEnfoque(req, res, body) {
  const candidatos = (Array.isArray(body?.candidatos) ? body.candidatos : [])
    .filter(c => c && IDS_ENFOQUE.includes(String(c.id)))
    .slice(0, 3);
  if (!candidatos.length) {
    return res.status(422).json({ error: 'Faltan los enfoques ya calculados.' });
  }
  const idsValidos = candidatos.map(c => String(c.id));
  const contexto = (body?.contexto && typeof body.contexto === 'object') ? body.contexto : {};

  const sinIA = (motivo) => res.status(200).json({
    result: { recomendado: null, explicacion: '', riesgo: '' },
    motivo,
    model: null,
    costo: 0,
  });

  const cfg = leerConfig();
  if (!cfg.activo) return sinIA('la IA no está configurada en el servidor');

  const deadline = Date.now() + 20_000;
  const cadena = armarCadenaOpenRouter('auto', cfg);
  try {
    const data = await openrouterChat(cfg.apiKey, construirCuerpo({
      modelo: cadena.modelo,
      respaldos: cadena.respaldos,
      politica: cfg.politica,
      system: systemPromptEnfoques(),
      user: userPromptEnfoques(candidatos, contexto),
      // La respuesta es un párrafo corto (recomendado + explicación + riesgo),
      // no una lista de ítems: 1.500 alcanza de sobra incluido el razonamiento.
      maxTokens: 1500,
      razonamiento: 'bajo',
    }), deadline);

    const r = normalizarRespuesta(data);
    if (r.stop_reason === 'max_tokens') return sinIA('la respuesta de la IA se cortó');
    const crudo = jsonDeTexto(r.content?.[0]?.text || '');
    if (!crudo) return sinIA('la IA no devolvió un resultado legible');

    return res.status(200).json({
      result: sanearEnfoque(crudo, idsValidos),
      model: r.model || cadena.modelo,
      costo: r.costo,
    });
  } catch (e) {
    console.warn('[asistente-solicitud] enfoques: IA falló:', e?.upstreamStatus || e?.name || e?.message);
    try {
      return sinIA('la IA no respondió');
    } catch (e2) {
      const s = sanitizeError(e2, 'No se pudo pedir la recomendación');
      return res.status(s.status).json(s.body);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// ACCIÓN 3: ELEGIR Y CONTAR LA HISTORIA DEL CRONOGRAMA (ronda 3, tanda 3.4 —
// docs/plan-simulador-ordenes.md §15.2 C).
//
// `body.action === 'elegir_historia_simulador'`. Mismo endpoint, misma
// allowlist que la acción 2 (quien usa el simulador).
//
// ── LA IA ELIGE Y CUENTA; NUNCA PONE UNA FECHA ─────────────────────
// Ve el catálogo CERRADO de historias con los rangos de cada perilla, la
// plata que pide el plan cada mes con el Gantt, el plazo y —si Gabriel la
// escribió— qué le preocupa de la obra. Devuelve un id del catálogo, valores
// para sus perillas y el relato. Todo pasa por `sanearHistoriaIA()` (lib
// hoja, el catálogo real): id inventado → se descarta entero; perilla fuera
// de rango → se recorta; oración con una fecha puntual → se tira. Las fechas
// y los montos de la tarjeta los calcula el motor con lo que ella eligió.
// ═══════════════════════════════════════════════════════════════════

export function systemPromptHistoria() {
  const catalogo = HISTORIAS.map(h => {
    const perillas = Object.entries(h.rangos)
      .map(([k, r]) => `    · ${k}: de ${r.min} a ${r.max}, de a ${r.paso} — ${r.que}`)
      .join('\n');
    return `- id: ${h.id} | ${h.etiqueta}${h.estira ? ' (LA ÚNICA QUE ESTIRA EL FIN DE OBRA)' : ''}\n  ${h.resumen}\n  perillas:\n${perillas}`;
  }).join('\n');
  return `Sos un jefe de obra de una constructora peruana con años de obras públicas. Te paso la plata que el plan de compras de UNA obra pide cada mes según su cronograma (Gantt) y un catálogo CERRADO de historias de cómo puede ir una obra en la realidad. Elegí la historia más plausible o más útil de simular para ESTA obra, fijá sus perillas dentro de los rangos y contala.

CATÁLOGO (no hay otras):
${catalogo}

Las fracciones son del plazo que queda por delante (0.25 = a un cuarto del plazo). El ritmo 1 es el del Gantt; 0.5 es la mitad. El ritmo del cierre NO lo elegís vos: lo calcula el sistema para terminar en fecha.

🔴 "historia" tiene que ser EXACTAMENTE uno de los id del catálogo.
🔴 Cada perilla de "ajustes" tiene que estar dentro de su rango. Poné TODAS las perillas de la historia que elegiste, y ninguna de otra.
🔴 NUNCA pongas una fecha (ni día, ni año): las fechas las calcula el sistema con lo que elijas. Podés nombrar meses que aparecen en la plata por mes.
🔴 NUNCA inventes montos: si citás plata, que sea de la que te paso.
Si la persona escribió qué le preocupa, eso manda sobre tu propia lectura.

DEVOLVÉ SOLO JSON VÁLIDO, sin markdown y sin texto antes ni después:
{
  "historia": "frenazo",
  "ajustes": { "inicio": 0.35, "duracion": 0.25, "ritmo": 0.5, "cuotaCaras": 0.4 },
  "relato": "La obra arranca bien, pero cuando llega el grueso de las valorizaciones la entidad se atrasa en pagar y la marcha baja a la mitad. Con la caja apretada se sigue con lo barato y lo caro espera. Cuando entra la plata hay que apurar para cerrar en fecha.",
  "porQue": "El plan concentra la plata en los últimos meses: es justo donde un atraso de pagos más duele."
}
"relato": 2 a 4 oraciones, en castellano de Perú, concretas. "porQue": 1 o 2 oraciones sobre por qué ésta para esta obra.`;
}

export function userPromptHistoria(contexto = {}) {
  const c = contexto || {};
  const p = [];
  p.push(`OBRA: ${sanitizeForPrompt(c.obra || '(sin nombre)', 160)}`);
  if (c.plazoInicio || c.plazoFin) p.push(`PLAZO: ${c.plazoInicio || '?'} a ${c.plazoFin || '?'}`);
  p.push(c.modo === 'real'
    ? `MODO: según lo real — la historia corre desde hoy${c.desde ? ` (${c.desde})` : ''} hasta el fin; lo anterior ya pasó.`
    : 'MODO: simulación — la historia cubre la obra entera.');
  if (c.comprableMiles != null) p.push(`PRESUPUESTO COMPRABLE: S/ ${Number(c.comprableMiles).toLocaleString('es-PE')} mil`);
  p.push('');
  p.push('PLATA QUE PIDE EL PLAN CADA MES CON EL GANTT (miles de soles):');
  const meses = Array.isArray(c.meses) ? c.meses.slice(0, 48) : [];
  if (!meses.length) p.push('(sin datos por mes)');
  for (const m of meses) {
    if (!m || !/^\d{4}-\d{2}$/.test(String(m.mes))) continue;
    p.push(`- ${m.mes}: ${Math.round(Number(m.miles) || 0).toLocaleString('es-PE')}`);
  }
  const preocupa = sanitizeForPrompt(String(c.preocupacion || ''), LARGO_PREOCUPACION).trim();
  if (preocupa) {
    p.push('');
    p.push(`LO QUE LE PREOCUPA A QUIEN PLANIFICA: ${preocupa}`);
  }
  return p.join('\n');
}

/**
 * Rama de `handler` para `action:'elegir_historia_simulador'` (tanda 3.4).
 * Nunca bloquea: sin IA responde 200 con `historia:null` y el motivo — la
 * pantalla sigue con la historia que ya tenía (la del sorteo).
 */
export async function handleElegirHistoria(req, res, body) {
  const contexto = (body?.contexto && typeof body.contexto === 'object') ? body.contexto : null;
  if (!contexto || !Array.isArray(contexto.meses) || !contexto.meses.length) {
    return res.status(422).json({ error: 'Falta la plata por mes del plan: sin eso no hay qué leer.' });
  }

  const sinIA = (motivo) => res.status(200).json({ result: { historia: null }, motivo, model: null, costo: 0 });

  const cfg = leerConfig();
  if (!cfg.activo) return sinIA('la IA no está configurada en el servidor');

  const deadline = Date.now() + 25_000;
  const cadena = armarCadenaOpenRouter('auto', cfg);
  try {
    const data = await openrouterChat(cfg.apiKey, construirCuerpo({
      modelo: cadena.modelo,
      respaldos: cadena.respaldos,
      politica: cfg.politica,
      system: systemPromptHistoria(),
      user: userPromptHistoria(contexto),
      // Un id, cuatro números y dos párrafos cortos. Igual que la acción 2,
      // el techo es por el razonamiento de los gratuitos, no por el JSON.
      maxTokens: 2000,
      razonamiento: 'bajo',
    }), deadline);

    const r = normalizarRespuesta(data);
    if (r.stop_reason === 'max_tokens') return sinIA('la respuesta de la IA se cortó');
    const crudo = jsonDeTexto(r.content?.[0]?.text || '');
    if (!crudo) return sinIA('la IA no devolvió un resultado legible');
    const limpio = sanearHistoriaIA(crudo);
    if (!limpio) return sinIA('la IA eligió una historia que no está en el catálogo');

    return res.status(200).json({ result: limpio, model: r.model || cadena.modelo, costo: r.costo });
  } catch (e) {
    console.warn('[asistente-solicitud] historia: IA falló:', e?.upstreamStatus || e?.name || e?.message);
    try {
      return sinIA('la IA no respondió');
    } catch (e2) {
      const s2 = sanitizeError(e2, 'No se pudo pedir la historia');
      return res.status(s2.status).json(s2.body);
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  let authCtx;
  try {
    authCtx = await requireAuth(req);
    rateLimit(req, { windowMs: 60_000, max: 20 });
  } catch (e) {
    const s = sanitizeError(e, 'No autorizado');
    return res.status(s.status).json(s.body);
  }

  const rol = authCtx?.profile?.rol || null;
  if (!rol) {
    // profile null = hiccup transitorio consultando profiles. Fail-closed pero
    // REINTENTABLE: 503, no un 403 que diagnostica mal un problema pasajero.
    return res.status(503).json({ error: 'No se pudo verificar tu rol en este momento — reintentá en unos segundos.', code: 'rol_no_verificable' });
  }

  const body = req.body || {};

  // ── ACCIÓN 2 (tanda 2.6, opcional): recomendar un enfoque del simulador ──
  // Distinta allowlist (§8 del plan: Gabriel y la contadora, no almacén/obra)
  // y distinto cuerpo de request — se separa ANTES de leer `texto`.
  if (body.action === 'recomendar_enfoque_simulador') {
    if (!ROLES_ENFOQUES.includes(rol)) {
      return res.status(403).json({ error: 'Tu rol no puede pedir recomendaciones del simulador de órdenes.' });
    }
    return handleRecomendarEnfoque(req, res, body);
  }

  // ── ACCIÓN 3 (tanda 3.4): elegir y contar la historia del cronograma ──
  if (body.action === 'elegir_historia_simulador') {
    if (!ROLES_ENFOQUES.includes(rol)) {
      return res.status(403).json({ error: 'Tu rol no puede pedir historias del simulador de órdenes.' });
    }
    return handleElegirHistoria(req, res, body);
  }

  if (!ROLES.includes(rol)) {
    return res.status(403).json({ error: 'Tu rol no puede usar el asistente de solicitudes. Pedile al admin que lo revise.' });
  }

  const texto = typeof body.texto === 'string' ? body.texto.trim() : '';
  if (!texto) return res.status(422).json({ error: 'Pegá el texto del requerimiento.' });
  if (texto.length > MAX_TEXTO) {
    return res.status(422).json({ error: `El texto es muy largo (${texto.length} caracteres, máximo ${MAX_TEXTO}). Partilo en dos solicitudes.` });
  }

  const catalogo = catalogoDe(body);
  const prep = prepararCatalogo(catalogo);
  const hoy = body.fecha_actual || null;
  const leidoLocal = parsearTextoLocal(texto, { hoy, personal: personalDe(body) });

  // El lector local es la red: si la IA no está o falla, el mensaje se lee
  // igual. Un 200 con aviso es mejor que un «probá de nuevo» con la obra
  // esperando el material.
  const local = (motivo) => res.status(200).json({
    result: armarRespuesta(leidoLocal, body, { prep, motivoLocal: motivo }),
    model: 'lector-local',
    costo: 0,
  });

  const cfg = leerConfig();
  if (!cfg.activo) return local('la IA no está configurada en el servidor');

  // Vercel corta a los 60 s; dejamos margen para responder el error propio.
  const deadline = Date.now() + 45_000;
  const cadena = armarCadenaOpenRouter('auto', cfg);
  // Solo lo que se parece a lo pedido. Si el catálogo es chico, va entero.
  const candidatos = catalogo.length <= 60 ? catalogo : candidatosDelTexto(texto, prep);

  try {
    const data = await openrouterChat(cfg.apiKey, construirCuerpo({
      modelo: cadena.modelo,
      respaldos: cadena.respaldos,
      politica: cfg.politica,
      system: systemPrompt(),
      user: userPrompt(body, candidatos),
      // El JSON de 15 ítems ronda los 1.500 tokens, pero estos modelos
      // razonan antes de contestar y ESO cuenta contra el mismo techo (ver
      // `presupuestoSalida` en lib/openrouter.js). MEDIDO el 24-set con el
      // mensaje de agua de Eddy Gil (9 ítems, 24 candidatos): 9.028 tokens de
      // salida en 25 s. Los 4.000 de antes fueron exactamente lo que lo cortó.
      // Con un gratuito pedir de más cuesta USD 0; lo caro es cortar — y si
      // igual se corta, cae al lector local, no a un error.
      maxTokens: 16000,
      razonamiento: 'bajo',
    }), deadline);

    const r = normalizarRespuesta(data);
    if (r.stop_reason === 'max_tokens') return local('la respuesta de la IA se cortó');
    const crudo = jsonDeTexto(r.content?.[0]?.text || '');
    if (!crudo || !Array.isArray(crudo.items)) return local('la IA no devolvió un resultado legible');
    // La IA leyó bastantes MENOS ítems que el lector local: se salteó
    // renglones. Con el formato de WhatsApp el local no se saltea ninguno.
    if (leidoLocal.items.length >= 3 && crudo.items.length < leidoLocal.items.length - 1) {
      return local(`la IA leyó ${crudo.items.length} ítems y el mensaje trae ${leidoLocal.items.length}`);
    }

    return res.status(200).json({
      result: armarRespuesta(crudo, body, { prep }),
      // Con un gratuito el costo es 0, y ese 0 es un dato medido de OpenRouter,
      // no un supuesto. El modelo servido puede no ser el titular (cadena de
      // respaldos): cuando una lectura salga mal hay que saber quién la hizo.
      model: r.model || cadena.modelo,
      costo: r.costo,
    });
  } catch (e) {
    // Timeout, 429, sin crédito, política de datos: para la almacenera es lo
    // mismo — la solicitud se arma igual con el lector local. El motivo real
    // queda en el log (openrouterChat ya imprime el cuerpo del error).
    console.warn('[asistente-solicitud] IA falló, lector local:', e?.upstreamStatus || e?.name || e?.message);
    try {
      return local('la IA no respondió');
    } catch (e2) {
      const s = sanitizeError(e2, 'No se pudo procesar el requerimiento');
      return res.status(s.status).json(s.body);
    }
  }
}
