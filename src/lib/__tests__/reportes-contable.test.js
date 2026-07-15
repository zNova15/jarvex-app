import { describe, it, expect } from 'vitest';
import { agregarContable, faltaBancarizacion } from '../reportes-contable.js';

const companiesById = new Map([['c1', { name: 'Empresa A' }], ['c2', { name: 'Empresa B' }]]);
const obrasById = new Map([['o1', { nombre_obra: 'Obra Uno' }], ['o2', { nombre_obra: 'Obra Dos' }]]);

const movimientos = [
  // compras (cost/expense)
  { id: 'f1', type: 'cost', date: '2026-07-10', amount: 5000, currency: 'PEN', company_id: 'c1', obra_id: 'o1', proveedor_id: 'p1', third_party_name: 'Ferretería SAC', category: 'Materiales', payment_status: 'pending', document_number: 'F001-1' },
  { id: 'f2', type: 'expense', date: '2026-07-11', amount: 1500, currency: 'PEN', company_id: 'c2', obra_id: 'o1', proveedor_id: 'p2', third_party_name: 'Servicios EIRL', category: 'Servicios', payment_status: 'paid', document_number: 'F002-2' },
  { id: 'f3', type: 'cost', date: '2026-07-11', amount: 3000, currency: 'PEN', company_id: 'c1', obra_id: 'o2', proveedor_id: 'p1', third_party_name: 'Ferretería SAC', category: 'Materiales', payment_status: 'pending', document_number: 'F001-3' },
  // venta (income)
  { id: 'v1', type: 'income', date: '2026-07-10', amount: 20000, currency: 'PEN', company_id: 'c1', obra_id: 'o1', clase: 'venta' },
  // fuera de rango
  { id: 'old', type: 'cost', date: '2026-06-01', amount: 9999, currency: 'PEN', company_id: 'c1', obra_id: 'o1', third_party_name: 'X' },
];
const bancarizadoSet = new Set(['f1']); // f1 (5000) ya bancarizado; f3 (3000) NO → pendiente
const pagos = [
  { id: 'pg1', estado: 'pagado', monto_acordado: 2000 },
  { id: 'pg2', estado: 'pendiente', monto_acordado: 3500 },
  { id: 'pg3', estado: 'parcial', monto_acordado: 1000 },
];
const base = { movimientos, bancarizadoSet, pagos, companiesById, obrasById, from: '2026-07-06', to: '2026-07-12', topN: 10 };

describe('faltaBancarizacion', () => {
  it('solo PEN > 2000 sin evidencia', () => {
    expect(faltaBancarizacion({ id: 'f3', currency: 'PEN', amount: 3000 }, bancarizadoSet)).toBe(true);
    expect(faltaBancarizacion({ id: 'f1', currency: 'PEN', amount: 5000 }, bancarizadoSet)).toBe(false); // ya bancarizado
    expect(faltaBancarizacion({ id: 'x', currency: 'PEN', amount: 1500 }, bancarizadoSet)).toBe(false); // ≤2000
    expect(faltaBancarizacion({ id: 'x', currency: 'USD', amount: 9000 }, bancarizadoSet)).toBe(false); // no PEN
  });
});

describe('agregarContable — KPIs', () => {
  const r = agregarContable(base);
  it('total compras (cost+expense en rango)', () => { expect(r.kpis.totalCompras).toBe(5000 + 1500 + 3000); }); // 9500 (old excluido)
  it('total ventas', () => { expect(r.kpis.totalVentas).toBe(20000); });
  it('n facturas de compra', () => { expect(r.kpis.nFacturas).toBe(3); });
  it('bancarización pendiente: solo f3 (3000)', () => {
    expect(r.kpis.bancPendCount).toBe(1);
    expect(r.kpis.bancPendMonto).toBe(3000);
  });
  it('pagos: pagado 2000, pendiente = pendiente+parcial 4500', () => {
    expect(r.kpis.pagadoTotal).toBe(2000);
    expect(r.kpis.pagoPendiente).toBe(3500 + 1000);
  });
});

describe('agregarContable — agrupaciones', () => {
  const r = agregarContable(base);
  it('consumo por obra', () => {
    const o1 = r.consumoPorObra.find(x => x.nombre === 'Obra Uno');
    expect(o1.monto).toBe(5000 + 1500); // f1+f2
  });
  it('consumo por empresa del grupo', () => {
    const c1 = r.consumoPorEmpresa.find(x => x.nombre === 'Empresa A');
    expect(c1.monto).toBe(5000 + 3000); // f1+f3
  });
  it('top proveedores', () => {
    expect(r.topProveedores[0].nombre).toBe('Ferretería SAC'); // 5000+3000=8000
    expect(r.topProveedores[0].monto).toBe(8000);
  });
  it('facturas recientes ordenadas por fecha desc con flag de bancarización', () => {
    expect(r.facturasRecientes[0].fecha).toBe('2026-07-11');
    const f3 = r.facturasRecientes.find(f => f.doc === 'F001-3');
    expect(f3.faltaBanc).toBe(true);
  });
});

describe('agregarContable — clase manda (no doble conteo)', () => {
  it("un mov clase='venta' con type='cost' cuenta SOLO como venta", () => {
    const movs = [{ id: 'z', type: 'cost', clase: 'venta', date: '2026-07-10', amount: 8000, currency: 'PEN', company_id: 'c1', obra_id: 'o1' }];
    const r = agregarContable({ movimientos: movs, bancarizadoSet: new Set(), companiesById, obrasById, from: '2026-07-06', to: '2026-07-12' });
    expect(r.kpis.totalVentas).toBe(8000);
    expect(r.kpis.totalCompras).toBe(0);
    expect(r.kpis.nFacturas).toBe(0);      // no es compra
    expect(r.kpis.bancPendCount).toBe(0);  // una venta no genera bancarización pendiente
    expect(r.detalle.length).toBe(1);      // no aparece dos veces
  });
});

describe('agregarContable — robustez', () => {
  it('sin datos no revienta', () => {
    const r = agregarContable({});
    expect(r.kpis.totalCompras).toBe(0); expect(r.consumoPorObra).toEqual([]); expect(r.facturasRecientes).toEqual([]);
  });
});
