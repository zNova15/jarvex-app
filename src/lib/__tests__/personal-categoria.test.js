import { describe, it, expect } from 'vitest';
import {
  categoriaDerivada, categoriaDe, esGestionableSeguridad, CATEGORIAS_GESTIONABLES,
} from '../personal-categoria.js';

const subs = new Map([
  ['sub-moshco', { razon_social: 'Subcontrato MOSHCO' }],
  ['sub-jr', { razon_social: 'Subcontrato JR' }],
]);

describe('categoriaDerivada — según cargos reales de la obra', () => {
  it('obrero: Peón / Oficial / Operario / Maestro de Obra / Capataz', () => {
    for (const cargo of ['Peón', 'Oficial', 'Operario', 'Maestro de Obra', 'Capataz'])
      expect(categoriaDerivada({ cargo })).toBe('obrero');
  });

  it('profesionales: ingenieros, arquitecto, topógrafo, etc.', () => {
    for (const cargo of ['Ingeniero', 'Ingeniero Residente', 'Ingeniero de Seguridad',
      'Ingeniero Ambiental', 'Ingeniero Sanitario', 'Ingeniero - Representante Consorcio',
      'Arquitecto', 'Topógrafo'])
      expect(categoriaDerivada({ cargo })).toBe('profesionales');
  });

  it('otros: Otro / Supervisión / Social Supervisión / JASS / Administrador / Almacenero / Asistentes', () => {
    for (const cargo of ['Otro', 'Supervision', 'Social Supervision', 'JASS',
      'Administrador de Obra', 'Asist. Administrador', 'Almacenero', 'Asistente Contabilidad'])
      expect(categoriaDerivada({ cargo })).toBe('otros');
  });

  it('subcontratos: cualquier cargo con subcontratista_id', () => {
    expect(categoriaDerivada({ cargo: 'Subcontrato MOSHCO', subcontratista_id: 'sub-moshco' })).toBe('subcontratos');
    // Aunque el cargo sea obrero, si está en subcontrato → subcontratos.
    expect(categoriaDerivada({ cargo: 'Peón', subcontratista_id: 'sub-jr' })).toBe('subcontratos');
  });

  it('sin cargo → otros', () => {
    expect(categoriaDerivada({ cargo: '' })).toBe('otros');
    expect(categoriaDerivada({})).toBe('otros');
  });
});

describe('categoriaDe — override + subcategoría', () => {
  it('el override manual válido gana sobre la derivación', () => {
    // "Willy" es "Otro" pero el admin lo dejó en Otros explícito (o lo puede mover)
    expect(categoriaDe({ cargo: 'Ingeniero', categoria: 'otros' }).categoria).toBe('otros');
    // override inválido se ignora → deriva
    expect(categoriaDe({ cargo: 'Ingeniero', categoria: 'basura' }).categoria).toBe('profesionales');
  });

  it('subcontratos devuelve el nombre del subcontrato como subcategoría', () => {
    const r = categoriaDe({ cargo: 'Subcontrato MOSHCO', subcontratista_id: 'sub-moshco' }, subs);
    expect(r).toEqual({ categoria: 'subcontratos', sub: 'Subcontrato MOSHCO' });
  });

  it('acepta subsById como objeto plano además de Map', () => {
    const r = categoriaDe({ subcontratista_id: 'x' }, { x: { razon_social: 'Sub X' } });
    expect(r).toEqual({ categoria: 'subcontratos', sub: 'Sub X' });
  });
});

describe('esGestionableSeguridad — scope de ing. seguridad / almacenera', () => {
  it('gestiona obrero, profesionales y subcontratos', () => {
    expect(esGestionableSeguridad({ cargo: 'Peón' })).toBe(true);
    expect(esGestionableSeguridad({ cargo: 'Ingeniero Residente' })).toBe(true);
    expect(esGestionableSeguridad({ cargo: 'Subcontrato JR', subcontratista_id: 'sub-jr' }, subs)).toBe(true);
  });

  it('NO gestiona "Otros" (Willy Daniel "Otro", Supervisión, admin)', () => {
    expect(esGestionableSeguridad({ cargo: 'Otro' })).toBe(false);
    expect(esGestionableSeguridad({ cargo: 'Supervision' })).toBe(false);
    expect(esGestionableSeguridad({ cargo: 'Administrador de Obra' })).toBe(false);
  });

  it('un override a "otros" saca a la persona del scope aunque el cargo sea obrero', () => {
    expect(esGestionableSeguridad({ cargo: 'Peón', categoria: 'otros' })).toBe(false);
  });

  it('CATEGORIAS_GESTIONABLES no incluye otros', () => {
    expect(CATEGORIAS_GESTIONABLES).not.toContain('otros');
    expect(CATEGORIAS_GESTIONABLES).toEqual(['obrero', 'profesionales', 'subcontratos']);
  });
});
