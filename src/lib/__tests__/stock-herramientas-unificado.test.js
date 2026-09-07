// ═══════════════════════════════════════════════════════════════════
// HERRAMIENTAS — el stock pasa a derivarse de los movimientos (mig 190).
//
// Herramientas era la única de las tres (materiales / EPP / herramientas) sin
// trigger de stock en el servidor: el contador lo escribía y lo EMPUJABA el
// cliente, como número ABSOLUTO. Dos equipos offline sobre la misma
// herramienta y el último en sincronizar pisaba al otro, sin dejar rastro.
//
// Dos invariantes se prueban acá, y los dos ya se rompieron una vez:
//
//  1) `stock_actual`/`alerta` NO se pushean. El comentario de
//     TRIGGER_MANAGED_FIELDS documenta el bug exacto que aparece si el cliente
//     los manda teniendo trigger del lado server: el push de la tabla llega
//     ANTES que el del movimiento, el trigger suma encima y el stock sale ×2
//     ("ingresar 30, ver 60"). Materiales y EPP ya estaban; herramientas no.
//
//  2) La regla de signos del SQL es la MISMA que la del cliente. El 7-sep-2026
//     una consulta de diagnóstico olvidó mapear `tipo_movimiento = 'ingreso'`
//     —el 51% de los movimientos de la tabla— y reportó "81 de 86 herramientas
//     con historial negativo". Era falso: las 86 cuadraban. Si el trigger
//     olvidara un tipo igual que esa consulta, no sería un reporte equivocado:
//     PONDRÍA el stock en cero de verdad.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { efectoMovimiento } from '../stock-cronologia.js';
import { stockSegunMovimientos } from '../stock-conciliacion.js';

const syncSrc = readFileSync(new URL('../../sync/SyncEngine.js', import.meta.url), 'utf8');
const migSrc = readFileSync(
  new URL('../../../supabase/migrations/190_stock_herramientas_unificado.sql', import.meta.url), 'utf8');

/** El bloque `herramientas: new Set([...])` de TRIGGER_MANAGED_FIELDS. */
function bloqueHerramientas() {
  const i = syncSrc.indexOf('export const TRIGGER_MANAGED_FIELDS');
  expect(i, 'TRIGGER_MANAGED_FIELDS debe seguir exportándose').toBeGreaterThan(-1);
  const desde = syncSrc.indexOf('herramientas: new Set([', i);
  expect(desde, 'herramientas debe estar en TRIGGER_MANAGED_FIELDS').toBeGreaterThan(-1);
  const hasta = syncSrc.indexOf(']),', desde);
  return syncSrc.slice(desde, hasta);
}

describe('herramientas: el contador lo maneja el servidor', () => {
  it('stock_actual y alerta están declarados como campos de trigger', () => {
    const bloque = bloqueHerramientas();
    expect(bloque).toContain("'stock_actual'");
    expect(bloque).toContain("'alerta'");
  });

  it('materiales y EPP los siguen teniendo (las tres tablas iguales)', () => {
    for (const tabla of ['materiales', 'epps']) {
      const desde = syncSrc.indexOf(`${tabla}: new Set([`);
      const bloque = syncSrc.slice(desde, syncSrc.indexOf(']),', desde));
      expect(bloque, `${tabla} debe seguir con stock_actual`).toContain("'stock_actual'");
    }
  });

  it('el trigger y el RPC existen en la migración 190', () => {
    expect(migSrc).toContain('CREATE TRIGGER trg_recalcular_stock_herramienta');
    expect(migSrc).toContain('AFTER INSERT OR UPDATE OR DELETE ON public.movimientos_herramientas');
    expect(migSrc).toContain('recalcular_stock_herramientas_obra');
  });

  it('el trigger cubre borrado y edición, no solo el alta', () => {
    // Materiales/EPP necesitan cuatro triggers (insert, cantidad, soft-delete,
    // reverso). Acá el recálculo es convergente: uno solo, pero TIENE que estar
    // enganchado a las tres operaciones o borrar un movimiento no movería el
    // contador — que es justo lo que pasaba antes en herramientas.
    const i = migSrc.indexOf('CREATE TRIGGER trg_recalcular_stock_herramienta');
    const decl = migSrc.slice(i, i + 200);
    for (const op of ['INSERT', 'UPDATE', 'DELETE']) expect(decl).toContain(op);
  });
});

describe('la regla de signos del servidor es la del cliente', () => {
  // Mapea el CASE de saldo_herramienta(): 'x' → +1 / -1.
  const sql = migSrc.slice(migSrc.indexOf('FUNCTION public.saldo_herramienta'),
                           migSrc.indexOf('FUNCTION public.recalcular_stock_herramienta'));
  const signosSql = new Map();
  for (const m of sql.matchAll(/WHEN '(\w+)'\s+THEN\s+(-?)COALESCE/g)) {
    signosSql.set(m[1], m[2] === '-' ? -1 : 1);
  }

  it('mapea los mismos tipos que efectoMovimiento, con el mismo signo', () => {
    const tipos = ['entrada', 'ingreso', 'devolucion', 'reposicion', 'ajuste', 'salida', 'merma', 'baja'];
    for (const t of tipos) {
      expect(signosSql.get(t), `el SQL debe mapear '${t}'`).toBeDefined();
      expect(signosSql.get(t), `signo de '${t}'`).toBe(efectoMovimiento({ tipo_movimiento: t }));
    }
  });

  it("'ingreso' suma — el olvido que inventó el descuadre de las 81", () => {
    expect(signosSql.get('ingreso')).toBe(1);
  });

  it('el RPC masivo usa exactamente el mismo mapa que el trigger', () => {
    const rpc = migSrc.slice(migSrc.indexOf('FUNCTION public.recalcular_stock_herramientas_obra'));
    for (const [tipo, signo] of signosSql) {
      const re = new RegExp(`WHEN '${tipo}'\\s+THEN\\s+${signo < 0 ? '-' : ''}COALESCE`);
      expect(rpc, `el RPC debe mapear '${tipo}' con signo ${signo}`).toMatch(re);
    }
  });

  it('excluye borrados, reversas y reversados (las tres, en ambas funciones)', () => {
    const ocurrencias = migSrc.match(/reverses_id IS NULL/g) || [];
    expect(ocurrencias.length).toBeGreaterThanOrEqual(2);
    expect((migSrc.match(/reversed_by_id IS NULL/g) || []).length).toBeGreaterThanOrEqual(2);
    expect((migSrc.match(/deleted_at IS NULL/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('el caso real que sí estaba bien (CARRETILLA, obra Miraflores)', () => {
  // 1 ingreso de 6 y cinco salidas que suman 6 → saldo 0, no −6. La consulta
  // equivocada del 7-sep leía esto como "historial −6" por no mapear 'ingreso'.
  const movs = [
    { fecha: '2026-05-11', tipo_movimiento: 'ingreso', accion: 'entrada', cantidad: 6 },
    { fecha: '2026-05-21', tipo_movimiento: 'salida', accion: 'salida', cantidad: 1 },
    { fecha: '2026-05-25', tipo_movimiento: 'salida', accion: 'salida', cantidad: 2 },
    { fecha: '2026-05-26', tipo_movimiento: 'salida', accion: 'salida', cantidad: 1 },
    { fecha: '2026-05-29', tipo_movimiento: 'salida', accion: 'salida', cantidad: 1 },
    { fecha: '2026-06-08', tipo_movimiento: 'salida', accion: 'salida', cantidad: 1 },
  ];

  it('el historial cuadra en 0', () => {
    expect(stockSegunMovimientos(movs)).toBe(0);
  });

  it('una devolución posterior lo deja en 1, no en −1', () => {
    expect(stockSegunMovimientos([...movs,
      { fecha: '2026-06-22', tipo_movimiento: 'devolucion', accion: 'entrada', cantidad: 1 }])).toBe(1);
  });
});
