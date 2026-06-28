// ═══════════════════════════════════════════════════════════════════
// JARVEX — Avance Financiero (helper PURO, unit-testeable).
//
// Llena el "avance financiero" de la obra y de cada partida a partir de lo que
// los CONTADORES vinculan en Conciliación de Insumos (conciliacion_vinculos:
// ítem de factura ↔ insumo presupuestado). NO depende del consumo físico que
// imputan los ingenieros (eso es otra barra) — esto es "cuánto se ha COMPRADO/
// facturado del presupuesto".
//
// Atribución a partidas (decisión de Gabriel): el facturado de un insumo se
// reparte entre las partidas donde está presupuestado, PONDERADO por el
// presupuesto de cada una, pero SOLO entre las que están EN EJECUCIÓN
// (porcentaje_avance > 0). Si ninguna de sus partidas arrancó, se reparte entre
// todas (para no perder el monto). Cuando el insumo está en una sola partida,
// es exacto; cuando está en varias, es un estimado.
// ═══════════════════════════════════════════════════════════════════

const EPS = 1e-4;

// Mismo código canónico que usa Conciliación (jx-conciliacion) y los vínculos:
// código Delfín si existe; si no, fallback estable por nombre+tipo+unidad.
const codigoDe = (ip) => (ip.insumo_codigo && String(ip.insumo_codigo).trim())
  || ('sc:' + (ip.nombre_insumo || '') + '|' + (ip.tipo_insumo || '') + '|' + (ip.unidad || ''));

const presupDe = (ip) => Number(ip.costo_presupuestado)
  || (Number(ip.cantidad_presupuestada || 0) * Number(ip.precio_presupuestado || 0));

/**
 * @param {Object} o
 * @param {Array}  o.insumosPartida  filas insumos_partida (NIVEL partida, no consolidado);
 *                                   el caller suele excluir mano_obra y unidades %.
 * @param {Array}  o.vinculos        filas conciliacion_vinculos vivas (insumo_codigo, cantidad, precio_unitario).
 * @param {Map}    [o.partidasById]  Map<partida_id, partida> para leer porcentaje_avance.
 * @param {Function} [o.enEjecucion] (partida_id)=>bool; default: porcentaje_avance>0.
 * @returns {{obraPresup:number, obraFacturado:number, obraFacturadoAtribuido:number,
 *            obraPct:number, porPartida: Map<string,{presup:number,facturado:number,pct:number,estimado:boolean}>}}
 */
export function calcAvanceFinanciero({ insumosPartida = [], vinculos = [], partidasById = new Map(), enEjecucion } = {}) {
  // 1) Facturado por código de insumo (lo que vincularon los contadores).
  const factPorCodigo = new Map();
  for (const v of vinculos) {
    if (!v || v.deleted_at) continue;
    const cod = v.insumo_codigo && String(v.insumo_codigo).trim();
    if (!cod) continue;
    const monto = (Number(v.cantidad) || 0) * (Number(v.precio_unitario) || 0);
    if (monto <= 0) continue;
    factPorCodigo.set(cod, (factPorCodigo.get(cod) || 0) + monto);
  }

  // 2) Presupuesto por partida + lista (partida, presup) por código.
  const presupPorPartida = new Map();
  const porCodigo = new Map();
  for (const ip of insumosPartida) {
    if (!ip || ip.deleted_at || !ip.partida_id) continue;
    const presup = presupDe(ip);
    presupPorPartida.set(ip.partida_id, (presupPorPartida.get(ip.partida_id) || 0) + presup);
    const cod = codigoDe(ip);
    const arr = porCodigo.get(cod) || [];
    arr.push({ partida_id: ip.partida_id, presup });
    porCodigo.set(cod, arr);
  }

  const estaEnEjecucion = typeof enEjecucion === 'function'
    ? enEjecucion
    : (pid) => (Number(partidasById.get(pid)?.porcentaje_avance) || 0) > EPS;

  // 3) Distribuir el facturado de cada insumo entre sus partidas en ejecución.
  const factPorPartida = new Map();
  const estimadoPartida = new Set();   // partidas que recibieron un reparto estimado (insumo en varias)
  let obraFacturadoAtribuido = 0;
  for (const [cod, monto] of factPorCodigo) {
    const lista = porCodigo.get(cod);
    if (!lista || !lista.length) continue; // facturado de algo que no está presupuestado → no se atribuye a partidas
    let target = lista.filter(x => estaEnEjecucion(x.partida_id));
    if (!target.length) target = lista;     // ninguna en ejecución → repartir entre todas (no perder el monto)
    const sumP = target.reduce((s, x) => s + x.presup, 0);
    const repartido = target.length > 1;
    for (const x of target) {
      const share = sumP > EPS ? x.presup / sumP : 1 / target.length;
      factPorPartida.set(x.partida_id, (factPorPartida.get(x.partida_id) || 0) + monto * share);
      if (repartido) estimadoPartida.add(x.partida_id);
    }
    obraFacturadoAtribuido += monto;
  }

  // 4) Resultado por partida.
  const porPartida = new Map();
  for (const [pid, presup] of presupPorPartida) {
    const facturado = factPorPartida.get(pid) || 0;
    porPartida.set(pid, {
      presup, facturado,
      pct: presup > EPS ? Math.min(100, facturado / presup * 100) : 0,
      estimado: estimadoPartida.has(pid),
    });
  }

  // 5) Totales de obra.
  let obraPresup = 0; for (const p of presupPorPartida.values()) obraPresup += p;
  let obraFacturado = 0; for (const m of factPorCodigo.values()) obraFacturado += m;
  return {
    obraPresup,
    obraFacturado,             // todo lo vinculado (aunque algún código no esté en el presupuesto filtrado)
    obraFacturadoAtribuido,    // lo que sí cayó en alguna partida
    obraPct: obraPresup > EPS ? Math.min(100, obraFacturado / obraPresup * 100) : 0,
    porPartida,
  };
}
