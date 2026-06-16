// ═══════════════════════════════════════════════════════════════════
// JARVEX — Control de Consumo (Nivel 1: insumos directos vs presupuesto)
//
// Helper PURO (sin Dexie/React, unit-testeable). Compara el consumo real de
// cada insumo de una partida contra DOS baselines y devuelve el peor estado:
//   - vs PRESUPUESTO total del insumo (cantidad_real_usada / cantidad_presupuestada)
//   - vs AVANCE físico de la partida (real / (presupuesto × %avance)), cuando
//     hay avance reportado.
// ═══════════════════════════════════════════════════════════════════

// Umbrales del semáforo (ajustables en un solo lugar).
export const UMBRAL = {
  consumoAmber: 0.85, // ≥85% del presupuesto → atención
  consumoRojo: 1.00,  // >100% del presupuesto → sobreconsumo
  indiceAmber: 1.10,  // índice vs avance ≥1.10 → atención
  indiceRojo: 1.25,   // índice vs avance >1.25 → sobreconsumo
};

const RANK = { rojo: 3, ambar: 2, verde: 1, sin_presupuesto: 0 };
const peor = (a, b) => (RANK[a] >= RANK[b] ? a : b);

function estadoPorConsumo(pct) {
  if (pct > UMBRAL.consumoRojo + 1e-9) return 'rojo';
  if (pct >= UMBRAL.consumoAmber) return 'ambar';
  return 'verde';
}
function estadoPorIndice(indice) {
  if (indice == null) return 'verde';
  if (indice > UMBRAL.indiceRojo + 1e-9) return 'rojo';
  if (indice >= UMBRAL.indiceAmber) return 'ambar';
  return 'verde';
}

/**
 * @param {Object} opts
 * @param {Array} opts.partidas       filas de `partidas` (Dexie)
 * @param {Array} opts.insumosPartida filas de `insumos_partida` (Dexie)
 * @returns {Array} filas por partida (peor-primero) con sus insumos calculados
 */
export function calcularControlConsumo({ partidas = [], insumosPartida = [] }) {
  const porPartida = new Map();
  for (const ip of insumosPartida) {
    if (ip.deleted_at) continue;
    if (!porPartida.has(ip.partida_id)) porPartida.set(ip.partida_id, []);
    porPartida.get(ip.partida_id).push(ip);
  }

  const filas = [];
  for (const p of partidas) {
    if (p.deleted_at) continue;
    // porcentaje_avance viene 0–100; lo pasamos a fracción 0–1 y clampeamos.
    const pctAvance = Math.max(0, Math.min(1, (Number(p.porcentaje_avance) || 0) / 100));
    const tieneAvance = pctAvance > 0;

    const insumos = (porPartida.get(p.id) || []).map(ip => {
      const pres = Number(ip.cantidad_presupuestada) || 0;
      const real = Number(ip.cantidad_real_usada) || 0;
      if (pres <= 0) {
        return { ip, pres, real, pctConsumo: null, indice: null, estado: 'sin_presupuesto' };
      }
      const pctConsumo = real / pres;
      const esperado = pres * pctAvance;
      const indice = (tieneAvance && esperado > 0) ? real / esperado : null;
      const estado = peor(estadoPorConsumo(pctConsumo), estadoPorIndice(indice));
      return { ip, pres, real, pctConsumo, indice, estado };
    });

    const estado = insumos.reduce((acc, x) => peor(acc, x.estado), 'verde');
    const costoPres = Number(p.costo_total_presupuestado) || 0;
    const costoReal = Number(p.costo_real_acumulado) || 0;
    const pctCosto = costoPres > 0 ? costoReal / costoPres : null;
    filas.push({ partida: p, estado, pctAvance, pctCosto, costoPres, costoReal, insumos });
  }

  filas.sort((a, b) => RANK[b.estado] - RANK[a.estado] || (b.pctCosto || 0) - (a.pctCosto || 0));
  return filas;
}
