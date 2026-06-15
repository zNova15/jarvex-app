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
import { getDesgloseBulk, aplicarDelta, traspasar } from "../lib/stock-ubicaciones.js";
import { getEvidenciaSrc } from "../lib/evidencias-url.js";
import { DesglosePopup, TraspasoStockModal, ubicacionAutoOrigen, validarSalidaUbic } from "./jx-stock-ubic.jsx";
import { detectarSugerencias, detectarDuplicados, fusionarInsumos } from "../lib/variantes.js";
import { usePagination } from "../hooks/usePagination.js";
import { TablePagination } from "./jx-pagination.jsx";
import { SearchableSelect } from "./jx-searchable-select.jsx";
import { opcionesDestinoFlat, splitDestino } from "../lib/destino-mov.js";
import { exportarDataset } from "../lib/export-historico.js";
import { PrecioHistorialModal } from "./jx-precio-historial.jsx";
import { registrarSoloHistorial, registrarCambioPrecio } from "../lib/precio-historial.js";
import { getCurrentMode } from "../hooks/useAppMode.js";

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
  const superAdmin = !!appMode.superAdmin;
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
  const { data: subcontratistas = [] } = window.__hooks.useSubcontratistas?.() || { data: [] };
  // Destino de salida EPP: personal activo + subcontratos (Fase B)
  const destinoOptsEpp = uM(() => opcionesDestinoFlat((personal || []).filter(p => p.estado === 'activo'), subcontratistas), [personal, subcontratistas]);

  // Ubicaciones (almacenes) de la obra + desglose de stock por ubicación.
  const { data: ubicaciones = [] } = window.__hooks.useUbicacionesObra?.(obraId) || { data: [] };
  const ubicacionesActivas = uM(() => (ubicaciones || []).filter(u => u.activo !== false && !u.deleted_at), [ubicaciones]);
  const ubicacionesById = uM(() => { const m = new Map(); (ubicaciones || []).forEach(u => m.set(u.id, u)); return m; }, [ubicaciones]);
  const [desgloseUbic, setDesgloseUbic] = uS(() => new Map()); // Map(epp_id → Map(ubic_id → cant))
  uE(() => {
    if (!obraId) return;
    let cancelled = false;
    const cargar = async () => {
      try { const m = await getDesgloseBulk('epp', (epps || []).map(e => e.id)); if (!cancelled) setDesgloseUbic(m); }
      catch (err) { console.warn('[epp desglose]', err?.message); }
    };
    cargar();
    const onCh = (e) => { const t = e?.detail?.tabla || e?.detail?.table; if (!t || t === 'stock_ubicaciones') cargar(); };
    window.addEventListener('jx_data_changed', onCh);
    return () => { cancelled = true; window.removeEventListener('jx_data_changed', onCh); };
  }, [obraId, epps]);
  const [popupEpp, setPopupEpp] = uS(null);       // EPP para el popup de desglose
  const [traspasoPreId, setTraspasoPreId] = uS(''); // EPP preseleccionado en traspaso

  // Stock VIVO calculado desde movimientos_epp (entradas − salidas). El campo
  // epps.stock_actual es denormalizado y puede quedar desfasado (p. ej. cuando
  // una reimportación deduplica todos los movimientos y no dispara el recálculo,
  // o cuando los movimientos vienen de la migración / compras / entregas). Para
  // que el inventario NUNCA muestre 0 habiendo movimientos, mostramos y validamos
  // contra el stock vivo y dejamos stock_actual solo como respaldo.
  const movEppLive = movHook.data || [];
  const liveStockById = uM(() => {
    const m = new Map();
    for (const mv of movEppLive) {
      if (mv.deleted_at) continue;
      const c = Number(mv.cantidad || 0);
      if (!c) continue;
      const prev = m.get(mv.epp_id) || 0;
      if (mv.tipo_movimiento === 'entrada') m.set(mv.epp_id, prev + c);
      else if (mv.tipo_movimiento === 'salida') m.set(mv.epp_id, prev - c);
    }
    return m;
  }, [movEppLive]);
  const stockDe = (e) => liveStockById.has(e?.id) ? Math.max(0, liveStockById.get(e.id)) : Number(e?.stock_actual ?? 0);
  const alertaDe = (e) => calcAlerta(stockDe(e), Number(e?.stock_minimo || 0));

  // ── Variantes padre-hijo (SKU) ──────────────────────────────────────
  // Un grupo (es_grupo) agrupa variantes (padre_id = grupo.id). El stock del
  // grupo es la suma de sus variantes; un grupo no recibe movimientos.
  const childrenByPadre = uM(() => {
    const m = new Map();
    for (const e of (epps || [])) {
      if (e.padre_id) { const arr = m.get(e.padre_id) || []; arr.push(e); m.set(e.padre_id, arr); }
    }
    return m;
  }, [epps]);
  const variantesDe = (g) => childrenByPadre.get(g.id) || [];
  const stockDeNodo = (e) => e.es_grupo ? variantesDe(e).reduce((s, c) => s + stockDe(c), 0) : stockDe(e);
  const alertaDeNodo = (e) => e.es_grupo ? calcAlerta(stockDeNodo(e), Number(e.stock_minimo || 0)) : alertaDe(e);
  const [expandedGroups, setExpandedGroups] = uS(() => new Set());
  const toggleGroup = (id) => setExpandedGroups(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Detección de genéricos (lib compartida): sueltos que comparten palabra base
  // → sugerencia de CREAR grupo, o de AÑADIR a un grupo ya existente (caso
  // "ZAPATOS38" corregido cuando ya existe el grupo "Zapatos").
  const sugerenciasGrupo = uM(() => detectarSugerencias(epps, 'nombre_epp'), [epps]);
  const duplicados = uM(() => detectarDuplicados(epps, 'nombre_epp'), [epps]);
  const [sugDescartadas, setSugDescartadas] = uS(() => new Set());
  const [grupoModal, setGrupoModal] = uS(null); // { titulo, items } para confirmar agrupación
  const [dupModal, setDupModal] = uS(null);     // { grupo:{nombre,items}, survivorId }

  // Añadir ítems sueltos a un grupo existente (sugerencia tipo 'add').
  const agregarAGrupo = async (grupo, items) => {
    try {
      for (const it of items) {
        await updateEpp(it.id, { padre_id: grupo.id, updated_at: new Date().toISOString(), version: (it.version ?? 0) + 1, sync_status: it.sync_status === 'pending_create' ? 'pending_create' : 'pending_update' });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'epps' } })); } catch {}
      setExpandedGroups(s => new Set(s).add(grupo.id));
      showToast(`✓ ${items.length} agregado(s) a "${grupo.nombre_epp}"`, 'green'); refresh?.();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  // Fusionar duplicados en un sobreviviente (mueve movimientos + stock).
  const [dupBusy, setDupBusy] = uS(false);
  const fusionarDuplicado = async () => {
    if (!dupModal?.survivorId || dupBusy) return;
    setDupBusy(true);
    try {
      const userId = auth?.profile?.id || null;
      const dupIds = dupModal.grupo.items.map(i => i.id).filter(id => id !== dupModal.survivorId);
      const r = await fusionarInsumos({
        db: window.__db, tabla: 'epps', movTabla: 'movimientos_epp', fk: 'epp_id',
        itemTipoStock: 'epp', userId, calcAlerta,
      }, dupModal.survivorId, dupIds);
      try { await window.__logAudit?.({ action: 'update', table: 'epps', reason: `Fusionar ${dupIds.length} EPP duplicado(s) en uno` }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'epps' } })); } catch {}
      showToast(`✓ Fusionado · ${r.movidos} movimientos reasignados · stock ${r.stockFinal}`, 'green');
      setDupModal(null); refresh?.();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setDupBusy(false); }
  };

  // Crea un grupo padre y reasigna los ítems como sus variantes.
  const crearGrupoCon = async (titulo, items) => {
    const nombre = (titulo || '').trim();
    if (!nombre || !items?.length) return;
    try {
      const padre = await createEpp({
        obra_id: obraId, nombre_epp: nombre, tipo_epp: items[0]?.tipo_epp || 'Otro',
        unidad: items[0]?.unidad || 'Und', es_grupo: true,
        stock_inicial: 0, stock_actual: 0, stock_minimo: 0, alerta: 'ok', estado: 'activo',
      });
      const padreId = padre?.id;
      if (!padreId) throw new Error('No se pudo crear el grupo');
      for (const it of items) {
        await updateEpp(it.id, {
          padre_id: padreId,
          updated_at: new Date().toISOString(),
          version: (it.version ?? 0) + 1,
          sync_status: it.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      }
      try { await window.__logAudit?.({ action: 'update', table: 'epps', reason: `Agrupar ${items.length} EPP como variantes de "${nombre}"` }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'epps' } })); } catch {}
      setExpandedGroups(s => new Set(s).add(padreId));
      showToast(`✓ "${nombre}" creado con ${items.length} variantes`, 'green');
      setGrupoModal(null); refresh?.();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  // Deshacer grupo: las variantes vuelven a ser ítems sueltos y se borra el padre.
  const eliminarGrupo = async (g) => {
    const hijos = variantesDe(g);
    if (!confirm(`¿Deshacer el grupo "${g.nombre_epp}"?\n\nSus ${hijos.length} variantes vuelven a ser EPP sueltos (no se borran). El grupo se elimina.`)) return;
    try {
      for (const h of hijos) {
        await updateEpp(h.id, { padre_id: null, updated_at: new Date().toISOString(), version: (h.version ?? 0) + 1, sync_status: h.sync_status === 'pending_create' ? 'pending_create' : 'pending_update' });
      }
      await updateEpp(g.id, { deleted_at: new Date().toISOString(), version: (g.version ?? 0) + 1, sync_status: g.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete' });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'epps' } })); } catch {}
      showToast('Grupo deshecho', 'amber'); refresh?.();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  // Render de una fila de inventario (ítem suelto o variante anidada).
  const filaEpp = (e, esHijo) => {
    const aler = alertaDe(e);
    const a = ALERTA_STYLE[aler] || ALERTA_STYLE.ok;
    const stockColor = aler === 'critico' || aler === 'agotado' ? 'var(--red)' : aler === 'reponer' ? 'var(--yellow)' : 'var(--tp)';
    return (
      <tr key={e.id} style={esHijo ? { background: 'rgba(255,255,255,0.015)' } : undefined}>
        <td className="col-p" style={esHijo ? { paddingLeft: 26 } : undefined}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {esHijo && <span style={{ color: 'var(--tm)' }}>└</span>}
            {(() => {
              const f = fotosMap.get(e.id);
              return f ? (
                <img src={f.url} alt="foto" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--bd)', flexShrink: 0, cursor: 'pointer' }}
                     onClick={(ev) => { ev.stopPropagation(); window.open(f.url, '_blank'); }} title="Click para ampliar" />
              ) : (
                <div style={{ width: 32, height: 32, borderRadius: 4, background: 'rgba(255,255,255,0.04)', border: '1px dashed var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} title="Sin foto">
                  <JxIcon name="image" size={12} color="var(--tm)" />
                </div>
              );
            })()}
            <div>
              <span>{e.nombre_epp}</span>
              {e.marca && <div style={{ fontSize:10.5, color:'var(--tm)' }}>{e.marca} {e.modelo || ''}</div>}
            </div>
          </div>
        </td>
        <td>{(() => {
          const dg = desgloseUbic.get(e.id);
          const entradas = dg ? Array.from(dg.entries()).filter(([, c]) => Number(c) > 0) : [];
          if (entradas.length === 0) return <span style={{ color: 'var(--tm)', fontSize: 11 }}>—</span>;
          const resumen = entradas.length === 1 ? (ubicacionesById.get(entradas[0][0])?.nombre || 'Almacén') : `${entradas.length} almacenes`;
          return <button className="btn btn-ghost btn-xs" title="Ver stock por ubicación" onClick={() => setPopupEpp(e)}><JxIcon name="map" size={11} /> {resumen}</button>;
        })()}</td>
        <td className="col-m">{e.talla || '—'}</td>
        <td style={{textAlign:'right'}} className="col-num">
          <span style={{ color: stockColor, fontWeight: 600 }}>{stockDe(e).toLocaleString('es-PE')}</span>
          <span style={{ color:'var(--tm)', fontSize:10.5, marginLeft:4 }}>{e.unidad}</span>
        </td>
        <td style={{textAlign:'right'}} className="col-num">{Number(e.stock_minimo ?? 0).toLocaleString('es-PE')}</td>
        <td className="col-m">{e.vida_util_dias ? `${e.vida_util_dias} días` : '—'}</td>
        <td><span className={`badge ${a.class}`}>{a.label}</span></td>
        <td>{e.sync_status && e.sync_status !== 'synced' ? <span className="badge b-amber">⏱</span> : <span style={{color:'var(--green)',fontSize:11}}>✓</span>}</td>
        <td style={{textAlign:'center', whiteSpace:'nowrap'}}>
          <button className="btn btn-ghost btn-xs" title="Historial de precios" onClick={() => setHistPrecioItem(e)}><JxIcon name="dollar" size={11}/></button>
          <button className="btn btn-ghost btn-xs" title="Editar" onClick={() => openEditar(e)} style={{ marginLeft:4 }}><JxIcon name="edit" size={11}/></button>
          {canDelete && <button className="btn btn-red btn-xs" title="Eliminar" onClick={() => handleDelete(e)} style={{ marginLeft:4 }}><JxIcon name="trash" size={11}/></button>}
        </td>
      </tr>
    );
  };

  // NOTA: no auto-reparamos epps.stock_actual desde acá. La pantalla y la
  // validación ya usan el stock VIVO (stockDe), así que persistir el campo
  // denormalizado solo generaba escrituras repetidas (pending_update) en cada
  // montaje cuando el server no las retenía → la UI titilaba y se trababa. Si
  // hiciera falta sanear el campo en la BD, se hace una sola vez al importar
  // (recalcularStockEpp) o con un botón manual, nunca en un efecto de render.
  // Recálculo bajo demanda (botón "Recalcular stock"): persiste el stock vivo.
  const [recalcBusy, setRecalcBusy] = uS(false);
  const recalcularStockManual = async () => {
    if (recalcBusy) return;
    setRecalcBusy(true);
    let n = 0;
    try {
      for (const e of (epps || [])) {
        if (e.es_grupo || e.deleted_at) continue;
        if (!liveStockById.has(e.id)) continue;
        const live = Math.max(0, liveStockById.get(e.id));
        if (live === Number(e.stock_actual ?? 0)) continue;
        await window.__db.epps.update(e.id, {
          stock_actual: live, alerta: calcAlerta(live, Number(e.stock_minimo || 0)),
          updated_at: new Date().toISOString(), version: (e.version ?? 0) + 1,
          sync_status: e.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
        n++;
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'epps' } })); } catch {}
      showToast(n ? `✓ Stock recalculado en ${n} EPP` : 'El stock ya estaba al día', 'green');
      refresh?.();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setRecalcBusy(false); }
  };

  const [q, setQ] = uS('');
  const [filtroTipo, setFiltroTipo] = uS('todos');
  const [histPrecioItem, setHistPrecioItem] = uS(null); // EPP para el visor de historial de precios
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
          const src = await getEvidenciaSrc(ev);
          if (src?.url) {
            if (src.isBlob) blobUrlsLocales.push(src.url);
            map.set(ev.registro_relacionado_id, { url: src.url, isRemote: !src.isBlob });
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

  const matchEpp = (e) => {
    if (filtroTipo !== 'todos' && e.tipo_epp !== filtroTipo) return false;
    if (!q) return true;
    const ql = q.toLowerCase();
    return e.nombre_epp?.toLowerCase().includes(ql) || e.tipo_epp?.toLowerCase().includes(ql)
      || e.marca?.toLowerCase().includes(ql) || e.talla?.toLowerCase().includes(ql);
  };
  // Nivel superior = ítems sin padre (grupos + sueltos). Un grupo aparece si
  // él o alguna de sus variantes hace match; las variantes se renderizan
  // anidadas bajo su grupo (ver tbody).
  const filtered = uM(() => {
    const top = (epps || []).filter(e => !e.padre_id);
    return top.filter(e => e.es_grupo ? (matchEpp(e) || variantesDe(e).some(matchEpp)) : matchEpp(e));
  }, [epps, q, filtroTipo, childrenByPadre]);

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
    setForm({ ...e, fecha_registro: (e.created_at || '').slice(0, 10) });
    setEditingId(e.id);
    if (foto?.url) try { URL.revokeObjectURL(foto.url); } catch {}
    setFoto(null);
    setModal('editar');
  };
  // Almacén por defecto: si hay uno solo, se autocompleta.
  const ubicacionDefault = () => (ubicacionesActivas.length === 1 ? ubicacionesActivas[0].id : '');
  const openIngreso = () => {
    setForm({
      fecha: new Date().toISOString().slice(0, 10),
      hora: new Date().toTimeString().slice(0, 5),
    });
    setLoteItems([{ id: crypto.randomUUID(), epp_id:'', cantidad:'', precio:'', proveedor_id:null }]);
    setLoteComunes({ usarMismoProveedor: true, usarMismaPersona: true, proveedor_id: null, personal_id: null, ubicacion_id: ubicacionDefault() });
    setModal('ingreso');
  };
  const openSalida = () => {
    setForm({
      fecha: new Date().toISOString().slice(0, 10),
      hora: new Date().toTimeString().slice(0, 5),
    });
    setLoteItems([{ id: crypto.randomUUID(), epp_id:'', cantidad:'', talla:'' }]);
    setLoteComunes({ usarMismoProveedor: true, usarMismaPersona: true, proveedor_id: null, personal_id: null, ubicacion_id: ubicacionDefault() });
    setFirmaBlob(null);
    setModal('salida');
  };
  const openTraspaso = (preId = '') => { setTraspasoPreId(preId || ''); setModal('traspaso'); };

  // Traspaso EPP entre almacenes: mueve stock_ubicaciones + 2 movimientos de trazabilidad.
  const ejecutarTraspasoEpp = async ({ item_id, origenId, destinoId, cantidad }) => {
    try {
      await traspasar({ obraId, itemTipo: 'epp', itemId: item_id, origenId, destinoId, cantidad, userId: auth?.profile?.id || null });
      const epp = epps.find(e => e.id === item_id);
      const uO = ubicacionesById.get(origenId)?.nombre || 'origen';
      const uD = ubicacionesById.get(destinoId)?.nombre || 'destino';
      const key = `traspaso-epp-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
      const base = { obra_id: obraId, epp_id: item_id, fecha: new Date().toISOString().slice(0,10), cantidad, unidad: epp?.unidad || 'Und', personal_id: null, proveedor_id: null, motivo: 'traspaso' };
      await movHook.create({ ...base, tipo_movimiento: 'salida', ubicacion_id: origenId, observaciones: `Traspaso → ${uD}`, idempotency_key: `${key}_out` });
      await movHook.create({ ...base, tipo_movimiento: 'entrada', ubicacion_id: destinoId, observaciones: `Traspaso ← ${uO}`, idempotency_key: `${key}_in` });
      try { await window.__logAudit?.({ action:'update', table:'stock_ubicaciones', recordId:item_id, reason:`Traspaso ${cantidad} ${epp?.nombre_epp||''}: ${uO} → ${uD}` }); } catch {}
      showToast(`Traspaso: ${cantidad} de ${uO} → ${uD}`, 'green');
      setModal(null); refresh();
    } catch (e) { showToast('Error en traspaso: ' + (e.message || e), 'red'); }
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
          padre_id: form.padre_id || null,
        };
        // Super Admin: corregir fecha de registro (created_at)
        if (superAdmin && form.fecha_registro && form.fecha_registro !== (oldData?.created_at || '').slice(0, 10)) {
          newFields.created_at = new Date(form.fecha_registro + 'T12:00:00').toISOString();
        }
        await updateEpp(editingId, newFields);
        try { await window.__logAudit?.({ action:'update', table:'epps', recordId:editingId, oldData, newData:newFields }); } catch {}
        // Historial de precio: si cambió el precio estimado, dejamos la fila
        // 'manual' (el form ya persistió el nuevo precio en newFields).
        try {
          const registrado = await registrarSoloHistorial({
            itemTipo: 'epp', itemId: editingId, obraId,
            precioAnterior: oldData?.precio_unitario_estimado,
            precioNuevo: newFields.precio_unitario_estimado,
            fuente: 'manual', motivo: 'Edición manual del precio',
            // La demo-ness sigue al ÍTEM (editar un EPP real sincroniza aunque
            // estemos en prueba), no al modo global — así historial y catálogo
            // suben/no-suben juntos.
            userId: auth?.profile?.id || null, esDemo: oldData?.demo === true,
          });
          if (registrado) { try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'insumo_precios_historial' } })); } catch {} }
        } catch (e) { console.warn('[epp historial precio]', e?.message || e); }
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
          padre_id: form.padre_id || null,
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

    // Almacén del movimiento (destino en ingreso, ORIGEN obligatorio en salida).
    const ubicMov = loteComunes.ubicacion_id || null;
    if (tipo === 'salida' && ubicacionesActivas.length >= 1 && !ubicMov) {
      showToast('Elegí el almacén de origen de la salida', 'red');
      return;
    }
    // Validación de stock POR UBICACIÓN (acumulada). Si el EPP no tiene
    // desglose todavía (stock inicial sin distribuir), valida contra el total.
    if (tipo === 'salida' && ubicMov) {
      const proyec = new Map();
      for (const it of itemsValidos) {
        const epp = epps.find(e => e.id === it.epp_id);
        const dgItem = desgloseUbic.get(it.epp_id);
        const tieneDesglose = dgItem && Array.from(dgItem.values()).some(c => Number(c) > 0);
        const base = proyec.has(it.epp_id) ? proyec.get(it.epp_id)
          : (tieneDesglose ? Number(dgItem.get(ubicMov) || 0) : stockDe(epp));
        const cant = parseFloat(it.cantidad) || 0;
        if (base - cant < 0) {
          showToast(`❌ Stock insuficiente de "${epp?.nombre_epp}" en ${ubicacionesById.get(ubicMov)?.nombre || 'ese almacén'}: hay ${base}, pedís ${cant}.`, 'red');
          return;
        }
        proyec.set(it.epp_id, base - cant);
      }
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
      // Destino combinado (persona o subcontrato). EPP usa personal_id; el
      // helper devuelve responsable_id, lo remapeamos (Fase B).
      const destinoVal = tipo === 'salida'
        ? (loteComunes.usarMismaPersona ? loteComunes.personal_id : it.personal_id) || null
        : null;
      const dest = splitDestino(destinoVal);
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
          personal_id: dest.responsable_id,
          subcontratista_id: dest.subcontratista_id,
          destino_tipo: dest.destino_tipo,
          proveedor_id,
          ubicacion_id: ubicMov,
          documento_asociado: form.documento || null,
          precio_unitario_real: parseFloat(it.precio) || null,
          motivo: form.motivo || (tipo === 'ingreso' ? 'reposicion' : 'dotacion'),
          observaciones: form.observaciones || null,
        });
        // Desglose por ubicación: ingreso suma al almacén de llegada, salida resta del de origen.
        if (ubicMov) {
          try { await aplicarDelta({ obraId, itemTipo: 'epp', itemId: it.epp_id, ubicacionId: ubicMov, delta: tipo === 'ingreso' ? cantNum : -cantNum, userId: auth?.profile?.id || null }); } catch (err) { console.warn('[epp aplicarDelta]', err?.message); }
        }
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
        // Historial de precio desde el ingreso: si el ítem trae precio > 0,
        // registramos el cambio (fuente 'movimiento' = "Comprobante") y
        // actualizamos el estimado del EPP.
        if (tipo === 'ingreso') {
          const precioItem = parseFloat(it.precio) || 0;
          if (precioItem > 0) {
            try {
              await registrarCambioPrecio({
                itemTipo: 'epp', itemId: it.epp_id, obraId,
                precioNuevo: precioItem, fuente: 'movimiento',
                documentoRef: form.documento || null, origenMovId: movCreated?.id || null,
                motivo: 'Ingreso EPP', userId: auth?.profile?.id || null,
                isPrueba: getCurrentMode() === 'prueba',
              });
            } catch (err) { console.warn('[epp ingreso precio]', err?.message || err); }
          }
        }
        exitosos++;
      } catch (e) {
        fallidos++;
      }
    }
    refresh();
    // Avisar al visor de historial de precios (los ingresos con precio dejaron filas).
    if (tipo === 'ingreso') { try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'insumo_precios_historial' } })); } catch {} }
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
          <div className="pg-sub">{epps.length} EPPs registrados · {epps.filter(e => ['critico','reponer','agotado','sin_stock'].includes(alertaDe(e))).length} alertas</div>
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button className="btn btn-ghost btn-sm" title="Descargar el Excel de los movimientos de EPP (solo exporta — no modifica nada)"
            onClick={async () => {
              if (!obraId) { showToast?.('No hay obra activa', 'red'); return; }
              try {
                const obra = await window.__db.obras.get(obraId);
                const r = await exportarDataset('mov_epp', obraId, obra?.nombre_obra || obra?.nombre || 'obra', {}, { porModo: true });
                showToast?.(`Exportado: ${r.filas} movimientos de EPP → ${r.archivo}`, 'green');
              } catch (e) { showToast?.('Error al exportar: ' + (e.message || e), 'red'); }
            }}>
            <JxIcon name="download" size={13}/> Exportar Excel
          </button>
          {canWrite && <button className="btn btn-ghost btn-sm" onClick={openSalida}><JxIcon name="arrowOut" size={13}/>Registrar Salida</button>}
          {canWrite && <button className="btn btn-ghost btn-sm" onClick={openIngreso}><JxIcon name="arrowIn" size={13}/>Registrar Ingreso</button>}
          {canWrite && ubicacionesActivas.length >= 2 && <button className="btn btn-ghost btn-sm" onClick={() => openTraspaso()} title="Mover stock entre almacenes"><JxIcon name="compare" size={13}/>Traspaso</button>}
          {canWrite && <button className="btn btn-ghost btn-sm" onClick={recalcularStockManual} disabled={recalcBusy} title="Recalcular el stock guardado a partir de los movimientos"><JxIcon name="refresh" size={13}/>{recalcBusy ? 'Recalculando…' : 'Recalcular stock'}</button>}
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

      {/* Detección: insumos genéricos que conviene dividir en variantes (SKU) */}
      {canWrite && sugerenciasGrupo.filter(s => !sugDescartadas.has(s.clave)).map(s => (
        <div key={'sug-'+s.clave} className="card card-p" style={{ marginBottom: 12, background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.3)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px', fontSize: 12.5, color: 'var(--ts)' }}>
            {s.tipo === 'add'
              ? <>💡 Detecté <strong>{s.items.length} EPP</strong> suelto(s) que parecen variantes de <strong>“{s.grupo.nombre_epp}”</strong> ({s.items.slice(0,4).map(i=>i.nombre_epp).join(', ')}{s.items.length>4?'…':''}). ¿Los agregás a ese grupo?</>
              : <>💡 Detecté <strong>{s.items.length} EPP</strong> que empiezan con <strong>“{s.titulo}”</strong> ({s.items.slice(0,4).map(i=>i.nombre_epp).join(', ')}{s.items.length>4?'…':''}). ¿Los agrupás como variantes de <strong>{s.titulo}</strong>? Quedan ordenados bajo un solo grupo con stock total.</>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {s.tipo === 'add'
              ? <button className="btn btn-amber btn-sm" onClick={() => agregarAGrupo(s.grupo, s.items)}><JxIcon name="layers" size={13} /> Agregar a {s.grupo.nombre_epp}</button>
              : <button className="btn btn-amber btn-sm" onClick={() => setGrupoModal({ titulo: s.titulo, items: s.items })}><JxIcon name="layers" size={13} /> Agrupar</button>}
            <button className="btn btn-ghost btn-sm" onClick={() => setSugDescartadas(d => new Set(d).add(s.clave))}>Ahora no</button>
          </div>
        </div>
      ))}

      {/* Revisión de duplicados: mismo nombre (ignora espacios/acentos) */}
      {canWrite && duplicados.filter(d => !sugDescartadas.has('dup-'+d.clave)).map(d => (
        <div key={'dup-'+d.clave} className="card card-p" style={{ marginBottom: 12, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px', fontSize: 12.5, color: 'var(--ts)' }}>
            ⚠ <strong>{d.items.length} EPP</strong> con el mismo nombre <strong>“{d.nombre}”</strong> (probable duplicado por tipeo). Conviene fusionarlos en uno: se reasignan los movimientos y se suma el stock.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-red btn-sm" onClick={() => setDupModal({ grupo: d, survivorId: d.items[0].id })}><JxIcon name="compare" size={13} /> Fusionar</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setSugDescartadas(s => new Set(s).add('dup-'+d.clave))}>Ahora no</button>
          </div>
        </div>
      ))}

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
                <th>Ubicación</th>
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
                if (!e.es_grupo) return filaEpp(e, false);
                // Cabecera de grupo (rollup de variantes).
                const hijos = variantesDe(e);
                const hijosVis = q || filtroTipo !== 'todos' ? hijos.filter(matchEpp) : hijos;
                const total = stockDeNodo(e);
                const alerG = alertaDeNodo(e);
                const aG = ALERTA_STYLE[alerG] || ALERTA_STYLE.ok;
                const abierto = expandedGroups.has(e.id);
                return (
                  <React.Fragment key={e.id}>
                    <tr style={{ background: 'rgba(245,158,11,0.06)', cursor: 'pointer' }} onClick={() => toggleGroup(e.id)}>
                      <td className="col-p">
                        <span style={{ color: 'var(--amber)', marginRight: 6, fontWeight: 700 }}>{abierto ? '▾' : '▸'}</span>
                        <strong>{e.nombre_epp}</strong>
                        <span className="badge b-amber" style={{ marginLeft: 8 }}>{hijos.length} variantes</span>
                      </td>
                      <td><span style={{ color: 'var(--tm)', fontSize: 11 }}>—</span></td>
                      <td className="col-m">—</td>
                      <td style={{ textAlign: 'right' }} className="col-num">
                        <span style={{ fontWeight: 700, color: 'var(--tp)' }}>{total.toLocaleString('es-PE')}</span>
                        <span style={{ color: 'var(--tm)', fontSize: 10.5, marginLeft: 4 }}>{e.unidad}</span>
                      </td>
                      <td style={{ textAlign: 'right' }} className="col-num">{Number(e.stock_minimo ?? 0).toLocaleString('es-PE')}</td>
                      <td className="col-m">—</td>
                      <td><span className={`badge ${aG.class}`}>{aG.label}</span></td>
                      <td>{e.sync_status && e.sync_status !== 'synced' ? <span className="badge b-amber">⏱</span> : <span style={{ color: 'var(--green)', fontSize: 11 }}>✓</span>}</td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <button className="btn btn-ghost btn-xs" title="Renombrar grupo" onClick={(ev) => { ev.stopPropagation(); openEditar(e); }}><JxIcon name="edit" size={11} /></button>
                        {canDelete && <button className="btn btn-red btn-xs" title="Deshacer grupo" onClick={(ev) => { ev.stopPropagation(); eliminarGrupo(e); }} style={{ marginLeft: 4 }}><JxIcon name="trash" size={11} /></button>}
                      </td>
                    </tr>
                    {abierto && hijosVis.map(h => filaEpp(h, true))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <TablePagination {...eppsPg} />
      </div>
      )}

      {/* ── Modal confirmar agrupación (variantes SKU) ───── */}
      {grupoModal && (
        <Modal title="Agrupar como variantes" icon="layers" onClose={() => setGrupoModal(null)}>
          <div style={{ fontSize: 12.5, color: 'var(--ts)', marginBottom: 12 }}>
            Se crea el grupo <strong>“{grupoModal.titulo}”</strong> y estos {grupoModal.items.length} EPP pasan a ser sus variantes (conservan su stock e historial):
          </div>
          <div>
            <label className="flabel">Nombre del grupo</label>
            <input className="fi" value={grupoModal.titulo} onChange={ev => setGrupoModal(g => ({ ...g, titulo: ev.target.value }))} />
          </div>
          <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 10, border: '1px solid var(--bd)', borderRadius: 6, padding: 8 }}>
            {grupoModal.items.map(it => (
              <div key={it.id} style={{ fontSize: 12, padding: '3px 0', color: 'var(--ts)' }}>• {it.nombre_epp} <span style={{ color: 'var(--tm)' }}>· stock {stockDe(it)} {it.unidad}</span></div>
            ))}
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setGrupoModal(null)}>Cancelar</button>
            <button className="btn btn-amber" onClick={() => crearGrupoCon(grupoModal.titulo, grupoModal.items)}><JxIcon name="check" size={13} /> Crear grupo</button>
          </div>
        </Modal>
      )}

      {/* ── Modal fusionar duplicados ────────────────────── */}
      {dupModal && (
        <Modal title="Fusionar EPP duplicados" icon="compare" onClose={() => setDupModal(null)}>
          <div style={{ fontSize: 12.5, color: 'var(--ts)', marginBottom: 12 }}>
            Elegí cuál se queda (sobreviviente). Los demás se dan de baja y sus movimientos + stock pasan al sobreviviente.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {dupModal.grupo.items.map(it => (
              <label key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 6, cursor: 'pointer', background: dupModal.survivorId === it.id ? 'rgba(46,204,113,0.08)' : 'transparent' }}>
                <input type="radio" name="dup-surv" checked={dupModal.survivorId === it.id} onChange={() => setDupModal(m => ({ ...m, survivorId: it.id }))} style={{ accentColor: 'var(--green)' }} />
                <span style={{ flex: 1, fontSize: 12.5 }}>{it.nombre_epp}</span>
                <span style={{ fontSize: 11, color: 'var(--tm)' }}>stock {stockDe(it)} {it.unidad}{it.tipo_epp ? ` · ${it.tipo_epp}` : ''}</span>
              </label>
            ))}
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setDupModal(null)} disabled={dupBusy}>Cancelar</button>
            <button className="btn btn-red" onClick={fusionarDuplicado} disabled={dupBusy}><JxIcon name="check" size={13} /> {dupBusy ? 'Fusionando…' : 'Fusionar'}</button>
          </div>
        </Modal>
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
            {!form.es_grupo && (
              <div>
                <label className="flabel">Grupo (variante de)</label>
                <select className="fi" value={form.padre_id || ''} onChange={ev => setForm({ ...form, padre_id: ev.target.value || null })}>
                  <option value="">— Ítem suelto —</option>
                  {epps.filter(g => g.es_grupo && !g.deleted_at && g.id !== editingId).map(g => <option key={g.id} value={g.id}>{g.nombre_epp}</option>)}
                </select>
              </div>
            )}
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
          {superAdmin && editingId && (
            <div style={{ marginTop:10, padding:'10px 12px', background:'rgba(231,76,60,0.06)', border:'1px solid rgba(231,76,60,0.3)', borderRadius:6 }}>
              <label className="flabel" style={{ color:'#E74C3C' }}>⚡ Fecha de registro (Super Admin)</label>
              <input className="fi" type="date" max={new Date().toISOString().slice(0,10)}
                value={form.fecha_registro || ''}
                onChange={e=>setForm({...form, fecha_registro:e.target.value})}/>
              <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:3 }}>
                Corrige la fecha de creación del EPP (created_at).
              </div>
            </div>
          )}
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
        <Modal title="Registrar Ingreso de EPPs (lote)" icon="arrowIn" onClose={() => setModal(null)} size="xl">
          <div className="g2">
            <div><label className="flabel">Fecha</label><input className="fi" type="date" max={new Date().toISOString().slice(0,10)} value={form.fecha||''} onChange={e=>setForm({...form, fecha:e.target.value})}/></div>
            <div><label className="flabel">Hora</label><input className="fi" type="time" value={form.hora||''} onChange={e=>setForm({...form, hora:e.target.value})}/></div>
            <div><label className="flabel">Documento / Guía</label><input className="fi" value={form.documento||''} onChange={e=>setForm({...form, documento:e.target.value})}/></div>
            {ubicacionesActivas.length > 0 && (
              <div><label className="flabel">Almacén de llegada</label>
                <select className="fi" value={loteComunes.ubicacion_id || ''} onChange={e=>setLoteComunes(c=>({...c, ubicacion_id:e.target.value}))}>
                  <option value="">— Sin asignar —</option>
                  {ubicacionesActivas.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select></div>
            )}
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
                              ...epps.filter(e => !e.es_grupo && !e.deleted_at).map(e => ({ value: e.id, label: e.nombre_epp })),
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
        <Modal title="Registrar Salida de EPPs (con firma)" icon="arrowOut" onClose={() => setModal(null)} size="xl">
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
                    { value: '', label: '— Selecciona persona / subcontrato —' },
                    ...destinoOptsEpp,
                  ]}
                  placeholder="— Selecciona persona / subcontrato —"/>
              </div>
            )}
          </div>

          {ubicacionesActivas.length > 0 && (
            <div style={{ marginTop:12, padding:'10px 12px', background:'rgba(52,152,219,0.06)', border:'1px solid rgba(52,152,219,0.3)', borderRadius:6 }}>
              <label className="flabel" style={{ marginBottom:6 }}>Almacén de origen * <span style={{ color:'var(--tm)', textTransform:'none', fontWeight:400 }}>· de dónde sale el EPP</span></label>
              {ubicacionesActivas.length === 1 ? (
                <div style={{ fontSize:12.5, color:'var(--tp)' }}>📍 {ubicacionesActivas[0].nombre} <span style={{ color:'var(--tm)' }}>(único almacén)</span></div>
              ) : (
                <SearchableSelect
                  value={loteComunes.ubicacion_id}
                  onChange={v => setLoteComunes(c => ({ ...c, ubicacion_id: v || '' }))}
                  options={[{ value:'', label:'— Selecciona almacén de origen —' }, ...ubicacionesActivas.map(u => ({ value:u.id, label:u.nombre }))]}
                  placeholder="— Selecciona almacén de origen —"/>
              )}
            </div>
          )}

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
                    const stockEpp = stockDe(epp);
                    const stockOk = stockEpp >= cant;
                    return (
                      <tr key={it.id}>
                        <td>
                          <SearchableSelect
                            value={it.epp_id}
                            onChange={v => updateLoteItem(it.id, { epp_id: v })}
                            options={[
                              { value: '', label: '— Selecciona —' },
                              ...epps.filter(e => !e.es_grupo && !e.deleted_at).map(e => ({ value: e.id, label: e.nombre_epp })),
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
                              {stockOk ? '✓' : '⚠'} {stockEpp}
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
                                ...destinoOptsEpp,
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
      {/* Popup desglose por ubicación */}
      {popupEpp && (
        <DesglosePopup
          nombre={popupEpp.nombre_epp} unidad={popupEpp.unidad}
          desglose={desgloseUbic.get(popupEpp.id)} ubicacionesById={ubicacionesById}
          canTraspaso={canWrite && ubicacionesActivas.length >= 2}
          onTraspaso={() => openTraspaso(popupEpp.id)}
          onClose={() => setPopupEpp(null)} />
      )}

      {/* Traspaso entre almacenes */}
      {modal === 'traspaso' && (
        <TraspasoStockModal
          items={epps.filter(e => !e.es_grupo && !e.deleted_at).map(e => ({ id: e.id, nombre: e.nombre_epp }))}
          ubicaciones={ubicacionesActivas} ubicacionesById={ubicacionesById}
          getDesgloseDe={(id) => desgloseUbic.get(id)}
          itemLabel="EPP" preItemId={traspasoPreId}
          onClose={() => setModal(null)} onConfirm={ejecutarTraspasoEpp} />
      )}

      {/* Visor de historial de precios del EPP */}
      {histPrecioItem && (
        <PrecioHistorialModal
          itemTipo="epp"
          itemId={histPrecioItem.id}
          nombre={histPrecioItem.nombre_epp}
          precioActual={histPrecioItem.precio_unitario_estimado}
          onClose={() => setHistPrecioItem(null)} />
      )}
    </div>
  );
}

Object.assign(window, { EppsInventarioPage });
export { EppsInventarioPage };
