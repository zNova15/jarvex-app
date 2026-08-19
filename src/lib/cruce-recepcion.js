// ═══════════════════════════════════════════════════════════════════
// JARVEX — Cruce Insumo (factura) ↔ Recepción (almacén)
//
// Puente CONTABILIDAD ↔ ALMACÉN. La contadora pregunta "¿este insumo de la
// factura llegó a almacén?" y la almacenera "¿este ingreso tiene comprobante?".
// El enlace persistente ya existe en el modelo:
//   · factura:  accounting_movements.recepcion_status + notas.items_factura[idx]
//               ({recibido, mov_vinculado_id, destino, rechazado})
//   · ingreso:  movimientos_materiales.accounting_movement_id + pendiente_sustento
//
// Este módulo son funciones PURAS (sin Dexie/DOM) para:
//   1) resumenRecepcion(mov)      → estado del "semáforo" de una factura.
//   2) referenciaSinCostos(...)   → lo que ve el rol de ALMACÉN: insumo, cantidad,
//      unidad, fecha, proveedor, N° de comprobante — NUNCA precios/subtotales/montos.
//   3) rankearIngresosParaItem / rankearFacturasParaIngreso → matcher DETERMINISTA
//      (sin IA, sin endpoint) que sugiere el enlace en ambos sentidos.
//
// Regla de negocio (decisión de Gabriel): el rol de almacén verifica por
// referencia TEXTUAL sin ver la imagen ni los COSTOS del comprobante.
// ═══════════════════════════════════════════════════════════════════

import { normTxt, fuzzyScore } from './match-helpers.js';

// ── notas.items_factura ────────────────────────────────────────────
/** Parsea el JSON de `notas` de un accounting_movement (tolerante a basura). */
export function parseNotas(notasRaw) {
  if (notasRaw && typeof notasRaw === 'object') return notasRaw;
  try { return JSON.parse(notasRaw || '{}') || {}; } catch { return {}; }
}

/** Ítems de factura (líneas) de un movimiento contable. [] si no hay. */
export function itemsDeFactura(mov) {
  const j = parseNotas(mov?.notas);
  return Array.isArray(j.items_factura) ? j.items_factura : [];
}

const num = (v) => Number(v) || 0;
const casiIgual = (a, b) => Math.abs(a - b) < 0.0001;

// Un ítem no necesita "llegar a almacén" si es servicio, va a la empresa/gasto
// general de obra, o el almacén lo negó. Espejo de recomputeStatus (compras-pendientes).
const itemNoRequiereAlmacen = (it) =>
  it?.rechazado === true ||
  it?.tipo_insumo === 'servicio' ||
  ['empresa', 'obra_general'].includes(it?.destino) ||
  // Separado para VENTA o ya vendido (flujo "Insumos para Venta"): por
  // definición NO va a ingresar a obra → deja de contar como pendiente en el
  // semáforo, en "¿llegó?", en la bandeja de almacén y en el reporte.
  ['para_venta', 'vendido'].includes(it?.venta_status);

const itemRecibidoCompleto = (it) => num(it?.recibido) >= num(it?.cantidad) - 0.0001 && num(it?.cantidad) > 0;

/**
 * Estado de recepción derivado SOLO de los ítems (mismo criterio que
 * recomputeStatus en jx-compras-pendientes). Devuelve uno de:
 *   'pendiente_recepcion' | 'parcial' | 'recibido' | 'no_recepcionado'
 */
export function estadoRecepcionDeItems(items) {
  const arr = Array.isArray(items) ? items : [];
  if (!arr.length) return 'pendiente_recepcion';
  const resuelto = (it) => itemNoRequiereAlmacen(it) || itemRecibidoCompleto(it);
  const algoRecibido = arr.some(it => num(it.recibido) > 0);
  const hayRechazo = arr.some(it => it.rechazado);
  if (!arr.every(resuelto)) return algoRecibido ? 'parcial' : 'pendiente_recepcion';
  if (algoRecibido) return 'recibido';
  return hayRechazo ? 'no_recepcionado' : 'recibido';
}

/**
 * Semáforo de una factura para la UI de contabilidad/almacén.
 * @returns {{estado,label,emoji,tone,recibidos,total,aplica}}
 *   estado: no_aplica | consumo_empresa | sin_confirmar | parcial | recibido | no_recibido
 */
export function resumenRecepcion(mov) {
  const items = itemsDeFactura(mov);
  const rs = mov?.recepcion_status || null;

  // Ventas / notas / lo que no genera recepción de almacén.
  const esVenta = mov?.clase === 'venta' || mov?.type === 'income';
  if (rs === 'no_aplica' || esVenta || (!items.length && !rs)) {
    return { estado: 'no_aplica', label: 'No aplica', emoji: '', tone: 'muted', recibidos: 0, total: 0, aplica: false };
  }

  const total = items.length;
  const recibidos = items.filter(it => itemRecibidoCompleto(it) || itemNoRequiereAlmacen(it)).length;

  // Consumo de empresa / gasto general (no fue a la obra): todos los ítems así.
  if (total > 0 && items.every(it => ['empresa', 'obra_general'].includes(it?.destino))) {
    return { estado: 'consumo_empresa', label: 'Consumo empresa / general', emoji: '🏢', tone: 'muted', recibidos, total, aplica: true };
  }

  const estado = rs || estadoRecepcionDeItems(items);
  switch (estado) {
    case 'recibido':
      return { estado: 'recibido', label: 'Recibido en almacén', emoji: '✅', tone: 'green', recibidos, total, aplica: true };
    case 'parcial':
      return { estado: 'parcial', label: `Parcial (${recibidos}/${total})`, emoji: '🟡', tone: 'amber', recibidos, total, aplica: true };
    case 'no_recepcionado':
      return { estado: 'no_recibido', label: 'No recibido en almacén', emoji: '❌', tone: 'red', recibidos, total, aplica: true };
    case 'pendiente_recepcion':
    default:
      return { estado: 'sin_confirmar', label: 'Sin confirmar recepción', emoji: '⏳', tone: 'amber', recibidos, total, aplica: true };
  }
}

// ── Referencia SIN COSTOS (lo único que ve el rol de almacén) ───────
// Whitelist explícita: solo campos operativos, NUNCA precio/subtotal/monto/igv.
const CAMPOS_ITEM_ALMACEN = ['descripcion', 'cantidad', 'unidad', 'material_id', 'tipo_insumo', 'recibido', 'destino', 'rechazado'];

/** Un ítem de factura reducido a lo que el almacén puede ver (sin costos). */
export function itemSinCostos(it) {
  const out = {};
  for (const k of CAMPOS_ITEM_ALMACEN) if (it && it[k] !== undefined) out[k] = it[k];
  return out;
}

/**
 * Referencia TEXTUAL de un comprobante para el rol de almacén: identifica el
 * documento y sus insumos SIN exponer ningún costo. `itemIdx` opcional para
 * referir una sola línea.
 * @returns {{documento,proveedor,fecha,obra_id,item_idx,insumos:[{descripcion,cantidad,unidad}]}}
 */
export function referenciaSinCostos(mov, itemIdx = null) {
  const items = itemsDeFactura(mov);
  const elegidos = (itemIdx == null ? items : [items[itemIdx]]).filter(Boolean);
  return {
    documento: `${mov?.document_type || 'doc'} ${mov?.document_number || ''}`.trim(),
    proveedor: mov?.third_party_name || null,
    fecha: mov?.date || null,
    obra_id: mov?.obra_id || null,
    item_idx: itemIdx,
    insumos: elegidos.map(itemSinCostos).map(({ descripcion, cantidad, unidad }) => ({
      descripcion: descripcion || '', cantidad: num(cantidad), unidad: unidad || 'und',
    })),
  };
}

// ── Matcher determinista (sin IA) ──────────────────────────────────
// Días entre dos fechas ('YYYY-MM-DD' o ISO). null si falta alguna.
function diffDias(a, b) {
  if (!a || !b) return null;
  const ta = Date.parse(String(a).slice(0, 10)), tb = Date.parse(String(b).slice(0, 10));
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.abs(ta - tb) / 86400000;
}

// Pesos del score (suman 1). El NOMBRE manda; fecha y cantidad confirman.
const PESOS = { nombre: 0.45, fecha: 0.20, cantidad: 0.15, proveedor: 0.10, obra: 0.05, unidad: 0.05 };

/**
 * Puntúa qué tanto un INGRESO de almacén corresponde a un ÍTEM de factura.
 * Determinista, sin IA. Ambos lados normalizados por el componente:
 *   item:    { descripcion, material_id?, cantidad?, unidad? }
 *   factura: { proveedor_id?, third_party_name?, obra_id?, fecha? }
 *   ingreso: { id, materialNombre?, material_id?, cantidad?, unidad?, fecha?, obra_id?, proveedor_id?, proveedorNombre? }
 * @returns {{score:number, motivos:string[]}}  score en [0..1]
 */
export function puntuarCruce(item, factura, ingreso, opts = {}) {
  const tolDias = opts.toleranciaDias ?? 15;
  const motivos = [];
  let s = 0;

  // Nombre: material_id igual = certeza; si no, similitud de descripción.
  let nombre = 0;
  if (item?.material_id && ingreso?.material_id && item.material_id === ingreso.material_id) {
    nombre = 1; motivos.push('mismo insumo del catálogo');
  } else {
    nombre = fuzzyScore(item?.descripcion, ingreso?.materialNombre);
    if (nombre >= 0.5) motivos.push(`nombre ${Math.round(nombre * 100)}%`);
  }
  s += PESOS.nombre * nombre;

  // Fecha: cuanto más cerca, mejor (dentro de la tolerancia).
  const d = diffDias(factura?.fecha, ingreso?.fecha);
  if (d != null) {
    const fs = Math.max(0, 1 - d / tolDias);
    s += PESOS.fecha * fs;
    if (fs > 0) motivos.push(d < 1 ? 'misma fecha' : `${Math.round(d)} día(s) de diferencia`);
  }

  // Cantidad: cercanía relativa.
  const qi = num(item?.cantidad), qm = num(ingreso?.cantidad);
  if (qi > 0 && qm > 0) {
    const cs = Math.max(0, 1 - Math.abs(qi - qm) / Math.max(qi, qm));
    s += PESOS.cantidad * cs;
    if (cs >= 0.9) motivos.push(`cantidad ${qm}≈${qi}`);
    else if (casiIgual(qi, qm)) motivos.push('misma cantidad');
  }

  // Proveedor.
  if (factura?.proveedor_id && ingreso?.proveedor_id && factura.proveedor_id === ingreso.proveedor_id) {
    s += PESOS.proveedor; motivos.push('mismo proveedor');
  } else if (factura?.third_party_name && ingreso?.proveedorNombre) {
    const ps = fuzzyScore(factura.third_party_name, ingreso.proveedorNombre);
    s += PESOS.proveedor * ps;
    if (ps >= 0.6) motivos.push('proveedor similar');
  }

  // Obra.
  if (factura?.obra_id && ingreso?.obra_id && factura.obra_id === ingreso.obra_id) {
    s += PESOS.obra; motivos.push('misma obra');
  }

  // Unidad.
  if (item?.unidad && ingreso?.unidad && normTxt(item.unidad) === normTxt(ingreso.unidad)) {
    s += PESOS.unidad;
  }

  return { score: Math.min(1, s), motivos };
}

const UMBRAL = 0.35;

/**
 * CONTADORA → ALMACÉN: dados un ítem de factura y los ingresos candidatos,
 * devuelve los ingresos ordenados por score (desc), solo por encima del umbral.
 * @returns {Array<{ingreso, score, motivos}>}
 */
export function rankearIngresosParaItem(item, factura, ingresos, opts = {}) {
  const umbral = opts.umbral ?? UMBRAL;
  return (Array.isArray(ingresos) ? ingresos : [])
    .map(ingreso => ({ ingreso, ...puntuarCruce(item, factura, ingreso, opts) }))
    .filter(c => c.score >= umbral)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limite ?? 8);
}

/**
 * ALMACÉN → CONTABILIDAD: dado un ingreso, encuentra las líneas de factura
 * candidatas. Cada factura aporta su MEJOR ítem no resuelto. Referencia SIN
 * COSTOS lista para mostrar al rol de almacén.
 * @param ingreso  ingreso normalizado (ver puntuarCruce)
 * @param facturas movimientos contables (compras) con notas.items_factura
 * @returns {Array<{facturaId, item_idx, score, motivos, referencia}>}
 */
export function rankearFacturasParaIngreso(ingreso, facturas, opts = {}) {
  const umbral = opts.umbral ?? UMBRAL;
  const out = [];
  for (const f of (Array.isArray(facturas) ? facturas : [])) {
    const ctx = { proveedor_id: f.proveedor_id, third_party_name: f.third_party_name, obra_id: f.obra_id, fecha: f.date };
    const items = itemsDeFactura(f);
    let mejor = null;
    items.forEach((it, idx) => {
      if (itemNoRequiereAlmacen(it) || itemRecibidoCompleto(it)) return; // ya resuelto
      const { score, motivos } = puntuarCruce(it, ctx, ingreso, opts);
      if (score >= umbral && (!mejor || score > mejor.score)) {
        mejor = { facturaId: f.id, item_idx: idx, score, motivos, referencia: referenciaSinCostos(f, idx) };
      }
    });
    if (mejor) out.push(mejor);
  }
  return out.sort((a, b) => b.score - a.score).slice(0, opts.limite ?? 8);
}

// ── Reporte de RECEPCIÓN por insumo (factura-céntrico) ──────────────
// Lee el enlace por-ítem que ya vive en items_factura[] (recibido/destino,
// poblado por Captura Mágica, Vinculación de Compras y el matcher 1-clic) y
// responde la pregunta de Gabriel: de lo FACTURADO, cuánto LLEGÓ a la obra,
// cuánto FALTA, y cuánto es consumo de EMPRESA / gasto general (no va a obra).
// Puro (sin IO) → testeable. NO usa costos.
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const normNombreRep = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * @param {Array} movs  accounting_movements (se filtran a COMPRAS con ítems).
 * @returns {{porInsumo:Array, porFactura:Array, totales:Object, porEstado:Object, nFacturas:number}}
 */
export function reporteRecepcion(movs) {
  const compras = (Array.isArray(movs) ? movs : []).filter(m =>
    m && !m.deleted_at && m.clase !== 'venta' && m.type !== 'income');
  const insumoMap = new Map();
  const porFactura = [];
  const tot = { facturado: 0, recibido: 0, faltante: 0, aObra: 0, aObraGeneral: 0, aEmpresa: 0 };

  for (const mv of compras) {
    const items = itemsDeFactura(mv);
    if (!items.length) continue;
    const rr = resumenRecepcion(mv);
    if (!rr.aplica) continue;
    porFactura.push({
      facturaId: mv.id,
      doc: `${mv.document_type || 'doc'} ${mv.document_number || ''}`.trim(),
      proveedor: mv.third_party_name || '',
      fecha: mv.date || '',
      obra_id: mv.obra_id || null,
      estado: rr.estado, label: rr.label, emoji: rr.emoji, tone: rr.tone,
      recibidos: rr.recibidos, total: rr.total,
    });
    for (const it of items) {
      const cant = num(it.cantidad);
      const recRaw = num(it.recibido);
      if (cant <= 0 && recRaw <= 0) continue;
      const rec = cant > 0 ? Math.min(recRaw, cant) : recRaw;
      const destino = it.destino || 'obra';
      const requiere = !itemNoRequiereAlmacen(it);
      const key = it.material_id
        ? ('m:' + it.material_id)
        : ('n:' + normNombreRep(it.descripcion || it.nombre) + '|' + normNombreRep(it.unidad));
      const cur = insumoMap.get(key) || {
        nombre: it.descripcion || it.nombre || '—', unidad: it.unidad || 'und',
        facturado: 0, recibido: 0, faltante: 0, aObra: 0, aObraGeneral: 0, aEmpresa: 0,
        nLineas: 0, facturas: new Set(),
      };
      cur.facturado += cant;
      cur.recibido += rec;
      if (requiere) cur.faltante += Math.max(0, cant - rec);
      if (destino === 'empresa') cur.aEmpresa += cant;
      else if (destino === 'obra_general') cur.aObraGeneral += cant;
      else cur.aObra += cant;
      cur.nLineas += 1;
      cur.facturas.add(mv.id);
      insumoMap.set(key, cur);

      tot.facturado += cant; tot.recibido += rec;
      if (requiere) tot.faltante += Math.max(0, cant - rec);
      if (destino === 'empresa') tot.aEmpresa += cant;
      else if (destino === 'obra_general') tot.aObraGeneral += cant;
      else tot.aObra += cant;
    }
  }

  const porInsumo = [...insumoMap.values()].map(c => ({
    nombre: c.nombre, unidad: c.unidad,
    facturado: round2(c.facturado), recibido: round2(c.recibido), faltante: round2(c.faltante),
    aObra: round2(c.aObra), aObraGeneral: round2(c.aObraGeneral), aEmpresa: round2(c.aEmpresa),
    nLineas: c.nLineas, nFacturas: c.facturas.size,
    // % recibido respecto de lo que SÍ debía llegar a obra (excluye empresa/general).
    pctRecibido: c.aObra > 0 ? Math.round((Math.min(c.recibido, c.aObra) / c.aObra) * 100) : null,
  })).sort((a, b) => b.faltante - a.faltante || b.facturado - a.facturado);

  const porEstado = {};
  for (const f of porFactura) porEstado[f.estado] = (porEstado[f.estado] || 0) + 1;

  return {
    porInsumo,
    porFactura: porFactura.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))),
    totales: {
      facturado: round2(tot.facturado), recibido: round2(tot.recibido), faltante: round2(tot.faltante),
      aObra: round2(tot.aObra), aObraGeneral: round2(tot.aObraGeneral), aEmpresa: round2(tot.aEmpresa),
    },
    porEstado,
    nFacturas: porFactura.length,
  };
}
