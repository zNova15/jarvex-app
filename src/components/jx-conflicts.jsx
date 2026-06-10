import React from "react";
import { stripLocalFields } from "../sync/SyncEngine";
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

  // Forzar mis cambios: upsert por id y ESPEJAR la version que dejó el server
  // (su trigger la pisa con OLD+1; sin el espejo, la próxima edición local
  // vuelve a caer en conflicto — era la causa de conflictos reincidentes).
  const forzarLocal = async (c) => {
    // Pushear la fila VIVA de Dexie (si el usuario editó después de detectado
    // el conflicto, el snapshot la revertiría), pasada por stripLocalFields:
    // quita _sync_retries y demás campos locales (PGRST204) y los campos
    // TRIGGER_MANAGED/GENERATED por tabla (428C9 en insumos_partida, stock
    // pisado en materiales/epps/herramientas).
    const vivo = await window.__db[c.tabla].get(c.registro_id);
    const payload = stripLocalFields(vivo || c.datos_local || {}, c.tabla);
    const { data, error } = await window.__supabase.from(c.tabla).upsert(payload).select('version');
    if (error) throw error;
    const v = data && data[0] ? data[0].version : null;
    await window.__db[c.tabla].update(c.registro_id, {
      sync_status: 'synced', last_synced_at: new Date().toISOString(),
      ...(v != null ? { version: v } : {}),
    });
    await window.__db.sync_conflicts.update(c.local_seq, { estado: 'resuelto_local' });
  };

  // Mantener servidor: los conflictos viejos guardaban solo {version: N} como
  // snapshot — si no hay fila completa, traerla del server antes de pisar local.
  const mantenerServidor = async (c) => {
    let fila = (c.datos_servidor && c.datos_servidor.id) ? c.datos_servidor : null;
    if (!fila) {
      const { data, error } = await window.__supabase.from(c.tabla).select('*').eq('id', c.registro_id).maybeSingle();
      if (error || !data) throw (error || new Error('La fila ya no existe en el servidor'));
      fila = data;
    }
    if (fila.deleted_at) {
      // El server la tiene soft-borrada: "mantener servidor" = borrarla local,
      // igual que hace el pull con los tombstones (un put la dejaría zombie).
      await window.__db[c.tabla].delete(c.registro_id);
    } else {
      await window.__db[c.tabla].put({ ...fila, sync_status: 'synced', last_synced_at: new Date().toISOString() });
    }
    await window.__db.sync_conflicts.update(c.local_seq, { estado: 'resuelto_servidor' });
  };

  const aceptarServidor = async (c) => {
    try {
      await mantenerServidor(c);
      showToast('Conflicto resuelto: se mantuvo versión del servidor', 'green');
    } catch (e) { showToast(`No se pudo traer la versión del servidor: ${e.message || e}`, 'red'); }
    load();
  };

  const aceptarLocal = async (c) => {
    try {
      await forzarLocal(c);
      showToast('Conflicto resuelto: se forzaron tus cambios', 'green');
    } catch (e) { showToast(`No se pudo forzar el cambio: ${e.message || e}`, 'red'); }
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
        if (modo === 'servidor') await mantenerServidor(c);
        else await forzarLocal(c);
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
