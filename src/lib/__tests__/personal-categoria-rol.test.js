import { describe, it, expect } from 'vitest';
import { categoriasParaRol, cargosParaRol, CARGOS_OBRERO_CANONICOS, CARGOS_GESTIONABLES_CANONICOS, categoriaDe } from '../personal-categoria.js';

describe('alcance de Personal por rol (pedido 20-jul)', () => {
  it('residente: SOLO Obrero + Subcontratos', () => {
    expect(categoriasParaRol('ingeniero_residente')).toEqual(['obrero', 'subcontratos']);
  });
  it('seguridad / almacenera: las 3 categorías gestionables', () => {
    expect(categoriasParaRol('prevencionista')).toEqual(['obrero', 'profesionales', 'subcontratos']);
    expect(categoriasParaRol('almacenero')).toEqual(['obrero', 'profesionales', 'subcontratos']);
  });
  it('cargos ofrecidos al crear bajo scope: SOLO obreros para todos (20-jul)', () => {
    expect(cargosParaRol('ingeniero_residente')).toEqual(CARGOS_OBRERO_CANONICOS);
    expect(cargosParaRol('almacenero')).toEqual(CARGOS_OBRERO_CANONICOS);
    expect(cargosParaRol('prevencionista')).toEqual(CARGOS_OBRERO_CANONICOS);
    expect(CARGOS_OBRERO_CANONICOS).not.toContain('Ingeniero');
    expect(CARGOS_GESTIONABLES_CANONICOS).toContain('Ingeniero'); // el admin sí los usa
  });
  it('el residente NO alcanza a un profesional pero sí a un obrero y a un subcontratado', () => {
    const cats = categoriasParaRol('ingeniero_residente');
    expect(cats.includes(categoriaDe({ cargo: 'Ingeniero Sanitario' }).categoria)).toBe(false);
    expect(cats.includes(categoriaDe({ cargo: 'Peón' }).categoria)).toBe(true);
    expect(cats.includes(categoriaDe({ cargo: 'Peón', subcontratista_id: 's1' }).categoria)).toBe(true);
  });
});
