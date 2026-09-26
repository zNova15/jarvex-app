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
  facturasParaAplicarManualmente, valorDeItems,
  montoCubiertoDeEntrega, cubiertoPorFactura, validarAplicacion, repartirEntreAnticipos,
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

  it('🔴 la factura en CERO SIN detalle sigue pidiendo el importe', () => {
    // El total es 0 porque el descuento ya se aplicó, y acá tampoco hay líneas
    // con precio: inventar un número sería peor que no proponer nada.
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

describe('facturasParaAplicarManualmente — consumir el anticipo factura por factura', () => {
  // Gabriel, 13-set-2026: «cuando quiera vincular las facturas con anticipo
  // quiero ir consumiendo los montos de los anticipos. Ejemplo, realicé un
  // pago de un anticipo de 80 mil dólares. Pero las facturas son 8 de 10 mil
  // dólares. Entonces iría consumiendo con diferentes facturas esos 80 mil,
  // hasta cubrir todo ese monto.» Facturas NORMALES, a precio completo — sin
  // ninguna señal automática (no las anuló una NC, no vinieron en cero) — así
  // que `proponerAplicaciones` no las ofrece solas: las tiene que elegir la
  // asistente a mano, una por una.
  const ANTICIPO_80K = mov('big', 'F003-9000', '2026-03-01', 80000, conItems([
    { descripcion: 'ANTICIPO DE CLIENTE', cantidad: 1, precio_unitario: 67796.61, unidad: 'und' },
  ]));
  const ocho = Array.from({ length: 8 }, (_, i) =>
    mov(`f10k-${i}`, `F003-91${i}`, '2026-04-01', 10000));
  const movs = [ANTICIPO_80K, ...ocho];

  it('las 8 facturas de US$ 10.000 aparecen como candidatas manuales (no como propuesta automática)', () => {
    const [ant] = detectarAnticipos(movs, { companyId: GASOMI });
    const propuestas = proponerAplicaciones(ant, movs, []);
    const manuales = facturasParaAplicarManualmente(ant, movs, []);
    expect(propuestas).toHaveLength(0);       // ninguna señal automática
    expect(manuales).toHaveLength(8);
    expect(manuales.every(c => c.monto === 10000)).toBe(true);
  });

  it('aplicar UNA la saca de la lista de candidatas manuales y baja el saldo en US$ 10.000', () => {
    const [ant] = detectarAnticipos(movs, { companyId: GASOMI });
    const aplicaciones = [aplicacionNueva(ant, { facturaId: 'f10k-0', monto: 10000 })];
    const manuales = facturasParaAplicarManualmente(ant, movs, aplicaciones);
    expect(manuales).toHaveLength(7);
    expect(manuales.some(c => c.id === 'f10k-0')).toBe(false);
    expect(saldoDeAnticipo(ant, aplicaciones).saldo).toBe(70000);
  });

  it('consumiendo las 8, una por una, el anticipo queda cerrado en cero', () => {
    const [ant] = detectarAnticipos(movs, { companyId: GASOMI });
    const aplicaciones = ocho.map(f => aplicacionNueva(ant, { facturaId: f.id, monto: 10000 }));
    const s = saldoDeAnticipo(ant, aplicaciones);
    expect(s.saldo).toBe(0);
    expect(s.cerrado).toBe(true);
    expect(facturasParaAplicarManualmente(ant, movs, aplicaciones)).toHaveLength(0);
  });

  it('una entrega PARCIAL (menos que el total de la factura) descuenta solo lo aplicado', () => {
    // El anticipo cubre solo PARTE de una entrega de US$ 10.000 — el resto se
    // paga aparte, así que el monto a aplicar lo escribe la persona. Una vez
    // aplicada (parcial o no) sale del picker — para corregir el monto se
    // "Quita" la aplicación desde "Ya aplicado" y se vuelve a aplicar, mismo
    // criterio que ya usan las propuestas automáticas.
    const [ant] = detectarAnticipos(movs, { companyId: GASOMI });
    const aplicaciones = [aplicacionNueva(ant, { facturaId: 'f10k-0', monto: 4000 })];
    expect(saldoDeAnticipo(ant, aplicaciones).saldo).toBe(76000);
    expect(facturasParaAplicarManualmente(ant, movs, aplicaciones).some(c => c.id === 'f10k-0')).toBe(false);
  });

  it('la factura en cero y la anulada por NC no aparecen DOS veces (propuesta + manual)', () => {
    // Reusa el set real de KOPLAST: F_CERO tiene propuesta automática.
    const [ant] = detectarAnticipos(TODOS, { companyId: GASOMI });
    const manuales = facturasParaAplicarManualmente(ant, TODOS, []);
    expect(manuales.some(c => c.id === 'f4')).toBe(false);   // F_CERO: ya está en propuestas
  });

  it('el panel entero trae `manuales` junto con `propuestas`', () => {
    const p = panelAnticipos(movs, [], { companyId: GASOMI });
    expect(p.filas[0].manuales).toHaveLength(8);
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


// ═══════════════════════════════════════════════════════════════════
// EL IMPORTE DE UNA FACTURA EN CERO, LEÍDO DE SU PROPIO DETALLE (15-set-2026).
//
// Gabriel: «hace falta más información, el monto por ejemplo, para poder
// vincular correctamente». El dato nunca estuvo solo en el PDF: el total viene
// en 0 porque el descuento del anticipo ya se aplicó en el pie, pero las LÍNEAS
// conservan cantidad y precio. Medido en producción ese día: de las 18 facturas
// en cero del grupo, 16 tienen detalle y suman USD 94.037,52.
// ═══════════════════════════════════════════════════════════════════
describe('valorDeItems', () => {
  it('suma cantidad × precio_unitario de cada línea', () => {
    // F003-3480 de KOPLAST, textual: 155×32.383 + 422×4.628 + 237×2.773.
    const m = mov('x1', 'F003-3480', '2026-05-06', 0, conItems([
      { descripcion: 'TUBO PVC-U 200 mm S-25 UF ALCANTARILLADO', cantidad: 155, precio_unitario: 32.383 },
      { descripcion: 'TUBO PVC-U 2" C-7.5 SP PRESION', cantidad: 422, precio_unitario: 4.628 },
      { descripcion: 'TUBO PVC-U 1 1/2" C-7.5 SP PRESION', cantidad: 237, precio_unitario: 2.773 },
    ]));
    expect(valorDeItems(m)).toBeCloseTo(7629.58, 2);
  });

  it('acepta `precio` además de `precio_unitario` (filas viejas)', () => {
    const m = mov('x2', 'F-1', '2026-05-06', 0, conItems([{ cantidad: 10, precio: 5 }]));
    expect(valorDeItems(m)).toBe(50);
  });

  it('sin líneas con precio devuelve 0 — nunca un número inventado', () => {
    expect(valorDeItems(mov('x3', 'F-2', '2026-05-06', 0))).toBe(0);
    expect(valorDeItems(mov('x4', 'F-3', '2026-05-06', 0, conItems([
      { descripcion: 'ALGO', cantidad: 3, precio_unitario: 0 },
    ])))).toBe(0);
  });
});

describe('la factura en CERO llega con su importe propuesto', () => {
  const F_CERO_CON_DETALLE = mov('f5', 'F003-3481', '2026-05-07', 0, conItems([
    { descripcion: 'TUBO PVC-U 250 mm', cantidad: 200, precio_unitario: 50.19365 },
  ]));
  const CON = [...TODOS, F_CERO_CON_DETALLE];
  const [ant2] = detectarAnticipos(CON, { companyId: GASOMI });

  it('propone el valor del detalle en vez de pedir el PDF — llevado a total CON IGV', () => {
    // Tanda D (25-set): el anticipo se guarda por su total con IGV, así que la
    // aplicación también. El detalle suma 10.038,73 SIN IGV → 11.845,70.
    const p = proponerAplicaciones(ant2, CON, []);
    const f = p.find(x => x.documento === 'F003-3481');
    expect(f.monto).toBeCloseTo(11845.70, 2);
    expect(f.totalCubierto).toBeCloseTo(11845.70, 2);
    expect(f.pideMonto).toBe(false);
    expect(f.origen).toBe('detalle');
    expect(f.valorItems).toBeCloseTo(10038.73, 2);
    expect(f.nItems).toBe(1);
  });

  it('🔴 no se pasa del saldo que queda del anticipo', () => {
    const chico = { ...ant2, monto: 100 };
    const p = proponerAplicaciones(chico, CON, []);
    const total = p.reduce((s, x) => s + x.monto, 0);
    expect(total).toBeLessThanOrEqual(100 + 0.05);
  });

  it('🔴 y el recorte por saldo se distingue de un importe mal leído', () => {
    // `valorItems` guarda lo que sumaba el detalle ANTES de acotarlo: sin eso,
    // una fila recortada por falta de saldo parecería un error de lectura.
    const chico = { ...ant2, monto: 5000 };
    const p = proponerAplicaciones(chico, CON, []);
    const f = p.find(x => x.documento === 'F003-3481');
    if (f) {
      expect(f.monto).toBeLessThanOrEqual(5000);
      expect(f.valorItems).toBeCloseTo(10038.73, 2);
    }
  });

  it('las dos señales quedan separadas por `origen`', () => {
    const p = proponerAplicaciones(ant2, CON, []);
    expect(p.filter(x => x.origen === 'nota_credito')).toHaveLength(3);
    expect(p.filter(x => x.origen === 'detalle')).toHaveLength(1);
    expect(p.filter(x => x.origen === 'sin_dato')).toHaveLength(1);
  });
});

// ── Tanda D (25-set-2026): doble consumo, saldo, unidad y huérfanas ──────
describe('una entrega no consume dos anticipos por el total', () => {
  const aplic = (id, ant, fac, monto) => ({ id, anticipo_movimiento_id: ant, factura_movimiento_id: fac, monto, moneda: 'USD', fuente: 'manual', deleted_at: null });
  const [antA, antB] = detectarAnticipos(TODOS, { companyId: GASOMI }).sort((x, y) => x.documento.localeCompare(y.documento));

  it('🔴 con F003-3409 ya aplicada ENTERA a F003-3384, F003-3385 no la vuelve a proponer', () => {
    const vivas = [aplic('x1', 'a1', 'f1', 19518.72)];
    const p = proponerAplicaciones(antB, TODOS, vivas);
    expect(p.find(x => x.documento === 'F003-3409')).toBeUndefined();
  });

  it('🔴 si el primer anticipo la cubrió en parte, el otro propone SOLO el resto (regla de Gabriel)', () => {
    const vivas = [aplic('x1', 'a1', 'f1', 15000)];
    const p = proponerAplicaciones(antB, TODOS, vivas);
    const f = p.find(x => x.documento === 'F003-3409');
    expect(f.monto).toBeCloseTo(4518.72, 2);
    expect(f.yaCubierto).toBe(15000);
  });

  it('las propuestas arrancan del SALDO, no del monto del anticipo', () => {
    const vivas = [aplic('x1', 'a1', 'otra', 79000)];
    const p = proponerAplicaciones(antA, TODOS, vivas);
    expect(p.reduce((s, x) => s + x.monto, 0)).toBeLessThanOrEqual(1000 + 0.05);
  });

  it('cubiertoPorFactura suma lo de TODOS los anticipos', () => {
    const c = cubiertoPorFactura([aplic('x1', 'a1', 'f1', 100), aplic('x2', 'a2', 'f1', 50)]);
    expect(c.get('f1').monto).toBe(150);
    expect(c.get('f1').porAnticipo.get('a2')).toBe(50);
  });
});

describe('validarAplicacion: los dos topes', () => {
  const [antA] = detectarAnticipos(TODOS, { companyId: GASOMI }).filter(a => a.documento === 'F003-3384');
  it('🔴 no se aplica más que el saldo del anticipo', () => {
    const r = validarAplicacion({ anticipo: antA, facturaMov: F3409, monto: 80000.5,
      aplicacionesVivas: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/el resto, desde el otro anticipo/);
  });
  it('🔴 ni más de lo que le falta cubrir a la factura', () => {
    const r = validarAplicacion({ anticipo: antA, facturaMov: F3409, monto: 19518.72,
      aplicacionesVivas: [{ anticipo_movimiento_id: 'a2', factura_movimiento_id: 'f1', monto: 10000, moneda: 'USD' }] });
    expect(r.ok).toBe(false);
    expect(r.maximo).toBeCloseTo(9518.72, 2);
  });
  it('dentro de los dos topes, pasa', () => {
    expect(validarAplicacion({ anticipo: antA, facturaMov: F3409, monto: 5000, aplicacionesVivas: [] }).ok).toBe(true);
  });
});

describe('la unidad de la entrega en cero', () => {
  it('🔴 manda lo que dice el PIE (lo descontado del anticipo, con IGV)', () => {
    const f = mov('z', 'F003-3388', '2026-03-31', 0, { notas: JSON.stringify({ anticipo_monto: 10967.39,
      items_factura: [{ descripcion: 'TUBO HDPE', cantidad: 1600, precio_unitario: 5.809 }] }) });
    const c = montoCubiertoDeEntrega(f, ANT_A);
    expect(c).toEqual({ monto: 10967.39, origen: 'pie', base: 9294.4 });
  });
  it('sin pie, los ítems llevados a total con la proporción del anticipo', () => {
    const antConDesglose = { ...ANT_A, notas: JSON.stringify({ subtotal: 67796.61, igv: 12203.39 }) };
    const f = mov('z', 'F003-3388', '2026-03-31', 0, conItems([{ descripcion: 'TUBO', cantidad: 1600, precio_unitario: 5.809 }]));
    expect(montoCubiertoDeEntrega(f, antConDesglose).monto).toBeCloseTo(10967.39, 2);
  });
});

describe('aplicaciones huérfanas', () => {
  it('🔴 una factura borrada deja de consumir saldo y queda marcada', () => {
    const aplicaciones = [
      { id: 'x1', anticipo_movimiento_id: 'a1', factura_movimiento_id: 'f1', monto: 19518.72, moneda: 'USD', fuente: 'manual', deleted_at: null },
    ];
    const movs = TODOS.map(m => (m.id === 'f1' ? { ...m, deleted_at: '2026-09-25T00:00:00Z' } : m));
    const panel = panelAnticipos(movs, aplicaciones, { companyId: GASOMI });
    const a = panel.filas.find(f => f.documento === 'F003-3384');
    expect(a.saldo).toBe(80000);
    expect(a.huerfanas).toHaveLength(1);
    expect(a.aplicaciones[0].facturaBorrada).toBe(true);
  });
});

describe('repartirEntreAnticipos (regla de Gabriel, 25-set)', () => {
  it('🔴 agota el elegido y el resto sale del otro', () => {
    const r = repartirEntreAnticipos(10000, [
      { id: 'a1', fecha: '2026-03-31', saldo: 3000 },
      { id: 'a2', fecha: '2026-03-31', saldo: 70000 },
    ], 'a1');
    expect(r.partes.map(p => [p.anticipo.id, p.monto])).toEqual([['a1', 3000], ['a2', 7000]]);
    expect(r.sobra).toBe(0);
  });
  it('lo que no alcanza ningún anticipo vuelve como sobra', () => {
    const r = repartirEntreAnticipos(10000, [{ id: 'a1', fecha: '2026-03-31', saldo: 2500 }]);
    expect(r.partes).toHaveLength(1);
    expect(r.sobra).toBe(7500);
  });
});
