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

// Devuelve false si el item NO debe entrar en alertas globales
// (centro de alertas, dashboard, ejecutivo). Aplica a materiales,
// herramientas y EPPs.
//
// Casos en que NO se monitoriza:
//   - estado === 'inactivo' o 'retirado' (marcado manualmente por el user)
//   - stock_actual === 0 Y stock_minimo === 0 (típicamente importado
//     desde Excel sin datos completos — son "fantasmas" del catálogo
//     que no representan stock real). Aparecen con badge "sin configurar"
//     en la lista pero no rompen el contador del dashboard.
//
// Si querés mostrarlos en la lista local (con badge visual distinto),
// usá `esMaterialSinConfigurar` para detectarlos sin esconderlos.
export function esMaterialMonitorizable(m) {
  if (!m) return false;
  if (m.estado === 'inactivo' || m.estado === 'retirado') return false;
  const s = Number(m.stock_actual) || 0;
  const min = Number(m.stock_minimo) || 0;
  if (s === 0 && min === 0) return false;
  return true;
}

export function esMaterialSinConfigurar(m) {
  if (!m) return false;
  const s = Number(m.stock_actual) || 0;
  const min = Number(m.stock_minimo) || 0;
  return s === 0 && min === 0 && m.estado !== 'inactivo';
}
