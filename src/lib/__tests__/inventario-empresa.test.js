import { describe, it, expect } from 'vitest';
import {
  normUnidad, labelUnidad, resumenFinancieroEmpresa, inventarioDeEmpresa, filtrarInventario,
} from '../inventario-empresa';
import { extraerLineasDeFacturas } from '../analisis-insumos';
import { resolverPares, construirGrupos } from '../insumo-correlacion';

const EMP_A = 'emp-a';
const EMP_B = 'emp-b';

// Movimientos de prueba calcados de lo que hay en producción: la misma unidad
// escrita de tres formas ("und", "UNIDAD", "each"), compras y ventas de la
// misma empresa, una NC, un anulado, otra moneda y otra empresa.
const MOVS = [
  {
    id: 'c1', company_id: EMP_A, date: '2026-03-01', type: 'cost', clase: 'compra',
    currency: 'PEN', amount: 1180, proveedor_id: 'p1', third_party_name: 'FERRETERIA A',
    document_number: 'F001-1',
    notas: JSON.stringify({ items_factura: [
      { descripcion: 'Cemento Sol', unidad: 'und', cantidad: 10, precio_unitario: 30, tipo_insumo: 'material', recibido: 10 },
      { descripcion: 'Clavo 8 pulg', unidad: 'kg', cantidad: 4, precio_unitario: 6, tipo_insumo: 'material' },
    ] }),
  },
  {
    id: 'c2', company_id: EMP_A, date: '2026-04-02', type: 'cost', clase: 'compra',
    currency: 'PEN', amount: 590, proveedor_id: 'p2', third_party_name: 'FERRETERIA B',
    document_number: 'F002-2',
    notas: { items_factura: [
      { descripcion: 'CEMENTO SOL', unidad: 'UNIDAD', cantidad: 5, precio_unitario: 32, tipo_insumo: 'material' },
      { descripcion: "Clavos de 8''", unidad: 'kg', cantidad: 2, precio_unitario: 7, tipo_insumo: 'material' },
      { descripcion: 'Bonificación', unidad: 'each', cantidad: 3, precio_unitario: 0, tipo_insumo: 'material' },
    ] },
  },
  {
    id: 'v1', company_id: EMP_A, date: '2026-05-03', type: 'income', clase: 'venta',
    currency: 'PEN', amount: 472, is_intercompany: true, third_party_name: 'CONSORCIO X',
    document_number: 'E001-1',
    notas: { items_factura: [{ descripcion: 'Cemento Sol', unidad: 'und', cantidad: 12, precio_unitario: 40, tipo_insumo: 'material' }] },
  },
  // Gasto (mig 162: destino Gastos Generales ⇒ 'expense')
  {
    id: 'g1', company_id: EMP_A, date: '2026-05-10', type: 'expense', clase: 'compra',
    currency: 'PEN', amount: 100, third_party_name: 'LIBRERIA',
    document_number: 'F003-3',
    notas: { items_factura: [{ descripcion: 'Papel bond', unidad: 'paquete', cantidad: 2, precio_unitario: 50, tipo_insumo: 'material' }] },
  },
  // NC: resta, no suma → fuera de los totales
  {
    id: 'nc1', company_id: EMP_A, date: '2026-05-11', type: 'cost', clase: 'compra',
    document_type: 'nota_credito', currency: 'PEN', amount: 60, third_party_name: 'FERRETERIA A',
    notas: { items_factura: [{ descripcion: 'Cemento Sol', unidad: 'und', cantidad: 2, precio_unitario: 30 }] },
  },
  // Anulado: fuera (criterio del Consolidado)
  {
    id: 'x1', company_id: EMP_A, date: '2026-05-12', type: 'cost', clase: 'compra',
    payment_status: 'cancelled', currency: 'PEN', amount: 999,
    notas: { items_factura: [{ descripcion: 'Cemento Sol', unidad: 'und', cantidad: 99, precio_unitario: 99 }] },
  },
  // Otra moneda
  {
    id: 'u1', company_id: EMP_A, date: '2026-06-01', type: 'cost', clase: 'compra',
    currency: 'USD', amount: 200, third_party_name: 'IMPORT SAC',
    notas: { items_factura: [{ descripcion: 'Cemento Sol', unidad: 'und', cantidad: 2, precio_unitario: 100 }] },
  },
  // Factura sin detalle de ítems (registrada a mano)
  { id: 'sd1', company_id: EMP_A, date: '2026-06-02', type: 'cost', clase: 'compra', currency: 'PEN', amount: 500, notas: 'compra a mano' },
  // Otra empresa: nunca debe mezclarse
  {
    id: 'b1', company_id: EMP_B, date: '2026-06-03', type: 'cost', clase: 'compra', currency: 'PEN', amount: 300,
    notas: { items_factura: [{ descripcion: 'Cemento Sol', unidad: 'und', cantidad: 100, precio_unitario: 3 }] },
  },
  // Modo prueba: aislado
  {
    id: 'd1', company_id: EMP_A, date: '2026-06-04', type: 'cost', clase: 'compra', currency: 'PEN', amount: 10, demo: true,
    notas: { items_factura: [{ descripcion: 'Cemento Sol', unidad: 'und', cantidad: 1, precio_unitario: 10 }] },
  },
];

const lineasReales = () => extraerLineasDeFacturas(MOVS);
const invA = (extra = {}) => inventarioDeEmpresa(lineasReales(), { companyId: EMP_A, ...extra });
const insumo = (inv, texto) => filtrarInventario(inv.insumos, texto)[0];

describe('normUnidad', () => {
  it('unifica los sinónimos que escribe el OCR de cada factura', () => {
    expect(normUnidad('UNIDAD')).toBe('und');
    expect(normUnidad('und')).toBe('und');
    expect(normUnidad('each')).toBe('und');
    expect(normUnidad('Piezas')).toBe('und');
    expect(normUnidad('KILOGRAMO')).toBe('kg');
    expect(normUnidad('THEORETICAL POUND')).toBe('lb');
    expect(normUnidad('Ciento de unidades')).toBe('ciento');
    expect(normUnidad('US GALON (3,7843 L)')).toBe('gal');
  });

  it('NO fusiona unidades que miden cosas distintas', () => {
    expect(normUnidad('galon ingles')).not.toBe(normUnidad('us galon'));   // 4.55 L ≠ 3.79 L
    expect(normUnidad('kg')).not.toBe(normUnidad('bolsa'));
    expect(labelUnidad('gal-uk')).toBe('gal (UK)');
  });

  it('deja pasar lo desconocido normalizado (no inventa equivalencias)', () => {
    expect(normUnidad('BOLT')).toBe('bolt');
    expect(normUnidad('')).toBe('');
  });
});

describe('resumenFinancieroEmpresa', () => {
  const r = resumenFinancieroEmpresa(MOVS, { companyId: EMP_A, moneda: 'PEN' });

  it('usa el criterio del Consolidado: una moneda, sin anulados, interco aparte', () => {
    expect(r.total.ingresos).toBe(472);
    expect(r.total.costos).toBe(1180 + 590 + 60 + 500); // incluye la NC y la factura sin detalle
    expect(r.total.gastos).toBe(100);
    expect(r.cancelados).toBe(1);
    expect(r.interco.ingresos).toBe(472);
    expect(r.externo.ingresos).toBe(0);                 // la única venta es interna
    expect(r.otrasMonedas).toEqual([{ moneda: 'USD', movs: 1 }]);
  });

  it('cuenta las facturas sin detalle de ítems (objeto o string en notas)', () => {
    expect(r.sinItems).toBe(1);                         // solo 'sd1'
    expect(r.notas).toBe(1);                            // la NC
  });

  it('no mezcla empresas ni el modo prueba', () => {
    expect(resumenFinancieroEmpresa(MOVS, { companyId: EMP_B, moneda: 'PEN' }).total.costos).toBe(300);
    const demo = resumenFinancieroEmpresa(MOVS, { companyId: EMP_A, moneda: 'PEN', demo: true });
    expect(demo.nMovs).toBe(1);
    expect(demo.total.costos).toBe(10);
  });

  it('calcula utilidad y margen sobre lo externo y sobre el acumulado', () => {
    const utilTotal = 472 - (1180 + 590 + 60 + 500) - 100;
    expect(r.total.utilidad).toBe(utilTotal);
    expect(r.externo.margen).toBe(0);                   // sin ingresos externos no hay margen
  });
});

describe('inventarioDeEmpresa', () => {
  it('agrupa por insumo unificando los sinónimos de unidad, sin mezclar unidades distintas', () => {
    const inv = invA();
    const cemento = insumo(inv, 'cemento');
    // 10 (und) + 5 (UNIDAD) + 2 (USD, und) = 17 — la unidad se unifica, la moneda no.
    expect(cemento.comprado.cantidades).toEqual([{ unidad: 'und', label: 'und', cantidad: 17 }]);
    expect(cemento.comprado.montos).toEqual([
      { moneda: 'PEN', monto: 10 * 30 + 5 * 32 },
      { moneda: 'USD', monto: 200 },
    ]);
    // Sin correlaciones confirmadas, "Clavo 8 pulg" y "Clavos de 8''" son dos
    // insumos distintos: 4 kg y 2 kg por separado (se unen en el test de grupos).
    const clavos = filtrarInventario(inv.insumos, 'clavo');
    expect(clavos).toHaveLength(2);
    expect(clavos.map(c => c.comprado.cantidades[0].cantidad).sort()).toEqual([2, 4]);
  });

  it('deja fuera notas de crédito, anulados, otras empresas y el modo prueba', () => {
    const inv = invA();
    const cemento = insumo(inv, 'cemento');
    expect(cemento.comprado.veces).toBe(3);             // c1, c2, u1 — no la NC ni el anulado
    expect(inv.totales.lineasNota).toBe(1);
    expect(cemento.lineas.every(l => l.companyId === EMP_A)).toBe(true);
    const demo = inventarioDeEmpresa(extraerLineasDeFacturas(MOVS, { demo: true }), { companyId: EMP_A });
    expect(demo.insumos).toHaveLength(1);
    expect(demo.insumos[0].comprado.veces).toBe(1);
  });

  it('separa lo comprado de lo vendido y solo calcula saldo si hubo venta', () => {
    const inv = invA();
    const cemento = insumo(inv, 'cemento');
    expect(cemento.vendido.veces).toBe(1);
    expect(cemento.vendido.interco).toBe(1);
    expect(cemento.saldo).toEqual([{ unidad: 'und', label: 'und', cantidad: 17 - 12 }]);
    expect(insumo(inv, 'clavo').saldo).toEqual([]);     // nunca se vendió: no se inventa saldo
  });

  it('conserva las líneas sin precio (cantidades) y las cuenta aparte', () => {
    const inv = invA();
    const bonif = insumo(inv, 'bonificacion');
    expect(bonif.comprado.cantidades).toEqual([{ unidad: 'und', label: 'und', cantidad: 3 }]);
    expect(bonif.comprado.montos).toEqual([]);
    expect(inv.totales.lineasSinPrecio).toBe(1);
  });

  it('informa la recepción de almacén como "líneas con dato", no como un cero engañoso', () => {
    const cemento = insumo(invA(), 'cemento');
    expect(cemento.recepcion).toEqual({ conDato: 1, recibido: 10 });
    expect(insumo(invA(), 'clavo').recepcion.conDato).toBe(0);
  });

  it('guarda proveedores, última compra y las facturas para el drill-down', () => {
    const cemento = insumo(invA(), 'cemento');
    expect(cemento.comprado.proveedores.map(p => p.nombre)).toContain('FERRETERIA A');
    expect(cemento.comprado.ultimaFecha).toBe('2026-06-01');
    expect(cemento.lineas[0].fecha).toBe('2026-06-01');  // más reciente primero
    expect(cemento.lineas.map(l => l.doc)).toContain('F001-1');
  });

  it('ordena por el mayor gasto en UNA moneda (nunca sumando monedas)', () => {
    const inv = invA();
    expect(inv.insumos[0].display.toLowerCase()).toContain('cemento');
    expect(inv.totales.gastos.find(g => g.moneda === 'USD').monto).toBe(200);
  });

  it('usa los grupos de correlación confirmados para unir variantes de nombre', () => {
    const pares = resolverPares([
      { id: 'r1', nombre_a: 'Clavo 8 pulg', nombre_b: "Clavos de 8''", relacion: 'mismo', fuente: 'manual', canonico: 'Clavo 8 pulg', updated_at: '2026-08-01' },
    ]);
    const { grupoDe, grupos } = construirGrupos(pares);
    const sinGrupos = invA();
    const conGrupos = invA({ grupoDe, grupos });
    expect(filtrarInventario(sinGrupos.insumos, 'clavo')).toHaveLength(2);   // dos nombres sueltos
    const clavos = filtrarInventario(conGrupos.insumos, 'clavo');
    expect(clavos).toHaveLength(1);
    expect(clavos[0].display).toBe('Clavo 8 pulg');
    expect(clavos[0].variantes).toEqual(['Clavo 8 pulg', "Clavos de 8''"]);
    expect(clavos[0].comprado.cantidades).toEqual([{ unidad: 'kg', label: 'kg', cantidad: 6 }]);
  });
});

describe('filtrarInventario', () => {
  it('busca sin tildes en el nombre y en las variantes, con todos los tokens', () => {
    const inv = invA();
    expect(filtrarInventario(inv.insumos, 'bonificacion')).toHaveLength(1);
    expect(filtrarInventario(inv.insumos, 'CEMENTO sol')).toHaveLength(1);
    expect(filtrarInventario(inv.insumos, 'cemento clavo')).toHaveLength(0);
    expect(filtrarInventario(inv.insumos, '')).toBe(inv.insumos);
  });
});
