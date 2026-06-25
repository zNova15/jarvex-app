// ═══════════════════════════════════════════════════════════════════
// JARVEX — Movimientos de Insumos (consolidado de obra)
//
// Vista GENERAL y de SOLO LECTURA de todo el inventario y todos los
// movimientos de los 5 tipos de insumo (materiales, herramientas, EPPs,
// insumos de emergencia y maquinaria) de la obra activa. Pensada para que
// el Asistente de Administración (y gerencia) pueda VISUALIZAR sin tocar.
//
// Dos pestañas:
//   · Base de datos → inventario consolidado (stock actual de cada insumo).
//   · Movimientos   → historial unificado, filtrable por tipo de insumo y
//                     por tipo de movimiento (entrada / salida / devolución).
//
// OJO con la inconsistencia del modelo de movimientos:
//   · materiales / epp / emergencia / maquinaria usan `tipo_movimiento`
//     (entrada · salida · devolucion · ajuste · merma).
//   · herramientas usa `accion` (entrada · salida) + `tipo_movimiento`
//     (ingreso · devolucion · salida) — la semántica fina está en tipo_movimiento.
//   · EPP guarda la persona en `personal_id`, las otras 4 en `responsable_id`.
// ═══════════════════════════════════════════════════════════════════

import React from "react";

const { useState: uS, useMemo: uM, useEffect: uE } = React;
const fmtN = (n) => Number(n || 0).toLocaleString('es-PE');

const CATS = [
  { key: 'material',    label: 'Materiales',   icon: 'package', color: 'var(--blue)',   mov: 'movimientos_materiales',         fk: 'material_id',          cat: 'materiales',         nombreCol: 'nombre_material',    codigoCol: 'codigo_s10', personaCol: 'responsable_id', porObra: true  },
  { key: 'herramienta', label: 'Herramientas', icon: 'tool',    color: 'var(--amber)',  mov: 'movimientos_herramientas',       fk: 'herramienta_id',       cat: 'herramientas',       nombreCol: 'nombre_herramienta', codigoCol: 'serie',      personaCol: 'responsable_id', porObra: true  },
  { key: 'epp',         label: 'EPPs',         icon: 'shield',  color: 'var(--green)',  mov: 'movimientos_epp',                fk: 'epp_id',               cat: 'epps',               nombreCol: 'nombre_epp',         codigoCol: null,         personaCol: 'personal_id',    porObra: true  },
  { key: 'emergencia',  label: 'Emergencia',   icon: 'alert',   color: 'var(--red)',    mov: 'movimientos_insumos_emergencia', fk: 'insumo_emergencia_id', cat: 'insumos_emergencia', nombreCol: 'nombre',             codigoCol: null,         personaCol: 'responsable_id', porObra: true  },
  { key: 'maquinaria',  label: 'Maquinaria',   icon: 'truck',   color: 'var(--orange)', mov: 'movimientos_maquinaria',         fk: 'activo_id',            cat: 'activos_pesados',    nombreCol: 'nombre',             codigoCol: 'codigo',     personaCol: 'responsable_id', porObra: false }, // activos_pesados no indexa obra_id
];
const CAT_BY_KEY = Object.fromEntries(CATS.map(c => [c.key, c]));

// Dirección unificada de un movimiento: entrada · salida · devolucion · otro · reverso.
function dirMov(c, mv) {
  if (mv.reverses_id || mv.reversed_by_id || mv.tipo_movimiento === 'reverso') return 'reverso';
  if (c.key === 'herramienta') {
    if (mv.tipo_movimiento === 'devolucion') return 'devolucion';
    if (mv.tipo_movimiento === 'ingreso' || mv.accion === 'entrada') return 'entrada';
    if (mv.accion === 'salida' || mv.tipo_movimiento === 'salida') return 'salida';
    return 'otro'; // mantenimiento · baja · reposicion
  }
  const t = mv.tipo_movimiento;
  if (t === 'entrada') return 'entrada';
  if (t === 'salida') return 'salida';
  if (t === 'devolucion') return 'devolucion';
  return 'otro'; // ajuste · merma
}
const DIR_META = {
  entrada:    { cls: 'b-green',  lbl: 'Entrada' },
  salida:     { cls: 'b-orange', lbl: 'Salida' },
  devolucion: { cls: 'b-blue',   lbl: 'Devolución' },
  otro:       { cls: 'b-gray',   lbl: 'Otro' },
  reverso:    { cls: 'b-gray',   lbl: 'Reverso' },
};
const TOPE_RENDER = 600; // tope de filas renderizadas (los KPIs y conteos usan el total)

function MovimientosInsumosPage({ showToast }) {
  const toast = showToast || window.__showToast || (() => {});
  const { obraId } = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const { data: personal } = window.__hooks.usePersonal(obraId);
  const { data: subcontratistas } = window.__hooks.useSubcontratistas();
  const { data: frentes } = window.__hooks.useFrentesObra(obraId, { soloActivas: false });

  const [tab, setTab] = uS('inventario');     // 'inventario' | 'movimientos'
  const [catFiltro, setCatFiltro] = uS('todos');
  const [dirFiltro, setDirFiltro] = uS('todos'); // solo pestaña movimientos
  const [q, setQ] = uS('');
  const [desde, setDesde] = uS('');
  const [hasta, setHasta] = uS('');
  const [soloStockBajo, setSoloStockBajo] = uS(false);
  const [catalogo, setCatalogo] = uS([]);   // inventario unificado
  const [movs, setMovs] = uS([]);           // movimientos unificados
  const [loading, setLoading] = uS(true);

  // ── Carga unificada de los 5 catálogos + las 5 tablas de movimientos ──
  uE(() => {
    if (!obraId) { setCatalogo([]); setMovs([]); setLoading(false); return; }
    let cancel = false;
    const cargar = async () => {
      const db = window.__db;
      try {
        const catOut = [];
        const nombreById = {};
        for (const c of CATS) {
          nombreById[c.key] = new Map();
          const rows = c.porObra
            ? await db[c.cat].where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray()
            : await db[c.cat].filter(r => !r.deleted_at && (r.obra_actual_id === obraId || r.obra_id === obraId)).toArray();
          for (const r of rows) {
            const nombre = r[c.nombreCol] || '—';
            const unidad = r.unidad || '';
            nombreById[c.key].set(r.id, { nombre, unidad }); // registrar nombre SIEMPRE (incl. padres) para resolver movimientos
            // Las filas "padre" de variantes SKU (es_grupo) son un rollup sin stock
            // propio ni movimientos: su stock real vive en los hijos (con padre_id),
            // que ya se listan aparte. No las mostramos como insumo fantasma (stock 0)
            // ni las contamos en los KPIs/chips — alineado con la vista de almacén.
            if (r.es_grupo) continue;
            catOut.push({
              cat: c.key, id: r.id, nombre,
              codigo: (c.codigoCol && r[c.codigoCol]) || '',
              unidad, stock: Number(r.stock_actual || 0),
              stockMin: Number(r.stock_minimo || 0),
              estado: r.estado || r.estado_actual || '',
            });
          }
        }
        const movOut = [];
        for (const c of CATS) {
          await db[c.mov].where('obra_id').equals(obraId).each(mv => {
            if (mv.deleted_at) return;
            const info = nombreById[c.key].get(mv[c.fk]) || { nombre: '—', unidad: '' };
            const cantidad = c.key === 'maquinaria' ? (Number(mv.cantidad) || 1) : (Number(mv.cantidad) || 0);
            movOut.push({
              id: mv.id, cat: c.key, fecha: (mv.fecha || '').slice(0, 10),
              insumoNombre: info.nombre,
              unidad: mv.unidad || info.unidad || (c.key === 'maquinaria' ? 'und' : ''),
              cantidad, dir: dirMov(c, mv),
              frenteId: mv.frente_id || null,
              personaId: mv[c.personaCol] || null,
              subId: mv.subcontratista_id || null,
              obs: mv.observaciones || mv.motivo || '',
            });
          });
        }
        if (!cancel) { setCatalogo(catOut); setMovs(movOut); setLoading(false); }
      } catch { if (!cancel) { setCatalogo([]); setMovs([]); setLoading(false); } }
    };
    setLoading(true); cargar();
    // Debounce: en sync/realtime cada fila dispara jx_data_changed Y jarvex_master_updated.
    // Sin coalescer, un lote de N movimientos re-escanearía las 10 tablas hasta 2·N veces.
    let debId = null;
    const onData = () => { clearTimeout(debId); debId = setTimeout(() => { if (!cancel) cargar(); }, 400); };
    window.addEventListener('jx_data_changed', onData);
    window.addEventListener('jarvex_master_updated', onData);
    return () => { cancel = true; clearTimeout(debId); window.removeEventListener('jx_data_changed', onData); window.removeEventListener('jarvex_master_updated', onData); };
  }, [obraId]);

  const personalById = uM(() => { const m = new Map(); (personal || []).forEach(p => m.set(p.id, p)); return m; }, [personal]);
  const subById = uM(() => { const m = new Map(); (subcontratistas || []).forEach(s => m.set(s.id, s)); return m; }, [subcontratistas]);
  const frenteById = uM(() => { const m = new Map(); (frentes || []).forEach(f => m.set(f.id, f.nombre || '—')); return m; }, [frentes]);

  const nombreDestino = (m) => {
    if (m.subId) return (subById.get(m.subId)?.razon_social || 'Subcontrato') + ' (subc.)';
    if (m.personaId) { const p = personalById.get(m.personaId); return p ? `${p.nombres || ''} ${p.apellidos || ''}`.trim() : '(persona)'; }
    return '';
  };

  const qn = q.trim().toLowerCase();

  // ── Inventario filtrado ──
  const invFiltrado = uM(() => catalogo.filter(r => {
    if (catFiltro !== 'todos' && r.cat !== catFiltro) return false;
    if (soloStockBajo && !(r.stockMin > 0 && r.stock <= r.stockMin)) return false;
    if (qn && !(`${r.nombre} ${r.codigo}`.toLowerCase().includes(qn))) return false;
    return true;
  }).sort((a, b) => a.nombre.localeCompare(b.nombre)), [catalogo, catFiltro, soloStockBajo, qn]);

  // ── Movimientos filtrados ──
  const movFiltrado = uM(() => movs.filter(m => {
    if (catFiltro !== 'todos' && m.cat !== catFiltro) return false;
    if (dirFiltro !== 'todos') {
      if (dirFiltro === 'otros') { if (m.dir !== 'otro' && m.dir !== 'reverso') return false; }
      else if (m.dir !== dirFiltro) return false;
    }
    if (desde && m.fecha && m.fecha < desde) return false;
    if (hasta && m.fecha && m.fecha > hasta) return false;
    if (qn && !m.insumoNombre.toLowerCase().includes(qn)) return false;
    return true;
  }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))), [movs, catFiltro, dirFiltro, desde, hasta, qn]);

  // ── KPIs ──
  const invKpis = uM(() => {
    const porCat = {}; for (const c of CATS) porCat[c.key] = 0;
    let bajo = 0;
    for (const r of invFiltrado) { porCat[r.cat]++; if (r.stockMin > 0 && r.stock <= r.stockMin) bajo++; }
    return { total: invFiltrado.length, porCat, bajo };
  }, [invFiltrado]);

  const movKpis = uM(() => {
    let entrada = 0, salida = 0, devol = 0;
    for (const m of movFiltrado) { if (m.dir === 'entrada') entrada++; else if (m.dir === 'salida') salida++; else if (m.dir === 'devolucion') devol++; }
    return { total: movFiltrado.length, entrada, salida, devol };
  }, [movFiltrado]);

  // Conteo por categoría para los chips (respetando los demás filtros pero no la categoría).
  const conteoCat = uM(() => {
    const base = tab === 'inventario'
      ? catalogo.filter(r => (!soloStockBajo || (r.stockMin > 0 && r.stock <= r.stockMin)) && (!qn || `${r.nombre} ${r.codigo}`.toLowerCase().includes(qn)))
      : movs.filter(m => {
          if (dirFiltro !== 'todos') { if (dirFiltro === 'otros') { if (m.dir !== 'otro' && m.dir !== 'reverso') return false; } else if (m.dir !== dirFiltro) return false; }
          if (desde && m.fecha && m.fecha < desde) return false;
          if (hasta && m.fecha && m.fecha > hasta) return false;
          if (qn && !m.insumoNombre.toLowerCase().includes(qn)) return false;
          return true;
        });
    const m = { todos: base.length }; for (const c of CATS) m[c.key] = 0;
    for (const r of base) m[r.cat]++;
    return m;
  }, [tab, catalogo, movs, soloStockBajo, dirFiltro, desde, hasta, qn]);

  const exportar = async () => {
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      if (tab === 'inventario') {
        if (!invFiltrado.length) { toast('No hay insumos para exportar con estos filtros', 'amber'); return; }
        const headers = ['Tipo', 'Insumo', 'Código', 'Unidad', 'Stock actual', 'Stock mínimo', 'Estado'];
        const rows = invFiltrado.map(r => [CAT_BY_KEY[r.cat]?.label || r.cat, r.nombre, r.codigo, r.unidad, r.stock, r.stockMin, r.estado]);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Inventario');
        XLSX.writeFile(wb, 'inventario_insumos.xlsx');
        toast(`${rows.length} insumos exportados`, 'green');
      } else {
        if (!movFiltrado.length) { toast('No hay movimientos para exportar con estos filtros', 'amber'); return; }
        const headers = ['Fecha', 'Tipo', 'Insumo', 'Movimiento', 'Cantidad', 'Unidad', 'Frente', 'Destino', 'Observaciones'];
        const rows = movFiltrado.map(m => [m.fecha, CAT_BY_KEY[m.cat]?.label || m.cat, m.insumoNombre, DIR_META[m.dir]?.lbl || m.dir, m.cantidad, m.unidad, m.frenteId ? (frenteById.get(m.frenteId) || '') : '', nombreDestino(m), m.obs]);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Movimientos');
        XLSX.writeFile(wb, 'movimientos_insumos.xlsx');
        toast(`${rows.length} movimientos exportados`, 'green');
      }
    } catch (e) { toast('Error al exportar: ' + (e.message || e), 'red'); }
  };

  if (!obraId) {
    return <div className="page-wrap"><div className="card card-p empty-state"><JxIcon name="layers" size={32} color="var(--tm)" /><p>Seleccioná una obra activa para ver el inventario y los movimientos de insumos.</p></div></div>;
  }

  const invMostradas = invFiltrado.slice(0, TOPE_RENDER);
  const movMostrados = movFiltrado.slice(0, TOPE_RENDER);

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Movimientos de Insumos</div>
          <div className="pg-sub">Vista general de solo lectura — inventario y movimientos de materiales, herramientas, EPPs, emergencia y maquinaria</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={exportar}>
          <JxIcon name="download" size={13} />Exportar Excel
        </button>
      </div>

      {/* Pestañas */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, borderBottom: '1px solid var(--bd)' }}>
        {[{ k: 'inventario', lbl: 'Base de datos', icon: 'list' }, { k: 'movimientos', lbl: 'Movimientos', icon: 'inbox' }].map(t => (
          <button key={t.k} className={`tab-btn ${tab === t.k ? 'tab-active' : ''}`} onClick={() => setTab(t.k)}
            style={{ background: 'none', border: 'none', borderBottom: tab === t.k ? '2px solid var(--amber)' : '2px solid transparent', color: tab === t.k ? 'var(--tp)' : 'var(--tm)', fontWeight: tab === t.k ? 700 : 500, padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5 }}>
            <JxIcon name={t.icon} size={14} />{t.lbl}
          </button>
        ))}
      </div>

      {/* Búsqueda + (movimientos) fechas */}
      <div className="card card-p" style={{ marginBottom: 12, display: 'grid', gridTemplateColumns: tab === 'movimientos' ? 'minmax(220px,2fr) repeat(2, minmax(120px,1fr))' : 'minmax(220px,1fr) auto', gap: 12, alignItems: 'end' }}>
        <div>
          <label className="flabel">Buscar insumo</label>
          <input className="fi" value={q} onChange={e => setQ(e.target.value)} placeholder={tab === 'inventario' ? 'Nombre o código…' : 'Nombre del insumo…'} />
        </div>
        {tab === 'movimientos' ? (
          <>
            <div><label className="flabel">Desde</label><input className="fi" type="date" value={desde} onChange={e => setDesde(e.target.value)} /></div>
            <div><label className="flabel">Hasta</label><input className="fi" type="date" value={hasta} onChange={e => setHasta(e.target.value)} /></div>
          </>
        ) : (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ts)', cursor: 'pointer', paddingBottom: 8 }}>
            <input type="checkbox" checked={soloStockBajo} onChange={e => setSoloStockBajo(e.target.checked)} />Solo stock bajo
          </label>
        )}
      </div>

      {/* Chips por tipo de insumo */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <button className={`btn btn-sm ${catFiltro === 'todos' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setCatFiltro('todos')}>Todos ({fmtN(conteoCat.todos)})</button>
        {CATS.map(c => (
          <button key={c.key} className={`btn btn-sm ${catFiltro === c.key ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setCatFiltro(c.key)} disabled={!conteoCat[c.key]}>
            <JxIcon name={c.icon} size={12} color={c.color} /> {c.label} ({fmtN(conteoCat[c.key])})
          </button>
        ))}
      </div>

      {/* Chips por tipo de movimiento (solo pestaña movimientos) */}
      {tab === 'movimientos' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {[{ k: 'todos', lbl: 'Todos' }, { k: 'entrada', lbl: 'Entradas' }, { k: 'salida', lbl: 'Salidas' }, { k: 'devolucion', lbl: 'Devoluciones' }, { k: 'otros', lbl: 'Otros' }].map(d => (
            <button key={d.k} className={`btn btn-sm ${dirFiltro === d.k ? 'btn-blue' : 'btn-ghost'}`} onClick={() => setDirFiltro(d.k)}>{d.lbl}</button>
          ))}
        </div>
      )}

      {/* KPIs */}
      {tab === 'inventario' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px,1fr))', gap: 12, marginBottom: 16 }}>
          <div className="kpi-card"><div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Insumos</div><div className="kpi-val" style={{ fontSize: 24 }}>{loading ? '…' : fmtN(invKpis.total)}</div></div>
          <div className="kpi-card"><div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Stock bajo</div><div className="kpi-val" style={{ fontSize: 24, color: invKpis.bajo ? 'var(--red)' : 'var(--tp)' }}>{loading ? '…' : fmtN(invKpis.bajo)}</div><div style={{ fontSize: 11, color: 'var(--tm)' }}>≤ mínimo</div></div>
          {CATS.map(c => (
            <div key={c.key} className="kpi-card"><div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--tm)' }}><JxIcon name={c.icon} size={13} color={c.color} />{c.label}</div><div className="kpi-val" style={{ fontSize: 22, color: c.color }}>{loading ? '…' : fmtN(invKpis.porCat[c.key])}</div></div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px,1fr))', gap: 12, marginBottom: 16 }}>
          <div className="kpi-card"><div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Movimientos</div><div className="kpi-val" style={{ fontSize: 24 }}>{loading ? '…' : fmtN(movKpis.total)}</div></div>
          <div className="kpi-card"><div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Entradas</div><div className="kpi-val" style={{ fontSize: 22, color: 'var(--green)' }}>{loading ? '…' : fmtN(movKpis.entrada)}</div></div>
          <div className="kpi-card"><div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Salidas</div><div className="kpi-val" style={{ fontSize: 22, color: 'var(--orange)' }}>{loading ? '…' : fmtN(movKpis.salida)}</div></div>
          <div className="kpi-card"><div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Devoluciones</div><div className="kpi-val" style={{ fontSize: 22, color: 'var(--blue)' }}>{loading ? '…' : fmtN(movKpis.devol)}</div></div>
        </div>
      )}

      {/* Tabla */}
      {loading ? (
        <div className="card card-p empty-state"><JxIcon name="layers" size={32} color="var(--tm)" /><p>Cargando…</p></div>
      ) : tab === 'inventario' ? (
        invFiltrado.length === 0 ? (
          <div className="card card-p empty-state"><JxIcon name="package" size={40} color="var(--tm)" /><p>No hay insumos con estos filtros.</p></div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th style={{ width: 120 }}>Tipo</th>
                  <th>Insumo</th>
                  <th style={{ width: 120 }}>Código</th>
                  <th style={{ width: 70 }}>Unidad</th>
                  <th style={{ textAlign: 'right', width: 100 }}>Stock</th>
                  <th style={{ textAlign: 'right', width: 90 }}>Mínimo</th>
                </tr></thead>
                <tbody>
                  {invMostradas.map(r => {
                    const c = CAT_BY_KEY[r.cat]; const bajo = r.stockMin > 0 && r.stock <= r.stockMin;
                    return (
                      <tr key={r.cat + r.id}>
                        <td><span className="badge b-gray" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><JxIcon name={c.icon} size={11} color={c.color} />{c.label}</span></td>
                        <td className="col-p">{r.nombre}</td>
                        <td style={{ fontSize: 11.5, color: 'var(--tm)' }}>{r.codigo || '—'}</td>
                        <td style={{ fontSize: 12 }}>{r.unidad || '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: bajo ? 'var(--red)' : 'var(--tp)' }}>{fmtN(r.stock)}</td>
                        <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--tm)' }}>{r.stockMin ? fmtN(r.stockMin) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {invFiltrado.length > TOPE_RENDER && <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--tm)', borderTop: '1px solid var(--bd)' }}>Mostrando los primeros {TOPE_RENDER} de {fmtN(invFiltrado.length)} — refiná los filtros o exportá a Excel para ver todo.</div>}
          </div>
        )
      ) : (
        movFiltrado.length === 0 ? (
          <div className="card card-p empty-state"><JxIcon name="inbox" size={40} color="var(--tm)" /><p>No hay movimientos con estos filtros.</p></div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th style={{ width: 92 }}>Fecha</th>
                  <th style={{ width: 116 }}>Tipo</th>
                  <th>Insumo</th>
                  <th style={{ width: 110 }}>Movimiento</th>
                  <th style={{ textAlign: 'right', width: 96 }}>Cantidad</th>
                  <th style={{ width: 150 }}>Frente</th>
                  <th>Destino / Obs.</th>
                </tr></thead>
                <tbody>
                  {movMostrados.map(m => {
                    const c = CAT_BY_KEY[m.cat]; const dm = DIR_META[m.dir] || DIR_META.otro;
                    const dest = nombreDestino(m); const detalle = [dest, m.obs].filter(Boolean).join(' · ');
                    return (
                      <tr key={m.cat + m.id}>
                        <td className="col-m" style={{ fontSize: 11 }}>{m.fecha || '—'}</td>
                        <td><span className="badge b-gray" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><JxIcon name={c.icon} size={11} color={c.color} />{c.label}</span></td>
                        <td className="col-p">{m.insumoNombre}</td>
                        <td><span className={`badge ${dm.cls}`}>{dm.lbl}</span></td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtN(m.cantidad)} {m.unidad}</td>
                        <td style={{ fontSize: 12 }}>{m.frenteId ? (frenteById.get(m.frenteId) || '—') : <span style={{ color: 'var(--tm)' }}>—</span>}</td>
                        <td style={{ fontSize: 11.5, color: 'var(--tm)' }}>{detalle || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {movFiltrado.length > TOPE_RENDER && <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--tm)', borderTop: '1px solid var(--bd)' }}>Mostrando los primeros {TOPE_RENDER} de {fmtN(movFiltrado.length)} — refiná los filtros o exportá a Excel para ver todo.</div>}
          </div>
        )
      )}
    </div>
  );
}

Object.assign(window, { MovimientosInsumosPage });
