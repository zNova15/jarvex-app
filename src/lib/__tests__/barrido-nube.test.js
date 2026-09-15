// ═══════════════════════════════════════════════════════════════════
// LAS RECOMENDACIONES DE IA CRUZAN DE PC (mig 217, 15-set-2026).
//
// Gabriel: «probé en la PC de la Contadora en Jefe y a ella no le salen las
// recomendaciones por IA por las que pagué». Vivían en localStorage, que está
// atado al navegador Y al dominio.
//
// Acá se cuida la parte PURA del rescate: cómo se parte la clave
// `seccion::ambito::id` para subir lo que estaba solo local. Es la que puede
// romperse en silencio, porque el `id` de un candidato de correlación tiene
// «::» adentro — es su contenido ordenado, no un identificador opaco.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Dexie no se toca: se mockea la tabla para poder afirmar QUÉ se le pidió.
const filas = [];
vi.mock('../../db/jarvex.db', () => ({
  db: {
    ia_recomendaciones: {
      filter: (fn) => ({
        toArray: async () => filas.filter(fn),
        first: async () => filas.filter(fn)[0] || null,
      }),
      add: async (f) => { filas.push(f); return f.id; },
      update: async (id, campos) => {
        const i = filas.findIndex(x => x.id === id);
        if (i >= 0) filas[i] = { ...filas[i], ...campos };
      },
      delete: async (id) => {
        const i = filas.findIndex(x => x.id === id);
        if (i >= 0) filas.splice(i, 1);
      },
    },
  },
  newId: () => `id-${filas.length + 1}`,
  newIdempotencyKey: () => `k-${filas.length + 1}`,
  SYNC_STATUS: { SYNCED: 'synced', PENDING_CREATE: 'pending_create', PENDING_UPDATE: 'pending_update', PENDING_DELETE: 'pending_delete' },
}));

let nube;
beforeEach(async () => {
  filas.length = 0;
  nube = await import('../barrido-nube.js');
});

describe('guardar y leer', () => {
  it('una propuesta nueva se crea pendiente de push', async () => {
    await nube.guardar('clasificacion', 'emp1', 'cemento', { codigo: '21', confianza: 0.9, t: 123 });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      seccion: 'clasificacion', ambito: 'emp1', item_id: 'cemento',
      sync_status: 'pending_create',
    });
    // 🔴 El `t` de la caché local NO viaja: la marca de tiempo de la base es
    // `updated_at`, y dos relojes para lo mismo es cómo se fabrican los
    // desacuerdos entre las dos PCs.
    expect(filas[0].datos).toEqual({ codigo: '21', confianza: 0.9 });
  });

  it('volver a guardar la misma pisa, no duplica', async () => {
    await nube.guardar('clasificacion', 'emp1', 'cemento', { codigo: '21' });
    await nube.guardar('clasificacion', 'emp1', 'cemento', { codigo: '11' });
    expect(filas).toHaveLength(1);
    expect(filas[0].datos.codigo).toBe('11');
  });

  it('la misma descripción en otro ámbito es otra propuesta', async () => {
    await nube.guardar('clasificacion', 'emp1', 'cemento', { codigo: '21' });
    await nube.guardar('clasificacion', 'emp2', 'cemento', { codigo: '21' });
    expect(filas).toHaveLength(2);
  });

  it('se leen en el formato del mapa de barrido-store', async () => {
    await nube.guardar('clasificacion', 'emp1', 'cemento', { codigo: '21' });
    const m = await nube.leerTodas();
    expect(Object.keys(m)).toEqual(['clasificacion::emp1::cemento']);
    expect(m['clasificacion::emp1::cemento']).toMatchObject({ codigo: '21' });
    expect(typeof m['clasificacion::emp1::cemento'].t).toBe('number');
  });
});

describe('olvidar', () => {
  it('lo que nunca llegó al server se borra de verdad', async () => {
    await nube.guardar('clasificacion', 'emp1', 'cemento', { codigo: '21' });
    await nube.olvidar('clasificacion', 'emp1', 'cemento');
    expect(filas).toHaveLength(0);
  });

  it('lo que ya viajó queda como tombstone, para que el borrado llegue a la otra PC', async () => {
    await nube.guardar('clasificacion', 'emp1', 'cemento', { codigo: '21' });
    filas[0].sync_status = 'synced';
    await nube.olvidar('clasificacion', 'emp1', 'cemento');
    expect(filas).toHaveLength(1);
    expect(filas[0].deleted_at).toBeTruthy();
    expect(filas[0].sync_status).toBe('pending_delete');
  });

  it('limpiar se lleva todas las del ámbito y ninguna de otro', async () => {
    await nube.guardar('clasificacion', 'emp1', 'a', {});
    await nube.guardar('clasificacion', 'emp1', 'b', {});
    await nube.guardar('clasificacion', 'emp2', 'c', {});
    await nube.limpiar('clasificacion', 'emp1');
    expect(filas.map(f => f.item_id)).toEqual(['c']);
  });
});

describe('🔴 el rescate de lo ya pagado', () => {
  it('sube lo que estaba solo en localStorage', async () => {
    const local = {
      'clasificacion::emp1::cemento': { codigo: '21', t: Date.now() },
      'clasificacion::emp1::fierro': { codigo: '03', t: Date.now() },
    };
    const n = await nube.subirFaltantes(local, { yaEnLaNube: {} });
    expect(n).toBe(2);
    expect(filas.map(f => f.item_id).sort()).toEqual(['cemento', 'fierro']);
  });

  it('no vuelve a subir lo que ya está en la base', async () => {
    const local = { 'clasificacion::emp1::cemento': { codigo: '21' } };
    const n = await nube.subirFaltantes(local, {
      yaEnLaNube: { 'clasificacion::emp1::cemento': { codigo: '21' } },
    });
    expect(n).toBe(0);
    expect(filas).toHaveLength(0);
  });

  it('🔴 un id de correlación con «::» adentro no se parte mal', () => {
    // El id de un candidato de correlación ES su contenido ordenado, con los
    // nombres pegados. Partir por el ÚLTIMO «::» —o por todos— romperia la
    // clave y subiria una propuesta que nadie puede volver a encontrar.
    const id = 'par:TUBO A|TUBO B';
    const clave = `correlaciones::emp1::insumos::${id}`;
    return nube.subirFaltantes({ [clave]: { mismas: [] } }, { yaEnLaNube: {} })
      .then(() => {
        expect(filas).toHaveLength(1);
        expect(filas[0].seccion).toBe('correlaciones');
        expect(filas[0].ambito).toBe('emp1');
        // Todo lo que sigue al segundo separador es el id, con sus «::» intactos.
        expect(filas[0].item_id).toBe(`insumos::${id}`);
      });
  });

  it('una clave mal formada se saltea en vez de romper el rescate', async () => {
    const n = await nube.subirFaltantes({ 'sinseparadores': {} }, { yaEnLaNube: {} });
    expect(n).toBe(0);
  });
});
