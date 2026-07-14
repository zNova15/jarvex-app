// ═══════════════════════════════════════════════════════════════════
// JARVEX — UI reutilizable de stock por ubicación
//
// Los insumos llegan a un almacén (ej. Almacén Casa J), se trasladan a otro
// (Central) y de ahí salen a obra. Estos dos componentes se comparten entre
// Materiales / Herramientas / EPP:
//   • DesglosePopup     — ventanita "almacén → cantidad" de un insumo.
//   • TraspasoStockModal— mover stock de un almacén a otro (genérico).
//
// Usan Modal / JxIcon / SearchableSelect (globales) y los helpers de
// stock-ubicaciones.js. El total del insumo no cambia con un traspaso.
// ═══════════════════════════════════════════════════════════════════

import React from "react";

const { useState: uS, useMemo: uM } = React;

const fmtN = (n) => Number(n || 0).toLocaleString('es-PE');

/** De un Map(ubicId→cant), la única ubicación con stock>0 (o null si 0 o ≥2). */
export function ubicacionAutoOrigen(desgloseMap) {
  if (!desgloseMap) return null;
  const conStock = Array.from(desgloseMap.entries()).filter(([, c]) => Number(c) > 0);
  return conStock.length === 1 ? conStock[0][0] : null;
}

/** Valida que una ubicación tenga stock suficiente para una salida.
 * `stockActual` (opcional) = fuente de verdad: si el desglose quedó ATRÁS
 * (drift — caso "hay 7, pedís 8" con stock real 8), la diferencia cuenta
 * como disponible en la ubicación consultada. */
export function validarSalidaUbic(desgloseMap, ubicacionId, cantidad, stockActual = null) {
  let disponible = Number(desgloseMap?.get(ubicacionId) || 0);
  if (stockActual != null) {
    const suma = desgloseMap ? [...desgloseMap.values()].reduce((a, b) => a + (Number(b) || 0), 0) : 0;
    const faltante = Number(stockActual) - suma;
    if (faltante > 0.0001) disponible += faltante;
  }
  return { ok: Number(cantidad) <= disponible, disponible };
}

// ── Popup: desglose por ubicación de un insumo ──────────────────────
// `desglose` es el Map(ubicacion_id → cantidad) que la página ya tiene
// cargado (getDesgloseBulk). Solo lectura + acceso a "Traspaso rápido".
export function DesglosePopup({ nombre, unidad, desglose, ubicacionesById, canTraspaso, onTraspaso, onClose }) {
  const filas = uM(() => {
    if (!desglose) return [];
    return Array.from(desglose.entries())
      .map(([uid, c]) => ({ uid, cant: Number(c || 0), nombre: ubicacionesById?.get(uid)?.nombre || 'Ubicación', activa: ubicacionesById?.get(uid)?.activo !== false }))
      .filter(f => f.cant > 0)
      .sort((a, b) => b.cant - a.cant);
  }, [desglose, ubicacionesById]);
  const total = filas.reduce((s, f) => s + f.cant, 0);

  return (
    <Modal title={`Ubicación · ${nombre}`} icon="map" onClose={onClose}>
      {filas.length === 0 ? (
        <div style={{ padding: '14px 12px', background: 'rgba(242,183,5,0.08)', border: '1px solid rgba(242,183,5,0.3)', borderRadius: 8, fontSize: 12.5, color: 'var(--ts)' }}>
          Este insumo todavía no tiene stock distribuido por ubicación. Registrá un ingreso eligiendo el almacén de llegada.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filas.map(f => (
            <div key={f.uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', background: 'var(--bg-c)', border: '1px solid var(--border)', borderRadius: 8 }}>
              <span style={{ fontSize: 13, color: f.activa ? 'var(--tp)' : 'var(--tm)' }}>📍 {f.nombre}{f.activa ? '' : ' (inactiva)'}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--amber)' }}>{fmtN(f.cant)} {unidad || ''}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', marginTop: 2, borderTop: '1px dashed var(--border)' }}>
            <span style={{ fontSize: 12, color: 'var(--tm)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Total</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--tp)' }}>{fmtN(total)} {unidad || ''}</span>
          </div>
        </div>
      )}
      <div className="modal-actions">
        {canTraspaso && filas.length >= 1 && (
          <button className="btn btn-ghost" onClick={() => { onClose?.(); onTraspaso?.(); }}><JxIcon name="compare" size={13} />Traspaso rápido</button>
        )}
        <button className="btn btn-amber" onClick={onClose}>Cerrar</button>
      </div>
    </Modal>
  );
}

// ── Modal de traspaso entre almacenes (genérico) ────────────────────
// items = [{ id, nombre }]. getDesgloseDe(itemId) → Map(ubicId→cant).
// onConfirm({ item_id, origenId, destinoId, cantidad }) lo registra la página
// (llama traspasar() + movimientos de trazabilidad en su propia tabla).
export function TraspasoStockModal({ items, ubicaciones, ubicacionesById, getDesgloseDe, itemLabel = 'Insumo', preItemId = '', onClose, onConfirm }) {
  const [itemId, setItemId] = uS(preItemId || '');
  const [origenId, setOrigenId] = uS('');
  const [destinoId, setDestinoId] = uS('');
  const [cantidad, setCantidad] = uS('');
  const [saving, setSaving] = uS(false);

  const dg = itemId ? getDesgloseDe(itemId) : null;
  const origenes = dg ? Array.from(dg.entries()).filter(([, c]) => Number(c) > 0) : [];
  const dispoOrigen = origenId && dg ? Number(dg.get(origenId) || 0) : 0;
  const cant = Number(cantidad) || 0;
  const valido = itemId && origenId && destinoId && origenId !== destinoId && cant > 0 && cant <= dispoOrigen;

  const submit = async () => {
    setSaving(true);
    try { await onConfirm({ item_id: itemId, origenId, destinoId, cantidad: cant }); }
    finally { setSaving(false); }
  };

  return (
    <Modal title="Traspaso entre almacenes" icon="compare" onClose={onClose}>
      <div style={{ fontSize: 12, color: 'var(--tm)', marginBottom: 12, lineHeight: 1.5 }}>
        Mové stock de un almacén a otro. Se registra como salida + entrada y el total del insumo no cambia.
      </div>
      <div style={{ marginBottom: 10 }}>
        <label className="flabel">{itemLabel}</label>
        <SearchableSelect
          value={itemId}
          onChange={v => { setItemId(v); setOrigenId(''); setDestinoId(''); }}
          options={[{ value: '', label: '— Selecciona —' }, ...items.map(m => ({ value: m.id, label: m.nombre }))]}
          placeholder={`— Selecciona ${itemLabel.toLowerCase()} —`} />
      </div>
      {itemId && (origenes.length === 0 ? (
        <div style={{ padding: '10px 12px', background: 'rgba(242,183,5,0.08)', border: '1px solid rgba(242,183,5,0.3)', borderRadius: 6, fontSize: 12, color: 'var(--ts)' }}>
          Este insumo no tiene stock distribuido por ubicación todavía. Registrá un ingreso eligiendo el almacén primero.
        </div>
      ) : (
        <div className="g2">
          <div>
            <label className="flabel">Desde (origen)</label>
            <select className="fi" value={origenId} onChange={e => setOrigenId(e.target.value)}>
              <option value="">— Origen —</option>
              {origenes.map(([uid, c]) => (
                <option key={uid} value={uid}>{ubicacionesById.get(uid)?.nombre || '—'} · {fmtN(c)} disp.</option>
              ))}
            </select>
          </div>
          <div>
            <label className="flabel">Hacia (destino)</label>
            <select className="fi" value={destinoId} onChange={e => setDestinoId(e.target.value)}>
              <option value="">— Destino —</option>
              {ubicaciones.filter(u => u.id !== origenId).map(u => (
                <option key={u.id} value={u.id}>{u.nombre}</option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <label className="flabel">Cantidad a traspasar {origenId ? `(máx ${fmtN(dispoOrigen)})` : ''}</label>
            <input className="fi" type="number" min="0" step="0.01" max={dispoOrigen}
              value={cantidad} onChange={e => setCantidad(e.target.value)} placeholder="0" />
            {cant > dispoOrigen && <div style={{ fontSize: 10.5, color: 'var(--red)', marginTop: 3 }}>No podés traspasar más de lo disponible en el origen.</div>}
          </div>
        </div>
      ))}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-amber" onClick={submit} disabled={!valido || saving}>
          <JxIcon name="compare" size={13} /> {saving ? 'Traspasando…' : 'Confirmar traspaso'}
        </button>
      </div>
    </Modal>
  );
}
