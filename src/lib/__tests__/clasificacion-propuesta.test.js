// ═══════════════════════════════════════════════════════════════════
// CREAR LA CLASIFICACIÓN QUE PROPONE LA IA — sin duplicar lo que ya existe.
// Gabriel, 15-set: «cuidado duplique, me pareció que recomendó crear una
// clasificación que ya existía».
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  prepararClasificacionNueva, arbolDeNombre, limpiarNombre, codigoLibre, parecidoNombres,
} from '../clasificacion-propuesta.js';

const CATS = [
  { codigo: '51', nombre: 'Pinturas', label: '[51] Pinturas', arbol: 'insumo' },
  { codigo: 'S13', nombre: 'Servicios básicos', label: '[S13] Servicios básicos', arbol: 'servicio' },
  { codigo: 'administrativos', nombre: 'Consumos administrativos / Oficina', label: 'Consumos administrativos / Oficina', arbol: 'complementaria' },
  {
    codigo: 'PI-PINT-BARN', arbol: 'insumo', propia: true,
    nombre: 'Pinturas, barnices y recubrimientos químicos anticorrosivos',
    label: '[PI-PINT-BARN] Pinturas, barnices y recubrimientos químicos anticorrosivos',
  },
];

describe('el nombre que llega de la IA', () => {
  it('se limpia y queda presentable', () => {
    expect(limpiarNombre('  «gastos financieros e intereses».  ')).toBe('Gastos financieros e intereses');
  });

  it('vacío no es un nombre', () => {
    expect(limpiarNombre('   ')).toBe('');
    expect(prepararClasificacionNueva({ nombre: '', cats: CATS }).ok).toBe(false);
  });
});

describe('a qué árbol va cuando la IA no lo dice', () => {
  it('«Gastos financieros e intereses» es un servicio', () => {
    expect(arbolDeNombre('Gastos financieros e intereses')).toBe('servicio');
  });

  it('«Alquiler de andamios» es un servicio', () => {
    expect(arbolDeNombre('Alquiler de andamios')).toBe('servicio');
  });

  it('«Pinturas y barnices» es un insumo', () => {
    expect(arbolDeNombre('Pinturas y barnices')).toBe('insumo');
  });

  it('si la IA lo dice, manda la IA', () => {
    const r = prepararClasificacionNueva({ nombre: 'Pinturas raras', arbol: 'servicio', cats: CATS });
    expect(r.arbol).toBe('servicio');
  });
});

describe('🔴 no duplicar', () => {
  it('si ya existe una propia con ese nombre, se ofrece ésa y no se crea otra', () => {
    const r = prepararClasificacionNueva({
      nombre: 'Pinturas, barnices y recubrimientos químicos anticorrosivos', cats: CATS,
    });
    expect(r.yaExiste?.codigo).toBe('PI-PINT-BARN');
  });

  it('también contra la base OFICIAL: si la norma ya lo tiene, no se crea una propia', () => {
    const r = prepararClasificacionNueva({ nombre: 'pinturas', cats: CATS });
    expect(r.yaExiste?.codigo).toBe('51');
  });

  it('avisa de las parecidas aunque no sean idénticas', () => {
    const r = prepararClasificacionNueva({ nombre: 'Pinturas y barnices anticorrosivos', cats: CATS });
    expect(r.yaExiste).toBeNull();
    expect(r.parecidas.map(p => p.cat.codigo)).toContain('PI-PINT-BARN');
  });

  it('una clasificación nueva de verdad no dispara ninguna alarma', () => {
    const r = prepararClasificacionNueva({ nombre: 'Geotextiles y geomembranas', cats: CATS });
    expect(r.yaExiste).toBeNull();
    expect(r.parecidas).toHaveLength(0);
    expect(r.ok).toBe(true);
  });

  it('las complementarias compiten en el árbol de insumos', () => {
    const r = prepararClasificacionNueva({ nombre: 'Consumos administrativos / Oficina', cats: CATS });
    expect(r.yaExiste?.codigo).toBe('administrativos');
  });
});

describe('el código', () => {
  it('sale con prefijo propio y no pisa el espacio oficial', () => {
    const r = prepararClasificacionNueva({ nombre: 'Geotextiles y geomembranas', cats: CATS });
    expect(r.codigo.startsWith('PI-')).toBe(true);
  });

  it('el de servicios lleva PS-', () => {
    const r = prepararClasificacionNueva({ nombre: 'Gastos financieros e intereses', cats: CATS });
    expect(r.codigo.startsWith('PS-')).toBe(true);
  });

  it('si el sugerido ya está tomado, se numera', () => {
    const tomado = codigoLibre('Pinturas Barnices', 'insumo', []);
    const otro = codigoLibre('Pinturas Barnices', 'insumo', [{ codigo: tomado }]);
    expect(otro).toBe(`${tomado}-2`);
  });
});

describe('parecido de nombres', () => {
  it('dos iguales dan 1', () => {
    expect(parecidoNombres('Pinturas y barnices', 'pinturas y barnices')).toBe(1);
  });

  it('las palabras vacías no cuentan', () => {
    expect(parecidoNombres('Pinturas de la obra', 'Pinturas')).toBe(1);
  });

  it('dos cosas distintas dan 0', () => {
    expect(parecidoNombres('Cemento', 'Andamios')).toBe(0);
  });
});
