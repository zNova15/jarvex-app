// ═══════════════════════════════════════════════════════════════════
// JARVEX — Conciliación Tripartita de Insumos (Feature 4)
//
// Cruza las TRES fuentes del mismo insumo (que tienen nombres distintos):
//   1. PRESUPUESTO (Delfín)  → insumos_partida, consolidado por insumo_codigo.
//   2. FACTURAS (Captura Mágica) → accounting_movements.notas.items_factura[].
//   3. ALMACÉN  → movimientos de entrada vinculados a la factura (Vinculación 1).
//
// El equipo contable hace la "Vinculación 2": enlaza cada ítem de factura con un
// insumo del presupuesto (resolviendo "Clavo número 3" ↔ "Clavo N3"), con
// auto-sugerencia por similitud. Tabla nueva: conciliacion_vinculos.
//
// Métricas por insumo: Presupuestado · Facturado · Ingresado a almacén ·
// Saldo por comprar (presup − facturado) · Saldo de tránsito (facturado − ingresado).
// ═══════════════════════════════════════════════════════════════════

import React from "react";
import { getCurrentMode } from "../hooks/useAppMode";
import { sugerirInsumoMatch } from "../lib/sugerir-insumo-match.js";

const { useState: uS, useMemo: uM, useEffect: uE } = React;
const fmtN = (n) => Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 });
const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Normalización + score de similitud (mismo criterio que Captura Mágica).
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function fuzzyScore(a, b) {
  const A = new Set(norm(a).split(' ').filter(w => w.length > 2));
  const B = new Set(norm(b).split(' ').filter(w => w.length > 2));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  return inter / Math.max(A.size, B.size);
}

// Las 5 tablas de movimientos (para el "ingresado a almacén"). fk = id del catálogo
// que guarda el ítem de factura (campo material_id genérico en items_factura).
const MOV_TABLAS = [
  { mov: 'movimientos_materiales', fk: 'material_id' },
  { mov: 'movimientos_herramientas', fk: 'herramienta_id' },
  { mov: 'movimientos_epp', fk: 'epp_id' },
  { mov: 'movimientos_insumos_emergencia', fk: 'insumo_emergencia_id' },
  { mov: 'movimientos_maquinaria', fk: 'activo_id' },
];
// ¿El movimiento es una ENTRADA física al almacén?
function esEntrada(t, mv) {
  // Excluir reversos Y el original reversado (reversed_by_id): su efecto neto es 0.
  if (mv.deleted_at || mv.reverses_id || mv.reversed_by_id) return false;
  if (t === 'movimientos_herramientas') return mv.tipo_movimiento === 'ingreso' || mv.accion === 'entrada';
  return mv.tipo_movimiento === 'entrada';
}

const TIPO_LABEL = { material: 'Material', herramienta: 'Herramienta', epp: 'EPP', mano_obra: 'Mano de obra', equipo: 'Equipo', subcontrato: 'Subcontrato', subpartida: 'Subpartida' };
const TIPO_BADGE = { material: 'b-blue', herramienta: 'b-amber', epp: 'b-green', mano_obra: 'b-gray', equipo: 'b-orange', subcontrato: 'b-purple' };

function ConciliacionInsumosPage({ showToast }) {
  const toast = showToast || window.__showToast || (() => {});
  const { obraId } = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const userId = (window.__useAuth?.()?.profile?.id) || 'offline';

  const [maestra, setMaestra] = uS([]);       // insumos presupuestados consolidados por codigo
  const [items, setItems] = uS([]);           // ítems de factura (flat)
  const [vinculos, setVinculos] = uS([]);     // conciliacion_vinculos
  const [entradaMap, setEntradaMap] = uS(() => new Map()); // `${facturaId}|${catId}` -> cantidad ingresada
  const [loading, setLoading] = uS(true);

  const [q, setQ] = uS('');
  const [tipoFiltro, setTipoFiltro] = uS('material'); // por defecto materiales (lo que se compra/factura)
  const [estadoFiltro, setEstadoFiltro] = uS('todos'); // todos | con_saldo | facturados
  const [linkInsumo, setLinkInsumo] = uS(null); // insumo de la maestra que se está vinculando
  const [busy, setBusy] = uS(false);
  const [tab, setTab] = uS('presupuesto'); // 'presupuesto' (por insumo) | 'comprados' (por ítem de factura)
  const [qItems, setQItems] = uS('');       // búsqueda en la pestaña Insumos Comprados
  const [pickItem, setPickItem] = uS(null); // ítem de factura que se está vinculando a un insumo

  // ── Carga de las 3 fuentes + los vínculos ──
  uE(() => {
    if (!obraId) { setMaestra([]); setItems([]); setVinculos([]); setEntradaMap(new Map()); setLoading(false); return; }
    let cancel = false;
    const cargar = async () => {
      const db = window.__db;
      try {
        // 1) PRESUPUESTO: consolidar insumos_partida por insumo_codigo.
        const ips = await db.insumos_partida.where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray();
        const m = new Map();
        for (const ip of ips) {
          // Sin código Delfín: consolidar por nombre RAW + tipo + unidad (igual que el helper
          // canónico mi-frente.js), para no mezclar insumos distintos (ej. 'Andamio' equipo vs material).
          const codigo = (ip.insumo_codigo && String(ip.insumo_codigo).trim())
            || ('sc:' + (ip.nombre_insumo || '') + '|' + (ip.tipo_insumo || '') + '|' + (ip.unidad || ''));
          const cant = Number(ip.cantidad_presupuestada) || 0;
          const monto = Number(ip.costo_presupuestado) || (cant * (Number(ip.precio_presupuestado) || 0));
          const cur = m.get(codigo) || { codigo, nombre: ip.nombre_insumo || '—', unidad: ip.unidad || '', tipo: ip.tipo_insumo || 'material', cantPresup: 0, montoPresup: 0, nPartidas: 0 };
          cur.cantPresup += cant; cur.montoPresup += monto; cur.nPartidas += 1;
          m.set(codigo, cur);
        }
        // 2) FACTURAS: items_factura de los movimientos contables de la obra.
        const movs = await db.accounting_movements.filter(x => x.obra_id === obraId && !x.deleted_at).toArray();
        const its = [];
        for (const mv of movs) {
          if (mv.clase === 'venta') continue; // "Insumos Comprados" = solo COMPRAS
          let notas = null;
          try { notas = typeof mv.notas === 'string' ? JSON.parse(mv.notas) : mv.notas; } catch { notas = null; }
          const arr = notas && Array.isArray(notas.items_factura) ? notas.items_factura : null;
          if (!arr) continue;
          arr.forEach((it, idx) => its.push({
            facturaId: mv.id, itemIdx: idx,
            descripcion: it.descripcion || it.nombre || '—',
            unidad: it.unidad || 'und',
            cantidad: Number(it.cantidad) || 0,
            precio: Number(it.precio_unitario) || 0,
            catId: it.material_id || null,
            doc: `${mv.document_type || ''} ${mv.document_number || ''}`.trim(),
            fecha: mv.date || '', proveedor: mv.third_party_name || '',
            // Clasificación obra/empresa (la pone el contador en "Insumos Comprados").
            destino: it.destino || 'obra',
          }));
        }
        // 3) VÍNCULOS existentes.
        const vin = await db.conciliacion_vinculos.where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray();
        // 4) ENTRADAS de almacén ligadas a facturas (Vinculación 1): `${facturaId}|${catId}` -> cantidad.
        const eMap = new Map();
        for (const t of MOV_TABLAS) {
          try {
            await db[t.mov].where('obra_id').equals(obraId).each(mv => {
              if (!mv.accounting_movement_id || !esEntrada(t.mov, mv)) return;
              const key = `${mv.accounting_movement_id}|${mv[t.fk] || ''}`;
              eMap.set(key, (eMap.get(key) || 0) + (Number(mv.cantidad) || 0));
            });
          } catch {}
        }
        if (!cancel) {
          setMaestra(Array.from(m.values()));
          setItems(its);
          setVinculos(vin);
          setEntradaMap(eMap);
          setLoading(false);
        }
      } catch (e) { if (!cancel) { setLoading(false); } console.warn('[conciliacion]', e?.message); }
    };
    setLoading(true); cargar();
    let deb = null;
    const onData = () => { clearTimeout(deb); deb = setTimeout(() => { if (!cancel) cargar(); }, 400); };
    window.addEventListener('jx_data_changed', onData);
    window.addEventListener('jarvex_master_updated', onData);
    return () => { cancel = true; clearTimeout(deb); window.removeEventListener('jx_data_changed', onData); window.removeEventListener('jarvex_master_updated', onData); };
  }, [obraId]);

  // Vínculos agrupados por código de insumo presupuestado.
  const vincPorCodigo = uM(() => {
    const m = new Map();
    for (const v of vinculos) {
      const a = m.get(v.insumo_codigo) || []; a.push(v); m.set(v.insumo_codigo, a);
    }
    return m;
  }, [vinculos]);

  // Métricas por insumo de la maestra.
  const filas = uM(() => {
    const qn = norm(q);
    // Índice de ítems por (factura|itemIdx) para O(1) (evita items.find O(n·m) con 6.7k insumos).
    const itemByKey = new Map();
    for (const it of items) itemByKey.set(`${it.facturaId}|${it.itemIdx}`, it);
    // Cuántos vínculos (en TODA la maestra) apuntan a cada (factura|catId): la entrada física
    // de ese almacén se reparte entre todos (1/N) para no contarla más de una vez (ni dentro
    // del mismo insumo ni entre insumos distintos).
    const vincPorEntradaKey = new Map();
    for (const v of vinculos) {
      const it = itemByKey.get(`${v.accounting_movement_id}|${v.item_idx}`);
      if (it && it.catId) {
        const k = `${v.accounting_movement_id}|${it.catId}`;
        vincPorEntradaKey.set(k, (vincPorEntradaKey.get(k) || 0) + 1);
      }
    }
    return maestra.map(ins => {
      const vs = vincPorCodigo.get(ins.codigo) || [];
      let cantFact = 0, montoFact = 0, cantIngresada = 0;
      for (const v of vs) {
        const c = Number(v.cantidad) || 0;
        cantFact += c;
        montoFact += c * (Number(v.precio_unitario) || 0);
        // ingresado = entrada de almacén de esa (factura|catId), repartida entre los vínculos que la comparten.
        const it = itemByKey.get(`${v.accounting_movement_id}|${v.item_idx}`);
        if (it && it.catId) {
          const k = `${v.accounting_movement_id}|${it.catId}`;
          cantIngresada += (entradaMap.get(k) || 0) / (vincPorEntradaKey.get(k) || 1);
        }
      }
      const saldoComprarCant = ins.cantPresup - cantFact;
      const saldoComprarMonto = ins.montoPresup - montoFact;
      const saldoTransito = cantFact - cantIngresada;
      return { ...ins, nVinc: vs.length, cantFact, montoFact, cantIngresada, saldoComprarCant, saldoComprarMonto, saldoTransito };
    }).filter(f => {
      if (tipoFiltro !== 'todos' && f.tipo !== tipoFiltro) return false;
      if (estadoFiltro === 'con_saldo' && f.saldoComprarCant <= 0.001) return false;
      if (estadoFiltro === 'facturados' && f.nVinc === 0) return false;
      if (qn && !(norm(f.nombre).includes(qn) || String(f.codigo).toLowerCase().includes(qn.replace(/ /g, '')))) return false;
      return true;
    }).sort((a, b) => b.montoPresup - a.montoPresup);
  }, [maestra, vincPorCodigo, vinculos, items, entradaMap, q, tipoFiltro, estadoFiltro]);

  const kpis = uM(() => {
    let presup = 0, fact = 0, conSaldo = 0, conciliados = 0;
    for (const f of filas) {
      presup += f.montoPresup; fact += f.montoFact;
      if (f.saldoComprarCant > 0.001) conSaldo++;
      if (f.nVinc > 0) conciliados++;
    }
    return { presup, fact, porComprar: presup - fact, conSaldo, conciliados, total: filas.length };
  }, [filas]);

  // Ítems de factura ya vinculados (para no re-ofrecerlos como libres): set de `${facturaId}|${itemIdx}`.
  const itemsVinculados = uM(() => {
    const s = new Set();
    for (const v of vinculos) s.add(`${v.accounting_movement_id}|${v.item_idx}`);
    return s;
  }, [vinculos]);

  const vincularItem = async (ins, it) => {
    if (busy) return;
    setBusy(true);
    try {
      // Guard anti-duplicado (otra pestaña / estado viejo): no vincular el MISMO ítem
      // al MISMO insumo dos veces (descuadraría facturado). 1 ítem → N insumos sí se permite.
      const dup = await window.__db.conciliacion_vinculos
        .where('accounting_movement_id').equals(it.facturaId)
        .filter(r => r.item_idx === it.itemIdx && r.insumo_codigo === ins.codigo && !r.deleted_at).first();
      if (dup) { toast('Ese ítem ya está vinculado a este insumo', 'amber'); setBusy(false); return; }
      const id = window.__newId();
      const isPrueba = getCurrentMode() === 'prueba';
      const now = new Date().toISOString();
      await window.__db.conciliacion_vinculos.add({
        id, obra_id: obraId,
        insumo_codigo: ins.codigo, insumo_nombre: ins.nombre,
        accounting_movement_id: it.facturaId, item_idx: it.itemIdx,
        item_descripcion: it.descripcion,
        cantidad: it.cantidad, precio_unitario: it.precio,
        created_by: userId, updated_by: userId, created_at: now, updated_at: now,
        version: 1, deleted_at: null,
        idempotency_key: `concil_${id}`,
        sync_status: isPrueba ? 'synced' : 'pending_create',
        ...(isPrueba ? { demo: true } : {}),
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'conciliacion_vinculos' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      toast('Vínculo creado', 'green');
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  const desvincular = async (v) => {
    if (busy) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      if (v.sync_status === 'pending_create') {
        await window.__db.conciliacion_vinculos.delete(v.id); // nunca llegó al server
      } else {
        await window.__db.conciliacion_vinculos.update(v.id, { deleted_at: now, updated_at: now, updated_by: userId, version: (v.version || 0) + 1, sync_status: 'pending_update' });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'conciliacion_vinculos' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      toast('Vínculo quitado', 'amber');
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  // Clasificar el destino de un ítem de factura (obra/empresa) → escribe notas.items_factura[idx].destino.
  const setDestinoItem = async (it, destino) => {
    if (busy) return;
    setBusy(true);
    try {
      const mv = await window.__db.accounting_movements.get(it.facturaId);
      if (!mv) { toast('Factura no encontrada', 'red'); setBusy(false); return; }
      let notas; try { notas = typeof mv.notas === 'string' ? JSON.parse(mv.notas) : (mv.notas || {}); } catch { notas = {}; }
      const arr = Array.isArray(notas.items_factura) ? notas.items_factura.slice() : [];
      if (!arr[it.itemIdx]) { toast('Ítem no encontrado en la factura', 'red'); setBusy(false); return; }
      arr[it.itemIdx] = { ...arr[it.itemIdx], destino };
      notas.items_factura = arr;
      const now = new Date().toISOString();
      await window.__db.accounting_movements.update(it.facturaId, {
        notas: JSON.stringify(notas), updated_at: now, updated_by: userId,
        version: (mv.version || 0) + 1,
        sync_status: mv.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      // Si pasa a 'empresa', quitar sus vínculos al presupuesto — si no, el costo de un
      // ítem de empresa seguiría sumando al Facturado del insumo presupuestado (vínculo huérfano).
      if (destino === 'empresa') {
        const vs = await window.__db.conciliacion_vinculos
          .where('accounting_movement_id').equals(it.facturaId)
          .filter(v => v.item_idx === it.itemIdx && !v.deleted_at).toArray();
        for (const v of vs) {
          if (v.sync_status === 'pending_create') await window.__db.conciliacion_vinculos.delete(v.id);
          else await window.__db.conciliacion_vinculos.update(v.id, { deleted_at: now, updated_at: now, updated_by: userId, version: (v.version || 0) + 1, sync_status: 'pending_update' });
        }
        if (vs.length) { try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'conciliacion_vinculos' } })); } catch {} }
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  // Vínculos agrupados por ítem (factura|itemIdx) — para la pestaña por-ítem.
  const vincPorItem = uM(() => {
    const m = new Map();
    for (const v of vinculos) {
      const k = `${v.accounting_movement_id}|${v.item_idx}`;
      const a = m.get(k) || []; a.push(v); m.set(k, a);
    }
    return m;
  }, [vinculos]);

  // Ítems comprados filtrados (pestaña "Insumos Comprados").
  const itemsComprados = uM(() => {
    const qn = norm(qItems);
    return items
      .filter(it => !qn || norm(it.descripcion).includes(qn) || norm(it.proveedor).includes(qn))
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }, [items, qItems]);

  if (!obraId) {
    return <div className="page-wrap"><div className="card card-p empty-state"><JxIcon name="compare" size={32} color="var(--tm)" /><p>Seleccioná una obra activa para conciliar sus insumos.</p></div></div>;
  }

  const TIPOS = ['material', 'herramienta', 'epp', 'todos'];

  return (
    <div className="page-wrap">
      <div className="pg-hd">
        <div className="pg-title">Conciliación de Insumos</div>
        <div className="pg-sub">Cruce Presupuesto (Delfín) ↔ Facturas ↔ Almacén · enlazá cada ítem de factura con su insumo presupuestado</div>
      </div>

      {/* Pestañas */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, borderBottom: '1px solid var(--bd)' }}>
        {[{ k: 'presupuesto', lbl: 'Por Presupuesto', icon: 'list' }, { k: 'comprados', lbl: 'Insumos Comprados', icon: 'package' }].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            style={{ background: 'none', border: 'none', borderBottom: tab === t.k ? '2px solid var(--amber)' : '2px solid transparent', color: tab === t.k ? 'var(--tp)' : 'var(--tm)', fontWeight: tab === t.k ? 700 : 500, padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5 }}>
            <JxIcon name={t.icon} size={14} />{t.lbl}
          </button>
        ))}
      </div>

      {tab === 'presupuesto' && (<>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 12, marginBottom: 16 }}>
        <div className="kpi-card"><div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Presupuestado</div><div className="kpi-val" style={{ fontSize: 19 }}>{loading ? '…' : fmtS(kpis.presup)}</div></div>
        <div className="kpi-card"><div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Facturado (vinculado)</div><div className="kpi-val" style={{ fontSize: 19, color: 'var(--green)' }}>{loading ? '…' : fmtS(kpis.fact)}</div></div>
        <div className="kpi-card"><div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Saldo por comprar</div><div className="kpi-val" style={{ fontSize: 19, color: kpis.porComprar > 0 ? 'var(--amber)' : 'var(--green)' }}>{loading ? '…' : fmtS(kpis.porComprar)}</div></div>
        <div className="kpi-card"><div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Insumos conciliados</div><div className="kpi-val" style={{ fontSize: 19 }}>{loading ? '…' : `${kpis.conciliados}/${kpis.total}`}</div></div>
      </div>

      {/* Filtros */}
      <div className="card card-p" style={{ marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="search-bar" style={{ flex: '1 1 220px' }}><JxIcon name="search" size={14} color="var(--tm)" /><input placeholder="Buscar insumo presupuestado (nombre o código)…" value={q} onChange={e => setQ(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 4 }}>
          {TIPOS.map(t => <button key={t} className={`btn btn-sm ${tipoFiltro === t ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTipoFiltro(t)}>{t === 'todos' ? 'Todos' : (TIPO_LABEL[t] || t) + 's'}</button>)}
        </div>
        <select className="fi" value={estadoFiltro} onChange={e => setEstadoFiltro(e.target.value)} style={{ minWidth: 150 }}>
          <option value="todos">Todos</option>
          <option value="con_saldo">Con saldo por comprar</option>
          <option value="facturados">Ya con facturas</option>
        </select>
      </div>

      {/* Tabla maestra */}
      {loading ? (
        <div className="card card-p empty-state"><JxIcon name="compare" size={32} color="var(--tm)" /><p>Cargando presupuesto y facturas…</p></div>
      ) : filas.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="package" size={40} color="var(--tm)" /><p>{maestra.length === 0 ? 'Esta obra no tiene presupuesto importado (Delfín). Importalo primero desde "Importar".' : 'No hay insumos con estos filtros.'}</p></div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Insumo presupuestado</th>
                <th style={{ width: 90 }}>Tipo</th>
                <th style={{ textAlign: 'right', width: 110 }}>Presupuestado</th>
                <th style={{ textAlign: 'right', width: 110 }}>Facturado</th>
                <th style={{ textAlign: 'right', width: 100 }}>Almacén</th>
                <th style={{ textAlign: 'right', width: 110 }}>Por comprar</th>
                <th style={{ textAlign: 'right', width: 100 }}>En tránsito</th>
                <th style={{ textAlign: 'center', width: 110 }}>Vínculos</th>
              </tr></thead>
              <tbody>
                {filas.slice(0, 400).map(f => (
                  <tr key={f.codigo}>
                    <td className="col-p">{f.nombre}<div style={{ fontSize: 10, color: 'var(--tm)' }}>{f.codigo.startsWith('sc:') ? 'sin código' : f.codigo}</div></td>
                    <td><span className={`badge ${TIPO_BADGE[f.tipo] || 'b-gray'}`} style={{ fontSize: 10 }}>{TIPO_LABEL[f.tipo] || f.tipo}</span></td>
                    <td style={{ textAlign: 'right' }}><div style={{ fontWeight: 600 }}>{fmtN(f.cantPresup)} {f.unidad}</div><div style={{ fontSize: 10, color: 'var(--tm)' }}>{fmtS(f.montoPresup)}</div></td>
                    <td style={{ textAlign: 'right', color: f.cantFact > 0 ? 'var(--green)' : 'var(--tm)' }}><div style={{ fontWeight: 600 }}>{fmtN(f.cantFact)}</div><div style={{ fontSize: 10 }}>{fmtS(f.montoFact)}</div></td>
                    <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--blue)' }}>{fmtN(f.cantIngresada)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: f.saldoComprarCant > 0.001 ? 'var(--amber)' : 'var(--green)' }}>{fmtN(f.saldoComprarCant)}<div style={{ fontSize: 10, fontWeight: 400 }}>{fmtS(f.saldoComprarMonto)}</div></td>
                    <td style={{ textAlign: 'right', fontSize: 12, color: f.saldoTransito > 0.001 ? 'var(--orange)' : 'var(--tm)' }} title="Facturado pero aún no ingresado al almacén">{fmtN(f.saldoTransito)}</td>
                    <td style={{ textAlign: 'center' }}>
                      <button className="btn btn-ghost btn-xs" onClick={() => setLinkInsumo(f)}>
                        <JxIcon name="link" size={11} />{f.nVinc > 0 ? `${f.nVinc} ✎` : 'Vincular'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filas.length > 400 && <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--tm)', borderTop: '1px solid var(--bd)' }}>Mostrando 400 de {fmtN(filas.length)} — refiná los filtros.</div>}
        </div>
      )}
      </>)}

      {tab === 'comprados' && (<>
        <div className="card card-p" style={{ marginBottom: 12 }}>
          <div className="search-bar"><JxIcon name="search" size={14} color="var(--tm)" /><input placeholder="Buscar ítem comprado / proveedor…" value={qItems} onChange={e => setQItems(e.target.value)} /></div>
          <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 6 }}>Clasificá cada ítem comprado: 🏗 Obra (entra al presupuesto/almacén de la obra) o 🏢 Empresa (consumo general/oficina). Vinculá los de obra a su insumo presupuestado.</div>
        </div>
        {loading ? (
          <div className="card card-p empty-state"><JxIcon name="package" size={32} color="var(--tm)" /><p>Cargando ítems comprados…</p></div>
        ) : itemsComprados.length === 0 ? (
          <div className="card card-p empty-state"><JxIcon name="package" size={40} color="var(--tm)" /><p>No hay ítems comprados (de Captura Mágica) para esta obra.</p></div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th>Ítem comprado</th>
                  <th style={{ width: 150 }}>Factura</th>
                  <th style={{ textAlign: 'right', width: 90 }}>Cantidad</th>
                  <th style={{ textAlign: 'right', width: 100 }}>Monto</th>
                  <th style={{ width: 150 }}>Destino</th>
                  <th style={{ width: 170 }}>Presupuesto</th>
                </tr></thead>
                <tbody>
                  {itemsComprados.slice(0, 500).map(it => {
                    const vs = vincPorItem.get(`${it.facturaId}|${it.itemIdx}`) || [];
                    const esEmpresa = it.destino === 'empresa';
                    return (
                      <tr key={`${it.facturaId}|${it.itemIdx}`} style={esEmpresa ? { opacity: 0.7 } : null}>
                        <td className="col-p">{it.descripcion}<div style={{ fontSize: 10, color: 'var(--tm)' }}>{it.proveedor}</div></td>
                        <td style={{ fontSize: 11, color: 'var(--tm)' }}>{it.doc || '—'}<div style={{ fontSize: 10 }}>{it.fecha}</div></td>
                        <td style={{ textAlign: 'right', fontSize: 12 }}>{fmtN(it.cantidad)} {it.unidad}</td>
                        <td style={{ textAlign: 'right', fontSize: 12 }}>{fmtS(it.cantidad * it.precio)}</td>
                        <td>
                          <select className="fi" style={{ fontSize: 11, padding: '4px 6px' }} value={it.destino || 'obra'} disabled={busy}
                            onChange={e => setDestinoItem(it, e.target.value)}>
                            <option value="obra">🏗 Obra</option>
                            <option value="empresa">🏢 Empresa (general)</option>
                          </select>
                        </td>
                        <td>
                          {esEmpresa ? (
                            <span style={{ fontSize: 11, color: 'var(--tm)' }}>— (consumo empresa)</span>
                          ) : vs.length > 0 ? (
                            <button className="btn btn-ghost btn-xs" title={vs.map(v => v.insumo_nombre).join(', ')} onClick={() => setPickItem(it)}>
                              <JxIcon name="check" size={10} color="var(--green)" /> {(vs.length === 1 ? (vs[0].insumo_nombre || 'vinculado') : `${vs.length} insumos`).slice(0, 18)} ✎
                            </button>
                          ) : (
                            <button className="btn btn-amber btn-xs" disabled={busy} onClick={() => setPickItem(it)}>
                              <JxIcon name="link" size={10} /> Vincular
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {itemsComprados.length > 500 && <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--tm)', borderTop: '1px solid var(--bd)' }}>Mostrando 500 de {fmtN(itemsComprados.length)} — refiná la búsqueda.</div>}
          </div>
        )}
      </>)}

      {pickItem && (
        <PickInsumoModal
          item={pickItem}
          maestra={maestra}
          obraId={obraId}
          vinculos={(vincPorItem.get(`${pickItem.facturaId}|${pickItem.itemIdx}`) || [])}
          busy={busy}
          toast={toast}
          onVincular={(ins) => vincularItem(ins, pickItem)}
          onDesvincular={desvincular}
          onClose={() => setPickItem(null)}
        />
      )}

      {linkInsumo && (
        <VincularModal
          insumo={linkInsumo}
          items={items}
          vinculos={(vincPorCodigo.get(linkInsumo.codigo) || [])}
          itemsVinculados={itemsVinculados}
          busy={busy}
          onVincular={(it) => vincularItem(linkInsumo, it)}
          onDesvincular={desvincular}
          onClose={() => setLinkInsumo(null)}
        />
      )}
    </div>
  );
}

// ── Modal de vinculación: ítems de factura ordenados por similitud al insumo ──
function VincularModal({ insumo, items, vinculos, itemsVinculados, busy, onVincular, onDesvincular, onClose }) {
  const [buscar, setBuscar] = uS('');
  // Ítems ya vinculados A ESTE insumo (se excluyen). Un ítem vinculado a OTRO insumo SÍ se
  // puede ofrecer (1 ítem → N insumos = N-M), con una marca "↔ otro" para avisar.
  const yaAqui = uM(() => new Set((vinculos || []).map(v => `${v.accounting_movement_id}|${v.item_idx}`)), [vinculos]);
  const candidatos = uM(() => {
    const qn = norm(buscar);
    return items
      .filter(it => it.destino !== 'empresa')   // los de consumo de empresa no van al presupuesto de obra
      .filter(it => !yaAqui.has(`${it.facturaId}|${it.itemIdx}`))
      .map(it => ({ it, score: fuzzyScore(insumo.nombre, it.descripcion), enOtro: itemsVinculados.has(`${it.facturaId}|${it.itemIdx}`) }))
      .filter(({ it }) => !qn || norm(it.descripcion).includes(qn) || norm(it.proveedor).includes(qn))
      .sort((a, b) => b.score - a.score)
      .slice(0, 60);
  }, [items, yaAqui, itemsVinculados, insumo, buscar]);

  return (
    <Modal title={`Vincular: ${insumo.nombre}`} icon="link" onClose={onClose} wide>
      <div style={{ fontSize: 12, color: 'var(--tm)', marginBottom: 10 }}>
        Presupuestado: <strong style={{ color: 'var(--ts)' }}>{fmtN(insumo.cantPresup)} {insumo.unidad}</strong> · {fmtS(insumo.montoPresup)} · código {insumo.codigo.startsWith('sc:') ? '—' : insumo.codigo}
      </div>

      {/* Vínculos actuales */}
      {vinculos.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ts)', marginBottom: 6 }}>Facturas vinculadas ({vinculos.length})</div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl"><tbody>
              {vinculos.map(v => (
                <tr key={v.id}>
                  <td className="col-p" style={{ fontSize: 12 }}>{v.item_descripcion}</td>
                  <td style={{ textAlign: 'right', fontSize: 12 }}>{fmtN(v.cantidad)} × {fmtS(v.precio_unitario)}</td>
                  <td style={{ textAlign: 'right', width: 90 }}>{fmtS((Number(v.cantidad) || 0) * (Number(v.precio_unitario) || 0))}</td>
                  <td style={{ textAlign: 'center', width: 40 }}><button className="btn btn-ghost btn-xs" disabled={busy} title="Quitar vínculo" onClick={() => onDesvincular(v)}><JxIcon name="x" size={11} /></button></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        </div>
      )}

      {/* Buscar y vincular ítems de factura */}
      <div className="search-bar" style={{ marginBottom: 8 }}><JxIcon name="search" size={14} color="var(--tm)" /><input placeholder="Buscar ítem de factura / proveedor…" value={buscar} onChange={e => setBuscar(e.target.value)} /></div>
      <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--bd)', borderRadius: 6 }}>
        <table className="tbl">
          <thead><tr><th>Ítem de factura</th><th style={{ width: 80 }}>Cant.</th><th style={{ width: 90 }}>P. unit.</th><th style={{ width: 70 }}>Match</th><th style={{ width: 70 }}></th></tr></thead>
          <tbody>
            {candidatos.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--tm)', fontStyle: 'italic', padding: 10 }}>No hay ítems de factura libres para esta obra.</td></tr>}
            {candidatos.map(({ it, score, enOtro }) => {
              const sug = score >= 0.5;
              return (
                <tr key={`${it.facturaId}|${it.itemIdx}`} style={sug ? { background: 'rgba(46,204,113,0.06)' } : null}>
                  <td className="col-p" style={{ fontSize: 12 }}>{it.descripcion}{enOtro && <span className="badge b-gray" style={{ marginLeft: 6, fontSize: 9 }} title="Este ítem ya está vinculado a otro insumo (podés vincularlo también a éste)">↔ otro</span>}<div style={{ fontSize: 10, color: 'var(--tm)' }}>{it.doc} · {it.proveedor} · {it.fecha}</div></td>
                  <td style={{ textAlign: 'right', fontSize: 12 }}>{fmtN(it.cantidad)} {it.unidad}</td>
                  <td style={{ textAlign: 'right', fontSize: 12 }}>{fmtS(it.precio)}</td>
                  <td style={{ textAlign: 'center' }}>{score > 0 ? <span className={`badge ${sug ? 'b-green' : 'b-gray'}`} style={{ fontSize: 9 }}>{Math.round(score * 100)}%</span> : <span style={{ color: 'var(--tm)', fontSize: 11 }}>—</span>}</td>
                  <td style={{ textAlign: 'center' }}><button className="btn btn-amber btn-xs" disabled={busy} onClick={() => onVincular(it)}>Vincular</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 8 }}>Verde = sugerencia automática por similitud de nombre (≥50%). Podés vincular varios ítems al mismo insumo.</div>
      <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}

// ── Modal item→presupuesto: elegir el insumo presupuestado para un ítem comprado ──
function PickInsumoModal({ item, maestra, obraId, vinculos, busy, toast, onVincular, onDesvincular, onClose }) {
  const [buscar, setBuscar] = uS('');
  const [aiSug, setAiSug] = uS(null);   // { coincidencias:[{codigo,confianza,razon}], razonamiento, _cached }
  const [aiLoading, setAiLoading] = uS(false);
  const maestraByCodigo = uM(() => { const m = new Map(); maestra.forEach(i => m.set(i.codigo, i)); return m; }, [maestra]);
  const yaVinc = uM(() => new Set((vinculos || []).map(v => v.insumo_codigo)), [vinculos]);

  // Asistente IA: matching semántico del ítem comprado contra los insumos del presupuesto
  // de ESTA obra. Pre-filtramos por similitud a los 50 más cercanos para no mandar todo.
  const sugerirIA = async () => {
    setAiLoading(true); setAiSug(null);
    try {
      const pre = maestra
        .map(ins => ({ ins, s: fuzzyScore(item.descripcion, ins.nombre) }))
        .sort((a, b) => b.s - a.s).slice(0, 50).map(x => x.ins);
      const sug = await sugerirInsumoMatch({
        itemName: item.descripcion, obraId,
        third_party_name: item.proveedor || '',
        insumos: pre.map(i => ({ codigo: i.codigo, nombre: i.nombre, unidad: i.unidad })),
      });
      setAiSug(sug);
      if (!(sug?.result?.coincidencias || []).length) toast?.('La IA no encontró un insumo presupuestado que corresponda', 'amber');
    } catch (e) { toast?.('Error de la IA: ' + (e.message || e), 'red'); }
    finally { setAiLoading(false); }
  };
  const candidatos = uM(() => {
    const qn = norm(buscar);
    return maestra
      .filter(ins => !yaVinc.has(ins.codigo))
      .map(ins => ({ ins, score: fuzzyScore(item.descripcion, ins.nombre) }))
      .filter(({ ins }) => !qn || norm(ins.nombre).includes(qn) || String(ins.codigo).toLowerCase().includes(qn.replace(/ /g, '')))
      .sort((a, b) => b.score - a.score)
      .slice(0, 60);
  }, [maestra, yaVinc, item, buscar]);
  return (
    <Modal title={`Vincular a presupuesto: ${item.descripcion}`} icon="link" onClose={onClose} wide>
      <div style={{ fontSize: 12, color: 'var(--tm)', marginBottom: 10 }}>
        Comprado: <strong style={{ color: 'var(--ts)' }}>{fmtN(item.cantidad)} {item.unidad}</strong> × {fmtS(item.precio)} · {item.doc} · {item.proveedor}
      </div>
      {vinculos.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ts)', marginBottom: 6 }}>Insumos presupuestados vinculados ({vinculos.length})</div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl"><tbody>
              {vinculos.map(v => (
                <tr key={v.id}>
                  <td className="col-p" style={{ fontSize: 12 }}>{v.insumo_nombre}<div style={{ fontSize: 10, color: 'var(--tm)' }}>{v.insumo_codigo}</div></td>
                  <td style={{ textAlign: 'center', width: 40 }}><button className="btn btn-ghost btn-xs" disabled={busy} title="Quitar vínculo" onClick={() => onDesvincular(v)}><JxIcon name="x" size={11} /></button></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        </div>
      )}
      {/* Asistente IA: matching semántico contra el presupuesto de la obra */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <div className="search-bar" style={{ flex: 1 }}><JxIcon name="search" size={14} color="var(--tm)" /><input placeholder="Buscar insumo presupuestado…" value={buscar} onChange={e => setBuscar(e.target.value)} /></div>
        <button className="btn btn-amber btn-sm" disabled={aiLoading || busy} onClick={sugerirIA} title="Que la IA busque el insumo presupuestado que corresponde a este ítem">
          {aiLoading ? '⏳ Analizando…' : '✨ Sugerir con IA'}
        </button>
      </div>
      {aiSug && (aiSug.result?.coincidencias || []).length > 0 && (
        <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 6, background: 'rgba(46,204,113,0.07)', border: '1px solid rgba(46,204,113,0.3)' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--green)', marginBottom: 6 }}>✨ Sugerencias de la IA{aiSug._cached ? ' (cacheada)' : ''} — revisá y aprobá:</div>
          {(aiSug.result.coincidencias).map((c, i) => {
            const ins = maestraByCodigo.get(c.codigo);
            if (!ins) return null;
            const yaTiene = yaVinc.has(c.codigo);
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: i ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                <span className="badge b-green" style={{ fontSize: 9 }}>{Math.round((c.confianza || 0) * 100)}%</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--ts)' }}>{ins.nombre} <span style={{ fontSize: 10, color: 'var(--tm)' }}>· {fmtN(ins.cantPresup)} {ins.unidad}</span></div>
                  {c.razon && <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>{c.razon}</div>}
                </div>
                {yaTiene
                  ? <span className="badge b-gray" style={{ fontSize: 9 }}>ya vinculado</span>
                  : <button className="btn btn-amber btn-xs" disabled={busy} onClick={() => onVincular(ins)}>Aprobar</button>}
              </div>
            );
          })}
        </div>
      )}
      {aiSug && (aiSug.result?.coincidencias || []).length === 0 && !aiLoading && (
        <div style={{ marginBottom: 10, fontSize: 11, color: 'var(--tm)' }}>La IA no encontró coincidencia clara — buscá manualmente abajo.</div>
      )}
      <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--bd)', borderRadius: 6 }}>
        <table className="tbl">
          <thead><tr><th>Insumo presupuestado</th><th style={{ textAlign: 'right', width: 90 }}>Presup.</th><th style={{ width: 70 }}>Match</th><th style={{ width: 70 }}></th></tr></thead>
          <tbody>
            {candidatos.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--tm)', fontStyle: 'italic', padding: 10 }}>Sin insumos presupuestados disponibles (¿importaste el presupuesto Delfín?).</td></tr>}
            {candidatos.map(({ ins, score }) => {
              const sug = score >= 0.5;
              return (
                <tr key={ins.codigo} style={sug ? { background: 'rgba(46,204,113,0.06)' } : null}>
                  <td className="col-p" style={{ fontSize: 12 }}>{ins.nombre}<div style={{ fontSize: 10, color: 'var(--tm)' }}>{ins.codigo.startsWith('sc:') ? 'sin código' : ins.codigo}</div></td>
                  <td style={{ textAlign: 'right', fontSize: 11 }}>{fmtN(ins.cantPresup)} {ins.unidad}</td>
                  <td style={{ textAlign: 'center' }}>{score > 0 ? <span className={`badge ${sug ? 'b-green' : 'b-gray'}`} style={{ fontSize: 9 }}>{Math.round(score * 100)}%</span> : <span style={{ color: 'var(--tm)', fontSize: 11 }}>—</span>}</td>
                  <td style={{ textAlign: 'center' }}><button className="btn btn-amber btn-xs" disabled={busy} onClick={() => onVincular(ins)}>Vincular</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 8 }}>Verde = sugerencia automática por similitud (≥50%). Un ítem puede vincularse a varios insumos del presupuesto.</div>
      <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}

Object.assign(window, { ConciliacionInsumosPage });
