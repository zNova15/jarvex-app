import { describe, it, expect } from 'vitest';
import { stockContraPlan } from '../simulador-stock.js';

// Nombres REALES del almacén y del presupuesto de Miraflores (24-set-2026).
const linea = (clave, nombre, extra = {}) => ({
  clave, insumo_codigo: clave, nombre, unidad: 'und', categoria: 'herramientas', ...extra,
});
const LINEAS = [
  linea('830020051', 'ZAPATOS PUNTA DE ACERO', { unidad: 'par' }),
  linea('830020006', 'CASCOS DE SEGURIDAD'),
  linea('830020021', 'CORTAVIENTO PARA CASCO'),
  linea('830020040', 'GUANTES DE JEBE', { unidad: 'par' }),
  linea('830020039', 'GUANTES DE CUERO', { unidad: 'par' }),
  linea('830020001', 'BARBIQUEJO'),
  // Un material del plan: no se compara contra el almacén de herramientas.
  linea('210020001', 'CEMENTO PORTLAND TIPO I (42.5 kg)', { categoria: 'materiales', unidad: 'bol' }),
];
const SOBRES = [
  { clave: 'herramientas manuales|%mo', nombre: 'HERRAMIENTAS MANUALES' },
  { clave: 'acarreo|glb', nombre: 'ACARREO A MANO O ACEMILA' },
];
let n = 0;
const item = (tabla, nombre, stock, extra = {}) => ({
  tabla, id: `a${++n}`, nombre, unidad: 'Und', entradas: stock, stock,
  imputacion: null, insumo_codigo: null, factor_presupuesto: null, ...extra,
});

describe('herramientas y EPP contra el stock (tanda 3.5)', () => {
  it('lo IMPUTADO a un insumo del plan se muestra como ya restado', () => {
    const r = stockContraPlan({
      almacen: [item('epps', 'BARBIQUEJOS', 16, { imputacion: 'insumo', insumo_codigo: '830020001' })],
      lineas: LINEAS, sobres: SOBRES,
    });
    const e = r.porClave.get('830020001');
    expect(e.imputados).toHaveLength(1);
    expect(e.stockImputado).toBe(16);
    expect(e.parecidos).toEqual([]);
    expect(r.resumen.imputados).toBe(1);
  });

  it('lo parecido por nombre se muestra, con la palabra principal en común', () => {
    const r = stockContraPlan({
      almacen: [item('epps', 'ZAPATOS 41', 2, { unidad: 'PAR' }), item('epps', 'CORTAVIENTOS', 12)],
      lineas: LINEAS, sobres: SOBRES,
    });
    expect(r.porClave.get('830020051').parecidos.map(p => p.nombre)).toEqual(['ZAPATOS 41']);
    expect(r.porClave.get('830020021').parecidos.map(p => p.nombre)).toEqual(['CORTAVIENTOS']);
    expect(r.resumen.parecidos).toBe(2);
    expect(r.resumen.lineasConStock).toBe(2);
  });

  it('«PUNTA» (de barreta) NO se parece a «ZAPATOS PUNTA DE ACERO»: la primera palabra manda', () => {
    const r = stockContraPlan({ almacen: [item('herramientas', 'PUNTA', 1)], lineas: LINEAS, sobres: SOBRES });
    expect(r.porClave.has('830020051')).toBe(false);
    expect(r.sueltas.herramientas.map(s => s.nombre)).toEqual(['PUNTA']);
  });

  it('con un empate no elige: aparece en todas las líneas que empatan', () => {
    const r = stockContraPlan({ almacen: [item('epps', 'GUANTES', 16, { unidad: 'PAR' })], lineas: LINEAS, sobres: SOBRES });
    expect(r.porClave.get('830020040').parecidos).toHaveLength(1);
    expect(r.porClave.get('830020039').parecidos).toHaveLength(1);
    // Cuenta como UN ítem parecido, no dos.
    expect(r.resumen.parecidos).toBe(1);
  });

  it('lo que no se parece a nada: herramientas al sobre de herramientas, EPPs aparte', () => {
    const r = stockContraPlan({
      almacen: [
        item('herramientas', 'CONOS', 12), item('herramientas', 'PALA CUCHARA', 4),
        item('epps', 'MASCARILLAS DESECHABLES', 47),
      ],
      lineas: LINEAS, sobres: SOBRES,
    });
    expect(r.sobreHerramientas).toBe('herramientas manuales|%mo');
    expect(r.sueltas.herramientas.map(s => s.nombre)).toEqual(['CONOS', 'PALA CUCHARA']);   // por stock
    expect(r.sueltas.epps.map(s => s.nombre)).toEqual(['MASCARILLAS DESECHABLES']);
  });

  it('«ya hay» es lo que HAY: sin stock no se muestra', () => {
    const r = stockContraPlan({
      almacen: [item('herramientas', 'CARRETILLA', 0, { entradas: 3 }), item('epps', 'ZAPATOS 40', 0)],
      lineas: LINEAS, sobres: SOBRES,
    });
    expect(r.resumen.items).toBe(2);
    expect(r.resumen.conStock).toBe(0);
    expect(r.porClave.size).toBe(0);
    expect(r.sueltas.herramientas).toEqual([]);
  });

  it('lo marcado fuera del presupuesto, los materiales y los grupos no entran', () => {
    const r = stockContraPlan({
      almacen: [
        item('epps', 'AGUA OXIGENADA', 1, { imputacion: 'fuera' }),
        item('materiales', 'CEMENTO', 62),
        item('epps', 'Zapatos', 0, { es_grupo: true }),
        // Imputado a un insumo que no es herramienta: es asunto del material.
        item('materiales', 'CEMENTO SOL', 10, { imputacion: 'insumo', insumo_codigo: '210020001' }),
      ],
      lineas: LINEAS, sobres: SOBRES,
    });
    expect(r.resumen.items).toBe(0);
    expect(r.resumen.imputados).toBe(0);
    expect(r.porClave.size).toBe(0);
  });

  it('sin sobre de herramientas en el plan, las sueltas igual se listan', () => {
    const r = stockContraPlan({ almacen: [item('herramientas', 'COMBA', 2)], lineas: LINEAS, sobres: [] });
    expect(r.sobreHerramientas).toBeNull();
    expect(r.sueltas.herramientas).toHaveLength(1);
  });
});
