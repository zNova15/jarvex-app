// Tests de «este comprobante, ¿a qué cuenta va?» (cuenta-de-comprobante.js).
//
// Acá se juntan las dos capas: lo que el catálogo de la empresa ya decidió y
// lo que el clasificador IUPC saca del texto. Y se decide el reparto cuando un
// mismo comprobante tiene cosas de naturalezas distintas — que es el 8,8 % de
// los comprobantes de producción, con la segunda cuenta pesando una mediana
// del 23,9 %: demasiado para absorberla.
import { describe, it, expect } from 'vitest';
import {
  crearResolvedorDeFamilia, cuentasDeComprobante, itemsDe, banda, ORIGEN, MINIMO_LINEA,
} from '../cuenta-de-comprobante.js';

const mov = (items, extra = {}) => ({
  id: 'm1', clase: 'compra', type: 'cost', amount: 1000,
  notas: JSON.stringify({ items_factura: items }),
  ...extra,
});
const item = (descripcion, cantidad = 1, precio_unitario = 100) => ({ descripcion, cantidad, precio_unitario });

/** El resolvedor más simple: sin catálogo, solo el clasificador sobre el texto. */
const soloClasificador = () => crearResolvedorDeFamilia({});

describe('leer los ítems del comprobante', () => {
  it('los saca del JSON de notas', () => {
    expect(itemsDe(mov([item('CEMENTO')]))).toHaveLength(1);
  });

  it('acepta notas ya parseadas', () => {
    expect(itemsDe({ notas: { items_factura: [item('CEMENTO')] } })).toHaveLength(1);
  });

  it('no explota con notas rotas, vacías o ausentes', () => {
    expect(itemsDe({ notas: 'no soy json' })).toEqual([]);
    expect(itemsDe({ notas: '' })).toEqual([]);
    expect(itemsDe({})).toEqual([]);
    expect(itemsDe(null)).toEqual([]);
  });
});

describe('EL CASO DE LAS CONTADORAS, de punta a punta', () => {
  it('la F055-6246 de MARVISUR deja de ir a la 60', () => {
    // El ítem real de producción es «TRANSPORTE NACIONAL».
    const r = cuentasDeComprobante(
      mov([item('TRANSPORTE NACIONAL', 1, 31.36)], { amount: 37 }),
      { familiaDe: soloClasificador() },
    );
    expect(r.lineas).toHaveLength(1);
    // `cuenta` es la que se ASIENTA (la subcuenta); `cuentaMadre` es la de
    // dos dígitos, la que la contadora nombra.
    expect(r.lineas[0].cuenta).toBe('631');
    expect(r.lineas[0].cuentaMadre).toBe('63');
    expect(r.provisional).toBe(false);
  });
});

describe('la capa 1 manda: lo que ya decidió una persona', () => {
  const catalogo = [
    { id: 'c1', nombre: 'TRANSPORTE DE MOBILIARIO SEGUN GUIA', norm: null, familia: 'S03', tipo: 'servicio' },
    { id: 'c2', nombre: 'CEMENTO PORTLAND TIPO I', norm: null, familia: '21', tipo: 'insumo' },
  ];

  it('una descripción del catálogo usa SU familia', () => {
    const familiaDe = crearResolvedorDeFamilia({ catalogo });
    const r = cuentasDeComprobante(mov([item('TRANSPORTE DE MOBILIARIO SEGUN GUIA')]), { familiaDe });
    expect(r.lineas[0].cuenta).toBe('631');
    expect(r.origen).toBe(ORIGEN.catalogo);
    expect(r.confianza).toBe('catalogo');
  });

  it('un alias apunta al insumo del catálogo y hereda su familia', () => {
    const familiaDe = crearResolvedorDeFamilia({
      catalogo,
      alias: [{ norm: 'cemento port tipo i', catalogo_insumo_id: 'c2', fuente: 'manual', updated_at: '2026-09-01' }],
    });
    const { familia, origen } = familiaDe('CEMENTO PORT TIPO I');
    expect(familia).toBe('21');
    expect(origen).toBe(ORIGEN.catalogo);
  });

  it('el catálogo le gana al clasificador aunque el texto diga otra cosa', () => {
    // «CEMENTO» lo reconocería el clasificador como 21; acá el catálogo dice
    // que en esta empresa esa descripción es un servicio. Manda el catálogo:
    // es una persona que miró la factura.
    const familiaDe = crearResolvedorDeFamilia({
      catalogo: [{ id: 'x', nombre: 'CEMENTO', norm: null, familia: 'S09', tipo: 'servicio' }],
    });
    expect(familiaDe('CEMENTO').familia).toBe('S09');
  });

  it('una fila del catálogo sin clasificar no cuenta como decisión', () => {
    const familiaDe = crearResolvedorDeFamilia({
      catalogo: [{ id: 'x', nombre: 'ALGO RARISIMO ZZZ', norm: null, familia: 'sin_clasificar' }],
    });
    expect(familiaDe('ALGO RARISIMO ZZZ').origen).not.toBe(ORIGEN.catalogo);
  });
});

describe('la capa 2: el clasificador sobre el texto', () => {
  it('reconoce lo que no está en ningún catálogo', () => {
    const r = cuentasDeComprobante(mov([item('CEMENTO PORTLAND TIPO I 42.5 KG')]), { familiaDe: soloClasificador() });
    expect(r.lineas[0].cuentaMadre).toBe('60');
    expect(r.origen).toBe(ORIGEN.clasificador);
  });

  it('el diccionario propio le gana al oficial', () => {
    // Misma regla que en el resto de la app: una corrección deliberada sobre
    // la norma (regla 8 del CLAUDE.md).
    //
    // OJO con la forma: `terminosCustom` son las filas de
    // `clasificacion_terminos` TAL CUAL salen de la base
    // (`{termino, clasificacion_codigo}`), no un objeto traducido. El
    // clasificador descarta en silencio lo que no tenga esos dos campos, así
    // que un diccionario mal armado no falla: simplemente no se aplica.
    const familiaDe = crearResolvedorDeFamilia({
      terminosCustom: [{ termino: 'CHIRIMPUM', clasificacion_codigo: 'S03', origen: 'manual' }],
    });
    expect(familiaDe('CHIRIMPUM').familia).toBe('S03');
  });

  it('un diccionario con la forma equivocada no rompe nada, solo no aplica', () => {
    const familiaDe = crearResolvedorDeFamilia({ terminosCustom: [{ nombre: 'CHIRIMPUM', cod: 'S03' }] });
    expect(() => familiaDe('CHIRIMPUM')).not.toThrow();
    expect(familiaDe('CHIRIMPUM').familia).toBe(null);
  });

  it('las bandas de confianza son las de la bandeja', () => {
    expect(banda(0.9)).toBe('alta');
    expect(banda(0.6)).toBe('media');
    expect(banda(0.2)).toBe('baja');
  });
});

describe('cuando no se puede saber, se dice', () => {
  it('un comprobante sin ítems sale provisional', () => {
    const r = cuentasDeComprobante({ id: 'x', clase: 'compra', amount: 100 }, { familiaDe: soloClasificador() });
    expect(r.provisional).toBe(true);
    expect(r.revisar).toBe(true);
    expect(r.lineas).toHaveLength(1);
    expect(r.porque ?? r.lineas[0].porque).toMatch(/no tiene detalle/i);
  });

  it('ítems que nadie reconoce salen provisional, no inventados', () => {
    const r = cuentasDeComprobante(mov([item('XKCD ZZZQQ 9999')]), { familiaDe: soloClasificador() });
    expect(r.provisional).toBe(true);
    expect(r.confianza).toBe('ninguna');
    expect(r.lineas[0].familias).toEqual([]);
  });

  it('la cuenta provisional de una venta no es la de una compra', () => {
    const compra = cuentasDeComprobante({ id: 'a', clase: 'compra', amount: 1 }, {});
    const venta = cuentasDeComprobante({ id: 'b', clase: 'venta', amount: 1 }, {});
    expect(compra.lineas[0].cuentaMadre).toBe('60');
    expect(venta.lineas[0].cuentaMadre).toBe('70');
  });

  it('sin resolvedor no explota', () => {
    expect(() => cuentasDeComprobante(mov([item('CEMENTO')]), {})).not.toThrow();
  });
});

describe('el reparto cuando hay varias naturalezas', () => {
  const familiaDe = soloClasificador();

  it('una factura de ferretería se parte entre materiales y herramientas', () => {
    const r = cuentasDeComprobante(mov([
      item('CEMENTO PORTLAND TIPO I', 10, 80),     // 800 → 602 (60)
      item('CARRETILLA BUGGY', 1, 200),            // 200 → 656 (65)
    ], { amount: 1180 }), { familiaDe });
    expect(r.lineas.length).toBeGreaterThan(1);
    expect(r.lineas.map(l => l.cuentaMadre)).toContain('60');
    expect(r.lineas.map(l => l.cuentaMadre)).toContain('65');
  });

  it('las porciones suman exactamente 1', () => {
    const r = cuentasDeComprobante(mov([
      item('CEMENTO PORTLAND', 3, 33.33),
      item('FLETE TERRESTRE', 1, 77.77),
      item('CASCO DE SEGURIDAD', 2, 19.99),
    ]), { familiaDe });
    const suma = r.lineas.reduce((s, l) => s + l.porcion, 0);
    expect(suma).toBeCloseTo(1, 10);
  });

  it('la línea más grande va primero — es por donde se empieza a mirar', () => {
    const r = cuentasDeComprobante(mov([
      item('CASCO DE SEGURIDAD', 1, 50),
      item('CEMENTO PORTLAND TIPO I', 10, 80),
    ]), { familiaDe });
    expect(r.lineas[0].porcion).toBeGreaterThanOrEqual(r.lineas[1]?.porcion ?? 0);
  });

  it('una migaja de menos de un sol se absorbe en la línea mayor', () => {
    const r = cuentasDeComprobante(mov([
      item('CEMENTO PORTLAND TIPO I', 100, 30),   // 3.000
      item('CASCO DE SEGURIDAD', 1, 0.20),        // 0,20 → no merece línea
    ], { amount: 3000.2 }), { familiaDe });
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0].cuentaMadre).toBe('60');
    expect(r.lineas[0].porcion).toBeCloseTo(1, 10);
    expect(MINIMO_LINEA).toBe(1);
  });

  it('si el detalle no trae precios, se reparte en partes iguales', () => {
    // Es lo único honesto: sin importes no hay proporción que calcular, y
    // mandar todo a una cuenta elegida al azar sería peor.
    const r = cuentasDeComprobante(mov([
      { descripcion: 'CEMENTO PORTLAND TIPO I' },
      { descripcion: 'FLETE TERRESTRE' },
    ], { amount: 0 }), { familiaDe });
    expect(r.lineas).toHaveLength(2);
    r.lineas.forEach(l => expect(l.porcion).toBeCloseTo(0.5, 10));
  });
});

describe('la confianza que se reporta es la PEOR, no la mejor', () => {
  it('un ítem del catálogo y otro adivinado reportan «clasificador»', () => {
    const familiaDe = crearResolvedorDeFamilia({
      catalogo: [{ id: 'c', nombre: 'CEMENTO PORTLAND TIPO I', norm: null, familia: '21' }],
    });
    const r = cuentasDeComprobante(mov([
      item('CEMENTO PORTLAND TIPO I', 10, 80),
      item('FLETE TERRESTRE DE MATERIALES', 1, 200),
    ]), { familiaDe });
    expect(r.origen).toBe(ORIGEN.clasificador);
  });

  it('un ítem sin reconocer marca el comprobante para revisar', () => {
    const r = cuentasDeComprobante(mov([
      item('CEMENTO PORTLAND TIPO I', 10, 80),
      item('XKCD ZZZQQ 9999', 1, 10),
    ]), { familiaDe: soloClasificador() });
    expect(r.itemsSinResolver).toBe(1);
    expect(r.revisar).toBe(true);
    expect(r.provisional).toBe(false);   // lo que sí se reconoció, vale
  });
});

describe('ventas', () => {
  it('el mismo ítem va a otra cuenta si se vende', () => {
    const items = [item('CEMENTO PORTLAND TIPO I', 10, 80)];
    const compra = cuentasDeComprobante(mov(items), { familiaDe: soloClasificador() });
    const venta = cuentasDeComprobante(mov(items, { clase: 'venta', type: 'income' }), { familiaDe: soloClasificador() });
    expect(compra.lineas[0].cuentaMadre).toBe('60');
    expect(venta.lineas[0].cuentaMadre).toBe('70');
  });
});
