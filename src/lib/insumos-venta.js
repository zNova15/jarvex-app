// ═══════════════════════════════════════════════════════════════════
// JARVEX — Insumos facturados SIN INGRESO a obra → separación para VENTA.
//
// Pedido de la jefa de contabilidad (ago-2026): hay facturas de compra cuyos
// ítems nunca se vincularon a un ingreso de almacén — no van a usarse en la
// obra y se quieren VENDER. Flujo (doble control):
//   1. DETECTAR: ítems con cantidad facturada > recibida (candidatos).
//   2. COMPROBAR: consulta a almacén ("¿ingresó o va a ingresar?") por el
//      puente existente; con respuesta "NO" la jefa/admin puede separar.
//   3. SEPARAR: venta_status='para_venta' en el ítem (vive en
//      notas.items_factura — sin tablas nuevas).
//   4. VENDER: al emitir la factura de venta se vincula (venta_status=
//      'vendido' + venta_mov_id) → trazabilidad compra→venta.
//
// Lib PURA (sin IO) → testeable. Los estados se escriben desde jx-contabilidad.
// ═══════════════════════════════════════════════════════════════════
import { itemsDeFactura } from './cruce-recepcion.js';

const num = (v) => (Number(v) || 0);

/** ¿El ítem es relevante para almacén? (los servicios y el consumo de
 *  empresa/gasto general no "ingresan a obra" por diseño — no son candidatos). */
export function itemAplicaAlmacen(it) {
  if (!it) return false;
  if (String(it.tipo_insumo || '') === 'servicio') return false;
  // Mismo criterio que itemNoRequiereAlmacen (cruce-recepcion): consumo de
  // EMPRESA o gasto general de OBRA ('obra_general' — valor canónico del repo;
  // antes se comparaba contra 'general', que no existe → esos ítems aparecían
  // como candidatos a venta).
  const dest = String(it.destino || '');
  if (dest === 'empresa' || dest === 'obra_general') return false;
  return true;
}

/** Cantidad facturada que NO llegó a obra (0 si el ítem no aplica). */
export function pendienteDeIngreso(it) {
  if (!itemAplicaAlmacen(it)) return 0;
  return Math.max(0, num(it.cantidad) - num(it.recibido));
}

/** ¿La factura es una COMPRA viva con relevancia de almacén? */
function esCompraConAlmacen(m) {
  if (!m || m.deleted_at) return false;
  const clase = m.clase || (m.type === 'income' ? 'venta' : 'compra');
  if (clase !== 'compra') return false;
  if (m.recepcion_status === 'no_aplica') return false;
  return true;
}

const filaDe = (m, it, idx) => ({
  facturaId: m.id,
  idx,
  item: it,
  descripcion: it.descripcion || '(ítem)',
  unidad: it.unidad || 'und',
  doc: m.document_number || 's/n',
  fecha: m.date || '',
  proveedor: m.third_party_name || '',
  costoUnit: num(it.precio_unitario),
});

/** CANDIDATOS: ítems de compras con cantidad pendiente de ingreso y sin
 *  estado de venta todavía. Ordenados del más viejo al más nuevo (los que
 *  llevan más tiempo sin ingresar van primero). */
export function candidatosSinIngreso(movs) {
  const out = [];
  for (const m of (movs || [])) {
    if (!esCompraConAlmacen(m)) continue;
    itemsDeFactura(m).forEach((it, idx) => {
      if (it.venta_status) return;             // ya separado/vendido
      const pend = pendienteDeIngreso(it);
      if (pend <= 0) return;
      out.push({ ...filaDe(m, it, idx), pendiente: pend });
    });
  }
  return out.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
}

/** POOL: ítems separados para venta (aún sin vender). */
export function poolParaVenta(movs) {
  const out = [];
  for (const m of (movs || [])) {
    if (!m || m.deleted_at) continue;
    itemsDeFactura(m).forEach((it, idx) => {
      if (it.venta_status !== 'para_venta') return;
      const separada = num(it.venta_cantidad) || pendienteDeIngreso(it) || num(it.cantidad);
      // Si DESPUÉS de separar el ítem se recepcionó (los flujos de recepción no
      // leen venta_status), lo que queda realmente disponible es lo pendiente.
      const pendienteActual = pendienteDeIngreso(it);
      const ingresoPosterior = Math.max(0, separada - pendienteActual);
      const cant = Math.min(separada, pendienteActual);
      out.push({ ...filaDe(m, it, idx), cantidad: cant, cantidadSeparada: separada, ingresoPosterior,
        costoTotal: cant * num(it.precio_unitario), separadoAt: it.venta_marcado_at || null });
    });
  }
  return out.sort((a, b) => String(b.separadoAt || '').localeCompare(String(a.separadoAt || '')));
}

/** VENDIDOS: ítems ya vinculados a una factura de venta. */
export function vendidosVenta(movs) {
  const out = [];
  const porId = new Map((movs || []).map(m => [m.id, m]));
  for (const m of (movs || [])) {
    if (!m || m.deleted_at) continue;
    itemsDeFactura(m).forEach((it, idx) => {
      if (it.venta_status !== 'vendido') return;
      const venta = it.venta_mov_id ? porId.get(it.venta_mov_id) : null;
      const cant = num(it.venta_cantidad) || num(it.cantidad);
      out.push({
        ...filaDe(m, it, idx), cantidad: cant, costoTotal: cant * num(it.precio_unitario),
        ventaDoc: venta?.document_number || null, ventaFecha: venta?.date || null,
        ventaMonto: venta ? num(venta.amount) : null, ventaMovId: it.venta_mov_id || null,
        // La venta vinculada ya no existe (borrada/anulada): permitir devolver al pool.
        ventaBorrada: !!it.venta_mov_id && (!venta || !!venta.deleted_at),
      });
    });
  }
  return out.sort((a, b) => String(b.ventaFecha || '').localeCompare(String(a.ventaFecha || '')));
}

const esConsultaVenta = (c) => {
  try { const ref = typeof c.referencia === 'string' ? JSON.parse(c.referencia) : (c.referencia || {}); return ref?.flujo === 'venta'; } catch { return false; }
};

/** Resumen de la respuesta de almacén para un ítem (desde puente_consultas).
 *  Reglas: 'si' / 'parcial' / 'otra_fecha' (= llegó) BLOQUEAN la separación
 *  vengan de la consulta que vengan; 'no' HABILITA solo si la consulta es del
 *  flujo VENTA (referencia.flujo='venta') — el "No llegó" de la consulta vieja
 *  "¿llegó a almacén?" significa "todavía no", no "no va a ingresar".
 *  Estados: sin_consulta | esperando | no | no_otro_flujo | si | parcial | otra_fecha */
export function estadoConsultaItem(consultas, facturaId, idx) {
  const propias = (consultas || []).filter(c => !c.deleted_at &&
    c.accounting_movement_id === facturaId && Number(c.item_idx) === Number(idx));
  if (!propias.length) return { estado: 'sin_consulta', consulta: null };
  const conResp = propias.filter(c => c.respuesta_tipo)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  if (!conResp.length) return { estado: 'esperando', consulta: propias[0] };
  // Cualquier confirmación de llegada manda (aunque no sea la más reciente).
  const llego = conResp.find(c => ['si', 'parcial', 'otra_fecha'].includes(c.respuesta_tipo));
  if (llego) return { estado: llego.respuesta_tipo, consulta: llego };
  const reciente = conResp[0];
  if (reciente.respuesta_tipo === 'no' && !esConsultaVenta(reciente)) return { estado: 'no_otro_flujo', consulta: reciente };
  return { estado: reciente.respuesta_tipo, consulta: reciente };
}
