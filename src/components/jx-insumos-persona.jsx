// ═══════════════════════════════════════════════════════════════════
// JARVEX — Insumos por Persona / Subcontrato
//
// Consolidado de TODO lo que se le entregó a un trabajador o subcontrato
// a lo largo de la obra (o de la obra en general): EPPs, materiales,
// herramientas, insumos de emergencia y maquinaria. Una ENTREGA es un
// movimiento de SALIDA atribuido a una persona/subcontrato (no las patas
// de traspaso entre almacenes). El foco principal son los EPPs.
//
// Lee las 5 tablas de movimientos. OJO con la inconsistencia del modelo:
// EPP guarda la persona en `personal_id`, las otras 4 en `responsable_id`;
// el subcontrato siempre en `subcontratista_id`.
// ═══════════════════════════════════════════════════════════════════

import React from "react";
import { SearchableSelect } from "./jx-searchable-select.jsx";
import { opcionesDestinoFlat } from "../lib/destino-mov.js";

const { useState: uS, useMemo: uM, useEffect: uE } = React;
const fmtN = (n) => Number(n || 0).toLocaleString('es-PE');

const CATS = [
  { key: 'epp',         label: 'EPPs',         icon: 'shield',  color: 'var(--green)',  mov: 'movimientos_epp',                fk: 'epp_id',               cat: 'epps',               nombreCol: 'nombre_epp',         personaCol: 'personal_id',    porObra: true  },
  { key: 'material',    label: 'Materiales',   icon: 'package', color: 'var(--blue)',   mov: 'movimientos_materiales',         fk: 'material_id',          cat: 'materiales',         nombreCol: 'nombre_material',    personaCol: 'responsable_id', porObra: true  },
  { key: 'herramienta', label: 'Herramientas', icon: 'tool',    color: 'var(--amber)',  mov: 'movimientos_herramientas',       fk: 'herramienta_id',       cat: 'herramientas',       nombreCol: 'nombre_herramienta', personaCol: 'responsable_id', porObra: true  },
  { key: 'emergencia',  label: 'Emergencia',   icon: 'alert',   color: 'var(--red)',    mov: 'movimientos_insumos_emergencia', fk: 'insumo_emergencia_id', cat: 'insumos_emergencia', nombreCol: 'nombre',             personaCol: 'responsable_id', porObra: true  },
  { key: 'maquinaria',  label: 'Maquinaria',   icon: 'truck',   color: 'var(--orange)', mov: 'movimientos_maquinaria',         fk: 'activo_id',            cat: 'activos_pesados',    nombreCol: 'nombre',             personaCol: 'responsable_id', porObra: false }, // activos_pesados no indexa obra_id
];
const CAT_BY_KEY = Object.fromEntries(CATS.map(c => [c.key, c]));

function InsumosPorPersonaPage({ showToast }) {
  const { obraId } = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const { data: personal } = window.__hooks.usePersonal(obraId);
  const { data: subcontratistas } = window.__hooks.useSubcontratistas();

  const [sel, setSel] = uS('');         // '' = toda la obra · '<id>' persona · 'sub:<id>' subcontrato
  const [desde, setDesde] = uS('');
  const [hasta, setHasta] = uS('');
  const [catFiltro, setCatFiltro] = uS('todos');
  const [entregas, setEntregas] = uS([]); // todas las entregas de la obra (unificadas)
  const [loading, setLoading] = uS(true);

  // ── Carga unificada de las 5 tablas de movimientos (entregas) ──
  uE(() => {
    if (!obraId) { setEntregas([]); setLoading(false); return; }
    let cancel = false;
    const cargar = async () => {
      const db = window.__db;
      try {
        // Catálogos: id → { nombre, unidad } por categoría.
        const nombreById = {};
        for (const c of CATS) {
          nombreById[c.key] = new Map();
          const rows = c.porObra
            ? await db[c.cat].where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray()
            : await db[c.cat].filter(r => !r.deleted_at && (r.obra_actual_id === obraId || r.obra_id === obraId)).toArray();
          for (const r of rows) nombreById[c.key].set(r.id, { nombre: r[c.nombreCol] || '—', unidad: r.unidad || '' });
        }
        const out = [];
        for (const c of CATS) {
          await db[c.mov].where('obra_id').equals(obraId).each(mv => {
            if (mv.deleted_at || mv.reverses_id || mv.reversed_by_id) return;
            if (mv.tipo_movimiento !== 'salida') return;              // solo ENTREGAS (no ingreso/devolución/reverso)
            if (/Traspaso [→←]/.test(String(mv.observaciones || ''))) return; // patas de traspaso → no son entregas
            const personaId = mv[c.personaCol] || null;
            const subId = mv.subcontratista_id || null;
            if (!personaId && !subId) return;                        // sin atribución → consumo/almacén, no entrega a alguien
            const info = nombreById[c.key].get(mv[c.fk]) || { nombre: '—', unidad: '' };
            // Maquinaria se asigna por unidad y guarda cantidad null → contamos 1 máquina
            // por asignación (si no, KPIs y tablas mostrarían 0).
            const cantidad = c.key === 'maquinaria'
              ? (Number(mv.cantidad) || 1)
              : (Number(mv.cantidad) || 0);
            out.push({
              id: mv.id, cat: c.key, fecha: (mv.fecha || '').slice(0, 10),
              insumoNombre: info.nombre, unidad: mv.unidad || info.unidad || (c.key === 'maquinaria' ? 'und' : ''),
              cantidad,
              personaId, subId, destinoTipo: subId ? 'subcontratista' : 'personal',
              motivo: mv.motivo || null, obs: mv.observaciones || null,
            });
          });
        }
        if (!cancel) { setEntregas(out); setLoading(false); }
      } catch { if (!cancel) { setEntregas([]); setLoading(false); } }
    };
    setLoading(true); cargar();
    // Debounce: en sync/realtime cada fila dispara jx_data_changed Y
    // jarvex_master_updated (useRealtimeNotifications). Sin coalescer, un lote
    // de N movimientos provocaría hasta 2·N re-escaneos completos de las 5
    // tablas (riesgo a 50k movs). Agrupamos las ráfagas en un solo cargar().
    let debId = null;
    const onData = () => { clearTimeout(debId); debId = setTimeout(() => { if (!cancel) cargar(); }, 400); };
    window.addEventListener('jx_data_changed', onData);
    window.addEventListener('jarvex_master_updated', onData);
    return () => { cancel = true; clearTimeout(debId); window.removeEventListener('jx_data_changed', onData); window.removeEventListener('jarvex_master_updated', onData); };
  }, [obraId]);

  const personalById = uM(() => { const m = new Map(); (personal || []).forEach(p => m.set(p.id, p)); return m; }, [personal]);
  const subById = uM(() => { const m = new Map(); (subcontratistas || []).forEach(s => m.set(s.id, s)); return m; }, [subcontratistas]);
  const nombreDestino = (e) => {
    if (e.subId) return (subById.get(e.subId)?.razon_social || 'Subcontrato') + ' (subcontrato)';
    const p = personalById.get(e.personaId);
    return p ? `${p.nombres || ''} ${p.apellidos || ''}`.trim() : '(persona no encontrada)';
  };

  const opciones = uM(() => [{ value: '', label: '🏢 Toda la obra' }, ...opcionesDestinoFlat((personal || []), subcontratistas || [])], [personal, subcontratistas]);

  const filtradas = uM(() => entregas.filter(e => {
    if (catFiltro !== 'todos' && e.cat !== catFiltro) return false;
    if (desde && e.fecha && e.fecha < desde) return false;
    if (hasta && e.fecha && e.fecha > hasta) return false;
    if (!sel) return true;
    if (sel.startsWith('sub:')) return e.subId === sel.slice(4);
    return e.personaId === sel;
  }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))), [entregas, sel, desde, hasta, catFiltro]);

  const kpis = uM(() => {
    const porCat = {}; for (const c of CATS) porCat[c.key] = { count: 0, unidades: 0 };
    for (const e of filtradas) { porCat[e.cat].count++; porCat[e.cat].unidades += e.cantidad; }
    return { total: filtradas.length, porCat };
  }, [filtradas]);

  const mostrarDestino = sel === '' || sel.startsWith('sub:'); // columna "Entregado a"
  const tituloSel = sel === '' ? 'Toda la obra' : (sel.startsWith('sub:') ? (subById.get(sel.slice(4))?.razon_social || 'Subcontrato') : (() => { const p = personalById.get(sel); return p ? `${p.nombres || ''} ${p.apellidos || ''}`.trim() : 'Persona'; })());

  const exportar = async () => {
    if (!filtradas.length) { showToast?.('No hay entregas para exportar con estos filtros', 'amber'); return; }
    try {
      const XLSX = await import('xlsx');
      const headers = ['Fecha', 'Categoría', 'Insumo', 'Cantidad', 'Unidad', 'Entregado a', 'Tipo', 'Motivo', 'Observaciones'];
      const rows = filtradas.map(e => [
        e.fecha || '', CAT_BY_KEY[e.cat]?.label || e.cat, e.insumoNombre, e.cantidad, e.unidad,
        nombreDestino(e), e.destinoTipo === 'subcontratista' ? 'Subcontrato' : 'Personal', e.motivo || '', e.obs || '',
      ]);
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      XLSX.utils.book_append_sheet(wb, ws, 'Entregas');
      const safe = String(tituloSel).replace(/[^a-z0-9]+/gi, '_').slice(0, 24);
      XLSX.writeFile(wb, `entregas_${safe || 'obra'}.xlsx`);
      showToast?.(`${rows.length} entregas exportadas`, 'green');
    } catch (e) { showToast?.('Error al exportar: ' + (e.message || e), 'red'); }
  };

  if (!obraId) {
    return <div className="page-wrap"><div className="card card-p empty-state"><JxIcon name="users" size={32} color="var(--tm)" /><p>Seleccioná una obra activa para ver las entregas por persona.</p></div></div>;
  }

  const catsConDatos = CATS.filter(c => (catFiltro === 'todos' || catFiltro === c.key) && filtradas.some(e => e.cat === c.key));

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Insumos por Persona</div>
          <div className="pg-sub">Todo lo entregado a un trabajador o subcontrato en la obra — EPPs, materiales, herramientas, emergencia y maquinaria</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={exportar} disabled={!filtradas.length}>
          <JxIcon name="download" size={13} />Exportar Excel
        </button>
      </div>

      {/* Filtros */}
      <div className="card card-p" style={{ marginBottom: 14, display: 'grid', gridTemplateColumns: 'minmax(240px,1.6fr) repeat(2, minmax(120px,1fr))', gap: 12, alignItems: 'end' }}>
        <div>
          <label className="flabel">Persona o subcontrato</label>
          <SearchableSelect value={sel} onChange={setSel} options={opciones} placeholder="— Elegí persona/subcontrato o toda la obra —" />
        </div>
        <div><label className="flabel">Desde</label><input className="fi" type="date" value={desde} onChange={e => setDesde(e.target.value)} /></div>
        <div><label className="flabel">Hasta</label><input className="fi" type="date" value={hasta} onChange={e => setHasta(e.target.value)} /></div>
      </div>

      {/* Filtro por categoría (chips) */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <button className={`btn btn-sm ${catFiltro === 'todos' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setCatFiltro('todos')}>Todos ({entregas.filter(e => filtraSinCat(e, sel, desde, hasta)).length})</button>
        {CATS.map(c => {
          const n = entregas.filter(e => e.cat === c.key && filtraSinCat(e, sel, desde, hasta)).length;
          return <button key={c.key} className={`btn btn-sm ${catFiltro === c.key ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setCatFiltro(c.key)} disabled={!n}><JxIcon name={c.icon} size={12} color={c.color} /> {c.label} ({n})</button>;
        })}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 12, marginBottom: 18 }}>
        <div className="kpi-card">
          <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Entregas ({tituloSel})</div>
          <div className="kpi-val" style={{ fontSize: 24 }}>{loading ? '…' : fmtN(kpis.total)}</div>
          <div style={{ fontSize: 11, color: 'var(--tm)' }}>movimientos de salida</div>
        </div>
        {CATS.map(c => {
          const k = kpis.porCat[c.key];
          return (
            <div key={c.key} className="kpi-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--tm)' }}><JxIcon name={c.icon} size={13} color={c.color} />{c.label}</div>
              <div className="kpi-val" style={{ fontSize: 22, color: c.color }}>{loading ? '…' : fmtN(k.unidades)}</div>
              <div style={{ fontSize: 11, color: 'var(--tm)' }}>{loading ? '' : `${fmtN(k.count)} entrega${k.count === 1 ? '' : 's'}`}</div>
            </div>
          );
        })}
      </div>

      {/* Tablas por categoría (EPP primero) */}
      {loading ? (
        <div className="card card-p empty-state"><JxIcon name="users" size={32} color="var(--tm)" /><p>Cargando entregas…</p></div>
      ) : filtradas.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="shield" size={40} color="var(--tm)" />
          <p>No hay entregas registradas con estos filtros.{sel ? '' : ' Elegí una persona/subcontrato o ajustá las fechas.'}</p>
        </div>
      ) : catsConDatos.map(c => {
        const rows = filtradas.filter(e => e.cat === c.key);
        return (
          <div key={c.key} style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <JxIcon name={c.icon} size={16} color={c.color} />
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--tp)' }}>{c.label}</span>
              <span className="badge b-gray">{rows.length} entrega{rows.length === 1 ? '' : 's'} · {fmtN(rows.reduce((s, e) => s + e.cantidad, 0))} unid.</span>
            </div>
            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead><tr>
                    <th style={{ width: 96 }}>Fecha</th>
                    <th>Insumo</th>
                    <th style={{ textAlign: 'right', width: 90 }}>Cantidad</th>
                    {mostrarDestino && <th>Entregado a</th>}
                    <th>Motivo / Obs.</th>
                  </tr></thead>
                  <tbody>
                    {rows.map(e => (
                      <tr key={e.id}>
                        <td className="col-m" style={{ fontSize: 11 }}>{e.fecha || '—'}</td>
                        <td className="col-p">{e.insumoNombre}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtN(e.cantidad)} {e.unidad}</td>
                        {mostrarDestino && <td style={{ fontSize: 12 }}>{nombreDestino(e)}</td>}
                        <td style={{ fontSize: 11.5, color: 'var(--tm)' }}>{[e.motivo && e.motivo !== 'dotacion' ? e.motivo : (e.cat === 'epp' ? 'Dotación' : ''), e.obs].filter(Boolean).join(' · ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Filtro auxiliar para los conteos de los chips (todo menos la categoría).
function filtraSinCat(e, sel, desde, hasta) {
  if (desde && e.fecha && e.fecha < desde) return false;
  if (hasta && e.fecha && e.fecha > hasta) return false;
  if (!sel) return true;
  if (sel.startsWith('sub:')) return e.subId === sel.slice(4);
  return e.personaId === sel;
}

Object.assign(window, { InsumosPorPersonaPage });
