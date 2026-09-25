import { describe, it, expect } from 'vitest';
import {
  emitirLote, estadoDePreorden, historialDelPlan, estadoDelPlan, MOTIVO_DESCARTE,
} from '../simulador-puente.js';
import { descarteDePreorden } from '../simulador-preordenes.js';
import { aplicarAnulaciones } from '../simulador-ordenes.js';

// ── RONDA 4, TANDA 4.5: EMITIR EN LOTE Y EL ESTADO DE CADA PRE-ORDEN ──
// La ejecutora de Miraflores (CONSORCIO EL INCA) ya tiene órdenes emitidas:
// el lote tiene que seguir su numeración sin repetir ni saltear.

const obra = { id: 'obra', nombre_obra: 'PLAN MIRAFLORES', ejecutora_company_id: 'co-inca', ejecutora_tipo: 'consorcio' };
const company = { id: 'co-inca', name: 'CONSORCIO EL INCA', codigo_doc_prefix: 'EI' };
const previas = [{ id: 'o-prev', company_id: 'co-inca', tipo: 'compra', anio: 2026, correlativo: 4, codigo: 'EI-OC-004-2026', estado: 'recibida' }];

const req = (id, over = {}) => ({
  id, obra_id: 'obra', origen: 'simulador', origen_ref: `2026-10|${id}`, estado: 'borrador',
  descripcion: `Pre-orden ${id}`, fecha: '2026-09-25', fecha_necesidad: '2026-10-01', oc_id: null, ...over,
});
const item = (reqId, over = {}) => ({
  id: `${reqId}-i`, requisicion_id: reqId, insumo_codigo: 'X1', tipo_insumo: 'material',
  nombre: 'CEMENTO', unidad: 'bol', cantidad: 10, precio_estimado: 30, ...over,
});
const pre = (id, { r = {}, it = {}, prov = { nombre: 'FERRETERIA CALDERON' } } = {}) =>
  ({ requisicion: req(id, r), items: [item(id, it)], proveedor: prov });
let n = 0;
const nuevoId = () => `id-${++n}`;
const lote = (preordenes, extra = {}) => emitirLote({
  preordenes, obra, company, ordenes: previas, hoy: '2026-10-03', nuevoId, ...extra,
});

describe('emitirLote', () => {
  it('numera el lote SEGUIDO sobre lo ya emitido, sin repetir número', () => {
    const l = lote([pre('a'), pre('b'), pre('c')]);
    expect(l.resumen.codigos).toEqual(['EI-OC-005-2026', 'EI-OC-006-2026', 'EI-OC-007-2026']);
    expect(new Set(l.emitidas.map(e => e.orden.correlativo)).size).toBe(3);
  });

  it('la que se necesita antes lleva el número más bajo, marcada en el orden que sea', () => {
    const l = lote([
      pre('tarde', { r: { fecha_necesidad: '2026-11-01' } }),
      pre('temprano', { r: { fecha_necesidad: '2026-10-01' } }),
    ]);
    expect(l.emitidas.map(e => e.requisicion.id)).toEqual(['temprano', 'tarde']);
    expect(l.emitidas[0].orden.codigo).toBe('EI-OC-005-2026');
  });

  it('la que no se puede emitir sale con su motivo y NO consume número', () => {
    const l = lote([
      pre('a'),
      pre('b', { prov: null }),                           // sin proveedor
      pre('c', { it: { precio_estimado: null } }),        // sin precios
      pre('d'),
    ]);
    expect(l.rechazadas.map(x => [x.requisicion.id, x.motivo])).toEqual([['b', 'sin_proveedor'], ['c', 'sin_lineas']]);
    expect(l.resumen.codigos).toEqual(['EI-OC-005-2026', 'EI-OC-006-2026']);
  });

  it('la que ya tiene orden no se vuelve a emitir', () => {
    const l = lote([pre('a', { r: { oc_id: 'oc-x', estado: 'ordenada' } }), pre('b')]);
    expect(l.rechazadas[0].motivo).toBe('ya_ordenada');
    expect(l.emitidas.map(e => e.requisicion.id)).toEqual(['b']);
  });

  it('la misma pre-orden marcada dos veces se emite una vez', () => {
    const l = lote([pre('a'), pre('a')]);
    expect(l.emitidas).toHaveLength(1);
  });

  it('compra y servicio llevan su propia numeración', () => {
    const l = lote([
      pre('mat'),
      pre('alq', { it: { tipo_insumo: 'servicio', nombre: 'ALQUILER DE MEZCLADORA', unidad: 'dia' } }),
    ]);
    const cod = Object.fromEntries(l.emitidas.map(e => [e.requisicion.id, e.orden.codigo]));
    expect(cod.mat).toBe('EI-OC-005-2026');
    expect(cod.alq).toBe('EI-OS-001-2026');
  });

  it('solo emite la ejecutora: con otra empresa no sale ninguna', () => {
    const l = lote([pre('a'), pre('b')], { company: { id: 'co-otra', name: 'OTRA' } });
    expect(l.emitidas).toHaveLength(0);
    expect(l.rechazadas.every(x => x.motivo === 'no_es_ejecutora')).toBe(true);
  });

  it('la orden lleva la fecha de HOY (la de emisión), no la de la pre-orden', () => {
    const l = lote([pre('a')]);
    expect(l.emitidas[0].orden.fecha).toBe('2026-10-03');
    expect(l.emitidas[0].orden.fecha_entrega).toBe('2026-10-01');
    expect(l.emitidas[0].orden.estado).toBe('por_confirmar');
  });

  it('cada línea de la orden apunta a la línea de su pre-orden', () => {
    const l = lote([pre('a')]);
    expect(l.emitidas[0].items[0].requisicion_item_id).toBe('a-i');
    expect(l.emitidas[0].orden.requisicion_id).toBe('a');
    expect(l.resumen.monto).toBe(354);   // 300 + IGV
  });
});

describe('estadoDePreorden', () => {
  it('sin orden: pre-orden sin emitir', () => {
    expect(estadoDePreorden({ requisicion: req('a') }).clave).toBe('preorden');
  });
  it('con orden viva: emitida, y dice en qué va', () => {
    const e = estadoDePreorden({
      requisicion: req('a', { oc_id: 'o1', oc_codigo: 'EI-OC-005-2026', estado: 'ordenada' }),
      orden: { id: 'o1', codigo: 'EI-OC-005-2026', estado: 'recibida_parcial', correlativo: 5 },
    });
    expect(e.clave).toBe('emitida');
    expect(e.texto).toBe('Emitida como EI-OC-005-2026 · Recibida parcial');
    expect(e.vuelveAlPlan).toBe(false);
  });
  it('emitida en otra PC y todavía sin bajar: lo dice, no inventa que se anuló', () => {
    const e = estadoDePreorden({ requisicion: req('a', { oc_id: 'o1', oc_codigo: 'EI-OC-005-2026', estado: 'ordenada' }) });
    expect(e.clave).toBe('sin_bajar');
    expect(e.vuelveAlPlan).toBe(false);
  });
  it('orden anulada o borrada: volvió al plan', () => {
    const r = req('a', { oc_id: 'o1', oc_codigo: 'EI-OC-005-2026', estado: 'ordenada' });
    expect(estadoDePreorden({ requisicion: r, orden: { id: 'o1', codigo: 'EI-OC-005-2026', estado: 'anulada' } }))
      .toMatchObject({ clave: 'anulada', vuelveAlPlan: true, texto: 'Orden EI-OC-005-2026 anulada — volvió al plan' });
    expect(estadoDePreorden({ requisicion: r, orden: { id: 'o1', estado: 'por_confirmar', deleted_at: 'x' } }).clave).toBe('anulada');
    // Ya liberada por Órdenes (4.2): cancelada con oc_id de rastro.
    expect(estadoDePreorden({ requisicion: { ...r, estado: 'cancelada' } }).clave).toBe('anulada');
  });
  it('descartada como pre-orden (4.4): volvió al plan, dicho distinto que una anulada', () => {
    const r = req('a');
    const e = estadoDePreorden({ requisicion: { ...r, ...descarteDePreorden(r) } });
    expect(e).toMatchObject({ clave: 'descartada', vuelveAlPlan: true });
    expect(MOTIVO_DESCARTE).toContain('vuelve al plan');
  });
  it('cancelada por otro camino (Compras): no reserva', () => {
    expect(estadoDePreorden({ requisicion: req('a', { estado: 'rechazada' }) })).toMatchObject({ clave: 'cancelada', vuelveAlPlan: true });
  });
});

describe('historialDelPlan', () => {
  it('trae también lo que volvió al plan (estadoDelPlan lo deja afuera) y deja afuera lo que no es del plan', () => {
    const reqs = [
      req('viva'),
      req('anulada', { oc_id: 'o1', oc_codigo: 'EI-OC-005-2026', estado: 'ordenada' }),
      req('descartada', { estado: 'cancelada', motivo_rechazo: MOTIVO_DESCARTE }),
      req('residente', { origen: null }),
    ];
    const ordenes = [{ id: 'o1', codigo: 'EI-OC-005-2026', estado: 'anulada' }];
    const items = reqs.map(r => item(r.id));
    const h = historialDelPlan({ requisiciones: aplicarAnulaciones({ requisiciones: reqs, ordenes }), requisicionItems: items, ordenes });
    expect(h.map(x => [x.requisicion.id, x.estado.clave])).toEqual([
      ['viva', 'preorden'], ['anulada', 'anulada'], ['descartada', 'descartada'],
    ]);
    expect(h[0].monto).toBe(300);
    const vivas = estadoDelPlan({ requisiciones: aplicarAnulaciones({ requisiciones: reqs, ordenes }), requisicionItems: items });
    expect([...vivas.values()].map(v => v.requisicion.id)).toEqual(['viva']);
  });
  it('ordenada solo si la orden está viva', () => {
    const reqs = [req('a', { oc_id: 'o1', estado: 'ordenada' })];
    const h = historialDelPlan({ requisiciones: reqs, requisicionItems: [], ordenes: [{ id: 'o1', codigo: 'X', estado: 'firmada', correlativo: 1 }] });
    expect(h[0].ordenada).toBe(true);
    expect(h[0].orden.id).toBe('o1');
  });
});
