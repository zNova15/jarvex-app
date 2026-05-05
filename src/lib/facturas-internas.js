// Helpers para crear/leer/regenerar facturas internas vinculadas a una
// cadena de trazabilidad. Cada paso de la cadena (entre eslabones consecutivos)
// genera 1 par de movimientos contables (income en vendedora + cost en compradora)
// + 1 fila en intercompany_transactions, todo con el mismo `chain_id`.
//
// Las facturas se almacenan en la tabla `accounting_movements` reusando los
// campos: type='income' (vendedor) / 'cost' (comprador), is_intercompany=true,
// related_movement_id (par), related_company_id (contraparte), chain_id, chain_step_index.

import { db, newId, newIdempotencyKey, SYNC_STATUS } from '../db/jarvex.db';
import { getCurrentMode } from '../hooks/useAppMode';

const IGV_RATE = 0.18;

// Devuelve todas las facturas (movimientos contables income/cost intercompany)
// asociadas a una cadena dada, agrupadas por step.
export async function listarFacturasDeCadena(chainId) {
  if (!chainId) return [];
  const movs = await db.accounting_movements
    .where('chain_id').equals(chainId)
    .filter(m => !m.deleted_at && m.is_intercompany)
    .toArray();
  const intercompany = await db.intercompany_transactions
    .where('chain_id').equals(chainId)
    .filter(t => !t.deleted_at)
    .toArray();
  // Agrupar por step
  const byStep = {};
  for (const m of movs) {
    const k = m.chain_step_index ?? -1;
    if (!byStep[k]) byStep[k] = { step: k, income: null, cost: null, intercompany: null };
    if (m.type === 'income') byStep[k].income = m;
    else if (m.type === 'cost') byStep[k].cost = m;
  }
  for (const t of intercompany) {
    const k = (movs.find(m => m.id === t.seller_movement_id)?.chain_step_index) ?? -1;
    if (byStep[k]) byStep[k].intercompany = t;
  }
  return Object.values(byStep).sort((a, b) => a.step - b.step);
}

// Genera N-1 borradores de factura interna para una cadena.
// Idempotente: si ya existen movs intercompany con el chain_id, no duplica.
//
// Args:
//   cadena: trazabilidad_cadenas record (con eslabones[])
//   companies: array de company records (para datos de razón social, ruc, etc.)
//   userId: id del usuario que ejecuta
// Returns: { creados: N, ya_existian: boolean, facturas: [...] }
export async function generarFacturasInternas(cadena, companies, userId) {
  if (!cadena?.id) throw new Error('Cadena inválida');
  const eslabones = Array.isArray(cadena.eslabones) ? cadena.eslabones : [];
  if (eslabones.length < 2) throw new Error('Se necesitan ≥2 eslabones en la cadena');

  // Idempotencia: si ya hay movs intercompany para esta cadena, no regenerar.
  const existentes = await db.accounting_movements
    .where('chain_id').equals(cadena.id)
    .filter(m => !m.deleted_at && m.is_intercompany)
    .count();
  if (existentes > 0) {
    const facturas = await listarFacturasDeCadena(cadena.id);
    return { creados: 0, ya_existian: true, facturas };
  }

  const isPrueba = getCurrentMode() === 'prueba';
  const cantidad = Number(cadena.cantidad) || 0;
  const moneda = cadena.moneda || 'PEN';
  const fechaBase = cadena.fecha || new Date().toISOString().slice(0, 10);
  const item = cadena.item_nombre || 'Material';
  const unidad = cadena.unidad || 'und';

  // Para cada par (i, i+1) creamos venta (i → i+1).
  const facturasCreadas = [];
  let serieCount = await contarFacturasPorEmpresa(); // mapa para serializar correlativos por company

  for (let i = 0; i < eslabones.length - 1; i++) {
    const vendedor = eslabones[i];
    const comprador = eslabones[i + 1];
    const compVend = companies.find(c => c.id === vendedor.company_id);
    const compComp = companies.find(c => c.id === comprador.company_id);
    if (!compVend || !compComp) {
      throw new Error(`Empresa no encontrada en eslabón ${i + 1} → ${i + 2}`);
    }

    const precioUnit = Number(vendedor.precio_unit) || 0;
    if (precioUnit <= 0) throw new Error(`Falta precio en eslabón ${i + 1} (${compVend.name})`);

    const subtotal = +(precioUnit * cantidad).toFixed(2);
    const igv = +(subtotal * IGV_RATE).toFixed(2);
    const total = +(subtotal + igv).toFixed(2);

    // Correlativo por empresa vendedora
    const baseCount = serieCount.get(compVend.id) || 0;
    const correlativo = baseCount + 1;
    serieCount.set(compVend.id, correlativo);
    const serie = 'FB01'; // borrador interno (no SUNAT aún)
    const documentNumber = `${serie}-${String(correlativo).padStart(8, '0')}`;

    const now = new Date().toISOString();
    const sellerMovId = newId();
    const buyerMovId = newId();

    const facturaMeta = {
      serie, correlativo, fecha: fechaBase, moneda,
      item_nombre: item, cantidad, unidad, precio_unitario: precioUnit,
      subtotal, igv, total,
      paso_idx: i + 1, paso_total: eslabones.length - 1,
      concepto: `Venta interna ${item} (cadena ${cadena.id.slice(0, 8)})`,
    };

    // 1) Asiento INGRESO en empresa vendedora
    await db.accounting_movements.add({
      id: sellerMovId,
      company_id: compVend.id,
      type: 'income',
      date: fechaBase,
      amount: total,
      currency: moneda,
      description: `Venta intercompany a ${compComp.name} · ${item}`,
      third_party_name: compComp.legal_name || compComp.name,
      third_party_ruc: compComp.ruc || null,
      document_type: 'factura',
      document_number: documentNumber,
      payment_status: 'pending',
      category: 'venta_intercompany',
      is_intercompany: true,
      related_company_id: compComp.id,
      related_movement_id: buyerMovId,
      chain_id: cadena.id,
      chain_step_index: i,
      factura_interna_meta: facturaMeta,
      estado_factura: 'borrador',
      notas: JSON.stringify({ chain_step: i, role: 'seller', factura: facturaMeta }),
      created_by: userId, updated_by: userId,
      created_at: now, updated_at: now,
      version: 1,
      sync_status: isPrueba ? SYNC_STATUS.SYNCED : SYNC_STATUS.PENDING_CREATE,
      last_synced_at: null,
      idempotency_key: newIdempotencyKey(userId, 'accounting_movements'),
      deleted_at: null,
      ...(isPrueba ? { demo: true } : {}),
    });

    // 2) Asiento COSTO en empresa compradora
    await db.accounting_movements.add({
      id: buyerMovId,
      company_id: compComp.id,
      type: 'cost',
      date: fechaBase,
      amount: total,
      currency: moneda,
      description: `Compra intercompany a ${compVend.name} · ${item}`,
      third_party_name: compVend.legal_name || compVend.name,
      third_party_ruc: compVend.ruc || null,
      document_type: 'factura',
      document_number: documentNumber,
      payment_status: 'pending',
      category: 'compra_intercompany',
      is_intercompany: true,
      related_company_id: compVend.id,
      related_movement_id: sellerMovId,
      chain_id: cadena.id,
      chain_step_index: i,
      factura_interna_meta: facturaMeta,
      estado_factura: 'borrador',
      notas: JSON.stringify({ chain_step: i, role: 'buyer', factura: facturaMeta }),
      created_by: userId, updated_by: userId,
      created_at: now, updated_at: now,
      version: 1,
      sync_status: isPrueba ? SYNC_STATUS.SYNCED : SYNC_STATUS.PENDING_CREATE,
      last_synced_at: null,
      idempotency_key: newIdempotencyKey(userId, 'accounting_movements'),
      deleted_at: null,
      ...(isPrueba ? { demo: true } : {}),
    });

    // 3) Intercompany transaction — fila resumen
    const itxId = newId();
    await db.intercompany_transactions.add({
      id: itxId,
      seller_company_id: compVend.id,
      buyer_company_id: compComp.id,
      date: fechaBase,
      operation_type: 'venta_material',
      description: `${item} · ${cantidad} ${unidad}`,
      amount: total,
      currency: moneda,
      document_type: 'factura',
      document_number: documentNumber,
      payment_status: 'pending',
      seller_movement_id: sellerMovId,
      buyer_movement_id: buyerMovId,
      chain_id: cadena.id,
      notas: `Paso ${i + 1}/${eslabones.length - 1} de la cadena`,
      created_by: userId, updated_by: userId,
      created_at: now, updated_at: now,
      version: 1,
      sync_status: isPrueba ? SYNC_STATUS.SYNCED : SYNC_STATUS.PENDING_CREATE,
      last_synced_at: null,
      idempotency_key: newIdempotencyKey(userId, 'intercompany_transactions'),
      deleted_at: null,
      ...(isPrueba ? { demo: true } : {}),
    });

    facturasCreadas.push({ step: i, sellerMovId, buyerMovId, itxId, facturaMeta });
  }

  // Marcar la cadena como facturada
  try {
    await db.trazabilidad_cadenas.update(cadena.id, {
      estado: 'facturada',
      updated_at: new Date().toISOString(),
      updated_by: userId,
      version: (cadena.version || 0) + 1,
      sync_status: cadena.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
    });
  } catch (e) { /* no bloquea */ }

  window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } }));
  window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'intercompany_transactions' } }));
  window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'trazabilidad_cadenas' } }));

  return { creados: facturasCreadas.length, ya_existian: false, facturas: facturasCreadas };
}

// Cuenta cuántas facturas internas existen por empresa vendedora para
// determinar el siguiente correlativo. Devuelve un Map<companyId, n>.
async function contarFacturasPorEmpresa() {
  const all = await db.accounting_movements
    .filter(m => !m.deleted_at && m.is_intercompany && m.type === 'income' && m.document_type === 'factura')
    .toArray();
  const map = new Map();
  for (const m of all) {
    map.set(m.company_id, (map.get(m.company_id) || 0) + 1);
  }
  return map;
}

// Marca un par seller/buyer como "emitida" (listo para imprimir / enviar a SUNAT).
export async function marcarFacturaEmitida(sellerMovId, userId) {
  const seller = await db.accounting_movements.get(sellerMovId);
  if (!seller) throw new Error('Factura no encontrada');
  const buyerId = seller.related_movement_id;
  const now = new Date().toISOString();
  for (const id of [sellerMovId, buyerId].filter(Boolean)) {
    const m = await db.accounting_movements.get(id);
    if (!m) continue;
    await db.accounting_movements.update(id, {
      estado_factura: 'emitida',
      updated_at: now, updated_by: userId,
      version: (m.version || 0) + 1,
      sync_status: m.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
    });
  }
  window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } }));
}

// Marca un par como "recibida_proveedor" (cuando el comprador subió la factura
// firmada por Captura Mágica).
export async function marcarFacturaRecibida(sellerMovId, userId, evidenciaId = null) {
  const seller = await db.accounting_movements.get(sellerMovId);
  if (!seller) throw new Error('Factura no encontrada');
  const now = new Date().toISOString();
  for (const id of [sellerMovId, seller.related_movement_id].filter(Boolean)) {
    const m = await db.accounting_movements.get(id);
    if (!m) continue;
    await db.accounting_movements.update(id, {
      estado_factura: 'recibida',
      file_url: evidenciaId ? `local://evidencia/${evidenciaId}` : m.file_url,
      updated_at: now, updated_by: userId,
      version: (m.version || 0) + 1,
      sync_status: m.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
    });
  }
  window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } }));
}
