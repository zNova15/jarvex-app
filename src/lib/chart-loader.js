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
  const [Chart, setChart] = useState(_chartRef);
  useEffect(() => {
    if (_chartRef) return;
    let cancelled = false;
    loadChart().then(c => { if (!cancelled) setChart(() => c); });
    return () => { cancelled = true; };
  }, []);
  return Chart;
}
