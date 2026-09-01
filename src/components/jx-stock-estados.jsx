// ═══════════════════════════════════════════════════════════════════
// JARVEX — UI de stock por estado/condición (buckets)
//
// EstadosModal: para una herramienta que se maneja por cantidad, reparte su
// stock_actual entre condiciones (Nuevo / Bueno / En reparación / De baja),
// con foto por estado. Sin duplicar el insumo ni renombrarlo. El total por
// estado no puede superar el stock_actual; el resto queda "sin clasificar".
//
// Usa Modal / JxIcon (globales) + helpers de stock-estados.js.
// ═══════════════════════════════════════════════════════════════════

import React from "react";
import { ESTADOS_COND, getEstados, setCantidadEstado, setFotoEstado } from "../lib/stock-estados.js";
import { getEvidenciaSrc, abrirUrlEvidencia } from "../lib/evidencias-url.js";

const { useState: uS, useEffect: uE, useMemo: uM } = React;

export function EstadosModal({ itemTipo = 'herramienta', item, obraId, userId, showToast, onClose, onDone }) {
  const stockTotal = Number(item?.stock_actual || 0);
  const [cant, setCant] = uS(() => ({}));      // estado → string
  const [fotos, setFotos] = uS(() => ({}));    // estado → { url }
  const [loading, setLoading] = uS(true);
  const [saving, setSaving] = uS(false);

  uE(() => {
    let cancel = false;
    const urls = [];
    (async () => {
      try {
        const filas = await getEstados(itemTipo, item.id);
        const c = {};
        for (const e of ESTADOS_COND) {
          const f = filas.find(x => x.estado === e.key);
          c[e.key] = f ? String(Number(f.cantidad || 0)) : '';
        }
        // Fotos por estado (evidencias tipo 'foto_estado', registro = item:estado)
        const evs = await window.__db.evidencias
          .where('obra_id').equals(obraId)
          .filter(ev => ev.tipo_evidencia === 'foto_estado' && !ev.deleted_at && String(ev.registro_relacionado_id || '').startsWith(item.id + ':'))
          .toArray().catch(() => []);
        evs.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        const fm = {};
        for (const ev of evs) {
          const estado = String(ev.registro_relacionado_id).split(':')[1];
          if (!estado || fm[estado]) continue;
          const src = await getEvidenciaSrc(ev);
          if (src?.url) { if (src.isBlob) urls.push(src.url); fm[estado] = { url: src.url }; }
        }
        if (!cancel) { setCant(c); setFotos(fm); setLoading(false); }
      } catch (e) { if (!cancel) { setLoading(false); } showToast?.('Error cargando estados: ' + (e.message || e), 'red'); }
    })();
    return () => { cancel = true; urls.forEach(u => { try { URL.revokeObjectURL(u); } catch {} }); };
  }, [item?.id, obraId]);

  const sumBuckets = uM(() => ESTADOS_COND.reduce((s, e) => s + (parseFloat(cant[e.key]) || 0), 0), [cant]);
  const sinClasificar = stockTotal - sumBuckets;

  const repartirEnNuevo = () => {
    const c = {}; ESTADOS_COND.forEach(e => { c[e.key] = e.key === 'nuevo' ? String(stockTotal) : ''; });
    setCant(c);
  };

  const subirFoto = async (estado, file) => {
    if (!file) return;
    if (!file.type?.startsWith('image/')) { showToast?.('Elegí una imagen', 'red'); return; }
    try {
      const evId = window.__newId();
      await window.__saveEvidenciaLocal?.({
        id: evId, obra_id: obraId, tipo_evidencia: 'foto_estado',
        modulo_relacionado: 'stock_estados', registro_relacionado_id: `${item.id}:${estado}`,
        nombre_archivo: `estado_${estado}_${item.id}.jpg`, mime_type: file.type || 'image/jpeg',
        blob: file, observaciones: `Foto ${estado} · ${item.nombre_herramienta || item.nombre || ''}`,
        fecha: new Date().toISOString().slice(0, 10), created_by: userId,
      });
      await setFotoEstado({ obraId, itemTipo, itemId: item.id, estado, fotoEvidenciaId: evId, userId });
      const url = URL.createObjectURL(file);
      // Revocar la URL anterior de ese estado antes de reemplazarla (si no, se fuga).
      setFotos(f => {
        const prev = f[estado]?.url;
        if (prev && String(prev).startsWith('blob:')) { try { URL.revokeObjectURL(prev); } catch {} }
        return { ...f, [estado]: { url } };
      });
      showToast?.('Foto guardada', 'green');
    } catch (e) { showToast?.('Error con la foto: ' + (e.message || e), 'red'); }
  };

  const guardar = async () => {
    if (saving) return;
    if (sumBuckets > stockTotal + 1e-6) {
      showToast?.(`La suma por estado (${sumBuckets}) supera el stock total (${stockTotal}). Ajustá las cantidades.`, 'red');
      return;
    }
    setSaving(true);
    try {
      for (const e of ESTADOS_COND) {
        await setCantidadEstado({ obraId, itemTipo, itemId: item.id, estado: e.key, cantidad: parseFloat(cant[e.key]) || 0, userId });
      }
      try { await window.__logAudit?.({ action: 'update', table: 'stock_estados', recordId: item.id, reason: `Distribución por estado de ${item.nombre_herramienta || item.nombre || 'item'}` }); } catch {}
      showToast?.('✓ Estados actualizados', 'green');
      onDone?.(); onClose?.();
    } catch (e) { showToast?.('Error: ' + (e.message || e), 'red'); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={`Condición · ${item?.nombre_herramienta || item?.nombre || 'Item'}`} icon="layers" onClose={onClose}>
      <div style={{ fontSize: 12.5, color: 'var(--ts)', marginBottom: 10 }}>
        Repartí las <strong>{stockTotal} {item?.unidad || 'und'}</strong> en stock según su condición. Cada estado puede llevar una foto. Mover unidades entre estados no cambia el total.
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--tm)', padding: 20 }}>Cargando…</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ESTADOS_COND.map(e => (
              <div key={e.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8 }}>
                {fotos[e.key]?.url ? (
                  <img src={fotos[e.key].url} alt={e.label} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', flexShrink: 0 }} onClick={() => abrirUrlEvidencia(fotos[e.key].url)} title="Ampliar" />
                ) : (
                  <div style={{ width: 40, height: 40, borderRadius: 6, background: 'var(--tint-neutral)', border: '1px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><JxIcon name="image" size={14} color="var(--tm)" /></div>
                )}
                <div style={{ flex: 1 }}>
                  <span className={`badge ${e.badge}`}>{e.label}</span>
                </div>
                <input className="fi" type="number" min="0" step="1" value={cant[e.key] ?? ''} placeholder="0"
                  onChange={ev => setCant(c => ({ ...c, [e.key]: ev.target.value }))}
                  style={{ width: 90, textAlign: 'right' }} />
                <span style={{ fontSize: 11, color: 'var(--tm)', width: 30 }}>{item?.unidad || 'und'}</span>
                <label className="btn btn-ghost btn-xs" style={{ cursor: 'pointer' }} title="Adjuntar foto de esta condición">
                  <JxIcon name="image" size={12} /> Foto
                  <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={ev => subirFoto(e.key, ev.target.files?.[0])} />
                </label>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, fontSize: 12 }}>
            <button className="btn btn-ghost btn-xs" onClick={repartirEnNuevo} title="Poner todo el stock como Nuevo">Repartir todo en “Nuevo”</button>
            <div style={{ color: sinClasificar < -1e-6 ? 'var(--red)' : 'var(--tm)' }}>
              Clasificado <strong>{sumBuckets}</strong> / {stockTotal} · {sinClasificar < -1e-6 ? <span style={{ color: 'var(--red)' }}>excede en {Math.abs(sinClasificar)}</span> : <>sin clasificar <strong>{Math.max(0, sinClasificar)}</strong></>}
            </div>
          </div>
        </>
      )}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-amber" onClick={guardar} disabled={saving || loading}><JxIcon name="check" size={13} /> {saving ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </Modal>
  );
}
