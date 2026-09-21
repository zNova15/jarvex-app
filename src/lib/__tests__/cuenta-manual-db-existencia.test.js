// Tanda 5 del destino — la escritura de la salida de inventario.
//
// Se testea contra un Dexie de mentira porque lo que importa es el CONTRATO:
// QUÉ columnas se escriben y CUÁNDO. Dos cosas de acá no se pueden verificar
// con la lib pura y son las que rompen en producción:
//
//   1. 🔴 EL GUARDIÁN DEL CHECK. Si el destino deja de ser una existencia, la
//      salida tiene que borrarse EN LA MISMA escritura. Si se olvidara, la
//      fila violaría el CHECK de la mig 224, el push rebotaría con 23514 y el
//      sync quedaría en reintento eterno — la regla 9 del CLAUDE.md.
//   2. EL CANDADO DE LA SALIDA MIRA SU PROPIA FECHA, no la de la factura. Es
//      el punto entero de la tanda: una compra de mayo consumida en setiembre
//      es un costo de setiembre y tiene que poder guardarse aunque mayo esté
//      declarado.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let filas;
let updates;
let auditorias;

const mov = (extra = {}) => ({
  id: 'm1',
  date: '2026-09-02',
  document_number: 'F001-1',
  version: 3,
  sync_status: 'synced',
  cuenta_pcge: null,
  cuenta_pcge_contrapartida: null,
  cuenta_pcge_destino: null,
  ...extra,
});

beforeEach(() => {
  updates = [];
  auditorias = [];
  filas = new Map([['m1', mov()]]);
  globalThis.window = {
    dispatchEvent: () => {},
    __logAudit: async (d) => auditorias.push(d),
  };
  globalThis.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o); } };
  vi.resetModules();
  vi.doMock('../../db/jarvex.db', () => ({
    SYNC_STATUS: { PENDING_CREATE: 'pending_create', PENDING_UPDATE: 'pending_update' },
    db: {
      accounting_movements: {
        get: async (id) => filas.get(id) || null,
        update: async (id, cambios) => {
          updates.push(cambios);
          filas.set(id, { ...filas.get(id), ...cambios });
        },
      },
    },
  }));
});

const cargar = () => import('../cuenta-manual-db.js');

// ── 1. EL GUARDIÁN DEL CHECK ──────────────────────────────────────
describe('la salida no puede quedar huérfana de su destino', () => {
  const conSalida = {
    cuenta_pcge_destino: '241',
    existencia_salida_cuenta: '92',
    existencia_salida_fecha: '2026-09-15',
    existencia_salida_importe: 100,
  };

  it('cambiar el destino a una cuenta del elemento 9 BORRA la salida, en la misma escritura', async () => {
    filas.set('m1', mov(conSalida));
    const { fijarCuentaManual } = await cargar();
    const r = await fijarCuentaManual('m1', { destino: '94' }, { userId: 'u1' });
    expect(r.ok).toBe(true);
    expect(updates).toHaveLength(1);           // UNA sola escritura, no dos
    const u = updates[0];
    expect(u.cuenta_pcge_destino).toBe('94');
    // Las cinco columnas de la salida, en null. Entre dos updates la fila
    // sería inválida y el sync no espera a que terminemos.
    expect(u.existencia_salida_cuenta).toBe(null);
    expect(u.existencia_salida_fecha).toBe(null);
    expect(u.existencia_salida_importe).toBe(null);
    expect(u.existencia_salida_por).toBe(null);
    expect(u.existencia_salida_at).toBe(null);
  });

  it('vaciar el destino también la borra', async () => {
    filas.set('m1', mov(conSalida));
    const { fijarCuentaManual } = await cargar();
    await fijarCuentaManual('m1', { destino: null }, { userId: 'u1' });
    expect(updates[0].existencia_salida_cuenta).toBe(null);
  });

  it('cambiar de una existencia a OTRA no la toca', async () => {
    filas.set('m1', mov(conSalida));
    const { fijarCuentaManual } = await cargar();
    await fijarCuentaManual('m1', { destino: '251' }, { userId: 'u1' });
    expect('existencia_salida_cuenta' in updates[0]).toBe(false);
  });

  it('corregir solo la cuenta del gasto no toca la salida', async () => {
    filas.set('m1', mov(conSalida));
    const { fijarCuentaManual } = await cargar();
    await fijarCuentaManual('m1', { cuenta: '603' }, { userId: 'u1' });
    expect('existencia_salida_cuenta' in updates[0]).toBe(false);
  });

  it('el borrado por arrastre queda dicho en Auditoría', async () => {
    filas.set('m1', mov(conSalida));
    const { fijarCuentaManual } = await cargar();
    await fijarCuentaManual('m1', { destino: '94' }, { userId: 'u1' });
    expect(auditorias[0].oldData.existencia_salida_cuenta).toBe('92');
    expect(auditorias[0].oldData.existencia_salida_importe).toBe(100);
  });
});

// ── 2. LA ESCRITURA DE LA SALIDA ──────────────────────────────────
describe('fijarSalidaExistencia', () => {
  const enExistencia = { cuenta_pcge_destino: '241' };

  it('escribe las cinco columnas con la firma de quién descargó', async () => {
    filas.set('m1', mov(enExistencia));
    const { fijarSalidaExistencia } = await cargar();
    const r = await fijarSalidaExistencia(
      'm1',
      { cuenta: '92', fecha: '2026-09-15', importe: 400 },
      { userId: 'u1', entro: 1000 },
    );
    expect(r.ok).toBe(true);
    const u = updates[0];
    expect(u.existencia_salida_cuenta).toBe('92');
    expect(u.existencia_salida_fecha).toBe('2026-09-15');
    expect(u.existencia_salida_importe).toBe(400);
    expect(u.existencia_salida_por).toBe('u1');
    expect(u.existencia_salida_at).toBeTruthy();
    // Y el movimiento sale a sincronizar con la versión subida.
    expect(u.version).toBe(4);
    expect(u.sync_status).toBe('pending_update');
  });

  it('no deja descargar lo que no está en una existencia', async () => {
    filas.set('m1', mov({ cuenta_pcge_destino: '94' }));
    const { fijarSalidaExistencia } = await cargar();
    const r = await fijarSalidaExistencia('m1', { cuenta: '92', fecha: '2026-09-15', importe: 10 }, {});
    expect(r.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('no deja sacar más de lo que entró', async () => {
    filas.set('m1', mov(enExistencia));
    const { fijarSalidaExistencia } = await cargar();
    const r = await fijarSalidaExistencia(
      'm1', { cuenta: '92', fecha: '2026-09-15', importe: 5000 }, { entro: 1000 },
    );
    expect(r.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('borrar la salida deja las cinco columnas en null', async () => {
    filas.set('m1', mov({
      ...enExistencia,
      existencia_salida_cuenta: '92',
      existencia_salida_fecha: '2026-09-15',
      existencia_salida_importe: 400,
    }));
    const { fijarSalidaExistencia } = await cargar();
    const r = await fijarSalidaExistencia('m1', {}, { userId: 'u1' });
    expect(r.ok).toBe(true);
    expect(r.borrada).toBe(true);
    expect(updates[0].existencia_salida_cuenta).toBe(null);
    expect(updates[0].existencia_salida_importe).toBe(null);
  });

  // 🔴 El punto entero de la tanda: el costo pertenece al mes en que se USÓ.
  it('el candado mira la fecha de la SALIDA, no la de la factura', async () => {
    // Factura de mayo (dentro del período cerrado, que por defecto va hasta
    // el 31-jul-2026) consumida en setiembre, que está abierto.
    filas.set('m1', mov({ ...enExistencia, date: '2026-05-10' }));
    const { fijarSalidaExistencia } = await cargar();
    const r = await fijarSalidaExistencia(
      'm1', { cuenta: '92', fecha: '2026-09-15', importe: 100 }, { userId: 'u1', entro: 1000 },
    );
    expect(r.ok).toBe(true);
    expect(updates).toHaveLength(1);
  });

  // 🔴 CAMBIÓ EL 22-set-2026: el mes ya presentado se REGISTRA, no se frena
  // (pedido de Gabriel, para el cierre anual). Ver `periodo-contable.js`.
  it('una salida CON fecha de un mes declarado se guarda, y la auditoría lo dice', async () => {
    filas.set('m1', mov(enExistencia));
    const { fijarSalidaExistencia } = await cargar();
    const r = await fijarSalidaExistencia(
      'm1', { cuenta: '92', fecha: '2026-06-20', importe: 100 }, { userId: 'u1', entro: 1000 },
    );
    expect(r.ok).toBe(true);
    expect(updates).toHaveLength(1);
    expect(auditorias[0].reason).toMatch(/período ya presentado/);
  });

  it('deshacer una descarga de un mes declarado tampoco se frena, y también queda dicho', async () => {
    filas.set('m1', mov({
      ...enExistencia,
      existencia_salida_cuenta: '92',
      existencia_salida_fecha: '2026-06-20',
      existencia_salida_importe: 100,
    }));
    const { fijarSalidaExistencia } = await cargar();
    const r = await fijarSalidaExistencia('m1', {}, { userId: 'u1' });
    expect(r.ok).toBe(true);
    expect(r.borrada).toBe(true);
    expect(auditorias[0].reason).toMatch(/período ya presentado/);
  });
});

// ── 3. EL CANDADO QUE YA NO FRENA ─────────────────────────────────
// Gabriel, 22-set-2026: «quiero que desbloquees el libro diario para
// modificaciones de cualquier fecha, así ya esté presentada. Me dijeron las
// asistentes de contabilidad que eso se utiliza para el anual de contabilidad».
// Estos tests son los que vigilan que no vuelva a aparecer una traba.
describe('los meses ya presentados se registran, no se frenan', () => {
  it('corregir la cuenta de un comprobante de un mes declarado se guarda', async () => {
    filas.set('m1', mov({ date: '2026-03-15' }));
    const { fijarCuentaManual } = await cargar();
    const r = await fijarCuentaManual('m1', { cuenta: '656' }, { userId: 'u1' });
    expect(r.ok).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].cuenta_pcge).toBe('656');
  });

  it('y la auditoría deja escrito que se tocó un período presentado', async () => {
    filas.set('m1', mov({ date: '2026-03-15' }));
    const { fijarCuentaManual } = await cargar();
    await fijarCuentaManual('m1', { cuenta: '656' }, { userId: 'u1' });
    expect(auditorias[0].reason).toMatch(/período ya presentado/);
  });

  it('un mes abierto no lleva esa coletilla', async () => {
    filas.set('m1', mov({ date: '2026-09-15' }));
    const { fijarCuentaManual } = await cargar();
    await fijarCuentaManual('m1', { cuenta: '656' }, { userId: 'u1' });
    expect(auditorias[0].reason).not.toMatch(/período ya presentado/);
  });
});
