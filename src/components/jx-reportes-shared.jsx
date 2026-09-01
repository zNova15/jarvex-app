import React from "react";
import { useChart } from "../lib/chart-loader.js";
import { hoyLocal } from "../lib/fecha.js";
import { cssVar } from "../lib/tema.js";
const { useEffect: uE, useRef: uR } = React;

export const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
export const fmtN = (n) => Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 });
export const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtSk = (n) => { const v = Number(n || 0); if (Math.abs(v) >= 1e6) return 'S/ ' + (v / 1e6).toFixed(1) + 'M'; if (Math.abs(v) >= 1e3) return 'S/ ' + (v / 1e3).toFixed(0) + 'K'; return 'S/ ' + Math.round(v); };

export const PERIODO_LABEL = { dia: 'Hoy', semana: 'Semana actual', mes: 'Mes actual', acumulado: 'Acumulado', custom: 'Rango personalizado' };

// Rango del período ANCLADO en la fecha local (America/Lima). No mezcla
// componentes locales de Date con toISOString UTC (ese corrimiento hacía que la
// "semana actual" vista de noche omitiera el lunes).
export function getPeriod(periodo, from, to) {
  const hoy = hoyLocal();
  const parse = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12)); };
  const fmt = (dt) => dt.toISOString().slice(0, 10);
  if (periodo === 'dia') return { from: hoy, to: hoy };
  if (periodo === 'semana') { const dt = parse(hoy); const day = dt.getUTCDay() || 7; dt.setUTCDate(dt.getUTCDate() - day + 1); return { from: fmt(dt), to: hoy }; }
  if (periodo === 'mes') { const [y, m] = hoy.split('-'); return { from: `${y}-${m}-01`, to: hoy }; }
  if (periodo === 'custom') return { from: from || '2000-01-01', to: to || hoy };
  return { from: null, to: null };
}

// Gráfico de barras horizontal que registra su instancia (para exportar a PDF).
export function ChartTop({ chartId, labels, data, color, onInstance, height = 200 }) {
  const Chart = useChart();
  const ref = uR(null);
  const inst = uR(null);
  uE(() => {
    if (!Chart || !ref.current || !labels.length) return;
    if (inst.current) inst.current.destroy();
    // Chart.js no lee CSS vars — se resuelven acá (tema activo en cada
    // (re)creación del gráfico; no cambia en caliente, el toggle de tema recarga).
    const tickColor = cssVar('--tm', '#7A8A9A');
    const gridColor = cssVar('--border', 'rgba(255,255,255,0.05)');
    inst.current = new Chart(ref.current, {
      type: 'bar',
      data: { labels, datasets: [{ data, backgroundColor: color, borderRadius: 4, maxBarThickness: 22 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: true } },
        scales: {
          x: { ticks: { color: tickColor, font: { size: 10 } }, grid: { color: gridColor }, border: { display: false } },
          y: { ticks: { color: tickColor, font: { size: 10 } }, grid: { display: false }, border: { display: false } },
        },
      },
    });
    onInstance?.(chartId, inst.current);
    return () => { try { inst.current?.destroy(); } catch {} onInstance?.(chartId, null); };
  }, [Chart, labels.join('|'), data.join('|'), color]);
  if (!labels.length) return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tm)', fontSize: 12 }}>Sin datos en el período</div>;
  return <div style={{ height }}><canvas ref={ref} /></div>;
}

// Convierte los gráficos montados a imágenes PNG para el PDF (página BLANCA):
// pasa ticks/grid oscuros solo para capturar, luego restaura el tema oscuro.
export function chartsToPNG(chartInsts, pairs) {
  const out = [];
  for (const [id, titulo] of pairs) {
    const inst = chartInsts.current?.[id];
    if (!inst) continue;
    const sc = inst.options.scales;
    const prev = { xt: sc.x.ticks.color, yt: sc.y.ticks.color, xg: sc.x.grid.color };
    try {
      sc.x.ticks.color = '#334155'; sc.y.ticks.color = '#1E293B'; sc.x.grid.color = 'rgba(0,0,0,0.08)';
      inst.update('none');
      out.push({ titulo, png: inst.toBase64Image('image/png', 1), height: 55 });
    } catch { try { out.push({ titulo, png: inst.toBase64Image('image/png', 1), height: 55 }); } catch {} }
    finally {
      // Restaurar SIEMPRE el tema oscuro del dashboard, aunque la captura falle.
      try { sc.x.ticks.color = prev.xt; sc.y.ticks.color = prev.yt; sc.x.grid.color = prev.xg; inst.update('none'); } catch {}
    }
  }
  return out;
}

// Fila de tarjetas KPI.
export function KpiCards({ items }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
      {items.map((k, i) => (
        <div key={i} className="card card-p" style={{ borderLeft: `3px solid ${k.color || 'var(--tp)'}` }}>
          <div style={{ fontSize: 10.5, color: 'var(--tm)', letterSpacing: '.05em' }}>{k.lbl}</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: k.color || 'var(--tp)', marginTop: 4 }}>{k.val}</div>
        </div>
      ))}
    </div>
  );
}
