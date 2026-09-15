import { requireAuth, rateLimit, sanitizeError, sanitizeForPrompt } from '../lib/api-helpers.js';
import { leerConfig as leerConfigOR, construirCuerpo as construirCuerpoOR, normalizarRespuesta as normalizarRespuestaOR, openrouterChat } from '../lib/openrouter.js';

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
    if (!jm) return res.status(502).json({ error: 'La IA no devolvió JSON', rawText: text.slice(0, 300) });
    let parsed; try { parsed = JSON.parse(jm[0]); } catch (e) { return res.status(502).json({ error: 'La IA devolvió un JSON inválido', detail: e.message }); }
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
    // Mismo criterio que captura-magica: el paso barato va a OpenRouter (gratis)
    // y Claude queda de respaldo. Acá importa más que en la captura, porque esta
    // sugerencia se dispara SOLA en cada comprobante: si costara, nadie la
    // dejaría prendida.
    const cfgOR = leerConfigOR();
    const deadline = Date.now() + 30000;
    let data = null;
    let motor = 'claude';
    if (cfgOR.activo) {
      try {
        const cruda = await openrouterChat(cfgOR.apiKey, construirCuerpoOR({
          modelo: cfgOR.modelo, respaldos: cfgOR.respaldos, politica: cfgOR.politica,
          system: sys, user: usr, maxTokens: 2000,
        }), Math.min(deadline, Date.now() + 18000));
        data = normalizarRespuestaOR(cruda);
        motor = 'openrouter';
      } catch (e) {
        console.warn('[clasificar-costo-gasto] OpenRouter falló:', (e && (e.upstreamStatus || e.message)) || e);
      }
    }
    if (!data) {
      if (!apiKey) return res.status(503).json({ error: 'No hay motor de IA configurado' });
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
        return res.status(upstream.status).json({ error: `El servicio de IA respondió ${upstream.status}` });
      }
      data = await upstream.json();
    }
    const text = data.content?.[0]?.text || '';
    const jm = text.match(/\{[\s\S]*\}/);
    if (!jm) return res.status(502).json({ error: 'Claude no devolvió JSON', rawText: text.slice(0, 300) });
    let parsed; try { parsed = JSON.parse(jm[0]); } catch (e) { return res.status(502).json({ error: 'JSON inválido de Claude', detail: e.message }); }
    // Anti-alucinación: solo cost|expense. 'income' no se decide acá (lo fija la clase).
    const clasificacion = (parsed.clasificacion === 'expense') ? 'expense'
      : (parsed.clasificacion === 'cost') ? 'cost' : null;
    if (!clasificacion) {
      return res.status(502).json({ error: 'La IA devolvió una clasificación fuera de cost|expense' });
    }
    // Medición del consumo de IA — misma línea [ia-uso] que captura-magica,
    // para poder contar tokens reales por día desde los logs de Vercel.
    try {
      console.log('[ia-uso]', JSON.stringify({
        endpoint: 'sugerir-cuenta-pcge', modo: 'clasificar_costo_gasto', engine: motor,
        model: data.model,
        in: data.usage?.input_tokens ?? null,
        out: data.usage?.output_tokens ?? null,
      }));
    } catch {}
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

// ═══════════════════════════════════════════════════════════════════
// LAS TRES AYUDAS DE IA DEL PANEL DE INSUMOS (14-sep-2026)
//
// Clasificar · Correlacionar · Mapear. Las tres contestan preguntas distintas
// sobre lo mismo —qué ES esto, si DOS son lo mismo, y CONTRA QUÉ del
// presupuesto va— y las tres comparten este motor.
//
// 🔴 SOLO OPENROUTER GRATIS, SIN RESPALDO PAGO. Pedido explícito de Gabriel:
// «no quiero que esté de respaldo Haiku; si falla, que se pueda pulsar el
// botón y reintentar, nada más». Estos botones se pueden disparar cientos de
// veces mientras se despacha la cola de 700+ descripciones de UNA empresa: con
// un respaldo pago, una racha de saturación del gratuito se convierte en
// factura sin que nadie lo haya pedido. Si el gratuito no está, se dice y el
// botón queda listo para reintentar — que es exactamente lo que se pidió.
// (Las otras tres acciones de este endpoint —cuenta PCGE, sugerir_insumo,
// costo/gasto— siguen como estaban, con Claude: son otro caudal.)
//
// Devuelve { parsed, data } o lanza un Error con .status y .mensaje listos
// para responder.
async function pedirJsonALaIA({ sys, usr, maxTokens = 1200, modo }) {
  const cfg = leerConfigOR();
  if (!cfg.activo) {
    const e = new Error('sin motor');
    e.status = 503;
    e.mensaje = 'La ayuda de IA no está configurada en el servidor (falta OPENROUTER_API_KEY).';
    throw e;
  }
  let data;
  try {
    const cruda = await openrouterChat(cfg.apiKey, construirCuerpoOR({
      modelo: cfg.modelo, respaldos: cfg.respaldos, politica: cfg.politica,
      system: sys, user: usr, maxTokens, razonamiento: 'bajo',
    }), Date.now() + 25000);
    data = normalizarRespuestaOR(cruda);
  } catch (err) {
    console.warn(`[${modo}] OpenRouter falló:`, (err && (err.upstreamStatus || err.message)) || err);
    const e = new Error('openrouter');
    e.status = 503;
    e.mensaje = err?.politicaImposible
      ? 'Ningún modelo gratuito cumple hoy la política de datos configurada — avisale al admin.'
      : 'El modelo gratuito no respondió (suele estar saturado unos segundos). Tocá el botón otra vez.';
    throw e;
  }
  const text = data.content?.[0]?.text || '';
  const jm = text.match(/\{[\s\S]*\}/);
  if (!jm) {
    const e = new Error('sin json');
    e.status = 502;
    e.mensaje = 'La IA no devolvió una respuesta usable. Tocá el botón otra vez.';
    throw e;
  }
  let parsed;
  try { parsed = JSON.parse(jm[0]); } catch {
    const e = new Error('json invalido');
    e.status = 502;
    e.mensaje = 'La IA devolvió una respuesta mal formada. Tocá el botón otra vez.';
    throw e;
  }
  // Misma línea [ia-uso] que captura-magica: deja contar tokens por día desde
  // los logs de Vercel sin instrumentar nada más.
  try {
    console.log('[ia-uso]', JSON.stringify({
      endpoint: 'sugerir-cuenta-pcge', modo, engine: 'openrouter',
      model: data.model, in: data.usage?.input_tokens ?? null, out: data.usage?.output_tokens ?? null,
    }));
  } catch {}
  return { parsed, data };
}

/** Una sola forma de contestar el error de las tres ayudas. */
function responderErrorIA(res, e) {
  if (e?.mensaje) return res.status(e.status || 502).json({ error: e.mensaje });
  if (e?.name === 'AbortError') return res.status(504).json({ error: 'La IA tardó demasiado. Tocá el botón otra vez.' });
  return res.status(502).json({ error: 'No se pudo consultar la IA. Tocá el botón otra vez.' });
}

// ── 1. CLASIFICAR: insumo/servicio → código IUPC/Servicios ────────
// Gabriel, 14-sep-2026: con solo parecido de palabras, "PANTALON Y CAMISACO DE
// DRILL OBRERO AZUL CON CINTA REFLECTIVA" salía sugerido como [37] Herramienta
// manual — la palabra "obrero" pesó más que el hecho de que es ropa de
// trabajo con cinta reflectiva, es decir EPP. Con 700+ descripciones por
// decidir en la primera empresa, este botón le da al motor local una segunda
// opinión que SÍ entiende el significado, no solo el texto. Nunca se aplica
// sola — el resultado llega al panel y la persona decide.
//
// Anti-alucinación: `candidatos` lo manda el cliente (la MISMA lista que
// ofrece el selector — categoriasParaElegir()), y la respuesta se valida
// contra esos códigos exactos. Si la IA propone algo fuera de la lista, se
// descarta — no se inventa un código plausible (misma filosofía que
// "sin_clasificar" en indices-unificados-iupc.js).
async function clasificarInsumoIUPC(req, res, body) {
  const descripcion = sanitizeForPrompt(body.descripcion, 300);
  const unidad = sanitizeForPrompt(body.unidad, 20);
  const candidatos = Array.isArray(body.candidatos) ? body.candidatos.slice(0, 120) : [];
  if (!descripcion || candidatos.length === 0) {
    return res.status(422).json({ error: 'Se requiere descripcion y candidatos[]' });
  }
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
  const evidencia = (Array.isArray(body.evidencia) ? body.evidencia : [])
    .slice(0, 12)
    .map(g => ({
      codigo: sanitizeForPrompt(String(g?.codigo || ''), 20),
      terminos: (Array.isArray(g?.terminos) ? g.terminos : [])
        .slice(0, 6).map(t => sanitizeForPrompt(t, 80)).filter(Boolean),
    }))
    .filter(g => g.codigo && codigosValidos.has(g.codigo) && g.terminos.length);
  const bloqueEvidencia = evidencia.length
    ? evidencia.map(g => `- [${g.codigo}] ← ${g.terminos.map(t => `"${t}"`).join(', ')}`).join('\n')
    : '(ninguno: el Diccionario Oficial no tiene ningún término que se parezca a esta descripción)';

  // ── El diccionario DE LA EMPRESA, que NO es la norma ──────────────
  // Tanda 1 (15-sep-2026). Hasta acá los términos que la empresa había
  // aprendido de sus propias decisiones viajaban DENTRO del bloque anterior,
  // rotulados «DICCIONARIO OFICIAL». Medido en producción: 365 de 368 eran
  // huérfanos de decisiones ya deshechas y ~70 estaban mal ("CUSQUEÑA" →
  // cemento). El modelo leía su propio error de ayer como si fuera la R.J.
  // 016-2026. Ahora va aparte y con el estatus que le corresponde: una pista
  // de la casa, que pierde contra la norma cuando se contradicen.
  const propios = (Array.isArray(body.evidencia_propia) ? body.evidencia_propia : [])
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

  const pl = body.propuesta_local;
  const bloqueLocal = pl?.codigo && codigosValidos.has(String(pl.codigo))
    ? `\n\nPROPUESTA DEL MOTOR LOCAL (ya leyó ese mismo diccionario): [${sanitizeForPrompt(String(pl.codigo), 20)}] ${sanitizeForPrompt(pl.nombre, 100)}${pl.motivo ? ` — motivo: ${sanitizeForPrompt(pl.motivo, 200)}` : ''}`
    : '';

  const sys = `Eres un experto en insumos y servicios de construcción civil en Perú, clasificando según el estándar oficial IUPC del INEI (Índices Unificados de Precios de la Construcción, R.J. 016-2026) y su Diccionario Oficial de Elementos de Construcción (Anexo 2).

Te dan una DESCRIPCIÓN tal como aparece en una factura, una lista numerada de CLASIFICACIONES POSIBLES (código + nombre) y hasta tres bloques de apoyo, que NO tienen la misma autoridad:

1. EVIDENCIA DEL DICCIONARIO OFICIAL (Anexo 2) — es LA LEY: texto de la R.J. 016-2026 del INEI. No se discute.
2. DICCIONARIO DE LA EMPRESA — términos que esta empresa fue aprendiendo de sus propias decisiones. Es una PISTA, no la norma: puede tener errores, y de hecho los tuvo. Úsalo cuando la norma no dice nada sobre la descripción, o para desempatar entre códigos que la norma deja igual de plausibles. Si contradice a la EVIDENCIA OFICIAL, gana la oficial, y decilo en el razonamiento.
3. PROPUESTA DEL MOTOR LOCAL — la respuesta que ya calculó el sistema leyendo esos mismos diccionarios.

🔴 LA NORMA MANDA, NO TU INTUICIÓN. La evidencia del diccionario oficial le gana a cualquier razonamiento propio:
- Si algún término de la evidencia describe el MISMO objeto que la descripción, elegí ese código. "Alambre de amarre" contra la evidencia "[02] ← Alambre negro recocido, Alambre de púas" es acero, no maquinaria.
- La PROPUESTA DEL MOTOR LOCAL, cuando viene, salió de leer ese mismo diccionario. Confirmala salvo que tengas un argumento concreto para cambiarla, y si la cambiás decí en el razonamiento POR QUÉ la norma dice otra cosa. Cambiarla sin argumento es el error más caro que podés cometer acá.
- Si la evidencia OFICIAL está vacía, el objeto NO está en el diccionario de construcción (que el diccionario de la empresa diga algo no cambia eso). Eso es información, no permiso para forzarlo: un mueble de oficina, un servicio bancario o un artículo de escritorio van a las categorías complementarias (administrativos / consumos de oficina / servicios), NO al material del que están hechos. Una MESA DE MELAMINE es mobiliario de oficina, no "madera terciada"; un cobro de un banco o una inmobiliaria es un gasto administrativo o financiero, no un insumo.

Otras pistas donde el parecido de texto suele fallar:
- Ropa de trabajo, cascos, guantes, botas, chalecos, arneses, lentes, tapones de oído, cinta reflectiva → EPP / implementos de seguridad, aunque diga "obrero" o una marca que suene a herramienta.
- Herramienta MANUAL es lo que se opera a mano sin motor (llave, combo, pala); con motor, hidráulico o eléctrico portátil suele ser maquinaria liviana.
- Un servicio de alquiler, flete, transporte, mantenimiento o capacitación NO es un insumo físico — va al árbol de SERVICIOS (códigos que empiezan con S).
- Nunca inventes un código que no esté en la lista.

Devolvés SOLO JSON válido (sin markdown):
{
  "codigo_sugerido": "<código EXACTO de la lista, sin corchetes>",
  "confianza": 0.9,
  "razonamiento": "una frase corta y concreta, en español, dirigida a quien va a decidir. Si te apoyaste en un término, nombralo y decí de qué bloque salió (norma o diccionario de la empresa).",
  "alternativas": [{"codigo": "<código de la lista>", "motivo": "breve"}],
  "clasificacion_nueva": "<opcional: si NINGUNA de la lista le queda bien de verdad, el nombre corto de la clasificación que habría que crear (ej. 'Gastos financieros e intereses'). Si alguna sirve, omitilo>"
}
Confianza: 0.85+ inequívoco · 0.6-0.85 razonable · <0.6 ambiguo, que lo revise una persona. Si proponés "clasificacion_nueva", la confianza del código elegido debe ser menor a 0.6. Máximo 2 alternativas.`;

  const usr = `DESCRIPCIÓN: "${descripcion}"${unidad ? `\nUnidad de la factura: ${unidad}` : ''}

EVIDENCIA DEL DICCIONARIO OFICIAL (Anexo 2 de la R.J. 016-2026 — esto ES la norma):
${bloqueEvidencia}${bloquePropio}${bloqueLocal}

CLASIFICACIONES POSIBLES:
${lista}

Devolvé el JSON.`;

  try {
    const { parsed, data } = await pedirJsonALaIA({ sys, usr, maxTokens: 1200, modo: 'clasificar_insumo_iupc' });
    const codigoSugerido = String(parsed.codigo_sugerido || '').trim();
    if (!codigosValidos.has(codigoSugerido)) {
      return res.status(200).json({
        result: null,
        razonamiento: `La IA propuso un código fuera de la lista ("${codigoSugerido || 'vacío'}") — no se aplicó nada.`,
        _model: data.model, _usage: data.usage,
      });
    }
    const alternativas = Array.isArray(parsed.alternativas)
      ? parsed.alternativas
          .map(a => ({ codigo: String(a.codigo || ''), motivo: String(a.motivo || '').slice(0, 150) }))
          .filter(a => codigosValidos.has(a.codigo) && a.codigo !== codigoSugerido)
          .slice(0, 2)
      : [];
    // «Podría recomendar una clasificación nueva» (Gabriel, 15-sep, sobre
    // "LA INMOBILIARIA BCP", que es el interés de un préstamo y no encaja en
    // nada de la lista). Es SOLO un texto para que lo lea una persona: acá no
    // se crea ninguna clasificación, eso se hace desde el Catálogo.
    const nueva = String(parsed.clasificacion_nueva || '').trim().slice(0, 80);
    return res.status(200).json({
      result: { codigo_sugerido: codigoSugerido, alternativas, clasificacion_nueva: nueva || null },
      confianza: typeof parsed.confianza === 'number' ? Math.max(0, Math.min(1, parsed.confianza)) : 0.5,
      razonamiento: String(parsed.razonamiento || '').slice(0, 300),
      _model: data.model, _usage: data.usage,
    });
  } catch (e) {
    return responderErrorIA(res, e);
  }
}

// ── 2. CORRELACIONAR: ¿estos nombres son el MISMO insumo? ─────────
// La misma IA, para la pestaña de Correlaciones (pedido de Gabriel, 14-sep).
// El motor local compara PALABRAS y por eso propuso "REDUCCION 1\" X 1/2"
// junto a "REDUCCION 2 1/2\" A 1": escritas se parecen muchísimo y son dos
// piezas distintas. Acá la IA mira las MEDIDAS y el material.
//
// UNA sola forma para los dos casos de la pantalla: un PAR son dos variantes,
// un GRUPO son N. Contesta cuáles son de verdad la misma cosa (`mismas`) y
// cuáles quedan afuera (`fuera`) — que es exactamente lo que la tarjeta ya
// deja hacer a mano tocando cada variante.
async function correlacionarInsumosIA(req, res, body) {
  const variantes = Array.isArray(body.variantes)
    ? [...new Set(body.variantes.map(v => sanitizeForPrompt(String(v), 160)).filter(Boolean))].slice(0, 20)
    : [];
  if (variantes.length < 2) {
    return res.status(422).json({ error: 'Se requieren al menos 2 variantes' });
  }
  const validos = new Set(variantes);
  const lista = variantes.map((v, i) => `${i + 1}. "${v}"`).join('\n');

  const sys = `Eres un experto en insumos y servicios de construcción civil en Perú. Te dan una lista de NOMBRES tal como los escribieron distintos proveedores en sus facturas, y tenés que decir cuáles son EL MISMO artículo escrito distinto y cuáles no.

Reglas de criterio:
- El mismo artículo escrito distinto SÍ se une: "Clavo número 3" = "Clavos N3" = "Clavo de 3 pulgadas"; "Cemento Sol tipo I" = "Cemento Portland Tipo I".
- Las MEDIDAS mandan y casi nunca perdonan: una "REDUCCION 1\\" X 1/2" NO es una "REDUCCION 2 1/2\\" A 1", aunque las palabras sean casi iguales. Lo mismo con diámetros, espesores, largos, potencias y capacidades distintas.
- El MATERIAL manda: PVC no es fierro galvanizado aunque la pieza sea la misma.
- Una MARCA distinta del mismo artículo con la misma medida SÍ es el mismo insumo.
- El color, la presentación o el proveedor no hacen dos insumos distintos si el artículo y la medida son iguales.

Devolvés SOLO JSON válido (sin markdown):
{
  "mismas": ["<nombre EXACTO de la lista>", "..."],
  "canonico": "<el nombre más completo de los de 'mismas'>",
  "confianza": 0.9,
  "razonamiento": "una frase corta, en español, diciendo QUÉ los hace iguales o distintos (la medida, el material...)"
}
Reglas de salida:
- Copiá los nombres EXACTAMENTE como están en la lista, sin el número ni las comillas.
- En "mismas" van solo los que son el mismo artículo entre sí. Los demás se omiten (la app los deja afuera sola).
- Si NINGUNO es el mismo que otro, devolvé "mismas": [].
- "mismas" tiene sentido con 2 o más: nunca pongas uno solo ahí.`;

  const usr = `NOMBRES:\n${lista}\n\nDevolvé el JSON.`;

  try {
    const { parsed, data } = await pedirJsonALaIA({ sys, usr, maxTokens: 1200, modo: 'correlacionar_insumos' });
    // Anti-alucinación: solo nombres que estaban en la lista, sin repetir.
    let mismas = [...new Set(
      (Array.isArray(parsed.mismas) ? parsed.mismas : []).map(x => String(x || '')).filter(x => validos.has(x))
    )];
    // Una sola no es un grupo: unir necesita dos.
    if (mismas.length < 2) mismas = [];
    // `fuera` se deriva del complemento, no de lo que diga la IA: así la
    // partición SIEMPRE es total y consistente aunque la respuesta olvide una.
    const fuera = variantes.filter(v => !mismas.includes(v));
    const canonicoIA = String(parsed.canonico || '');
    const canonico = mismas.includes(canonicoIA)
      ? canonicoIA
      : (mismas.length ? mismas.reduce((m, n) => (n.length > m.length ? n : m), mismas[0]) : null);
    return res.status(200).json({
      result: { mismas, fuera, canonico },
      confianza: typeof parsed.confianza === 'number' ? Math.max(0, Math.min(1, parsed.confianza)) : 0.5,
      razonamiento: String(parsed.razonamiento || '').slice(0, 300),
      _model: data.model, _usage: data.usage,
    });
  } catch (e) {
    return responderErrorIA(res, e);
  }
}

// ── 3. MAPEAR: ¿qué insumo del PRESUPUESTO es este de la empresa? ─
// Tercera ayuda con el mismo motor (Gabriel, 14-sep). Acá NO se clasifica:
// los dos lados ya tienen su clasificación y la pregunta es de EQUIVALENCIA
// entre dos catálogos — el de la empresa y el del expediente técnico del
// trabajo. "No está en este presupuesto" es una respuesta válida y útil.
async function mapearInsumoPresupuestoIA(req, res, body) {
  const insumo = sanitizeForPrompt(body.insumo, 200);
  const unidad = sanitizeForPrompt(body.unidad, 20);
  const clasificacion = sanitizeForPrompt(body.clasificacion, 80);
  const candidatos = Array.isArray(body.candidatos) ? body.candidatos.slice(0, 60) : [];
  if (!insumo || candidatos.length === 0) {
    return res.status(422).json({ error: 'Se requiere insumo y candidatos[]' });
  }
  const codigosValidos = new Set(candidatos.map(c => String(c.codigo)));
  const lista = candidatos.map((c, i) =>
    `${i + 1}. [${sanitizeForPrompt(String(c.codigo), 40)}] ${sanitizeForPrompt(c.nombre, 140)}`
    + `${c.unidad ? ` (${sanitizeForPrompt(c.unidad, 12)})` : ''}`
    + `${c.clasificacion ? ` · ${sanitizeForPrompt(c.clasificacion, 60)}` : ''}`
  ).join('\n');

  const sys = `Eres un experto en presupuestos de obra y expedientes técnicos (S10 / Delfín) en Perú.

Te dan UN INSUMO DEL CATÁLOGO DE UNA EMPRESA y la lista numerada de los INSUMOS DEL PRESUPUESTO de un trabajo. Decí cuál del presupuesto es EL MISMO insumo, aunque esté escrito distinto.

Reglas de criterio:
- Es el mismo si es el mismo material o artículo con la misma medida, aunque cambien el orden de las palabras, la marca o la abreviatura ("Fierro corrugado 1/2" = "Acero corrugado fy=4200 Ø 1/2").
- Las MEDIDAS mandan: 1/2 no es 3/4, 8 mm no es 12 mm.
- La UNIDAD puede diferir legítimamente (kg contra varilla, bolsa contra kg): eso NO descarta la coincidencia — después se aplica un factor de conversión.
- Si el presupuesto NO tiene nada equivalente, decilo: es una respuesta válida y útil. Mejor eso que forzar un parecido.

Devolvés SOLO JSON válido (sin markdown):
{
  "codigo_sugerido": "<código EXACTO de la lista, o null si ninguno corresponde>",
  "confianza": 0.9,
  "razonamiento": "una frase corta, en español",
  "alternativas": [{"codigo": "<código de la lista>", "motivo": "breve"}]
}
Confianza: 0.85+ es claramente el mismo · 0.6-0.85 probable · <0.6 dudoso. Máximo 2 alternativas.`;

  const usr = [
    `INSUMO DE LA EMPRESA: "${insumo}"`,
    unidad ? `Unidad: ${unidad}` : null,
    clasificacion ? `Clasificación: ${clasificacion}` : null,
    '',
    'INSUMOS DEL PRESUPUESTO:',
    lista,
    '',
    'Devolvé el JSON.',
  ].filter(Boolean).join('\n');

  try {
    const { parsed, data } = await pedirJsonALaIA({ sys, usr, maxTokens: 1200, modo: 'mapear_insumo_presupuesto' });
    const cod = String(parsed.codigo_sugerido ?? '').trim();
    const valido = codigosValidos.has(cod) ? cod : null;
    const alternativas = Array.isArray(parsed.alternativas)
      ? parsed.alternativas
          .map(a => ({ codigo: String(a.codigo || ''), motivo: String(a.motivo || '').slice(0, 150) }))
          .filter(a => codigosValidos.has(a.codigo) && a.codigo !== valido)
          .slice(0, 2)
      : [];
    const razonamiento = String(parsed.razonamiento || '').slice(0, 300);
    return res.status(200).json({
      result: valido ? { codigo_sugerido: valido, alternativas } : null,
      confianza: typeof parsed.confianza === 'number' ? Math.max(0, Math.min(1, parsed.confianza)) : 0.5,
      razonamiento: valido
        ? razonamiento
        : (razonamiento || 'La IA no encontró un insumo equivalente en este presupuesto.'),
      _model: data.model, _usage: data.usage,
    });
  } catch (e) {
    return responderErrorIA(res, e);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Solo POST' });
  }

  let authCtx = null;
  try {
    authCtx = await requireAuth(req);
    rateLimit(req, { windowMs: 60_000, max: 60 });
  } catch (e) {
    const s = sanitizeError(e, 'No autorizado');
    return res.status(s.status).json(s.body);
  }

  // Blindaje de créditos (espejo del de api/captura-magica.js, hallazgo de la
  // inspección 1-sep): las 3 acciones de este endpoint (cuenta PCGE, match de
  // insumo, costo/gasto) queman tokens de Claude y quedaban abiertas a
  // CUALQUIER autenticado — incluso solo_lectura o la cuenta compartida del
  // portal de campo, a 60 req/min. Roles espejo del modo 'comprobantes'.
  // Roles custom y overrides del panel viven en localStorage del cliente —
  // el server no puede confiar en ellos y quedan fuera a propósito.
  const ROLES_PERMITIDOS = ['admin', 'gerente', 'contador', 'ayudante_contador', 'asistente_admin', 'jefe_compras'];
  const rolSolicitante = authCtx?.profile?.rol || null;
  if (!rolSolicitante) {
    // profile null = hiccup transitorio consultando profiles. Fail-closed pero
    // REINTENTABLE: 503, no un 403 que diagnostica mal un problema que se cura solo.
    return res.status(503).json({ error: 'No se pudo verificar tu rol en este momento — reintentá en unos segundos.' });
  }
  if (!ROLES_PERMITIDOS.includes(rolSolicitante)) {
    return res.status(403).json({ error: 'Tu rol no tiene habilitada la sugerencia con IA.' });
  }

  const body = req.body || {};

  // ── LAS TRES AYUDAS DEL PANEL DE INSUMOS (14-sep-2026) ───────────
  // Van ANTES del chequeo de ANTHROPIC_API_KEY a propósito: corren SOLO con
  // OpenRouter gratis y no tocan Claude, así que no tiene por qué frenarlas
  // una key que no usan.
  if (body.action === 'clasificar_insumo_iupc') {
    return await clasificarInsumoIUPC(req, res, body);
  }
  if (body.action === 'correlacionar_insumos') {
    return await correlacionarInsumosIA(req, res, body);
  }
  if (body.action === 'mapear_insumo_presupuesto') {
    return await mapearInsumoPresupuestoIA(req, res, body);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'ANTHROPIC_API_KEY no configurada en Vercel.',
    });
  }

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
