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

// ── Matching semántico: ítem comprado (factura) ↔ insumo presupuestado (Delfín) ──
// Resuelve que el mismo insumo tiene nombres distintos ("Clavo número 3" = "Clavo N3").
async function sugerirInsumoMatch(req, res, apiKey, body) {
  const itemName = sanitizeForPrompt(body.itemName, 200);
  const cat = sanitizeForPrompt(body.category, 100);
  const tercero = sanitizeForPrompt(body.third_party_name, 200);
  const insumos = Array.isArray(body.insumos) ? body.insumos.slice(0, 60) : [];
  if (!itemName || insumos.length === 0) {
    return res.status(422).json({ error: 'Se requiere itemName e insumos[]' });
  }
  const codigosValidos = new Set(insumos.map(x => String(x.codigo)));
  const lista = insumos.map((x, i) =>
    `${i + 1}. [${sanitizeForPrompt(x.codigo, 40)}] ${sanitizeForPrompt(x.nombre, 120)}${x.unidad ? ' (' + sanitizeForPrompt(x.unidad, 12) + ')' : ''}${x.enEjecucion ? '  ★EN EJECUCION' : ''}`
  ).join('\n');

  const sys = `Eres un experto en insumos de construcción civil (Perú). Te dan el nombre de un ÍTEM COMPRADO (de una factura de proveedor) y una lista numerada de INSUMOS PRESUPUESTADOS (de un expediente técnico / S10 Delfín). Tu tarea: encontrar cuál(es) insumo(s) presupuestado(s) corresponden SEMÁNTICAMENTE al ítem comprado — es el MISMO material aunque esté escrito distinto (ej. "Clavo número 3" = "Clavo N3" = "Clavo de 3 pulgadas"; "Cemento Sol tipo I" = "Cemento Portland Tipo I"). Considerá sinónimos, abreviaturas, marca vs genérico, medidas y la unidad.

Devolvés SOLO JSON válido (sin markdown):
{
  "coincidencias": [
    {"codigo": "<codigo EXACTO de la lista>", "confianza": 0.95, "razon": "mismo material, distinta nomenclatura"}
  ],
  "razonamiento": "breve"
}
Reglas:
- 'codigo' DEBE ser uno de los códigos de la lista (cópialo exacto, entre corchetes).
- Ordená por confianza descendente. Máximo 4 coincidencias.
- Algunos insumos están marcados con ★EN EJECUCION: pertenecen a una partida que se está ejecutando ahora, así que es más probable que la compra sea para ellos. Ante EMPATE o duda entre insumos parecidos, preferí el que está EN EJECUCION (subí un poco su confianza y ponelo primero). NO inventes una coincidencia solo porque está en ejecución — el material debe corresponder igual.
- Solo incluí las que de verdad correspondan (confianza >= 0.5). Si NINGUNO corresponde, devolvé "coincidencias": [].`;
  const usr = `ÍTEM COMPRADO: "${itemName}"${cat ? `\nCategoría: ${cat}` : ''}${tercero ? `\nProveedor: ${tercero}` : ''}\n\nINSUMOS PRESUPUESTADOS:\n${lista}\n\nDevolvé el JSON con las coincidencias.`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 700, system: sys, messages: [{ role: 'user', content: usr }] }),
    });
    clearTimeout(timer);
    if (!upstream.ok) {
      const t = await upstream.text();
      console.error('[sugerir-insumo] upstream', upstream.status, t.slice(0, 200));
      return res.status(upstream.status).json({ error: `Claude respondió ${upstream.status}` });
    }
    const data = await upstream.json();
    const text = data.content?.[0]?.text || '';
    const jm = text.match(/\{[\s\S]*\}/);
    if (!jm) return res.status(502).json({ error: 'Claude no devolvió JSON', rawText: text.slice(0, 300) });
    let parsed; try { parsed = JSON.parse(jm[0]); } catch (e) { return res.status(502).json({ error: 'JSON inválido de Claude', detail: e.message }); }
    const coincidencias = Array.isArray(parsed.coincidencias)
      ? parsed.coincidencias
          .map(c => ({ codigo: String(c.codigo || ''), confianza: typeof c.confianza === 'number' ? Math.max(0, Math.min(1, c.confianza)) : 0.5, razon: String(c.razon || '').slice(0, 200) }))
          .filter(c => codigosValidos.has(c.codigo))   // anti-alucinación: solo códigos de la lista
          .sort((a, b) => b.confianza - a.confianza)
          .slice(0, 4)
      : [];
    return res.status(200).json({ result: { coincidencias }, razonamiento: String(parsed.razonamiento || '').slice(0, 300), _model: data.model, _usage: data.usage });
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Claude tardó demasiado (>30s)' });
    return res.status(502).json({ error: 'Error consultando Claude', detail: e.message });
  }
}

// ── COSTO DE OBRA vs GASTO DE LA EMPRESA ────────────────────────────────
// La vinculación (obra / Gastos Generales) decide bien el 95 % de los casos,
// pero hay compras vinculadas a una obra que igual son GASTO administrativo
// (útiles de oficina, atención, comida de reunión) y compras "de empresa" que
// en realidad son costo directo. Acá la IA opina y la contadora decide: la
// respuesta NUNCA se aplica sola, alimenta el override manual (mig 163).
async function clasificarCostoGasto(req, res, apiKey, body) {
  const description = sanitizeForPrompt(body.description, 500);
  const category = sanitizeForPrompt(body.category, 100);
  const tercero = sanitizeForPrompt(body.third_party_name, 200);
  const documentType = sanitizeForPrompt(body.document_type, 50);
  const obra = sanitizeForPrompt(body.obra_nombre, 200);
  const destino = sanitizeForPrompt(body.destino_contable, 40);
  const items = Array.isArray(body.items)
    ? body.items.slice(0, 25).map(x => sanitizeForPrompt(String(x), 120)).filter(Boolean)
    : [];
  const monto = Number(body.amount);
  const moneda = sanitizeForPrompt(body.currency, 5) || 'PEN';

  if (!description && !category && items.length === 0) {
    return res.status(422).json({ error: 'Se requiere description, category o items' });
  }

  const sys = `Eres un contador peruano con experiencia en empresas CONSTRUCTORAS y consorcios de obra.

Tu tarea: decidir si un comprobante de compra es COSTO DE OBRA o GASTO DE LA EMPRESA.

COSTO DE OBRA ("cost") — lo que se incorpora a la obra o la ejecuta:
- Materiales e insumos de construcción (cemento, fierro, agregados, tuberías, cables).
- Combustible y mantenimiento de maquinaria que trabaja en la obra.
- Subcontratos, alquiler de equipos y maquinaria para la obra.
- Mano de obra directa y su EPP.
- Fletes y transporte de materiales a la obra.
- Ensayos de laboratorio, topografía y servicios técnicos del proyecto.

GASTO DE LA EMPRESA ("expense") — sostiene a la organización, no a la obra:
- Útiles y suministros de oficina, papelería, tóner.
- Servicios de oficina: luz, agua, internet, telefonía, alquiler de local administrativo.
- Honorarios de contabilidad, legales, auditoría, notariales, trámites.
- Comida, restaurantes, atención a clientes y viáticos administrativos.
- Publicidad, dominios, software, suscripciones, bancarios.
- Limpieza y mantenimiento de oficina.

REGLAS DE CRITERIO:
- Manda el CONCEPTO de la compra, no a qué obra esté vinculada: una caja de útiles de oficina comprada "para la obra X" sigue siendo GASTO.
- Si el comprobante ya está vinculado a una obra y el concepto es claramente de construcción, es COSTO.
- Ante duda genuina entre las dos, elegí la que diga la vinculación actual y bajá la confianza por debajo de 0.6.
- El nombre del proveedor ayuda (ferretería/distribuidora = costo probable; restaurante/estudio contable/librería = gasto probable) pero NO decide solo.

Devolvés SOLO JSON válido (sin markdown):
{
  "clasificacion": "cost",
  "confianza": 0.9,
  "razonamiento": "una frase corta, en español, dirigida a una contadora",
  "advertencias": []
}
Confianza: 0.85+ concepto inequívoco · 0.6-0.85 probable · <0.6 ambiguo, que lo revise la contadora.`;

  const usr = [
    'Comprobante:',
    `- Descripción: "${description || '(vacía)'}"`,
    category ? `- Categoría: "${category}"` : null,
    tercero ? `- Proveedor: "${tercero}"` : null,
    documentType ? `- Tipo de documento: ${documentType}` : null,
    Number.isFinite(monto) ? `- Importe: ${moneda} ${monto}` : null,
    obra ? `- Obra vinculada: "${obra}"` : '- Sin obra vinculada',
    destino ? `- Vinculación contable actual: ${destino}` : null,
    items.length ? `- Ítems facturados:\n${items.map(i => '  · ' + i).join('\n')}` : null,
    '',
    'Devolvé el JSON.',
  ].filter(Boolean).join('\n');

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, system: sys, messages: [{ role: 'user', content: usr }] }),
    });
    clearTimeout(timer);
    if (!upstream.ok) {
      const t = await upstream.text();
      console.error('[clasificar-costo-gasto] upstream', upstream.status, t.slice(0, 200));
      return res.status(upstream.status).json({ error: `Claude respondió ${upstream.status}` });
    }
    const data = await upstream.json();
    const text = data.content?.[0]?.text || '';
    const jm = text.match(/\{[\s\S]*\}/);
    if (!jm) return res.status(502).json({ error: 'Claude no devolvió JSON', rawText: text.slice(0, 300) });
    let parsed; try { parsed = JSON.parse(jm[0]); } catch (e) { return res.status(502).json({ error: 'JSON inválido de Claude', detail: e.message }); }
    // Anti-alucinación: solo cost|expense. 'income' no se decide acá (lo fija la clase).
    const clasificacion = (parsed.clasificacion === 'expense') ? 'expense'
      : (parsed.clasificacion === 'cost') ? 'cost' : null;
    if (!clasificacion) {
      return res.status(502).json({ error: 'Claude devolvió una clasificación fuera de cost|expense' });
    }
    return res.status(200).json({
      result: { clasificacion },
      confianza: typeof parsed.confianza === 'number' ? Math.max(0, Math.min(1, parsed.confianza)) : 0.5,
      razonamiento: String(parsed.razonamiento || '').slice(0, 400),
      advertencias: Array.isArray(parsed.advertencias) ? parsed.advertencias.map(a => String(a).slice(0, 200)).slice(0, 4) : [],
      _model: data.model, _usage: data.usage,
    });
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Claude tardó demasiado (>30s)' });
    return res.status(502).json({ error: 'Error consultando Claude', detail: e.message });
  }
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

  // ── Acción 'sugerir_insumo': matching SEMÁNTICO ítem comprado ↔ insumo presupuestado.
  // (Misma función serverless — el límite de Vercel es 12, así que no se agrega un endpoint.)
  if (body.action === 'sugerir_insumo') {
    return await sugerirInsumoMatch(req, res, apiKey, body);
  }

  // ── Acción 'clasificar_costo_gasto': COSTO DE OBRA vs GASTO DE LA EMPRESA.
  // (Misma función serverless — Vercel Hobby está en 12/12.)
  if (body.action === 'clasificar_costo_gasto') {
    return await clasificarCostoGasto(req, res, apiKey, body);
  }

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
