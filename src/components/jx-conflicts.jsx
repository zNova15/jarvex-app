import React from "react";
const { useState: uSC, useEffect: uEC } = React;

function ConflictsPage({ showToast }) {
  const [conflicts, setConflicts] = uSC([]);
  const [loading, setLoading] = uSC(true);

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
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
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

  if (loading) return <div className="page-wrap"><div className="empty-state"><JxIcon name="alert" size={32} color="var(--tm)"/><p>Cargando conflictos…</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd"><div><div className="pg-title">Bandeja de Conflictos</div><div className="pg-sub">{conflicts.length} conflicto{conflicts.length!==1?'s':''} pendiente{conflicts.length!==1?'s':''} de resolución</div></div></div>

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
