// Tests del PRE-FILTRO LOCAL de correlaciones (tanda 4).
//
// Lo que estos tests protegen no es «acierta mucho»: es que la banda `obvio`
// NUNCA se coma una diferencia real. Un falso `obvio` pone una propuesta verde
// al lado de dos insumos distintos y nadie vuelve a mirarla; un falso
// `consultar` cuesta 1,1 s. Por eso hay más casos de «esto SÍ se pregunta»
// que de «esto no hace falta preguntarlo».
import { describe, it, expect } from 'vitest';
import {
  bandaDePar, bandaDeGrupo, tokensDeBanda, contarPorBanda, CONFIANZA_OBVIO,
} from '../bandas-correlacion.js';

describe('bandaDePar — lo obvio no se pregunta', () => {
  it('plural y abreviatura del número: la misma frase escrita por dos personas', () => {
    const r = bandaDePar('CLAVO N 3', 'CLAVOS NRO 3');
    expect(r.banda).toBe('obvio');
    expect(r.razon).toBe('identico');
  });

  it('el orden de las palabras no hace dos insumos', () => {
    expect(bandaDePar('TUBO PVC 1/2"', 'PVC TUBO 1/2"').banda).toBe('obvio');
  });

  it('tildes, mayúsculas y puntuación no cuentan', () => {
    expect(bandaDePar('Cemento Portland, tipo I', 'CEMENTO PORTLAND TIPO I').banda).toBe('obvio');
  });

  it('unidad abreviada contra unidad escrita', () => {
    expect(bandaDePar('GUANTE BADANA 1 PZA', 'GUANTE BADANA 1 UNIDAD').banda).toBe('obvio');
  });

  it('el motivo se puede leer: dice por qué no hace falta preguntar', () => {
    const r = bandaDePar('CLAVO N 3', 'CLAVOS NRO 3');
    expect(r.motivo).toMatch(/dicen lo mismo/i);
  });
});

describe('bandaDePar — lo dudoso se consulta', () => {
  it('EL CASO DE GABRIEL: una trae la presentación y la otra no', () => {
    // «CEMENTO SOL» contra «CEMENTO SOL X 42.5 KG» puede ser el mismo insumo
    // con la presentación explícita, o no. Eso lo juzga la IA, no una tabla
    // de sinónimos.
    const r = bandaDePar('CEMENTO SOL', 'CEMENTO SOL X 42.5 KG');
    expect(r.banda).toBe('consultar');
    expect(r.razon).toBe('medida');
  });

  it('material distinto: PVC no es fierro galvanizado', () => {
    const r = bandaDePar('CODO PVC 1/2', 'CODO GALVANIZADO 1/2');
    expect(r.banda).toBe('consultar');
    expect(r.razon).toBe('palabra');
    expect(r.motivo).toMatch(/galvanizado|pvc/i);
  });

  it('marca contra genérico: es el mismo insumo, pero eso NO lo decide esta lib', () => {
    expect(bandaDePar('FIERRO CORRUGADO 1/2', 'FIERRO CORRUGADO ACEROS AREQUIPA 1/2').banda)
      .toBe('consultar');
  });

  it('mm y cm no son sinónimos (magnitudes distintas)', () => {
    expect(bandaDePar('PLANCHA 3 MM', 'PLANCHA 3 CM').banda).toBe('consultar');
  });

  it('kg no se confunde con gramos', () => {
    expect(bandaDePar('ALAMBRE 5 KG', 'ALAMBRE 5 G').banda).toBe('consultar');
  });

  it('las reducciones del 14-sep siguen siendo dos piezas distintas', () => {
    const r = bandaDePar('REDUCCION 1" X 1/2', 'REDUCCION 2 1/2" A 1');
    expect(r.banda).toBe('consultar');
  });

  it('un nombre sin palabras útiles se consulta en vez de romper', () => {
    expect(bandaDePar('', 'CLAVO N 3').banda).toBe('consultar');
    expect(bandaDePar(null, undefined).banda).toBe('consultar');
  });
});

describe('bandaDeGrupo — basta UN par dudoso para preguntar por todo el grupo', () => {
  it('tres formas de escribir lo mismo: no se pregunta', () => {
    const r = bandaDeGrupo(['CLAVO N 3', 'CLAVOS NRO 3', 'CLAVO NUMERO 3']);
    expect(r.banda).toBe('obvio');
    expect(r.dudosos).toHaveLength(0);
  });

  it('una intrusa arrastra al grupo entero a la IA', () => {
    const r = bandaDeGrupo(['CLAVO N 3', 'CLAVOS NRO 3', 'CLAVO N 4']);
    expect(r.banda).toBe('consultar');
    expect(r.dudosos.length).toBeGreaterThan(0);
    // El motivo tiene que servirle a una persona: nombra un ejemplo concreto.
    expect(r.motivo).toMatch(/Por ejemplo/);
  });

  it('prefiere contar una diferencia de MEDIDA antes que una de palabra', () => {
    const r = bandaDeGrupo(['TUBO PVC 1/2', 'TUBO PVC MEDIA', 'TUBO PVC 3/4']);
    expect(r.banda).toBe('consultar');
    expect(r.razon).toBe('medida');
  });

  it('con menos de dos variantes no hay grupo', () => {
    expect(bandaDeGrupo(['UNO SOLO']).banda).toBe('consultar');
    expect(bandaDeGrupo([]).banda).toBe('consultar');
  });

  it('los duplicados exactos no inventan un grupo de dos', () => {
    expect(bandaDeGrupo(['CLAVO N 3', 'CLAVO N 3']).banda).toBe('consultar');
  });
});

describe('tokensDeBanda', () => {
  it('canoniza sinónimos de escritura y saca el ruido', () => {
    expect(tokensDeBanda('CLAVOS NRO 3 POR UND')).toEqual(['clavos', 'n', '3', 'und']);
  });

  it('conserva la fracción como un solo token (es la medida)', () => {
    expect(tokensDeBanda('REDUCCION 1/2')).toContain('1∕2');
  });
});

describe('contarPorBanda', () => {
  it('separa lo que sale a la red de lo que no', () => {
    const r = contarPorBanda([{ banda: 'obvio' }, { banda: 'consultar' }, { banda: 'obvio' }, null]);
    expect(r).toEqual({ obvios: 2, consultas: 2, total: 4 });
  });
});

describe('CONFIANZA_OBVIO', () => {
  it('queda por encima del umbral del recorrido, pero no es un 100%', () => {
    expect(CONFIANZA_OBVIO).toBeGreaterThan(0.75);
    expect(CONFIANZA_OBVIO).toBeLessThan(1);
  });
});

// ── TANDA 2: la unidad entra a decidir ────────────────────────────────
// Los cuatro casos son REALES: salieron de medir los 160 pares ya decididos
// en producción el 15-set-2026. Trece «mismo insumo» se facturan en unidades
// incompatibles y varios de ellos caían en `obvio` — las palabras coinciden
// al 100% — así que se proponían sin preguntarle a nadie.
describe('bandaDePar — unidades (tanda 2)', () => {
  it('mismas palabras pero kg contra und: deja de ser obvio', () => {
    const sinUnidad = bandaDePar('ALAMBRE NEGRO 16', 'ALAMBRE NEGRO 16');
    expect(sinUnidad.banda).toBe('obvio');
    const r = bandaDePar('ALAMBRE NEGRO 16', 'ALAMBRE NEGRO 16', { unidadA: 'und', unidadB: 'kg' });
    expect(r.banda).toBe('consultar');
    expect(r.razon).toBe('unidad');
    expect(r.motivo).toMatch(/kg/);
  });

  it('el caso del tubo: metros contra unidades', () => {
    const r = bandaDePar('TUBO HDPE 110 MM', 'TUBO HDPE 110 MM', { unidadA: 'UND', unidadB: 'METROS' });
    expect(r.banda).toBe('consultar');
    expect(r.unidades).toEqual(expect.objectContaining({ a: 'und', b: 'm' }));
  });

  it('los sinónimos del OCR NO son un conflicto: und = unidad = each', () => {
    expect(bandaDePar('CLAVO N 3', 'CLAVOS NRO 3', { unidadA: 'UNIDAD', unidadB: 'each' }).banda).toBe('obvio');
  });

  it('una unidad ausente no inventa una duda', () => {
    expect(bandaDePar('CLAVO N 3', 'CLAVOS NRO 3', { unidadA: 'kg', unidadB: '' }).banda).toBe('obvio');
    expect(bandaDePar('CLAVO N 3', 'CLAVOS NRO 3', { unidadA: '', unidadB: '' }).banda).toBe('obvio');
  });

  it('si además sobra una medida, la medida sigue siendo la razón principal', () => {
    const r = bandaDePar('CEMENTO SOL', 'CEMENTO SOL X 42.5 KG', { unidadA: 'und', unidadB: 'bolsa' });
    expect(r.razon).toBe('medida');
    expect(r.unidades).not.toBe(null);
    expect(r.motivo).toMatch(/bolsa/);
  });

  it('la unidad NO decide sola: sigue siendo "consultar", nunca "distintos"', () => {
    // La lib no tiene una banda de rechazo a propósito — unir kg con und puede
    // ser correcto y necesitar un factor de conversión.
    const r = bandaDePar('ALAMBRE NEGRO 16', 'ALAMBRE NEGRO 16', { unidadA: 'und', unidadB: 'kg' });
    expect(['obvio', 'consultar']).toContain(r.banda);
    expect(r.banda).toBe('consultar');
  });
});

describe('bandaDeGrupo — unidades (tanda 2)', () => {
  const unidades = { 'BOTAS DE SEGURIDAD PUNTA DE ACERO': 'par', 'BOTAS SEGURIDAD PUNTA ACERO': 'und' };
  const unidadDe = (n) => unidades[n] || '';

  it('una sola variante en otra unidad manda el grupo entero a consultar', () => {
    const vars = ['BOTAS DE SEGURIDAD PUNTA DE ACERO', 'BOTAS SEGURIDAD PUNTA ACERO'];
    expect(bandaDeGrupo(vars).banda).toBe('obvio');
    const r = bandaDeGrupo(vars, { unidadDe });
    expect(r.banda).toBe('consultar');
    expect(r.razon).toBe('unidad');
  });

  it('sin unidadDe se comporta igual que antes (retrocompatible)', () => {
    expect(bandaDeGrupo(['CLAVO N 3', 'CLAVOS NRO 3', 'CLAVO NUMERO 3']).banda).toBe('obvio');
  });

  it('con todas en la misma unidad sigue siendo obvio', () => {
    const mismas = () => 'kg';
    expect(bandaDeGrupo(['CLAVO N 3', 'CLAVOS NRO 3'], { unidadDe: mismas }).banda).toBe('obvio');
  });
});
