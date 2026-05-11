// ═══════════════════════════════════════════════════════════════════
// JARVEX — EPPs Inventario
// Catálogo separado de materiales: equipos de protección personal con
// vida útil normada y movimientos de salida con FIRMA del trabajador
// (registro físico exigido por SUNAFIL).
//
// El detector de EPPs en MaterialesPage permite migrar registros desde
// `materiales` con un click ("Mover a EPPs"). El `material_origen_id`
// queda guardado para trazabilidad.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { CATALOGO_EPP, epppTipo, detectarEPP } from "../lib/epp-utils.js";
import { calcAlerta } from "../lib/stock-utils.js";
import { usePagination } from "../hooks/usePagination.js";
import { TablePagination } from "./jx-pagination.jsx";
import { SearchableSelect } from "./jx-searchable-select.jsx";

const { useState: uS, useEffect: uE, useMemo: uM, useRef: uR } = React;

const Modal = (props) => (window.Modal ? <window.Modal {...props}/> : null);
const JxIcon = (props) => (window.JxIcon ? <window.JxIcon {...props}/> : null);

const ALERTA_STYLE = {
  ok:        { class: 'b-green',  label: 'OK' },
  cerca:     { class: 'b-yellow', label: 'Cerca mín' },
  reponer:   { class: 'b-yellow', label: 'Reponer' },
  critico:   { class: 'b-red',    label: 'Crítico' },
  sin_stock: { class: 'b-gray',   label: 'Sin stock' },
  agotado:   { class: 'b-red',    label: 'Agotado' },
};

// ─── SignaturePad ─────────────────────────────────────────────
// Canvas simple para capturar firma del trabajador con touch o mouse.
// Devuelve dataURL via ref.toBlob() para guardar como evidencia.
function SignaturePad({ onChange, height = 140 }) {
  const canvasRef = uR(null);
  const drawing = uR(false);
  const lastPoint = uR(null);
  const [hasInk, setHasInk] = uS(false);

  uE(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0E1620';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const getXY = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.touches?.[0] || e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  };
  const start = (e) => {
    e.preventDefault();
    drawing.current = true;
    lastPoint.current = getXY(e);
  };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = getXY(e);
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    lastPoint.current = { x, y };
    if (!hasInk) setHasInk(true);
  };
  const end = (e) => {
    e.preventDefault();
    drawing.current = false;
    if (hasInk && onChange) {
      canvasRef.current.toBlob(blob => onChange(blob), 'image/png');
    }
  };
  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    if (onChange) onChange(null);
  };

  return (
    <div>
      <canvas ref={canvasRef} width={500} height={height}
              style={{ width:'100%', maxWidth:500, height, border:'1px dashed var(--bd)', borderRadius:6, background:'#fff', cursor:'crosshair', touchAction:'none' }}
              onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
              onTouchStart={start} onTouchMove={move} onTouchEnd={end}/>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:6 }}>
        <span style={{ fontSize:11, color: hasInk ? 'var(--green)' : 'var(--tm)' }}>
          {hasInk ? '✓ Firma capturada' : 'Firmá con el dedo o mouse arriba'}
        </span>
        <button type="button" className="btn btn-ghost btn-xs" onClick={clear}>
          <JxIcon name="x" size={11}/> Borrar
        </button>
      </div>
    </div>
  );
}

// ─── EppsInventarioPage ────────────────────────────────────────
function EppsInventarioPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';
  const appMode = window.__useAppMode ? window.__useAppMode() : { isEdicion: true };
  const canDelete = isAdmin && (appMode.isEdicion || appMode.isPrueba);
  const canWrite = isAdmin || (window.__hasPerm?.(myRol, 'EPP', 'w') ?? false);

  const [obraId, setObraId] = uS(null);

  uE(() => {
    let cancelled = false;
    const findObra = async () => {
      const stored = window.__getObraActivaId?.();
      const obras = await window.__db.obras.toArray();
      const valida = stored && obras.find(o => o.id === stored);
      if (!cancelled) setObraId(valida ? stored : (obras[0]?.id || null));
    };
    findObra();
    const onChange = () => findObra();
    window.addEventListener('obra_activa_change', onChange);
    window.addEventListener('jarvex_master_updated', onChange);
    return () => {
      window.removeEventListener('obra_activa_change', onChange);
      window.removeEventListener('jarvex_master_updated', onChange);
    };
  }, []);

  const { data: epps = [], loading, create: createEpp, update: updateEpp, refresh } = window.__hooks.useEpps?.(obraId) || { data: [] };
  const movHook = window.__hooks.useMovimientosEpp?.(obraId) || { data: [], create: async () => {} };
  const { data: personal = [] } = window.__hooks.usePersonal?.(obraId) || { data: [] };

  const [q, setQ] = uS('');
  const [filtroTipo, setFiltroTipo] = uS('todos');
  const [modal, setModal] = uS(null); // 'nuevo' | 'editar' | 'ingreso' | 'salida'
  const [form, setForm] = uS({});
  const [editingId, setEditingId] = uS(null);

  // Foto del EPP — mismo patrón que materiales/herramientas en jx-almacen.
  // Se guarda como evidencia (tipo_evidencia='foto_epp') vinculada al
  // registro_relacionado_id del EPP. NO modifica el schema de epps —
  // las fotos viven en la tabla `evidencias` separada.
  const [foto, setFoto] = uS(null);
  const [fotosMap, setFotosMap] = uS(() => new Map());

  // Carga las fotos existentes para mostrarlas en el modal de edición y
  // como thumbnail en la lista. Hace blob URLs locales para fotos que
  // todavía no se subieron (pending_upload) y signed URLs remotas para
  // las ya en Supabase Storage.
  uE(() => {
    if (!obraId) return;
    let cancelled = false;
    const blobUrlsLocales = [];
    const cargar = async () => {
      try {
        const evidencias = await window.__db.evidencias
          .where('obra_id').equals(obraId)
          .filter(e => e.tipo_evidencia === 'foto_epp' && !e.deleted_at && e.registro_relacionado_id)
          .toArray();
        evidencias.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        const map = new Map();
        for (const ev of evidencias) {
          if (map.has(ev.registro_relacionado_id)) continue; // primera = más reciente
          if (ev.url_archivo) {
            map.set(ev.registro_relacionado_id, { url: ev.url_archivo, isRemote: true });
          } else {
            try {
              const row = await window.__db.evidencias_blobs.get(ev.id);
              if (row?.blob) {
                const url = URL.createObjectURL(row.blob);
                blobUrlsLocales.push(url);
                map.set(ev.registro_relacionado_id, { url, isRemote: false });
              }
            } catch {}
          }
        }
        if (!cancelled) setFotosMap(map);
      } catch (e) { console.warn('[fotos epp]', e?.message || e); }
    };
    cargar();
    const onChange = (e) => {
      const t = e?.detail?.tabla || e?.detail?.table;
      if (!t || t === 'evidencias' || t === 'epps') cargar();
    };
    window.addEventListener('jx_data_changed', onChange);
    window.addEventListener('jarvex_master_updated', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('jx_data_changed', onChange);
      window.removeEventListener('jarvex_master_updated', onChange);
      blobUrlsLocales.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
    };
  }, [obraId]);

  const handleFotoChangeEpp = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Solo se permiten imágenes', 'red');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      showToast('La foto supera los 8 MB', 'red');
      return;
    }
    if (foto?.url) try { URL.revokeObjectURL(foto.url); } catch {}
    setFoto({ blob: file, url: URL.createObjectURL(file) });
  };

  // Lote (igual patrón que materiales)
  const [loteItems, setLoteItems] = uS([]);
  const [loteComunes, setLoteComunes] = uS({ usarMismoProveedor: true, usarMismaPersona: true, proveedor_id: null, personal_id: null });
  // Firma del trabajador en salida (común al lote)
  const [firmaBlob, setFirmaBlob] = uS(null);

  const updateLoteItem = (id, patch) => {
    setLoteItems(items => items.map(it => it.id === id ? { ...it, ...patch } : it));
  };
  const addLoteItem = () => {
    setLoteItems(items => [...items, { id: window.__newId?.() || crypto.randomUUID(), epp_id:'', cantidad:'', precio:'', proveedor_id:null }]);
  };
  const removeLoteItem = (id) => {
    setLoteItems(items => items.length > 1 ? items.filter(it => it.id !== id) : items);
  };

  const filtered = uM(() => {
    let rows = epps;
    if (filtroTipo !== 'todos') rows = rows.filter(e => e.tipo_epp === filtroTipo);
    if (q) {
      const ql = q.toLowerCase();
      rows = rows.filter(e =>
        e.nombre_epp?.toLowerCase().includes(ql) ||
        e.tipo_epp?.toLowerCase().includes(ql) ||
        e.marca?.toLowerCase().includes(ql) ||
        e.talla?.toLowerCase().includes(ql)
      );
    }
    return rows;
  }, [epps, q, filtroTipo]);

  const eppsPg = usePagination(filtered, 50);

  const tiposDisponibles = uM(() => {
    const set = new Set(epps.map(e => e.tipo_epp).filter(Boolean));
    return Array.from(set).sort();
  }, [epps]);

  const openNuevo = () => {
    setForm({ tipo_epp: 'Casco', vida_util_dias: 365, unidad: 'Und' });
    setEditingId(null);
    if (foto?.url) try { URL.revokeObjectURL(foto.url); } catch {}
    setFoto(null);
    setModal('nuevo');
  };
  const openEditar = (e) => {
    setForm({ ...e });
    setEditingId(e.id);
    if (foto?.url) try { URL.revokeObjectURL(foto.url); } catch {}
    setFoto(null);
    setModal('editar');
  };
  const openIngreso = () => {
    setForm({
      fecha: new Date().toISOString().slice(0, 10),
      hora: new Date().toTimeString().slice(0, 5),
    });
    setLoteItems([{ id: crypto.randomUUID(), epp_id:'', cantidad:'', precio:'', proveedor_id:null }]);
    setLoteComunes({ usarMismoProveedor: true, usarMismaPersona: true, proveedor_id: null, personal_id: null });
    setModal('ingreso');
  };
  const openSalida = () => {
    setForm({
      fecha: new Date().toISOString().slice(0, 10),
      hora: new Date().toTimeString().slice(0, 5),
    });
    setLoteItems([{ id: crypto.randomUUID(), epp_id:'', cantidad:'', talla:'' }]);
    setLoteComunes({ usarMismoProveedor: true, usarMismaPersona: true, proveedor_id: null, personal_id: null });
    setFirmaBlob(null);
    setModal('salida');
  };

  const handleSubmitEpp = async () => {
    if (!form.nombre_epp || !form.tipo_epp) {
      showToast('Completá nombre y tipo', 'red');
      return;
    }
    try {
      if (editingId) {
        const oldData = epps.find(e => e.id === editingId);
        const newFields = {
          nombre_epp: form.nombre_epp,
          tipo_epp: form.tipo_epp,
          marca: form.marca || null,
          modelo: form.modelo || null,
          talla: form.talla || null,
          vida_util_dias: parseInt(form.vida_util_dias) || null,
          unidad: form.unidad || 'Und',
          stock_minimo: parseFloat(form.stock_minimo) || 0,
          precio_unitario_estimado: parseFloat(form.precio_unitario_estimado) || null,
          proveedor_principal_id: form.proveedor_principal_id || null,
          ubicacion_id: form.ubicacion_id || null,
        };
        await updateEpp(editingId, newFields);
        try { await window.__logAudit?.({ action:'update', table:'epps', recordId:editingId, oldData, newData:newFields }); } catch {}
        // Si el user adjuntó una foto nueva, la guardamos como evidencia.
        // No bloquea el flow si falla — el EPP queda igual y avisamos.
        if (foto?.blob && editingId) {
          try {
            await window.__saveEvidenciaLocal?.({
              id: window.__newId(),
              obra_id: obraId,
              tipo_evidencia: 'foto_epp',
              modulo_relacionado: 'epps',
              registro_relacionado_id: editingId,
              nombre_archivo: foto.blob.name || `epp_${editingId}.jpg`,
              mime_type: foto.blob.type || 'image/jpeg',
              blob: foto.blob,
              observaciones: `Foto referencial del EPP ${form.nombre_epp}`,
              fecha: new Date().toISOString().slice(0, 10),
              created_by: auth?.profile?.id || null,
            });
          } catch (e) {
            showToast('EPP guardado, pero la foto falló: ' + (e?.message || e), 'amber');
          }
        }
        showToast(`EPP "${form.nombre_epp}" actualizado`, 'green');
      } else {
        const stockInicial = parseFloat(form.stock_inicial) || 0;
        const stockMinimo = parseFloat(form.stock_minimo) || 0;
        const created = await createEpp({
          obra_id: obraId,
          nombre_epp: form.nombre_epp,
          tipo_epp: form.tipo_epp,
          marca: form.marca || null,
          modelo: form.modelo || null,
          talla: form.talla || null,
          vida_util_dias: parseInt(form.vida_util_dias) || null,
          unidad: form.unidad || 'Und',
          stock_inicial: stockInicial,
          stock_actual: stockInicial,
          stock_minimo: stockMinimo,
          precio_unitario_estimado: parseFloat(form.precio_unitario_estimado) || null,
          proveedor_principal_id: form.proveedor_principal_id || null,
          ubicacion_id: form.ubicacion_id || null,
          alerta: calcAlerta(stockInicial, stockMinimo),
          estado: 'activo',
        });
        try { await window.__logAudit?.({ action:'insert', table:'epps', recordId:created?.id, newData:created }); } catch {}
        // Si el user adjuntó una foto al crear, la guardamos como evidencia.
        if (foto?.blob && created?.id) {
          try {
            await window.__saveEvidenciaLocal?.({
              id: window.__newId(),
              obra_id: obraId,
              tipo_evidencia: 'foto_epp',
              modulo_relacionado: 'epps',
              registro_relacionado_id: created.id,
              nombre_archivo: foto.blob.name || `epp_${created.id}.jpg`,
              mime_type: foto.blob.type || 'image/jpeg',
              blob: foto.blob,
              observaciones: `Foto referencial del EPP ${form.nombre_epp}`,
              fecha: new Date().toISOString().slice(0, 10),
              created_by: auth?.profile?.id || null,
            });
          } catch (e) {
            showToast('EPP creado, pero la foto falló: ' + (e?.message || e), 'amber');
          }
        }
        showToast(`EPP "${form.nombre_epp}" creado`, 'green');
      }
      if (foto?.url) try { URL.revokeObjectURL(foto.url); } catch {}
      setFoto(null);
      setModal(null); setForm({}); setEditingId(null);
    } catch (e) {
      showToast('Error: ' + e.message, 'red');
    }
  };

  const handleDelete = async (e) => {
    if (!canDelete) return;
    if (!confirm(`¿Eliminar el EPP "${e.nombre_epp}"?`)) return;
    try {
      await updateEpp(e.id, { deleted_at: new Date().toISOString() });
      try { await window.__logAudit?.({ action:'delete', table:'epps', recordId:e.id, oldData:e, reason:'Eliminación manual' }); } catch {}
      showToast(`EPP eliminado`, 'amber');
    } catch (err) {
      showToast('Error: ' + err.message, 'red');
    }
  };

  const handleSubmitLote = async (tipo) => {
    const itemsValidos = loteItems.filter(it => it.epp_id && parseFloat(it.cantidad) > 0);
    if (itemsValidos.length === 0) {
      showToast('Agregá al menos un EPP con cantidad', 'red');
      return;
    }
    if (tipo === 'salida' && loteComunes.usarMismaPersona && !loteComunes.personal_id) {
      showToast('Seleccioná el trabajador que retira', 'red');
      return;
    }
    if (tipo === 'salida' && !firmaBlob) {
      showToast('La salida de EPPs requiere firma del trabajador', 'red');
      return;
    }

    let exitosos = 0, fallidos = 0;
    let firmaUrlCommon = null;
    // Subir firma una vez (si es salida y todos comparten persona)
    if (tipo === 'salida' && firmaBlob) {
      // Por ahora guardamos como evidencia local; EvidenceUploader la sube
      // y devuelve url_archivo. El movimiento_epp queda con firma_url=null
      // hasta que se sincronice (acceptable: firma física queda en blob local).
    }

    for (const it of itemsValidos) {
      const epp = epps.find(e => e.id === it.epp_id);
      if (!epp) { fallidos++; continue; }
      const cantNum = parseFloat(it.cantidad) || 0;
      const proveedor_id = tipo === 'ingreso'
        ? (loteComunes.usarMismoProveedor ? loteComunes.proveedor_id : it.proveedor_id) || null
        : null;
      const personal_id = tipo === 'salida'
        ? (loteComunes.usarMismaPersona ? loteComunes.personal_id : it.personal_id) || null
        : null;
      try {
        const movId = window.__newId();
        const movCreated = await movHook.create({
          obra_id: obraId,
          epp_id: it.epp_id,
          fecha: form.fecha,
          hora: form.hora,
          tipo_movimiento: tipo === 'ingreso' ? 'entrada' : 'salida',
          cantidad: cantNum,
          unidad: epp.unidad || 'Und',
          personal_id,
          proveedor_id,
          documento_asociado: form.documento || null,
          precio_unitario_real: parseFloat(it.precio) || null,
          motivo: form.motivo || (tipo === 'ingreso' ? 'reposicion' : 'dotacion'),
          observaciones: form.observaciones || null,
        });
        // Para SALIDA: guardar firma como evidencia vinculada al movimiento
        if (tipo === 'salida' && firmaBlob && exitosos === 0) {
          try {
            await window.__saveEvidenciaLocal?.({
              id: window.__newId(),
              obra_id: obraId,
              tipo_evidencia: 'firma_epp',
              modulo_relacionado: 'movimientos_epp',
              registro_relacionado_id: movCreated?.id,
              nombre_archivo: `firma_epp_${movCreated?.id}.png`,
              mime_type: 'image/png',
              blob: firmaBlob,
              observaciones: `Firma trabajador (lote ${itemsValidos.length} EPPs)`,
              fecha: form.fecha,
              created_by: auth?.profile?.id || null,
            });
          } catch {}
        }
        try { await window.__logAudit?.({ action:'insert', table:'movimientos_epp', recordId:movCreated?.id, newData:movCreated, reason:`${tipo} de ${cantNum} ${epp.nombre_epp}` }); } catch {}
        // Stock optimist
        const delta = tipo === 'ingreso' ? cantNum : -cantNum;
        const nuevoStock = (epp.stock_actual ?? 0) + delta;
        const minimo = Number(epp.stock_minimo || 0);
        const nuevaAlerta = nuevoStock <= 0 ? 'agotado'
          : minimo > 0 && nuevoStock <= minimo * 0.5 ? 'critico'
          : minimo > 0 && nuevoStock <= minimo ? 'reponer'
          : minimo > 0 && nuevoStock <= minimo * 1.2 ? 'cerca'
          : 'ok';
        await window.__db.epps.update(it.epp_id, {
          stock_actual: nuevoStock,
          alerta: nuevaAlerta,
        });
        exitosos++;
      } catch (e) {
        fallidos++;
      }
    }
    refresh();
    if (fallidos === 0) {
      showToast(`✓ ${exitosos} ${tipo === 'ingreso' ? 'ingresos' : 'salidas con firma'}`, 'green');
    } else {
      showToast(`⚠ ${exitosos} ok, ${fallidos} fallaron`, 'amber');
    }
    setModal(null);
    setForm({});
    setLoteItems([]);
    setFirmaBlob(null);
  };

  if (!obraId) {
    return <div className="page-wrap"><div className="empty-state"><JxIcon name="shield" size={32} color="var(--tm)"/><p>Selecciona una obra para ver EPPs.</p></div></div>;
  }
  if (loading) {
    return <div className="page-wrap"><div className="empty-state"><p>Cargando EPPs…</p></div></div>;
  }

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">EPPs (Inventario)</div>
          <div className="pg-sub">{epps.length} EPPs registrados · {epps.filter(e => ['critico','reponer','agotado','sin_stock'].includes(e.alerta)).length} alertas</div>
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {canWrite && <button className="btn btn-ghost btn-sm" onClick={openSalida}><JxIcon name="arrowOut" size={13}/>Registrar Salida</button>}
          {canWrite && <button className="btn btn-ghost btn-sm" onClick={openIngreso}><JxIcon name="arrowIn" size={13}/>Registrar Ingreso</button>}
          {canWrite ? (
            <button className="btn btn-amber btn-sm" onClick={openNuevo}><JxIcon name="plus" size={13}/>Nuevo EPP</button>
          ) : (
            <span className="badge b-gray" title="Tu rol es solo lectura para EPP">Solo lectura</span>
          )}
        </div>
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
        <div className="search-bar" style={{ flex:'1 1 220px' }}>
          <JxIcon name="search" size={14} color="var(--tm)"/>
          <input placeholder="Buscar por nombre, marca, talla…" value={q} onChange={e=>setQ(e.target.value)}/>
        </div>
        <select className="fi" value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={{ minWidth:160 }}>
          <option value="todos">Todos los tipos</option>
          {tiposDisponibles.map(t => <option key={t} value={t}>{t}</option>)}
          {CATALOGO_EPP.filter(c => c.tipo !== 'Otro' && !tiposDisponibles.includes(c.tipo)).map(c => (
            <option key={c.tipo} value={c.tipo}>{c.tipo}</option>
          ))}
        </select>
        <span style={{ fontSize:11, color:'var(--tm)' }}>{filtered.length} de {epps.length}</span>
      </div>

      {epps.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="shield" size={40} color="var(--tm)"/>
          <p>No hay EPPs registrados aún. Click "Nuevo EPP" para empezar.</p>
          <p style={{ fontSize:11.5, color:'var(--tm)', marginTop:6 }}>
            Tip: si tenés EPPs en el catálogo de Materiales, andá a Almacén → Materiales y usá el banner amarillo "Mover a EPPs" en el modal de edición.
          </p>
        </div>
      ) : (
      <div className="card" style={{ overflow:'hidden' }}>
        <div style={{ overflowX:'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>EPP</th>
                <th>Tipo</th>
                <th>Talla</th>
                <th style={{textAlign:'right'}}>Stock</th>
                <th style={{textAlign:'right'}}>Mín.</th>
                <th>Vida útil</th>
                <th>Estado</th>
                <th>Sync</th>
                <th style={{textAlign:'center'}}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {eppsPg.pagedItems.map(e => {
                const a = ALERTA_STYLE[e.alerta] || ALERTA_STYLE.ok;
                const stockColor = e.alerta === 'critico' || e.alerta === 'agotado' ? 'var(--red)'
                  : e.alerta === 'reponer' ? 'var(--yellow)' : 'var(--tp)';
                return (
                  <tr key={e.id}>
                    <td className="col-p">
                      {e.nombre_epp}
                      {e.marca && <div style={{ fontSize:10.5, color:'var(--tm)' }}>{e.marca} {e.modelo || ''}</div>}
                    </td>
                    <td><span className="tag">{e.tipo_epp}</span></td>
                    <td className="col-m">{e.talla || '—'}</td>
                    <td style={{textAlign:'right'}} className="col-num">
                      <span style={{ color: stockColor, fontWeight: 600 }}>{Number(e.stock_actual ?? 0).toLocaleString('es-PE')}</span>
                      <span style={{ color:'var(--tm)', fontSize:10.5, marginLeft:4 }}>{e.unidad}</span>
                    </td>
                    <td style={{textAlign:'right'}} className="col-num">{Number(e.stock_minimo ?? 0).toLocaleString('es-PE')}</td>
                    <td className="col-m">{e.vida_util_dias ? `${e.vida_util_dias} días` : '—'}</td>
                    <td><span className={`badge ${a.class}`}>{a.label}</span></td>
                    <td>{e.sync_status && e.sync_status !== 'synced'
                      ? <span className="badge b-amber">⏱</span>
                      : <span style={{color:'var(--green)',fontSize:11}}>✓</span>}</td>
                    <td style={{textAlign:'center', whiteSpace:'nowrap'}}>
                      <button className="btn btn-ghost btn-xs" title="Editar" onClick={() => openEditar(e)}>
                        <JxIcon name="edit" size={11}/>
                      </button>
                      {canDelete && (
                        <button className="btn btn-red btn-xs" title="Eliminar" onClick={() => handleDelete(e)} style={{ marginLeft:4 }}>
                          <JxIcon name="trash" size={11}/>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <TablePagination {...eppsPg} />
      </div>
      )}

      {/* ── Modal Nuevo / Editar EPP ───────────────────── */}
      {(modal === 'nuevo' || modal === 'editar') && (
        <Modal title={editingId ? 'Editar EPP' : 'Nuevo EPP'} icon="shield" onClose={() => { setModal(null); setEditingId(null); setForm({}); }}>
          <div className="g2">
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Nombre *</label>
              <input className="fi" placeholder="Ej: Casco MSA V-Gard amarillo"
                     value={form.nombre_epp || ''}
                     onChange={ev => setForm({ ...form, nombre_epp: ev.target.value })}/>
            </div>
            <div>
              <label className="flabel">Tipo *</label>
              <select className="fi" value={form.tipo_epp || ''}
                      onChange={ev => {
                        const tipo = ev.target.value;
                        const cat = epppTipo(tipo);
                        setForm({ ...form, tipo_epp: tipo, vida_util_dias: cat?.vida_util_dias ?? form.vida_util_dias });
                      }}>
                {CATALOGO_EPP.map(c => <option key={c.tipo} value={c.tipo}>{c.tipo}</option>)}
              </select>
            </div>
            <div>
              <label className="flabel">Vida útil (días)</label>
              <input className="fi" type="number" min="0" placeholder="365"
                     value={form.vida_util_dias || ''}
                     onChange={ev => setForm({ ...form, vida_util_dias: ev.target.value })}/>
            </div>
            <div><label className="flabel">Marca</label><input className="fi" value={form.marca || ''} onChange={ev => setForm({ ...form, marca: ev.target.value })}/></div>
            <div><label className="flabel">Modelo</label><input className="fi" value={form.modelo || ''} onChange={ev => setForm({ ...form, modelo: ev.target.value })}/></div>
            <div><label className="flabel">Talla</label><input className="fi" placeholder="S/M/L o número" value={form.talla || ''} onChange={ev => setForm({ ...form, talla: ev.target.value })}/></div>
            <div><label className="flabel">Unidad</label><input className="fi" value={form.unidad || 'Und'} onChange={ev => setForm({ ...form, unidad: ev.target.value })}/></div>
            {!editingId && (
              <div>
                <label className="flabel">Stock inicial</label>
                <input className="fi" type="number" min="0" step="0.01" value={form.stock_inicial || ''} onChange={ev => setForm({ ...form, stock_inicial: ev.target.value })}/>
              </div>
            )}
            <div>
              <label className="flabel">Stock mínimo</label>
              <input className="fi" type="number" min="0" step="0.01" value={form.stock_minimo || ''} onChange={ev => setForm({ ...form, stock_minimo: ev.target.value })}/>
            </div>
            <div>
              <label className="flabel">Precio estimado (S/)</label>
              <input className="fi" type="number" step="0.01" value={form.precio_unitario_estimado || ''} onChange={ev => setForm({ ...form, precio_unitario_estimado: ev.target.value })}/>
            </div>
            {/* Foto del EPP — sube como evidencia foto_epp */}
            {(() => {
              const fotoExistente = editingId ? fotosMap.get(editingId) : null;
              const tieneNueva = !!foto?.url;
              const tieneExistente = !!fotoExistente?.url && !tieneNueva;
              const labelBoton = tieneNueva
                ? 'Cambiar la nueva foto'
                : (fotoExistente ? 'Reemplazar foto guardada' : 'Adjuntar foto');
              return (
                <div style={{ gridColumn:'1/-1' }}>
                  <label className="flabel">
                    Foto del EPP {fotoExistente && !tieneNueva && (
                      <span style={{ fontSize:11, color:'var(--green)', fontWeight:500 }}> · ya tiene foto</span>
                    )}
                  </label>
                  <div style={{ display:'flex', gap:10, alignItems:'flex-start', flexWrap:'wrap' }}>
                    <label className="btn btn-ghost btn-sm" style={{ cursor:'pointer' }}>
                      <JxIcon name="camera" size={13}/> {labelBoton}
                      <input type="file" accept="image/*" capture="environment" style={{ display:'none' }}
                             onChange={handleFotoChangeEpp}/>
                    </label>
                    {tieneNueva && (
                      <div style={{ position:'relative' }}>
                        <img src={foto.url} alt="nueva foto" style={{ width:80, height:80, objectFit:'cover', borderRadius:6, border:'2px solid var(--green)' }}/>
                        <div style={{ position:'absolute', bottom:-8, left:0, right:0, textAlign:'center', fontSize:9, color:'var(--green)', fontWeight:600 }}>NUEVA</div>
                        <button type="button" onClick={() => { if (foto.url) try { URL.revokeObjectURL(foto.url); } catch {} setFoto(null); }}
                          style={{ position:'absolute', top:-6, right:-6, width:20, height:20, borderRadius:'50%', background:'var(--red)', color:'white', border:'none', fontSize:11, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}
                          title="Cancelar nueva foto">×</button>
                      </div>
                    )}
                    {tieneExistente && (
                      <div style={{ position:'relative' }}>
                        <img src={fotoExistente.url} alt="foto actual" style={{ width:80, height:80, objectFit:'cover', borderRadius:6, border:'1px solid var(--bd)' }}/>
                        <div style={{ position:'absolute', bottom:-8, left:0, right:0, textAlign:'center', fontSize:9, color:'var(--tm)' }}>ACTUAL</div>
                      </div>
                    )}
                    {!tieneNueva && !fotoExistente && (
                      <span style={{ fontSize:11, color:'var(--tm)', alignSelf:'center' }}>
                        Sin foto. Adjuntá una para que el trabajador la identifique al recibirlo.
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => { if (foto?.url) try { URL.revokeObjectURL(foto.url); } catch {} setFoto(null); setModal(null); setEditingId(null); setForm({}); }}>Cancelar</button>
            <button className="btn btn-amber" onClick={handleSubmitEpp}>
              <JxIcon name="check" size={13}/>{editingId ? 'Guardar Cambios' : 'Crear EPP'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Modal Ingreso (lote) ───────────────────── */}
      {modal === 'ingreso' && (
        <Modal title="Registrar Ingreso de EPPs (lote)" icon="arrowIn" onClose={() => setModal(null)} wide>
          <div className="g2">
            <div><label className="flabel">Fecha</label><input className="fi" type="date" max={new Date().toISOString().slice(0,10)} value={form.fecha||''} onChange={e=>setForm({...form, fecha:e.target.value})}/></div>
            <div><label className="flabel">Hora</label><input className="fi" type="time" value={form.hora||''} onChange={e=>setForm({...form, hora:e.target.value})}/></div>
            <div><label className="flabel">Documento / Guía</label><input className="fi" value={form.documento||''} onChange={e=>setForm({...form, documento:e.target.value})}/></div>
          </div>
          <div style={{ marginTop:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--ts)', marginBottom:6, display:'flex', justifyContent:'space-between' }}>
              <span>EPPs a ingresar ({loteItems.length})</span>
              <button type="button" className="btn btn-ghost btn-xs" onClick={addLoteItem}>
                <JxIcon name="plus" size={11}/> Agregar fila
              </button>
            </div>
            <div style={{ overflowX:'auto' }}>
              <table className="tbl" style={{ fontSize:12 }}>
                <thead>
                  <tr>
                    <th style={{ minWidth:240 }}>EPP</th>
                    <th style={{ width:90 }}>Talla</th>
                    <th style={{ width:110 }}>Cantidad *</th>
                    <th style={{ width:110 }}>Precio S/</th>
                    <th style={{ width:40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {loteItems.map(it => {
                    const epp = epps.find(e => e.id === it.epp_id);
                    return (
                      <tr key={it.id}>
                        <td>
                          <SearchableSelect
                            value={it.epp_id}
                            onChange={v => updateLoteItem(it.id, { epp_id: v })}
                            options={[
                              { value: '', label: '— Selecciona —' },
                              ...epps.map(e => ({ value: e.id, label: e.nombre_epp })),
                            ]}
                            fontSize={12}
                            placeholder="— Selecciona —"/>
                        </td>
                        <td style={{ color:'var(--tm)' }}>{epp?.talla || '—'}</td>
                        <td><input className="fi" type="number" min="0" step="0.01" value={it.cantidad} style={{ fontSize:12 }}
                                   onChange={e => updateLoteItem(it.id, { cantidad: e.target.value })}/></td>
                        <td><input className="fi" type="number" step="0.01" value={it.precio} style={{ fontSize:12 }}
                                   onChange={e => updateLoteItem(it.id, { precio: e.target.value })}/></td>
                        <td>
                          {loteItems.length > 1 && (
                            <button type="button" className="btn btn-ghost btn-xs" onClick={() => removeLoteItem(it.id)} style={{ color:'var(--red)' }}>
                              <JxIcon name="x" size={11}/>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ marginTop:14 }}>
            <label className="flabel">Observaciones</label>
            <textarea className="fi" value={form.observaciones||''} onChange={e=>setForm({...form, observaciones:e.target.value})}/>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-amber" onClick={() => handleSubmitLote('ingreso')}>
              <JxIcon name="check" size={13}/>Registrar Ingreso ({loteItems.filter(it => it.epp_id && parseFloat(it.cantidad) > 0).length})
            </button>
          </div>
        </Modal>
      )}

      {/* ── Modal Salida con firma (lote) ────────────────── */}
      {modal === 'salida' && (
        <Modal title="Registrar Salida de EPPs (con firma)" icon="arrowOut" onClose={() => setModal(null)} wide>
          <div className="g2">
            <div><label className="flabel">Fecha</label><input className="fi" type="date" max={new Date().toISOString().slice(0,10)} value={form.fecha||''} onChange={e=>setForm({...form, fecha:e.target.value})}/></div>
            <div><label className="flabel">Hora</label><input className="fi" type="time" value={form.hora||''} onChange={e=>setForm({...form, hora:e.target.value})}/></div>
            <div>
              <label className="flabel">Motivo</label>
              <select className="fi" value={form.motivo || 'dotacion'} onChange={e => setForm({ ...form, motivo: e.target.value })}>
                <option value="dotacion">Dotación inicial</option>
                <option value="reposicion">Reposición</option>
                <option value="cambio">Cambio por desgaste</option>
                <option value="perdida">Reposición por pérdida</option>
              </select>
            </div>
          </div>

          <div style={{ marginTop:12, padding:'10px 12px', background:'rgba(231,76,60,0.06)', border:'1px solid rgba(231,76,60,0.3)', borderRadius:6 }}>
            <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12.5, color:'var(--tp)', cursor:'pointer' }}>
              <input type="checkbox" checked={loteComunes.usarMismaPersona}
                     onChange={e => setLoteComunes(c => ({ ...c, usarMismaPersona: e.target.checked }))}/>
              <span><strong>Todos los EPPs los retira la misma persona</strong></span>
            </label>
            {loteComunes.usarMismaPersona && (
              <div style={{ marginTop:8 }}>
                <SearchableSelect
                  value={loteComunes.personal_id}
                  onChange={v => setLoteComunes(c => ({ ...c, personal_id: v || null }))}
                  options={[
                    { value: '', label: '— Selecciona trabajador —' },
                    ...personal.filter(p => p.estado === 'activo').map(p => ({
                      value: p.id,
                      label: `${p.nombres} ${p.apellidos} · DNI ${p.dni || '—'}`.trim(),
                    })),
                  ]}
                  placeholder="— Selecciona trabajador —"/>
              </div>
            )}
          </div>

          <div style={{ marginTop:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--ts)', marginBottom:6, display:'flex', justifyContent:'space-between' }}>
              <span>EPPs a entregar ({loteItems.length})</span>
              <button type="button" className="btn btn-ghost btn-xs" onClick={addLoteItem}>
                <JxIcon name="plus" size={11}/> Agregar fila
              </button>
            </div>
            <div style={{ overflowX:'auto' }}>
              <table className="tbl" style={{ fontSize:12 }}>
                <thead>
                  <tr>
                    <th style={{ minWidth:240 }}>EPP</th>
                    <th style={{ width:90 }}>Talla</th>
                    <th style={{ width:110 }}>Cantidad *</th>
                    <th style={{ width:90 }}>Stock</th>
                    {!loteComunes.usarMismaPersona && <th style={{ minWidth:180 }}>Quien retira</th>}
                    <th style={{ width:40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {loteItems.map(it => {
                    const epp = epps.find(e => e.id === it.epp_id);
                    const cant = parseFloat(it.cantidad) || 0;
                    const stockOk = (epp?.stock_actual ?? 0) >= cant;
                    return (
                      <tr key={it.id}>
                        <td>
                          <SearchableSelect
                            value={it.epp_id}
                            onChange={v => updateLoteItem(it.id, { epp_id: v })}
                            options={[
                              { value: '', label: '— Selecciona —' },
                              ...epps.map(e => ({ value: e.id, label: e.nombre_epp })),
                            ]}
                            fontSize={12}
                            placeholder="— Selecciona —"/>
                        </td>
                        <td style={{ color:'var(--tm)' }}>{epp?.talla || '—'}</td>
                        <td><input className="fi" type="number" min="0" step="0.01" value={it.cantidad} style={{ fontSize:12 }}
                                   onChange={e => updateLoteItem(it.id, { cantidad: e.target.value })}/></td>
                        <td>
                          {epp ? (
                            <span style={{ color: stockOk ? 'var(--green)' : 'var(--red)', fontWeight:600, fontSize:11 }}>
                              {stockOk ? '✓' : '⚠'} {epp.stock_actual}
                            </span>
                          ) : '—'}
                        </td>
                        {!loteComunes.usarMismaPersona && (
                          <td>
                            <SearchableSelect
                              value={it.personal_id}
                              onChange={v => updateLoteItem(it.id, { personal_id: v || null })}
                              options={[
                                { value: '', label: '—' },
                                ...personal.filter(p => p.estado === 'activo').map(p => ({
                                  value: p.id,
                                  label: `${p.nombres} ${p.apellidos}`.trim(),
                                })),
                              ]}
                              fontSize={12}
                              placeholder="—"/>
                          </td>
                        )}
                        <td>
                          {loteItems.length > 1 && (
                            <button type="button" className="btn btn-ghost btn-xs" onClick={() => removeLoteItem(it.id)} style={{ color:'var(--red)' }}>
                              <JxIcon name="x" size={11}/>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ marginTop:16 }}>
            <label className="flabel">Firma del trabajador * <span style={{ color:'var(--red)' }}>(obligatorio para SUNAFIL)</span></label>
            <SignaturePad onChange={setFirmaBlob}/>
          </div>

          <div style={{ marginTop:14 }}>
            <label className="flabel">Observaciones</label>
            <textarea className="fi" rows={2} value={form.observaciones||''} onChange={e=>setForm({...form, observaciones:e.target.value})}/>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-amber" onClick={() => handleSubmitLote('salida')}>
              <JxIcon name="check" size={13}/>Registrar Salida con firma ({loteItems.filter(it => it.epp_id && parseFloat(it.cantidad) > 0).length})
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { EppsInventarioPage });
export { EppsInventarioPage };
