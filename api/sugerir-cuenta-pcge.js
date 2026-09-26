import { requireAuth, rateLimit, sanitizeError, sanitizeForPrompt } from '../lib/api-helpers.js';
import { leerConfig as leerConfigOR, construirCuerpo as construirCuerpoOR, normalizarRespuesta as normalizarRespuestaOR, openrouterChat, armarCadenaOpenRouter } from '../lib/openrouter.js';
import { resolverTexto } from '../lib/modelos-ia.js';
import { promptClasificacion } from '../lib/prompt-clasificacion.js';

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
        const cadenaOR = armarCadenaOpenRouter('auto', cfgOR);
        const cruda = await openrouterChat(cfgOR.apiKey, construirCuerpoOR({
          modelo: cadenaOR.modelo, respaldos: cadenaOR.respaldos, politica: cfgOR.politica,
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
// 🔴 DOS GRATUITOS Y UN RESPALDO DE PAGO EN EL ÚLTIMO CUPO (17-sep-2026).
// Hasta hoy la cadena era SOLO gratuita (titular + 2 respaldos gratis, pedido
// explícito de Gabriel: «no quiero que esté de respaldo Haiku; si falla, que
// se pueda pulsar el botón y reintentar»). En la práctica, con la cola de
// 700+ descripciones de una empresa despachándose sola, una racha de
// saturación de Novita (el único proveedor con ZDR real — ver
// docs/ia-postproceso-openrouter.md §"El flag zdr…") dejaba SECA toda la
// cadena y el botón de reintentar no alcanzaba a absorber el volumen.
//
// Gabriel decidió el cambio: bajar a DOS gratuitos y dejar el TERCER (y
// último) cupo de la cadena para GPT-OSS 120B — no Haiku ni Sonnet, sino el
// modelo de pago más barato del catálogo (`lib/modelos-ia.js`, ya
// `recomendadoEn: ['clasificacion']`, USD 0,037/0,17 por millón). Sigue
// siendo la MISMA llamada a OpenRouter con `models` de 3 entradas —no dos
// requests, no un segundo motor que mantener— así que solo se paga cuando los
// DOS gratuitos ya fallaron los dos. (Las otras tres acciones de este
// endpoint —cuenta PCGE, sugerir_insumo, costo/gasto— siguen como estaban,
// con Claude: son otro caudal.)
//
// Devuelve { parsed, data } o lanza un Error con .status y .mensaje listos
// para responder.
const RESPALDO_PAGO_CLASIFICACION = 'openai/gpt-oss-120b';
async function pedirJsonALaIA({ sys, usr, maxTokens = 1200, modo, elegido = null }) {
  const cfg = leerConfigOR();
  if (!cfg.activo) {
    const e = new Error('sin motor');
    e.status = 503;
    e.mensaje = 'La ayuda de IA no está configurada en el servidor (falta OPENROUTER_API_KEY).';
    throw e;
  }
  // EL MODELO DE ESTE ÁMBITO (tanda 2). Mismo mecanismo que Captura Mágica y
  // Licitaciones: el navegador manda lo que el admin eligió en Administración →
  // Modelos de IA, y la lista blanca de lib/modelos-ia.js impide que pida uno
  // caro que no esté aprobado. 'auto' = la cadena de hoy: titular gratis + 1
  // respaldo gratis + GPT-OSS 120B (pago) en el último cupo.
  //
  // 🔴 UN MODELO ELEGIDO NO LLEVA RESPALDOS, igual que en los otros dos
  // ámbitos: si el pedido se cayera a otro modelo por detrás, la comparación
  // entre modelos mediría una mezcla. Si el elegido falla, falla y se dice.
  const t = resolverTexto(elegido, 'clasificacion');
  // 🔴 EN 'auto' EL TERCER CUPO NO ES `armarCadenaOpenRouter` A SECAS. Ese
  // helper (agregado anoche en lib/openrouter.js) deja 'auto' en 2 gratuitos
  // y solo abre el 3er cupo para cuando alguien ELIGE un modelo a mano. Para
  // estas tres ayudas Gabriel decidió lo de arriba: el 3er cupo de 'auto'
  // también se usa, y va para GPT-OSS 120B — no para un tercer gratuito.
  const cadenaAuto = armarCadenaOpenRouter('auto', cfg);
  const cadenaOR = t.auto
    ? { modelo: cadenaAuto.modelo, respaldos: [...cadenaAuto.respaldos, RESPALDO_PAGO_CLASIFICACION] }
    : armarCadenaOpenRouter(t.modelo, cfg);
  let data;
  try {
    const cruda = await openrouterChat(cfg.apiKey, construirCuerpoOR({
      modelo: cadenaOR.modelo,
      respaldos: cadenaOR.respaldos,
      politica: cfg.politica,
      system: sys, user: usr, maxTokens, razonamiento: 'bajo',
    }), Date.now() + 25000);
    data = normalizarRespuestaOR(cruda);
  } catch (err) {
    // Si el modelo ELEGIDO A MANO era de pago y respondió 402 (sin saldo en
    // OpenRouter), degradamos a la cadena gratuita para no dejar el botón
    // bloqueado. En 'auto' esto no aplica: el pago YA es el último cupo de la
    // MISMA llamada, así que si falló, fallaron los tres juntos.
    if (!t.auto && err?.sinCredito) {
      console.warn(`[${modo}] modelo elegido sin crédito (402), reintento con cadena gratuita`);
      try {
        const crudaAuto = await openrouterChat(cfg.apiKey, construirCuerpoOR({
          modelo: cadenaAuto.modelo,
          respaldos: cadenaAuto.respaldos,
          politica: cfg.politica,
          system: sys, user: usr, maxTokens, razonamiento: 'bajo',
        }), Date.now() + 25000);
        data = normalizarRespuestaOR(crudaAuto);
      } catch (err2) {
        err = err2;
      }
    }
    if (!data) {
      console.warn(`[${modo}] OpenRouter falló:`, (err && (err.upstreamStatus || err.message)) || err);
      const e = new Error('openrouter');
      e.status = 503;
      e.mensaje = err?.politicaImposible
        ? 'Ningún modelo gratuito cumple hoy la política de datos configurada — avisale al admin.'
        : err?.sinCredito
          ? 'El servicio de OpenRouter no tiene saldo disponible (402) y la cadena gratuita tampoco respondió. Revisa tu cuenta de OpenRouter o reintenta en un momento.'
          : t.auto
            ? 'Ni los modelos gratuitos ni el respaldo de pago respondieron (suele ser saturación pasajera). Tocá el botón otra vez.'
            : 'El modelo elegido no respondió (suele estar saturado unos segundos). Tocá el botón otra vez.';
      throw e;
    }
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

/**
 * EL RAZONAMIENTO, CORTADO DONDE TERMINA UNA PALABRA (tanda 8, 15-set-2026).
 *
 * Gabriel: «las recomendaciones de IA en la clasificación a veces quedan
 * minimizadas por el tamaño de la ventana de recomendación». Una parte era el
 * ancho del cuadro (se arregló en la pantalla) y la otra era este corte: 300
 * caracteres a cuchillo, en el medio de la palabra («…recubrimientos químicos o
 * p»). El argumento es lo ÚNICO que tiene quien decide para juzgar la
 * propuesta; mostrar la mitad de una frase es peor que mostrar una frase corta.
 *
 * 600 y no más: sigue siendo una explicación, no un ensayo — el prompt pide
 * «una frase corta y concreta» y eso no cambió.
 */
function razonamientoLimpio(txt, max = 600) {
  const t = String(txt || '').trim();
  if (t.length <= max) return t;
  const cortado = t.slice(0, max);
  const hastaPalabra = cortado.replace(/\s+\S*$/, '');
  return `${hastaPalabra || cortado}…`;
}

/** Una sola forma de contestar el error de las tres ayudas. */
function responderErrorIA(res, e) {
  if (e?.mensaje) return res.status(e.status || 502).json({ error: e.mensaje });
  if (e?.name === 'AbortError') return res.status(504).json({ error: 'La IA tardó demasiado. Tocá el botón otra vez.' });
  return res.status(502).json({ error: 'No se pudo consultar la IA. Tocá el botón otra vez.' });
}

/** El árbol que dijo la IA para su clasificación nueva; null si dijo cualquier cosa. */
const arbolNuevo = (v) => {
  const t = String(v || '').trim().toLowerCase();
  return t === 'servicio' || t === 'insumo' ? t : null;
};

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
  // EL PROMPT VIVE EN `lib/prompt-clasificacion.js` (tanda 2): el piloto que
  // compara modelos tiene que medir EXACTAMENTE este texto, no una copia que
  // se le parezca. Dos copias divergen a la primera corrección que se hace en
  // una sola de las dos.
  // El precio unitario en SOLES, si el cliente lo pudo calcular (tanda 8). Un
  // 0 o un negativo NO es precio: se descarta acá además de en el cliente — ver
  // `precioUnitarioDeFila` y el bloque del prompt.
  const precioCrudo = Number(body.precio_unitario);
  const precioUnitario = Number.isFinite(precioCrudo) && precioCrudo > 0 ? precioCrudo : null;
  // LO QUE VINO EN LA MISMA FACTURA (tanda 9). Lo arma el cliente con
  // `vecindarioDeFactura()`: son las otras líneas del comprobante donde esta
  // descripción pesó más. Se topea acá también — el cliente ya manda 8, pero
  // el body lo escribe el navegador y un pedido con 500 vecinos sería un prompt
  // pagado por alguien que no lo pidió.
  const vecinos = Array.isArray(body.vecinos) ? body.vecinos.slice(0, 8) : [];
  const proveedor = sanitizeForPrompt(body.proveedor, 80);
  const { sys, usr, codigosValidos } = promptClasificacion({
    descripcion, unidad, candidatos, precioUnitario, vecinos, proveedor,
    evidencia: body.evidencia,
    evidenciaPropia: body.evidencia_propia,
    propuestaLocal: body.propuesta_local,
    // Las reglas de los pares difíciles que dispara ESTA descripción, ya
    // filtradas contra los candidatos (tanda 3). Las calcula el cliente, como
    // la evidencia: el diccionario y las reglas viajan en el bundle.
    desempates: body.desempates,
  });

  try {
    const { parsed, data } = await pedirJsonALaIA({ sys, usr, maxTokens: 1200, modo: 'clasificar_insumo_iupc', elegido: body.modelo_texto });
    const codigoSugerido = String(parsed.codigo_sugerido || '').trim();
    const confianza = typeof parsed.confianza === 'number' ? Math.max(0, Math.min(1, parsed.confianza)) : 0.5;

    // ── «NO SÉ» ES UNA RESPUESTA (tanda 3, 15-set-2026) ──────────────
    // Hasta acá el modelo estaba OBLIGADO a elegir: la única salida era
    // proponer un código fuera de la lista, que se descarta con un mensaje que
    // suena a error técnico («propuso un código fuera de la lista»). O sea que
    // la duda honesta y la alucinación terminaban en el mismo cajón, y en el
    // medio el modelo aprendía que lo barato es elegir la menos mala.
    //
    // Ahora hay dos caminos para decir «no sé»: el explícito (NO_SE) y el
    // implícito (eligió algo pero con menos de 0,40 de confianza, que su propio
    // prompt define como «no elijas»). Los dos devuelven `no_se: true` y
    // `result: null` — no hay nada que aceptar de un click— y la razón viaja
    // igual, porque decir POR QUÉ no se sabe es la mitad del trabajo de quien
    // va a decidir a mano.
    const UMBRAL_NO_SE = 0.40;
    const dijoNoSe = /^no[_\s-]?se$/i.test(codigoSugerido);
    if (dijoNoSe || (codigosValidos.has(codigoSugerido) && confianza < UMBRAL_NO_SE)) {
      return res.status(200).json({
        result: null,
        no_se: true,
        confianza,
        razonamiento: razonamientoLimpio(parsed.razonamiento)
          || 'La IA no encontró con qué decidir. Hay que clasificarla a mano.',
        // Lo que igual llegó a mirar, para que la persona no arranque de cero.
        casi: !dijoNoSe && codigosValidos.has(codigoSugerido) ? codigoSugerido : null,
        clasificacion_nueva: String(parsed.clasificacion_nueva || '').trim().slice(0, 80) || null,
        clasificacion_nueva_arbol: arbolNuevo(parsed.clasificacion_nueva_arbol),
        _model: data.model, _usage: data.usage,
      });
    }

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
      result: {
        codigo_sugerido: codigoSugerido, alternativas,
        clasificacion_nueva: nueva || null,
        // A qué árbol iría la clasificación nueva (tanda 8). Sin esto el
        // cliente tenía que adivinarlo del nombre para poder crearla bien.
        clasificacion_nueva_arbol: nueva ? arbolNuevo(parsed.clasificacion_nueva_arbol) : null,
      },
      confianza,
      razonamiento: razonamientoLimpio(parsed.razonamiento),
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
//
// ── LA UNIDAD (tanda 2, 15-set-2026) ──────────────────────────────
// Hasta hoy acá llegaban SOLO los nombres. Medido en producción: de los 160
// pares ya decididos a mano, trece «mismo insumo» se facturan en unidades
// incompatibles (alambre kg/und, tubo m/und, botas par/und, tarugo docena/und).
// Con esas uniones el inventario deja dos cantidades que nadie puede sumar y
// el comparador de precios se apaga solo. Ahora la unidad viaja como dato
// junto a cada nombre y el criterio está en el prompt: es una SEÑAL, no un
// veredicto — la misma regla que ya usa `mapear_insumo_presupuesto`.
async function correlacionarInsumosIA(req, res, body) {
  // 🔴 De-duplicar POR ÍNDICE, no con un Set suelto (tanda 2): `unidades` es
  // paralelo a `variantes` y un Set reordenaría el nombre sin su unidad.
  const crudas = Array.isArray(body.variantes) ? body.variantes : [];
  const crudasU = Array.isArray(body.unidades) ? body.unidades : [];
  const vistos = new Set();
  const variantes = [];
  const unidades = [];
  for (let i = 0; i < crudas.length && variantes.length < 20; i++) {
    const v = sanitizeForPrompt(String(crudas[i]), 160);
    if (!v || vistos.has(v)) continue;
    vistos.add(v);
    variantes.push(v);
    unidades.push(sanitizeForPrompt(String(crudasU[i] ?? ''), 24));
  }
  if (variantes.length < 2) {
    return res.status(422).json({ error: 'Se requieren al menos 2 variantes' });
  }
  const validos = new Set(variantes);
  // La unidad va como dato AL LADO del nombre, nunca pegada adentro: lo que
  // la IA tiene que copiar en `mismas` es el nombre exacto y nada más.
  const lista = variantes
    .map((v, i) => `${i + 1}. "${v}"${unidades[i] ? `   [se factura en: ${unidades[i]}]` : ''}`)
    .join('\n');

  const sys = `Eres un experto en insumos y servicios de construcción civil en Perú. Te dan una lista de NOMBRES tal como los escribieron distintos proveedores en sus facturas, y tenés que decir cuáles son EL MISMO artículo escrito distinto y cuáles no.

Reglas de criterio:
- El mismo artículo escrito distinto SÍ se une: "Clavo número 3" = "Clavos N3" = "Clavo de 3 pulgadas"; "Cemento Sol tipo I" = "Cemento Portland Tipo I".
- Las MEDIDAS mandan y casi nunca perdonan: una "REDUCCION 1\\" X 1/2" NO es una "REDUCCION 2 1/2\\" A 1", aunque las palabras sean casi iguales. Lo mismo con diámetros, espesores, largos, potencias y capacidades distintas.
- El MATERIAL manda: PVC no es fierro galvanizado aunque la pieza sea la misma.
- Una MARCA distinta del mismo artículo con la misma medida SÍ es el mismo insumo.
- El color, la presentación o el proveedor no hacen dos insumos distintos si el artículo y la medida son iguales.
- La UNIDAD en la que se factura (cuando te la den entre corchetes) es un dato, no un veredicto: el mismo alambre puede venir en kilos y en unidades, y el mismo tubo en metros y en unidades. Una unidad distinta NO descarta por sí sola que sean el mismo insumo — después se aplica un factor de conversión.
- Pero SÍ es una señal de alerta: si además de la unidad hay algo más que no cuadra (la medida, el material, el tipo de artículo), inclinate por separarlos. Y si dos nombres que parecen iguales se facturan en unidades que miden cosas distintas (peso contra largo, por ejemplo), decilo en el razonamiento para que la persona lo revise.

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
    const { parsed, data } = await pedirJsonALaIA({ sys, usr, maxTokens: 1200, modo: 'correlacionar_insumos', elegido: body.modelo_texto });
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

    // ── EL AVISO DE UNIDAD NO SE LE DELEGA AL MODELO (15-set, tarde) ──
    // Gabriel probó la IA en un par de unidades distintas: «la verdad no me
    // mencionó las unidades». El prompt lo pide, pero pedirlo no es tenerlo:
    // el razonamiento es UNA frase corta, el modelo gratuito no está obligado
    // a obedecer y la información más cara de perder quedaba librada a eso.
    //
    // El server YA SABE si las unidades difieren —las recibió— así que el
    // aviso lo arma él y va SIEMPRE. Lo que decide la IA sigue siendo qué es
    // el mismo artículo; lo que no puede fallar es que la persona vea que
    // está por unir kilos con unidades.
    const unidadPorNombre = new Map(variantes.map((v, i) => [v, unidades[i]]));
    const unidadesUnidas = [...new Set(mismas.map(n => unidadPorNombre.get(n)).filter(Boolean))];
    const avisoUnidad = unidadesUnidas.length > 1
      ? ` ⚠ Ojo: las que marca como iguales se facturan en ${unidadesUnidas.map(u => `«${u}»`).join(' y ')}.`
        + ' Puede ser el mismo insumo en otra presentación, pero al unirlas sus cantidades quedan en filas separadas'
        + ' en el inventario hasta que exista el factor de conversión.'
      : '';

    return res.status(200).json({
      result: { mismas, fuera, canonico },
      confianza: typeof parsed.confianza === 'number' ? Math.max(0, Math.min(1, parsed.confianza)) : 0.5,
      razonamiento: String(parsed.razonamiento || '').slice(0, 300) + avisoUnidad,
      // Las unidades TAL COMO SE MANDARON, para que la pantalla pueda mostrar
      // qué vio la IA. Sin esto, «no mencionó las unidades» y «no le llegaron»
      // son indistinguibles desde afuera.
      unidades: variantes.map((v, i) => ({ nombre: v, unidad: unidades[i] || null })),
      unidades_en_conflicto: unidadesUnidas.length > 1,
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
    const { parsed, data } = await pedirJsonALaIA({ sys, usr, maxTokens: 1200, modo: 'mapear_insumo_presupuesto', elegido: body.modelo_texto });
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
  // (Misma función serverless — se prefiere multiplexar aunque la cuenta es
  // Pro y ya no tiene el tope de 12 de Hobby.)
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
