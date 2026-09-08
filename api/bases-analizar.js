// ═══════════════════════════════════════════════════════════════════
// JARVEX — ANÁLISIS DE BASES DE LICITACIÓN (tanda 15, entrega 3).
//
// Endpoint PROPIO, separado de /api/captura-magica por decisión de Gabriel
// (8-set-2026) y porque son problemas distintos:
//
//   Captura Mágica : 1 comprobante nítido, 1 llamada, 1 formulario de 12 campos.
//   Análisis de bases: 96 páginas de las que 8 sirven, en tandas, con un índice
//                      armado por código y dos pasadas cortas encima.
//
// POR QUÉ EL OCR ESTÁ DUPLICADO Y NO IMPORTADO
// `mistralOcr()` vive dentro de api/captura-magica.js como función privada.
// Sacarla a /lib para compartirla sería lo prolijo, pero obliga a editar el
// archivo del que depende TODO el ingreso de comprobantes del grupo — la
// herramienta que más se usa. El costo de duplicar 40 líneas estables es una
// tarde; el de romper Captura Mágica es que nadie factura. Se duplica a
// propósito, y si algún día hay que tocar las dos, este comentario lo dice.
// Lo que sí se comparte es `lib/mistral-ocr.js`: la REGLA del snapshot fijo
// (nunca un alias móvil) es una sola para toda la app.
//
// ACCIONES (una sola función, tres pasos del mismo trabajo):
//   'ocr'       → { paginas:[{n, imagen}] }        → texto por página
//   'localizar' → { indice }                       → en qué páginas está cada cosa
//   'extraer'   → { texto, seccion }               → los requisitos, con su cita
//
// El cliente manda las páginas de a poco: 96 páginas rasterizadas no entran en
// un request (Vercel corta ~4,5 MB) ni en 60 segundos de función.
// ═══════════════════════════════════════════════════════════════════

import { requireAuth, rateLimit, sanitizeError } from '../lib/api-helpers.js';
import { modeloOcr } from '../lib/mistral-ocr.js';
import { leerConfig, construirCuerpo, openrouterChat, normalizarRespuesta } from '../lib/openrouter.js';

export const maxDuration = 60;

const MISTRAL_OCR_URL = 'https://api.mistral.ai/v1/ocr';
// Mismo criterio que Captura Mágica: snapshot fijo. Un alias móvil ya duplicó
// el precio una vez sin que nadie lo decidiera (16-jul-2026).
const OCR = modeloOcr(process.env);

/** Quién puede analizar unas bases: el mismo trío que ve el módulo (mig 197). */
const ROLES = ['admin', 'gerente', 'licitaciones'];

// Tope por tanda. 6 páginas a 150 dpi en JPEG rondan 1,8 MB en base64 — bien
// por debajo del corte de la plataforma, y entran en el minuto de la función.
const MAX_PAGINAS_TANDA = 6;
const MAX_BASE64_PAGINA = 3 * 1024 * 1024;
const MAX_TEXTO_PASADA = 120_000;   // ~30k tokens: un rango de páginas, no el documento

// ── Los prompts. Su versión larga y comentada vive en
//    docs/prompt-extraccion-bases.md, que es el documento que se revisa
//    cuando una extracción sale mal. ──────────────────────────────────

const SYSTEM_LOCALIZAR = `Eres un analista de licitaciones públicas peruanas (Ley de Contrataciones del Estado y obras por impuestos).

Te doy un ÍNDICE de coincidencias que ya encontró un programa dentro de un documento de bases. Cada línea trae la página y el renglón donde cayó.

Tu ÚNICA tarea es decidir, para cada familia, QUÉ RANGO DE PÁGINAS hay que leer en detalle. No extraes datos todavía.

REGLAS:
- Elige rangos CORTOS y contiguos (de 1 a 12 páginas). Un rango de 40 páginas no sirve: significa que no lo encontraste.
- Si una familia no está en el índice, devuélvela con "encontrada": false y rango null. NO inventes páginas.
- Un rótulo en el índice de contenidos (una línea suelta con puntos y un número) NO es la sección: es su referencia. Prefiere la página donde el rótulo aparece con texto alrededor.
- Puedes devolver hasta 2 rangos por familia si la sección está partida.

Responde SOLO con este JSON, sin markdown:
{
  "personal":     { "encontrada": true, "rangos": [{"desde": 41, "hasta": 47}], "por_que": "..." },
  "empresa":      { "encontrada": true, "rangos": [{"desde": 48, "hasta": 50}], "por_que": "..." },
  "cronograma":   { "encontrada": true, "rangos": [{"desde": 12, "hasta": 13}], "por_que": "..." },
  "evaluacion":   { "encontrada": false, "rangos": [], "por_que": "no aparece en el índice" },
  "presentacion": { "encontrada": true, "rangos": [{"desde": 30, "hasta": 36}], "por_que": "..." },
  "proceso":      { "encontrada": true, "rangos": [{"desde": 1, "hasta": 4}], "por_que": "..." }
}`;

const SYSTEM_EXTRAER = `Eres un analista de licitaciones públicas peruanas. Te doy el TEXTO de unas páginas de las bases (con marcadores "<!-- página N -->") y extraes los requisitos EXACTAMENTE como están escritos.

LA REGLA QUE MANDA SOBRE TODAS: cada dato que devuelvas debe venir con "fuente_cita", que es una frase COPIADA LITERAL del texto que te di —palabra por palabra, sin corregir, sin resumir y sin traducir— y con "fuente_pagina", el número del marcador de página donde está esa frase. Un programa va a buscar esa frase en el documento: si no aparece tal cual, el dato se descarta y alguien tiene que revisarlo a mano. NO inventes una cita para acompañar un dato que dedujiste.

QUÉ ES CADA CAMPO (son cinco criterios distintos y se confunden entre sí):
- "meses_minimos": experiencia ESPECÍFICA mínima en el cargo, en MESES. "03 años" = 36.
- "meses_generales_minimos": experiencia GENERAL (desde la colegiatura), en MESES. Es otro número; si las bases solo piden uno, deja el otro en 0.
- "participaciones_minimas": cuántas obras/servicios distintos exige. "mínimo 02 participaciones" = 2. Ojo: DOS obras simultáneas son UNA suma de meses pero DOS participaciones.
- "meses_por_participacion": duración mínima de CADA participación. "no menor a 02 meses cada participación" = 2.
- "ventana_anios": "en los últimos 10 años" = 10. Sin ventana, null.
- "cargos_equivalentes": la lista de cargos que las bases aceptan como equivalentes ("Residente de obra y/o Supervisor de obra y/o Inspector..."). Cópialos todos.

DISTINGUE REQUISITO DE FACTOR DE EVALUACIÓN. Un REQUISITO DE CALIFICACIÓN es obligatorio: no cumplirlo descalifica. Un FACTOR DE EVALUACIÓN da puntaje: no cumplirlo solo resta puntos. Van a listas distintas y confundirlos es el error más caro de este trabajo.

NO INVENTES:
- Si las bases no dicen un número, el campo va en 0 o null. Nunca en un valor "típico".
- Si un puesto se nombra pero sus requisitos están en otra página que no te di, ponlo en "alertas" y no lo inventes.
- Si el texto viene de un OCR y una cifra es ilegible, dilo en "alertas".

Responde SOLO con este JSON, sin markdown:
{
  "proceso": { "nomenclatura": null, "objeto": null, "entidad_convocante": null, "entidad_ruc": null, "valor_referencial": null, "moneda": "PEN", "fecha_presentacion": null, "definicion_obras_similares": null },
  "requisitos": [
    { "clase": "personal", "cargo": "Jefe de Supervisión del Proyecto", "profesion": "Ingeniero Civil",
      "meses_minimos": 36, "meses_generales_minimos": 0, "participaciones_minimas": 2,
      "meses_por_participacion": 2, "ventana_anios": 10,
      "cargos_equivalentes": ["Residente de obra", "Supervisor de obra"],
      "exige_colegiatura": true, "exige_sustento": true,
      "fuente_pagina": 47, "fuente_cita": "Experiencia no menor de 03 años, sustentada con...", "notas": null }
  ],
  "factores_evaluacion": [ { "factor": "...", "puntaje_maximo": 20, "fuente_pagina": 51, "fuente_cita": "..." } ],
  "cronograma": [ { "etapa": "Presentación de ofertas", "fecha": "2026-10-15", "fuente_pagina": 12, "fuente_cita": "..." } ],
  "alertas": ["lo que una persona tiene que revisar"]
}`;

// ── Mistral OCR de UNA página (imagen). Ver el comentario de arriba sobre
//    por qué está duplicado y no importado. ──────────────────────────
async function ocrDeImagen(base64, mimeType, apiKey, deadline) {
  const dataUri = `data:${mimeType};base64,${base64}`;
  const body = { model: OCR.modelo, document: { type: 'image_url', image_url: dataUri }, include_image_base64: false };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(30000, Math.max(deadline - Date.now(), 1000)));
  // Sin `= null`: si el fetch lanza, el error sube y nadie lee la variable.
  let upstream;
  try {
    upstream = await fetch(MISTRAL_OCR_URL, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
  } finally { clearTimeout(timer); }
  if (!upstream || !upstream.ok) {
    const err = new Error(`mistral ocr ${upstream ? upstream.status : 'sin respuesta'}`);
    if (upstream) err.upstreamStatus = upstream.status;
    throw err;
  }
  const data = await upstream.json();
  const pages = Array.isArray(data?.pages) ? data.pages : [];
  return pages.map(p => (typeof p?.markdown === 'string' ? p.markdown : ''))
    .join('\n\n').replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
}

/** El JSON de la respuesta, venga pelado o envuelto en ```json. */
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

async function pasadaDeTexto({ system, user, deadline, maxTokens }) {
  const cfg = leerConfig(process.env);
  if (!cfg.activo) {
    const err = new Error('El motor de texto no está configurado (falta OPENROUTER_API_KEY)');
    err.status = 503; err.code = 'ia_no_configurada';
    throw err;
  }
  const body = construirCuerpo({
    modelo: cfg.modelo, respaldos: cfg.respaldos, politica: cfg.politica,
    system, user, maxTokens,
  });
  const data = await openrouterChat(cfg.apiKey, body, deadline);
  const r = normalizarRespuesta(data);
  // `normalizarRespuesta` devuelve la forma de Anthropic (content[]), no un
  // texto pelado: es la misma que ya consume Captura Mágica.
  const texto = r.content?.[0]?.text || '';
  return {
    json: jsonDeTexto(texto),
    texto,
    // El modelo REALMENTE servido, que con una cadena de respaldos puede no ser
    // el titular. Se devuelve al cliente y se guarda: cuando una extracción
    // salga mal hay que saber quién la hizo.
    model: r.model || cfg.modelo,
    usage: r.usage || null,
    // OpenRouter informa el costo real de la llamada. Con un gratuito es 0, y
    // ese 0 es un dato medido, no un supuesto.
    costo: r.costo,
    cortado: r.stop_reason === 'max_tokens',
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const { profile } = await requireAuth(req);
    if (!ROLES.includes(profile?.rol)) {
      return res.status(403).json({ error: 'Solo licitaciones, gerencia o administración pueden analizar bases' });
    }
    // Una base de 96 páginas son ~16 tandas de OCR más 2 pasadas: el tope deja
    // pasar dos documentos completos por minuto y corta el abuso.
    rateLimit(req, { windowMs: 60_000, max: 40, key: `bases:${profile?.id || 'anon'}` });

    const body = req.body || {};
    const accion = String(body.accion || '').trim();
    const deadline = Date.now() + 52_000;

    // ── OCR de una tanda de páginas ────────────────────────────────
    if (accion === 'ocr') {
      const apiKey = process.env.MISTRAL_API_KEY;
      if (!apiKey) return res.status(503).json({ error: 'El OCR no está configurado (falta MISTRAL_API_KEY)', code: 'ia_no_configurada' });

      const paginas = Array.isArray(body.paginas) ? body.paginas : [];
      if (!paginas.length) return res.status(422).json({ error: 'No mandaste páginas' });
      if (paginas.length > MAX_PAGINAS_TANDA) {
        return res.status(422).json({ error: `Máximo ${MAX_PAGINAS_TANDA} páginas por tanda` });
      }

      const textos = {};
      const fallidas = [];
      for (const p of paginas) {
        const clave = String(p?.clave || `pdf:p${p?.n}`);
        const mime = String(p?.mimeType || 'image/jpeg');
        if (!/^image\/(jpeg|png|webp)$/.test(mime)) { fallidas.push({ clave, motivo: 'tipo no permitido' }); continue; }
        const b64 = String(p?.imagen || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
        if (!b64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) { fallidas.push({ clave, motivo: 'imagen inválida' }); continue; }
        if (b64.length > MAX_BASE64_PAGINA) { fallidas.push({ clave, motivo: 'página demasiado pesada' }); continue; }
        // Si se acabó el tiempo, se devuelve lo hecho y el cliente reintenta el
        // resto: una tanda a medias es recuperable, un 504 no dice qué se leyó.
        if (Date.now() > deadline - 6000) { fallidas.push({ clave, motivo: 'sin tiempo en esta tanda' }); continue; }
        try {
          textos[clave] = await ocrDeImagen(b64, mime, apiKey, deadline);
        } catch (e) {
          fallidas.push({ clave, motivo: e?.upstreamStatus ? `OCR ${e.upstreamStatus}` : 'OCR falló' });
        }
      }
      return res.status(200).json({
        textos, fallidas, model: OCR.modelo,
        paginasLeidas: Object.keys(textos).length,
      });
    }

    // ── Pase 1: dónde está cada cosa ───────────────────────────────
    if (accion === 'localizar') {
      const indice = body.indice && typeof body.indice === 'object' ? body.indice : null;
      if (!indice) return res.status(422).json({ error: 'Falta el índice' });
      const comoTexto = JSON.stringify(indice).slice(0, 60_000);
      const r = await pasadaDeTexto({
        system: SYSTEM_LOCALIZAR,
        user: `ÍNDICE DE COINCIDENCIAS (página → renglón encontrado):\n${comoTexto}\n\nDevuelve el JSON de rangos.`,
        deadline, maxTokens: 1200,
      });
      if (!r.json) return res.status(502).json({ error: 'El modelo no devolvió un JSON de rangos legible', code: 'respuesta_ilegible' });
      return res.status(200).json({ rangos: r.json, model: r.model, usage: r.usage, costo: r.costo });
    }

    // ── Pase 2: los requisitos, con su cita ────────────────────────
    if (accion === 'extraer') {
      const texto = String(body.texto || '');
      if (!texto.trim()) return res.status(422).json({ error: 'No mandaste texto para extraer' });
      if (texto.length > MAX_TEXTO_PASADA) {
        return res.status(422).json({ error: `El rango es demasiado grande (${texto.length} caracteres). Achica el rango de páginas.` });
      }
      const r = await pasadaDeTexto({
        system: SYSTEM_EXTRAER,
        user: `TEXTO DE LAS BASES:\n\n${texto}\n\nExtrae el JSON. Recuerda: cada dato con su cita literal y su página.`,
        deadline, maxTokens: 4000,
      });
      if (r.cortado) {
        return res.status(422).json({
          error: 'La respuesta se cortó por tamaño: el rango de páginas tiene demasiado contenido. Analiza un rango más corto.',
          code: 'respuesta_cortada',
        });
      }
      if (!r.json) return res.status(502).json({ error: 'El modelo no devolvió un JSON legible', code: 'respuesta_ilegible' });
      return res.status(200).json({ resultado: r.json, model: r.model, usage: r.usage, costo: r.costo });
    }

    return res.status(422).json({ error: `Acción desconocida: "${accion}"` });
  } catch (err) {
    // sanitizeError ya trae el {status, body} correcto y no filtra detalles
    // upstream en producción. Los errores propios (401/403/429) viajan por acá
    // con su mensaje intacto porque llevan la marca _httpError.
    const { status, body } = sanitizeError(err, 'No se pudo analizar las bases');
    if (err?.code) body.code = err.code;
    return res.status(status).json(body);
  }
}
