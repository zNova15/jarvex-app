// Vercel serverless function: POST /api/categorize
//
// Body: { items: [{ id, nombre }], type: 'material' | 'herramienta' }
// Returns: { results: [{ id, categoria, confianza }], errors: [...] }
//
// Usa Claude Haiku 4.5 (rápido + económico, ~$0.80/M tokens entrada).
// Procesa en lotes de 50 items por llamada para minimizar costo.
// Requiere ANTHROPIC_API_KEY en Vercel env vars.

const CATEGORIAS_MATERIAL = [
  'Cemento', 'Acero', 'Albañilería', 'Agregados',
  'Ferretería', 'Eléctrico', 'Sanitario', 'Acabados', 'Otro',
];

const CATEGORIAS_HERRAMIENTA = [
  'manual', 'electrica', 'maquinaria_liviana',
  'maquinaria_pesada', 'medicion', 'seguridad',
];

function buildSystemPrompt(type) {
  if (type === 'herramienta') {
    return `Eres un experto en construcción peruana. Clasifica herramientas de obra en una de estas categorías exactas:
- manual: martillos, palas, picos, llaves, alicates, carretillas, escaleras, andamios, plomadas
- electrica: taladros, amoladoras, sierras, esmeriles, atornilladores eléctricos, cortadoras
- maquinaria_liviana: vibradores de concreto, mezcladoras, compresores pequeños, generadores portátiles
- maquinaria_pesada: excavadoras, retroexcavadoras, volquetes, tractores, motoniveladoras, rodillos, grúas, camiones
- medicion: teodolitos, niveles, estaciones totales, GPS, distanciómetros, cintas métricas, prismas
- seguridad: cascos, chalecos, guantes, botas, lentes, máscaras, arneses, extintores, EPP en general

Responde SOLO con JSON válido: {"results":[{"id":"<id>","categoria":"<una_categoria_exacta>"}]}`;
  }
  return `Eres un experto en construcción peruana. Clasifica materiales de obra en una de estas categorías exactas:
- Cemento: cemento, mortero, grout, concreto, hormigón
- Acero: varillas, barras corrugadas, alambres, mallas electrosoldadas, perfiles metálicos
- Albañilería: ladrillos, bloques, adoquines, tejas
- Agregados: arena, grava, piedra, hormigón en estado natural, afirmado, base
- Ferretería: clavos, tornillos, pernos, tuercas, herramienta de mano consumible, accesorios
- Eléctrico: cables, interruptores, tomacorrientes, lámparas, tableros, conductores, tubos PVC eléctrico
- Sanitario: tuberías PVC sanitarias, codos, accesorios sanitarios, inodoros, lavatorios, válvulas, llaves de paso
- Acabados: pintura, esmalte, cerámicos, porcelanatos, mayólicas, pegamentos, masilla, revestimientos
- Otro: si no cuadra claramente en ninguna anterior

Responde SOLO con JSON válido: {"results":[{"id":"<id>","categoria":"<una_categoria_exacta>"}]}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Solo POST' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'ANTHROPIC_API_KEY no configurada en Vercel. Pídele al admin que la agregue en Project Settings → Environment Variables.',
    });
  }

  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  const type = body.type === 'herramienta' ? 'herramienta' : 'material';

  if (!items.length) {
    return res.status(422).json({ error: 'Sin items para clasificar' });
  }
  if (items.length > 200) {
    return res.status(422).json({ error: 'Máximo 200 items por llamada' });
  }

  const validas = type === 'herramienta' ? CATEGORIAS_HERRAMIENTA : CATEGORIAS_MATERIAL;
  const userMessage = `Clasifica los siguientes ${items.length} ${type === 'material' ? 'materiales' : 'herramientas'}:\n\n` +
    items.map(i => `id="${i.id}" nombre="${i.nombre}"`).join('\n') +
    `\n\nCategorías válidas: ${validas.join(', ')}.`;

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
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8000,
        system: buildSystemPrompt(type),
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(upstream.status).json({
        error: `Claude API respondió ${upstream.status}`,
        detail: errText.slice(0, 500),
      });
    }

    const data = await upstream.json();
    const text = data.content?.[0]?.text || '';

    // Extraer JSON del response (puede venir con markdown wrapping)
    const jsonMatch = text.match(/\{[\s\S]*"results"[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(502).json({
        error: 'Claude no devolvió JSON parseable',
        rawText: text.slice(0, 500),
      });
    }

    let parsed;
    try { parsed = JSON.parse(jsonMatch[0]); }
    catch (e) {
      return res.status(502).json({ error: 'JSON inválido de Claude', detail: e.message });
    }

    const results = (parsed.results || []).map(r => ({
      id: r.id,
      categoria: validas.includes(r.categoria) ? r.categoria : (type === 'herramienta' ? 'maquinaria_liviana' : 'Otro'),
      _suggested: r.categoria,
    }));

    return res.status(200).json({
      results,
      usage: data.usage,
      model: data.model,
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'Claude tardó demasiado (>60s)' });
    }
    return res.status(502).json({ error: 'Error consultando Claude', detail: e.message });
  }
}
