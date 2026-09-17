// Corregir a mano la cuenta de un asiento (mig 220).
//
// Lo pidieron las contadoras: «está súper bien tener las recomendaciones de la
// IA pero en caso se crea que se debe cambiar el código se debería poder».
//
// Dos cosas se testean acá: que la VALIDACIÓN no deje entrar una cuenta que no
// existe (el asiento la usaría igual y quedaría un código inventado en el
// libro), y que el ASIENTO respete lo que la persona eligió — que es el punto
// de todo esto.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validarCuentaManual } from '../cuenta-manual-db.js';
import { generarAsiento } from '../asientos.js';
import { crearResolvedorDeFamilia, cuentasDeComprobante } from '../cuenta-de-comprobante.js';
import { esCuentaValida } from '../pcge.js';

const familiaDe = crearResolvedorDeFamilia({});
const OPTS = { repartoDe: (m) => cuentasDeComprobante(m, { familiaDe }) };
const item = (descripcion, cantidad = 1, precio_unitario = 100) => ({ descripcion, cantidad, precio_unitario });
const mov = (extra = {}) => ({
  id: 'm', clase: 'compra', type: 'cost', amount: 118, payment_status: 'pending',
  category: 'Factura', description: 'Factura F001-1',
  notas: JSON.stringify({ items_factura: [item('TRANSPORTE NACIONAL')] }),
  ...extra,
});
const cuentas = (a) => a.partidas.map(p => p.cuenta);

describe('validar la cuenta antes de guardarla', () => {
  it('acepta una cuenta del plan, en cualquiera de sus niveles', () => {
    for (const c of ['63', '631', '6311', '63111']) {
      expect(validarCuentaManual(c).ok).toBe(true);
    }
  });

  it('vaciar es válido: significa volver a automático', () => {
    expect(validarCuentaManual(null)).toEqual({ ok: true, codigo: null });
    expect(validarCuentaManual('')).toEqual({ ok: true, codigo: null });
    expect(validarCuentaManual('   ')).toEqual({ ok: true, codigo: null });
  });

  it('rechaza lo que no tiene forma de cuenta', () => {
    for (const c of ['6', '631111', 'abc', '63a', '63.1', '-63']) {
      const r = validarCuentaManual(c);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/2 a 5 d[ií]gitos/i);
    }
  });

  it('rechaza un código que NO existe en el PCGE, aunque tenga la forma', () => {
    // Éste es el que importa: '99' parece una cuenta y no lo es. Si entrara,
    // el libro tendría un código inventado y nadie lo notaría.
    expect(esCuentaValida('99')).toBe(false);
    const r = validarCuentaManual('99');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no existe/i);
  });

  it('devuelve el nombre, para poder confirmar lo que se eligió', () => {
    expect(validarCuentaManual('631').nombre).toBe('Transporte, correos y gastos de viaje');
  });

  // Las contrapartidas que se ofrecen se probaban acá cuando eran una lista
  // fija; ahora las arma `opcionesContrapartida()` según el comprobante y se
  // prueban en `contrapartida.test.js`, contra el PCGE igual que antes.
});

describe('el asiento respeta lo que eligió la persona', () => {
  it('la cuenta manual le gana al reparto automático', () => {
    const auto = generarAsiento(mov(), OPTS);
    expect(cuentas(auto)).toContain('631');          // la app dice 631

    const corregido = generarAsiento(mov({ cuenta_pcge: '659' }), OPTS);
    expect(cuentas(corregido)).toContain('659');
    expect(cuentas(corregido)).not.toContain('631');
    expect(corregido.cuentas.manual).toBe(true);
    expect(corregido.sumDebe).toBeCloseTo(corregido.sumHaber, 2);
  });

  it('la contrapartida manual le gana al método de pago', () => {
    // Sin método de pago, la app manda todo a la cuenta genérica '10'.
    const auto = generarAsiento(mov({ payment_status: 'paid' }), OPTS);
    expect(cuentas(auto)).toContain('10');

    const corregido = generarAsiento(
      mov({ payment_status: 'paid', cuenta_pcge_contrapartida: '104' }), OPTS);
    expect(cuentas(corregido)).toContain('104');
    expect(cuentas(corregido)).not.toContain('10');
    expect(corregido.cuentas.contrapartidaManual).toBe(true);
    expect(corregido.sumDebe).toBeCloseTo(corregido.sumHaber, 2);
  });

  it('también manda sobre la cuenta por pagar de un comprobante pendiente', () => {
    const a = generarAsiento(mov({ cuenta_pcge_contrapartida: '469' }), OPTS);
    expect(cuentas(a)).toContain('469');
    expect(cuentas(a)).not.toContain('42');
    expect(a.sumDebe).toBeCloseTo(a.sumHaber, 2);
  });

  it('y sobre la cuenta por cobrar de una venta', () => {
    const a = generarAsiento({
      id: 'v', clase: 'venta', type: 'income', amount: 1180, payment_status: 'pending',
      description: 'Valorización', cuenta_pcge_contrapartida: '131',
      notas: JSON.stringify({ items_factura: [item('EJECUCION DE OBRA SEGUN CONTRATO', 1, 1000)] }),
    }, OPTS);
    expect(cuentas(a)).toContain('131');
    expect(cuentas(a)).not.toContain('121');
    expect(a.sumDebe).toBeCloseTo(a.sumHaber, 2);
  });

  it('las dos correcciones conviven: una manual y la otra deducida', () => {
    const a = generarAsiento(mov({ cuenta_pcge_contrapartida: '104', payment_status: 'paid' }), OPTS);
    expect(a.cuentas.contrapartidaManual).toBe(true);
    expect(a.cuentas.manual).toBe(false);            // la del gasto sigue deducida
    expect(cuentas(a)).toContain('631');
  });

  it('sin corrección, nada cambia respecto de la tanda 2', () => {
    const a = generarAsiento(mov(), OPTS);
    expect(a.cuentas.manual).toBe(false);
    expect(a.cuentas.contrapartidaManual).toBe(false);
  });
});

describe('una cuenta manual saca al asiento de la pila «por definir»', () => {
  it('un comprobante que nadie reconoce, corregido, deja de estar provisional', async () => {
    const { cumpleEstadoCuenta } = await import('../asientos.js');
    const sinReconocer = mov({ notas: JSON.stringify({ items_factura: [item('XKCD ZZZQQ')] }) });
    expect(cumpleEstadoCuenta(generarAsiento(sinReconocer, OPTS), 'por_definir')).toBe(true);

    const corregido = generarAsiento({ ...sinReconocer, cuenta_pcge: '659' }, OPTS);
    expect(cumpleEstadoCuenta(corregido, 'por_definir')).toBe(false);
    expect(cumpleEstadoCuenta(corregido, 'manual')).toBe(true);
  });
});

describe('corregir de a varios, por proveedor', () => {
  // `fijarCuentaEnLote` es lo que hace usable la pila de «cuentas por definir»:
  // son 345 en producción y se repiten por proveedor. Se testea contra un
  // Dexie de mentira porque lo que importa acá es el CONTRATO —no abortar al
  // primer error y decir cuáles fallaron—, no cómo escribe.
  let almacen;

  beforeEach(async () => {
    almacen = new Map([
      ['a', { id: 'a', version: 1, document_number: 'F001-1' }],
      ['b', { id: 'b', version: 3, document_number: 'F001-2' }],
    ]);
    vi.resetModules();
    vi.doMock('../../db/jarvex.db', () => ({
      SYNC_STATUS: { PENDING_CREATE: 'pending_create', PENDING_UPDATE: 'pending_update' },
      db: {
        accounting_movements: {
          get: async (id) => almacen.get(id) || null,
          update: async (id, campos) => {
            if (!almacen.has(id)) return 0;
            almacen.set(id, { ...almacen.get(id), ...campos });
            return 1;
          },
        },
      },
    }));
  });

  it('aplica la misma cuenta a todos y firma cada uno', async () => {
    const { fijarCuentaEnLote } = await import('../cuenta-manual-db.js');
    const r = await fijarCuentaEnLote(['a', 'b'], { cuenta: '603' }, { userId: 'u1' });
    expect(r.ok).toBe(2);
    expect(r.fallaron).toEqual([]);
    for (const id of ['a', 'b']) {
      expect(almacen.get(id).cuenta_pcge).toBe('603');
      expect(almacen.get(id).cuenta_pcge_por).toBe('u1');
      expect(almacen.get(id).cuenta_pcge_at).toBeTruthy();
      expect(almacen.get(id).sync_status).toBe('pending_update');
    }
  });

  it('cada uno sube SU propia versión, no una compartida', async () => {
    const { fijarCuentaEnLote } = await import('../cuenta-manual-db.js');
    await fijarCuentaEnLote(['a', 'b'], { cuenta: '603' }, { userId: 'u1' });
    expect(almacen.get('a').version).toBe(2);
    expect(almacen.get('b').version).toBe(4);
  });

  it('no aborta al primer error: sigue y dice cuáles fallaron', async () => {
    // Dejar la mitad hecha sin decir cuál es peor que seguir.
    const { fijarCuentaEnLote } = await import('../cuenta-manual-db.js');
    const r = await fijarCuentaEnLote(['a', 'no-existe', 'b'], { cuenta: '603' }, { userId: 'u1' });
    expect(r.ok).toBe(2);
    expect(r.fallaron).toHaveLength(1);
    expect(r.fallaron[0].id).toBe('no-existe');
  });

  it('una cuenta inválida no escribe NADA, ni siquiera el primero', async () => {
    const { fijarCuentaEnLote } = await import('../cuenta-manual-db.js');
    const r = await fijarCuentaEnLote(['a', 'b'], { cuenta: '99' }, { userId: 'u1' });
    expect(r.ok).toBe(0);
    expect(r.fallaron).toHaveLength(2);
    expect(almacen.get('a').cuenta_pcge).toBeUndefined();
  });

  it('volver a automático borra la firma junto con la cuenta', async () => {
    const { fijarCuentaManual } = await import('../cuenta-manual-db.js');
    await fijarCuentaManual('a', { cuenta: '603' }, { userId: 'u1' });
    expect(almacen.get('a').cuenta_pcge_por).toBe('u1');

    const r = await fijarCuentaManual('a', { cuenta: null, contrapartida: null }, { userId: 'u2' });
    expect(r.vuelveAAutomatico).toBe(true);
    expect(almacen.get('a').cuenta_pcge).toBe(null);
    expect(almacen.get('a').cuenta_pcge_por).toBe(null);
    expect(almacen.get('a').cuenta_pcge_at).toBe(null);
  });

  it('corregir solo la contrapartida no toca la cuenta del gasto', async () => {
    const { fijarCuentaManual } = await import('../cuenta-manual-db.js');
    await fijarCuentaManual('a', { cuenta: '603' }, { userId: 'u1' });
    await fijarCuentaManual('a', { contrapartida: '104' }, { userId: 'u1' });
    expect(almacen.get('a').cuenta_pcge).toBe('603');
    expect(almacen.get('a').cuenta_pcge_contrapartida).toBe('104');
  });

  it('un movimiento que no está en este dispositivo lo dice', async () => {
    const { fijarCuentaManual } = await import('../cuenta-manual-db.js');
    const r = await fijarCuentaManual('fantasma', { cuenta: '603' }, {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sincroniz/i);
  });
});
