import { describe, it, expect } from 'vitest';
import {
  catalogoDelPresupuesto, existenciasDelAlmacen, factorPropuesto, sugerirImputacion,
  parcheImputacion, bandejaImputacion, insumosCubiertosPorAlmacen,
  IMPUTACIONES, IMPUTACION_LABEL, TABLAS_ALMACEN,
} from '../simulador-imputacion.js';
import { coberturaPrevia } from '../simulador-ordenes.js';

// ── LOS NOMBRES SON LOS REALES ────────────────────────────────────
// Presupuesto, almacén y órdenes de Plan Miraflores, medidos el 24-set-2026.
const CEMENTO = '210020001';
const TUB8 = '020005001';
const TUB12 = '020005002';
const VALV = '270010001';
const HERR = '370020009';
const ESTUDIO = '930020015';

const ip = (codigo, nombre, unidad, cantidad, precio, tipo = 'material') => ({
  id: `ip-${codigo}-${Math.random()}`, insumo_codigo: codigo, nombre_insumo: nombre, unidad,
  tipo_insumo: tipo, cantidad_presupuestada: cantidad, precio_presupuestado: precio,
  costo_presupuestado: cantidad * precio,
});

const PRESUPUESTO = [
  ip(CEMENTO, 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bol', 6000, 30),
  ip(CEMENTO, 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bol', 5269, 30),
  ip(TUB8, 'TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435', 'm', 14088, 32),
  ip(TUB12, 'TUBERIA PVC SP C-10 DE 1/2" X 5 m NTP 399.002', 'm', 9000, 2),
  ip(VALV, 'VALVULA CHECK 1/2"', 'und', 300, 25),
  ip(HERR, 'HERRAMIENTAS MANUALES', '%mo', 1, 120, 'equipo'),
  ip(HERR, 'HERRAMIENTAS MANUALES', '%mo', 1, 380, 'equipo'),
  ip(ESTUDIO, 'GASTOS OPERATIVOS', 'mes', 8, 3000),
  ip('470100001', 'PEON', 'hh', 1000, 20, 'mano_obra'),
];
const cat = catalogoDelPresupuesto(PRESUPUESTO);

// El CHECK de la mig 229, escrito igual que en SQL. Lo que salga de
// `parcheImputacion` tiene que cumplirlo siempre (regla 9 de CLAUDE.md).
const cumpleCheckOrden = (p) => (
  p.imputacion == null
  || (['insumo', 'sobre'].includes(p.imputacion) && p.insumo_codigo != null)
  || (p.imputacion === 'fuera' && p.insumo_codigo == null)
);
const cumpleCheckAlmacen = (p) => (
  (p.imputacion == null && p.insumo_codigo == null && p.factor_presupuesto == null)
  || (p.imputacion === 'insumo' && p.insumo_codigo != null)
  || (p.imputacion === 'fuera' && p.insumo_codigo == null && p.factor_presupuesto == null)
) && (p.factor_presupuesto == null || p.factor_presupuesto > 0);

describe('el presupuesto como catálogo', () => {
  it('consolida por código, deja afuera la mano de obra y separa los sobres', () => {
    expect(cat.porCodigo.get(CEMENTO).cantidad).toBe(11269);
    expect(cat.porCodigo.has('470100001')).toBe(false);
    expect(cat.insumos.map(i => i.codigo)).not.toContain(HERR);
    const herr = cat.sobres.find(s => s.codigo === HERR);
    expect(herr.costo).toBe(500);
    // Misma clave que el motor: así el sobre de la bandeja es el del plan.
    expect(herr.claveSobre).toBe('herramientas manuales|%mo');
    // `mes` también es un sobre desde la tanda 2.1.
    expect(cat.sobres.map(s => s.codigo)).toContain(ESTUDIO);
  });
});

describe('el almacén: qué entró y qué hay', () => {
  const OBRA = 'o1';
  const alm = existenciasDelAlmacen({
    obraId: OBRA,
    materiales: [
      { id: 'm1', obra_id: OBRA, nombre_material: 'CEMENTO', unidad: 'Bolsas', stock_actual: 62, stock_inicial: 0 },
      { id: 'm2', obra_id: OBRA, nombre_material: 'ARENA', unidad: 'm3', stock_actual: 4, stock_inicial: 10 },
      { id: 'mg', obra_id: OBRA, nombre_material: 'TUBERÍAS', es_grupo: true },
      { id: 'mo', obra_id: 'otra', nombre_material: 'CEMENTO', unidad: 'Bolsas', stock_actual: 999 },
    ],
    movMateriales: [
      { material_id: 'm1', obra_id: OBRA, tipo_movimiento: 'entrada', cantidad: 3000 },
      { material_id: 'm1', obra_id: OBRA, tipo_movimiento: 'entrada', cantidad: 140 },
      { material_id: 'm1', obra_id: OBRA, tipo_movimiento: 'salida', cantidad: 3078 },
      // Una entrada reversada no entró.
      { material_id: 'm1', obra_id: OBRA, tipo_movimiento: 'entrada', cantidad: 500, reversed_by_id: 'r1' },
      { material_id: 'm1', obra_id: OBRA, tipo_movimiento: 'entrada', cantidad: 9, deleted_at: '2026-09-01' },
    ],
    herramientas: [{ id: 'h1', obra_id: OBRA, nombre_herramienta: 'PICO', unidad: 'und', stock_actual: 30 }],
    movHerramientas: [
      { herramienta_id: 'h1', obra_id: OBRA, tipo_movimiento: 'ingreso', cantidad: 40 },
      // Vuelve del trabajador: no se compró de nuevo.
      { herramienta_id: 'h1', obra_id: OBRA, tipo_movimiento: 'devolucion', cantidad: 5 },
      { herramienta_id: 'h1', obra_id: OBRA, tipo_movimiento: 'ingreso', cantidad: null },
    ],
    epps: [{ id: 'e1', obra_id: OBRA, nombre_epp: 'CASCO', unidad: 'und', stock_actual: 3 }],
    movEpp: [{ epp_id: 'e1', obra_id: OBRA, tipo_movimiento: 'entrada', cantidad: 20 }],
  });
  const de = (id) => alm.find(f => f.id === id);

  it('las entradas son TODO lo que entró, sin reversados ni borrados', () => {
    expect(de('m1')).toMatchObject({ tabla: 'materiales', nombre: 'CEMENTO', entradas: 3140, stock: 62 });
  });
  it('el stock inicial cuenta como entrado', () => {
    expect(de('m2').entradas).toBe(10);
  });
  it('en herramientas la entrada es «ingreso» y la devolución no suma', () => {
    // 40 + 1 (la herramienta sin cantidad es una).
    expect(de('h1').entradas).toBe(41);
  });
  it('los EPPs entran por «entrada»', () => {
    expect(de('e1')).toMatchObject({ tabla: 'epps', entradas: 20, stock: 3 });
  });
  it('ni los grupos ni los ítems de otra obra', () => {
    expect(de('mg')).toBeUndefined();
    expect(de('mo')).toBeUndefined();
  });
  it('las tablas del almacén son las tres que tienen columna de imputación (mig 229)', () => {
    expect(Object.keys(TABLAS_ALMACEN).sort()).toEqual(['epps', 'herramientas', 'materiales']);
  });
});

describe('el factor: cuánto del presupuesto trae cada unidad', () => {
  it('misma unidad escrita distinto → 1 (Bolsas = bol, UNIDAD = und)', () => {
    expect(factorPropuesto('Bolsas', cat.porCodigo.get(CEMENTO)).factor).toBe(1);
    expect(factorPropuesto('UNIDAD', cat.porCodigo.get(VALV)).factor).toBe(1);
  });
  it('una pieza contra metros usa la presentación que dice el nombre', () => {
    expect(factorPropuesto('unidad', cat.porCodigo.get(TUB8))).toMatchObject({ factor: 6, fuente: 'presentacion' });
    expect(factorPropuesto('unidad', cat.porCodigo.get(TUB12)).factor).toBe(5);
  });
  it('la corrección a mano de la obra le gana al nombre (el tubo era de 5 m)', () => {
    const compras = { [TUB8]: { factor: 5, unidadCompra: 'tubo de 5 m' } };
    expect(factorPropuesto('unidad', cat.porCodigo.get(TUB8), { compras }).factor).toBe(5);
  });
  it('lo que no se sabe NO se inventa', () => {
    expect(factorPropuesto('kg', cat.porCodigo.get(TUB8)).factor).toBeNull();
    // Metros contra una válvula: nada que convertir.
    expect(factorPropuesto('m', cat.porCodigo.get(VALV)).factor).toBeNull();
  });
});

describe('la sugerencia', () => {
  it('«CEMENTO» del almacén → el cemento del presupuesto, factor 1', () => {
    const { sugerencia } = sugerirImputacion({ fuente: 'almacen', nombre: 'CEMENTO', unidad: 'Bolsas' }, cat);
    expect(sugerencia).toMatchObject({ tipo: 'insumo', codigo: CEMENTO, factor: 1 });
  });
  it('el tubo del almacén → la tubería, con el largo del tubo como factor', () => {
    const { sugerencia } = sugerirImputacion({ fuente: 'almacen', nombre: 'TUBO PVC-U 200 mm S-25 UF ALCANTARILLADO', unidad: 'unidad' }, cat);
    expect(sugerencia).toMatchObject({ codigo: TUB8, factor: 6 });
  });
  it('una herramienta de ORDEN sin insumo propio → el sobre de herramientas', () => {
    const { sugerencia } = sugerirImputacion({ fuente: 'orden', nombre: 'PALANA CUCHARA M/BELLOTA', unidad: 'und', tipo_insumo: 'herramienta' }, cat);
    expect(sugerencia).toMatchObject({ tipo: 'sobre', codigo: HERR });
  });
  it('aunque la orden la haya cargado como «material», el nombre la delata', () => {
    const { sugerencia } = sugerirImputacion({ fuente: 'orden', nombre: 'MARTILLO M/STANLEY', unidad: 'und', tipo_insumo: 'material' }, cat);
    expect(sugerencia?.tipo).toBe('sobre');
  });
  it('al almacén NUNCA se le sugiere un sobre: no tiene precio con qué gastarlo', () => {
    const { sugerencia } = sugerirImputacion({ fuente: 'almacen', nombre: 'PALANA CUCHARA', unidad: 'und', tipo_insumo: 'herramienta' }, cat);
    expect(sugerencia).toBeNull();
  });
  it('lo que no reconoce queda sin sugerencia, no con una plausible', () => {
    const { sugerencia } = sugerirImputacion({ fuente: 'orden', nombre: 'ESTUDIO DE SUELOS PARA LA ELABORACIÓN DEL DOCUMENTO DE TRABAJO', unidad: 'UNIDAD', tipo_insumo: 'servicio' }, cat);
    expect(sugerencia).toBeNull();
  });
});

describe('el parche respeta el CHECK de la mig 229', () => {
  const casosOrden = [
    [{ tipo: 'insumo', codigo: CEMENTO, factor: 1 }, { imputacion: 'insumo', insumo_codigo: CEMENTO, factor_presupuesto: null }],
    [{ tipo: 'insumo', codigo: TUB8, factor: 6 }, { imputacion: 'insumo', insumo_codigo: TUB8, factor_presupuesto: 6 }],
    [{ tipo: 'sobre', codigo: HERR }, { imputacion: 'sobre', insumo_codigo: HERR, factor_presupuesto: null }],
    [{ tipo: 'fuera' }, { imputacion: 'fuera', insumo_codigo: null, factor_presupuesto: null }],
    [{ tipo: null }, { imputacion: null, insumo_codigo: null, factor_presupuesto: null }],
  ];
  it.each(casosOrden)('orden: %o', (decision, esperado) => {
    const r = parcheImputacion(decision, { permiteSobre: true, catalogo: cat });
    expect(r).toEqual({ ok: true, patch: esperado });
    expect(cumpleCheckOrden(r.patch)).toBe(true);
  });

  it('todo parche del almacén cumple su CHECK (más estricto)', () => {
    for (const d of [{ tipo: 'insumo', codigo: CEMENTO, factor: 1 }, { tipo: 'insumo', codigo: TUB8, factor: 6 }, { tipo: 'fuera' }, { tipo: null }]) {
      const r = parcheImputacion(d, { catalogo: cat });
      expect(r.ok).toBe(true);
      expect(cumpleCheckAlmacen(r.patch)).toBe(true);
    }
  });

  it('lo que el CHECK rechazaría vuelve con ok:false y un motivo', () => {
    const no = (d, o = {}) => parcheImputacion(d, { catalogo: cat, ...o });
    expect(no({ tipo: 'insumo', codigo: '', factor: 1 }).ok).toBe(false);
    expect(no({ tipo: 'insumo', codigo: CEMENTO }).motivo).toMatch(/factor/);
    expect(no({ tipo: 'insumo', codigo: CEMENTO, factor: 0 }).ok).toBe(false);
    expect(no({ tipo: 'insumo', codigo: '999' , factor: 1 }).motivo).toMatch(/no está en el presupuesto/);
    // El almacén no va a un sobre.
    expect(no({ tipo: 'sobre', codigo: HERR }).motivo).toMatch(/no tiene precio/);
    // Un sobre no es un insumo, ni al revés.
    expect(no({ tipo: 'insumo', codigo: HERR, factor: 1 }).ok).toBe(false);
    expect(no({ tipo: 'sobre', codigo: CEMENTO }, { permiteSobre: true }).ok).toBe(false);
    expect(no({ tipo: 'otra' }).ok).toBe(false);
  });

  it('los destinos y sus nombres', () => {
    expect(IMPUTACIONES).toEqual(['insumo', 'sobre', 'fuera']);
    for (const k of [...IMPUTACIONES, 'pendiente']) expect(IMPUTACION_LABEL[k]).toBeTruthy();
  });
});

describe('la bandeja', () => {
  const ordenes = [
    { id: 'oc1', codigo: 'OC-001-2026', estado: 'recibida', proveedor_nombre: 'FERRETERIA HUAMAN EIRL' },
    { id: 'oc2', codigo: 'OC-002-2026', estado: 'recibida' },
    { id: 'os1', codigo: 'OS-005-2026', estado: 'recibida' },
    { id: 'ocx', codigo: 'OC-099-2026', estado: 'anulada' },
    { id: 'oc9', codigo: 'OC-009-2026', estado: 'borrador' },
  ];
  const ocItems = [
    { id: 'i1', orden_compra_id: 'oc1', nombre: 'CEMENTO PORTLAND TIPO I 425 KG - PACASMAYO-BOLSA', unidad: 'und', cantidad: 750, subtotal: 20783.9, tipo_insumo: 'material' },
    { id: 'i2', orden_compra_id: 'oc2', nombre: 'PALANA CUCHARA M/BELLOTA', unidad: 'und', cantidad: 40, subtotal: 2400, tipo_insumo: 'herramienta' },
    { id: 'i3', orden_compra_id: 'os1', nombre: 'ESTUDIO DE SUELOS', unidad: 'UNIDAD', cantidad: 1, subtotal: 4237.29, imputacion: 'fuera' },
    // De una orden anulada: no se pide imputar.
    { id: 'i4', orden_compra_id: 'ocx', nombre: 'CEMENTO', unidad: 'und', cantidad: 1 },
    // Escrita por el simulador con código: no es asunto de esta bandeja.
    { id: 'i5', orden_compra_id: 'oc9', nombre: 'CEMENTO', unidad: 'bol', cantidad: 100, insumo_codigo: CEMENTO },
  ];
  const almacen = [
    { tabla: 'materiales', id: 'm1', nombre: 'CEMENTO', unidad: 'Bolsas', entradas: 3140, stock: 62 },
    { tabla: 'materiales', id: 'm2', nombre: 'LAPICEROS AZULES', unidad: 'UNIDAD', entradas: 23, stock: 0 },
    { tabla: 'materiales', id: 'm3', nombre: 'TUBO PVC-U 200 mm S-25 UF ALCANTARILLADO', unidad: 'unidad', entradas: 2048, stock: 1375, imputacion: 'insumo', insumo_codigo: TUB8, factor_presupuesto: 6 },
    { tabla: 'materiales', id: 'm4', nombre: 'NUNCA LLEGÓ', unidad: 'und', entradas: 0, stock: 0 },
  ];
  const b = bandejaImputacion({ ordenes, ocItems, almacen, catalogo: cat });

  it('órdenes: solo las líneas sin código de órdenes vivas, más las ya imputadas desde acá', () => {
    expect(b.ordenes.map(f => f.id).sort()).toEqual(['i1', 'i2', 'i3']);
  });

  it('cada fila dice de qué orden viene y en qué estado está', () => {
    const i1 = b.ordenes.find(f => f.id === 'i1');
    expect(i1).toMatchObject({ ordenCodigo: 'OC-001-2026', proveedor: 'FERRETERIA HUAMAN EIRL', estado: 'pendiente', monto: 20783.9 });
    expect(b.ordenes.find(f => f.id === 'i3').estado).toBe('fuera');
  });

  it('las pendientes van arriba, y entre ellas las que tienen sugerencia', () => {
    expect(b.ordenes[b.ordenes.length - 1].id).toBe('i3');
    expect(b.ordenes[0].id).toBe('i2');       // la palana trae el sobre sugerido
    expect(b.almacen[0].id).toBe('m1');       // el cemento trae sugerencia
  });

  it('una fila ya imputada muestra a qué, y no se le vuelve a sugerir nada', () => {
    const m3 = b.almacen.find(f => f.id === 'm3');
    expect(m3).toMatchObject({ estado: 'insumo', factor: 6 });
    expect(m3.destino.codigo).toBe(TUB8);
    expect(m3.sugerencia).toBeNull();
  });

  it('del almacén, solo lo que recibió algo', () => {
    expect(b.almacen.map(f => f.id)).not.toContain('m4');
  });

  it('el resumen cuenta por estado', () => {
    expect(b.resumen.ordenes).toMatchObject({ total: 3, pendiente: 2, fuera: 1, conSugerencia: 1 });
    expect(b.resumen.almacen).toMatchObject({ total: 3, pendiente: 2, insumo: 1 });
  });
});

describe('de la bandeja al motor: imputar cierra el hueco', () => {
  it('una línea imputada con el parche deja de estar «sin imputar» y resta', () => {
    const orden = [{ id: 'oc1', estado: 'enviada' }];
    const linea = { id: 'i1', orden_compra_id: 'oc1', cantidad: 25, subtotal: 750 };
    const antes = coberturaPrevia({ ordenes: orden, ocItems: [linea] });
    expect(antes.sinImputar.lineas).toBe(1);
    const { patch } = parcheImputacion({ tipo: 'insumo', codigo: TUB8, factor: 6 }, { catalogo: cat });
    const despues = coberturaPrevia({ ordenes: orden, ocItems: [{ ...linea, ...patch }] });
    expect(despues.sinImputar.lineas).toBe(0);
    expect(despues.cubierto.get(TUB8)).toBe(150);
  });
});

describe('insumos que el almacén cubre (para el modo personalizado)', () => {
  it('uno por código, en unidades del presupuesto', () => {
    const r = insumosCubiertosPorAlmacen([
      { id: 'a', imputacion: 'insumo', insumo_codigo: TUB8, factor_presupuesto: 6, entradas: 10, stock: 2 },
      { id: 'b', imputacion: 'insumo', insumo_codigo: TUB8, factor_presupuesto: null, entradas: 4, stock: 4 },
      { id: 'c', imputacion: 'fuera', entradas: 99 },
      { id: 'd', imputacion: null, entradas: 99 },
    ], cat);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ codigo: TUB8, unidad: 'm', entradas: 64, stock: 16, items: 2, necesita: 14088 });
  });
});
