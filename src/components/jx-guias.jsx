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
import { matchFacturaDeGuia, normalizarDoc } from "../lib/guias.js";
import { getCurrentMode } from "../lib/app-mode-core.js";

const { useState: uS, useMemo: uM, useEffect: uE } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

function GuiasRemisionPage({ showToast }) {
  const toast = showToast || (() => {});
  const auth = window.__useAuth?.();
  const rol = auth?.profile?.rol;
  const userId = auth?.profile?.id ?? 'offline';
  const canWrite = rol === 'admin' || (window.__hasPerm?.(rol, 'Movs. Contables', 'w') ?? false);
  const { data: movs } = window.__hooks.useAccountingMovements();
  const { data: obras } = window.__hooks.useObras();

  const [guias, setGuias] = uS([]);
  const [q, setQ] = uS(() => {
    // Deep-link desde Movimientos: pre-filtrar por la serie de la guía.
    const intent = window.__guiasFocusIntent;
    if (intent) { window.__guiasFocusIntent = null; return String(intent); }
    return '';
  });
  const [busy, setBusy] = uS(false);
  const [vincular, setVincular] = uS(null);   // guía a vincular manualmente

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

  const filtradas = uM(() => {
    const qn = q.trim().toLowerCase();
    return guias.filter(g => !qn ||
      String(g.serie_correlativo || '').toLowerCase().includes(qn) ||
      String(g.emisor_razon_social || '').toLowerCase().includes(qn) ||
      String(g.doc_referencia || '').toLowerCase().includes(qn));
  }, [guias, q]);

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
      const { getEvidenciaSrc } = await import('../lib/evidencias-url.js');
      const r = await getEvidenciaSrc(ev);
      if (r?.url) window.open(r.url, '_blank');
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
          <div className="pg-sub">{guias.length} guía(s) · cada una vinculada (ida y vuelta) a su factura en Movimientos</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <div className="search-bar" style={{ flex: '1 1 260px' }}>
          <JxIcon name="search" size={14} color="var(--tm)" />
          <input placeholder="Buscar por serie / emisor / referencia…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>

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
    </div>
  );
}

Object.assign(window, { GuiasRemisionPage });
export { GuiasRemisionPage };
