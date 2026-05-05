// Lazy loader de Chart.js. Antes se importaba estático en main.jsx (~250 KB
// gzip al bundle inicial aunque el user nunca abra Dashboard). Ahora se carga
// solo cuando el primer componente con <canvas> lo pide.
//
// Uso:
//   const Chart = await loadChart();
//   new Chart(canvasEl, {...});
//
// O con hook React:
//   const Chart = useChart();
//   if (!Chart) return <div>Cargando gráfico…</div>;

import { useEffect, useState } from 'react';

let _chartPromise = null;
let _chartRef = null;

export function loadChart() {
  if (_chartRef) return Promise.resolve(_chartRef);
  if (_chartPromise) return _chartPromise;
  _chartPromise = import('chart.js/auto').then(mod => {
    _chartRef = mod.default;
    // Compatibilidad con código legacy que lee window.Chart
    if (typeof window !== 'undefined') window.Chart = _chartRef;
    return _chartRef;
  });
  return _chartPromise;
}

export function useChart() {
  // ⚠ IMPORTANTE: useState(_chartRef) directo es UN BUG porque cuando
  // _chartRef ya tiene la clase Chart (función), React lo trata como lazy
  // initializer y la invoca SIN `new` → tira "Class constructor Chart
  // cannot be invoked without 'new'" en cualquier remount del componente
  // (StrictMode, navegación entre páginas, etc.).
  // Solución: lazy init function `() => _chartRef` que retorna la clase
  // sin que React intente ejecutarla.
  const [Chart, setChart] = useState(() => _chartRef);
  useEffect(() => {
    if (_chartRef) {
      // Si ya está cargado pero el state aún es null (caso de remount
      // tras el primer load), forzamos refresh.
      setChart(() => _chartRef);
      return;
    }
    let cancelled = false;
    loadChart().then(c => { if (!cancelled) setChart(() => c); });
    return () => { cancelled = true; };
  }, []);
  return Chart;
}
