// ═══════════════════════════════════════════════════════════════════
// ANTICIPOS A PROVEEDORES (mig 207) — lib pura.
//
// Los datos son los REALES de KOPLAST INDUSTRIAL S.A.C (RUC 20505543174)
// contra GASOMI, medidos el 13-set-2026: dos anticipos por US$ 150.000, cuatro
// notas de crédito que anulan facturas completas, y facturas en cero. Los
// documentos, importes y fechas son textuales.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  esMovimientoAnticipo, detectarAnticipos, resolverAplicaciones,
  saldoDeAnticipo, facturasCandidatas, proponerAplicaciones,
  panelAnticipos, aplicacionNueva, pareceCubiertaPorAnticipo,
} from '../anticipos.js';

const GASOMI = 'gasomi-id';
const KOPLAST = '20505543174';

const mov = (id, doc, fecha, amount, extra = {}) => ({
  id, company_id: GASOMI, date: fecha, document_number: doc,
  document_type: 'factura', clase: 'compra', type: 'cost',
  third_party_ruc: KOPLAST, third_party_name: 'KOPLAST INDUSTRIAL S.A.C',
  currency: 'USD', amount, payment_status: 'paid', deleted_at: null,
  ...extra,
});

const conItems = (items) => ({ notas: JSON.stringify({ items_factura: items }) });

// Los dos anticipos del 31-mar: un solo ítem, «ANTICIPO DE CLIENTE».
const ANT_A = mov('a1', 'F003-3384', '2026-03-31', 80000, conItems([
  { descripcion: 'ANTICIPO DE CLIENTE', cantidad: 1, precio_unitario: 67796.61, unidad: 'und', tipo_insumo: 'material' },
]));
const ANT_B = mov('a2', 'F003-3385', '2026-03-31', 70000, conItems([
  { descripcion: 'ANTICIPO DE CLIENTE', cantidad: 1, precio_unitario: 59322.03, unidad: 'und', tipo_insumo: 'material' },
]));

// Las tres facturas que una nota de crédito anuló por completo.
const F3409 = mov('f1', 'F003-3409', '2026-04-13', 19518.72, conItems([
  { descripcion: 'TUBO PVC-U 160 mm S-25 UF ALCANTARILLADO', cantidad: 310, precio_unitario: 20.976, unidad: 'und' },
]));
const F3436 = mov('f2', 'F003-3436', '2026-04-22', 14506.70);
const F3458 = mov('f3', 'F003-3458', '2026-04-27', 9002.92);

const nc = (id, doc, amount, anulaA) => mov(id, doc, '2026-05-06', -amount, {
  document_type: 'nota_credito', related_movement_id: anulaA,
});

const NC187 = nc('n1', 'FC03-187', 19518.72, 'f1');
const NC188 = nc('n2', 'FC03-188', 14506.70, 'f2');
const NC189 = nc('n3', 'FC03-189', 9002.92, 'f3');
// La huérfana: anula F003-3460, que en JARVEX no está cargada.
const NC190 = nc('n4', 'FC03-190', 11845.70, null);

// Una entrega facturada en CERO: el descuento del anticipo ya se aplicó.
const F_CERO = mov('f4', 'F003-3478', '2026-05-06', 0);

const TODOS = [ANT_A, ANT_B, F3409, F3436, F3458, NC187, NC188, NC189, NC190, F_CERO];

describe('identificar el anticipo', () => {
  it('lo reconoce por el TEXTO del ítem, no por el tipo que puso la IA', () => {
    // La factura de anticipo de KOPLAST tiene tipo_insumo 'material'.
    expect(ANT_A.notas).toContain('material');
    expect(esMovimientoAnticipo(ANT_A)).toBe(true);
  });

  it('una compra normal del mismo proveedor no es un anticipo', () => {
    expect(esMovimientoAnticipo(F3409)).toBe(false);
  });

  it('una nota de crédito nunca es un anticipo', () => {
    expect(esMovimientoAnticipo(NC187)).toBe(false);
  });

  it('un anticipo de CLIENTE (venta) no entra: es un pasivo, no un activo', () => {
    const venta = { ...ANT_A, id: 'v1', clase: 'venta', type: 'income' };
    expect(esMovimientoAnticipo(venta)).toBe(false);
  });

  it('un movimiento anulado no cuenta', () => {
    expect(esMovimientoAnticipo({ ...ANT_A, payment_status: 'cancelled' })).toBe(false);
  });

  it('sin ítems se mira la descripción del movimiento', () => {
    expect(esMovimientoAnticipo(mov('x', 'F001-1', '2026-01-01', 100, { description: 'ADELANTO A CUENTA DE OBRA' }))).toBe(true);
    expect(esMovimientoAnticipo(mov('y', 'F001-2', '2026-01-01', 100, { description: 'CEMENTO' }))).toBe(false);
  });

  it('encuentra los DOS anticipos de KOPLAST, ordenados por plata', () => {
    const a = detectarAnticipos(TODOS, { companyId: GASOMI });
    expect(a).toHaveLength(2);
    expect(a[0].documento).toBe('F003-3384');
    expect(a[0].monto).toBe(80000);
    expect(a[0].moneda).toBe('USD');
    expect(a[1].monto).toBe(70000);
    expect(a[0].monto + a[1].monto).toBe(150000);
  });
});

describe('el saldo', () => {
  const [ant] = detectarAnticipos(TODOS, { companyId: GASOMI });

  it('sin aplicaciones, todo el anticipo está abierto', () => {
    const s = saldoDeAnticipo(ant, []);
    expect(s.aplicado).toBe(0);
    expect(s.saldo).toBe(80000);
    expect(s.cerrado).toBe(false);
    expect(s.pct).toBe(0);
  });

  it('descuenta lo aplicado y dice el porcentaje', () => {
    const s = saldoDeAnticipo(ant, [
      { anticipo_movimiento_id: 'a1', factura_movimiento_id: 'f1', monto: 19518.72, moneda: 'USD' },
      { anticipo_movimiento_id: 'a1', factura_movimiento_id: 'f2', monto: 14506.70, moneda: 'USD' },
    ]);
    expect(s.aplicado).toBe(34025.42);
    expect(s.saldo).toBe(45974.58);
    expect(s.pct).toBeCloseTo(42.53, 1);
  });

  it('🔴 una aplicación en OTRA moneda no se suma: se cuenta y se avisa', () => {
    // Sumar dólares con soles es el mismo error que hacía que el cotejo SUNAT
    // acusara S/ 199.600 de diferencia inexistente.
    const s = saldoDeAnticipo(ant, [
      { anticipo_movimiento_id: 'a1', factura_movimiento_id: 'f1', monto: 50000, moneda: 'PEN' },
    ]);
    expect(s.aplicado).toBe(0);
    expect(s.enOtraMoneda).toBe(1);
  });

  it('cierra con tolerancia: un centavo de redondeo del IGV no lo deja abierto', () => {
    const s = saldoDeAnticipo(ant, [
      { anticipo_movimiento_id: 'a1', factura_movimiento_id: 'f1', monto: 80000.02, moneda: 'USD' },
    ]);
    expect(s.cerrado).toBe(true);
    expect(s.excedido).toBe(false);
  });

  it('aplicar MÁS de lo anticipado se dice: es un error de carga', () => {
    const s = saldoDeAnticipo(ant, [
      { anticipo_movimiento_id: 'a1', factura_movimiento_id: 'f1', monto: 95000, moneda: 'USD' },
    ]);
    expect(s.excedido).toBe(true);
    expect(s.saldo).toBe(-15000);
  });

  it('las aplicaciones de OTRO anticipo no se cuentan acá', () => {
    const s = saldoDeAnticipo(ant, [
      { anticipo_movimiento_id: 'a2', factura_movimiento_id: 'f1', monto: 19518.72, moneda: 'USD' },
    ]);
    expect(s.aplicado).toBe(0);
  });
});

describe('las candidatas', () => {
  const [ant] = detectarAnticipos(TODOS, { companyId: GASOMI });

  it('son del mismo proveedor, misma moneda y de fecha posterior', () => {
    const c = facturasCandidatas(ant, TODOS);
    const docs = c.map(x => x.documento);
    expect(docs).toContain('F003-3409');
    expect(docs).toContain('F003-3478');
    // Ni el otro anticipo, ni las notas de crédito, ni él mismo.
    expect(docs).not.toContain('F003-3385');
    expect(docs).not.toContain('FC03-187');
    expect(docs).not.toContain('F003-3384');
  });

  it('marca las que vinieron en CERO', () => {
    const c = facturasCandidatas(ant, TODOS);
    expect(c.find(x => x.documento === 'F003-3478').enCero).toBe(true);
    expect(c.find(x => x.documento === 'F003-3409').enCero).toBe(false);
  });

  it('una factura de otro proveedor no entra', () => {
    const otra = mov('z1', 'F001-9', '2026-05-01', 5000, { third_party_ruc: '20100000001' });
    const c = facturasCandidatas(ant, [...TODOS, otra]);
    expect(c.map(x => x.documento)).not.toContain('F001-9');
  });

  it('una factura en soles del mismo proveedor tampoco: no se mezclan monedas', () => {
    const enSoles = mov('z2', 'F001-8', '2026-05-01', 5000, { currency: 'PEN' });
    const c = facturasCandidatas(ant, [...TODOS, enSoles]);
    expect(c.map(x => x.documento)).not.toContain('F001-8');
  });
});

describe('lo que la app propone', () => {
  const [ant] = detectarAnticipos(TODOS, { companyId: GASOMI });

  it('🔴 propone las facturas que una nota de crédito anuló, por su importe', () => {
    const p = proponerAplicaciones(ant, TODOS, []);
    const anuladas = p.filter(x => !x.pideMonto);
    expect(anuladas.map(x => x.documento)).toEqual(['F003-3409', 'F003-3436', 'F003-3458']);
    expect(anuladas.reduce((s, x) => s + x.monto, 0)).toBeCloseTo(43028.34, 2);
    expect(anuladas[0].motivo).toContain('nota de crédito');
  });

  it('🔴 la factura en CERO se propone SIN monto y pide el importe', () => {
    // El total es 0 justamente porque el descuento ya se aplicó: inventar un
    // número sería peor que no proponer nada.
    const p = proponerAplicaciones(ant, TODOS, []);
    const cero = p.find(x => x.documento === 'F003-3478');
    expect(cero.monto).toBe(0);
    expect(cero.pideMonto).toBe(true);
    expect(cero.motivo).toContain('PDF');
  });

  it('no vuelve a proponer lo que ya está aplicado', () => {
    const p = proponerAplicaciones(ant, TODOS, [
      { anticipo_movimiento_id: 'a1', factura_movimiento_id: 'f1', monto: 19518.72, moneda: 'USD' },
    ]);
    expect(p.map(x => x.documento)).not.toContain('F003-3409');
  });

  it('nunca propone más de lo que queda del anticipo', () => {
    const chico = { ...ant, monto: 20000 };
    const p = proponerAplicaciones(chico, TODOS, []);
    const total = p.reduce((s, x) => s + x.monto, 0);
    expect(total).toBeLessThanOrEqual(20000 + 0.05);
  });
});

describe('las aplicaciones duplicadas entre las dos PCs', () => {
  it('manual pisa a propuesta, y a igual fuente gana la más reciente', () => {
    const filas = [
      { anticipo_movimiento_id: 'a1', factura_movimiento_id: 'f1', monto: 100, fuente: 'propuesta', updated_at: '2026-09-13T18:00:00Z' },
      { anticipo_movimiento_id: 'a1', factura_movimiento_id: 'f1', monto: 200, fuente: 'manual', updated_at: '2026-09-13T09:00:00Z' },
    ];
    expect(resolverAplicaciones(filas)).toHaveLength(1);
    expect(resolverAplicaciones(filas)[0].monto).toBe(200);
  });

  it('las filas demo no se mezclan con las reales', () => {
    const filas = [{ anticipo_movimiento_id: 'a1', factura_movimiento_id: 'f1', monto: 1, demo: true }];
    expect(resolverAplicaciones(filas, { demo: false })).toHaveLength(0);
    expect(resolverAplicaciones(filas, { demo: true })).toHaveLength(1);
  });
});

describe('el panel entero', () => {
  it('arma los dos anticipos con su saldo y sus propuestas', () => {
    const p = panelAnticipos(TODOS, [], { companyId: GASOMI });
    expect(p.filas).toHaveLength(2);
    expect(p.abiertos).toBe(2);
    expect(p.filas[0].propuestas.length).toBeGreaterThan(0);
  });

  it('🔴 los totales NO se suman entre monedas', () => {
    const enSoles = mov('s1', 'F900-1', '2026-02-01', 5000, { currency: 'PEN', ...conItems([
      { descripcion: 'ANTICIPO DE CLIENTE', cantidad: 1, precio_unitario: 4237.29, unidad: 'und' },
    ]) });
    const p = panelAnticipos([...TODOS, enSoles], [], { companyId: GASOMI });
    const monedas = p.totales.map(t => t.moneda).sort();
    expect(monedas).toEqual(['PEN', 'USD']);
    expect(p.totales.find(t => t.moneda === 'USD').anticipado).toBe(150000);
    expect(p.totales.find(t => t.moneda === 'PEN').anticipado).toBe(5000);
  });

  it('trae el documento de la factura aplicada, y avisa cuando no está cargada', () => {
    const p = panelAnticipos(TODOS, [
      { anticipo_movimiento_id: 'a1', factura_movimiento_id: 'f1', monto: 19518.72, moneda: 'USD', fuente: 'manual' },
      { anticipo_movimiento_id: 'a1', factura_movimiento_id: 'fantasma', monto: 100, moneda: 'USD', fuente: 'manual' },
    ], { companyId: GASOMI });
    const docs = p.filas[0].aplicaciones.map(a => a.facturaDocumento);
    expect(docs).toContain('F003-3409');
    expect(docs).toContain('(comprobante no cargado)');
  });
});

describe('lo que se escribe', () => {
  const [ant] = detectarAnticipos(TODOS, { companyId: GASOMI });

  it('la fila lleva la moneda DEL ANTICIPO, no la de la factura', () => {
    const c = aplicacionNueva(ant, { facturaId: 'f1', monto: 19518.72 });
    expect(c.moneda).toBe('USD');
    expect(c.company_id).toBe(GASOMI);
    expect(c.fuente).toBe('manual');
  });

  it('🔴 un anticipo no se aplica a sí mismo — lo prohíbe el CHECK de la mig 207', () => {
    expect(() => aplicacionNueva(ant, { facturaId: ant.id, monto: 1 })).toThrow(/sí mismo/);
    expect(() => aplicacionNueva(ant, { monto: 1 })).toThrow(/factura/);
  });
});

describe('pareceCubiertaPorAnticipo (Captura Mágica, 13-set-2026)', () => {
  it('el caso KOPLAST del reporte: total 0 + "Monto total del anticipo" leído', () => {
    expect(pareceCubiertaPorAnticipo({ total: 0, montoAnticipoLeido: 3302.03, sumaItems: 3302.03 })).toBe(true);
  });

  it('total 0 sin el campo del pie, pero con ítems de valor real', () => {
    // El OCR no siempre distingue el campo del pie de la tabla de totales —
    // el total en 0 con líneas reales ya es señal suficiente por sí sola.
    expect(pareceCubiertaPorAnticipo({ total: 0, montoAnticipoLeido: null, sumaItems: 1740 })).toBe(true);
  });

  it('total 0 CON el campo del pie pero SIN ítems (factura ilegible salvo el pie)', () => {
    expect(pareceCubiertaPorAnticipo({ total: 0, montoAnticipoLeido: 500, sumaItems: 0 })).toBe(true);
  });

  it('una factura NORMAL con total > 0 nunca se marca, aunque traiga ítems', () => {
    expect(pareceCubiertaPorAnticipo({ total: 1500, montoAnticipoLeido: null, sumaItems: 1500 })).toBe(false);
  });

  it('total realmente 0 sin ninguna otra señal: no es un anticipo, es una lectura vacía', () => {
    expect(pareceCubiertaPorAnticipo({ total: 0, montoAnticipoLeido: null, sumaItems: 0 })).toBe(false);
    expect(pareceCubiertaPorAnticipo({})).toBe(false);
  });

  it('un total apenas positivo por redondeo del OCR no debe bloquear el camino normal', () => {
    // 0.01 es "total leído" real, no una entrega en cero — no se marca aunque
    // haya ítems, para no ofrecer el checkbox de anticipo en el caso común.
    expect(pareceCubiertaPorAnticipo({ total: 0.5, montoAnticipoLeido: null, sumaItems: 500 })).toBe(false);
  });

  it('respeta la tolerancia de redondeo (±0.05) tanto en total como en las señales', () => {
    expect(pareceCubiertaPorAnticipo({ total: 0.03, montoAnticipoLeido: 100, sumaItems: 0 })).toBe(true);
    expect(pareceCubiertaPorAnticipo({ total: 0, montoAnticipoLeido: 0.04, sumaItems: 0.04 })).toBe(false);
  });
});
