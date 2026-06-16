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
// "Capítulo" = primer segmento del código Delphin (ej. 02.04.07 → 02).
const capDeCodigo = (cod) => { const s = String(cod || '').trim(); return s ? s.split('.')[0] : '—'; };

function ControlConsumoPage({ showToast }) {
  const obraHook = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const obraId = obraHook?.obraId || null;
  const [partidas, setPartidas] = uS([]);
  const [insumos, setInsumos] = uS([]);
  const [loading, setLoading] = uS(true);
  const [abiertas, setAbiertas] = uS(() => new Set());
  const [busqueda, setBusqueda] = uS('');
  const [filtroEstado, setFiltroEstado] = uS('todos');
  const [filtroCap, setFiltroCap] = uS('todos');

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
  const capitulos = uM(() => Array.from(new Set(filas.map(f => capDeCodigo(f.partida.codigo_delfin)))).sort(), [filas]);
  const filasFiltradas = uM(() => {
    const q = busqueda.trim().toLowerCase();
    return filas.filter(f => {
      if (filtroEstado !== 'todos' && f.estado !== filtroEstado) return false;
      if (filtroCap !== 'todos' && capDeCodigo(f.partida.codigo_delfin) !== filtroCap) return false;
      if (q) {
        const enPartida = `${f.partida.codigo_delfin || ''} ${f.partida.nombre_partida || ''}`.toLowerCase().includes(q);
        const enInsumo = f.insumos.some(x => String(x.ip.nombre_insumo || '').toLowerCase().includes(q));
        if (!enPartida && !enInsumo) return false;
      }
      return true;
    });
  }, [filas, busqueda, filtroEstado, filtroCap]);

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

      {!loading && filas.length > 0 && (
        <div className="card card-p" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <input className="fi" style={{ maxWidth: 240 }} placeholder="Buscar partida o insumo…" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
          <select className="fi" style={{ maxWidth: 180 }} value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
            <option value="todos">Todos los estados</option>
            <option value="rojo">🔴 Sobreconsumo</option>
            <option value="ambar">🟡 Atención</option>
            <option value="verde">🟢 En línea</option>
          </select>
          <select className="fi" style={{ maxWidth: 170 }} value={filtroCap} onChange={e => setFiltroCap(e.target.value)}>
            <option value="todos">Todos los capítulos</option>
            {capitulos.map(c => <option key={c} value={c}>Capítulo {c}</option>)}
          </select>
          {(busqueda || filtroEstado !== 'todos' || filtroCap !== 'todos') && (
            <button className="btn btn-ghost btn-xs" onClick={() => { setBusqueda(''); setFiltroEstado('todos'); setFiltroCap('todos'); }}>Limpiar</button>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--tm)' }}>{filasFiltradas.length} de {filas.length} partidas</span>
        </div>
      )}

      {loading ? (
        <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)' }}>Cargando…</div>
      ) : filas.length === 0 ? (
        <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)' }}>
          No hay partidas con presupuesto en esta obra todavía.
        </div>
      ) : filasFiltradas.length === 0 ? (
        <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)' }}>
          Ninguna partida coincide con el filtro.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {filasFiltradas.map(f => {
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
