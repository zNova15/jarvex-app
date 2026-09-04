// ═══════════════════════════════════════════════════════════════════
// JARVEX — ÓRDENES DE COMPRA Y DE SERVICIO (tanda 5).
//
// Gabriel, 4-sep-2026: «no encuentro las órdenes de compra ni las de
// servicio, y las necesito para respaldar las compras de la obra actual».
//
// LO QUE ESTE ARCHIVO DECIDE (y por qué está separado de la pantalla):
//
//  · EL CORRELATIVO. En el modelo que dejó (Modelos/ordenes.xlsx) la
//    numeración es `OC-027-2026` y es POR EMPRESA: el CONSORCIO EL INCA va
//    por la 27 mientras JARVEX recién arranca la 001. Ocho empresas propias
//    emitiendo a la vez es exactamente donde un correlativo mal calculado
//    duplica números — y un número repetido en un documento que va a SUNAT
//    no se arregla después.
//
//  · QUÉ COMPROBANTE NECESITA RESPALDO. Con el umbral de S/ 2.000 que
//    propuso Gabriel, sobre lo cargado en soles: 200 de 1.205 compras (el
//    17% de los papeles) cubren S/ 3,91 M (el 97% del dinero), y 97 de 120
//    ventas cubren el 99,9%. El umbral está bien elegido y por eso es
//    configurable, no hardcodeado (app_config `orden_umbral_monto`).
//
//  · LOS TOTALES. Valor de venta → IGV → importe total, con el IGV como
//    porcentaje guardado en la orden. Las órdenes retroactivas nacen de un
//    comprobante cuyo `amount` YA es el total con IGV: si se recalculara
//    hacia arriba, la orden diría S/ 24.985 donde la factura dice S/ 21.174.
//    Por eso hay dos funciones y no una: `totalesDesdeItems` (armo la orden
//    desde cero) y `totalesDesdeTotal` (la orden respalda un total que ya
//    existe y no se toca).
//
// Puro: sin React, sin Dexie, sin imports. Testeado en __tests__/ordenes.test.js
// ═══════════════════════════════════════════════════════════════════

export const TIPOS_ORDEN = ['compra', 'servicio'];

export const TIPO_ORDEN_LABEL = {
  compra: 'Orden de Compra',
  servicio: 'Orden de Servicio',
};

// Las etiquetas que CAMBIAN entre una hoja y la otra del modelo. Es la única
// diferencia real entre los dos documentos: mismo cuerpo, distinto rótulo.
export const TIPO_ORDEN_TEXTOS = {
  compra: {
    titulo: 'ORDEN DE COMPRA',
    prefijo: 'OC',
    detalle: 'DETALLE DE LA COMPRA',
    columnaDescripcion: 'Descripción',
    total: 'IMPORTE TOTAL DE LA COMPRA',
    unidadPorDefecto: 'UND',
  },
  servicio: {
    titulo: 'ORDEN DE SERVICIO',
    prefijo: 'OS',
    detalle: 'DETALLE DEL SERVICIO',
    columnaDescripcion: 'Descripción del servicio',
    total: 'IMPORTE TOTAL DEL SERVICIO',
    unidadPorDefecto: 'SERV',
  },
};

export function textosDeTipo(tipo) {
  return TIPO_ORDEN_TEXTOS[tipo] || TIPO_ORDEN_TEXTOS.compra;
}

const IGV_POR_DEFECTO = 18;
export const UMBRAL_POR_DEFECTO = 2000;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

// ── EL CORRELATIVO ─────────────────────────────────────────────────

/**
 * El prefijo de documento de una empresa para un tipo de orden.
 * `companies.codigo_doc_prefix` existe desde antes y estaba sin usar; si una
 * empresa lo tiene («EI», «JVX»), el código sale `EI-OC-001-2026`. Si no,
 * queda el del modelo: `OC-001-2026`.
 */
export function prefijoDeOrden(company, tipo) {
  const base = textosDeTipo(tipo).prefijo;
  const p = (company?.codigo_doc_prefix || '').trim();
  return p ? `${p}-${base}` : base;
}

/**
 * El siguiente correlativo libre para (empresa, tipo, año).
 *
 * Cuenta sobre las órdenes YA existentes en vez de sobre la cantidad de
 * filas: si la 003 se anuló, el número 003 sigue gastado — reusarlo daría
 * dos documentos distintos con el mismo número. Por eso las anuladas TAMBIÉN
 * cuentan, y por eso se toma el máximo y no el largo de la lista.
 */
export function siguienteCorrelativo(ordenes, { companyId, tipo = 'compra', anio } = {}) {
  const year = anio || new Date().getFullYear();
  let max = 0;
  for (const o of ordenes || []) {
    if (!o || o.deleted_at) continue;
    if (o.company_id !== companyId) continue;
    if ((o.tipo || 'compra') !== tipo) continue;
    const oAnio = o.anio || (o.fecha ? Number(String(o.fecha).slice(0, 4)) : null);
    if (oAnio !== year) continue;
    const c = Number(o.correlativo || 0);
    if (c > max) max = c;
  }
  return max + 1;
}

/** `OC-001-2026`, con el prefijo de la empresa si lo tiene. */
export function formatearCodigo(correlativo, { company, tipo = 'compra', anio } = {}) {
  const year = anio || new Date().getFullYear();
  const n = String(Math.max(1, Number(correlativo) || 1)).padStart(3, '0');
  return `${prefijoDeOrden(company, tipo)}-${n}-${year}`;
}

/** El correlativo y el código de la próxima orden, de una sola llamada. */
export function proximoCodigo(ordenes, { company, tipo = 'compra', anio } = {}) {
  const year = anio || new Date().getFullYear();
  const correlativo = siguienteCorrelativo(ordenes, { companyId: company?.id, tipo, anio: year });
  return { correlativo, anio: year, codigo: formatearCodigo(correlativo, { company, tipo, anio: year }) };
}

// ── LOS TOTALES ────────────────────────────────────────────────────

/**
 * Armo la orden desde cero: los ítems son valor de venta, el IGV se suma.
 * Es el caso de la hoja del modelo: 21.174,00 + 3.811,32 = 24.985,32.
 */
export function totalesDesdeItems(items, { igvPct = IGV_POR_DEFECTO } = {}) {
  let valorVenta = 0;
  for (const it of items || []) {
    if (!it || it.deleted_at) continue;
    const sub = (it.subtotal !== undefined && it.subtotal !== null && it.subtotal !== '')
      ? num(it.subtotal)
      : num(it.cantidad) * num(it.precio_unitario);
    valorVenta += sub;
  }
  valorVenta = round2(valorVenta);
  const igv = round2(valorVenta * (num(igvPct) / 100));
  return { valorVenta, igv, total: round2(valorVenta + igv), igvPct: num(igvPct) };
}

/**
 * La orden RESPALDA un total que ya existe (el comprobante ya emitido). El
 * total manda y el valor de venta se despeja hacia atrás — nunca al revés.
 *
 * Si no aplica IGV (recibo por honorarios, RUS), `igvPct = 0` y el valor de
 * venta es el total: no se inventa un IGV que la factura no tiene.
 */
export function totalesDesdeTotal(total, { igvPct = IGV_POR_DEFECTO } = {}) {
  const t = round2(total);
  const pct = num(igvPct);
  if (pct <= 0) return { valorVenta: t, igv: 0, total: t, igvPct: 0 };
  const valorVenta = round2(t / (1 + pct / 100));
  return { valorVenta, igv: round2(t - valorVenta), total: t, igvPct: pct };
}

/**
 * Reparte un total sobre los ítems, respetando el redondeo.
 *
 * Al emitir en lote, la orden tiene UN ítem con el total de la factura; pero
 * si la contadora lo parte en tres, los tres tienen que volver a sumar
 * EXACTO el total de la factura. El resto del redondeo va al último ítem —
 * si se dejara al azar, la orden cerraría con un céntimo de diferencia
 * contra el comprobante que respalda, y esa diferencia no se puede explicar.
 */
export function repartirSobreItems(items, valorVenta) {
  const vivos = (items || []).filter(it => it && !it.deleted_at);
  if (!vivos.length) return [];
  const pesos = vivos.map(it => {
    const p = (it.subtotal !== undefined && it.subtotal !== null && it.subtotal !== '')
      ? num(it.subtotal)
      : num(it.cantidad) * num(it.precio_unitario);
    return p;
  });
  const suma = pesos.reduce((a, b) => a + b, 0);
  const objetivo = round2(valorVenta);
  // Sin pesos utilizables (todo en cero) repartimos en partes iguales.
  const base = suma > 0 ? pesos.map(p => round2(objetivo * (p / suma)))
                        : pesos.map(() => round2(objetivo / vivos.length));
  const acumulado = round2(base.slice(0, -1).reduce((a, b) => a + b, 0));
  base[base.length - 1] = round2(objetivo - acumulado);
  return vivos.map((it, i) => ({ ...it, subtotal: base[i] }));
}

// ── QUÉ FALTA RESPALDAR ────────────────────────────────────────────

/** Los tipos de movimiento que un comprobante de COMPRA puede tener. */
const TIPOS_COMPRA = new Set(['cost', 'expense']);

/**
 * ¿Este movimiento necesita una orden que lo respalde?
 *
 * Reglas, en orden:
 *   · tiene que ser una compra (costo o gasto) — una venta se respalda con
 *     la orden que nos dio el CLIENTE, que no emitimos nosotros;
 *   · en soles (el umbral está en soles; un comprobante en dólares se
 *     evalúa aparte y por eso queda fuera, no "aprobado por defecto");
 *   · por encima del umbral;
 *   · sin orden ya vinculada.
 */
export function necesitaOrden(mov, { umbral = UMBRAL_POR_DEFECTO } = {}) {
  if (!mov || mov.deleted_at) return false;
  if (!TIPOS_COMPRA.has(mov.type)) return false;
  if ((mov.currency || 'PEN') !== 'PEN') return false;
  if (mov.orden_compra_id) return false;
  return num(mov.amount) > num(umbral);
}

/**
 * Los comprobantes sin respaldo, agrupados por empresa emisora y ordenados
 * por monto (lo caro primero: es donde el respaldo vale más).
 *
 * `ordenes` entra para no depender solo de `mov.orden_compra_id`: en offline
 * la orden puede estar creada y el movimiento todavía sin actualizar. Se
 * mira el vínculo por los DOS lados, igual que el espejo guía↔factura.
 */
export function comprobantesSinOrden(movs, ordenes, { umbral = UMBRAL_POR_DEFECTO, companyId = null } = {}) {
  const conOrden = new Set();
  for (const o of ordenes || []) {
    if (!o || o.deleted_at) continue;
    if (o.estado === 'anulada' || o.estado === 'cancelada') continue;
    if (o.accounting_movement_id) conOrden.add(o.accounting_movement_id);
  }
  const out = [];
  for (const m of movs || []) {
    if (!necesitaOrden(m, { umbral })) continue;
    if (conOrden.has(m.id)) continue;
    if (companyId && m.company_id !== companyId) continue;
    out.push(m);
  }
  return out.sort((a, b) => num(b.amount) - num(a.amount));
}

/** Los mismos comprobantes, en grupos por empresa. */
export function agruparPorEmpresa(movs, companies) {
  const porId = new Map((companies || []).map(c => [c.id, c]));
  const grupos = new Map();
  for (const m of movs || []) {
    const key = m.company_id || '__sin_empresa__';
    if (!grupos.has(key)) {
      grupos.set(key, {
        companyId: m.company_id || null,
        company: porId.get(m.company_id) || null,
        nombre: porId.get(m.company_id)?.name || 'Sin empresa',
        movs: [],
        monto: 0,
      });
    }
    const g = grupos.get(key);
    g.movs.push(m);
    g.monto = round2(g.monto + num(m.amount));
  }
  return [...grupos.values()].sort((a, b) => b.monto - a.monto);
}

/**
 * El número que va arriba de la pantalla: cuánto del dinero de este ámbito
 * está respaldado por una orden y cuánto no.
 */
export function resumenRespaldo(movs, ordenes, { umbral = UMBRAL_POR_DEFECTO, companyId = null } = {}) {
  let sobreUmbral = 0, montoSobreUmbral = 0;
  for (const m of movs || []) {
    if (!m || m.deleted_at) continue;
    if (!TIPOS_COMPRA.has(m.type)) continue;
    if ((m.currency || 'PEN') !== 'PEN') continue;
    if (companyId && m.company_id !== companyId) continue;
    if (num(m.amount) <= num(umbral)) continue;
    sobreUmbral++;
    montoSobreUmbral = round2(montoSobreUmbral + num(m.amount));
  }
  const pendientes = comprobantesSinOrden(movs, ordenes, { umbral, companyId });
  const montoPendiente = round2(pendientes.reduce((s, m) => s + num(m.amount), 0));
  return {
    umbral: num(umbral),
    sobreUmbral,
    montoSobreUmbral,
    sinRespaldo: pendientes.length,
    montoSinRespaldo: montoPendiente,
    respaldados: sobreUmbral - pendientes.length,
    montoRespaldado: round2(montoSobreUmbral - montoPendiente),
    pctRespaldado: montoSobreUmbral > 0
      ? round2(((montoSobreUmbral - montoPendiente) / montoSobreUmbral) * 100)
      : 0,
  };
}

// ── EL BORRADOR RETROACTIVO ────────────────────────────────────────

/**
 * El tipo que le corresponde a un comprobante según lo que compró.
 *
 * No es adivinanza fina: `clase` y `destino_contable` ya los llena la app
 * (1.304 movimientos tienen `clase`), y un servicio no lleva unidades ni
 * cantidades en el documento. Si no hay señal, `compra` — que es el caso
 * mayoritario y el que la contadora corrige de un click.
 */
export function tipoSugerido(mov) {
  const texto = `${mov?.clase || ''} ${mov?.category || ''} ${mov?.description || ''}`.toLowerCase();
  if (/servicio|alquiler|flete|honorario|asesor|consultor|manten|reparaci|transporte|hospedaje|aliment|combustible\s*serv/.test(texto)) {
    return 'servicio';
  }
  return 'compra';
}

/**
 * La fila editable de la grilla de emisión masiva: todo lo que la contadora
 * puede tocar ANTES de emitir (Gabriel pidió poder cambiar el nombre del
 * insumo y el monto), ya prellenado con lo que el comprobante sabe.
 */
export function borradorDesdeMovimiento(mov, { company, proveedor, obra } = {}) {
  const tipo = tipoSugerido(mov);
  const igvPct = num(mov?.amount) > 0 && mov?.document_type === 'recibo_honorarios' ? 0 : IGV_POR_DEFECTO;
  const t = totalesDesdeTotal(mov?.amount, { igvPct });
  return {
    movimiento_id: mov?.id || null,
    company_id: mov?.company_id || company?.id || null,
    obra_id: mov?.obra_id || null,
    trabajo_id: mov?.trabajo_id || null,
    tipo,
    fecha: mov?.date || null,
    titulo: (mov?.category || mov?.clase || '').toUpperCase() || null,
    descripcion: mov?.description || mov?.category || 'Insumos y materiales',
    unidad: textosDeTipo(tipo).unidadPorDefecto,
    cantidad: 1,
    proveedor_nombre: mov?.third_party_name || proveedor?.razon_social || '',
    proveedor_ruc: mov?.third_party_ruc || proveedor?.ruc || '',
    proveedor_direccion: proveedor?.direccion || '',
    proveedor_id: mov?.proveedor_id || proveedor?.id || null,
    documento: [mov?.document_type, mov?.document_number].filter(Boolean).join(' '),
    obra_descripcion: obra?.nombre_obra || null,
    igvPct: t.igvPct,
    valorVenta: t.valorVenta,
    igv: t.igv,
    total: t.total,
    incluir: true,
  };
}

/** Revalida un borrador después de que la contadora tocó el monto o el IGV. */
export function recalcularBorrador(b) {
  const t = totalesDesdeTotal(b?.total, { igvPct: b?.igvPct });
  return { ...b, ...t, igvPct: t.igvPct };
}

export default {
  TIPOS_ORDEN, TIPO_ORDEN_LABEL, TIPO_ORDEN_TEXTOS, UMBRAL_POR_DEFECTO,
  textosDeTipo, prefijoDeOrden, siguienteCorrelativo, formatearCodigo, proximoCodigo,
  totalesDesdeItems, totalesDesdeTotal, repartirSobreItems,
  necesitaOrden, comprobantesSinOrden, agruparPorEmpresa, resumenRespaldo,
  tipoSugerido, borradorDesdeMovimiento, recalcularBorrador,
};
