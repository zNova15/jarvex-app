// ═══════════════════════════════════════════════════════════════════
// ¿QUÉ DICE la pestaña «Ya pedido» del simulador? (ronda 4, tanda 4.4)
//
// La lista se carga de Dexie en un efecto, que el render del servidor no
// corre; por eso se montan los componentes directo con sus props. Lo que se
// protege: que la pre-orden se pueda corregir ACÁ (antes decía «desde
// Compras», donde no se puede), que el editor muestre el factor al lado de la
// unidad y que «Descartar» esté a la vista.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

let mod;

function montarBrowserFalso() {
  const g = globalThis;
  g.window = g;
  g.addEventListener = () => {}; g.removeEventListener = () => {};
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.JxIcon = () => null;
  g.__fecha = { hoyLocal: () => '2026-09-25', getTZ: () => 'America/Lima' };
  g.__hooks = g.__hooks || {};
}

const req = {
  id: 'rq1', obra_id: 'o1', origen: 'simulador', origen_ref: '2026-10|tuberia', estado: 'borrador',
  descripcion: 'Tubería — octubre 2026', fecha: '2026-09-25', fecha_necesidad: '2026-10-01', oc_id: null,
};
const items = [
  { id: 'it1', requisicion_id: 'rq1', insumo_codigo: '210030001', tipo_insumo: 'material',
    nombre: 'TUBERIA PVC 4" x 6m', unidad: 'tubo', cantidad: 28, precio_estimado: 72, factor_presupuesto: 6,
    notas: 'Proveedor sugerido: PLASTICOS SAC' },
  { id: 'it2', requisicion_id: 'rq1', insumo_codigo: null, tipo_insumo: 'material',
    nombre: 'CODO PVC 4"', unidad: 'und', cantidad: 10, precio_estimado: null, fecha_entrega: '2026-10-15' },
];
const f = { requisicion: req, items, monto: 28 * 72, ordenada: false };
const insumoDe = (cod) => (cod === '210030001' ? { codigo: cod, nombre: 'TUBERIA PVC 4"', unidad: 'm' } : null);

beforeAll(async () => {
  montarBrowserFalso();
  mod = await import('../../components/jx-simulador-ordenes.jsx');
});

describe('Ya pedido: las pre-órdenes', () => {
  const lista = (extra = {}) => renderToString(React.createElement(mod.DocumentosVista, {
    yaEscrito: new Map([[req.origen_ref, f]]), ordenes: [], titular: { name: 'CONSORCIO EL INCA' },
    permiso: { ok: true }, emitiendo: null, onEmitir() {}, guardando: null, onGuardar() {}, onDescartar() {},
    insumoDe, compras: {}, hoy: '2026-09-25', ...extra,
  }));

  it('dice que se corrigen ACÁ, no «desde Compras» (donde no se puede)', () => {
    const html = lista();
    expect(html).toContain('se corrige acá');
    expect(html).not.toContain('desde Compras');
    expect(html).toContain('pre-orden · sin emitir');
  });

  it('la tarjeta dice el proveedor elegido', () => {
    const r2 = { ...req, proveedor_nombre: 'NICOLL PERU' };
    const html = lista({ yaEscrito: new Map([[req.origen_ref, { ...f, requisicion: r2 }]]) });
    expect(html).toContain('a NICOLL PERU');
  });
});

describe('el editor de la pre-orden', () => {
  const editor = () => renderToString(React.createElement(mod.PreordenEditor, {
    f, insumoDe, compras: {}, hoy: '2026-09-25', ocupado: false,
    onGuardar() {}, onCancelar() {}, onDescartar() {},
  }));

  it('trae cabecera y líneas con sus valores', () => {
    const html = editor();
    expect(html).toContain('Tubería — octubre 2026');
    expect(html).toContain('2026-10-01');
    expect(html).toContain('PLASTICOS SAC');     // el sugerido, hasta que se elija otro
    expect(html).toContain('2026-10-15');        // la fecha propia de la línea
  });

  it('muestra el factor al lado de la unidad y la equivalencia en unidades del presupuesto', () => {
    const html = editor();
    expect(html).toMatch(/value="6"/);
    expect(html).toContain('= 168 m del presupuesto');
  });

  it('la línea sin código dice que no se descuenta, y no ofrece factor', () => {
    const html = editor();
    expect(html).toContain('sin código (no se descuenta del plan)');
  });

  it('avisa la línea sin precio y ofrece Guardar, Cancelar y Descartar', () => {
    const html = editor();
    expect(html).toContain('no tiene precio');
    expect(html).toContain('Guardar');
    expect(html).toContain('Cancelar');
    expect(html).toContain('Descartar pre-orden');
    expect(html).toContain('vuelve al plan');
  });
});
