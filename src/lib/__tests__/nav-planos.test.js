import { describe, it, expect } from 'vitest';
import { planoDe, GENERAL_ITEMS, resolveLanding } from '../nav-planos.js';

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
  });
  it('obra: movimientos/conciliación/partidas/almacén y cualquier no listada', () => {
    expect(planoDe('mov-materiales')).toBe('obra');
    expect(planoDe('conciliacion-insumos')).toBe('obra');
    expect(planoDe('movimientos-contables')).toBe('obra');
    expect(planoDe('flujo-caja')).toBe('obra');
    expect(planoDe('partidas')).toBe('obra');
    expect(planoDe('personal')).toBe('obra');
    expect(planoDe('una-pagina-nueva-cualquiera')).toBe('obra');
  });
  it('GENERAL_ITEMS y planoDe son coherentes', () => {
    for (const id of GENERAL_ITEMS) expect(planoDe(id)).toBe('general');
  });
});

describe('resolveLanding — a dónde aterriza cada rol', () => {
  const home = { almacenero: 'mov-materiales', ingeniero: 'dashboard-tecnico', contador: 'cont-dashboard' };
  it('roles globales (admin/contador/gerente/tesorero) → inicio', () => {
    expect(resolveLanding({ rol: 'admin', obrasAsignadas: ['a', 'b'], homePorRol: home })).toEqual({ page: 'inicio', obraId: null });
    expect(resolveLanding({ rol: 'contador', obrasAsignadas: ['a'], homePorRol: home })).toEqual({ page: 'inicio', obraId: null });
    expect(resolveLanding({ rol: 'gerente', obrasAsignadas: [], homePorRol: home })).toEqual({ page: 'inicio', obraId: null });
  });
  it('operativo con UNA obra → entra a su obra y su página', () => {
    expect(resolveLanding({ rol: 'almacenero', obrasAsignadas: ['o1'], homePorRol: home })).toEqual({ page: 'mov-materiales', obraId: 'o1' });
    expect(resolveLanding({ rol: 'ingeniero', obrasAsignadas: ['o9'], homePorRol: home })).toEqual({ page: 'dashboard-tecnico', obraId: 'o9' });
  });
  it('operativo con varias o ninguna obra → inicio', () => {
    expect(resolveLanding({ rol: 'almacenero', obrasAsignadas: ['o1', 'o2'], homePorRol: home })).toEqual({ page: 'inicio', obraId: null });
    expect(resolveLanding({ rol: 'ingeniero', obrasAsignadas: [], homePorRol: home })).toEqual({ page: 'inicio', obraId: null });
  });
  it('operativo sin home definido → cae a dashboard-gestion', () => {
    expect(resolveLanding({ rol: 'supervisor', obrasAsignadas: ['o1'], homePorRol: home })).toEqual({ page: 'dashboard-gestion', obraId: 'o1' });
  });
});
