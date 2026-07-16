import { describe, it, expect } from 'vitest';
import { mesesRango, mesDe, matrizCumplimiento } from '../ambiental.js';

describe('mesesRango', () => {
  it('últimos 3 meses ascendentes, cruza el año', () => {
    expect(mesesRango('2026-02-15', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
  });
  it('acepta YYYY-MM', () => {
    expect(mesesRango('2026-07', 2)).toEqual(['2026-06', '2026-07']);
  });
});

describe('mesDe', () => {
  it('extrae YYYY-MM y tolera basura', () => {
    expect(mesDe('2026-07-16')).toBe('2026-07');
    expect(mesDe(null)).toBeNull();
    expect(mesDe('x')).toBeNull();
  });
});

describe('matrizCumplimiento', () => {
  const meses = ['2026-06', '2026-07'];
  it('cuenta registros por categoría × mes', () => {
    const r = matrizCumplimiento({
      registros: [
        { categoria: 'residuos', fecha: '2026-07-02' },
        { categoria: 'residuos', fecha: '2026-07-20' },
        { categoria: 'monitoreo_ruido', fecha: '2026-06-11' },
      ],
      meses,
    });
    const residuos = r.porCategoria.find(c => c.key === 'residuos');
    expect(residuos.meses).toEqual([{ mes: '2026-06', n: 0, ok: false }, { mes: '2026-07', n: 2, ok: true }]);
    expect(residuos.total).toBe(2);
  });
  it('capacitación se autocompleta con charlas ambientales realizadas + inducciones', () => {
    const r = matrizCumplimiento({
      registros: [{ categoria: 'capacitacion', fecha: '2026-07-01' }],
      charlasAmbientales: [{ fecha: '2026-07-08' }],
      induccionesAmbientales: [{ fecha: '2026-06-20' }],
      meses,
    });
    const cap = r.porCategoria.find(c => c.key === 'capacitacion');
    expect(cap.meses[0].n).toBe(1); // junio: inducción
    expect(cap.meses[1].n).toBe(2); // julio: registro + charla
  });
  it('pendientes del mes actual = categorías exigibles sin evidencia en el último mes', () => {
    const r = matrizCumplimiento({
      registros: [{ categoria: 'residuos', fecha: '2026-07-02' }],
      meses,
    });
    expect(r.pendientesMesActual).not.toContain('Manejo de residuos');
    expect(r.pendientesMesActual).toContain('Monitoreo de agua');
    // permisos e incidentes no son exigibles mensualmente (caso feliz = sin incidentes)
    expect(r.pendientesMesActual).not.toContain('Permisos y licencias');
    expect(r.pendientesMesActual).not.toContain('Incidentes ambientales');
    expect(r.pendientesMesActual.length).toBe(5); // 8 − residuos − permisos − incidentes
  });
  it('categoría desconocida o fecha inválida se ignoran sin romper', () => {
    const r = matrizCumplimiento({ registros: [{ categoria: 'otra', fecha: '2026-07-01' }, { categoria: 'residuos', fecha: null }], meses });
    expect(r.porCategoria.find(c => c.key === 'residuos').total).toBe(0);
  });
  it('sin datos no revienta', () => {
    const r = matrizCumplimiento({});
    expect(r.porCategoria).toHaveLength(8);
    expect(r.pendientesMesActual).toEqual([]);
  });
});
