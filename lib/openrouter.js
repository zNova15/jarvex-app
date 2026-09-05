// Cliente de OpenRouter para el POSTPROCESAMIENTO del OCR.
//
// IMPORTANTE: este archivo NO debe tener `export default` — Vercel cuenta como
// serverless function a todo .js bajo /api con default export; éste vive en
// /lib justamente para no contar (mismo criterio que api-helpers.js).
//
// POR QUÉ EXISTE
// El paso caro de Captura Mágica no es el OCR (Mistral, USD 0,002–0,004 por
// página) sino la ESTRUCTURACIÓN del texto a JSON, que hacía Claude Haiku 4.5
// a USD ~0,012 por comprobante. Ese paso es "leer texto limpio y llenar un
// formulario": no necesita el mejor modelo del mundo, necesita seguir
// instrucciones y devolver JSON. Medido el 5-sep-2026 contra 3 comprobantes
// peruanos sintéticos (factura con detracción, recibo por honorarios, guía de
// remisión) + una factura de 60 líneas, varios modelos GRATUITOS de OpenRouter
// empatan 32/32 con Haiku y responden en el mismo tiempo.
//
// Además resuelve un incidente recurrente: la app se queda sin leer facturas
// cada vez que se agota el saldo de Anthropic (22-jul y 4-sep-2026). Con
// OpenRouter de titular y Claude de respaldo, el camino común deja de depender
// de ese saldo.
//
// PRIVACIDAD — la razón por la que hay un `provider` en cada request
// OpenRouter enruta a proveedores de cómputo de terceros. Sin acotarlo, un
// modelo gratuito puede caer en un proveedor que ENTRENA con lo que le mandás,
// y acá le mandamos RUC, razón social, montos y a veces DNI. Por eso TODA
// llamada lleva una política de datos explícita:
//   'zdr'   → Zero Data Retention: el proveedor ni siquiera guarda el prompt.
//   'deny'  → puede guardarlo para operar, pero NO puede entrenar con él.
// Si ningún endpoint cumple la política, OpenRouter responde 404 "No endpoints
// found matching your data policy" y NO manda los datos a ningún lado. Esa es
// la garantía: falla cerrado, no se filtra.
//
// Env vars (todas opcionales salvo la key):
//   OPENROUTER_API_KEY        — activa el motor. Sin ella, todo sigue en Claude.
//   OPENROUTER_STRUCT_MODEL   — modelo titular.  default ver MODELO_DEFAULT
//   OPENROUTER_STRUCT_FALLBACK— modelo(s) de respaldo, separados por coma.
//   OPENROUTER_DATA_POLICY    — 'zdr' (default) | 'deny'
//   IA_POSTPROCESO            — 'openrouter' (default) | 'anthropic' (revertir)

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Titular: Ling 3.0 Flash (variante afinada en finanzas) servido por Novita con
// Zero Data Retention. Es el ÚNICO de los gratuitos medidos que pasa el filtro
// `zdr:true`; los demás solo llegan a "no entrena con tus datos".
export const MODELO_DEFAULT = 'inclusionai/ling-3.0-flash-fin:free';
// Respaldo: MiniMax M3 por GMICloud (Mountain View). No es ZDR pero sí
// data_collection=deny. Solo entra si el titular no responde.
export const MODELO_FALLBACK_DEFAULT = 'minimax/minimax-m3:free';

// ── Configuración leída del entorno ───────────────────────────────
// Pura y exportada para poder testearla sin tocar process.env global.
export function leerConfig(env = process.env) {
  const modelo = (env.OPENROUTER_STRUCT_MODEL || MODELO_DEFAULT).trim();
  const respaldos = String(env.OPENROUTER_STRUCT_FALLBACK ?? MODELO_FALLBACK_DEFAULT)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((m) => m !== modelo);
  const politica = env.OPENROUTER_DATA_POLICY === 'deny' ? 'deny' : 'zdr';
  return {
    apiKey: env.OPENROUTER_API_KEY || '',
    modelo,
    respaldos,
    politica,
    // 'anthropic' revierte al comportamiento anterior sin borrar la key.
    activo: (env.IA_POSTPROCESO || 'openrouter') !== 'anthropic' && !!env.OPENROUTER_API_KEY,
  };
}

// ── Cuerpo de la request ──────────────────────────────────────────
// `models` es la cadena de respaldo A NIVEL DE MODELO: si el titular está
// caído o rate-limiteado, OpenRouter prueba el siguiente DENTRO de la misma
// llamada, sin gastar otro round-trip nuestro.
export function construirCuerpo({ modelo, respaldos = [], politica = 'zdr', system, user, maxTokens }) {
  const cadena = [modelo, ...respaldos];
  return {
    model: modelo,
    ...(cadena.length > 1 ? { models: cadena } : {}),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: maxTokens,
    // Extraer datos de un comprobante no es creativo: queremos la misma lectura
    // dos veces sobre el mismo PDF.
    temperature: 0,
    provider: {
      ...(politica === 'zdr' ? { zdr: true } : { data_collection: 'deny' }),
      allow_fallbacks: true,
    },
  };
}

// ── Techo de salida ───────────────────────────────────────────────
// 🔴 El techo de Claude (900 + ítems×55) NO sirve acá. Está calibrado sobre
// Haiku, que escupe el JSON y nada más; los gratuitos buenos son modelos de
// RAZONAMIENTO: piensan en voz alta antes del JSON y ese pensamiento también
// cuenta contra el techo.
// Medido el 5-sep-2026 con ling-3.0-flash-fin, mismo prompt de producción:
//   factura de 3 ítems  → 1.571 tokens de salida (Haiku: 493)
//   factura de 60 ítems → 6.811 tokens de salida (Haiku: 2.914)
// Con el techo de Claude para 60 ítems (4.200) la respuesta se CORTA a la
// mitad, sale finish_reason 'length' y la fila termina en Error diciendo
// "demasiadas líneas de detalle" — que es exactamente el bug que ese techo
// dinámico había venido a arreglar (caso F001-4446, 66 ítems).
// Pedir de más acá cuesta USD 0: lo caro es cortar una factura por 500 tokens.
export function presupuestoSalida(itemsEstimados) {
  const n = Number.isFinite(itemsEstimados) && itemsEstimados > 0 ? Math.floor(itemsEstimados) : 0;
  return Math.min(16000, Math.max(6000, 1800 + n * 110));
}

// ── Normalizar la respuesta a la FORMA DE ANTHROPIC ───────────────
// Devolvemos { content:[{type:'text',text}], stop_reason, usage, model } para
// que `extractJson` y el resto de api/captura-magica.js sigan funcionando sin
// una segunda rama de parseo (una sola forma que mantener, no dos).
export function normalizarRespuesta(data) {
  const choice = (data && Array.isArray(data.choices) && data.choices[0]) || null;
  const msg = choice ? choice.message || {} : {};
  let texto = typeof msg.content === 'string' ? msg.content : '';
  // Algunos modelos devuelven el content como array de bloques (estilo OpenAI
  // multimodal): concatenamos los de texto.
  if (!texto && Array.isArray(msg.content)) {
    texto = msg.content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('');
  }
  // Los modelos de razonamiento suelen pensar en voz alta antes del JSON. Si
  // ese pensamiento viene DENTRO del content entre <think>…</think>, hay que
  // sacarlo: `extractJson` busca de la primera '{' a la última '}' y una llave
  // suelta en el razonamiento se lleva puesto el parseo.
  texto = texto.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // Y si el modelo puso TODO en `reasoning` y dejó el content vacío, ahí está
  // el JSON o no está en ningún lado.
  if (!texto && typeof msg.reasoning === 'string') texto = msg.reasoning.trim();
  return {
    content: [{ type: 'text', text: texto }],
    // 'length' es el equivalente OpenAI de stop_reason:'max_tokens' — es la
    // señal que usa el endpoint para decir "documento demasiado extenso" en
    // vez de "JSON inválido".
    stop_reason: choice && choice.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
    usage: {
      input_tokens: data?.usage?.prompt_tokens ?? null,
      output_tokens: data?.usage?.completion_tokens ?? null,
    },
    // El modelo REALMENTE servido puede no ser el titular (cadena `models`).
    model: data?.model || null,
    proveedor: data?.provider || null,
    costo: data?.usage?.cost ?? null,
  };
}

// ── Errores ───────────────────────────────────────────────────────
// 🔴 TRAMPA: cuando el proveedor de abajo tira 429, OpenRouter responde
// **HTTP 200** con un objeto `error` en el body. Verificado el 5-sep-2026. Un
// `if (!res.ok)` a secas da la request por buena y el fallo se disfraza de
// "la IA no devolvió JSON". Hay que mirar SIEMPRE data.error.
export function errorDelCuerpo(data) {
  if (!data || !data.error) return null;
  const e = data.error;
  const codigo = Number(e.code) || 0;
  return {
    codigo,
    mensaje: String(e.message || 'error de OpenRouter'),
    proveedor: e?.metadata?.provider_name || null,
    // 429 (saturado) y 5xx son transitorios. 404 de política de datos NO lo es:
    // reintentar no cambia qué proveedores cumplen la política.
    reintentable: codigo === 429 || (codigo >= 500 && codigo < 600),
    // Sin endpoints que cumplan la política = mala configuración, no mala
    // suerte. Merece un mensaje distinto para no mandar a nadie a "reintentá".
    politicaImposible: codigo === 404 && /data policy/i.test(e.message || ''),
    sinCredito: codigo === 402,
  };
}

function errorOpenRouter(info, status) {
  const err = new Error(`openrouter ${info?.codigo || status || 'sin respuesta'}`);
  err.openrouter = true;
  err.upstreamStatus = info?.codigo || status || 0;
  err.upstreamText = info?.mensaje || '';
  err.politicaImposible = !!info?.politicaImposible;
  err.sinCredito = !!info?.sinCredito;
  return err;
}

// ── Llamada con retry+backoff respetando un deadline compartido ───
// Mismo contrato que anthropicMessages: devuelve el JSON crudo o lanza con
// .upstreamStatus / .upstreamText (o AbortError si se agotó el presupuesto).
export async function openrouterChat(apiKey, body, deadline, { intentos = 2 } = {}) {
  let ultimo = null;
  for (let intento = 0; intento < intentos; intento++) {
    const ctrl = new AbortController();
    const restante = Math.max(deadline - Date.now(), 1000);
    const timer = setTimeout(() => ctrl.abort(), Math.min(60000, restante));
    let upstream = null;
    let fetchErr = null;
    try {
      upstream = await fetch(OPENROUTER_URL, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          // Atribución en el panel de OpenRouter: sirve para ver el consumo por
          // app cuando la misma key se use en otro lado.
          'HTTP-Referer': 'https://jarvex-app.vercel.app',
          'X-Title': 'JARVEX',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      fetchErr = e;
    } finally {
      clearTimeout(timer);
    }

    if (fetchErr) {
      if (fetchErr.name === 'AbortError' || intento === intentos - 1) throw fetchErr;
      const esperaMs = 1500;
      if (Date.now() + esperaMs + 8000 > deadline) throw fetchErr;
      console.warn(`[openrouter] fetch lanzó (${fetchErr.message || fetchErr.name}) — reintento ${intento + 1}`);
      await new Promise((r) => setTimeout(r, esperaMs));
      continue;
    }

    let data = null;
    const txt = await upstream.text().catch(() => '');
    try { data = JSON.parse(txt); } catch { data = null; }

    // El error puede venir con status feo O con 200 (ver la trampa de arriba).
    const info = errorDelCuerpo(data)
      || (upstream.ok ? null : { codigo: upstream.status, mensaje: txt.slice(0, 300), reintentable: upstream.status === 429 || upstream.status >= 500, politicaImposible: false, sinCredito: upstream.status === 402 });

    if (!info) {
      if (!data) throw errorOpenRouter({ codigo: 502, mensaje: 'respuesta no-JSON de OpenRouter' }, 502);
      return data;
    }

    ultimo = info;
    if (!info.reintentable || intento === intentos - 1) break;
    const esperaMs = 2000 * (intento + 1);
    if (Date.now() + esperaMs + 10000 > deadline) break;
    console.warn(`[openrouter] ${info.codigo} (${info.proveedor || 'sin proveedor'}) — reintento ${intento + 1}`);
    await new Promise((r) => setTimeout(r, esperaMs));
  }
  throw errorOpenRouter(ultimo);
}
