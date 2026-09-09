import { describe, it, expect } from 'vitest';
import { calcularBalance, lineasDeBalance, activoFijoNeto, TODAS } from '../balance-general.js';

// Los casos salen de lo que hay en producción el 9-set-2026, no de datos
// inventados: JARVEX con una nota de crédito registrada como ingreso negativo
// (S/ −12.920), GASOMI con su vibrador de concreto en el 7.1, y el efectivo
// negativo que se va al pasivo como déficit.
const mov = (o) => ({
  id: o.id, company_id: o.emp || 'JARVEX', type: o.type, amount: o.monto,
  payment_status: o.estado || 'paid', currency: o.moneda || 'PEN',
  date: o.fecha || '2026-07-01', document_number: o.doc || 'F001-1',
  third_party_name: o.quien || 'ALGUIEN', deleted_at: null,
});

const activo = (o) => ({
  id: o.id, company_id: o.emp || 'GASOMI', periodo: o.periodo || 2026,
  cuenta_contable: o.cuenta || '333', descripcion: o.desc || 'BIEN',
  saldo_inicial: 0, adquisiciones: o.costo, mejoras: 0, retiros: 0, otros_ajustes: 0,
  ajuste_inflacion: 0, porcentaje_depreciacion: o.tasa ?? 20, meses_uso: o.meses ?? 12,
  deprec_acum_anterior: 0, deprec_retiros: 0, deprec_otros_ajustes: 0,
  ajuste_inflacion_deprec: 0, estado: o.estado || 'activo',
  metodo_depreciacion: 'linea_recta', deleted_at: null,
});

describe('calcularBalance — las cifras no cambiaron de fórmula', () => {
  it('activo = efectivo + cuentas por cobrar, y cuadra contra pasivo + patrimonio', () => {
    const b = calcularBalance({
      movs: [
        mov({ id: '1', type: 'income', monto: 1000 }),
        mov({ id: '2', type: 'cost', monto: 400 }),
        mov({ id: '3', type: 'income', monto: 500, estado: 'pending' }),
        mov({ id: '4', type: 'expense', monto: 200, estado: 'pending' }),
      ],
    });
    expect(b.efectivo).toBe(600);
    expect(b.cxc).toBe(500);
    expect(b.cxp).toBe(200);
    expect(b.activoTotal).toBe(1100);
    expect(b.patrimonio).toBe(900);
    expect(b.cuadra).toBe(true);
  });

  it('un movimiento anulado no entra en ninguna línea', () => {
    const b = calcularBalance({ movs: [mov({ id: '1', type: 'cost', monto: 900, estado: 'cancelled' })] });
    expect(b.countMovs).toBe(0);
    expect(b.costosPagados).toBe(0);
  });

  it('el efectivo negativo se recorta en cero y va al pasivo como déficit', () => {
    const b = calcularBalance({ movs: [mov({ id: '1', type: 'cost', monto: 700 })] });
    expect(b.efectivo).toBe(0);
    expect(b.efectivoBruto).toBe(-700);
    expect(b.deficitFinanciamiento).toBe(700);
    expect(b.pasivoTotal).toBe(700);
    expect(b.cuadra).toBe(true);
  });

  it('acota por empresa y por moneda', () => {
    const movs = [
      mov({ id: '1', type: 'income', monto: 100, emp: 'A' }),
      mov({ id: '2', type: 'income', monto: 999, emp: 'B' }),
      mov({ id: '3', type: 'income', monto: 555, emp: 'A', moneda: 'USD' }),
    ];
    expect(calcularBalance({ movs, companyId: 'A' }).ingresosCobrados).toBe(100);
    expect(calcularBalance({ movs, companyId: 'A', moneda: 'USD' }).ingresosCobrados).toBe(555);
    expect(calcularBalance({ movs, companyId: TODAS }).ingresosCobrados).toBe(1099);
  });
});

describe('el desglose — de qué comprobantes sale cada número', () => {
  it('cada línea trae sus comprobantes, ordenados por importe', () => {
    const b = calcularBalance({
      movs: [
        mov({ id: 'chico', type: 'income', monto: 10, doc: 'F001-2' }),
        mov({ id: 'grande', type: 'income', monto: 900, doc: 'F001-3' }),
      ],
    });
    expect(b.desglose.ingresosCobrados.map(f => f.documento)).toEqual(['F001-3', 'F001-2']);
    expect(b.desglose.ingresosCobrados[0]).toMatchObject({ tercero: 'ALGUIEN', monto: 900 });
  });

  it('🔴 la nota de crédito de JARVEX: el desglose la muestra, el total solo la resta', () => {
    // El caso real que hacía leer el Balance como un error del programa.
    const b = calcularBalance({
      movs: [
        mov({ id: 'nc', type: 'income', monto: -12920, doc: 'FC01-1', quien: 'EL INCA' }),
        mov({ id: 'ok', type: 'income', monto: 5000, doc: 'F001-9' }),
      ],
    });
    expect(b.ingresosCobrados).toBe(-7920);
    // Ordena por VALOR ABSOLUTO: la NC es la que más pesa y va primero.
    expect(b.desglose.ingresosCobrados[0]).toMatchObject({ documento: 'FC01-1', monto: -12920 });
  });

  it('el desglose ordena por lo que pesa, no por lo que es positivo', () => {
    const b = calcularBalance({
      movs: [
        mov({ id: 'a', type: 'cost', monto: 5, estado: 'pending' }),
        mov({ id: 'b', type: 'expense', monto: -80, estado: 'pending' }),
        mov({ id: 'c', type: 'cost', monto: 40, estado: 'pending' }),
      ],
    });
    expect(b.desglose.cxp.map(f => f.id)).toEqual(['b', 'c', 'a']);
  });

  it('el cronograma se filtra por moneda (un pago en dólares no suma en soles)', () => {
    const pagos = [
      { id: 'p1', estado: 'programado', monto: 100, moneda: 'PEN', company_id: 'A' },
      { id: 'p2', estado: 'programado', monto: 999, moneda: 'USD', company_id: 'A' },
      { id: 'p3', estado: 'pagado', monto: 50, moneda: 'PEN', company_id: 'A' },
      // Sin moneda cuenta como soles: es el default de la app.
      { id: 'p4', estado: 'vencido', monto: 7, company_id: 'A' },
    ];
    const b = calcularBalance({ movs: [], pagos, companyId: 'A' });
    expect(b.pasivoCronograma).toBe(107);
    expect(b.countPagos).toBe(2);
  });
});

describe('el activo fijo — la línea nueva', () => {
  it('entra al activo por su valor en libros, no por lo que costó', () => {
    // 10.000 al 20% por 12 meses = 2.000 de depreciación → 8.000 en libros.
    const b = calcularBalance({ movs: [], activos: [activo({ id: 'a', costo: 10000 })], companyId: 'GASOMI' });
    expect(b.activoFijo).toBe(8000);
    expect(b.activoTotal).toBe(8000);
    expect(b.patrimonio).toBe(8000);
    expect(b.cuadra).toBe(true);
  });

  it('🔴 solo el ÚLTIMO ejercicio de cada empresa: el 7.1 lleva una fila por año', () => {
    const r = activoFijoNeto([
      activo({ id: '2025', costo: 10000, periodo: 2025 }),
      activo({ id: '2026', costo: 10000, periodo: 2026 }),
    ], 'GASOMI');
    // Sin esta regla el mismo vibrador contaría dos veces.
    expect(r.filas.map(f => f.id)).toEqual(['2026']);
    expect(r.periodos.get('GASOMI')).toBe(2026);
  });

  it('cada empresa con su propio último ejercicio, mirando el grupo', () => {
    const r = activoFijoNeto([
      activo({ id: 'g2025', emp: 'GASOMI', costo: 1000, periodo: 2025 }),
      activo({ id: 'g2026', emp: 'GASOMI', costo: 1000, periodo: 2026 }),
      activo({ id: 'j2024', emp: 'JARVEX', costo: 1000, periodo: 2024 }),
    ], TODAS);
    expect(r.filas.map(f => f.id).sort()).toEqual(['g2026', 'j2024']);
  });

  it('lo retirado y lo vendido ya no es de la empresa', () => {
    const r = activoFijoNeto([
      activo({ id: 'vivo', costo: 1000 }),
      activo({ id: 'ido', costo: 9000, estado: 'retirado' }),
      activo({ id: 'vendido', costo: 9000, estado: 'vendido' }),
    ], 'GASOMI');
    expect(r.filas.map(f => f.id)).toEqual(['vivo']);
  });

  it('sin registro 7.1 la línea no existe (no se muestra un cero que nadie puede llenar)', () => {
    const b = calcularBalance({ movs: [mov({ id: '1', type: 'income', monto: 100 })] });
    expect(b.activoFijo).toBe(0);
    expect(lineasDeBalance(b).some(l => l.clave === 'activoFijo')).toBe(false);
  });
});

describe('lineasDeBalance — lo que la pantalla recorre', () => {
  const b = calcularBalance({
    movs: [
      mov({ id: '1', type: 'income', monto: 1000 }),
      mov({ id: '2', type: 'cost', monto: 300, estado: 'pending' }),
    ],
    activos: [activo({ id: 'a', emp: 'JARVEX', costo: 1000 })],
    companyId: 'JARVEX',
  });
  const lineas = lineasDeBalance(b);

  it('trae las tres secciones, cada línea con su código del PCGE y su monto', () => {
    expect([...new Set(lineas.map(l => l.seccion))]).toEqual(['activo', 'pasivo', 'patrimonio']);
    for (const l of lineas) {
      expect(l.codigo).toMatch(/^\d{2}$/);
      expect(l.label.length).toBeGreaterThan(5);
      expect(typeof l.monto).toBe('number');
      expect(l.clave).toBeTruthy();
    }
  });

  it('el efectivo se abre en tres partes: una que suma y dos que restan', () => {
    const ef = lineas.find(l => l.clave === 'efectivo');
    expect(ef.partes.map(p => p.signo)).toEqual([1, -1, -1]);
    expect(ef.partes[0].filas).toHaveLength(1);
  });

  it('el patrimonio NO se puede abrir: es un cuadre, no tiene comprobantes', () => {
    const pat = lineas.find(l => l.clave === 'patrimonio');
    expect(pat.filas).toBeNull();
    expect(pat.partes).toBeUndefined();
    expect(pat.nota).toMatch(/cuadre/i);
  });

  it('la línea del activo fijo dice de qué ejercicio habla', () => {
    const af = lineas.find(l => l.clave === 'activoFijo');
    expect(af.nota).toContain('2026');
    expect(af.filas).toHaveLength(1);
  });

  it('el déficit solo aparece cuando existe', () => {
    expect(lineas.some(l => l.clave === 'deficit')).toBe(false);
    const enRojo = lineasDeBalance(calcularBalance({ movs: [mov({ id: '1', type: 'cost', monto: 50 })] }));
    expect(enRojo.some(l => l.clave === 'deficit')).toBe(true);
  });
});

describe('nada de esto rompe con basura', () => {
  it('sin argumentos devuelve un balance en cero que cuadra', () => {
    const b = calcularBalance();
    expect(b.activoTotal).toBe(0);
    expect(b.cuadra).toBe(true);
    expect(lineasDeBalance(b).length).toBeGreaterThan(0);
  });

  it('filas nulas, importes basura y borrados no cuentan', () => {
    const b = calcularBalance({
      movs: [null, undefined, { ...mov({ id: 'x', type: 'cost', monto: 100 }), deleted_at: '2026-01-01' },
        mov({ id: 'y', type: 'income', monto: 'no-es-un-numero' })],
      pagos: [null, { id: 'p', estado: 'programado', monto: null, moneda: 'PEN' }],
      activos: [null, undefined],
    });
    expect(b.activoTotal).toBe(0);
    expect(b.pasivoCronograma).toBe(0);
    expect(b.cuadra).toBe(true);
  });
});
