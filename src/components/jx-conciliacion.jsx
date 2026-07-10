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
import { getCurrentMode } from "../lib/app-mode-core.js";
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

// Destino del ítem comprado (3 valores). 'obra_general' = gasto general DE LA
// OBRA (comida del personal, etc.): costo de la obra pero fuera del presupuesto
// de partidas → no vinculable, igual que 'empresa'.
const DESTINO_LABEL = { obra: '🏗 Obra', obra_general: '🍽 Obra — gasto general', empresa: '🏢 Empresa (general)' };

// Categorías del clasificador de ítems (badge + color).
const CAT_ITEM = {
  materiales:         { lbl: 'Materiales',       cls: 'b-blue' },
  herramientas:       { lbl: 'Herramientas',     cls: 'b-amber' },
  maquinaria:         { lbl: 'Maquinaria',       cls: 'b-purple' },
  epp:                { lbl: 'EPP',              cls: 'b-green' },
  insumos_emergencia: { lbl: 'Emergencia',       cls: 'b-red' },
  gastos_generales:   { lbl: 'G. generales',     cls: 'b-gray' },
  otros:              { lbl: 'Otros',            cls: 'b-gray' },
};

function ConciliacionInsumosPage({ showToast }) {
  const toast = showToast || window.__showToast || (() => {});
  const { obraId } = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const { data: companies } = window.__hooks?.useCompanies?.() || { data: [] };
  const companyNombre = (id) => (companies || []).find(c => c.id === id)?.name || null;
  const profile = (window.__useAuth?.()?.profile) || null;
  const userId = profile?.id || 'offline';
  // La pestaña "Por Presupuesto" (cruce con el presupuesto Delfín) es solo para la
  // Contadora Jefe (y supervisores). El Ayudante de Contabilidad ve únicamente
  // "Insumos Comprados" (clasificar/vincular ítems de factura), no el presupuesto.
  const rol = profile?.rol || '';
  const puedePresupuesto = ['admin', 'gerente', 'contador'].includes(rol);
  // El Ayudante de Contabilidad NO reclasifica el destino acá (ya se decidió en
  // Captura Mágica): para él es solo lectura y, si cree que está mal, pide el
  // cambio con "Solicitar cambio de vinculación" (lo aplica la jefe/admin).
  const esAyudante = rol === 'ayudante_contador';

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
  const [tab, setTab] = uS(puedePresupuesto ? 'presupuesto' : 'comprados'); // 'presupuesto' (por insumo) | 'comprados' (por ítem de factura)
  const [qItems, setQItems] = uS('');       // búsqueda en la pestaña Insumos Comprados
  const [pickItem, setPickItem] = uS(null); // ítem de factura que se está vinculando a un insumo
  const [solicitarTarget, setSolicitarTarget] = uS(null); // ítem para "Solicitar cambio de vinculación" (ayudante)
  const [filtroVinc, setFiltroVinc] = uS('todos'); // 'todos' | 'sin' | 'con' (separa vinculados de no vinculados)
  const [fechaDesde, setFechaDesde] = uS(''); // rango de fechas para filtrar/exportar (por fecha del comprobante)
  const [fechaHasta, setFechaHasta] = uS('');
  const [filtroCat, setFiltroCat] = uS('todas'); // 'todas' | categoría | 'sin_clasificar' — entra a itemsBase (afecta export)

  // Si el rol carga tarde (o cambia) y un no-autorizado quedó en "Por Presupuesto",
  // lo devolvemos a "Insumos Comprados".
  uE(() => { if (!puedePresupuesto && tab === 'presupuesto') setTab('comprados'); }, [puedePresupuesto, tab]);

  // ── Carga de las 3 fuentes + los vínculos ──
  uE(() => {
    if (!obraId) { setMaestra([]); setItems([]); setVinculos([]); setEntradaMap(new Map()); setLoading(false); return; }
    let cancel = false;
    const cargar = async () => {
      const db = window.__db;
      try {
        // 1) PRESUPUESTO: consolidar insumos_partida por insumo_codigo.
        const ips = await db.insumos_partida.where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray();
        // Avance por partida → para marcar qué insumos pertenecen a una partida EN EJECUCIÓN
        // (señal que el recomendador IA usa para priorizar).
        const partidaAvance = new Map();
        try { (await db.partidas.where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray()).forEach(p => partidaAvance.set(p.id, Number(p.porcentaje_avance) || 0)); } catch {}
        const m = new Map();
        for (const ip of ips) {
          // Sin código Delfín: consolidar por nombre RAW + tipo + unidad (igual que el helper
          // canónico mi-frente.js), para no mezclar insumos distintos (ej. 'Andamio' equipo vs material).
          const codigo = (ip.insumo_codigo && String(ip.insumo_codigo).trim())
            || ('sc:' + (ip.nombre_insumo || '') + '|' + (ip.tipo_insumo || '') + '|' + (ip.unidad || ''));
          const cant = Number(ip.cantidad_presupuestada) || 0;
          const monto = Number(ip.costo_presupuestado) || (cant * (Number(ip.precio_presupuestado) || 0));
          const cur = m.get(codigo) || { codigo, nombre: ip.nombre_insumo || '—', unidad: ip.unidad || '', tipo: ip.tipo_insumo || 'material', cantPresup: 0, montoPresup: 0, nPartidas: 0, enEjecucion: false };
          cur.cantPresup += cant; cur.montoPresup += monto; cur.nPartidas += 1;
          if ((partidaAvance.get(ip.partida_id) || 0) > 0) cur.enEjecucion = true;
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
            companyId: mv.company_id || null,   // empresa COMPRADORA del comprobante
            descripcion: it.descripcion || it.nombre || '—',
            unidad: it.unidad || 'und',
            cantidad: Number(it.cantidad) || 0,
            precio: Number(it.precio_unitario) || 0,
            catId: it.material_id || null,
            doc: `${mv.document_type || ''} ${mv.document_number || ''}`.trim(),
            fecha: mv.date || '', proveedor: mv.third_party_name || '',
            // Clasificación de destino (la pone el contador en "Insumos Comprados"):
            // 'obra' (presupuesto/almacén) | 'obra_general' (gasto general de la
            // obra, ej. comida del personal) | 'empresa' (consumo general/oficina).
            destino: it.destino || 'obra',
            // Clasificación IA/manual (categoría + subcategoría, persistida en el ítem).
            categoria: it.categoria || null,
            subcategoria: it.subcategoria || null,
            clasif_fuente: it.clasif_fuente || null,
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
      // Si deja de ser 'obra' (pasa a 'empresa' u 'obra_general'), quitar sus vínculos
      // al presupuesto — si no, el costo de un ítem fuera del presupuesto seguiría
      // sumando al Facturado del insumo presupuestado (vínculo huérfano).
      if (destino !== 'obra') {
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

  // ── Clasificación IA/manual de ítems (categoría + subcategoría) ──────
  // Escribe notas.items_factura[idx].{categoria,subcategoria,clasif_fuente}.
  // A diferencia del destino, la clasificación la hacen la contadora jefe Y la
  // ayudante (ambas con Movs. Contables 'w' → su push sincroniza).
  const canClasificar = rol === 'admin' || (window.__hasPerm?.(rol, 'Movs. Contables', 'w') ?? false);
  const [clasifBusy, setClasifBusy] = uS(false);
  const [clasifProg, setClasifProg] = uS(null);   // { hechas, total } durante el batch IA
  const [clasifEdit, setClasifEdit] = uS(null);   // { key, categoria, subcategoria } editor inline
  const [subcatsSugeridas, setSubcatsSugeridas] = uS([]);

  // Aplica clasificaciones en LOTE: un solo get+update por factura (varios ítems
  // comparten la misma fila accounting_movements — read-modify-write por ítem en
  // paralelo se pisaría entre hermanos y bumpearía version N veces).
  const aplicarClasifLote = async (porFactura) => {
    const now = new Date().toISOString();
    for (const [facturaId, cambios] of porFactura) {
      const mv = await window.__db.accounting_movements.get(facturaId);
      if (!mv) continue;
      let notas; try { notas = typeof mv.notas === 'string' ? JSON.parse(mv.notas) : (mv.notas || {}); } catch { notas = {}; }
      const arr = Array.isArray(notas.items_factura) ? notas.items_factura.slice() : [];
      let tocado = false;
      for (const c of cambios) {
        if (!arr[c.itemIdx]) continue;
        // La IA nunca pisa una clasificación ya presente en la lectura FRESCA:
        // si la contadora corrigió a mano (u otro batch clasificó) mientras este
        // batch corría, ese ítem se salta. Lo manual siempre aplica.
        if (c.fuente === 'ia' && (arr[c.itemIdx].clasif_fuente === 'manual' || arr[c.itemIdx].categoria)) continue;
        arr[c.itemIdx] = { ...arr[c.itemIdx], categoria: c.categoria, subcategoria: c.subcategoria || null, clasif_fuente: c.fuente };
        tocado = true;
      }
      if (!tocado) continue;
      notas.items_factura = arr;
      await window.__db.accounting_movements.update(facturaId, {
        notas: JSON.stringify(notas), updated_at: now, updated_by: userId,
        version: (mv.version || 0) + 1,
        sync_status: mv.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
    }
    try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } })); } catch {}
    try { window.dispatchEvent(new Event('online')); } catch {}
  };

  // Botón "Clasificar con IA": clasifica los ítems SIN categoría del filtro actual.
  // Catálogo-first (lo ya aprendido no consulta la IA) → solo lo desconocido va
  // al batch; el resultado se aprende como fuente 'ia'.
  const clasificarConIA = async () => {
    if (clasifBusy) return;
    const sinClasif = itemsBase.filter(it => !it.categoria);
    if (!sinClasif.length) { toast('No hay ítems sin clasificar en el filtro actual', 'amber'); return; }
    setClasifBusy(true);
    setClasifProg({ hechas: 0, total: 0 });
    try {
      const { clasificarDescripciones, normDesc } = await import('../lib/clasificar-items.js');
      const mapa = await clasificarDescripciones(sinClasif.map(it => it.descripcion), {
        userId, onProgress: (hechas, total) => setClasifProg({ hechas, total }),
      });
      const porFactura = new Map();
      let aplicados = 0;
      for (const it of sinClasif) {
        const entry = mapa.get(normDesc(it.descripcion));
        if (!entry) continue;
        const a = porFactura.get(it.facturaId) || [];
        a.push({ itemIdx: it.itemIdx, categoria: entry.categoria, subcategoria: entry.subcategoria, fuente: entry.fuente });
        porFactura.set(it.facturaId, a);
        aplicados++;
      }
      await aplicarClasifLote(porFactura);
      toast(`Clasificados ${aplicados} ítem(s) — corregí los que estén mal para enseñarle a la IA`, 'green');
    } catch (e) { toast('Error clasificando: ' + (e.message || e), 'red'); }
    finally { setClasifBusy(false); setClasifProg(null); }
  };

  // Corrección manual de un ítem: aplica al ítem Y aprende como fuente 'manual'
  // (pisa a la IA para esa descripción, en todos los dispositivos).
  const guardarClasifManual = async (it, categoria, subcategoria) => {
    if (!categoria) { toast('Elegí la categoría', 'red'); return; }
    if (clasifBusy) { toast('Esperá a que termine la clasificación con IA', 'amber'); return; }
    try {
      // La subcategoría se normaliza IGUAL que en el catálogo/IA (trim+minúsculas):
      // sin esto el mismo grupo saldría como "Fierro " y "fierro" en el Excel.
      const { aprenderClasificacion, normSubcat } = await import('../lib/clasificar-items.js');
      const sub = normSubcat(subcategoria);
      await aplicarClasifLote(new Map([[it.facturaId, [{ itemIdx: it.itemIdx, categoria, subcategoria: sub, fuente: 'manual' }]]]));
      await aprenderClasificacion({ descripcion: it.descripcion, categoria, subcategoria: sub, fuente: 'manual', userId });
      setClasifEdit(null);
      toast('Clasificación guardada — la IA la usará para ítems similares', 'green');
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
  };

  const abrirClasifEdit = async (it) => {
    const cat = it.categoria || 'materiales';
    setClasifEdit({ key: `${it.facturaId}|${it.itemIdx}`, categoria: cat, subcategoria: it.subcategoria || '' });
    try {
      const { subcategoriasDe } = await import('../lib/clasificar-items.js');
      setSubcatsSugeridas(await subcategoriasDe(cat));
    } catch { setSubcatsSugeridas([]); }
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

  // ¿El ítem tiene al menos un vínculo a un insumo presupuestado?
  const estaVinculado = (it) => (vincPorItem.get(`${it.facturaId}|${it.itemIdx}`) || []).length > 0;

  // Base: ítems filtrados por BÚSQUEDA + RANGO DE FECHAS (sin el filtro de vínculo).
  // La exportación usa esta base → sale filtrada por fecha, con ambos tipos.
  const itemsBase = uM(() => {
    const qn = norm(qItems);
    return items.filter(it =>
      (!qn || norm(it.descripcion).includes(qn) || norm(it.proveedor).includes(qn)) &&
      (!fechaDesde || (it.fecha || '') >= fechaDesde) &&
      (!fechaHasta || (it.fecha || '') <= fechaHasta) &&
      (filtroCat === 'todas' || (filtroCat === 'sin_clasificar' ? !it.categoria : it.categoria === filtroCat))
    );
  }, [items, qItems, fechaDesde, fechaHasta, filtroCat]);

  // Ítems comprados mostrados en la tabla (base + filtro de vínculo).
  const itemsComprados = uM(() =>
    itemsBase
      .filter(it => filtroVinc === 'todos' || (filtroVinc === 'con' ? estaVinculado(it) : !estaVinculado(it)))
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
  , [itemsBase, filtroVinc, vincPorItem]);

  // Conteos para los chips del filtro (sobre la base ya filtrada por fecha/búsqueda).
  const vincCounts = uM(() => {
    let con = 0; for (const it of itemsBase) if (estaVinculado(it)) con++;
    return { total: itemsBase.length, con, sin: itemsBase.length - con };
  }, [itemsBase, vincPorItem]);

  // Exporta a Excel en 2 hojas ("Sin vincular" y "Vinculados") los ítems del
  // RANGO/búsqueda actual (ambos tipos — el filtro de vínculo es solo de vista).
  const exportarExcel = async () => {
    try {
      const { generateExcelSheets } = await import('../lib/reports.js');
      const sin = [], con = [];
      const destinoTxt = { obra: 'Obra', obra_general: 'Obra — gasto general', empresa: 'Empresa' };
      for (const it of itemsBase) {
        const emp = companyNombre(it.companyId) || '';
        const monto = +(it.cantidad * it.precio).toFixed(2);
        const vs = vincPorItem.get(`${it.facturaId}|${it.itemIdx}`) || [];
        const base = [it.descripcion, emp, it.doc || '', it.fecha || '', it.cantidad, it.unidad, monto,
          it.categoria ? (CAT_ITEM[it.categoria]?.lbl || it.categoria) : '', it.subcategoria || '',
          destinoTxt[it.destino] || 'Obra'];
        if (vs.length > 0) {
          con.push([...base, vs.map(v => v.insumo_nombre || v.insumo_codigo || '').filter(Boolean).join(' + ')]);
        } else {
          sin.push(base);
        }
      }
      if (!sin.length && !con.length) { toast('No hay ítems en el filtro seleccionado para exportar', 'amber'); return; }
      const rango = (fechaDesde || fechaHasta) ? `_${fechaDesde || 'inicio'}_a_${fechaHasta || 'hoy'}` : '';
      const COLS = ['Ítem', 'Empresa', 'Factura', 'Fecha', 'Cantidad', 'Unidad', 'Monto', 'Categoría', 'Subcategoría', 'Destino'];
      await generateExcelSheets({
        filename: `JARVEX_insumos_comprados${rango || '_' + new Date().toISOString().slice(0, 10)}.xlsx`,
        sheets: [
          { name: 'Sin vincular', columnas: COLS, filas: sin },
          { name: 'Vinculados', columnas: [...COLS, 'Insumo vinculado'], filas: con },
        ],
      });
      toast(`Exportado: ${sin.length} sin vincular + ${con.length} vinculados`, 'green');
    } catch (e) { toast('Error al exportar: ' + (e?.message || e), 'red'); }
  };

  if (!obraId) {
    return <div className="page-wrap"><div className="card card-p empty-state"><JxIcon name="compare" size={32} color="var(--tm)" /><p>Seleccioná una obra activa para conciliar sus insumos.</p></div></div>;
  }

  // Tipos reales del presupuesto Delfín (tipo_insumo): Material, Mano de Obra y Equipo.
  // (Antes filtraba por 'herramienta'/'epp', que NO existen como tipo de insumo
  // presupuestado → esos botones nunca mostraban nada.)
  const TIPOS = ['material', 'mano_obra', 'equipo', 'todos'];
  const TIPO_FILTRO_LABEL = { material: 'Materiales', mano_obra: 'Mano de Obra', equipo: 'Equipos', todos: 'Todos' };

  return (
    <div className="page-wrap">
      <div className="pg-hd">
        <div className="pg-title">Conciliación de Insumos</div>
        <div className="pg-sub">Cruce Presupuesto (Delfín) ↔ Facturas ↔ Almacén · enlazá cada ítem de factura con su insumo presupuestado</div>
      </div>

      {/* Pestañas */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, borderBottom: '1px solid var(--bd)' }}>
        {[{ k: 'presupuesto', lbl: 'Por Presupuesto', icon: 'list' }, { k: 'comprados', lbl: 'Insumos Comprados', icon: 'package' }].filter(t => t.k !== 'presupuesto' || puedePresupuesto).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            style={{ background: 'none', border: 'none', borderBottom: tab === t.k ? '2px solid var(--amber)' : '2px solid transparent', color: tab === t.k ? 'var(--tp)' : 'var(--tm)', fontWeight: tab === t.k ? 700 : 500, padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5 }}>
            <JxIcon name={t.icon} size={14} />{t.lbl}
          </button>
        ))}
      </div>

      {tab === 'presupuesto' && puedePresupuesto && (<>
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
          {TIPOS.map(t => <button key={t} className={`btn btn-sm ${tipoFiltro === t ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTipoFiltro(t)}>{TIPO_FILTRO_LABEL[t] || t}</button>)}
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
                <th style={{ textAlign: 'right', width: 100 }}>Costo unit.</th>
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
                    <td style={{ textAlign: 'right', fontSize: 12 }} title="Costo unitario presupuestado (monto ÷ cantidad; promedio ponderado si el insumo está en varias partidas)">{f.cantPresup > 0 ? fmtS(f.montoPresup / f.cantPresup) : '—'}</td>
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="search-bar" style={{ flex: '1 1 200px' }}><JxIcon name="search" size={14} color="var(--tm)" /><input placeholder="Buscar ítem comprado / proveedor…" value={qItems} onChange={e => setQItems(e.target.value)} /></div>
            <div style={{ display: 'flex', gap: 4, background: 'var(--bg-s)', borderRadius: 8, padding: 3 }}>
              {[['todos', `Todos (${vincCounts.total})`], ['sin', `Sin vincular (${vincCounts.sin})`], ['con', `Vinculados (${vincCounts.con})`]].map(([k, lbl]) => (
                <button key={k} className={`btn btn-xs ${filtroVinc === k ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setFiltroVinc(k)} style={{ fontSize: 11 }}>{lbl}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, color: 'var(--tm)' }} title="Filtra y exporta por fecha del comprobante">
              <span>Desde</span>
              <input type="date" className="fi" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} style={{ padding: '4px 6px', fontSize: 11, width: 140 }} />
              <span>Hasta</span>
              <input type="date" className="fi" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} style={{ padding: '4px 6px', fontSize: 11, width: 140 }} />
              {(fechaDesde || fechaHasta) && <button className="btn btn-ghost btn-xs" title="Limpiar rango" onClick={() => { setFechaDesde(''); setFechaHasta(''); }}><JxIcon name="x" size={11} /></button>}
            </div>
            <select className="fi" value={filtroCat} onChange={e => setFiltroCat(e.target.value)} style={{ width: 160, padding: '5px 8px', fontSize: 11 }} title="Filtra (y exporta) por la categoría clasificada">
              <option value="todas">Todas las categorías</option>
              {Object.entries(CAT_ITEM).map(([k, v]) => <option key={k} value={k}>{v.lbl}</option>)}
              <option value="sin_clasificar">— Sin clasificar —</option>
            </select>
            {canClasificar && (
              <button className="btn btn-ghost btn-sm" onClick={clasificarConIA} disabled={clasifBusy || !itemsBase.some(it => !it.categoria)}
                title="Clasifica con IA los ítems sin categoría del filtro actual. Lo ya corregido a mano no se toca; lo nuevo se aprende para la próxima.">
                ✨ {clasifBusy ? (clasifProg?.total ? `Clasificando ${clasifProg.hechas}/${clasifProg.total}…` : 'Clasificando…') : `Clasificar IA (${itemsBase.filter(it => !it.categoria).length})`}
              </button>
            )}
            <button className="btn btn-amber btn-sm" onClick={exportarExcel} disabled={!itemsBase.length} title="Exporta a Excel el filtro actual (búsqueda + fechas + categoría; 2 hojas: sin vincular y vinculados)">
              <JxIcon name="download" size={13} /> Exportar Excel
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 6 }}>Destino: 🏗 Obra (presupuesto/almacén) · 🍽 Obra — gasto general (comida del personal, consumos de obra fuera del presupuesto) · 🏢 Empresa (consumo general/oficina). La exportación respeta búsqueda, fechas y categoría. Corregí las clasificaciones de la IA para que aprenda.</div>
        </div>
        {loading ? (
          <div className="card card-p empty-state"><JxIcon name="package" size={32} color="var(--tm)" /><p>Cargando ítems comprados…</p></div>
        ) : itemsComprados.length === 0 ? (
          <div className="card card-p empty-state"><JxIcon name="package" size={40} color="var(--tm)" /><p>{items.length === 0 ? 'No hay ítems comprados (de Captura Mágica) para esta obra.' : (filtroVinc === 'con' ? 'No hay ítems vinculados con este criterio.' : filtroVinc === 'sin' ? 'No hay ítems sin vincular con este criterio.' : 'Ningún ítem coincide con la búsqueda.')}</p></div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th>Ítem comprado</th>
                  <th style={{ width: 160 }}>Empresa</th>
                  <th style={{ width: 150 }}>Factura</th>
                  <th style={{ textAlign: 'right', width: 90 }}>Cantidad</th>
                  <th style={{ textAlign: 'right', width: 100 }}>Monto</th>
                  <th style={{ width: 150 }}>Clasificación</th>
                  <th style={{ width: 150 }}>Destino</th>
                  <th style={{ width: 170 }}>Presupuesto</th>
                </tr></thead>
                <tbody>
                  {itemsComprados.slice(0, 500).map(it => {
                    const vs = vincPorItem.get(`${it.facturaId}|${it.itemIdx}`) || [];
                    const key = `${it.facturaId}|${it.itemIdx}`;
                    // 'empresa' y 'obra_general' quedan FUERA del presupuesto de partidas
                    // (no vinculables); solo 'obra' entra al presupuesto/almacén.
                    const sinPresupuesto = it.destino === 'empresa' || it.destino === 'obra_general';
                    const enEdicion = clasifEdit?.key === key;
                    return (
                      <tr key={key} style={sinPresupuesto ? { opacity: 0.75 } : null}>
                        <td className="col-p">{it.descripcion}<div style={{ fontSize: 10, color: 'var(--tm)' }}>{it.proveedor}</div></td>
                        <td style={{ fontSize: 11.5, color: 'var(--ts)' }}>{companyNombre(it.companyId) || <span style={{ color: 'var(--tm)' }}>—</span>}</td>
                        <td style={{ fontSize: 11, color: 'var(--tm)' }}>{it.doc || '—'}<div style={{ fontSize: 10 }}>{it.fecha}</div></td>
                        <td style={{ textAlign: 'right', fontSize: 12 }}>{fmtN(it.cantidad)} {it.unidad}</td>
                        <td style={{ textAlign: 'right', fontSize: 12 }}>{fmtS(it.cantidad * it.precio)}</td>
                        <td>
                          {enEdicion ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <select className="fi" style={{ fontSize: 11, padding: '3px 6px' }} value={clasifEdit.categoria}
                                onChange={async e => {
                                  const cat = e.target.value;
                                  setClasifEdit(prev => ({ ...prev, categoria: cat }));
                                  try { const { subcategoriasDe } = await import('../lib/clasificar-items.js'); setSubcatsSugeridas(await subcategoriasDe(cat)); } catch {}
                                }}>
                                {Object.entries(CAT_ITEM).map(([k, v]) => <option key={k} value={k}>{v.lbl}</option>)}
                              </select>
                              <input className="fi" style={{ fontSize: 11, padding: '3px 6px' }} placeholder="Subcategoría (ej. fierro)" list="clasif-subcats"
                                value={clasifEdit.subcategoria} onChange={e => setClasifEdit(prev => ({ ...prev, subcategoria: e.target.value }))} />
                              <datalist id="clasif-subcats">{subcatsSugeridas.map(s => <option key={s} value={s} />)}</datalist>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn btn-amber btn-xs" style={{ fontSize: 10 }} onClick={() => guardarClasifManual(it, clasifEdit.categoria, clasifEdit.subcategoria)}>✓ Guardar</button>
                                <button className="btn btn-ghost btn-xs" style={{ fontSize: 10 }} onClick={() => setClasifEdit(null)}>✕</button>
                              </div>
                            </div>
                          ) : it.categoria ? (
                            <div style={{ cursor: canClasificar ? 'pointer' : 'default' }} onClick={canClasificar ? () => abrirClasifEdit(it) : undefined}
                                 title={canClasificar ? `Clasificado por ${it.clasif_fuente === 'manual' ? 'corrección manual' : 'IA'} — click para corregir (le enseña a la IA)` : undefined}>
                              <span className={`badge ${CAT_ITEM[it.categoria]?.cls || 'b-gray'}`} style={{ fontSize: 10 }}>{CAT_ITEM[it.categoria]?.lbl || it.categoria}{it.clasif_fuente === 'ia' ? ' ✨' : ''}</span>
                              {it.subcategoria && <div style={{ fontSize: 10, color: 'var(--tm)', marginTop: 2 }}>{it.subcategoria}</div>}
                            </div>
                          ) : canClasificar ? (
                            <button className="btn btn-ghost btn-xs" style={{ fontSize: 10 }} title="Clasificar este ítem a mano" onClick={() => abrirClasifEdit(it)}>+ Clasificar</button>
                          ) : (
                            <span style={{ fontSize: 10, color: 'var(--tm)' }}>—</span>
                          )}
                        </td>
                        <td>
                          {esAyudante ? (
                            <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                              <span style={{ fontSize: 11, color: 'var(--ts)' }}>{DESTINO_LABEL[it.destino] || DESTINO_LABEL.obra}</span>
                              <button className="btn btn-ghost btn-xs" style={{ fontSize:10, padding:'2px 6px', alignSelf:'flex-start' }}
                                title="Pedir a la contadora jefe que cambie el destino de este ítem" onClick={() => setSolicitarTarget(it)}>
                                <JxIcon name="edit" size={9}/> Solicitar cambio
                              </button>
                            </div>
                          ) : (
                            <select className="fi" style={{ fontSize: 11, padding: '4px 6px' }} value={it.destino || 'obra'} disabled={busy}
                              onChange={e => setDestinoItem(it, e.target.value)}>
                              <option value="obra">🏗 Obra</option>
                              <option value="obra_general">🍽 Obra — gasto general</option>
                              <option value="empresa">🏢 Empresa (general)</option>
                            </select>
                          )}
                        </td>
                        <td>
                          {sinPresupuesto ? (
                            <span style={{ fontSize: 11, color: 'var(--tm)' }}>{it.destino === 'empresa' ? '— (consumo empresa)' : '— (gasto general de obra)'}</span>
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

      {solicitarTarget && (
        <RequestChangeModal
          table="accounting_movements"
          record={{ id: solicitarTarget.facturaId }}
          recordLabel={`${solicitarTarget.descripcion || 'ítem'} · ${solicitarTarget.doc || ''} · destino actual: ${(DESTINO_LABEL[solicitarTarget.destino] || DESTINO_LABEL.obra).replace(/^[^\s]+\s/, '')}`}
          fields={[]}
          showToast={toast}
          onClose={() => setSolicitarTarget(null)}
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
  // Índice de ítems de factura por (factura|idx) para enriquecer el registro con
  // QUÉ factura / proveedor / fecha quedó vinculada a este insumo.
  const itemByKey = uM(() => { const m = new Map(); (items || []).forEach(it => m.set(`${it.facturaId}|${it.itemIdx}`, it)); return m; }, [items]);
  const candidatos = uM(() => {
    const qn = norm(buscar);
    return items
      .filter(it => it.destino !== 'empresa' && it.destino !== 'obra_general')   // consumo de empresa y gastos generales de obra no van al presupuesto de partidas
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

      {/* Registro: qué ítems de qué facturas se han vinculado a ESTE insumo */}
      {vinculos.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ts)', marginBottom: 6 }}>
            Registro de facturas vinculadas ({vinculos.length}) · total {fmtS(vinculos.reduce((s, v) => s + (Number(v.cantidad) || 0) * (Number(v.precio_unitario) || 0), 0))}
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl"><tbody>
              {vinculos.map(v => {
                const it = itemByKey.get(`${v.accounting_movement_id}|${v.item_idx}`);
                return (
                  <tr key={v.id}>
                    <td className="col-p" style={{ fontSize: 12 }}>{v.item_descripcion}
                      <div style={{ fontSize: 10, color: 'var(--tm)' }}>{it ? `${it.doc || 's/doc'} · ${it.proveedor || 's/proveedor'}${it.fecha ? ' · ' + it.fecha : ''}` : 'factura no encontrada (¿borrada?)'}</div>
                    </td>
                    <td style={{ textAlign: 'right', fontSize: 12 }}>{fmtN(v.cantidad)} × {fmtS(v.precio_unitario)}</td>
                    <td style={{ textAlign: 'right', width: 90 }}>{fmtS((Number(v.cantidad) || 0) * (Number(v.precio_unitario) || 0))}</td>
                    <td style={{ textAlign: 'center', width: 40 }}><button className="btn btn-ghost btn-xs" disabled={busy} title="Quitar vínculo" onClick={() => onDesvincular(v)}><JxIcon name="x" size={11} /></button></td>
                  </tr>
                );
              })}
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
      // La subcategoría clasificada (Fase 1) acota el pre-filtro: un ítem
      // "cemento" prioriza insumos presupuestados de cemento.
      const boost = (ins) => item.subcategoria ? 0.5 * fuzzyScore(item.subcategoria, ins.nombre) : 0;
      const pre = maestra
        .map(ins => ({ ins, s: fuzzyScore(item.descripcion, ins.nombre) + boost(ins) }))
        .sort((a, b) => b.s - a.s).slice(0, 50).map(x => x.ins);
      const sug = await sugerirInsumoMatch({
        itemName: item.descripcion, obraId,
        // Clasificación como contexto para el matching semántico de la IA.
        category: [item.categoria, item.subcategoria].filter(Boolean).join(' / '),
        third_party_name: item.proveedor || '',
        insumos: pre.map(i => ({ codigo: i.codigo, nombre: i.nombre, unidad: i.unidad, enEjecucion: !!i.enEjecucion })),
      });
      setAiSug(sug);
      if (!(sug?.result?.coincidencias || []).length) toast?.('La IA no encontró un insumo presupuestado que corresponda', 'amber');
    } catch (e) { toast?.('Error de la IA: ' + (e.message || e), 'red'); }
    finally { setAiLoading(false); }
  };
  const candidatos = uM(() => {
    const qn = norm(buscar);
    // Boost por subcategoría clasificada (Fase 2): los insumos del mismo grupo
    // (cemento, fierro, tubería…) suben en la lista. El boost afecta SOLO el
    // ORDEN — el % mostrado y el umbral verde usan la similitud pura del
    // nombre (con boost sumado el badge podía superar el 100%).
    const boost = (ins) => item.subcategoria ? 0.5 * fuzzyScore(item.subcategoria, ins.nombre) : 0;
    return maestra
      .filter(ins => !yaVinc.has(ins.codigo))
      .map(ins => { const base = fuzzyScore(item.descripcion, ins.nombre); return { ins, score: base, orden: base + boost(ins) }; })
      .filter(({ ins }) => !qn || norm(ins.nombre).includes(qn) || String(ins.codigo).toLowerCase().includes(qn.replace(/ /g, '')))
      .sort((a, b) => b.orden - a.orden)
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
