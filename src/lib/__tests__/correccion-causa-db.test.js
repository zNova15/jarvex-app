// La escritura de la causa (tanda 3 del destino): dónde aterriza cada
// corrección de clasificación. Se testea contra módulos de mentira porque lo
// que importa es el CONTRATO —qué se escribe y dónde—, no cómo lo hace Dexie.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let llamadas;
let catalogo;
let eventos;

beforeEach(() => {
  llamadas = [];
  eventos = [];
  catalogo = new Map([
    ['c-amol', { id: 'c-amol', nombre: 'AMOLADORA ANGULAR 4 1/2', familia: '02' }],
  ]);
  globalThis.window = {
    dispatchEvent: (e) => eventos.push(e.detail?.tabla),
    __logAudit: async (d) => llamadas.push(['audit', d.table]),
  };
  globalThis.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o); } };
  vi.resetModules();
  vi.doMock('../../db/jarvex.db', () => ({
    db: { catalogo_insumos: { get: async (id) => catalogo.get(id) || null } },
  }));
  vi.doMock('../catalogo-canonico-db.js', () => ({
    corregirEntrada: async (id, cambios) => { llamadas.push(['corregirEntrada', id, cambios.familia]); return true; },
  }));
  vi.doMock('../bandeja-categorizacion-db.js', () => ({
    agregarAlCatalogoYDecidir: async (fila, opts) => {
      llamadas.push(['alta', fila.norm, opts.familia, opts.companyId]);
      // Simula el caso peligroso: ya existía un insumo con ese nombre y se
      // REUSA con su familia vieja.
      if (fila.norm === 'ya existia') return { id: 'c-viejo', familia: '21' };
      return { id: 'c-nuevo', familia: opts.familia };
    },
  }));
});

describe('dónde aterriza cada corrección', () => {
  it('alcance insumo: corrige la familia del insumo del catálogo', async () => {
    const { corregirClasificaciones } = await import('../correccion-causa-db.js');
    const r = await corregirClasificaciones([
      { norm: 'amoladora', descripcion: 'AMOLADORA ANGULAR 4 1/2', familia: '37', alcance: 'insumo', catalogoId: 'c-amol' },
    ], { companyId: 'emp1', userId: 'u1' });
    expect(r.hechas).toHaveLength(1);
    expect(llamadas).toContainEqual(['corregirEntrada', 'c-amol', '37']);
    expect(llamadas.some(l => l[0] === 'alta')).toBe(false);
  });

  it('alcance descripción: la da de alta como insumo propio, en la empresa del comprobante', async () => {
    const { corregirClasificaciones } = await import('../correccion-causa-db.js');
    await corregirClasificaciones([
      { norm: 'amoladora bosch', descripcion: 'AMOLADORA BOSCH', familia: '37', alcance: 'descripcion' },
    ], { companyId: 'emp1', userId: 'u1' });
    expect(llamadas).toContainEqual(['alta', 'amoladora bosch', '37', 'emp1']);
    expect(llamadas.some(l => l[0] === 'corregirEntrada')).toBe(false);
  });

  it('si el alta REUSA un insumo con la familia vieja, se la corrige: si no, la decisión apuntaría al error', async () => {
    const { corregirClasificaciones } = await import('../correccion-causa-db.js');
    await corregirClasificaciones([
      { norm: 'ya existia', descripcion: 'YA EXISTIA', familia: '37', alcance: 'descripcion' },
    ], { companyId: 'emp1' });
    expect(llamadas).toContainEqual(['corregirEntrada', 'c-viejo', '37']);
  });

  it('un insumo que no está en este dispositivo falla solo, sin frenar a los demás', async () => {
    const { corregirClasificaciones } = await import('../correccion-causa-db.js');
    const r = await corregirClasificaciones([
      { norm: 'x', descripcion: 'X', familia: '37', alcance: 'insumo', catalogoId: 'no-existe' },
      { norm: 'amoladora', descripcion: 'AMOLADORA', familia: '37', alcance: 'insumo', catalogoId: 'c-amol' },
    ], {});
    expect(r.fallaron).toHaveLength(1);
    expect(r.fallaron[0].error).toMatch(/sincroniz/i);
    expect(r.hechas).toHaveLength(1);
  });

  it('avisa a las dos tablas: sin el aviso, el Libro Diario seguía mostrando la cuenta vieja', async () => {
    const { corregirClasificaciones } = await import('../correccion-causa-db.js');
    await corregirClasificaciones([
      { norm: 'amoladora', descripcion: 'AMOLADORA', familia: '37', alcance: 'insumo', catalogoId: 'c-amol' },
    ], {});
    expect(eventos).toEqual(expect.arrayContaining(['catalogo_insumos', 'insumo_categoria']));
  });

  it('cada corrección queda en auditoría', async () => {
    const { corregirClasificaciones } = await import('../correccion-causa-db.js');
    await corregirClasificaciones([
      { norm: 'amoladora', descripcion: 'AMOLADORA', familia: '37', alcance: 'insumo', catalogoId: 'c-amol' },
    ], { documento: 'F001-1' });
    expect(llamadas).toContainEqual(['audit', 'catalogo_insumos']);
  });
});
