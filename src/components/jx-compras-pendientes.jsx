// ═══════════════════════════════════════════════════════════════════
// JARVEX — Compras pendientes de recepción
//
// Pantalla pensada para el almacenero (también accesible a admin /
// jefe_compras). Lista todas las facturas que la contadora cargó vía
// captura mágica y que tienen recepcion_status='pendiente_recepcion'.
//
// El almacenero ve solo lo que necesita:
//   - Nombre del proveedor / razón social
//   - Items: descripción + cantidad + unidad (NO precio)
//   - Fecha de la factura
// Click en "Registrar recepción" → modal de ingreso con los items
// pre-rellenados. Al confirmar, marca la factura como 'recibido' y
// crea los movimientos de entrada al inventario.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { TIPO_INSUMO_LABEL, TIPO_INSUMO_BADGE } from "../lib/insumo-clasificador.js";
import { aplicarDelta } from "../lib/stock-ubicaciones.js";
import { calcAlerta } from "../lib/stock-utils.js";
import { getCurrentMode } from "../hooks/useAppMode.js";

const { useState: uS, useEffect: uE, useMemo: uM } = React;

const JxIcon = (props) => (window.JxIcon ? <window.JxIcon {...props}/> : null);
const Modal = (props) => (window.Modal ? <window.Modal {...props}/> : null);
const SearchableSelect = (props) => (window.SearchableSelect ? <window.SearchableSelect {...props}/> : null);

// Config por tipo de insumo: tabla de movimiento, fk, item_tipo de
// stock_ubicaciones y la tabla de catálogo (para subir stock_actual).
const CFG_TIPO = {
  material:    { mov: 'movimientos_materiales',         fk: 'material_id',    itemTipo: 'material',    cat: 'materiales',   nombreCol: 'nombre_material',    idkey: 'movmat' },
  herramienta: { mov: 'movimientos_herramientas',       fk: 'herramienta_id', itemTipo: 'herramienta', cat: 'herramientas', nombreCol: 'nombre_herramienta', idkey: 'movherr' },
  epp:         { mov: 'movimientos_epp',                fk: 'epp_id',         itemTipo: 'epp',         cat: 'epps',         nombreCol: 'nombre_epp',         idkey: 'movepp' },
};

function ComprasPendientesPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : {};
  const userId = auth?.profile?.id || null;
  // useObraActiva retorna { obraId, obra, obras, setObraActiva, loading }.
  // Asignar el objeto entero a `obraId` rompe el filtro porque la comparación
  // `m.obra_id === obraId` siempre da false.
  const obraHook = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const obraId = obraHook?.obraId || null;

  const [movsContables, setMovsContables] = uS([]);
  const [materiales, setMateriales] = uS([]);
  const [herramientas, setHerramientas] = uS([]);
  const [epps, setEpps] = uS([]);
  const [proveedores, setProveedores] = uS([]);
  const [loading, setLoading] = uS(true);
  const [recibiendoId, setRecibiendoId] = uS(null);   // id del mov contable a recibir
  const [busy, setBusy] = uS(false);

  // Carga inicial + reactivo a sync
  uE(() => {
    if (!obraId) return;
    let cancelled = false;
    const load = async () => {
      try {
        // `obra_id` NO está indexado en accounting_movements (ver
        // jarvex.db.js, schema version 15). Por eso filtramos en memoria.
        // Pasar `.where('obra_id')` con un keyPath no indexado en Dexie
        // tira SchemaError y la promesa rechaza → la lista queda vacía
        // sin que el usuario se entere.
        const [mcAll, mt, hr, ep, pr] = await Promise.all([
          window.__db.accounting_movements.toArray(),
          window.__db.materiales.where('obra_id').equals(obraId).toArray(),
          window.__db.herramientas.where('obra_id').equals(obraId).toArray(),
          window.__db.epps.where('obra_id').equals(obraId).toArray(),
          window.__db.proveedores.toArray(),
        ]);
        const mc = mcAll.filter(m =>
          m.obra_id === obraId &&
          ['pendiente_recepcion', 'parcial'].includes(m.recepcion_status) &&
          !m.deleted_at
        );
        if (cancelled) return;
        mc.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        setMovsContables(mc);
        setMateriales(mt);
        setHerramientas(hr);
        setEpps(ep);
        setProveedores(pr);
      } catch (e) {
        console.warn('[compras-pendientes]', e?.message || e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const onChange = (e) => {
      const t = e?.detail?.tabla || e?.detail?.table;
      if (!t || ['accounting_movements','materiales','herramientas','epps','proveedores'].includes(t)) load();
    };
    window.addEventListener('jx_data_changed', onChange);
    window.addEventListener('jarvex_master_updated', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('jx_data_changed', onChange);
      window.removeEventListener('jarvex_master_updated', onChange);
    };
  }, [obraId]);

  const matsById = uM(() => new Map(materiales.map(m => [m.id, m])), [materiales]);
  const herrsById = uM(() => new Map(herramientas.map(h => [h.id, h])), [herramientas]);
  const eppsById = uM(() => new Map(epps.map(e => [e.id, e])), [epps]);
  const provsById = uM(() => new Map(proveedores.map(p => [p.id, p])), [proveedores]);
  // Catálogo unificado para verificar que un id existe en cualquier tabla
  const catalogoCompleto = uM(() => {
    const m = new Map();
    materiales.forEach(x => m.set(x.id, { tipo: 'material', record: x }));
    herramientas.forEach(x => m.set(x.id, { tipo: 'herramienta', record: x }));
    epps.forEach(x => m.set(x.id, { tipo: 'epp', record: x }));
    return m;
  }, [materiales, herramientas, epps]);
  // Lista plana para el selector de match manual (vincular el ítem de la factura
  // a un insumo del catálogo aunque el nombre difiera).
  const catalogoTodos = uM(() => [
    ...materiales.filter(x => !x.deleted_at && !x.es_grupo).map(x => ({ id: x.id, tipo: 'material', nombre: x.nombre_material || '—' })),
    ...herramientas.filter(x => !x.deleted_at && !x.es_grupo).map(x => ({ id: x.id, tipo: 'herramienta', nombre: x.nombre_herramienta || '—' })),
    ...epps.filter(x => !x.deleted_at && !x.es_grupo).map(x => ({ id: x.id, tipo: 'epp', nombre: x.nombre_epp || '—' })),
  ], [materiales, herramientas, epps]);

  // Parse items del JSON de notas (los guarda captura mágica)
  const parseItems = (notasRaw) => {
    try {
      const j = JSON.parse(notasRaw || '{}');
      return Array.isArray(j.items_factura) ? j.items_factura : [];
    } catch { return []; }
  };

  const facturaSeleccionada = recibiendoId
    ? movsContables.find(m => m.id === recibiendoId)
    : null;

  if (!obraId) {
    return (
      <div className="page-wrap">
        <div className="empty-state">
          <JxIcon name="package" size={32} color="var(--tm)"/>
          <p>Selecciona una obra activa para ver las compras pendientes.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Compras pendientes de recepción</div>
          <div className="pg-sub">
            {movsContables.length} factura(s) por recibir (incluye recepciones parciales en curso)
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card card-p" style={{ textAlign:'center', color:'var(--tm)' }}>Cargando...</div>
      ) : movsContables.length === 0 ? (
        <div className="card card-p" style={{ textAlign:'center', color:'var(--tm)' }}>
          <JxIcon name="check" size={28} color="var(--green)"/>
          <p style={{ marginTop:10 }}>Sin compras pendientes. Cuando la contadora cargue una factura aparecerá aquí.</p>
        </div>
      ) : (
        <div style={{ display:'grid', gap:10 }}>
          {movsContables.map(mc => {
            const items = parseItems(mc.notas);
            const prov = mc.proveedor_id ? provsById.get(mc.proveedor_id) : null;
            const provName = prov?.razon_social || mc.third_party_name || '—';
            return (
              <div key={mc.id} className="card card-p" style={{ borderLeft:'3px solid var(--amber)' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10, flexWrap:'wrap' }}>
                  <div style={{ flex:1, minWidth:280 }}>
                    <div style={{ fontSize:11, color:'var(--amber)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em' }}>
                      {mc.document_type || 'comprobante'} {mc.document_number}
                      {mc.recepcion_status === 'parcial' && <span className="badge b-amber" style={{ marginLeft:8, fontSize:9 }}>Recepción parcial</span>}
                    </div>
                    <div style={{ fontSize:14, fontWeight:600, color:'var(--ts)', marginTop:2 }}>
                      {provName}
                    </div>
                    <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:4 }}>
                      Fecha factura: {mc.date} · cargada el {(mc.created_at || '').slice(0,10)}
                    </div>
                  </div>
                  <button className="btn btn-amber btn-sm" onClick={() => setRecibiendoId(mc.id)}>
                    <JxIcon name="arrowIn" size={12}/> Registrar recepción
                  </button>
                </div>
                {items.length > 0 ? (
                  <div style={{ marginTop:10, padding:'8px 10px', background:'var(--bg2)', border:'1px solid var(--bd)', borderRadius:6 }}>
                    <div style={{ fontSize:10.5, color:'var(--tm)', fontWeight:600, marginBottom:4, textTransform:'uppercase', letterSpacing:'.05em' }}>
                      Items a recibir ({items.length})
                    </div>
                    <table className="tbl" style={{ fontSize:11.5 }}>
                      <thead><tr>
                        <th>Insumo</th>
                        <th style={{ width:90 }}>Tipo</th>
                        <th style={{ width:80, textAlign:'right' }}>Cantidad</th>
                        <th style={{ width:60 }}>Unidad</th>
                        <th style={{ width:80 }}>En catálogo</th>
                      </tr></thead>
                      <tbody>
                        {items.map((it, i) => {
                          const enCatalogo = it.material_id && catalogoCompleto.has(it.material_id);
                          const tipo = it.tipo_insumo || 'material';
                          return (
                            <tr key={i}>
                              <td style={{ color:'var(--ts)' }}>{it.descripcion || '—'}</td>
                              <td>
                                <span className={`badge ${TIPO_INSUMO_BADGE[tipo] || 'b-gray'}`} style={{ fontSize:9 }}>
                                  {TIPO_INSUMO_LABEL[tipo] || tipo}
                                </span>
                              </td>
                              <td style={{ textAlign:'right', fontWeight:600 }}>
                                {Number(it.cantidad).toLocaleString('es-PE')}
                                {Number(it.recibido) > 0 && <div style={{ fontSize:9.5, color:'var(--green)' }}>recibido {Number(it.recibido).toLocaleString('es-PE')}</div>}
                              </td>
                              <td style={{ color:'var(--tm)' }}>{it.unidad || '—'}</td>
                              <td>
                                {tipo === 'servicio'
                                  ? <span className="badge b-purple" style={{ fontSize:9 }}>N/A</span>
                                  : enCatalogo
                                    ? <span className="badge b-green" style={{ fontSize:9 }}>OK</span>
                                    : <span className="badge b-yellow" style={{ fontSize:9 }}>Falta</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ marginTop:10, fontSize:11, color:'var(--tm)', fontStyle:'italic' }}>
                    La factura no detalla items (probablemente un gasto general).
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Registrar Recepción */}
      {facturaSeleccionada && (
        <RegistrarRecepcionModal
          factura={facturaSeleccionada}
          items={parseItems(facturaSeleccionada.notas)}
          obraId={obraId}
          userId={userId}
          catalogoCompleto={catalogoCompleto}
          catalogoTodos={catalogoTodos}
          provsById={provsById}
          busy={busy}
          setBusy={setBusy}
          showToast={showToast}
          onClose={() => setRecibiendoId(null)}
        />
      )}
    </div>
  );
}

// ─── Modal de Recepción (editable, con match manual y parcial multi-almacén) ──
function RegistrarRecepcionModal({ factura, items, obraId, userId, catalogoCompleto, catalogoTodos, provsById, busy, setBusy, showToast, onClose }) {
  // Cada fila: el tipo y el match son EDITABLES. Por defecto toma lo que dejó
  // la IA (material_id + tipo_insumo); el almacenero puede corregirlos.
  const tipoDeId = (id) => catalogoCompleto.get(id)?.tipo || null;
  // Tipos que NO ingresan al almacén: servicios/gastos (combustible, fletes,
  // alquiler, honorarios) y maquinaria (vive en activos_pesados, fuera de este
  // catálogo). NO son recibibles ni "creables" como insumo: si se forzaran a
  // 'material' —el select de Tipo solo ofrece material/herramienta/epp— se
  // crearía un insumo fantasma con stock que contamina inventario y reportes.
  // Los mostramos como N/A, igual que la lista de Compras Pendientes.
  const NO_STOCK = new Set(['servicio', 'maquinaria']);
  const [recep, setRecep] = uS(() =>
    items.map(it => {
      const ya = Number(it.recibido) || 0;
      const resta = Math.max(0, (Number(it.cantidad) || 0) - ya);
      const noStock = NO_STOCK.has(it.tipo_insumo);
      const matchId = it.material_id && catalogoCompleto.has(it.material_id) ? it.material_id : null;
      // Para no-stock conservamos el tipo real (servicio/maquinaria): NO lo
      // colapsamos a 'material' porque eso habilitaba el botón "Crear" y la
      // verificación. Para el resto, el tipo del match o el detectado por la IA.
      const tipo = noStock
        ? it.tipo_insumo
        : ((matchId && tipoDeId(matchId)) || (it.tipo_insumo || 'material'));
      return {
        ...it, ya_recibido: ya, no_stock: noStock,
        cantidad_recibida: resta,                        // por defecto, lo que falta
        verificado: !noStock && resta > 0 && !!matchId,  // listo si hay match y falta recibir
        match_id: noStock ? null : matchId, tipo,
        ubicacion_id: null, obs_item: '',
      };
    })
  );
  const [obsGlobal, setObsGlobal] = uS('');
  const [ubicaciones, setUbicaciones] = uS([]);
  // Candado SÍNCRONO contra doble-post. `busy` (estado de React) no protege de
  // un doble-click rápido: el 2do click dispara su handler ANTES de que React
  // re-renderice el botón con disabled, así que confirmar() correría dos veces
  // → movimientos duplicados + stock sumado dos veces. El ref se setea en el
  // mismo tick y bloquea la 2da entrada.
  const enviandoRef = React.useRef(false);

  uE(() => {
    let cancelled = false;
    (async () => {
      try {
        const u = await window.__db.ubicaciones_obra.where('obra_id').equals(obraId)
          .filter(x => x.activo !== false && !x.deleted_at).toArray();
        if (!cancelled) setUbicaciones(u || []);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [obraId]);

  const upd = (idx, patch) => setRecep(arr => arr.map((it, i) => i === idx ? { ...it, ...patch } : it));

  // Opciones de match para el SearchableSelect, filtradas por el tipo elegido en
  // la fila (material/herramienta/epp). value = id del insumo del catálogo.
  const opcionesPorTipo = uM(() => {
    const o = { material: [], herramienta: [], epp: [] };
    for (const c of (catalogoTodos || [])) (o[c.tipo] || o.material).push({ value: c.id, label: c.nombre });
    return o;
  }, [catalogoTodos]);

  // Crear un insumo nuevo del tipo elegido y vincularlo a la fila (cuando la
  // factura trae algo que no está en el catálogo).
  const crearYVincular = async (idx) => {
    const it = recep[idx];
    if (it.no_stock) { showToast?.('Servicios y maquinaria no se crean como insumo de almacén', 'red'); return; }
    const cfg = CFG_TIPO[it.tipo] || CFG_TIPO.material;
    const nombre = String(it.descripcion || '').trim();
    if (!nombre) { showToast?.('La fila no tiene descripción para crear el insumo', 'red'); return; }
    try {
      const now = new Date().toISOString();
      const id = window.__newId();
      // En modo prueba el insumo es demo: queda 'synced' (no entra a la cola de
      // push) y lleva demo:true para que lo vea el filtro de modo prueba y el
      // SyncEngine no lo suba a Supabase. Mismo patrón que crearItemEnTabla.
      const isPrueba = getCurrentMode() === 'prueba';
      const base = {
        id, obra_id: obraId, [cfg.nombreCol]: nombre, unidad: it.unidad || 'und',
        stock_inicial: 0, stock_actual: 0, stock_minimo: 0, alerta: 'ok', estado: 'activo',
        created_by: userId, updated_by: userId, created_at: now, updated_at: now,
        version: 1, sync_status: isPrueba ? 'synced' : 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_${cfg.cat}_${id}`,
        ...(isPrueba ? { demo: true } : {}),
      };
      if (cfg.cat === 'herramientas') Object.assign(base, { tipo_herramienta: 'manual', estado_actual: 'nuevo', ubicacion_actual: 'almacen', disponible: true, maneja_cantidad: true });
      if (cfg.cat === 'epps') Object.assign(base, { tipo_epp: 'Otro' });
      await window.__db[cfg.cat].add(base);
      upd(idx, { match_id: id, verificado: Number(it.cantidad_recibida) > 0 });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: cfg.cat } })); } catch {}
      showToast?.(`"${nombre}" creado en ${cfg.cat} y vinculado`, 'green');
    } catch (e) { showToast?.('Error al crear: ' + (e.message || e), 'red'); }
  };

  const confirmar = async () => {
    const validos = recep.filter(r => !r.no_stock && r.verificado && r.match_id && Number(r.cantidad_recibida) > 0);
    if (validos.length === 0) { showToast?.('Marcá al menos 1 ítem verificado, con insumo vinculado y cantidad > 0', 'red'); return; }
    // Aviso (no bloqueo) si se recibe MÁS de lo que falta por facturar: puede ser
    // legítimo (el proveedor mandó de más) pero suele ser un tipeo.
    const excedidos = validos.filter(r => {
      const falta = Math.max(0, (Number(r.cantidad) || 0) - (Number(r.ya_recibido) || 0));
      return Number(r.cantidad_recibida) > falta + 0.0001;
    });
    if (excedidos.length > 0) {
      const detalle = excedidos.map(r => `• ${r.descripcion}: recibís ${Number(r.cantidad_recibida).toLocaleString('es-PE')} y faltaba ${Math.max(0, (Number(r.cantidad) || 0) - (Number(r.ya_recibido) || 0)).toLocaleString('es-PE')}`).join('\n');
      const ok = window.confirm(`Estás recibiendo MÁS de lo facturado en ${excedidos.length} ítem(s):\n\n${detalle}\n\n¿Confirmás de todos modos?`);
      if (!ok) return;
    }
    // A partir de acá ya hay escrituras en la BD: cerramos el candado síncrono.
    // Si ya estaba cerrado, este es un 2do disparo (doble-click) → cortamos.
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      // En modo prueba todo lo creado/actualizado es demo: 'synced' + demo:true
      // para que no se pushee a Supabase y lo vea el filtro de modo prueba.
      const isPrueba = getCurrentMode() === 'prueba';
      let creados = 0;
      let primerMov = null;
      // Reconciliamos por ÍNDICE de fila, no por descripción: una misma factura
      // puede traer dos renglones con idéntica `descripcion` (ej. el mismo ítem
      // facturado dos veces o descripciones genéricas). Joinear por texto
      // colapsaría/duplicaría lo recibido. `recep` es 1:1 y en orden con
      // items_factura (ambos derivan del mismo JSON), así que el índice es estable.
      const recibidoPorIdx = new Map(); // idx de fila → cantidad recibida ahora
      for (const it of validos) {
        const idx = recep.indexOf(it);
        const cfg = CFG_TIPO[it.tipo] || CFG_TIPO.material;
        const cant = Number(it.cantidad_recibida) || 0;
        const movId = window.__newId();
        const obs = ['Recepción factura ' + factura.document_number, obsGlobal, it.obs_item].filter(Boolean).join(' · ');
        const baseMov = {
          id: movId, obra_id: obraId, fecha: now.slice(0, 10), hora: now.slice(11, 16),
          cantidad: cant, unidad: it.unidad || 'und', observaciones: obs,
          proveedor_id: factura.proveedor_id || null, documento_asociado: factura.document_number || null,
          ubicacion_id: it.ubicacion_id || null,
          created_by: userId, updated_by: userId, created_at: now, updated_at: now,
          version: 1, sync_status: isPrueba ? 'synced' : 'pending_create', idempotency_key: `${userId}_${cfg.idkey}_${movId}`,
          ...(isPrueba ? { demo: true } : {}),
        };
        if (cfg.cat === 'herramientas') Object.assign(baseMov, { herramienta_id: it.match_id, accion: 'entrada', tipo_movimiento: 'ingreso', estado_devolucion: 'nuevo' });
        else if (cfg.cat === 'epps') Object.assign(baseMov, { epp_id: it.match_id, tipo_movimiento: 'entrada', precio_unitario_real: Number(it.precio_unitario) || 0 });
        else Object.assign(baseMov, { material_id: it.match_id, tipo_movimiento: 'entrada', precio_unitario_real: Number(it.precio_unitario) || 0, partida_id: null });
        await window.__db[cfg.mov].add(baseMov);
        primerMov = primerMov || movId;

        // SUBIR stock_actual del insumo (el bug: antes solo creaba el movimiento).
        try {
          const rec = await window.__db[cfg.cat].get(it.match_id);
          if (rec) {
            const nuevoStock = Math.max(0, (Number(rec.stock_actual) || 0) + cant);
            const patch = { stock_actual: nuevoStock, alerta: calcAlerta(nuevoStock, Number(rec.stock_minimo || 0)), updated_at: now, updated_by: userId, version: (rec.version || 0) + 1, sync_status: (isPrueba || rec.demo === true) ? 'synced' : (rec.sync_status === 'pending_create' ? 'pending_create' : 'pending_update') };
            if (cfg.cat === 'materiales' && it.ubicacion_id && !rec.ubicacion_id) patch.ubicacion_id = it.ubicacion_id;
            await window.__db[cfg.cat].update(it.match_id, patch);
          }
        } catch {}
        // Desglose por almacén si se eligió ubicación.
        if (it.ubicacion_id) {
          try { await aplicarDelta({ obraId, itemTipo: cfg.itemTipo, itemId: it.match_id, ubicacionId: it.ubicacion_id, delta: cant, userId }); } catch {}
        }
        creados++;
        if (idx >= 0) recibidoPorIdx.set(idx, (recibidoPorIdx.get(idx) || 0) + cant);
      }

      // Actualizar items_factura con lo recibido acumulado + el match elegido, y
      // decidir si la factura queda RECIBIDA (todo completo) o PARCIAL.
      let notasObj = {};
      try { notasObj = JSON.parse(factura.notas || '{}'); } catch {}
      // Tipos que NO ingresan al almacén (servicios, fletes, alquiler de
      // maquinaria): no son "recibibles" físicamente, así que NO cuentan para
      // decidir si la factura está completa. Si no se excluyen, una factura con
      // una línea de servicio quedaría PARCIAL para siempre.
      const NO_STOCK = new Set(['servicio', 'maquinaria']);
      const itemsActualizados = (Array.isArray(notasObj.items_factura) ? notasObj.items_factura : items).map((orig, idx) => {
        const fila = recep[idx];
        const sumNow = recibidoPorIdx.get(idx) || 0;
        const recibido = (Number(orig.recibido) || 0) + sumNow;
        // Conservamos el tipo original si era no-stock (servicio/maquinaria);
        // para el resto, el tipo corregido por el almacenero.
        const tipoFinal = NO_STOCK.has(orig.tipo_insumo) ? orig.tipo_insumo : (fila?.tipo || orig.tipo_insumo);
        return { ...orig, recibido, material_id: fila?.match_id || orig.material_id, tipo_insumo: tipoFinal };
      });
      const todoCompleto = itemsActualizados.every(it =>
        NO_STOCK.has(it.tipo_insumo) ||
        (Number(it.recibido) || 0) >= (Number(it.cantidad) || 0) - 0.0001);
      notasObj.items_factura = itemsActualizados;

      await window.__db.accounting_movements.update(factura.id, {
        notas: JSON.stringify(notasObj),
        recepcion_status: todoCompleto ? 'recibido' : 'parcial',
        recepcion_movimiento_id: primerMov,
        recepcion_fecha: now, recepcion_por: userId,
        updated_at: now, updated_by: userId,
        version: (factura.version || 0) + 1,
        sync_status: (isPrueba || factura.demo === true) ? 'synced' : (factura.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
      });

      try { await window.__logAudit?.({ action: 'update', table: 'accounting_movements', recordId: factura.id, reason: `Recepción ${todoCompleto ? 'completa' : 'PARCIAL'} — ${creados} ingreso(s) · factura ${factura.document_number}` }); } catch {}
      showToast?.(`✓ ${creados} ingreso(s) registrados${todoCompleto ? '' : ' · queda PARCIAL (falta recibir el resto)'}`, 'green');
      ['movimientos_materiales', 'movimientos_herramientas', 'movimientos_epp', 'materiales', 'herramientas', 'epps', 'accounting_movements', 'stock_ubicaciones'].forEach(t => { try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: t } })); } catch {} });
      onClose();
    } catch (e) {
      showToast?.('Error al registrar recepción: ' + (e?.message || e), 'red');
      console.error('[registrar-recepcion]', e);
    } finally { enviandoRef.current = false; setBusy(false); }
  };

  const provName = factura.proveedor_id ? (provsById.get(factura.proveedor_id)?.razon_social || factura.third_party_name) : factura.third_party_name;
  const TIPOS = [['material', 'Material'], ['herramienta', 'Herramienta'], ['epp', 'EPP']];

  return (
    <Modal title={`Registrar recepción · ${factura.document_number}`} icon="arrowIn" onClose={onClose} size="xl">
      <div style={{ marginBottom: 12, padding: '10px 12px', background: 'rgba(52,152,219,0.08)', border: '1px solid rgba(52,152,219,0.25)', borderRadius: 6, fontSize: 12 }}>
        <strong>{provName || '—'}</strong> · factura del {factura.date}<br/>
        <span style={{ color: 'var(--tm)', fontSize: 11 }}>
          Corregí el tipo y vinculá cada ítem al insumo del catálogo (aunque el nombre difiera). Ajustá la cantidad recibida, el almacén y observaciones. Si recibís solo una parte, registrá lo que llegó: la factura queda <strong>parcial</strong> y el resto sigue pendiente (sirve para repartir entre almacenes).
        </span>
      </div>

      <div style={{ overflow: 'auto', maxHeight: 420, border: '1px solid var(--border)', borderRadius: 6, marginBottom: 12 }}>
        <table className="tbl" style={{ fontSize: 12 }}>
          <thead><tr>
            <th style={{ width: 34, textAlign: 'center' }}>✓</th>
            <th style={{ minWidth: 220 }}>Factura · vincular a insumo</th>
            <th style={{ width: 110 }}>Tipo</th>
            <th style={{ width: 90, textAlign: 'right' }}>Falta</th>
            <th style={{ width: 100, textAlign: 'right' }}>Recibo *</th>
            <th style={{ minWidth: 150 }}>Almacén</th>
            <th style={{ minWidth: 130 }}>Observación</th>
          </tr></thead>
          <tbody>
            {recep.map((it, i) => {
              const cfgCat = (CFG_TIPO[it.tipo] || CFG_TIPO.material).cat;
              const opciones = [{ value: '', label: '— Vincular a ' + (TIPOS.find(t => t[0] === it.tipo)?.[1] || '') + ' —' }, ...(opcionesPorTipo[it.tipo] || [])];
              // Servicio / maquinaria: no entran al almacén. Fila informativa (N/A)
              // y bloqueada — sin checkbox, sin vincular/crear, sin Tipo editable ni
              // cantidad. Así no puede forzarse a 'material' (insumo fantasma).
              if (it.no_stock) {
                const etiqueta = it.tipo_insumo === 'maquinaria' ? 'Maquinaria (activos pesados)' : 'Servicio / gasto';
                return (
                  <tr key={i} style={{ opacity: 0.55 }}>
                    <td style={{ textAlign: 'center' }}>
                      <span className="badge b-purple" style={{ fontSize: 9 }}>N/A</span>
                    </td>
                    <td>
                      <div style={{ fontSize: 12, color: 'var(--ts)', marginBottom: 3 }}>{it.descripcion}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--tm)', fontStyle: 'italic' }}>
                        No va a inventario — se registró solo como costo en contabilidad.
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${TIPO_INSUMO_BADGE[it.tipo_insumo] || 'b-purple'}`} style={{ fontSize: 9 }}>{etiqueta}</span>
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--tm)' }}>—</td>
                    <td style={{ textAlign: 'right', color: 'var(--tm)' }}>—</td>
                    <td style={{ color: 'var(--tm)' }}>—</td>
                    <td style={{ color: 'var(--tm)' }}>—</td>
                  </tr>
                );
              }
              return (
                <tr key={i} style={{ opacity: it.verificado ? 1 : 0.55 }}>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={it.verificado} onChange={e => upd(i, { verificado: e.target.checked })} />
                  </td>
                  <td>
                    <div style={{ fontSize: 12, color: 'var(--ts)', marginBottom: 3 }}>{it.descripcion}</div>
                    <SearchableSelect value={it.match_id || ''} onChange={v => upd(i, { match_id: v || null, verificado: !!v && Number(it.cantidad_recibida) > 0 })}
                      options={opciones} fontSize={11} placeholder="— Buscar insumo del catálogo —" />
                    {!it.match_id && (
                      <button className="btn btn-ghost btn-xs" style={{ marginTop: 3 }} onClick={() => crearYVincular(i)}>
                        <JxIcon name="plus" size={10} /> Crear "{(it.descripcion || '').slice(0, 22)}" como {TIPOS.find(t => t[0] === it.tipo)?.[1]}
                      </button>
                    )}
                  </td>
                  <td>
                    <select className="fi" value={it.tipo} style={{ fontSize: 11, padding: '5px 6px' }}
                      onChange={e => { const nt = e.target.value; const keep = it.match_id && tipoDeId(it.match_id) === nt; upd(i, { tipo: nt, match_id: keep ? it.match_id : null, verificado: keep ? it.verificado : false }); }}>
                      {TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--tm)' }}>
                    {Number(Math.max(0, (Number(it.cantidad) || 0) - (it.ya_recibido || 0))).toLocaleString('es-PE')}
                    {it.ya_recibido > 0 && <div style={{ fontSize: 9, color: 'var(--green)' }}>de {Number(it.cantidad).toLocaleString('es-PE')}</div>}
                  </td>
                  <td>
                    <input className="fi" type="number" min="0" step="0.01" value={it.cantidad_recibida} disabled={!it.verificado}
                      title="Por defecto, lo que falta. Si recibís más de lo facturado se te pedirá confirmar."
                      onChange={e => upd(i, { cantidad_recibida: e.target.value })} style={{ fontSize: 12, textAlign: 'right' }} />
                  </td>
                  <td>
                    <select className="fi" value={it.ubicacion_id || ''} onChange={e => upd(i, { ubicacion_id: e.target.value || null })} style={{ fontSize: 11, padding: '5px 6px' }}>
                      <option value="">— Sin asignar —</option>
                      {ubicaciones.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                    </select>
                  </td>
                  <td>
                    <input className="fi" value={it.obs_item} onChange={e => upd(i, { obs_item: e.target.value })} placeholder="faltó / dañado…" style={{ fontSize: 11, padding: '5px 6px' }} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label className="flabel">Observación general de la recepción</label>
        <input className="fi" value={obsGlobal} onChange={e => setObsGlobal(e.target.value)} placeholder="Ej: llegó parcial, el resto lo recibe el almacén Central…" />
      </div>

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn btn-amber" onClick={confirmar} disabled={busy}>
          <JxIcon name="check" size={13} />{busy ? 'Procesando…' : 'Confirmar recepción'}
        </button>
      </div>
    </Modal>
  );
}

Object.assign(window, { ComprasPendientesPage });
