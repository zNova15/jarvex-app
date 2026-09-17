// La pantalla del Plan de Cuentas, renderizada de verdad.
//
// Los tests de `pcge.test.js` garantizan que el catálogo salió bien del PDF;
// éste garantiza que la PANTALLA lo muestra. Son cosas distintas: un dato
// perfecto detrás de un componente que explota es una pantalla en blanco, y en
// esta app eso ya pasó (el modal con letra blanca sobre fondo blanco del
// commit 0639123 llegó a producción por no mirar la pantalla).
//
// Cubre además lo que Gabriel pidió explícitamente el 17-set: que el plan NO
// se pueda editar. Un test que busca los botones viejos es la forma de que no
// vuelvan sin que nadie se dé cuenta.
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

let PlanCuentasPage;

beforeAll(async () => {
  // El módulo hace `Object.assign(window, …)` al cargarse.
  globalThis.window = globalThis.window || globalThis;
  ({ PlanCuentasPage } = await import('../../components/jx-plan-cuentas.jsx'));
});

const render = () => renderToString(<PlanCuentasPage showToast={() => {}} />);

describe('la pantalla se dibuja', () => {
  it('monta sin romperse y se anuncia como el plan oficial', () => {
    const html = render();
    expect(html).toContain('Plan de Cuentas (PCGE)');
    expect(html).toMatch(/Consejo Normativo de\s*Contabilidad/);
  });

  it('dice cuántas cuentas tiene el plan', () => {
    expect(render()).toContain('1,792');
  });

  it('abre mostrando las cuentas de dos dígitos, que es el nivel de trabajo', () => {
    const html = render();
    expect(html).toContain('Gastos de servicios prestados por terceros');   // 63
    expect(html).toContain('Compras');                                      // 60
    expect(html).toContain('Ventas');                                       // 70
  });

  it('no desglosa nada hasta que alguien lo abre', () => {
    // «631 Transporte, correos y gastos de viaje» aparece recién al expandir
    // la 63: arrancar con 1.792 filas abiertas no lo lee nadie.
    expect(render()).not.toContain('Transporte, correos y gastos de viaje');
  });

  it('la flecha de desglose aparece una vez por cuenta que se pueda abrir', () => {
    // 83 cuentas, 81 flechas: «04 Deudoras por contra» y «09 Acreedoras por
    // contra» son las dos únicas cuentas del plan sin subcuentas, y por eso no
    // la muestran.
    //
    // Antes había un botón «+» en TODAS las filas (invisible en las hojas,
    // pero ocupando lugar) y además salía en cuentas cuyo desglose quedaba por
    // debajo del nivel de detalle elegido: se tocaba y no pasaba nada. Lo
    // reportó Gabriel al probar la tanda 1.
    const flechas = (render().match(/▶/g) || []).length;
    expect(flechas).toBe(81);
  });
});

describe('no se puede editar — es la norma, no una lista propia', () => {
  const PROHIBIDOS = [
    'Cargar PCGE default',
    'Cuenta custom',
    'Nueva cuenta custom',
    'Vaciar plan',
  ];

  it.each(PROHIBIDOS)('no ofrece «%s»', (texto) => {
    expect(render()).not.toContain(texto);
  });

  it('lo explica en vez de dejar al usuario buscando el botón', () => {
    expect(render()).toContain('Éste es el plan oficial y no se edita');
  });
});

describe('lo que el grupo necesita a mano', () => {
  it('lista las cuentas del consorcio con su explicación', () => {
    const html = render();
    expect(html).toContain('3027');
    expect(html).toContain('6782');
    expect(html).toContain('7782');
    expect(html).toContain('documento de atribución');
  });

  it('el panel de detalle invita a elegir una cuenta', () => {
    expect(render()).toContain('Elegí una cuenta de la lista');
  });
});
