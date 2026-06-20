// ═══════════════════════════════════════════════════════════════════
// JARVEX — "Mi Frente": el hub scopeado del INGENIERO (O1 + O2 + O3).
// O1 dashboard (resumen, partidas, salidas), O2 reporte diario de avance
// (descripción + metrado + % + foto), O3 plan-vs-real + rollup mensual.
// Scopeado por frentesDeUsuario (F2) + partidasDeFrente (F1) + frente_id en
// movimientos (mig 083). Es el home del rol ingeniero.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { frentesDeUsuario, partidasDeFrente } from "../lib/frente-partidas.js";
import { resumenFrente, planVsReal, rollupMensual } from "../lib/mi-frente.js";

const { useState: uS, useMemo: uM } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const hoyISO = () => new Date().toISOString().slice(0, 10);
const num = (x) => Number(x || 0).toLocaleString('es-PE');

function MiFrentePage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const userId = auth?.profile?.id || null;
  const obraHook = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const obraId = obraHook?.obraId || null;

  const { data: frentes } = window.__hooks.useFrentesObra(obraId, { soloActivas: true });
  const { data: frentePartidas } = window.__hooks.useFrentePartidas(obraId);
  const partidasHook = window.__hooks.usePartidas(obraId);
  const { data: partidas } = partidasHook;
  const { data: movs } = window.__hooks.useMovimientosMateriales(obraId);
  const { data: materiales } = window.__hooks.useMateriales(obraId);
  const { data: personal } = window.__hooks.usePersonal(obraId);
  const materialesById = uM(() => { const m = new Map(); (materiales || []).forEach(x => m.set(x.id, x)); return m; }, [materiales]);
  const personalById = uM(() => { const m = new Map(); (personal || []).forEach(x => m.set(x.id, x)); return m; }, [personal]);
  const avanceHook = window.__hooks.useAvanceObra(obraId);
  const { data: avances } = avanceHook;
  const metasHook = window.__hooks.useAvanceMetas(obraId);
  const { data: metas } = metasHook;

  const misFrentes = uM(() => frentesDeUsuario(userId, { frentes: frentes || [] }), [userId, frentes]);
  const [frenteSelId, setFrenteSelId] = uS(null);
  const frenteActivo = uM(() => misFrentes.find(f => f.id === frenteSelId) || misFrentes[0] || null, [misFrentes, frenteSelId]);
  const partidasDelFrente = uM(() => frenteActivo
    ? partidasDeFrente(frenteActivo.id, { frentePartidas: frentePartidas || [], partidas: partidas || [] })
    : [], [frenteActivo, frentePartidas, partidas]);

  const resumen = uM(() => frenteActivo
    ? resumenFrente({ partidasDelFrente, movimientos: movs || [], avances: avances || [], frenteId: frenteActivo.id })
    : { nPartidas: 0, avancePromedio: 0, nSalidas: 0, metradoReal: 0 }, [frenteActivo, partidasDelFrente, movs, avances]);

  const salidasDelFrente = uM(() => frenteActivo
    ? (movs || []).filter(m => !m.deleted_at && m.tipo_movimiento === 'salida' && m.frente_id === frenteActivo.id)
        .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
    : [], [frenteActivo, movs]);

  const [tab, setTab] = uS('resumen');

  // ── O2: formulario de reporte diario ──────────────────────────────
  const [rep, setRep] = uS({ partida_id: '', descripcion: '', metrado: '', pct: '' });
  const [repFoto, setRepFoto] = uS(null);
  const [busyRep, setBusyRep] = uS(false);
  const guardarReporte = async () => {
    if (!frenteActivo) return;
    if (!rep.partida_id) { showToast('Elegí una partida', 'red'); return; }
    setBusyRep(true);
    try {
      const id = window.__newId();
      await avanceHook.create({
        id, obra_id: obraId, partida_id: rep.partida_id, frente_id: frenteActivo.id,
        fecha: hoyISO(),
        porcentaje_avance_reportado: rep.pct !== '' ? Number(rep.pct) : null,
        metrado_ejecutado: rep.metrado !== '' ? Number(rep.metrado) : null,
        descripcion: rep.descripcion || null,
        responsable_id: userId,
      });
      // Reflejar el % en la partida (lo que ve el dashboard / control de consumo).
      if (rep.pct !== '' && partidasHook.update) {
        try { await partidasHook.update(rep.partida_id, { porcentaje_avance: Number(rep.pct) }); } catch {}
      }
      // Foto opcional (evidencia foto_avance vinculada al avance).
      if (repFoto) {
        try {
          await window.__saveEvidenciaLocal({
            id: window.__newId(), obra_id: obraId, tipo_evidencia: 'foto_avance',
            modulo_relacionado: 'avance_obra', registro_relacionado_id: id,
            nombre_archivo: repFoto.name, mime_type: repFoto.type || 'image/jpeg', blob: repFoto,
            fecha: hoyISO(), created_by: userId, observaciones: 'Foto de avance diario',
          });
        } catch (e) { console.warn('[mi-frente foto]', e?.message); }
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'avance_obra' } })); } catch {}
      showToast('Avance reportado', 'green');
      setRep({ partida_id: '', descripcion: '', metrado: '', pct: '' }); setRepFoto(null);
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setBusyRep(false); }
  };

  // ── O3: fijar meta de metrado ─────────────────────────────────────
  const [meta, setMeta] = uS({ partida_id: '', fecha: hoyISO(), meta_metrado: '', meta_descripcion: '' });
  const guardarMeta = async () => {
    if (!frenteActivo) return;
    if (!meta.partida_id || !meta.fecha) { showToast('Partida y fecha requeridas', 'red'); return; }
    try {
      await metasHook.create({
        id: window.__newId(), obra_id: obraId, frente_id: frenteActivo.id,
        partida_id: meta.partida_id, fecha: meta.fecha,
        meta_metrado: meta.meta_metrado !== '' ? Number(meta.meta_metrado) : null,
        meta_descripcion: meta.meta_descripcion || null, created_by: userId,
      });
      showToast('Meta guardada', 'green');
      setMeta({ partida_id: '', fecha: hoyISO(), meta_metrado: '', meta_descripcion: '' });
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };
  const [mes, setMes] = uS(hoyISO().slice(0, 7));
  const planFila = uM(() => planVsReal({ partidasDelFrente, metas: metas || [], avances: avances || [] }), [partidasDelFrente, metas, avances]);
  const rollup = uM(() => rollupMensual({ partidasDelFrente, avances: avances || [], mes }), [partidasDelFrente, avances, mes]);

  const nombrePart = (p) => `${p.codigo_delfin ? p.codigo_delfin + ' · ' : ''}${p.nombre_partida || '—'}`;

  if (!obraId) return <div className="page-wrap"><div className="card card-p empty-state"><p>Seleccioná una obra activa.</p></div></div>;
  if (misFrentes.length === 0) {
    return (
      <div className="page-wrap">
        <div className="card card-p empty-state" style={{ textAlign: 'center' }}>
          <JxIcon name="flag" size={36} color="var(--tm)" />
          <p style={{ marginTop: 8 }}><strong>Todavía no tenés un frente asignado.</strong></p>
          <p style={{ color: 'var(--tm)', fontSize: 13 }}>Pedile al administrador que te asigne uno en <em>Frentes de Trabajo</em>.</p>
        </div>
      </div>
    );
  }

  const TABS = [
    ['resumen', 'Resumen'], ['partidas', 'Mis Partidas'], ['salidas', 'Salidas a mi frente'],
    ['reporte', 'Reporte diario'], ['plan', 'Plan vs Real'],
  ];

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="pg-title">Mi Frente</div>
          <div className="pg-sub">{frenteActivo?.nombre || '—'} · {resumen.nPartidas} partidas · {Math.round(resumen.avancePromedio)}% avance prom.</div>
        </div>
        {misFrentes.length > 1 && (
          <select className="fi" style={{ maxWidth: 220 }} value={frenteActivo?.id || ''} onChange={e => setFrenteSelId(e.target.value)}>
            {misFrentes.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
          </select>
        )}
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', margin: '8px 0 12px' }}>
        {TABS.map(([k, lbl]) => (
          <button key={k} className={`btn btn-xs ${tab === k ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab(k)}>{lbl}</button>
        ))}
      </div>

      {tab === 'resumen' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
          {[['Partidas', resumen.nPartidas], ['Avance prom.', Math.round(resumen.avancePromedio) + '%'],
            ['Salidas a mi frente', resumen.nSalidas], ['Metrado real acum.', num(resumen.metradoReal)]].map(([t, v]) => (
            <div key={t} className="card card-p"><div style={{ fontSize: 11.5, color: 'var(--tm)' }}>{t}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{v}</div></div>
          ))}
        </div>
      )}

      {tab === 'partidas' && (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead><tr><th>Partida</th><th style={{ textAlign: 'right' }}>% Avance</th><th></th></tr></thead>
            <tbody>
              {partidasDelFrente.map(p => (
                <tr key={p.id}>
                  <td>{nombrePart(p)}</td>
                  <td style={{ textAlign: 'right' }}>{Number(p.porcentaje_avance) || 0}%</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-ghost btn-xs" onClick={() => { setRep({ ...rep, partida_id: p.id }); setTab('reporte'); }}>Reportar avance</button>
                  </td>
                </tr>
              ))}
              {partidasDelFrente.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Tu frente no tiene partidas asignadas todavía.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'salidas' && (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead><tr><th>Fecha</th><th>Material</th><th style={{ textAlign: 'right' }}>Cantidad</th><th>Responsable</th></tr></thead>
            <tbody>
              {salidasDelFrente.map(m => (
                <tr key={m.id}><td>{m.fecha || '—'}</td><td>{materialesById.get(m.material_id)?.nombre_material || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{num(m.cantidad)} {m.unidad || ''}</td><td>{(() => { const p = personalById.get(m.responsable_id); return p ? `${p.nombres} ${p.apellidos || ''}`.trim() : '—'; })()}</td></tr>
              ))}
              {salidasDelFrente.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>No hay salidas de almacén vinculadas a tu frente.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'reporte' && (
        <div className="card card-p" style={{ maxWidth: 560 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Reporte de avance · {hoyISO()}</div>
          <label className="flabel">Partida *</label>
          <select className="fi" value={rep.partida_id} onChange={e => setRep({ ...rep, partida_id: e.target.value })}>
            <option value="">— Elegí —</option>
            {partidasDelFrente.map(p => <option key={p.id} value={p.id}>{nombrePart(p)}</option>)}
          </select>
          <label className="flabel" style={{ marginTop: 8 }}>Descripción del avance</label>
          <textarea className="fi" rows={3} value={rep.descripcion} onChange={e => setRep({ ...rep, descripcion: e.target.value })} placeholder="Qué se avanzó hoy…" />
          <div className="g2" style={{ marginTop: 8 }}>
            <div><label className="flabel">Metrado avanzado</label><input className="fi" type="number" step="0.01" value={rep.metrado} onChange={e => setRep({ ...rep, metrado: e.target.value })} /></div>
            <div><label className="flabel">% Avance acumulado</label><input className="fi" type="number" step="0.1" min="0" max="100" value={rep.pct} onChange={e => setRep({ ...rep, pct: e.target.value })} /></div>
          </div>
          <label className="flabel" style={{ marginTop: 8 }}>Foto (opcional)</label>
          <input className="fi" type="file" accept="image/*" onChange={e => setRepFoto(e.target.files?.[0] || null)} />
          <div className="modal-actions" style={{ marginTop: 12 }}>
            <button className="btn btn-amber" disabled={busyRep} onClick={guardarReporte}><JxIcon name="check" size={13} />Guardar avance</button>
          </div>
        </div>
      )}

      {tab === 'plan' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="card card-p" style={{ maxWidth: 560 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Fijar meta de metrado</div>
            <div className="g2">
              <div><label className="flabel">Partida *</label>
                <select className="fi" value={meta.partida_id} onChange={e => setMeta({ ...meta, partida_id: e.target.value })}>
                  <option value="">— Elegí —</option>
                  {partidasDelFrente.map(p => <option key={p.id} value={p.id}>{nombrePart(p)}</option>)}
                </select></div>
              <div><label className="flabel">Fecha *</label><input className="fi" type="date" value={meta.fecha} onChange={e => setMeta({ ...meta, fecha: e.target.value })} /></div>
              <div><label className="flabel">Meta de metrado</label><input className="fi" type="number" step="0.01" value={meta.meta_metrado} onChange={e => setMeta({ ...meta, meta_metrado: e.target.value })} /></div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}><button className="btn btn-amber btn-sm" onClick={guardarMeta}>Guardar meta</button></div>
            </div>
          </div>

          <div className="card" style={{ overflow: 'auto' }}>
            <div style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600 }}>Plan vs Real (acumulado)</div>
            <table className="tbl" style={{ fontSize: 12 }}>
              <thead><tr><th>Partida</th><th style={{ textAlign: 'right' }}>Meta</th><th style={{ textAlign: 'right' }}>Real</th><th style={{ textAlign: 'right' }}>Desvío</th></tr></thead>
              <tbody>
                {planFila.map(f => (
                  <tr key={f.partida.id}><td>{nombrePart(f.partida)}</td>
                    <td style={{ textAlign: 'right' }}>{num(f.metaMetrado)}</td>
                    <td style={{ textAlign: 'right' }}>{num(f.realMetrado)}</td>
                    <td style={{ textAlign: 'right', color: f.desvio < 0 ? 'var(--red)' : 'var(--green)' }}>{f.desvio >= 0 ? '+' : ''}{num(f.desvio)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ overflow: 'auto' }}>
            <div style={{ padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>Rollup mensual (metrado real → referencia valorización)</span>
              <input className="fi" type="month" style={{ maxWidth: 160 }} value={mes} onChange={e => setMes(e.target.value)} />
            </div>
            <table className="tbl" style={{ fontSize: 12 }}>
              <thead><tr><th>Partida</th><th style={{ textAlign: 'right' }}>Metrado del mes</th></tr></thead>
              <tbody>
                {rollup.map(r => (
                  <tr key={r.partida.id}><td>{nombrePart(r.partida)}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{num(r.metradoMes)}</td></tr>
                ))}
                {rollup.length === 0 && <tr><td colSpan={2} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Sin avances reportados este mes.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { MiFrentePage });
