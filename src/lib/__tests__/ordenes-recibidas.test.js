// El buzón: que la orden le llegue a su destinataria, que el cruce con el
// inventario proponga sin decidir, y que «no sé» no se confunda con «no hay».
import { describe, it, expect } from 'vitest';
import {
  estadoRespuesta, respuestaCerrada, buzonDeEmpresa, resumenBuzon,
  inventarioTextualDeEmpresa, parecido, cruzarOrdenConInventario,
  borradorDeFacturaDesdeOrden, totalesDeBorrador, avisosDeFactura,
  itemsFacturaDeBorrador, lineasQueExcedenElStock,
} from '../ordenes-recibidas.js';

const GASOMI = 'c-gasomi';
const INCA = 'c-inca';

const oc = (o) => ({
  deleted_at: null, tipo: 'compra', estado: 'firmada', igv_pct: 18,
  company_id: INCA, proveedor_company_id: GASOMI, monto_total: 1000, fecha: '2026-09-01', ...o,
});

const ORDENES = [
  oc({ id: 'o1', codigo: 'OC-001-2026' }),
  oc({ id: 'o2', codigo: 'OC-002-2026', respuesta_estado: 'facturada', monto_total: 500 }),
  oc({ id: 'o3', codigo: 'OC-003-2026', respuesta_estado: 'en_revision', tipo: 'servicio', monto_total: 300 }),
  // Anulada por quien la emitió y nunca atendida: no le hacemos perder el tiempo.
  oc({ id: 'o4', codigo: 'OC-004-2026', estado: 'anulada' }),
  // Anulada DESPUÉS de facturada: eso sí hay que mirarlo.
  oc({ id: 'o5', codigo: 'OC-005-2026', estado: 'anulada', respuesta_estado: 'facturada' }),
  // A otra empresa.
  oc({ id: 'o6', codigo: 'OC-006-2026', proveedor_company_id: 'c-otra' }),
  // A un tercero: no tiene buzón.
  oc({ id: 'o7', codigo: 'OC-007-2026', proveedor_company_id: null }),
  oc({ id: 'o8', codigo: 'OC-008-2026', deleted_at: '2026-09-02' }),
];

describe('estadoRespuesta', () => {
  it('NULL no es un estado escrito a mano: se lee como pendiente', () => {
    expect(estadoRespuesta({})).toBe('pendiente');
    expect(estadoRespuesta({ respuesta_estado: 'basura' })).toBe('pendiente');
    expect(estadoRespuesta({ respuesta_estado: 'aceptada' })).toBe('aceptada');
  });
  it('solo facturada y rechazada cierran el asunto', () => {
    expect(respuestaCerrada({ respuesta_estado: 'facturada' })).toBe(true);
    expect(respuestaCerrada({ respuesta_estado: 'aceptada' })).toBe(false);
  });
});

describe('buzonDeEmpresa', () => {
  const buzon = (opts) => buzonDeEmpresa({ ordenes: ORDENES, companyId: GASOMI, ...opts });

  it('solo las que le emitieron a ESTA empresa', () => {
    const ids = buzon().map(o => o.id);
    expect(ids).not.toContain('o6');
    expect(ids).not.toContain('o7');
    expect(ids).not.toContain('o8');
  });

  it('🔴 una anulada sin atender desaparece; una anulada YA facturada se queda', () => {
    const ids = buzon().map(o => o.id);
    expect(ids).not.toContain('o4');
    expect(ids).toContain('o5');
  });

  it('lo que espera respuesta va primero', () => {
    expect(buzon().map(o => o.respuestaEstado)[0]).toBe('pendiente');
  });

  it('se puede esconder lo ya cerrado', () => {
    const ids = buzon({ incluirCerradas: false }).map(o => o.id);
    expect(ids).toEqual(['o1', 'o3']);
  });

  it('filtra por tipo y por texto', () => {
    expect(buzon({ tipo: 'servicio' }).map(o => o.id)).toEqual(['o3']);
    expect(buzon({ texto: 'OC-002' }).map(o => o.id)).toEqual(['o2']);
  });

  it('sin empresa no hay buzón', () => {
    expect(buzonDeEmpresa({ ordenes: ORDENES, companyId: null })).toEqual([]);
  });
});

describe('resumenBuzon', () => {
  it('cuenta por estado y suma solo lo que falta atender', () => {
    const r = resumenBuzon(ORDENES, GASOMI);
    expect(r.pendiente).toBe(1);
    expect(r.en_revision).toBe(1);
    expect(r.facturada).toBe(2);
    expect(r.montoPorAtender).toBe(1300);   // o1 (1000) + o3 (300)
  });
});

// ── El inventario que sale de las facturas ─────────────────────────
const mv = (o) => ({ deleted_at: null, company_id: GASOMI, type: 'cost', clase: 'compra', ...o });
const MOVS = [
  mv({ id: 'm1', date: '2026-03-01', notas: JSON.stringify({ items_factura: [
    { descripcion: 'CEMENTO SOL TIPO I 42.5KG', unidad: 'BOL', cantidad: 318, precio_unitario: 26 },
  ] }) }),
  mv({ id: 'm2', date: '2026-08-01', notas: JSON.stringify({ items_factura: [
    { descripcion: 'CEMENTO SOL TIPO I 42.5KG', unidad: 'BOL', cantidad: 100, precio_unitario: 29 },
  ] }) }),
  mv({ id: 'm3', date: '2026-08-15', type: 'income', clase: 'venta', notas: JSON.stringify({ items_factura: [
    { descripcion: 'CEMENTO SOL TIPO I 42.5KG', unidad: 'BOL', cantidad: 100 },
  ] }) }),
  // De OTRA empresa: no es inventario de GASOMI.
  mv({ id: 'm4', company_id: 'c-otra', date: '2026-08-01', notas: JSON.stringify({ items_factura: [
    { descripcion: 'ALAMBRE NEGRO N16', cantidad: 500, precio_unitario: 5 },
  ] }) }),
];

describe('inventarioTextualDeEmpresa', () => {
  const inv = inventarioTextualDeEmpresa({ movs: MOVS, companyId: GASOMI });
  const cemento = [...inv.values()].find(e => /CEMENTO/.test(e.descripcion));

  it('suma lo comprado y RESTA lo vendido: nadie ofrece dos veces la misma bolsa', () => {
    expect(cemento.comprado).toBe(418);
    expect(cemento.vendido).toBe(100);
    expect(cemento.disponible).toBe(318);
  });

  it('el último costo es el de la compra más reciente', () => {
    expect(cemento.ultimoCosto).toBe(29);
    expect(cemento.ultimaFecha).toBe('2026-08-01');
  });

  it('lo de otra empresa no entra', () => {
    expect([...inv.values()].find(e => /ALAMBRE/.test(e.descripcion))).toBeUndefined();
  });

  it('sin empresa devuelve un índice vacío, no todo', () => {
    expect(inventarioTextualDeEmpresa({ movs: MOVS, companyId: null }).size).toBe(0);
  });
});

describe('parecido', () => {
  it('reconoce el mismo insumo escrito distinto', () => {
    expect(parecido('CEMENTO PORTLAND TIPO I', 'CEMENTO SOL TIPO I 42.5KG')).toBeGreaterThan(0.34);
  });
  it('no engancha cosas distintas por una palabra suelta', () => {
    expect(parecido('CEMENTO PORTLAND TIPO I', 'ALAMBRE NEGRO N16')).toBe(0);
  });
  it('con texto vacío no inventa un match', () => {
    expect(parecido('', 'CEMENTO')).toBe(0);
  });
});

describe('cruzarOrdenConInventario', () => {
  const inventario = inventarioTextualDeEmpresa({ movs: MOVS, companyId: GASOMI });
  const items = [
    { id: 'it1', nombre: 'CEMENTO PORTLAND TIPO I', unidad: 'BOL', cantidad: 200, precio_unitario: 32 },
    { id: 'it2', nombre: 'TUBERIA PVC 4 PULGADAS', unidad: 'UND', cantidad: 30, precio_unitario: 45 },
  ];
  const cruce = cruzarOrdenConInventario({ items, inventario });

  it('propone el equivalente aunque se llame distinto', () => {
    expect(cruce[0].mejor.descripcion).toBe('CEMENTO SOL TIPO I 42.5KG');
    expect(cruce[0].disponible).toBe(318);
    expect(cruce[0].cubre).toBe(true);
  });

  it('🔴 lo que no encuentra da «no sé», NO cero', () => {
    expect(cruce[1].mejor).toBeNull();
    expect(cruce[1].disponible).toBeNull();
    expect(cruce[1].cubre).toBeNull();
    expect(cruce[1].faltante).toBeNull();
  });

  it('dice cuánto falta cuando no alcanza', () => {
    const c = cruzarOrdenConInventario({
      items: [{ id: 'x', nombre: 'CEMENTO PORTLAND TIPO I', unidad: 'BOL', cantidad: 500 }],
      inventario,
    });
    expect(c[0].cubre).toBe(false);
    expect(c[0].faltante).toBe(182);
  });

  it('con unidades distintas no afirma que alcanza: no sabemos', () => {
    const c = cruzarOrdenConInventario({
      items: [{ id: 'x', nombre: 'CEMENTO PORTLAND TIPO I', unidad: 'TON', cantidad: 5 }],
      inventario,
    });
    expect(c[0].mejor.mismaUnidad).toBe(false);
    expect(c[0].cubre).toBeNull();
  });
});

// ── El borrador de la factura ──────────────────────────────────────
describe('borradorDeFacturaDesdeOrden', () => {
  const inventario = inventarioTextualDeEmpresa({ movs: MOVS, companyId: GASOMI });
  const items = [{ id: 'it1', nombre: 'CEMENTO PORTLAND TIPO I', unidad: 'BOL', cantidad: 200, precio_unitario: 32 }];
  const cruce = cruzarOrdenConInventario({ items, inventario });
  const b = borradorDeFacturaDesdeOrden({ orden: ORDENES[0], items, cruce });

  it('arranca siendo la orden, con el nombre de la empresa ya propuesto', () => {
    expect(b.lineas[0].nombreOrden).toBe('CEMENTO PORTLAND TIPO I');
    expect(b.lineas[0].nombre).toBe('CEMENTO SOL TIPO I 42.5KG');
    expect(b.lineas[0].cantidad).toBe(200);
    expect(b.lineas[0].precio_unitario).toBe(32);
  });

  it('conserva qué decía el pedido: sin eso los dos papeles no se cuadran', () => {
    const its = itemsFacturaDeBorrador(b);
    expect(its[0].descripcion).toBe('CEMENTO SOL TIPO I 42.5KG');
    expect(its[0].descripcion_orden).toBe('CEMENTO PORTLAND TIPO I');
  });

  it('los totales solo cuentan las líneas incluidas', () => {
    expect(totalesDeBorrador(b).valorVenta).toBe(6400);
    const sin = { ...b, lineas: b.lineas.map(l => ({ ...l, incluir: false })) };
    expect(totalesDeBorrador(sin).total).toBe(0);
  });
});

describe('avisosDeFactura', () => {
  const base = {
    igvPct: 18,
    lineas: [{
      key: 'k', incluir: true, nombreOrden: 'CEMENTO', nombre: 'CEMENTO',
      enlazadoA: 'cemento', unidad: 'BOL', cantidad: 10, cantidadPedida: 10,
      precio_unitario: 30, costoUnitario: 26, disponible: 100, insumo_codigo: null,
    }],
  };
  const av = (b, orden = null) => avisosDeFactura({ borrador: b, orden }).map(a => a.clave);

  it('sin líneas incluidas lo dice y no sigue', () => {
    expect(av({ ...base, lineas: [] })).toEqual(['sin_lineas']);
  });

  it('una línea sin equivalencia se avisa, pero NO bloquea', () => {
    expect(av({ ...base, lineas: [{ ...base.lineas[0], enlazadoA: null }] })).toContain('sin_enlace');
  });

  it('pedir más de lo disponible se avisa', () => {
    expect(av({ ...base, lineas: [{ ...base.lineas[0], cantidad: 500 }] })).toContain('sin_stock');
  });

  it('🔴 vender por debajo del costo es el aviso ALTO', () => {
    const b = { ...base, lineas: [{ ...base.lineas[0], precio_unitario: 20 }] };
    const a = avisosDeFactura({ borrador: b }).find(x => x.clave === 'bajo_costo');
    expect(a.nivel).toBe('alto');
  });

  it('renombrar una línea se avisa como información, no como problema', () => {
    const b = { ...base, lineas: [{ ...base.lineas[0], nombre: 'CEMENTO SOL' }] };
    expect(avisosDeFactura({ borrador: b }).find(x => x.clave === 'nombre_distinto').nivel).toBe('info');
  });

  it('facturar por un monto distinto al pedido se avisa', () => {
    expect(av(base, { monto_total: 9999 })).toContain('monto_distinto');
  });

  it('una factura que cuadra con el pedido no genera ruido', () => {
    expect(av(base, { monto_total: totalesDeBorrador(base).total })).toEqual([]);
  });
});

// ── TANDA 9: pedirle a una empresa del grupo más de lo que tiene ────
describe('lineasQueExcedenElStock', () => {
  const inventario = inventarioTextualDeEmpresa({ movs: MOVS, companyId: GASOMI });

  it('avisa cuando piden más de lo disponible, con cuánto falta', () => {
    const av = lineasQueExcedenElStock({
      lineas: [{ key: 'a', descripcion: 'CEMENTO PORTLAND TIPO I', unidad: 'BOL', cantidad: 500 }],
      inventario,
    });
    expect(av).toHaveLength(1);
    expect(av[0]).toMatchObject({ pedido: 500, disponible: 318, faltante: 182 });
    expect(av[0].seLlama).toBe('CEMENTO SOL TIPO I 42.5KG');
  });

  it('no avisa cuando alcanza', () => {
    expect(lineasQueExcedenElStock({
      lineas: [{ key: 'a', descripcion: 'CEMENTO PORTLAND TIPO I', unidad: 'BOL', cantidad: 10 }],
      inventario,
    })).toHaveLength(0);
  });

  it('🔴 lo que NO encuentra no se avisa: «no sé» no es «no tienes»', () => {
    expect(lineasQueExcedenElStock({
      lineas: [{ key: 'a', descripcion: 'TUBERIA PVC 4 PULGADAS', unidad: 'UND', cantidad: 900 }],
      inventario,
    })).toHaveLength(0);
  });

  it('⚠️ con un TERCERO no hay inventario: no se inventa un aviso', () => {
    expect(lineasQueExcedenElStock({
      lineas: [{ key: 'a', descripcion: 'CEMENTO PORTLAND TIPO I', cantidad: 9999 }],
      inventario: new Map(),
    })).toEqual([]);
  });

  it('una línea sin cantidad o sin nombre no genera ruido', () => {
    expect(lineasQueExcedenElStock({
      lineas: [{ key: 'a', descripcion: '', cantidad: 500 }, { key: 'b', descripcion: 'CEMENTO', cantidad: 0 }],
      inventario,
    })).toEqual([]);
  });
});
