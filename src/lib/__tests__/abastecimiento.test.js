import { describe, it, expect } from 'vitest';
import { abastecimientoDeObra, demandaDeObra, lineasParaOrden } from '../abastecimiento.js';
import { normMapeo } from '../mapeo-insumos.js';

// ── LOS DATOS SON LOS REALES ──────────────────────────────────────
// Medidos contra producción el 6-sep-2026 (Plan Miraflores):
//   CEMENTO PORTLAND TIPO I (42.5 kg) · 210020001 · bol · 11.269,16 en 191 partidas
//   ACERO CORRUGADO fy=4200 GRADO 60  ·  30020002 · kg  · 29.856,03 en  33 partidas
const CEMENTO = '210020001';
const ACERO = '30020002';
const EL_INCA = 'c-inca';
const GASOMI = 'c-gasomi';
const JHEENSEG = 'c-jheenseg';

const companies = [
  { id: EL_INCA, name: 'CONSORCIO EL INCA' },
  { id: GASOMI, name: 'GASOMI INGENIEROS E.I.R.L.' },
  { id: JHEENSEG, name: 'JHEENSEG INGENIEROS' },
];

const ip = (codigo, nombre, unidad, cantidad) => ({
  id: `ip-${codigo}-${Math.random()}`, obra_id: 'o1', insumo_codigo: codigo,
  nombre_insumo: nombre, unidad, cantidad_presupuestada: cantidad, tipo_insumo: 'material',
});

// El presupuesto real, repartido en varias partidas como está en la base.
const insumosPartida = [
  ip(CEMENTO, 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bol', 7000),
  ip(CEMENTO, 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bol', 4269.16),
  ip(ACERO, 'ACERO CORRUGADO fy = 4200 kg/cm2 GRADO 60', 'kg', 29856.03),
];

/** Un mapeo CONFIRMADO por una persona (fuente 'manual'). */
const mapManual = (desc, codigo, factor, unidadDestino) => ({
  norm: normMapeo(desc), decision: 'mapeado', insumo_codigo: codigo,
  factor, fuente: 'manual', unidad_destino: unidadDestino,
});

const mapeosDe = (filas) => new Map(filas.map(f => [f.norm, f]));

let seq = 0;
const mov = (company_id, clase, items) => ({
  id: `m${++seq}`, company_id, clase, type: clase === 'venta' ? 'income' : 'cost',
  notas: JSON.stringify({ items_factura: items }),
});
const item = (descripcion, cantidad, unidad = 'und') => ({ descripcion, cantidad, unidad, precio_unitario: 27.5 });

describe('demandaDeObra', () => {
  it('suma el mismo insumo a través de todas sus partidas', () => {
    const d = demandaDeObra(insumosPartida);
    expect(d.get(CEMENTO).necesita).toBe(11269.16);
    expect(d.get(CEMENTO).enPartidas).toBe(2);
    expect(d.get(ACERO).necesita).toBe(29856.03);
  });

  it('ignora las filas sin código canónico', () => {
    const d = demandaDeObra([...insumosPartida, { insumo_codigo: null, cantidad_presupuestada: 999 }]);
    expect(d.size).toBe(2);
  });

  it('filtra por tipo cuando se le pide', () => {
    const conMO = [...insumosPartida, { insumo_codigo: 'MO1', cantidad_presupuestada: 10, tipo_insumo: 'mano_obra' }];
    expect(demandaDeObra(conMO, { tipos: ['material'] }).size).toBe(2);
    expect(demandaDeObra(conMO, { tipos: null }).size).toBe(3);
  });
});

describe('abastecimientoDeObra — las cuatro columnas', () => {
  const mapeos = mapeosDe([mapManual('CEMENTO PORTLAND TIPO I', CEMENTO, 1, 'bol')]);

  it('el ejemplo de Gabriel, con los números reales', () => {
    // La ejecutora compró 2.250; GASOMI tiene 318; JHEENSEG 42.
    const movs = [
      mov(EL_INCA, 'compra', [item('CEMENTO PORTLAND TIPO I', 2250)]),
      mov(GASOMI, 'compra', [item('CEMENTO PORTLAND TIPO I', 318)]),
      mov(JHEENSEG, 'compra', [item('CEMENTO PORTLAND TIPO I', 42)]),
    ];
    const { filas } = abastecimientoDeObra({ insumosPartida, movs, mapeos, titularId: EL_INCA, companies });
    const cem = filas.find(f => f.codigo === CEMENTO);
    expect(cem.necesita).toBe(11269.16);
    expect(cem.yaComprado).toBe(2250);
    expect(cem.disponible).toBe(360);
    expect(cem.falta).toBe(8659.16);   // 11.269,16 − 2.250 − 360
    expect(cem.porEmpresa.map(e => [e.nombre, e.disponible]))
      .toEqual([['GASOMI INGENIEROS E.I.R.L.', 318], ['JHEENSEG INGENIEROS', 42]]);
  });

  it('lo que una empresa ya vendió deja de estar disponible', () => {
    const movs = [
      mov(GASOMI, 'compra', [item('CEMENTO PORTLAND TIPO I', 318)]),
      mov(GASOMI, 'venta', [item('CEMENTO PORTLAND TIPO I', 100)]),
    ];
    const { filas } = abastecimientoDeObra({ insumosPartida, movs, mapeos, titularId: EL_INCA, companies });
    expect(filas.find(f => f.codigo === CEMENTO).disponible).toBe(218);
  });

  it('una empresa que vendió más de lo que compró no aporta oferta NEGATIVA', () => {
    const movs = [
      mov(GASOMI, 'compra', [item('CEMENTO PORTLAND TIPO I', 50)]),
      mov(GASOMI, 'venta', [item('CEMENTO PORTLAND TIPO I', 200)]),
      mov(JHEENSEG, 'compra', [item('CEMENTO PORTLAND TIPO I', 42)]),
    ];
    const { filas } = abastecimientoDeObra({ insumosPartida, movs, mapeos, titularId: EL_INCA, companies });
    expect(filas.find(f => f.codigo === CEMENTO).disponible).toBe(42);
  });

  it('«falta» nunca es negativo aunque sobre material', () => {
    const movs = [mov(EL_INCA, 'compra', [item('CEMENTO PORTLAND TIPO I', 99999)])];
    const { filas } = abastecimientoDeObra({ insumosPartida, movs, mapeos, titularId: EL_INCA, companies });
    expect(filas.find(f => f.codigo === CEMENTO).falta).toBe(0);
  });

  it('un comprobante anulado no abastece nada', () => {
    const movs = [{ ...mov(GASOMI, 'compra', [item('CEMENTO PORTLAND TIPO I', 318)]), payment_status: 'cancelled' }];
    const { filas } = abastecimientoDeObra({ insumosPartida, movs, mapeos, titularId: EL_INCA, companies });
    expect(filas.find(f => f.codigo === CEMENTO).disponible).toBe(0);
  });
});

describe('abastecimientoDeObra — el factor de conversión', () => {
  it('aplica el factor: 1.148 varillas de 1/2" son kilos de acero', () => {
    // Una varilla de 1/2" × 9 m ≈ 8,9 kg (NTP 341.031).
    const mapeos = mapeosDe([mapManual('VARILLA DE ACERO CORRUGADO DE 1/2', ACERO, 8.9, 'kg')]);
    const movs = [mov(GASOMI, 'compra', [item('VARILLA DE ACERO CORRUGADO DE 1/2', 1148)])];
    const { filas } = abastecimientoDeObra({ insumosPartida, movs, mapeos, titularId: EL_INCA, companies });
    expect(filas.find(f => f.codigo === ACERO).disponible).toBe(10217.2);
  });

  it('SIN factor no asume 1: la línea se reporta aparte y no suma', () => {
    const mapeos = mapeosDe([{ norm: normMapeo('FIERRO 1/2'), decision: 'mapeado', insumo_codigo: ACERO, factor: null, fuente: 'manual' }]);
    const movs = [mov(GASOMI, 'compra', [item('FIERRO 1/2', 500)])];
    const { filas, resumen } = abastecimientoDeObra({ insumosPartida, movs, mapeos, titularId: EL_INCA, companies });
    expect(filas.find(f => f.codigo === ACERO).disponible).toBe(0);
    expect(resumen.sinFactor).toBe(1);
  });
});

describe('abastecimientoDeObra — sin mapeos confirmados', () => {
  it('arranca vacía y lo dice, en vez de mostrar ceros como si fueran datos', () => {
    const movs = [mov(GASOMI, 'compra', [item('CEMENTO PORTLAND TIPO I', 318)])];
    const { filas, resumen } = abastecimientoDeObra({ insumosPartida, movs, mapeos: new Map(), titularId: EL_INCA, companies });
    expect(resumen.hayMapeos).toBe(false);
    expect(resumen.conDisponibleEnGrupo).toBe(0);
    expect(filas.find(f => f.codigo === CEMENTO).falta).toBe(11269.16);
  });

  it('una propuesta del motor NO cuenta como oferta firme por defecto', () => {
    const mapeos = mapeosDe([{ ...mapManual('CEMENTO PORTLAND TIPO I', CEMENTO, 1, 'bol'), fuente: 'ia' }]);
    const movs = [mov(GASOMI, 'compra', [item('CEMENTO PORTLAND TIPO I', 318)])];
    const sinProp = abastecimientoDeObra({ insumosPartida, movs, mapeos, titularId: EL_INCA, companies });
    expect(sinProp.filas.find(f => f.codigo === CEMENTO).disponible).toBe(0);

    const conProp = abastecimientoDeObra({ insumosPartida, movs, mapeos, titularId: EL_INCA, companies, incluirPropuestas: true });
    expect(conProp.filas.find(f => f.codigo === CEMENTO).disponible).toBe(318);
    expect(conProp.resumen.lineasPropuestas).toBe(1);
  });

  it('un «no aplica» confirmado tampoco abastece', () => {
    const mapeos = mapeosDe([{ norm: normMapeo('LAPTOP DELL'), decision: 'no_aplica', fuente: 'manual' }]);
    const movs = [mov(GASOMI, 'compra', [item('LAPTOP DELL', 3)])];
    const { resumen } = abastecimientoDeObra({ insumosPartida, movs, mapeos, titularId: EL_INCA, companies });
    expect(resumen.lineasMapeadas).toBe(0);
  });

  it('lo que el presupuesto NO pide no entra al cuadro', () => {
    const mapeos = mapeosDe([mapManual('PERFIL DE ACERO', 'OTRO-999', 1, 'kg')]);
    const movs = [mov(GASOMI, 'compra', [item('PERFIL DE ACERO', 900)])];
    const { filas } = abastecimientoDeObra({ insumosPartida, movs, mapeos, titularId: EL_INCA, companies });
    expect(filas.find(f => f.codigo === 'OTRO-999')).toBeUndefined();
    expect(filas).toHaveLength(2);
  });
});

describe('lineasParaOrden — el puente hacia la orden', () => {
  const mapeos = mapeosDe([mapManual('CEMENTO PORTLAND TIPO I', CEMENTO, 1, 'bol')]);
  const movs = [
    mov(EL_INCA, 'compra', [item('CEMENTO PORTLAND TIPO I', 2250)]),
    mov(GASOMI, 'compra', [item('CEMENTO PORTLAND TIPO I', 318)]),
  ];
  const { filas } = abastecimientoDeObra({ insumosPartida, movs, mapeos, titularId: EL_INCA, companies });

  it('arma la línea con el código canónico y su unidad', () => {
    const l = lineasParaOrden(filas, { [CEMENTO]: { [GASOMI]: 300 } });
    expect(l).toEqual([expect.objectContaining({
      insumo_codigo: CEMENTO, cantidad: 300, company_id: GASOMI,
      empresa: 'GASOMI INGENIEROS E.I.R.L.', unidad: 'bol',
    })]);
  });

  it('NUNCA deja pedir más de lo que la empresa tiene', () => {
    const l = lineasParaOrden(filas, { [CEMENTO]: { [GASOMI]: 5000 } });
    expect(l[0].cantidad).toBe(318);
  });

  it('ignora cantidades cero o negativas', () => {
    expect(lineasParaOrden(filas, { [CEMENTO]: { [GASOMI]: 0 } })).toEqual([]);
    expect(lineasParaOrden(filas, { [CEMENTO]: { [GASOMI]: -5 } })).toEqual([]);
  });

  it('ignora una empresa que no tiene ese insumo', () => {
    expect(lineasParaOrden(filas, { [CEMENTO]: { [JHEENSEG]: 10 } })).toEqual([]);
  });
});

describe('abastecimientoDeObra — el stock que una orden ya comprometió', () => {
  const mapeos = mapeosDe([mapManual('CEMENTO PORTLAND TIPO I', CEMENTO, 1, 'bol')]);
  const movs = [mov(GASOMI, 'compra', [item('CEMENTO PORTLAND TIPO I', 318)])];
  const oc = (o = {}) => ({ id: 'oc1', estado: 'por_confirmar', accounting_movement_id: null, ...o });
  const li = (o = {}) => ({ id: 'i1', orden_compra_id: 'oc1', insumo_codigo: CEMENTO, proveedor_company_id: GASOMI, cantidad: 200, ...o });
  const disp = (opts) => abastecimientoDeObra({ insumosPartida, movs, mapeos, titularId: EL_INCA, companies, ...opts })
    .filas.find(f => f.codigo === CEMENTO);

  it('una orden viva reserva sus unidades y bajan del disponible', () => {
    const f = disp({ ordenes: [oc()], ocItems: [li()] });
    expect(f.disponible).toBe(118);          // 318 − 200 comprometidas
    expect(f.porEmpresa[0].comprometido).toBe(200);
  });

  it('una orden ANULADA libera lo que reservaba (aunque no libere su número)', () => {
    expect(disp({ ordenes: [oc({ estado: 'anulada' })], ocItems: [li()] }).disponible).toBe(318);
  });

  it('una orden que YA tiene comprobante no descuenta dos veces', () => {
    // Con factura vinculada, la venta correspondiente ya descuenta el stock por
    // el otro lado; restar acá también haría desaparecer material que existe.
    expect(disp({ ordenes: [oc({ accounting_movement_id: 'm-fact' })], ocItems: [li()] }).disponible).toBe(318);
  });

  it('una línea de orden retroactiva (sin código ni empresa) no reserva nada', () => {
    const f = disp({ ordenes: [oc()], ocItems: [li({ insumo_codigo: null, proveedor_company_id: null })] });
    expect(f.disponible).toBe(318);
  });

  it('reservar más de lo que hay deja el disponible en cero, nunca negativo', () => {
    expect(disp({ ordenes: [oc()], ocItems: [li({ cantidad: 9999 })] }).disponible).toBe(0);
  });

  it('lo comprometido también topea lo que se puede pedir', () => {
    const { filas } = abastecimientoDeObra({
      insumosPartida, movs, mapeos, titularId: EL_INCA, companies,
      ordenes: [oc()], ocItems: [li()],
    });
    expect(lineasParaOrden(filas, { [CEMENTO]: { [GASOMI]: 300 } })[0].cantidad).toBe(118);
  });
});
