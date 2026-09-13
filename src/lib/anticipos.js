// ═══════════════════════════════════════════════════════════════════
// JARVEX — ANTICIPOS A PROVEEDORES (mig 207). Lib PURA.
//
// ── QUÉ RESUELVE ──────────────────────────────────────────────────
// Gabriel: «en el inventario de las empresas puede ocurrir que tenemos
// anticipos. Estos hay que ubicarlos y vincularlos con la factura que anticipan
// su pago. […] No olvides que los anticipos deberían identificarse.»
//
// Un anticipo es plata que YA salió y mercadería que todavía NO llegó: un
// activo exigible contra el proveedor. Hasta hoy la app lo detectaba como tipo
// de línea (`clasificarLineaPorTexto` en inventario-empresa.js lo marca
// 'anticipo' y la ficha le pone su badge morado) pero no lo administraba: no
// había forma de decir cuánta mercadería llegó contra él ni cuánto queda a
// favor.
//
// ── EL CASO MEDIDO (13-set-2026): KOPLAST CONTRA GASOMI ───────────
// · US$ 150.000 (S/ 524.250) en dos facturas del 31-mar con un solo ítem,
//   «ANTICIPO DE CLIENTE».
// · Cuatro notas de crédito del 6-may anulan cuatro facturas completas por
//   US$ 54.874,04: eso es anticipo consumido, y es lo que esta lib propone
//   sola.
// · 19 facturas más con TOTAL 0 —las entregas ya descontadas del anticipo, que
//   es lo que Gabriel vio— que en JARVEX NO ESTÁN CARGADAS. Sin ellas el saldo
//   no se puede cerrar, y la pantalla tiene que decirlo en vez de mostrar un
//   número que parece completo y no lo es.
//
// El mecanismo en sí NO es una jugada del proveedor: facturar el anticipo con
// IGV y descontarlo después en las entregas es la forma estándar en el Perú, y
// el crédito fiscal ya se tomó. El riesgo es de DATOS.
//
// ── LA MONEDA NO SE CONVIERTE NUNCA ───────────────────────────────
// El saldo de un anticipo en dólares se dice en dólares. Convertirlo a soles
// para «poder sumar» es exactamente el error que hacía que el cotejo SUNAT
// acusara S/ 199.600 de diferencia inexistente. Cada anticipo lleva su moneda
// y las aplicaciones se guardan en la moneda del anticipo.
//
// Puro: sin React, sin Dexie, sin fetch.
// ═══════════════════════════════════════════════════════════════════

import { clasificarLineaPorTexto } from './inventario-empresa.js';
import { esVentaMov } from './costo-obra.js';
import { esNotaCredito, notasPorFactura } from './notas-credito.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const abs = (n) => Math.abs(Number(n) || 0);
const rucLimpio = (x) => String(x ?? '').replace(/\D/g, '');
const vivos = (arr) => (Array.isArray(arr) ? arr.filter(x => x && !x.deleted_at) : []);

/** Cuánto puede desviarse un importe antes de ser otra cosa. */
const TOLERANCIA = 0.05;

/** Los ítems de factura de un movimiento, con `notas` que puede venir como
 *  texto (es una columna `text` con JSON adentro). */
function itemsDe(mov) {
  let n = mov?.notas;
  if (typeof n === 'string') { try { n = JSON.parse(n); } catch { return []; } }
  return Array.isArray(n?.items_factura) ? n.items_factura : [];
}

/**
 * ¿Este movimiento ES un anticipo a un proveedor?
 *
 * Se mira el TEXTO de sus ítems con el mismo clasificador que ya usa el
 * inventario (`clasificarLineaPorTexto`), no el `tipo_insumo` que puso la IA:
 * medido, la factura de anticipo de KOPLAST tiene `tipo_insumo: 'material'` y
 * su descripción dice «ANTICIPO DE CLIENTE». El texto manda.
 *
 * Solo COMPRAS: un anticipo recibido de un cliente es lo contrario —un pasivo—
 * y no se administra en esta pantalla.
 */
export function esMovimientoAnticipo(mov) {
  if (!mov || mov.deleted_at) return false;
  if (esVentaMov(mov)) return false;
  if (esNotaCredito(mov)) return false;
  if (mov.payment_status === 'cancelled') return false;
  const items = itemsDe(mov);
  if (!items.length) {
    // Sin detalle, la descripción del movimiento es lo único que hay.
    return clasificarLineaPorTexto(mov.description) === 'anticipo';
  }
  return items.some(it => clasificarLineaPorTexto(it?.descripcion) === 'anticipo');
}

/**
 * Los anticipos de una empresa (o de todo el grupo), ordenados por plata.
 *
 * `monto` es el TOTAL del comprobante, no la suma de los ítems: es lo que
 * efectivamente salió, con su IGV, y es contra eso que hay que ver llegar la
 * mercadería.
 */
export function detectarAnticipos(movimientos, { companyId = null, demo = false } = {}) {
  return vivos(movimientos)
    .filter(m => !!m.demo === !!demo)
    .filter(m => !companyId || m.company_id === companyId)
    .filter(esMovimientoAnticipo)
    .map(m => ({
      id: m.id,
      companyId: m.company_id || null,
      fecha: m.date || '',
      documento: m.document_number || '',
      proveedorRuc: rucLimpio(m.third_party_ruc),
      proveedorNombre: m.third_party_name || '(sin proveedor)',
      moneda: String(m.currency || 'PEN').trim().toUpperCase(),
      monto: r2(abs(m.amount)),
      descripcion: (itemsDe(m)[0]?.descripcion) || m.description || '',
    }))
    .sort((a, b) => b.monto - a.monto || String(a.fecha).localeCompare(String(b.fecha)));
}

/**
 * Una aplicación viva por par (anticipo, factura).
 *
 * Sin UNIQUE en la tabla (mig 207, por lo de siempre: dos PCs offline), así
 * que el duplicado benigno se resuelve al leer: 'manual' pisa a 'propuesta' y,
 * a igual fuente, gana la más reciente.
 */
export function resolverAplicaciones(filas, { demo = false } = {}) {
  const porPar = new Map();
  const rango = (r) => (r?.fuente === 'manual' ? 2 : 1);
  for (const r of vivos(filas)) {
    if (!!r.demo !== !!demo) continue;
    const k = `${r.anticipo_movimiento_id}|${r.factura_movimiento_id}`;
    const prev = porPar.get(k);
    if (!prev) { porPar.set(k, r); continue; }
    const mejor = rango(r) !== rango(prev)
      ? (rango(r) > rango(prev) ? r : prev)
      : (String(r.updated_at || '') >= String(prev.updated_at || '') ? r : prev);
    porPar.set(k, mejor);
  }
  return [...porPar.values()];
}

/**
 * El saldo de un anticipo: lo que se pagó menos lo que ya llegó.
 *
 * `aplicado` sale solo de las aplicaciones en la MISMA moneda del anticipo.
 * Una aplicación en otra moneda sería un dato mal cargado y sumarla mentiría;
 * se cuenta aparte para poder avisarlo.
 */
export function saldoDeAnticipo(anticipo, aplicaciones) {
  const mias = (aplicaciones || []).filter(a => a.anticipo_movimiento_id === anticipo.id);
  let aplicado = 0;
  let enOtraMoneda = 0;
  for (const a of mias) {
    const m = String(a.moneda || 'PEN').trim().toUpperCase();
    if (m === anticipo.moneda) aplicado += Number(a.monto) || 0;
    else enOtraMoneda += 1;
  }
  const saldo = r2(anticipo.monto - aplicado);
  return {
    aplicado: r2(aplicado),
    saldo,
    enOtraMoneda,
    aplicaciones: mias,
    // «Cerrado» con tolerancia: un centavo de diferencia por redondeo del IGV
    // no puede dejar un anticipo abierto para siempre.
    cerrado: Math.abs(saldo) <= TOLERANCIA,
    // Aplicar MÁS de lo que se anticipó es un error de carga, no un saldo
    // negativo legítimo: se dice.
    excedido: saldo < -TOLERANCIA,
    pct: anticipo.monto > 0 ? Math.min(100, (aplicado * 100) / anticipo.monto) : 0,
  };
}

/**
 * Las facturas del mismo proveedor y empresa que PODRÍAN estar cubiertas por
 * este anticipo: mismo RUC, misma moneda, fecha igual o posterior, y que no
 * sean el anticipo mismo ni una nota.
 *
 * Ordenadas por fecha: el anticipo se consume en el orden en que llega la
 * mercadería.
 */
export function facturasCandidatas(anticipo, movimientos, { demo = false } = {}) {
  return vivos(movimientos)
    .filter(m => !!m.demo === !!demo)
    .filter(m => m.id !== anticipo.id)
    .filter(m => (m.company_id || null) === anticipo.companyId)
    .filter(m => !esVentaMov(m) && !esNotaCredito(m))
    .filter(m => rucLimpio(m.third_party_ruc) === anticipo.proveedorRuc)
    .filter(m => String(m.currency || 'PEN').trim().toUpperCase() === anticipo.moneda)
    .filter(m => !esMovimientoAnticipo(m))
    .filter(m => !anticipo.fecha || String(m.date || '') >= anticipo.fecha)
    .map(m => ({
      id: m.id,
      fecha: m.date || '',
      documento: m.document_number || '',
      monto: r2(abs(m.amount)),
      moneda: String(m.currency || 'PEN').trim().toUpperCase(),
      enCero: abs(m.amount) <= TOLERANCIA,
    }))
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
}

/**
 * Lo que la app propone aplicar, con el motivo a la vista.
 *
 * DOS SEÑALES, las dos medidas contra KOPLAST:
 *
 * 1. UNA NOTA DE CRÉDITO ANULÓ LA FACTURA COMPLETA. Es la señal más fuerte que
 *    hay: la factura se emitió a precio, se anuló entera, y la mercadería se
 *    entregó igual. Eso es anticipo consumido por el importe de la factura.
 *    Son los US$ 54.874,04 de FC03-187/188/189/190.
 *
 * 2. LA FACTURA VINO EN CERO. Es la forma en que el proveedor documenta una
 *    entrega ya cubierta por el anticipo. NO se puede saber por cuánto sin
 *    abrir el PDF —el total es 0 justamente porque el descuento ya se aplicó—
 *    así que se propone con monto 0 y se pide el importe: proponer un número
 *    inventado sería peor que no proponer nada.
 *
 * Nunca propone sobre una factura que YA tiene aplicación: lo decidido manda.
 */
export function proponerAplicaciones(anticipo, movimientos, aplicacionesVivas, { demo = false } = {}) {
  const yaAplicadas = new Set(
    (aplicacionesVivas || [])
      .filter(a => a.anticipo_movimiento_id === anticipo.id)
      .map(a => a.factura_movimiento_id),
  );
  const candidatas = facturasCandidatas(anticipo, movimientos, { demo });
  const porNota = notasPorFactura(movimientos);
  const propuestas = [];
  let restante = anticipo.monto;

  for (const c of candidatas) {
    if (yaAplicadas.has(c.id)) continue;
    if (restante <= TOLERANCIA) break;

    const info = porNota.get(c.id);
    if (info?.anulada) {
      const monto = Math.min(c.monto, r2(restante));
      if (monto > TOLERANCIA) {
        propuestas.push({
          facturaId: c.id, documento: c.documento, fecha: c.fecha,
          monto: r2(monto), moneda: anticipo.moneda,
          motivo: `Una nota de crédito anuló ${c.documento} por completo: la mercadería llegó y el anticipo la cubrió.`,
        });
        restante = r2(restante - monto);
      }
      continue;
    }

    if (c.enCero) {
      propuestas.push({
        facturaId: c.id, documento: c.documento, fecha: c.fecha,
        monto: 0, moneda: anticipo.moneda,
        motivo: `${c.documento} vino en CERO: es una entrega ya descontada del anticipo. El importe está en el PDF — escribilo.`,
        pideMonto: true,
      });
    }
  }
  return propuestas;
}

/**
 * El panel entero: cada anticipo con su saldo, sus aplicaciones y lo que se
 * propone.
 */
export function panelAnticipos(movimientos, aplicacionesFilas, { companyId = null, demo = false } = {}) {
  const anticipos = detectarAnticipos(movimientos, { companyId, demo });
  const aplicaciones = resolverAplicaciones(aplicacionesFilas, { demo });
  const porDoc = new Map(vivos(movimientos).map(m => [m.id, m]));

  const filas = anticipos.map(a => {
    const s = saldoDeAnticipo(a, aplicaciones);
    return {
      ...a,
      ...s,
      aplicaciones: s.aplicaciones.map(ap => ({
        ...ap,
        facturaDocumento: porDoc.get(ap.factura_movimiento_id)?.document_number || '(comprobante no cargado)',
        facturaFecha: porDoc.get(ap.factura_movimiento_id)?.date || '',
      })),
      propuestas: proponerAplicaciones(a, movimientos, aplicaciones, { demo }),
    };
  });

  // Los totales NO se suman entre monedas: un anticipo en dólares y uno en
  // soles no se agregan en un solo número. Se agrupan por moneda, como en todo
  // el resto del inventario.
  const porMoneda = new Map();
  for (const f of filas) {
    const cur = porMoneda.get(f.moneda) || { moneda: f.moneda, anticipado: 0, aplicado: 0, saldo: 0, n: 0 };
    cur.anticipado = r2(cur.anticipado + f.monto);
    cur.aplicado = r2(cur.aplicado + f.aplicado);
    cur.saldo = r2(cur.saldo + f.saldo);
    cur.n += 1;
    porMoneda.set(f.moneda, cur);
  }

  return {
    filas,
    totales: [...porMoneda.values()].sort((a, b) => b.saldo - a.saldo),
    abiertos: filas.filter(f => !f.cerrado).length,
  };
}

/** El cuerpo de una fila de `anticipo_aplicaciones`. */
export function aplicacionNueva(anticipo, { facturaId, monto, motivo = null, fuente = 'manual', nota = null } = {}) {
  if (!anticipo?.id) throw new Error('aplicacionNueva: falta el anticipo.');
  if (!facturaId) throw new Error('aplicacionNueva: falta la factura a la que se aplica.');
  if (facturaId === anticipo.id) throw new Error('aplicacionNueva: un anticipo no se aplica a sí mismo.');
  return {
    anticipo_movimiento_id: anticipo.id,
    factura_movimiento_id: facturaId,
    company_id: anticipo.companyId || null,
    monto: r2(monto),
    moneda: anticipo.moneda,
    fuente,
    motivo,
    nota,
    deleted_at: null,
  };
}
