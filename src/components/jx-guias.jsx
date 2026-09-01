// ═══════════════════════════════════════════════════════════════════
// JARVEX — GUÍAS DE REMISIÓN (apartado de contabilidad)
//
// Las guías llegan por Captura Mágica (tipo 'guia_remision') o se vinculan
// acá. VÍNCULO BIDIRECCIONAL con la factura (accounting_movement_id):
// · desde la guía → botón "Ver factura" (abre Movimientos filtrado);
// · desde Movimientos → 📄 abre esta página filtrada por la serie.
// El deep-link usa el patrón intent global (window.__guiasFocusIntent /
// window.__movsBuscarIntent) + window.__navTo.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { matchFacturaDeGuia, normalizarDoc, clasificarOrigenGuia, facturasQueRequierenGuia, sugerirGuiasParaFactura } from "../lib/guias.js";
import { itemsDeFactura, parseNotas } from "../lib/cruce-recepcion.js";
import { normalizarRuc } from "../lib/doc-id.js";
import { getCurrentMode } from "../lib/app-mode-core.js";

const { useState: uS, useMemo: uM, useEffect: uE } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

// Badge de origen (pedido 31-ago): EMITIDA la despachó una empresa del grupo;
// RECIBIDA viene de un proveedor.
const ORIGEN_BADGE = {
  emitida:     { label: '↗ Emitida',  cls: 'b-green', title: 'La emitió una empresa del grupo' },
  recibida:    { label: '↘ Recibida', cls: 'b-blue',  title: 'La emitió un proveedor' },
  desconocida: { label: '? Sin RUC',  cls: 'b-gray',  title: 'La guía no tiene RUC de emisor' },
};

function GuiasRemisionPage({ showToast }) {
  const toast = showToast || (() => {});
  const auth = window.__useAuth?.();
  const rol = auth?.profile?.rol;
  const userId = auth?.profile?.id ?? 'offline';
  const canWrite = rol === 'admin' || (window.__hasPerm?.(rol, 'Movs. Contables', 'w') ?? false);
  const movsHook = window.__hooks.useAccountingMovements();
  const movs = movsHook.data;
  const { data: obras } = window.__hooks.useObras();
  const { data: companies } = window.__hooks.useCompanies();

  const [guias, setGuias] = uS([]);
  const [q, setQ] = uS(() => {
    // Deep-link desde Movimientos: pre-filtrar por la serie de la guía.
    const intent = window.__guiasFocusIntent;
    if (intent) { window.__guiasFocusIntent = null; return String(intent); }
    return '';
  });
  const [busy, setBusy] = uS(false);
  const [vincular, setVincular] = uS(null);   // guía a vincular manualmente
  // Pestaña de origen. Arranca SIEMPRE en 'todas': el deep-link desde el chip
  // 📄 de Movimientos no sabe si la guía es emitida o recibida.
  const [tab, setTab] = uS('todas');
  const [filtroVinculo, setFiltroVinculo] = uS('todos');   // todos | vinculadas | sin_vincular
  const [filtroEmpresa, setFiltroEmpresa] = uS('todas');   // empresa del grupo
  const [filtroObra, setFiltroObra] = uS('todas');
  const [fDesde, setFDesde] = uS('');
  const [fHasta, setFHasta] = uS('');
  // Panel "facturas que requieren guía": colapsado por defecto; ventana de 90
  // días por defecto (hay cientos de facturas viejas — el backlog completo se
  // abre a pedido con "Ver todo el histórico").
  const [panelAbierto, setPanelAbierto] = uS(false);
  const [panelTodo, setPanelTodo] = uS(false);
  const [verSinDatos, setVerSinDatos] = uS(false);
  const [verNoRequiere, setVerNoRequiere] = uS(false);
  const [buscarGuiaPara, setBuscarGuiaPara] = uS(null);    // factura → elegir guía suelta

  uE(() => {
    let cancel = false;
    const load = async () => {
      try {
        const esPrueba = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();
        const rows = await window.__db.guias_remision.filter(g => !g.deleted_at && (esPrueba ? g.demo === true : g.demo !== true)).toArray();
        if (cancel) return;
        rows.sort((a, b) => String(b.fecha_emision || b.created_at || '').localeCompare(String(a.fecha_emision || a.created_at || '')));
        setGuias(rows);
      } catch {}
    };
    load();
    const on = (e) => { const t = e?.detail?.tabla; if (!t || t === 'guias_remision') load(); };
    window.addEventListener('jx_data_changed', on);
    window.addEventListener('jarvex_master_updated', on);
    return () => { cancel = true; window.removeEventListener('jx_data_changed', on); window.removeEventListener('jarvex_master_updated', on); };
  }, []);

  const movById = uM(() => new Map((movs || []).map(m => [m.id, m])), [movs]);
  const obraNombre = (id) => (obras || []).find(o => o.id === id)?.nombre_obra || '';

  // RUCs del grupo → clasificar cada guía como emitida/recibida (derive puro).
  const rucsGrupo = uM(() =>
    new Set((companies || []).filter(c => !c.deleted_at && c.ruc).map(c => normalizarRuc(c.ruc))),
    [companies]);
  const origenDe = uM(() => {
    const m = new Map();
    for (const g of guias) m.set(g.id, clasificarOrigenGuia(g, rucsGrupo));
    return m;
  }, [guias, rucsGrupo]);

  // ¿A qué empresa del grupo pertenece la guía? Emitida → por RUC del emisor;
  // recibida → la empresa de la factura vinculada (fallback g.company_id, que
  // Captura Mágica solo llena a veces).
  const empresaDeGuia = (g) => {
    const origen = origenDe.get(g.id);
    if (origen === 'emitida') {
      const ruc = normalizarRuc(g.emisor_ruc);
      return (companies || []).find(c => c.ruc && normalizarRuc(c.ruc) === ruc)?.id || null;
    }
    const mov = g.accounting_movement_id ? movById.get(g.accounting_movement_id) : null;
    return mov?.company_id || g.company_id || null;
  };

  const filtradas = uM(() => {
    const qn = q.trim().toLowerCase();
    return guias.filter(g => {
      if (qn && !(
        String(g.serie_correlativo || '').toLowerCase().includes(qn) ||
        String(g.emisor_razon_social || '').toLowerCase().includes(qn) ||
        String(g.doc_referencia || '').toLowerCase().includes(qn))) return false;
      if (tab !== 'todas' && origenDe.get(g.id) !== tab) return false;
      if (filtroVinculo === 'vinculadas' && !g.accounting_movement_id) return false;
      if (filtroVinculo === 'sin_vincular' && g.accounting_movement_id) return false;
      if (filtroEmpresa !== 'todas' && empresaDeGuia(g) !== filtroEmpresa) return false;
      if (filtroObra !== 'todas' && g.obra_id !== filtroObra) return false;
      const f = String(g.fecha_emision || g.created_at || '').slice(0, 10);
      if (fDesde && f && f < fDesde) return false;
      if (fHasta && f && f > fHasta) return false;
      return true;
    });
  }, [guias, q, tab, filtroVinculo, filtroEmpresa, filtroObra, fDesde, fHasta, origenDe, movById, companies]);

  // ── Facturas que requieren guía y no la tienen (heurística + override) ──
  // El espejo automático de una venta interco no lleva guía propia (la guía
  // vive en la venta original) → fuera de la lista.
  const requieren = uM(() => facturasQueRequierenGuia(movs || [], guias, itemsDeFactura, {
    esEspejoAuto: (m) => parseNotas(m?.notas)?.intercompany_auto === true,
  }), [movs, guias]);
  const cortePanel = uM(() => {
    // Ventana de 90 días para el panel (backlog viejo a pedido). "Hoy" en zona
    // Lima (regla crítica 7: nunca new Date().toISOString() directo).
    if (panelTodo) return null;
    const hoy = window.__fecha?.hoyLocal?.() || new Date().toISOString().slice(0, 10);
    const [y, mo, da] = hoy.split('-').map(Number);
    return new Date(Date.UTC(y, mo - 1, da - 90)).toISOString().slice(0, 10);
  }, [panelTodo]);
  const enVentana = (m) => !cortePanel || String(m.date || '').slice(0, 10) >= cortePanel;
  const comprasPend = uM(() => requieren.compras.filter(enVentana).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))), [requieren, cortePanel]);
  const ventasPend = uM(() => requieren.ventas.filter(enVentana).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))), [requieren, cortePanel]);
  const sinDatosPend = uM(() => requieren.sinDatos.filter(enVentana), [requieren, cortePanel]);

  const marcarGuiaEstado = async (m, estado) => {
    if (busy) return;
    if (estado === 'no_requiere' && !confirm(`¿Marcar ${m.document_number || 'esta factura'} como "NO requiere guía"? Sale de la lista de pendientes (reversible desde el plegado "Marcadas no requiere").`)) return;
    setBusy(true);
    try {
      // Escritura directa estilo setVinculo (demo-aware): el update genérico
      // del hook dejaba los movimientos DEMO en pending_update para siempre
      // (el push filtra demos y el contador de pendientes no) → badge
      // "N pendiente(s)" eterno en la barra de sync.
      const { SYNC_STATUS } = await import('../db/jarvex.db');
      const fresh = await window.__db.accounting_movements.get(m.id);
      if (!fresh) return;
      await window.__db.accounting_movements.update(m.id, {
        guia_estado: estado,
        updated_at: new Date().toISOString(), updated_by: userId,
        version: (fresh.version ?? 0) + 1,
        sync_status: fresh.demo === true ? SYNC_STATUS.SYNCED
          : (fresh.sync_status === SYNC_STATUS.PENDING_CREATE ? SYNC_STATUS.PENDING_CREATE : SYNC_STATUS.PENDING_UPDATE),
      });
      window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } }));
      try { window.dispatchEvent(new Event('online')); } catch {}
      toast(estado === 'no_requiere'
        ? `✓ ${m.document_number || 'Factura'} marcada "no requiere guía" — sale de la lista (reversible abajo)`
        : estado === 'requiere'
          ? `⚑ ${m.document_number || 'Factura'} marcada "SÍ requiere" — queda entre los pendientes`
          : `↩ ${m.document_number || 'Factura'} vuelve a decidirse por la heurística`, 'green');
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  // Reversibilidad de "no requiere": lista de marcadas para poder deshacer.
  const noRequiereList = uM(() =>
    (movs || []).filter(m => m && !m.deleted_at && m.document_type === 'factura' && m.guia_estado === 'no_requiere'),
    [movs]);

  const verFactura = (g) => {
    const mov = movById.get(g.accounting_movement_id);
    // Movimientos filtra por búsqueda: pasamos el número de documento.
    window.__movsBuscarIntent = mov?.document_number || g.doc_referencia || '';
    window.__navTo?.('movimientos-contables');
  };

  const abrirEvidencia = async (g) => {
    try {
      const ev = g.evidencia_id ? await window.__db.evidencias.get(g.evidencia_id) : null;
      if (!ev) { toast('Esta guía no tiene el PDF adjunto', 'amber'); return; }
      const { getEvidenciaSrc, abrirUrlEvidencia } = await import('../lib/evidencias-url.js');
      const r = await getEvidenciaSrc(ev);
      if (r?.url) abrirUrlEvidencia(r.url);
    } catch {}
  };

  const setVinculo = async (g, movId) => {
    if (busy) return;
    setBusy(true);
    try {
      const { SYNC_STATUS } = await import('../db/jarvex.db');
      const fresh = await window.__db.guias_remision.get(g.id);
      if (!fresh) return;
      await window.__db.guias_remision.update(g.id, {
        accounting_movement_id: movId || null,
        updated_at: new Date().toISOString(), updated_by: userId,
        version: (fresh.version ?? 0) + 1,
        sync_status: fresh.demo === true ? SYNC_STATUS.SYNCED
          : (fresh.sync_status === SYNC_STATUS.PENDING_CREATE ? SYNC_STATUS.PENDING_CREATE : SYNC_STATUS.PENDING_UPDATE),
      });
      window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'guias_remision' } }));
      try { window.dispatchEvent(new Event('online')); } catch {}
      toast(movId ? 'Guía vinculada a la factura' : 'Vínculo quitado', 'green');
      setVincular(null);
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  // Candidatos de factura para vincular a mano (sugerencia por Doc.Ref primero).
  const candidatosDe = (g) => {
    const sug = matchFacturaDeGuia({ doc_referencia: g.doc_referencia, emisor_ruc: g.emisor_ruc }, movs || []);
    const ref = normalizarDoc(g.doc_referencia);
    const lista = (movs || [])
      .filter(m => !m.deleted_at && m.document_number)
      .map(m => ({ m, pri: sug?.mov?.id === m.id ? 2 : (ref && normalizarDoc(m.document_number)?.correlativo === ref.correlativo ? 1 : 0) }))
      .sort((a, b) => b.pri - a.pri || String(b.m.date || '').localeCompare(String(a.m.date || '')))
      .slice(0, 30);
    return { lista, sugerido: sug?.mov?.id || null };
  };

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Guías de Remisión</div>
          <div className="pg-sub">{guias.length} guía(s) · emitidas por el grupo o recibidas de proveedores · vinculadas (ida y vuelta) a su factura</div>
        </div>
      </div>

      {/* Pestañas de ORIGEN (pedido 31-ago): emitida = el RUC emisor es de una
          empresa del grupo; recibida = de un proveedor. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {[['todas', 'Todas'], ['emitida', '↗ Emitidas (nuestras)'], ['recibida', '↘ Recibidas (proveedores)']].map(([v, l]) => (
          <button key={v} className={`btn btn-sm ${tab === v ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab(v)}>
            {l} <span style={{ opacity: 0.7, fontSize: 10 }}>({v === 'todas' ? guias.length : guias.filter(g => origenDe.get(g.id) === v).length})</span>
          </button>
        ))}
      </div>

      <div className="card card-p" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="search-bar" style={{ flex: '1 1 240px' }}>
            <JxIcon name="search" size={14} color="var(--tm)" />
            <input placeholder="Buscar por serie / emisor / referencia…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          {(q || tab !== 'todas' || filtroVinculo !== 'todos' || filtroEmpresa !== 'todas' || filtroObra !== 'todas' || fDesde || fHasta) && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setTab('todas'); setFiltroVinculo('todos'); setFiltroEmpresa('todas'); setFiltroObra('todas'); setFDesde(''); setFHasta(''); }}>
              ✕ Limpiar filtros
            </button>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 10, marginTop: 10 }}>
          <div>
            <label className="flabel">Vínculo con factura</label>
            <select className="fi" value={filtroVinculo} onChange={e => setFiltroVinculo(e.target.value)} style={{ width: '100%' }}>
              <option value="todos">Todas</option>
              <option value="vinculadas">✓ Vinculadas</option>
              <option value="sin_vincular">⚠ Sin vincular</option>
            </select>
          </div>
          <div>
            <label className="flabel">🏢 Empresa del grupo</label>
            <select className="fi" value={filtroEmpresa} onChange={e => setFiltroEmpresa(e.target.value)} style={{ width: '100%' }}
              title="Emitidas: por el RUC emisor. Recibidas: la empresa de la factura vinculada.">
              <option value="todas">Todas</option>
              {(companies || []).filter(c => !c.deleted_at).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="flabel">🏗 Obra</label>
            <select className="fi" value={filtroObra} onChange={e => setFiltroObra(e.target.value)} style={{ width: '100%' }}>
              <option value="todas">Todas</option>
              {(obras || []).filter(o => !o.deleted_at).map(o => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}
            </select>
          </div>
          <div>
            <label className="flabel">📅 Emisión del / al</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="fi" type="date" value={fDesde} onChange={e => setFDesde(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
              <input className="fi" type="date" value={fHasta} onChange={e => setFHasta(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Facturas que REQUIEREN guía y no la tienen (pedido 31-ago) ── */}
      {(comprasPend.length + ventasPend.length + sinDatosPend.length > 0 || panelAbierto) && (
        <div className="card" style={{ marginBottom: 12, overflow: 'hidden', border: '1px solid rgba(242,183,5,0.35)' }}>
          <button onClick={() => setPanelAbierto(a => !a)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '10px 14px', background: 'rgba(242,183,5,0.07)', border: 'none', cursor: 'pointer', color: 'var(--tp)', fontSize: 12.5, fontWeight: 700 }}>
            <span>🚚 Facturas que requieren guía y NO la tienen
              <span style={{ color: 'var(--amber)', marginLeft: 8 }}>
                {comprasPend.length} compra{comprasPend.length === 1 ? '' : 's'} · {ventasPend.length} venta{ventasPend.length === 1 ? '' : 's'}
              </span>
              <span style={{ color: 'var(--tm)', fontWeight: 400, fontSize: 10.5, marginLeft: 8 }}>
                {panelTodo ? 'todo el histórico' : 'últimos 90 días'}
              </span>
            </span>
            <span style={{ color: 'var(--amber)', fontSize: 11 }}>{panelAbierto ? '▲ Cerrar' : '▼ Revisar'}</span>
          </button>
          {panelAbierto && (
            <div style={{ padding: '10px 14px', display: 'grid', gap: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--tm)' }}>
                Criterio: facturas con al menos un ítem que NO es servicio (los bienes se trasladan con guía) y sin guía vinculada.
                "No requiere" la saca de la lista para siempre.
                <button className="btn btn-ghost btn-xs" style={{ marginLeft: 8 }} onClick={() => setPanelTodo(t => !t)}>
                  {panelTodo ? 'Ver solo 90 días' : 'Ver todo el histórico'}
                </button>
              </div>
              {[['🧾 VENTAS — nos tocaba EMITIR la guía (riesgo tributario propio)', ventasPend], ['🛒 COMPRAS — reclamar la guía al proveedor', comprasPend]].map(([titulo, lista]) => lista.length > 0 && (
                <div key={titulo}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6, color: 'var(--ts)' }}>{titulo} · {lista.length}</div>
                  <div style={{ display: 'grid', gap: 4, maxHeight: 260, overflow: 'auto' }}>
                    {lista.slice(0, 80).map(m => (
                      <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11.5, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6 }}>
                        <strong>{m.document_number || 's/n'}</strong>
                        <span style={{ color: 'var(--tm)' }}>{m.date || ''}</span>
                        <span style={{ flex: 1, minWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.third_party_name || m.description || ''}</span>
                        <span style={{ color: 'var(--ts)' }}>{m.currency === 'USD' ? '$' : 'S/'} {Number(m.amount || 0).toLocaleString('es-PE')}</span>
                        {canWrite && (
                          <>
                            <button className="btn btn-ghost btn-xs" disabled={busy} title="Elegir entre las guías sin vincular"
                              onClick={() => setBuscarGuiaPara(m)}>🔗 Vincular guía</button>
                            <button className="btn btn-ghost btn-xs" style={{ color: 'var(--tm)' }} disabled={busy}
                              title="Esta factura NO lleva guía — no volver a mostrarla"
                              onClick={() => marcarGuiaEstado(m, 'no_requiere')}>✕ No requiere</button>
                          </>
                        )}
                      </div>
                    ))}
                    {lista.length > 80 && <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>…y {lista.length - 80} más (afiná el período)</div>}
                  </div>
                </div>
              ))}
              {comprasPend.length === 0 && ventasPend.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--green)' }}>✓ Sin pendientes en este período.</div>
              )}
              {sinDatosPend.length > 0 && (
                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                  <button className="btn btn-ghost btn-xs" onClick={() => setVerSinDatos(v => !v)}>
                    {verSinDatos ? '▲' : '▼'} {sinDatosPend.length} factura(s) sin detalle de ítems (la heurística no puede opinar)
                  </button>
                  {verSinDatos && (
                    <div style={{ display: 'grid', gap: 3, marginTop: 5, maxHeight: 160, overflow: 'auto' }}>
                      {sinDatosPend.slice(0, 60).map(m => (
                        <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span>{m.document_number || 's/n'} · {m.date || ''} · {(m.third_party_name || '').slice(0, 40)}</span>
                          {canWrite && <button className="btn btn-ghost btn-xs" disabled={busy} onClick={() => marcarGuiaEstado(m, 'no_requiere')}>✕ No requiere</button>}
                          {canWrite && <button className="btn btn-ghost btn-xs" disabled={busy} title="Sí lleva guía — mantener en la lista" onClick={() => marcarGuiaEstado(m, 'requiere')}>⚑ Sí requiere</button>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {noRequiereList.length > 0 && (
                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                  <button className="btn btn-ghost btn-xs" onClick={() => setVerNoRequiere(v => !v)}>
                    {verNoRequiere ? '▲' : '▼'} 🚫 {noRequiereList.length} marcada(s) "no requiere" — deshacer acá
                  </button>
                  {verNoRequiere && (
                    <div style={{ display: 'grid', gap: 3, marginTop: 5, maxHeight: 160, overflow: 'auto' }}>
                      {noRequiereList.slice(0, 60).map(m => (
                        <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span>{m.document_number || 's/n'} · {m.date || ''} · {(m.third_party_name || '').slice(0, 40)}</span>
                          {canWrite && <button className="btn btn-ghost btn-xs" disabled={busy} title="Quitar la marca — vuelve a decidir la heurística" onClick={() => marcarGuiaEstado(m, null)}>↩ Deshacer</button>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {filtradas.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="truck" size={36} color="var(--tm)" />
          <p>Sin guías aún. Subílas en ✨ Captura Mágica — las detecta y las enlaza a su factura.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th style={{ width: 130 }}>Guía</th>
                <th>Emisor</th>
                <th>Traslado</th>
                <th style={{ width: 140 }}>Doc. Ref.</th>
                <th style={{ width: 210 }}>Factura vinculada</th>
                <th style={{ width: 90 }}></th>
              </tr></thead>
              <tbody>
                {filtradas.map(g => {
                  const mov = g.accounting_movement_id ? movById.get(g.accounting_movement_id) : null;
                  return (
                    <tr key={g.id}>
                      <td style={{ fontWeight: 600, fontSize: 12 }}>{g.serie_correlativo || '—'}
                        <div style={{ fontSize: 10, color: 'var(--tm)' }}>{g.fecha_emision || ''}</div>
                        {(() => { const o = ORIGEN_BADGE[origenDe.get(g.id)] || ORIGEN_BADGE.desconocida;
                          return <span className={`badge ${o.cls}`} style={{ fontSize: 8.5 }} title={o.title}>{o.label}</span>; })()}
                      </td>
                      <td style={{ fontSize: 11.5 }}>{g.emisor_razon_social || '—'}
                        {g.obra_id && <div style={{ fontSize: 10, color: 'var(--tm)' }}>🏗 {String(obraNombre(g.obra_id)).slice(0, 40)}</div>}
                      </td>
                      <td style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                        {(g.punto_partida || g.punto_llegada) ? `${String(g.punto_partida || '?').slice(0, 28)} → ${String(g.punto_llegada || '?').slice(0, 28)}` : '—'}
                        {g.fecha_traslado && <div>traslado {g.fecha_traslado}</div>}
                      </td>
                      <td style={{ fontSize: 11.5 }}>{g.doc_referencia || '—'}</td>
                      <td>
                        {mov ? (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <button className="btn btn-ghost btn-xs" title="Ir a la factura en Movimientos Contables" onClick={() => verFactura(g)}>
                              🧾 {mov.document_number || 'factura'} · S/ {Number(mov.amount || 0).toLocaleString('es-PE')}
                            </button>
                            {canWrite && <button className="btn btn-ghost btn-xs" style={{ color: 'var(--tm)' }} title="Quitar vínculo" disabled={busy} onClick={() => setVinculo(g, null)}>✕</button>}
                          </div>
                        ) : canWrite ? (
                          <button className="btn btn-amber btn-xs" disabled={busy} onClick={() => setVincular(g)}>
                            <JxIcon name="link" size={10} /> Vincular factura
                          </button>
                        ) : <span style={{ fontSize: 10.5, color: 'var(--amber)' }}>sin vincular</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-ghost btn-xs" title="Ver el PDF de la guía" onClick={() => abrirEvidencia(g)}>📎</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {vincular && (() => {
        const { lista, sugerido } = candidatosDe(vincular);
        return (
          <window.Modal title={`Vincular guía ${vincular.serie_correlativo || ''} a su factura`} icon="link" onClose={() => setVincular(null)}>
            <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 10 }}>
              Referencia impresa en la guía: <strong>{vincular.doc_referencia || '—'}</strong>. Elegí la factura registrada en Movimientos:
            </div>
            <div style={{ maxHeight: 300, overflow: 'auto', display: 'grid', gap: 4 }}>
              {lista.map(({ m, pri }) => (
                <button key={m.id} className="btn btn-ghost btn-xs" style={{ justifyContent: 'flex-start', textAlign: 'left', height: 'auto', whiteSpace: 'normal', ...(m.id === sugerido ? { border: '1px solid var(--green)' } : {}) }}
                  disabled={busy} onClick={() => setVinculo(vincular, m.id)}>
                  {m.id === sugerido && <span className="badge b-green" style={{ fontSize: 8.5, marginRight: 5 }}>sugerida</span>}
                  <span style={{ fontWeight: 600 }}>{m.document_number || 's/n'}</span>
                  <span style={{ color: 'var(--tm)', marginLeft: 6 }}>{m.third_party_name || ''} · {m.date || ''} · S/ {Number(m.amount || 0).toLocaleString('es-PE')}</span>
                </button>
              ))}
              {lista.length === 0 && <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>No hay movimientos con documento registrado.</span>}
            </div>
          </window.Modal>
        );
      })()}

      {/* Camino INVERSO (panel "requieren guía"): elegir una guía suelta para
          esta factura. Sugiere por referencia exacta y descarta RUC contradicho. */}
      {buscarGuiaPara && (() => {
        const cands = sugerirGuiasParaFactura(buscarGuiaPara, guias, rucsGrupo);
        return (
          <window.Modal title={`Vincular una guía a ${buscarGuiaPara.document_number || 'la factura'}`} icon="link" onClose={() => setBuscarGuiaPara(null)}>
            <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 10 }}>
              {buscarGuiaPara.third_party_name || ''} · {buscarGuiaPara.date || ''} · Guías SIN vincular: {cands.length}
            </div>
            <div style={{ maxHeight: 300, overflow: 'auto', display: 'grid', gap: 4 }}>
              {cands.map(({ guia: g, pri }) => (
                <button key={g.id} className="btn btn-ghost btn-xs" style={{ justifyContent: 'flex-start', textAlign: 'left', height: 'auto', whiteSpace: 'normal', ...(pri >= 2 ? { border: '1px solid var(--green)' } : {}) }}
                  disabled={busy} onClick={async () => { await setVinculo(g, buscarGuiaPara.id); setBuscarGuiaPara(null); }}>
                  {pri >= 2 && <span className="badge b-green" style={{ fontSize: 8.5, marginRight: 5 }}>coincide ref.</span>}
                  <span style={{ fontWeight: 600 }}>{g.serie_correlativo || 's/n'}</span>
                  <span style={{ color: 'var(--tm)', marginLeft: 6 }}>{g.emisor_razon_social || ''} · {g.fecha_emision || ''} · ref {g.doc_referencia || '—'}</span>
                </button>
              ))}
              {cands.length === 0 && (
                <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>
                  No hay guías sueltas que puedan corresponderle. Cuando llegue, subila por ✨ Captura Mágica — se vincula sola o desde acá.
                </span>
              )}
            </div>
          </window.Modal>
        );
      })()}
    </div>
  );
}

Object.assign(window, { GuiasRemisionPage });
export { GuiasRemisionPage };
