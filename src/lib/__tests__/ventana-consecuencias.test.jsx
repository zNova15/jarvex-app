// La ventana de consecuencias, DIBUJADA (tanda 3 del destino).
//
// `consecuencias-correccion.test.js` prueba lo que la ventana calcula; esto
// prueba que lo que calcula se puede mostrar sin reventar, con los escenarios
// de verdad. Una ventana que se rompe al abrirse se descubre justo cuando la
// contadora está por guardar — el peor momento.
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { VentanaConsecuencias } from '../../components/jx-ventana-consecuencias.jsx';
import { armarConsecuencias } from '../consecuencias-correccion.js';
import { crearResolvedorDeFamilia } from '../cuenta-de-comprobante.js';
import { claveMapeo } from '../mapeo-insumos.js';

const item = (descripcion, cantidad = 1, precio_unitario = 100) => ({ descripcion, cantidad, precio_unitario });
const mov = (items, extra = {}) => ({
  id: 'm1', clase: 'compra', type: 'cost', destino_contable: 'obra', obra_id: 'o1',
  amount: 118, payment_status: 'pending', company_id: 'emp1', currency: 'PEN',
  date: '2026-08-20', document_number: 'F001-100', description: 'Compra', third_party_name: 'FERRETERIA SAC',
  notas: JSON.stringify({ items_factura: items }),
  ...extra,
});
const familiaDe = crearResolvedorDeFamilia({
  catalogo: [
    { id: 'c-amol', nombre: 'AMOLADORA ANGULAR 4 1/2', familia: '02', company_id: null },
    { id: 'c-cem', nombre: 'CEMENTO PORTLAND TIPO I', familia: '21', company_id: 'emp1' },
    { id: 'c-mant', nombre: 'SERVICIO TECNICO GENERAL', familia: 'S13', company_id: 'emp1' },
  ],
});
const AMOL = claveMapeo('AMOLADORA ANGULAR 4 1/2');

const dibujar = (args, seleccion = null) => {
  const c = armarConsecuencias({ familiaDe, ...args, seleccion });
  return renderToString(
    <VentanaConsecuencias c={c} seleccion={c.seleccion} setSeleccion={() => {}}
      cuentaElegida={args.cambios?.cuenta} moneda={args.mov.currency}/>,
  );
};

describe('la ventana se dibuja en cada escenario', () => {
  it('una clasificación a corregir: dice de dónde salió y qué familias llevan a la cuenta', () => {
    const html = dibujar({ mov: mov([item('AMOLADORA ANGULAR 4 1/2')]), cambios: { cuenta: '656' } });
    expect(html).toContain('De dónde salió');
    expect(html).toContain('AMOLADORA ANGULAR 4 1/2');
    expect(html).toContain('catálogo del grupo');
    expect(html).toContain('No corregir la clasificación');
  });

  it('con la corrección elegida: dice que la cuenta sale sola y qué se corrige', () => {
    const html = dibujar(
      { mov: mov([item('AMOLADORA ANGULAR 4 1/2')]), cambios: { cuenta: '656' } },
      { correcciones: { [AMOL]: '37' } },
    );
    expect(html).toContain('no queda puesta a mano');
    expect(html).toContain('vale para TODAS las empresas');
  });

  it('el destino 94 en una compra de obra: el cambio de tipo y su casilla', () => {
    const html = dibujar({ mov: mov([item('CEMENTO PORTLAND TIPO I')]), cambios: { destino: '94' } });
    expect(html).toContain('Estado de Resultados');
    expect(html).toContain('Corregir también el tipo');
  });

  it('una operación entre empresas: explica por qué el tipo no se toca', () => {
    const html = dibujar({
      mov: mov([item('CEMENTO PORTLAND TIPO I')], { is_intercompany: true }), cambios: { destino: '94' },
    });
    expect(html).toContain('Consolidado');
    expect(html).not.toContain('Corregir también el tipo');
  });

  it('pasar a un activo: los avisos de renta y del destino', () => {
    const html = dibujar({ mov: mov([item('AMOLADORA ANGULAR 4 1/2')]), cambios: { cuenta: '3331' } });
    expect(html).toContain('ACTIVO');
    expect(html).toContain('Ninguna clasificación');
  });

  // 🔴 CAMBIÓ EL 22-set-2026: el aviso queda, la casilla obligatoria no. Ver
  // el comentario en `consecuencias-correccion.js`.
  it('mueve meses presentados: lo dice, con el detalle, y ya no pide una casilla', () => {
    const viejo = mov([item('AMOLADORA ANGULAR 4 1/2')], { id: 'viejo', date: '2026-03-01', document_number: 'F001-7' });
    const html = dibujar(
      { mov: mov([item('AMOLADORA ANGULAR 4 1/2')]), cambios: { cuenta: '656' }, movs: [viejo] },
      { correcciones: { [AMOL]: '37' } },
    );
    expect(html).toContain('meses ya presentados');
    expect(html).toContain('F001-7');
    expect(html).toContain('cierre anual');
    expect(html).not.toContain('Entiendo que cambia');
  });

  it('los del mismo proveedor: cuántos reciben la corrección, incluidos los de meses presentados', () => {
    const html = dibujar({
      mov: mov([item('AMOLADORA ANGULAR 4 1/2')]), cambios: { cuenta: '656' },
      hermanos: [mov([], { id: 'h1', date: '2026-08-02' }), mov([], { id: 'h2', date: '2026-02-02' })],
    });
    expect(html).toContain('Del mismo proveedor');
    expect(html).toContain('también se corrigen');
    expect(html).not.toContain('no se tocan');
  });

  it('un comprobante en dólares muestra dólares, no soles', () => {
    const html = dibujar({ mov: mov([item('CEMENTO PORTLAND TIPO I')], { currency: 'USD' }), cambios: { destino: '94' } });
    expect(html).toContain('US$');
  });

  it('sin nada en c: la ventana no dibuja nada', () => {
    expect(renderToString(<VentanaConsecuencias c={null}/>)).toBe('');
  });
});
