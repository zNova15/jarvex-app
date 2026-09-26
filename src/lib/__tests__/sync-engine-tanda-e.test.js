// ═══════════════════════════════════════════════════════════════════
// El SyncEngine de punta a punta (tanda E, 26-set-2026), con la base local
// en memoria y un Supabase de mentira que implementa el sync_pull de la
// mig 235 (cursor compuesto, `mas`, `__yo`, usuario inactivo).
//
// Las libs puras (pull-rpc, alcance-sync, techo-pull) tienen sus tests; esto
// prueba el CABLEADO: que el motor mande `i`, pida otra ronda cuando la página
// vino llena, no repita el recovery vacío, no caiga a ~117 GET cuando el RPC
// falla, cierre la sesión del usuario desactivado, re-baje todo cuando cambia
// el alcance y limpie lo del usuario anterior en una PC compartida.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Base local en memoria (lo mínimo de Dexie que usa el motor) ──────────
class Coleccion {
  constructor(tabla, pred) { this.tabla = tabla; this.pred = pred; }
  filter(fn) { return new Coleccion(this.tabla, r => this.pred(r) && fn(r)); }
  _filas() { return [...this.tabla.rows.values()].filter(this.pred); }
  async toArray() { return this._filas().map(r => ({ ...r })); }
  async count() { return this._filas().length; }
  async primaryKeys() { return this._filas().map(r => r[this.tabla.pk]); }
  async delete() { const f = this._filas(); f.forEach(r => this.tabla.rows.delete(r[this.tabla.pk])); return f.length; }
  async modify(cambio) {
    for (const r of this._filas()) {
      if (typeof cambio === 'function') cambio(r); else Object.assign(r, cambio);
    }
  }
}
class Tabla {
  constructor(nombre) {
    this.nombre = nombre;
    this.pk = nombre === 'sync_metadata' ? 'tabla' : (nombre === 'auth_cache' ? 'key' : 'id');
    this.rows = new Map();
  }
  async count() { return this.rows.size; }
  async get(id) { const r = this.rows.get(id); return r ? { ...r } : undefined; }
  async put(r) { this.rows.set(r[this.pk], { ...r }); }
  async add(r) { return this.put(r); }
  async bulkPut(rs) { for (const r of rs) await this.put(r); }
  async bulkAdd(rs) { return this.bulkPut(rs); }
  async delete(id) { this.rows.delete(id); }
  async bulkDelete(ids) { for (const id of ids) this.rows.delete(id); }
  async update(id, patch) { const r = this.rows.get(id); if (!r) return 0; Object.assign(r, patch); return 1; }
  async clear() { this.rows.clear(); }
  async toArray() { return [...this.rows.values()].map(r => ({ ...r })); }
  filter(fn) { return new Coleccion(this, fn); }
  where(campo) {
    return {
      equals: (v) => new Coleccion(this, r => r[campo] === v),
      anyOf: (arr) => new Coleccion(this, r => arr.includes(r[campo])),
    };
  }
}
function crearDb() {
  const tablas = new Map();
  return new Proxy({}, {
    get(_, prop) {
      if (prop === 'transaction') return async (...args) => args[args.length - 1]();
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      if (!tablas.has(prop)) tablas.set(prop, new Tabla(prop));
      return tablas.get(prop);
    },
  });
}

// ── Supabase de mentira ──────────────────────────────────────────────────
const ORDEN = (a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
function syncPullDelServidor(e, args) {
  if (e.rpcFalla) return { data: null, error: e.rpcFalla, status: e.rpcFalla.status || 500 };
  if (e.inactivo) return { data: { __err: 'usuario_inactivo' }, error: null, status: 200 };
  const cap = args.p_limit || 500;
  const res = { __yo: e.yo };
  for (const ent of args.p_entries) {
    const filas = (e.server[ent.t] || []);
    if (ent.i != null) {
      const sig = filas.filter(r => r.updated_at > ent.w || (r.updated_at === ent.w && r.id > ent.i)).sort(ORDEN).slice(0, cap);
      res[ent.k] = { rows: sig.map(r => ({ ...r })), mas: sig.length >= cap };
    } else {
      const sig = filas.filter(r => r.updated_at >= ent.w).sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, cap);
      res[ent.k] = sig.length >= cap ? { trunc: true } : { rows: sig.map(r => ({ ...r })) };
    }
  }
  return { data: res, error: null, status: 200 };
}
class Consulta {
  constructor(e, tabla) { this.e = e; this.tabla = tabla; this.filtros = []; this.lim = null; this.op = 'select'; }
  select() { return this; }
  is(c, v) { this.filtros.push(r => (r[c] ?? null) === v); return this; }
  gte(c, v) { this.filtros.push(r => r[c] >= v); return this; }
  gt(c, v) { this.filtros.push(r => r[c] > v); return this; }
  eq(c, v) { this.filtros.push(r => r[c] === v); return this; }
  in(c, arr) { this.filtros.push(r => arr.includes(r[c])); return this; }
  or(expr) {
    const m = expr.match(/^updated_at\.gt\.(.+?),and\(updated_at\.eq\.(.+?),id\.gt\.(.+)\)$/);
    this.filtros.push(r => r.updated_at > m[1] || (r.updated_at === m[2] && r.id > m[3]));
    return this;
  }
  order() { return this; }
  limit(n) { this.lim = n; return this; }
  maybeSingle() { this.uno = true; return this; }
  insert(rows) { this.op = 'insert'; this.filas = rows; return this; }
  update(p) { this.op = 'update'; this.patch = p; return this; }
  then(ok, mal) { return Promise.resolve(this._ejecutar()).then(ok, mal); }
  _ejecutar() {
    this.e.rest.push({ tabla: this.tabla, op: this.op });
    if (this.op === 'insert') {
      if (this.e.insertError) return { data: null, error: this.e.insertError };
      (this.e.server[this.tabla] ||= []).push(...this.filas.map(r => ({ ...r, updated_at: this.e.ahora })));
      return { data: null, error: null };
    }
    let filas = (this.e.server[this.tabla] || []).filter(r => this.filtros.every(f => f(r)));
    filas.sort((a, b) => (a.id < b.id ? -1 : 1));
    if (this.lim) filas = filas.slice(0, this.lim);
    if (this.uno) return { data: filas[0] || null, error: null };
    return { data: filas.map(r => ({ ...r })), error: null };
  }
}
// El registro de mocks sobrevive a vi.resetModules(): todo lee el estado del
// test EN CURSO (globalThis.__fx) al momento de cada llamada.
const fx = () => globalThis.__fx;
function crearSupabase() {
  return {
    auth: {
      getSession: async () => {
        const e = fx();
        e.llamadasSesion = (e.llamadasSesion || 0) + 1;
        // «La sesión se cae a mitad del ciclo»: vale para la primera consulta.
        if (e.caeSesionDespuesDe != null && e.llamadasSesion > e.caeSesionDespuesDe) return { data: { session: null }, error: null };
        return { data: { session: e.session }, error: null };
      },
      refreshSession: async () => ({ data: { session: fx().session }, error: null }),
    },
    rpc: async (fn, args) => { fx().rpcs.push(args); return syncPullDelServidor(fx(), args); },
    from: (t) => new Consulta(fx(), t),
  };
}

vi.mock('../../db/jarvex.db', () => {
  const E = { get db() { return globalThis.__fx.db; } };
  return {
    db: new Proxy({}, { get: (_, p) => globalThis.__fx.db[p] }),
    SYNC_STATUS: { SYNCED: 'synced', PENDING_CREATE: 'pending_create', PENDING_UPDATE: 'pending_update', PENDING_DELETE: 'pending_delete', CONFLICT: 'conflict', FAILED: 'failed' },
    UPLOAD_STATUS: { PENDING: 'pending_upload', UPLOADED: 'uploaded', FAILED: 'failed' },
    getLastSync: async (t) => (await E.db.sync_metadata.get(t))?.last_synced_at ?? null,
    getLastSyncId: async (t) => (await E.db.sync_metadata.get(t))?.last_synced_id ?? null,
    setLastSync: async (t, ts, id = null) => E.db.sync_metadata.put({ tabla: t, last_synced_at: ts, last_synced_id: id }),
  };
});
vi.mock('../../lib/supabase', () => ({ supabase: crearSupabase() }));
vi.mock('../../sync/EvidenceUploader', () => ({ uploadPendingEvidencias: async () => {} }));
vi.mock('../../lib/audit', () => ({ syncPendingAuditLogs: async () => 0 }));
vi.mock('../../lib/changeRequests', () => ({ syncPendingChangeRequests: async () => 0 }));
vi.mock('../../instrument.js', () => ({ captureException: () => {}, captureMessage: () => {} }));
vi.mock('../../lib/posthog.js', () => ({ trackEvent: () => {} }));

// ── Entorno de navegador mínimo ──────────────────────────────────────────
function montarEntorno() {
  const win = new EventTarget();
  win.__currentRol = 'admin';
  win.eventos = [];
  const disp = win.dispatchEvent.bind(win);
  win.dispatchEvent = (ev) => { win.eventos.push(ev.type); return disp(ev); };
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  const ls = new Map();
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('localStorage', {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k),
  });
  // Las reparaciones «una vez por dispositivo» ya corrieron en este equipo.
  ls.set('jx_masterfin_wm_repair_v3', 'x');
  ls.set('jx_txwm_repair_v3', 'x');
  ls.set('jx_fantasmas_realtime_v3', 'x');
  return win;
}

let E; let engine; let win;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  E = {
    db: crearDb(), server: {}, rest: [], rpcs: [],
    session: { user: { id: 'u1' }, access_token: 't' },
    yo: { rol: 'admin', global: true, obras: null },
    ahora: '2026-09-26T12:00:00.000Z',
  };
  globalThis.__fx = E;
  win = montarEntorno();
  vi.resetModules();
  engine = await import('../../sync/SyncEngine');
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const W1 = '2026-09-20T10:00:00.000Z';
const W2 = '2026-09-25T10:00:00.000Z';
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const pullDe = (tabla) => E.rest.filter(c => c.tabla === tabla && c.op === 'select').length;
const entradaDe = (rpc, k) => rpc.p_entries.find(x => x.k === k);

describe('SyncEngine — compuertas del ciclo', () => {
  it('sin sesión: no sincroniza y lo AVISA (antes volvía en silencio)', async () => {
    E.session = null;
    const r = await engine.syncAll();
    expect(r.estado).toBe('sin_sesion');
    expect(win.eventos).toContain('jx_sin_sesion');
    expect(E.rpcs.length).toBe(0);
  });

  it('sin rol publicado todavía: no corre (canPushTabla dejaba pasar todo)', async () => {
    win.__currentRol = null;
    const r = await engine.syncAll();
    expect(r.estado).toBe('omitido');
    expect(E.rpcs.length).toBe(0);
  });
});

describe('SyncEngine — pull por cursor compuesto', () => {
  it('manda `i`, trae SOLO lo posterior al borde y sella synced', async () => {
    await E.db.obras.put({ id: id(1), updated_at: W1, nombre_obra: 'o', nombre: 'A', sync_status: 'synced' });
    await E.db.sync_metadata.put({ tabla: 'obras', last_synced_at: W1, last_synced_id: id(1) });
    E.server.obras = [
      { id: id(1), updated_at: W1, nombre_obra: 'A' },
      { id: id(2), updated_at: W1, nombre_obra: 'B' },   // mismo sello, id mayor: SÍ viene
      { id: id(3), updated_at: W2, nombre_obra: 'C' },
    ];
    const r = await engine.syncAll();
    expect(r.estado).toBe('ok');
    const ent = entradaDe(E.rpcs[0], 'm:obras');
    expect(ent).toEqual({ k: 'm:obras', t: 'obras', w: W1, i: id(1) });
    expect(await E.db.obras.count()).toBe(3);
    expect((await E.db.obras.get(id(3))).sync_status).toBe('synced');
    const meta = await E.db.sync_metadata.get('obras');
    expect(meta).toMatchObject({ last_synced_at: W2, last_synced_id: id(3) });
    expect(pullDe('obras')).toBe(0); // ni un GET por tabla
  });

  it('una tabla viaja UNA sola vez: m: para las maestras, t: solo para las transaccional-only', async () => {
    await engine.syncAll();
    const keys = E.rpcs[0].p_entries.map(e => e.k);
    expect(keys).toContain('m:obras');
    expect(keys).not.toContain('t:obras');
    expect(keys).toContain('t:movimientos_materiales');
    expect(keys).not.toContain('m:movimientos_materiales');
    expect(new Set(keys.map(k => k.slice(2))).size).toBe(keys.length);
  });

  it('página llena (`mas`) → otra ronda SOLO para esa tabla, hasta traer todo', async () => {
    await E.db.partidas.put({ id: id(0), updated_at: W1, nombre_partida: 'p', sync_status: 'synced' });
    await E.db.sync_metadata.put({ tabla: 'partidas', last_synced_at: W1, last_synced_id: id(0) });
    E.server.partidas = [{ id: id(0), updated_at: W1, nombre_partida: 'p' }];
    // 1.200 filas importadas de golpe, TODAS con el mismo sello (la forma del 9-sep).
    for (let n = 1; n <= 1200; n++) E.server.partidas.push({ id: id(n), updated_at: W2, nombre_partida: 'p' });
    await engine.syncAll();
    expect(E.rpcs.length).toBe(3);                       // 500 + 500 + 200
    expect(E.rpcs[1].p_entries.map(e => e.k)).toEqual(['m:partidas']);
    expect(E.rpcs[1].p_entries[0]).toMatchObject({ w: W2, i: id(500) });
    expect(await E.db.partidas.count()).toBe(1201);
    // El ciclo siguiente no vuelve a bajar el bloque de sellos iguales.
    E.rpcs = [];
    await engine.syncAll();
    expect(E.rpcs.length).toBe(1);
    expect(entradaDe(E.rpcs[0], 'm:partidas')).toMatchObject({ w: W2, i: id(1200) });
  });
});

describe('SyncEngine — el bucle de recovery vacío', () => {
  it('tabla con watermark, vacía acá y solo con borradas en el server: un GET y listo, no uno por ciclo', async () => {
    await E.db.sync_metadata.put({ tabla: 'iperc', last_synced_at: W1, last_synced_id: id(5) });
    E.server.iperc = [{ id: id(5), updated_at: W1, deleted_at: W1 }];
    await engine.syncAll();
    expect(pullDe('iperc')).toBe(1);
    await engine.syncAll();
    await engine.syncAll();
    expect(pullDe('iperc')).toBe(1);                       // antes: 1-2 por ciclo, para siempre
    expect(entradaDe(E.rpcs.at(-1), 'm:iperc')).toMatchObject({ w: W1, i: id(5) });
  });
});

describe('SyncEngine — errores globales del RPC', () => {
  it('el RPC falla (5xx/timeout): corta el pull del ciclo, NO dispara ~117 GET por tabla', async () => {
    E.rpcFalla = { message: 'canceling statement due to statement timeout', code: '57014', status: 500 };
    const r = await engine.syncAll();
    expect(r.estado).toBe('error');
    expect(E.rest.filter(c => c.op === 'select').length).toBe(0);
  });

  it('usuario desactivado (mig 235): el ciclo termina y se avisa para cerrar la sesión', async () => {
    E.inactivo = true;
    const r = await engine.syncAll();
    expect(r.estado).toBe('sin_sesion');
    expect(win.eventos).toContain('jx_usuario_inactivo');
    expect(E.rest.filter(c => c.op === 'select').length).toBe(0);
  });
});

describe('SyncEngine — alcance del dispositivo', () => {
  it('le designan otra obra: se resetean los cursores y el próximo ciclo re-baja todo', async () => {
    win.__currentRol = 'ingeniero';
    E.yo = { rol: 'ingeniero', global: false, obras: [id(100)] };
    await E.db.obras.put({ id: id(100), updated_at: W1, nombre_obra: 'o', sync_status: 'synced' });
    await E.db.sync_metadata.put({ tabla: 'obras', last_synced_at: W2, last_synced_id: id(100) });
    await engine.syncAll();                                  // primera huella: se anota
    expect(await E.db.sync_metadata.get('obras')).toMatchObject({ last_synced_at: W2 });

    E.yo = { rol: 'ingeniero', global: false, obras: [id(100), id(200)] };
    // El histórico de la obra nueva tiene sellos VIEJOS: el cursor ya estaba por delante.
    E.server.obras = [{ id: id(100), updated_at: W1, nombre_obra: 'o' }, { id: id(200), updated_at: W1, nombre_obra: 'o' }];
    await engine.syncAll();
    expect(win.eventos).toContain('jx_alcance_cambio');
    expect(await E.db.sync_metadata.get('obras')).toMatchObject({ last_synced_at: null });

    await engine.syncAll();                                  // full pull con reconcile
    expect(await E.db.obras.get(id(200))).toBeTruthy();
  });

  it('PC compartida: entra otra persona → se descarta lo del anterior (nunca lo pendiente)', async () => {
    await engine.syncAll();                                  // u1 queda anotado
    await E.db.obras.put({ id: id(1), updated_at: W1, nombre_obra: 'o', sync_status: 'synced', nombre: 'de u1' });
    await E.db.obras.put({ id: id(2), updated_at: W1, nombre_obra: 'o', sync_status: 'pending_create', nombre: 'sin subir' });
    await E.db.sync_metadata.put({ tabla: 'obras', last_synced_at: W2, last_synced_id: id(1) });

    E.session = { user: { id: 'u2' }, access_token: 't2' };
    E.server.obras = [{ id: id(9), updated_at: W1, nombre_obra: 'o', nombre: 'de u2' }];
    await engine.syncAll();
    expect(await E.db.obras.get(id(1))).toBeUndefined();     // lo sincronizado del anterior
    expect(await E.db.obras.get(id(9))).toBeTruthy();        // lo que ve el nuevo
    // lo pendiente se conserva (y el push de este ciclo lo subió)
    const pend = await E.db.obras.get(id(2));
    expect(pend).toBeTruthy();
  });
});

describe('SyncEngine — sin sesión antes que RLS (push)', () => {
  const pendiente = () => ({ id: id(7), updated_at: W1, nombre_obra: 'o', sync_status: 'pending_create', version: 1 });
  const RLS = { code: '42501', message: 'new row violates row-level security policy for table "obras"' };

  it('la sesión se cayó y el INSERT volvió 42501 (anon key): NO se congela como «bloqueado por RLS»', async () => {
    await E.db.obras.put(pendiente());
    E.insertError = RLS;
    E.caeSesionDespuesDe = 1;                    // el ciclo arranca con sesión y la pierde
    await engine.syncAll();
    const r = await E.db.obras.get(id(7));
    expect(r.sync_status).toBe('pending_create');
    expect(r._last_error_is_rls).toBeFalsy();
    expect(r._sync_retries ?? 0).toBe(0);        // no cuenta como intento
    expect(win.eventos).toContain('jx_sin_sesion');
  });

  it('con sesión, un 42501 SÍ es de permisos: FAILED y marcado RLS (como siempre)', async () => {
    await E.db.obras.put(pendiente());
    E.insertError = RLS;
    await engine.syncAll();
    const r = await E.db.obras.get(id(7));
    expect(r.sync_status).toBe('failed');
    expect(r._last_error_is_rls).toBe(true);
  });
});
