import { describe, it, expect } from 'vitest';
import { impactoDeReclasificar, movimientosADesmarcar, avisoDeReclasificacion } from '../reclasificar-entidad.js';

// El caso real (medido contra producción el 5-sep-2026): CONSORCIO ESPERANZA
// y CONSORCIO SAMADAY pasaron a 'tercero' y 35 comprobantes por S/ 214.071
// dejaron de eliminarse en el Consolidado, en silencio.
const esperanza = { id: 'c-esperanza', name: 'CONSORCIO ESPERANZA', ruc: '20611547367', tipo_entidad: 'consorcio' };

const mov = (o = {}) => ({
  id: o.id || Math.random().toString(36).slice(2),
  is_intercompany: true, currency: 'PEN', amount: 5000,
  related_company_id: 'c-esperanza', document_number: 'E001-1', ...o,
});

describe('impactoDeReclasificar — el selector que mueve plata', () => {
  const movs = [
    mov({ id: 'a', amount: 20000, document_number: 'E001-21' }),
    mov({ id: 'b', amount: 5048, document_number: 'E001-142' }),
    mov({ id: 'c', amount: 1000, currency: 'USD', document_number: 'E001-99' }),
    mov({ id: 'd', amount: 9999, is_intercompany: false }),          // no marcado interno
    mov({ id: 'e', amount: 8888, related_company_id: 'otra' }),      // otra contraparte
    mov({ id: 'f', amount: 7777, deleted_at: 'x' }),                 // borrado
  ];

  it('salir del grupo saca los internos del consolidado, y los cuenta', () => {
    const r = impactoDeReclasificar({ company: esperanza, tipoNuevo: 'tercero', movs });
    expect(r.salenDelConsolidado).toBe(3);
    expect(r.soles).toBe(25048);
    expect(r.dolares).toBe(1000);
    expect(r.docs).toEqual(['E001-21', 'E001-142', 'E001-99']);
  });

  it('volver al grupo es el movimiento inverso', () => {
    const tercero = { ...esperanza, tipo_entidad: 'tercero' };
    const r = impactoDeReclasificar({ company: tercero, tipoNuevo: 'consorcio', movs });
    expect(r.entranAlConsolidado).toBe(3);
    expect(r.salenDelConsolidado).toBe(0);
  });

  it('propia ↔ consorcio NO mueve nada: las dos están dentro del grupo', () => {
    const r = impactoDeReclasificar({ company: { ...esperanza, tipo_entidad: 'propia' }, tipoNuevo: 'consorcio', movs });
    expect(r.cambia).toBe(true);
    expect(r.salenDelConsolidado).toBe(0);
    expect(r.entranAlConsolidado).toBe(0);
  });

  it('reconoce la contraparte por RUC cuando no hay related_company_id', () => {
    const porRuc = [mov({ id: 'x', related_company_id: null, third_party_ruc: '20611547367', amount: 300 })];
    expect(impactoDeReclasificar({ company: esperanza, tipoNuevo: 'tercero', movs: porRuc }).salenDelConsolidado).toBe(1);
  });

  it('sin cambio de tipo no hay impacto', () => {
    expect(impactoDeReclasificar({ company: esperanza, tipoNuevo: 'consorcio', movs }).cambia).toBe(false);
  });

  it('sin movimientos afectados no inventa un aviso', () => {
    expect(avisoDeReclasificacion(impactoDeReclasificar({ company: esperanza, tipoNuevo: 'tercero', movs: [] }))).toBe(null);
  });
});

describe('avisoDeReclasificacion — dice cuánta plata se mueve, antes de guardar', () => {
  const movs = [mov({ amount: 20000, document_number: 'E001-21' })];

  it('al salir del grupo nombra el monto y qué les pasa a las facturas', () => {
    const t = avisoDeReclasificacion(
      impactoDeReclasificar({ company: esperanza, tipoNuevo: 'tercero', movs }), 'CONSORCIO ESPERANZA');
    expect(t).toMatch(/CONSORCIO ESPERANZA/);
    expect(t).toMatch(/20,000\.00/);
    expect(t).toMatch(/TERCERO/);
    // Ya no promete "el Consolidado va a cambiar": ese número NO se mueve
    // (el catálogo ya mandaba). Lo que cambia es la marca de las facturas.
    expect(t).toMatch(/DEJAR DE ESTAR MARCADOS/);
    expect(t).not.toMatch(/Consolidado del grupo va a cambiar/);
  });

  it('al entrar al grupo lo dice al revés', () => {
    const t = avisoDeReclasificacion(
      impactoDeReclasificar({ company: { ...esperanza, tipo_entidad: 'tercero' }, tipoNuevo: 'consorcio', movs }), 'X');
    expect(t).toMatch(/entra al GRUPO/i);
    expect(t).toMatch(/ELIMINARSE/);
  });

  it('un cambio sin plata detrás no molesta con un aviso', () => {
    expect(avisoDeReclasificacion({ cambia: true, salenDelConsolidado: 0, entranAlConsolidado: 0 })).toBe(null);
    expect(avisoDeReclasificacion(null)).toBe(null);
  });
});

// ── Desmarcar las facturas (Gabriel, 5-sep) ──────────────────────────────
// «Si una entidad que era parte del grupo pasa a tercero, ya no sería una
// operación intercompany, ya que intercompany sería DENTRO del grupo.»
describe('movimientosADesmarcar — el dato tiene que respetar la definición', () => {
  const movs = [
    mov({ id: 'a' }), mov({ id: 'b' }),
    mov({ id: 'c', is_intercompany: false }),        // no estaba marcado
    mov({ id: 'd', related_company_id: 'otra' }),    // otra contraparte
    mov({ id: 'e', deleted_at: 'x' }),               // borrado
    mov({ id: 'f', related_company_id: null, third_party_ruc: '20611547367' }), // por RUC
  ];

  it('salir del grupo desmarca solo las que apuntan a esa entidad', () => {
    expect(movimientosADesmarcar({ company: esperanza, tipoNuevo: 'tercero', movs }).sort())
      .toEqual(['a', 'b', 'f']);
  });

  it('los otros cambios de tipo NO desmarcan nada', () => {
    expect(movimientosADesmarcar({ company: esperanza, tipoNuevo: 'propia', movs })).toEqual([]);
    expect(movimientosADesmarcar({ company: { ...esperanza, tipo_entidad: 'tercero' }, tipoNuevo: 'consorcio', movs })).toEqual([]);
  });

  it('el aviso ya no promete que el Consolidado cambia — promete lo que sí pasa', () => {
    const t = avisoDeReclasificacion(
      impactoDeReclasificar({ company: esperanza, tipoNuevo: 'tercero', movs }), 'CONSORCIO ESPERANZA');
    expect(t).toMatch(/DEJAR DE ESTAR MARCADOS/);
    expect(t).toMatch(/No se borra ni se modifica ningún importe/);
  });
});
