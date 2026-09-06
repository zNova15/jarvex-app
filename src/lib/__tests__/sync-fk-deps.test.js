// ═══════════════════════════════════════════════════════════════════
// FK_DEPS — la lista que evita que un hijo llegue antes que su padre.
//
// El push manda las tablas en el orden de TRANSACTIONAL_TABLES, pero en BATCHES
// PARALELOS: dos tablas vecinas en la lista salen a la vez. Si el hijo le gana
// la carrera al padre, Postgres devuelve 23503 (violación de FK), el registro
// reintenta 5 veces y termina en FAILED, con el cartel rojo de sync y el dato
// del usuario sin subir. Ya pasó una vez: companies (idx 15) y
// accounting_movements (idx 16) en el mismo batch → 241 errores en Sentry.
//
// FK_DEPS es el arreglo: declara qué FK tiene cada tabla, y `fkDepsReady()`
// retiene al hijo hasta que el padre esté sincronizado.
//
// EL AGUJERO DEL 6-sep-2026: `accounting_movements.orden_compra_id` tiene FK
// real en el servidor desde la mig 041 (accounting_movements_orden_compra_id_fkey
// → ordenes_compra) y NO estaba declarada. Y en el orden de push
// accounting_movements va DOCE posiciones antes que ordenes_compra. Estuvo
// dormido porque ordenes_compra tiene 0 filas — pero la emisión en lote de la
// tanda 5 escribe la orden y el movimiento en la misma pasada, así que la
// PRIMERA vez que se emitiera el respaldo de una obra se caían los 94
// movimientos del lote de Miraflores.
//
// Este test lee el archivo real (FK_DEPS no se exporta) y verifica el invariante
// que hace falta para que la lista sirva de algo.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../sync/SyncEngine.js', import.meta.url), 'utf8');

/** El orden de push declarado en TRANSACTIONAL_TABLES. */
function ordenDePush() {
  const ini = src.indexOf('const TRANSACTIONAL_TABLES = [');
  const fin = src.indexOf('\n];', ini);
  expect(ini, 'no se encontró TRANSACTIONAL_TABLES').toBeGreaterThan(-1);
  return [...src.slice(ini, fin).matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
}

/** FK_DEPS como { tabla: [{campo, tabla}] }. */
function fkDeps() {
  const ini = src.indexOf('const FK_DEPS = {');
  const fin = src.indexOf('\n};', ini);
  expect(ini, 'no se encontró FK_DEPS').toBeGreaterThan(-1);
  const bloque = src.slice(ini, fin);
  const out = {};
  for (const m of bloque.matchAll(/^\s{2}([a-z_]+):\s*\[(.*)\],\s*$/gm)) {
    out[m[1]] = [...m[2].matchAll(/campo:\s*'([^']+)',\s*tabla:\s*'([^']+)'/g)]
      .map(d => ({ campo: d[1], tabla: d[2] }));
  }
  return out;
}

describe('SyncEngine — FK_DEPS', () => {
  it('accounting_movements declara orden_compra_id', () => {
    // Regresión directa del bug del 6-sep. Sin esta entrada, emitir el respaldo
    // en lote manda todos los movimientos del lote a FAILED.
    const campos = (fkDeps().accounting_movements || []).map(d => d.campo);
    expect(campos, 'FK_DEPS.accounting_movements sin orden_compra_id').toContain('orden_compra_id');
    const dep = fkDeps().accounting_movements.find(d => d.campo === 'orden_compra_id');
    expect(dep.tabla).toBe('ordenes_compra');
  });

  it('toda tabla mencionada en FK_DEPS está en el orden de push', () => {
    const orden = new Set(ordenDePush());
    const faltan = [];
    for (const [tabla, deps] of Object.entries(fkDeps())) {
      if (!orden.has(tabla)) faltan.push(`${tabla} (es clave de FK_DEPS)`);
      for (const d of deps) {
        // Una FK a la MISMA tabla (related_movement_id) es válida y no exige orden.
        if (d.tabla !== tabla && !orden.has(d.tabla)) {
          faltan.push(`${tabla}.${d.campo} → ${d.tabla} (no está en TRANSACTIONAL_TABLES)`);
        }
      }
    }
    expect(faltan, `FK_DEPS apunta a tablas que el push no manda:\n  ${faltan.join('\n  ')}`).toEqual([]);
  });

  it('FK_DEPS existe justamente para las tablas que salen ANTES que su padre', () => {
    // No es un error que el hijo vaya antes — para eso está FK_DEPS. Lo que este
    // test documenta es que el caso REAL existe, para que nadie borre la lista
    // pensando que el orden alcanza. accounting_movements sale antes que
    // ordenes_compra y que proveedores, y por eso los necesita declarados.
    const orden = ordenDePush();
    const idx = (t) => orden.indexOf(t);
    expect(idx('accounting_movements')).toBeGreaterThan(-1);
    expect(idx('ordenes_compra')).toBeGreaterThan(-1);
    expect(
      idx('accounting_movements') < idx('ordenes_compra'),
      'si ordenes_compra pasó a ir antes, revisá si FK_DEPS sigue haciendo falta acá'
    ).toBe(true);
  });
});
