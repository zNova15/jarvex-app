import { describe, it, expect } from 'vitest';
import {
  claveNombre, distanciaEdicion, buscarNombresParecidos,
  buscarMovimientosParecidos, haceCuanto, armarAvisoMovimientos,
  ordenarMovimientos, cargadoDespues,
} from '../almacen-duplicados.js';

const mat = (id, nombre, extra = {}) => ({ id, nombre_material: nombre, ...extra });
const getNombre = (m) => m.nombre_material;

describe('buscarNombresParecidos — casos reales del 24-set', () => {
  const catalogo = [
    mat('u1', 'UNIONES SIMPLES 1"'),
    mat('u2', 'UNIÓN SIMPLE DE 1 1/2" F°G°'),
    mat('u3', 'UNION UNIVERSAL 1"'),
    mat('e1', 'ESCHUFE'),
    mat('a1', 'ACEITE SINTETICO 10W30 4T'),
    mat('z1', 'ZAPATOS 40'),
    mat('c1', 'CAL'),
  ];

  it('UNIONES SIMPLES 1" otra vez → igual al existente (el duplicado del 02-set)', () => {
    const r = buscarNombresParecidos('UNIONES SIMPLES 1"', catalogo, { getNombre });
    expect(r[0]).toMatchObject({ item: { id: 'u1' }, tipo: 'igual' });
  });

  it('singular/plural y la tilde no esconden el duplicado', () => {
    const r = buscarNombresParecidos('Unión simple 1"', catalogo, { getNombre });
    expect(r.map(x => x.item.id)).toContain('u1');
    expect(r.find(x => x.item.id === 'u1').tipo).toBe('igual');
  });

  it('ENCHUFE avisa que existe ESCHUFE (typo a una letra)', () => {
    const r = buscarNombresParecidos('ENCHUFE', catalogo, { getNombre });
    expect(r).toEqual([{ item: catalogo[3], tipo: 'parecido' }]);
  });

  it('otra MEDIDA no es el mismo material: 1" ≠ 1 1/2"', () => {
    const r = buscarNombresParecidos('UNION SIMPLE 1 1/2"', catalogo, { getNombre });
    expect(r.map(x => x.item.id)).toEqual(['u2']);
    const r2 = buscarNombresParecidos('ZAPATOS 39', catalogo, { getNombre });
    expect(r2).toEqual([]);
  });

  it('otra palabra con la misma medida tampoco: UNIVERSAL ≠ SIMPLE', () => {
    const r = buscarNombresParecidos('UNIONES SIMPLES 1"', catalogo, { getNombre });
    expect(r.map(x => x.item.id)).not.toContain('u3');
  });

  it('nombres cortos no se emparejan por una letra (CAL ≠ CAJA)', () => {
    expect(buscarNombresParecidos('CAJA', catalogo, { getNombre })).toEqual([]);
  });

  it('mismas palabras en otro orden → parecido', () => {
    const r = buscarNombresParecidos('CINTA AMARILLA SEGURIDAD', [mat('x', 'CINTA SEGURIDAD AMARILLA')], { getNombre });
    expect(r[0].tipo).toBe('parecido');
  });

  it('ignora borrados y el propio registro (edición)', () => {
    const lista = [mat('a', 'ESCOBILLON', { deleted_at: '2026-09-01' }), mat('b', 'ESCOBILLON')];
    expect(buscarNombresParecidos('ESCOBILLÓN', lista, { getNombre }).map(x => x.item.id)).toEqual(['b']);
    expect(buscarNombresParecidos('ESCOBILLÓN', lista, { getNombre, excluirId: 'b' })).toEqual([]);
  });

  it('variante aparte (talla de EPP): otra talla no es duplicado, la misma sí', () => {
    const epps = [{ id: 'z39', nombre_epp: 'ZAPATOS', talla: '39' }, { id: 'zm', nombre_epp: 'ZAPATOS', talla: null }];
    const opts = { getNombre: e => e.nombre_epp, getVariante: e => e.talla };
    expect(buscarNombresParecidos('Zapatos', epps, { ...opts, variante: '40' }).map(x => x.item.id)).toEqual(['zm']);
    expect(buscarNombresParecidos('Zapatos', epps, { ...opts, variante: '39' }).map(x => x.item.id)).toEqual(['z39', 'zm']);
  });

  it('CABLES y CABLE son lo mismo', () => {
    const r = buscarNombresParecidos('CABLES', [mat('k', 'CABLE')], { getNombre });
    expect(r[0].tipo).toBe('igual');
  });
});

describe('claveNombre / distanciaEdicion', () => {
  it('separa medidas de palabras y descarta vacías', () => {
    const k = claveNombre('TUBO DE 1¨1/2¨ C-10');
    expect(k.medidas).toEqual(['1', '1/2', '10'].sort());
    expect(k.palabras).toEqual(['tubo', 'c']);
  });
  it('levenshtein básico', () => {
    expect(distanciaEdicion('eschufe', 'enchufe')).toBe(1);
    expect(distanciaEdicion('abc', 'abc')).toBe(0);
    expect(distanciaEdicion('', 'ab')).toBe(2);
  });
});

describe('buscarMovimientosParecidos', () => {
  const AHORA = Date.parse('2026-09-24T20:00:00Z');
  const mov = (id, extra) => ({ id, material_id: 'm1', tipo_movimiento: 'salida', cantidad: 2, fecha: '2026-09-11', created_at: '2026-09-24T17:21:33Z', ...extra });

  it('misma fecha y cantidad → misma_fecha aunque se haya cargado hace semanas', () => {
    const r = buscarMovimientosParecidos(
      { itemId: 'm1', tipo: 'salida', cantidad: 2, fecha: '2026-09-11' },
      [mov('a', { created_at: '2026-09-01T10:00:00Z' })],
      { ahoraMs: AHORA },
    );
    expect(r).toEqual([{ mov: expect.objectContaining({ id: 'a' }), nivel: 'misma_fecha' }]);
  });

  it('re-registro con la fecha "corregida" (cargado hace poco) → otra_fecha', () => {
    const r = buscarMovimientosParecidos(
      { itemId: 'm1', tipo: 'salida', cantidad: 2, fecha: '2026-09-12' },
      [mov('a')],
      { ahoraMs: AHORA },
    );
    expect(r[0].nivel).toBe('otra_fecha');
  });

  it('otra fecha pero cargado hace mucho → no es re-registro', () => {
    const r = buscarMovimientosParecidos(
      { itemId: 'm1', tipo: 'salida', cantidad: 2, fecha: '2026-09-12' },
      [mov('a', { created_at: '2026-09-10T10:00:00Z' })],
      { ahoraMs: AHORA },
    );
    expect(r).toEqual([]);
  });

  it('cantidad distinta, otro tipo, otro material, borrado o revertido → nada', () => {
    const nuevo = { itemId: 'm1', tipo: 'salida', cantidad: 2, fecha: '2026-09-11' };
    const r = buscarMovimientosParecidos(nuevo, [
      mov('a', { cantidad: 3 }),
      mov('b', { tipo_movimiento: 'entrada' }),
      mov('c', { material_id: 'm2' }),
      mov('d', { deleted_at: '2026-09-24T18:00:00Z' }),
      mov('e', { reversed_by_id: 'x' }),
      mov('f', { reverses_id: 'y' }),
    ], { ahoraMs: AHORA });
    expect(r).toEqual([]);
  });

  it('acepta otro campo de ítem y de tipo (EPP / herramientas)', () => {
    const r = buscarMovimientosParecidos(
      { itemId: 'e1', tipo: 'entrega', cantidad: 1, fecha: '2026-09-20' },
      [{ id: 'z', epp_id: 'e1', tipo_movimiento: 'entrega', cantidad: 1, fecha: '2026-09-20', created_at: '2026-09-20T12:00:00Z' }],
      { ahoraMs: AHORA, getItemId: (m) => m.epp_id },
    );
    expect(r).toHaveLength(1);
  });

  it('con getDestino, otro trabajador no es duplicado (EPP)', () => {
    const hist = [{ id: 'g', epp_id: 'e1', tipo_movimiento: 'salida', cantidad: 1, fecha: '2026-09-24', personal_id: 'p1', created_at: '2026-09-24T19:00:00Z' }];
    const opts = { ahoraMs: AHORA, getItemId: m => m.epp_id, getDestino: m => m.personal_id };
    expect(buscarMovimientosParecidos({ itemId: 'e1', tipo: 'salida', cantidad: 1, fecha: '2026-09-24', destino: 'p2' }, hist, opts)).toEqual([]);
    expect(buscarMovimientosParecidos({ itemId: 'e1', tipo: 'salida', cantidad: 1, fecha: '2026-09-24', destino: 'p1' }, hist, opts)).toHaveLength(1);
  });

  it('cantidad inválida no busca', () => {
    expect(buscarMovimientosParecidos({ itemId: 'm1', tipo: 'salida', cantidad: 0, fecha: '2026-09-11' }, [mov('a')])).toEqual([]);
  });

  it('ordena lo más reciente primero', () => {
    const r = buscarMovimientosParecidos(
      { itemId: 'm1', tipo: 'salida', cantidad: 2, fecha: '2026-09-11' },
      [mov('viejo', { created_at: '2026-09-02T10:00:00Z' }), mov('nuevo', { created_at: '2026-09-24T19:00:00Z' })],
      { ahoraMs: AHORA },
    );
    expect(r.map(x => x.mov.id)).toEqual(['nuevo', 'viejo']);
  });
});

describe('armarAvisoMovimientos', () => {
  const AHORA = Date.parse('2026-09-24T20:00:00Z');
  it('una tarjeta por fila con parecidos, dice cuándo, quién y si la fecha era otra', () => {
    const grupos = armarAvisoMovimientos([
      { nombre: 'COLLARINES', unidad: 'jgo', cantidad: 2, fecha: '2026-09-12', parecidos: [
        { nivel: 'otra_fecha', mov: { fecha: '2026-09-11', created_at: '2026-09-24T19:40:00Z', created_by: 'u1' } },
      ] },
      { nombre: 'CEMENTO', unidad: 'bls', cantidad: 5, fecha: '2026-09-24', parecidos: [] },
    ], { ahoraMs: AHORA, nombreDe: (id) => (id === 'u1' ? 'Yanet' : null) });
    expect(grupos).toEqual([{
      titulo: 'COLLARINES × 2 jgo — fecha 12/09/2026',
      filas: ['Ya hay uno igual con fecha 11/09/2026 (OTRA fecha) · cargado hace 20 min · por Yanet'],
    }]);
  });
  it('corta en 3 y avisa cuántos más hay', () => {
    const p = { nivel: 'misma_fecha', mov: { fecha: '2026-09-24', created_at: '2026-09-24T19:00:00Z' } };
    const [g] = armarAvisoMovimientos([{ nombre: 'X', cantidad: 1, fecha: '2026-09-24', parecidos: [p, p, p, p, p] }], { ahoraMs: AHORA });
    expect(g.filas).toHaveLength(4);
    expect(g.filas[3]).toBe('… y 2 más');
  });
});

describe('registro: ordenarMovimientos / cargadoDespues (caso COLLARINES)', () => {
  const movs = [
    { id: 'viejo-cargado-hoy', fecha: '2026-09-11', hora: '12:21', created_at: '2026-09-24T17:21:33Z' },
    { id: 'reciente', fecha: '2026-09-23', hora: '09:00', created_at: '2026-09-23T14:00:00Z' },
    { id: 'hoy', fecha: '2026-09-24', hora: '08:00', created_at: '2026-09-24T13:00:00Z' },
  ];
  it('por fecha, lo cargado hoy con fecha 11/09 queda ÚLTIMO (enterrado)', () => {
    expect(ordenarMovimientos(movs, 'fecha').map(m => m.id)).toEqual(['hoy', 'reciente', 'viejo-cargado-hoy']);
  });
  it('por "cargado", queda PRIMERO', () => {
    expect(ordenarMovimientos(movs, 'cargado').map(m => m.id)).toEqual(['viejo-cargado-hoy', 'hoy', 'reciente']);
  });
  it('no muta el arreglo original', () => {
    const copia = movs.slice();
    ordenarMovimientos(movs, 'cargado');
    expect(movs).toEqual(copia);
  });
  it('cargadoDespues marca solo lo cargado 2+ días después de su fecha', () => {
    const local = (iso) => iso.slice(0, 10); // TZ inyectado
    expect(cargadoDespues(movs[0], local)).toBe('2026-09-24');
    expect(cargadoDespues(movs[1], local)).toBeNull();
    expect(cargadoDespues({ fecha: '2026-09-23', created_at: '2026-09-24T10:00:00Z' }, local)).toBeNull();
    expect(cargadoDespues({ fecha: '2026-09-24' }, local)).toBeNull();
  });
});

describe('haceCuanto', () => {
  const AHORA = Date.parse('2026-09-24T20:00:00Z');
  it('formatea minutos, horas y días', () => {
    expect(haceCuanto('2026-09-24T19:55:00Z', AHORA)).toBe('hace 5 min');
    expect(haceCuanto('2026-09-24T17:00:00Z', AHORA)).toBe('hace 3 h');
    expect(haceCuanto('2026-09-23T20:00:00Z', AHORA)).toBe('hace 1 día');
    expect(haceCuanto('2026-09-20T20:00:00Z', AHORA)).toBe('hace 4 días');
    expect(haceCuanto('', AHORA)).toBe('');
  });
});
