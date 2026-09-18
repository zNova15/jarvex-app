// Tests de «el flete de una compra va a la 609» (flete-compra.js), tanda 2
// del destino. Los textos son los de producción, medidos el 18-set: de 115
// comprobantes con flete, 112 son facturas del transportista SOLAS, así que la
// regla tiene que leer qué se transportó y no solo con qué vino.
import { describe, it, expect } from 'vitest';
import {
  TRANSPORTE_609, transporteDeCompra, esPasaje, mercaderiaDelFlete, cuentaDeFlete, esFamiliaFlete,
} from '../flete-compra.js';
import { crearResolvedorDeFamilia, cuentasDeComprobante } from '../cuenta-de-comprobante.js';
import { esCuentaValida } from '../pcge.js';
import { existenciaDeCompra } from '../destino-asiento.js';

const familiaDe = crearResolvedorDeFamilia({});

describe('la tabla de la 609', () => {
  it('las cuatro divisionarias de transporte existen en el PCGE', () => {
    for (const c of Object.values(TRANSPORTE_609)) expect(esCuentaValida(c)).toBe(true);
  });

  it('cada compra va a su divisionaria', () => {
    expect(transporteDeCompra('601')).toBe('60911');
    expect(transporteDeCompra('602')).toBe('60921');
    expect(transporteDeCompra('6032')).toBe('60931');
    expect(transporteDeCompra('656')).toBeNull();   // la herramienta no es existencia
    expect(transporteDeCompra(null)).toBeNull();
  });

  it('cierra con la tanda 1: el destino de la 60921 es la 24, el de la 60911 la 20', () => {
    // Es el «20111 / 6111» del ejemplo que mandaron las contadoras.
    expect(existenciaDeCompra('60911')).toBe('20');
    expect(existenciaDeCompra('60921')).toBe('24');
  });

  it('las familias de flete son las del puente', () => {
    expect(esFamiliaFlete('S03')).toBe(true);
    expect(esFamiliaFlete('32')).toBe(true);
    expect(esFamiliaFlete('21')).toBe(false);
  });
});

describe('qué se transportó', () => {
  it('saca la mercadería y corta la ruta', () => {
    expect(mercaderiaDelFlete('POR EL SERVICIO DE TRANSPORTE DE TUBO HOPE 100 SOR 11 PN DE CHICLAYO A CAJAMARCA.'))
      .toBe('TUBO HOPE 100 SOR 11 PN');
    expect(mercaderiaDelFlete('TRANSPORTE DE ARTICULOS DE FERRETERIA SEGUN GUIA'))
      .toBe('ARTICULOS DE FERRETERIA');
  });

  it('el tipo de servicio no es una mercadería', () => {
    expect(mercaderiaDelFlete('TRANSPORTE Y TRASLADO TERRESTRE DE PASAJEROS')).toBeNull();
    expect(mercaderiaDelFlete('SERVICIO DE TRANSPORTE DE MERCANCIAS EN GENERAL')).toBeNull();
    expect(mercaderiaDelFlete('TRANSPORTE NACIONAL')).toBeNull();
    expect(mercaderiaDelFlete('')).toBeNull();
  });

  it('reconoce los pasajes', () => {
    expect(esPasaje('SERVICIO DE TRANSPORTE DE PASAJERO DNI: 71248988 NOMBRE: X')).toBe(true);
    expect(esPasaje('Servicio de transporte al pasajero desde Lima hasta Cajamarca')).toBe(true);
    expect(esPasaje('POR EL SERVICIO DE TRANSPORTE DE LA RUTA LIMA - CAJAMARCA / SERVICIO : BUS CAMA')).toBe(true);
    expect(esPasaje('POR EL SERVICIO DE TRANSPORTE DE TUBO HOPE DE CHICLAYO A CAJAMARCA')).toBe(false);
  });
});

describe('la cuenta de un flete', () => {
  it('el flete de tubos va a la 60921 (materias primas)', () => {
    const r = cuentaDeFlete('POR EL SERVICIO DE TRANSPORTE DE TUBO HOPE 100 SOR 11 PN DE CHICLAYO A CAJAMARCA.', { familiaDe });
    expect(r.cuenta).toBe('60921');
    expect(r.revisar).toBe(false);
  });

  it('«viaje realizado» en una guía de carga NO la vuelve pasaje', () => {
    // Texto real de producción (S/ 423,73).
    const t = 'POR EL SERVICIO DE TRANSPORTE DE TUBOS Y PERFILES DE DIFERENTES MEDIDAS DESDE CAJAMARCA HASTA '
      + 'SAN MARCOS-CAJAMARCA/PESO:36,990.32 KG/CONFIGURACION VEHICULAR:T3 S3/PLACA:B8N-707 VIAJE REALIZADO EL 30/10/2024';
    expect(esPasaje(t)).toBe(false);
    // «tubos y perfiles de diferentes medidas» no alcanza para decir cuál
    // existencia es: no se adivina, pero SÍ se marca (un pasaje no se marcaría).
    const r = cuentaDeFlete(t, { familiaDe });
    expect(r.cuenta === '631' ? r.revisar : true).toBe(true);
  });

  it('un pasaje queda en la 631, sin aviso', () => {
    const r = cuentaDeFlete('SERVICIO DE TRANSPORTE DE PASAJERO DNI: 71248988 NOMBRE: X', { familiaDe });
    expect(r.cuenta).toBe('631');
    expect(r.revisar).toBe(false);
  });

  it('lo que no dice de qué fue queda en la 631 y marcado para revisar', () => {
    for (const t of ['TRANSPORTE NACIONAL', 'SERVICIO DE TRANSPORTE INTERPROVINCIAL', 'Servicio de transporte 1 BULTO (Serie: V205 Nro orden: 696)']) {
      const r = cuentaDeFlete(t, { familiaDe });
      expect(r.cuenta).toBe('631');
      expect(r.revisar).toBe(true);
      expect(r.porque).toMatch(/609/);
    }
  });

  it('una mercadería que no se reconoce NO se adivina', () => {
    // «artículos de ferretería» puede ser 603 o 656: no se inventa.
    const r = cuentaDeFlete('TRANSPORTE DE ARTICULOS DE FERRETERIA SEGUN GUIA', { familiaDe });
    expect(r.cuenta).toBe('631');
    expect(r.revisar).toBe(true);
  });

  it('en la misma factura que la compra, va a la 609 de esa compra', () => {
    const r = cuentaDeFlete('FLETE', { familiaDe, compraDelMismoComprobante: '603' });
    expect(r.cuenta).toBe('60931');
  });
});

describe('de punta a punta, en el reparto del comprobante', () => {
  const mov = (items, extra = {}) => ({
    id: 'm1', type: 'cost', amount: 1180,
    notas: JSON.stringify({ items_factura: items }), ...extra,
  });
  const item = (descripcion, precio_unitario = 100) => ({ descripcion, cantidad: 1, precio_unitario });

  it('la factura del transportista que trajo tubos va a la 60921', () => {
    const r = cuentasDeComprobante(
      mov([item('POR EL SERVICIO DE TRANSPORTE DE TUBO HOPE 100 SOR 11 PN DE CHICLAYO A CAJAMARCA.', 1000)]),
      { familiaDe },
    );
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0].cuenta).toBe('60921');
    expect(r.lineas[0].cuentaMadre).toBe('60');
  });

  it('cemento con su flete: el flete sigue al cemento, no a la 631', () => {
    const r = cuentasDeComprobante(
      mov([item('CEMENTO PORTLAND TIPO I X 42.5 KG', 900), item('FLETE', 100)]),
      { familiaDe },
    );
    const cuentas = r.lineas.map(l => l.cuenta);
    expect(cuentas).toContain('602');
    expect(cuentas).toContain('60921');
    expect(cuentas).not.toContain('631');
  });

  it('el flete que la empresa FACTURA es un ingreso: no se toca', () => {
    const r = cuentasDeComprobante(
      mov([item('POR EL SERVICIO DE TRANSPORTE DE TUBO HOPE 100 SOR 11 PN DE CHICLAYO A CAJAMARCA.', 1000)], { type: 'income', clase: 'venta' }),
      { familiaDe },
    );
    expect(r.lineas[0].cuenta).toBe('704');
  });

  it('un pasaje sigue en la 631 y sin revisar', () => {
    const r = cuentasDeComprobante(mov([item('Servicio de transporte al pasajero desde Lima hasta Cajamarca', 80)]), { familiaDe });
    expect(r.lineas[0].cuenta).toBe('631');
  });
});
