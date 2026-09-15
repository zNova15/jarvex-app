// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL PROMPT CON EL QUE SE CLASIFICA UN INSUMO (tanda 2, 15-set-2026).
//
// POR QUÉ ESTÁ ACÁ Y NO ADENTRO DEL ENDPOINT. El piloto que compara modelos
// (`scripts/piloto-clasificacion.mjs`) tiene que medir EL PROMPT DE
// PRODUCCIÓN, no una copia parecida: si el script arma su propio texto, la
// comparación mide el script y no el modelo, y la decisión de qué motor pagar
// se toma sobre un número inventado. Con el prompt en un módulo compartido, el
// endpoint y el piloto no pueden divergir.
//
// Sin `export default`: vive en /lib para que Vercel no lo cuente como función
// serverless (mismo criterio que api-helpers.js y openrouter.js).
// ═══════════════════════════════════════════════════════════════════
import { sanitizeForPrompt } from './api-helpers.js';

/**
 * Arma las dos mitades del pedido y la lista contra la que se valida después.
 *
 * @param candidatos       [{codigo, nombre}] — las 8-12 plausibles que eligió
 *                         `candidatosParaIA()` en el cliente.
 * @param evidencia        la NORMA: [{codigo, terminos[]}] del Anexo 2.
 * @param evidenciaPropia  el diccionario de la empresa, que NO es la norma.
 * @param propuestaLocal   {codigo, nombre, motivo} del motor local, o null.
 * @returns { sys, usr, codigosValidos }
 */
export function promptClasificacion({ descripcion, unidad = '', candidatos = [], evidencia = [], evidenciaPropia = [], propuestaLocal = null }) {
  const codigosValidos = new Set(candidatos.map(c => String(c.codigo)));
  const lista = candidatos.map((c, i) =>
    `${i + 1}. [${sanitizeForPrompt(String(c.codigo), 20)}] ${sanitizeForPrompt(c.nombre, 100)}`
  ).join('\n');

  // ── La evidencia del Diccionario Oficial (Anexo 2 de la R.J. 016-2026) ──
  // La arma el cliente con `evidenciaDiccionario()` y la manda: son los
  // términos de la NORMA que comparten palabras con esta descripción, con el
  // código al que apuntan. Sin esto el modelo clasificaba de memoria y salían
  // los disparates que reportó Gabriel el 15-sep ("alambre de amarre" →
  // maquinaria liviana). Solo se aceptan códigos de la lista de candidatos:
  // una evidencia que apunte afuera se descarta en vez de ampliar la lista.
  const normativa = (Array.isArray(evidencia) ? evidencia : [])
    .slice(0, 12)
    .map(g => ({
      codigo: sanitizeForPrompt(String(g?.codigo || ''), 20),
      terminos: (Array.isArray(g?.terminos) ? g.terminos : [])
        .slice(0, 6).map(t => sanitizeForPrompt(t, 80)).filter(Boolean),
    }))
    .filter(g => g.codigo && codigosValidos.has(g.codigo) && g.terminos.length);
  const bloqueEvidencia = normativa.length
    ? normativa.map(g => `- [${g.codigo}] ← ${g.terminos.map(t => `"${t}"`).join(', ')}`).join('\n')
    : '(ninguno: el Diccionario Oficial no tiene ningún término que se parezca a esta descripción)';

  // ── El diccionario DE LA EMPRESA, que NO es la norma ──────────────
  // Tanda 1 (15-sep-2026). Hasta acá los términos que la empresa había
  // aprendido de sus propias decisiones viajaban DENTRO del bloque anterior,
  // rotulados «DICCIONARIO OFICIAL». Medido en producción: 365 de 368 eran
  // huérfanos de decisiones ya deshechas y ~70 estaban mal ("CUSQUEÑA" →
  // cemento). El modelo leía su propio error de ayer como si fuera la R.J.
  // 016-2026. Ahora va aparte y con el estatus que le corresponde: una pista
  // de la casa, que pierde contra la norma cuando se contradicen.
  const propios = (Array.isArray(evidenciaPropia) ? evidenciaPropia : [])
    .slice(0, 12)
    .map(g => ({
      codigo: sanitizeForPrompt(String(g?.codigo || ''), 20),
      terminos: (Array.isArray(g?.terminos) ? g.terminos : [])
        .slice(0, 4).map(t => sanitizeForPrompt(t, 80)).filter(Boolean),
    }))
    .filter(g => g.codigo && codigosValidos.has(g.codigo) && g.terminos.length);
  const bloquePropio = propios.length
    ? `\n\nDICCIONARIO DE LA EMPRESA (aprendido de decisiones previas — NO es la norma, puede tener errores):\n${
      propios.map(g => `- [${g.codigo}] ← ${g.terminos.map(t => `"${t}"`).join(', ')}`).join('\n')}`
    : '';

  const pl = propuestaLocal;
  const bloqueLocal = pl?.codigo && codigosValidos.has(String(pl.codigo))
    ? `\n\nPROPUESTA DEL MOTOR LOCAL (ya leyó ese mismo diccionario): [${sanitizeForPrompt(String(pl.codigo), 20)}] ${sanitizeForPrompt(pl.nombre, 100)}${pl.motivo ? ` — motivo: ${sanitizeForPrompt(pl.motivo, 200)}` : ''}`
    : '';

  const sys = `Eres un experto en insumos y servicios de construcción civil en Perú, clasificando según el estándar oficial IUPC del INEI (Índices Unificados de Precios de la Construcción, R.J. 016-2026) y su Diccionario Oficial de Elementos de Construcción (Anexo 2).

Te dan una DESCRIPCIÓN tal como aparece en una factura, una lista numerada de CLASIFICACIONES POSIBLES (código + nombre) y hasta tres bloques de apoyo, que NO tienen la misma autoridad:

1. EVIDENCIA DEL DICCIONARIO OFICIAL (Anexo 2) — es LA LEY: texto de la R.J. 016-2026 del INEI. No se discute.
2. DICCIONARIO DE LA EMPRESA — términos que esta empresa fue aprendiendo de sus propias decisiones. Es una PISTA, no la norma: puede tener errores, y de hecho los tuvo. Úsalo cuando la norma no dice nada sobre la descripción, o para desempatar entre códigos que la norma deja igual de plausibles. Si contradice a la EVIDENCIA OFICIAL, gana la oficial, y decilo en el razonamiento.
3. PROPUESTA DEL MOTOR LOCAL — la respuesta que ya calculó el sistema leyendo esos mismos diccionarios.

🔴 LA NORMA MANDA, NO TU INTUICIÓN. La evidencia del diccionario oficial le gana a cualquier razonamiento propio:
- Si algún término de la evidencia describe el MISMO objeto que la descripción, elegí ese código. "Alambre de amarre" contra la evidencia "[02] ← Alambre negro recocido, Alambre de púas" es acero, no maquinaria.
- La PROPUESTA DEL MOTOR LOCAL, cuando viene, salió de leer ese mismo diccionario. Confirmala salvo que tengas un argumento concreto para cambiarla, y si la cambiás decí en el razonamiento POR QUÉ la norma dice otra cosa. Cambiarla sin argumento es el error más caro que podés cometer acá.
- Si la evidencia OFICIAL está vacía, el objeto NO está en el diccionario de construcción (que el diccionario de la empresa diga algo no cambia eso). Eso es información, no permiso para forzarlo: un mueble de oficina, un servicio bancario o un artículo de escritorio van a las categorías complementarias (administrativos / consumos de oficina / servicios), NO al material del que están hechos. Una MESA DE MELAMINE es mobiliario de oficina, no "madera terciada"; un cobro de un banco o una inmobiliaria es un gasto administrativo o financiero, no un insumo.

Otras pistas donde el parecido de texto suele fallar:
- Ropa de trabajo, cascos, guantes, botas, chalecos, arneses, lentes, tapones de oído, cinta reflectiva → EPP / implementos de seguridad, aunque diga "obrero" o una marca que suene a herramienta.
- Herramienta MANUAL es lo que se opera a mano sin motor (llave, combo, pala); con motor, hidráulico o eléctrico portátil suele ser maquinaria liviana.
- Un servicio de alquiler, flete, transporte, mantenimiento o capacitación NO es un insumo físico — va al árbol de SERVICIOS (códigos que empiezan con S).
- Nunca inventes un código que no esté en la lista.

Devolvés SOLO JSON válido (sin markdown):
{
  "codigo_sugerido": "<código EXACTO de la lista, sin corchetes>",
  "confianza": 0.9,
  "razonamiento": "una frase corta y concreta, en español, dirigida a quien va a decidir. Si te apoyaste en un término, nombralo y decí de qué bloque salió (norma o diccionario de la empresa).",
  "alternativas": [{"codigo": "<código de la lista>", "motivo": "breve"}],
  "clasificacion_nueva": "<opcional: si NINGUNA de la lista le queda bien de verdad, el nombre corto de la clasificación que habría que crear (ej. 'Gastos financieros e intereses'). Si alguna sirve, omitilo>"
}
Confianza: 0.85+ inequívoco · 0.6-0.85 razonable · <0.6 ambiguo, que lo revise una persona. Si proponés "clasificacion_nueva", la confianza del código elegido debe ser menor a 0.6. Máximo 2 alternativas.`;

  const usr = `DESCRIPCIÓN: "${descripcion}"${unidad ? `\nUnidad de la factura: ${unidad}` : ''}

EVIDENCIA DEL DICCIONARIO OFICIAL (Anexo 2 de la R.J. 016-2026 — esto ES la norma):
${bloqueEvidencia}${bloquePropio}${bloqueLocal}

CLASIFICACIONES POSIBLES:
${lista}

Devolvé el JSON.`;

  return { sys, usr, codigosValidos };
}
