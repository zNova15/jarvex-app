// ═══════════════════════════════════════════════════════════════════
// JARVEX — Lógica PURA de pagos (personal / subcontratos / facturas)
//
// Un PAGO es el compromiso (monto acordado, ej. S/7,000 al subcontrato);
// las PARTES son las transferencias/depósitos que lo completan
// (900 + 3200 + 2900 = 7000), cada una con su evidencia.
// Módulo sin React ni Dexie: 100% testeable.
// ═══════════════════════════════════════════════════════════════════

export const MODOS_PAGO = [
  ['planilla', 'Planilla'],
  ['rxh', 'Recibo por honorarios'],
  ['otro', 'Otro'],
];
export const MODO_PAGO_LABEL = Object.fromEntries(MODOS_PAGO);

export const METODOS_PARTE = [
  ['transferencia', 'Transferencia'],
  ['deposito', 'Depósito en banco'],
  ['agente', 'Agente bancario'],
  ['yape_plin', 'Yape / Plin'],
  ['efectivo', 'Efectivo'],
  ['cheque', 'Cheque'],
  ['otro', 'Otro'],
];
export const METODO_PARTE_LABEL = Object.fromEntries(METODOS_PARTE);

export const ESTADOS_PAGO = {
  pendiente: { lbl: 'Pendiente', cls: 'b-gray' },
  parcial:   { lbl: 'Parcial',   cls: 'b-amber' },
  pagado:    { lbl: 'Pagado',    cls: 'b-green' },
  anulado:   { lbl: 'Anulado',   cls: 'b-red' },
};

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Suma las partes vivas y deriva el estado del pago.
 * Tolerancia de 0.01 por redondeos de céntimos.
 * @returns {{ pagado:number, falta:number, exceso:number, estado:'pendiente'|'parcial'|'pagado', pct:number }}
 */
export function calcularEstadoPago(montoAcordado, partes) {
  const total = r2(montoAcordado);
  const pagado = r2((partes || [])
    .filter(p => p && !p.deleted_at)
    .reduce((s, p) => s + (Number(p.monto) || 0), 0));
  const falta = r2(Math.max(0, total - pagado));
  const exceso = r2(Math.max(0, pagado - total));
  // Sin monto pre-acordado (total 0): lo pagado ES el total → 'pagado'.
  const estado = pagado <= 0.009 ? 'pendiente'
    : (total <= 0 || pagado >= total - 0.01) ? 'pagado'
    : 'parcial';
  const pct = total > 0 ? Math.min(100, r2((pagado / total) * 100)) : (pagado > 0 ? 100 : 0);
  return { pagado, falta, exceso, estado, pct };
}

/**
 * Valida una parte antes de guardarla. Devuelve lista de errores legibles
 * (vacía = ok). `faltante` = lo que queda por pagar ANTES de esta parte.
 */
export function validarParte({ monto, fecha, metodo }, { faltante = null } = {}) {
  const errs = [];
  const m = Number(monto);
  if (!(m > 0)) errs.push('El monto de la parte debe ser mayor a 0.');
  if (!fecha) errs.push('Indicá la fecha del pago.');
  if (!metodo) errs.push('Elegí el método (transferencia, depósito, agente…).');
  // Exceder lo acordado no es error duro (puede haber reajuste) pero se avisa.
  if (faltante != null && m > 0 && m - faltante > 0.01) {
    errs.push(`AVISO_EXCESO:${r2(m - faltante)}`);
  }
  return errs;
}

/** Evidencias requeridas según el modo de pago (para checklist visual). */
export function evidenciasRequeridas(modoPago) {
  if (modoPago === 'rxh') {
    return [
      { tipo: 'recibo_honorarios', lbl: 'Recibo por honorarios emitido por el trabajador' },
      { tipo: 'pago_evidencia', lbl: 'Constancia del pago (transferencia/depósito/agente)' },
    ];
  }
  // planilla / otro / subcontrato: constancia del movimiento de dinero.
  return [{ tipo: 'pago_evidencia', lbl: 'Constancia del pago (transferencia/depósito/agente)' }];
}

/**
 * Checklist de completitud de un pago: estado del dinero + evidencias.
 * `evidencias` = filas de la tabla evidencias ligadas al pago o a sus partes.
 */
export function checklistPago(pago, partes, evidencias) {
  const dinero = calcularEstadoPago(pago?.monto_acordado, partes);
  const evs = (evidencias || []).filter(e => e && !e.deleted_at);
  const req = evidenciasRequeridas(pago?.modo_pago);
  const items = req.map(rq => ({
    ...rq,
    ok: evs.some(e => e.tipo_evidencia === rq.tipo),
  }));
  // Cada parte debería tener su comprobante (salvo efectivo, donde puede no haber).
  const partesVivas = (partes || []).filter(p => p && !p.deleted_at);
  const partesSinEvidencia = partesVivas.filter(p =>
    p.metodo !== 'efectivo' && !p.evidencia_id &&
    !evs.some(e => e.registro_relacionado_id === p.id)).length;
  const completo = dinero.estado === 'pagado' && items.every(i => i.ok) && partesSinEvidencia === 0;
  return { dinero, items, partesSinEvidencia, completo };
}
