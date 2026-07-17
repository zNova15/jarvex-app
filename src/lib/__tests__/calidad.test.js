import { describe, it, expect } from 'vitest';
import { resumenCumplimiento, resultadoEfectivo, parseRequisitosExcel, claveRequisito } from '../calidad.js';

describe('resultadoEfectivo', () => {
  it('el override manual pisa a la IA', () => {
    expect(resultadoEfectivo({ resultado: 'no_cumple', resultado_manual: 'cumple' })).toBe('cumple');
    expect(resultadoEfectivo({ resultado: 'observado', resultado_manual: null })).toBe('observado');
    expect(resultadoEfectivo(null)).toBeNull();
  });
});

describe('resumenCumplimiento', () => {
  const reqs = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }];
  it('el certificado más reciente define el estado', () => {
    const { porRequisito, kpis } = resumenCumplimiento(reqs, [
      { requisito_id: 'r1', fecha: '2026-06-01', resultado: 'no_cumple' },
      { requisito_id: 'r1', fecha: '2026-07-10', resultado: 'cumple' },
      { requisito_id: 'r2', fecha: '2026-07-01', resultado: 'observado' },
    ]);
    expect(porRequisito.get('r1').estado).toBe('cumple');
    expect(porRequisito.get('r1').nCerts).toBe(2);
    expect(porRequisito.get('r2').estado).toBe('observado');
    expect(porRequisito.get('r3').estado).toBe('sin_certificado');
    expect(kpis).toEqual({ total: 3, cumple: 1, observado: 1, no_cumple: 0, sin_certificado: 1 });
  });
  it('misma fecha → desempata por created_at', () => {
    const { porRequisito } = resumenCumplimiento([{ id: 'r1' }], [
      { requisito_id: 'r1', fecha: '2026-07-10', created_at: '2026-07-10T08:00:00Z', resultado: 'no_cumple' },
      { requisito_id: 'r1', fecha: '2026-07-10', created_at: '2026-07-10T15:00:00Z', resultado: 'cumple' },
    ]);
    expect(porRequisito.get('r1').estado).toBe('cumple');
  });
  it('override manual del último certificado manda en el semáforo', () => {
    const { porRequisito } = resumenCumplimiento([{ id: 'r1' }], [
      { requisito_id: 'r1', fecha: '2026-07-10', resultado: 'no_cumple', resultado_manual: 'observado' },
    ]);
    expect(porRequisito.get('r1').estado).toBe('observado');
  });
  it('resultado desconocido cae a sin_certificado sin romper KPIs', () => {
    const { porRequisito, kpis } = resumenCumplimiento([{ id: 'r1' }], [
      { requisito_id: 'r1', fecha: '2026-07-10', resultado: 'pendiente_raro' },
    ]);
    expect(porRequisito.get('r1').estado).toBe('sin_certificado');
    expect(kpis.sin_certificado).toBe(1);
  });
  it('sin datos no revienta', () => {
    const { kpis } = resumenCumplimiento();
    expect(kpis).toEqual({ total: 0, cumple: 0, observado: 0, no_cumple: 0, sin_certificado: 0 });
  });
});

describe('parseRequisitosExcel', () => {
  it('mapea encabezados flexibles y arma requisitos', () => {
    const r = parseRequisitosExcel({
      headers: ['Material', 'NTP', 'Valor Mínimo', 'Sección'],
      rows: [
        { Material: 'Cemento Portland Tipo I', NTP: 'NTP 334.009', 'Valor Mínimo': "f'c ≥ 42.5 MPa a 28 días", 'Sección': 'ET-03' },
        { Material: 'Acero corrugado', NTP: '', 'Valor Mínimo': 'fy = 4200 kg/cm²', 'Sección': '' },
      ],
    });
    expect(r.errores).toEqual([]);
    expect(r.requisitos).toEqual([
      { insumo_nombre: 'Cemento Portland Tipo I', norma: 'NTP 334.009', especificacion: "f'c ≥ 42.5 MPa a 28 días", fuente: 'ET-03' },
      { insumo_nombre: 'Acero corrugado', norma: null, especificacion: 'fy = 4200 kg/cm²', fuente: null },
    ]);
  });
  it('filas incompletas dan error con número de fila; vacías se ignoran', () => {
    const r = parseRequisitosExcel({
      headers: ['Insumo', 'Especificación'],
      rows: [
        { Insumo: 'Tubería PVC', 'Especificación': '' },
        { Insumo: '', 'Especificación': '' },
        { Insumo: '', 'Especificación': 'clase 10' },
      ],
    });
    expect(r.requisitos).toEqual([]);
    expect(r.errores).toEqual(['Fila leída #2: sin especificación', 'Fila leída #4: sin insumo/material']);
  });
  it('sin columnas mínimas devuelve error claro', () => {
    const r = parseRequisitosExcel({ headers: ['Nombre', 'Precio'], rows: [{ Nombre: 'x' }] });
    expect(r.requisitos).toEqual([]);
    expect(r.errores[0]).toMatch(/columnas mínimas/);
    expect(r.errores[0]).toMatch(/Encabezados leídos: Nombre, Precio/);
  });
  it('claveRequisito normaliza acentos y mayúsculas para dedup', () => {
    expect(claveRequisito({ insumo_nombre: 'Tubería PVC', especificacion: 'Clase 10' }))
      .toBe(claveRequisito({ insumo_nombre: 'tuberia pvc', especificacion: 'clase 10' }));
  });
});
