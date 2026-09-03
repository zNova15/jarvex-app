import { describe, it, expect } from 'vitest';
import { resumenPorEntidad } from '../contabilidad-entidades.js';

const mov = (o) => ({
  id: o.id, company_id: o.company_id || null, obra_id: o.obra_id || null,
  trabajo_id: o.trabajo_id || null, type: o.type || 'cost',
  amount: o.amount || 0, currency: o.currency || 'PEN',
  payment_status: o.payment_status || null, is_intercompany: !!o.interco,
  deleted_at: null, demo: false,
});

const base = () => ({
  companies: [
    { id: 'c1', name: 'JARVEX', tipo_entidad: 'propia', ruc: '20111' },
    { id: 'c2', name: 'GASOMI', tipo_entidad: 'propia' },
    { id: 'cons', name: 'CONSORCIO EL INCA', tipo_entidad: 'consorcio' },
    { id: 'ter', name: 'PROVEEDOR SAC', tipo_entidad: 'tercero' },
  ],
  obras: [{ id: 'o1', nombre_obra: 'Miraflores', ejecutora_company_id: 'cons', estado: 'activo' }],
  trabajos: [{ id: 't1', nombre: 'Venta de tubos', tipo: 'bien', ejecutor_company_id: 'c1', estado: 'entregado' }],
  consorcios: [{ id: 'k1', obra_id: 'o1', company_id: 'cons' }],
});

describe('resumenPorEntidad — qué entidades llevan contabilidad', () => {
  it('lista SOLO las empresas propias: el consorcio y el tercero no son entidades de esta lista', () => {
    const r = resumenPorEntidad({ ...base(), movs: [] });
    expect(r.empresas.map(e => e.nombre).sort()).toEqual(['GASOMI', 'JARVEX']);
  });

  it('el consorcio aparece como TITULAR de su obra, no como empresa suelta', () => {
    const r = resumenPorEntidad({ ...base(), movs: [] });
    const obra = r.trabajos.find(t => t.id === 'o1');
    expect(obra.titular).toBe('CONSORCIO EL INCA');
    expect(obra.esConsorcio).toBe(true);
  });

  it('lista obras y bienes/servicios juntos como trabajos', () => {
    const r = resumenPorEntidad({ ...base(), movs: [] });
    expect(r.trabajos.map(t => t.kind).sort()).toEqual(['bien_servicio', 'obra']);
  });
});

describe('resumenPorEntidad — los números', () => {
  const movs = [
    // De JARVEX, imputado a la obra
    mov({ id: 'm1', company_id: 'c1', obra_id: 'o1', type: 'cost', amount: 100 }),
    // De GASOMI, imputado a la obra
    mov({ id: 'm2', company_id: 'c2', obra_id: 'o1', type: 'cost', amount: 50 }),
    // Venta del consorcio en la obra
    mov({ id: 'm3', company_id: 'cons', obra_id: 'o1', type: 'income', amount: 400 }),
    // De JARVEX, imputado al bien/servicio
    mov({ id: 'm4', company_id: 'c1', trabajo_id: 't1', type: 'income', amount: 80 }),
    // De JARVEX, sin trabajo (gasto de oficina)
    mov({ id: 'm5', company_id: 'c1', type: 'expense', amount: 20 }),
  ];

  it('la empresa suma lo suyo por company_id', () => {
    const r = resumenPorEntidad({ ...base(), movs });
    const jarvex = r.empresas.find(e => e.nombre === 'JARVEX');
    expect(jarvex.ingresos).toBe(80);          // m4
    expect(jarvex.egresos).toBe(120);          // m1 (cost) + m5 (expense)
    expect(jarvex.utilidad).toBe(-40);
  });

  it('el trabajo suma TODO lo imputado a él, sea de la empresa que sea', () => {
    const r = resumenPorEntidad({ ...base(), movs });
    const obra = r.trabajos.find(t => t.id === 'o1');
    // Es la cadena intercompany: el titular no es el único que factura a la obra.
    expect(obra.egresos).toBe(150);            // m1 + m2
    expect(obra.ingresos).toBe(400);           // m3
    expect(obra.nMovs).toBe(3);
  });

  it('los totales van SEPARADOS: sumarlos contaría dos veces el mismo comprobante', () => {
    const r = resumenPorEntidad({ ...base(), movs });
    // m1 está en JARVEX y también en la obra: los dos cortes lo cuentan.
    expect(r.totales.empresas.nMovs).toBe(4);  // m1,m2,m4,m5 (m3 es del consorcio)
    expect(r.totales.trabajos.nMovs).toBe(4);  // m1,m2,m3 en la obra + m4 en el bien
  });

  it('avisa cuánto NO alcanza a mostrar el corte por empresa (consorcios y terceros)', () => {
    // Sin este número, el total por empresa parece "toda la plata del grupo" y
    // los movimientos del consorcio faltarían sin explicación.
    const r = resumenPorEntidad({ ...base(), movs });
    expect(r.fueraDeEmpresas.nMovs).toBe(1);   // m3, a nombre del consorcio
    expect(r.fueraDeEmpresas.ingresos).toBe(400);
  });

  it('cuenta lo que no está imputado a ningún trabajo', () => {
    const r = resumenPorEntidad({ ...base(), movs });
    expect(r.sinImputar.nMovs).toBe(1);        // m5
    expect(r.sinImputar.egresos).toBe(20);
  });

  it('los anulados no suman y se cuentan aparte', () => {
    const conAnulado = [...movs, mov({ id: 'm6', company_id: 'c1', obra_id: 'o1', type: 'cost', amount: 999, payment_status: 'cancelled' })];
    const r = resumenPorEntidad({ ...base(), movs: conAnulado });
    const obra = r.trabajos.find(t => t.id === 'o1');
    expect(obra.egresos).toBe(150);            // el anulado NO entra
    expect(obra.anulados).toBe(1);
  });

  it('una moneda por vez: los dólares se cuentan aparte, no se mezclan', () => {
    const conUsd = [...movs, mov({ id: 'm7', company_id: 'c1', obra_id: 'o1', type: 'cost', amount: 300, currency: 'USD' })];
    const r = resumenPorEntidad({ ...base(), movs: conUsd, moneda: 'PEN' });
    const obra = r.trabajos.find(t => t.id === 'o1');
    expect(obra.egresos).toBe(150);
    expect(obra.otrasMonedas).toBe(1);
    // Y mirando en USD, aparece el otro.
    const rUsd = resumenPorEntidad({ ...base(), movs: conUsd, moneda: 'USD' });
    expect(rUsd.trabajos.find(t => t.id === 'o1').egresos).toBe(300);
  });

  it('los números de una empresa son los MISMOS que muestra su ficha', () => {
    // Mismo criterio (resumenFinancieroEmpresa) a propósito: si esta pantalla
    // y la ficha de la empresa dieran distinto, no se podría confiar en ninguna.
    const r = resumenPorEntidad({ ...base(), movs });
    const gasomi = r.empresas.find(e => e.nombre === 'GASOMI');
    expect(gasomi.egresos).toBe(50);
    expect(gasomi.nMovs).toBe(1);
  });

  it('lo borrado y lo demo no entran', () => {
    const sucio = [
      ...movs,
      { ...mov({ id: 'm8', company_id: 'c1', obra_id: 'o1', type: 'cost', amount: 500 }), deleted_at: '2026-01-01' },
      { ...mov({ id: 'm9', company_id: 'c1', obra_id: 'o1', type: 'cost', amount: 700 }), demo: true },
    ];
    const r = resumenPorEntidad({ ...base(), movs: sucio });
    expect(r.trabajos.find(t => t.id === 'o1').egresos).toBe(150);
  });

  it('sin datos no explota', () => {
    const r = resumenPorEntidad({});
    expect(r.empresas).toEqual([]);
    expect(r.trabajos).toEqual([]);
    expect(r.sinImputar.nMovs).toBe(0);
  });
});
