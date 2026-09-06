import { describe, it, expect } from 'vitest';
import {
  textosDeTipo, prefijoDeOrden, siguienteCorrelativo, formatearCodigo, proximoCodigo,
  totalesDesdeItems, totalesDesdeTotal, repartirSobreItems,
  necesitaOrden, comprobantesSinOrden, agruparPorEmpresa, resumenRespaldo,
  tipoSugerido, igvSugeridoDesdeItems, borradorDesdeMovimiento, recalcularBorrador,
  ordenarParaEmitir, UMBRAL_POR_DEFECTO,
} from '../ordenes.js';

// Datos de producción: el modelo que dejó Gabriel es del CONSORCIO EL INCA,
// OC-027-2026, proveedor JARVEX, 48 ítems, 21.174,00 + 3.811,32 = 24.985,32.
const INCA = { id: 'c-inca', name: 'CONSORCIO EL INCA', codigo_doc_prefix: null };
const JARVEX = { id: 'c-jarvex', name: 'JARVEX INGENIERIA', codigo_doc_prefix: 'JVX' };

const orden = (o = {}) => ({ id: 'o1', company_id: INCA.id, tipo: 'compra', anio: 2026, correlativo: 1, estado: 'enviada', ...o });
const mov = (o = {}) => ({ id: 'm1', company_id: INCA.id, type: 'cost', currency: 'PEN', amount: 5000, date: '2026-05-04', ...o });
// Comprobante con ítems de items_factura (Captura Mágica), como los que
// mide § 9 del doc de la tanda 7 sobre los 204/123 comprobantes reales.
const movConItems = (items, o = {}) => mov({ ...o, notas: JSON.stringify({ items_factura: items }) });
const item = (o = {}) => ({ descripcion: 'ítem', cantidad: 1, precio_unitario: 100, tipo_insumo: 'material', ...o });

describe('textos por tipo', () => {
  it('la orden de servicio solo cambia el rótulo, no el cuerpo', () => {
    expect(textosDeTipo('compra').titulo).toBe('ORDEN DE COMPRA');
    expect(textosDeTipo('servicio').titulo).toBe('ORDEN DE SERVICIO');
    expect(textosDeTipo('servicio').columnaDescripcion).toBe('Descripción del servicio');
    expect(textosDeTipo('servicio').total).toBe('IMPORTE TOTAL DEL SERVICIO');
  });
  it('un tipo desconocido cae en compra en vez de romper el PDF', () => {
    expect(textosDeTipo(undefined).prefijo).toBe('OC');
    expect(textosDeTipo('vaya').prefijo).toBe('OC');
  });
});

describe('correlativo por empresa, tipo y año', () => {
  it('numera por empresa: JARVEX no hereda el 27 del CONSORCIO', () => {
    const ords = [orden({ correlativo: 27 })];
    expect(siguienteCorrelativo(ords, { companyId: INCA.id, tipo: 'compra', anio: 2026 })).toBe(28);
    expect(siguienteCorrelativo(ords, { companyId: JARVEX.id, tipo: 'compra', anio: 2026 })).toBe(1);
  });

  it('numera por tipo: la OS arranca en 1 aunque haya 27 OC', () => {
    const ords = [orden({ correlativo: 27 })];
    expect(siguienteCorrelativo(ords, { companyId: INCA.id, tipo: 'servicio', anio: 2026 })).toBe(1);
  });

  it('numera por año: en 2027 se vuelve a empezar', () => {
    const ords = [orden({ correlativo: 27 })];
    expect(siguienteCorrelativo(ords, { companyId: INCA.id, tipo: 'compra', anio: 2027 })).toBe(1);
  });

  it('una orden ANULADA no libera su número', () => {
    // Reusarlo daría dos documentos distintos con el mismo N°.
    const ords = [orden({ correlativo: 27, estado: 'anulada' })];
    expect(siguienteCorrelativo(ords, { companyId: INCA.id, tipo: 'compra', anio: 2026 })).toBe(28);
  });

  it('toma el MÁXIMO, no la cantidad de filas (con huecos no repite)', () => {
    const ords = [orden({ id: 'a', correlativo: 1 }), orden({ id: 'b', correlativo: 9 })];
    expect(siguienteCorrelativo(ords, { companyId: INCA.id, tipo: 'compra', anio: 2026 })).toBe(10);
  });

  it('ignora las borradas y deduce el año de la fecha si falta `anio`', () => {
    const ords = [
      orden({ id: 'a', correlativo: 40, deleted_at: '2026-01-01' }),
      orden({ id: 'b', correlativo: 5, anio: null, fecha: '2026-03-01' }),
    ];
    expect(siguienteCorrelativo(ords, { companyId: INCA.id, tipo: 'compra', anio: 2026 })).toBe(6);
  });

  it('formatea como el modelo: OC-027-2026', () => {
    expect(formatearCodigo(27, { company: INCA, tipo: 'compra', anio: 2026 })).toBe('OC-027-2026');
    expect(formatearCodigo(1, { company: INCA, tipo: 'servicio', anio: 2026 })).toBe('OS-001-2026');
  });

  it('usa codigo_doc_prefix de la empresa cuando existe', () => {
    expect(prefijoDeOrden(JARVEX, 'compra')).toBe('JVX-OC');
    expect(formatearCodigo(3, { company: JARVEX, tipo: 'compra', anio: 2026 })).toBe('JVX-OC-003-2026');
  });

  it('proximoCodigo devuelve correlativo, año y código de una sola llamada', () => {
    const r = proximoCodigo([orden({ correlativo: 26 })], { company: INCA, tipo: 'compra', anio: 2026 });
    expect(r).toEqual({ correlativo: 27, anio: 2026, codigo: 'OC-027-2026' });
  });
});

describe('totales', () => {
  it('desde ítems suma valor de venta y agrega IGV (el caso del modelo)', () => {
    const items = [
      { cantidad: 40, precio_unitario: 45 },    // 1.800,00
      { cantidad: 40, precio_unitario: 60 },    // 2.400,00
      { cantidad: 18, precio_unitario: 250 },   // 4.500,00
    ];
    const t = totalesDesdeItems(items);
    expect(t.valorVenta).toBe(8700);
    expect(t.igv).toBe(1566);
    expect(t.total).toBe(10266);
  });

  it('respeta el subtotal explícito del ítem si viene', () => {
    const t = totalesDesdeItems([{ cantidad: 1, precio_unitario: 999, subtotal: 100 }]);
    expect(t.valorVenta).toBe(100);
  });

  it('desde un total ya emitido despeja hacia atrás y NO infla la factura', () => {
    const t = totalesDesdeTotal(24985.32);
    expect(t.total).toBe(24985.32);
    expect(t.valorVenta).toBe(21174);
    expect(t.igv).toBe(3811.32);
  });

  it('con IGV 0 (recibo por honorarios) no inventa impuesto', () => {
    const t = totalesDesdeTotal(5000, { igvPct: 0 });
    expect(t).toEqual({ valorVenta: 5000, igv: 0, total: 5000, igvPct: 0 });
  });

  it('valor de venta + IGV siempre cierra exacto contra el total', () => {
    for (const total of [2000.01, 3333.33, 7777.77, 19999.99, 1234567.89]) {
      const t = totalesDesdeTotal(total);
      expect(Math.round((t.valorVenta + t.igv) * 100) / 100).toBe(Math.round(total * 100) / 100);
    }
  });
});

describe('repartirSobreItems', () => {
  it('los ítems repartidos vuelven a sumar EXACTO el valor de venta', () => {
    const items = [{ cantidad: 1, precio_unitario: 1 }, { cantidad: 1, precio_unitario: 1 }, { cantidad: 1, precio_unitario: 1 }];
    const out = repartirSobreItems(items, 100);
    expect(out.reduce((s, i) => s + i.subtotal, 0)).toBe(100);
  });

  it('reparte proporcional al peso de cada ítem', () => {
    const items = [{ subtotal: 30 }, { subtotal: 70 }];
    const out = repartirSobreItems(items, 200);
    expect(out.map(i => i.subtotal)).toEqual([60, 140]);
  });

  it('con todos los pesos en cero reparte en partes iguales y cierra', () => {
    const out = repartirSobreItems([{ subtotal: 0 }, { subtotal: 0 }, { subtotal: 0 }], 10);
    expect(out.reduce((s, i) => s + i.subtotal, 0)).toBe(10);
  });

  it('sin ítems no explota', () => {
    expect(repartirSobreItems([], 100)).toEqual([]);
    expect(repartirSobreItems(null, 100)).toEqual([]);
  });
});

describe('necesitaOrden', () => {
  it('una compra en soles por encima del umbral sí', () => {
    expect(necesitaOrden(mov({ amount: 2000.01 }))).toBe(true);
  });
  it('justo en el umbral no (el umbral es exclusivo)', () => {
    expect(necesitaOrden(mov({ amount: 2000 }))).toBe(false);
  });
  it('una VENTA no: esa orden la emite el cliente, no nosotros', () => {
    expect(necesitaOrden(mov({ type: 'income', amount: 99999 }))).toBe(false);
  });
  it('un gasto sí — también es una compra', () => {
    expect(necesitaOrden(mov({ type: 'expense', amount: 5000 }))).toBe(true);
  });
  it('en dólares no: el umbral está en soles y se evalúa aparte', () => {
    expect(necesitaOrden(mov({ currency: 'USD', amount: 99999 }))).toBe(false);
  });
  it('ya vinculada a una orden, no', () => {
    expect(necesitaOrden(mov({ orden_compra_id: 'o1' }))).toBe(false);
  });
  it('borrada, no', () => {
    expect(necesitaOrden(mov({ deleted_at: '2026-01-01' }))).toBe(false);
  });
  it('el umbral es configurable', () => {
    expect(necesitaOrden(mov({ amount: 5000 }), { umbral: 10000 })).toBe(false);
  });
});

describe('comprobantesSinOrden', () => {
  it('descuenta los que ya tienen orden por CUALQUIERA de los dos lados', () => {
    const movs = [mov({ id: 'a', amount: 9000 }), mov({ id: 'b', amount: 8000 }), mov({ id: 'c', amount: 7000, orden_compra_id: 'x' })];
    const ords = [orden({ id: 'o-b', accounting_movement_id: 'b' })];
    expect(comprobantesSinOrden(movs, ords).map(m => m.id)).toEqual(['a']);
  });

  it('una orden ANULADA no cuenta como respaldo — el comprobante vuelve a la lista', () => {
    const movs = [mov({ id: 'a', amount: 9000 })];
    const ords = [orden({ id: 'o-a', accounting_movement_id: 'a', estado: 'anulada' })];
    expect(comprobantesSinOrden(movs, ords).map(m => m.id)).toEqual(['a']);
  });

  it('ordena por monto: lo caro primero', () => {
    const movs = [mov({ id: 'a', amount: 3000 }), mov({ id: 'b', amount: 90000 }), mov({ id: 'c', amount: 9000 })];
    expect(comprobantesSinOrden(movs, []).map(m => m.id)).toEqual(['b', 'c', 'a']);
  });

  it('acota por empresa cuando se pide', () => {
    const movs = [mov({ id: 'a', amount: 9000 }), mov({ id: 'b', amount: 8000, company_id: JARVEX.id })];
    expect(comprobantesSinOrden(movs, [], { companyId: JARVEX.id }).map(m => m.id)).toEqual(['b']);
  });

  // Tanda 6: la misma pantalla abierta desde el workspace de un trabajo.
  it('acota por OBRA cuando se pide, sin mirar de qué empresa es', () => {
    const movs = [
      mov({ id: 'a', amount: 9000, obra_id: 'mira' }),
      mov({ id: 'b', amount: 8000, obra_id: 'mira', company_id: JARVEX.id }),
      mov({ id: 'c', amount: 7000, obra_id: 'sanmarcos' }),
      mov({ id: 'd', amount: 6000 }),   // sin obra: gasto de empresa, no de la obra
    ];
    // Los DOS de Miraflores, aunque uno sea de JARVEX y no del titular: es la
    // cadena intercompany, y acotar por titular escondería 3 de cada 4.
    expect(comprobantesSinOrden(movs, [], { obraId: 'mira' }).map(m => m.id)).toEqual(['a', 'b']);
  });

  it('obra y empresa se combinan con AND', () => {
    const movs = [
      mov({ id: 'a', amount: 9000, obra_id: 'mira' }),
      mov({ id: 'b', amount: 8000, obra_id: 'mira', company_id: JARVEX.id }),
    ];
    expect(comprobantesSinOrden(movs, [], { obraId: 'mira', companyId: JARVEX.id }).map(m => m.id)).toEqual(['b']);
  });
});

describe('agruparPorEmpresa', () => {
  it('agrupa, suma y ordena por monto', () => {
    const movs = [
      mov({ id: 'a', amount: 1000 }),
      mov({ id: 'b', amount: 5000, company_id: JARVEX.id }),
      mov({ id: 'c', amount: 500 }),
    ];
    const g = agruparPorEmpresa(movs, [INCA, JARVEX]);
    expect(g.map(x => [x.nombre, x.monto])).toEqual([
      ['JARVEX INGENIERIA', 5000],
      ['CONSORCIO EL INCA', 1500],
    ]);
  });

  it('los movimientos sin empresa no se pierden', () => {
    const g = agruparPorEmpresa([mov({ company_id: null, amount: 10 })], [INCA]);
    expect(g[0].nombre).toBe('Sin empresa');
    expect(g[0].companyId).toBeNull();
  });
});

describe('resumenRespaldo', () => {
  it('cuenta lo que está sobre el umbral y qué parte tiene respaldo', () => {
    const movs = [
      mov({ id: 'a', amount: 10000 }),
      mov({ id: 'b', amount: 30000 }),
      mov({ id: 'c', amount: 100 }),          // bajo el umbral: no cuenta
      mov({ id: 'd', type: 'income', amount: 50000 }), // venta: no cuenta
    ];
    const ords = [orden({ accounting_movement_id: 'a' })];
    const r = resumenRespaldo(movs, ords);
    expect(r.sobreUmbral).toBe(2);
    expect(r.montoSobreUmbral).toBe(40000);
    expect(r.sinRespaldo).toBe(1);
    expect(r.montoSinRespaldo).toBe(30000);
    expect(r.respaldados).toBe(1);
    expect(r.montoRespaldado).toBe(10000);
    expect(r.pctRespaldado).toBe(25);
  });

  it('sin nada sobre el umbral no divide por cero', () => {
    expect(resumenRespaldo([], []).pctRespaldado).toBe(0);
  });

  it('la barra del respaldo también se acota a la obra', () => {
    const movs = [
      mov({ id: 'a', amount: 10000, obra_id: 'mira' }),
      mov({ id: 'b', amount: 90000, obra_id: 'sanmarcos' }),
    ];
    const r = resumenRespaldo(movs, [], { obraId: 'mira' });
    expect(r.sobreUmbral).toBe(1);
    expect(r.montoSobreUmbral).toBe(10000);
    expect(r.montoSinRespaldo).toBe(10000);
  });

  it('usa el umbral por defecto documentado', () => {
    expect(UMBRAL_POR_DEFECTO).toBe(2000);
    expect(resumenRespaldo([mov({ amount: 2500 })], []).umbral).toBe(2000);
  });
});

describe('tipoSugerido', () => {
  it('detecta servicio por la clase, la categoría o la descripción — SIN ítems', () => {
    expect(tipoSugerido({ clase: 'Servicios de terceros' })).toBe('servicio');
    expect(tipoSugerido({ category: 'Alquiler de maquinaria' })).toBe('servicio');
    expect(tipoSugerido({ description: 'MANTENIMIENTO DE VOLQUETE' })).toBe('servicio');
    expect(tipoSugerido({ description: 'Flete de agregados' })).toBe('servicio');
  });
  it('cae en compra cuando no hay señal (el caso mayoritario)', () => {
    expect(tipoSugerido({ description: 'FIERRO CORRUGADO DE 1/2"' })).toBe('compra');
    expect(tipoSugerido({})).toBe('compra');
    expect(tipoSugerido(null)).toBe('compra');
  });

  // 🔴 Bloqueante B-1 de la tanda 5, cerrado en la tanda 7: medido sobre
  // producción, 11 de 204 comprobantes >umbral traían BIENES en sus ítems
  // pero el texto (a menudo el nombre del proveedor) los tipaba «servicio».
  it('los ÍTEMS mandan: un bien es compra aunque el proveedor se llame TRANSPORTES', () => {
    const m = movConItems([item({ tipo_insumo: 'material' })], { description: 'TRANSPORTES DEL SUR S.A.C.' });
    expect(tipoSugerido(m)).toBe('compra');
  });
  it('con un solo bien entre varios ítems ya alcanza — no hace falta que sean todos', () => {
    const m = movConItems([item({ tipo_insumo: 'servicio' }), item({ tipo_insumo: 'herramienta' })],
      { description: 'ALQUILER Y VENTA S.A.C.' });
    expect(tipoSugerido(m)).toBe('compra');
  });
  it('todos los ítems servicio → servicio, aunque el texto no diga nada', () => {
    const m = movConItems([item({ tipo_insumo: 'servicio' }), item({ tipo_insumo: 'servicio' })],
      { description: 'FACTURA 001-234' });
    expect(tipoSugerido(m)).toBe('servicio');
  });
  it('ítems sin tipo_insumo clasificado cae al texto (no se inventa nada)', () => {
    const m = movConItems([{ descripcion: 'x', cantidad: 1, precio_unitario: 10 }], { description: 'ALQUILER DE ANDAMIOS' });
    expect(tipoSugerido(m)).toBe('servicio');
  });
  it('comprobante sin items_factura sigue decidiendo por texto, sin romper', () => {
    expect(tipoSugerido(mov({ notas: '', description: 'CEMENTO' }))).toBe('compra');
    expect(tipoSugerido(mov({ notas: 'esto no es json', description: 'FLETE' }))).toBe('servicio');
  });
});

describe('igvSugeridoDesdeItems', () => {
  // 🔴 Bloqueante B-2 de la tanda 5, cerrado en la tanda 7: medido sobre 123
  // comprobantes >umbral con ítems, 117 son coherentes con IGV 18% (suma de
  // ítems ≈ total/1,18) y 3 tienen la suma de ítems IGUAL al total —
  // operaciones sin IGV que el 18% por defecto subvaluaba 15,25%.
  it('detecta la operación SIN IGV: la suma de ítems ya es el total', () => {
    const m = movConItems([item({ cantidad: 1, precio_unitario: 5000 })], { amount: 5000 });
    expect(igvSugeridoDesdeItems(m)).toBe(0);
  });
  it('NO toca nada cuando la suma es coherente con 18% (el caso mayoritario)', () => {
    // 21.174 (valor de venta) × 1,18 = 24.985,32 — el modelo real de Gabriel.
    const m = movConItems([item({ cantidad: 1, precio_unitario: 21174 })], { amount: 24985.32 });
    expect(igvSugeridoDesdeItems(m)).toBeNull();
  });
  it('tolera el redondeo por céntimo del prorrateo, no lo confunde con "sin IGV"', () => {
    const m = movConItems([item({ cantidad: 3, precio_unitario: 1666.67 })], { amount: 5000.01 });
    expect(igvSugeridoDesdeItems(m)).toBe(0);
  });
  it('sin ítems, o sin monto, no puede afirmar nada — null, nunca 0 por defecto', () => {
    expect(igvSugeridoDesdeItems(mov({ notas: '' }))).toBeNull();
    expect(igvSugeridoDesdeItems(movConItems([item()], { amount: 0 }))).toBeNull();
    expect(igvSugeridoDesdeItems(null)).toBeNull();
  });
});

describe('borradorDesdeMovimiento', () => {
  it('prellena empresa, proveedor, fecha y totales sin inflar el comprobante', () => {
    const b = borradorDesdeMovimiento(mov({
      amount: 24985.32, third_party_name: 'JARVEX INGENIERIA', third_party_ruc: '20615646505',
      description: 'FIERRO Y ALAMBRE', document_type: 'factura', document_number: 'F001-123',
    }), { company: INCA, obra: { nombre_obra: 'Plan Miraflores' } });
    expect(b.company_id).toBe(INCA.id);
    expect(b.total).toBe(24985.32);
    expect(b.valorVenta).toBe(21174);
    expect(b.igv).toBe(3811.32);
    expect(b.tipo).toBe('compra');
    expect(b.proveedor_ruc).toBe('20615646505');
    expect(b.documento).toBe('factura F001-123');
    expect(b.obra_descripcion).toBe('Plan Miraflores');
    expect(b.incluir).toBe(true);
  });

  it('un recibo por honorarios no lleva IGV', () => {
    const b = borradorDesdeMovimiento(mov({ amount: 5000, document_type: 'recibo_honorarios' }));
    expect(b.igvPct).toBe(0);
    expect(b.valorVenta).toBe(5000);
    expect(b.igv).toBe(0);
  });

  it('un servicio trae la unidad del documento de servicio', () => {
    const b = borradorDesdeMovimiento(mov({ description: 'ALQUILER DE EXCAVADORA' }));
    expect(b.tipo).toBe('servicio');
    expect(b.unidad).toBe('SERV');
  });

  // 🔴 Bloqueante B-2: una operación cuyos ítems ya suman el total (exonerada
  // o inafecta) ya no se infla al 18% — antes SOLO se detectaba por
  // document_type === 'recibo_honorarios', que no cubría este caso.
  it('una operación sin IGV detectada por los ítems no se infla al 18%', () => {
    const b = borradorDesdeMovimiento(movConItems([item({ cantidad: 1, precio_unitario: 5000 })], { amount: 5000 }));
    expect(b.igvPct).toBe(0);
    expect(b.valorVenta).toBe(5000);
    expect(b.igv).toBe(0);
  });
  // Un bien tipado por sus ítems también corrige el `tipo` de la orden.
  it('el tipo Y el IGV se corrigen juntos cuando el texto engañaba', () => {
    const b = borradorDesdeMovimiento(movConItems(
      [item({ tipo_insumo: 'material', cantidad: 1, precio_unitario: 5000 })],
      { amount: 5000, description: 'TRANSPORTES DEL SUR S.A.C.' },
    ));
    expect(b.tipo).toBe('compra');
    expect(b.igvPct).toBe(0);
  });

  it('recalcular tras editar el monto rehace valor de venta e IGV', () => {
    const b = recalcularBorrador({ total: 11800, igvPct: 18 });
    expect(b.valorVenta).toBe(10000);
    expect(b.igv).toBe(1800);
  });
});

describe('ordenarParaEmitir', () => {
  // 🔴 Bloqueante B-3 de la tanda 5, cerrado en la tanda 7: el lote llegaba
  // ordenado por MONTO (el orden de `comprobantesSinOrden`, correcto para
  // MIRAR la lista) y se emitía en ese mismo orden — la OC-001 se la llevaba
  // el comprobante más caro, no el más antiguo.
  it('reordena por fecha ascendente, sin importar el orden de entrada por monto', () => {
    const caro = { movimiento_id: 'm-caro', fecha: '2026-08-20', total: 90000 };
    const viejo = { movimiento_id: 'm-viejo', fecha: '2026-01-05', total: 500 };
    const medio = { movimiento_id: 'm-medio', fecha: '2026-04-10', total: 5000 };
    const out = ordenarParaEmitir([caro, viejo, medio]);   // entra por monto desc
    expect(out.map(b => b.movimiento_id)).toEqual(['m-viejo', 'm-medio', 'm-caro']);
  });
  it('una fecha vacía va al final: no se puede ordenar un dato que no está', () => {
    const sinFecha = { movimiento_id: 'm-sf', fecha: null };
    const conFecha = { movimiento_id: 'm-cf', fecha: '2026-03-01' };
    expect(ordenarParaEmitir([sinFecha, conFecha]).map(b => b.movimiento_id)).toEqual(['m-cf', 'm-sf']);
  });
  it('no muta el array de entrada — la grilla por monto sigue viéndose igual', () => {
    const lista = [{ movimiento_id: 'b', fecha: '2026-02-01' }, { movimiento_id: 'a', fecha: '2026-01-01' }];
    const copia = [...lista];
    ordenarParaEmitir(lista);
    expect(lista).toEqual(copia);
  });
  it('vacío o nulo no explota', () => {
    expect(ordenarParaEmitir([])).toEqual([]);
    expect(ordenarParaEmitir(null)).toEqual([]);
  });
});
