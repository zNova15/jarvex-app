import { describe, it, expect } from 'vitest';
import {
  huellaDeHallazgo, unirListas, cabecerasQueNoCoinciden, fundirCabeceras,
  estabilidadDe, fusionarCorridas,
} from '../bases-corridas.js';

const req = (cita, extra = {}) => ({ cargo: 'Residente de Obra', fuente_cita: cita, verificada: true, ...extra });

describe('huellaDeHallazgo — la identidad es la cita', () => {
  it('dos lecturas del mismo requisito con la misma cita son el mismo hallazgo', () => {
    expect(huellaDeHallazgo(req('Ingeniero Civil con 36 meses'))).toBe(huellaDeHallazgo(req('ingeniero civil con 36 meses')));
  });

  it('cae a la descripción o al cargo cuando no hay cita', () => {
    expect(huellaDeHallazgo({ descripcion: 'Capacidad libre de contratación' })).toBeTruthy();
    expect(huellaDeHallazgo({ cargo: 'Especialista en Suelos' })).toBeTruthy();
    expect(huellaDeHallazgo({})).toBe('');
  });

  it('el mismo requisito con distinto tipo sigue siendo uno solo', () => {
    // Es el caso del 8-set con el artículo 117: misma cita, `tipo` distinto.
    const a = { tipo: 'otro', fuente_cita: 'Artículo 117 del Reglamento' };
    const b = { tipo: 'habilitacion', fuente_cita: 'Artículo 117 del Reglamento' };
    expect(huellaDeHallazgo(a)).toBe(huellaDeHallazgo(b));
  });
});

describe('unirListas — la unión, no la intersección', () => {
  it('lo que salió en las dos queda marcado como estable', () => {
    const out = unirListas([[req('A')], [req('A')]]);
    expect(out).toHaveLength(1);
    expect(out[0]._corridas).toBe(2);
    expect(out[0]._deCorridas).toBe(2);
    expect(out[0]._deTodas).toBe(true);
  });

  it('🔴 lo que salió en una sola NO se descarta: se marca', () => {
    // La regla del módulo: perder un requisito cuesta la postulación, mostrar
    // uno de más cuesta una mirada.
    const out = unirListas([[req('A')], [req('A'), req('B')]]);
    expect(out.map(x => x.fuente_cita)).toEqual(['A', 'B']);
    expect(out[1]._corridas).toBe(1);
    expect(out[1]._deTodas).toBe(false);
    expect(out[1]._corridasEn).toEqual([2]);
  });

  it('respeta el orden de la primera corrida y agrega atrás lo nuevo', () => {
    // Los requisitos van numerados por el orden en que aparecen en las bases,
    // y la primera lectura es la que lo tiene bien.
    const out = unirListas([[req('A'), req('B')], [req('C'), req('A')]]);
    expect(out.map(x => x.fuente_cita)).toEqual(['A', 'B', 'C']);
  });

  it('con tres corridas cuenta bien las intermedias', () => {
    const out = unirListas([[req('A')], [req('A'), req('B')], [req('B')]]);
    const b = out.find(x => x.fuente_cita === 'B');
    expect(b._corridas).toBe(2);
    expect(b._deCorridas).toBe(3);
    expect(b._deTodas).toBe(false);
  });

  it('lo que no tiene huella no entra (no se puede comparar)', () => {
    expect(unirListas([[{}], [{}]])).toHaveLength(0);
  });

  it('aguanta listas ausentes', () => {
    expect(unirListas([undefined, [req('A')]])).toHaveLength(1);
  });
});

describe('cabecerasQueNoCoinciden — el dato que llega prellenado', () => {
  it('marca el campo en el que las lecturas dan distinto', () => {
    const d = cabecerasQueNoCoinciden([{ valor_referencial: 1000, plazo: 90 }, { valor_referencial: 2000, plazo: 90 }]);
    expect(d).toHaveLength(1);
    expect(d[0].campo).toBe('valor_referencial');
    expect(d[0].valores.sort()).toEqual(['1000', '2000']);
  });

  it('«no lo encontré» no es una discrepancia', () => {
    // Una lectura que devolvió null y otra que devolvió el número NO discrepan:
    // se complementan, y así lo hace fundirCabeceras.
    expect(cabecerasQueNoCoinciden([{ cui: null }, { cui: '2456789' }])).toEqual([]);
    expect(cabecerasQueNoCoinciden([{ cui: '' }, { cui: '2456789' }])).toEqual([]);
  });

  it('sin cabeceras no hay nada que comparar', () => {
    expect(cabecerasQueNoCoinciden([])).toEqual([]);
    expect(cabecerasQueNoCoinciden([null, undefined])).toEqual([]);
  });
});

describe('fundirCabeceras — la primera manda, las siguientes llenan huecos', () => {
  it('el primer valor no vacío gana', () => {
    expect(fundirCabeceras([{ cui: '111', plazo: null }, { cui: '222', plazo: 90 }]))
      .toEqual({ cui: '111', plazo: 90 });
  });

  it('sin nada devuelve null, no un objeto vacío', () => {
    expect(fundirCabeceras([{ cui: null }, {}])).toBe(null);
    expect(fundirCabeceras([])).toBe(null);
  });
});

describe('estabilidadDe — el número que contesta «¿cuánto me fío?»', () => {
  it('cuenta los estables sobre el total', () => {
    const filas = unirListas([[req('A'), req('B')], [req('A')]]);
    expect(estabilidadDe([filas])).toMatchObject({ total: 2, estables: 1, inestables: 1, pct: 50 });
  });

  it('sin hallazgos el porcentaje es null, no 100 ni 0', () => {
    expect(estabilidadDe([[]]).pct).toBe(null);
  });
});

// ── El resultado completo ──────────────────────────────────────────
const corrida = (over = {}) => ({
  markdown: '<!-- página 1 -->\ntexto',
  paginasOcr: 5, reusado: false,
  filas: [req('A')], filasEmpresa: [], cronograma: [], extras: {
    factores_evaluacion: [], garantias: [], penalidades: [], documentos_presentacion: [], condiciones: [],
  },
  extrasDudosos: [], cabecera: null, alertas: [], alertasDeTramo: [], modelos: ['modelo-x'],
  costo: { ocr: 0.01, pasadas: 0, total: 0.01 },
  ...over,
});

describe('fusionarCorridas', () => {
  it('con una sola corrida devuelve esa corrida tal cual', () => {
    const a = corrida();
    expect(fusionarCorridas([a])).toBe(a);
    expect(fusionarCorridas([])).toBe(null);
  });

  it('conserva del PRIMERO lo que es del documento y no del modelo', () => {
    // markdown, paginasOcr y reusado son lo que la caché necesita guardar: si
    // la fusión los perdiera, el escaneo se volvería a pagar.
    const r = fusionarCorridas([corrida(), corrida({ markdown: 'otro', paginasOcr: 0, reusado: true })]);
    expect(r.markdown).toBe('<!-- página 1 -->\ntexto');
    expect(r.paginasOcr).toBe(5);
    expect(r.reusado).toBe(false);
  });

  it('EL OCR SE COBRA UNA VEZ Y LAS PASADAS CADA VEZ', () => {
    const r = fusionarCorridas([
      corrida({ costo: { ocr: 0.19, pasadas: 0.02, total: 0.21 } }),
      corrida({ costo: { ocr: 0, pasadas: 0.03, total: 0.03 } }),
    ]);
    expect(r.costo).toEqual({ ocr: 0.19, pasadas: 0.05, total: expect.closeTo(0.24, 5) });
  });

  it('avisa cuántos hallazgos salieron en una sola lectura', () => {
    const r = fusionarCorridas([corrida({ filas: [req('A'), req('B')] }), corrida({ filas: [req('A')] })]);
    expect(r.corridas).toBe(2);
    expect(r.estabilidad).toMatchObject({ total: 2, estables: 1, inestables: 1 });
    expect(r.alertas.some(a => /salieron en solo una de las lecturas/.test(a))).toBe(true);
    expect(r.filas.find(f => f.fuente_cita === 'B')._deTodas).toBe(false);
  });

  it('sin diferencias no mete la alerta de inestabilidad', () => {
    const r = fusionarCorridas([corrida(), corrida()]);
    expect(r.estabilidad.inestables).toBe(0);
    expect(r.alertas.some(a => /una sola de las lecturas/.test(a))).toBe(false);
  });

  it('avisa el campo de cabecera en el que no coincidieron y deja el primero', () => {
    const r = fusionarCorridas([
      corrida({ cabecera: { valor_referencial: 1000 } }),
      corrida({ cabecera: { valor_referencial: 9999 } }),
    ]);
    expect(r.cabecera.valor_referencial).toBe(1000);
    expect(r.cabeceraDiscrepa).toEqual([{ campo: 'valor_referencial', valores: ['1000', '9999'] }]);
    expect(r.alertas.some(a => /no coinciden en «valor_referencial»/.test(a))).toBe(true);
  });

  it('el calendario se une por etapa+fecha y sale ordenado', () => {
    const et = (etapa, desde) => ({ etapa, desde, verificada: true });
    const r = fusionarCorridas([
      corrida({ cronograma: [et('Consultas', '2026-10-05'), et('Buena pro', '2026-11-20')] }),
      corrida({ cronograma: [et('Consultas', '2026-10-05'), et('Integración', '2026-10-30')] }),
    ]);
    expect(r.cronograma.map(e => e.desde)).toEqual(['2026-10-05', '2026-10-30', '2026-11-20']);
    expect(r.cronograma[0]._deTodas).toBe(true);
    expect(r.cronograma[1]._deTodas).toBe(false);
  });

  it('junta los modelos servidos sin repetir: es lo que dice QUIÉN leyó', () => {
    const r = fusionarCorridas([corrida({ modelos: ['a'] }), corrida({ modelos: ['a', 'b'] })]);
    expect(r.modelos.sort()).toEqual(['a', 'b']);
  });

  it('extrasDudosos sigue siendo una lista, no un contador', () => {
    const r = fusionarCorridas([
      corrida({ extrasDudosos: [{ fuente_cita: 'dudosa' }] }),
      corrida({ extrasDudosos: [{ fuente_cita: 'dudosa' }] }),
    ]);
    expect(Array.isArray(r.extrasDudosos)).toBe(true);
    expect(r.extrasDudosos).toHaveLength(1);
  });

  it('las listas del contrato también se unen y se marcan', () => {
    const g = (detalle) => ({ tipo: 'fiel_cumplimiento', detalle, fuente_cita: detalle, verificada: true });
    const r = fusionarCorridas([
      corrida({ extras: { ...corrida().extras, garantias: [g('10% del contrato')] } }),
      corrida({ extras: { ...corrida().extras, garantias: [g('10% del contrato'), g('adelanto 30%')] } }),
    ]);
    expect(r.extras.garantias).toHaveLength(2);
    expect(r.extras.garantias.find(x => x.detalle === 'adelanto 30%')._corridas).toBe(1);
  });
});
