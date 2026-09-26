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

import { consumoPorObraModeloB } from './costo-obra.js';
import { requiereBancarizacion } from './tipo-cambio.js';
import { movimientosQueCuentan, notasPorFactura } from './notas-credito.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// La evidencia bancaria (constancias + depósitos multi-factura) se carga desde
// `bancarizado-db.js`: desde el 17-set el Libro Diario también la necesita para
// deducir la contrapartida del asiento, y no tiene por qué arrastrar toda la
// agregación de reportes en su chunk para preguntar una sola cosa. Se
// re-exporta para que los llamadores de siempre no cambien.
export { cargarBancarizados } from './bancarizado-db.js';

// Clase CANÓNICA única (clase manda), igual que el resto de la app
// (jx-contabilidad): así cada movimiento es compra XOR venta y no se cuenta doble.
const claseDe = (m) => m.clase || (m.type === 'income' ? 'venta' : 'compra');
const esCompra = (m) => claseDe(m) === 'compra';
const esVenta = (m) => claseDe(m) === 'venta';
const inRango = (f, from, to) => (!from || (f && f >= from)) && (!to || (f && f <= to));

/**
 * ¿El movimiento requiere bancarización y le falta? (PEN > S/2000 sin evidencia).
 *
 * PAR INTERCO: una venta entre empresas nuestras genera DOS movimientos (venta
 * + compra espejo) por UN comprobante y UNA transferencia. La constancia de una
 * pata vale para las dos, así que el reporte no debe reclamar la otra (espejo
 * de la regla de jx-contabilidad; decisión de Gabriel 1-sep). Contra un tercero
 * externo NO aplica: ahí la bancarización es propia de ese movimiento.
 */
export function faltaBancarizacion(m, bancarizadoSet) {
  if (!requiereBancarizacion(m.amount, m.currency, m.tipo_cambio, m.date)) return false;
  if (bancarizadoSet.has(m.id)) return false;
  if (m.is_intercompany && m.related_movement_id && bancarizadoSet.has(m.related_movement_id)) return false;
  return true;
}

/**
 * Agrega la contabilidad en KPIs, consumo por obra/empresa, bancarización,
 * top proveedores/categorías, facturas recientes y pagos. FUNCIÓN PURA.
 *
 * ── TODO EN SOLES, NUNCA SOLES + DÓLARES CRUDOS (tanda C, 25-set-2026) ──
 * Hasta hoy sumaba `amount` tal cual: KOPLAST aportaba US$ 150.000 que el PDF
 * «Reporte contable» mostraba como S/ 150.000 de compras (regla 11 del
 * CLAUDE.md). Ahora cada comprobante en otra moneda se pasa a soles con el
 * tipo de cambio de SU fecha de emisión —el mismo criterio que el Registro de
 * Compras y el Libro Diario (Gabriel: soles al TC de la fecha de emisión)— y
 * lo que no tiene tasa queda FUERA de las sumas y se cuenta en
 * `kpis.sinTipoCambio`, en vez de entrar como si fueran soles.
 *
 * Y cuenta solo lo que cuenta: nada dado de baja, y las notas de crédito con
 * su signo (factura y nota vivas, la nota resta — Gabriel, 25-set-2026).
 * Antes sumaba también los anulados.
 *
 * @param tasaDe  (mov) => tipo de cambio del comprobante, o null. Sin él solo
 *                vale el `tipo_cambio` estampado en el propio comprobante.
 */
export function agregarContable({
  movimientos = [], bancarizadoSet = new Set(), pagos = [],
  companiesById = new Map(), obrasById = new Map(), consorcios = [],
  from = null, to = null, topN = 10, tasaDe = null,
} = {}) {
  const cuentan = movimientosQueCuentan(movimientos, { referencia: movimientos })
    .filter(m => inRango(m.date, from, to));
  // Una factura anulada entera por su nota no se pagó (o se devolvió): no se
  // le reclama bancarización, igual que no se le reclama la detracción.
  const anuladasPorNota = notasPorFactura(movimientos);

  // A soles. `amount` pasa a ser el importe en soles; lo que dice el papel
  // queda en `montoOrigen`/`monedaOrigen` para mostrarlo al lado.
  const sinTc = new Map();   // 'USD' → cantidad
  const aSoles = (m) => {
    const moneda = String(m.currency || 'PEN').trim().toUpperCase();
    if (moneda === 'PEN') return m;
    const propio = Number(m.tipo_cambio);
    const tc = propio > 0 ? propio : (typeof tasaDe === 'function' ? Number(tasaDe(m)) || 0 : 0);
    if (!(tc > 0)) { sinTc.set(moneda, (sinTc.get(moneda) || 0) + 1); return null; }
    return { ...m, amount: r2((Number(m.amount) || 0) * tc), monedaOrigen: moneda, montoOrigen: Number(m.amount) || 0, tcUsado: tc };
  };
  const movs = cuentan.map(aSoles).filter(Boolean);
  const compras = movs.filter(esCompra);
  const ventas = movs.filter(esVenta);
  const nomEmp = (id) => companiesById.get(id)?.name || companiesById.get(id)?.legal_name || '(sin empresa)';
  const nomObra = (id) => obrasById.get(id)?.nombre_obra || obrasById.get(id)?.nombre || '(sin obra)';
  const amt = (m) => Number(m.amount) || 0;

  // ── Bancarización pendiente ──
  // Se mide sobre el comprobante ORIGINAL (moneda y tasa del papel): el D.L.
  // 1529 tiene su propio umbral en dólares (US$ 500) y la copia en soles ya
  // no lo sabría. El monto que se suma sí es el de soles.
  const enSolesPorId = new Map(compras.map(m => [m.id, m]));
  const pend = cuentan
    .filter(m => esCompra(m) && enSolesPorId.has(m.id))
    .filter(m => !anuladasPorNota.get(m.id)?.anulada)
    .filter(m => faltaBancarizacion(m, bancarizadoSet))
    .map(m => enSolesPorId.get(m.id));

  // ── Agrupaciones ──
  const groupSum = (arr, keyFn, nameFn) => {
    const g = new Map();
    for (const m of arr) { const k = keyFn(m) || 'sin'; const e = g.get(k) || { key: k, nombre: nameFn(m, k), monto: 0, n: 0 }; e.monto += amt(m); e.n += 1; g.set(k, e); }
    return [...g.values()].sort((a, b) => b.monto - a.monto);
  };
  // ── CONSUMO POR OBRA, BAJO EL MODELO B ──────────────────────────
  // Antes de la tanda 7 esto era un `groupSum(compras, obra_id)` y por eso
  // Plan Miraflores figuraba con S/ 2,25 M cuando la ejecutora había comprado
  // S/ 227.805,65: sumaba en la misma bolsa las compras de la ejecutora y las
  // de las demás empresas del grupo, que todavía NO son costo de la obra
  // (decisión de Gabriel, 6-sep-2026). Ahora son dos columnas y no se suman.
  // Los índices llegan como Map<id, fila> y las filas no siempre traen el `id`
  // adentro (el caller las arma desde Dexie por clave). Reinyectarlo acá es lo
  // que hace que `costoDeObra` pueda resolver el titular de cada obra.
  const conId = (m) => [...m.entries()].map(([id, v]) => ({ id, ...v }));
  const consumoPorObra = consumoPorObraModeloB({
    movs: compras,
    obras: conId(obrasById),
    consorcios,
    companies: conId(companiesById),
  }).map(f => ({ ...f, key: f.obra_id, monto: f.costo, n: f.nCosto }));
  const consumoPorEmpresa = groupSum(compras, m => m.company_id, (m) => nomEmp(m.company_id));
  const topProveedores = groupSum(compras, m => m.proveedor_id || m.third_party_ruc || m.third_party_name, (m) => m.third_party_name || '(sin proveedor)').slice(0, topN);
  const topCategorias = groupSum(compras, m => m.category, (m) => m.category || '(sin categoría)').slice(0, topN);

  const facturasRecientes = [...compras].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, topN).map(m => ({
    id: m.id, fecha: m.date, proveedor: m.third_party_name || '—', doc: m.document_number || '—',
    empresa: nomEmp(m.company_id), obra: nomObra(m.obra_id), monto: amt(m),
    // Lo que dice el papel, cuando no está en soles: la fila lo muestra al lado.
    monedaOrigen: m.monedaOrigen || 'PEN', montoOrigen: m.montoOrigen ?? amt(m),
    estado: m.payment_status || '—', faltaBanc: pend.some(p => p.id === m.id),
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
      // Comprobantes en otra moneda sin tipo de cambio: quedaron FUERA de las
      // sumas de arriba. Un total que cierra de menos sin decirlo es peor que
      // uno que avisa.
      sinTipoCambio: [...sinTc.values()].reduce((s, n) => s + n, 0),
      sinTipoCambioPorMoneda: [...sinTc.entries()].map(([moneda, n]) => ({ moneda, n })),
    },
    consumoPorObra, consumoPorEmpresa, topProveedores, topCategorias, facturasRecientes,
    pagosPorEstado,
    detalle: [...compras, ...ventas].sort((a, b) => String(b.date).localeCompare(String(a.date))),
  };
}
