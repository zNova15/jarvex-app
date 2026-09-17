// De dónde salió la plata: la contrapartida automática y el candado de la
// bancarización (pedido de Gabriel, 17-set-2026).
//
// El caso que originó todo esto está medido en producción: `metodo_pago` dice
// 'efectivo' en 1.617 de 1.742 movimientos porque es el valor con el que nace
// la captura, y el asiento lo tomaba como declaración. 111 compras pagadas de
// S/ 2.000 o más terminaban contra la caja 101.
import { describe, it, expect } from 'vitest';
import {
  medioDePago, efectivoProhibido, resolverContrapartida, opcionesContrapartida,
  avisoEfectivoSobreUmbral, CAJA, BANCOS, SIN_DEFINIR, POR_PAGAR, POR_COBRAR, POR_COBRAR_REL,
} from '../contrapartida.js';
import { esCuentaValida } from '../pcge.js';
import { generarAsiento } from '../asientos.js';

const compra = (extra = {}) => ({
  id: 'm1', type: 'cost', clase: 'compra', currency: 'PEN',
  payment_status: 'paid', date: '2026-09-01', amount: 5000,
  description: 'Factura de flete', document_number: 'F001-1',
  ...extra,
});

describe('qué dice el método de pago', () => {
  it('reconoce los medios que pasan por el banco', () => {
    for (const m of ['transferencia', 'Transferencia bancaria', 'deposito', 'cheque', 'yape', 'PLIN', 'tarjeta visa']) {
      expect(medioDePago(m)).toBe('banco');
    }
  });

  it('reconoce el efectivo', () => {
    expect(medioDePago('efectivo')).toBe('efectivo');
    expect(medioDePago('Caja chica')).toBe('efectivo');
  });

  it('vacío es «no se sabe», no efectivo', () => {
    expect(medioDePago(null)).toBe('desconocido');
    expect(medioDePago('')).toBe('desconocido');
  });

  it('«contado» dice cuándo se pagó, no con qué: no es efectivo', () => {
    expect(medioDePago('contado')).toBe('desconocido');
  });
});

describe('cuándo la caja queda prohibida', () => {
  it('compra pagada de S/ 2.000 o más: prohibida', () => {
    expect(efectivoProhibido(compra({ amount: 2000 }))).toBe(true);
    expect(efectivoProhibido(compra({ amount: 5000 }))).toBe(true);
  });

  it('por debajo del umbral, la caja es legal', () => {
    expect(efectivoProhibido(compra({ amount: 1999.99 }))).toBe(false);
  });

  it('en dólares el umbral es US$ 500, no S/ 2.000', () => {
    expect(efectivoProhibido(compra({ amount: 500, currency: 'USD' }))).toBe(true);
    expect(efectivoProhibido(compra({ amount: 499, currency: 'USD' }))).toBe(false);
  });

  it('un comprobante PENDIENTE no infringe nada: todavía no se pagó', () => {
    // En producción hay 207 pendientes de S/ 2.000 o más con 'efectivo'
    // escrito. Ninguno es una infracción.
    expect(efectivoProhibido(compra({ payment_status: 'pending', amount: 9000 }))).toBe(false);
  });

  it('una VENTA cobrada en efectivo no se bloquea: el que pierde la deducción es quien paga', () => {
    expect(efectivoProhibido(compra({ clase: 'venta', type: 'income', amount: 9000 }))).toBe(false);
  });
});

describe('la contrapartida que deduce la app', () => {
  it('lo que puso una persona le gana a todo', () => {
    const r = resolverContrapartida(compra({ cuenta_pcge_contrapartida: '1041', metodo_pago: 'efectivo' }));
    expect(r.cuenta).toBe('1041');
    expect(r.origen).toBe('manual');
  });

  it('con la constancia cargada va al banco, aunque el comprobante diga efectivo', () => {
    // Esto es lo que la app ya sabía y el asiento nunca miraba.
    const r = resolverContrapartida(compra({ metodo_pago: 'efectivo' }), { bancarizado: true });
    expect(r.cuenta).toBe(BANCOS);
    expect(r.origen).toBe('constancia');
    expect(r.confianza).toBe('alta');
  });

  it('la detracción depositada prueba que pasó por el banco, con menos certeza', () => {
    const r = resolverContrapartida(compra({ detraccion_aplica: true, detraccion_estado: 'depositada' }));
    expect(r.cuenta).toBe(BANCOS);
    expect(r.origen).toBe('detraccion');
    expect(r.confianza).toBe('media');
  });

  it('la detracción PENDIENTE no prueba nada', () => {
    const r = resolverContrapartida(compra({ detraccion_aplica: true, detraccion_estado: 'pendiente', metodo_pago: 'efectivo' }));
    expect(r.origen).not.toBe('detraccion');
  });

  it('si el método de pago dice transferencia, se le cree', () => {
    const r = resolverContrapartida(compra({ metodo_pago: 'transferencia' }));
    expect(r.cuenta).toBe(BANCOS);
    expect(r.origen).toBe('metodo_pago');
  });

  it('EL CASO DE LOS 111: efectivo sobre el umbral sin evidencia queda POR DEFINIR, no en caja', () => {
    const r = resolverContrapartida(compra({ amount: 5000, metodo_pago: 'efectivo' }));
    expect(r.cuenta).toBe(SIN_DEFINIR);
    expect(r.cuenta).not.toBe(CAJA);
    expect(r.porDefinir).toBe(true);
    expect(r.prohibeEfectivo).toBe(true);
    expect(r.porque).toMatch(/bancarizaci/i);
  });

  it('sin método de pago y sobre el umbral: también por definir, con su motivo propio', () => {
    const r = resolverContrapartida(compra({ amount: 5000, metodo_pago: null }));
    expect(r.porDefinir).toBe(true);
    expect(r.porque).toMatch(/No consta/);
  });

  it('efectivo por debajo del umbral sí va a la caja', () => {
    const r = resolverContrapartida(compra({ amount: 300, metodo_pago: 'efectivo' }));
    expect(r.cuenta).toBe(CAJA);
    expect(r.porDefinir).toBe(false);
  });

  it('un comprobante pendiente devuelve la deuda, y deja la cuenta al generador', () => {
    const r = resolverContrapartida(compra({ payment_status: 'pending' }));
    expect(r.cuenta).toBe(null);
    expect(r.origen).toBe('deuda');
  });
});

describe('las opciones que se ofrecen', () => {
  it('todas son cuentas que existen en el PCGE y explican cuándo van', () => {
    for (const mov of [compra(), compra({ payment_status: 'pending' }), compra({ clase: 'venta', type: 'income' })]) {
      const ops = opcionesContrapartida(mov);
      expect(ops.length).toBeGreaterThan(2);
      for (const o of ops) {
        expect(esCuentaValida(o.codigo)).toBe(true);
        expect(o.cuando.length).toBeGreaterThan(15);
      }
    }
  });

  it('sobre el umbral la caja se ofrece BLOQUEADA, y el banco va primero', () => {
    const ops = opcionesContrapartida(compra({ amount: 5000 }));
    expect(ops[0].codigo).toBe(BANCOS);
    const caja = ops.find(o => o.codigo === CAJA);
    expect(caja.prohibida).toBe(true);
    expect(caja.cuando).toMatch(/28194/);
  });

  it('bajo el umbral la caja se ofrece normal', () => {
    const caja = opcionesContrapartida(compra({ amount: 500 })).find(o => o.codigo === CAJA);
    expect(caja.prohibida).toBe(false);
  });

  it('ofrece compensar contra una factura propia — la tercera salida de Gabriel', () => {
    const ops = opcionesContrapartida(compra({ amount: 5000 }));
    expect(ops.map(o => o.codigo)).toContain(POR_COBRAR);
    // Dentro del grupo, la compensación va contra la cuenta de relacionadas.
    const rel = opcionesContrapartida(compra({ amount: 5000, is_intercompany: true }));
    expect(rel.map(o => o.codigo)).toContain(POR_COBRAR_REL);
  });

  it('un comprobante pendiente ofrece la deuda primero', () => {
    expect(opcionesContrapartida(compra({ payment_status: 'pending' }))[0].codigo).toBe(POR_PAGAR);
  });
});

describe('el aviso de la consecuencia tributaria', () => {
  it('avisa cuando la caja quedó puesta igual, sobre el umbral', () => {
    const a = avisoEfectivoSobreUmbral(compra({ amount: 5000 }), CAJA);
    expect(a).toMatch(/crédito fiscal/);
    expect(a).toMatch(/28194/);
  });

  it('vale también para las subcuentas de caja (1011, 1012…)', () => {
    expect(avisoEfectivoSobreUmbral(compra({ amount: 5000 }), '1011')).toBeTruthy();
  });

  it('no avisa si la contrapartida es el banco', () => {
    expect(avisoEfectivoSobreUmbral(compra({ amount: 5000 }), BANCOS)).toBe(null);
  });

  it('no avisa por debajo del umbral', () => {
    expect(avisoEfectivoSobreUmbral(compra({ amount: 100 }), CAJA)).toBe(null);
  });
});

describe('el asiento generado usa todo esto', () => {
  it('una compra pagada de S/ 5.000 con «efectivo» NO se asienta contra la caja', () => {
    const a = generarAsiento(compra({ amount: 5000, metodo_pago: 'efectivo' }));
    const cuentas = a.partidas.map(p => p.cuenta);
    expect(cuentas).not.toContain(CAJA);
    expect(cuentas).toContain(SIN_DEFINIR);
    expect(a.cuentas.contrapartida.porDefinir).toBe(true);
    expect(a.cuadra).toBe(true);
  });

  it('la misma compra, con la constancia cargada, se asienta contra el banco sola', () => {
    const a = generarAsiento(compra({ amount: 5000, metodo_pago: 'efectivo' }), {
      bancarizadoIds: new Set(['m1']),
    });
    expect(a.partidas.map(p => p.cuenta)).toContain(BANCOS);
    expect(a.cuentas.contrapartida.origen).toBe('constancia');
    expect(a.cuadra).toBe(true);
  });

  it('en un par interco la constancia de una pata vale para las dos', () => {
    const a = generarAsiento(compra({ amount: 5000, metodo_pago: 'efectivo', is_intercompany: true, related_movement_id: 'espejo' }), {
      bancarizadoIds: new Set(['espejo']),
    });
    expect(a.partidas.map(p => p.cuenta)).toContain(BANCOS);
  });

  it('una compra chica pagada en efectivo sigue yendo a la caja', () => {
    const a = generarAsiento(compra({ amount: 300, metodo_pago: 'efectivo' }));
    expect(a.partidas.map(p => p.cuenta)).toContain(CAJA);
    expect(a.cuentas.contrapartida.aviso).toBe(null);
  });

  it('si una persona puso la caja a mano, el asiento la respeta PERO lleva el aviso', () => {
    const a = generarAsiento(compra({ amount: 5000, cuenta_pcge_contrapartida: CAJA }));
    expect(a.partidas.map(p => p.cuenta)).toContain(CAJA);
    expect(a.cuentas.contrapartidaManual).toBe(true);
    expect(a.cuentas.contrapartida.aviso).toMatch(/crédito fiscal/);
  });

  it('un pendiente grande no queda «por definir»: su contrapartida es la deuda', () => {
    const a = generarAsiento(compra({ amount: 9000, payment_status: 'pending', metodo_pago: 'efectivo' }));
    expect(a.partidas.map(p => p.cuenta)).toContain(POR_PAGAR);
    expect(a.cuentas.contrapartida.porDefinir).toBe(false);
    expect(a.cuentas.contrapartida.aviso).toBe(null);
  });

  it('una nota de crédito nunca va contra la caja ni queda por definir', () => {
    const a = generarAsiento(compra({ amount: -5000, metodo_pago: 'efectivo', document_number: 'FC01-9' }));
    expect(a.extorno).toBe(true);
    expect(a.partidas.map(p => p.cuenta)).not.toContain(CAJA);
    expect(a.cuentas.contrapartida.porDefinir).toBe(false);
    expect(a.cuadra).toBe(true);
  });

  it('una venta cobrada en efectivo sobre el umbral sigue entrando a la caja', () => {
    const a = generarAsiento(compra({ clase: 'venta', type: 'income', amount: 9000, metodo_pago: 'efectivo' }));
    expect(a.partidas.map(p => p.cuenta)).toContain(CAJA);
  });
});
