import { describe, it, expect } from 'vitest';
import {
  normUnidad, labelUnidad, resumenFinancieroEmpresa, inventarioDeEmpresa, filtrarInventario,
  saldosNegativos, tieneSaldoNegativo, clasificarLineaPorTexto, aniosDeLineas, filtrarPorFlujo,
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

// ── TANDA 9: el stock negativo se ve, no se corrige ─────────────────
describe('saldosNegativos', () => {
  const ins = (display, saldo) => ({ display, saldo });

  it('encuentra los que quedaron en rojo', () => {
    const r = saldosNegativos([
      ins('CLAVOS 3"', [{ unidad: 'kg', label: 'kg', cantidad: -458 }]),
      ins('CEMENTO', [{ unidad: 'bol', label: 'bol', cantidad: 318 }]),
    ]);
    expect(r.total).toBe(1);
    expect(r.insumos[0].display).toBe('CLAVOS 3"');
    expect(r.unidades.get('kg')).toBe(-458);
  });

  it('🔴 un saldo VACÍO no es negativo: sin ventas el saldo no significa nada', () => {
    expect(saldosNegativos([ins('CEMENTO', [])]).total).toBe(0);
  });

  it('el cero exacto no cuenta como rojo', () => {
    expect(saldosNegativos([ins('X', [{ unidad: 'u', label: 'u', cantidad: 0 }])]).total).toBe(0);
  });

  it('tieneSaldoNegativo responde lo mismo por fila', () => {
    expect(tieneSaldoNegativo(ins('A', [{ unidad: 'u', label: 'u', cantidad: -1 }]))).toBe(true);
    expect(tieneSaldoNegativo(ins('B', [{ unidad: 'u', label: 'u', cantidad: 5 }]))).toBe(false);
    expect(tieneSaldoNegativo(null)).toBe(false);
  });

  it('con una lista vacía no revienta', () => {
    expect(saldosNegativos([]).total).toBe(0);
    expect(saldosNegativos().total).toBe(0);
  });
});

// ── TANDA 3: clasificación por texto ──────────────────────────────────
describe('clasificarLineaPorTexto', () => {
  it('detecta anticipos', () => {
    expect(clasificarLineaPorTexto('Anticipo de cliente')).toBe('anticipo');
    expect(clasificarLineaPorTexto('ADELANTO DE OBRA - PRIMER DESEMBOLSO')).toBe('anticipo');
    expect(clasificarLineaPorTexto('PAGO A CUENTA POR LA OBRA')).toBe('anticipo');
  });

  it('detecta servicios de obra (valorizaciones, contratos, saldo de tarrajeo)', () => {
    expect(clasificarLineaPorTexto('OBRA: REHABILITACION DEL LOCAL ESCOLAR N 88389')).toBe('servicio_obra');
    expect(clasificarLineaPorTexto('POR EL SALDO DE TARRAJEO DE LA OBRA: SALDO DE LA I.E.')).toBe('servicio_obra');
    expect(clasificarLineaPorTexto('VALORIZACION 03 DEL CONTRATO DE OBRA')).toBe('servicio_obra');
    expect(clasificarLineaPorTexto('EJECUCION DE OBRA MIRAFLORES')).toBe('servicio_obra');
    expect(clasificarLineaPorTexto('CONTRATO DE OBRA Nro 004-2026')).toBe('servicio_obra');
    expect(clasificarLineaPorTexto('PARTIDAS DE OBRA: ENCOFRADO Y DESENCOFRADO')).toBe('servicio_obra');
    expect(clasificarLineaPorTexto('EJECUCION DE PARTIDAS DE PAVIMENTACION')).toBe('servicio_obra');
  });

  it('detecta liquidaciones', () => {
    expect(clasificarLineaPorTexto('ELABORACION DE LIQUIDACION DE SALDO DE OBRA')).toBe('servicio');
    expect(clasificarLineaPorTexto('LIQUIDACION FINAL DEL CONTRATO')).toBe('servicio');
  });

  it('detecta alquiler y arrendamiento', () => {
    expect(clasificarLineaPorTexto('ALQUILER DE RETROEXCAVADORA')).toBe('servicio');
    expect(clasificarLineaPorTexto('ARRENDAMIENTO DE MAQUINARIA PESADA')).toBe('servicio');
  });

  it('detecta transporte y flete', () => {
    expect(clasificarLineaPorTexto('SERVICIO DE TRANSPORTE DE MATERIALES')).toBe('servicio');
    expect(clasificarLineaPorTexto('FLETE POR ENVÍO DE EQUIPOS A OBRA')).toBe('servicio');
    expect(clasificarLineaPorTexto('TRASLADO DE MATERIAL EXCEDENTE')).toBe('servicio');
  });

  it('detecta mantenimiento y reparación', () => {
    expect(clasificarLineaPorTexto('MANTENIMIENTO DE VOLQUETE SCANIA')).toBe('servicio');
    expect(clasificarLineaPorTexto('REPARACION DE MOTOR DEL CAMION')).toBe('servicio');
  });

  it('detecta honorarios y consultoría', () => {
    expect(clasificarLineaPorTexto('HONORARIOS POR SUPERVISION DE OBRA')).toBe('servicio');
    expect(clasificarLineaPorTexto('GASTOS NOTARIALES DE ESCRITURA')).toBe('servicio');
    expect(clasificarLineaPorTexto('CONSULTORIA EN GESTION DE PROYECTOS')).toBe('servicio');
  });

  it('devuelve null para materiales normales (no inventa nada)', () => {
    expect(clasificarLineaPorTexto('CEMENTO PORTLAND TIPO I')).toBeNull();
    expect(clasificarLineaPorTexto('VARILLA DE ACERO CORRUGADO')).toBeNull();
    expect(clasificarLineaPorTexto('CLAVOS DE ACERO')).toBeNull();
    expect(clasificarLineaPorTexto('')).toBeNull();
    expect(clasificarLineaPorTexto(null)).toBeNull();
    expect(clasificarLineaPorTexto(undefined)).toBeNull();
  });

  it('los overrides se aplican en inventarioDeEmpresa (anticipo no aparece como material)', () => {
    const movsConAnticipo = [
      {
        id: 'a1', company_id: EMP_A, date: '2026-08-01', type: 'cost', clase: 'compra',
        currency: 'PEN', amount: 5000, third_party_name: 'EMPRESA X',
        notas: { items_factura: [{ descripcion: 'Anticipo de cliente', unidad: 'und', cantidad: 1, precio_unitario: 5000, tipo_insumo: 'material' }] },
      },
    ];
    const inv = inventarioDeEmpresa(extraerLineasDeFacturas(movsConAnticipo), { companyId: EMP_A });
    const anticipo = inv.insumos.find(i => i.display.toLowerCase().includes('anticipo'));
    expect(anticipo).toBeTruthy();
    expect(anticipo.tipos).toContain('anticipo');
    expect(anticipo.tipos).not.toContain('material');
    expect(anticipo.esAnticipo).toBe(true);
    expect(inv.totales.lineasAnticipo).toBe(1);
    expect(inv.totales.anticipos.length).toBe(1);
    expect(inv.totales.anticipos[0].monto).toBe(5000);
  });
});

// ── TANDA 3: años derivados de líneas ────────────────────────────────
describe('aniosDeLineas', () => {
  it('extrae los años únicos de las fechas, sin duplicar, en orden descendente', () => {
    const lineas = [
      { fecha: '2024-03-01' }, { fecha: '2026-07-15' },
      { fecha: '2025-12-31' }, { fecha: '2026-01-10' },
    ];
    expect(aniosDeLineas(lineas)).toEqual([2026, 2025, 2024]);
  });

  it('ignora fechas vacías o malformadas', () => {
    const lineas = [{ fecha: '' }, { fecha: null }, { fecha: '2026-05-01' }, { fecha: 'abcd' }];
    expect(aniosDeLineas(lineas)).toEqual([2026]);
  });

  it('con array vacío o sin argumento devuelve array vacío', () => {
    expect(aniosDeLineas([])).toEqual([]);
    expect(aniosDeLineas()).toEqual([]);
  });
});

// ── TANDA 3: filtro temporal en inventarioDeEmpresa ──────────────────
describe('inventarioDeEmpresa con filtro temporal', () => {
  // 3 compras del mismo ítem en meses distintos
  const MOVS_TEMPORAL = [
    {
      id: 't1', company_id: EMP_A, date: '2026-01-15', type: 'cost', clase: 'compra',
      currency: 'PEN', amount: 300, third_party_name: 'PROV A',
      notas: { items_factura: [{ descripcion: 'Cemento Sol', unidad: 'und', cantidad: 10, precio_unitario: 30 }] },
    },
    {
      id: 't2', company_id: EMP_A, date: '2026-06-20', type: 'cost', clase: 'compra',
      currency: 'PEN', amount: 600, third_party_name: 'PROV A',
      notas: { items_factura: [{ descripcion: 'Cemento Sol', unidad: 'und', cantidad: 20, precio_unitario: 30 }] },
    },
    {
      id: 't3', company_id: EMP_A, date: '2026-12-01', type: 'cost', clase: 'compra',
      currency: 'PEN', amount: 150, third_party_name: 'PROV A',
      notas: { items_factura: [{ descripcion: 'Cemento Sol', unidad: 'und', cantidad: 5, precio_unitario: 30 }] },
    },
  ];
  const lineasT = () => extraerLineasDeFacturas(MOVS_TEMPORAL);

  it('sin filtro devuelve todo (30 und)', () => {
    const inv = inventarioDeEmpresa(lineasT(), { companyId: EMP_A });
    const cemento = inv.insumos[0];
    expect(cemento.comprado.cantidades[0].cantidad).toBe(35);
  });

  it('filtro por año 2026 primer semestre devuelve solo enero + junio = 30', () => {
    const inv = inventarioDeEmpresa(lineasT(), { companyId: EMP_A, desde: '2026-01-01', hasta: '2026-06-30' });
    expect(inv.insumos[0].comprado.cantidades[0].cantidad).toBe(30);
  });

  it('filtro por mes enero devuelve solo 10 und', () => {
    const inv = inventarioDeEmpresa(lineasT(), { companyId: EMP_A, desde: '2026-01-01', hasta: '2026-01-31' });
    expect(inv.insumos[0].comprado.cantidades[0].cantidad).toBe(10);
  });

  it('filtro fuera de rango devuelve inventario vacío', () => {
    const inv = inventarioDeEmpresa(lineasT(), { companyId: EMP_A, desde: '2025-01-01', hasta: '2025-12-31' });
    expect(inv.insumos).toHaveLength(0);
    expect(inv.totales.lineasCompra).toBe(0);
  });

  it('las notas de crédito también quedan fuera si están fuera del período', () => {
    const movsConNc = [...MOVS_TEMPORAL, {
      id: 'tnc', company_id: EMP_A, date: '2025-11-01', type: 'cost', clase: 'compra',
      document_type: 'nota_credito', currency: 'PEN', amount: 90, third_party_name: 'PROV A',
      notas: { items_factura: [{ descripcion: 'Cemento Sol', unidad: 'und', cantidad: 3, precio_unitario: 30 }] },
    }];
    const lineasConNc = extraerLineasDeFacturas(movsConNc);
    // Sin filtro: la NC de 2025 cuenta (lineasNota = 1)
    expect(inventarioDeEmpresa(lineasConNc, { companyId: EMP_A }).totales.lineasNota).toBe(1);
    // Con filtro solo 2026: la NC de 2025 queda fuera (lineasNota = 0)
    expect(inventarioDeEmpresa(lineasConNc, {
      companyId: EMP_A, desde: '2026-01-01', hasta: '2026-12-31',
    }).totales.lineasNota).toBe(0);
  });
});

describe('filtrarPorFlujo y margen económico', () => {
  const lineasFlujo = [
    // Insumo 1: Comprado a S/ 100 y vendido a S/ 150
    { nombre: 'Fierro 1/2', clase: 'compra', cantidad: 10, precio: 10, moneda: 'PEN', companyId: EMP_A, fecha: '2026-08-01' },
    { nombre: 'Fierro 1/2', clase: 'venta', cantidad: 5, precio: 30, moneda: 'PEN', companyId: EMP_A, fecha: '2026-08-02' },
    // Insumo 2: Solo compra
    { nombre: 'Arena gruesa', clase: 'compra', cantidad: 20, precio: 50, moneda: 'PEN', companyId: EMP_A, fecha: '2026-08-01' },
    // Insumo 3: Solo venta
    { nombre: 'Servicio corte', clase: 'venta', cantidad: 1, precio: 500, moneda: 'PEN', companyId: EMP_A, fecha: '2026-08-01' },
  ];

  it('calcula margen económico (ventas menos compras) por insumo', () => {
    const inv = inventarioDeEmpresa(lineasFlujo, { companyId: EMP_A });
    const fierro = inv.insumos.find(i => i.display === 'Fierro 1/2');
    expect(fierro).toBeTruthy();
    expect(fierro.totalCompraPen).toBe(100);
    expect(fierro.totalVentaPen).toBe(150);
    expect(fierro.margenEconomicoPen).toBe(50); // 150 - 100 = 50 ganancia
    expect(fierro.margenPct).toBeCloseTo(33.33, 1);
  });

  it('filtra correctamente por flujo: solo compras, solo ventas, ambos', () => {
    const inv = inventarioDeEmpresa(lineasFlujo, { companyId: EMP_A });
    expect(filtrarPorFlujo(inv.insumos, 'todos')).toHaveLength(3);

    const soloCompras = filtrarPorFlujo(inv.insumos, 'solo_compras');
    expect(soloCompras).toHaveLength(1);
    expect(soloCompras[0].display).toBe('Arena gruesa');

    const soloVentas = filtrarPorFlujo(inv.insumos, 'solo_ventas');
    expect(soloVentas).toHaveLength(1);
    expect(soloVentas[0].display).toBe('Servicio corte');

    const ambos = filtrarPorFlujo(inv.insumos, 'ambos');
    expect(ambos).toHaveLength(1);
    expect(ambos[0].display).toBe('Fierro 1/2');
  });
});

