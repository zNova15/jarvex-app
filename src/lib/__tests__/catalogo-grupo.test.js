import { describe, it, expect } from 'vitest';
import {
  catalogoDelGrupo, lineasDeFamilia, insumosPorMonto, insumoParaFamilia,
  esUnidadPorcentual, familiaDeItem,
} from '../abastecimiento.js';

// ── LOS DATOS SON LOS REALES ──────────────────────────────────────
// Medidos contra producción el 7-set-2026:
//   JARVEX  → herramienta 54 líneas (S/ 28.216,86 compradas, S/ 12.221,93 vendidas)
//   GASOMI  → material 586 líneas, herramienta 19
//   Miraflores → 370020009 HERRAMIENTAS MANUALES, unidad %mo, 1.115 partidas,
//                S/ 132.492,97 presupuestados sobre S/ 4.474.595,11 de mano de obra.
const JARVEX = 'c-jarvex';
const GASOMI = 'c-gasomi';
const EL_INCA = 'c-inca';
const HM = '370020009';

const companies = [
  { id: JARVEX, name: 'JARVEX INGENIERIA, TECNOLOGIA Y PROYECTOS E.I.R.L.' },
  { id: GASOMI, name: 'GASOMI INGENIEROS E.I.R.L.' },
  { id: EL_INCA, name: 'CONSORCIO EL INCA' },
];

const mov = (company_id, type, items, extra = {}) => ({
  id: `m-${Math.random()}`, company_id, type, date: '2026-08-01',
  document_number: 'F001-1', notas: JSON.stringify({ items_factura: items }), ...extra,
});
const item = (descripcion, cantidad, precio_unitario, tipo_insumo, unidad = 'UND') =>
  ({ descripcion, cantidad, precio_unitario, tipo_insumo, unidad });

describe('catalogoDelGrupo — qué tiene cada empresa, sin buscar nada', () => {
  const movs = [
    mov(JARVEX, 'cost', [
      item('MARTILLO DE UÑA 16 OZ', 10, 25, 'herramienta'),
      item('PALANA CUCHARA', 20, 30, 'herramienta'),
      item('CEMENTO SOL', 100, 28, 'material', 'BOL'),
    ]),
    mov(JARVEX, 'income', [item('MARTILLO DE UÑA 16 OZ', 4, 32, 'herramienta')]),
    mov(GASOMI, 'cost', [item('CEMENTO HOLCIM', 200, 27, 'material', 'BOL')]),
  ];

  it('agrupa por empresa y por familia, y suma la PLATA (no las cantidades)', () => {
    const cat = catalogoDelGrupo({ movs, companies });
    const jvx = cat.find(e => e.company_id === JARVEX);
    const herr = jvx.familias.find(f => f.familia === 'herramienta');
    expect(herr.nItems).toBe(2);
    // 6 martillos que quedan × 32 (último precio, el de la venta no cuenta:
    // solo las compras traen precio) + 20 palanas × 30
    expect(herr.montoDisponible).toBe(6 * 25 + 20 * 30);
    // La familia NO suma 26 «unidades» de nada: eso vive en cada ítem.
    expect(herr.items.map(i => i.disponible).sort((a, b) => a - b)).toEqual([6, 20]);
  });

  it('descuenta lo vendido y no deja disponibles negativos', () => {
    const cat = catalogoDelGrupo({
      movs: [...movs, mov(JARVEX, 'income', [item('PALANA CUCHARA', 999, 30, 'herramienta')])],
      companies,
    });
    const jvx = cat.find(e => e.company_id === JARVEX);
    const herr = jvx.familias.find(f => f.familia === 'herramienta');
    expect(herr.items.find(i => i.descripcion === 'PALANA CUCHARA')).toBeUndefined();
  });

  it('la ejecutora de la obra no se ofrece a sí misma', () => {
    const cat = catalogoDelGrupo({ movs, companies, titularId: JARVEX });
    expect(cat.find(e => e.company_id === JARVEX)).toBeUndefined();
  });

  it('acota a una sola empresa cuando ya se eligió destinatario', () => {
    const cat = catalogoDelGrupo({ movs, companies, companyId: GASOMI });
    expect(cat.map(e => e.company_id)).toEqual([GASOMI]);
  });

  it('cae al clasificador cuando la línea no trae tipo_insumo', () => {
    expect(familiaDeItem({ descripcion: 'TALADRO PERCUTOR' })).toBe('herramienta');
    expect(familiaDeItem({ descripcion: 'lo que sea', tipo_insumo: 'epp' })).toBe('epp');
  });

  it('un ítem sin precio en la factura se lista igual, marcado', () => {
    const cat = catalogoDelGrupo({
      movs: [mov(GASOMI, 'cost', [item('ALAMBRE NEGRO', 5, 0, 'material')])], companies,
    });
    const it0 = cat[0].familias[0].items[0];
    expect(it0.sinPrecio).toBe(true);
    expect(it0.montoDisponible).toBe(0);
  });
});

describe('insumosPorMonto — lo que el presupuesto pide en plata', () => {
  const ip = (codigo, nombre, unidad, costo) => ({
    id: `ip-${Math.random()}`, obra_id: 'o1', insumo_codigo: codigo, nombre_insumo: nombre,
    unidad, tipo_insumo: 'equipo', cantidad_presupuestada: 0.03, costo_presupuestado: costo,
  });
  const insumosPartida = [
    ip(HM, 'HERRAMIENTAS MANUALES', '%mo', 100000),
    ip(HM, 'HERRAMIENTAS MANUALES', '%mo', 32492.97),
    ip('210020001', 'CEMENTO PORTLAND TIPO I', 'bol', 500000),
  ];

  it('solo toma los porcentuales y suma su COSTO presupuestado', () => {
    const out = insumosPorMonto({ insumosPartida });
    expect(out).toHaveLength(1);
    expect(out[0].codigo).toBe(HM);
    expect(out[0].presupuestado).toBe(132492.97);
    expect(out[0].partidas).toBe(2);
    expect(out[0].falta).toBe(132492.97);
  });

  it('lo cubierto sale de las órdenes vivas, valorizado', () => {
    const ordenes = [
      { id: 'o-1', obra_id: 'o1', estado: 'firmada' },
      { id: 'o-2', obra_id: 'o1', estado: 'anulada' },
    ];
    const ocItems = [
      { id: 'i1', orden_compra_id: 'o-1', insumo_codigo: HM, cantidad: 1, precio_unitario: 40438.79 },
      { id: 'i2', orden_compra_id: 'o-2', insumo_codigo: HM, cantidad: 1, precio_unitario: 90000 },
    ];
    const out = insumosPorMonto({ insumosPartida, ordenes, ocItems, obraId: 'o1' });
    expect(out[0].cubierto).toBe(40438.79);
    expect(out[0].falta).toBe(92054.18);
    expect(out[0].avance).toBeCloseTo(0.305, 3);
  });

  it('reconoce la unidad porcentual y le calza la familia', () => {
    expect(esUnidadPorcentual('%mo')).toBe(true);
    expect(esUnidadPorcentual('bol')).toBe(false);
    const out = insumosPorMonto({ insumosPartida });
    expect(insumoParaFamilia('herramienta', out)?.codigo).toBe(HM);
    expect(insumoParaFamilia('material', out)).toBeNull();
  });
});

describe('lineasDeFamilia — el bloque entero como líneas de orden', () => {
  it('trae cantidad, precio y el insumo del presupuesto ya enlazado', () => {
    const items = [
      { descripcion: 'MARTILLO', unidad: 'UND', disponible: 6, ultimoPrecio: 25 },
      { descripcion: 'PALANA', unidad: 'UND', disponible: 20, ultimoPrecio: null },
    ];
    const out = lineasDeFamilia(items, {
      companyId: JARVEX, insumo: { codigo: HM, nombre: 'HERRAMIENTAS MANUALES', unidad: '%mo' },
    });
    expect(out[0]).toMatchObject({
      descripcion: 'MARTILLO', cantidad: 6, precio_unitario: 25,
      origen_company_id: JARVEX, insumo_codigo: HM, tope: 6,
    });
    // Sin precio conocido la línea entra vacía: el precio lo pone la persona,
    // no se inventa un cero que después viaja al historial.
    expect(out[1].precio_unitario).toBe('');
  });

  it('sin insumo del presupuesto, las líneas salen sin código (no se inventa el mapeo)', () => {
    const out = lineasDeFamilia([{ descripcion: 'X', disponible: 1, ultimoPrecio: 2 }], { companyId: GASOMI });
    expect(out[0].insumo_codigo).toBeNull();
  });
});
