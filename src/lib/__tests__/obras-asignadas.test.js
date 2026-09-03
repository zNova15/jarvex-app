// Aislamiento por obra (tanda 2D). El bug que originó estos tests: un
// almacenero veía TODAS las obras del grupo porque "sin asignaciones"
// devolvía null = sin restricción. La regla es la contraria.
import { describe, it, expect } from 'vitest';
import { resolverObrasPermitidas, esRolGlobal, ROLES_GLOBALES } from '../obras-asignadas.js';

const ids = (set) => (set === null ? null : [...set].sort());

describe('esRolGlobal', () => {
  it('los roles cross-obra ven todas', () => {
    for (const r of ['admin', 'gerente', 'contador', 'ayudante_contador', 'tesorero', 'licitaciones']) {
      expect(esRolGlobal(r)).toBe(true);
    }
  });
  it('los roles de obra NO son globales', () => {
    for (const r of ['almacenero', 'ingeniero', 'ingeniero_residente', 'prevencionista',
      'ing_ambiental', 'ing_calidad', 'ing_social', 'supervisor', 'maestro_obra',
      'jefe_compras', 'rrhh', 'asistente_admin', 'solo_lectura', 'campo']) {
      expect(esRolGlobal(r)).toBe(false);
    }
  });
  it('rol vacío o desconocido no es global', () => {
    expect(esRolGlobal(undefined)).toBe(false);
    expect(esRolGlobal('')).toBe(false);
    expect(esRolGlobal('inventado')).toBe(false);
  });
});

describe('resolverObrasPermitidas', () => {
  it('rol global → null (sin restricción), tenga o no designaciones', () => {
    expect(resolverObrasPermitidas({ rol: 'admin', filas: [] })).toBe(null);
    expect(resolverObrasPermitidas({ rol: 'contador', filas: [{ obra_id: 'o1' }] })).toBe(null);
  });

  it('rol de obra → SOLO sus obras designadas', () => {
    const r = resolverObrasPermitidas({ rol: 'almacenero', filas: [{ obra_id: 'o1' }, { obra_id: 'o2' }] });
    expect(ids(r)).toEqual(['o1', 'o2']);
  });

  it('🔴 EL BUG: rol de obra SIN designaciones → Set vacío, NUNCA null', () => {
    const r = resolverObrasPermitidas({ rol: 'almacenero', filas: [] });
    expect(r).not.toBe(null);          // null significaría "ve todas"
    expect(r.size).toBe(0);
  });

  it('modo prueba → null (los datos demo no están en obra_usuarios)', () => {
    expect(resolverObrasPermitidas({ rol: 'almacenero', filas: [], modoPrueba: true })).toBe(null);
  });

  it('sin rol todavía → cerrado, no abierto', () => {
    const r = resolverObrasPermitidas({ rol: undefined, filas: [{ obra_id: 'o1' }] });
    expect(r).not.toBe(null);
    expect(r.size).toBe(0);
  });

  it('offline con caché → usa la última respuesta buena (no deja sin obras al de campo)', () => {
    const r = resolverObrasPermitidas({ rol: 'ingeniero', filas: null, cache: ['o7'] });
    expect(ids(r)).toEqual(['o7']);
  });

  it('offline SIN caché → cerrado (falla hacia el lado seguro)', () => {
    const r = resolverObrasPermitidas({ rol: 'ingeniero', filas: null, cache: null });
    expect(r).not.toBe(null);
    expect(r.size).toBe(0);
  });

  it('filas con obra_id nulo no ensucian el Set', () => {
    const r = resolverObrasPermitidas({ rol: 'almacenero', filas: [{ obra_id: null }, { obra_id: 'o1' }, {}] });
    expect(ids(r)).toEqual(['o1']);
  });

  it('ROLES_GLOBALES es el espejo declarado de la mig 175', () => {
    // Si alguien agrega un rol acá tiene que agregarlo a es_rol_global() en la
    // migración, o la pantalla mostrará obras que el servidor niega.
    expect([...ROLES_GLOBALES].sort()).toEqual(
      ['admin', 'ayudante_contador', 'contador', 'gerente', 'licitaciones', 'tesorero']
    );
  });
});
