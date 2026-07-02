// ═══════════════════════════════════════════════════════════════════
// JARVEX — Compras por Categoría (Fase 3 del clasificador de ítems)
//
// Panel de la CONTADORA JEFE: agrupa todas las compras clasificadas
// (categoría/subcategoría de Fase 1) y permite DESIGNAR qué empresa del
// grupo emite las facturas de cada subcategoría ("JARVEX factura
// ferretería general, herramientas y maquinaria liviana; la empresa B
// factura tubería/cemento/fierro; la empresa C la alimentación…").
// Las reglas viven en `emision_reglas` (sincronizada) y alimentarán la
// Fase 4 (generación de órdenes/facturas intercompany).
//
// Visibilidad: módulo 'Intercompany' (contadora jefe, gerente, admin —
// el ayudante NO participa de la designación).
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { getCurrentMode } from "../hooks/useAppMode";

const { useState: uS, useMemo: uM, useEffect: uE } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CAT_LBL = {
  materiales: 'Materiales', herramientas: 'Herramientas', maquinaria: 'Maquinaria', epp: 'EPP',
  insumos_emergencia: 'Emergencia', gastos_generales: 'Gastos generales', otros: 'Otros',
};
const CAT_CLS = {
  materiales: 'b-blue', herramientas: 'b-amber', maquinaria: 'b-purple', epp: 'b-green',
  insumos_emergencia: 'b-red', gastos_generales: 'b-gray', otros: 'b-gray',
};

function ComprasCategoriaPage({ showToast }) {
  const toast = showToast || window.__showToast || (() => {});
  const auth = window.__useAuth?.();
  const rol = auth?.profile?.rol;
  const userId = auth?.profile?.id ?? 'offline';
  // Designar es decisión del grupo (Intercompany 'w'): contadora jefe / admin.
  const canDesignar = rol === 'admin' || (window.__hasPerm?.(rol, 'Intercompany', 'w') ?? false);
  const { data: movs } = window.__hooks.useAccountingMovements();
  const { data: companies } = window.__hooks.useCompanies();
  const { data: obras } = window.__hooks.useObras();

  const [reglas, setReglas] = uS([]);
  const [fechaDesde, setFechaDesde] = uS('');
  const [fechaHasta, setFechaHasta] = uS('');
  const [filtroObra, setFiltroObra] = uS('todas');
  const [filtroCat, setFiltroCat] = uS('todas');
  const [busyRegla, setBusyRegla] = uS(false);

  const esPrueba = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();
  const filaDelModo = (r) => (esPrueba ? r.demo === true : r.demo !== true);

  // Reglas de emisión desde Dexie (refrescadas ante cambios de datos).
  uE(() => {
    let cancel = false;
    const load = async () => {
      try {
        const rows = await window.__db.emision_reglas.filter(r => !r.deleted_at && filaDelModo(r)).toArray();
        if (!cancel) setReglas(rows);
      } catch { if (!cancel) setReglas([]); }
    };
    load();
    const on = (e) => { const t = e?.detail?.tabla; if (!t || t === 'emision_reglas') load(); };
    window.addEventListener('jx_data_changed', on);
    window.addEventListener('jarvex_master_updated', on);
    return () => { cancel = true; window.removeEventListener('jx_data_changed', on); window.removeEventListener('jarvex_master_updated', on); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esPrueba]);

  const companiesActivas = uM(() => (companies || []).filter(c => c.status === 'activa' && !c.deleted_at), [companies]);
  const companyNombre = (id) => (companies || []).find(c => c.id === id)?.name || null;
  const obraNombre = (id) => (obras || []).find(o => o.id === id)?.nombre_obra || null;

  // Regla canónica por subcategoría (updated_at desc — sin UNIQUE en server).
  const reglaPorSubcat = uM(() => {
    const m = new Map();
    const sorted = [...reglas].sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
    for (const r of sorted) m.set(r.subcategoria, r);
    return m;
  }, [reglas]);

  // Ítems de factura clasificados de TODAS las compras (cross-obra: la
  // designación de emisor es del grupo, no de una obra).
  const items = uM(() => {
    const out = [];
    for (const mv of (movs || [])) {
      if (mv.deleted_at || mv.clase === 'venta') continue;
      if (fechaDesde && (mv.date || '') < fechaDesde) continue;
      if (fechaHasta && (mv.date || '') > fechaHasta) continue;
      if (filtroObra !== 'todas' && mv.obra_id !== filtroObra) continue;
      let notas; try { notas = typeof mv.notas === 'string' ? JSON.parse(mv.notas) : mv.notas; } catch { notas = null; }
      const arr = notas && Array.isArray(notas.items_factura) ? notas.items_factura : null;
      if (!arr) continue;
      arr.forEach(it => {
        if (filtroCat !== 'todas' && (it.categoria || null) !== (filtroCat === 'sin_clasificar' ? null : filtroCat)) return;
        if (filtroCat === 'sin_clasificar' && it.categoria) return;
        out.push({
          descripcion: it.descripcion || it.nombre || '—',
          categoria: it.categoria || null,
          subcategoria: it.subcategoria || null,
          monto: (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0),
          companyId: mv.company_id || null,
          obraId: mv.obra_id || null,
        });
      });
    }
    return out;
  }, [movs, fechaDesde, fechaHasta, filtroObra, filtroCat]);

  // Agrupación por SUBCATEGORÍA (los clasificados sin subcategoría se agrupan
  // por su categoría; los sin clasificar quedan en su propio bucket).
  const grupos = uM(() => {
    const m = new Map();
    for (const it of items) {
      const key = it.categoria
        ? (it.subcategoria || `(${CAT_LBL[it.categoria] || it.categoria} sin subcategoría)`)
        : '(sin clasificar)';
      const g = m.get(key) || { subcat: key, esRegla: !!it.subcategoria, categoria: it.categoria, total: 0, nItems: 0, compradoras: new Map() };
      g.total += it.monto;
      g.nItems++;
      if (it.companyId) g.compradoras.set(it.companyId, (g.compradoras.get(it.companyId) || 0) + it.monto);
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [items]);

  const kpis = uM(() => {
    const total = items.reduce((s, it) => s + it.monto, 0);
    const clasif = items.filter(it => it.categoria).reduce((s, it) => s + it.monto, 0);
    let designado = 0;
    for (const g of grupos) {
      if (!g.esRegla) continue;
      const r = reglaPorSubcat.get(g.subcat);
      if (r?.company_id) designado += g.total;
    }
    return { total, clasif, designado, pctClasif: total > 0 ? (clasif / total) * 100 : 0 };
  }, [items, grupos, reglaPorSubcat]);

  // Resumen por EMPRESA EMISORA designada ("con JARVEX emitiremos: …").
  const porEmisora = uM(() => {
    const m = new Map();   // companyId|'__sin__' → { total, subcats: [] }
    for (const g of grupos) {
      const r = g.esRegla ? reglaPorSubcat.get(g.subcat) : null;
      const key = r?.company_id || '__sin__';
      const e = m.get(key) || { total: 0, subcats: [] };
      e.total += g.total;
      e.subcats.push({ nombre: g.subcat, total: g.total });
      m.set(key, e);
    }
    return m;
  }, [grupos, reglaPorSubcat]);

  // Designar (o quitar) la empresa emisora de una subcategoría.
  const designar = async (subcat, categoria, companyId) => {
    if (busyRegla) return;
    setBusyRegla(true);
    try {
      const { newId, newIdempotencyKey, SYNC_STATUS } = await import('../db/jarvex.db');
      const now = new Date().toISOString();
      const existentes = await window.__db.emision_reglas
        .where('subcategoria').equals(subcat)
        .filter(r => !r.deleted_at && filaDelModo(r)).toArray();
      const target = existentes.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))[0];
      if (target) {
        await window.__db.emision_reglas.update(target.id, {
          company_id: companyId || null, categoria: categoria || target.categoria || null,
          updated_at: now, updated_by: userId,
          version: (target.version ?? 0) + 1,
          sync_status: esPrueba ? SYNC_STATUS.SYNCED
            : (target.sync_status === SYNC_STATUS.PENDING_CREATE ? SYNC_STATUS.PENDING_CREATE : SYNC_STATUS.PENDING_UPDATE),
        });
      } else {
        if (!companyId) return;   // quitar designación de una regla inexistente = nada
        await window.__db.emision_reglas.add({
          id: newId(), subcategoria: subcat, categoria: categoria || null, company_id: companyId,
          created_by: userId, updated_by: userId, created_at: now, updated_at: now, version: 1,
          idempotency_key: newIdempotencyKey(userId, 'emision_reglas'),
          ...(esPrueba ? { demo: true, sync_status: SYNC_STATUS.SYNCED } : { sync_status: SYNC_STATUS.PENDING_CREATE }),
        });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'emision_reglas' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      toast(companyId ? `"${subcat}" → emitirá ${companyNombre(companyId) || 'la empresa elegida'}` : `"${subcat}" quedó sin designar`, 'green');
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusyRegla(false); }
  };

  const exportar = async () => {
    try {
      const { generateExcelSheets } = await import('../lib/reports.js');
      const porSubcat = grupos.map(g => {
        const r = g.esRegla ? reglaPorSubcat.get(g.subcat) : null;
        return [g.subcat, g.categoria ? (CAT_LBL[g.categoria] || g.categoria) : '', g.nItems, +g.total.toFixed(2),
          [...g.compradoras.entries()].map(([cid, m]) => `${companyNombre(cid) || 'empresa'}: ${fmtS(m)}`).join(' · '),
          r?.company_id ? (companyNombre(r.company_id) || '') : ''];
      });
      const porEmp = [...porEmisora.entries()].map(([cid, e]) => [
        cid === '__sin__' ? '(sin designar)' : (companyNombre(cid) || 'empresa'),
        +e.total.toFixed(2),
        e.subcats.map(s => `${s.nombre} (${fmtS(s.total)})`).join(' · '),
      ]);
      await generateExcelSheets({
        filename: `JARVEX_compras_por_categoria_${new Date().toISOString().slice(0, 10)}.xlsx`,
        sheets: [
          { name: 'Por subcategoría', columnas: ['Subcategoría', 'Categoría', 'Ítems', 'Total S/', 'Compradoras', 'Emisora designada'], filas: porSubcat },
          { name: 'Por empresa emisora', columnas: ['Empresa emisora', 'Total S/', 'Subcategorías'], filas: porEmp },
        ],
      });
      toast('Exportado', 'green');
    } catch (e) { toast('Error al exportar: ' + (e.message || e), 'red'); }
  };

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Compras por Categoría</div>
          <div className="pg-sub">Designá qué empresa del grupo emite las facturas de cada subcategoría de compras</div>
        </div>
        <button className="btn btn-amber btn-sm" onClick={exportar} disabled={!grupos.length}>
          <JxIcon name="download" size={13} /> Exportar Excel
        </button>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <select className="fi" value={filtroObra} onChange={e => setFiltroObra(e.target.value)} style={{ minWidth: 200, maxWidth: 320 }}>
          <option value="todas">Todas las obras</option>
          {(obras || []).filter(o => !o.deleted_at).map(o => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}
        </select>
        <select className="fi" value={filtroCat} onChange={e => setFiltroCat(e.target.value)} style={{ width: 170 }}>
          <option value="todas">Todas las categorías</option>
          {Object.entries(CAT_LBL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          <option value="sin_clasificar">— Sin clasificar —</option>
        </select>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, color: 'var(--tm)' }}>
          <span>Desde</span>
          <input type="date" className="fi" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} style={{ padding: '4px 6px', fontSize: 11, width: 140 }} />
          <span>Hasta</span>
          <input type="date" className="fi" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} style={{ padding: '4px 6px', fontSize: 11, width: 140 }} />
          {(fechaDesde || fechaHasta) && <button className="btn btn-ghost btn-xs" onClick={() => { setFechaDesde(''); setFechaHasta(''); }}><JxIcon name="x" size={11} /></button>}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div className="kpi-card"><div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Total compras (filtro)</div><div className="kpi-val" style={{ fontSize: 19 }}>{fmtS(kpis.total)}</div></div>
        <div className="kpi-card"><div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Clasificado</div><div className="kpi-val" style={{ fontSize: 19 }}>{kpis.pctClasif.toFixed(0)}%</div></div>
        <div className="kpi-card"><div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Con emisora designada</div><div className="kpi-val" style={{ fontSize: 19, color: 'var(--green)' }}>{fmtS(kpis.designado)}</div></div>
        <div className="kpi-card"><div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Sin designar</div><div className="kpi-val" style={{ fontSize: 19, color: 'var(--amber)' }}>{fmtS(kpis.total - kpis.designado)}</div></div>
      </div>

      {grupos.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="layers" size={40} color="var(--tm)" />
          <p>No hay compras en el filtro. Clasificá los ítems en Conciliación de Insumos → Insumos Comprados (botón "✨ Clasificar IA").</p>
        </div>
      ) : (<>
        {/* ── Designación por subcategoría ── */}
        <div className="card" style={{ overflow: 'hidden', marginBottom: 18 }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Subcategoría</th>
                <th style={{ width: 120 }}>Categoría</th>
                <th style={{ textAlign: 'right', width: 70 }}>Ítems</th>
                <th style={{ textAlign: 'right', width: 120 }}>Total</th>
                <th>Compró</th>
                <th style={{ width: 230 }}>Emitirá la factura</th>
              </tr></thead>
              <tbody>
                {grupos.map(g => {
                  const r = g.esRegla ? reglaPorSubcat.get(g.subcat) : null;
                  return (
                    <tr key={g.subcat}>
                      <td className="col-p" style={{ fontWeight: 600 }}>{g.subcat}</td>
                      <td>{g.categoria ? <span className={`badge ${CAT_CLS[g.categoria] || 'b-gray'}`} style={{ fontSize: 10 }}>{CAT_LBL[g.categoria] || g.categoria}</span> : <span style={{ fontSize: 10, color: 'var(--tm)' }}>—</span>}</td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>{g.nItems}</td>
                      <td style={{ textAlign: 'right', fontSize: 12.5, fontWeight: 700 }}>{fmtS(g.total)}</td>
                      <td style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                        {[...g.compradoras.entries()].map(([cid, m]) => `${companyNombre(cid) || 'empresa'} (${fmtS(m)})`).join(' · ') || '—'}
                      </td>
                      <td>
                        {g.esRegla ? (
                          <select className="fi" style={{ fontSize: 11, padding: '4px 6px' }} disabled={!canDesignar || busyRegla}
                            title={canDesignar ? 'Elegí qué empresa del grupo emitirá las facturas de esta subcategoría' : 'Solo la contadora jefe / admin designan'}
                            value={r?.company_id || ''} onChange={e => designar(g.subcat, g.categoria, e.target.value)}>
                            <option value="">— Sin designar —</option>
                            {companiesActivas.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        ) : (
                          <span style={{ fontSize: 10.5, color: 'var(--tm)', fontStyle: 'italic' }}>{g.categoria ? 'agregá subcategoría para designar' : 'clasificá primero'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Resumen por empresa emisora ── */}
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: 'var(--tm)', margin: '6px 0 10px' }}>RESUMEN · QUÉ EMITE CADA EMPRESA</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {[...porEmisora.entries()].sort((a, b) => b[1].total - a[1].total).map(([cid, e]) => (
            <div key={cid} className="card card-p" style={{ border: cid === '__sin__' ? '1px solid rgba(242,183,5,0.35)' : '1px solid var(--bd)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: cid === '__sin__' ? 'var(--amber)' : 'var(--tp)', marginBottom: 2 }}>
                {cid === '__sin__' ? '⚠ Sin designar' : companyNombre(cid) || 'Empresa'}
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, color: cid === '__sin__' ? 'var(--amber)' : 'var(--green)', marginBottom: 8 }}>{fmtS(e.total)}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {e.subcats.sort((a, b) => b.total - a.total).slice(0, 8).map(s => (
                  <div key={s.nombre} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
                    <span style={{ color: 'var(--ts)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>{s.nombre}</span>
                    <span style={{ color: 'var(--tm)', flexShrink: 0 }}>{fmtS(s.total)}</span>
                  </div>
                ))}
                {e.subcats.length > 8 && <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>… y {e.subcats.length - 8} subcategoría(s) más</div>}
              </div>
            </div>
          ))}
        </div>
      </>)}
    </div>
  );
}

Object.assign(window, { ComprasCategoriaPage });
export { ComprasCategoriaPage };
