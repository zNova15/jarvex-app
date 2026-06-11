import React from "react";
import { stripLocalFields, TRIGGER_MANAGED_FIELDS } from "../sync/SyncEngine";
const { useState: uSC, useEffect: uEC } = React;

// ── Diff legible de un conflicto ─────────────────────────────────────
// Campos de "ruido" que difieren casi siempre y no le dicen nada al usuario
// (la versión la bumpea un trigger del server, updated_at cambia solo, etc.).
const CAMPOS_RUIDO = new Set(['version', 'updated_at', 'created_at', 'updated_by', 'created_by', 'last_synced_at', 'sync_status', 'idempotency_key']);
const LABELS_CAMPO = {
  responsable_id: 'Responsable', personal_id: 'Persona', subcontratista_id: 'Subcontrato',
  cantidad: 'Cantidad', fecha: 'Fecha', hora: 'Hora', tipo_movimiento: 'Tipo de movimiento',
  accion: 'Acción', ubicacion_id: 'Almacén', frente_zona: 'Frente', observaciones: 'Observaciones',
  precio_unitario_real: 'Precio unit.', documento_asociado: 'Documento', deleted_at: 'Eliminado',
  estado: 'Estado', cargo: 'Cargo', nombres: 'Nombres', apellidos: 'Apellidos', alias: 'Alias',
  destino_tipo: 'Tipo de destino', proveedor_id: 'Proveedor', unidad: 'Unidad', motivo: 'Motivo',
  reversed_by_id: 'Reversado por (movimiento)', reverses_id: 'Reverso de (movimiento)',
  accounting_movement_id: 'Asiento contable vinculado', pendiente_sustento: 'Pendiente de sustento',
  evidencia_id: 'Evidencia (foto)',
};
// Campos que escribe OTRO flujo/equipo sobre el mismo registro: reversed_by_id
// lo setea el flujo de reversos sobre el movimiento original; accounting_movement_id
// y pendiente_sustento los setea contabilidad al vincular factura (típicamente el
// contador en otro device); evidencia_id se agrega al adjuntar foto. NO son ruido:
// no están en stripLocalFields, así que «Forzar mis cambios» pushea el valor local
// viejo y le borra al server el vínculo — es justo la diferencia que el usuario
// necesita ver (con explicación) antes de forzar.
const CAMPOS_OTRO_PROCESO = new Set(['reversed_by_id', 'reverses_id', 'accounting_movement_id', 'pendiente_sustento', 'evidencia_id']);
// Devuelve [{campo, local, servidor}] con SOLO lo que difiere de verdad, o
// null si el snapshot del server es viejo (solo {version: N}, sin fila).
// Excluye también los TRIGGER_MANAGED_FIELDS de la tabla: el server los
// recalcula por trigger (stock_actual, totales, costo_presupuestado...), el
// cliente mantiene su propia copia, así que difieren casi siempre — y la
// elección del usuario NO los afecta («Forzar mis cambios» los quita del
// push vía stripLocalFields). Mostrarlos rompería la promesa del banner
// ("si no difiere ninguno, forzá sin riesgo") en materiales/epps/herramientas.
function diferenciasConflicto(local, server, tabla) {
  if (!local || !server || !server.id) return null;
  const triggerManaged = (tabla && TRIGGER_MANAGED_FIELDS[tabla]) || null;
  const keys = new Set([...Object.keys(local), ...Object.keys(server)]);
  const out = [];
  for (const k of keys) {
    if (k.startsWith('_') || CAMPOS_RUIDO.has(k)) continue;
    if (triggerManaged && triggerManaged.has(k)) continue;
    const a = local[k] ?? null, b = server[k] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ campo: k, local: a, servidor: b });
  }
  return out;
}
const fmtValConf = (v) => {
  if (v == null || v === '') return '(vacío)';
  if (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}/.test(v)) return v.slice(0, 8) + '…';
  // Timestamps ISO (deleted_at y similares) → fecha legible, no el crudo
  // "2026-06-09T15:23:45.123+00:00" que no le dice nada al almacenero.
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const d = new Date(v);
    if (!isNaN(d)) return d.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
  }
  if (v === true) return 'Sí';
  if (v === false) return 'No';
  // jsonb reales en tablas sincronizadas (obras.otros_gastos/consorcio_miembros,
  // trazabilidad_cadenas.items/eslabones, accounting_movements.factura_interna_meta,
  // companies.actividades_economicas): sin esto saldría '[object Object]'.
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80);
  return String(v).slice(0, 80);
};

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
      {conflicts.length > 0 && (
        <div className="info-banner" style={{ marginBottom:14, background:'rgba(52,152,219,0.06)', border:'1px solid rgba(52,152,219,0.25)', display:'block', lineHeight:1.6, fontSize:12.5 }}>
          <div style={{ fontWeight:700, marginBottom:4 }}>💡 ¿Qué es un conflicto?</div>
          <div>El mismo registro quedó con <strong>dos versiones</strong>: la de este equipo (izquierda) y la del servidor (derecha — lo que subió otro equipo o una sincronización anterior). <strong>No se perdió nada</strong>: el sistema espera que elijas cuál vale.</div>
          <div style={{ marginTop:4 }}>
            <strong>«Forzar mis cambios»</strong> = vale la de este equipo — lo normal si el último cambio lo hiciste vos (ej. tras una fusión de nombres o una importación histórica). ·{' '}
            <strong>«Mantener servidor»</strong> = vale la del servidor — si alguien más corrigió el dato después que vos.
          </div>
          <div style={{ marginTop:4, color:'var(--tm)' }}>Abajo de cada conflicto te mostramos <strong>exactamente qué campos difieren</strong>; si no difiere ninguno, podés forzar tus cambios sin riesgo.</div>
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
              {(() => {
                const difs = diferenciasConflicto(c.datos_local, c.datos_servidor, c.tabla);
                if (difs === null) {
                  return (
                    <div style={{ padding:'8px 12px', background:'rgba(242,183,5,0.08)', border:'1px solid rgba(242,183,5,0.25)', borderRadius:8, fontSize:12, color:'var(--ts)', marginBottom:10 }}>
                      ⚠️ Este conflicto se detectó con una versión anterior de la app y no guardó la copia completa del servidor. Los botones funcionan igual («Mantener servidor» la trae de nuevo); no podemos mostrarte el detalle de diferencias.
                    </div>
                  );
                }
                if (difs.length === 0) {
                  return (
                    <div style={{ padding:'8px 12px', background:'rgba(39,174,96,0.08)', border:'1px solid rgba(39,174,96,0.3)', borderRadius:8, fontSize:12.5, color:'var(--ts)', marginBottom:10 }}>
                      ✓ <strong>El contenido es idéntico en ambos lados</strong> — solo difieren campos internos (el contador de versiones o valores que el servidor recalcula solo, como stock y totales). Podés <strong>«Forzar mis cambios»</strong> con total seguridad.
                    </div>
                  );
                }
                return (
                  <div style={{ marginBottom:10 }}>
                    <div style={{ fontSize:11.5, fontWeight:700, color:'var(--ts)', marginBottom:6 }}>Difieren {difs.length} campo{difs.length !== 1 ? 's' : ''}:</div>
                    <div style={{ display:'grid', gap:6 }}>
                      {difs.map(d => (
                        <div key={d.campo} style={{ display:'flex', gap:10, alignItems:'baseline', flexWrap:'wrap', fontSize:12, padding:'6px 10px', background:'rgba(231,76,60,0.05)', border:'1px solid rgba(231,76,60,0.18)', borderRadius:6 }}>
                          <span style={{ fontWeight:700, minWidth:130 }}>{LABELS_CAMPO[d.campo] || d.campo}</span>
                          <span style={{ color:'var(--blue)' }}>Tuya: <strong>{fmtValConf(d.local)}</strong></span>
                          <span style={{ color:'var(--tm)' }}>→</span>
                          <span style={{ color:'var(--amber)' }}>Servidor: <strong>{fmtValConf(d.servidor)}</strong></span>
                          {CAMPOS_OTRO_PROCESO.has(d.campo) && (
                            <span style={{ flexBasis:'100%', fontSize:11, color:'var(--tm)' }}>
                              ⚠️ Este campo lo escribe otro proceso (reversos / contabilidad / evidencias). «Forzar mis cambios» pisa lo del servidor y puede desvincular ese reverso, asiento o foto.
                            </span>
                          )}
                          {d.campo === 'deleted_at' && (
                            <span style={{ flexBasis:'100%', fontSize:11.5, fontWeight:600, color:'var(--red)' }}>
                              {d.servidor
                                ? <>🗑️ Otro equipo <strong>eliminó este registro</strong>. «Mantener servidor» lo elimina también acá (lo normal). «Forzar mis cambios» lo vuelve a crear para todos — usalo solo si el borrado fue un error.</>
                                : <>🗑️ Este equipo lo tiene <strong>eliminado</strong> pero en el servidor sigue vivo. «Forzar mis cambios» lo elimina para todos; «Mantener servidor» lo recupera acá.</>}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              <details style={{ marginBottom:4 }}>
                <summary style={{ cursor:'pointer', fontSize:11.5, color:'var(--tm)' }}>Ver datos completos (técnico)</summary>
                <div className="g2" style={{ marginTop:8 }}>
                  <div style={{background:'rgba(52,152,219,0.08)',padding:12,borderRadius:8}}>
                    <div style={{fontSize:11,fontWeight:700,color:'var(--blue)',marginBottom:6}}>VERSIÓN LOCAL (TUYA)</div>
                    <pre style={{fontSize:10.5,color:'var(--ts)',whiteSpace:'pre-wrap',maxHeight:200,overflow:'auto'}}>{JSON.stringify(c.datos_local, null, 2)}</pre>
                  </div>
                  <div style={{background:'rgba(242,183,5,0.08)',padding:12,borderRadius:8}}>
                    <div style={{fontSize:11,fontWeight:700,color:'var(--amber)',marginBottom:6}}>VERSIÓN SERVIDOR (REMOTA)</div>
                    <pre style={{fontSize:10.5,color:'var(--ts)',whiteSpace:'pre-wrap',maxHeight:200,overflow:'auto'}}>{JSON.stringify(c.datos_servidor, null, 2)}</pre>
                  </div>
                </div>
              </details>
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
