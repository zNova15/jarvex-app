// ═══════════════════════════════════════════════════════════════════
// UN .where() SOBRE UNA COLUMNA NO INDEXADA ES UNA PANTALLA VACÍA EN SILENCIO.
//
// Dexie solo sabe buscar por campos declarados en el índice de la tabla. Un
// `.where('campo_no_indexado')` no devuelve cero filas: LANZA `SchemaError`,
// la promesa rechaza y —si el llamador tiene un `catch {}` mudo— la lista queda
// vacía para siempre sin un solo síntoma.
//
// EL CASO REAL (encontrado el 6-sep-2026, vivo desde el 15-may):
//   jx-almacen.jsx hacía `accounting_movements.where('obra_id')`, y esa tabla
//   NO indexa obra_id. El banner "facturas pendientes de recepción" del Almacén
//   estuvo vacío casi cuatro meses mientras producción tenía 78 facturas en
//   `pendiente_recepcion` con obra. La almacenera no tenía forma de saber que
//   la lista debía traer algo.
//
//   Prueba independiente de que ese bloque nunca corrió: `recepcion_status`
//   = 'parcial' tiene 0 filas en TODA la historia de la base, y el único código
//   que escribe ese estado cuelga de esa lista.
//
// POR QUÉ NO LO VIO NADIE: el build no conoce los índices de Dexie, el lint
// tampoco, y el test que monta las 114 pantallas usa renderToString (SSR) — no
// corre efectos y ni siquiera define window.__db. Este test mira el código
// fuente, que es donde el error es visible.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const dbUrl = new URL('../../db/jarvex.db.js', import.meta.url);
const compsUrl = new URL('../../components/', import.meta.url);

/**
 * Índices de Dexie por tabla, tomando la ÚLTIMA declaración de cada una — que
 * es la versión vigente del esquema (db.version(N) las va redefiniendo).
 */
function indicesPorTabla() {
  const src = readFileSync(dbUrl, 'utf8');
  const idx = new Map();
  for (const m of src.matchAll(/^\s{2}([a-z_]+):\s*'([^']*)'/gm)) {
    const campos = m[2].split(',')
      .map(c => c.trim().replace(/^[&*]/, ''))   // & = único, * = multiEntry
      .filter(Boolean);
    idx.set(m[1], new Set(campos));
  }
  return idx;
}

/** Cada `__db.<tabla>.where('<campo>')` del código de pantallas. */
function consultasWhere() {
  const archivos = readdirSync(compsUrl).filter(f => f.endsWith('.jsx'));
  const out = [];
  for (const f of archivos) {
    const src = readFileSync(new URL(f, compsUrl), 'utf8');
    // Tolera saltos de línea entre la tabla y el .where(...) encadenado.
    for (const m of src.matchAll(/__db\s*\.\s*([a-z_]+)\s*(?:\n\s*)?\.\s*where\(\s*'([^']+)'/g)) {
      const linea = src.slice(0, m.index).split('\n').length;
      out.push({ archivo: f, linea, tabla: m[1], campo: m[2] });
    }
  }
  return out;
}

describe('Dexie — todo .where() usa un campo indexado', () => {
  it('el parser encuentra el esquema y las consultas (si no, el test no prueba nada)', () => {
    const idx = indicesPorTabla();
    expect(idx.size, 'no se pudieron leer los índices de jarvex.db.js').toBeGreaterThan(20);
    expect(idx.get('accounting_movements'), 'falta accounting_movements').toBeTruthy();
    expect(consultasWhere().length, 'no se encontró ni un .where() en los componentes').toBeGreaterThan(10);
  });

  it('ninguna pantalla busca por un campo que su tabla no indexa', () => {
    const idx = indicesPorTabla();
    const malas = consultasWhere()
      // Tabla que el parser no conoce: no inventamos un fallo.
      .filter(q => idx.has(q.tabla))
      .filter(q => !idx.get(q.tabla).has(q.campo))
      .map(q => `${q.archivo}:${q.linea} → __db.${q.tabla}.where('${q.campo}') · índice: [${[...idx.get(q.tabla)].join(', ')}]`);
    expect(malas, `Dexie lanza SchemaError en estas consultas y la lista queda vacía:\n  ${malas.join('\n  ')}`).toEqual([]);
  });

  it('accounting_movements sigue SIN indexar obra_id (si se agrega, este test avisa)', () => {
    // No es un bug que falte: agregarlo obliga a subir db.version(N) y a que
    // todos los navegadores instalados migren. Lo que este test fija es que
    // nadie escriba un .where('obra_id') creyendo que existe. Si algún día se
    // agrega el índice de verdad, esta aserción falla y se borra a propósito.
    expect(indicesPorTabla().get('accounting_movements').has('obra_id')).toBe(false);
  });
});
