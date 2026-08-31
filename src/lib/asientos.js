// ─────────────────────────────────────────────────────────────
//  Libro Diario / Asientos contables — Generador automático
//  Convierte cada accounting_movement en un asiento de partida
//  doble según el Plan Contable General Empresarial (PCGE) Perú.
//
//  No persiste en DB — es una vista derivada. Funciones puras.
// ─────────────────────────────────────────────────────────────

import { desglosarIgv, describirIgv } from './igv-desglose.js';
import { fmtFechaLarga } from './fecha.js';

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

// Ojo: NO usar new Date('YYYY-MM-DD') — en Perú (UTC−5) devuelve el día
// anterior. fmtFechaLarga parte el string cuando es una fecha de día suelta.
const fmtDate = fmtFechaLarga;

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

// El desglose base/IGV sale de `src/lib/igv-desglose.js`: usa el IGV REAL del
// comprobante (Captura Mágica lo guarda en el JSON de `notas`) y solo estima
// al 18 % cuando el movimiento no trae ninguno. Antes se inventaba SIEMPRE el
// 18 % y la repartición 70/4011 no era la de la factura (hallazgo de las
// contadoras 31-ago: E001-263 con IGV real de S/9 asentaba S/474.25).

// ─── Generador principal ─────────────────────────────────────

/**
 * Genera el asiento contable para un movimiento.
 * @param {object} movimiento accounting_movements row
 * @returns {{numero:string, fecha:string, glosa:string, type:string, partidas:Array,
 *            sumDebe:number, sumHaber:number, delta:number, cuadra:boolean, extorno:boolean}}
 */
export function generarAsiento(movimiento) {
  const m = movimiento || {};
  const totalCrudo = r2(Number(m.amount || 0));

  // ── NOTA DE CRÉDITO / monto NEGATIVO → asiento de EXTORNO ──────────
  // Captura Mágica guarda las NC con amount negativo. Antes, el IGV inferido
  // salía negativo y el `if (igv > 0)` OMITÍA la línea 4011 → el asiento
  // descuadraba exactamente en el IGV (bug real: Δ S/474.25 de GASOMI 2026,
  // NC E001-64; aprobado el fix por Gabriel 31-ago). Forma ortodoxa: montos
  // POSITIVOS con debe↔haber invertidos. La contrapartida es SIEMPRE la
  // cuenta por cobrar/pagar (121/42/41) y NUNCA caja: Captura Mágica fuerza
  // payment_status='paid' en toda NC pero no hubo devolución de efectivo.
  if (totalCrudo < 0) {
    const base = construirAsiento({
      ...m,
      amount: Math.abs(Number(m.amount || 0)),
      subtotal: m.subtotal != null ? Math.abs(Number(m.subtotal)) : m.subtotal,
      igv_amount: m.igv_amount != null ? Math.abs(Number(m.igv_amount)) : m.igv_amount,
      payment_status: 'pending',
    });
    const REN = [
      ['Cobro de ', 'Extorno cobro — '],
      ['Factura por cobrar — ', 'Extorno cta. por cobrar — '],
      ['Cuenta por pagar — ', 'Extorno cta. por pagar — '],
      ['Remuneraciones por pagar — ', 'Extorno remuneraciones — '],
      ['Pago de ', 'Extorno pago — '],
      ['IGV ventas', 'Extorno IGV ventas'],
      ['IGV crédito fiscal', 'Extorno IGV crédito fiscal'],
    ];
    const renombrar = (d) => {
      for (const [de, a] of REN) if (String(d).startsWith(de)) return a + String(d).slice(de.length);
      return d;
    };
    return finalizarAsiento({
      ...base,
      extorno: true,
      partidas: base.partidas.map(p => ({ ...p, debe: p.haber, haber: p.debe, descripcion: renombrar(p.descripcion) })),
    });
  }

  return finalizarAsiento(construirAsiento(m));
}

// Suma final + campos de cuadre POR ASIENTO (herramienta de descuadre,
// pedido de las contadoras 31-ago): delta = debe − haber del propio asiento.
function finalizarAsiento(asiento) {
  const partidas = asiento.partidas.map(p => ({
    cuenta: p.cuenta,
    descripcion: p.descripcion,
    debe: r2(p.debe),
    haber: r2(p.haber),
  }));
  const sumDebe = r2(partidas.reduce((s, p) => s + p.debe, 0));
  const sumHaber = r2(partidas.reduce((s, p) => s + p.haber, 0));
  const delta = r2(sumDebe - sumHaber);
  return {
    ...asiento,
    partidas,
    sumDebe,
    sumHaber,
    delta,
    cuadra: Math.abs(delta) < 0.01,
    extorno: asiento.extorno === true,
    // Desglose base/IGV usado (con su origen: 'comprobante' | 'estimado' |
    // 'no_gravado'). El Libro Diario lo muestra cuando la tasa no es el 18 %
    // general o cuando tuvo que estimarse.
    desglose: asiento.desglose || null,
  };
}

function construirAsiento(movimiento) {
  const m = movimiento || {};
  const desglose = desglosarIgv(m);
  const { total, subtotal, igv } = desglose;
  // Sufijo de la línea 4011: deja ver en el propio asiento (y en el PDF/Excel)
  // si el IGV salió del comprobante y a qué tasa, o si hubo que estimarlo.
  const igvNota = ` (${describirIgv(desglose)})`;
  // Parte del total que no paga IGV (exonerado / inafecto / ICBPER): va en la
  // MISMA cuenta 60/63/70 que la base gravada (así lo manda el PCGE), pero se
  // deja dicho en la glosa de la línea para que la contadora no lo busque.
  const noGravNota = Math.abs(desglose.noGravado || 0) > 0.005
    ? ` — incluye ${fmtS(Math.abs(desglose.noGravado))} no gravado`
    : '';
  const tipo = m.type || 'expense';
  const pagado = m.payment_status === 'paid';
  // Columna real: metodo_pago (payment_method no existe en la tabla — antes
  // TODO caía a la cuenta genérica '10' por leer el campo equivocado).
  const cuentaCaja = cuentaCajaOBanco(m.metodo_pago || m.payment_method);
  const partidas = [];
  const desc = String(m.description || '').trim() || '(sin descripción)';
  // Columna real: document_number (documento/doc_numero/factura no existen —
  // la glosa nunca mostraba el número del comprobante).
  const docRef = m.document_number || m.documento || m.doc_numero || m.factura || '';

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
    // Si el usuario eligió una cuenta PCGE explícita, úsala; si no, infiere de category
    const cuentaIngreso = m.cuenta_pcge || mapTypeToCategoria('income', m.category);
    partidas.push({
      cuenta: cuentaIngreso,
      descripcion: desc + noGravNota,
      debe: 0,
      haber: subtotal,
    });
    if (igv > 0) {
      partidas.push({
        cuenta: '4011',
        descripcion: 'IGV ventas' + igvNota,
        debe: 0,
        haber: igv,
      });
    }
  } else {
    // ─── Costo / Gasto ───────────────────────────────────
    const cuentaGasto = m.cuenta_pcge || mapTypeToCategoria(tipo, m.category);
    const esPlanilla = cuentaGasto === '62';

    partidas.push({
      cuenta: cuentaGasto,
      descripcion: desc + noGravNota,
      debe: subtotal,
      haber: 0,
    });
    if (igv > 0 && !esPlanilla) {
      partidas.push({
        cuenta: '4011',
        descripcion: 'IGV crédito fiscal' + igvNota,
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
    desglose,
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
 * Explica en lenguaje de contadora POR QUÉ un asiento no cuadra.
 * Devuelve null si el asiento cuadra. La herramienta de descuadre del Libro
 * Diario la muestra en la fila del asiento marcado (pedido 31-ago).
 */
export function explicarDescuadre(asiento, movimiento) {
  if (!asiento || asiento.cuadra) return null;
  const m = movimiento || {};
  const d = fmtS(Math.abs(asiento.delta));
  const lado = asiento.delta > 0 ? 'el DEBE excede al HABER' : 'el HABER excede al DEBE';
  const doc = m.document_number ? ` (${m.document_type || 'doc'} ${m.document_number})` : '';

  // Solo si el asiento NO salió como extorno: un extorno descuadrado viene de
  // DATOS inconsistentes (rama de base+IGV, abajo), no de una versión vieja.
  if (Number(m.amount) < 0 && !asiento.extorno) {
    return `Este movimiento${doc} tiene monto NEGATIVO (${fmtS(m.amount)}) — normalmente una nota de crédito. ` +
      `El generador debería asentarlo como extorno; si ves este aviso, recargá la app (versión vieja en caché). Δ ${d}: ${lado}.`;
  }
  // Desde el fix del desglose real (31-ago) la base se calcula como
  // total − IGV del comprobante, así que un asiento NO debería descuadrar
  // nunca por ahí. Si igual descuadra, el dato de origen está roto.
  const dg = asiento.desglose;
  if (dg) {
    return `Las líneas de este asiento no suman igual: ${lado} por ${d}. ` +
      `Se asentó base ${fmtS(Math.abs(dg.subtotal))} + IGV ${fmtS(Math.abs(dg.igv))} ` +
      `(${dg.origen === 'estimado' ? 'IGV estimado al 18 %: el comprobante no trae desglose' : 'IGV tomado del comprobante'}) ` +
      `sobre un total de ${fmtS(Math.abs(dg.total))}. Revisá el monto del movimiento${doc}.`;
  }
  return `Las líneas de este asiento no suman igual: ${lado} por ${d}. ` +
    `Revisá el movimiento origen${doc} — monto, base imponible e IGV.`;
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
  explicarDescuadre,
  mapTypeToCategoria,
  cuentaCajaOBanco,
};
