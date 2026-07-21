import { describe, it, expect } from 'vitest';
import { normalizarNombre, validarSecciones, matchAsegurados, TIPOS_DOC_SCTR } from '../sctr-paquete.js';

describe('sctr-paquete — normalización y match', () => {
  it('normaliza tildes, mayúsculas y espacios', () => {
    expect(normalizarNombre('  Róxana  Elizabeth  Vásquez ')).toBe('ROXANA ELIZABETH VASQUEZ');
  });
  it('matchea por DNI aunque el nombre difiera', () => {
    const personal = [{ id: 'p1', dni: '70207739', nombres: 'Roxana E.', apellidos: 'Vasquez Q.' }];
    const r = matchAsegurados([{ tipo_doc: 'DNI', documento: '70207739', nombre: 'ROXANA ELIZABETH VASQUEZ QUISPE' }], personal);
    expect(r[0].persona?.id).toBe('p1');
  });
  it('matchea por nombre normalizado en orden apellidos-nombres', () => {
    const personal = [{ id: 'p2', dni: null, nombres: 'Nels', apellidos: 'Cachi Barrantes' }];
    const r = matchAsegurados([{ tipo_doc: 'DNI', documento: '42410031', nombre: 'NELS CACHI BARRANTES' }], personal);
    expect(r[0].persona?.id).toBe('p2');
  });
  it('sin match devuelve persona null (para vincular a mano)', () => {
    const r = matchAsegurados([{ tipo_doc: 'DNI', documento: '99999999', nombre: 'ALGUIEN DESCONOCIDO' }], []);
    expect(r[0].persona).toBeNull();
  });
  it('ignora personal eliminado', () => {
    const personal = [{ id: 'p3', dni: '11112222', nombres: 'X', apellidos: 'Y', deleted_at: '2026-01-01' }];
    const r = matchAsegurados([{ tipo_doc: 'DNI', documento: '11112222', nombre: 'X Y' }], personal);
    expect(r[0].persona).toBeNull();
  });
});

describe('sctr-paquete — secciones', () => {
  it('limpia tipos inválidos, ordena y recorta a las páginas reales', () => {
    const s = validarSecciones([
      { tipo: 'factura', pagina_desde: 5, pagina_hasta: 99 },
      { tipo: 'certificado', pagina_desde: 1, pagina_hasta: 2 },
      { tipo: 'inventado', pagina_desde: 3, pagina_hasta: 3 },
    ], 6);
    expect(s[0]).toEqual({ tipo: 'certificado', desde: 1, hasta: 2 });
    expect(s[1]).toEqual({ tipo: 'otro', desde: 3, hasta: 3 });
    expect(s[2]).toEqual({ tipo: 'factura', desde: 5, hasta: 6 });
  });
  it('sin secciones → todo el PDF como "otro"', () => {
    expect(validarSecciones([], 4)).toEqual([{ tipo: 'otro', desde: 1, hasta: 4 }]);
  });
  it('el certificado mapea al tipo de evidencia "sctr" (visible para seguridad)', () => {
    expect(TIPOS_DOC_SCTR.certificado.tipo_evidencia).toBe('sctr');
    expect(TIPOS_DOC_SCTR.factura.tipo_evidencia).toBe('sctr_factura');
  });
});
