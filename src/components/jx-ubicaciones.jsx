import React from "react";
const { useState: uS, useEffect: uE, useMemo: uM, useRef: uR } = React;

// Página de gestión del catálogo de ubicaciones de almacenaje por obra,
// con el stock general de la obra por categoría y el desglose de cuánto
// hay de cada categoría en cada ubicación (fuente: stock_ubicaciones;
// la maquinaria usa la ubicación de la ficha del activo — o su desglose
// en stock_ubicaciones si la ficha no tiene ubicación — caso migración).
// Los insumos de emergencia también manejan almacén (mig 074).

const fmtN = (n) => Number(n || 0).toLocaleString('es-PE');

// Categorías con desglose por ubicación (item_tipo de stock_ubicaciones,
// salvo maquinaria que se cuenta por activos_pesados.ubicacion_id, con
// fallback a sus filas 'maquinaria' de stock_ubicaciones cuando la ficha
// no tiene ubicación — caso migración histórica).
const CATS = [
  { key: 'material',    label: 'Materiales',   icon: 'package', color: 'var(--blue)',   bg: 'rgba(59,130,246,0.12)' },
  { key: 'herramienta', label: 'Herramientas', icon: 'tool',    color: 'var(--amber)',  bg: 'rgba(245,158,11,0.12)' },
  { key: 'epp',         label: 'EPPs',         icon: 'shield',  color: 'var(--green)',  bg: 'rgba(34,197,94,0.12)' },
  { key: 'emergencia',  label: 'Emergencia',   icon: 'alert',   color: 'var(--red)',    bg: 'rgba(239,68,68,0.12)' },
  { key: 'maquinaria',  label: 'Maquinaria',   icon: 'truck',   color: 'var(--orange)', bg: 'rgba(249,115,22,0.12)' },
];

const cero = () => ({ items: 0, unidades: 0 });
const bucketDe = (map, ubicId, tipo) => {
  if (!map.has(ubicId)) map.set(ubicId, { material: cero(), herramienta: cero(), epp: cero(), emergencia: cero(), maquinaria: cero() });
  return map.get(ubicId)[tipo];
};

function UbicacionesPage({ showToast }) {
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const rol = auth?.profile?.rol;
  const canWrite = rol === 'admin' || rol === 'gerente' || rol === 'ingeniero_residente';

  const [obraId, setObraId] = uS(null);
  uE(() => {
    let cancelled = false;
    let attempts = 0;
    const find = async () => {
      attempts++;
      const obras = await window.__db.obras.toArray();
      const stored = window.__getObraActivaId?.();
      const activa = (stored && obras.find(o => o.id === stored && !o.deleted_at))
                  || obras.find(o => !o.deleted_at);
      if (activa) { if (!cancelled) setObraId(activa.id); return; }
      if (cancelled || attempts >= 10) return;
      setTimeout(find, 500);
    };
    find();
    const onChange = () => { attempts = 0; find(); };
    window.addEventListener('jarvex_master_updated', onChange);
    window.addEventListener('obra_activa_change', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('jarvex_master_updated', onChange);
      window.removeEventListener('obra_activa_change', onChange);
    };
  }, []);

  const { data: ubicaciones, loading, create, update, remove, refresh } = window.__hooks.useUbicacionesObra(obraId);
  const { data: obras } = window.__hooks.useObras();
  const obra = (obras || []).find(o => o.id === obraId);

  // ── Stock: resumen general + desglose por ubicación ────────────────
  const [resumen, setResumen] = uS(null);          // { material:{items,unidades}, ..., emergencia }
  const [porUbic, setPorUbic] = uS(new Map());     // ubicId → { material:{items,unidades}, ... }
  const [sinDistribuir, setSinDistribuir] = uS(null); // { material: unidades, ... }
  const [sinDistDetalle, setSinDistDetalle] = uS(null); // { material:[{nombre,unidad,faltante}], ... }
  const [sinDistAbierto, setSinDistAbierto] = uS(false); // banner expandido
  const [sinDistVerTodo, setSinDistVerTodo] = uS(() => new Set()); // categorías con la lista completa
  const stockRowsRef = uR(new Map());              // ubicId → [{tipo, item_id, cantidad, nombre?, unidad?}]
  const [detalles, setDetalles] = uS({});          // ubicId → { loading, grupos }
  const [expandidas, setExpandidas] = uS(() => new Set());
  const expandidasRef = uR(expandidas);            // espejo para leer los ids abiertos desde recargar() (el closure del efecto queda viejo)
  uE(() => { expandidasRef.current = expandidas; }, [expandidas]);

  uE(() => {
    if (!obraId) { setResumen(null); setPorUbic(new Map()); setSinDistribuir(null); return; }
    let cancelled = false;
    let timer = null;
    let runSeq = 0; // token de corrida: si arranca una recarga más nueva, la vieja no debe pisar su estado

    const recargar = async () => {
      const run = ++runSeq;
      const db = window.__db;
      try {
        const tot = { material: cero(), herramienta: cero(), epp: cero(), maquinaria: cero(), emergencia: cero() };
        const vivos = { material: new Set(), herramienta: new Set(), epp: new Set(), emergencia: new Set() };
        // Para el drill-down de "sin distribuir": stock por ítem (catálogo) y lo
        // distribuido por ítem (stock_ubicaciones). faltante = stock − distribuido.
        const catItems = { material: [], herramienta: [], epp: [], emergencia: [], maquinaria: [] };
        const distPorItem = new Map(); // item_id → cantidad distribuida
        const serializadas = []; // herramientas legacy sin maneja_cantidad, con ubicación de catálogo
        const serialIds = new Set(); // ids serializados: sus filas en stock_ubicaciones (legacy/huérfanas) se saltan para no contarlas dos veces
        const activos = [];

        await db.materiales.where('obra_id').equals(obraId).each(r => {
          if (r.deleted_at || r.es_grupo === true) return;
          vivos.material.add(r.id);
          const s = Number(r.stock_actual) || 0;
          tot.material.items++; tot.material.unidades += s;
          if (s > 0) catItems.material.push({ id: r.id, nombre: r.nombre_material || 'Material', unidad: r.unidad || '', stock: s });
        });
        await db.herramientas.where('obra_id').equals(obraId).each(r => {
          if (r.deleted_at || r.es_grupo === true) return;
          vivos.herramienta.add(r.id);
          tot.herramienta.items++;
          if (r.maneja_cantidad) {
            const s = Number(r.stock_actual) || 0;
            tot.herramienta.unidades += s;
            if (s > 0) catItems.herramienta.push({ id: r.id, nombre: r.nombre_herramienta || 'Herramienta', unidad: r.unidad || 'und', stock: s });
          } else {
            tot.herramienta.unidades += 1;
            serialIds.add(r.id);
            if (r.ubicacion_id) serializadas.push({ ubic: r.ubicacion_id, nombre: r.nombre_herramienta || 'Herramienta', unidad: 'und' });
          }
        });
        // Stock VIVO de EPP (entradas − salidas de movimientos_epp): el campo
        // epps.stock_actual es denormalizado y puede quedar desfasado (mismo
        // fallback que jx-epps.jsx); sin esto la tarjeta KPI de EPPs mostraba
        // un total distinto al de la página de EPPs y el "sin distribuir"
        // heredaba el desfase. stock_actual queda solo como respaldo.
        const eppVivo = new Map();
        await db.movimientos_epp.where('obra_id').equals(obraId).each(mv => {
          if (mv.deleted_at) return;
          const c = Number(mv.cantidad) || 0;
          if (!c) return;
          const prev = eppVivo.get(mv.epp_id) || 0;
          if (mv.tipo_movimiento === 'entrada') eppVivo.set(mv.epp_id, prev + c);
          else if (mv.tipo_movimiento === 'salida') eppVivo.set(mv.epp_id, prev - c);
        });
        await db.epps.where('obra_id').equals(obraId).each(r => {
          if (r.deleted_at || r.es_grupo === true) return;
          vivos.epp.add(r.id);
          tot.epp.items++;
          const s = eppVivo.has(r.id) ? Math.max(0, eppVivo.get(r.id)) : (Number(r.stock_actual) || 0);
          tot.epp.unidades += s;
          if (s > 0) catItems.epp.push({ id: r.id, nombre: r.nombre_epp || 'EPP', unidad: r.unidad || 'und', stock: s });
        });
        await db.insumos_emergencia.where('obra_id').equals(obraId).each(r => {
          if (r.deleted_at || r.es_grupo === true) return;
          vivos.emergencia.add(r.id);
          const s = Number(r.stock_actual) || 0;
          tot.emergencia.items++; tot.emergencia.unidades += s;
          if (s > 0) catItems.emergencia.push({ id: r.id, nombre: r.nombre || 'Insumo de emergencia', unidad: r.unidad || 'und', stock: s });
        });
        // activos_pesados no tiene índice obra_id: el campo canónico es obra_actual_id
        await db.activos_pesados.where('obra_actual_id').equals(obraId).each(r => {
          if (r.deleted_at) return;
          const unid = r.maneja_cantidad ? (Number(r.stock_actual) || 0) : 1;
          tot.maquinaria.items++; tot.maquinaria.unidades += unid;
          activos.push({ id: r.id, ubic: r.ubicacion_id || null, nombre: r.nombre || 'Equipo', cantidad: unid, unidad: r.maneja_cantidad ? (r.unidad || 'und') : 'und' });
        });

        // Ubicaciones vivas (sin deleted_at): el stock asignado a una ubicación
        // eliminada no tiene fila en la tabla (useUbicacionesObra filtra
        // deleted_at), así que NO se suma a dist y queda visible en el banner
        // de "sin distribuir" en vez de desaparecer de la vista.
        const ubicsVivas = new Set();
        await db.ubicaciones_obra.where('obra_id').equals(obraId).each(u => {
          if (!u.deleted_at) ubicsVivas.add(u.id);
        });

        // Desglose por ubicación: materiales/herramientas/epp desde stock_ubicaciones.
        const mapa = new Map();
        const rowsPorUbic = new Map();
        const dist = { material: 0, herramienta: 0, epp: 0, emergencia: 0, maquinaria: 0 };
        const maqDesglose = new Map(); // activo_id → [{ubic, cant}] (filas 'maquinaria', ej. migración histórica)
        await db.stock_ubicaciones.where('obra_id').equals(obraId).each(r => {
          if (r.deleted_at) return;
          const cant = Number(r.cantidad) || 0;
          if (cant <= 0) return;
          if (r.item_tipo === 'maquinaria') {
            // La maquinaria se cuenta por la ficha del activo; estas filas solo
            // sirven de fallback para activos sin ubicacion_id (migración histórica).
            if (!maqDesglose.has(r.item_id)) maqDesglose.set(r.item_id, []);
            maqDesglose.get(r.item_id).push({ ubic: r.ubicacion_id, cant });
            return;
          }
          if (!vivos[r.item_tipo] || !vivos[r.item_tipo].has(r.item_id)) return; // item borrado o tipo desconocido
          if (r.item_tipo === 'herramienta' && serialIds.has(r.item_id)) return; // serializada: ya se cuenta por su ubicación de catálogo (evita doble conteo con filas legacy)
          if (!ubicsVivas.has(r.ubicacion_id)) return; // ubicación eliminada → cuenta como sin distribuir
          const b = bucketDe(mapa, r.ubicacion_id, r.item_tipo);
          b.items++; b.unidades += cant;
          dist[r.item_tipo] += cant;
          distPorItem.set(r.item_id, (distPorItem.get(r.item_id) || 0) + cant);
          if (!rowsPorUbic.has(r.ubicacion_id)) rowsPorUbic.set(r.ubicacion_id, []);
          rowsPorUbic.get(r.ubicacion_id).push({ tipo: r.item_tipo, item_id: r.item_id, cantidad: cant });
        });
        for (const h of serializadas) {
          if (!ubicsVivas.has(h.ubic)) continue; // ubicación eliminada → cuenta como sin distribuir
          const b = bucketDe(mapa, h.ubic, 'herramienta');
          b.items++; b.unidades += 1;
          dist.herramienta += 1;
          if (!rowsPorUbic.has(h.ubic)) rowsPorUbic.set(h.ubic, []);
          rowsPorUbic.get(h.ubic).push({ tipo: 'herramienta', cantidad: 1, nombre: h.nombre, unidad: h.unidad });
        }
        for (const a of activos) {
          // Con ubicación en la ficha manda la ficha (y se ignora su desglose
          // en stock_ubicaciones para no contar doble); sin ubicación, fallback
          // a sus filas 'maquinaria' de stock_ubicaciones (migración histórica).
          const filas = a.ubic
            ? [{ ubic: a.ubic, cant: a.cantidad }]
            : (maqDesglose.get(a.id) || []);
          for (const f of filas) {
            if (!f.ubic || !ubicsVivas.has(f.ubic)) continue; // ubicación eliminada → cuenta como sin distribuir
            const b = bucketDe(mapa, f.ubic, 'maquinaria');
            b.items++; b.unidades += f.cant;
            dist.maquinaria += f.cant;
            if (!rowsPorUbic.has(f.ubic)) rowsPorUbic.set(f.ubic, []);
            rowsPorUbic.get(f.ubic).push({ tipo: 'maquinaria', cantidad: f.cant, nombre: a.nombre, unidad: a.unidad });
          }
        }

        if (cancelled || run !== runSeq) return; // hay una recarga más nueva en vuelo o ya terminada
        stockRowsRef.current = rowsPorUbic;
        setResumen(tot);
        setPorUbic(mapa);
        setSinDistribuir({
          material: Math.max(0, tot.material.unidades - dist.material),
          herramienta: Math.max(0, tot.herramienta.unidades - dist.herramienta),
          epp: Math.max(0, tot.epp.unidades - dist.epp),
          emergencia: Math.max(0, tot.emergencia.unidades - dist.emergencia),
          maquinaria: Math.max(0, tot.maquinaria.unidades - dist.maquinaria),
        });
        // Detalle: qué insumos tienen stock > lo distribuido (los que faltan
        // asignar a un almacén). Ordenado por faltante desc.
        const detalle = {};
        for (const cat of ['material', 'herramienta', 'epp', 'emergencia']) {
          detalle[cat] = catItems[cat]
            .map(it => ({ nombre: it.nombre, unidad: it.unidad, faltante: it.stock - (distPorItem.get(it.id) || 0) }))
            .filter(x => x.faltante > 0)
            .sort((a, b) => b.faltante - a.faltante);
        }
        setSinDistDetalle(detalle);
        setDetalles({});
        // Re-carga el detalle de las filas que el usuario tiene expandidas:
        // sin esto, tras un sync/jx_data_changed la fila abierta quedaba como
        // una banda vacía (det=undefined y sin re-fetch hasta colapsar/expandir).
        for (const id of expandidasRef.current) cargarDetalle(id, true);
      } catch (e) {
        console.warn('[ubicaciones] error cargando stock:', e);
      }
    };

    recargar();
    const TABLAS = new Set(['stock_ubicaciones', 'materiales', 'herramientas', 'epps', 'movimientos_epp', 'insumos_emergencia', 'activos_pesados', 'ubicaciones_obra']);
    const onData = (ev) => {
      // jx_data_changed trae detail.tabla; jarvex_master_updated (realtime) trae
      // detail.table — sin el fallback, los eventos realtime de tablas ajenas
      // (asistencia, movimientos…) pasaban el filtro y forzaban el scan completo.
      const tabla = ev?.detail?.tabla || ev?.detail?.table;
      if (tabla && !TABLAS.has(tabla)) return;
      clearTimeout(timer);
      timer = setTimeout(recargar, 600);
    };
    window.addEventListener('jx_data_changed', onData);
    window.addEventListener('jarvex_master_updated', onData);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('jx_data_changed', onData);
      window.removeEventListener('jarvex_master_updated', onData);
    };
  }, [obraId]);

  // Detalle expandible: nombres de los items con stock en esa ubicación.
  const cargarDetalle = async (ubicId, force = false) => {
    // force=true: re-fetch tras recargar() aunque el closure tenga un `detalles` viejo
    if (!force && (detalles[ubicId]?.grupos || detalles[ubicId]?.loading)) return;
    setDetalles(d => ({ ...d, [ubicId]: { loading: true } }));
    try {
      const db = window.__db;
      const rows = stockRowsRef.current.get(ubicId) || [];
      const idsPorTipo = { material: [], herramienta: [], epp: [], emergencia: [] };
      for (const r of rows) if (r.item_id && idsPorTipo[r.tipo]) idsPorTipo[r.tipo].push(r.item_id);

      const nombres = new Map();
      if (idsPorTipo.material.length) (await db.materiales.where('id').anyOf(idsPorTipo.material).toArray())
        .forEach(m => nombres.set(m.id, { nombre: m.nombre_material || 'Material', unidad: m.unidad || '' }));
      if (idsPorTipo.herramienta.length) (await db.herramientas.where('id').anyOf(idsPorTipo.herramienta).toArray())
        .forEach(h => nombres.set(h.id, { nombre: h.nombre_herramienta || 'Herramienta', unidad: h.unidad || 'und' }));
      if (idsPorTipo.epp.length) (await db.epps.where('id').anyOf(idsPorTipo.epp).toArray())
        .forEach(e => nombres.set(e.id, { nombre: e.nombre_epp || 'EPP', unidad: e.unidad || 'und' }));
      if (idsPorTipo.emergencia.length) (await db.insumos_emergencia.where('id').anyOf(idsPorTipo.emergencia).toArray())
        .forEach(e => nombres.set(e.id, { nombre: e.nombre || 'Insumo de emergencia', unidad: e.unidad || 'und' }));

      const grupos = CATS.map(cat => ({
        cat,
        items: rows
          .filter(r => r.tipo === cat.key)
          .map(r => ({
            nombre: r.nombre || nombres.get(r.item_id)?.nombre || '—',
            unidad: r.unidad || nombres.get(r.item_id)?.unidad || '',
            cantidad: r.cantidad,
          }))
          .sort((a, b) => b.cantidad - a.cantidad),
      })).filter(g => g.items.length > 0);
      setDetalles(d => ({ ...d, [ubicId]: { grupos } }));
    } catch (e) {
      setDetalles(d => ({ ...d, [ubicId]: { grupos: [], error: String(e?.message || e) } }));
    }
  };

  const toggleExpand = (ubicId) => {
    setExpandidas(prev => {
      const next = new Set(prev);
      if (next.has(ubicId)) next.delete(ubicId);
      else { next.add(ubicId); cargarDetalle(ubicId); }
      return next;
    });
  };

  const sorted = uM(() => {
    return [...(ubicaciones || [])].sort((a, b) => {
      if ((a.activo !== false) !== (b.activo !== false)) return a.activo === false ? 1 : -1;
      return Number(a.orden ?? 99) - Number(b.orden ?? 99) || (a.nombre || '').localeCompare(b.nombre || '');
    });
  }, [ubicaciones]);

  const [modal, setModal] = uS(null);
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({ nombre: '', descripcion: '', orden: 0, activo: true });

  const openNueva = () => {
    const orden = ((ubicaciones || []).reduce((m, u) => Math.max(m, Number(u.orden) || 0), 0) || 0) + 1;
    setEditing(null);
    setForm({ nombre: '', descripcion: '', orden, activo: true });
    setModal('form');
  };

  const openEditar = (u) => {
    setEditing(u);
    setForm({
      nombre: u.nombre || '',
      descripcion: u.descripcion || '',
      orden: Number(u.orden) || 0,
      activo: u.activo !== false,
    });
    setModal('form');
  };

  const guardar = async () => {
    const nombre = (form.nombre || '').trim();
    if (!nombre) { showToast('Nombre requerido', 'red'); return; }
    if (!obraId) { showToast('No hay obra activa', 'red'); return; }
    const dup = (ubicaciones || []).some(u =>
      (u.nombre || '').trim().toLowerCase() === nombre.toLowerCase() &&
      (!editing || u.id !== editing.id) && !u.deleted_at
    );
    if (dup) { showToast('Ya existe una ubicación con ese nombre', 'red'); return; }

    try {
      if (editing) {
        await update(editing.id, {
          nombre,
          descripcion: form.descripcion || null,
          orden: Number(form.orden) || 0,
          activo: !!form.activo,
        });
        try { await window.__logAudit?.({ action: 'update', table: 'ubicaciones_obra', recordId: editing.id, oldData: editing, newData: { nombre, descripcion: form.descripcion, orden: form.orden, activo: form.activo } }); } catch {}
        showToast('Ubicación actualizada', 'green');
      } else {
        const created = await create({
          obra_id: obraId,
          nombre,
          descripcion: form.descripcion || null,
          orden: Number(form.orden) || 0,
          activo: true,
        });
        try { await window.__logAudit?.({ action: 'insert', table: 'ubicaciones_obra', recordId: created?.id, newData: created }); } catch {}
        showToast(`Ubicación "${nombre}" creada`, 'green');
      }
      setModal(null); setEditing(null);
    } catch (e) {
      showToast('Error: ' + (e.message || e), 'red');
    }
  };

  const toggleActivo = async (u) => {
    if (!canWrite) return;
    try {
      await update(u.id, { activo: u.activo === false });
      showToast(u.activo === false ? 'Ubicación reactivada' : 'Ubicación desactivada', 'amber');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  const usoDe = (u) => {
    const d = porUbic.get(u.id);
    if (!d) return { items: 0, unidades: 0 };
    return CATS.reduce((acc, c) => ({ items: acc.items + d[c.key].items, unidades: acc.unidades + d[c.key].unidades }), { items: 0, unidades: 0 });
  };

  // Ítems del catálogo (aunque tengan stock 0) que referencian esta ubicación
  // vía ubicacion_id: eliminarla dejaría referencias colgantes que las otras
  // pantallas muestran vacías. Distinto del stock distribuido (stock_ubicaciones).
  const contarRefsCatalogo = async (ubicId) => {
    try {
      const db = window.__db;
      const vivo = (r) => !r.deleted_at;
      const [mat, her, epp, act] = await Promise.all([
        db.materiales.where('ubicacion_id').equals(ubicId).filter(vivo).count(),
        // herramientas no indexa ubicacion_id (el schema v19 lo quitó): ir por obra_id
        db.herramientas.where('obra_id').equals(obraId).filter(r => vivo(r) && r.ubicacion_id === ubicId).count(),
        db.epps.where('ubicacion_id').equals(ubicId).filter(vivo).count(),
        db.activos_pesados.where('ubicacion_id').equals(ubicId).filter(vivo).count(),
      ]);
      return mat + her + epp + act;
    } catch { return 0; }
  };

  const eliminar = async (u) => {
    if (!canWrite) return;
    const uso = usoDe(u);
    const refs = await contarRefsCatalogo(u.id);
    if ((uso.unidades > 0 || refs > 0) && u.activo !== false) {
      const motivo = uso.unidades > 0
        ? `Tiene ${fmtN(uso.unidades)} unidades de ${uso.items} ítem${uso.items > 1 ? 's' : ''} en stock. Traspasá el stock o desactivála primero.`
        : `Tiene ${fmtN(refs)} ítem${refs > 1 ? 's' : ''} del catálogo con esta ubicación asignada. Desactivála primero.`;
      showToast(motivo, 'red');
      return;
    }
    const msg = uso.unidades > 0
      ? `Esta ubicación todavía tiene ${fmtN(uso.unidades)} unidades registradas. Se quitará del catálogo y ese stock pasará al aviso de "sin distribuir" hasta que lo reasignes a otra ubicación. ¿Continuar?`
      : refs > 0
      ? `Esta ubicación figura en ${fmtN(refs)} ítem${refs > 1 ? 's' : ''} del catálogo (sin stock). Si la eliminás, esos ítems dejarán de mostrar su ubicación. ¿Continuar?`
      : `¿Eliminar la ubicación "${u.nombre}"?`;
    if (!confirm(msg)) return;
    try {
      await remove(u.id);
      try { await window.__logAudit?.({ action: 'delete', table: 'ubicaciones_obra', recordId: u.id, oldData: u }); } catch {}
      showToast('Ubicación eliminada', 'green');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  const sembrar = async () => {
    if (!canWrite || !obraId) return;
    if (!confirm('¿Sembrar las 4 ubicaciones por defecto (Almacén Central, Patio, Frente de Obra, Externo)?')) return;
    try {
      const mod = await import('../lib/seed-ubicaciones.js');
      const creados = await mod.seedUbicacionesPorDefecto(obraId, userId);
      if (creados.length === 0) {
        showToast('Ya hay ubicaciones en esta obra. Nada que sembrar.', 'amber');
      } else {
        showToast(`${creados.length} ubicaciones creadas`, 'green');
        refresh?.();
      }
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  if (!obraId) {
    return (
      <div className="page-wrap">
        <div className="card card-p empty-state">
          <JxIcon name="map" size={32} color="var(--tm)" />
          <p>Selecciona una obra activa para gestionar sus ubicaciones de almacenaje.</p>
        </div>
      </div>
    );
  }

  const activos = (ubicaciones || []).filter(u => u.activo !== false).length;
  const total = (ubicaciones || []).length;
  const haySinDistribuir = sinDistribuir && CATS.some(c => sinDistribuir[c.key] > 0);

  // Antes del primer scan de stock (resumen === null) las celdas muestran '…'
  // para no confundir "cargando" con un cero real; en las recargas con
  // debounce se mantiene el dato anterior visible.
  const cargandoStock = resumen === null;

  const celdaCat = (d, cat) => {
    if (cargandoStock) return <span style={{ color: 'var(--tm)' }}>…</span>;
    const b = d?.[cat.key];
    if (!b || b.unidades <= 0) return <span style={{ color: 'var(--tm)' }}>—</span>;
    return (
      <span>
        <span style={{ fontWeight: 700, color: cat.color }}>{fmtN(b.unidades)}</span>
        <span style={{ fontSize: 10, color: 'var(--tm)', marginLeft: 4 }}>{b.items} ítem{b.items > 1 ? 's' : ''}</span>
      </span>
    );
  };

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Ubicaciones de Obra</div>
          <div className="pg-sub">
            {obra ? <strong>{obra.nombre_obra}</strong> : '—'} · {total} ubicaciones · {activos} activas
          </div>
        </div>
        {canWrite && (
          <button className="btn btn-amber btn-sm" onClick={openNueva}>
            <JxIcon name="plus" size={13} />Nueva Ubicación
          </button>
        )}
      </div>

      {/* Resumen general de stock de la obra por categoría */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 18 }}>
        {CATS.map(cat => {
          const r = resumen?.[cat.key];
          // Materiales suma bolsas + m3 + kg + metros: esa suma de unidades es
          // mixta y no responde "cuántos existen". Ahí el héroe es el nº de
          // ítems del catálogo y la suma queda como secundario etiquetado.
          // En las demás categorías la suma es homogénea y sigue de héroe.
          const esMixto = cat.key === 'material';
          return (
            <div key={cat.key} className="kpi-card">
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 11.5, color: 'var(--tm)', fontWeight: 500 }}>{cat.label}</div>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: cat.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <JxIcon name={cat.icon} size={14} color={cat.color} />
                </div>
              </div>
              <div className="kpi-val" style={{ fontSize: 24 }}>
                {r ? fmtN(esMixto ? r.items : r.unidades) : '…'}
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--tm)', marginLeft: 4 }}>
                  {esMixto ? `ítem${r && r.items === 1 ? '' : 's'}` : 'unid.'}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--tm)' }}>
                {r
                  ? (esMixto
                      ? `${fmtN(r.unidades)} unid. mixtas en stock`
                      : `${fmtN(r.items)} ítem${r.items === 1 ? '' : 's'} en catálogo`)
                  : 'Cargando…'}
                {cat.sub ? <span style={{ display: 'block', fontSize: 10, opacity: 0.8 }}>{cat.sub}</span> : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Aviso ANTES de la tabla: explica por qué las tarjetas de arriba
          pueden sumar más que la tabla (stock sin fila en stock_ubicaciones).
          OJO: acá NO sirve recetar Traspaso — el modal exige un almacén de
          origen con stock; este stock se asigna registrando ingresos con
          almacén de llegada (misma receta que el DesglosePopup). */}
      {haySinDistribuir && (
        <div className="card card-p" style={{ marginBottom: 14, borderColor: 'rgba(242,183,5,0.35)', background: 'rgba(242,183,5,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <JxIcon name="alert" size={16} color="var(--amber)" />
            <div style={{ fontSize: 12, color: 'var(--ts)', lineHeight: 1.55 }}>
              <strong style={{ color: 'var(--tp)' }}>Stock sin distribuir por ubicación:</strong>{' '}
              {CATS.filter(c => sinDistribuir[c.key] > 0)
                .map(c => `${c.label} ${fmtN(sinDistribuir[c.key])} unid.`)
                .join(' · ')}
              <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 3 }}>
                Es stock que existe en el total de la obra pero no figura en ningún almacén — por eso las tarjetas de arriba suman más que la tabla. Suele ser stock registrado antes de que existieran los almacenes, o movimientos sin almacén. Para asignarlo, registrá los ingresos eligiendo el almacén de llegada.
              </div>
              {sinDistDetalle && CATS.some(c => (sinDistDetalle[c.key] || []).length > 0) && (
                <button className="btn btn-ghost btn-xs" style={{ marginTop: 8 }} onClick={() => setSinDistAbierto(v => !v)}>
                  {sinDistAbierto ? '▾ Ocultar detalle' : '▸ Ver qué insumos faltan asignar'}
                </button>
              )}
              {sinDistAbierto && sinDistDetalle && (
                <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
                  {CATS.filter(c => (sinDistDetalle[c.key] || []).length > 0).map(c => {
                    const lista = sinDistDetalle[c.key];
                    const verTodo = sinDistVerTodo.has(c.key);
                    const visibles = verTodo ? lista : lista.slice(0, 10);
                    return (
                      <div key={c.key}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: c.color, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
                          <JxIcon name={c.icon} size={11} color={c.color} /> {c.label} · {lista.length}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {visibles.map((it, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11.5 }}>
                              <span style={{ color: 'var(--ts)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.nombre}</span>
                              <span style={{ fontWeight: 600, whiteSpace: 'nowrap', color: 'var(--amber)' }}>{fmtN(it.faltante)} {it.unidad}</span>
                            </div>
                          ))}
                          {lista.length > 10 && (
                            <button className="btn btn-ghost btn-xs" style={{ alignSelf: 'flex-start' }}
                              onClick={() => setSinDistVerTodo(prev => { const n = new Set(prev); n.has(c.key) ? n.delete(c.key) : n.add(c.key); return n; })}>
                              {verTodo ? 'Ver menos' : `… y ${lista.length - 10} más`}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card card-p empty-state"><JxIcon name="map" size={32} color="var(--tm)" /><p>Cargando…</p></div>
      ) : total === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="map" size={40} color="var(--tm)" />
          <p>No hay ubicaciones en esta obra.</p>
          {canWrite && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn btn-amber btn-sm" onClick={sembrar}>
                <JxIcon name="plus" size={12} />Sembrar 4 por defecto
              </button>
              <button className="btn btn-ghost btn-sm" onClick={openNueva}>Crear manual</button>
            </div>
          )}
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th style={{ width: 50, textAlign: 'right' }}>Orden</th>
                <th>Ubicación</th>
                {CATS.map(c => (
                  <th key={c.key} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <JxIcon name={c.icon} size={11} color={c.color} /> {c.label}
                  </th>
                ))}
                <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Total ítems</th>
                <th>Estado</th>
                <th style={{ textAlign: 'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {sorted.map(u => {
                  const d = porUbic.get(u.id);
                  const uso = usoDe(u);
                  const inactiva = u.activo === false;
                  const abierta = expandidas.has(u.id);
                  const det = detalles[u.id];
                  return (
                    <React.Fragment key={u.id}>
                      <tr
                        style={{ opacity: inactiva ? 0.55 : 1, cursor: uso.unidades > 0 ? 'pointer' : 'default', background: abierta ? 'rgba(245,158,11,0.06)' : undefined }}
                        onClick={() => { if (uso.unidades > 0) toggleExpand(u.id); }}
                      >
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{u.orden ?? '—'}</td>
                        <td className="col-p">
                          {uso.unidades > 0 && (
                            <span style={{ color: 'var(--amber)', marginRight: 6, fontWeight: 700 }}>{abierta ? '▾' : '▸'}</span>
                          )}
                          <strong>{u.nombre}</strong>
                          {u.descripcion ? <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 1 }}>{u.descripcion}</div> : null}
                        </td>
                        {CATS.map(c => (
                          <td key={c.key} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{celdaCat(d, c)}</td>
                        ))}
                        {/* El nº de ítems lleva el peso: la suma de unidades cruza
                            categorías (m3 + kg + und…) y sola no dice nada operativo. */}
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {cargandoStock
                            ? <span style={{ color: 'var(--tm)' }}>…</span>
                            : uso.items > 0
                              ? <span>
                                  <strong>{fmtN(uso.items)} ítem{uso.items > 1 ? 's' : ''}</strong>
                                  <span style={{ fontSize: 10, color: 'var(--tm)', marginLeft: 4 }}>{fmtN(uso.unidades)} unid.</span>
                                </span>
                              : <span style={{ color: 'var(--tm)' }}>0</span>}
                        </td>
                        <td><span className={`badge ${inactiva ? 'b-gray' : 'b-green'}`}>{inactiva ? 'Inactiva' : 'Activa'}</span></td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }} onClick={ev => ev.stopPropagation()}>
                          {canWrite && (
                            <>
                              <button className="btn btn-ghost btn-xs" title="Editar" onClick={() => openEditar(u)}>
                                <JxIcon name="edit" size={11} />
                              </button>
                              <button
                                className={`btn btn-xs ${inactiva ? 'btn-amber' : 'btn-ghost'}`}
                                title={inactiva ? 'Reactivar' : 'Desactivar'}
                                onClick={() => toggleActivo(u)}
                                style={{ marginLeft: 4 }}
                              >
                                {inactiva ? '↻' : '⏸'}
                              </button>
                              <button
                                className="btn btn-red btn-xs"
                                title="Eliminar"
                                onClick={() => eliminar(u)}
                                style={{ marginLeft: 4 }}
                              >
                                <JxIcon name="trash" size={11} />
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                      {abierta && (
                        <tr>
                          <td colSpan={5 + CATS.length} style={{ background: 'var(--bg-c)', padding: '10px 16px 14px' }}>
                            {det?.loading && <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Cargando detalle…</div>}
                            {det?.error && <div style={{ fontSize: 11.5, color: 'var(--red)' }}>Error: {det.error}</div>}
                            {det?.grupos && det.grupos.length === 0 && (
                              <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Sin stock registrado en esta ubicación.</div>
                            )}
                            {det?.grupos && det.grupos.length > 0 && (
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                                {det.grupos.map(g => (
                                  <div key={g.cat.key}>
                                    <div style={{ fontSize: 10.5, fontWeight: 700, color: g.cat.color, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
                                      <JxIcon name={g.cat.icon} size={11} color={g.cat.color} /> {g.cat.label} · {g.items.length}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                      {g.items.slice(0, 30).map((it, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11.5 }}>
                                          <span style={{ color: 'var(--ts)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.nombre}</span>
                                          <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtN(it.cantidad)} {it.unidad}</span>
                                        </div>
                                      ))}
                                      {g.items.length > 30 && (
                                        <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>… y {g.items.length - 30} más</div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal === 'form' && (
        <Modal
          title={editing ? 'Editar Ubicación' : 'Nueva Ubicación'}
          icon="map"
          onClose={() => { setModal(null); setEditing(null); }}
        >
          <div className="g2">
            <div style={{ gridColumn: '1/-1' }}>
              <label className="flabel">Nombre *</label>
              <input
                className="fi"
                placeholder="Patio, Bóveda, Almacén Central…"
                value={form.nombre}
                onChange={e => setForm({ ...form, nombre: e.target.value })}
              />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label className="flabel">Descripción</label>
              <input
                className="fi"
                placeholder="Detalle opcional"
                value={form.descripcion}
                onChange={e => setForm({ ...form, descripcion: e.target.value })}
              />
            </div>
            <div>
              <label className="flabel">Orden</label>
              <input
                className="fi"
                type="number"
                value={form.orden}
                onChange={e => setForm({ ...form, orden: e.target.value })}
              />
            </div>
            {editing && (
              <div>
                <label className="flabel">Estado</label>
                <select
                  className="fi"
                  value={form.activo ? '1' : '0'}
                  onChange={e => setForm({ ...form, activo: e.target.value === '1' })}
                >
                  <option value="1">Activa</option>
                  <option value="0">Inactiva</option>
                </select>
              </div>
            )}
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => { setModal(null); setEditing(null); }}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}>
              <JxIcon name="check" size={13} />{editing ? 'Guardar' : 'Crear'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { UbicacionesPage });
