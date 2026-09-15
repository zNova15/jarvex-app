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
//
// 🔴 ESTE TEXTO SE MIDIÓ: 97% de aciertos con GPT-5.6 Luna sobre los 32 casos
// reales del piloto (15-set-2026). El bloque «Otras pistas donde el parecido de
// texto suele fallar» dice en general algunas de las cosas que las REGLAS DE
// DESEMPATE dicen en concreto, y se deja igual a propósito: cambiar prosa que
// ya se midió, sin volver a medir, es cambiar el 97% por un número que nadie
// conoce. La autoridad sobre los pares difíciles es `src/lib/desempates-iupc.js`
// —el motor local y este prompt aplican las MISMAS reglas, de una sola fuente—
// y si alguna vez las dos versiones se contradicen, se corrige acá y se vuelve
// a correr `scripts/piloto-clasificacion.mjs`.
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
 * @param desempates       las reglas de los PARES DIFÍCILES que dispara esta
 *                         descripción — [{id, texto}] de `reglasDesempateParaIA()`
 *                         (tanda 3). Solo las que aplican, nunca las seis.
 * @param precioUnitario   el precio por unidad en soles, o null si no se sabe
 *                         (tanda 8). Ver `bloquePrecio`: es una pista de
 *                         MAGNITUD, no un dato para razonar de más.
 * @param vecinos          los otros ítems de la MISMA factura (tanda 9), como
 *                         [{nombre, unidad}]. Ver `bloqueVecinos`: es la pista
 *                         que convierte «PASTA FINA CPP» en algo decidible.
 * @param proveedor        quién emitió esa factura.
 * @returns { sys, usr, codigosValidos }
 */
export function promptClasificacion({ descripcion, unidad = '', candidatos = [], evidencia = [], evidenciaPropia = [], propuestaLocal = null, desempates = [], precioUnitario = null, vecinos = [], proveedor = '' }) {
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

  // ── LAS REGLAS DE DESEMPATE QUE APLICAN A ESTA DESCRIPCIÓN (tanda 3) ──
  // Los seis pares donde el parecido de palabras se equivoca SIEMPRE en la
  // misma dirección (ver `src/lib/desempates-iupc.js`, que es la autoridad: el
  // motor local aplica exactamente estas mismas reglas antes de preguntar).
  // Van solo las que dispara este texto —nunca las seis— y ya vienen filtradas
  // contra la lista de candidatos: una regla que empuje hacia un código que no
  // se ofrece es texto pagado que no puede terminar en ninguna respuesta.
  const reglas = (Array.isArray(desempates) ? desempates : [])
    .slice(0, 3)
    .map(r => sanitizeForPrompt(typeof r === 'string' ? r : r?.texto, 400))
    .filter(Boolean);
  const bloqueDesempate = reglas.length
    ? `\n\nREGLAS DE DESEMPATE PARA ESTE CASO (son lectura de la norma, valen tanto como la evidencia oficial):\n${
      reglas.map(r => `- ${r}`).join('\n')}`
    : '';

  // ── LA UNIDAD Y EL PRECIO UNITARIO (tanda 8, 15-set-2026) ────────
  // El caso que lo pidió, de Gabriel: «había una descripción de tapa ciega que
  // lo relacionó con una tapa de cemento y su valor era de 4 soles; eso era una
  // tapa que usan para electricidad, quedaba mejor con el índice 12». Dos
  // objetos que se escriben casi igual y cuestan cien veces distinto no son el
  // mismo objeto — y eso el texto solo no lo dice nunca.
  //
  // 🔴 SOLO SE MANDA SI SE SABE. El mismo pedido trae la advertencia: «no
  // siempre el precio será el correcto pues a veces ocurre casos donde te hacen
  // descuento y sale como 0». Un 0 leído como precio es peor que la ausencia de
  // precio: el cliente manda null y acá no aparece la línea.
  const precio = Number(precioUnitario);
  const bloquePrecio = Number.isFinite(precio) && precio > 0
    ? `\nPrecio unitario en la factura: S/ ${precio < 10 ? precio.toFixed(2) : Math.round(precio).toLocaleString('es-PE')} por ${sanitizeForPrompt(unidad, 20) || 'unidad'}`
    : '';

  // ── LO QUE VINO EN LA MISMA FACTURA (tanda 9, 15-set-2026) ───────
  // Los dos casos que lo pidieron, de Gabriel: «PASTA FINA CPP» (la IA dijo
  // NO SÉ) y «SUPER. TR4 0.25 X 1.05 X 6MTS ALZN» (la IA dijo tubería). Las
  // dos se contestan mirando el resto del comprobante: la primera vino con
  // pinturas, brochas y rodillos; la segunda con planchas galvanizadas. Ver el
  // encabezado de `src/lib/vecindario-factura.js`.
  //
  // 🔴 SE PRESENTA COMO CONTEXTO, NO COMO EVIDENCIA. Una ferretería vende de
  // todo: venir junto a pintura INCLINA, no demuestra. Si se rotulara como
  // prueba, la primera factura mixta haría clasificar tornillos como pintura.
  const listaVecinos = (Array.isArray(vecinos) ? vecinos : [])
    .slice(0, 8)
    .map(v => ({
      nombre: sanitizeForPrompt(typeof v === 'string' ? v : v?.nombre, 90),
      unidad: sanitizeForPrompt(typeof v === 'string' ? '' : v?.unidad, 12),
    }))
    .filter(v => v.nombre);
  const prov = sanitizeForPrompt(proveedor, 80);
  const bloqueVecinos = listaVecinos.length
    ? `\n\nQUÉ MÁS TRAÍA LA MISMA FACTURA${prov ? ` (proveedor: ${prov})` : ''} — CONTEXTO, no evidencia:\n${
      listaVecinos.map(v => `- ${v.nombre}${v.unidad ? ` (${v.unidad})` : ''}`).join('\n')}`
    : '';

  const pl = propuestaLocal;
  const bloqueLocal = pl?.codigo && codigosValidos.has(String(pl.codigo))
    ? `\n\nPROPUESTA DEL MOTOR LOCAL (ya leyó ese mismo diccionario): [${sanitizeForPrompt(String(pl.codigo), 20)}] ${sanitizeForPrompt(pl.nombre, 100)}${pl.motivo ? ` — motivo: ${sanitizeForPrompt(pl.motivo, 200)}` : ''}`
    : '';

  const sys = `Eres un experto en insumos y servicios de construcción civil en Perú, clasificando según el estándar oficial IUPC del INEI (Índices Unificados de Precios de la Construcción, R.J. 016-2026) y su Diccionario Oficial de Elementos de Construcción (Anexo 2).

Te dan una DESCRIPCIÓN tal como aparece en una factura, una lista numerada de CLASIFICACIONES POSIBLES (código + nombre) y hasta cuatro bloques de apoyo, que NO tienen la misma autoridad:

1. EVIDENCIA DEL DICCIONARIO OFICIAL (Anexo 2) — es LA LEY: texto de la R.J. 016-2026 del INEI. No se discute.
2. REGLAS DE DESEMPATE PARA ESTE CASO — cuando aparecen, son los pares que se confunden siempre y ya están resueltos. Valen como la evidencia oficial: si una regla contesta tu caso, seguila.
3. DICCIONARIO DE LA EMPRESA — términos que esta empresa fue aprendiendo de sus propias decisiones. Es una PISTA, no la norma: puede tener errores, y de hecho los tuvo. Úsalo cuando la norma no dice nada sobre la descripción, o para desempatar entre códigos que la norma deja igual de plausibles. Si contradice a la EVIDENCIA OFICIAL, gana la oficial, y decilo en el razonamiento.
4. PROPUESTA DEL MOTOR LOCAL — la respuesta que ya calculó el sistema leyendo esos mismos diccionarios (y aplicando esas mismas reglas de desempate).

🔴 LA NORMA MANDA, NO TU INTUICIÓN. La evidencia del diccionario oficial le gana a cualquier razonamiento propio:
- Si algún término de la evidencia describe el MISMO objeto que la descripción, elegí ese código. "Alambre de amarre" contra la evidencia "[02] ← Alambre negro recocido, Alambre de púas" es acero, no maquinaria.
- La PROPUESTA DEL MOTOR LOCAL, cuando viene, salió de leer ese mismo diccionario. Confirmala salvo que tengas un argumento concreto para cambiarla, y si la cambiás decí en el razonamiento POR QUÉ la norma dice otra cosa. Cambiarla sin argumento es el error más caro que podés cometer acá.
- Si la evidencia OFICIAL está vacía, el objeto NO está en el diccionario de construcción (que el diccionario de la empresa diga algo no cambia eso). Eso es información, no permiso para forzarlo: un mueble de oficina, un servicio bancario o un artículo de escritorio van a las categorías complementarias (administrativos / consumos de oficina / servicios), NO al material del que están hechos. Una MESA DE MELAMINE es mobiliario de oficina, no "madera terciada"; un cobro de un banco o una inmobiliaria es un gasto administrativo o financiero, no un insumo.

Otras pistas donde el parecido de texto suele fallar:
- Ropa de trabajo, cascos, guantes, botas, chalecos, arneses, lentes, tapones de oído, cinta reflectiva → EPP / implementos de seguridad, aunque diga "obrero" o una marca que suene a herramienta.
- Herramienta MANUAL es lo que se opera a mano sin motor (llave, combo, pala); con motor, hidráulico o eléctrico portátil suele ser maquinaria liviana.
- Un servicio de alquiler, flete, transporte, mantenimiento o capacitación NO es un insumo físico — va al árbol de SERVICIOS (códigos que empiezan con S).
- Nunca inventes un código que no esté en la lista.

LA UNIDAD Y EL PRECIO UNITARIO, CUANDO VIENEN, SON PARTE DE LA DESCRIPCIÓN. No son un dato de contabilidad: son la escala del objeto, y desempatan lo que el texto deja igual.
- Una TAPA de S/ 4 por unidad es una tapa de caja eléctrica, no una tapa de buzón de concreto; una de S/ 400 es la de buzón. Lo mismo con cajas, cintas, llaves, válvulas y perfiles: el mismo sustantivo cubre un accesorio chico y una pieza de obra.
- La unidad dice de qué se habla: "gal"/"bal" es líquido (pintura, aditivo, combustible), "p2" es madera, "kg"/"var" es acero, "par"/"und" con ropa o protección es EPP, "mes"/"dia"/"hm"/"glb" casi siempre es un SERVICIO o un alquiler, no un material.
- Si el precio contradice a la evidencia OFICIAL, gana la evidencia: el precio es una pista, no la norma. Y si no viene precio, no lo supongas ni lo menciones.

QUÉ MÁS TRAÍA LA MISMA FACTURA, cuando viene, es tu mejor pista para las descripciones que son un código comercial o una marca. Una factura suele comprarse para UNA tarea.
- Si la descripción no te dice nada por sí sola pero el resto del comprobante es de un rubro claro, clasificala en ese rubro y decilo en el razonamiento. Ejemplo: "PASTA FINA CPP" no está en el diccionario, pero vino con pinturas látex, brochas, rodillos y bandeja para pintar: es un producto de acabado de pared, no un cemento.
- Ejemplo al revés, igual de importante: "SUPER. TR4 0.25 X 1.05 X 6MTS ALZN" suena a tubo por las medidas, pero vino con planchas galvanizadas: TR4 es un perfil de cobertura y ALZN es aluzinc, así que es una plancha/calamina, no una tubería.
- 🔴 ES CONTEXTO, NO PRUEBA. Una ferretería vende de todo y una factura puede ser mixta: que algo venga junto a pintura INCLINA, no demuestra. Si la evidencia OFICIAL dice otra cosa, gana la evidencia. Y nunca clasifiques por el rubro del proveedor solo: el vecindario ayuda a entender QUÉ ES la cosa, no a suponer qué vende el que la facturó.

🔴 «NO SÉ» ES UNA RESPUESTA VÁLIDA, Y BARATA. Si después de leer la evidencia ninguna opción te convence de verdad —no que dudes entre dos parecidas, sino que no tenés con qué decidir: la descripción es un código de proveedor, una abreviatura sin contexto, o el objeto no se parece a nada de la lista— devolvé exactamente "NO_SE" en el campo codigo_sugerido. Detrás de esto hay una persona que revisa: decir «no sé» le cuesta un minuto, y un código elegido por descarte le cuesta un dato malo que nadie vuelve a mirar. Con "NO_SE" la confianza va por debajo de 0.4 y el razonamiento dice QUÉ FALTA para poder decidir (por ejemplo: «dice solo una marca y un número, no se sabe si es cable o perfil»).

🔴 Y SI DECÍS "NO_SE", TENÉS QUE CONTESTAR UNA DE DOS COSAS. No alcanza con no saber: hay alguien esperando para resolverlo y necesita saber por dónde.
(a) Si entendés QUÉ ES la cosa pero NINGUNA clasificación de la lista la cubre, llená "clasificacion_nueva" con el nombre corto de la que habría que crear, y "clasificacion_nueva_arbol" con insumo o servicio. Ejemplos: un empaste de pared cuando la lista solo trae cemento y arena; un gasto financiero cuando la lista solo trae materiales.
(b) Si NO entendés qué es, dejá "clasificacion_nueva" afuera y usá el razonamiento para decir exactamente qué dato falta.
Lo que no sirve es un "NO_SE" pelado, sin ninguna de las dos: eso le devuelve la pregunta entera a la persona sin haberla acercado un paso.

Devolvés SOLO JSON válido (sin markdown):
{
  "codigo_sugerido": "<código EXACTO de la lista, sin corchetes — o \"NO_SE\">",
  "confianza": 0.9,
  "razonamiento": "una frase corta y concreta, en español, dirigida a quien va a decidir. Si te apoyaste en un término, nombralo y decí de qué bloque salió (norma o diccionario de la empresa).",
  "alternativas": [{"codigo": "<código de la lista>", "motivo": "breve"}],
  "clasificacion_nueva": "<el nombre corto de la clasificación que habría que crear (ej. 'Gastos financieros e intereses'), cuando NINGUNA de la lista le queda bien de verdad. OBLIGATORIO si pusiste NO_SE y sabés qué es la cosa; omitilo si alguna de la lista sirve, o si no sabés ni qué es>",
  "clasificacion_nueva_arbol": "<solo si pusiste clasificacion_nueva: \"insumo\" si es una cosa física que se compra, \"servicio\" si es algo que se contrata>"
}
Confianza: 0.85+ inequívoco · 0.6-0.85 razonable · 0.4-0.6 ambiguo, que lo revise una persona · por debajo de 0.4 no elijas: devolvé "NO_SE". Si proponés "clasificacion_nueva", la confianza del código elegido debe ser menor a 0.6. Máximo 2 alternativas.`;

  const usr = `DESCRIPCIÓN: "${descripcion}"${unidad ? `\nUnidad de la factura: ${unidad}` : ''}${bloquePrecio}

EVIDENCIA DEL DICCIONARIO OFICIAL (Anexo 2 de la R.J. 016-2026 — esto ES la norma):
${bloqueEvidencia}${bloqueDesempate}${bloquePropio}${bloqueVecinos}${bloqueLocal}

CLASIFICACIONES POSIBLES:
${lista}

Devolvé el JSON.`;

  return { sys, usr, codigosValidos };
}
