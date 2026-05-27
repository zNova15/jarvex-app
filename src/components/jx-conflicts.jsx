import React from "react";
const { useState: uSC, useEffect: uEC } = React;

function ConflictsPage({ showToast }) {
  const [conflicts, setConflicts] = uSC([]);
  const [loading, setLoading] = uSC(true);
  const [bulk, setBulk] = uSC(null); // { hechos, total } mientras resuelve en lote

  const load = async () => {
    setLoading(true);
    const all = await window.__db.sync_conflicts
      .where('estado').equals('pendiente')
      .toArray();
    setConflicts(all);
    setLoading(false);
  };

  uEC(() => {
    load();
    // Antes polling cada 3s. Reemplazado por evento que dispara SyncEngine
    // cuando detecta conflicto. Fallback de 30s.
    const onChange = (e) => {
      const t = e?.detail?.tabla;
      if (!t || t === 'sync_conflicts') load();
    };
    window.addEventListener('jx_data_changed', onChange);
    window.addEventListener('jx_sync_pull', load);
    const interval = setInterval(load, 30000);
    return () => {
      window.removeEventListener('jx_data_changed', onChange);
      window.removeEventListener('jx_sync_pull', load);
      clearInterval(interval);
    };
  }, []);

  const aceptarServidor = async (c) => {
    // Mantener datos del servidor, descartar locales
    await window.__db[c.tabla].put({ ...c.datos_servidor, sync_status: 'synced' });
    await window.__db.sync_conflicts.update(c.local_seq, { estado: 'resuelto_servidor' });
    showToast('Conflicto resuelto: se mantuvo versión del servidor', 'green');
    load();
  };

  const aceptarLocal = async (c) => {
    // Forzar mis cambios al servidor
    const { sync_status, last_synced_at, ...payload } = c.datos_local;
    await window.__supabase.from(c.tabla).upsert(payload);
    await window.__db[c.tabla].update(c.registro_id, { sync_status: 'synced' });
    await window.__db.sync_conflicts.update(c.local_seq, { estado: 'resuelto_local' });
    showToast('Conflicto resuelto: se forzaron tus cambios', 'green');
    load();
  };

  // Resolución en LOTE: para tormentas de conflictos (ej. tras una migración,
  // donde local quedó adelante del server). 'local' = forzar mis cambios en
  // todos; 'servidor' = mantener server en todos.
  const resolverTodos = async (modo) => {
    const pend = await window.__db.sync_conflicts.where('estado').equals('pendiente').toArray();
    if (!pend.length) return;
    const label = modo === 'local' ? 'FORZAR TUS CAMBIOS' : 'MANTENER LA VERSIÓN DEL SERVIDOR';
    if (!confirm(`¿Resolver los ${pend.length} conflictos con "${label}"?\n\nEsta acción es masiva y no se puede deshacer una por una.`)) return;
    setBulk({ hechos: 0, total: pend.length });
    let ok = 0, fail = 0;
    for (let i = 0; i < pend.length; i++) {
      const c = pend[i];
      try {
        if (modo === 'servidor') {
          await window.__db[c.tabla].put({ ...c.datos_servidor, sync_status: 'synced' });
          await window.__db.sync_conflicts.update(c.local_seq, { estado: 'resuelto_servidor' });
        } else {
          const { sync_status, last_synced_at, _last_error, _last_error_code, ...payload } = c.datos_local || {};
          await window.__supabase.from(c.tabla).upsert(payload);
          await window.__db[c.tabla].update(c.registro_id, { sync_status: 'synced' });
          await window.__db.sync_conflicts.update(c.local_seq, { estado: 'resuelto_local' });
        }
        ok++;
      } catch (e) { fail++; }
      if (i % 10 === 0) { setBulk({ hechos: i + 1, total: pend.length }); await new Promise(r => setTimeout(r, 0)); }
    }
    setBulk(null);
    showToast(`Conflictos resueltos: ${ok} ok${fail ? ` · ${fail} con error` : ''}`, fail ? 'amber' : 'green');
    load();
  };

  if (loading) return <div className="page-wrap"><div className="empty-state"><JxIcon name="alert" size={32} color="var(--tm)"/><p>Cargando conflictos…</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div><div className="pg-title">Bandeja de Conflictos</div><div className="pg-sub">{conflicts.length} conflicto{conflicts.length!==1?'s':''} pendiente{conflicts.length!==1?'s':''} de resolución</div></div>
        {conflicts.length > 1 && (
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-ghost btn-sm" disabled={!!bulk} onClick={()=>resolverTodos('servidor')}>Mantener servidor (todos)</button>
            <button className="btn btn-amber btn-sm" disabled={!!bulk} onClick={()=>resolverTodos('local')}>{bulk ? `Resolviendo… ${bulk.hechos}/${bulk.total}` : 'Forzar mis cambios (todos)'}</button>
          </div>
        )}
      </div>
      {conflicts.length > 5 && (
        <div className="info-banner" style={{ marginBottom:14, background:'rgba(242,183,5,0.08)', border:'1px solid rgba(242,183,5,0.25)' }}>
          <JxIcon name="alert" size={14} color="var(--amber)"/>
          <span>Muchos conflictos suelen venir de ediciones locales que quedaron adelante del servidor (ej. tras una migración). Si tus datos locales son los correctos, usá <strong>"Forzar mis cambios (todos)"</strong>.</span>
        </div>
      )}

      {conflicts.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="checkCircle" size={40} color="var(--green)"/>
          <p>¡Sin conflictos! Todos los cambios están sincronizados correctamente.</p>
        </div>
      ) : (
        <div style={{display:'grid',gap:12}}>
          {conflicts.map(c => (
            <div key={c.local_seq} className="card card-p" style={{borderLeft:'3px solid var(--red)'}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:12}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:'var(--tp)'}}>{c.tabla} · ID: {c.registro_id?.slice(0,8)}</div>
                  <div style={{fontSize:11,color:'var(--tm)',marginTop:2}}>Detectado: {new Date(c.created_at).toLocaleString('es-PE')}</div>
                </div>
                <span className="badge b-red">Conflicto</span>
              </div>
              <div className="g2">
                <div style={{background:'rgba(52,152,219,0.08)',padding:12,borderRadius:8}}>
                  <div style={{fontSize:11,fontWeight:700,color:'var(--blue)',marginBottom:6}}>VERSIÓN LOCAL (TUYA)</div>
                  <pre style={{fontSize:10.5,color:'var(--ts)',whiteSpace:'pre-wrap',maxHeight:200,overflow:'auto'}}>{JSON.stringify(c.datos_local, null, 2)}</pre>
                </div>
                <div style={{background:'rgba(242,183,5,0.08)',padding:12,borderRadius:8}}>
                  <div style={{fontSize:11,fontWeight:700,color:'var(--amber)',marginBottom:6}}>VERSIÓN SERVIDOR (REMOTA)</div>
                  <pre style={{fontSize:10.5,color:'var(--ts)',whiteSpace:'pre-wrap',maxHeight:200,overflow:'auto'}}>{JSON.stringify(c.datos_servidor, null, 2)}</pre>
                </div>
              </div>
              <div style={{display:'flex',gap:8,marginTop:14,justifyContent:'flex-end'}}>
                <button className="btn btn-ghost btn-sm" onClick={()=>aceptarServidor(c)}>Mantener servidor</button>
                <button className="btn btn-amber btn-sm" onClick={()=>aceptarLocal(c)}>Forzar mis cambios</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { ConflictsPage });
