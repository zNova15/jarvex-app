// ═══════════════════════════════════════════════════════════════════
// JARVEX — Reportes Contables (núcleo de agregación).
//
// Sobre accounting_movements (facturas/comprobantes), la bancarización
// (evidencia tipo 'bancarizacion'), companies (empresas del grupo) y pagos
// (personal/subcontratos). Cálculo PURO; la carga desde Dexie es capa fina.
//
// Modelo (verificado):
//  · accounting_movements: company_id, obra_id, proveedor_id, date, type
//    (income|cost|expense), clase (venta|compra), category, amount, currency,
//    third_party_name/ruc, payment_status, document_type/number, metodo_pago.
//  · Bancarización = evidencia (modulo 'accounting_movements', tipo
//    'bancarizacion') presente; "falta" = mov en PEN > S/2000 sin esa evidencia.
//  · pagos: beneficiario_tipo (personal|subcontrato), monto_acordado, estado.
// ═══════════════════════════════════════════════════════════════════

/** Set de ids de movimientos que YA tienen evidencia de bancarización (no fallida). */
export async function cargarBancarizados(db) {
  const set = new Set();
  try {
    const evs = await db.evidencias
      .filter(e => e.modulo_relacionado === 'accounting_movements' && e.tipo_evidencia === 'bancarizacion' && !e.deleted_at && e.registro_relacionado_id && e.sync_status !== 'failed')
      .toArray();
    for (const e of evs) set.add(e.registro_relacionado_id);
  } catch {}
  return set;
}

// Clase CANÓNICA única (clase manda), igual que el resto de la app
// (jx-contabilidad): así cada movimiento es compra XOR venta y no se cuenta doble.
const claseDe = (m) => m.clase || (m.type === 'income' ? 'venta' : 'compra');
const esCompra = (m) => claseDe(m) === 'compra';
const esVenta = (m) => claseDe(m) === 'venta';
const inRango = (f, from, to) => (!from || (f && f >= from)) && (!to || (f && f <= to));

/** ¿El movimiento requiere bancarización y le falta? (PEN > S/2000 sin evidencia). */
export function faltaBancarizacion(m, bancarizadoSet) {
  if (!(m.currency === 'PEN' && Number(m.amount) > 2000)) return false;
  return !bancarizadoSet.has(m.id);
}

/**
 * Agrega la contabilidad en KPIs, consumo por obra/empresa, bancarización,
 * top proveedores/categorías, facturas recientes y pagos. FUNCIÓN PURA.
 */
export function agregarContable({
  movimientos = [], bancarizadoSet = new Set(), pagos = [],
  companiesById = new Map(), obrasById = new Map(),
  from = null, to = null, topN = 10,
} = {}) {
  const movs = movimientos.filter(m => !m.deleted_at && inRango(m.date, from, to));
  const compras = movs.filter(esCompra);
  const ventas = movs.filter(esVenta);
  const nomEmp = (id) => companiesById.get(id)?.name || companiesById.get(id)?.legal_name || '(sin empresa)';
  const nomObra = (id) => obrasById.get(id)?.nombre_obra || obrasById.get(id)?.nombre || '(sin obra)';
  const amt = (m) => Number(m.amount) || 0;

  // ── Bancarización pendiente ──
  const pend = compras.filter(m => faltaBancarizacion(m, bancarizadoSet));

  // ── Agrupaciones ──
  const groupSum = (arr, keyFn, nameFn) => {
    const g = new Map();
    for (const m of arr) { const k = keyFn(m) || 'sin'; const e = g.get(k) || { key: k, nombre: nameFn(m, k), monto: 0, n: 0 }; e.monto += amt(m); e.n += 1; g.set(k, e); }
    return [...g.values()].sort((a, b) => b.monto - a.monto);
  };
  const consumoPorObra = groupSum(compras, m => m.obra_id, (m) => nomObra(m.obra_id));
  const consumoPorEmpresa = groupSum(compras, m => m.company_id, (m) => nomEmp(m.company_id));
  const topProveedores = groupSum(compras, m => m.proveedor_id || m.third_party_ruc || m.third_party_name, (m) => m.third_party_name || '(sin proveedor)').slice(0, topN);
  const topCategorias = groupSum(compras, m => m.category, (m) => m.category || '(sin categoría)').slice(0, topN);

  const facturasRecientes = [...compras].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, topN).map(m => ({
    id: m.id, fecha: m.date, proveedor: m.third_party_name || '—', doc: m.document_number || '—',
    empresa: nomEmp(m.company_id), obra: nomObra(m.obra_id), monto: amt(m),
    estado: m.payment_status || '—', faltaBanc: faltaBancarizacion(m, bancarizadoSet),
  }));

  // ── Pagos (compromisos): agrupados por estado y por tipo de beneficiario ──
  const pagosVivos = pagos.filter(p => !p.deleted_at);
  const pagosPorEstado = {};
  for (const p of pagosVivos) { const e = p.estado || 'pendiente'; pagosPorEstado[e] = (pagosPorEstado[e] || 0) + (Number(p.monto_acordado) || 0); }
  const pagadoTotal = (pagosPorEstado.pagado || 0);
  // Pendiente = comprometido y aún no pagado (excluye pagado/anulado/cancelado).
  const NO_PENDIENTE = new Set(['pagado', 'anulado', 'cancelado']);
  const pagoPendiente = Object.entries(pagosPorEstado).filter(([e]) => !NO_PENDIENTE.has(e)).reduce((s, [, v]) => s + v, 0);

  return {
    kpis: {
      totalCompras: +compras.reduce((s, m) => s + amt(m), 0).toFixed(2),
      totalVentas: +ventas.reduce((s, m) => s + amt(m), 0).toFixed(2),
      nFacturas: compras.length,
      bancPendCount: pend.length,
      bancPendMonto: +pend.reduce((s, m) => s + amt(m), 0).toFixed(2),
      pagadoTotal: +pagadoTotal.toFixed(2),
      pagoPendiente: +pagoPendiente.toFixed(2),
    },
    consumoPorObra, consumoPorEmpresa, topProveedores, topCategorias, facturasRecientes,
    pagosPorEstado,
    detalle: [...compras, ...ventas].sort((a, b) => String(b.date).localeCompare(String(a.date))),
  };
}
