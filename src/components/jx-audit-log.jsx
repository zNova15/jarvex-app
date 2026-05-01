import React from "react";
const { useState: uSAL, useEffect: uEAL, useMemo: uMAL, useCallback: uCAL } = React;

// Wrapper para JxIcon que tolera carga diferida del global
const JxIcon = (props) => {
  const I = window.JxIcon;
  return I ? <I {...props} /> : null;
};

// ═══════════════════════════════════════════════════════════════════
// JARVEX — Audit Log Viewer (admin only)
// Lee window.__db.audit_log_pending y opcionalmente Supabase audit_log
// ═══════════════════════════════════════════════════════════════════

const PAGE_SIZE = 100;

const ACTION_LABELS = {
  insert: { label: 'CREATE', cls: 'b-green', color: 'var(--green)' },
  update: { label: 'UPDATE', cls: 'b-blue',  color: 'var(--blue)' },
  delete: { label: 'DELETE', cls: 'b-red',   color: 'var(--red)' },
};

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('es-PE'); } catch { return iso; }
}

function isToday(iso) {
  if (!iso) return false;
  try {
    const d = new Date(iso); const n = new Date();
    return d.getFullYear()===n.getFullYear() && d.getMonth()===n.getMonth() && d.getDate()===n.getDate();
  } catch { return false; }
}

function truncate(s, n=80) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// Compara old_data y new_data y devuelve lista de cambios
function computeDiff(oldData, newData) {
  const changes = [];
  const oldObj = oldData && typeof oldData === 'object' ? oldData : null;
  const newObj = newData && typeof newData === 'object' ? newData : null;

  if (oldObj && newObj) {
    const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
    for (const k of keys) {
      const a = oldObj[k]; const b = newObj[k];
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        changes.push({ field: k, before: a, after: b });
      }
    }
  } else if (newObj && !oldObj) {
    for (const k of Object.keys(newObj)) {
      changes.push({ field: k, before: undefined, after: newObj[k] });
    }
  } else if (oldObj && !newObj) {
    for (const k of Object.keys(oldObj)) {
      changes.push({ field: k, before: oldObj[k], after: undefined });
    }
  }
  return changes;
}

function DiffCell({ row }) {
  const diff = uMAL(() => computeDiff(row.old_data, row.new_data), [row]);
  if (!diff.length) {
    return <span style={{fontSize:11,color:'var(--tm)'}}>Sin cambios detectados</span>;
  }
  const top = diff.slice(0, 3);
  return (
    <div style={{display:'grid',gap:3}}>
      {top.map((d,i) => (
        <div key={i} style={{fontSize:11,fontFamily:'monospace',color:'var(--ts)'}}>
          <strong style={{color:'var(--tp)'}}>{d.field}:</strong>{' '}
          <span style={{color:'var(--red)',textDecoration:'line-through'}}>{truncate(JSON.stringify(d.before), 30)}</span>
          {' → '}
          <span style={{color:'var(--green)'}}>{truncate(JSON.stringify(d.after), 30)}</span>
        </div>
      ))}
      {diff.length > 3 && <div style={{fontSize:10,color:'var(--tm)'}}>+ {diff.length-3} cambio{diff.length-3!==1?'s':''} más</div>}
    </div>
  );
}

function AuditLogPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : {};
  const isAdmin = auth?.profile?.rol === 'admin';

  const [logs, setLogs] = uSAL([]);
  const [profilesMap, setProfilesMap] = uSAL({});
  const [loading, setLoading] = uSAL(true);
  const [source, setSource] = uSAL('local'); // 'local' | 'remote'
  const [page, setPage] = uSAL(1);
  const [expanded, setExpanded] = uSAL(null);

  // Filtros
  const [fDesde, setFDesde] = uSAL('');
  const [fHasta, setFHasta] = uSAL('');
  const [fTabla, setFTabla] = uSAL('');
  const [fAccion, setFAccion] = uSAL('');
  const [fUser, setFUser] = uSAL('');
  const [onlyPending, setOnlyPending] = uSAL(false);

  const loadProfiles = uCAL(async () => {
    try {
      const all = await window.__db.profiles.toArray();
      const map = {};
      for (const p of all) {
        map[p.id] = p.nombre_completo || p.email || p.id?.slice(0,8) || '—';
      }
      setProfilesMap(map);
    } catch { /* sin profiles */ }
  }, []);

  const loadLogs = uCAL(async () => {
    setLoading(true);
    try {
      if (source === 'local') {
        let rows = await window.__db.audit_log_pending.toArray();
        if (onlyPending) rows = rows.filter(r => !r.synced);
        rows.sort((a,b) => String(b.created_at||'').localeCompare(String(a.created_at||'')));
        setLogs(rows);
      } else {
        // Supabase histórico
        if (!window.__supabase) { setLogs([]); setLoading(false); return; }
        let q = window.__supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(2000);
        const { data, error } = await q;
        if (error) {
          showToast?.('No se pudo leer audit_log remoto: ' + error.message, 'red');
          setLogs([]);
        } else {
          setLogs(data || []);
        }
      }
    } catch (e) {
      showToast?.('Error cargando auditoría: ' + (e?.message||e), 'red');
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [source, onlyPending, showToast]);

  uEAL(() => { loadProfiles(); }, [loadProfiles]);
  uEAL(() => { setPage(1); loadLogs(); }, [loadLogs]);

  // ── Filtrado en memoria
  const filtered = uMAL(() => {
    return logs.filter(r => {
      if (fDesde && r.created_at && r.created_at < fDesde) return false;
      if (fHasta && r.created_at && r.created_at > fHasta + 'T23:59:59') return false;
      if (fTabla && r.table_name !== fTabla) return false;
      if (fAccion && r.action !== fAccion) return false;
      if (fUser && r.user_id !== fUser) return false;
      return true;
    });
  }, [logs, fDesde, fHasta, fTabla, fAccion, fUser]);

  // ── Stats / facets
  const stats = uMAL(() => {
    const total = logs.length;
    const today = logs.filter(r => isToday(r.created_at));
    const usersToday = new Set(today.map(r => r.user_id).filter(Boolean));
    const tableCount = {};
    for (const r of logs) {
      if (!r.table_name) continue;
      tableCount[r.table_name] = (tableCount[r.table_name]||0) + 1;
    }
    const topTables = Object.entries(tableCount).sort((a,b)=>b[1]-a[1]).slice(0,5);
    return { total, eventsToday: today.length, usersToday: usersToday.size, topTables };
  }, [logs]);

  const tablesAll = uMAL(() => Array.from(new Set(logs.map(r => r.table_name).filter(Boolean))).sort(), [logs]);
  const usersAll  = uMAL(() => {
    const set = new Map();
    for (const r of logs) if (r.user_id) set.set(r.user_id, profilesMap[r.user_id] || r.user_email || r.user_id.slice(0,8));
    return Array.from(set.entries()).sort((a,b)=>String(a[1]).localeCompare(String(b[1])));
  }, [logs, profilesMap]);

  // ── Paginación
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = uMAL(() => filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE), [filtered, page]);

  const exportExcel = () => {
    if (!window.__reports?.generateExcel) { showToast?.('Exportador no disponible', 'red'); return; }
    if (!filtered.length) { showToast?.('Nada que exportar', 'amber'); return; }
    const columnas = ['Fecha', 'Usuario', 'Email', 'Tabla', 'Operación', 'Registro', 'Razón', 'Cambios'];
    const filas = filtered.map(r => {
      const diff = computeDiff(r.old_data, r.new_data);
      const diffStr = diff.length
        ? diff.map(d => `${d.field}: ${truncate(JSON.stringify(d.before),20)} → ${truncate(JSON.stringify(d.after),20)}`).join(' | ')
        : '';
      return [
        fmtDate(r.created_at),
        profilesMap[r.user_id] || '—',
        r.user_email || '',
        r.table_name || '',
        (ACTION_LABELS[r.action]?.label) || r.action || '',
        r.record_id || '',
        r.reason || '',
        diffStr,
      ];
    });
    window.__reports.generateExcel({
      sheetName: 'Audit Log',
      columnas, filas,
      filename: `audit-log-${new Date().toISOString().slice(0,10)}.xlsx`,
    });
    showToast?.('Excel generado', 'green');
  };

  const clearFilters = () => {
    setFDesde(''); setFHasta(''); setFTabla(''); setFAccion(''); setFUser('');
  };

  const quickFilterTable = (t) => {
    setFTabla(t); setPage(1);
  };

  // ── Guard admin
  if (!isAdmin) {
    return (
      <div className="page-wrap">
        <div className="card card-p empty-state">
          <JxIcon name="alert" size={40} color="var(--red)"/>
          <p>Acceso restringido. Solo administradores pueden ver el registro de auditoría.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="page-wrap"><div className="empty-state"><JxIcon name="alert" size={32} color="var(--tm)"/><p>Cargando auditoría…</p></div></div>;
  }

  return (
    <div className="page-wrap">
      <div className="pg-hd">
        <div>
          <div className="pg-title">Registro de Auditoría</div>
          <div className="pg-sub">Quién cambió qué y cuándo · {filtered.length} de {logs.length} evento{logs.length!==1?'s':''}</div>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <div style={{display:'flex',gap:0,border:'1px solid var(--bd)',borderRadius:8,overflow:'hidden'}}>
            <button
              className={'btn btn-sm ' + (source==='local' ? 'btn-primary' : 'btn-ghost')}
              style={{borderRadius:0}}
              onClick={()=>setSource('local')}>Local pendiente</button>
            <button
              className={'btn btn-sm ' + (source==='remote' ? 'btn-primary' : 'btn-ghost')}
              style={{borderRadius:0}}
              onClick={()=>setSource('remote')}>Histórico Supabase</button>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={loadLogs}>
            <JxIcon name="refresh" size={14}/> Refrescar
          </button>
          <button className="btn btn-primary btn-sm" onClick={exportExcel}>
            <JxIcon name="download" size={14}/> Exportar Excel
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="g3" style={{marginBottom:16}}>
        <div className="card card-p">
          <div style={{fontSize:11,color:'var(--tm)',fontWeight:700}}>TOTAL DE EVENTOS</div>
          <div style={{fontSize:26,fontWeight:800,color:'var(--tp)',marginTop:4}}>{stats.total.toLocaleString('es-PE')}</div>
        </div>
        <div className="card card-p">
          <div style={{fontSize:11,color:'var(--tm)',fontWeight:700}}>EVENTOS HOY</div>
          <div style={{fontSize:26,fontWeight:800,color:'var(--blue)',marginTop:4}}>{stats.eventsToday}</div>
        </div>
        <div className="card card-p">
          <div style={{fontSize:11,color:'var(--tm)',fontWeight:700}}>USUARIOS ACTIVOS HOY</div>
          <div style={{fontSize:26,fontWeight:800,color:'var(--green)',marginTop:4}}>{stats.usersToday}</div>
        </div>
      </div>

      {/* Tablas top — filtros rápidos */}
      {stats.topTables.length > 0 && (
        <div className="card card-p" style={{marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:700,color:'var(--tm)',marginBottom:8}}>TABLAS MÁS ACTIVAS · click para filtrar</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
            {stats.topTables.map(([t,c]) => (
              <button
                key={t}
                className={'btn btn-sm ' + (fTabla===t ? 'btn-primary' : 'btn-ghost')}
                onClick={()=> fTabla===t ? setFTabla('') : quickFilterTable(t)}>
                {t} · <strong style={{marginLeft:4}}>{c}</strong>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="card card-p" style={{marginBottom:16}}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10,alignItems:'end'}}>
          <div>
            <label style={{fontSize:11,color:'var(--tm)',fontWeight:700}}>DESDE</label>
            <input type="date" className="inp" value={fDesde} onChange={e=>{setFDesde(e.target.value); setPage(1);}}/>
          </div>
          <div>
            <label style={{fontSize:11,color:'var(--tm)',fontWeight:700}}>HASTA</label>
            <input type="date" className="inp" value={fHasta} onChange={e=>{setFHasta(e.target.value); setPage(1);}}/>
          </div>
          <div>
            <label style={{fontSize:11,color:'var(--tm)',fontWeight:700}}>TABLA</label>
            <select className="inp" value={fTabla} onChange={e=>{setFTabla(e.target.value); setPage(1);}}>
              <option value="">Todas</option>
              {tablesAll.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:11,color:'var(--tm)',fontWeight:700}}>OPERACIÓN</label>
            <select className="inp" value={fAccion} onChange={e=>{setFAccion(e.target.value); setPage(1);}}>
              <option value="">Todas</option>
              <option value="insert">CREATE</option>
              <option value="update">UPDATE</option>
              <option value="delete">DELETE</option>
            </select>
          </div>
          <div>
            <label style={{fontSize:11,color:'var(--tm)',fontWeight:700}}>USUARIO</label>
            <select className="inp" value={fUser} onChange={e=>{setFUser(e.target.value); setPage(1);}}>
              <option value="">Todos</option>
              {usersAll.map(([id,nm]) => <option key={id} value={id}>{nm}</option>)}
            </select>
          </div>
          {source === 'local' && (
            <div style={{display:'flex',alignItems:'center',gap:6,paddingBottom:8}}>
              <input id="onlyPending" type="checkbox" checked={onlyPending} onChange={e=>setOnlyPending(e.target.checked)}/>
              <label htmlFor="onlyPending" style={{fontSize:12,color:'var(--ts)'}}>Solo no sincronizados</label>
            </div>
          )}
          <button className="btn btn-ghost btn-sm" onClick={clearFilters}>Limpiar</button>
        </div>
      </div>

      {/* Tabla */}
      {filtered.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="checkCircle" size={40} color="var(--green)"/>
          <p style={{fontWeight:700,marginTop:8}}>
            {logs.length === 0
              ? 'No hay eventos auditables aún.'
              : 'Ningún evento coincide con los filtros aplicados.'}
          </p>
          {logs.length === 0 && (
            <p style={{fontSize:12,color:'var(--tm)',marginTop:4}}>
              Las operaciones críticas (insertar, actualizar, eliminar) se registran automáticamente.
            </p>
          )}
        </div>
      ) : (
        <div className="card" style={{overflow:'auto'}}>
          <table className="tbl" style={{width:'100%',fontSize:12}}>
            <thead>
              <tr>
                <th style={{width:140}}>Fecha/Hora</th>
                <th style={{width:160}}>Usuario</th>
                <th style={{width:140}}>Tabla</th>
                <th style={{width:100}}>Operación</th>
                <th style={{width:120}}>Registro</th>
                <th>Cambios</th>
                {source==='local' && <th style={{width:80}}>Sync</th>}
              </tr>
            </thead>
            <tbody>
              {pageRows.map(r => {
                const act = ACTION_LABELS[r.action] || { label: r.action, cls: '' };
                const userName = profilesMap[r.user_id] || r.user_email || (r.user_id ? r.user_id.slice(0,8) : '—');
                const isOpen = expanded === r.id;
                return (
                  <React.Fragment key={r.id}>
                    <tr style={{cursor:'pointer'}} onClick={()=>setExpanded(isOpen?null:r.id)}>
                      <td style={{fontSize:11,whiteSpace:'nowrap'}}>{fmtDate(r.created_at)}</td>
                      <td>
                        <div style={{fontWeight:600,color:'var(--tp)'}}>{userName}</div>
                        {r.user_email && r.user_email !== userName && (
                          <div style={{fontSize:10,color:'var(--tm)'}}>{r.user_email}</div>
                        )}
                      </td>
                      <td><code style={{fontSize:11}}>{r.table_name || '—'}</code></td>
                      <td><span className={'badge ' + act.cls}>{act.label}</span></td>
                      <td><code style={{fontSize:10,color:'var(--tm)'}}>{r.record_id ? r.record_id.slice(0,8) : '—'}</code></td>
                      <td><DiffCell row={r}/></td>
                      {source==='local' && (
                        <td>
                          {r.synced
                            ? <span className="badge b-green">SI</span>
                            : <span className="badge b-amber">PEND</span>}
                        </td>
                      )}
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={source==='local'?7:6} style={{background:'var(--bg2,rgba(0,0,0,0.02))'}}>
                          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,padding:12}}>
                            <div>
                              <div style={{fontSize:11,fontWeight:700,color:'var(--red)',marginBottom:4}}>OLD DATA</div>
                              <pre style={{fontSize:10,whiteSpace:'pre-wrap',maxHeight:240,overflow:'auto',background:'rgba(231,76,60,0.06)',padding:8,borderRadius:6}}>
                                {r.old_data ? JSON.stringify(r.old_data, null, 2) : '—'}
                              </pre>
                            </div>
                            <div>
                              <div style={{fontSize:11,fontWeight:700,color:'var(--green)',marginBottom:4}}>NEW DATA</div>
                              <pre style={{fontSize:10,whiteSpace:'pre-wrap',maxHeight:240,overflow:'auto',background:'rgba(46,204,113,0.06)',padding:8,borderRadius:6}}>
                                {r.new_data ? JSON.stringify(r.new_data, null, 2) : '—'}
                              </pre>
                            </div>
                            {r.reason && (
                              <div style={{gridColumn:'1 / -1',fontSize:11,color:'var(--ts)'}}>
                                <strong style={{color:'var(--tp)'}}>Razón:</strong> {r.reason}
                              </div>
                            )}
                            <div style={{gridColumn:'1 / -1',fontSize:10,color:'var(--tm)'}}>
                              ID log: <code>{r.id}</code> · Record ID completo: <code>{r.record_id || '—'}</code>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>

          {/* Paginación */}
          {totalPages > 1 && (
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:12,borderTop:'1px solid var(--bd)'}}>
              <div style={{fontSize:11,color:'var(--tm)'}}>
                Página {page} de {totalPages} · {filtered.length} registros · mostrando {pageRows.length}
              </div>
              <div style={{display:'flex',gap:6}}>
                <button className="btn btn-ghost btn-sm" disabled={page<=1} onClick={()=>setPage(1)}>« Inicio</button>
                <button className="btn btn-ghost btn-sm" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>‹ Anterior</button>
                <button className="btn btn-ghost btn-sm" disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>Siguiente ›</button>
                <button className="btn btn-ghost btn-sm" disabled={page>=totalPages} onClick={()=>setPage(totalPages)}>Final »</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { AuditLogPage });
