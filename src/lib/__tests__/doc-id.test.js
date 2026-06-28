import { describe, it, expect } from 'vitest';
import { soloDigitos, normalizarRuc, normalizarDni, esRucValido, mismoRuc, mismoDni } from '../doc-id.js';
import { gruposDuplicadosPorRuc } from '../fusion-entidad.js';

describe('doc-id — normalización de RUC/DNI', () => {
  it('soloDigitos / normalizarRuc deja solo dígitos (robusto a formato)', () => {
    expect(normalizarRuc('20-123456789')).toBe('20123456789');
    expect(normalizarRuc(' 20123456789 ')).toBe('20123456789');
    expect(normalizarRuc('RUC: 20123456789')).toBe('20123456789');
    expect(normalizarRuc(null)).toBe('');
  });
  it('mismoRuc compara por documento, NO por nombre/formato (bug Gasomi)', () => {
    // Misma empresa, RUC con y sin guiones → deben matchear.
    expect(mismoRuc('20-12345678-9', '20123456789')).toBe(true);
    expect(mismoRuc('20123456789', '20123456780')).toBe(false);
    expect(mismoRuc('', '20123456789')).toBe(false);  // vacío nunca matchea
  });
  it('esRucValido: 11 dígitos con prefijo válido', () => {
    expect(esRucValido('20123456789')).toBe(true);
    expect(esRucValido('10123456789')).toBe(true);
    expect(esRucValido('30123456789')).toBe(false); // prefijo inválido
    expect(esRucValido('2012345678')).toBe(false);  // 10 dígitos
  });
  it('normalizarDni respeta placeholders MIG-/RES- (no son DNI reales)', () => {
    expect(normalizarDni('70123456')).toBe('70123456');
    expect(normalizarDni('MIG-abc123')).toBe('MIG-abc123');
    expect(mismoDni('MIG-1', 'MIG-1')).toBe(false); // placeholders no se consideran "el mismo"
    expect(mismoDni('70123456', '70.123.456')).toBe(true);
  });
});

describe('gruposDuplicadosPorRuc — detección de duplicados', () => {
  it('agrupa por RUC normalizado e ignora vacíos/borrados', () => {
    const grupos = gruposDuplicadosPorRuc([
      { id: 'a', ruc: '20123456789', name: 'GASOMI SAC' },
      { id: 'b', ruc: '20-12345678-9', name: 'Gasomi Sac' },   // mismo RUC, otro formato/caso
      { id: 'c', ruc: '20999999999', name: 'OTRA' },
      { id: 'd', ruc: '20123456789', name: 'GASOMI', deleted_at: '2026-01-01' }, // borrado: ignora
      { id: 'e', ruc: '', name: 'SIN RUC' },
    ]);
    expect(grupos.length).toBe(1);
    expect(grupos[0].ruc).toBe('20123456789');
    expect(grupos[0].registros.map(r => r.id).sort()).toEqual(['a', 'b']);
  });
});
