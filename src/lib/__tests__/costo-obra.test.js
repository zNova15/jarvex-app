import { describe, it, expect } from 'vitest';
import {
  costoDeObra, consumoPorObraModeloB, esCompraMov, esVentaMov, NOTA_NO_SE_SUMAN,
} from '../costo-obra.js';

// ── EL CASO DE PRODUCCIÓN QUE ORDENA TODO ─────────────────────────
// Plan Miraflores, medido contra la base real el 6-sep-2026:
//
//   jx-kpis-obra mostraba «ejecutado»    S/ 2.255.308,67  (415 movs type=cost)
//   compras del titular (EL INCA)        S/   227.805,65  (113)
//   aporte del grupo                     S/ 2.027.503,02  (302)
//   ventas del grupo AL titular          S/    59.684,12  (9)
//     …de esas, sin espejo (2 de JARVEX) S/    31.948,68
//
// Los tests de abajo reproducen esas proporciones con montos redondos, y el
// último verifica la suma exacta contra los tres números reales.
const EL_INCA = 'c-inca';
const JARVEX = 'c-jarvex';
const GASOMI = 'c-gasomi';

const companies = [
  { id: EL_INCA, name: 'CONSORCIO EL INCA', ruc: '20615346081' },
  { id: JARVEX, name: 'JARVEX', ruc: '20615646505' },
  { id: GASOMI, name: 'GASOMI', ruc: '20600097726' },
];

const MIRAFLORES = 'obra-miraflores';
const obra = { id: MIRAFLORES, nombre_obra: 'Plan Miraflores' };
const consorcios = [{ id: 'k1', obra_id: MIRAFLORES, company_id: EL_INCA, nombre: 'CONSORCIO EL INCA' }];

let seq = 0;
const mov = (o = {}) => ({
  id: o.id || `m${++seq}`,
  company_id: GASOMI, clase: 'compra', type: 'cost', amount: 100,
  obra_id: MIRAFLORES, currency: 'PEN', ...o,
});

describe('esCompraMov / esVentaMov', () => {
  it('manda `clase` cuando está', () => {
    expect(esCompraMov({ clase: 'compra', type: 'income' })).toBe(true);
    expect(esVentaMov({ clase: 'venta', type: 'cost' })).toBe(true);
  });

  it('cae al `type` contable cuando no hay clase', () => {
    expect(esCompraMov({ type: 'cost' })).toBe(true);
    expect(esCompraMov({ type: 'expense' })).toBe(true);
    expect(esVentaMov({ type: 'income' })).toBe(true);
    expect(esCompraMov({ type: 'income' })).toBe(false);
  });
});

describe('costoDeObra — la partición del modelo B', () => {
  it('el costo son SOLO las compras del titular; el resto es aporte', () => {
    const r = costoDeObra({
      movs: [
        mov({ company_id: EL_INCA, amount: 1000 }),
        mov({ company_id: EL_INCA, amount: 500 }),
        mov({ company_id: GASOMI, amount: 8000 }),
        mov({ company_id: JARVEX, amount: 2000 }),
      ],
      obra, consorcios, companies,
    });
    expect(r.costo.monto).toBe(1500);
    expect(r.costo.n).toBe(2);
    expect(r.aporte.monto).toBe(10000);
    expect(r.aporte.n).toBe(2);
  });

  it('NO expone un total sumado — los dos números no se suman', () => {
    const r = costoDeObra({ movs: [mov()], obra, consorcios, companies });
    expect(r).not.toHaveProperty('total');
    expect(r).not.toHaveProperty('ejecutado');
    expect(NOTA_NO_SE_SUMAN).toMatch(/no se suman/i);
  });

  it('el aporte viene desglosado por empresa, de mayor a menor', () => {
    const r = costoDeObra({
      movs: [
        mov({ company_id: GASOMI, amount: 800 }),
        mov({ company_id: JARVEX, amount: 2000 }),
        mov({ company_id: GASOMI, amount: 300 }),
      ],
      obra, consorcios, companies,
    });
    expect(r.aporte.porEmpresa.map(e => [e.nombre, e.monto]))
      .toEqual([['JARVEX', 2000], ['GASOMI', 1100]]);
  });

  it('un comprobante anulado no es costo ni aporte', () => {
    const r = costoDeObra({
      movs: [
        mov({ company_id: EL_INCA, amount: 1000, payment_status: 'cancelled' }),
        mov({ company_id: GASOMI, amount: 500, payment_status: 'cancelled' }),
        mov({ company_id: EL_INCA, amount: 200 }),
      ],
      obra, consorcios, companies,
    });
    expect(r.costo.monto).toBe(200);
    expect(r.aporte.monto).toBe(0);
    expect(r.anulados).toBe(2);
  });

  it('la VENTA de una empresa del grupo NO suma como costo en su libro', () => {
    // Es el doble conteo que el modelo B evita: la venta de JARVEX a EL INCA
    // es costo de la obra UNA vez, por el espejo, no acá.
    const r = costoDeObra({
      movs: [mov({ company_id: JARVEX, clase: 'venta', type: 'income', amount: 30000, third_party_ruc: '20615346081' })],
      obra, consorcios, companies,
    });
    expect(r.costo.monto).toBe(0);
    expect(r.aporte.monto).toBe(0);
  });
});

describe('costoDeObra — el espejo que falta', () => {
  it('una venta al titular SIN compra espejo se reporta en porEspejar', () => {
    const r = costoDeObra({
      movs: [mov({ company_id: JARVEX, clase: 'venta', type: 'income', amount: 31948.68, third_party_ruc: '20615346081' })],
      obra, consorcios, companies,
    });
    expect(r.porEspejar.n).toBe(1);
    expect(r.porEspejar.monto).toBe(31948.68);
  });

  it('si el titular ya cargó su compra espejo, la venta NO queda pendiente', () => {
    const r = costoDeObra({
      movs: [
        mov({ company_id: JARVEX, clase: 'venta', type: 'income', amount: 6735.44, third_party_ruc: '20615346081' }),
        mov({ company_id: EL_INCA, clase: 'compra', amount: 6735.44, third_party_ruc: '20615646505' }),
      ],
      obra, consorcios, companies,
    });
    expect(r.porEspejar.n).toBe(0);
    expect(r.costo.monto).toBe(6735.44);
  });

  it('reconoce la contraparte por related_company_id, no solo por RUC', () => {
    const r = costoDeObra({
      movs: [mov({ company_id: JARVEX, clase: 'venta', type: 'income', amount: 5000, related_company_id: EL_INCA })],
      obra, consorcios, companies,
    });
    expect(r.porEspejar.monto).toBe(5000);
  });

  it('una venta a un tercero de afuera no es espejo pendiente de nada', () => {
    const r = costoDeObra({
      movs: [mov({ company_id: GASOMI, clase: 'venta', type: 'income', amount: 912645.75, third_party_ruc: '20610349359' })],
      obra, consorcios, companies,
    });
    expect(r.porEspejar.n).toBe(0);
  });
});

describe('costoDeObra — sin titular no se inventa una partición', () => {
  it('sin consorcio, todo es aporte y el costo queda en cero', () => {
    const r = costoDeObra({ movs: [mov({ amount: 400 })], obra, consorcios: [], companies });
    expect(r.hayTitular).toBe(false);
    expect(r.titularId).toBe(null);
    expect(r.costo.monto).toBe(0);
    expect(r.aporte.monto).toBe(400);
  });

  it('acepta el titular ya resuelto como atajo', () => {
    const r = costoDeObra({ movs: [mov({ company_id: EL_INCA, amount: 400 })], titularId: EL_INCA, companies });
    expect(r.costo.monto).toBe(400);
  });
});

describe('consumoPorObraModeloB', () => {
  it('devuelve una fila por obra con las dos cifras separadas', () => {
    const filas = consumoPorObraModeloB({
      movs: [
        mov({ company_id: EL_INCA, amount: 1000 }),
        mov({ company_id: GASOMI, amount: 9000 }),
        mov({ company_id: JARVEX, amount: 50, obra_id: 'otra' }),
      ],
      obras: [obra, { id: 'otra', nombre_obra: 'Obras San Marcos' }],
      consorcios, companies,
    });
    expect(filas).toHaveLength(2);
    const mira = filas.find(f => f.obra_id === MIRAFLORES);
    expect(mira.costo).toBe(1000);
    expect(mira.aporte).toBe(9000);
    expect(mira.nombre).toBe('Plan Miraflores');
    expect(mira).not.toHaveProperty('monto');
  });

  it('ignora los movimientos sin obra', () => {
    const filas = consumoPorObraModeloB({
      movs: [mov({ obra_id: null }), mov({ company_id: EL_INCA, amount: 7 })],
      obras: [obra], consorcios, companies,
    });
    expect(filas).toHaveLength(1);
    expect(filas[0].costo).toBe(7);
  });
});

describe('las cifras reales de Miraflores (6-sep-2026)', () => {
  // Reconstruye la proporción medida: lo que el KPI mostraba tiene que ser
  // exactamente costo + aporte, y ninguno de los dos por separado.
  const COSTO_REAL = 227805.65;
  const APORTE_REAL = 2027503.02;
  const KPI_VIEJO = 2255308.67;

  it('costo + aporte reconstruye el número inflado que mostraba el KPI', () => {
    const r = costoDeObra({
      movs: [
        mov({ company_id: EL_INCA, amount: COSTO_REAL }),
        mov({ company_id: GASOMI, amount: APORTE_REAL }),
      ],
      obra, consorcios, companies,
    });
    expect(r.costo.monto).toBe(COSTO_REAL);
    expect(r.aporte.monto).toBe(APORTE_REAL);
    expect(r.costo.monto + r.aporte.monto).toBeCloseTo(KPI_VIEJO, 2);
    // …y el costo de verdad es 8,7 veces menor que lo que se mostraba.
    expect(KPI_VIEJO / r.costo.monto).toBeCloseTo(9.9, 1);
  });
});
