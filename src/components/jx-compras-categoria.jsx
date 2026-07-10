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
import { getCurrentMode } from "../lib/app-mode-core.js";

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
  // Designar (emisora + intermediarias = armar la cadena de facturación) es
  // SOLO de la contadora jefe y administradores — igual que Trazabilidad
  // (pedido explícito de Gabriel: no asistentes, y gerente tampoco designa).
  const canDesignar = rol === 'admin' || rol === 'contador';
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
  // ¿La empresa tiene sus actividades económicas registradas? (las mantienen los
  // asistentes en Empresas). Facturar un rubro fuera de la actividad = incoherencia.
  const sinActividades = (id) => {
    const c = (companies || []).find(x => x.id === id);
    return c ? !(Array.isArray(c.actividades_economicas) && c.actividades_economicas.filter(Boolean).length) : false;
  };

  // ── Valorización al PRECIO PRESUPUESTADO (requiere UNA obra elegida) ──
  // Al facturar, las empresas designadas venden el insumo al precio del
  // expediente de obra → por cada ítem VINCULADO se valoriza cantidad_vinculada
  // × precio presupuestado del insumo (ponderado si está en varias partidas).
  const [presup, setPresup] = uS(null); // { vincPorItem: Map<facturaId|idx, [{codigo,cantidad}]>, precioPorCodigo: Map }
  uE(() => {
    let cancel = false;
    if (filtroObra === 'todas') { setPresup(null); return; }
    (async () => {
      try {
        const [vins, ips] = await Promise.all([
          window.__db.conciliacion_vinculos.where('obra_id').equals(filtroObra).filter(v => !v.deleted_at).toArray(),
          window.__db.insumos_partida.where('obra_id').equals(filtroObra).filter(ip => !ip.deleted_at).toArray(),
        ]);
        if (cancel) return;
        const acum = new Map();  // codigo → { cant, monto }
        for (const ip of ips) {
          // MISMA derivación de código que la maestra de Conciliación (que es
          // la que guardan los vínculos): código Delfín trimeado, o la clave
          // sintética 'sc:' para insumos SIN código. Sin esto, los vínculos a
          // insumos sin código no matcheaban y el "A facturar" se subvaluaba.
          const codigo = (ip.insumo_codigo && String(ip.insumo_codigo).trim())
            || ('sc:' + (ip.nombre_insumo || '') + '|' + (ip.tipo_insumo || '') + '|' + (ip.unidad || ''));
          const cant = Number(ip.cantidad_presupuestada) || 0;
          const monto = Number(ip.costo_presupuestado) || (cant * (Number(ip.precio_presupuestado) || 0));
          const cur = acum.get(codigo) || { cant: 0, monto: 0 };
          cur.cant += cant; cur.monto += monto;
          acum.set(codigo, cur);
        }
        const precioPorCodigo = new Map();
        for (const [codigo, a] of acum) if (a.cant > 0) precioPorCodigo.set(codigo, a.monto / a.cant);
        const vincPorItem = new Map();
        for (const v of vins) {
          const k = `${v.accounting_movement_id}|${v.item_idx}`;
          const a = vincPorItem.get(k) || []; a.push(v); vincPorItem.set(k, a);
        }
        setPresup({ vincPorItem, precioPorCodigo });
      } catch { if (!cancel) setPresup(null); }
    })();
    return () => { cancel = true; };
  }, [filtroObra]);

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
      arr.forEach((it, idx) => {
        if (filtroCat !== 'todas' && (it.categoria || null) !== (filtroCat === 'sin_clasificar' ? null : filtroCat)) return;
        if (filtroCat === 'sin_clasificar' && it.categoria) return;
        out.push({
          facturaId: mv.id, itemIdx: idx,
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
      const g = m.get(key) || { subcat: key, esRegla: !!it.subcategoria, categoria: it.categoria, total: 0, nItems: 0, compradoras: new Map(), aFacturar: 0, nVinc: 0 };
      g.total += it.monto;
      g.nItems++;
      if (it.companyId) g.compradoras.set(it.companyId, (g.compradoras.get(it.companyId) || 0) + it.monto);
      // Valorización al presupuesto (solo con obra elegida): Σ cantidad
      // vinculada × precio presupuestado del insumo del expediente.
      if (presup) {
        const vs = presup.vincPorItem.get(`${it.facturaId}|${it.itemIdx}`) || [];
        for (const v of vs) {
          const pu = presup.precioPorCodigo.get(v.insumo_codigo);
          // Cada vínculo guarda la cantidad COMPLETA del ítem; con 1 ítem → N
          // insumos se reparte 1/N para no duplicar el monto a facturar.
          if (pu != null) { g.aFacturar += ((Number(v.cantidad) || 0) / vs.length) * pu; g.nVinc++; }
        }
      }
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [items, presup]);

  const kpis = uM(() => {
    const total = items.reduce((s, it) => s + it.monto, 0);
    const clasif = items.filter(it => it.categoria).reduce((s, it) => s + it.monto, 0);
    let designado = 0, aFacturar = 0;
    for (const g of grupos) {
      aFacturar += g.aFacturar || 0;
      if (!g.esRegla) continue;
      const r = reglaPorSubcat.get(g.subcat);
      if (r?.company_id) designado += g.total;
    }
    return { total, clasif, designado, aFacturar, pctClasif: total > 0 ? (clasif / total) * 100 : 0 };
  }, [items, grupos, reglaPorSubcat]);

  // Resumen por EMPRESA EMISORA designada ("con JARVEX emitiremos: …").
  const porEmisora = uM(() => {
    const m = new Map();   // companyId|'__sin__' → { total, aFacturar, subcats: [] }
    for (const g of grupos) {
      const r = g.esRegla ? reglaPorSubcat.get(g.subcat) : null;
      const key = r?.company_id || '__sin__';
      const e = m.get(key) || { total: 0, aFacturar: 0, subcats: [] };
      e.total += g.total;
      e.aFacturar += g.aFacturar || 0;
      // Cadena solo si hay emisora designada (una regla con emisora quitada no
      // debe mostrar 'vía X → Y' huérfano en la card Sin designar ni el export).
      e.subcats.push({ nombre: g.subcat, total: g.total, cadena: r?.company_id ? [r.intermediaria1_company_id, r.intermediaria2_company_id].filter(Boolean) : [] });
      m.set(key, e);
    }
    return m;
  }, [grupos, reglaPorSubcat]);

  // Designar la cadena de una subcategoría. patch: { company_id? (emisora
  // final), intermediaria1_company_id?, intermediaria2_company_id? }.
  // Cadena completa: compradora → [int1] → [int2] → emisora final → ejecutora.
  const designar = async (subcat, categoria, patch, msg) => {
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
          ...patch, categoria: categoria || target.categoria || null,
          updated_at: now, updated_by: userId,
          version: (target.version ?? 0) + 1,
          sync_status: esPrueba ? SYNC_STATUS.SYNCED
            : (target.sync_status === SYNC_STATUS.PENDING_CREATE ? SYNC_STATUS.PENDING_CREATE : SYNC_STATUS.PENDING_UPDATE),
        });
      } else {
        if (!patch.company_id && !patch.intermediaria1_company_id && !patch.intermediaria2_company_id) return;
        await window.__db.emision_reglas.add({
          id: newId(), subcategoria: subcat, categoria: categoria || null,
          company_id: patch.company_id || null,
          intermediaria1_company_id: patch.intermediaria1_company_id || null,
          intermediaria2_company_id: patch.intermediaria2_company_id || null,
          created_by: userId, updated_by: userId, created_at: now, updated_at: now, version: 1,
          idempotency_key: newIdempotencyKey(userId, 'emision_reglas'),
          ...(esPrueba ? { demo: true, sync_status: SYNC_STATUS.SYNCED } : { sync_status: SYNC_STATUS.PENDING_CREATE }),
        });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'emision_reglas' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      if (msg) toast(msg, 'green');
      // Coherencia: avisar si alguna empresa de la cadena no tiene actividades registradas.
      const nuevas = Object.values(patch).filter(Boolean);
      const sinAct = nuevas.filter(cid => sinActividades(cid));
      if (sinAct.length) toast(`⚠ ${sinAct.map(c => companyNombre(c)).filter(Boolean).join(', ')}: sin actividades económicas registradas — pedile al asistente que las complete en Empresas`, 'amber');
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusyRegla(false); }
  };

  const exportar = async () => {
    try {
      const { generateExcelSheets } = await import('../lib/reports.js');
      const porSubcat = grupos.map(g => {
        const r = g.esRegla ? reglaPorSubcat.get(g.subcat) : null;
        const cadena = r?.company_id ? [r.intermediaria1_company_id, r.intermediaria2_company_id].filter(Boolean).map(x => companyNombre(x)).filter(Boolean).join(' → ') : '';
        return [g.subcat, g.categoria ? (CAT_LBL[g.categoria] || g.categoria) : '', g.nItems, +g.total.toFixed(2),
          filtroObra === 'todas' ? '' : +(g.aFacturar || 0).toFixed(2),
          [...g.compradoras.entries()].map(([cid, m]) => `${companyNombre(cid) || 'empresa'}: ${fmtS(m)}`).join(' · '),
          r?.company_id ? (companyNombre(r.company_id) || '') : '',
          cadena];
      });
      const porEmp = [...porEmisora.entries()].map(([cid, e]) => [
        cid === '__sin__' ? '(sin designar)' : (companyNombre(cid) || 'empresa'),
        +e.total.toFixed(2),
        filtroObra === 'todas' ? '' : +(e.aFacturar || 0).toFixed(2),
        e.subcats.map(s => `${s.nombre} (${fmtS(s.total)})${s.cadena.length ? ' vía ' + s.cadena.map(x => companyNombre(x)).filter(Boolean).join('→') : ''}`).join(' · '),
      ]);
      await generateExcelSheets({
        filename: `JARVEX_compras_por_categoria_${new Date().toISOString().slice(0, 10)}.xlsx`,
        sheets: [
          { name: 'Por subcategoría', columnas: ['Subcategoría', 'Categoría', 'Ítems', 'Costo compra S/', 'A facturar presup. S/', 'Compradoras', 'Emisora designada', 'Intermediarias'], filas: porSubcat },
          { name: 'Por empresa emisora', columnas: ['Empresa emisora', 'Costo compra S/', 'A facturar presup. S/', 'Subcategorías'], filas: porEmp },
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
        <div className="kpi-card" title="Cantidad vinculada × precio presupuestado del expediente (requiere elegir UNA obra)"><div style={{ fontSize: 11.5, color: 'var(--tm)' }}>A facturar (presup.)</div><div className="kpi-val" style={{ fontSize: 19, color: 'var(--blue, #3498DB)' }}>{filtroObra === 'todas' ? '—' : fmtS(kpis.aFacturar)}</div></div>
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
                <th style={{ width: 110 }}>Categoría</th>
                <th style={{ textAlign: 'right', width: 60 }}>Ítems</th>
                <th style={{ textAlign: 'right', width: 110 }}>Costo compra</th>
                <th style={{ textAlign: 'right', width: 120 }} title="Cantidad vinculada × precio presupuestado del expediente (elegí UNA obra para valorizar)">A facturar (presup.)</th>
                <th>Compró</th>
                <th style={{ width: 250 }}>Cadena de facturación</th>
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
                      <td style={{ textAlign: 'right', fontSize: 12 }}>
                        {filtroObra === 'todas'
                          ? <span style={{ fontSize: 10, color: 'var(--tm)', fontStyle: 'italic' }} title="Elegí UNA obra en el filtro para valorizar al precio del expediente">elegí obra</span>
                          : (g.aFacturar > 0
                            ? <span style={{ color: 'var(--green)', fontWeight: 700 }}>{fmtS(g.aFacturar)}<div style={{ fontSize: 9.5, fontWeight: 400, color: 'var(--tm)' }}>{g.nVinc} vínculo(s)</div></span>
                            : <span style={{ fontSize: 10, color: 'var(--amber)' }} title="Sin ítems vinculados al presupuesto — vinculá en Conciliación de Insumos">sin vincular</span>)}
                      </td>
                      <td style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                        {[...g.compradoras.entries()].map(([cid, m]) => `${companyNombre(cid) || 'empresa'} (${fmtS(m)})`).join(' · ') || '—'}
                      </td>
                      <td>
                        {g.esRegla ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <select className="fi" style={{ fontSize: 11, padding: '3px 6px', flex: 1 }} disabled={!canDesignar || busyRegla}
                                title={canDesignar ? 'Empresa que emitirá la factura FINAL a la ejecutora' : 'Solo la contadora jefe / admin designan'}
                                value={r?.company_id || ''} onChange={e => designar(g.subcat, g.categoria,
                                  // Quitar la emisora limpia TODA la cadena (si no, las
                                  // intermediarias quedaban latentes, invisibles e ineditables,
                                  // y se re-adjuntaban solas al designar otra emisora).
                                  e.target.value ? { company_id: e.target.value } : { company_id: null, intermediaria1_company_id: null, intermediaria2_company_id: null },
                                  e.target.value ? `"${g.subcat}" → emitirá ${companyNombre(e.target.value)}` : `"${g.subcat}" sin designar`)}>
                                <option value="">— Emisora final: sin designar —</option>
                                {companiesActivas.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                              </select>
                              {r?.company_id && sinActividades(r.company_id) && (
                                <span title="Esta empresa no tiene actividades económicas registradas — pedile al asistente que las complete en Empresas (evita incoherencias al facturar)" style={{ cursor: 'help' }}>⚠</span>
                              )}
                            </div>
                            {canDesignar && r?.company_id && (
                              <div style={{ display: 'flex', gap: 3, alignItems: 'center' }} title="Empresas intermediarias (opcional): compradora → int. 1 → int. 2 → emisora final → ejecutora">
                                <span style={{ fontSize: 9, color: 'var(--tm)', flexShrink: 0 }}>vía</span>
                                <select className="fi" style={{ fontSize: 10, padding: '2px 4px', flex: 1 }} disabled={busyRegla}
                                  value={r?.intermediaria1_company_id || ''} onChange={e => designar(g.subcat, g.categoria, { intermediaria1_company_id: e.target.value || null, ...(e.target.value ? {} : { intermediaria2_company_id: null }) }, 'Cadena actualizada')}>
                                  <option value="">— directo —</option>
                                  {companiesActivas.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                                {r?.intermediaria1_company_id && (
                                  <select className="fi" style={{ fontSize: 10, padding: '2px 4px', flex: 1 }} disabled={busyRegla}
                                    value={r?.intermediaria2_company_id || ''} onChange={e => designar(g.subcat, g.categoria, { intermediaria2_company_id: e.target.value || null }, 'Cadena actualizada')}>
                                    <option value="">— sin 2ª —</option>
                                    {companiesActivas.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                  </select>
                                )}
                              </div>
                            )}
                            {!canDesignar && (r?.intermediaria1_company_id || r?.intermediaria2_company_id) && (
                              <div style={{ fontSize: 9.5, color: 'var(--tm)' }}>vía {[r?.intermediaria1_company_id, r?.intermediaria2_company_id].filter(Boolean).map(cid => companyNombre(cid)).filter(Boolean).join(' → ')}</div>
                            )}
                          </div>
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
              <div style={{ fontSize: 13, fontWeight: 700, color: cid === '__sin__' ? 'var(--amber)' : 'var(--tp)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                {cid === '__sin__' ? '⚠ Sin designar' : companyNombre(cid) || 'Empresa'}
                {cid !== '__sin__' && sinActividades(cid) && <span title="Sin actividades económicas registradas — el asistente debe completarlas en Empresas" style={{ cursor: 'help', fontSize: 12 }}>⚠</span>}
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, color: cid === '__sin__' ? 'var(--amber)' : 'var(--green)', marginBottom: 2 }}>{fmtS(e.total)}</div>
              {filtroObra !== 'todas' && e.aFacturar > 0 && (
                <div style={{ fontSize: 11, color: '#3498DB', marginBottom: 6 }} title="Valorizado al precio presupuestado del expediente">A facturar (presup.): <strong>{fmtS(e.aFacturar)}</strong></div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                {e.subcats.sort((a, b) => b.total - a.total).slice(0, 8).map(s => (
                  <div key={s.nombre} style={{ fontSize: 11.5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--ts)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>{s.nombre}</span>
                      <span style={{ color: 'var(--tm)', flexShrink: 0 }}>{fmtS(s.total)}</span>
                    </div>
                    {s.cadena.length > 0 && <div style={{ fontSize: 9.5, color: 'var(--tm)' }}>vía {s.cadena.map(x => companyNombre(x)).filter(Boolean).join(' → ')}</div>}
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
