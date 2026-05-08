// Vercel serverless function: POST /api/asistente-solicitud-mat
//
// Asistente conversacional de Solicitud de Materiales. Recibe una
// descripción libre del residente + el catálogo de materiales de la
// obra activa + (opcional) histórico de solicitudes y partidas, y
// devuelve una solicitud estructurada lista para revisar.
//
// Body: {
//   descripcion: string,                                    // texto libre del residente
//   materiales_obra: [{id, nombre_material, unidad, stock_actual, stock_minimo, categoria, precio_unitario_estimado}],
//   historico_solicitudes?: [{descripcion, items: [{material_id, nombre_match, cantidad, unidad}]}],
//   partidas_obra?: [{id, codigo_delfin, nombre_partida}],
//   proveedores?: [{id, razon_social, ruc}],
//   fecha_actual?: 'YYYY-MM-DD',
//   nombre_obra?: string,
// }
//
// Returns: {
//   result: {
//     items: [{material_id, nombre_match, cantidad, unidad, precio_estimado, proveedor_sugerido_id?, partida_sugerida_id?, notas, confianza_item, accion: 'usar_existente'|'crear_nuevo', descripcion_libre?}],
//     descripcion_estructurada: string,
//     fecha_necesidad_sugerida: 'YYYY-MM-DD' | null,
//     prioridad_sugerida: 'baja'|'normal'|'alta'|'urgente'
//   },
//   confianza: 0-1,
//   razonamiento: string,
//   advertencias: string[]
// }
//
// Usa Claude Sonnet 4.6 (calidad para razonamiento + matching contra catálogo).
// Requiere ANTHROPIC_API_KEY en Vercel env.

const MAX_MATERIALES = 250;        // límite de materiales que pasamos al prompt
const MAX_HISTORICO = 8;            // últimas N solicitudes para contexto
const MAX_PARTIDAS = 50;
const MAX_PROVEEDORES = 30;
const MAX_DESC_CHARS = 1500;

function buildSystemPrompt() {
  return `Eres un asistente experto en obras de construcción peruana. Tu rol es ayudar al residente o maestro de obra a armar una solicitud de materiales bien estructurada a partir de una descripción libre.

REGLAS CRÍTICAS:
- Recibís: descripción libre + catálogo de materiales del almacén de la obra + (opcional) histórico de solicitudes anteriores + partidas activas + proveedores.
- Devolvés un JSON con la solicitud completa lista para que el residente revise.

== NOMBRE DEL MATERIAL ==
- "nombre_match" debe ser SOLO el nombre del material — NUNCA incluyas cantidad, unidad ni multiplicador en este campo.
  · ✓ CORRECTO: "Cemento Sol Tipo I"
  · ✗ MAL: "Cemento Sol × 200 bls", "Cemento Sol (200 bls)", "200 bls de Cemento"
- La cantidad va EXCLUSIVAMENTE en "cantidad" (number).
- La unidad va EXCLUSIVAMENTE en "unidad" (string corto: "bls", "kg", "m", "und", "m2", "m3", "gal").

== MATCHING ==
- Para cada ítem, intentá matchear con el catálogo:
  · Si existe → "material_id": "<uuid del catálogo>", "accion": "usar_existente"
  · Si NO existe → "material_id": null, "accion": "crear_nuevo", "descripcion_libre": "<nombre completo>"

== CANTIDADES Y CONTEXTO ==
- Sugerí cantidades realistas basadas en el histórico (si hay solicitudes parecidas). Si no hay histórico, estimá conservador con texto del residente.
- Si la descripción menciona una partida específica (ej: "vaciado de losa nivel 3"), tratá de matchear con partidas_obra y poner partida_sugerida_id.
- Sugerí proveedor solo si tenés alta confianza (ej: el material en histórico siempre vino de cierto proveedor).
- Estimá fecha_necesidad_sugerida basado en frases como "esta semana"/"hoy"/"mañana"/"para el lunes".
- Estimá prioridad: si hay urgencia explícita ("urgente", "ya"), si hay parada de obra, etc.

== SOLICITANTE ==
- Si el texto menciona explícitamente quien pidió ("el maestro de obra Juan Pérez solicitó", "lo pide el capataz"), incluilo en "solicitante_detectado". Sino devolvé null.

CONFIANZA:
- 0.85+: descripción clara, todos los items matchean al catálogo, cantidades respaldadas por histórico
- 0.6-0.85: matchea la mayoría pero hay 1-2 dudas (cantidad o proveedor)
- <0.6: descripción ambigua o muchos items sin match → revisión humana obligatoria

ADVERTENCIAS típicas a incluir:
- "Material X tiene stock suficiente, no requiere compra"
- "Cantidad de Y parece alta vs histórico (promedio 50, pedido 200)"
- "Material Z no existe en catálogo — confirmar nombre o crear nuevo"

DEVUELVE SOLO JSON VÁLIDO (sin markdown, sin texto antes/después):
{
  "items": [
    {
      "material_id": "uuid-del-catalogo-o-null",
      "nombre_match": "Cemento Sol Tipo I",
      "cantidad": 200,
      "unidad": "bls",
      "precio_estimado": 28,
      "proveedor_sugerido_id": "uuid-o-null",
      "partida_sugerida_id": "uuid-o-null",
      "notas": "Para 100m² de losa",
      "confianza_item": 0.9,
      "accion": "usar_existente",
      "descripcion_libre": null
    }
  ],
  "descripcion_estructurada": "Materiales para vaciado de losa nivel 3 — semana 18",
  "fecha_necesidad_sugerida": "2026-05-10",
  "prioridad_sugerida": "alta",
  "solicitante_detectado": "Maestro de obra Juan Pérez",
  "confianza": 0.88,
  "razonamiento": "El residente pidió cemento, fierro y agregados típicos de un vaciado de losa. Las cantidades fueron estimadas basadas en 3 solicitudes similares en histórico.",
  "advertencias": [
    "Material 'alambre #16' no figura en catálogo — se sugiere crear nuevo o confirmar si es 'alambre recocido #16'"
  ]
}`;
}

function buildUserMessage(body) {
  const partes = [];
  partes.push(`OBRA ACTUAL: ${body.nombre_obra || '(sin nombre)'}`);
  partes.push(`FECHA HOY: ${body.fecha_actual || new Date().toISOString().slice(0,10)}`);
  partes.push('');
  partes.push('═══ DESCRIPCIÓN LIBRE DEL RESIDENTE ═══');
  partes.push(String(body.descripcion || '').slice(0, MAX_DESC_CHARS));
  partes.push('');

  // Catálogo de materiales (compacto)
  const mats = (Array.isArray(body.materiales_obra) ? body.materiales_obra : []).slice(0, MAX_MATERIALES);
  partes.push(`═══ CATÁLOGO DE MATERIALES DE LA OBRA (${mats.length}) ═══`);
  if (mats.length === 0) {
    partes.push('(catálogo vacío — todos los items deberán crearse como nuevos)');
  } else {
    mats.forEach(m => {
      const stock = m.stock_actual != null ? ` · stock ${m.stock_actual}` : '';
      const min = m.stock_minimo != null ? ` · mín ${m.stock_minimo}` : '';
      const precio = m.precio_unitario_estimado != null ? ` · ~${m.precio_unitario_estimado} S/` : '';
      const cat = m.categoria ? ` [${m.categoria}]` : '';
      partes.push(`  ${m.id} | ${m.nombre_material} (${m.unidad || '?'})${cat}${stock}${min}${precio}`);
    });
  }
  partes.push('');

  // Partidas (opcional, ayuda con partida_sugerida_id)
  const parts = (Array.isArray(body.partidas_obra) ? body.partidas_obra : []).slice(0, MAX_PARTIDAS);
  if (parts.length > 0) {
    partes.push(`═══ PARTIDAS ACTIVAS DE LA OBRA (${parts.length}) ═══`);
    parts.forEach(p => {
      partes.push(`  ${p.id} | ${p.codigo_delfin || ''} ${p.nombre_partida || ''}`);
    });
    partes.push('');
  }

  // Histórico (opcional, ayuda con cantidades + proveedor)
  const hist = (Array.isArray(body.historico_solicitudes) ? body.historico_solicitudes : []).slice(0, MAX_HISTORICO);
  if (hist.length > 0) {
    partes.push(`═══ ÚLTIMAS SOLICITUDES DE LA MISMA OBRA (${hist.length}) — para referencia de cantidades típicas ═══`);
    hist.forEach((h, i) => {
      partes.push(`Solicitud ${i+1}: "${(h.descripcion || '').slice(0, 100)}"`);
      (h.items || []).slice(0, 12).forEach(it => {
        partes.push(`  - ${it.nombre_match || '?'} × ${it.cantidad} ${it.unidad || ''}`);
      });
    });
    partes.push('');
  }

  // Proveedores (opcional)
  const provs = (Array.isArray(body.proveedores) ? body.proveedores : []).slice(0, MAX_PROVEEDORES);
  if (provs.length > 0) {
    partes.push(`═══ PROVEEDORES DISPONIBLES (${provs.length}) ═══`);
    provs.forEach(p => {
      partes.push(`  ${p.id} | ${p.razon_social || p.nombre || '?'}${p.ruc ? ` (RUC ${p.ruc})` : ''}`);
    });
    partes.push('');
  }

  partes.push('═══ TAREA ═══');
  partes.push('Devolvé el JSON estructurado con la solicitud completa.');
  return partes.join('\n');
}

import { requireAuth, rateLimit, sanitizeError } from '../lib/api-helpers.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Solo POST' });
  }

  try {
    await requireAuth(req);
    rateLimit(req, { windowMs: 60_000, max: 30 });
  } catch (e) {
    const s = sanitizeError(e, 'No autorizado');
    return res.status(s.status).json(s.body);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'ANTHROPIC_API_KEY no configurada en Vercel.',
    });
  }

  const body = req.body || {};
  const descripcion = String(body.descripcion || '').trim();
  if (!descripcion || descripcion.length < 5) {
    return res.status(422).json({ error: 'Descripción muy corta o vacía (mín 5 caracteres)' });
  }
  if (descripcion.length > MAX_DESC_CHARS) {
    return res.status(422).json({ error: `Descripción muy larga (máx ${MAX_DESC_CHARS} caracteres)` });
  }

  const userMessage = buildUserMessage(body);

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      const errText = await upstream.text();
      const status = upstream.status;
      let userMsg = `Claude respondió ${status}`;
      if (status === 401) userMsg = 'Token Anthropic inválido — revisar ANTHROPIC_API_KEY';
      else if (status === 429) userMsg = 'Cuota Anthropic agotada o rate limit — esperá 1 min y reintentá';
      else if (status === 529) userMsg = 'Anthropic sobrecargado — reintentá en unos segundos';
      console.error('[asistente-solicitud-mat] upstream error:', status, errText.slice(0, 200));
      const isProd = process.env.NODE_ENV === 'production';
      return res.status(status).json({
        error: userMsg,
        ...(isProd ? {} : { detail: errText.slice(0, 400) }),
      });
    }

    const data = await upstream.json();
    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(502).json({ error: 'Claude no devolvió JSON parseable', rawText: text.slice(0, 400) });
    }

    let parsed;
    try { parsed = JSON.parse(jsonMatch[0]); }
    catch (e) {
      return res.status(502).json({ error: 'JSON inválido de Claude', detail: e.message });
    }

    // ── Normalizar respuesta defensivamente ──
    // Validar contra el catálogo: si Claude inventó un material_id, descartarlo.
    const materialIds = new Set((body.materiales_obra || []).map(m => m.id));
    const partidaIds = new Set((body.partidas_obra || []).map(p => p.id));
    const provIds = new Set((body.proveedores || []).map(p => p.id));

    // Sanea defensivamente el nombre por si Claude igual mete cantidad/unidad
    // pegada (ej: "Cemento Sol × 200 bls" → "Cemento Sol").
    const limpiarNombre = (s) => String(s || '')
      .replace(/\s*[×x]\s*\d+(\.\d+)?\s*(bls|kg|m2|m3|m|und|gal|hr|pza|pza?s)?\b/gi, '')
      .replace(/\s*[\(\[]\s*\d+(\.\d+)?\s*(bls|kg|m2|m3|m|und|gal|hr|pza|pza?s)?\s*[\)\]]/gi, '')
      .replace(/\s*[-–—]\s*\d+(\.\d+)?\s*(bls|kg|m2|m3|m|und|gal|hr|pza|pza?s)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    const itemsRaw = Array.isArray(parsed.items) ? parsed.items : [];
    const items = itemsRaw.slice(0, 100).map((it) => {
      const mid = it.material_id && materialIds.has(it.material_id) ? it.material_id : null;
      const pid = it.partida_sugerida_id && partidaIds.has(it.partida_sugerida_id) ? it.partida_sugerida_id : null;
      const provid = it.proveedor_sugerido_id && provIds.has(it.proveedor_sugerido_id) ? it.proveedor_sugerido_id : null;
      const accion = mid ? (it.accion === 'crear_nuevo' ? 'usar_existente' : (it.accion || 'usar_existente')) : 'crear_nuevo';
      const cant = Number(it.cantidad);
      return {
        material_id: mid,
        nombre_match: limpiarNombre(it.nombre_match || it.descripcion_libre || '(sin nombre)').slice(0, 120),
        cantidad: Number.isFinite(cant) && cant > 0 ? cant : 1,
        unidad: String(it.unidad || 'und').slice(0, 20),
        precio_estimado: Number(it.precio_estimado) || 0,
        proveedor_sugerido_id: provid,
        partida_sugerida_id: pid,
        notas: String(it.notas || '').slice(0, 300),
        confianza_item: typeof it.confianza_item === 'number' ? Math.max(0, Math.min(1, it.confianza_item)) : 0.5,
        accion,
        descripcion_libre: !mid ? limpiarNombre(it.descripcion_libre || it.nombre_match || '').slice(0, 200) : null,
      };
    });

    const confianza = typeof parsed.confianza === 'number' ? Math.max(0, Math.min(1, parsed.confianza)) : 0.5;
    const advertencias = Array.isArray(parsed.advertencias) ? parsed.advertencias.slice(0, 10).map(a => String(a).slice(0, 200)) : [];
    const prioridadValida = ['baja', 'normal', 'alta', 'urgente'];
    const prioridad = prioridadValida.includes(parsed.prioridad_sugerida) ? parsed.prioridad_sugerida : 'normal';

    return res.status(200).json({
      result: {
        items,
        descripcion_estructurada: String(parsed.descripcion_estructurada || descripcion).slice(0, 300),
        fecha_necesidad_sugerida: parsed.fecha_necesidad_sugerida || null,
        prioridad_sugerida: prioridad,
        solicitante_detectado: parsed.solicitante_detectado ? String(parsed.solicitante_detectado).slice(0, 120) : null,
      },
      confianza,
      razonamiento: String(parsed.razonamiento || '').slice(0, 600),
      advertencias,
      _model: data.model,
      _usage: data.usage,
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'Claude tardó demasiado (>60s) — descripción muy larga o catálogo gigante' });
    }
    return res.status(502).json({ error: 'Error consultando Claude', detail: e.message });
  }
}
