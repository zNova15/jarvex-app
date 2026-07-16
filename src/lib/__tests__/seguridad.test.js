import { describe, it, expect } from 'vitest';
import { estadoSctr, parseCharlasExcel, parseFechaFlexible } from '../seguridad.js';
import { esObrero } from '../personal-scope.js';

describe('estadoSctr', () => {
  const hoy = '2026-07-16';
  it('sin fecha → sin', () => { expect(estadoSctr(null, hoy)).toBe('sin'); expect(estadoSctr('', hoy)).toBe('sin'); });
  it('vencido si es anterior a hoy', () => { expect(estadoSctr('2026-07-15', hoy)).toBe('vencido'); });
  it('por vencer dentro de 30 días (incluye hoy)', () => {
    expect(estadoSctr('2026-07-16', hoy)).toBe('por_vencer');
    expect(estadoSctr('2026-08-15', hoy)).toBe('por_vencer'); // 30 días
  });
  it('vigente a más de 30 días', () => { expect(estadoSctr('2026-08-16', hoy)).toBe('vigente'); });
});

describe('esObrero', () => {
  it('cargos canónicos y variantes', () => {
    expect(esObrero('Peón')).toBe(true);
    expect(esObrero('peon')).toBe(true);
    expect(esObrero('OFICIAL')).toBe(true);
    expect(esObrero('Operario Civil')).toBe(true);
    expect(esObrero('Operario Eléctrico')).toBe(true);
  });
  it('no obreros', () => {
    expect(esObrero('Ing. Residente')).toBe(false);
    expect(esObrero('Almacenero')).toBe(false);
    expect(esObrero('Capataz')).toBe(false);
    expect(esObrero('')).toBe(false);
    expect(esObrero('Oficialista')).toBe(false); // no es "oficial " ni exacto
  });
  it('staff con palabra canónica NO es obrero (blocklist)', () => {
    expect(esObrero('Oficial de Seguridad')).toBe(false);
    expect(esObrero('Oficial Administrativo')).toBe(false);
  });
  it('plurales cuentan como obreros', () => {
    expect(esObrero('Operarios')).toBe(true);
    expect(esObrero('Peones')).toBe(true);
  });
});

describe('parseFechaFlexible', () => {
  // TRAMPA Excel (review Fase 2): sheet_to_json raw:false entrega celdas-fecha
  // como 'M/D/YY' (US). parseFechaFlexible delega en parseFechaMigracion:
  // default M/D, fallback D/M cuando el primer número >12, y valida rangos.
  it("celda Excel 'M/D/YY': 3/7/26 = 7 de MARZO (no 3 de julio)", () => {
    expect(parseFechaFlexible('3/7/26')).toBe('2026-03-07');
    expect(parseFechaFlexible('7/21/26')).toBe('2026-07-21'); // día >12 sin ambigüedad
  });
  it('D/M cuando el primer número no puede ser mes', () => {
    expect(parseFechaFlexible('21/07/2026')).toBe('2026-07-21');
  });
  it('ISO y ambiguas (default M/D)', () => {
    expect(parseFechaFlexible('2026-07-21')).toBe('2026-07-21');
    expect(parseFechaFlexible('5-8-2026')).toBe('2026-05-08');
  });
  it('Date y serial de Excel', () => {
    expect(parseFechaFlexible(new Date(Date.UTC(2026, 2, 7)))).toBe('2026-03-07');
    expect(parseFechaFlexible('46088')).toBe('2026-03-07'); // serial Excel de 2026-03-07
  });
  it('inválidas → null (incluye rangos imposibles)', () => {
    expect(parseFechaFlexible('julio 21')).toBeNull();
    expect(parseFechaFlexible('')).toBeNull();
    expect(parseFechaFlexible('21/25/2026')).toBeNull(); // ni mes ni día válidos
  });
});

describe('parseCharlasExcel', () => {
  const headers = ['Fecha', 'Tema', 'Área', 'Responsable', 'Observaciones'];
  it('mapea filas válidas con alias de encabezados', () => {
    const rows = [
      { Fecha: '21/07/2026', 'Tema': 'Trabajos en altura', 'Área': 'Seguridad', Responsable: 'Ing. K', Observaciones: 'frente A' },
      { Fecha: '22/07/2026', 'Tema': 'Manejo de residuos', 'Área': 'Ambiental', Responsable: '', Observaciones: null },
    ];
    const r = parseCharlasExcel({ headers, rows, areaDefault: 'seguridad' });
    expect(r.errores).toEqual([]);
    expect(r.charlas).toHaveLength(2);
    expect(r.charlas[0]).toEqual({ fecha: '2026-07-21', tema: 'Trabajos en altura', area: 'seguridad', expositor: 'Ing. K', notas: 'frente A' });
    expect(r.charlas[1].area).toBe('ambiental');
  });
  it('sin columna de área usa el área default', () => {
    const r = parseCharlasExcel({ headers: ['Fecha', 'Charla'], rows: [{ Fecha: '2026-07-21', Charla: 'Inducción' }], areaDefault: 'social' });
    expect(r.charlas[0].area).toBe('social');
  });
  it('reporta errores por fila sin frenar el resto', () => {
    const r = parseCharlasExcel({ headers, rows: [
      { Fecha: 'xx', Tema: 'Mala fecha' },
      { Fecha: '23/07/2026', Tema: '' },
      { Fecha: '24/07/2026', Tema: 'OK' },
    ] });
    expect(r.charlas).toHaveLength(1);
    expect(r.errores).toHaveLength(2);
  });
  it('sin columnas mínimas → error claro', () => {
    const r = parseCharlasExcel({ headers: ['Col1'], rows: [{ Col1: 'x' }] });
    expect(r.charlas).toEqual([]);
    expect(r.errores[0]).toContain('columnas mínimas');
  });
});
