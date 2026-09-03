import React from "react";
import { SearchableSelect } from "./jx-searchable-select.jsx";
import { TIPOS_INSUMO, TIPO_INSUMO_KEYS, recomendacionesInsumo, matchInsumoReal, registrarInsumoPendiente, normNombre } from "../lib/insumos-catalogo.js";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

// ═══════════════════════════════════════════════════════════════════
// JARVEX — Solicitud de Insumos (antes "Solicitud de Materiales").
// ═══════════════════════════════════════════════════════════════════
// El personal de obra le pide insumos a la encargada (almacenera): ella
// carga aquí QUÉ necesita (materiales, herramientas, EPPs, insumos de
// emergencia o maquinaria), QUIÉN lo requiere (responsable), POR QUÉ (razón,
// para que la técnica decida si procede), CUÁNDO lo necesita (fecha deseada)
// y, opcional, un MÍNIMO urgente con su fecha. Al enviar, la solicitud va a
// Requisiciones como PENDIENTE para que un revisor (admin) la acepte
// (total/parcial) o deniegue con motivo. Los nombres que no existen en el
// inventario real se guardan en un catálogo PENDIENTE separado (no ensucian
// las tablas reales) y sirven como recomendaciones.
// ═══════════════════════════════════════════════════════════════════

const fmtN = (n) => Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 });

const JxIcon = (props) => {
  const I = window.JxIcon;
  return I ? <I {...props}/> : null;
};

const nuevoItem = () => ({ id: (window.crypto?.randomUUID?.() || `${Date.now()}_${Math.round(performance.now())}`), tipo: 'material', insumo_id: '', nombre: '', unidad: '', cantidad: '', cantidad_minima: '', notas: '' });

function SolicitudResidentePage({ showToast }) {
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id || 'offline';
  const userName = `${auth?.profile?.nombres || ''} ${auth?.profile?.apellidos || ''}`.trim() || auth?.profile?.email || 'Usuario';

  const [obraId, setObraId] = uS(null);
  const [fechaCreacion, setFechaCreacion] = uS(() => new Date().toISOString().slice(0, 10));
  const [fechaNecesidad, setFechaNecesidad] = uS(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [fechaUrgente, setFechaUrgente] = uS('');      // opcional
  // Responsable del pedido: personal registrado (id) o, si no está, nombre libre.
  const [responsableId, setResponsableId] = uS('');
  const [responsableNombre, setResponsableNombre] = uS('');
  const [razon, setRazon] = uS('');                    // razón del requerimiento (obligatoria)
  const [descripcion, setDescripcion] = uS('');
  const [prioridad, setPrioridad] = uS('normal');
  const [items, setItems] = uS([nuevoItem()]);
  const [submitBusy, setSubmitBusy] = uS(false);
  const [ultimaReq, setUltimaReq] = uS(null);

  const sanearNombreItem = (nombre) => {
    if (!nombre) return '';
    return String(nombre)
      .replace(/\s*[×x]\s*\d+(\.\d+)?\s*(bls|kg|m2|m3|m|und|gal|hr|pza|pza?s)?\b/gi, '')
      .replace(/\s*[\(\[]\s*\d+(\.\d+)?\s*(bls|kg|m2|m3|m|und|gal|hr|pza|pza?s)?\s*[\)\]]/gi, '')
      .replace(/\s*[-–—]\s*\d+(\.\d+)?\s*(bls|kg|m2|m3|m|und|gal|hr|pza|pza?s)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // ── Obra activa ──
  uE(() => {
    let cancelled = false;
    let attempts = 0;
    const find = async () => {
      attempts++;
      try {
        const obras = await window.__db.obras.toArray();
        const stored = window.__getObraActivaId?.();
        const a = (stored && obras.find(o => o.id === stored && !o.deleted_at)) || obras.find(o => !o.deleted_at);
        if (a && !cancelled) { setObraId(a.id); return; }
      } catch {}
      if (cancelled || attempts >= 10) return;
      setTimeout(find, 500);
    };
    find();
    const onChange = () => { attempts = 0; find(); };
    window.addEventListener('obra_activa_change', onChange);
    return () => { cancelled = true; window.removeEventListener('obra_activa_change', onChange); };
  }, []);

  const { data: materiales } = window.__hooks.useMateriales(obraId);
  const { data: personal } = window.__hooks.usePersonal?.(obraId) || { data: [] };

  const personalOpts = uM(() => (personal || [])
    .filter(p => !p.deleted_at)
    .map(p => ({ value: p.id, label: `${p.nombres || ''} ${p.apellidos || ''}`.trim() + (p.cargo ? ` · ${p.cargo}` : '') }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es')), [personal]);

  // ── Recomendaciones por tipo (inventario real + pendientes). Se recargan al
  // cambiar de obra o cuando cambian datos (nuevos insumos/pendientes). ──
  const [recos, setRecos] = uS(() => new Map());
  uE(() => {
    if (!obraId) return;
    let cancel = false;
    const load = async () => {
      const m = new Map();
      for (const tipo of TIPO_INSUMO_KEYS) {
        m.set(tipo, await recomendacionesInsumo(tipo, obraId));
      }
      if (!cancel) setRecos(m);
    };
    load();
    const on = () => load();
    window.addEventListener('jx_data_changed', on);
    window.addEventListener('jarvex_master_updated', on);
    return () => { cancel = true; window.removeEventListener('jx_data_changed', on); window.removeEventListener('jarvex_master_updated', on); };
  }, [obraId]);

  const matsArr = uM(() => (materiales || []).filter(x => !x.deleted_at), [materiales]);

  const addItem = () => setItems(prev => [...prev, nuevoItem()]);
  const removeItem = (id) => setItems(prev => prev.length === 1 ? prev : prev.filter(it => it.id !== id));
  const updateItem = (id, patch) => setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it));

  // Al escribir/elegir un nombre: si coincide con un insumo REAL de ese tipo,
  // fija insumo_id y autocompleta unidad; si no, queda como pendiente (se
  // resuelve al enviar). El usuario SIEMPRE puede editar nombre y unidad.
  // NO saneamos en cada tecla (la regex de sanearNombreItem borra patrones
  // "x N unidad" y corrompía nombres legítimos a mitad de escritura, ej.
  // "Tubo x 20 und"). Guardamos el texto crudo y solo matcheamos contra el
  // inventario real por nombre normalizado.
  const onNombreChange = (id, tipo, value) => {
    const lista = recos.get(tipo) || [];
    const match = lista.find(r => r.real && normNombre(r.nombre) === normNombre(value));
    if (match) updateItem(id, { nombre: match.nombre, insumo_id: match.id, unidad: match.unidad || '' });
    else updateItem(id, { nombre: value, insumo_id: '' });
  };

  const cambiarTipo = (id, tipo) => updateItem(id, { tipo, insumo_id: '', nombre: '', unidad: '' });

  // Stock (solo materiales con insumo real) — dato informativo para el revisor.
  const stockDe = (it) => {
    if (it.tipo !== 'material' || !it.insumo_id) return null;
    const m = matsArr.find(x => x.id === it.insumo_id);
    return m ? { stock: Number(m.stock_actual || 0), min: Number(m.stock_minimo || 0) } : null;
  };


  // ── Envío ──
  const handleSubmit = async () => {
    if (!obraId) { showToast('Selecciona una obra activa', 'red'); return; }
    const responsableFinal = responsableId
      ? (personalOpts.find(o => o.value === responsableId)?.label || '').replace(/ · .*$/, '')
      : responsableNombre.trim();
    if (!responsableFinal) { showToast('Indicá el responsable del pedido (quién lo requiere)', 'red'); return; }
    if (razon.trim().length < 3) { showToast('Indicá la razón del requerimiento', 'red'); return; }
    if (!fechaNecesidad) { showToast('Indicá la fecha en que se necesita', 'red'); return; }
    const validos = items.filter(it => it.nombre.trim() && Number(it.cantidad) > 0);
    if (!validos.length) { showToast('Agregá al menos un insumo con nombre y cantidad', 'red'); return; }
    // Coherencia mínimo urgente ≤ cantidad pedida
    const minMalo = validos.find(it => Number(it.cantidad_minima) > 0 && Number(it.cantidad_minima) > Number(it.cantidad));
    if (minMalo) { showToast(`El mínimo urgente de "${minMalo.nombre}" no puede superar la cantidad pedida`, 'red'); return; }
    // Coherencia de fechas urgentes / mínimos
    if (fechaUrgente && fechaUrgente > fechaNecesidad) { showToast('La fecha urgente no puede ser posterior a la fecha deseada', 'red'); return; }

    setSubmitBusy(true);
    try {
      const now = new Date().toISOString();
      const reqId = window.__newId();
      const reqsObra = await window.__db.requisiciones.where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray();
      const sigNum = (reqsObra.length || 0) + 1;
      const codigo = `REQ-${new Date().getFullYear()}-${String(sigNum).padStart(4, '0')}`;
      const descripcionFinal = descripcion.trim() || `Solicitud del ${now.slice(0, 10)} (${validos.length} ítem(s))`;

      await window.__db.requisiciones.add({
        id: reqId, obra_id: obraId,
        codigo, fecha: fechaCreacion || now.slice(0, 10),
        descripcion: descripcionFinal,
        prioridad,
        estado: 'pendiente',                      // SIEMPRE va a revisión (el revisor decide)
        solicitante_id: userId,
        solicitante_nombre: userName,
        responsable_id: responsableId || null,
        responsable_nombre: responsableFinal,
        razon: razon.trim(),
        fecha_necesidad: fechaNecesidad,
        fecha_requerida: fechaNecesidad,          // compat con lecturas viejas
        fecha_urgente: fechaUrgente || null,
        notas: `Cargado por ${userName} · solicita ${responsableFinal}`,
        veces_editada: 0,
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_requisiciones_${reqId}`,
      });

      for (const it of validos) {
        // Resolver insumo real o catálogo pendiente (NO ensuciar el inventario real).
        let insumoId = it.insumo_id || null;
        let pendienteId = null;
        if (!insumoId) {
          const real = await matchInsumoReal(it.tipo, it.nombre, obraId);
          if (real) insumoId = real.id;
          else pendienteId = await registrarInsumoPendiente({ obraId, tipo: it.tipo, nombre: it.nombre.trim(), unidad: it.unidad, userId });
        }
        const itemId = window.__newId();
        await window.__db.requisicion_items.add({
          id: itemId, requisicion_id: reqId,
          tipo_insumo: it.tipo,
          insumo_id: insumoId,
          insumo_pendiente_id: pendienteId,
          // material_id se mantiene SOLO para materiales (compat con generación de OC / recepción).
          material_id: it.tipo === 'material' ? insumoId : null,
          nombre: it.nombre.trim(),
          descripcion: it.nombre.trim(),
          unidad: it.unidad || null,
          cantidad: Number(it.cantidad),
          cantidad_minima: Number(it.cantidad_minima) > 0 ? Number(it.cantidad_minima) : null,
          precio_estimado: it.tipo === 'material' ? Number(matsArr.find(m => m.id === insumoId)?.precio_unitario_estimado || 0) : 0,
          notas: it.notas || null,
          observacion: it.notas || null,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_req_items_${itemId}`,
        });
      }

      try { await window.__logAudit?.({ action: 'insert', table: 'requisiciones', recordId: reqId, newData: { codigo, items: validos.length, responsable: responsableFinal, prioridad }, reason: `Solicitud de insumos · ${descripcionFinal}` }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'requisiciones' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      try { window.dispatchEvent(new CustomEvent('jarvex_new_notif', { detail: { tipo: 'requisicion', titulo: `Solicitud ${codigo} (${prioridad})`, descripcion: `${validos.length} ítem(s) · solicita ${responsableFinal} · pendiente de revisión` } })); } catch {}

      showToast(`✓ Solicitud ${codigo} enviada · pendiente de revisión`, 'green');
      setUltimaReq({ id: reqId, codigo, prioridad, items: validos.length });
      setItems([nuevoItem()]);
      setDescripcion(''); setRazon(''); setFechaUrgente('');
    } catch (e) {
      showToast('Error: ' + (e.message || e), 'red');
    } finally { setSubmitBusy(false); }
  };

  if (!obraId) {
    return (
      <div className="page-wrap">
        <div className="empty-state">
          <JxIcon name="hardHat" size={32} color="var(--tm)"/>
          <p>Cargando obra activa…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Solicitud de Insumos</div>
          <div className="pg-sub">Cargá lo que el personal necesita · va a Requisiciones para revisión y aprobación</div>
        </div>
      </div>


      {/* ── Datos del pedido ── */}
      <div className="card card-p" style={{ marginBottom: 14 }}>
        <div className="g2">
          <div>
            <label className="flabel">Responsable del pedido * <span style={{ color: 'var(--tm)', fontWeight: 400 }}>(quién lo requiere)</span></label>
            {personalOpts.length > 0 ? (
              <SearchableSelect
                value={responsableId}
                onChange={(v) => { setResponsableId(v); if (v) setResponsableNombre(''); }}
                options={[{ value: '', label: '— Otro (escribo el nombre) —' }, ...personalOpts]}
                placeholder="Buscar personal…"/>
            ) : null}
            {(!responsableId) && (
              <input className="fi" style={{ marginTop: personalOpts.length ? 6 : 0 }} value={responsableNombre}
                onChange={e => setResponsableNombre(e.target.value)}
                placeholder="Nombre del que requiere (ej: Maestro Juan Pérez)"/>
            )}
          </div>
          <div>
            <label className="flabel">Prioridad</label>
            <select className="fi" value={prioridad} onChange={e => setPrioridad(e.target.value)}>
              <option value="baja">Baja</option><option value="normal">Normal</option>
              <option value="alta">Alta</option><option value="urgente">Urgente</option>
            </select>
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <label className="flabel">Razón del requerimiento * <span style={{ color: 'var(--tm)', fontWeight: 400 }}>(la técnica decide si procede)</span></label>
            <textarea className="fi" rows={2} value={razon} onChange={e => setRazon(e.target.value)}
              placeholder="Ej: Se acabó el cemento del frente de losa y no se puede continuar el vaciado programado."/>
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <label className="flabel">Descripción / título de la solicitud</label>
            <input className="fi" value={descripcion} onChange={e => setDescripcion(e.target.value)}
              placeholder="Ej: Materiales para vaciado de losa nivel 3 — Semana 18 (opcional)"/>
          </div>
          <div>
            <label className="flabel">Fecha de creación</label>
            <input className="fi" type="date" value={fechaCreacion} max={new Date().toISOString().slice(0, 10)} onChange={e => setFechaCreacion(e.target.value)}/>
          </div>
          <div>
            <label className="flabel">Fecha deseada del pedido *</label>
            <input className="fi" type="date" value={fechaNecesidad} min={fechaCreacion} onChange={e => setFechaNecesidad(e.target.value)}/>
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <label className="flabel">Fecha urgente del mínimo <span style={{ color: 'var(--tm)', fontWeight: 400 }}>(opcional — para cuándo necesitan al menos el mínimo; puede ser antes de la deseada)</span></label>
            <input className="fi" type="date" value={fechaUrgente} min={fechaCreacion} max={fechaNecesidad} onChange={e => setFechaUrgente(e.target.value)} style={{ maxWidth: 260 }}/>
          </div>
        </div>
      </div>

      {/* ── Ítems ── */}
      <div className="card card-p" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ts)' }}>Insumos solicitados</div>
          <button className="btn btn-amber btn-sm" onClick={addItem}><JxIcon name="plus" size={11}/> Agregar ítem</button>
        </div>
        <div style={{ overflow: 'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th style={{ minWidth: 120 }}>Tipo</th>
              <th style={{ minWidth: 240 }}>Insumo</th>
              <th style={{ minWidth: 90 }}>Cantidad</th>
              <th style={{ minWidth: 90 }}>Mín. urgente</th>
              <th style={{ minWidth: 70 }}>Unidad</th>
              <th style={{ minWidth: 90 }}>Stock</th>
              <th style={{ minWidth: 160 }}>Notas</th>
              <th></th>
            </tr></thead>
            <tbody>
              {items.map(it => {
                const lista = recos.get(it.tipo) || [];
                const st = stockDe(it);
                const esNuevo = it.nombre.trim() && !it.insumo_id;
                return (
                  <tr key={it.id}>
                    <td>
                      <select className="fi" value={it.tipo} onChange={e => cambiarTipo(it.id, e.target.value)} style={{ fontSize: 11.5 }}>
                        {TIPO_INSUMO_KEYS.map(t => <option key={t} value={t}>{TIPOS_INSUMO[t].label}</option>)}
                      </select>
                    </td>
                    <td>
                      <input className="fi" list={`reco-${it.id}`} value={it.nombre}
                        onChange={e => onNombreChange(it.id, it.tipo, e.target.value)}
                        placeholder="Nombre del insumo…"/>
                      <datalist id={`reco-${it.id}`}>
                        {lista.map(r => <option key={r.id} value={r.nombre}>{r.real ? '' : '(sugerido)'}</option>)}
                      </datalist>
                      {esNuevo && <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: 2 }}>⚠ No está en inventario — se guarda como pendiente (recomendación)</div>}
                    </td>
                    <td><input className="fi" type="number" min="0" step="0.01" value={it.cantidad} onChange={e => updateItem(it.id, { cantidad: e.target.value })} style={{ textAlign: 'right' }}/></td>
                    <td><input className="fi" type="number" min="0" step="0.01" value={it.cantidad_minima} onChange={e => updateItem(it.id, { cantidad_minima: e.target.value })} placeholder="—" style={{ textAlign: 'right' }} title="Mínimo que necesitan de forma urgente (opcional)"/></td>
                    <td><input className="fi" value={it.unidad} onChange={e => updateItem(it.id, { unidad: e.target.value })} placeholder="bls/kg/m…" style={{ fontSize: 11, minWidth: 60 }}/></td>
                    <td style={{ textAlign: 'right', fontSize: 11, color: st && st.stock <= st.min ? 'var(--red)' : 'var(--tm)' }}>{st ? `${fmtN(st.stock)} (mín ${fmtN(st.min)})` : '—'}</td>
                    <td><input className="fi" value={it.notas} onChange={e => updateItem(it.id, { notas: e.target.value })} placeholder="opcional"/></td>
                    <td><button className="btn btn-ghost btn-xs" onClick={() => removeItem(it.id)} disabled={items.length === 1}><JxIcon name="trash" size={11}/></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Banner post-envío */}
      {ultimaReq && (
        <div className="card card-p" style={{ marginBottom: 14, background: 'rgba(46,204,113,0.07)', border: '1px solid rgba(46,204,113,0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>✓ Solicitud {ultimaReq.codigo} enviada</div>
              <div style={{ fontSize: 11.5, color: 'var(--ts)', marginTop: 4 }}>
                Quedó <strong>pendiente de revisión</strong> con prioridad <strong style={{ textTransform: 'uppercase' }}>{ultimaReq.prioridad}</strong>. La verás en <strong>Requisiciones → Mis Solicitudes</strong>; el revisor la acepta o deniega ahí.
              </div>
            </div>
            <button className="btn btn-amber btn-sm" onClick={() => { try { window.__navTo?.('requisiciones'); } catch {} }}>
              Ir a Requisiciones <JxIcon name="chevR" size={11}/>
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setUltimaReq(null)}>Cerrar</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={() => { setItems([nuevoItem()]); setDescripcion(''); setRazon(''); }}>Limpiar</button>
        <button className="btn btn-amber" disabled={submitBusy} onClick={handleSubmit}>
          <JxIcon name="check" size={13}/>{submitBusy ? 'Enviando…' : 'Enviar solicitud'}
        </button>
      </div>
    </div>
  );
}

Object.assign(window, { SolicitudResidentePage });
export default SolicitudResidentePage;
