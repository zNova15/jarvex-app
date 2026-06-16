# Control de Consumo Nivel 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una vista nueva "Control de Consumo" que compara el consumo real de insumos directos vs el presupuesto del expediente y vs el avance físico de la partida, con semáforo de sobreconsumo.

**Architecture:** Un helper PURO (`control-consumo.js`, unit-testeable, sin Dexie/React) que calcula por partida e insumo los derivados + el estado del semáforo; y una vista (`jx-control-consumo.jsx`) que carga `partidas` + `insumos_partida` de la obra activa, llama al helper y renderiza el tablero. Sin tablas nuevas. Registro de página en los 4 puntos habituales.

**Tech Stack:** React (sin JSX runtime nuevo, usa `window.JxIcon`/patrones existentes), Dexie (`window.__db`), Vitest (`src/lib/__tests__/`).

**Datos (campos reales, ya verificados):**
- `insumos_partida`: `partida_id`, `obra_id`, `nombre_insumo`, `unidad`, `cantidad_presupuestada`, `cantidad_real_usada`, `costo_presupuestado`, `costo_real`, `tipo_insumo`, `deleted_at`.
- `partidas`: `id`, `obra_id`, `codigo_delfin`, `nombre_partida`, `porcentaje_avance` (0–100), `costo_total_presupuestado`, `costo_real_acumulado`, `estado`, `deleted_at`.

---

### Task 1: Helper de cálculo `control-consumo.js` (TDD)

**Files:**
- Create: `src/lib/control-consumo.js`
- Test: `src/lib/__tests__/control-consumo.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/control-consumo.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { calcularControlConsumo, UMBRAL } from '../control-consumo.js';

const partida = (over) => ({ id: 'p1', obra_id: 'o1', nombre_partida: 'P1', codigo_delfin: '01', porcentaje_avance: 0, costo_total_presupuestado: 0, costo_real_acumulado: 0, ...over });
const ip = (over) => ({ id: 'i1', partida_id: 'p1', obra_id: 'o1', nombre_insumo: 'Alambre', unidad: 'rollo', cantidad_presupuestada: 0, cantidad_real_usada: 0, costo_presupuestado: 0, costo_real: 0, ...over });

describe('calcularControlConsumo', () => {
  it('alambre: 80% consumido pero 50% de avance → rojo (índice 1.6)', () => {
    const r = calcularControlConsumo({
      partidas: [partida({ porcentaje_avance: 50 })],
      insumosPartida: [ip({ cantidad_presupuestada: 100, cantidad_real_usada: 80 })],
    });
    expect(r[0].insumos[0].indice).toBeCloseTo(1.6, 5);
    expect(r[0].insumos[0].estado).toBe('rojo');
    expect(r[0].estado).toBe('rojo');
  });

  it('verde: 40% consumido con 50% de avance', () => {
    const r = calcularControlConsumo({
      partidas: [partida({ porcentaje_avance: 50 })],
      insumosPartida: [ip({ cantidad_presupuestada: 100, cantidad_real_usada: 40 })],
    });
    expect(r[0].insumos[0].estado).toBe('verde');
    expect(r[0].estado).toBe('verde');
  });

  it('ámbar por consumo cuando no hay avance reportado (90% del presupuesto)', () => {
    const r = calcularControlConsumo({
      partidas: [partida({ porcentaje_avance: 0 })],
      insumosPartida: [ip({ cantidad_presupuestada: 100, cantidad_real_usada: 90 })],
    });
    expect(r[0].insumos[0].indice).toBeNull();
    expect(r[0].insumos[0].estado).toBe('ambar');
  });

  it('rojo por consumo cuando supera el presupuesto (110%) sin avance', () => {
    const r = calcularControlConsumo({
      partidas: [partida({ porcentaje_avance: 0 })],
      insumosPartida: [ip({ cantidad_presupuestada: 100, cantidad_real_usada: 110 })],
    });
    expect(r[0].insumos[0].estado).toBe('rojo');
  });

  it('sin_presupuesto cuando la cantidad presupuestada es 0', () => {
    const r = calcularControlConsumo({
      partidas: [partida()],
      insumosPartida: [ip({ cantidad_presupuestada: 0, cantidad_real_usada: 5 })],
    });
    expect(r[0].insumos[0].estado).toBe('sin_presupuesto');
    expect(r[0].estado).toBe('verde'); // sin_presupuesto no escala el estado de la partida
  });

  it('ignora insumos y partidas borradas (deleted_at)', () => {
    const r = calcularControlConsumo({
      partidas: [partida(), partida({ id: 'p2', deleted_at: '2026-01-01' })],
      insumosPartida: [
        ip({ cantidad_presupuestada: 100, cantidad_real_usada: 200 }),
        ip({ id: 'i2', cantidad_presupuestada: 100, cantidad_real_usada: 999, deleted_at: '2026-01-01' }),
      ],
    });
    expect(r).toHaveLength(1);
    expect(r[0].insumos).toHaveLength(1);
  });

  it('ordena peor-primero (rojo antes que verde)', () => {
    const r = calcularControlConsumo({
      partidas: [
        partida({ id: 'pVerde', porcentaje_avance: 50 }),
        partida({ id: 'pRojo', porcentaje_avance: 50 }),
      ],
      insumosPartida: [
        ip({ id: 'iv', partida_id: 'pVerde', cantidad_presupuestada: 100, cantidad_real_usada: 30 }),
        ip({ id: 'ir', partida_id: 'pRojo', cantidad_presupuestada: 100, cantidad_real_usada: 200 }),
      ],
    });
    expect(r[0].partida.id).toBe('pRojo');
    expect(r[1].partida.id).toBe('pVerde');
  });

  it('UMBRAL expone los cortes configurables', () => {
    expect(UMBRAL.consumoRojo).toBe(1.0);
    expect(UMBRAL.indiceRojo).toBe(1.25);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TMPDIR=/var/tmp npm run test:unit -- control-consumo`
Expected: FAIL ("Failed to resolve import '../control-consumo.js'").

- [ ] **Step 3: Write the implementation**

Create `src/lib/control-consumo.js`:

```js
// ═══════════════════════════════════════════════════════════════════
// JARVEX — Control de Consumo (Nivel 1: insumos directos vs presupuesto)
//
// Helper PURO (sin Dexie/React, unit-testeable). Compara el consumo real de
// cada insumo de una partida contra DOS baselines y devuelve el peor estado:
//   - vs PRESUPUESTO total del insumo (cantidad_real_usada / cantidad_presupuestada)
//   - vs AVANCE físico de la partida (real / (presupuesto × %avance)), cuando
//     hay avance reportado.
// ═══════════════════════════════════════════════════════════════════

// Umbrales del semáforo (ajustables en un solo lugar).
export const UMBRAL = {
  consumoAmber: 0.85, // ≥85% del presupuesto → atención
  consumoRojo: 1.00,  // >100% del presupuesto → sobreconsumo
  indiceAmber: 1.10,  // índice vs avance ≥1.10 → atención
  indiceRojo: 1.25,   // índice vs avance >1.25 → sobreconsumo
};

const RANK = { rojo: 3, ambar: 2, verde: 1, sin_presupuesto: 0 };
const peor = (a, b) => (RANK[a] >= RANK[b] ? a : b);

function estadoPorConsumo(pct) {
  if (pct > UMBRAL.consumoRojo + 1e-9) return 'rojo';
  if (pct >= UMBRAL.consumoAmber) return 'ambar';
  return 'verde';
}
function estadoPorIndice(indice) {
  if (indice == null) return 'verde';
  if (indice > UMBRAL.indiceRojo + 1e-9) return 'rojo';
  if (indice >= UMBRAL.indiceAmber) return 'ambar';
  return 'verde';
}

/**
 * @param {Object} opts
 * @param {Array} opts.partidas       filas de `partidas` (Dexie)
 * @param {Array} opts.insumosPartida filas de `insumos_partida` (Dexie)
 * @returns {Array} filas por partida (peor-primero) con sus insumos calculados
 */
export function calcularControlConsumo({ partidas = [], insumosPartida = [] }) {
  const porPartida = new Map();
  for (const ip of insumosPartida) {
    if (ip.deleted_at) continue;
    if (!porPartida.has(ip.partida_id)) porPartida.set(ip.partida_id, []);
    porPartida.get(ip.partida_id).push(ip);
  }

  const filas = [];
  for (const p of partidas) {
    if (p.deleted_at) continue;
    // porcentaje_avance viene 0–100; lo pasamos a fracción 0–1 y clampeamos.
    const pctAvance = Math.max(0, Math.min(1, (Number(p.porcentaje_avance) || 0) / 100));
    const tieneAvance = pctAvance > 0;

    const insumos = (porPartida.get(p.id) || []).map(ip => {
      const pres = Number(ip.cantidad_presupuestada) || 0;
      const real = Number(ip.cantidad_real_usada) || 0;
      if (pres <= 0) {
        return { ip, pres, real, pctConsumo: null, indice: null, estado: 'sin_presupuesto' };
      }
      const pctConsumo = real / pres;
      const esperado = pres * pctAvance;
      const indice = (tieneAvance && esperado > 0) ? real / esperado : null;
      const estado = peor(estadoPorConsumo(pctConsumo), estadoPorIndice(indice));
      return { ip, pres, real, pctConsumo, indice, estado };
    });

    const estado = insumos.reduce((acc, x) => peor(acc, x.estado), 'verde');
    const costoPres = Number(p.costo_total_presupuestado) || 0;
    const costoReal = Number(p.costo_real_acumulado) || 0;
    const pctCosto = costoPres > 0 ? costoReal / costoPres : null;
    filas.push({ partida: p, estado, pctAvance, pctCosto, costoPres, costoReal, insumos });
  }

  filas.sort((a, b) => RANK[b.estado] - RANK[a.estado] || (b.pctCosto || 0) - (a.pctCosto || 0));
  return filas;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TMPDIR=/var/tmp npm run test:unit -- control-consumo`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/control-consumo.js src/lib/__tests__/control-consumo.test.js
git commit -m "feat(control-consumo): helper de cálculo Nivel 1 (consumo vs presupuesto/avance)"
```

---

### Task 2: Vista `jx-control-consumo.jsx`

**Files:**
- Create: `src/components/jx-control-consumo.jsx`

- [ ] **Step 1: Write the component**

Create `src/components/jx-control-consumo.jsx`:

```jsx
// ═══════════════════════════════════════════════════════════════════
// JARVEX — Control de Consumo (Nivel 1)
// Tablero por partida (semáforo + consumo vs presupuesto + índice vs avance),
// expandible a sus insumos. Solo lectura. Reusa insumos_partida + partidas.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { calcularControlConsumo } from "../lib/control-consumo.js";

const { useState: uS, useEffect: uE, useMemo: uM } = React;
const JxIcon = (props) => (window.JxIcon ? <window.JxIcon {...props} /> : null);

const COLOR = { rojo: 'var(--red)', ambar: 'var(--amber)', verde: 'var(--green)', sin_presupuesto: 'var(--tm)' };
const LABEL = { rojo: 'Sobreconsumo', ambar: 'Atención', verde: 'En línea', sin_presupuesto: 'Sin presupuesto' };
const pct = (x) => x == null ? '—' : `${(x * 100).toFixed(0)}%`;

function ControlConsumoPage({ showToast }) {
  const obraHook = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const obraId = obraHook?.obraId || null;
  const [partidas, setPartidas] = uS([]);
  const [insumos, setInsumos] = uS([]);
  const [loading, setLoading] = uS(true);
  const [abiertas, setAbiertas] = uS(() => new Set());

  uE(() => {
    if (!obraId) return;
    let cancel = false;
    const load = async () => {
      try {
        const [ps, ips] = await Promise.all([
          window.__db.partidas.where('obra_id').equals(obraId).filter(p => !p.deleted_at).toArray(),
          window.__db.insumos_partida.where('obra_id').equals(obraId).filter(i => !i.deleted_at).toArray(),
        ]);
        if (cancel) return;
        setPartidas(ps); setInsumos(ips);
      } catch (e) { console.warn('[control-consumo]', e?.message || e); }
      finally { if (!cancel) setLoading(false); }
    };
    load();
    const onChange = (e) => {
      const t = e?.detail?.tabla || e?.detail?.table;
      if (!t || ['partidas', 'insumos_partida', 'movimientos_materiales', 'avance_obra'].includes(t)) load();
    };
    window.addEventListener('jx_data_changed', onChange);
    window.addEventListener('jarvex_master_updated', onChange);
    return () => { cancel = true; window.removeEventListener('jx_data_changed', onChange); window.removeEventListener('jarvex_master_updated', onChange); };
  }, [obraId]);

  const filas = uM(() => calcularControlConsumo({ partidas, insumosPartida: insumos }), [partidas, insumos]);
  const resumen = uM(() => {
    const c = { rojo: 0, ambar: 0, verde: 0 };
    filas.forEach(f => { if (c[f.estado] != null) c[f.estado]++; });
    return c;
  }, [filas]);

  const toggle = (id) => setAbiertas(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (!obraId) {
    return <div className="page-wrap"><div className="empty-state"><p>Seleccioná una obra activa.</p></div></div>;
  }

  return (
    <div className="page-wrap">
      <div className="pg-hd">
        <div className="pg-title">Control de Consumo</div>
        <div className="pg-sub">
          Consumo real de insumos vs presupuesto y vs avance físico ·{' '}
          <span style={{ color: 'var(--red)' }}>{resumen.rojo} sobreconsumo</span> ·{' '}
          <span style={{ color: 'var(--amber)' }}>{resumen.ambar} atención</span> ·{' '}
          <span style={{ color: 'var(--green)' }}>{resumen.verde} en línea</span>
        </div>
      </div>

      {loading ? (
        <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)' }}>Cargando…</div>
      ) : filas.length === 0 ? (
        <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)' }}>
          No hay partidas con presupuesto en esta obra todavía.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {filas.map(f => {
            const open = abiertas.has(f.partida.id);
            return (
              <div key={f.partida.id} className="card card-p" style={{ borderLeft: `3px solid ${COLOR[f.estado]}` }}>
                <div onClick={() => toggle(f.partida.id)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-block', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }}>▾</span>
                  <span className="badge" style={{ background: COLOR[f.estado], color: '#000', fontSize: 9 }}>{LABEL[f.estado]}</span>
                  <strong style={{ fontSize: 13 }}>{f.partida.codigo_delfin ? `${f.partida.codigo_delfin} · ` : ''}{f.partida.nombre_partida || '—'}</strong>
                  <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--tm)' }}>
                    Avance {pct(f.pctAvance)} · Costo real/pres {pct(f.pctCosto)}
                  </span>
                </div>
                {open && (
                  <div style={{ marginTop: 10, overflow: 'auto' }}>
                    <table className="tbl" style={{ fontSize: 12 }}>
                      <thead><tr>
                        <th>Insumo</th>
                        <th style={{ textAlign: 'right' }}>Presup.</th>
                        <th style={{ textAlign: 'right' }}>Real</th>
                        <th style={{ textAlign: 'right' }}>% Consumo</th>
                        <th style={{ textAlign: 'right' }}>Índice vs avance</th>
                        <th>Estado</th>
                      </tr></thead>
                      <tbody>
                        {f.insumos.map(x => (
                          <tr key={x.ip.id}>
                            <td>{x.ip.nombre_insumo || '—'}</td>
                            <td style={{ textAlign: 'right' }}>{Number(x.pres).toLocaleString('es-PE')} <span style={{ color: 'var(--tm)' }}>{x.ip.unidad || ''}</span></td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{Number(x.real).toLocaleString('es-PE')}</td>
                            <td style={{ textAlign: 'right' }}>{pct(x.pctConsumo)}</td>
                            <td style={{ textAlign: 'right', color: x.indice && x.indice > 1.25 ? 'var(--red)' : 'inherit' }}>{x.indice == null ? '—' : x.indice.toFixed(2)}</td>
                            <td><span className="badge" style={{ background: COLOR[x.estado], color: '#000', fontSize: 9 }}>{LABEL[x.estado]}</span></td>
                          </tr>
                        ))}
                        {f.insumos.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Esta partida no tiene insumos presupuestados.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { ControlConsumoPage });
```

- [ ] **Step 2: Verify it builds (component is build-checked, no unit test)**

Run: `TMPDIR=/var/tmp npm run build 2>&1 | grep -E "built in|error|Error"`
Expected: `✓ built in …` (no errors). The chunk won't be emitted yet until Task 3 registers it; the file just needs to parse.

- [ ] **Step 3: Commit**

```bash
git add src/components/jx-control-consumo.jsx
git commit -m "feat(control-consumo): vista tablero por partida con semáforo de sobreconsumo"
```

---

### Task 3: Registrar la página en los 4 puntos

**Files:**
- Modify: `src/main.jsx` (PAGE_CHUNKS, junto a `jx-ingeniero`)
- Modify: `src/jx-app.jsx` (mapa de títulos ~línea 336 y PAGE_REGISTRY ~línea 520)
- Modify: `src/components/jx-sidebar.jsx` (NAV, sección GESTIÓN DE OBRA)
- Modify: `src/components/jx-admin.jsx` (`window.__moduleIdMap`, ~línea 880)

- [ ] **Step 1: PAGE_CHUNKS en main.jsx**

En `src/main.jsx`, después de la línea `'jx-ingeniero': () => import('./components/jx-ingeniero.jsx'),` agregar:

```js
  'jx-control-consumo':       () => import('./components/jx-control-consumo.jsx'),
```

- [ ] **Step 2: Título + PAGE_REGISTRY en jx-app.jsx**

En el mapa de títulos (la línea que contiene `'vinculacion-salidas':'Vinculación de Salidas',partidas:'Partidas'`), agregar `'control-consumo':'Control de Consumo',`.

En PAGE_REGISTRY, después de `'vinculacion-salidas': { chunk: 'jx-ingeniero', component: 'IngenieroInboxPage' },` agregar:

```js
  'control-consumo':        { chunk: 'jx-control-consumo', component: 'ControlConsumoPage' },
```

- [ ] **Step 3: NAV en jx-sidebar.jsx**

En la sección `{ section: 'GESTIÓN DE OBRA' },`, después de `{ id: 'partidas', label: 'Partidas', icon: 'list' },` agregar:

```js
  { id: 'control-consumo', label: 'Control de Consumo', icon: 'trending' },
```

- [ ] **Step 4: moduleIdMap en jx-admin.jsx**

En `window.__moduleIdMap`, agregar (reusa el permiso de Partidas → lo ven los mismos roles: admin/gerente/ingeniero/residente):

```js
  'control-consumo': 'Partidas',
```

- [ ] **Step 5: Build + smoke**

Run: `TMPDIR=/var/tmp npm run build 2>&1 | grep -E "built in|error|Error|jx-control-consumo"`
Expected: aparece `dist/assets/jx-control-consumo-*.js` y `✓ built in …`.

- [ ] **Step 6: Tests + commit**

Run: `TMPDIR=/var/tmp npm run test:unit 2>&1 | tail -3`
Expected: todos los tests pasan (177 + 8 nuevos = 185).

```bash
git add src/main.jsx src/jx-app.jsx src/components/jx-sidebar.jsx src/components/jx-admin.jsx
git commit -m "feat(control-consumo): registrar la página Control de Consumo (Gestión de Obra)"
```

---

## Notas de implementación

- `porcentaje_avance` se asume 0–100 (porcentaje); el helper lo divide por 100 y
  clampea a [0,1]. Si al ver datos reales resultara 0–1, quitar el `/100` en
  `control-consumo.js` y ajustar el test del caso alambre.
- La integración con el Centro de Alertas (publicar los 🔴) es un paso secundario
  fuera de este plan: la vista ya ordena peor-primero, que cubre el caso de uso.
  Si se quiere, se hace en un PR aparte leyendo el patrón de `alertas`.
- Niveles 2 (combustible/indirectos) y 3 (mano de obra) son specs/planes futuros.
