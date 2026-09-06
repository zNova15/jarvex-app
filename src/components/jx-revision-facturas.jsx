// ═══════════════════════════════════════════════════════════════════
// JARVEX — REVISIÓN DE FACTURAS (tanda 7).
//
// La pantalla del escáner. Toda la decisión de QUÉ está mal vive en
// src/lib/revision-facturas.js (pura, 35 tests); acá solo se pinta y se
// descarta.
//
// Archivo aparte a propósito: `jx-contabilidad.jsx` ya tiene 7.310 líneas y la
// inspección del 6-sep lo marcó como lo primero que hay que dejar de engordar.
// Se importa estático desde ahí, así que no crea un chunk nuevo.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import {
  revisarLote, resumenRevision, claveDescarte, REGLAS, NIVEL,
} from "../lib/revision-facturas.js";
import { itemsDeFactura } from "../lib/cruce-recepcion.js";
import { sugerirCodigoSpot } from "../lib/sugerir-codigo-spot.js";

const { useState, useMemo } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const Modal = (p) => (window.Modal ? <window.Modal {...p} /> : null);

const fmt = (n, mon = 'PEN') =>
  (mon === 'USD' ? '$ ' : 'S/ ') + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * @param movs        todos los movimientos vivos
 * @param descartes   filas de revision_descartes
 * @param onAbrirMov  (movimiento) => void — lleva al comprobante y cierra esto
 * @param canWrite    si puede marcar «está bien»
 */
function RevisionFacturasModal({ movs, descartes, companies, onClose, onAbrirMov, canWrite, showToast }) {
  const [verNivel, setVerNivel] = useState(NIVEL.CONTRADICCION);
  const [guardando, setGuardando] = useState(null);

  const hoy = (() => { try { return window.__fecha?.hoyLocal?.() || null; } catch { return null; } })();

  const descartados = useMemo(() => new Set(
    (descartes || []).filter(d => !d.deleted_at).map(d => claveDescarte(d.movimiento_id, d.regla))
  ), [descartes]);

  const movsById = useMemo(() => new Map((movs || []).map(m => [m.id, m])), [movs]);
  const hallazgos = useMemo(
    () => revisarLote(movs || [], { hoy, descartados }),
    [movs, hoy, descartados]
  );
  const resumen = useMemo(() => resumenRevision(hallazgos), [hallazgos]);
  const visibles = hallazgos.filter(h => h.nivel === verNivel);

  const nombreEmpresa = (id) => (companies || []).find(c => c.id === id)?.name || '—';

  // «Está bien»: se guarda la decisión humana, no el hallazgo. La próxima
  // pasada lo recalcula igual y lo salta por esta fila.
  const marcarRevisado = async (h) => {
    if (!canWrite || guardando) return;
    setGuardando(claveDescarte(h.movimiento_id, h.regla));
    try {
      const now = new Date().toISOString();
      const userId = window.__useAuth?.()?.profile?.id || null;
      const id = window.__newId();
      await window.__db.revision_descartes.add({
        id,
        movimiento_id: h.movimiento_id,
        regla: h.regla,
        motivo: null,
        version: 1,
        created_at: now, updated_at: now,
        created_by: userId, updated_by: userId,
        deleted_at: null,
        idempotency_key: `${userId || 'offline'}_revdesc_${id}`,
        last_synced_at: null,
        sync_status: 'pending_create',
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'revision_descartes' } })); } catch {}
      showToast?.('Marcado como revisado', 'green');
    } catch (e) {
      showToast?.('No se pudo guardar: ' + (e.message || e), 'red');
    } finally { setGuardando(null); }
  };

  const Pestaña = ({ nivel, label, n, color }) => (
    <button className={`btn btn-sm ${verNivel === nivel ? 'btn-amber' : 'btn-ghost'}`}
      onClick={() => setVerNivel(nivel)}>
      {label} <span className={`badge ${color}`} style={{ marginLeft: 4, fontSize: 9.5 }}>{n}</span>
    </button>
  );

  return (
    <Modal title="Revisión de facturas" icon="search" size="xl" onClose={onClose}>
      <div style={{ fontSize: 12, color: 'var(--tm)', marginBottom: 12 }}>
        Se revisan los {(movs || []).length} comprobantes cada vez que abrís esta pantalla: no hay
        nada guardado que pueda quedar viejo. Lo único que se recuerda es lo que marques como revisado.
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <Pestaña nivel={NIVEL.CONTRADICCION} label="Se contradicen" n={resumen.contradicciones} color="b-red" />
        <Pestaña nivel={NIVEL.REVISAR} label="Para revisar" n={resumen.revisar} color="b-amber" />
      </div>

      <div className="card card-p" style={{ marginBottom: 12, fontSize: 11.5, color: 'var(--ts)',
        borderLeft: `3px solid ${verNivel === NIVEL.CONTRADICCION ? 'var(--red)' : 'var(--amber)'}` }}>
        {verNivel === NIVEL.CONTRADICCION
          ? <>El comprobante <strong>se desmiente a sí mismo</strong>: la cuenta no cierra, o el código no existe.
             No hace falta criterio contable para saber que hay que corregirlo.</>
          : <>Esto <strong>puede estar perfectamente bien</strong> — una factura exonerada no lleva IGV al 18%.
             Decidís vos: si está bien, marcalo y no vuelve a aparecer.</>}
      </div>

      {visibles.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="checkCircle" size={34} color="var(--green)" />
          <p>{verNivel === NIVEL.CONTRADICCION
            ? 'Ningún comprobante se contradice. Los números cierran.'
            : 'No queda nada por revisar.'}</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8, maxHeight: '58vh', overflowY: 'auto' }}>
          {visibles.map(h => {
            const m = movsById.get(h.movimiento_id);
            const k = claveDescarte(h.movimiento_id, h.regla);
            return (
              <div key={k} className="card card-p" style={{ border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 260 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--tp)' }}>{h.titulo}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ts)', marginTop: 3 }}>{h.detalle}</div>
                    {h.sugerencia && (
                      <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 3, fontStyle: 'italic' }}>{h.sugerencia}</div>
                    )}
                    {/* Sugerencia de CÓDIGO (tanda 7, entrega 3), solo para el
                        hallazgo al que le falta el código — no inventa una
                        tasa cuando es ambigua (el caso del alquiler).
                        src/lib/sugerir-codigo-spot.js. */}
                    {h.regla === 'detraccion-sin-codigo' && m && (() => {
                      const primerItem = (itemsDeFactura(m) || [])[0] || null;
                      const sug = sugerirCodigoSpot(primerItem?.descripcion || m.description || '', {
                        tipoInsumo: primerItem?.tipo_insumo, tasaActual: m.detraccion_pct,
                      });
                      if (!sug) return null;
                      return (
                        <div style={{ fontSize: 11, color: 'var(--ts)', marginTop: 5, padding: '5px 8px',
                          borderLeft: `2px solid ${sug.confianza === 'alta' ? 'var(--blue)' : 'var(--amber)'}` }}>
                          Código sugerido: <strong>{sug.codigo}</strong>
                          {sug.tasaUnica != null ? <> al <strong>{sug.tasaUnica}%</strong></> : <> (la tasa depende del proveedor, revisala aparte)</>}
                          {sug.confianza === 'media' && <span className="badge b-gray" style={{ marginLeft: 5, fontSize: 9 }}>confirmá</span>}
                        </div>
                      );
                    })()}
                    <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 6 }}>
                      {m?.document_type || 'doc'} <strong>{m?.document_number || '—'}</strong>
                      {' · '}{m?.date || '—'}
                      {' · '}{nombreEmpresa(m?.company_id)}
                      {' · '}<strong style={{ color: 'var(--tp)' }}>{fmt(m?.amount, m?.currency)}</strong>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {m && (
                      <button className="btn btn-ghost btn-sm" onClick={() => onAbrirMov?.(m)}
                        title="Ir al comprobante para corregirlo">
                        Ver el comprobante <JxIcon name="chevR" size={12} />
                      </button>
                    )}
                    {canWrite && (
                      <button className="btn btn-ghost btn-sm" disabled={guardando === k}
                        onClick={() => marcarRevisado(h)}
                        title="No vuelve a aparecer para este comprobante y este motivo">
                        {guardando === k ? 'Guardando…' : '✓ Está bien'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <details style={{ marginTop: 14, fontSize: 11.5, color: 'var(--tm)' }}>
        <summary style={{ cursor: 'pointer' }}>Qué se revisa ({REGLAS.length} reglas)</summary>
        <ul style={{ margin: '8px 0 0 18px', display: 'grid', gap: 4 }}>
          {REGLAS.map(r => (
            <li key={r.id}>
              <strong style={{ color: 'var(--ts)' }}>{r.titulo}</strong>
              {' — '}{r.nivel === NIVEL.CONTRADICCION ? 'se contradice' : 'para revisar'}
              {resumen.porRegla[r.id] ? ` · ${resumen.porRegla[r.id]} caso(s)` : ' · sin casos'}
            </li>
          ))}
        </ul>
      </details>
    </Modal>
  );
}

Object.assign(window, { RevisionFacturasModal });
export { RevisionFacturasModal };
