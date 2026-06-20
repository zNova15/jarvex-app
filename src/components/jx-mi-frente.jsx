// ═══════════════════════════════════════════════════════════════════
// JARVEX — INGENIERÍA DE FRENTE: 5 módulos independientes del ingeniero.
// DashboardTecnicoPage · MisPartidasPage · SalidasFrentePage ·
// ReporteDiarioPage · PlanRealPage. Comparten MiFrenteShell (datos + scope por
// frentesDeUsuario/partidasDeFrente). Sin información monetaria (solo metrados
// y cantidades). El semáforo de rendimiento sale de rendimientoPartida.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { frentesDeUsuario, partidasDeFrente } from "../lib/frente-partidas.js";
import { resumenFrente, planVsReal, rollupMensual, rendimientoPartida } from "../lib/mi-frente.js";
import { hijosDirectos, cadenaBreadcrumb } from "../lib/partida-arbol.js";

const { useState: uS, useMemo: uM } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const hoyISO = () => new Date().toISOString().slice(0, 10);
const num = (x) => Number(x || 0).toLocaleString('es-PE');
const SEM = { verde: 'var(--green)', ambar: 'var(--amber)', rojo: 'var(--red)', sin_dato: 'var(--tm)' };
const SEM_LBL = { verde: 'En ritmo', ambar: 'Atención', rojo: 'Atrasado', sin_dato: 's/plan' };

function MiFrenteShell({ showToast, vista }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const userId = auth?.profile?.id || null;
  const obraHook = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const obraId = obraHook?.obraId || null;

  const { data: frentes } = window.__hooks.useFrentesObra(obraId, { soloActivas: true });
  const { data: frentePartidas } = window.__hooks.useFrentePartidas(obraId);
  const partidasHook = window.__hooks.usePartidas(obraId);
  const { data: partidas } = partidasHook;
  const movHook = window.__hooks.useMovimientosMateriales(obraId);
  const { data: movs } = movHook;
  const { data: materiales } = window.__hooks.useMateriales(obraId);
  const { data: personal } = window.__hooks.usePersonal(obraId);
  const avanceHook = window.__hooks.useAvanceObra(obraId);
  const { data: avances } = avanceHook;
  const metasHook = window.__hooks.useAvanceMetas(obraId);
  const { data: metas } = metasHook;

  const materialesById = uM(() => { const m = new Map(); (materiales || []).forEach(x => m.set(x.id, x)); return m; }, [materiales]);
  const personalById = uM(() => { const m = new Map(); (personal || []).forEach(x => m.set(x.id, x)); return m; }, [personal]);

  const misFrentes = uM(() => frentesDeUsuario(userId, { frentes: frentes || [] }), [userId, frentes]);
  const [frenteSelId, setFrenteSelId] = uS(null);
  const frenteActivo = uM(() => misFrentes.find(f => f.id === frenteSelId) || misFrentes[0] || null, [misFrentes, frenteSelId]);
  const partidasDelFrente = uM(() => frenteActivo
    ? partidasDeFrente(frenteActivo.id, { frentePartidas: frentePartidas || [], partidas: partidas || [] })
    : [], [frenteActivo, frentePartidas, partidas]);

  const resumen = uM(() => frenteActivo
    ? resumenFrente({ partidasDelFrente, movimientos: movs || [], avances: avances || [], frenteId: frenteActivo.id })
    : { nPartidas: 0, avancePromedio: 0, nSalidas: 0, metradoReal: 0 }, [frenteActivo, partidasDelFrente, movs, avances]);

  const hoy = hoyISO();
  const rendimientos = uM(() => partidasDelFrente.map(p => ({ p, r: rendimientoPartida(p, avances || [], hoy) })), [partidasDelFrente, avances, hoy]);
  const semConteo = uM(() => rendimientos.reduce((a, x) => { a[x.r.semaforo] = (a[x.r.semaforo] || 0) + 1; return a; }, {}), [rendimientos]);

  const salidasDelFrente = uM(() => frenteActivo
    ? (movs || []).filter(m => !m.deleted_at && m.tipo_movimiento === 'salida' && m.frente_id === frenteActivo.id)
        .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
    : [], [frenteActivo, movs]);

  const nombrePart = (p) => `${p.codigo_delfin ? p.codigo_delfin + ' · ' : ''}${p.nombre_partida || '—'}`;
  const partById = uM(() => { const m = new Map(); partidasDelFrente.forEach(p => m.set(p.id, p)); return m; }, [partidasDelFrente]);

  // ── Mis Partidas (jerárquico) ─────────────────────────────────────
  const [foco, setFoco] = uS('');
  const nodos = uM(() => hijosDirectos(partidasDelFrente, foco), [partidasDelFrente, foco]);

  // ── Reporte diario ────────────────────────────────────────────────
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
        id, obra_id: obraId, partida_id: rep.partida_id, frente_id: frenteActivo.id, fecha: hoy,
        porcentaje_avance_reportado: rep.pct !== '' ? Number(rep.pct) : null,
        metrado_ejecutado: rep.metrado !== '' ? Number(rep.metrado) : null,
        descripcion: rep.descripcion || null, responsable_id: userId,
      });
      if (rep.pct !== '' && partidasHook.update) { try { await partidasHook.update(rep.partida_id, { porcentaje_avance: Number(rep.pct) }); } catch {} }
      if (repFoto) {
        try {
          await window.__saveEvidenciaLocal({
            id: window.__newId(), obra_id: obraId, tipo_evidencia: 'foto_avance', modulo_relacionado: 'avance_obra',
            registro_relacionado_id: id, nombre_archivo: repFoto.name, mime_type: repFoto.type || 'image/jpeg',
            blob: repFoto, fecha: hoy, created_by: userId, observaciones: 'Foto de avance diario',
          });
        } catch (e) { console.warn('[mi-frente foto]', e?.message); }
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'avance_obra' } })); } catch {}
      showToast('Avance reportado', 'green');
      setRep({ partida_id: '', descripcion: '', metrado: '', pct: '' }); setRepFoto(null);
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setBusyRep(false); }
  };
  const repRend = uM(() => rep.partida_id && partById.get(rep.partida_id)
    ? rendimientoPartida(partById.get(rep.partida_id), avances || [], hoy) : null, [rep.partida_id, partById, avances, hoy]);

  // ── Plan vs Real ──────────────────────────────────────────────────
  const [meta, setMeta] = uS({ partida_id: '', fecha: hoy, meta_metrado: '', meta_descripcion: '' });
  const guardarMeta = async () => {
    if (!frenteActivo) return;
    if (!meta.partida_id || !meta.fecha) { showToast('Partida y fecha requeridas', 'red'); return; }
    try {
      await metasHook.create({
        id: window.__newId(), obra_id: obraId, frente_id: frenteActivo.id, partida_id: meta.partida_id, fecha: meta.fecha,
        meta_metrado: meta.meta_metrado !== '' ? Number(meta.meta_metrado) : null,
        meta_descripcion: meta.meta_descripcion || null, created_by: userId,
      });
      showToast('Meta guardada', 'green');
      setMeta({ partida_id: '', fecha: hoy, meta_metrado: '', meta_descripcion: '' });
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };
  const [mes, setMes] = uS(hoy.slice(0, 7));
  const planFila = uM(() => planVsReal({ partidasDelFrente, metas: metas || [], avances: avances || [] }), [partidasDelFrente, metas, avances]);
  const rollup = uM(() => rollupMensual({ partidasDelFrente, avances: avances || [], mes }), [partidasDelFrente, avances, mes]);

  // ── Salidas: vincular a partida ───────────────────────────────────
  const [vincSel, setVincSel] = uS({});
  const vincularSalida = async (m) => {
    const pid = vincSel[m.id];
    if (!pid) { showToast('Elegí una partida', 'red'); return; }
    try {
      await movHook.update(m.id, { partida_id: pid });
      try {
        const { aplicarConsumoPartida } = await import('../lib/partida-allocation.js');
        const material = materialesById.get(m.material_id);
        await aplicarConsumoPartida({ mov: { ...m, partida_id: pid }, partida_id: pid, material, userId });
      } catch (e) { console.warn('[vincular salida]', e?.message); }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'movimientos_materiales' } })); } catch {}
      showToast('Salida vinculada a la partida', 'green');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  if (!obraId) return <div className="page-wrap"><div className="card card-p empty-state"><p>Seleccioná una obra activa.</p></div></div>;
  if (misFrentes.length === 0) {
    return (
      <div className="page-wrap"><div className="card card-p empty-state" style={{ textAlign: 'center' }}>
        <JxIcon name="flag" size={36} color="var(--tm)" />
        <p style={{ marginTop: 8 }}><strong>Todavía no tenés un frente asignado.</strong></p>
        <p style={{ color: 'var(--tm)', fontSize: 13 }}>Pedile al administrador que te asigne uno en <em>Frentes de Trabajo</em>.</p>
      </div></div>
    );
  }

  const TITULOS = { dashboard: 'Dashboard Técnico', partidas: 'Mis Partidas', salidas: 'Salidas a mi Frente', reporte: 'Reporte Diario', plan: 'Plan vs Real' };

  const SemBadge = ({ s }) => <span className="badge" style={{ background: SEM[s], color: '#000', fontSize: 9 }}>{SEM_LBL[s]}</span>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="pg-title">{TITULOS[vista]}</div>
          <div className="pg-sub">{frenteActivo?.nombre || '—'} · {resumen.nPartidas} partidas · {Math.round(resumen.avancePromedio)}% avance prom.</div>
        </div>
        {misFrentes.length > 1 && (
          <select className="fi" style={{ maxWidth: 220 }} value={frenteActivo?.id || ''} onChange={e => setFrenteSelId(e.target.value)}>
            {misFrentes.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
          </select>
        )}
      </div>

      {vista === 'dashboard' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
            {[['Partidas', resumen.nPartidas], ['Avance prom.', Math.round(resumen.avancePromedio) + '%'],
              ['Salidas a mi frente', resumen.nSalidas], ['Metrado real acum.', num(resumen.metradoReal)]].map(([t, v]) => (
              <div key={t} className="card card-p"><div style={{ fontSize: 11.5, color: 'var(--tm)' }}>{t}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{v}</div></div>
            ))}
          </div>
          <div className="card card-p">
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Rendimiento (planificado vs real)</div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {['rojo', 'ambar', 'verde', 'sin_dato'].map(s => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: SEM[s], display: 'inline-block' }} />
                  <span style={{ fontSize: 12 }}>{SEM_LBL[s]}: <strong>{semConteo[s] || 0}</strong></span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 6 }}>Atrasado = avance real por debajo de la meta diaria (metrado ÷ días planificados).</div>
          </div>
          <div className="card" style={{ overflow: 'auto' }}>
            <div style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600 }}>Partidas que requieren atención</div>
            <table className="tbl" style={{ fontSize: 12 }}>
              <thead><tr><th>Partida</th><th style={{ textAlign: 'right' }}>% Avance</th><th style={{ textAlign: 'right' }}>Meta/día</th><th style={{ textAlign: 'right' }}>Real acum.</th><th>Estado</th></tr></thead>
              <tbody>
                {rendimientos.filter(x => x.r.semaforo === 'rojo' || x.r.semaforo === 'ambar').slice(0, 12).map(({ p, r }) => (
                  <tr key={p.id}><td>{nombrePart(p)}</td><td style={{ textAlign: 'right' }}>{Number(p.porcentaje_avance) || 0}%</td>
                    <td style={{ textAlign: 'right' }}>{num(r.metaDiaria)}</td><td style={{ textAlign: 'right' }}>{num(r.realAcum)}</td><td><SemBadge s={r.semaforo} /></td></tr>
                ))}
                {rendimientos.filter(x => x.r.semaforo === 'rojo' || x.r.semaforo === 'ambar').length === 0 && <tr><td colSpan={5} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Sin atrasos detectados (o faltan fechas planificadas en las partidas).</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {vista === 'partidas' && (
        <div className="card" style={{ overflow: 'auto' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, fontSize: 12, padding: '8px 12px', alignItems: 'center' }}>
            {cadenaBreadcrumb(foco).map((code, i) => (
              <span key={code || 'root'} style={{ display: 'inline-flex', alignItems: 'center' }}>
                {i > 0 && <span style={{ color: 'var(--tm)' }}>/</span>}
                <button className="btn btn-ghost btn-xs" onClick={() => setFoco(code)}>{code === '' ? 'Raíz' : code}</button>
              </span>
            ))}
          </div>
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead><tr><th>Código</th><th>Partida</th><th style={{ textAlign: 'right' }}>Metrado</th><th style={{ textAlign: 'right' }}>% Avance</th><th>Rendimiento</th><th></th></tr></thead>
            <tbody>
              {nodos.map(nodo => {
                const p = nodo.partida;
                const r = p ? rendimientoPartida(p, avances || [], hoy) : null;
                return (
                  <tr key={nodo.code}>
                    <td style={{ fontFamily: 'monospace' }}>{nodo.code}</td>
                    <td>{p ? (p.nombre_partida || '—') : <button className="btn btn-ghost btn-xs" onClick={() => setFoco(nodo.code)}>📂 abrir capítulo</button>}</td>
                    <td style={{ textAlign: 'right' }}>{p ? `${num(p.metrado_contratado)} ${p.unidad || ''}` : ''}</td>
                    <td style={{ textAlign: 'right' }}>{p ? `${Number(p.porcentaje_avance) || 0}%` : ''}</td>
                    <td>{r ? <SemBadge s={r.semaforo} /> : ''}</td>
                    <td style={{ textAlign: 'right' }}>{p && <button className="btn btn-ghost btn-xs" onClick={() => window.__navTo?.('reporte-diario')}>Reportar</button>}</td>
                  </tr>
                );
              })}
              {nodos.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Tu frente no tiene partidas en este nivel.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {vista === 'salidas' && (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead><tr><th>Fecha</th><th>Material</th><th style={{ textAlign: 'right' }}>Cantidad</th><th>Responsable</th><th>Partida</th><th></th></tr></thead>
            <tbody>
              {salidasDelFrente.map(m => {
                const yaVinc = m.partida_id;
                return (
                  <tr key={m.id}>
                    <td>{m.fecha || '—'}</td><td>{materialesById.get(m.material_id)?.nombre_material || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{num(m.cantidad)} {m.unidad || ''}</td>
                    <td>{(() => { const p = personalById.get(m.responsable_id); return p ? `${p.nombres} ${p.apellidos || ''}`.trim() : '—'; })()}</td>
                    <td>{yaVinc ? <span className="badge b-green" style={{ fontSize: 9 }}>{partById.get(m.partida_id) ? partById.get(m.partida_id).codigo_delfin : '✓'}</span> : <span style={{ color: 'var(--tm)' }}>—</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {!yaVinc && (<>
                        <select className="fi" style={{ display: 'inline-block', width: 150, fontSize: 11 }} value={vincSel[m.id] || ''} onChange={e => setVincSel({ ...vincSel, [m.id]: e.target.value })}>
                          <option value="">— Partida —</option>
                          {partidasDelFrente.map(p => <option key={p.id} value={p.id}>{nombrePart(p)}</option>)}
                        </select>
                        <button className="btn btn-amber btn-xs" style={{ marginLeft: 4 }} onClick={() => vincularSalida(m)}>Vincular</button>
                      </>)}
                    </td>
                  </tr>
                );
              })}
              {salidasDelFrente.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>No hay salidas de almacén vinculadas a tu frente.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {vista === 'reporte' && (
        <div className="card card-p" style={{ maxWidth: 580 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Reporte de avance · {hoy}</div>
          <label className="flabel">Partida *</label>
          <select className="fi" value={rep.partida_id} onChange={e => setRep({ ...rep, partida_id: e.target.value })}>
            <option value="">— Elegí —</option>
            {partidasDelFrente.filter(p => !hijosDirectos(partidasDelFrente, p.codigo_delfin).length).map(p => <option key={p.id} value={p.id}>{nombrePart(p)}</option>)}
          </select>
          {repRend && (
            <div style={{ marginTop: 6, fontSize: 11.5, display: 'flex', gap: 10, alignItems: 'center' }}>
              <SemBadge s={repRend.semaforo} />
              <span style={{ color: 'var(--tm)' }}>Meta/día {num(repRend.metaDiaria)} · esperado acum. {num(repRend.esperadoAcum)} · real {num(repRend.realAcum)}</span>
            </div>
          )}
          <label className="flabel" style={{ marginTop: 8 }}>Descripción del avance</label>
          <textarea className="fi" rows={3} value={rep.descripcion} onChange={e => setRep({ ...rep, descripcion: e.target.value })} placeholder="Qué se avanzó hoy…" />
          <div className="g2" style={{ marginTop: 8 }}>
            <div><label className="flabel">Metrado avanzado (m², m³, …)</label><input className="fi" type="number" step="0.01" value={rep.metrado} onChange={e => setRep({ ...rep, metrado: e.target.value })} /></div>
            <div><label className="flabel">% Avance acumulado</label><input className="fi" type="number" step="0.1" min="0" max="100" value={rep.pct} onChange={e => setRep({ ...rep, pct: e.target.value })} /></div>
          </div>
          <label className="flabel" style={{ marginTop: 8 }}>Foto (evidencia)</label>
          <input className="fi" type="file" accept="image/*" onChange={e => setRepFoto(e.target.files?.[0] || null)} />
          <div className="modal-actions" style={{ marginTop: 12 }}>
            <button className="btn btn-amber" disabled={busyRep} onClick={guardarReporte}><JxIcon name="check" size={13} />Guardar avance</button>
          </div>
        </div>
      )}

      {vista === 'plan' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="card card-p" style={{ maxWidth: 580 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Programar meta (lookahead)</div>
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
                {planFila.filter(f => f.metaMetrado > 0 || f.realMetrado > 0).map(f => (
                  <tr key={f.partida.id}><td>{nombrePart(f.partida)}</td><td style={{ textAlign: 'right' }}>{num(f.metaMetrado)}</td>
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
                {rollup.map(r => <tr key={r.partida.id}><td>{nombrePart(r.partida)}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{num(r.metradoMes)}</td></tr>)}
                {rollup.length === 0 && <tr><td colSpan={2} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Sin avances reportados este mes.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// Emitir Alerta técnica → crea una incidencia (el ingeniero no ve el listado global).
function EmitirAlertaPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const userId = auth?.profile?.id || null;
  const obraHook = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const obraId = obraHook?.obraId || null;
  const incHook = window.__hooks.useIncidencias(obraId);
  const { data: frentes } = window.__hooks.useFrentesObra(obraId, { soloActivas: true });
  const misFrentes = uM(() => frentesDeUsuario(userId, { frentes: frentes || [] }), [userId, frentes]);
  const [form, setForm] = uS({ tipo_incidencia: 'calidad', severidad: 'media', descripcion: '' });
  const [busy, setBusy] = uS(false);
  const emitir = async () => {
    if (!(form.descripcion || '').trim()) { showToast('Describí la alerta', 'red'); return; }
    setBusy(true);
    try {
      const frenteNom = misFrentes[0]?.nombre || '';
      await incHook.create({
        id: window.__newId(), obra_id: obraId, tipo_incidencia: form.tipo_incidencia, severidad: form.severidad,
        descripcion: (frenteNom ? `[Frente ${frenteNom}] ` : '') + form.descripcion,
        modulo_origen: 'ingenieria_frente', estado: 'abierta', creado_por: userId,
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'incidencias' } })); } catch {}
      showToast('Alerta emitida', 'green');
      setForm({ tipo_incidencia: 'calidad', severidad: 'media', descripcion: '' });
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };
  if (!obraId) return <div className="page-wrap"><div className="card card-p empty-state"><p>Seleccioná una obra activa.</p></div></div>;
  return (
    <div className="page-wrap">
      <div className="pg-hd"><div className="pg-title">Emitir Alerta</div><div className="pg-sub">Reportá una incidencia técnica de tu frente.</div></div>
      <div className="card card-p" style={{ maxWidth: 560 }}>
        <div className="g2">
          <div><label className="flabel">Tipo</label>
            <select className="fi" value={form.tipo_incidencia} onChange={e => setForm({ ...form, tipo_incidencia: e.target.value })}>
              {['seguridad', 'calidad', 'material', 'equipo', 'accidente'].map(t => <option key={t} value={t}>{t}</option>)}
            </select></div>
          <div><label className="flabel">Severidad</label>
            <select className="fi" value={form.severidad} onChange={e => setForm({ ...form, severidad: e.target.value })}>
              {['baja', 'media', 'alta', 'critica'].map(s => <option key={s} value={s}>{s}</option>)}
            </select></div>
        </div>
        <label className="flabel" style={{ marginTop: 8 }}>Descripción *</label>
        <textarea className="fi" rows={4} value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} placeholder="Qué pasó, dónde, qué se necesita…" />
        <div className="modal-actions" style={{ marginTop: 12 }}>
          <button className="btn btn-amber" disabled={busy} onClick={emitir}><JxIcon name="alert" size={13} />Emitir alerta</button>
        </div>
      </div>
    </div>
  );
}

const DashboardTecnicoPage = (p) => <MiFrenteShell {...p} vista="dashboard" />;
const MisPartidasPage = (p) => <MiFrenteShell {...p} vista="partidas" />;
const SalidasFrentePage = (p) => <MiFrenteShell {...p} vista="salidas" />;
const ReporteDiarioPage = (p) => <MiFrenteShell {...p} vista="reporte" />;
const PlanRealPage = (p) => <MiFrenteShell {...p} vista="plan" />;

Object.assign(window, { DashboardTecnicoPage, MisPartidasPage, SalidasFrentePage, ReporteDiarioPage, PlanRealPage, EmitirAlertaPage, MiFrentePage: DashboardTecnicoPage });
