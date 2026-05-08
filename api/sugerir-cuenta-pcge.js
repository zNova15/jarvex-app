import { requireAuth, rateLimit, sanitizeError, sanitizeForPrompt } from '../lib/api-helpers.js';

// Vercel serverless function: POST /api/sugerir-cuenta-pcge
//
// Body: {
//   type: 'income' | 'cost' | 'expense',
//   description: string,
//   category?: string,
//   third_party_name?: string,
//   third_party_ruc?: string,
//   document_type?: string,
//   sugerencia_actual?: string,  // la cuenta inferida por el regex actual
// }
//
// Returns: {
//   result: { cuenta_sugerida: '60'|'63'|..., descripcion_cuenta: 'Compras', alternativas: [{cuenta, descripcion}] },
//   confianza: 0-1,
//   razonamiento: string,
//   advertencias: string[]
// }
//
// Usa Claude Haiku (rápido + económico). Plan PCGE peruano.
// Requiere ANTHROPIC_API_KEY en Vercel env.

const CUENTAS_VALIDAS = {
  income: [
    { cuenta: '70',  d: 'Ventas (mercaderías, productos terminados)' },
    { cuenta: '704', d: 'Prestación de servicios' },
    { cuenta: '75',  d: 'Otros ingresos de gestión' },
    { cuenta: '77',  d: 'Ingresos financieros' },
  ],
  cost: [
    { cuenta: '60',  d: 'Compras (materiales, suministros, mercaderías)' },
    { cuenta: '62',  d: 'Gastos de personal (sueldos, planilla, mano de obra)' },
    { cuenta: '63',  d: 'Servicios prestados por terceros (subcontratos, alquiler, flete, transporte)' },
    { cuenta: '64',  d: 'Gastos por tributos (impuestos, arbitrios, predial)' },
    { cuenta: '65',  d: 'Otros gastos de gestión' },
  ],
  expense: [
    { cuenta: '60',  d: 'Compras (materiales, útiles, suministros)' },
    { cuenta: '62',  d: 'Gastos de personal' },
    { cuenta: '63',  d: 'Servicios prestados por terceros (luz, agua, internet, alquiler)' },
    { cuenta: '64',  d: 'Tributos y aportes' },
    { cuenta: '65',  d: 'Otros gastos de gestión' },
    { cuenta: '66',  d: 'Pérdida por medición de activos' },
    { cuenta: '67',  d: 'Gastos financieros (intereses, comisiones bancarias)' },
    { cuenta: '68',  d: 'Valuación y deterioro' },
  ],
};

function buildSystemPrompt(type) {
  const lista = CUENTAS_VALIDAS[type] || CUENTAS_VALIDAS.expense;
  const cuentas = lista.map(c => `- ${c.cuenta}: ${c.d}`).join('\n');
  return `Eres un experto contador peruano. Aplicás el Plan Contable General Empresarial (PCGE) Perú.

Te dan los datos de un movimiento contable (descripción, tercero, tipo de doc, categoría libre del usuario) y debes sugerir el código de cuenta PCGE de 2 o 3 dígitos más apropiado.

Tipo del movimiento: ${type === 'income' ? 'INGRESO' : type === 'cost' ? 'COSTO (directo de obra)' : 'GASTO'}.

Cuentas válidas para este tipo:
${cuentas}

Reglas:
- Si la descripción menciona materiales/cemento/fierro/acero/insumo → 60
- Si menciona servicio/subcontrato/alquiler/flete/transporte/luz/agua/internet → 63
- Si menciona sueldo/planilla/personal/mano de obra → 62
- Si menciona impuesto/SUNAT/arbitrio/predial/tributo → 64
- Si menciona interés/comisión bancaria/financiero → 67
- Si menciona venta de mercadería/producto → 70
- Si menciona honorario/consultoría/servicio prestado → 704
- Si no encaja claramente → 65 (otros gastos) o la default del tipo

Devolvés SOLO JSON válido (sin markdown):
{
  "cuenta_sugerida": "63",
  "descripcion_cuenta": "Servicios prestados por terceros",
  "alternativas": [{"cuenta": "60", "descripcion": "Compras"}],
  "confianza": 0.92,
  "razonamiento": "El concepto 'Alquiler maquinaria' es un servicio externo (63), no una compra de bien (60).",
  "advertencias": []
}

Confianza:
- 0.85+ : la descripción es muy clara, hay un match obvio
- 0.6-0.85: la categoría tiene varias opciones razonables, elegiste la mejor
- <0.6: la descripción es ambigua, necesita revisión humana`;
}

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
      error: 'ANTHROPIC_API_KEY no configurada en Vercel.',
    });
  }

  const body = req.body || {};
  const type = ['income', 'cost', 'expense'].includes(body.type) ? body.type : 'expense';
  // Sanitización: caracteres de control y newlines fuera para evitar prompt injection.
  const description = sanitizeForPrompt(body.description, 500);
  const category = sanitizeForPrompt(body.category, 100);
  const thirdPartyName = sanitizeForPrompt(body.third_party_name, 200);
  const documentType = sanitizeForPrompt(body.document_type, 50);
  const sugerenciaActual = sanitizeForPrompt(body.sugerencia_actual, 5);

  if (!description && !category) {
    return res.status(422).json({ error: 'Se requiere al menos description o category' });
  }

  const userMessage = [
    `Datos del movimiento:`,
    `- Descripción: "${description || '(vacía)'}"`,
    category ? `- Categoría libre del usuario: "${category}"` : null,
    thirdPartyName ? `- Tercero (proveedor/cliente): "${thirdPartyName}"` : null,
    documentType ? `- Tipo doc: ${documentType}` : null,
    sugerenciaActual ? `- Sugerencia actual del sistema (regex): ${sugerenciaActual}` : null,
    ``,
    `Devolvé el JSON con la cuenta PCGE más apropiada.`,
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
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: buildSystemPrompt(type),
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error('[sugerir-cuenta-pcge] upstream error:', upstream.status, errText.slice(0, 200));
      const isProd = process.env.NODE_ENV === 'production';
      return res.status(upstream.status).json({
        error: `Claude respondió ${upstream.status}`,
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

    // Validar que la cuenta sugerida esté en la lista válida del tipo
    const lista = CUENTAS_VALIDAS[type];
    const cuentaSugerida = String(parsed.cuenta_sugerida || '').trim();
    const valida = lista.find(c => c.cuenta === cuentaSugerida);
    if (!valida) {
      // Si Claude alucinó una cuenta no válida, fallback a la default
      const defaultCuenta = type === 'income' ? '70' : type === 'cost' ? '60' : '65';
      return res.status(200).json({
        result: {
          cuenta_sugerida: defaultCuenta,
          descripcion_cuenta: lista.find(c => c.cuenta === defaultCuenta)?.d || '',
          alternativas: lista.filter(c => c.cuenta !== defaultCuenta).slice(0, 3).map(c => ({ cuenta: c.cuenta, descripcion: c.d })),
        },
        confianza: 0.3,
        razonamiento: `Claude sugirió cuenta inválida "${cuentaSugerida}", se aplicó default ${defaultCuenta}.`,
        advertencias: [`Cuenta sugerida fuera del catálogo PCGE: ${cuentaSugerida}`],
      });
    }

    return res.status(200).json({
      result: {
        cuenta_sugerida: valida.cuenta,
        descripcion_cuenta: valida.d,
        alternativas: Array.isArray(parsed.alternativas)
          ? parsed.alternativas
              .map(a => ({ cuenta: String(a.cuenta || ''), descripcion: String(a.descripcion || '') }))
              .filter(a => lista.find(c => c.cuenta === a.cuenta) && a.cuenta !== valida.cuenta)
              .slice(0, 3)
          : [],
      },
      confianza: typeof parsed.confianza === 'number' ? Math.max(0, Math.min(1, parsed.confianza)) : 0.5,
      razonamiento: String(parsed.razonamiento || '').slice(0, 500),
      advertencias: Array.isArray(parsed.advertencias) ? parsed.advertencias.slice(0, 5) : [],
      _model: data.model,
      _usage: data.usage,
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'Claude tardó demasiado (>30s)' });
    }
    return res.status(502).json({ error: 'Error consultando Claude', detail: e.message });
  }
}
