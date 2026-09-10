// ═══════════════════════════════════════════════════════════════════
// JARVEX — QUÉ MODELOS SE PUEDEN ELEGIR, Y CUÁNTO CUESTA CADA UNO
// (tanda 19, 9-set-2026).
//
// Gabriel: «quiero configurar qué modelos utilizar desde la app… todo
// seleccionable y que salga con sus costes reales».
//
// DOS ÁMBITOS SEPARADOS, A PROPÓSITO:
//   'licitaciones' → api/bases-analizar.js (bases y currículums)
//   'captura'      → api/captura-magica.js (facturas, guías, SCTR, certificados)
// Son problemas distintos y el mismo modelo no es el mejor para los dos: una
// factura electrónica es un PDF nítido de una página; unas bases integradas son
// 94 páginas escaneadas, fotocopiadas y recomprimidas. Captura Mágica funciona
// bien hoy, así que su default es EXACTAMENTE lo que ya venía usando y no
// cambia salvo que alguien la toque a mano.
//
// IMPORTANTE: sin `export default` — Vercel cuenta como serverless function a
// todo .js bajo /api con default export; éste vive en /lib para no contar
// (mismo criterio que api-helpers.js, openrouter.js y mistral-ocr.js).
//
// 🔴 POR QUÉ HAY UNA LISTA BLANCA Y NO UN CAMPO DE TEXTO LIBRE. El id del
// modelo viaja DESDE EL NAVEGADOR en cada pedido. Sin lista blanca, cualquiera
// con la sesión abierta podría pedir el modelo más caro del catálogo de
// OpenRouter (los hay a USD 75 por millón de tokens de salida) y la factura la
// paga la empresa. El servidor solo acepta lo que está acá; lo que no está,
// cae al default del ámbito. Quién puede CAMBIAR la configuración es otra capa
// (solo admin, en Administración → Modelos de IA), pero esta es la que impide
// que el gasto se desborde aunque esa capa falle.
//
// 🔴 SOBRE LOS PRECIOS. Están MEDIDOS —no copiados de un blog— contra la API
// pública de OpenRouter el 9-set-2026, con el filtro `?zdr=true`, que es la
// política con la que esta app llama de verdad (ver lib/openrouter.js). Se
// guardan con su fecha porque un precio sin fecha miente: el alias de Mistral
// se movió solo el 16-jul-2026 y DUPLICÓ el costo del OCR sin que nadie lo
// decidiera. El endpoint los refresca en vivo cuando puede; estos son el piso
// para cuando no se puede.
// ═══════════════════════════════════════════════════════════════════

/** Cuándo se midieron los precios de abajo. Se muestra en pantalla. */
export const PRECIOS_MEDIDOS_EL = '2026-09-09';

// ── El OCR: quién convierte una imagen escaneada en texto ─────────
//
// Es la fase que MÁS decide el resultado y la única cuyo error es
// irrecuperable: lo que se lee mal acá ya no lo arregla ningún modelo de texto
// después. Medido el 9-set sobre las bases 009 (94 páginas): con OCR 3 salieron
// páginas enteras en basura («ALCUADORA» repetido) y la lectura terminó con 0
// requisitos.
export const MODELOS_OCR = [
  {
    id: 'mistral-ocr-2512',
    nombre: 'Mistral OCR 3',
    usdPorPagina: 0.002,
    detalle: 'El de siempre. Barato y suficiente en documentos nítidos: una factura electrónica, un recibo por honorarios.',
    flojo: 'Se equivoca en escaneos fotocopiados y en tablas apretadas.',
  },
  {
    id: 'mistral-ocr-4-1',
    nombre: 'Mistral OCR 4.1',
    usdPorPagina: 0.004,
    detalle: 'El doble de precio y bastante mejor en tablas, escaneos y manuscrito (93,07 vs 85,66 en OmniDocBench). Es el que corresponde a unas bases integradas escaneadas.',
    recomendadoEn: ['licitaciones'],
  },
];

// ── El modelo de texto: quién convierte ese texto en datos ────────
//
// 'auto' es la cadena de gratuitos que ya venía: titular + respaldos, y si el
// titular está caído OpenRouter sirve con el siguiente DENTRO de la misma
// llamada.
//
// 🔴 UN MODELO ELEGIDO A MANO NO LLEVA CADENA DE RESPALDO, y es a propósito.
// Cuando alguien pide GLM para comparar, tiene que contestar GLM: si el pedido
// se cayera a otro por detrás, el resultado mediría una mezcla y no el modelo.
// Eso ya pasó de verdad — la corrida del 8-set terminó atendida en parte por
// `ling-3.0-flash-sante` (la variante afinada en SALUD) leyendo unas bases de
// licitación, porque el respaldo `minimax/minimax-m3:free` había desaparecido
// del catálogo. Con un modelo elegido, si falla, falla y se dice.
export const MODELOS_TEXTO = [
  {
    id: 'auto',
    nombre: 'Gratuitos (la cadena de hoy)',
    gratis: true,
    precio: { entrada: 0, salida: 0 },
    detalle: 'Cuesta USD 0. Titular con respaldos automáticos; el modelo que atiende puede cambiar entre una lectura y otra.',
    flojo: 'No admite JSON forzado, razona en voz alta antes de contestar y a veces se corta.',
  },
  {
    id: 'z-ai/glm-5.3-flash',
    nombre: 'GLM 5.3 Flash',
    precio: { entrada: 0.07, salida: 0.233 },
    detalle: 'El más barato de los pagos y el de más contexto (1,3 M). 26 proveedores, así que rara vez está saturado.',
    ojo: 'Z.ai es china (sede en Singapur); con la política ZDR el proveedor no guarda el pedido.',
  },
  {
    id: 'openai/gpt-5.6-luna',
    nombre: 'GPT-5.6 Luna',
    precio: { entrada: 0.20, salida: 1.20 },
    detalle: 'Contexto de 1,05 M, JSON forzado y esfuerzo de razonamiento regulable. Servido desde EE. UU. (OpenAI/Azure/Bedrock).',
  },
  {
    id: 'mistralai/mistral-large-2512',
    nombre: 'Mistral Large 3',
    precio: { entrada: 0.50, salida: 1.50 },
    detalle: 'El único europeo (Francia). Es el más caro de los tres pagos y el de menos contexto (262 k).',
  },
];

/**
 * Lo que usa cada ámbito si nadie configuró nada.
 *
 * Los dos arrancan EXACTAMENTE como venía funcionando la app hasta hoy: esto
 * no cambia ningún comportamiento por sí solo, solo abre la puerta para
 * cambiarlo a propósito y con el costo a la vista.
 */
export const DEFAULTS = {
  licitaciones: { ocr: 'mistral-ocr-2512', texto: 'auto' },
  captura: { ocr: 'mistral-ocr-2512', texto: 'auto' },
};

export const AMBITOS = Object.keys(DEFAULTS);

const buscar = (lista, id) => lista.find(m => m.id === String(id || '').trim()) || null;

/** El ámbito, saneado. Lo que no reconoce cae a 'captura' jamás: cae a null y
 *  el que llama decide, porque adivinar el ámbito equivocado cambiaría el
 *  modelo de un módulo por el del otro. */
export function ambitoValido(ambito) {
  return AMBITOS.includes(String(ambito || '').trim()) ? String(ambito).trim() : null;
}

/**
 * El modelo de OCR a usar. Nunca lanza: un id desconocido o vencido cae al
 * default del ámbito, porque dejar sin leer un documento por una configuración
 * vieja es peor que leerlo con el modelo de siempre.
 *
 * @returns { modelo, entrada, porDefecto }  `porDefecto` dice si hubo que caer.
 */
export function resolverOcr(id, ambito = 'captura') {
  const amb = ambitoValido(ambito) || 'captura';
  const pedido = buscar(MODELOS_OCR, id);
  if (pedido) return { modelo: pedido.id, entrada: pedido, porDefecto: false };
  const base = buscar(MODELOS_OCR, DEFAULTS[amb].ocr);
  return { modelo: base.id, entrada: base, porDefecto: true };
}

/**
 * El modelo de texto a usar.
 *
 * @returns { modelo, entrada, porDefecto, auto }
 *   `auto: true` significa «usá la cadena de gratuitos de lib/openrouter.js»,
 *   que es lo que hace la app cuando nadie eligió nada.
 */
export function resolverTexto(id, ambito = 'captura') {
  const amb = ambitoValido(ambito) || 'captura';
  const pedido = buscar(MODELOS_TEXTO, id);
  const e = pedido || buscar(MODELOS_TEXTO, DEFAULTS[amb].texto);
  return { modelo: e.id, entrada: e, porDefecto: !pedido, auto: e.id === 'auto' };
}

/** El catálogo tal como lo consume la pantalla. `precios` permite pisar los
 *  medidos con los que el endpoint acaba de traer en vivo de OpenRouter. */
export function catalogo({ precios = null } = {}) {
  return {
    medidoEl: PRECIOS_MEDIDOS_EL,
    enVivo: !!precios,
    ocr: MODELOS_OCR.map(m => ({ ...m })),
    texto: MODELOS_TEXTO.map(m => (precios && precios[m.id] ? { ...m, precio: precios[m.id] } : { ...m })),
    defaults: DEFAULTS,
  };
}
