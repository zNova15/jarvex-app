// Vercel serverless: POST /api/sugerir-cadena-trazabilidad
//
// Sugiere distribución de precios entre eslabones de una cadena intercompany.
//
// Body: {
//   precio_compra: number,         // lo que paga la empresa primaria al proveedor
//   precio_objetivo: number,       // lo que termina pagando la ejecutora
//   cantidad: number,
//   moneda?: 'PEN' | 'USD',
//   eslabones: [
//     { company_id, name, rol_grupo, margen_objetivo_pct?, posicion: 'primaria'|'secundaria'|'ejecutora' },
//     ...
//   ],
//   item_nombre?: string,
// }
//
// Returns: {
//   result: {
//     pasos: [
//       { posicion, company_id, name, precio_unit_compra, precio_unit_venta, markup_pct, margen_real_pct }
//     ],
//     resumen: { precio_inicial, precio_final, ganancia_total, markup_total_pct }
//   },
//   confianza: 0-1,
//   razonamiento: string,
//   advertencias: string[]
// }
//
// Modelo: Claude Sonnet 4.6.

function buildSystemPrompt() {
  return `Eres un experto en finanzas corporativas y planificación tributaria peruana. Tu trabajo es distribuir el markup entre N empresas del mismo grupo económico que forman una cadena de transferencia interna de materiales.

Restricciones críticas:
- Cada empresa intermedia debe AÑADIR margen positivo (no puede vender por debajo del costo de compra de su eslabón anterior).
- El margen total entre primer comprador (primaria) y último (ejecutora) debe coincidir con el del usuario.
- Respetá los márgenes objetivo de cada empresa si los proporcionó. Si no, distribuí razonablemente proporcional al peso de cada eslabón.
- Si el "precio_objetivo" es MENOR que el "precio_compra", devolvé advertencia y NO sugieras precios negativos: aplicá margen mínimo 1% y dejá una pérdida en advertencias.
- La empresa primaria es quien compra al proveedor externo (su precio_unit_compra = precio_compra). La empresa ejecutora es la última (su precio_unit_venta = precio_objetivo, aunque internamente la pagamos como precio_unit_compra).
- Para empresas mixtas/secundarias, el margen típico es 5-15%. Para "primaria" (origen) suele ser 3-8%.

Devolvés SOLO JSON válido (sin markdown):
{
  "pasos": [
    {
      "posicion": "primaria",
      "company_id": "...",
      "name": "...",
      "precio_unit_compra": 5.00,
      "precio_unit_venta": 5.40,
      "markup_pct": 8.0,
      "margen_real_pct": 7.4
    },
    ...
  ],
  "resumen": {
    "precio_inicial": 5.00,
    "precio_final": 15.00,
    "ganancia_total": 10.00,
    "markup_total_pct": 200
  },
  "confianza": 0.85,
  "razonamiento": "Distribuí 200% de markup en 3 saltos: primaria 8%, secundaria 80%, ejecutora 54%...",
  "advertencias": []
}

Confianza:
- 0.85+: márgenes balanceados, totales coinciden, sin distorsiones grandes
- 0.6-0.85: hubo que comprimir o ajustar para que cuadre
- <0.6: el precio objetivo no permite distribución limpia (precio_objetivo < precio_compra, o márgenes objetivo imposibles)`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY no configurada' });

  const body = req.body || {};
  const precioCompra = Number(body.precio_compra);
  const precioObjetivo = Number(body.precio_objetivo);
  const cantidad = Number(body.cantidad) || 1;
  const moneda = body.moneda === 'USD' ? 'USD' : 'PEN';
  const eslabones = Array.isArray(body.eslabones) ? body.eslabones : [];
  const itemNombre = String(body.item_nombre || '').slice(0, 200);

  if (!precioCompra || precioCompra <= 0) return res.status(422).json({ error: 'precio_compra inválido' });
  if (!precioObjetivo || precioObjetivo <= 0) return res.status(422).json({ error: 'precio_objetivo inválido' });
  if (eslabones.length < 2) return res.status(422).json({ error: 'Se necesitan al menos 2 eslabones (primaria + ejecutora)' });

  const eslabonesDesc = eslabones.map((e, i) =>
    `${i + 1}. [${e.posicion}] ${e.name} (id=${e.company_id}, rol=${e.rol_grupo || '—'}, margen objetivo: ${e.margen_objetivo_pct ?? '—'}%)`
  ).join('\n');

  const userMessage = [
    `Item: ${itemNombre || '(sin nombre)'}, cantidad ${cantidad} (moneda ${moneda})`,
    `Precio de compra al proveedor externo: ${moneda} ${precioCompra} por unidad`,
    `Precio objetivo final que paga la ejecutora: ${moneda} ${precioObjetivo} por unidad`,
    ``,
    `Eslabones de la cadena (en orden):`,
    eslabonesDesc,
    ``,
    `Distribuí el markup total entre los eslabones intermedios. Devolvé el JSON con la sugerencia.`,
  ].join('\n');

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
        max_tokens: 1500,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(upstream.status).json({
        error: `Claude respondió ${upstream.status}`,
        detail: errText.slice(0, 400),
      });
    }

    const data = await upstream.json();
    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(502).json({ error: 'Claude no devolvió JSON parseable', rawText: text.slice(0, 400) });

    let parsed;
    try { parsed = JSON.parse(jsonMatch[0]); }
    catch (e) { return res.status(502).json({ error: 'JSON inválido de Claude', detail: e.message }); }

    // Validar shape mínimo
    const pasos = Array.isArray(parsed.pasos) ? parsed.pasos : [];
    if (pasos.length !== eslabones.length) {
      return res.status(502).json({ error: 'Claude devolvió cantidad de pasos distinta a la esperada', detail: `esperados ${eslabones.length}, recibidos ${pasos.length}` });
    }

    return res.status(200).json({
      result: {
        pasos: pasos.map((p, i) => ({
          posicion: p.posicion || eslabones[i].posicion,
          company_id: eslabones[i].company_id,
          name: eslabones[i].name,
          precio_unit_compra: Number(p.precio_unit_compra) || 0,
          precio_unit_venta: Number(p.precio_unit_venta) || 0,
          markup_pct: Number(p.markup_pct) || 0,
          margen_real_pct: Number(p.margen_real_pct) || 0,
        })),
        resumen: {
          precio_inicial: precioCompra,
          precio_final: precioObjetivo,
          ganancia_total: +(precioObjetivo - precioCompra).toFixed(4),
          markup_total_pct: +(((precioObjetivo - precioCompra) / precioCompra) * 100).toFixed(2),
        },
      },
      confianza: typeof parsed.confianza === 'number' ? Math.max(0, Math.min(1, parsed.confianza)) : 0.5,
      razonamiento: String(parsed.razonamiento || '').slice(0, 800),
      advertencias: Array.isArray(parsed.advertencias) ? parsed.advertencias.slice(0, 5) : [],
      _model: data.model,
      _usage: data.usage,
    });
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Claude tardó demasiado (>30s)' });
    return res.status(502).json({ error: 'Error consultando Claude', detail: e.message });
  }
}
