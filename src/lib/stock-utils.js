// ══════════════════════════════════════════════════════════════════════════
//  Stock utils — Niveles de alerta de inventario
//  Extraído de jx-almacen.jsx para que sea testeable y compartido.
//
//  Reglas (s = stock_actual, m = stock_minimo):
//   - m <= 0          → 'ok'       (no se monitoriza)
//   - s <= 0          → 'agotado'
//   - s <= m * 0.5    → 'critico'
//   - s <= m          → 'reponer'
//   - s <= m * 1.2    → 'cerca'
//   - en otro caso    → 'ok'
// ══════════════════════════════════════════════════════════════════════════

export function calcAlerta(stock, minimo) {
  const s = Number(stock) || 0;
  const m = Number(minimo) || 0;
  if (m <= 0) return 'ok';
  if (s <= 0) return 'agotado';
  if (s <= m * 0.5) return 'critico';
  if (s <= m) return 'reponer';
  if (s <= m * 1.2) return 'cerca';
  return 'ok';
}
