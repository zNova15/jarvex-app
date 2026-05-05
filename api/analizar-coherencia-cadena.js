// Vercel serverless: POST /api/analizar-coherencia-cadena
//
// Analiza si la cadena de trazabilidad tiene SENTIDO desde el punto de vista
// del rubro/giro de cada empresa vs los materiales que se están comprando.
// Detecta incoherencias que SUNAT podría auditar (ej: "Inversiones Comida SAC"
// vendiendo clavos a "Constructora").
//
// Body: {
//   items: [{ descripcion, unidad, cantidad, precio_unit }],
//   eslabones: [{ company_id, name, rol_grupo, rubro, posicion }],
//   proveedor_externo: { nombre, ruc, rubro? },
//   precio_compra: number,
//   precio_objetivo: number,
// }
//
// Returns: {
//   resultado: 'ok' | 'advertencia' | 'incoherente',
//   confianza: 0..1,
//   resumen: string,                  // 1 párrafo conclusión
//   hallazgos: [
//     {
//       severidad: 'alta' | 'media' | 'baja',
//       empresa: string,
//       material: string,
//       motivo: string,                // por qué está mal
//       sugerencia: string,            // qué debería hacer el user
//     }
//   ],
//   advertencias_sunat: [string],
// }

import { requireAuth, rateLimit, sanitizeError, sanitizeForPrompt } from './_lib.js';

function buildSystemPrompt() {
  return `Eres un auditor experto en compliance tributario peruano (SUNAT) y planificación de cadenas intercompany. Tu trabajo es analizar si una cadena de transferencia interna de materiales tiene COHERENCIA económica y fiscal.

Una cadena coherente tiene:
- Empresas cuyo giro/rubro está relacionado con los materiales que compran/venden.
- Markups razonables entre eslabones (no 1000%, no 0%).
- Una secuencia lógica desde proveedor externo hasta ejecutora.

Una cadena INCOHERENTE puede levantar banderas rojas en SUNAT por simulación de operaciones:
- Una empresa con rubro "alimentos" comprando materiales de construcción.
- Una empresa con rubro "consultoría" actuando como mayorista de fierro.
- Markups desproporcionados sin justificación de servicio agregado.
- Empresa intermedia sin actividad comercial real.

Sé directo, sin palabras suaves. Si detectás un problema, decilo. El usuario es un constructor peruano que necesita advertencias claras, no diplomacia.

Devolvés SOLO JSON válido (sin markdown):
{
  "resultado": "ok" | "advertencia" | "incoherente",
  "confianza": 0.85,
  "resumen": "1-2 oraciones de conclusión general",
  "hallazgos": [
    {
      "severidad": "alta",
      "empresa": "Inversiones Comida SAC",
      "material": "Fierro corrugado 1/2\\"",
      "motivo": "Esta empresa tiene rubro 'comercio de alimentos' (RUC consultado). No tiene actividad económica registrada para venta de materiales de construcción.",
      "sugerencia": "Sacala de la cadena. Buscá una empresa del grupo cuyo rubro sea 'distribuidora de materiales' o 'ferretería'. Si insistís en usarla, SUNAT puede recalificar la operación como simulada."
    }
  ],
  "advertencias_sunat": [
    "Markup acumulado de 400% (5 → 25 PEN/kg) sin servicio agregado claro. SUNAT puede aplicar art. 32 de la Ley de IR."
  ]
}

Niveles:
- "ok" = todo cuadra, no hay problemas detectables.
- "advertencia" = hay algo subóptimo pero no necesariamente ilegal.
- "incoherente" = al menos un hallazgo de severidad "alta". Riesgo de auditoría SUNAT.

Confianza:
- 0.85+ = la incoherencia es clara con los datos provistos.
- 0.6-0.85 = sospecha fundada pero falta info (ej: rubro vacío en alguna empresa).
- <0.6 = no se puede emitir juicio confiable.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  try {
    await requireAuth(req);
    rateLimit(req, { windowMs: 60_000, max: 20 });
  } catch (e) {
    const s = sanitizeError(e, 'No autorizado');
    return res.status(s.status).json(s.body);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY no configurada' });

  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  const eslabones = Array.isArray(body.eslabones) ? body.eslabones : [];
  const proveedorExterno = body.proveedor_externo || {};
  const precioCompra = Number(body.precio_compra) || 0;
  const precioObjetivo = Number(body.precio_objetivo) || 0;

  if (eslabones.length < 2) return res.status(422).json({ error: 'Mínimo 2 eslabones' });
  if (items.length === 0) return res.status(422).json({ error: 'Debe haber al menos 1 item' });

  const itemsDesc = items.map(it =>
    `- ${sanitizeForPrompt(it.descripcion, 100)} (${it.cantidad} ${sanitizeForPrompt(it.unidad, 10)}, ${precioCompra} PEN/u)`
  ).join('\n');

  const eslabonesDesc = eslabones.map((e, i) =>
    `${i + 1}. [${sanitizeForPrompt(e.posicion, 30)}] ${sanitizeForPrompt(e.name, 100)} — rubro: ${sanitizeForPrompt(e.rubro || e.rol_grupo, 80) || 'NO DECLARADO'}`
  ).join('\n');

  const userMessage = [
    `# Cadena de trazabilidad a auditar`,
    ``,
    `## Materiales / servicios:`,
    itemsDesc,
    ``,
    `## Proveedor externo (origen):`,
    `- ${sanitizeForPrompt(proveedorExterno.nombre, 100) || '(no especificado)'} (RUC: ${sanitizeForPrompt(proveedorExterno.ruc, 11) || '?'})`,
    proveedorExterno.rubro ? `- Rubro: ${sanitizeForPrompt(proveedorExterno.rubro, 80)}` : '',
    ``,
    `## Cadena de empresas:`,
    eslabonesDesc,
    ``,
    `## Precios:`,
    `- Precio de compra al proveedor externo: ${precioCompra} PEN/unidad`,
    `- Precio objetivo final (lo que paga la ejecutora): ${precioObjetivo} PEN/unidad`,
    `- Markup total: ${precioCompra > 0 ? (((precioObjetivo - precioCompra) / precioCompra) * 100).toFixed(1) : 0}%`,
    ``,
    `Analizá y devolvé el JSON con tu evaluación. Sé directo: si hay incoherencia rubro/material, dilo claro.`,
  ].filter(Boolean).join('\n');

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
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
        max_tokens: 2000,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error('[analizar-coherencia] upstream error:', upstream.status, errText.slice(0, 200));
      const isProd = process.env.NODE_ENV === 'production';
      return res.status(upstream.status).json({
        error: `Claude respondió ${upstream.status}`,
        ...(isProd ? {} : { detail: errText.slice(0, 400) }),
      });
    }

    const data = await upstream.json();
    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(502).json({ error: 'Claude no devolvió JSON parseable', rawText: text.slice(0, 400) });

    let parsed;
    try { parsed = JSON.parse(jsonMatch[0]); }
    catch (e) { return res.status(502).json({ error: 'JSON inválido de Claude', detail: e.message }); }

    return res.status(200).json({
      resultado: ['ok', 'advertencia', 'incoherente'].includes(parsed.resultado) ? parsed.resultado : 'advertencia',
      confianza: typeof parsed.confianza === 'number' ? Math.max(0, Math.min(1, parsed.confianza)) : 0.5,
      resumen: String(parsed.resumen || '').slice(0, 500),
      hallazgos: Array.isArray(parsed.hallazgos) ? parsed.hallazgos.slice(0, 10) : [],
      advertencias_sunat: Array.isArray(parsed.advertencias_sunat) ? parsed.advertencias_sunat.slice(0, 5) : [],
      _model: data.model,
      _usage: data.usage,
    });
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Claude tardó demasiado (>30s)' });
    return res.status(502).json({ error: 'Error consultando Claude', detail: e.message });
  }
}
