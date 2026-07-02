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

// Clasificación de ÍTEMS DE FACTURA (Conciliación de Insumos): categoría
// principal cerrada + subcategoría corta libre (fierro, tubería, cemento,
// herramienta manual, guantes, alimentación…). La subcategoría agrupa las
// compras para que la contadora jefe designe qué empresa del grupo emite
// qué tipo de facturas.
const CATEGORIAS_FACTURA = [
  'materiales', 'herramientas', 'maquinaria', 'epp',
  'insumos_emergencia', 'gastos_generales', 'otros',
];

function buildSystemPrompt(type) {
  if (type === 'factura') {
    return `Eres un experto en compras de construcción peruana. Las descripciones vienen de facturas reales y suelen tener mala escritura, abreviaciones o errores de tipeo — interprétalas con criterio. Clasifica cada ítem comprado en UNA categoría exacta y UNA subcategoría corta.

Categorías exactas:
- materiales: insumos que se incorporan a la obra (fierro/varillas, tubería PVC, codos y accesorios, cemento, ladrillos, arena/agregados, clavos, alambre, pintura, cables, pegamento)
- herramientas: herramientas de trabajo manuales o eléctricas (palana, pico, martillo, llave stilson, wincha, amoladora, taladro, pistola de calor, juego de llaves, brocas, discos de corte)
- maquinaria: equipos y maquinaria (generador, trompo/mezcladora, soldadora, vibradora, rotomartillo, demoledor, motobomba, compresora; también vehículos como motocarga/motocar)
- epp: equipos de protección personal (guantes, cascos, chalecos, lentes, botas, arnés, tapones, respiradores, uniformes)
- insumos_emergencia: botiquín, camillas, extintores, alcohol, medicinas, primeros auxilios
- gastos_generales: consumo no-inventariable (menú/comida/alimentación del personal, agua para consumo, útiles de oficina, servicios, fletes, alquileres, combustible de administración)
- otros: solo si de verdad no cuadra en ninguna

Subcategoría: palabra o frase corta en minúsculas que agrupe el ítem con sus similares. Ejemplos: fierro, tubería, accesorios pvc, cemento, clavos, agregados, pintura, eléctrico, herramienta manual, herramienta eléctrica, maquinaria liviana, vehículo, guantes, chalecos, cascos, botiquín, alimentación, combustible, flete, alquiler. Usa la MISMA subcategoría para ítems similares (consistencia > precisión).

Responde SOLO con JSON válido: {"results":[{"id":"<id>","categoria":"<categoria_exacta>","subcategoria":"<subcategoria_corta>"}]}`;
  }
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

// Sanitización: cada nombre que se concatena al prompt se filtra para evitar
// prompt injection (\n, comillas raras, caracteres de control, etc.).
import { requireAuth, rateLimit, sanitizeError, sanitizeForPrompt } from '../lib/api-helpers.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Solo POST' });
  }

  try {
    await requireAuth(req);
    rateLimit(req, { windowMs: 60_000, max: 60 });
  } catch (e) {
    const s = sanitizeError(e, 'No autorizado');
    return res.status(s.status).json(s.body);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'ANTHROPIC_API_KEY no configurada en Vercel. Pídele al admin que la agregue en Project Settings → Environment Variables.',
    });
  }

  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  const type = body.type === 'herramienta' ? 'herramienta' : (body.type === 'factura' ? 'factura' : 'material');

  if (!items.length) {
    return res.status(422).json({ error: 'Sin items para clasificar' });
  }
  if (items.length > 200) {
    return res.status(422).json({ error: 'Máximo 200 items por llamada' });
  }

  const validas = type === 'herramienta' ? CATEGORIAS_HERRAMIENTA : (type === 'factura' ? CATEGORIAS_FACTURA : CATEGORIAS_MATERIAL);
  const userMessage = `Clasifica los siguientes ${items.length} ${type === 'material' ? 'materiales' : (type === 'factura' ? 'ítems de factura' : 'herramientas')}:\n\n` +
    items.map(i =>
      `id="${sanitizeForPrompt(i.id, 60)}" nombre="${sanitizeForPrompt(i.nombre, 200)}"`
    ).join('\n') +
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

    // Anti-alucinación: categoria clampada a la whitelist; subcategoria (solo
    // type factura) saneada a texto corto en minúsculas.
    const fallbackCat = type === 'herramienta' ? 'maquinaria_liviana' : (type === 'factura' ? 'otros' : 'Otro');
    const results = (parsed.results || []).map(r => ({
      id: r.id,
      categoria: validas.includes(r.categoria) ? r.categoria : fallbackCat,
      ...(type === 'factura' ? {
        subcategoria: (typeof r.subcategoria === 'string' && r.subcategoria.trim())
          ? r.subcategoria.trim().toLowerCase().replace(/[^a-záéíóúñü0-9 /-]/gi, '').slice(0, 40) || null
          : null,
      } : {}),
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
