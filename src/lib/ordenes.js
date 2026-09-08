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
// LOS TRES BLOQUEANTES DE LA TANDA 5, cerrados en la tanda 7 (6-sep-2026,
// medidos contra producción antes de tocar código — ver
// docs/tanda-7-escaner-activos-ordenes.md § 9):
//   B-1 `tipoSugerido` decidía SOLO por texto, y `description` suele ser el
//       NOMBRE DEL PROVEEDOR — 11 de 204 comprobantes >umbral traían bienes
//       de verdad y salían tipados "servicio". Ahora los ÍTEMS mandan primero.
//   B-2 El IGV se asumía 18% siempre salvo recibo por honorarios (0 casos
//       >umbral) — 3 de 123 comprobantes con ítems son operaciones SIN IGV y
//       la orden les subvaluaba el valor de venta 15,25%. Ahora
//       `igvSugeridoDesdeItems` lo detecta por la suma de los ítems.
//   B-3 El lote de emisión recorría `comprobantesSinOrden()` en su orden por
//       MONTO (correcto para MIRAR) y pedía los correlativos en ESE orden: la
//       OC-001 se la llevaba el comprobante más caro, no el más antiguo.
//       `ordenarParaEmitir()` los recorre por fecha ascendente al emitir.
//
// Puro: sin React, sin Dexie. Testeado en __tests__/ordenes.test.js
// ═══════════════════════════════════════════════════════════════════

import { itemsDeFactura } from './cruce-recepcion.js';

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
  if (descartadoDelRespaldo(mov)) return false;
  return num(mov.amount) > num(umbral);
}

/**
 * ¿A este comprobante alguien decidió que NO le corresponde orden?
 *
 * Gabriel, 8-set-2026: «con el tema de facturas a respaldar, permite que se
 * pueda eliminar las que no consideremos que se deban respaldar».
 *
 * El umbral y el tipo de operación son reglas automáticas y aciertan casi
 * siempre, pero no siempre: un servicio de la propia contadora, un reembolso,
 * una compra que ya está respaldada por otro papel. Hasta hoy esas filas se
 * quedaban en «Sin respaldo» para siempre y el «% respaldado» nunca llegaba a
 * cerrar — así que la lista dejaba de mirarse, que es peor que no tenerla.
 *
 * Es un DESCARTE, no un borrado: la fila del comprobante no se toca (es un
 * movimiento contable, y borrarlo sería falsear el libro). Se marca con el
 * motivo, quién y cuándo (mig 200) y se puede deshacer.
 */
export function descartadoDelRespaldo(mov) {
  return !!(mov && mov.respaldo_no_requerido);
}

/**
 * ¿A esta entidad le toca llevar órdenes de respaldo?
 *
 * Gabriel, 7-set-2026: «en las empresas no debería salirme esta pestaña de sin
 * respaldo, solo en consorcios ejecutores de obra».
 *
 * Y tiene sentido más allá del gusto: el respaldo por orden es una exigencia
 * de la obra pública que ejecuta el consorcio, no del giro de una empresa del
 * grupo comprándole a su ferretería. Mostrarle la pestaña a las empresas les
 * ponía enfrente una lista de "pendientes" que nadie tenía que cerrar.
 *
 * `tipo_entidad` es el mismo CHECK de la mig 172 ('propia' | 'consorcio' |
 * 'tercero'); sin dato se asume 'propia', igual que el DEFAULT de la columna.
 */
export function exigeOrdenesDeRespaldo(entidad) {
  return (entidad?.tipo_entidad || 'propia') === 'consorcio';
}

/**
 * Por qué un comprobante NO figura entre los exigidos, para poder mostrarlo
 * igual y rotulado en vez de esconderlo.
 *
 * Medido el 7-set-2026 en la obra Miraflores: de las 114 compras de CONSORCIO
 * EL INCA solo 20 pasan el umbral. Las otras 94 —S/ 11.581,68 en total— no se
 * veían por ningún lado, y eso es lo que Gabriel leía como «faltan cosas».
 * No hay que EXIGIRLAS (debajo del umbral la orden no es obligatoria), pero
 * tiene que poder verlas y emitir la que quiera.
 *
 * @returns 'bajo_umbral' | 'moneda_extranjera' | null (null = sí es exigido)
 */
export function motivoNoExigido(mov, { umbral = UMBRAL_POR_DEFECTO } = {}) {
  if (!mov || mov.deleted_at) return null;
  if ((mov.currency || 'PEN') !== 'PEN') return 'moneda_extranjera';
  if (num(mov.amount) <= num(umbral)) return 'bajo_umbral';
  return null;
}

/**
 * Los comprobantes sin respaldo, agrupados por empresa emisora y ordenados
 * por monto (lo caro primero: es donde el respaldo vale más).
 *
 * `ordenes` entra para no depender solo de `mov.orden_compra_id`: en offline
 * la orden puede estar creada y el movimiento todavía sin actualizar. Se
 * mira el vínculo por los DOS lados, igual que el espejo guía↔factura.
 */
export function comprobantesSinOrden(movs, ordenes, {
  umbral = UMBRAL_POR_DEFECTO, companyId = null, obraId = null,
  // La apertura del umbral (tanda 14). NO cambia qué es exigible —
  // `resumenRespaldo` sigue contando solo lo de siempre, en soles, para que el
  // «% respaldado» de arriba signifique lo mismo con la vista abierta o
  // cerrada: solo deja MIRAR y emitir lo que quedaba fuera de la lista.
  incluirBajoUmbral = false,
  // Al revés: devuelve SOLO los que se descartaron a mano, para poder
  // revisarlos y devolverlos a la lista.
  soloDescartados = false,
} = {}) {
  const conOrden = new Set();
  for (const o of ordenes || []) {
    if (!o || o.deleted_at) continue;
    if (o.estado === 'anulada' || o.estado === 'cancelada') continue;
    if (o.accounting_movement_id) conOrden.add(o.accounting_movement_id);
  }
  const out = [];
  for (const m of movs || []) {
    if (!m || m.deleted_at) continue;
    if (!TIPOS_COMPRA.has(m.type)) continue;
    if (m.orden_compra_id) continue;
    const fuera = motivoNoExigido(m, { umbral });
    // Las compras en otra moneda SIEMPRE se muestran, rotuladas con su moneda.
    // Decisión de Gabriel del 7-set-2026: «los comprobantes en dólares sí se
    // muestran, no se los excluye». Antes estaban detrás de una casilla y eran
    // parte de lo que él leía como «faltan cosas en EL INCA». El umbral (que
    // está en soles) no se les compara: se muestra la compra entera y quien
    // mira decide; convertirla con un tipo de cambio inventado sería peor.
    // Lo que NO cambia: no se suman con los soles en ningún total.
    // Descartado a mano: no vuelve a aparecer ni siquiera con la vista abierta.
    // Para verlos hay que pedirlos explícitamente (`soloDescartados`), que es
    // como se deshace la decisión.
    if (descartadoDelRespaldo(m) !== soloDescartados) continue;
    if (fuera === 'bajo_umbral' && !incluirBajoUmbral) continue;
    // La marca de descarte ya se resolvió arriba; acá `necesitaOrden` solo
    // tiene que contestar por tipo/moneda/umbral. Sin neutralizarla, con
    // `soloDescartados` la lista salía vacía: el mismo predicado los volvía
    // a sacar.
    if (!fuera && !necesitaOrden({ ...m, respaldo_no_requerido: false }, { umbral })) continue;
    if (num(m.amount) <= 0) continue;
    if (conOrden.has(m.id)) continue;
    if (companyId && m.company_id !== companyId) continue;
    if (obraId && m.obra_id !== obraId) continue;
    out.push(m);
  }
  return out.sort((a, b) => num(b.amount) - num(a.amount));
}

/**
 * El orden en que se RECORRE un lote al emitir: por fecha ascendente.
 *
 * 🔴 Bloqueante B-3 de la tanda 5, corregido en la tanda 7: `comprobantesSinOrden()`
 * devuelve la lista por MONTO descendente —correcto para MIRAR, es donde el
 * respaldo importa más— pero el lote de emisión pedía `proximoCodigo()` en
 * ese mismo orden. Resultado: la OC-001 se la llevaba el comprobante más
 * caro, no el más antiguo, y el libro de órdenes quedaba con la numeración
 * saltando en el tiempo sin ninguna relación con él.
 *
 * El correlativo en sí está bien resuelto (toma el máximo ya emitido, así
 * que una orden anulada no libera su número); lo único que estaba mal era el
 * orden en que se RECORRÍA el lote antes de pedirlo. Fecha vacía va al
 * final: no se puede ordenar por un dato que no está.
 */
export function ordenarParaEmitir(borradores) {
  return [...(borradores || [])].sort((a, b) => {
    const fa = a?.fecha || '', fb = b?.fecha || '';
    if (!fa && !fb) return 0;
    if (!fa) return 1;
    if (!fb) return -1;
    return fa < fb ? -1 : fa > fb ? 1 : 0;
  });
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
 *
 * `obraId` acota el ámbito al de UN TRABAJO (tanda 6): la misma pantalla,
 * abierta desde el workspace de una obra, contesta «¿cuánto de lo que gastó
 * ESTA obra tiene su papel?». Sin ese corte, entrar por Miraflores devolvía
 * las 402 compras del grupo entero — el síntoma que reportó Gabriel.
 */
export function resumenRespaldo(movs, ordenes, { umbral = UMBRAL_POR_DEFECTO, companyId = null, obraId = null } = {}) {
  let sobreUmbral = 0, montoSobreUmbral = 0;
  let descartados = 0, montoDescartado = 0;
  for (const m of movs || []) {
    if (!m || m.deleted_at) continue;
    if (!TIPOS_COMPRA.has(m.type)) continue;
    if ((m.currency || 'PEN') !== 'PEN') continue;
    if (companyId && m.company_id !== companyId) continue;
    if (obraId && m.obra_id !== obraId) continue;
    if (num(m.amount) <= num(umbral)) continue;
    // Los descartados a mano salen del DENOMINADOR, no del numerador. Dejarlos
    // adentro los contaría como «respaldados» sin tener orden, que es
    // exactamente lo que el % no debe decir: lo que se decidió es que no
    // corresponde exigirles una, no que la tengan.
    if (descartadoDelRespaldo(m)) { descartados++; montoDescartado = round2(montoDescartado + num(m.amount)); continue; }
    sobreUmbral++;
    montoSobreUmbral = round2(montoSobreUmbral + num(m.amount));
  }
  // 🔴 El «% respaldado» cuenta SOLO lo exigible y SOLO en soles: es un
  // porcentaje sobre `montoSobreUmbral`, que arriba ya descartó lo que no es
  // PEN. Desde el 7-set-2026 la lista SÍ muestra las compras en otra moneda
  // (decisión de Gabriel), así que hay que descartarlas acá a mano — si no,
  // el numerador incluiría dólares que el denominador no tiene y el
  // porcentaje mentiría.
  const pendientes = comprobantesSinOrden(movs, ordenes, { umbral, companyId, obraId })
    .filter(m => (m.currency || 'PEN') === 'PEN');
  const montoPendiente = round2(pendientes.reduce((s, m) => s + num(m.amount), 0));
  return {
    umbral: num(umbral),
    sobreUmbral,
    montoSobreUmbral,
    sinRespaldo: pendientes.length,
    montoSinRespaldo: montoPendiente,
    respaldados: sobreUmbral - pendientes.length,
    montoRespaldado: round2(montoSobreUmbral - montoPendiente),
    // Cuántos se sacaron a mano de la lista y por cuánto. Se muestran para que
    // la decisión quede a la vista y se pueda revisar, no escondida.
    descartados,
    montoDescartado,
    pctRespaldado: montoSobreUmbral > 0
      ? round2(((montoSobreUmbral - montoPendiente) / montoSobreUmbral) * 100)
      : 0,
  };
}

// ── EL BORRADOR RETROACTIVO ────────────────────────────────────────

// Los `tipo_insumo` de items_factura que son un BIEN (nunca un servicio).
// Mismo vocabulario que insumos-venta.js / mapeo-insumos.js.
const TIPO_INSUMO_ES_BIEN = new Set(['material', 'herramienta', 'epp', 'maquinaria']);

/**
 * El tipo que le corresponde a un comprobante según lo que compró.
 *
 * 🔴 Bloqueante B-1 de la tanda 5, corregido en la tanda 7 (6-sep-2026):
 * la versión anterior decidía SOLO por texto (`clase + category +
 * description`), y `description` muy seguido es el NOMBRE DEL PROVEEDOR
 * («TRANSPORTES … S.A.C.»), no lo que se compró. Medido sobre los 204
 * comprobantes en soles por encima del umbral: 50 salían tipados «servicio»
 * por el texto, y 11 de esos TRAÍAN BIENES DE VERDAD en sus ítems — 11
 * documentos formales que habrían salido con el rótulo y la serie
 * equivocados.
 *
 * Los ÍTEMS son la verdad y mandan primero: si el comprobante trae aunque
 * sea un material/herramienta/EPP/maquinaria, es una compra, sin importar de
 * qué transportista o alquiladora venga el nombre. El texto solo decide
 * cuando no hay ítems que lo digan mejor (comprobantes sin `items_factura`,
 * el caso de los que no pasaron por Captura Mágica).
 */
export function tipoSugerido(mov) {
  const items = itemsDeFactura(mov);
  if (items.length) {
    if (items.some(it => TIPO_INSUMO_ES_BIEN.has(String(it?.tipo_insumo || '')))) return 'compra';
    if (items.some(it => String(it?.tipo_insumo || '') === 'servicio')) return 'servicio';
    // Ítems presentes pero sin `tipo_insumo` clasificado: cae al texto de abajo.
  }
  const texto = `${mov?.clase || ''} ${mov?.category || ''} ${mov?.description || ''}`.toLowerCase();
  if (/servicio|alquiler|flete|honorario|asesor|consultor|manten|reparaci|transporte|hospedaje|aliment|combustible\s*serv/.test(texto)) {
    return 'servicio';
  }
  return 'compra';
}

/**
 * ¿La suma de los ítems de la factura ya ES el total, sin margen para el
 * IGV? → operación exonerada/inafecta.
 *
 * 🔴 Bloqueante B-2 de la tanda 5, corregido en la tanda 7: `borradorDesdeMovimiento`
 * asumía IGV 18% siempre, salvo `document_type === 'recibo_honorarios'` — y
 * no hay NI UNO por encima del umbral, así que esa salida nunca se usaba.
 * Medido sobre los 123 comprobantes con ítems por encima del umbral: 117 son
 * coherentes con 18% (la suposición funciona), pero 3 tienen los ítems
 * IGUALES al total — son operaciones sin IGV, y asumirles 18% subvalúa el
 * valor de venta en 15,25%. Los otros 3 no cierran con ninguna hipótesis: se
 * dejan en el default (18%) para que la contadora los mire de a uno, que es
 * lo correcto cuando el dato no alcanza para decidir solo.
 *
 * Devuelve `0` cuando detecta la operación sin IGV, o `null` cuando no hay
 * con qué decidir (sin ítems, sin monto, o ninguna hipótesis cierra) — nunca
 * inventa un IGV a partir de nada.
 */
export function igvSugeridoDesdeItems(mov) {
  const items = itemsDeFactura(mov);
  const total = num(mov?.amount);
  if (!items.length || total <= 0) return null;
  let suma = 0;
  for (const it of items) {
    if (!it) continue;
    suma += (it.subtotal !== undefined && it.subtotal !== null && it.subtotal !== '')
      ? num(it.subtotal)
      : num(it.cantidad) * num(it.precio_unitario);
  }
  if (suma <= 0) return null;
  // Tolerancia de 2%: cubre el redondeo por céntimo del prorrateo de ítems
  // (repartirSobreItems), no una IMPOSICIÓN silenciosa de IGV en 0.
  const TOL = 0.02;
  return Math.abs(suma - total) <= TOL * total ? 0 : null;
}

/**
 * La fila editable de la grilla de emisión masiva: todo lo que la contadora
 * puede tocar ANTES de emitir (Gabriel pidió poder cambiar el nombre del
 * insumo y el monto), ya prellenado con lo que el comprobante sabe.
 */
// ── QUÉ SE COMPRÓ, DE VERDAD ──────────────────────────────────────
//
// Gabriel, 6-set-2026, mirando la grilla de «Sin respaldo»: «donde sale qué se
// compró no se está colocando lo que realmente está en la factura.
// Literalmente estás mezclando el nombre de la factura y el nombre de la
// empresa, que no es lo que se compró ni el servicio que se brinda».
//
// Tenía razón, y la causa estaba medida desde el bloqueante B-1: `description`
// NO es lo que se compró. En producción es literalmente
// «Factura FF01-7884 · FERRETERIA HUAMAN EIRL» — el tipo de documento, el
// número y el proveedor. Lo que se compró está en los ÍTEMS, y ahí dice
// «CEMENTO PORTLAND TIPO I 42.5 KG · 750 bolsas».
//
// Por eso ahora la orden retroactiva nace con las LÍNEAS REALES del
// comprobante, no con una sola que dice «Insumos y materiales». El total no se
// toca —lo reparte `repartirSobreItems` sobre las líneas— porque una orden que
// respalda una factura ya emitida no puede cerrar distinto de ella.
function lineasDeComprobante(mov, tipo) {
  const items = itemsDeFactura(mov);
  const T = textosDeTipo(tipo);
  const vivas = items
    .filter(it => it && String(it.descripcion || '').trim())
    .map(it => ({
      nombre: String(it.descripcion).trim(),
      unidad: it.unidad || T.unidadPorDefecto,
      cantidad: num(it.cantidad) || 1,
      precio_unitario: num(it.precio_unitario),
      tipo_insumo: it.tipo_insumo || null,
    }));
  if (vivas.length) return vivas;
  // Sin ítems no se inventa un detalle: se deja el rótulo neutro de siempre.
  return [{ nombre: 'Insumos y materiales', unidad: T.unidadPorDefecto, cantidad: 1, precio_unitario: 0, tipo_insumo: null }];
}

/**
 * El RUBRO de la orden, que NO es el tipo de documento.
 *
 * `category` vale «Factura» en 878 de 878 compras de producción, así que
 * ponerlo de título imprimía FACTURA en grande en el medio de una ORDEN DE
 * COMPRA — que es justo lo que Gabriel no quería ver en el PDF. El rubro sale
 * de lo que se compró; si no se puede saber, va vacío antes que mentir.
 *
 * 🔴 8-set-2026: la banda del PDF salía «PICOS M/TRAMONTINA-BELLOTA» — el
 * PRIMER ítem de una factura de 20 líneas, puesto de título de todo el
 * documento. Gabriel: «sale un título extraño donde salen los picos y eso no
 * tiene nada que ver; quítalo si no se puede colocar algo relevante». El
 * primer ítem NO representa a la orden: en una compra de 20 insumos es tan
 * arbitrario como el último. Se cae esa rama y el título queda vacío salvo que
 * alguien lo escriba (o que `category` traiga un rubro de verdad). Lo
 * relevante —a qué comprobante respalda— va en DATOS DE LA ORDEN, con su
 * rótulo, que es donde se lee sin adivinar.
 */
const TIPOS_DOCUMENTO = new Set(['factura', 'boleta', 'recibo honorarios', 'recibo por honorarios', 'nota de credito', 'nota de débito', 'nota de debito', 'ticket']);
const normRubro = (x) => String(x || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * ¿El título guardado en una orden merece imprimirse en el PDF?
 *
 * Las órdenes emitidas ANTES del 8-set-2026 llevan guardado lo que ya no se
 * guarda: el primer ítem de la factura («PICOS M/TRAMONTINA-BELLOTA») o, las
 * más viejas todavía, el tipo de documento («FACTURA»). Esas órdenes siguen
 * emitidas y su papel se vuelve a descargar. No se les toca el dato —una orden
 * emitida no se reescribe— pero el PDF no repite el error.
 *
 * Medido en producción el 8-set-2026: de 8 órdenes, 3 tienen título y las 3
 * son de este tipo (dos «PICOS M/TRAMONTINA-BELLOTA» y una «FACTURA»).
 */
export function tituloImprimible(titulo, items = []) {
  const t = String(titulo || '').trim();
  if (!t) return null;
  if (TIPOS_DOCUMENTO.has(normRubro(t))) return null;
  const esUnItem = (items || []).some(it => normRubro(it?.nombre || it?.descripcion || it?.nombre_libre) === normRubro(t));
  return esUnItem ? null : t;
}

export function rubroDeOrden(mov) {
  const cat = String(mov?.category || '').trim();
  if (cat && !TIPOS_DOCUMENTO.has(normRubro(cat))) return cat.toUpperCase();
  return null;
}

export function borradorDesdeMovimiento(mov, { company, proveedor, obra } = {}) {
  const tipo = tipoSugerido(mov);
  const sinIgv = mov?.document_type === 'recibo_honorarios' || igvSugeridoDesdeItems(mov) === 0;
  const igvPct = sinIgv ? 0 : IGV_POR_DEFECTO;
  const t = totalesDesdeTotal(mov?.amount, { igvPct });
  const lineas = repartirSobreItems(lineasDeComprobante(mov, tipo), t.valorVenta);
  return {
    movimiento_id: mov?.id || null,
    company_id: mov?.company_id || company?.id || null,
    obra_id: mov?.obra_id || null,
    trabajo_id: mov?.trabajo_id || null,
    tipo,
    fecha: mov?.date || null,
    titulo: rubroDeOrden(mov),
    // Lo que se compró, de la factura. Varias líneas se resumen para la grilla
    // y van completas a la orden (`lineas`).
    descripcion: lineas.map(l => l.nombre).join(' · ').slice(0, 140),
    lineas,
    documento_tipo: mov?.category || null,
    unidad: lineas.length === 1 ? lineas[0].unidad : textosDeTipo(tipo).unidadPorDefecto,
    cantidad: lineas.length === 1 ? lineas[0].cantidad : 1,
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
    // En blanco a propósito (tanda 14). Antes se escribía siempre «Respaldo
    // retroactivo del comprobante …» y salía impreso en el PDF de una orden
    // que ya de por sí dice a qué comprobante respalda. Gabriel: «cuando se
    // emite, en observaciones no debería salir nada si no se coloca».
    observaciones: '',
    incluir: true,
  };
}

/** Revalida un borrador después de que la contadora tocó el monto o el IGV. */
export function recalcularBorrador(b) {
  const t = totalesDesdeTotal(b?.total, { igvPct: b?.igvPct });
  return { ...b, ...t, igvPct: t.igvPct };
}

// ── EL DETALLE, EDITABLE ──────────────────────────────────────────
//
// Gabriel, 7-set-2026: «no se colocan los insumos reales que se facturaron».
//
// La orden retroactiva YA nacía con las líneas de `items_factura` (tanda 7),
// pero la única casilla editable de la grilla era `descripcion` — un resumen
// que `emitirLote` DESCARTA en cuanto el comprobante trae ítems. O sea: se
// podía escribir ahí todo el día y no cambiaba nada de lo que se emitía.
// Ahora se editan las líneas de verdad, y el resumen se deriva de ellas.

/** El texto de una línea de resumen a partir del detalle. */
export function resumenDeLineas(lineas) {
  return (lineas || [])
    .map(l => String(l?.nombre || '').trim())
    .filter(Boolean)
    .join(' · ')
    .slice(0, 140);
}

/** Lo que suman los importes del detalle, tal como están escritos. */
export function sumaDeLineas(lineas) {
  return round2((lineas || []).reduce((t, l) => t + num(l?.subtotal), 0));
}

/**
 * Aplica un cambio a UNA línea del detalle y devuelve el borrador nuevo.
 *
 * Los importes quedan como los escribe la persona —no se re-reparten a cada
 * tecla, que haría imposible tipear— y el cuadre contra el comprobante se
 * aplica al emitir (`repartirSobreItems`), avisando antes de la diferencia.
 * Una línea sin nombre no se emite: `lineasParaEmitir` la descarta.
 */
export function conLineaEditada(b, idx, patch) {
  const lineas = [...(b?.lineas || [])];
  if (!lineas[idx]) return b;
  const l = { ...lineas[idx], ...patch };
  if (patch && ('cantidad' in patch || 'precio_unitario' in patch) && !('subtotal' in patch)) {
    // Si tocó cantidad o precio, el importe se recalcula solo — pero únicamente
    // cuando los dos datos están: al revés borraría un importe válido.
    const c = num(l.cantidad), pu = num(l.precio_unitario);
    if (c > 0 && pu > 0) l.subtotal = round2(c * pu);
  }
  lineas[idx] = l;
  return { ...b, lineas, descripcion: resumenDeLineas(lineas) };
}

/** Agrega una línea vacía al detalle (para partir una factura en dos). */
export function conLineaNueva(b, tipo) {
  const T = textosDeTipo(tipo || b?.tipo);
  const lineas = [...(b?.lineas || []), { nombre: '', unidad: T.unidadPorDefecto, cantidad: 1, precio_unitario: 0, subtotal: 0, tipo_insumo: null }];
  return { ...b, lineas };
}

/** Quita una línea del detalle. Nunca deja el detalle vacío. */
export function conLineaQuitada(b, idx) {
  const lineas = (b?.lineas || []).filter((_, i) => i !== idx);
  if (!lineas.length) return b;
  return { ...b, lineas, descripcion: resumenDeLineas(lineas) };
}

/**
 * Las líneas que se emiten: sin las vacías y CUADRADAS contra el valor de
 * venta del comprobante. Una orden que respalda una factura ya emitida no
 * puede cerrar distinto de ella, así que el cuadre no es opcional — lo que sí
 * es obligatorio es que la pantalla lo diga antes de aplicarlo.
 */
export function lineasParaEmitir(b) {
  const vivas = (b?.lineas || []).filter(l => l && String(l.nombre || '').trim());
  const base = vivas.length ? vivas : [{
    nombre: b?.descripcion || 'Insumos y materiales',
    unidad: b?.unidad || textosDeTipo(b?.tipo).unidadPorDefecto,
    cantidad: num(b?.cantidad) || 1,
    subtotal: num(b?.valorVenta),
  }];
  return repartirSobreItems(base, num(b?.valorVenta));
}

// ═══════════════════════════════════════════════════════════════════
// UNA SOLA ORDEN PARA VARIAS FACTURAS (tanda 16)
//
// EL PEDIDO, de la asistente de contabilidad y la contadora jefe (8-set-2026):
// «voy a JARVEX y veo que hay tres órdenes de compra por hacerle; en lugar de
// hacer tres, le hago una sola». Gabriel: «realmente era así, era UNA orden de
// compra y se emitieron tres facturas por el límite de 20 ítems de la zona».
//
// Es el caso real de JARVEX → CONSORCIO EL INCA: E001-2 (20 ítems), E001-4
// (14) y E001-3 (12) son un solo pedido partido por un límite del sistema de
// facturación, no tres compras. Tres órdenes de respaldo para un solo pedido
// es papel que no representa lo que pasó.
//
// CÓMO SE GUARDA, sin migración: una orden ya se relaciona con su comprobante
// por los DOS lados —`ordenes_compra.accounting_movement_id` y
// `accounting_movements.orden_compra_id`—. En la fusión, los N comprobantes
// apuntan a la MISMA orden y la orden guarda como ancla el más antiguo. La
// lista completa se deriva de los movimientos que la apuntan, que es la única
// fuente que no se puede desincronizar. Por eso `comprobantesSinOrden` ya los
// da por respaldados a los N: filtra por `m.orden_compra_id`.
//
// QUÉ NO SE FUSIONA, y por qué: distinta empresa emisora (cada una numera su
// propia serie), distinto proveedor (la orden se le emite a UNO), distinta
// moneda (el PDF sale con un solo símbolo), distinto tipo (compra ≠ servicio)
// o distinto IGV (una orden tiene un solo `igv_pct`; mezclarlos falsearía el
// valor de venta de las dos partes).
// ═══════════════════════════════════════════════════════════════════

const rucNorm = (v) => String(v || '').replace(/\D+/g, '');
/** La identidad del proveedor para agrupar: el RUC si lo hay, si no el nombre. */
function claveProveedor(b) {
  const r = rucNorm(b?.proveedor_ruc);
  return r || String(b?.proveedor_nombre || '').trim().toLowerCase() || '—';
}

/**
 * ¿Estos borradores pueden salir en UNA sola orden?
 * @returns {{ ok: boolean, motivo: string|null }} — el motivo se muestra tal cual.
 */
export function puedeFusionar(borradores) {
  const bs = (borradores || []).filter(Boolean);
  if (bs.length < 2) return { ok: false, motivo: 'Hay que marcar al menos dos comprobantes.' };
  const distinto = (fn, etiqueta) => {
    const vals = new Set(bs.map(fn));
    return vals.size > 1 ? etiqueta : null;
  };
  const motivo =
       distinto(b => b.company_id || '', 'son de dos empresas emisoras distintas (cada una numera su propia serie)')
    || distinto(b => claveProveedor(b), 'son de proveedores distintos (una orden se le emite a uno solo)')
    || distinto(b => b.moneda || 'PEN', 'están en monedas distintas')
    || distinto(b => b.tipo || 'compra', 'una es de compra y otra de servicio')
    || distinto(b => String(Number(b.igvPct ?? 18)), 'tienen IGV distinto (una orden lleva un solo porcentaje)')
    || distinto(b => b.obra_id || '', 'son de obras distintas');
  return motivo ? { ok: false, motivo: `No se pueden fusionar: ${motivo}.` } : { ok: true, motivo: null };
}

/**
 * Los N borradores, convertidos en UNO.
 *
 * La fecha es la del comprobante MÁS ANTIGUO: la orden nació antes que todas
 * las facturas que respalda, así que fecharla con la última la dejaría
 * emitida después de lo que ordenó. El total manda sobre la suma de las
 * líneas (misma regla que la orden retroactiva de siempre): las líneas se
 * concatenan y `lineasParaEmitir` las cuadra contra el valor de venta.
 */
export function fusionarBorradores(borradores) {
  const bs = ordenarParaEmitir((borradores || []).filter(Boolean));
  if (!bs.length) return null;
  if (bs.length === 1) return bs[0];
  const primero = bs[0];
  const igvPct = Number(primero.igvPct ?? 18);
  const total = round2(bs.reduce((t, b) => t + num(b.total), 0));
  const t = totalesDesdeTotal(total, { igvPct });
  const lineas = bs.flatMap(b => (b.lineas || []).filter(l => l && String(l.nombre || '').trim()));
  const documentos = bs.map(b => b.documento).filter(Boolean);
  return {
    ...primero,
    // El ancla que va en `ordenes_compra.accounting_movement_id`, y la lista
    // completa que la pantalla escribe en los N `accounting_movements`.
    movimiento_id: primero.movimiento_id,
    movimientos_ids: bs.map(b => b.movimiento_id).filter(Boolean),
    documento: documentos.join(' · '),
    documentos,
    fecha: primero.fecha || null,
    lineas,
    descripcion: resumenDeLineas(lineas),
    // Un rubro heredado de una de las tres facturas no describe a las tres.
    titulo: null,
    igvPct: t.igvPct,
    valorVenta: t.valorVenta,
    igv: t.igv,
    total: t.total,
    fusionada: bs.length,
    incluir: true,
  };
}

// ═══════════════════════════════════════════════════════════════════
// EL NÚMERO SIGUE A LA FECHA (tanda 16)
//
// Gabriel, 8-set-2026: «no puede estar la orden de compra uno emitida el 5 de
// julio y la número dos el 3 de julio; tienen que ir correctamente
// estructuradas». Y: «que cuando se haga el respaldo nos muestre las facturas
// de la fecha más antigua a la nueva, y si no queremos hacerle la orden a la
// más antigua, se descarta y el código pasa a la siguiente».
//
// LO QUE YA ESTABA: `ordenarParaEmitir` recorre el lote por fecha ascendente
// (bloqueante B-3 de la tanda 5), así que DENTRO de un lote la numeración ya
// sale cronológica. LO QUE FALTABA: verlo antes de emitir, y que avise cuando
// el lote de hoy mete una fecha ANTERIOR a la última orden ya emitida — eso el
// orden interno del lote no lo puede arreglar, porque un correlativo emitido
// no se renumera nunca.
// ═══════════════════════════════════════════════════════════════════

/** La última orden numerada de (empresa, tipo, año): la del correlativo más alto. */
export function ultimaOrdenNumerada(ordenes, { companyId, tipo = 'compra', anio } = {}) {
  const year = anio || new Date().getFullYear();
  let mejor = null;
  for (const o of ordenes || []) {
    if (!o || o.deleted_at || !o.correlativo) continue;
    if (o.company_id !== companyId) continue;
    if ((o.tipo || 'compra') !== tipo) continue;
    const oAnio = o.anio || (o.fecha ? Number(String(o.fecha).slice(0, 4)) : null);
    if (oAnio !== year) continue;
    if (!mejor || Number(o.correlativo) > Number(mejor.correlativo)) mejor = o;
  }
  return mejor;
}

/**
 * Qué número le va a tocar a cada borrador seleccionado, ANTES de emitir.
 *
 * Recorre el lote en el mismo orden en que lo va a recorrer la emisión (por
 * fecha ascendente) y sobre el mismo acumulador local, así que lo que se
 * muestra es exactamente lo que se va a escribir. Desmarcar una fila corre
 * los números de las de abajo, que es justo lo que pidió Gabriel.
 *
 * @param companyDe (id) => company, para el prefijo del código.
 * @returns Map<movimiento_id, { codigo, correlativo, anio, fueraDeOrden, refCodigo, refFecha }>
 */
export function previsualizarCorrelativos(borradores, ordenes, { companyDe = () => null } = {}) {
  const out = new Map();
  const acumulado = [...(ordenes || [])];
  for (const b of ordenarParaEmitir(borradores || [])) {
    if (!b?.movimiento_id) continue;
    const company = companyDe(b.company_id);
    const tipo = b.tipo || 'compra';
    const anio = b.fecha ? Number(String(b.fecha).slice(0, 4)) : new Date().getFullYear();
    // La referencia se toma ANTES de sumar esta orden al acumulador: es contra
    // lo ya emitido (o contra lo que el propio lote acaba de numerar) que se
    // mide si la fecha retrocede.
    const previa = ultimaOrdenNumerada(acumulado, { companyId: b.company_id, tipo, anio });
    const { correlativo, codigo } = proximoCodigo(acumulado, { company, tipo, anio });
    const fueraDeOrden = !!(previa?.fecha && b.fecha && String(b.fecha) < String(previa.fecha));
    out.set(b.movimiento_id, {
      codigo, correlativo, anio, fueraDeOrden,
      refCodigo: fueraDeOrden ? previa.codigo : null,
      refFecha: fueraDeOrden ? previa.fecha : null,
    });
    acumulado.push({
      id: `__preview_${correlativo}`, company_id: b.company_id, tipo,
      correlativo, codigo, anio, fecha: b.fecha || null,
    });
  }
  return out;
}

/** Los pendientes ordenados para trabajar: 'fecha' (antigua→nueva) o 'monto'. */
export function ordenarPendientes(lista, criterio = 'fecha', { fechaDe = (x) => x?.date, montoDe = (x) => x?.amount } = {}) {
  const arr = [...(lista || [])];
  if (criterio === 'monto') return arr.sort((a, b) => num(montoDe(b)) - num(montoDe(a)));
  return arr.sort((a, b) => {
    const fa = fechaDe(a) || '', fb = fechaDe(b) || '';
    if (fa !== fb) { if (!fa) return 1; if (!fb) return -1; return fa < fb ? -1 : 1; }
    return num(montoDe(b)) - num(montoDe(a));
  });
}

// ═══════════════════════════════════════════════════════════════════
// LA ORDEN QUE NACE ANTES DEL COMPROBANTE (tanda 7, entrega 6)
//
// EL PEDIDO, de la jefa de contabilidad: «solamente se puede generar una orden
// de compra y servicio en base a su respaldo, lo cual está mal».
//
// Tenía razón. Hasta aquí la única puerta era «Sin respaldo»: se partía de una
// factura que YA existía y se le fabricaba la orden hacia atrás. Eso sirve
// para regularizar el pasado y no sirve para trabajar — una orden real nace
// antes, y el comprobante llega después.
//
// ── EL NÚMERO SE PIDE AL CONFIRMAR, NO AL CREAR ───────────────────
// Decisión de Gabriel, 6-sep-2026. Un correlativo es irreversible: una orden
// anulada NO libera su número (`siguienteCorrelativo` toma el máximo emitido,
// a propósito). Si el borrador numerara al nacer, cada pedido que se arma y se
// abandona dejaría un hueco permanente en el libro de la empresa, y en un
// documento que puede terminar en SUNAT los huecos hay que explicarlos.
//
// Entonces el borrador vive SIN correlativo —`siguienteCorrelativo` lo ignora
// solo porque `Number(null || 0)` es 0, así que un borrador nunca empuja el
// contador— y `numerarOrden()` es el único lugar donde se pide el número.
//
// ── EL RESPALDO SE COMPLETA DE A POCO ─────────────────────────────
// Gabriel: «progresivo, no un requisito de golpe». La orden nace con lo que se
// sabe (a quién, qué, cuánto) y después se le van colgando el comprobante, la
// bancarización si pasa el umbral, la detracción si corresponde y la guía de
// remisión. `pasosDeOrden()` dice qué falta sin bloquear nada: es una lista de
// pendientes, no una validación que impide guardar.
// ═══════════════════════════════════════════════════════════════════

/** La escalera de estados que ya acepta la base (check `ordenes_compra_estado_check`). */
export const ESTADOS_ORDEN = ['borrador', 'por_confirmar', 'firmada', 'enviada', 'aceptada', 'recibida_parcial', 'recibida', 'anulada', 'cancelada'];

export const ESTADO_ORDEN_LABEL = {
  borrador: 'Borrador (sin número)',
  por_confirmar: 'Por confirmar',
  firmada: 'Firmada',
  enviada: 'Enviada al proveedor',
  aceptada: 'Aceptada',
  recibida_parcial: 'Recibida parcial',
  recibida: 'Recibida',
  anulada: 'Anulada',
  cancelada: 'Cancelada',
};

/** Un borrador es una orden que todavía no gastó un número. */
export function esBorrador(orden) {
  return !!orden && orden.estado === 'borrador' && !orden.correlativo;
}

/** ¿Ya tiene número propio? */
export function estaNumerada(orden) {
  return !!(orden && orden.correlativo);
}

/**
 * El borrador de una orden que NACE ANTES del comprobante.
 *
 * Devuelve la fila y sus ítems por separado, sin ids ni timestamps: los pone
 * la pantalla, que es la que tiene `window.__newId()` y el usuario. Acá solo
 * vive la decisión de qué campos lleva y con qué valores arranca.
 *
 * Los totales salen de los ÍTEMS (`totalesDesdeItems`), no de un total dado:
 * es el caso inverso al retroactivo, donde el total ya existía y no se tocaba.
 */
export function nuevaOrdenBorrador({
  companyId, tipo = 'compra', obraId = null, trabajoId = null,
  proveedor = {}, items = [], igvPct = IGV_POR_DEFECTO,
  fecha = null, titulo = null, obraDescripcion = null, observaciones = null,
  lugarEntrega = null, fechaEntrega = null, condicionPago = null,
  ordenOrigenId = null, intermediarioCompanyId = null, intermediarioExterno = null,
} = {}) {
  const T = textosDeTipo(tipo);
  const lineas = (items || [])
    .filter(it => it && num(it.cantidad) > 0)
    .map(it => ({
      tipo_insumo: tipo === 'servicio' ? 'servicio' : (it.tipo_insumo || 'material'),
      material_id: it.material_id || null,
      insumo_id: it.insumo_id || null,
      insumo_codigo: it.insumo_codigo || null,
      nombre: it.nombre || it.descripcion || '',
      nombre_libre: it.nombre || it.descripcion || '',
      unidad: it.unidad || T.unidadPorDefecto,
      cantidad: num(it.cantidad),
      cantidad_recibida: 0,
      precio_unitario: num(it.precio_unitario),
      subtotal: round2(num(it.cantidad) * num(it.precio_unitario)),
      // De qué empresa del grupo sale este material, cuando la orden se armó
      // desde Abastecimiento. Es lo que después permite descontarle el stock.
      proveedor_company_id: it.company_id || null,
    }));

  const t = totalesDesdeItems(lineas, { igvPct });

  return {
    fila: {
      tipo,
      company_id: companyId || null,
      obra_id: obraId || null,
      trabajo_id: trabajoId || null,
      // 🔴 El borrador NO toma número. Se lo pide `numerarOrden()` al confirmar.
      codigo: null, correlativo: null, anio: null,
      estado: 'borrador',
      proveedor_id: proveedor.id || null,
      // A CUÁL de nuestras empresas se le emitió (mig 186). NULL si es un
      // tercero. Es lo único que hace que la orden le llegue a su buzón: el
      // snapshot de texto de abajo no sirve para eso porque el mismo RUC está
      // escrito de tres formas distintas en el catálogo.
      proveedor_company_id: proveedor.companyId || null,
      proveedor_nombre: proveedor.nombre || null,
      proveedor_ruc: proveedor.ruc || null,
      proveedor_direccion: proveedor.direccion || null,
      banco: proveedor.banco || null,
      cuenta_numero: proveedor.cuenta || null,
      cuenta_cci: proveedor.cci || null,
      fecha: fecha || null,
      fecha_entrega: fechaEntrega || null,
      lugar_entrega: lugarEntrega || null,
      condicion_pago: condicionPago || null,
      titulo: titulo || null,
      obra_descripcion: obraDescripcion || null,
      observaciones: observaciones || null,
      moneda: 'PEN',
      igv_pct: t.igvPct,
      monto_subtotal: t.valorVenta,
      monto_igv: t.igv,
      monto_total: t.total,
      // Nace SIN comprobante: eso es exactamente lo nuevo de esta entrega.
      accounting_movement_id: null,
      emitida_retroactiva: false,
      // La cadena (mig 185). NULL las tres en una compra directa.
      orden_origen_id: ordenOrigenId || null,
      intermediario_company_id: intermediarioCompanyId || null,
      intermediario_externo: intermediarioExterno || null,
    },
    items: lineas,
    totales: t,
  };
}

/**
 * Le da número a un borrador. ÚNICO lugar donde se consume un correlativo.
 *
 * `ordenes` tiene que incluir las ya emitidas MÁS las numeradas en esta misma
 * pasada (acumulador local): releer la base en cada vuelta de un lote devuelve
 * el mismo número dos veces hasta que la escritura anterior se vea. Es la
 * misma regla que ya respeta la emisión retroactiva.
 */
export function numerarOrden(borrador, ordenes, { company, anio = null } = {}) {
  if (!borrador) return null;
  if (estaNumerada(borrador)) return borrador;   // idempotente: no re-numera
  const year = anio
    || (borrador.fecha ? Number(String(borrador.fecha).slice(0, 4)) : null)
    || new Date().getFullYear();
  const { correlativo, codigo } = proximoCodigo(ordenes, { company, tipo: borrador.tipo || 'compra', anio: year });
  return { ...borrador, correlativo, codigo, anio: year, estado: 'por_confirmar' };
}

/**
 * Qué le falta a una orden para estar completamente respaldada.
 *
 * NO bloquea nada: devuelve una lista de pendientes para que la pantalla la
 * muestre. El orden es el del flujo real — primero llega el comprobante, y
 * recién ahí tiene sentido preguntar por la bancarización o la detracción.
 */
export function pasosDeOrden(orden, { movimiento = null, bancarizado = false, guias = [], umbral = UMBRAL_POR_DEFECTO } = {}) {
  const pasos = [];
  const push = (id, label, hecho, detalle) => pasos.push({ id, label, hecho: !!hecho, detalle: detalle || '' });

  push('numero', 'Número de orden', estaNumerada(orden),
    estaNumerada(orden) ? orden.codigo : 'Se asigna al confirmar el borrador');

  const mov = movimiento || null;
  push('comprobante', 'Comprobante del proveedor', !!mov,
    mov ? (mov.document_number || 'cargado') : 'Todavía no llegó la factura');

  // De aquí para abajo, nada tiene sentido sin el comprobante: se muestran
  // igual (para que se vea el camino completo) pero sin marcarlos como
  // pendientes urgentes hasta que la factura exista.
  const montoRef = num(mov?.amount) || num(orden?.monto_total);
  const requiereBanc = montoRef > num(umbral) && (mov?.currency || 'PEN') === 'PEN';
  if (requiereBanc) {
    push('bancarizacion', 'Bancarización', bancarizado,
      bancarizado ? 'Constancia cargada' : `Supera ${fmtUmbral(umbral)} — necesita constancia`);
  }

  const detr = num(mov?.detraccion_monto) > 0 || !!mov?.detraccion_codigo;
  if (detr) {
    push('detraccion', 'Detracción', num(mov?.detraccion_monto) > 0 && !!mov?.detraccion_codigo,
      mov?.detraccion_codigo ? `Código ${mov.detraccion_codigo}` : 'Falta el código del Anexo 3');
  }

  if ((orden?.tipo || 'compra') === 'compra') {
    const conGuia = (guias || []).some(g => g && !g.deleted_at);
    push('guia', 'Guía de remisión', conGuia, conGuia ? 'Vinculada' : 'Falta la guía del traslado');
  }

  const faltan = pasos.filter(p => !p.hecho);
  return { pasos, faltan, completa: faltan.length === 0, pct: pasos.length ? (pasos.length - faltan.length) / pasos.length : 0 };
}

/**
 * ⏸ APARCADA el 6-set-2026, por decisión de Gabriel — la lógica queda y los
 * tests también, pero NINGUNA pantalla la llama todavía.
 *
 * Sus palabras: «lo que te mencionaba antes del tema de las cadenas […] pienso
 * que también debemos olvidarnos un poco esta parte, porque si no se vuelve muy
 * complejo, y terminamos haciendo cosas que… todavía ni siquiera logramos hacer
 * bien una orden de compra y de servicio, y ahora queremos colocar un
 * intermediario».
 *
 * Tenía razón: la orden simple todavía no estaba resuelta cuando esto se armó.
 * Se conserva porque está medida y testeada, y porque el caso existe de verdad
 * — cuando la orden simple esté rodada, volver a enchufarla es una pantalla, no
 * un rediseño. Las columnas de la mig 185 quedan sin usar y no molestan.
 *
 * La CADENA con intermediario: A tiene el material, B lo revende, la ejecutora
 * lo compra. Devuelve las órdenes que hay que emitir, en el orden en que se
 * numeran.
 *
 * EL PEDIDO (Gabriel, 6-set-2026): «la empresa A le vende a la empresa B, y la
 * empresa B le vende a la ejecutora». Eligió DOS ÓRDENES ENCADENADAS y no una
 * con la cadena anotada: cada empresa emite su propio papel, con su propia
 * numeración, y así la cadena se sostiene sola ante una auditoría.
 *
 *   [0]  ejecutora → B    la que pide la obra          (siempre)
 *   [1]  B        → A     la que respalda a la de arriba (solo si B es NUESTRA)
 *
 * ⚠️ SI EL INTERMEDIARIO ES UN TERCERO, LA CADENA TIENE UN SOLO PAPEL.
 * Gabriel: «incluso con alguna empresa que sería un tercero que hace el favor
 * y hace de intermediario». A ese no le podemos emitir su orden hacia A: sería
 * fabricar un documento a nombre de alguien que no controlamos, y ese papel no
 * vale nada. Se emite solo la primera, queda anotado que hubo un tercero en el
 * medio, y `avisos` dice por qué falta la otra — en vez de simularla.
 *
 * SIN intermediario devuelve UNA orden, la de siempre: la compra directa sigue
 * existiendo y no paga ningún costo por esto.
 *
 * @param {Object} o
 * @param {string} o.ejecutoraId      quién pide (el consorcio que ejecuta).
 * @param {string} o.origenCompanyId  quién TIENE el material (A).
 * @param {Object} [o.intermediario]  {companyId} si es del grupo, o {nombre, ruc} si es un tercero.
 * @param {Array}  o.items            las líneas, ya con cantidad y precio.
 * @param {Object} [o.companiesById]  Map para poner el nombre del proveedor en cada orden.
 * @param {number} [o.margenPct]      cuánto le carga el intermediario encima. 0 = pasa a costo.
 *
 * @returns {{ordenes:Array, avisos:Array<string>}}
 */
export function cadenaDeOrdenes({
  ejecutoraId, origenCompanyId, intermediario = null, items = [],
  companiesById = new Map(), margenPct = 0, ...comunes
} = {}) {
  const nombre = (id) => companiesById.get(id)?.name || companiesById.get(id)?.legal_name || null;
  const ruc = (id) => companiesById.get(id)?.ruc || null;
  const avisos = [];

  const interCompanyId = intermediario?.companyId || null;
  const interExterno = !interCompanyId && intermediario?.nombre ? String(intermediario.nombre).trim() : null;
  const hayIntermediario = !!(interCompanyId || interExterno);

  // A quién le compra la ejecutora: al intermediario si lo hay, si no al que
  // tiene el material.
  // `companyId` cuando el destinatario es del grupo (mig 186): la orden le tiene
  // que aparecer en SU buzón, y en una cadena las dos patas van a empresas
  // nuestras. El intermediario externo es el único que va sin companyId — no es
  // nuestro y no tiene buzón.
  const proveedorDeArriba = hayIntermediario
    ? (interCompanyId
      ? { id: null, companyId: interCompanyId, nombre: nombre(interCompanyId), ruc: ruc(interCompanyId) }
      : { id: intermediario.proveedorId || null, companyId: null, nombre: interExterno, ruc: intermediario.ruc || null })
    : { id: null, companyId: origenCompanyId || null, nombre: nombre(origenCompanyId), ruc: ruc(origenCompanyId) };

  // El intermediario carga su margen: la ejecutora paga más de lo que A cobra.
  const conMargen = (its, pct) => its.map(it => ({
    ...it,
    precio_unitario: round2(num(it.precio_unitario) * (1 + num(pct) / 100)),
  }));

  const arriba = nuevaOrdenBorrador({
    ...comunes,
    companyId: ejecutoraId,
    proveedor: proveedorDeArriba,
    items: hayIntermediario ? conMargen(items, margenPct) : items,
    intermediarioCompanyId: interCompanyId,
    intermediarioExterno: interExterno,
  });

  if (!hayIntermediario) return { ordenes: [arriba], avisos };

  if (!interCompanyId) {
    avisos.push(
      `${interExterno} no es una empresa del grupo, así que la orden hacia ${nombre(origenCompanyId) || 'quien tiene el material'} la tiene que emitir ${interExterno}. JARVEX no puede firmar un documento a su nombre: queda anotado que hubo un intermediario y se emite solo la orden de la ejecutora.`
    );
    return { ordenes: [arriba], avisos };
  }

  // B es nuestra: emite su propia orden hacia A, a precio SIN el margen (el
  // margen es lo que B gana, no lo que le paga a A).
  const abajo = nuevaOrdenBorrador({
    ...comunes,
    companyId: interCompanyId,
    proveedor: { id: null, companyId: origenCompanyId || null, nombre: nombre(origenCompanyId), ruc: ruc(origenCompanyId) },
    items,
    observaciones: `Abastece la orden de ${nombre(ejecutoraId) || 'la ejecutora'}`,
  });

  return { ordenes: [arriba, abajo], avisos };
}

/**
 * Cómo se lee una cadena ya emitida, para pintarla.
 * Devuelve los eslabones de arriba hacia abajo.
 */
export function eslabonesDeCadena(orden, ordenes) {
  if (!orden) return [];
  const vivas = (ordenes || []).filter(o => o && !o.deleted_at);
  const hijas = vivas.filter(o => o.orden_origen_id === orden.id);
  return [orden, ...hijas.flatMap(h => eslabonesDeCadena(h, vivas))];
}

/** ¿Esta orden es parte de una cadena con intermediario? */
export function tieneIntermediario(orden) {
  return !!(orden && (orden.intermediario_company_id || orden.intermediario_externo));
}

const fmtUmbral = (u) => 'S/ ' + Number(u || 0).toLocaleString('es-PE');

export default {
  TIPOS_ORDEN, TIPO_ORDEN_LABEL, TIPO_ORDEN_TEXTOS, UMBRAL_POR_DEFECTO,
  textosDeTipo, prefijoDeOrden, siguienteCorrelativo, formatearCodigo, proximoCodigo,
  totalesDesdeItems, totalesDesdeTotal, repartirSobreItems,
  necesitaOrden, comprobantesSinOrden, agruparPorEmpresa, resumenRespaldo,
  tipoSugerido, borradorDesdeMovimiento, recalcularBorrador,
  ESTADOS_ORDEN, ESTADO_ORDEN_LABEL, esBorrador, estaNumerada,
  nuevaOrdenBorrador, numerarOrden, pasosDeOrden,
  cadenaDeOrdenes, eslabonesDeCadena, tieneIntermediario,
};

/**
 * EL NOMBRE DEL ARCHIVO DE UNA ORDEN (tanda 9).
 *
 * Gabriel, 7-set-2026: «los nombres que se generan con las órdenes de compra,
 * quiero que sean distintos pues se me han generado pero con nombres igual al
 * descargar el PDF».
 *
 * Eran DOS choques y los dos reales:
 *   1. El correlativo es POR EMPRESA (mig 179). JARVEX y GASOMI tienen las dos
 *      su OC-001-2026, y el archivo se llamaba `OC_OC-001-2026.pdf` en las dos.
 *      El navegador guarda el segundo como «(1)» y después nadie sabe cuál es.
 *   2. Un BORRADOR todavía no tiene código, así que TODOS caían en
 *      `OC_sin-codigo.pdf`: el mismo nombre para cada borrador que se baja.
 *
 * Entra la empresa (su prefijo de documento, su nombre corto o su RUC) y,
 * cuando no hay código, la fecha más un trozo del id — dos borradores del mismo
 * día siguen siendo dos archivos.
 */
export function nombreArchivoOrden(orden = {}, company = {}) {
  const prefijo = textosDeTipo(orden.tipo).prefijo;
  const marca = String(
    company.codigo_doc_prefix || company.nombre_corto || company.ruc || company.name || ''
  ).trim().replace(/\s+/g, '-').slice(0, 18);
  const idCorto = String(orden.id || '').replace(/-/g, '').slice(0, 6);
  const cuerpo = orden.codigo
    ? String(orden.codigo)
    : `borrador-${String(orden.fecha || '').slice(0, 10) || 'sin-fecha'}${idCorto ? `-${idCorto}` : ''}`;
  return [prefijo, marca, cuerpo].filter(Boolean).join('_')
    .replace(/[/\\:*?"<>|]/g, '-') + '.pdf';
}
