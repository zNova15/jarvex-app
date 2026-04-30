// ─────────────────────────────────────────────────────────────
//  Libro Diario / Asientos contables — Generador automático
//  Convierte cada accounting_movement en un asiento de partida
//  doble según el Plan Contable General Empresarial (PCGE) Perú.
//
//  No persiste en DB — es una vista derivada. Funciones puras.
// ─────────────────────────────────────────────────────────────

const IGV_RATE = 0.18;

function r2(n) {
  const v = Number(n);
  if (!isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function fmtS(n) {
  return 'S/ ' + Number(n || 0).toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(d) {
  if (!d) return '';
  try {
    const date = (d instanceof Date) ? d : new Date(d);
    if (isNaN(date.getTime())) return String(d);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  } catch (_) {
    return String(d);
  }
}

// ─── Mapeos PCGE ─────────────────────────────────────────────

/**
 * Devuelve el código de cuenta de gasto según category.
 * - materiales/insumos → 60 (Compras)
 * - servicios/subcontrato/alquiler → 63 (Servicios prestados por terceros)
 * - planilla/sueldos/personal → 62 (Gastos de personal)
 * - tributos/impuestos → 64 (Gastos por tributos)
 * - financiero/intereses → 67 (Gastos financieros)
 * - default → 65 (Otros gastos de gestión)
 */
export function mapTypeToCategoria(type, category) {
  const cat = String(category || '').toLowerCase().trim();

  // Ingresos: 70 ventas / 704 servicios / 75 otros
  if (type === 'income') {
    if (/(servicio|consultoria|asesoria|alquiler|maquinaria)/.test(cat)) return '704';
    if (/(otro|diverso|financ)/.test(cat)) return '75';
    return '70';
  }

  // Costos directos de obra → 60 (compras) por defecto, salvo subcontrato
  if (type === 'cost') {
    if (/(material|insumo|suministro|repuesto|mercader)/.test(cat)) return '60';
    if (/(subcontrato|servicio|alquiler|flete|transporte|maquinaria)/.test(cat)) return '63';
    if (/(planilla|sueldo|salario|remunera|personal|mano)/.test(cat)) return '62';
    return '60';
  }

  // Gastos
  if (type === 'expense') {
    if (/(material|insumo|suministro|util)/.test(cat)) return '60';
    if (/(servicio|consultoria|asesoria|alquiler|flete|transporte|luz|agua|internet|telefon)/.test(cat)) return '63';
    if (/(planilla|sueldo|salario|remunera|personal|mano)/.test(cat)) return '62';
    if (/(tributo|impuesto|sunat|arbitrio|predial)/.test(cat)) return '64';
    if (/(intere|financ|comision|banc)/.test(cat)) return '67';
    return '65';
  }

  return '65';
}

/**
 * Caja vs Bancos según método de pago.
 * - efectivo / caja → 101 (Caja)
 * - transferencia / banco / yape / plin → 104 (Cuentas corrientes)
 * - default → 10 (Efectivo y equivalentes — cuenta padre)
 */
export function cuentaCajaOBanco(payment_method) {
  const pm = String(payment_method || '').toLowerCase().trim();
  if (/(efectivo|caja|cash)/.test(pm)) return '101';
  if (/(transfer|banco|yape|plin|deposito|cheque|tarjeta|visa|mastercard)/.test(pm)) return '104';
  return '10';
}

/**
 * Calcula subtotal e IGV faltantes.
 * Si vienen ambos campos, se respetan. Si solo uno, se infiere.
 * Si no viene ninguno, se asume amount = subtotal * 1.18.
 */
function resolveMontos(mov) {
  const total = r2(Number(mov.amount || 0));
  let subtotal = mov.subtotal != null ? Number(mov.subtotal) : null;
  let igv = mov.igv_amount != null ? Number(mov.igv_amount) : null;

  if (subtotal == null && igv == null) {
    subtotal = r2(total / (1 + IGV_RATE));
    igv = r2(total - subtotal);
  } else if (subtotal == null) {
    subtotal = r2(total - igv);
  } else if (igv == null) {
    igv = r2(total - subtotal);
  } else {
    subtotal = r2(subtotal);
    igv = r2(igv);
  }

  return { total, subtotal, igv };
}

// ─── Generador principal ─────────────────────────────────────

/**
 * Genera el asiento contable para un movimiento.
 * @param {object} movimiento accounting_movements row
 * @returns {{numero:string, fecha:string, glosa:string, type:string, partidas:Array}}
 */
export function generarAsiento(movimiento) {
  const m = movimiento || {};
  const { total, subtotal, igv } = resolveMontos(m);
  const tipo = m.type || 'expense';
  const pagado = m.payment_status === 'paid';
  const cuentaCaja = cuentaCajaOBanco(m.payment_method);
  const partidas = [];
  const desc = String(m.description || '').trim() || '(sin descripción)';
  const docRef = m.documento || m.doc_numero || m.factura || '';

  if (tipo === 'income') {
    // ─── Ingreso (venta) ─────────────────────────────────
    if (pagado) {
      partidas.push({
        cuenta: cuentaCaja,
        descripcion: `Cobro de ${desc}`,
        debe: total,
        haber: 0,
      });
    } else {
      partidas.push({
        cuenta: '121',
        descripcion: `Factura por cobrar — ${desc}`,
        debe: total,
        haber: 0,
      });
    }
    const cuentaIngreso = mapTypeToCategoria('income', m.category);
    partidas.push({
      cuenta: cuentaIngreso,
      descripcion: desc,
      debe: 0,
      haber: subtotal,
    });
    if (igv > 0) {
      partidas.push({
        cuenta: '4011',
        descripcion: 'IGV ventas',
        debe: 0,
        haber: igv,
      });
    }
  } else {
    // ─── Costo / Gasto ───────────────────────────────────
    const cuentaGasto = mapTypeToCategoria(tipo, m.category);
    const esPlanilla = cuentaGasto === '62';

    partidas.push({
      cuenta: cuentaGasto,
      descripcion: desc,
      debe: subtotal,
      haber: 0,
    });
    if (igv > 0 && !esPlanilla) {
      partidas.push({
        cuenta: '4011',
        descripcion: 'IGV crédito fiscal',
        debe: igv,
        haber: 0,
      });
    } else if (esPlanilla && igv > 0) {
      // Planilla no tiene IGV; el "igv" inferido se suma al gasto
      partidas[0].debe = r2(partidas[0].debe + igv);
    }

    if (pagado) {
      partidas.push({
        cuenta: cuentaCaja,
        descripcion: `Pago de ${desc}`,
        debe: 0,
        haber: total,
      });
    } else {
      // Pendiente: planilla → 41, resto → 42
      partidas.push({
        cuenta: esPlanilla ? '41' : '42',
        descripcion: esPlanilla
          ? `Remuneraciones por pagar — ${desc}`
          : `Cuenta por pagar — ${desc}`,
        debe: 0,
        haber: total,
      });
    }
  }

  // Cuadre por redondeo: ajusta la última partida si es necesario
  const sumDebe = partidas.reduce((s, p) => s + p.debe, 0);
  const sumHaber = partidas.reduce((s, p) => s + p.haber, 0);
  const diff = r2(sumDebe - sumHaber);
  if (Math.abs(diff) > 0 && Math.abs(diff) < 0.05) {
    const last = partidas[partidas.length - 1];
    if (last.haber > 0) last.haber = r2(last.haber + diff);
    else last.debe = r2(last.debe - diff);
  }

  const numero = m.id ? String(m.id).slice(0, 8).toUpperCase() : '—';
  const fecha = m.date || m.created_at || '';

  return {
    numero,
    fecha,
    glosa: docRef ? `${desc} (${docRef})` : desc,
    type: tipo,
    movimiento_id: m.id,
    partidas: partidas.map(p => ({
      cuenta: p.cuenta,
      descripcion: p.descripcion,
      debe: r2(p.debe),
      haber: r2(p.haber),
    })),
  };
}

/**
 * Procesa un array de movimientos y devuelve sus asientos.
 * Filtra registros eliminados (deleted_at) y anulados (cancelled).
 */
export function generarAsientosBatch(movimientos) {
  const arr = Array.isArray(movimientos) ? movimientos : [];
  return arr
    .filter(m => m && !m.deleted_at && m.payment_status !== 'cancelled')
    .map(generarAsiento)
    .sort((a, b) => {
      const da = new Date(a.fecha).getTime() || 0;
      const db = new Date(b.fecha).getTime() || 0;
      return da - db;
    });
}

/**
 * Vista de texto de un asiento — útil para preview / debug.
 */
export function formatAsientoTxt(asiento) {
  if (!asiento) return '';
  const lines = [];
  lines.push(`Asiento N° ${asiento.numero}    Fecha: ${fmtDate(asiento.fecha)}`);
  lines.push(`Glosa: ${asiento.glosa}`);
  lines.push('─'.repeat(72));
  lines.push('Cuenta  Descripción                              Debe         Haber');
  lines.push('─'.repeat(72));
  let sd = 0, sh = 0;
  asiento.partidas.forEach(p => {
    const cta = String(p.cuenta).padEnd(7);
    const desc = String(p.descripcion).slice(0, 38).padEnd(40);
    const debe = p.debe > 0 ? fmtS(p.debe).padStart(12) : ''.padStart(12);
    const haber = p.haber > 0 ? fmtS(p.haber).padStart(12) : ''.padStart(12);
    lines.push(`${cta} ${desc} ${debe} ${haber}`);
    sd += p.debe; sh += p.haber;
  });
  lines.push('─'.repeat(72));
  lines.push(`TOTALES:                                          ${fmtS(sd).padStart(12)} ${fmtS(sh).padStart(12)}`);
  return lines.join('\n');
}

export default {
  generarAsiento,
  generarAsientosBatch,
  formatAsientoTxt,
  mapTypeToCategoria,
  cuentaCajaOBanco,
};
