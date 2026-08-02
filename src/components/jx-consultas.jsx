// ═══════════════════════════════════════════════════════════════════
// JARVEX — Panel de Consultas ALMACÉN ↔ CONTABILIDAD (Fase 2 del puente)
//
// Hilo dirigido y bidireccional: una parte pregunta con referencia exacta
// (sin costos) por un insumo/factura; la otra responde Sí/Parcial/No/Otra fecha.
// Componente compartido: se monta desde jx-contabilidad y jx-movimientos.
// Modal/JxIcon son globales (window.*) — se usan con el wrapper de siempre.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { responderConsulta, cerrarConsulta, RESPUESTA_TIPOS, RESPUESTA_LABEL } from "../lib/consultas-puente.js";

const { useState, useMemo } = React;
const Modal = (p) => (window.Modal ? <window.Modal {...p} /> : null);
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

/**
 * Resumen de consultas desde la perspectiva de un rol ('almacen'|'contabilidad').
 * paraResponder = las que preguntó LA OTRA parte y siguen abiertas.
 * mias = las que envió este rol. `pendientes` alimenta el badge del botón.
 */
export function useConsultasResumen(rol, obraId) {
  // Llamada INCONDICIONAL (regla de hooks): __hooks se define en main.jsx al
  // arrancar, igual que el resto de páginas que llaman window.__hooks.useX().
  const { data: consultas } = window.__hooks.useConsultasPuente(obraId);
  const otro = rol === 'almacen' ? 'contabilidad' : 'almacen';
  return useMemo(() => {
    const arr = consultas || [];
    const paraResponder = arr.filter(c => c.origen === otro && c.estado === 'abierta');
    const mias = arr.filter(c => c.origen === rol);
    return { todas: arr, paraResponder, mias, pendientes: paraResponder.length };
  }, [consultas, rol, otro]);
}

// Referencia SIN costos (snapshot guardado en la consulta). OJO: NO usar `ref`
// como nombre de prop (React lo intercepta) → `datos`.
function Referencia({ datos: r }) {
  if (!r || typeof r !== 'object') return null;
  const insumos = Array.isArray(r.insumos) ? r.insumos
    : (r.descripcion ? [{ descripcion: r.descripcion, cantidad: r.cantidad, unidad: r.unidad }] : []);
  return (
    <div style={{ background:'var(--bg-s)', border:'1px solid var(--bd)', borderRadius:6, padding:'6px 10px', fontSize:11.5, marginTop:5 }}>
      {r.documento && <div><strong>{r.documento}</strong>{r.proveedor ? ` · ${r.proveedor}` : ''}{r.fecha ? ` · ${r.fecha}` : ''}</div>}
      {insumos.map((it, i) => <div key={i} style={{ color:'var(--ts)' }}>• {it.descripcion} · {it.cantidad} {it.unidad || ''}</div>)}
    </div>
  );
}

function ResponderBox({ consulta, showToast }) {
  const [tipo, setTipo] = useState('');
  const [txt, setTxt] = useState('');
  const [busy, setBusy] = useState(false);
  const enviar = async () => {
    if (!tipo) { showToast?.('Elegí una respuesta', 'red'); return; }
    setBusy(true);
    try {
      await responderConsulta(consulta.id, { respuesta_tipo: tipo, respuesta: txt });
      showToast?.('Respuesta enviada', 'green');
    } catch (e) { showToast?.('Error: ' + (e?.message || e), 'red'); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ marginTop:8 }}>
      <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:6 }}>
        {RESPUESTA_TIPOS.map(r => (
          <button key={r.value} className={tipo === r.value ? 'btn btn-amber btn-xs' : 'btn btn-ghost btn-xs'} onClick={() => setTipo(r.value)}>{r.label}</button>
        ))}
      </div>
      <textarea className="fi" rows={2} placeholder="Detalle opcional (ej. llegó el 5-jul al almacén central, 18 de 20)…" value={txt} onChange={e => setTxt(e.target.value)} />
      <div style={{ display:'flex', justifyContent:'flex-end', marginTop:6 }}>
        <button className="btn btn-green btn-sm" disabled={busy} onClick={enviar}><JxIcon name="check" size={12} /> Responder</button>
      </div>
    </div>
  );
}

/** Panel completo (modal): responder lo entrante + ver mis consultas y sus respuestas. */
export function ConsultasPanel({ rol, obraId, onClose, showToast }) {
  const { paraResponder, mias } = useConsultasResumen(rol, obraId);
  const st = showToast || window.__showToast || (() => {});
  const otroNombre = rol === 'almacen' ? 'contabilidad' : 'almacén';
  return (
    <Modal title="Consultas · Almacén ↔ Contabilidad" icon="users" onClose={onClose}>
      <div style={{ fontSize:10.5, fontWeight:700, color:'var(--tm)', letterSpacing:'.06em', marginBottom:6 }}>
        PARA RESPONDER ({paraResponder.length})
      </div>
      {paraResponder.length === 0 ? (
        <p style={{ fontSize:12, color:'var(--tm)', marginBottom:16 }}>No hay consultas esperando tu respuesta.</p>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:18 }}>
          {paraResponder.map(c => (
            <div key={c.id} className="card card-p" style={{ padding:'10px 12px' }}>
              <div style={{ fontSize:12.5, color:'var(--tp)' }}>{c.pregunta}</div>
              <Referencia datos={c.referencia} />
              <ResponderBox consulta={c} showToast={st} />
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize:10.5, fontWeight:700, color:'var(--tm)', letterSpacing:'.06em', marginBottom:6 }}>
        MIS CONSULTAS A {otroNombre.toUpperCase()} ({mias.length})
      </div>
      {mias.length === 0 ? (
        <p style={{ fontSize:12, color:'var(--tm)' }}>Todavía no enviaste consultas. Usá el botón 🔎 sobre una factura o un ingreso para preguntar con la referencia exacta.</p>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight:'40vh', overflowY:'auto' }}>
          {mias.map(c => (
            <div key={c.id} className="card card-p" style={{ padding:'8px 12px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', gap:8 }}>
                <div style={{ fontSize:12, color:'var(--tp)', flex:1 }}>{c.pregunta}</div>
                <span className={`badge ${c.estado === 'respondida' ? 'b-green' : c.estado === 'cerrada' ? 'b-gray' : 'b-amber'}`}>{c.estado}</span>
              </div>
              <Referencia datos={c.referencia} />
              {c.estado === 'respondida' && (
                <div style={{ marginTop:6, fontSize:12, color:'var(--ts)' }}>
                  Respuesta: <strong>{RESPUESTA_LABEL[c.respuesta_tipo] || c.respuesta_tipo || '—'}</strong>
                  {c.respuesta ? ` · ${c.respuesta}` : ''}
                  <button className="btn btn-ghost btn-xs" style={{ marginLeft:8 }} onClick={() => cerrarConsulta(c.id)}>Archivar</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="modal-actions" style={{ marginTop:14 }}>
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </div>
    </Modal>
  );
}
