// ═══════════════════════════════════════════════════════════════════
// JARVEX — Modal de fusión de EMPRESAS / PROVEEDORES duplicados.
//
// Detecta automáticamente registros que comparten el mismo RUC (normalizado) y
// permite fusionarlos: elegís cuál QUEDA y el resto se absorbe (sus facturas,
// movimientos, cuentas, etc. se re-apuntan al que queda). También fusión manual
// para casos sin RUC. Personal tiene su propio modal (FusionPersonasModal).
//
// Usa Modal / JxIcon / SearchableSelect (globales).
// ═══════════════════════════════════════════════════════════════════

import React from "react";
import { previewFusionEntidad, fusionarEntidad, gruposDuplicadosPorRuc, FUSION_CONFIG } from "../lib/fusion-entidad.js";

const { useState: uS, useMemo: uM, useEffect: uE } = React;

export function FusionEntidadModal({ tipo, registros, showToast, onClose, onDone }) {
  const cfg = FUSION_CONFIG[tipo] || FUSION_CONFIG.proveedores;
  const toast = showToast || window.__showToast || (() => {});
  const auth = window.__useAuth ? window.__useAuth() : null;
  const userId = auth?.profile?.id || null;

  const vivos = uM(() => (registros || []).filter(r => !r.deleted_at), [registros]);
  const nombreDe = (id) => { const r = vivos.find(x => x.id === id); return r ? (r[cfg.nombreField] || id) : ''; };
  const grupos = uM(() => gruposDuplicadosPorRuc(vivos, cfg.rucField), [vivos]);

  // Survivor elegido por grupo (default: el primero "activo" o el primero).
  const [survivorPorRuc, setSurvivorPorRuc] = uS({});
  const survivorDe = (g) => survivorPorRuc[g.ruc]
    || (g.registros.find(r => r.status === 'activa' || r.estado === 'activo') || g.registros[0]).id;

  const [fromId, setFromId] = uS('');
  const [toId, setToId] = uS('');
  const [prev, setPrev] = uS(null);
  const [busy, setBusy] = uS(false);

  uE(() => {
    let c = false; setPrev(null);
    if (!fromId) return;
    previewFusionEntidad(tipo, fromId).then(r => { if (!c) setPrev(r); }).catch(() => {});
    return () => { c = true; };
  }, [fromId, tipo]);

  const fusionarPar = async (fId, tId) => {
    if (!fId || !tId || fId === tId) { toast('Elegí dos registros distintos', 'red'); return null; }
    const r = await fusionarEntidad({ tipo, fromId: fId, toId: tId, userId });
    return r;
  };

  const fusionarGrupo = async (g) => {
    const tId = survivorDe(g);
    const otros = g.registros.filter(r => r.id !== tId);
    if (!otros.length) return;
    if (!confirm(`Fusionar ${otros.length} ${cfg.label}(s) dentro de "${nombreDe(tId)}"?\nSus facturas/movimientos se re-apuntan y los duplicados quedan eliminados.`)) return;
    setBusy(true);
    try {
      let tot = 0;
      for (const o of otros) { const r = await fusionarPar(o.id, tId); tot += r?.reapuntados || 0; }
      toast(`Fusionados ${otros.length} · ${tot} referencias re-apuntadas`, 'green');
      onDone && onDone();
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  const fusionarManual = async () => {
    if (!confirm(`Fusionar "${nombreDe(fromId)}" dentro de "${nombreDe(toId)}"?\nLa primera quedará eliminada y todo lo suyo pasará a la segunda.`)) return;
    setBusy(true);
    try {
      const r = await fusionarPar(fromId, toId);
      toast(`Fusionado · ${r?.reapuntados || 0} referencias re-apuntadas`, 'green');
      setFromId(''); setToId('');
      onDone && onDone();
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  const opciones = uM(() => vivos
    .slice().sort((a, b) => String(a[cfg.nombreField] || '').localeCompare(String(b[cfg.nombreField] || '')))
    .map(r => ({ value: r.id, label: `${r[cfg.nombreField] || '(s/nombre)'} · ${r[cfg.rucField] || 's/RUC'}` })), [vivos, cfg]);

  return (
    <Modal title={`Fusionar ${cfg.label === 'empresa' ? 'empresas' : 'proveedores'} duplicados`} icon="compare" onClose={onClose} wide>
      <div style={{ fontSize: 12, color: 'var(--tm)', marginBottom: 12 }}>
        La identidad es el <strong>RUC</strong>, no el nombre. Acá ves los que comparten RUC (aunque el nombre esté en mayúsculas/minúsculas distintas). Elegí cuál queda y fusioná — sus facturas y movimientos se re-apuntan solos.
      </div>

      {/* Sugerencias por RUC duplicado */}
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ts)', marginBottom: 8 }}>
        Duplicados por RUC ({grupos.length})
      </div>
      {grupos.length === 0 ? (
        <div className="card card-p" style={{ marginBottom: 14, fontSize: 12, color: 'var(--tm)' }}>
          ✅ No hay {cfg.label === 'empresa' ? 'empresas' : 'proveedores'} con el mismo RUC. Si igual sabés de un duplicado (ej. sin RUC), usá la fusión manual de abajo.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
          {grupos.map(g => {
            const surv = survivorDe(g);
            return (
              <div key={g.ruc} className="card card-p">
                <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 6 }}>RUC <strong style={{ color: 'var(--ts)', fontFamily: 'ui-monospace,monospace' }}>{g.ruc}</strong> · {g.registros.length} registros</div>
                <div style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
                  {g.registros.map(r => (
                    <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
                      <input type="radio" name={`surv_${g.ruc}`} checked={surv === r.id} onChange={() => setSurvivorPorRuc(s => ({ ...s, [g.ruc]: r.id }))} />
                      <span style={{ color: surv === r.id ? 'var(--green)' : 'var(--tp)', fontWeight: surv === r.id ? 700 : 500 }}>
                        {r[cfg.nombreField] || '(sin nombre)'}{surv === r.id && <span style={{ fontSize: 10, marginLeft: 6, color: 'var(--green)' }}>← queda este</span>}
                      </span>
                    </label>
                  ))}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <button className="btn btn-amber btn-sm" disabled={busy} onClick={() => fusionarGrupo(g)}>
                    <JxIcon name="compare" size={12} /> Fusionar en el elegido
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fusión manual */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ts)', marginBottom: 8 }}>Fusión manual</div>
        <div className="g2">
          <div>
            <label className="flabel">Se va (se elimina)</label>
            <SearchableSelect value={fromId} onChange={setFromId} options={opciones.filter(o => o.value !== toId)} placeholder="— Elegí el duplicado —" />
          </div>
          <div>
            <label className="flabel">Queda (absorbe)</label>
            <SearchableSelect value={toId} onChange={setToId} options={opciones.filter(o => o.value !== fromId)} placeholder="— Elegí el que queda —" />
          </div>
        </div>
        {fromId && prev && (
          <div style={{ fontSize: 11.5, color: 'var(--tm)', margin: '8px 0' }}>
            Se re-apuntarán <strong style={{ color: 'var(--ts)' }}>{prev.total}</strong> referencias del que se va{prev.total > 0 ? ` (${prev.detalle.map(d => `${d.n} ${d.tabla.replace('accounting_movements', 'movimientos contables').replace('movimientos_', 'mov. ')}`).join(', ')})` : ''}.
          </div>
        )}
        <div style={{ textAlign: 'right', marginTop: 8 }}>
          <button className="btn btn-amber btn-sm" disabled={busy || !fromId || !toId || fromId === toId} onClick={fusionarManual}>
            <JxIcon name="compare" size={12} /> Fusionar
          </button>
        </div>
      </div>
    </Modal>
  );
}
