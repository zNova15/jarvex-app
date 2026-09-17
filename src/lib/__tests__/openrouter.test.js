import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  leerConfig, construirCuerpo, normalizarRespuesta, errorDelCuerpo, openrouterChat,
  presupuestoSalida, MODELO_DEFAULT, MODELO_FALLBACK_DEFAULT, MAX_MODELOS_CADENA,
  armarCadenaOpenRouter,
} from '../../../lib/openrouter.js';

// El adaptador vive en /lib (lo consume api/captura-magica.js, que no se
// testea) pero su lógica pura sí se testea acá, que es donde corre vitest.

describe('leerConfig — el motor no se prende solo', () => {
  it('sin OPENROUTER_API_KEY queda inactivo: desplegar el código no cambia nada', () => {
    expect(leerConfig({}).activo).toBe(false);
  });

  it('con key queda activo y usa los modelos por defecto', () => {
    const c = leerConfig({ OPENROUTER_API_KEY: 'sk-or-x' });
    expect(c.activo).toBe(true);
    expect(c.modelo).toBe(MODELO_DEFAULT);
    expect(c.respaldos).toEqual(MODELO_FALLBACK_DEFAULT.split(','));
  });

  it('la cadena por defecto tiene exactamente 1 respaldo gratuito (total 2 modelos gratuitos)', () => {
    // La cadena gratuita tiene 2 modelos en total (titular + 1 respaldo) para
    // dejar libre el 3er lugar si el usuario elige un modelo en otra herramienta
    // (categorización, correlación, mapeo) respetando el límite de 3 de OpenRouter.
    const c = leerConfig({ OPENROUTER_API_KEY: 'k' });
    expect(c.respaldos).toEqual(['inclusionai/ling-3.0-flash-vl:free']);
    expect(c.respaldos.length).toBe(1);
  });

  it('IA_POSTPROCESO=anthropic revierte SIN borrar la key (rollback de un env var)', () => {
    const c = leerConfig({ OPENROUTER_API_KEY: 'sk-or-x', IA_POSTPROCESO: 'anthropic' });
    expect(c.activo).toBe(false);
    expect(c.apiKey).toBe('sk-or-x');
  });

  it('los respaldos se leen separados por coma y sin el titular repetido', () => {
    const c = leerConfig({
      OPENROUTER_API_KEY: 'k',
      OPENROUTER_STRUCT_MODEL: 'a/uno:free',
      OPENROUTER_STRUCT_FALLBACK: ' a/uno:free , b/dos:free ,, c/tres:free ',
    });
    expect(c.modelo).toBe('a/uno:free');
    expect(c.respaldos).toEqual(['b/dos:free', 'c/tres:free']);
  });

  it('se puede quedar sin respaldo a propósito (cadena vacía)', () => {
    expect(leerConfig({ OPENROUTER_API_KEY: 'k', OPENROUTER_STRUCT_FALLBACK: '' }).respaldos).toEqual([]);
  });

  it('la política por defecto es la MÁS estricta (zdr), no la permisiva', () => {
    expect(leerConfig({ OPENROUTER_API_KEY: 'k' }).politica).toBe('zdr');
    expect(leerConfig({ OPENROUTER_API_KEY: 'k', OPENROUTER_DATA_POLICY: 'deny' }).politica).toBe('deny');
    // Un valor basura NO debe degradar la privacidad en silencio.
    expect(leerConfig({ OPENROUTER_API_KEY: 'k', OPENROUTER_DATA_POLICY: 'lo-que-sea' }).politica).toBe('zdr');
  });
});

describe('presupuestoSalida — el techo de Claude corta a los que razonan', () => {
  // Medido el 5-sep-2026 contra ling-3.0-flash-fin con el prompt de producción.
  const techoDeClaude = (items) => Math.min(16000, Math.max(4000, 900 + items * 55));

  it('la factura de 60 ítems entra: con el techo de Claude (4200) se cortaba en 6811', () => {
    expect(techoDeClaude(60)).toBe(4200);          // lo que había → truncaba
    expect(presupuestoSalida(60)).toBeGreaterThan(6811);
  });

  it('una factura corta también tiene aire para el razonamiento (~1600 tokens)', () => {
    expect(presupuestoSalida(3)).toBeGreaterThanOrEqual(6000);
  });

  it('siempre da MÁS que el techo de Claude — nunca menos', () => {
    for (const n of [0, 1, 5, 20, 60, 100, 200]) {
      expect(presupuestoSalida(n)).toBeGreaterThanOrEqual(techoDeClaude(n));
    }
  });

  it('no se pasa del techo del modelo aunque la factura sea absurda', () => {
    expect(presupuestoSalida(100000)).toBe(16000);
  });

  it('entradas basura no producen un techo inválido', () => {
    expect(presupuestoSalida(0)).toBe(6000);
    expect(presupuestoSalida(-5)).toBe(6000);
    expect(presupuestoSalida(NaN)).toBe(6000);
    expect(presupuestoSalida(undefined)).toBe(6000);
  });
});

describe('construirCuerpo — la política de datos viaja en CADA llamada', () => {
  const base = { system: 'sys', user: 'usr', maxTokens: 4000 };

  it('zdr exige Zero Data Retention al enrutador', () => {
    const b = construirCuerpo({ modelo: 'a/uno', politica: 'zdr', ...base });
    expect(b.provider.zdr).toBe(true);
    expect(b.provider.data_collection).toBeUndefined();
  });

  it('deny pide "no entrenes con esto" cuando no hay endpoint ZDR', () => {
    const b = construirCuerpo({ modelo: 'a/uno', politica: 'deny', ...base });
    expect(b.provider.data_collection).toBe('deny');
    expect(b.provider.zdr).toBeUndefined();
  });

  it('nunca manda un cuerpo sin política: es lo que hace que falle CERRADO', () => {
    const b = construirCuerpo({ modelo: 'a/uno', ...base });
    expect(b.provider.zdr === true || b.provider.data_collection === 'deny').toBe(true);
  });

  it('la cadena de respaldo va en models[], para no gastar otro round-trip', () => {
    const b = construirCuerpo({ modelo: 'a/uno', respaldos: ['b/dos'], ...base });
    expect(b.model).toBe('a/uno');
    expect(b.models).toEqual(['a/uno', 'b/dos']);
  });

  // ── EL TOPE DE TRES (regresión del apagón del 15-set-2026) ──────
  // OpenRouter rechaza con 400 "'models' array must have 3 items or fewer"
  // CUALQUIER cadena más larga, y el rechazo se lleva puesto al titular, que
  // andaba bien. Ese día la cadena pasó a 4 y Captura Mágica dejó de leer TODA
  // factura en producción: cada lectura caía al respaldo de Claude —que estaba
  // sin saldo— y el mensaje que veía la almacenera hablaba de crédito, no de
  // configuración. Estos tests son la puerta que impide repetirlo.
  it('nunca manda más de 3 modelos: con 4, OpenRouter rechaza la request ENTERA', () => {
    const b = construirCuerpo({ modelo: 'a/uno', respaldos: ['b/dos', 'c/tres', 'd/cuatro'], ...base });
    expect(b.models).toHaveLength(3);
    expect(b.models).toEqual(['a/uno', 'b/dos', 'c/tres']);
  });

  it('una lista larga DEGRADA (se usan los 3 primeros), no rompe', () => {
    // OPENROUTER_STRUCT_FALLBACK se configura en Vercel sin pasar por ningún
    // test: el recorte tiene que estar acá, no en el default.
    const b = construirCuerpo({ modelo: 'a/uno', respaldos: ['b/2', 'c/3', 'd/4', 'e/5', 'f/6'], ...base });
    expect(b.models).toHaveLength(MAX_MODELOS_CADENA);
    expect(b.model).toBe('a/uno');
  });

  it('el titular SIEMPRE sobrevive al recorte: es el único medido', () => {
    const b = construirCuerpo({ modelo: 'titular/x', respaldos: Array.from({ length: 9 }, (_, i) => `r/${i}`), ...base });
    expect(b.models[0]).toBe('titular/x');
    expect(b.model).toBe('titular/x');
  });

  it('sin respaldo no manda models[] (un array de uno solo no aporta)', () => {
    expect(construirCuerpo({ modelo: 'a/uno', respaldos: [], ...base }).models).toBeUndefined();
  });

  it('temperatura 0: la misma factura tiene que leerse igual dos veces', () => {
    expect(construirCuerpo({ modelo: 'a/uno', ...base }).temperature).toBe(0);
  });

  it('el prompt de sistema y el texto del OCR van en mensajes separados', () => {
    const b = construirCuerpo({ modelo: 'a/uno', ...base });
    expect(b.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ]);
    expect(b.max_tokens).toBe(4000);
  });
});

describe('normalizarRespuesta — traduce OpenAI a la forma de Anthropic', () => {
  const resp = (choice, extra = {}) => ({ choices: [choice], ...extra });

  it('el texto queda donde extractJson lo busca: content[0].text', () => {
    const n = normalizarRespuesta(resp({ message: { content: '{"a":1}' }, finish_reason: 'stop' }));
    expect(n.content[0].text).toBe('{"a":1}');
    expect(n.stop_reason).toBe('end_turn');
  });

  it('finish_reason "length" se traduce a max_tokens — es lo que dispara "documento muy extenso"', () => {
    const n = normalizarRespuesta(resp({ message: { content: '{"a":' }, finish_reason: 'length' }));
    expect(n.stop_reason).toBe('max_tokens');
  });

  it('borra el <think> de los modelos de razonamiento: una llave suelta ahí rompe el parseo', () => {
    const crudo = '<think>miro la tabla { y dudo }</think>\n{"tipo_documento":"factura"}';
    const n = normalizarRespuesta(resp({ message: { content: crudo }, finish_reason: 'stop' }));
    expect(n.content[0].text).toBe('{"tipo_documento":"factura"}');
    // La prueba de fuego: el regex de extractJson va de la PRIMERA { a la ÚLTIMA }.
    expect(JSON.parse(n.content[0].text.match(/\{[\s\S]*\}/)[0]).tipo_documento).toBe('factura');
  });

  it('acepta content como array de bloques (algunos proveedores lo mandan así)', () => {
    const n = normalizarRespuesta(resp({ message: { content: [{ text: '{"a":' }, { text: '1}' }] } }));
    expect(n.content[0].text).toBe('{"a":1}');
  });

  it('si el modelo dejó el content vacío y puso todo en reasoning, ahí está el JSON', () => {
    const n = normalizarRespuesta(resp({ message: { content: '', reasoning: '{"a":1}' } }));
    expect(n.content[0].text).toBe('{"a":1}');
  });

  it('mapea el usage a input_tokens/output_tokens (los que loguea [ia-uso])', () => {
    const n = normalizarRespuesta(resp({ message: { content: '{}' } }, {
      usage: { prompt_tokens: 4321, completion_tokens: 765, cost: 0 }, model: 'x/y:free', provider: 'Novita',
    }));
    expect(n.usage).toEqual({ input_tokens: 4321, output_tokens: 765 });
    expect(n.model).toBe('x/y:free');
    expect(n.proveedor).toBe('Novita');
    expect(n.costo).toBe(0);
  });

  it('reporta el modelo REALMENTE servido, que puede no ser el titular de la cadena', () => {
    const n = normalizarRespuesta(resp({ message: { content: '{}' } }, { model: 'b/dos:free' }));
    expect(n.model).toBe('b/dos:free');
  });

  it('una respuesta sin choices no explota: devuelve texto vacío', () => {
    expect(normalizarRespuesta({}).content[0].text).toBe('');
    expect(normalizarRespuesta(null).content[0].text).toBe('');
  });
});

describe('errorDelCuerpo — la trampa del 200 con error adentro', () => {
  it('sin error devuelve null', () => {
    expect(errorDelCuerpo({ choices: [] })).toBe(null);
    expect(errorDelCuerpo(null)).toBe(null);
  });

  it('429 del proveedor de abajo es reintentable', () => {
    const e = errorDelCuerpo({ error: { code: 429, message: 'rate-limited', metadata: { provider_name: 'GMICloud' } } });
    expect(e.reintentable).toBe(true);
    expect(e.proveedor).toBe('GMICloud');
  });

  it('404 de política de datos NO es reintentable: reintentar no cambia quién cumple', () => {
    const e = errorDelCuerpo({ error: { code: 404, message: 'No endpoints found matching your data policy (Zero data retention).' } });
    expect(e.politicaImposible).toBe(true);
    expect(e.reintentable).toBe(false);
  });

  it('un 404 común no se confunde con el de política', () => {
    expect(errorDelCuerpo({ error: { code: 404, message: 'No allowed providers' } }).politicaImposible).toBe(false);
  });

  it('402 se marca como falta de crédito (mismo aviso que el de Anthropic)', () => {
    expect(errorDelCuerpo({ error: { code: 402, message: 'insufficient credits' } }).sinCredito).toBe(true);
  });

  it('5xx es transitorio', () => {
    expect(errorDelCuerpo({ error: { code: 503, message: 'upstream down' } }).reintentable).toBe(true);
  });
});

describe('openrouterChat — el 200 con error NO se puede dar por bueno', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const respuesta = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });

  it('un 429 disfrazado de HTTP 200 se trata como error, no como respuesta válida', async () => {
    // Verificado contra OpenRouter el 5-sep-2026: cuando el proveedor de abajo
    // tira 429, la respuesta llega con HTTP **200** y el error en el body. Un
    // `if (!res.ok)` a secas la daba por buena y el fallo aparecía después
    // disfrazado de "la IA no devolvió JSON".
    const fetchMock = vi.fn(async () => respuesta({ error: { code: 429, message: 'rate-limited' } }, 200));
    vi.stubGlobal('fetch', fetchMock);
    await expect(openrouterChat('k', {}, Date.now() + 60000, { intentos: 1 })).rejects.toMatchObject({
      upstreamStatus: 429,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('devuelve el cuerpo crudo cuando la respuesta es buena de verdad', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta({ choices: [{ message: { content: '{}' } }] })));
    const d = await openrouterChat('k', {}, Date.now() + 60000);
    expect(d.choices[0].message.content).toBe('{}');
  });

  it('el 404 de política no se reintenta (fallar rápido y decir la verdad)', async () => {
    const fetchMock = vi.fn(async () => respuesta({ error: { code: 404, message: 'No endpoints found matching your data policy' } }, 404));
    vi.stubGlobal('fetch', fetchMock);
    await expect(openrouterChat('k', {}, Date.now() + 60000, { intentos: 3 }))
      .rejects.toMatchObject({ politicaImposible: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('manda la key como Bearer y se identifica como JARVEX', async () => {
    const fetchMock = vi.fn(async () => respuesta({ choices: [{ message: { content: '{}' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    await openrouterChat('sk-or-secreta', { model: 'a/uno' }, Date.now() + 60000);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer sk-or-secreta');
    expect(init.headers['X-Title']).toBe('JARVEX');
    expect(JSON.parse(init.body).model).toBe('a/uno');
  });
});

describe('armarCadenaOpenRouter — cadena de 2 para auto, y 3 con modelo elegido', () => {
  it('en modo auto usa exactamente 2 modelos (titular + 1 respaldo gratuito)', () => {
    const c = armarCadenaOpenRouter('auto');
    expect(c.modelo).toBe(MODELO_DEFAULT);
    expect(c.respaldos).toEqual([MODELO_FALLBACK_DEFAULT]);
    const total = [c.modelo, ...c.respaldos];
    expect(total).toHaveLength(2);
  });

  it('sin parámetro (null o undefined) se comporta como auto (2 modelos)', () => {
    const c1 = armarCadenaOpenRouter(null);
    expect([c1.modelo, ...c1.respaldos]).toHaveLength(2);

    const c2 = armarCadenaOpenRouter(undefined);
    expect([c2.modelo, ...c2.respaldos]).toHaveLength(2);
  });

  it('con modelo elegido usa el elegido + 2 gratuitos como respaldo (exactamente 3 modelos)', () => {
    const c = armarCadenaOpenRouter('openai/gpt-oss-120b');
    expect(c.modelo).toBe('openai/gpt-oss-120b');
    expect(c.respaldos).toEqual([MODELO_DEFAULT, MODELO_FALLBACK_DEFAULT]);
    const total = [c.modelo, ...c.respaldos];
    expect(total).toHaveLength(3);
    expect(total).toHaveLength(MAX_MODELOS_CADENA);
  });

  it('construirCuerpo con armarCadenaOpenRouter nunca supera el límite de 3 de OpenRouter', () => {
    const base = { system: 'sys', user: 'usr', maxTokens: 1000 };

    const autoCadena = armarCadenaOpenRouter('auto');
    const bAuto = construirCuerpo({ ...autoCadena, ...base });
    expect(bAuto.models).toHaveLength(2);

    const elegidoCadena = armarCadenaOpenRouter('openai/gpt-oss-120b');
    const bElegido = construirCuerpo({ ...elegidoCadena, ...base });
    expect(bElegido.models).toHaveLength(3);
    expect(bElegido.models.length).toBeLessThanOrEqual(MAX_MODELOS_CADENA);
  });

  it('si el elegido ya es uno de los gratuitos, no se duplica', () => {
    const c = armarCadenaOpenRouter(MODELO_DEFAULT);
    expect(c.modelo).toBe(MODELO_DEFAULT);
    expect(c.respaldos).not.toContain(MODELO_DEFAULT);
    const total = [c.modelo, ...c.respaldos];
    expect(total.length).toBeLessThanOrEqual(MAX_MODELOS_CADENA);
  });

  it('respeta la configuración pasada en cfg', () => {
    const customCfg = {
      modelo: 'mi/titular:free',
      respaldos: ['mi/respaldo:free'],
    };
    const cAuto = armarCadenaOpenRouter('auto', customCfg);
    expect(cAuto.modelo).toBe('mi/titular:free');
    expect(cAuto.respaldos).toEqual(['mi/respaldo:free']);

    const cElegido = armarCadenaOpenRouter('anthropic/claude-3-haiku', customCfg);
    expect(cElegido.modelo).toBe('anthropic/claude-3-haiku');
    expect(cElegido.respaldos).toEqual(['mi/titular:free', 'mi/respaldo:free']);
  });
});

