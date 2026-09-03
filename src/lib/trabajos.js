// ═══════════════════════════════════════════════════════════════════
// JARVEX — Trabajos de bienes y servicios (mig 174).
//
// El flujo corto que pide docs/tanda-1-modelo-de-datos.md §3:
//   BIEN     → cotizo al cliente, compro al proveedor, vendo.
//   SERVICIO → cotizo, presto, facturo.
//
// LA DECISIÓN QUE EXPLICA TODO EL ARCHIVO: la compra y la venta NO tienen
// tablas propias. Son movimientos de `accounting_movements` con `trabajo_id`:
// type 'cost' lo que compré, type 'income' lo que vendí. Por eso el margen se
// CALCULA acá y nunca se guarda — un margen guardado se desactualiza en cuanto
// entra una factura más, y el número viejo es peor que no tener número.
//
// El titular contable sigue siendo `company_id` del movimiento: `trabajo_id` es
// la etiqueta de a qué se imputa, igual que `obra_id`. Este archivo no decide
// contabilidad, solo agrupa.
//
// Puro: sin React, sin Dexie, sin imports.
// ═══════════════════════════════════════════════════════════════════

/** Espejo del CHECK trabajos_tipo_check (mig 174). */
export const TIPOS = [
  { v: 'bien',     label: 'Bien',     desc: 'Se compra y se vende.' },
  { v: 'servicio', label: 'Servicio', desc: 'Lo presta el grupo o una empresa.' },
];

/** Ciclo CORTO propio: no son las etapas de una obra. Espejo del CHECK. */
export const ESTADOS = [
  { v: 'cotizacion', label: 'Cotización', badge: 'b-blue',   abierto: true },
  { v: 'adjudicado', label: 'Adjudicado', badge: 'b-amber',  abierto: true },
  { v: 'ejecucion',  label: 'En curso',   badge: 'b-amber',  abierto: true },
  { v: 'entregado',  label: 'Entregado',  badge: 'b-green',  abierto: true },
  { v: 'cerrado',    label: 'Cerrado',    badge: 'b-gray',   abierto: false },
  { v: 'cancelado',  label: 'Cancelado',  badge: 'b-red',    abierto: false },
];

/** Espejo del CHECK trabajo_cotizaciones_estado_check. */
export const ESTADOS_COTIZACION = [
  { v: 'borrador',  label: 'Borrador',  badge: 'b-gray' },
  { v: 'enviada',   label: 'Enviada',   badge: 'b-blue' },
  { v: 'aceptada',  label: 'Aceptada',  badge: 'b-green' },
  { v: 'rechazada', label: 'Rechazada', badge: 'b-red' },
  { v: 'vencida',   label: 'Vencida',   badge: 'b-yellow' },
];

export const TIPO_LBL   = Object.fromEntries(TIPOS.map(t => [t.v, t.label]));
export const ESTADO_LBL = Object.fromEntries(ESTADOS.map(t => [t.v, t.label]));
export const ESTADO_BADGE = Object.fromEntries(ESTADOS.map(t => [t.v, t.badge]));
export const COT_LBL    = Object.fromEntries(ESTADOS_COTIZACION.map(t => [t.v, t.label]));
export const COT_BADGE  = Object.fromEntries(ESTADOS_COTIZACION.map(t => [t.v, t.badge]));

const vivos = (arr) => (Array.isArray(arr) ? arr.filter(x => x && !x.deleted_at) : []);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function esAbierto(estado) {
  return ESTADOS.find(e => e.v === estado)?.abierto ?? false;
}

/** Cotizaciones de un trabajo, la más reciente primero. */
export function cotizacionesDe(trabajoId, cotizaciones) {
  if (!trabajoId) return [];
  return vivos(cotizaciones)
    .filter(c => c.trabajo_id === trabajoId)
    .slice()
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
}

/** La cotización aceptada, que es el monto que realmente se pactó. */
export function cotizacionAceptada(trabajoId, cotizaciones) {
  return cotizacionesDe(trabajoId, cotizaciones).find(c => c.estado === 'aceptada') || null;
}

/**
 * Compra, venta y margen de un trabajo, leídos de los movimientos contables.
 *
 * UNA MONEDA POR VEZ. Sumar soles con dólares da un número que no significa
 * nada; el mismo criterio que usa el Consolidado. Los movimientos en otra
 * moneda se cuentan aparte para que la pantalla pueda avisar en vez de mentir.
 *
 * Los ANULADOS no cuentan (estado_factura === 'anulada'): una factura anulada
 * que siga sumando al margen es un margen falso.
 */
export function resumenEconomico(trabajoId, movimientos, moneda = 'PEN') {
  const r = { compras: 0, ventas: 0, margen: 0, pct: null, nMovs: 0, otraMoneda: 0 };
  if (!trabajoId) return r;

  for (const m of vivos(movimientos)) {
    if (m.trabajo_id !== trabajoId) continue;
    if (m.estado_factura === 'anulada') continue;
    if ((m.currency || 'PEN') !== moneda) { r.otraMoneda++; continue; }
    const amt = num(m.amount);
    if (m.type === 'income') r.ventas += amt;
    else if (m.type === 'cost' || m.type === 'expense') r.compras += amt;
    else continue;
    r.nMovs++;
  }

  r.compras = Math.round(r.compras * 100) / 100;
  r.ventas  = Math.round(r.ventas * 100) / 100;
  r.margen  = Math.round((r.ventas - r.compras) * 100) / 100;
  // Sin ventas no hay porcentaje: dividir por cero da Infinity y se pinta como
  // un margen espectacular en un trabajo que todavía no vendió nada.
  r.pct = r.ventas > 0 ? Math.round((r.margen / r.ventas) * 1000) / 10 : null;
  return r;
}

/** Totales de una lista de trabajos, para la cabecera de la pantalla. */
export function totales(trabajos, movimientos, moneda = 'PEN') {
  const t = { n: 0, abiertos: 0, compras: 0, ventas: 0, margen: 0 };
  for (const w of vivos(trabajos)) {
    t.n++;
    if (esAbierto(w.estado)) t.abiertos++;
    const r = resumenEconomico(w.id, movimientos, moneda);
    t.compras += r.compras; t.ventas += r.ventas;
  }
  t.compras = Math.round(t.compras * 100) / 100;
  t.ventas  = Math.round(t.ventas * 100) / 100;
  t.margen  = Math.round((t.ventas - t.compras) * 100) / 100;
  return t;
}

/** @returns { ok, errores[] } */
export function validarTrabajo(form) {
  const errores = [];
  if (!String(form?.nombre || '').trim()) errores.push('Falta el nombre del trabajo.');
  if (!TIPO_LBL[form?.tipo]) errores.push('Elegí si es un bien o un servicio.');
  if (!ESTADO_LBL[form?.estado]) errores.push('Estado inválido.');
  if (!form?.ejecutor_company_id && !form?.consorcio_id) {
    errores.push('Falta quién lo vende o lo presta.');
  }
  const monto = form?.monto_estimado;
  if (monto !== '' && monto != null && (!Number.isFinite(Number(monto)) || Number(monto) < 0)) {
    errores.push('El monto estimado no puede ser negativo.');
  }
  if (form?.fecha_inicio && form?.fecha_fin && form.fecha_fin < form.fecha_inicio) {
    errores.push('La fecha de fin no puede ser anterior a la de inicio.');
  }
  return { ok: errores.length === 0, errores };
}

/** Búsqueda por nombre, código, cliente o RUC. */
export function filtrarTrabajos(trabajos, { texto = '', estado = '', tipo = '' } = {}) {
  const q = String(texto || '').trim().toLowerCase();
  return vivos(trabajos).filter(w => {
    if (estado && w.estado !== estado) return false;
    if (tipo && w.tipo !== tipo) return false;
    if (!q) return true;
    return [w.nombre, w.codigo, w.cliente, w.cliente_ruc]
      .some(v => String(v || '').toLowerCase().includes(q));
  });
}
