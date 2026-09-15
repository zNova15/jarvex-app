import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clasificarInsumoConIA, correlacionarConIA, mapearInsumoConIA, notaDeIA, esDecisionDeIA, MARCA_IA } from '../ia-insumos.js';

function setupLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}


// apiParse() (la regla de api-client.js) lee resp.text(), no resp.json():
// los mocks tienen que espejar eso.
const respOk = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) });
const respErr = (status, obj) => ({ ok: false, status, text: async () => JSON.stringify(obj) });

const CANDIDATOS = [
  { codigo: '37', nombre: '[37] Herramienta manual' },
  { codigo: '83', nombre: '[83] Implemento y accesorio de seguridad' },
];

beforeEach(() => {
  setupLocalStorage();
  vi.restoreAllMocks();
});

describe('clasificarInsumoConIA', () => {
  it('sin descripción o sin candidatos, no llama al endpoint', async () => {
    globalThis.fetch = vi.fn();
    expect(await clasificarInsumoConIA({ descripcion: '', candidatos: CANDIDATOS })).toEqual({ result: null, razonamiento: '' });
    expect(await clasificarInsumoConIA({ descripcion: 'algo', candidatos: [] })).toEqual({ result: null, razonamiento: '' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('llama al endpoint con action clasificar_insumo_iupc y devuelve la sugerencia', async () => {
    const respMock = {
      result: { codigo_sugerido: '83', alternativas: [] },
      confianza: 0.92,
      razonamiento: 'Es ropa de trabajo con cinta reflectiva: EPP, no herramienta.',
    };
    globalThis.fetch = vi.fn().mockResolvedValue(respOk(respMock));
    const r = await clasificarInsumoConIA({
      descripcion: 'PANTALON Y CAMISACO DE DRILL OBRERO AZUL CON CINTA REFLECTIVA',
      candidatos: CANDIDATOS,
    });
    expect(r.result.codigo_sugerido).toBe('83');
    expect(r.confianza).toBe(0.92);
    const [, opts] = globalThis.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.action).toBe('clasificar_insumo_iupc');
    expect(body.candidatos).toEqual(CANDIDATOS.map(c => ({ codigo: c.codigo, nombre: c.nombre })));
  });

  // 🔴 EL ARREGLO DEL 15-sep. Sin el Anexo 2 delante, el modelo clasificaba de
  // memoria: "ALAMBRE DE AMARRE #8" salía [48] Maquinaria liviana. Estos dos
  // campos son lo que lo apoya en la norma en vez de en su intuición.
  it('manda la EVIDENCIA del diccionario oficial y la propuesta del motor local', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respOk({
      result: { codigo_sugerido: '37', alternativas: [] }, confianza: 0.8, razonamiento: 'ok',
    }));
    await clasificarInsumoConIA({
      descripcion: 'ALAMBRE DE AMARRE #8',
      candidatos: CANDIDATOS,
      propuestaLocal: { codigo: '02', nombre: '[02] Acero de construcción liso', motivos: ['familia ferretería'] },
    });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(Array.isArray(body.evidencia)).toBe(true);
    expect(body.evidencia.length).toBeGreaterThan(0);
    expect(body.evidencia[0].codigo).toBe('02');
    expect(body.evidencia[0].terminos.join(' ').toLowerCase()).toMatch(/alambre/);
    expect(body.propuesta_local).toMatchObject({ codigo: '02', motivo: 'familia ferretería' });
  });

  // 🔴 TANDA 3. Las reglas de los pares difíciles las calcula el CLIENTE (el
  // diccionario y las reglas viajan en el bundle) y viajan con la pregunta:
  // el motor local y la IA contestan con la misma regla delante o se
  // contradicen entre ellos.
  it('manda las REGLAS DE DESEMPATE que dispara esta descripción', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respOk({
      result: { codigo_sugerido: '83', alternativas: [] }, confianza: 0.9, razonamiento: 'ok',
    }));
    await clasificarInsumoConIA({
      descripcion: 'GUANTE DE ACERO ANTICORTE DE MALLA METALICA',
      candidatos: CANDIDATOS,
    });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.desempates).toHaveLength(1);
    expect(body.desempates[0].id).toBe('epp-vs-material');
  });

  it('una descripción sin par difícil no agrega reglas a la pregunta', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respOk({
      result: { codigo_sugerido: '37', alternativas: [] }, confianza: 0.8, razonamiento: 'ok',
    }));
    await clasificarInsumoConIA({ descripcion: 'CEMENTO PORTLAND TIPO I 42.5 KG', candidatos: CANDIDATOS });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.desempates).toEqual([]);
  });

  // 🔴 «No sé» es una respuesta, no una falla (tanda 3). Y NO se cachea: una
  // duda honesta puede cambiar en cuanto alguien le enseñe un término al
  // diccionario, así que guardarla 30 días congelaría el «no sé» justo cuando
  // deja de ser cierto.
  it('un «no sé» de la IA vuelve tal cual y NO se cachea', async () => {
    const noSe = { result: null, no_se: true, confianza: 0.2, razonamiento: 'Dice solo una marca y un número.' };
    globalThis.fetch = vi.fn().mockResolvedValue(respOk(noSe));
    const r1 = await clasificarInsumoConIA({ descripcion: 'ART 4477 BLANCO', candidatos: CANDIDATOS });
    expect(r1.no_se).toBe(true);
    expect(r1.razonamiento).toMatch(/marca/);
    const r2 = await clasificarInsumoConIA({ descripcion: 'ART 4477 BLANCO', candidatos: CANDIDATOS });
    expect(r2._cached).toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('sin propuesta local manda null, no un objeto a medio llenar', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respOk({
      result: { codigo_sugerido: '37', alternativas: [] }, confianza: 0.8, razonamiento: 'ok',
    }));
    await clasificarInsumoConIA({ descripcion: 'TORNILLO AUTORROSCANTE', candidatos: CANDIDATOS });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.propuesta_local).toBeNull();
  });

  it('cachea por descripción: segunda llamada no repite el request', async () => {
    const respMock = { result: { codigo_sugerido: '37', alternativas: [] }, confianza: 0.7, razonamiento: 'ok' };
    globalThis.fetch = vi.fn().mockResolvedValue(respOk(respMock));
    const r1 = await clasificarInsumoConIA({ descripcion: 'Llave stillson', candidatos: CANDIDATOS });
    expect(r1._cached).toBeUndefined();
    const r2 = await clasificarInsumoConIA({ descripcion: '  LLAVE STILLSON  ', candidatos: CANDIDATOS });
    expect(r2._cached).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('propaga el error del endpoint (para poder reintentar con el botón)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respErr(503, {
      error: 'El modelo gratuito no respondió (suele estar saturado unos segundos). Tocá el botón otra vez.',
    }));
    await expect(
      clasificarInsumoConIA({ descripcion: 'Cemento', candidatos: CANDIDATOS })
    ).rejects.toThrow(/gratuito no respondió/i);
  });

  it('cuando la IA propone algo fuera de la lista, result viene null (no se inventa nada)', async () => {
    const respMock = { result: null, razonamiento: 'La IA propuso un código fuera de la lista ("99") — no se aplicó nada.' };
    globalThis.fetch = vi.fn().mockResolvedValue(respOk(respMock));
    const r = await clasificarInsumoConIA({ descripcion: 'Algo raro', candidatos: CANDIDATOS });
    expect(r.result).toBeNull();
    expect(r.razonamiento).toMatch(/fuera de la lista/);
  });

  it('una NO-respuesta no se cachea: el botón puede volver a preguntar', async () => {
    // Cachear un `result: null` 30 días convierte el «tocá el botón otra vez»
    // en mentira: devolvería la misma no-respuesta para siempre.
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(respOk({ result: null, razonamiento: 'nada usable' }))
      .mockResolvedValueOnce(respOk({ result: { codigo_sugerido: '83', alternativas: [] }, confianza: 0.9, razonamiento: 'ahora sí' }));
    const r1 = await clasificarInsumoConIA({ descripcion: 'Casco', candidatos: CANDIDATOS });
    expect(r1.result).toBeNull();
    const r2 = await clasificarInsumoConIA({ descripcion: 'Casco', candidatos: CANDIDATOS });
    expect(r2.result?.codigo_sugerido).toBe('83');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('correlacionarConIA', () => {
  it('con menos de dos variantes no llama al endpoint', async () => {
    globalThis.fetch = vi.fn();
    expect(await correlacionarConIA({ variantes: ['uno'] })).toEqual({ result: null, razonamiento: '' });
    expect(await correlacionarConIA({ variantes: ['x', 'x'] })).toEqual({ result: null, razonamiento: '' }); // duplicada
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('manda las variantes y devuelve mismas/fuera', async () => {
    const respMock = {
      result: { mismas: ['Clavo N3', 'Clavo numero 3'], fuera: ['Clavo de 4'], canonico: 'Clavo numero 3' },
      confianza: 0.9, razonamiento: 'Mismo clavo, distinta escritura; el de 4 es otra medida.',
    };
    globalThis.fetch = vi.fn().mockResolvedValue(respOk(respMock));
    const r = await correlacionarConIA({ variantes: ['Clavo N3', 'Clavo numero 3', 'Clavo de 4'] });
    expect(r.result.mismas).toHaveLength(2);
    expect(r.result.fuera).toEqual(['Clavo de 4']);
    const [, opts] = globalThis.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.action).toBe('correlacionar_insumos');
    expect(body.variantes).toHaveLength(3);
  });

  it('la clave de cache es el CONJUNTO, no el orden', async () => {
    const respMock = { result: { mismas: [], fuera: ['a', 'b'], canonico: null }, confianza: 0.4, razonamiento: 'distintos' };
    globalThis.fetch = vi.fn().mockResolvedValue(respOk(respMock));
    await correlacionarConIA({ variantes: ['Tubo A', 'Tubo B'] });
    const r2 = await correlacionarConIA({ variantes: ['Tubo B', 'Tubo A'] });
    expect(r2._cached).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('mapearInsumoConIA', () => {
  const PRESU = [
    { codigo: 'I001', nombre: 'ACERO CORRUGADO fy=4200 Ø 1/2"', unidad: 'kg', clasificacion: '[03] Acero corrugado' },
    { codigo: 'I002', nombre: 'CEMENTO PORTLAND TIPO I', unidad: 'bls', clasificacion: '[21] Cemento' },
  ];

  it('sin insumo o sin candidatos, no llama al endpoint', async () => {
    globalThis.fetch = vi.fn();
    expect(await mapearInsumoConIA({ insumo: '', candidatos: PRESU })).toEqual({ result: null, razonamiento: '' });
    expect(await mapearInsumoConIA({ insumo: 'Fierro', candidatos: [] })).toEqual({ result: null, razonamiento: '' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('manda el insumo con sus candidatos del presupuesto', async () => {
    const respMock = { result: { codigo_sugerido: 'I001', alternativas: [] }, confianza: 0.88, razonamiento: 'Mismo fierro de 1/2.' };
    globalThis.fetch = vi.fn().mockResolvedValue(respOk(respMock));
    const r = await mapearInsumoConIA({
      insumo: 'FIERRO CORRUGADO 1/2', unidad: 'var', clasificacion: '[03] Acero corrugado',
      candidatos: PRESU, obraId: 'obra-1',
    });
    expect(r.result.codigo_sugerido).toBe('I001');
    const [, opts] = globalThis.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.action).toBe('mapear_insumo_presupuesto');
    expect(body.candidatos[0]).toEqual({ codigo: 'I001', nombre: PRESU[0].nombre, unidad: 'kg', clasificacion: PRESU[0].clasificacion });
  });

  it('si el presupuesto se reimportó y el código guardado ya no existe, se vuelve a preguntar', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respOk({ result: { codigo_sugerido: 'I001', alternativas: [] }, confianza: 0.9, razonamiento: 'ok' }));
    await mapearInsumoConIA({ insumo: 'FIERRO 1/2', candidatos: PRESU, obraId: 'o1' });
    // Mismo insumo, misma obra, pero el presupuesto ya no tiene I001.
    const otroPresu = [{ codigo: 'Z999', nombre: 'OTRA COSA', unidad: 'und', clasificacion: '' }];
    const r = await mapearInsumoConIA({ insumo: 'FIERRO 1/2', candidatos: otroPresu, obraId: 'o1' });
    expect(r._cached).toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('la cache distingue por obra: el mismo insumo en otro presupuesto se pregunta de nuevo', async () => {
    const respMock = { result: { codigo_sugerido: 'I001', alternativas: [] }, confianza: 0.8, razonamiento: 'ok' };
    globalThis.fetch = vi.fn().mockResolvedValue(respOk(respMock));
    await mapearInsumoConIA({ insumo: 'FIERRO 1/2', candidatos: PRESU, obraId: 'obra-1' });
    const r2 = await mapearInsumoConIA({ insumo: 'FIERRO 1/2', candidatos: PRESU, obraId: 'obra-1' });
    expect(r2._cached).toBe(true);
    const r3 = await mapearInsumoConIA({ insumo: 'FIERRO 1/2', candidatos: PRESU, obraId: 'obra-2' });
    expect(r3._cached).toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

// ── La marca «Recomendado por IA» ─────────────────────────────────
// Pedido de Gabriel (14-sep): «quiero saber qué insumo he aceptado como
// recomendación yo». Va en `nota` y no en `fuente` — ver MARCA_IA.
describe('notaDeIA / esDecisionDeIA', () => {
  it('la nota lleva la marca y el porcentaje, y se reconoce después', () => {
    const nota = notaDeIA(0.87);
    expect(nota.startsWith(MARCA_IA)).toBe(true);
    expect(nota).toMatch(/87%/);
    expect(esDecisionDeIA({ nota })).toBe(true);
  });

  it('sin confianza no inventa un porcentaje', () => {
    expect(notaDeIA(null)).toBe(`${MARCA_IA} Aceptado de la recomendación de IA`);
  });

  // La marca tiene que sobrevivir a que se le pegue algo atrás: el alta
  // desde la bandeja concatena su propia nota después.
  it('reconoce la marca aunque la nota siga con otra cosa', () => {
    expect(esDecisionDeIA({ nota: `${notaDeIA(0.9)} · Alta desde la bandeja` })).toBe(true);
  });

  it('una decisión de siempre NO queda marcada', () => {
    expect(esDecisionDeIA({ nota: 'Alta desde la bandeja' })).toBe(false);
    expect(esDecisionDeIA({ nota: null })).toBe(false);
    expect(esDecisionDeIA(null)).toBe(false);
  });
});
