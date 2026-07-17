// DEPÓSITOS de bancarización: UNA transferencia/depósito que cubre VARIAS
// facturas (pedido de Gabriel, jul 2026). Ejemplo: 3 facturas de 3,000 +
// 7,000 + 10,000 al mismo proveedor → una sola transferencia de 20,000.
// El depósito se registra una vez (con su constancia) y cada factura se
// vincula consumiendo SALDO: 20,000 → −3,000 → −7,000 → −10,000 = 0. Un
// vínculo que exceda el saldo restante se RECHAZA (no puede cubrirse más de
// lo realmente transferido).
//
// Regla de identidad (IMPORTANTE): el depósito vale solo para facturas del
// MISMO pagador → cobrador. Un pago de la empresa A a la B no puede cubrir
// la factura que C le emitió a A. El par se expresa como:
//   empresa del grupo (company_id) + dirección (clase compra|venta) + tercero
//   (RUC normalizado; fallback nombre) + moneda.
// · COMPRA: nosotros (company) pagamos al tercero (proveedor).
// · VENTA:  el tercero (cliente) nos paga a nosotros (company).
//
// La parte servidor espeja esta validación con un trigger (mig 137) para el
// SALDO y el par — esto es solo la primera línea (UX con mensajes claros).
import { normalizarRuc } from './doc-id.js';
import { claseDe } from './dedupe-movs-contables.js';

export const TOL = 0.01;   // tolerancia de centavos en comparaciones de montos

// Identidad comparable del tercero: RUC normalizado o, si no hay, el nombre.
export function terceroKey(ruc, nombre) {
  return normalizarRuc(ruc) || String(nombre || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

// Par (pagador→cobrador) de un movimiento contable.
export function parMovimiento(m) {
  return {
    company_id: m?.company_id || null,
    clase: claseDe(m),
    tercero: terceroKey(m?.third_party_ruc, m?.third_party_name),
    moneda: m?.currency || 'PEN',
  };
}

// Par (pagador→cobrador) de un depósito.
export function parDeposito(d) {
  return {
    company_id: d?.company_id || null,
    clase: d?.clase || 'compra',
    tercero: terceroKey(d?.tercero_ruc, d?.tercero_nombre),
    moneda: d?.moneda || 'PEN',
  };
}

export function mismoPar(a, b) {
  return !!a.company_id && a.company_id === b.company_id
    && a.clase === b.clase
    && !!a.tercero && a.tercero === b.tercero
    && a.moneda === b.moneda;
}

// Saldo disponible de un depósito = monto_total − Σ partes vivas que lo usan.
export function saldoDeposito(deposito, partes) {
  const usado = (partes || [])
    .filter(p => !p.deleted_at && p.deposito_id === deposito.id)
    .reduce((t, p) => t + (Number(p.monto) || 0), 0);
  return (Number(deposito.monto_total) || 0) - usado;
}

// Valida aplicar `monto` del depósito a `movimiento`. Devuelve { ok, error?,
// saldoRestante? }. `partesDeposito` = TODAS las partes existentes (vivas) que
// ya consumen este depósito (de cualquier factura).
export function validarVinculoDeposito({ deposito, partesDeposito, movimiento, monto }) {
  const m = Number(monto);
  if (!(m > 0)) return { ok: false, error: 'El monto a aplicar debe ser mayor a 0' };
  if (!deposito || deposito.deleted_at) return { ok: false, error: 'El depósito ya no existe' };
  if (!mismoPar(parDeposito(deposito), parMovimiento(movimiento))) {
    return {
      ok: false,
      error: 'El depósito no corresponde al mismo pagador → cobrador de esta factura (debe coincidir la empresa, el tercero, la dirección compra/venta y la moneda)',
    };
  }
  const saldo = saldoDeposito(deposito, partesDeposito);
  if (m > saldo + TOL) {
    return {
      ok: false,
      error: `Saldo insuficiente: al depósito de ${(Number(deposito.monto_total) || 0).toFixed(2)} le quedan ${saldo.toFixed(2)} — no se puede aplicar ${m.toFixed(2)} (cubriría más de lo transferido)`,
    };
  }
  return { ok: true, saldoRestante: saldo - m };
}

// ¿El movimiento quedó "bancarizado"? Dos caminos:
//  (a) evidencia de bancarización adjunta directo al movimiento (flujo clásico), o
//  (b) partes que cubren el total y cuyas partes-con-depósito apuntan a un
//      depósito vivo (la constancia vive en el depósito).
export function movimientoBancarizado({ mov, tieneEvidenciaDirecta, partes, depositosById }) {
  if (tieneEvidenciaDirecta) return true;
  const vivas = (partes || []).filter(p => !p.deleted_at);
  if (!vivas.length) return false;
  const suma = vivas.reduce((t, p) => t + (Number(p.monto) || 0), 0);
  if (suma < (Number(mov?.amount) || 0) - TOL) return false;
  return vivas.every(p => !p.deposito_id || !!(depositosById && depositosById.get && depositosById.get(p.deposito_id)));
}
