import { describe, it, expect } from 'vitest';
import {
  librosDeObra, libroDeMovimiento, contraparteCatalogo,
  LIBRO_CONSORCIO, LIBRO_GRUPO,
} from '../libros-de-obra.js';

// Caso de producción (medido el 4-sep-2026 contra la base real): Plan
// Miraflores, ejecutada por CONSORCIO EL INCA. 460 comprobantes imputados a la
// obra → 112 propios del titular + 9 que el grupo le emitió = 121 del libro
// del consorcio, y 339 de aporte del grupo.
const EL_INCA = 'company-el-inca';
const JARVEX = 'company-jarvex';
const GASOMI = 'company-gasomi';

const companies = [
  { id: EL_INCA, name: 'CONSORCIO EL INCA', ruc: '20615346081', tipo_entidad: 'consorcio' },
  { id: JARVEX, name: 'JARVEX', ruc: '20601234561', tipo_entidad: 'propia' },
  { id: GASOMI, name: 'GASOMI', ruc: '20601234562', tipo_entidad: 'propia' },
];

const mov = (o = {}) => ({
  id: o.id || Math.random().toString(36).slice(2),
  company_id: JARVEX, clase: 'compra', type: 'cost', amount: 100, currency: 'PEN',
  ...o,
});

describe('libroDeMovimiento — la regla que parte la obra en dos', () => {
  const idx = { porId: new Map(companies.map(c => [c.id, c])), porRuc: new Map(companies.map(c => [c.ruc, c])) };

  it('lo cargado en el libro del titular es del consorcio', () => {
    expect(libroDeMovimiento(mov({ company_id: EL_INCA }), EL_INCA, idx)).toBe(LIBRO_CONSORCIO);
  });

  it('lo que el grupo le EMITIÓ al titular también es de su libro (por vínculo explícito)', () => {
    expect(libroDeMovimiento(mov({ company_id: JARVEX, related_company_id: EL_INCA }), EL_INCA, idx))
      .toBe(LIBRO_CONSORCIO);
  });

  it('…y por RUC de la contraparte, sin vínculo cargado', () => {
    // A diferencia de documento-dos-lados.js, acá NO se exige `is_intercompany`:
    // no se está afirmando nada sobre otro libro, solo eligiendo columna.
    expect(libroDeMovimiento(mov({ company_id: GASOMI, third_party_ruc: '20615346081' }), EL_INCA, idx))
      .toBe(LIBRO_CONSORCIO);
  });

  it('una compra del grupo a un proveedor de afuera es aporte del grupo', () => {
    expect(libroDeMovimiento(mov({ company_id: GASOMI, third_party_ruc: '20999999991' }), EL_INCA, idx))
      .toBe(LIBRO_GRUPO);
  });

  it('sin titular contable no hay dos libros: todo cae en el grupo', () => {
    expect(libroDeMovimiento(mov({ company_id: EL_INCA }), null, idx)).toBe(LIBRO_GRUPO);
  });

  it('un RUC que no es de 11 dígitos no identifica contraparte', () => {
    expect(contraparteCatalogo(mov({ third_party_ruc: '2061534' }), idx)).toBeNull();
  });
});

describe('librosDeObra — la partición completa', () => {
  const movs = [
    ...Array.from({ length: 3 }, (_, i) => mov({ id: `p${i}`, company_id: EL_INCA, amount: 1000 })),
    mov({ id: 'r0', company_id: JARVEX, related_company_id: EL_INCA, clase: 'venta', type: 'income', amount: 500 }),
    mov({ id: 'r1', company_id: GASOMI, third_party_ruc: '20615346081', clase: 'venta', type: 'income', amount: 700 }),
    ...Array.from({ length: 4 }, (_, i) => mov({ id: `g${i}`, company_id: GASOMI, third_party_ruc: '20999999991', amount: 200 })),
  ];

  it('cuenta propios, recibidos y aporte por separado', () => {
    const r = librosDeObra({ movs, titularId: EL_INCA, companies });
    expect(r.consorcio.propios).toBe(3);
    expect(r.consorcio.recibidos).toBe(2);
    expect(r.consorcio.n).toBe(5);
    expect(r.grupo.n).toBe(4);
    expect(r.total).toBe(9);
  });

  it('los dos libros son una partición: ningún comprobante cae en los dos ni se pierde', () => {
    const r = librosDeObra({ movs, titularId: EL_INCA, companies });
    for (const id of r.consorcio.ids) expect(r.grupo.ids.has(id)).toBe(false);
    expect(r.consorcio.ids.size + r.grupo.ids.size).toBe(movs.length);
  });

  it('NO expone un total sumado de los dos libros — no se suman', () => {
    const r = librosDeObra({ movs, titularId: EL_INCA, companies });
    // `total` es la cantidad de FILAS de la obra, no una suma de dinero.
    expect(Object.keys(r)).not.toContain('montoTotal');
    expect(r.consorcio.compra.PEN).toBe(3000);
    expect(r.consorcio.venta.PEN).toBe(1200);
    expect(r.grupo.compra.PEN).toBe(800);
  });

  it('los anulados no suman plata pero se cuentan aparte', () => {
    const r = librosDeObra({
      movs: [...movs, mov({ id: 'x', company_id: EL_INCA, amount: 9999, payment_status: 'cancelled' })],
      titularId: EL_INCA, companies,
    });
    expect(r.consorcio.n).toBe(6);
    expect(r.consorcio.anulados).toBe(1);
    expect(r.consorcio.compra.PEN).toBe(3000);  // el anulado no entró
  });

  it('separa monedas en vez de mezclarlas', () => {
    const r = librosDeObra({
      movs: [mov({ company_id: EL_INCA, amount: 50, currency: 'USD' }), ...movs],
      titularId: EL_INCA, companies,
    });
    expect(r.consorcio.compra.USD).toBe(50);
    expect(r.consorcio.compra.PEN).toBe(3000);
  });

  it('ignora los borrados', () => {
    const r = librosDeObra({
      movs: [...movs, mov({ id: 'del', company_id: EL_INCA, deleted_at: '2026-09-01' })],
      titularId: EL_INCA, companies,
    });
    expect(r.total).toBe(9);
  });

  it('obra de una sola empresa: el titular es la ejecutora y su libro es el suyo', () => {
    const r = librosDeObra({
      movs: [mov({ company_id: JARVEX }), mov({ company_id: GASOMI, third_party_ruc: '20999999991' })],
      titularId: JARVEX, companies,
    });
    expect(r.hayDosLibros).toBe(true);
    expect(r.consorcio.n).toBe(1);
    expect(r.grupo.n).toBe(1);
  });

  it('sin titular: la pantalla no muestra pestañas', () => {
    const r = librosDeObra({ movs, titularId: null, companies });
    expect(r.hayDosLibros).toBe(false);
    expect(r.grupo.n).toBe(movs.length);
  });

  it('no revienta con entradas vacías', () => {
    const r = librosDeObra({});
    expect(r.total).toBe(0);
    expect(r.consorcio.n).toBe(0);
  });
});
