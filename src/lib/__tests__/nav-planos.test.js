import { describe, it, expect } from 'vitest';
import { planoDe, GENERAL_ITEMS, resolveLanding, areaDe } from '../nav-planos.js';

describe('areaDe — sub-áreas del plano general', () => {
  it('contabilidad / direccion / admin / general', () => {
    expect(areaDe('empresas')).toBe('contabilidad');
    expect(areaDe('balance-general')).toBe('contabilidad');
    expect(areaDe('flujo-caja')).toBe('contabilidad');
    expect(areaDe('movimientos-contables')).toBe('contabilidad');
    expect(areaDe('trabajos')).toBe('trabajos');
    // Registro Profesional: bloque Licitaciones (antes caía en 'general' y, peor,
    // planoDe lo daba por 'obra' → el sidebar general nunca lo mostraba).
    expect(areaDe('profesionales')).toBe('licitaciones');
    expect(areaDe('dashboard-ejecutivo')).toBe('direccion');
    expect(areaDe('usuarios')).toBe('admin');
    expect(areaDe('configuracion')).toBe('admin');
    expect(areaDe('proveedores')).toBe('general');
    expect(areaDe('captura-magica')).toBe('general');
  });
});

describe('planoDe — clasifica general vs obra', () => {
  it('general: empresas, proveedores, contabilidad de empresa, captura, admin', () => {
    expect(planoDe('empresas')).toBe('general');
    expect(planoDe('proveedores')).toBe('general');
    expect(planoDe('balance-general')).toBe('general');
    expect(planoDe('libros-electronicos')).toBe('general');
    expect(planoDe('cuentas-bancarias')).toBe('general');
    expect(planoDe('captura-magica')).toBe('general');
    expect(planoDe('usuarios')).toBe('general');
    expect(planoDe('inicio')).toBe('general');
    expect(planoDe('profesionales')).toBe('general');
  });
  it('obra: movimientos/conciliación/partidas/almacén y cualquier no listada', () => {
    expect(planoDe('mov-materiales')).toBe('obra');
    expect(planoDe('conciliacion-insumos')).toBe('obra');
    expect(planoDe('movimientos-contables')).toBe('obra'); // por defecto obra (workspace); también se ofrece en el área contabilidad vía nav explícito
    expect(planoDe('partidas')).toBe('obra');
    expect(planoDe('personal')).toBe('obra');
    // La cadena intercompany es de UNA obra (entrega B): salió del plano general.
    expect(planoDe('trazabilidad')).toBe('obra');
    expect(planoDe('panel-obra')).toBe('obra');
    expect(planoDe('una-pagina-nueva-cualquiera')).toBe('obra');
  });
  it('GENERAL_ITEMS y planoDe son coherentes', () => {
    for (const id of GENERAL_ITEMS) expect(planoDe(id)).toBe('general');
  });
});

describe('resolveLanding — a dónde aterriza cada rol', () => {
  it('roles globales (admin/contador/gerente/licitaciones) → inicio, los cinco bloques', () => {
    expect(resolveLanding({ rol: 'admin', obrasAsignadas: ['a', 'b'] })).toEqual({ page: 'inicio', obraId: null });
    expect(resolveLanding({ rol: 'contador', obrasAsignadas: ['a'] })).toEqual({ page: 'inicio', obraId: null });
    expect(resolveLanding({ rol: 'gerente', obrasAsignadas: [] })).toEqual({ page: 'inicio', obraId: null });
    // licitaciones es global: nunca trabaja dentro de una obra, aunque alguien
    // lo haya designado a una por error.
    expect(resolveLanding({ rol: 'licitaciones', obrasAsignadas: ['o1'] })).toEqual({ page: 'inicio', obraId: null });
  });
  it('rol de obra con UNA obra → DIRECTO al desglose de esa obra', () => {
    expect(resolveLanding({ rol: 'almacenero', obrasAsignadas: ['o1'] })).toEqual({ page: 'panel-obra', obraId: 'o1' });
    expect(resolveLanding({ rol: 'ingeniero', obrasAsignadas: ['o9'] })).toEqual({ page: 'panel-obra', obraId: 'o9' });
    expect(resolveLanding({ rol: 'prevencionista', obrasAsignadas: ['o3'] })).toEqual({ page: 'panel-obra', obraId: 'o3' });
  });
  it('rol de obra con VARIAS obras → la lista de sus trabajos, para elegir', () => {
    expect(resolveLanding({ rol: 'almacenero', obrasAsignadas: ['o1', 'o2'] })).toEqual({ page: 'trabajos', obraId: null });
  });
  it('rol de obra SIN obras → la lista (que le dice que pida acceso), nunca el Inicio', () => {
    // Regresión de la tanda 2D: antes iba a 'inicio', donde veía bloques del
    // grupo que su rol no puede abrir.
    expect(resolveLanding({ rol: 'ingeniero', obrasAsignadas: [] })).toEqual({ page: 'trabajos', obraId: null });
    expect(resolveLanding({ rol: 'almacenero', obrasAsignadas: [] })).toEqual({ page: 'trabajos', obraId: null });
  });
  it('rol campo (portal con PIN) → SIEMPRE el portal de captura, sin importar obras', () => {
    expect(resolveLanding({ rol: 'campo', obrasAsignadas: [] })).toEqual({ page: 'captura-campo', obraId: null });
    expect(resolveLanding({ rol: 'campo', obrasAsignadas: ['o1'] })).toEqual({ page: 'captura-campo', obraId: null });
  });
  it('sin rol todavía (profile a medio cargar) → inicio, que es seguro para todos', () => {
    expect(resolveLanding({ rol: undefined, obrasAsignadas: ['o1'] })).toEqual({ page: 'inicio', obraId: null });
  });
});
