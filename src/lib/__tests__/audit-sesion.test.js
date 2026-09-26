// ═══════════════════════════════════════════════════════════════════
// LA AUDITORÍA SE FIRMA CON QUIEN ESTÁ ADENTRO (mig 231, 25-set-2026).
//
// Hasta la 231, audit_log aceptaba cualquier user_id (rls033_audit_insert
// WITH CHECK true): cualquiera podía firmar una entrada como la contadora.
// Ahora el server exige user_id = auth.uid(). En una PC compartida, la cola
// local puede tener filas del usuario anterior: esas NO se suben con la
// sesión del siguiente (rebotarían en cada ciclo para siempre); esperan a
// que su dueño vuelva a entrar.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, vi } from 'vitest';

const cola = [];
const insertados = [];
let sesion = null;

vi.mock('../../db/jarvex.db', () => ({
  db: {
    audit_log_pending: {
      where: () => ({ equals: () => ({ toArray: async () => cola.filter(r => !r.synced) }) }),
      filter: (fn) => ({
        toArray: async () => cola.filter(fn),
        delete: async () => 0,
      }),
      update: async (id, campos) => {
        const i = cola.findIndex(x => x.id === id);
        if (i >= 0) cola[i] = { ...cola[i], ...campos };
      },
    },
  },
  newId: () => `id-${cola.length + 1}`,
}));

vi.mock('../supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: sesion } }) },
    from: () => ({
      insert: async (payload) => { insertados.push(payload); return { error: null }; },
    }),
  },
}));

const { syncPendingAuditLogs } = await import('../audit');

const fila = (id, user_id) => ({
  id, user_id, user_email: `${user_id}@x`, action: 'insert', table_name: 'materiales',
  record_id: null, old_data: null, new_data: null, reason: null,
  created_at: '2026-09-25T10:00:00Z', synced: false,
});

describe('syncPendingAuditLogs', () => {
  beforeEach(() => {
    cola.length = 0;
    insertados.length = 0;
    sesion = null;
    vi.stubGlobal('navigator', { onLine: true });
  });

  it('sube solo las filas del usuario de la sesión', async () => {
    cola.push(fila('a', 'almacenera'), fila('b', 'contadora'), fila('c', 'almacenera'));
    sesion = { user: { id: 'almacenera' } };

    const n = await syncPendingAuditLogs();

    expect(n).toBe(2);
    expect(insertados.map(p => p.user_id)).toEqual(['almacenera', 'almacenera']);
    expect(cola.find(r => r.id === 'b').synced).toBe(false); // espera a su dueña
  });

  it('sin sesión no intenta nada', async () => {
    cola.push(fila('a', 'almacenera'));

    const n = await syncPendingAuditLogs();

    expect(n).toBe(0);
    expect(insertados).toHaveLength(0);
  });
});
