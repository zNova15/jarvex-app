// ═══════════════════════════════════════════════════════════════════
// ANULACIÓN EN CASCADA POR NOTA DE CRÉDITO (tanda 9, 17-set-2026)
//
// Lo medido en producción: 22 facturas con nota de crédito, 21 ANULADAS y las
// 21 todavía vivas, en 7 empresas y desde 2023. 8 con detracción pendiente
// (una de S/ 478.808), 11 marcadas pagadas, y la E001-43 de S/ 9.000 cargada
// de los dos lados —venta en AGENCIA DE VIAJES, compra en EL INCA— anulada por
// la misma nota. Ése es el caso que da nombre a la tanda.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { planDeAnulacion, facturasAnuladasVivas, espejoDe } from '../anulacion-cascada.js';

const AGENCIA = 'c-agencia', INCA = 'c-inca', GASOMI = 'c-gasomi';
const NOMBRES = { [AGENCIA]: 'AGENCIA DE VIAJES', [INCA]: 'CONSORCIO EL INCA', [GASOMI]: 'GASOMI INGENIEROS' };
const empresaDe = (id) => NOMBRES[id] || null;

// El par real de producción: el mismo comprobante en dos libros.
const VENTA_AGENCIA = {
  id: 'f-venta', company_id: AGENCIA, clase: 'venta', type: 'income',
  document_type: 'factura', document_number: 'E001-43', date: '2026-07-07',
  amount: 9000, currency: 'PEN', payment_status: 'pending',
  is_intercompany: true, related_movement_id: 'f-compra',
  detraccion_aplica: true, detraccion_estado: 'pendiente', detraccion_monto: 1080,
};
const COMPRA_INCA = {
  id: 'f-compra', company_id: INCA, clase: 'compra', type: 'cost',
  document_type: 'factura', document_number: 'E001-43', date: '2026-07-07',
  amount: 9000, currency: 'PEN', payment_status: 'paid',
  is_intercompany: true, related_movement_id: 'f-venta',
};
const NOTA_VENTA = {
  id: 'nc-venta', company_id: AGENCIA, clase: 'venta', type: 'income',
  document_type: 'nota_credito', document_number: 'E001-5', date: '2026-07-20',
  amount: -9000, currency: 'PEN', related_movement_id: 'f-venta',
};
const NOTA_COMPRA = {
  ...NOTA_VENTA, id: 'nc-compra', company_id: INCA, clase: 'compra', type: 'cost',
  related_movement_id: 'f-compra',
};

// Una suelta, sin espejo: la F003-3409 de GASOMI (la del escáner de abril).
const FACTURA_SOLA = {
  id: 'f-koplast', company_id: GASOMI, clase: 'compra', type: 'cost',
  document_type: 'factura', document_number: 'F003-3409', date: '2026-04-13',
  amount: 19518.72, currency: 'USD', payment_status: 'paid',
};
const NOTA_SOLA = {
  ...FACTURA_SOLA, id: 'nc-koplast', document_type: 'nota_credito',
  document_number: 'FC03-187', date: '2026-04-20', amount: -19518.72,
  related_movement_id: 'f-koplast',
};

const TODOS = [VENTA_AGENCIA, COMPRA_INCA, NOTA_VENTA, NOTA_COMPRA, FACTURA_SOLA, NOTA_SOLA];

describe('el espejo de una factura', () => {
  it('lo encuentra en la otra empresa', () => {
    expect(espejoDe(VENTA_AGENCIA, TODOS).id).toBe('f-compra');
  });

  it('NO confunde la nota con el espejo, aunque comparten la columna', () => {
    // `related_movement_id` en una nota apunta a la factura; en una factura, al
    // espejo. Confundirlos daría de baja la nota que hace la anulación.
    expect(espejoDe(NOTA_SOLA, TODOS)).toBe(null);
    expect(espejoDe(FACTURA_SOLA, TODOS)).toBe(null);
  });

  it('un par dentro de la MISMA empresa no es un espejo', () => {
    const mismaEmpresa = { ...COMPRA_INCA, company_id: AGENCIA };
    expect(espejoDe(VENTA_AGENCIA, [VENTA_AGENCIA, mismaEmpresa])).toBe(null);
  });

  it('un espejo borrado no cuenta', () => {
    expect(espejoDe(VENTA_AGENCIA, [VENTA_AGENCIA, { ...COMPRA_INCA, deleted_at: 'x' }])).toBe(null);
  });
});

describe('el plan de dar de baja una factura anulada', () => {
  it('da de baja la factura Y su espejo: es el mismo comprobante', () => {
    const p = planDeAnulacion('f-venta', { movimientos: TODOS, empresaDe });
    expect(p.anulada).toBe(true);
    expect(p.aCancelar.sort()).toEqual(['f-compra', 'f-venta']);
    expect(p.consecuencias.join(' ')).toMatch(/espejo/);
    expect(p.consecuencias.join(' ')).toMatch(/CONSORCIO EL INCA/);
  });

  it('dice qué deja de sumar, y en qué empresa', () => {
    const p = planDeAnulacion('f-venta', { movimientos: TODOS, empresaDe });
    expect(p.consecuencias[0]).toMatch(/9,000\.00/);
    expect(p.consecuencias[0]).toMatch(/AGENCIA DE VIAJES/);
    expect(p.consecuencias[0]).toMatch(/PLE/);
  });

  it('avisa que deja de exigirse la detracción pendiente', () => {
    // 8 de las 21 de producción están así: la app reclamaba el depósito de un
    // comprobante que ya no existe.
    const p = planDeAnulacion('f-venta', { movimientos: TODOS, empresaDe });
    expect(p.consecuencias.join(' ')).toMatch(/detracción/);
    expect(p.consecuencias.join(' ')).toMatch(/1,080\.00/);
  });

  it('no menciona la detracción si ya está depositada', () => {
    const movs = TODOS.map(m => (m.id === 'f-venta' ? { ...m, detraccion_estado: 'depositada' } : m));
    const p = planDeAnulacion('f-venta', { movimientos: movs, empresaDe });
    expect(p.consecuencias.join(' ')).not.toMatch(/Deja de exigirse el depósito/);
  });

  it('a una factura PAGADA le avisa que la plata no se desanula sola', () => {
    const p = planDeAnulacion('f-koplast', { movimientos: TODOS, empresaDe });
    expect(p.avisos.join(' ')).toMatch(/PAGADA/);
    expect(p.avisos.join(' ')).toMatch(/saldo a favor/);
  });

  it('a una pagada sobre el umbral le saca la exigencia de bancarización', () => {
    const p = planDeAnulacion('f-koplast', { movimientos: TODOS, empresaDe });
    expect(p.consecuencias.join(' ')).toMatch(/bancarización/);
  });

  it('avisa por la recepción pendiente, y por qué podría significar otra cosa', () => {
    const movs = TODOS.map(m => (m.id === 'f-koplast' ? { ...m, recepcion_status: 'pendiente_recepcion' } : m));
    const p = planDeAnulacion('f-koplast', { movimientos: movs, empresaDe });
    expect(p.consecuencias.join(' ')).toMatch(/recepción pendiente/i);
    // Y no lo da por cerrado: si la mercadería llegó, la anulada es la nota.
    expect(p.consecuencias.join(' ')).toMatch(/la factura no estaba anulada/);
  });

  it('avisa si está marcada interco pero el espejo no está cargado', () => {
    const sinEspejo = TODOS.filter(m => m.id !== 'f-compra')
      .map(m => (m.id === 'f-venta' ? { ...m, related_movement_id: null } : m));
    const p = planDeAnulacion('f-venta', { movimientos: sinEspejo, empresaDe });
    expect(p.espejo).toBe(null);
    expect(p.avisos.join(' ')).toMatch(/no tiene su espejo cargado/);
  });
});

describe('lo que FRENA la cascada', () => {
  it('una factura solo REBAJADA no se da de baja: sigue siendo válida', () => {
    const parcial = TODOS.map(m => (m.id === 'nc-venta' ? { ...m, amount: -2000 } : m));
    const p = planDeAnulacion('f-venta', { movimientos: parcial, empresaDe });
    expect(p.anulada).toBe(false);
    expect(p.aCancelar).toEqual([]);
    expect(p.bloqueos.join(' ')).toMatch(/solo rebajada/);
  });

  it('sin ninguna nota de crédito, no hay nada que anular', () => {
    const p = planDeAnulacion('f-koplast', { movimientos: [FACTURA_SOLA], empresaDe });
    expect(p.bloqueos.join(' ')).toMatch(/no tiene notas de crédito/);
    expect(p.aCancelar).toEqual([]);
  });

  it('con pagos aplicados frena: la plata que salió no se desanula sola', () => {
    const p = planDeAnulacion('f-koplast', {
      movimientos: TODOS, empresaDe,
      pagosPartes: [{ id: 'p1', accounting_movement_id: 'f-koplast', monto: 5000 }],
    });
    expect(p.bloqueos.join(' ')).toMatch(/pago/);
    expect(p.bloqueos.join(' ')).toMatch(/5,000\.00/);
  });

  it('con un anticipo consumido frena: el saldo del anticipo quedaría mal', () => {
    const p = planDeAnulacion('f-koplast', {
      movimientos: TODOS, empresaDe,
      anticipos: [{ id: 'a1', factura_movimiento_id: 'f-koplast', monto: 3000 }],
    });
    expect(p.bloqueos.join(' ')).toMatch(/anticipo/);
  });

  it('una pata de un par interco REGISTRADO se toca desde su pantalla', () => {
    const p = planDeAnulacion('f-venta', {
      movimientos: TODOS, empresaDe, idsConPar: new Set(['f-venta']),
    });
    expect(p.bloqueos.join(' ')).toMatch(/Operaciones entre empresas/);
  });

  it('el bloqueo del espejo también frena, aunque la factura esté limpia', () => {
    const p = planDeAnulacion('f-venta', {
      movimientos: TODOS, empresaDe,
      pagosPartes: [{ id: 'p1', accounting_movement_id: 'f-compra', monto: 9000 }],
    });
    expect(p.bloqueos.length).toBeGreaterThan(0);
  });

  it('lo que ya está dado de baja no se toca de nuevo', () => {
    const movs = TODOS.map(m => (m.id === 'f-venta' ? { ...m, payment_status: 'cancelled' } : m));
    const p = planDeAnulacion('f-venta', { movimientos: movs, empresaDe });
    expect(p.yaAnulada).toBe(true);
    expect(p.aCancelar).toEqual(['f-compra']);    // el espejo sigue vivo
  });

  it('con las dos patas ya de baja, no queda nada que hacer', () => {
    const movs = TODOS.map(m => (['f-venta', 'f-compra'].includes(m.id) ? { ...m, payment_status: 'cancelled' } : m));
    const p = planDeAnulacion('f-venta', { movimientos: movs, empresaDe });
    expect(p.aCancelar).toEqual([]);
    expect(p.avisos.join(' ')).toMatch(/Ya estaba dada de baja/);
  });

  it('un comprobante que no está en el dispositivo se dice, no se adivina', () => {
    const p = planDeAnulacion('no-existe', { movimientos: TODOS });
    expect(p.bloqueos.join(' ')).toMatch(/sincronizá/);
  });
});

describe('la lista de la pasada', () => {
  it('trae las anuladas que siguen vivas, y no las que ya están de baja', () => {
    const lista = facturasAnuladasVivas({ movimientos: TODOS });
    expect(lista.map(f => f.id).sort()).toEqual(['f-compra', 'f-koplast', 'f-venta']);
    const conUnaDeBaja = TODOS.map(m => (m.id === 'f-venta' ? { ...m, payment_status: 'cancelled' } : m));
    expect(facturasAnuladasVivas({ movimientos: conUnaDeBaja }).map(f => f.id)).not.toContain('f-venta');
  });

  it('ordena por importe: la más cara primero, que es por donde conviene empezar', () => {
    const lista = facturasAnuladasVivas({ movimientos: TODOS });
    expect(lista[0].monto).toBe(19518.72);
    expect(lista.map(f => f.monto)).toEqual([...lista.map(f => f.monto)].sort((a, b) => b - a));
  });

  it('se puede acotar a una empresa', () => {
    const lista = facturasAnuladasVivas({ movimientos: TODOS, companyId: GASOMI });
    expect(lista.map(f => f.documento)).toEqual(['F003-3409']);
  });

  it('cada fila dice qué nota la anuló', () => {
    const f = facturasAnuladasVivas({ movimientos: TODOS }).find(x => x.id === 'f-koplast');
    expect(f.notas).toEqual(['FC03-187']);
    expect(f.etiqueta).toMatch(/ANULADA/);
    expect(f.moneda).toBe('USD');
  });

  it('una rebajada NO entra en la lista', () => {
    const parcial = TODOS.map(m => (m.id === 'nc-koplast' ? { ...m, amount: -100 } : m));
    expect(facturasAnuladasVivas({ movimientos: parcial }).map(f => f.id)).not.toContain('f-koplast');
  });
});
