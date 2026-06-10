// ═══════════════════════════════════════════════════════════════════
// JARVEX — Modal de fusión de personas (SOLO Super Admin)
//
// Caso real: la migración histórica creó "Ing Elvis" (nombre referencial del
// Excel de movimientos) y el roster importó "Elvis Ivan Huatay Quiliche"
// (DNI real). Este modal los fusiona: elegís quién SE VA y quién QUEDA, y qué
// hacer con los movimientos (unión / intersección / solo los del que queda).
// Encadenable: el que queda puede volver a fusionarse con otro nombre.
//
// Usa Modal / JxIcon / SearchableSelect (globales).
// ═══════════════════════════════════════════════════════════════════

import React from "react";
import { previewFusion, fusionarPersonas, sugerirFusiones } from "../lib/fusion-personas.js";

const { useState: uS, useMemo: uM, useEffect: uE } = React;

const MODOS = [
  { id: 'union', titulo: 'Unión (recomendado)', icono: '∪',
    desc: 'El que queda se lleva TODOS los movimientos de ambos. Si un movimiento estaba anotado bajo los dos nombres (mismo insumo, fecha, tipo y cantidad), queda una sola copia.' },
  { id: 'interseccion', titulo: 'Solo la intersección', icono: '∩',
    desc: 'Quedan ÚNICAMENTE los registros que estaban bajo AMBOS nombres (duplicados exactos) — esto incluye la ASISTENCIA. Todo lo que estaba bajo un solo nombre se ELIMINA. Usalo solo si ambos nombres registraban lo mismo por partida doble.' },
  { id: 'solo_destino', titulo: 'Solo los del que queda', icono: '→',
    desc: 'Se conservan los movimientos y la asistencia del que QUEDA; los del que se va se ELIMINAN. Usalo si los registros del nombre referencial eran erróneos.' },
];

export function FusionPersonasModal({ personal, showToast, onClose, onDone }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const userId = auth?.profile?.id || null;
  const [fromId, setFromId] = uS('');
  const [toId, setToId] = uS('');
  const [modo, setModo] = uS('union');
  const [prev, setPrev] = uS(null);      // resultado de previewFusion
  const [cargandoPrev, setCargandoPrev] = uS(false);
  const [busy, setBusy] = uS(false);

  const vivos = uM(() => (personal || []).filter(p => !p.deleted_at), [personal]);
  const nombreDe = (id) => { const p = vivos.find(x => x.id === id); return p ? `${p.nombres} ${p.apellidos || ''}`.trim() : ''; };
  const opciones = uM(() => vivos
    .slice().sort((a, b) => `${a.nombres} ${a.apellidos}`.localeCompare(`${b.nombres} ${b.apellidos}`))
    .map(p => ({ value: p.id, label: `${p.nombres} ${p.apellidos || ''} · ${p.dni || 's/doc'}${/^(MIG-|RES-)/.test(p.dni || '') ? ' (referencial)' : ''}` })), [vivos]);

  // Sugerencias automáticas: placeholders de la migración vs roster real.
  const sugerencias = uM(() => sugerirFusiones(vivos).slice(0, 6), [vivos]);

  // Preview en vivo cuando hay par elegido.
  uE(() => {
    let cancel = false;
    setPrev(null);
    if (!fromId || !toId || fromId === toId) return;
    setCargandoPrev(true);
    previewFusion(fromId, toId)
      .then(r => { if (!cancel) setPrev(r); })
      .catch(() => {})
      .finally(() => { if (!cancel) setCargandoPrev(false); });
    return () => { cancel = true; };
  }, [fromId, toId]);

  const totalA = (prev?.movs || []).reduce((s, m) => s + m.deA, 0);
  const totalB = (prev?.movs || []).reduce((s, m) => s + m.deB, 0);
  const totalResultado = (prev?.movs || []).reduce((s, m) => s + m[modo], 0);
  const totalEliminados = totalA + totalB - totalResultado;

  const ejecutar = async () => {
    if (busy) return;
    if (!fromId || !toId || fromId === toId) { showToast('Elegí dos personas distintas', 'red'); return; }
    const msg = `FUSIONAR:\n\n• "${nombreDe(fromId)}" SE VA (queda eliminado)\n• "${nombreDe(toId)}" QUEDA con sus movimientos según el modo "${MODOS.find(m => m.id === modo)?.titulo}"\n${totalEliminados > 0 ? `• Se eliminarán ${totalEliminados} registro(s) (movimientos/asistencia)\n` : ''}\n¿Confirmar? Esta acción queda en auditoría.`;
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      const r = await fusionarPersonas({ fromId, toId, modo, userId });
      showToast(`✓ Fusión lista: ${r.reatribuidos} movimientos re-atribuidos · ${r.unificados} unificados · ${r.eliminados} eliminados · ${r.punteros} referencias re-apuntadas`, 'green');
      onDone?.();
      // Encadenable: dejamos el modal abierto con el sobreviviente preseleccionado
      // como destino, listo para fusionar otro nombre si hace falta.
      setFromId(''); setPrev(null);
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Fusionar nombres (Super Admin)" icon="users" onClose={onClose} size="wide">
      <div style={{ fontSize: 12.5, color: 'var(--ts)', marginBottom: 12, lineHeight: 1.5 }}>
        Junta dos nombres que son la <strong>misma persona</strong> (ej. el referencial <em>"Ing Elvis"</em> de la migración y el real <em>"Elvis Ivan Huatay Quiliche"</em> del roster). Todos sus movimientos, asistencias y cuentas quedan bajo uno solo.
      </div>

      {sugerencias.length > 0 && !fromId && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--tm)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Sugerencias detectadas</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sugerencias.map((s, i) => (
              <button key={i} className="btn btn-ghost" style={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 12 }}
                onClick={() => { setFromId(s.from.id); setToId(s.to.id); }}>
                <JxIcon name="compare" size={12}/> <span style={{ color: 'var(--amber)' }}>{s.from.nombres} {s.from.apellidos || ''}</span>
                <span style={{ color: 'var(--tm)' }}>&nbsp;→&nbsp;</span>
                <span style={{ color: 'var(--green)' }}>{s.to.nombres} {s.to.apellidos || ''}</span>
                <span style={{ color: 'var(--tm)', marginLeft: 6, fontSize: 10.5 }}>({s.to.dni})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="g2">
        <div>
          <label className="flabel">Se va (nombre referencial) *</label>
          <SearchableSelect value={fromId} onChange={v => setFromId(v)} options={[{ value: '', label: '— Selecciona —' }, ...opciones]} placeholder="— Selecciona —"/>
        </div>
        <div>
          <label className="flabel">Queda (nombre real) *</label>
          <SearchableSelect value={toId} onChange={v => setToId(v)} options={[{ value: '', label: '— Selecciona —' }, ...opciones.filter(o => o.value !== fromId)]} placeholder="— Selecciona —"/>
        </div>
      </div>

      {fromId && toId && fromId !== toId && (
        <>
          <div style={{ marginTop: 12 }}>
            <label className="flabel">¿Qué hacemos con los movimientos?</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {MODOS.map(m => (
                <label key={m.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, cursor: 'pointer',
                  border: `1.5px solid ${modo === m.id ? 'var(--amber)' : 'var(--border)'}`, borderRadius: 8,
                  background: modo === m.id ? 'rgba(242,183,5,0.06)' : 'transparent' }}>
                  <input type="radio" checked={modo === m.id} onChange={() => setModo(m.id)} style={{ marginTop: 2 }}/>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)' }}>{m.icono} {m.titulo}
                      {prev && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--amber)' }}>→ quedan {(prev.movs || []).reduce((s, x) => s + x[m.id], 0)} movimientos</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--tm)', marginTop: 2, lineHeight: 1.45 }}>{m.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {cargandoPrev && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--tm)' }}>Contando movimientos…</div>}
          {prev && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--tm)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
                Qué hay bajo cada nombre
              </div>
              {prev.movs.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--tm)' }}>Ninguno de los dos tiene movimientos — la fusión solo re-apunta datos (cuentas, asistencia, etc.) y elimina el duplicado.</div>
              ) : (
                <table className="tbl" style={{ fontSize: 11.5 }}>
                  <thead><tr><th>Categoría</th><th style={{ textAlign: 'right' }}>{nombreDe(fromId).split(' ')[0]} (se va)</th><th style={{ textAlign: 'right' }}>{nombreDe(toId).split(' ')[0]} (queda)</th><th style={{ textAlign: 'right' }}>Duplicados</th><th style={{ textAlign: 'right' }}>Quedarán</th></tr></thead>
                  <tbody>
                    {prev.movs.map(m => (
                      <tr key={m.tabla}>
                        <td>{m.label}</td>
                        <td style={{ textAlign: 'right' }}>{m.deA}</td>
                        <td style={{ textAlign: 'right' }}>{m.deB}</td>
                        <td style={{ textAlign: 'right', color: m.duplicados ? 'var(--amber)' : 'var(--tm)' }}>{m.duplicados}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{m[modo]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {prev.punteros.length > 0 && (
                <div style={{ fontSize: 11.5, color: 'var(--tm)', marginTop: 8 }}>
                  Además se re-apuntan: {prev.punteros.map(p => `${p.label} (${p.deA})`).join(' · ')}.
                </div>
              )}
              {totalEliminados > 0 && (
                <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: 6, fontSize: 12, color: 'var(--ts)' }}>
                  ⚠ Con el modo elegido se eliminarán <strong>{totalEliminados}</strong> movimiento(s) de los {totalA + totalB} totales.
                </div>
              )}
            </div>
          )}
        </>
      )}

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cerrar</button>
        <button className="btn btn-amber" onClick={ejecutar} disabled={busy || !fromId || !toId || fromId === toId || cargandoPrev}>
          <JxIcon name="compare" size={13}/> {busy ? 'Fusionando…' : 'Fusionar'}
        </button>
      </div>
    </Modal>
  );
}
