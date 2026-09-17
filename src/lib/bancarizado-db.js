// ═══════════════════════════════════════════════════════════════════
// JARVEX — QUÉ COMPROBANTES TIENEN SU PLATA PROBADA POR EL BANCO.
//
// Vivía dentro de `reportes-contable.js`, que además importa `costo-obra.js`
// y toda la agregación de KPIs. Desde el 17-set el Libro Diario también lo
// necesita —la contrapartida del asiento se deduce de esta evidencia— y no
// tiene por qué cargar los reportes enteros en su chunk para preguntar una
// sola cosa. `reportes-contable.js` lo re-exporta, así que sus llamadores
// siguen igual: la definición es UNA.
//
// Dos formas de estar bancarizado, y las dos valen:
//  1. La constancia cargada como evidencia del propio comprobante.
//  2. El DEPÓSITO multi-factura (mig 137): una transferencia cubre varias
//     facturas y la constancia vive en el depósito, no en cada una. Ahí el
//     comprobante cuenta como bancarizado solo si sus partes lo cubren
//     COMPLETO — media factura bancarizada no es una factura bancarizada.
// ═══════════════════════════════════════════════════════════════════

/** Set de ids de movimientos con la plata probada por el banco. */
export async function cargarBancarizados(db) {
  const set = new Set();
  if (!db) return set;
  try {
    const evs = await db.evidencias
      .filter(e => e.modulo_relacionado === 'accounting_movements' && e.tipo_evidencia === 'bancarizacion' && !e.deleted_at && e.registro_relacionado_id && e.sync_status !== 'failed')
      .toArray();
    for (const e of evs) set.add(e.registro_relacionado_id);
  } catch {}
  try {
    const partes = await db.pagos_partes.filter(p => !p.deleted_at && p.accounting_movement_id).toArray();
    const deps = db.depositos_bancarizacion
      ? await db.depositos_bancarizacion.filter(d => !d.deleted_at).toArray().catch(() => [])
      : [];
    const depIds = new Set(deps.map(d => d.id));
    const porMov = new Map();
    for (const p of partes) { const a = porMov.get(p.accounting_movement_id) || []; a.push(p); porMov.set(p.accounting_movement_id, a); }
    for (const [movId, arr] of porMov) {
      if (set.has(movId)) continue;
      // eslint-disable-next-line no-await-in-loop
      const m = await db.accounting_movements.get(movId);
      if (!m || m.deleted_at) continue;
      const suma = arr.reduce((t, p) => t + (Number(p.monto) || 0), 0);
      if (suma >= (Number(m.amount) || 0) - 0.01 && arr.every(p => !p.deposito_id || depIds.has(p.deposito_id))) {
        set.add(movId);
      }
    }
  } catch {}
  return set;
}

export default { cargarBancarizados };
