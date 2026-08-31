// Tests de la clasificación contable de dos niveles (src/lib/clasificacion-contable.js).
// Nace del pedido de las contadoras (31-ago-2026): 'expense' estaba MUERTO en
// producción (0 filas) y los S/264 mil de Gastos Generales viajaban escondidos
// dentro de "Costos" en el Estado de Resultados.
import { describe, it, expect } from 'vitest';
import {
  derivarTypeContable, nivelUno, destinoEfectivo, motivoClasificacion,
  typeIncoherente, overrideManual, overrideEfectivo, INGRESO, EGRESO, DESTINO_A_TYPE,
} from '../clasificacion-contable.js';

describe('nivelUno — ingreso o egreso', () => {
  it('manda la clase', () => {
    expect(nivelUno({ clase: 'venta' })).toBe(INGRESO);
    expect(nivelUno({ clase: 'compra' })).toBe(EGRESO);
  });

  it('sin clase (22 filas históricas en producción) cae al type de la fila', () => {
    expect(nivelUno({ clase: null, type: 'income' })).toBe(INGRESO);
    expect(nivelUno({ clase: null, type: 'cost' })).toBe(EGRESO);
    expect(nivelUno({ clase: null, type: 'expense' })).toBe(EGRESO);
    expect(nivelUno({})).toBe(EGRESO);
  });

  it('la clase gana sobre un type contradictorio', () => {
    expect(nivelUno({ clase: 'venta', type: 'cost' })).toBe(INGRESO);
  });
});

describe('destinoEfectivo', () => {
  it('usa destino_contable cuando existe', () => {
    expect(destinoEfectivo({ destino_contable: 'gastos_generales', obra_id: 'o1' })).toBe('gastos_generales');
  });

  it('movimientos anteriores a la mig 139 (destino null): la obra lo implica', () => {
    expect(destinoEfectivo({ destino_contable: null, obra_id: 'o1' })).toBe('obra');
    expect(destinoEfectivo({ destino_contable: null, obra_id: null })).toBe(null);
  });
});

describe('derivarTypeContable — nivel 2', () => {
  it('venta → income, mire donde mire el destino', () => {
    expect(derivarTypeContable({ clase: 'venta', destino_contable: 'gastos_generales' })).toBe('income');
    expect(derivarTypeContable({ clase: 'venta', destino_contable: 'obra', is_intercompany: true })).toBe('income');
  });

  it('compra vinculada a OBRA → cost', () => {
    expect(derivarTypeContable({ clase: 'compra', destino_contable: 'obra', obra_id: 'o1' })).toBe('cost');
    expect(derivarTypeContable({ clase: 'compra', destino_contable: null, obra_id: 'o1' })).toBe('cost');
  });

  it('compra a GASTOS GENERALES → expense (lo que arregla el backfill de las 276)', () => {
    expect(derivarTypeContable({ clase: 'compra', destino_contable: 'gastos_generales' })).toBe('expense');
  });

  it('contabilidad neta / sin clasificar / sin vinculación → cost (decisión conservadora)', () => {
    expect(derivarTypeContable({ clase: 'compra', destino_contable: 'contabilidad_neta' })).toBe('cost');
    expect(derivarTypeContable({ clase: 'compra', destino_contable: 'sin_clasificar' })).toBe('cost');
    expect(derivarTypeContable({ clase: 'compra', destino_contable: null, obra_id: null })).toBe('cost');
  });

  // ⚠ REGLA DURA — si esto se rompe, el Consolidado deja de cuadrar.
  it('INTERCOMPANY es SIEMPRE cost, aunque el destino diga gastos generales', () => {
    expect(derivarTypeContable({
      clase: 'compra', destino_contable: 'gastos_generales', is_intercompany: true,
    })).toBe('cost');
    expect(derivarTypeContable({
      clase: 'compra', destino_contable: 'sin_clasificar', obra_id: null, is_intercompany: true,
    })).toBe('cost');
  });

  it('is_intercompany falsy no fuerza nada', () => {
    expect(derivarTypeContable({ clase: 'compra', destino_contable: 'gastos_generales', is_intercompany: false })).toBe('expense');
    expect(derivarTypeContable({ clase: 'compra', destino_contable: 'gastos_generales', is_intercompany: null })).toBe('expense');
  });

  it('el mapa de destinos no deja ningún valor del CHECK de la mig 139 sin cubrir', () => {
    expect(Object.keys(DESTINO_A_TYPE).sort())
      .toEqual(['contabilidad_neta', 'gastos_generales', 'obra', 'sin_clasificar']);
  });

  it('nunca devuelve algo fuera del CHECK de la tabla', () => {
    const casos = [
      {}, { clase: 'venta' }, { clase: 'compra' }, { type: 'expense' },
      { clase: 'compra', destino_contable: 'basura' },
      { clase: 'BASURA', type: 'income' },
    ];
    casos.forEach(c => expect(['income', 'cost', 'expense']).toContain(derivarTypeContable(c)));
    expect(derivarTypeContable(null)).toBe('cost');
  });
});

describe('typeIncoherente — auditoría del dato viejo', () => {
  it('detecta las 276 filas de gastos generales guardadas como cost', () => {
    expect(typeIncoherente({ clase: 'compra', destino_contable: 'gastos_generales', type: 'cost' })).toBe(true);
  });

  it('no marca las que ya están bien', () => {
    expect(typeIncoherente({ clase: 'compra', destino_contable: 'obra', type: 'cost' })).toBe(false);
    expect(typeIncoherente({ clase: 'compra', destino_contable: 'gastos_generales', type: 'expense' })).toBe(false);
    expect(typeIncoherente({ clase: 'compra', is_intercompany: true, destino_contable: 'obra', type: 'cost' })).toBe(false);
  });

  it('una fila sin type no es incoherente (todavía no se clasificó)', () => {
    expect(typeIncoherente({ clase: 'compra' })).toBe(false);
  });
});

describe('motivoClasificacion', () => {
  it('explica el intercompany como regla dura', () => {
    expect(motivoClasificacion({ clase: 'compra', is_intercompany: true })).toMatch(/Consolidado/);
  });
  it('explica el gasto general', () => {
    expect(motivoClasificacion({ clase: 'compra', destino_contable: 'gastos_generales' })).toMatch(/GASTO/);
  });
  it('explica el costo de obra', () => {
    expect(motivoClasificacion({ clase: 'compra', obra_id: 'o1' })).toMatch(/OBRA/);
  });
  it('siempre devuelve texto', () => {
    [null, {}, { clase: 'venta' }, { clase: 'compra', destino_contable: 'contabilidad_neta' },
     { clase: 'compra', destino_contable: 'sin_clasificar' }].forEach(c => {
      expect(typeof motivoClasificacion(c)).toBe('string');
      expect(motivoClasificacion(c).length).toBeGreaterThan(10);
    });
  });
});

// ─────────────────────────────────────────────────────────────
// OVERRIDE MANUAL (columna clasificacion_manual, mig 163)
// Pedido de Gabriel: hay compras vinculadas a una OBRA que igual son GASTO
// administrativo. Antes la única forma de marcarlas gasto era desvincularlas
// de la obra, y así se perdía la atribución.
// ─────────────────────────────────────────────────────────────
describe('derivarTypeContable — ajuste manual', () => {
  it('fuerza GASTO una compra vinculada a una obra', () => {
    const mov = { clase: 'compra', destino_contable: 'obra', obra_id: 'o1', clasificacion_manual: 'expense' };
    expect(derivarTypeContable(mov)).toBe('expense');
    expect(overrideEfectivo(mov)).toBe(true);
  });

  it('fuerza COSTO algo vinculado a Gastos Generales', () => {
    const mov = { clase: 'compra', destino_contable: 'gastos_generales', clasificacion_manual: 'cost' };
    expect(derivarTypeContable(mov)).toBe('cost');
    expect(overrideEfectivo(mov)).toBe(true);
  });

  // ⚠ La regla dura está POR ENCIMA del ajuste manual.
  it('NO puede convertir un intercompany en gasto', () => {
    const mov = { clase: 'compra', destino_contable: 'obra', is_intercompany: true, clasificacion_manual: 'expense' };
    expect(derivarTypeContable(mov)).toBe('cost');
    expect(overrideEfectivo(mov)).toBe(false);
    expect(motivoClasificacion(mov)).toMatch(/NO se aplica/i);
  });

  it('no toca las ventas', () => {
    const mov = { clase: 'venta', clasificacion_manual: 'expense' };
    expect(derivarTypeContable(mov)).toBe('income');
    expect(overrideEfectivo(mov)).toBe(false);
  });

  it('un valor basura en la columna se ignora (vale la vinculación)', () => {
    ['', null, undefined, 'income', 'GASTO', 0].forEach(v => {
      expect(derivarTypeContable({ clase: 'compra', destino_contable: 'gastos_generales', clasificacion_manual: v })).toBe('expense');
    });
  });

  it('un ajuste que COINCIDE con la vinculación no se marca como override efectivo', () => {
    const mov = { clase: 'compra', destino_contable: 'obra', clasificacion_manual: 'cost' };
    expect(derivarTypeContable(mov)).toBe('cost');
    expect(overrideEfectivo(mov)).toBe(false);
    expect(motivoClasificacion(mov)).toMatch(/coincide/i);
  });

  it('volver a "Automático" (null) devuelve el mando a la vinculación', () => {
    const conAjuste = { clase: 'compra', destino_contable: 'obra', clasificacion_manual: 'expense' };
    expect(derivarTypeContable(conAjuste)).toBe('expense');
    expect(derivarTypeContable({ ...conAjuste, clasificacion_manual: null })).toBe('cost');
  });

  it('el motivo explica el conflicto con la vinculación', () => {
    const txt = motivoClasificacion({ clase: 'compra', destino_contable: 'obra', clasificacion_manual: 'expense' });
    expect(txt).toMatch(/GASTO/);
    expect(txt).toMatch(/Autom/i);
  });
});
