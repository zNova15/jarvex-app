// ═══════════════════════════════════════════════════════════════════
// JARVEX — Insumos de Emergencia (SSOMA / Seguridad)
//
// Inventario propio de insumos de emergencia (botiquín, extintores,
// camillas, etc.): catálogo con unidad + stock, y movimientos de
// entrada/salida. stock_actual = stock_inicial + Σ entradas − Σ salidas.
// Mismo patrón que Materiales pero acotado a Seguridad.
// ═══════════════════════════════════════════════════════════════════

import React from "react";
import { calcAlerta } from "../lib/stock-utils.js";
import { detectarSugerencias, detectarDuplicados, fusionarInsumos } from "../lib/variantes.js";
import { opcionesDestinoFlat, splitDestino, joinDestino, nombreDestinoMov } from "../lib/destino-mov.js";
import { useFotosEvidencias, FotoInsumoCell } from "./jx-foto-insumo.jsx";
import { getDesgloseBulk, aplicarDelta, traspasar } from "../lib/stock-ubicaciones.js";
import { dejaNegativo } from "../lib/stock-guard.js";
import { DesglosePopup, TraspasoStockModal, ubicacionAutoOrigen, validarSalidaUbic } from "./jx-stock-ubic.jsx";
import { PrecioHistorialModal } from "./jx-precio-historial.jsx";
import { registrarSoloHistorial } from "../lib/precio-historial.js";
import { getCurrentMode } from "../hooks/useAppMode.js";

const ITEM_TIPO = 'emergencia'; // item_tipo en stock_ubicaciones (mig 074)

const { useState: uS, useMemo: uM, useEffect: uE } = React;
const hoyISO = () => new Date().toISOString().slice(0, 10);
const alertaClase = (a) => (a === 'agotado' || a === 'critico') ? 'b-red' : (a === 'reponer' || a === 'cerca') ? 'b-amber' : 'b-green';

function InsumosEmergenciaPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const userId = auth?.profile?.id ?? 'offline';
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';
  const appMode = window.__useAppMode ? window.__useAppMode() : { isPrueba: true, isEdicion: false, superAdmin: false };
  const superAdmin = !!appMode.superAdmin;
  const canWrite = isAdmin || (window.__hasPerm?.(myRol, 'Insumos de Emergencia', 'w') ?? false);
  // Adjuntar foto = permiso de Evidencias (el almacenero puede ponerle foto
  // al insumo aunque no edite el catálogo).
  const canFoto = canWrite || (window.__hasPerm?.(myRol, 'Evidencias', 'w') ?? false);
  const canDelete = isAdmin && (appMode.isEdicion || appMode.isPrueba);

  const { obraId } = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const { data: insumos, create: createInsumo, update: updateInsumo, refresh } = window.__hooks.useInsumosEmergencia(obraId);
  const movHook = window.__hooks.useMovInsumosEmergencia(obraId);
  const { data: personal } = window.__hooks.usePersonal(obraId);
  const { data: subcontratistas } = window.__hooks.useSubcontratistas();
  const { data: ubicaciones } = window.__hooks.useUbicacionesObra?.(obraId) || { data: [] };
  // Frentes de trabajo activos de la obra → picker opcional en la salida.
  const { data: frentes } = window.__hooks.useFrentesObra(obraId, { soloActivas: true });
  const ubicacionesActivas = uM(() => (ubicaciones || []).filter(u => u.activo !== false), [ubicaciones]);
  const ubicacionesById = uM(() => { const m = new Map(); (ubicaciones || []).forEach(u => m.set(u.id, u)); return m; }, [ubicaciones]);

  const [q, setQ] = uS('');
  const [vista, setVista] = uS('inventario'); // 'inventario' | 'movimientos'
  const [modal, setModal] = uS(null);   // 'nuevo' | 'editar' | 'mov'
  const [editingMovId, setEditingMovId] = uS(null); // id del movimiento en edición (Super Admin)
  const [form, setForm] = uS({});
  const [frenteSalida, setFrenteSalida] = uS(''); // frente de trabajo de la salida (obligatorio en salida, solo salida)
  const [frentePendiente, setFrentePendiente] = uS(false); // "lo completo después": salida sin frente queda marcada como pendiente
  const [busy, setBusy] = uS(false);
  const [histPrecioItem, setHistPrecioItem] = uS(null); // insumo cuyo historial de precios se ve
  const [requestTarget, setRequestTarget] = uS(null); // insumo para "Solicitar cambio" (no-admin)
  // Proveedores (tabla global): carga directa de Dexie como el resto de pantallas.
  const [proveedores, setProveedores] = uS([]);
  uE(() => { window.__db.proveedores.filter(p => !p.deleted_at).toArray().then(setProveedores).catch(() => {}); }, []);

  // Fotos del catálogo (evidencias tipo foto_insumo_emergencia) → thumbnail por fila.
  const fotosMap = useFotosEvidencias(obraId, 'foto_insumo_emergencia');

  // ── Stock por ALMACÉN (desglose) — paridad con materiales (mig 074) ──
  // desgloseUbic: Map(insumoId → Map(ubicacionId → cantidad)). Se recarga
  // cuando cambia stock_ubicaciones (jx_data_changed).
  const [desgloseUbic, setDesgloseUbic] = uS(new Map());
  const [popupInsumo, setPopupInsumo] = uS(null);     // insumo cuyo desglose se ve
  const [traspasoOpen, setTraspasoOpen] = uS(false);  // modal de traspaso
  uE(() => {
    if (!obraId) { setDesgloseUbic(new Map()); return; }
    let cancelado = false;
    const cargar = async () => {
      try {
        const ids = (insumos || []).filter(i => !i.deleted_at && !i.es_grupo).map(i => i.id);
        if (!ids.length) { if (!cancelado) setDesgloseUbic(new Map()); return; }
        const m = await getDesgloseBulk(ITEM_TIPO, ids);
        if (!cancelado) setDesgloseUbic(m);
      } catch { if (!cancelado) setDesgloseUbic(new Map()); }
    };
    cargar();
    const onData = (e) => { const t = e?.detail?.tabla; if (!t || t === 'stock_ubicaciones') cargar(); };
    window.addEventListener('jx_data_changed', onData);
    return () => { cancelado = true; window.removeEventListener('jx_data_changed', onData); };
  }, [obraId, insumos]);
  const hayAlmacenes = ubicacionesActivas.length > 0;

  const personalById = uM(() => { const m = new Map(); (personal || []).forEach(p => m.set(p.id, p)); return m; }, [personal]);
  const insumoById = uM(() => { const m = new Map(); (insumos || []).forEach(i => m.set(i.id, i)); return m; }, [insumos]);
  const proveedorById = uM(() => { const m = new Map(); (proveedores || []).forEach(p => m.set(p.id, p)); return m; }, [proveedores]);
  // Destino de salida: personal activo + subcontratos (Fase B)
  const subsById = uM(() => { const m = new Map(); (subcontratistas || []).forEach(s => m.set(s.id, s)); return m; }, [subcontratistas]);
  const destinoOpts = uM(() => opcionesDestinoFlat((personal || []).filter(p => p.estado === 'activo'), subcontratistas), [personal, subcontratistas]);

  // Movimientos de entrada/salida (más reciente primero) para la pestaña.
  const movimientos = uM(() => {
    return (movHook.data || [])
      .filter(mv => !mv.deleted_at)
      .slice()
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  }, [movHook.data]);

  // Eliminar un movimiento (soft-delete) y revertir su efecto en el stock.
  const eliminarMov = async (mv) => {
    if (!canDelete) return;
    const ins = insumoById.get(mv.insumo_emergencia_id);
    // Bloqueo duro de stock negativo (stock REAL resultante). Nadie puede dejarlo negativo.
    const undoEmerg = mv.tipo_movimiento === 'entrada' ? -Number(mv.cantidad || 0) : Number(mv.cantidad || 0);
    const stockResultante = Number(ins?.stock_actual ?? 0) + undoEmerg;
    if (ins && dejaNegativo(stockResultante)) {
      showToast(`No se puede eliminar: dejaría el stock en ${stockResultante}. El stock no puede quedar negativo.`, 'red');
      return;
    }
    if (!confirm(`¿Eliminar este movimiento (${mv.tipo_movimiento} de ${mv.cantidad} ${mv.unidad || ''} · ${ins?.nombre || 'insumo'})?\n\nEl stock se ajusta automáticamente.`)) return;
    try {
      const now = new Date().toISOString();
      await window.__db.movimientos_insumos_emergencia.update(mv.id, {
        deleted_at: now, updated_at: now, updated_by: userId,
        version: (mv.version ?? 0) + 1,
        sync_status: mv.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      if (ins) {
        const delta = mv.tipo_movimiento === 'entrada' ? -Number(mv.cantidad || 0) : Number(mv.cantidad || 0);
        const nuevoStock = Math.max(0, Number(ins.stock_actual ?? 0) + delta);
        await updateInsumo(ins.id, { stock_actual: nuevoStock, alerta: calcAlerta(nuevoStock, Number(ins.stock_minimo || 0)) });
      }
      // Revertir también el desglose por almacén si el movimiento llevaba ubicación.
      if (mv.ubicacion_id) {
        try { await aplicarDelta({ obraId, itemTipo: ITEM_TIPO, itemId: mv.insumo_emergencia_id, ubicacionId: mv.ubicacion_id, delta: mv.tipo_movimiento === 'entrada' ? -Number(mv.cantidad || 0) : Number(mv.cantidad || 0), userId }); } catch {}
      }
      try { await window.__logAudit?.({ action: 'delete', table: 'movimientos_insumos_emergencia', recordId: mv.id, reason: 'Eliminación de movimiento de insumo de emergencia' }); } catch {}
      showToast('Movimiento eliminado', 'amber'); refresh?.();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  const matchIns = (i) => {
    if (!q) return true;
    const t = q.toLowerCase();
    return i.nombre?.toLowerCase().includes(t) || i.categoria?.toLowerCase().includes(t);
  };
  // ── Variantes padre-hijo (SKU) ──────────────────────────────
  const childrenByPadre = uM(() => {
    const m = new Map();
    for (const e of (insumos || [])) { if (!e.deleted_at && e.padre_id) { const a = m.get(e.padre_id) || []; a.push(e); m.set(e.padre_id, a); } }
    return m;
  }, [insumos]);
  const variantesDe = (g) => childrenByPadre.get(g.id) || [];
  const stockDeNodo = (e) => e.es_grupo ? variantesDe(e).reduce((s, c) => s + Number(c.stock_actual || 0), 0) : Number(e.stock_actual || 0);
  const alertaDeNodo = (e) => e.es_grupo ? calcAlerta(stockDeNodo(e), Number(e.stock_minimo || 0)) : e.alerta;
  const [expandedGroups, setExpandedGroups] = uS(() => new Set());
  const toggleGroup = (id) => setExpandedGroups(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const sugerencias = uM(() => detectarSugerencias(insumos, 'nombre'), [insumos]);
  const dups = uM(() => detectarDuplicados(insumos, 'nombre'), [insumos]);
  const [descartadas, setDescartadas] = uS(() => new Set());
  const [grupoModal, setGrupoModal] = uS(null);
  const [dupModal, setDupModal] = uS(null);
  const [opBusy, setOpBusy] = uS(false);

  // Top-level (grupos + sueltos); un grupo aparece si él o una variante matchea.
  const filtered = uM(() => {
    const top = (insumos || []).filter(i => !i.deleted_at && !i.padre_id);
    return top.filter(i => i.es_grupo ? (matchIns(i) || variantesDe(i).some(matchIns)) : matchIns(i));
  }, [insumos, q, childrenByPadre]);

  const crearGrupoCon = async (titulo, items) => {
    const nombre = (titulo || '').trim();
    if (!nombre || !items?.length || opBusy) return;
    setOpBusy(true);
    try {
      const padre = await createInsumo({ obra_id: obraId, nombre, categoria: items[0]?.categoria || null, unidad: items[0]?.unidad || 'Und', es_grupo: true, stock_inicial: 0, stock_actual: 0, stock_minimo: 0, alerta: 'ok', estado: 'activo' });
      for (const it of items) await updateInsumo(it.id, { padre_id: padre.id });
      setExpandedGroups(s => new Set(s).add(padre.id));
      showToast(`✓ "${nombre}" con ${items.length} variantes`, 'green'); setGrupoModal(null); refresh?.();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); } finally { setOpBusy(false); }
  };
  const agregarAGrupo = async (grupo, items) => {
    try { for (const it of items) await updateInsumo(it.id, { padre_id: grupo.id }); setExpandedGroups(s => new Set(s).add(grupo.id)); showToast(`✓ ${items.length} agregado(s) a "${grupo.nombre}"`, 'green'); refresh?.(); }
    catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };
  const eliminarGrupo = async (g) => {
    const hijos = variantesDe(g);
    if (!confirm(`¿Deshacer el grupo "${g.nombre}"? Sus ${hijos.length} variantes vuelven a ser sueltas.`)) return;
    try { for (const h of hijos) await updateInsumo(h.id, { padre_id: null }); await updateInsumo(g.id, { deleted_at: new Date().toISOString() }); showToast('Grupo deshecho', 'amber'); refresh?.(); }
    catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };
  const fusionarDup = async () => {
    if (!dupModal?.survivorId || opBusy) return;
    setOpBusy(true);
    try {
      const dupIds = dupModal.grupo.items.map(i => i.id).filter(id => id !== dupModal.survivorId);
      const r = await fusionarInsumos({ db: window.__db, tabla: 'insumos_emergencia', movTabla: 'movimientos_insumos_emergencia', fk: 'insumo_emergencia_id', itemTipoStock: null, userId, calcAlerta }, dupModal.survivorId, dupIds);
      showToast(`✓ Fusionado · ${r.movidos} movimientos · stock ${r.stockFinal}`, 'green'); setDupModal(null); refresh?.();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); } finally { setOpBusy(false); }
  };

  const stats = uM(() => {
    const lista = (insumos || []).filter(i => !i.deleted_at);
    const bajos = lista.filter(i => i.alerta === 'agotado' || i.alerta === 'critico' || i.alerta === 'reponer').length;
    return { total: lista.length, bajos };
  }, [insumos]);

  // ── Insumo (catálogo) ──────────────────────────────────────────────
  const abrirNuevo = () => { setForm({ unidad: 'Und', stock_inicial: '', stock_minimo: '', categoria: '', vencimiento: '' }); setModal('nuevo'); };
  const abrirEditar = (i) => { setForm({ ...i, stock_inicial: i.stock_inicial ?? '', stock_minimo: i.stock_minimo ?? '' }); setModal('editar'); };

  const guardarInsumo = async () => {
    if (busy) return;
    if (!form.nombre?.trim() || !form.unidad?.trim()) { showToast('Completá nombre y unidad', 'red'); return; }
    setBusy(true);
    try {
      const stockMin = parseFloat(form.stock_minimo) || 0;
      // Precio "no informado" = null (no 0): así no se confunde "cuesta 0" con
      // "sin precio", igual que materiales/herramientas/epp. Si el campo viene
      // vacío en una EDICIÓN, NO se pisa el precio existente (evita perder un
      // precio real bajándolo a 0 sin dejar rastro).
      const precioRaw = form.precio_unitario_estimado;
      const precioInformado = precioRaw !== '' && precioRaw != null;
      const precioNuevo = precioInformado ? (parseFloat(String(precioRaw).replace(',', '.')) || null) : null;
      const esGrupo = form.es_grupo === true;
      if (modal === 'editar' && form.id) {
        // Precio anterior tal como estaba en la BD ANTES de guardar (para el historial).
        const prevItem = insumoById.get(form.id);
        const precioAnterior = Number(prevItem?.precio_unitario_estimado ?? 0);
        await updateInsumo(form.id, {
          nombre: form.nombre.trim(), categoria: form.categoria?.trim() || null, unidad: form.unidad.trim(),
          stock_minimo: stockMin,
          // Solo tocamos el precio si el usuario informó uno y el ítem NO es grupo.
          ...((!esGrupo && precioInformado) ? { precio_unitario_estimado: precioNuevo } : {}),
          vencimiento: form.vencimiento || null, observaciones: form.observaciones?.trim() || null,
          alerta: calcAlerta(Number(form.stock_actual ?? 0), stockMin),
          padre_id: form.es_grupo ? (form.padre_id ?? null) : (form.padre_id || null),
        });
        // Si el precio cambió, dejar el evento en el historial unificado. La
        // demo-ness sigue al ÍTEM (no al modo global): una edición de un insumo
        // real sincroniza aunque estemos en modo prueba, y el historial igual.
        if (!esGrupo && precioInformado) {
          try {
            const registrado = await registrarSoloHistorial({
              itemTipo: 'emergencia', itemId: form.id, obraId,
              precioAnterior, precioNuevo, fuente: 'manual', motivo: 'Edición manual del precio',
              userId, esDemo: prevItem?.demo === true,
            });
            if (registrado) window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'insumo_precios_historial' } }));
          } catch (e) { console.warn('[emergencia historial precio]', e?.message || e); }
        }
        showToast('Insumo actualizado', 'green');
      } else {
        const stockIni = parseFloat(form.stock_inicial) || 0;
        await createInsumo({
          obra_id: obraId, nombre: form.nombre.trim(), categoria: form.categoria?.trim() || null, unidad: form.unidad.trim(),
          stock_inicial: stockIni, stock_actual: stockIni, stock_minimo: stockMin,
          precio_unitario_estimado: esGrupo ? null : precioNuevo,
          vencimiento: form.vencimiento || null, observaciones: form.observaciones?.trim() || null,
          alerta: calcAlerta(stockIni, stockMin), estado: 'activo', padre_id: form.padre_id || null,
        });
        showToast(`Insumo "${form.nombre.trim()}" creado`, 'green');
      }
      setModal(null); setForm({}); refresh?.();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); } finally { setBusy(false); }
  };

  const eliminarInsumo = async (i) => {
    if (!canDelete) return;
    if (!confirm(`¿Eliminar el insumo "${i.nombre}"?`)) return;
    try { await updateInsumo(i.id, { deleted_at: new Date().toISOString() }); showToast('Insumo eliminado', 'amber'); refresh?.(); }
    catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  // ── Movimiento (entrada/salida) ────────────────────────────────────
  const abrirMov = (tipo) => { setEditingMovId(null); setFrenteSalida(''); setFrentePendiente(false); setForm({ tipo_movimiento: tipo, fecha: hoyISO(), insumo_emergencia_id: '', cantidad: '', responsable_id: '', proveedor_id: '', almacen_id: '', observaciones: '' }); setModal('mov'); };
  // Super Admin: editar un movimiento existente (corrige stock revirtiendo el viejo y aplicando el nuevo).
  const abrirEditarMov = (mv) => {
    setEditingMovId(mv.id);
    setFrenteSalida(mv.frente_id || '');
    setFrentePendiente(!!mv.frente_pendiente && !mv.frente_id);
    setForm({ tipo_movimiento: mv.tipo_movimiento, fecha: (mv.fecha || '').slice(0, 10), insumo_emergencia_id: mv.insumo_emergencia_id || '', cantidad: String(mv.cantidad ?? ''), responsable_id: joinDestino(mv), proveedor_id: mv.proveedor_id || '', almacen_id: mv.ubicacion_id || '', observaciones: mv.observaciones || '' });
    setModal('mov');
  };
  // Al elegir el insumo en una SALIDA, autocompletar el almacén de origen si
  // tiene stock en uno solo (paridad con materiales).
  const onElegirInsumoMov = (insId) => {
    const next = { ...form, insumo_emergencia_id: insId };
    if (form.tipo_movimiento === 'salida' && insId) {
      const auto = ubicacionAutoOrigen(desgloseUbic.get(insId));
      if (auto) next.almacen_id = auto;
    }
    setForm(next);
  };

  // Traspaso entre almacenes (mueve stock; el total del insumo no cambia).
  const ejecutarTraspaso = async ({ item_id, origenId, destinoId, cantidad }) => {
    const insumo = insumoById.get(item_id);
    if (!insumo) return;
    try {
      await traspasar({ obraId, itemTipo: ITEM_TIPO, itemId: item_id, origenId, destinoId, cantidad, userId });
      const oNom = ubicacionesById.get(origenId)?.nombre || '—';
      const dNom = ubicacionesById.get(destinoId)?.nombre || '—';
      const base = (lado, ubic, obs) => ({ obra_id: obraId, insumo_emergencia_id: item_id, fecha: hoyISO(), tipo_movimiento: lado, cantidad, unidad: insumo.unidad, ubicacion_id: ubic, observaciones: obs });
      await movHook.create(base('salida', origenId, `Traspaso → ${dNom}`));
      await movHook.create(base('entrada', destinoId, `Traspaso ← ${oNom}`));
      try { await window.__logAudit?.({ action: 'insert', table: 'movimientos_insumos_emergencia', reason: `Traspaso ${cantidad} ${insumo.unidad} de ${insumo.nombre}: ${oNom} → ${dNom}` }); } catch {}
      showToast(`Traspaso registrado: ${oNom} → ${dNom}`, 'green');
      setTraspasoOpen(false); refresh?.();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  const guardarMov = async () => {
    if (busy) return;
    const insumo = (insumos || []).find(i => i.id === form.insumo_emergencia_id);
    if (!insumo) { showToast('Elegí un insumo', 'red'); return; }
    const cant = parseFloat(form.cantidad);
    if (!(cant > 0)) { showToast('Cantidad debe ser mayor a 0', 'red'); return; }
    const esEntrada = form.tipo_movimiento === 'entrada';
    const esSalida = form.tipo_movimiento === 'salida';
    // Frente obligatorio en salida, salvo que se difiera ("lo completo después").
    if (esSalida && !frenteSalida && !frentePendiente) { showToast('Elegí el frente de trabajo, o marcá "lo completo después".', 'red'); return; }
    const viejo = editingMovId ? (movHook.data || []).find(x => x.id === editingMovId) : null;
    // Validación de stock insuficiente solo en creación (la edición SA recalcula).
    if (!editingMovId && !esEntrada && cant > Number(insumo.stock_actual ?? 0)) {
      showToast(`❌ Stock insuficiente de "${insumo.nombre}": hay ${Number(insumo.stock_actual ?? 0)} ${insumo.unidad}, pedís ${cant}. No se puede sacar lo que no existe.`, 'red');
      return;
    }

    // ── Resolver el almacén del movimiento (paridad con materiales) ──
    const dgItem = desgloseUbic.get(insumo.id) || new Map();
    const tieneDesglose = Array.from(dgItem.values()).some(c => Number(c) > 0);
    let ubicMov = form.almacen_id || null;
    if (!esEntrada) {
      // Salida: origen auto si hay uno solo; si está repartido, obligatorio + validar.
      if (!ubicMov) ubicMov = ubicacionAutoOrigen(dgItem);
      if (!editingMovId && hayAlmacenes && tieneDesglose && !ubicMov) {
        showToast('Elegí el almacén de origen: este insumo tiene stock repartido en varios.', 'red'); return;
      }
      if (!editingMovId && ubicMov && tieneDesglose) {
        const { ok, disponible } = validarSalidaUbic(dgItem, ubicMov, cant);
        if (!ok) { showToast(`En ese almacén hay ${disponible} ${insumo.unidad} de "${insumo.nombre}", pedís ${cant}.`, 'red'); return; }
      }
    }

    setBusy(true);
    try {
      const campos = {
        obra_id: obraId, insumo_emergencia_id: insumo.id, fecha: form.fecha || hoyISO(),
        tipo_movimiento: form.tipo_movimiento, cantidad: cant, unidad: insumo.unidad,
        // Destino (persona o subcontrato) solo en salida; entrada lleva proveedor (Fase B)
        ...splitDestino(esEntrada ? null : form.responsable_id),
        proveedor_id: form.proveedor_id || null,
        ubicacion_id: ubicMov || null,
        // Frente de trabajo (obligatorio) solo en salida.
        frente_id: esEntrada ? null : (frenteSalida || null),
        // Salida sin frente = diferida → queda pendiente. Ingreso/devolución → false.
        frente_pendiente: (!esEntrada && !frenteSalida) ? true : false,
        observaciones: form.observaciones?.trim() || null,
      };
      if (editingMovId) {
        // 1) revertir efecto del movimiento viejo en su insumo (total + desglose)
        if (viejo) {
          const insViejo = insumoById.get(viejo.insumo_emergencia_id);
          if (insViejo) {
            const deltaRev = viejo.tipo_movimiento === 'entrada' ? -Number(viejo.cantidad || 0) : Number(viejo.cantidad || 0);
            const sRev = Math.max(0, Number(insViejo.stock_actual ?? 0) + deltaRev);
            await updateInsumo(insViejo.id, { stock_actual: sRev, alerta: calcAlerta(sRev, Number(insViejo.stock_minimo || 0)) });
          }
          if (viejo.ubicacion_id) {
            try { await aplicarDelta({ obraId, itemTipo: ITEM_TIPO, itemId: viejo.insumo_emergencia_id, ubicacionId: viejo.ubicacion_id, delta: viejo.tipo_movimiento === 'entrada' ? -Number(viejo.cantidad || 0) : Number(viejo.cantidad || 0), userId }); } catch {}
          }
        }
        await movHook.update(editingMovId, campos);
        // 2) aplicar efecto del movimiento nuevo (releer el insumo actualizado)
        const insAct = (await window.__db.insumos_emergencia.get(insumo.id)) || insumo;
        const sNew = Math.max(0, Number(insAct.stock_actual ?? 0) + (esEntrada ? cant : -cant));
        await updateInsumo(insumo.id, { stock_actual: sNew, alerta: calcAlerta(sNew, Number(insAct.stock_minimo || 0)) });
        if (ubicMov) { try { await aplicarDelta({ obraId, itemTipo: ITEM_TIPO, itemId: insumo.id, ubicacionId: ubicMov, delta: esEntrada ? cant : -cant, userId }); } catch {} }
        try { await window.__logAudit?.({ action: 'update', table: 'movimientos_insumos_emergencia', recordId: editingMovId, newData: campos, reason: 'Super Admin · editar movimiento de insumo de emergencia' }); } catch {}
        showToast('Movimiento actualizado', 'green');
      } else {
        await movHook.create(campos);
        const nuevoStock = Math.max(0, Number(insumo.stock_actual ?? 0) + (esEntrada ? cant : -cant));
        await updateInsumo(insumo.id, { stock_actual: nuevoStock, alerta: calcAlerta(nuevoStock, Number(insumo.stock_minimo || 0)) });
        if (ubicMov) { try { await aplicarDelta({ obraId, itemTipo: ITEM_TIPO, itemId: insumo.id, ubicacionId: ubicMov, delta: esEntrada ? cant : -cant, userId }); } catch {} }
        // Fijar la ubicación principal del insumo en su primer ingreso con almacén.
        if (esEntrada && ubicMov && !insumo.ubicacion_id) { try { await updateInsumo(insumo.id, { ubicacion_id: ubicMov }); } catch {} }
        try { await window.__logAudit?.({ action: 'insert', table: 'movimientos_insumos_emergencia', reason: `${form.tipo_movimiento} ${cant} ${insumo.unidad} de ${insumo.nombre}` }); } catch {}
        showToast(esEntrada ? 'Ingreso registrado' : 'Salida registrada', 'green');
      }
      setModal(null); setForm({}); setEditingMovId(null); setFrenteSalida(''); setFrentePendiente(false); refresh?.();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); } finally { setBusy(false); }
  };

  if (!obraId) return <SinObraEmpty icon="package" />;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Insumos de Emergencia</div>
          <div className="pg-sub">{stats.total} insumos{stats.bajos > 0 ? ` · ${stats.bajos} con stock bajo` : ''}</div>
        </div>
        {canWrite ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-green btn-sm" onClick={() => abrirMov('entrada')}><JxIcon name="arrowIn" size={13} />Ingreso</button>
            <button className="btn btn-ghost btn-sm" onClick={() => abrirMov('salida')}><JxIcon name="arrowOut" size={13} />Salida</button>
            {hayAlmacenes && ubicacionesActivas.length >= 2 && (
              <button className="btn btn-ghost btn-sm" onClick={() => setTraspasoOpen(true)} title="Mover stock entre almacenes"><JxIcon name="compare" size={13} />Traspaso</button>
            )}
            <button className="btn btn-amber btn-sm" onClick={abrirNuevo}><JxIcon name="plus" size={13} />Nuevo insumo</button>
          </div>
        ) : <span className="badge b-gray" title="Tu rol es solo lectura para Insumos de Emergencia">Solo lectura</span>}
      </div>

      {/* Pestañas: Inventario / Movimientos */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: 'var(--bg-s)', padding: 4, borderRadius: 8, width: 'fit-content' }}>
        <button className={`btn btn-sm ${vista === 'inventario' ? 'btn-amber' : 'btn-ghost'}`} style={{ border: 'none' }} onClick={() => setVista('inventario')}>
          <JxIcon name="package" size={13} />Inventario ({stats.total})
        </button>
        <button className={`btn btn-sm ${vista === 'movimientos' ? 'btn-amber' : 'btn-ghost'}`} style={{ border: 'none' }} onClick={() => setVista('movimientos')}>
          <JxIcon name="compare" size={13} />Movimientos ({movimientos.length})
        </button>
      </div>

      {vista === 'inventario' && (
      <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <div className="search-bar"><JxIcon name="search" size={14} color="var(--tm)" /><input placeholder="Buscar insumo…" value={q} onChange={e => setQ(e.target.value)} /></div>
      </div>

      {/* Sugerencias de agrupación (variantes) */}
      {canWrite && sugerencias.filter(s => !descartadas.has(s.clave)).map(s => (
        <div key={'sug-' + s.clave} className="card card-p" style={{ marginBottom: 12, background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.3)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px', fontSize: 12.5, color: 'var(--ts)' }}>
            {s.tipo === 'add'
              ? <>💡 <strong>{s.items.length} insumo(s)</strong> suelto(s) parecen variantes de <strong>“{s.grupo.nombre}”</strong>. ¿Los agregás a ese grupo?</>
              : <>💡 <strong>{s.items.length} insumos</strong> empiezan con <strong>“{s.titulo}”</strong>. ¿Los agrupás como variantes?</>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {s.tipo === 'add'
              ? <button className="btn btn-amber btn-sm" onClick={() => agregarAGrupo(s.grupo, s.items)}><JxIcon name="layers" size={13} /> Agregar a {s.grupo.nombre}</button>
              : <button className="btn btn-amber btn-sm" onClick={() => setGrupoModal({ titulo: s.titulo, items: s.items })}><JxIcon name="layers" size={13} /> Agrupar</button>}
            <button className="btn btn-ghost btn-sm" onClick={() => setDescartadas(d => new Set(d).add(s.clave))}>Ahora no</button>
          </div>
        </div>
      ))}

      {/* Revisión de duplicados */}
      {canWrite && dups.filter(d => !descartadas.has('dup-' + d.clave)).map(d => (
        <div key={'dup-' + d.clave} className="card card-p" style={{ marginBottom: 12, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px', fontSize: 12.5, color: 'var(--ts)' }}>
            ⚠ <strong>{d.items.length} insumos</strong> con el mismo nombre <strong>“{d.nombre}”</strong> (probable duplicado). Conviene fusionarlos.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-red btn-sm" onClick={() => setDupModal({ grupo: d, survivorId: d.items[0].id })}><JxIcon name="compare" size={13} /> Fusionar</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setDescartadas(s => new Set(s).add('dup-' + d.clave))}>Ahora no</button>
          </div>
        </div>
      ))}

      {filtered.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="package" size={40} color="var(--tm)" /><p>No hay insumos de emergencia. Click en "Nuevo insumo".</p></div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Insumo</th><th>Categoría</th><th>Unidad</th>
                <th style={{ textAlign: 'right' }}>Stock</th>
                {hayAlmacenes && <th>Ubicación</th>}
                <th style={{ textAlign: 'right' }}>Mínimo</th>
                <th>Vence</th><th>Sync</th>
                <th style={{ textAlign: 'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {filtered.map(i => {
                  const fila = (it, esHijo) => {
                    const st = Number(it.stock_actual ?? 0);
                    return (
                      <tr key={it.id} style={esHijo ? { background: 'rgba(255,255,255,0.015)' } : undefined}>
                        <td className="col-p" style={esHijo ? { paddingLeft: 26 } : undefined}>
                          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                            {esHijo && <span style={{ color: 'var(--tm)' }}>└</span>}
                            <FotoInsumoCell obraId={obraId} tipoEvidencia="foto_insumo_emergencia" modulo="insumos_emergencia"
                              registroId={it.id} nombre={it.nombre} foto={fotosMap.get(it.id)}
                              canFoto={canFoto} userId={userId} showToast={showToast}/>
                            <strong>{it.nombre}</strong>
                          </div>
                        </td>
                        <td>{it.categoria || '—'}</td>
                        <td className="col-m">{it.unidad}</td>
                        <td style={{ textAlign: 'right' }}><span className={`badge ${alertaClase(it.alerta)}`}>{st.toLocaleString('es-PE')}</span></td>
                        {hayAlmacenes && (() => {
                          const dg = desgloseUbic.get(it.id);
                          const conStock = dg ? Array.from(dg.entries()).filter(([, c]) => Number(c) > 0) : [];
                          const label = conStock.length === 0 ? 'Sin distribuir'
                            : conStock.length === 1 ? (ubicacionesById.get(conStock[0][0])?.nombre || '1 almacén')
                            : `${conStock.length} almacenes`;
                          return (
                            <td>
                              <button className="btn btn-ghost btn-xs" title="Ver stock por almacén" onClick={() => setPopupInsumo(it)}>
                                <JxIcon name="map" size={11} /> {label}
                              </button>
                            </td>
                          );
                        })()}
                        <td style={{ textAlign: 'right', color: 'var(--tm)' }}>{Number(it.stock_minimo ?? 0).toLocaleString('es-PE')}</td>
                        <td className="col-m" style={{ fontSize: 11 }}>{it.vencimiento || '—'}</td>
                        <td>{it.sync_status && it.sync_status !== 'synced' ? <span className="badge b-amber">⏱</span> : <span style={{ color: 'var(--green)', fontSize: 11 }}>✓</span>}</td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button className="btn btn-ghost btn-xs" title="Historial de precios" onClick={() => setHistPrecioItem(it)}><JxIcon name="dollar" size={11} /></button>
                          {isAdmin
                            ? <button className="btn btn-ghost btn-xs" title="Editar" onClick={() => abrirEditar(it)} style={{ marginLeft: 4 }}><JxIcon name="edit" size={11} /></button>
                            : canWrite && <button className="btn btn-ghost btn-xs" title="Solicitar cambio" onClick={() => setRequestTarget(it)} style={{ marginLeft: 4 }}><JxIcon name="alert" size={11} /></button>}
                          {canDelete && <button className="btn btn-red btn-xs" title="Eliminar (modo edición)" onClick={() => eliminarInsumo(it)} style={{ marginLeft: 4 }}><JxIcon name="trash" size={11} /></button>}
                        </td>
                      </tr>
                    );
                  };
                  if (!i.es_grupo) return fila(i, false);
                  const hijos = variantesDe(i);
                  const hijosVis = q ? hijos.filter(matchIns) : hijos;
                  const abierto = expandedGroups.has(i.id);
                  return (
                    <React.Fragment key={i.id}>
                      <tr style={{ background: 'rgba(245,158,11,0.06)', cursor: 'pointer' }} onClick={() => toggleGroup(i.id)}>
                        <td className="col-p"><span style={{ color: 'var(--amber)', marginRight: 6, fontWeight: 700 }}>{abierto ? '▾' : '▸'}</span><strong>{i.nombre}</strong> <span className="badge b-amber" style={{ marginLeft: 6 }}>{hijos.length} variantes</span></td>
                        <td>{i.categoria || '—'}</td>
                        <td className="col-m">{i.unidad}</td>
                        <td style={{ textAlign: 'right' }}><span className={`badge ${alertaClase(alertaDeNodo(i))}`}>{stockDeNodo(i).toLocaleString('es-PE')}</span></td>
                        {hayAlmacenes && <td style={{ color: 'var(--tm)', fontSize: 11 }}>—</td>}
                        <td style={{ textAlign: 'right', color: 'var(--tm)' }}>{Number(i.stock_minimo ?? 0).toLocaleString('es-PE')}</td>
                        <td className="col-m">—</td>
                        <td>{i.sync_status && i.sync_status !== 'synced' ? <span className="badge b-amber">⏱</span> : <span style={{ color: 'var(--green)', fontSize: 11 }}>✓</span>}</td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {canWrite && <button className="btn btn-ghost btn-xs" title="Renombrar grupo" onClick={(ev) => { ev.stopPropagation(); abrirEditar(i); }}><JxIcon name="edit" size={11} /></button>}
                          {canDelete && <button className="btn btn-red btn-xs" title="Deshacer grupo" onClick={(ev) => { ev.stopPropagation(); eliminarGrupo(i); }} style={{ marginLeft: 4 }}><JxIcon name="trash" size={11} /></button>}
                        </td>
                      </tr>
                      {abierto && hijosVis.map(h => fila(h, true))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>
      )}

      {/* Pestaña Movimientos */}
      {vista === 'movimientos' && (
        movimientos.length === 0 ? (
          <div className="card card-p empty-state"><JxIcon name="compare" size={40} color="var(--tm)" /><p>Sin movimientos todavía. Registrá un Ingreso o una Salida.</p></div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th>Fecha</th><th>Tipo</th><th>Insumo</th>
                  <th style={{ textAlign: 'right' }}>Cantidad</th>
                  <th>Proveedor / Responsable</th><th>Observaciones</th>
                  {(canDelete || superAdmin) && <th style={{ textAlign: 'center' }}>Acciones</th>}
                </tr></thead>
                <tbody>
                  {movimientos.map(mv => {
                    const ins = insumoById.get(mv.insumo_emergencia_id);
                    const esEntrada = mv.tipo_movimiento === 'entrada';
                    const quien = esEntrada
                      ? (proveedorById.get(mv.proveedor_id)?.razon_social || '—')
                      : nombreDestinoMov(mv, personalById, subsById);
                    return (
                      <tr key={mv.id}>
                        <td className="col-m">{mv.fecha || '—'}</td>
                        <td><span className={`badge ${esEntrada ? 'b-green' : 'b-amber'}`}>{esEntrada ? '↓ Ingreso' : '↑ Salida'}</span></td>
                        <td className="col-p"><strong>{ins?.nombre || '(insumo)'}</strong></td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: esEntrada ? 'var(--green)' : 'var(--amber)' }}>
                          {esEntrada ? '+' : '−'}{Number(mv.cantidad || 0).toLocaleString('es-PE')} <span style={{ color: 'var(--tm)', fontSize: 10.5, fontWeight: 400 }}>{mv.unidad || ins?.unidad || ''}</span>
                        </td>
                        <td>{quien}</td>
                        <td style={{ fontSize: 11, color: 'var(--tm)' }}>{mv.observaciones || '—'}</td>
                        {(canDelete || superAdmin) && (
                          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {superAdmin && <button className="btn btn-ghost btn-xs" title="⚡ Editar movimiento (ajusta stock)" onClick={() => abrirEditarMov(mv)} style={{ marginRight: 4 }}><JxIcon name="edit" size={11} /></button>}
                            <button className="btn btn-red btn-xs" title="Eliminar movimiento (ajusta stock)" onClick={() => eliminarMov(mv)}><JxIcon name="trash" size={11} /></button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* Modal nuevo/editar insumo */}
      {(modal === 'nuevo' || modal === 'editar') && (
        <Modal title={modal === 'editar' ? 'Editar insumo de emergencia' : 'Nuevo insumo de emergencia'} icon="package" onClose={() => { setModal(null); setForm({}); }}>
          <div className="g2">
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Nombre *</label>
              <input className="fi" value={form.nombre || ''} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Botiquín, extintor PQS 6kg, camilla…" /></div>
            <div><label className="flabel">Categoría</label>
              <input className="fi" value={form.categoria || ''} onChange={e => setForm({ ...form, categoria: e.target.value })} placeholder="Primeros auxilios, contra incendios…" /></div>
            <div><label className="flabel">Unidad *</label>
              <input className="fi" value={form.unidad || ''} onChange={e => setForm({ ...form, unidad: e.target.value })} placeholder="Und, caja, kit…" /></div>
            {/* Un grupo (padre) no tiene precio propio: su stock es la suma de variantes. */}
            {!form.es_grupo && (
              <div><label className="flabel">Precio unitario estimado (S/)</label>
                <input className="fi" type="number" min="0" step="0.01" value={form.precio_unitario_estimado ?? ''} onChange={e => setForm({ ...form, precio_unitario_estimado: e.target.value })} placeholder="0.00" /></div>
            )}
            {modal === 'nuevo' && (
              <div><label className="flabel">Stock inicial</label>
                <input className="fi" type="number" min="0" step="0.01" value={form.stock_inicial || ''} onChange={e => setForm({ ...form, stock_inicial: e.target.value })} placeholder="0" /></div>
            )}
            <div><label className="flabel">Stock mínimo</label>
              <input className="fi" type="number" min="0" step="0.01" value={form.stock_minimo || ''} onChange={e => setForm({ ...form, stock_minimo: e.target.value })} placeholder="0" /></div>
            <div><label className="flabel">Vencimiento</label>
              <input className="fi" type="date" value={form.vencimiento || ''} onChange={e => setForm({ ...form, vencimiento: e.target.value })} /></div>
            {!form.es_grupo && (
              <div><label className="flabel">Grupo (variante de)</label>
                <select className="fi" value={form.padre_id || ''} onChange={e => setForm({ ...form, padre_id: e.target.value || null })}>
                  <option value="">— Ítem suelto —</option>
                  {(insumos || []).filter(g => g.es_grupo && !g.deleted_at && g.id !== form.id).map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
                </select></div>
            )}
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Observaciones</label>
              <textarea className="fi" rows={2} value={form.observaciones || ''} onChange={e => setForm({ ...form, observaciones: e.target.value })} /></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => { setModal(null); setForm({}); }} disabled={busy}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardarInsumo} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </Modal>
      )}

      {/* Modal confirmar agrupación */}
      {grupoModal && (
        <Modal title="Agrupar como variantes" icon="layers" onClose={() => setGrupoModal(null)}>
          <div style={{ fontSize: 12.5, color: 'var(--ts)', marginBottom: 12 }}>Se crea el grupo <strong>“{grupoModal.titulo}”</strong> y estos {grupoModal.items.length} insumos pasan a ser sus variantes.</div>
          <label className="flabel">Nombre del grupo</label>
          <input className="fi" value={grupoModal.titulo} onChange={e => setGrupoModal(g => ({ ...g, titulo: e.target.value }))} />
          <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 10, border: '1px solid var(--bd)', borderRadius: 6, padding: 8 }}>
            {grupoModal.items.map(it => <div key={it.id} style={{ fontSize: 12, padding: '3px 0', color: 'var(--ts)' }}>• {it.nombre} <span style={{ color: 'var(--tm)' }}>· stock {Number(it.stock_actual || 0)} {it.unidad}</span></div>)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => setGrupoModal(null)} disabled={opBusy}>Cancelar</button>
            <button className="btn btn-amber" onClick={() => crearGrupoCon(grupoModal.titulo, grupoModal.items)} disabled={opBusy}><JxIcon name="check" size={13} /> Crear grupo</button>
          </div>
        </Modal>
      )}

      {/* Modal fusionar duplicados */}
      {dupModal && (
        <Modal title="Fusionar insumos duplicados" icon="compare" onClose={() => setDupModal(null)}>
          <div style={{ fontSize: 12.5, color: 'var(--ts)', marginBottom: 12 }}>Elegí cuál se queda. Los demás se dan de baja y sus movimientos + stock pasan al sobreviviente.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {dupModal.grupo.items.map(it => (
              <label key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 6, cursor: 'pointer', background: dupModal.survivorId === it.id ? 'rgba(46,204,113,0.08)' : 'transparent' }}>
                <input type="radio" name="dup-ie" checked={dupModal.survivorId === it.id} onChange={() => setDupModal(m => ({ ...m, survivorId: it.id }))} style={{ accentColor: 'var(--green)' }} />
                <span style={{ flex: 1, fontSize: 12.5 }}>{it.nombre}</span>
                <span style={{ fontSize: 11, color: 'var(--tm)' }}>stock {Number(it.stock_actual || 0)} {it.unidad}</span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => setDupModal(null)} disabled={opBusy}>Cancelar</button>
            <button className="btn btn-red" onClick={fusionarDup} disabled={opBusy}><JxIcon name="check" size={13} /> {opBusy ? 'Fusionando…' : 'Fusionar'}</button>
          </div>
        </Modal>
      )}

      {/* Modal movimiento */}
      {modal === 'mov' && (
        <Modal title={editingMovId ? '⚡ Editar movimiento de emergencia' : (form.tipo_movimiento === 'entrada' ? 'Ingreso de insumo de emergencia' : 'Salida de insumo de emergencia')} icon={form.tipo_movimiento === 'entrada' ? 'arrowIn' : 'arrowOut'} size="wide" onClose={() => { setModal(null); setForm({}); setEditingMovId(null); setFrenteSalida(''); setFrentePendiente(false); }}>
          <div className="g2">
            {editingMovId && (
              <div style={{ gridColumn: '1/-1' }}><label className="flabel">Tipo</label>
                <select className="fi" value={form.tipo_movimiento || 'entrada'} onChange={e => setForm({ ...form, tipo_movimiento: e.target.value })}>
                  <option value="entrada">Ingreso</option>
                  <option value="salida">Salida</option>
                </select></div>
            )}
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Insumo *</label>
              <select className="fi" value={form.insumo_emergencia_id || ''} onChange={e => onElegirInsumoMov(e.target.value)}>
                <option value="">Selecciona…</option>
                {(insumos || []).filter(i => !i.deleted_at && !i.es_grupo).map(i => <option key={i.id} value={i.id}>{i.nombre} · stock {Number(i.stock_actual ?? 0)} {i.unidad}</option>)}
              </select></div>
            {hayAlmacenes && (() => {
              const dg = form.insumo_emergencia_id ? (desgloseUbic.get(form.insumo_emergencia_id) || new Map()) : new Map();
              const conStock = Array.from(dg.entries()).filter(([, c]) => Number(c) > 0);
              const esEntrada = form.tipo_movimiento === 'entrada';
              const opciones = esEntrada ? ubicacionesActivas : (conStock.length ? ubicacionesActivas.filter(u => conStock.some(([uid]) => uid === u.id)) : ubicacionesActivas);
              return (
                <div style={{ gridColumn: '1/-1' }}>
                  <label className="flabel">{esEntrada ? 'Almacén de llegada' : 'Almacén de origen'}{!esEntrada && conStock.length > 1 ? ' *' : ''}</label>
                  <select className="fi" value={form.almacen_id || ''} onChange={e => setForm({ ...form, almacen_id: e.target.value })}>
                    <option value="">{esEntrada ? '— Elegí dónde llega —' : (conStock.length ? '— Elegí de dónde sale —' : '— Sin distribuir —')}</option>
                    {opciones.map(u => {
                      const enU = Number(dg.get(u.id) || 0);
                      return <option key={u.id} value={u.id}>{u.nombre}{!esEntrada && enU ? ` · ${enU} disp.` : ''}</option>;
                    })}
                  </select>
                </div>
              );
            })()}
            {form.tipo_movimiento === 'salida' && (
              <div style={{ gridColumn: '1/-1' }}>
                <label className="flabel">Frente de trabajo *</label>
                <select className="fi" value={frenteSalida} disabled={frentePendiente} onChange={e => setFrenteSalida(e.target.value)}>
                  <option value="">— Sin frente —</option>
                  {(frentes || []).map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                </select>
                <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:11.5, marginTop:4, color:'var(--tm)' }}>
                  <input type="checkbox" checked={frentePendiente} onChange={e => { setFrentePendiente(e.target.checked); if (e.target.checked) setFrenteSalida(''); }} />
                  No sé el frente todavía — lo completo después (queda marcado como pendiente)
                </label>
              </div>
            )}
            <div><label className="flabel">Fecha</label>
              <input className="fi" type="date" value={form.fecha || ''} max={hoyISO()} onChange={e => setForm({ ...form, fecha: e.target.value })} /></div>
            <div><label className="flabel">Cantidad *</label>
              <input className="fi" type="number" min="0" step="0.01" value={form.cantidad || ''} onChange={e => setForm({ ...form, cantidad: e.target.value })} placeholder="0" /></div>
            <div><label className="flabel">{form.tipo_movimiento === 'entrada' ? 'Proveedor' : 'Entregado a — persona o subcontrato'}</label>
              {form.tipo_movimiento === 'entrada'
                ? <select className="fi" value={form.proveedor_id || ''} onChange={e => setForm({ ...form, proveedor_id: e.target.value })}>
                    <option value="">—</option>
                    {(proveedores || []).filter(p => !p.deleted_at).map(p => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
                  </select>
                : <select className="fi" value={form.responsable_id || ''} onChange={e => setForm({ ...form, responsable_id: e.target.value })}>
                    <option value="">—</option>
                    {destinoOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>}
            </div>
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Observaciones</label>
              <textarea className="fi" rows={2} value={form.observaciones || ''} onChange={e => setForm({ ...form, observaciones: e.target.value })} /></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => { setModal(null); setForm({}); setEditingMovId(null); setFrenteSalida(''); setFrentePendiente(false); }} disabled={busy}>Cancelar</button>
            <button className={`btn ${form.tipo_movimiento === 'entrada' ? 'btn-green' : 'btn-amber'}`} onClick={guardarMov} disabled={busy}>{busy ? 'Guardando…' : editingMovId ? 'Guardar cambios' : 'Registrar'}</button>
          </div>
        </Modal>
      )}

      {/* Popup: stock por almacén de un insumo */}
      {popupInsumo && (
        <DesglosePopup
          nombre={popupInsumo.nombre}
          unidad={popupInsumo.unidad}
          desglose={desgloseUbic.get(popupInsumo.id)}
          ubicacionesById={ubicacionesById}
          canTraspaso={canWrite && ubicacionesActivas.length >= 2}
          onTraspaso={() => setTraspasoOpen(true)}
          onClose={() => setPopupInsumo(null)}
        />
      )}

      {/* Visor: historial de precios de un insumo */}
      {histPrecioItem && (
        <PrecioHistorialModal
          itemTipo="emergencia"
          itemId={histPrecioItem.id}
          nombre={histPrecioItem.nombre}
          precioActual={histPrecioItem.precio_unitario_estimado}
          onClose={() => setHistPrecioItem(null)}
        />
      )}

      {/* Solicitar cambio (no-admin): el almacenero pide editar el catálogo, el admin aprueba */}
      {requestTarget && (
        <RequestChangeModal
          table="insumos_emergencia"
          record={requestTarget}
          recordLabel={requestTarget.nombre}
          allowDelete
          fields={[
            { key: 'nombre', label: 'Nombre' },
            { key: 'categoria', label: 'Categoría' },
            { key: 'unidad', label: 'Unidad' },
            { key: 'stock_minimo', label: 'Stock mínimo', type: 'number' },
            { key: 'precio_unitario_estimado', label: 'Precio estimado (S/)', type: 'number' },
          ]}
          showToast={showToast}
          onClose={() => setRequestTarget(null)}
        />
      )}

      {/* Modal de traspaso entre almacenes */}
      {traspasoOpen && (
        <TraspasoStockModal
          items={(insumos || []).filter(i => !i.deleted_at && !i.es_grupo).map(i => ({ id: i.id, nombre: i.nombre }))}
          ubicaciones={ubicacionesActivas}
          ubicacionesById={ubicacionesById}
          getDesgloseDe={(id) => desgloseUbic.get(id)}
          itemLabel="Insumo"
          preItemId={popupInsumo?.id || ''}
          onClose={() => setTraspasoOpen(false)}
          onConfirm={ejecutarTraspaso}
        />
      )}
    </div>
  );
}

Object.assign(window, { InsumosEmergenciaPage });
