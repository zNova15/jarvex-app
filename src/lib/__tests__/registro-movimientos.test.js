import { describe, it, expect } from 'vitest';
import {
  ordenarMovimientos, rangoDePreset, filtrarPorRango, cargadoDespues,
  ORDENES_REGISTRO, PRESETS_RANGO, ORDEN_REGISTRO_LABEL, PRESET_RANGO_LABEL,
} from '../registro-movimientos.js';

// Caso COLLARINES (24-set): salida cargada hoy con fecha 11/09.
const movs = [
  { id: 'viejo-cargado-hoy', fecha: '2026-09-11', hora: '12:21', created_at: '2026-09-24T17:21:33Z' },
  { id: 'reciente', fecha: '2026-09-23', hora: '09:00', created_at: '2026-09-23T14:00:00Z' },
  { id: 'hoy', fecha: '2026-09-24', hora: '08:00', created_at: '2026-09-24T13:00:00Z' },
  { id: 'hoy-tarde', fecha: '2026-09-24', hora: '16:00', created_at: '2026-09-24T21:00:00Z' },
];

describe('ordenarMovimientos', () => {
  it('fecha_desc (default): lo último arriba, la hora desempata', () => {
    expect(ordenarMovimientos(movs).map(m => m.id)).toEqual(['hoy-tarde', 'hoy', 'reciente', 'viejo-cargado-hoy']);
  });
  it('fecha_asc: lo más antiguo arriba', () => {
    expect(ordenarMovimientos(movs, 'fecha_asc').map(m => m.id)).toEqual(['viejo-cargado-hoy', 'reciente', 'hoy', 'hoy-tarde']);
  });
  it('cargado: lo cargado hoy con fecha atrasada sale arriba de lo de ayer', () => {
    expect(ordenarMovimientos(movs, 'cargado').map(m => m.id)).toEqual(['hoy-tarde', 'viejo-cargado-hoy', 'hoy', 'reciente']);
  });
  it('acepta "fecha" como sinónimo del default y no muta', () => {
    const copia = movs.slice();
    expect(ordenarMovimientos(movs, 'fecha').map(m => m.id)).toEqual(ordenarMovimientos(movs).map(m => m.id));
    expect(movs).toEqual(copia);
  });
});

describe('rangoDePreset', () => {
  const HOY = '2026-09-24';
  it('presets relativos a hoy (inclusivos)', () => {
    expect(rangoDePreset('todo', HOY)).toEqual({ desde: null, hasta: null });
    expect(rangoDePreset('hoy', HOY)).toEqual({ desde: HOY, hasta: HOY });
    expect(rangoDePreset('7d', HOY)).toEqual({ desde: '2026-09-18', hasta: HOY });
    expect(rangoDePreset('30d', HOY)).toEqual({ desde: '2026-08-26', hasta: HOY });
    expect(rangoDePreset('mes', HOY)).toEqual({ desde: '2026-09-01', hasta: HOY });
  });
  it('mes anterior, incluido el cruce de año y febrero', () => {
    expect(rangoDePreset('mes_anterior', HOY)).toEqual({ desde: '2026-08-01', hasta: '2026-08-31' });
    expect(rangoDePreset('mes_anterior', '2026-01-10')).toEqual({ desde: '2025-12-01', hasta: '2025-12-31' });
    expect(rangoDePreset('mes_anterior', '2028-03-05')).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' });
  });
  it('personalizado: abierto de un lado, y al revés se endereza', () => {
    expect(rangoDePreset('personalizado', HOY, { desde: '2026-09-01', hasta: '' })).toEqual({ desde: '2026-09-01', hasta: null });
    expect(rangoDePreset('personalizado', HOY, { desde: '2026-09-20', hasta: '2026-09-10' })).toEqual({ desde: '2026-09-10', hasta: '2026-09-20' });
  });
  it('fecha inválida → sin rango', () => {
    expect(rangoDePreset('hoy', 'basura')).toEqual({ desde: null, hasta: null });
  });
});

describe('filtrarPorRango', () => {
  it('filtra por FECHA DEL MOVIMIENTO, no por la de carga', () => {
    expect(filtrarPorRango(movs, { desde: '2026-09-23', hasta: '2026-09-24' }).map(m => m.id))
      .toEqual(['reciente', 'hoy', 'hoy-tarde']);
  });
  it('sin rango devuelve todo; sin fecha queda afuera de un rango', () => {
    expect(filtrarPorRango(movs, {})).toHaveLength(4);
    expect(filtrarPorRango([{ id: 'x' }], { desde: '2026-01-01' })).toEqual([]);
  });
});

describe('cargadoDespues', () => {
  const local = (iso) => iso.slice(0, 10);
  it('marca solo lo cargado 2+ días después de su fecha', () => {
    expect(cargadoDespues(movs[0], local)).toBe('2026-09-24');
    expect(cargadoDespues(movs[1], local)).toBeNull();
    expect(cargadoDespues({ fecha: '2026-09-23', created_at: '2026-09-24T10:00:00Z' }, local)).toBeNull();
    expect(cargadoDespues({ fecha: '2026-09-24' }, local)).toBeNull();
  });
});

describe('etiquetas', () => {
  it('cada opción tiene su texto', () => {
    ORDENES_REGISTRO.forEach(o => expect(ORDEN_REGISTRO_LABEL[o]).toBeTruthy());
    PRESETS_RANGO.forEach(p => expect(PRESET_RANGO_LABEL[p]).toBeTruthy());
  });
});
