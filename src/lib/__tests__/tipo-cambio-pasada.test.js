// ═══════════════════════════════════════════════════════════════════
// UNA CONSULTA POR FECHA, NO POR COMPROBANTE (tanda 7, 17-set-2026)
//
// Pedido de Gabriel: «la tasa SUNAT del día se consulta 1 sola vez por fecha:
// si hay 6 facturas de las cuales 2 son del mismo día, en esa factura se
// solicita el cambio de SUNAT para dicha fecha y luego para la segunda solo se
// jala el dato que queda registrado».
//
// No es una preferencia estética: la API gratuita devuelve 429 al tercer
// pedido seguido desde la misma IP (medido el 17-set). En producción hay 42
// comprobantes en USD sobre 23 fechas — pedir por comprobante es no terminar
// nunca.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  monedaDe, necesitaTipoCambio, tasaVigente, tasaDeComprobante,
  planDePasada, fechasQueFaltan, validarTasaManual,
} from '../tipo-cambio-pasada.js';

const usd = (extra = {}) => ({
  id: 'm1', clase: 'compra', type: 'cost', currency: 'USD',
  date: '2026-09-03', amount: 1000, payment_status: 'paid', ...extra,
});
const soles = (extra = {}) => usd({ id: 'p1', currency: 'PEN', ...extra });

// La tasa REAL del 3-set-2026, verificada contra SUNAT el 17-set.
const TASA_3SET = { id: 't1', fecha: '2026-09-03', moneda: 'USD', compra: 3.353, venta: 3.36, fuente: 'sunat', created_at: '2026-09-17T10:00:00Z' };

describe('qué comprobante necesita tipo de cambio', () => {
  it('los que no están en soles y no lo tienen todavía', () => {
    expect(necesitaTipoCambio(usd())).toBe(true);
    expect(monedaDe(usd())).toBe('USD');
  });

  it('un comprobante en soles no lo necesita nunca', () => {
    expect(necesitaTipoCambio(soles())).toBe(false);
    expect(monedaDe(soles())).toBe('PEN');
  });

  it('sin moneda se asume soles: es el default de la tabla', () => {
    expect(necesitaTipoCambio(usd({ currency: null }))).toBe(false);
  });

  it('el que ya tiene su tasa estampada queda afuera: no se pisa lo declarado', () => {
    expect(necesitaTipoCambio(usd({ tipo_cambio: 3.36 }))).toBe(false);
  });

  it('lo borrado y lo anulado quedan afuera', () => {
    expect(necesitaTipoCambio(usd({ deleted_at: '2026-09-04' }))).toBe(false);
    expect(necesitaTipoCambio(usd({ payment_status: 'cancelled' }))).toBe(false);
  });
});

describe('la tasa vigente de una fecha', () => {
  it('encuentra la de esa fecha exacta y ninguna otra', () => {
    expect(tasaVigente([TASA_3SET], '2026-09-03').venta).toBe(3.36);
    // NO devuelve la del día anterior: declarar con la tasa de otro día es
    // declarar mal, y es justo lo que hacía el cache viejo.
    expect(tasaVigente([TASA_3SET], '2026-09-04')).toBe(null);
  });

  it('una cargada A MANO le gana a la de la API', () => {
    const manual = { ...TASA_3SET, id: 't2', venta: 3.37, fuente: 'manual', created_at: '2026-09-16T10:00:00Z' };
    // Gana aunque sea MÁS VIEJA: si alguien la copió del portal es porque la
    // de la API estaba mal.
    expect(tasaVigente([TASA_3SET, manual], '2026-09-03').venta).toBe(3.37);
  });

  it('a igual fuente gana la más reciente (las dos PCs pueden haberla pedido)', () => {
    const nueva = { ...TASA_3SET, id: 't3', venta: 3.365, created_at: '2026-09-18T10:00:00Z' };
    expect(tasaVigente([TASA_3SET, nueva], '2026-09-03').venta).toBe(3.365);
  });

  it('ignora las borradas y las sin valor', () => {
    expect(tasaVigente([{ ...TASA_3SET, deleted_at: 'x' }], '2026-09-03')).toBe(null);
    expect(tasaVigente([{ ...TASA_3SET, venta: 0 }], '2026-09-03')).toBe(null);
  });
});

describe('qué tasa le toca a cada comprobante', () => {
  it('una COMPRA usa la de venta: es la que se paga', () => {
    const t = tasaDeComprobante(usd(), [TASA_3SET]);
    expect(t.valor).toBe(3.36);
    expect(t.origen).toBe('fecha');
  });

  it('una VENTA usa la de compra', () => {
    const t = tasaDeComprobante(usd({ clase: 'venta', type: 'income' }), [TASA_3SET]);
    expect(t.valor).toBe(3.353);
  });

  it('la que ya tiene estampada manda sobre la de la fecha: queda congelada', () => {
    // Si mañana se corrige la tasa del día, lo ya declarado no se mueve solo.
    const t = tasaDeComprobante(usd({ tipo_cambio: 3.3 }), [TASA_3SET]);
    expect(t.valor).toBe(3.3);
    expect(t.origen).toBe('comprobante');
  });

  it('sin tasa para esa fecha devuelve null, y no un número inventado', () => {
    expect(tasaDeComprobante(usd({ date: '2026-09-04' }), [TASA_3SET])).toBe(null);
  });

  it('un comprobante en soles no tiene tipo de cambio', () => {
    expect(tasaDeComprobante(soles(), [TASA_3SET])).toBe(null);
  });
});

describe('el plan de la pasada: una consulta por FECHA', () => {
  // El ejemplo de Gabriel, literal: seis facturas y dos del mismo día.
  const SEIS = [
    usd({ id: 'a', date: '2026-09-01' }),
    usd({ id: 'b', date: '2026-09-01' }),   // el mismo día que la anterior
    usd({ id: 'c', date: '2026-09-02' }),
    usd({ id: 'd', date: '2026-09-03' }),
    usd({ id: 'e', date: '2026-09-04' }),
    usd({ id: 'f', date: '2026-09-05' }),
  ];

  it('seis facturas en cinco días son CINCO consultas, no seis', () => {
    const plan = planDePasada(SEIS, []);
    expect(plan.fechas.length).toBe(5);
    expect(plan.consultas).toBe(5);
    expect(plan.comprobantes).toBe(6);
  });

  it('las dos del mismo día van juntas en su fecha', () => {
    const dia1 = planDePasada(SEIS, []).fechas.find(f => f.fecha === '2026-09-01');
    expect(dia1.ids.sort()).toEqual(['a', 'b']);
  });

  it('la fecha que YA está guardada no se vuelve a pedir', () => {
    const plan = planDePasada(SEIS, [TASA_3SET]);
    expect(plan.consultas).toBe(4);       // el 3-set ya está
    expect(plan.guardadas).toBe(1);
    expect(fechasQueFaltan(SEIS, [TASA_3SET]).map(f => f.fecha)).not.toContain('2026-09-03');
    // Pero sus comprobantes SÍ se estampan: la tasa está, solo faltaba ponerla.
    expect(plan.comprobantes).toBe(6);
  });

  it('con todas las fechas guardadas no hay ninguna consulta que hacer', () => {
    const tasas = SEIS.map((m, i) => ({ ...TASA_3SET, id: `t${i}`, fecha: m.date }));
    expect(planDePasada(SEIS, tasas).consultas).toBe(0);
  });

  it('va de la fecha más vieja a la más nueva: si se corta, se ve dónde quedó', () => {
    expect(planDePasada(SEIS, []).fechas.map(f => f.fecha)).toEqual([
      '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05',
    ]);
  });

  it('los comprobantes en soles no entran al plan', () => {
    expect(planDePasada([...SEIS, soles({ id: 'z', date: '2026-09-09' })], []).fechas.length).toBe(5);
  });

  it('sin nada en dólares, el plan está vacío', () => {
    expect(planDePasada([soles()], []).consultas).toBe(0);
    expect(planDePasada([], []).fechas).toEqual([]);
  });
});

describe('la tasa cargada a mano', () => {
  it('acepta un número razonable, con coma o con punto', () => {
    expect(validarTasaManual('3.36')).toEqual({ ok: true, valor: 3.36 });
    expect(validarTasaManual('3,36')).toEqual({ ok: true, valor: 3.36 });
  });

  it('frena el dedazo de coma, que multiplicaría la contabilidad por diez', () => {
    expect(validarTasaManual('33.6').ok).toBe(false);
    expect(validarTasaManual('0.336').ok).toBe(false);
  });

  it('rechaza lo que no es un número', () => {
    expect(validarTasaManual('').ok).toBe(false);
    expect(validarTasaManual('tres').ok).toBe(false);
    expect(validarTasaManual(0).ok).toBe(false);
  });
});
